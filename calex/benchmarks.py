"""Unit-price benchmarks from historical priced files (bids and awards).

Matching is transparent and conservative: same unit, similar item text (stemmed word overlap plus technical tags
such as DN 150 / PN 16), and at least two matches or one very similar one. The output is an indicative range with
the matching historical items listed, never a single 'correct' price.
"""
from __future__ import annotations
import re
import statistics
from pathlib import Path
from .models import Item, Project

_PH = re.compile(r"\[[A-Z]+_?\d+\]|#{2,}")
_TAG = re.compile(r"\b(DN|PN|NW|DA|IP|IE)\s?(\d{1,4})\b", re.I)
_STOP = {"einschließlich", "einschl", "liefern", "montieren", "herstellen", "einbauen", "inkl", "sowie", "nach", "unter",
         "gemäß", "gem", "oder", "gleichwertig", "wie", "vor", "beschrieben", "jedoch", "alle", "allen", "erforderlichen",
         "komplett", "betriebsfertig", "fertig", "einzurechnen", "einzukalkulieren"}


def norm_unit(u: str) -> str:
    u = (u or "").strip().lower().rstrip(".").replace("³", "3").replace("²", "2")
    return {"stk": "st", "stück": "st", "pauschal": "psch", "std": "h", "stunden": "h", "to": "t", "mt": "mt"}.get(u, u)


def tokens(item_text: str) -> frozenset:
    t = _PH.sub(" ", item_text.lower())
    tags = {f"{m.group(1).lower()}{m.group(2)}" for m in _TAG.finditer(t)}
    words = {w[:5] for w in re.findall(r"[a-zäöüß]{4,}", t) if w not in _STOP}
    return frozenset(words | tags)


class Entry:
    __slots__ = ("source", "oz", "text", "unit", "up", "tok", "project", "boost")

    def __init__(self, source, oz, text, unit, up, tok, project, boost=1.0):
        self.source, self.oz, self.text, self.unit, self.up, self.tok, self.project, self.boost = source, oz, text, unit, up, tok, project, boost


class Benchmarks:
    def __init__(self):
        self.entries: list[Entry] = []

    def add_project(self, p: Project, label: str, group: str | None = None):
        for it in p.items:
            if it.unit_price and it.unit_price > 0 and it.unit and it.kind != "hourly":
                text = (it.short_text + " " + it.long_text[:400]).strip()
                tok = tokens(text)
                if len(tok) >= 2:
                    self.entries.append(Entry(label, it.oz, it.short_text[:90], norm_unit(it.unit), it.unit_price, tok, group or p.source))

    def suggest(self, item: Item, exclude_project: str | None = None, k: int = 5) -> dict | None:
        if not self.entries:
            return None
        tok = tokens((item.short_text + " " + item.long_text[:400]).strip())
        unit = norm_unit(item.unit)
        if len(tok) < 2 or not unit or unit == "psch":
            return None
        scored = []
        for e in self.entries:
            if e.unit != unit or (exclude_project and e.project == exclude_project):
                continue
            inter = len(tok & e.tok)
            if not inter:
                continue
            sim = inter / len(tok | e.tok)
            # technical tags (DN/PN) must agree if both have them
            ta, tb = {t for t in tok if t[:2] in ("dn", "pn")}, {t for t in e.tok if t[:2] in ("dn", "pn")}
            if ta and tb and ta != tb:
                sim *= 0.4
            scored.append((min(1.0, sim * e.boost), e))
        scored.sort(key=lambda x: -x[0])
        top = [(s, e) for s, e in scored[:k] if s >= 0.3]
        if not top or (len(top) < 2 and top[0][0] < 0.6):
            return None
        ups = [e.up for _, e in top]
        return {
            "median": round(statistics.median(ups), 2), "low": round(min(ups), 2), "high": round(max(ups), 2), "n": len(ups),
            "confidence": "good" if top[0][0] >= 0.6 and len(top) >= 2 else "weak",
            "matches": [{"source": e.source, "oz": e.oz, "text": e.text, "unit_price": e.up, "similarity": round(s, 2)} for s, e in top[:3]],
        }


def load_dir(root: Path) -> Benchmarks:
    from .parsers import parse_file
    b = Benchmarks()
    seen: set[str] = set()
    for f in sorted(root.rglob("*")) if root.exists() else []:
        if not f.is_file() or f.suffix.lower() not in (".d84", ".d86", ".x84", ".x86", ".pdf"):
            continue
        try:
            p = parse_file(f.name, f.read_bytes())
        except Exception:
            continue
        priced = sum(1 for i in p.items if i.unit_price)
        if priced < 10:
            continue
        key = f"{len(p.items)}|{round(sum(i.total_price or 0 for i in p.items))}"   # same project as PDF and as D84 shares a key
        texty = sum(1 for i in p.items if len(i.short_text) > 3)
        if key in seen and texty < 0.5 * len(p.items):
            continue
        seen.add(key)
        b.add_project(p, f.name, group=key)
    return b


def group_key(p: Project) -> str:
    """Identity of a BoQ by size and priced total, so copies (PDF/D84) of the same bid count as one project."""
    return f"{len(p.items)}|{round(sum(i.total_price or 0 for i in p.items))}"


def hints_for(project: Project, bench: Benchmarks, include_own: bool = False) -> dict:
    """Indicative unit-price ranges for items that have no price yet. The project's own BoQ (same size and total) is excluded
    unless include_own is set, because a tender matched with its own award proves nothing."""
    own = None if include_own else group_key(project)
    hints, indicative = {}, 0.0
    candidates = [i for i in project.items if not i.unit_price and i.kind not in ("hourly", "lump_sum")]
    for it in candidates:
        h = bench.suggest(it, exclude_project=own)
        if h:
            hints[it.oz] = h
            if it.quantity:
                indicative += it.quantity * h["median"]
    return {
        "hints": hints,
        "coverage": {"matched": len(hints), "candidates": len(candidates),
                     "history_items": len(bench.entries), "history_projects": len({e.project for e in bench.entries}),
                     "sources": sorted({e.source.split(" · ")[0] for e in bench.entries})},
        "indicative_total": round(indicative, 2) if hints else None,
    }
