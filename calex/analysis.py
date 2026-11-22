"""Pipeline: parse result -> rule checks -> optional LLM -> dedupe -> scoring -> report dict."""
from __future__ import annotations
import hashlib
import re
from collections import Counter, defaultdict
from .models import Project, Finding, Item
from .checks import run_checks
from . import llm
from .parsers import norm_oz

SEV_W = {"high": 5, "medium": 3, "low": 1}
CATEGORY_LABEL_DE = {
    "vague": "Unklarer Umfang", "risk_transfer": "Risiko beim Auftragnehmer", "interface": "Andere Gewerke / AG", "optional": "Bedarfsposition",
    "quantity": "Menge", "lump_sum": "Weite Pauschale", "reference": "Fehlender Bezug", "unit": "Einheit", "duplicate": "Doppelte Nummer",
    "arithmetic": "Rechenfehler", "contradiction": "Widerspruch", "missing": "Fehlende Position", "typo": "Tippfehler / falscher Begriff",
}
CATEGORY_LABEL = {
    "vague": "Unclear scope", "risk_transfer": "Risk on contractor", "interface": "Other trades / client",
    "optional": "Optional item", "quantity": "Quantity", "lump_sum": "Broad lump sum", "reference": "Broken reference",
    "unit": "Unit", "duplicate": "Duplicate number", "arithmetic": "Arithmetic", "contradiction": "Contradiction",
    "missing": "Missing item", "typo": "Typo / wrong term",
}
REPEAT_MIN = 8
CHANGE_ORDER_CATS = {"optional", "vague", "interface", "quantity", "lump_sum", "risk_transfer", "missing", "contradiction"}


def finding_id(oz: str, category: str, quote: str, message: str) -> str:
    """Stable id of a finding: the same issue on the same item keeps its id across re-runs (used for triage and for 'changes since')."""
    basis = re.sub(r"\W+", "", (quote or message).lower())[:40]
    return hashlib.sha1(f"{oz}|{category}|{basis}".encode()).hexdigest()[:10]


def _level(score: int) -> str:
    return "high" if score >= 9 else "medium" if score >= 4 else "low"


def _dedupe(findings: list[Finding]) -> list[Finding]:
    best: dict[tuple, Finding] = {}
    for f in findings:
        key = (f.oz, f.category, re.sub(r"\W+", "", f.quote.lower())[:40] if f.source == "llm" else f.message[:30])
        cur = best.get(key)
        if cur is None or SEV_W[f.severity] > SEV_W[cur.severity]:
            best[key] = f
    return list(best.values())


def analyze_project(project: Project, use_llm: bool = True, progress=None, bench=None) -> dict:
    rule = run_checks(project)
    # prioritise items for the LLM by rule score
    pre: dict[str, int] = defaultdict(int)
    for f in rule:
        pre[f.oz] += SEV_W[f.severity]
    prioritized = [oz for oz, _ in sorted(pre.items(), key=lambda kv: -kv[1])]
    llm_findings: list[Finding] = []
    llm_errors: list[str] = []
    llm_status = "skipped"
    if use_llm:
        if llm.available():
            llm_findings, llm_errors = llm.analyze(project, prioritized, progress=progress)
            llm_status = "ok" if not llm_errors else ("partial" if llm_findings else "failed")
        else:
            llm_status = "no_key"
    findings = _dedupe(rule + llm_findings)
    # Wording that repeats in many items is BoQ boilerplate: downgrade it and ask one general question instead of dozens.
    pattern_count = Counter((f.category, f.message) for f in findings if f.source == "rule")
    patterns: dict[tuple, list[Finding]] = defaultdict(list)
    for f in findings:
        if f.source == "rule" and pattern_count[(f.category, f.message)] >= REPEAT_MIN and f.severity == "medium":
            f.severity = "low"
            patterns[(f.category, f.message)].append(f)

    by_item: dict[str, list[Finding]] = defaultdict(list)
    for f in findings:
        by_item[f.oz].append(f)
    items_by_oz = {i.oz: i for i in project.items}

    def score(fs): return min(20, sum(SEV_W[x.severity] for x in fs))

    item_rows = []
    for oz, fs in by_item.items():
        it = items_by_oz.get(oz)
        s = score(fs)
        item_rows.append({
            "oz": oz, "trade": it.trade if it else "", "section": it.section_title if it else "",
            "short_text": it.short_text if it else "", "text": it.text if it else "",
            "unit": it.unit if it else "", "quantity": it.quantity if it else None, "kind": it.kind if it else "",
            "unit_price": it.unit_price if it else None, "total_price": it.total_price if it else None,
            "score": s, "level": _level(s),
            "change_order_likely": any(x.category in CHANGE_ORDER_CATS and x.severity != "low" for x in fs) and s >= 5,
            "findings": [x.to_dict() for x in sorted(fs, key=lambda x: -SEV_W[x.severity])],
        })
    item_rows.sort(key=lambda r: -r["score"])

    flat = []
    for r in item_rows:
        for f in r["findings"]:
            flat.append({**f, "id": finding_id(f["oz"], f["category"], f["quote"], f["message"]), "trade": r["trade"], "section": r["section"], "item_score": r["score"],
                         "category_label": CATEGORY_LABEL.get(f["category"], f["category"]),
                         "category_label_de": CATEGORY_LABEL_DE.get(f["category"], f["category"])})
    flat.sort(key=lambda f: (-SEV_W[f["severity"]], 0 if f["source"] == "llm" else 1, -f["item_score"]))

    # bidder questions: high and medium only, one per (oz, category)
    q_by_trade: dict[str, list[dict]] = defaultdict(list)
    seen = set()
    for f in flat:
        if f["severity"] == "low" or not f["question"]:
            continue
        k = (f["oz"], f["category"])
        if k in seen:
            continue
        seen.add(k)
        q_by_trade[f["trade"] or "General"].append({"fid": f["id"], "oz": f["oz"], "severity": f["severity"], "category": f["category_label"],
                                                      "category_de": f["category_label_de"], "question": f["question"],
                                                      "question_en": f.get("question_en") or "", "quote": f["quote"]})
    for (cat, msg), fs in patterns.items():
        ex = ", ".join(f.oz for f in fs[:5])
        first = fs[0]
        q_by_trade["General"].append({
            "fid": "p" + hashlib.sha1(f"{cat}|{msg}".encode()).hexdigest()[:9],
            "oz": f"{len(fs)} items", "severity": "medium", "category": CATEGORY_LABEL.get(cat, cat),
            "category_de": CATEGORY_LABEL_DE.get(cat, cat),
            "question": f"Zu mehreren Positionen (z. B. {ex}; insgesamt {len(fs)}): {first.message_de or msg}. Bitte bestätigen Sie, welcher Leistungsumfang bzw. welche Kosten damit gemeint sind und ob dies für alle diese Positionen gilt.",
            "question_en": f"On several items (e.g. {ex}; {len(fs)} in total): {msg}. Please confirm what scope or costs are meant and whether this applies to all these items.",
            "quote": first.quote})
    n = 0
    questions = []
    for trade, qs in q_by_trade.items():
        for q in qs:
            n += 1
            questions.append({"no": f"Q-{n:03d}", "trade": trade, **q})

    price = None
    if bench is not None and bench.entries:
        from .benchmarks import hints_for
        price = hints_for(project, bench)
        for r in item_rows:
            r["price_hint"] = price["hints"].get(r["oz"])
    # Indicative change-order exposure: if the quantities of the likely change-order items deviate by 10 % (the VOB/B §2(3) threshold),
    # what is that worth? Uses the file's own prices, else benchmark prices; items without any price are counted separately.
    exp_eur, priced, unpriced, bases = 0.0, 0, 0, set()
    for r in item_rows:
        if not r["change_order_likely"]:
            continue
        it = items_by_oz.get(r["oz"])
        value, basis = None, ""
        if it and it.total_price:
            value, basis = it.total_price, "file"
        elif it and it.unit_price and it.quantity:
            value, basis = it.unit_price * it.quantity, "file"
        elif it and it.quantity and r.get("price_hint"):
            value, basis = r["price_hint"]["median"] * it.quantity, "benchmark"
        r["exposure"] = round(0.10 * value, 2) if value else None
        if value:
            exp_eur += 0.10 * value; priced += 1; bases.add(basis)
        else:
            unpriced += 1
    exposure = {"eur": round(exp_eur, 2), "items_priced": priced, "items_unpriced": unpriced,
                "basis": "mixed" if len(bases) > 1 else (next(iter(bases)) if bases else "none"), "deviation_pct": 10}
    sev = Counter(f["severity"] for f in flat)
    total_score = sum(r["score"] for r in item_rows)
    n_items = max(1, len(project.items))
    overall = "high" if sev["high"] >= max(5, 0.04 * n_items) else "medium" if (sev["high"] or sev["medium"] > 0.1 * n_items) else "low"
    return {
        "project": {"name": project.name, "phase": project.phase, "source": project.source, "items": len(project.items),
                    "sections": len({i.section for i in project.items}), "trades": sorted({i.trade for i in project.items if i.trade}),
                    "preamble_chars": len(project.preamble), "notes": project.notes,
                    "total_price": round(sum(i.total_price or 0 for i in project.items), 2) or None,
                    "priced_items": sum(1 for i in project.items if i.total_price is not None)},
        "summary": {
            "overall": overall, "findings": len(flat), "severity": dict(sev),
            "categories": dict(Counter(f["category_label"] for f in flat)),
            "categories_de": dict(Counter(f["category_label_de"] for f in flat)),
            "exposure": exposure, "items_flagged": len(item_rows), "items_high": sum(1 for r in item_rows if r["level"] == "high"),
            "change_order_items": sum(1 for r in item_rows if r["change_order_likely"]),
            "by_trade": [{"trade": t or "General", "findings": c} for t, c in Counter(f["trade"] for f in flat).most_common()],
            "top": flat[:10],
            "repeated_patterns": [{"category": CATEGORY_LABEL.get(c, c), "message": m, "message_de": (v[0].message_de or m), "items": len(v)} for (c, m), v in patterns.items()],
        },
        "benchmarks": price,
        "all_items": [{"oz": i.oz, "trade": i.trade, "section": i.section, "short_text": i.short_text, "unit": i.unit,
                       "quantity": i.quantity, "unit_price": i.unit_price, "total_price": i.total_price, "kind": i.kind,
                       "level": next((r["level"] for r in item_rows if r["oz"] == i.oz), "none"),
                       "hint": ({k: price["hints"][i.oz][k] for k in ("median", "low", "high", "n", "confidence")} if price and i.oz in price["hints"] else None)}
                      for i in project.items],
        "llm": {"status": llm_status, "errors": llm_errors[:3], "findings": len(llm_findings)},
        "findings": flat, "items": item_rows, "questions": questions,
    }


def _words(t: str) -> set[str]:
    return {w[:6] for w in re.findall(r"[a-zäöüß]{4,}", t.lower())}


def compare(tender: Project, award: Project, tender_report: dict | None = None) -> dict:
    """Tender vs award: which items were added, removed or changed. Heuristic closest-item link for added items."""
    t = {norm_oz(i.oz): i for i in tender.items}
    a = {norm_oz(i.oz): i for i in award.items}
    risk = {}
    if tender_report:
        risk = {norm_oz(r["oz"]): r for r in tender_report["items"]}
    added = []
    for k, it in a.items():
        if k in t:
            continue
        w = _words(it.text)
        best, bs = None, 0.0
        for tk, ti in t.items():
            tw = _words(ti.text[:600])
            if not w or not tw:
                continue
            sc = len(w & tw) / len(w | tw)
            if sc > bs:
                best, bs = (tk, ti), sc
        link = None
        if best and bs >= 0.12:
            r = risk.get(best[0])
            link = {"oz": best[1].oz, "short_text": best[1].short_text[:100], "similarity": round(bs, 2),
                    "tender_level": r["level"] if r else "none", "tender_findings": len(r["findings"]) if r else 0}
        added.append({"oz": it.oz, "short_text": it.short_text, "unit": it.unit, "quantity": it.quantity, "closest_tender_item": link})
    removed = [{"oz": i.oz, "short_text": i.short_text} for k, i in t.items() if k not in a]
    changed = []
    for k, it in a.items():
        ti = t.get(k)
        if ti and ((ti.quantity or 0) != (it.quantity or 0) or ti.unit != it.unit):
            changed.append({"oz": it.oz, "short_text": it.short_text, "tender": f"{ti.quantity:g} {ti.unit}" if ti.quantity is not None else "",
                            "award": f"{it.quantity:g} {it.unit}" if it.quantity is not None else ""})
    norm = lambda s: re.sub(r"\s+", " ", s or "").strip().lower()
    text_changed = [{"oz": it.oz, "old": ti.short_text, "new": it.short_text} for k, it in a.items()
                    if (ti := t.get(k)) and norm(ti.short_text) != norm(it.short_text)]
    price_changed = [{"oz": it.oz, "short_text": it.short_text, "old": ti.unit_price, "new": it.unit_price,
                      "pct": round((it.unit_price - ti.unit_price) / ti.unit_price * 100, 1) if ti.unit_price else None}
                     for k, it in a.items() if (ti := t.get(k)) and ti.unit_price is not None and it.unit_price is not None and abs(ti.unit_price - it.unit_price) > 0.004]
    tot = lambda p: round(sum(i.total_price or 0 for i in p.items), 2) or None
    linked = [x for x in added if x["closest_tender_item"]]
    flagged = [x for x in linked if x["closest_tender_item"]["tender_findings"] > 0]
    return {
        "tender": {"source": tender.source, "items": len(tender.items)}, "award": {"source": award.source, "items": len(award.items)},
        "added": added, "removed": removed, "changed": changed, "text_changed": text_changed, "price_changed": price_changed,
        "totals": {"old": tot(tender), "new": tot(award)},
        "backtest": {"added": len(added), "with_related_tender_item": len(linked), "related_item_was_flagged": len(flagged)},
    }


def diff_reports(new: dict, base: dict) -> dict:
    """Findings that are new, resolved or unchanged between two analyses (matched by stable finding id)."""
    a = {f["id"]: f for f in new["findings"] if "id" in f}
    b = {f["id"]: f for f in base["findings"] if "id" in f}
    trim = lambda f: {k: f.get(k) for k in ("id", "oz", "severity", "category_label", "category_label_de", "message", "message_de", "quote", "trade")}
    return {"new": [trim(f) for k, f in a.items() if k not in b], "resolved": [trim(f) for k, f in b.items() if k not in a],
            "unchanged": sum(1 for k in a if k in b),
            "high_new": sum(1 for k, f in a.items() if k not in b and f["severity"] == "high"),
            "high_resolved": sum(1 for k, f in b.items() if k not in a and f["severity"] == "high")}


def ensure_ids(report: dict) -> dict:
    """Reports saved before finding ids existed get them on load, so triage and 'changes' work for old analyses too."""
    fs = report.get("findings", [])
    if fs and "id" in fs[0] and all("fid" in q for q in report.get("questions", [])):
        return report
    for f in fs:
        f.setdefault("id", finding_id(f["oz"], f["category"], f.get("quote", ""), f.get("message", "")))
    by = {(f["oz"], f.get("category_label"), f.get("quote")): f["id"] for f in fs}
    for q in report.get("questions", []):
        q.setdefault("fid", by.get((q["oz"], q.get("category"), q.get("quote"))) or "q" + hashlib.sha1(q["no"].encode()).hexdigest()[:9])
    return report
