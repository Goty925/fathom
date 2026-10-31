"""Signal-Protokoll: welche Signale seit der Vorwoche gekippt sind, mit den Zahlen dahinter.

Vergleichsbasis, in dieser Reihenfolge:
  1. Der gespeicherte Stand aus data/signale.json (jede Woche ein Eintrag, landet über GitHub Actions im Repository).
  2. Gibt es den noch nicht (erster Lauf, Demo): dieselben Regeln, neu gerechnet mit den Kursen von vor fünf
     Handelstagen. Quartalszahlen, Analystenschätzungen und Kursziele sind dann die von heute.
"""
from __future__ import annotations

import datetime as dt
import json
from pathlib import Path

import pandas as pd

from . import kennzahlen

REIHENFOLGE = {"aktie": 0, "forex": 1, "rohstoff": 2, "index": 3}


def aufnahme(zeilen: list[dict], schluessel: str = "bewertung") -> dict:
    """Signale aller Werte als kleiner Schnappschuss {Symbol: {name, typ, punkte, signale}}."""
    aus = {}
    for z in zeilen:
        b = z.get(schluessel) or {}
        pr = b.get("pruefungen")
        if not pr:
            continue
        aus[z["symbol"]] = {
            "name": z["name"], "typ": z["typ"], "punkte": b["punkte"], "treffer": bool(b.get("treffer")),
            "signale": {n: {"e": p.get("erfuellt"), "s": None if p.get("staerke") is None else round(p["staerke"], 1),
                            "t": p.get("begruendung")} for n, p in pr.items()},
        }
    return aus


def zeile_vor(z: dict, kurse: pd.Series, tage: int = 5) -> dict | None:
    """Dieselbe Zeile mit den Kursen von vor `tage` Handelstagen (Fundamentaldaten wie heute)."""
    k = kurse.dropna()
    if len(k) <= tage + 21 or not z.get("kurs"):
        return None
    k = k.iloc[:-tage]
    jahr = k.iloc[-kennzahlen.HANDELSTAGE_JAHR:]
    kurs, hoch, tief = float(k.iloc[-1]), float(jahr.max()), float(jahr.min())
    verhaeltnis = kurs / z["kurs"]
    alt = dict(z) | kennzahlen.faktoren(k)
    alt.update({
        "kurs": kurs,
        "abstand_hoch": 1 - kurs / hoch if hoch else None,
        "position_spanne": (kurs - tief) / (hoch - tief) if hoch > tief else None,
        "gd200": float(k.iloc[-200:].mean()) if len(k) >= 200 else None,
        "datum_stand": k.index[-1].date(),
    })
    alt["abstand_gd200"] = kurs / alt["gd200"] - 1 if alt["gd200"] else None
    alt["rendite_3m"] = kennzahlen.rendite(k, 63)
    alt["kurs_3m"] = float(k.iloc[-64]) if len(k) > 63 else None
    r = jahr.pct_change().dropna()
    alt["volatilitaet"] = float(r.std() * (kennzahlen.HANDELSTAGE_JAHR ** 0.5)) if len(r) > 20 else None
    alt.update(kennzahlen.saisonalitaet(k))
    if z.get("boersenwert_eur"):
        alt["boersenwert_eur"] = z["boersenwert_eur"] * verhaeltnis
    if z.get("forward_kgv"):
        alt["forward_kgv"] = z["forward_kgv"] * verhaeltnis
    if z.get("kursziel_mittel"):
        alt["kursziel_abstand"] = z["kursziel_mittel"] / kurs - 1
    return alt


def lade_vorwoche(pfad: Path, heute: dt.date, min_tage: int = 4, max_tage: int = 13) -> tuple[dt.date, dict] | None:
    """Jüngster gespeicherter Stand, der vier bis 13 Tage alt ist."""
    if not pfad.exists():
        return None
    try:
        daten = json.loads(pfad.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    passend = [d for d in daten if min_tage <= (heute - dt.date.fromisoformat(d)).days <= max_tage]
    if not passend:
        return None
    d = max(passend)
    return dt.date.fromisoformat(d), daten[d]


def speichere(pfad: Path, heute: dt.date, auf: dict, behalten: int = 60) -> None:
    daten = {}
    if pfad.exists():
        try:
            daten = json.loads(pfad.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            daten = {}
    daten[heute.isoformat()] = auf
    for d in sorted(daten)[:-behalten]:
        del daten[d]
    pfad.parent.mkdir(parents=True, exist_ok=True)
    pfad.write_text(json.dumps(daten, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def vergleiche(jetzt: dict, vorher: dict, datum_vorher: dt.date | None, quelle: str) -> dict:
    """Gewonnene und verlorene Signale je Wert, wichtigste zuerst (Wechsel über die Drei-Signale-Marke)."""
    eintraege = []
    for sym, n in jetzt.items():
        a = vorher.get(sym)
        if not a:
            continue
        alt = a.get("signale") or {}
        gewonnen = [{"signal": s, "text": x.get("t")} for s, x in n["signale"].items()
                    if x.get("e") is True and (alt.get(s) or {}).get("e") is False]
        verloren = [{"signal": s, "text": x.get("t")} for s, x in n["signale"].items()
                    if x.get("e") is False and (alt.get(s) or {}).get("e") is True]
        if not gewonnen and not verloren:
            continue
        pv, pn = a.get("punkte", 0), n["punkte"]
        tv = a.get("treffer", pv >= 3) if "treffer" in a else pv >= 3
        tn = n.get("treffer", pn >= 3)
        eintraege.append({
            "symbol": sym, "name": n["name"], "typ": n["typ"], "punkte_vorher": pv, "punkte": pn, "max": len(n["signale"]),
            "gewonnen": gewonnen, "verloren": verloren,
            "schwelle": "rein" if tn and not tv else "raus" if tv and not tn else None,
        })
    eintraege.sort(key=lambda e: (e["schwelle"] is None, -abs(e["punkte"] - e["punkte_vorher"]),
                                  REIHENFOLGE.get(e["typ"], 9), e["name"]))
    return {
        "datum_vorher": datum_vorher, "quelle": quelle, "eintraege": eintraege,
        "gewonnen": sum(len(e["gewonnen"]) for e in eintraege),
        "verloren": sum(len(e["verloren"]) for e in eintraege),
        "neu": [n["name"] for s, n in jetzt.items() if s not in vorher],
    }
