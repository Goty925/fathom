"""Daten von Yahoo Finance abrufen (über die Bibliothek yfinance).

yfinance ist kostenlos, aber inoffiziell: Yahoo kann die Schnittstelle
jederzeit ändern. Deshalb ist jeder Abruf einzeln abgesichert. Fehlt ein
Wert, steht im Bericht "–" statt dass das ganze Programm abbricht.
"""
from __future__ import annotations

import datetime as dt
import logging
import math
import time

import pandas as pd

from . import netz

log = logging.getLogger(__name__)


# ---------------------------------------------------------------- Hilfen

def _safe(label: str, fn, default=None):
    """Führt fn() aus und liefert bei jedem Fehler den Standardwert."""
    try:
        value = fn()
    except Exception as exc:  # noqa: BLE001 – absichtlich breit, siehe Moduldoku
        log.warning("%s: nicht verfügbar (%s)", label, exc)
        return default
    if value is None:
        return default
    if isinstance(value, float) and math.isnan(value):
        return default
    return value


def _f(x):
    """In float umwandeln; NaN/None/Text → None."""
    try:
        x = float(x)
    except (TypeError, ValueError):
        return None
    return None if math.isnan(x) or math.isinf(x) else x


def _zeile(df: pd.DataFrame, *namen):
    """Erste vorhandene Zeile aus einer Yahoo-Tabelle (Namen variieren je Firma)."""
    for n in namen:
        if n in df.index:
            return df.loc[n]
    return None


def _spalte(df: pd.DataFrame, periode: str, *namen):
    if df is None or df.empty or periode not in df.index:
        return None
    for n in namen:
        for c in df.columns:
            if c.lower() == n.lower():
                return _f(df.at[periode, c])
    return None


# ---------------------------------------------------------------- Einzelteile

def _kgv_historie(ticker, jahre: int = 5) -> list[dict]:
    """Forward-KGV je Quartalsende der letzten `jahre` Jahre, älteste zuerst."""
    df = ticker.get_valuation_measures(freq="quarterly", periods=None)
    if df is None or df.empty or "Forward P/E" not in df.index:
        return []
    reihe = df.loc["Forward P/E"].drop(labels=["Current"], errors="ignore")
    punkte = []
    grenze = dt.date.today() - dt.timedelta(days=365 * jahre)
    for datum, wert in reihe.items():
        d = pd.to_datetime(datum, errors="coerce")
        w = _f(wert)
        if pd.isna(d) or w is None or w <= 0:  # negative KGVs (Verluste) sind nicht vergleichbar
            continue
        if d.date() >= grenze:
            punkte.append({"datum": d.date(), "wert": w})
    return sorted(punkte, key=lambda p: p["datum"])


def _quartale(ticker) -> list[dict]:
    """Umsatz, Gewinne, Marge und freier Cashflow je Quartal, älteste zuerst."""
    guv = ticker.quarterly_income_stmt
    cf = _safe("Cashflow", lambda: ticker.quarterly_cashflow, pd.DataFrame())
    if guv is None or guv.empty:
        return []
    umsatz = _zeile(guv, "Total Revenue", "Operating Revenue")
    netto = _zeile(guv, "Net Income", "Net Income Common Stockholders")
    operativ = _zeile(guv, "Operating Income", "EBIT")
    eps = _zeile(guv, "Diluted EPS", "Basic EPS")
    fcf = _zeile(cf, "Free Cash Flow") if isinstance(cf, pd.DataFrame) and not cf.empty else None

    quartale = []
    for spalte in sorted(guv.columns):
        def wert(reihe):
            return _f(reihe.get(spalte)) if reihe is not None else None
        q = {
            "datum": pd.Timestamp(spalte).date(),
            "umsatz": wert(umsatz),
            "nettogewinn": wert(netto),
            "operativer_gewinn": wert(operativ),
            "eps": wert(eps),
            "fcf": wert(fcf),
        }
        if q["umsatz"] is None and q["nettogewinn"] is None:
            continue  # Yahoo liefert manchmal leere Spalten
        quartale.append(q)
    return quartale[-8:]


def _eps_historie(ticker) -> list[dict]:
    """Gewinn je Aktie: Schätzung vs. tatsächlich, letzte Quartale."""
    df = ticker.earnings_history
    if df is None or df.empty:
        return []
    zeilen = []
    for datum, r in df.sort_index().iterrows():
        schaetzung, ist = _f(r.get("epsEstimate")), _f(r.get("epsActual"))
        ueberraschung = ist / schaetzung - 1 if ist is not None and schaetzung not in (None, 0) else None
        if schaetzung is not None and schaetzung < 0:
            ueberraschung = None  # bei Verlusterwartung ist der Prozentwert irreführend
        zeilen.append({"quartal": pd.Timestamp(datum).date(), "schaetzung": schaetzung, "ist": ist,
                       "ueberraschung": ueberraschung})
    return zeilen[-4:]


PERIODEN = {"0q": "Laufendes Quartal", "+1q": "Nächstes Quartal", "0y": "Laufendes Geschäftsjahr",
            "+1y": "Nächstes Geschäftsjahr"}


def _schaetzungen(ticker) -> list[dict]:
    eps = _safe("Gewinnschätzung", lambda: ticker.earnings_estimate, pd.DataFrame())
    ums = _safe("Umsatzschätzung", lambda: ticker.revenue_estimate, pd.DataFrame())
    trend = _safe("Schätzungstrend", lambda: ticker.eps_trend, pd.DataFrame())
    rev = _safe("Revisionen", lambda: ticker.eps_revisions, pd.DataFrame())
    zeilen = []
    for p, label in PERIODEN.items():
        z = {
            "periode": label,
            "eps_mittel": _spalte(eps, p, "avg"),
            "eps_tief": _spalte(eps, p, "low"),
            "eps_hoch": _spalte(eps, p, "high"),
            "eps_wachstum": _spalte(eps, p, "growth"),
            "analysten": _spalte(eps, p, "numberOfAnalysts"),
            "eps_vorjahr": _spalte(eps, p, "yearAgoEps"),
            "umsatz_mittel": _spalte(ums, p, "avg"),
            "umsatz_vorjahr": _spalte(ums, p, "yearAgoRevenue"),
            "umsatz_wachstum": _spalte(ums, p, "growth"),
            "eps_vor_90_tagen": _spalte(trend, p, "90daysAgo"),
            "hoch_30": _spalte(rev, p, "upLast30days"),
            "runter_30": _spalte(rev, p, "downLast30days"),
        }
        if any(v is not None for k, v in z.items() if k != "periode"):
            zeilen.append(z)
    return zeilen


def _jahreszahlen(ticker) -> list[dict]:
    """Geschäftsjahre (Yahoo liefert meist 4): Umsatz, Ergebnisgrößen, FCF, Schulden, Cash, Aktienzahl."""
    guv = ticker.income_stmt
    if guv is None or guv.empty:
        return []
    cf = _safe("Cashflow jährlich", lambda: ticker.cashflow, pd.DataFrame())
    bil = _safe("Bilanz jährlich", lambda: ticker.balance_sheet, pd.DataFrame())

    def wert(df, spalte, *namen):
        if not isinstance(df, pd.DataFrame) or df.empty or spalte not in df.columns:
            return None
        z = _zeile(df, *namen)
        return _f(z.get(spalte)) if z is not None else None

    jahre = []
    for spalte in sorted(guv.columns):
        j = {
            "jahr": pd.Timestamp(spalte).year, "ende": pd.Timestamp(spalte).date(),
            "umsatz": wert(guv, spalte, "Total Revenue", "Operating Revenue"),
            "bruttogewinn": wert(guv, spalte, "Gross Profit"),
            "ebit": wert(guv, spalte, "EBIT", "Operating Income"),
            "ebitda": wert(guv, spalte, "EBITDA", "Normalized EBITDA"),
            "nettogewinn": wert(guv, spalte, "Net Income", "Net Income Common Stockholders"),
            "eps": wert(guv, spalte, "Diluted EPS", "Basic EPS"),
            "fcf": wert(cf, spalte, "Free Cash Flow"),
            "schulden": wert(bil, spalte, "Total Debt"),
            "cash": wert(bil, spalte, "Cash And Cash Equivalents", "Cash Cash Equivalents And Short Term Investments"),
            "aktien": wert(bil, spalte, "Ordinary Shares Number", "Share Issued"),
            "dividende_je_aktie": None,
        }
        if j["umsatz"] is not None or j["nettogewinn"] is not None:
            jahre.append(j)
    return jahre


def _analysten_verteilung(ticker) -> dict | None:
    df = ticker.recommendations
    if df is None or df.empty:
        return None
    aktuell = df[df["period"] == "0m"] if "period" in df.columns else df.head(1)
    if aktuell.empty:
        return None
    r = aktuell.iloc[0]
    return {k: int(_f(r.get(k)) or 0) for k in ("strongBuy", "buy", "hold", "sell", "strongSell")}


def _naechste_zahlen(ticker) -> dt.date | None:
    cal = ticker.calendar or {}
    heute = dt.date.today()
    termine = [d for d in cal.get("Earnings Date", []) if d >= heute]
    return min(termine) if termine else None


def _json(url: str, timeout: float = 15, kopf: dict | None = None):
    import json
    import urllib.request
    req = urllib.request.Request(url, headers={"User-Agent": "fathom-screening/1.0", **(kopf or {})})
    with urllib.request.urlopen(req, timeout=timeout) as r:  # noqa: S310 – feste https-Adressen
        return json.loads(r.read(20 * 1024 * 1024).decode("utf-8"))


def finnhub_erwartung(symbol: str) -> dict | None:
    """Zweite Quelle für die Earnings-Erwartung: Finnhub-Kalender (kostenloser Schlüssel, nur US-Aktien).

    Den Schlüssel als Umgebungsvariable FINNHUB_API_KEY setzen (bei GitHub als Secret).
    """
    import os
    schluessel = os.environ.get("FINNHUB_API_KEY")
    if not schluessel or any(z in symbol for z in ".=^"):
        return None
    heute = dt.date.today()
    import urllib.parse
    url = (f"https://finnhub.io/api/v1/calendar/earnings?from={heute}&to={heute + dt.timedelta(days=120)}"
           f"&symbol={urllib.parse.quote(symbol)}")
    eintraege = (_json(url, kopf={"X-Finnhub-Token": schluessel}) or {}).get("earningsCalendar") or []
    if not eintraege:
        return None
    e = min(eintraege, key=lambda x: x.get("date") or "9999")
    return {"datum": e.get("date"), "eps": _f(e.get("epsEstimate")), "umsatz": _f(e.get("revenueEstimate"))}


def hole_leitzinsen(waehrungen: set[str]) -> dict[str, float]:
    """Aktuelle Leitzinsen je Währung (0.025 = 2,5 %) von der BIS, der Bank für Internationalen Zahlungsausgleich.

    Öffentliche Statistik ohne Schlüssel: https://data.bis.org/topics/CBPOL
    """
    import csv
    import io
    import urllib.request

    from .klassen import BIS_GEBIET
    gebiete = {BIS_GEBIET[w]: w for w in waehrungen if w in BIS_GEBIET}
    if not gebiete:
        return {}
    url = ("https://stats.bis.org/api/v1/data/WS_CBPOL/D." + "+".join(sorted(gebiete))
           + "/all?lastNObservations=1&format=csv")
    req = urllib.request.Request(url, headers={"User-Agent": "fathom-screening/1.0"})
    with urllib.request.urlopen(req, timeout=20) as r:  # noqa: S310
        text = netz.lies(r).decode("utf-8")
    zinsen = {}
    for zeile in csv.DictReader(io.StringIO(text)):
        w, wert = gebiete.get(zeile.get("REF_AREA")), _f(zeile.get("OBS_VALUE"))
        if w and wert is not None:
            zinsen[w] = wert / 100
    return zinsen


# ---------------------------------------------------------------- Hauptfunktion

def _isin_gueltig(x) -> str | None:
    import re
    return x if isinstance(x, str) and re.fullmatch(r"[A-Z]{2}[A-Z0-9]{9}[0-9]", x) else None


def hole_aktie(symbol: str, typ: str = "aktie", isin: str | None = None) -> dict:
    """Alle Rohdaten zu einem Kürzel. Erst Eulerpool (falls Schlüssel gesetzt), dann Yahoo für alles Fehlende."""
    import yfinance as yf

    from . import backtest, eulerpool

    t = yf.Ticker(symbol)
    info = _safe(f"{symbol} info", lambda: t.info, {}) or {}
    isin = _isin_gueltig(isin) or _isin_gueltig(info.get("isin")) or (
        _isin_gueltig(_safe(f"{symbol} ISIN", lambda: t.isin)) if typ in ("aktie", "etf") else None)
    ep = eulerpool.hole(isin or (symbol if typ in ("aktie", "etf") and not any(z in symbol for z in ".=^") else None), typ)
    quellen = {}
    kurse = ep.get("kurse")
    kurse_zweit = None
    if kurse is not None:
        quellen["Kurse"] = "Eulerpool"
        # Zweite Quelle nur zum Abgleich im Backtest (Datenprüfung), nicht für den Bericht
        zweit = _safe(f"{symbol} Abgleich Yahoo", lambda: t.history(period="10y", auto_adjust=True)["Close"], None)
        if zweit is not None and len(zweit) and zweit.index.tz is not None:
            zweit.index = zweit.index.tz_localize(None)
        kurse_zweit = zweit
    else:
        # Elf Jahre: zehn Jahre Backtest plus ein Jahr Vorlauf für 52-Wochen- und Momentum-Kriterien
        start = (dt.date.today() - dt.timedelta(days=round(365.25 * backtest.JAHRE) + 5)).isoformat()
        verlauf = _safe(f"{symbol} Kurshistorie", lambda: t.history(start=start, auto_adjust=True), pd.DataFrame())
        if verlauf is not None and isinstance(verlauf.index, pd.DatetimeIndex) and verlauf.index.tz is not None:
            verlauf.index = verlauf.index.tz_localize(None)
        kurse = verlauf["Close"] if verlauf is not None and "Close" in verlauf else pd.Series(dtype=float)
        ep["ohlc"] = verlauf
        quellen["Kurse"] = "Yahoo Finance"
    ep_profil = ep.get("profil") or {}

    daten = {
        "symbol": symbol,
        "isin": isin or ep_profil.get("isin"),
        "boerse": info.get("exchange") or ep_profil.get("boerse"),
        "name_yahoo": ep_profil.get("name") or info.get("shortName") or info.get("longName"),
        "waehrung": info.get("currency") or ep_profil.get("waehrung"),
        "finanzwaehrung": info.get("financialCurrency") or info.get("currency") or ep_profil.get("waehrung"),
        "boersenwert": ep_profil.get("boersenwert") or _f(info.get("marketCap")),
        "kurse": kurse,
        "ohlc": ep.get("ohlc"),
        "kurse_zweit": kurse_zweit,
        "quellen": quellen,
        "profil": {
            "beschreibung": ep_profil.get("beschreibung") or info.get("longBusinessSummary"),
            "sektor": ep_profil.get("sektor") or info.get("sector"),
            "branche": ep_profil.get("branche") or info.get("industry"),
            "land": ep_profil.get("land") or info.get("country"),
            "mitarbeiter": ep_profil.get("mitarbeiter") or info.get("fullTimeEmployees"),
            "website": ep_profil.get("website") or info.get("website"),
        },
    }
    quellen["Profil"] = "Eulerpool" if ep_profil.get("name") else "Yahoo Finance"
    if typ != "aktie":
        return daten  # ETFs, Währungen, Rohstoffe und Indizes haben keine KGVs, Quartalszahlen oder Kursziele

    ziele = _safe(f"{symbol} Kursziele", lambda: t.analyst_price_targets, {}) or {}
    ep_ziel = ep.get("kursziel") or {}
    if ep_ziel.get("mittel"):
        ziele = {"mean": ep_ziel["mittel"], "low": ep_ziel.get("tief"), "high": ep_ziel.get("hoch")}
        quellen["Kursziele"] = "Eulerpool"
    else:
        quellen["Kursziele"] = "Yahoo Finance"
    daten["zahlen_historie"] = _safe(f"{symbol} Zahlentermine (Historie)", lambda: backtest.zahlen_historie(t), []) or []
    kgv_hist = _safe(f"{symbol} KGV-Historie", lambda: _kgv_historie(t), []) or []
    werte = [p["wert"] for p in kgv_hist]
    schaetzungen = _safe(f"{symbol} Schätzungen", lambda: _schaetzungen(t), []) or []
    if ep.get("schaetzungen"):  # Jahresschätzungen von Eulerpool, Quartale weiter von Yahoo
        schaetzungen = [s for s in schaetzungen if "Quartal" in s["periode"]] + ep["schaetzungen"]
        quellen["Schätzungen"] = "Eulerpool (Jahre), Yahoo Finance (Quartale)"
    else:
        quellen["Schätzungen"] = "Yahoo Finance"
    naechstes_gj = next((s for s in schaetzungen if s["periode"] == PERIODEN["+1y"]), {})

    daten |= {
        "kgv": _f(info.get("trailingPE")),
        "forward_kgv": _f(info.get("forwardPE")),
        "forward_kgv_median_5j": float(pd.Series(werte).median()) if len(werte) >= 4 else None,
        "kgv_historie": kgv_hist,
        "umsatzwachstum": _f(info.get("revenueGrowth")),   # letztes Quartal ggü. Vorjahr
        "gewinnwachstum": _f(info.get("earningsGrowth")),  # letztes Quartal ggü. Vorjahr
        "kursziel_mittel": _f(ziele.get("mean") or info.get("targetMeanPrice")),
        "kursziel_tief": _f(ziele.get("low") or info.get("targetLowPrice")),
        "kursziel_hoch": _f(ziele.get("high") or info.get("targetHighPrice")),
        "analysten_anzahl": info.get("numberOfAnalystOpinions"),
        "empfehlung": info.get("recommendationKey"),
        "eps_wachstum_naechstes_jahr": naechstes_gj.get("eps_wachstum"),
        "naechste_zahlen": _safe(f"{symbol} Termine", lambda: _naechste_zahlen(t)),
        "finnhub_erwartung": _safe(f"{symbol} Finnhub-Schätzung", lambda: finnhub_erwartung(symbol)),
        "jahreszahlen": _safe(f"{symbol} Jahreszahlen", lambda: _jahreszahlen(t), []) or [],
        "eulerpool_bewertung": ep.get("bewertung") or {},
        "peers": ep.get("peers") or [],
        "aktien_anzahl": _f(info.get("sharesOutstanding")),
        "quartale": _safe(f"{symbol} Quartalszahlen", lambda: _quartale(t), []) or [],
        "eps_historie": _safe(f"{symbol} Gewinnüberraschungen", lambda: _eps_historie(t), []) or [],
        "schaetzungen": schaetzungen,
        "analysten_verteilung": _safe(f"{symbol} Analystenmeinungen", lambda: _analysten_verteilung(t)),
        "multiples": {
            "ev_ebitda": _f(info.get("enterpriseToEbitda")),
            "kuv": _f(info.get("priceToSalesTrailing12Months")),
            "kbv": _f(info.get("priceToBook")),
            "peg": _f(info.get("trailingPegRatio")),
            "dividendenrendite": _f(info.get("trailingAnnualDividendYield")),
        },
        "bilanz": {
            "bruttomarge": _f(info.get("grossMargins")),
            "operative_marge": _f(info.get("operatingMargins")),
            "nettomarge": _f(info.get("profitMargins")),
            "eigenkapitalrendite": _f(info.get("returnOnEquity")),
            # Yahoo liefert Verschuldungsgrad in Prozent (z. B. 45 = 45 %)
            "verschuldungsgrad": (_f(info.get("debtToEquity")) or 0) / 100 or None,
            "freier_cashflow": _f(info.get("freeCashflow")),
            "liquide_mittel": _f(info.get("totalCash")),
            "schulden": _f(info.get("totalDebt")),
            "beta": _f(info.get("beta")),
        },
    }
    return daten


def hole_kurshistorie(symbol: str, typ: str = "aktie") -> dict:
    """Nur was der Backtest braucht: elf Jahre Tageskurse (Yahoo) und bei Aktien die vergangenen Zahlentermine.
    Für Werte außerhalb der Watchlist (Backtest-Katalog, Abruf über live.py)."""
    import yfinance as yf

    from . import backtest

    t = yf.Ticker(symbol)
    start = (dt.date.today() - dt.timedelta(days=round(365.25 * backtest.JAHRE) + 5)).isoformat()
    verlauf = _safe(f"{symbol} Kurshistorie", lambda: t.history(start=start, auto_adjust=True), pd.DataFrame())
    if verlauf is not None and isinstance(verlauf.index, pd.DatetimeIndex) and verlauf.index.tz is not None:
        verlauf.index = verlauf.index.tz_localize(None)
    kurse = verlauf["Close"] if verlauf is not None and "Close" in verlauf else pd.Series(dtype=float)
    meta = _safe(f"{symbol} Metadaten", lambda: t.history_metadata, {}) or {}
    return {
        "symbol": symbol, "typ": typ, "kurse": kurse, "ohlc": verlauf, "quellen": {"Kurse": "Yahoo Finance"},
        "waehrung": meta.get("currency"), "name_yahoo": meta.get("longName") or meta.get("shortName"),
        "zahlen_historie": (_safe(f"{symbol} Zahlentermine (Historie)", lambda: backtest.zahlen_historie(t), []) or [])
        if typ == "aktie" else [],
    }


def hole_wechselkurse(waehrungen: set[str]) -> dict[str, float]:
    """Kurs 1 Einheit Fremdwährung → Euro, z. B. {'USD': 0.86}."""
    import yfinance as yf

    kurse = {"EUR": 1.0}
    for w in sorted(waehrungen - {"EUR", None}):
        kurs = _safe(
            f"Wechselkurs {w}",
            lambda w=w: float(yf.Ticker(f"{w}EUR=X").history(period="5d")["Close"].iloc[-1]),
        )
        if kurs:
            kurse[w] = kurs
    return kurse


def hole_alle(watchlist: list[dict], pause_sekunden: float = 1.0) -> tuple[list[dict], dict]:
    """Ruft die ganze Watchlist ab. Kleine Pause, damit Yahoo nicht blockt."""
    rohdaten = []
    for eintrag in watchlist:
        log.info("Lade %s …", eintrag["symbol"])
        typ = eintrag.get("typ", "aktie")
        daten = hole_aktie(eintrag["symbol"], typ, eintrag.get("isin"))
        daten["name"] = eintrag.get("name") or daten["name_yahoo"] or eintrag["symbol"]
        daten["typ"] = typ
        rohdaten.append(daten)
        time.sleep(pause_sekunden)
    fx = hole_wechselkurse({d["waehrung"] for d in rohdaten} | {d.get("finanzwaehrung") for d in rohdaten})
    return rohdaten, fx
