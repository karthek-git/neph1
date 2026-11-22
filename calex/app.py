"""Calex web API + React UI (frontend/dist).  Run:  uvicorn calex.app:app --reload"""
from __future__ import annotations
import os
from pathlib import Path
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi import Body
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles

from .parsers import parse_file
from .analysis import analyze_project, compare
from . import llm
from .export import report_to_xlsx, bidsheet_to_xlsx
from . import benchmarks as bm
from .samples import SAMPLES, sample_files as _sample_files, read_sample as _read_sample, bench
from .whatif import run_whatif, PRESETS
from .api_projects import router as projects_router
import json

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "frontend" / "dist"
MAX_BYTES = 30 * 1024 * 1024

app = FastAPI(title="Calex", description="BoQ risk analysis for bidders")
app.include_router(projects_router)


def _load_env_file():
    f = ROOT / ".env"
    if f.exists():
        for line in f.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


_load_env_file()


async def _upload(f: UploadFile) -> tuple[str, bytes]:
    data = await f.read()
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "File too large")
    return f.filename or "upload", data


def _parse(name: str, data: bytes):
    try:
        proj = parse_file(name, data)
    except ValueError as e:
        raise HTTPException(415, str(e))
    except Exception as e:
        raise HTTPException(422, f"Could not read {name}: {e}")
    if not proj.items:
        raise HTTPException(422, f"No items found in {name}. Is it a GAEB BoQ (X83/D83)?")
    return proj


@app.get("/api/status")
def status():
    return {"llm_available": llm.available(), "model": llm._alive()[0]}


@app.get("/api/samples")
def samples():
    return [str(p.relative_to(SAMPLES)) for p in _sample_files()]


@app.post("/api/analyze")
async def analyze(file: UploadFile | None = File(None), sample: str = Form(""), use_llm: bool = Form(True)):
    if file is not None and file.filename:
        name, data = await _upload(file)
    elif sample:
        name, data = _read_sample(sample)
    else:
        raise HTTPException(400, "Provide a file or a sample name")
    return analyze_project(_parse(name, data), use_llm=use_llm, bench=bench())


@app.post("/api/compare")
async def compare_files(tender: UploadFile | None = File(None), award: UploadFile | None = File(None),
                        tender_sample: str = Form(""), award_sample: str = Form("")):
    tn, td = await _upload(tender) if tender is not None and tender.filename else _read_sample(tender_sample)
    an, ad = await _upload(award) if award is not None and award.filename else _read_sample(award_sample)
    t, a = _parse(tn, td), _parse(an, ad)
    return compare(t, a, analyze_project(t, use_llm=False))


@app.post("/api/export.xlsx")
def export_xlsx(report: dict = Body(...)):
    if "findings" not in report or "project" not in report:
        raise HTTPException(400, "Not a Calex report")
    return Response(report_to_xlsx(report), media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": 'attachment; filename="calex-report.xlsx"'})


@app.post("/api/bidsheet.xlsx")
def bidsheet_xlsx(sheet: dict = Body(...)):
    if not isinstance(sheet.get("rows"), list):
        raise HTTPException(400, "Not a bid sheet")
    return Response(bidsheet_to_xlsx(sheet), media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": 'attachment; filename="calex-bidsheet.xlsx"'})


@app.get("/api/whatif/presets")
def whatif_presets():
    return PRESETS


@app.post("/api/whatif")
async def whatif(file: UploadFile | None = File(None), sample: str = Form(""), scenarios: str = Form("[]"),
                 split: str = Form("{}"), include_optional: bool = Form(True)):
    if file is not None and file.filename:
        name, data = await _upload(file)
    elif sample:
        name, data = _read_sample(sample)
    else:
        raise HTTPException(400, "Provide a file or a sample name")
    try:
        sc, sp = json.loads(scenarios), json.loads(split)
        return run_whatif(_parse(name, data), sc, sp, include_optional)
    except (ValueError, KeyError, TypeError) as e:
        raise HTTPException(422, str(e))


@app.get("/")
def index():
    if not (DIST / "index.html").exists():
        raise HTTPException(503, "Frontend not built. Run: cd frontend && npm install && npm run build")
    return FileResponse(DIST / "index.html")


if (DIST / "assets").exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")
