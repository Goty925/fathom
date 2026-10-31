"""Schnellprüfung einer gebauten Website (Smoke-Test), ohne Browser und ohne Netz.

  python tools/website_pruefen.py site_staging --staging
  python tools/website_pruefen.py site

Prüft: index.html vorhanden und vollständig gerendert, alle eingebundenen Skripte und Stylesheets vorhanden,
alle JSON-Dateien lesbar, keine Secret-Werte aus der Umgebung in irgendeiner Datei, CSP gesetzt.
Mit --staging zusätzlich: noindex, robots.txt sperrt alles, Hinweisband sichtbar.
Rückgabe 0 = alles in Ordnung, 1 = Fehler (die Liste steht in der Ausgabe).
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from src.umgebung import GEHEIM

TEXT = {".html", ".js", ".css", ".json", ".txt", ".xml", ".csv"}


def pruefe(ordner: Path, staging: bool) -> list[str]:
    fehler: list[str] = []
    index = ordner / "index.html"
    if not index.is_file():
        return [f"{index} fehlt"]
    html = index.read_text(encoding="utf-8")
    if len(html) < 10_000:
        fehler.append(f"index.html ist verdächtig klein ({len(html)} Zeichen)")
    if re.search(r"\{\{|\{%|\{#", html):
        fehler.append("index.html enthält nicht gerenderte Jinja-Platzhalter")
    if 'http-equiv="Content-Security-Policy"' not in html:
        fehler.append("Content-Security-Policy fehlt")
    for ref in re.findall(r'<(?:script|link)[^>]+(?:src|href)="([^"]+)"', html):
        if ref.startswith(("http:", "https:", "data:", "#", "//")):
            continue
        if not (ordner / ref.split("?")[0]).is_file():
            fehler.append(f"eingebunden, aber nicht vorhanden: {ref}")
    for datei in sorted((ordner / "daten").rglob("*.json")) if (ordner / "daten").is_dir() else []:
        try:
            json.loads(datei.read_text(encoding="utf-8"))
        except (ValueError, UnicodeDecodeError) as exc:
            fehler.append(f"{datei.relative_to(ordner)}: kein gültiges JSON ({exc.__class__.__name__})")
    werte = {v: os.environ[v] for v in GEHEIM if len(os.environ.get(v) or "") >= 6}
    if werte:
        for datei in ordner.rglob("*"):
            if datei.is_file() and datei.suffix in TEXT:
                inhalt = datei.read_text(encoding="utf-8", errors="ignore")
                for var, wert in werte.items():
                    if wert in inhalt:  # nur den Namen nennen, nie den Wert
                        fehler.append(f"Wert von {var} steht in {datei.relative_to(ordner)}")
    noindex = '<meta name="robots" content="noindex' in html
    if staging:
        if not noindex:
            fehler.append("Staging ohne noindex")
        robots = ordner / "robots.txt"
        if not robots.is_file() or "Disallow: /" not in robots.read_text(encoding="utf-8"):
            fehler.append("Staging ohne robots.txt mit Disallow: /")
        if 'class="staging-band"' not in html:
            fehler.append("Staging ohne Hinweisband")
        if "<title>[Staging]" not in html:
            fehler.append("Staging ohne [Staging] im Seitentitel")
    elif noindex or 'class="staging-band"' in html:
        fehler.append("Production-Website trägt Staging-Merkmale (noindex oder Hinweisband)")
    return fehler


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("ordner", type=Path)
    p.add_argument("--staging", action="store_true")
    a = p.parse_args(argv)
    fehler = pruefe(a.ordner, a.staging)
    for f in fehler:
        print("FEHLER", f)
    print("Website-Prüfung:", "in Ordnung" if not fehler else f"{len(fehler)} Fehler")
    return 1 if fehler else 0


if __name__ == "__main__":
    sys.exit(main())
