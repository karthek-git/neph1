"""Excel export of a Calex report."""
from __future__ import annotations
import io
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

_FILL = {"high": "F8D7DA", "medium": "FFE8B3", "low": "D9EAD3"}


def _sheet(wb: Workbook, title: str, header: list[str], rows: list[list], widths: list[int], sev_col: int | None = None):
    ws = wb.create_sheet(title)
    ws.append(header)
    for c in ws[1]:
        c.font = Font(bold=True, color="FFFFFF")
        c.fill = PatternFill("solid", fgColor="1F3A5F")
    for r in rows:
        ws.append(r)
    for i, w in enumerate(widths, 1):
        ws.column_dimensions[get_column_letter(i)].width = w
    for row in ws.iter_rows(min_row=2):
        for c in row:
            c.alignment = Alignment(wrap_text=True, vertical="top")
        if sev_col is not None and row[sev_col].value in _FILL:
            row[sev_col].fill = PatternFill("solid", fgColor=_FILL[row[sev_col].value])
    ws.freeze_panes = "A2"
    ws.auto_filter.ref = ws.dimensions
    return ws


def report_to_xlsx(report: dict) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = "Summary"
    P, S = report["project"], report["summary"]
    rows = [("Project", P.get("name")), ("Source file", P.get("source")), ("Phase", P.get("phase")),
            ("Items", P.get("items")), ("Overall risk", S.get("overall")), ("Findings", S.get("findings")),
            ("High severity", S.get("severity", {}).get("high", 0)), ("Items flagged", S.get("items_flagged")),
            ("Likely change-order items", S.get("change_order_items")), ("Bidder questions", len(report.get("questions", []))),
            ("Total price (priced files)", P.get("total_price"))]
    for k, v in rows:
        ws.append([k, v])
    ws.append([])
    ws.append(["Findings by category"])
    for k, v in sorted(S.get("categories", {}).items(), key=lambda kv: -kv[1]):
        ws.append([k, v])
    ws.column_dimensions["A"].width = 32
    ws.column_dimensions["B"].width = 40
    for r in ws.iter_rows():
        if r[0].value and r[0].value in ("Findings by category",):
            r[0].font = Font(bold=True)

    _sheet(wb, "Findings", ["Severity", "Item", "Trade", "Category", "Finding", "Quote", "Draft question (DE)", "Source"],
           [[f["severity"], f["oz"], f.get("trade", ""), f.get("category_label", f["category"]), f["message"], f["quote"],
             f["question"], f["source"]] for f in report["findings"]], [10, 12, 26, 20, 60, 60, 60, 8], sev_col=0)
    _sheet(wb, "Bidder questions", ["No.", "Trade", "Item", "Priority", "Category", "Question (DE)", "Quote"],
           [[q["no"], q["trade"], q["oz"], q["severity"], q["category"], q["question"], q["quote"]] for q in report["questions"]],
           [9, 28, 12, 10, 20, 80, 60], sev_col=3)
    _sheet(wb, "Items flagged", ["Item", "Trade", "Section", "Short text", "Qty", "Unit", "Score", "Level", "Change-order likely"],
           [[i["oz"], i["trade"], i["section"], i["short_text"], i["quantity"], i["unit"], i["score"], i["level"],
             "yes" if i["change_order_likely"] else ""] for i in report["items"]], [12, 28, 28, 50, 10, 8, 8, 10, 12], sev_col=7)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def bidsheet_to_xlsx(sheet: dict) -> bytes:
    """sheet: {project, rows:[{oz,trade,short_text,unit,quantity,unit_price,kind}], markup_pct}. Totals use live Excel formulas."""
    wb = Workbook()
    ws = wb.active
    ws.title = "Bid sheet"
    ws.append(["Item", "Trade", "Description", "Qty", "Unit", "Unit price (EUR)", "Total (EUR)", "Type"])
    for c in ws[1]:
        c.font = Font(bold=True, color="FFFFFF")
        c.fill = PatternFill("solid", fgColor="1F3A5F")
    rows = sheet.get("rows", [])
    for n, r in enumerate(rows, 2):
        ws.append([r.get("oz"), r.get("trade"), r.get("short_text"), r.get("quantity"), r.get("unit"), r.get("unit_price"), None, r.get("kind")])
        ws.cell(row=n, column=7, value=f"=IF(AND(ISNUMBER(D{n}),ISNUMBER(F{n})),D{n}*F{n},0)")
        ws.cell(row=n, column=6).number_format = '#,##0.00'
        ws.cell(row=n, column=7).number_format = '#,##0.00'
    last = len(rows) + 1
    ws.append([])
    ws.append(["", "", "Net total", "", "", "", f"=SUM(G2:G{last})"])
    mk = float(sheet.get("markup_pct") or 0)
    ws.append(["", "", f"Markup (AGK / risk and profit) %", "", "", mk, f"=G{last + 2}*F{last + 3}/100"])
    ws.append(["", "", "Total with markup", "", "", "", f"=G{last + 2}+G{last + 3}"])
    for r in range(last + 2, last + 5):
        ws.cell(row=r, column=3).font = Font(bold=True)
        ws.cell(row=r, column=7).number_format = '#,##0.00'
    for i, w in enumerate([12, 28, 60, 10, 8, 16, 16, 12], 1):
        ws.column_dimensions[get_column_letter(i)].width = w
    ws.freeze_panes = "A2"
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()
