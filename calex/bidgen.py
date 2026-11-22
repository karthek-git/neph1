"""Bid generation: priced GAEB X84 (written into a copy of the original X83), offer summary (Word), markup suggestion.
The X84 keeps the client's file byte for byte except for the prices and the phase marker. It is checked by reading it back,
but it is NOT certified against any client's software."""
from __future__ import annotations
import re
from . import docx_out
from .models import Project
from .parsers import parse_file

_ITEM = re.compile(r"(<Item\b[^>]*>)(.*?)(</Item>)", re.S)


class ExportError(ValueError):
    pass


def _num(x: float) -> str:
    return f"{x:.2f}"


def x84_from_x83(original: bytes, proj: Project, prices: dict[str, float], markup_pct: float = 0.0) -> tuple[bytes, dict]:
    """Write unit prices (UP) and totals (IT) into every item of the X83 and mark the file as a bid (DP 84).
    `prices` maps item number -> net unit price; markup_pct is added to every unit price."""
    text = original.decode("utf-8", errors="strict") if not original.startswith(b"\xef\xbb\xbf") else original.decode("utf-8-sig")
    m = re.search(r"<DP>\s*(\d+)\s*</DP>", text)
    if not m:
        raise ExportError("This does not look like a GAEB X83/X84 file (no phase marker).")
    if m.group(1) not in ("83", "84"):
        raise ExportError(f"The export needs a tender (X83) or an earlier bid (X84). This file is phase {m.group(1)}.")
    blocks = list(_ITEM.finditer(text))
    if len(blocks) != len(proj.items):
        raise ExportError("The item structure of this file is not supported for export (items could not be matched one to one).")
    factor = 1 + (markup_pct or 0) / 100
    out, last, priced, unpriced = [], 0, 0, []
    for blk, it in zip(blocks, proj.items):
        out.append(text[last:blk.start()])
        head, body, tail = blk.group(1), blk.group(2), blk.group(3)
        body = re.sub(r"<UP>.*?</UP>\s*", "", body, flags=re.S)
        body = re.sub(r"<IT>.*?</IT>\s*", "", body, flags=re.S)
        p = prices.get(it.oz)
        if p is not None:
            up = round(p * factor, 2)
            ins = f"<UP>{_num(up)}</UP>" + (f"<IT>{_num(round(up * it.quantity, 2))}</IT>" if it.quantity is not None else "")
            for tag in ("</QU>", "</Qty>"):
                if tag in body:
                    body = body.replace(tag, tag + ins, 1)
                    break
            else:
                body = ins + body
            priced += 1
        else:
            unpriced.append(it.oz)
        out.append(head + body + tail)
        last = blk.end()
    out.append(text[last:])
    result = "".join(out)
    result = re.sub(r"<DP>\s*83\s*</DP>", "<DP>84</DP>", result, count=1)
    data = result.encode("utf-8")
    # read it back: same items, phase bid, prices as intended
    back = parse_file("bid.x84", data)
    if len(back.items) != len(proj.items) or back.phase != "bid":
        raise ExportError("The generated file did not read back correctly, so it was not offered.")
    bad = [b.oz for b, it in zip(back.items, proj.items) if it.oz in prices and b.unit_price is not None and abs(b.unit_price - round(prices[it.oz] * factor, 2)) > 0.011]
    if bad:
        raise ExportError(f"Read-back check failed for {len(bad)} item(s), e.g. {bad[0]}.")
    return data, {"priced": priced, "unpriced": len(unpriced), "unpriced_items": unpriced[:30], "items": len(proj.items),
                  "net": round(sum((b.total_price or 0) for b in back.items), 2)}


def markup_hint(findings: list[dict], triage: dict) -> dict:
    """A transparent rule of thumb for the risk-and-profit markup, from the findings that are still unresolved.
    Base 2-4 %, plus 0.3 % per open high finding (max +4 %) and 0.1 % per open medium finding (max +2 %)."""
    open_ = [f for f in findings if triage.get(f.get("id"), {}).get("status", "review") in ("review", "clarify")]
    h = sum(1 for f in open_ if f["severity"] == "high")
    m = sum(1 for f in open_ if f["severity"] == "medium")
    extra = min(4.0, 0.3 * h) + min(2.0, 0.1 * m)
    return {"low": round(2.0 + extra, 1), "high": round(4.0 + extra, 1), "open_high": h, "open_medium": m,
            "rule": "2-4 % base, +0.3 % per open high finding (max +4 %), +0.1 % per open medium finding (max +2 %)"}


def offer_docx(project: str, net: float, markup_pct: float, vat_pct: float, validity_days: int, assumptions: list[str]) -> bytes:
    mk = net * markup_pct / 100
    net2 = net + mk
    vat = net2 * vat_pct / 100
    de = lambda v: f"{v:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    blocks = [para for para in (docx_out.para("[Absender: Firma, Anschrift]", color="777777"),
                                docx_out.para("[Empfänger: Auftraggeber]", color="777777"), docx_out.para("[Ort], [Datum]", align="right"))]
    blocks += [docx_out.para(f"Angebot: {project}", bold=True, size=32, after=200),
               docx_out.para("Sehr geehrte Damen und Herren,"),
               docx_out.para("wir bedanken uns für die Einladung zur Angebotsabgabe und bieten die Ausführung der ausgeschriebenen Leistungen zu den im beigefügten, bepreisten Leistungsverzeichnis angegebenen Einheitspreisen an."),
               docx_out.table([["Position", "Betrag (EUR)"],
                               ["Summe der Positionen netto", de(net)],
                               [f"Zuschlag Wagnis und Gewinn ({markup_pct:g} %)", de(mk)],
                               ["Angebotssumme netto", de(net2)],
                               [f"Umsatzsteuer ({vat_pct:g} %)", de(vat)],
                               ["Angebotssumme brutto", de(net2 + vat)]], widths=[6200, 3400], right_cols={1})]
    if assumptions:
        blocks.append(docx_out.para("Annahmen und Vorbehalte", bold=True, size=24, after=80))
        blocks.append(docx_out.para("Dem Angebot liegen folgende Annahmen zugrunde. Sollte die Klärung durch den Auftraggeber abweichend ausfallen, behalten wir uns eine Anpassung der Preise vor."))
        blocks += [docx_out.para(f"{i}. {a}") for i, a in enumerate(assumptions, 1)]
    blocks += [docx_out.para(f"Wir halten uns an dieses Angebot {validity_days} Kalendertage ab Angebotsabgabe gebunden."),
               docx_out.para("Mit freundlichen Grüßen"), docx_out.para("[Name], [Funktion]", color="777777")]
    return docx_out.build(blocks)
