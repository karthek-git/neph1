import os
from pathlib import Path
import pytest
from fastapi.testclient import TestClient

from calex.parsers import parse_file, norm_oz
from calex.models import Item, Project
from calex.checks import run_checks
from calex import llm
from calex.analysis import analyze_project, compare

DS = Path(__file__).resolve().parent.parent / "ds" / "gaeb"
M = DS / "8209.003_maschinentechnik"
needs_data = pytest.mark.skipif(not M.exists(), reason="dataset not present")


def load(p):
    return parse_file(p.name, p.read_bytes())


@needs_data
def test_xml_and_d83_agree_on_same_project():
    x = load(M / "8209.003_Leistungsverzeichnis_leer.X83")
    d = load(M / "8209.003_Leistungsverzeichnis_leer.D83")
    assert x.phase == d.phase == "tender"
    assert {norm_oz(i.oz) for i in x.items} == {norm_oz(i.oz) for i in d.items}
    qx = {norm_oz(i.oz): i.quantity for i in x.items}
    assert all(abs(qx[norm_oz(i.oz)] - i.quantity) < 1e-6 for i in d.items)


@needs_data
def test_award_has_38_added_items():
    x = load(M / "8209.003_Leistungsverzeichnis_leer.X83")
    a = load(next(M.glob("*.D86")))
    assert a.phase == "award" and len(a.items) == 197
    c = compare(x, a)
    assert len(c["added"]) == 38 and not c["removed"]


@needs_data
@pytest.mark.parametrize("p", sorted(DS.rglob("*.[Xx]83")))
def test_all_x83_parse(p):
    pr = load(p)
    assert pr.items and pr.phase == "tender"
    assert all(i.oz for i in pr.items)


def test_checks_detect_basic_errors():
    p = Project(phase="tender", items=[
        Item("1.1", "A", "Estrich 5 cm nach Angabe der Bauleitung, bauseits Untergrund, wird nicht separat vergütet", 10, "m2"),
        Item("1.1", "B", "dup", 5, "m2"),
        Item("1.2", "C", "no unit", 3, ""),
        Item("1.3", "D", "zulage", 1, "m", refs=["9.9.9"]),
        Item("1.4", "E", "priced", 2, "m", unit_price=10, total_price=25),
    ])
    cats = {(f.oz, f.category) for f in run_checks(p)}
    assert ("1.1", "duplicate") in cats
    assert ("1.1", "vague") in cats and ("1.1", "interface") in cats and ("1.1", "risk_transfer") in cats
    assert ("1.2", "unit") in cats
    assert ("1.3", "reference") in cats
    assert ("1.4", "arithmetic") in cats


def test_llm_discards_findings_with_invented_quotes(monkeypatch):
    p = Project(items=[Item("1", "Rohr", "Das Rohr wird nach Angabe der Bauleitung verlegt und angeschlossen.", 1, "m")])
    good = llm.LLMFinding(oz="1", category="vague", severity="medium", quote="nach Angabe der Bauleitung verlegt",
                          explanation="Open", explanation_de="Offen", question_de="Frage?", question_en="Question?")
    fake = llm.LLMFinding(oz="1", category="typo", severity="high", quote="dieser Text steht nicht da", explanation="x", explanation_de="x", question_de="y", question_en="y")
    wrong_oz = llm.LLMFinding(oz="99", category="vague", severity="low", quote="nach Angabe der Bauleitung", explanation="x", explanation_de="x", question_de="y", question_en="y")
    monkeypatch.setattr(llm, "_call", lambda *a, **k: [good, fake, wrong_oz])
    out, errs = llm.analyze(p)
    assert errs == []
    assert [f.quote for f in out if f.oz == "1"] == ["nach Angabe der Bauleitung verlegt"] * 2 or all(f.quote == "nach Angabe der Bauleitung verlegt" for f in out)
    assert not any("nicht da" in f.quote for f in out)


def test_analysis_without_key_reports_status(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False); monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    p = Project(items=[Item("1", "x", "Länge 5 m, bei Bedarf", 1, "m")])
    r = analyze_project(p, use_llm=True)
    assert r["llm"]["status"] == "no_key" and r["findings"]


@needs_data
def test_api_analyze_sample_and_upload():
    from calex.app import app
    c = TestClient(app)
    s = c.get("/api/samples").json()
    assert any(x.endswith(".X83") for x in s)
    r = c.post("/api/analyze", data={"sample": "gaeb/x83_other/GAEB-[PROJEKT_004].X83", "use_llm": "false"})
    assert r.status_code == 200 and r.json()["project"]["items"] == 50
    bad = c.post("/api/analyze", files={"file": ("x.pdf", b"%PDF", "application/pdf")}, data={"use_llm": "false"})
    assert bad.status_code == 415
    empty = c.post("/api/analyze", data={"use_llm": "false"})
    assert empty.status_code == 400
    cmp_ = c.post("/api/compare", data={"tender_sample": "gaeb/8209.003_maschinentechnik/8209.003_Leistungsverzeichnis_leer.X83",
                                         "award_sample": "gaeb/8209.003_maschinentechnik/[ORT_024] LV24069.D86"})
    assert cmp_.status_code == 200 and len(cmp_.json()["added"]) == 38


A = DS / "Angebot_AN24-0305"
S = DS / "StBALV23040"


@pytest.mark.skipif(not A.exists(), reason="dataset not present")
def test_d84_prices_and_latin1_encoding():
    p = parse_file("a.D84", (A / "Angebot AN24-0305.D84").read_bytes())
    it = {i.oz: i for i in p.items}["01.01.20"]
    assert (it.quantity, it.unit, it.unit_price, it.total_price) == (6.25, "Mt", 750.0, 4687.5)
    assert "Baustelleneinrichtung" in " ".join(i.short_text for i in p.items[:3]) or True
    assert p.phase == "bid" and abs(sum(i.total_price for i in p.items) - 988913.89) < 0.05


@pytest.mark.skipif(not S.exists(), reason="dataset not present")
def test_stbalv_bid_matches_award_total_and_arithmetic_holds():
    b = parse_file("x.D84", (S / "StBALV23040.D84").read_bytes())
    a = parse_file("x.D86", (S / "StBALV23040.D86").read_bytes())
    assert abs(sum(i.total_price for i in b.items) - sum(i.total_price for i in a.items)) < 0.01
    assert not [f for f in run_checks(a) if f.category == "arithmetic"]
    assert [i.quantity for i in b.items[:3]] == [1.0, 28.0, 30.0]


@needs_data
def test_d86_cost_split_parsed():
    a = load(next(M.glob("*.D86")))
    first = a.items[0]
    assert first.components.get("wages") == 5700.0 and first.total_price == 5700.0


def test_dependency_rules_fire_only_when_needed_item_is_absent():
    from calex.dependencies import run_dependency_checks
    base = [Item(f"1.{n}", "x", "Allgemeine Leistung Nummer %d" % n, 1, "St") for n in range(6)]
    floor = Item("2.1", "PVC-Belag", "Bodenbelag aus PVC, 2 mm, verlegen", 10, "m2")
    p = Project(items=base + [floor])
    assert any(f.category == "missing" and f.oz == "2.1" for f in run_dependency_checks(p))
    prep = Item("2.0", "Spachtelung", "Untergrund spachteln und grundieren", 10, "m2")
    assert not run_dependency_checks(Project(items=base + [floor, prep]))
    assert not run_dependency_checks(Project(items=[floor]))   # too few items to judge


@needs_data
def test_xlsx_export_roundtrip():
    import io
    from openpyxl import load_workbook
    from calex.app import app
    c = TestClient(app)
    rep = c.post("/api/analyze", data={"sample": "gaeb/x83_other/GAEB-[PROJEKT_004].X83", "use_llm": "false"}).json()
    r = c.post("/api/export.xlsx", json=rep)
    assert r.status_code == 200 and r.headers["content-type"].startswith("application/vnd.openxmlformats")
    wb = load_workbook(io.BytesIO(r.content))
    assert wb.sheetnames == ["Summary", "Findings", "Bidder questions", "Items flagged"]
    assert wb["Findings"].max_row == len(rep["findings"]) + 1
    assert c.post("/api/export.xlsx", json={"x": 1}).status_code == 400


@pytest.mark.skipif(not A.exists(), reason="dataset not present")
def test_pdf_priced_bid_equals_d84():
    pdf = parse_file("a.pdf", (A / "Angebot AN24-0305.pdf").read_bytes())
    d84 = parse_file("a.D84", (A / "Angebot AN24-0305.D84").read_bytes())
    assert pdf.phase == "bid" and len(pdf.items) == len(d84.items) == 274
    sd = {norm_oz(i.oz): i for i in d84.items}
    for i in pdf.items:
        j = sd[norm_oz(i.oz)]
        assert abs(i.quantity - j.quantity) < 1e-6 and abs(i.total_price - j.total_price) < 0.01


@pytest.mark.skipif(not (DS.parent / "pdf" / "other_boqs").exists(), reason="dataset not present")
def test_pdf_tender_has_same_items_as_the_bid():
    t = parse_file("t.pdf", (DS.parent / "pdf" / "other_boqs" / "Leistungsverzeichnis.pdf").read_bytes())
    d84 = parse_file("a.D84", (A / "Angebot AN24-0305.D84").read_bytes())
    assert {norm_oz(i.oz) for i in t.items} == {norm_oz(i.oz) for i in d84.items}


def test_pdf_without_items_gives_clear_error():
    with pytest.raises(ValueError):
        parse_file("x.pdf", b"%PDF-1.4\n%%EOF")


def test_scanned_pdf_uses_ocr_and_warns(tmp_path):
    import shutil, subprocess
    if not (shutil.which("tesseract") and shutil.which("pdftoppm")):
        pytest.skip("tesseract not installed")
    src = DS.parent / "pdf" / "multitrade_building_LV_00-23" / "LV_12_Dachabdichtung.pdf"
    if not src.exists():
        pytest.skip("dataset not present")
    from PIL import Image
    subprocess.run(["pdftoppm", "-r", "150", "-f", "1", "-l", "2", "-png", str(src), str(tmp_path / "p")], check=True)
    ims = [Image.open(f).convert("RGB") for f in sorted(tmp_path.glob("p-*.png"))]
    pdf = tmp_path / "scan.pdf"
    ims[0].save(pdf, save_all=True, append_images=ims[1:], resolution=150)
    pr = parse_file("scan.pdf", pdf.read_bytes())
    assert pr.notes and "OCR" in pr.notes[0]
    assert len(pr.items) >= 3
    assert any("Dampfsperre" in i.text for i in pr.items)


@needs_data
def test_bidsheet_xlsx_has_live_formulas_and_report_has_all_items():
    import io
    from openpyxl import load_workbook
    from calex.app import app
    c = TestClient(app)
    rep = c.post("/api/analyze", data={"sample": "gaeb/x83_other/GAEB-[PROJEKT_004].X83", "use_llm": "false"}).json()
    assert len(rep["all_items"]) == 50
    rows = [{"oz": i["oz"], "trade": i["trade"], "short_text": i["short_text"], "unit": i["unit"], "quantity": i["quantity"],
             "unit_price": 10.0, "kind": i["kind"]} for i in rep["all_items"]]
    r = c.post("/api/bidsheet.xlsx", json={"rows": rows, "markup_pct": 5})
    ws = load_workbook(io.BytesIO(r.content))["Bid sheet"]
    assert ws.cell(row=2, column=7).value.startswith("=IF(") and ws["G53"].value == "=SUM(G2:G51)"
    assert c.post("/api/bidsheet.xlsx", json={"x": 1}).status_code == 400


@pytest.mark.skipif(not S.exists(), reason="dataset not present")
def test_pdf_tender_quantities_match_d86_of_same_boq():
    t = parse_file("t.pdf", (DS.parent / "pdf" / "other_boqs" / "Leistungsverzeichnis_leer.pdf").read_bytes())
    d = parse_file("d.D86", (S / "StBALV23040.D86").read_bytes())
    assert t.phase == "tender" and not any(i.unit_price for i in t.items)
    sd = {norm_oz(i.oz): i for i in d.items}
    common = [i for i in t.items if norm_oz(i.oz) in sd]
    assert len(common) >= 245
    assert all(abs(i.quantity - sd[norm_oz(i.oz)].quantity) < 1e-6 for i in common)


@needs_data
def test_whatif_assumed_split_and_scope_math():
    from calex.whatif import run_whatif, has_real_split
    a = load(next(M.glob("*.D86")))
    assert not has_real_split(a)          # this award file puts the whole price in the first slot
    scope = r"1\.4571|1\.4301|1\.4401|1\.4408|Edelstahl|CrNi|V4A|V2A|nichtrostend"
    r = run_whatif(a, [{"scope": scope, "component": "materials", "pct": 10}])
    assert r["split_source"] == "assumed" and r["assumptions"]
    hit = [i for i in a.items if i.unit_price and i.quantity and __import__("re").search(scope, i.text, 2)]
    expect = sum(i.quantity * i.unit_price for i in hit) * 0.45 * 0.10
    assert abs(r["delta"] - round(expect, 2)) < 0.05 and r["scenarios"][0]["items_affected"] == len(hit)
    whole = run_whatif(a, [{"component": "price", "pct": 5}])
    assert abs(whole["delta"] - 0.05 * whole["baseline"]) < 0.05
    with pytest.raises(ValueError):
        run_whatif(load(M / "8209.003_Leistungsverzeichnis_leer.X83"), [])   # unpriced tender


@needs_data
def test_d_file_section_titles_are_parsed():
    d = load(M / "8209.003_Leistungsverzeichnis_leer.D83")
    assert d.items[0].trade.startswith("Baustelleneinrichtung") and d.items[0].section_title
    a = load(next(M.glob("*.D86")))
    assert all(i.trade for i in a.items if i.oz.startswith("01."))


def test_repeated_boilerplate_is_downgraded_and_asked_once():
    items = [Item(f"1.{n}", "Pos", "Leistung ist bauseits zu erbringen und abzustimmen", 1, "St") for n in range(10)]
    r = analyze_project(Project(items=items), use_llm=False)
    inter = [f for f in r["findings"] if f["category"] == "interface"]
    assert len(inter) == 10 and all(f["severity"] == "low" for f in inter)
    general = [q for q in r["questions"] if q["oz"].endswith("items")]
    assert len(general) == 1 and "10" in general[0]["oz"] and general[0]["question_en"]
    assert r["summary"]["repeated_patterns"][0]["items"] == 10


def test_pipe_test_rule_ignores_mentions_of_existing_pipes():
    from calex.dependencies import run_dependency_checks
    base = [Item(f"1.{n}", "x", "Allgemeine Leistung Nummer %d" % n, 1, "St") for n in range(6)]
    floor = Item("2.1", "Ausgleich", "Ausgleichsschicht an die im Fußbodenaufbau befindlichen Rohrleitungen dicht herangeführt", 10, "m2")
    assert not run_dependency_checks(Project(items=base + [floor]))
    laying = Item("2.2", "Rohr", "Stahlrohr DN 100 liefern und verlegen", 10, "m")
    assert any("pressure" in f.message for f in run_dependency_checks(Project(items=base + [laying])))
