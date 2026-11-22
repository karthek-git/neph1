from __future__ import annotations
from ..models import Project
from .gaeb_xml import parse_gaeb_xml
from .gaeb_d import parse_gaeb_d
from .pdf import parse_pdf
from .xlsx import parse_xlsx
from .docx import parse_docx

XML_EXT = {".x81", ".x83", ".x84", ".x86", ".xml"}
D_EXT = {".d81", ".d83", ".d84", ".d86"}


def parse_file(name: str, data: bytes) -> Project:
    ext = "." + name.lower().rsplit(".", 1)[-1] if "." in name else ""
    if ext in XML_EXT or data.lstrip()[:5] == b"<?xml":
        return parse_gaeb_xml(data, name)
    if ext in (".xlsx", ".xlsm"):
        return parse_xlsx(data, name)
    if ext == ".docx":
        return parse_docx(data, name)
    if ext in (".xls", ".doc"):
        raise ValueError(f"The old {ext} format is not supported. Please save the file as {ext}x (.xlsx / .docx) and upload it again.")
    if ext == ".pdf" or data[:4] == b"%PDF":
        return parse_pdf(data, name)
    if ext in D_EXT:
        return parse_gaeb_d(data, name)
    raise ValueError(f"Unsupported file type: {name} (supported: GAEB X83/X84/X86, D83/D84/D86, PDF, Excel .xlsx, Word .docx)")


def norm_oz(oz: str) -> str:
    """'01.01.0004' and '1.1.4' compare equal."""
    parts = []
    for p in oz.split("."):
        parts.append(str(int(p)) if p.isdigit() else p)
    return ".".join(parts)
