"""Jede Woche einen Schnappschuss in data/historie.csv speichern.

So entsteht über die Zeit dein eigener Datensatz (gut für spätere
Auswertungen im Studium) und der Bericht kann "ggü. letzter Woche" zeigen.
"""
from __future__ import annotations

import datetime as dt
from pathlib import Path

import pandas as pd

SPALTEN = [
    "datum", "symbol", "kurs", "waehrung", "forward_kgv", "kursziel_abstand",
    "abstand_hoch", "position_spanne", "umsatzwachstum", "gewinnwachstum", "punkte",
]


def lade_letzten_stand(pfad: Path, heute: dt.date) -> dict[str, dict]:
    """Letzter Eintrag je Symbol VOR heute."""
    if not pfad.exists():
        return {}
    df = pd.read_csv(pfad, parse_dates=["datum"])
    df = df[df["datum"].dt.date < heute]
    if df.empty:
        return {}
    letzte = df.sort_values("datum").groupby("symbol").tail(1)
    return {row["symbol"]: row.to_dict() for _, row in letzte.iterrows()}


def speichere(pfad: Path, zeilen: list[dict], heute: dt.date) -> None:
    neu = pd.DataFrame([{s: z.get(s) for s in SPALTEN} | {"datum": heute.isoformat()} for z in zeilen])
    if pfad.exists():
        alt = pd.read_csv(pfad, dtype={"datum": str})
        alt = alt[alt["datum"] != heute.isoformat()]  # Doppellauf am selben Tag ersetzen
        neu = pd.concat([alt, neu], ignore_index=True)
    pfad.parent.mkdir(parents=True, exist_ok=True)
    neu[SPALTEN].to_csv(pfad, index=False)
