"""Bericht per E-Mail verschicken (SMTP).

Zugangsdaten kommen NIE in den Code, sondern aus Umgebungsvariablen
(bei GitHub: "Secrets"). Benötigt werden:
  SMTP_HOST      z. B. smtp.gmail.com
  SMTP_PORT      z. B. 465
  SMTP_USER      deine Absender-Adresse
  SMTP_PASSWORT  App-Passwort (nicht dein normales Passwort!)
  MAIL_AN        Empfänger, mehrere mit Komma trennen
"""
from __future__ import annotations

import logging
import os
import smtplib
import ssl
from email.message import EmailMessage

log = logging.getLogger(__name__)
NOETIG = ["SMTP_HOST", "SMTP_USER", "SMTP_PASSWORT", "MAIL_AN"]


def ist_eingerichtet() -> bool:
    return all(os.environ.get(v) for v in NOETIG)


def sende(betreff: str, html: str, text: str) -> None:
    from . import umgebung
    if not umgebung.mail_erlaubt():  # zweite Sperre: Staging verschickt nie, auch wenn SMTP-Secrets gesetzt sind
        log.info("E-Mail übersprungen: Umgebung %s", umgebung.name())
        return
    if not ist_eingerichtet():
        fehlend = [v for v in NOETIG if not os.environ.get(v)]
        log.info("E-Mail übersprungen, es fehlen: %s", ", ".join(fehlend))
        return

    msg = EmailMessage()
    msg["Subject"] = betreff
    msg["From"] = os.environ["SMTP_USER"]
    msg["To"] = os.environ["MAIL_AN"]
    msg.set_content(text)                 # Fallback für Mailprogramme ohne HTML
    msg.add_alternative(html, subtype="html")

    host = os.environ["SMTP_HOST"]
    port = int(os.environ.get("SMTP_PORT") or 465)
    kontext = ssl.create_default_context()
    if port == 465:
        with smtplib.SMTP_SSL(host, port, context=kontext) as s:
            s.login(os.environ["SMTP_USER"], os.environ["SMTP_PASSWORT"])
            s.send_message(msg)
    else:  # z. B. Port 587 mit STARTTLS
        with smtplib.SMTP(host, port) as s:
            s.starttls(context=kontext)
            s.login(os.environ["SMTP_USER"], os.environ["SMTP_PASSWORT"])
            s.send_message(msg)
    log.info("E-Mail verschickt (%d Empfänger)", len([a for a in os.environ["MAIL_AN"].split(",") if a.strip()]))
