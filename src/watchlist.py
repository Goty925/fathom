"""Suche nach neuen Werten und Pflege der Watchlist in config.yaml.

Die Suche nutzt die Symbolsuche von Yahoo Finance. Aktien und ETFs werden nur angezeigt, wenn sie
an einer deutschen Börse notiert sind (Xetra, Frankfurt, Stuttgart, München, Berlin, Düsseldorf,
Hamburg, Hannover). Dort handeln auch Scalable Capital und Trade Republic (über gettex, Xetra bzw.
Lang & Schwarz); was in Deutschland gelistet ist, ist bei ihnen in aller Regel kaufbar.
Währungen, Rohstoff-Futures und Indizes werden immer angezeigt: Sie sind Basiswerte für ETCs,
Zertifikate und Hebelprodukte, die beide Broker anbieten.

config.yaml wird zeilenweise bearbeitet, damit deine Kommentare erhalten bleiben.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

DE_BOERSEN = {"GER": "Xetra", "FRA": "Frankfurt", "STU": "Stuttgart", "MUN": "München", "BER": "Berlin",
              "DUS": "Düsseldorf", "HAM": "Hamburg", "HAN": "Hannover"}
INDEX_FUTURES = ("s&p", "nasdaq", "dow", "dax", "russell", "stoxx", "nikkei", "ftse", "cac", "hang seng", "vix")
TYPEN = ("aktie", "etf", "forex", "rohstoff", "index")


def klasse(q: dict) -> str | None:
    """Yahoo-Suchtreffer → Anlageklasse dieser Website (oder None, wenn nicht unterstützt)."""
    art = (q.get("quoteType") or "").upper()
    name = (q.get("longname") or q.get("shortname") or "").lower()
    if art == "EQUITY":
        return "aktie"
    if art == "ETF":
        return "etf"
    if art == "CURRENCY":
        return "forex"
    if art == "INDEX":
        return "index"
    if art == "FUTURE":
        return "index" if any(w in name for w in INDEX_FUTURES) else "rohstoff"
    return None


def _schluessel(name: str) -> str:
    """Name vereinheitlichen, um Börsenplätze desselben Unternehmens zu gruppieren."""
    n = re.sub(r"[^a-z0-9 ]", " ", name.lower())
    n = re.sub(r"\b(inc|corp|corporation|ag|se|sa|nv|n v|plc|ltd|limited|holding|holdings|co|class [a-z]|the)\b", " ", n)
    return " ".join(n.split())


def gruppiere(quotes: list[dict], nur_deutschland: bool = True) -> list[dict]:
    """Suchtreffer je Wert zusammenfassen und deutsche Handelbarkeit bestimmen."""
    gruppen: dict[tuple, list[dict]] = {}
    for q in quotes:
        typ = klasse(q)
        if not typ or not q.get("symbol"):
            continue
        name = q.get("longname") or q.get("shortname") or q["symbol"]
        key = (typ, _schluessel(name) if typ in ("aktie", "etf") else q["symbol"])
        gruppen.setdefault(key, []).append(q | {"_typ": typ, "_name": name})

    ergebnisse = []
    for (typ, _), qs in gruppen.items():
        de = [q for q in qs if q.get("exchange") in DE_BOERSEN or q["symbol"].endswith((".DE", ".F"))]
        if typ in ("aktie", "etf") and nur_deutschland and not de:
            continue
        # Für die Daten die Heimatbörse bevorzugen: dort liefert Yahoo Analystenschätzungen und Termine
        heimat = [q for q in qs if q not in de and q.get("exchange") not in ("PNK", "OQB", "OQX")]
        haupt = heimat[0] if heimat else next((q for q in de if q.get("exchange") == "GER"), qs[0])
        ergebnisse.append({
            "symbol": haupt["symbol"],
            "name": haupt["_name"],
            "typ": typ,
            "boerse": haupt.get("exchDisp") or haupt.get("exchange") or "",
            "de_handelbar": bool(de) if typ in ("aktie", "etf") else None,
            "de_boersen": sorted({DE_BOERSEN.get(q.get("exchange"), q.get("exchDisp") or "") for q in de} - {""}),
            "de_symbol": next((q["symbol"] for q in de if q.get("exchange") == "GER"), de[0]["symbol"] if de else None),
        })
    return ergebnisse


def yahoo_suche(text: str, anzahl: int = 40) -> list[dict]:
    import yfinance as yf
    return yf.Search(text, max_results=anzahl, news_count=0, enable_fuzzy_query=True).quotes or []


# ---------------------------------------------------------------- config.yaml bearbeiten

def _block(zeilen: list[str]) -> tuple[int, int]:
    """Erste Zeile nach "watchlist:" und die Stelle, an der neue Einträge angefügt werden."""
    start = next(i for i, z in enumerate(zeilen) if re.match(r"^watchlist\s*:", z)) + 1
    ende = next((i for i in range(start, len(zeilen)) if re.match(r"^[A-Za-z_]", zeilen[i])), len(zeilen))
    while ende > start and (not zeilen[ende - 1].strip() or zeilen[ende - 1].startswith("#")):
        ende -= 1  # Kommentare und Leerzeilen vor dem nächsten Abschnitt gehören zu diesem
    return start, ende


def eintraege(pfad: Path) -> list[dict]:
    import yaml
    return yaml.safe_load(pfad.read_text(encoding="utf-8")).get("watchlist") or []


def hinzufuegen(pfad: Path, symbol: str, name: str, typ: str, isin: str | None = None) -> bool:
    """Neuen Wert ans Ende der Watchlist schreiben. False, wenn er schon drauf ist."""
    if typ not in TYPEN or not re.fullmatch(r"[A-Za-z0-9.\-=^&]{1,24}", symbol or ""):
        raise ValueError("Ungültiges Kürzel oder unbekannte Anlageklasse")
    if any(e.get("symbol", "").upper() == symbol.upper() for e in eintraege(pfad)):
        return False
    zeilen = pfad.read_text(encoding="utf-8").splitlines(keepends=True)
    _, ende = _block(zeilen)
    # Keine Steuer- oder Zeilentrennzeichen (auch U+2028/2029/0085): sie würden config.yaml zerlegen
    name = re.sub(r"[\x00-\x1f\x7f-\x9f\u2028\u2029]", " ", str(name or symbol)).strip()[:60] or symbol
    isin_teil = f"isin: {json.dumps(isin)}, " if isin and re.fullmatch(r"[A-Z]{2}[A-Z0-9]{9}[0-9]", isin) else ""
    neu = f'  - {{ symbol: {json.dumps(symbol)}, {isin_teil}name: {json.dumps(name, ensure_ascii=False)}, typ: {typ} }}\n'
    if ende and not zeilen[ende - 1].endswith("\n"):
        zeilen[ende - 1] += "\n"
    zeilen.insert(ende, neu)
    pfad.write_text("".join(zeilen), encoding="utf-8")
    return True


def entfernen(pfad: Path, symbol: str) -> bool:
    """Wert aus der Watchlist löschen (Einträge in der Kurzform { symbol: … })."""
    if not re.fullmatch(r"[A-Za-z0-9.\-=^&]{1,24}", symbol or ""):
        return False
    zeilen = pfad.read_text(encoding="utf-8").splitlines(keepends=True)
    start, ende = _block(zeilen)
    muster = re.compile(r'^\s*-\s*\{\s*symbol:\s*["\']?' + re.escape(symbol) + r'["\']?\s*[,}]', re.IGNORECASE)
    for i in range(start, ende):
        if muster.match(zeilen[i]):
            del zeilen[i]
            pfad.write_text("".join(zeilen), encoding="utf-8")
            return True
    return False
