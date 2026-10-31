"""Datenprüfung für den Backtest: Lücken, Ausreißer und Abgleich mit einer zweiten Quelle.

Jeder Wert bekommt einen kleinen Prüfbericht, der im Backtest-Report steht:
  - Abdeckung: erster und letzter Tag, Zahl der Handelstage, längste Lücke in Kalendertagen
  - Ausreißer: Tagesbewegungen über 25 %, die die zweite Quelle nicht bestätigt (Verdacht auf Datenfehler)
  - Abgleich: mittlere Abweichung der Schlusskurse und Gleichlauf der Tagesrenditen gegenüber der zweiten Quelle
Bei Forex und CFDs schließen die Quellen zu unterschiedlichen Uhrzeiten (OANDA 17:00 New York, Yahoo um
Mitternacht London). Darum zählt dort vor allem der Gleichlauf der Renditen, nicht die exakte Abweichung.
"""
from __future__ import annotations

import math

import pandas as pd


def _r(x, n=4):
    return None if x is None or (isinstance(x, float) and (math.isnan(x) or math.isinf(x))) else round(float(x), n)


def pruefe(primaer: pd.Series, zweit: pd.Series | None, quelle: str, zweitquelle: str | None) -> dict:
    """Prüfbericht für eine Reihe von Schlusskursen (Index: Datum)."""
    p = primaer.dropna()
    p = p[p > 0]
    aus = {"quelle": quelle, "tage": int(len(p))}
    if p.empty:
        return aus
    idx = pd.DatetimeIndex(p.index)
    aus["von"], aus["bis"] = idx[0].date().isoformat(), idx[-1].date().isoformat()
    abstaende = pd.Series(idx[1:] - idx[:-1]).dt.days
    aus["laengste_luecke"] = int(abstaende.max()) if len(abstaende) else 0
    r = p.pct_change().dropna()
    verdacht = r[r.abs() > 0.25]
    if zweit is not None and len(zweit.dropna()) > 20:
        z = zweit.dropna()
        z = z[z > 0]
        z.index = pd.DatetimeIndex(z.index).normalize()
        p2 = p.copy()
        p2.index = idx.normalize()
        gemeinsam = p2.index.intersection(z.index)
        if len(gemeinsam) > 20:
            a, b = p2.loc[gemeinsam], z.loc[gemeinsam]
            abw = (a / b - 1).abs()
            ra, rb = a.pct_change().dropna(), b.pct_change().dropna()
            aus["abgleich"] = {
                "quelle": zweitquelle, "tage": int(len(gemeinsam)), "median": _r(abw.median(), 5), "max": _r(abw.max(), 4),
                "ueber_1pct": int((abw > 0.01).sum()), "gleichlauf": _r(ra.corr(rb), 3),
            }
            rz = z.pct_change()
            verdacht = verdacht[[not (d in rz.index and abs(rz.get(d, 0) or 0) > 0.15) for d in verdacht.index]]
    aus["ausreisser"] = [d.date().isoformat() for d in verdacht.index[:10]]
    return aus
