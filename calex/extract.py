"""AI fallback: read a BoQ the normal parsers could not, and extract items into the common format.
Nothing the AI returns is trusted: item numbers, texts, units and every number must be found in the source text,
otherwise the item is dropped. Extracted files stay 'unconfirmed' until the user checks them."""
from __future__ import annotations
import io
import re
import shutil
from concurrent.futures import ThreadPoolExecutor
from pydantic import BaseModel
from . import llm
from .models import Item, Project

CHUNK = 9000
MAX_CHUNKS = 14

SYSTEM = """You extract the line items of a German or English construction Bill of Quantities (Leistungsverzeichnis) from raw text.
Return one entry per ITEM (position) that has an item number (OZ, like 01.02.0030 or 1.2.30).
Rules:
- Copy values exactly as written. Never invent, translate, or compute anything.
- oz: the item number exactly as written. short_text: the item's title or first description line, copied verbatim.
- long_text: further description lines of the same item, verbatim (may be empty).
- quantity, unit_price, total_price: numbers exactly as in the text (convert German format 1.250,50 to 1250.5), or null if absent.
- unit: unit of measure exactly as written (m, m2, m3, St, psch, kg, h ...), or empty.
- Skip section headings, sums, page headers and footers."""


class Extracted(BaseModel):
    oz: str
    short_text: str
    long_text: str = ""
    quantity: float | None = None
    unit: str = ""
    unit_price: float | None = None
    total_price: float | None = None


def source_text(name: str, data: bytes) -> str:
    """Plain text of a file in reading order, whatever its format."""
    ext = name.lower().rsplit(".", 1)[-1] if "." in name else ""
    try:
        if ext == "pdf" or data[:4] == b"%PDF":
            from .parsers.pdf import _text_pages, _ocr_pages
            pages = _text_pages(data)
            text = "\n".join(pages)
            if len(text.strip()) < 200 and shutil.which("tesseract"):
                text = "\n".join(_ocr_pages(data))
            return text
        if ext == "docx":
            import zipfile
            from defusedxml import ElementTree as ET
            from .parsers.docx import W, _text
            root = ET.fromstring(zipfile.ZipFile(io.BytesIO(data)).read("word/document.xml"))
            return "\n".join(t for t in (_text(p) for p in root.iter(W + "p")) if t)
        if ext in ("xlsx", "xlsm"):
            import openpyxl
            wb = openpyxl.load_workbook(io.BytesIO(data), data_only=True, read_only=True)
            lines = []
            for ws in wb.worksheets:
                for row in ws.iter_rows(values_only=True):
                    cells = [str(c).strip() for c in row if c not in (None, "")]
                    if cells:
                        lines.append("\t".join(cells))
            return "\n".join(lines)
    except Exception:
        pass
    if ext in ("d81", "d83", "d84", "d86"):
        from .parsers.gaeb_d import detect_encoding
        return data.decode(detect_encoding(data), errors="replace").replace("\r\n", "\n")
    raw = data.decode("utf-8", errors="replace") if b"\x00" not in data[:200] else data.decode("latin-1", errors="replace")
    if "<" in raw[:200] and ">" in raw[:400]:            # malformed XML: drop the tags but keep the text
        raw = re.sub(r"</(?:[A-Za-z]+:)?(?:Description|CompleteText|DetailTxt|OutlineText|Text|p|Item|BoQCtgy|Qty|QU|UP|IT)[^>]*>", "\n", raw)
        raw = re.sub(r"<[^>]+>", " ", raw)
        raw = re.sub(r"[ \t]+", " ", raw)
    return raw


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip().lower()


def _numbers(text: str) -> set[float]:
    out: set[float] = set()
    for tok in re.findall(r"\d[\d.,]*", text):
        t = tok.rstrip(".,")
        cands = []
        if "," in t and "." in t:
            cands.append(t.replace(".", "").replace(",", "."))
            cands.append(t.replace(",", ""))
        elif "," in t:
            cands.append(t.replace(",", "."))
            cands.append(t.replace(",", ""))
        else:
            cands.append(t)
            cands.append(t.replace(".", ""))
        for c in cands:
            try:
                out.add(round(float(c), 4))
            except ValueError:
                pass
    return out


def _chunks(text: str) -> list[str]:
    lines, out, cur, size = text.split("\n"), [], [], 0
    for ln in lines:
        if size + len(ln) > CHUNK and cur:
            out.append("\n".join(cur)); cur, size = [], 0
        cur.append(ln); size += len(ln) + 1
    if cur:
        out.append("\n".join(cur))
    return [c for c in out if len(c.strip()) > 40]


def validate(raw: list[Extracted], chunk: str) -> tuple[list[Item], int]:
    """Keep only items whose number, text, unit and numbers are all found in the source chunk."""
    flat = _norm(chunk)
    nums = _numbers(chunk)
    keep, dropped = [], 0
    for r in raw:
        oz = r.oz.strip()
        short = _norm(r.short_text)
        ok = bool(oz) and len(oz) <= 24 and oz.lower() in flat and len(short) >= 3
        if ok:
            probe = short[:40]
            ok = probe in flat
        if ok and r.unit.strip():
            ok = _norm(r.unit) in flat
        if ok:
            for v in (r.quantity, r.unit_price, r.total_price):
                if v is not None and round(float(v), 4) not in nums and round(float(v), 2) not in nums:
                    ok = False
                    break
        if not ok:
            dropped += 1
            continue
        section = oz.rsplit(".", 1)[0] if "." in oz else ""
        long_ok = _norm(r.long_text)[:40] in flat if r.long_text.strip() else True
        low = (r.short_text + " " + r.long_text).lower()
        kind = "optional" if re.search(r"bedarf|eventual", low) else "alternative" if re.search(r"alternativ", low) else "normal"
        if r.unit.strip().lower() in ("psch", "pauschal", "psch."):
            kind = "lump_sum"
        keep.append(Item(oz=oz, short_text=r.short_text.strip(), long_text=(r.long_text.strip() if long_ok else ""), quantity=r.quantity,
                         unit=r.unit.strip(), unit_price=r.unit_price, total_price=r.total_price, section=section, kind=kind,
                         trade=section.split(".")[0] if section else ""))
    return keep, dropped


def extract(name: str, data: bytes, progress=None) -> tuple[Project, dict]:
    """Run the AI over the file's text. Returns (project, stats). Raises RuntimeError if the AI is unavailable or every call failed."""
    if not llm.available():
        raise RuntimeError("AI is not configured (no API key), so this file cannot be extracted automatically.")
    text = source_text(name, data)
    if len(text.strip()) < 80:
        raise RuntimeError("No readable text was found in this file.")
    chunks = _chunks(text)[:MAX_CHUNKS]
    items: dict[str, Item] = {}
    stats = {"chunks": len(chunks), "dropped": 0, "errors": [], "truncated": len(_chunks(text)) > MAX_CHUNKS}

    def work(c: str):
        raw = llm._call("TEXT:\n" + c + "\n\nReturn the JSON array of items.", system=SYSTEM, schema=Extracted)
        return validate(raw, c)

    with ThreadPoolExecutor(max_workers=3) as ex:
        futs = [ex.submit(work, c) for c in chunks]
        for n, fu in enumerate(futs, 1):
            try:
                got, dropped = fu.result()
                stats["dropped"] += dropped
                for it in got:
                    items.setdefault(it.oz, it)
            except Exception as e:
                stats["errors"].append(str(e)[:200])
            if progress:
                progress(n, len(futs))
    if not items:
        raise RuntimeError("The AI could not extract any items that match the text. " + (stats["errors"][0] if stats["errors"] else ""))
    ordered = list(items.values())
    priced = any(i.unit_price for i in ordered)
    proj = Project(name=name.rsplit(".", 1)[0], phase="bid" if priced else "tender", source=name, items=ordered,
                   notes=[f"Items were extracted by AI from the file text ({len(ordered)} kept, {stats['dropped']} dropped because they did not match the text). Please check them."])
    stats["kept"] = len(ordered)
    return proj, stats
