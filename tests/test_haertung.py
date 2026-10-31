"""Tests für die Härtung aus dem Sicherheits-Audit (AUDIT.md): Umgebungen, Staging-Sperren, Log-Schwärzung,
Grenzen für kostenpflichtige und externe Abrufe, Antwortgrößen und die Smoke-Prüfung der Website."""
from __future__ import annotations

import http.client
import io
import json
import logging
import sys
import threading
import types
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path

import pandas as pd
import pytest

from src import mailer, netz, umgebung


# ---------------------------------------------------------------- Umgebung

def test_umgebung_standard_und_unbekannt(monkeypatch):
    monkeypatch.delenv("FATHOM_UMGEBUNG", raising=False)
    assert umgebung.name() == "development" and umgebung.mail_erlaubt() and umgebung.daten_schreiben_erlaubt()
    monkeypatch.setenv("FATHOM_UMGEBUNG", " Staging ")
    assert umgebung.ist_staging() and not umgebung.mail_erlaubt() and not umgebung.daten_schreiben_erlaubt()
    monkeypatch.setenv("FATHOM_UMGEBUNG", "production")
    assert umgebung.mail_erlaubt() and umgebung.daten_schreiben_erlaubt()
    monkeypatch.setenv("FATHOM_UMGEBUNG", "prod")  # Tippfehler: nicht still wie Production laufen
    with pytest.raises(umgebung.UmgebungFehler):
        umgebung.name()


def test_main_bricht_bei_unbekannter_umgebung_ab(monkeypatch, tmp_path):
    import main as hauptprogramm
    monkeypatch.setenv("FATHOM_UMGEBUNG", "live")
    assert hauptprogramm.main(["--demo", "--keine-mail", "--ausgabe", str(tmp_path / "x")]) == 2
    assert not (tmp_path / "x").exists()


def _smtp_verboten(monkeypatch):
    def nie(*a, **k):
        raise AssertionError("In Staging darf keine SMTP-Verbindung entstehen")
    monkeypatch.setattr("smtplib.SMTP_SSL", nie)
    monkeypatch.setattr("smtplib.SMTP", nie)
    for k, v in {"SMTP_HOST": "smtp.invalid", "SMTP_USER": "absender@example.invalid",
                 "SMTP_PASSWORT": "testpasswort-123456", "MAIL_AN": "empfaenger@example.invalid"}.items():
        monkeypatch.setenv(k, v)


def test_staging_sperrt_mail_auch_mit_smtp_secrets(monkeypatch):
    _smtp_verboten(monkeypatch)
    monkeypatch.setenv("FATHOM_UMGEBUNG", "staging")
    assert mailer.ist_eingerichtet()
    mailer.sende("Betreff", "<p>x</p>", "x")  # darf nichts tun


def test_staging_lauf_ohne_mail_ohne_data_mit_noindex(monkeypatch, tmp_path):
    """Echter (nicht Demo-)Lauf in Staging mit gesetzten SMTP-Secrets: keine Mail, data/ bleibt leer, noindex."""
    import main as hauptprogramm

    class Ticker:
        def __init__(self, symbol):
            self.symbol = symbol
        info = {"currency": "USD"}

        def history(self, period="2y", auto_adjust=True, **kw):
            idx = pd.bdate_range(end="2026-10-14", periods=400)
            return pd.DataFrame({"Close": [50 + (i % 30) for i in range(400)]}, index=idx)

        def __getattr__(self, name):
            raise ConnectionError(f"{name} nicht erreichbar")

    _smtp_verboten(monkeypatch)
    monkeypatch.setenv("FATHOM_UMGEBUNG", "staging")
    monkeypatch.setitem(sys.modules, "yfinance", types.SimpleNamespace(Ticker=Ticker))
    monkeypatch.setattr("src.fetch.time.sleep", lambda s: None)
    monkeypatch.setattr(hauptprogramm, "BASIS", tmp_path)
    gesendet = []
    monkeypatch.setattr(mailer, "sende", lambda *a: gesendet.append(a))
    assert hauptprogramm.main(["--config", "config.yaml", "--ausgabe", str(tmp_path / "site_staging")]) == 0
    assert not gesendet
    assert not (tmp_path / "data").exists()                       # weder historie.csv noch signale.json
    html = (tmp_path / "site_staging" / "index.html").read_text(encoding="utf-8")
    assert '<meta name="robots" content="noindex' in html and 'class="staging-band"' in html
    assert "Disallow: /" in (tmp_path / "site_staging" / "robots.txt").read_text(encoding="utf-8")


def test_production_ohne_staging_merkmale(monkeypatch, tmp_path):
    import main as hauptprogramm
    monkeypatch.setenv("FATHOM_UMGEBUNG", "production")
    assert hauptprogramm.main(["--demo", "--keine-mail", "--ausgabe", str(tmp_path / "site")]) == 0
    html = (tmp_path / "site" / "index.html").read_text(encoding="utf-8")
    assert "noindex" not in html and "staging-band" not in html and not (tmp_path / "site" / "robots.txt").exists()
    from tools.website_pruefen import pruefe
    assert pruefe(tmp_path / "site", staging=False) == []


# ---------------------------------------------------------------- Log-Schwärzung

def test_secret_filter_schwaerzt_werte_argumente_und_adressen(monkeypatch):
    monkeypatch.setenv("FRED_API_KEY", "fredgeheim0123456789")
    monkeypatch.setenv("MAIL_AN", "person@example.invalid")
    monkeypatch.setenv("SMTP_PORT", "465")
    puffer = io.StringIO()
    h = logging.StreamHandler(puffer)
    h.addFilter(umgebung.SecretFilter())
    lg = logging.getLogger("test_haertung")
    lg.addHandler(h)
    lg.propagate = False
    try:
        lg.warning("Abruf %s fehlgeschlagen", "https://api.stlouisfed.org/x?series_id=CPI&api_key=fredgeheim0123456789&f=json")
        lg.warning("Mail an %s", "person@example.invalid")
        lg.warning("FMP https://x.example/q?apikey=anderer-schluessel&y=1 Port 465")
        try:
            raise ValueError("Schlüssel fredgeheim0123456789 abgelehnt")
        except ValueError:
            lg.exception("Fehler")
    finally:
        lg.removeHandler(h)
    text = puffer.getvalue()
    assert "fredgeheim0123456789" not in text and "person@example.invalid" not in text
    assert "anderer-schluessel" not in text and "apikey=***" in text and "series_id=CPI" in text
    assert "Port 465" in text  # kurze Werte (Port) werden nicht überall geschwärzt


# ---------------------------------------------------------------- Grenzen

def test_drossel_gleitendes_fenster():
    import live
    d = live.Drossel(3, 60)
    assert [d.erlaubt(100), d.erlaubt(101), d.erlaubt(102), d.erlaubt(103)] == [True, True, True, False]
    assert d.erlaubt(160.5) and not d.erlaubt(160.6)               # erster Eintrag ist abgelaufen, dann wieder voll
    assert not live.Drossel(0, 60).erlaubt(1)


def test_ki_tageslimit_aus_umgebung(monkeypatch):
    import live
    monkeypatch.delenv("FATHOM_KI_LIMIT_TAG", raising=False)
    assert live.ki_tageslimit() == 100
    monkeypatch.setenv("FATHOM_KI_LIMIT_TAG", "5")
    assert live.ki_tageslimit() == 5
    monkeypatch.setenv("FATHOM_KI_LIMIT_TAG", "viel")
    assert live.ki_tageslimit() == 100
    monkeypatch.setenv("FATHOM_KI_LIMIT_TAG", "-3")
    assert live.ki_tageslimit() == 0


@pytest.fixture()
def live_server(tmp_path, monkeypatch):
    import live

    class Speicher:
        lock = threading.Lock(); kurse, intervall, demo, stand, fehler, tage = {}, 30, True, None, None, {}

    monkeypatch.setattr(live.Handler, "speicher", Speicher(), raising=False)
    monkeypatch.setattr(live.Handler, "config", Path("config.yaml"), raising=False)
    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(live.Handler, directory=str(tmp_path)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    port = server.server_port

    def anfrage(methode, pfad, koerper=None, herkunft=None):
        c = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
        kopf = {"Host": f"127.0.0.1:{port}", "Origin": herkunft or f"http://127.0.0.1:{port}", "Content-Type": "application/json"}
        c.request(methode, pfad, body=(koerper or "").encode() or None, headers=kopf)
        r = c.getresponse()
        return r.status, json.loads(r.read() or b"{}")

    yield live, anfrage
    server.shutdown()
    server.server_close()


def test_suche_hat_ratenlimit(live_server, monkeypatch):
    live, anfrage = live_server
    aufrufe = []
    monkeypatch.setattr(live.Handler, "suche", staticmethod(lambda q: aufrufe.append(q) or []), raising=False)
    monkeypatch.setattr(live.Handler, "such_drossel", live.Drossel(3, 60))
    codes = [anfrage("GET", f"/api/suche?q=ab{i}")[0] for i in range(5)]
    assert codes == [200, 200, 200, 429, 429] and len(aufrufe) == 3   # Yahoo nur dreimal gefragt


def test_ki_deutung_hat_tagesgrenze(live_server, monkeypatch):
    live, anfrage = live_server
    from src import taktik
    aufrufe = []
    monkeypatch.setattr(taktik, "verfuegbar", lambda: True)
    monkeypatch.setattr(taktik, "deute", lambda t, z: aufrufe.append(t) or {"ok": True})
    monkeypatch.setattr(live.Handler, "ki_tag", live.Drossel(2, 24 * 3600))
    koerper = json.dumps({"text": "Ausbruch über Widerstand", "zeichnungen": []})
    ergebnisse = []
    for _ in range(3):
        live.Handler._ki_zuletzt[0] = 0.0          # 3-Sekunden-Abstand für den Test überspringen
        ergebnisse.append(anfrage("POST", "/api/taktik", koerper))
    assert [s for s, _ in ergebnisse] == [200, 200, 429] and len(aufrufe) == 2
    assert "Tagesgrenze" in ergebnisse[2][1]["fehler"]


def test_kerzen_nur_von_dieser_seite_gedrosselt_und_zwischengespeichert(live_server, monkeypatch):
    """api/kerzen (Minuten- und Stundenkerzen für die Chart-Taktik): fremde Seiten abgewiesen, Eingaben geprüft,
    Abrufe gedrosselt und je Kürzel und Intervall kurz zwischengespeichert."""
    live, anfrage = live_server
    from src import intraday
    aufrufe = []
    echt = intraday.demo
    monkeypatch.setattr(intraday, "demo", lambda s, iv, anker: aufrufe.append((s, iv, anker)) or echt(s, iv, anker))
    monkeypatch.setattr(live.Handler, "_kz_cache", {})
    monkeypatch.setattr(live.Handler, "kerzen_drossel", live.Drossel(2, 60))
    monkeypatch.setattr(live.Handler, "aufbau", types.SimpleNamespace(laeuft=False, version=0, fehler=None), raising=False)
    assert anfrage("GET", "/api/status")[1]["kerzen"] is True
    # ungültiges Intervall, ungültiges Kürzel
    assert anfrage("POST", "/api/kerzen", json.dumps({"symbol": "SAP.DE", "intervall": "2m"}))[0] == 400
    assert anfrage("POST", "/api/kerzen", json.dumps({"symbol": "../x", "intervall": "5m"}))[0] == 400
    # fremde Seite: abgewiesen, bevor etwas abgerufen wird
    assert anfrage("POST", "/api/kerzen", json.dumps({"symbol": "SAP.DE", "intervall": "5m"}), herkunft="https://boese.example")[0] == 403
    assert aufrufe == []
    status, antwort = anfrage("POST", "/api/kerzen", json.dumps({"symbol": "SAP.DE", "intervall": "5m", "anker": 200}))
    assert status == 200 and antwort["iv"] == "5m" and antwort["q"].startswith("Demo") and len(antwort["c"]) > 100
    assert aufrufe == [("SAP.DE", "5m", 200.0)]
    assert anfrage("POST", "/api/kerzen", json.dumps({"symbol": "SAP.DE", "intervall": "5m", "anker": 200}))[0] == 200
    assert len(aufrufe) == 1                                    # aus dem Zwischenspeicher
    assert anfrage("POST", "/api/kerzen", json.dumps({"symbol": "AAPL", "intervall": "1m", "anker": True}))[0] == 200
    assert aufrufe[-1] == ("AAPL", "1m", 100.0)                 # Anker ohne Zahl: Standard
    assert anfrage("POST", "/api/kerzen", json.dumps({"symbol": "MSFT", "intervall": "1h"}))[0] == 429   # Drossel: 2 je Minute
    assert len(aufrufe) == 2


def test_intraday_kodierung_exakt_und_robust():
    from src import intraday
    import numpy as np
    idx = pd.date_range("2026-10-01 09:30", periods=5, freq="1min", tz="America/New_York")
    df = pd.DataFrame({"Open": [1, 2, np.nan, 4, 5], "High": [1, 2, 3, 3.5, 5], "Low": [1, 2, 3, 4, 5], "Close": [1, 2.5, 3, 4, 5]}, index=idx)
    r = intraday.kodieren(df, "X", "1m", "Test")
    assert r["t0"] * 60 == int(pd.Timestamp("2026-10-01 13:30", tz="UTC").timestamp())    # Minuten seit 1970 in UTC
    assert r["dt"] == [1, 2, 1] and len(r["c"]) == 4                                     # Zeile mit Lücke entfernt
    f = 10 ** r["dez"]
    assert r["h"][2] == 0                                                                 # Hoch < Schluss korrigiert
    assert r["c"][0] == 1 * f and r["fenster"] == "7 Tage"
    assert intraday.kodieren(df.iloc[:2], "X", "1m", "Test") is None                      # zu wenige Kerzen
    assert intraday.kodieren(None, "X", "1m", "Test") is None


def test_antworten_aus_dem_netz_haben_obergrenze():
    assert netz.lies(io.BytesIO(b"x" * 100), grenze=100) == b"x" * 100
    with pytest.raises(netz.AntwortZuGross):
        netz.lies(io.BytesIO(b"x" * 101), grenze=100)


# ---------------------------------------------------------------- Smoke-Prüfung der Website

def test_website_pruefung_findet_secret_und_fehlendes_noindex(monkeypatch, tmp_path):
    from tools.website_pruefen import pruefe
    ordner = tmp_path / "s"
    (ordner / "assets").mkdir(parents=True)
    (ordner / "assets" / "a.js").write_text("1", encoding="utf-8")
    kopf = '<meta http-equiv="Content-Security-Policy" content="x">'
    (ordner / "index.html").write_text(kopf + '<script src="assets/a.js"></script><script src="assets/fehlt.js"></script>'
                                       + "x" * 10_000 + "schluessel-1234567890", encoding="utf-8")
    monkeypatch.setenv("FINNHUB_API_KEY", "schluessel-1234567890")
    fehler = pruefe(ordner, staging=True)
    assert any("fehlt.js" in f for f in fehler)
    assert any("FINNHUB_API_KEY" in f for f in fehler) and not any("schluessel-1234567890" in f for f in fehler)
    assert any("noindex" in f for f in fehler) and any("robots" in f for f in fehler)
