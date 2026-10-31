"""Wirtschaftskalender für den Work-Modus: Termine mit Uhrzeit, Wichtigkeit, Ist, Prognose und Vorwert.

Quellen (alle offiziell oder mit eigenem Schlüssel, nichts wird von Webseiten ausgelesen):
  - Termine der US-Statistiken: FRED-Veröffentlichungskalender (fred/release/dates, auch künftige Termine).
    Schlüssel FRED_API_KEY (kostenlos), derselbe wie für den Backtest.
  - Ist und Vorwert: FRED/ALFRED-Fassungen. Für einen vergangenen Termin gilt der Stand am Tag der Veröffentlichung,
    für einen künftigen der heutige Stand (= Vorwert).
  - Ist-Werte in der Minute der Veröffentlichung: BLS-Schnittstelle (nur über python live.py, siehe bls_*).
  - Notenbanken: Sitzungstermine der Fed (federalreserve.gov/monetarypolicy/fomccalendars.htm) und der EZB
    (ecb.europa.eu/press/calendars/mgcgc). Stand 18.10.2026; die Fed-Termine 2027 sind dort vorläufig.
  - Quartalszahlen: Termine der Aktien auf der Watchlist, Erwartung aus dem Wochenbericht.
  - Optional und kostenpflichtig: TRADINGECONOMICS_API_KEY oder FMP_API_KEY ergänzen Prognosen und Termine anderer
    Länder (Eurozone, Deutschland, Großbritannien, Japan, China, Schweiz).
Investing.com und ForexFactory werden bewusst nicht ausgelesen (Nutzungsbedingungen).

Zeiten: Minuten seit 1970 (UTC). Die Seite zeigt sie in deutscher Zeit.
"""
from __future__ import annotations

import datetime as dt
import json
import logging
import os
import urllib.parse
import urllib.request
from pathlib import Path
from zoneinfo import ZoneInfo

from . import netz

log = logging.getLogger(__name__)
NEW_YORK = ZoneInfo("America/New_York")
FRANKFURT = ZoneInfo("Europe/Berlin")
UTC = dt.timezone.utc
VORLAUF, NACHLAUF = 8, 42  # Tage zurück und voraus

# gut: Richtung, die für die Währung als gut gilt (+1: höher ist gut, −1: niedriger ist gut), wie bei Forex-Kalendern üblich
KONJUNKTUR = [
    {"id": "us_cpi", "release": 10, "titel": "US-Verbraucherpreise (CPI)", "zeit": (8, 30), "wichtig": 3,
     "link": "https://www.bls.gov/cpi/", "quelle": "U.S. Bureau of Labor Statistics",
     "info": "Inflation der Verbraucherpreise. Bewegt Zinserwartungen, Dollar, Anleihen und Aktien stark.",
     "werte": [
         {"id": "us_cpi_j", "kurz": "CPI j/j", "reihe": "CPIAUCNS", "art": "jahr", "einheit": "%", "dez": 1, "gut": 1, "bls": "CUUR0000SA0"},
         {"id": "us_cpi_m", "kurz": "CPI m/m", "reihe": "CPIAUCSL", "art": "monat", "einheit": "%", "dez": 1, "gut": 1, "bls": "CUSR0000SA0"},
         {"id": "us_kern_j", "kurz": "Kern j/j", "reihe": "CPILFENS", "art": "jahr", "einheit": "%", "dez": 1, "gut": 1, "bls": "CUUR0000SA0L1E"},
         {"id": "us_kern_m", "kurz": "Kern m/m", "reihe": "CPILFESL", "art": "monat", "einheit": "%", "dez": 1, "gut": 1, "bls": "CUSR0000SA0L1E"},
     ]},
    {"id": "us_arbeit", "release": 50, "titel": "US-Arbeitsmarktbericht", "zeit": (8, 30), "wichtig": 3,
     "link": "https://www.bls.gov/ces/", "quelle": "U.S. Bureau of Labor Statistics",
     "info": "Neue Stellen außerhalb der Landwirtschaft (NFP), Arbeitslosenquote und Stundenlöhne.",
     "werte": [
         {"id": "us_nfp", "kurz": "Neue Stellen", "reihe": "PAYEMS", "art": "diff", "einheit": "Tsd.", "dez": 0, "gut": 1, "bls": "CES0000000001"},
         {"id": "us_alq", "kurz": "Arbeitslosenquote", "reihe": "UNRATE", "art": "stand", "einheit": "%", "dez": 1, "gut": -1, "bls": "LNS14000000"},
         {"id": "us_lohn_m", "kurz": "Stundenlöhne m/m", "reihe": "CES0500000003", "art": "monat", "einheit": "%", "dez": 1, "gut": 1, "bls": "CES0500000003"},
     ]},
    {"id": "us_bip", "release": 53, "titel": "US-Wirtschaftsleistung (BIP)", "zeit": (8, 30), "wichtig": 3,
     "link": "https://www.bea.gov/data/gdp/gross-domestic-product", "quelle": "U.S. Bureau of Economic Analysis",
     "info": "Wachstum zum Vorquartal, auf das Jahr hochgerechnet.",
     "werte": [{"id": "us_bip", "kurz": "BIP q/q ann.", "reihe": "A191RL1Q225SBEA", "art": "stand", "einheit": "%", "dez": 1, "gut": 1}]},
    {"id": "us_pce", "release": 54, "titel": "US-Konsumausgaben und PCE-Preise", "zeit": (8, 30), "wichtig": 2,
     "link": "https://www.bea.gov/data/personal-consumption-expenditures-price-index", "quelle": "U.S. Bureau of Economic Analysis",
     "info": "Das Inflationsmaß, an dem die Fed ihr Ziel von 2 % misst.",
     "werte": [
         {"id": "us_pce_j", "kurz": "PCE j/j", "reihe": "PCEPI", "art": "jahr", "einheit": "%", "dez": 1, "gut": 1},
         {"id": "us_kpce_j", "kurz": "Kern-PCE j/j", "reihe": "PCEPILFE", "art": "jahr", "einheit": "%", "dez": 1, "gut": 1},
         {"id": "us_kpce_m", "kurz": "Kern-PCE m/m", "reihe": "PCEPILFE", "art": "monat", "einheit": "%", "dez": 1, "gut": 1},
     ]},
    {"id": "us_handel", "release": 9, "titel": "US-Einzelhandelsumsatz", "zeit": (8, 30), "wichtig": 2,
     "link": "https://www.census.gov/retail/", "quelle": "U.S. Census Bureau",
     "info": "Umsatz im Einzelhandel zum Vormonat, Gradmesser für den Konsum.",
     "werte": [{"id": "us_handel_m", "kurz": "Einzelhandel m/m", "reihe": "RSAFS", "art": "monat", "einheit": "%", "dez": 1, "gut": 1}]},
    {"id": "us_ppi", "release": 46, "titel": "US-Erzeugerpreise (PPI)", "zeit": (8, 30), "wichtig": 2,
     "link": "https://www.bls.gov/ppi/", "quelle": "U.S. Bureau of Labor Statistics",
     "info": "Preise der Hersteller, oft ein Vorlauf für die Verbraucherpreise.",
     "werte": [{"id": "us_ppi_m", "kurz": "PPI m/m", "reihe": "PPIFIS", "art": "monat", "einheit": "%", "dez": 1, "gut": 1}]},
    {"id": "us_jolts", "release": 192, "titel": "US-Stellenangebote (JOLTS)", "zeit": (10, 0), "wichtig": 2,
     "link": "https://www.bls.gov/jlt/", "quelle": "U.S. Bureau of Labor Statistics",
     "info": "Offene Stellen; zeigt, wie angespannt der Arbeitsmarkt ist.",
     "werte": [{"id": "us_jolts", "kurz": "Offene Stellen", "reihe": "JTSJOL", "art": "stand", "einheit": "Tsd.", "dez": 0, "gut": 1}]},
    {"id": "us_antraege", "release": 180, "titel": "US-Erstanträge auf Arbeitslosenhilfe", "zeit": (8, 30), "wichtig": 1,
     "link": "https://www.dol.gov/ui/data.pdf", "quelle": "U.S. Department of Labor",
     "info": "Wöchentlich am Donnerstag; schnellster Blick auf Entlassungen.",
     "werte": [{"id": "us_antraege", "kurz": "Erstanträge", "reihe": "ICSA", "art": "stand", "einheit": "Tsd.", "dez": 0, "gut": -1, "faktor": 0.001}]},
    {"id": "us_industrie", "release": 13, "titel": "US-Industrieproduktion", "zeit": (9, 15), "wichtig": 2,
     "link": "https://www.federalreserve.gov/releases/g17/current/", "quelle": "Federal Reserve (G.17)",
     "info": "Produktion von Industrie, Bergbau und Versorgern zum Vormonat.",
     "werte": [{"id": "us_indpro_m", "kurz": "Industrieproduktion m/m", "reihe": "INDPRO", "art": "monat", "einheit": "%", "dez": 1, "gut": 1}]},
]

# Wiederkehrende Termine mit festem Wochentag (Feiertage können sie um einen Tag verschieben)
WIEDERKEHREND = [
    {"id": "us_eia", "titel": "US-Öllagerbestände (EIA)", "wtag": 2, "zeit": (10, 30), "wichtig": 2, "land": "US", "w": "USD",
     "info": "Wöchentlicher Bericht der US-Energiebehörde zu Rohöl- und Benzinvorräten; bewegt Öl. In Feiertagswochen meist einen Tag später.",
     "quelle": "U.S. Energy Information Administration", "link": "https://www.eia.gov/petroleum/supply/weekly/"},
    {"id": "cftc_cot", "titel": "CFTC-Positionsdaten (COT)", "wtag": 4, "zeit": (15, 30), "wichtig": 1, "land": "US", "w": "USD",
     "info": "Wöchentliche Positionen großer Spekulanten in Futures (Stand Dienstag), Grundlage des Signals Positionierung.",
     "quelle": "Commodity Futures Trading Commission", "link": "https://www.cftc.gov/MarketReports/CommitmentsofTraders/index.htm"},
]

# Tag der Zinsentscheidung (zweiter Sitzungstag); Quelle siehe oben
FOMC = ["2026-01-28", "2026-03-18", "2026-04-29", "2026-06-17", "2026-07-29", "2026-09-16", "2026-10-28", "2026-12-09",
        "2027-01-27", "2027-03-17", "2027-04-28", "2027-06-09", "2027-07-28", "2027-09-15", "2027-10-27", "2027-12-08"]
FOMC_PROJEKTIONEN = {"2026-03-18", "2026-06-17", "2026-09-16", "2026-12-09", "2027-03-17", "2027-06-09", "2027-09-15", "2027-12-08"}
EZB = ["2026-02-05", "2026-03-19", "2026-04-30", "2026-06-11", "2026-07-23", "2026-09-10", "2026-10-29", "2026-12-17",
       "2027-02-04", "2027-03-18", "2027-04-29", "2027-06-10", "2027-07-22", "2027-09-09", "2027-10-28", "2027-12-16"]
NOTENBANK_REIHEN = {"fed": {"id": "fed_zins", "kurz": "Leitzins (Obergrenze)", "reihe": "DFEDTARU", "art": "stand", "einheit": "%", "dez": 2, "gut": 1},
                    "ezb": {"id": "ezb_zins", "kurz": "Einlagensatz", "reihe": "ECBDFR", "art": "stand", "einheit": "%", "dez": 2, "gut": 1}}


def minute(datum: dt.date, stunde: int, minute_: int, zone: ZoneInfo) -> int:
    """Ortszeit (mit Sommerzeit) → Minuten seit 1970 UTC."""
    return int(dt.datetime(datum.year, datum.month, datum.day, stunde, minute_, tzinfo=zone).timestamp() // 60)


def _json(url: str, daten: bytes | None = None, kopf: dict | None = None):
    anfrage = urllib.request.Request(url, data=daten, headers={"User-Agent": "fathom-kalender/1.0", **(kopf or {})})
    with urllib.request.urlopen(anfrage, timeout=30) as r:
        return json.loads(netz.lies(r).decode("utf-8"))


# ---------------------------------------------------------------- FRED: Termine und Fassungen

def lies_termine(antwort: dict) -> list[dt.date]:
    return sorted({dt.date.fromisoformat(d["date"]) for d in (antwort or {}).get("release_dates") or [] if d.get("date")})


def lies_fassungen(beobachtungen: list[dict]) -> dict[str, list[tuple[str, str, float]]]:
    """FRED-Beobachtungen mit Echtzeit-Spanne → {Beobachtungsdatum: [(gilt_ab, gilt_bis, Wert), …]}."""
    aus: dict[str, list] = {}
    for b in beobachtungen or []:
        try:
            w = float(b.get("value"))
        except (TypeError, ValueError):
            continue
        aus.setdefault(b["date"], []).append((b.get("realtime_start", "0000-00-00"), b.get("realtime_end", "9999-12-31"), w))
    return aus


def stand_am(fassungen: dict, stichtag: str) -> list[tuple[str, float, str]]:
    """Reihe, wie sie am Stichtag bekannt war: [(Datum, Wert, gilt_ab), …] aufsteigend."""
    aus = []
    for datum, liste in fassungen.items():
        for ab, bis, w in liste:
            if ab <= stichtag <= bis:
                aus.append((datum, w, ab))
                break
    return sorted(aus)


def kennzahl(reihe: list[tuple[str, float, str]], art: str, faktor: float = 1.0) -> tuple[float | None, float | None, str | None, str | None]:
    """(Ist, Vorwert, Beobachtungsdatum, veröffentlicht am) der jüngsten Beobachtung einer Reihe."""
    if not reihe:
        return None, None, None, None
    werte = {d: w for d, w, _ in reihe}
    daten = [d for d, _, _ in reihe]

    def jahr_vorher(d: str) -> str:
        return f"{int(d[:4]) - 1:04d}{d[4:]}"

    def berechne(i: int) -> float | None:
        if i < 0:
            return None
        d = daten[i]
        if art == "jahr":
            alt = werte.get(jahr_vorher(d))
            return (werte[d] / alt - 1) * 100 if alt else None
        if art == "monat":
            return (werte[d] / werte[daten[i - 1]] - 1) * 100 if i >= 1 and werte[daten[i - 1]] else None
        if art == "diff":
            return werte[d] - werte[daten[i - 1]] if i >= 1 else None
        return werte[d] * faktor

    n = len(daten) - 1
    return berechne(n), berechne(n - 1), daten[n], reihe[n][2]


def hole_fred(pfad: str, parameter: dict, cache: Path, name: str, heute: dt.date):
    """Ein FRED-Abruf je Tag, sonst Cache."""
    datei = cache / f"{name}.json"
    if datei.exists():
        alt = json.loads(datei.read_text(encoding="utf-8"))
        if alt.get("tag") == heute.isoformat():
            return alt["daten"]
    schluessel = os.environ.get("FRED_API_KEY")
    if schluessel:
        try:
            daten = _json(f"https://api.stlouisfed.org/fred/{pfad}?" + urllib.parse.urlencode(
                {**parameter, "api_key": schluessel, "file_type": "json"}))
            cache.mkdir(parents=True, exist_ok=True)
            datei.write_text(json.dumps({"tag": heute.isoformat(), "daten": daten}, separators=(",", ":")), encoding="utf-8")
            return daten
        except Exception as exc:  # noqa: BLE001 – Cache übernimmt
            log.warning("FRED %s: %s – nutze den Cache", name, exc)
    return json.loads(datei.read_text(encoding="utf-8"))["daten"] if datei.exists() else None


def _runde(x, dez):
    return None if x is None else round(x, dez)


def werte_zum_termin(spez: list[dict], fassungen: dict[str, dict], tag: dt.date, heute: dt.date) -> list[dict]:
    """Ist/Vorwert je Kennzahl. Vergangen: Stand am Termin, und nur wenn an diesem Tag neu veröffentlicht."""
    aus = []
    vergangen = tag <= heute
    stichtag = (tag if vergangen else heute).isoformat()
    for w in spez:
        reihe = stand_am(fassungen.get(w["reihe"]) or {}, stichtag)
        ist, vor, datum, ab = kennzahl(reihe, w["art"], w.get("faktor", 1.0))
        eintrag = {k: w[k] for k in ("id", "kurz", "einheit", "dez", "gut")} | {"ist": None, "prog": None, "vor": None, "periode": None}
        if vergangen and ab == tag.isoformat():
            eintrag |= {"ist": _runde(ist, w["dez"]), "vor": _runde(vor, w["dez"]), "periode": datum[:7] if datum else None}
        elif vergangen:
            eintrag |= {"vor": _runde(ist, w["dez"])}  # FRED noch nicht aktualisiert: letzter bekannter Wert
        else:
            eintrag |= {"vor": _runde(ist, w["dez"]), "periode": _naechste_periode(datum, w)}
        if w.get("bls"):
            eintrag["bls"] = w["bls"]
            eintrag["art"] = w["art"]
        aus.append(eintrag)
    return aus


def _naechste_periode(datum: str | None, w: dict) -> str | None:
    if not datum or w["art"] == "stand" and w["reihe"] in ("A191RL1Q225SBEA", "ICSA"):
        return None
    j, m = int(datum[:4]), int(datum[5:7]) + 1
    if m > 12:
        j, m = j + 1, 1
    return f"{j:04d}-{m:02d}"


# ---------------------------------------------------------------- Termine bauen

def _id(*teile) -> str:
    return "-".join(str(t) for t in teile)


def konjunktur(heute: dt.date, cache: Path, prognosen: dict | None = None) -> list[dict]:
    """US-Statistiken aus dem FRED-Kalender. Leer ohne FRED_API_KEY und ohne Cache."""
    ab, bis = heute - dt.timedelta(days=VORLAUF), heute + dt.timedelta(days=NACHLAUF)
    fassungen: dict[str, dict] = {}
    aus = []
    for r in KONJUNKTUR:
        antwort = hole_fred("release/dates", {"release_id": r["release"], "realtime_start": ab.isoformat(), "realtime_end": "9999-12-31",
                                               "include_release_dates_with_no_data": "true", "sort_order": "asc", "limit": 200},
                            cache, f"termine-{r['release']}", heute)
        tage = [t for t in lies_termine(antwort) if ab <= t <= bis]
        if not tage:
            continue
        for w in r["werte"]:
            if w["reihe"] not in fassungen:
                beob = hole_fred("series/observations", {"series_id": w["reihe"], "realtime_start": ab.isoformat(), "realtime_end": "9999-12-31",
                                                         "observation_start": (heute - dt.timedelta(days=800)).isoformat(), "limit": 100000},
                                 cache, f"reihe-{w['reihe']}", heute)
                fassungen[w["reihe"]] = lies_fassungen((beob or {}).get("observations"))
        for tag in tage:
            werte = werte_zum_termin(r["werte"], fassungen, tag, heute)
            for w in werte:
                p = (prognosen or {}).get(w["id"], {}).get(tag.isoformat())
                if p is not None:
                    w["prog"] = _runde(p, w["dez"])
            aus.append({"id": _id(r["id"], tag), "gruppe": r["id"], "t": minute(tag, *r["zeit"], NEW_YORK), "tag": tag.isoformat(),
                        "art": "konjunktur", "land": "US", "w": "USD", "titel": r["titel"], "wichtig": r["wichtig"],
                        "info": r["info"], "quelle": r["quelle"], "link": r["link"], "werte": werte})
    return aus


def notenbanken(heute: dt.date, cache: Path) -> list[dict]:
    ab, bis = heute - dt.timedelta(days=VORLAUF), heute + dt.timedelta(days=NACHLAUF)
    aus = []
    for bank, liste, zeit, zone, pk, land, w in (
            ("fed", FOMC, (14, 0), NEW_YORK, (14, 30), "US", "USD"),
            ("ezb", EZB, (14, 15), FRANKFURT, (14, 45), "EU", "EUR")):
        spez = NOTENBANK_REIHEN[bank]
        beob = hole_fred("series/observations", {"series_id": spez["reihe"], "realtime_start": ab.isoformat(), "realtime_end": "9999-12-31",
                                                 "observation_start": (heute - dt.timedelta(days=400)).isoformat(), "limit": 100000},
                         cache, f"reihe-{spez['reihe']}", heute)
        fassungen = lies_fassungen((beob or {}).get("observations"))
        for d in liste:
            tag = dt.date.fromisoformat(d)
            if not ab <= tag <= bis:
                continue
            reihe_vor = stand_am(fassungen, (tag - dt.timedelta(days=1)).isoformat() if tag <= heute else heute.isoformat())
            vor = next((wert for datum, wert, _ in reversed(reihe_vor) if datum < d), None)
            # Neuer Satz gilt bei der Fed ab dem Folgetag, bei der EZB ab dem Mittwoch der Folgewoche
            gilt_ab = (tag + dt.timedelta(days=1 if bank == "fed" else 6)).isoformat()
            ist = next((wert for datum, wert, _ in stand_am(fassungen, heute.isoformat()) if datum >= gilt_ab), None) if tag < heute else None
            wert = {k: spez[k] for k in ("id", "kurz", "einheit", "dez", "gut")} | {"ist": ist, "prog": None, "vor": vor, "periode": None}
            if bank == "fed":
                titel, info, link, quelle = ("Fed-Zinsentscheid", "Zinsentscheidung des Offenmarktausschusses (FOMC)"
                                             + (", mit neuen Projektionen der Mitglieder." if d in FOMC_PROJEKTIONEN else "."),
                                             "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm", "Federal Reserve")
            else:
                titel, info, link, quelle = ("EZB-Zinsentscheid", "Geldpolitische Sitzung des EZB-Rats.",
                                             "https://www.ecb.europa.eu/press/calendars/mgcgc/html/index.en.html", "Europäische Zentralbank")
            aus.append({"id": _id(bank, d), "gruppe": bank, "t": minute(tag, *zeit, zone), "tag": d, "art": "notenbank", "land": land, "w": w,
                        "titel": titel, "wichtig": 3, "info": info, "quelle": quelle, "link": link, "werte": [wert]})
            aus.append({"id": _id(bank, "pk", d), "gruppe": bank + "_pk", "t": minute(tag, *pk, zone), "tag": d, "art": "notenbank", "land": land,
                        "w": w, "titel": ("Fed" if bank == "fed" else "EZB") + "-Pressekonferenz", "wichtig": 3,
                        "info": "Fragen an die Notenbankspitze; Aussagen zum weiteren Kurs bewegen oft stärker als der Entscheid selbst.",
                        "quelle": quelle, "link": link, "werte": []})
    return aus


def wiederkehrend(heute: dt.date) -> list[dict]:
    """Planmäßige Wochentermine im Kalenderfenster (ohne Ist-Werte)."""
    aus = []
    tag = heute - dt.timedelta(days=VORLAUF)
    while tag <= heute + dt.timedelta(days=NACHLAUF):
        for r in WIEDERKEHREND:
            if tag.weekday() == r["wtag"]:
                aus.append({"id": _id(r["id"], tag), "gruppe": r["id"], "t": minute(tag, *r["zeit"], NEW_YORK), "tag": tag.isoformat(),
                            "art": "konjunktur", "land": r["land"], "w": r["w"], "titel": r["titel"], "wichtig": r["wichtig"], "info": r["info"],
                            "quelle": r["quelle"], "link": r["link"], "planmaessig": True, "werte": []})
        tag += dt.timedelta(days=1)
    return aus


def quartalszahlen(aktien: list[dict], heute: dt.date) -> list[dict]:
    bis = heute + dt.timedelta(days=NACHLAUF)
    aus = []
    for a in aktien:
        d = a.get("naechste_zahlen")
        if not d or not heute - dt.timedelta(days=VORLAUF) <= d <= bis:
            continue
        e = a.get("erwartung") or {}
        werte = []
        eps = e.get("eps") if e.get("eps") is not None else e.get("finnhub_eps")
        if eps is not None or e.get("eps_vorjahr") is not None:
            werte.append({"id": "eps", "kurz": "Gewinn je Aktie", "einheit": a.get("waehrung") or "", "dez": 2, "gut": 1,
                          "ist": None, "prog": _runde(eps, 2), "vor": _runde(e.get("eps_vorjahr"), 2), "periode": None, "vor_text": "Vorjahresquartal"})
        umsatz = e.get("umsatz") if e.get("umsatz") is not None else e.get("finnhub_umsatz")
        if umsatz is not None or e.get("umsatz_vorjahr") is not None:
            werte.append({"id": "umsatz", "kurz": "Umsatz", "einheit": "Mrd. " + (a.get("waehrung") or ""), "dez": 2, "gut": 1, "ist": None,
                          "prog": _runde(umsatz / 1e9, 2) if umsatz else None,
                          "vor": _runde(e["umsatz_vorjahr"] / 1e9, 2) if e.get("umsatz_vorjahr") else None, "periode": None, "vor_text": "Vorjahresquartal"})
        from .render import slug
        aus.append({"id": _id("zahlen", a["symbol"], d), "gruppe": "zahlen", "t": None, "tag": d.isoformat(), "art": "zahlen",
                    "land": _land(a), "w": a.get("waehrung") or "", "titel": f"Quartalszahlen {a['name']}", "wichtig": 2,
                    "info": "Uhrzeit meist vor Börsenbeginn oder nach Börsenschluss; genaue Zeit kommt mit Finnhub.",
                    "quelle": "Unternehmen", "link": None, "symbol": a["symbol"], "slug": slug(a["symbol"]), "finnhub": a.get("finnhub"),
                    "werte": werte})
    return aus


def _land(a: dict) -> str:
    s = a.get("symbol", "")
    for endung, land in ((".DE", "DE"), (".HK", "HK"), (".PA", "FR"), (".AS", "NL"), (".L", "GB"), (".SW", "CH"), (".T", "JP"), (".MI", "IT")):
        if s.upper().endswith(endung):
            return land
    return "US"


# ---------------------------------------------------------------- Andere Länder (optional, mit Schlüssel)

TE_LAENDER = {"Euro Area": ("EU", "EUR"), "Germany": ("DE", "EUR"), "United Kingdom": ("GB", "GBP"), "Japan": ("JP", "JPY"),
              "China": ("CN", "CNY"), "Switzerland": ("CH", "CHF")}
FMP_LAENDER = {"EU": ("EU", "EUR"), "EZ": ("EU", "EUR"), "DE": ("DE", "EUR"), "GB": ("GB", "GBP"), "UK": ("GB", "GBP"), "JP": ("JP", "JPY"),
               "CN": ("CN", "CNY"), "CH": ("CH", "CHF")}


def _zahl(x):
    from .wirtschaft import _zahl as z
    return z(x)


def lies_te_kalender(eintraege: list[dict]) -> list[dict]:
    """Trading-Economics-Kalender (ohne USA, die kommen aus FRED) → Termine."""
    aus = []
    for e in eintraege or []:
        land = TE_LAENDER.get(e.get("Country"))
        if not land or not e.get("Date") or int(e.get("Importance") or 1) < 2:
            continue
        zeit = dt.datetime.fromisoformat(str(e["Date"]).replace("Z", "")).replace(tzinfo=UTC)
        einheit = str(e.get("Unit") or "").strip()
        wert = {"id": "wert", "kurz": e.get("Category") or "Wert", "einheit": einheit, "dez": 1, "gut": 1,
                "ist": _zahl(e.get("Actual")), "prog": _zahl(e.get("Forecast")), "vor": _zahl(e.get("Previous")), "periode": e.get("Reference")}
        aus.append({"id": _id("te", e.get("CalendarId") or e["Date"]), "gruppe": "te", "t": int(zeit.timestamp() // 60), "tag": zeit.date().isoformat(),
                    "art": "konjunktur", "land": land[0], "w": land[1], "titel": e.get("Event") or e.get("Category"), "wichtig": int(e["Importance"]),
                    "info": "", "quelle": e.get("Source") or "Trading Economics", "link": None, "werte": [wert]})
    return aus


def lies_fmp_kalender(eintraege: list[dict]) -> list[dict]:
    stufe = {"high": 3, "medium": 2, "low": 1}
    aus = []
    for e in eintraege or []:
        land = FMP_LAENDER.get(str(e.get("country", "")).upper())
        w = stufe.get(str(e.get("impact", "")).lower(), 1)
        if not land or w < 2 or not e.get("date"):
            continue
        zeit = dt.datetime.fromisoformat(str(e["date"]).replace(" ", "T")).replace(tzinfo=UTC)
        wert = {"id": "wert", "kurz": "Wert", "einheit": str(e.get("unit") or ""), "dez": 1, "gut": 1,
                "ist": _zahl(e.get("actual")), "prog": _zahl(e.get("estimate")), "vor": _zahl(e.get("previous")), "periode": None}
        aus.append({"id": _id("fmp", land[0], e["date"], e.get("event")), "gruppe": "fmp", "t": int(zeit.timestamp() // 60),
                    "tag": zeit.date().isoformat(), "art": "konjunktur", "land": land[0], "w": land[1], "titel": e.get("event"), "wichtig": w,
                    "info": "", "quelle": "Financial Modeling Prep", "link": None, "werte": [wert]})
    return aus


def ausland(heute: dt.date, cache: Path) -> tuple[list[dict], str | None]:
    ab, bis = heute - dt.timedelta(days=VORLAUF), heute + dt.timedelta(days=NACHLAUF)
    datei = cache / "ausland.json"
    try:
        if os.environ.get("TRADINGECONOMICS_API_KEY"):
            k = urllib.parse.quote(os.environ["TRADINGECONOMICS_API_KEY"])
            laender = ",".join(urllib.parse.quote(x.lower()) for x in TE_LAENDER)
            neu = lies_te_kalender(_json(f"https://api.tradingeconomics.com/calendar/country/{laender}/{ab}/{bis}?c={k}&f=json"))
            quelle = "Trading Economics"
        elif os.environ.get("FMP_API_KEY"):
            neu = lies_fmp_kalender(_json("https://financialmodelingprep.com/stable/economic-calendar?" + urllib.parse.urlencode(
                {"from": ab.isoformat(), "to": bis.isoformat(), "apikey": os.environ["FMP_API_KEY"]})))
            quelle = "Financial Modeling Prep"
        else:
            return [], None
        cache.mkdir(parents=True, exist_ok=True)
        datei.write_text(json.dumps({"quelle": quelle, "termine": neu}), encoding="utf-8")
        return neu, quelle
    except Exception as exc:  # noqa: BLE001
        log.warning("Kalender anderer Länder: %s – nutze den Cache", exc)
        if datei.exists():
            alt = json.loads(datei.read_text(encoding="utf-8"))
            return alt["termine"], alt["quelle"]
        return [], None


def baue(heute: dt.date, aktien: list[dict], cache: Path) -> dict:
    """Alle Termine für daten/kalender.json."""
    from . import wirtschaft
    prognosen, pquelle = {}, None
    if os.environ.get("TRADINGECONOMICS_API_KEY") or os.environ.get("FMP_API_KEY"):
        try:
            prognosen, pquelle = wirtschaft.hole_prognosen(heute - dt.timedelta(days=VORLAUF), heute + dt.timedelta(days=NACHLAUF), cache)
        except Exception as exc:  # noqa: BLE001
            log.warning("Prognosen für den Kalender: %s", exc)
    termine, quellen = [], []
    for name, f in (("US-Statistiken (FRED)", lambda: konjunktur(heute, cache, prognosen)),
                    ("Notenbanken", lambda: notenbanken(heute, cache)),
                    ("Wochentermine (EIA, CFTC)", lambda: wiederkehrend(heute)),
                    ("Quartalszahlen", lambda: quartalszahlen(aktien, heute))):
        try:
            neu = f()
            termine += neu
            if neu:
                quellen.append(name)
        except Exception as exc:  # noqa: BLE001 – ein Teil darf fehlen
            log.warning("Kalender %s: %s", name, exc)
    fremd, fquelle = ausland(heute, cache)
    termine += fremd
    if fquelle:
        quellen.append(f"andere Länder ({fquelle})")
    termine.sort(key=lambda e: (e["tag"], e["t"] if e["t"] is not None else -1, -e["wichtig"]))
    return {"stand": dt.datetime.now(UTC).isoformat(timespec="seconds"), "heute": heute.isoformat(), "demo": False,
            "fred": bool(os.environ.get("FRED_API_KEY")), "prognose_quelle": pquelle, "quellen": quellen, "termine": termine}


# ---------------------------------------------------------------- Live: Ist-Werte direkt von der BLS (über python live.py)

def bls_reihen(termin: dict) -> list[str]:
    return sorted({w["bls"] for w in termin.get("werte") or [] if w.get("bls")})


def lies_bls(antwort: dict) -> dict[str, list[tuple[str, float]]]:
    """BLS-Antwort → {Reihe: [(JJJJ-MM, Wert), …] aufsteigend}, ohne Jahresdurchschnitte (M13)."""
    aus = {}
    for s in ((antwort or {}).get("Results") or {}).get("series") or []:
        punkte = []
        for d in s.get("data") or []:
            p = str(d.get("period", ""))
            if not p.startswith("M") or p == "M13":
                continue
            try:
                punkte.append((f"{int(d['year']):04d}-{int(p[1:]):02d}", float(str(d["value"]).replace(",", ""))))
            except (KeyError, ValueError):
                continue
        aus[s.get("seriesID")] = sorted(punkte)
    return aus


def bls_wert(punkte: list[tuple[str, float]], art: str, periode: str) -> float | None:
    """Kennzahl für die erwartete Periode, sonst None (Daten noch nicht da)."""
    werte = dict(punkte)
    if periode not in werte:
        return None
    j, m = int(periode[:4]), int(periode[5:7])
    vormonat = f"{j - (m == 1):04d}-{12 if m == 1 else m - 1:02d}"
    if art == "jahr":
        alt = werte.get(f"{j - 1:04d}-{m:02d}")
        return (werte[periode] / alt - 1) * 100 if alt else None
    if art == "monat":
        return (werte[periode] / werte[vormonat] - 1) * 100 if werte.get(vormonat) else None
    if art == "diff":
        return werte[periode] - werte[vormonat] if vormonat in werte else None
    return werte[periode]


def hole_bls(reihen: list[str], jahr: int) -> dict:
    schluessel = os.environ.get("BLS_API_KEY")
    url = "https://api.bls.gov/publicAPI/" + ("v2" if schluessel else "v1") + "/timeseries/data/"
    nutzlast = {"seriesid": reihen, "startyear": str(jahr - 1), "endyear": str(jahr)}
    if schluessel:
        nutzlast["registrationkey"] = schluessel
    return lies_bls(_json(url, json.dumps(nutzlast).encode(), {"Content-Type": "application/json"}))


def ist_eintragen(termin: dict, daten: dict) -> bool:
    """Trägt live geholte Ist-Werte ein. True, wenn alle Werte mit BLS-Reihe gefüllt sind."""
    fertig = True
    for w in termin.get("werte") or []:
        if not w.get("bls") or w.get("ist") is not None:
            continue
        x = bls_wert(daten.get(w["bls"]) or [], w.get("art", "stand"), w.get("periode") or "")
        if x is None:
            fertig = False
            continue
        w["ist"] = round(x, w["dez"])
        w["ist_quelle"] = "BLS live"
    return fertig


# ---------------------------------------------------------------- Live: Quartalszahlen über Finnhub (über python live.py)

ZAHLEN_ZEIT = {"bmo": (7, 0), "amc": (16, 5), "dmh": (12, 0)}  # vor Börsenbeginn, nach Börsenschluss, während der Sitzung (New York)


def zahlen_eintragen(termin: dict, liste: list[dict]) -> None:
    """Finnhub-Kalender (/calendar/earnings) → Uhrzeit, Erwartung und Ergebnis in einen Zahlentermin eintragen."""
    passend = [e for e in liste or [] if str(e.get("symbol", "")).upper() == str(termin.get("finnhub", "")).upper() and e.get("date")]
    if not passend:
        return
    ziel = dt.date.fromisoformat(termin["tag"])
    e = min(passend, key=lambda x: abs((dt.date.fromisoformat(x["date"]) - ziel).days))
    tag = dt.date.fromisoformat(e["date"])
    termin["tag"] = tag.isoformat()
    zeit = ZAHLEN_ZEIT.get(str(e.get("hour") or "").lower())
    termin["t"] = minute(tag, *zeit, NEW_YORK) if zeit else None
    termin["zeit_ca"] = bool(zeit)
    termin["stunde"] = e.get("hour") or None
    werte = {w["id"]: w for w in termin.setdefault("werte", [])}
    for wid, kurz, ist, prog, teiler, einheit in (("eps", "Gewinn je Aktie", e.get("epsActual"), e.get("epsEstimate"), 1, termin.get("w") or ""),
                                                  ("umsatz", "Umsatz", e.get("revenueActual"), e.get("revenueEstimate"), 1e9, "Mrd. " + (termin.get("w") or ""))):
        if ist is None and prog is None:
            continue
        w = werte.get(wid)
        if not w:
            w = {"id": wid, "kurz": kurz, "einheit": einheit, "dez": 2, "gut": 1, "ist": None, "prog": None, "vor": None, "periode": None}
            termin["werte"].append(w)
        if prog is not None:
            w["prog"] = round(float(prog) / teiler, 2)
        if ist is not None:
            w["ist"], w["ist_quelle"] = round(float(ist) / teiler, 2), "Finnhub"


# ---------------------------------------------------------------- Demo

def demo(heute: dt.date, aktien: list[dict]) -> dict:
    """Plausibler Kalender ohne Netz. Die Seite verschiebt Demo-Termine auf die aktuelle Woche."""
    import random
    rng = random.Random(heute.toordinal())
    montag = heute - dt.timedelta(days=heute.weekday())
    termine = []

    def tag_der_woche(woche: int, wtag: int) -> dt.date:
        return montag + dt.timedelta(days=7 * woche + wtag)

    def wert(spez, vor, prog, ist, **extra):
        return {k: spez[k] for k in ("id", "kurz", "einheit", "dez", "gut")} | {"ist": ist, "prog": prog, "vor": vor, "periode": None} | extra

    def neu(r, tag, werte, zeit=None, zone=NEW_YORK):
        termine.append({"id": _id(r["id"], tag), "gruppe": r["id"], "t": minute(tag, *(zeit or r["zeit"]), zone), "tag": tag.isoformat(),
                        "art": "konjunktur", "land": "US", "w": "USD", "titel": r["titel"], "wichtig": r["wichtig"], "info": r["info"],
                        "quelle": r["quelle"], "link": r["link"], "werte": werte})

    basis = {"us_cpi_j": 2.9, "us_cpi_m": 0.3, "us_kern_j": 3.0, "us_kern_m": 0.3, "us_nfp": 140, "us_alq": 4.3, "us_lohn_m": 0.3,
             "us_bip": 1.8, "us_pce_j": 2.7, "us_kpce_j": 2.9, "us_kpce_m": 0.2, "us_handel_m": 0.4, "us_ppi_m": 0.2, "us_jolts": 7150,
             "us_antraege": 228, "us_indpro_m": 0.2}
    plan = {"us_cpi": (0, 2), "us_ppi": (0, 3), "us_handel": (1, 1), "us_jolts": (1, 2), "us_arbeit": (1, 4), "us_bip": (2, 3), "us_pce": (2, 4),
            "us_industrie": (0, 1)}
    for r in KONJUNKTUR:
        tage = [tag_der_woche(w, 3) for w in range(-1, 6)] if r["id"] == "us_antraege" else \
               [tag_der_woche(plan[r["id"]][0] + k * 4, plan[r["id"]][1]) for k in (-1, 0, 1)]
        for tag in tage:
            werte = []
            for s in r["werte"]:
                vor = basis[s["id"]]
                streu = 0.1 if s["einheit"] == "%" else (40 if s["id"] == "us_nfp" else (180 if s["id"] == "us_jolts" else 9))
                prog = round(vor + rng.gauss(0, streu * 0.5), s["dez"])
                ist = round(prog + rng.choice([-1, -1, 0, 0, 0, 1, 1, 2]) * streu * 0.6, s["dez"]) if tag <= heute else None
                werte.append(wert(s, vor, prog, ist))
                if ist is not None:
                    basis[s["id"]] = ist
            neu(r, tag, werte)
    for bank, wtag, zeit, zone, land, w, satz in (("fed", 2, (14, 0), NEW_YORK, "US", "USD", 3.75), ("ezb", 3, (14, 15), FRANKFURT, "EU", "EUR", 2.0)):
        tag = tag_der_woche(1 if bank == "fed" else 2, wtag)
        spez = NOTENBANK_REIHEN[bank]
        titel = "Fed-Zinsentscheid" if bank == "fed" else "EZB-Zinsentscheid"
        termine.append({"id": _id(bank, tag), "gruppe": bank, "t": minute(tag, *zeit, zone), "tag": tag.isoformat(), "art": "notenbank", "land": land, "w": w,
                        "titel": titel, "wichtig": 3, "info": "Demo-Termin.", "quelle": "Demo", "link": None,
                        "werte": [wert(spez, satz, satz - 0.25 if bank == "fed" else satz, None)]})
        pk = (zeit[0], zeit[1] + 30)
        termine.append({"id": _id(bank, "pk", tag), "gruppe": bank + "_pk", "t": minute(tag, *pk, zone), "tag": tag.isoformat(), "art": "notenbank",
                        "land": land, "w": w, "titel": titel.split("-")[0] + "-Pressekonferenz", "wichtig": 3, "info": "Demo-Termin.", "quelle": "Demo",
                        "link": None, "werte": []})
    for titel, land, w, wtag, zeit, wichtig, kurz, vor in (
            ("ifo-Geschäftsklima", "DE", "EUR", 0, (10, 0), 2, "Index", 87.9), ("ZEW-Konjunkturerwartungen", "DE", "EUR", 1, (11, 0), 2, "Saldo", 39.3),
            ("Eurozone-Inflation (Schnellschätzung)", "EU", "EUR", 4, (11, 0), 3, "HVPI j/j", 2.2),
            ("Britische Verbraucherpreise", "GB", "GBP", 2, (8, 0), 3, "CPI j/j", 3.8)):
        for woche in (0, 1):
            tag = tag_der_woche(woche, wtag)
            prog = round(vor + rng.gauss(0, 0.2), 1)
            ist = round(prog + rng.choice([-0.2, -0.1, 0, 0.1, 0.2]), 1) if tag <= heute else None
            termine.append({"id": _id("demo", titel, tag), "gruppe": "demo", "t": minute(tag, *zeit, FRANKFURT if land != "GB" else ZoneInfo("Europe/London")),
                            "tag": tag.isoformat(), "art": "konjunktur", "land": land, "w": w, "titel": titel, "wichtig": wichtig, "info": "Demo-Termin.",
                            "quelle": "Demo", "link": None,
                            "werte": [{"id": "wert", "kurz": kurz, "einheit": "%" if "j/j" in kurz else "", "dez": 1, "gut": 1, "ist": ist, "prog": prog, "vor": vor, "periode": None}]})
    # weitere Demo-Termine über jeden Wochentag, damit „anstehend“ immer etwas zeigt
    for titel, land, w, wtag, zeit, zone, wichtig, kurz, vor, einheit in (
            ("Rede eines Fed-Mitglieds", "US", "USD", 0, (12, 0), NEW_YORK, 2, None, None, ""),
            ("US-Verbrauchervertrauen (Conference Board)", "US", "USD", 1, (10, 0), NEW_YORK, 2, "Index", 98.7, ""),
            ("Japan Handelsbilanz", "JP", "JPY", 2, (8, 50), ZoneInfo("Asia/Tokyo"), 1, "Mrd. Yen", -294.0, ""),
            ("EZB-Präsidentin spricht", "EU", "EUR", 2, (15, 0), FRANKFURT, 2, None, None, ""),
            ("Australien Arbeitsmarkt", "AU", "AUD", 3, (11, 30), ZoneInfo("Australia/Sydney"), 2, "Arbeitslosenquote", 4.2, "%"),
            ("Japan Verbraucherpreise Tokio", "JP", "JPY", 4, (8, 30), ZoneInfo("Asia/Tokyo"), 2, "CPI j/j", 2.1, "%"),
            ("Uni Michigan Konsumklima", "US", "USD", 4, (10, 0), NEW_YORK, 2, "Index", 55.1, ""),
            ("China Industrieproduktion", "CN", "CNY", 0, (10, 0), ZoneInfo("Asia/Shanghai"), 2, "j/j", 5.6, "%")):
        for woche in (-1, 0, 1, 2):
            tag = tag_der_woche(woche, wtag)
            werte = []
            if kurz:
                prog = round(vor + rng.gauss(0, abs(vor) * 0.02 + 0.1), 1)
                ist = round(prog + rng.choice([-0.3, -0.1, 0, 0.1, 0.3]), 1) if tag <= heute else None
                werte = [{"id": "wert", "kurz": kurz, "einheit": einheit, "dez": 1, "gut": 1, "ist": ist, "prog": prog, "vor": vor, "periode": None}]
            termine.append({"id": _id("demo", titel, tag), "gruppe": "demo", "t": minute(tag, *zeit, zone), "tag": tag.isoformat(), "art": "konjunktur",
                            "land": land, "w": w, "titel": titel, "wichtig": wichtig, "info": "Demo-Termin.", "quelle": "Demo", "link": None, "werte": werte})
    termine += wiederkehrend(heute)
    termine += quartalszahlen(aktien, heute)
    termine.sort(key=lambda e: (e["tag"], e["t"] if e["t"] is not None else -1, -e["wichtig"]))
    return {"stand": dt.datetime.now(UTC).isoformat(timespec="seconds"), "heute": heute.isoformat(), "demo": True, "fred": False,
            "prognose_quelle": "Demo-Daten", "quellen": ["Demo-Daten"], "termine": termine}
