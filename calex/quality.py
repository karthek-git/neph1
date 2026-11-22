"""Quality check for parsed items: tells the user whether a file was read well (ok), needs a look (check) or failed."""
from __future__ import annotations
from .models import Project

NO_QTY_KINDS = {"lump_sum"}


def assess(proj: Project | None, error: str = "") -> tuple[str, list[str]]:
    """Return (status, warnings). Status: ok | check | failed."""
    if error or proj is None:
        return "failed", [error] if error else ["The file could not be read."]
    items = proj.items
    if not items:
        return "failed", ["No items were found in this file."]
    warnings: list[str] = []
    n = len(items)
    no_qty = sum(1 for i in items if i.quantity is None and i.kind not in NO_QTY_KINDS)
    no_unit = sum(1 for i in items if not i.unit and i.kind not in NO_QTY_KINDS)
    short = sum(1 for i in items if len(i.short_text.strip()) < 4)
    dup = n - len({i.oz for i in items})
    if no_qty / n > 0.25:
        warnings.append(f"{no_qty} of {n} items have no quantity.")
    if no_unit / n > 0.25:
        warnings.append(f"{no_unit} of {n} items have no unit.")
    if short / n > 0.15:
        warnings.append(f"{short} of {n} items have almost no description.")
    if dup > max(2, 0.05 * n):
        warnings.append(f"{dup} item numbers appear more than once.")
    warnings += [x for x in proj.notes if "OCR" in x or "scanned" in x.lower()]
    if n < 3:
        warnings.append(f"Only {n} item(s) found. A BoQ normally has many more.")
    return ("check" if warnings else "ok"), warnings
