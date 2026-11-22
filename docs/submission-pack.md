# Calex: submission pack

Deadline: Sunday 12:00 via Tally. Three things: **7-slide PDF**, **public GitHub repo** (no commits after submitting), **demo video, 2 minutes max, with a live demo**.

## 1. Deck: 7 slides (the estimator's point of view)

| # | Title | What is on it | Say |
|---|---|---|---|
| 1 | **Calex: read the BoQ before you price it** | Name, one line, a screenshot of the Overview | "An estimator gets a BoQ with hundreds or thousands of lines and a few days. Calex reads it first." |
| 2 | **The problem** | Three facts: BoQs are long and cross several trades; the bidder usually carries the cost of a wrong or vague line unless it is raised before the question deadline; nobody has time to read closely. Show one real vague item. | "A missing test item or a vague 'by others' becomes a change-order dispute after the award." |
| 3 | **What changes in the bidding process** | A before/after strip: *Before*: read, guess, price, hope. *After*: drop files, see risks ranked, send questions, price with confidence, export the bid. | "The estimator spends time on decisions, not on searching." |
| 4 | **How it works** | The pipeline: parse (GAEB, PDF, Excel, Word) -> rule checks in code -> AI text analysis with quote validation -> ranked report. "The AI never does the arithmetic; every AI finding must quote the item text, or it is discarded." | Trust: code for numbers, AI for language, evidence for everything. |
| 5 | **What the estimator gets** | Four screenshots: Overview (risk by trade, exposure in EUR), Findings with status, Questions + Word letter, Bid (markup suggestion, priced X84). | "From risk to question to offer, in one place." |
| 6 | **Proof on real data** | Measured numbers (below), and the honest limits. | See below. |
| 7 | **Next steps and limits** | Live index fetch (Destatis), certified X84 testing with client software, richer price history, team workflow. Limits stated plainly. | "A prototype that is honest about what it does not do." |

### Numbers for slide 6 (measured on the challenge data, rules only, no AI)

- Five real X83 files from different authoring programs parse, and a priced **X84 is written into each and reads back correctly** (159, 50, 248, 296 and 159 items).
- Three trades analysed together (roof, screed, flooring PDFs): **90 items, 22 findings, in 0.04 s** (rules only; the AI step adds language findings).
- A **cross-trade check** found that the roof waterproofing (558 m²) and the roof insulation (305 m²) differ by 45 %: a real question for the client.
- Tender vs award of the machine-technology BoQ: **159 items became 197; 38 items were added** after the tender. Honest finding: only 3 of the 38 resemble a tender item and none had been flagged, so most additions (new products, surcharges) cannot be predicted from the tender text. Calex shows them; it does not claim to predict them.
- **91 automated tests** (parsers, checks, API, bid export round trip, catalog).

## 2. Video: 2 minutes, live demo

Record in English; switch to German for one shot (shows the question that is actually sent).
Prepare before recording: a clean project list, the AI key working, a small file (about 100 items) so the AI step finishes in seconds, a second file that is a revised version of it, and a priced file for the bid.
Remove the "Add from the challenge dataset" button before recording.

| Time | Screen | Say |
|---|---|---|
| 0:00-0:10 | Home page | "I'm an estimator. Tender deadline in three days, a BoQ with hundreds of items. I drop the files here." |
| 0:10-0:25 | Drop files -> project created and named; Files tab shows "read well"; the checklist "What would you like to run?" | "Calex creates the project, reads every format, and asks what I want. I pick the risk analysis." |
| 0:25-0:50 | Overview: overall risk, top risks, risk by trade, exposure in EUR | "Here is what matters: the riskiest trades, and what a 10 % quantity drift on the change-order items could cost. I mark two findings 'needs clarification'." |
| 0:50-1:10 | Questions tab: edit one question, click Word letter (open the .docx) | "These are neutral questions in German, ready to send before the question deadline. I edit one, and export the letter." |
| 1:10-1:30 | Upload the revised tender -> Files shows v2 Revised, Compare shows the changed quantity and wording | "The client answered and revised the BoQ. Calex sees it is version 2 and shows exactly what changed." |
| 1:30-1:50 | Bid sheet: prices, markup suggestion, Export -> priced X84; Offer -> Word | "I price it, and Calex writes the bid back into the client's own file. Offer summary in German, reservations taken from my open questions." |
| 1:50-2:00 | Overview again | "Calex does not replace the estimator. It turns hours of reading into a ranked list, and it shows its evidence. It is a prototype: the X84 is not certified, and prices are indicative." |

## 3. Repo checklist (before you stop committing)

- `README.md` is vendor-neutral and states the limits (done).
- `.env` is not in the repo (gitignored); `.env.example` is.
- `frontend/dist` is committed so Python alone runs the app.
- `ds/` and `Challenge A Dataset/` are gitignored (not ours to redistribute).
- Run once from a clean clone: install, `uvicorn calex.app:app --port 8000`, open the page, drop a file.
- Push, then submit the form. **No commits after submitting.**
