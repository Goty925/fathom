"""Gemeinsame Hilfe für Abrufe aus dem Netz: Antworten nur bis zu einer festen Größe lesen.

Eine fehlerhafte oder manipulierte Quelle könnte sonst beliebig viele Daten schicken und den Lauf mit
Speichermangel abbrechen. 20 MB liegen weit über jeder echten Antwort der genutzten Dienste.
"""
from __future__ import annotations

MAX_ANTWORT = 20 * 1024 * 1024


class AntwortZuGross(ValueError):
    pass


def lies(r, grenze: int = MAX_ANTWORT) -> bytes:
    roh = r.read(grenze + 1)
    if len(roh) > grenze:
        raise AntwortZuGross(f"Antwort größer als {grenze // (1024 * 1024)} MB, verworfen")
    return roh
