/* Fathom: Chart-Taktik im Backtest-Fenster (Reiter „Chart-Taktik“).
 *
 * Kerzenchart eines Werts mit Zeichenwerkzeugen wie in gängigen Charttools: waagerechte Linie, Strahl, Trendlinie,
 * senkrechte Linie, Rechteck (Zone), paralleler Kanal, Fibonacci-Retracement, Long- und Short-Position. Dazu
 * Indikatoren im Chart und darunter: SMA, EMA, Bollinger-Bänder, RSI, MACD, ATR.
 * Oben über dem Chart: Wert suchen (Watchlist, Backtest-Katalog, mit python live.py jeder Wert von Yahoo Finance) und
 * Kerzen von 1 Minute bis 1 Monat. Tag, Woche und Monat gibt es immer; Stundenkerzen für Werte mit OANDA-Daten,
 * Minuten- und Stundenkerzen jedes Werts über python live.py (api/kerzen, Yahoo Finance mit begrenztem Zeitraum).
 * Zoomen mit Mausrad, Trackpad oder zwei Fingern; an der Preisachse ziehen skaliert die Höhe, an der Zeitachse die Breite.
 * Darunter beschreibst du deine Taktik in Worten („Kaufe, wenn der Kurs über L1 schließt und der RSI über 50 ist.“).
 * assets/taktik-kern.js macht daraus Regeln, zeigt sie zur Kontrolle an und rechnet sie auf allen Kerzen zurück.
 * Optional deutet eine KI die Beschreibung (nur über python live.py mit ANTHROPIC_API_KEY).
 * Eine getestete Taktik lässt sich als Setup speichern (assets/setups.js): mit Zeitstempel, Versionen und Bewährungsprobe.
 * Zeichnungen, Indikatoren und Text bleiben nur in diesem Browser (fathom.taktik).
 */
(function () {
  "use strict";
  const T = window.WBTaktik, KZ = window.WBKerzen;
  if (!T || !KZ) return;
  const { $, $$, esc, lies, schreib, nf, minus, zahl } = window.WBH;
  const pct = (x, d = 1) => (x == null || !isFinite(x) ? "–" : minus((x > 0 ? "+" : "") + nf(d).format(x * 100)) + " %");
  const ton = (x) => (x == null || !isFinite(x) || Math.abs(x) < 1e-6 ? "" : x > 0 ? "plus" : "minus");
  const datum = (t, kurz) => { const d = new Date(Math.floor(t) * 864e5); return d.toLocaleDateString("de-DE", kurz ? { day: "2-digit", month: "2-digit", year: "2-digit", timeZone: "UTC" } : { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }); };
  const MONATE = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
  const EB = T.EBENEN;
  const intra = (e) => EB[T.ebeneOk(e || zustand.ebene)].n < 1440;
  // Zeitpunkt als Text: ab Tageskerzen das Datum (UTC-Handelstag), darunter Datum und Uhrzeit in Ortszeit des Browsers
  const ZEIT_KURZ = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
  const ZEIT_LANG = new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const zeitText = (t, kurz, e) => (intra(e) ? (kurz ? ZEIT_KURZ : ZEIT_LANG).format(new Date(t * 864e5)).replace(",", "") : datum(t, kurz));
  const dauerText = (tage) => (tage == null || !isFinite(tage) ? "–" : tage >= 1 ? `${zahl(tage, 1)} Tage` : tage * 24 >= 1 ? `${zahl(tage * 24, 1)} Std.` : `${zahl(tage * 1440, 0)} Min.`);
  const TYPNAME = { aktie: "Aktie", etf: "ETF", forex: "Währung", rohstoff: "Rohstoff", index: "Index" };
  // So viele Kerzen zeigt der Chart nach dem Laden (die jüngsten)
  const STANDARD_SPANNE = { "1m": 180, "5m": 160, "15m": 160, "1h": 160, "4h": 150, tag: 160, woche: 104, monat: 72 };
  const MIN_SPANNE = 12;
  const SCHLUESSEL = "fathom.taktik";
  // [Werkzeug, Titel mit Taste, Symbol]
  const WERKZEUGE = [
    ["zeiger", "Auswählen und verschieben (V)", '<path d="M5 3l13 8-6 1.5L9.5 19z"/>'],
    ["linie", "Waagerechte Linie (H)", '<path d="M3 12h18"/><circle cx="12" cy="12" r="2" class="voll"/>'],
    ["strahl", "Waagerechter Strahl (J)", '<circle cx="5" cy="12" r="2" class="voll"/><path d="M5 12h15M16 8.5l4 3.5-4 3.5"/>'],
    ["trend", "Trendlinie (T)", '<path d="M4 19 20 5"/><circle cx="4" cy="19" r="2" class="voll"/><circle cx="20" cy="5" r="2" class="voll"/>'],
    ["senkrecht", "Senkrechte Linie (I)", '<path d="M12 3v18"/><circle cx="12" cy="12" r="2" class="voll"/>'],
    ["zone", "Rechteck / Zone (R)", '<rect x="4" y="7" width="16" height="10" rx="1.5"/>'],
    ["kanal", "Paralleler Kanal (K)", '<path d="M3 15 15 5M9 21 21 11"/><path d="M6 18 18 8" class="duenn"/>'],
    ["fib", "Fibonacci-Retracement (F)", '<path d="M3 4h18M3 9h18M3 13h18M3 16h18M3 20h18" class="duenn"/><path d="M5 20 19 4"/>'],
    ["long", "Long-Position (L)", '<rect x="5" y="4" width="14" height="9" rx="1.5" class="plus"/><rect x="5" y="13" width="14" height="6" rx="1.5" class="minus"/>'],
    ["short", "Short-Position (S)", '<rect x="5" y="5" width="14" height="6" rx="1.5" class="minus"/><rect x="5" y="11" width="14" height="9" rx="1.5" class="plus"/>'],
  ];
  const TASTEN = { v: "zeiger", h: "linie", j: "strahl", t: "trend", i: "senkrecht", r: "zone", k: "kanal", f: "fib", l: "long", s: "short" };
  const ZWEI_PUNKTE = ["trend", "zone", "kanal", "fib"];
  const BEISPIEL = "Kaufe, wenn der Kurs über L1 schließt. Stop unter Z1, Ziel 2R. Spätestens nach 20 Tagen raus.";
  const IND_MENUE = [
    ["sma", "SMA", "Einfacher gleitender Durchschnitt", [["n", "Länge", 50, 2, 400]]],
    ["ema", "EMA", "Exponentieller gleitender Durchschnitt", [["n", "Länge", 20, 2, 400]]],
    ["bb", "Bollinger", "Bollinger-Bänder: Durchschnitt ± Standardabweichung", [["n", "Länge", 20, 2, 400], ["k", "Faktor", 2, 0.5, 5, 0.1]]],
    ["rsi", "RSI", "Relative Stärke (Wilder), 0 bis 100", [["n", "Länge", 14, 2, 100]]],
    ["macd", "MACD", "MACD-Linie, Signallinie und Histogramm", [["schnell", "Schnell", 12, 2, 100], ["langsam", "Langsam", 26, 3, 200], ["signal", "Signal", 9, 2, 100]]],
    ["atr", "ATR", "Average True Range (Wilder), z. B. für Stops", [["n", "Länge", 14, 2, 100]]],
  ];
  const IM_CHART = ["sma", "ema", "bb"];   // die anderen bekommen ein eigenes Feld unter dem Chart

  /* ================================================================ Zustand */
  let zustand = (() => { try { return JSON.parse(lies(SCHLUESSEL)); } catch (e) { return null; } })();
  if (!zustand || typeof zustand !== "object") zustand = {};
  zustand = { wert: typeof zustand.wert === "string" ? zustand.wert : "", ebene: T.ebeneOk(zustand.ebene),
    kosten: [0, 0.0005, 0.001, 0.0025].includes(zustand.kosten) ? zustand.kosten : 0.0005, nurDanach: !!zustand.nurDanach,
    hoehe: Number.isInteger(zustand.hoehe) && zustand.hoehe >= 240 && zustand.hoehe <= 1000 ? zustand.hoehe : null,
    werte: zustand.werte && typeof zustand.werte === "object" && !Array.isArray(zustand.werte) ? zustand.werte : {} };
  const herkunftOk = (h) => (h && typeof h.id === "string" && /^s[a-z0-9]{6,24}$/.test(h.id) && Number.isInteger(h.nr) ? { id: h.id, nr: h.nr } : null);
  function wertZustand(w) {
    w = w && typeof w === "object" ? w : {};
    const z = T.pruefeZeichnungen(w.zeichnungen);
    return { zeichnungen: z, indikatoren: T.pruefeIndikatoren(w.indikatoren), text: typeof w.text === "string" ? w.text.slice(0, 4000) : "",
             regeln: w.regeln ? T.pruefe(w.regeln, z) : null, setup: herkunftOk(w.setup) };
  }
  Object.keys(zustand.werte).forEach((s) => {
    if (!/^[A-Za-z0-9.\-=^&]{1,24}$/.test(s)) { delete zustand.werte[s]; return; }
    zustand.werte[s] = wertZustand(zustand.werte[s]);
  });
  const sichern = () => schreib(SCHLUESSEL, JSON.stringify(zustand));
  const akt = () => (zustand.werte[zustand.wert] = zustand.werte[zustand.wert] || wertZustand({}));

  let wurzel = null, daten = null, k = null, w = null;
  let sicht = { i0: 0, i1: 100 }, werkzeug = "zeiger", magnet = true, auswahl = null, entwurf = null, ziehen = null, ergebnis = null, deutung = null;
  let kiDa = null, kerzenDa = null, menueOffen = false, sucheOffen = false;
  let preisSkala = null;  // null = Preisachse passt sich den sichtbaren Kerzen an, sonst { lo, hi } von Hand

  /* ================================================================ Kerzen laden (je Wert und Zeitraum) */
  // Fragt einmal, ob python live.py läuft und was er kann (KI-Deutung, Minuten- und Stundenkerzen über api/kerzen)
  let statusLauf = null;
  function statusPruefen() {
    if (!statusLauf) {
      statusLauf = (window.WBH.serverMoeglich() ? fetch("api/status", { cache: "no-store" }).then((r) => (r.ok ? r.json() : {})).catch(() => ({})) : Promise.resolve({}))
        .then((j) => { kiDa = !!(j && j.ki); kerzenDa = !!(j && j.kerzen); return j; });
    }
    return statusLauf;
  }
  const hatStunden = (ww) => !!(ww && ww.iUrl && !ww.iFehler);
  // Warum ein Zeitraum für diesen Wert nicht geht (null = geht)
  function ebeneHindernis(eb, ww) {
    ww = ww || w;
    if (EB[eb].n >= 1440) return null;
    if ((eb === "1h" || eb === "4h") && hatStunden(ww)) return null;
    if (kerzenDa) return null;
    return EB[eb].n < 60 ? "Minutenkerzen kommen von Yahoo Finance und gibt es nur mit dem lokalen Server (python live.py)."
      : `Stundenkerzen gibt es hier für Devisen, Rohstoffe und Indizes mit OANDA-Daten. Für ${ww ? ww.name : "diesen Wert"} gibt es sie mit dem lokalen Server (python live.py).`;
  }
  const kerzenSpeicher = new Map();  // "Kürzel|Zeitraum" → { k, bis (Zeitpunkt, ab dem neu geladen wird; 0 = nie) }
  function kerzenFuer(ww, eb) {
    eb = T.ebeneOk(eb);
    const schl = `${ww.s}|${eb}`, alt = kerzenSpeicher.get(schl);
    if (alt && (!alt.bis || Date.now() < alt.bis)) return Promise.resolve(alt.k);
    const fertig = (kk, quelle, fenster, frisch) => {
      if (!kk || kk.c.length < 3) throw new Error(`Für ${ww.name} gibt es zu wenige ${EB[eb].kerzen}.`);
      kk.quelle = quelle || null; kk.fenster = fenster || null;
      kerzenSpeicher.set(schl, { k: kk, bis: frisch ? Date.now() + frisch : 0 });
      return kk;
    };
    if (EB[eb].n >= 1440) {
      const tag = { tag: ww.tag, o: ww.o, h: ww.h, l: ww.l, c: ww.c };
      return Promise.resolve(fertig(eb === "tag" ? tag : T.fasse(tag, eb), ww.quelle, null, 0));
    }
    // Stundenkerzen (t in Minuten) → Kommatage; 4 Stunden je Handelssitzung zusammengefasst
    const ausStunden = (r, quelle, fenster, frisch) => {
      const h = { tag: Float64Array.from(r.t, (m) => m / 1440), o: r.o, h: r.h, l: r.l, c: r.c };
      return fertig(eb === "4h" ? T.fasse(h, 240) : h, quelle, fenster, frisch);
    };
    const vomServer = () => statusPruefen().then(() => {
      if (!kerzenDa) throw new Error(ebeneHindernis(eb, ww) || `Keine ${EB[eb].kerzen}.`);
      return fetch("api/kerzen", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol: ww.s, intervall: eb === "4h" ? "1h" : eb, anker: ww.c[ww.c.length - 1] }) })
        .then((r) => r.json().catch(() => ({})).then((j) => { if (!r.ok) throw new Error(j.fehler || `Fehler ${r.status}`); return j; }))
        .then((j) => {
          const KB = window.WBBacktestKern;
          const gueltig = j && Array.isArray(j.c) && Array.isArray(j.dt) && j.c.length >= 3 && j.dt.length === j.c.length - 1 && Number.isInteger(j.dez)
            && j.dez >= 0 && j.dez <= 8 && Number.isFinite(j.t0) && ["o", "h", "l"].every((f) => Array.isArray(j[f]) && j[f].length === j.c.length);
          if (!gueltig || !KB || !KB.reiheAus) throw new Error("Keine gültigen Kerzen erhalten.");
          return ausStunden(KB.reiheAus(j, j.dez, 1), String(j.q || "Yahoo Finance").slice(0, 60), j.fenster ? String(j.fenster).slice(0, 20) : null, 5 * 60e3);
        });
    });
    if ((eb === "1h" || eb === "4h") && hatStunden(ww) && window.WBBacktest) {
      return window.WBBacktest.intradayLaden([ww]).then(() => {
        if (ww.std && ww.std.n > 2) return ausStunden(ww.std, ww.quelle, null, 0);
        if (kerzenDa) return vomServer();
        throw new Error(`Die Stundenkerzen für ${ww.name} ließen sich nicht laden.`);
      });
    }
    return vomServer();
  }

  /* ================================================================ Aufbau */
  const LUPE = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6"/><path d="M16 16l4 4"/></svg>';
  function zeigen(el, d) {
    wurzel = el; daten = d;
    const alle = daten.werte;
    if (!alle.some((x) => x.s === zustand.wert)) zustand.wert = (alle.find((x) => x.typ === "aktie") || alle[0] || {}).s || "";
    el.innerHTML = `
      <div class="tl">
        <form class="tl-seite" novalidate autocomplete="off">
          <p class="bt-einleitung">Zeichne deine Taktik in den Kerzenchart: <b>Linien</b>, <b>Strahlen</b>, <b>Trendlinien</b>, <b>Zonen</b>, <b>Kanäle</b>,
            <b>Fibonacci</b> und <b>Positionen</b>, dazu <b>Indikatoren</b> wie RSI, MACD oder Bollinger-Bänder. Beschreibe dann in Worten, wann du ein- und
            aussteigst, und nenne die Zeichnungen beim Kürzel (L1, F1, P1) oder beim Namen. Fathom zeigt dir, wie es dich verstanden hat,
            und rechnet die Taktik auf allen Kerzen zurück.</p>
          <fieldset><legend>Zeichnungen <span class="bt-anzahl" data-tl="anzahl"></span></legend>
            <ol class="tl-liste" data-tl="liste"></ol>
          </fieldset>
          <fieldset><legend>Indikatoren <span class="bt-anzahl" data-tl="ind-anzahl"></span></legend>
            <ul class="tl-indliste" data-tl="indliste"></ul>
          </fieldset>
          <fieldset><legend>Deine Taktik in Worten</legend>
            <div class="tl-chips" data-tl="chips"></div>
            <textarea data-tl="text" rows="5" maxlength="4000" spellcheck="true" placeholder="${esc(BEISPIEL)}"></textarea>
            <div class="tl-knoepfe">
              <button type="button" class="knopf" data-tl-deuten>Taktik verstehen</button>
              <button type="button" class="knopf" data-tl-ki hidden title="Deutet die Beschreibung mit Claude (über python live.py mit ANTHROPIC_API_KEY)">Mit KI deuten</button>
              <button type="button" class="knopf-text" data-tl-beispiel>Beispiel einsetzen</button>
            </div>
            <details class="tl-beispiele"><summary>Was Fathom versteht</summary><ul>
              <li>„Kaufe, wenn der Kurs über L1 schließt.“ · „… den Widerstand von unten berührt“ · „… in Z1 läuft“</li>
              <li>„Kaufe, wenn der Kurs das 61,8-%-Level von F1 berührt.“ · „… in den Golden Pocket läuft“</li>
              <li>„Kaufe, wenn der Kurs die untere Kanallinie von K1 berührt.“ · „Raus, wenn er den Kanal nach unten verlässt.“</li>
              <li>„… nur wenn der Kurs über dem SMA 200 liegt.“ · „Kaufe, wenn der EMA 20 über den EMA 50 kreuzt.“ · „Golden Cross“</li>
              <li>„Kaufe, wenn der RSI über 30 steigt.“ · „… der MACD die Signallinie nach oben kreuzt.“ · „… das untere Bollinger-Band berührt.“</li>
              <li>„Stop 2 ATR, Ziel 2R.“ · „Stop unter dem Tief der Signalkerze.“ · Stop und Ziel einer gezeichneten Position (P1) gelten automatisch.</li>
              <li>„Kaufe nach V1, …“ (erst ab der senkrechten Linie) · „Spätestens nach 20 Tagen raus.“</li>
            </ul></details>
            <div class="tl-deutung" data-tl="deutung" aria-live="polite"></div>
          </fieldset>
          <fieldset><legend>Rechnen</legend>
            <label class="bt-reihe"><span>Kosten</span><select data-tl="kosten">${[[0, "ohne"], [0.0005, "0,05 % je Kauf und Verkauf"], [0.001, "0,1 % je Kauf und Verkauf"], [0.0025, "0,25 % je Kauf und Verkauf"]].map(([v, t]) =>
              `<option value="${v}"${v === zustand.kosten ? " selected" : ""}>${t}</option>`).join("")}</select></label>
            <label class="tl-haken"><input type="checkbox" data-tl="nurDanach"${zustand.nurDanach ? " checked" : ""}> Nur Kerzen nach dem rechten Ende der Zeichnungen (ohne Rückschaufehler)</label>
          </fieldset>
          <div class="bt-start"><button type="submit" class="knopf bt-los">Taktik backtesten</button></div>
        </form>
        <div class="tl-haupt">
          <section class="tl-chartkarte">
            <div class="tl-kopf">
              <div class="tl-symbol-feld">
                <button type="button" class="tl-symbol" data-tl-symbol aria-haspopup="listbox" aria-expanded="false" aria-controls="tl-symbolsuche"
                  title="Wert wechseln: Aktie, ETF, Index, Währung oder Rohstoff suchen">${LUPE}<b data-tl="symbol-name"></b><span data-tl="symbol-art"></span>
                  <svg class="tl-pfeil-unten" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10l5 5 5-5"/></svg></button>
                <div class="tl-symbolsuche" id="tl-symbolsuche" data-tl="symbolsuche" hidden>
                  <label class="tl-suchfeld">${LUPE}<input type="search" data-tl="suche" role="combobox" aria-expanded="true" aria-controls="tl-treffer" aria-autocomplete="list"
                    autocomplete="off" spellcheck="false" maxlength="60" aria-label="Wert suchen" placeholder="Aktie, ETF, Index, Währung, Rohstoff …"></label>
                  <ul class="tl-treffer" id="tl-treffer" role="listbox" aria-label="Werte" data-tl="treffer"></ul>
                  <p class="tl-suche-status klein" data-tl="suche-status" role="status"></p>
                </div>
              </div>
              <div class="tl-zeitraum" role="radiogroup" aria-label="Kerzen" data-tl="zeitraum">${Object.keys(EB).map((e) => `<button type="button" role="radio" data-tl-ebene="${e}"
                aria-checked="${zustand.ebene === e}" title="${esc(EB[e].kerzen)}" aria-label="${esc(EB[e].kerzen)}">${esc(EB[e].kurz)}</button>`).join("")}</div>
              <span class="tl-live" data-tl="live" hidden></span>
              <span class="tl-info" data-tl="info"></span>
            </div>
            <div class="tl-werkzeuge" role="toolbar" aria-label="Zeichenwerkzeuge">
              ${WERKZEUGE.map(([id, titel, icon]) => `<button type="button" class="tl-wz" data-werkzeug="${id}" aria-pressed="${werkzeug === id}" title="${esc(titel)}" aria-label="${esc(titel)}"><svg viewBox="0 0 24 24" aria-hidden="true">${icon}</svg></button>`).join("")}
              <span class="tl-trenner"></span>
              <button type="button" data-tl-menue aria-expanded="false" aria-controls="tl-ind-menue" title="Indikatoren hinzufügen"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 17c3-6 5-9 8-6s5 1 10-6"/><path d="M3 21h18" class="duenn"/></svg><span>Indikatoren</span></button>
              <button type="button" data-tl-magnet aria-pressed="${magnet}" title="Magnet: an Eröffnung, Hoch, Tief und Schluss einrasten"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4v7a6 6 0 0 0 12 0V4h-4v7a2 2 0 0 1-4 0V4z"/></svg><span>Magnet</span></button>
              <span class="tl-trenner"></span>
              <span class="tl-zoomgruppe">
              <button type="button" data-tl-zoom="-1" title="Herauszoomen: mehr Kerzen (−)" aria-label="Herauszoomen"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6"/><path d="M8 11h6M16 16l4 4"/></svg></button>
              <button type="button" data-tl-zoom="1" title="Hineinzoomen: weniger Kerzen (+)" aria-label="Hineinzoomen"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6"/><path d="M8 11h6M11 8v6M16 16l4 4"/></svg></button>
              <button type="button" data-tl-zoom="0" title="Zurücksetzen: jüngste Kerzen, Preisachse automatisch (0)" aria-label="Ansicht zurücksetzen"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h12M12 7l5 5-5 5M20 5v14"/></svg></button>
              </span>
            </div>
            <div class="tl-ind-menue" id="tl-ind-menue" data-tl="menue" hidden></div>
            <div class="tl-chartrahmen">
              <div class="tl-chart" data-tl="chart" tabindex="0" aria-label="Kerzenchart zum Zeichnen. Mausrad, Trackpad oder zwei Finger zoomen, Ziehen verschiebt, an der Preisachse ziehen skaliert die Höhe. Plus und Minus zoomen, Pfeiltasten verschieben, Entf löscht die gewählte Zeichnung."${zustand.hoehe ? ` style="height:${zustand.hoehe}px"` : ""}></div>
              <button type="button" class="tl-auto" data-tl-auto aria-pressed="true" title="Preisachse automatisch an die sichtbaren Kerzen anpassen (Doppelklick auf die Preisachse)">Auto</button>
            </div>
            <div class="tl-groesse" data-tl-groesse role="separator" aria-orientation="horizontal" tabindex="0" aria-label="Höhe des Charts ändern"
              title="Ziehen ändert die Höhe des Charts, Doppelklick setzt sie zurück"><span></span></div>
            <div class="tl-panes" data-tl="panes"></div>
            <p class="tl-hilfe klein" data-tl="hilfe"></p>
          </section>
          <div class="tl-ergebnis" data-tl="ergebnis" aria-live="polite"></div>
        </div>
      </div>`;
    const form = $(".tl-seite", el);
    form.addEventListener("submit", (e) => { e.preventDefault(); backtesten(); });
    form.addEventListener("change", formAenderung);
    form.addEventListener("input", formEingabe);
    $(".tl", el).addEventListener("click", klick);
    $(".tl", el).addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (sucheOffen) { e.preventDefault(); e.stopPropagation(); sucheZu(true); }
      else if (menueOffen) { e.preventDefault(); e.stopPropagation(); menueZu(true); }
    });
    const suche = $('[data-tl="suche"]', el);
    suche.addEventListener("input", () => symbolSuche(suche.value));
    suche.addEventListener("keydown", sucheTaste);
    bindeGroesse();
    menueOffen = false; sucheOffen = false;
    statusPruefen().then(() => { if (wurzel !== el) return; kiKnopf(); zeitraumKnoepfe(); });
    wertLaden(false);
  }

  /* Wert und Zeitraum laden. modus false: jüngste Kerzen zeigen; "zeit": nach einem Wechsel des Zeitraums dieselbe
     Gegend zeigen (oder wieder die jüngsten, wenn sie vorher zu sehen waren). Rückgabe: Promise, erfüllt sobald gezeichnet. */
  let ladeNr = 0, ladeAnzeige = 0;
  function wertLaden(modus) {
    w = daten.werte.find((x) => x.s === zustand.wert) || daten.werte[0];
    const box = $('[data-tl="chart"]', wurzel);
    if (!w) { k = null; geo = null; box.innerHTML = '<p class="wm-leer">Keine Kursdaten.</p>'; return Promise.resolve(); }
    zustand.wert = w.s;
    const altK = k, altSicht = { ...sicht }, eb = zustand.ebene, nr = ++ladeNr;
    auswahl = null; entwurf = null; ergebnis = null; ziehen = null;
    const a = akt();
    $('[data-tl="text"]', wurzel).value = a.text || "";
    deutung = a.regeln ? { regeln: a.regeln, erkannt: [], unklar: [], hinweise: [], text: a.text || "" } : null;
    symbolKopf(); zeitraumKnoepfe();
    liste(); indListe(); chips(); deutungZeigen(); ergebnisZeigen(); hilfe();
    k = null; geo = null;
    clearTimeout(ladeAnzeige);
    ladeAnzeige = setTimeout(() => { if (nr === ladeNr && !k) box.innerHTML = `<p class="tl-laedt">${esc(EB[eb].kerzen)} für ${esc(w.name)} werden geladen …</p>`; }, 120);
    return statusPruefen().then(() => kerzenFuer(w, eb)).then((kk) => {
      if (nr !== ladeNr) return;
      clearTimeout(ladeAnzeige);
      k = kk; preisSkala = null;
      sicht = standardSicht();
      if (modus === "zeit" && altK && altSicht.i1 < altK.c.length - 1) { // vorher nicht am rechten Rand: dieselbe Zeit in die Mitte
        const t = zeitBei(altK, (altSicht.i0 + altSicht.i1) / 2), i = T.indexGenau(k, t), span = sicht.i1 - sicht.i0;
        sicht = { i0: i - span / 2, i1: i + span / 2 };
      }
      setzeSicht(sicht.i0, sicht.i1, true);
      autoKnopf(); zeichne(); ergebnisZeigen(); liveStarten();
    }).catch((err) => {
      if (nr !== ladeNr) return;
      clearTimeout(ladeAnzeige);
      melden(err && err.message ? err.message : "Die Kerzen ließen sich nicht laden.");
      if (eb !== "tag") { zustand.ebene = "tag"; sichern(); return wertLaden(false).then(() => melden(`${err && err.message ? err.message : ""} Gezeigt werden Tageskerzen.`.trim())); }
      box.innerHTML = '<p class="wm-leer">Die Kursdaten ließen sich nicht laden.</p>';
    });
  }
  function standardSicht() {
    const n = k.c.length, sichtbar = STANDARD_SPANNE[zustand.ebene] || 160;
    return { i0: Math.max(0, n - sichtbar), i1: n + 4 };
  }
  // Zeit an einer (auch gebrochenen oder außerhalb liegenden) Kerzenposition
  function zeitBei(kk, i) {
    const n = kk.c.length, st = n > 1 ? (kk.tag[n - 1] - kk.tag[0]) / (n - 1) : 1, j = Math.round(i);
    return j < 0 ? kk.tag[0] + j * st : j >= n ? kk.tag[n - 1] + (j - n + 1) * st : kk.tag[j];
  }

  /* ================================================================ Kopf: Wert und Zeitraum */
  function symbolKopf() {
    const name = $('[data-tl="symbol-name"]', wurzel), art = $('[data-tl="symbol-art"]', wurzel);
    if (!name || !w) return;
    name.textContent = w.name;
    art.textContent = `${w.s} · ${TYPNAME[w.typ] || ""}${w.extra ? " · nicht auf der Watchlist" : ""}`;
  }
  function zeitraumKnoepfe() {
    if (!wurzel) return;
    $$("[data-tl-ebene]", wurzel).forEach((b) => {
      const e = b.dataset.tlEbene, grund = w ? ebeneHindernis(e) : null;
      b.setAttribute("aria-checked", String(e === zustand.ebene));
      b.setAttribute("aria-disabled", String(!!grund));
      b.title = grund ? `${EB[e].kerzen}: ${grund}` : EB[e].kerzen;
    });
  }
  function ebeneWaehlen(neu) {
    neu = T.ebeneOk(neu);
    return statusPruefen().then(() => {
      const grund = ebeneHindernis(neu);
      if (grund) { melden(`${EB[neu].kerzen}: ${grund}`); return; }
      if (neu === zustand.ebene && k) return;
      zustand.ebene = neu; sichern();
      zeitraumKnoepfe();
      return wertLaden("zeit");
    });
  }
  function wechsleWert(s) {
    if (s === zustand.wert && k) return Promise.resolve();
    zustand.wert = s; sichern();
    // Zeitraum, den es für den neuen Wert nicht gibt (z. B. Stunden ohne OANDA-Daten): zurück auf Tag
    const neu = daten.werte.find((x) => x.s === s);
    if (neu && ebeneHindernis(zustand.ebene, neu)) { melden(`${EB[zustand.ebene].kerzen}: ${ebeneHindernis(zustand.ebene, neu)} Gezeigt werden Tageskerzen.`); zustand.ebene = "tag"; sichern(); }
    return wertLaden(false);
  }
  // Suche: ohne Eingabe alle geladenen Werte, sonst Treffer aus Watchlist, Katalog und (mit python live.py) Yahoo Finance
  let suchListe = [], suchAktiv = -1, suchNr = 0, suchTimer = null, suchAbbruch = null;
  function escMarke() { const t = wurzel && $(".tl", wurzel); if (t) t.toggleAttribute("data-bt-esc", menueOffen || sucheOffen); }
  function sucheAuf() {
    if (menueOffen) menueZu(false);
    const box = $('[data-tl="symbolsuche"]', wurzel), inp = $('[data-tl="suche"]', wurzel);
    box.hidden = false; sucheOffen = true; escMarke();
    $("[data-tl-symbol]", wurzel).setAttribute("aria-expanded", "true");
    $('[data-tl="suche-status"]', wurzel).textContent = window.WBH.serverMoeglich() ? "" : "Hier: Watchlist und Backtest-Katalog. Jeden Wert von Yahoo Finance gibt es mit python live.py.";
    inp.value = ""; symbolSuche(""); inp.focus();
  }
  function sucheZu(fokus) {
    const box = wurzel && $('[data-tl="symbolsuche"]', wurzel);
    if (!box) return;
    box.hidden = true; sucheOffen = false; escMarke();
    clearTimeout(suchTimer); if (suchAbbruch) suchAbbruch.abort();
    const b = $("[data-tl-symbol]", wurzel); b.setAttribute("aria-expanded", "false");
    if (fokus) b.focus();
  }
  function symbolSuche(text) {
    const nr = ++suchNr, q = String(text || "").trim().toLowerCase();
    clearTimeout(suchTimer); if (suchAbbruch) { suchAbbruch.abort(); suchAbbruch = null; }
    const geladen = daten.werte.filter((x) => !q || `${x.name} ${x.s}`.toLowerCase().includes(q))
      .map((x) => ({ s: x.s, n: x.name, t: x.typ, q: x.extra ? "Weitere Werte" : "Watchlist" }));
    if (!q) { suchZeigen(geladen.slice(0, 60), false); return; }
    const bt = window.WBBacktest;
    const da = new Set(geladen.map((x) => x.s.toUpperCase()));
    const lokal = bt && bt.suche ? bt.suche(text, { lokal: true, mehr: true }).sofort.filter((x) => !da.has(x.s.toUpperCase())) : [];
    const sofort = geladen.slice(0, 10).concat(lokal);
    const server = !!(bt && bt.suche) && q.length >= 2 && window.WBH.serverMoeglich();
    suchZeigen(sofort, server);
    if (!server) return;
    suchTimer = setTimeout(() => {
      suchAbbruch = new AbortController();
      const r = bt.suche(text, { signal: suchAbbruch.signal, mehr: true });
      if (!r.spaeter) { suchZeigen(sofort, false); return; }
      r.spaeter.then((neu) => {
        if (nr !== suchNr) return;
        const d2 = new Set(sofort.map((x) => x.s.toUpperCase()));
        suchZeigen(sofort.concat(neu.filter((x) => !d2.has(x.s.toUpperCase()))), false);
      }).catch((err) => { if (nr === suchNr && (!err || err.name !== "AbortError")) suchZeigen(sofort, false); });
    }, 280);
  }
  function suchZeigen(liste, laedt) {
    suchListe = liste; suchAktiv = liste.length ? 0 : -1;
    const ul = $('[data-tl="treffer"]', wurzel);
    ul.innerHTML = liste.map((x, i) => `<li role="option" id="tl-treffer-${i}" data-tl-treffer="${i}" aria-selected="${i === suchAktiv}"${x.s === zustand.wert ? ' class="aktuell"' : ""}>
        <b>${esc(x.n)}</b><span>${esc(x.s)} · ${esc(TYPNAME[x.t] || "")} · ${esc(x.q)}</span></li>`).join("")
      + (laedt ? '<li class="tl-treffer-info" aria-disabled="true">Suche bei Yahoo Finance …</li>' : liste.length ? "" : '<li class="tl-treffer-info" aria-disabled="true">Nichts gefunden.</li>');
    aktivSetzen(suchAktiv);
  }
  function aktivSetzen(i) {
    suchAktiv = i;
    const inp = $('[data-tl="suche"]', wurzel);
    $$("[data-tl-treffer]", wurzel).forEach((li) => li.setAttribute("aria-selected", String(+li.dataset.tlTreffer === i)));
    if (i >= 0) { inp.setAttribute("aria-activedescendant", `tl-treffer-${i}`); const li = $(`#tl-treffer-${i}`, wurzel); if (li) li.scrollIntoView({ block: "nearest" }); }
    else inp.removeAttribute("aria-activedescendant");
  }
  function sucheTaste(e) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!suchListe.length) return;
      aktivSetzen((suchAktiv + (e.key === "ArrowDown" ? 1 : -1) + suchListe.length) % suchListe.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (suchListe[suchAktiv]) symbolWaehlen(suchListe[suchAktiv]);
    } else if (e.key === "Tab") sucheZu(false);
  }
  function symbolWaehlen(x) {
    const status = $('[data-tl="suche-status"]', wurzel);
    const da = daten.werte.find((v) => v.s.toUpperCase() === x.s.toUpperCase());
    if (da) { sucheZu(true); wechsleWert(da.s); return; }
    const bt = window.WBBacktest;
    if (!bt || !bt.wertBereit) { status.textContent = "Der Backtest ist noch nicht geladen."; return; }
    status.textContent = `${x.n}: Kurse werden geladen …`;
    bt.wertBereit({ s: x.s, n: x.n, t: x.t }).then(() => {
      const neu = daten.werte.find((v) => v.s.toUpperCase() === x.s.toUpperCase());
      if (!neu) throw new Error(`Für ${x.n} gibt es keine Kursdaten.`);
      status.textContent = "";
      if (sucheOffen) sucheZu(true);
      wechsleWert(neu.s);
    }).catch((err) => { status.textContent = err && err.message ? err.message : "Konnte nicht geladen werden."; });
  }
  function hilfe() {
    const el = wurzel && $('[data-tl="hilfe"]', wurzel);
    if (!el) return;
    const t = {
      zeiger: "Ziehen verschiebt, Mausrad, Trackpad oder zwei Finger zoomen. An der Preisachse ziehen streckt die Kerzen (Doppelklick: automatisch). Zeichnung anklicken zum Verschieben, <kbd>Entf</kbd> löscht.",
      linie: "Ein Klick setzt eine waagerechte Linie über den ganzen Chart.",
      strahl: "Ein Klick setzt einen Strahl: Er gilt ab dieser Kerze nach rechts.",
      trend: "Zwei Punkte klicken oder ziehen.",
      senkrecht: "Ein Klick setzt eine senkrechte Linie, z. B. als Stichtag („nach V1“).",
      zone: "Zwei Ecken klicken oder ziehen.",
      kanal: "Erst die Grundlinie mit zwei Punkten, dann die Breite mit einem dritten Klick.",
      fib: "Vom Startpunkt (100 %) zum Endpunkt (0 %) klicken oder ziehen, z. B. vom Tief zum Hoch.",
      long: "Ein Klick setzt den Einstieg; Stop und Ziel danach an den Kanten ziehen.",
      short: "Ein Klick setzt den Einstieg; Stop und Ziel danach an den Kanten ziehen.",
    }[werkzeug];
    el.innerHTML = `${t} Tasten: V, H, J, T, I, R, K, F, L, S · <kbd>+</kbd> <kbd>−</kbd> zoomen, <kbd>0</kbd> zurücksetzen.`;
  }

  /* ================================================================ Liste der Zeichnungen und Indikatoren */
  const FARBE = { linie: "f-blau", strahl: "f-blau", trend: "f-lila", senkrecht: "f-tinte", zone: "f-gelb", kanal: "f-lila", fib: "f-tuerkis", position: "f-gruen" };
  const IND_FARBE = ["i-orange", "i-blau", "i-lila", "i-gruen", "i-rot", "i-tuerkis", "i-gelb", "i-sand"];
  const dez = () => window.WBH.kursStellen(w);
  function preisText(z) {
    const d = dez();
    switch (z.art) {
      case "linie": case "strahl": return zahl(z.p, d);
      case "trend": case "fib": return `${zahl(z.a.p, d)} → ${zahl(z.b.p, d)}`;
      case "senkrecht": return zeitText(z.t, true);
      case "kanal": return `Breite ${zahl(Math.abs(z.d), d)}`;
      case "position": return `${T.istPositionLong(z) ? "Long" : "Short"} · CRV ${zahl(Math.abs(z.ziel - z.ein) / Math.abs(z.ein - z.stop), 1)}`;
      default: return `${zahl(z.unten, d)} – ${zahl(z.oben, d)}`;
    }
  }
  const PLATZHALTER = { linie: "Name, z. B. Widerstand", strahl: "Name, z. B. Widerstand", trend: "Name, z. B. Aufwärtstrend", senkrecht: "Name, z. B. Zinsentscheid",
    zone: "Name, z. B. Nachfragezone", kanal: "Name, z. B. Trendkanal", fib: "Name, z. B. Rücklauf", position: "Name, z. B. Plan" };
  function liste() {
    const z = akt().zeichnungen;
    $('[data-tl="anzahl"]', wurzel).textContent = z.length ? String(z.length) : "";
    const schalter = (x) => {
      const r = ["trend", "zone", "kanal", "fib"].includes(x.art) ? `<label class="tl-verl" title="Nach rechts verlängern"><input type="checkbox" data-tl-verl="${x.id}"${x.verl ? " checked" : ""}>→</label>` : "";
      const l = x.art === "trend" ? `<label class="tl-verl" title="Nach links verlängern"><input type="checkbox" data-tl-vorne="${x.id}"${x.vorne ? " checked" : ""}>←</label>` : "";
      return `<span class="tl-schalter">${l}${r}</span>`;
    };
    $('[data-tl="liste"]', wurzel).innerHTML = z.length ? z.map((x) => `<li data-z="${x.id}" class="${auswahl === x.id ? "gewaehlt" : ""}">
        <button type="button" class="tl-id ${FARBE[x.art]}" data-tl-waehle="${x.id}" title="${T.ARTEN[x.art]} auswählen">${x.id}</button>
        <input type="text" data-tl-name="${x.id}" value="${esc(x.name || "")}" maxlength="30" placeholder="${PLATZHALTER[x.art]}" aria-label="Name für ${x.id}">
        <span class="tl-preis">${preisText(x)}</span>
        ${schalter(x)}
        <button type="button" class="bt-weg" data-tl-weg="${x.id}" aria-label="${x.id} löschen" title="Löschen"><svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
      </li>`).join("") : '<li class="tl-leer klein">Noch keine Zeichnung. Wähle oben über dem Chart ein Werkzeug und klicke in den Chart.</li>';
  }
  function indListe() {
    const l = akt().indikatoren;
    $('[data-tl="ind-anzahl"]', wurzel).textContent = l.length ? String(l.length) : "";
    $('[data-tl="indliste"]', wurzel).innerHTML = l.length ? l.map((x, i) => `<li>
        <span class="tl-ind-farbe ${IND_FARBE[i % IND_FARBE.length]}" aria-hidden="true"></span>
        <button type="button" class="tl-ind-name" data-tl-einfuegen="${esc(einfuegeText(x))}" title="In die Beschreibung einfügen">${esc(T.indName(x))}</button>
        <span class="tl-preis">${IM_CHART.includes(x.art) ? "im Chart" : "eigenes Feld"}</span>
        <button type="button" class="bt-weg" data-tl-ind-weg="${i}" aria-label="${esc(T.indName(x))} entfernen" title="Entfernen"><svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
      </li>`).join("") : '<li class="tl-leer klein">Über „Indikatoren“ am Chart hinzufügen. In der Beschreibung genannte Indikatoren erscheinen von selbst.</li>';
  }
  const einfuegeText = (x) => (x.art === "sma" || x.art === "ema" ? `${x.art.toUpperCase()} ${x.n}` : x.art === "bb" ? "Bollinger-Band" : x.art === "rsi" ? `RSI ${x.n}` : x.art === "macd" ? "MACD" : `ATR`);
  function chips() {
    const z = akt().zeichnungen, ind = akt().indikatoren;
    $('[data-tl="chips"]', wurzel).innerHTML = z.map((x) => `<button type="button" class="bt-chip" data-tl-einfuegen="${esc(x.name || x.id)}" title="In die Beschreibung einfügen">${esc(x.name ? `${x.name} (${x.id})` : x.id)}</button>`).join("")
      + ind.map((x) => `<button type="button" class="bt-chip leise" data-tl-einfuegen="${esc(einfuegeText(x))}" title="In die Beschreibung einfügen">${esc(einfuegeText(x))}</button>`).join("");
  }
  function indikatorDazu(x) {
    const p = T.pruefeIndikator(x);
    if (!p) return false;
    const a = akt();
    if (a.indikatoren.some((y) => T.indName(y) === T.indName(p))) return true;
    if (a.indikatoren.length >= 8) return false;
    a.indikatoren.push(p);
    return true;
  }

  /* ================================================================ Indikator-Menü */
  function menueAuf() {
    if (sucheOffen) sucheZu(false);
    const m = $('[data-tl="menue"]', wurzel);
    m.innerHTML = `<div class="tl-ind-kopf"><b>Indikator hinzufügen</b><span class="klein">höchstens 8 je Wert</span></div>
      <ul>${IND_MENUE.map(([art, name, titel, felder]) => `<li data-ind-art="${art}"><span class="tl-ind-titel" title="${esc(titel)}">${esc(name)}</span>
        <span class="tl-ind-felder">${felder.map(([kk, label, std, min, max, schritt]) => `<label>${esc(label)}<input type="number" data-ind-feld="${kk}" value="${std}" min="${min}" max="${max}" step="${schritt || 1}" inputmode="decimal"></label>`).join("")}</span>
        <button type="button" class="knopf" data-ind-dazu="${art}">Hinzufügen</button></li>`).join("")}</ul>
      <p class="klein tl-ind-meldung" role="status"></p>`;
    m.hidden = false; menueOffen = true; escMarke();
    $("[data-tl-menue]", wurzel).setAttribute("aria-expanded", "true");
    const erstes = $("input", m); if (erstes) erstes.focus();
  }
  function menueZu(fokusZurueck) {
    const m = wurzel && $('[data-tl="menue"]', wurzel);
    if (!m) return;
    m.hidden = true; menueOffen = false; escMarke();
    const b = $("[data-tl-menue]", wurzel); b.setAttribute("aria-expanded", "false");
    if (fokusZurueck) b.focus();
  }

  /* ================================================================ Chart */
  const M = { r: 64, u: 24, o: 8 };
  let geo = null;
  function sichtbarePreise() {
    const a = Math.max(0, Math.floor(sicht.i0)), b = Math.min(k.c.length - 1, Math.ceil(sicht.i1));
    let lo = Infinity, hi = -Infinity;
    for (let i = a; i <= b; i++) { if (k.l[i] < lo) lo = k.l[i]; if (k.h[i] > hi) hi = k.h[i]; }
    if (!isFinite(lo)) { for (let i = 0; i < k.c.length; i++) { if (k.l[i] < lo) lo = k.l[i]; if (k.h[i] > hi) hi = k.h[i]; } }
    const pad = (hi - lo) * 0.07 || hi * 0.02 || 1;
    return { lo: lo - pad, hi: hi + pad, a, b };
  }
  function ticks(lo, hi, n) {
    const roh = (hi - lo) / n, p = Math.pow(10, Math.floor(Math.log10(roh)));
    const s = [1, 2, 2.5, 5, 10].map((m) => m * p).find((x) => x >= roh) || 10 * p;
    const aus = []; for (let v = Math.ceil(lo / s) * s; v <= hi; v += s) aus.push(+v.toFixed(10));
    return { werte: aus, schritt: s };
  }
  // Bei sehr vielen sichtbaren Kerzen nur jede n-te für Linien zeichnen (höchstens etwa eine je Pixel)
  const sprungFuer = (a, b) => Math.max(1, Math.floor((b - a + 1) / Math.max(200, geo ? geo.pw : 800)));
  // Linie durch eine Reihe (nur gültige Werte, Lücken unterbrechen)
  function reihenPfad(r, a, b, X, Y) {
    let d = "", offen = false;
    const sp = sprungFuer(a, b);
    for (let i = a; i <= b; i += sp) {
      const v = r[i];
      if (!Number.isFinite(v)) { offen = false; continue; }
      d += `${offen ? "L" : "M"}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`; offen = true;
    }
    return d;
  }
  // Kerzen für die Anzeige: bei mehr Kerzen als Platz zu Gruppen zusammengefasst (an festen Grenzen, damit nichts flackert)
  function anzeigeKerzen(a, b, pw) {
    const platz = Math.max(60, Math.floor(pw / 2.5)), g = b - a + 1 > platz ? Math.ceil((b - a + 1) / platz) : 1;
    const t = { o: [], h: [], l: [], c: [], m: [], g };
    if (b < a) return t;
    const n = k.c.length;
    for (let s0 = Math.floor(a / g) * g; s0 <= b; s0 += g) {
      const e = Math.min(n - 1, s0 + g - 1);
      let hi = -Infinity, lo = Infinity;
      for (let i = s0; i <= e; i++) { if (k.h[i] > hi) hi = k.h[i]; if (k.l[i] < lo) lo = k.l[i]; }
      t.o.push(k.o[s0]); t.c.push(k.c[e]); t.h.push(hi); t.l.push(lo); t.m.push((s0 + e) / 2);
    }
    return t;
  }
  function zeichne() {
    const box = wurzel && $('[data-tl="chart"]', wurzel);
    if (!box || !k) return;
    const B = Math.max(300, box.clientWidth), H = Math.max(220, box.clientHeight || 440);
    const pw = B - M.r, ph = H - M.u - M.o;
    const auto = sichtbarePreise(), { a, b } = auto, { lo, hi } = preisSkala || auto;
    const span = sicht.i1 - sicht.i0, i0 = sicht.i0;
    const X = (i) => ((i - i0 + 0.5) / span) * pw;
    const Y = (p) => M.o + (1 - (p - lo) / (hi - lo)) * ph;
    // I und P lesen die aktuelle Sicht, damit Zoomen zwischen zwei Bildern am richtigen Punkt ansetzt
    geo = { B, H, pw, ph, lo, hi, X, Y, span, a, b,
      I: (x) => sicht.i0 + (x / pw) * (sicht.i1 - sicht.i0) - 0.5, P: (y) => lo + (1 - (y - M.o) / ph) * (hi - lo) };
    const d = dez();
    const t = ticks(lo, hi, H < 360 ? 5 : 7);
    const fA = (v) => nf(t.schritt >= 1 ? 0 : t.schritt >= 0.1 ? 1 : Math.min(4, Math.max(2, d))).format(v);
    let svg = `<svg width="${B}" height="${H}" viewBox="0 0 ${B} ${H}" role="img" aria-label="Kerzenchart ${esc(w.name)}, ${esc(EB[zustand.ebene].kerzen)}">`;
    svg += `<rect class="tl-flaeche" x="0" y="0" width="${pw}" height="${H - M.u}"/><rect class="tl-achsflaeche" x="${pw}" y="0" width="${M.r}" height="${H}"/>`;
    t.werte.forEach((v) => { svg += `<line class="tl-gitter" x1="0" x2="${pw}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"/><text class="tl-achse" x="${pw + 8}" y="${(Y(v) + 4).toFixed(1)}">${fA(v)}</text>`; });
    svg += zeitachse(a, b, X, H);
    // Kerzen (bei sehr vielen zu Gruppen zusammengefasst)
    const teil = anzeigeKerzen(a, b, pw);
    const p = KZ.pfade(teil, (j) => X(teil.m[j]), Y, KZ.breiteAus((pw / span) * teil.g));
    svg += `<g clip-path="url(#tl-clip)">${indikatorenImChart(a, b, X, Y)}<path class="kerze auf" d="${p.auf}"/><path class="kerze ab" d="${p.ab}"/>`;
    svg += tradesSvg(X, Y);
    svg += zeichnungenSvg(X, Y);
    if (entwurf) svg += zeichnungSvg(entwurf, X, Y, true);
    svg += `</g><defs><clipPath id="tl-clip"><rect x="0" y="0" width="${pw}" height="${H - M.u}"/></clipPath></defs>`;
    svg += preisMarken(Y, d, pw);
    svg += `<g class="tl-kreuz" hidden><line class="tl-kreuz-v" y1="${M.o}" y2="${H - M.u}"/><line class="tl-kreuz-h" x1="0" x2="${pw}"/><rect class="tl-kreuz-marke" x="${pw}" width="${M.r}" height="18" rx="3"/><text class="tl-kreuz-text" x="${pw + 8}"></text>`
      + `<rect class="tl-kreuz-marke zeit" y="${H - M.u + 3}" height="18" rx="3"/><text class="tl-kreuz-text zeit" y="${H - M.u + 16}" text-anchor="middle"></text></g>`;
    svg += "</svg>";
    box.innerHTML = svg + '<div class="tl-ohlc" data-tl="ohlc"></div>';
    box.classList.toggle("zeichnen", werkzeug !== "zeiger");
    // Esc beendet hier zuerst das Zeichnen, statt das ganze Fenster zu schließen (backtest.js beachtet data-bt-esc)
    box.toggleAttribute("data-bt-esc", werkzeug !== "zeiger" || !!entwurf);
    const letzte = k.c.length - 1;
    const quelle = k.fenster ? ` · ${k.quelle || "Yahoo Finance"}, letzte ${k.fenster}` : "";
    $('[data-tl="info"]', wurzel).textContent = `${zeitText(k.tag[Math.max(0, a)], true)} bis ${zeitText(k.tag[Math.min(letzte, b)], true)} · ${EB[zustand.ebene].kerzen}${quelle}`;
    panes();
    ohlcZeigen(Math.min(letzte, Math.max(0, b)));
  }
  // Zeitachse für jeden Zeitraum: Uhrzeiten, Tage, Monate oder Jahre, je nachdem wie viel zu sehen ist (etwa alle 90 px)
  const MIN_STUFEN = [1, 2, 5, 10, 15, 30, 60, 120, 180, 240, 360, 720];
  function zeitTeile(t, lokal) {
    const d = new Date(t * 864e5);
    return lokal ? { j: d.getFullYear(), m: d.getMonth(), t: d.getDate(), h: d.getHours(), mi: d.getMinutes(), min: Math.round(t * 1440) - d.getTimezoneOffset() }
      : { j: d.getUTCFullYear(), m: d.getUTCMonth(), t: d.getUTCDate(), h: 0, mi: 0, min: Math.round(t * 1440) };
  }
  function zeitachse(a, b, X, H) {
    if (b <= a) return "";
    const lokal = intra(), pxJe = geo.pw / geo.span, minJe = ((k.tag[b] - k.tag[a]) * 1440) / (b - a) || EB[zustand.ebene].n;
    const ziel = (90 / pxJe) * minJe;  // Minuten zwischen zwei Beschriftungen
    const art = lokal && ziel < 1000 ? "min" : ziel < 1440 * 6 ? "tag" : ziel < 1440 * 20 ? "woche" : ziel < 1440 * 75 ? "monat" : ziel < 1440 * 200 ? "quartal" : ziel < 1440 * 1100 ? "jahr" : "jahre";
    const stufe = MIN_STUFEN.find((x) => x >= ziel) || 720;
    const schl = (z) => (art === "min" ? Math.floor(z.min / stufe) : art === "tag" ? z.j * 400 + z.m * 32 + z.t : art === "woche" ? Math.floor((Math.floor(z.min / 1440) + 3) / 7)
      : art === "monat" ? z.j * 12 + z.m : art === "quartal" ? z.j * 4 + Math.floor(z.m / 3) : art === "jahr" ? z.j : Math.floor(z.j / 5));
    const zwei = (x) => String(x).padStart(2, "0");
    const sp = Math.max(1, Math.floor((b - a) / 1500));
    let s = "", vor = zeitTeile(k.tag[a], lokal), alt = schl(vor), letztesX = -1e9;
    for (let i = a + sp; i <= b; i += sp) {
      const z = zeitTeile(k.tag[i], lokal), key = schl(z);
      if (key !== alt) {
        const x = X(i);
        if (x - letztesX > 58 && x > 18 && x < geo.pw - 18) {
          let text, stark = false;
          if (art === "min") {
            if (z.t !== vor.t || z.m !== vor.m) { text = `${z.t}. ${MONATE[z.m]}`; stark = true; } else text = `${zwei(z.h)}:${zwei(z.mi)}`;
          } else if (art === "tag" || art === "woche") {
            if (z.j !== vor.j) { text = String(z.j); stark = true; } else if (z.m !== vor.m) { text = MONATE[z.m]; stark = true; } else text = String(z.t);
          } else if (art === "monat" || art === "quartal") {
            if (z.j !== vor.j) { text = String(z.j); stark = true; } else text = MONATE[z.m];
          } else { text = String(z.j); stark = true; }
          s += `<line class="tl-gitter senk" x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${M.o}" y2="${H - M.u}"/><text class="tl-achse${stark ? " stark" : ""}" x="${x.toFixed(1)}" y="${H - 7}" text-anchor="middle">${text}</text>`;
          letztesX = x;
        }
        alt = key;
      }
      vor = z;
    }
    return s;
  }
  function indikatorenImChart(a, b, X, Y) {
    let s = "";
    akt().indikatoren.forEach((x, n) => {
      if (!IM_CHART.includes(x.art)) return;
      const f = IND_FARBE[n % IND_FARBE.length], r = T.indikatorReihen(k, x);
      if (x.art === "bb") {
        const oben = reihenPfad(r.oben, a, b, X, Y), unten = reihenPfad(r.unten, a, b, X, Y);
        // Fläche zwischen den Bändern
        let flaeche = "";
        const gueltig = [], sp = sprungFuer(a, b); for (let i = a; i <= b; i += sp) if (Number.isFinite(r.oben[i])) gueltig.push(i);
        if (gueltig.length > 1) flaeche = `M${gueltig.map((i) => `${X(i).toFixed(1)} ${Y(r.oben[i]).toFixed(1)}`).join("L")}L${gueltig.slice().reverse().map((i) => `${X(i).toFixed(1)} ${Y(r.unten[i]).toFixed(1)}`).join("L")}Z`;
        s += `<g class="tl-ind ${f}"><path class="tl-bb-flaeche" d="${flaeche}"/><path d="${oben}"/><path d="${unten}"/><path class="mitte" d="${reihenPfad(r.mitte, a, b, X, Y)}"/></g>`;
      } else s += `<g class="tl-ind ${f}"><path d="${reihenPfad(r.linie, a, b, X, Y)}"/></g>`;
    });
    return s;
  }
  // Eigene Felder unter dem Chart für RSI, MACD und ATR (gleiche Zeitachse)
  const PANE_H = 96;
  function panes(i) {
    const el = wurzel && $('[data-tl="panes"]', wurzel);
    if (!el || !geo || !k) return;
    const liste = akt().indikatoren.map((x, n) => [x, n]).filter(([x]) => !IM_CHART.includes(x.art));
    if (!liste.length) { el.innerHTML = ""; return; }
    const { B, pw, X, a, b } = geo, idx = i == null ? Math.min(k.c.length - 1, b) : i;
    el.innerHTML = liste.map(([x, n]) => {
      const f = IND_FARBE[n % IND_FARBE.length], r = T.indikatorReihen(k, x);
      const reihen = x.art === "macd" ? [r.macd, r.signal, r.hist] : [r.linie];
      let lo = Infinity, hi = -Infinity;
      reihen.forEach((rr) => { for (let j = a; j <= b; j++) if (Number.isFinite(rr[j])) { if (rr[j] < lo) lo = rr[j]; if (rr[j] > hi) hi = rr[j]; } });
      if (x.art === "rsi") { lo = 0; hi = 100; }
      if (!isFinite(lo)) { lo = 0; hi = 1; }
      if (x.art === "macd") { const m = Math.max(Math.abs(lo), Math.abs(hi)) || 1; lo = -m; hi = m; }
      if (hi - lo < 1e-12) { hi = lo + 1; }
      const Y = (v) => 16 + (1 - (v - lo) / (hi - lo)) * (PANE_H - 24);
      let s = `<svg width="${B}" height="${PANE_H}" viewBox="0 0 ${B} ${PANE_H}" role="img" aria-label="${esc(T.indName(x))}">`;
      const linie = (v, kl) => `<line class="${kl}" x1="0" x2="${pw}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"/><text class="tl-achse" x="${pw + 8}" y="${(Y(v) + 4).toFixed(1)}">${nf(x.art === "atr" ? Math.min(4, dez()) : 0).format(v)}</text>`;
      if (x.art === "rsi") s += linie(70, "tl-gitter grenze") + linie(30, "tl-gitter grenze") + linie(50, "tl-gitter");
      else if (x.art === "macd") s += linie(0, "tl-gitter");
      else s += linie(lo + (hi - lo) * 0.85, "tl-gitter") + linie(lo + (hi - lo) * 0.15, "tl-gitter");
      s += `<g clip-path="url(#tl-clip-p)" class="tl-ind ${f}">`;
      if (x.art === "macd") {
        const sp = sprungFuer(a, b), breite = Math.max(1, Math.min(8, (pw / geo.span) * sp * 0.6)), y0 = Y(0);
        for (let j = a; j <= b; j += sp) { const v = r.hist[j]; if (!Number.isFinite(v)) continue; const y = Y(v); s += `<rect class="tl-hist ${v >= 0 ? "plus" : "minus"}" x="${(X(j) - breite / 2).toFixed(1)}" y="${Math.min(y, y0).toFixed(1)}" width="${breite.toFixed(1)}" height="${Math.max(0.5, Math.abs(y - y0)).toFixed(1)}"/>`; }
        s += `<path d="${reihenPfad(r.macd, a, b, X, Y)}"/><path class="signal" d="${reihenPfad(r.signal, a, b, X, Y)}"/>`;
      } else s += `<path d="${reihenPfad(r.linie, a, b, X, Y)}"/>`;
      s += `</g><defs><clipPath id="tl-clip-p"><rect x="0" y="0" width="${pw}" height="${PANE_H}"/></clipPath></defs>`;
      const wert = (rr) => (Number.isFinite(rr[idx]) ? nf(x.art === "atr" ? Math.min(4, dez() + 1) : x.art === "macd" ? Math.min(4, dez() + 1) : 1).format(rr[idx]) : "–");
      const titel = x.art === "macd" ? `${T.indName(x)} · ${minus(wert(r.macd))} · Signal ${minus(wert(r.signal))}` : `${T.indName(x)} · ${minus(wert(r.linie))}`;
      s += `<text class="tl-pane-titel" x="8" y="12">${esc(titel)}</text></svg>`;
      return `<div class="tl-pane">${s}</div>`;
    }).join("");
  }
  function preisMarken(Y, d, pw) {
    let s = "";
    const marke = (v, kl, text) => {
      const y = Y(v);
      if (y < M.o || y > geo.H - M.u) return;
      s += `<g class="tl-marke ${kl}"><rect x="${pw}" y="${(y - 9).toFixed(1)}" width="${M.r}" height="18" rx="3"/><text x="${pw + 6}" y="${(y + 4).toFixed(1)}">${esc(text)}</text></g>`;
    };
    const i = Math.min(k.c.length - 1, Math.round(sicht.i1 - 1));
    akt().zeichnungen.forEach((z) => {
      if (z.art === "senkrecht") return;
      if (z.art === "position") {
        marke(z.ziel, "f-gruen", `Ziel ${nf(Math.min(4, d)).format(z.ziel)}`);
        marke(z.stop, "f-rot", `Stop ${nf(Math.min(4, d)).format(z.stop)}`);
        marke(z.ein, "f-tinte", `${z.id} ${nf(Math.min(4, d)).format(z.ein)}`);
        return;
      }
      if (z.art === "fib") {
        if (auswahl !== z.id) return;
        T.FIB_STUFEN.forEach((st) => marke(T.fibPreis(z, st), FARBE.fib, `${nf(1).format(st * 100)} %`));
        return;
      }
      const wn = T.wertAn(z, k, i);
      if (!wn) return;
      const werte = z.art === "zone" || z.art === "kanal" ? [wn.oben, wn.unten] : [wn.p];
      werte.forEach((v) => marke(v, FARBE[z.art], `${z.id} ${nf(Math.min(4, d)).format(v)}`));
    });
    return s;
  }
  const f1 = (x) => x.toFixed(1);
  function zeichnungSvg(z, X, Y, istEntwurf) {
    const kl = `tl-z ${FARBE[z.art]}${auswahl === z.id ? " gewaehlt" : ""}${istEntwurf ? " entwurf" : ""}`;
    const griff = (x, y, h) => (auswahl === z.id && !istEntwurf ? `<circle class="tl-griff" cx="${f1(x)}" cy="${f1(y)}" r="5" data-griff="${h}"/>` : "");
    const name = (x, y, extra) => `<text class="tl-z-name" x="${f1(x)}" y="${f1(y)}">${esc(z.name ? `${z.id} · ${z.name}` : z.id)}${extra || ""}</text>`;
    const halb = (geo.pw / geo.span) / 2;
    const linie = (x1, y1, x2, y2, extra) => `<line class="tl-treffer" x1="${f1(x1)}" y1="${f1(y1)}" x2="${f1(x2)}" y2="${f1(y2)}"/><line${extra ? ` class="${extra}"` : ""} x1="${f1(x1)}" y1="${f1(y1)}" x2="${f1(x2)}" y2="${f1(y2)}"/>`;
    // Punkt auf der Geraden a→b bei Index i
    const aufLinie = (a, b, i, d0) => { const ia = T.indexGenau(k, a.t), ib = T.indexGenau(k, b.t); return ib === ia ? a.p + (d0 || 0) : a.p + ((b.p - a.p) * (i - ia)) / (ib - ia) + (d0 || 0); };
    switch (z.art) {
      case "linie": {
        const y = Y(z.p), x = z.t != null ? X(T.indexGenau(k, z.t)) : geo.pw / 2;
        return `<g class="${kl}" data-id="${z.id}">${linie(0, y, geo.pw, y)}${griff(x, y, "p")}${name(6, y - 5)}</g>`;
      }
      case "strahl": {
        const y = Y(z.p), x = X(T.indexGenau(k, z.t)) - halb;
        return `<g class="${kl}" data-id="${z.id}">${linie(x, y, geo.pw + 4, y)}<circle class="tl-anker" cx="${f1(x)}" cy="${f1(y)}" r="2.5"/>${griff(x, y, "p")}${name(x + 6, y - 5)}</g>`;
      }
      case "senkrecht": {
        const x = X(T.indexGenau(k, z.t)), ym = (M.o + geo.H - M.u) / 2;
        return `<g class="${kl}" data-id="${z.id}">${linie(x, M.o, x, geo.H - M.u)}${griff(x, ym, "t")}${name(x + 5, M.o + 12)}</g>`;
      }
      case "trend": {
        const ia = T.indexGenau(k, z.a.t), ib = T.indexGenau(k, z.b.t);
        const x1 = X(ia), y1 = Y(z.a.p), x2 = X(ib), y2 = Y(z.b.p);
        const weit = geo.span * 2;
        const rechts = ia <= ib ? [x2, y2, ib] : [x1, y1, ia], links = ia <= ib ? [x1, y1, ia] : [x2, y2, ib];
        const xr = z.verl && ib !== ia ? [X(rechts[2] + weit), Y(aufLinie(z.a, z.b, rechts[2] + weit))] : [rechts[0], rechts[1]];
        const xl = z.vorne && ib !== ia ? [X(links[2] - weit), Y(aufLinie(z.a, z.b, links[2] - weit))] : [links[0], links[1]];
        return `<g class="${kl}" data-id="${z.id}"><line class="tl-treffer" x1="${f1(xl[0])}" y1="${f1(xl[1])}" x2="${f1(xr[0])}" y2="${f1(xr[1])}"/>`
          + `<line x1="${f1(x1)}" y1="${f1(y1)}" x2="${f1(x2)}" y2="${f1(y2)}"/>${z.verl ? `<line class="verl" x1="${f1(rechts[0])}" y1="${f1(rechts[1])}" x2="${f1(xr[0])}" y2="${f1(xr[1])}"/>` : ""}`
          + `${z.vorne ? `<line class="verl" x1="${f1(links[0])}" y1="${f1(links[1])}" x2="${f1(xl[0])}" y2="${f1(xl[1])}"/>` : ""}`
          + `${griff(x1, y1, "a")}${griff(x2, y2, "b")}${name(x1 + 6, y1 - 6)}</g>`;
      }
      case "kanal": {
        const ia = T.indexGenau(k, z.a.t), ib = T.indexGenau(k, z.b.t), i0 = Math.min(ia, ib), i1 = Math.max(ia, ib) + (z.verl ? geo.span * 2 : 0);
        const p = (i, dd) => [X(i), Y(aufLinie(z.a, z.b, i, dd))];
        const [ax, ay] = p(i0, 0), [bx, by] = p(i1, 0), [cx, cy] = p(i1, z.d), [dx, dy] = p(i0, z.d);
        const [mx0, my0] = p(i0, z.d / 2), [mx1, my1] = p(i1, z.d / 2);
        const im = (ia + ib) / 2, [gx, gy] = p(im, z.d);
        return `<g class="${kl}" data-id="${z.id}"><path class="tl-kanal-flaeche" d="M${f1(ax)} ${f1(ay)}L${f1(bx)} ${f1(by)}L${f1(cx)} ${f1(cy)}L${f1(dx)} ${f1(dy)}Z"/>`
          + `${linie(ax, ay, bx, by)}${linie(dx, dy, cx, cy)}<line class="mitte" x1="${f1(mx0)}" y1="${f1(my0)}" x2="${f1(mx1)}" y2="${f1(my1)}"/>`
          + `${griff(X(ia), Y(z.a.p), "a")}${griff(X(ib), Y(z.b.p), "b")}${griff(gx, gy, "d")}${name(ax + 6, Math.min(ay, dy) - 6)}</g>`;
      }
      case "fib": {
        const ia = T.indexGenau(k, z.a.t), ib = T.indexGenau(k, z.b.t);
        const xl = X(Math.min(ia, ib)) - halb, xr = z.verl ? geo.pw + 4 : X(Math.max(ia, ib)) + halb;
        let s = `<g class="${kl}" data-id="${z.id}"><line class="verl" x1="${f1(X(ia))}" y1="${f1(Y(z.a.p))}" x2="${f1(X(ib))}" y2="${f1(Y(z.b.p))}"/>`;
        const stufen = T.FIB_STUFEN;
        stufen.forEach((st, j) => {
          const y = Y(T.fibPreis(z, st));
          if (j < stufen.length - 1) { const y2 = Y(T.fibPreis(z, stufen[j + 1])); s += `<rect class="tl-fib-band b${j % 2}" x="${f1(xl)}" y="${f1(Math.min(y, y2))}" width="${f1(Math.max(1, xr - xl))}" height="${f1(Math.abs(y2 - y))}"/>`; }
          s += `${linie(xl, y, xr, y, st === 0.618 || st === 0.5 ? "stark" : "")}<text class="tl-fib-text" x="${f1(xl + 4)}" y="${f1(y - 3)}">${nf(1).format(st * 100)} % · ${nf(Math.min(4, dez())).format(T.fibPreis(z, st))}</text>`;
        });
        return s + `${griff(X(ia), Y(z.a.p), "a")}${griff(X(ib), Y(z.b.p), "b")}${name(xl + 4, Y(T.fibPreis(z, 0)) - 16)}</g>`;
      }
      case "position": {
        const x1 = X(T.indexGenau(k, z.t)) - halb, x2 = X(T.indexGenau(k, z.t1)) + halb, ye = Y(z.ein), ys = Y(z.stop), yz = Y(z.ziel);
        const lang = T.istPositionLong(z), risiko = Math.abs(z.ein - z.stop) / z.ein, chance = Math.abs(z.ziel - z.ein) / z.ein;
        const breite = Math.max(4, x2 - x1);
        return `<g class="${kl} tl-pos" data-id="${z.id}"><rect class="tl-pos-ziel" x="${f1(x1)}" y="${f1(Math.min(ye, yz))}" width="${f1(breite)}" height="${f1(Math.abs(yz - ye))}"/>`
          + `<rect class="tl-pos-stop" x="${f1(x1)}" y="${f1(Math.min(ye, ys))}" width="${f1(breite)}" height="${f1(Math.abs(ys - ye))}"/>`
          + `${linie(x1, ye, x1 + breite, ye, "ein")}`
          + `<text class="tl-pos-text plus" x="${f1(x1 + 6)}" y="${f1(lang ? yz + 13 : yz - 5)}">Ziel ${pct(lang ? chance : -chance)} · CRV ${nf(1).format(chance / risiko)}</text>`
          + `<text class="tl-pos-text minus" x="${f1(x1 + 6)}" y="${f1(lang ? ys - 5 : ys + 13)}">Stop ${pct(lang ? -risiko : risiko)}</text>`
          + `${griff(x1, ye, "ein")}${griff(x1 + breite / 2, yz, "ziel")}${griff(x1 + breite / 2, ys, "stop")}${griff(x1 + breite, ye, "t1")}${name(x1 + 6, ye - 5, ` · ${lang ? "Long" : "Short"}`)}</g>`;
      }
      default: { // Zone
        const i0 = T.indexGenau(k, Math.min(z.t0, z.t1)), i1 = T.indexGenau(k, Math.max(z.t0, z.t1));
        const xa = X(i0) - halb, xb = z.verl ? Math.max(geo.pw, X(i1)) : X(i1) + halb;
        const ya = Y(Math.max(z.oben, z.unten)), yb = Y(Math.min(z.oben, z.unten));
        return `<g class="${kl}" data-id="${z.id}"><rect x="${f1(xa)}" y="${f1(ya)}" width="${f1(Math.max(1, xb - xa))}" height="${f1(Math.max(1, yb - ya))}"/>`
          + `${z.verl ? `<line class="verl" x1="${f1(X(i1) + halb)}" x2="${f1(xb)}" y1="${f1((ya + yb) / 2)}" y2="${f1((ya + yb) / 2)}"/>` : ""}`
          + `${griff(xa, ya, "lo")}${griff(X(i1) + halb, yb, "ru")}${name(xa + 6, ya + 14)}</g>`;
      }
    }
  }
  // Die gewählte Zeichnung zuletzt, damit ihre Griffe über allen anderen liegen
  function zeichnungenSvg(X, Y) {
    const l = akt().zeichnungen;
    return l.filter((z) => z.id !== auswahl).concat(l.filter((z) => z.id === auswahl)).map((z) => zeichnungSvg(z, X, Y, false)).join("");
  }
  function tradesSvg(X, Y) {
    if (!ergebnis || ergebnis.wert !== w.s || ergebnis.ebene !== zustand.ebene || !ergebnis.e) return "";
    const long = ergebnis.e.regeln.richtung === "long";
    return ergebnis.e.trades.filter((t) => t.aus_i >= sicht.i0 - 2 && t.ein_i <= sicht.i1 + 2).map((t) => {
      const x1 = X(t.ein_i), x2 = X(t.aus_i), y1 = Y(t.ein), y2 = Y(t.aus), gut = t.netto > 0;
      const pfeilEin = long ? `M${x1} ${Y(k.l[t.ein_i]) + 6}l-5 9h10z` : `M${x1} ${Y(k.h[t.ein_i]) - 6}l-5 -9h10z`;
      const pfeilAus = long ? `M${x2} ${Y(k.h[t.aus_i]) - 6}l-5 -9h10z` : `M${x2} ${Y(k.l[t.aus_i]) + 6}l-5 9h10z`;
      return `<g class="tl-trade ${gut ? "gut" : "schlecht"}">`
        + (t.stop != null ? `<line class="tl-stop" x1="${x1}" x2="${x2}" y1="${Y(t.stop).toFixed(1)}" y2="${Y(t.stop).toFixed(1)}"/>` : "")
        + (t.ziel != null ? `<line class="tl-ziel" x1="${x1}" x2="${x2}" y1="${Y(t.ziel).toFixed(1)}" y2="${Y(t.ziel).toFixed(1)}"/>` : "")
        + `<line class="tl-weg" x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"/>`
        + `<path class="tl-pfeil ein" d="${pfeilEin}"/><path class="tl-pfeil aus" d="${pfeilAus}"/></g>`;
    }).join("");
  }
  function ohlcZeigen(i) {
    const el = wurzel && $('[data-tl="ohlc"]', wurzel);
    if (!el || i == null || i < 0 || i >= k.c.length) return;
    const d = dez(), auf = k.c[i] >= k.o[i];
    const ind = akt().indikatoren.filter((x) => IM_CHART.includes(x.art)).map((x) => {
      const r = T.indikatorReihen(k, x), v = x.art === "bb" ? r.mitte[i] : r.linie[i];
      return Number.isFinite(v) ? ` <span>${esc(T.indName(x))}</span> ${zahl(v, d)}` : "";
    }).join("");
    el.innerHTML = `<b>${zeitText(k.tag[i])}</b> <span>E</span> ${zahl(k.o[i], d)} <span>H</span> ${zahl(k.h[i], d)} <span>T</span> ${zahl(k.l[i], d)} <span>S</span> <b class="${auf ? "plus" : "minus"}">${zahl(k.c[i], d)}</b>`
      + (i > 0 ? ` <i class="${ton(k.c[i] / k.c[i - 1] - 1)}">${pct(k.c[i] / k.c[i - 1] - 1, 2)}</i>` : "") + (ind ? `<span class="tl-ohlc-ind">${ind}</span>` : "");
  }

  /* ================================================================ Maus und Finger */
  function punktAus(e) {
    const svg = $('[data-tl="chart"] svg', wurzel), r = svg.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    let i = geo.I(x), preis = geo.P(y);
    const n = k.c.length, ir = Math.round(i);
    if (magnet && ir >= 0 && ir < n) { // an Eröffnung, Hoch, Tief oder Schluss einrasten, wenn nah genug
      const kand = [k.o[ir], k.h[ir], k.l[ir], k.c[ir]];
      const naechst = kand.reduce((b, v) => (Math.abs(geo.Y(v) - y) < Math.abs(geo.Y(b) - y) ? v : b), kand[0]);
      if (Math.abs(geo.Y(naechst) - y) < 12) preis = naechst;
    }
    const t = tagAus(ir);
    const zone = x > geo.pw ? "preis" : y > geo.H - M.u ? "zeit" : "";
    return { x, y, i, ir, t, preis, zone };
  }
  const schritt = () => (k.c.length > 1 ? (k.tag[k.c.length - 1] - k.tag[0]) / (k.c.length - 1) : 1);
  // Zeit an Kerze ir; links und rechts der Daten im mittleren Abstand weitergezählt (gerundet auf Minute bzw. Tag)
  function tagAus(ir) { const n = k.c.length; return ir >= 0 && ir < n ? k.tag[ir] : T.rundeZeit(zeitBei(k, ir), zustand.ebene); }
  function trefferBei(e) {
    const g = e.target.closest("[data-griff]"); if (g) return { id: g.closest("[data-id]").dataset.id, griff: g.dataset.griff };
    const z = e.target.closest(".tl-z[data-id]"); if (z && !z.classList.contains("entwurf")) return { id: z.dataset.id, griff: null };
    return null;
  }
  function runde(p) { const d = w.dez != null ? Math.min(6, w.dez + 1) : 4; return +p.toFixed(d); }
  function setzeWerkzeug(neu) {
    werkzeug = neu; entwurf = null;
    $$("[data-werkzeug]", wurzel).forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.werkzeug === neu)));
    hilfe(); zeichne();
  }
  function neuePosition(p, long) {
    const { lo, hi } = preisSkala || sichtbarePreise(), ein = runde(p.preis), risiko = (hi - lo) * 0.05 || ein * 0.02;
    const z = { id: T.neueId(akt().zeichnungen, "position"), art: "position", t: p.t, t1: T.rundeZeit(p.t + 20 * schritt(), zustand.ebene), ein,
      stop: runde(long ? ein - risiko : ein + risiko), ziel: runde(long ? ein + 2 * risiko : ein - 2 * risiko), name: "" };
    return z;
  }
  // Neu zeichnen höchstens einmal je Bild (Mausrad, Trackpad und Ziehen liefern viele Ereignisse)
  let bildPlan = 0, letzteMaus = null;
  function neuZeichnen() {
    if (bildPlan) return;
    bildPlan = requestAnimationFrame(() => {
      bildPlan = 0; zeichne();
      if (letzteMaus && geo && k) kreuz(punktAus(letzteMaus));
    });
  }
  const finger = new Map();  // aktive Berührungen für das Zoomen mit zwei Fingern
  let zwei = null;
  function bindeChart() {
    const box = $('[data-tl="chart"]', wurzel);
    box.addEventListener("pointerdown", (e) => {
      if (!geo || !k || e.button > 0) return;
      if (e.pointerType === "touch") {
        finger.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (finger.size === 2) { // zweiter Finger: Zeichnen oder Verschieben abbrechen, Zoomen beginnen
          if (ziehen && ziehen.art === "neu") entwurf = null;
          ziehen = null; box.classList.remove("schiebt");
          const [f1, f2] = [...finger.values()], r = box.getBoundingClientRect();
          zwei = { abstand: Math.max(20, Math.hypot(f1.x - f2.x, f1.y - f2.y)), sicht: { ...sicht }, i: geo.I((f1.x + f2.x) / 2 - r.left) };
          box.setPointerCapture(e.pointerId); neuZeichnen(); return;
        }
        if (finger.size > 2) return;
      }
      const p = punktAus(e);
      box.focus({ preventScroll: true });
      if (menueOffen) menueZu(false);
      if (sucheOffen) sucheZu(false);
      if (p.zone === "preis") { ziehen = { art: "preis", y: p.y, skala: preisSkala || { lo: geo.lo, hi: geo.hi } }; box.setPointerCapture(e.pointerId); return; }
      if (p.zone === "zeit") { ziehen = { art: "zeit", x: p.x, sicht: { ...sicht } }; box.setPointerCapture(e.pointerId); return; }
      const neu = (z) => { akt().zeichnungen.push(z); auswahl = z.id; geaendert(); setzeWerkzeug("zeiger"); };
      if (akt().zeichnungen.length >= 40 && werkzeug !== "zeiger") { melden("Höchstens 40 Zeichnungen je Wert."); setzeWerkzeug("zeiger"); return; }
      if (werkzeug === "linie") { neu({ id: T.neueId(akt().zeichnungen, "linie"), art: "linie", p: runde(p.preis), t: p.t, name: "" }); return; }
      if (werkzeug === "strahl") { neu({ id: T.neueId(akt().zeichnungen, "strahl"), art: "strahl", p: runde(p.preis), t: p.t, name: "" }); return; }
      if (werkzeug === "senkrecht") { neu({ id: T.neueId(akt().zeichnungen, "senkrecht"), art: "senkrecht", t: T.rundeZeit(p.t, zustand.ebene), name: "" }); return; }
      if (werkzeug === "long" || werkzeug === "short") { neu(neuePosition(p, werkzeug === "long")); return; }
      if (ZWEI_PUNKTE.includes(werkzeug)) {
        if (entwurf && entwurf.art === "kanal" && entwurf.breite) { fertig(p); return; }
        if (entwurf && entwurf.zweiterKlick) { zweiterPunkt(p); return; }
        const pp = { t: p.t, p: runde(p.preis) };
        const id = T.neueId(akt().zeichnungen, werkzeug);
        entwurf = werkzeug === "zone" ? { id, art: "zone", t0: p.t, t1: p.t, oben: pp.p, unten: pp.p, verl: true, name: "", start: p }
          : werkzeug === "kanal" ? { id, art: "kanal", a: pp, b: { ...pp }, d: 0, verl: true, name: "", start: p }
          : werkzeug === "fib" ? { id, art: "fib", a: pp, b: { ...pp }, verl: true, name: "", start: p }
          : { id, art: "trend", a: pp, b: { ...pp }, verl: true, vorne: false, name: "", start: p };
        box.setPointerCapture(e.pointerId); ziehen = { art: "neu" }; zeichne(); return;
      }
      const hit = trefferBei(e);
      if (hit) {
        auswahl = hit.id; liste();
        const z = akt().zeichnungen.find((x) => x.id === hit.id);
        ziehen = { art: hit.griff ? "griff" : "ganz", griff: hit.griff, z, start: p, kopie: JSON.parse(JSON.stringify(z)) };
        box.setPointerCapture(e.pointerId); zeichne(); return;
      }
      if (auswahl) { auswahl = null; liste(); }
      // Verschieben: waagerecht immer, senkrecht nur bei Preisachse von Hand
      ziehen = { art: "schieben", x: p.x, y: p.y, sicht: { ...sicht }, skala: preisSkala ? { ...preisSkala } : null };
      box.setPointerCapture(e.pointerId); box.classList.add("schiebt");
    });
    box.addEventListener("pointermove", (e) => {
      if (!geo || !k) return;
      if (finger.has(e.pointerId)) finger.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (zwei && finger.size >= 2) {
        const [f1, f2] = [...finger.values()], r = box.getBoundingClientRect();
        const faktor = zwei.abstand / Math.max(20, Math.hypot(f1.x - f2.x, f1.y - f2.y));
        const span = Math.min(Math.max(MIN_SPANNE, (zwei.sicht.i1 - zwei.sicht.i0) * faktor), maxSpanne());
        const mx = (f1.x + f2.x) / 2 - r.left, i0 = zwei.i + 0.5 - (mx / geo.pw) * span;  // derselbe Zeitpunkt bleibt unter der Mitte der Finger
        setzeSicht(i0, i0 + span); return;
      }
      const p = punktAus(e);
      letzteMaus = { clientX: e.clientX, clientY: e.clientY };
      if (!ziehen) {
        box.dataset.zone = p.zone;
        kreuz(p);
        if (entwurf && (entwurf.zweiterKlick || entwurf.breite)) { aktualisiereEntwurf(p); zeichne(); kreuz(p); }
        return;
      }
      if (ziehen.art === "schieben") {
        const di = ((ziehen.x - p.x) / geo.pw) * (ziehen.sicht.i1 - ziehen.sicht.i0);
        if (ziehen.skala) { const dp = ((p.y - ziehen.y) / geo.ph) * (ziehen.skala.hi - ziehen.skala.lo); preisSkala = { lo: ziehen.skala.lo + dp, hi: ziehen.skala.hi + dp }; }
        setzeSicht(ziehen.sicht.i0 + di, ziehen.sicht.i1 + di); return;
      }
      if (ziehen.art === "preis") { // nach unten ziehen staucht, nach oben streckt (wie in gängigen Charttools)
        const f = Math.exp(Math.max(-600, Math.min(600, p.y - ziehen.y)) * 0.005), mitte = (ziehen.skala.lo + ziehen.skala.hi) / 2, halb = ((ziehen.skala.hi - ziehen.skala.lo) / 2) * f;
        preisSkala = { lo: mitte - halb, hi: mitte + halb }; autoKnopf(); neuZeichnen(); return;
      }
      if (ziehen.art === "zeit") { // nach rechts ziehen zeigt weniger Kerzen; der rechte Rand bleibt stehen
        const span = Math.min(Math.max(MIN_SPANNE, (ziehen.sicht.i1 - ziehen.sicht.i0) * Math.exp(-(p.x - ziehen.x) * 0.005)), maxSpanne());
        setzeSicht(ziehen.sicht.i1 - span, ziehen.sicht.i1); return;
      }
      if (ziehen.art === "neu") { aktualisiereEntwurf(p); zeichne(); kreuz(p); return; }
      bewege(ziehen, p);
      ergebnis = null; zeichne(); kreuz(p);
    });
    const loslassen = (e) => {
      if (finger.has(e.pointerId)) { finger.delete(e.pointerId); if (zwei) { if (finger.size < 2) zwei = null; return; } }
      if (!ziehen) return;
      const art = ziehen.art; ziehen = null; box.classList.remove("schiebt");
      if (art === "neu" && entwurf) {
        const p = punktAus(e), weit = Math.hypot(p.x - entwurf.start.x, p.y - entwurf.start.y) > 6;
        if (weit) zweiterPunkt(p); else { entwurf.zweiterKlick = true; } // erster Klick: zweiter Punkt folgt mit dem nächsten Klick
        return;
      }
      if (art === "ganz" || art === "griff") { normalisiere(); geaendert(); }
    };
    box.addEventListener("pointerup", loslassen);
    box.addEventListener("pointercancel", loslassen);
    box.addEventListener("pointerleave", () => { letzteMaus = null; const g = $(".tl-kreuz", box); if (g) g.setAttribute("hidden", ""); panes(); });
    box.addEventListener("dblclick", (e) => {
      if (!geo || !k) return;
      const p = punktAus(e);
      if (p.zone === "preis") { preisSkala = null; autoKnopf(); neuZeichnen(); }
      else if (p.zone === "zeit") zuruecksetzen();
    });
    box.addEventListener("wheel", (e) => {
      if (!geo || !k) return;
      e.preventDefault();
      // Pixel je Ereignis: Mausrad (Zeilen oder Seiten) und Trackpad gleich behandeln
      const f = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? geo.H : 1;
      let dx = e.deltaX * f, dy = e.deltaY * f;
      if (e.shiftKey && Math.abs(dx) < Math.abs(dy)) { dx = dy; dy = 0; }
      const p = punktAus(e);
      letzteMaus = { clientX: e.clientX, clientY: e.clientY };
      if (p.zone === "preis" && !e.ctrlKey) {
        const basis = preisSkala || { lo: geo.lo, hi: geo.hi }, g = Math.exp(Math.max(-200, Math.min(200, dy)) * 0.002);
        const mitte = (basis.lo + basis.hi) / 2, halb = ((basis.hi - basis.lo) / 2) * g;
        preisSkala = { lo: mitte - halb, hi: mitte + halb }; autoKnopf(); neuZeichnen(); return;
      }
      if (!e.ctrlKey && Math.abs(dx) > Math.abs(dy)) { // waagerecht wischen verschiebt
        const di = (dx / geo.pw) * (sicht.i1 - sicht.i0);
        setzeSicht(sicht.i0 + di, sicht.i1 + di); return;
      }
      // Zoomen um den Mauszeiger; Trackpad-Spreizen (Strg + Rad) etwas kräftiger, damit es der Fingerbewegung folgt
      zoom(Math.exp(Math.max(-300, Math.min(300, dy)) * (e.ctrlKey ? 0.01 : 0.0015)), p.i);
    }, { passive: false });
    box.addEventListener("keydown", (e) => {
      if (!k) return;
      if ((e.key === "Delete" || e.key === "Backspace") && auswahl) { e.preventDefault(); loesche(auswahl); }
      else if (e.key === "Escape" && (entwurf || werkzeug !== "zeiger")) { e.preventDefault(); e.stopPropagation(); setzeWerkzeug("zeiger"); }
      else if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); const d = (e.key === "ArrowRight" ? 1 : -1) * (sicht.i1 - sicht.i0) * 0.1; setzeSicht(sicht.i0 + d, sicht.i1 + d); }
      else if (e.key === "+" || e.key === "=" || e.key === "-" || e.key === "_") { e.preventDefault(); knopfZoom(e.key === "+" || e.key === "=" ? 1 : -1); }
      else if (e.key === "0" || e.key === "Home") { e.preventDefault(); zuruecksetzen(); }
      else if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        const taste = TASTEN[e.key.toLowerCase()];
        if (taste) { e.preventDefault(); setzeWerkzeug(taste); }
      }
    });
  }
  // Höhe des Charts am Griff darunter ändern (Maus, Finger, Pfeiltasten); merkt sich dieser Browser
  function bindeGroesse() {
    const griff = $("[data-tl-groesse]", wurzel), box = $('[data-tl="chart"]', wurzel);
    if (!griff) return;
    let start = null;
    const setze = (h, merken) => {
      h = Math.round(Math.min(1000, Math.max(240, h)));
      box.style.height = h + "px"; griff.setAttribute("aria-valuenow", String(h));
      if (merken) { zustand.hoehe = h; sichern(); }
      neuZeichnen();
    };
    griff.setAttribute("aria-valuemin", "240"); griff.setAttribute("aria-valuemax", "1000");
    griff.setAttribute("aria-valuenow", String(zustand.hoehe || Math.round(box.clientHeight) || 440));
    griff.addEventListener("pointerdown", (e) => { if (e.button > 0) return; start = { y: e.clientY, h: box.clientHeight }; griff.setPointerCapture(e.pointerId); griff.classList.add("aktiv"); e.preventDefault(); });
    griff.addEventListener("pointermove", (e) => { if (start) setze(start.h + e.clientY - start.y, false); });
    const ende = () => { if (!start) return; start = null; griff.classList.remove("aktiv"); setze(box.clientHeight, true); };
    griff.addEventListener("pointerup", ende); griff.addEventListener("pointercancel", ende);
    griff.addEventListener("dblclick", () => { zustand.hoehe = null; sichern(); box.style.height = ""; griff.setAttribute("aria-valuenow", String(Math.round(box.clientHeight))); neuZeichnen(); });
    griff.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      e.preventDefault(); setze(box.clientHeight + (e.key === "ArrowDown" ? 24 : -24), true);
    });
  }
  // Ziehen einer ganzen Zeichnung oder eines Griffs
  function bewege(zg, p) {
    const z = zg.z, alt = zg.kopie, dp = p.preis - zg.start.preis, dt = p.t - zg.start.t;
    const pkt = (x) => ({ t: x.t + dt, p: runde(x.p + dp) });
    if (zg.art === "ganz") {
      if (z.art === "linie") z.p = runde(alt.p + dp);
      if (z.art === "strahl") { z.p = runde(alt.p + dp); z.t = alt.t + dt; }
      if (z.art === "senkrecht") z.t = T.rundeZeit(alt.t + dt, zustand.ebene);
      if (["trend", "kanal", "fib"].includes(z.art)) { z.a = pkt(alt.a); z.b = pkt(alt.b); }
      if (z.art === "zone") { z.t0 = alt.t0 + dt; z.t1 = alt.t1 + dt; z.oben = runde(alt.oben + dp); z.unten = runde(alt.unten + dp); }
      if (z.art === "position") { z.t = alt.t + dt; z.t1 = alt.t1 + dt; z.ein = runde(alt.ein + dp); z.stop = runde(alt.stop + dp); z.ziel = runde(alt.ziel + dp); }
      return;
    }
    const g = zg.griff, pr = runde(p.preis);
    if (z.art === "linie") z.p = pr;
    if (z.art === "strahl") { z.p = pr; z.t = p.t; }
    if (z.art === "senkrecht") z.t = T.rundeZeit(p.t, zustand.ebene);
    if ((z.art === "trend" || z.art === "kanal" || z.art === "fib") && (g === "a" || g === "b")) z[g] = { t: p.t, p: pr };
    if (z.art === "kanal" && g === "d") z.d = runde(p.preis - basisPreis(z, p.i));
    if (z.art === "zone" && g === "lo") { z.t0 = p.t; z.oben = pr; }
    if (z.art === "zone" && g === "ru") { z.t1 = p.t; z.unten = pr; }
    if (z.art === "position") {
      const lang = alt.ziel > alt.ein;
      if (g === "ein") { z.t = Math.min(p.t, alt.t1 - schritt()); const v = pr; if (lang ? v > alt.stop && v < alt.ziel : v < alt.stop && v > alt.ziel) z.ein = v; }
      if (g === "stop" && (lang ? pr < alt.ein : pr > alt.ein)) z.stop = pr;
      if (g === "ziel" && (lang ? pr > alt.ein : pr < alt.ein)) z.ziel = pr;
      if (g === "t1" && p.t > alt.t) z.t1 = p.t;
    }
  }
  // Preis der Grundlinie eines Kanals bei Index i
  function basisPreis(z, i) {
    const ia = T.indexGenau(k, z.a.t), ib = T.indexGenau(k, z.b.t);
    return ib === ia ? z.a.p : z.a.p + ((z.b.p - z.a.p) * (i - ia)) / (ib - ia);
  }
  function aktualisiereEntwurf(p) {
    if (!entwurf) return;
    if (entwurf.art === "kanal" && entwurf.breite) { entwurf.d = runde(p.preis - basisPreis(entwurf, p.i)); return; }
    if (entwurf.art === "zone") { entwurf.t1 = p.t; entwurf.unten = runde(p.preis); return; }
    entwurf.b = { t: p.t, p: runde(p.preis) };
  }
  function zweiterPunkt(p) {
    aktualisiereEntwurf(p);
    if (entwurf.art === "kanal") { // dritter Schritt: Breite festlegen
      if (entwurf.a.t === entwurf.b.t) { entwurf = null; zeichne(); return; }
      entwurf.zweiterKlick = false; entwurf.breite = true; zeichne(); return;
    }
    fertig(p);
  }
  function fertig(p) {
    aktualisiereEntwurf(p);
    const z = entwurf; entwurf = null;
    delete z.start; delete z.zweiterKlick; delete z.breite;
    if ((z.art === "trend" || z.art === "kanal") && z.a.t === z.b.t) { zeichne(); return; } // senkrecht: dafür gibt es die senkrechte Linie
    if (z.art === "fib" && z.a.p === z.b.p) { zeichne(); return; }
    akt().zeichnungen.push(z); auswahl = z.id; normalisiere(); geaendert(); setzeWerkzeug("zeiger");
  }
  function normalisiere() {
    akt().zeichnungen.forEach((z) => {
      if (z.art === "zone") { const o = Math.max(z.oben, z.unten), u = Math.min(z.oben, z.unten); z.oben = o; z.unten = u; if (z.t1 < z.t0) [z.t0, z.t1] = [z.t1, z.t0]; }
      if ((z.art === "trend" || z.art === "kanal") && z.b.t < z.a.t) {
        if (z.art === "kanal") { const d = z.d; [z.a, z.b] = [z.b, z.a]; z.d = d; } else [z.a, z.b] = [z.b, z.a];
      }
      if (z.art === "position" && z.t1 <= z.t) z.t1 = z.t + 20 * schritt();
    });
  }
  function kreuz(p) {
    const g = $('[data-tl="chart"] .tl-kreuz', wurzel);
    if (!g || p.x > geo.pw || p.y > geo.H - M.u) { if (g) g.setAttribute("hidden", ""); return; }
    g.removeAttribute("hidden");
    const x = geo.X(Math.round(p.i));
    $(".tl-kreuz-v", g).setAttribute("x1", x); $(".tl-kreuz-v", g).setAttribute("x2", x);
    $(".tl-kreuz-h", g).setAttribute("y1", p.y); $(".tl-kreuz-h", g).setAttribute("y2", p.y);
    $(".tl-kreuz-marke", g).setAttribute("y", p.y - 9);
    const t = $(".tl-kreuz-text", g); t.setAttribute("y", p.y + 4);
    t.textContent = nf(dez()).format(geo.P(p.y));
    // Zeit unten an der Zeitachse
    const zt = $(".tl-kreuz-text.zeit", g), zm = $(".tl-kreuz-marke.zeit", g);
    zt.textContent = zeitText(p.t, true);
    const breite = zt.textContent.length * 6.4 + 14, xm = Math.min(geo.pw - breite / 2, Math.max(breite / 2, x));
    zt.setAttribute("x", xm.toFixed(1)); zm.setAttribute("x", (xm - breite / 2).toFixed(1)); zm.setAttribute("width", breite.toFixed(1));
    if (p.ir >= 0 && p.ir < k.c.length) { ohlcZeigen(p.ir); panes(p.ir); }
  }
  // Sicht setzen: höchstens alle Kerzen plus Rand, mindestens MIN_SPANNE; etwas Platz links und rechts der Daten
  const maxSpanne = () => Math.max(MIN_SPANNE, k.c.length + 40);
  function setzeSicht(i0, i1, still) {
    const n = k.c.length;
    let span = Math.min(Math.max(MIN_SPANNE, i1 - i0), maxSpanne());
    if (span !== i1 - i0) { const m = (i0 + i1) / 2; i0 = m - span / 2; i1 = m + span / 2; }
    if (span >= n) { i1 = n + 4; i0 = i1 - span; }  // alles zu sehen: Kerzen rechtsbündig
    if (i1 > n + span * 0.6) { i1 = n + span * 0.6; i0 = i1 - span; }
    if (i0 < -span * 0.4) { i0 = -span * 0.4; i1 = i0 + span; }
    sicht = { i0, i1 };
    if (!still) neuZeichnen();
  }
  const verschiebe = (i0, i1) => setzeSicht(i0, i1);
  function zoom(faktor, um) {
    const span = sicht.i1 - sicht.i0;
    // Herauszoomen bei sichtbarer jüngster Kerze: der rechte Rand bleibt stehen (sonst wandert der Chart ins Leere)
    if (faktor > 1 && sicht.i1 >= k.c.length - 1) um = sicht.i1;
    const neu = Math.min(Math.max(MIN_SPANNE, span * faktor), maxSpanne());
    if (Math.abs(neu - span) < 1e-9) return;
    const anteil = (um - sicht.i0) / span, i0 = um - anteil * neu;
    setzeSicht(i0, i0 + neu);
  }
  // Knöpfe und Tasten: am rechten Rand verankert, solange die jüngste Kerze zu sehen ist, sonst um die Mitte
  function knopfZoom(r) {
    const rechts = sicht.i1 >= k.c.length - 1;
    zoom(r > 0 ? 1 / 1.3 : 1.3, rechts ? sicht.i1 : (sicht.i0 + sicht.i1) / 2);
  }
  function zuruecksetzen() { if (!k) return; preisSkala = null; autoKnopf(); const s = standardSicht(); setzeSicht(s.i0, s.i1); }
  function autoKnopf() { const b = wurzel && $("[data-tl-auto]", wurzel); if (b) b.setAttribute("aria-pressed", String(!preisSkala)); }
  function loesche(id) {
    const a = akt(); a.zeichnungen = a.zeichnungen.filter((z) => z.id !== id);
    if (auswahl === id) auswahl = null;
    geaendert();
  }
  function geaendert() {
    ergebnis = null; sichern(); liste(); indListe(); chips(); zeichne(); ergebnisZeigen();
    if (deutung) deutungZeigen(true);
  }
  function melden(t) {
    const el = wurzel && $('[data-tl="hilfe"]', wurzel);
    if (el) { el.textContent = t; clearTimeout(melden.z); melden.z = setTimeout(hilfe, 5000); }
  }

  /* ================================================================ Formular */
  function formAenderung(e) {
    const t = e.target;
    if (t.dataset.tl === "kosten") { zustand.kosten = +t.value; ergebnis = null; ergebnisZeigen(); sichern(); return; }
    if (t.dataset.tl === "nurDanach") { zustand.nurDanach = t.checked; ergebnis = null; ergebnisZeigen(); sichern(); return; }
    if (t.dataset.tlVerl) { const z = akt().zeichnungen.find((x) => x.id === t.dataset.tlVerl); if (z) { z.verl = t.checked; geaendert(); } }
    if (t.dataset.tlVorne) { const z = akt().zeichnungen.find((x) => x.id === t.dataset.tlVorne); if (z) { z.vorne = t.checked; geaendert(); } }
  }
  function formEingabe(e) {
    const t = e.target;
    if (t.dataset.tl === "text") { akt().text = t.value; sichern(); return; }
    if (t.dataset.tlName) {
      const z = akt().zeichnungen.find((x) => x.id === t.dataset.tlName);
      if (z) { z.name = t.value.replace(/[^\p{L}\p{N} ._-]/gu, "").slice(0, 30); sichern(); chips(); zeichne(); }
    }
  }
  function klick(e) {
    const t = e.target;
    if (t.closest("[data-tl-symbol]")) { if (sucheOffen) sucheZu(true); else sucheAuf(); return; }
    const tr = t.closest("[data-tl-treffer]");
    if (tr) { const x = suchListe[+tr.dataset.tlTreffer]; if (x) symbolWaehlen(x); return; }
    if (sucheOffen && !t.closest(".tl-symbol-feld")) sucheZu(false);
    const eb = t.closest("[data-tl-ebene]");
    if (eb) { ebeneWaehlen(eb.dataset.tlEbene); return; }
    if (t.closest("[data-tl-auto]")) {
      if (!geo || !k) return;
      preisSkala = preisSkala ? null : { lo: geo.lo, hi: geo.hi }; autoKnopf(); neuZeichnen();
      melden(preisSkala ? "Preisachse von Hand: an der Achse ziehen ändert die Höhe, Ziehen im Chart verschiebt auch senkrecht." : "Preisachse passt sich wieder den sichtbaren Kerzen an.");
      return;
    }
    const wz = t.closest("[data-werkzeug]"); if (wz) { setzeWerkzeug(wz.dataset.werkzeug); return; }
    if (t.closest("[data-tl-magnet]")) { magnet = !magnet; t.closest("[data-tl-magnet]").setAttribute("aria-pressed", String(magnet)); return; }
    if (t.closest("[data-tl-menue]")) { if (menueOffen) menueZu(true); else menueAuf(); return; }
    const dazu = t.closest("[data-ind-dazu]");
    if (dazu) {
      const li = dazu.closest("[data-ind-art]"), x = { art: dazu.dataset.indDazu };
      $$("[data-ind-feld]", li).forEach((inp) => { x[inp.dataset.indFeld] = +inp.value; });
      const m = $(".tl-ind-meldung", wurzel);
      if (!T.pruefeIndikator(x)) { m.textContent = "Diese Einstellungen gehen nicht. Beim MACD muss „Schnell“ kleiner als „Langsam“ sein."; return; }
      if (!indikatorDazu(x)) { m.textContent = "Höchstens 8 Indikatoren je Wert. Entferne zuerst einen."; return; }
      m.textContent = `${T.indName(T.pruefeIndikator(x))} ist im Chart.`;
      sichern(); indListe(); chips(); zeichne();
      return;
    }
    const iw = t.closest("[data-tl-ind-weg]");
    if (iw) { akt().indikatoren.splice(+iw.dataset.tlIndWeg, 1); sichern(); indListe(); chips(); zeichne(); return; }
    if (menueOffen && !t.closest('[data-tl="menue"]')) menueZu(false);
    const zm = t.closest("[data-tl-zoom]");
    if (zm) {
      if (!k) return;
      const r = +zm.dataset.tlZoom;
      if (r === 0) zuruecksetzen(); else knopfZoom(r);
      return;
    }
    const wa = t.closest("[data-tl-waehle]");
    if (wa) { auswahl = wa.dataset.tlWaehle; liste(); zentriereAuf(auswahl); return; }
    const weg = t.closest("[data-tl-weg]"); if (weg) { loesche(weg.dataset.tlWeg); return; }
    const ein = t.closest("[data-tl-einfuegen]");
    if (ein) {
      const feld = $('[data-tl="text"]', wurzel), wort = ein.dataset.tlEinfuegen;
      const a = feld.selectionStart ?? feld.value.length, b = feld.selectionEnd ?? a;
      const vor = feld.value.slice(0, a), nach = feld.value.slice(b);
      const einsatz = (vor && !/\s$/.test(vor) ? " " : "") + wort + (nach && !/^\s/.test(nach) ? " " : "");
      feld.value = vor + einsatz + nach; feld.focus(); feld.selectionStart = feld.selectionEnd = (vor + einsatz).length;
      akt().text = feld.value; sichern(); return;
    }
    if (t.closest("[data-tl-beispiel]")) { beispiel(); return; }
    if (t.closest("[data-tl-deuten]")) { deuten(); return; }
    if (t.closest("[data-tl-ki]")) { kiDeuten(); return; }
    if (t.closest("[data-tl-setup]") && window.WBSetupLab) { window.WBSetupLab.speichernZeigen($('[data-tl="ergebnis"]', wurzel), "taktik"); return; }
    const sprung = t.closest("[data-tl-trade]");
    if (sprung && ergebnis && ergebnis.e) {
      const tr = ergebnis.e.trades[+sprung.dataset.tlTrade];
      if (tr) { const span = sicht.i1 - sicht.i0, mitte = (tr.ein_i + tr.aus_i) / 2; verschiebe(mitte - span / 2, mitte + span / 2); $('[data-tl="chart"]', wurzel).scrollIntoView({ block: "nearest", behavior: "smooth" }); }
    }
  }
  function zentriereAuf(id) {
    const z = akt().zeichnungen.find((x) => x.id === id); if (!z || !k) { zeichne(); return; }
    const t = z.art === "trend" || z.art === "kanal" || z.art === "fib" ? (z.a.t + z.b.t) / 2 : z.art === "zone" ? (z.t0 + z.t1) / 2 : z.art === "position" ? (z.t + z.t1) / 2 : z.t;
    if (t == null) { zeichne(); return; }
    const i = T.indexGenau(k, t), span = sicht.i1 - sicht.i0;
    if (i < sicht.i0 || i > sicht.i1) verschiebe(i - span / 2, i + span / 2); else zeichne();
  }
  // Beispiel: Widerstand und Zone aus den letzten Kerzen ableiten, falls noch nichts gezeichnet ist
  function beispiel() {
    const a = akt();
    if (!k) return;
    if (!a.zeichnungen.length) {
      const n = k.c.length, von = Math.max(0, n - 120);
      let hi = -Infinity, iHi = von, lo = Infinity, iLo = von;
      for (let i = von; i < n - 5; i++) { if (k.h[i] > hi) { hi = k.h[i]; iHi = i; } if (k.l[i] < lo) { lo = k.l[i]; iLo = i; } }
      a.zeichnungen.push({ id: "L1", art: "linie", p: runde(hi), t: k.tag[iHi], name: "Widerstand" });
      const breite = (hi - lo) * 0.08;
      a.zeichnungen.push({ id: "Z1", art: "zone", t0: k.tag[Math.max(von, iLo - 3)], t1: k.tag[Math.min(n - 1, iLo + 3)], oben: runde(lo + breite), unten: runde(lo), verl: true, name: "Nachfrage" });
    }
    const ids = a.zeichnungen.map((z) => z.id);
    const linie = a.zeichnungen.find((z) => z.art === "linie"), zone = a.zeichnungen.find((z) => z.art === "zone");
    a.text = linie && zone ? `Kaufe, wenn der Kurs über ${linie.id} schließt. Stop unter ${zone.id}, Ziel 2R. Spätestens nach 20 Tagen raus.`
      : linie ? `Kaufe, wenn der Kurs über ${linie.id} schließt. Stop 3 %, Ziel 2R.` : `Kaufe, wenn der Kurs ${ids[0]} von oben berührt. Stop 3 %, Ziel 6 %.`;
    $('[data-tl="text"]', wurzel).value = a.text;
    geaendert(); deuten();
  }

  /* ================================================================ Deuten */
  function deuten() {
    const a = akt();
    a.text = $('[data-tl="text"]', wurzel).value;
    deutung = T.deute(a.text, a.zeichnungen);
    a.regeln = deutung.regeln; deutung.quelle = "lokal"; deutung.text = a.text;
    nachIndikatoren(a);
    sichern(); deutungZeigen(); ergebnis = null; ergebnisZeigen(); indListe(); chips(); zeichne();
  }
  // Indikatoren, die die Regeln nutzen, auch im Chart zeigen
  function nachIndikatoren(a) {
    const neu = T.indikatorenAus(a.regeln).filter((x) => !a.indikatoren.some((y) => T.indName(y) === T.indName(x)));
    neu.forEach(indikatorDazu);
  }
  function deutungZeigen(nurAktualisieren) {
    const el = wurzel && $('[data-tl="deutung"]', wurzel);
    if (!el) return;
    if (!deutung) { el.innerHTML = ""; return; }
    const a = akt();
    const regeln = T.pruefe(deutung.regeln, a.zeichnungen);
    if (nurAktualisieren) deutung.regeln = regeln;
    const zeilen = T.beschreibe(regeln, a.zeichnungen);
    el.innerHTML = `<p class="tl-deutung-kopf">So verstehe ich deine Taktik${deutung.quelle === "ki" ? " <em>(KI-Deutung)</em>" : ""}:</p>
      <ul>${zeilen.map((z) => `<li class="tl-r-${z.art}">${esc(z.text)}</li>`).join("")}</ul>
      ${deutung.unklar && deutung.unklar.length ? `<p class="tl-unklar"><b>Nicht verstanden:</b> ${deutung.unklar.map((s) => `„${esc(s)}“`).join(" ")}</p>` : ""}
      ${deutung.hinweise && deutung.hinweise.length ? `<ul class="tl-hinweise">${deutung.hinweise.map((h) => `<li>${esc(h)}</li>`).join("")}</ul>` : ""}`;
  }
  function kiKnopf() { const b = wurzel && $("[data-tl-ki]", wurzel); if (b) b.hidden = !kiDa; }
  // Für die KI nur Art, Kennung, Name und Preise/Zeiten der Zeichnungen (keine Kurse, keine anderen Daten)
  function knapp(z) {
    const basis = { id: z.id, art: z.art, name: z.name || "" };
    const felder = { linie: ["p"], strahl: ["p", "t"], trend: ["a", "b"], senkrecht: ["t"], zone: ["oben", "unten"], kanal: ["a", "b", "d"], fib: ["a", "b"], position: ["ein", "stop", "ziel"] }[z.art] || [];
    felder.forEach((f) => { basis[f] = z[f]; });
    return basis;
  }
  async function kiDeuten() {
    const a = akt(), knopf = $("[data-tl-ki]", wurzel);
    a.text = $('[data-tl="text"]', wurzel).value;
    knopf.disabled = true; knopf.textContent = "KI denkt …";
    try {
      const r = await fetch("api/taktik", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: a.text, zeichnungen: a.zeichnungen.map(knapp) }) });
      const j = await r.json();
      if (!r.ok || !j.regeln) throw new Error(j.fehler || "Keine Antwort");
      const regeln = T.pruefe(j.regeln, a.zeichnungen);
      deutung = { regeln, erkannt: [], unklar: Array.isArray(j.unklar) ? j.unklar.slice(0, 5).map(String) : [], hinweise: [], quelle: "ki", text: a.text };
      if (!regeln.einstieg.length) deutung.hinweise.push("Die KI hat keinen Einstieg erkannt, der sich auf deine Zeichnungen oder Indikatoren bezieht.");
      a.regeln = regeln; nachIndikatoren(a); sichern(); deutungZeigen(); ergebnis = null; ergebnisZeigen(); indListe(); chips(); zeichne();
    } catch (err) {
      $('[data-tl="deutung"]', wurzel).insertAdjacentHTML("afterbegin", `<p class="bt-fehler">KI-Deutung nicht möglich: ${esc(err.message)}</p>`);
    } finally { knopf.disabled = false; knopf.textContent = "Mit KI deuten"; }
  }

  /* ================================================================ Backtest */
  // Ohne Rückschaufehler: erst nach dem rechten Ende aller verwendeten Zeichnungen handeln (Indikatoren rechnen davor schon mit)
  function abIndex(kk, regeln, zeichnungen, nurDanach) {
    if (!nurDanach) return { ab: 1, abTag: null };
    const tag = T.abTag(regeln, zeichnungen);
    if (tag == null) return { ab: 1, abTag: null };
    return { ab: T.indexAm(kk, tag) + 1, abTag: tag };
  }
  function backtesten() {
    const a = akt();
    if (!k) { ergebnis = { fehler: "Die Kerzen werden noch geladen. Gleich noch einmal versuchen." }; ergebnisZeigen(); return; }
    // Neu deuten, wenn sich der Text seit der letzten Deutung geändert hat (auch ohne „Taktik verstehen“)
    if (!deutung || $('[data-tl="text"]', wurzel).value !== deutung.text || !a.regeln) deuten();
    const regeln = a.regeln;
    if (!regeln || !regeln.einstieg.length) { ergebnis = { fehler: "Ohne Einstieg gibt es nichts zu testen. Beschreibe, wann du kaufst oder verkaufst, und nenne dabei eine Zeichnung oder einen Indikator." }; ergebnisZeigen(); return; }
    const { ab, abTag } = abIndex(k, regeln, a.zeichnungen, zustand.nurDanach);
    if (ab >= k.c.length - 2) { ergebnis = { fehler: "Nach dem rechten Ende deiner Zeichnungen gibt es kaum Kerzen. Zeichne weiter links oder schalte „Nur Kerzen nach …“ aus." }; ergebnisZeigen(); return; }
    const e = T.teste(k, a.zeichnungen, regeln, { kosten: zustand.kosten, start: 10000, ab });
    // Haltedauer zählt Kerzen: „20 Tage“ sind bei Stundenkerzen 20 Stunden
    const einheit = (a.text || "").match(/(\d{1,4})\s*(?:handels)?(tag|tage|tagen|woche|wochen|stunde|stunden|minute|minuten)\b/i);
    const passt = { tag: /^tag/i, woche: /^woche/i, "1h": /^stunde/i, "1m": /^minute/i }[zustand.ebene];
    if (regeln.halten && einheit && !(passt && passt.test(einheit[2])))
      e.hinweise.push(`Die Haltedauer zählt Kerzen: „${einheit[1]} ${einheit[2]}“ sind hier ${regeln.halten} ${EB[zustand.ebene].kerzen}.`);
    ergebnis = { e, wert: w.s, ebene: zustand.ebene, ab: abTag, abI: ab };
    ergebnisZeigen(); zeichne();
    const el = $('[data-tl="ergebnis"]', wurzel); if (el && e.trades.length) el.scrollIntoView({ block: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }
  const GRUND = { stop: "Stop", ziel: "Ziel", regel: "Ausstiegsregel", zeit: "Haltedauer", offen: "noch offen" };
  function ergebnisZeigen() {
    const el = wurzel && $('[data-tl="ergebnis"]', wurzel);
    if (!el) return;
    if (!ergebnis) { el.innerHTML = ""; return; }
    if (ergebnis.fehler) { el.innerHTML = `<section class="bt-block"><p class="bt-fehler">${esc(ergebnis.fehler)}</p></section>`; return; }
    const e = ergebnis.e, kz = e.kennzahlen, d = dez(), eb = ergebnis.ebene;
    const kachel = (titel, wert, unter, kl = "") => `<div><dt>${esc(titel)}</dt><dd class="${kl}">${wert}</dd>${unter ? `<dd class="unter">${unter}</dd>` : ""}</div>`;
    const von = zeitText(ergebnis.ab != null ? ergebnis.ab : k.tag[0], false, eb);
    el.innerHTML = `
      <div class="bt-ergebnis">
        <p class="bt-zeile">Chart-Taktik · ${esc(w.name)} · ${EB[eb].kerzen} · ${von} bis ${zeitText(k.tag[k.c.length - 1], false, eb)}</p>
        <p class="bt-satz">${kz.n ? `${kz.n} ${kz.n === 1 ? "Trade" : "Trades"}, ${pct(kz.quote, 0).replace("+", "")} Gewinner, <span class="bt-satz-schluss">aus 10.000 € wurden <span class="${ton(kz.gesamt)}">${nf(0).format(kz.ende)} €</span>.</span>` : "Kein einziger Trade."}</p>
        ${kz.n && window.WBSetupLab ? `<div class="bt-aktionen"><button type="button" class="knopf" data-tl-setup><svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M6 4h12v16l-6-4-6 4z"/></svg>Als Setup speichern</button></div>` : ""}
      </div>
      ${kz.n ? `<dl class="bt-kacheln">
        ${kachel("Ergebnis", pct(kz.gesamt), `Kaufen und halten ${pct(kz.kaufenHalten)}`, ton(kz.gesamt))}
        ${kachel("Trefferquote", pct(kz.quote, 0).replace("+", ""), `${e.trades.filter((t) => t.netto > 0).length} von ${kz.n} im Plus`)}
        ${kachel("Ø Trade", pct(kz.mittel, 2), kz.rMittel != null ? `Ø ${zahl(kz.rMittel, 2)} R` : "ohne Stop kein R", ton(kz.mittel))}
        ${kachel("Profit-Faktor", kz.profitFaktor == null ? "–" : isFinite(kz.profitFaktor) ? zahl(kz.profitFaktor, 2) : "∞", "Gewinne ÷ Verluste")}
        ${kachel("Größter Rückgang", pct(kz.maxRueckgang), "vom Höchststand des Kontos", ton(kz.maxRueckgang))}
        ${kachel("Ø Haltedauer", dauerText(kz.tageMittel), `Kosten ${zustand.kosten ? nf(2).format(zustand.kosten * 100) + " % je Seite" : "keine"}`)}
      </dl>` : ""}
      ${e.hinweise.length ? `<ul class="tl-hinweise">${e.hinweise.map((h) => `<li>${esc(h)}</li>`).join("")}</ul>` : ""}
      ${kz.n ? `<section class="bt-block"><div class="bt-block-kopf"><h3>Trades</h3><p class="klein">Klick springt im Chart zum Trade · ▲ Einstieg, ▼ Ausstieg, gestrichelt Stop und Ziel</p></div>
        <div class="tabelle-rahmen"><table class="bt-tabelle tl-trades"><thead><tr><th>Einstieg</th><th>Kurs</th><th>Ausstieg</th><th>Kurs</th><th>Grund</th><th>R</th><th>Ergebnis</th></tr></thead><tbody>
        ${e.trades.map((t, j) => [t, j]).reverse().slice(0, 200).map(([t, j]) => `<tr data-tl-trade="${j}" tabindex="0"><td>${zeitText(k.tag[t.ein_i], true, eb)}</td><td>${zahl(t.ein, d)}</td><td>${zeitText(k.tag[t.aus_i], true, eb)}</td><td>${zahl(t.aus, d)}</td>
          <td>${GRUND[t.grund] || t.grund}</td><td>${t.r == null ? "–" : zahl(t.r, 2)}</td><td class="${ton(t.netto)}">${pct(t.netto, 2)}</td></tr>`).join("")}
        </tbody></table></div></section>` : ""}
      <section class="bt-block bt-grenzen"><div class="bt-block-kopf"><h3>Grenzen</h3></div><ul>
        <li>Gezeichnete Linien kennen die Vergangenheit: Wer heute einen Widerstand einzeichnet, sieht schon, wo der Kurs gedreht hat. Aussagekräftig sind vor allem Trades nach dem rechten Ende der Zeichnungen (Haken „Nur Kerzen nach …“) und die Bewährungsprobe eines gespeicherten Setups.</li>
        <li>Indikatoren nutzen an jeder Kerze nur Kurse bis zu ihrem Schluss. Sie brauchen Vorlauf (z. B. 200 Kerzen für den SMA 200); davor gibt es kein Signal.</li>
        <li>Signal am Schluss einer Kerze, Einstieg ${akt().regeln && akt().regeln.zeitpunkt === "schluss" ? "zum Schluss derselben Kerze" : "zur Eröffnung der nächsten"}; Stop und Ziel innerhalb einer Kerze über Hoch und Tief, bei Kurslücken zum Eröffnungskurs. Eine Position zur Zeit, ganzes Kapital je Trade, ohne Hebel, Slippage und Steuern.</li>
        <li>${kerzenGrenze(eb)} Vergangene Ergebnisse sagen nichts Sicheres über die Zukunft.</li>
      </ul></section>`;
  }

  function kerzenGrenze(eb) {
    if (eb === "woche") return "Wochenkerzen fassen Montag bis Freitag zusammen; Haltedauer und Signale zählen in Wochen.";
    if (eb === "monat") return "Monatskerzen fassen einen Kalendermonat zusammen; Haltedauer und Signale zählen in Monaten.";
    if (eb === "tag") return "Tageskerzen; Haltedauer zählt in Handelstagen.";
    const quelle = k && k.fenster ? `${esc(k.quelle || "Yahoo Finance")} (nur die letzten ${esc(k.fenster)}, reguläre Handelszeit)` : esc((k && k.quelle) || (w && w.quelle) || "den Kursdaten");
    return `${EB[eb].kerzen} aus ${quelle}${eb === "4h" ? ", je Handelssitzung aus Stundenkerzen zusammengefasst" : ""}; Haltedauer zählt in Kerzen, Uhrzeiten in deiner Ortszeit. `
      + "Bei kurzen Kerzen wiegen Kosten und Spread je Trade schwer; Slippage ist nicht eingerechnet.";
  }

  /* ================================================================ Setup Lab: speichern, laden, nachprüfen */
  // Momentaufnahme für das Speichern (nur mit aktuellem Ergebnis)
  function setupDaten() {
    if (!w || !k || !ergebnis || !ergebnis.e || ergebnis.wert !== w.s || ergebnis.ebene !== zustand.ebene) return null;
    const a = akt(), e = ergebnis.e, SK = window.WBSetupKern;
    const trades = tradesInMinuten(e.trades, k, w, e.regeln.richtung);
    const kz = e.kennzahlen;
    const bt = window.WBBacktest && window.WBBacktest.datenStand ? window.WBBacktest.datenStand() : null;
    return {
      art: "taktik",
      taktik: { wert: w.s, wertName: w.name, typ: w.typ || null, extra: !!w.extra, ebene: zustand.ebene, kosten: zustand.kosten, nurDanach: zustand.nurDanach,
                zeichnungen: JSON.parse(JSON.stringify(a.zeichnungen)), indikatoren: JSON.parse(JSON.stringify(a.indikatoren)), text: a.text || "", regeln: JSON.parse(JSON.stringify(e.regeln)) },
      worte: T.beschreibe(e.regeln, a.zeichnungen).map((z) => z.text).join("; "),
      ergebnis: SK ? SK.pruefeErgebnis(Object.assign({}, SK.kennzahlen(trades), { rueckgang: kz.maxRueckgang, gesamt: kz.gesamt, start: 10000, ende: kz.ende, hebel: 1,
        von: k.tag[Math.max(0, (ergebnis.abI || 1) - 1)], bis: k.tag[k.c.length - 1] })) : null,
      daten: bt ? { stand: bt.stand, demo: bt.demo } : { stand: null, demo: false },
      frisch: true, herkunft: a.setup || null, titel: `${w.name} · Chart-Taktik${zustand.ebene === "tag" ? "" : ` · ${EB[zustand.ebene].titel}`}`,
    };
  }
  // Trades mit Zeit in Minuten (für die Trennung am Speicherzeitpunkt): Beginn des Einstiegs- bzw. Ausstiegstags
  function tradesInMinuten(trades, kk, ww, richtung) {
    return trades.map((t) => ({ einMin: kk.tag[t.ein_i] * 1440, ausMin: kk.tag[t.aus_i] * 1440, netto: t.netto, grund: t.grund,
      dir: richtung === "short" ? -1 : 1, ein: t.ein, w: { s: ww.s, name: ww.name } }));
  }
  function wertSicher(tk) {
    const bt = window.WBBacktest;
    if (!bt) return Promise.reject(new Error("Backtest nicht geladen"));
    return bt.datenLaden().then((d) => {
      if (d.werte.some((x) => x.s === tk.wert)) return d;
      if (!tk.extra || !bt.wertBereit) throw new Error(`${tk.wertName || tk.wert} ist in den heutigen Daten nicht mehr enthalten.`);
      return bt.wertBereit({ s: tk.wert, n: tk.wertName || tk.wert, t: tk.typ || "aktie" }).then(() => d);
    });
  }
  // Bewährungsprobe: gespeicherte Taktik auf den heutigen Kursen, ohne die Ansicht zu verändern. Minuten- und Stundenkerzen
  // gibt es nur, solange die Quelle sie liefert (Yahoo: begrenzter Zeitraum, nur mit python live.py); sonst eine klare Meldung.
  function pruefen(tk) {
    const eb = T.ebeneOk(tk.ebene);
    return wertSicher(tk).then((d) => statusPruefen().then(() => {
      const ww = d.werte.find((x) => x.s === tk.wert);
      if (!ww) throw new Error(`${tk.wertName || tk.wert} ist in den heutigen Daten nicht mehr enthalten.`);
      const grund = ebeneHindernis(eb, ww);
      if (grund) throw new Error(`Dieses Setup rechnet mit ${EB[eb].kerzen}. ${grund}`);
      return kerzenFuer(ww, eb).then((kk) => {
        const z = T.pruefeZeichnungen(tk.zeichnungen), regeln = T.pruefe(tk.regeln, z);
        if (!regeln.einstieg.length) throw new Error("Die gespeicherten Regeln haben keinen gültigen Einstieg mehr.");
        const { ab } = abIndex(kk, regeln, z, tk.nurDanach);
        const e = T.teste(kk, z, regeln, { kosten: tk.kosten, start: 10000, ab });
        return { trades: tradesInMinuten(e.trades, kk, ww, regeln.richtung), ruin: null, ende: kk.tag[kk.c.length - 1], anfang: kk.tag[Math.max(0, ab - 1)],
                 annahmen: e.hinweise, fehlend: [], demo: !!d.demo, stand: d.stand, fenster: kk.fenster || null };
      });
    }));
  }
  // Gespeicherte Taktik in den Reiter laden (ersetzt Zeichnungen, Indikatoren und Text dieses Werts). Die Kerzen werden
  // vorher geladen: Geht das nicht (z. B. Minutenkerzen ohne python live.py), bleibt alles, wie es war.
  function laden(tk, herkunft) {
    const eb = T.ebeneOk(tk.ebene);
    return wertSicher(tk).then((d) => statusPruefen().then(() => {
      const ww = d.werte.find((x) => x.s === tk.wert);
      if (!ww) throw new Error(`${tk.wertName || tk.wert} ist in den heutigen Daten nicht mehr enthalten.`);
      const grund = ebeneHindernis(eb, ww);
      if (grund) throw new Error(`Dieses Setup rechnet mit ${EB[eb].kerzen}. ${grund}`);
      return kerzenFuer(ww, eb);
    })).then(() => {
      zustand.wert = tk.wert;
      zustand.ebene = eb;
      zustand.kosten = [0, 0.0005, 0.001, 0.0025].includes(tk.kosten) ? tk.kosten : 0.0005;
      zustand.nurDanach = !!tk.nurDanach;
      zustand.werte[tk.wert] = wertZustand({ zeichnungen: tk.zeichnungen, indikatoren: tk.indikatoren, text: tk.text, regeln: tk.regeln, setup: herkunft });
      sichern();
      if (window.WBBacktest) window.WBBacktest.modusSetzen("chart");
      if (wurzel && wurzel.isConnected) {
        $('[data-tl="kosten"]', wurzel).value = String(zustand.kosten);
        $('[data-tl="nurDanach"]', wurzel).checked = zustand.nurDanach;
        return wertLaden(false).then(() => backtesten());
      }
      return null;
    });
  }
  // Würde das Laden etwas Ungesichertes ersetzen? (andere Zeichnungen oder anderer Text für diesen Wert)
  function ersetztEtwas(tk) {
    const jetzt = zustand.werte[tk.wert];
    if (!jetzt || (!jetzt.zeichnungen.length && !jetzt.text)) return false;
    const gleich = (x, y) => JSON.stringify(x) === JSON.stringify(y);
    return !(gleich(jetzt.zeichnungen, T.pruefeZeichnungen(tk.zeichnungen)) && jetzt.text === (tk.text || ""));
  }

  /* ================================================================ Live: laufende Kerze aus Finnhub-Trades (US-Aktien und ETFs)
     app.js hält die Finnhub-Verbindung (eigener kostenloser Schlüssel, nur in diesem Browser). Jeder Handel des gezeigten
     Werts schreibt die jüngste Kerze fort oder beginnt eine neue; neu gezeichnet wird höchstens alle 0,4 s.
     Die Vorgeschichte bleibt, wie sie geladen wurde (Tageskurse, OANDA oder Yahoo über live.py). */
  const LIVE = () => window.WBLive && window.WBLive.liveAbo ? window.WBLive : null;
  // Yahoo-Kürzel → Finnhub-Kürzel; nur US-Aktien und -ETFs (ohne Börsenendung), BRK-B → BRK.B
  function liveKuerzel(ww) {
    if (!ww || (ww.typ !== "aktie" && ww.typ !== "etf")) return null;
    if (/^[A-Z]{1,5}$/.test(ww.s)) return ww.s;
    const m = /^([A-Z]{1,4})-([A-Z])$/.exec(ww.s);
    return m ? `${m[1]}.${m[2]}` : null;
  }
  let liveSym = null, liveHoerer = null, liveZuletzt = 0, liveAnzahl = 0, livePlan = 0, liveUhr = 0;
  function liveStarten() {
    const L = LIVE(), sym = L ? liveKuerzel(w) : null;
    if (liveSym && liveSym !== sym && L) L.liveAbo(liveSym, false);
    if (sym !== liveSym) { liveZuletzt = 0; liveAnzahl = 0; }
    liveSym = null;
    if (sym && L && L.finnhubSchluessel()) {
      if (!liveHoerer) liveHoerer = L.aufTrade(liveTrade);
      L.liveAbo(sym, true); liveSym = sym;
    }
    if (!liveUhr) liveUhr = setInterval(() => { if (wurzel && wurzel.isConnected) liveAnzeige(); }, 5000);
    liveAnzeige();
  }
  function liveAnzeige() {
    const el = wurzel && $('[data-tl="live"]', wurzel);
    if (!el) return;
    const sym = liveKuerzel(w), L = LIVE();
    if (!sym || !L) { el.hidden = true; return; }
    el.hidden = false;
    const frisch = liveZuletzt && Date.now() - liveZuletzt < 90e3;
    el.classList.toggle("an", !!frisch);
    if (!L.finnhubSchluessel()) {
      el.textContent = "Live aus";
      el.title = "Mit einem kostenlosen Finnhub-Schlüssel (Einstellung „Live-Kurse“ auf der Startseite) läuft die jüngste Kerze bei US-Werten in Echtzeit mit.";
    } else if (frisch) {
      el.textContent = "Live";
      el.title = `Echtzeit über Finnhub: ${liveAnzahl} Trades seit dem Öffnen, letzter ${new Date(liveZuletzt).toLocaleTimeString("de-DE")}`;
    } else {
      el.textContent = "Live · wartet";
      el.title = "Verbunden mit Finnhub, aber gerade kein Handel (Börse zu oder Verbindung im Aufbau). Neue Trades erscheinen sofort.";
    }
  }
  // Kerzen beim ersten Live-Handel in eigene Listen kopieren (die Tageskurse des Backtests bleiben unberührt)
  function liveKopie(kk) {
    const kopie = { tag: Array.from(kk.tag), o: Array.from(kk.o), h: Array.from(kk.h), l: Array.from(kk.l), c: Array.from(kk.c),
                    quelle: kk.quelle, fenster: kk.fenster, live: true };
    const e = kerzenSpeicher.get(`${w.s}|${zustand.ebene}`);
    if (e) e.k = kopie;
    return kopie;
  }
  function liveTrade(d) {
    if (!k || !w || d.s !== liveSym || !(d.p > 0)) return;
    const eb = zustand.ebene, n = k.c.length, letzte = k.tag[n - 1];
    let neu = null;  // Beginn einer neuen Kerze (Tage), null = jüngste Kerze fortschreiben
    if (EB[eb].n < 1440) {
      const m = Math.floor(d.t / 60000), lm = Math.round(letzte * 1440), len = EB[eb].n;
      if (m < lm) return;                                    // älter als die jüngste Kerze
      if (m >= lm + len) neu = (lm + Math.floor((m - lm) / len) * len) / 1440;
    } else {
      const tagNr = Math.floor(d.t / 864e5), lt = Math.floor(letzte);
      if (tagNr < lt) return;
      const schl = (x) => (eb === "woche" ? Math.floor((x + 3) / 7) : eb === "monat" ? (() => { const dd = new Date(x * 864e5); return dd.getUTCFullYear() * 12 + dd.getUTCMonth(); })() : x);
      if (schl(tagNr) !== schl(lt)) neu = tagNr;
    }
    if (!k.live) k = liveKopie(k);
    if (neu == null) { const i = n - 1; k.c[i] = d.p; if (d.p > k.h[i]) k.h[i] = d.p; if (d.p < k.l[i]) k.l[i] = d.p; }
    else {
      const amRand = sicht.i1 >= n - 1;
      k.tag.push(neu); k.o.push(d.p); k.h.push(d.p); k.l.push(d.p); k.c.push(d.p);
      if (amRand) sicht = { i0: sicht.i0 + 1, i1: sicht.i1 + 1 };  // am rechten Rand mitlaufen
    }
    liveZuletzt = Date.now(); liveAnzahl++;
    if (!livePlan) livePlan = setTimeout(() => {
      livePlan = 0;
      if (!k || !wurzel || !wurzel.isConnected) return;
      k = Object.assign({}, k);  // neue Identität: Indikatoren werden mit der neuen Kerze neu gerechnet
      const e = kerzenSpeicher.get(`${w.s}|${zustand.ebene}`); if (e && e.k && e.k.live) e.k = k;
      if (!ziehen) neuZeichnen();
      liveAnzeige();
    }, 400);
  }

  /* ================================================================ Schnittstelle für backtest.js und setups.js */
  let gebunden = false;
  window.WBTaktikLabor = {
    zeigen(el, d) { zeigen(el, d); bindeChart(); if (!gebunden) { gebunden = true; window.addEventListener("resize", () => { if (wurzel && wurzel.offsetParent) zeichne(); }); } },
    zeichne: () => zeichne(),
    setupDaten, pruefen, laden, ersetztEtwas,
    herkunftSetzen: (h) => { if (w) { akt().setup = herkunftOk(h); sichern(); } },
    beschreibe: (tk) => { const z = T.pruefeZeichnungen(tk.zeichnungen); return T.beschreibe(T.pruefe(tk.regeln, z), z).map((x) => x.text); },
  };
})();
