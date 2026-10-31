"""Erfundene Beispieldaten, um den Bericht ohne Internet zu testen.

Kurse sind ein Zufallspfad, Kennzahlen grob angelehnt an den Stand
Oktober 2026, aber NICHT aktuell. Der Bericht zeigt im Demo-Modus
deutlich "Demo-Daten" an.
"""
from __future__ import annotations

import datetime as dt
import math

import numpy as np
import pandas as pd

# symbol: (heutiger Kurs, Trend, Vola, Währung, Börsenwert, KGV, Fwd-KGV, Median-KGV,
#          Umsatz-Wachstum, Gewinn-Wachstum, Kursziel-Faktor, Analysten, Empfehlung, Tage bis Zahlen,
#          Quartalsumsatz in Mrd., Nettomarge, Sektor, Branche, Land)
_PROFILE = {
    "SAP.DE":  (197, -0.15, 0.022, "EUR", 2.3e11, 32, 23, 30, 0.09, 0.07, 1.10, 28, "buy", 7, 9.9, 0.20,
                "Technology", "Software – Application", "Germany"),
    "ADBE":    (240, -0.45, 0.024, "USD", 9.2e10, 15, 9.5, 27, 0.13, 0.15, 1.25, 36, "hold", 57, 6.8, 0.30,
                "Technology", "Software – Application", "United States"),
    "NOW":     (127, -0.40, 0.026, "USD", 1.43e11, 37, 28, 55, 0.22, 0.12, 1.30, 40, "buy", 8, 3.4, 0.14,
                "Technology", "Software – Application", "United States"),
    "CRM":     (238, 0.00, 0.020, "USD", 2.3e11, 30, 15, 29, 0.11, 0.18, 1.12, 45, "buy", 43, 11.4, 0.17,
                "Technology", "Software – Application", "United States"),
    "MSFT":    (517, 0.15, 0.016, "USD", 3.8e12, 33, 27, 30, 0.18, 0.23, 1.15, 55, "strong_buy", 14, 90, 0.36,
                "Technology", "Software – Infrastructure", "United States"),
    "NVDA":    (228, 0.25, 0.028, "USD", 5.5e12, 40, 25, 35, 0.70, 0.60, 1.20, 60, "strong_buy", 42, 92, 0.55,
                "Technology", "Semiconductors", "United States"),
    "2899.HK": (26, 0.30, 0.025, "HKD", 8.5e11, 14, 11, 13, 0.16, 0.68, 1.15, 20, "buy", 9, 100, 0.20,
                "Basic Materials", "Gold", "China"),
    "IUSQ.DE": (95, 0.08, 0.009, "EUR", None, None, None, None, None, None, None, None, None, None, None, None,
                None, None, None),
}
_FX = {"EUR": 1.0, "USD": 0.86, "HKD": 0.11, "JPY": 0.0058, "CHF": 1.07, "GBP": 1.15, "CNY": 0.12}

# Währungen, Rohstoffe, Indizes: (heutiger Kurs, Trend über 5 Jahre, Tagesvola, Währung)
_MAERKTE = {
    "EURUSD=X": (1.085, -0.05, 0.0045, "USD"), "EURJPY=X": (171.5, 0.35, 0.006, "JPY"),
    "GBPUSD=X": (1.27, 0.02, 0.005, "USD"), "EURCHF=X": (0.935, -0.12, 0.004, "CHF"),
    "USDJPY=X": (158.0, 0.40, 0.006, "JPY"), "AUDUSD=X": (0.66, -0.10, 0.006, "USD"),
    "GC=F": (2650.0, 0.85, 0.010, "USD"), "SI=F": (31.2, 0.45, 0.018, "USD"),
    "BZ=F": (68.4, -0.10, 0.020, "USD"), "HG=F": (4.35, 0.30, 0.015, "USD"),
    "CL=F": (64.9, -0.12, 0.021, "USD"), "NG=F": (2.9, -0.30, 0.035, "USD"),
    "^GDAXI": (23950.0, 0.55, 0.010, "EUR"), "^GSPC": (6650.0, 0.60, 0.010, "USD"),
    "^NDX": (24100.0, 0.75, 0.013, "USD"), "^STOXX50E": (5480.0, 0.40, 0.010, "EUR"),
    "ES=F": (6680.0, 0.60, 0.010, "USD"), "NQ=F": (24200.0, 0.75, 0.013, "USD"),
}

# Leitzinsen laut BIS-Statistik, Stand Anfang Oktober 2026 (nur für den Demo-Modus)
DEMO_LEITZINSEN = {"EUR": 0.025, "USD": 0.03875, "GBP": 0.0375, "JPY": 0.0125, "CHF": 0.0, "AUD": 0.036}

# Marktdaten für die erweiterten Kriterien (nur Demo, grob am Stand Oktober 2026 orientiert)
DEMO_MARKT = {
    "vix": 16.8, "vix3m": 19.1, "hy_spread": 0.0312, "hy_datum": "16.10.2026",
    "zinsen_3m": {"EUR": 0.0275, "USD": 0.0400, "GBP": 0.04, "JPY": 0.0075, "CHF": 0.0, "AUD": 0.036},
    "inflation": {"EUR": 0.0215, "USD": 0.029, "GBP": 0.034, "JPY": 0.024, "CHF": 0.004, "AUD": 0.031},
    "kurven": {
        "GC=F": {"roll": -0.041, "f1": 2662.4, "f2": 2680.6, "k1": "GCZ26", "k2": "GCG27", "monate": 2},
        "SI=F": {"roll": -0.048, "f1": 31.32, "f2": 31.57, "k1": "SIZ26", "k2": "SIH27", "monate": 2},
        "BZ=F": {"roll": 0.062, "f1": 68.40, "f2": 68.05, "k1": "BZZ26", "k2": "BZF27", "monate": 1},
        "HG=F": {"roll": -0.022, "f1": 4.36, "f2": 4.376, "k1": "HGZ26", "k2": "HGH27", "monate": 2},
    },
    "cot": {
        "GC=F": {"netto": 0.27, "perzentil": 0.91, "wochen": 156}, "SI=F": {"netto": 0.18, "perzentil": 0.64, "wochen": 156},
        "BZ=F": {"netto": 0.06, "perzentil": 0.22, "wochen": 156}, "HG=F": {"netto": 0.09, "perzentil": 0.58, "wochen": 156},
    },
}

# Kleiner Katalog für die Suche im Demo-Modus (live.py --demo), im Format der Yahoo-Suche
DEMO_SUCHE = [
    {"symbol": s, "longname": n, "exchange": ex, "exchDisp": ed, "quoteType": qt}
    for s, n, ex, ed, qt in [
        ("AAPL", "Apple Inc.", "NMS", "NASDAQ", "EQUITY"), ("APC.DE", "Apple Inc.", "GER", "XETRA", "EQUITY"),
        ("APC.F", "Apple Inc.", "FRA", "Frankfurt", "EQUITY"),
        ("AMZN", "Amazon.com, Inc.", "NMS", "NASDAQ", "EQUITY"), ("AMZ.DE", "Amazon.com, Inc.", "GER", "XETRA", "EQUITY"),
        ("ASML.AS", "ASML Holding N.V.", "AMS", "Amsterdam", "EQUITY"), ("ASME.DE", "ASML Holding N.V.", "GER", "XETRA", "EQUITY"),
        ("ALV.DE", "Allianz SE", "GER", "XETRA", "EQUITY"), ("ADS.DE", "adidas AG", "GER", "XETRA", "EQUITY"),
        ("AIR.PA", "Airbus SE", "PAR", "Paris", "EQUITY"), ("AIR.DE", "Airbus SE", "GER", "XETRA", "EQUITY"),
        ("META", "Meta Platforms, Inc.", "NMS", "NASDAQ", "EQUITY"), ("FB2A.DE", "Meta Platforms, Inc.", "GER", "XETRA", "EQUITY"),
        ("GOOGL", "Alphabet Inc.", "NMS", "NASDAQ", "EQUITY"), ("ABEA.DE", "Alphabet Inc.", "GER", "XETRA", "EQUITY"),
        ("TSLA", "Tesla, Inc.", "NMS", "NASDAQ", "EQUITY"), ("TL0.DE", "Tesla, Inc.", "GER", "XETRA", "EQUITY"),
        ("SIE.DE", "Siemens Aktiengesellschaft", "GER", "XETRA", "EQUITY"), ("RHM.DE", "Rheinmetall AG", "GER", "XETRA", "EQUITY"),
        ("MUV2.DE", "Münchener Rückversicherungs-Gesellschaft AG", "GER", "XETRA", "EQUITY"),
        ("NOVO-B.CO", "Novo Nordisk A/S", "CPH", "Copenhagen", "EQUITY"), ("NOV.DE", "Novo Nordisk A/S", "GER", "XETRA", "EQUITY"),
        ("TCEHY", "Tencent Holdings Limited", "PNK", "OTC Markets", "EQUITY"), ("0700.HK", "Tencent Holdings Limited", "HKG", "HKSE", "EQUITY"),
        ("NNND.F", "Tencent Holdings Limited", "FRA", "Frankfurt", "EQUITY"),
        ("SMCI", "Super Micro Computer, Inc.", "NMS", "NASDAQ", "EQUITY"),
        ("EUNL.DE", "iShares Core MSCI World UCITS ETF USD (Acc)", "GER", "XETRA", "ETF"),
        ("VWCE.DE", "Vanguard FTSE All-World UCITS ETF USD Accumulation", "GER", "XETRA", "ETF"),
        ("EURUSD=X", "EUR/USD", "CCY", "CCY", "CURRENCY"), ("USDJPY=X", "USD/JPY", "CCY", "CCY", "CURRENCY"),
        ("AUDUSD=X", "AUD/USD", "CCY", "CCY", "CURRENCY"), ("EURJPY=X", "EUR/JPY", "CCY", "CCY", "CURRENCY"),
        ("GC=F", "Gold", "CMX", "COMEX", "FUTURE"), ("SI=F", "Silver", "CMX", "COMEX", "FUTURE"),
        ("CL=F", "Crude Oil", "NYM", "NY Mercantile", "FUTURE"), ("NG=F", "Natural Gas", "NYM", "NY Mercantile", "FUTURE"),
        ("ES=F", "E-Mini S&P 500", "CME", "CME", "FUTURE"), ("NQ=F", "Nasdaq 100", "CME", "CME", "FUTURE"),
        ("^GDAXI", "DAX PERFORMANCE-INDEX", "GER", "XETRA", "INDEX"), ("^GSPC", "S&P 500", "SNP", "SNP", "INDEX"),
        ("^NDX", "NASDAQ 100", "NIM", "Nasdaq GIDS", "INDEX"), ("^STOXX50E", "EURO STOXX 50", "STO", "STOXX", "INDEX"),
    ]
]


def _kurse(kurs_heute, trend, vola, seed, tage=504) -> pd.Series:
    rng = np.random.default_rng(seed)
    renditen = rng.normal(trend / tage, vola, tage)
    renditen[330:360] -= vola * 0.25  # Rücksetzer einbauen, damit "lokales Tief" sichtbar wird
    pfad = np.exp(np.cumsum(renditen))
    werte = kurs_heute * pfad / pfad[-1]
    index = pd.bdate_range(end=pd.Timestamp.today().normalize(), periods=tage)
    return pd.Series(werte, index=index)


def _ohlc(kurse: pd.Series, vola: float, seed: int, zahlen: list[dict] | None = None) -> pd.DataFrame:
    """Eröffnung, Hoch und Tief passend zu den Schlusskursen; an Zahlentagen springt die Eröffnung mit der Überraschung."""
    rng = np.random.default_rng(seed + 500)
    c = kurse.to_numpy()
    vor = np.concatenate([[c[0]], c[:-1]])
    o = vor * (1 + rng.normal(0, vola * 0.45, len(c)))
    for e in zahlen or []:
        i = kurse.index.searchsorted(pd.Timestamp(e["zeit"].date()) + pd.Timedelta(days=0 if e["zeit"].hour < 9 else 1))
        if 0 < i < len(c) and e["schaetzung"]:
            o[i] = vor[i] * (1 + 0.6 * (e["ist"] / e["schaetzung"] - 1))
    h = np.maximum(o, c) * (1 + np.abs(rng.normal(0, vola * 0.55, len(c))))
    tief = np.minimum(o, c) * (1 - np.abs(rng.normal(0, vola * 0.55, len(c))))
    return pd.DataFrame({"Open": o, "High": h, "Low": tief, "Close": c}, index=kurse.index)


def _zahlen_historie(kurse: pd.Series, seed: int) -> list[dict]:
    """Quartalszahlen etwa alle 63 Handelstage, abwechselnd vor Börsenbeginn und nach Börsenschluss (New Yorker Zeit)."""
    rng = np.random.default_rng(seed + 900)
    aus = []
    for j, i in enumerate(range(40, len(kurse) - 5, 63)):
        tag = kurse.index[i]
        zeit = tag + (pd.Timedelta(hours=7) if j % 2 else pd.Timedelta(hours=16, minutes=5))
        schaetzung = round(1.0 + j * 0.04, 2)
        ist = round(schaetzung * (1 + rng.normal(0.025, 0.06)), 2)
        aus.append({"zeit": pd.Timestamp(zeit).tz_localize("America/New_York"), "schaetzung": schaetzung, "ist": ist})
    return aus


def _quartalsenden(n: int) -> list[dt.date]:
    heute = pd.Timestamp.today()
    letztes = (heute - pd.offsets.QuarterEnd(1)).normalize()
    return [(letztes - pd.offsets.QuarterEnd(i)).date() for i in reversed(range(n))]


def demo_daten(watchlist: list[dict], seed_basis: int = 0) -> tuple[list[dict], dict]:
    heute = dt.date.today()
    rohdaten = []
    for i, eintrag in enumerate(watchlist, start=seed_basis):
        p = _PROFILE.get(eintrag["symbol"]) or (100, 0.05, 0.02, "EUR", 1e11, 20, 18, 20, 0.05, 0.05, 1.1, 10,
                                               "hold", 30, 5, 0.1, None, None, None)
        (kurs, trend, vola, wae, mcap, kgv, fkgv, med, umsatz_w, gewinn_w, ziel_f, n, empf, tage,
         q_umsatz, marge, sektor, branche, land) = p
        rng = np.random.default_rng(100 + i)
        kurse = _kurse(kurs, trend * 3, vola, seed=i + 7, tage=2772)
        typ = eintrag.get("typ", "aktie")
        if typ in ("forex", "rohstoff", "index") or eintrag["symbol"] in _MAERKTE:
            kurs_m, trend_m, vola_m, wae_m = _MAERKTE.get(eintrag["symbol"], (100.0, 0.1, 0.01, "USD"))
            rohdaten.append({
                "symbol": eintrag["symbol"], "name": eintrag.get("name", eintrag["symbol"]), "typ": typ,
                "waehrung": wae_m, "boersenwert": None,
                "kurse": (k_m := _kurse(kurs_m, trend_m, vola_m, seed=i + 7, tage=2772)),
                "ohlc": _ohlc(k_m, vola_m, seed=i + 7),
                "profil": {"beschreibung": None, "sektor": None, "branche": None, "land": None,
                           "mitarbeiter": None, "website": None},
            })
            continue
        d = {
            "symbol": eintrag["symbol"],
            "name": eintrag.get("name", eintrag["symbol"]),
            "typ": typ,
            "isin": eintrag.get("isin"),
            "boerse": "GER" if eintrag["symbol"].endswith(".DE") else "HKG" if eintrag["symbol"].endswith(".HK") else "NMS",
            "quellen": {"Kurse": "Demo", "Profil": "Demo", "Schätzungen": "Demo"},
            "waehrung": wae,
            "finanzwaehrung": "CNY" if wae == "HKD" else wae,
            "boersenwert": mcap,
            "kurse": kurse,
            "zahlen_historie": (zh := _zahlen_historie(kurse, i) if typ == "aktie" else []),
            "ohlc": _ohlc(kurse, vola, seed=i + 7, zahlen=zh),
            "profil": {
                "beschreibung": (f"Demo-Beschreibung für {eintrag.get('name')}. Im echten Bericht steht hier "
                                 "die Unternehmensbeschreibung von Yahoo Finance (auf Englisch): Geschäftsfelder, "
                                 "Produkte, Kundengruppen und Regionen."),
                "sektor": sektor, "branche": branche, "land": land,
                "mitarbeiter": int(rng.integers(10, 230)) * 1000 if sektor else None,
                "website": None,
            },
        }
        if typ == "etf":
            rohdaten.append(d)
            continue

        enden = _quartalsenden(6)
        basis = q_umsatz * 1e9 / (1 + umsatz_w)
        # Gewinn je Aktie passend zum KGV: die letzten vier Quartale ergeben Kurs / KGV (bereinigt), GuV etwas darunter
        rng_e = np.random.default_rng(300 + i)
        roh = [(1 + gewinn_w) ** (j / 4) * (1 + rng_e.normal(0, 0.04)) for j in range(6)]
        eps_q = [r * (kurs / kgv) / sum(roh[2:]) * _FX[wae] / _FX["CNY" if wae == "HKD" else wae] for r in roh]
        quartale = []
        for j, ende in enumerate(enden):
            u = basis * (1 + umsatz_w) ** ((j - 1) / 4) * (1 + rng.normal(0, 0.015))
            m = marge * (1 + rng.normal(0, 0.06))
            quartale.append({"datum": ende, "umsatz": u, "nettogewinn": u * m, "operativer_gewinn": u * m * 1.3,
                             "eps": eps_q[j] * 0.94, "fcf": u * m * 1.1})
        kgv_hist = []
        for j, ende in enumerate(_quartalsenden(20)):
            wert = med * (1 + 0.25 * np.sin(j / 3)) * (1 + rng.normal(0, 0.05))
            kgv_hist.append({"datum": ende, "wert": float(wert)})
        kgv_hist[-1]["wert"] = float(fkgv)
        eps_jahr = kurs / fkgv
        # Konsens fürs nächste Geschäftsjahr: Wachstum und Spanne der Schätzungen je Wert verschieden
        g1 = round(min(0.45, 0.04 + 0.6 * gewinn_w), 3)
        g0 = round(min(0.4, 0.03 + 0.5 * gewinn_w), 3)   # laufendes Quartal gegenüber dem Vorjahresquartal
        spanne = [0.05 + 0.25 * g1 + abs(rng_e.normal(0, 0.02)), 0.06 + 0.3 * g1 + abs(rng_e.normal(0, 0.03))]
        d |= {
            "kgv": kgv, "forward_kgv": fkgv, "forward_kgv_median_5j": med, "kgv_historie": kgv_hist,
            "umsatzwachstum": umsatz_w, "gewinnwachstum": gewinn_w,
            "kursziel_mittel": kurs * ziel_f, "kursziel_tief": kurs * (ziel_f - 0.3), "kursziel_hoch": kurs * (ziel_f + 0.3),
            "analysten_anzahl": n, "empfehlung": empf, "eps_wachstum_naechstes_jahr": 0.12,
            "naechste_zahlen": heute + dt.timedelta(days=tage),
            "quartale": quartale,
            "eps_historie": [
                {"quartal": e, "schaetzung": eps_q[j + 2] / (1 + rng.normal(0.03, 0.04)), "ist": eps_q[j + 2],
                 "ueberraschung": None} for j, e in enumerate(enden[-4:])
            ],
            "schaetzungen": [
                {"periode": "Laufendes Quartal", "eps_mittel": eps_q[2] * (1 + g0), "eps_tief": eps_q[2] * (1 + g0) * 0.93,
                 "eps_hoch": eps_q[2] * (1 + g0) * 1.06, "eps_wachstum": g0, "analysten": n - 4,
                 "umsatz_mittel": q_umsatz * 1e9 * 1.02, "umsatz_wachstum": umsatz_w, "eps_vor_90_tagen": eps_q[2] * (1 + g0) * 0.98,
                 "eps_vorjahr": eps_q[2], "umsatz_vorjahr": q_umsatz * 1e9 * 1.02 / (1 + umsatz_w),
                 "hoch_30": 3, "runter_30": 1},
                {"periode": "Nächstes Geschäftsjahr", "eps_mittel": eps_jahr * (1 + g1), "eps_tief": eps_jahr * (1 + g1) * (1 - spanne[0]),
                 "eps_hoch": eps_jahr * (1 + g1) * (1 + spanne[1]), "eps_wachstum": g1, "analysten": n - 2,
                 "umsatz_mittel": q_umsatz * 4.3e9, "umsatz_wachstum": umsatz_w * 0.9, "eps_vor_90_tagen": eps_jahr * (1 + g1) * 1.08 / 1.12,
                 "hoch_30": 6, "runter_30": 2},
            ],
            "analysten_verteilung": {"strongBuy": n // 4, "buy": n // 3, "hold": n // 4, "sell": 1, "strongSell": 0},
            "multiples": {"ev_ebitda": fkgv * 0.8, "kuv": 6.5, "kbv": 5.2, "peg": 1.4, "dividendenrendite": 0.008},
            "bilanz": {"bruttomarge": 0.72, "operative_marge": marge * 1.3, "nettomarge": marge,
                       "eigenkapitalrendite": 0.22, "verschuldungsgrad": 0.35, "freier_cashflow": q_umsatz * 4e9 * marge,
                       "liquide_mittel": q_umsatz * 1.2e9, "schulden": q_umsatz * 0.9e9, "beta": 1.1},
        }
        # 10 Geschäftsjahre, rückwärts aus dem aktuellen Umsatz und Wachstum gerechnet (Fundamentals-Terminal)
        aktien = mcap / kurs if mcap else None
        jahre, u = [], q_umsatz * 4e9
        for k in range(10):
            jahr = heute.year - 1 - k
            m_j = marge * (1 + rng.normal(0, 0.08))
            ebit = u * m_j * 1.3
            jahre.append({"jahr": jahr, "ende": dt.date(jahr, 12, 31), "umsatz": u, "bruttogewinn": u * 0.68,
                          "ebit": ebit, "ebitda": ebit * 1.15, "nettogewinn": u * m_j,
                          "eps": u * m_j / aktien if aktien else None, "fcf": u * m_j * 1.1,
                          "schulden": u * 0.25, "cash": u * 0.3, "aktien": aktien, "dividende_je_aktie": None})
            u = u / (1 + umsatz_w * (1 + rng.normal(0, 0.25)))
        d["jahreszahlen"] = sorted(jahre, key=lambda j: j["jahr"])
        d["aktien_anzahl"] = aktien
        d["eulerpool_bewertung"] = {}
        d["peers"] = [{"name": n, "isin": None, "ticker": None} for n in
                      (["Oracle", "Intuit", "Workday", "Atlassian"] if sektor == "Technology" else ["Newmont", "Barrick Gold", "Agnico Eagle"])]
        if "." not in eintrag["symbol"]:  # US-Aktie: zweite Schätzung wie von Finnhub
            q0 = d["schaetzungen"][0]
            d["finnhub_erwartung"] = {"datum": d["naechste_zahlen"].isoformat(),
                                      "eps": q0["eps_mittel"] * (1 + rng.normal(0, 0.02)),
                                      "umsatz": q0["umsatz_mittel"] * (1 + rng.normal(0, 0.01))}
        for e in d["eps_historie"]:
            e["ueberraschung"] = e["ist"] / e["schaetzung"] - 1
        rohdaten.append(d)
    return rohdaten, _FX


# ---------------------------------------------------------------- Backtest: Wirtschaftsdaten und Intraday (Demo)

def demo_ereignisse(heute: dt.date, jahre: int = 11) -> list[dict]:
    """Zufällige, aber plausible US-Termine (CPI Mitte des Monats, Arbeitsmarktbericht am ersten Freitag)."""
    from . import wirtschaft
    rng = np.random.default_rng(4711)
    start = heute - dt.timedelta(days=round(365.25 * jahre))
    monate = pd.period_range(pd.Timestamp(start).to_period("M") + 1, pd.Timestamp(heute).to_period("M") - 1, freq="M")
    reihen = {k: [] for k in wirtschaft.INDIKATOREN}
    stand = {"us_cpi_j": 1.6, "us_cpi_m": 0.2, "us_kern_j": 1.9, "us_kern_m": 0.2, "us_nfp": 180.0, "us_alq": 4.9}
    for m in monate:
        bericht = m.to_timestamp().date()
        # CPI: zweiter Mittwoch bis Freitag des Folgemonats; Arbeitsmarkt: erster Freitag des Folgemonats
        folge = (m + 1).to_timestamp().date()
        cpi_tag = folge + dt.timedelta(days=9 + int(rng.integers(0, 5)))
        while cpi_tag.weekday() > 4:
            cpi_tag += dt.timedelta(days=1)
        nfp_tag = folge + dt.timedelta(days=(4 - folge.weekday()) % 7)
        for iid, ind in wirtschaft.INDIKATOREN.items():
            tag = cpi_tag if ind["gruppe"] == "us_cpi" else nfp_tag
            if tag >= heute:
                continue
            vor = stand[iid]
            if iid == "us_nfp":
                prognose = round(150 + rng.normal(0, 40))
                ist = round(prognose + rng.normal(0, 90))
            elif iid == "us_alq":
                prognose = round(min(9.0, max(3.4, vor + (4.4 - vor) * 0.15 + rng.normal(0, 0.08))), 1)
                ist = round(prognose + rng.choice([-0.1, 0.0, 0.0, 0.1]), 1)
            else:
                ziel = 2.2 if iid.endswith("_j") else 0.2
                prognose = round(vor + (ziel - vor) * (0.08 if iid.endswith("_j") else 0.6) + rng.normal(0, 0.12 if iid.endswith("_j") else 0.06), 1)
                ist = round(prognose + rng.choice([-0.2, -0.1, -0.1, 0.0, 0.0, 0.0, 0.1, 0.1, 0.2]), 1)
            stand[iid] = ist
            reihen[iid].append([wirtschaft.minute_ny(tag, *ind["zeit"]), float(ist), float(prognose), float(vor), f"{bericht:%Y-%m}"])
    return [wirtschaft.beschreibung(iid) | {"quelle": "Demo-Daten", "prognose_quelle": "Demo-Daten", "termine": t}
            for iid, t in reihen.items() if t]


# Reaktion je Prozentpunkt CPI-Überraschung (j/j) bzw. je 100 000 Stellen NFP: Vorzeichen aus Sicht des Kurses
_REAKTION = {"EURUSD=X": -1.0, "GBPUSD=X": -0.9, "AUDUSD=X": -0.9, "USDJPY=X": 1.0, "EURJPY=X": 0.3, "EURCHF=X": 0.05,
             "GC=F": -1.2, "SI=F": -1.5, "BZ=F": -0.4, "HG=F": -0.5, "^GSPC": -1.1, "^NDX": -1.4, "^GDAXI": -0.8, "^STOXX50E": -0.8}
_SPREAD = {"forex": 0.00011, "rohstoff": 0.0004, "index": 0.00012}


def demo_oanda(symbol: str, typ: str, kurs_heute: float, trend: float, vola_tag: float, seed: int,
               ereignisse: list[dict], heute: dt.date, jahre: int = 11) -> dict:
    """Minutenpfad über elf Jahre → Tages-, Stunden- und Minutenkerzen im Format von oanda.hole."""
    from . import oanda
    rng = np.random.default_rng(seed + 31)
    tage = round(365.25 * jahre)
    start = int(dt.datetime.combine(heute - dt.timedelta(days=tage), dt.time(), dt.timezone.utc).timestamp() // 60) - 120
    n = tage * 1440
    t = start + np.arange(n)
    wt, mod = ((t // 1440) + 4) % 7, t % 1440
    handel = ~((wt == 6) | ((wt == 5) & (mod >= 1320)) | ((wt == 0) & (mod < 1320)))
    sigma = vola_tag / math.sqrt(1440 * 5 / 7)
    r = rng.normal(trend / (tage * 1440 * 5 / 7), sigma, n) * handel
    beta = _REAKTION.get(symbol, 0.0)
    termine_min = []
    for ind in ereignisse:
        if ind["id"] not in ("us_cpi_j", "us_nfp"):
            continue
        for e in ind["termine"]:
            i = e[0] - start
            termine_min.append(e[0])
            if not (0 <= i < n - 60) or e[2] is None:
                continue
            ueberraschung = (e[1] - e[2]) if ind["id"] == "us_cpi_j" else (e[1] - e[2]) / 100 * 0.25
            sprung = beta * ueberraschung * 0.03
            r[i] += sprung * 0.7
            r[i + 1:i + 31] += sprung * 0.3 / 30
            r[i:i + 60] += rng.normal(0, sigma * 3, 60)
    pfad = np.exp(np.cumsum(r))
    mitte = kurs_heute * pfad / pfad[-1]
    vor = np.concatenate([[mitte[0]], mitte[:-1]])
    hoch = np.maximum(vor, mitte) * (1 + np.abs(rng.normal(0, sigma * 0.35, n)))
    tief = np.minimum(vor, mitte) * (1 - np.abs(rng.normal(0, sigma * 0.35, n)))
    spread_rel = np.full(n, _SPREAD.get(typ, 0.0002))
    for tm in termine_min:
        i = tm - start
        if 0 <= i < n - 5:
            spread_rel[i:i + 5] *= 6
    dez = 3 if kurs_heute > 50 and typ == "forex" else (5 if kurs_heute < 50 else (2 if kurs_heute < 5000 else 1))

    def bloecke(groesse: int) -> list[list]:
        """Stunden und Tage (ab 22 Uhr UTC) sind hier immer ganz gehandelt oder ganz geschlossen: per reshape bündeln."""
        k = n // groesse
        form = lambda x: x[:k * groesse].reshape(k, groesse)  # noqa: E731
        offen = form(handel).all(axis=1)
        o, c = form(vor)[:, 0][offen], form(mitte)[:, -1][offen]
        h, lo = form(hoch).max(axis=1)[offen], form(tief).min(axis=1)[offen]
        sp = c * form(spread_rel).mean(axis=1)[offen]
        tt = form(t)[:, 0][offen]
        werte = np.column_stack([o - sp / 2, h - sp / 2, lo - sp / 2, c - sp / 2, o + sp / 2, h + sp / 2, lo + sp / 2, c + sp / 2]).round(dez)
        return [[int(a)] + b for a, b in zip(tt, werte.tolist())]

    def kerzen(groesse: int, nur_fenster=None):
        aus = []
        bloecke = range(0, n, groesse) if nur_fenster is None else nur_fenster
        for a in bloecke:
            b = a + groesse
            m = handel[a:b]
            if not m.any():
                continue
            idx = np.nonzero(m)[0] + a
            o, c = vor[idx[0]], mitte[idx[-1]]
            h, lo = hoch[idx].max(), tief[idx].min()
            sp = float(mitte[idx[-1]] * spread_rel[idx].mean())
            rnd = lambda x: round(float(x), dez)  # noqa: E731
            aus.append([int(t[a]), rnd(o - sp / 2), rnd(h - sp / 2), rnd(lo - sp / 2), rnd(c - sp / 2),
                        rnd(o + sp / 2), rnd(h + sp / 2), rnd(lo + sp / 2), rnd(c + sp / 2)])
        return aus

    minute = {}
    for tm in sorted(set(termine_min)):
        a, b = tm - start - oanda.FENSTER_VOR, oanda.fenster_ende(tm) - start
        if 0 <= a and b < n:
            minute[str(tm)] = kerzen(1, range(a, b))
    stunde_ab = n - round(365.25 * 10) * 1440
    stunde = [k for k in bloecke(60) if k[0] >= t[stunde_ab]]
    return {"instrument": oanda.instrument(symbol), "dez": dez, "tag": bloecke(1440), "stunde": stunde, "minute": minute,
            "quelle": "Demo (Format wie OANDA, Geld- und Briefkurse)"}


def mit_intraday(rohdaten: list[dict], ereignisse: list[dict], heute: dt.date) -> None:
    """Demo: Forex, Rohstoffe und Indizes bekommen Minuten-, Stunden- und Tageskerzen wie von OANDA."""
    from . import backtest, datenpruefung, oanda
    for i, r in enumerate(rohdaten):
        if r["typ"] not in ("forex", "rohstoff", "index") or not oanda.instrument(r["symbol"]):
            if r.get("kurse") is not None:
                k = r["kurse"]
                zweit = k * (1 + np.random.default_rng(i).normal(0, 0.0004, len(k)))
                r["pruefung"] = datenpruefung.pruefe(k, zweit, "Demo", "Demo-Vergleichsquelle")
            continue
        kurs, trend, vola, _ = _MAERKTE.get(r["symbol"], (100.0, 0.1, 0.01, "USD"))
        o = demo_oanda(r["symbol"], r["typ"], kurs, trend, vola, i + 7, ereignisse, heute)
        r["oanda"] = o
        tag = backtest.oanda_tage(o)
        tag.index = pd.DatetimeIndex(tag.index)
        yahoo = r["kurse"]
        r["kurse"] = tag["Close"].rename(None)
        r["ohlc"] = tag[["Open", "High", "Low", "Close"]]
        r["pruefung"] = datenpruefung.pruefe(r["kurse"], r["kurse"] * (1 + np.random.default_rng(i).normal(0, 0.0006, len(tag))),
                                            o["quelle"], "Demo-Vergleichsquelle")
        del yahoo
