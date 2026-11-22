"""Shared logic for BoQs laid out as a table (Excel sheets, Word tables): find the header row, map columns, read items."""
from __future__ import annotations
import re
from ..models import Item

HEADERS = {
    "oz": {"oz", "pos", "pos nr", "posnr", "position", "positionsnr", "ordnungszahl", "ordnungs zahl", "nr", "item", "item no", "no", "ifd nr"},
    "text": {"kurztext", "text", "beschreibung", "leistungsbeschreibung", "bezeichnung", "description", "leistung", "short text", "kurzbezeichnung", "positionstext"},
    "long": {"langtext", "long text", "detailtext", "leistungstext", "ausfuehrung", "ausführung"},
    "qty": {"menge", "qty", "quantity", "anzahl", "vordersatz", "mengen"},
    "unit": {"einheit", "me", "eh", "unit", "mengeneinheit", "dim"},
    "up": {"ep", "einheitspreis", "unit price", "preis", "e preis", "ep eur", "einzelpreis", "preis eur"},
    "total": {"gp", "gesamtpreis", "gesamtbetrag", "total", "betrag", "gp eur", "gesamt", "summe", "total price"},
}


def _norm(cell) -> str:
    s = str(cell if cell is not None else "").lower().strip()
    s = re.sub(r"[\.:/\-_()\[\]€]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def to_number(v) -> float | None:
    if v is None or isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip().replace(" ", "").replace(" ", "")
    s = re.sub(r"[€a-zA-Z]+$", "", s)
    if not s or not re.search(r"\d", s):
        return None
    if "," in s and "." in s:
        s = s.replace(".", "").replace(",", ".") if s.rfind(",") > s.rfind(".") else s.replace(",", "")
    elif "," in s:
        s = s.replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return None


def detect_header(rows: list[list], scan: int = 40):
    """Return (header_row_index, {field: column}) or None. Needs item number + text + at least one of qty/unit/price."""
    for i, row in enumerate(rows[:scan]):
        found: dict[str, int] = {}
        for j, cell in enumerate(row):
            n = _norm(cell)
            if not n:
                continue
            for key, aliases in HEADERS.items():
                if n in aliases and key not in found:
                    found[key] = j
                    break
        if "oz" in found and "text" in found and ({"qty", "unit", "up", "total"} & set(found)):
            return i, found
    return None


def _oz(cell) -> str:
    if cell is None:
        return ""
    if isinstance(cell, float) and cell.is_integer():
        cell = int(cell)
    return re.sub(r"\.+$", "", str(cell).strip())


def items_from_rows(rows: list[list], source: str, default_trade: str = "") -> list[Item] | None:
    """Items from a table, or None if no recognisable header row exists."""
    hit = detect_header(rows)
    if hit is None:
        return None
    start, col = hit
    get = lambda row, k: row[col[k]] if k in col and col[k] < len(row) else None
    titles: dict[str, str] = {}
    items: list[Item] = []
    for row in rows[start + 1:]:
        oz = _oz(get(row, "oz"))
        text = str(get(row, "text") or "").strip()
        long_ = str(get(row, "long") or "").strip()
        qty, unit = to_number(get(row, "qty")), str(get(row, "unit") or "").strip()
        up, tot = to_number(get(row, "up")), to_number(get(row, "total"))
        if not oz and not text:
            continue
        if not oz or not re.match(r"^\d", oz):
            continue                                  # subtotal lines, notes, empty numbering
        is_item = qty is not None or bool(unit) or up is not None
        parts = oz.split(".")
        if not is_item:
            titles[oz] = text                         # section heading
            continue
        sec = ".".join(parts[:-1])
        it = Item(oz=oz, short_text=text, long_text=long_, quantity=qty, unit=unit, unit_price=up, total_price=tot,
                  section=sec, section_title=titles.get(sec, ""), trade=titles.get(parts[0], default_trade), source=source)
        if unit.lower().rstrip(".") in ("psch", "pauschal"):
            it.kind = "lump_sum"
        elif unit.lower().rstrip(".") in ("h", "std", "stunden"):
            it.kind = "hourly"
        if re.search(r"bedarfsposition|eventualposition|\(bedarf\)", text.lower()):
            it.kind = "optional"
        items.append(it)
    for it in items:
        it.section_title = titles.get(it.section, it.section_title)
        it.trade = titles.get(it.oz.split(".")[0], it.trade)
    return items
