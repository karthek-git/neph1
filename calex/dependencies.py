"""Cross-trade dependency rules: an item that implies other work which appears nowhere in the BoQ.

Each rule: if any item matches `trigger`, then the BoQ should contain an item matching `needs`
(anywhere, any trade). If not, we raise one finding on the first triggering item. A hit can mean the work
is in another trade's BoQ, so the bidder question asks exactly that.
"""
from __future__ import annotations
import re
from .models import Project, Finding

RULES = [
    dict(id="floor_substrate", severity="medium",
         trigger=r"Bodenbelag|PVC-Belag|Linoleum|Parkett|Teppich|Kautschuk|Designbelag|Vinyl|Fliesenbelag|Natursteinbelag",
         needs=r"Spachtel|Grundier|Estrich|Untergrund|Ausgleichsmasse|Haftbr",
         msg="Floor covering priced, but no screed, levelling or substrate preparation item exists in this BoQ",
         ask="Wo ist die Untergrundvorbereitung (Estrich, Spachtelung, Grundierung) für die Bodenbeläge ausgeschrieben, und in welchem Zustand wird der Untergrund übergeben?"),
    dict(id="wet_tiles", severity="medium",
         trigger=r"(Fliesen|Naturstein)\w*[^.]{0,200}(Dusche|Nassraum|Bad\b|WC|Sanitär)|(Dusche|Nassraum)[^.]{0,200}(Fliesen|Naturstein)",
         needs=r"Abdichtung|Verbundabdichtung|Dichtschlämme|Dichtband",
         msg="Tiling in wet rooms, but no waterproofing item in this BoQ",
         ask="Wer führt die Abdichtung unter den Fliesen in den Nassräumen aus, und ist sie in einem anderen Leistungsverzeichnis enthalten?"),
    dict(id="pipe_tests", severity="medium",
         trigger=r"(Rohr|Rohre|Rohrleitung\w*)\b[^.]{0,60}\b(verlegen|liefern|einbauen|herstellen)|Druckrohr|Muffendruckrohr|Rohr\s+DN\s*\d+",
         needs=r"Druckprüfung|Dichtheitsprüfung|Dichtigkeitsprüfung|Abdrücken|Prüfung der Rohrleitung",
         msg="Pipes are to be laid, but no pressure or leak test item exists in this BoQ",
         ask="Ist die Druck- bzw. Dichtheitsprüfung der Rohrleitungen in den Verlegepositionen enthalten, oder wird sie als eigene Position vergütet?"),
    dict(id="pipe_disinfection", severity="low",
         trigger=r"Trinkwasser\w*[^.]{0,120}(Rohr|Leitung)|(Rohr|Leitung)[^.]{0,120}Trinkwasser",
         needs=r"Desinfektion|Spülung|Spülen",
         msg="Drinking-water pipework, but no flushing or disinfection item exists in this BoQ",
         ask="Ist die Spülung und Desinfektion der Trinkwasserleitungen in einer Position enthalten, und wer trägt die Laborkosten?"),
    dict(id="excavation_disposal", severity="medium",
         trigger=r"\b(Aushub|Baugrubenaushub|Grabenaushub|Bodenaushub|Abtrag)\b",
         needs=r"Entsorg|Abfuhr|Abtransport|Deponie|Wiedereinbau|Verfüll|Wiederverfüll|Seitenlager",
         msg="Excavation, but no disposal, reuse or backfill item exists in this BoQ",
         ask="Wohin wird der Aushub abgefahren bzw. wo wird er zwischengelagert, und ist die Entsorgung eigens ausgeschrieben?"),
    dict(id="screed_edge", severity="low",
         trigger=r"\bEstrich\b",
         needs=r"Randdämmstreifen|Randstreifen|Bewegungsfuge|Dehnungsfuge|Scheinfuge|Fugen",
         msg="Screed, but no edge strips or movement joints item exists in this BoQ",
         ask="Sind Randdämmstreifen und Bewegungsfugen im Estrich einzukalkulieren oder gesondert ausgeschrieben?"),
    dict(id="heated_screed", severity="medium",
         trigger=r"Heizestrich|Fußbodenheizung|Bodenheizung|Betonkernaktivierung|Industriebodenheizung",
         needs=r"Aufheizprotokoll|Funktionsheizen|Belegreifheizen|Aufheiz",
         msg="Heated floor or slab, but no functional heating or heat-up protocol item exists in this BoQ",
         ask="Wer führt das Funktions- und Belegreifheizen samt Protokoll aus, und wer trägt die Energiekosten?"),
    dict(id="door_hardware", severity="low",
         trigger=r"\b(Stahltür|Türelement|Türblatt|Tür\b|Türen\b|Tor\b|Sektionaltor)",
         needs=r"Beschlag|Drücker|Schloss|Zylinder|Antrieb|Türschließer|Garnitur|Schließ",
         msg="Doors or gates, but no hardware, lock or drive item exists in this BoQ",
         ask="Sind Beschläge, Schließzylinder und Antriebe in den Türpositionen enthalten, oder werden sie gesondert (z. B. über die Schließanlage) vergeben?"),
    dict(id="roof_details", severity="medium",
         trigger=r"Dachabdichtung|Flachdach|Bitumenbahn|Kunststoffdachbahn|Dampfsperre",
         needs=r"Attika|Anschluss|Notüberlauf|Lichtkuppel|Dachrand|Entwässerung|Dachablauf",
         msg="Roof waterproofing, but no edge, upstand, outlet or overflow items exist in this BoQ",
         ask="Wo sind die Attika-/Anschlussdetails, Dachabläufe und Notüberläufe ausgeschrieben?"),
    dict(id="switchgear_test", severity="medium",
         trigger=r"Schaltanlage|Schaltschrank|Verteiler",
         needs=r"Inbetriebnahme|Prüfung|Abnahme|Dokumentation|Prüfprotokoll",
         msg="Switchgear or distribution boards, but no commissioning, test or documentation item exists in this BoQ",
         ask="Ist die Prüfung nach DIN VDE sowie Inbetriebnahme und Dokumentation in den Positionen enthalten?"),
    dict(id="pumps_commissioning", severity="low",
         trigger=r"\bPumpe\b|Pumpen\b|Armatur\w*|Absperrschieber",
         needs=r"Inbetriebnahme|Probebetrieb|Einweisung",
         msg="Pumps or valves, but no commissioning or trial-operation item exists in this BoQ",
         ask="Sind Inbetriebnahme, Probebetrieb und Einweisung des Personals in einer Position enthalten?"),
    dict(id="concrete_formwork", severity="low",
         trigger=r"Ortbeton|Beton C\d|Betonplatte|Bodenplatte|Fundamentplatte",
         needs=r"Schalung|Bewehrung|Betonstahl|Fertigteil",
         msg="Cast-in-place concrete, but no formwork or reinforcement item exists in this BoQ",
         ask="Sind Schalung und Bewehrung in den Betonpositionen enthalten oder gesondert ausgeschrieben?"),
    dict(id="static_proof", severity="medium",
         trigger=r"Fertigteil\w*|Stahlkonstruktion|Binder\b",
         needs=r"statisch|Statik|Prüfstatik|Standsicherheit|Tragfähigkeitsnachweis|Prüfbare",
         msg="Structural prefabricated parts or steel, but no structural calculation item exists in this BoQ",
         ask="Wer erstellt und bezahlt die statische Berechnung und die Ausführungsplanung für diese Bauteile?"),
]


TR = {
    "floor_substrate": ("Bodenbelag ausgeschrieben, aber keine Position für Estrich, Spachtelung oder Untergrundvorbereitung in diesem LV",
                        "Where is the substrate preparation (screed, levelling, primer) for the floor coverings specified, and in what condition is the substrate handed over?"),
    "wet_tiles": ("Fliesen in Nassräumen, aber keine Abdichtungsposition in diesem LV",
                  "Who carries out the waterproofing under the tiles in the wet rooms, and is it included in another BoQ?"),
    "pipe_tests": ("Rohrleitungen werden verlegt, aber keine Position für Druck- oder Dichtheitsprüfung in diesem LV",
                   "Is the pressure or leak test of the pipelines included in the laying items, or paid as a separate item?"),
    "pipe_disinfection": ("Trinkwasserleitungen, aber keine Position für Spülung oder Desinfektion in diesem LV",
                          "Is flushing and disinfection of the drinking-water pipes included in an item, and who bears the laboratory costs?"),
    "excavation_disposal": ("Aushub, aber keine Position für Entsorgung, Wiedereinbau oder Verfüllung in diesem LV",
                            "Where is the excavated material taken or stored, and is disposal specified as a separate item?"),
    "screed_edge": ("Estrich, aber keine Position für Randdämmstreifen oder Bewegungsfugen in diesem LV",
                    "Are edge insulation strips and movement joints in the screed to be included in the price, or tendered separately?"),
    "heated_screed": ("Beheizter Boden bzw. Bauteil, aber keine Position für Funktionsheizen oder Aufheizprotokoll in diesem LV",
                      "Who carries out the functional and ready-for-covering heating including the protocol, and who bears the energy costs?"),
    "door_hardware": ("Türen oder Tore, aber keine Position für Beschläge, Schlösser oder Antriebe in diesem LV",
                      "Are hardware, lock cylinders and drives included in the door items, or awarded separately (e.g. via the locking system)?"),
    "roof_details": ("Dachabdichtung, aber keine Positionen für Anschlüsse, Attika, Abläufe oder Notüberläufe in diesem LV",
                     "Where are the parapet/upstand details, roof outlets and emergency overflows specified?"),
    "switchgear_test": ("Schaltanlagen oder Verteiler, aber keine Position für Inbetriebnahme, Prüfung oder Dokumentation in diesem LV",
                        "Are testing per DIN VDE, commissioning and documentation included in the items?"),
    "pumps_commissioning": ("Pumpen oder Armaturen, aber keine Position für Inbetriebnahme oder Probebetrieb in diesem LV",
                            "Are commissioning, trial operation and instruction of personnel included in an item?"),
    "concrete_formwork": ("Ortbeton, aber keine Position für Schalung oder Bewehrung in diesem LV",
                          "Are formwork and reinforcement included in the concrete items or tendered separately?"),
    "static_proof": ("Fertigteile oder Stahlkonstruktion, aber keine Position für statische Berechnung in diesem LV",
                     "Who prepares and pays for the structural calculation and execution design for these components?"),
}


def _ctx(text: str, m: re.Match, w: int = 60) -> str:
    a, b = max(0, m.start() - w), min(len(text), m.end() + w)
    return re.sub(r"\s+", " ", text[a:b]).strip()


def run_dependency_checks(project: Project) -> list[Finding]:
    items = project.items
    if len(items) < 5 or sum(1 for i in items if len(i.text) > 25) < 0.5 * len(items):
        return []   # price-only files (e.g. D84) carry no item text to reason about
    blob = "\n".join(i.text for i in items)
    out: list[Finding] = []
    for r in RULES:
        if re.search(r["needs"], blob, flags=re.I):
            continue
        for it in items:
            m = re.search(r["trigger"], it.text, flags=re.I)
            if m:
                out.append(Finding(
                    category="missing", severity=r["severity"], oz=it.oz,
                    message=r["msg"] + ". It may be in another trade's BoQ: confirm before pricing.",
                    quote=_ctx(it.text, m),
                    message_de=TR[r["id"]][0] + ". Möglicherweise in einem anderen LV enthalten: vor der Kalkulation klären.",
                    question=f"Zu Pos. {it.oz}: " + r["ask"], question_en=f"Item {it.oz}: " + TR[r["id"]][1], source="rule"))
                break
    return out


# ---- cross-trade quantity consistency: the same physical area should carry the same quantity in each trade ----
QTY_RULES = [
    dict(id="screed_vs_floor", a=r"\bEstrich\b", b=r"Bodenbelag|PVC-Belag|Linoleum|Parkett|Teppich|Kautschuk|Designbelag|Vinyl|Fliesenbelag",
         a_name="screed", b_name="floor covering", a_de="Estrich", b_de="Bodenbelag"),
    dict(id="roof_insul_vs_seal", a=r"Dachabdichtung|Bitumenbahn|Kunststoffdachbahn", b=r"(Wärmedämmung|Gefälledämmung|Dämmung)[^.]{0,100}Dach|Dach[^.]{0,100}(Wärmedämmung|Gefälledämmung|Dämmung)",
         a_name="roof waterproofing", b_name="roof insulation", a_de="Dachabdichtung", b_de="Dachdämmung"),
]
QTY_TOLERANCE = 0.25      # differences above 25 % are reported
QTY_MIN = 10.0            # ignore tiny areas (m2)


def _sum_m2(items, pattern: str) -> tuple[float, list]:
    hit = [i for i in items if i.kind == "normal" and i.quantity and i.unit.lower().replace("²", "2") in ("m2", "qm") and re.search(pattern, i.text, flags=re.I)]
    return sum(i.quantity for i in hit), hit


def run_quantity_consistency(project: Project) -> list[Finding]:
    out: list[Finding] = []
    for r in QTY_RULES:
        a_sum, a_items = _sum_m2(project.items, r["a"])
        b_sum, b_items = _sum_m2(project.items, r["b"])
        if a_sum < QTY_MIN or b_sum < QTY_MIN:
            continue
        if {i.oz for i in a_items} & {i.oz for i in b_items}:      # the same item matching both sides is not a comparison
            continue
        diff = abs(a_sum - b_sum) / max(a_sum, b_sum)
        if diff <= QTY_TOLERANCE:
            continue
        first = a_items[0]
        m = re.search(r["a"], first.text, flags=re.I)
        fa, fb = f"{a_sum:g}", f"{b_sum:g}"
        out.append(Finding(
            category="quantity", severity="medium", oz=first.oz,
            message=f"The total {r['a_name']} area ({fa} m²) differs from the total {r['b_name']} area ({fb} m²) by {diff:.0%}. They are normally the same area: one of the quantities may be wrong.",
            quote=_ctx(first.text, m) if m else first.short_text,
            message_de=f"Die Gesamtfläche {r['a_de']} ({fa} m²) weicht um {diff:.0%} von der Gesamtfläche {r['b_de']} ({fb} m²) ab. Üblicherweise ist es dieselbe Fläche: eine der Mengen könnte falsch sein.",
            question=f"Zu Pos. {first.oz}: Die Mengen für {r['a_de']} ({fa} m²) und {r['b_de']} ({fb} m²) weichen voneinander ab. Bitte bestätigen Sie die maßgebliche Fläche bzw. erläutern Sie den Unterschied (z. B. Teilflächen ohne {r['b_de']}).",
            question_en=f"Item {first.oz}: The quantities for {r['a_name']} ({fa} m²) and {r['b_name']} ({fb} m²) differ. Please confirm the correct area or explain the difference (e.g. partial areas without {r['b_name']}).",
            source="rule"))
    return out
