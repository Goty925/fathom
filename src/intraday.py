"""Minuten- und Stundenkerzen für die Chart-Taktik, nur über den lokalen Server (python live.py), nie im Wochenlauf.

Yahoo Finance liefert Intraday-Kerzen nur für begrenzte Zeiträume und nur zu regulären Handelszeiten:
  1m   1-Minuten-Kerzen     die letzten 7 Tage
  5m   5-Minuten-Kerzen     die letzten 60 Tage
  15m  15-Minuten-Kerzen    die letzten 60 Tage
  1h   Stundenkerzen        die letzten 730 Tage (2 Jahre)
4-Stunden-Kerzen fasst der Browser aus Stundenkerzen zusammen (assets/taktik-kern.js, fasse).

Kodiert wie eine Kursreihe in daten/backtest.json (siehe backtest.py): Kurse als ganze Zahlen in Punkten, Zeiten in
Minuten seit 1970 (UTC). Im Demo-Modus (python live.py --demo) gibt es simulierte Kerzen, als Demo gekennzeichnet.
"""
from __future__ import annotations

import datetime as dt
import math
import zlib
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd

# Intervall → (Minuten je Kerze, Zeitraum für Yahoo, Zeitraum in Worten, Kalendertage)
INTERVALLE = {"1m": (1, "7d", "7 Tage", 7), "5m": (5, "60d", "60 Tage", 60), "15m": (15, "60d", "60 Tage", 60),
              "1h": (60, "730d", "2 Jahre", 730)}
FRISCH = {"1m": 60, "5m": 300, "15m": 600, "1h": 1800}  # so viele Sekunden bleibt eine Antwort im Zwischenspeicher
MAX_KERZEN = 20000


def kodieren(df: pd.DataFrame | None, symbol: str, intervall: str, quelle: str) -> dict | None:
    """OHLC-Kerzen mit Zeitstempeln (DatetimeIndex) → kompakte Kursreihe; None bei zu wenigen gültigen Kerzen."""
    from .backtest import reihe_kodieren, stellen

    if df is None or df.empty or not isinstance(df.index, pd.DatetimeIndex) or not {"Open", "High", "Low", "Close"} <= set(df.columns):
        return None
    df = df[["Open", "High", "Low", "Close"]].astype(float).replace([np.inf, -np.inf], np.nan).dropna()
    df = df[(df > 0).all(axis=1)]
    idx = df.index if df.index.tz is not None else df.index.tz_localize("UTC")
    df = df.set_axis(idx.tz_convert("UTC")).sort_index()
    df = df[~df.index.duplicated(keep="last")].iloc[-MAX_KERZEN:]
    if len(df) < 3:
        return None
    # Hoch und Tief schließen Eröffnung und Schluss immer ein (Yahoo liefert vereinzelt Rundungsabweichungen)
    df["High"] = df[["Open", "High", "Close"]].max(axis=1)
    df["Low"] = df[["Open", "Low", "Close"]].min(axis=1)
    minuten = [int(x) for x in (df.index - pd.Timestamp(0, tz="UTC")) // pd.Timedelta(minutes=1)]  # unabhängig von der Auflösung
    dez = stellen(df["Close"])
    aus = {"s": symbol, "iv": intervall, "q": quelle, "fenster": INTERVALLE[intervall][2], "dez": dez}
    aus |= reihe_kodieren(df, dez, minuten, 1)
    return aus


def yahoo(symbol: str, intervall: str) -> dict | None:
    """Intraday-Kerzen von Yahoo Finance (reguläre Handelszeit, Kurse nicht bereinigt)."""
    import yfinance as yf

    _, periode, _, _ = INTERVALLE[intervall]
    df = yf.Ticker(symbol).history(period=periode, interval=intervall, auto_adjust=False, prepost=False)
    return kodieren(df, symbol, intervall, "Yahoo Finance")


def demo(symbol: str, intervall: str, anker: float, heute: dt.date | None = None) -> dict | None:
    """Simulierte Intraday-Kerzen zu den Handelszeiten des Werts; der letzte Schluss liegt beim Anker (z. B. letzter
    Tagesschluss). Je Kürzel und Intervall immer dieselben Kurse."""
    from .backtest import oeffnung

    minuten, _, _, tage = INTERVALLE[intervall]
    heute = heute or dt.date.today()
    tz, h, m, vorher, dauer = oeffnung(symbol)
    zone = ZoneInfo(tz)
    starts = []
    for i in range(tage, -1, -1):
        d = heute - dt.timedelta(days=i)
        if d.weekday() >= 5:
            continue
        beginn = int(dt.datetime(d.year, d.month, d.day, h, m, tzinfo=zone).timestamp() // 60) - vorher * 1440
        starts.extend(range(beginn, beginn + dauer, minuten))
    jetzt = int(dt.datetime.now(dt.timezone.utc).timestamp() // 60)
    starts = [t for t in starts if t <= jetzt][-MAX_KERZEN:]
    if len(starts) < 3:
        return None
    rng = np.random.default_rng(zlib.crc32(f"{symbol.upper()}|{intervall}".encode()))
    sigma = 0.012 * math.sqrt(minuten / 390)
    r = rng.normal(0, sigma, len(starts))
    luecke = np.diff(np.array(starts), prepend=starts[0]) > minuten  # neue Sitzung: kleine Kurslücke zur Eröffnung
    c = np.exp(np.cumsum(r))
    c = anker * c / c[-1]
    o = np.concatenate([[c[0]], c[:-1]]) * np.where(luecke, 1 + rng.normal(0, sigma * 2, len(c)), 1)
    hoch = np.maximum(o, c) * (1 + np.abs(rng.normal(0, sigma * 0.5, len(c))))
    tief = np.minimum(o, c) * (1 - np.abs(rng.normal(0, sigma * 0.5, len(c))))
    df = pd.DataFrame({"Open": o, "High": hoch, "Low": tief, "Close": c},
                      index=pd.to_datetime(np.array(starts, dtype="int64") * 60, unit="s", utc=True))
    return kodieren(df, symbol, intervall, "Demo (simulierte Kerzen)")
