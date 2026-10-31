# Deployment: Development, Staging, Production

## Die drei Umgebungen

| | Development | Staging | Production |
|---|---|---|---|
| Wo | dein Rechner | GitHub Actions, Workflow **Staging** (`.github/workflows/staging.yml`) | GitHub Actions, Workflow **Wochenbericht** (`.github/workflows/wochenbericht.yml`) |
| Auslöser | `python main.py …`, `python live.py` | Push auf `staging` oder `security-hardening`, jeder Pull Request, „Run workflow“ | Montag 05:17 UTC und „Run workflow“, **nur auf `main`** |
| `FATHOM_UMGEBUNG` | `development` (Standard) | `staging` | `production` |
| Daten | echt oder `--demo` | Beispieldaten; echte nur per „Run workflow → daten: echt“ mit eigenen `STAGING_*`-Schlüsseln | echt |
| E-Mail | wenn SMTP-Variablen gesetzt sind | **nie** (im Code gesperrt, SMTP-Secrets werden nicht übergeben) | ja |
| Schreibt `data/` | ja (ohne `--demo`) | **nie** (im Code gesperrt, Workflow prüft mit `git diff --exit-code`) | ja, als Commit auf `main` |
| Website | `site/` bzw. `site_demo/`, lokal | `site_staging/` als Download, optional separates Vorschau-Repository; `noindex`, `robots.txt`, Hinweisband | GitHub Pages (wenn `PAGES_AKTIV=true`) |
| Rechte im Repository | – | nur lesen | schreiben (`contents`), Pages |

Staging kann Production technisch nicht verändern: Der Job hat nur Leserechte, bekommt keine SMTP-Secrets und kein
Pages-Recht. Eine Staging-Website ist an `noindex`, `robots.txt`, dem dunklen Band oben („Staging · Testumgebung“) und an
„[Staging]“ im Titel des Browser-Tabs zu erkennen.

## Branches

- `main`: Production. Nur über Pull Requests ändern.
- `staging`: optionaler Sammel-Branch zum Ausprobieren; jeder Push baut eine Staging-Website.
- Feature-Branches (z. B. `security-hardening`): Pull Request gegen `main` öffnen; der Staging-Workflow läuft
  automatisch auf dem Pull Request.

## Einmalige Einrichtung in GitHub (von Hand, nicht automatisch erledigt)

1. **Änderungen einspielen** (in deinem lokalen Klon des Repositorys, nicht direkt auf `main`):
   ```
   git checkout main && git pull
   git checkout -b security-hardening
   git am /pfad/zu/fathom-security-hardening.patch
   git push -u origin security-hardening
   ```
   Danach auf GitHub einen Pull Request `security-hardening → main` öffnen. Noch **nicht** mergen.
2. **Pages auf `main` beschränken:** Settings → Environments → `github-pages` → Deployment branches and tags →
   „Selected branches and tags“ → nur `main`. (Zweite Sicherung neben der Bedingung im Workflow.)
3. **`main` schützen:** Settings → Branches (bzw. Rules → Rulesets) → Regel für `main`: Pull Request erforderlich,
   Status-Check „Staging / bauen“ muss grün sein, Force-Push und Löschen verbieten.
4. **Optional, echte Daten in Staging:** eigene Schlüssel als Repository-Secrets mit dem Präfix `STAGING_` anlegen
   (Liste unten). Am besten eigene, kostenlose Schlüssel bzw. das OANDA-Übungskonto. Fehlt ein Staging-Schlüssel,
   fällt die Quelle in Staging einfach weg; der Production-Schlüssel wird nie benutzt.
5. **Optional, Online-Vorschau:** ein **separates** Repository anlegen (z. B. `fathom-staging`), dort Pages mit
   Quelle „Deploy from a branch → `gh-pages`“ einschalten. Ein fine-grained Personal Access Token erzeugen, das nur auf
   dieses eine Repository Zugriff hat (Contents: Read and write), und im Production-Repository hinterlegen: Variable
   `STAGING_REPO` = `deinname/fathom-staging`, Secret `STAGING_DEPLOY_TOKEN`. Die Vorschau ist öffentlich erreichbar
   (aber `noindex`); darum standardmäßig nur mit Beispieldaten nutzen.

## Weg zu Production (Freigabe)

1. Pull Request öffnen → Workflow **Staging** läuft: Tests, Website mit Beispieldaten bauen, Smoke-Test
   (`tools/website_pruefen.py`), Kontrolle, dass `data/`, `site/` und `config.yaml` unverändert sind.
2. Unter dem Lauf das Artefakt **site-staging** herunterladen, entpacken und lokal öffnen:
   `python -m http.server -d site_staging 8000 --bind 127.0.0.1` → http://127.0.0.1:8000
3. Von Hand prüfen (dauert etwa 5 Minuten):
   - Übersicht lädt, Kacheln und Panels öffnen sich, Charts erscheinen
   - Dock: Work, Backtest (einen Backtest rechnen), Kriterien, Protokoll, Journal mit Trading-Kalender,
     Termine, Alarme, Depot, Konto
   - hell und dunkel, schmales Fenster (Handy-Breite)
   - Browser-Konsole ohne Fehler
4. Optional: „Run workflow“ im Staging-Workflow mit `daten: echt`, wenn Datenquellen betroffen sind.
5. Pull Request mergen. Production baut beim nächsten Montagslauf. Sofort veröffentlichen: Actions → Wochenbericht →
   Run workflow auf `main` (**verschickt dabei die echte E-Mail**).
6. Nach dem Lauf die Live-Website kurz öffnen (Punkte aus Schritt 3).

## Rücknahme (Rollback)

| Was | Schritte |
|---|---|
| Code-Änderung | Auf GitHub im gemergten Pull Request „Revert“ klicken (erzeugt einen neuen Pull Request, der alles zurücknimmt), mergen, dann Actions → Wochenbericht → Run workflow. Lokal gleichwertig: `git revert -m 1 <merge-commit>` und Push über einen Pull Request. |
| Nur Abhängigkeiten | `requirements.lock` auf den vorigen Stand zurücksetzen (`git checkout <commit> -- requirements.lock`), Pull Request. |
| Daten in `data/` | `data/historie.csv` und `data/signale.json` sind Woche für Woche versioniert: `git checkout <commit> -- data/` und committen. Nichts wird gelöscht; der falsche Stand bleibt in der Historie nachvollziehbar. |
| Website im Notfall sofort offline | Settings → Pages → „Unpublish site“. Wieder online: Run workflow auf `main`. |
| Staging | Nichts zurückzunehmen; Staging schreibt nirgends hin. Vorschau-Repository bei Bedarf löschen. |

Was ein Rollback nicht zurückholt: verschickte E-Mails und Daten im Browser der Nutzerinnen und Nutzer
(`localStorage`). Letztere lassen sich nur über eine vorher gespeicherte Kontosicherung (Konto → Sicherung) wiederherstellen.

## Kosten

- Öffentliche Repositorys: GitHub Actions auf Standard-Runnern kostenlos. Private Repositorys: Minuten zählen gegen
  das monatliche Freikontingent deines Plans; wie viel davon verbraucht ist, steht unter Settings → Billing (die
  aktuelle Höhe des Kontingents habe ich nicht überprüft).
- Ein Staging-Lauf dauert geschätzt 3 bis 6 Minuten (Installation, rund 75 Python- und 55 Node-Tests, Bau mit
  Beispieldaten). Nicht in GitHub gemessen, nur lokal: Tests etwa 1:40 min, Bau mit Beispieldaten unter 1 min.
- Staging mit echten Daten nutzt nur kostenlose Stufen (bzw. die Staging-Schlüssel). Anthropic wird in keinem
  Workflow aufgerufen.

## Umgebungsvariablen (ohne Werte)

| Variable | Art | Production | Staging | Lokal |
|---|---|---|---|---|
| `FATHOM_UMGEBUNG` | im Workflow fest | `production` | `staging` | optional |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORT`, `MAIL_AN` | Secret | ja | **nie** | optional |
| `EULERPOOL_API_KEY` | Secret | ja | `STAGING_EULERPOOL_API_KEY` | optional |
| `FINNHUB_API_KEY` | Secret | ja | `STAGING_FINNHUB_API_KEY` | optional |
| `OANDA_API_TOKEN` | Secret | ja | `STAGING_OANDA_API_TOKEN` | optional |
| `OANDA_UMGEBUNG` | Variable | `vars.OANDA_UMGEBUNG` | immer `practice` | optional |
| `FRED_API_KEY` | Secret | ja | `STAGING_FRED_API_KEY` | optional |
| `TRADINGECONOMICS_API_KEY` | Secret | ja | `STAGING_TRADINGECONOMICS_API_KEY` | optional |
| `FMP_API_KEY` | Secret | ja | `STAGING_FMP_API_KEY` | optional |
| `BLS_API_KEY`, `SEC_KONTAKT` | lokal | – | – | optional (`live.py`) |
| `ANTHROPIC_API_KEY`, `FATHOM_KI_MODELL`, `FATHOM_KI_LIMIT_TAG` | lokal | – | – | optional (`live.py`) |
| `PAGES_AKTIV` | Variable | `true` für Pages | – | – |
| `STAGING_REPO` | Variable | – | optional (Vorschau) | – |
| `STAGING_DEPLOY_TOKEN` | Secret | – | optional (Vorschau) | – |

Vorlage für lokal: `.env.example` (nach `.env` kopieren; `.env` und `.env.*` sind in `.gitignore`).
