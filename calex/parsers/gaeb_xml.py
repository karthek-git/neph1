"""Parser for GAEB DA XML (X83/X84/X86), versions 3.1 and 3.2 (namespaces differ, so we match local names)."""
from __future__ import annotations
import re
import xml.etree.ElementTree as ET   # types only
from defusedxml import ElementTree as SafeET   # parsing of uploaded files (no entity expansion)
from ..models import Item, Project


def _loc(e: ET.Element) -> str:
    return e.tag.split("}")[-1]


def _child(e: ET.Element, name: str):
    for c in e:
        if _loc(c) == name:
            return c
    return None


def _children(e: ET.Element, name: str):
    return [c for c in e if _loc(c) == name]


def _text(e: ET.Element | None) -> str:
    """Flatten rich text (p/span/br/li) into plain text, one paragraph per line."""
    if e is None:
        return ""
    paras: list[str] = []

    def walk(node: ET.Element, buf: list[str]):
        tag = _loc(node)
        if tag == "br":
            buf.append("\n")
        if node.text:
            buf.append(node.text)
        for ch in node:
            walk(ch, buf)
            if ch.tail:
                buf.append(ch.tail)

    blocks = [c for c in e.iter() if _loc(c) in ("p", "li")]
    if not blocks:
        buf: list[str] = []
        walk(e, buf)
        return re.sub(r"[ \t]+", " ", "".join(buf)).strip()
    top = [c for c in e.iter() if _loc(c) == "p"]
    for p in top:
        buf = []
        walk(p, buf)
        t = re.sub(r"[ \t]+", " ", "".join(buf)).strip()
        if t:
            paras.append(t)
    if not paras:
        buf = []
        walk(e, buf)
        return re.sub(r"[ \t]+", " ", "".join(buf)).strip()
    return "\n".join(paras)


def _num(s: str | None) -> float | None:
    if s is None:
        return None
    s = s.strip().replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return None


def parse_gaeb_xml(path_or_bytes, name: str = "") -> Project:
    if isinstance(path_or_bytes, (bytes, bytearray)):
        root = SafeET.fromstring(path_or_bytes)
    else:
        root = SafeET.parse(path_or_bytes).getroot()
        name = name or str(path_or_bytes).split("/")[-1]

    proj = Project(source=name)
    prj = next((e for e in root.iter() if _loc(e) == "PrjInfo"), None)
    if prj is not None:
        lbl = _child(prj, "LblPrj")
        nm = _child(prj, "NamePrj")
        proj.name = _text(lbl) or _text(nm)
        cur = _child(prj, "Cur")
        if cur is not None and cur.text:
            proj.currency = cur.text.strip()
    dp = next((e for e in root.iter() if _loc(e) == "DP"), None)
    phase_map = {"81": "tender", "82": "tender", "83": "tender", "84": "bid", "85": "bid", "86": "award", "87": "award"}
    proj.phase = phase_map.get((dp.text or "").strip(), "unknown") if dp is not None else "unknown"

    award = next((e for e in root.iter() if _loc(e) == "Award"), root)
    # Preamble: Award/AddText (general notes)
    add = _child(award, "AddText")
    if add is not None:
        proj.preamble = _text(_child(add, "DetailAddText") if _child(add, "DetailAddText") is not None else add)

    boq = _child(award, "BoQ")
    if boq is None:
        return proj
    body = _child(boq, "BoQBody")
    if body is None:
        return proj

    def walk_ctgy(ctgy: ET.Element, path: list[str], titles: list[str]):
        part = ctgy.attrib.get("RNoPart", "")
        lbl = _text(_child(ctgy, "LblTx"))
        newpath = path + [part] if part else path
        newtitles = titles + [lbl]
        sec_id = ".".join(newpath)
        proj.sections[sec_id] = lbl
        sub = _child(ctgy, "BoQBody")
        if sub is None:
            return
        for c in _children(sub, "BoQCtgy"):
            walk_ctgy(c, newpath, newtitles)
        il = _child(sub, "Itemlist")
        if il is not None:
            for it in _children(il, "Item"):
                proj.items.append(_parse_item(it, newpath, newtitles, name))

    for c in _children(body, "BoQCtgy"):
        walk_ctgy(c, [], [])
    return proj


def _parse_item(it: ET.Element, path: list[str], titles: list[str], source: str) -> Item:
    part = it.attrib.get("RNoPart", "")
    oz = ".".join(path + [part]) if part else ".".join(path)
    desc = _child(it, "Description")
    short = long_ = ""
    if desc is not None:
        ct = _child(desc, "CompleteText")
        if ct is not None:
            ot = _child(ct, "OutlineText")
            dt = _child(ct, "DetailTxt")
            short = _text(ot)
            long_ = _text(dt)
    qty = _num(_child(it, "Qty").text) if _child(it, "Qty") is not None else None
    qu = (_child(it, "QU").text or "").strip() if _child(it, "QU") is not None else ""
    up = _num(_child(it, "UP").text) if _child(it, "UP") is not None else None
    tot = _num(_child(it, "IT").text) if _child(it, "IT") is not None else None

    kind = "normal"
    if _child(it, "LumpSumItem") is not None or qu.lower() in ("psch", "psch.", "pauschal"):
        kind = "lump_sum"
    prov = _child(it, "Provis")
    if prov is not None:
        kind = "optional"
    if _child(it, "ALNGroupNo") is not None or _child(it, "ALNSerNo") is not None:
        kind = "alternative"
    if _child(it, "SubDescr") is not None:
        kind = "surcharge" if kind == "normal" else kind
    if qu.lower() in ("h", "std", "std.", "stunde", "stunden"):
        kind = "hourly" if kind == "normal" else kind
    refs = [(_text(r) or (r.text or "")).strip() for r in it if _loc(r) == "RefRNo"]
    return Item(
        oz=oz,
        short_text=short,
        long_text=long_,
        quantity=qty,
        unit=qu,
        unit_price=up,
        total_price=tot,
        section=".".join(path),
        section_title=titles[-1] if titles else "",
        trade=titles[0] if titles else "",
        kind=kind,
        refs=[r for r in refs if r],
        source=source,
    )
