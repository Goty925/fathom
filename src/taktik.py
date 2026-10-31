"""Chart-Taktik mit KI deuten: Beschreibung in Worten plus gezeichnete Linien/Zonen → Regeln für den Backtest.

Nur über den lokalen Server (python live.py) und nur, wenn die Umgebungsvariable ANTHROPIC_API_KEY gesetzt ist.
Ohne Schlüssel deutet die Website die Beschreibung selbst (assets/taktik-kern.js, feste Sprachmuster).
Die Antwort der KI wird im Browser noch einmal geprüft (WBTaktik.pruefe): nur bekannte Bedingungen und Zeichnungen.
Das Modell lässt sich mit FATHOM_KI_MODELL wählen.
"""
from __future__ import annotations

import json
import os
import re
import urllib.request

API = "https://api.anthropic.com/v1/messages"
MODELL = "claude-sonnet-5-5"
ARTEN = ("linie", "strahl", "trend", "senkrecht", "zone", "kanal", "fib", "position")

SYSTEM = """Du übersetzt eine Trading-Taktik, die ein Mensch in einen Kerzenchart gezeichnet und in Worten beschrieben hat,
in streng formatierte Regeln für einen Backtest. Antworte ausschließlich mit einem JSON-Objekt, ohne Erklärtext.

Zeichnungen (ids mit Buchstabe je Art): L = "linie" (waagerechte Linie, p), S = "strahl" (waagerechter Strahl ab Zeit t),
T = "trend" (Trendlinie a→b), V = "senkrecht" (senkrechte Linie, Stichtag t), Z = "zone" (Rechteck oben/unten),
K = "kanal" (paralleler Kanal: Linie a→b und Parallele im Abstand d), F = "fib" (Fibonacci-Retracement a→b, 0 % bei b,
100 % bei a), P = "position" (Long- oder Short-Position mit ein, stop, ziel).

Schema:
{
  "regeln": {
    "richtung": "long" | "short",
    "einstieg": [[Bedingung, ...], ...],      // innere Liste: alle müssen gelten (UND); äußere: eine reicht (ODER)
    "filter": [Bedingung, ...],               // Zustände, die zusätzlich gelten müssen
    "stop": Ausstieg | null,
    "ziel": Ausstieg | null,
    "ausstieg": [Bedingung, ...],             // Ausstieg zum Schlusskurs, wenn eine gilt
    "halten": Zahl | null,                    // höchstens so viele Kerzen halten
    "zeitpunkt": "eroeffnung" | "schluss"     // Einstieg zur Eröffnung der nächsten Kerze oder zum Schluss der Signalkerze
  },
  "unklar": ["Satzteile, die du nicht abbilden konntest"]
}
Bedingung an einer Zeichnung:
  {"typ": "kreuzt_ueber"|"kreuzt_unter"|"ueber"|"unter"|"verlaesst_oben"|"verlaesst_unten", "ref": "L1"}
| {"typ": "beruehrt"|"in_zone", "ref": "Z1", "von": "oben"|"unten"|null}
  Zusätzlich möglich: "kante": "oben"|"unten"|"mitte" (eine Kante von Zone/Kanal/Fib wie eine Linie),
  bei Fib "stufe": 0.618 (ein Level) und optional "stufe2": 0.65 (Bereich zwischen zwei Leveln).
| {"typ": "nach"|"vor", "ref": "V1"}                                    // nur Kerzen ab bzw. vor der senkrechten Linie
Bedingung an einem Indikator (op: "ueber"|"unter"|"kreuzt_ueber"|"kreuzt_unter", bei ma und bb auch "beruehrt"):
  {"typ": "ma", "ma": "sma"|"ema", "n": 20, "op": ...}                  // Schlusskurs gegen gleitenden Durchschnitt
| {"typ": "ma_kreuz", "a": {"ma": "ema", "n": 20}, "b": {"ma": "ema", "n": 50}, "op": ...}
| {"typ": "rsi", "n": 14, "op": ..., "wert": 30}
| {"typ": "macd", "schnell": 12, "langsam": 26, "signal": 9, "gegen": "signal"|"null", "op": ...}
| {"typ": "bb", "n": 20, "k": 2, "band": "oben"|"unten"|"mitte", "op": ...}
Ausstieg: {"art": "objekt", "ref": "Z1", "seite": "oben"|"unten"|null, "puffer": 0.005, "stufe": 0.786}   // puffer als Anteil; stufe nur bei Fib
        | {"art": "prozent", "wert": 0.02}   // 2 % vom Einstieg
        | {"art": "r", "wert": 2}            // Vielfaches des Risikos bis zum Stop
        | {"art": "kerze"}                   // Stop am Tief (long) bzw. Hoch (short) der Signalkerze
        | {"art": "atr", "wert": 2, "n": 14} // Vielfaches der ATR an der Signalkerze
        | {"art": "position", "ref": "P1"}   // Abstand wie in der gezeichneten Position
Verwende nur ids, die es gibt. Schreibe nichts in die Regeln, was nicht in der Beschreibung steht.
"""


def verfuegbar() -> bool:
    return bool(os.environ.get("ANTHROPIC_API_KEY"))


def _json_aus(text: str) -> dict:
    """Erstes JSON-Objekt aus der Antwort (auch wenn es in ```json … ``` steht)."""
    m = re.search(r"\{.*\}", text or "", re.S)
    if not m:
        raise ValueError("Antwort ohne JSON")
    d = json.loads(m.group(0))
    if not isinstance(d, dict) or not isinstance(d.get("regeln"), dict):
        raise ValueError("Antwort ohne Regeln")
    return d


def anfrage(text: str, zeichnungen: list[dict]) -> dict:
    """Nachricht an die Messages-API, so klein wie möglich (nur Text und Zeichnungen, keine Kursdaten)."""
    knapp = []
    for z in zeichnungen[:40]:
        if not isinstance(z, dict) or z.get("art") not in ARTEN:
            continue
        eintrag = {"id": str(z.get("id", ""))[:4], "art": z["art"], "name": str(z.get("name") or "")[:30]}
        for k in ("p", "t", "d", "oben", "unten", "ein", "stop", "ziel"):
            if isinstance(z.get(k), (int, float)) and not isinstance(z.get(k), bool):
                eintrag[k] = z[k]
        for k in ("a", "b"):  # Punkte als {t, p}, nur Zahlen
            punkt = z.get(k)
            if isinstance(punkt, dict) and all(isinstance(punkt.get(x), (int, float)) and not isinstance(punkt.get(x), bool) for x in ("t", "p")):
                eintrag[k] = {"t": punkt["t"], "p": punkt["p"]}
        knapp.append(eintrag)
    inhalt = f"Zeichnungen:\n{json.dumps(knapp, ensure_ascii=False)}\n\nBeschreibung der Taktik:\n{text[:4000]}"
    return {"model": os.environ.get("FATHOM_KI_MODELL") or MODELL, "max_tokens": 1500, "system": SYSTEM,
            "messages": [{"role": "user", "content": inhalt}]}


def deute(text: str, zeichnungen: list[dict], laden=None) -> dict:
    """Ruft die KI und gibt {"regeln": …, "unklar": […]} zurück. `laden` ist für Tests austauschbar."""
    schluessel = os.environ.get("ANTHROPIC_API_KEY")
    if not schluessel:
        raise RuntimeError("ANTHROPIC_API_KEY ist nicht gesetzt")
    nutzlast = json.dumps(anfrage(text, zeichnungen)).encode("utf-8")
    if laden is None:
        def laden(roh: bytes) -> dict:
            req = urllib.request.Request(API, data=roh, method="POST", headers={
                "x-api-key": schluessel, "anthropic-version": "2023-06-01", "content-type": "application/json"})
            with urllib.request.urlopen(req, timeout=60) as r:  # noqa: S310 – feste https-Adresse
                return json.loads(r.read(2 * 1024 * 1024))
    antwort = laden(nutzlast)
    teile = [b.get("text", "") for b in (antwort or {}).get("content", []) if isinstance(b, dict) and b.get("type") == "text"]
    d = _json_aus("".join(teile))
    unklar = [str(x)[:200] for x in d.get("unklar") or [] if isinstance(x, (str, int, float))][:5]
    return {"regeln": d["regeln"], "unklar": unklar}
