# Calex (BoQ risk assistant): design

Status: DRAFT, awaiting approval. Date: 2026-11-21.
Related: `challenge.txt` (the brief), `domain_primer.md` (terminology), `ds/` (dataset, German originals), `ds/en/` (English reading copy of the 8209.003 folder).

## 1. Intent

Build a prototype for the hackathon challenge "AI Estimation and Bidding Assistant for Bills of Quantities".

An estimator (Kalkulator) at a contracting company uploads a BoQ (Leistungsverzeichnis, LV) and gets, before pricing it:
- a risk report: errors, vague scope, unusual quantities, change-order potential
- a list of bidder questions (Bieterfragen) to send to the client during the tender's question phase

Why: BoQs have thousands of lines and cross-trade dependencies, and nobody has time to read them closely. If the BoQ is wrong or vague, the bidder usually carries the cost unless they raise it before the deadline. The tool turns hours of reading into a ranked list to check.

Deliverables (from the brief): a web demo with upload and risk report, plus a pitch from the estimator's perspective.

## 2. Goals, non-goals, anti-goals

**Goals**
- Parse BoQs from GAEB (X83, D83, D84, D86) and text-based PDF into one common item structure.
- Find errors (priority per the brief): arithmetic, units, duplicates, orphan surcharge items, missing items, unclear descriptions, contradictions, typos.
- Score risk per item and per BoQ, and detect change-order potential and likely disputes.
- Show the result in a web page and export the bidder questions.
- Check the change-order detector against real data (section 8).

**Non-goals (this version)**
- Price suggestions and benchmarks (milestone 4) and what-if analysis (milestone 5). The dataset has priced data for only two projects.
- Editing the BoQ, or writing the bid.
- Other languages. The app works on German text.
- Scanned PDFs (OCR).

**Anti-goals** (a failure even if it technically works)
- A report so long or so noisy that the estimator stops reading it. Few, ranked, explained findings beat many.
- Confident claims the tool cannot back up. Every finding names the item, quotes the text, and says why.
- Wrong numbers from the LLM. Arithmetic and structure checks are done in code, not by the LLM.

## 3. Constraints

- German BoQ text, German construction terms (VOB/A, VOB/B, DIN 276, GAEB).
- Real, anonymized data: names are replaced by placeholders like `[PERSON_115]`, which often stand in for ordinary words (for example *Edelstahl*). Parsing and prompts must tolerate this.
- Mixed sources: XML from several programs (ORCA AVA, ARCHITEXT Pallas, CaliforniaX), fixed-width D-files, PDFs with varying table layouts.
- D-files are CP850 text with CRLF line endings, 80-character records. `StBALV23040` D84/D86 start with `T0`/`T1` records, a variant to handle or skip.
- Anything sent to an LLM leaves the machine. Dataset files are for this challenge, so check the terms before sending them to a third party.
- Deadline and judging format are not yet known (see section 10).

## 4. Approaches considered

| | What | Trade-off |
|---|---|---|
| **A. Rules first, then LLM** | Parser, then deterministic checks, then an LLM for text-level findings, then a web UI | Most work up front. Reliable numbers. The LLM only does what rules cannot. |
| B. LLM only | Send BoQ chunks to an LLM and ask for a report | Fastest start. Totals can be wrong, cost grows with 70 to 136 page files, results vary run to run. |
| C. Data platform first | Normalize every file and compare tender, bid and award across projects | Strong data, weak demo until analysis exists. |

**Chosen: A** (my recommendation; the user has not confirmed it, so treat it as my call).

## 5. Architecture

```
upload ──► parse ──► normalize ──► checks ──► scoring ──► report (web + export)
           │                         │ rules (code)
           │                         └ LLM analysis (text)
           └ GAEB X/D, PDF            
```

Python backend, simple web frontend.

**Parsers** (one module per format, same output)
- `gaeb_xml`: X83/X84/X86 (namespaces differ by version: DA83/3.2, 200407/3.1).
- `gaeb_d`: D83/D84/D86 (CP850, record types 00 header, 11/12 titles, 21 item, 23/30 price records, 25 short text, 26 long text, 99 end).
- `pdf`: text extraction with layout (`pdftotext -layout`), then table rows parsed by regex (item number, text, quantity, unit, prices). LLM fallback for pages that do not parse.

**Common model**
- `Project`: name, phase (tender, bid or award), currency, source file
- `Section`: id, title, level, parent
- `Item`: oz (item number), kind (normal, optional/Bedarf, alternative, surcharge/Zulage, hourly, lump sum), short text, long text, quantity, unit, unit price, total price, section, source reference (file and line or page)
- `Preamble`: Vorbemerkungen and the general contract texts, kept separate because many contradictions come from there

**Checks**
- Rules (code): see section 6.
- LLM (text): see section 7.

**Scoring and report**
- Per item and per BoQ, with the reasons.
- Output: findings list, filters by severity and trade, bidder questions export.

## 6. Rule checks (deterministic)

| Check | Detects |
|---|---|
| Totals | quantity x unit price differs from total price; section subtotal differs from sum of items |
| Units | missing unit; unit that does not suit the item text (for example pieces for a slab) |
| Numbering | duplicate or non-ordered OZ; gaps |
| References | surcharge or alternative item without a base item; "see item x.y.z" pointing to a missing item |
| Quantities | zero, negative, extreme outliers within the BoQ (same unit and similar text) |
| Lump sums | many large `psch` items with no breakdown |
| Optional items | Bedarf and Eventual items (they are outside the total, so a change-order source) |

## 7. LLM analysis (text-level)

Run per section, with the Vorbemerkungen as context. Each finding must quote the item text. Categories:
- **Unclear description:** "ca.", "nach Bedarf", "o. glw." with no spec, open scope, undefined "required" work
- **Contradiction:** between items, or between an item and the Vorbemerkungen
- **Missing item:** work implied by another item but not listed (cross-trade dependencies using a rule table, for example floor finish needs substrate)
- **Typos and wrong terms**
- **Risk transfer:** unknown ground or conditions placed on the contractor, unlimited warranty, liability for planning errors (VOB/A "unusual risks"), "the contractor must check and confirm" language
- **Interface phrases:** "by others", "bauseits", "provided by the client". Each becomes a bidder question.

Output is structured JSON (item reference, category, severity, quote, explanation, suggested bidder question). Validated in code: findings that quote text not in the item are discarded.

## 8. Risk scoring and change-order detection

**Item risk score** combines: rule findings, LLM findings, optional or alternative status, quantity oddness, vagueness markers, and number of dependencies on other trades. Weights are simple and visible in the report so the estimator can see why.

**Change-order potential** flags: Bedarf items, vague scope, interface phrases, quantities that could drift more than 10% (VOB/B §2 Abs. 3), and items with unclear measurement rules.

**Check against real data (backtest).** `8209.003` has the tender (D83/X83) and the award (D86):
- The award has 197 items against 159 in the tender. The 38 added items (for example "Surcharge support gravel due to postponed construction period") are real post-tender changes.
- Run the tool on the tender only, then ask: which of the tender's items or sections were flagged where the additions happened? Report that hit rate in the demo and pitch.
- Caveat: one project is a story, not statistics. Say so.

## 9. Report and UI

Web page with:
1. Upload (one or many files; a multi-trade set is one project).
2. Summary: item count, trades, an overall risk level, top 10 findings.
3. Findings table: filter by severity, category, trade; each row opens the item text with the flagged quote highlighted.
4. Bidder questions: grouped by trade, copyable, exportable as text or Excel.
5. For `8209.003`: a tender-vs-award view showing added items (the backtest).

Demo story: the Fernleitung pipeline project (tender PDF and priced bid D84), plus the 8209.003 tender-vs-award comparison.

## 9a. Bidder question format

No standard machine-readable format exists for bidder questions (Bieterfragen). In practice they are sent as free text through the e-procurement portal's messaging function, or to an email address named in the invitation letter. The client answers all bidders, and answers may amend the BoQ. There is a cutoff before the bid deadline, stated per tender. Portal details vary and have not been verified.

So the app produces questions that paste easily, not a portal import file.

**Fields per question**

| Field | Example |
|---|---|
| No. | Q-07 |
| Reference | Item 05.01.0030, or Vorbemerkungen section 3 |
| Trade/section | Pipelines |
| Question | "The item says 'or equivalent' without naming criteria. Which properties must an equivalent product meet?" |
| Why it matters | Price depends on the product choice |
| Priority | High / Medium / Low |

**Exports**
1. Plain text, one block per question (pastes into any portal message box).
2. Excel/CSV with the columns above.
3. A short neutral German cover note.

**Rules for generating questions (LLM prompt and validation)**
- Always cite the item number and quote the item text.
- One thing per question, answerable with a short fact or yes/no.
- Neutral wording. Never reveal price, margin or strategy, because answers are shared with competitors.
- Prefer "please clarify" over "this is wrong".
- Grouped by trade, high-impact first.
- Questions are drafts for the estimator to edit before sending. The tool never sends anything.

## 10. Open questions (need the user)

- Deadline and team size.
- How the demo is judged: live upload, recorded walkthrough, or pitch only.
- Whether an LLM API key is available, and whether sending the dataset text to an external API is acceptable.
- Whether `LV-Positionen.docx` is the "real-world faulty items" list the brief mentions. It has not been read in full.

## 11. Left to the builder

- Web framework and frontend (a minimal one is enough).
- The exact LLM and prompt design, within the structured output and quote-validation rule above.
- How to handle the `StBALV23040` T0/T1 variant and PDFs that do not parse.
- Scoring weights, tuned on the dataset.
- Test strategy. Suggested: golden-file tests for each parser against the paired X83/D83 of the same project, since they must give the same items.

## 12. Suggested build order

1. Common model plus the X83 parser (the easiest), tested on all four X83 files.
2. D-file parser, tested by comparing D83 against X83 for `8209.003`.
3. Rule checks, then the first report page.
4. PDF parser for the Fernleitung and multi-trade PDFs.
5. LLM analysis, then scoring.
6. Backtest view, bidder question export, pitch.
