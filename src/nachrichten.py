"""Nachrichten für den Work-Modus, abgerufen von python live.py (nur auf deinem Rechner).

Quellen (alle mit Schnittstelle bzw. offiziellem Feed, nichts wird von Webseiten ausgelesen):
  - Finnhub: allgemeine Marktnachrichten und Nachrichten je US-Aktie der Watchlist. Schlüssel FINNHUB_API_KEY
    (kostenlos, 60 Abfragen je Minute). Die Meldungen stammen von Agenturen und Verlagen; Finnhub liefert Titel,
    Anrisstext und Link.
  - Federal Reserve und EZB: offizielle RSS-Feeds der Pressemitteilungen.
  - SEC EDGAR: Pflichtmitteilungen (Formular 8-K) der US-Aktien auf der Watchlist. Die SEC verlangt einen
    Absender mit Kontakt: Umgebungsvariable SEC_KONTAKT, z. B. "Fathom deine@adresse.de". Ohne sie entfällt die SEC.
Die Kurzfassung, die Zuordnung zu deinen Werten, das Thema und die Gewichtung rechnet die Seite selbst
(assets/work-kern.js), damit derselbe Code auch ohne live.py mit einem Finnhub-Schlüssel im Browser läuft.
"""
from __future__ import annotations

import datetime as dt
import email.utils
import hashlib
import html
import json
import logging
import os
import re
import threading
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

log = logging.getLogger(__name__)

FEEDS = [
    {"id": "fed", "name": "Federal Reserve", "url": "https://www.federalreserve.gov/feeds/press_all.xml", "thema": "notenbank"},
    {"id": "ezb", "name": "EZB", "url": "https://www.ecb.europa.eu/rss/press.html", "thema": "notenbank"},
]
# Formular 8-K: Abschnitte, die eine Mitteilung auslöst (Auszug), mit deutscher Kurzfassung
SEC_ABSCHNITTE = {
    "1.01": "Wesentlicher Vertrag geschlossen", "1.02": "Wesentlicher Vertrag beendet", "1.05": "Schwerer Cyber-Vorfall gemeldet",
    "2.01": "Kauf oder Verkauf von Unternehmensteilen abgeschlossen", "2.02": "Geschäftszahlen veröffentlicht",
    "2.03": "Neue wesentliche Finanzverbindlichkeit", "2.05": "Kosten für Umbau oder Stellenabbau", "2.06": "Wesentliche Wertberichtigung",
    "3.01": "Hinweis auf Börsenrückzug oder Verstoß gegen Börsenregeln", "3.02": "Nicht registrierter Aktienverkauf",
    "4.01": "Wechsel des Abschlussprüfers", "4.02": "Frühere Abschlüsse nicht mehr verlässlich", "5.01": "Wechsel der Kontrolle",
    "5.02": "Wechsel in Vorstand oder Aufsichtsrat", "5.03": "Satzung geändert", "5.07": "Abstimmungsergebnisse der Hauptversammlung",
    "7.01": "Information an den Markt (Regulation FD)", "8.01": "Sonstiges wichtiges Ereignis", "9.01": "Abschlüsse und Anlagen",
}
SEC_WICHTIG = {"1.05", "2.01", "2.02", "2.05", "2.06", "3.01", "4.02", "5.01", "5.02"}
_ATOM = "{http://www.w3.org/2005/Atom}"


def text_ohne_html(t: str | None, laenge: int = 1200) -> str:
    t = html.unescape(re.sub(r"<[^>]+>", " ", t or ""))
    t = re.sub(r"\s+", " ", t).strip()
    return t[:laenge]


def _id(*teile) -> str:
    return hashlib.sha1("|".join(str(t) for t in teile).encode()).hexdigest()[:16]


def lies_finnhub(liste: list[dict], symbol: str | None = None) -> list[dict]:
    """Finnhub /news bzw. /company-news → einheitliche Einträge."""
    aus = []
    for n in liste or []:
        if not n.get("headline") or not n.get("datetime"):
            continue
        rel = [s.strip().upper() for s in str(n.get("related") or "").split(",") if s.strip()]
        if symbol and symbol.upper() not in rel:
            rel.append(symbol.upper())
        aus.append({"id": "f" + str(n.get("id") or _id(n.get("url"), n.get("headline"))), "t": int(n["datetime"]),
                    "quelle": n.get("source") or "Finnhub", "titel": text_ohne_html(n["headline"], 300),
                    "text": text_ohne_html(n.get("summary")), "url": sichere_url(n.get("url")), "symbole": rel,
                    "thema": None, "herkunft": "finnhub"})
    return aus


def _zeit(t: str | None) -> int | None:
    if not t:
        return None
    t = t.strip()
    try:
        return int(email.utils.parsedate_to_datetime(t).timestamp())
    except (TypeError, ValueError):
        pass
    try:
        return int(dt.datetime.fromisoformat(t.replace("Z", "+00:00")).timestamp())
    except ValueError:
        return None


def lies_feed(xml_text: str, quelle: dict) -> list[dict]:
    """RSS 2.0 oder Atom → einheitliche Einträge."""
    wurzel = ET.fromstring(xml_text)
    aus = []
    for it in wurzel.iter("item"):
        titel, link = (it.findtext("title") or "").strip(), (it.findtext("link") or "").strip()
        t = _zeit(it.findtext("pubDate") or it.findtext("{http://purl.org/dc/elements/1.1/}date"))
        if titel and t:
            aus.append({"id": quelle["id"] + _id(link, titel), "t": t, "quelle": quelle["name"], "titel": text_ohne_html(titel, 300),
                        "text": text_ohne_html(it.findtext("description")), "url": sichere_url(link), "symbole": [], "thema": quelle.get("thema"),
                        "herkunft": quelle["id"]})
    for e in wurzel.iter(_ATOM + "entry"):
        titel = (e.findtext(_ATOM + "title") or "").strip()
        l = e.find(_ATOM + "link")
        link = l.get("href") if l is not None else ""
        t = _zeit(e.findtext(_ATOM + "updated") or e.findtext(_ATOM + "published"))
        if titel and t:
            aus.append({"id": quelle["id"] + _id(link, titel), "t": t, "quelle": quelle["name"], "titel": text_ohne_html(titel, 300),
                        "text": text_ohne_html(e.findtext(_ATOM + "summary") or e.findtext(_ATOM + "content")), "url": sichere_url(link), "symbole": [],
                        "thema": quelle.get("thema"), "herkunft": quelle["id"]})
    return aus


def lies_sec(xml_text: str, symbol: str, name: str) -> list[dict]:
    """EDGAR-Atom-Feed (Formular 8-K) eines Unternehmens → Einträge mit deutscher Kurzfassung der Abschnitte."""
    roh = lies_feed(xml_text, {"id": "sec", "name": "SEC EDGAR", "thema": "unternehmen"})
    aus = []
    for r in roh:
        abschnitte = sorted(set(re.findall(r"Item\s+(\d\.\d\d)", r["text"])))
        if not re.match(r"8-K", r["titel"]) and not abschnitte:
            continue
        teile = [SEC_ABSCHNITTE[a] for a in abschnitte if a in SEC_ABSCHNITTE and a != "9.01"]
        r |= {"symbole": [symbol.upper()], "titel": f"{name}: Pflichtmitteilung 8-K" + (f" – {teile[0]}" if teile else ""),
              "text": ("Gemeldet: " + "; ".join(teile) + ".") if teile else "Pflichtmitteilung an die US-Börsenaufsicht.",
              "abschnitte": abschnitte, "wichtig": bool(SEC_WICHTIG & set(abschnitte))}
        aus.append(r)
    return aus


def lies_cik(liste: dict) -> dict[str, int]:
    """SEC company_tickers.json → {Kürzel: CIK}."""
    return {str(v.get("ticker", "")).upper(): int(v["cik_str"]) for v in (liste or {}).values() if v.get("ticker") and v.get("cik_str")}


MAX_BYTES = 5 * 1024 * 1024  # größere Antworten sind kein Feed, sondern ein Fehler oder ein Angriff


def sichere_url(u) -> str:
    """Nur echte Web-Adressen weitergeben (kein javascript:, data: oder file:)."""
    u = str(u or "").strip()
    return u if re.match(r"https?://[^\s\"'<>]+$", u, re.IGNORECASE) else ""


def _laden(url: str, kopf: dict | None = None) -> bytes:
    anfrage = urllib.request.Request(url, headers={"User-Agent": "fathom-live/1.0", **(kopf or {})})
    with urllib.request.urlopen(anfrage, timeout=25) as r:  # noqa: S310 – feste https-Adressen
        roh = r.read(MAX_BYTES + 1)
    if len(roh) > MAX_BYTES:
        raise ValueError("Antwort zu groß")
    return roh


class Dienst:
    """Holt im Hintergrund Nachrichten und vergibt fortlaufende Nummern (für Abfragen „alles seit Nummer n“)."""

    def __init__(self, werte: list[dict], intervall: int = 60):
        self.werte = werte  # [{symbol, name, finnhub}]
        self.intervall = intervall
        self.eintraege: list[dict] = []
        self.ids: set[str] = set()
        self.nr = 0
        self.quellen: dict[str, str] = {}
        self.naechster = time.time()
        self.lock = threading.Lock()
        self.cik: dict[str, int] | None = None
        self.runde = 0
        self.schluessel = os.environ.get("FINNHUB_API_KEY")
        self.sec_kontakt = os.environ.get("SEC_KONTAKT")
        self.min_id = 0

    def aufnehmen(self, neu: list[dict]) -> int:
        with self.lock:
            zahl = 0
            for e in sorted(neu, key=lambda x: x["t"]):
                if e["id"] in self.ids or e["t"] < time.time() - 3 * 86400:
                    continue
                self.nr += 1
                self.ids.add(e["id"])
                self.eintraege.append(e | {"nr": self.nr})
                zahl += 1
            self.eintraege = sorted(self.eintraege, key=lambda x: x["t"])[-400:]
            return zahl

    def seit(self, nr: int) -> dict:
        with self.lock:
            liste = [e for e in self.eintraege if e["nr"] > nr]
            return {"nr": self.nr, "eintraege": liste[-250:], "quellen": dict(self.quellen), "naechster": self.naechster,
                    "intervall": self.intervall, "finnhub": bool(self.schluessel)}

    def _finnhub(self):
        if not self.schluessel:
            self.quellen["Finnhub"] = "kein FINNHUB_API_KEY"
            return
        basis = "https://finnhub.io/api/v1"
        kopf = {"X-Finnhub-Token": self.schluessel}  # Schlüssel im Header, nie in der Adresse (Logs, Proxys)
        try:
            url = f"{basis}/news?category=general" + (f"&minId={self.min_id}" if self.min_id else "")
            liste = json.loads(_laden(url, kopf))
            self.min_id = max([self.min_id] + [int(n.get("id") or 0) for n in liste or []])
            self.aufnehmen(lies_finnhub(liste))
            # Unternehmensnachrichten: je Runde zwei Werte, damit die Abfragegrenze nie erreicht wird
            us = [w for w in self.werte if w.get("finnhub")]
            heute = dt.date.today()
            for w in us[(self.runde * 2) % max(len(us), 1):][:2] if us else []:
                url = (f"{basis}/company-news?symbol={urllib.parse.quote(w['finnhub'])}&from={heute - dt.timedelta(days=2)}"
                       f"&to={heute}")
                self.aufnehmen(lies_finnhub(json.loads(_laden(url, kopf)), w["finnhub"])[:20])
            self.quellen["Finnhub"] = "ok"
        except Exception as exc:  # noqa: BLE001
            self.quellen["Finnhub"] = f"Fehler: {exc}"
            log.warning("Finnhub-Nachrichten: %s", exc)

    def _feeds(self):
        for f in FEEDS:
            try:
                self.aufnehmen(lies_feed(_laden(f["url"]).decode("utf-8", "replace"), f)[:30])
                self.quellen[f["name"]] = "ok"
            except Exception as exc:  # noqa: BLE001
                self.quellen[f["name"]] = f"Fehler: {exc}"
                log.warning("Feed %s: %s", f["name"], exc)

    def _sec(self):
        if not self.sec_kontakt:
            self.quellen["SEC EDGAR"] = "kein SEC_KONTAKT"
            return
        kopf = {"User-Agent": self.sec_kontakt}
        try:
            if self.cik is None:
                self.cik = lies_cik(json.loads(_laden("https://www.sec.gov/files/company_tickers.json", kopf)))
            for w in self.werte:
                c = self.cik.get(str(w.get("finnhub") or "").upper())
                if not c:
                    continue
                url = ("https://www.sec.gov/cgi-bin/browse-edgar?" + urllib.parse.urlencode(
                    {"action": "getcompany", "CIK": f"{c:010d}", "type": "8-K", "dateb": "", "owner": "include", "count": 10, "output": "atom"}))
                self.aufnehmen(lies_sec(_laden(url, kopf).decode("utf-8", "replace"), w["finnhub"], w["name"]))
                time.sleep(0.3)  # SEC: höchstens zehn Abfragen je Sekunde
            self.quellen["SEC EDGAR"] = "ok"
        except Exception as exc:  # noqa: BLE001
            self.quellen["SEC EDGAR"] = f"Fehler: {exc}"
            log.warning("SEC EDGAR: %s", exc)

    def schleife(self):
        while True:
            self._finnhub()
            if self.runde % 5 == 0:  # Notenbanken und SEC alle fünf Runden
                self._feeds()
                self._sec()
            self.runde += 1
            self.naechster = time.time() + self.intervall
            time.sleep(self.intervall)
