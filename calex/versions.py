"""Versions: files of the same BoQ at the same stage (tender, bid, award) are versions of one another, ordered by upload time.
A file at a different stage is the next stage of the job, not a version. An exact copy is a duplicate, not a new version."""
from __future__ import annotations
import re
from .models import Project

TAG = {"tender": ("Original tender", "Revised tender"), "bid": ("Original bid", "Revised bid"), "award": ("Award", "Amended award")}


def signature(p: Project) -> list[tuple]:
    return [(i.oz, re.sub(r"\s+", " ", i.short_text).strip().lower(), i.quantity, i.unit, i.unit_price) for i in p.items]


def identical(a: Project, b: Project) -> bool:
    return signature(a) == signature(b)


def group_versions(files: list[dict], parsed: dict[str, Project], overlap) -> list[dict]:
    """Groups of files that are the same BoQ at the same stage. `overlap(a_file, b_file)` says whether two files are the same BoQ."""
    groups: list[list[dict]] = []
    for f in sorted((x for x in files if x["id"] in parsed), key=lambda x: x["uploaded"]):
        for g in groups:
            if g[0]["phase"] == f["phase"] and any(overlap(m, f) for m in g):
                g.append(f)
                break
        else:
            groups.append([f])
    out = []
    for g in groups:
        versions, prev = [], None
        for f in g:
            dup = prev is not None and any(identical(parsed[m["id"]], parsed[f["id"]]) for m in g[:len(versions)])
            versions.append({"file_id": f["id"], "name": f["name"], "number": len(versions) + 1, "phase": f["phase"], "items": f["items"],
                             "uploaded": f["uploaded"], "duplicate": dup})
            prev = f
        real = [v for v in versions if not v["duplicate"]]
        for n, v in enumerate(real, 1):
            v["number"] = n
            v["tag"] = TAG.get(v["phase"], ("Original", "Revised"))[0 if n == 1 else 1]
            v["current"] = n == len(real)
        for v in versions:
            if v["duplicate"]:
                v.update(number=0, tag="Duplicate", current=False)
        out.append({"stage": g[0]["phase"] or "unknown", "name": re.sub(r"\.[^.]+$", "", g[0]["name"]), "versions": versions})
    order = {"tender": 0, "bid": 1, "award": 2}
    out.sort(key=lambda g: (order.get(g["stage"], 3), g["name"]))
    return out
