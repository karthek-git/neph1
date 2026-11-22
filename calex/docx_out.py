"""Minimal Word (.docx) writer: headings, paragraphs and simple tables, no external library."""
from __future__ import annotations
import io
import zipfile
from xml.sax.saxutils import escape

_CT = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
       '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
       '<Default Extension="xml" ContentType="application/xml"/>'
       '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
       '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>')
_RELS = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
         '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
_DOC_RELS = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
             '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>')
_STYLES = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
           '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault>'
           '<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults></w:styles>')
W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'


def _run(text: str, bold=False, size=None, color=None) -> str:
    rpr = ("<w:b/>" if bold else "") + (f'<w:color w:val="{color}"/>' if color else "") + (f'<w:sz w:val="{size}"/>' if size else "")
    parts = escape(text).split("\n")
    body = '<w:br/>'.join(f'<w:t xml:space="preserve">{p}</w:t>' for p in parts)
    return f"<w:r>{('<w:rPr>' + rpr + '</w:rPr>') if rpr else ''}{body}</w:r>"


def para(text: str = "", bold=False, size=None, align=None, after=None, color=None) -> str:
    ppr = (f'<w:jc w:val="{align}"/>' if align else "") + (f'<w:spacing w:after="{after}"/>' if after is not None else "")
    return f"<w:p>{('<w:pPr>' + ppr + '</w:pPr>') if ppr else ''}{_run(text, bold, size, color)}</w:p>"


def table(rows: list[list[str]], widths: list[int] | None = None, header=True, right_cols: set[int] | None = None) -> str:
    right_cols = right_cols or set()
    out = ['<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders>' + "".join(
        f'<w:{s} w:val="single" w:sz="4" w:space="0" w:color="BBBBBB"/>' for s in ("top", "left", "bottom", "right", "insideH", "insideV")) + '</w:tblBorders></w:tblPr>']
    for ri, row in enumerate(rows):
        out.append("<w:tr>")
        for ci, cell in enumerate(row):
            w = f'<w:tcW w:w="{widths[ci]}" w:type="dxa"/>' if widths else ""
            shade = '<w:shd w:val="clear" w:color="auto" w:fill="EEEEEE"/>' if header and ri == 0 else ""
            jc = '<w:jc w:val="right"/>' if ci in right_cols else ""
            out.append(f'<w:tc><w:tcPr>{w}{shade}</w:tcPr><w:p><w:pPr>{jc}<w:spacing w:after="40"/></w:pPr>{_run(str(cell), bold=header and ri == 0)}</w:p></w:tc>')
        out.append("</w:tr>")
    out.append("</w:tbl>" + para("", after=60))
    return "".join(out)


def build(blocks: list[str]) -> bytes:
    doc = (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document {W}><w:body>{"".join(blocks)}'
           '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>')
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", _CT)
        z.writestr("_rels/.rels", _RELS)
        z.writestr("word/_rels/document.xml.rels", _DOC_RELS)
        z.writestr("word/styles.xml", _STYLES)
        z.writestr("word/document.xml", doc)
    return buf.getvalue()


def question_letter(project: str, questions: list[dict], deadline: str = "") -> bytes:
    """German letter with the bidder questions, grouped by trade. Name, company and signature stay as placeholders."""
    blocks = [para("[Absender: Firma, Anschrift]", color="777777"), para("[Empfänger: Auftraggeber / Vergabestelle]", color="777777"),
              para("[Ort], [Datum]", align="right"),
              para(f"Bieterfragen zur Ausschreibung: {project}", bold=True, size=28, after=200),
              para("Sehr geehrte Damen und Herren,"),
              para("bei der Bearbeitung unseres Angebots sind uns die folgenden Punkte aufgefallen. Wir bitten um Klärung, damit alle Bieter auf derselben Grundlage kalkulieren können."
                   + (f" Wir bitten um Antwort bis {deadline}." if deadline else ""))]
    cur = None
    for i, q in enumerate(questions, 1):
        if q.get("trade") != cur:
            cur = q.get("trade")
            blocks.append(para(cur or "Allgemein", bold=True, size=24, after=80))
        ref = q.get("oz") or ""
        blocks.append(para(f"{i}. " + (f"Position {ref}: " if ref and "items" not in ref else "") + (q.get("question") or "")))
    blocks += [para("Wir bitten um Beantwortung an alle Bieter und um Berücksichtigung etwaiger Änderungen im Leistungsverzeichnis."),
               para("Mit freundlichen Grüßen"), para("[Name], [Funktion]", color="777777")]
    return build(blocks)
