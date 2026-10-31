"""Regel-Prüfstand: Wie haben sich Werte entwickelt, nachdem ein Signal erfüllt war?

Für jedes Monatsende der letzten zehn Jahre werden die Signale mit den damaligen Kursen geprüft und mit der
Kursentwicklung der folgenden drei, sechs und zwölf Monate verglichen. Getestet wird nur, was sich ohne Blick in
die Zukunft rekonstruieren lässt, also die kursbasierten Signale. Quartalszahlen, Analystenschätzungen, Kursziele
und historische Leitzinsen von damals liegen nicht vor; wer sie mit heutigen Werten zurückrechnet, schummelt.

Grenzen, die auch auf der Website stehen:
  - Nur die Werte, die heute auf der Watchlist stehen (Survivorship Bias: gescheiterte Werte fehlen).
  - Monatliche Stichproben mit 6- und 12-Monats-Fenstern überlappen sich, die Fälle sind nicht unabhängig.
  - Ohne Kosten, Steuern, Dividenden und Rollkosten bei Futures.
"""
from __future__ import annotations

import math

import pandas as pd

from . import kriterien

J = 252
HORIZONTE = {"3M": 63, "6M": 126, "12M": 252}
# Kursbasierte Kriterien je Klasse aus dem Katalog: nur sie lassen sich ohne Blick in die Zukunft zurückrechnen
KURSBASIERT = {typ: [k["name"] for k in liste if k["kursbasiert"]] for typ, liste in kriterien.KATALOG.items()}
AUSGELASSEN = {typ: [k["name"] for k in liste if not k["kursbasiert"]] for typ, liste in kriterien.KATALOG.items()}
# Kombination über die kursbasierten Standardsignale (bei Aktien ist nur Pullback kursbasiert, dort entfällt sie)
KOMBI = {"forex": ("mindestens 2 der 3 kursbasierten Standardsignale", 2),
         "rohstoff": ("mindestens 3 der 4 Standardsignale", 3), "index": ("mindestens 3 der 4 Standardsignale", 3)}
STANDARD_KURS = {typ: [k["name"] for k in liste if k["kursbasiert"] and k["standard"]] for typ, liste in kriterien.KATALOG.items()}


def reihen(kurse: pd.Series) -> pd.DataFrame:
    """Faktoren für jeden Handelstag, gleiche Definitionen wie kennzahlen.berechne und kennzahlen.faktoren."""
    k = kurse.dropna().astype(float)
    df = pd.DataFrame({"kurs": k})
    hoch, tief = k.rolling(J, min_periods=J).max(), k.rolling(J, min_periods=J).min()
    spanne = hoch - tief
    df["abstand_hoch"] = 1 - k / hoch
    df["position_spanne"] = ((k - tief) / spanne).where(spanne > 0)
    df["momentum_12_1"] = k.shift(21) / k.shift(J) - 1
    df["mittel_5j"] = k.rolling(5 * J, min_periods=J).mean()
    df["abweichung_mittel_5j"] = k / df["mittel_5j"] - 1
    vol = k.pct_change().rolling(21).std() * math.sqrt(J)
    df["vol_1m"] = vol
    df["vol_median_1j"] = vol.rolling(J, min_periods=200).median()
    df["vol_verhaeltnis"] = vol / df["vol_median_1j"]
    df["gd200"] = k.rolling(200).mean()
    df["abstand_gd200"] = k / df["gd200"] - 1
    df["kurs_3m"] = k.shift(63)
    df["rendite_3m"] = k / df["kurs_3m"] - 1
    df["vol_1j"] = k.pct_change().rolling(J - 1, min_periods=200).std() * math.sqrt(J)
    for name, h in HORIZONTE.items():
        df["fwd_" + name] = k.shift(-h) / k - 1
    return df


def _none(x):
    return None if x is None or (isinstance(x, float) and math.isnan(x)) else float(x)


def signale_am(zeile: pd.Series, typ: str, symbol: str, cfg: dict) -> dict[str, bool | None]:
    """Erfüllt ja/nein je kursbasiertem Kriterium an einem Tag, mit dem Katalog des Wochenberichts."""
    kz = {s: _none(zeile.get(s)) for s in ("abstand_hoch", "position_spanne", "momentum_12_1", "abweichung_mittel_5j",
                                           "vol_1m", "vol_median_1j", "vol_verhaeltnis", "abstand_gd200", "rendite_3m",
                                           "vol_1j", "kurs_3m", "gd200", "mittel_5j", "kurs")}
    params = cfg[kriterien.ABSCHNITT[typ]]
    return {k["name"]: kriterien.pruefe(k, kz, params)["erfuellt"] for k in kriterien.KATALOG[typ] if k["kursbasiert"]}


def _auswerten(ja: list[float], nein: list[float]) -> dict:
    m = lambda xs: sum(xs) / len(xs) if xs else None  # noqa: E731
    q = lambda xs: sum(1 for x in xs if x > 0) / len(xs) if xs else None  # noqa: E731
    mj, mn = m(ja), m(nein)
    return {"n_ja": len(ja), "n_nein": len(nein), "mittel_ja": mj, "mittel_nein": mn, "quote_ja": q(ja), "quote_nein": q(nein),
            "vorsprung": mj - mn if mj is not None and mn is not None else None, "wenig": len(ja) < 12}


def berechne(rohdaten: list[dict], zeilen: list[dict], cfg: dict) -> dict:
    """Ergebnis je Anlageklasse: Zeilen je Signal (und Kombination) mit 3/6/12-Monats-Auswertung."""
    typ_von = {z["symbol"]: z["typ"] for z in zeilen}
    sammeln: dict[str, dict] = {}
    for r in rohdaten:
        typ = typ_von.get(r["symbol"])
        if typ not in KURSBASIERT or r.get("kurse") is None or len(r["kurse"].dropna()) < J + 70:
            continue
        df = reihen(r["kurse"])
        monatsenden = df.groupby(df.index.to_period("M")).tail(1)
        monatsenden = monatsenden[monatsenden.index > df.index[-1] - pd.DateOffset(years=10)]  # zehn Jahre, davor Vorlauf
        ziel = sammeln.setdefault(typ, {"werte": set(), "von": None, "bis": None, "faelle": {}})
        for datum, zeile in monatsenden.iterrows():
            sig = signale_am(zeile, typ, r["symbol"], cfg)
            if all(v is None for v in sig.values()):
                continue
            std = [sig.get(n) for n in STANDARD_KURS[typ]]
            if typ in KOMBI and all(v is not None for v in std):
                sig["Kombination"] = sum(1 for v in std if v) >= KOMBI[typ][1]
            for name, ok in sig.items():
                if ok is None:
                    continue
                for h in HORIZONTE:
                    fwd = _none(zeile.get("fwd_" + h))
                    if fwd is None:
                        continue
                    ziel["faelle"].setdefault(name, {}).setdefault(h, {True: [], False: []})[bool(ok)].append(fwd)
                    ziel["werte"].add(r["symbol"])
                    d = datum.date()
                    ziel["von"] = d if ziel["von"] is None or d < ziel["von"] else ziel["von"]
                    ziel["bis"] = d if ziel["bis"] is None or d > ziel["bis"] else ziel["bis"]
    aus = {}
    for typ, s in sammeln.items():
        namen = [n for n in KURSBASIERT[typ] if n in s["faelle"]] + (["Kombination"] if "Kombination" in s["faelle"] else [])
        aus[typ] = {
            "werte": len(s["werte"]), "von": s["von"], "bis": s["bis"], "ausgelassen": AUSGELASSEN[typ],
            "kombi_text": KOMBI.get(typ, (None,))[0],
            "zeilen": [{"signal": n, "kombi": n == "Kombination",
                        "h": {h: _auswerten(*(lambda f: (f[True], f[False]))(s["faelle"][n].get(h, {True: [], False: []})))
                              for h in HORIZONTE}} for n in namen],
        }
    return aus
