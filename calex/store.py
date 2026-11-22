"""SQLite persistence: projects, uploaded files, saved analyses, saved bid prices. Files live on disk next to the DB."""
from __future__ import annotations
import json
import os
import shutil
import sqlite3
import threading
import time
import uuid
from contextlib import contextmanager
from pathlib import Path

DATA_DIR = Path(os.getenv("CALEX_DATA", Path(__file__).resolve().parent.parent / "data"))
_lock = threading.RLock()

SCHEMA = """
CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT DEFAULT '', created REAL, updated REAL);
CREATE TABLE IF NOT EXISTS files(id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL, size INTEGER, ext TEXT,
  uploaded REAL, phase TEXT DEFAULT '', items INTEGER DEFAULT 0, priced INTEGER DEFAULT 0, total REAL, error TEXT DEFAULT '', path TEXT);
CREATE TABLE IF NOT EXISTS analyses(id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT, file_ids TEXT, use_llm INTEGER,
  created REAL, llm_status TEXT, summary TEXT, result TEXT);
CREATE TABLE IF NOT EXISTS file_items(file_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, payload TEXT NOT NULL, updated REAL);
CREATE TABLE IF NOT EXISTS meta(project_id TEXT, kind TEXT, key TEXT, value TEXT, updated REAL, PRIMARY KEY(project_id, kind, key));
CREATE TABLE IF NOT EXISTS catalog(id TEXT PRIMARY KEY, description TEXT NOT NULL, unit TEXT, price REAL NOT NULL, wages REAL, materials REAL, plant REAL,
  source TEXT DEFAULT '', price_date TEXT DEFAULT '', region TEXT DEFAULT '', note TEXT DEFAULT '', created REAL, updated REAL);
CREATE TABLE IF NOT EXISTS catalog_log(id INTEGER PRIMARY KEY AUTOINCREMENT, entry_id TEXT, action TEXT, detail TEXT, source TEXT, at REAL);
CREATE TABLE IF NOT EXISTS bids(project_id TEXT, file_id TEXT, prices TEXT, markup REAL DEFAULT 0, updated REAL, PRIMARY KEY(project_id, file_id));
"""


def _db_path() -> Path:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    return DATA_DIR / "calex.db"


@contextmanager
def db():
    with _lock:
        con = sqlite3.connect(_db_path(), timeout=30)
        con.row_factory = sqlite3.Row
        con.executescript(SCHEMA)
        have_p = {r["name"] for r in con.execute("PRAGMA table_info(projects)")}
        for col in ("bid_deadline", "question_deadline"):
            if col not in have_p:
                con.execute(f"ALTER TABLE projects ADD COLUMN {col} TEXT DEFAULT ''")
        have = {r["name"] for r in con.execute("PRAGMA table_info(files)")}
        for col, ddl in (("status", "TEXT DEFAULT ''"), ("source", "TEXT DEFAULT 'parser'"), ("edited", "INTEGER DEFAULT 0"),
                         ("confirmed", "INTEGER DEFAULT 1"), ("warnings", "TEXT DEFAULT '[]'")):
            if col not in have:
                con.execute(f"ALTER TABLE files ADD COLUMN {col} {ddl}")
        try:
            yield con
            con.commit()
        finally:
            con.close()


def _id() -> str:
    return uuid.uuid4().hex[:10]


def _row(r) -> dict | None:
    return dict(r) if r is not None else None


# ---- projects ----
def create_project(name: str, description: str = "") -> dict:
    pid, now = _id(), time.time()
    with db() as c:
        c.execute("INSERT INTO projects(id,name,description,created,updated) VALUES(?,?,?,?,?)", (pid, name.strip(), description.strip(), now, now))
    return get_project(pid)


def _project_stats(c, pid: str) -> dict:
    f = c.execute("SELECT COUNT(*) n, COALESCE(SUM(items),0) items FROM files WHERE project_id=?", (pid,)).fetchone()
    a = c.execute("SELECT COUNT(*) n, MAX(created) last FROM analyses WHERE project_id=?", (pid,)).fetchone()
    return {"files": f["n"], "items": f["items"], "analyses": a["n"], "last_analysis": a["last"]}


def get_project(pid: str) -> dict | None:
    with db() as c:
        r = c.execute("SELECT * FROM projects WHERE id=?", (pid,)).fetchone()
        if r is None:
            return None
        return {**dict(r), **_project_stats(c, pid)}


def list_projects() -> list[dict]:
    with db() as c:
        rows = c.execute("SELECT * FROM projects ORDER BY updated DESC").fetchall()
        return [{**dict(r), **_project_stats(c, r["id"])} for r in rows]


def update_project(pid: str, name: str | None, description: str | None, bid_deadline: str | None = None, question_deadline: str | None = None) -> dict | None:
    with db() as c:
        if c.execute("SELECT 1 FROM projects WHERE id=?", (pid,)).fetchone() is None:
            return None
        if name is not None:
            c.execute("UPDATE projects SET name=? WHERE id=?", (name.strip(), pid))
        if description is not None:
            c.execute("UPDATE projects SET description=? WHERE id=?", (description.strip(), pid))
        if bid_deadline is not None:
            c.execute("UPDATE projects SET bid_deadline=? WHERE id=?", (bid_deadline.strip(), pid))
        if question_deadline is not None:
            c.execute("UPDATE projects SET question_deadline=? WHERE id=?", (question_deadline.strip(), pid))
        c.execute("UPDATE projects SET updated=? WHERE id=?", (time.time(), pid))
    return get_project(pid)


def touch(pid: str):
    with db() as c:
        c.execute("UPDATE projects SET updated=? WHERE id=?", (time.time(), pid))


def delete_project(pid: str) -> bool:
    with db() as c:
        if c.execute("SELECT 1 FROM projects WHERE id=?", (pid,)).fetchone() is None:
            return False
        for t in ("files", "analyses", "bids", "file_items", "meta"):
            c.execute(f"DELETE FROM {t} WHERE project_id=?", (pid,))
        c.execute("DELETE FROM projects WHERE id=?", (pid,))
    shutil.rmtree(DATA_DIR / "files" / pid, ignore_errors=True)
    return True


# ---- files ----
def add_file(pid: str, name: str, data: bytes, meta: dict) -> dict:
    fid = _id()
    safe = "".join(ch if ch.isalnum() or ch in "._- []()" else "_" for ch in Path(name).name)[:120] or "file"
    folder = DATA_DIR / "files" / pid
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f"{fid}__{safe}"
    path.write_bytes(data)
    ext = safe.rsplit(".", 1)[-1].lower() if "." in safe else ""
    with db() as c:
        c.execute("INSERT INTO files(id,project_id,name,size,ext,uploaded,phase,items,priced,total,error,path,status,source,edited,confirmed,warnings) "
                  "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                  (fid, pid, safe, len(data), ext, time.time(), meta.get("phase", ""), meta.get("items", 0),
                   meta.get("priced", 0), meta.get("total"), meta.get("error", ""), str(path),
                   meta.get("status", ""), meta.get("source", "parser"), int(meta.get("edited", 0)), int(meta.get("confirmed", 1)),
                   json.dumps(meta.get("warnings", []))))
    touch(pid)
    return get_file(pid, fid)


def _file_row(r) -> dict | None:
    if r is None:
        return None
    d = dict(r)
    try:
        d["warnings"] = json.loads(d.get("warnings") or "[]")
    except ValueError:
        d["warnings"] = []
    d["edited"] = bool(d.get("edited"))
    d["confirmed"] = bool(d.get("confirmed", 1))
    return d


def get_file(pid: str, fid: str) -> dict | None:
    with db() as c:
        return _file_row(c.execute("SELECT * FROM files WHERE id=? AND project_id=?", (fid, pid)).fetchone())


def list_files(pid: str) -> list[dict]:
    with db() as c:
        return [_file_row(r) for r in c.execute("SELECT * FROM files WHERE project_id=? ORDER BY uploaded", (pid,)).fetchall()]


def read_file(f: dict) -> bytes:
    return Path(f["path"]).read_bytes()


def delete_file(pid: str, fid: str) -> bool:
    f = get_file(pid, fid)
    if not f:
        return False
    with db() as c:
        c.execute("DELETE FROM files WHERE id=?", (fid,))
        c.execute("DELETE FROM bids WHERE file_id=?", (fid,))
        c.execute("DELETE FROM file_items WHERE file_id=?", (fid,))
    Path(f["path"]).unlink(missing_ok=True)
    touch(pid)
    return True


def update_file(fid: str, **fields) -> None:
    """Update columns of a file row (status, source, edited, confirmed, warnings, phase, items, priced, total, error)."""
    allowed = {"status", "source", "edited", "confirmed", "warnings", "phase", "items", "priced", "total", "error"}
    sets, vals = [], []
    for k, v in fields.items():
        if k not in allowed:
            raise KeyError(k)
        sets.append(f"{k}=?")
        vals.append(json.dumps(v) if k == "warnings" else (int(v) if k in ("edited", "confirmed") else v))
    if sets:
        with db() as c:
            c.execute(f"UPDATE files SET {', '.join(sets)} WHERE id=?", (*vals, fid))


def save_items(fid: str, pid: str, payload: dict) -> None:
    with db() as c:
        c.execute("INSERT OR REPLACE INTO file_items VALUES(?,?,?,?)", (fid, pid, json.dumps(payload), time.time()))
    touch(pid)


def get_items(fid: str) -> dict | None:
    with db() as c:
        r = c.execute("SELECT payload FROM file_items WHERE file_id=?", (fid,)).fetchone()
    return json.loads(r["payload"]) if r else None


# ---- analyses ----
def save_analysis(pid: str, title: str, file_ids: list[str], use_llm: bool, result: dict) -> dict:
    aid = _id()
    light = {"findings": result["summary"]["findings"], "severity": result["summary"]["severity"], "overall": result["summary"]["overall"],
             "items": result["project"]["items"], "questions": len(result["questions"]),
             "change_order_items": result["summary"]["change_order_items"]}
    with db() as c:
        c.execute("INSERT INTO analyses VALUES(?,?,?,?,?,?,?,?,?)",
                  (aid, pid, title, json.dumps(file_ids), int(use_llm), time.time(), result["llm"]["status"],
                   json.dumps(light), json.dumps(result)))
    touch(pid)
    return get_analysis_meta(pid, aid)


def _analysis_meta(r) -> dict:
    d = dict(r)
    d.pop("result", None)
    d["file_ids"] = json.loads(d["file_ids"] or "[]")
    d["summary"] = json.loads(d["summary"] or "{}")
    d["use_llm"] = bool(d["use_llm"])
    return d


def get_analysis_meta(pid: str, aid: str) -> dict | None:
    with db() as c:
        r = c.execute("SELECT id,project_id,title,file_ids,use_llm,created,llm_status,summary FROM analyses WHERE id=? AND project_id=?", (aid, pid)).fetchone()
        return _analysis_meta(r) if r else None


def list_analyses(pid: str) -> list[dict]:
    with db() as c:
        rows = c.execute("SELECT id,project_id,title,file_ids,use_llm,created,llm_status,summary FROM analyses WHERE project_id=? ORDER BY created DESC", (pid,)).fetchall()
        return [_analysis_meta(r) for r in rows]


def get_analysis(pid: str, aid: str) -> dict | None:
    with db() as c:
        r = c.execute("SELECT result FROM analyses WHERE id=? AND project_id=?", (aid, pid)).fetchone()
        return json.loads(r["result"]) if r else None


def latest_analysis_for_file(pid: str, fid: str) -> dict | None:
    for m in list_analyses(pid):
        if m["file_ids"] == [fid]:
            return get_analysis(pid, m["id"])
    return None


def delete_analysis(pid: str, aid: str) -> bool:
    with db() as c:
        return c.execute("DELETE FROM analyses WHERE id=? AND project_id=?", (aid, pid)).rowcount > 0


# ---- bids ----
def get_bid(pid: str, fid: str) -> dict:
    with db() as c:
        r = c.execute("SELECT prices, markup, updated FROM bids WHERE project_id=? AND file_id=?", (pid, fid)).fetchone()
    return {"prices": json.loads(r["prices"]), "markup": r["markup"], "updated": r["updated"]} if r else {"prices": {}, "markup": 0.0, "updated": None}


def save_bid(pid: str, fid: str, prices: dict, markup: float):
    with db() as c:
        c.execute("INSERT OR REPLACE INTO bids VALUES(?,?,?,?,?)", (pid, fid, json.dumps(prices), float(markup or 0), time.time()))
    touch(pid)


# ---- small per-project key/value state: triage status of findings, edited bidder questions ----
def get_meta(pid: str, kind: str) -> dict:
    with db() as c:
        rows = c.execute("SELECT key, value FROM meta WHERE project_id=? AND kind=?", (pid, kind)).fetchall()
    return {r["key"]: json.loads(r["value"]) for r in rows}


def set_meta(pid: str, kind: str, key: str, value: dict | None) -> None:
    with db() as c:
        if value is None:
            c.execute("DELETE FROM meta WHERE project_id=? AND kind=? AND key=?", (pid, kind, key))
        else:
            c.execute("INSERT OR REPLACE INTO meta VALUES(?,?,?,?,?)", (pid, kind, key, json.dumps(value), time.time()))
    touch(pid)
