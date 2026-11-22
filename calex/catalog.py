"""Unit price catalog: the curated reference prices (house prices, imported price books). Global, not per project.
Learned suggestions from projects are only ever applied when the user accepts them, and every change is logged."""
from __future__ import annotations
import csv
import hashlib
import io
import re
import statistics
import time
import uuid
from datetime import date, datetime
from . import store
from .benchmarks import Benchmarks, Entry, norm_unit, tokens
from .models import Item

_PLACEHOLDER = re.compile(r"\[[A-Z]+_?\d+\]|#{2,}")
BOOST = 1.15          # the user's own catalog wins over history when both match about equally


def _s() -> dict:
    s = store.get_meta("_global", "catalog").get("settings") or {}
    return {"yearly_increase_pct": float(s.get("yearly_increase_pct", 0) or 0), "region_factor": float(s.get("region_factor", 1) or 1)}


def get_settings() -> dict:
    return _s()


def set_settings(yearly: float, region: float) -> dict:
    if not (0.5 <= region <= 2.0):
        raise ValueError("The regional factor must be between 0.5 and 2.0.")
    if not (-20 <= yearly <= 50):
        raise ValueError("The yearly increase must be between -20 and 50 %.")
    store.set_meta("_global", "catalog", "settings", {"yearly_increase_pct": yearly, "region_factor": region})
    return _s()


def adjusted(price: float, price_date: str, st: dict | None = None) -> float:
    """Bring an old price to today's level: yearly increase compounded over the age of the price, times the regional factor."""
    st = st or _s()
    years = 0.0
    try:
        years = max(0.0, (date.today() - datetime.strptime(price_date[:10], "%Y-%m-%d").date()).days / 365.25)
    except (ValueError, TypeError):
        pass
    return round(price * (1 + st["yearly_increase_pct"] / 100) ** years * st["region_factor"], 2)


def _row(r, st) -> dict:
    d = dict(r)
    d["adjusted_price"] = adjusted(d["price"], d["price_date"], st)
    return d


def list_entries() -> list[dict]:
    st = _s()
    with store.db() as c:
        return [_row(r, st) for r in c.execute("SELECT * FROM catalog ORDER BY description COLLATE NOCASE").fetchall()]


def _log(c, entry_id, action, detail, source=""):
    c.execute("INSERT INTO catalog_log(entry_id,action,detail,source,at) VALUES(?,?,?,?,?)", (entry_id, action, detail, source, time.time()))


def _clean(d: dict) -> dict:
    desc = str(d.get("description", "")).strip()
    unit = str(d.get("unit", "")).strip()
    try:
        price = float(d.get("price"))
    except (TypeError, ValueError):
        raise ValueError("A catalog entry needs a price.")
    if not desc or len(tokens(desc)) < 2:
        raise ValueError("The description is too short to match against: use at least two meaningful words.")
    if price <= 0:
        raise ValueError("The price must be greater than zero.")
    num = lambda k: (float(d[k]) if d.get(k) not in (None, "") else None)
    pd = str(d.get("price_date", "") or "").strip()
    if pd and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", pd):
        raise ValueError("The price date must look like 2026-03-01.")
    return {"description": desc[:300], "unit": unit[:20], "price": price, "wages": num("wages"), "materials": num("materials"), "plant": num("plant"),
            "source": str(d.get("source", ""))[:120], "price_date": pd, "region": str(d.get("region", ""))[:60], "note": str(d.get("note", ""))[:300]}


def add_entry(d: dict, log_source: str = "manual") -> dict:
    e = _clean(d)
    eid, now = uuid.uuid4().hex[:10], time.time()
    with store.db() as c:
        c.execute("INSERT INTO catalog(id,description,unit,price,wages,materials,plant,source,price_date,region,note,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
                  (eid, e["description"], e["unit"], e["price"], e["wages"], e["materials"], e["plant"], e["source"], e["price_date"], e["region"], e["note"], now, now))
        _log(c, eid, "added", f'{e["description"][:60]} · {e["price"]:g} EUR/{e["unit"]}', log_source)
    return get_entry(eid)


def get_entry(eid: str) -> dict | None:
    with store.db() as c:
        r = c.execute("SELECT * FROM catalog WHERE id=?", (eid,)).fetchone()
    return _row(r, _s()) if r else None


def update_entry(eid: str, d: dict, log_source: str = "manual") -> dict | None:
    old = get_entry(eid)
    if not old:
        return None
    e = _clean({**old, **d})
    with store.db() as c:
        c.execute("UPDATE catalog SET description=?,unit=?,price=?,wages=?,materials=?,plant=?,source=?,price_date=?,region=?,note=?,updated=? WHERE id=?",
                  (e["description"], e["unit"], e["price"], e["wages"], e["materials"], e["plant"], e["source"], e["price_date"], e["region"], e["note"], time.time(), eid))
        if abs(old["price"] - e["price"]) > 1e-9:
            _log(c, eid, "price changed", f'{e["description"][:60]}: {old["price"]:g} → {e["price"]:g} EUR/{e["unit"]}', log_source)
        else:
            _log(c, eid, "edited", e["description"][:60], log_source)
    return get_entry(eid)


def delete_entry(eid: str) -> bool:
    old = get_entry(eid)
    if not old:
        return False
    with store.db() as c:
        c.execute("DELETE FROM catalog WHERE id=?", (eid,))
        _log(c, eid, "deleted", old["description"][:60], "manual")
    return True


def log(limit: int = 50) -> list[dict]:
    with store.db() as c:
        return [dict(r) for r in c.execute("SELECT * FROM catalog_log ORDER BY id DESC LIMIT ?", (limit,)).fetchall()]


def bench() -> Benchmarks:
    """The catalog as benchmark entries (prices brought to today's level), preferred over history when matches are about equal."""
    b, st = Benchmarks(), _s()
    for e in list_entries():
        tok = tokens(e["description"])
        if len(tok) >= 2 and e["unit"]:
            b.entries.append(Entry(f"Catalog · {e['source'] or 'own entry'}", e["id"], e["description"][:90], norm_unit(e["unit"]), adjusted(e["price"], e["price_date"], st), tok, "catalog", BOOST))
    return b


# ---- import from Excel / CSV ----
_COLS = {
    "description": ("beschreibung", "bezeichnung", "text", "kurztext", "leistung", "position", "description", "item", "name"),
    "unit": ("einheit", "me", "unit", "mengeneinheit", "eh"),
    "price": ("ep", "einheitspreis", "preis", "price", "unit price", "eur", "€", "netto", "ep netto"),
    "wages": ("lohn", "lohnanteil", "wages", "labour", "labor"),
    "materials": ("material", "stoff", "stoffe", "materials", "materialanteil"),
    "plant": ("gerät", "geräte", "plant", "equipment", "geraet"),
    "source": ("quelle", "source"), "price_date": ("datum", "preisstand", "date", "stand", "price date"),
    "region": ("region", "ort", "gebiet"), "note": ("bemerkung", "notiz", "note", "kommentar"),
}


def _num(v):
    if v in (None, ""):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = re.sub(r"[^\d,.\-]", "", str(v))
    if "," in s and "." in s:
        s = s.replace(".", "").replace(",", ".")
    elif "," in s:
        s = s.replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return None


def _date(v) -> str:
    if isinstance(v, (datetime, date)):
        return v.strftime("%Y-%m-%d")
    s = str(v or "").strip()
    for fmt in ("%Y-%m-%d", "%d.%m.%Y", "%m/%Y", "%Y"):
        try:
            return datetime.strptime(s, fmt).strftime("%Y-%m-%d")
        except ValueError:
            pass
    return ""


def import_rows(name: str, data: bytes) -> dict:
    """Read an Excel (.xlsx) or CSV file with a header row; columns are found by their names (German or English)."""
    if name.lower().endswith((".xlsx", ".xlsm")):
        import openpyxl
        wb = openpyxl.load_workbook(io.BytesIO(data), data_only=True, read_only=True)
        rows = [list(r) for ws in wb.worksheets for r in ws.iter_rows(values_only=True)]
    elif name.lower().endswith((".csv", ".txt")):
        text = data.decode("utf-8-sig", errors="replace")
        dialect = csv.Sniffer().sniff(text[:2000], delimiters=";,\t") if text.strip() else csv.excel
        rows = list(csv.reader(io.StringIO(text), dialect))
    else:
        raise ValueError("Use an Excel (.xlsx) or CSV file.")
    head_i, cols = None, {}
    for i, r in enumerate(rows[:15]):
        found = {}
        for j, cell in enumerate(r):
            h = str(cell or "").strip().lower()
            for key, names in _COLS.items():
                if key not in found and h in names:
                    found[key] = j
        if {"description", "price"} <= set(found):
            head_i, cols = i, found
            break
    if head_i is None:
        raise ValueError("No header row found. The file needs at least the columns Description (Beschreibung) and Price (EP).")
    added, skipped = 0, []
    for n, r in enumerate(rows[head_i + 1:], head_i + 2):
        get = lambda k: r[cols[k]] if k in cols and cols[k] < len(r) else None
        if not any(str(c or "").strip() for c in r):
            continue
        try:
            add_entry({"description": get("description"), "unit": get("unit") or "", "price": _num(get("price")), "wages": _num(get("wages")), "materials": _num(get("materials")),
                       "plant": _num(get("plant")), "source": get("source") or name, "price_date": _date(get("price_date")), "region": get("region") or "", "note": get("note") or ""},
                      log_source=f"import {name}")
            added += 1
        except ValueError as e:
            skipped.append({"row": n, "reason": str(e)})
    return {"added": added, "skipped": skipped[:20], "skipped_count": len(skipped), "columns": sorted(cols)}


# ---- suggestions learned from the projects' priced files ----
def _rejected() -> set[str]:
    return set(store.get_meta("_global", "catalog").get("rejected", {}).get("keys", []))


def _key(desc: str, unit: str) -> str:
    return hashlib.sha1(f"{' '.join(sorted(tokens(desc)))}|{norm_unit(unit)}".encode()).hexdigest()[:12]


def suggestions(history: Benchmarks, tolerance: float = 0.10, limit: int = 40) -> dict:
    """New items and price differences, from `history` (benchmark entries of all projects). Nothing is applied here."""
    cat = bench()
    rejected = _rejected()
    groups: dict[str, list[Entry]] = {}
    for e in history.entries:
        if e.unit in ("", "psch") or e.project == "catalog":
            continue
        groups.setdefault(_key(e.text, e.unit), []).append(e)
    new, upd = [], []
    for key, es in groups.items():
        if key in rejected:
            continue
        price = round(statistics.median(e.up for e in es), 2)
        rep = max(es, key=lambda e: len(e.text))
        if len(tokens(rep.text)) < 2 or _PLACEHOLDER.search(rep.text):     # unmatchable, or an anonymisation placeholder from the dataset
            continue
        hit = cat.suggest(Item(oz="", short_text=rep.text, unit=rep.unit)) if cat.entries else None
        srcs = sorted({e.source.split(" · ")[0] for e in es})[:3]
        row = {"key": key, "description": rep.text, "unit": rep.unit, "price": price, "n": len(es), "sources": srcs}
        if not hit:
            new.append({**row, "kind": "new"})
        else:
            cur = hit["median"]
            diff = (price - cur) / cur if cur else 0
            if abs(diff) > tolerance:
                cid = hit["matches"][0]["oz"]
                upd.append({**row, "kind": "update", "entry_id": cid, "current_price": cur, "diff_pct": round(diff * 100, 1), "current_text": hit["matches"][0]["text"]})
    new.sort(key=lambda r: (-r["n"], r["description"]))
    upd.sort(key=lambda r: -abs(r["diff_pct"]))
    return {"new": new[:limit], "update": upd[:limit], "new_total": len(new), "update_total": len(upd)}


def accept(items: list[dict]) -> dict:
    added = updated = 0
    for it in items:
        src = "learned from " + ", ".join(it.get("sources") or []) or "learned"
        if it.get("kind") == "update" and it.get("entry_id") and get_entry(it["entry_id"]):
            update_entry(it["entry_id"], {"price": it["price"], "price_date": date.today().isoformat(), "source": src}, log_source=src)
            updated += 1
        else:
            add_entry({"description": it["description"], "unit": it["unit"], "price": it["price"], "source": src, "price_date": date.today().isoformat()}, log_source=src)
            added += 1
    return {"added": added, "updated": updated}


def reject(keys: list[str]) -> None:
    store.set_meta("_global", "catalog", "rejected", {"keys": sorted(_rejected() | set(keys))})
