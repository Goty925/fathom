"""Umgebung (production, staging, development) und Schutz von Secrets in Logs.

FATHOM_UMGEBUNG legt fest, was ein Lauf darf:

  production   Montagslauf auf dem Standard-Branch: E-Mail, Historie in data/, öffentliche Website.
  staging      Probelauf vor einer Veröffentlichung: KEINE E-Mail, KEINE Schreibzugriffe auf data/,
               Website mit noindex und Hinweisband. Gedacht für Beispieldaten oder eigene Staging-Schlüssel.
  development  eigener Rechner (Standard ohne Angabe): verhält sich wie bisher.

Ein unbekannter Wert bricht den Lauf ab, statt still wie Production zu laufen.
"""
from __future__ import annotations

import logging
import os
import re

UMGEBUNGEN = ("production", "staging", "development")

# Alle Variablen, deren Werte nie im Log erscheinen dürfen (Werte unter 6 Zeichen werden nicht geschwärzt,
# damit z. B. ein Port „465“ nicht jede Zahl im Log verdeckt).
GEHEIM = (
    "EULERPOOL_API_KEY", "FINNHUB_API_KEY", "OANDA_API_TOKEN", "FRED_API_KEY", "TRADINGECONOMICS_API_KEY",
    "FMP_API_KEY", "BLS_API_KEY", "ANTHROPIC_API_KEY", "SMTP_USER", "SMTP_PASSWORT", "MAIL_AN", "SEC_KONTAKT",
    "GH_TOKEN", "GITHUB_TOKEN", "STAGING_DEPLOY_TOKEN",
)
# Schlüssel in Adressen (FRED api_key=, FMP apikey=, Trading Economics c=, token=) auch dann schwärzen,
# wenn der Wert nicht aus einer der Variablen oben stammt.
_URL_SCHLUESSEL = re.compile(r"(?i)([?&](?:api_?key|apikey|token|c|key)=)[^&\s\"']+")


class UmgebungFehler(ValueError):
    pass


def name() -> str:
    wert = (os.environ.get("FATHOM_UMGEBUNG") or "development").strip().lower()
    if wert not in UMGEBUNGEN:
        raise UmgebungFehler(f"FATHOM_UMGEBUNG={wert!r} ist unbekannt (erlaubt: {', '.join(UMGEBUNGEN)})")
    return wert


def ist_staging() -> bool:
    return name() == "staging"


def mail_erlaubt() -> bool:
    return not ist_staging()


def daten_schreiben_erlaubt() -> bool:
    """Historie und Signal-Protokoll in data/ fortschreiben (Production und eigener Rechner)."""
    return not ist_staging()


def schwaerzen(text: str) -> str:
    for var in GEHEIM:
        wert = os.environ.get(var) or ""
        if len(wert) >= 6:
            text = text.replace(wert, "***")
    return _URL_SCHLUESSEL.sub(r"\1***", text)


class SecretFilter(logging.Filter):
    """Schwärzt Secret-Werte in jeder Log-Zeile, auch in Argumenten und Fehlermeldungen."""

    def filter(self, record: logging.LogRecord) -> bool:
        try:
            nachricht = record.getMessage()
        except Exception:  # noqa: BLE001 – kaputtes Format nicht verschlucken, nur unverändert lassen
            return True
        sauber = schwaerzen(nachricht)
        if record.exc_info and not record.exc_text:
            record.exc_text = logging.Formatter().formatException(record.exc_info)
        if record.exc_text:
            record.exc_text = schwaerzen(record.exc_text)
        if sauber != nachricht or record.args:
            record.msg, record.args = sauber, None
        return True


def logs_absichern() -> None:
    """Filter an alle Handler des Root-Loggers hängen (nach logging.basicConfig aufrufen)."""
    filt = SecretFilter()
    for h in logging.getLogger().handlers:
        if not any(isinstance(f, SecretFilter) for f in h.filters):
            h.addFilter(filt)
