"""Bid generation: priced X84 round trip, offer context, markup rule, Word offer."""
import io
import zipfile
import pytest
from fastapi.testclient import TestClient

from calex import store, bidgen
from calex.parsers import parse_file
from test_projects_api import FLOOR, mk


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "DATA_DIR", tmp_path)
    from calex.app import app
    return TestClient(app)


def upload(c, pid, name, data):
    return c.post(f"/api/projects/{pid}/files", files=[("files", (name, data, "application/octet-stream"))]).json()["files"][0]


def test_x84_roundtrip_keeps_everything_but_prices_and_phase():
    proj = parse_file("f.x83", FLOOR)
    prices = {i.oz: 10.0 + n for n, i in enumerate(proj.items)}
    data, info = bidgen.x84_from_x83(FLOOR, proj, prices, markup_pct=10.0)
    back = parse_file("f.x84", data)
    assert back.phase == "bid" and [i.oz for i in back.items] == [i.oz for i in proj.items]
    assert [i.short_text for i in back.items] == [i.short_text for i in proj.items]
    assert [i.quantity for i in back.items] == [i.quantity for i in proj.items]
    assert back.items[0].unit_price == 11.0 and back.items[0].total_price == 1100.0          # 10.00 + 10 % markup, times 100 m2
    assert info["priced"] == 5 and info["unpriced"] == 0
    assert data.replace(b"<DP>84</DP>", b"<DP>83</DP>").count(b"<Item ") == FLOOR.count(b"<Item ")


def test_x84_rejects_non_tender_and_unmatched_structure():
    proj = parse_file("f.x83", FLOOR)
    bid, _ = bidgen.x84_from_x83(FLOOR, proj, {proj.items[0].oz: 5.0})
    again, info = bidgen.x84_from_x83(bid, parse_file("b.x84", bid), {proj.items[0].oz: 6.0})     # re-pricing an earlier bid works
    assert parse_file("c.x84", again).items[0].unit_price == 6.0 and info["priced"] == 1
    with pytest.raises(bidgen.ExportError):
        bidgen.x84_from_x83(bid.replace(b"<DP>84</DP>", b"<DP>86</DP>"), proj, {})                   # an award is not a bid to price
    with pytest.raises(bidgen.ExportError):
        bidgen.x84_from_x83(b"<GAEB><nothing/></GAEB>", proj, {})


def test_x84_endpoint_needs_prices_and_x83(client):
    pid = mk(client)
    f = upload(client, pid, "floor.X83", FLOOR)
    assert client.get(f"/api/projects/{pid}/files/{f['id']}/bid.x84").status_code == 422        # no prices yet
    items = client.get(f"/api/projects/{pid}/files/{f['id']}/bidsheet").json()["items"]
    client.put(f"/api/projects/{pid}/files/{f['id']}/bidsheet", json={"prices": {i["oz"]: 20.0 for i in items}, "markup": 5})
    r = client.get(f"/api/projects/{pid}/files/{f['id']}/bid.x84")
    assert r.status_code == 200 and r.headers["X-Calex-Priced"] == "5"
    back = parse_file("x.x84", r.content)
    assert back.phase == "bid" and back.items[0].unit_price == 21.0                              # 20 + 5 %
    assert client.get(f"/api/projects/{pid}/files/{f['id']}/bid.x84?include_markup=false").content != r.content
    pdf = upload(client, pid, "x.docx", b"not a real docx")                                     # unreadable: kept as failed
    assert client.get(f"/api/projects/{pid}/files/{pdf['id']}/bid.x84").status_code == 422


def test_markup_hint_only_counts_unresolved_findings():
    fs = [{"id": "a", "severity": "high"}, {"id": "b", "severity": "high"}, {"id": "c", "severity": "medium"}]
    base = bidgen.markup_hint(fs, {})
    assert base["open_high"] == 2 and base["open_medium"] == 1 and base["low"] == 2.7 and base["high"] == 4.7
    cleared = bidgen.markup_hint(fs, {"a": {"status": "dismissed"}, "b": {"status": "reviewed"}})
    assert cleared["open_high"] == 0 and cleared["low"] == 2.1


def test_offer_context_and_word_offer(client):
    pid = mk(client)
    f = upload(client, pid, "floor.X83", FLOOR)
    items = client.get(f"/api/projects/{pid}/files/{f['id']}/bidsheet").json()["items"]
    client.put(f"/api/projects/{pid}/files/{f['id']}/bidsheet", json={"prices": {i["oz"]: 10.0 for i in items[:3]}, "markup": 8})
    a = client.post(f"/api/projects/{pid}/analyses", json={"file_ids": [f["id"]], "use_llm": False}).json()
    rep = client.get(f"/api/projects/{pid}/analyses/{a['id']}").json()["report"]
    fid = rep["findings"][0]["id"]
    client.put(f"/api/projects/{pid}/triage/{fid}", json={"status": "clarify", "note": "ask the client"})
    ctx = client.get(f"/api/projects/{pid}/files/{f['id']}/offer-context").json()
    assert ctx["markup"] == 8 and ctx["priced"] == 3 and ctx["items"] == 5 and len(ctx["unpriced"]) == 2
    assert ctx["markup_hint"]["low"] >= 2.0 and any(c["id"] == fid for c in ctx["clarifications"])
    r = client.post(f"/api/projects/{pid}/files/{f['id']}/offer.docx", json={"vat_pct": 19, "validity_days": 45, "assumptions": ["Annahme A"]})
    assert r.status_code == 200
    xml = zipfile.ZipFile(io.BytesIO(r.content)).read("word/document.xml").decode()
    assert "Angebotssumme brutto" in xml and "Annahme A" in xml and "45 Kalendertage" in xml


def _priced_bid_project(client, name):
    """A project whose bid prices become history for other projects."""
    from calex import bidgen
    pid = mk(client, name)
    proj = parse_file("t.x83", FLOOR)
    bid, _ = bidgen.x84_from_x83(FLOOR, proj, {i.oz: 10.0 + n for n, i in enumerate(proj.items)})
    # ten priced items are needed to count as history: repeat the BoQ items under new numbers
    from test_projects_api import x83
    names = ["PVC-Belag Designoptik", "Linoleum Naturfarbe", "Parkettboden Eichenholz", "Teppichfliesen Schlingenware", "Kautschukbelag Noppenprofil", "Vinylboden Klicksystem",
             "Fliesenbelag Feinsteinzeug", "Laminatboden Nutzungsklasse", "Natursteinplatten Granit", "Zementestrich Verbundestrich", "Spachtelmasse Nivelliermasse", "Sockelleisten Hartholz"]
    big = x83("Boden", [(f"{n:04d}", name, f"{name} im Dünnbett einbauen, Ausführung nach Herstellerangabe {n}", 10 + n, "m2") for n, name in enumerate(names, 1)], "Bodenbelag")
    p2 = parse_file("t.x83", big)
    priced, _ = bidgen.x84_from_x83(big, p2, {i.oz: 20.0 + n for n, i in enumerate(p2.items)})
    upload(client, pid, "old_bid.X84", priced)
    return pid, big


def test_history_comes_from_the_projects_the_user_picks(client):
    from calex import bidgen
    old, big = _priced_bid_project(client, "Old job")
    new = mk(client, "New tender")
    upload(client, new, "new.X83", big)                              # same kind of items, no prices
    h = client.get(f"/api/projects/{new}/history").json()
    src = [s for s in h["sources"] if s["kind"] == "project"]
    assert [s["name"] for s in src] == ["Old job"] and src[0]["selected"] and src[0]["items"] >= 10
    plan = client.get(f"/api/projects/{new}/plan").json()
    assert plan["estimates"] and plan["estimates"][0]["matched"] >= 10                 # the old job's prices feed the estimate
    h = client.put(f"/api/projects/{new}/history", json={"projects": [], "dataset": False}).json()
    assert not [x for x in h["sources"] if x["kind"] == "project"][0]["selected"]
    assert client.get(f"/api/projects/{new}/plan").json()["estimates"] == []          # deselected: no history, no estimate
    sheet = client.get(f"/api/projects/{new}/files/{client.get(f'/api/projects/{new}/files').json()[0]['id']}/bidsheet").json()
    assert sheet["coverage"]["matched"] == 0
    client.put(f"/api/projects/{new}/history", json={"projects": [old], "dataset": False})
    sheet = client.get(f"/api/projects/{new}/files/{client.get(f'/api/projects/{new}/files').json()[0]['id']}/bidsheet").json()
    assert sheet["coverage"]["matched"] >= 10 and sheet["coverage"]["sources"] == ["Old job"]


def test_a_project_is_not_matched_with_its_own_prices_unless_asked(client):
    old, big = _priced_bid_project(client, "Only job")
    assert [x for x in client.get(f"/api/projects/{old}/history").json()["sources"] if x["kind"] == "project"] == []     # no other project to learn from
    pid = mk(client, "Second")
    upload(client, pid, "same_boq_unpriced.X83", big)
    h = client.get(f"/api/projects/{pid}/history").json()
    assert [x["name"] for x in h["sources"] if x["kind"] == "project"] == ["Only job"]
