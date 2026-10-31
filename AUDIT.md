# Sicherheits- und Stabilitäts-Audit (28.10.2026)

Geprüft wurde der Code dieses Projekts, so wie er in diesem Ordner liegt (Stand „Version 7“ mit Journal und
Trading-Kalender). **Nicht geprüft werden konnten** das GitHub-Repository selbst (Git-Historie, Einstellungen, Secrets,
Branch-Schutz), die veröffentlichte Website und die Konten bei den Datenanbietern: Für diese Sitzung war kein
GitHub-Zugang verbunden. Alles, was davon abhängt, ist unten als *vermutet* oder *manuell zu prüfen* markiert.

Legende: **N** = nachgewiesen (im Code gefunden oder durch einen Test belegt), **V** = vermutet (plausibel, aber nicht
überprüfbar), **OK** = geprüft, kein Befund.

## 1. Was die Plattform ist

| Teil | Technik | Läuft wo | Produktiv? |
|---|---|---|---|
| Wochenbericht (`main.py`, `src/`) | Python 3.12, yfinance, pandas, numpy, Jinja2, PyYAML | GitHub Actions, montags per Zeitplan | ja: erzeugt Website, schreibt `data/` und `site/` ins Repository, verschickt E-Mail |
| Website (`site/`) | statisches HTML, CSS, JavaScript ohne Framework und ohne Build-Schritt | GitHub Pages (wenn `PAGES_AKTIV=true`) | ja: öffentlich lesbar |
| Live-Server (`live.py`) | Python-Standardbibliothek (`http.server`) | nur auf dem eigenen Rechner, 127.0.0.1 | nein, lokales Werkzeug |
| Workstation (Work-Modus), Charts, Kalender, Backtest, Szenarien, Journal, Alarme | Browser-JavaScript, Daten aus `site/daten/` und `localStorage` | im Browser der Nutzerin oder des Nutzers | ja, als Teil der Website |

Es gibt **keine Datenbank, kein Login, keine Nutzerkonten auf einem Server und keine Zahlungs- oder Orderfunktionen**.
Alles Persönliche (Depot, Journal, Trades, Alarme, eigene Regeln, Finnhub-Schlüssel) liegt im `localStorage` des
jeweiligen Browsers und verlässt ihn nicht. Dadurch entfallen ganze Risikoklassen (SQL-Injection, Zugriff auf fremde
Nutzerdaten, Session-Diebstahl, Rechte-Eskalation); andere werden wichtiger (Backups der Browserdaten, Lizenzen der
öffentlich gestellten Kursdaten).

Externe Dienste: Yahoo Finance (über yfinance, inoffiziell), Eulerpool, Finnhub, OANDA, FRED/ALFRED, BLS, BIS, CFTC,
SEC EDGAR, Trading Economics, FMP, Anthropic (nur lokal, Chart-Taktik), TradingView-Widget (nur nach Klick), SMTP.

## 2. Kritische Sicherheitsprobleme

Keine nachgewiesen. Insbesondere:

- **OK** Keine Schlüssel, Tokens oder Passwörter im Code, in Vorlagen, Tests oder `config.yaml` (Mustersuche nach
  API-Schlüsseln, Tokens, privaten Schlüsseln und Passwortzuweisungen über das ganze Projekt).
- **OK** Alle Server-Schlüssel kommen aus Umgebungsvariablen beziehungsweise GitHub-Secrets; keiner wird ins Frontend
  geschrieben. Der Finnhub-Schlüssel im Browser ist der eigene, freiwillig eingetragene Schlüssel der Person am Gerät.
- **V** Ob früher einmal ein Secret in die Git-Historie geraten ist, ließ sich nicht prüfen (kein Repository-Zugang).
  Prüfweg in `SECURITY.md`.

## 3. Hohe und mittlere Risiken

| # | Befund | Art | Risiko | Behoben? |
|---|---|---|---|---|
| H1 | **Keine Trennung von Test und Produktion.** Jeder Lauf von `main.py` mit gesetzten SMTP-Variablen verschickt die echte E-Mail; Änderungen lassen sich online nur testen, indem man Production ändert. | N | hoch (Prozess) | ja: Staging-Workflow, `FATHOM_UMGEBUNG`, Mail- und Schreibsperre in Staging |
| H2 | **Workflow ohne Branch-Schutz:** „Run workflow“ lässt sich auf jedem Branch starten. Ein Lauf auf einem Feature-Branch würde dorthin committen, die echte E-Mail verschicken und (falls die Pages-Umgebung es zulässt) die Live-Website aus dem Feature-Branch veröffentlichen. | N (Workflow), V (ob GitHubs Standard-Regel für `github-pages` greift) | hoch | ja: Jobs laufen nur auf dem Standard-Branch |
| H3 | **Lizenz der Kursdaten:** Die öffentliche Website enthält Kurs- und Fundamentaldaten (u. a. `daten/backtest/*.json`, `daten/kurse/*.json`, Analysen). Yahoo Finance erlaubt keine Weitergabe, Eulerpool und Finnhub (kostenlose Stufe) nur nach ihren Bedingungen. Eine technische Abrufmöglichkeit ist keine Erlaubnis zur Veröffentlichung. | N (veröffentlicht), V (Vertragslage) | hoch (rechtlich) | nein, Entscheidung nötig (siehe 6) |
| M1 | **Abhängigkeiten nicht festgeschrieben:** `requirements.txt` nur mit Mindestversionen, keine Lockdatei. Jeder Montagslauf installiert die gerade neuesten Versionen; ein fehlerhaftes oder kompromittiertes Update landet ungeprüft in Production. | N | mittel | ja: `requirements.lock` mit Hashes, Workflows nutzen sie |
| M2 | **Kostenpflichtige KI-Abfrage ohne Tagesgrenze:** `POST /api/taktik` (nur lokal, nur mit `ANTHROPIC_API_KEY`) war auf eine Anfrage je 3 Sekunden begrenzt, aber nicht pro Tag. Eine Schleife im Browser könnte bis zu 1.200 Abfragen pro Stunde auslösen. | N | mittel (Kosten) | ja: Tagesgrenze, Standard 100, einstellbar |
| M3 | **Suche ohne Grenze:** `GET /api/suche` des lokalen Servers fragt Yahoo ab. Fremde Webseiten können die Antwort zwar nicht lesen (kein CORS), die Abfrage aber blind auslösen. | N | niedrig bis mittel | ja: höchstens 30 Suchen je Minute |
| M4 | **Browserdaten ohne Sicherung:** Depot, Journal, Trades und Alarme liegen nur im Browser. Cache leeren oder Gerät wechseln löscht sie. Die Kontosicherung existiert, aber nur von Hand. | N | mittel (Datenverlust) | teilweise: Hinweis in SECURITY.md und DEPLOYMENT.md |
| M5 | **Antwortgröße einzelner Datenquellen nicht begrenzt** (FRED, Kalender, Prognosen lesen die ganze Antwort). | N | niedrig | ja: Obergrenze 20 MB |
| M6 | **Kein `.env.example`, `.gitignore` deckt nur `.env`** (nicht `.env.local`, `.env.production` …). | N | niedrig | ja |
| M7 | **Schlüssel in Adressen:** FRED, Trading Economics und FMP erwarten den Schlüssel als URL-Parameter. Fehlermeldungen von `urllib` enthalten die Adresse nicht (geprüft); GitHub maskiert Secrets in Logs. Ein künftiges `log.warning(url)` würde den Schlüssel aber ausgeben. | N (Muster), OK (heute kein Leck) | niedrig | ja: Log-Filter schwärzt alle bekannten Secret-Werte |

Geprüft und **in Ordnung** (aus früheren Audits vorhanden, erneut kontrolliert):

- **OK** `live.py` lauscht nur auf 127.0.0.1, prüft den Host-Kopf (gegen DNS-Rebinding), verlangt für jede Änderung
  dieselbe Herkunft und JSON (gegen CSRF), hat kein CORS, begrenzt Anfragen auf 64 KB, zeigt keine Ordnerlisten und
  keine Stacktraces, setzt CSP, `X-Frame-Options: DENY`, `frame-ancestors 'none'`, `nosniff`, `Referrer-Policy`,
  `Permissions-Policy`. Die vorhandenen Tests dafür laufen (`test_sicherheit_*`).
- **OK** Kein SSRF: Alle Server-Abrufe gehen an feste https-Adressen; Nutzereingaben landen nur URL-kodiert als Parameter.
- **OK** XSS: Daten aus `localStorage`, Kontosicherungen, Nachrichten-Feeds und Depot-Dateien werden beim Anzeigen
  escaped; Links aus Feeds nur mit `http(s)`. Eingeschleuste Werte wurden in Browser-Tests geprüft (nichts ausgeführt).
- **OK** Kein `eval`, kein `pickle`, kein `subprocess`, kein `yaml.load` ohne `safe`.
- **OK** GitHub Actions: Rechte standardmäßig `{}`, Actions auf Commit-Hashes gepinnt, `persist-credentials: false`,
  Dependabot aktiv, Token nur im Schritt, der es braucht.
- **V** RSS-Feeds (Fed, EZB) werden mit `xml.etree` gelesen. Python schützt seit 3.7.1 bzw. mit aktuellem expat gegen
  Entity-Bomben, die Quellen sind feste offizielle Adressen; Risiko gering, kein Handlungsbedarf.
- **Nicht anwendbar:** Login, Passwörter, Sessions, Cookies, Rollen, Abos, Datei-Uploads auf einen Server,
  Datenbank-Rechte, Migrationen, Row Level Security.

## 4. Architektur und Stabilität

- **OK** Ausfall einer Datenquelle legt den Bericht nicht lahm: Jede Quelle ist einzeln abgesichert (`_safe`, Caches für
  FRED, OANDA, Kalender, Backtest-Katalog), fehlende Daten erscheinen als „Daten fehlen“.
- **OK** Backtest rechnet im Browser; große Tests belasten nur das eigene Gerät. Der Server-Endpunkt für Einzelwerte
  lässt nur einen Abruf gleichzeitig zu und merkt sich Ergebnisse sechs Stunden.
- **N** `site/` und `data/` werden jede Woche ins Repository geschrieben (`backtest.json` rund 1,2 MB). Das Repository
  wächst dadurch um etwa 60 MB im Jahr. Unkritisch für die Verfügbarkeit, bekannt und dokumentiert.
- **N** Behoben während der letzten Arbeiten: eine Endlosschleife beim Zeigen auf das Konto-Widget, die Mausklicks
  verschluckte (28.10.).

## 5. Tests und Backups

- Vorhanden: 65 Python-Tests (inkl. Sicherheitstests des Live-Servers), 55 Node-Tests der Rechenkerne, dazu
  Browser-Tests im Arbeitsordner (nicht im Projekt, weil sie Playwright brauchen).
- **N** Die Browser-Tests laufen nicht in GitHub Actions. → Dokumentiert als Release-Prüfung; ein Smoke-Test der
  gebauten Seite (Struktur, Skripte, keine Platzhalter) läuft jetzt in jedem Staging-Lauf.
- **Backups:** Code und `data/` sind durch Git versioniert (jeder Montag ein Commit). Die Website lässt sich aus jedem
  Commit neu bauen. Browserdaten nur über die Kontosicherung (siehe M4). **V** Ob das Repository zusätzlich gesichert
  ist (zweite Kopie, Schutz des `main`-Branches gegen Force-Push), ließ sich nicht prüfen.

## 6. Daten, API-Kosten, Verfügbarkeit

- **Kosten:** Alle Quellen außer Anthropic sind kostenlos oder nutzen kostenlose Stufen. Die Abrufe laufen einmal pro
  Woche; Caches verhindern Wiederholungen. Kostenrisiko nur bei der KI-Deutung (M2, behoben).
- **Lizenzen (H3):** Empfohlen, in dieser Reihenfolge: (a) prüfen, ob die Website wirklich öffentlich sein muss; ein
  privates Repository mit privatem Pages-Zugang gibt es nur mit GitHub Enterprise, ansonsten die Seite lokal mit
  `live.py` nutzen und Pages abschalten (`PAGES_AKTIV` leer lassen), (b) die Bedingungen der genutzten Anbieter für die
  eigene Nutzung prüfen (Yahoo: nur persönlicher Gebrauch; Finnhub kostenlos: nicht kommerziell; Eulerpool: laut
  Vertrag), (c) falls öffentlich, nur Kennzahlen und Signale veröffentlichen und die Rohkurse weglassen. Das ist eine
  rechtliche Entscheidung und wurde nicht automatisch geändert.
- **Verfügbarkeit:** GitHub Pages liefert die Seite unabhängig von den Datenquellen aus. Fällt der Montagslauf aus,
  bleibt der Stand der Vorwoche online.

## 7. Backtest und Trading-Funktionen

- **OK** Kein Blick in die Zukunft: Signale am Schluss eines Tages, Einstieg frühestens zur nächsten Eröffnung;
  Zahlentermine nach Börsenschluss wirken am Folgetag. Abgedeckt durch `test_backtest_reaktionstag_ohne_blick_in_die_zukunft`
  und den Node-Test „Kein Blick in die Zukunft“.
- **OK** Kosten: Kommission (Standard 0,05 % je Seite, ohne Spread-Daten), Geld-Brief-Spread bei OANDA-Daten,
  Finanzierung über Nacht bei Hebel, Knock-out bei Hebelprodukten. **N** Darüber hinaus keine Slippage; bei
  Ereignis-Trades zum Minutenkurs ist das optimistisch. Steht jetzt in den Grenzen der README.
- **OK** Datenqualität: doppelte Tage werden entfernt, Kurse ≤ 0 verworfen, fehlende Eröffnungen durch Schlusskurse
  ersetzt und markiert, Lücken und Ausreißer gegen eine zweite Quelle geprüft (`src/datenpruefung.py`).
- **N** Überlebensverzerrung: Watchlist und Katalog enthalten die Werte von heute; Werte, die es nicht mehr gibt,
  fehlen. Bereits im Prüfstand-Text erwähnt; jetzt auch im Backtest-Hinweis der README.
- **OK** Ergebnisse sind als Rückrechnung gekennzeichnet („keine Prognose, keine Empfehlung“ in Backtest, Szenarien,
  Journal).
- **OK** Importierte Depot-Dateien und Kontosicherungen werden geprüft, bevor sie gespeichert oder angezeigt werden.

## 8. Maßnahmen, nach Risiko und Aufwand

| Priorität | Maßnahme | Aufwand | Status |
|---|---|---|---|
| 1 | Staging-Workflow und Branch-Schutz im Workflow (H1, H2) | klein | umgesetzt; Code-Sperren durch Tests belegt, Workflows mit actionlint geprüft, auf GitHub noch nicht gelaufen |
| 2 | Lockdatei mit Hashes (M1) | klein | umgesetzt; Installation mit `--require-hashes` und alle Tests unter Python 3.12 lokal geprüft |
| 3 | KI-Tagesgrenze, Such-Grenze, Größenlimit, Log-Schwärzung (M2, M3, M5, M7) | klein | umgesetzt, mit Tests |
| 4 | `.env.example`, `.gitignore` (M6) | klein | umgesetzt |
| 5 | Entscheidung zur Veröffentlichung der Kursdaten (H3) | mittel, rechtlich | offen, braucht dich |
| 6 | Branch-Schutz für `main` und Umgebung `github-pages` auf `main` beschränken | klein, in GitHub | offen, manuell |
| 7 | Git-Historie mit gitleaks auf alte Secrets prüfen | klein | offen, manuell (Befehl in SECURITY.md) |
| 8 | Regelmäßige Kontosicherung der Browserdaten (M4) | klein | dokumentiert |
