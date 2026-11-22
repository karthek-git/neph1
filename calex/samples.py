"""Sample files from the challenge dataset (optional) and the shared benchmark index."""
from __future__ import annotations
import os
from pathlib import Path
from fastapi import HTTPException
from . import benchmarks as bm

ROOT = Path(__file__).resolve().parent.parent
SAMPLES = Path(os.getenv("CALEX_SAMPLES", ROOT / "ds"))
EXTS = {".x83", ".x84", ".x86", ".d83", ".d84", ".d86", ".pdf", ".xlsx", ".docx"}
_BENCH = None


def sample_files() -> list[Path]:
    if not SAMPLES.exists():
        return []
    return sorted(p for p in SAMPLES.rglob("*") if p.is_file() and p.suffix.lower() in EXTS and "en" not in p.relative_to(SAMPLES).parts[:1])


def read_sample(name: str) -> tuple[str, bytes]:
    for p in sample_files():
        if str(p.relative_to(SAMPLES)) == name:
            return p.name, p.read_bytes()
    raise HTTPException(404, "Unknown sample")


def bench() -> bm.Benchmarks:
    global _BENCH
    if _BENCH is None:
        _BENCH = bm.load_dir(SAMPLES)
    return _BENCH
