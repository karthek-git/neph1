"""Common data model shared by all parsers and checks."""
from __future__ import annotations
from dataclasses import dataclass, field, asdict
from typing import Optional


@dataclass
class Item:
    oz: str                      # item number, e.g. "05.01.0030"
    short_text: str = ""
    long_text: str = ""
    quantity: Optional[float] = None
    unit: str = ""
    unit_price: Optional[float] = None
    total_price: Optional[float] = None
    section: str = ""            # dotted section path, e.g. "05.01"
    section_title: str = ""
    trade: str = ""              # top-level section title
    kind: str = "normal"         # normal | optional | lump_sum | surcharge | alternative | hourly
    refs: list[str] = field(default_factory=list)  # OZ of referenced items (surcharges)
    components: dict = field(default_factory=dict)  # unit-price split: wages / materials / plant / other
    source: str = ""             # file name

    @property
    def text(self) -> str:
        return (self.short_text + "\n" + self.long_text).strip()

    def to_dict(self) -> dict:
        d = asdict(self)
        d["text"] = self.text
        return d


@dataclass
class Project:
    name: str = ""
    phase: str = ""              # tender | bid | award | unknown
    source: str = ""
    currency: str = "EUR"
    preamble: str = ""           # general notes (Vorbemerkungen)
    items: list[Item] = field(default_factory=list)
    sections: dict[str, str] = field(default_factory=dict)  # dotted id -> title
    notes: list[str] = field(default_factory=list)          # warnings shown in the report (e.g. OCR used)


@dataclass
class Finding:
    category: str                # arithmetic | unit | duplicate | reference | quantity | optional |
                                 # vague | risk_transfer | interface | contradiction | missing | typo | lump_sum
    severity: str                # high | medium | low
    oz: str
    message: str
    quote: str = ""
    question: str = ""           # draft bidder question (German)
    message_de: str = ""         # German version of message
    question_en: str = ""        # English version of the bidder question
    source: str = "rule"         # rule | llm

    def to_dict(self) -> dict:
        return asdict(self)
