"""Results experience: stable finding ids, triage, edited questions, changes between analyses, Word letter, exposure."""
import io
import zipfile
import pytest
from fastapi.testclient import TestClient

from calex import store
from calex.analysis import analyze_project, diff_reports, finding_id
from calex.parsers import parse_file
from test_projects_api import FLOOR, SCREED, mk, x83


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "DATA_DIR", tmp_path)
    from calex.app import app
    return TestClient(app)


def upload(c, pid, name, data):
    return c.post(f"/api/projects/{pid}/files", files=[("files", (name, data, "application/octet-stream"))]).json()["files"][0]


def analyse(c, pid, ids):
    return c.post(f"/api/projects/{pid}/analyses", json={"file_ids": ids, "use_llm": False}).json()


def report(c, pid, aid):
    return c.get(f"/api/projects/{pid}/analyses/{aid}").json()["report"]


def test_finding_ids_are_stable_across_runs_and_questions_carry_them():
    p = parse_file("f.x83", FLOOR)
    a, b = analyze_project(p, use_llm=False), analyze_project(parse_file("f.x83", FLOOR), use_llm=False)
    assert [f["id"] for f in a["findings"]] == [f["id"] for f in b["findings"]] and a["findings"]
    assert len({f["id"] for f in a["findings"]}) == len(a["findings"])
    assert all(q["fid"] for q in a["questions"])
    assert finding_id("1", "vague", "ca. 5 cm", "x") == finding_id("1", "vague", "CA. 5 cm", "other message")   # quote decides, case and message do not


def test_exposure_uses_prices_and_says_what_it_is_based_on():
    p = parse_file("f.x83", FLOOR)
    for i in p.items:
        i.unit_price, i.total_price = 10.0, 10.0 * (i.quantity or 0)
    r = analyze_project(p, use_llm=False)
    e = r["summary"]["exposure"]
    assert e["deviation_pct"] == 10 and e["basis"] in ("file", "none")
    if r["summary"]["change_order_items"]:
        assert e["eur"] > 0 and e["items_priced"] == r["summary"]["change_order_items"]


def test_triage_roundtrip_and_validation(client):
    pid = mk(client)
    assert client.get(f"/api/projects/{pid}/triage").json() == {}
    assert client.put(f"/api/projects/{pid}/triage/abc", json={"status": "clarify", "note": "ask on Monday"}).status_code == 200
    assert client.get(f"/api/projects/{pid}/triage").json()["abc"] == {"status": "clarify", "note": "ask on Monday"}
    assert client.put(f"/api/projects/{pid}/triage/abc", json={"status": "bogus"}).status_code == 422
    client.put(f"/api/projects/{pid}/triage/abc", json={"status": "review"})        # back to default removes it
    assert client.get(f"/api/projects/{pid}/triage").json() == {}


def test_triage_survives_a_rerun_because_ids_are_stable(client):
    pid = mk(client)
    f = upload(client, pid, "floor.X83", FLOOR)
    r1 = report(client, pid, analyse(client, pid, [f["id"]])["id"])
    fid = r1["findings"][0]["id"]
    client.put(f"/api/projects/{pid}/triage/{fid}", json={"status": "dismissed", "note": ""})
    r2 = report(client, pid, analyse(client, pid, [f["id"]])["id"])
    assert fid in {x["id"] for x in r2["findings"]}
    assert client.get(f"/api/projects/{pid}/triage").json()[fid]["status"] == "dismissed"


def test_changes_between_two_analyses(client):
    pid = mk(client)
    f = upload(client, pid, "floor.X83", FLOOR)
    a1 = analyse(client, pid, [f["id"]])
    rows = client.get(f"/api/projects/{pid}/files/{f['id']}/items").json()["items"]
    rows[2]["short_text"], rows[2]["long_text"] = "Reinigung", "Reinigung mit Handbesen"        # the vague 'nach Angabe der Bauleitung' item is clarified
    rows.append({"oz": "99.1", "short_text": "Zulage", "long_text": "Zulage nach Bedarf, Umfang ca. unbekannt", "quantity": 1, "unit": "psch"})
    client.put(f"/api/projects/{pid}/files/{f['id']}/items", json={"items": rows})
    a2 = analyse(client, pid, [f["id"]])
    ch = client.get(f"/api/projects/{pid}/analyses/{a2['id']}/changes").json()
    assert ch["base"]["id"] == a1["id"]
    assert len(ch["resolved"]) >= 1 and len(ch["new"]) >= 1 and ch["unchanged"] >= 1
    first = client.get(f"/api/projects/{pid}/analyses/{a1['id']}/changes").json()
    assert first["base"] is None and first["new"] == []


def test_edited_question_state_and_word_letter(client):
    pid = mk(client)
    f = upload(client, pid, "floor.X83", FLOOR)
    a = analyse(client, pid, [f["id"]])
    qs = report(client, pid, a["id"])["questions"]
    assert qs
    key = qs[0]["fid"]
    client.put(f"/api/projects/{pid}/qstate/{key}", json={"text": "Bitte Belagsstärke angeben (angepasst)."})
    client.put(f"/api/projects/{pid}/qstate/{key}", json={"sent": True})
    st = client.get(f"/api/projects/{pid}/qstate").json()[key]
    assert st["text"].startswith("Bitte Belagsstärke") and st["sent"] is True            # a later patch does not erase the text
    r = client.post(f"/api/projects/{pid}/analyses/{a['id']}/letter.docx", json={"keys": [key]})
    assert r.status_code == 200 and "wordprocessingml" in r.headers["content-type"]
    z = zipfile.ZipFile(io.BytesIO(r.content))
    xml = z.read("word/document.xml").decode()
    assert "Bieterfragen zur Ausschreibung" in xml and "Belagsstärke angeben (angepasst)" in xml
    assert client.post(f"/api/projects/{pid}/analyses/{a['id']}/letter.docx", json={"keys": ["nope"]}).status_code == 422


def test_diff_reports_unit():
    a = {"findings": [{"id": "1", "severity": "high"}, {"id": "2", "severity": "low"}]}
    b = {"findings": [{"id": "2", "severity": "low"}, {"id": "3", "severity": "high"}]}
    d = diff_reports(a, b)
    assert [f["id"] for f in d["new"]] == ["1"] and [f["id"] for f in d["resolved"]] == ["3"] and d["unchanged"] == 1 and d["high_new"] == 1


def test_old_reports_without_ids_get_them_on_load(client):
    pid = mk(client)
    f = upload(client, pid, "floor.X83", FLOOR)
    a = analyse(client, pid, [f["id"]])
    with store.db() as c:       # simulate an analysis saved before ids existed
        import json
        rep = json.loads(c.execute("SELECT result FROM analyses WHERE id=?", (a["id"],)).fetchone()["result"])
        for x in rep["findings"]:
            x.pop("id", None)
        for q in rep["questions"]:
            q.pop("fid", None)
        c.execute("UPDATE analyses SET result=? WHERE id=?", (json.dumps(rep), a["id"]))
    got = client.get(f"/api/projects/{pid}/analyses/{a['id']}").json()["report"]
    assert all(x["id"] for x in got["findings"]) and all(q["fid"] for q in got["questions"])


def _quantity_findings(floor_qty, screed_qty):
    from calex.api_projects import merge_projects
    floor = x83("Boden", [("0001", "PVC-Belag", "Bodenbelag aus PVC verlegen", floor_qty, "m2"), ("0002", "Sockel", "Sockelleiste", 40, "m"),
                          ("0003", "Reinigung", "Bauendreinigung", 1, "psch"), ("0004", "Schutz", "Schutzfolie liefern", 100, "m2"), ("0005", "Fuge", "Fugenprofil", 12, "m")], "Bodenbelag")
    screed = x83("Estrich", [("0001", "Spachtelung", "Untergrund spachteln", 100, "m2"), ("0002", "Estrich", "Zementestrich 5 cm", screed_qty, "m2"),
                             ("0003", "Randstreifen", "Randdämmstreifen und Bewegungsfugen", 40, "m"), ("0004", "Trennlage", "PE-Folie", 100, "m2"), ("0005", "Abnahme", "Abnahme", 1, "psch")], "Estrich")
    merged = merge_projects([("floor.x83", parse_file("floor.x83", floor)), ("screed.x83", parse_file("screed.x83", screed))], "Test")
    return [f for f in analyze_project(merged, use_llm=False)["findings"] if "area" in f["message"] and f["category"] == "quantity"]


def test_cross_trade_quantity_mismatch_is_found_and_equal_areas_are_not():
    assert _quantity_findings(100, 100) == []
    found = _quantity_findings(100, 160)
    assert len(found) == 1 and "screed" in found[0]["message"] and "160" in found[0]["message"] and found[0]["question"].startswith("Zu Pos.")
    assert _quantity_findings(100, 110) == []                      # 10 % is within tolerance


def test_revised_tender_becomes_a_version_and_is_the_one_analysed(client):
    pid = mk(client)
    v1 = upload(client, pid, "tender_v1.X83", FLOOR)
    v2 = upload(client, pid, "tender_v2.X83", FLOOR.replace(b"<Qty>100</Qty>", b"<Qty>140</Qty>", 1).replace(b"Bodenbelag aus PVC verlegen", b"Bodenbelag aus PVC, 2 mm, verlegen"))
    plan = client.get(f"/api/projects/{pid}/plan").json()
    assert plan["risk"]["file_ids"] == [v2["id"]]                                  # the current version, not the first
    assert plan["compare"][0]["kind"] == "version" and plan["compare"][0]["tender_id"] == v1["id"] and plan["compare"][0]["later_id"] == v2["id"]
    assert plan["duplicates"] == []
    g = client.get(f"/api/projects/{pid}/versions").json()
    assert len(g) == 1 and g[0]["stage"] == "tender"
    vs = g[0]["versions"]
    assert [(v["number"], v["tag"], v["current"]) for v in vs] == [(1, "Original tender", False), (2, "Revised tender", True)]
    cmp_ = client.post(f"/api/projects/{pid}/compare", json={"tender_file_id": v1["id"], "award_file_id": v2["id"]}).json()
    assert cmp_["changed"][0]["tender"].startswith("100") and cmp_["changed"][0]["award"].startswith("140")
    assert len(cmp_["text_changed"]) == 0 or cmp_["text_changed"][0]["oz"]       # long text is not the short text; short texts unchanged here


def test_exact_copy_is_a_duplicate_not_a_version(client):
    pid = mk(client)
    upload(client, pid, "a.X83", FLOOR)
    upload(client, pid, "a_copy.X83", FLOOR)
    g = client.get(f"/api/projects/{pid}/versions").json()
    assert [v["tag"] for v in g[0]["versions"]] == ["Original tender", "Duplicate"]
    plan = client.get(f"/api/projects/{pid}/plan").json()
    assert plan["duplicates"][0]["ignored"] == "a_copy.X83" and plan["compare"] == []


def test_bid_after_tender_is_the_next_stage_not_a_version(client):
    pid = mk(client)
    t = upload(client, pid, "t.X83", FLOOR)
    from calex import bidgen
    proj = parse_file("t.x83", FLOOR)
    bid, _ = bidgen.x84_from_x83(FLOOR, proj, {i.oz: 5.0 for i in proj.items})
    b = upload(client, pid, "b.X84", bid)
    g = client.get(f"/api/projects/{pid}/versions").json()
    assert [(x["stage"], len(x["versions"])) for x in g] == [("tender", 1), ("bid", 1)]
    cmp_ = client.post(f"/api/projects/{pid}/compare", json={"tender_file_id": t["id"], "award_file_id": b["id"]}).json()
    assert len(cmp_["price_changed"]) == 0 and cmp_["totals"]["new"] is not None and cmp_["totals"]["old"] is None


def test_file_note_roundtrip(client):
    pid = mk(client)
    f = upload(client, pid, "a.X83", FLOOR)
    client.put(f"/api/projects/{pid}/files/{f['id']}/note", json={"note": "after client answers"})
    assert client.get(f"/api/projects/{pid}/versions").json()[0]["versions"][0]["note"] == "after client answers"


def test_deadlines_are_saved_validated_and_used_in_the_letter(client):
    pid = mk(client)
    assert client.patch(f"/api/projects/{pid}", json={"bid_deadline": "2026-12-15", "question_deadline": "2026-12-01"}).json()["question_deadline"] == "2026-12-01"
    assert client.patch(f"/api/projects/{pid}", json={"bid_deadline": "15.12.2026"}).status_code == 422
    assert client.patch(f"/api/projects/{pid}", json={"name": "Renamed"}).json()["bid_deadline"] == "2026-12-15"      # other patches keep them
    f = upload(client, pid, "floor.X83", FLOOR)
    a = analyse(client, pid, [f["id"]])
    r = client.post(f"/api/projects/{pid}/analyses/{a['id']}/letter.docx", json={"keys": []})
    assert "01.12.2026" in zipfile.ZipFile(io.BytesIO(r.content)).read("word/document.xml").decode()
    assert client.patch(f"/api/projects/{pid}", json={"bid_deadline": ""}).json()["bid_deadline"] == ""


def test_whatif_reports_optional_and_alternative_items_outside_the_total(client):
    from calex.whatif import run_whatif
    from calex.models import Item, Project
    p = Project(items=[Item(oz="1", short_text="a", quantity=10, unit="m", unit_price=5.0), Item(oz="2", short_text="b", quantity=2, unit="St", unit_price=100.0, kind="optional"),
                       Item(oz="3", short_text="c", quantity=1, unit="St", unit_price=50.0, kind="alternative")])
    r = run_whatif(p, [], None, include_optional=False)
    assert r["baseline"] == 50.0 and r["outside_total"] == {"optional": {"items": 1, "eur": 200.0}, "alternative": {"items": 1, "eur": 50.0}}
