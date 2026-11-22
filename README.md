# Calex

Risk analysis of construction bills of quantities (BoQ / Leistungsverzeichnis) **for the bidder**.
An estimator uploads a BoQ and gets, before pricing it:

- a ranked list of risks: errors, unclear scope, cost or risk shifted to the contractor, dependencies on other trades,
  missing items, optional items and likely change orders
- draft **bidder questions** for the tender's question phase, in German (to send) and English (to read), grouped by trade,
  exportable as text, CSV or Excel
- a **bid sheet** to enter unit prices with live totals and markup, optionally pre-filled from historical prices
- a **what-if** analysis (for example stainless steel +15 %) on a priced file
- a **tender-vs-award** comparison showing which items were added after the tender

Built for the "AI Estimation and Bidding Assistant for Bills of Quantities" challenge.
The UI (React + Material UI, light and dark, English and German) opens on a list of **projects**. A project holds all the files of one
tender; you can run analyses on any selection of its files at any time, and every analysis, bid sheet and file is saved
(SQLite plus a `data/` folder). Analysing several files together lets the cross-trade checks see the whole set.

## How it works

```
upload -> parse -> rule checks (code) -> Gemini text analysis -> dedupe + scoring -> report
```

- **Parsers:** GAEB XML (X83/X84/X86, versions 3.1 and 3.2), legacy GAEB 90 (D83/D84/D86, CP850 or Latin-1 detected,
  with prices and cost split), text PDFs (via poppler's `pdftotext`) and scanned PDFs (OCR via tesseract, with a warning).
  The PDF parser reproduces the D84 of the same project exactly (274 items, identical quantities and totals).
- **Rule checks** (`calex/checks.py`, `calex/dependencies.py`): duplicates, missing units, broken references, arithmetic,
  quantity outliers, broad lump sums, optional (Bedarf) items, German phrase lists for vague wording, cost or risk placed on
  the contractor and hand-offs to other trades, plus a table of cross-trade dependencies (for example pipes without a pressure
  test item). Wording that repeats in 8 or more items is downgraded and asked about once.
- **Gemini analysis** (`calex/llm.py`): reads item text in batches plus one whole-BoQ pass for contradictions and missing items.
  Every finding must quote the item text verbatim; findings whose quote is not in the item are discarded. Totals and structure are
  never left to the LLM. A chain of models is tried in order because free-tier quotas are small and per model.
- **Price benchmarks** (`calex/benchmarks.py`): indicative unit-price ranges from earlier priced files with the same unit and similar
  text, always shown with their sources. They help when your own history contains the same or a similar BoQ; across unrelated
  projects the sample data gives almost no matches (0 % in a leave-one-project-out test), and the UI says how many items matched.
- **What-if** (`calex/whatif.py`): uses a real wages/materials/plant/other split only if the file has one. The sample award file
  puts the whole price in the first slot, so an editable assumed split (default 45/40/10/5) is used and labelled as an assumption.
- Without a Gemini key, Calex still runs everything except the LLM text analysis.

## Run

```bash
python3 -m venv .venv
.venv/bin/pip install fastapi "uvicorn[standard]" python-multipart google-genai openpyxl pillow pytest httpx
cp .env.example .env          # then put your Gemini key in .env (gitignored)
.venv/bin/uvicorn calex.app:app --port 8000
# open http://localhost:8000
```

The built frontend is committed in `frontend/dist`, so Python is enough to run it. To change the UI:

```bash
cd frontend && npm install
npm run dev      # http://localhost:5173, proxies /api to :8000
npm run build    # writes frontend/dist, served by FastAPI
```

Projects, uploaded files and saved analyses live in `data/` (set `CALEX_DATA` to move it; it is gitignored).

PDF support needs `pdftotext` (poppler-utils). OCR for scanned PDFs needs `pdftoppm` and `tesseract`
(the German language pack gives better results; English is used if it is missing).

Tests: `.venv/bin/python -m pytest -q tests` (dataset-dependent tests are skipped when `ds/` is absent; the project API tests use synthetic files).
The challenge dataset is not included in this repository. To use "Add from the challenge dataset", put the files in `ds/` or set `CALEX_SAMPLES`.

## Limits

- Findings are decision support for an estimator, not legal advice. Drafted questions must be reviewed before sending; Calex never sends anything.
- The tender-vs-award link between added items and tender items is a rough text-similarity heuristic. One project is a story, not statistics.
- OCR is best effort and English-only unless the German pack is installed. PDFs that are contract forms or have a different layout may yield no items.
- German text is analysed as-is. The sample data is anonymised, so some words appear as placeholders like `[PERSON_115]`.
