import pytest
from fastapi.testclient import TestClient

from calex import store


def x83(name, items, trade="Gewerk"):
    """Minimal GAEB 3.2 tender: items = [(rno, short, long, qty, unit)]."""
    body = "".join(
        f'<Item RNoPart="{r}"><Qty>{q}</Qty><QU>{u}</QU><Description><CompleteText>'
        f'<OutlineText><TextOutlTxt><p><span>{s}</span></p></TextOutlTxt></OutlineText>'
        f'<DetailTxt><Text><p><span>{l}</span></p></Text></DetailTxt></CompleteText></Description></Item>'
        for r, s, l, q, u in items)
    return (f'<?xml version="1.0" encoding="UTF-8"?><GAEB xmlns="http://www.gaeb.de/GAEB_DA_XML/DA83/3.2"><PrjInfo><LblPrj>{name}</LblPrj></PrjInfo>'
            f'<Award><DP>83</DP><BoQ><BoQBody><BoQCtgy RNoPart="01"><LblTx><p><span>{trade}</span></p></LblTx><BoQBody>'
            f'<Itemlist>{body}</Itemlist></BoQBody></BoQCtgy></BoQBody></BoQ></Award></GAEB>').encode()


FLOOR = x83("Boden", [("0001", "PVC-Belag", "Bodenbelag aus PVC verlegen", 100, "m2"), ("0002", "Sockel", "Sockelleiste ca. 5 cm", 40, "m"),
                      ("0003", "Reinigung", "Bauendreinigung nach Angabe der Bauleitung", 1, "psch"), ("0004", "Schutz", "Schutzfolie liefern", 100, "m2"),
                      ("0005", "Fuge", "Fugenprofil einbauen", 12, "m")], "Bodenbelag")
SCREED = x83("Estrich", [("0001", "Spachtelung", "Untergrund spachteln und grundieren", 100, "m2"), ("0002", "Estrich", "Zementestrich 5 cm", 100, "m2"),
                         ("0003", "Randstreifen", "Randdämmstreifen und Bewegungsfugen", 40, "m"), ("0004", "Trennlage", "PE-Folie", 100, "m2"),
                         ("0005", "Abnahme", "Abnahme", 1, "psch")], "Estrich")


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "DATA_DIR", tmp_path)
    from calex.app import app
    return TestClient(app)


def mk(c, name="Test"):
    r = c.post("/api/projects", json={"name": name})
    assert r.status_code == 201
    return r.json()["id"]


def up(c, pid, *named):
    return c.post(f"/api/projects/{pid}/files", files=[("files", (n, d, "application/xml")) for n, d in named])


def test_project_lifecycle_and_validation(client):
    assert client.get("/api/projects").json() == []
    assert client.post("/api/projects", json={"name": ""}).status_code == 422
    assert client.post("/api/projects", json={"name": "   "}).status_code == 422
    pid = mk(client, "Schule Neubau")
    assert client.get(f"/api/projects/{pid}").json()["name"] == "Schule Neubau"
    assert client.patch(f"/api/projects/{pid}", json={"description": "Turnhalle"}).json()["description"] == "Turnhalle"
    assert [p["id"] for p in client.get("/api/projects").json()] == [pid]
    assert client.get("/api/projects/nope").status_code == 404
    assert client.delete(f"/api/projects/{pid}").status_code == 204
    assert client.get(f"/api/projects/{pid}").status_code == 404


def test_upload_stores_metadata_keeps_unreadable_files_and_rejects_bad_types(client):
    pid = mk(client)
    r = up(client, pid, ("boden.X83", FLOOR)).json()
    f = r["files"][0]
    assert f["items"] == 5 and f["phase"] == "tender" and f["error"] == ""
    bad = up(client, pid, ("kaputt.x83", b"not xml at all")).json()["files"][0]
    assert bad["error"] and bad["items"] == 0           # kept, with the reason
    assert client.post(f"/api/projects/{pid}/files", files=[("files", ("a.exe", b"MZ", "application/octet-stream"))]).status_code == 415
    assert len(client.get(f"/api/projects/{pid}/files").json()) == 2
    assert client.delete(f"/api/projects/{pid}/files/{f['id']}").status_code == 204
    assert len(client.get(f"/api/projects/{pid}/files").json()) == 1
    assert client.get(f"/api/projects/{pid}").json()["files"] == 1


def test_analysis_is_saved_and_reopenable(client):
    pid = mk(client)
    fid = up(client, pid, ("boden.X83", FLOOR)).json()["files"][0]["id"]
    a = client.post(f"/api/projects/{pid}/analyses", json={"file_ids": [fid], "use_llm": False})
    assert a.status_code == 201
    meta = a.json()
    assert meta["file_ids"] == [fid] and meta["summary"]["items"] == 5 and meta["llm_status"] == "skipped"
    full = client.get(f"/api/projects/{pid}/analyses/{meta['id']}").json()
    assert full["report"]["project"]["items"] == 5 and full["report"]["files"][0]["name"] == "boden.X83"
    assert [m["id"] for m in client.get(f"/api/projects/{pid}/analyses").json()] == [meta["id"]]
    assert client.get(f"/api/projects/{pid}").json()["analyses"] == 1
    assert client.delete(f"/api/projects/{pid}/analyses/{meta['id']}").status_code == 204
    assert client.get(f"/api/projects/{pid}/analyses/{meta['id']}").status_code == 404


def test_analysis_needs_readable_files_and_valid_ids(client):
    pid = mk(client)
    assert client.post(f"/api/projects/{pid}/analyses", json={"use_llm": False}).status_code == 422
    up(client, pid, ("kaputt.x83", b"garbage"))
    assert client.post(f"/api/projects/{pid}/analyses", json={"use_llm": False}).status_code == 422
    assert client.post(f"/api/projects/{pid}/analyses", json={"file_ids": ["zzz"], "use_llm": False}).status_code == 404


def test_multi_file_analysis_sees_other_trades(client):
    """The floor file alone lacks substrate preparation; together with the screed file the rule must not fire."""
    pid = mk(client)
    ids = [f["id"] for f in up(client, pid, ("boden.X83", FLOOR), ("estrich.X83", SCREED)).json()["files"]]
    alone = client.post(f"/api/projects/{pid}/analyses", json={"file_ids": [ids[0]], "use_llm": False}).json()["id"]
    both = client.post(f"/api/projects/{pid}/analyses", json={"file_ids": ids, "use_llm": False}).json()["id"]
    rep_alone = client.get(f"/api/projects/{pid}/analyses/{alone}").json()["report"]
    rep_both = client.get(f"/api/projects/{pid}/analyses/{both}").json()["report"]
    assert any(f["category"] == "missing" for f in rep_alone["findings"])
    assert not any(f["category"] == "missing" and "Floor covering" in f["message"] for f in rep_both["findings"])
    assert rep_both["project"]["items"] == 10 and all("/" in i["oz"] for i in rep_both["all_items"])


def test_bidsheet_persists_prices_and_whatif_can_use_them(client):
    pid = mk(client)
    fid = up(client, pid, ("boden.X83", FLOOR)).json()["files"][0]["id"]
    sheet = client.get(f"/api/projects/{pid}/files/{fid}/bidsheet").json()
    assert len(sheet["items"]) == 5 and sheet["prices"] == {}
    prices = {i["oz"]: 10.0 for i in sheet["items"] if i["quantity"]}
    assert client.put(f"/api/projects/{pid}/files/{fid}/bidsheet", json={"prices": prices, "markup": 7}).status_code == 200
    again = client.get(f"/api/projects/{pid}/files/{fid}/bidsheet").json()
    assert again["prices"] == prices and again["markup"] == 7
    no_bid = client.post(f"/api/projects/{pid}/whatif", json={"file_id": fid, "scenarios": [{"component": "price", "pct": 10}]})
    assert no_bid.status_code == 422                                   # unpriced tender
    r = client.post(f"/api/projects/{pid}/whatif", json={"file_id": fid, "use_bid": True, "scenarios": [{"component": "price", "pct": 10}]}).json()
    assert r["baseline"] == pytest.approx(10 * (100 + 40 + 1 + 100 + 12)) and r["delta_pct"] == pytest.approx(10.0)


def test_compare_checks_project_membership(client):
    pid, other = mk(client), mk(client, "Other")
    fid = up(client, pid, ("boden.X83", FLOOR)).json()["files"][0]["id"]
    ofid = up(client, other, ("e.X83", SCREED)).json()["files"][0]["id"]
    assert client.post(f"/api/projects/{pid}/compare", json={"tender_file_id": fid, "award_file_id": ofid}).status_code == 404
    ok = client.post(f"/api/projects/{pid}/compare", json={"tender_file_id": fid, "award_file_id": fid})
    assert ok.status_code == 200 and ok.json()["added"] == []


def test_deleting_a_project_removes_its_files(client, tmp_path):
    pid = mk(client)
    up(client, pid, ("boden.X83", FLOOR))
    folder = tmp_path / "files" / pid
    assert folder.exists() and any(folder.iterdir())
    client.delete(f"/api/projects/{pid}")
    assert not folder.exists()


def test_excel_and_word_upload_and_analysis_through_the_api(client):
    import io
    from openpyxl import Workbook
    wb = Workbook(); ws = wb.active
    for r in [["OZ", "Kurztext", "Menge", "Einheit"], ["1.1", "Aushub nach Angabe der Bauleitung", 10, "m3"], ["1.2", "Rohr DN 100 liefern und verlegen", 5, "m"],
              ["1.3", "Beton", 3, "m3"], ["1.4", "Schalung", 3, "m2"], ["1.5", "Bewehrung", 1, "t"]]:
        ws.append(r)
    buf = io.BytesIO(); wb.save(buf)
    pid = mk(client)
    r = client.post(f"/api/projects/{pid}/files", files=[("files", ("lv.xlsx", buf.getvalue(), "application/vnd.ms-excel"))]).json()
    f = r["files"][0]
    assert f["items"] == 5 and f["error"] == "" and f["ext"] == "xlsx"
    a = client.post(f"/api/projects/{pid}/analyses", json={"file_ids": [f["id"]], "use_llm": False})
    assert a.status_code == 201 and a.json()["summary"]["items"] == 5
    bad = client.post(f"/api/projects/{pid}/files", files=[("files", ("alt.xls", b"x", "application/vnd.ms-excel"))])
    assert bad.status_code == 415


def test_same_boq_at_two_stages_is_not_merged_without_confirmation(client):
    pid = mk(client)
    a = up(client, pid, ("tender.X83", FLOOR)).json()["files"][0]["id"]
    b = up(client, pid, ("tender_copy.X83", FLOOR)).json()["files"][0]["id"]    # same items and texts again
    r = client.post(f"/api/projects/{pid}/analyses", json={"file_ids": [a, b], "use_llm": False})
    assert r.status_code == 409
    d = r.json()["detail"]
    assert d["code"] == "overlap" and d["pairs"][0]["ratio"] >= 0.6 and {d["pairs"][0]["a_id"], d["pairs"][0]["b_id"]} == {a, b}
    ok = client.post(f"/api/projects/{pid}/analyses", json={"file_ids": [a, b], "use_llm": False, "allow_overlap": True})
    assert ok.status_code == 201 and ok.json()["summary"]["items"] == 10          # confirmed: both lists are merged
    single = client.post(f"/api/projects/{pid}/analyses", json={"file_ids": [a], "use_llm": False})
    assert single.status_code == 201


def test_different_trades_with_the_same_item_numbers_are_not_overlaps(client):
    pid = mk(client)
    ids = [f["id"] for f in up(client, pid, ("boden.X83", FLOOR), ("estrich.X83", SCREED)).json()["files"]]   # same numbering, different texts
    r = client.post(f"/api/projects/{pid}/analyses", json={"file_ids": ids, "use_llm": False})
    assert r.status_code == 201


def _award_of(tender: bytes) -> bytes:
    """The same BoQ as an award with unit prices (what a later stage of one tender looks like)."""
    import re
    x = tender.decode().replace("<DP>83</DP>", "<DP>86</DP>")
    return re.sub(r"(<QU>[^<]*</QU>)", r"\1<UP>10.0</UP><IT>1000.0</IT>", x).encode()


def test_plan_tender_only_runs_just_the_risk_analysis(client):
    pid = mk(client)
    fid = up(client, pid, ("boden.X83", FLOOR)).json()["files"][0]["id"]
    p = client.get(f"/api/projects/{pid}/plan").json()
    assert p["risk"]["file_ids"] == [fid] and p["compare"] == [] and p["whatif"] == [] and p["already_done"] is None
    client.post(f"/api/projects/{pid}/analyses", json={"file_ids": [fid], "use_llm": False})
    assert client.get(f"/api/projects/{pid}/plan").json()["already_done"]["use_llm"] is False


def test_plan_tender_plus_award_adds_compare_and_whatif_but_keeps_the_award_out_of_the_risk_run(client):
    pid = mk(client)
    ids = [f["id"] for f in up(client, pid, ("tender.X83", FLOOR), ("award.X86", _award_of(FLOOR))).json()["files"]]
    p = client.get(f"/api/projects/{pid}/plan").json()
    assert p["risk"]["file_ids"] == [ids[0]]                                   # only the tender is risk-analysed
    assert [(c["tender_id"], c["later_id"]) for c in p["compare"]] == [(ids[0], ids[1])]
    assert [w["file_id"] for w in p["whatif"]] == [ids[1]] and p["later"][0]["phase"] == "award"


def test_plan_for_several_different_trades_analyses_them_together_and_does_not_compare(client):
    pid = mk(client)
    ids = [f["id"] for f in up(client, pid, ("boden.X83", FLOOR), ("estrich.X83", SCREED)).json()["files"]]
    p = client.get(f"/api/projects/{pid}/plan").json()
    assert set(p["risk"]["file_ids"]) == set(ids) and p["compare"] == [] and p["duplicates"] == []


def test_plan_ignores_a_duplicate_upload_and_handles_an_empty_project(client):
    pid = mk(client)
    assert client.get(f"/api/projects/{pid}/plan").json()["risk"]["file_ids"] == []
    a = up(client, pid, ("a.X83", FLOOR)).json()["files"][0]["id"]
    up(client, pid, ("a_copy.X83", FLOOR))
    p = client.get(f"/api/projects/{pid}/plan").json()
    assert p["risk"]["file_ids"] == [a] and p["duplicates"][0]["ignored"] == "a_copy.X83"
    assert client.get("/api/projects/nope/plan").status_code == 404


def _benchmarks_for(boq_bytes):
    from calex.benchmarks import Benchmarks
    from calex.parsers import parse_file
    from calex.models import Project
    pr = parse_file("hist.X83", boq_bytes)
    for n, it in enumerate(pr.items):
        it.unit_price = 10.0 + n
    b = Benchmarks()
    b.add_project(Project(items=pr.items, source="history.X84"), "history.X84", group="other-project")
    return b


def test_whatif_on_a_tender_needs_prices_and_uses_bid_prices_or_benchmarks(client, monkeypatch):
    from calex import api_projects
    pid = mk(client)
    fid = up(client, pid, ("tender.X83", FLOOR)).json()["files"][0]["id"]
    scen = [{"component": "price", "pct": 10}]
    # nothing priced yet: a clear message that says what to do
    r = client.post(f"/api/projects/{pid}/whatif", json={"file_id": fid, "scenarios": scen})
    assert r.status_code == 422 and "Bid sheet" in r.json()["detail"]
    # indicative benchmark prices
    monkeypatch.setattr(api_projects, "bench", lambda: _benchmarks_for(FLOOR))
    b = client.post(f"/api/projects/{pid}/whatif", json={"file_id": fid, "scenarios": scen, "use_benchmark": True}).json()
    assert b["basis"]["benchmark_items"] >= 2 and b["basis"]["bid_items"] == 0 and b["baseline"] > 0
    # the user's own bid prices win over benchmarks
    sheet = client.get(f"/api/projects/{pid}/files/{fid}/bidsheet").json()
    client.put(f"/api/projects/{pid}/files/{fid}/bidsheet", json={"prices": {i["oz"]: 5.0 for i in sheet["items"]}, "markup": 0})
    both = client.post(f"/api/projects/{pid}/whatif", json={"file_id": fid, "scenarios": scen, "use_bid": True, "use_benchmark": True}).json()
    assert both["basis"]["bid_items"] == 5 and both["basis"]["benchmark_items"] == 0


def test_plan_for_a_tender_picks_bid_prices_then_benchmarks_or_reports_blocked(client, monkeypatch):
    from calex import api_projects
    pid = mk(client)
    fid = up(client, pid, ("tender.X83", FLOOR)).json()["files"][0]["id"]
    monkeypatch.setattr(api_projects, "bench", lambda: _benchmarks_for(SCREED))          # history of a different BoQ: no matches
    p = client.get(f"/api/projects/{pid}/plan").json()
    assert p["whatif"] == [] and p["whatif_blocked"] == [{"name": "tender.X83", "reason": "no_prices"}] and p["estimates"] == []
    monkeypatch.setattr(api_projects, "bench", lambda: _benchmarks_for(FLOOR))
    p = client.get(f"/api/projects/{pid}/plan").json()
    assert p["estimates"][0]["matched"] >= 2 and p["estimates"][0]["total"] > 0
    assert p["whatif"] == [] or p["whatif"][0]["basis"] == "benchmark"       # only 5 items: below the 10-item bar for an automatic what-if
    sheet = client.get(f"/api/projects/{pid}/files/{fid}/bidsheet").json()
    client.put(f"/api/projects/{pid}/files/{fid}/bidsheet", json={"prices": {i["oz"]: 7.0 for i in sheet["items"]}, "markup": 0})
    p = client.get(f"/api/projects/{pid}/plan").json()
    assert p["whatif"][0]["basis"] == "bid" and p["whatif_blocked"] == []


def test_a_single_stray_benchmark_match_is_not_shown_as_an_estimate(client, monkeypatch):
    from calex import api_projects
    from calex.benchmarks import Benchmarks
    from calex.models import Item, Project
    pid = mk(client)
    words = [f"{chr(97 + n // 26)}{chr(97 + n % 26)}xyzwort" for n in range(30)]        # 30 items with distinct vocabulary
    items = [(f"{n + 1:04d}", f"Leistung {w}", f"Bauteil {w} einbauen", 10 + n, "m2") for n, w in enumerate(words)]
    up(client, pid, ("big.X83", x83("Gross", items)))
    b = Benchmarks()
    b.add_project(Project(items=[Item("9.9", f"Leistung {words[4]}", f"Bauteil {words[4]} einbauen", 1, "m2", unit_price=42.0)]), "h.X84", group="other")
    monkeypatch.setattr(api_projects, "bench", lambda: b)
    p = client.get(f"/api/projects/{pid}/plan").json()
    assert p["estimates"] == [] and p["whatif"] == [] and p["whatif_blocked"][0]["reason"] == "no_prices"
