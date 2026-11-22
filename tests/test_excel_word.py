import io
import zipfile
from pathlib import Path

import pytest
from openpyxl import Workbook

from calex.parsers import parse_file
from calex.parsers.tabular import to_number, detect_header
from calex.analysis import analyze_project

DOCX_SAMPLE = Path(__file__).resolve().parent.parent / "ds" / "docx" / "LV-Positionen.docx"


def xlsx_bytes(sheets):
    wb = Workbook()
    wb.remove(wb.active)
    for title, rows in sheets.items():
        ws = wb.create_sheet(title)
        for r in rows:
            ws.append(r)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def docx_bytes(paragraphs=(), table_rows=None):
    p = "".join(f"<w:p><w:r><w:t>{t}</w:t></w:r></w:p>" for t in paragraphs)
    tbl = ""
    if table_rows:
        tbl = "<w:tbl>" + "".join("<w:tr>" + "".join(f"<w:tc><w:p><w:r><w:t>{c}</w:t></w:r></w:p></w:tc>" for c in row) + "</w:tr>" for row in table_rows) + "</w:tbl>"
    xml = f'<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>{p}{tbl}</w:body></w:document>'
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("word/document.xml", xml)
    return buf.getvalue()


BOQ = [["Projekt Testbau"], [],
       ["OZ", "Kurztext", "Langtext", "Menge", "Einheit", "EP", "GP"],
       ["1", "Erdarbeiten", None, None, None, None, None],
       ["1.1", "Aushub", None, None, None, None, None],
       ["1.1.10", "Baugrubenaushub", "Aushub nach Angabe der Bauleitung", 500, "m³", 12.5, 6250.0],
       ["1.1.20", "Abtransport", "Abfuhr und Entsorgung", "120,5", "m³", "9,80", "1.180,90"],
       ["1.1.30", "Baustelleneinrichtung", "", 1, "psch", 4000, 4000],
       ["Summe", "", "", None, None, None, 11430.9]]


def test_number_parsing_handles_german_and_english_formats():
    assert to_number("1.234,56") == 1234.56 and to_number("1,234.56") == 1234.56 and to_number("12,5") == 12.5
    assert to_number(7) == 7.0 and to_number("12,50 €") == 12.5 and to_number("abc") is None and to_number(None) is None


def test_xlsx_boq_with_header_sections_and_prices():
    p = parse_file("Testbau.xlsx", xlsx_bytes({"LV": BOQ}))
    assert p.phase == "bid" and len(p.items) == 3                       # sections and the 'Summe' row are not items
    a, b, c = p.items
    assert (a.oz, a.quantity, a.unit, a.unit_price, a.total_price) == ("1.1.10", 500.0, "m³", 12.5, 6250.0)
    assert a.long_text.startswith("Aushub nach") and a.section_title == "Aushub" and a.trade == "Erdarbeiten"
    assert (b.quantity, b.unit_price, b.total_price) == (120.5, 9.8, 1180.9)  # German number strings
    assert c.kind == "lump_sum"
    assert analyze_project(p, use_llm=False)["project"]["items"] == 3


def test_xlsx_without_prices_is_a_tender_and_english_headers_work():
    rows = [["Item", "Description", "Quantity", "Unit"], ["1.1", "Wall", 10, "m2"], ["1.2", "Floor", 5, "m2"]]
    p = parse_file("t.xlsx", xlsx_bytes({"Sheet1": rows}))
    assert p.phase == "tender" and [i.oz for i in p.items] == ["1.1", "1.2"]


def test_xlsx_multiple_sheets_with_clashing_numbers_get_sheet_prefix():
    rows = [["OZ", "Text", "Menge", "Einheit"], ["1.1", "A", 1, "St"], ["1.2", "B", 2, "St"]]
    p = parse_file("m.xlsx", xlsx_bytes({"Rohbau": rows, "Ausbau": rows}))
    assert len(p.items) == 4 and p.items[0].oz == "Rohbau/1.1" and p.items[2].oz == "Ausbau/1.1" and p.notes


def test_xlsx_errors_are_clear():
    with pytest.raises(ValueError, match="No BoQ table"):
        parse_file("x.xlsx", xlsx_bytes({"S": [["Name", "Alter"], ["Anna", 30]]}))
    with pytest.raises(ValueError, match="Could not read"):
        parse_file("x.xlsx", b"not a zip")
    with pytest.raises(ValueError, match="old .xls"):
        parse_file("x.xls", b"\xd0\xcf")


def test_docx_position_list_headings_alternatives_and_note():
    paras = ["Asphalt", "2.3.10 – Straßendecke schneiden [m]", "2.3.20 – Aufbruch [m³]", "…", "Rohre", "3.1.20 – Rohr liefern [m]",
             "oder", "3.1.60 – Anderes Rohr [m]", "mit", "3.2.20 – Rohr verlegen [m]"]
    p = parse_file("pos.docx", docx_bytes(paras))
    assert [i.oz for i in p.items] == ["2.3.10", "2.3.20", "3.1.20", "3.1.60", "3.2.20"]
    assert [i.kind for i in p.items] == ["normal", "normal", "normal", "alternative", "normal"]
    assert p.items[0].trade == "Asphalt" and p.items[2].trade == "Rohre" and p.items[0].unit == "m"
    assert p.notes and "no quantities" in p.notes[0]


def test_docx_table_is_read_like_excel():
    rows = [["Pos.", "Beschreibung", "Menge", "Einheit", "EP"], ["1.1", "Putz", "20", "m2", "15,00"], ["1.2", "Farbe", "20", "m2", "8,00"]]
    p = parse_file("t.docx", docx_bytes(["Angebot"], rows))
    assert len(p.items) == 2 and p.items[0].quantity == 20.0 and p.items[0].unit_price == 15.0 and not p.notes


def test_docx_without_items_or_broken_is_rejected_clearly():
    with pytest.raises(ValueError, match="No BoQ items"):
        parse_file("x.docx", docx_bytes(["Nur ein Brief", "ohne Positionen"]))
    with pytest.raises(ValueError, match="Could not read"):
        parse_file("x.docx", b"junk")


@pytest.mark.skipif(not DOCX_SAMPLE.exists(), reason="dataset not present")
def test_dataset_docx_position_list():
    p = parse_file("LV-Positionen.docx", DOCX_SAMPLE.read_bytes())
    assert len(p.items) == 40 and sum(i.kind == "alternative" for i in p.items) == 2
    assert {"Asphalt", "Baugrube", "Kabelschacht"} <= {i.trade for i in p.items}


def test_detect_header_needs_number_text_and_a_value_column():
    assert detect_header([["OZ", "Text"]]) is None
    assert detect_header([["OZ", "Text", "Menge"]]) is not None


def test_same_item_in_two_alternative_groups_is_not_a_duplicate():
    paras = ["Rohre", "3.1.20 – Rohr [m]", "3.1.90 – Zulage [m]", "oder", "3.1.60 – Anderes Rohr [m]", "3.1.90 – Zulage [m]",
             "Weitere", "4.1.10 – A [m]", "4.1.20 – B [m]", "4.1.30 – C [m]"]
    r = analyze_project(parse_file("p.docx", docx_bytes(paras)), use_llm=False)
    assert not [f for f in r["findings"] if f["category"] == "duplicate"]
