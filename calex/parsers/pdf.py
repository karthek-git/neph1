"""Parser for text-based BoQ PDFs in the common 'OZ / Leistungsbeschreibung / Menge ME / EP / GP' layout.

Uses poppler's `pdftotext -layout`. Item header: an item number such as `6.1.10.` followed by a title.
The item ends at its quantity line (`275,000 m2 ....`), which may also carry unit price and total (priced bids).
Other PDFs (contract forms, scans) produce no items and raise a clear error.
"""
from __future__ import annotations
import re
import shutil
import subprocess
import tempfile
from ..models import Item, Project

_NUM = r"-?\d{1,3}(?:\.\d{3})*,\d+|-?\d+,\d+"
_HEAD = re.compile(r"^\s{0,8}(\d{1,3}(?:\.\d{1,5})*)\.?\s{2,}(\S.*?)\s*$")
_HEAD_PRICED = re.compile(rf"^\s{{0,40}}(\d{{1,3}}(?:\.\d{{1,5}})+)\.?\s{{2,}}({_NUM})\s+(\S{{1,8}})\s*(.*)$")
_QTY = re.compile(rf"^\s{{2,}}({_NUM})\s+([A-Za-zÄÖÜäöü][A-Za-zÄÖÜäöü0-9²³/.%-]{{0,7}})(?=\s|$)(.*)$")
# OCR loses the indentation, so the quantity line is recognised by content: number, short unit, then only leaders/prices
_QTY_OCR = re.compile(rf"^\s*({_NUM})\s+([A-Za-zÄÖÜäöü][A-Za-zÄÖÜäöü0-9²³/.%-]{{0,7}})(?=\s|$)([\s.…_,\d-]*)$")
_NOISE = re.compile(r"(Druckdatum|Seite\s*:?\s*\d+|Übertrag|Ordnungszahl\s+Leistungsbeschreibung|Pos-Nr\.|Leistungsverzeichnis Kurz- und Langtext|^\s*OZ\s+Leistungsbeschreibung|Summe Abschnitt|Tel\.|Fax\.?|www\.|@)", re.I)
_PRICE = re.compile(_NUM)


def _de(s: str) -> float:
    return float(s.replace(".", "").replace(",", "."))


def _ocr_pages(data: bytes, max_pages: int = 40) -> list[str]:
    """OCR fallback for scanned PDFs (needs pdftoppm + tesseract). German pack is used if installed, else English."""
    from concurrent.futures import ThreadPoolExecutor
    from pathlib import Path
    if not (shutil.which("pdftoppm") and shutil.which("tesseract")):
        raise ValueError("This PDF has no text layer (scanned) and OCR is not installed (needs poppler and tesseract).")
    langs = subprocess.run(["tesseract", "--list-langs"], capture_output=True, text=True).stdout
    lang = "deu+eng" if "deu" in langs.split() else "eng"
    with tempfile.TemporaryDirectory() as d:
        src = Path(d) / "in.pdf"
        src.write_bytes(data)
        subprocess.run(["pdftoppm", "-r", "300", "-l", str(max_pages), "-png", str(src), str(Path(d) / "pg")],
                       capture_output=True, timeout=300)
        pngs = sorted(Path(d).glob("pg-*.png"))
        def one(png):
            r = subprocess.run(["tesseract", str(png), "-", "-l", lang, "--psm", "4", "-c", "preserve_interword_spaces=1"],
                               capture_output=True, timeout=120)
            return r.stdout.decode("utf-8", errors="replace")
        with ThreadPoolExecutor(max_workers=4) as ex:
            return list(ex.map(one, pngs))


def _text_pages(data: bytes) -> list[str]:
    if not shutil.which("pdftotext"):
        raise ValueError("PDF support needs poppler (the 'pdftotext' command). Install poppler-utils.")
    with tempfile.NamedTemporaryFile(suffix=".pdf") as f:
        f.write(data); f.flush()
        out = subprocess.run(["pdftotext", "-layout", f.name, "-"], capture_output=True, timeout=120)
    if out.returncode != 0:
        raise ValueError("Could not read the PDF (is it encrypted or damaged?)")
    return out.stdout.decode("utf-8", errors="replace").split("\f")


def _kind(unit: str, title: str, text: str) -> str:
    u = unit.lower().rstrip(".")
    head = (title + " " + text[:200]).lower()
    if re.search(r"bedarfsposition|eventualposition|\(bedarf\)|bedarfspos", head): return "optional"
    if re.search(r"alternativ", head): return "alternative"
    if title.lower().startswith("zulage") or re.search(r"\bzulage\b", title.lower()): return "surcharge"
    if u in ("psch", "pauschal", "pausch"): return "lump_sum"
    if u in ("h", "std", "stunde", "stunden"): return "hourly"
    return "normal"


def parse_pdf(data: bytes, name: str = "") -> Project:
    pages = _text_pages(data)
    ocr = False
    if sum(len(p.strip()) for p in pages) < 200:
        pages = _ocr_pages(data)
        ocr = True
        if sum(len(p.strip()) for p in pages) < 200:
            raise ValueError("This PDF has no readable text, even after OCR.")
    proj = Project(source=name, phase="tender")
    if ocr:
        proj.notes.append("Scanned PDF: text was read with OCR (at most the first 40 pages) and may contain recognition errors. "
                          "Check quantities and item text against the original before relying on findings.")
    titles: dict[str, str] = {}
    pend: dict | None = None
    lines_all: list[str] = []
    for pg in pages:
        ls = pg.split("\n")
        # skip page header: everything up to the table header row, if one exists in the first 25 lines
        start = 0
        for i, ln in enumerate(ls[:25]):
            if re.search(r"(Leistungsbeschreibung|Pos-Nr)", ln) and re.search(r"Menge|Einheit|Gesamt", ln):
                start = i + 1
        for ln in ls[start:]:
            m = re.match(r"^\s*Projekt:\s+(\S.*?)\s{2,}(\S.*)?$", ln)
            if m and not proj.name:
                proj.name = (m.group(2) or m.group(1)).strip()
            lines_all.append(ln)

    def finish_unpriced(p):
        """The real quantity line is the LAST quantity-like line before the next item (descriptions may contain look-alikes)."""
        idx, q, unit, rest = p["cands"][-1]
        lines = p["lines"][:idx] + p["lines"][idx + 1:]
        nums = _PRICE.findall(rest.replace("....", " "))
        up = _de(nums[0]) if len(nums) >= 1 else None
        tot = _de(nums[1]) if len(nums) >= 2 else None
        finish({**p, "lines": lines}, _de(q), unit, up, tot)
        return up is not None

    def finish(p, qty=None, unit="", up=None, tot=None):
        title = p["title"]; text = "\n".join(p["lines"]).strip()
        oz = p["oz"]
        parts = oz.split(".")
        sec = ".".join(parts[:-1])
        it = Item(oz=oz, short_text=title, long_text=text, quantity=qty, unit=unit, unit_price=up, total_price=tot,
                  section=sec, section_title=titles.get(sec, ""), trade=titles.get(parts[0], ""), source=name,
                  kind=_kind(unit, title, text))
        proj.items.append(it)

    priced = False
    for ln in lines_all:
        if not ln.strip():
            if pend is not None and pend["lines"] and pend["lines"][-1] != "":
                pend["lines"].append("")
            continue
        if _NOISE.search(ln):
            continue
        mp = _HEAD_PRICED.match(ln)
        if mp:                                   # priced layout: OZ, qty, unit, EP, GP on one line
            if pend is not None:
                if pend.get("priced"):
                    finish(pend, pend["qty"], pend["unit"], pend["up"], pend["tot"])
                elif pend.get("cands"):
                    priced = finish_unpriced(pend) or priced
                else:
                    titles[pend["oz"]] = pend["title"]
            oz, q, unit, rest = mp.groups()
            nums = _PRICE.findall(rest)
            pend = {"oz": oz, "title": "", "lines": [], "qty": _de(q), "unit": unit,
                    "up": _de(nums[0]) if len(nums) >= 1 else None, "tot": _de(nums[1]) if len(nums) >= 2 else None, "priced": True}
            priced = True
            continue
        mh = _HEAD.match(ln)
        if mh and not _QTY.match(ln) and not re.match(r"^\s*\d+\s{2,}\d", ln):
            if pend is not None:
                if pend.get("priced"):
                    finish(pend, pend["qty"], pend["unit"], pend["up"], pend["tot"])
                elif pend.get("cands"):
                    priced = finish_unpriced(pend) or priced
                else:
                    titles[pend["oz"]] = pend["title"]   # header without quantity = section
            pend = {"oz": mh.group(1), "title": mh.group(2).strip(), "lines": [], "cands": []}
            continue
        if pend is None:
            continue
        if pend.get("priced") and not pend["title"]:
            pend["title"] = ln.strip(); continue
        mq = (_QTY_OCR if ocr else _QTY).match(ln)
        if mq and not pend.get("priced"):
            q, unit, rest = mq.groups()
            pend["cands"].append((len(pend["lines"]), q, unit, rest))
            pend["lines"].append("")          # placeholder keeps indexes aligned; removed if this is the real quantity line
            continue
        pend["lines"].append(re.sub(r"\s{2,}", " ", ln.strip()))
    if pend is not None and pend.get("priced"):
        finish(pend, pend["qty"], pend["unit"], pend["up"], pend["tot"])
    elif pend is not None and pend.get("cands"):
        priced = finish_unpriced(pend) or priced
    if priced:
        proj.phase = "bid"
    for it in proj.items:   # fill section titles now that all headers are known
        it.section_title = titles.get(it.section, it.section_title)
        it.trade = titles.get(it.oz.split(".")[0], it.trade)
        proj.sections[it.section] = it.section_title
    if not proj.items:
        raise ValueError("No BoQ items recognised in this PDF. Supported: text PDFs listing numbered items with quantity and unit; "
                         "GAEB files (X83/D83) give the most reliable results.")
    return proj
