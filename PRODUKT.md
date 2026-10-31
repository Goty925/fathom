# Produkt-Sprint: Setup Lab (28.10.2026)

Ergebnis des Product Innovation Sprints. Reihenfolge wie im Auftrag: Ist-Zustand → drei Konzepte → Auswahl →
MVP-Umfang → technische Planung → Premium → Metriken. Was tatsächlich gebaut und getestet wurde, steht in Abschnitt 8.

## 1. Ist-Zustand (geprüft im Code und im Browser, nicht nur in der Oberfläche)

| Bereich | Stand | Belege |
|---|---|---|
| Backtest „Fakten“ | **funktioniert vollständig**: bis 30 Fakten (Zahlen, Wirtschaftsdaten, Wochentag, Fathom-Signale, Trend, Kursveränderung …), Long/Short, TP/SL, Haltedauer, Hebel mit Zwangsschließung, Kommission, Finanzierung; Minuten-/Stunden-/Tageskerzen; kein Blick in die Zukunft (Tests vorhanden) | `assets/backtest-kern.js`, `assets/backtest.js`, `tests/backtest_kern.test.js` |
| Report | **funktioniert**: Trades, Trefferquote, Ø Gewinn/Verlust, Ø Trade (= Erwartungswert je Trade auf den Einsatz), Median, Profit-Faktor, t-Wert, größter Rückgang, Sharpe, Kosten und Finanzierung, Kaufen-und-Halten-Vergleich, Jahr für Jahr, je Wert, Beitrag je Fakt, Datenqualität, CSV | `report()` in `backtest.js` |
| Chart-Taktik | **funktioniert**: Zeichnungen + Text → Regeln (regelbasiert, KI optional lokal), eigener Backtest auf Tages-/Wochenkerzen (seit 29.10. auch Monat, Stunden und Minuten, siehe Abschnitt 12) | `assets/zeichnen.js`, `assets/taktik-kern.js` |
| Speicher | **nur eine** Strategie (`fathom.backtest`) und eine Chart-Taktik je Wert (`fathom.taktik`), überschrieben bei jeder Änderung; letzter Lauf als Kurzfassung (`fathom.backtest.letzt`). **Keine Bibliothek, keine Versionen, kein Zeitstempel der Regeln.** | `localStorage` |
| Journal, Trading-Kalender | funktioniert, aber **nicht mit Backtests verknüpft** | `assets/seiten.js` |
| Wirtschaftskalender (Work) | funktioniert; für den Backtest nur mit `FRED_API_KEY` historisch korrekt (ALFRED-Erstveröffentlichung, Datum, 8:30 Uhr NY). Prognosen nur mit kostenpflichtigem Schlüssel, ihre historische Korrektheit ist **nicht geprüft** | `src/kalender.py`, `src/wirtschaft.py` |
| Earnings | Termine und Überraschungen aus Eulerpool/Yahoo; für den Backtest als Fakt „Quartalszahlen“ nutzbar | `src/backtest.py` |
| Konten, Login, Workspaces | **keine**: statische Website, alles im Browser; Konto = lokales Profil mit JSON-Sicherung | `assets/konto.js` |
| Abo, Paywall, Billing | **keine** | – |
| Analytics, Tracking | **keine** (bewusst) | – |
| Daten | wöchentlicher Lauf (Montag), Backtest-Daten bis zu 10 Jahre, Katalog mit rund 55 Werten, mit `live.py` jeder Yahoo-Wert. Demo-Daten sind zufällig und werden bei jedem Bau neu erzeugt | `main.py`, `src/demo.py` |
| Kosten | alle Quellen kostenlos oder kostenlose Stufen; Anthropic nur lokal und optional (mit Tagesgrenze) | `DEPLOYMENT.md` |

Folgerung: Die Ergebnisanalyse (Baustein C im Auftrag) **existiert bereits** und wird nicht neu gebaut. Es fehlt
ein Gedächtnis: Wer eine Strategie ändert, verliert die vorige; niemand sieht, wann eine Regel festgelegt wurde und
wie sie sich **danach** geschlagen hat.

## 2. Drei Konzepte

### A. Setup Lab mit Bewährungsprobe
Strategien als **Setups** speichern: Regeln, These, Kennzahlen und Datenstand werden mit Zeitstempel eingefroren,
jede Regeländerung wird eine neue Version. Die **Bewährungsprobe** rechnet eine gespeicherte Version auf den neuen
Daten und zeigt getrennt, wie sie auf Kursen lief, die beim Speichern noch niemand kannte (echtes Out-of-Sample).
Jeder Montagslauf bringt neue Kurse, also einen Grund wiederzukommen.

### B. Robustheits-Prüfstand
Überanpassung sichtbar machen: Zeitraum teilen (vorne entwickeln, hinten prüfen), Ziel und Stop um ±25 % variieren,
Vergleich mit zufälligen Einstiegen gleicher Haltedauer (Monte Carlo).

### C. Ereignis-Kontext
Ergebnisse nach Marktumfeld aufteilen: Trend-Regime, Volatilität, Nähe zu CPI-/Arbeitsmarkt-Terminen und
Quartalszahlen; Hinweis in „Termine“, wenn ein Setup von einem anstehenden Termin betroffen ist.

Bewusst verworfen: KI-Chat zur Strategie (kein belegbarer Mehrwert gegenüber der regelbasierten Auswertung, laufende
Kosten), weitere News-Kachel, weiterer Kalender (existieren).

## 3. Bewertung (1 = schlecht, 5 = gut; bei Aufwand und Kosten: 5 = gering)

| Kriterium | A Setup Lab | B Robustheit | C Kontext | Begründung in Kürze |
|---|---|---|---|---|
| Problem groß und konkret | 4 | 5 | 3 | A: Strategien gehen beim Ändern verloren, Ergebnisse sind nur In-Sample. B: Überanpassung ist das Kernproblem, aber abstrakt. C: nice to know |
| Nutzungshäufigkeit | 4 | 2 | 3 | A: jede Woche neue Daten → neue Prüfung. B: nur beim Entwickeln. C: bei Terminen |
| Passung zur Workstation | 5 | 4 | 4 | A nutzt Engine, Report und Fenster unverändert |
| Differenzierung | 4 | 3 | 3 | Strategietester rechnen neu, sobald neue Kerzen kommen (TradingView beschreibt Forward-Testing so); Journale wie TradeZella verknüpfen Playbooks mit manuellen Backtests. Ein regelbasiertes, zeitgestempeltes Einfrieren mit automatischer Nachprüfung habe ich dort nicht gefunden (nicht erschöpfend recherchiert). Robustheitstests gibt es in Profi-Software |
| Entwicklungsaufwand | 4 | 3 | 2 | A: Speicher + Oberfläche, Engine vorhanden. C: Datenarbeit, Lizenzfragen |
| Laufende Kosten | 5 | 4 | 2 | A: keine API, Rechnen im Browser. B: Rechenzeit. C: Prognosedaten kostenpflichtig |
| Premium-Eignung | 4 | 4 | 4 | A: Anzahl Setups, Wochen-Mail, Sync. B/C: Tiefenanalysen |
| Schnell validierbar | 4 | 3 | 2 | A: Speichern/Wiederöffnen direkt messbar, Test mit 5 Personen in 2 Wochen |
| **Summe** | **34** | **28** | **23** | |

## 4. Auswahl: A, Setup Lab mit Bewährungsprobe

- Löst ein nachgewiesenes Problem dieses Projekts (eine einzige, überschriebene Strategie) und baut auf dem
  stärksten vorhandenen Teil auf (Backtest-Engine mit Kosten, Hebel, Ereignissen, ohne Blick in die Zukunft).
- Die Bewährungsprobe ist methodisch sauber: Regeln mit Zeitstempel, nur Trades **nach** dem Speichern zählen als
  neu. Das ist der ehrlichste Test, den ein Backtest-Werkzeug ohne erfundene Daten liefern kann.
- Keine laufenden Kosten, keine neue Infrastruktur, keine KI.
- B und C werden später Bausteine *innerhalb* eines Setups (Abschnitt 10).

## 5. MVP-Umfang

Drin:
1. **Speichern aus dem Report** des Fakten-Backtests: Name, These, „widerlegt, wenn …“, bei neuer Version
   „was hat sich geändert“ (automatisch vorgeschlagen). Gespeichert werden Regeln (Klasse, getestete Werte, Zeitraum,
   Fakten, Signal-Schwellen), Text in Worten, Kennzahlen, Datenstand, Zeitpunkt.
2. **Versionen**: neue Version nur bei geänderten Regeln (Signatur), Änderung in Worten.
3. **Bibliothek** als dritter Reiter „Setups“ im vorhandenen Backtest-Fenster (keine neue Navigationsebene).
4. **Bewährungsprobe** auf Klick: Trades seit dem Speichern, offene Position, Vergleich mit dem Backtest erst ab 10
   neuen Trades, Hinweis bei nachträglich geänderten Kursdaten, Demo-Warnung.
5. **Versionen vergleichen** (Tabelle) und **im Baukasten öffnen**.
6. Kontosicherung enthält die Setups; Grenzen: 50 Setups, 20 Versionen je Setup.

Nachgereicht am 28.10. (Wunsch nach mehr Werkzeugen): Chart-Taktik-Setups, siehe Abschnitt 11.

Nicht drin (bewusst): Robustheits-Prüfstand, Ereignis-Kontext, Sync zwischen Geräten,
Paywall, Tracking über das Netz, KI.

## 6. Technische Planung

| Teil | Datei | Aufgabe |
|---|---|---|
| Kern (rein, testbar in Node) | `assets/setup-kern.js` | Speicher prüfen/normalisieren, Signatur, Setup/Version anlegen, Grenzen, Kennzahlen aus Trades, Trennung vor/nach Stichtag, Stichprobe und Abweichung, Regeländerungen in Worten, lokale Metriken |
| Oberfläche | `assets/setups.js` | Reiter „Setups“, Speichern-Formular im Report, Liste, Detail, Versionen, Bewährungsprobe |
| Anbindung | `assets/backtest.js` | dritter Reiter, Knopf im Report, Schnittstelle `WBBacktest.setupRegel()`, `.setupLaden()`, `.setupPruefen()` (lädt Werte, Intraday, rechnet mit `K.lauf` ohne die teure Beitragsrechnung) |
| Sicherung | `assets/konto.js` | `fathom.setups` in die Positivliste |
| Gestaltung | `assets/stil.css` | wenige `sl-*`-Regeln, sonst vorhandene `bt-*`-Bausteine |
| Tests | `tests/setup_kern.test.js`, Browser-Test im Arbeitsordner | Kernlogik, Integration, Sicherheit (eingeschleuste Setups) |

Speicherformat `fathom.setups` (Version 1, lokal):
`{ v: 1, liste: [{ id, name, these, widerlegt, erstellt, geaendert, geoeffnet, proben, zuletzt, versionen: [{ nr, zeit, notiz,
regel: { klasse, wert, extra, werte[], jahre, fakten[], params }, worte, daten: { stand, demo }, ergebnis: {…}, probe: {…} }] }] }`.
Unbekannte Felder werden beim Laden verworfen, zu lange Texte gekürzt, ungültige Einträge entfernt.

## 7. Premium (Konzept, nicht gebaut)

| Kostenlos | Premium |
|---|---|
| bis 5 Setups, alle Versionen, Bewährungsprobe auf Klick, Vergleich der Versionen | unbegrenzte Setups, Sync zwischen Geräten, **wöchentliche Mail „Deine Setups diese Woche“** (neue Trades, offene Positionen), Robustheits-Prüfstand, Ereignis-Kontext, Export als PDF/CSV je Setup, Minutendaten für alle Werte |

Heute gibt es weder Server noch Konten. Grenzen im Browser lassen sich umgehen und sind deshalb **keine** Paywall.
Sicher durchsetzbar sind Premium-Grenzen erst dort, wo ein Server etwas liefert:
1. Speicherung und Sync der Setups (Konto mit Login, Grenze beim Schreiben prüfen),
2. Wochen-Mail (wird serverseitig für Konten mit Abo berechnet),
3. Premium-Daten (Minutenkerzen, Prognosen) über eine API mit Anmeldung statt als öffentliche Dateien auf Pages,
4. rechenintensive Tests (Robustheit) als Server-Job mit Kontingent je Konto.
Bereits vorhandene Funktionen (Backtest, Report, Chart-Taktik) bleiben kostenlos.

## 7a. Metriken und Validierung

Es gibt kein Tracking und es wird keins eingeführt. Das Setup Lab zählt **nur lokal** im eigenen Speicher (sichtbar,
mit der Kontosicherung exportierbar, nie übertragen): Anlagedatum, Versionen, wie oft ein Setup geöffnet und geprüft
wurde, letzte Prüfung. `WBSetupLab.metriken()` fasst das ohne Namen und Regeln zusammen:

| Metrik | Frage | Berechnung |
|---|---|---|
| Aktivierung | Speichern Nutzer ein erstes Setup? | `setups ≥ 1` |
| Tiefe | Entwickeln sie weiter? | Anteil Setups mit ≥ 2 Versionen |
| Wiederkehr | Kommen sie zurück? | Setups, die ≥ 7 Tage nach dem Anlegen erneut geprüft wurden |
| Bewährung | Wird die Probe genutzt? | Prüfungen je Setup, Setups mit ≥ 1 neuem Trade |
| Nutzung | Was wird am meisten genutzt? | Öffnen vs. Prüfen vs. neue Version |

Validierung ohne Infrastruktur: 5 Testpersonen, 2 Wochen, danach Kontosicherung freiwillig teilen oder
`WBSetupLab.metriken()` vorlesen lassen. Erfolgskriterium: mindestens 3 von 5 speichern ≥ 2 Setups und prüfen
mindestens eines nach ≥ 7 Tagen erneut. Ein späteres Opt-in mit anonymen Zählern würde genau diese Funktion senden.

## 8. Umsetzung (Branch `feature/setup-lab`, auf `security-hardening`)

| Datei | Änderung |
|---|---|
| `assets/setup-kern.js` | neu: Speicher prüfen, Signatur, Versionen, Kennzahlen, Teilung am Stichtag, Stichprobe, Vergleich, Datenänderung, lokale Metriken |
| `assets/setups.js` | neu: Reiter „Setups“, Speichern-Formular, Liste, Detail, Versionen, Bewährungsprobe |
| `assets/backtest.js` | dritter Reiter (Pfeiltasten), Knopf „Als Setup speichern“, Schnittstelle `setupRegel/setupLaden/setupPruefen`, Herkunft der Regeln |
| `assets/konto.js` | `fathom.setups` und Reiter „setups“ in der Positivliste der Sicherung |
| `assets/stil.css` | `sl-*`-Regeln mit vorhandenen Tokens; auf dem Handy kürzere Spaltenköpfe, Reiter ohne Umbruch |
| `templates/_basis.html.j2` | zwei Skripte (Kern vor `backtest.js`, Oberfläche danach) |
| `tests/setup_kern.test.js`, `tests/test_logik.py` | 10 Node-Tests, 2 Python-Tests |
| `tests/conftest.py` (auf `security-hardening`) | Tests unabhängig von `FATHOM_UMGEBUNG`; ohne diese Korrektur wäre der Staging-Workflow an einem Mail-Test gescheitert |
| `README.md` | Abschnitt „Setups“ |

Nicht verändert: Backtest-Kern, Report, Chart-Taktik, Work, Journal, Kacheln, Python-Pipeline, Workflows.

## 9. Tests und offene Risiken (Stand 28.10.2026)

Bestanden (lokal und in einer Staging-Probe in einem frischen Klon mit `FATHOM_UMGEBUNG=staging`, Python 3.12,
Installation aus `requirements.lock` mit Prüfsummen):

- Node: 65 Tests (davon 10 neu), u. a. „Bewährungsprobe ohne Blick in die Zukunft“: Auf gekürzten Daten (Stand beim
  Speichern) und auf vollen Daten entstehen vor dem Stichtag dieselben Einstiege und Ergebnisse; geänderte Kurse werden
  erkannt.
- pytest: 79 Tests (davon 2 neu).
- Staging-Bau mit Beispieldaten, Smoke-Test `tools/website_pruefen.py --staging`, `git diff` auf `data/ site/ config.yaml`
  leer, actionlint für beide Workflows.
- Browser (Chromium, Playwright, Staging-Bau): 44 Prüfungen für Speichern, Kennzahlen = Report, Bewährungsprobe,
  Versionen, Änderungsvorschlag, gleiche Regeln ohne neue Version, veralteter Report, Esc, Pfeiltasten, Bearbeiten,
  Löschen mit Rückfrage, voller Speicher, eingeschleuste Setups (kein HTML, nichts ausgeführt), 390 px und 1440 px, hell
  und dunkel, keine Skriptfehler. Zusätzlich CPI-/Forex- und Quartalszahlen-Beispiel: Probe in 0,1 bis 0,2 s.
- Regression: vorhandene Browser-Tests für Journal/Trading-Kalender und die Fenster Termine/Alarme/Depot bestanden.

Während der Entwicklung fehlgeschlagen und behoben: Zeilentrenner im regulären Ausdruck, zweites Öffnen des
Speichern-Formulars, Tabelle auf dem Handy zu breit, Randfall „Einstieg am letzten Tag vor dem Speichern“ im Test,
Mail-Test unter `FATHOM_UMGEBUNG=staging`.

Nicht geprüft: Lauf auf GitHub Actions (kein Zugriff aufs Repository), echte Daten (Beispieldaten in Staging),
Safari und Firefox, Bildschirmleser jenseits von Rollen und Fokus. Typprüfung gibt es im Projekt nicht (JavaScript ohne
Build); Syntax mit `node --check`, Python mit ruff (keine neuen Befunde außer einem bekannten Muster im Testcode).

Offene Risiken:
- Setups liegen nur im Browser: Cache leeren löscht sie (Sicherung über Konto). Sync braucht später ein Konto mit Server.
- Die Bewährungsprobe wird erst mit der Zeit aussagekräftig (wöchentliche Daten, ab 10 neuen Trades); am Anfang zeigt
  sie meist „noch kein neuer Trade“. Das ist ehrlich, kann aber enttäuschen. Validieren (Abschnitt 7a).
- Signal-Definitionen in Fathom könnten sich ändern; die Probe würde das als „Daten oder Definitionen geändert“ melden,
  aber nicht erklären, welche.
- Speichergrenze des Browsers (meist um 5 MB): 50 Setups × 20 Versionen passen in der Regel; volle Speicher werden
  gemeldet, nichts wird still verworfen.
- Premium-Grenzen sind nur ein Konzept; im Browser wären sie umgehbar.

## 9a. So testest du das Setup Lab in Staging

1. Beide Patches einspielen (erst `fathom-security-hardening.patch`, dann `fathom-setup-lab.patch`) und den Branch
   `feature/setup-lab` pushen. Ein Pull Request gegen `main` startet den Workflow **Staging** (siehe `DEPLOYMENT.md`).
2. Unter dem Lauf das Artefakt **site-staging** laden, entpacken, `python -m http.server -d site_staging 8000 --bind 127.0.0.1`.
3. Backtest öffnen → Beispiel „Quartalszahlen“ → „Als Setup speichern“ mit Name und These.
4. „Zum Setup“ → „Bewährungsprobe rechnen“: Direkt nach dem Speichern steht „noch kein neuer Trade“. Das ist richtig.
5. „Im Baukasten öffnen“, einen Fakt ändern, neu starten, speichern → v2 mit vorgeschlagener Änderung; Versionen vergleichen.
6. Wie es nach einigen Wochen aussieht, lässt sich nur mit einem Testtrick zeigen: in der Browser-Konsole den
   Zeitstempel einer Version zurückdatieren (`fathom.setups` → `versionen[0].zeit`). Die Probe weist dann zu Recht darauf
   hin, dass der Backtest-Teil nicht mehr zur Momentaufnahme passt. Mit Demo-Daten gibt es bewusst kein Urteil.
7. Optional „Run workflow“ mit `daten: echt` (Staging-Schlüssel), um die Probe auf echten Kursen zu sehen.

## 10. Nächste Schritte (Ideen, nicht umgesetzt)

1. **Kontext je Setup** (Konzept C, klein anfangen): Trades nach Trend-Regime bei Einstieg und nach „Termin innerhalb
   der Haltedauer“ aufteilen, nur mit historisch datierten Quellen (ALFRED-Termine, Zahlentermine).
2. **Robustheits-Prüfstand** (Konzept B) für gespeicherte Setups: Zeitraum teilen, Stop/Ziel variieren, Zufallseinstiege.

## 11. Chart-Taktik wie im Charttool (28.10.2026, Wunsch: alle Elemente wie bei TradingView)

Ausgewählt nach Rückfrage: Zeichenwerkzeuge und Indikatoren, die sich in Regeln übersetzen lassen; dazu Chart-Taktiken
als Setup. Nicht gebaut: reine Notiz-Werkzeuge (Text, Pfeile, Formen) und Chartmuster (Kopf-Schulter usw.).

- Werkzeuge: Linie, Strahl, Trendlinie (beidseitig verlängerbar), senkrechte Linie, Zone, paralleler Kanal,
  Fibonacci-Retracement, Long- und Short-Position. Alle mit Griffen, Namen, Tastenkürzeln, im Test nutzbar.
- Indikatoren: SMA, EMA, Bollinger, RSI, MACD, ATR mit eigener Länge; im Chart bzw. in eigenen Feldern; als Bedingung
  und (ATR) als Stop/Ziel. Werte an Kerze i hängen nur von Kursen bis i ab (Test gegen abgeschnittene Daten).
- Deuten: rund 30 neue Sprachmuster (RSI, MACD, Golden Cross, Bollinger, Fib-Level, Kanal-Kanten, Stichtag, Position).
- Behoben: Nach einer Textänderung rechnete „Taktik backtesten“ mit der alten Deutung, solange nicht „Taktik verstehen“
  geklickt wurde. Esc beim Zeichnen schloss das ganze Fenster.
- Grenzen: Volumen fehlt in den Kursdaten (kein VWAP, kein Volumenprofil); Stochastik, Ichimoku und Muster sind nicht
  abgebildet; Freitext-Deutung bleibt regelbasiert und meldet, was sie nicht versteht.
- Tests: taktik_kern 16 (9 neu), setup_kern 12 (2 neu), pytest +1 (KI-Anfrage), Browser 41 Prüfungen (taktik_test.py).

## 12. Wertsuche, Zeiträume und Zoom in der Chart-Taktik (29.10.2026)

Rückmeldung: Im Backtest ließen sich keine beliebigen Aktien wählen, keine Minuten- oder Stundenkerzen, und das Zoomen
war unsauber.

- **Wertsuche** im Kopf des Charts (wie die Symbolsuche gängiger Charttools): ohne Eingabe alle geladenen Werte, beim
  Tippen Watchlist, Backtest-Katalog und mit `python live.py` jeder Wert von Yahoo Finance. Gleiche Suche wie im
  Reiter „Fakten“ (`WBBacktest.suche`), neue Werte über `WBBacktest.wertBereit`. Das alte Auswahlfeld im Formular ist weg.
- **Zeiträume** 1m, 5m, 15m, 1h, 4h, Tag, Woche, Monat. Woche und Monat aus Tageskursen, 4h je Handelssitzung aus
  Stundenkerzen (`fasse` im Taktik-Kern). Stundenkerzen statisch aus den OANDA-Dateien (Devisen, Rohstoffe, Indizes);
  Minuten und Stunden jedes Werts nur über `live.py` (`/api/kerzen`, `src/intraday.py`, Yahoo: 1m 7 Tage, 5m/15m
  60 Tage, 1h 2 Jahre). Nicht verfügbare Zeiträume sind ausgegraut und sagen, warum. Zeiten bleiben Tage seit 1970,
  bei Minuten und Stunden mit Nachkommastellen; dadurch gelten Zeichnungen in jedem Zeitraum.
- **Zoom und Ansicht:** Mausrad und Trackpad nach Stärke der Bewegung (statt fester Sprünge), höchstens ein Bild je
  Frame; waagerechtes Wischen verschiebt; Spreizen mit zwei Fingern; Ziehen an Preis- und Zeitachse; „Auto“ und
  Doppelklick für die Preisachse; Herauszoomen hält den rechten Rand; Tasten + − 0; Höhe des Charts ziehbar. Bei mehr
  Kerzen als Pixeln fasst die Anzeige Kerzen zusammen (gerechnet wird mit allen). Zeitachse mit Uhrzeiten, Tagen,
  Monaten oder Jahren je nach Ausschnitt; Fadenkreuz mit Zeit.
- **Setups:** speichern den Zeitraum; Bewährungsprobe und Laden holen dieselben Kerzen und brechen mit einer klaren
  Meldung ab, wenn die Quelle fehlt (z. B. Minuten ohne `live.py`). Bei Quellen mit begrenztem Zeitraum weist die
  Probe darauf hin, dass ältere Trades fehlen; der Vergleich mit dem gespeicherten Backtest entfällt, wenn die Daten
  heute später beginnen.
- **Sicherheit und Kosten:** `/api/kerzen` nur von dieser Seite und als JSON, Kürzel und Intervall geprüft, höchstens
  30 Abrufe je Minute, ein Abruf gleichzeitig, Zwischenspeicher je Kürzel und Intervall (1 bis 30 Minuten, höchstens
  40 Einträge), Antwort höchstens 20.000 Kerzen. Kein neuer Schlüssel, keine Kosten.
- **Grenzen:** Yahoo-Intraday nur reguläre Handelszeit und nur für die genannten Zeiträume; Minuten-Backtests über
  sieben Tage sind entsprechend kurz. Auf GitHub Pages gibt es Minuten gar nicht und Stunden nur mit OANDA-Daten.
  Die Haltedauer zählt Kerzen (Hinweis im Ergebnis, wenn der Text „Tage“ sagt).
- **Tests:** taktik_kern +2 (Zeiträume, Rückrechnung auf Minutenkerzen), setup_kern +1, pytest +2 (`/api/kerzen`:
  fremde Seite, Eingaben, Drossel, Zwischenspeicher; Kodierung), Browser: neue Suite zeitraum_test.py (statisch und mit
  `live.py --demo`), dazu die bisherigen Suiten unverändert grün.
