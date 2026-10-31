"""Exakte Kurse für den Backtest: OANDA v20 (Geld- und Briefkurse, ab 2005, Minute bis Tag).

Wofür: Forex, Edelmetalle, Öl, Kupfer und Indizes. OANDA ist ein regulierter Broker; die Kurse sind die
Geld- (Bid) und Briefkurse (Ask), zu denen dort gehandelt wurde. Damit stecken Spreads und Kurslücken echt im
Backtest, und Take-Profit/Stop lassen sich stunden- bzw. um Termine herum minutengenau prüfen.

Zugang: kostenloses Demokonto (fxtrade practice) → „Manage API Access“ → Token erzeugen.
  OANDA_API_TOKEN   Token (GitHub Secret oder Umgebungsvariable, nie in den Code)
  OANDA_UMGEBUNG    practice (Standard) oder live
Ohne Token bleibt der Backtest bei Tagesdaten (Eulerpool/Yahoo) und sagt das im Report.

Cache: cache/backtest/oanda/ (nicht im Repository). Abgeschlossene Zeiträume werden nie neu geladen;
jede Woche kommen nur die neuen Kerzen dazu. Fällt OANDA aus, rechnet der Backtest mit dem Cache weiter.

Nutzungsbedingungen: Die Daten sind für die persönliche Nutzung. Deshalb landen Stunden- und Minutendaten nur
dann auf der öffentlichen Website, wenn in config.yaml `backtest: intraday_veroeffentlichen: true` steht.
"""
from __future__ import annotations

import datetime as dt
import json
import logging
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

import pandas as pd

from . import netz

log = logging.getLogger(__name__)

SERVER = {"practice": "https://api-fxpractice.oanda.com", "live": "https://api-fxtrade.oanda.com"}
# Yahoo-Kürzel der Watchlist → OANDA-Instrument (Spot bzw. CFD; Rohstoffe als Kassakurs statt Future)
INSTRUMENTE = {
    "EURUSD=X": "EUR_USD", "EURJPY=X": "EUR_JPY", "GBPUSD=X": "GBP_USD", "EURCHF=X": "EUR_CHF",
    "USDJPY=X": "USD_JPY", "AUDUSD=X": "AUD_USD", "USDCAD=X": "USD_CAD", "USDCHF=X": "USD_CHF",
    "EURGBP=X": "EUR_GBP", "NZDUSD=X": "NZD_USD", "GBPJPY=X": "GBP_JPY",
    "GC=F": "XAU_USD", "SI=F": "XAG_USD", "BZ=F": "BCO_USD", "CL=F": "WTICO_USD", "HG=F": "XCU_USD",
    "NG=F": "NATGAS_USD", "PL=F": "XPT_USD",
    "^GDAXI": "DE30_EUR", "^GSPC": "SPX500_USD", "^NDX": "NAS100_USD", "^STOXX50E": "EU50_EUR",
    "^DJI": "US30_USD", "^N225": "JP225_USD", "^FTSE": "UK100_GBP",
    "ES=F": "SPX500_USD", "NQ=F": "NAS100_USD",
}
MAX_KERZEN = 5000
SCHRITT_MIN = {"M1": 1, "H1": 60, "D": 1440}
FENSTER_VOR, FENSTER_NACH = 5, 240  # Minutendaten von 5 Minuten vor bis mindestens 4 Stunden nach einem Termin


def fenster_ende(t: int) -> int:
    """Ende des Minutenfensters: volle Stunde nach t + 4 Stunden, damit danach nahtlos Stundenkerzen folgen."""
    return -(-(t + FENSTER_NACH) // 60) * 60


def token() -> str | None:
    return os.environ.get("OANDA_API_TOKEN") or None


def instrument(symbol: str) -> str | None:
    return INSTRUMENTE.get(symbol)


def _iso(minute: int) -> str:
    return dt.datetime.fromtimestamp(minute * 60, dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _minute(zeit: str) -> int:
    """'2016-01-04T22:00:00.000000000Z' → Minuten seit 1970 (UTC)."""
    return int(pd.Timestamp(zeit[:19] + "Z").timestamp() // 60)


def lies_kerzen(antwort: dict) -> list[list]:
    """OANDA-Antwort → [[minute, bo, bh, bl, bc, ao, ah, al, ac], …] (nur abgeschlossene Kerzen)."""
    aus = []
    for k in antwort.get("candles") or []:
        if not k.get("complete", True) or "bid" not in k or "ask" not in k:
            continue
        b, a = k["bid"], k["ask"]
        aus.append([_minute(k["time"])] + [float(b[x]) for x in "ohlc"] + [float(a[x]) for x in "ohlc"])
    return aus


def stellen(antwort: dict) -> int:
    """Nachkommastellen des Instruments aus den Kursen (OANDA liefert sie als Text mit fester Stellenzahl)."""
    for k in antwort.get("candles") or []:
        for seite in ("bid", "ask", "mid"):
            if seite in k:
                t = k[seite]["c"]
                return len(t.split(".")[1]) if "." in t else 0
    return 5


def _get(pfad: str, params: dict) -> dict:
    url = SERVER.get(os.environ.get("OANDA_UMGEBUNG", "practice"), SERVER["practice"]) + pfad + "?" + urllib.parse.urlencode(params)
    anfrage = urllib.request.Request(url, headers={"Authorization": f"Bearer {token()}", "Accept-Datetime-Format": "RFC3339",
                                                   "User-Agent": "fathom-backtest/1.0"})
    for versuch in range(4):
        try:
            with urllib.request.urlopen(anfrage, timeout=30) as r:
                return json.loads(netz.lies(r).decode("utf-8"))
        except urllib.error.HTTPError as exc:
            if exc.code in (429, 500, 502, 503, 504) and versuch < 3:
                time.sleep(1.5 * (versuch + 1))
                continue
            raise
        except urllib.error.URLError:
            if versuch < 3:
                time.sleep(1.5 * (versuch + 1))
                continue
            raise
    return {}


def kerzen(inst: str, granularitaet: str, von_minute: int, anzahl: int = MAX_KERZEN) -> tuple[list[list], int]:
    params = {"price": "BA", "granularity": granularitaet, "from": _iso(von_minute), "count": min(anzahl, MAX_KERZEN)}
    if granularitaet == "D":
        params |= {"dailyAlignment": 17, "alignmentTimezone": "America/New_York"}
    antwort = _get(f"/v3/instruments/{inst}/candles", params)
    return lies_kerzen(antwort), stellen(antwort)


class Cache:
    """Kerzen je Instrument und Auflösung als JSON in cache/backtest/oanda/."""

    def __init__(self, ordner: Path):
        self.ordner = ordner
        ordner.mkdir(parents=True, exist_ok=True)

    def _pfad(self, inst: str, name: str) -> Path:
        return self.ordner / f"{inst}-{name}.json"

    def lade(self, inst: str, name: str, leer):
        p = self._pfad(inst, name)
        if not p.exists():
            return leer
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return leer

    def speichere(self, inst: str, name: str, daten) -> None:
        self._pfad(inst, name).write_text(json.dumps(daten, separators=(",", ":")), encoding="utf-8")


def fortschreiben(inst: str, granularitaet: str, cache: Cache, ab_minute: int, bis_minute: int) -> dict:
    """Reihe im Cache bis heute ergänzen. Gibt {'dez': …, 'k': [[minute, bid…, ask…], …]} zurück."""
    d = cache.lade(inst, granularitaet, {"dez": None, "k": []})
    k = [x for x in d["k"] if x[0] >= ab_minute]
    start = k[-1][0] + SCHRITT_MIN[granularitaet] if k else ab_minute
    while start < bis_minute:
        neu, dez = kerzen(inst, granularitaet, start)
        d["dez"] = d["dez"] or dez
        neu = [x for x in neu if x[0] >= start]
        if not neu:
            break
        k.extend(neu)
        start = neu[-1][0] + SCHRITT_MIN[granularitaet]
        if len(neu) < MAX_KERZEN // 2:
            break
    d["k"] = k
    cache.speichere(inst, granularitaet, d)
    return d


def minutenfenster(inst: str, termine: list[int], cache: Cache) -> dict[str, list[list]]:
    """Minutenkerzen um jeden Termin (Minute der Veröffentlichung, UTC). Schon geladene Fenster bleiben."""
    d = cache.lade(inst, "M1", {})
    jetzt = int(time.time() // 60)
    for t in sorted(set(termine)):
        ende = fenster_ende(t)
        if str(t) in d or ende > jetzt - 10:
            continue
        try:
            neu, _ = kerzen(inst, "M1", t - FENSTER_VOR, ende - t + FENSTER_VOR)
        except Exception as exc:  # noqa: BLE001 – einzelnes Fenster fehlt, Rest läuft weiter
            log.info("OANDA %s Minuten um %s: %s", inst, _iso(t), exc)
            continue
        d[str(t)] = [x for x in neu if x[0] < ende]
    cache.speichere(inst, "M1", d)
    return d


def hole(symbol: str, termine: list[int], cache_ordner: Path, heute: dt.date, jahre: int = 11) -> dict | None:
    """Tages-, Stunden- und Minutenkerzen (Bid/Ask) für einen Wert der Watchlist, oder None ohne Zugang."""
    inst = instrument(symbol)
    if not inst or not token():
        return None
    cache = Cache(cache_ordner)
    bis = int(dt.datetime.combine(heute, dt.time(), dt.timezone.utc).timestamp() // 60)
    ab = bis - round(365.25 * jahre) * 1440
    try:
        tag = fortschreiben(inst, "D", cache, ab, bis)
        stunde = fortschreiben(inst, "H1", cache, bis - round(365.25 * min(jahre, 10)) * 1440, bis)
        minute = minutenfenster(inst, [t for t in termine if t >= ab], cache)
    except Exception as exc:  # noqa: BLE001 – dann mit dem, was im Cache liegt
        log.warning("OANDA %s: %s – nutze den Cache", inst, exc)
        tag, stunde, minute = cache.lade(inst, "D", {"k": []}), cache.lade(inst, "H1", {"k": []}), cache.lade(inst, "M1", {})
    if not tag.get("k"):
        return None
    return {"instrument": inst, "dez": tag.get("dez") or stunde.get("dez") or 5, "tag": tag["k"], "stunde": stunde.get("k") or [],
            "minute": minute, "quelle": "OANDA (Geld- und Briefkurse)"}


def mitte(k: list[list]) -> pd.DataFrame:
    """Kerzen → DataFrame mit Mittelkursen (Open/High/Low/Close), Spread und Startzeit in Minuten."""
    if not k:
        return pd.DataFrame(columns=["Open", "High", "Low", "Close", "Spread", "Minute"])
    a = pd.DataFrame(k, columns=["Minute", "bo", "bh", "bl", "bc", "ao", "ah", "al", "ac"])
    return pd.DataFrame({
        "Open": (a.bo + a.ao) / 2, "High": (a.bh + a.ah) / 2, "Low": (a.bl + a.al) / 2, "Close": (a.bc + a.ac) / 2,
        "Spread": ((a.ao - a.bo) + (a.ac - a.bc)) / 2, "Minute": a.Minute,
    })
