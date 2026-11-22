"""Word documents (.docx): tables are read like Excel sheets; otherwise lines such as '1.1.10 – Text [unit]' are read as a
position list (no quantities). Headings become sections; the connectors 'oder' / 'mit' mark alternative and combined groups.
Read with the standard library only (a .docx is a zip with XML)."""
from __future__ import annotations
import re
import zipfile
import io
from defusedxml import ElementTree as ET
from ..models import Item, Project
from .tabular import items_from_rows

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
_ITEM = re.compile(r"^\s*(\d+(?:\.\d+)+)\.?\s*[–—-]\s*(.+?)\s*(?:\[([^\]]*)\])?\s*$")
_ITEM_PLAIN = re.compile(r"^\s*(\d+(?:\.\d+)+)\.?\s+(\S.*?)\s*(?:\[([^\]]*)\])?\s*$")
_CONNECT = {"oder": "alt", "mit": "with", "und": "with", "sowie": "with"}


def _text(el) -> str:
    out = []
    for n in el.iter():
        if n.tag == W + "t" and n.text:
            out.append(n.text)
        elif n.tag == W + "tab":
            out.append(" ")
        elif n.tag == W + "br":
            out.append("\n")
    return "".join(out).strip()


def parse_docx(data: bytes, name: str = "") -> Project:
    try:
        z = zipfile.ZipFile(io.BytesIO(data))
        root = ET.fromstring(z.read("word/document.xml"))
    except Exception as e:
        raise ValueError(f"Could not read the Word file ({e}). Only .docx is supported, not the old .doc format.")
    body = root.find(W + "body")
    proj = Project(source=name, name=(name.rsplit(".", 1)[0] if name else ""), phase="tender")
    items: list[Item] = []
    heading, mode = "", "normal"
    table_items: list[Item] = []
    for child in body:
        if child.tag == W + "tbl":
            rows = [[_text(c) for c in tr.findall(W + "tc")] for tr in child.findall(W + "tr")]
            got = items_from_rows(rows, name, default_trade=heading)
            if got:
                table_items += got
            continue
        if child.tag != W + "p":
            continue
        line = _text(child)
        if not line or set(line) <= {"…", ".", " "}:
            continue
        m = _ITEM.match(line) or _ITEM_PLAIN.match(line)
        if m and len(line) < 400:
            oz, text, unit = m.group(1), m.group(2).strip(), (m.group(3) or "").strip()
            parts = oz.split(".")
            it = Item(oz=oz, short_text=text, unit=unit, section=".".join(parts[:-1]), section_title=heading, trade=heading, source=name,
                      kind="alternative" if mode == "alt" else "normal")
            if unit.lower().rstrip(".") in ("psch", "pauschal"):
                it.kind = "lump_sum" if mode != "alt" else "alternative"
            items.append(it)
            continue
        key = line.lower().strip(" :")
        if key in _CONNECT:
            mode = _CONNECT[key]
            continue
        if len(line) <= 120:
            heading, mode = line, "normal"            # a heading starts a new group
    proj.items = table_items + items
    if not proj.items:
        raise ValueError("No BoQ items found in this Word file. Calex reads tables with item number, description and quantity/unit "
                         "columns, or lines like '1.1.10 – Description [unit]'.")
    if items and not table_items:
        proj.notes.append("Word position list: it contains item numbers, descriptions and units but no quantities or prices, "
                          "so quantity and price checks are not possible. Use a GAEB, PDF or Excel BoQ for a full analysis.")
    for it in proj.items:
        proj.sections[it.section] = it.section_title
    return proj
