"""Marktdaten für die erweiterten Kriterien. Alle Quellen sind öffentlich und ohne Schlüssel abrufbar.

  VIX und VIX3M          Yahoo Finance (^VIX, ^VIX3M)
  High-Yield-Spread      FRED, Federal Reserve Bank of St. Louis (ICE BofA US High Yield OAS, BAMLH0A0HYM2)
  Leitzinsen vor 3 Mon.  BIS, Statistik WS_CBPOL (täglich)
  Inflation              BIS, Statistik WS_LONG_CPI (Veränderung zum Vorjahr in Prozent, Einheit 771)
  Terminstruktur         Yahoo Finance, die beiden nächsten Kontrakte (z. B. GCZ26.CMX und GCG27.CMX)
  Positionierung         CFTC Commitments of Traders, Disaggregated Futures Only (Managed Money)

Jede Abfrage ist für sich abgesichert: Fällt eine Quelle aus, zeigt das betroffene Kriterium „Daten fehlen“.
"""
from __future__ import annotations

import csv
import datetime as dt
import io
import json
import logging
import urllib.parse
import urllib.request

from . import netz

log = logging.getLogger(__name__)
KOPF = {"User-Agent": "fathom-screening/1.0"}
MONATSCODE = "FGHJKMNQUVXZ"

# Yahoo-Kürzel → (Wurzel, Börsenendung bei Yahoo, gehandelte Kontraktmonate, CFTC-Kontraktcode)
ROHSTOFFE = {
    "GC=F": ("GC", "CMX", "GJMQVZ", "088691"), "SI=F": ("SI", "CMX", "HKNUZ", "084691"),
    "HG=F": ("HG", "CMX", "HKNUZ", "085692"), "PL=F": ("PL", "NYM", "FJNV", "076651"),
    "PA=F": ("PA", "NYM", "HMUZ", "075651"), "CL=F": ("CL", "NYM", MONATSCODE, "067651"),
    "BZ=F": ("BZ", "NYM", MONATSCODE, "06765T"), "NG=F": ("NG", "NYM", MONATSCODE, "023651"),
    "HO=F": ("HO", "NYM", MONATSCODE, "022651"), "RB=F": ("RB", "NYM", MONATSCODE, "111659"),
    "ZC=F": ("ZC", "CBT", "HKNUZ", "002602"), "ZW=F": ("ZW", "CBT", "HKNUZ", "001602"),
    "ZS=F": ("ZS", "CBT", "FHKNQUX", "005602"), "KC=F": ("KC", "NYB", "HKNUZ", "083731"),
    "SB=F": ("SB", "NYB", "HKNV", "080732"), "CC=F": ("CC", "NYB", "HKNUZ", "073732"),
}


def _laden(url: str, timeout: int = 20) -> str:
    with urllib.request.urlopen(urllib.request.Request(url, headers=KOPF), timeout=timeout) as r:  # noqa: S310
        return netz.lies(r).decode("utf-8")


def _zahl(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


# ---------------------------------------------------------------- Aktienmarkt-Risiko

def hole_vix() -> dict:
    import yfinance as yf
    aus = {}
    for name, sym in (("vix", "^VIX"), ("vix3m", "^VIX3M")):
        try:
            aus[name] = float(yf.Ticker(sym).history(period="5d")["Close"].dropna().iloc[-1])
        except Exception as exc:  # noqa: BLE001
            log.warning("%s nicht abrufbar: %s", sym, exc)
    return aus


def lies_fred(text: str) -> tuple[dt.date, float] | None:
    """Letzter Wert einer FRED-CSV (Spalten Datum, Wert; fehlende Werte als „.“)."""
    letzter = None
    for zeile in csv.reader(io.StringIO(text)):
        if len(zeile) < 2:
            continue
        try:
            d, w = dt.date.fromisoformat(zeile[0].strip()), float(zeile[1])
        except ValueError:
            continue
        letzter = (d, w)
    return letzter


def hole_hy_spread() -> dict:
    try:
        x = lies_fred(_laden("https://fred.stlouisfed.org/graph/fredgraph.csv?id=BAMLH0A0HYM2"))
    except Exception as exc:  # noqa: BLE001
        log.warning("High-Yield-Spread nicht abrufbar: %s", exc)
        return {}
    return {"hy_spread": x[1] / 100, "hy_datum": x[0].strftime("%d.%m.%Y")} if x else {}


# ---------------------------------------------------------------- Zinsen und Inflation (BIS)

def lies_bis(text: str, gebiete: dict, ziel: dt.date | None = None) -> dict:
    """BIS-CSV → {Währung: Wert in Prozent}. Mit `ziel` der Wert, der diesem Datum am nächsten liegt."""
    beste: dict[str, tuple[int, float]] = {}
    for zeile in csv.DictReader(io.StringIO(text)):
        w, wert = gebiete.get(zeile.get("REF_AREA")), _zahl(zeile.get("OBS_VALUE"))
        if not w or wert is None:
            continue
        abstand = 0
        if ziel:
            try:
                d = dt.date.fromisoformat(zeile.get("TIME_PERIOD", "")[:10])
            except ValueError:
                continue
            abstand = abs((d - ziel).days)
        if w not in beste or abstand < beste[w][0] or (not ziel):
            beste[w] = (abstand, wert)
    return {w: v for w, (_, v) in beste.items()}


def _gebiete(waehrungen: set[str]) -> dict:
    from .klassen import BIS_GEBIET
    return {BIS_GEBIET[w]: w for w in waehrungen if w in BIS_GEBIET}


def hole_zinsen_vor(waehrungen: set[str], tage: int = 91) -> dict:
    gebiete = _gebiete(waehrungen)
    if not gebiete:
        return {}
    url = "https://stats.bis.org/api/v1/data/WS_CBPOL/D." + "+".join(sorted(gebiete)) + "/all?lastNObservations=140&format=csv"
    try:
        werte = lies_bis(_laden(url), gebiete, dt.date.today() - dt.timedelta(days=tage))
    except Exception as exc:  # noqa: BLE001
        log.warning("Leitzinsverlauf nicht abrufbar: %s", exc)
        return {}
    return {w: v / 100 for w, v in werte.items()}


def hole_inflation(waehrungen: set[str]) -> dict:
    gebiete = _gebiete(waehrungen)
    if not gebiete:
        return {}
    url = "https://stats.bis.org/api/v1/data/WS_LONG_CPI/M." + "+".join(sorted(gebiete)) + ".771/all?lastNObservations=1&format=csv"
    try:
        werte = lies_bis(_laden(url), gebiete)
    except Exception as exc:  # noqa: BLE001
        log.warning("Inflation nicht abrufbar: %s", exc)
        return {}
    return {w: v / 100 for w, v in werte.items()}


# ---------------------------------------------------------------- Rohstoffe: Terminstruktur und Positionierung

def kontrakte(symbol: str, heute: dt.date, anzahl: int = 3) -> list[tuple[str, dt.date]]:
    """Die nächsten handelbaren Kontrakte nach dem laufenden Monat, z. B. [("GCZ26.CMX", 2026-12-01), …]."""
    if symbol not in ROHSTOFFE:
        return []
    wurzel, endung, monate, _ = ROHSTOFFE[symbol]
    aus, jahr, monat = [], heute.year, heute.month
    while len(aus) < anzahl:
        monat += 1
        if monat > 12:
            monat, jahr = 1, jahr + 1
        code = MONATSCODE[monat - 1]
        if code in monate:
            aus.append((f"{wurzel}{code}{jahr % 100:02d}.{endung}", dt.date(jahr, monat, 1)))
    return aus


def roll_rendite(f1: float, f2: float, d1: dt.date, d2: dt.date) -> tuple[float, int]:
    """Annualisierte Roll-Rendite: positiv, wenn der spätere Kontrakt billiger ist (Backwardation)."""
    monate = (d2.year - d1.year) * 12 + d2.month - d1.month
    return (f1 / f2 - 1) * 12 / monate, monate


def hole_kurve(symbol: str, heute: dt.date | None = None) -> dict:
    import yfinance as yf
    preise = []
    for k, d in kontrakte(symbol, heute or dt.date.today(), 4):
        try:
            h = yf.Ticker(k).history(period="5d")["Close"].dropna()
            if len(h):
                preise.append((k, d, float(h.iloc[-1])))
        except Exception:  # noqa: BLE001
            continue
        if len(preise) == 2:
            break
    if len(preise) < 2:
        return {}
    (k1, d1, f1), (k2, d2, f2) = preise
    roll, monate = roll_rendite(f1, f2, d1, d2)
    return {"roll": roll, "f1": f1, "f2": f2, "k1": k1.split(".")[0], "k2": k2.split(".")[0], "monate": monate}


def lies_cot(eintraege: list[dict]) -> dict:
    """CFTC-Datensätze (neueste zuerst) → Netto-Position der Fonds in % des Open Interest und ihr Perzentil."""
    reihe = []
    for e in eintraege:
        lang, kurz, oi = (_zahl(e.get(k)) for k in ("m_money_positions_long_all", "m_money_positions_short_all", "open_interest_all"))
        if lang is not None and kurz is not None and oi:
            reihe.append((e.get("report_date_as_yyyy_mm_dd", "")[:10], (lang - kurz) / oi))
    if len(reihe) < 26:
        return {}
    reihe.sort()
    jetzt = reihe[-1][1]
    werte = [w for _, w in reihe]
    return {"netto": jetzt, "perzentil": sum(1 for w in werte if w <= jetzt) / len(werte), "wochen": len(werte),
            "datum": reihe[-1][0]}


def hole_cot(symbol: str) -> dict:
    if symbol not in ROHSTOFFE:
        return {}
    code = ROHSTOFFE[symbol][3]
    url = ("https://publicreporting.cftc.gov/resource/72hh-3qpy.json?" + urllib.parse.urlencode(
        {"cftc_contract_market_code": code, "$order": "report_date_as_yyyy_mm_dd DESC", "$limit": "156"}))
    try:
        return lies_cot(json.loads(_laden(url)))
    except Exception as exc:  # noqa: BLE001
        log.warning("CFTC-Daten für %s nicht abrufbar: %s", symbol, exc)
        return {}


def hole_alles(watchlist: list[dict], zinsen: dict) -> dict:
    """Alle Marktdaten für die Watchlist einsammeln."""
    from .klassen import paar
    typen = {e.get("typ", "aktie") for e in watchlist}
    markt: dict = {}
    if "index" in typen:
        markt |= hole_vix() | hole_hy_spread()
    waehrungen = {w for e in watchlist if e.get("typ") == "forex" for w in (paar(e["symbol"]) or ())}
    if waehrungen:
        markt["zinsen_3m"] = hole_zinsen_vor(waehrungen)
        markt["inflation"] = hole_inflation(waehrungen)
    rohstoffe = [e["symbol"] for e in watchlist if e.get("typ") == "rohstoff"]
    markt["kurven"] = {s: hole_kurve(s) for s in rohstoffe}
    markt["cot"] = {s: hole_cot(s) for s in rohstoffe}
    return markt
