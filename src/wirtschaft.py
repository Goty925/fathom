"""Wirtschaftsdaten für den Backtest: Termine, Ist-Wert, Vorwert und (optional) Prognose.

Ist-Werte und Termine: FRED/ALFRED der Federal Reserve Bank of St. Louis. ALFRED speichert jede Fassung einer
Zeitreihe mit dem Tag, ab dem sie galt. Daraus entsteht der Wert genau so, wie er am Tag der Veröffentlichung um
8:30 Uhr New Yorker Zeit gemeldet wurde, nicht der später revidierte. Schlüssel kostenlos:
https://fred.stlouisfed.org/docs/api/api_key.html → Umgebungsvariable/Secret FRED_API_KEY.

Prognose (Konsens der Volkswirte): gibt es nicht kostenlos und nicht erlaubt abrufbar. Optional:
  TRADINGECONOMICS_API_KEY   Trading Economics (Feld „Forecast“ = Konsens)
  FMP_API_KEY                Financial Modeling Prep (Feld „estimate“)
Ohne einen dieser Schlüssel bleiben im Backtest die Vergleiche „Ist gegenüber Vorwert“ und „Ist über/unter einem
festen Wert“. Investing.com und ForexFactory werden bewusst nicht ausgelesen (Nutzungsbedingungen).

Alles landet in cache/backtest/ (nicht im Repository), damit ein Ausfall der Quelle den Backtest nicht leert.
"""
from __future__ import annotations

import datetime as dt
import json
import logging
import os
import re
import urllib.parse
import urllib.request
from pathlib import Path
from zoneinfo import ZoneInfo

from . import netz

log = logging.getLogger(__name__)
NEW_YORK = ZoneInfo("America/New_York")

# Uhrzeit der Veröffentlichung (Ortszeit New York): BLS veröffentlicht CPI und Arbeitsmarktbericht um 8:30 Uhr
INDIKATOREN = {
    "us_cpi_j": {"name": "US-Inflation (CPI) zum Vorjahr", "kurz": "CPI j/j", "einheit": "%", "dez": 1, "reihe": "CPIAUCNS", "art": "jahr", "zeit": (8, 30), "gruppe": "us_cpi"},
    "us_cpi_m": {"name": "US-Inflation (CPI) zum Vormonat", "kurz": "CPI m/m", "einheit": "%", "dez": 1, "reihe": "CPIAUCSL", "art": "monat", "zeit": (8, 30), "gruppe": "us_cpi"},
    "us_kern_j": {"name": "US-Kerninflation zum Vorjahr", "kurz": "Kern-CPI j/j", "einheit": "%", "dez": 1, "reihe": "CPILFENS", "art": "jahr", "zeit": (8, 30), "gruppe": "us_cpi"},
    "us_kern_m": {"name": "US-Kerninflation zum Vormonat", "kurz": "Kern-CPI m/m", "einheit": "%", "dez": 1, "reihe": "CPILFESL", "art": "monat", "zeit": (8, 30), "gruppe": "us_cpi"},
    "us_nfp": {"name": "US-Arbeitsmarkt: neue Stellen (NFP)", "kurz": "NFP", "einheit": "Tsd.", "dez": 0, "reihe": "PAYEMS", "art": "diff", "zeit": (8, 30), "gruppe": "us_arbeit"},
    "us_alq": {"name": "US-Arbeitslosenquote", "kurz": "Arbeitslosenquote", "einheit": "%", "dez": 1, "reihe": "UNRATE", "art": "stand", "zeit": (8, 30), "gruppe": "us_arbeit"},
}
# Namen bei Trading Economics (Kategorie) und FMP (Muster im Ereignisnamen)
TE_KATEGORIE = {"us_cpi_j": "Inflation Rate", "us_cpi_m": "Inflation Rate MoM", "us_kern_j": "Core Inflation Rate",
                "us_kern_m": "Core Inflation Rate MoM", "us_nfp": "Non Farm Payrolls", "us_alq": "Unemployment Rate"}
FMP_MUSTER = {
    "us_cpi_j": r"^(cpi|inflation rate)\b(?!.*core).*(yoy|y/y)", "us_cpi_m": r"^(cpi|inflation rate)\b(?!.*core).*(mom|m/m)",
    "us_kern_j": r"^core (cpi|inflation rate)\b.*(yoy|y/y)", "us_kern_m": r"^core (cpi|inflation rate)\b.*(mom|m/m)",
    "us_nfp": r"^non ?-?farm payrolls?\b(?!.*private)", "us_alq": r"^unemployment rate\b",
}


def _json(url: str) -> dict | list:
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "fathom-backtest/1.0"}), timeout=40) as r:
        return json.loads(netz.lies(r).decode("utf-8"))


def _zahl(x) -> float | None:
    if x is None:
        return None
    if isinstance(x, (int, float)):
        return float(x)
    t = str(x).strip().replace(",", "").replace("%", "")
    faktor = 1.0
    if t[-1:].upper() == "K":
        t = t[:-1]
    elif t[-1:].upper() == "M":
        t, faktor = t[:-1], 1000.0
    try:
        return float(t) * faktor
    except ValueError:
        return None


def minute_ny(datum: dt.date, stunde: int, minute: int) -> int:
    """Ortszeit New York (mit Sommerzeit) → Minuten seit 1970 UTC."""
    return int(dt.datetime(datum.year, datum.month, datum.day, stunde, minute, tzinfo=NEW_YORK).timestamp() // 60)


# ---------------------------------------------------------------- FRED/ALFRED

def lies_versionen(beobachtungen: list[dict]) -> dict[str, list[tuple[str, str, float]]]:
    """FRED-Beobachtungen mit Echtzeit-Spanne → {Monat: [(gilt_ab, gilt_bis, Wert), …]}."""
    aus: dict[str, list] = {}
    for b in beobachtungen:
        w = _zahl(b.get("value"))
        if w is None:
            continue
        aus.setdefault(b["date"][:7], []).append((b["realtime_start"], b["realtime_end"], w))
    for v in aus.values():
        v.sort()
    return aus


def wert_am(versionen: dict, monat: str, stichtag: str) -> float | None:
    """Wert eines Monats, wie er am Stichtag (JJJJ-MM-TT) bekannt war."""
    for ab, bis, w in versionen.get(monat, []):
        if ab <= stichtag <= bis:
            return w
    return None


def _monat(m: str, k: int) -> str:
    j, mm = int(m[:4]), int(m[5:7]) + k
    while mm < 1:
        j, mm = j - 1, mm + 12
    while mm > 12:
        j, mm = j + 1, mm - 12
    return f"{j:04d}-{mm:02d}"


def termine(ind: dict, versionen: dict, ab: dt.date) -> list[list]:
    """[[Minute UTC, Ist, None (Prognose), Vorwert, Berichtsmonat], …] aus den ALFRED-Fassungen."""
    aus = []
    for m in sorted(versionen):
        tag = versionen[m][0][0]  # erste Fassung = Tag der Erstveröffentlichung
        if dt.date.fromisoformat(tag) < ab:
            continue
        w = lambda k: wert_am(versionen, _monat(m, k), tag)  # noqa: E731
        if ind["art"] == "jahr":
            ist = (w(0) / w(-12) - 1) * 100 if w(0) and w(-12) else None
            vor = (w(-1) / w(-13) - 1) * 100 if w(-1) and w(-13) else None
        elif ind["art"] == "monat":
            ist = (w(0) / w(-1) - 1) * 100 if w(0) and w(-1) else None
            vor = (w(-1) / w(-2) - 1) * 100 if w(-1) and w(-2) else None
        elif ind["art"] == "diff":
            ist = w(0) - w(-1) if w(0) is not None and w(-1) is not None else None
            vor = w(-1) - w(-2) if w(-1) is not None and w(-2) is not None else None
        else:
            ist, vor = w(0), w(-1)
        if ist is None:
            continue
        r = lambda x: None if x is None else round(x, ind["dez"])  # noqa: E731
        aus.append([minute_ny(dt.date.fromisoformat(tag), *ind["zeit"]), r(ist), None, r(vor), m])
    return aus


def hole_fred(reihe: str, cache: Path) -> list[dict]:
    """Alle Fassungen einer FRED-Reihe ab 2012 (ein Abruf je Reihe, Ergebnis im Cache)."""
    schluessel = os.environ.get("FRED_API_KEY")
    pfad = cache / f"fred-{reihe}.json"
    if schluessel:
        url = ("https://api.stlouisfed.org/fred/series/observations?" + urllib.parse.urlencode({
            "series_id": reihe, "api_key": schluessel, "file_type": "json", "observation_start": "2012-01-01",
            "realtime_start": "2012-01-01", "realtime_end": "9999-12-31", "limit": 100000}))
        try:
            daten = _json(url).get("observations") or []
            if daten:
                pfad.write_text(json.dumps(daten, separators=(",", ":")), encoding="utf-8")
                return daten
        except Exception as exc:  # noqa: BLE001 – Cache übernimmt
            log.warning("FRED %s: %s – nutze den Cache", reihe, exc)
    if pfad.exists():
        return json.loads(pfad.read_text(encoding="utf-8"))
    return []


# ---------------------------------------------------------------- Prognosen (optional, kostenpflichtig)

def lies_te(eintraege: list[dict]) -> dict[str, dict[str, float]]:
    """Trading Economics → {Indikator: {Datum UTC: Prognose}}."""
    rueck = {v: k for k, v in TE_KATEGORIE.items()}
    aus: dict[str, dict] = {}
    for e in eintraege:
        ind = rueck.get(e.get("Category"))
        p = _zahl(e.get("Forecast"))
        if ind and p is not None and e.get("Date"):
            aus.setdefault(ind, {})[str(e["Date"])[:10]] = p
    return aus


def lies_fmp(eintraege: list[dict]) -> dict[str, dict[str, float]]:
    """Financial Modeling Prep → {Indikator: {Datum UTC: Prognose}} (nur USA)."""
    aus: dict[str, dict] = {}
    for e in eintraege:
        if str(e.get("country", "")).upper() not in ("US", "USA", "UNITED STATES"):
            continue
        name = str(e.get("event", "")).strip().lower()
        p = _zahl(e.get("estimate"))
        if p is None or not e.get("date"):
            continue
        for ind, muster in FMP_MUSTER.items():
            if re.search(muster, name):
                if ind == "us_nfp" and abs(p) > 5000:
                    p /= 1000  # manche Quellen melden Stellen statt Tausend
                aus.setdefault(ind, {})[str(e["date"])[:10]] = p
                break
    return aus


def hole_prognosen(ab: dt.date, bis: dt.date, cache: Path) -> tuple[dict, str | None]:
    pfad = cache / "prognosen.json"
    alt = json.loads(pfad.read_text(encoding="utf-8")) if pfad.exists() else {"quelle": None, "werte": {}}
    neu, quelle = {}, None
    try:
        if os.environ.get("TRADINGECONOMICS_API_KEY"):
            quelle = "Trading Economics"
            k = urllib.parse.quote(os.environ["TRADINGECONOMICS_API_KEY"])
            neu = lies_te(_json(f"https://api.tradingeconomics.com/calendar/country/united%20states/{ab}/{bis}?c={k}&f=json"))
        elif os.environ.get("FMP_API_KEY"):
            quelle = "Financial Modeling Prep"
            eintraege, von = [], ab
            while von < bis:
                b = min(bis, von + dt.timedelta(days=89))
                eintraege += _json("https://financialmodelingprep.com/stable/economic-calendar?" + urllib.parse.urlencode(
                    {"from": von.isoformat(), "to": b.isoformat(), "apikey": os.environ["FMP_API_KEY"]})) or []
                von = b + dt.timedelta(days=1)
            neu = lies_fmp(eintraege)
    except Exception as exc:  # noqa: BLE001
        log.warning("Prognosen (%s): %s – nutze den Cache", quelle, exc)
        neu = {}
    if neu:
        for ind, w in neu.items():
            alt["werte"].setdefault(ind, {}).update(w)
        alt["quelle"] = quelle
        pfad.write_text(json.dumps(alt, separators=(",", ":")), encoding="utf-8")
    return alt["werte"], alt["quelle"]


def prognosen_eintragen(t: list[list], prognosen: dict[str, float]) -> None:
    for e in t:
        datum = dt.datetime.fromtimestamp(e[0] * 60, dt.timezone.utc).date().isoformat()
        if datum in prognosen:
            e[2] = prognosen[datum]


def hole_alles(cache_ordner: Path, heute: dt.date, jahre: int = 11) -> list[dict]:
    """Alle Indikatoren mit Terminen. Leer, wenn weder Schlüssel noch Cache vorhanden."""
    cache_ordner.mkdir(parents=True, exist_ok=True)
    ab = heute - dt.timedelta(days=round(365.25 * jahre))
    prognosen, pquelle = hole_prognosen(ab, heute, cache_ordner) if (
        os.environ.get("TRADINGECONOMICS_API_KEY") or os.environ.get("FMP_API_KEY") or (cache_ordner / "prognosen.json").exists()) else ({}, None)
    reihen: dict[str, dict] = {}
    aus = []
    for iid, ind in INDIKATOREN.items():
        if ind["reihe"] not in reihen:
            reihen[ind["reihe"]] = lies_versionen(hole_fred(ind["reihe"], cache_ordner))
        t = termine(ind, reihen[ind["reihe"]], ab)
        if not t:
            continue
        prognosen_eintragen(t, prognosen.get(iid, {}))
        aus.append(beschreibung(iid) | {"quelle": "BLS über FRED/ALFRED (Erstveröffentlichung)", "prognose_quelle": pquelle if any(e[2] is not None for e in t) else None,
                                       "termine": t})
    return aus


def beschreibung(iid: str) -> dict:
    ind = INDIKATOREN[iid]
    return {"id": iid, "name": ind["name"], "kurz": ind["kurz"], "einheit": ind["einheit"], "dez": ind["dez"], "gruppe": ind["gruppe"],
            "uhrzeit": f"{ind['zeit'][0]}:{ind['zeit'][1]:02d} Uhr New York"}
