"""What-if analysis on a priced BoQ: change materials / wages / plant / other (or the whole price) for items in scope.

A real per-item cost split (wages, materials, plant, other) is used only if the file actually contains one
(some exporters put the whole price in the first slot). Otherwise an explicit, editable assumed split is applied
and reported as an assumption.
"""
from __future__ import annotations
import re
from .models import Project

DEFAULT_SPLIT = {"materials": 0.45, "wages": 0.40, "plant": 0.10, "other": 0.05}
COMPONENTS = ("materials", "wages", "plant", "other", "price")
PRESETS = [
    {"name": "Stainless steel +15 % (materials)", "scope": r"1\.4571|1\.4301|1\.4401|1\.4408|Edelstahl|CrNi|V4A|V2A|nichtrostend", "component": "materials", "pct": 15},
    {"name": "Wages +8 %", "scope": "", "component": "wages", "pct": 8},
    {"name": "Plant and fuel +10 %", "scope": "", "component": "plant", "pct": 10},
    {"name": "Cast iron / ductile iron +12 % (materials)", "scope": r"Gusseisen|GGG|EN-GJS|Grauguss|duktil", "component": "materials", "pct": 12},
]


def has_real_split(project: Project) -> bool:
    n = 0
    for it in project.items:
        if len([v for v in it.components.values() if v]) >= 2:
            n += 1
    return n >= max(3, 0.05 * len(project.items))


def run_whatif(project: Project, scenarios: list[dict], split: dict | None = None, include_optional: bool = True) -> dict:
    items = [i for i in project.items if i.unit_price and i.quantity]
    if not items:
        raise ValueError("This file has no unit prices. What-if analysis needs a priced BoQ (a bid, an award, or an offer).")
    real = has_real_split(project)
    sp = {**DEFAULT_SPLIT, **{k: float(v) for k, v in (split or {}).items() if k in DEFAULT_SPLIT}}
    s = sum(sp.values()) or 1.0
    sp = {k: v / s for k, v in sp.items()}
    if not include_optional:
        items = [i for i in items if i.kind not in ("optional", "alternative")]

    def share(it, comp: str) -> float:
        if comp == "price":
            return 1.0
        if real and it.components:
            return (it.components.get(comp, 0.0)) / it.unit_price
        return sp[comp]

    base = sum(i.quantity * i.unit_price for i in items)
    delta_by_item: dict[str, float] = {}
    applied = []
    for sc in scenarios:
        comp = sc.get("component", "price")
        if comp not in COMPONENTS:
            raise ValueError(f"Unknown component '{comp}'")
        pct = float(sc.get("pct", 0))
        rx = re.compile(sc["scope"], re.I) if sc.get("scope") else None
        tr = (sc.get("trade") or "").lower()
        hit = 0
        for it in items:
            if rx and not rx.search(it.text):
                continue
            if tr and tr not in (it.trade or "").lower():
                continue
            d = it.quantity * it.unit_price * share(it, comp) * pct / 100.0
            if d:
                delta_by_item[it.oz] = delta_by_item.get(it.oz, 0.0) + d
                hit += 1
        applied.append({"name": sc.get("name") or f"{comp} {pct:+g} %", "component": comp, "pct": pct, "items_affected": hit})
    delta = sum(delta_by_item.values())
    by_oz = {i.oz: i for i in items}
    trades: dict[str, list[float]] = {}
    for i in items:
        t = trades.setdefault(i.trade or "General", [0.0, 0.0])
        t[0] += i.quantity * i.unit_price
        t[1] += delta_by_item.get(i.oz, 0.0)
    top = sorted(delta_by_item.items(), key=lambda kv: -abs(kv[1]))[:12]
    return {
        "baseline": round(base, 2), "scenario": round(base + delta, 2), "delta": round(delta, 2),
        "delta_pct": round(100 * delta / base, 2) if base else 0.0,
        "split_source": "file" if real else "assumed",
        "split_used": None if real else {k: round(v, 3) for k, v in sp.items()},
        "scenarios": applied,
        "by_trade": [{"trade": t, "baseline": round(v[0], 2), "delta": round(v[1], 2)} for t, v in sorted(trades.items(), key=lambda kv: -abs(kv[1][1]))],
        "top_items": [{"oz": oz, "short_text": by_oz[oz].short_text[:80], "baseline": round(by_oz[oz].quantity * by_oz[oz].unit_price, 2), "delta": round(d, 2)} for oz, d in top],
        "items_priced": len(items), "include_optional": include_optional,
        "assumptions": ([] if real else ["The file has no per-item cost split. A percentage split of the unit price is assumed (editable); results scale with it."])
                       + ["Scenarios are added together, not compounded. Quantities and other items are unchanged."],
    }
