"""Price catalog: entries, import, adjustments, suggestions learned from projects (accepted only by the user), precedence."""
import io
from datetime import date, timedelta
import pytest
from fastapi.testclient import TestClient

from calex import store, catalog
from test_projects_api import mk, x83
from test_bid import _priced_bid_project, upload


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "DATA_DIR", tmp_path)
    monkeypatch.setattr("calex.api_projects.bench", lambda: __import__("calex.benchmarks", fromlist=["Benchmarks"]).Benchmarks())   # no dataset folder in these tests
    from calex.app import app
    return TestClient(app)


E = {"description": "Bodenbelag aus PVC verlegen", "unit": "m2", "price": 20.0, "source": "House prices", "price_date": "2024-01-01"}


def test_entry_crud_and_validation(client):
    r = client.post("/api/catalog", json=E)
    assert r.status_code == 201 and r.json()["adjusted_price"] == 20.0         # no adjustments yet
    eid = r.json()["id"]
    assert client.put(f"/api/catalog/{eid}", json={**E, "price": 22.5}).json()["price"] == 22.5
    assert client.post("/api/catalog", json={**E, "description": "ab"}).status_code == 422      # too short to match
    assert client.post("/api/catalog", json={**E, "price": 0}).status_code == 422
    assert client.post("/api/catalog", json={**E, "price_date": "01.01.2024"}).status_code == 422
    assert client.delete(f"/api/catalog/{eid}").status_code == 204 and client.get("/api/catalog").json()["entries"] == []
    log = client.get("/api/catalog/log").json()
    assert [x["action"] for x in log][:3] == ["deleted", "price changed", "added"]


def test_adjustments_bring_old_prices_to_today(client):
    two_years_ago = (date.today() - timedelta(days=int(365.25 * 2))).isoformat()
    client.post("/api/catalog", json={**E, "price_date": two_years_ago})
    assert client.put("/api/catalog/settings", json={"yearly_increase_pct": 5, "region_factor": 1.1}).status_code == 200
    adj = client.get("/api/catalog").json()["entries"][0]["adjusted_price"]
    assert abs(adj - round(20 * 1.05 ** 2 * 1.1, 2)) < 0.1
    assert client.put("/api/catalog/settings", json={"yearly_increase_pct": 5, "region_factor": 9}).status_code == 422


def test_import_csv_with_german_headers_and_skips_bad_rows(client):
    csv_text = "Beschreibung;Einheit;EP;Quelle;Preisstand\nBodenbelag aus PVC verlegen;m2;18,50;Preisbuch;01.03.2025\nPVC;m2;5;x;\nEstrich Zement 5 cm einbauen;m2;24,00;Preisbuch;2025-03-01\n"
    r = client.post("/api/catalog/import", files={"file": ("preise.csv", csv_text.encode("utf-8"), "text/csv")})
    assert r.status_code == 200 and r.json()["added"] == 2 and r.json()["skipped_count"] == 1
    entries = {e["description"]: e for e in client.get("/api/catalog").json()["entries"]}
    assert entries["Bodenbelag aus PVC verlegen"]["price"] == 18.5 and entries["Bodenbelag aus PVC verlegen"]["price_date"] == "2025-03-01"
    assert client.post("/api/catalog/import", files={"file": ("x.csv", b"foo;bar\n1;2\n", "text/csv")}).status_code == 422


def test_catalog_prices_reach_the_benchmark_hints_with_precedence(client):
    from calex.api_projects import bench_for
    from calex.benchmarks import hints_for
    from calex.parsers import parse_file
    client.post("/api/catalog", json={"description": "Parkettboden Eichenholz im Dünnbett einbauen, Ausführung nach Herstellerangabe", "unit": "m2", "price": 99.0, "source": "House", "price_date": ""})
    old, big = _priced_bid_project(client, "Old job")                    # history prices the same kind of item at about 20 EUR
    new = mk(client, "New")
    upload(client, new, "new.X83", big)
    h = hints_for(parse_file("new.x83", big), bench_for(new))["hints"]
    parkett = h["01.0003"]                                                # the Parkettboden item
    assert parkett["matches"][0]["source"].startswith("Catalog") and parkett["matches"][0]["unit_price"] == 99.0      # the catalog entry ranks first
    assert any(m["source"].startswith("Old job") for m in parkett["matches"])                                         # history still contributes


def test_suggestions_new_and_changed_are_only_applied_when_accepted(client):
    old, big = _priced_bid_project(client, "Old job")
    s = client.get("/api/catalog/suggestions").json()
    assert s["new_total"] >= 5 and s["update_total"] == 0 and client.get("/api/catalog").json()["entries"] == []     # nothing applied yet
    pick = s["new"][:2]
    r = client.post("/api/catalog/suggestions/accept", json={"items": pick}).json()
    assert r["added"] == 2 and len(client.get("/api/catalog").json()["entries"]) == 2
    s2 = client.get("/api/catalog/suggestions").json()
    assert s2["new_total"] <= s["new_total"] - 2 + 1                       # accepted ones no longer count as new
    # the history now says something different: a price difference is proposed as an update
    e = client.get("/api/catalog").json()["entries"][0]
    client.put(f"/api/catalog/{e['id']}", json={"description": e["description"], "unit": e["unit"], "price": e["price"] * 3, "source": "x", "price_date": ""})
    ups = client.get("/api/catalog/suggestions").json()["update"]
    assert any(u["entry_id"] == e["id"] and u["diff_pct"] < -50 for u in ups)
    # rejecting hides a suggestion for good
    k = s2["new"][0]["key"]
    client.post("/api/catalog/suggestions/reject", json={"keys": [k]})
    assert all(x["key"] != k for x in client.get("/api/catalog/suggestions").json()["new"])
    log = client.get("/api/catalog/log").json()
    assert any("learned from" in (x["source"] or "") for x in log)


def test_suggestions_skip_anonymisation_placeholders():
    from calex.benchmarks import Benchmarks, Entry, tokens
    h = Benchmarks()
    for i in range(2):
        h.entries.append(Entry("P · f", "1", "Abschlussmuffe [PERSON_000044] Kaltdämmung entfernen", "st", 100.0 + i, tokens("Abschlussmuffe Kaltdämmung entfernen"), "k"))
    assert catalog.suggestions(h)["new_total"] == 0
