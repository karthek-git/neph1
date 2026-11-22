"""REST API for projects: files, saved analyses, bid sheets, what-if, compare."""
from __future__ import annotations
import copy
import json
import re
from fastapi import APIRouter, Body, File, HTTPException, UploadFile
from pydantic import BaseModel, Field

from . import store
from .analysis import analyze_project, compare
from .models import Item, Project
from .parsers import parse_file
from .samples import bench, read_sample, sample_files, SAMPLES
from .whatif import run_whatif

router = APIRouter(prefix="/api/projects", tags=["projects"])
ALLOWED = {"x83", "x84", "x86", "d83", "d84", "d86", "xml", "pdf"}
MAX_BYTES = 30 * 1024 * 1024


# ---------- helpers ----------
def _project_or_404(pid: str) -> dict:
    p = store.get_project(pid)
    if not p:
        raise HTTPException(404, "Project not found")
    return p


def _file_or_404(pid: str, fid: str) -> dict:
    _project_or_404(pid)
    f = store.get_file(pid, fid)
    if not f:
        raise HTTPException(404, "File not found")
    return f


def _meta(proj: Project) -> dict:
    priced = sum(1 for i in proj.items if i.total_price is not None)
    return {"phase": proj.phase, "items": len(proj.items), "priced": priced,
            "total": round(sum(i.total_price or 0 for i in proj.items), 2) if priced else None}


def _ingest(pid: str, name: str, data: bytes) -> dict:
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    if ext not in ALLOWED:
        raise HTTPException(415, f"Unsupported file type .{ext}. Allowed: " + ", ".join(sorted("." + e for e in ALLOWED)))
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "File too large (30 MB maximum)")
    meta: dict
    try:
        meta = _meta(parse_file(name, data))
    except Exception as e:     # keep the file; show why it could not be read
        meta = {"error": str(e)[:300]}
    return store.add_file(pid, name, data, meta)


def _parse_stored(f: dict) -> Project:
    try:
        return parse_file(f["name"], store.read_file(f))
    except Exception as e:
        raise HTTPException(422, f"{f['name']}: {e}")


def _label(name: str, used: set[str]) -> str:
    base = re.sub(r"[^A-Za-z0-9]+", "_", name.rsplit(".", 1)[0]).strip("_")[:14] or "file"
    lab, n = base, 2
    while lab in used:
        lab, n = f"{base}_{n}", n + 1
    used.add(lab)
    return lab


def merge_projects(parts: list[tuple[str, Project]], name: str) -> Project:
    """One analysis over several files: item numbers get a file prefix, trades keep the file as context.
    Cross-trade checks then see every file of the set."""
    if len(parts) == 1:
        return parts[0][1]
    merged = Project(name=name, phase="tender", source=", ".join(l for l, _ in parts))
    used: set[str] = set()
    for fname, p in parts:
        lab = _label(fname, used)
        for it in p.items:
            c = copy.copy(it)
            c.oz = f"{lab}/{it.oz}"
            c.trade = f"{lab} · {it.trade}" if it.trade else lab
            c.refs = [f"{lab}/{r}" for r in it.refs]
            merged.items.append(c)
        merged.preamble += ("\n\n" if merged.preamble else "") + p.preamble
        merged.notes += [f"{lab}: {n}" for n in p.notes]
    merged.sections = {}
    return merged


# ---------- projects ----------
class NewProject(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=1000)


class PatchProject(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=1000)


@router.get("")
def list_projects():
    return store.list_projects()


@router.post("", status_code=201)
def create_project(body: NewProject):
    if not body.name.strip():
        raise HTTPException(422, "Name is required")
    return store.create_project(body.name, body.description)


@router.get("/{pid}")
def get_project(pid: str):
    return _project_or_404(pid)


@router.patch("/{pid}")
def patch_project(pid: str, body: PatchProject):
    p = store.update_project(pid, body.name, body.description)
    if not p:
        raise HTTPException(404, "Project not found")
    return p


@router.delete("/{pid}", status_code=204)
def delete_project(pid: str):
    if not store.delete_project(pid):
        raise HTTPException(404, "Project not found")


# ---------- files ----------
@router.get("/{pid}/files")
def list_files(pid: str):
    _project_or_404(pid)
    return store.list_files(pid)


@router.post("/{pid}/files", status_code=201)
async def upload_files(pid: str, files: list[UploadFile] = File(...)):
    _project_or_404(pid)
    out, errors = [], []
    for f in files:
        try:
            out.append(_ingest(pid, f.filename or "upload", await f.read()))
        except HTTPException as e:
            errors.append({"name": f.filename, "error": e.detail})
    if not out and errors:
        raise HTTPException(errors and 415 or 400, "; ".join(f"{e['name']}: {e['error']}" for e in errors))
    return {"files": out, "rejected": errors}


@router.get("/samples/list")
def list_samples():
    return [str(p.relative_to(SAMPLES)) for p in sample_files()]


class SampleIn(BaseModel):
    names: list[str]


@router.post("/{pid}/files/samples", status_code=201)
def add_samples(pid: str, body: SampleIn):
    _project_or_404(pid)
    out = []
    for n in body.names:
        name, data = read_sample(n)
        out.append(_ingest(pid, name, data))
    return {"files": out, "rejected": []}


@router.delete("/{pid}/files/{fid}", status_code=204)
def delete_file(pid: str, fid: str):
    _file_or_404(pid, fid)
    store.delete_file(pid, fid)


# ---------- analyses ----------
class AnalyzeIn(BaseModel):
    file_ids: list[str] = []
    use_llm: bool = True
    title: str = ""


@router.post("/{pid}/analyses", status_code=201)
def run_analysis(pid: str, body: AnalyzeIn):
    proj = _project_or_404(pid)
    files = store.list_files(pid)
    if body.file_ids:
        by_id = {f["id"]: f for f in files}
        chosen = []
        for fid in body.file_ids:
            if fid not in by_id:
                raise HTTPException(404, f"File {fid} not in this project")
            chosen.append(by_id[fid])
    else:
        chosen = [f for f in files if not f["error"]]
    chosen = [f for f in chosen if not f["error"]]
    if not chosen:
        raise HTTPException(422, "No readable files to analyse. Upload a GAEB or PDF BoQ first.")
    parts = [(f["name"], _parse_stored(f)) for f in chosen]
    merged = merge_projects(parts, proj["name"])
    result = analyze_project(merged, use_llm=body.use_llm, bench=bench())
    result["files"] = [{"id": f["id"], "name": f["name"]} for f in chosen]
    title = body.title.strip() or (chosen[0]["name"] if len(chosen) == 1 else f"{len(chosen)} files")
    return store.save_analysis(pid, title, [f["id"] for f in chosen], body.use_llm, result)


@router.get("/{pid}/analyses")
def list_analyses(pid: str):
    _project_or_404(pid)
    return store.list_analyses(pid)


@router.get("/{pid}/analyses/{aid}")
def get_analysis(pid: str, aid: str):
    _project_or_404(pid)
    r = store.get_analysis(pid, aid)
    if r is None:
        raise HTTPException(404, "Analysis not found")
    return {"meta": store.get_analysis_meta(pid, aid), "report": r}


@router.delete("/{pid}/analyses/{aid}", status_code=204)
def delete_analysis(pid: str, aid: str):
    _project_or_404(pid)
    if not store.delete_analysis(pid, aid):
        raise HTTPException(404, "Analysis not found")


# ---------- bid sheet ----------
@router.get("/{pid}/files/{fid}/bidsheet")
def get_bidsheet(pid: str, fid: str):
    f = _file_or_404(pid, fid)
    proj = _parse_stored(f)
    from .benchmarks import hints_for
    hints = hints_for(proj, bench())
    last = store.latest_analysis_for_file(pid, fid)
    level = {r["oz"]: r["level"] for r in (last or {}).get("items", [])}
    bid = store.get_bid(pid, fid)
    items = [{"oz": i.oz, "trade": i.trade, "section": i.section, "short_text": i.short_text, "unit": i.unit,
              "quantity": i.quantity, "unit_price": i.unit_price, "total_price": i.total_price, "kind": i.kind,
              "level": level.get(i.oz, "none"),
              "hint": ({k: hints["hints"][i.oz][k] for k in ("median", "low", "high", "n", "confidence")} if i.oz in hints["hints"] else None)}
             for i in proj.items]
    return {"file": {"id": fid, "name": f["name"]}, "items": items, "prices": bid["prices"], "markup": bid["markup"],
            "coverage": hints["coverage"], "has_analysis": last is not None}


class BidIn(BaseModel):
    prices: dict[str, float] = {}
    markup: float = 0


@router.put("/{pid}/files/{fid}/bidsheet")
def put_bidsheet(pid: str, fid: str, body: BidIn):
    _file_or_404(pid, fid)
    store.save_bid(pid, fid, {k: v for k, v in body.prices.items() if v is not None}, body.markup)
    return {"ok": True}


# ---------- what-if / compare ----------
class WhatIfIn(BaseModel):
    file_id: str
    scenarios: list[dict] = []
    split: dict = {}
    include_optional: bool = True
    use_bid: bool = False


@router.post("/{pid}/whatif")
def whatif(pid: str, body: WhatIfIn):
    f = _file_or_404(pid, body.file_id)
    proj = _parse_stored(f)
    if body.use_bid:
        prices = store.get_bid(pid, body.file_id)["prices"]
        for it in proj.items:
            if not it.unit_price and it.oz in prices:
                it.unit_price = float(prices[it.oz])
    try:
        return run_whatif(proj, body.scenarios, body.split, body.include_optional)
    except (ValueError, KeyError, TypeError) as e:
        raise HTTPException(422, str(e))


class CompareIn(BaseModel):
    tender_file_id: str
    award_file_id: str


@router.post("/{pid}/compare")
def compare_files(pid: str, body: CompareIn):
    t = _parse_stored(_file_or_404(pid, body.tender_file_id))
    a = _parse_stored(_file_or_404(pid, body.award_file_id))
    return compare(t, a, analyze_project(t, use_llm=False))
