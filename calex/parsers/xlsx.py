"""Excel BoQs (.xlsx / .xlsm): the header row is detected (item number, description, quantity, unit, prices), one or more sheets."""
from __future__ import annotations
import io
from ..models import Project
from .tabular import items_from_rows


def parse_xlsx(data: bytes, name: str = "") -> Project:
    from openpyxl import load_workbook
    try:
        wb = load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    except Exception as e:
        raise ValueError(f"Could not read the Excel file ({e}). Only .xlsx / .xlsm are supported, not the old .xls format.")
    proj = Project(source=name, name=(name.rsplit(".", 1)[0] if name else ""), phase="tender")
    per_sheet: list[tuple[str, list]] = []
    for ws in wb.worksheets:
        rows = [list(r) for r in ws.iter_rows(values_only=True)]
        items = items_from_rows(rows, name, default_trade=ws.title)
        if items:
            per_sheet.append((ws.title, items))
    if not per_sheet:
        raise ValueError("No BoQ table found in this Excel file. Calex looks for a header row with an item number (OZ/Pos.), "
                         "a description (Kurztext/Beschreibung) and a quantity, unit or price column (Menge, Einheit, EP, GP).")
    seen: set[str] = set()
    collide = any(i.oz in seen or seen.add(i.oz) for _, its in per_sheet for i in its)
    for sheet, its in per_sheet:
        for it in its:
            if collide and len(per_sheet) > 1:
                it.oz = f"{sheet}/{it.oz}"
            proj.items.append(it)
    if any(i.unit_price for i in proj.items):
        proj.phase = "bid"
    if len(per_sheet) > 1:
        proj.notes.append(f"{len(per_sheet)} sheets were read: " + ", ".join(s for s, _ in per_sheet))
    for it in proj.items:
        proj.sections[it.section] = it.section_title
    return proj
