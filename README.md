# Fathom: Equity Screening mit Kennzahlen und Prognosen jeden Montag

Der Name: Ein *fathom* ist das englische Maß für Wassertiefe, *to fathom* heißt ergründen.
Fathom sucht große Unternehmen, deren Kurs deutlich unter dem Hoch liegt, obwohl die Zahlen stimmen.
Im Logo ersetzt ein Senklot das „o“. Den Namen änderst du in `config.yaml` bei `titel`.

Jeden Montagmorgen holt dieses Programm für deine Watchlist die aktuellen Kurse,
Quartalszahlen, Analystenprognosen und Termine von Yahoo Finance. Es prüft jede
Aktie gegen deine Signale und schickt dir eine kurze Zusammenfassung per E-Mail.

Die ausführliche Fassung ist eine Website. Die Übersicht zeigt alle Werte. Ein Klick auf
ein Unternehmen öffnet seine Analyse als Panel direkt auf der Seite (Esc oder „Schließen“
führt zurück; jede Analyse hat eine eigene Adresse wie `…/#adbe`):

- Kursverlauf über 12 Monate mit 200-Tage-Linie und Spanne der Analysten-Kursziele
- Zehn Signale je Anlageklasse nach den Faktor-Frameworks großer Häuser, frei wählbar als „zählt“ oder „Pflicht“, mit Akku-Balken, Begründung und Rechenweg
- Quartalsentwicklung (Umsatz, Gewinn, Marge, freier Cashflow)
- Bewertung: Forward-KGV im Vergleich zum eigenen 5-Jahres-Median und weitere Kennzahlen
- Analystenprognosen: Kursziele, Einstufungen, Gewinn- und Umsatzschätzungen samt Revisionen, Gewinnüberraschungen
- Profitabilität und Bilanz
- Risiko und Hebel: Volatilität, größter Rückgang und wie oft ein Knock-out mit Hebel 2, 5 oder 10 ausgelöst worden wäre
- Bull und Bear Case: was laut den Zahlen dafür und dagegen spricht

Jede Woche wird zusätzlich ein vollständiger Schnappschuss im Archiv abgelegt.

**Live-Kurse:** Auf Wunsch aktualisieren sich Kurse, Tagesveränderung, Abstand zum Hoch,
Kursziel-Abstand, Forward-KGV und die Signale laufend, und im Panel erscheint der
Kursverlauf des Tages. Jede Kursänderung leuchtet kurz grün oder rot auf, oben rechts läuft
die Uhr im Sekundentakt mit. Siehe Abschnitt 4.

**Hell und dunkel:** Der Knopf oben rechts schaltet das Design um. Ohne eigene Wahl folgt die Seite
der Einstellung des Systems; die Wahl wird nur im Browser gespeichert.

> Das ist ein Screening-Werkzeug nach selbst gewählten Regeln, keine Anlageberatung.
> Yahoo-Daten können fehlen, verzögert oder fehlerhaft sein.

---

## 1. Was steckt drin?

| Datei | Aufgabe |
|---|---|
| `config.yaml` | **Hier stellst du alles ein:** Watchlist, Schwellen der Signale, Titel |
| `main.py` | Startet den Ablauf: Daten → Kennzahlen → Signale → Bericht → E-Mail |
| `src/fetch.py` | Holt die Daten von Yahoo Finance (Bibliothek `yfinance`) |
| `src/kennzahlen.py` | Rechnet aus der Kursreihe: Renditen, 52-Wochen-Spanne, RSI, Volatilität, Knock-out-Statistik |
| `src/kriterien.py` | Katalog der Signale: zehn je Klasse, Auswertung, Auswahl und Treffer |
| `src/markt.py` | Marktdaten für die erweiterten Signale (VIX, FRED, BIS, Terminkurven, CFTC) |
| `src/backtest.py` | Daten für den Backtest: exakt kodierte Kurse, Zahlentermine, Wirtschaftsdaten → `daten/backtest.json` und `daten/backtest/`; Backtest-Katalog und einzelne Werte außerhalb der Watchlist |
| `src/oanda.py` | Geld- und Briefkurse von OANDA (Tag, Stunde, Minuten um Termine) mit Cache |
| `src/wirtschaft.py` | CPI und Arbeitsmarkt aus FRED/ALFRED (Erstveröffentlichung), Prognosen optional |
| `src/datenpruefung.py` | Lücken, Ausreißer und Abgleich mit einer zweiten Quelle |
| `src/kalender.py` | Wirtschaftskalender für den Work-Modus: FRED-Termine, Fed und EZB, Quartalszahlen, Ist-Werte der BLS → `daten/kalender.json` |
| `src/nachrichten.py` | Nachrichten für `live.py`: Finnhub, Pressemitteilungen von Fed und EZB, SEC-Pflichtmitteilungen (8-K) |
| `src/screening.py` | Skala und die ursprünglichen Aktien-Signale (als Referenz für die Tests) |
| `src/klassen.py` | Signale für Forex, Rohstoffe und Indizes (Carry, Momentum, Value, Pullback, Trend, Vol-Regime) |
| `src/eulerpool.py` | Hauptdatenquelle Eulerpool (mit Yahoo als Rückfall) |
| `src/terminal.py`, `src/snowflake.py`, `src/links.py` | Fundamentals-Terminal, Snowflake, Links zu anderen Plattformen |
| `src/szenarien.py` | Szenarien für vier Quartale: Ist-Anker, Standardannahmen mit Quelle, Unsicherheiten, Zeile für die E-Mail |
| `assets/basis.js` | gemeinsame Helfer aller Seitenskripte (`window.WBH`): Auswahl, Escaping, Speicher, Zahlen- und Prozentformate, Kursstellen, Hell/Dunkel, Finnhub-Adressen, ob ein lokaler Server möglich ist; wird zuerst geladen |
| `assets/werkzeuge.js` | Screener, Heatmap, Depot-Import und Exporte |
| `assets/szenario-kern.js` | Rechenkern der Szenarien: Treiberbaum, eigene Annahmen, Quartalspfad, Memo, Protokolltexte (Node-Tests: `tests/szenario_kern.test.js`) |
| `assets/szenarien.js` | Szenarien im Analyse-Panel, als Ansicht „Szenarien“ in jeder Wertetabelle und im Depot-Röntgen |
| `assets/backtest-kern.js` | Rechenkern des Backtests (ohne Oberfläche, mit Node getestet: `tests/backtest_kern.test.js`) |
| `assets/backtest.js` | Backtest-Fenster und Report, Reiter „Fakten“ und „Chart-Taktik“ |
| `assets/taktik-kern.js` | Chart-Taktik: Beschreibung deuten, gezeichnete Linien und Zonen auf Kerzen zurückrechnen (auch unter Node getestet) |
| `assets/zeichnen.js` | Chart-Taktik: Wertsuche, Kerzen von 1 Minute bis 1 Monat, Kerzenchart mit Zeichenwerkzeugen und Zoom, Deutung und Report |
| `assets/kerzen.js` | Kerzencharts und der Schalter „Linie | Kerzen“ für alle Kursdiagramme |
| `src/taktik.py` | optionale KI-Deutung der Chart-Taktik über `live.py` (nur mit `ANTHROPIC_API_KEY`) |
| `src/intraday.py` | Minuten- und Stundenkerzen für die Chart-Taktik über `live.py` (`/api/kerzen`, Yahoo Finance; im Demo-Modus simuliert) |
| `assets/dock.js` | Taskleiste mit Widgets links: Home, Work, Backtest, Screener, Woche, Journal, Termine, Alarme, Depot, Konto |
| `assets/konto.js` | Konto als lokales Profil: Name, Farbe, Einstellungen, Sichern und Einspielen |
| `assets/seiten-kern.js`, `assets/seiten.js` | Fenster Termine, Alarme, Depot und Journal: Rechenkern (Node-Tests: `tests/seiten_kern.test.js`) und Oberfläche |
| `assets/design.js` | setzt Hell/Dunkel vor dem ersten Zeichnen (eigene Datei wegen der Content-Security-Policy) |
| `assets/work-kern.js` | Rechenkern des Work-Modus: Kurzfassung, Zuordnung, Statistik, Börsenzeiten (Node-Tests: `tests/work_kern.test.js`) |
| `assets/work.js` | Work-Modus: sieben Fenster auf einem Bildschirm |
| `src/watchlist.py` | Suche (Yahoo, gefiltert auf in Deutschland Handelbares) und Bearbeiten der Watchlist in `config.yaml` |
| `src/einordnung.py` | Regeln für „Was dafür / dagegen spricht“ |
| `src/render.py` | Baut die Website (Übersicht + Analyse-Panels) und die E-Mail |
| `templates/` | HTML-Vorlagen: `uebersicht`, `_analyse` (Panel je Wert), `email` |
| `assets/` | Gestaltung (`stil.css`), Diagramme (`charts.js`), Panel und Live-Kurse (`app.js`), Schriften Bricolage Grotesque (Überschriften), Geist und Geist Mono (auf Apple-Geräten die Systemschrift), alle lokal |
| `live.py` | Lokaler Live-Server: zeigt die Website mit laufend aktualisierten Kursen |
| `src/mailer.py` | Verschickt die E-Mail (Zugangsdaten nur über Umgebungsvariablen) |
| `src/historie.py` | Speichert jede Woche einen Schnappschuss in `data/historie.csv` |
| `src/demo.py` | Simulierte Daten zum Testen ohne Internet |
| `tests/` | Automatische Tests (`python -m pytest`) |
| `.github/workflows/wochenbericht.yml` | Zeitplan: läuft jeden Montag automatisch bei GitHub |

### Signale: zehn je Anlageklasse (Schwellen und Auswahl in `config.yaml`)

Auf der Website heißen die Regeln **Signale**, das Fenster zum Einstellen **Screener**. In `config.yaml` und im
Code steht aus Kompatibilitätsgründen weiter `kriterien`.

Die Auswahl folgt öffentlich dokumentierten Faktor-Frameworks: den MSCI-FaCS-Faktorgruppen (Value, Size, Momentum,
Volatility, Quality, Yield, Growth), den Faktor-Indizes von J.P. Morgan und Goldman Sachs, den Risikoprämien für
Währungen und Rohstoffe (Carry, Momentum, Value, Terminstruktur) und den Risikoindikatoren der Aktienstrategen.
Keine Bank veröffentlicht eine feste Liste „ihrer“ zehn Filter; die Quelle steht an jedem Signal.

| Klasse | Standard (zählt) | Weitere Signale |
|---|---|---|
| Aktien | Large Cap, Earnings Momentum, Pullback, Valuation Gap | Preis-Momentum, Profitabilität (ROE), Solide Bilanz (Nettoverschuldung/EBITDA), FCF-Rendite, Gewinnrevisionen, Niedrige Volatilität |
| Forex | Carry, Momentum, Value, Vol-Regime | Carry-to-Risk, Trend, Kurzfrist-Momentum, Zinstrend, Realzins-Vorsprung, Volatilitätsniveau |
| Rohstoffe | Momentum, Pullback, Value, Vol-Regime | Terminstruktur (Roll-Rendite), Trend, Kurzfrist-Momentum, Saisonalität, Positionierung (CFTC), Volatilitätsniveau |
| Indizes & Futures | Trend, Momentum, Pullback, Vol-Regime | Kurzfrist-Momentum, VIX, VIX-Kurve, Kreditrisiko (High-Yield-Spread), Saisonalität, Knock-out-Risiko |

Jedes Signal ist **aus**, **zählt** (bringt einen Punkt) oder ist **Pflicht** (ohne es ist ein Wert nie ein Treffer).
Ein **Treffer** erfüllt mindestens `treffer_ab` der aktiven Signale und alle Pflichtsignale. Auf der Website
stellst du das je Kachel unter **„Screener anpassen“** ein (eigenes Fenster mit Reglern für die Schwellen); die
Auswahl gilt dann für Tabelle, Analyse, Lage oben, Filter und Portfolio in deinem Browser. Für Bericht und E-Mail
trägst du sie unter `auswahl:` in `config.yaml` ein, „Für config.yaml kopieren“ liefert den Ausschnitt.
Sind mehr als fünf Signale aktiv, zeigt die Tabelle statt einzelner Spalten ein kompaktes Profil mit einem
stehenden Balken je Signal.

Die Spezifikation aller Signale steht einmal in `src/kriterien.py`; Python und die Website (`assets/regeln.js`)
rechnen daraus mit denselben Regeln, ein Test prüft, dass die vier bisherigen Signale je Klasse unverändert sind.
Zusätzliche öffentliche Quellen ohne Schlüssel (`src/markt.py`): VIX und VIX3M (Yahoo), High-Yield-Spread (FRED),
Leitzinsverlauf und Inflation (BIS), Terminkurve der nächsten Kontrakte (Yahoo) und Positionierung der Fonds
(CFTC Commitments of Traders). Fällt eine Quelle aus, zeigt nur das betroffene Signal „Daten fehlen“.

Jedes Signal hat einen Akku-Balken. Die Füllung zeigt, wie deutlich ein Wert es erfüllt:
genau halb voll heißt „Grenze erreicht“ (feiner Strich in der Mitte). Leer bedeutet weit entfernt,
voll bedeutet sehr deutlich erfüllt. Die Füllung ist im Dunkelmodus weiß, im Hellmodus schwarz;
im untersten Zehntel läuft sie von Orange (10 %) nach Rot (0 %). Ein Sternchen an jedem Signal
zeigt beim Zeigen oder Antippen die Definition. Bei zwei Bedingungen mit „und“ zählt die schwächere, bei
„oder“ die stärkere. Die Formeln stehen in `src/kriterien.py` und `src/screening.py` (Funktion `skala`).

Dazu gibt es eine **Warnung bei anstehenden Quartalszahlen** (21 Tage vorher), weil
Hebelprodukte an diesen Tagen durch Kurslücken komplett wertlos werden können.

### Marktband

Direkt unter der Navigationsleiste stehen alle Indizes, Rohstoffe und Währungen deiner Watchlist mit Kurs und
Veränderung (ohne Live-Quelle die Wochenveränderung, mit Live-Quelle die Tagesveränderung). Zeigen auf die Veränderung
blendet den Kursverlauf ein, ein Klick öffnet die Analyse. Auf dem Handy und bei vielen Werten lässt sich das Band
waagerecht wischen bzw. mit dem Mausrad verschieben.

### Was Fathom anders macht als andere Screener

- **Rechenweg je Balken:** Klick auf einen Balken (oder im Analyse-Panel auf „Rechenweg“) zeigt die Rechnung mit echten
  Zahlen: Kennzahl, Formel, Schwelle, Stärke und wie die Teile verknüpft sind („und“ = schwächster Teil zählt,
  „oder“ = stärkster Teil zählt). Keine Bewertung ist eine Black Box.
- **Eigene Signale und Schwellen:** Im Screener jeder Kachel wählst du, welche der zehn Signale zählen
  oder Pflicht sind, ab wie vielen erfüllten ein Wert ein Treffer ist, und verschiebst die Schwellen mit Reglern.
  Alles rechnet sofort neu; gespeichert wird nur im Browser.
- **Signal-Protokoll („Seit letzter Woche“):** welche Signale seit dem letzten Bericht gekippt sind, mit Begründung,
  auf der Website und in der E-Mail. Grundlage ist `data/signale.json` (jede Woche ein Schnappschuss, GitHub Actions
  speichert ihn im Repository). Beim ersten Lauf und im Demo-Modus rechnet Fathom dieselben Regeln mit den Kursen
  von vor fünf Handelstagen nach.
- **Depot-Röntgen:** im Portfolio der Anteil deines Depots, der Treffer ist, dem ein Signal fehlt oder der übrig bleibt, die Währungen verknüpft mit
  den Forex-Signalen der Watchlist (z. B. EUR/USD für deine Dollar-Positionen), das Earnings-Risiko der nächsten
  Tage nach Positionsgröße und die größten Klumpen (Position, Sektor, Fremdwährung).
- **Szenarien mit Annahmen-Protokoll:** je Wert Downside, Basis und Upside für die nächsten vier Quartale, aufgesetzt
  auf die zuletzt berichteten Ist-Zahlen, mit jeder Annahme samt Quelle, den Stellen, an denen die Rechnung unsicher
  ist, und einem Memo in einfachem Deutsch. Mehr unten unter „Szenarien für vier Quartale“.
- **Regel-Prüfstand:** je Kachel, wie sich Werte in den letzten Jahren nach einem erfüllten Signal entwickelt haben
  (3, 6 oder 12 Monate), verglichen mit den Monaten ohne Signal. Getestet werden nur kursbasierte Signale, denn
  Quartalszahlen, Schätzungen, Kursziele und Leitzinsen von damals liegen nicht vor. Die Grenzen (nur heutige
  Watchlist-Werte, überlappende Zeiträume, ohne Kosten) stehen direkt darunter.

### Gestaltung

Sachlich und fast eckig, in derselben Sprache wie der Work-Modus. Bricolage Grotesque für Überschriften und große
Zahlen, für Text und Tabellen auf Apple-Geräten die Systemschrift, sonst Geist (Kürzel, Zeiten und Tasten in Geist
Mono). Warme Grautöne, eine einzige Akzentfarbe (Blau, auch im Work-Modus), gedämpftes Grün und Rot für Gewinne und
Verluste, Gelb nur für Termine. Hell ist gedämpftes Papier statt reinem Weiß (Leinwand #E0DDD6, Karten #EFEDE8,
Text #1C1B19), dunkel ein warmes Anthrazit (Leinwand #141413, Karten #1C1C1A, Text #EDEBE6). Alle Textfarben erreichen
auf ihren Flächen mindestens WCAG AA (4,5:1), Fließtext rund 15:1.

Seit 31.10.2026 (Wunsch: weniger nach KI aussehen, weg von den Rundungen, einheitlich mit dem Work-Modus):
- Ecken 2–3 px (`--r-klein`, `--r-mittel`, `--r-innen` 2 px, `--r-karte` 3 px), Abzeichen ohne Pillenform, kleine
  Statuspunkte quadratisch wie im Terminal; rund bleiben nur Ladekreis und Datenpunkte.
- Karten schweben nicht mehr: kein Schatten, eine klare Haarlinie als Rand. Nur Einblendungen (Karten neben der
  Taskleiste, Trefferlisten) haben einen knappen Schatten. Kein Glas- und Unschärfe-Effekt, nichts hebt sich beim Zeigen an.
- Der Seitentitel „Lotung“ ohne 3D-Schatten, etwas kleiner; große Zahlen und Überschriften höchstens 700 stark.
- Gewählte Schalter mit Rahmen statt als schwebendes Kärtchen, gewählte Anlageklasse mit Strich oben.
- Der Work-Modus bleibt dunkel, nutzt aber genau die dunklen Farben, die Schrift und das Blau der Website
  (`--wm-fn` = `--akzent`); die Taskleiste wird im Work-Modus mit dunkel.

Aufgebaut ist alles außer dem Work-Modus als Dashboard aus Karten: eine warme Leinwand, darauf Karten mit Haarlinie.
Die Lage oben sind drei Kennzahl-Karten, „Seit letzter Woche“ eine Karte mit getönten Kacheln je Wechsel, die
Anlageklassen Karten-Schalter, jede Rubrik darunter eine eigene Karte. Tabellen behalten ihre feinen Zeilenlinien.
Die Seite ist 1280 px breit, auf dem Handy stehen die Kennzahl-Karten untereinander, die Anlageklassen wischbar. Ganze
Abschnitte blenden beim ersten Erscheinen einmal ein, Zeilen nie (aus bei „Bewegung reduzieren“).
`assets/stil.css` ist nach Bausteinen geordnet (Schriften, Farben, Grundlagen, Kopfzeile, Rubriken, Analyse, Portfolio, …, Work-Modus,
Kerzen, Chart-Taktik, Druck). Alle Farben und Maße stehen oben in je einem Block für Hell und Dunkel, darunter die Ecken
(`--r-klein`, `--r-mittel`, `--r-karte`, `--r-innen`) sowie Leinwand und Karten (`--leinwand`, `--karte`, `--karte-rand`, `--karte-innen`).

### Taskleiste mit Widgets (links)

Statt eines Menüs sitzt links eine bündige Spalte über die volle Höhe, wie die Spalten im Work-Modus, auch auf dem
Handy. Jedes Widget ist eine Zeile mit einfarbigem Symbol, fettem Live-Wert und Namen, getrennt durch Haarlinien; es
führt zu einer Unterseite, die dessen Namen als Überschrift trägt, und zeigt schon vorher etwas Lebendiges. Die
Leiste bleibt über den Unterseiten sichtbar; so wechselst du direkt vom Work-Modus in den Backtest. Die offene Seite
erkennst du an der getönten Zeile mit blauem Strich am linken Rand. Oben sitzt das Lot, darunter Home, unten dein
Konto. Je weniger Bildschirmhöhe, desto dichter wird die Leiste: zuerst fallen die Namen weg, dann werden die
Widgets flacher, auf sehr flachen Bildschirmen bleiben nur die Symbole und die Leiste scrollt.

| Widget | Zeigt | Führt zu |
|---|---|---|
| Home | die Kalenderwoche; auf der Startseite ist es die aktive Karte | Startseite: schließt alle Fenster und springt nach oben |
| Work | Countdown bis zum nächsten wichtigen Wirtschaftstermin; die Lampe leuchtet, solange eine große Börse offen ist (orange und blinkend in den letzten 15 Minuten vor einem Termin) | Work-Modus |
| Backtest | Ergebnis deines letzten Laufs; die Karte zeigt die Kapitalkurve, Endkapital, Trades und Trefferquote | Backtest |
| Screener | Treffer über alle Klassen, mit deinen Regeln und Live-Kursen gerechnet; die Karte zeigt Treffer je Klasse | Screener (für die gerade gezeigte Kachel) |
| Woche | neu erfüllte und verlorene Signale seit dem letzten Bericht; die Karte nennt die wichtigsten Wechsel | Seit letzter Woche |
| Termine | Tage bis zum nächsten Termin für deine Werte (Quartalszahlen, Wiedervorlage) | Termine der nächsten drei Wochen |
| Alarme | Zahl der scharfen Alarme, „2 neu“ in Rot, wenn welche ausgelöst haben | Alarme |
| Depot | Wert deines Depots; die Lampe zeigt, ob es heute (oder in der Woche) im Plus oder Minus liegt | Depot |
| Journal | Zahl der Einträge, „1 fällig“, wenn eine Wiedervorlage ansteht; die Karte zeigt das Trading-Ergebnis des Monats | Journal mit Trading-Kalender |
| Konto | dein Kürzel in deiner Farbe und dein Vorname | Konto (siehe unten) |

**Konto.** Ein lokales Profil ohne Server und ohne Login (`assets/konto.js`): Name und Farbe fürs Profilbild, eine
Übersicht, was in diesem Browser liegt (eigene Signale, Portfolio-Buchungen, letzter Backtest, Finnhub-Schlüssel,
Speicherplatz), Hell/Dunkel/System, Absprung zu Live-Quellen und Screener. „Sichern“ lädt alle Fathom-Einträge als
JSON-Datei herunter, „Einspielen“ liest sie auf einem anderen Gerät wieder ein; der Finnhub-Schlüssel kommt nur mit,
wenn du den Haken setzt. „Alles zurücksetzen“ löscht nach einem zweiten Klick alle Fathom-Einträge in diesem Browser.

**Termine, Alarme, Depot, Journal** (`assets/seiten.js`, Rechenkern `assets/seiten-kern.js` mit Node-Tests): Termine,
Alarme und Depot öffnen sich wie das Konto als Schublade von rechts. Das Journal (Widget direkt unter „Woche“) ist eine
ganze Seite neben der Taskleiste wie Work und Backtest, mit eigener Adresse `#journal` (Zurück-Taste schließt) und zwei
Spalten: links Formular bzw. Kalender, rechts Einträge bzw. der gewählte Tag. Immer nur ein Fenster ist offen. Alles bleibt im Browser und gehört zur
Kontosicherung.

- **Termine:** Quartalszahlen deiner Watchlist mit erwartetem Gewinn je Aktie, Sitzungen der Notenbanken, Wirtschaftsdaten
  ab mittlerer Wichtigkeit und deine Wiedervorlagen aus dem Journal, nach Tagen gegliedert, für drei Wochen. Oben steht,
  was als Nächstes dich betrifft. Filter: Meine Werte, Notenbanken, Wirtschaft, Wiedervorlagen. Positionen im Depot sind
  markiert, zu Quartalszahlen lässt sich mit einem Klick ein Alarm einen Tag vorher setzen.
- **Alarme:** eigene Grenzen je Wert: Kurs steigt über oder fällt unter, Tagesplus oder -minus (nur mit Live-Kursen),
  Abstand zum 52-Wochen-Hoch, wird Treffer oder ist keiner mehr, Szenario-Downside schlechter als, Quartalszahlen in
  höchstens n Tagen. Geprüft wird mit jedem Kurs, solange die Seite offen ist. Ein ausgelöster Alarm erscheint als
  Meldung unten rechts (auf Wunsch auch als Benachrichtigung des Browsers), bleibt sichtbar, bis du ihn als gesehen
  markierst, und wird danach wieder scharf, sobald die Bedingung nicht mehr gilt. Mit Verlauf.
- **Depot:** Wert, Bewegung heute (mit Live-Kursen, sonst seit dem letzten Bericht) und welche Positionen sie getragen
  haben, Aufteilung nach Anlageklasse, Notizen und Alarme je Position, darunter Röntgen und Positionstabelle. Einlesen
  und Exportieren bleiben in der Portfolio-Kachel.
- **Journal:** Einträge je Wert oder allgemein (Kauf, Verkauf, Idee, Beobachtung): Warum, woran du merkst, dass du
  falsch liegst, und eine Wiedervorlage (in einer Woche, in einem Monat, nach den nächsten Zahlen). Beim Eintragen merkt
  sich Fathom Kurs und Basis-Szenario; später steht daneben, was seitdem passiert ist. Das Szenario-Memo lässt sich mit
  einem Klick einfügen. Suchen, filtern, bearbeiten, erledigen.
- **Trading-Kalender** (zweiter Reiter im Journal): ein Monatskalender, in dem jeder Tag mit Trades grün oder rot gefärbt
  ist, je kräftiger, desto größer das Ergebnis, dazu die Summe je Woche. Ein Klick auf einen Tag zeigt seine Trades und
  ein Formular: Wert von der Watchlist oder freies Instrument (z. B. ein Knock-out), Long oder Short, Stück, Einstieg,
  Ausstieg, Gebühren, oder nur das Ergebnis in Euro. Fremdwährungen rechnet Fathom mit dem Wechselkurs vom Tag des
  Eintrags um. Auf Wunsch kommen die Verkäufe aus deinem Depot automatisch dazu (Gewinn gegenüber den
  Durchschnittskosten). Oben stehen für den Monat Netto-Ergebnis mit Kurve, Zahl der Trades, Trefferquote,
  Profit-Faktor (Gewinne geteilt durch Verluste), durchschnittlicher Gewinn und Verlust sowie die Tage im Plus,
  darunter dieselben Zahlen seit dem ersten Trade. Gespeichert in `fathom.trades`, Teil der Kontosicherung.

In jeder Analyse führen „Alarm setzen“ und „Ins Journal“ direkt in das jeweilige Fenster, mit dem Wert vorausgewählt.

Beim Zeigen mit der Maus oder mit der Tab-Taste klappt neben dem Widget eine Karte mit Details auf. Oben führt das
Lot zur Übersicht.

### Work-Modus (Widget „Work“)

Der **Work-Modus** zeigt alles auf einem Bildschirm, nach dem Vorbild eines Börsenterminals (fast schwarz, dicht,
mit Tastatur bedienbar). Sieben Fenster, jedes mit eigener Nummer:

| Nr. | Fenster | Was es zeigt |
|---|---|---|
| 1 | Kurse | alle Werte nach Klasse: Kurs, heute, 1 Woche, seit Jahresbeginn, Lage in der 52-Wochen-Spanne, Volatilität, erfüllte Signale |
| 2 | Wert | Chart (heute, 1M bis 5J) und rund 40 Kennzahlen: Renditen, Volatilität, maximaler Rückgang, Sharpe, Beta und Korrelation zum S&P 500, Technik, Fundamentaldaten bzw. Zinsen und Carry, Terminkurve und CFTC, VIX und Kreditrisiko; dazu Signale, nächste Termine und passende Nachrichten |
| 3 | Nachrichten | News-Feed nach dem Vorbild von Forex Factory: Ansichten **Heiß** (nach Wichtigkeit, Zahl der Quellen, Bezug zu deinen Werten und Frische), **Neueste**, **Anstehend** (angekündigte Termine der nächsten sieben Tage mit Countdown, Prognose und Vorwert), **Eilmeldungen** und **Analysen**; Wichtigkeit als Mappe in Rot, Orange oder Gelb; Filter nach Währung (USD, EUR, GBP, JPY, CHF), eigenen Werten und Klassen. Meldungen mehrerer Quellen zur selben Geschichte werden gebündelt („+2 Quellen“). Ein Klick klappt die Kurzfassung, die betroffenen Werte mit Tageskurs und alle Quellen mit Link auf. Neue Meldungen erscheinen von selbst, die Lesestelle bleibt stehen; wichtige Meldungen der letzten Stunde laufen im roten Eilmeldungsband unter dem Kopf |
| 4 | Kalender | Oben die Handelssitzungen Sydney, Tokio, London und New York über 24 Stunden deutscher Zeit mit Überschneidungen und Strich für jetzt (wie die Market Hours bei Forex Factory). Darunter Wirtschaftstermine: Uhrzeit, Land, Wichtigkeit als Mappe, Ist, Prognose, Vorwert, **Countdown** je Termin und groß bis zum nächsten wichtigen Termin. Ein Klick klappt einen Termin auf: Beschreibung, Quelle und bei CPI und Arbeitsmarkt die **Marktreaktion der letzten zwölf Termine** (EUR/USD, Gold, S&P 500 nach 15 und 60 Minuten, aus den Backtest-Daten) |
| 5 | Bewegung | Heatmap heute, 1 Woche oder seit Jahresbeginn, mit der Bewegung in Standardabweichungen (σ), damit ruhige Devisen und schwankende Aktien vergleichbar sind |
| 6 | Lage | VIX und VIX-Kurve, High-Yield-Spread, Leitzinsen, Inflation und Realzinsen je Währung, Treffer je Klasse, Korrelationsmatrix über ein Jahr |
| 7 | Zeitstrahl | Wie wichtig die Nachrichten sind, wann sie kamen und wann neue zu erwarten sind, auf einer Zeitachse (12 Stunden, 24 Stunden oder 3 Tage): links die eingegangenen Meldungen als Punkte (größer bei mehr Quellen), rechts die erwarteten Termine aus dem Kalender als Rauten, beides in drei Bahnen nach Wichtigkeit (rot, orange, gelb). Darüber die Zahl der Meldungen je Abschnitt, ein Strich für jetzt, links die Zusammenfassung (eingegangen in 6 Stunden, erwartet in 24 Stunden, nächster wichtiger Termin mit Countdown), rechts die Liste **„Als Nächstes erwartet“** mit Countdown je Termin. Vergrößert (`F`) zeigt das Fenster alles gleichzeitig: Zeitachse über die volle Breite, darunter Zusammenfassung, „Zuletzt eingegangen“ und „Als Nächstes erwartet“ nebeneinander. Ein Klick öffnet die Meldung im Feed bzw. den Termin im Kalender |

Bedienung: Befehlszeile oben (`/` oder `⌘K`): Name oder Kürzel öffnet den Wert, `N` Nachrichten, `K` Kalender, `Z` Zeitstrahl,
`BT` Backtest, `A` Analyse, `?` Hilfe. Tasten `1`–`7` springen zu den Fenstern, `F` vergrößert eines, `V` schaltet das Vollbild ein (nur der Work-Modus, alle sieben Fenster dicht auf einem Bildschirm), `↑`/`↓` wechselt
den Wert, `Esc` geht zurück. Oben laufen die Uhren von New York, Frankfurt, London, Tokio, Hongkong und dem
Devisenmarkt mit „auf in“ bzw. „zu in“ (reguläre Handelszeiten, ohne Feiertage).

Quellen, ohne Webseiten auszulesen:
- **Kalender:** Termine der US-Statistiken aus dem FRED-Veröffentlichungskalender (auch künftige, inklusive Industrieproduktion), die wöchentlichen Öl-Lagerdaten der EIA (mittwochs 10:30 Uhr New York) und die CFTC-Positionsdaten (freitags 15:30 Uhr New York) als planmäßige Termine, Ist und Vorwert aus
  FRED/ALFRED (Stand am Tag der Veröffentlichung), Sitzungen von Fed und EZB von deren Webseiten (im Code hinterlegt,
  Stand Oktober 2026), Quartalszahlen der Watchlist. Mit `python live.py` kommen die Ist-Werte von CPI und
  Arbeitsmarkt **in der Minute der Veröffentlichung** direkt von der US-Statistikbehörde (BLS), Uhrzeit, Erwartung und
  Ergebnis der Quartalszahlen über Finnhub. Prognosen (Konsens) und Termine anderer Länder nur mit einem bezahlten
  Schlüssel (`TRADINGECONOMICS_API_KEY` oder `FMP_API_KEY`); vor dem Veröffentlichen auf einer öffentlichen Seite deren
  Lizenz prüfen.
- **Nachrichten:** Finnhub (Agenturen und Verlage, Titel und Anrisstext mit Link), Pressemitteilungen von Fed und EZB,
  SEC-Pflichtmitteilungen (8-K) deiner US-Aktien. Die Kurzfassung sind die ersten ein bis zwei Sätze der Quelle,
  ohne Ortsmarke und ohne den Titel zu wiederholen. Gewicht und Tendenz schätzt Fathom aus Stichwörtern, Quelle und
  Bezug zu deinen Werten; sie ersetzen kein Lesen der Meldung. Nachrichten landen nie auf der öffentlichen Website,
  sie kommen erst im Browser an.
- ForexFactory und Investing.com werden bewusst nicht ausgelesen (Nutzungsbedingungen).

### Backtest (Widget „Backtest“)

Das Widget „Backtest“ in der Leiste links öffnet den **Backtest**: ein eigenes Fenster mit drei Reitern.
Unter **Fakten** stellst du eine Strategie aus bis zu dreißig Fakten zusammen und testest sie über bis zu zehn Jahre;
unter **Chart-Taktik** zeichnest du sie in einen Kerzenchart und beschreibst sie in Worten; unter **Setups** liegen
gespeicherte Strategien mit Versionen und Bewährungsprobe (beides siehe unten).

**Jeder Wert, nicht nur die Watchlist:** Unter *Markt → Weitere* suchst du einen beliebigen Wert und testest ihn wie
einen von der Watchlist, in beiden Reitern. Woher die Kurse kommen:
- **Backtest-Katalog** (überall, auch auf GitHub Pages): rund 55 verbreitete Werte (DAX-Schwergewichte, große
  US-Aktien, ETFs wie MSCI World und S&P 500, Währungspaare, Gold, Öl, Kupfer, Indizes) werden jede Woche mit
  vorberechnet und erst beim Auswählen geladen (`daten/backtest/katalog/`, je Wert rund 80 KB). Eigene Liste in
  `config.yaml` unter `backtest.katalog`, abschalten mit `katalog: false`. Die Dateien werden veröffentlicht, aber
  nicht ins Repository geschrieben.
- **Lokaler Server** (`python live.py`): Jeder Wert aus der Yahoo-Suche (Aktien weltweit, ETFs, Währungen, Rohstoffe,
  Indizes). Der Server holt elf Jahre Tageskurse und bei Aktien die vergangenen Quartalszahlen und hält sie sechs Stunden
  im Speicher.
Gewählte Werte stehen als Chips unter der Suche (× entfernt sie) und im Auswahlfeld unter „Weitere Werte“; der Browser
merkt sie sich. Für Werte außerhalb der Watchlist gibt es Tageskurse, keine Stunden- und Minutenkerzen.

Der **Baukasten** über der Liste zeigt jeden Fakt und jedes Fathom-Signal der gewählten Klasse als eigenen Schalter:
Ein Klick fügt genau diesen Fakt hinzu, Fakten, die es nur einmal gibt (Richtung, Stop, Hebel …), und Signale nimmt
ein zweiter Klick wieder heraus. Mehrfach mögliche Fakten (etwa zwei Kursveränderungen über 5 und 20 Tage) zeigen ihre
Anzahl. Prozentwerte (Ziel, Stop, Schwellen, Einsatz in % des Kontos) ändern sich mit den Pfeilen in Schritten von
0,25; Beträge in Euro, Tage und die Kommission behalten passende eigene Schritte. Zwei Beispiele sind eingebaut:
„Nach Quartalszahlen über der Schätzung am Montag zur Eröffnung long, Take-Profit 2 %“ und „US-Inflation mindestens
0,1 Prozentpunkte über der Prognose → eine Minute nach 8:30 Uhr New York EUR/USD short, Hebel 20, Ziel +3 % auf den
Einsatz“.

| Gruppe | Fakten |
|---|---|
| Wann einsteigen | **Wirtschaftsdaten** (US-CPI gesamt/Kern zum Vorjahr/Vormonat, neue Stellen, Arbeitslosenquote: Ist gegenüber Prognose oder Vorwert, um mindestens x Prozentpunkte bzw. x %, oder Ist über/unter einem Wert; Einstieg 1, 5, 15, 30 oder 60 Minuten danach oder zur nächsten Eröffnung), Quartalszahlen über/unter der Schätzung, Wochentag, Fathom-Signal (jedes einzeln wählbar, kursbasiert, mit deinen Schwellen), Trend zur 200-Tage-Linie, Kursveränderung, letzter Handelstag, Eröffnungslücke, Abstand zum 52-Wochen-Hoch, Volatilität, Kalendermonate |
| Wie handeln | Long oder Short, Einstieg zur Eröffnung oder zum Schluss der Börsensitzung |
| Wann aussteigen | Take-Profit und Stop-Loss in % vom Kurs oder vom Einsatz, Haltedauer in Handelstagen, Stunden oder Minuten |
| Kapital, Hebel und Kosten | Startkapital, Einsatz je Trade (Betrag oder % des Kontos), **Hebel 1–100** mit Zwangsschließung (Standard 50 % Verlust des Einsatzes, EU-Regel) und Finanzierung über Nacht, Kommission |

Der Report rechnet in Euro: Endstand, Gewinn oder Verlust, größter Rückgang, Trefferquote, Ø Trade auf den Einsatz und
Ø Kursbewegung, Profit-Faktor, t-Wert (Zufall oder nicht?), Kosten und Finanzierung, Zwangsschließungen, Kontoverlauf
gegen Kaufen und Halten, wie die Trades endeten, Verteilung, **was jeder Fakt beiträgt** (derselbe Test ohne diesen
Fakt), Jahr für Jahr, je Wert, jeder Trade mit Uhrzeit und Termin (CSV zum Herunterladen) und eine **Datenqualität**
je Wert (Quelle, Auflösung, Lücken, Ausreißer, Abgleich mit einer zweiten Quelle).

**Datenquellen für den Backtest** (alle Schlüssel als GitHub Secrets, nie im Code):

| Quelle | Wofür | Schlüssel |
|---|---|---|
| OANDA v20 | Forex, Gold, Silber, Öl, Kupfer, Indizes: Geld- und Briefkurse ab 2005, Stundenkerzen über zehn Jahre, Minutenkerzen um jeden Termin | `OANDA_API_TOKEN` aus einem kostenlosen Demokonto (`OANDA_UMGEBUNG`: practice) |
| FRED/ALFRED (Fed St. Louis) | CPI und Arbeitsmarkt genau so, wie sie am Tag der Veröffentlichung gemeldet wurden (Erstveröffentlichung, nicht revidiert), mit Datum; Uhrzeit 8:30 Uhr New York | `FRED_API_KEY`, kostenlos |
| Trading Economics oder FMP | Prognosen (Konsens), optional und kostenpflichtig | `TRADINGECONOMICS_API_KEY` oder `FMP_API_KEY` |
| Eulerpool, Yahoo Finance | Aktien (Tageskurse, Zahlentermine), Rückfall für alles andere; zweite Quelle für den Abgleich | wie bisher |

Ohne OANDA rechnet der Backtest mit Tageskursen, ohne FRED fehlt der Fakt „Wirtschaftsdaten“, ohne Prognose-Schlüssel
bleiben „gegenüber Vorwert“ und „als Wert“. Investing.com und ForexFactory werden bewusst nicht ausgelesen
(Nutzungsbedingungen). Alles Geladene liegt in `cache/backtest/` (nicht im Repository, in GitHub Actions über
`actions/cache` aufgehoben): abgeschlossene Zeiträume werden nie neu geladen, und fällt eine Quelle aus, rechnet der
Backtest mit dem Stand davor.

**Veröffentlichung:** Die OANDA-Daten sind für die persönliche Nutzung gedacht. Stunden- und Minutenkerzen landen daher
nur auf der öffentlichen GitHub-Pages-Seite, wenn in `config.yaml` `backtest: intraday_veroeffentlichen: true` steht.
Lokal (`python main.py`, dann `python live.py`) sind sie immer dabei. Prüfe die Bedingungen deines Kontos, bevor du
das einschaltest.

Regeln gegen Selbstbetrug:

- **Kein Blick in die Zukunft:** Beim Einstieg zur Eröffnung zählen nur Kurse bis zum Vortagesschluss. Quartalszahlen
  gelten ab dem ersten Handelstag, an dessen Eröffnung sie bekannt waren. Wirtschaftsdaten zählen ab der Minute ihrer
  Veröffentlichung, eingestiegen wird frühestens eine Minute danach.
- **Feinste Auflösung:** Ausstiege werden Kerze für Kerze geprüft, um Termine auf Minuten (5 Minuten davor bis
  mindestens 4 Stunden danach), sonst auf Stunden, vor Beginn der Stundendaten auf Tagen. Treffen Ziel und Stop in
  derselben Kerze, zählt der Stop. Öffnet der Kurs jenseits einer Marke, wird zur Eröffnung ausgeführt (Kurslücke).
- **Geld und Brief:** Long kauft zum Brief- und verkauft zum Geldkurs, Short umgekehrt; ausgeweitete Spreads um
  Termine stecken damit im Ergebnis.
- **Slippage:** Über den Geld-Brief-Spread hinaus wird keine Slippage abgezogen. Bei Einstiegen eine Minute nach
  einem Termin ist das optimistisch: Echte Orders werden in schnellen Märkten oft schlechter ausgeführt. Ohne
  Spread-Daten (Yahoo, Eulerpool) zählt nur die Kommission (Standard 0,05 % je Seite).
- **Hebel:** Ergebnis auf den Einsatz = Hebel × Kursbewegung, Zwangsschließung und Finanzierung wie beim Broker; über
  der EU-Grenze für Privatkunden (Forex-Hauptpaare 30:1, Gold und Hauptindizes 20:1, Rohstoffe 10:1, Aktien 5:1) steht
  ein Hinweis im Report. Das Konto fällt nicht unter null.
- Je Wert eine Position gleichzeitig, je Quartalsmeldung oder Termin höchstens ein Trade; ist kein Kapital frei,
  entfällt das Signal.
- Fathom-Signale mit Quartals- oder Analystendaten lassen sich nicht zurückrechnen und sind im Backtest gesperrt.
- Survivorship Bias: nur Werte, die heute auf der Watchlist stehen. Ohne Steuern; Gewinne in Fremdwährung wie Euro.

Im Demo-Modus sind Kurse, Termine und Prognosen zufällig erzeugt (im Format der echten Quellen). Die Strategie wird
nur im Browser gespeichert.

### Chart-Taktik (Reiter im Backtest)

Hier zeichnest du deine Taktik wie in TradingView in einen Kerzenchart und erklärst sie in einem kurzen Text.

1. **Wert und Kerzen** wählen, oben über dem Chart:
   - **Wert:** Ein Klick auf den Namen öffnet die Suche. Ohne Eingabe stehen dort alle geladenen Werte (Watchlist und
     weitere), beim Tippen auch der Backtest-Katalog und mit `python live.py` jede Aktie, jeder ETF, Index, Rohstoff
     und jedes Währungspaar von Yahoo Finance. Pfeiltasten und Enter gehen auch.
   - **Kerzen:** 1m, 5m, 15m, 1h, 4h, T (Tag), W (Woche), M (Monat). Welche es gibt, hängt von der Quelle ab:

     | Kerzen | auf GitHub Pages | mit `python live.py` |
     |---|---|---|
     | Tag, Woche, Monat | alle Werte (Woche und Monat aus Tageskursen) | alle Werte |
     | 1 Stunde, 4 Stunden | Devisen, Rohstoffe, Indizes mit OANDA-Daten | jeder Wert (Yahoo Finance, letzte 2 Jahre) |
     | 1, 5, 15 Minuten | – | jeder Wert (Yahoo Finance: 1 Minute für 7 Tage, 5 und 15 Minuten für 60 Tage) |

     **Live:** Bei US-Aktien und -ETFs läuft die jüngste Kerze in jedem Zeitraum in Echtzeit mit, sobald ein kostenloser
     Finnhub-Schlüssel hinterlegt ist (Einstellung „Live-Kurse“, nur in diesem Browser gespeichert). Jeder Handel schreibt
     Schluss, Hoch und Tief fort oder beginnt eine neue Kerze; das Feld „Live“ im Chartkopf zeigt, ob Trades ankommen
     („wartet“, wenn die Börse zu ist). Die Vorgeschichte bleibt, wie sie geladen wurde; der Backtest rechnet mit den
     geladenen Kerzen, nicht mit den live dazugekommenen. Finnhub kostet nichts (eigener kostenloser Schlüssel); andere
     Börsen, Devisen, Rohstoffe und Indizes laufen darüber nicht live.
     4-Stunden-Kerzen fasst Fathom je Handelssitzung aus Stundenkerzen zusammen. Uhrzeiten stehen in deiner Ortszeit,
     Tageskerzen gehören zum Handelstag. Zeichnungen gelten in jedem Zeitraum (eine Linie vom Tageschart steht auch
     im Stundenchart); senkrechte Linien merken sich die Minute.
   - **Ansicht:** Mausrad, Trackpad (auch Spreizen) oder zwei Finger zoomen um den Zeiger, waagerecht wischen
     verschiebt. Ziehen an der **Preisachse** streckt oder staucht die Kerzen („Auto“ unten rechts oder Doppelklick
     auf die Achse passt sie wieder an), Ziehen an der **Zeitachse** zeigt mehr oder weniger Kerzen. Tasten: <kbd>+</kbd>
     und <kbd>−</kbd> zoomen, <kbd>0</kbd> zeigt wieder die jüngsten Kerzen, Pfeiltasten verschieben. Der Balken unter
     dem Chart ändert seine **Höhe** (Doppelklick: zurück). Bei sehr vielen Kerzen fasst der Chart sie zur Anzeige
     zusammen; gerechnet wird immer mit allen.
2. **Zeichnen** (Werkzeugleiste über dem Chart, Taste in Klammern):

   | Werkzeug | Kürzel | So zeichnen | Im Test nutzbar als |
   |---|---|---|---|
   | Waagerechte Linie (H) | L1 | ein Klick | Ausbruch, Berühren, Zustand, Stop/Ziel |
   | Waagerechter Strahl (J) | S1 | ein Klick, gilt ab dieser Kerze nach rechts | wie die Linie, erst ab ihrem Start |
   | Trendlinie (T) | T1 | zwei Punkte, nach rechts und/oder links verlängerbar | wie die Linie |
   | Senkrechte Linie (I) | V1 | ein Klick | Stichtag: „nach V1“ / „vor V1“ |
   | Rechteck / Zone (R) | Z1 | zwei Ecken | Lauf in die Zone, Ausbruch, Ober- und Unterkante |
   | Paralleler Kanal (K) | K1 | Grundlinie mit zwei Punkten, Breite mit drittem Klick | wie die Zone, mit schrägen Kanten |
   | Fibonacci-Retracement (F) | F1 | vom Start (100 %) zum Ende (0 %) | jedes Level („61,8 % von F1“), Bereiche („Golden Pocket“), Stop/Ziel an Leveln |
   | Long- / Short-Position (L, S) | P1 | ein Klick, Stop und Ziel an den Kanten ziehen | Stop, Ziel und Richtung (als Abstand in %) |

   Der **Magnet** rastet an Eröffnung, Hoch, Tief und Schluss ein. Jede Zeichnung bekommt ein Kürzel und auf Wunsch
   einen Namen („Widerstand“). Gewählte Zeichnungen verschiebst du am Körper oder an den Griffen, <kbd>Entf</kbd> löscht,
   <kbd>Esc</kbd> bricht das Zeichnen ab.
   **Indikatoren** (Knopf „Indikatoren“): SMA, EMA und Bollinger-Bänder im Chart, RSI, MACD und ATR in eigenen Feldern
   darunter, jeweils mit eigener Länge. In der Beschreibung genannte Indikatoren erscheinen von selbst.
3. **In Worten beschreiben**, zum Beispiel: „Kaufe, wenn der Kurs über den Widerstand schließt und der RSI über 50 ist.
   Stop 2 ATR, Ziel 2R. Spätestens nach 20 Tagen raus.“ Erkannt werden unter anderem: Ausbruch über/unter einer
   Zeichnung, Berühren von oben/unten, Lauf in eine Zone oder einen Kanal, Ausbruch aus Zone oder Kanal, Fibonacci-Level
   und -Bereiche, Stichtag; Kurs gegen SMA/EMA beliebiger Länge, Kreuzung zweier Durchschnitte (auch „Golden Cross“ und
   „Death Cross“), RSI über/unter/kreuzt eine Schwelle („überverkauft“, „überkauft“), MACD gegen Signal- oder Nulllinie,
   Kurs gegen oberes/unteres/mittleres Bollinger-Band („zurück ins Band“); Stop an einer Zeichnung (mit Abstand in %),
   in %, als Vielfaches der ATR oder am Tief der Signalkerze, Ziel an einer Zeichnung, in %, in ATR, als Vielfaches des
   Risikos (2R) oder an einem Band; Stop und Ziel einer gezeichneten Position gelten automatisch. „Unterstützung“ und
   „Widerstand“ ohne Namen meinen die tiefste bzw. höchste Linie. **„Taktik verstehen“** zeigt, wie Fathom den Text
   verstanden hat, und nennt Sätze, die es nicht abbilden konnte (z. B. Stochastik oder Volumen: dafür fehlen Daten bzw.
   Regeln). „Was Fathom versteht“ unter dem Textfeld listet Beispiele.
4. **„Taktik backtesten“** rechnet auf allen Kerzen: Signal am Schluss einer Kerze, Einstieg zur nächsten Eröffnung,
   Stop und Ziel innerhalb der Kerze über Hoch und Tief (trifft eine Kerze beides, zählt vorsichtig der Stop),
   Kosten wählbar. Die Trades erscheinen im Chart (▲ Einstieg, ▼ Ausstieg, Stop und Ziel gestrichelt) und in einer
   Tabelle; ein Klick springt zum Trade.

Gezeichnete Linien kennen die Vergangenheit: Wer heute einen Widerstand einzeichnet, sieht schon, wo der Kurs
gedreht hat. Mit dem Haken **„Nur Kerzen nach dem rechten Ende der Zeichnungen“** zählt nur, was danach geschah.
Indikatoren rechnen an jeder Kerze nur mit Kursen bis zu ihrem Schluss (RSI und ATR nach Wilder, Bollinger mit der
Standardabweichung der Grundgesamtheit, wie in gängigen Charttools) und brauchen Vorlauf: Vor der 200. Kerze gibt es
keinen SMA 200. Volumen gibt es in den Kursdaten nicht. Die Haltedauer („spätestens nach 20 Tagen“) zählt Kerzen des
gewählten Zeitraums; bei Stundenkerzen sind das 20 Stunden, Fathom weist im Ergebnis darauf hin. Bei kurzen Kerzen
wiegen Kosten und Spread je Trade schwer. Eine getestete Chart-Taktik lässt sich **als Setup speichern** (siehe unten);
die Bewährungsprobe von Setups mit Minuten- oder Stundenkerzen braucht dieselbe Quelle (bei Yahoo also `python live.py`)
und sieht nur deren Zeitraum: Bei 1-Minuten-Kerzen fehlen Trades, die älter als sieben Tage sind.
**Mit KI deuten:** Läuft `python live.py` mit `ANTHROPIC_API_KEY`, deutet auf Wunsch Claude den Text (nur Text und
Zeichnungen werden gesendet, keine Kurse oder Portfolio-Daten); das Ergebnis wird wie die eigene Deutung geprüft
und angezeigt, bevor du testest. Zeichnungen und Text bleiben in diesem Browser und kommen mit in die Konto-Sicherung.

### Setups (Reiter im Backtest): Strategien mit Zeitstempel und Bewährungsprobe

Ein **Setup** ist eine getestete Strategie, die Fathom mit Zeitstempel einfriert: Regeln (Markt, getestete Werte,
Zeitraum, Fakten, Signal-Schwellen), Text in Worten, Kennzahlen und Datenstand.

1. Im Reiter **Fakten** oder **Chart-Taktik** einen Backtest starten, dann im Ergebnis **„Als Setup speichern“**: Name, These („Warum sollte das
   funktionieren?“) und „Widerlegt, wenn …“. Speichern geht nur, wenn der Report zu den aktuellen Regeln passt.
2. Wer ein Setup **im Baukasten öffnet**, ändert und wieder speichert, erzeugt eine **neue Version**; Fathom schlägt die
   Änderung in Worten vor („neu: Kurs über der 200-Tage-Linie“). Gleiche Regeln ergeben keine neue Version. Alte
   Versionen bleiben unverändert und lassen sich in einer Tabelle vergleichen.
3. Die **Bewährungsprobe** rechnet eine Version auf den heutigen Daten und zählt nur Trades, die **nach dem Speichern**
   eröffnet wurden: Sie beruhen auf Kursen, die beim Festlegen der Regeln niemand kannte. Gezeigt werden neue Trades,
   Trefferquote, Ø Trade, Ø Gewinn und Verlust, Profit-Faktor, offene Position und der Vergleich mit dem Backtest.
   Ein Urteil („im Rahmen“, „deutlich schlechter/besser“, über den Standardfehler) gibt es erst ab 10 neuen Trades.
   Haben sich Kursdaten seit dem Speichern geändert (Splits, Dividenden, Korrekturen), steht ein Hinweis dabei.
   Mit Demo-Daten zeigt die Probe nur, wie sie arbeitet.

Alles liegt in diesem Browser (`fathom.setups`, höchstens 50 Setups mit je 20 Versionen) und kommt mit in die
Kontosicherung. Kein Tracking, keine KI, keine Kosten. Gerechnet wird mit demselben Backtest-Kern (Kosten, Spread,
Hebel, ohne Blick in die Zukunft); Slippage über den Spread hinaus ist nicht enthalten. **Chart-Taktiken** speichert
du im Ergebnis der Chart-Taktik genauso: Zeichnungen, Indikatoren, Text und Regeln werden eingefroren, die
Bewährungsprobe zählt Trades ab dem Tag nach dem Speichern. „In der Chart-Taktik öffnen“ fragt nach, bevor es andere
Zeichnungen für denselben Wert ersetzt. Hintergrund, Bewertung der Alternativen und Premium-Konzept: [PRODUKT.md](PRODUKT.md).

### Kerzencharts

Jedes Kursdiagramm hat einen Schalter **Linie | Kerzen**: der 12-Monats-Chart im Analysefenster, der Tagesverlauf
(5-Minuten-Kerzen über `live.py`), der Chart im Work-Modus (Heute bis 5 Jahre) und die Chart-Taktik. Die Wahl gilt
überall und bleibt im Browser. Passen nicht alle Kerzen nebeneinander, werden benachbarte zusammengefasst (etwa Tage zu
Wochen). Die Kursdateien `daten/kurse/<wert>.json` enthalten dafür zusätzlich `open`, `high` und `low`; Portfolio
Performance liest weiterhin nur `date` und `close`. Liefert eine Quelle nur Schlusskurse, bleibt es bei der Linie.

### Kacheln: Aktien, ETFs, Forex, Rohstoffe, Indizes & Futures

Jede Anlageklasse hat eine eigene Kachel auf der Website und eigene Signale nach demselben Prinzip
(zehn Signale, Balken 0–100, ab halber Füllung erfüllt, Definition am Sternchen). Die Auswahl folgt den
Faktoren, mit denen Häuser wie J.P. Morgan, AQR oder Blackstone diese Märkte systematisch bewerten:

| Kachel | Signale | Grenzwerte in `config.yaml` |
|---|---|---|
| Forex | Carry (Zinsdifferenz der Notenbanken), Momentum 12-1, Value (5-Jahres-Mittel), Vol-Regime | `kriterien_forex` |
| Rohstoffe | Momentum 12-1, Pullback, Value (5-Jahres-Mittel), Vol-Regime | `kriterien_rohstoff` |
| Indizes & Futures | Trend (200-Tage-Linie), Momentum 12-1, Pullback, Vol-Regime | `kriterien_index` |

Die Leitzinsen für Carry kommen automatisch von der BIS (Bank für Internationalen Zahlungsausgleich).
Einzelne Derivate (Knock-outs, Optionsscheine) werden nicht einzeln geführt, dafür gibt es keine freie
Datenquelle. Stattdessen werden ihre Basiswerte bewertet, samt Knock-out-Statistik je Hebel im Panel.

### Datenquellen und andere Plattformen

**Hauptquelle ist Eulerpool** (kostenloser Schlüssel mit 100.000 Abrufen im Monat auf eulerpool.com, als
GitHub-Secret `EULERPOOL_API_KEY`). Von dort kommen Kurse, Profil, Jahresschätzungen, Kursziele, Peers und die
Bewertungshistorie, abgefragt per ISIN. Fehlt der Schlüssel oder ein Wert, springt Yahoo Finance ein, Wert für
Wert; im Panel steht unter „Datenquellen“, was woher kam. Mit eigenem Schlüssel zeigt
`python -m src.eulerpool US00724F1012` die Rohantworten, falls Felder anders heißen als erwartet.

Fathom übernimmt die stärksten Ideen anderer Plattformen und verlinkt jeden Wert dorthin:

| Plattform | In Fathom |
|---|---|
| TradingView | Interaktiver Chart im Panel (lädt erst auf Klick, Datenschutz), Link |
| Simply Wall St | Snowflake mit fünf Achsen, Link |
| Investing.com | Technische Zusammenfassung aus 12 Durchschnitten und 7 Oszillatoren, Link |
| Finviz | Heatmap nach Sektor und Börsenwert, Screener mit Filtern und sortierbaren Spalten, Link (US-Werte) |
| TIKR, Koyfin | Finanzen über 10 Jahre, Bewertung im Zeitverlauf, Peer-Vergleich, Links |
| Eulerpool | Datenquelle, Wettbewerber, Link |
| Portfolio Performance | Kurs-Feed je Wert (`daten/kurse/<wert>.json`, JSON-Pfade `$[*].date` und `$[*].close`), Watchlist als CSV, Depot-Import |
| Parqet | Depot-Import und Export im Parqet-CSV-Format, Link |
| getquin | Link; kein Export, Weg über Portfolio Performance |
| onvista | Link per ISIN |

Das **Depot** liest eine CSV aus Portfolio Performance oder Parqet nur im Browser ein und speichert sie dort
(localStorage). Es wird nicht hochgeladen und landet nicht auf GitHub.

### Eigene Aktien zusammenstellen und Portfolio einfügen

In der Kachel **Aktien** steht über der Tabelle ein Suchfeld. Zu jedem Treffer gibt es „Zur Watchlist“ (trägt den
Wert in `config.yaml` ein und erstellt die Analyse) und „Ins Portfolio“ (Stückzahl, Kaufkurs in Euro und Kaufdatum
erfassen). Die Umschaltung **Watchlist / Mein Portfolio** zeigt deine Aktienpositionen mit Wert, Gewinn oder Verlust
und den Signal-Balken. Unter „Portfolio einfügen“ lassen sich ganze Listen einfügen (eine Zeile je Position:
`ISIN oder Kürzel; Stück; Kaufkurs; Datum`) oder eine CSV aus Portfolio Performance bzw. Parqet wählen. Positionen,
die noch nicht auf der Watchlist stehen, kommen mit „Alle auf die Watchlist“ in einem Schritt dazu. Das Portfolio
bleibt im Browser; Watchlist-Änderungen brauchen den lokalen Server (`python live.py`).

### Szenarien für vier Quartale

Nach dem Vorgehen „Forecast & scenario modeling“ aus der Claude Academy: auf die letzten Ist-Zahlen aufsetzen, vier
Quartale fortschreiben, drei Szenarien auf demselben Treiberbaum rechnen, in denen sich nur die begründeten Annahmen
unterscheiden, jede Annahme mit Größe festhalten, unsichere Stellen offen markieren und das Ergebnis als kurzes Memo
zusammenfassen. Dazu kommen Ideen aus „Compare and analyze competing options“: Werte nebeneinander, Warnhinweise,
Break-even.

**Treiberbaum.** Für Aktien mit Gewinn: *Kurs in vier Quartalen = Kurs heute × (1 + Gewinnwachstum) × (1 +
Bewertungsänderung)*, dazu die Dividende. Ausgangspunkt ist die Summe der letzten vier berichteten Quartale (Gewinn je
Aktie, bereinigt wie in den Analystenschätzungen). Jedes Prognosequartal ist das gleiche Quartal des Vorjahres mal
(1 + Gewinnwachstum), so bleibt die Saison erhalten. Für Währungen, Rohstoffe, ETFs, Indizes und Aktien ohne Gewinn:
*Kurs in vier Quartalen = Kurs heute × (1 + Kursveränderung)*, dazu Carry (Devisen) oder Roll-Rendite (Rohstoffe).

| Annahme | Downside | Basis | Upside |
|---|---|---|---|
| Gewinnwachstum | niedrigste Analystenschätzung relativ zum Mittel | Konsens fürs nächste Geschäftsjahr | höchste Schätzung |
| Bewertung (KGV) | sinkt um eine typische Jahresveränderung | bleibt | steigt um eine typische Jahresveränderung |
| Kursveränderung (ohne Gewinnbasis) | Basis minus eine Jahresschwankung | Devisen und Rohstoffe 0, ETFs und Indizes die Durchschnittsrendite der letzten zehn Jahre (0 bis 10 %) | Basis plus eine Jahresschwankung |

Die typische Jahresveränderung des KGV ist das quadratische Mittel der Veränderungen des Forward-KGV über je vier
Quartale in den letzten fünf Jahren. Fehlen Daten, rechnet Fathom pauschal (Gewinn ±5 Prozentpunkte, KGV ±15 %) und
sagt das dazu.

**Im Analyse-Panel** stehen die drei Ergebnisse als Karten, darunter ein Fächer mit dem Kursverlauf, die Tabelle
„Treiber und Annahmen“ mit Eingabefeldern (Schritt 0,25 Prozentpunkte), die Grundlage jeder Annahme, die vier
Quartale im Einzelnen, die Hinweise „Wo die Rechnung unsicher ist“ (wenige Analysten, weit auseinanderliegende
Schätzungen, Zahlen in Kürze, alte Ist-Zahlen, erhöhte Schwankung, umgerechnete Währung, pauschale Annahmen, deine
eigenen Annahmen), das Memo mit „Memo kopieren“ und das **Annahmen-Protokoll**. Ins Protokoll kommt jede Änderung
mit Datum und Größe: deine eigenen („Gewinnwachstum Upside: +19,88 % → +30,00 %“) und die des Wochenlaufs, wenn neue
Ist-Zahlen oder Schätzungen die Standardannahmen verschieben. Eigene Annahmen und Protokoll bleiben im Browser
(`localStorage`), deine Annahmen gelten weiter, bis du sie zurücksetzt.

**Vergleich:** Jede Wertetabelle hat neben „Tabelle“ und „Heatmap“ die Ansicht „Szenarien“: alle Werte mit Downside,
Basis, Upside, einem Balken für die Spanne, Chance : Risiko (Upside geteilt durch den Betrag des Downside), dem
Break-even (Gewinnwachstum, das bei der Downside-Bewertung nötig wäre, damit kein Verlust bleibt), woher die Spanne
kommt (Gewinn oder Bewertung) und den Hinweisen. Filter und Chips der Tabelle gelten auch hier, Spalten lassen sich
sortieren. **Im Depot-Röntgen** stehen die drei Szenarien gewichtet nach deinen Positionen in Prozent und Euro und
welche Position den größten Teil des Downside trägt. In der **E-Mail** steht unter jeder Aktie eine Zeile wie
„Szenarien für vier Quartale: Downside −16 %, Basis +9 %, Upside +43 %“.

**Jede Woche neu:** Der Wochenlauf am Montag setzt die Szenarien automatisch auf die letzten Ist-Zahlen und Kurse auf.
Mit Live-Kursen rechnet das offene Panel mit dem aktuellen Kurs.

Beispiel-Memo (Demo-Daten), so ist jedes aufgebaut:

> **Szenario-Memo: SAP, vier Quartale bis Sep 2027**
> Stand 27.10.2026. Rechnung mit Annahmen, keine Prognose und keine Empfehlung.
>
> **Ausgangspunkt.** Die Rechnung setzt auf den zuletzt berichteten Zahlen bis 30.09.2026 auf. In den vier Quartalen
> davor hat SAP 6,16 EUR je Aktie verdient; beim Kurs von 197,00 EUR entspricht das einem KGV von 32,0.
> **Drei Szenarien.** Basis: Der Gewinn wächst wie vom Konsens erwartet um 8,2 %, das KGV bleibt gleich. Mit der
> Kursänderung und 0,8 % Dividende ergibt das +9 % bis Sep 2027. Upside: Der Gewinn wächst um 19,9 %, das KGV steigt
> um 18,6 %: +43 %. Downside: Der Gewinn schrumpft um 1,6 %, das KGV sinkt um 15,7 %: −16 %.
> **Was den Unterschied macht.** Zwischen Downside und Upside liegen 59 Prozentpunkte. Etwa 63 % davon gehen auf die
> Bewertung zurück, 37 % auf den Gewinn.
> **Break-even.** Fällt das KGV wie im Downside um 15,7 %, müsste der Gewinn um mindestens 17,7 % wachsen, damit unter
> dem Strich kein Verlust bleibt.
> **Am wenigsten belastbar.** Quartalszahlen am 03.11.2026: danach setzt die Rechnung auf die neuen Ist-Zahlen auf.
> **Nächster Schritt.** Der Wochenbericht setzt die Szenarien jeden Montag automatisch auf die letzten Ist-Zahlen auf.

Die Szenarien sind Rechnungen mit offen gelegten Annahmen, keine Prognose und keine Empfehlung. Im Downside der
Depot-Ansicht fallen alle Positionen zugleich ins schlechte Szenario, das zeigt eher die Obergrenze des Risikos.

### Erwartung zu den nächsten Earnings

Unter jedem Earnings-Termin steht in einem kleinen Feld, welche Veränderung die Analysten gegenüber dem
Vorjahresquartal erwarten, für Gewinn je Aktie (EPS) und Umsatz. Quelle ist der Analystenkonsens über
Yahoo Finance. Mit einem Finnhub-Schlüssel (GitHub-Secret `FINNHUB_API_KEY`) erscheint für US-Aktien
eine zweite Schätzung zum Abgleich. finanzen.net verbietet automatische Abrufe in seinen
Nutzungsbedingungen, und The Economist veröffentlicht keine Schätzungen je Unternehmen; beide sind
deshalb nicht eingebunden.

---

## 2. Auf dem eigenen Rechner ausprobieren

Voraussetzung: Python 3.11 oder neuer ([python.org](https://www.python.org/downloads/)).
Terminal im Projektordner öffnen, dann:

```bash
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt

python main.py --demo --keine-mail # Test mit simulierten Daten → site_demo/index.html
python main.py --keine-mail        # echte Daten von Yahoo   → site/index.html
python -m pytest                   # Tests laufen lassen (mit Node.js auch der Backtest-Rechenkern)
```

Die erzeugte `index.html` einfach im Browser öffnen und auf ein Unternehmen klicken.
Mit Live-Kursen: `python live.py --demo` (simuliert) bzw. `python live.py` (echt), siehe Abschnitt 4.
Die Schrift liegt im Projekt selbst, es werden keine Daten an Google Fonts übertragen.

---

## 3. Jede Woche automatisch (kostenlos über GitHub)

GitHub führt das Programm auf seinen Servern aus. Dein Rechner muss dafür nicht laufen.

### a) Repository anlegen
1. Konto auf [github.com](https://github.com) erstellen.
   Tipp: Als Student bekommst du über das [GitHub Student Developer Pack](https://education.github.com/pack)
   **GitHub Pro kostenlos**. Damit geht die Website auch aus einem *privaten* Repository.
2. Neues Repository anlegen, z. B. `wochenbericht`.
   - **Privat:** Niemand sieht deinen Code; für die Website brauchst du dann GitHub Pro (siehe oben).
   - **Öffentlich:** Funktioniert ohne Pro, aber jeder kann deine Watchlist sehen.
3. Dateien hochladen: am einfachsten mit [GitHub Desktop](https://desktop.github.com/) (Ordner auswählen → *Publish*).
   Beim Hochladen im Browser aufpassen: Der Ordner `.github` ist auf dem Mac versteckt.
   Notfalls im Browser *Add file → Create new file* wählen, als Namen
   `.github/workflows/wochenbericht.yml` eintippen und den Inhalt der Datei hineinkopieren.

### b) E-Mail-Zugang hinterlegen (Secrets)
Im Repository: **Settings → Secrets and variables → Actions → New repository secret**.
Lege diese fünf an:

| Name | Beispiel Gmail | Beispiel GMX |
|---|---|---|
| `SMTP_HOST` | `smtp.gmail.com` | `mail.gmx.net` |
| `SMTP_PORT` | `465` | `587` |
| `SMTP_USER` | `deine.adresse@gmail.com` | `deine.adresse@gmx.de` |
| `SMTP_PASSWORT` | App-Passwort (siehe unten) | dein Passwort |
| `MAIL_AN` | Empfängeradresse | Empfängeradresse |

- **Gmail:** Unter [myaccount.google.com](https://myaccount.google.com) → *Sicherheit* zuerst die
  2-Schritt-Bestätigung einschalten, dann ein **App-Passwort** erzeugen und dieses (nicht dein normales Passwort) eintragen.
- **GMX / web.de:** Im Postfach unter *Einstellungen → POP3/IMAP* den Zugriff über externe Programme erlauben.
- Secrets sind verschlüsselt. Sie tauchen nie im Code oder in den Logs auf.
- Ohne Secrets läuft alles trotzdem, dann nur ohne E-Mail.

### c) Website einschalten (optional)
1. **Settings → Pages → Build and deployment → Source: „GitHub Actions“**
2. **Settings → Secrets and variables → Actions → Reiter „Variables“ → New repository variable**:
   Name `PAGES_AKTIV`, Wert `true`
3. Nach dem ersten Lauf steht die Adresse unter *Settings → Pages* (z. B. `https://deinname.github.io/wochenbericht/`).
   Trag sie in `config.yaml` bei `website_url` ein, dann enthält die E-Mail einen Link dorthin.

> Hinweis: Eine GitHub-Pages-Website ist für jeden erreichbar, der die Adresse kennt.
> Trag deshalb keine persönlichen Depotbeträge in den Bericht ein.

### d) Testen
Reiter **Actions → Wochenbericht → Run workflow** (auf dem Branch `main`; auf anderen Branches tut der Workflow
absichtlich nichts). Nach ca. 2 Minuten sollte die E-Mail da sein.
Ab dann läuft es **jeden Montag gegen 7 Uhr** von selbst. Schlägt ein Lauf fehl
(z. B. weil Yahoo etwas geändert hat), schickt GitHub dir automatisch eine Benachrichtigung.

### e) Änderungen vorher gefahrlos testen (Staging)
Der Workflow **Staging** baut die Website bei jedem Push auf den Branch `staging` und bei jedem Pull Request mit
Beispieldaten, prüft sie und stellt sie als Download bereit. Er verschickt keine E-Mail, schreibt nichts ins Repository
und veröffentlicht nichts auf der Live-Website. Ablauf, Freigabe und Rücknahme stehen in [DEPLOYMENT.md](DEPLOYMENT.md).

---

## 4. Live-Kurse

Ohne Live-Quelle zeigt die Seite die Schlusskurse vom Tag des Wochenberichts. Es gibt zwei
Live-Quellen, die sich ergänzen. Den Zustand siehst du oben rechts auf der Seite
(„Wochenstand“ oder „Live 18:31:05“, die Uhr läuft dann sekündlich weiter). Ein Klick darauf öffnet die Einstellungen.

**a) Lokaler Live-Server, alle Werte (Yahoo Finance)**

```bash
python live.py          # echte Kurse, öffnet http://localhost:8000
python live.py --demo   # simulierte Kurse zum Ausprobieren
```

Der Server läuft nur auf deinem Rechner. Er holt alle 30 Sekunden die Kurse aller Werte
der Watchlist und zeigt dazu den Tagesverlauf im Panel. US-Kurse kommen bei Yahoo nahezu in
Echtzeit, Xetra und Hongkong je nach Börse bis zu 15 Minuten verzögert. Beenden mit Strg+C.

**b) Finnhub, echte Echtzeit für US-Aktien (auch auf der GitHub-Website)**

1. Kostenloses Konto auf [finnhub.io](https://finnhub.io) anlegen und den API-Schlüssel kopieren.
2. Auf der Website oben rechts auf den Live-Status klicken, Schlüssel eintragen und speichern.

Ab dann kommt jeder Handel von Adobe, ServiceNow, Salesforce, Microsoft und Nvidia sofort
an. Der Schlüssel wird nur in deinem Browser gespeichert, nie im Code oder bei GitHub.
Läuft zusätzlich der lokale Server, liefert Finnhub die US-Werte und Yahoo den Rest.
SAP, Zijin und der ETF sind bei Finnhub kostenlos nicht verfügbar.

> Die Signale und ihre Balken werden mit Live-Kursen neu berechnet (Large Cap, Pullback, Valuation Gap).
> Die Sortierung und der Satz oben bleiben auf dem Stand des Wochenberichts.

---

**c) Nachrichten und Kalender live (Work-Modus)**

`python live.py` holt im Hintergrund Nachrichten und hält den Kalender aktuell. Die Schlüssel nur als
Umgebungsvariablen setzen, nie in eine Datei im Projekt:

```bash
export FINNHUB_API_KEY="dein-schlüssel"          # Nachrichten und Zahlentermine (kostenlos, finnhub.io)
export SEC_KONTAKT="Fathom deine@adresse.de"     # optional: Pflichtmitteilungen 8-K, die SEC verlangt einen Absender
export BLS_API_KEY="dein-schlüssel"              # optional: Ist-Werte alle 15 statt 60 Sekunden (kostenlos, bls.gov)
export ANTHROPIC_API_KEY="dein-schlüssel"        # optional: Chart-Taktik mit KI deuten (console.anthropic.com)
export FATHOM_KI_MODELL="claude-sonnet-5-5"      # optional: anderes Modell für die KI-Deutung
python live.py
```

Unter Windows (PowerShell) `$env:FINNHUB_API_KEY="dein-schlüssel"` statt `export`. Ohne live.py reicht für die
Nachrichten auch der Finnhub-Schlüssel im Browser (wie bei den Live-Kursen); Fed, EZB, SEC und die Ist-Werte der BLS
gibt es nur über live.py, weil Browser Abfragen an diese fremden Seiten in der Regel blockieren.

**d) Suchen und zur Watchlist hinzufügen**

Mit laufendem `python live.py` öffnet die Lupe oben rechts (oder die Taste `/`) die Suche. Sie findet
Aktien und ETFs, die an einer deutschen Börse notiert sind (Xetra, Frankfurt, Stuttgart, München, Berlin,
Düsseldorf, Hamburg, Hannover); was dort gelistet ist, ist bei Scalable Capital und Trade Republic in
aller Regel handelbar. Währungen, Rohstoffe und Indizes erscheinen immer. Suchen kannst du nach Name,
Kürzel oder ISIN. „Hinzufügen“ schreibt den Wert in `config.yaml`, erstellt die Analyse im Hintergrund
neu und lädt die Seite danach. Im Panel jedes Werts gibt es „Von der Watchlist entfernen“.
Auf der GitHub-Website funktioniert nur die Suche in der eigenen Watchlist; damit neue Werte auch im
Montagsbericht auftauchen, die geänderte `config.yaml` hochladen (z. B. mit GitHub Desktop).

## Sicherheit

Was die Seite und der lokale Server zum Schutz tun (Stand 28.10.2026, mit Tests in `tests/test_logik.py` und
`tests/test_haertung.py`; Befunde des letzten Audits in [AUDIT.md](AUDIT.md), Meldewege in [SECURITY.md](SECURITY.md)):

| Bereich | Schutz |
|---|---|
| Lokaler Server `live.py` | lauscht nur auf 127.0.0.1; akzeptiert nur die Hosts `localhost`, `127.0.0.1` und `[::1]` (gegen DNS-Rebinding: eine fremde Domain, die auf deinen Rechner zeigt, bekommt 421) |
| Änderungen an der Watchlist | nur mit Herkunft genau dieser Seite (Origin oder `Sec-Fetch-Site: same-origin`) und als JSON; kein CORS, keine Vorabfrage erlaubt (gegen CSRF); Anfragen über 64 KB, negative Längen und Nicht-Objekte werden abgewiesen |
| Eingaben | Kürzel nur aus Buchstaben, Ziffern und `.-=^&`; Namen ohne Steuer- und Zeilentrennzeichen, damit `config.yaml` nicht zerlegt werden kann |
| Antworten | Content-Security-Policy, `X-Frame-Options: DENY` (gegen Clickjacking), `nosniff`, `Referrer-Policy: no-referrer`, keine Ordnerlisten, keine Versionsnummern, Fehlertexte ohne interne Details |
| Website (auch GitHub Pages) | Content-Security-Policy als `meta`: nur eigene Skripte, keine Inline-Skripte; Ausnahmen nur Finnhub (Live-Kurse) und TradingView (erst nach Klick) |
| Nachrichten | Links aus Feeds nur mit `http(s)://` (kein `javascript:`), Texte immer als Text eingefügt; Antworten über 5 MB werden verworfen |
| Schlüssel | API-Schlüssel nur als Umgebungsvariable oder GitHub Secret; Finnhub im Header `X-Finnhub-Token` statt in der Adresse; im Browser nur lokal gespeichert und nur auf ausdrücklichen Wunsch in der Sicherung |
| Konto-Sicherung | Einspielen nur bekannter Einträge mit geprüftem Inhalt; Test-Adressen für Finnhub und die TradingView-Zustimmung werden nie übernommen |
| Chart-Taktik und KI | Zeichnungen und Regeln werden beim Laden und nach jeder KI-Antwort geprüft (nur bekannte Bedingungen, Kürzel und Zahlen); `/api/taktik` nur von dieser Seite, höchstens eine Anfrage gleichzeitig; an die KI gehen nur Text und Zeichnungen |
| GitHub Actions | standardmäßig keine Rechte, je Job nur das Nötige; Actions auf feste Commits gepinnt; Token nicht in `.git` gespeichert; Dependabot für Updates; der Production-Workflow läuft nur auf dem Standard-Branch |
| Umgebungen | `FATHOM_UMGEBUNG` = `production`, `staging` oder `development`; Staging verschickt nie E-Mails (zweifach gesperrt), schreibt nicht in `data/`, setzt `noindex` und ein Hinweisband; ein unbekannter Wert bricht ab |
| Kosten | KI-Deutung höchstens 100-mal in 24 Stunden (`FATHOM_KI_LIMIT_TAG`), Suche höchstens 30-mal je Minute, Minuten- und Stundenkerzen (`/api/kerzen`) höchstens 30 Abrufe je Minute, ein Abruf gleichzeitig, je Kürzel und Intervall 1 bis 30 Minuten zwischengespeichert |
| Abhängigkeiten | GitHub Actions installiert aus `requirements.lock` mit Prüfsummen (`--require-hashes`) |
| Logs | Werte aller bekannten Secrets und Schlüssel in Adressen (`api_key=`, `apikey=`, `token=`) werden geschwärzt; Antworten aus dem Netz über 20 MB werden verworfen |

Grenzen: Was im Browser gespeichert ist (Finnhub-Schlüssel, Portfolio), kann jede Erweiterung mit Zugriff auf die
Seite lesen. GitHub Pages erlaubt keine eigenen Kopfzeilen; Schutz vor Einbetten in fremde Seiten gibt es dort nur
über die Policy im Browser, nicht über `frame-ancestors`. Ist das Repository öffentlich, sind Watchlist und Historie
öffentlich. Sicherheitslücken bitte nicht als öffentliches Issue melden (siehe [SECURITY.md](SECURITY.md)).

## 5. Anpassen

- **Watchlist ändern:** in `config.yaml` Zeilen hinzufügen oder löschen. Kürzel findest du auf
  [finance.yahoo.com](https://finance.yahoo.com) (Xetra-Werte enden auf `.DE`, Hongkong auf `.HK`).
- **Signale strenger/lockerer:** Grenzwerte in `config.yaml` ändern.
- **Anderer Wochentag/Uhrzeit:** `cron` in `.github/workflows/wochenbericht.yml`
  (Format: Minute Stunde Tag Monat Wochentag, Zeit in UTC).
- **Dein ACWI-ETF:** Der Eintrag `IUSQ.DE` ist ein Platzhalter. Trag das Kürzel deines tatsächlichen ETFs ein.

---

## 6. Ideen zum Weiterbauen (gut fürs Studium und den Lebenslauf)

- **Eigene Auswertung:** `data/historie.csv` wächst jede Woche. Nach einigen Monaten kannst du mit pandas
  prüfen, ob Werte mit 4/4 Punkten danach wirklich besser liefen als der ACWI.
  Achtung bei der Interpretation: kleine Stichprobe, nur eine Marktphase.
- **Weitere Kennzahlen:** Free-Cashflow-Rendite, PEG-Ratio, Verschuldung (`yfinance` liefert Bilanzdaten).
- **Einfaches DCF-Modell** pro Aktie, das einen fairen Wert schätzt und mit dem Kurs vergleicht.
- **Diagramme** (matplotlib) als Bild in die E-Mail einbetten.

## Grenzen

- `yfinance` ist eine inoffizielle Schnittstelle zu Yahoo Finance. Sie ist kostenlos, kann aber zeitweise
  ausfallen oder sich ändern. Dann hilft meist `pip install -U yfinance`.
- „Quartalswachstum“ kommt direkt von Yahoo und ist nicht immer mit den Konzernberichten deckungsgleich.
  Vor jeder Entscheidung die Originalzahlen prüfen.
- Ein niedriges KGV heißt nicht automatisch „unterbewertet“. Oft erwartet der Markt schlicht weniger Wachstum.
- **Datenlizenzen:** Auf der öffentlichen Website stehen Kurse und Kennzahlen von Yahoo, Eulerpool und Finnhub.
  Ob deren Bedingungen eine Veröffentlichung erlauben, musst du selbst prüfen (Yahoo: nur persönliche Nutzung).
  Im Zweifel Pages abschalten und die Seite lokal mit `python live.py` nutzen.
- Die Szenarien rechnen mit Konsensschätzungen, einer typischen Bewertungsänderung und der Schwankung der
  Vergangenheit. Wechselkurse, Zinsen und Zusammenhänge zwischen den Werten sind nicht modelliert.
