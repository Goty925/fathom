/* Fathom: Work-Modus (Widget „Work“ in der Leiste links, Adresse #work).
 *
 * Alle wichtigen Fenster auf einem Bildschirm, nach dem Vorbild eines Börsenterminals:
 *   1 Kurse       alle Werte mit Live-Kurs, Tagesveränderung, 1W, YTD, 52-Wochen-Spanne, Volatilität, Signal
 *   2 Wert        Chart und rund 40 Kennzahlen des gewählten Werts, Signale, passende Nachrichten
 *   3 Nachrichten Kurzfassung je Meldung, Zuordnung zu deinen Werten, Gewicht, Alter, automatische Aktualisierung
 *   4 Kalender    Wirtschaftstermine mit Countdown, Ist/Prognose/Vorwert und Marktreaktion früherer Termine
 *   5 Bewegung    Heatmap in Prozent und in Standardabweichungen
 *   6 Lage        Volatilität, Kreditrisiko, Leitzinsen, Treffer je Klasse, Korrelationen
 * Rechenteile: assets/work-kern.js. Nachrichten: python live.py (Finnhub, Fed, EZB, SEC) oder ein Finnhub-Schlüssel
 * im Browser. Einstellungen bleiben nur in diesem Browser (fathom.work).
 */
(function () {
  "use strict";
  const W = window.WBWorkKern;
  const { $, $$, esc, lies, schreib, nf, minus, zahl, zwei } = window.WBH;
  const pct = (x, d = 1, vz = true) => {
    if (x == null || !isFinite(x)) return "–";
    const t = nf(d).format(x * 100);
    return /^-?0(,0*)?$/.test(t) ? nf(d).format(0) + " %" : minus((vz && x > 0 ? "+" : "") + t + " %");
  };
  const pp = (x, d = 2) => (x == null || !isFinite(x) ? "–" : minus((x > 0 ? "+" : "") + nf(d).format(x * 100)) + " Pp.");
  const ton = (x, grenze = 5e-5) => (x == null || !isFinite(x) || Math.abs(x) < grenze ? "" : x > 0 ? "plus" : "minus");
  const mrd = (x) => (x == null ? "–" : x >= 1e12 ? zahl(x / 1e12, 2) + " Bio. €" : zahl(x / 1e9, 1) + " Mrd. €");
  const BERLIN = "Europe/Berlin";
  const fUhr = new Intl.DateTimeFormat("de-DE", { timeZone: BERLIN, hour: "2-digit", minute: "2-digit" });
  const fUhrSek = new Intl.DateTimeFormat("de-DE", { timeZone: BERLIN, hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const fTag = new Intl.DateTimeFormat("de-DE", { timeZone: BERLIN, weekday: "long", day: "2-digit", month: "2-digit" });
  const fTagKurz = new Intl.DateTimeFormat("de-DE", { timeZone: BERLIN, weekday: "short", day: "2-digit", month: "2-digit" });
  const fDatum = new Intl.DateTimeFormat("de-DE", { timeZone: "UTC", day: "2-digit", month: "2-digit", year: "2-digit" });
  const tagBerlin = (ms) => new Intl.DateTimeFormat("en-CA", { timeZone: BERLIN }).format(new Date(ms));
  const ICON_ZU = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
  const ICON_MAX = '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>';

  const basisEl = $("#live-basis");
  if (!W || !basisEl) return;
  const BASIS = JSON.parse(basisEl.textContent);
  const WERTE = BASIS.werte || {};
  const KLASSEN = [["aktie", "Aktien"], ["etf", "ETFs"], ["forex", "Forex"], ["rohstoff", "Rohstoffe"], ["index", "Indizes"]];
  const RANG = Object.fromEntries(KLASSEN.map(([k], i) => [k, i]));
  // nach Anlageklasse, darin nach Name (die Daten in der Seite sind alphabetisch nach Kürzel sortiert)
  const SLUGS = Object.keys(WERTE).sort((a, b) => (RANG[WERTE[a].typ] ?? 9) - (RANG[WERTE[b].typ] ?? 9) || String(WERTE[a].name).localeCompare(String(WERTE[b].name), "de"));
  const KLASSE_NAME = Object.fromEntries(KLASSEN);
  const MUSTER = W.muster(WERTE);
  const NAMEN = Object.fromEntries(SLUGS.map((s) => [s, WERTE[s].name]));
  const kurzSym = (b) => String(b.symbol || "").replace(/=X$|=F$/, "").replace(/^\^/, "");
  const kurzName = (b) => (b.typ === "forex" ? b.name : String(b.name).replace(/\s*\((?:ETF|ETC)\)/, "").split(" ").slice(0, 2).join(" "));
  const MARKT = SLUGS.find((s) => WERTE[s].symbol === "^GSPC") || SLUGS.find((s) => WERTE[s].typ === "index") || null;

  /* ================================================================ Einstellungen */
  const SPEICHER = "fathom.work";
  const zustand = Object.assign({ wert: SLUGS[0] || null, sort: null, abst: false, nFilter: "alle", nAnsicht: "heiss", nStufe: 1, kZeit: "woche", kWichtig: 1, zSpanne: 24,
    bewegung: "heute", chart: "3M", maxi: null, hinweise: false }, (() => { try { return JSON.parse(lies(SPEICHER)) || {}; } catch (e) { return {}; } })());
  if (!WERTE[zustand.wert]) zustand.wert = SLUGS[0] || null;
  zustand.maxi = null;
  const sichern = () => schreib(SPEICHER, JSON.stringify(zustand));

  /* ================================================================ Kurse */
  const live = () => window.WBLive || { stand: {}, quellen: {} };
  function kursInfo(slug) {
    const b = WERTE[slug], s = live().stand[slug];
    const frisch = s && Date.now() - s.zeit < 20 * 60e3;
    const kurs = s && s.kurs ? s.kurs : b.kurs;
    const heute = s && s.vortag ? kurs / s.vortag - 1 : null;
    return { kurs, heute, frisch: !!frisch, zeit: s ? s.zeit : null, quelle: s ? s.quelle : null, live: !!s };
  }
  const liveAktiv = () => Object.values(live().stand).some((s) => Date.now() - s.zeit < 20 * 60e3);
  const signal = (slug) => (window.WBRegeln && window.WBRegeln.status ? window.WBRegeln.status(slug) : null);

  /* ================================================================ Tagesschlusskurse (daten/kurse/<wert>.json) */
  const reihen = {}, reihenLaden = {};
  function ladeReihe(slug) {
    if (reihen[slug] !== undefined) return Promise.resolve(reihen[slug]);
    if (!reihenLaden[slug]) {
      reihenLaden[slug] = fetch("daten/kurse/" + slug + ".json", { cache: "no-cache" })
        .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
        .then((l) => (reihen[slug] = l.length > 1 ? W.reihe(l) : null))
        .catch(() => (reihen[slug] = null));
    }
    return reihenLaden[slug];
  }
  let korrelation = null;
  function alleReihen() {
    return Promise.all(SLUGS.map(ladeReihe)).then(() => {
      korrelation = W.korrelationen(SLUGS.map((s) => reihen[s]), 252);
      if (offen) { fensterLage(); detailStatistik(); }
    });
  }

  /* ================================================================ Gerüst */
  let huelle = null, offen = false, takt = null, ausloeser = null;
  const FENSTER = [
    ["kurse", "Kurse", "Alle Werte"], ["wert", "Wert", "Chart und Kennzahlen"], ["news", "Nachrichten", "Feed"],
    ["kalender", "Kalender", "Termine mit Countdown"], ["bewegung", "Bewegung", "Heatmap"], ["lage", "Lage", "Risiko und Zinsen"],
    ["zeit", "Zeitstrahl", "Wichtigkeit, Eingang und erwartete Termine"],
  ];
  function bauen() {
    huelle = document.createElement("div");
    huelle.className = "wm-huelle";
    huelle.hidden = true;
    huelle.innerHTML = `
      <section class="wm" role="dialog" aria-modal="true" aria-label="Work-Modus" tabindex="-1">
        <header class="wm-kopf">
          <div class="wm-marke"><h2>Work-Modus</h2><span>Fathom</span></div>
          <form class="wm-befehl" autocomplete="off" role="search">
            <label for="wm-befehl" class="wm-prompt" aria-hidden="true">›</label>
            <input id="wm-befehl" type="text" spellcheck="false" placeholder="Wert oder Befehl, z. B. MSFT, Gold, N, K, ?" aria-label="Wert suchen oder Befehl eingeben" aria-autocomplete="list" aria-controls="wm-vorschlag">
            <ul class="wm-vorschlag" id="wm-vorschlag" role="listbox" hidden></ul>
          </form>
          <div class="wm-uhren" aria-label="Börsenzeiten"></div>
          <div class="wm-status" aria-live="polite"></div>
          <button type="button" class="wm-knopf wm-zu wm-vollbild-knopf" data-wm-vollbild aria-pressed="false" title="Vollbild: alle Fenster auf einmal (V)">${ICON_MAX}<span>Vollbild</span></button>
          <button type="button" class="wm-knopf wm-zu" data-wm-zu aria-label="Work-Modus schließen">${ICON_ZU}<span>Schließen</span></button>
        </header>
        <div class="wm-eilband" hidden role="region" aria-label="Eilmeldungen"></div>
        <div class="wm-gitter">
          ${FENSTER.map(([id, titel, unter], i) => `
          <section class="wm-fenster" data-fenster="${id}" aria-labelledby="wm-t-${id}" tabindex="-1">
            <header class="wm-fkopf">
              <span class="wm-nr">${i + 1}</span><h3 id="wm-t-${id}">${titel}</h3><span class="wm-unter">${unter}</span>
              <div class="wm-fwerkzeug" data-werkzeug="${id}"></div>
              <button type="button" class="wm-knopf wm-maxi" data-wm-maxi="${id}" aria-label="${titel} vergrößern" title="Vergrößern (F)">${ICON_MAX}</button>
            </header>
            <div class="wm-finhalt" data-inhalt="${id}"></div>
          </section>`).join("")}
        </div>
        <div class="wm-hilfe" hidden role="note">
          <p><b>Tasten</b> <kbd>/</kbd> Suche · <kbd>1</kbd>–<kbd>7</kbd> Fenster · <kbd>F</kbd> Fenster groß · <kbd>V</kbd> Vollbild · <kbd>↑</kbd><kbd>↓</kbd> Wert wechseln · <kbd>Esc</kbd> zurück</p>
          <p><b>Befehle</b> Name oder Kürzel öffnet den Wert · <kbd>N</kbd> Nachrichten · <kbd>K</kbd> Kalender · <kbd>BT</kbd> Backtest · <kbd>A</kbd> Analyse des Werts · <kbd>?</kbd> diese Hilfe</p>
        </div>
      </section>`;
    document.body.appendChild(huelle);
    huelle.addEventListener("click", klick);
    huelle.addEventListener("dblclick", (e) => { const k = e.target.closest(".wm-fkopf"); if (k && !e.target.closest("button, a, input, select")) maxi(k.parentElement.dataset.fenster); });
    document.addEventListener("keydown", (e) => { if (offen && !document.body.classList.contains("bt-offen")) tasten(e); });
    huelle.addEventListener("change", aenderung);
    const eingabe = $("#wm-befehl", huelle);
    eingabe.addEventListener("input", vorschlagen);
    eingabe.addEventListener("keydown", befehlTasten);
    $(".wm-befehl", huelle).addEventListener("submit", (e) => { e.preventDefault(); befehl(eingabe.value); });
    werkzeuge();
  }

  function werkzeuge() {
    const w = (id) => $(`[data-werkzeug="${id}"]`, huelle);
    w("kurse").innerHTML = `<label class="wm-schalter" title="Spalten sortieren: Klick auf die Überschrift"><input type="checkbox" data-z="abst"${zustand.abst ? " checked" : ""}> nur Treffer</label>`;
    w("news").innerHTML = `<span class="wm-abruf" data-abruf></span>
      <button type="button" class="wm-knopf wm-text" data-wm-hinweise aria-pressed="${zustand.hinweise}" title="Mitteilung bei wichtigen Meldungen zu deinen Werten, wenn dieser Tab im Hintergrund ist">Hinweise</button>`;
    w("kalender").innerHTML = `<span class="wm-abruf" data-kal-stand></span>`;
    w("zeit").innerHTML = `<div class="wm-tabs" role="group" aria-label="Zeitspanne">${[[12, "12 Std."], [24, "24 Std."], [72, "3 Tage"]].map(([k, t]) =>
      `<button type="button" data-zspanne="${k}" aria-pressed="${zustand.zSpanne === k}">${t}</button>`).join("")}</div>`;
    w("bewegung").innerHTML = `<div class="wm-tabs" role="group" aria-label="Zeitraum">${[["heute", "Heute"], ["1W", "1W"], ["YTD", "YTD"]].map(([k, t]) =>
      `<button type="button" data-bewegung="${k}" aria-pressed="${zustand.bewegung === k}">${t}</button>`).join("")}</div>`;
  }

  /* ================================================================ Öffnen und Schließen */
  const melden = window.WBH.fenster("work", () => {
    if (location.hash === "#work") history.replaceState(null, "", location.pathname + location.search);
    zu(true);
  });
  function oeffnen() {
    if (!huelle) bauen();
    if (offen) return;
    melden(true);
    ausloeser = document.activeElement;
    offen = true;
    huelle.hidden = false;
    document.body.classList.add("fenster-offen", "wm-offen");
    $(".wm", huelle).focus({ preventScroll: true });
    allesZeichnen();
    alleReihen();
    kalenderLaden();
    nachrichtenStarten();
    clearInterval(takt);
    takt = setInterval(sekunde, 1000);
    sekunde();
  }
  function zu(leise) {
    if (!huelle || !offen) return;
    offen = false;
    if (document.fullscreenElement === huelle) document.exitFullscreen().catch(() => {});
    huelle.hidden = true;
    document.body.classList.remove("fenster-offen", "wm-offen");
    clearInterval(takt);
    titelZaehler(0);
    if (!leise && ausloeser && document.contains(ausloeser)) ausloeser.focus({ preventScroll: true });
    melden(false);
  }
  function schliessen() {
    if (location.hash === "#work") history.replaceState(null, "", location.pathname + location.search);
    zu();
  }
  const ausAdresse = () => { if (location.hash === "#work") oeffnen(); else zu(); };
  window.addEventListener("hashchange", ausAdresse);
  document.addEventListener("DOMContentLoaded", ausAdresse);
  document.addEventListener("click", (e) => {
    const a = e.target.closest('a[href="#work"], [data-work-oeffnen]');
    if (!a) return;
    e.preventDefault();
    if (location.hash !== "#work") history.pushState(null, "", "#work");
    oeffnen();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !offen) return;
    if (document.body.classList.contains("bt-offen")) return;
    e.preventDefault();
    if (!$(".wm-hilfe", huelle).hidden) { $(".wm-hilfe", huelle).hidden = true; return; }
    if (!$("#wm-vorschlag", huelle).hidden) { $("#wm-vorschlag", huelle).hidden = true; return; }
    if (zustand.maxi) { maxi(null); return; }
    schliessen();
  }, true);

  function allesZeichnen() {
    fensterKurse(); fensterWert(); fensterNews(); fensterKalender(); fensterBewegung(); fensterLage(); fensterZeit(); uhren(); status();
  }

  /* ================================================================ Bedienung */
  function klick(e) {
    const t = e.target;
    if (t.closest("[data-wm-zu]")) { schliessen(); return; }
    if (t.closest("[data-wm-vollbild]")) { vollbild(); return; }
    const m = t.closest("[data-wm-maxi]");
    if (m) { maxi(zustand.maxi === m.dataset.wmMaxi ? null : m.dataset.wmMaxi); return; }
    const sortKnopf = t.closest("[data-sort]");
    if (sortKnopf) {
      const k = sortKnopf.dataset.sort;
      zustand.sort = !zustand.sort || zustand.sort.k !== k ? { k, ab: k !== "name" } : zustand.sort.ab ? { k, ab: false } : null;
      sichern(); fensterKurse(); return;
    }
    const v = t.closest("#wm-vorschlag [data-w]");
    if (v) { waehleAusBefehl(v.dataset.w); return; }
    const w = t.closest("[data-w]");
    if (w && !t.closest("a")) { waehle(w.dataset.w); return; }
    const chart = t.closest("[data-chart]");
    if (chart) { zustand.chart = chart.dataset.chart; sichern(); zeichneChart(); return; }
    const nf_ = t.closest("[data-nfilter]");
    if (nf_) { zustand.nFilter = nf_.dataset.nfilter; sichern(); newsListe(true); return; }
    const na = t.closest("[data-nansicht]");
    if (na) { zustand.nAnsicht = na.dataset.nansicht; sichern(); newsListe(true); $('[data-inhalt="news"]', huelle).scrollTop = 0; return; }
    const ns = t.closest("[data-nstufe]");
    if (ns) { zustand.nStufe = +ns.dataset.nstufe; sichern(); newsListe(true); return; }
    const zs = t.closest("[data-zspanne]");
    if (zs) { zustand.zSpanne = +zs.dataset.zspanne; sichern(); $$("[data-zspanne]", huelle).forEach((b) => b.setAttribute("aria-pressed", String(b === zs))); zeitstrahl(); return; }
    const zn = t.closest("[data-zs]");
    if (zn) { geschichteZeigen(zn.dataset.zs); return; }
    const zk = t.closest("[data-zk]");
    if (zk) { terminZeigen(zk.dataset.zk); return; }
    const eb = t.closest("[data-eilband]");
    if (eb) { geschichteZeigen(eb.dataset.eilband); return; }
    const story = t.closest("[data-sid]");
    if (story && !t.closest("a, .wm-chip, [data-w]")) { geschichteKlappen(story.dataset.sid); return; }
    const kz = t.closest("[data-kzeit]");
    if (kz) { zustand.kZeit = kz.dataset.kzeit; sichern(); kalenderTabelle(); return; }
    const kw = t.closest("[data-kwichtig]");
    if (kw) { zustand.kWichtig = +kw.dataset.kwichtig; sichern(); kalenderTabelle(); return; }
    const bw = t.closest("[data-bewegung]");
    if (bw) { zustand.bewegung = bw.dataset.bewegung; sichern(); $$("[data-bewegung]", huelle).forEach((b) => b.setAttribute("aria-pressed", String(b === bw))); fensterBewegung(); return; }
    const zeile = t.closest("[data-k]");
    if (zeile && !t.closest("a")) { kalenderAufklappen(zeile.dataset.k); return; }
    if (t.closest("[data-wm-hinweise]")) { hinweiseSchalten(); return; }
    if (t.closest("[data-mehr-neu]")) { $(`[data-inhalt="news"]`, huelle).scrollTop = 0; return; }
    if (t.closest("[data-analyse]")) { location.hash = "#" + zustand.wert; return; }
    if (t.closest("[data-backtest]")) { location.hash = "#backtest"; return; }
    if (t.closest("[data-fh-speichern]")) { finnhubSpeichern(); return; }
  }
  function aenderung(e) {
    const z = e.target.closest("[data-z]");
    if (z) { zustand[z.dataset.z] = z.checked; sichern(); if (z.dataset.z === "abst") fensterKurse(); }
  }
  function tasten(e) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); $("#wm-befehl", huelle).focus(); return; }
    if (e.target.closest && e.target.closest("input, textarea, select")) return;
    if (e.key === "Enter" || e.key === " ") {
      const st = e.target.closest && e.target.closest(".wm-s[data-sid]");
      if (st && e.target === st) { e.preventDefault(); geschichteKlappen(st.dataset.sid); return; }
      const tz = e.target.closest && e.target.closest("article[data-zk]");
      if (tz && e.target === tz) { e.preventDefault(); terminZeigen(tz.dataset.zk); return; }
      const z = e.target.closest && e.target.closest("tr[data-k], tr[data-w]");
      if (z) { e.preventDefault(); if (z.dataset.k) kalenderAufklappen(z.dataset.k); else waehle(z.dataset.w); return; }
    }
    if (e.key === "/") { e.preventDefault(); $("#wm-befehl", huelle).focus(); return; }
    if (e.key === "?") { e.preventDefault(); hilfe(); return; }
    if ((e.key === "v" || e.key === "V") && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); vollbild(); return; }
    if (/^[1-7]$/.test(e.key) && !e.altKey && !e.ctrlKey && !e.metaKey) { e.preventDefault(); fokus(FENSTER[+e.key - 1][0]); return; }
    if ((e.key === "f" || e.key === "F") && !e.ctrlKey && !e.metaKey) {
      const f = document.activeElement && document.activeElement.closest(".wm-fenster");
      maxi(zustand.maxi ? null : f ? f.dataset.fenster : "wert"); e.preventDefault(); return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const a = document.activeElement;
      if (a && a.closest('[data-fenster="news"], [data-fenster="kalender"], [data-fenster="lage"], [data-fenster="bewegung"]')) return;
      const liste = sichtbareWerte();
      const i = liste.indexOf(zustand.wert);
      const n = liste[Math.max(0, Math.min(liste.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))];
      if (n && n !== zustand.wert) { e.preventDefault(); waehle(n, true); }
    }
  }
  function fokus(id) {
    const f = $(`[data-fenster="${id}"]`, huelle);
    if (!f) return;
    if (zustand.maxi && zustand.maxi !== id) maxi(id);
    f.focus({ preventScroll: true });
    f.scrollIntoView({ block: "nearest" });
    f.classList.remove("wm-blick"); void f.offsetWidth; f.classList.add("wm-blick");
  }
  function maxi(id) {
    zustand.maxi = id;
    $(".wm-gitter", huelle).classList.toggle("wm-einzeln", !!id);
    $$(".wm-fenster", huelle).forEach((f) => { f.classList.toggle("wm-gross", f.dataset.fenster === id); });
    $$("[data-wm-maxi]", huelle).forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.wmMaxi === id)));
    if (id === "wert" || !id) requestAnimationFrame(zeichneChart);
    if (id === "lage" || !id) requestAnimationFrame(fensterLage);
  }
  // Vollbild: Der Browser zeigt nur den Work-Modus, alle sieben Fenster passen dicht gepackt auf einen Bildschirm.
  // Ohne Vollbild-Schnittstelle (z. B. iPhone) wird nur die dichte Anordnung eingeschaltet.
  function vollbild() {
    const an = !huelle.classList.contains("wm-vollbild");
    if (zustand.maxi) maxi(null);
    if (an && huelle.requestFullscreen) huelle.requestFullscreen().catch(() => vollbildStil(true));
    else if (!an && document.fullscreenElement) document.exitFullscreen().catch(() => vollbildStil(false));
    else vollbildStil(an);
  }
  function vollbildStil(an) {
    if (!huelle) return;
    huelle.classList.toggle("wm-vollbild", an);
    const k = $("[data-wm-vollbild]", huelle);
    if (k) { k.setAttribute("aria-pressed", String(an)); $("span", k).textContent = an ? "Vollbild aus" : "Vollbild"; }
    requestAnimationFrame(() => { zeichneChart(); zeitstrahl(); });
  }
  document.addEventListener("fullscreenchange", () => { if (huelle) vollbildStil(document.fullscreenElement === huelle); });
  function hilfe() { const h = $(".wm-hilfe", huelle); h.hidden = !h.hidden; }
  function waehle(slug, ausTastatur) {
    if (!WERTE[slug]) return;
    zustand.wert = slug; sichern();
    $$('[data-fenster="kurse"] tr[data-w]', huelle).forEach((tr) => { const an = tr.dataset.w === slug; tr.classList.toggle("aktiv", an); tr.setAttribute("aria-selected", String(an)); });
    const tr = $(`[data-fenster="kurse"] tr[data-w="${slug}"]`, huelle);
    if (tr && ausTastatur) tr.scrollIntoView({ block: "nearest" });
    fensterWert();
    if (window.matchMedia("(max-width: 1099px)").matches && !ausTastatur) fokus("wert");
  }

  /* ---------------------------------------------------------------- Befehlszeile */
  function treffer(text) {
    const q = text.trim().toLowerCase();
    if (!q) return [];
    return SLUGS.map((s) => {
      const b = WERTE[s], sym = kurzSym(b).toLowerCase(), name = String(b.name).toLowerCase();
      const p = sym === q ? 0 : name === q ? 1 : sym.startsWith(q) ? 2 : name.startsWith(q) ? 3 : name.includes(q) || sym.includes(q) ? 4 : 9;
      return [p, s];
    }).filter(([p]) => p < 9).sort((a, b) => a[0] - b[0]).slice(0, 7).map(([, s]) => s);
  }
  let vorschlagIdx = -1;
  function vorschlagen() {
    const ul = $("#wm-vorschlag", huelle), v = $("#wm-befehl", huelle).value;
    const liste = treffer(v);
    vorschlagIdx = -1;
    ul.hidden = !liste.length;
    ul.innerHTML = liste.map((s, i) => `<li role="option" id="wm-v-${i}" data-w="${s}"><b>${esc(kurzSym(WERTE[s]))}</b> ${esc(WERTE[s].name)} <span>${esc(KLASSE_NAME[WERTE[s].typ] || "")}</span></li>`).join("");
  }
  function befehlTasten(e) {
    const ul = $("#wm-vorschlag", huelle), n = ul.children.length;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!n) return;
      e.preventDefault();
      vorschlagIdx = (vorschlagIdx + (e.key === "ArrowDown" ? 1 : n - 1)) % n;
      [...ul.children].forEach((li, i) => li.setAttribute("aria-selected", String(i === vorschlagIdx)));
      $("#wm-befehl", huelle).setAttribute("aria-activedescendant", "wm-v-" + vorschlagIdx);
    } else if (e.key === "Escape") {
      if (!ul.hidden) { ul.hidden = true; e.stopPropagation(); }
      else e.target.blur();
    } else if (e.key === "Enter" && vorschlagIdx >= 0 && ul.children[vorschlagIdx]) {
      e.preventDefault();
      waehleAusBefehl(ul.children[vorschlagIdx].dataset.w);
    }
  }
  function waehleAusBefehl(slug) {
    const i = $("#wm-befehl", huelle);
    i.value = ""; $("#wm-vorschlag", huelle).hidden = true;
    waehle(slug, true);
    fokus("wert");
  }
  function befehl(roh) {
    const v = roh.trim(), g = v.toUpperCase();
    const i = $("#wm-befehl", huelle);
    const fertig = () => { i.value = ""; $("#wm-vorschlag", huelle).hidden = true; };
    if (!v) return;
    if (g === "?" || g === "HILFE" || g === "HELP") { fertig(); hilfe(); return; }
    if (/^[1-7]$/.test(g)) { fertig(); fokus(FENSTER[+g - 1][0]); return; }
    const kurz = { Z: "zeit", ZEIT: "zeit", N: "news", NEWS: "news", NACHRICHTEN: "news", K: "kalender", KAL: "kalender", CAL: "kalender", ECO: "kalender", W: "wert", L: "lage", B: "bewegung", HM: "bewegung", M: "kurse" };
    if (kurz[g]) { fertig(); fokus(kurz[g]); return; }
    if (g === "BT" || g === "BACKTEST") { fertig(); location.hash = "#backtest"; return; }
    if (g === "A" || g === "ANALYSE") { fertig(); location.hash = "#" + zustand.wert; return; }
    const t = treffer(v);
    if (t.length) { waehleAusBefehl(t[0]); return; }
    i.setCustomValidity("Kein Wert gefunden"); i.reportValidity(); setTimeout(() => i.setCustomValidity(""), 1500);
  }

  /* ================================================================ Kopfzeile: Uhren und Status */
  function uhren() {
    const el = $(".wm-uhren", huelle);
    const jetzt = Date.now();
    const liste = [...W.BOERSEN, W.FOREX];
    if (!el.children.length) {
      el.innerHTML = liste.map((b) => `<div class="wm-uhr" data-b="${b.id}" title="${esc(b.name)} (${esc(b.kurz)}), reguläre Handelszeit ohne Feiertage">
        <span class="wm-uhr-ort">${esc(b.id === "fx" ? "FX" : b.name.slice(0, 3).toUpperCase())}</span><b></b><span class="wm-uhr-status"></span></div>`).join("");
    }
    liste.forEach((b) => {
      const s = W.boersenStatus(b, jetzt), d = $(`[data-b="${b.id}"]`, el);
      d.classList.toggle("offen", s.offen); d.classList.toggle("pause", s.pause);
      $("b", d).textContent = b.id === "fx" ? fUhr.format(jetzt) : s.ort;
      $(".wm-uhr-status", d).textContent = (s.offen ? "zu in " : s.pause ? "Pause " : "auf in ") + W.dauer(s.wechselMs).replace(/:\d\d$/, (m) => (s.wechselMs < 3600e3 ? m : ""));
    });
  }
  function status() {
    const el = $(".wm-status", huelle);
    const l = liveAktiv(), q = live().quellen || {};
    const kurse = l ? `<span class="wm-punkt an"></span>Kurse live${q.finnhub ? " · Finnhub" : ""}${q.lokal ? " · live.py" : ""}`
      : `<span class="wm-punkt"></span>Kurse vom ${esc(datumKurz(BASIS.stand))}`;
    const n = newsZustand.quellen.length ? newsZustand.quellen.join(" + ") : "keine Quelle";
    el.innerHTML = `<span>${kurse}</span><span><span class="wm-punkt${newsZustand.quellen.length ? " an" : ""}"></span>News: ${esc(n)}</span>`;
  }
  const datumKurz = (iso) => (iso ? iso.slice(8, 10) + "." + iso.slice(5, 7) + "." : "–");

  function sekunde() {
    if (!offen) return;
    const jetzt = Date.now();
    uhren();
    $$("[data-bis]", huelle).forEach((el) => {
      const ms = +el.dataset.bis - jetzt;
      el.textContent = ms > 0 ? W.dauer(ms) : ms > -120e3 ? "jetzt" : el.dataset.vorbei || "";
      el.classList.toggle("bald", ms > 0 && ms < 15 * 60e3);
    });
    if (jetzt - (sekunde.alter || 0) > 15e3) {
      sekunde.alter = jetzt;
      $$("[data-seit]", huelle).forEach((el) => (el.textContent = W.alter(jetzt - +el.dataset.seit)));
      $$(".wm-s.neu", huelle).forEach((el) => { if (jetzt - +el.dataset.ankunft > 90e3) el.classList.remove("neu"); });
      eilband();
    }
    const a = $("[data-abruf]", huelle);
    if (a && newsZustand.naechster) {
      const ms = newsZustand.naechster - jetzt;
      a.textContent = newsZustand.laedt ? "lädt …" : ms > 0 ? "neu in " + W.dauer(ms) : "";
    }
    // Termin gerade vorbei oder Kalenderdaten alt: Tabelle neu
    if (kalender && kalender.naechsterWechsel && jetzt >= kalender.naechsterWechsel) kalenderTabelle();
    if (jetzt - (sekunde.status || 0) > 5e3) { sekunde.status = jetzt; status(); }
    if (jetzt - (sekunde.sitz || 0) > 30e3) { sekunde.sitz = jetzt; sitzungsLeiste(); zeitstrahl(); }
    if (jetzt - eilWechsel > 8000) eilband();
  }

  /* ================================================================ 1 Kurse */
  function sichtbareWerte() {
    let liste = SLUGS.slice();
    if (zustand.abst) liste = liste.filter((s) => { const r = signal(s); return r && r.treffer; });
    if (zustand.sort) {
      const k = zustand.sort.k;
      const wert = (s) => {
        const b = WERTE[s], i = kursInfo(s), kz = b.kz || {};
        return k === "name" ? String(b.name).toLowerCase() : k === "kurs" ? i.kurs : k === "heute" ? i.heute : k === "w1" ? b.rendite_1w
          : k === "ytd" ? b.rendite_ytd : k === "lage" ? lagePos(s) : k === "vol" ? kz.vol_1m : k === "sig" ? (signal(s) || {}).punkte : null;
      };
      liste.sort((a, b) => {
        const x = wert(a), y = wert(b);
        if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1;
        return (x < y ? -1 : x > y ? 1 : 0) * (zustand.sort.ab ? -1 : 1);
      });
    }
    return liste;
  }
  function lagePos(slug) {
    const b = WERTE[slug], p = kursInfo(slug).kurs;
    const hoch = Math.max(b.hoch || p, p), tief = Math.min(b.tief || p, p);
    return hoch > tief ? (p - tief) / (hoch - tief) : null;
  }
  function fensterKurse() {
    const el = $('[data-inhalt="kurse"]', huelle);
    const liste = sichtbareWerte();
    const s = zustand.sort;
    const th = (k, t, kl = "", titel = "") => `<th scope="col" class="${kl}"><button type="button" data-sort="${k}" title="${esc(titel || "Sortieren")}"${s && s.k === k ? ` aria-sort="${s.ab ? "descending" : "ascending"}"` : ""}>${t}${s && s.k === k ? (s.ab ? " ↓" : " ↑") : ""}</button></th>`;
    let zeilen = "";
    let gruppe = null;
    for (const slug of liste) {
      const b = WERTE[slug];
      if (!s && b.typ !== gruppe) { gruppe = b.typ; zeilen += `<tr class="wm-gruppe"><th colspan="8" scope="rowgroup">${esc(KLASSE_NAME[b.typ] || b.typ)}</th></tr>`; }
      zeilen += `<tr data-w="${slug}" tabindex="0" role="row" aria-selected="${slug === zustand.wert}"${slug === zustand.wert ? ' class="aktiv"' : ""}>
        <td class="wm-name"><b>${esc(kurzName(b))}</b><span>${esc(kurzSym(b))}</span></td>
        <td class="r" data-c="kurs"></td><td class="r" data-c="heute"></td><td class="r" data-c="w1"></td>
        <td class="r wm-opt" data-c="ytd"></td><td class="wm-opt2" data-c="lage"></td><td class="r wm-opt" data-c="vol"></td><td class="r wm-opt3" data-c="sig"></td></tr>`;
    }
    el.innerHTML = `<table class="wm-tab wm-kurse" role="grid" aria-label="Kurse aller Werte">
      <thead><tr>${th("name", "Wert")}${th("kurs", "Kurs", "r")}${th("heute", "Heute", "r", "Veränderung zum Vortagesschluss (nur mit Live-Kursen)")}${th("w1", "1W", "r")}
      ${th("ytd", "YTD", "r wm-opt")}${th("lage", "52W", "wm-opt2", "Lage in der 52-Wochen-Spanne")}${th("vol", "Vol", "r wm-opt", "Volatilität eines Monats, aufs Jahr gerechnet")}${th("sig", "Sig.", "r wm-opt3", "Erfüllte Signale von aktiven")}</tr></thead>
      <tbody>${zeilen || '<tr><td colspan="8" class="wm-leer">Keine Werte.</td></tr>'}</tbody></table>
      <p class="wm-fuss" data-breite></p>`;
    liste.forEach(kursZeile);
    breite();
  }
  function kursZeile(slug) {
    const tr = $(`[data-fenster="kurse"] tr[data-w="${slug}"]`, huelle);
    if (!tr) return;
    const b = WERTE[slug], i = kursInfo(slug), kz = b.kz || {}, r = signal(slug);
    const setz = (k, html, kl) => { const td = $(`[data-c="${k}"]`, tr); if (td.innerHTML !== html) td.innerHTML = html; if (kl !== undefined) td.className = td.className.replace(/\s?(plus|minus)/g, "") + (kl ? " " + kl : ""); };
    const neu = zahl(i.kurs, b.dez || 2);
    const alt = $('[data-c="kurs"]', tr).textContent;
    setz("kurs", neu);
    if (alt && alt !== neu && alt !== "–") blitz($('[data-c="kurs"]', tr), parseZahl(neu) > parseZahl(alt));
    setz("heute", pct(i.heute, 2), ton(i.heute));
    setz("w1", pct(b.rendite_1w), ton(b.rendite_1w));
    setz("ytd", pct(b.rendite_ytd, 0), ton(b.rendite_ytd));
    const l = lagePos(slug);
    setz("lage", l == null ? "" : `<span class="wm-spanne" title="52W: ${zahl(b.tief, b.dez)} bis ${zahl(b.hoch, b.dez)}"><i style="left:${(l * 100).toFixed(1)}%"></i></span>`);
    setz("vol", pct(kz.vol_1m, 0, false));
    setz("sig", r ? `<span class="wm-sig${r.treffer ? " treffer" : ""}" title="${r.punkte} von ${r.max} aktiven Signalen erfüllt${r.treffer ? ", Treffer" : ""}">${r.punkte}/${r.max}</span>` : "–");
  }
  const parseZahl = (t) => parseFloat(String(t).replace(/\./g, "").replace(",", ".").replace("−", "-"));
  function blitz(el, hoch) { el.classList.remove("tick-hoch", "tick-runter"); void el.offsetWidth; el.classList.add(hoch ? "tick-hoch" : "tick-runter"); }
  function breite() {
    const el = $("[data-breite]", huelle);
    if (!el) return;
    const werte = SLUGS.map((s) => kursInfo(s).heute).filter((x) => x != null);
    if (!werte.length) { el.textContent = "Ohne Live-Kurse zeigt „Heute“ nichts. Live: python live.py oder ein Finnhub-Schlüssel (US-Aktien)."; return; }
    const auf = werte.filter((x) => x > 0).length, ab = werte.filter((x) => x < 0).length;
    el.innerHTML = `Breite heute <b class="plus">▲ ${auf}</b> <b class="minus">▼ ${ab}</b> · Ø ${pct(werte.reduce((a, x) => a + x, 0) / werte.length, 2)}`;
  }

  /* ================================================================ 2 Wert */
  function fensterWert() {
    const el = $('[data-inhalt="wert"]', huelle);
    const slug = zustand.wert;
    if (!slug) { el.innerHTML = '<p class="wm-leer">Keine Werte auf der Watchlist.</p>'; return; }
    const b = WERTE[slug];
    $("#wm-t-wert", huelle).textContent = kurzName(b);
    el.innerHTML = `
      <div class="wm-d-kopf">
        <div class="wm-d-name"><h4>${esc(b.name)}</h4><p>${esc([kurzSym(b), KLASSE_NAME[b.typ], b.waehrung, b.sektor, b.isin].filter(Boolean).join(" · "))}</p></div>
        <div class="wm-d-kurs"><b data-d="kurs"></b><span data-d="heute"></span><small data-d="zeit"></small></div>
      </div>
      <div class="wm-d-chart">
        <div class="wm-tabs" role="group" aria-label="Zeitraum des Charts">${["Heute", "1M", "3M", "6M", "1J", "5J"].map((k) =>
          `<button type="button" data-chart="${k}" aria-pressed="${zustand.chart === k}">${k}</button>`).join("")}<span class="wm-chart-info" data-d="chartinfo"></span>${window.WBKerzen ? window.WBKerzen.schalter("wm-chart-art") : ""}</div>
        <div class="wm-chart" data-d="chart"></div>
      </div>
      <div class="wm-d-stats" data-d="stats"></div>
      <div class="wm-d-block" data-d="krit"></div>
      <div class="wm-d-block" data-d="termin"></div>
      <div class="wm-d-block" data-d="news"></div>
      <div class="wm-d-aktion">
        <a href="#${esc(slug)}" class="wm-knopf wm-text" data-analyse>Analyse öffnen</a>
        <a href="#backtest" class="wm-knopf wm-text" data-backtest>Backtest</a>
      </div>`;
    detailKopf();
    ladeReihe(slug).then(() => { if (zustand.wert === slug && offen) { zeichneChart(); detailStatistik(); } });
    zeichneChart();
    detailStatistik();
    detailKriterien();
    detailTermin();
    detailNews();
  }
  function detailKopf() {
    const slug = zustand.wert, b = WERTE[slug], i = kursInfo(slug), el = $('[data-inhalt="wert"]', huelle);
    if (!el || !$('[data-d="kurs"]', el)) return;
    const k = $('[data-d="kurs"]', el), neu = zahl(i.kurs, b.dez || 2);
    if (k.textContent && k.textContent !== neu) blitz(k, parseZahl(neu) > parseZahl(k.textContent));
    k.textContent = neu;
    const h = $('[data-d="heute"]', el);
    const abs = i.heute != null ? i.kurs - i.kurs / (1 + i.heute) : null;
    h.textContent = i.heute == null ? "" : `${minus((abs > 0 ? "+" : "") + nf(b.dez || 2).format(abs))}  ${pct(i.heute, 2)}`;
    h.className = ton(i.heute);
    $('[data-d="zeit"]', el).textContent = i.live ? `${i.frisch ? "Live" : "Letzter Kurs"} ${fUhrSek.format(i.zeit)} · ${i.quelle === "finnhub" ? "Finnhub, Echtzeit" : "Yahoo, ggf. verzögert"}`
      : `Wochenschluss ${datumKurz(b.kurs_datum)} · ${b.waehrung || ""}`;
  }

  /* ---------------------------------------------------------------- Chart */
  function chartDaten() {
    const slug = zustand.wert, b = WERTE[slug], i = kursInfo(slug);
    if (zustand.chart === "Heute") {
      const L = live(), t = (L.tag && L.tag[slug]) || null;
      let x = t ? t.x.map((s) => Date.parse(s)) : [], y = t ? t.y.slice() : [];
      const mitK = t && t.o && t.o.length === x.length;
      const o = mitK ? t.o.slice() : null, h = mitK ? t.h.slice() : null, l = mitK ? t.l.slice() : null;
      const neu = (ms, kurs) => { const vor = y.length ? y[y.length - 1] : kurs; x.push(ms); y.push(kurs); if (o) { o.push(vor); h.push(Math.max(vor, kurs)); l.push(Math.min(vor, kurs)); } };
      const ticks = (L.ticks && L.ticks[slug]) || {};
      Object.keys(ticks).sort().forEach((m) => { const ms = Date.parse(m); if (!x.length || ms > x[x.length - 1]) neu(ms, ticks[m]); });
      if (i.live && i.zeit && (!x.length || i.zeit > x[x.length - 1])) neu(i.zeit, i.kurs);
      const vortag = L.stand[slug] && L.stand[slug].vortag;
      if (!t && L.quellen && L.quellen.lokal && L.holeTag && !chartDaten.holt) {
        chartDaten.holt = true;
        L.holeTag(slug).then(() => { chartDaten.holt = false; if (zustand.wert === slug && zustand.chart === "Heute") zeichneChart(); });
      }
      return { x, y, o, h, l, zeit: true, ref: vortag, leer: L.quellen && L.quellen.lokal ? "Tagesverlauf wird geladen …" : "Für „Heute“ braucht es Live-Kurse: python live.py oder ein Finnhub-Schlüssel." };
    }
    const r = reihen[slug];
    if (!r) return { x: [], y: [], leer: reihen[slug] === null ? "Keine Kursreihe für diesen Wert." : "Kurse werden geladen …" };
    const tage = { "1M": 31, "3M": 92, "6M": 183, "1J": 366, "5J": 1830 }[zustand.chart] || 92;
    const ab = r.t[r.n - 1] - tage;
    const x = [], y = [], o = r.o ? [] : null, h = r.o ? [] : null, l = r.o ? [] : null;
    for (let j = 0; j < r.n; j++) if (r.t[j] >= ab) { x.push(r.t[j] * 864e5); y.push(r.c[j]); if (o) { o.push(r.o[j]); h.push(r.h[j]); l.push(r.l[j]); } }
    if (i.live && i.frisch && x.length) {
      const vor = y[y.length - 1]; x.push(Date.now()); y.push(i.kurs);
      if (o) { o.push(vor); h.push(Math.max(vor, i.kurs)); l.push(Math.min(vor, i.kurs)); }
    }
    return { x, y, o, h, l, zeit: false, ref: null, dez: b.dez };
  }
  function zeichneChart() {
    const el = huelle && $('[data-d="chart"]', huelle);
    if (!el || !offen) return;
    $$("[data-chart]", huelle).forEach((k) => k.setAttribute("aria-pressed", String(k.dataset.chart === zustand.chart)));
    const d = chartDaten(), b = WERTE[zustand.wert], dez = b.dez || 2;
    const info = $('[data-d="chartinfo"]', huelle);
    if (d.y.length < 2) { el.innerHTML = `<p class="wm-leer">${esc(d.leer || "Keine Daten.")}</p>`; info.textContent = ""; return; }
    const B = Math.max(260, el.clientWidth || 520), H = Math.max(120, el.clientHeight || 160), lr = 52, ob = 8, un = 18;
    const KZ = window.WBKerzen, kerzen = !!(d.o && KZ && KZ.art() === "kerzen");
    let lo = Math.min(...d.y, d.ref || Infinity), hi = Math.max(...d.y, d.ref || -Infinity);
    if (kerzen) { lo = Math.min(lo, ...d.l); hi = Math.max(hi, ...d.h); }
    if (hi === lo) { hi += 1; lo -= 1; }
    const pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
    const x0 = d.x[0], x1 = d.x[d.x.length - 1];
    const X = (v) => ((v - x0) / (x1 - x0 || 1)) * (B - lr - 2) + 1, Y = (v) => ob + (1 - (v - lo) / (hi - lo)) * (H - ob - un);
    const pfad = d.y.map((v, j) => (j ? "L" : "M") + X(d.x[j]).toFixed(1) + " " + Y(v).toFixed(1)).join("");
    const erste = d.y[0], letzte = d.y[d.y.length - 1], aufw = letzte >= erste;
    const raster = [0, 1, 2, 3].map((k) => lo + ((hi - lo) * (k + 0.5)) / 4);
    const xBeschr = [0, 0.5, 1].map((f) => x0 + (x1 - x0) * f);
    const fx = (ms) => (d.zeit ? fUhr.format(ms) : fDatum.format(new Date(ms)));
    function kerzenSvg() {
      const k = KZ.buendeln(d.x, d.o, d.h, d.l, d.y, Math.max(12, Math.floor((B - lr) / 5)));
      const p = KZ.pfade(k, (j) => X((d.x[k.von[j]] + d.x[k.bis[j]]) / 2), Y, KZ.breiteAus((B - lr) / Math.max(1, k.c.length)));
      return `<path class="kerze auf" d="${p.auf}"/><path class="kerze ab" d="${p.ab}"/>`;
    }
    el.innerHTML = `<svg viewBox="0 0 ${B} ${H}" width="${B}" height="${H}" role="img" aria-label="Kursverlauf ${esc(zustand.chart)}: von ${zahl(erste, dez)} auf ${zahl(letzte, dez)}">
      ${raster.map((v) => `<line class="wm-raster" x1="0" x2="${B - lr}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"/><text class="wm-achse" x="${B - lr + 6}" y="${(Y(v) + 3.5).toFixed(1)}">${zahl(v, dez > 2 ? dez : v >= 1000 ? 0 : 2)}</text>`).join("")}
      ${d.ref ? `<line class="wm-ref" x1="0" x2="${B - lr}" y1="${Y(d.ref).toFixed(1)}" y2="${Y(d.ref).toFixed(1)}"/>` : ""}
      ${kerzen ? kerzenSvg() : `<path class="wm-flaeche ${aufw ? "plus" : "minus"}" d="${pfad}L${X(x1).toFixed(1)} ${H - un}L${X(x0).toFixed(1)} ${H - un}Z"/>
      <path class="wm-linie ${aufw ? "plus" : "minus"}" d="${pfad}"/>`}
      <circle class="wm-letzter ${aufw ? "plus" : "minus"}" cx="${X(x1).toFixed(1)}" cy="${Y(letzte).toFixed(1)}" r="2.6"/>
      ${xBeschr.map((v, k) => `<text class="wm-achse" x="${k === 0 ? 1 : k === 2 ? B - lr - 1 : X(v)}" y="${H - 4}" text-anchor="${k === 0 ? "start" : k === 2 ? "end" : "middle"}">${fx(v)}</text>`).join("")}
      <line class="wm-fadenkreuz" x1="0" x2="0" y1="${ob}" y2="${H - un}" hidden/><circle class="wm-fadenpunkt" r="3" hidden/>
    </svg><div class="wm-chart-tipp" hidden></div>`;
    const rueck = letzte / (d.ref || erste) - 1;
    info.innerHTML = `<span class="${ton(rueck)}">${pct(rueck, 2)}</span> · Hoch ${zahl(Math.max(...d.y), dez)} · Tief ${zahl(Math.min(...d.y), dez)}`;
    const svg = $("svg", el), linie = $(".wm-fadenkreuz", svg), punkt = $(".wm-fadenpunkt", svg), tipp = $(".wm-chart-tipp", el);
    svg.addEventListener("pointermove", (e) => {
      const r = svg.getBoundingClientRect(), px = ((e.clientX - r.left) / r.width) * B;
      const ms = x0 + ((px - 1) / (B - lr - 2)) * (x1 - x0);
      let j = 0; while (j < d.x.length - 1 && d.x[j + 1] <= ms) j++;
      if (j < d.x.length - 1 && Math.abs(d.x[j + 1] - ms) < Math.abs(d.x[j] - ms)) j++;
      const cx = X(d.x[j]), cy = Y(d.y[j]);
      linie.removeAttribute("hidden"); punkt.removeAttribute("hidden");
      linie.setAttribute("x1", cx); linie.setAttribute("x2", cx); punkt.setAttribute("cx", cx); punkt.setAttribute("cy", cy);
      tipp.hidden = false;
      tipp.textContent = `${d.zeit ? fUhr.format(d.x[j]) : fDatum.format(new Date(d.x[j]))}  ` + (kerzen
        ? `E ${zahl(d.o[j], dez)} H ${zahl(d.h[j], dez)} T ${zahl(d.l[j], dez)} S ${zahl(d.y[j], dez)}`
        : `${zahl(d.y[j], dez)}  ${pct(d.y[j] / erste - 1, 2)}`);
      tipp.style.left = Math.min(r.width - (kerzen ? 260 : 150), Math.max(0, (cx / B) * r.width - 60)) + "px";
    });
    svg.addEventListener("pointerleave", () => { linie.setAttribute("hidden", ""); punkt.setAttribute("hidden", ""); tipp.hidden = true; });
  }

  /* ---------------------------------------------------------------- Kennzahlen */
  function detailStatistik() {
    const el = huelle && $('[data-d="stats"]', huelle);
    if (!el) return;
    const slug = zustand.wert, b = WERTE[slug], kz = b.kz || {}, i = kursInfo(slug), r = reihen[slug];
    const re = r ? W.renditen(r, i.frisch ? i.kurs : null) : {};
    const md = r ? W.maxRueckgang(r) : null;
    const bk = r && MARKT && reihen[MARKT] && MARKT !== slug ? W.betaKorr(r, reihen[MARKT]) : null;
    const sh = r ? W.sharpe(r, 252, 0) : null;
    const zeile = (label, wert, kl = "", titel = "") => `<div${titel ? ` title="${esc(titel)}"` : ""}><dt>${esc(label)}</dt><dd class="${kl}">${wert}</dd></div>`;
    const block = (titel, zeilen) => `<section><h5>${esc(titel)}</h5><dl>${zeilen.join("")}</dl></section>`;
    const p = i.kurs, hoch = Math.max(b.hoch || p, p), tief = Math.min(b.tief || p, p);
    const bloecke = [];
    bloecke.push(block("Rendite", ["1W", "1M", "3M", "6M", "YTD", "1J", "3J", "5J"].map((k) => zeile(k, pct(re[k] != null ? re[k] : k === "YTD" ? b.rendite_ytd : null), ton(re[k])))));
    bloecke.push(block("Risiko", [
      zeile("Vol 1M", pct(kz.vol_1m, 1, false), "", "Schwankung eines Monats, aufs Jahr gerechnet"),
      zeile("Vol 1J", pct(kz.vol_1j != null ? kz.vol_1j : r ? W.volatilitaet(r) : null, 1, false)),
      zeile("Vol 1M / Median", zahl(kz.vol_verhaeltnis, 2), kz.vol_verhaeltnis > 1.3 ? "minus" : ""),
      zeile("Max. Rückgang 1J", md ? pct(md.tiefe) : "–", md && md.tiefe < -0.2 ? "minus" : "", md && md.von ? `vom Hoch am ${fDatum.format(new Date(md.von * 864e5))} bis ${fDatum.format(new Date(md.bis * 864e5))}` : ""),
      zeile("Sharpe 1J", zahl(sh, 2), ton(sh, 0.01), "Rendite ÷ Schwankung des letzten Jahres, ohne Zinsabzug"),
      zeile("Beta S&P 500", bk ? zahl(bk.beta, 2) : "–", "", bk ? `aus ${bk.n} gemeinsamen Handelstagen` : "Braucht die Kurse des S&P 500"),
      zeile("Korrelation", bk ? zahl(bk.korr, 2) : "–"),
      zeile("Knock-out-Risiko", pct(kz.ko_risiko, 0, false), "", "Anteil der 10-Tage-Fenster, in denen ein Long-Knock-out mit Hebel 5 gefallen wäre"),
    ]));
    bloecke.push(block("Technik", [
      zeile("52W-Hoch", zahl(hoch, b.dez)), zeile("52W-Tief", zahl(tief, b.dez)),
      zeile("Abstand Hoch", pct(p / hoch - 1), ton(p / hoch - 1)),
      zeile("Lage in Spanne", pct(hoch > tief ? (p - tief) / (hoch - tief) : null, 0, false)),
      zeile("200-Tage-Linie", zahl(kz.gd200, b.dez)), zeile("Abstand GD200", pct(kz.gd200 ? p / kz.gd200 - 1 : null), ton(kz.gd200 ? p / kz.gd200 - 1 : null)),
      zeile("Momentum 12-1", pct(kz.momentum_12_1), ton(kz.momentum_12_1), "Rendite von vor zwölf bis vor einem Monat"),
      zeile("zum 5J-Mittel", pct(kz.mittel_5j ? p / kz.mittel_5j - 1 : null), ""),
      zeile("Saison " + (kz.monat || ""), pct(kz.saison), ton(kz.saison), kz.saison_quote != null ? `In ${Math.round(kz.saison_quote * 100)} % der letzten ${kz.jahre || "?"} Jahre gestiegen` : ""),
      zeile("Technik-Fazit", esc(b.technik || "–")),
    ]));
    if (b.typ === "aktie" || b.typ === "etf") {
      const kgv = b.fwd_kgv && b.kurs ? (b.fwd_kgv * p) / b.kurs : null;
      bloecke.push(block("Fundamental", [
        zeile("Börsenwert", mrd(b.boersenwert_eur ? (b.boersenwert_eur * p) / b.kurs : null)),
        zeile("Forward-KGV", zahl(kgv, 1)), zeile("KGV Ø 5 Jahre", zahl(b.kgv_median, 1)),
        zeile("Kursziel", zahl(b.ziel, 2)), zeile("Abstand Kursziel", pct(b.ziel ? b.ziel / p - 1 : null), ton(b.ziel ? b.ziel / p - 1 : null)),
        zeile("Umsatz j/j", pct(b.umsatz_yoy), ton(b.umsatz_yoy)), zeile("Gewinn j/j", pct(b.gewinn_yoy), ton(b.gewinn_yoy)),
        zeile("Eigenkapitalrendite", pct(kz.roe, 1, false)), zeile("FCF-Rendite", pct(kz.fcf_rendite, 1, false)),
        zeile("Nettoschulden/EBITDA", zahl(kz.nd_ebitda, 2)), zeile("EPS-Revision 90 T.", pct(kz.eps_revision), ton(kz.eps_revision)),
      ]));
    } else if (b.typ === "forex") {
      const c = b.carry || {};
      bloecke.push(block("Zinsen und Carry", [
        zeile("Leitzins " + (c.basis || "Basis"), pct(kz.zins_basis, 2, false)), zeile("Leitzins " + (c.gegen || "Gegen"), pct(kz.zins_gegen, 2, false)),
        zeile("Zinsdifferenz", pp(kz.zinsdifferenz), ton(kz.zinsdifferenz)), zeile("Δ Differenz 3M", pp(kz.zins_trend), ton(kz.zins_trend)),
        zeile("Carry ÷ Schwankung", zahl(kz.carry_risk, 2), ton(kz.carry_risk, 0.005)),
        zeile("Inflation " + (c.basis || ""), pct(kz.inflation_basis, 1, false)), zeile("Inflation " + (c.gegen || ""), pct(kz.inflation_gegen, 1, false)),
        zeile("Realzins-Vorsprung", pp(kz.realzins_diff), ton(kz.realzins_diff)),
      ]));
    } else if (b.typ === "rohstoff") {
      bloecke.push(block("Terminkurve und Positionierung", [
        zeile("Roll-Rendite p. a.", pct(kz.roll_rendite), ton(kz.roll_rendite), "Aus den beiden nächsten Kontrakten: positiv = Backwardation"),
        zeile("Kontrakt 1", kz.k1 ? `${esc(kz.k1)} ${zahl(kz.f1, b.dez)}` : "–"), zeile("Kontrakt 2", kz.k2 ? `${esc(kz.k2)} ${zahl(kz.f2, b.dez)}` : "–"),
        zeile("COT netto", pct(kz.cot_netto, 0), ton(kz.cot_netto), "Netto-Position der Spekulanten in % des offenen Interesses (CFTC)"),
        zeile("COT-Perzentil", pct(kz.cot_perzentil, 0, false), kz.cot_perzentil > 0.85 ? "minus" : kz.cot_perzentil < 0.15 ? "plus" : "", `Lage in den letzten ${kz.cot_wochen || "?"} Wochen`),
      ]));
    } else if (b.typ === "index") {
      bloecke.push(block("Risiko-Umfeld", [
        zeile("VIX", zahl(kz.vix, 1), kz.vix > 25 ? "minus" : ""), zeile("VIX 3 Monate", zahl(kz.vix3m, 1)),
        zeile("VIX-Kurve", kz.vix_struktur == null ? "–" : kz.vix_struktur < 1 ? "Contango (ruhig)" : "Backwardation (Stress)", kz.vix_struktur >= 1 ? "minus" : ""),
        zeile("High-Yield-Spread", pct(kz.hy_spread, 2, false), "", kz.hy_datum ? "Stand " + kz.hy_datum : ""),
      ]));
    }
    el.innerHTML = bloecke.join("");
  }
  function detailKriterien() {
    const el = $('[data-d="krit"]', huelle), slug = zustand.wert, r = signal(slug);
    if (!el) return;
    if (!r || !window.WBRegeln.auswahl) { el.innerHTML = ""; return; }
    const a = window.WBRegeln.auswahl(WERTE[slug].typ);
    const namen = a.pflicht.concat(a.zaehlt);
    el.innerHTML = `<h5>Signale <span>${r.punkte} von ${r.max} erfüllt${r.treffer ? ' · <b class="plus">Treffer</b>' : ""}</span></h5>
      <ul class="wm-krit">${namen.map((n) => { const x = r.k[n] || {}; return `<li class="${x.e ? "ja" : x.e == null ? "offen" : "nein"}" title="${esc(x.t || "")}"><i></i>${esc(n)}${a.pflicht.includes(n) ? " <small>Pflicht</small>" : ""}<span>${esc(x.t || "")}</span></li>`; }).join("")}</ul>`;
  }
  function detailTermin() {
    const el = $('[data-d="termin"]', huelle), slug = zustand.wert, b = WERTE[slug];
    if (!el) return;
    const jetztMin = Date.now() / 6e4;
    const liste = (kalender ? kalender.termine : []).filter((e) => W.startMin(e) >= jetztMin - 60 &&
      (e.slug === slug || (e.art !== "zahlen" && (b.typ === "forex" ? String(b.symbol).includes(e.w) : b.typ === "index" || b.typ === "rohstoff" ? e.w === "USD" || (b.waehrung === e.w) : e.w === b.waehrung) && e.wichtig >= 3)))
      .slice(0, 3);
    el.innerHTML = liste.length ? `<h5>Nächste Termine</h5><ul class="wm-termine">${liste.map((e) => `<li><span>${esc(terminZeit(e, true))}</span><b>${esc(e.titel)}</b>${e.t != null ? `<span class="wm-bis" data-bis="${e.t * 6e4}"></span>` : ""}</li>`).join("")}</ul>` : "";
  }
  function detailNews() {
    const el = $('[data-d="news"]', huelle), slug = zustand.wert;
    if (!el) return;
    const liste = newsZustand.liste.filter((e) => e.werte.some((w) => w.slug === slug && w.direkt)).slice(0, 5);
    el.innerHTML = liste.length ? `<h5>Nachrichten zu ${esc(kurzName(WERTE[slug]))}</h5>${liste.map((e) => `<p class="wm-d-n"><time>${fUhr.format(e.t * 1000)}</time> ${W.sichereUrl(e.url) ? `<a href="${esc(W.sichereUrl(e.url))}" target="_blank" rel="noopener noreferrer">${esc(e.titel)}</a>` : esc(e.titel)}</p>`).join("")}` : "";
  }

  /* ================================================================ 3 Nachrichten */
  const newsZustand = { liste: [], ids: new Set(), quellen: [], naechster: null, laedt: false, nr: 0, fehler: null, ungelesen: 0, demo: false, hinweis: null };
  let server = null;
  async function serverDa() {
    if (server != null) return server;
    if (!window.WBH.serverMoeglich()) return (server = false);
    try { const r = await fetch("api/status", { cache: "no-store" }); server = r.ok; } catch (e) { server = false; }
    return server;
  }
  const finnhubSchluessel = window.WBH.finnhub.schluessel, finnhubRest = window.WBH.finnhub.rest;
  let newsTimer = null, newsGestartet = false;
  async function nachrichtenStarten() {
    if (newsGestartet) return;
    newsGestartet = true;
    const q = [];
    if (await serverDa()) {
      try {
        const j = await (await fetch("api/nachrichten?seit=0", { cache: "no-store" })).json();
        if (j.demo) newsZustand.demo = true;
        else { q.push("server"); newsZustand.serverFinnhub = j.finnhub; aufnehmen(j.eintraege || []); newsZustand.nr = j.nr || 0; }
      } catch (e) { /* ältere live.py ohne Nachrichten */ }
    }
    if (finnhubSchluessel() && !(q.includes("server") && newsZustand.serverFinnhub)) q.push("finnhub");
    if (!q.length && (BASIS.demo || newsZustand.demo)) q.push("demo");
    newsZustand.aktiv = q;
    newsZustand.quellen = q.map((x) => ({ server: "live.py", finnhub: "Finnhub", demo: "Demo" }[x]));
    if (!q.length) newsZustand.hinweis = "einrichten";
    if (q.includes("demo")) demoStart();
    newsListe(true);
    status();
    abrufen();
  }
  async function abrufen() {
    clearTimeout(newsTimer);
    const q = newsZustand.aktiv || [];
    if (!q.length) return;
    newsZustand.laedt = true;
    let warte = 60e3;
    try {
      if (q.includes("server")) {
        const j = await (await fetch("api/nachrichten?seit=" + newsZustand.nr, { cache: "no-store" })).json();
        aufnehmen(j.eintraege || []); newsZustand.nr = j.nr || newsZustand.nr;
        newsZustand.serverQuellen = j.quellen || {};
        warte = 20e3;
      }
      if (q.includes("finnhub")) { await finnhubAbruf(); warte = Math.min(warte, 60e3); }
      if (q.includes("demo")) warte = Math.min(warte, 20e3);
      newsZustand.fehler = null;
    } catch (e) { newsZustand.fehler = String(e.message || e); warte = 60e3; }
    newsZustand.laedt = false;
    newsZustand.naechster = Date.now() + warte;
    newsTimer = setTimeout(abrufen, warte);
  }
  let fhRunde = 0;
  async function finnhubAbruf() {
    const k = encodeURIComponent(finnhubSchluessel()), rest = finnhubRest();
    const r = await fetch(`${rest}/news?category=general&token=${k}`);
    if (r.status === 401 || r.status === 403) throw new Error("Finnhub-Schlüssel abgelehnt");
    const neu = [];
    const lies_ = (liste, sym) => (liste || []).filter((n) => n.headline && n.datetime).map((n) => ({
      id: "f" + (n.id || n.url), t: n.datetime, quelle: n.source || "Finnhub", titel: W.bereinige(n.headline), text: W.bereinige(n.summary),
      url: W.sichereUrl(n.url), symbole: String(n.related || "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean).concat(sym ? [sym] : []), herkunft: "finnhub" }));
    if (r.ok) neu.push(...lies_(await r.json()));
    const us = SLUGS.filter((s) => WERTE[s].finnhub);
    const heute = new Date().toISOString().slice(0, 10), vor2 = new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10);
    for (const s of us.slice((fhRunde * 2) % Math.max(us.length, 1)).slice(0, 2)) {
      try {
        const c = await fetch(`${rest}/company-news?symbol=${encodeURIComponent(WERTE[s].finnhub)}&from=${vor2}&to=${heute}&token=${k}`);
        if (c.ok) neu.push(...lies_((await c.json()).slice(0, 20), WERTE[s].finnhub));
      } catch (e) { /* nächste Runde */ }
    }
    fhRunde++;
    aufnehmen(neu);
  }
  function aufnehmen(roh) {
    const jetzt = Date.now(), erste = !newsZustand.liste.length;
    const neu = [];
    for (const e of roh) {
      if (!e || newsZustand.ids.has(e.id) || !e.t || e.t * 1000 < jetzt - 3 * 864e5) continue;
      newsZustand.ids.add(e.id);
      const a = W.aufbereiten(e, MUSTER, WERTE);
      a.ankunft = erste ? 0 : jetzt;
      neu.push(a);
    }
    if (!neu.length) return;
    newsZustand.liste = newsZustand.liste.concat(neu).sort((a, b) => b.t - a.t).slice(0, 300);
    if (!offen) return;
    if (!erste) {
      newsZustand.ungelesen += neu.length;
      if (document.hidden) titelZaehler(newsZustand.ungelesen);
      neu.filter((e) => e.gewicht === 3 && (e.werte.some((w) => w.direkt) || e.thema === "notenbank")).forEach(mitteilen);
    }
    newsListe(false, erste ? null : new Set(neu.map((e) => e.id)));
    zeitstrahlBald();
    detailNews();
  }
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { newsZustand.ungelesen = 0; titelZaehler(0); } });
  const TITEL = document.title;
  function titelZaehler(n) { document.title = n ? `(${n}) ${TITEL}` : TITEL; }

  // Demo: erfundene Meldungen im Abstand von 25 bis 70 Sekunden (nur Demo-Bericht oder live.py --demo)
  function demoStart() {
    const rnd = W.zufall(Math.floor(Date.now() / 864e5));
    const aktien = SLUGS.filter((s) => WERTE[s].typ === "aktie").map((s) => WERTE[s]);
    const jetzt = Date.now(), alt = [];
    for (let i = 0; i < 26; i++) {
      const m = W.demoMeldung(i, aktien, jetzt - (i * 13 + rnd() * 9) * 60e3 - 60e3, rnd);
      alt.push(m);
      if (i % 4 === 1) alt.push(W.demoZweitquelle(m, 60 + i, m.t * 1000 + 5 * 60e3));
    }
    // eine wichtige Meldung von vor zwölf Minuten, damit das Eilmeldungsband in der Vorschau zu sehen ist
    const eil = W.demoMeldung(98, aktien, jetzt - 12 * 60e3, rnd, 11);
    alt.push(eil, W.demoZweitquelle(eil, 99, jetzt - 9 * 60e3));
    aufnehmen(alt);
    let nr = 100;
    const naechste = () => {
      const ms = 25e3 + rnd() * 45e3;
      newsZustand.naechster = Date.now() + ms;
      setTimeout(() => {
        const m = W.demoMeldung(nr++, aktien, Date.now(), rnd);
        aufnehmen([m]);
        if (rnd() < 0.35) setTimeout(() => aufnehmen([W.demoZweitquelle(m, nr++, Date.now())]), 4000 + rnd() * 8000);
        naechste();
      }, ms);
    };
    naechste();
  }

  /* ---------------------------------------------------------------- Feed nach Art von Forex Factory
     Ansichten: Heiß (Wichtigkeit, Quellen, Bezug zu deinen Werten, Frische), Neueste, Eilmeldungen, Analysen.
     Jede Geschichte bündelt alle Quellen zum selben Thema; ein Klick klappt Kurzfassung, Quellen und Werte auf. */
  const offeneGeschichten = new Set();
  let buendelCache = null, buendelStand = -1;
  function geschichten() {
    if (buendelStand !== newsZustand.liste.length || !buendelCache) { buendelCache = W.buendeln(newsZustand.liste); buendelStand = newsZustand.liste.length; }
    return buendelCache;
  }
  const KLASSE_FILTER = { aktien: "aktie", rohstoffe: "rohstoff", indizes: "index" };
  function passtFilter(g) {
    const f = zustand.nFilter;
    if (g.gewicht < (zustand.nStufe || 1)) return false;
    if (f === "alle") return true;
    if (f === "watchlist") return g.werte.some((w) => w.direkt);
    if (KLASSE_FILTER[f]) return g.werte.some((w) => w.direkt && WERTE[w.slug] && WERTE[w.slug].typ === KLASSE_FILTER[f]) || (f === "rohstoffe" && g.kopf.thema === "rohstoffe");
    return g.tags.includes(f);
  }
  function sichtbareGeschichten() {
    const jetzt = Date.now() / 1000;
    let l = geschichten().filter(passtFilter);
    switch (zustand.nAnsicht) {
      case "heiss": return l.filter((g) => jetzt - g.t < 36 * 3600).map((g) => Object.assign(g, { punkte: W.heiss(g, jetzt) })).sort((a, b) => b.punkte - a.punkte).slice(0, 40);
      case "eil": return l.filter((g) => g.gewicht === 3).sort((a, b) => b.t - a.t);
      case "analyse": return l.filter((g) => g.alle.some((x) => x.art === "analyse" || x.art === "offiziell")).sort((a, b) => b.t - a.t);
      default: return l.sort((a, b) => b.t - a.t);
    }
  }
  function fensterNews() {
    const el = $('[data-inhalt="news"]', huelle);
    const ansichten = [["heiss", "Heiß"], ["neu", "Neueste"], ["anstehend", "Anstehend"], ["eil", "Eilmeldungen"], ["analyse", "Analysen"]];
    const filter = [["alle", "Alle"], ["watchlist", "Meine Werte"], ["USD", "USD"], ["EUR", "EUR"], ["GBP", "GBP"], ["JPY", "JPY"], ["CHF", "CHF"],
      ["aktien", "Aktien"], ["rohstoffe", "Rohstoffe"], ["indizes", "Indizes"]];
    el.innerHTML = `
      <div class="wm-n-leiste">
        <div class="wm-reiter" role="tablist" aria-label="Ansicht">${ansichten.map(([k, t]) => `<button type="button" role="tab" data-nansicht="${k}" aria-selected="${zustand.nAnsicht === k}">${t}</button>`).join("")}</div>
        <div class="wm-stufen" role="group" aria-label="Wichtigkeit">${[1, 2, 3].map((k) => `<button type="button" data-nstufe="${k}" aria-pressed="${(zustand.nStufe || 1) === k}" title="${["", "alle Meldungen", "ab mittlerer Wichtigkeit", "nur hohe Wichtigkeit"][k]}">${mappeHTML(k)}</button>`).join("")}</div>
      </div>
      <div class="wm-n-filter" role="group" aria-label="Filter">${filter.map(([k, t]) => `<button type="button" data-nfilter="${k}" aria-pressed="${zustand.nFilter === k}">${t}</button>`).join("")}</div>
      <p class="wm-lage-satz" data-lage></p>
      <button type="button" class="wm-neu-knopf" data-mehr-neu hidden></button>
      <div class="wm-n-liste" data-nliste></div>`;
    newsListe(true);
  }
  // Wichtigkeit als kleine Mappe in Rot (hoch), Orange (mittel) oder Gelb (gering)
  const mappeHTML = (g) => `<svg class="wm-mappe g${g}" viewBox="0 0 14 12" aria-hidden="true"><path d="M1 2.5h4l1.3 1.5H13v6.5H1z"/></svg>`;
  const STUFE = ["", "gering", "mittel", "hoch"];
  const ART = { analyse: "Analyse", offiziell: "Offiziell", nachricht: "" };
  function geschichteHTML(g, jetzt, neuIds) {
    const k = g.kopf, auf = offeneGeschichten.has(g.id);
    const neu = g.alle.some((x) => neuIds && neuIds.has(x.id)) || g.alle.some((x) => x.ankunft && jetzt - x.ankunft < 90e3);
    const ankunft = Math.max(0, ...g.alle.map((x) => x.ankunft || 0));
    const istEil = W.eil(g, jetzt / 1000);
    const weitere = g.quellen.length - 1;
    const artText = ART[g.alle.some((x) => x.art === "offiziell") ? "offiziell" : g.alle.some((x) => x.art === "analyse") ? "analyse" : "nachricht"];
    const tonZ = k.tendenz > 0 ? '<span class="wm-ton plus" title="Tendenz eher positiv (aus Stichwörtern)">▲</span>' : k.tendenz < 0 ? '<span class="wm-ton minus" title="Tendenz eher negativ (aus Stichwörtern)">▼</span>' : "";
    return `<article class="wm-s g${g.gewicht}${neu ? " neu" : ""}${istEil ? " eil" : ""}${auf ? " auf" : ""}" data-sid="${esc(g.id)}" data-ankunft="${ankunft}" tabindex="0" aria-expanded="${auf}">
      <span class="wm-s-mappe" title="Wichtigkeit ${STUFE[g.gewicht]} (geschätzt aus Stichwörtern, Quelle und Bezug zu deinen Werten)">${mappeHTML(g.gewicht)}</span>
      <div class="wm-s-kopf">
        <h4>${istEil ? '<span class="wm-eil">Eil</span>' : ""}${esc(k.titel)}</h4>
        <div class="wm-s-meta"><span class="wm-s-quelle">${esc(k.quelle)}</span>${weitere ? `<span class="wm-s-mehrq" title="${esc(g.quellen.join(", "))}">+${weitere} ${weitere === 1 ? "Quelle" : "Quellen"}</span>` : ""}
          <span class="wm-alter" data-seit="${g.t * 1000}">${W.alter(jetzt - g.t * 1000)}</span>${artText ? `<span class="wm-s-art">${artText}</span>` : ""}
          ${g.tags.map((c) => `<span class="wm-tag">${c}</span>`).join("")}${tonZ}${neu ? '<span class="wm-neu">neu</span>' : ""}</div>
      </div>
      <time class="wm-s-zeit" datetime="${new Date(g.t * 1000).toISOString()}">${fUhr.format(g.t * 1000)}</time>
      ${auf ? `<div class="wm-s-mehr">
        ${k.kurz ? `<p>${esc(k.kurz)}</p>` : '<p class="wm-klein">Die Quelle liefert keinen Anrisstext.</p>'}
        ${g.werte.length ? `<div class="wm-n-werte">${g.werte.slice(0, 6).map((w) => chipHTML(w.slug, w.direkt)).join("")}</div>` : ""}
        <ul class="wm-s-quellen">${g.alle.slice().sort((a, b) => a.t - b.t).map((x) => `<li><time>${fUhr.format(x.t * 1000)}</time><b>${esc(x.quelle)}</b>${W.sichereUrl(x.url)
          ? `<a href="${esc(W.sichereUrl(x.url))}" target="_blank" rel="noopener noreferrer">${esc(x.titel)}</a>` : `<span>${esc(x.titel)}</span>`}</li>`).join("")}</ul>
        <p class="wm-klein">${esc(W.THEMA_NAME[k.thema] || "")} · zuerst gemeldet ${fUhr.format(g.erst * 1000)} Uhr${g.alle.length > 1 ? `, ${g.alle.length} Meldungen` : ""}</p>
      </div>` : ""}
    </article>`;
  }
  const gewichtHTML = (g, titel) => `<span class="wm-gewicht" title="${esc(titel)}: ${STUFE[g]}" role="img" aria-label="${esc(titel)} ${STUFE[g]}">${mappeHTML(g)}</span>`;
  function chipHTML(slug, direkt) {
    const b = WERTE[slug], i = kursInfo(slug), v = i.heute != null ? i.heute : null;
    return `<button type="button" class="wm-chip${direkt ? "" : " indirekt"}" data-w="${slug}" data-chip="${slug}" title="${esc(b.name)}${direkt ? "" : " (indirekt betroffen)"}"><b>${esc(kurzSym(b))}</b><span class="${ton(v)}">${v != null ? pct(v, 1) : ""}</span></button>`;
  }
  const tagesName = (ms) => { const h = tagBerlin(Date.now()), t = tagBerlin(ms), g = tagBerlin(Date.now() - 864e5); return t === h ? "Heute" : t === g ? "Gestern" : fTag.format(ms); };
  function newsListe(neuAufbau, neuIds) {
    const el = huelle && $("[data-nliste]", huelle);
    if (!el) return;
    $$("[data-nansicht]", huelle).forEach((b) => b.setAttribute("aria-selected", String(b.dataset.nansicht === zustand.nAnsicht)));
    $$("[data-nfilter]", huelle).forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.nfilter === zustand.nFilter)));
    $$("[data-nstufe]", huelle).forEach((b) => b.setAttribute("aria-pressed", String(+b.dataset.nstufe === (zustand.nStufe || 1))));
    if (newsZustand.hinweis === "einrichten" && !newsZustand.liste.length) {
      el.innerHTML = `<div class="wm-einrichten">
        <p><b>Nachrichten live einschalten.</b> Zwei Wege, beide kostenlos:</p>
        <ol><li><code>python live.py</code> mit der Umgebungsvariable <code>FINNHUB_API_KEY</code>: Marktnachrichten, Meldungen zu deinen US-Aktien, Pressemitteilungen von Fed und EZB und mit <code>SEC_KONTAKT</code> die Pflichtmitteilungen (8-K).</li>
        <li>Oder hier einen Finnhub-Schlüssel eintragen. Er bleibt nur in diesem Browser.</li></ol>
        <div class="wm-fh"><input type="password" id="wm-fh" placeholder="Finnhub-Schlüssel" autocomplete="off" aria-label="Finnhub-Schlüssel"><button type="button" class="wm-knopf wm-text" data-fh-speichern>Speichern</button></div>
        <p class="wm-klein">Schlüssel gibt es unter finnhub.io (kostenlos, 60 Abfragen je Minute).</p></div>`;
      lageSatz();
      return;
    }
    const box = el.parentElement, jetzt = Date.now();
    // Lesestelle halten: oberste sichtbare Geschichte merken
    let anker = null, ankerOben = 0;
    if (!neuAufbau && box.scrollTop > 30) {
      const kasten = box.getBoundingClientRect();
      anker = $$(".wm-s", el).find((a) => a.getBoundingClientRect().bottom > kasten.top + 60);
      if (anker) { ankerOben = anker.getBoundingClientRect().top; anker = anker.dataset.sid; }
    }
    if (zustand.nAnsicht === "anstehend") {
      el.innerHTML = anstehendHTML(jetzt);
      $("[data-mehr-neu]", huelle).hidden = true;
      lageSatz(); eilband();
      return;
    }
    const liste = sichtbareGeschichten();
    let html = "", tag = null;
    liste.slice(0, 120).forEach((g, i) => {
      if (zustand.nAnsicht === "heiss") { if (i === 0) html += '<p class="wm-s-gruppe">Meistbeachtet, letzte 36 Stunden</p>'; }
      else { const t = tagesName(g.t * 1000); if (t !== tag) { tag = t; html += `<p class="wm-s-gruppe">${esc(t)}</p>`; } }
      html += geschichteHTML(g, jetzt, neuIds);
    });
    el.innerHTML = html || `<p class="wm-leer">${newsZustand.liste.length ? "Keine Meldungen für diese Auswahl." : newsZustand.fehler ? esc(newsZustand.fehler) : "Nachrichten werden geladen …"}</p>`;
    const knopf = $("[data-mehr-neu]", huelle);
    if (anker) {
      const a = $(`.wm-s[data-sid="${CSS.escape(anker)}"]`, el);
      if (a) box.scrollTop += a.getBoundingClientRect().top - ankerOben;
      const n = neuIds ? liste.filter((g) => g.alle.some((x) => neuIds.has(x.id))).length : 0;
      if (n) { const z = (+knopf.dataset.n || 0) + n; knopf.dataset.n = z; knopf.hidden = false; knopf.textContent = `↑ ${z} neue ${z === 1 ? "Meldung" : "Meldungen"}`; }
    } else if (neuAufbau) { knopf.hidden = true; knopf.dataset.n = 0; }
    lageSatz();
    eilband();
  }
  /* Anstehende Nachrichten: angekündigte Termine der nächsten sieben Tage aus dem Kalender, mit Countdown */
  const ART_TERMIN = { konjunktur: "Daten", notenbank: "Notenbank", zahlen: "Quartalszahlen" };
  function anstehend(jetzt, tage = 7, filter = true) {
    const bis = jetzt + tage * 864e5;
    return (kalender ? kalender.termine : []).map((e) => ({ e, ms: e.t != null ? e.t * 6e4 : Date.parse(e.tag + "T10:00:00Z") }))
      .filter((x) => x.ms > jetzt - 60e3 && x.ms <= bis && (!filter || terminPasst(x.e))).sort((a, b) => a.ms - b.ms);
  }
  function terminPasst(e) {
    const f = zustand.nFilter;
    if (e.wichtig < (zustand.nStufe || 1)) return false;
    if (f === "alle") return true;
    if (f === "watchlist") return !!(e.slug && WERTE[e.slug]) || SLUGS.some((s) => WERTE[s].typ === "forex" && String(WERTE[s].symbol).includes(e.w));
    if (f === "aktien") return e.art === "zahlen";
    if (f === "rohstoffe") return /eia|cftc/.test(e.gruppe || "");
    if (f === "indizes") return e.art === "notenbank" || e.wichtig === 3;
    return e.w === f;
  }
  function anstehendZeile(x, jetzt) {
    const e = x.e, w = (e.werte || [])[0];
    const werte = w ? [w.prog != null ? `Prognose ${wertText(w, "prog")}` : "", w.vor != null ? `${w.vor_text || "Vorwert"} ${wertText(w, "vor")}` : ""].filter(Boolean).join(" · ") : "";
    return `<article class="wm-s wm-s-termin g${e.wichtig}${x.ms - jetzt < 15 * 60e3 ? " bald" : ""}" data-zk="${esc(e.id)}" tabindex="0">
      <span class="wm-s-mappe" title="Wichtigkeit ${STUFE[e.wichtig]}">${mappeHTML(e.wichtig)}</span>
      <div class="wm-s-kopf"><h4>${esc(e.titel)}</h4>
        <div class="wm-s-meta"><span class="wm-tag">${esc(e.w || e.land)}</span><span>${esc(e.land)}</span>${werte ? `<span>${esc(werte)}</span>` : ""}
          <span class="wm-s-art">${esc(ART_TERMIN[e.art] || "Termin")}</span>${e.planmaessig ? '<span title="Feiertage können den Termin verschieben">planmäßig</span>' : ""}${e.t == null ? "<span>Uhrzeit offen</span>" : ""}</div></div>
      <div class="wm-s-zeit wm-s-countdown"><time>${esc(e.t == null ? "–" : (e.zeit_ca ? "ca. " : "") + fUhr.format(x.ms))}</time><b data-bis="${x.ms}" data-vorbei="läuft">${W.dauer(x.ms - jetzt)}</b></div>
    </article>`;
  }
  function anstehendHTML(jetzt) {
    if (!kalender || kalender.fehlt) return '<p class="wm-leer">Kein Kalender geladen. Er entsteht mit dem Wochenbericht (FRED_API_KEY für US-Statistiken).</p>';
    const l = anstehend(jetzt);
    if (!l.length) return '<p class="wm-leer">In den nächsten sieben Tagen ist für diese Auswahl nichts angekündigt.</p>';
    let html = "", tag = null;
    l.slice(0, 80).forEach((x) => { const t = tagesName(x.ms); if (t !== tag) { tag = t; html += `<p class="wm-s-gruppe">${esc(t)}</p>`; } html += anstehendZeile(x, jetzt); });
    return html + '<p class="wm-fuss">Angekündigte Termine aus dem Kalender. Zu jedem kommen meist kurz danach die ersten Meldungen.</p>';
  }
  function geschichteKlappen(id) {
    if (offeneGeschichten.has(id)) offeneGeschichten.delete(id); else offeneGeschichten.add(id);
    const el = $(`.wm-s[data-sid="${CSS.escape(id)}"]`, huelle);
    if (!el) return;
    const g = geschichten().find((x) => x.id === id);
    if (!g) return;
    el.outerHTML = geschichteHTML(g, Date.now(), null);
    const neu = $(`.wm-s[data-sid="${CSS.escape(id)}"]`, huelle);
    if (neu) neu.focus({ preventScroll: true });
  }
  // Eilmeldung im Band oder von außen: Feed auf „Neueste“, Geschichte aufklappen und zeigen
  function geschichteZeigen(id) {
    const g = geschichten().find((x) => x.id === id || x.alle.some((y) => y.id === id));
    if (!g) return;
    if (!sichtbareGeschichten().includes(g)) { zustand.nAnsicht = "neu"; zustand.nFilter = "alle"; zustand.nStufe = 1; }
    offeneGeschichten.add(g.id);
    newsListe(true);
    fokus("news");
    const el = $(`.wm-s[data-sid="${CSS.escape(g.id)}"]`, huelle);
    if (el) { el.scrollIntoView({ block: "center" }); el.focus({ preventScroll: true }); }
  }
  /* Eilmeldungsband unter dem Kopf: wichtige Meldungen der letzten 60 Minuten, wechselt alle acht Sekunden */
  let eilIndex = 0, eilWechsel = 0;
  function eilband() {
    const band = huelle && $(".wm-eilband", huelle);
    if (!band) return;
    const jetzt = Date.now() / 1000;
    const l = geschichten().filter((g) => W.eil(g, jetzt, 60)).sort((a, b) => b.t - a.t).slice(0, 4);
    band.hidden = !l.length;
    if (!l.length) return;
    if (Date.now() - eilWechsel > 8000) { eilIndex = (eilIndex + 1) % l.length; eilWechsel = Date.now(); }
    const g = l[eilIndex % l.length];
    const inhalt = `<span class="wm-eilband-marke">Eilmeldung</span><time>${fUhr.format(g.t * 1000)}</time>
      <button type="button" data-eilband="${esc(g.id)}">${esc(g.kopf.titel)}</button>
      <span class="wm-eilband-quelle">${esc(g.kopf.quelle)}${g.quellen.length > 1 ? ` +${g.quellen.length - 1}` : ""}</span>${l.length > 1 ? `<span class="wm-eilband-zahl">${(eilIndex % l.length) + 1}/${l.length}</span>` : ""}`;
    if (band.dataset.id !== g.id || band.dataset.n !== String(l.length)) { band.innerHTML = inhalt; band.dataset.id = g.id; band.dataset.n = String(l.length); }
  }
  function lageSatz() {
    const el = huelle && $("[data-lage]", huelle);
    if (!el) return;
    const l = W.lage(newsZustand.liste, Date.now() - 3600e3, NAMEN);
    const d = W.lage(newsZustand.liste, Date.now() - 6 * 3600e3, NAMEN);
    const x = l.n >= 3 ? l : d;
    const fenster = x === l ? "Letzte Stunde" : "Letzte 6 Stunden";
    const demo = newsZustand.demo || (newsZustand.aktiv && newsZustand.aktiv.includes("demo"));
    el.innerHTML = x.n ? `<b>${fenster}:</b> ${x.n} Meldungen, ${x.wichtig} wichtige${x.top.length ? " · meist genannt " + x.top.map((t) => `<button type="button" class="wm-link" data-w="${t.slug}">${esc(kurzName(WERTE[t.slug]))}</button> ${t.n}`).join(", ") : ""} · Tendenz ${x.tonText}${demo ? ' · <b class="wm-demo">Demo: erfundene Beispielmeldungen</b>' : ""}`
      : newsZustand.aktiv && newsZustand.aktiv.length ? "Noch keine Meldungen in den letzten Stunden." : "";
  }
  /* ================================================================ 7 Zeitstrahl
     Eine gemeinsame Zeitachse: links die eingegangenen Meldungen (Geschichten), rechts die erwarteten Termine aus dem
     Kalender, jeweils in drei Bahnen nach Wichtigkeit. Darüber die Zahl der Meldungen je Abschnitt, dazu ein Strich
     für jetzt. Ein Klick auf eine Meldung öffnet sie im Feed, auf einen Termin im Kalender. */
  const SPANNEN = { 12: [4, 8], 24: [8, 16], 72: [24, 48] }; // Stunden zurück und voraus
  function fensterZeit() {
    const el = huelle && $('[data-inhalt="zeit"]', huelle);
    if (!el) return;
    el.innerHTML = `<div class="wm-z">
      <div class="wm-z-info" data-z-info></div>
      <div class="wm-z-flaeche" data-z-flaeche></div>
      <div class="wm-z-liste wm-z-eingang"><p class="wm-z-label">Zuletzt eingegangen</p><div data-z-eingang></div></div>
      <div class="wm-z-liste wm-z-anstehend"><p class="wm-z-label">Als Nächstes erwartet</p><div data-z-anstehend></div></div>
      <div class="wm-z-tipp" hidden></div>
    </div>`;
    const fl = $("[data-z-flaeche]", el), tipp = $(".wm-z-tipp", el);
    fl.addEventListener("pointerover", (e) => {
      const m = e.target.closest("[data-tipp]");
      if (!m) return;
      tipp.innerHTML = m.dataset.tipp;
      tipp.hidden = false;
      const r = m.getBoundingClientRect(), k = el.getBoundingClientRect();
      tipp.style.left = Math.max(0, Math.min(k.width - 260, r.left - k.left - 120)) + "px";
      const oben = r.top - k.top > 80; // sonst unter den Punkt, damit nichts abgeschnitten wird
      tipp.classList.toggle("unten", !oben);
      tipp.style.top = (oben ? r.top - k.top - 8 : r.bottom - k.top + 8) + "px";
    });
    fl.addEventListener("pointerout", (e) => { if (!e.relatedTarget || !e.relatedTarget.closest || !e.relatedTarget.closest("[data-tipp]")) tipp.hidden = true; });
    fl.addEventListener("focusin", (e) => { const m = e.target.closest("[data-tipp]"); if (m) m.dispatchEvent(new PointerEvent("pointerover", { bubbles: true })); });
    zeitstrahl();
  }
  let zeitGeplant = null;
  function zeitstrahlBald() { clearTimeout(zeitGeplant); zeitGeplant = setTimeout(zeitstrahl, 400); }
  function zeitstrahl() {
    const fl = huelle && $("[data-z-flaeche]", huelle), info = huelle && $("[data-z-info]", huelle);
    if (!fl || !offen) return;
    const jetzt = Date.now(), [zurueck, voraus] = SPANNEN[zustand.zSpanne] || SPANNEN[24];
    const von = jetzt - zurueck * 3600e3, bis = jetzt + voraus * 3600e3, breite = bis - von;
    const x = (ms) => ((ms - von) / breite) * 100;
    const pos = (ms) => x(ms).toFixed(3) + "%";
    // Meldungen (gebündelt) im sichtbaren Zeitraum
    const gesch = geschichten().filter((g) => g.t * 1000 >= von && g.t * 1000 <= jetzt);
    // Termine: mit Uhrzeit an ihrer Minute, ganztägige (z. B. Quartalszahlen ohne Uhrzeit) um 12 Uhr
    const termine = (kalender ? kalender.termine : []).map((e) => ({ e, ms: e.t != null ? e.t * 6e4 : Date.parse(e.tag + "T10:00:00Z"), ungefaehr: e.t == null || e.zeit_ca }))
      .filter((x) => x.ms >= von && x.ms <= bis);
    // Dichte: Meldungen je Abschnitt (24 Abschnitte über den vergangenen Teil)
    const n = 24, schritt = (jetzt - von) / n, dichte = new Array(n).fill(0), hoch = new Array(n).fill(0);
    newsZustand.liste.forEach((m) => { const ms = m.t * 1000; if (ms < von || ms > jetzt) return; const i = Math.min(n - 1, Math.floor((ms - von) / schritt)); dichte[i]++; if (m.gewicht === 3) hoch[i]++; });
    const maxD = Math.max(1, ...dichte);
    const STUFEN = [[3, "Hoch"], [2, "Mittel"], [1, "Gering"]];
    const tippN = (g) => esc(`<b>${esc(g.kopf.titel)}</b><span>${fUhr.format(g.t * 1000)} Uhr · ${esc(g.kopf.quelle)}${g.quellen.length > 1 ? ` +${g.quellen.length - 1}` : ""} · ${W.alter(jetzt - g.t * 1000)}</span>`);
    const tippT = (t) => esc(`<b>${esc(t.e.land)} · ${esc(t.e.titel)}</b><span>${t.ungefaehr ? "Uhrzeit offen, " : ""}${esc(terminZeit(t.e, true))}${t.ms > jetzt ? ` · in ${W.dauer(t.ms - jetzt)}` : " · vorbei"}</span>${(t.e.werte || [])[0] ? `<span>${esc(t.e.werte[0].kurz)}: Ist ${wertText(t.e.werte[0], "ist")}, Prognose ${wertText(t.e.werte[0], "prog")}, Vorwert ${wertText(t.e.werte[0], "vor")}</span>` : ""}`);
    // Beschriftungen nur für wichtige künftige Termine, und nur wenn Platz ist
    let letzteMarke = -100;
    const bahnen = STUFEN.map(([g, name]) => {
      const punkte = gesch.filter((x) => x.gewicht === g).map((x) => {
        const gr = Math.min(3, x.quellen.length - 1);
        return `<button type="button" class="wm-z-p meldung g${g} q${gr}" style="left:${pos(x.t * 1000)}" data-zs="${esc(x.id)}" data-tipp="${tippN(x)}" aria-label="Meldung ${fUhr.format(x.t * 1000)}: ${esc(x.kopf.titel)}"></button>`;
      }).join("");
      const inBahn = termine.filter((t) => t.e.wichtig === g).sort((a, b) => a.ms - b.ms);
      const ts = inBahn.map((t, i) => {
        const vorbei = t.ms < jetzt, xx = x(t.ms);
        const platz = i + 1 < inBahn.length ? x(inBahn[i + 1].ms) - xx : 100; // Abstand zur nächsten Raute derselben Bahn
        let marke = "";
        if (!vorbei && g >= 2 && xx - letzteMarke > 9 && (platz > 9 || xx > 72)) { marke = `<span class="wm-z-marke${xx > 72 ? " links" : ""}" style="left:${pos(t.ms)}">${esc(kurzTitel(t.e))}</span>`; letzteMarke = xx; }
        return `<button type="button" class="wm-z-p termin g${g}${vorbei ? " vorbei" : ""}${t.ungefaehr ? " ungefaehr" : ""}" style="left:${pos(t.ms)}" data-zk="${esc(t.e.id)}" data-tipp="${tippT(t)}" aria-label="Termin ${esc(terminZeit(t.e, true))}: ${esc(t.e.titel)}"></button>${marke}`;
      }).join("");
      return `<div class="wm-z-bahn"><span class="wm-z-name">${mappeHTML(g)}${name}</span><div class="wm-z-spur">${punkte}${ts}</div></div>`;
    }).join("");
    // Achse: volle Stunden (bzw. alle 6 Stunden bei drei Tagen), Tageswechsel hervorgehoben
    const takt = zustand.zSpanne >= 72 ? 6 : zustand.zSpanne >= 24 ? 2 : 1;
    const ticks = [];
    const erste = Math.ceil(von / 3600e3) * 3600e3;
    for (let ms = erste; ms <= bis; ms += 3600e3) {
      const h = Math.floor(W.ortszeit(BERLIN, ms).min / 60);
      if (h === 0) ticks.push(`<em class="tag" style="left:${pos(ms)}">${esc(fTagKurz.format(ms))}</em>`);
      else if (h % takt === 0) ticks.push(`<em style="left:${pos(ms)}">${h}</em>`);
    }
    fl.innerHTML = `
      <div class="wm-z-bahn wm-z-dichte-bahn"><span class="wm-z-name">Meldungen</span><div class="wm-z-spur wm-z-dichte">${dichte.map((d, i) =>
        `<i style="left:${pos(von + i * schritt)};width:calc(${((schritt / breite) * 100).toFixed(3)}% - 1px);height:${Math.round((d / maxD) * 100)}%"${hoch[i] ? ' class="hoch"' : ""} title="${d} Meldungen"></i>`).join("")}
        <span class="wm-z-vorschau" style="left:${pos(jetzt)}">erwartet →</span></div></div>
      ${bahnen}
      <div class="wm-z-bahn"><span></span><div class="wm-z-achse">${ticks.join("")}</div></div>
      <div class="wm-z-jetzt" style="--x:${(x(jetzt) / 100).toFixed(4)}"><span>${fUhr.format(jetzt)}</span></div>`;
    // Zusammenfassung: vergangen und erwartet
    const zaehl = (l, f) => [3, 2, 1].map((g) => l.filter((y) => f(y) === g).length);
    const [h6, m6] = zaehl(geschichten().filter((g) => g.t * 1000 >= jetzt - 6 * 3600e3), (g) => g.gewicht);
    const meld6 = newsZustand.liste.filter((m) => m.t * 1000 >= jetzt - 6 * 3600e3).length;
    const kuenftig = (kalender ? kalender.termine : []).filter((e) => e.t != null && e.t * 6e4 > jetzt && e.t * 6e4 <= jetzt + 24 * 3600e3);
    const [ht, mt] = zaehl(kuenftig, (e) => e.wichtig);
    const naechster = W.naechster(kalender ? kalender.termine : [], jetzt / 6e4, 3) || W.naechster(kalender ? kalender.termine : [], jetzt / 6e4, 2);
    const spitze = dichte.indexOf(Math.max(...dichte));
    zeitListen(jetzt);
    info.innerHTML = `
      <div><span class="wm-z-label">Eingegangen, letzte 6 Std.</span><b>${meld6}</b> Meldungen · <span class="wm-z-g g3">${h6} hoch</span> · <span class="wm-z-g g2">${m6} mittel</span>${Math.max(...dichte) > 0 ? ` · am dichtesten ${fUhr.format(von + spitze * schritt)}–${fUhr.format(von + (spitze + 1) * schritt)}` : ""}</div>
      <div><span class="wm-z-label">Erwartet, nächste 24 Std.</span><b>${kuenftig.length}</b> ${kuenftig.length === 1 ? "Termin" : "Termine"} · <span class="wm-z-g g3">${ht} hoch</span> · <span class="wm-z-g g2">${mt} mittel</span></div>
      <div>${naechster ? `<span class="wm-z-label">Nächster wichtiger Termin</span><button type="button" class="wm-link" data-zk="${esc(naechster.id)}">${esc(naechster.land)} ${esc(naechster.titel)}</button> · ${esc(terminZeit(naechster, true))} · <b class="wm-z-uhr" data-bis="${naechster.t * 6e4}">${W.dauer(naechster.t * 6e4 - jetzt)}</b>` : '<span class="wm-z-label">Keine wichtigen Termine angekündigt</span>'}</div>`;
  }
  const mitLand = (e) => (String(e.titel).startsWith(e.land) ? e.titel : e.land + " " + e.titel);
  function zeitListen(jetzt) {
    const an = huelle && $("[data-z-anstehend]", huelle), ein = huelle && $("[data-z-eingang]", huelle);
    if (!an || !ein) return;
    const l = anstehend(jetzt, 7, false).slice(0, 12);
    an.innerHTML = l.length ? l.map((x) => `<button type="button" class="wm-z-zeile g${x.e.wichtig}" data-zk="${esc(x.e.id)}">${mappeHTML(x.e.wichtig)}
        <span class="wm-z-zeit">${esc(x.e.t == null ? fTagKurz.format(x.ms) : (tagBerlin(x.ms) === tagBerlin(jetzt) ? "" : fTagKurz.format(x.ms).replace(/,.*$/, "") + " ") + fUhr.format(x.ms))}</span>
        <span class="wm-z-titel">${esc(mitLand(x.e))}</span><b data-bis="${x.ms}" data-vorbei="läuft">${W.dauer(x.ms - jetzt)}</b></button>`).join("")
      : '<p class="wm-klein">Nichts angekündigt.</p>';
    const g = geschichten().slice().sort((a, b) => b.t - a.t).slice(0, 12);
    ein.innerHTML = g.length ? g.map((x) => `<button type="button" class="wm-z-zeile g${x.gewicht}" data-zs="${esc(x.id)}">${mappeHTML(x.gewicht)}
        <span class="wm-z-zeit">${fUhr.format(x.t * 1000)}</span><span class="wm-z-titel">${esc(x.kopf.titel)}</span><b class="wm-alter" data-seit="${x.t * 1000}">${W.alter(jetzt - x.t * 1000)}</b></button>`).join("")
      : '<p class="wm-klein">Noch keine Meldungen.</p>';
  }
  // kurze Beschriftung für den Zeitstrahl: „US-Verbraucherpreise (CPI)“ → „CPI“, sonst die ersten Wörter
  function kurzTitel(e) {
    const vorne = e.land === "US" ? "" : e.land + " ";
    const k = String(e.titel).match(/\(([^)]{2,12})\)/);
    if (k) return vorne + k[1];
    const kuerzel = ((e.werte || [])[0] || {}).kurz || "";
    const ak = kuerzel.match(/\b[A-ZÄÖÜ]{2,5}\b/);
    if (ak) return vorne + ak[0];
    if (e.art === "zahlen") return "Zahlen " + String(e.titel).replace(/^Quartalszahlen /, "").split(" ")[0];
    const wort = String(e.titel).replace(/^US-/, "").split(/[\s-]/)[0];
    return vorne + (wort.length > 14 ? wort.slice(0, 13) + "…" : wort);
  }
  // Termin aus dem Zeitstrahl im Kalender öffnen
  function terminZeigen(id) {
    if (!kalender || !kalender.termine.some((e) => e.id === id)) return;
    zustand.kZeit = "alle"; zustand.kWichtig = 1;
    offenTermine.add(id);
    kalenderTabelle();
    fokus("kalender");
    const z = $(`[data-k="${CSS.escape(id)}"]`, huelle);
    if (z) { z.scrollIntoView({ block: "center" }); z.focus({ preventScroll: true }); }
  }
  function finnhubSpeichern() {
    const v = ($("#wm-fh", huelle).value || "").trim();
    if (!v) return;
    schreib("wochenbericht.finnhub", v);
    location.reload(); // Kurse und Nachrichten starten mit dem neuen Schlüssel
  }
  function hinweiseSchalten() {
    const knopf = $("[data-wm-hinweise]", huelle);
    if (!("Notification" in window)) { knopf.title = "Dieser Browser kann keine Mitteilungen zeigen."; return; }
    if (!zustand.hinweise && Notification.permission !== "granted") {
      Notification.requestPermission().then((p) => { zustand.hinweise = p === "granted"; sichern(); knopf.setAttribute("aria-pressed", String(zustand.hinweise)); });
      return;
    }
    zustand.hinweise = !zustand.hinweise; sichern();
    knopf.setAttribute("aria-pressed", String(zustand.hinweise));
  }
  function mitteilen(e) {
    if (!zustand.hinweise || !document.hidden || !("Notification" in window) || Notification.permission !== "granted") return;
    try { new Notification(e.titel, { body: e.kurz || e.quelle, tag: e.id }); } catch (x) { /* nicht unterstützt */ }
  }
  // Nach außen scrollen neue Meldungen sichtbar machen
  document.addEventListener("scroll", (e) => { if (e.target && e.target.matches && e.target.matches('[data-inhalt="news"]')) lageSatzKnopf(e.target); }, true);
  function lageSatzKnopf(box) { const k = $("[data-mehr-neu]", huelle); if (k && !k.hidden && box.scrollTop < 30) { k.hidden = true; k.dataset.n = 0; } }

  /* ================================================================ 4 Kalender */
  let kalender = null, kalTimer = null;
  const offenTermine = new Set();
  async function kalenderLaden() {
    clearTimeout(kalTimer);
    let j = null;
    const inline = $("#kalender-daten");
    try {
      if (await serverDa()) { const r = await fetch("api/kalender", { cache: "no-store" }); if (r.ok) j = await r.json(); }
    } catch (e) { /* Datei als Rückfall */ }
    if (!j || !j.termine || (!j.termine.length && !j.stand)) {
      try {
        j = inline ? JSON.parse(inline.textContent) : await (await fetch("daten/kalender.json", { cache: "no-cache" })).json();
      } catch (e) { j = null; }
    }
    kalender = j ? W.demoVerschieben(j, Date.now()) : { termine: [], fehlt: true };
    kalenderTabelle();
    detailTermin();
    zeitstrahl();
    if (!offen) return;
    // Mit live.py: um Termine herum alle 15 s (Ist-Werte der BLS), sonst alle 5 Minuten
    const jetztMin = Date.now() / 6e4;
    const nah = kalender.termine.some((e) => e.t != null && Math.abs(e.t - jetztMin) < 30);
    kalTimer = setTimeout(kalenderLaden, server ? (nah ? 15e3 : 300e3) : 600e3);
  }
  function terminZeit(e, mitTag) {
    if (e.t == null) return (mitTag ? fTagKurz.format(Date.parse(e.tag + "T12:00:00Z")) + " " : "") + "ganztägig";
    return (mitTag ? fTagKurz.format(e.t * 6e4) + " " : "") + (e.zeit_ca ? "ca. " : "") + fUhr.format(e.t * 6e4);
  }
  function fensterKalender() {
    const el = $('[data-inhalt="kalender"]', huelle);
    el.innerHTML = `
      <div class="wm-sitz" data-sitzungen aria-label="Handelssitzungen in deutscher Zeit"></div>
      <div class="wm-k-naechst" data-k-naechst></div>
      <div class="wm-n-leiste">
        <div class="wm-tabs wm-tabs-flach" role="group" aria-label="Zeitraum">${[["heute", "Heute"], ["woche", "Woche"], ["naechste", "Nächste Woche"], ["vorbei", "Letzte 7 Tage"], ["alle", "Alle"]].map(([k, t]) =>
          `<button type="button" data-kzeit="${k}" aria-pressed="${zustand.kZeit === k}">${t}</button>`).join("")}</div>
        <div class="wm-tabs wm-tabs-flach" role="group" aria-label="Wichtigkeit">${[[1, "alle"], [2, "ab mittel"], [3, "hoch"]].map(([k, t]) =>
          `<button type="button" data-kwichtig="${k}" aria-pressed="${zustand.kWichtig === k}">${t}</button>`).join("")}</div>
      </div>
      <div data-ktab></div>`;
    kalenderTabelle();
    sitzungsLeiste();
  }
  /* Handelssitzungen wie die Market Hours bei Forex Factory: Sydney, Tokio, London, New York über 24 Stunden
     deutscher Zeit, Überschneidungen hervorgehoben, Strich für jetzt */
  function sitzungsLeiste() {
    const el = huelle && $("[data-sitzungen]", huelle);
    if (!el) return;
    const jetzt = Date.now(), s = W.sitzungen(jetzt), jetztMin = W.minutenHeute("Europe/Berlin", jetzt);
    const proz = (m) => ((m / 1440) * 100).toFixed(3) + "%";
    // Überschneidungen: Minuten, in denen mindestens zwei Sitzungen laufen
    const zaehl = new Uint8Array(1440);
    s.forEach((x) => x.teile.forEach(([a, b]) => { for (let m = Math.floor(a); m < Math.ceil(b) && m < 1440; m++) zaehl[m]++; }));
    const ueber = [];
    for (let m = 0; m < 1440; m++) if (zaehl[m] >= 2) { if (ueber.length && ueber[ueber.length - 1][1] === m) ueber[ueber.length - 1][1] = m + 1; else ueber.push([m, m + 1]); }
    el.innerHTML = `<div class="wm-sitz-kopf"><span>Handelssitzungen</span><span>${ueber.length ? "Überschneidung " + ueber.map(([a, b]) => `${zwei(Math.floor(a / 60))}–${zwei(Math.round(b / 60) % 24)} Uhr`).join(", ") : "heute keine Überschneidung"}</span></div>
      <div class="wm-sitz-raster">
        ${s.map((x) => `<span class="wm-sitz-name${x.offen ? " offen" : ""}">${esc(x.name)}</span><span class="wm-sitz-spur">${x.teile.map(([a, b]) => `<i class="${x.offen && jetztMin >= a && jetztMin < b ? "offen" : ""}" style="left:${proz(a)};width:${proz(b - a)}"></i>`).join("")}</span>`).join("")}
        <span></span><span class="wm-sitz-achse">${ueber.map(([a, b]) => `<b style="left:${proz(a)};width:${proz(b - a)}"></b>`).join("")}${[0, 3, 6, 9, 12, 15, 18, 21].map((h) => `<em style="left:${proz(h * 60)}">${h}</em>`).join("")}</span>
        <span class="wm-sitz-jetzt" style="left:calc(var(--sitz-name) + (100% - var(--sitz-name)) * ${(jetztMin / 1440).toFixed(4)})" title="jetzt ${fUhr.format(jetzt)}"></span>
      </div>`;
  }
  function zeitraum(e) {
    const jetzt = Date.now(), heute = tagBerlin(jetzt);
    const wtag = (new Date(heute + "T12:00:00Z").getUTCDay() + 6) % 7;
    // am Wochenende zeigt „Woche“ die kommende Handelswoche
    const montag = new Date(Date.parse(heute + "T12:00:00Z") + (wtag >= 5 ? 7 - wtag : -wtag) * 864e5).toISOString().slice(0, 10);
    const plus = (iso, n) => new Date(Date.parse(iso + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);
    const tag = e.t != null ? tagBerlin(e.t * 6e4) : e.tag;
    switch (zustand.kZeit) {
      case "heute": return tag === heute;
      case "woche": return tag >= montag && tag < plus(montag, 7);
      case "naechste": return tag >= plus(montag, 7) && tag < plus(montag, 14);
      case "vorbei": return tag >= plus(heute, -7) && tag <= heute && (e.t == null || e.t * 6e4 <= jetzt);
      default: return true;
    }
  }
  function wertText(w, k) {
    const x = w[k];
    if (x == null) return "–";
    const e = w.einheit === "%" ? " %" : "";
    return minus(nf(w.dez || 0).format(x)) + e;
  }
  const kurzLabel = (w) => w.kurz + (w.einheit && w.einheit !== "%" ? ` (${w.einheit})` : "");
  function kalenderTabelle() {
    const el = huelle && $("[data-ktab]", huelle);
    if (!el) return;
    $$("[data-kzeit]", huelle).forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.kzeit === zustand.kZeit)));
    $$("[data-kwichtig]", huelle).forEach((b) => b.setAttribute("aria-pressed", String(+b.dataset.kwichtig === zustand.kWichtig)));
    const st = $("[data-kal-stand]", huelle);
    if (!kalender) { el.innerHTML = '<p class="wm-leer">Kalender wird geladen …</p>'; return; }
    if (st) st.textContent = kalender.demo ? "Demo-Termine" : kalender.live ? "live" + (kalender.live.bls ? " · BLS" : "") : kalender.stand ? "Stand " + datumKurz(kalender.stand.slice(0, 10)) : "";
    const jetzt = Date.now(), jetztMin = jetzt / 6e4;
    const liste = kalender.termine.filter((e) => e.wichtig >= zustand.kWichtig && zeitraum(e));
    // nächster Wechsel (Termin beginnt oder ist 2 Minuten vorbei): dann neu zeichnen
    const kuenftig = kalender.termine.filter((e) => e.t != null && e.t * 6e4 + 120e3 > jetzt).map((e) => e.t * 6e4 + 120e3);
    kalender.naechsterWechsel = kuenftig.length ? Math.min(...kuenftig) : null;
    const n = W.naechster(kalender.termine, jetztMin, 2);
    const nk = $("[data-k-naechst]", huelle);
    if (nk) nk.innerHTML = n ? `<span class="wm-k-label">Nächster wichtiger Termin</span>
      <span class="wm-k-titel">${gewichtHTML(n.wichtig, "Wichtigkeit")} <b>${esc(n.land)}</b> ${esc(n.titel)} · ${esc(terminZeit(n, true))}</span>
      <span class="wm-k-uhr" data-bis="${n.t * 6e4}">${W.dauer(n.t * 6e4 - jetzt)}</span>`
      : kalender.fehlt ? '<span class="wm-k-label">Kein Kalender vorhanden. Er entsteht mit dem nächsten Wochenbericht (FRED_API_KEY für US-Statistiken).</span>' : '<span class="wm-k-label">Keine anstehenden wichtigen Termine.</span>';
    if (!liste.length) { el.innerHTML = `<p class="wm-leer">${kalender.fehlt ? "" : "Keine Termine in diesem Zeitraum."}</p>${kalenderFuss()}`; return; }
    let html = "", tag = null;
    for (const e of liste) {
      const t = e.t != null ? tagBerlin(e.t * 6e4) : e.tag;
      if (t !== tag) { tag = t; html += `<tr class="wm-tag"><th colspan="7" scope="rowgroup">${esc(fTag.format(Date.parse(t + "T12:00:00Z")))}${t === tagBerlin(jetzt) ? " · heute" : ""}</th></tr>`; }
      const vorbei = e.t != null ? e.t * 6e4 + 120e3 < jetzt : e.tag < tagBerlin(jetzt);
      const laeuft = e.t != null && e.t <= jetztMin && !vorbei;
      const w = e.werte || [];
      const zelle = (x, k) => {
        if (!x) return "<td></td>";
        if (k !== "ist") return `<td class="r">${wertText(x, k)}</td>`;
        const u = W.ueberraschung(x);
        return `<td class="r wm-ist ${u ? (u.ton > 0 ? "plus" : u.ton < 0 ? "minus" : "") : ""}"${x.ist_quelle ? ` title="Quelle: ${esc(x.ist_quelle)}"` : ""}>${wertText(x, "ist")}</td>`;
      };
      const auf = offenTermine.has(e.id);
      html += `<tr class="wm-k${vorbei ? " vorbei" : ""}${laeuft ? " jetzt" : ""}" data-k="${esc(e.id)}" tabindex="0" aria-expanded="${auf}">
        <td class="wm-k-zeit">${esc(e.t == null ? "–" : (e.zeit_ca ? "ca. " : "") + fUhr.format(e.t * 6e4))}<small>${esc(e.land)} ${esc(e.w && e.w !== e.land ? e.w : "")}</small></td>
        <td>${gewichtHTML(e.wichtig, "Wichtigkeit")}</td>
        <td class="wm-k-titel"><b>${esc(e.titel)}</b>${w[0] ? `<small>${esc(kurzLabel(w[0]))}</small>` : ""}${e.t != null && !vorbei ? `<small class="wm-k-bis2 wm-bis">in <span data-bis="${e.t * 6e4}" data-vorbei="">${W.dauer(e.t * 6e4 - jetzt)}</span></small>` : ""}</td>
        ${zelle(w[0], "ist")}${zelle(w[0], "prog")}${zelle(w[0], "vor")}
        <td class="r wm-bis wm-spalte-in">${e.t != null && !vorbei ? `<span data-bis="${e.t * 6e4}" data-vorbei="">${W.dauer(e.t * 6e4 - jetzt)}</span>` : ""}</td></tr>`;
      w.slice(1).forEach((x) => (html += `<tr class="wm-k-sub${vorbei ? " vorbei" : ""}"><td colspan="2"></td><td><small>${esc(kurzLabel(x))}</small></td>${zelle(x, "ist")}${zelle(x, "prog")}${zelle(x, "vor")}<td class="wm-spalte-in"></td></tr>`));
      if (auf) html += `<tr class="wm-k-mehr"><td colspan="7" data-mehr="${esc(e.id)}">${terminDetail(e)}</td></tr>`;
    }
    el.innerHTML = `<div class="wm-scroll"><table class="wm-tab wm-kal" aria-label="Wirtschaftskalender"><thead><tr><th scope="col">Zeit</th><th scope="col"><span class="wm-vh">Wichtigkeit</span></th>
      <th scope="col">Termin</th><th scope="col" class="r">Ist</th><th scope="col" class="r">Prog.</th><th scope="col" class="r">Vorw.</th><th scope="col" class="r wm-spalte-in">in</th></tr></thead><tbody>${html}</tbody></table></div>${kalenderFuss()}`;
    offenTermine.forEach((id) => reaktionZeigen(id));
  }
  function kalenderFuss() {
    const q = (kalender && kalender.quellen) || [];
    return `<p class="wm-fuss">Zeiten in deutscher Zeit. Ist grün: gut für die Währung (über Prognose bzw. Vorwert, bei Arbeitslosigkeit darunter), rot: schlecht.
      ${q.length ? "Quellen: " + esc(q.join(", ")) + "." : ""}${kalender && kalender.prognose_quelle ? " Prognosen: " + esc(kalender.prognose_quelle) + "." : kalender && !kalender.demo ? " Prognosen nur mit Trading-Economics- oder FMP-Schlüssel." : ""}
      Ist-Werte in der Minute der Veröffentlichung kommen über python live.py direkt von der US-Statistikbehörde.</p>`;
  }
  function kalenderAufklappen(id) {
    if (offenTermine.has(id)) offenTermine.delete(id); else offenTermine.add(id);
    kalenderTabelle();
    const z = $(`[data-k="${CSS.escape(id)}"]`, huelle);
    if (z) z.focus({ preventScroll: true });
  }
  function terminDetail(e) {
    const w = (e.werte || []).map((x) => {
      const u = W.ueberraschung(x);
      return u ? `${esc(x.kurz)}: Ist ${wertText(x, "ist")} gegenüber ${u.bezug === "prog" ? "Prognose" : x.vor_text || "Vorwert"} ${wertText(x, u.bezug)}` : "";
    }).filter(Boolean);
    return `<div class="wm-k-detail">
      ${e.info ? `<p>${esc(e.info)}</p>` : ""}${w.length ? `<p>${w.join(" · ")}</p>` : ""}
      <p class="wm-klein">${esc(e.quelle || "")}${W.sichereUrl(e.link) ? ` · <a href="${esc(W.sichereUrl(e.link))}" target="_blank" rel="noopener noreferrer">Quelle öffnen</a>` : ""}${e.slug && WERTE[e.slug] ? ` · <button type="button" class="wm-link" data-w="${e.slug}">${esc(WERTE[e.slug].name)} anzeigen</button>` : ""}</p>
      <div class="wm-reaktion" data-reaktion="${esc(e.id)}"></div></div>`;
  }

  // Marktreaktion: wie sich EUR/USD, Gold und S&P 500 nach den letzten Terminen derselben Art bewegt haben
  const REAKTION_IND = { us_cpi: "us_cpi_j", us_arbeit: "us_nfp" };
  function reaktionZeigen(id) {
    const e = kalender && kalender.termine.find((x) => x.id === id);
    const el = huelle && $(`[data-reaktion="${CSS.escape(id)}"]`, huelle);
    if (!e || !el || !REAKTION_IND[e.gruppe] || !window.WBBacktest || !window.WBBacktestKern) return;
    el.innerHTML = '<p class="wm-klein">Marktreaktion früherer Termine wird berechnet …</p>';
    const K = window.WBBacktestKern;
    window.WBBacktest.datenLaden().then((d) => {
      const ind = (d.ereignisse || []).find((x) => x.id === REAKTION_IND[e.gruppe]);
      if (!ind) { el.innerHTML = '<p class="wm-klein">Für frühere Termine fehlen die Wirtschaftsdaten (FRED_API_KEY).</p>'; return null; }
      const symbole = ["EURUSD=X", "GC=F", "^GSPC", "^NDX", "^GDAXI"];
      const werte = symbole.map((s) => d.werte.find((w) => w.s === s)).filter(Boolean).slice(0, 3);
      return window.WBBacktest.intradayLaden(werte).then(() => ({ ind, werte }));
    }).then((x) => {
      if (!x) return;
      const termine = x.ind.termine.filter((t) => t.t < Date.now() / 6e4 - 60).slice(-12).map((t) => ({ t: t.t, ueb: t.ist - (t.prog != null ? t.prog : t.vor), ist: t.ist, prog: t.prog, vor: t.vor }));
      const ergebnisse = x.werte.map((w) => ({ w, r: W.reaktion(K, w, termine, [15, 60]) }));
      const fmtR = (v) => `<span class="${ton(v)}">${pct(v, 2)}</span>`;
      const kopf = ergebnisse.map(({ w, r }) => `<th class="r" colspan="${r.some((z) => z.aufl !== "tag") ? 2 : 1}">${esc(w.name)}</th>`).join("");
      const minuten = ergebnisse.some(({ r }) => r.some((z) => z.aufl !== "tag"));
      const unter = ergebnisse.map(({ r }) => (r.some((z) => z.aufl !== "tag") ? '<th class="r">15 Min.</th><th class="r">60 Min.</th>' : '<th class="r">Tag</th>')).join("");
      const zeilen = termine.slice().reverse().map((t) => {
        const zellen = ergebnisse.map(({ r }) => {
          const z = r.find((y) => y.t === t.t) || {};
          return z.aufl && z.aufl !== "tag" ? `<td class="r">${fmtR(z[15])}</td><td class="r">${fmtR(z[60])}</td>` : `<td class="r">${fmtR(z.tag)}</td>${r.some((y) => y.aufl !== "tag") ? "<td></td>" : ""}`;
        }).join("");
        return `<tr><td>${fDatum.format(new Date(t.t * 6e4))}</td><td class="r">${zahl(t.ist, x.ind.dez)}</td><td class="r">${zahl(t.prog != null ? t.prog : t.vor, x.ind.dez)}</td><td class="r ${ton(t.ueb, 1e-9)}">${minus((t.ueb > 0 ? "+" : "") + nf(x.ind.dez).format(t.ueb))}</td>${zellen}</tr>`;
      }).join("");
      // Durchschnitt getrennt nach Überraschung nach oben / unten
      const schnitt = ({ r }, seite) => {
        const k = r.some((z) => z.aufl !== "tag") ? 60 : "tag";
        const v = r.filter((z) => (seite > 0 ? z.ueb > 0 : z.ueb < 0) && z[k] != null).map((z) => z[k]);
        return v.length ? `${pct(v.reduce((a, b) => a + b, 0) / v.length, 2)} (${v.length}×)` : "–";
      };
      el.innerHTML = `<p class="wm-k-label">Marktreaktion der letzten ${termine.length} Termine (${esc(x.ind.kurz)}, Ist gegenüber ${termine.some((t) => t.prog != null) ? "Prognose" : "Vorwert"})</p>
        <p class="wm-klein">${ergebnisse.map((g) => `<b>${esc(g.w.name)}</b> ${minuten ? "nach 60 Min." : "am Tag"}: bei Ist darüber Ø ${schnitt(g, 1)}, darunter Ø ${schnitt(g, -1)}`).join(" · ")}</p>
        <div class="wm-scroll"><table class="wm-tab wm-reaktion-tab"><thead><tr><th>Termin</th><th class="r">Ist</th><th class="r">${termine.some((t) => t.prog != null) ? "Prog." : "Vorw."}</th><th class="r">Überr.</th>${kopf}</tr>
        <tr class="wm-unterkopf"><th colspan="4"></th>${unter}</tr></thead><tbody>${zeilen}</tbody></table></div>
        <p class="wm-klein">Aus den Backtest-Daten${minuten ? " (Minutenkerzen, Mittelkurs ab der Veröffentlichungsminute)" : " (nur Tageskurse vorhanden)"}. Vergangenheit, keine Vorhersage.</p>`;
    }).catch(() => { el.innerHTML = '<p class="wm-klein">Die Backtest-Daten ließen sich nicht laden.</p>'; });
  }

  /* ================================================================ 5 Bewegung */
  function fensterBewegung() {
    const el = huelle && $('[data-inhalt="bewegung"]', huelle);
    if (!el) return;
    const modus = zustand.bewegung === "heute" && !SLUGS.some((s) => kursInfo(s).heute != null) ? "1W" : zustand.bewegung;
    const wert = (s) => { const b = WERTE[s]; return modus === "heute" ? kursInfo(s).heute : modus === "1W" ? b.rendite_1w : b.rendite_ytd; };
    const skala = (s) => { const v = (WERTE[s].kz || {}).vol_1m; return modus === "heute" ? v / Math.sqrt(252) : modus === "1W" ? v * Math.sqrt(5 / 252) : null; };
    let html = "";
    for (const [typ, name] of KLASSEN) {
      const liste = SLUGS.filter((s) => WERTE[s].typ === typ);
      if (!liste.length) continue;
      html += `<div class="wm-hm-gruppe"><p>${esc(name)}</p><div class="wm-hm">${liste.map((s) => {
        const v = wert(s), sk = skala(s), z = v != null && sk ? v / sk : null;
        const staerke = z != null ? Math.min(1, Math.abs(z) / 2.5) : v != null ? Math.min(1, Math.abs(v) / 0.15) : 0;
        return `<button type="button" class="wm-hm-zelle ${ton(v)}" data-w="${s}" style="--st:${(0.12 + staerke * 0.78).toFixed(2)}" title="${esc(WERTE[s].name)}: ${pct(v, 2)}${z != null ? `, ${zahl(z, 1)} Standardabweichungen` : ""}">
          <b>${esc(kurzName(WERTE[s]))}</b><span>${pct(v, modus === "YTD" ? 0 : 1)}</span>${z != null ? `<small>${minus(nf(1).format(z))} σ</small>` : ""}</button>`;
      }).join("")}</div></div>`;
    }
    const alle = SLUGS.map((s) => ({ s, v: wert(s), sk: skala(s) })).filter((x) => x.v != null);
    const z = alle.filter((x) => x.sk).map((x) => ({ s: x.s, z: x.v / x.sk })).sort((a, b) => Math.abs(b.z) - Math.abs(a.z)).slice(0, 3);
    el.innerHTML = `${modus !== zustand.bewegung ? '<p class="wm-klein">Ohne Live-Kurse: Veränderung der Woche.</p>' : ""}${html}
      <p class="wm-fuss">${alle.length ? `▲ ${alle.filter((x) => x.v > 0).length} · ▼ ${alle.filter((x) => x.v < 0).length}` : ""}${z.length ? ` · Ausreißer: ${z.map((x) => `${esc(kurzName(WERTE[x.s]))} ${minus(nf(1).format(x.z))} σ`).join(", ")}` : ""}
      ${modus !== "YTD" ? " · σ = Bewegung geteilt durch die übliche Schwankung (Volatilität eines Monats)" : ""}</p>`;
  }

  /* ================================================================ 6 Lage */
  function fensterLage() {
    const el = huelle && $('[data-inhalt="lage"]', huelle);
    if (!el) return;
    const idx = SLUGS.find((s) => WERTE[s].kz && WERTE[s].kz.vix != null);
    const kz = idx ? WERTE[idx].kz : {};
    const zinsen = {}, inflation = {};
    SLUGS.forEach((s) => {
      const b = WERTE[s], c = b.carry, k = b.kz || {};
      if (c) { if (c.zins_basis != null) zinsen[c.basis] = c.zins_basis; if (c.zins_gegen != null) zinsen[c.gegen] = c.zins_gegen; }
      if (k.basis && k.inflation_basis != null) inflation[k.basis] = k.inflation_basis;
      if (k.gegen && k.inflation_gegen != null) inflation[k.gegen] = k.inflation_gegen;
    });
    const kachel = (label, wert, unter, kl = "") => `<div class="wm-zahl"><span>${esc(label)}</span><b class="${kl}">${wert}</b><small>${unter}</small></div>`;
    const treffer = KLASSEN.map(([typ, name]) => {
      const l = SLUGS.filter((s) => WERTE[s].typ === typ);
      if (!l.length || typ === "etf") return "";
      const t = l.filter((s) => { const r = signal(s); return r && r.treffer; }).length;
      return `<li><span>${esc(name)}</span><b>${t}</b><small>von ${l.length}</small><i style="--a:${(t / l.length).toFixed(2)}"></i></li>`;
    }).join("");
    const waehrungen = Object.keys(zinsen).sort();
    el.innerHTML = `
      <div class="wm-zahlen">
        ${kachel("VIX", zahl(kz.vix, 1), kz.vix3m != null ? `3M ${zahl(kz.vix3m, 1)} · ${kz.vix_struktur < 1 ? "Contango" : "Backwardation"}` : "Volatilität S&P 500", kz.vix > 25 ? "minus" : kz.vix < 15 ? "plus" : "")}
        ${kachel("High Yield", pct(kz.hy_spread, 2, false), kz.hy_datum ? "Spread, " + esc(kz.hy_datum) : "Kreditaufschlag", kz.hy_spread > 0.05 ? "minus" : "")}
        ${kachel("Treffer", String(SLUGS.filter((s) => { const r = signal(s); return r && r.treffer; }).length), "über alle Klassen")}
      </div>
      ${waehrungen.length ? `<table class="wm-tab wm-zinsen"><thead><tr><th>Währung</th><th class="r">Leitzins</th><th class="r">Inflation</th><th class="r">Realzins</th></tr></thead><tbody>
        ${waehrungen.map((w) => { const real = inflation[w] != null ? zinsen[w] - inflation[w] : null; return `<tr><td><b>${esc(w)}</b></td><td class="r">${pct(zinsen[w], 2, false)}</td><td class="r">${pct(inflation[w], 1, false)}</td><td class="r ${ton(real, 1e-4)}">${pct(real, 2)}</td></tr>`; }).join("")}
      </tbody></table>` : ""}
      ${treffer ? `<h5>Treffer je Klasse</h5><ul class="wm-treffer">${treffer}</ul>` : ""}
      <h5>Korrelation 1 Jahr <span class="wm-klein">tägliche Renditen</span></h5>
      <div class="wm-korr" data-korr>${korrelationHTML()}</div>`;
  }
  function korrelationHTML() {
    if (!korrelation) return '<p class="wm-klein">Kurse werden geladen …</p>';
    const idx = SLUGS.map((s, i) => i).filter((i) => korrelation[i][i] != null);
    if (idx.length < 2) return '<p class="wm-klein">Zu wenige Kursreihen.</p>';
    const paare = [];
    idx.forEach((i, a) => idx.slice(a + 1).forEach((j) => { if (korrelation[i][j] != null) paare.push([i, j, korrelation[i][j]]); }));
    const schnitt = paare.reduce((s, p) => s + p[2], 0) / (paare.length || 1);
    const top = paare.slice().sort((a, b) => b[2] - a[2]).slice(0, 3);
    const zelle = (k) => (k == null ? "" : `style="--k:${Math.abs(k).toFixed(2)}" class="${k >= 0 ? "pos" : "neg"}"`);
    return `<table class="wm-korr-tab" aria-label="Korrelationsmatrix"><thead><tr><th></th>${idx.map((i) => `<th scope="col" title="${esc(WERTE[SLUGS[i]].name)}"><span>${esc(kurzSym(WERTE[SLUGS[i]]).slice(0, 6))}</span></th>`).join("")}</tr></thead>
      <tbody>${idx.map((i) => `<tr><th scope="row" title="${esc(WERTE[SLUGS[i]].name)}">${esc(kurzSym(WERTE[SLUGS[i]]).slice(0, 7))}</th>${idx.map((j) => `<td ${zelle(korrelation[i][j])} title="${esc(WERTE[SLUGS[i]].name)} / ${esc(WERTE[SLUGS[j]].name)}: ${zahl(korrelation[i][j], 2)}"></td>`).join("")}</tr>`).join("")}</tbody></table>
      <p class="wm-klein">Ø Korrelation ${zahl(schnitt, 2)}${top.length ? " · am engsten: " + top.map(([i, j, k]) => `${esc(kurzName(WERTE[SLUGS[i]]))}/${esc(kurzName(WERTE[SLUGS[j]]))} ${zahl(k, 2)}`).join(", ") : ""}</p>`;
  }

  /* ================================================================ Live-Kurse */
  let kursGeplant = false;
  const offenKurse = new Set();
  document.addEventListener("wb:chartart", () => { if (offen) zeichneChart(); });
  document.addEventListener("wb:kurse", (e) => {
    if (!offen) return;
    (e.detail || []).forEach((s) => offenKurse.add(s));
    if (kursGeplant) return;
    kursGeplant = true;
    setTimeout(() => {
      kursGeplant = false;
      if (!offen) return;
      offenKurse.forEach(kursZeile);
      if (offenKurse.has(zustand.wert)) { detailKopf(); if (zustand.chart === "Heute") zeichneChart(); }
      $$("[data-chip]", huelle).forEach((c) => { if (offenKurse.has(c.dataset.chip)) { const v = kursInfo(c.dataset.chip).heute; const sp = $("span", c); sp.textContent = v != null ? pct(v, 1) : ""; sp.className = ton(v); } });
      offenKurse.clear();
      breite();
      if (Date.now() - (fensterBewegung.zuletzt || 0) > 3000) { fensterBewegung.zuletzt = Date.now(); fensterBewegung(); }
    }, 250);
  });
  window.addEventListener("resize", () => { if (offen) { clearTimeout(zeichneChart.z); zeichneChart.z = setTimeout(zeichneChart, 150); } });

  // Für Tests und die Vorschau
  window.WBWork = { oeffnen, schliessen, zustand: () => zustand, nachrichten: () => newsZustand.liste, aufnehmen, kalender: () => kalender };
})();
