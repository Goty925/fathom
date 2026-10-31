"""Eulerpool als Hauptdatenquelle (https://eulerpool.com/developers).

Kostenloser Schlüssel: 100.000 Abrufe im Monat. Als Umgebungsvariable EULERPOOL_API_KEY setzen
(bei GitHub als Secret). Ohne Schlüssel oder bei Fehlern springt Yahoo Finance ein, Wert für Wert.

Abgerufen werden (Kennung bevorzugt per ISIN):
  /charting/ohlcv/{id}            Tageskurse
  /equity/profile/{id}            Name, Sektor, Land, Währung, Börsenwert (Beträge in Millionen)
  /equity/estimates/{id}          Analystenschätzungen je Geschäftsjahr (EPS, Umsatz, EBIT)
  /equity/price-target/{id}       Kursziel-Konsens
  /equity/peers/{id}              Vergleichsunternehmen
  /equity/valuation-history/{id}  Bewertungshistorie (KGV, KUV, KEV) und Jahreswerte

Nicht alle Antwortfelder sind öffentlich dokumentiert. Die Auswertung ist deshalb tolerant
(mehrere mögliche Feldnamen). Zur Kontrolle mit eigenem Schlüssel:
    python -m src.eulerpool US00724F1012
zeigt die Rohantworten aller Endpunkte.
"""
from __future__ import annotations

import datetime as dt
import json
import logging
import math
import os
import sys
import urllib.error
import urllib.request

from . import netz

log = logging.getLogger(__name__)
BASIS_URL = os.environ.get("EULERPOOL_BASIS_URL", "https://api.eulerpool.com/api/1")


def schluessel() -> str | None:
    return os.environ.get("EULERPOOL_API_KEY") or None


def _get(pfad: str, timeout: float = 20):
    req = urllib.request.Request(f"{BASIS_URL}{pfad}", headers={
        "Authorization": f"Bearer {schluessel()}", "Accept": "application/json", "User-Agent": "fathom-screening/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:  # noqa: S310 – feste https-Adresse
        return json.loads(netz.lies(r).decode("utf-8"))


def _f(x):
    try:
        x = float(x)
    except (TypeError, ValueError):
        return None
    return None if math.isnan(x) or math.isinf(x) else x


def feld(d, *namen, default=None):
    """Ersten vorhandenen Wert unter mehreren möglichen Feldnamen holen (Groß/Klein egal)."""
    if not isinstance(d, dict):
        return default
    klein = {k.lower(): v for k, v in d.items()}
    for n in namen:
        v = klein.get(n.lower())
        if v not in (None, ""):
            return v
    return default


# ---------------------------------------------------------------- Auswertung je Endpunkt

def kurse(roh) -> "pd.Series | None":
    import pandas as pd
    if not isinstance(roh, dict) or not roh.get("t") or not roh.get("c"):
        return None
    index = pd.to_datetime(roh["t"], unit="s").normalize()
    s = pd.Series([_f(x) for x in roh["c"]], index=index, dtype=float).dropna()
    s = s[~s.index.duplicated(keep="last")].sort_index()
    return s if len(s) > 20 else None


def ohlc(roh) -> "pd.DataFrame | None":
    """Tageskurse mit Eröffnung, Hoch und Tief (fehlen sie, stehen dort Schlusskurse)."""
    import pandas as pd
    c = kurse(roh)
    if c is None:
        return None
    index = pd.to_datetime(roh["t"], unit="s").normalize()
    df = pd.DataFrame({"Close": [_f(x) for x in roh["c"]]}, index=index, dtype=float)
    for k, s in (("o", "Open"), ("h", "High"), ("l", "Low")):
        werte = roh.get(k)
        df[s] = [_f(x) for x in werte] if isinstance(werte, list) and len(werte) == len(df) else df["Close"]
    df = df.dropna(subset=["Close"])
    df = df[~df.index.duplicated(keep="last")].sort_index()
    return df[["Open", "High", "Low", "Close"]]


def profil(roh) -> dict:
    """Profil; Beträge laut Doku in Millionen."""
    if isinstance(roh, list):
        roh = roh[0] if roh else {}
    mcap = _f(feld(roh, "marketCap", "market_cap", "marketcap", "mcap", "marktkapitalisierung"))
    return {
        "name": feld(roh, "name", "companyName", "company_name", "longName"),
        "isin": feld(roh, "isin"),
        "waehrung": feld(roh, "currency", "waehrung"),
        "boersenwert": mcap * 1e6 if mcap else None,
        "sektor": feld(roh, "sector", "sektor", "gicsSector"),
        "branche": feld(roh, "industry", "branche", "subIndustry"),
        "land": feld(roh, "country", "land"),
        "beschreibung": feld(roh, "description", "beschreibung", "longDescription"),
        "website": feld(roh, "website", "url", "weburl"),
        "mitarbeiter": feld(roh, "employees", "fullTimeEmployees", "mitarbeiter"),
        "boerse": feld(roh, "exchange", "exchangeShortName"),
        "ticker": feld(roh, "ticker", "symbol"),
    }


def schaetzungen(roh, heute: dt.date | None = None) -> list[dict]:
    """Jahresschätzungen: laufendes und nächstes Geschäftsjahr im Format von fetch._schaetzungen."""
    heute = heute or dt.date.today()
    if not isinstance(roh, list):
        return []
    zeilen = []
    for e in roh:
        jahr = feld(e, "year")
        try:
            jahr = int(jahr)
        except (TypeError, ValueError):
            continue
        zeilen.append((jahr, e))
    zeilen.sort()
    aus = []
    for jahr, e in zeilen:
        if jahr < heute.year or len(aus) >= 2:
            continue
        aus.append({
            "periode": "Laufendes Geschäftsjahr" if not aus else "Nächstes Geschäftsjahr",
            "eps_mittel": _f(feld(e, "epsEstimate")), "eps_tief": _f(feld(e, "epsLow")), "eps_hoch": _f(feld(e, "epsHigh")),
            "analysten": _f(feld(e, "epsAnalysts")),
            "umsatz_mittel": _f(feld(e, "revenueEstimate")),
            "ebit_mittel": _f(feld(e, "ebitEstimate")),
            "quelle": "Eulerpool",
        })
    # Wachstum gegenüber dem Vorjahr aus den Schätzungen selbst
    vorjahre = {j: e for j, e in zeilen}
    for z, (jahr, _) in zip(aus, [(j, e) for j, e in zeilen if j >= heute.year][:2]):
        vor = vorjahre.get(jahr - 1)
        eps_vor = _f(feld(vor, "epsEstimate")) if vor else None
        ums_vor = _f(feld(vor, "revenueEstimate")) if vor else None
        z["eps_wachstum"] = z["eps_mittel"] / eps_vor - 1 if z["eps_mittel"] and eps_vor and eps_vor > 0 else None
        z["umsatz_wachstum"] = z["umsatz_mittel"] / ums_vor - 1 if z["umsatz_mittel"] and ums_vor and ums_vor > 0 else None
    return aus


def kursziel(roh) -> dict:
    if isinstance(roh, list):
        roh = roh[0] if roh else {}
    return {
        "mittel": _f(feld(roh, "targetMean", "mean", "targetConsensus", "consensus", "priceTargetAverage", "average")),
        "median": _f(feld(roh, "targetMedian", "median")),
        "hoch": _f(feld(roh, "targetHigh", "high", "priceTargetHigh")),
        "tief": _f(feld(roh, "targetLow", "low", "priceTargetLow")),
        "anzahl": _f(feld(roh, "numberOfAnalysts", "analysts", "count", "numberAnalysts")),
    }


def peers(roh) -> list[dict]:
    if not isinstance(roh, list):
        return []
    return [{"name": feld(p, "peer_name", "name"), "isin": feld(p, "peer_isin", "isin"), "ticker": feld(p, "ticker")}
            for p in roh if feld(p, "peer_name", "name")][:12]


def _jahresreihe(x) -> dict[int, float]:
    """{Jahr: Wert} aus einem Objekt {"2024": 1.2} oder einer Liste [{"period"/"year": …, "value": …}]."""
    aus = {}
    if isinstance(x, dict):
        for k, v in x.items():
            try:
                jahr = int(str(k)[:4])
            except ValueError:
                continue
            w = _f(v if not isinstance(v, dict) else feld(v, "value", "val", "wert"))
            if w is not None:
                aus[jahr] = w
    elif isinstance(x, list):
        for e in x:
            j = feld(e, "year", "period", "fiscal_year", "date")
            try:
                jahr = int(str(j)[:4])
            except (TypeError, ValueError):
                continue
            w = _f(feld(e, "value", "val", "wert"))
            if w is not None:
                aus[jahr] = w
    return aus


def bewertungshistorie(roh) -> dict:
    """KGV/KUV/KEV je Jahr und Jahreswerte für Gewinn, Umsatz, EBIT (soweit geliefert)."""
    if not isinstance(roh, dict):
        return {}
    vd = roh.get("valuationData")
    eintraege = vd if isinstance(vd, list) else [vd] if isinstance(vd, dict) else []
    multiples = {}
    for e in eintraege:
        try:
            jahr = int(str(feld(e, "period", "year"))[:4])
        except (TypeError, ValueError):
            continue
        multiples[jahr] = {"kgv": _f(feld(e, "kgv", "pe")), "kuv": _f(feld(e, "kuv", "ps")), "kev": _f(feld(e, "kev", "evEbit"))}
    return {"multiples": multiples, "gewinn": _jahresreihe(roh.get("earnings")),
            "umsatz": _jahresreihe(roh.get("revenue")), "ebit": _jahresreihe(roh.get("ebit"))}


# ---------------------------------------------------------------- Abruf

def hole(kennung: str, typ: str = "aktie") -> dict:
    """Alles, was Eulerpool für eine Kennung (ISIN oder Ticker) liefert. Leeres dict ohne Schlüssel."""
    if not schluessel() or not kennung:
        return {}
    aus = {"quelle": "Eulerpool"}

    def versuch(name, pfad, auswertung):
        try:
            aus[name] = auswertung(_get(pfad))
        except urllib.error.HTTPError as exc:
            log.info("Eulerpool %s für %s: HTTP %s", name, kennung, exc.code)
        except Exception as exc:  # noqa: BLE001 – Yahoo springt ein
            log.info("Eulerpool %s für %s: %s", name, kennung, exc)

    von = int((dt.datetime.now() - dt.timedelta(days=round(365.25 * 11) + 5)).timestamp())
    versuch("ohlc", f"/charting/ohlcv/{kennung}?resolution=D&from={von}", ohlc)
    if aus.get("ohlc") is not None:
        aus["kurse"] = aus["ohlc"]["Close"]
    if typ in ("aktie", "etf"):
        versuch("profil", f"/equity/profile/{kennung}?language=de", profil)
    if typ == "aktie":
        versuch("schaetzungen", f"/equity/estimates/{kennung}", schaetzungen)
        versuch("kursziel", f"/equity/price-target/{kennung}", kursziel)
        versuch("peers", f"/equity/peers/{kennung}", peers)
        versuch("bewertung", f"/equity/valuation-history/{kennung}", bewertungshistorie)
    return aus


if __name__ == "__main__":  # Diagnose: Rohantworten anzeigen
    k = sys.argv[1] if len(sys.argv) > 1 else "US00724F1012"
    if not schluessel():
        sys.exit("Bitte EULERPOOL_API_KEY setzen.")
    for pfad in (f"/charting/ohlcv/{k}?resolution=W", f"/equity/profile/{k}", f"/equity/estimates/{k}",
                 f"/equity/price-target/{k}", f"/equity/peers/{k}", f"/equity/valuation-history/{k}",
                 f"/equity/key-figures/{k}"):
        try:
            text = json.dumps(_get(pfad), ensure_ascii=False)
        except Exception as exc:  # noqa: BLE001
            text = f"FEHLER {exc}"
        print(f"\n=== {pfad}\n{text[:1500]}")
