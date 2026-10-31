# Sicherheit

Stand 28.10.2026. Befunde und Maßnahmen des letzten Audits: [AUDIT.md](AUDIT.md). Schutzmaßnahmen im Überblick:
Abschnitt „Sicherheit“ in der [README](README.md). Umgebungen und Freigabe: [DEPLOYMENT.md](DEPLOYMENT.md).

## Sicherheitslücke melden

Bitte **kein öffentliches Issue**. Stattdessen auf GitHub im Repository: Reiter „Security“ → „Report a
vulnerability“ (private Meldung; muss unter Settings → Code security → „Private vulnerability reporting“ eingeschaltet
sein). Antwort in der Regel innerhalb einer Woche. Bitte keine Angriffe oder Lasttests gegen die Website, die
Datenanbieter oder fremde Dienste.

## Was geschützt werden muss

| Gut | Wo es liegt | Schutz |
|---|---|---|
| API-Schlüssel, SMTP-Zugang | GitHub Secrets, lokal `.env` | nie im Code; `.env`/`.env.*` in `.gitignore`; Werte in Logs geschwärzt; Staging bekommt keine SMTP-Secrets |
| Depot, Journal, Trades, Alarme, eigener Finnhub-Schlüssel | `localStorage` im Browser | verlassen das Gerät nicht; Import nur geprüfter Einträge; Anzeige immer escaped |
| Watchlist, Historie, Signal-Protokoll | Repository (`config.yaml`, `data/`) | Git-Historie; Schreiben nur durch den Production-Workflow auf `main` |
| Live-Website | GitHub Pages | Veröffentlichung nur aus `main`; CSP als `meta` |

Es gibt bewusst **kein Login und keine Nutzerverwaltung**: Die Website ist statisch, persönliche Daten bleiben im
Browser. Eine Anmeldung würde ohne Server nichts schützen und wurde deshalb nicht eingeführt.

## Wenn ein Schlüssel öffentlich geworden sein könnte

Zuerst **rotieren**, dann aufräumen. Ein Schlüssel, der einmal in einem öffentlichen Commit, Log oder Screenshot stand,
gilt als bekannt, auch wenn er später gelöscht wurde.

1. Beim Anbieter einen **neuen** Schlüssel erzeugen (Kundenkonto des Anbieters, Bereich API oder Sicherheit).
2. Den neuen Wert in GitHub eintragen: Settings → Secrets and variables → Actions → Secret bearbeiten
   (bzw. lokal in `.env`).
3. Einen Staging-Lauf und danach einen Production-Lauf prüfen.
4. Erst dann den **alten** Schlüssel beim Anbieter widerrufen oder löschen.
5. Beim Anbieter die Nutzung der letzten Wochen auf fremde Abrufe prüfen (Kontingent, Rechnungen).
6. Optional die Historie bereinigen (`git filter-repo`), nachdem rotiert wurde. Das ersetzt die Rotation nie.

| Schlüssel | Besonderheit |
|---|---|
| `SMTP_PASSWORT` | App-Passwort beim Mailanbieter widerrufen und neu erzeugen; bei Verdacht auch das Kontopasswort ändern und die Anmeldeaktivität prüfen |
| `ANTHROPIC_API_KEY` | kostenpflichtig: sofort widerrufen, Nutzung und Ausgaben in der Anthropic Console prüfen, Ausgabenlimit setzen |
| `OANDA_API_TOKEN` | neues Token erzeugen widerruft das alte; bei einem Live-Konto Kontobewegungen prüfen (Fathom selbst handelt nie) |
| `EULERPOOL_API_KEY`, `FINNHUB_API_KEY`, `FMP_API_KEY`, `TRADINGECONOMICS_API_KEY` | Kontingent und ggf. Rechnung prüfen |
| `FRED_API_KEY`, `BLS_API_KEY` | kostenlos; trotzdem neu anlegen und den alten löschen |
| `STAGING_DEPLOY_TOKEN` | fine-grained Token unter GitHub → Settings → Developer settings löschen und neu erzeugen; darf nur auf das Staging-Repository zugreifen |
| Finnhub-Schlüssel im Browser | in Fathom unter Konto entfernen und beim Anbieter neu erzeugen; Kontosicherungen mit Schlüssel löschen |

**Git-Historie prüfen** (empfohlen einmalig, nicht im Audit erledigt, weil kein Zugriff auf das Repository bestand):
```
gitleaks git --redact -v .        # https://github.com/gitleaks/gitleaks
```
`--redact` sorgt dafür, dass gefundene Werte nicht im Terminal erscheinen.

## Regeln für Änderungen

- Neue Schlüssel nur über Umgebungsvariablen; in `.env.example` (ohne Wert), `src/umgebung.py` (`GEHEIM`, für die
  Log-Schwärzung) und `DEPLOYMENT.md` eintragen.
- Neue Abrufe aus dem Netz nur an feste `https`-Adressen, Antwort über `src/netz.py` lesen (Größengrenze).
- Alles, was im Browser angezeigt wird und nicht aus dem eigenen Code stammt, als Text einfügen, Links nur `http(s)`.
- Jede Änderung zuerst über Staging (Pull Request), nie direkt auf `main`.
- Neue Python-Bibliotheken: in `requirements.txt` eintragen, `requirements.lock` neu erzeugen (Befehl steht in der
  Datei), beides zusammen committen.

## Bekannte Restrisiken

- Kursdaten auf der öffentlichen Website: Lizenzlage nicht geklärt (AUDIT.md, H3).
- Browserdaten haben kein automatisches Backup. Regelmäßig Konto → Sicherung speichern.
- Erweiterungen im Browser können `localStorage` lesen, auch den eigenen Finnhub-Schlüssel.
- GitHub Pages kann keine HTTP-Kopfzeilen setzen (kein `frame-ancestors`, kein eigenes HSTS über die Seite hinaus).
- `yfinance` ist eine inoffizielle Schnittstelle; Ausfälle sind möglich und werden im Bericht als „Daten fehlen“ gezeigt.
