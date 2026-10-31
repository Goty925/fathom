"""Lokaler Live-Server: zeigt deine Website mit laufend aktualisierten Kursen.

Starten im Projektordner:
  python live.py            # echte Kurse über Yahoo Finance, öffnet http://localhost:8000
  python live.py --demo     # simulierte Kurse (zum Ausprobieren ohne Internet)

Der Server holt im Hintergrund alle 30 Sekunden die aktuellen Kurse aller Werte
der Watchlist und stellt sie der Seite unter /api/kurse bereit. Den Kursverlauf
des Handelstags gibt es unter /api/tag?symbol=… . Er läuft nur auf deinem Rechner
(127.0.0.1) und ist von außen nicht erreichbar. Beenden mit Strg+C.

Für den Work-Modus (Menü oben links) liefert er Nachrichten (/api/nachrichten: Finnhub, Fed, EZB, SEC) und den
Wirtschaftskalender (/api/kalender) mit Ist-Werten der US-Statistikbehörde BLS in der Minute der Veröffentlichung.
Schlüssel nur als Umgebungsvariablen: FINNHUB_API_KEY, optional BLS_API_KEY und SEC_KONTAKT (siehe README).

Außerdem macht er die Suche der Website möglich: /api/suche findet Aktien, ETFs, Währungen,
Rohstoffe und Indizes, /api/watchlist fügt Werte zu config.yaml hinzu oder entfernt sie. Danach
wird der Bericht im Hintergrund neu erstellt und die Seite lädt sich selbst neu. /api/backtest-wert liefert die
Kurse beliebiger Werte (auch außerhalb der Watchlist), damit der Backtest jedes Produkt aus der Suche testen kann.
/api/kerzen liefert Minuten- und Stundenkerzen für die Chart-Taktik (Yahoo Finance: 1 Minute für 7 Tage, 5 und 15
Minuten für 60 Tage, 1 Stunde für 2 Jahre).

Hinweis: Yahoo liefert US-Kurse nahezu in Echtzeit, andere Börsen (z. B. Xetra,
Hongkong) teils bis zu 15 Minuten verzögert. Für echte Echtzeit bei US-Aktien
kannst du zusätzlich auf der Seite einen Finnhub-Schlüssel hinterlegen.
"""
from __future__ import annotations

import argparse
import collections
import datetime as dt
import json
import logging
import math
import os
import random
import re
import threading
import time
import webbrowser
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import urllib.parse
import urllib.request
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import yaml

BASIS = Path(__file__).resolve().parent
log = logging.getLogger("live")


class Drossel:
    """Höchstens `anzahl` Ereignisse in `fenster` Sekunden (gleitendes Fenster), threadsicher."""

    def __init__(self, anzahl: int, fenster: float):
        self.anzahl, self.fenster = anzahl, fenster
        self.zeiten: collections.deque = collections.deque()
        self.lock = threading.Lock()

    def erlaubt(self, jetzt: float | None = None) -> bool:
        jetzt = time.time() if jetzt is None else jetzt
        with self.lock:
            while self.zeiten and jetzt - self.zeiten[0] >= self.fenster:
                self.zeiten.popleft()
            if len(self.zeiten) >= self.anzahl:
                return False
            self.zeiten.append(jetzt)
            return True


def ki_tageslimit() -> int:
    """Höchstzahl kostenpflichtiger KI-Deutungen in 24 Stunden (FATHOM_KI_LIMIT_TAG, Standard 100, 0 = aus)."""
    try:
        return max(0, int(os.environ.get("FATHOM_KI_LIMIT_TAG") or 100))
    except ValueError:
        return 100


# ---------------------------------------------------------------- Kursquellen

def yahoo_kurse(symbole: list[str]) -> tuple[dict, dict]:
    """Letzter Kurs, Vortagesschluss und 5-Minuten-Verlauf des letzten Handelstags."""
    import pandas as pd
    import yfinance as yf

    df = yf.download(symbole, period="5d", interval="1m", group_by="ticker", progress=False,
                     auto_adjust=False, prepost=False, threads=True)
    kurse, tage = {}, {}
    for s in symbole:
        try:
            if isinstance(df.columns, pd.MultiIndex):
                teil = df[s] if s in df.columns.get_level_values(0) else df.xs(s, level=1, axis=1)
            else:
                teil = df
            reihe = teil["Close"].dropna()
            ohlc = teil[["Open", "High", "Low", "Close"]].dropna() if {"Open", "High", "Low"} <= set(teil.columns) else None
        except KeyError:
            continue
        if reihe.empty:
            continue
        letzter = reihe.index[-1]
        heute = reihe[reihe.index.date == letzter.date()]
        frueher = reihe[reihe.index.date < letzter.date()]
        kurse[s] = {
            "kurs": float(reihe.iloc[-1]),
            "vortag": float(frueher.iloc[-1]) if len(frueher) else None,
            "zeit": letzter.timestamp(),
        }
        fuenf = heute.resample("5min").last().dropna()
        tage[s] = {"x": [t.isoformat() for t in fuenf.index], "y": [round(float(v), 4) for v in fuenf]}
        # 5-Minuten-Kerzen für den Kerzenchart: Eröffnung, Hoch, Tief je Zeitraum
        k = (ohlc[ohlc.index.date == letzter.date()].resample("5min").agg({"Open": "first", "High": "max", "Low": "min"}).reindex(fuenf.index)
             if ohlc is not None else None)
        if k is not None and len(k) == len(fuenf) and not k.isna().any().any():
            tage[s] |= {"o": [round(float(v), 4) for v in k["Open"]], "h": [round(float(v), 4) for v in k["High"]],
                        "l": [round(float(v), 4) for v in k["Low"]]}
    return kurse, tage


class DemoKurse:
    """Simulierte Kurse: Zufallspfad um den Schlusskurs aus dem Wochenbericht."""

    def __init__(self, basis_datei: Path):
        basis = json.loads(basis_datei.read_text(encoding="utf-8"))
        self.start = {w["symbol"]: w["kurs"] for w in basis["werte"].values() if w.get("kurs")}
        self.rng = random.Random(42)
        jetzt = dt.datetime.now().astimezone()
        beginn = jetzt.replace(hour=9, minute=0, second=0, microsecond=0)
        if beginn > jetzt:
            beginn -= dt.timedelta(hours=12)
        self.tage = {}
        self.vortag = {}
        for s, k in self.start.items():
            vortag = k * (1 + self.rng.gauss(0, 0.008))
            x, y, o, h, l, p, t = [], [], [], [], [], vortag, beginn
            while t <= jetzt:
                auf = p
                p *= 1 + self.rng.gauss(0, 0.0015)
                spanne = abs(self.rng.gauss(0, 0.0009)) * p
                x.append(t.isoformat()); y.append(round(p, 4)); o.append(round(auf, 4))
                h.append(round(max(auf, p) + spanne, 4)); l.append(round(min(auf, p) - spanne * 0.9, 4))
                t += dt.timedelta(minutes=5)
            self.tage[s], self.vortag[s] = {"x": x, "y": y, "o": o, "h": h, "l": l}, vortag
            self.start[s] = p

    def __call__(self, symbole):
        jetzt = time.time()
        kurse = {}
        for s in symbole:
            if s not in self.start:
                continue
            self.start[s] *= 1 + self.rng.gauss(0, 0.0012)
            kurse[s] = {"kurs": self.start[s], "vortag": self.vortag[s], "zeit": jetzt}
            tag = self.tage[s]
            if not tag["x"] or jetzt - dt.datetime.fromisoformat(tag["x"][-1]).timestamp() >= 300:
                vor = tag["y"][-1] if tag["y"] else self.start[s]
                neu = round(self.start[s], 4)
                tag["x"].append(dt.datetime.now().astimezone().isoformat()); tag["y"].append(neu)
                tag["o"].append(vor); tag["h"].append(max(vor, neu)); tag["l"].append(min(vor, neu))
            elif tag["y"]:  # laufende Kerze: Schluss, Hoch und Tief nachführen
                neu = round(self.start[s], 4)
                tag["y"][-1] = neu; tag["h"][-1] = max(tag["h"][-1], neu); tag["l"][-1] = min(tag["l"][-1], neu)
        return kurse, self.tage


# ---------------------------------------------------------------- Hintergrund-Abruf

class Speicher:
    def __init__(self, quelle, symbole: list[str], intervall: int, demo: bool):
        self.quelle, self.symbole, self.intervall, self.demo = quelle, symbole, intervall, demo
        self.kurse, self.tage, self.fehler, self.stand = {}, {}, None, None
        self.lock = threading.Lock()

    def schleife(self):
        while True:
            try:
                kurse, tage = self.quelle(self.symbole)
                with self.lock:
                    self.kurse.update({k: v for k, v in kurse.items() if not math.isnan(v["kurs"])})
                    self.tage.update(tage)
                    self.fehler, self.stand = None, time.time()
                log.info("Kurse aktualisiert (%d Werte)", len(kurse))
            except Exception as exc:  # noqa: BLE001 – Server soll weiterlaufen
                with self.lock:
                    self.fehler = str(exc)
                log.warning("Kursabruf fehlgeschlagen: %s", exc)
            time.sleep(self.intervall)


class Aufbau:
    """Erstellt den Bericht nach einer Änderung der Watchlist im Hintergrund neu."""

    def __init__(self, ordner: Path, demo: bool, config: Path, speicher: "Speicher"):
        self.ordner, self.demo, self.config, self.speicher = ordner, demo, config, speicher
        self.laeuft, self.fehler, self.version, self.nochmal = False, None, 0, False
        self.lock = threading.Lock()

    def starten(self):
        with self.lock:
            if self.laeuft:
                self.nochmal = True  # weitere Änderung während des Aufbaus: danach noch einmal
                return
            self.laeuft = True
        threading.Thread(target=self._lauf, daemon=True).start()

    def _lauf(self):
        import main as wochenbericht
        while True:
            try:
                rc = wochenbericht.main(["--keine-mail", "--ausgabe", str(self.ordner), "--config", str(self.config)]
                                        + (["--demo"] if self.demo else []))
                self.fehler = None if rc == 0 else "Bericht konnte nicht erstellt werden"
                cfg = yaml.safe_load(self.config.read_text(encoding="utf-8"))
                with self.speicher.lock:
                    self.speicher.symbole = [e["symbol"] for e in cfg["watchlist"]]
                    if self.demo:
                        self.speicher.quelle = DemoKurse(self.ordner / "daten" / "basis.json")
            except Exception as exc:  # noqa: BLE001
                self.fehler = str(exc)
                log.warning("Neuaufbau fehlgeschlagen: %s", exc)
            with self.lock:
                if not self.nochmal:
                    self.laeuft = False
                    self.version += 1
                    return
                self.nochmal = False


class KalenderDienst:
    """Kalender aus daten/kalender.json, live ergänzt: Ist-Werte der BLS ab der Minute der Veröffentlichung,
    Uhrzeit, Erwartung und Ergebnis der Quartalszahlen über Finnhub."""

    def __init__(self, datei: Path, demo: bool):
        self.datei, self.demo = datei, demo
        self.daten, self.mtime, self.fehler = None, None, None
        self.zuletzt_bls, self.zuletzt_zahlen = 0.0, 0.0
        self.lock = threading.Lock()

    def laden(self):
        try:
            m = self.datei.stat().st_mtime
        except OSError:
            return
        if m != self.mtime:
            daten = json.loads(self.datei.read_text(encoding="utf-8"))
            with self.lock:
                alt = {t["id"]: t for t in (self.daten or {}).get("termine", [])}
                for t in daten.get("termine", []):  # live eingetragene Werte nach einem Neuaufbau behalten
                    for w, w_alt in zip(t.get("werte") or [], (alt.get(t["id"]) or {}).get("werte") or []):
                        if w.get("ist") is None and w_alt.get("ist") is not None:
                            w["ist"], w["ist_quelle"] = w_alt["ist"], w_alt.get("ist_quelle")
                self.daten, self.mtime = daten, m

    def bls(self):
        from src import kalender
        jetzt = time.time() / 60
        faellig = [t for t in (self.daten or {}).get("termine", [])
                   if t.get("t") and t["t"] <= jetzt <= t["t"] + 30 and kalender.bls_reihen(t)
                   and any(w.get("bls") and w.get("ist") is None and w.get("periode") for w in t["werte"])]
        warte = 15 if os.environ.get("BLS_API_KEY") else 60  # ohne Schlüssel erlaubt die BLS 25 Abfragen am Tag
        if not faellig or time.time() - self.zuletzt_bls < warte:
            return
        self.zuletzt_bls = time.time()
        reihen = sorted({r for t in faellig for r in kalender.bls_reihen(t)})
        try:
            daten = kalender.hole_bls(reihen, dt.date.today().year)
            with self.lock:
                for t in faellig:
                    kalender.ist_eintragen(t, daten)
            self.fehler = None
        except Exception as exc:  # noqa: BLE001
            self.fehler = f"BLS: {exc}"
            log.warning("BLS: %s", exc)

    def zahlen(self):
        from src import kalender
        schluessel = os.environ.get("FINNHUB_API_KEY")
        if not schluessel or time.time() - self.zuletzt_zahlen < 900:
            return
        self.zuletzt_zahlen = time.time()
        termine = [t for t in (self.daten or {}).get("termine", []) if t.get("art") == "zahlen" and t.get("finnhub")]
        for t in termine:
            try:
                tag = dt.date.fromisoformat(t["tag"])
                url = ("https://finnhub.io/api/v1/calendar/earnings?" + urllib.parse.urlencode(
                    {"from": (tag - dt.timedelta(days=10)).isoformat(), "to": (tag + dt.timedelta(days=20)).isoformat(),
                     "symbol": t["finnhub"]}))
                kopf = {"User-Agent": "fathom-live/1.0", "X-Finnhub-Token": schluessel}  # Schlüssel nie in der Adresse
                with urllib.request.urlopen(urllib.request.Request(url, headers=kopf), timeout=20) as r:  # noqa: S310
                    liste = json.loads(r.read(5 * 1024 * 1024)).get("earningsCalendar") or []
                with self.lock:
                    kalender.zahlen_eintragen(t, liste)
            except Exception as exc:  # noqa: BLE001
                log.warning("Finnhub-Zahlentermin %s: %s", t.get("finnhub"), exc)

    def schleife(self):
        while True:
            try:
                self.laden()
                if not self.demo:
                    self.bls()
                    self.zahlen()
            except Exception as exc:  # noqa: BLE001
                log.warning("Kalender: %s", exc)
            time.sleep(5)

    def json(self) -> dict:
        with self.lock:
            d = dict(self.daten or {"termine": [], "quellen": []})
            d["live"] = {"bls": not self.demo, "bls_schluessel": bool(os.environ.get("BLS_API_KEY")),
                         "finnhub": bool(os.environ.get("FINNHUB_API_KEY")), "fehler": self.fehler}
            return json.loads(json.dumps(d))


# Sicherheitskopfzeilen für jede Antwort. Die Seite lädt nur eigene Dateien; Ausnahmen sind Finnhub (Live-Kurse im
# Browser) und das TradingView-Widget, das du im Analysefenster ausdrücklich laden musst.
CSP = ("default-src 'self'; script-src 'self' https://s3.tradingview.com; style-src 'self' 'unsafe-inline'; "
       "img-src 'self' data:; font-src 'self' data:; connect-src 'self' https://finnhub.io wss://ws.finnhub.io; "
       "frame-src https://*.tradingview.com https://www.tradingview-widget.com; object-src 'none'; base-uri 'none'; "
       "form-action 'self'; frame-ancestors 'none'")
SICHERHEIT = {
    "Content-Security-Policy": CSP,
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
}
MAX_KOERPER = 64 * 1024


class Handler(SimpleHTTPRequestHandler):
    server_version = "fathom-live"   # keine Versionsnummern von Python und Server preisgeben
    sys_version = ""
    timeout = 30                     # hängende Verbindungen nicht ewig offen halten
    speicher: Speicher = None
    kalender: KalenderDienst = None
    nachrichten = None  # src.nachrichten.Dienst oder None (Demo)
    aufbau: Aufbau = None
    config: Path = None
    suche = None  # Funktion Text → Yahoo-Suchtreffer

    def log_message(self, fmt, *args):  # ruhigere Konsole
        if not self.path.startswith("/api/"):
            super().log_message(fmt, *args)

    def _json(self, daten, code=200):
        roh = json.dumps(daten).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(roh)))
        self.end_headers()
        self.wfile.write(roh)

    # ------------------------------------------------------------ Schutz vor fremden Webseiten
    def _hosts(self) -> set[str]:
        port = self.server.server_port
        return {f"localhost:{port}", f"127.0.0.1:{port}", f"[::1]:{port}"}

    def _host_ok(self) -> bool:
        """DNS-Rebinding abwehren: Eine fremde Domain, die auf 127.0.0.1 zeigt, schickt ihren eigenen Namen als Host."""
        return (self.headers.get("Host") or "").lower() in self._hosts()

    def _abweisen(self, code: int, text: str):
        self._json({"fehler": text}, code)

    def send_error(self, code, message=None, explain=None):  # Fehlerseiten ohne Details zum Server
        if not hasattr(self, "headers") or not hasattr(self, "path"):  # Anfragezeile unlesbar: Standardantwort
            return super().send_error(code, "Fehler")
        self.close_connection = True
        self._json({"fehler": "Nicht gefunden" if code == 404 else "Fehler"}, code)

    def list_directory(self, path):  # keine Ordnerlisten
        self.send_error(404)
        return None

    def do_HEAD(self):
        if not self._host_ok():
            return self._abweisen(421, "Unbekannter Host")
        return super().do_HEAD()

    def do_OPTIONS(self):  # kein CORS: fremde Seiten bekommen keine Freigabe
        return self._abweisen(405, "Nicht erlaubt")

    do_PUT = do_PATCH = do_OPTIONS

    def do_GET(self):
        if not self._host_ok():
            return self._abweisen(421, "Unbekannter Host")
        url = urlparse(self.path)
        sp = self.speicher
        if url.path == "/api/kurse":
            with sp.lock:
                return self._json({"werte": sp.kurse, "intervall": sp.intervall, "demo": sp.demo,
                                   "stand": sp.stand, "fehler": sp.fehler})
        if url.path == "/api/suche":
            from src import watchlist
            text = parse_qs(url.query).get("q", [""])[0].strip()[:60]
            if len(text) < 2:
                return self._json({"ergebnisse": []})
            if not self.such_drossel.erlaubt():  # schützt den Yahoo-Zugang vor Schleifen und fremden Seiten
                return self._json({"ergebnisse": [], "fehler": "Zu viele Suchen, bitte kurz warten"}, 429)
            try:
                treffer = watchlist.gruppiere(self.suche(text))
            except Exception as exc:  # noqa: BLE001
                log.warning("Suche: %s", exc)
                return self._json({"ergebnisse": [], "fehler": "Suche gerade nicht erreichbar"}, 502)
            vorhanden = {e["symbol"].upper() for e in watchlist.eintraege(self.config)}
            for r in treffer:
                r["auf_watchlist"] = r["symbol"].upper() in vorhanden or (r.get("de_symbol") or "").upper() in vorhanden
            return self._json({"ergebnisse": treffer})
        if url.path == "/api/nachrichten":
            if self.nachrichten is None:
                return self._json({"demo": True, "nr": 0, "eintraege": []})
            try:
                seit = int(parse_qs(url.query).get("seit", ["0"])[0])
            except ValueError:
                seit = 0
            return self._json(self.nachrichten.seit(seit))
        if url.path == "/api/kalender":
            return self._json(self.kalender.json())
        if url.path == "/api/status":
            a = self.aufbau
            from src import taktik
            return self._json({"aufbau": a.laeuft, "version": a.version, "fehler": a.fehler, "ki": taktik.verfuegbar(), "kerzen": True})
        if url.path == "/api/tag":
            symbol = parse_qs(url.query).get("symbol", [""])[0]
            with sp.lock:
                tag = sp.tage.get(symbol)
            return self._json(tag or {"x": [], "y": []}, 200 if tag else 404)
        return super().do_GET()

    def _erlaubt(self) -> bool:
        """Änderungen nur von dieser Seite selbst (CSRF-Schutz) und nur als JSON.

        Verlangt wird ein bekannter Host (gegen DNS-Rebinding), eine Herkunft (Origin) genau gleich dieser Seite oder,
        falls ein Browser keine schickt, Sec-Fetch-Site: same-origin. Anfragen ohne beides (z. B. aus anderen
        Programmen) werden abgewiesen. application/json erzwingt bei fremden Seiten außerdem eine CORS-Vorabfrage,
        die dieser Server nie erlaubt."""
        if not self._host_ok():
            return False
        herkunft = self.headers.get("Origin")
        if herkunft is not None:
            if herkunft.lower() not in {f"http://{h}" for h in self._hosts()}:
                return False
        elif (self.headers.get("Sec-Fetch-Site") or "") != "same-origin":
            return False
        return (self.headers.get("Content-Type") or "").split(";")[0].strip().lower() == "application/json"

    def _koerper(self) -> dict:
        try:
            laenge = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            raise ValueError("Ungültige Länge") from None
        if laenge < 0 or laenge > MAX_KOERPER:
            raise OverflowError
        d = json.loads(self.rfile.read(laenge) or b"{}")
        if not isinstance(d, dict):
            raise ValueError("JSON-Objekt erwartet")
        return d

    def do_POST(self):
        from src import watchlist
        if urlparse(self.path).path == "/api/taktik":
            return self._taktik()
        if urlparse(self.path).path == "/api/backtest-wert":
            return self._backtest_wert()
        if urlparse(self.path).path == "/api/kerzen":
            return self._kerzen()
        if urlparse(self.path).path != "/api/watchlist":
            return self._json({"fehler": "Unbekannte Adresse"}, 404)
        if not self._erlaubt():
            return self._json({"fehler": "Nicht erlaubt"}, 403)
        try:
            d = self._koerper()
        except OverflowError:
            return self._json({"fehler": "Anfrage zu groß"}, 413)
        except (ValueError, json.JSONDecodeError):
            return self._json({"fehler": "Ungültige Anfrage"}, 400)
        try:
            # Einzelner Wert oder ganze Liste (z. B. alle Portfolio-Positionen, die noch fehlen)
            liste = d.get("eintraege") if isinstance(d.get("eintraege"), list) else [d]
            hinzu, fehlt = [], []
            for e in liste[:50]:
                if not isinstance(e, dict):
                    continue
                symbol, name, typ = e.get("symbol"), e.get("name") or "", e.get("typ") or "aktie"
                if not all(isinstance(x, str) for x in (symbol or "", name, typ, e.get("isin") or "")):
                    raise ValueError("Felder müssen Text sein")
                name = name[:120]
                if not symbol:  # nur ISIN oder Name bekannt: über die Suche das Kürzel bestimmen
                    begriff = e.get("isin") or name
                    treffer = [r for r in watchlist.gruppiere(self.suche(begriff)) if r["typ"] in ("aktie", "etf")] if begriff else []
                    if not treffer:
                        fehlt.append(begriff or "?")
                        continue
                    symbol, name, typ = treffer[0]["symbol"], name or treffer[0]["name"], treffer[0]["typ"]
                elif not name or name.upper() == symbol.upper():  # nur das Kürzel bekannt: richtigen Namen nachschlagen
                    treffer = [r for r in watchlist.gruppiere(self.suche(symbol), nur_deutschland=False) if r["symbol"].upper() == symbol.upper()]
                    name = treffer[0]["name"] if treffer else symbol
                if watchlist.hinzufuegen(self.config, symbol, name, typ, e.get("isin")):
                    hinzu.append(symbol)
        except ValueError as exc:
            return self._json({"fehler": str(exc) if "Kürzel" in str(exc) or "Text" in str(exc) else "Ungültige Anfrage"}, 400)
        except Exception as exc:  # noqa: BLE001 – z. B. Suche nicht erreichbar; Details nur in die Konsole
            log.warning("Watchlist: %s", exc)
            return self._json({"fehler": "Konnte nicht hinzugefügt werden"}, 502)
        if hinzu:
            self.aufbau.starten()
        return self._json({"ok": True, "neu": bool(hinzu), "hinzugefuegt": hinzu, "nicht_gefunden": fehlt,
                           "version": self.aufbau.version})

    _ki_lock = threading.Lock()
    _ki_zuletzt = [0.0]
    ki_tag = Drossel(100, 24 * 3600)    # kostenpflichtig: Tagesgrenze, in main() aus FATHOM_KI_LIMIT_TAG
    such_drossel = Drossel(30, 60)      # Yahoo-Suche: höchstens 30 je Minute

    def _taktik(self):
        """Chart-Taktik mit KI deuten (nur mit ANTHROPIC_API_KEY; höchstens eine Anfrage gleichzeitig, alle 3 s)."""
        from src import taktik
        if not self._erlaubt():
            return self._json({"fehler": "Nicht erlaubt"}, 403)
        if not taktik.verfuegbar():
            return self._json({"fehler": "Kein ANTHROPIC_API_KEY gesetzt"}, 503)
        try:
            d = self._koerper()
        except OverflowError:
            return self._json({"fehler": "Anfrage zu groß"}, 413)
        except (ValueError, json.JSONDecodeError):
            return self._json({"fehler": "Ungültige Anfrage"}, 400)
        text, zeichnungen = d.get("text"), d.get("zeichnungen")
        if not isinstance(text, str) or not text.strip() or not isinstance(zeichnungen, list):
            return self._json({"fehler": "Beschreibung und Zeichnungen fehlen"}, 400)
        if not self._ki_lock.acquire(blocking=False):
            return self._json({"fehler": "Bitte einen Moment warten"}, 429)
        try:
            if time.time() - self._ki_zuletzt[0] < 3:
                return self._json({"fehler": "Bitte einen Moment warten"}, 429)
            if not self.ki_tag.erlaubt():
                log.warning("KI-Deutung: Tagesgrenze von %d Anfragen erreicht", self.ki_tag.anzahl)
                return self._json({"fehler": f"Tagesgrenze erreicht ({self.ki_tag.anzahl} Deutungen in 24 Stunden)"}, 429)
            self._ki_zuletzt[0] = time.time()
            return self._json(taktik.deute(text[:4000], zeichnungen[:40]))
        except Exception as exc:  # noqa: BLE001 – Details nur in die Konsole
            log.warning("KI-Deutung: %s", exc)
            return self._json({"fehler": "Die KI hat nicht geantwortet oder kein gültiges Ergebnis geliefert"}, 502)
        finally:
            self._ki_lock.release()

    _bt_lock = threading.Lock()
    _bt_cache: dict = {}  # Kürzel → (Zeit, kodierter Wert); höchstens 60 Werte, sechs Stunden

    def _backtest_wert(self):
        """Kurse eines beliebigen Werts für den Backtest (auch außerhalb der Watchlist), kodiert wie daten/backtest.json.
        Nur von dieser Seite (wie Schreibzugriffe), ein Abruf gleichzeitig, Ergebnisse sechs Stunden im Speicher."""
        from src import backtest, watchlist
        if not self._erlaubt():
            return self._json({"fehler": "Nicht erlaubt"}, 403)
        try:
            d = self._koerper()
        except OverflowError:
            return self._json({"fehler": "Anfrage zu groß"}, 413)
        except (ValueError, json.JSONDecodeError):
            return self._json({"fehler": "Ungültige Anfrage"}, 400)
        symbol, typ, name = d.get("symbol"), d.get("typ") or "aktie", d.get("name") or ""
        if not all(isinstance(x, str) for x in (symbol or "", typ, name)) or typ not in watchlist.TYPEN \
                or not backtest.KURZEL.fullmatch(symbol or ""):
            return self._json({"fehler": "Ungültiges Kürzel oder unbekannte Anlageklasse"}, 400)
        schluessel = symbol.upper()
        treffer = self._bt_cache.get(schluessel)
        if treffer and time.time() - treffer[0] < 6 * 3600:
            return self._json(treffer[1])
        if not self._bt_lock.acquire(timeout=45):
            return self._json({"fehler": "Bitte einen Moment warten"}, 429)
        try:
            name = re.sub(r"[\x00-\x1f\x7f-\x9f\u2028\u2029]", " ", name).strip()[:80]
            wert = backtest.einzelwert({"symbol": symbol, "name": name or symbol, "typ": typ}, dt.date.today(), self.speicher.demo)
        except Exception as exc:  # noqa: BLE001 – Details nur in die Konsole
            log.warning("Backtest-Wert %s: %s", symbol, exc)
            wert = None
        finally:
            self._bt_lock.release()
        if not wert:
            return self._json({"fehler": "Für diesen Wert gibt es nicht genug Kursdaten"}, 404)
        if len(self._bt_cache) >= 60:
            self._bt_cache.pop(min(self._bt_cache, key=lambda k: self._bt_cache[k][0]))
        self._bt_cache[schluessel] = (time.time(), wert)
        return self._json(wert)

    kerzen_drossel = Drossel(30, 60)  # Intraday-Abrufe bei Yahoo: höchstens 30 je Minute
    _kz_lock = threading.Lock()
    _kz_cache: dict = {}  # (Kürzel, Intervall) → (Zeit, Antwort); höchstens 40 Einträge, Frische je Intervall

    def _kerzen(self):
        """Minuten- und Stundenkerzen eines Werts für die Chart-Taktik (Yahoo Finance, im Demo-Modus simuliert).
        Nur von dieser Seite, ein Abruf gleichzeitig, gedrosselt und kurz zwischengespeichert."""
        from src import backtest, intraday
        if not self._erlaubt():
            return self._json({"fehler": "Nicht erlaubt"}, 403)
        try:
            d = self._koerper()
        except OverflowError:
            return self._json({"fehler": "Anfrage zu groß"}, 413)
        except (ValueError, json.JSONDecodeError):
            return self._json({"fehler": "Ungültige Anfrage"}, 400)
        symbol, intervall, anker = d.get("symbol"), d.get("intervall"), d.get("anker")
        if not isinstance(symbol, str) or not backtest.KURZEL.fullmatch(symbol) or intervall not in intraday.INTERVALLE:
            return self._json({"fehler": "Ungültiges Kürzel oder Intervall"}, 400)
        anker = float(anker) if isinstance(anker, (int, float)) and not isinstance(anker, bool) and math.isfinite(anker) and 0 < anker < 1e9 else None
        schluessel = (symbol.upper(), intervall)
        treffer = self._kz_cache.get(schluessel)
        if treffer and time.time() - treffer[0] < intraday.FRISCH[intervall]:
            return self._json(treffer[1])
        if not self.kerzen_drossel.erlaubt():
            return self._json({"fehler": "Zu viele Abrufe, bitte kurz warten"}, 429)
        if not self._kz_lock.acquire(timeout=45):
            return self._json({"fehler": "Bitte einen Moment warten"}, 429)
        try:
            wert = intraday.demo(symbol, intervall, anker or 100.0) if self.speicher.demo else intraday.yahoo(symbol, intervall)
        except Exception as exc:  # noqa: BLE001 – Details nur in die Konsole
            log.warning("Kerzen %s %s: %s", symbol, intervall, exc)
            wert = None
        finally:
            self._kz_lock.release()
        if not wert:
            return self._json({"fehler": f"Yahoo Finance liefert für {symbol} keine {intervall}-Kerzen"}, 404)
        if len(self._kz_cache) >= 40:
            self._kz_cache.pop(min(self._kz_cache, key=lambda k: self._kz_cache[k][0]))
        self._kz_cache[schluessel] = (time.time(), wert)
        return self._json(wert)

    def do_DELETE(self):
        from src import watchlist
        url = urlparse(self.path)
        if url.path != "/api/watchlist":
            return self._json({"fehler": "Unbekannte Adresse"}, 404)
        if not self._erlaubt():
            return self._json({"fehler": "Nicht erlaubt"}, 403)
        symbol = parse_qs(url.query).get("symbol", [""])[0]
        weg = watchlist.entfernen(self.config, symbol)
        if weg:
            self.aufbau.starten()
        return self._json({"ok": weg, "version": self.aufbau.version}, 200 if weg else 404)

    def end_headers(self):
        if not getattr(self, "path", "/api/").startswith("/api/"):
            self.send_header("Cache-Control", "no-cache")
        for k, v in SICHERHEIT.items():
            self.send_header(k, v)
        super().end_headers()


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description="Lokaler Live-Server für den Wochenbericht")
    p.add_argument("--demo", action="store_true", help="simulierte Kurse statt Yahoo Finance")
    p.add_argument("--port", type=int, default=8000)
    p.add_argument("--intervall", type=int, default=30, help="Sekunden zwischen zwei Kursabrufen")
    p.add_argument("--ordner", type=Path, help="Website-Ordner (Standard: site/ bzw. site_demo/)")
    p.add_argument("--kein-browser", action="store_true", help="Browser nicht automatisch öffnen")
    p.add_argument("--config", type=Path, default=BASIS / "config.yaml", help="Konfiguration mit der Watchlist")
    args = p.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    from src import umgebung
    umgebung.logs_absichern()  # Secret-Werte nie in der Konsole

    ordner = args.ordner or BASIS / ("site_demo" if args.demo else "site")
    if not (ordner / "index.html").exists() or not (ordner / "daten" / "basis.json").exists():
        log.info("Noch keine Website in %s – erzeuge den Wochenbericht zuerst …", ordner)
        import main as wochenbericht
        rc = wochenbericht.main(["--keine-mail", "--ausgabe", str(ordner), "--config", str(args.config)]
                                + (["--demo"] if args.demo else []))
        if rc:
            return rc

    cfg = yaml.safe_load(args.config.read_text(encoding="utf-8"))
    symbole = [e["symbol"] for e in cfg["watchlist"]]
    quelle = DemoKurse(ordner / "daten" / "basis.json") if args.demo else yahoo_kurse
    speicher = Speicher(quelle, symbole, args.intervall, args.demo)
    threading.Thread(target=speicher.schleife, daemon=True).start()

    Handler.speicher = speicher
    Handler.config = args.config
    Handler.ki_tag = Drossel(ki_tageslimit(), 24 * 3600)
    Handler.kalender = KalenderDienst(ordner / "daten" / "kalender.json", args.demo)
    threading.Thread(target=Handler.kalender.schleife, daemon=True).start()
    if not args.demo:
        from main import finnhub_symbol
        from src import nachrichten
        werte = [{"symbol": e["symbol"], "name": e.get("name") or e["symbol"], "finnhub": finnhub_symbol(e)} for e in cfg["watchlist"]]
        Handler.nachrichten = nachrichten.Dienst(werte)
        threading.Thread(target=Handler.nachrichten.schleife, daemon=True).start()
    Handler.aufbau = Aufbau(ordner, args.demo, args.config, speicher)
    if args.demo:
        from src.demo import DEMO_SUCHE
        Handler.suche = staticmethod(lambda q: [x for x in DEMO_SUCHE
                                                 if q.lower() in (x["symbol"] + " " + x["longname"]).lower()])
    else:
        from src.watchlist import yahoo_suche
        Handler.suche = staticmethod(yahoo_suche)
    if not 1024 <= args.port <= 65535:
        p.error("Port bitte zwischen 1024 und 65535 wählen")
    server = ThreadingHTTPServer(("127.0.0.1", args.port), partial(Handler, directory=str(ordner)))  # nie 0.0.0.0
    server.daemon_threads = True
    adresse = f"http://localhost:{args.port}/"
    print(f"\nLive-Server läuft: {adresse}\n{'Simulierte Kurse' if args.demo else 'Kurse von Yahoo Finance'}, "
          f"alle {args.intervall} s. Beenden mit Strg+C.\n")
    if not args.kein_browser:
        threading.Timer(1.0, lambda: webbrowser.open(adresse)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nBeendet.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
