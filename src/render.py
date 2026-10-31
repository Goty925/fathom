"""Website (Übersicht + Detailseite je Unternehmen) und E-Mail erzeugen."""
from __future__ import annotations

import re
import shutil
from pathlib import Path

from jinja2 import Environment, FileSystemLoader, select_autoescape

BASIS = Path(__file__).resolve().parent.parent
VORLAGEN = BASIS / "templates"
ASSETS = BASIS / "assets"

EMPFEHLUNG_DE = {
    "strong_buy": "Starker Kauf", "buy": "Kaufen", "hold": "Halten",
    "underperform": "Untergewichten", "sell": "Verkaufen", "none": "–",
}
MONATE = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"]
MONATE_LANG = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September",
               "Oktober", "November", "Dezember"]
WOCHENTAGE = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"]
ZAHLWORTE = ["Keine", "Eine", "Zwei", "Drei", "Vier", "Fünf", "Sechs", "Sieben", "Acht", "Neun", "Zehn",
             "Elf", "Zwölf"]


# ---------------------------------------------------------------- Formatierung

def _pct(x, vorzeichen=True, nachkomma=1):
    if x is None:
        return "–"
    fmt = f"{{:{'+' if vorzeichen else ''}.{nachkomma}f}}"
    return (fmt.format(x * 100) + " %").replace("-", "−").replace(".", ",")


def _zahl(x, nachkomma=2):
    if x is None:
        return "–"
    s = f"{x:,.{nachkomma}f}"
    return s.replace(",", "X").replace(".", ",").replace("X", ".").replace("-", "−")


def _gross(x, waehrung=""):
    """Große Beträge kompakt: 9,9 Mrd. USD"""
    if x is None:
        return "–"
    a = abs(x)
    for grenze, wort, nk in ((1e12, "Bio.", 2), (1e9, "Mrd.", 1), (1e6, "Mio.", 0)):
        if a >= grenze:
            return f"{_zahl(x / grenze, nk)} {wort} {waehrung}".strip()
    return f"{_zahl(x, 0)} {waehrung}".strip()


def _vk(x):
    if x is None:
        return ""
    return "plus" if x > 0 else "minus" if x < 0 else ""


def _datum(d, art="kurz"):
    if not d:
        return "–"
    if art == "lang":
        return f"{d.day}. {MONATE_LANG[d.month - 1]} {d.year}"
    if art == "monat":
        return f"{MONATE[d.month - 1]} {d.strftime('%y')}"
    if art == "tag":
        return f"{WOCHENTAGE[d.weekday()]} {d.strftime('%d.%m.')}"
    return d.strftime("%d.%m.%Y")


def slug(symbol: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", symbol.lower()).strip("-")


def sparkline(werte: list[float], breite=96, hoehe=28) -> str:
    """Kleine statische Kurve für die Tabelle."""
    if not werte or len(werte) < 2:
        return ""
    lo, hi = min(werte), max(werte)
    spanne = (hi - lo) or 1
    n = len(werte) - 1
    y = lambda w: hoehe - 3 - (w - lo) / spanne * (hoehe - 6)  # noqa: E731
    punkte = " ".join(f"{i / n * (breite - 4):.1f},{y(w):.1f}" for i, w in enumerate(werte))
    return (
        f'<svg class="spark" viewBox="0 0 {breite} {hoehe}" width="{breite}" height="{hoehe}" aria-hidden="true">'
        f'<polyline points="{punkte}" fill="none" stroke="currentColor" stroke-width="1.5" '
        f'stroke-linejoin="round" stroke-linecap="round"/>'
        f'<circle cx="{breite - 4:.1f}" cy="{y(werte[-1]):.1f}" r="2.5" fill="#1a2433"/></svg>'
    )


def snowflake_svg(sf: dict | None, groesse: int = 220) -> str:
    """Fünfeckige Snowflake (Simply-Wall-St-Prinzip). Farbe nach Gesamtwert: rot (schwach) bis grün (stark)."""
    import math
    if not sf or sf.get("gesamt") is None:
        return ""
    achsen = list(sf["achsen"].items())
    c, r = groesse / 2, groesse / 2 - 34

    def punkt(i, anteil):
        w = -math.pi / 2 + i * 2 * math.pi / len(achsen)
        return c + math.cos(w) * r * anteil, c + math.sin(w) * r * anteil
    ringe = "".join(
        '<polygon class="sf-ring" points="' + " ".join(f"{x:.1f},{y:.1f}" for x, y in (punkt(i, a) for i in range(len(achsen)))) + '"/>'
        for a in (0.25, 0.5, 0.75, 1.0))
    speichen = "".join(f'<line class="sf-ring" x1="{c}" y1="{c}" x2="{punkt(i, 1)[0]:.1f}" y2="{punkt(i, 1)[1]:.1f}"/>' for i in range(len(achsen)))
    form = " ".join(f"{x:.1f},{y:.1f}" for x, y in (punkt(i, max(0.04, (v or 0) / 100)) for i, (_, v) in enumerate(achsen)))
    farbe = f"hsl({sf['gesamt'] * 1.2:.0f} 72% 50%)"
    labels = ""
    for i, (name, v) in enumerate(achsen):
        x, y = punkt(i, 1.22)
        anker = "middle" if abs(x - c) < 8 else "start" if x > c else "end"
        labels += f'<text class="sf-label" x="{x:.1f}" y="{y + 4:.1f}" text-anchor="{anker}">{name}</text>'
    aria = ", ".join(f"{n} {round(v) if v is not None else 'keine Daten'} von 100" for n, v in achsen)
    return (f'<svg class="snowflake" viewBox="0 0 {groesse} {groesse}" width="{groesse}" height="{groesse}" role="img" '
            f'aria-label="Snowflake: {aria}">{ringe}{speichen}<polygon class="sf-form" points="{form}" style="--sf: {farbe}"/>{labels}</svg>')


def technik_svg(t: dict | None) -> str:
    """Halbkreis-Tacho von „Starker Verkauf“ bis „Starker Kauf“ (Investing.com-Prinzip)."""
    import math
    if not t:
        return ""
    s = max(-1.0, min(1.0, t["score"]))
    w = math.pi * (1 - (s + 1) / 2)
    x, y = 100 + math.cos(w) * 66, 92 - math.sin(w) * 66

    def p(a, rr):
        return 100 + math.cos(a) * rr, 92 - math.sin(a) * rr
    segmente = ""
    for i in range(5):
        a0, a1 = math.pi * (1 - i / 5) - 0.02, math.pi * (1 - (i + 1) / 5) + 0.02
        (x0, y0), (x1, y1) = p(a0, 80), p(a1, 80)
        segmente += f'<path class="tt-seg tt-seg-{i}" d="M{x0:.1f} {y0:.1f} A80 80 0 0 1 {x1:.1f} {y1:.1f}"/>'
    return (f'<svg class="tacho" viewBox="0 0 200 104" width="200" height="104" aria-hidden="true">{segmente}'
            f'<line class="tt-nadel" x1="100" y1="92" x2="{x:.1f}" y2="{y:.1f}"/><circle class="tt-nabe" cx="100" cy="92" r="4"/></svg>')


def fazit(kontext: dict) -> tuple[str, str]:
    """Der Satz oben auf der Übersicht, plus eine Zeile darunter."""
    aktien, treffer = kontext["aktien"], kontext["treffer"]
    n, t = len(aktien), len(treffer)
    wort = lambda k: ZAHLWORTE[k] if k < len(ZAHLWORTE) else str(k)  # noqa: E731
    a = (kontext.get("auswahl") or {}).get("aktie") or {"zaehlt": [1, 2, 3, 4], "pflicht": [], "treffer_ab": 3}
    regel = f"mindestens {wort(a['treffer_ab']).lower()} der {wort(len(a['zaehlt']) + len(a['pflicht'])).lower()} Signale"
    if a["pflicht"]:
        regel += " samt aller Pflichtsignale"
    if t == 0:
        satz = f"Diese Woche erfüllt keine der {wort(n).lower()} Aktien {regel}."
    else:
        namen = [a["name"] for a in treffer]
        liste = namen[0] if len(namen) == 1 else ", ".join(namen[:-1]) + " und " + namen[-1]
        verb = "erfüllt" if t == 1 else "erfüllen"
        satz = f"{wort(t)} von {wort(n).lower()} Aktien {verb} diese Woche {regel}: {liste}."
    rest = kontext.get("knapp") or []
    unter = ""
    if rest:
        unter = "Knapp dahinter, ein Signal fehlt: " + ", ".join(x["name"] for x in rest) + "."
    return satz, unter


# ---------------------------------------------------------------- Diagrammdaten

def chart_daten(a: dict) -> dict:
    """JSON-Daten für die Diagramme der Detailseite (gezeichnet von assets/charts.js)."""
    c = a.get("chart_1j") or {}
    daten = {}
    if c.get("kurs"):
        band = None
        if a.get("kursziel_tief") and a.get("kursziel_hoch") and a.get("kursziel_mittel"):
            band = {"tief": a["kursziel_tief"], "mittel": a["kursziel_mittel"], "hoch": a["kursziel_hoch"]}
        daten["kurs"] = {
            "art": "linien", "titel": f"Kursverlauf {a['name']}, 12 Monate", "x": c["daten"],
            "serien": [{"name": "Kurs", "werte": c["kurs"], "klasse": "reihe-1"},
                       {"name": "200-Tage-Linie", "werte": c["gd200"], "klasse": "reihe-2"}],
            "band": band, "einheit": a.get("waehrung") or "",
        }
        if c.get("o"):  # Kerzen möglich: Eröffnung, Hoch, Tief zur Kursreihe
            daten["kurs"]["ohlc"] = {"o": c["o"], "h": c["h"], "l": c["l"]}
    hist = a.get("kgv_historie") or []
    if len(hist) >= 4:
        daten["kgv"] = {
            "art": "linien", "titel": "Forward-KGV, 5 Jahre", "x": [p["datum"].isoformat() for p in hist],
            "serien": [{"name": "Forward-KGV", "werte": [round(p["wert"], 2) for p in hist], "klasse": "reihe-1"}],
            "referenz": {"wert": a["forward_kgv_median_5j"], "name": "5-Jahres-Median"} if a.get("forward_kgv_median_5j") else None,
            "dezimalen": 1,
        }
    mh = [m for m in a.get("multiples_historie") or [] if m.get("kgv") or m.get("ev_ebitda")]
    if len(mh) >= 3:
        daten["multiples"] = {
            "art": "linien", "titel": "Bewertung je Geschäftsjahr", "x": [f"{m['jahr']}-12-31" for m in mh],
            "serien": [{"name": "KGV", "werte": [round(m["kgv"], 2) if m.get("kgv") else None for m in mh], "klasse": "reihe-1"},
                       {"name": "EV/EBITDA", "werte": [round(m["ev_ebitda"], 2) if m.get("ev_ebitda") else None for m in mh], "klasse": "reihe-2"}],
            "dezimalen": 1,
        }
    q = [x for x in a.get("quartale") or [] if x.get("umsatz") is not None]
    if q:
        daten["umsatz"] = {
            "art": "saeulen", "titel": "Umsatz je Quartal", "name": "Umsatz", "einheit": a.get("waehrung") or "",
            "labels": [f"{MONATE[x['datum'].month - 1]} {x['datum'].strftime('%y')}" for x in q],
            "tooltipTitel": [f"Quartal bis {_datum(x['datum'])}" for x in q],
            "werte": [x["umsatz"] for x in q],
        }
    return daten


def quartalstabelle(quartale: list[dict]) -> list[dict]:
    """Quartale (neueste zuerst) mit Wachstum ggü. Vorjahresquartal und Marge."""
    zeilen = []
    for i, q in enumerate(quartale):
        vorjahr = quartale[i - 4] if i >= 4 else None
        wachstum = (q["umsatz"] / vorjahr["umsatz"] - 1) if vorjahr and vorjahr.get("umsatz") and q.get("umsatz") else None
        marge = q["nettogewinn"] / q["umsatz"] if q.get("nettogewinn") is not None and q.get("umsatz") else None
        zeilen.append(q | {"wachstum": wachstum, "marge": marge})
    return list(reversed(zeilen))


# ---------------------------------------------------------------- Ausgabe

def _env() -> Environment:
    env = Environment(
        loader=FileSystemLoader(VORLAGEN),
        autoescape=select_autoescape(["html", "j2"]),
        trim_blocks=True,
        lstrip_blocks=True,
    )
    env.filters.update(
        pct=_pct, zahl=_zahl, gross=_gross, vk=_vk, datum=_datum,
        empfehlung=lambda k: EMPFEHLUNG_DE.get(k or "none", k),
    )
    from . import kriterien as _kat
    from .klassen import KLASSEN, SIGNALE
    from .screening import KRITERIEN
    env.globals.update(sparkline=sparkline, slug=slug, szenario_zeile=_szenarien.zeile, KRITERIEN=KRITERIEN, KLASSEN=KLASSEN,
                       snowflake_svg=snowflake_svg, technik_svg=technik_svg,
                       SIGNALE={"aktie": KRITERIEN, **SIGNALE},
                       KATALOG={typ: {k["name"]: k for k in liste} for typ, liste in _kat.KATALOG.items()})
    return env


def live_basis(kontext: dict) -> dict:
    """Wochenwerte, aus denen der Browser bei Live-Kursen alles neu berechnet."""
    werte = {}
    for a in alle_werte(kontext):
        b = a.get("bewertung") or {}
        pr = b.get("pruefungen", {})
        werte[slug(a["symbol"])] = {
            "symbol": a["symbol"],
            "finnhub": a.get("finnhub"),
            "name": a["name"],
            "typ": a["typ"],
            "waehrung": a.get("waehrung"),
            "dez": a.get("dezimalen") or 2,
            "kurs": a.get("kurs"),
            "kurs_datum": a["kurs_datum"].isoformat() if a.get("kurs_datum") else None,
            "hoch": a.get("hoch_52w"),
            "tief": a.get("tief_52w"),
            "ziel": a.get("kursziel_mittel"),
            "fwd_kgv": a.get("forward_kgv"),
            "kgv_median": a.get("forward_kgv_median_5j"),
            "boersenwert_eur": a.get("boersenwert_eur"),
            "isin": a.get("isin"),
            "sektor": (a.get("profil") or {}).get("sektor"),
            "rendite_1w": a.get("rendite_1w"),
            "rendite_ytd": a.get("rendite_ytd"),
            "technik": (a.get("technik") or {}).get("fazit"),
            # Quartalszahlen ändern sich nicht mit dem Kurs: Ergebnis aus dem Wochenbericht übernehmen
            "zahlen": (pr.get("Earnings Momentum") or {}).get("erfuellt"),
            "zahlen_staerke": (pr.get("Earnings Momentum") or {}).get("staerke"),
            "zahlen_text": (pr.get("Earnings Momentum") or {}).get("begruendung"),
            # Rohwerte, damit der Browser alle Signale mit eigenen Schwellen neu rechnen und den Rechenweg zeigen kann
            "umsatz_yoy": a.get("umsatzwachstum"),
            "gewinn_yoy": a.get("gewinnwachstum"),
            "earnings": a["naechste_zahlen"].isoformat() if a.get("naechste_zahlen") and a.get("zahlen_bald") else None,
            "f": {s: _rund(a.get(s)) for s in ("momentum_12_1", "mittel_5j", "vol_1m", "vol_median_1j", "gd200")},
            "carry": _carry(a) if a["typ"] == "forex" else None,
            "py": {n: {"e": x.get("erfuellt"), "s": None if x.get("staerke") is None else round(x["staerke"], 2)}
                   for n, x in (a.get("katalog") or {}).items()},
            "kz": {k: (round(v, 8) if isinstance(v, float) else v) for k, v in (a.get("kz") or {}).items()},
            # Downside, Basis, Upside für vier Quartale: Standardannahmen, Ist-Anker, Unsicherheiten (src/szenarien.py)
            "sz": a.get("szenarien"),
        }
    kk = kontext.get("kriterien_klassen") or _klassen.mit_standard({})
    return {"kriterien": kontext["kriterien"], "stand": kontext["stand"].isoformat(), "werte": werte, "demo": bool(kontext.get("demo")),
            "kriterien_klassen": {typ: kk[f"kriterien_{typ}"] for typ in ("forex", "rohstoff", "index")},
            "zahlen_warnung_tage": kontext.get("zahlen_warnung_tage"),
            "spez": kontext.get("spez"),
            "fx": kontext.get("fx") or {}}


def _rund(x):
    return None if x is None else round(float(x), 8)


def _carry(a: dict) -> dict | None:
    """Leitzinsen hinter dem Carry-Signal (für den Rechenweg im Browser)."""
    p = _klassen.paar(a["symbol"])
    z = a.get("leitzinsen") or {}
    if not p:
        return None
    return {"basis": p[0], "gegen": p[1], "zins_basis": z.get(p[0]), "zins_gegen": z.get(p[1]),
            "differenz": a.get("zinsdifferenz")}


from . import klassen as _klassen  # noqa: E402
from . import kriterien as _kriterien  # noqa: E402
from . import szenarien as _szenarien  # noqa: E402


def alle_werte(kontext: dict) -> list[dict]:
    """Alle Werte in der Reihenfolge der Kacheln: Aktien, ETFs, Forex, Rohstoffe, Indizes."""
    k = kontext.get("klassen") or {}
    return kontext["aktien"] + kontext["etfs"] + k.get("forex", []) + k.get("rohstoff", []) + k.get("index", [])


def schreibe_website(kontext: dict, ziel: Path, mit_archiv_liste: bool = True) -> None:
    """Schreibt index.html (Übersicht mit allen Analysen als Panel) und die Assets nach `ziel`."""
    import json

    env = _env()
    ziel.mkdir(parents=True, exist_ok=True)
    shutil.copytree(ASSETS, ziel / "assets", dirs_exist_ok=True)
    alte_seiten = ziel / "aktie"  # Einzelseiten früherer Versionen entfernen
    if alte_seiten.is_dir():
        shutil.rmtree(alte_seiten)

    alle = alle_werte(kontext)
    satz, unter = fazit(kontext)
    basis = live_basis(kontext)
    k = kontext | {
        "basis": "", "fazit": satz, "fazit_unter": unter, "alle": alle,
        "charts": {slug(a["symbol"]): chart_daten(a) for a in alle},
        "quartalstabellen": {slug(a["symbol"]): quartalstabelle(a.get("quartale") or []) for a in alle},
        "live_basis": basis,
        "definitionen": _kriterien.definitionen(_kriterien.mit_standard({"kriterien": kontext["kriterien"], **{
            f"kriterien_{t}": v for t, v in ((kontext.get("spez") or {}).get("params") or {}).items() if t != "aktie"}})),
        "archiv_seite": not mit_archiv_liste,
    }
    if not mit_archiv_liste:
        k["archiv"] = []
    (ziel / "index.html").write_text(env.get_template("uebersicht.html.j2").render(**k), encoding="utf-8")
    if kontext.get("umgebung") == "staging":  # Staging nie in Suchmaschinen (zusätzlich zum noindex im Kopf)
        (ziel / "robots.txt").write_text("User-agent: *\nDisallow: /\n", encoding="utf-8")
    (ziel / "daten").mkdir(exist_ok=True)
    (ziel / "daten" / "basis.json").write_text(json.dumps(basis, ensure_ascii=False, indent=1), encoding="utf-8")
    # Backtest-Daten (Tageskurse mit Eröffnung/Hoch/Tief und Zahlenterminen), lädt assets/backtest.js beim Öffnen
    if mit_archiv_liste and kontext.get("backtest"):
        (ziel / "daten" / "backtest.json").write_text(json.dumps(kontext["backtest"], separators=(",", ":")), encoding="utf-8")
        ordner = ziel / "daten" / "backtest"
        if ordner.is_dir():
            shutil.rmtree(ordner)  # keine Intraday-Daten stehen lassen, die nicht mehr veröffentlicht werden sollen
        for name, inhalt in (kontext.get("backtest_dateien") or {}).items():
            (ordner / f"{name}.json").parent.mkdir(parents=True, exist_ok=True)
            (ordner / f"{name}.json").write_text(json.dumps(inhalt, separators=(",", ":")), encoding="utf-8")
    # Wirtschaftskalender für den Work-Modus (assets/work.js lädt ihn beim Öffnen)
    if mit_archiv_liste and kontext.get("kalender"):
        (ziel / "daten" / "kalender.json").write_text(json.dumps(kontext["kalender"], ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    # Kurs-Feed je Wert für Portfolio Performance: [{"date": "JJJJ-MM-TT", "close": …}, …]; mit Eröffnung, Hoch und
    # Tief (open/high/low) für die Kerzencharts der Website. Portfolio Performance liest nur date und close.
    feeds = ziel / "daten" / "kurse"
    feeds.mkdir(exist_ok=True)
    for a in alle:
        reihe = a.get("kursreihe") or []
        if reihe:
            ohlc = a.get("kursreihe_ohlc") or [None] * len(reihe)
            zeilen = [{"date": d, "close": c} | ({"open": k[0], "high": k[1], "low": k[2]} if k else {})
                      for (d, c), k in zip(reihe, ohlc)]
            (feeds / f"{slug(a['symbol'])}.json").write_text(json.dumps(zeilen, separators=(",", ":")), encoding="utf-8")


def email_html(kontext: dict) -> str:
    satz, unter = fazit(kontext)
    return _env().get_template("email.html.j2").render(**kontext, fazit=satz, fazit_unter=unter)


def email_text(kontext: dict) -> str:
    """Schlichte Textfassung für Mailprogramme ohne HTML."""
    satz, _ = fazit(kontext)
    z = [f"{kontext['titel']}, {_datum(kontext['stand'], 'lang')}", "", satz, ""]
    for a in kontext["aktien"]:
        z.append(
            f"{a['name']:<16} {_zahl(a['kurs'])} {a['waehrung'] or ''}  1 Woche {_pct(a['rendite_1w'])}  "
            f"Signale {a['bewertung']['punkte']}/{a['bewertung']['max_punkte']}"
            + (f"  {_szenarien.zeile(a['szenarien'])}" if a.get("szenarien") else "")
        )
    pk = kontext.get("protokoll") or {}
    if pk.get("eintraege"):
        z += ["", f"Seit letzter Woche: {pk['gewonnen']} Signale neu erfüllt, {pk['verloren']} nicht mehr"]
        for e in pk["eintraege"][:8]:
            teile = [f"{g['signal']} neu erfüllt" for g in e["gewonnen"]] + [f"{g['signal']} nicht mehr erfüllt" for g in e["verloren"]]
            z.append(f"  {e['name']}: {', '.join(teile)} ({e['punkte_vorher']} → {e['punkte']})")
    if kontext["termine"]:
        z += ["", "Quartalszahlen demnächst:"]
        z += [f"  {_datum(t['datum'], 'tag')} {t['name']}" for t in kontext["termine"]]
    if kontext.get("website_url"):
        z += ["", f"Ganzer Bericht mit Analysen: {kontext['website_url']}"]
    z += ["", "Screening nach eigenen Regeln, keine Anlageberatung."]
    return "\n".join(z)
