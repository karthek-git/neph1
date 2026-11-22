"""Deterministic checks. Everything here runs in code, with no LLM."""
from __future__ import annotations
import re
import statistics
import math
from collections import Counter, defaultdict
from .models import Item, Project, Finding
from .parsers import norm_oz
from .dependencies import run_dependency_checks, run_quantity_consistency

# (regex, severity, short label). Matching is case-insensitive on German BoQ text.
VAGUE = [
    (r"nach Bedarf|bei Bedarf|nach Erfordernis|entsprechend den Erfordernissen", "medium", "scope depends on need"),
    (r"gegebenenfalls|\bggf\.", "low", "conditional scope (ggf.)"),
    (r"soweit erforderlich|falls erforderlich|wenn erforderlich|sofern erforderlich", "medium", "conditional scope (if required)"),
    (r"o\.\s?ä\.|o\.\s?glw\.|oder gleichwertig|od\. gleichwertig", "low", "'or equivalent' without criteria"),
    (r"nach Angabe|nach Anweisung|nach Absprache|nach Vorgabe der Bauleitung|nach Wahl", "medium", "to be decided later by the client"),
    (r"vermutlich|voraussichtlich|nicht bekannt|unbekannt", "medium", "unknown or assumed conditions"),
    (r"nach Möglichkeit|sinngemäß", "low", "soft wording"),
]
RISK = [
    (r"nicht (separat|gesondert|extra) vergütet|nicht gesondert bezahlt", "high", "work not paid separately"),
    (r"wird nicht vergütet|werden nicht vergütet|nicht vergütet", "high", "work not paid"),
    (r"zu Lasten des Auftragnehmers|zu Lasten des AN", "high", "cost placed on contractor"),
    (r"Auftragnehmer haftet|AN haftet", "high", "liability placed on contractor"),
    (r"nicht anerkannt", "high", "claims excluded"),
    (r"befreien den Bieter nicht|befreit den Bieter nicht", "medium", "bidder must verify client's data"),
    (r"einzukalkulieren|einzurechnen|einzupreisen", "low", "costs to be absorbed in unit prices"),
    (r"kann nicht davon ausgehen|nicht garantiert|nicht zugesichert", "medium", "conditions not guaranteed"),
    (r"ohne Mehrkosten|ohne Mehrvergütung|keinen Anspruch|kein Anspruch", "high", "no extra payment"),
]
INTERFACE = [
    (r"bauseits\w*", "medium", "provided/done by others (bauseits)"),
    (r"durch andere\w*|von anderen (Gewerken|Firmen|Unternehmern)|andere Gewerke", "medium", "depends on other trades"),
    (r"Gewerk(e|en)?\s+(?!ausgeschrieben)[A-ZÄÖÜ]\w+", "medium", "refers to another trade"),
    (r"AG-seitig\w*|seitens des AG|vom AG (zur Verfügung|gestellt|beigestellt)|beigestellt", "medium", "client-supplied (AG-seitig)"),
    (r"Schnittstelle\w*|in Abstimmung mit|Folgegewerk\w*", "medium", "trade interface"),
]

LABEL_DE = {
    "approximate value (ca.)": "Ungefähre Angabe (ca.)", "approximate value": "Ungefähre Angabe",
    "scope depends on need": "Umfang hängt vom Bedarf ab", "conditional scope (ggf.)": "Bedingter Umfang (ggf.)",
    "conditional scope (if required)": "Bedingter Umfang (soweit erforderlich)", "'or equivalent' without criteria": "„oder gleichwertig“ ohne Kriterien",
    "to be decided later by the client": "Wird später vom Auftraggeber festgelegt", "unknown or assumed conditions": "Unbekannte oder angenommene Verhältnisse",
    "soft wording": "Weiche Formulierung", "work not paid separately": "Leistung wird nicht gesondert vergütet", "work not paid": "Leistung wird nicht vergütet",
    "cost placed on contractor": "Kosten werden dem Auftragnehmer auferlegt", "liability placed on contractor": "Haftung wird dem Auftragnehmer auferlegt",
    "claims excluded": "Ansprüche ausgeschlossen", "bidder must verify client's data": "Bieter muss Angaben des AG selbst prüfen",
    "costs to be absorbed in unit prices": "Kosten sind in die Einheitspreise einzurechnen", "conditions not guaranteed": "Verhältnisse nicht zugesichert",
    "no extra payment": "Keine Mehrvergütung", "provided/done by others (bauseits)": "Bauseits / von anderen zu erbringen",
    "depends on other trades": "Hängt von anderen Gewerken ab", "refers to another trade": "Verweist auf ein anderes Gewerk",
    "client-supplied (AG-seitig)": "Vom Auftraggeber gestellt (AG-seitig)", "trade interface": "Gewerkeschnittstelle",
}
_Q_EN = {
    "vague": "Item {oz}: the text contains the vague wording \"{quote}\". Please specify the scope or requirements so they can be priced.",
    "risk_transfer": "Item {oz}: the wording \"{quote}\" shifts cost or risk to the contractor. Please confirm what is meant and which works it covers.",
    "interface": "Item {oz}: the work depends on other trades (\"{quote}\"). Please confirm in which BoQ or by whom the preceding work is done, and by when.",
    "optional": "Item {oz}: this is an optional (Bedarfs-) item. Please state the conditions for calling it off and the expected quantity.",
    "quantity": "Item {oz}: the quantity ({qty} {unit}) differs strongly from comparable items. Please confirm the quantity take-off.",
    "lump_sum": "Item {oz}: this lump-sum item has a very broad scope. Please provide a breakdown or quantities for the work included.",
    "reference": "Item {oz}: the reference to item {ref} cannot be found in the BoQ. Please clarify which item is meant.",
    "unit": "Item {oz}: the unit of measure is missing. Please add it.",
    "duplicate": "Item {oz}: this item number occurs more than once. Please clarify which work is meant in each case.",
    "arithmetic": "Item {oz}: quantity × unit price does not equal the total price. Please check the figures.",
}
_MSG_DE = {
    "optional": "Bedarfsposition: nicht in der Summe enthalten, häufige Quelle für Nachträge",
    "unit": "Mengeneinheit fehlt", "duplicate": "Ordnungszahl kommt mehrfach vor",
}
_Q = {
    "vague": "Zu Pos. {oz}: Der Text enthält die unbestimmte Angabe „{quote}“. Bitte präzisieren Sie Umfang bzw. Anforderungen, damit sie kalkuliert werden können.",
    "risk_transfer": "Zu Pos. {oz}: Die Formulierung „{quote}“ verlagert Kosten bzw. Risiken auf den Auftragnehmer. Bitte bestätigen Sie den gemeinten Umfang bzw. nennen Sie, welche Leistungen darin enthalten sind.",
    "interface": "Zu Pos. {oz}: Die Leistung hängt von anderen Gewerken ab („{quote}“). Bitte bestätigen Sie, in welchem Leistungsverzeichnis bzw. von wem diese Vorleistung erbracht wird und bis wann.",
    "optional": "Zu Pos. {oz}: Es handelt sich um eine Bedarfs-/Eventualposition. Bitte nennen Sie die Voraussetzungen für den Abruf und die geschätzte Menge.",
    "quantity": "Zu Pos. {oz}: Die Menge ({qty} {unit}) weicht stark von vergleichbaren Positionen ab. Bitte bestätigen Sie die Mengenermittlung.",
    "lump_sum": "Zu Pos. {oz}: Die Pauschalposition hat einen sehr weiten Leistungsumfang. Bitte nennen Sie eine Aufschlüsselung bzw. Mengenansätze der enthaltenen Leistungen.",
    "reference": "Zu Pos. {oz}: Der Bezug auf Pos. {ref} ist im Leistungsverzeichnis nicht auffindbar. Bitte klären Sie, welche Position gemeint ist.",
    "unit": "Zu Pos. {oz}: Es fehlt eine Mengeneinheit. Bitte ergänzen Sie diese.",
    "duplicate": "Zu Pos. {oz}: Die Ordnungszahl kommt mehrfach vor. Bitte klären Sie, welche Leistung jeweils gemeint ist.",
    "arithmetic": "Zu Pos. {oz}: Menge × Einheitspreis ergibt nicht den Gesamtpreis. Bitte prüfen Sie die Angaben.",
}


def _ctx(text: str, m: re.Match, width: int = 70) -> str:
    a, b = max(0, m.start() - width), min(len(text), m.end() + width)
    q = text[a:b].replace("\n", " ")
    return ("…" if a > 0 else "") + re.sub(r"\s+", " ", q).strip() + ("…" if b < len(text) else "")


def _phrase_findings(item: Item, patterns, category: str) -> list[Finding]:
    out: list[Finding] = []
    text = item.text
    seen_labels: set[str] = set()
    for rx, sev, label in patterns:
        m = re.search(rx, text, flags=re.I)
        if not m or label in seen_labels:
            continue
        seen_labels.add(label)
        quote = _ctx(text, m)
        out.append(Finding(
            category=category, severity=sev, oz=item.oz,
            message=label[0].upper() + label[1:],
            message_de=LABEL_DE.get(label, label),
            quote=quote,
            question=_Q[category].format(oz=item.oz, quote=m.group(0).strip()),
            question_en=_Q_EN[category].format(oz=item.oz, quote=m.group(0).strip()),
        ))
    return out


def run_checks(project: Project) -> list[Finding]:
    items = project.items
    f: list[Finding] = []
    oz_set = {norm_oz(i.oz) for i in items}

    # duplicates
    counts = Counter(norm_oz(i.oz) for i in items if i.kind != "alternative")   # an item may legitimately appear in several alternatives
    for oz, n in counts.items():
        if n > 1:
            f.append(Finding("duplicate", "high", oz, f"Item number occurs {n} times",
                             message_de=f"Ordnungszahl kommt {n}-mal vor",
                             question=_Q["duplicate"].format(oz=oz), question_en=_Q_EN["duplicate"].format(oz=oz)))

    for it in items:
        # unit
        if project.phase not in ("award", "bid") and it.kind != "lump_sum" and not it.unit.strip():
            f.append(Finding("unit", "medium", it.oz, "Missing unit of measure", message_de="Mengeneinheit fehlt",
                             question=_Q["unit"].format(oz=it.oz), question_en=_Q_EN["unit"].format(oz=it.oz)))
        # quantity
        if project.phase != "award" and it.quantity is not None and it.quantity <= 0 and it.kind not in ("optional", "hourly"):
            f.append(Finding("quantity", "medium", it.oz, f"Quantity is {it.quantity:g}", message_de=f"Menge ist {it.quantity:g}",
                             question=_Q["quantity"].format(oz=it.oz, qty=f"{it.quantity:g}", unit=it.unit),
                             question_en=_Q_EN["quantity"].format(oz=it.oz, qty=f"{it.quantity:g}", unit=it.unit)))
        # arithmetic (priced files only)
        if it.quantity is not None and it.unit_price is not None and it.total_price is not None:
            if abs(it.quantity * it.unit_price - it.total_price) > max(0.02, 0.0005 * abs(it.total_price)):
                f.append(Finding("arithmetic", "high", it.oz,
                                 f"{it.quantity:g} × {it.unit_price:g} = {it.quantity * it.unit_price:,.2f}, but total is {it.total_price:,.2f}",
                                 message_de=f"{it.quantity:g} × {it.unit_price:g} = {it.quantity * it.unit_price:,.2f}, Gesamtpreis ist aber {it.total_price:,.2f}",
                                 question=_Q["arithmetic"].format(oz=it.oz), question_en=_Q_EN["arithmetic"].format(oz=it.oz)))
        # optional / Bedarf
        if it.kind == "optional":
            f.append(Finding("optional", "medium", it.oz, "Optional (Bedarfs-) item: outside the total, a common change-order source",
                             message_de=_MSG_DE["optional"], question=_Q["optional"].format(oz=it.oz), question_en=_Q_EN["optional"].format(oz=it.oz)))
        # broad lump sum
        if it.kind == "lump_sum":
            t = it.text
            n_incl = len(re.findall(r"einschl\.|einschließlich|inklusive|inkl\.", t, flags=re.I))
            if len(t) > 700 or n_incl >= 4:
                f.append(Finding("lump_sum", "medium", it.oz,
                                 f"Lump sum with broad scope ({len(t)} characters, {n_incl}× 'incl.')",
                                 message_de=f"Pauschale mit weitem Leistungsumfang ({len(t)} Zeichen, {n_incl}× „einschl.“)",
                                 question=_Q["lump_sum"].format(oz=it.oz), question_en=_Q_EN["lump_sum"].format(oz=it.oz)))
        # references to missing items
        for ref in it.refs:
            if norm_oz(ref) not in oz_set:
                f.append(Finding("reference", "high", it.oz, f"References item {ref}, which is not in this BoQ",
                                 message_de=f"Verweist auf Pos. {ref}, die im LV nicht vorhanden ist",
                                 question=_Q["reference"].format(oz=it.oz, ref=ref), question_en=_Q_EN["reference"].format(oz=it.oz, ref=ref)))
        f += _phrase_findings(it, VAGUE, "vague")
        f += _phrase_findings(it, RISK, "risk_transfer")
        f += _phrase_findings(it, INTERFACE, "interface")

    # quantity outliers (same unit, enough peers)
    by_unit: dict[str, list[Item]] = defaultdict(list)
    for it in items:
        if it.kind == "normal" and it.quantity and it.quantity > 0 and it.unit:
            by_unit[it.unit].append(it)
    for unit, group in by_unit.items():
        if len(group) < 8:
            continue
        logs = [math.log10(i.quantity) for i in group]
        med = statistics.median(logs)
        mad = statistics.median(abs(x - med) for x in logs) or 0.3
        for it, lg in zip(group, logs):
            z = abs(lg - med) / (1.4826 * mad)
            if z > 3.5 and abs(lg - med) > 1.0:
                ratio = it.quantity / (10 ** med)
                f.append(Finding("quantity", "low" if ratio < 1 else "medium", it.oz,
                                 f"Unusual quantity {it.quantity:g} {unit}: about {ratio:.0f}× the typical {unit} item in this BoQ"
                                 if ratio >= 1 else f"Unusually small quantity {it.quantity:g} {unit} compared with similar items",
                                 question=_Q["quantity"].format(oz=it.oz, qty=f"{it.quantity:g}", unit=unit)))
    f += run_dependency_checks(project)
    f += run_quantity_consistency(project)
    return f
