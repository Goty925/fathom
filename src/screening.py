"""Deine Kriterien als nachvollziehbare Ja/Nein-Prüfungen.

Jedes Kriterium liefert:
  - erfuellt: True / False / None (None = Daten fehlen)
  - staerke: 0–100 für den Balken (ab 50 ist das Kriterium erfüllt), None = Daten fehlen
  - begruendung: kurzer Text mit den Zahlen, damit du siehst WARUM

Das Ergebnis ist ein Screening-Treffer, keine Kaufempfehlung.
"""
from __future__ import annotations

import datetime as dt


def _pct(x: float | None) -> str:
    return "–" if x is None else f"{x * 100:+.0f} %".replace("-", "−")


def _de(x: float, nk: int = 1) -> str:
    return f"{x:,.{nk}f}".replace(",", "X").replace(".", ",").replace("X", ".")


# Die vier Kriterien mit Fachbegriff, Kurzname für die Tabelle und Erklärung.
KRITERIEN = {
    "Large Cap": {"kurz": "Large Cap", "erklaerung": "Marktkapitalisierung"},
    "Earnings Momentum": {"kurz": "Momentum", "erklaerung": "Umsatz- und Gewinnwachstum YoY"},
    "Pullback": {"kurz": "Pullback", "erklaerung": "Drawdown vom 52W-Hoch und Lage in der Range"},
    "Valuation Gap": {"kurz": "Valuation", "erklaerung": "Forward-KGV gegenüber 5J-Median, Upside zum Kursziel"},
}


def definitionen(k: dict) -> dict:
    """Kurze Definition je Signal als Halbsatz, mit den aktuellen Grenzwerten."""
    p = lambda x: f"{x * 100:.0f}\u00a0%"  # noqa: E731  (geschütztes Leerzeichen: Zahl und % bleiben zusammen)
    gewinn = "der Gewinn nicht sinkt" if k["min_gewinnwachstum"] == 0 else f"der Gewinn mindestens {p(k['min_gewinnwachstum'])} zulegt"
    return {
        "Large Cap": f"Börsenwert von mindestens {k['min_boersenwert_mrd_eur']}\u00a0Mrd.\u00a0€, also ein etablierter Großkonzern",
        "Earnings Momentum": f"Umsatz wächst um mindestens {p(k['min_umsatzwachstum'])} und {gewinn}, jeweils gegenüber dem Vorjahresquartal",
        "Pullback": f"Kurs mindestens {p(k['min_abstand_hoch'])} unter dem 52-Wochen-Hoch und im unteren {p(k['max_position_spanne'])} der Jahresspanne",
        "Valuation Gap": f"Forward-KGV höchstens {p(k['max_kgv_vs_median'])} des eigenen 5-Jahres-Medians oder mindestens {p(k['min_kursziel_abstand'])} Upside zum Kursziel",
    }


def skala(x: float | None, null: float, grenze: float, voll: float) -> float | None:
    """Stärke 0–100: 0 bei `null`, genau 50 an der Grenze, 100 bei `voll`, linear dazwischen.

    Funktioniert auch für Kennzahlen, bei denen weniger besser ist (dann ist voll < grenze < null).
    Dadurch gilt immer: Stärke ≥ 50 genau dann, wenn die Grenze erreicht ist.
    """
    if x is None:
        return None
    if (x - grenze) * (voll - grenze) >= 0:
        s = 50 + 50 * (x - grenze) / (voll - grenze)
    elif grenze == null:
        s = 0.0
    else:
        s = 50 * (x - null) / (grenze - null)
    return max(0.0, min(100.0, s))


def _und(*werte: float | None) -> float | None:
    """Alle Teilbedingungen nötig: die schwächste zählt. Fehlt eine, bleibt der Balken unter der Hälfte."""
    da = [w for w in werte if w is not None]
    if not da:
        return None
    s = min(da)
    return min(s, 45.0) if len(da) < len(werte) else s


def _oder(*werte: float | None) -> float | None:
    """Eine Teilbedingung reicht: die stärkste zählt."""
    da = [w for w in werte if w is not None]
    return max(da) if da else None


def pruefe_groesse(boersenwert_eur: float | None, k: dict) -> dict:
    grenze = k["min_boersenwert_mrd_eur"] * 1e9
    if boersenwert_eur is None:
        return {"erfuellt": None, "staerke": None, "begruendung": "Marktkapitalisierung unbekannt"}
    import math
    s = skala(math.log10(max(boersenwert_eur, 1)), math.log10(grenze / 10), math.log10(grenze), math.log10(grenze * 20))
    return {
        "erfuellt": boersenwert_eur >= grenze,
        "staerke": s,
        "begruendung": f"Market Cap {_de(boersenwert_eur / 1e9, 0)} Mrd. € (Schwelle {k['min_boersenwert_mrd_eur']} Mrd. €)",
    }


def pruefe_zahlen(umsatz: float | None, gewinn: float | None, k: dict) -> dict:
    if umsatz is None and gewinn is None:
        return {"erfuellt": None, "staerke": None, "begruendung": "Quartalsdaten fehlen"}
    gu, gg = k["min_umsatzwachstum"], k["min_gewinnwachstum"]
    ok_u = umsatz is not None and umsatz >= gu
    ok_g = gewinn is not None and gewinn >= gg
    return {
        "erfuellt": ok_u and ok_g,
        "staerke": _und(skala(umsatz, gu - 0.15, gu, gu + 0.25), skala(gewinn, gg - 0.30, gg, gg + 0.40)),
        "begruendung": f"Umsatz {_pct(umsatz)} YoY, Gewinn {_pct(gewinn)} YoY (Vorjahresquartal)",
    }


def pruefe_tief(abstand_hoch: float | None, position: float | None, k: dict) -> dict:
    if abstand_hoch is None or position is None:
        return {"erfuellt": None, "staerke": None, "begruendung": "Kursdaten fehlen"}
    ga, gp = k["min_abstand_hoch"], k["max_position_spanne"]
    ok = abstand_hoch >= ga and position <= gp
    return {
        "erfuellt": ok,
        "staerke": _und(skala(abstand_hoch, ga - 0.20, ga, ga + 0.30), skala(position, 1.0, gp, 0.0)),
        "begruendung": f"Drawdown {abstand_hoch * 100:.0f} % vom 52W-Hoch, Range-Position {position * 100:.0f} %",
    }


def pruefe_bewertung(fwd_kgv, median_kgv, kursziel_abstand, k: dict) -> dict:
    teile, treffer, bekannt = [], False, False
    gk, gz = k["max_kgv_vs_median"], k["min_kursziel_abstand"]
    s_kgv = s_ziel = None
    if fwd_kgv and median_kgv:
        bekannt = True
        verhaeltnis = fwd_kgv / median_kgv
        teile.append(f"Fwd-KGV {_de(fwd_kgv)} gegenüber Ø 5J {_de(median_kgv)}")
        treffer |= verhaeltnis <= gk
        s_kgv = skala(verhaeltnis, gk + 0.40, gk, gk - 0.30)
    if kursziel_abstand is not None:
        bekannt = True
        teile.append(f"Upside {_pct(kursziel_abstand)} zum Konsens-Kursziel")
        treffer |= kursziel_abstand >= gz
        s_ziel = skala(kursziel_abstand, gz - 0.30, gz, gz + 0.30)
    if not bekannt:
        return {"erfuellt": None, "staerke": None, "begruendung": "Bewertungsdaten fehlen"}
    return {"erfuellt": treffer, "staerke": _oder(s_kgv, s_ziel), "begruendung": ", ".join(teile)}


def zahlen_bald(termin: dt.date | None, heute: dt.date, tage: int) -> bool:
    return termin is not None and 0 <= (termin - heute).days <= tage


def bewerte(zeile: dict, k: dict) -> dict:
    """Wendet alle Kriterien auf eine Zeile an und zählt die Treffer."""
    pruefungen = {
        "Large Cap": pruefe_groesse(zeile.get("boersenwert_eur"), k),
        "Earnings Momentum": pruefe_zahlen(zeile.get("umsatzwachstum"), zeile.get("gewinnwachstum"), k),
        "Pullback": pruefe_tief(zeile.get("abstand_hoch"), zeile.get("position_spanne"), k),
        "Valuation Gap": pruefe_bewertung(
            zeile.get("forward_kgv"), zeile.get("forward_kgv_median_5j"), zeile.get("kursziel_abstand"), k
        ),
    }
    for name, p in pruefungen.items():
        p.update(KRITERIEN[name])
    return {
        "pruefungen": pruefungen,
        "punkte": sum(1 for p in pruefungen.values() if p["erfuellt"]),
        "max_punkte": len(pruefungen),
    }
