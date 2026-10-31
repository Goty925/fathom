"""Kennzahlen aus der Kurshistorie berechnen.

Alles hier ist reine Statistik auf einer Zeitreihe von Schlusskursen.
Damit ist das Modul unabhängig von Yahoo und leicht zu testen.
"""
from __future__ import annotations

import math

import numpy as np
import pandas as pd

HANDELSTAGE_JAHR = 252


def rendite(kurse: pd.Series, tage: int) -> float | None:
    """Kursänderung über die letzten `tage` Handelstage (0.05 = +5 %)."""
    if len(kurse) <= tage:
        return None
    return float(kurse.iloc[-1] / kurse.iloc[-1 - tage] - 1)


def rendite_seit_jahresbeginn(kurse: pd.Series) -> float | None:
    if kurse.empty:
        return None
    letzter = kurse.index[-1]
    vorjahr = kurse[kurse.index.year < letzter.year]
    if vorjahr.empty:
        return None
    return float(kurse.iloc[-1] / vorjahr.iloc[-1] - 1)


def rsi(kurse: pd.Series, perioden: int = 14) -> float | None:
    """Relative-Stärke-Index nach Wilder (0–100; unter 30 gilt als 'überverkauft')."""
    if len(kurse) <= perioden:
        return None
    diff = kurse.diff().dropna()
    gewinne = diff.clip(lower=0)
    verluste = -diff.clip(upper=0)
    alpha = 1 / perioden
    avg_g = gewinne.ewm(alpha=alpha, adjust=False, min_periods=perioden).mean().iloc[-1]
    avg_v = verluste.ewm(alpha=alpha, adjust=False, min_periods=perioden).mean().iloc[-1]
    if avg_v == 0:
        return 100.0
    return float(100 - 100 / (1 + avg_g / avg_v))


def max_rueckgang(kurse: pd.Series) -> float | None:
    """Größter Verlust vom Hoch zum folgenden Tief (0.3 = −30 %)."""
    if len(kurse) < 2:
        return None
    return float(1 - (kurse / kurse.cummax()).min())


def knockout_haeufigkeit(kurse: pd.Series, hebel: float, fenster: int = 10) -> float | None:
    """Anteil aller `fenster`-Tage-Zeiträume, in denen ein Long-Knock-out mit diesem
    Hebel ausgelöst worden wäre.

    Faustregel: Bei Hebel h liegt die Knock-out-Schwelle etwa 1/h unter dem Kaufkurs
    (Hebel 5 → ca. 20 % Abstand). Wir prüfen für jeden Kauftag, ob der Kurs in den
    folgenden `fenster` Handelstagen mindestens so weit gefallen ist.
    """
    werte = kurse.to_numpy(dtype=float)
    n = len(werte) - fenster
    if n < 20:
        return None
    schwelle = 1 - 1 / hebel
    treffer = sum(werte[i + 1:i + 1 + fenster].min() <= werte[i] * schwelle for i in range(n))
    return treffer / n


def faktoren(kurse: pd.Series) -> dict:
    """Faktoren, wie sie Häuser wie J.P. Morgan oder AQR für Währungen, Rohstoffe und Indizes nutzen.

    - Momentum 12-1: Rendite der letzten 12 Monate ohne den jüngsten Monat (der kurzfristig oft umkehrt)
    - Abweichung vom 5-Jahres-Mittel: einfacher Value- bzw. Mean-Reversion-Maßstab
    - Vol-Regime: Schwankung des letzten Monats im Verhältnis zum Median des Jahres (unter 1 = ruhiger als üblich)
    """
    k = kurse.dropna()
    aus = {"momentum_12_1": None, "mittel_5j": None, "abweichung_mittel_5j": None,
           "vol_1m": None, "vol_median_1j": None, "vol_verhaeltnis": None, "abstand_gd200": None}
    if len(k) > HANDELSTAGE_JAHR:
        aus["momentum_12_1"] = float(k.iloc[-22] / k.iloc[-1 - HANDELSTAGE_JAHR] - 1)
    if len(k) >= HANDELSTAGE_JAHR:
        fenster = k.iloc[-5 * HANDELSTAGE_JAHR:]
        aus["mittel_5j"] = float(fenster.mean())
        aus["abweichung_mittel_5j"] = float(k.iloc[-1] / aus["mittel_5j"] - 1)
    r = k.pct_change().dropna()
    if len(r) > HANDELSTAGE_JAHR:
        roll = r.rolling(21).std().dropna() * math.sqrt(HANDELSTAGE_JAHR)
        aus["vol_1m"] = float(roll.iloc[-1])
        aus["vol_median_1j"] = float(roll.iloc[-HANDELSTAGE_JAHR:].median())
        if aus["vol_median_1j"]:
            aus["vol_verhaeltnis"] = aus["vol_1m"] / aus["vol_median_1j"]
    if len(k) >= 200:
        aus["abstand_gd200"] = float(k.iloc[-1] / k.iloc[-200:].mean() - 1)
    return aus


def technik(kurse: pd.Series) -> dict | None:
    """Technische Zusammenfassung nach dem Muster von Investing.com: 12 gleitende Durchschnitte und
    7 Oszillatoren stimmen je mit Kaufen, Verkaufen oder Neutral ab.

    Grundlage sind Tagesschlusskurse; Hoch und Tief eines Tages fehlen, deshalb rechnen Stochastik,
    Williams %R und CCI mit der Spanne der Schlusskurse.
    """
    k = kurse.dropna()
    if len(k) < 210:
        return None
    p = float(k.iloc[-1])
    ma = []
    for n in (5, 10, 20, 50, 100, 200):
        for art, reihe in (("SMA", k.rolling(n).mean()), ("EMA", k.ewm(span=n, adjust=False).mean())):
            w = float(reihe.iloc[-1])
            ma.append({"name": f"{art} {n}", "wert": w, "signal": "kaufen" if p > w * 1.001 else "verkaufen" if p < w * 0.999 else "neutral"})

    def stimme(wert, kauf, verkauf, umgekehrt=False):
        if wert is None or (isinstance(wert, float) and math.isnan(wert)):
            return "neutral"
        if not umgekehrt:
            return "kaufen" if wert > kauf else "verkaufen" if wert < verkauf else "neutral"
        return "kaufen" if wert < kauf else "verkaufen" if wert > verkauf else "neutral"

    hoch14, tief14 = float(k.iloc[-14:].max()), float(k.iloc[-14:].min())
    stoch = (p - tief14) / (hoch14 - tief14) * 100 if hoch14 > tief14 else 50.0
    willr = (hoch14 - p) / (hoch14 - tief14) * -100 if hoch14 > tief14 else -50.0
    macd_linie = k.ewm(span=12, adjust=False).mean() - k.ewm(span=26, adjust=False).mean()
    macd, signal = float(macd_linie.iloc[-1]), float(macd_linie.ewm(span=9, adjust=False).mean().iloc[-1])
    tp = k.iloc[-20:]
    md = float((tp - tp.mean()).abs().mean())
    cci = (p - float(tp.mean())) / (0.015 * md) if md else 0.0
    roc = (p / float(k.iloc[-13]) - 1) * 100
    r = rsi(k)
    osz = [
        {"name": "RSI (14)", "wert": r, "signal": stimme(r, 30, 70, umgekehrt=True)},
        {"name": "Stochastik (14)", "wert": stoch, "signal": stimme(stoch, 20, 80, umgekehrt=True)},
        {"name": "MACD (12, 26)", "wert": macd, "signal": "kaufen" if macd > signal else "verkaufen"},
        {"name": "Williams %R (14)", "wert": willr, "signal": stimme(willr, -80, -20, umgekehrt=True)},
        {"name": "CCI (20)", "wert": cci, "signal": stimme(cci, -100, 100, umgekehrt=True)},
        {"name": "ROC (12)", "wert": roc, "signal": "kaufen" if roc > 0 else "verkaufen" if roc < 0 else "neutral"},
        {"name": "Momentum (10)", "wert": p - float(k.iloc[-11]), "signal": "kaufen" if p > float(k.iloc[-11]) else "verkaufen"},
    ]

    def fazit(liste):
        kauf = sum(x["signal"] == "kaufen" for x in liste)
        verk = sum(x["signal"] == "verkaufen" for x in liste)
        s = (kauf - verk) / len(liste)
        wort = ("Starker Kauf" if s >= 0.5 else "Kaufen" if s >= 0.1 else "Starker Verkauf" if s <= -0.5
                else "Verkaufen" if s <= -0.1 else "Neutral")
        return {"kaufen": kauf, "verkaufen": verk, "neutral": len(liste) - kauf - verk, "score": s, "fazit": wort}

    gesamt = fazit(ma + osz)
    return {"ma": ma, "oszillatoren": osz, "ma_fazit": fazit(ma), "osz_fazit": fazit(osz), **gesamt}


MONATE = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"]


def saisonalitaet(kurse: pd.Series) -> dict:
    """Durchschnittliche Rendite des kommenden Kalendermonats in den Vorjahren (mindestens 4 Jahre)."""
    k = kurse.dropna()
    if k.empty:
        return {"saison": None, "saison_quote": None, "saison_jahre": 0, "saison_monat": None}
    monat = k.index[-1].month % 12 + 1
    m = k.groupby(k.index.to_period("M")).last().pct_change().dropna()
    m = m[[p.month == monat for p in m.index]]
    aus = {"saison_monat": MONATE[monat - 1], "saison_jahre": int(len(m))}
    if len(m) < 4:
        return aus | {"saison": None, "saison_quote": None}
    return aus | {"saison": float(m.mean()), "saison_quote": float((m > 0).mean())}


def berechne(kurse: pd.Series) -> dict:
    """Alle Kurs-Kennzahlen für den Bericht."""
    kurse = kurse.dropna()
    if kurse.empty:
        return {"kurs": None}

    jahr = kurse.iloc[-HANDELSTAGE_JAHR:]
    hoch, tief = float(jahr.max()), float(jahr.min())
    kurs = float(kurse.iloc[-1])
    spanne = hoch - tief
    tagesrenditen = jahr.pct_change().dropna()
    gd200_reihe = kurse.rolling(200).mean().iloc[-HANDELSTAGE_JAHR:]

    return {
        "kurs": kurs,
        "kurs_datum": kurse.index[-1].date(),
        "rendite_1w": rendite(kurse, 5),
        "rendite_1m": rendite(kurse, 21),
        "rendite_3m": rendite(kurse, 63),
        "kurs_3m": float(kurse.iloc[-64]) if len(kurse) > 63 else None,
        "rendite_ytd": rendite_seit_jahresbeginn(kurse),
        "rendite_1j": rendite(kurse, HANDELSTAGE_JAHR),
        "hoch_52w": hoch,
        "tief_52w": tief,
        "abstand_hoch": 1 - kurs / hoch if hoch else None,          # 0.25 = 25 % unter dem Hoch
        "position_spanne": (kurs - tief) / spanne if spanne > 0 else None,  # 0 = am Tief, 1 = am Hoch
        "gd200": float(kurse.iloc[-200:].mean()) if len(kurse) >= 200 else None,
        "rsi14": rsi(kurse),
        "volatilitaet": float(tagesrenditen.std() * math.sqrt(HANDELSTAGE_JAHR)) if len(tagesrenditen) > 20 else None,
        "typische_tagesbewegung": float(tagesrenditen.abs().median()) if len(tagesrenditen) > 20 else None,
        "max_rueckgang_1j": max_rueckgang(jahr),
        **faktoren(kurse),
        **saisonalitaet(kurse),
        "technik": technik(kurse),
        "knockout": {h: knockout_haeufigkeit(jahr, h) for h in (2, 5, 10)},
        "verlauf_6m": [float(x) for x in kurse.iloc[-126:]],
        # Für das große Kursdiagramm: 12 Monate Kurs + 200-Tage-Linie
        "chart_1j": {
            "daten": [d.date().isoformat() for d in jahr.index],
            "kurs": [round(float(x), 4) for x in jahr],
            "gd200": [None if np.isnan(x) else round(float(x), 4) for x in gd200_reihe],
        },
    }
