"""Wochenbericht erzeugen: Daten holen → Kennzahlen → Kriterien → HTML → E-Mail.

Aufrufe:
  python main.py --demo          # ohne Internet, mit Beispieldaten testen
  python main.py --keine-mail    # echte Daten, nur Website erzeugen
  python main.py                 # echte Daten, Website + E-Mail (falls eingerichtet)
  FATHOM_UMGEBUNG=staging python main.py --demo   # Probelauf: keine E-Mail, data/ unverändert, noindex
"""
from __future__ import annotations

import argparse
import datetime as dt
import logging
import math
import os
import sys
from pathlib import Path

import yaml

from src import backtest, einordnung, historie, kalender, klassen, kennzahlen, kriterien, links, mailer, protokoll, pruefstand, render, screening, snowflake, szenarien, terminal, umgebung

BASIS = Path(__file__).resolve().parent
log = logging.getLogger("wochenbericht")


def _zahl_oder_none(x):
    return None if x is None or (isinstance(x, float) and math.isnan(x)) else x


def _ist_datum(text: str) -> bool:
    try:
        dt.date.fromisoformat(text)
        return True
    except ValueError:
        return False


def kerzen_eintragen(z: dict, r: dict) -> None:
    """Eröffnung, Hoch und Tief zu Kursreihe und 12-Monats-Chart, damit die Website Kerzen zeichnen kann.

    Fehlen echte Werte (nur Schlusskurse geliefert), bleibt es bei der Linie: flache Kerzen wären irreführend."""
    o = backtest.ohlc_aus(r.get("ohlc"), r.get("kurse"))
    if o is None or o.empty or ((o["Open"] == o["Close"]) & (o["High"] == o["Close"]) & (o["Low"] == o["Close"])).mean() > 0.5:
        return
    nach_tag = {d.date().isoformat(): (round(float(x.Open), 6), round(float(x.High), 6), round(float(x.Low), 6))
                for d, x in o[["Open", "High", "Low"]].iterrows()}
    z["kursreihe_ohlc"] = [nach_tag.get(d) for d, _ in z["kursreihe"]]
    c = z.get("chart_1j")
    if c and c.get("daten"):
        drei = [nach_tag.get(d) for d in c["daten"]]
        if sum(x is not None for x in drei) >= len(drei) * 0.8:
            c["o"], c["h"], c["l"] = ([x[i] if x else None for x in drei] for i in range(3))


def finnhub_symbol(eintrag: dict) -> str | None:
    """Kürzel für Finnhub-Echtzeit. Kostenlos gibt es dort nur US-Aktien:
    Ohne Börsenendung (z. B. "MSFT") wird das Yahoo-Kürzel übernommen."""
    if "finnhub" in eintrag:
        return eintrag["finnhub"] or None
    s = eintrag["symbol"]
    return s if eintrag.get("typ", "aktie") == "aktie" and not any(z in s for z in ".=^") else None


def erwartung(z: dict) -> dict | None:
    """Erwartete Veränderung zu den nächsten Earnings gegenüber dem Vorjahresquartal.

    Quelle 1: Analystenkonsens über Yahoo (laufendes Quartal = das als Nächstes berichtete).
    Quelle 2 (optional): Finnhub-Kalender, wenn FINNHUB_API_KEY gesetzt ist.
    """
    q = next((s for s in z.get("schaetzungen") or [] if s["periode"] == "Laufendes Quartal"), None)
    fh = z.get("finnhub_erwartung") or {}
    if not q and not fh:
        return None
    q = q or {}

    def veraenderung(neu, alt, wachstum):
        if neu is not None and alt not in (None, 0) and alt > 0:
            return neu / alt - 1
        return wachstum

    e = {
        "eps": q.get("eps_mittel"), "eps_vorjahr": q.get("eps_vorjahr"),
        "eps_veraenderung": veraenderung(q.get("eps_mittel"), q.get("eps_vorjahr"), q.get("eps_wachstum")),
        "umsatz": q.get("umsatz_mittel"), "umsatz_vorjahr": q.get("umsatz_vorjahr"),
        "umsatz_veraenderung": veraenderung(q.get("umsatz_mittel"), q.get("umsatz_vorjahr"), q.get("umsatz_wachstum")),
        "analysten": q.get("analysten"),
        "finnhub_eps": fh.get("eps"), "finnhub_umsatz": fh.get("umsatz"),
        "finnhub_eps_veraenderung": veraenderung(fh.get("eps"), q.get("eps_vorjahr"), None),
        "finnhub_umsatz_veraenderung": veraenderung(fh.get("umsatz"), q.get("umsatz_vorjahr"), None),
    }
    return e if any(v is not None for v in e.values()) else None


def baue_zeilen(rohdaten: list[dict], fx: dict, cfg: dict, heute: dt.date, zinsen: dict | None = None,
                markt: dict | None = None):
    """Rohdaten → fertige Zeilen für den Bericht."""
    cfg = kriterien.mit_standard(cfg)
    zinsen = (zinsen or {}) | {w: v / 100 for w, v in (cfg.get("leitzinsen") or {}).items()}
    zeilen, warnungen = [], []
    finnhub_symbole = {e["symbol"]: finnhub_symbol(e) for e in cfg.get("watchlist", [])}
    eintraege = {e["symbol"]: e for e in cfg.get("watchlist", [])}
    for r in rohdaten:
        km = kennzahlen.berechne(r["kurse"])
        if km["kurs"] is None:
            warnungen.append(f"{r['name']} ({r['symbol']}): keine Kursdaten erhalten")
            continue
        z = {k: v for k, v in r.items() if k != "kurse"} | km
        z["kursreihe"] = [(d.date().isoformat(), round(float(v), 6)) for d, v in r["kurse"].dropna().iloc[-1300:].items()]
        kerzen_eintragen(z, r)
        z["finnhub"] = finnhub_symbole.get(r["symbol"])

        rate = fx.get(r.get("waehrung"))
        z["boersenwert_eur"] = r["boersenwert"] * rate if r.get("boersenwert") and rate else None
        z["kursziel_abstand"] = (
            z["kursziel_mittel"] / z["kurs"] - 1 if z.get("kursziel_mittel") else None
        )
        z["abstand_gd200"] = z["kurs"] / z["gd200"] - 1 if z.get("gd200") else None
        z["zahlen_bald"] = screening.zahlen_bald(z.get("naechste_zahlen"), heute, cfg["zahlen_warnung_tage"])
        if z["typ"] == "forex":
            z["zinsdifferenz"] = klassen.zinsdifferenz(z["symbol"], zinsen)[0]
            z["leitzinsen"] = {w: zinsen.get(w) for w in (klassen.paar(z["symbol"]) or ())}
        if z["typ"] in kriterien.KATALOG:
            # Zehn Kriterien je Klasse (src/kriterien.py); gezählt werden die in config.yaml ausgewählten
            z["kz"] = kriterien.kennzahlen(z, markt, fx)
            z["katalog"] = kriterien.katalog_pruefen(z["typ"], z["kz"], cfg)
            z["bewertung"] = kriterien.bewertung(z["typ"], z["katalog"], cfg)
            z["punkte"] = z["bewertung"]["punkte"]
        if z["typ"] == "aktie":
            z["einordnung"] = einordnung.einordnen(z, cfg["zahlen_warnung_tage"])
            z["erwartung"] = erwartung(z)
            z["jahreswerte"] = terminal.jahreswerte(z)
            z["multiples_historie"] = terminal.multiples(z, r["kurse"], fx)
            z["snowflake"] = snowflake.berechne(z)
        # Für das Signal-Protokoll: dieselben Regeln mit den Kursen von vor einer Woche
        if z.get("bewertung"):
            alt = protokoll.zeile_vor(z, r["kurse"])
            if alt:
                kat = kriterien.katalog_pruefen(z["typ"], kriterien.kennzahlen(alt, markt, fx), cfg)
                z["bewertung_vorwoche"] = kriterien.bewertung(z["typ"], kat, cfg)
                z["datum_vorwoche"] = alt["datum_stand"]
        z["dezimalen"] = 4 if z["typ"] == "forex" and (z["kurs"] or 0) < 20 else 2
        # Downside, Basis, Upside für die nächsten vier Quartale, aufgesetzt auf die letzten Ist-Zahlen (src/szenarien.py)
        z["szenarien"] = szenarien.treiber(z, r["kurse"], heute, fx)
        eintrag = eintraege.get(r["symbol"], {})
        z["isin"] = z.get("isin") or eintrag.get("isin")
        z["tradingview"] = eintrag.get("tradingview") or links.tradingview_symbol(z)
        z["links"] = links.plattformen(z)
        zeilen.append(z)
    terminal.peer_vergleich([z for z in zeilen if z["typ"] == "aktie"])
    return zeilen, warnungen


def _rang(z):
    b = z.get("bewertung") or {}
    return (-int(bool(b.get("treffer"))), -z.get("punkte", 0), -(z.get("abstand_hoch") or 0))


def baue_kontext(zeilen, warnungen, cfg, heute, vorwoche, demo, archiv, fx=None):
    cfg = kriterien.mit_standard(cfg)
    aktien = [z for z in zeilen if z["typ"] == "aktie"]
    for a in aktien:
        alt = vorwoche.get(a["symbol"], {})
        alt_punkte = _zahl_oder_none(alt.get("punkte"))
        a["punkte_diff"] = a["punkte"] - int(alt_punkte) if alt_punkte is not None else 0
    aktien.sort(key=_rang)

    mit_woche = [a for a in aktien if a.get("rendite_1w") is not None]
    termine = sorted(
        (
            {"name": a["name"], "symbol": a["symbol"], "datum": a["naechste_zahlen"],
             "tage": (a["naechste_zahlen"] - heute).days, "erwartung": a.get("erwartung"),
             "waehrung": a.get("waehrung") or ""}
            for a in aktien if a["zahlen_bald"]
        ),
        key=lambda t: t["datum"],
    )
    return {
        "titel": cfg.get("titel", "Fathom"),
        "stand": heute,
        "kw": heute.isocalendar().week,
        "demo": demo,
        "website_url": cfg.get("website_url") or "",
        "aktien": aktien,
        "etfs": [z for z in zeilen if z["typ"] == "etf"],
        "klassen": {
            typ: sorted((z for z in zeilen if z["typ"] == typ), key=_rang)
            for typ in ("forex", "rohstoff", "index")
        },
        "treffer": [a for a in aktien if a["bewertung"]["treffer"]],
        "knapp": [a for a in aktien if a["bewertung"]["knapp"]],
        "auswahl": cfg["auswahl"],
        "spez": kriterien.spezifikation(cfg),
        "termine": termine,
        "bester": max(mit_woche, key=lambda a: a["rendite_1w"], default=None),
        "schlechtester": min(mit_woche, key=lambda a: a["rendite_1w"], default=None),
        "kriterien": cfg["kriterien"],
        "fx": fx or {},
        "kriterien_klassen": klassen.mit_standard(cfg),
        "zahlen_warnung_tage": cfg["zahlen_warnung_tage"],
        "warnungen": warnungen,
        "archiv": archiv,
    }


def backtest_vorbereiten(rohdaten: list[dict], heute: dt.date, demo: bool) -> list[dict]:
    """Wirtschaftsdaten, exakte Kurse (OANDA) und Datenprüfung für den Backtest. Gibt die Termine zurück."""
    from src import datenpruefung, oanda, wirtschaft
    cache = BASIS / "cache" / "backtest"
    if demo:
        from src.demo import demo_ereignisse, mit_intraday
        ereignisse = demo_ereignisse(heute)
        mit_intraday(rohdaten, ereignisse, heute)
        return ereignisse
    try:
        ereignisse = wirtschaft.hole_alles(cache / "wirtschaft", heute)
    except Exception as exc:  # noqa: BLE001 – Backtest läuft dann ohne Wirtschaftsdaten
        log.warning("Wirtschaftsdaten nicht abrufbar: %s", exc)
        ereignisse = []
    termine = sorted({e[0] for ind in ereignisse for e in ind["termine"]})
    if not oanda.token():
        log.info("Kein OANDA_API_TOKEN: Backtest mit Tageskursen (Eulerpool/Yahoo)")
    for r in rohdaten:
        quelle = (r.get("quellen") or {}).get("Kurse") or "Yahoo Finance"
        if r.get("typ") in ("forex", "rohstoff", "index") and oanda.token():
            try:
                r["oanda"] = oanda.hole(r["symbol"], termine, cache / "oanda", heute)
            except Exception as exc:  # noqa: BLE001
                log.warning("OANDA %s: %s", r["symbol"], exc)
        if r.get("oanda"):
            tage = backtest.oanda_tage(r["oanda"])
            r["pruefung"] = datenpruefung.pruefe(tage["Close"], r.get("kurse"), r["oanda"]["quelle"], quelle)
        elif r.get("kurse") is not None:
            r["pruefung"] = datenpruefung.pruefe(r["kurse"], r.get("kurse_zweit"), quelle,
                                                 "Yahoo Finance" if r.get("kurse_zweit") is not None else None)
    return ereignisse


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description="Wöchentlicher Aktienbericht")
    p.add_argument("--demo", action="store_true", help="Beispieldaten statt Yahoo Finance")
    p.add_argument("--keine-mail", action="store_true", help="keine E-Mail verschicken")
    p.add_argument("--config", default=BASIS / "config.yaml", type=Path)
    p.add_argument("--ausgabe", type=Path, help="Ordner für die Website (Standard: site/, im Demo-Modus site_demo/)")
    args = p.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    umgebung.logs_absichern()  # Secret-Werte nie im Log, auch nicht in Fehlermeldungen
    try:
        umg = umgebung.name()
    except umgebung.UmgebungFehler as exc:
        log.error("%s", exc)
        return 2
    if args.ausgabe is None:  # Demo- und Staging-Berichte nie mit echten mischen
        args.ausgabe = BASIS / ("site_demo" if args.demo else "site_staging" if umg == "staging" else "site")
    log.info("Umgebung: %s", umg)
    cfg = yaml.safe_load(args.config.read_text(encoding="utf-8"))
    heute = dt.date.today()

    if args.demo:
        from src.demo import demo_daten
        from src.demo import DEMO_LEITZINSEN
        from src.demo import DEMO_MARKT
        rohdaten, fx = demo_daten(cfg["watchlist"])
        zinsen, markt_daten = DEMO_LEITZINSEN, DEMO_MARKT
    else:
        from src.fetch import hole_alle, hole_leitzinsen
        rohdaten, fx = hole_alle(cfg["watchlist"])
        waehrungen = {w for e in cfg["watchlist"] if e.get("typ") == "forex" for w in (klassen.paar(e["symbol"]) or ())}
        try:
            zinsen = hole_leitzinsen(waehrungen)
        except Exception as exc:  # noqa: BLE001 – Carry-Signal zeigt dann „Daten fehlen“
            log.warning("Leitzinsen nicht abrufbar: %s", exc)
            zinsen = {}
        from src import markt
        try:
            markt_daten = markt.hole_alles(cfg["watchlist"], zinsen)
        except Exception as exc:  # noqa: BLE001 – betroffene Kriterien zeigen dann „Daten fehlen“
            log.warning("Marktdaten nicht abrufbar: %s", exc)
            markt_daten = {}

    ereignisse = backtest_vorbereiten(rohdaten, heute, args.demo)
    zeilen, warnungen = baue_zeilen(rohdaten, fx, cfg, heute, zinsen, markt_daten)
    if not zeilen:
        log.error("Für keinen Wert kamen Daten an – Abbruch.")
        return 1

    hist_pfad = BASIS / "data" / "historie.csv"
    vorwoche = {} if args.demo else historie.lade_letzten_stand(hist_pfad, heute)

    # Archiv: jede Woche ein vollständiger Schnappschuss unter site/archiv/JJJJ-MM-TT/
    archiv_ordner = args.ausgabe / "archiv"
    archiv_ordner.mkdir(parents=True, exist_ok=True)
    archiv = sorted(
        (
            {"datum": dt.date.fromisoformat(d.name), "pfad": f"archiv/{d.name}/index.html"}
            for d in archiv_ordner.iterdir()
            if d.is_dir() and _ist_datum(d.name) and d.name != heute.isoformat() and (d / "index.html").exists()
        ),
        key=lambda e: e["datum"], reverse=True,
    )

    kontext = baue_kontext(zeilen, warnungen, cfg, heute, vorwoche, args.demo, archiv, fx)
    kontext["umgebung"] = umg

    # Signal-Protokoll: gespeicherter Stand der Vorwoche, sonst mit den Kursen von vor fünf Handelstagen neu gerechnet
    signal_pfad = BASIS / "data" / "signale.json"
    jetzt = protokoll.aufnahme(zeilen)
    gespeichert = None if args.demo else protokoll.lade_vorwoche(signal_pfad, heute)
    if gespeichert:
        kontext["protokoll"] = protokoll.vergleiche(jetzt, gespeichert[1], gespeichert[0], "gespeichert")
    else:
        daten = [z["datum_vorwoche"] for z in zeilen if z.get("datum_vorwoche")]
        kontext["protokoll"] = protokoll.vergleiche(jetzt, protokoll.aufnahme(zeilen, "bewertung_vorwoche"),
                                                    max(daten) if daten else None, "neu berechnet")
    # Regel-Prüfstand: kursbasierte Signale über die letzten zehn Jahre
    kontext["pruefstand"] = pruefstand.berechne(rohdaten, zeilen, kriterien.mit_standard(cfg))
    # Intraday-Daten (OANDA) landen auf der öffentlichen Website nur, wenn config.yaml es erlaubt; lokal immer
    bt_cfg = cfg.get("backtest") or {}
    intraday = not os.environ.get("GITHUB_ACTIONS") or bool(bt_cfg.get("intraday_veroeffentlichen"))
    kontext["backtest"], kontext["backtest_dateien"] = backtest.paket(rohdaten, heute, args.demo, ereignisse, intraday)
    # Backtest-Katalog: verbreitete Werte außerhalb der Watchlist, damit man auch sie testen kann
    if bt_cfg.get("katalog") is not False:
        liste, dateien = backtest.katalog(backtest.katalog_eintraege(cfg), {r["symbol"].upper() for r in rohdaten}, heute, args.demo,
                                          cache=BASIS / "cache" / "backtest" / "katalog")
        kontext["backtest"]["katalog"] = liste
        kontext["backtest_dateien"] |= dateien
    # Wirtschaftskalender für den Work-Modus (offizielle Termine, Ist/Prognose/Vorwert)
    try:
        kontext["kalender"] = (kalender.demo(heute, kontext["aktien"]) if args.demo
                               else kalender.baue(heute, kontext["aktien"], BASIS / "cache" / "kalender"))
    except Exception as exc:  # noqa: BLE001 – der Bericht entsteht auch ohne Kalender
        log.warning("Kalender: %s", exc)
    render.schreibe_website(kontext, args.ausgabe)
    render.schreibe_website(kontext, archiv_ordner / heute.isoformat(), mit_archiv_liste=False)
    log.info("Website geschrieben: %s", args.ausgabe / "index.html")

    if not args.demo and umgebung.daten_schreiben_erlaubt():
        historie.speichere(hist_pfad, zeilen, heute)
        protokoll.speichere(signal_pfad, heute, jetzt)
    elif not args.demo:
        log.info("Staging: Historie und Signal-Protokoll in data/ bleiben unverändert")

    if not args.keine_mail and not umgebung.mail_erlaubt():
        log.info("Staging: keine E-Mail")
    elif not args.keine_mail:
        betreff = (
            f"{kontext['titel']} KW {kontext['kw']}: {len(kontext['treffer'])} Treffer, "
            f"{len(kontext['termine'])} Zahlentermine" + (" [DEMO]" if args.demo else "")
        )
        mailer.sende(betreff, render.email_html(kontext), render.email_text(kontext))
    return 0


if __name__ == "__main__":
    sys.exit(main())
