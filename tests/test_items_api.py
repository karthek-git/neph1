"""Stored parsed items (A), editing/confirm/re-parse (B) and the AI extraction fallback (C)."""
import pytest
from fastapi.testclient import TestClient

from calex import store, extract, llm
from test_projects_api import FLOOR, x83, mk, up


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "DATA_DIR", tmp_path)
    from calex.app import app
    return TestClient(app)


def upload(c, pid, name, data):
    r = c.post(f"/api/projects/{pid}/files", files=[("files", (name, data, "application/octet-stream"))])
    return r.json()["files"][0] if r.status_code == 201 else r


def test_items_are_stored_with_quality_status(client):
    pid = mk(client)
    f = upload(client, pid, "floor.X83", FLOOR)
    assert f["status"] in ("ok", "check") and f["source"] == "parser" and f["confirmed"] is True and f["edited"] is False
    got = client.get(f"/api/projects/{pid}/files/{f['id']}/items").json()
    assert len(got["items"]) == 5 and got["items"][0]["oz"].endswith("0001")


def test_unreadable_file_is_failed_and_kept(client):
    pid = mk(client)
    f = upload(client, pid, "broken.X83", b"<?xml version='1.0'?><GAEB><oops")
    assert f["status"] == "failed" and f["error"]
    assert client.get(f"/api/projects/{pid}/files/{f['id']}/items").json()["items"] == []


def test_edit_changes_what_the_analysis_reads_and_reparse_restores(client):
    pid = mk(client)
    f = upload(client, pid, "floor.X83", FLOOR)
    rows = client.get(f"/api/projects/{pid}/files/{f['id']}/items").json()["items"]
    rows[0]["quantity"] = 250.0
    rows.append({"oz": "99.9999", "short_text": "Neue Position", "quantity": 3, "unit": "St"})
    r = client.put(f"/api/projects/{pid}/files/{f['id']}/items", json={"items": rows})
    assert r.status_code == 200 and r.json()["file"]["edited"] is True and r.json()["file"]["items"] == 6
    sheet = client.get(f"/api/projects/{pid}/files/{f['id']}/bidsheet").json()
    assert sheet["items"][0]["quantity"] == 250.0 and len(sheet["items"]) == 6
    back = client.post(f"/api/projects/{pid}/files/{f['id']}/reparse").json()
    assert back["file"]["edited"] is False and back["file"]["items"] == 5 and back["items"][0]["quantity"] == 100.0


def test_edit_rejects_empty_list_and_bad_item(client):
    pid = mk(client)
    f = upload(client, pid, "floor.X83", FLOOR)
    assert client.put(f"/api/projects/{pid}/files/{f['id']}/items", json={"items": []}).status_code == 422
    assert client.put(f"/api/projects/{pid}/files/{f['id']}/items", json={"items": [{"oz": ""}]}).status_code == 422


SRC = ("Leistungsverzeichnis Estrich\n01.01.0010  Zementestrich 5 cm einbauen\n   Untergrund sauber, Estrich CT-C25-F4\n"
       "   120,000 m2   45,50   5.460,00\n01.01.0020  Randdaemmstreifen liefern und einbauen\n   40,000 m   3,20   128,00\n" * 1).encode()


def test_validate_drops_items_not_found_in_source():
    chunk = SRC.decode()
    good = extract.Extracted(oz="01.01.0010", short_text="Zementestrich 5 cm einbauen", quantity=120, unit="m2", unit_price=45.5, total_price=5460)
    fake_text = extract.Extracted(oz="01.01.0030", short_text="Fliesen verlegen im Dünnbett", quantity=10, unit="m2")
    fake_number = extract.Extracted(oz="01.01.0020", short_text="Randdaemmstreifen liefern und einbauen", quantity=999, unit="m")
    fake_unit = extract.Extracted(oz="01.01.0020", short_text="Randdaemmstreifen liefern", quantity=40, unit="kg")
    keep, dropped = extract.validate([good, fake_text, fake_number, fake_unit], chunk)
    assert [i.oz for i in keep] == ["01.01.0010"] and dropped == 3
    assert keep[0].unit_price == 45.5 and keep[0].kind == "normal"


def test_ai_fallback_extracts_validated_items_and_marks_unconfirmed(client, monkeypatch):
    monkeypatch.setattr(llm, "available", lambda: True)
    monkeypatch.setattr(llm, "_call", lambda prompt, **kw: [
        extract.Extracted(oz="01.01.0010", short_text="Zementestrich 5 cm einbauen", quantity=120, unit="m2", unit_price=45.5, total_price=5460),
        extract.Extracted(oz="01.01.0020", short_text="Randdaemmstreifen liefern und einbauen", quantity=40, unit="m"),
        extract.Extracted(oz="01.01.0099", short_text="Erfundene Position", quantity=1, unit="St")])
    pid = mk(client)
    # a file the parsers cannot read at all: broken XML containing the BoQ text
    broken = b"<?xml version='1.0'?><GAEB><oops>" + SRC
    f = upload(client, pid, "broken.X83", broken)
    assert f["status"] == "failed"
    r = client.post(f"/api/projects/{pid}/files/{f['id']}/extract")
    assert r.status_code == 200, r.text
    out = r.json()
    assert [i["oz"] for i in out["items"]] == ["01.01.0010", "01.01.0020"] and out["stats"]["dropped"] == 1
    assert out["file"]["source"] == "ai" and out["file"]["confirmed"] is False and out["file"]["status"] == "check" and not out["file"]["error"]
    # an analysis is allowed, with the unconfirmed file reported
    a = client.post(f"/api/projects/{pid}/analyses", json={"file_ids": [f["id"]], "use_llm": False}).json()
    rep = client.get(f"/api/projects/{pid}/analyses/{a['id']}").json()["report"]
    assert rep["unconfirmed_files"] == ["broken.X83"]
    ok = client.post(f"/api/projects/{pid}/files/{f['id']}/confirm").json()
    assert ok["file"]["confirmed"] is True and ok["file"]["status"] == "ok"


def test_ai_fallback_without_key_is_a_clear_error(client, monkeypatch):
    monkeypatch.setattr(llm, "available", lambda: False)
    pid = mk(client)
    f = upload(client, pid, "broken.X83", b"<?xml version='1.0'?><GAEB><oops")
    r = client.post(f"/api/projects/{pid}/files/{f['id']}/extract")
    assert r.status_code == 422 and "not configured" in r.json()["detail"]


def test_source_text_for_original_panel(client):
    pid = mk(client)
    f = upload(client, pid, "floor.X83", FLOOR)
    assert "PVC" in client.get(f"/api/projects/{pid}/files/{f['id']}/source").json()["text"]


def test_older_file_without_stored_items_is_backfilled(client):
    pid = mk(client)
    f = upload(client, pid, "floor.X83", FLOOR)
    with store.db() as c:
        c.execute("DELETE FROM file_items WHERE file_id=?", (f["id"],))
    assert client.get(f"/api/projects/{pid}/files/{f['id']}/items").json()["items"]
