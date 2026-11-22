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
