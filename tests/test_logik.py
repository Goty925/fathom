"""Tests für Kennzahlen und Kriterien. Ausführen mit: pytest"""
import datetime as dt
from pathlib import Path

import numpy as np
import pandas as pd
import pytest
import yaml

from main import baue_kontext, baue_zeilen
from src import historie, kennzahlen, screening
from src.demo import demo_daten

K = {
    "min_boersenwert_mrd_eur": 50, "min_umsatzwachstum": 0.05, "min_gewinnwachstum": 0.0,
    "min_abstand_hoch": 0.20, "max_position_spanne": 0.40,
    "max_kgv_vs_median": 0.80, "min_kursziel_abstand": 0.20,
}


def reihe(werte):
    return pd.Series(werte, index=pd.bdate_range("2025-01-01", periods=len(werte)), dtype=float)


def test_abstand_und_position_in_spanne():
    km = kennzahlen.berechne(reihe([100, 200, 150, 125]))
    assert km["hoch_52w"] == 200 and km["tief_52w"] == 100
    assert km["abstand_hoch"] == pytest.approx(0.375)    # 125 ist 37,5 % unter 200
    assert km["position_spanne"] == pytest.approx(0.25)  # 25 % der Spanne 100–200


def test_rendite_eine_woche():
    km = kennzahlen.berechne(reihe([100, 100, 100, 100, 100, 110]))
    assert km["rendite_1w"] == pytest.approx(0.10)


def test_rsi_grenzen():
    assert kennzahlen.rsi(reihe(range(1, 40))) == 100.0          # nur Anstiege
    assert kennzahlen.rsi(reihe(range(40, 1, -1))) == pytest.approx(0.0, abs=1e-9)  # nur Verluste


def test_lokales_tief():
    assert screening.pruefe_tief(0.30, 0.20, K)["erfuellt"] is True
    assert screening.pruefe_tief(0.10, 0.20, K)["erfuellt"] is False   # zu nah am Hoch
    assert screening.pruefe_tief(0.30, 0.70, K)["erfuellt"] is False   # schon weit erholt
    assert screening.pruefe_tief(None, 0.2, K)["erfuellt"] is None


def test_bewertung_kgv_oder_kursziel():
    assert screening.pruefe_bewertung(10, 25, 0.05, K)["erfuellt"] is True    # KGV günstig
    assert screening.pruefe_bewertung(25, 25, 0.30, K)["erfuellt"] is True    # Kursziel weit weg
    assert screening.pruefe_bewertung(25, 25, 0.05, K)["erfuellt"] is False
    assert screening.pruefe_bewertung(None, None, None, K)["erfuellt"] is None


def test_quartalszahlen():
    assert screening.pruefe_zahlen(0.10, 0.05, K)["erfuellt"] is True
    assert screening.pruefe_zahlen(0.10, -0.05, K)["erfuellt"] is False
    assert screening.pruefe_zahlen(None, None, K)["erfuellt"] is None


def test_zahlen_bald():
    heute = dt.date(2026, 10, 14)
    assert screening.zahlen_bald(dt.date(2026, 10, 21), heute, 21)
    assert not screening.zahlen_bald(dt.date(2026, 12, 1), heute, 21)
    assert not screening.zahlen_bald(None, heute, 21)


def test_ganzer_ablauf_mit_demo_daten():
    wl = [{"symbol": "SAP.DE", "name": "SAP", "typ": "aktie"}, {"symbol": "IUSQ.DE", "name": "ACWI", "typ": "etf"}]
    cfg = {"kriterien": K, "zahlen_warnung_tage": 21, "titel": "Test"}
    roh, fx = demo_daten(wl)
    zeilen, warn = baue_zeilen(roh, fx, cfg, dt.date.today())
    kontext = baue_kontext(zeilen, warn, cfg, dt.date.today(), {}, True, [])
    assert len(kontext["aktien"]) == 1 and len(kontext["etfs"]) == 1
    assert 0 <= kontext["aktien"][0]["punkte"] <= 4


def test_historie_speichern_und_vorwoche(tmp_path):
    pfad = tmp_path / "h.csv"
    z = [{"symbol": "X", "kurs": 10.0, "punkte": 2}]
    historie.speichere(pfad, z, dt.date(2026, 10, 5))
    historie.speichere(pfad, [{"symbol": "X", "kurs": 11.0, "punkte": 3}], dt.date(2026, 10, 12))
    historie.speichere(pfad, [{"symbol": "X", "kurs": 12.0, "punkte": 3}], dt.date(2026, 10, 12))  # Doppellauf
    df = pd.read_csv(pfad)
    assert len(df) == 2
    letzte = historie.lade_letzten_stand(pfad, dt.date(2026, 10, 12))
    assert letzte["X"]["kurs"] == 10.0


def test_mail_wird_mit_html_und_text_verschickt(monkeypatch):
    from src import mailer
    gesendet = {}

    class FakeSMTP:
        def __init__(self, host, port, context=None):
            gesendet["server"] = (host, port)
        def __enter__(self):
            return self
        def __exit__(self, *a):
            return False
        def login(self, user, pw):
            gesendet["login"] = user
        def send_message(self, msg):
            gesendet["msg"] = msg

    monkeypatch.setattr(mailer.smtplib, "SMTP_SSL", FakeSMTP)
    for k, v in {"SMTP_HOST": "smtp.example.com", "SMTP_PORT": "", "SMTP_USER": "ich@example.com",
                 "SMTP_PASSWORT": "geheim", "MAIL_AN": "ich@example.com"}.items():
        monkeypatch.setenv(k, v)
    mailer.sende("Betreff", "<p>Hallo</p>", "Hallo")
    assert gesendet["server"] == ("smtp.example.com", 465)   # leerer Port → 465
    assert gesendet["msg"]["Subject"] == "Betreff"
    assert {p.get_content_type() for p in gesendet["msg"].iter_parts()} == {"text/plain", "text/html"}


def test_ohne_zugangsdaten_keine_mail(monkeypatch):
    from src import mailer
    for k in mailer.NOETIG:
        monkeypatch.delenv(k, raising=False)
    mailer.sende("x", "y", "z")  # darf keinen Fehler werfen


def test_abruf_mit_nachgebautem_yahoo(monkeypatch):
    """Prüft fetch.py ohne Internet: ein Fake-Ticker liefert Yahoo-ähnliche Daten."""
    import sys
    import types

    from src import fetch

    class FakeTicker:
        def __init__(self, symbol):
            self.symbol = symbol
        info = {"shortName": "Test AG", "currency": "USD", "marketCap": 1e11, "forwardPE": 12.0,
                "trailingPE": 15.0, "revenueGrowth": 0.1, "earningsGrowth": 0.2, "numberOfAnalystOpinions": 9,
                "recommendationKey": "buy"}
        analyst_price_targets = {"mean": 120.0, "low": 90.0, "high": 150.0, "current": 100.0}
        earnings_estimate = pd.DataFrame({"growth": [0.1, 0.15]}, index=["0y", "+1y"])
        calendar = {"Earnings Date": [dt.date.today() + dt.timedelta(days=5)]}

        def history(self, period="2y", auto_adjust=True, **kw):
            idx = pd.bdate_range(end="2026-10-14", periods=300, tz="America/New_York")
            return pd.DataFrame({"Close": [100.0] * 300}, index=idx)

        def get_valuation_measures(self, freq="quarterly", periods=20):
            cols = ["Current"] + [f"{m}/30/2025" for m in range(1, 13)]
            return pd.DataFrame([[12.0] + [20.0] * 12], index=["Forward P/E"], columns=cols)

    class KaputterTicker(FakeTicker):
        @property
        def info(self):
            raise ConnectionError("Yahoo nicht erreichbar")

    fake_yf = types.SimpleNamespace(Ticker=lambda s: KaputterTicker(s) if s == "KAPUTT" else FakeTicker(s))
    monkeypatch.setitem(sys.modules, "yfinance", fake_yf)

    d = fetch.hole_aktie("TEST")
    assert d["forward_kgv_median_5j"] == 20.0
    assert d["kursziel_mittel"] == 120.0 and d["eps_wachstum_naechstes_jahr"] == 0.15
    assert d["kurse"].index.tz is None and len(d["kurse"]) == 300
    assert d["naechste_zahlen"] is not None

    kaputt = fetch.hole_aktie("KAPUTT")   # darf nicht abstürzen
    assert kaputt["boersenwert"] is None and len(kaputt["kurse"]) == 300


def test_max_rueckgang_und_knockout():
    k = reihe([100, 120, 90, 95, 130])
    assert kennzahlen.max_rueckgang(k) == pytest.approx(0.25)  # 120 → 90
    # Kurs fällt in 10 Tagen um 30 %: Hebel 5 (Schwelle 20 %) wird ausgelöst, Hebel 2 (50 %) nicht
    fallend = reihe([100] * 30 + [70] * 30)
    assert kennzahlen.knockout_haeufigkeit(fallend, 5) > 0
    assert kennzahlen.knockout_haeufigkeit(fallend, 2) == 0


def test_einordnung_nennt_zahlen():
    from src import einordnung
    z = {"umsatzwachstum": 0.13, "gewinnwachstum": -0.05, "forward_kgv": 10, "forward_kgv_median_5j": 20,
         "kursziel_abstand": 0.25, "abstand_gd200": -0.10, "rsi14": 25, "volatilitaet": 0.5,
         "zahlen_bald": True, "naechste_zahlen": dt.date(2026, 10, 21), "schaetzungen": [], "eps_historie": []}
    e = einordnung.einordnen(z, 21)
    text = " ".join(e["dafuer"] + e["dagegen"])
    assert "+13 %" in text and "21.10.2026" in text
    assert any("geschrumpft" in s for s in e["dagegen"])
    assert any("unter dem eigenen 5-Jahres-Median" in s for s in e["dafuer"])


def test_website_eine_seite_mit_analyse_panels(tmp_path):
    import json
    import re
    import yaml
    from src import render
    cfg = yaml.safe_load(open("config.yaml", encoding="utf-8"))
    roh, fx = demo_daten(cfg["watchlist"])
    zeilen, warn = baue_zeilen(roh, fx, cfg, dt.date.today())
    kontext = baue_kontext(zeilen, warn, cfg, dt.date.today(), {}, True, [])
    render.schreibe_website(kontext, tmp_path)

    assert [x.name for x in tmp_path.rglob("*.html")] == ["index.html"]  # alles auf einer Seite
    html = (tmp_path / "index.html").read_text(encoding="utf-8")
    for ziel in re.findall(r'(?:href|src)="([^"#:]+)"', html):  # relative Dateien existieren
        assert (tmp_path / ziel).exists(), f"toter Link {ziel}"
    for e in cfg["watchlist"]:  # je Wert eine Zeile und ein Analyse-Panel, Anker passen zusammen
        sl = render.slug(e["symbol"])
        assert f'id="analyse-{sl}"' in html and f'data-href="#{sl}"' in html
    assert "Was ein Hebel" in html and "{{" not in html
    # Taskleiste: Home oben, Konto unten, das Konto-Skript wird geladen (tote Links prüft die Schleife oben)
    for w in ("home", "work", "backtest", "kriterien", "konto"):
        assert f'data-dock="{w}"' in html
    assert "assets/konto.js" in html and (tmp_path / "assets" / "schrift" / "bricolage-grotesque-variable.woff2").exists()
    # Kerzen: Kursdateien und 12-Monats-Chart tragen Eröffnung, Hoch und Tief (Portfolio Performance liest weiter date/close)
    feed = json.loads((tmp_path / "daten" / "kurse" / "adbe.json").read_text(encoding="utf-8"))
    assert {"date", "close", "open", "high", "low"} <= set(feed[-1]) and feed[-1]["low"] <= feed[-1]["close"] <= feed[-1]["high"]
    for datei in ("kerzen.js", "taktik-kern.js", "zeichnen.js"):
        assert f"assets/{datei}" in html
    basis = json.loads((tmp_path / "daten" / "basis.json").read_text(encoding="utf-8"))
    assert basis["werte"]["adbe"]["finnhub"] == "ADBE"       # US-Aktie: Finnhub-Echtzeit möglich
    assert basis["werte"]["sap-de"]["finnhub"] is None       # Xetra: nur über Yahoo
    assert basis["werte"]["adbe"]["kurs"] > 0 and "kriterien" in basis


def test_live_server_yahoo_auswertung(monkeypatch):
    """live.py: aus 1-Minuten-Daten werden Kurs, Vortag und Tagesverlauf."""
    import sys
    import types
    import live

    idx = pd.date_range("2026-10-13 15:30", periods=4, freq="min", tz="America/New_York").append(
        pd.date_range("2026-10-14 09:30", periods=12, freq="min", tz="America/New_York"))
    spalten = pd.MultiIndex.from_product([["MSFT", "SAP.DE"], ["Close"]])
    werte = [[100 + i, 200 + i] for i in range(len(idx))]
    df = pd.DataFrame(werte, index=idx, columns=spalten)
    df.loc[idx[-1], ("SAP.DE", "Close")] = float("nan")  # fehlender letzter Wert wird übersprungen
    monkeypatch.setitem(sys.modules, "yfinance", types.SimpleNamespace(download=lambda *a, **k: df))
    kurse, tage = live.yahoo_kurse(["MSFT", "SAP.DE", "FEHLT"])
    assert kurse["MSFT"]["kurs"] == 115 and kurse["MSFT"]["vortag"] == 103
    assert kurse["SAP.DE"]["kurs"] == 214
    assert "FEHLT" not in kurse and len(tage["MSFT"]["x"]) >= 2
    assert "o" not in tage["MSFT"]  # nur Schlusskurse geliefert: keine Kerzen
    # Mit Eröffnung, Hoch und Tief entstehen 5-Minuten-Kerzen
    spalten = pd.MultiIndex.from_product([["MSFT"], ["Open", "High", "Low", "Close"]])
    df = pd.DataFrame([[100 + i, 101 + i, 99 + i, 100.5 + i] for i in range(len(idx))], index=idx, columns=spalten)
    monkeypatch.setitem(sys.modules, "yfinance", types.SimpleNamespace(download=lambda *a, **k: df))
    _, tage = live.yahoo_kurse(["MSFT"])
    t = tage["MSFT"]
    assert len(t["o"]) == len(t["x"]) and t["o"][0] == 104 and t["h"][0] == 109 and t["l"][0] == 103 and t["y"][0] == 108.5


def test_live_server_liefert_api(tmp_path):
    import json
    import threading
    import urllib.request
    from functools import partial
    from http.server import ThreadingHTTPServer
    import live

    (tmp_path / "daten").mkdir()
    (tmp_path / "daten" / "basis.json").write_text(json.dumps({"werte": {"x": {"symbol": "X", "kurs": 50.0}}}))
    (tmp_path / "index.html").write_text("<p>ok</p>")
    sp = live.Speicher(live.DemoKurse(tmp_path / "daten" / "basis.json"), ["X"], 15, True)
    sp.kurse, sp.tage = sp.quelle(["X"])
    live.Handler.speicher = sp
    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(live.Handler, directory=str(tmp_path)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{server.server_address[1]}"
    try:
        d = json.load(urllib.request.urlopen(url + "/api/kurse"))
        assert d["demo"] is True and d["werte"]["X"]["kurs"] > 0
        assert json.load(urllib.request.urlopen(url + "/api/tag?symbol=X"))["x"]
        assert b"ok" in urllib.request.urlopen(url + "/").read()
    finally:
        server.shutdown()


def test_email_enthaelt_fazit_und_links():
    import yaml
    from src import render
    cfg = yaml.safe_load(open("config.yaml", encoding="utf-8")) | {"website_url": "https://beispiel.github.io/wochenbericht"}
    roh, fx = demo_daten(cfg["watchlist"])
    zeilen, warn = baue_zeilen(roh, fx, cfg, dt.date.today())
    kontext = baue_kontext(zeilen, warn, cfg, dt.date.today(), {}, True, [])
    html = render.email_html(kontext)
    assert "https://beispiel.github.io/wochenbericht/#sap-de" in html
    assert "Signale" in html and "Demo-Daten" in html


def test_bericht_mit_lueckenhaften_yahoo_daten(monkeypatch, tmp_path):
    """Wenn Yahoo fast nichts liefert, entsteht trotzdem ein vollständiger Bericht."""
    import sys
    import types

    import main as hauptprogramm

    class MagererTicker:
        def __init__(self, symbol):
            self.symbol = symbol
        info = {"currency": "USD"}

        def history(self, period="2y", auto_adjust=True, **kw):
            idx = pd.bdate_range(end="2026-10-14", periods=400)
            return pd.DataFrame({"Close": [50 + (i % 30) for i in range(400)]}, index=idx)

        def __getattr__(self, name):  # alles andere: Fehler wie bei einem Yahoo-Ausfall
            raise ConnectionError(f"{name} nicht erreichbar")

    monkeypatch.setitem(sys.modules, "yfinance", types.SimpleNamespace(Ticker=MagererTicker))
    monkeypatch.setattr("src.fetch.time.sleep", lambda s: None)
    monkeypatch.setattr(hauptprogramm, "BASIS", tmp_path)  # Historie nicht ins echte data/ schreiben
    rc = hauptprogramm.main(["--keine-mail", "--config", "config.yaml", "--ausgabe", str(tmp_path / "site")])
    assert rc == 0
    html = (tmp_path / "site" / "index.html").read_text(encoding="utf-8")
    assert 'id="analyse-msft"' in html and "Daten fehlen" in html


def test_staerke_passt_zur_pruefung():
    """Balken ab halber Füllung genau dann, wenn das Kriterium erfüllt ist."""
    import itertools
    werte = [-0.4, -0.1, 0.0, 0.03, 0.05, 0.1, 0.2, 0.35, 0.6, 0.9, None]
    for u, g in itertools.product(werte, werte):
        p = screening.pruefe_zahlen(u, g, K)
        if p["erfuellt"] is not None:
            assert (p["staerke"] >= 50) == p["erfuellt"], (u, g, p)
    for a, pos in itertools.product([0.0, 0.1, 0.2, 0.25, 0.5, 0.8], [0.0, 0.2, 0.4, 0.41, 0.7, 1.0]):
        p = screening.pruefe_tief(a, pos, K)
        assert (p["staerke"] >= 50) == p["erfuellt"], (a, pos, p)
    for kgv, ziel in itertools.product([None, 5, 15, 20, 24, 30, 40], [None, -0.2, 0.0, 0.19, 0.2, 0.4, 0.9]):
        p = screening.pruefe_bewertung(kgv, 25 if kgv else None, ziel, K)
        if p["erfuellt"] is not None:
            assert (p["staerke"] >= 50) == p["erfuellt"], (kgv, ziel, p)
            assert 0 <= p["staerke"] <= 100
    for w in [1e9, 3e10, 5e10, 4e11, 5e12]:
        p = screening.pruefe_groesse(w, K)
        assert (p["staerke"] >= 50) == p["erfuellt"]


def test_suche_gruppiert_und_filtert_deutsche_handelbarkeit():
    from src import watchlist
    from src.demo import DEMO_SUCHE
    treffer = {t["symbol"]: t for t in watchlist.gruppiere(DEMO_SUCHE)}
    assert treffer["AAPL"]["de_handelbar"] and "Xetra" in treffer["AAPL"]["de_boersen"]   # Heimatbörse für Daten
    assert treffer["AAPL"]["de_symbol"] == "APC.DE"
    assert "SMCI" not in treffer                     # nur in den USA gelistet: herausgefiltert
    assert treffer["ALV.DE"]["typ"] == "aktie"       # deutsche Aktie: Xetra-Kürzel
    assert treffer["EURUSD=X"]["typ"] == "forex" and treffer["GC=F"]["typ"] == "rohstoff"
    assert treffer["ES=F"]["typ"] == "index" and treffer["^GDAXI"]["typ"] == "index"
    assert treffer["EUNL.DE"]["typ"] == "etf"


def test_watchlist_hinzufuegen_und_entfernen_erhaelt_kommentare(tmp_path):
    import shutil
    import yaml
    from src import watchlist
    pfad = tmp_path / "config.yaml"
    shutil.copy("config.yaml", pfad)
    vorher = pfad.read_text(encoding="utf-8")
    assert watchlist.hinzufuegen(pfad, "AAPL", "Apple Inc.", "aktie") is True
    assert watchlist.hinzufuegen(pfad, "aapl", "Apple", "aktie") is False          # doppelt
    cfg = yaml.safe_load(pfad.read_text(encoding="utf-8"))
    assert cfg["watchlist"][-1] == {"symbol": "AAPL", "name": "Apple Inc.", "typ": "aktie"}
    assert "kriterien" in cfg and "# Zehn Kriterien je Anlageklasse" in pfad.read_text(encoding="utf-8")
    assert watchlist.entfernen(pfad, "AAPL") is True
    assert pfad.read_text(encoding="utf-8") == vorher                                 # exakt wie vorher
    with pytest.raises(ValueError):
        watchlist.hinzufuegen(pfad, "bad symbol; rm", "x", "aktie")


def test_klassen_signale_und_erwartung():
    import yaml
    from src import klassen
    cfg = yaml.safe_load(open("config.yaml", encoding="utf-8"))
    roh, fx = demo_daten(cfg["watchlist"])
    from src.demo import DEMO_LEITZINSEN
    zeilen, _ = baue_zeilen(roh, fx, cfg, dt.date.today(), DEMO_LEITZINSEN)
    z = {x["symbol"]: x for x in zeilen}
    carry = z["EURUSD=X"]["bewertung"]["pruefungen"]["Carry"]
    assert carry["erfuellt"] is False and abs(z["EURUSD=X"]["zinsdifferenz"] - (0.025 - 0.03875)) < 1e-9
    assert z["EURJPY=X"]["zinsdifferenz"] > 0.01
    for s in ("GC=F", "^GDAXI", "EURCHF=X"):
        for p in z[s]["bewertung"]["pruefungen"].values():
            if p["erfuellt"] is not None:
                assert (p["staerke"] >= 50) == p["erfuellt"], (s, p)
    assert klassen.paar("JPY=X") == ("USD", "JPY") and klassen.paar("^GDAXI") is None
    e = z["ADBE"]["erwartung"]
    assert e["eps_veraenderung"] is not None and e["finnhub_eps"] is not None
    assert z["SAP.DE"]["erwartung"]["finnhub_eps"] is None          # Finnhub nur für US-Aktien


def test_eulerpool_auswertung_tolerant():
    from src import eulerpool
    import datetime as dt
    s = eulerpool.schaetzungen([
        {"period": "2025-12-31", "year": 2025, "epsEstimate": 2.0, "revenueEstimate": 100e9},
        {"period": "2026-12-31", "year": 2026, "epsEstimate": 2.2, "revenueEstimate": 110e9, "epsAnalysts": 12},
        {"period": "2027-12-31", "year": 2027, "epsEstimate": 2.64, "revenueEstimate": 121e9},
    ], heute=dt.date(2026, 10, 14))
    assert [x["periode"] for x in s] == ["Laufendes Geschäftsjahr", "Nächstes Geschäftsjahr"]
    assert abs(s[0]["eps_wachstum"] - 0.10) < 1e-9 and abs(s[1]["eps_wachstum"] - 0.20) < 1e-9
    k = eulerpool.kurse({"t": [1700000000 + i * 86400 for i in range(30)], "c": [100 + i for i in range(30)]})
    assert len(k) == 30 and k.iloc[-1] == 129
    assert eulerpool.kurse({"t": [], "c": []}) is None
    p = eulerpool.profil({"Name": "Adobe Inc.", "marketCap": 200000, "Sector": "Technology"})
    assert p["name"] == "Adobe Inc." and p["boersenwert"] == 2e11 and p["sektor"] == "Technology"
    b = eulerpool.bewertungshistorie({"valuationData": [{"period": "2023", "kgv": 30.1}], "revenue": {"2023": 19409}})
    assert b["multiples"][2023]["kgv"] == 30.1 and b["umsatz"][2023] == 19409
    assert eulerpool.hole("US00724F1012") == {}          # ohne Schlüssel: nichts, Yahoo springt ein


def test_links_und_tradingview_symbole():
    from src import links
    assert links.tradingview_symbol({"symbol": "SAP.DE"}) == "XETR:SAP"
    assert links.tradingview_symbol({"symbol": "2899.HK"}) == "HKEX:2899"
    assert links.tradingview_symbol({"symbol": "ADBE", "boerse": "NMS"}) == "NASDAQ:ADBE"
    assert links.tradingview_symbol({"symbol": "EURUSD=X"}) == "FX:EURUSD"
    assert links.tradingview_symbol({"symbol": "JPY=X"}) == "FX:USDJPY"
    assert links.tradingview_symbol({"symbol": "GC=F"}) == "COMEX:GC1!"
    l = {x["name"]: x for x in links.plattformen({"symbol": "ADBE", "name": "Adobe", "isin": "US00724F1012", "typ": "aktie", "boerse": "NMS"})}
    assert len(l) == 11
    assert l["onvista"]["url"] == "https://www.onvista.de/aktien/US00724F1012"
    assert l["Finviz"]["url"].endswith("t=ADBE") and l["Eulerpool"]["url"].endswith("Adobe-Stock-US00724F1012")
    assert "Finviz" not in {x["name"] for x in links.plattformen({"symbol": "SAP.DE", "name": "SAP", "typ": "aktie"})}


def test_technik_terminal_snowflake():
    from src import kennzahlen, snowflake, terminal
    import numpy as np
    steigend = reihe(list(np.linspace(100, 200, 300)))
    t = kennzahlen.technik(steigend)
    assert t["ma_fazit"]["fazit"] == "Starker Kauf" and t["kaufen"] + t["verkaufen"] + t["neutral"] == 19
    assert kennzahlen.technik(reihe([1.0] * 100)) is None
    z = {"jahreszahlen": [{"jahr": 2023, "ende": dt.date(2023, 12, 29), "umsatz": 100.0, "eps": 2.0, "fcf": 10.0, "ebitda": 30.0,
                           "schulden": 20.0, "cash": 10.0, "aktien": 10.0, "nettogewinn": 20.0},
                          {"jahr": 2024, "ende": dt.date(2024, 12, 31), "umsatz": 120.0, "eps": 2.5, "fcf": 12.0, "ebitda": 36.0,
                           "schulden": 20.0, "cash": 10.0, "aktien": 10.0, "nettogewinn": 25.0}], "waehrung": "EUR"}
    z["jahreswerte"] = terminal.jahreswerte(z)
    assert abs(z["jahreswerte"][1]["umsatz_wachstum"] - 0.2) < 1e-9
    kurse = pd.Series([40.0, 50.0], index=pd.to_datetime(["2023-12-29", "2024-12-31"]))
    m = {r["jahr"]: r for r in terminal.multiples(z, kurse, {"EUR": 1.0})}
    assert m[2024]["kgv"] == 20.0 and m[2024]["kuv"] == 500 / 120 and abs(m[2024]["ev_ebitda"] - 510 / 36) < 1e-9
    sf = snowflake.berechne({"forward_kgv": 14, "forward_kgv_median_5j": 20, "kursziel_abstand": 0.3,
                             "bilanz": {"verschuldungsgrad": 0.2, "schulden": 1, "liquide_mittel": 2, "freier_cashflow": 5},
                             "multiples": {"peg": 1.0, "dividendenrendite": 0.0}})
    assert sf["achsen"]["Bewertung"] > 70 and sf["achsen"]["Gesundheit"] > 90 and sf["achsen"]["Dividende"] == 0


def test_signal_protokoll_vergleicht_und_speichert(tmp_path):
    from src import protokoll
    jetzt = {"A": {"name": "Alpha", "typ": "aktie", "punkte": 3, "signale": {
                "Pullback": {"e": True, "s": 60, "t": "Drawdown 25 %"}, "Large Cap": {"e": True, "s": 80, "t": ""},
                "Valuation Gap": {"e": True, "s": 55, "t": ""}, "Earnings Momentum": {"e": None, "s": None, "t": ""}}},
             "B": {"name": "Beta", "typ": "index", "punkte": 1, "signale": {"Trend": {"e": False, "s": 30, "t": "−2 %"}}},
             "C": {"name": "Neu", "typ": "aktie", "punkte": 0, "signale": {}}}
    vorher = {"A": {"punkte": 2, "signale": {"Pullback": {"e": False}, "Large Cap": {"e": True}, "Valuation Gap": {"e": True},
                                              "Earnings Momentum": {"e": False}}},
              "B": {"punkte": 2, "signale": {"Trend": {"e": True}}}}
    v = protokoll.vergleiche(jetzt, vorher, dt.date(2026, 10, 9), "gespeichert")
    assert [e["name"] for e in v["eintraege"]] == ["Alpha", "Beta"]
    assert v["eintraege"][0]["schwelle"] == "rein" and v["eintraege"][0]["gewonnen"][0]["signal"] == "Pullback"
    assert v["eintraege"][1]["verloren"][0]["signal"] == "Trend"
    assert v["gewonnen"] == 1 and v["verloren"] == 1 and v["neu"] == ["Neu"]   # fehlende Daten zählen nicht als Wechsel
    pfad = tmp_path / "signale.json"
    protokoll.speichere(pfad, dt.date(2026, 10, 9), vorher)
    assert protokoll.lade_vorwoche(pfad, dt.date(2026, 10, 16))[0] == dt.date(2026, 10, 9)
    assert protokoll.lade_vorwoche(pfad, dt.date(2026, 10, 10)) is None       # zu jung für einen Wochenvergleich


def test_vorwoche_neu_berechnet_mit_alten_kursen():
    from src import protokoll
    idx = pd.bdate_range("2024-01-01", periods=400)
    kurse = pd.Series([100.0] * 395 + [80.0] * 5, index=idx)
    z = {"kurs": 80.0, "boersenwert_eur": 80e9, "forward_kgv": 16.0, "kursziel_mittel": 100.0}
    alt = protokoll.zeile_vor(z, kurse)
    assert alt["kurs"] == 100.0 and alt["abstand_hoch"] == pytest.approx(0.0)
    assert alt["boersenwert_eur"] == pytest.approx(100e9) and alt["forward_kgv"] == pytest.approx(20.0)
    assert alt["kursziel_abstand"] == pytest.approx(0.0)


def test_pruefstand_rechnet_wie_der_wochenbericht():
    import yaml
    from src import kriterien, pruefstand
    rng = np.random.default_rng(3)
    idx = pd.bdate_range("2016-01-01", periods=2000)
    kurse = pd.Series(100 * np.exp(np.cumsum(rng.normal(0.0003, 0.012, len(idx)))), index=idx)
    df = pruefstand.reihen(kurse)
    f, km = kennzahlen.faktoren(kurse), kennzahlen.berechne(kurse)
    letzte = df.iloc[-1]
    for s in ("momentum_12_1", "abweichung_mittel_5j", "abstand_gd200"):
        assert letzte[s] == pytest.approx(f[s], rel=1e-9)
    assert letzte["abstand_hoch"] == pytest.approx(km["abstand_hoch"]) and letzte["position_spanne"] == pytest.approx(km["position_spanne"])
    assert letzte["vol_1m"] == pytest.approx(f["vol_1m"], rel=1e-9)
    cfg = kriterien.mit_standard(yaml.safe_load(open("config.yaml", encoding="utf-8")))
    roh = [{"symbol": "^X", "kurse": kurse}]
    erg = pruefstand.berechne(roh, [{"symbol": "^X", "typ": "index"}], cfg)["index"]
    namen = [z["signal"] for z in erg["zeilen"]]
    assert namen == ["Trend", "Momentum", "Pullback", "Vol-Regime", "Kurzfrist-Momentum", "Kombination"]
    assert letzte["rendite_3m"] == pytest.approx(km["rendite_3m"])
    x = erg["zeilen"][0]["h"]["6M"]
    assert x["n_ja"] + x["n_nein"] > 50 and 0 <= x["quote_ja"] <= 1


def test_katalog_rechnet_die_bisherigen_signale_genau_nach():
    """Die vier bisherigen Signale je Klasse ergeben im Katalog dieselben Ergebnisse wie die alten Funktionen."""
    import yaml
    from src import klassen, kriterien
    from src.demo import DEMO_LEITZINSEN, DEMO_MARKT
    cfg = kriterien.mit_standard(yaml.safe_load(open("config.yaml", encoding="utf-8")))
    roh, fx = demo_daten(cfg["watchlist"])
    zeilen, _ = baue_zeilen(roh, fx, cfg, dt.date.today(), DEMO_LEITZINSEN, DEMO_MARKT)
    geprueft = 0
    for z in zeilen:
        if z["typ"] == "aktie":
            alt = screening.bewerte(z, cfg["kriterien"])["pruefungen"]
        elif z["typ"] in ("forex", "rohstoff", "index"):
            alt = klassen.bewerte(z, z["typ"], cfg[f"kriterien_{z['typ']}"], DEMO_LEITZINSEN)["pruefungen"]
        else:
            continue
        for name, p in alt.items():
            neu = z["katalog"][name]
            assert neu["erfuellt"] == p["erfuellt"], (z["symbol"], name)
            assert (neu["staerke"] is None) == (p["staerke"] is None)
            if p["staerke"] is not None:
                assert neu["staerke"] == pytest.approx(p["staerke"], abs=1e-9), (z["symbol"], name)
            geprueft += 1
        assert len(z["katalog"]) == 10
    assert geprueft >= 60


def test_auswahl_pflicht_und_treffer():
    from src import kriterien
    cfg = kriterien.mit_standard({"auswahl": {"aktie": {"zaehlt": ["Large Cap", "Pullback"], "pflicht": ["Profitabilität"], "treffer_ab": 2}}})
    kat = {k["name"]: {"erfuellt": False} for k in kriterien.KATALOG["aktie"]}
    kat["Large Cap"]["erfuellt"] = kat["Pullback"]["erfuellt"] = True
    b = kriterien.bewertung("aktie", kat, cfg)
    assert b["punkte"] == 2 and b["max_punkte"] == 3 and not b["treffer"]      # Pflicht nicht erfüllt
    kat["Profitabilität"]["erfuellt"] = True
    assert kriterien.bewertung("aktie", kat, cfg)["treffer"]
    assert cfg["auswahl"]["forex"]["treffer_ab"] == 3 and len(cfg["auswahl"]["forex"]["zaehlt"]) == 4
    assert kriterien.fmt(0.0125, "pp") == "+1,25 Pp." and kriterien.fmt(-0.034, "p1v") == "−3,4 %"


def test_marktdaten_auswerten():
    from src import markt
    assert markt.lies_fred("observation_date,BAMLH0A0HYM2\n2026-10-15,3.10\n2026-10-16,.\n2026-10-17,3.05\n") == (dt.date(2026, 10, 17), 3.05)
    csv_text = "FREQ,REF_AREA,TIME_PERIOD,OBS_VALUE\nD,US,2026-07-01,4.375\nD,US,2026-07-20,4.125\nD,XM,2026-07-18,2.75\n"
    assert markt.lies_bis(csv_text, {"US": "USD", "XM": "EUR"}, dt.date(2026, 7, 19)) == {"USD": 4.125, "EUR": 2.75}
    k = markt.kontrakte("GC=F", dt.date(2026, 10, 18), 2)
    assert [x[0] for x in k] == ["GCZ26.CMX", "GCG27.CMX"]
    roll, monate = markt.roll_rendite(100.0, 99.0, k[0][1], k[1][1])
    assert monate == 2 and roll == pytest.approx((100 / 99 - 1) * 6)
    eintraege = [{"report_date_as_yyyy_mm_dd": f"2026-{1 + i // 4:02d}-{1 + (i % 4) * 7:02d}T00:00:00.000",
                  "m_money_positions_long_all": str(100 + i), "m_money_positions_short_all": "50", "open_interest_all": "1000"}
                 for i in range(30)]
    c = markt.lies_cot(eintraege)
    assert c["perzentil"] == 1.0 and c["netto"] == pytest.approx(0.079)


def test_backtest_reaktionstag_ohne_blick_in_die_zukunft():
    """Zahlen vor Börsenbeginn zählen am selben Tag, danach (oder ohne Uhrzeit) erst am nächsten Handelstag."""
    from src import backtest
    tage = pd.bdate_range("2026-01-05", periods=10)  # Mo 5.1. …
    ny = lambda s: pd.Timestamp(s, tz="America/New_York")  # noqa: E731
    assert backtest.reaktionstag(ny("2026-01-06 07:00"), tage, "MSFT") == 1   # vor 9:30 → Dienstag
    assert backtest.reaktionstag(ny("2026-01-06 16:05"), tage, "MSFT") == 2   # nach Schluss → Mittwoch
    assert backtest.reaktionstag(ny("2026-01-06 00:00"), tage, "MSFT") == 2   # Uhrzeit unbekannt → vorsichtig
    assert backtest.reaktionstag(ny("2026-01-10 08:00"), tage, "MSFT") == 5   # Samstag → Montag
    # SAP meldet 07:00 Uhr deutscher Zeit (01:00 New York): vor Xetra-Beginn → selber Tag
    assert backtest.reaktionstag(ny("2026-01-06 01:00"), tage, "SAP.DE") == 1
    # 05:00 New York = 11:00 Uhr in Frankfurt: Xetra handelt schon → nächster Tag
    assert backtest.reaktionstag(ny("2026-01-06 05:00"), tage, "SAP.DE") == 2


def test_backtest_kodierung_laesst_sich_zurueckrechnen():
    """Ganze Zahlen in Punkten, Abstände und Öffnungszeiten ergeben exakt die Ausgangskurse."""
    from src import backtest
    idx = pd.bdate_range(end="2026-10-16", periods=300)
    c = pd.Series([100 + i * 0.37 for i in range(300)], index=idx)
    df = pd.DataFrame({"Open": c * 0.99, "High": c * 1.02, "Low": c * 0.97, "Close": c})
    zeit = pd.Timestamp(idx[100].date()).tz_localize("America/New_York") + pd.Timedelta(hours=16, minutes=5)
    w = backtest.kodiere({"symbol": "TEST", "name": "Test", "typ": "aktie", "ohlc": df, "kurse": c,
                          "zahlen_historie": [{"zeit": zeit, "schaetzung": 1.0, "ist": 1.1}]}, dt.date(2026, 10, 18))
    tage = [w["d0"]]
    for d in w["dd"]:
        tage.append(tage[-1] + d)
    assert dt.date(1970, 1, 1) + dt.timedelta(days=tage[-1]) == dt.date(2026, 10, 16)
    f = 10 ** w["dez"]
    schluss = np.cumsum(w["c"]) / f
    assert np.allclose(schluss, c.to_numpy(), atol=0.6 / f)
    assert abs((w["c"][0] + w["o"][0]) / f - c.iloc[0] * 0.99) < 1 / f
    # Öffnung 9:30 New York als Minute UTC (Sommer- und Winterzeit)
    erste = dt.datetime.fromtimestamp(w["t0"] * 60, dt.timezone.utc)
    assert erste.astimezone(backtest.ZoneInfo("America/New_York")).strftime("%H:%M") == "09:30"
    assert w["sl"] == 390 and w["e"] == [[101, 1.0, 1.1, idx[100].date().isoformat()]]
    nur = backtest.kodiere({"symbol": "X", "kurse": c}, dt.date(2026, 10, 18))
    assert nur["nur_schluss"] and set(nur["o"]) == {0}


def test_oanda_kerzen_und_handelstag():
    """OANDA-Antwort lesen; Tageskerze ab 17 Uhr New York gehört zum Folgetag; Minutenfenster enden zur vollen Stunde."""
    from src import backtest, oanda
    antwort = {"candles": [
        {"complete": True, "time": "2026-01-11T22:00:00.000000000Z", "bid": {"o": "1.08561", "h": "1.09000", "l": "1.08000", "c": "1.08800"},
         "ask": {"o": "1.08571", "h": "1.09010", "l": "1.08010", "c": "1.08812"}},
        {"complete": False, "time": "2026-01-12T22:00:00.000000000Z", "bid": {"o": "1", "h": "1", "l": "1", "c": "1"}, "ask": {"o": "1", "h": "1", "l": "1", "c": "1"}}]}
    k = oanda.lies_kerzen(antwort)
    assert len(k) == 1 and oanda.stellen(antwort) == 5
    tag = backtest.oanda_tage({"tag": k})
    assert tag.index[0].date() == dt.date(2026, 1, 12)  # Sonntag 17 Uhr New York → Handelstag Montag
    assert abs(tag["Spread"].iloc[0] - 0.00011) < 1e-9 and abs(tag["Close"].iloc[0] - 1.08806) < 1e-9
    t = int(dt.datetime(2026, 1, 13, 13, 30, tzinfo=dt.timezone.utc).timestamp() // 60)
    assert (oanda.fenster_ende(t) - t) >= 240 and oanda.fenster_ende(t) % 60 == 0


def test_wirtschaftsdaten_wie_am_tag_der_veroeffentlichung():
    """ALFRED-Fassungen: Ist-Wert der Erstveröffentlichung, Vorwert wie damals bekannt, 8:30 Uhr New York."""
    from src import wirtschaft
    b = []
    def fassung(monat, ab, bis, wert):
        b.append({"date": f"{monat}-01", "realtime_start": ab, "realtime_end": bis, "value": str(wert)})
    for m, w in (("2023-01", 300.0), ("2023-02", 301.0), ("2023-12", 309.0)):
        fassung(m, "2024-01-01", "9999-12-31", w)
    fassung("2024-01", "2024-02-13", "2024-03-11", 309.9)   # Erstveröffentlichung
    fassung("2024-01", "2024-03-12", "9999-12-31", 310.2)   # später revidiert
    fassung("2024-02", "2024-03-12", "9999-12-31", 312.0)
    v = wirtschaft.lies_versionen(b)
    ind = wirtschaft.INDIKATOREN["us_cpi_j"]
    t = wirtschaft.termine(ind, v, dt.date(2024, 1, 1))
    assert [x[4] for x in t] == ["2024-01", "2024-02"]
    assert t[0][1] == round((309.9 / 300 - 1) * 100, 1)       # nicht der revidierte Wert
    assert t[1][3] == round((310.2 / 300 - 1) * 100, 1)       # Vorwert, wie er am 12.3. bekannt war
    zeit = dt.datetime.fromtimestamp(t[0][0] * 60, dt.timezone.utc)
    assert zeit.strftime("%Y-%m-%d %H:%M") == "2024-02-13 13:30"  # 8:30 New York im Winter
    m = wirtschaft.termine(wirtschaft.INDIKATOREN["us_cpi_m"], v, dt.date(2024, 1, 1))
    assert m[0][1] == round((309.9 / 309 - 1) * 100, 1)


def test_prognosen_trading_economics_und_fmp():
    from src import wirtschaft
    te = wirtschaft.lies_te([{"Category": "Inflation Rate", "Date": "2024-02-13T13:30:00", "Forecast": "2.9%"},
                             {"Category": "Non Farm Payrolls", "Date": "2024-02-02T13:30:00", "Forecast": "180K"}])
    assert te == {"us_cpi_j": {"2024-02-13": 2.9}, "us_nfp": {"2024-02-02": 180.0}}
    fmp = wirtschaft.lies_fmp([{"country": "US", "event": "Core CPI (MoM) (Jan)", "date": "2024-02-13 13:30:00", "estimate": 0.3},
                               {"country": "US", "event": "CPI (YoY) (Jan)", "date": "2024-02-13 13:30:00", "estimate": 2.9},
                               {"country": "US", "event": "Nonfarm Payrolls (Jan)", "date": "2024-02-02 13:30:00", "estimate": 180000},
                               {"country": "DE", "event": "CPI (YoY)", "date": "2024-02-13 07:00:00", "estimate": 2.0}])
    assert fmp == {"us_kern_m": {"2024-02-13": 0.3}, "us_cpi_j": {"2024-02-13": 2.9}, "us_nfp": {"2024-02-02": 180.0}}


def test_datenpruefung_findet_abweichungen():
    from src import datenpruefung
    idx = pd.bdate_range("2024-01-01", periods=100)
    a = pd.Series(np.linspace(100, 120, 100), index=idx)
    b = a.copy(); b.iloc[50] *= 1.05
    a2 = a.copy(); a2.iloc[70] *= 1.5   # Datenfehler nur in der ersten Quelle
    p = datenpruefung.pruefe(a2, b, "Eulerpool", "Yahoo Finance")
    assert p["tage"] == 100 and p["abgleich"]["ueber_1pct"] == 2 and p["ausreisser"][0] == idx[70].date().isoformat()
    assert p["abgleich"]["quelle"] == "Yahoo Finance" and p["laengste_luecke"] == 3

def _node():
    import shutil
    return shutil.which("node")


@pytest.mark.skipif(not _node(), reason="Node.js fehlt")
def test_backtest_kern_node():
    """Rechenkern des Backtests (assets/backtest-kern.js) mit Nodes eingebautem Testlauf."""
    import subprocess
    r = subprocess.run([_node(), "--test", "tests/backtest_kern.test.js"], cwd=Path(__file__).parent.parent,
                       capture_output=True, text=True, timeout=120)
    assert r.returncode == 0, r.stdout[-3000:] + r.stderr[-2000:]


@pytest.mark.skipif(not _node(), reason="Node.js fehlt")
def test_work_kern_node():
    """Rechenkern des Work-Modus (assets/work-kern.js): Kurzfassung, Zuordnung, Statistik, Börsenzeiten, Kalender."""
    import subprocess
    r = subprocess.run([_node(), "--test", "tests/work_kern.test.js"], cwd=Path(__file__).parent.parent,
                       capture_output=True, text=True, timeout=120)
    assert r.returncode == 0, r.stdout[-3000:] + r.stderr[-2000:]


@pytest.mark.skipif(not _node(), reason="Node.js fehlt")
def test_backtest_kriterien_wie_pruefstand(tmp_path):
    """Die Kriterien im Backtest (JavaScript) sind an jedem Tag genau die des Prüfstands (Python)."""
    import json
    import subprocess

    from src import kriterien, pruefstand
    from src.demo import demo_daten
    cfg = kriterien.mit_standard(yaml.safe_load(Path("config.yaml").read_text(encoding="utf-8")))
    rohdaten, _ = demo_daten(cfg["watchlist"])
    spez = kriterien.spezifikation(cfg)
    werte, erwartet = [], []
    for r in rohdaten:
        if r["typ"] not in pruefstand.KURSBASIERT:
            continue
        k = r["kurse"].dropna()
        df = pruefstand.reihen(k)
        tage = [(d.date() - dt.date(1970, 1, 1)).days for d in k.index]
        werte.append({"s": r["symbol"], "n": r["symbol"], "t": r["typ"], "d0": tage[0], "dd": [b - a for a, b in zip(tage, tage[1:])],
                      "c": [float(x) for x in k], "o": [0] * len(k), "h": [0] * len(k), "l": [0] * len(k)})
        for i in range(250, len(k), 37):
            sig = pruefstand.signale_am(df.iloc[i], r["typ"], r["symbol"], cfg)
            erwartet.append({"s": r["symbol"], "typ": r["typ"], "i": i, "sig": sig})
    (tmp_path / "daten.json").write_text(json.dumps({"werte": werte, "erwartet": erwartet, "katalog": spez["katalog"], "params": spez["params"]}))
    skript = tmp_path / "pruefe.js"
    skript.write_text(f"""
const K = require({json.dumps(str(Path("assets/backtest-kern.js").resolve()))});
const d = JSON.parse(require("fs").readFileSync({json.dumps(str(tmp_path / "daten.json"))}, "utf8"));
const w = Object.fromEntries(d.werte.map((x) => [x.s, K.dekodiere(x)]));
const ab = [];
for (const e of d.erwartet) for (const [name, soll] of Object.entries(e.sig)) {{
  const k = d.katalog[e.typ].find((x) => x.name === name);
  const ist = K.kriteriumErfuellt(k, w[e.s], e.i, d.params[e.typ]);
  if (ist !== soll) ab.push([e.s, e.i, name, soll, ist]);
}}
console.log(JSON.stringify({{n: d.erwartet.length, ab}}));
""")
    r = subprocess.run([_node(), str(skript)], capture_output=True, text=True, timeout=120)
    aus = json.loads(r.stdout)
    assert aus["n"] > 300 and aus["ab"] == [], aus["ab"][:10]


# ---------------------------------------------------------------- Work-Modus: Kalender und Nachrichten

def test_kalender_fassungen_ist_und_vorwert():
    from src import kalender
    # CPI-Index: September erscheint am 14.10., davor ist August der jüngste Wert
    beob = [{"date": "2025-09-01", "value": "300.0", "realtime_start": "2025-10-15", "realtime_end": "9999-12-31"},
            {"date": "2026-07-01", "value": "306.0", "realtime_start": "2026-08-12", "realtime_end": "9999-12-31"},
            {"date": "2026-08-01", "value": "306.9", "realtime_start": "2026-09-11", "realtime_end": "9999-12-31"},
            {"date": "2026-09-01", "value": "308.1", "realtime_start": "2026-10-14", "realtime_end": "9999-12-31"},
            {"date": "2025-08-01", "value": "299.0", "realtime_start": "2025-09-11", "realtime_end": "9999-12-31"}]
    f = kalender.lies_fassungen(beob)
    spez = [{"id": "j", "kurz": "CPI j/j", "reihe": "X", "art": "jahr", "einheit": "%", "dez": 1, "gut": 1},
            {"id": "m", "kurz": "CPI m/m", "reihe": "X", "art": "monat", "einheit": "%", "dez": 1, "gut": 1}]
    vergangen = kalender.werte_zum_termin(spez, {"X": f}, dt.date(2026, 10, 14), dt.date(2026, 10, 18))
    assert vergangen[0]["ist"] == pytest.approx(2.7) and vergangen[0]["vor"] == pytest.approx(2.6)  # 308,1/300 und 306,9/299
    assert vergangen[1]["ist"] == pytest.approx(0.4) and vergangen[0]["periode"] == "2026-09"
    kuenftig = kalender.werte_zum_termin(spez, {"X": f}, dt.date(2026, 11, 12), dt.date(2026, 10, 18))
    assert kuenftig[0]["ist"] is None and kuenftig[0]["vor"] == pytest.approx(2.7) and kuenftig[0]["periode"] == "2026-10"
    # Am Termin ohne neue Fassung (FRED noch nicht aktualisiert): kein Ist, nur der letzte bekannte Wert
    zu_frueh = kalender.werte_zum_termin(spez, {"X": f}, dt.date(2026, 10, 13), dt.date(2026, 10, 18))
    assert zu_frueh[0]["ist"] is None and zu_frueh[0]["vor"] == pytest.approx(2.6)


def test_kalender_konjunktur_aus_fred(monkeypatch, tmp_path):
    from src import kalender
    def fred(pfad, parameter, cache, name, heute):
        if pfad == "release/dates":
            return {"release_dates": [{"release_id": parameter["release_id"], "date": "2026-10-14"},
                                      {"release_id": parameter["release_id"], "date": "2026-11-12"},
                                      {"release_id": parameter["release_id"], "date": "2027-03-01"}]}
        return {"observations": [{"date": "2026-08-01", "value": "100", "realtime_start": "2026-09-11", "realtime_end": "9999-12-31"},
                                 {"date": "2026-09-01", "value": "101", "realtime_start": "2026-10-14", "realtime_end": "9999-12-31"}]}
    monkeypatch.setattr(kalender, "hole_fred", fred)
    termine = kalender.konjunktur(dt.date(2026, 10, 18), tmp_path, {"us_cpi_m": {"2026-11-12": 0.3}})
    cpi = [t for t in termine if t["gruppe"] == "us_cpi"]
    assert [t["tag"] for t in cpi] == ["2026-10-14", "2026-11-12"]  # März 2027 liegt außerhalb des Fensters
    m = next(w for w in cpi[1]["werte"] if w["id"] == "us_cpi_m")
    assert m["prog"] == 0.3 and m["vor"] == pytest.approx(1.0) and m["bls"] == "CUSR0000SA0"
    # 8:30 Uhr New York = 14:30 Uhr deutscher Zeit (beide Sommerzeit)
    assert dt.datetime.fromtimestamp(cpi[0]["t"] * 60, kalender.FRANKFURT).strftime("%H:%M") == "14:30"


def test_kalender_notenbanken_uhrzeit_bei_zeitumstellung(tmp_path, monkeypatch):
    from src import kalender
    monkeypatch.setattr(kalender, "hole_fred", lambda *a, **k: None)
    termine = {t["id"]: t for t in kalender.notenbanken(dt.date(2026, 10, 18), tmp_path)}
    fed, ezb = termine["fed-2026-10-28"], termine["ezb-2026-10-29"]
    # Deutschland hat am 25.10. schon auf Winterzeit umgestellt, die USA erst am 1.11.: 14:00 New York = 19:00 Berlin
    assert dt.datetime.fromtimestamp(fed["t"] * 60, kalender.FRANKFURT).strftime("%H:%M") == "19:00"
    assert dt.datetime.fromtimestamp(ezb["t"] * 60, kalender.FRANKFURT).strftime("%H:%M") == "14:15"
    assert termine["fed-pk-2026-10-28"]["t"] == fed["t"] + 30 and fed["wichtig"] == 3


def test_bls_live_ist_werte():
    from src import kalender
    antwort = {"status": "REQUEST_SUCCEEDED", "Results": {"series": [
        {"seriesID": "CUUR0000SA0", "data": [{"year": "2026", "period": "M09", "value": "324.80"}, {"year": "2026", "period": "M08", "value": "324.00"},
                                              {"year": "2025", "period": "M13", "value": "316.0"}, {"year": "2025", "period": "M09", "value": "316.00"}]},
        {"seriesID": "CES0000000001", "data": [{"year": "2026", "period": "M09", "value": "160,250"}, {"year": "2026", "period": "M08", "value": "160,110"}]}]}}
    d = kalender.lies_bls(antwort)
    assert d["CUUR0000SA0"][-1] == ("2026-09", 324.8) and ("2025-13", 316.0) not in d["CUUR0000SA0"]
    termin = {"werte": [{"id": "us_cpi_j", "bls": "CUUR0000SA0", "art": "jahr", "dez": 1, "ist": None, "periode": "2026-09"},
                        {"id": "us_nfp", "bls": "CES0000000001", "art": "diff", "dez": 0, "ist": None, "periode": "2026-09"},
                        {"id": "us_alq", "bls": "LNS14000000", "art": "stand", "dez": 1, "ist": None, "periode": "2026-09"}]}
    assert kalender.ist_eintragen(termin, d) is False  # Arbeitslosenquote fehlt noch
    assert termin["werte"][0]["ist"] == pytest.approx(2.8) and termin["werte"][1]["ist"] == 140
    assert termin["werte"][0]["ist_quelle"] == "BLS live" and termin["werte"][2]["ist"] is None
    # Alte Periode: nichts eintragen, solange die erwartete fehlt
    assert kalender.bls_wert(d["CUUR0000SA0"], "jahr", "2026-10") is None


def test_zahlentermin_aus_finnhub():
    from src import kalender
    t = {"tag": "2026-10-27", "t": None, "finnhub": "MSFT", "w": "USD", "werte": []}
    kalender.zahlen_eintragen(t, [{"symbol": "MSFT", "date": "2026-10-28", "hour": "amc", "epsEstimate": 3.66, "epsActual": 3.9,
                                   "revenueEstimate": 75.4e9, "revenueActual": None}])
    assert t["tag"] == "2026-10-28" and dt.datetime.fromtimestamp(t["t"] * 60, kalender.FRANKFURT).strftime("%H:%M") == "21:05"
    eps = next(w for w in t["werte"] if w["id"] == "eps")
    assert eps["ist"] == 3.9 and eps["prog"] == 3.66 and next(w for w in t["werte"] if w["id"] == "umsatz")["prog"] == 75.4


def test_kalender_andere_laender_und_demo():
    from src import kalender
    te = kalender.lies_te_kalender([{"CalendarId": "1", "Date": "2026-10-30T10:00:00", "Country": "Euro Area", "Category": "Inflation Rate",
                                     "Event": "Inflation Rate YoY Flash", "Actual": "", "Forecast": "2.1%", "Previous": "2.2%", "Importance": 3},
                                    {"Date": "2026-10-30T10:00:00", "Country": "Brazil", "Importance": 3}])
    assert len(te) == 1 and te[0]["land"] == "EU" and te[0]["werte"][0]["prog"] == 2.1 and te[0]["werte"][0]["ist"] is None
    d = kalender.demo(dt.date(2026, 10, 18), [])
    assert d["demo"] and any(t["art"] == "notenbank" for t in d["termine"])
    assert all(t["t"] is None or isinstance(t["t"], int) for t in d["termine"])


def test_nachrichten_quellen_lesen():
    from src import nachrichten
    f = nachrichten.lies_finnhub([{"id": 7, "datetime": 1760800000, "headline": "Nvidia &amp; partners", "summary": "<p>Chip demand rises.</p>",
                                   "source": "Reuters", "url": "https://x", "related": "NVDA"}, {"headline": "ohne Zeit"}], "MSFT")
    assert len(f) == 1 and f[0]["titel"] == "Nvidia & partners" and f[0]["text"] == "Chip demand rises." and f[0]["symbole"] == ["NVDA", "MSFT"]
    rss = """<rss><channel><item><title>FOMC statement</title><link>https://fed/1</link>
             <pubDate>Wed, 28 Oct 2026 18:00:00 GMT</pubDate><description>The Committee decided</description></item></channel></rss>"""
    r = nachrichten.lies_feed(rss, nachrichten.FEEDS[0])
    assert r[0]["t"] == int(dt.datetime(2026, 10, 28, 18, tzinfo=dt.timezone.utc).timestamp()) and r[0]["thema"] == "notenbank"
    atom = """<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>8-K - Current report</title><link href="https://sec/1"/>
              <updated>2026-10-28T16:05:00-04:00</updated><summary>Item 2.02: Results of Operations Item 9.01: Exhibits</summary></entry></feed>"""
    s = nachrichten.lies_sec(atom, "MSFT", "Microsoft")
    assert s[0]["titel"] == "Microsoft: Pflichtmitteilung 8-K – Geschäftszahlen veröffentlicht" and s[0]["wichtig"] and s[0]["symbole"] == ["MSFT"]
    assert nachrichten.lies_cik({"0": {"cik_str": 789019, "ticker": "MSFT"}}) == {"MSFT": 789019}


def test_nachrichten_dienst_nummern_ohne_doppelte():
    import time as zeit
    from src import nachrichten
    d = nachrichten.Dienst([])
    jetzt = int(zeit.time())
    e = [{"id": "a", "t": jetzt - 60, "titel": "A"}, {"id": "b", "t": jetzt - 30, "titel": "B"}, {"id": "alt", "t": jetzt - 5 * 86400, "titel": "alt"}]
    assert d.aufnehmen(e) == 2 and d.aufnehmen(e) == 0
    assert [x["titel"] for x in d.seit(0)["eintraege"]] == ["A", "B"] and [x["titel"] for x in d.seit(1)["eintraege"]] == ["B"]


def test_nachrichten_dienst_ruft_quellen_ab(monkeypatch):
    import json as js
    import time as zeit
    from src import nachrichten
    jetzt = int(zeit.time())
    aufrufe = []

    def laden(url, kopf=None):
        aufrufe.append(url)
        if "company_tickers" in url:
            return js.dumps({"0": {"cik_str": 789019, "ticker": "MSFT"}}).encode()
        if "browse-edgar" in url:
            return (f'<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>8-K - Current report</title><link href="https://sec/1"/>'
                    f'<updated>{dt.datetime.fromtimestamp(jetzt - 60, dt.timezone.utc).isoformat()}</updated><summary>Item 5.02</summary></entry></feed>').encode()
        if "finnhub.io" in url and "/news?" in url:
            return js.dumps([{"id": 9, "datetime": jetzt - 30, "headline": "Markets rise", "summary": "", "source": "Reuters", "url": "u", "related": ""}]).encode()
        if "company-news" in url:
            return js.dumps([{"id": 10, "datetime": jetzt - 20, "headline": "Microsoft news", "summary": "", "source": "X", "url": "v", "related": ""}]).encode()
        return (f"<rss><channel><item><title>Press release</title><link>https://bank/{len(aufrufe)}</link>"
                f"<pubDate>{zeit.strftime('%a, %d %b %Y %H:%M:%S GMT', zeit.gmtime(jetzt - 90))}</pubDate></item></channel></rss>").encode()

    monkeypatch.setattr(nachrichten, "_laden", laden)
    monkeypatch.setattr(nachrichten.time, "sleep", lambda s: None)
    monkeypatch.setenv("FINNHUB_API_KEY", "k")
    monkeypatch.setenv("SEC_KONTAKT", "Test test@example.com")
    d = nachrichten.Dienst([{"symbol": "MSFT", "name": "Microsoft", "finnhub": "MSFT"}, {"symbol": "SAP.DE", "name": "SAP", "finnhub": None}])
    d._finnhub(); d._feeds(); d._sec()
    titel = {e["titel"] for e in d.seit(0)["eintraege"]}
    assert {"Markets rise", "Microsoft news", "Press release", "Microsoft: Pflichtmitteilung 8-K – Wechsel in Vorstand oder Aufsichtsrat"} <= titel
    assert d.quellen == {"Finnhub": "ok", "Federal Reserve": "ok", "EZB": "ok", "SEC EDGAR": "ok"}
    assert d.min_id == 9 and "minId" not in aufrufe[0]


def test_kalender_wiederkehrende_wochentermine():
    from src import kalender
    t = kalender.wiederkehrend(dt.date(2026, 10, 20))
    eia = [x for x in t if x["gruppe"] == "us_eia"]
    assert all(dt.date.fromisoformat(x["tag"]).weekday() == 2 for x in eia) and len(eia) >= 6
    # 10:30 Uhr New York = 16:30 Uhr deutscher Zeit (beide Sommerzeit am 21.10.)
    e = next(x for x in eia if x["tag"] == "2026-10-21")
    assert dt.datetime.fromtimestamp(e["t"] * 60, kalender.FRANKFURT).strftime("%H:%M") == "16:30" and e["planmaessig"]
    d = kalender.demo(dt.date(2026, 10, 20), [])
    tage = {x["tag"] for x in d["termine"] if "2026-10-19" <= x["tag"] <= "2026-10-23"}
    assert len(tage) == 5  # an jedem Werktag gibt es Demo-Termine


# ---------------------------------------------------------------- Sicherheit
def test_sicherheit_live_server_csrf_rebinding_und_kopfzeilen(tmp_path):
    """live.py: fremde Hosts (DNS-Rebinding) und fremde Seiten (CSRF) können nichts lesen oder ändern."""
    import http.client
    import shutil
    import threading
    from functools import partial
    from http.server import ThreadingHTTPServer
    import live

    (tmp_path / "site").mkdir()
    (tmp_path / "site" / "index.html").write_text("<!doctype html><title>x</title>", encoding="utf-8")
    cfg = tmp_path / "config.yaml"
    shutil.copy("config.yaml", cfg)
    vorher = cfg.read_text(encoding="utf-8")

    class Aufbau:
        version, laeuft, fehler = 0, False, None
        def starten(self): pass

    class Speicher:
        lock = threading.Lock(); kurse, intervall, demo, stand, fehler, tage = {}, 30, True, None, None, {}

    live.Handler.speicher, live.Handler.aufbau, live.Handler.config = Speicher(), Aufbau(), cfg
    live.Handler.suche = staticmethod(lambda q: [])
    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(live.Handler, directory=str(tmp_path / "site")))
    port = server.server_port
    threading.Thread(target=server.serve_forever, daemon=True).start()

    def anfrage(methode, pfad, kopf=None, koerper=None):
        c = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
        c.putrequest(methode, pfad, skip_host=True)
        for k, v in {"Host": f"127.0.0.1:{port}", **(kopf or {})}.items():
            c.putheader(k, v)
        roh = (koerper or "").encode()
        if methode in ("POST", "DELETE"):
            c.putheader("Content-Length", str(len(roh)))
        c.endheaders(roh or None)
        r = c.getresponse()
        return r.status, dict(r.getheaders()), r.read()

    try:
        json_kopf = {"Content-Type": "application/json"}
        eigen = {"Origin": f"http://127.0.0.1:{port}", **json_kopf}
        neu = '{"symbol": "EVIL", "name": "Böse", "typ": "aktie"}'
        status, kopf, _ = anfrage("GET", "/")
        assert status == 200
        assert "frame-ancestors 'none'" in kopf["Content-Security-Policy"] and kopf["X-Frame-Options"] == "DENY"
        assert kopf["X-Content-Type-Options"] == "nosniff" and "Python" not in kopf.get("Server", "")
        assert anfrage("GET", "/api/kurse", {"Host": f"boese.example:{port}"})[0] == 421          # DNS-Rebinding
        assert anfrage("POST", "/api/watchlist", {"Host": f"boese.example:{port}", "Origin": f"http://boese.example:{port}", **json_kopf}, neu)[0] == 403
        assert anfrage("POST", "/api/watchlist", {"Origin": "http://boese.example", **json_kopf}, neu)[0] == 403
        assert anfrage("POST", "/api/watchlist", json_kopf, neu)[0] == 403                          # ohne Herkunft
        assert anfrage("POST", "/api/watchlist", {"Origin": f"http://127.0.0.1:{port}", "Content-Type": "text/plain"}, neu)[0] == 403
        assert anfrage("DELETE", "/api/watchlist?symbol=AAPL", {"Origin": "http://boese.example", **json_kopf})[0] == 403
        assert anfrage("POST", "/api/watchlist", eigen, "x" * (live.MAX_KOERPER + 1))[0] == 413
        assert anfrage("POST", "/api/watchlist", eigen, "[1, 2]")[0] == 400
        assert anfrage("OPTIONS", "/api/watchlist", {"Origin": "http://boese.example"})[0] == 405
        assert anfrage("GET", "/../../etc/passwd")[0] == 404
        assert cfg.read_text(encoding="utf-8") == vorher                                            # nichts geändert
        status, _, _ = anfrage("POST", "/api/watchlist", {**eigen, "Origin": f"http://localhost:{port}"},
                               '{"symbol": "TSTX", "name": "Te\\u2028st\\nzeile", "typ": "aktie"}')
        assert status == 200 and 'name: "Te st zeile"' in cfg.read_text(encoding="utf-8")       # Zeilentrenner entfernt
        assert anfrage("POST", "/api/watchlist", {"Sec-Fetch-Site": "same-origin", **json_kopf}, '{"symbol": "a b"}')[0] == 400
    finally:
        server.shutdown()
        server.server_close()


def test_sicherheit_links_und_schluessel():
    """Nur http(s)-Links aus Feeds; der Finnhub-Schlüssel steht im Header, nie in der Adresse."""
    from src import nachrichten
    assert nachrichten.sichere_url("javascript:alert(1)") == "" and nachrichten.sichere_url(" data:text/html,x") == ""
    assert nachrichten.sichere_url("https://www.ecb.europa.eu/press/x.html") == "https://www.ecb.europa.eu/press/x.html"
    eintrag = nachrichten.lies_finnhub([{"id": 1, "datetime": 1, "headline": "x", "url": "javascript:alert(1)"}])[0]
    assert eintrag["url"] == ""
    feed = nachrichten.lies_feed("<rss><channel><item><title>T</title><link>javascript:alert(1)</link>"
                                 "<pubDate>Mon, 19 Oct 2026 10:00:00 GMT</pubDate></item></channel></rss>", {"id": "fed", "name": "Fed"})
    assert feed[0]["url"] == ""


def test_sicherheit_finnhub_schluessel_nicht_in_der_adresse(monkeypatch):
    from src import nachrichten
    aufrufe = []
    monkeypatch.setattr(nachrichten, "_laden", lambda url, kopf=None: (aufrufe.append((url, kopf)), b"[]")[1])
    monkeypatch.setenv("FINNHUB_API_KEY", "geheim123")
    d = nachrichten.Dienst([{"symbol": "MSFT", "name": "Microsoft", "finnhub": "MSFT"}])
    d._finnhub()
    assert aufrufe and all("geheim123" not in url and (kopf or {}).get("X-Finnhub-Token") == "geheim123" for url, kopf in aufrufe)


@pytest.mark.skipif(not _node(), reason="Node.js fehlt")
def test_taktik_kern_node():
    """Chart-Taktik (assets/taktik-kern.js): Beschreibung deuten, gezeichnete Linien und Zonen zurückrechnen."""
    import subprocess
    r = subprocess.run([_node(), "--test", "tests/taktik_kern.test.js"], cwd=Path(__file__).parent.parent,
                       capture_output=True, text=True, timeout=120)
    assert r.returncode == 0, r.stdout[-3000:] + r.stderr[-2000:]


def test_taktik_ki_anfrage_und_antwort(monkeypatch):
    import json
    """KI-Deutung: nur Text und Zeichnungen gehen hinaus, die Antwort wird als JSON gelesen (auch in Codeblöcken)."""
    from src import taktik
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    assert not taktik.verfuegbar()
    with pytest.raises(RuntimeError):
        taktik.deute("Kaufe über L1", [])
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-schluessel")
    gesendet = {}

    def laden(roh):
        gesendet.update(json.loads(roh))
        return {"content": [{"type": "text", "text": 'Hier:\n```json\n{"regeln": {"richtung": "long", "einstieg": [[{"typ": "kreuzt_ueber", "ref": "L1"}]],'
                                                     ' "ziel": {"art": "r", "wert": 2}}, "unklar": ["irgendwas"]}\n```'}]}
    d = taktik.deute("Kaufe, wenn der Kurs über L1 schließt. Ziel 2R.", [{"id": "L1", "art": "linie", "p": 101.5, "name": "Widerstand", "boese": "x" * 999}], laden)
    assert d["regeln"]["einstieg"][0][0] == {"typ": "kreuzt_ueber", "ref": "L1"} and d["unklar"] == ["irgendwas"]
    nachricht = gesendet["messages"][0]["content"]
    assert "Widerstand" in nachricht and "boese" not in nachricht and "test-schluessel" not in json.dumps(gesendet)
    with pytest.raises(ValueError):
        taktik.deute("x", [], lambda roh: {"content": [{"type": "text", "text": "keine Ahnung"}]})


def test_backtest_katalog_und_einzelwert():
    """Backtest-Katalog: gültige Einträge, Watchlist-Werte fallen weg, jeder Wert im Format von backtest.json."""
    import datetime as dt
    from src import backtest
    eintraege = backtest.katalog_eintraege({})
    assert len(eintraege) >= 40 and {e["typ"] for e in eintraege} == {"aktie", "etf", "forex", "rohstoff", "index"}
    eigen = backtest.katalog_eintraege({"backtest": {"katalog": [
        {"symbol": "OR.PA", "name": "L'Oréal", "typ": "aktie"}, {"symbol": "a b", "typ": "aktie"},
        {"symbol": "X", "typ": "anleihe"}, {"symbol": "or.pa", "typ": "aktie"}, "kaputt"]}})
    assert eigen == [{"symbol": "OR.PA", "name": "L'Oréal", "typ": "aktie"}]       # ungültig, unbekannt, doppelt: weg
    heute = dt.date(2026, 10, 23)
    liste, dateien = backtest.katalog(eintraege[:2] + [{"symbol": "GC=F", "name": "Gold", "typ": "rohstoff"}],
                                      {eintraege[0]["symbol"].upper()}, heute, demo=True)
    assert [x["s"] for x in liste] == [eintraege[1]["symbol"], "GC=F"]           # Watchlist-Wert ausgelassen
    assert liste[1]["f"] == "daten/backtest/katalog/gc-f.json" and "katalog/gc-f" in dateien
    w = dateien["katalog/" + backtest.slug(eintraege[1]["symbol"])]
    assert w["t"] == "aktie" and w["dez"] >= 0 and len(w["c"]) > 2000 and w.get("e")  # zehn Jahre und Zahlentermine
    # andere Kürzel bekommen andere (feste) Demo-Kurse
    a = backtest.einzelwert({"symbol": "AAA", "typ": "aktie"}, heute, demo=True)
    b = backtest.einzelwert({"symbol": "BBB", "typ": "aktie"}, heute, demo=True)
    assert a["c"][:50] != b["c"][:50] and a == backtest.einzelwert({"symbol": "AAA", "typ": "aktie"}, heute, demo=True)


def test_live_server_backtest_wert(tmp_path):
    """api/backtest-wert: nur von dieser Seite, nur gültige Kürzel, liefert einen kodierten Wert (Demo)."""
    import http.client
    import json as _json
    import threading
    from functools import partial
    from http.server import ThreadingHTTPServer
    import live

    class Speicher:
        lock = threading.Lock(); kurse, intervall, demo, stand, fehler, tage = {}, 30, True, None, None, {}

    live.Handler.speicher = Speicher()
    live.Handler._bt_cache = {}
    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(live.Handler, directory=str(tmp_path)))
    port = server.server_port
    threading.Thread(target=server.serve_forever, daemon=True).start()

    def post(kopf, koerper):
        c = http.client.HTTPConnection("127.0.0.1", port, timeout=30)
        c.request("POST", "/api/backtest-wert", body=koerper.encode(), headers={"Host": f"127.0.0.1:{port}", **kopf})
        r = c.getresponse()
        return r.status, r.read()

    try:
        eigen = {"Origin": f"http://127.0.0.1:{port}", "Content-Type": "application/json"}
        ok = '{"symbol": "OR.PA", "name": "L\'Oréal", "typ": "aktie"}'
        assert post({"Origin": "http://boese.example", "Content-Type": "application/json"}, ok)[0] == 403
        assert post({"Content-Type": "application/json"}, ok)[0] == 403                     # ohne Herkunft
        assert post(eigen, '{"symbol": "a b", "typ": "aktie"}')[0] == 400
        assert post(eigen, '{"symbol": "OR.PA", "typ": "anleihe"}')[0] == 400
        status, roh = post(eigen, ok)
        w = _json.loads(roh)
        assert status == 200 and w["s"] == "OR.PA" and w["n"] == "L'Oréal" and w["t"] == "aktie" and len(w["c"]) > 2000
        assert "OR.PA" in live.Handler._bt_cache                                            # zweiter Abruf aus dem Speicher
    finally:
        server.shutdown()
        server.server_close()


# ---------------------------------------------------------------- Szenarien (src/szenarien.py, assets/szenario-kern.js)

def _aktie_fuer_szenario(**extra):
    quartale = [dt.date(2025, 12, 31), dt.date(2026, 3, 31), dt.date(2026, 6, 30), dt.date(2026, 9, 30)]
    z = {
        "symbol": "TEST", "typ": "aktie", "kurs": 100.0, "waehrung": "EUR", "finanzwaehrung": "EUR", "dezimalen": 2,
        "kurs_datum": dt.date(2026, 10, 27), "volatilitaet": 0.3,
        "eps_historie": [{"quartal": q, "schaetzung": 1.0, "ist": e} for q, e in zip(quartale, (0.9, 1.0, 1.0, 1.1))],
        "schaetzungen": [
            {"periode": "Laufendes Quartal", "eps_mittel": 1.0, "analysten": 3},
            {"periode": "Nächstes Geschäftsjahr", "eps_mittel": 4.4, "eps_hoch": 4.84, "eps_tief": 4.18, "eps_wachstum": 0.10, "analysten": 3},
        ],
        "kgv_historie": [{"datum": dt.date(2021, 12, 31) + dt.timedelta(days=91 * i), "wert": 20 * (1.1 if i % 8 < 4 else 0.9)} for i in range(20)],
        "forward_kgv": 20.0, "forward_kgv_median_5j": 25.0, "multiples": {"dividendenrendite": 0.02},
    }
    return z | extra


def test_szenarien_gewinnmodell_auf_ist_zahlen():
    from src import szenarien
    sz = szenarien.treiber(_aktie_fuer_szenario(), None, dt.date(2026, 10, 27))
    assert sz["m"] == "gewinn" and sz["anker"]["bis"] == "2026-09-30"
    assert sz["anker"]["eps"] == pytest.approx(4.0) and sz["anker"]["kgv"] == pytest.approx(25.0)
    g, v = sz["t"]["g"], sz["t"]["v"]
    assert g["b"] == pytest.approx(0.10)
    assert g["u"] == pytest.approx(1.1 * 1.1 - 1) and g["d"] == pytest.approx(1.1 * 0.95 - 1)   # höchste/niedrigste Schätzung
    assert v["b"] == 0 and v["u"] > 0 > v["d"] and (1 + v["u"]) * (1 + v["d"]) == pytest.approx(1, abs=1e-5)
    assert sz["prognose"] == ["2026-12-31", "2027-03-31", "2027-06-30", "2027-09-30"]
    assert {f["k"] for f in sz["f"]} >= {"analysten"}                    # nur 3 Analysten
    e = szenarien.ergebnis(sz)
    assert e["b"]["rendite"] == pytest.approx(0.10 + 0.02, abs=1e-5)
    assert e["u"]["rendite"] == pytest.approx((1 + g["u"]) * (1 + v["u"]) - 1 + 0.02, abs=1e-5)
    assert e["d"]["rendite"] < e["b"]["rendite"] < e["u"]["rendite"]
    assert szenarien.ergebnis(sz, {"g": {"u": 0.5}})["u"]["faktor"] == pytest.approx(1.5 * (1 + v["u"]), abs=1e-5)
    assert szenarien.zeile(sz).startswith("Szenarien für vier Quartale: Downside −") and ", Basis +12 %, Upside +" in szenarien.zeile(sz)


def test_szenarien_rueckfaelle_und_hinweise():
    from src import szenarien
    heute = dt.date(2026, 10, 27)
    # Verlust in den letzten vier Quartalen: nur Kursschwankung, mit Hinweis
    z = _aktie_fuer_szenario()
    z["eps_historie"] = [e | {"ist": -0.2} for e in z["eps_historie"]]
    sz = szenarien.treiber(z, None, heute)
    assert sz["m"] == "kurs" and sz["f"][0]["k"] == "verlust"
    assert sz["t"]["k"]["u"] == pytest.approx(np.exp(0.3) - 1, abs=1e-5)
    # Ohne KGV-Historie und ohne Spanne: pauschal, mit Hinweisen; Gewinne in anderer Währung werden umgerechnet
    z = _aktie_fuer_szenario(kgv_historie=[], finanzwaehrung="USD")
    z["schaetzungen"][1] = {"periode": "Nächstes Geschäftsjahr", "eps_wachstum": 0.6}
    sz = szenarien.treiber(z, None, heute, {"EUR": 1.0, "USD": 0.9})
    assert {"kgv_kurz", "pauschal_g", "wachstum", "waehrung"} <= {f["k"] for f in sz["f"]}
    assert sz["anker"]["eps"] == pytest.approx(3.6) and sz["anker"]["umgerechnet"]
    assert sz["t"]["v"]["u"] == pytest.approx(0.15, abs=1e-5)
    # Kurs in Pence, Gewinn in Pfund; fehlender Wechselkurs
    gb = szenarien.treiber(_aktie_fuer_szenario(waehrung="GBp", finanzwaehrung="GBP", kurs=10000.0), None, heute, {"EUR": 1.0, "GBP": 1.15})
    assert gb["m"] == "gewinn" and gb["anker"]["eps"] == pytest.approx(400) and not any(f["k"] == "waehrung" for f in gb["f"])
    ohne = szenarien.treiber(_aktie_fuer_szenario(finanzwaehrung="CNY"), None, heute, {"EUR": 1.0})
    assert ohne["m"] == "kurs" and ohne["f"][0]["k"] == "fx_fehlt"
    # Alte Ist-Zahlen und Zahlen in Kürze
    sz = szenarien.treiber(_aktie_fuer_szenario(zahlen_bald=True, naechste_zahlen=dt.date(2026, 11, 5)), None, dt.date(2027, 3, 20))
    assert {"ist_alt", "zahlen"} <= {f["k"] for f in sz["f"]}
    # Devisen: Kurs bleibt, Carry als Ertrag; ETF: Durchschnittsrendite, gedeckelt
    fx = szenarien.treiber({"typ": "forex", "kurs": 1.1, "waehrung": "USD", "volatilitaet": 0.08, "zinsdifferenz": -0.02}, None, heute)
    assert fx["m"] == "kurs" and fx["t"]["k"]["b"] == 0 and fx["t"]["e"]["b"] == -0.02 and fx["t"]["e"]["n"] == "Carry"
    assert szenarien.ergebnis(fx)["b"]["rendite"] == pytest.approx(-0.02)
    kurse = pd.Series(100 * 1.2 ** (np.arange(2520) / 252), index=pd.bdate_range("2016-10-27", periods=2520))
    etf = szenarien.treiber({"typ": "etf", "kurs": float(kurse.iloc[-1]), "waehrung": "EUR", "volatilitaet": 0.15}, kurse, heute)
    assert etf["t"]["k"]["b"] == pytest.approx(0.10) and any(f["k"] == "cagr" for f in etf["f"])
    assert szenarien.treiber({"typ": "etf", "kurs": None}, kurse, heute) is None


@pytest.mark.skipif(not _node(), reason="Node.js fehlt")
def test_szenario_kern_node():
    """Rechenkern der Szenarien (assets/szenario-kern.js): Treiberbaum, eigene Annahmen, Memo, Protokoll."""
    import subprocess
    r = subprocess.run([_node(), "--test", "tests/szenario_kern.test.js"], cwd=Path(__file__).parent.parent,
                       capture_output=True, text=True, timeout=120)
    assert r.returncode == 0, r.stdout[-3000:] + r.stderr[-2000:]


@pytest.mark.skipif(not _node(), reason="Node.js fehlt")
def test_szenarien_im_browser_wie_in_python(tmp_path):
    """Browser und Python rechnen für jeden Wert der Demo-Watchlist dieselben Szenarien, auch mit eigenen Annahmen."""
    import json
    import subprocess

    from src import szenarien
    cfg = yaml.safe_load(Path("config.yaml").read_text(encoding="utf-8"))
    roh, fx = demo_daten(cfg["watchlist"])
    zeilen, _ = baue_zeilen(roh, fx, cfg, dt.date.today(), zinsen={"EUR": 0.02, "USD": 0.04, "JPY": 0.005, "GBP": 0.04, "CHF": 0.0})
    eigene = {"g": {"u": 0.3}, "v": {"d": -0.25}, "k": {"b": 0.05}, "e": {"b": 0.01}}
    faelle = [{"s": z["symbol"], "sz": z["szenarien"], "py": szenarien.ergebnis(z["szenarien"]),
               "py_eigen": szenarien.ergebnis(z["szenarien"], eigene)} for z in zeilen if z.get("szenarien")]
    assert len(faelle) == len(cfg["watchlist"]) and {f["sz"]["m"] for f in faelle} == {"gewinn", "kurs"}
    (tmp_path / "f.json").write_text(json.dumps({"faelle": faelle, "eigene": eigene}))
    skript = tmp_path / "pruefe.js"
    skript.write_text(f"""
const K = require({json.dumps(str(Path("assets/szenario-kern.js").resolve()))});
const d = JSON.parse(require("fs").readFileSync({json.dumps(str(tmp_path / "f.json"))}, "utf8"));
const ab = [];
for (const f of d.faelle) for (const [art, eig] of [["py", null], ["py_eigen", d.eigene]]) {{
  const e = K.rechne(f.sz, eig);
  for (const s of K.SZ) for (const k of ["faktor", "kurs", "rendite"])
    if (Math.abs(e.szenarien[s][k] - f[art][s][k]) > 1e-9 * Math.max(1, Math.abs(f[art][s][k]))) ab.push([f.s, art, s, k, e.szenarien[s][k], f[art][s][k]]);
  const m = K.memoText(K.memo(f.sz, e, {{ name: f.s, eigene: eig }}));
  if (/undefined|NaN/.test(m)) ab.push([f.s, "memo", m.slice(0, 200)]);
}}
console.log(JSON.stringify({{ n: d.faelle.length, ab }}));
""")
    r = subprocess.run([_node(), str(skript)], capture_output=True, text=True, timeout=120)
    aus = json.loads(r.stdout)
    assert aus["n"] == len(faelle) and aus["ab"] == [], aus["ab"][:5]


def test_szenarien_in_seite_und_mail(tmp_path):
    import json
    from src import render
    cfg = yaml.safe_load(Path("config.yaml").read_text(encoding="utf-8"))
    roh, fx = demo_daten(cfg["watchlist"])
    zeilen, warn = baue_zeilen(roh, fx, cfg, dt.date.today())
    kontext = baue_kontext(zeilen, warn, cfg, dt.date.today(), {}, True, [])
    render.schreibe_website(kontext, tmp_path)
    html = (tmp_path / "index.html").read_text(encoding="utf-8")
    assert html.count("data-szenario=") == len(cfg["watchlist"]) and "assets/szenarien.js" in html
    assert html.index("assets/szenario-kern.js") < html.index("assets/szenarien.js") < html.index("assets/werkzeuge.js")
    basis = json.loads((tmp_path / "daten" / "basis.json").read_text(encoding="utf-8"))
    assert basis["werte"]["sap-de"]["sz"]["m"] == "gewinn" and basis["werte"]["eurusd-x"]["sz"]["m"] == "kurs"
    assert "Szenarien für vier Quartale: Downside" in render.email_html(kontext) and "Basis" in render.email_text(kontext)


# ---------------------------------------------------------------- Fenster Termine, Alarme, Depot, Journal (assets/seiten*.js)

@pytest.mark.skipif(not _node(), reason="Node.js fehlt")
def test_seiten_kern_node():
    """Rechenkern der Fenster: Alarme auslösen und quittieren, Journal prüfen, Termine sammeln, Depot-Lage."""
    import subprocess
    r = subprocess.run([_node(), "--test", "tests/seiten_kern.test.js"], cwd=Path(__file__).parent.parent,
                       capture_output=True, text=True, timeout=120)
    assert r.returncode == 0, r.stdout[-3000:] + r.stderr[-2000:]


def test_taskleiste_mit_vier_neuen_fenstern(tmp_path):
    from src import render
    cfg = yaml.safe_load(Path("config.yaml").read_text(encoding="utf-8"))
    roh, fx = demo_daten(cfg["watchlist"])
    zeilen, warn = baue_zeilen(roh, fx, cfg, dt.date.today())
    render.schreibe_website(baue_kontext(zeilen, warn, cfg, dt.date.today(), {}, True, []), tmp_path)
    html = (tmp_path / "index.html").read_text(encoding="utf-8")
    for w in ("termine", "alarme", "depot", "journal"):
        assert f'data-dock="{w}"' in html and f'data-dock-mehr="{w}"' in html
    # Kern vor der Oberfläche, beide nach Werkzeugen und Work-Kern (Depot, Kalender) und vor der Taskleiste
    reihe = [html.index(f"assets/{d}") for d in ("werkzeuge.js", "work-kern.js", "seiten-kern.js", "seiten.js", "dock.js")]
    assert reihe == sorted(reihe)
    assert html.count('data-seite-oeffnen="alarme"') == len(cfg["watchlist"]) and html.count('data-seite-oeffnen="journal"') == len(cfg["watchlist"])
    # Journal steht direkt unter „Woche“
    reihe_dock = [html.index(f'data-dock="{w}"') for w in ("protokoll", "journal", "termine", "alarme", "depot", "konto") if f'data-dock="{w}"' in html]
    assert len(reihe_dock) >= 5
    assert reihe_dock == sorted(reihe_dock)
    konto = Path("assets/konto.js").read_text(encoding="utf-8")
    assert "alarme|journal" in konto   # gehören zur Kontosicherung


# ---------------------------------------------------------------- Setup Lab (assets/setup-kern.js, assets/setups.js)

@pytest.mark.skipif(not _node(), reason="Node.js fehlt")
def test_setup_kern_node():
    """Setup Lab: Speicher prüfen, Versionen, Kennzahlen, Bewährungsprobe ohne Blick in die Zukunft, lokale Metriken."""
    import subprocess
    r = subprocess.run([_node(), "--test", "tests/setup_kern.test.js"], cwd=Path(__file__).parent.parent,
                       capture_output=True, text=True, timeout=120)
    assert r.returncode == 0, r.stdout[-3000:] + r.stderr[-2000:]


def test_setup_lab_eingebunden():
    """Kern vor backtest.js (wird beim Laden gebraucht), Oberfläche danach; Kontosicherung kennt fathom.setups."""
    html = Path("templates/_basis.html.j2").read_text(encoding="utf-8")
    pos = {n: html.index(f"assets/{n}.js") for n in ("backtest-kern", "setup-kern", "backtest", "setups", "konto")}
    assert pos["backtest-kern"] < pos["setup-kern"] < pos["backtest"] < pos["setups"]
    konto = Path("assets/konto.js").read_text(encoding="utf-8")
    assert "trades|setups)$/" in konto and "(fakten|chart|setups)" in konto
    # Keine Netzwerkzugriffe und keine Fremd-Skripte im Setup Lab
    for datei in ("assets/setups.js", "assets/setup-kern.js"):
        code = Path(datei).read_text(encoding="utf-8")
        assert "fetch(" not in code and "XMLHttpRequest" not in code and "sendBeacon" not in code and "eval(" not in code


def test_taktik_ki_anfrage_neue_werkzeuge():
    """Neue Zeichenwerkzeuge gehen mit ihren Zahlen an die KI, nichts anderes (keine Kurse, keine fremden Felder)."""
    import json as _json
    from src import taktik
    z = [{"id": "K1", "art": "kanal", "a": {"t": 1, "p": 2.5, "x": "y"}, "b": {"t": 3, "p": 4}, "d": -1.5, "geheim": "nein"},
         {"id": "F1", "art": "fib", "a": {"t": 1, "p": 10}, "b": {"t": 2, "p": "zwölf"}},
         {"id": "P1", "art": "position", "t": 5, "ein": 100, "stop": 98, "ziel": 104, "verl": True},
         {"id": "X1", "art": "boese", "p": 1}]
    inhalt = taktik.anfrage("Kaufe am Kanal.", z)["messages"][0]["content"]
    knapp = _json.loads(inhalt.split("\n")[1])
    assert knapp[0] == {"id": "K1", "art": "kanal", "name": "", "d": -1.5, "a": {"t": 1, "p": 2.5}, "b": {"t": 3, "p": 4}}
    assert knapp[1] == {"id": "F1", "art": "fib", "name": "", "a": {"t": 1, "p": 10}}
    assert knapp[2] == {"id": "P1", "art": "position", "name": "", "t": 5, "ein": 100, "stop": 98, "ziel": 104}
    assert len(knapp) == 3 and "geheim" not in inhalt
    assert "rsi" in taktik.SYSTEM and "position" in taktik.SYSTEM
