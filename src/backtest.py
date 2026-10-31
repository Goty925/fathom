"""Daten für den Backtest im Browser: Kurse, Zahlentermine, Wirtschaftsdaten, Prüfberichte.

Die Website rechnet Backtests selbst (assets/backtest-kern.js). Dieses Modul liefert die Daten:

daten/backtest.json   alle Werte mit Tageskursen, dazu die Wirtschaftsdaten-Termine
daten/backtest/katalog/<slug>.json   Backtest-Katalog: verbreitete Werte außerhalb der Watchlist (gleiches Format wie
                             ein Eintrag in backtest.json), die Liste dazu steht in backtest.json unter "katalog"
daten/backtest/<slug>.json   je Wert mit OANDA-Zugang: Stundenkerzen (zehn Jahre) und Minutenkerzen um jeden
                             Termin (30 Minuten davor bis 6 Stunden danach), nur wenn erlaubt (siehe oanda.py)

Kodierung einer Kursreihe (exakt, ohne Rundung auf signifikante Stellen):
  dez    Nachkommastellen; alle Kurse als ganze Zahlen in Punkten (Kurs × 10^dez)
  c      Schlusskurse: erster Wert absolut, danach Abstand zum vorigen Schluss
  o/h/l  Eröffnung, Hoch, Tief als Abstand zum Schluss desselben Balkens
  sp     Spread (Brief minus Geld) in Punkten, nur bei Geld-/Briefkursen
  t0/dt  Startzeit des ersten Balkens in Minuten seit 1970 (UTC), dann Abstand in Einheiten von u Minuten
Tageskurse tragen zusätzlich d0/dd (Handelstag als Tage seit 1970) und sl (Dauer der Sitzung in Minuten).

Quartalszahlen e: [Index des Reaktionstags, Schätzung, Ist, Datum]. Der Reaktionstag ist der erste Handelstag, an
dessen Eröffnung die Zahlen bekannt waren (Meldung vor Börsenbeginn in Ortszeit der Börse → derselbe Tag).
"""
from __future__ import annotations

import datetime as dt
import logging
import math
import re
from zoneinfo import ZoneInfo

import pandas as pd

log = logging.getLogger(__name__)

JAHRE = 11  # zehn Jahre Backtest plus ein Jahr Vorlauf für Kriterien wie 52-Wochen-Hoch oder Momentum
EPOCHE = dt.date(1970, 1, 1)

# Börsenbeginn in Ortszeit: (Zeitzone, Stunde, Minute, Tage vor dem Handelstag, Dauer der Sitzung in Minuten)
BOERSEN = {
    ".DE": ("Europe/Berlin", 9, 0, 0, 510), ".F": ("Europe/Berlin", 8, 0, 0, 840), ".PA": ("Europe/Paris", 9, 0, 0, 510),
    ".AS": ("Europe/Amsterdam", 9, 0, 0, 510), ".MI": ("Europe/Rome", 9, 0, 0, 510), ".SW": ("Europe/Zurich", 9, 0, 0, 510),
    ".L": ("Europe/London", 8, 0, 0, 510), ".HK": ("Asia/Hong_Kong", 9, 30, 0, 390), ".T": ("Asia/Tokyo", 9, 0, 0, 360),
    ".TO": ("America/Toronto", 9, 30, 0, 390),
    "=X": ("UTC", 0, 0, 0, 1440),                  # Yahoo-Devisenkurse: Kalendertag UTC
    "=F": ("America/New_York", 18, 0, 1, 1380),    # CME Globex: Sitzung beginnt am Vorabend um 18 Uhr
}
INDIZES = {
    "^GDAXI": ("Europe/Berlin", 9, 0, 0, 510), "^STOXX50E": ("Europe/Berlin", 9, 0, 0, 510), "^FTSE": ("Europe/London", 8, 0, 0, 510),
    "^N225": ("Asia/Tokyo", 9, 0, 0, 360), "^HSI": ("Asia/Hong_Kong", 9, 30, 0, 390),
}
NEW_YORK = ("America/New_York", 9, 30, 0, 390)


def oeffnung(symbol: str) -> tuple[str, int, int, int, int]:
    s = symbol.upper()
    if s in INDIZES:
        return INDIZES[s]
    for endung, b in BOERSEN.items():
        if s.endswith(endung):
            return b
    return NEW_YORK


def boerse(symbol: str) -> tuple[str, int, int]:
    tz, h, m, _, _ = oeffnung(symbol)
    return tz, h, m


def _zahl(x) -> float | None:
    try:
        f = float(x)
    except (TypeError, ValueError):
        return None
    return None if math.isnan(f) or math.isinf(f) else f


def reaktionstag(zeitpunkt: pd.Timestamp, tage: pd.DatetimeIndex, symbol: str) -> int | None:
    """Index des ersten Handelstags, an dessen Eröffnung die Meldung bekannt war."""
    tz, stunde, minute = boerse(symbol)
    z = pd.Timestamp(zeitpunkt)
    if z.tzinfo is None:
        z = z.tz_localize("America/New_York")  # Yahoo meldet Zeiten in New Yorker Zeit
    z = z.tz_convert(tz)
    datum = pd.Timestamp(z.date())
    mitternacht = z.hour == 0 and z.minute == 0  # Uhrzeit unbekannt: vorsichtig nach Börsenschluss annehmen
    vor_beginn = not mitternacht and (z.hour, z.minute) < (stunde, minute)
    i = tage.searchsorted(datum, side="left" if vor_beginn else "right")
    return int(i) if i < len(tage) else None


def zahlen_historie(ticker) -> list[dict]:
    """Vergangene Quartalszahlen mit Uhrzeit, Schätzung und Ist (Yahoo, bis zu 48 Quartale)."""
    df = ticker.get_earnings_dates(limit=48)
    if df is None or df.empty:
        return []
    spalte = lambda teil: next((c for c in df.columns if teil.lower() in str(c).lower()), None)  # noqa: E731
    s, i = spalte("Estimate"), spalte("Reported")
    aus = []
    for zeit, r in df.sort_index().iterrows():
        ist = _zahl(r.get(i)) if i else None
        if ist is None:
            continue  # künftiger Termin
        aus.append({"zeit": pd.Timestamp(zeit), "schaetzung": _zahl(r.get(s)) if s else None, "ist": ist})
    return aus


def ohlc_aus(df: pd.DataFrame | None, kurse: pd.Series | None) -> pd.DataFrame | None:
    """Einheitliches OHLC-Format; fehlen Eröffnung/Hoch/Tief, stehen dort Schlusskurse."""
    if df is not None and not df.empty and "Close" in df:
        o = df.copy()
    elif kurse is not None and len(kurse.dropna()):
        o = pd.DataFrame({"Close": kurse})
    else:
        return None
    if o.index.tz is not None:
        o.index = o.index.tz_localize(None)
    o.index = pd.DatetimeIndex(o.index).normalize()
    o = o[~o.index.duplicated(keep="last")].sort_index()
    for s in ("Open", "High", "Low"):
        if s not in o:
            o[s] = o["Close"]
        o[s] = o[s].where(o[s] > 0, o["Close"])
    spalten = ["Open", "High", "Low", "Close"] + [s for s in ("Spread", "Minute") if s in o]
    o = o[spalten].astype(float).dropna(subset=["Close"])
    o = o[o["Close"] > 0]
    o["High"] = o[["High", "Open", "Close"]].max(axis=1)
    o["Low"] = o[["Low", "Open", "Close"]].min(axis=1)
    return o


def stellen(preise) -> int:
    """Nachkommastellen, mit denen ein Kurs auf etwa ein Hunderttausendstel genau bleibt."""
    p = pd.Series(preise).dropna()
    p = p[p > 0]
    if p.empty:
        return 2
    return max(0, min(6, 5 - int(math.floor(math.log10(float(p.median()))))))


def reihe_kodieren(df: pd.DataFrame, dez: int, minuten: list[int], einheit: int) -> dict:
    """OHLC (+Spread) als ganze Zahlen in Punkten, Zeiten als Abstände (siehe Moduldoku)."""
    f = 10 ** dez
    c = [int(round(x * f)) for x in df["Close"].to_numpy()]
    aus = {"u": einheit, "t0": int(minuten[0]), "dt": [int((b - a) // einheit) for a, b in zip(minuten, minuten[1:])],
           "c": [c[0]] + [b - a for a, b in zip(c, c[1:])]}
    for s, k in (("Open", "o"), ("High", "h"), ("Low", "l")):
        aus[k] = [int(round(x * f)) - y for x, y in zip(df[s].to_numpy(), c)]
    if "Spread" in df and df["Spread"].notna().any():
        aus["sp"] = [max(0, int(round(x * f))) if x == x else 0 for x in df["Spread"].to_numpy()]
    return aus


def _oeffnungsminuten(tage: pd.DatetimeIndex, symbol: str) -> list[int]:
    tz, h, m, vorher, _ = oeffnung(symbol)
    zone = ZoneInfo(tz)
    return [int(dt.datetime(d.year, d.month, d.day, h, m, tzinfo=zone).timestamp() // 60) - vorher * 1440 for d in tage]


def oanda_tage(o: dict) -> pd.DataFrame:
    """OANDA-Tageskerzen → DataFrame je Handelstag (Kerze ab 17 Uhr New York gehört zum Folgetag)."""
    from . import oanda
    df = oanda.mitte(o["tag"])
    ny = pd.to_datetime(df["Minute"] * 60, unit="s", utc=True).dt.tz_convert("America/New_York")
    df.index = pd.DatetimeIndex((ny + pd.Timedelta(hours=7)).dt.date)
    return df[~df.index.duplicated(keep="last")]


def kodiere(r: dict, heute: dt.date, jahre: int = JAHRE) -> dict | None:
    """Ein Wert mit Tageskursen für daten/backtest.json."""
    o_oanda = r.get("oanda")
    if o_oanda and o_oanda.get("tag"):
        o, dez, quelle = oanda_tage(o_oanda), int(o_oanda["dez"]), o_oanda.get("quelle", "OANDA")
        o.index = pd.DatetimeIndex(o.index)
        sitzung = 1440
    else:
        o = ohlc_aus(r.get("ohlc"), r.get("kurse"))
        if o is None:
            return None
        dez, quelle = stellen(o["Close"]), (r.get("quellen") or {}).get("Kurse") or r.get("quelle_kurse") or "Yahoo Finance"
        sitzung = oeffnung(r["symbol"])[4]
    o = o[o.index >= pd.Timestamp(heute - dt.timedelta(days=round(365.25 * jahre)))]
    if len(o) < 60:
        return None
    minuten = [int(x) for x in o["Minute"]] if "Minute" in o else _oeffnungsminuten(o.index, r["symbol"])
    tage = [(d.date() - EPOCHE).days for d in o.index]
    aus = {"s": r["symbol"], "n": r.get("name") or r["symbol"], "t": r.get("typ", "aktie"), "w": r.get("waehrung"),
           "q": quelle, "dez": dez, "d0": tage[0], "dd": [b - a for a, b in zip(tage, tage[1:])], "sl": sitzung}
    aus |= {k: v for k, v in reihe_kodieren(o, dez, minuten, 1).items() if k != "u"}
    if not o_oanda and all(v == 0 for v in aus["o"]) and all(v == 0 for v in aus["h"]):
        aus["nur_schluss"] = True  # Quelle liefert nur Schlusskurse: Stop und Ziel nur zum Schluss prüfbar
    zahlen = []
    for e in r.get("zahlen_historie") or []:
        i = reaktionstag(e["zeit"], o.index, r["symbol"])
        if i is None or e.get("ist") is None:
            continue
        zahlen.append([i, e.get("schaetzung"), e["ist"], pd.Timestamp(e["zeit"]).date().isoformat()])
    if zahlen:
        aus["e"] = zahlen
    if r.get("pruefung"):
        aus["pr"] = r["pruefung"]
    return aus


def kodiere_intraday(r: dict) -> dict | None:
    """Stundenkerzen und Minutenfenster eines Werts (nur mit OANDA-Zugang)."""
    from . import oanda
    o = r.get("oanda")
    if not o or not o.get("stunde"):
        return None
    dez = int(o["dez"])
    h = oanda.mitte(o["stunde"])
    aus = {"s": r["symbol"], "dez": dez, "h": reihe_kodieren(h, dez, [int(x) for x in h["Minute"]], 60), "m": {}}
    for t, k in sorted((o.get("minute") or {}).items(), key=lambda x: int(x[0])):
        if k:
            m = oanda.mitte(k)
            aus["m"][str(t)] = reihe_kodieren(m, dez, [int(x) for x in m["Minute"]], 1)
    return aus


def slug(symbol: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", symbol.lower()).strip("-")


# ---------------------------------------------------------------- Werte außerhalb der Watchlist

# Backtest-Katalog: verbreitete Werte, die jede Woche mit vorberechnet werden, damit man sie auch auf GitHub Pages
# (ohne lokalen Server) testen kann. In config.yaml unter backtest.katalog ersetzbar; Werte der Watchlist fallen weg.
STANDARD_KATALOG = [
    # Aktien Deutschland
    ("ALV.DE", "Allianz", "aktie"), ("SIE.DE", "Siemens", "aktie"), ("DTE.DE", "Deutsche Telekom", "aktie"),
    ("MUV2.DE", "Münchener Rück", "aktie"), ("AIR.DE", "Airbus", "aktie"), ("RHM.DE", "Rheinmetall", "aktie"),
    ("BMW.DE", "BMW", "aktie"), ("MBG.DE", "Mercedes-Benz", "aktie"), ("VOW3.DE", "Volkswagen Vz.", "aktie"),
    ("BAS.DE", "BASF", "aktie"), ("BAYN.DE", "Bayer", "aktie"), ("DBK.DE", "Deutsche Bank", "aktie"),
    ("IFX.DE", "Infineon", "aktie"), ("ADS.DE", "Adidas", "aktie"), ("DHL.DE", "DHL Group", "aktie"),
    # Aktien USA
    ("AAPL", "Apple", "aktie"), ("MSFT", "Microsoft", "aktie"), ("AMZN", "Amazon", "aktie"), ("GOOGL", "Alphabet", "aktie"),
    ("META", "Meta Platforms", "aktie"), ("NVDA", "Nvidia", "aktie"), ("TSLA", "Tesla", "aktie"), ("AMD", "AMD", "aktie"),
    ("NFLX", "Netflix", "aktie"), ("JPM", "JPMorgan Chase", "aktie"), ("V", "Visa", "aktie"), ("KO", "Coca-Cola", "aktie"),
    ("BRK-B", "Berkshire Hathaway B", "aktie"), ("LLY", "Eli Lilly", "aktie"), ("ASML", "ASML", "aktie"),
    # ETFs
    ("EUNL.DE", "iShares Core MSCI World", "etf"), ("SXR8.DE", "iShares Core S&P 500", "etf"),
    ("EXS1.DE", "iShares Core DAX", "etf"), ("IS3N.DE", "iShares Core MSCI EM IMI", "etf"),
    ("VWCE.DE", "Vanguard FTSE All-World", "etf"), ("SPY", "SPDR S&P 500", "etf"), ("QQQ", "Invesco QQQ (Nasdaq 100)", "etf"),
    # Währungen
    ("EURUSD=X", "EUR/USD", "forex"), ("GBPUSD=X", "GBP/USD", "forex"), ("USDJPY=X", "USD/JPY", "forex"),
    ("EURCHF=X", "EUR/CHF", "forex"), ("AUDUSD=X", "AUD/USD", "forex"), ("EURGBP=X", "EUR/GBP", "forex"),
    # Rohstoffe
    ("GC=F", "Gold", "rohstoff"), ("SI=F", "Silber", "rohstoff"), ("CL=F", "WTI-Öl", "rohstoff"), ("BZ=F", "Brent-Öl", "rohstoff"),
    ("NG=F", "Erdgas", "rohstoff"), ("HG=F", "Kupfer", "rohstoff"),
    # Indizes
    ("^GDAXI", "DAX", "index"), ("^GSPC", "S&P 500", "index"), ("^NDX", "Nasdaq 100", "index"), ("^DJI", "Dow Jones", "index"),
    ("^STOXX50E", "Euro Stoxx 50", "index"), ("^N225", "Nikkei 225", "index"),
]
KURZEL = re.compile(r"[A-Za-z0-9.\-=^&]{1,24}")


def katalog_eintraege(cfg: dict) -> list[dict]:
    """Katalog aus config.yaml (backtest.katalog) oder der Standardliste; ungültige Einträge fallen weg."""
    roh = ((cfg or {}).get("backtest") or {}).get("katalog")
    if roh is None:
        roh = [{"symbol": s, "name": n, "typ": t} for s, n, t in STANDARD_KATALOG]
    aus, gesehen = [], set()
    for e in roh or []:
        if not isinstance(e, dict) or not KURZEL.fullmatch(str(e.get("symbol") or "")):
            continue
        typ = e.get("typ") or "aktie"
        if typ not in ("aktie", "etf", "forex", "rohstoff", "index") or e["symbol"].upper() in gesehen:
            continue
        gesehen.add(e["symbol"].upper())
        aus.append({"symbol": e["symbol"], "name": str(e.get("name") or e["symbol"])[:80], "typ": typ})
    return aus


def einzelwert(eintrag: dict, heute: dt.date, demo: bool = False) -> dict | None:
    """Ein beliebiger Wert, kodiert wie in daten/backtest.json (Tageskurse, bei Aktien mit Zahlenterminen)."""
    symbol, typ = eintrag["symbol"], eintrag.get("typ", "aktie")
    if demo:
        from .demo import demo_daten
        seed = 1000 + sum(ord(z) * (i + 1) for i, z in enumerate(symbol.upper())) % 9000  # je Kürzel andere, feste Kurse
        r = demo_daten([{"symbol": symbol, "name": eintrag.get("name") or symbol, "typ": typ}], seed_basis=seed)[0][0]
    else:
        from .fetch import hole_kurshistorie
        r = hole_kurshistorie(symbol, typ)
        r["name"] = eintrag.get("name") or r.get("name_yahoo") or symbol
    r["typ"] = typ
    return kodiere(r, heute)


def katalog(eintraege: list[dict], ausnehmen: set[str], heute: dt.date, demo: bool = False,
            pause: float = 0.6, cache=None) -> tuple[list[dict], dict[str, dict]]:
    """Backtest-Katalog: Liste für die Suche und je Wert eine Datei daten/backtest/katalog/<slug>.json.
    cache (Ordner): heute schon abgerufene Werte nicht noch einmal laden (z. B. beim Neuaufbau durch live.py)."""
    import json
    import time
    liste, dateien = [], {}
    for e in eintraege:
        if e["symbol"].upper() in ausnehmen:
            continue
        datei = cache / f"{slug(e['symbol'])}.json" if cache and not demo else None
        k = None
        if datei and datei.is_file():
            try:
                gespeichert = json.loads(datei.read_text(encoding="utf-8"))
                k = gespeichert["wert"] if gespeichert.get("stand") == heute.isoformat() else None
            except (ValueError, KeyError, OSError):
                k = None
        if k is None:
            try:
                k = einzelwert(e, heute, demo)
            except Exception as exc:  # noqa: BLE001 – ein fehlender Wert hält den Bericht nicht auf
                log.info("Backtest-Katalog %s: %s", e["symbol"], exc)
                k = None
            if not demo:
                time.sleep(pause)
            if k and datei:
                datei.parent.mkdir(parents=True, exist_ok=True)
                datei.write_text(json.dumps({"stand": heute.isoformat(), "wert": k}, separators=(",", ":")), encoding="utf-8")
        if not k:
            continue
        name = f"katalog/{slug(e['symbol'])}"
        dateien[name] = k
        liste.append({"s": k["s"], "n": k["n"], "t": k["t"], "f": f"daten/backtest/{name}.json"})
    return liste, dateien


def paket(rohdaten: list[dict], heute: dt.date, demo: bool = False, ereignisse: list[dict] | None = None,
          intraday: bool = True) -> tuple[dict, dict[str, dict]]:
    """daten/backtest.json und die Intraday-Dateien je Wert ({slug: Inhalt})."""
    werte, dateien = [], {}
    for r in rohdaten:
        k = kodiere(r, heute)
        if not k:
            continue
        if intraday:
            i = kodiere_intraday(r)
            if i:
                dateien[slug(r["symbol"])] = i
                k["i"] = f"daten/backtest/{slug(r['symbol'])}.json"
                k["im"] = len(i["m"])
        werte.append(k)
    return {"stand": heute.isoformat(), "demo": demo, "ereignisse": ereignisse or [], "werte": werte}, dateien
