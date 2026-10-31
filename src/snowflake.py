"""Snowflake nach dem Vorbild von Simply Wall St: fünf Achsen von 0 bis 100.

  Bewertung      Forward-KGV gegenüber eigenem Median, Upside zum Kursziel, PEG-Ratio
  Zukunft        erwartetes Gewinn- und Umsatzwachstum im nächsten Geschäftsjahr
  Vergangenheit  Umsatz- und Gewinnwachstum zuletzt, Umsatzwachstum über mehrere Jahre, Nettomarge
  Gesundheit     Verschuldungsgrad, Cash im Verhältnis zu Schulden, positiver freier Cashflow
  Dividende      Dividendenrendite

Jede Teilgröße wird linear zwischen einem schwachen und einem starken Wert auf 0–100 abgebildet,
die Achse ist der Mittelwert der vorhandenen Teilgrößen. Fehlt alles, bleibt die Achse leer.
"""
from __future__ import annotations


def lin(x, schwach, stark):
    if x is None:
        return None
    s = (x - schwach) / (stark - schwach) * 100
    return max(0.0, min(100.0, s))


def _mittel(*werte):
    da = [w for w in werte if w is not None]
    return sum(da) / len(da) if da else None


ACHSEN = ("Bewertung", "Zukunft", "Vergangenheit", "Gesundheit", "Dividende")


def berechne(z: dict) -> dict:
    b, m = z.get("bilanz") or {}, z.get("multiples") or {}
    naechstes = next((s for s in z.get("schaetzungen") or [] if s.get("periode") == "Nächstes Geschäftsjahr"), {})
    jw = [j for j in z.get("jahreswerte") or [] if j.get("umsatz")]
    cagr = None
    if len(jw) >= 3 and jw[0]["umsatz"] > 0 and jw[-1]["umsatz"] > 0:
        cagr = (jw[-1]["umsatz"] / jw[0]["umsatz"]) ** (1 / (len(jw) - 1)) - 1
    kgv_rel = z["forward_kgv"] / z["forward_kgv_median_5j"] if z.get("forward_kgv") and z.get("forward_kgv_median_5j") else None
    schulden, cash = b.get("schulden"), b.get("liquide_mittel")
    achsen = {
        "Bewertung": _mittel(lin(kgv_rel, 1.3, 0.7), lin(z.get("kursziel_abstand"), -0.10, 0.40), lin(m.get("peg"), 3.0, 0.8)),
        "Zukunft": _mittel(lin(z.get("eps_wachstum_naechstes_jahr"), -0.05, 0.25), lin(naechstes.get("umsatz_wachstum"), -0.02, 0.20)),
        "Vergangenheit": _mittel(lin(z.get("umsatzwachstum"), -0.05, 0.25), lin(z.get("gewinnwachstum"), -0.10, 0.30),
                                 lin(cagr, -0.02, 0.20), lin(b.get("nettomarge"), 0.0, 0.30)),
        "Gesundheit": _mittel(lin(b.get("verschuldungsgrad"), 2.0, 0.0),
                              lin(cash / schulden if cash is not None and schulden else (1.5 if cash and not schulden else None), 0.0, 1.5),
                              (100.0 if b["freier_cashflow"] > 0 else 0.0) if b.get("freier_cashflow") is not None else None),
        "Dividende": lin(m.get("dividendenrendite") or 0.0, 0.0, 0.04) if m else None,
    }
    gesamt = _mittel(*achsen.values())
    return {"achsen": achsen, "gesamt": gesamt, "umsatz_cagr": cagr}
