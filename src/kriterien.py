"""Kriterien-Katalog: zehn Filter je Anlageklasse, als Spezifikation für Python UND Browser.

Jedes Kriterium besteht aus einem oder zwei Teilen. Ein Teil vergleicht eine Kennzahl mit einer Schwelle aus
config.yaml und liefert eine Stärke 0–100: genau 50 an der Schwelle, 0 am Nullpunkt, 100 am Vollpunkt (linear,
beim Börsenwert logarithmisch). Zwei Teile werden mit „und“ (schwächster zählt, beide nötig) oder „oder“
(stärkster zählt, einer reicht) verknüpft. Die Website bekommt diese Spezifikation als JSON und rechnet mit
denselben Regeln (assets/regeln.js), deshalb gibt es die Logik nur einmal.

Auswahl der Kriterien: öffentlich dokumentierte Faktor-Frameworks großer Häuser. Aktien: MSCI FaCS (Value, Size,
Momentum, Volatility, Quality, Yield, Growth) und die Faktor-Indizes von J.P. Morgan und Goldman Sachs; Währungen:
FX-Risikoprämien (Carry, Momentum, Value); Rohstoffe: Carry/Terminstruktur, Trend, Value, Positionierung;
Indizes: Trend- und Risikoindikatoren der Aktienstrategen (VIX, Kreditspreads).
"""
from __future__ import annotations

import math

from .screening import _oder, _und, skala

# ---------------------------------------------------------------- Formate (identisch in assets/regeln.js)


def _de(x: float, nk: int) -> str:
    return f"{x:,.{nk}f}".replace(",", "X").replace(".", ",").replace("X", ".")


def fmt(x, code: str) -> str:
    """Formatiert eine Zahl für Texte: p0 = 17 %, p1v = +3,8 %, pp = +1,25 Pp., x2 = 1,05×, mrd = 229 Mrd. € …"""
    if code == "t":
        return "–" if x in (None, "") else str(x)
    if x is None or (isinstance(x, float) and (math.isnan(x) or math.isinf(x))):
        return "–"
    vz = code.endswith("v")
    c = code[:-1] if vz else code
    zeichen = "+" if vz and x > 0 else ""
    if c in ("p0", "p1", "p2"):
        s = zeichen + _de(x * 100, int(c[1])) + " %"
    elif c == "pp":
        s = ("+" if x > 0 else "") + _de(x * 100, 2) + " Pp."
    elif c in ("x1", "x2"):
        s = _de(x, int(c[1])) + "×"
    elif c in ("z0", "z1", "z2"):
        s = zeichen + _de(x, int(c[1]))
    elif c == "mrd":
        s = _de(x / 1e9, 0 if abs(x) >= 1e11 else 1) + " Mrd. €"
    elif c == "geld":
        s = _de(x / 1e9, 1) + " Mrd."
    elif c == "zmrd":
        s = _de(x, 0) + " Mrd. €"
    else:
        s = _de(x, 2)
    return s.replace("-", "−")


def text(vorlage: str | list, kz: dict, params: dict) -> str | None:
    """Begründung aus Textbausteinen; ein Baustein entfällt, wenn ihm eine Zahl fehlt."""
    import re
    teile = vorlage if isinstance(vorlage, list) else [vorlage]
    aus = []
    for t in teile:
        fehlt = False

        def ersetze(m):
            nonlocal fehlt
            name, code = m.group(1), m.group(2)
            wert = params.get(name[1:]) if name.startswith("@") else kz.get(name)
            if wert is None:
                fehlt = True
            return fmt(wert, code)
        s = re.sub(r"\{(@?\w+):(\w+)\}", ersetze, t)
        if not fehlt:
            aus.append(s)
    return ", ".join(aus) if aus else None


# ---------------------------------------------------------------- Katalog

def _t(k, name, p, r, n=None, v=None, fmt="p0", rechnung="", **extra):
    """Ein Teil: Kennzahl k, Schwelle aus Parameter p, Richtung r (">=" oder "<="), Null- und Vollpunkt relativ zur Schwelle."""
    d = {"k": k, "name": name, "p": p, "r": r, "fmt": fmt, "rechnung": rechnung}
    if n is not None:
        d["n"] = n
    if v is not None:
        d["v"] = v
    d.update(extra)
    return d


def _k(name, kurz, familie, erklaerung, definition, quelle, teile, text_, verkn="einzeln", standard=False, kursbasiert=False):
    return {"name": name, "kurz": kurz, "familie": familie, "erklaerung": erklaerung, "definition": definition,
            "quelle": quelle, "teile": teile, "text": text_, "verkn": verkn, "standard": standard, "kursbasiert": kursbasiert}


_MOM = _t("momentum_12_1", "12-1-Monats-Rendite", "{p}", ">=", -0.15, 0.25, "p1v", "Kurs vor 1 Monat ÷ Kurs vor 12 Monaten − 1")
_GD = "Kurs ÷ 200-Tage-Linie − 1"


def _mom(p, standard=False, quelle="Time-Series-Momentum: Moskowitz, Ooi, Pedersen (2012); Momentum-Faktor bei MSCI und J.P. Morgan"):
    return _k("Momentum" if standard else "Preis-Momentum", "Momentum" if standard else "Kurs-Mom.", "Momentum",
              "Kursentwicklung 12 Monate ohne den letzten Monat",
              "Kurs ist über 12 Monate, ohne den jüngsten Monat, um mindestens {@" + p + ":p0v} gestiegen",
              quelle, [dict(_MOM, p=p)], "12-1-Monats-Rendite {momentum_12_1:p0v}", standard=standard, kursbasiert=True)


def _kurz_mom(p):
    return _k("Kurzfrist-Momentum", "3M", "Momentum", "Kursentwicklung der letzten 3 Monate",
              "Kurs ist in den letzten 3 Monaten um mindestens {@" + p + ":p0v} gestiegen",
              "Mehrfristige Trendsignale der Managed-Futures- und Risikoprämien-Indizes",
              [_t("rendite_3m", "3-Monats-Rendite", p, ">=", -0.06, 0.08, "p1v", "{kurs:kurs} ÷ {kurs_3m:kurs} (vor 3 Monaten) − 1")],
              "3-Monats-Rendite {rendite_3m:p1v}", kursbasiert=True)


def _trend(p, standard=False, n=-0.04, v=0.04):
    return _k("Trend", "Trend", "Momentum", "Abstand zur 200-Tage-Linie",
              "Kurs notiert mindestens {@" + p + ":p1v} über seiner 200-Tage-Linie, der langfristige Trend ist intakt",
              "Trendfilter der Aktien- und Multi-Asset-Strategen (200-Tage-Linie)",
              [_t("abstand_gd200", "Abstand zur 200-Tage-Linie", p, ">=", n, v, "p1v", "{kurs:kurs} ÷ {gd200:kurs} − 1")],
              "{abstand_gd200:p0v} gegenüber der 200-Tage-Linie", standard=standard, kursbasiert=True)


def _vol_regime(p):
    return _k("Vol-Regime", "Vol-Regime", "Volatilität", "Schwankung jetzt im Vergleich zum Jahr",
              "Schwankung des letzten Monats höchstens {@" + p + ":x2} ihr Jahres-Median, der Markt ist ruhiger als üblich",
              "Volatilitäts-Regime: Risikosteuerung der Multi-Asset-Häuser",
              [_t("vol_verhaeltnis", "Vola-Verhältnis", p, "<=", 0.5, -0.4, "x2", "{vol_1m:p1} (1 Monat) ÷ {vol_median_1j:p1} (Median 1 Jahr)")],
              "Vola 1M {vol_1m:p1} gegenüber Median 1J {vol_median_1j:p1}", standard=True, kursbasiert=True)


def _vol_niveau(p, n, v, quelle):
    return _k("Volatilitätsniveau", "Vola", "Volatilität", "Annualisierte Schwankung des letzten Jahres",
              "Schwankung des letzten Jahres höchstens {@" + p + ":p0} pro Jahr",
              quelle, [_t("vol_1j", "Schwankung p. a.", p, "<=", n, v, "p1", "Standardabweichung der Tagesrenditen × √252")],
              "Schwankung {vol_1j:p1} p. a.", kursbasiert=True)


def _saison(p):
    return _k("Saisonalität", "Saison", "Saisonalität", "Durchschnitt des kommenden Monats in früheren Jahren",
              "Im kommenden Kalendermonat ist der Kurs in den vergangenen Jahren im Schnitt um mindestens {@" + p + ":p1v} gestiegen",
              "Saisonale Muster, z. B. in den Rohstoff- und Aktienkalendern der Banken",
              [_t("saison", "Ø Rendite im Folgemonat", p, ">=", -0.03, 0.03, "p1v",
                  "Ø der {monat:t}-Renditen aus {jahre:z0} Jahren, positiv in {saison_quote:p0}")],
              "Ø {saison:p1v} im {monat:t} ({jahre:z0} Jahre)")


KATALOG: dict[str, list[dict]] = {
    "aktie": [
        _k("Large Cap", "Large Cap", "Size", "Marktkapitalisierung",
           "Börsenwert von mindestens {@min_boersenwert_mrd_eur:zmrd}, also ein etablierter Großkonzern",
           "MSCI FaCS: Size",
           [_t("boersenwert_eur", "Börsenwert", "min_boersenwert_mrd_eur", ">=", fmt="mrd", log=True, skal=1e9,
               rechnung="Aktienanzahl × Kurs, in Euro umgerechnet")],
           "Market Cap {boersenwert_eur:mrd} (Schwelle {@min_boersenwert_mrd_eur:zmrd})", standard=True),
        _k("Earnings Momentum", "Earnings", "Growth", "Umsatz- und Gewinnwachstum YoY",
           "Umsatz wächst um mindestens {@min_umsatzwachstum:p0} und der Gewinn um mindestens {@min_gewinnwachstum:p0}, jeweils gegenüber dem Vorjahresquartal",
           "MSCI FaCS: Growth",
           [_t("umsatzwachstum", "Umsatzwachstum", "min_umsatzwachstum", ">=", -0.15, 0.25, "p0v", "Umsatz Quartal ÷ Umsatz Vorjahresquartal − 1"),
            _t("gewinnwachstum", "Gewinnwachstum", "min_gewinnwachstum", ">=", -0.30, 0.40, "p0v", "Gewinn Quartal ÷ Gewinn Vorjahresquartal − 1")],
           "Umsatz {umsatzwachstum:p0v} YoY, Gewinn {gewinnwachstum:p0v} YoY (Vorjahresquartal)", "und", standard=True),
        _k("Pullback", "Pullback", "Momentum", "Drawdown vom 52W-Hoch und Lage in der Range",
           "Kurs mindestens {@min_abstand_hoch:p0} unter dem 52-Wochen-Hoch und im unteren {@max_position_spanne:p0} der Jahresspanne",
           "Rücksetzer-Filter (Mean Reversion) der Equity-Strategen",
           [_t("abstand_hoch", "Drawdown", "min_abstand_hoch", ">=", -0.20, 0.30, "p0", "1 − {kurs:kurs} ÷ {hoch:kurs} (52W-Hoch)"),
            _t("position_spanne", "Range-Position", "max_position_spanne", "<=", fmt="p0", n_abs=1.0, v_abs=0.0,
               rechnung="({kurs:kurs} − {tief:kurs}) ÷ ({hoch:kurs} − {tief:kurs})")],
           "Drawdown {abstand_hoch:p0} vom 52W-Hoch, Range-Position {position_spanne:p0}", "und", standard=True, kursbasiert=True),
        _k("Valuation Gap", "Valuation", "Value", "Forward-KGV gegenüber 5J-Median, Upside zum Kursziel",
           "Forward-KGV höchstens {@max_kgv_vs_median:p0} des eigenen 5-Jahres-Medians oder mindestens {@min_kursziel_abstand:p0} Upside zum Kursziel",
           "MSCI FaCS: Value; Kursziel-Konsens",
           [_t("kgv_rel", "Fwd-KGV zum 5J-Median", "max_kgv_vs_median", "<=", 0.40, -0.30, "p0", "{fwd_kgv:z1} ÷ {kgv_median:z1}"),
            _t("kursziel_abstand", "Upside zum Kursziel", "min_kursziel_abstand", ">=", -0.30, 0.30, "p0v", "{ziel:kurs} ÷ {kurs:kurs} − 1")],
           ["Fwd-KGV {fwd_kgv:z1} gegenüber Ø 5J {kgv_median:z1}", "Upside {kursziel_abstand:p0v} zum Konsens-Kursziel"], "oder", standard=True),
        _mom("min_momentum_12_1", quelle="MSCI FaCS: Momentum; J.P. Morgan und Goldman Sachs Momentum-Faktor"),
        _k("Profitabilität", "Qualität", "Quality", "Eigenkapitalrendite",
           "Eigenkapitalrendite von mindestens {@min_roe:p0}, das Geschäft verdient deutlich mehr als seine Kapitalkosten",
           "MSCI FaCS: Quality (Profitability); J.P. Morgan Quality",
           [_t("roe", "Eigenkapitalrendite", "min_roe", ">=", -0.15, 0.20, "p0", "Jahresüberschuss ÷ Eigenkapital (letzte 12 Monate)")],
           "Eigenkapitalrendite {roe:p0}"),
        _k("Solide Bilanz", "Bilanz", "Quality", "Nettoverschuldung im Verhältnis zum EBITDA",
           "Nettoverschuldung höchstens {@max_nd_ebitda:x1} des operativen Gewinns vor Abschreibungen (EBITDA)",
           "MSCI FaCS: Quality (Leverage); J.P. Morgan Quality (Solvency)",
           [_t("nd_ebitda", "Nettoverschuldung ÷ EBITDA", "max_nd_ebitda", "<=", 2.0, -2.0, "x1",
               "({schulden:geld} Schulden − {cash:geld} Liquidität) ÷ {ebitda:geld} EBITDA")],
           "Nettoverschuldung {nd_ebitda:x1} EBITDA"),
        _k("FCF-Rendite", "FCF", "Value", "Free Cashflow im Verhältnis zum Börsenwert",
           "Free Cashflow von mindestens {@min_fcf_rendite:p1} des Börsenwerts pro Jahr",
           "MSCI FaCS: Value und Yield (Cash-Flow-Rendite)",
           [_t("fcf_rendite", "Free-Cashflow-Rendite", "min_fcf_rendite", ">=", -0.03, 0.05, "p1", "Free Cashflow (12 Monate) ÷ Börsenwert, beides in Euro")],
           "Free-Cashflow-Rendite {fcf_rendite:p1}"),
        _k("Gewinnrevisionen", "Revisionen", "Growth", "Änderung der Gewinnschätzung in 90 Tagen",
           "Analysten haben die Gewinnschätzung fürs nächste Geschäftsjahr in 90 Tagen um mindestens {@min_eps_revision:p1v} verändert",
           "Earnings-Revisions-Faktor der Sell-Side-Quant-Modelle",
           [_t("eps_revision", "Revision der EPS-Schätzung", "min_eps_revision", ">=", -0.05, 0.05, "p1v",
               "{eps_neu:z2} heute ÷ {eps_alt:z2} vor 90 Tagen − 1 (nächstes Geschäftsjahr)")],
           "Gewinnschätzung nächstes Geschäftsjahr {eps_revision:p1v} in 90 Tagen"),
        _vol_niveau("max_vol_1j", 0.20, -0.15, "MSCI FaCS: Volatility; J.P. Morgan Minimum Volatility") | {"name": "Niedrige Volatilität", "kurz": "Low Vol"},
    ],
    "forex": [
        _k("Carry", "Carry", "Carry", "Zinsdifferenz der beiden Notenbanken",
           "Leitzins der Basiswährung liegt mindestens {@min_zinsdifferenz:pp} über dem der Gegenwährung, wer sie hält, verdient den Zinsvorsprung",
           "FX-Risikoprämie Carry (Deutsche Bank, J.P. Morgan, Goldman Sachs)",
           [_t("zinsdifferenz", "Zinsdifferenz", "min_zinsdifferenz", ">=", -0.02, 0.03, "pp",
               "{basis:t} {zins_basis:p2} − {gegen:t} {zins_gegen:p2} (Leitzinsen, BIS)")],
           "Zinsdifferenz {zinsdifferenz:pp} p. a. ({basis:t} {zins_basis:p2} gegenüber {gegen:t} {zins_gegen:p2})", standard=True),
        _mom("min_momentum", standard=True, quelle="FX-Risikoprämie Momentum"),
        _k("Value", "Value", "Value", "Abstand zum 5-Jahres-Mittel",
           "Kurs mindestens {@min_abweichung_mittel:p0} unter seinem 5-Jahres-Mittel, die Basiswährung ist historisch günstig",
           "FX-Risikoprämie Value (Kaufkraftparität, hier vereinfacht über das 5-Jahres-Mittel)",
           [_t("abweichung_mittel_5j", "Abstand zum 5-Jahres-Mittel", "min_abweichung_mittel", "<=", 0.10, -0.15, "p1v",
               "{kurs:kurs} ÷ {mittel_5j:kurs} − 1", vz=-1)],
           "{abweichung_mittel_5j:p0v} gegenüber dem 5-Jahres-Mittel", standard=True, kursbasiert=True),
        _vol_regime("max_vol_verhaeltnis"),
        _k("Carry-to-Risk", "C/Risk", "Carry", "Zinsvorsprung je Einheit Schwankung",
           "Zinsdifferenz geteilt durch die Jahresschwankung beträgt mindestens {@min_carry_risk:z2}",
           "Carry-to-Risk, Standardkennzahl der FX-Risikoprämien-Indizes",
           [_t("carry_risk", "Carry ÷ Schwankung", "min_carry_risk", ">=", -0.3, 0.4, "z2", "{zinsdifferenz:pp} ÷ {vol_1j:p1} Schwankung p. a.")],
           "Carry-to-Risk {carry_risk:z2}"),
        _trend("min_abstand_gd200", n=-0.03, v=0.03),
        _kurz_mom("min_rendite_3m"),
        _k("Zinstrend", "Zinstrend", "Carry", "Veränderung der Zinsdifferenz in 3 Monaten",
           "Die Zinsdifferenz ist in den letzten 3 Monaten um mindestens {@min_zins_trend:pp} gewachsen",
           "Zinserwartungen als Treiber der Wechselkurse (Leitzinsverlauf der BIS)",
           [_t("zins_trend", "Veränderung der Zinsdifferenz", "min_zins_trend", ">=", -0.005, 0.005, "pp",
               "{zinsdifferenz:pp} heute − {zinsdifferenz_3m:pp} vor 3 Monaten")],
           "Zinsdifferenz in 3 Monaten {zins_trend:pp}"),
        _k("Realzins-Vorsprung", "Realzins", "Value", "Zinsdifferenz nach Abzug der Inflation",
           "Der reale Leitzins (Zins minus Inflation) der Basiswährung liegt mindestens {@min_realzins_diff:pp} über dem der Gegenwährung",
           "Realzinsdifferenz, Fundamentalfaktor der FX-Research-Teams (Inflation laut BIS)",
           [_t("realzins_diff", "Realzinsdifferenz", "min_realzins_diff", ">=", -0.02, 0.02, "pp",
               "({zins_basis:p2} − {inflation_basis:p1}) − ({zins_gegen:p2} − {inflation_gegen:p1})")],
           "Realzinsdifferenz {realzins_diff:pp} ({basis:t} real {real_basis:p1}, {gegen:t} real {real_gegen:p1})"),
        _vol_niveau("max_vol_1j", 0.06, -0.05, "Risikobudget der Währungsstrategien"),
    ],
    "rohstoff": [
        _mom("min_momentum", standard=True, quelle="Rohstoff-Risikoprämie Momentum (Trend)"),
        _k("Pullback", "Pullback", "Momentum", "Drawdown vom 52W-Hoch und Lage in der Range",
           "Kurs mindestens {@min_abstand_hoch:p0} unter dem 52-Wochen-Hoch und im unteren {@max_position_spanne:p0} der Jahresspanne",
           "Rücksetzer-Filter der Rohstoffstrategen",
           [_t("abstand_hoch", "Drawdown", "min_abstand_hoch", ">=", -0.15, 0.25, "p0", "1 − {kurs:kurs} ÷ {hoch:kurs} (52W-Hoch)"),
            _t("position_spanne", "Range-Position", "max_position_spanne", "<=", fmt="p0", n_abs=1.0, v_abs=0.0,
               rechnung="({kurs:kurs} − {tief:kurs}) ÷ ({hoch:kurs} − {tief:kurs})")],
           "Drawdown {abstand_hoch:p0} vom 52W-Hoch, Range-Position {position_spanne:p0}", "und", standard=True, kursbasiert=True),
        _k("Value", "Value", "Value", "Abstand zum 5-Jahres-Mittel",
           "Kurs höchstens {@max_abweichung_mittel:p0v} über seinem 5-Jahres-Mittel",
           "Rohstoff-Risikoprämie Value (Rückkehr zum langfristigen Mittel)",
           [_t("abweichung_mittel_5j", "Abstand zum 5-Jahres-Mittel", "max_abweichung_mittel", "<=", 0.25, -0.25, "p1v", "{kurs:kurs} ÷ {mittel_5j:kurs} − 1")],
           "{abweichung_mittel_5j:p0v} gegenüber dem 5-Jahres-Mittel", standard=True, kursbasiert=True),
        _vol_regime("max_vol_verhaeltnis"),
        _k("Terminstruktur", "Kurve", "Carry", "Roll-Rendite zwischen den nächsten Kontrakten",
           "Annualisierte Roll-Rendite von mindestens {@min_roll_rendite:p0v}, die Kurve liegt in Backwardation",
           "Rohstoff-Carry bzw. Curve-Prämie (Goldman Sachs, J.P. Morgan, Bloomberg Roll Yield)",
           [_t("roll_rendite", "Roll-Rendite p. a.", "min_roll_rendite", ">=", -0.10, 0.10, "p1v",
               "({f1:z2} {k1:t} ÷ {f2:z2} {k2:t} − 1) × 12 ÷ {monate:z0} Monate")],
           "Roll-Rendite {roll_rendite:p1v} p. a. ({k1:t} gegen {k2:t})"),
        _trend("min_abstand_gd200", n=-0.08, v=0.08),
        _kurz_mom("min_rendite_3m"),
        _saison("min_saison"),
        _k("Positionierung", "COT", "Positionierung", "Netto-Position der Fonds laut CFTC",
           "Die Netto-Long-Position der Fonds (Managed Money) liegt höchstens im {@max_cot_perzentil:p0}-Perzentil der letzten 3 Jahre, der Markt ist nicht überfüllt",
           "CFTC Commitments of Traders, Positionierungsanalyse der Rohstoffstrategen",
           [_t("cot_perzentil", "Perzentil der Netto-Position", "max_cot_perzentil", "<=", 0.20, -0.50, "p0",
               "Netto-Long {cot_netto:p1} des Open Interest, Rang unter {cot_wochen:z0} Wochen")],
           "Netto-Position der Fonds im {cot_perzentil:p0}-Perzentil (3 Jahre)"),
        _vol_niveau("max_vol_1j", 0.15, -0.12, "Risikobudget der Rohstoffstrategien"),
    ],
    "index": [
        _trend("min_abstand_gd200", standard=True, n=-0.08, v=0.08),
        _mom("min_momentum", standard=True, quelle="Trendfolge der Multi-Asset-Häuser"),
        _k("Pullback", "Pullback", "Momentum", "Korrektur vom 52W-Hoch",
           "Index mindestens {@min_abstand_hoch:p0} unter seinem 52-Wochen-Hoch, also in einer Korrektur",
           "Rücksetzer im Aufwärtstrend, taktisches Einstiegsmuster",
           [_t("abstand_hoch", "Drawdown", "min_abstand_hoch", ">=", fmt="p0", n_abs=0.0, v=0.15, rechnung="1 − {kurs:kurs} ÷ {hoch:kurs} (52W-Hoch)")],
           "Drawdown {abstand_hoch:p0} vom 52W-Hoch", standard=True, kursbasiert=True),
        _vol_regime("max_vol_verhaeltnis"),
        _kurz_mom("min_rendite_3m"),
        _k("VIX", "VIX", "Risiko", "Implizite Volatilität, das „Angstbarometer“",
           "Der VIX liegt höchstens bei {@max_vix:z0} Punkten, Optionen preisen ruhige Märkte ein",
           "Risikoindikatoren der Aktienstrategen (CBOE VIX)",
           [_t("vix", "VIX", "max_vix", "<=", 10, -8, "z1", "Implizite 30-Tage-Volatilität der S&P-500-Optionen")],
           "VIX {vix:z1} Punkte"),
        _k("VIX-Kurve", "VIX-Kurve", "Risiko", "VIX gegenüber dem 3-Monats-VIX",
           "VIX höchstens {@max_vix_struktur:x2} des 3-Monats-VIX, die Volatilitätskurve steigt an (Contango)",
           "Volatilitäts-Terminstruktur, Timing-Signal der Derivate-Desks",
           [_t("vix_struktur", "VIX ÷ VIX3M", "max_vix_struktur", "<=", 0.15, -0.20, "x2", "{vix:z1} ÷ {vix3m:z1}")],
           "VIX ÷ VIX3M {vix_struktur:x2}"),
        _k("Kreditrisiko", "Kredit", "Risiko", "Risikoaufschlag für Hochzinsanleihen",
           "Der Risikoaufschlag US-amerikanischer Hochzinsanleihen liegt höchstens bei {@max_hy_spread:p1}, der Kreditmarkt ist entspannt",
           "Kreditspreads als Frühindikator (ICE BofA US High Yield, FRED)",
           [_t("hy_spread", "High-Yield-Spread", "max_hy_spread", "<=", 0.02, -0.015, "p2", "Optionsbereinigter Aufschlag über Staatsanleihen, Stand {hy_datum:t}")],
           "High-Yield-Spread {hy_spread:p2}"),
        _saison("min_saison"),
        _k("Knock-out-Risiko", "KO-Risiko", "Risiko", "Wie oft ein Knock-out mit Hebel 5 gerissen wäre",
           "In höchstens {@max_ko_risiko:p0} der 10-Tage-Fenster des letzten Jahres wäre ein Long-Knock-out mit Hebel 5 ausgelöst worden",
           "Risikoprüfung für Hebelprodukte (Knock-out-Schwelle rund 20 % unter dem Kaufkurs)",
           [_t("ko_risiko", "Knock-out-Häufigkeit", "max_ko_risiko", "<=", 0.10, -0.05, "p1",
               "Anteil der 10-Tage-Fenster mit mindestens 20 % Rückgang, letzte 12 Monate")],
           "Knock-out bei Hebel 5 in {ko_risiko:p1} der Fenster"),
    ],
}
assert all(t["p"] != "{p}" for liste in KATALOG.values() for k in liste for t in k["teile"]), "Parameter fehlt"
assert all(len(liste) == 10 for liste in KATALOG.values()), "zehn Kriterien je Klasse"

STANDARDWERTE = {
    "kriterien": {"min_momentum_12_1": 0.0, "min_roe": 0.15, "max_nd_ebitda": 2.0, "min_fcf_rendite": 0.03,
                  "min_eps_revision": 0.0, "max_vol_1j": 0.35},
    "kriterien_forex": {"min_carry_risk": 0.0, "min_abstand_gd200": 0.0, "min_rendite_3m": 0.0, "min_zins_trend": 0.0,
                        "min_realzins_diff": 0.0, "max_vol_1j": 0.10},
    "kriterien_rohstoff": {"min_roll_rendite": 0.0, "min_abstand_gd200": 0.0, "min_rendite_3m": 0.0, "min_saison": 0.0,
                           "max_cot_perzentil": 0.80, "max_vol_1j": 0.30},
    "kriterien_index": {"min_rendite_3m": 0.0, "max_vix": 20, "max_vix_struktur": 1.0, "max_hy_spread": 0.045,
                        "min_saison": 0.0, "max_ko_risiko": 0.05},
}
ABSCHNITT = {"aktie": "kriterien", "forex": "kriterien_forex", "rohstoff": "kriterien_rohstoff", "index": "kriterien_index"}

# Regler je Parameter: Bereich und Schrittweite (Format kommt aus dem Teil, der den Parameter nutzt)
REGLER = {
    "min_boersenwert_mrd_eur": {"stufen": [1, 2, 5, 10, 20, 30, 50, 75, 100, 150, 200, 300, 500], "fmt": "zmrd"},
    "min_umsatzwachstum": {"min": -0.1, "max": 0.3, "step": 0.01}, "min_gewinnwachstum": {"min": -0.2, "max": 0.4, "step": 0.01},
    "min_abstand_hoch": {"min": 0, "max": 0.5, "step": 0.01}, "max_position_spanne": {"min": 0.05, "max": 1, "step": 0.05},
    "max_kgv_vs_median": {"min": 0.5, "max": 1.2, "step": 0.05}, "min_kursziel_abstand": {"min": 0, "max": 0.5, "step": 0.01},
    "min_momentum_12_1": {"min": -0.2, "max": 0.4, "step": 0.01}, "min_momentum": {"min": -0.1, "max": 0.2, "step": 0.01},
    "min_roe": {"min": 0, "max": 0.4, "step": 0.01}, "max_nd_ebitda": {"min": 0, "max": 5, "step": 0.1},
    "min_fcf_rendite": {"min": 0, "max": 0.1, "step": 0.005}, "min_eps_revision": {"min": -0.1, "max": 0.1, "step": 0.005},
    "min_zinsdifferenz": {"min": -0.03, "max": 0.05, "step": 0.0025}, "min_abweichung_mittel": {"min": 0, "max": 0.2, "step": 0.01},
    "max_vol_verhaeltnis": {"min": 0.5, "max": 2, "step": 0.05}, "min_carry_risk": {"min": -0.5, "max": 1, "step": 0.05},
    "min_abstand_gd200": {"min": -0.1, "max": 0.1, "step": 0.005}, "min_rendite_3m": {"min": -0.1, "max": 0.15, "step": 0.005},
    "min_zins_trend": {"min": -0.01, "max": 0.01, "step": 0.0025}, "min_realzins_diff": {"min": -0.04, "max": 0.04, "step": 0.0025},
    "max_abweichung_mittel": {"min": -0.2, "max": 0.3, "step": 0.01}, "min_roll_rendite": {"min": -0.15, "max": 0.15, "step": 0.01},
    "min_saison": {"min": -0.03, "max": 0.03, "step": 0.0025}, "max_cot_perzentil": {"min": 0.3, "max": 1, "step": 0.05},
    "max_vix": {"min": 12, "max": 35, "step": 1}, "max_vix_struktur": {"min": 0.8, "max": 1.2, "step": 0.01},
    "max_hy_spread": {"min": 0.025, "max": 0.08, "step": 0.0025}, "max_ko_risiko": {"min": 0, "max": 0.2, "step": 0.01},
}
REGLER_VOL = {"aktie": {"min": 0.15, "max": 0.7, "step": 0.01}, "forex": {"min": 0.04, "max": 0.2, "step": 0.005},
              "rohstoff": {"min": 0.1, "max": 0.6, "step": 0.01}}


def mit_standard(cfg: dict) -> dict:
    """Fehlende Schwellen und die Auswahl je Klasse ergänzen (ältere config.yaml bleiben gültig)."""
    from . import klassen
    cfg = klassen.mit_standard(cfg)
    for abschnitt, werte in STANDARDWERTE.items():
        cfg[abschnitt] = werte | (cfg.get(abschnitt) or {})
    auswahl = dict(cfg.get("auswahl") or {})
    for typ, liste in KATALOG.items():
        namen = [k["name"] for k in liste]
        a = dict(auswahl.get(typ) or {})
        zaehlt = [n for n in a.get("zaehlt", [k["name"] for k in liste if k["standard"]]) if n in namen]
        pflicht = [n for n in a.get("pflicht", []) if n in namen and n not in zaehlt]
        n = len(zaehlt) + len(pflicht)
        auswahl[typ] = {"zaehlt": zaehlt, "pflicht": pflicht,
                        "treffer_ab": max(1, min(n, int(a.get("treffer_ab") or math.ceil(n * 0.75) or 1)))}
    cfg["auswahl"] = auswahl
    return cfg


# ---------------------------------------------------------------- Auswertung

def teil(t: dict, kz: dict, params: dict) -> dict:
    """Ein Teil: Wert, Schwelle, erfüllt und Stärke."""
    x = kz.get(t["k"])
    g_roh = params[t["p"]] * t.get("skal", 1) * t.get("vz", 1)
    if t.get("log"):
        xs = math.log10(max(x, 1)) if x is not None else None
        g = math.log10(g_roh)
        nul, voll = g - 1, g + math.log10(20)
    else:
        xs, g = x, g_roh
        nul = t["n_abs"] if "n_abs" in t else g + t["n"]
        voll = t["v_abs"] if "v_abs" in t else g + t["v"]
    ok = None if x is None else (xs >= g if t["r"] == ">=" else xs <= g)
    return {"wert": x, "grenze": g_roh, "ok": ok, "staerke": skala(xs, nul, g, voll)}


def pruefe(k: dict, kz: dict, params: dict) -> dict:
    """Ein Kriterium auswerten: erfüllt (True/False/None), Stärke 0–100, Begründung."""
    teile = [teil(t, kz, params) for t in k["teile"]]
    bekannt = [t for t in teile if t["ok"] is not None]
    if not bekannt:
        e, s = None, None
    elif k["verkn"] == "oder":
        e, s = any(t["ok"] for t in bekannt), _oder(*[t["staerke"] for t in teile])
    elif k["verkn"] == "und":
        e, s = all(t["ok"] is True for t in teile), _und(*[t["staerke"] for t in teile])
    else:
        e, s = teile[0]["ok"], teile[0]["staerke"]
    return {"erfuellt": e, "staerke": s, "begruendung": text(k["text"], kz, params) or "Daten fehlen",
            "kurz": k["kurz"], "erklaerung": k["erklaerung"], "familie": k["familie"]}


def katalog_pruefen(typ: str, kz: dict, cfg: dict) -> dict:
    params = cfg[ABSCHNITT[typ]]
    return {k["name"]: pruefe(k, kz, params) for k in KATALOG[typ]}


def bewertung(typ: str, katalog: dict, cfg: dict) -> dict:
    """Auswahl anwenden: zählende und Pflicht-Kriterien, Punkte und Treffer."""
    a = cfg["auswahl"][typ]
    aktiv = [n for n in katalog if n in a["zaehlt"] or n in a["pflicht"]]
    pr = {n: katalog[n] for n in aktiv}
    punkte = sum(1 for p in pr.values() if p["erfuellt"])
    pflicht_ok = all(katalog[n]["erfuellt"] for n in a["pflicht"])
    return {"pruefungen": pr, "punkte": punkte, "max_punkte": len(pr), "pflicht_ok": pflicht_ok,
            "treffer_ab": a["treffer_ab"], "treffer": pflicht_ok and punkte >= a["treffer_ab"],
            "knapp": pflicht_ok and punkte == a["treffer_ab"] - 1}


def definitionen(cfg: dict) -> dict:
    """Halbsatz-Definition je Kriterium mit den aktuellen Schwellen."""
    return {typ: {k["name"]: text(k["definition"], {}, cfg[ABSCHNITT[typ]]) or k["definition"] for k in liste}
            for typ, liste in KATALOG.items()}


def spezifikation(cfg: dict) -> dict:
    """Katalog, Schwellen, Regler und Auswahl für den Browser."""
    regler = {}
    for typ, liste in KATALOG.items():
        for k in liste:
            for t in k["teile"]:
                r = dict(REGLER.get(t["p"]) or {})
                if t["p"] == "max_vol_1j":
                    r = dict(REGLER_VOL.get(typ, {}))
                r.setdefault("fmt", t["fmt"])
                regler.setdefault(typ, {})[t["p"]] = r
    return {"katalog": KATALOG, "params": {typ: cfg[ABSCHNITT[typ]] for typ in KATALOG}, "regler": regler,
            "auswahl": cfg["auswahl"], "abschnitt": ABSCHNITT}


# ---------------------------------------------------------------- Kennzahlen je Wert

def _zahl(x):
    return None if x is None or (isinstance(x, float) and math.isnan(x)) else float(x)


def kennzahlen(z: dict, markt: dict | None = None, fx: dict | None = None) -> dict:
    """Alle Kennzahlen, die der Katalog braucht, aus einer fertigen Zeile (Wochenstand)."""
    markt, fx = markt or {}, fx or {}
    kz = {k: _zahl(z.get(k)) for k in (
        "kurs", "abstand_hoch", "position_spanne", "momentum_12_1", "abweichung_mittel_5j", "mittel_5j", "vol_1m",
        "vol_median_1j", "vol_verhaeltnis", "gd200", "abstand_gd200", "rendite_3m", "kurs_3m", "saison", "saison_quote",
        "boersenwert_eur", "umsatzwachstum", "gewinnwachstum", "kursziel_abstand")}
    kz.update({"hoch": _zahl(z.get("hoch_52w")), "tief": _zahl(z.get("tief_52w")), "vol_1j": _zahl(z.get("volatilitaet")),
               "ziel": _zahl(z.get("kursziel_mittel")), "fwd_kgv": _zahl(z.get("forward_kgv")),
               "kgv_median": _zahl(z.get("forward_kgv_median_5j")), "monat": z.get("saison_monat"),
               "jahre": z.get("saison_jahre"), "ko_risiko": _zahl((z.get("knockout") or {}).get(5))})
    kz["kgv_rel"] = kz["fwd_kgv"] / kz["kgv_median"] if kz["fwd_kgv"] and kz["kgv_median"] else None
    typ = z.get("typ")
    if typ == "aktie":
        bil = z.get("bilanz") or {}
        kz["roe"] = _zahl(bil.get("eigenkapitalrendite"))
        jahr = next((j for j in reversed(z.get("jahreszahlen") or []) if j.get("ebitda")), {})
        schulden = _zahl(jahr.get("schulden") if jahr.get("schulden") is not None else bil.get("schulden"))
        cash = _zahl(jahr.get("cash") if jahr.get("cash") is not None else bil.get("liquide_mittel"))
        ebitda = _zahl(jahr.get("ebitda"))
        kz.update({"schulden": schulden, "cash": cash, "ebitda": ebitda})
        kz["nd_ebitda"] = (schulden - (cash or 0)) / ebitda if schulden is not None and ebitda and ebitda > 0 else None
        fcf, rate = _zahl(bil.get("freier_cashflow")), fx.get(z.get("finanzwaehrung") or z.get("waehrung"))
        kz["fcf_rendite"] = fcf * rate / kz["boersenwert_eur"] if fcf is not None and rate and kz["boersenwert_eur"] else None
        s = next((s for s in z.get("schaetzungen") or [] if s.get("periode") == "Nächstes Geschäftsjahr"), {})
        kz["eps_neu"], kz["eps_alt"] = _zahl(s.get("eps_mittel")), _zahl(s.get("eps_vor_90_tagen"))
        kz["eps_revision"] = kz["eps_neu"] / kz["eps_alt"] - 1 if kz["eps_neu"] and kz["eps_alt"] and kz["eps_alt"] > 0 else None
    elif typ == "forex":
        from .klassen import paar
        p = paar(z["symbol"]) or (None, None)
        zinsen = z.get("leitzinsen") or {}
        zb, zg = zinsen.get(p[0]), zinsen.get(p[1])
        kz.update({"basis": p[0], "gegen": p[1], "zins_basis": zb, "zins_gegen": zg,
                   "zinsdifferenz": zb - zg if zb is not None and zg is not None else None})
        kz["carry_risk"] = kz["zinsdifferenz"] / kz["vol_1j"] if kz["zinsdifferenz"] is not None and kz["vol_1j"] else None
        alt = markt.get("zinsen_3m") or {}
        if p[0] in alt and p[1] in alt and kz["zinsdifferenz"] is not None:
            kz["zinsdifferenz_3m"] = alt[p[0]] - alt[p[1]]
            kz["zins_trend"] = kz["zinsdifferenz"] - kz["zinsdifferenz_3m"]
        inf = markt.get("inflation") or {}
        ib, ig = inf.get(p[0]), inf.get(p[1])
        kz.update({"inflation_basis": ib, "inflation_gegen": ig})
        if None not in (zb, zg, ib, ig):
            kz.update({"real_basis": zb - ib, "real_gegen": zg - ig, "realzins_diff": (zb - ib) - (zg - ig)})
    elif typ == "rohstoff":
        kurve = (markt.get("kurven") or {}).get(z["symbol"]) or {}
        kz.update({k: kurve.get(k) for k in ("f1", "f2", "k1", "k2", "monate")})
        kz["roll_rendite"] = _zahl(kurve.get("roll"))
        cot = (markt.get("cot") or {}).get(z["symbol"]) or {}
        kz.update({"cot_perzentil": _zahl(cot.get("perzentil")), "cot_netto": _zahl(cot.get("netto")), "cot_wochen": cot.get("wochen")})
    elif typ == "index":
        vix, vix3m = _zahl(markt.get("vix")), _zahl(markt.get("vix3m"))
        kz.update({"vix": vix, "vix3m": vix3m, "vix_struktur": vix / vix3m if vix and vix3m else None,
                   "hy_spread": _zahl(markt.get("hy_spread")), "hy_datum": markt.get("hy_datum")})
    return kz
