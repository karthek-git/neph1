# Calex

Risk analysis and bid preparation for construction bills of quantities (BoQ / Leistungsverzeichnis), **for the bidder**.
An estimator drops in a BoQ (GAEB, PDF, Excel or Word) and, before pricing it, gets:

- a **risk report**: errors, unclear scope, cost or risk shifted to the contractor, dependencies on other trades, missing items,
  mismatched quantities across trades, optional items and likely change orders, with an overview, risk by trade and an indicative
  change-order exposure in EUR
- draft **bidder questions** for the question phase, in German (to send) and English (to read), editable, with a German Word letter
- a **bid**: unit prices with live totals, a suggested markup, a German Word offer summary and a **priced GAEB X84** written back into the tender
- **what-if** analysis on priced files (for example stainless steel +15 %), including the effect of optional and alternative items
- **versions**: a revised tender after the client's answers is compared with the previous version (items, wording, quantities, prices)
- **price knowledge**: indicative prices from your earlier projects and from your own price catalog

Built for the "AI Estimation and Bidding Assistant for Bills of Quantities" challenge.
The interface uses Google's **Material 3** components (`@material/web`) with React, has light, dark and device themes, and runs in English and German.

## The workflow

1. **Start**: drop files on the home page (a project is created and named after the first file) or type a project name.
2. **Reading**: every file is parsed into one common item format and stored. A quality check marks it *read well*, *please check* or *could not read*.
   Files the parser cannot read are tried by the **AI** (after a one-time consent, because the file text leaves the machine). Every item the AI returns
   is checked against the file text and dropped if it does not match; the rest stays marked "please check" until you confirm it.
   The **Parsed items** screen shows the common format with full inline editing and the original text beside it.
3. **Run**: a checklist asks what to run (risk analysis, version or tender-vs-award comparison, indicative price estimate, what-if scenarios).
   Steps that do not fit the files are greyed out with the reason. An optional switch runs the recommended steps automatically after upload.
4. **Results**: Overview, Findings (status per finding: needs review, needs clarification, reviewed, dismissed; kept across re-runs), Bidder questions, Changes since an earlier analysis.
5. **Bid**: Prices, Offer (Word), Export (priced X84).
6. **Library**: a price catalog (import Excel or CSV, edit, adjustments), with suggestions learned from your projects that only apply when you accept them.

## How it works

```
upload -> parse -> store items -> rule checks (code) -> AI text analysis -> dedupe + scoring -> report
```

- **Parsers**: GAEB XML (X83/X84/X86, versions 3.1 and 3.2), legacy GAEB 90 (D83/D84/D86, CP850 or Latin-1 detected, with prices and cost split),
  text PDFs (`pdftotext`), scanned PDFs (OCR via tesseract, with a warning), Excel (.xlsx/.xlsm) and Word (.docx). XML is parsed with `defusedxml`.
- **Rule checks** (`calex/checks.py`, `calex/dependencies.py`): duplicates, missing units, broken references, arithmetic, quantity outliers, broad lump sums,
  optional items, German phrase lists for vague wording and risk transfer, 13 cross-trade dependency rules (for example pipes without a pressure test item),
  and **cross-trade quantity consistency** (for example screed area against floor covering area).
- **AI text analysis** (`calex/llm.py`): reads item text in batches plus one whole-BoQ pass for contradictions and missing items. Every finding must quote the
  item text verbatim; findings whose quote is not in the item are discarded. Totals and structure are never left to the AI. A chain of models is tried in order
  because free-tier quotas are small.
- **Versions** (`calex/versions.py`): files of the same BoQ at the same stage are versions v1, v2 ... (latest = current); a bid or award is the next stage, not a version;
  an exact copy is a duplicate. The risk analysis runs on the current version.
- **Bid** (`calex/bidgen.py`): the X84 is the client's own X83 with only the prices and the phase marker changed, checked by reading it back.
  The markup suggestion is a transparent rule of thumb from the unresolved findings. The offer and the question letter are generated as Word files without extra libraries.
- **Price knowledge** (`calex/benchmarks.py`, `calex/catalog.py`): indicative ranges from the catalog first, then from the priced files of the projects you choose,
  always shown with their sources. Matching is text based and conservative.
- **What-if** (`calex/whatif.py`): uses a real wages/materials/plant/other split only if the file has one, otherwise an editable assumed split, labelled as an assumption.
- Without an AI key, Calex still runs everything except the AI text analysis and the AI extraction.

## Run

```bash
python3 -m venv .venv
.venv/bin/pip install fastapi "uvicorn[standard]" python-multipart google-genai openpyxl pillow defusedxml pytest httpx
cp .env.example .env          # then put your AI key in .env (gitignored)
.venv/bin/uvicorn calex.app:app --port 8000
# open http://localhost:8000
```

The built frontend is committed in `frontend/dist`, so Python is enough to run it. To change the UI:

```bash
cd frontend && npm install
npm run dev      # http://localhost:5173, proxies /api to :8000
npm run build    # writes frontend/dist, served by FastAPI
```

Projects, uploaded files, saved analyses and the catalog live in `data/` (set `CALEX_DATA` to move it; it is gitignored).
PDF support needs `pdftotext` (poppler-utils). OCR needs `pdftoppm` and `tesseract` (the German language pack gives better results).

Tests: `.venv/bin/python -m pytest -q tests` (91 tests; dataset-dependent tests are skipped when `ds/` is absent, the API tests use synthetic files).
The challenge dataset is not included in this repository. To use "Add from the challenge dataset", put the files in `ds/` or set `CALEX_SAMPLES`.

## Limits

- Findings are decision support for an estimator, not legal advice. Drafted questions and the offer must be reviewed before use; Calex never sends anything.
- The **X84 is not certified** against any client's software. Only prices and the phase marker change and the file is read back to check it, but test the import before you submit.
- The **change-order exposure** is an order of magnitude (10 % quantity deviation, the VOB/B §2 (3) threshold, times the price), not a forecast. The **markup suggestion** is a rule of thumb.
- **AI extraction** is validated against the source text but can still be incomplete. Its items stay unconfirmed until you confirm them, and analyses that use them carry a warning.
- Price benchmarks only help when your history contains the same or similar items; across unrelated projects the sample data gives almost no matches. The catalog index adjustment
  (Destatis construction price index) is entered by hand; there is no automatic fetch yet.
- The tender-vs-award link between added items and tender items is a rough text-similarity heuristic. One project is a story, not statistics.
- OCR is best effort and English-only unless the German pack is installed. PDFs that are contract forms or have a different layout may yield no items.
- German text is analysed as-is. The sample data is anonymised, so some words appear as placeholders like `[PERSON_115]`.
