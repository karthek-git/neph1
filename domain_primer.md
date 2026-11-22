# Domain primer: BoQs and German construction bidding

These files use German construction conventions, so the German term is given next to each English one.

## 1. The big picture

A **client** (Auftraggeber, AG) wants a building. An architect or engineer writes a **Leistungsverzeichnis (LV)**, which is the BoQ. It lists every piece of work to be priced.

Contractors (Auftragnehmer, AN, or Bieter) price each line and submit an offer. The client compares the offers, awards the contract, and the work is built and billed against the same lines.

The tool sits on the **bidder's side**, with the estimator (Kalkulator). It should find problems in the BoQ before the contractor commits to a price.

### Who's who

| Role | German | What they do |
|---|---|---|
| Client | Auftraggeber (AG) / Bauherr | Wants the building and issues the tender (the BoQ). |
| Bidder | Bieter | The contracting **company** that prices every item and submits an offer. |
| Contractor | Auftragnehmer (AN) | The bidder who won. They build it and get paid. |
| Estimator | Kalkulator | The **person** at the bidder who does the pricing. This is the tool's actual user. |
| Architect/engineer | Planer | Writes the BoQ for the client. |

The bidder is the company and the estimator is an employee of it. In a small firm the owner may be both. In a larger firm management (Geschäftsführung) reviews the estimator's price and decides the final bid, including risk and margin.

### BoQ vs Bill of Materials (BoM)

| | BoQ | BoM |
|---|---|---|
| Industry | Construction and civil engineering | Manufacturing |
| Lists | Work items (materials, labor and installation included) | Components and parts only |
| Example line | "Supply and lay 50 mm cement screed, 120 m²" | "Screw M6x20, 48 pcs" |
| Quantities | Estimates, which may deviate during construction | Exact, defined by the design |
| Legal weight | High: wording decides what is included in the price | None |

The German term (Leistungsverzeichnis) means "list of services", not "list of quantities". A BoM could be derived from a BoQ by breaking each work item into materials, which is what a material-price what-if analysis would need.

## 2. Structure of a BoQ

- **Vorbemerkungen** are general preliminary notes. They set the rules for the whole BoQ: site conditions, how measurement works, what is included in the unit price. Many disputes trace back to a line here that was missed or contradicted later.
- **Titel / Gruppen / Untergruppen** are the hierarchy, such as 01 Earthworks, 01.01 Excavation, 01.01.0010.
- **OZ (Ordnungszahl)** is the item number, like `01.02.0030`. It must be unique and well-ordered.
- **Position** is one line item. It has:
  - **Kurztext** (short text) and **Langtext** (long text, the detailed spec)
  - **Menge** (quantity)
  - **Einheit** (unit): m, m², m³, kg, t, Stk, psch, h
  - **EP (Einheitspreis)**, the unit price. It is blank in a tender and filled in by the bidder.
  - **GP (Gesamtpreis)**, the total price, which is EP x quantity.

## 3. Types of items (important for risk)

| German | Meaning | Why it matters |
|---|---|---|
| Normalposition | Standard item, priced and included in the total | Baseline |
| Bedarfs-/Eventualposition | Only if needed. Usually not in the total. | Hidden change-order potential |
| Alternativposition | Alternative to another item | The bidder must price it, and the client picks later |
| Zulageposition | Surcharge on another item | Must reference a valid base item |
| Stundenlohnarbeiten | Work paid by the hour | Rates only, no quantity |
| Pauschalposition (psch) | Lump sum | Vague scope is a risk |
| Grundposition | The base item that Alternativ and Zulage items refer to | |

## 4. Contract types

- **Einheitspreisvertrag (EP-Vertrag)** pays the unit price x the **actually measured** quantity. This is the most common type for BoQs.
- **Pauschalvertrag** is a fixed price for the whole job. Quantity risk shifts to the contractor.
- **Stundenlohnvertrag** is time and material.

## 5. Legal framework (the basis for change-order logic)

- **VOB** (Vergabe- und Vertragsordnung für Bauleistungen) has three parts:
  - **VOB/A** covers the tender process and also tells the client how to write a proper BoQ. Items should be unambiguous, with no unusual risks pushed onto the bidder.
  - **VOB/B** covers the contract terms: payment, changes, delays, acceptance, warranty.
  - **VOB/C** consists of the **ATV (Allgemeine Technische Vertragsbedingungen)**, DIN 18299 and following, one per trade. They define what is included in a price by default and how work is measured. For example, DIN 18299 is the general one and DIN 18300 covers earthworks.
- **BGB** is the German civil code and applies where VOB doesn't.
- **ZTV** (Zusätzliche Technische Vertragsbedingungen) are extra technical conditions, common in road and civil work, such as the `StBALV` files.
- **HOAI** covers architect and engineer fees. It is only tangentially relevant.

### Change orders (VOB/B)

- **§2 Abs. 3:** if the quantity deviates by **more than 10%**, either party can demand a new unit price. This is why **unusual quantities** matter.
- **§2 Abs. 5:** the client changes the design, so the price is adjusted. This is a classic **Nachtrag (supplementary claim)**.
- **§2 Abs. 6:** additional work not in the contract is paid extra, but the contractor must announce it **before** starting.
- **§2 Abs. 8:** work done without an order is generally not paid.
- **§4 Abs. 3 (Bedenkenanmeldung):** the contractor must formally object to flawed specs or conditions. Failing to do so means liability.
- **§6:** delays and obstructions (**Behinderung**) can lead to time extensions or damages.

## 6. How a bidder calculates a price

- **Cost components:** Lohn (labor), Stoffe (materials), Geräte (equipment), Nachunternehmer (subcontractors).
- **Zuschläge (markups):**
  - **BGK** (Baustellengemeinkosten) are site overheads.
  - **AGK** (Allgemeine Geschäftskosten) are company overheads.
  - **W+G** (Wagnis und Gewinn) are risk and profit.
- **Zuschlagskalkulation** is the standard method. Costs are summed and then multiplied by the markups to give the EP.
- **Mittellohn / Verrechnungslohn** is the average hourly labor cost, burdened with overhead and markups.
- **Kalkulation über die Endsumme** means estimating the whole project and then spreading the price across the lines.

### Pricing tactics and traps

- **Mischkalkulation** means shifting costs between items. Courts and public clients disallow it, because it distorts comparison.
- **Spekulation / Mengenspekulation** means pricing items higher when the bidder expects the real quantity to exceed the BoQ quantity. This is why quantity plausibility matters.
- **Unterkostenangebot** is a price below cost.
- **Bietergefährdende Positionen** are items that endanger bidders: vague scope, unquantified risks, unlimited warranties.

## 7. GAEB, the file format

GAEB is the standard exchange format. The **DA (Datenart)** code is the phase:

| Code | Meaning |
|---|---|
| X81 / D81 | Cost estimate (Kostenanschlag) and BoQ with no price blanks |
| X83 / D83 | **Tender**: the client sends the BoQ to bidders |
| X84 / D84 | **Bid**: the bidder's priced offer |
| X86 / D86 | **Award**: the contract |
| X89 / D89 | Invoice (Rechnung) |

- **Xxx** is the XML format (GAEB DA XML 3.x). It is easier to parse.
- **Dxx** is the legacy fixed-width text format (GAEB 90, 80-character lines, record type in the first two characters, line number in the last six). Text is in a legacy encoding, so try `cp437` or `latin-1`.
- Files carry metadata such as project, currency, and a Kennzeichen indicating the item type.

Having D83, D84 and D86 for the same project makes it possible to diff a tender against the bid and the award. That is real "historical data" for price analysis and what-if work.

## 8. Cost classification: DIN 276

DIN 276 splits building costs into **Kostengruppen (KG)**:
- **KG 300** Building construction
- **KG 400** Technical installations
- **KG 500** Outdoor facilities
- and so on.

The task's "cost groups" refers to this. Trade-based BoQs map roughly onto KG 300 and 400.

## 9. Standard texts and measurement

- **STLB-Bau** (Standardleistungsbuch) provides standardized item texts. A text that follows it is usually clearer than a freehand one.
- **Aufmaß** is the on-site measurement. Billing is based on it, not on the BoQ quantity.
- **Abrechnung (billing)** follows the rules in the ATV, such as "measured net" or "measured with overmeasure". Spec and measurement rules must agree.

## 10. What errors look like (priority milestone)

**Deterministic and rule-based:**
- GP != Menge x EP
- Missing or invalid units, or a unit that doesn't match the item (for example "Stk" for a concrete slab)
- Quantity of 0 or negative, or an extreme outlier
- Duplicate OZ, or gaps in the numbering
- A Zulage or Alternative item with no base item
- A subtotal that doesn't match the sum of its items

**Semantic, where an LLM is needed:**
- **Unclear descriptions:** "as required", "approx.", "if necessary", "or equivalent" (z.B. ... o. glw.), with no spec
- **Contradictions:** a Vorbemerkung says one thing and an item says another, or two items specify different materials for the same element
- **Missing items:** a door with no hardware item, a roof with no vapor barrier, a wall finish with no preparation (cross-trade dependencies)
- **Typos and wrong terms**, such as "Estrich C25" where "Zementestrich CT-C25-F4" is meant
- **Scope risk:** the ground conditions are unknown but the contractor carries the risk, or the client's requirements aren't specified, so the work is a Pauschal with open scope
- **Change-order potential:** Bedarfspositionen, unclear interfaces between trades, items flagged "if required", late client decisions

## 11. Glossary

| German | English |
|---|---|
| Leistungsverzeichnis (LV) | Bill of quantities |
| Ausschreibung | Tender |
| Angebot | Bid / offer |
| Zuschlag | Award |
| Nachtrag | Change order / supplementary claim |
| Mehr-/Minderleistung | Extra / reduced work |
| Aufmaß | Site measurement |
| Abnahme | Acceptance |
| Gewährleistung | Warranty |
| Bürgschaft | Guarantee / bond |
| Skonto | Early-payment discount |
| Bauherr / Auftraggeber | Client / owner |
| Auftragnehmer | Contractor |
| Rohbau | Shell construction |
| Ausbau | Finishing / fit-out |
| TGA | Building services (HVAC, electrical, plumbing) |
| Estrich | Screed |
| Trockenbau | Drywall |
| Baustelleneinrichtung | Site setup |
| Stoffpreisgleitklausel | Material price adjustment clause |

## 12. How this maps to the milestones

1. **Parse:** the GAEB structure and item types (sections 2, 3 and 7).
2. **Errors:** the checks in section 10, backed by VOB/A clarity rules.
3. **Risk and change orders:** VOB/B §2 and §4, the 10% rule, and Bedarfs and Alternativ items.
4. **Historical data:** diff D83 against D84 and D86, and use DIN 276 groups for benchmarks.
5. **What-if:** material-price changes against the Kalkulation components, and alternative items.

## 13. The dataset (`Challenge A Dataset/`)

About 15 real, anonymized German construction and plant-engineering projects. Names, firms, addresses and emails are replaced by placeholders such as `[FIRMA_006]` and `[PROJEKT_004]`. All text is German. This section is based on a sample of each file type, not every file.

### Layout (after organizing)

```
Challenge A Dataset/
├── gaeb/
│   ├── 8209.003_maschinentechnik/   D83 + X83 tender, D86 award (same project)
│   ├── StBALV23040/                 D84 bid + D86 award
│   ├── Angebot_AN24-0305/           D84 bid + its PDF printout
│   └── x83_other/                   3 standalone XML tenders
├── pdf/
│   ├── multitrade_building_LV_00-23/   28 trade BoQs, one building
│   └── other_boqs/                     6 whole-project or single BoQs
└── docs/
    └── LV-Positionen.docx
```

### File formats

| Extension | Format | Phase | Count |
|---|---|---|---|
| .X83 / .x83 | GAEB XML | Tender | 4 |
| .D83 | GAEB 90 fixed-width text | Tender | 1 |
| .D84 | GAEB 90 | Bid (priced) | 2 |
| .D86 | GAEB 90 | Award | 2 |
| .pdf | Printed BoQ tables (text-based, not scans, in the ones checked) | Mixed | 34 |
| .docx | Word | Item list | 1 |

- **X files** are normal XML (tags such as `<NamePrj>`, `<LblPrj>`, `<DP>83</DP>`). Easiest to parse.
- **D files** have 80-character lines: record type in the first two characters, line number in the last six. Legacy encoding (`Erg?nzung` means "Ergänzung" decoded wrongly as UTF-8), so try `cp437` or `latin-1`.
- `StBALV23040.D84` and `.D86` start with `T0`/`T1` records instead of the usual `00`/`01` header, so the parser needs to handle that variant.
- **PDFs** carry text, but table layout varies per document. An LLM fallback is likely needed.

### Project groups

**1. Fernleitung pipeline (water supply association).** The richest set.
- `pdf/other_boqs/Leistungsverzeichnis.pdf` (71 pages) is the unpriced tender BoQ: site setup, asphalt, trench excavation, DN 250 ductile iron pipes, control cables, manholes. Every item has a long legal-style description.
- `gaeb/Angebot_AN24-0305/` is a contractor's priced bid for the same project. Example: item 1.1.10 (site setup, lump sum) at 72.000,00 EUR; 1.1.20 (site upkeep, 6,25 months) at 750,00 EUR per month = 4.687,50 EUR. This is real price data.
- `docs/LV-Positionen.docx` lists items grouped by topic, each with its unit, and uses "oder" (or) and "mit" (with) rules, for example pipe type 3.1.20 *or* 3.1.60, *with* laying item 3.2.20. It looks like item combinations or dependencies, which would help missing-item checks. I only saw part of it, so its purpose is unconfirmed.

**2. Machine technology project 8209.003.** One project in three phases.
- X83 and D83 are the same tender BoQ in two formats (159 items, 28 categories, four unit-price components: Lohn, Material, Gerät, Sonstiges).
- D86 is the award. Comparing D83 to D86 shows what was awarded.

**3. Standalone GAEB XML tenders (X83).**

| File | Size | Notes |
|---|---|---|
| `501-24-01_GAEB-XML_sas.x83` | 296 items, 25 categories | GAEB 3.1. Many items in "St" and "psch". |
| `[NUMMER_001]_leer.X83` | 248 items, 32 categories | New building for technical chemistry. Has "StWo"/"mWo" (per week) units. |
| `GAEB-[PROJEKT_004].X83` | 50 items | Stream culvert replacement for a municipality. Small, good for testing. |
| `8209.003 ... .X83` | 159 items | See group 2. |

They were produced by different software (ORCA AVA, ARCHITEXT Pallas, CaliforniaX), so the XML structure varies even though it follows the GAEB standard.

**4. PDF-only BoQs.**
- `multitrade_building_LV_00-23/` has 28 unpriced trade BoQs ("Anfrage") for a training center and office building (project 79-222): roofing, flooring, electrical, drywall and so on. `LV_16` is missing from the series. Item 6.1.10 to 6.1.50 in `LV_12_Dachabdichtung` shows the typical style: a lump-sum wind-load proof, 275 m² vapor barrier, EPS insulation (WLG 035, 180 mm), and a slope-insulation Zulage that refers to "Grundleistung: Wärmedämmung d=180 mm".
- `other_boqs/HEM2301-2_Gesamt-LV.pdf` (136 pages) is a public tender (VOB/A): arsenic-removal upgrade at a water treatment plant, Los 2 (process technology). It opens with the formal cover letter (see section 14) and lists contract documents such as special contract terms, a material price-adjustment clause (Stoffpreisgleitklausel) and an acceleration bonus.
- Not opened: `Abgabe LV`, `Leistungsverzeichnis_leer`, `LV-Ausdruck-[PROJEKT_004]`, `LV-Schachtbauwerk`. `Abgabe LV.pdf` has extractable text (about 220k characters).

### What the data means for the project

- Tender, bid and award all exist for at least two projects, but priced data is rare. Only the D84 and D86 files carry prices. The rest are blank ("leer"), so price suggestions and what-if analysis rest on little data.
- Real BoQ patterns appear: lump sums (psch), Zulage items that refer to a base item, "oder" alternatives, and vague specs such as "z.B. ... o. glw." ("e.g. ... or equivalent").
- The files are mixed on purpose: different software, XML, fixed-width and PDF. Parsing is a real part of the challenge.
- No labeled "faulty item" examples were found yet. They may be in the docx or implicit in the data.

## 14. How a client runs a tender (Ausschreibung)

1. **Define the need.** The client decides what to build and sets a budget. Planners (architects and engineers) produce drawings and a building description.
2. **Choose the procedure** (Vergabeart). Public clients are bound by VOB/A:
   - Öffentliche Ausschreibung: open to any company.
   - Beschränkte Ausschreibung: invited companies only, with or without a prior qualification round (Teilnahmewettbewerb).
   - Freihändige Vergabe: direct award to one or a few firms, allowed only for small or special cases.
   Private clients can choose freely.
3. **Prepare the tender documents** (Vergabeunterlagen). The planner writes the BoQ. The client adds the cover letter (Aufforderung zur Abgabe eines Angebots) with deadline, opening date and Bindefrist (how long the bidder is bound to the price), contract terms, plans and technical conditions, and forms the bidder must return.
4. **Publish or send it out.** Public tenders go on a portal, invited firms get documents directly. The BoQ is often sent as a GAEB file (X83/D83).
5. **Answer bidder questions.** Answers go to all bidders and may amend the BoQ.
6. **Bidders price and submit** before the deadline, usually as X84/D84.
7. **Opening** (Eröffnungstermin). Bids are opened and prices recorded.
8. **Check and compare.** Formal completeness, arithmetic, suitability of the bidder, and whether prices are reasonable. Unusually low bids (Unterkostenangebote) get a closer look. The comparison is a price spreadsheet (Preisspiegel).
9. **Award** (Zuschlag). The most economical offer wins, which is not always the cheapest. The result is X86/D86.
10. **Contract and execution.** Work is measured on site and billed against the BoQ prices.

**Why it matters for the tool:**
- The client controls the BoQ, but the bidder usually carries the cost of its errors unless they raise them during the question phase (step 5).
- That phase is the opportunity: the risk report can become a list of **Bieterfragen** (bidder questions) to send to the client.
- The bidder is bound to their prices until the Bindefrist ends. Afterwards, prices change only through the change-order rules in VOB/B.

**Example in the dataset:** `HEM2301-2_Gesamt-LV.pdf` opens with this cover letter. It is an Öffentliche Ausschreibung under VOB/A, sent 28.02.2024, with deadline and opening on 27.03.2024 at 14:30 and a Bindefrist to 29.04.2024.

### Who writes the BoQ

The client usually hires a **Planer** (architect or engineer, fees governed by HOAI) before any contractor. The planner designs, estimates costs, writes the BoQ, and often runs the tender and supervises construction. Which planner depends on the job: architect plus specialist engineers for a building, a civil engineering office for a pipeline or culvert. In this dataset the BoQs mostly come from such planners.

Exceptions: large public clients (water associations, cities, road authorities) may have in-house engineers, design-and-build contracts (Generalunternehmer) skip the detailed BoQ entirely, and very small jobs may go straight to a quote. The client usually relies on the planner's BoQ without reviewing it in detail, which is why errors get through and why the bidder's own check matters.

## 15. Change order (Nachtrag)

A **change order** is a formal request for extra payment or a price adjustment because the work differs from what the contract described. Example: the BoQ says "excavate 500 m³ of soil", the contractor hits rock, and submits a Nachtrag for the added cost.

**Why they happen**
1. The client changes the design (VOB/B §2 Abs. 5).
2. Extra work that was not in the BoQ (§2 Abs. 6).
3. The measured quantity deviates by more than 10% (§2 Abs. 3).
4. Ground, existing structures or access differ from the tender description.
5. Delays caused by the client (§6).

**Process**
1. The contractor spots the issue and announces it in writing **before starting the work**. Skipping this can cost the claim.
2. They calculate the price, normally based on their original bid prices (Preisfortschreibung).
3. The client reviews and agrees or disputes it.
4. If agreed, it becomes an addition to the contract. If not, it can end in a dispute or court.

**Why it matters for the tool:** this is where bidders make or lose money. A low bid with weak items may rely on winning change orders later, and a BoQ with vague or missing items invites them. The tool should flag Bedarfspositionen, vague wording ("ca.", "bei Bedarf", "o. glw."), unclear interfaces between trades, and quantities that look too low.
