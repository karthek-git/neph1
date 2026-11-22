"""REST API for the global price catalog (Library)."""
from __future__ import annotations
from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel, Field

from . import catalog
from .api_projects import history_sources
from .benchmarks import Benchmarks

router = APIRouter(prefix="/api/catalog", tags=["catalog"])


class EntryIn(BaseModel):
    description: str = Field(min_length=1, max_length=300)
    unit: str = Field(default="", max_length=20)
    price: float
    wages: float | None = None
    materials: float | None = None
    plant: float | None = None
    source: str = ""
    price_date: str = ""
    region: str = ""
    note: str = ""


def _v(fn, *a):
    try:
        return fn(*a)
    except ValueError as e:
        raise HTTPException(422, str(e))


@router.get("")
def list_catalog():
    return {"entries": catalog.list_entries(), "settings": catalog.get_settings()}


@router.post("", status_code=201)
def add(body: EntryIn):
    return _v(catalog.add_entry, body.model_dump())


@router.post("/import")
async def import_file(file: UploadFile = File(...)):
    data = await file.read()
    if len(data) > 10 * 1024 * 1024:
        raise HTTPException(413, "File too large (10 MB maximum)")
    return _v(catalog.import_rows, file.filename or "upload", data)


class SettingsIn(BaseModel):
    yearly_increase_pct: float = 0
    region_factor: float = 1


@router.get("/settings")
def get_settings():
    return catalog.get_settings()


@router.put("/settings")
def put_settings(body: SettingsIn):
    return _v(catalog.set_settings, body.yearly_increase_pct, body.region_factor)


@router.put("/{eid}")
def edit(eid: str, body: EntryIn):
    r = _v(catalog.update_entry, eid, body.model_dump())
    if r is None:
        raise HTTPException(404, "Entry not found")
    return r


@router.delete("/{eid}", status_code=204)
def remove(eid: str):
    if not catalog.delete_entry(eid):
        raise HTTPException(404, "Entry not found")


@router.get("/suggestions")
def suggestions():
    hist = Benchmarks()
    for s in history_sources(""):
        hist.entries.extend(s["bench"].entries)
    return catalog.suggestions(hist)


class AcceptIn(BaseModel):
    items: list[dict]


@router.post("/suggestions/accept")
def accept(body: AcceptIn):
    return catalog.accept(body.items)


class RejectIn(BaseModel):
    keys: list[str]


@router.post("/suggestions/reject")
def reject(body: RejectIn):
    catalog.reject(body.keys)
    return {"ok": True}


@router.get("/log")
def get_log():
    return catalog.log()
