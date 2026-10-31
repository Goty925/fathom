"""Signale für Währungen (Forex), Rohstoffe sowie Indizes und Index-Futures.

Gleiche Prinzipien wie bei den Aktien (src/screening.py): vier Signale je Anlageklasse,
jedes mit erfüllt ja/nein, Stärke 0–100 (ab 50 erfüllt) und einer Begründung.

Die Auswahl folgt den Faktoren, mit denen große Häuser (J.P. Morgan, AQR, Blackstone-Multi-Asset)
diese Märkte systematisch bewerten:

  Forex      Carry (Zinsdifferenz), Momentum, Value (Abweichung vom 5-Jahres-Mittel), Vol-Regime
  Rohstoffe  Momentum, Pullback, Value (5-Jahres-Mittel), Vol-Regime
  Indizes    Trend (200-Tage-Linie), Momentum, Pullback, Vol-Regime

Grenzwerte stehen in config.yaml unter kriterien_forex, kriterien_rohstoff und kriterien_index.
"""
from __future__ import annotations

from .screening import _de, _pct, _und, skala

KLASSEN = {
    "aktie": {"titel": "Aktien", "einzahl": "Aktie"},
    "etf": {"titel": "ETFs", "einzahl": "ETF"},
    "forex": {"titel": "Forex", "einzahl": "Währungspaar"},
    "rohstoff": {"titel": "Rohstoffe", "einzahl": "Rohstoff"},
    "index": {"titel": "Indizes & Futures", "einzahl": "Index"},
}

# Standard-Grenzwerte, falls config.yaml einen Abschnitt nicht enthält
STANDARD = {
    "kriterien_forex": {"min_zinsdifferenz": 0.01, "min_momentum": 0.0, "min_abweichung_mittel": 0.05,
                        "max_vol_verhaeltnis": 1.0},
    "kriterien_rohstoff": {"min_momentum": 0.0, "min_abstand_hoch": 0.10, "max_position_spanne": 0.50,
                           "max_abweichung_mittel": 0.0, "max_vol_verhaeltnis": 1.0},
    "kriterien_index": {"min_abstand_gd200": 0.0, "min_momentum": 0.0, "min_abstand_hoch": 0.05,
                        "max_vol_verhaeltnis": 1.0},
}


def mit_standard(cfg: dict) -> dict:
    """config.yaml um fehlende Abschnitte ergänzen (ältere Konfigurationen bleiben gültig)."""
    cfg = dict(cfg)
    for k, v in STANDARD.items():
        cfg[k] = v | (cfg.get(k) or {})
    return cfg


# Kurzname für die Tabelle und Erklärung je Signal
SIGNALE = {
    "forex": {
        "Carry": {"kurz": "Carry", "erklaerung": "Zinsdifferenz der beiden Notenbanken"},
        "Momentum": {"kurz": "Momentum", "erklaerung": "Kursentwicklung 12 Monate ohne den letzten Monat"},
        "Value": {"kurz": "Value", "erklaerung": "Abstand zum 5-Jahres-Mittel"},
        "Vol-Regime": {"kurz": "Vol-Regime", "erklaerung": "Schwankung jetzt im Vergleich zum Jahr"},
    },
    "rohstoff": {
        "Momentum": {"kurz": "Momentum", "erklaerung": "Kursentwicklung 12 Monate ohne den letzten Monat"},
        "Pullback": {"kurz": "Pullback", "erklaerung": "Drawdown vom 52W-Hoch und Lage in der Range"},
        "Value": {"kurz": "Value", "erklaerung": "Abstand zum 5-Jahres-Mittel"},
        "Vol-Regime": {"kurz": "Vol-Regime", "erklaerung": "Schwankung jetzt im Vergleich zum Jahr"},
    },
    "index": {
        "Trend": {"kurz": "Trend", "erklaerung": "Abstand zur 200-Tage-Linie"},
        "Momentum": {"kurz": "Momentum", "erklaerung": "Kursentwicklung 12 Monate ohne den letzten Monat"},
        "Pullback": {"kurz": "Pullback", "erklaerung": "Korrektur vom 52W-Hoch"},
        "Vol-Regime": {"kurz": "Vol-Regime", "erklaerung": "Schwankung jetzt im Vergleich zum Jahr"},
    },
}

# Währung → Länderkürzel der BIS-Statistik zu Leitzinsen (siehe fetch.hole_leitzinsen)
BIS_GEBIET = {"EUR": "XM", "USD": "US", "GBP": "GB", "JPY": "JP", "CHF": "CH", "AUD": "AU", "CAD": "CA",
              "NZD": "NZ", "SEK": "SE", "NOK": "NO", "DKK": "DK", "CNY": "CN", "HKD": "HK", "SGD": "SG",
              "KRW": "KR", "INR": "IN", "BRL": "BR", "MXN": "MX", "ZAR": "ZA", "TRY": "TR", "PLN": "PL",
              "CZK": "CZ", "HUF": "HU"}


def paar(symbol: str) -> tuple[str, str] | None:
    """Yahoo-Kürzel → (Basiswährung, Kurswährung): "EURUSD=X" → ("EUR", "USD"), "JPY=X" → ("USD", "JPY")."""
    s = symbol.upper().removesuffix("=X")
    if len(s) == 6 and s.isalpha():
        return s[:3], s[3:]
    if len(s) == 3 and s.isalpha():
        return "USD", s
    return None


def zinsdifferenz(symbol: str, zinsen: dict) -> tuple[float | None, str]:
    """Leitzins der Basiswährung minus Leitzins der Kurswährung (0.01 = 1 Prozentpunkt)."""
    p = paar(symbol)
    if not p:
        return None, ""
    a, b = zinsen.get(p[0]), zinsen.get(p[1])
    if a is None or b is None:
        return None, f"Leitzins für {p[0] if a is None else p[1]} fehlt"
    return a - b, f"{p[0]} {_de(a * 100, 2)} % gegenüber {p[1]} {_de(b * 100, 2)} %"


def _pp(x: float) -> str:
    return f"{x * 100:+.2f}".replace("-", "−").replace(".", ",") + " Pp."


def _momentum(z, g):
    m = z.get("momentum_12_1")
    if m is None:
        return {"erfuellt": None, "staerke": None, "begruendung": "Kurshistorie unter 12 Monaten"}
    return {"erfuellt": m >= g, "staerke": skala(m, g - 0.15, g, g + 0.25),
            "begruendung": f"12-1-Monats-Rendite {_pct(m)}"}


def _vol(z, g):
    v = z.get("vol_verhaeltnis")
    if v is None:
        return {"erfuellt": None, "staerke": None, "begruendung": "Kurshistorie unter 12 Monaten"}
    return {"erfuellt": v <= g, "staerke": skala(v, g + 0.5, g, g - 0.4),
            "begruendung": f"Vola 1M {_de(z['vol_1m'] * 100, 1)} % gegenüber Median 1J {_de(z['vol_median_1j'] * 100, 1)} %"}


def _pullback(z, ga, gp):
    a, pos = z.get("abstand_hoch"), z.get("position_spanne")
    if a is None:
        return {"erfuellt": None, "staerke": None, "begruendung": "Kursdaten fehlen"}
    if gp is None:  # Indizes: nur der Abstand zum Hoch
        return {"erfuellt": a >= ga, "staerke": skala(a, 0.0, ga, ga + 0.15),
                "begruendung": f"Drawdown {a * 100:.0f} % vom 52W-Hoch"}
    return {"erfuellt": a >= ga and pos is not None and pos <= gp,
            "staerke": _und(skala(a, ga - 0.15, ga, ga + 0.25), skala(pos, 1.0, gp, 0.0)),
            "begruendung": f"Drawdown {a * 100:.0f} % vom 52W-Hoch, Range-Position {(pos or 0) * 100:.0f} %"}


def bewerte(z: dict, typ: str, k: dict, zinsen: dict | None = None) -> dict:
    """Vier Signale für einen Wert der Klasse `typ` (forex, rohstoff, index)."""
    zinsen = zinsen or {}
    pr = {}
    if typ == "forex":
        diff, text = zinsdifferenz(z["symbol"], zinsen)
        g = k["min_zinsdifferenz"]
        pr["Carry"] = ({"erfuellt": None, "staerke": None, "begruendung": text or "Kein Währungspaar"} if diff is None else
                       {"erfuellt": diff >= g, "staerke": skala(diff, g - 0.02, g, g + 0.03),
                        "begruendung": f"Zinsdifferenz {_pp(diff)} p. a. ({text})"})
        pr["Momentum"] = _momentum(z, k["min_momentum"])
        abw, g = z.get("abweichung_mittel_5j"), k["min_abweichung_mittel"]
        pr["Value"] = ({"erfuellt": None, "staerke": None, "begruendung": "Kurshistorie zu kurz"} if abw is None else
                       {"erfuellt": abw <= -g, "staerke": skala(abw, -g + 0.10, -g, -g - 0.15),
                        "begruendung": f"{_pct(abw)} gegenüber dem 5-Jahres-Mittel"})
        pr["Vol-Regime"] = _vol(z, k["max_vol_verhaeltnis"])
    elif typ == "rohstoff":
        pr["Momentum"] = _momentum(z, k["min_momentum"])
        pr["Pullback"] = _pullback(z, k["min_abstand_hoch"], k["max_position_spanne"])
        abw, g = z.get("abweichung_mittel_5j"), k["max_abweichung_mittel"]
        pr["Value"] = ({"erfuellt": None, "staerke": None, "begruendung": "Kurshistorie zu kurz"} if abw is None else
                       {"erfuellt": abw <= g, "staerke": skala(abw, g + 0.25, g, g - 0.25),
                        "begruendung": f"{_pct(abw)} gegenüber dem 5-Jahres-Mittel"})
        pr["Vol-Regime"] = _vol(z, k["max_vol_verhaeltnis"])
    elif typ == "index":
        a, g = z.get("abstand_gd200"), k["min_abstand_gd200"]
        pr["Trend"] = ({"erfuellt": None, "staerke": None, "begruendung": "Weniger als 200 Handelstage"} if a is None else
                       {"erfuellt": a >= g, "staerke": skala(a, g - 0.08, g, g + 0.08),
                        "begruendung": f"{_pct(a)} gegenüber der 200-Tage-Linie"})
        pr["Momentum"] = _momentum(z, k["min_momentum"])
        pr["Pullback"] = _pullback(z, k["min_abstand_hoch"], None)
        pr["Vol-Regime"] = _vol(z, k["max_vol_verhaeltnis"])
    else:
        raise ValueError(typ)
    for name, p in pr.items():
        p.update(SIGNALE[typ][name])
    return {"pruefungen": pr, "punkte": sum(1 for p in pr.values() if p["erfuellt"]), "max_punkte": len(pr)}


def definitionen(cfg: dict) -> dict:
    """Halbsatz-Definition je Signal und Klasse, mit den Grenzwerten aus config.yaml."""
    p = lambda x: f"{abs(x) * 100:.0f} %"  # noqa: E731
    f, r, i = cfg["kriterien_forex"], cfg["kriterien_rohstoff"], cfg["kriterien_index"]
    vol = lambda g: ("Schwankung des letzten Monats liegt unter ihrem Jahres-Median, der Markt ist ruhiger als üblich"  # noqa: E731
                     if g == 1 else f"Schwankung des letzten Monats höchstens {g:.1f}-mal ihr Jahres-Median".replace(".", ","))
    mom = lambda g: ("Kurs ist über 12 Monate, ohne den jüngsten Monat, gestiegen" if g == 0 else  # noqa: E731
                     f"Kurs ist über 12 Monate, ohne den jüngsten Monat, um mindestens {p(g)} gestiegen")
    return {
        "forex": {
            "Carry": f"Leitzins der Basiswährung liegt mindestens {f['min_zinsdifferenz'] * 100:.1f} Prozentpunkte über dem der Gegenwährung, wer sie hält, verdient den Zinsvorsprung".replace(".", ",", 1),
            "Momentum": mom(f["min_momentum"]),
            "Value": f"Kurs mindestens {p(f['min_abweichung_mittel'])} unter seinem 5-Jahres-Mittel, die Basiswährung ist historisch günstig",
            "Vol-Regime": vol(f["max_vol_verhaeltnis"]),
        },
        "rohstoff": {
            "Momentum": mom(r["min_momentum"]),
            "Pullback": f"Kurs mindestens {p(r['min_abstand_hoch'])} unter dem 52-Wochen-Hoch und im unteren {p(r['max_position_spanne'])} der Jahresspanne",
            "Value": ("Kurs liegt unter seinem 5-Jahres-Mittel" if r["max_abweichung_mittel"] == 0 else
                      f"Kurs höchstens {p(r['max_abweichung_mittel'])} über seinem 5-Jahres-Mittel"),
            "Vol-Regime": vol(r["max_vol_verhaeltnis"]),
        },
        "index": {
            "Trend": ("Index notiert über seiner 200-Tage-Linie, der langfristige Aufwärtstrend ist intakt" if i["min_abstand_gd200"] == 0 else
                      f"Index notiert mindestens {p(i['min_abstand_gd200'])} über seiner 200-Tage-Linie"),
            "Momentum": mom(i["min_momentum"]),
            "Pullback": f"Index mindestens {p(i['min_abstand_hoch'])} unter seinem 52-Wochen-Hoch, also in einer Korrektur",
            "Vol-Regime": vol(i["max_vol_verhaeltnis"]),
        },
    }
