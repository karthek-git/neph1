"""REST API for projects: files, saved analyses, bid sheets, what-if, compare."""
from __future__ import annotations
import copy
import json
import re
import time
from fastapi import APIRouter, Body, File, HTTPException, UploadFile
from pydantic import BaseModel, Field

from . import store, quality, extract, catalog as price_catalog
from .analysis import analyze_project, compare, diff_reports, ensure_ids
from . import docx_out, bidgen, versions as vers
from fastapi import Response
from .models import Item, Project
from .parsers import parse_file, norm_oz
from .samples import bench, read_sample, sample_files, SAMPLES
from .benchmarks import hints_for, Benchmarks, group_key
from .whatif import run_whatif

router = APIRouter(prefix="/api/projects", tags=["projects"])
ALLOWED = {"x83", "x84", "x86", "d83", "d84", "d86", "xml", "pdf", "xlsx", "xlsm", "docx"}
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
    proj, err = None, ""
    try:
        proj = parse_file(name, data)
    except Exception as e:     # keep the file; show why it could not be read
        err = str(e)[:300]
    if proj is not None and not proj.items:
        err = "No items were found in this file."
    status, warnings = quality.assess(proj, err)
    meta = _meta(proj) if proj is not None else {}
    if err:
        meta["error"] = err
    meta.update(status=status, warnings=warnings, source="parser", confirmed=1)
    f = store.add_file(pid, name, data, meta)
    if proj is not None and proj.items:
        store.save_items(f["id"], pid, proj.to_payload())
    return f


def _save_project(pid: str, fid: str, proj: Project, *, source: str, confirmed: bool, edited: bool) -> dict:
    """Store (new) items of a file and refresh its summary, quality status and flags."""
    status, warnings = quality.assess(proj)
    meta = _meta(proj)
    if source == "ai" and not confirmed and status == "ok":
        status = "check"
    store.save_items(fid, pid, proj.to_payload())
    store.update_file(fid, phase=meta["phase"], items=meta["items"], priced=meta["priced"], total=meta["total"], error="",
                      status=status, warnings=warnings, source=source, confirmed=confirmed, edited=edited)
    return store.get_file(pid, fid)


def _parse_stored(f: dict) -> Project:
    """The file's stored items (including the user's edits); falls back to parsing the original."""
    payload = store.get_items(f["id"])
    if payload is not None:
        return Project.from_payload(payload)
    try:
        proj = parse_file(f["name"], store.read_file(f))
    except Exception as e:
        raise HTTPException(422, f"{f['name']}: {e}")
    if proj.items and f.get("project_id"):      # file from before items were stored: keep them from now on
        _save_project(f["project_id"], f["id"], proj, source=f.get("source") or "parser", confirmed=True, edited=False)
    return proj


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


def _fingerprint(p: Project) -> dict[str, str]:
    """item number -> start of the short text, so equal numbers with different texts (two trades) do not count as the same BoQ."""
    return {norm_oz(i.oz): re.sub(r"[^a-z0-9äöüß]", "", i.short_text.lower())[:20] for i in p.items}


def find_overlaps(chosen: list[dict], parts: list[tuple[str, Project]], threshold: float = 0.6) -> list[dict]:
    """Pairs of files that look like the same BoQ at different stages (tender / bid / award) or a duplicate upload."""
    prints = [_fingerprint(p) for _, p in parts]
    out = []
    for i in range(len(parts)):
        for j in range(i + 1, len(parts)):
            a, b = prints[i], prints[j]
            shared = set(a) & set(b)
            if len(shared) < 5:
                continue
            same = sum(1 for k in shared if a[k] == b[k] or not a[k] or not b[k] or a[k][:10] == b[k][:10])
            ratio = same / min(len(a), len(b))
            if ratio >= threshold:
                out.append({"a_id": chosen[i]["id"], "a": chosen[i]["name"], "a_phase": chosen[i]["phase"],
                            "b_id": chosen[j]["id"], "b": chosen[j]["name"], "b_phase": chosen[j]["phase"], "ratio": round(ratio, 2)})
    return out



# ---------- price history: which projects feed the benchmark prices ----------
def _history_cfg(pid: str) -> dict:
    return store.get_meta(pid, "history").get("cfg") or {}


def _source_bench(src_pid: str, name: str) -> Benchmarks:
    """Benchmarks from the priced files of one saved project (its stored items, including the user's edits)."""
    b, seen = Benchmarks(), set()
    for f in store.list_files(src_pid):
        if f["error"] or (f["priced"] or 0) < 10:
            continue
        p = _parse_stored(f)
        key = group_key(p)
        if key in seen:                         # the same BoQ as PDF and D84 counts once
            continue
        seen.add(key)
        b.add_project(p, f"{name} · {f['name']}" + (" (AI-extracted)" if f["source"] == "ai" else ""), group=key)
    return b


def history_sources(pid: str) -> list[dict]:
    """Every other project that has priced files, plus the dataset folder if there is one, with how well each matches this project."""
    out = []
    for p in store.list_projects():
        if p["id"] == pid:
            continue
        b = _source_bench(p["id"], p["name"])
        if b.entries:
            out.append({"id": p["id"], "kind": "project", "name": p["name"], "items": len(b.entries), "bench": b})
    d = bench()
    if d.entries:
        out.append({"id": "dataset", "kind": "dataset", "name": "Challenge dataset (folder)", "items": len(d.entries), "bench": d})
    return out


def bench_for(pid: str) -> Benchmarks:
    """The benchmark index for one project: the history sources chosen in its checklist (default: every other project with prices;
    the dataset folder only when there is no such project)."""
    cfg = _history_cfg(pid)
    srcs = history_sources(pid)
    projects = [s for s in srcs if s["kind"] == "project"]
    if "projects" in cfg or "dataset" in cfg:
        chosen = [s for s in projects if s["id"] in cfg.get("projects", [])]
        use_dataset = bool(cfg.get("dataset"))
    else:
        chosen, use_dataset = projects, not projects
    out = Benchmarks()
    out.entries.extend(price_catalog.bench().entries)          # the user's own catalog is always part of the price knowledge
    for s in chosen + ([x for x in srcs if x["kind"] == "dataset"] if use_dataset else []):
        out.entries.extend(s["bench"].entries)
    return out


@router.get("/{pid}/history")
def get_history(pid: str):
    _project_or_404(pid)
    cfg = _history_cfg(pid)
    files = [f for f in store.list_files(pid) if not f["error"] and f["items"]]
    mine = [_parse_stored(f) for f in files if f["phase"] == "tender" or not (f["priced"] or 0)] or [_parse_stored(f) for f in files]
    srcs = history_sources(pid)
    projects = [s for s in srcs if s["kind"] == "project"]
    if "projects" in cfg or "dataset" in cfg:
        sel_p, sel_d = set(cfg.get("projects", [])), bool(cfg.get("dataset"))
    else:
        sel_p, sel_d = {s["id"] for s in projects}, not projects
    out = []
    for s in srcs:
        matched = candidates = 0
        for p in mine:
            h = hints_for(p, s["bench"], cfg.get("include_own", False))["coverage"]
            matched += h["matched"]; candidates += h["candidates"]
        ai = sum(1 for e in s["bench"].entries if "(AI-extracted)" in e.source)
        out.append({"id": s["id"], "kind": s["kind"], "name": s["name"], "items": s["items"], "ai_items": ai, "matched": matched, "candidates": candidates,
                    "selected": (s["id"] in sel_p) if s["kind"] == "project" else sel_d})
    out.sort(key=lambda x: -x["matched"])
    return {"sources": out, "include_own": bool(cfg.get("include_own"))}


class HistoryIn(BaseModel):
    projects: list[str] = []
    dataset: bool = False
    include_own: bool = False


@router.put("/{pid}/history")
def put_history(pid: str, body: HistoryIn):
    _project_or_404(pid)
    store.set_meta(pid, "history", "cfg", body.model_dump())
    return get_history(pid)

# ---------- projects ----------
class NewProject(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=1000)


_DATE = r"^(\d{4}-\d{2}-\d{2})?$"


class PatchProject(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=1000)
    bid_deadline: str | None = Field(default=None, pattern=_DATE)           # YYYY-MM-DD or empty
    question_deadline: str | None = Field(default=None, pattern=_DATE)


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
    p = store.update_project(pid, body.name, body.description, body.bid_deadline, body.question_deadline)
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


# ---------- parsed items: view, edit, confirm, re-parse, AI extraction ----------
class ItemIn(BaseModel):
    oz: str = Field(min_length=1, max_length=40)
    short_text: str = ""
    long_text: str = ""
    quantity: float | None = None
    unit: str = ""
    unit_price: float | None = None
    total_price: float | None = None
    kind: str = "normal"
    section: str = ""
    section_title: str = ""
    trade: str = ""


class ItemsIn(BaseModel):
    items: list[ItemIn]


def _items_view(pid: str, f: dict) -> dict:
    if store.get_items(f["id"]) is None and not f["error"]:
        _parse_stored(f)                                  # backfill older files
        f = store.get_file(pid, f["id"])
    payload = store.get_items(f["id"]) or {"items": [], "notes": [], "preamble": ""}
    rows = [{**i, "text": (i.get("short_text", "") + "\n" + i.get("long_text", "")).strip()} for i in payload["items"]]
    return {"file": f, "items": rows, "notes": payload.get("notes", []), "ai_available": extract.llm.available()}


@router.get("/{pid}/files/{fid}/items")
def get_items(pid: str, fid: str):
    return _items_view(pid, _file_or_404(pid, fid))


@router.put("/{pid}/files/{fid}/items")
def put_items(pid: str, fid: str, body: ItemsIn):
    f = _file_or_404(pid, fid)
    payload = store.get_items(fid) or {"name": f["name"], "phase": f["phase"], "source": f["name"]}
    kinds = {"normal", "optional", "lump_sum", "surcharge", "alternative", "hourly"}
    cur = Project.from_payload({**payload, "items": []})
    cur.items = [Item(**{**i.model_dump(), "kind": i.kind if i.kind in kinds else "normal", "source": f["name"]}) for i in body.items]
    if not cur.items:
        raise HTTPException(422, "A file needs at least one item. Delete the file instead.")
    f = _save_project(pid, fid, cur, source=f["source"], confirmed=f["confirmed"], edited=True)
    return _items_view(pid, f)


@router.post("/{pid}/files/{fid}/confirm")
def confirm_items(pid: str, fid: str):
    f = _file_or_404(pid, fid)
    if not store.get_items(fid):
        raise HTTPException(422, "Nothing to confirm: this file has no items yet.")
    store.update_file(fid, confirmed=True)
    if f["status"] == "check" and f["source"] == "ai":
        store.update_file(fid, status="ok")
    return _items_view(pid, store.get_file(pid, fid))


@router.post("/{pid}/files/{fid}/reparse")
def reparse(pid: str, fid: str):
    f = _file_or_404(pid, fid)
    try:
        proj = parse_file(f["name"], store.read_file(f))
    except Exception as e:
        raise HTTPException(422, f"{f['name']}: {e}")
    if not proj.items:
        raise HTTPException(422, "The parser found no items in the original file.")
    return _items_view(pid, _save_project(pid, fid, proj, source="parser", confirmed=True, edited=False))


@router.post("/{pid}/files/{fid}/extract")
def ai_extract(pid: str, fid: str):
    """AI fallback: read the file's text and extract items. Every value is checked against the source text."""
    f = _file_or_404(pid, fid)
    try:
        proj, stats = extract.extract(f["name"], store.read_file(f))
    except RuntimeError as e:
        raise HTTPException(422, str(e))
    saved = _save_project(pid, fid, proj, source="ai", confirmed=False, edited=False)
    return {**_items_view(pid, saved), "stats": stats}


@router.get("/{pid}/files/{fid}/source")
def source_text(pid: str, fid: str):
    f = _file_or_404(pid, fid)
    text = extract.source_text(f["name"], store.read_file(f))
    return {"name": f["name"], "text": text[:300000], "truncated": len(text) > 300000}


@router.delete("/{pid}/files/{fid}", status_code=204)
def delete_file(pid: str, fid: str):
    _file_or_404(pid, fid)
    store.delete_file(pid, fid)


# ---------- analyses ----------
class AnalyzeIn(BaseModel):
    file_ids: list[str] = []
    use_llm: bool = True
    title: str = ""
    allow_overlap: bool = False


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
    if len(parts) > 1 and not body.allow_overlap:
        overlaps = find_overlaps(chosen, parts)
        if overlaps:
            raise HTTPException(409, {"code": "overlap", "pairs": overlaps,
                                      "message": "Some selected files look like the same BoQ at different stages. Analysing them together counts every item twice."})
    merged = merge_projects(parts, proj["name"])
    started = time.perf_counter()
    result = analyze_project(merged, use_llm=body.use_llm, bench=bench_for(pid))
    result["files"] = [{"id": f["id"], "name": f["name"]} for f in chosen]
    result["timing"] = {"seconds": round(time.perf_counter() - started, 1)}
    result["unconfirmed_files"] = [f["name"] for f in chosen if not f["confirmed"]]
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
    return {"meta": store.get_analysis_meta(pid, aid), "report": ensure_ids(r)}


@router.delete("/{pid}/analyses/{aid}", status_code=204)
def delete_analysis(pid: str, aid: str):
    _project_or_404(pid)
    if not store.delete_analysis(pid, aid):
        raise HTTPException(404, "Analysis not found")


# ---------- automatic plan: what should run for the files in this project ----------
@router.get("/{pid}/plan")
def plan(pid: str):
    """Decide the analysis from the files' stages: tender -> risk analysis; tender + award of the same BoQ -> also compare;
    priced bid/award -> what-if. Later-stage files that repeat a tender are never merged into the risk analysis."""
    _project_or_404(pid)
    files = [f for f in store.list_files(pid) if not f["error"]]
    out = {"files": len(files), "tenders": [], "later": [], "risk": {"file_ids": [], "names": []}, "compare": [], "whatif": [], "duplicates": [], "already_done": None}
    if not files:
        return out
    parsed = {f["id"]: _parse_stored(f) for f in files}
    by_id = {f["id"]: f for f in files}
    overlaps = find_overlaps(files, [(f["name"], parsed[f["id"]]) for f in files]) if len(files) > 1 else []
    drop: set[str] = set()
    out["versions"] = []
    same = {(o["a_id"], o["b_id"]) for o in overlaps if by_id[o["a_id"]]["phase"] == by_id[o["b_id"]]["phase"]}
    pair = lambda a, b: (a["id"], b["id"]) in same or (b["id"], a["id"]) in same
    for g in vers.group_versions(files, parsed, pair):
        vs = g["versions"]
        if len(vs) < 2:
            continue
        real = [v for v in vs if not v["duplicate"]]
        for v in vs:
            if v["duplicate"]:
                drop.add(v["file_id"])
                out["duplicates"].append({"kept": real[0]["name"], "ignored": v["name"]})
        for v in real[:-1]:
            drop.add(v["file_id"])                       # only the current version goes into the risk analysis
        if len(real) >= 2:
            old, new = real[-2], real[-1]
            out["compare"].append({"tender_id": old["file_id"], "tender": old["name"], "later_id": new["file_id"], "later": new["name"], "kind": "version"})
            out["versions"].append({"stage": g["stage"], "current": new["name"], "count": len(real)})
    for o in overlaps:
        a, b = by_id[o["a_id"]], by_id[o["b_id"]]
        if a["phase"] == b["phase"]:
            continue                                      # same stage: handled as versions above
        ta, tb = a["phase"] == "tender", b["phase"] == "tender"
        if ta != tb:
            tender, later = (a, b) if ta else (b, a)
            drop.add(later["id"])
            if later["phase"] == "award":
                out["compare"].append({"tender_id": tender["id"], "tender": tender["name"], "later_id": later["id"], "later": later["name"], "kind": "award"})
    tenders = [f for f in files if f["phase"] == "tender"]
    out["tenders"] = [f["name"] for f in tenders]
    out["later"] = [{"name": f["name"], "phase": f["phase"]} for f in files if f["phase"] in ("bid", "award")]
    risk = [f for f in (tenders or files) if f["id"] not in drop]
    out["risk"] = {"file_ids": [f["id"] for f in risk], "names": [f["name"] for f in risk]}
    priced_later = [f for f in files if f["phase"] in ("bid", "award") and (f["priced"] or 0) > 0]
    priced_later.sort(key=lambda f: 0 if f["phase"] == "award" else 1)
    out["whatif"] = [{"file_id": f["id"], "name": f["name"], "phase": f["phase"]} for f in priced_later[:2]]
    out["estimates"], out["whatif_blocked"] = [], []
    for f in [f for f in risk if f["phase"] == "tender" and not (f["priced"] or 0)][:2]:
        # a tender has no prices: use the user's saved bid prices, else indicative benchmark prices, else say so
        proj_f = parsed[f["id"]]
        h = hints_for(proj_f, bench_for(pid), _history_cfg(pid).get("include_own", False))
        matched = h["coverage"]["matched"]
        usable = matched >= 10 or (matched and matched >= 0.2 * max(1, h["coverage"]["candidates"]))   # one stray match is not an estimate
        if not usable:
            matched = 0
        if matched:
            out["estimates"].append({"name": f["name"], "matched": matched, "candidates": h["coverage"]["candidates"], "total": h["indicative_total"]})
        if not priced_later:
            if len(store.get_bid(pid, f["id"])["prices"]) >= 5:
                out["whatif"].append({"file_id": f["id"], "name": f["name"], "phase": "tender", "basis": "bid"})
            elif matched >= 10:
                out["whatif"].append({"file_id": f["id"], "name": f["name"], "phase": "tender", "basis": "benchmark",
                                      "matched": matched, "candidates": h["coverage"]["candidates"]})
            else:
                out["whatif_blocked"].append({"name": f["name"], "reason": "no_prices"})
    want = set(out["risk"]["file_ids"])
    for m in store.list_analyses(pid):      # newest first
        if want and set(m["file_ids"]) == want:
            out["already_done"] = {"id": m["id"], "use_llm": m["use_llm"]}
            break
    return out


# ---------- bid sheet ----------
@router.get("/{pid}/files/{fid}/bidsheet")
def get_bidsheet(pid: str, fid: str):
    f = _file_or_404(pid, fid)
    proj = _parse_stored(f)
    from .benchmarks import hints_for
    hints = hints_for(proj, bench_for(pid), _history_cfg(pid).get("include_own", False))
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


def _apply_prices(proj: Project, pid: str, fid: str, use_bid: bool, use_benchmark: bool) -> dict:
    """Give unpriced items a price for the what-if baseline: first the user's saved bid prices, then indicative benchmark prices."""
    basis = {"file_items": sum(1 for i in proj.items if i.unit_price), "bid_items": 0, "benchmark_items": 0,
             "candidates": sum(1 for i in proj.items if not i.unit_price and i.kind not in ("hourly", "lump_sum")), "total_items": len(proj.items)}
    if use_bid:
        prices = store.get_bid(pid, fid)["prices"]
        for it in proj.items:
            if not it.unit_price and it.oz in prices:
                it.unit_price = float(prices[it.oz]); basis["bid_items"] += 1
    if use_benchmark:
        h = hints_for(proj, bench_for(pid), _history_cfg(pid).get("include_own", False))["hints"]
        for it in proj.items:
            if not it.unit_price and it.oz in h:
                it.unit_price = h[it.oz]["median"]; basis["benchmark_items"] += 1
    return basis


# ---------- what-if / compare ----------
class WhatIfIn(BaseModel):
    file_id: str
    scenarios: list[dict] = []
    split: dict = {}
    include_optional: bool = True
    use_bid: bool = False
    use_benchmark: bool = False


@router.post("/{pid}/whatif")
def whatif(pid: str, body: WhatIfIn):
    f = _file_or_404(pid, body.file_id)
    proj = _parse_stored(f)
    basis = _apply_prices(proj, pid, body.file_id, body.use_bid, body.use_benchmark)
    try:
        res = run_whatif(proj, body.scenarios, body.split, body.include_optional)
    except ValueError as e:
        msg = str(e)
        if "no unit prices" in msg.lower() and not (body.use_bid or body.use_benchmark):
            msg += " For a tender, enter your prices in the Bid sheet, or use your saved bid prices or indicative benchmark prices."
        raise HTTPException(422, msg)
    except (KeyError, TypeError) as e:
        raise HTTPException(422, str(e))
    res["basis"] = basis
    return res


class CompareIn(BaseModel):
    tender_file_id: str
    award_file_id: str


@router.post("/{pid}/compare")
def compare_files(pid: str, body: CompareIn):
    t = _parse_stored(_file_or_404(pid, body.tender_file_id))
    a = _parse_stored(_file_or_404(pid, body.award_file_id))
    return compare(t, a, analyze_project(t, use_llm=False))


# ---------- triage of findings, edited questions, changes between analyses, question letter ----------
STATUSES = {"review", "clarify", "reviewed", "dismissed"}


class TriageIn(BaseModel):
    status: str
    note: str = Field(default="", max_length=1000)


@router.get("/{pid}/triage")
def get_triage(pid: str):
    _project_or_404(pid)
    return store.get_meta(pid, "triage")


@router.put("/{pid}/triage/{fid}")
def put_triage(pid: str, fid: str, body: TriageIn):
    _project_or_404(pid)
    if body.status not in STATUSES:
        raise HTTPException(422, f"Status must be one of {sorted(STATUSES)}")
    # 'review' with no note is the default: store nothing
    store.set_meta(pid, "triage", fid, None if body.status == "review" and not body.note.strip() else {"status": body.status, "note": body.note.strip()})
    return {"ok": True}


class QStateIn(BaseModel):
    text: str | None = Field(default=None, max_length=4000)
    selected: bool | None = None
    sent: bool | None = None


@router.get("/{pid}/qstate")
def get_qstate(pid: str):
    _project_or_404(pid)
    return store.get_meta(pid, "question")


@router.put("/{pid}/qstate/{key}")
def put_qstate(pid: str, key: str, body: QStateIn):
    _project_or_404(pid)
    cur = store.get_meta(pid, "question").get(key, {})
    cur.update({k: v for k, v in body.model_dump().items() if v is not None})
    store.set_meta(pid, "question", key, cur)
    return cur


@router.get("/{pid}/analyses/{aid}/changes")
def analysis_changes(pid: str, aid: str, base: str = ""):
    """Findings new / resolved / unchanged against an earlier analysis (default: the previous one of this project)."""
    _project_or_404(pid)
    new = store.get_analysis(pid, aid)
    if new is None:
        raise HTTPException(404, "Analysis not found")
    ensure_ids(new)
    metas = store.list_analyses(pid)                                   # newest first
    if not base:
        older = [m for m in metas if m["created"] < (store.get_analysis_meta(pid, aid) or {}).get("created", 0)]
        if not older:
            return {"base": None, "new": [], "resolved": [], "unchanged": 0, "high_new": 0, "high_resolved": 0}
        base = older[0]["id"]
    old = store.get_analysis(pid, base)
    if old is None:
        raise HTTPException(404, "Base analysis not found")
    ensure_ids(old)
    out = diff_reports(new, old)
    out["base"] = store.get_analysis_meta(pid, base)
    return out


class LetterIn(BaseModel):
    keys: list[str] = []
    deadline: str = ""


@router.post("/{pid}/analyses/{aid}/letter.docx")
def question_letter(pid: str, aid: str, body: LetterIn):
    proj = _project_or_404(pid)
    rep = store.get_analysis(pid, aid)
    if rep is None:
        raise HTTPException(404, "Analysis not found")
    ensure_ids(rep)
    edits = store.get_meta(pid, "question")
    chosen = [q for q in rep["questions"] if (q.get("fid") or q["no"]) in set(body.keys)] if body.keys else rep["questions"]
    if not chosen:
        raise HTTPException(422, "No questions selected.")
    qs = [{**q, "question": edits.get(q.get("fid") or q["no"], {}).get("text") or q["question"]} for q in chosen]
    deadline = body.deadline
    if not deadline and proj.get("question_deadline"):
        y, m, d = proj["question_deadline"].split("-")
        deadline = f"{d}.{m}.{y}"
    data = docx_out.question_letter(proj["name"], qs, deadline)
    return Response(data, media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                    headers={"Content-Disposition": 'attachment; filename="bieterfragen.docx"'})


# ---------- bid generation: offer context, priced X84, Word offer ----------
def _bid_prices(pid: str, fid: str, proj: Project) -> tuple[dict, float]:
    """The prices that make up the bid: the file's own unit prices overlaid with the ones the user saved."""
    saved = store.get_bid(pid, fid)
    prices = {i.oz: i.unit_price for i in proj.items if i.unit_price is not None}
    prices.update(saved["prices"])
    return prices, float(saved["markup"] or 0)


def _net(proj: Project, prices: dict) -> float:
    return round(sum(prices[i.oz] * i.quantity for i in proj.items if i.oz in prices and i.quantity is not None and i.kind != "optional"), 2)


@router.get("/{pid}/files/{fid}/offer-context")
def offer_context(pid: str, fid: str):
    f = _file_or_404(pid, fid)
    proj = _parse_stored(f)
    prices, markup = _bid_prices(pid, fid, proj)
    rep = None
    for m in store.list_analyses(pid):                       # newest first; prefer one that covers this file
        if fid in m["file_ids"]:
            rep = store.get_analysis(pid, m["id"]); break
    if rep is None and store.list_analyses(pid):
        rep = store.get_analysis(pid, store.list_analyses(pid)[0]["id"])
    triage = store.get_meta(pid, "triage")
    out = {"net": _net(proj, prices), "markup": markup, "priced": sum(1 for i in proj.items if i.oz in prices), "items": len(proj.items),
           "unpriced": [i.oz for i in proj.items if i.oz not in prices and i.kind not in ("optional", "hourly")][:30],
           "markup_hint": None, "clarifications": [], "exposure": None,
           "x84_possible": f["name"].lower().endswith((".x83", ".xml")) and f["source"] == "parser" and not f["edited"] or f["name"].lower().endswith((".x83", ".xml"))}
    if rep:
        ensure_ids(rep)
        out["markup_hint"] = bidgen.markup_hint(rep["findings"], triage)
        out["exposure"] = rep["summary"].get("exposure")
        qs = {q["fid"]: q for q in rep["questions"]}
        qedits = store.get_meta(pid, "question")
        for fnd in rep["findings"]:
            t = triage.get(fnd["id"], {})
            if t.get("status") == "clarify":
                q = qs.get(fnd["id"])
                out["clarifications"].append({"id": fnd["id"], "oz": fnd["oz"], "message_de": fnd.get("message_de") or fnd["message"], "note": t.get("note", ""),
                                              "question": (qedits.get(fnd["id"], {}).get("text") or (q or {}).get("question") or fnd.get("question", ""))})
    return out


@router.get("/{pid}/files/{fid}/bid.x84")
def export_x84(pid: str, fid: str, include_markup: bool = True):
    f = _file_or_404(pid, fid)
    if not f["name"].lower().endswith((".x83", ".xml")):
        raise HTTPException(422, "The GAEB X84 export needs an X83 tender file. For other formats use the Excel export.")
    proj = _parse_stored(f)
    prices, markup = _bid_prices(pid, fid, proj)
    if not prices:
        raise HTTPException(422, "No prices yet. Enter your unit prices in the Prices tab first.")
    try:
        data, info = bidgen.x84_from_x83(store.read_file(f), proj, prices, markup if include_markup else 0.0)
    except (bidgen.ExportError, UnicodeDecodeError) as e:
        raise HTTPException(422, str(e))
    name = re.sub(r"\.(x83|xml)$", "", f["name"], flags=re.I) + ".X84"
    return Response(data, media_type="application/xml", headers={"Content-Disposition": f'attachment; filename="{name}"',
                                                                  "X-Calex-Priced": str(info["priced"]), "X-Calex-Unpriced": str(info["unpriced"])})


class OfferIn(BaseModel):
    vat_pct: float = 19.0
    validity_days: int = 30
    assumptions: list[str] = []


@router.post("/{pid}/files/{fid}/offer.docx")
def offer_docx(pid: str, fid: str, body: OfferIn):
    f = _file_or_404(pid, fid)
    proj = _parse_stored(f)
    prices, markup = _bid_prices(pid, fid, proj)
    if not prices:
        raise HTTPException(422, "No prices yet. Enter your unit prices in the Prices tab first.")
    p = store.get_project(pid)
    data = bidgen.offer_docx(p["name"], _net(proj, prices), markup, body.vat_pct, body.validity_days, [a for a in body.assumptions if a.strip()])
    return Response(data, media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                    headers={"Content-Disposition": 'attachment; filename="angebot.docx"'})


@router.get("/{pid}/versions")
def versions(pid: str):
    """Files grouped by stage and BoQ, with v1, v2 ... in upload order. The latest is 'current'."""
    _project_or_404(pid)
    files = [f for f in store.list_files(pid) if not f["error"] and f["items"]]
    parsed = {f["id"]: _parse_stored(f) for f in files}
    by_id = {f["id"]: f for f in files}
    pairs = {(o["a_id"], o["b_id"]) for o in find_overlaps(files, [(f["name"], parsed[f["id"]]) for f in files])} if len(files) > 1 else set()
    notes = store.get_meta(pid, "filenote")
    groups = vers.group_versions(files, parsed, lambda a, b: (a["id"], b["id"]) in pairs or (b["id"], a["id"]) in pairs)
    for g in groups:
        for v in g["versions"]:
            v["note"] = notes.get(v["file_id"], {}).get("note", "")
    return groups


class NoteIn(BaseModel):
    note: str = Field(default="", max_length=200)


@router.put("/{pid}/files/{fid}/note")
def put_note(pid: str, fid: str, body: NoteIn):
    _file_or_404(pid, fid)
    store.set_meta(pid, "filenote", fid, {"note": body.note.strip()} if body.note.strip() else None)
    return {"ok": True}
