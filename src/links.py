"""Absprung-Links zu den Plattformen, an denen sich Fathom orientiert.

Wo das Adressmuster bekannt und stabil ist, führt der Link direkt zum Wert (TradingView, Finviz,
onvista, Eulerpool). Plattformen ohne öffentliches Muster (Koyfin, TIKR, Simply Wall St, getquin,
Parqet) und Nicht-Aktien bei onvista öffnen die erste passende Seite über eine DuckDuckGo-Suche
auf der jeweiligen Website. Portfolio Performance hat keine Webseite je Wert; dafür gibt es den
Kurs-Feed (daten/kurse/<wert>.json), den PP als Kursquelle abrufen kann.
"""
from __future__ import annotations

import re
from urllib.parse import quote, quote_plus

# Yahoo-Börsenendung → TradingView-Börse
_TV_ENDUNG = {"DE": "XETR", "F": "FWB", "HK": "HKEX", "PA": "EURONEXT", "AS": "EURONEXT", "BR": "EURONEXT",
              "MI": "MIL", "MC": "BME", "L": "LSE", "SW": "SIX", "CO": "OMXCOP", "ST": "OMXSTO", "HE": "OMXHEX",
              "OL": "OSL", "VI": "VIE", "T": "TSE", "TO": "TSX", "AX": "ASX", "KS": "KRX", "SS": "SSE", "SZ": "SZSE"}
_TV_US = {"NMS": "NASDAQ", "NGM": "NASDAQ", "NCM": "NASDAQ", "NYQ": "NYSE", "ASE": "AMEX", "PCX": "AMEX", "BTS": "CBOE"}
_TV_SONDER = {
    "GC=F": "COMEX:GC1!", "SI=F": "COMEX:SI1!", "HG=F": "COMEX:HG1!", "PL=F": "NYMEX:PL1!", "PA=F": "NYMEX:PA1!",
    "CL=F": "NYMEX:CL1!", "BZ=F": "ICEEUR:BRN1!", "NG=F": "NYMEX:NG1!", "ZW=F": "CBOT:ZW1!", "ZC=F": "CBOT:ZC1!",
    "ES=F": "CME_MINI:ES1!", "NQ=F": "CME_MINI:NQ1!", "YM=F": "CBOT_MINI:YM1!", "RTY=F": "CME_MINI:RTY1!",
    "^GDAXI": "XETR:DAX", "^GSPC": "SP:SPX", "^NDX": "NASDAQ:NDX", "^DJI": "DJ:DJI", "^STOXX50E": "TVC:SX5E",
    "^IXIC": "NASDAQ:IXIC", "^N225": "TVC:NI225", "^FTSE": "TVC:UKX", "^FCHI": "EURONEXT:PX1", "^MDAXI": "XETR:MDAX",
    "^TECDAX": "XETR:TDXP", "^RUT": "TVC:RUT", "^VIX": "TVC:VIX", "^HSI": "TVC:HSI",
}


def tradingview_symbol(z: dict) -> str:
    """Kürzel im Format BÖRSE:KÜRZEL für den TradingView-Chart."""
    s = z["symbol"]
    if s in _TV_SONDER:
        return _TV_SONDER[s]
    if s.endswith("=X"):
        p = s.removesuffix("=X")
        return f"FX:{p if len(p) == 6 else 'USD' + p}"
    if "." in s:
        basis, endung = s.rsplit(".", 1)
        boerse = _TV_ENDUNG.get(endung.upper())
        if endung.upper() == "HK":
            basis = basis.lstrip("0") or "0"
        return f"{boerse}:{basis}" if boerse else basis
    boerse = _TV_US.get(z.get("boerse") or "")
    return f"{boerse}:{s}" if boerse else s


def _ducky(seite: str, *begriffe: str) -> str:
    """Erster Treffer einer DuckDuckGo-Suche auf der Website (Backslash = „I'm feeling ducky“)."""
    return "https://duckduckgo.com/?q=" + quote_plus("\\" + f" site:{seite} " + " ".join(b for b in begriffe if b))


def _slug(name: str) -> str:
    return re.sub(r"[^A-Za-z0-9]+", "-", name).strip("-")


def plattformen(z: dict) -> list[dict]:
    """Links je Wert. art: direkt (zum Wert), suche (erste Fundstelle der Website), feed (Kursquelle für PP)."""
    s, name, isin, typ = z["symbol"], z.get("name") or z["symbol"], z.get("isin"), z.get("typ", "aktie")
    tv = z.get("tradingview") or tradingview_symbol(z)
    ticker = s.split(".")[0] if typ in ("aktie", "etf") else s
    us = typ in ("aktie", "etf") and not any(c in s for c in ".=^")
    l = [{"name": "TradingView", "url": "https://de.tradingview.com/symbols/" + quote(tv.replace(":", "-"), safe="-!") + "/",
          "art": "direkt", "zweck": "Interaktiver Chart, Indikatoren, Ideen der Community"}]
    if typ in ("aktie", "etf"):
        l.append({"name": "Koyfin", "url": _ducky("koyfin.com", name, ticker), "art": "suche",
                  "zweck": "Dashboards, historische Multiples, Vergleiche"})
    l.append({"name": "Investing.com", "url": "https://de.investing.com/search/?q=" + quote_plus(isin or name), "art": "suche",
              "zweck": "Technische Zusammenfassung, Wirtschaftskalender, News"})
    if us:
        l.append({"name": "Finviz", "url": f"https://finviz.com/quote.ashx?t={quote(s)}", "art": "direkt",
                  "zweck": "Screener, Insider-Trades, Analysten-Ratings (nur US-Werte)"})
    if typ == "aktie":
        l.append({"name": "Simply Wall St", "url": _ducky("simplywall.st", name, ticker), "art": "suche",
                  "zweck": "Snowflake, Fair Value, Risiko-Checks"})
        l.append({"name": "TIKR", "url": _ducky("tikr.com", name, ticker), "art": "suche",
                  "zweck": "10+ Jahre Finanzdaten, Schätzungen, Transkripte"})
    if isin and typ in ("aktie", "etf"):
        l.append({"name": "Eulerpool", "url": f"https://eulerpool.com/stock/{_slug(name)}-Stock-{isin}", "art": "direkt",
                  "zweck": "Fundamentaldaten über 20+ Jahre, Fair Value, Dividenden"})
    if typ in ("aktie", "etf"):
        l.append({"name": "Parqet", "url": _ducky("parqet.com", name, isin or ticker), "art": "suche",
                  "zweck": "Depot-Tracking, Dividendenkalender"})
        l.append({"name": "getquin", "url": _ducky("getquin.com", name, isin or ticker), "art": "suche",
                  "zweck": "Community-Diskussionen, Depot-Tracking"})
    if typ == "aktie" and isin:
        l.append({"name": "onvista", "url": f"https://www.onvista.de/aktien/{isin}", "art": "direkt",
                  "zweck": "Deutsche Börsenplätze, News, Derivate auf den Wert"})
    else:
        l.append({"name": "onvista", "url": _ducky("onvista.de", name, isin or ""), "art": "suche",
                  "zweck": "Deutsche Börsenplätze, News, Derivate auf den Basiswert"})
    l.append({"name": "Portfolio Performance", "url": None, "art": "feed",
              "zweck": "Kurs-Feed als Kursquelle in Portfolio Performance"})
    return l
