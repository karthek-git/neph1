"""Parser for legacy GAEB 90 fixed-width files (D81/D83/D84/D86).

Records are 80 columns, CRLF. Type = first two characters, line number = last six.
Used: 00 header, 01 project name, 11/12 section id/title, 21 item (qty+unit), 23 prices,
25 short text, 26 long text, 30 unit-price split. The T0/T1 variant (text supplements) carries no items,
but a D84 may consist of 23 price records only (items are then created from them).

Encoding differs between exporters (CP850 or Latin-1), so it is detected from the umlaut bytes.
Price fields: unit price has 3 decimals if 11 digits wide and 2 if 10; total price has 2; quantity 3.
"""
from __future__ import annotations
import re
from ..models import Item, Project

_ITEM = re.compile(r"^21([\d ]{2})([\d ]{2})\s*(\d+)\s+[A-Z]{3}\s+(\d{11})(\S*)")
_PRICE = re.compile(r"^23([\d ]{2})([\d ]{2})\s*(\d+)\s+(\d+)\s+(\d+)(?:\s+(\d+))?")
_SPLIT = re.compile(r"^30\s+((?:\d{10}){2,4})")
_PHASE = {"81": "tender", "83": "tender", "84": "bid", "86": "award", "89": "invoice"}
_COMP_NAMES = ["wages", "materials", "plant", "other"]


def detect_encoding(data: bytes) -> str:
    cp850 = sum(data.count(bytes([b])) for b in (0x84, 0x94, 0x81, 0xE1, 0x8E, 0x99, 0x9A))
    latin = sum(data.count(bytes([b])) for b in (0xE4, 0xF6, 0xFC, 0xDF, 0xC4, 0xD6, 0xDC))
    return "latin-1" if latin > cp850 else "cp850"


def _decode(data: bytes) -> list[str]:
    text = data.decode(detect_encoding(data), errors="replace")
    return text.replace("\r\n", "\n").split("\n")


def _oz(a: str, b: str, n: str) -> str:
    return f"{a.replace(' ', '0')}.{b.replace(' ', '0')}.{int(n)}"


def parse_gaeb_d(data: bytes, name: str = "") -> Project:
    lines = _decode(data)
    proj = Project(source=name)
    head = next((l for l in lines if l[:2] == "00"), "")
    proj.phase = _PHASE.get(head[10:12].strip(), "unknown")
    if proj.phase == "unknown":
        ext = name.lower().rsplit(".", 1)[-1] if "." in name else ""
        proj.phase = {"d83": "tender", "d84": "bid", "d86": "award", "d81": "tender"}.get(ext, "unknown")
    titles: dict[str, str] = {}
    cur: Item | None = None
    long_lines: list[str] = []
    pending_title: str | None = None
    by_oz: dict[str, Item] = {}

    def flush():
        nonlocal cur, long_lines
        if cur is not None:
            paras, buf = [], []
            for ln in long_lines:
                if not ln.strip():
                    if buf:
                        paras.append(" ".join(buf)); buf = []
                else:
                    buf.append(ln.strip())
            if buf:
                paras.append(" ".join(buf))
            if paras:
                cur.long_text = "\n".join(paras)
        cur, long_lines = None, []

    def new_item(a, b, n) -> Item:
        a, b = a.replace(" ", "0"), b.replace(" ", "0")
        it = Item(oz=_oz(a, b, n), section=f"{a}.{b}", section_title=titles.get(a + b, ""),
                  trade=titles.get(a, ""), source=name)
        proj.items.append(it)
        by_oz[it.oz] = it
        return it

    for ln in lines:
        if len(ln) < 2:
            continue
        t = ln[:2]
        body = ln[2:74]
        if t == "01" and not proj.name:
            proj.name = body[:38].strip()
        elif t == "11":
            # level-1 ids are 2 characters ("01"), level-2 ids 4 ("0101"); padding may be spaces (" 8")
            ident = body[:2] if not body[2:4].strip() else body[:4]
            pending_title = ident.replace(" ", "0") if ident.strip() else None
        elif t == "12" and pending_title:
            titles[pending_title] = body.strip()
            pending_title = None
        elif t == "21":
            flush()
            m = _ITEM.match(ln[:74])
            if not m:
                continue
            a, b, n, q, unit = m.groups()
            cur = new_item(a, b, n)
            cur.quantity = int(q) / 1000.0
            cur.unit = unit
            if unit.lower().startswith("psch"):
                cur.kind = "lump_sum"
        elif t == "23":
            m = _PRICE.match(ln[:74])
            if not m:
                continue
            a, b, n, up, tot, qty = m.groups()
            oz = _oz(a, b, n)
            it = by_oz.get(oz)
            if it is None:               # D84 with price records only
                flush()
                it = new_item(a, b, n)
            it.unit_price = int(up) / (1000.0 if len(up) >= 11 else 100.0)
            it.total_price = int(tot) / 100.0
            if qty is not None and it.quantity is None:
                it.quantity = int(qty) / 1000.0
            elif it.quantity is None and it.unit_price:
                it.quantity = round(it.total_price / it.unit_price, 3)
        elif t == "30" and cur is not None:
            m = _SPLIT.match(ln[:74])
            if m:
                vals = re.findall(r"\d{10}", m.group(1))
                comp = {_COMP_NAMES[i]: int(v) / 100.0 for i, v in enumerate(vals[:4]) if int(v)}
                if comp:
                    cur.components = comp
        elif t == "25" and cur is not None:
            cur.short_text = (cur.short_text + " " + body.strip()).strip() if cur.short_text else body.strip()
        elif t == "26" and cur is not None:
            long_lines.append(body[3:] if body.startswith("   ") else body)
    flush()
    for it in proj.items:
        proj.sections[it.section] = it.section_title
    return proj
