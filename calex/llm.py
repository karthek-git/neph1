"""Gemini-based text analysis. Findings are validated against the item text before they are shown."""
from __future__ import annotations
import os
import re
import json
import time
import threading
from concurrent.futures import ThreadPoolExecutor
from typing import Literal
from pydantic import BaseModel
from .models import Item, Project, Finding

# Model chain, tried in order. The free tier has small per-model daily quotas (3.5-flash: 20 requests/day),
# so when one model reports a daily limit we move on to the next. Override with GEMINI_MODELS="a,b,c".
DEFAULT_CHAIN = ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3.5-flash"]
DEFAULT_MODEL = DEFAULT_CHAIN[0]
_dead: set[str] = set()
_lock = threading.Lock()


def chain() -> list[str]:
    env = os.getenv("GEMINI_MODELS") or os.getenv("GEMINI_MODEL")
    return [m.strip() for m in env.split(",") if m.strip()] if env else DEFAULT_CHAIN


def _alive() -> list[str]:
    with _lock:
        return [m for m in chain() if m not in _dead] or chain()


def _daily_limit(msg: str) -> bool:
    return "429" in msg and bool(re.search(r"retry in \d+h|PerDay|per day", msg, re.I))
BATCH = 16
MAX_ITEMS = 160          # cap the number of items sent for per-item analysis
MAX_CHARS = 1800         # per item text

SYSTEM = """You are a senior German construction estimator (Kalkulator) reviewing a tender Bill of Quantities (Leistungsverzeichnis) for a BIDDER, before they price it.
Find problems that cause pricing risk, disputes or change orders (Nachträge). Be precise and conservative: report only real issues, at most 2 per item, none if the item is fine.
Categories:
- vague: unclear, open or unmeasurable scope or specification
- contradiction: this item contradicts the preamble or another item (name the other item number in the explanation)
- missing: work that is clearly needed by this item but is not listed anywhere (explain what is missing)
- typo: spelling or numeric error, wrong unit, wrong standard or product designation
- risk_transfer: unusual risk or cost placed on the contractor (unknown conditions, unpaid extras, liability)
- interface: depends on another trade or the client, with unclear responsibility
Rules:
- "quote" MUST be copied verbatim (character for character) from the item text, at most 200 characters.
- "explanation" is 1-2 sentences in English, concrete; "explanation_de" is the same in German.
- "question_de" is a neutral, polite bidder question in German that cites the item number; "question_en" is the same question in English. Never mention prices, margins or strategy.
- severity: high = likely to cause a dispute or large cost, medium = should be clarified before pricing, low = minor.
- The texts may contain anonymisation placeholders like [PERSON_115] or ###; ignore them."""


class LLMFinding(BaseModel):
    oz: str
    category: Literal["vague", "contradiction", "missing", "typo", "risk_transfer", "interface"]
    severity: Literal["high", "medium", "low"]
    quote: str
    explanation: str
    explanation_de: str
    question_de: str
    question_en: str


def available() -> bool:
    return bool(os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY"))


def _client():
    from google import genai
    return genai.Client(api_key=os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY"))


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip().lower()


def _call(prompt: str, model: str | None = None, retries: int = 6) -> list[LLMFinding]:
    from google.genai import types
    client = _client()
    last: Exception | None = None
    for attempt in range(retries):
        m = model if (model and attempt == 0 and model not in _dead) else _alive()[0]
        try:
            resp = client.models.generate_content(
                model=m,
                contents=prompt,
                config=types.GenerateContentConfig(
                    system_instruction=SYSTEM,
                    response_mime_type="application/json",
                    response_schema=list[LLMFinding],
                    temperature=0.1,
                    http_options=types.HttpOptions(timeout=60000),
                ),
            )
            data = json.loads(resp.text or "[]")
            return [LLMFinding(**d) for d in data]
        except Exception as e:  # network, quota, parse
            last = e
            msg = str(e)
            if _daily_limit(msg) or "404" in msg or "NOT_FOUND" in msg:
                with _lock:
                    _dead.add(m)       # unusable today: skip it from now on
                continue
            rate = "429" in msg or "RESOURCE_EXHAUSTED" in msg or "503" in msg or "UNAVAILABLE" in msg or "504" in msg
            time.sleep((6 if rate else 2) * (attempt + 1))
    raise RuntimeError(f"Gemini call failed: {last}")


def _batch_prompt(batch: list[Item], preamble: str) -> str:
    rows = [{"oz": i.oz, "section": i.section_title, "unit": i.unit, "quantity": i.quantity, "kind": i.kind,
             "text": i.text[:MAX_CHARS]} for i in batch]
    pre = f"PREAMBLE (general notes of the BoQ, excerpt):\n{preamble[:2500]}\n\n" if preamble.strip() else ""
    return f"{pre}ITEMS (JSON):\n{json.dumps(rows, ensure_ascii=False)}\n\nReturn a JSON array of findings (empty array if none)."


def _global_prompt(items: list[Item]) -> str:
    outline = [{"oz": i.oz, "t": i.short_text[:90], "u": i.unit, "q": i.quantity} for i in items[:400]]
    return ("Review the WHOLE BoQ outline below for cross-item problems only: (a) contradictions between items, "
            "(b) clearly missing items or cross-trade dependencies (e.g. a component is specified but a required "
            "accessory, preparation, connection or recess is nowhere listed), (c) duplicated scope. "
            "Attach each finding to the most relevant item number (oz) and quote that item's text from the outline. "
            "Report at most 12 findings, only strong ones.\n\nOUTLINE (JSON):\n" + json.dumps(outline, ensure_ascii=False))


def analyze(project: Project, prioritized: list[str] | None = None, model: str | None = None,
            progress=None) -> tuple[list[Finding], list[str]]:
    """Returns (findings, errors). `prioritized` is a list of item numbers to analyse first."""
    items = [i for i in project.items if len(i.text) > 25]
    if prioritized:
        order = {oz: n for n, oz in enumerate(prioritized)}
        items.sort(key=lambda i: order.get(i.oz, 10**6))
    items = items[:MAX_ITEMS]
    by_oz = {i.oz: i for i in project.items}
    batches = [items[n:n + BATCH] for n in range(0, len(items), BATCH)]
    findings: list[Finding] = []
    errors: list[str] = []
    done = 0

    def validate(raw: list[LLMFinding], pool: dict[str, Item]) -> list[Finding]:
        out = []
        for r in raw:
            it = pool.get(r.oz)
            if it is None:
                continue
            if re.search(r"placeholder|platzhalter|anonymi[sz]ed|redact", r.explanation + " " + r.question_de, re.I):
                continue  # dataset anonymisation artefact, not a real BoQ issue
            q = r.quote.strip().strip("…").strip()
            if len(q) < 8 or _norm(q) not in _norm(it.text):
                continue  # hallucinated or paraphrased quote: discard
            out.append(Finding(category=r.category, severity=r.severity, oz=it.oz, message=r.explanation.strip(),
                               message_de=r.explanation_de.strip(), question_en=r.question_en.strip(),
                               quote=q, question=r.question_de.strip(), source="llm"))
        return out

    def work(batch):
        pool = {i.oz: i for i in batch}
        return validate(_call(_batch_prompt(batch, project.preamble), model), pool)

    with ThreadPoolExecutor(max_workers=3) as ex:
        futs = [ex.submit(work, b) for b in batches]
        futs.append(ex.submit(lambda: validate(_call(_global_prompt(project.items), model), by_oz)))
        for fu in futs:
            try:
                findings += fu.result()
            except Exception as e:
                errors.append(str(e)[:300])
            done += 1
            if progress:
                progress(done, len(futs))
    return findings, errors
