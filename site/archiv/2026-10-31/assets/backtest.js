/* Fathom: Backtest-Fenster (Widget „Backtest“ in der Leiste links, Adresse #backtest).
 *
 * Bis zu dreißig Fakten beschreiben eine Strategie (direkt aus dem Baukasten gewählt): wann einsteigen (Quartalszahlen, Wochentag, Fathom-Signale,
 * Trend …), wie handeln (Richtung, Eröffnung oder Schluss), wann aussteigen (Take-Profit, Stop, Haltedauer) und
 * mit wie viel Kapital. Gerechnet wird im Browser mit assets/backtest-kern.js auf Tageskursen der letzten zehn
 * Jahre (daten/backtest.json, beim ersten Öffnen geladen). Die Strategie liegt nur in diesem Browser.
 */
(function () {
  "use strict";
  const K = window.WBBacktestKern;
  const { $, $$, esc, lies, schreib, nf, minus, zahl, KLASSEN } = window.WBH;
  const pct = (x, d = 1, vz = true) => {
    if (x == null || !isFinite(x)) return "–";
    const t = nf(d).format(x * 100);
    return /^-?0(,0*)?$/.test(t) ? `${nf(d).format(0)}\u00a0%` : minus((vz && x > 0 ? "+" : "") + t + "\u00a0%");
  };
  const euro = (x, d) => (x == null || !isFinite(x) ? "–" : minus(nf(d == null ? (Math.abs(x) >= 1000 ? 0 : 2) : d).format(x)) + "\u00a0€");
  const euroVz = (x, d) => (x == null || !isFinite(x) ? "–" : Math.abs(x) < (d === 2 ? 0.005 : 0.5) ? euro(0, d) : (x > 0 ? "+" : "") + euro(x, d));
  const tonE = (x) => (x == null || !isFinite(x) || Math.abs(x) < 0.5 ? "" : x > 0 ? "plus" : "minus");
  const zeitDE = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const datumZeit = (min, mitZeit) => (mitZeit ? zeitDE.format(new Date(min * 6e4)).replace(",", "") : datumDE(Math.floor(min / 1440)));
  const dauerText = (tage) => (tage == null ? "–" : tage >= 1 ? `${zahl(tage, 1)} Tage` : tage * 24 >= 1 ? `${zahl(tage * 24, 1)} Std.` : `${zahl(tage * 1440, 0)} Min.`);
  const ton = (x) => (x == null || !isFinite(x) || Math.abs(x) < 5e-5 ? "" : x > 0 ? "plus" : "minus");
  const datumDE = (t) => { const [j, m, d] = K.datum(t).split("-"); return `${d}.${m}.${j}`; };
  const SCHLUESSEL = "fathom.backtest";
  const GRUND = { ziel: "Take-Profit", stop: "Stop", zeit: "Zeit", offen: "noch offen" };
  const ICON_ZU = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';

  const basisEl = $("#live-basis");
  const SPEZ = basisEl ? (JSON.parse(basisEl.textContent).spez || null) : null;
  const katalog = (typ) => (SPEZ && SPEZ.katalog[typ]) || [];
  const schwellen = (typ) => (window.WBRegeln && window.WBRegeln.params ? window.WBRegeln.params(typ) : (SPEZ && SPEZ.params[typ]) || {});

  /* ================================================================ Zustand */
  const BEISPIEL = [
    { typ: "zahlen", seite: "besser", min: 0, fenster: 5 },
    { typ: "wochentag", tag: "1" },
    { typ: "einstieg", zeit: "eroeffnung" },
    { typ: "richtung", seite: "long" },
    { typ: "tp", wert: 2, bezug: "kurs" },
    { typ: "halten", tage: 10, einheit: "tage" },
    { typ: "kapital", start: 10000, wert: 1000, art: "betrag" },
  ];
  // US-Inflation über der Prognose → Dollar stärker → EUR/USD fällt: eine Minute nach 8:30 Uhr New York short
  const BEISPIEL_CPI = [
    { typ: "ereignis", ind: "us_cpi_j", vergleich: "prognose", seite: "ueber", abstand: 0.1, masz: "absolut", einstieg: "1" },
    { typ: "richtung", seite: "short" },
    { typ: "tp", wert: 3, bezug: "einsatz" },
    { typ: "sl", wert: 2, bezug: "einsatz" },
    { typ: "halten", tage: 4, einheit: "stunden" },
    { typ: "hebel", wert: 20, zwang: 50, zins: 5 },
    { typ: "kapital", start: 10000, wert: 1000, art: "betrag" },
  ];
  let zustand = (() => { try { return JSON.parse(lies(SCHLUESSEL)); } catch (e) { return null; } })();
  if (!zustand || !Array.isArray(zustand.fakten)) zustand = { klasse: "aktie", wert: "", jahre: 10, fakten: BEISPIEL.map((f) => ({ ...f })) };
  // Weitere Werte außerhalb der Watchlist: nur gültige Kürzel und Klassen, höchstens 30
  const KUERZEL = /^[A-Za-z0-9.\-=^&]{1,24}$/;
  zustand.extra = (Array.isArray(zustand.extra) ? zustand.extra : [])
    .filter((x) => x && typeof x.s === "string" && KUERZEL.test(x.s) && KLASSEN.some(([k]) => k === x.t))
    .slice(-30).map((x) => ({ s: x.s, n: String(x.n || x.s).slice(0, 80), t: x.t }));
  // ältere Strategien: Positionsgröße in % → Kapital und Einsatz
  zustand.fakten = zustand.fakten.map((f) => (f.typ === "groesse" ? { typ: "kapital", start: 10000, wert: +f.wert || 10, art: "prozent" } : f));
  // Aus welchem Setup die Regeln stammen (Setup Lab): nur gültige Kennung und Versionsnummer
  zustand.setup = zustand.setup && typeof zustand.setup.id === "string" && /^s[a-z0-9]{6,24}$/.test(zustand.setup.id) && Number.isInteger(zustand.setup.nr)
    ? { id: zustand.setup.id, nr: zustand.setup.nr } : null;
  const sichern = () => schreib(SCHLUESSEL, JSON.stringify(zustand));

  let daten = null, laden = null, huelle = null, ausloeser = null, ergebnis = null, veraltet = false;

  function datenLaden() {
    if (daten) return Promise.resolve(daten);
    if (laden) return laden;
    const inline = $("#backtest-daten");
    const roh = inline ? Promise.resolve(JSON.parse(inline.textContent))
      : fetch("daten/backtest.json", { cache: "no-cache" }).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); });
    laden = roh.then((d) => {
      const kat = (Array.isArray(d.katalog) ? d.katalog : []).filter((k) => k && typeof k.s === "string" && KUERZEL.test(k.s)
        && KLASSEN.some(([t]) => t === k.t) && typeof k.f === "string" && /^daten\/backtest\/katalog\/[a-z0-9-]+\.json$/.test(k.f));
      daten = { stand: d.stand, demo: d.demo, werte: d.werte.map(K.dekodiere), ereignisse: K.wirtschaft(d.ereignisse), katalog: kat };
      K.setzeEreignisse(daten.ereignisse);
      return daten;
    });
    laden.catch(() => { laden = null; });
    return laden;
  }
  const werteDerKlasse = (typ) => (daten ? daten.werte.filter((w) => w.typ === typ && !w.extra) : []);  // nur Watchlist
  const extraDerKlasse = (typ) => zustand.extra.filter((e) => e.t === typ);

  /* ================================================================ Weitere Werte (außerhalb der Watchlist) */
  // Kurse kommen aus dem Backtest-Katalog (jede Woche vorberechnet, daten/backtest/katalog/…) oder, mit python live.py,
  // für jeden Wert aus der Suche (api/backtest-wert, Yahoo Finance). Die Auswahl merkt sich dieser Browser.
  const extraLaeuft = {};
  function extraLaden(e) {
    if (daten.werte.some((w) => w.s === e.s && w.extra)) return Promise.resolve();
    if (!extraLaeuft[e.s]) {
      const kat = daten.katalog.find((k) => k.s === e.s);
      const antwort = (r) => (r.ok ? r.json() : r.json().catch(() => ({})).then((j) => { throw new Error(j.fehler || `Fehler ${r.status}`); }));
      const quelle = kat ? fetch(kat.f, { cache: "no-cache" }).then(antwort)
        : window.WBH.serverMoeglich() ? fetch("api/backtest-wert", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbol: e.s, typ: e.t, name: e.n }) }).then(antwort)
        : Promise.reject(new Error(`${e.n} steht nicht im Katalog. Beliebige Werte gibt es mit dem lokalen Server (python live.py).`));
      extraLaeuft[e.s] = quelle.then((j) => {
        if (!j || typeof j.s !== "string" || j.s.toUpperCase() !== e.s.toUpperCase() || !Array.isArray(j.c)) throw new Error("Keine gültigen Kursdaten");
        const w = K.dekodiere(j);
        Object.assign(w, { extra: true, typ: e.t, name: e.n || w.name });
        if (!daten.werte.some((x) => x.s === w.s && x.extra)) daten.werte.push(w);
        laborFertig = false;  // Chart-Taktik zeigt den Wert beim nächsten Öffnen mit an
        delete e.fehler;
      }).catch((err) => { delete extraLaeuft[e.s]; e.fehler = err.message; throw err; });
    }
    return extraLaeuft[e.s];
  }
  const alleExtrasLaden = () => Promise.all(zustand.extra.map((e) => extraLaden(e).catch(() => null)));

  let suchTreffer = [], suchTimer = null, suchAbbruch = null;
  const TYPNAME = { aktie: "Aktie", etf: "ETF", forex: "Währung", rohstoff: "Rohstoff", index: "Index" };
  /* Suche für beide Reiter: sofort Watchlist und Backtest-Katalog, mit python live.py danach auch Yahoo Finance.
     opt: { signal (Abbruch), mehr (längere Listen), lokal (ohne Yahoo) }.
     Rückgabe { sofort: [Treffer], spaeter: Promise<[weitere Treffer]> | null }; Treffer { s, n, t, q (Quelle) }. */
  function sucheNach(text, opt) {
    const { signal, mehr, lokal } = opt || {};
    const q = String(text || "").trim().toLowerCase();
    if (!daten || q.length < 1) return { sofort: [], spaeter: null };
    const passt = (n, s) => `${n} ${s}`.toLowerCase().includes(q);
    const watch = daten.werte.filter((w) => !w.extra && passt(w.name, w.s)).slice(0, mehr ? 8 : 4).map((w) => ({ s: w.s, n: w.name, t: w.typ, q: "Watchlist" }));
    const kat = daten.katalog.filter((k) => passt(k.n, k.s)).slice(0, mehr ? 12 : 8).map((k) => ({ s: k.s, n: k.n, t: k.t, q: "Katalog" }));
    const sofort = [...watch, ...kat];
    if (lokal || q.length < 2 || !window.WBH.serverMoeglich()) return { sofort, spaeter: null };
    const da = new Set(sofort.map((x) => x.s.toUpperCase()));
    const spaeter = fetch("api/suche?q=" + encodeURIComponent(String(text).trim().slice(0, 60)), { signal, cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { ergebnisse: [] }))
      .then((j) => (j.ergebnisse || []).filter((r) => r && KUERZEL.test(r.symbol || "") && TYPNAME[r.typ] && !da.has(r.symbol.toUpperCase()))
        .slice(0, 10).map((r) => {
          const k = daten.katalog.find((x) => x.s.toUpperCase() === r.symbol.toUpperCase());
          return k ? { s: k.s, n: k.n, t: k.t, q: "Katalog" } : { s: r.symbol, n: String(r.name || r.symbol).slice(0, 80), t: r.typ, q: "Yahoo Finance" };
        }));
    return { sofort, spaeter };
  }
  function suchen(text) {
    const ul = $("#bt-treffer", huelle), q = text.trim().toLowerCase();
    clearTimeout(suchTimer); if (suchAbbruch) suchAbbruch.abort();
    if (q.length < 2) { suchTreffer = []; ul.hidden = true; ul.innerHTML = ""; return; }
    trefferZeigen(sucheNach(text, { lokal: true }).sofort, window.WBH.serverMoeglich());
    if (!window.WBH.serverMoeglich()) return;
    suchTimer = setTimeout(() => {
      suchAbbruch = new AbortController();
      const r = sucheNach(text, { signal: suchAbbruch.signal });
      if (!r.spaeter) return;
      r.spaeter.then((neu) => trefferZeigen(r.sofort.concat(neu), false)).catch((err) => { if (!err || err.name !== "AbortError") trefferZeigen(suchTreffer, false); });
    }, 300);
  }
  function trefferZeigen(liste, laedt) {
    suchTreffer = liste;
    const ul = $("#bt-treffer", huelle);
    ul.innerHTML = liste.map((x, i) => `<li><button type="button" data-bt-treffer="${i}"><b>${esc(x.n)}</b><span>${esc(x.s)} · ${TYPNAME[x.t]} · ${esc(x.q)}</span></button></li>`).join("")
      + (laedt ? '<li class="bt-treffer-laedt">Suche bei Yahoo Finance …</li>' : liste.length ? "" : '<li class="bt-treffer-leer">Nichts gefunden.</li>');
    ul.hidden = false;
  }
  function trefferWaehlen(x) {
    const eingabe = $('[data-bt="suche"]', huelle); if (eingabe) eingabe.value = "";
    suchTreffer = [];
    if (x.q === "Watchlist" || daten.werte.some((w) => !w.extra && w.s.toUpperCase() === x.s.toUpperCase())) {
      x = daten.werte.find((w) => !w.extra && w.s.toUpperCase() === x.s.toUpperCase()) || x;
      zustand.klasse = x.typ || x.t; zustand.wert = x.s; formular(); geaendert(); return;
    }
    zustand.extra = zustand.extra.filter((e) => e.s !== x.s).concat({ s: x.s, n: x.n, t: x.t }).slice(-30);
    zustand.klasse = x.t; zustand.wert = x.s;
    formular(); geaendert();
    sucheMelden(`${x.n}: Kurse werden geladen …`);
    extraLaden(zustand.extra.find((e) => e.s === x.s))
      .then(() => {
        const w = daten.werte.find((v) => v.s === x.s && v.extra);
        sucheMelden(w ? `${x.n} ist bereit: Tageskurse seit ${K.datum(w.tag[0]).slice(0, 4)}${w.e.length ? `, ${w.e.length} Quartalszahlen` : ""}. Quelle: ${w.quelle || "Yahoo Finance"}.` : "");
      })
      .catch((err) => { formular(); sucheMelden(err.message); });
  }
  function sucheMelden(t) { const m = $(".bt-suche-status", huelle); if (m) m.textContent = t; }
  // Stunden- und Minutenkerzen erst laden, wenn ein Backtest sie braucht
  const intradayLaeuft = {};
  function intradayLaden(werte) {
    return Promise.all(werte.filter((w) => w.iUrl && !w.std).map((w) => {
      if (!intradayLaeuft[w.s]) {
        intradayLaeuft[w.s] = fetch(w.iUrl, { cache: "no-cache" }).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
          .then((j) => K.intraday(w, j)).catch(() => { delete intradayLaeuft[w.s]; w.iFehler = true; });
      }
      return intradayLaeuft[w.s];
    }));
  }

  /* ================================================================ Fenster */
  function bauen() {
    if (!modusMoeglich(modus)) modus = "fakten";
    huelle = document.createElement("div");
    huelle.className = "bt-huelle"; huelle.hidden = true;
    huelle.innerHTML = `
      <section class="bt" role="dialog" aria-modal="true" aria-labelledby="bt-titel" tabindex="-1">
        <header class="bt-kopf">
          <div><p class="bt-zeile">Fathom · Strategie-Labor</p><h2 id="bt-titel">Backtest</h2></div>
          <div class="bt-modus" role="tablist" aria-label="Art des Backtests">
            <button type="button" role="tab" data-bt-modus="fakten" aria-selected="${modus === "fakten"}" tabindex="${modus === "fakten" ? 0 : -1}">Fakten</button>
            <button type="button" role="tab" data-bt-modus="chart" aria-selected="${modus === "chart"}" tabindex="${modus === "chart" ? 0 : -1}">Chart-Taktik</button>
            ${window.WBSetupLab ? `<button type="button" role="tab" data-bt-modus="setups" aria-selected="${modus === "setups"}" tabindex="${modus === "setups" ? 0 : -1}">Setups</button>` : ""}
          </div>
          <button type="button" class="knopf schliessen-knopf" data-bt-zu>${ICON_ZU}Schließen</button>
        </header>
        <div class="bt-koerper"${modus === "fakten" ? "" : " hidden"}>
          <form class="bt-strategie" novalidate autocomplete="off"></form>
          <div class="bt-report" aria-live="polite"></div>
        </div>
        <div class="bt-labor"${modus === "chart" ? "" : " hidden"}></div>
        <div class="bt-setups"${modus === "setups" ? "" : " hidden"}></div>
      </section>`;
    document.body.appendChild(huelle);
    const form = $(".bt-strategie", huelle);
    form.addEventListener("submit", (e) => { e.preventDefault(); starten(true); });
    form.addEventListener("input", feldGeaendert);
    form.addEventListener("change", feldGeaendert);
    form.addEventListener("click", klickInForm);
    $(".bt-modus", huelle).addEventListener("keydown", (e) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
      const tabs = $$("[data-bt-modus]", huelle), i = tabs.indexOf(document.activeElement);
      if (i < 0) return;
      e.preventDefault();
      const j = e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : (i + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
      tabs[j].focus(); modusSetzen(tabs[j].dataset.btModus);
    });
    huelle.addEventListener("click", (e) => {
      if (e.target.closest("[data-bt-zu]")) { e.preventDefault(); schliessen(); }
      const mehr = e.target.closest("[data-bt-alle]");
      if (mehr) { mehr.closest(".bt-block").querySelector("tbody").innerHTML = tradeZeilen(ergebnis.trades.slice().reverse()); mehr.remove(); }
      if (e.target.closest("[data-bt-csv]")) csv();
      if (e.target.closest("[data-bt-setup]") && window.WBSetupLab) window.WBSetupLab.speichernZeigen($(".bt-report", huelle));
      if (e.target.closest("[data-bt-drucken]")) window.print();
      const m = e.target.closest("[data-bt-modus]");
      if (m) modusSetzen(m.dataset.btModus);
    });
  }

  // Zwei Arten: Fakten (Regeln aus Bausteinen) und Chart-Taktik (gezeichnet und in Worten beschrieben, assets/zeichnen.js)
  // Drei Reiter: Fakten, Chart-Taktik und Setups (gespeicherte Strategien mit Bewährungsprobe, assets/setups.js)
  let modus = ["chart", "setups"].includes(lies("fathom.backtest.modus")) ? lies("fathom.backtest.modus") : "fakten";
  const modusMoeglich = (m) => (m === "chart" ? !!window.WBTaktikLabor : m === "setups" ? !!window.WBSetupLab : m === "fakten");
  let laborFertig = false;
  function modusSetzen(neu) {
    if (!modusMoeglich(neu)) return;
    modus = neu; schreib("fathom.backtest.modus", neu);
    $$("[data-bt-modus]", huelle).forEach((b) => { b.setAttribute("aria-selected", String(b.dataset.btModus === neu)); b.tabIndex = b.dataset.btModus === neu ? 0 : -1; });
    $(".bt-koerper", huelle).hidden = neu !== "fakten";
    $(".bt-labor", huelle).hidden = neu !== "chart";
    $(".bt-setups", huelle).hidden = neu !== "setups";
    if (neu === "chart") laborZeigen();
    if (neu === "setups") window.WBSetupLab.zeigen($(".bt-setups", huelle));
  }
  function laborZeigen() {
    const el = $(".bt-labor", huelle);
    if (!daten) { el.innerHTML = '<p class="klein bt-laedt">Kursdaten werden geladen …</p>'; return; }
    if (!laborFertig) { laborFertig = true; window.WBTaktikLabor.zeigen(el, daten); } else window.WBTaktikLabor.zeichne();
  }

  const melden = window.WBH.fenster("backtest", () => {
    if (location.hash === "#backtest") history.replaceState(null, "", location.pathname + location.search);
    zu(true);
  });
  function oeffnen() {
    if (!K) return;
    if (!huelle) bauen();
    if (!huelle.hidden) return;
    melden(true);
    ausloeser = document.activeElement;
    huelle.hidden = false;
    document.body.classList.add("fenster-offen", "bt-offen");
    $(".bt", huelle).focus({ preventScroll: true });
    $(".bt-strategie", huelle).innerHTML = '<p class="klein bt-laedt">Kursdaten werden geladen …</p>';
    datenLaden().then(alleExtrasLaden).then(() => {
      formular();
      if (modus === "chart") laborZeigen();
      if (modus === "setups") window.WBSetupLab.zeigen($(".bt-setups", huelle));
      if (!ergebnis) starten(false); else report();
    }).catch(() => {
      $(".bt-strategie", huelle).innerHTML = `<p class="bt-fehler">Die Kursdaten für den Backtest ließen sich nicht laden.</p>
        <p class="klein">Der Backtest braucht <code>daten/backtest.json</code> neben der Seite. Er läuft auf GitHub Pages und über <code>python live.py</code>,
        nicht beim direkten Öffnen der Datei und nicht in archivierten Wochen.</p>`;
    });
  }
  function zu(leise) {
    if (!huelle || huelle.hidden) return;
    huelle.hidden = true;
    document.body.classList.remove("fenster-offen", "bt-offen");
    if (!leise && ausloeser && document.contains(ausloeser)) ausloeser.focus({ preventScroll: true });
    melden(false);
  }
  function schliessen() {
    if (location.hash === "#backtest") history.replaceState(null, "", location.pathname + location.search);
    zu();
  }
  const ausAdresse = () => { if (location.hash === "#backtest") oeffnen(); else zu(); };
  window.addEventListener("hashchange", ausAdresse);
  document.addEventListener("DOMContentLoaded", ausAdresse);
  document.addEventListener("click", (e) => {
    const a = e.target.closest('a[href="#backtest"], [data-backtest-oeffnen]');
    if (!a) return;
    e.preventDefault();
    if (location.hash !== "#backtest") history.pushState(null, "", "#backtest");
    oeffnen();
  });
  document.addEventListener("keydown", (e) => {
    const suche = e.target && e.target.closest && e.target.closest('[data-bt="suche"]');
    if (suche && e.key === "Enter") { e.preventDefault(); if (suchTreffer[0]) trefferWaehlen(suchTreffer[0]); return; }
    if (e.key !== "Escape") return;
    if (e.target && e.target.closest && e.target.closest("[data-bt-esc]")) return;  // Formular schließt sich selbst
    const liste = huelle && $("#bt-treffer", huelle);
    if (suche && liste && !liste.hidden) { e.preventDefault(); e.stopImmediatePropagation(); liste.hidden = true; suche.value = ""; return; }
    if (huelle && !huelle.hidden) { e.preventDefault(); e.stopImmediatePropagation(); schliessen(); }
  }, true);

  /* ================================================================ Formular */
  const verwendet = (typ, ausser) => zustand.fakten.some((f, i) => i !== ausser && f.typ === typ);
  function typGesperrt(typ, idx) {
    const d = K.FAKTEN[typ];
    if (d.einmal && verwendet(typ, idx)) return "schon gesetzt";
    if (d.nur && !d.nur.includes(zustand.klasse)) return "nur für Aktien";
    if (typ === "kriterium" && !katalog(zustand.klasse).some((k) => k.kursbasiert)) return "keine Signale für diese Klasse";
    if (typ === "ereignis" && !(daten && daten.ereignisse.length)) return "keine Termine: FRED-Schlüssel fehlt";
    return "";
  }
  function typAuswahl(f, idx) {
    const gruppen = {};
    Object.entries(K.FAKTEN).forEach(([typ, d]) => { if (!d.alt || typ === f.typ) (gruppen[d.gruppe] = gruppen[d.gruppe] || []).push([typ, d]); });
    return `<select class="bt-typ" data-feld="typ" aria-label="Art des Fakts ${idx + 1}">${Object.entries(gruppen).map(([g, liste]) =>
      `<optgroup label="${esc(K.GRUPPEN[g])}">${liste.map(([typ, d]) => {
        const sperre = typ === f.typ ? "" : typGesperrt(typ, idx);
        return `<option value="${typ}"${typ === f.typ ? " selected" : ""}${sperre ? " disabled" : ""}>${esc(d.titel)}${sperre ? ` (${sperre})` : ""}</option>`;
      }).join("")}</optgroup>`).join("")}</select>`;
  }
  function feld(f, d) {
    if (f.typ === "ereignis" && d.k === "masz" && f.vergleich === "wert") return "";
    const vor = d.vor ? `<span class="bt-wort">${esc(d.vor)}</span>` : "";
    return `<span class="bt-feld">${feldInnen(f, d, vor)}</span>`;
  }
  function feldInnen(f, d, vorText) {
    let vor = vorText;
    let nachText = d.nach;
    if (nachText === "@einheit") {
      const ind = K.indikator(f.ind);
      nachText = f.vergleich === "wert" ? (ind ? ind.einheit : "") : K.einheitText(ind, f.masz);
    }
    const nach = nachText ? `<span class="bt-wort">${esc(nachText)}</span>` : "";
    if (f.typ === "ereignis" && d.k === "abstand" && f.vergleich === "wert") vor = '<span class="bt-wort">mindestens bzw. höchstens</span>';
    if (d.art === "regler") {
      return `${vor}<input type="range" data-feld="${d.k}" value="${esc(f[d.k])}" min="${d.min}" max="${d.max}" step="${d.schritt}" aria-label="Hebel">
        <output class="bt-regler-wert">${esc(f[d.k])}${esc(d.nach || "")}</output>`;
    }
    if (d.art === "ereignis") {
      const liste = (daten && daten.ereignisse) || [];
      return `<select data-feld="ind" aria-label="Indikator">${liste.map((x) => {
        const mitProg = x.termine.filter((e) => e.prog != null).length;
        return `<option value="${esc(x.id)}"${x.id === f.ind ? " selected" : ""}>${esc(x.name)} · ${x.termine.length} Termine${mitProg ? "" : ", ohne Prognose"}</option>`;
      }).join("")}</select>`;
    }
    if (d.art === "zahl") {
      // Einsatz in % des Kontos in Viertelprozent-Schritten, als Betrag in ganzen Euro
      const schritt = f.typ === "kapital" && d.k === "wert" ? (f.art === "prozent" ? 0.25 : 50) : d.schritt;
      const min = f.typ === "kapital" && d.k === "wert" ? (f.art === "prozent" ? 0.25 : 0) : d.min;
      return `${vor}<input type="number" inputmode="decimal" data-feld="${d.k}" value="${esc(f[d.k])}" min="${min}" max="${d.max}" step="${schritt}" aria-label="${esc(d.vor || d.nach || d.k)}">${nach}`;
    }
    if (d.art === "kriterium") {
      const liste = katalog(zustand.klasse);
      return `<select data-feld="name" aria-label="Signal">${liste.map((k) =>
        `<option value="${esc(k.name)}"${k.name === f.name ? " selected" : ""}${k.kursbasiert ? "" : " disabled"}>${esc(k.name)}${k.kursbasiert ? "" : " (keine Kurshistorie)"}</option>`).join("")}</select>`;
    }
    return `${vor}<select data-feld="${d.k}" aria-label="${esc(d.vor || d.k)}">${d.opt.map(([v, t]) =>
      `<option value="${esc(v)}"${String(f[d.k]) === String(v) ? " selected" : ""}>${esc(t)}</option>`).join("")}</select>${nach}`;
  }
  function faktZeile(f, i) {
    const d = K.FAKTEN[f.typ];
    const ungueltig = d.nur && !d.nur.includes(zustand.klasse);
    return `<li class="bt-fakt${ungueltig ? " ungueltig" : ""}" data-idx="${i}">
      <span class="bt-nr">${String(i + 1).padStart(2, "0")}</span>
      <div class="bt-fakt-inhalt">
        ${typAuswahl(f, i)}
        <div class="bt-felder">${d.felder.map((x) => feld(f, x)).join("")}</div>
        ${ungueltig ? '<p class="bt-warnung">Quartalszahlen gibt es nur bei Aktien. Dieser Fakt wird ausgelassen.</p>' : ""}
      </div>
      <button type="button" class="bt-weg" data-bt-weg aria-label="Fakt ${i + 1} entfernen" title="Entfernen">${ICON_ZU}</button>
    </li>`;
  }
  function formular() {
    const form = $(".bt-strategie", huelle);
    const vorhanden = KLASSEN.filter(([t]) => werteDerKlasse(t).length || extraDerKlasse(t).length);
    if (!vorhanden.some(([t]) => t === zustand.klasse)) zustand.klasse = vorhanden.length ? vorhanden[0][0] : "aktie";
    const werte = werteDerKlasse(zustand.klasse), extras = extraDerKlasse(zustand.klasse);
    if (zustand.wert && !werte.some((w) => w.s === zustand.wert) && !extras.some((e) => e.s === zustand.wert)) zustand.wert = "";
    if (!zustand.wert && !werte.length && extras.length) zustand.wert = extras[extras.length - 1].s;
    const klassenName = esc((KLASSEN.find((k) => k[0] === zustand.klasse) || [])[1]);
    const server = window.WBH.serverMoeglich();
    const ende = Math.max(...daten.werte.map((w) => w.tag[w.n - 1]));
    form.innerHTML = `
      <p class="bt-einleitung">Stell deine Strategie aus Fakten zusammen: Ein Klick im Baukasten fügt einen Fakt direkt hinzu, jedes Signal einzeln.
        Fathom spielt sie über bis zu zehn Jahre durch, Trade für Trade und ohne Blick
        in die Zukunft: auf Minuten- und Stundenkerzen, wo es sie gibt, sonst auf Tageskursen${daten.demo ? ". <b>Demo-Daten:</b> Die Kurse sind zufällig erzeugt" : ""}.</p>
      <fieldset class="bt-markt">
        <legend>Markt</legend>
        <div class="bt-klassen" role="radiogroup" aria-label="Anlageklasse">${vorhanden.map(([t, name]) =>
          `<button type="button" role="radio" aria-checked="${t === zustand.klasse}" data-klasse="${t}">${name}<span>${werteDerKlasse(t).length + extraDerKlasse(t).length}</span></button>`).join("")}</div>
        <label class="bt-reihe"><span>Werte</span>
          <select data-bt="wert">${werte.length ? `<option value="">Alle ${werte.length} ${klassenName} der Watchlist</option>` : ""}${werte.length && extras.length ? `<optgroup label="Watchlist">` : ""}${werte.map((w) =>
            `<option value="${esc(w.s)}"${w.s === zustand.wert ? " selected" : ""}>${esc(w.name)}</option>`).join("")}${werte.length && extras.length ? "</optgroup>" : ""}${extras.length ? `<optgroup label="Weitere Werte">${extras.map((e) =>
            `<option value="${esc(e.s)}"${e.s === zustand.wert ? " selected" : ""}>${esc(e.n)}${e.fehler ? " (nicht geladen)" : ""}</option>`).join("")}</optgroup>` : ""}</select></label>
        <div class="bt-suche">
          <div class="bt-reihe"><label for="bt-suche-feld">Weitere</label>
            <span class="bt-suche-feld"><input type="search" id="bt-suche-feld" data-bt="suche" maxlength="60" autocomplete="off" spellcheck="false"
              aria-controls="bt-treffer" aria-autocomplete="list" placeholder="${server ? "Jeden Wert suchen: Name, Kürzel oder ISIN" : "Wert aus dem Katalog suchen, z. B. Allianz, Gold"}">
              <ul class="bt-treffer" id="bt-treffer" hidden></ul></span></div>
          ${extras.length ? `<div class="bt-extras" aria-label="Weitere Werte">${extras.map((e) =>
            `<span class="bt-extra${e.s === zustand.wert ? " an" : ""}${e.fehler ? " fehlt" : ""}"${e.fehler ? ` title="${esc(e.fehler)}"` : ""}><button type="button" data-bt-extra="${esc(e.s)}">${esc(e.n)}</button><button type="button" data-bt-extra-weg="${esc(e.s)}" aria-label="${esc(e.n)} entfernen">${ICON_ZU}</button></span>`).join("")}</div>` : ""}
          <p class="bt-hinweis klein bt-suche-status" aria-live="polite">${server ? "Jeder Wert aus der Suche, Kurse von Yahoo Finance über den lokalen Server."
            : `${daten.katalog.length} verbreitete Werte im Katalog (Aktien, ETFs, Währungen, Rohstoffe, Indizes). Jeden anderen Wert mit <code>python live.py</code>.`}</p>
        </div>
        <label class="bt-reihe"><span>Zeitraum</span>
          <span class="bt-zeitraum"><input type="range" min="1" max="10" step="1" value="${Math.min(10, Math.max(1, Math.round(Number(zustand.jahre)) || 10))}" data-bt="jahre" aria-label="Jahre">
          <output>${zustand.jahre} ${zustand.jahre === 1 ? "Jahr" : "Jahre"}</output></span></label>
        <p class="bt-hinweis klein">bis ${datumDE(ende)} · Stand der Daten ${esc(daten.stand.split("-").reverse().join("."))}</p>
      </fieldset>
      <fieldset class="bt-fakten-feld">
        <legend>Fakten <span class="bt-anzahl">${zustand.fakten.length} von ${K.MAX_FAKTEN}</span></legend>
        <div class="bt-schnell">
          <button type="button" class="knopf-text" data-bt-beispiel="zahlen">Beispiel: Quartalszahlen</button>
          ${daten.ereignisse.length && werteDerKlasse("forex").length ? '<button type="button" class="knopf-text" data-bt-beispiel="cpi">Beispiel: CPI und Forex</button>' : ""}
          ${katalog(zustand.klasse).some((k) => k.kursbasiert) ? '<button type="button" class="knopf-text" data-bt-kriterien>Meine Signale übernehmen</button>' : ""}
          <button type="button" class="knopf-text leise" data-bt-leeren>Alle entfernen</button>
        </div>
        <div class="bt-bau" data-bt-baukasten>${baukasten()}</div>
        <ol class="bt-fakten">${zustand.fakten.map(faktZeile).join("")}</ol>
        <p class="bt-meldung klein" aria-live="polite"></p>
        <p class="bt-worte"></p>
      </fieldset>
      <div class="bt-start">
        <button type="submit" class="knopf bt-los">Backtest starten</button>
        <p class="bt-veraltet klein" hidden>Strategie geändert. Neu starten, um den Report zu aktualisieren.</p>
      </div>`;
    inWorten();
  }

  /* Baukasten: jeder Fakt und jedes Fathom-Signal als eigener Schalter. Ein Klick fügt hinzu; Fakten, die es nur einmal
     geben kann (Richtung, Stop …), und Signale nimmt ein zweiter Klick wieder heraus. Mehrfach mögliche Fakten (z. B.
     Kursveränderung über 5 und über 20 Tage) zeigen ihre Anzahl. */
  function baukasten() {
    const voll = zustand.fakten.length >= K.MAX_FAKTEN;
    const gruppen = {};
    Object.entries(K.FAKTEN).forEach(([typ, d]) => { if (!d.alt && typ !== "kriterium") (gruppen[d.gruppe] = gruppen[d.gruppe] || []).push([typ, d]); });
    const chip = (typ, d) => {
      const n = zustand.fakten.filter((f) => f.typ === typ).length;
      const sperre = n && d.einmal ? "" : typGesperrt(typ, -1);
      const an = n > 0;
      const titel = sperre ? `${d.titel}: ${sperre}` : an && d.einmal ? `${d.titel} entfernen` : `${d.titel} hinzufügen`;
      return `<button type="button" class="bt-chip${an ? " an" : ""}" data-bt-bau="${typ}" aria-pressed="${an}"${(sperre || (voll && !an)) ? " disabled" : ""} title="${esc(titel)}">${esc(d.titel)}${n > 1 ? `<b>${n}</b>` : ""}</button>`;
    };
    const kat = katalog(zustand.klasse);
    const signale = kat.length ? `<div class="bt-bau-gruppe"><p>Fathom-Signale ${esc((KLASSEN.find((k) => k[0] === zustand.klasse) || [])[1] || "")}</p><div>${kat.map((k) => {
      const an = zustand.fakten.some((f) => f.typ === "kriterium" && f.name === k.name);
      return `<button type="button" class="bt-chip signal${an ? " an" : ""}" data-bt-signal="${esc(k.name)}" aria-pressed="${an}"${!k.kursbasiert || (voll && !an) ? " disabled" : ""}
        title="${esc(k.kursbasiert ? (an ? `${k.name} entfernen` : `${k.name} hinzufügen`) : `${k.name}: ohne Kurshistorie nicht testbar`)}">${esc(k.name)}</button>`;
    }).join("")}</div></div>` : "";
    return `${Object.entries(gruppen).map(([g, liste]) => `<div class="bt-bau-gruppe"><p>${esc(K.GRUPPEN[g])}</p><div>${liste.map(([t, d]) => chip(t, d)).join("")}</div></div>`).join("")}${signale}`;
  }

  function aktiveFakten() {
    return zustand.fakten.filter((f) => { const d = K.FAKTEN[f.typ]; return d && !(d.nur && !d.nur.includes(zustand.klasse)); });
  }
  function inWorten() {
    const el = huelle && $(".bt-worte", huelle);
    if (!el) return;
    const s = K.strategie(aktiveFakten(), katalog(zustand.klasse), schwellen(zustand.klasse), daten ? daten.ereignisse : []);
    const bed = s.bedingungen.map((b) => K.FAKTEN[b.f.typ].satz(b.f));
    const raus = [];
    const anteil = (x, einsatz, was) => `${pct(x, x * 100 % 1 ? 1 : 0, false)} ${was}${einsatz ? " auf den Einsatz" : s.hebel > 1 ? " (Kursbewegung)" : ""}`;
    if (s.tp != null) raus.push(`bei ${anteil(s.tp, s.tpEinsatz, "Gewinn")}`);
    if (s.sl != null) raus.push(`bei ${anteil(s.sl, s.slEinsatz, "Verlust")}`);
    if (s.hebel > 1) raus.push(`zwangsweise bei ${nf(0).format(s.zwang * 100)} % Verlust des Einsatzes`);
    const einheit = { tage: ["Handelstag", "Handelstagen"], stunden: ["Stunde", "Stunden"], minuten: ["Minute", "Minuten"] }[s.haltenEinheit] || ["Handelstag", "Handelstagen"];
    if (s.halten != null) raus.push(`spätestens nach ${s.halten} ${s.halten === 1 ? einheit[0] : einheit[1]}`);
    const oder = (a) => (a.length > 1 ? a.slice(0, -1).join(", ") + " oder " + a[a.length - 1] : a[0]);
    const und = (a) => (a.length > 1 ? a.slice(0, -1).join(", ") + " und " + a[a.length - 1] : a[0]);
    const k = s.kapital;
    const einsatz = k.art === "prozent" ? `${zahl(k.wert, k.wert % 1 ? 1 : 0)} % des Kontos` : euro(k.wert);
    const wann = s.ereignisse.length
      ? `nach der Veröffentlichung, wenn gilt: ${esc(und([...s.ereignisse.map((x) => K.FAKTEN.ereignis.satz(x.f)), ...bed]))}`
      : `${s.eroeffnung ? "zur Eröffnung" : "zum Schluss"} ${bed.length ? "des Tages, an dem gilt: " + esc(und(bed)) : "an jedem Handelstag ohne offene Position"}`;
    el.innerHTML = `<b>In Worten:</b> ${s.long ? "Long" : "Short"} ${wann}. Ausstieg ${esc(oder(raus))}.
      Startkapital ${euro(k.start)}, Einsatz ${einsatz} je Trade${s.hebel > 1 ? `, Hebel ${s.hebel}× (Positionswert ${k.art === "prozent" ? `${zahl(k.wert * s.hebel, 0)} % des Kontos` : euro(k.wert * s.hebel)})` : ", ohne Hebel"}.`;
  }
  function geaendert() {
    sichern(); inWorten();
    if (ergebnis && !veraltet) { veraltet = true; $(".bt-report", huelle).classList.add("veraltet"); $(".bt-veraltet", huelle).hidden = false; }
  }
  function neuZeichnen(fokusIdx) {
    const liste = $(".bt-fakten", huelle);
    liste.innerHTML = zustand.fakten.map(faktZeile).join("");
    $(".bt-anzahl", huelle).textContent = `${zustand.fakten.length} von ${K.MAX_FAKTEN}`;
    $("[data-bt-baukasten]", huelle).innerHTML = baukasten();
    if (fokusIdx != null) { const z = $(`[data-idx="${fokusIdx}"] .bt-typ`, liste); if (z) z.focus(); }
    geaendert();
  }
  function fokusBau(sel) { const b = $(sel, huelle); if (b) b.focus({ preventScroll: true }); }
  function meldung(t) { const m = $(".bt-meldung", huelle); m.textContent = t; clearTimeout(meldung.z); meldung.z = setTimeout(() => { m.textContent = ""; }, 6000); }

  function neuerFakt(typ) {
    const f = K.standardFakt(typ);
    if (typ === "kriterium") { const k = katalog(zustand.klasse).find((x) => x.kursbasiert); f.name = k ? k.name : ""; }
    return f;
  }
  function feldGeaendert(e) {
    const t = e.target;
    if (t.dataset.bt === "jahre") {
      zustand.jahre = +t.value;
      t.nextElementSibling.textContent = `${t.value} ${t.value === "1" ? "Jahr" : "Jahre"}`;
      if (e.type === "change") geaendert(); else sichern();
      return;
    }
    if (t.dataset.bt === "wert") {
      if (e.type === "change") {
        zustand.wert = t.value; geaendert();
        $$(".bt-extra", huelle).forEach((c) => c.classList.toggle("an", $("[data-bt-extra]", c).dataset.btExtra === t.value));
      }
      return;
    }
    if (t.dataset.bt === "suche") { if (e.type === "input") suchen(t.value); return; }
    const li = t.closest(".bt-fakt");
    if (!li || !t.dataset.feld) return;
    const i = +li.dataset.idx;
    if (t.dataset.feld === "typ") {
      if (e.type !== "change") return;
      zustand.fakten[i] = neuerFakt(t.value);
      neuZeichnen(i);
      return;
    }
    const zahlig = t.type === "number" || t.type === "range";
    zustand.fakten[i][t.dataset.feld] = zahlig ? (t.value === "" ? K.FAKTEN[zustand.fakten[i].typ].felder.find((d) => d.k === t.dataset.feld).std : +t.value) : t.value;
    if (t.type === "range") { t.nextElementSibling.textContent = `${t.value}×`; if (e.type !== "change") { sichern(); inWorten(); return; } }
    if (e.type === "change" && ((zustand.fakten[i].typ === "ereignis" && ["ind", "vergleich", "masz"].includes(t.dataset.feld))
      || (zustand.fakten[i].typ === "kapital" && t.dataset.feld === "art"))) {
      const fokus = t.dataset.feld;
      neuZeichnen();
      const z = $(`[data-idx="${i}"] [data-feld="${fokus}"]`, huelle); if (z) z.focus();
      return;
    }
    geaendert();
  }
  function klickInForm(e) {
    const t = e.target;
    if (!t.closest(".bt-suche")) { const l = $("#bt-treffer", huelle); if (l) l.hidden = true; }
    const treffer = t.closest("[data-bt-treffer]");
    if (treffer) { const x = suchTreffer[+treffer.dataset.btTreffer]; if (x) trefferWaehlen(x); return; }
    const extraWahl = t.closest("[data-bt-extra]");
    if (extraWahl) {
      const x = zustand.extra.find((v) => v.s === extraWahl.dataset.btExtra);
      if (x) { zustand.klasse = x.t; zustand.wert = x.s; formular(); geaendert(); if (x.fehler) extraLaden(x).then(formular, formular); }
      return;
    }
    const extraWeg = t.closest("[data-bt-extra-weg]");
    if (extraWeg) {
      const s = extraWeg.dataset.btExtraWeg;
      zustand.extra = zustand.extra.filter((v) => v.s !== s);
      daten.werte = daten.werte.filter((w) => !(w.extra && w.s === s));
      delete extraLaeuft[s];
      laborFertig = false;
      if (zustand.wert === s) zustand.wert = "";
      formular(); geaendert();
      return;
    }
    const klasse = t.closest("[data-klasse]");
    if (klasse) {
      zustand.klasse = klasse.dataset.klasse; zustand.wert = "";
      // Kriterien gehören zu einer Klasse: beim Wechsel auf ein passendes Kriterium der neuen Klasse setzen
      zustand.fakten = zustand.fakten.map((f) => (f.typ === "kriterium" && !katalog(zustand.klasse).some((k) => k.name === f.name && k.kursbasiert) ? null : f)).filter(Boolean);
      formular(); geaendert(); $(`[data-klasse="${zustand.klasse}"]`, huelle).focus();
      return;
    }
    if (t.closest("[data-bt-weg]")) {
      const i = +t.closest(".bt-fakt").dataset.idx;
      zustand.fakten.splice(i, 1);
      neuZeichnen(); return;
    }
    const bau = t.closest("[data-bt-bau]");
    if (bau && !bau.disabled) {
      const typ = bau.dataset.btBau, d = K.FAKTEN[typ];
      const da = zustand.fakten.findIndex((f) => f.typ === typ);
      if (d.einmal && da >= 0) { zustand.fakten.splice(da, 1); neuZeichnen(); fokusBau(`[data-bt-bau="${typ}"]`); return; }
      if (zustand.fakten.length >= K.MAX_FAKTEN) return;
      zustand.fakten.push(neuerFakt(typ));
      neuZeichnen(); fokusBau(`[data-bt-bau="${typ}"]`);
      const neu = $(`[data-idx="${zustand.fakten.length - 1}"]`, huelle);
      if (neu) { neu.classList.add("neu"); neu.scrollIntoView({ block: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); }
      return;
    }
    const sig = t.closest("[data-bt-signal]");
    if (sig && !sig.disabled) {
      const name = sig.dataset.btSignal;
      const da = zustand.fakten.findIndex((f) => f.typ === "kriterium" && f.name === name);
      if (da >= 0) zustand.fakten.splice(da, 1);
      else if (zustand.fakten.length < K.MAX_FAKTEN) zustand.fakten.push({ typ: "kriterium", name, soll: "ja" });
      neuZeichnen(); fokusBau(`[data-bt-signal="${CSS.escape(name)}"]`);
      return;
    }
    const beispiel = t.closest("[data-bt-beispiel]");
    if (beispiel) {
      const cpi = beispiel.dataset.btBeispiel === "cpi";
      zustand.fakten = (cpi ? BEISPIEL_CPI : BEISPIEL).map((f) => ({ ...f }));
      zustand.setup = null;
      const klasse = cpi ? "forex" : "aktie";
      if (werteDerKlasse(klasse).length) {
        zustand.klasse = klasse;
        zustand.wert = cpi && werteDerKlasse("forex").some((w) => w.s === "EURUSD=X") ? "EURUSD=X" : "";
      }
      formular(); geaendert();
      meldung(cpi ? "Beispiel: US-Inflation mindestens 0,1 Prozentpunkte über der Prognose → eine Minute nach 8:30 Uhr New York EUR/USD short (Dollar long), Hebel 20, Ziel +3 % und Stop −2 % auf den Einsatz, spätestens nach 4 Stunden raus."
        : "Beispiel: nach besseren Zahlen am Montag zur Eröffnung long, 2 % Take-Profit, spätestens nach zehn Tagen raus.");
      return;
    }
    if (t.closest("[data-bt-leeren]")) { zustand.fakten = []; neuZeichnen(); return; }
    if (t.closest("[data-bt-kriterien]")) {
      const a = window.WBRegeln && window.WBRegeln.auswahl ? window.WBRegeln.auswahl(zustand.klasse) : (SPEZ.auswahl[zustand.klasse] || { zaehlt: [], pflicht: [] });
      const namen = [...a.pflicht, ...a.zaehlt];
      const kat = katalog(zustand.klasse);
      const nutzbar = namen.filter((n) => (kat.find((k) => k.name === n) || {}).kursbasiert);
      const ohne = namen.filter((n) => !nutzbar.includes(n));
      zustand.fakten = zustand.fakten.filter((f) => f.typ !== "kriterium");
      const platz = K.MAX_FAKTEN - zustand.fakten.length;
      nutzbar.slice(0, platz).reverse().forEach((n) => zustand.fakten.unshift({ typ: "kriterium", name: n, soll: "ja" }));
      neuZeichnen();
      meldung(nutzbar.length ? `${nutzbar.length} ${nutzbar.length === 1 ? "Signal" : "Signale"} übernommen${ohne.length ? `. Ohne Kurshistorie und daher nicht testbar: ${ohne.join(", ")}` : ""}.`
        : `Keines deiner gewählten Signale lässt sich zurückrechnen (${ohne.join(", ")}): Dafür fehlen historische Quartals- und Analystendaten.`);
    }
  }

  /* ================================================================ Rechnen */
  function starten(scrollen) {
    const knopf = $(".bt-los", huelle);
    knopf.disabled = true;
    const extra = zustand.extra.find((e) => e.s === zustand.wert && e.t === zustand.klasse);
    let werte = [];
    const bereit = extra ? (knopf.textContent = `Lädt ${extra.n} …`, extraLaden(extra)) : Promise.resolve();
    bereit.then(() => {
      werte = zustand.wert ? daten.werte.filter((w) => w.s === zustand.wert && w.typ === zustand.klasse && !!w.extra === !!extra) : werteDerKlasse(zustand.klasse);
      const fehlen = werte.filter((w) => w.iUrl && !w.std && !w.iFehler);
      knopf.textContent = fehlen.length ? `Lädt Stunden- und Minutenkerzen (${fehlen.length} ${fehlen.length === 1 ? "Wert" : "Werte"}) …` : "Rechnet …";
      return intradayLaden(werte);
    }).then(() => { knopf.textContent = "Rechnet …"; setTimeout(rechnen, 20); })
      .catch((err) => { formular(); sucheMelden(err.message); });
    function rechnen() {
      const ausgelassen = zustand.fakten.filter((f) => { const d = K.FAKTEN[f.typ]; return d && d.nur && !d.nur.includes(zustand.klasse); });
      try {
        ergebnis = werte.length ? K.rechne(werte, aktiveFakten(), { jahre: zustand.jahre, katalog: katalog(zustand.klasse), params: schwellen(zustand.klasse), ereignisse: daten.ereignisse }) : null;
        if (ergebnis) {
          ergebnis.werteAnzahl = werte.length;
          ergebnis.kurveN = Float64Array.from(ergebnis.kurve, (x) => x / ergebnis.start);
          ergebnis.werte = werte;
          ergebnis.wirtschaft = daten.ereignisse;
          ergebnis.titel = zustand.wert ? werte[0].name : `${werte.length} ${(KLASSEN.find((k) => k[0] === zustand.klasse) || [])[1]}`;
          ergebnis.jahreGewaehlt = zustand.jahre;
          ausgelassen.forEach(() => ergebnis.s.annahmen.push("Quartalszahlen gibt es nur bei Aktien: dieser Fakt wurde ausgelassen."));
        }
      } catch (err) { ergebnis = null; console.error(err); }
      veraltet = false;
      knopf.disabled = false; knopf.textContent = "Backtest starten";
      $(".bt-veraltet", huelle).hidden = true;
      $(".bt-report", huelle).classList.remove("veraltet");
      report();
      if (scrollen && window.matchMedia("(max-width: 960px)").matches) $(".bt-report", huelle).scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  /* ================================================================ Report */
  // Kurzfassung des letzten Laufs für das Widget in der Leiste links (assets/dock.js)
  function letztesMerken(r, k, endkapital) {
    const n = r.kurve.length, schritt = Math.max(1, Math.floor(n / 48)), kurve = [];
    for (let i = 0; i < n; i += schritt) kurve.push(Math.round(r.kurve[i]));
    kurve.push(Math.round(endkapital));
    schreib("fathom.backtest.letzt", JSON.stringify({ titel: r.titel, von: r.von, bis: r.bis, start: r.start, ende: endkapital, n: k.n, quote: k.quote, kurve, zeit: Date.now() }));
    document.dispatchEvent(new CustomEvent("wb:backtest"));
  }
  function report() {
    const el = $(".bt-report", huelle);
    if (!ergebnis) { el.innerHTML = '<p class="bt-fehler">Für diese Auswahl gibt es keine Kursdaten.</p>'; return; }
    const r = ergebnis, k = r.kennzahlen, s = r.s;
    if (!k.n) {
      el.innerHTML = `<div class="bt-leer"><p class="bt-zeile">Ergebnis · ${esc(r.titel)} · ${datumDE(r.von)} bis ${datumDE(r.bis)}</p>
        <p class="bt-satz">Kein einziger Trade.</p>
        <p class="klein">In diesem Zeitraum waren nie alle Fakten gleichzeitig erfüllt. Lockere eine Schwelle, entferne einen Fakt oder wähle mehr Werte.</p>
        ${r.ohneZahlen.length ? `<p class="klein">Ohne Zahlen-Historie: ${esc(r.ohneZahlen.join(", "))}.</p>` : ""}
        ${beitragBlock(r)}${grenzen(r)}</div>`;
      return;
    }
    const endkapital = r.kurve[r.kurve.length - 1], gewinn = endkapital - r.start;
    letztesMerken(r, k, endkapital);
    const satz = `${nf(0).format(k.n)}\u00a0${k.n === 1 ? "Trade" : "Trades"}, ${pct(k.quote, 0, false)} Gewinner, <span class="bt-satz-schluss">aus ${euro(r.start, 0)} wurden <span class="${ton(gewinn)}">${euro(endkapital, 0)}</span>.</span>`;
    const mitZeit = k.aufl.min + k.aufl.std > 0;
    const zufall = k.t == null ? "" : Math.abs(k.t) >= 2
      ? `Der Durchschnitt liegt ${nf(1).format(Math.abs(k.t))} Standardfehler von null entfernt: eher kein Zufall (Faustregel ab 2).`
      : `t-Wert ${minus(nf(1).format(k.t))}: Vom Zufall ist das nicht sicher zu unterscheiden (Faustregel: erst ab 2).`;
    el.innerHTML = `
      <div class="bt-ergebnis">
        <p class="bt-zeile">Ergebnis · ${esc(r.titel)} · ${datumDE(r.von)} bis ${datumDE(r.bis)}</p>
        <p class="bt-satz">${satz}</p>
        <p class="bt-zufall klein">${zufall}${k.n < 30 ? ` Mit ${k.n} Trades ist die Stichprobe klein.` : ""}</p>
        <div class="bt-aktionen">
          <button type="button" class="knopf" data-bt-csv><svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M12 4v11m-5-5 5 5 5-5M5 20h14"/></svg>Trades als CSV</button>
          <button type="button" class="knopf" data-bt-drucken>Report drucken</button>
          ${window.WBSetupLab ? '<button type="button" class="knopf" data-bt-setup><svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M6 4h12v16l-6-4-6 4z"/></svg>Als Setup speichern</button>' : ""}
        </div>
      </div>
      ${r.ruin != null ? `<p class="bt-ruin">Konto aufgebraucht am ${datumDE(r.ruin)}. Danach wurden keine Trades mehr eröffnet.</p>` : ""}
      <dl class="bt-kacheln">
        ${kachel("Gewinn oder Verlust", euroVz(gewinn, 0), tonE(gewinn), `${pct(r.depot.gesamt, 1)} gesamt · ${pct(r.depot.jaehrlich, 1)} pro Jahr`)}
        ${kachel("Größter Rückgang", pct(r.depot.rueckgang.max, 1), r.depot.rueckgang.max < 0 ? "minus" : "", r.depot.rueckgang.max < 0 ? `${datumDE(r.depot.rueckgang.von)} bis ${datumDE(r.depot.rueckgang.bis)}` : "kein Rückgang")}
        ${kachel("Trefferquote", pct(k.quote, 0, false), "", `Ø Gewinn ${pct(k.mittelGewinn, 1)} · Ø Verlust ${pct(k.mittelVerlust, 1)} auf den Einsatz`)}
        ${kachel("Profit-Faktor", k.faktor == null ? "nur Gewinne" : zahl(k.faktor, 2), "", "Summe Gewinne ÷ Summe Verluste")}
        ${kachel("Ø Trade auf den Einsatz", pct(k.mittel, 2), ton(k.mittel), `Median ${pct(k.median, 2)} · Ø Kursbewegung ${pct(k.kurs, 3)}`)}
        ${kachel("Ø Haltedauer", dauerText(k.dauer), "", `bester ${pct(k.bester, 1)} · schlechtester ${pct(k.schlechtester, 1)}`)}
        ${kachel("Kosten und Finanzierung", euroVz(-(k.kostenEuro + k.finanzEuro), 0), tonE(-(k.kostenEuro + k.finanzEuro)), `Kommission ${euro(k.kostenEuro, 0)} · über Nacht ${euro(k.finanzEuro, 0)}${(r.werte || []).some((w) => w.sp) ? " · Spread im Kurs" : ""}`)}
        ${kachel("Hebel", `${s.hebel}×`, "", s.hebel > 1 ? `${k.gruende.zwang} Zwangsschließungen · EU-Grenze ${r.grenze}:1` : `Zeit im Markt ${pct(r.exposition, 0, false)}`)}
      </dl>
      <section class="bt-block">
        <div class="bt-block-kopf"><h3>Depotverlauf</h3>
          <p class="bt-legende"><i class="l-strategie"></i>Konto mit Strategie <i class="l-markt"></i>Kaufen und Halten ohne Hebel${r.werteAnzahl > 1 ? ", alle Werte gleich gewichtet" : ""}</p></div>
        <div class="bt-kurve" data-bt-kurve></div>
        <table class="bt-vergleich">
          <thead><tr><th></th><th>Strategie</th><th>Kaufen und Halten</th></tr></thead>
          <tbody>
            ${vergleichsZeile("Gesamt", r.depot.gesamt, r.markt.gesamt)}
            ${vergleichsZeile("Pro Jahr", r.depot.jaehrlich, r.markt.jaehrlich)}
            ${vergleichsZeile("Größter Rückgang", r.depot.rueckgang.max, r.markt.rueckgang.max)}
            <tr><td>Schwankung pro Jahr</td><td>${pct(r.depot.vola, 1, false)}</td><td>${pct(r.markt.vola, 1, false)}</td></tr>
            <tr><td>Sharpe-Quote</td><td>${zahl(r.depot.sharpe, 2)}</td><td>${zahl(r.markt.sharpe, 2)}</td></tr>
            <tr><td>Endstand</td><td>${euro(endkapital, 0)}</td><td>${euro(r.start * r.vergleich[r.vergleich.length - 1], 0)}</td></tr>
          </tbody>
        </table>
        <p class="klein bt-erklaerung">Je Trade setzt das Konto ${s.kapital.art === "prozent" ? `${zahl(s.kapital.wert, 0)} % seines aktuellen Werts` : euro(s.kapital.wert, 0)} als Einsatz ein${s.hebel > 1 ? `, mit Hebel ${s.hebel}× also einen Positionswert vom ${s.hebel}-Fachen` : ""}. Der Rest liegt unverzinst.
          Kaufen und Halten ist immer voll investiert und ohne Hebel. Vergleiche deshalb auch die Rendite je Trade, nicht nur die Kurven.</p>
      </section>
      <div class="bt-zwei">
        <section class="bt-block">
          <div class="bt-block-kopf"><h3>Wie die Trades endeten</h3></div>
          ${ausstiege(k)}
        </section>
        <section class="bt-block">
          <div class="bt-block-kopf"><h3>Verteilung der Trade-Renditen</h3></div>
          <div class="bt-histogramm" data-bt-histogramm></div>
        </section>
      </div>
      ${beitragBlock(r)}
      <section class="bt-block">
        <div class="bt-block-kopf"><h3>Jahr für Jahr</h3></div>
        <div class="tabelle-rahmen"><table class="bt-tabelle">
          <thead><tr><th>Jahr</th><th>Trades</th><th>Gewinner</th><th>Konto</th><th>in Euro</th><th>Kaufen und Halten</th></tr></thead>
          <tbody>${r.jahre.map((j) => `<tr><td>${j.jahr}${j.teil ? '<span class="unter">Teiljahr</span>' : ""}</td><td>${j.n}</td><td>${j.quote == null ? "–" : pct(j.quote, 0, false)}</td>
            <td class="${ton(j.strategie)}">${pct(j.strategie, 1)}</td><td class="${tonE(j.euro)}">${euroVz(j.euro, 0)}</td><td class="${ton(j.vergleich)}">${pct(j.vergleich, 1)}</td></tr>`).join("")}</tbody>
        </table></div>
      </section>
      ${r.jeWert.length > 1 ? `<section class="bt-block">
        <div class="bt-block-kopf"><h3>Je Wert</h3></div>
        <div class="tabelle-rahmen"><table class="bt-tabelle">
          <thead><tr><th>Wert</th><th>Trades</th><th>Gewinner</th><th>Ø Trade</th><th>in Euro</th></tr></thead>
          <tbody>${r.jeWert.map((w) => `<tr><td>${esc(w.name)}${!w.zahlen && s.bedingungen.some((b) => b.f.typ === "zahlen") ? '<span class="unter">keine Zahlen-Historie</span>' : ""}</td>
            <td>${w.n}</td><td>${w.n ? pct(w.quote, 0, false) : "–"}</td><td class="${ton(w.mittel)}">${w.n ? pct(w.mittel, 2) : "–"}</td><td class="${tonE(w.euro)}">${w.n ? euroVz(w.euro, 0) : "–"}</td></tr>`).join("")}</tbody>
        </table></div>
      </section>` : ""}
      <section class="bt-block">
        <div class="bt-block-kopf"><h3>Trades</h3><p class="klein">neueste zuerst</p></div>
        <div class="tabelle-rahmen"><table class="bt-tabelle bt-trades">
          <thead><tr><th>Einstieg</th><th>Wert</th><th>Kurs</th><th>Ausstieg</th><th>Kurs</th><th>Grund</th><th>Dauer</th><th>Einsatz</th><th>Ergebnis</th></tr></thead>
          <tbody>${tradeZeilen(r.trades.slice(-25).reverse())}</tbody>
        </table></div>
        ${r.trades.length > 25 ? `<button type="button" class="knopf-text" data-bt-alle>Alle ${nf(0).format(r.trades.length)} Trades zeigen</button>` : ""}
      </section>
      ${qualitaet(r)}
      ${grenzen(r)}`;
    kurveZeichnen();
    histogramm();
  }
  const kachel = (titel, wert, klasse, unter) => `<div><dt>${titel}</dt><dd class="${klasse}">${wert}</dd><dd class="unter">${unter}</dd></div>`;
  const vergleichsZeile = (titel, a, b) => `<tr><td>${titel}</td><td class="${ton(a)}">${pct(a, 1)}</td><td class="${ton(b)}">${pct(b, 1)}</td></tr>`;
  const terminText = (e) => {
    const w = (x) => (x == null ? "–" : `${minus(nf(e.einheit === "Tsd." ? 0 : 1).format(x))}${e.einheit === "%" ? "\u00a0%" : "\u00a0Tsd."}`);
    return `${esc(e.kurz)} ${w(e.ist)} (Prognose ${w(e.prog)}, vorher ${w(e.vor)})`;
  };
  function tradeZeilen(ts) {
    return ts.map((t) => {
      const fein = t.fein.min + t.fein.std > 0;
      const dez = Math.max(2, window.WBH.kursStellen(t.w, 5));
      const info = t.zahlen ? `<span class="unter">Zahlen ${t.zahlen.d.split("-").reverse().join(".")}${t.zahlen.u != null ? ", " + pct(t.zahlen.u, 1) + " ggü. Schätzung" : ""}</span>`
        : t.termin ? `<span class="unter">${terminText(t.termin)}</span>` : "";
      const grund = GRUND[t.grund] + (t.luecke ? '<span class="unter">Kurslücke</span>' : t.beide ? `<span class="unter">Ziel und Stop in derselben ${t.aufl === "min" ? "Minute" : t.aufl === "std" ? "Stunde" : "Tageskerze"}</span>` : "")
        + (t.ungenau ? '<span class="unter">ohne Minutenkerzen</span>' : "");
      return `<tr><td>${datumZeit(t.einMin, fein)}<span class="unter">${t.dir > 0 ? "Long" : "Short"}</span></td><td>${esc(t.w.name)}${info}</td><td>${zahl(t.ein, dez)}</td>
        <td>${datumZeit(t.ausMin, fein)}</td><td>${zahl(t.aus, dez)}</td><td>${grund}</td>
        <td>${dauerText((t.ausMin - t.einMin) / 1440)}</td><td>${euro(t.betrag, 0)}</td><td class="${ton(t.netto)}">${euroVz(t.euro, 2)}<span class="unter">${pct(t.netto, 1)}</span></td></tr>`;
    }).join("");
  }
  function ausstiege(k) {
    const teile = [["ziel", "Take-Profit"], ["stop", "Stop"], ["zwang", "Zwangsschließung"], ["zeit", "Haltedauer abgelaufen"], ["offen", "noch offen"]].filter(([g]) => k.gruende[g]);
    return `<div class="bt-anteile" role="img" aria-label="${teile.map(([g, t]) => `${t}: ${k.gruende[g]}`).join(", ")}">${teile.map(([g]) =>
      `<span class="a-${g}" style="flex-grow:${k.gruende[g]}"></span>`).join("")}</div>
      <ul class="bt-anteil-liste">${teile.map(([g, t]) => `<li><i class="a-${g}"></i>${t}<b>${k.gruende[g]}</b><span>${pct(k.gruende[g] / k.n, 0, false)}</span></li>`).join("")}</ul>
      ${k.luecken || k.beide ? `<p class="klein">${k.luecken ? `${k.luecken}× über eine Kurslücke zur Eröffnung ausgeführt. ` : ""}${k.beide ? `${k.beide}× lagen Ziel und Stop in derselben Kerze: gewertet als Stop.` : ""}</p>` : ""}
      <p class="klein">Ausstieg geprüft auf ${[["min", "Minuten"], ["std", "Stunden"], ["tag", "Tageskerzen"]].filter(([a]) => k.aufl[a]).map(([a, t]) => `${t} (${k.aufl[a]})`).join(", ")}.</p>`;
  }
  function beitragBlock(r) {
    if (!r.beitrag.length) return "";
    const k = r.kennzahlen;
    return `<section class="bt-block">
      <div class="bt-block-kopf"><h3>Was jeder Fakt beiträgt</h3><p class="klein">derselbe Test, jeweils ohne diesen einen Fakt</p></div>
      <div class="tabelle-rahmen"><table class="bt-tabelle">
        <thead><tr><th>Fakt</th><th>Trades ohne ihn</th><th>Gewinner</th><th>Ø Trade</th></tr></thead>
        <tbody><tr class="bt-alle"><td>Alle Fakten zusammen</td><td>${nf(0).format(k.n || 0)}</td><td>${k.n ? pct(k.quote, 0, false) : "–"}</td><td class="${ton(k.mittel)}">${k.n ? pct(k.mittel, 2) : "–"}</td></tr>
        ${r.beitrag.map((b) => `<tr><td>${esc(K.FAKTEN[b.f.typ].satz(b.f))}</td><td>${nf(0).format(b.n)}</td><td>${b.n ? pct(b.quote, 0, false) : "–"}</td>
          <td class="${ton(b.mittel)}">${b.n ? pct(b.mittel, 2) : "–"}</td></tr>`).join("")}</tbody>
      </table></div>
      <p class="klein bt-erklaerung">Wird der Ø Trade ohne einen Fakt schlechter, trägt dieser Fakt zum Ergebnis bei. Bleibt er gleich, filtert der Fakt nur Trades weg.</p>
    </section>`;
  }
  function qualitaet(r) {
    const werte = r.werte || [];
    if (!werte.length) return "";
    const inds = r.s.ereignisse.map((x) => x.ind);
    const zeilen = werte.map((w) => {
      const p = w.pr || {}, a = p.abgleich;
      const aufl = w.std ? `Minute um Termine${w.min && w.min.size ? ` (${w.min.size})` : ""}, Stunde, Tag` : w.iFehler ? "Tag (Intraday nicht ladbar)" : w.iUrl ? "Tag" : "Tag";
      const abgleich = a ? `${a.gleichlauf != null ? `Gleichlauf ${zahl(a.gleichlauf, 3)}` : ""}${a.median != null ? ` · Ø Abweichung ${pct(a.median, 2, false)}` : ""}<span class="unter">gegen ${esc(a.quelle)}, ${a.ueber_1pct} Tage über 1 %</span>` : "kein Abgleich";
      return `<tr><td>${esc(w.name)}<span class="unter">${esc(w.quelle || p.quelle || "")}</span></td><td>${aufl}${w.sp ? '<span class="unter">mit Geld- und Briefkurs</span>' : ""}</td>
        <td>${p.von ? `${p.von.split("-").reverse().join(".")} – ${p.bis.split("-").reverse().join(".")}` : "–"}<span class="unter">${p.tage || w.n} Tage, längste Lücke ${p.laengste_luecke != null ? p.laengste_luecke : "–"} Tage</span></td>
        <td>${abgleich}</td><td>${p.ausreisser && p.ausreisser.length ? `${p.ausreisser.length} Verdachtsfälle<span class="unter">${p.ausreisser.slice(0, 3).map((d) => d.split("-").reverse().join(".")).join(", ")}</span>` : "keine"}</td></tr>`;
    }).join("");
    return `<section class="bt-block">
      <div class="bt-block-kopf"><h3>Datenqualität</h3><p class="klein">Quelle, Auflösung und Abgleich mit einer zweiten Quelle</p></div>
      <div class="tabelle-rahmen"><table class="bt-tabelle bt-daten">
        <thead><tr><th>Wert</th><th>Auflösung</th><th>Zeitraum</th><th>Abgleich</th><th>Ausreißer</th></tr></thead>
        <tbody>${zeilen}</tbody>
      </table></div>
      ${inds.length ? `<p class="klein bt-erklaerung">${inds.map((i) => `<b>${esc(i.name)}:</b> ${i.termine.length} Termine, Ist-Werte aus ${esc(i.quelle)}, Uhrzeit ${esc(i.uhrzeit)}; Prognosen ${i.prognose_quelle ? `von ${esc(i.prognose_quelle)} (${i.termine.filter((e) => e.prog != null).length} Termine)` : "nicht verfügbar"}.`).join(" ")}</p>` : ""}
      <p class="klein bt-erklaerung">Ausreißer: Tagesbewegungen über 25 %, die die zweite Quelle nicht bestätigt. Gleichlauf: Korrelation der Tagesrenditen beider Quellen (1 = identisch). Bei Forex und CFDs schließen die Quellen zu verschiedenen Uhrzeiten, kleine Abweichungen sind dort normal.</p>
    </section>`;
  }
  function grenzen(r) {
    const fein = (r.werte || []).some((w) => w.std), s = r.s;
    const punkte = [
      fein ? "Ausstiege werden Kerze für Kerze geprüft: um Wirtschaftsdaten minutengenau (5 Minuten vor bis mindestens 4 Stunden danach), sonst auf Stundenkerzen, vor Beginn der Stundendaten auf Tageskerzen."
        : "Tageskurse: Einstieg zur Eröffnung oder zum Schluss. Bei US-Aktien ist das die New-York-Session (15:30 bis 22:00 Uhr deutscher Zeit). Feinere Zeitpunkte brauchen Minutendaten (für Forex, Rohstoffe und Indizes mit OANDA-Zugang).",
      "Treffen Ziel und Stop in derselben Kerze, zählt der Stop. Öffnet der Kurs jenseits einer Marke, wird zur Eröffnung ausgeführt.",
      (r.werte || []).some((w) => w.sp) ? "Geld- und Briefkurse: Long kauft zum Brief- und verkauft zum Geldkurs, Short umgekehrt. Der Spread steckt damit in jedem Trade, auch ausgeweitete Spreads um Termine." : "Ohne Geld- und Briefkurse: Spread und Kommission stecken in der Kostenangabe je Kauf und Verkauf.",
      "Kein Blick in die Zukunft: Beim Einstieg zur Eröffnung zählen Kurse bis zum Vortagesschluss und Zahlen, die vor Börsenbeginn gemeldet wurden. Wirtschaftsdaten zählen ab der Minute der Veröffentlichung; der Einstieg kommt frühestens eine Minute danach.",
      s.hebel > 1 ? `Hebel ${s.hebel}×: Ergebnis auf den Einsatz = ${s.hebel} × Kursbewegung. Zwangsschließung bei ${nf(0).format(s.zwang * 100)} % Verlust des Einsatzes, Finanzierung ${minus(nf(2).format(s.zins * 100))} % p. a. auf den geliehenen Teil je Nacht. Kurslücken können mehr als den Einsatz kosten; das Konto fällt dabei nicht unter null (EU-Nachschussverbot für Privatkunden).` : "",
      "Fathom-Signale mit Quartals- oder Analystendaten lassen sich nicht zurückrechnen. Die kursbasierten Signale brauchen ein Jahr Vorlauf.",
      "Nur Werte, die heute auf der Watchlist stehen (Survivorship Bias). Ohne Steuern. Gewinne und Verluste in Fremdwährung sind wie Euro gerechnet.",
      ...r.s.annahmen,
      ...(r.ohneZahlen.length ? [`Ohne Zahlen-Historie, daher ohne Trades: ${r.ohneZahlen.join(", ")}.`] : []),
      ...(r.nurSchluss.length ? [`Nur Schlusskurse verfügbar (Eröffnung, Hoch und Tief fehlen): ${r.nurSchluss.join(", ")}.`] : []),
      ...(r.ohneMinuten.length ? [`Ohne Minutenkerzen (kein OANDA-Zugang oder nicht veröffentlicht), Einstieg daher zur nächsten Stunde bzw. Börseneröffnung: ${r.ohneMinuten.join(", ")}.`] : []),
    ].filter(Boolean);
    return `<section class="bt-block bt-grenzen"><div class="bt-block-kopf"><h3>Annahmen und Grenzen</h3></div>
      <ul>${punkte.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>
      <p class="klein">Ein Backtest zeigt, wie sich Regeln in der Vergangenheit verhalten hätten. Er ist keine Prognose und keine Anlageberatung.</p></section>`;
  }

  /* ---------------------------------------------------------------- Diagramme (SVG, Breite aus dem Layout) */
  function kurveZeichnen() {
    const box = $("[data-bt-kurve]", huelle);
    if (!box || !ergebnis) return;
    const r = ergebnis, B = Math.max(280, box.clientWidth), H = B < 520 ? 220 : 300, HD = 64, L = 46, R = 8, O = 12, U = 22;
    const n = r.tage.length, schritt = Math.max(1, Math.floor(n / 700));
    const idx = []; for (let k = 0; k < n; k += schritt) idx.push(k); if (idx[idx.length - 1] !== n - 1) idx.push(n - 1);
    const kurve = r.kurveN;
    const werte = [...idx.map((k) => kurve[k]), ...idx.map((k) => r.vergleich[k])];
    let lo = Math.min(...werte) - 1, hi = Math.max(...werte) - 1;
    const rand = (hi - lo) * 0.08 || 0.01; lo -= rand; hi += rand;
    const x = (k) => L + ((r.tage[k] - r.tage[0]) / Math.max(1, r.tage[n - 1] - r.tage[0])) * (B - L - R);
    const y = (v) => O + (1 - (v - 1 - lo) / (hi - lo)) * (H - O - U);
    const linie = (reihe) => idx.map((k, j) => `${j ? "L" : "M"}${x(k).toFixed(1)},${y(reihe[k]).toFixed(1)}`).join("");
    // Rückgang der Strategie
    const dd = []; let spitze = kurve[0];
    idx.forEach((k) => { spitze = Math.max(spitze, ...Array.from(kurve.slice(Math.max(0, k - schritt + 1), k + 1))); dd.push(spitze > 0 ? kurve[k] / spitze - 1 : 0); });
    const ddMin = Math.min(-0.01, ...dd);
    const yd = (v) => H + 10 + (v / ddMin) * (HD - 14);
    const ticks = schoeneTicks(lo, hi, 5);
    const jahre = []; for (let j = K.jahr(r.tage[0]) + 1; j <= K.jahr(r.tage[n - 1]); j++) jahre.push(j);
    const jStep = Math.ceil(jahre.length / Math.max(2, Math.floor((B - L) / 64)));
    const jx = (j) => { const t = Date.UTC(j, 0, 1) / 864e5; return L + ((t - r.tage[0]) / Math.max(1, r.tage[n - 1] - r.tage[0])) * (B - L - R); };
    box.innerHTML = `<svg width="${B}" height="${H + HD + 6}" viewBox="0 0 ${B} ${H + HD + 6}" role="img" aria-label="Depotverlauf der Strategie im Vergleich zu Kaufen und Halten">
      <g class="gitter">${ticks.map((t) => `<line x1="${L}" x2="${B - R}" y1="${y(1 + t)}" y2="${y(1 + t)}"${Math.abs(t) < 1e-9 ? ' class="null"' : ""}/>
        <text x="${L - 8}" y="${y(1 + t) + 4}" text-anchor="end">${minus((t > 0 ? "+" : "") + nf(Math.abs(hi - lo) < 0.1 ? 1 : 0).format(t * 100))} %</text>`).join("")}
        ${jahre.filter((j, i) => i % jStep === 0).map((j) => `<line class="jahr" x1="${jx(j)}" x2="${jx(j)}" y1="${O}" y2="${H - U}"/><text x="${jx(j)}" y="${H - 4}" text-anchor="middle">${j}</text>`).join("")}</g>
      <path class="k-markt" d="${linie(r.vergleich)}"/>
      <path class="k-strategie" d="${linie(kurve)}"/>
      <g class="rueckgang"><text x="${L - 8}" y="${H + 14}" text-anchor="end">0 %</text><text x="${L - 8}" y="${H + HD - 2}" text-anchor="end">${minus(nf(0).format(ddMin * 100))} %</text>
        <path d="M${x(idx[0])},${yd(0)}${idx.map((k, j) => `L${x(k).toFixed(1)},${yd(dd[j]).toFixed(1)}`).join("")}L${x(idx[idx.length - 1])},${yd(0)}Z"/>
        <text class="titel" x="${L + 4}" y="${H + HD - 2}">Rückgang vom Höchststand</text></g>
      <g class="zeiger" hidden><line y1="${O}" y2="${H + HD}"/><circle r="3.5" class="p-strategie"/><circle r="3" class="p-markt"/></g>
    </svg><div class="bt-ablesung" hidden></div>`;
    const svg = $("svg", box), zeiger = $(".zeiger", svg), ablesung = $(".bt-ablesung", box);
    const bewegen = (e) => {
      const rect = svg.getBoundingClientRect(), px = e.clientX - rect.left;
      if (px < L || px > B - R) { zeiger.setAttribute("hidden", ""); ablesung.hidden = true; return; }
      const tag = r.tage[0] + ((px - L) / (B - L - R)) * (r.tage[n - 1] - r.tage[0]);
      let k = 0, a = 0, b = n - 1;
      while (a <= b) { const m = (a + b) >> 1; if (r.tage[m] <= tag) { k = m; a = m + 1; } else b = m - 1; }
      zeiger.removeAttribute("hidden");
      $("line", zeiger).setAttribute("x1", x(k)); $("line", zeiger).setAttribute("x2", x(k));
      const [p1, p2] = $$("circle", zeiger);
      p1.setAttribute("cx", x(k)); p1.setAttribute("cy", y(kurve[k])); p2.setAttribute("cx", x(k)); p2.setAttribute("cy", y(r.vergleich[k]));
      ablesung.hidden = false;
      ablesung.innerHTML = `<b>${datumDE(r.tage[k])}</b><span><i class="l-strategie"></i>Konto ${euro(r.kurve[k], 0)} (${pct(kurve[k] - 1, 1)})</span><span><i class="l-markt"></i>Kaufen und Halten ${pct(r.vergleich[k] - 1, 1)}</span>`;
      ablesung.style.left = `${Math.min(Math.max(x(k) + 12, 0), B - ablesung.offsetWidth)}px`;
    };
    svg.addEventListener("pointermove", bewegen);
    svg.addEventListener("pointerleave", () => { zeiger.setAttribute("hidden", ""); ablesung.hidden = true; });
  }
  function schoeneTicks(lo, hi, anzahl) {
    const roh = (hi - lo) / anzahl, p = Math.pow(10, Math.floor(Math.log10(roh))), f = roh / p;
    const schritt = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p;
    const aus = []; for (let t = Math.ceil(lo / schritt) * schritt; t <= hi + 1e-12; t += schritt) aus.push(Math.abs(t) < 1e-12 ? 0 : t);
    return aus;
  }
  function histogramm() {
    const box = $("[data-bt-histogramm]", huelle), v = ergebnis && ergebnis.verteilung;
    if (!box) return;
    if (!v) { box.innerHTML = '<p class="klein">Zu wenige Trades für eine Verteilung.</p>'; return; }
    const B = Math.max(240, box.clientWidth), H = 150, U = 22, max = Math.max(...v.n), bw = (B - 2) / v.n.length;
    const xv = (r) => 1 + ((r - v.von) / (v.breite * v.n.length)) * (B - 2);
    const marken = schoeneTicks(v.von, v.von + v.breite * v.n.length, 4).filter((t) => xv(t) > 14 && xv(t) < B - 14);
    box.innerHTML = `<svg width="${B}" height="${H}" viewBox="0 0 ${B} ${H}" role="img" aria-label="Verteilung der Trade-Renditen">
      ${v.n.map((n, i) => { const mitte = v.von + (i + 0.5) * v.breite, h = max ? (n / max) * (H - U - 6) : 0;
        return `<rect class="${mitte >= 0 ? "s-plus" : "s-minus"}" x="${(1 + i * bw + 1).toFixed(1)}" y="${(H - U - h).toFixed(1)}" width="${Math.max(1, bw - 2).toFixed(1)}" height="${h.toFixed(1)}"><title>${pct(v.von + i * v.breite, 1)} bis ${pct(v.von + (i + 1) * v.breite, 1)}: ${n} Trades</title></rect>`; }).join("")}
      <line class="achse" x1="0" x2="${B}" y1="${H - U}" y2="${H - U}"/>
      ${v.von < 0 && v.von + v.breite * v.n.length > 0 ? `<line class="null" x1="${xv(0)}" x2="${xv(0)}" y1="4" y2="${H - U}"/>` : ""}
      ${marken.map((t) => `<text x="${xv(t)}" y="${H - 6}" text-anchor="middle">${minus((t > 0 ? "+" : "") + nf(Math.abs(t) < 0.1 ? 1 : 0).format(t * 100))} %</text>`).join("")}
    </svg>`;
  }
  let rz;
  window.addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(() => { if (huelle && !huelle.hidden && ergebnis && ergebnis.kennzahlen.n) { kurveZeichnen(); histogramm(); } }, 120); });

  /* ---------------------------------------------------------------- CSV */
  function csv() {
    if (!ergebnis) return;
    const d = (x, n) => (x == null ? "" : nf(n).format(x).replace(/\./g, ""));
    const iso = (m) => new Date(m * 6e4).toISOString().slice(0, 16).replace("T", " ");
    const zeilen = [["Einstieg (UTC)", "Wert", "Symbol", "Richtung", "Einstiegskurs", "Ausstieg (UTC)", "Ausstiegskurs", "Grund", "Kursbewegung %", "Hebel", "Einsatz €",
      "Ergebnis auf Einsatz %", "Ergebnis €", "Kommission €", "Finanzierung €", "Auflösung", "Auslöser", "Ist", "Prognose", "Vorwert"].join(";")];
    ergebnis.trades.forEach((t) => zeilen.push([iso(t.einMin), t.w.name, t.w.s, t.dir > 0 ? "Long" : "Short", d(t.ein, 6), iso(t.ausMin), d(t.aus, 6), GRUND[t.grund],
      d(t.brutto * 100, 4), ergebnis.s.hebel, d(t.betrag, 2), d(t.netto * 100, 3), d(t.euro, 2), d(t.kostenEuro, 2), d(t.finanzEuro, 2),
      t.fein.min ? "Minute" : t.fein.std ? "Stunde" : "Tag",
      t.zahlen ? `Zahlen ${t.zahlen.d}` : t.termin ? `${t.termin.kurz} ${t.termin.periode}` : "",
      t.zahlen ? d(t.zahlen.ist, 2) : t.termin ? d(t.termin.ist, 2) : "", t.zahlen ? d(t.zahlen.sch, 2) : t.termin ? d(t.termin.prog, 2) : "",
      t.termin ? d(t.termin.vor, 2) : ""].map((x) => `"${String(x).replace(/"/g, '""')}"`).join(";")));
    const blob = new Blob(["﻿" + zeilen.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `fathom-backtest-${K.datum(ergebnis.bis)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // Für Tests, die Vorschau und den Work-Modus (Marktreaktion früherer Termine: dieselben Daten, nur einmal geladen)
  /* ================================================================ Schnittstelle für das Setup Lab (assets/setups.js) */
  const SK = window.WBSetupKern;
  // Ein Fakt in Worten, auch für Fakten ohne eigenen Satz (Richtung, Ziel, Stop …)
  function faktText(f) {
    const d = K.FAKTEN[f && f.typ];
    if (!d) return String((f && f.typ) || "?");
    if (d.satz) { try { return d.satz(f); } catch (e) { return d.titel; } }
    const teile = d.felder.map((x) => {
      const v = f[x.k];
      if (v == null || v === "") return "";
      if (x.opt) { const o = x.opt.find((o) => String(o[0]) === String(v)); return o ? o[1] : String(v); }
      const nach = x.nach && x.nach !== "@einheit" ? ` ${x.nach}` : "";
      return `${x.vor ? x.vor + " " : ""}${zahl(+v, +v % 1 ? 2 : 0)}${nach}`;
    }).filter(Boolean);
    return `${d.titel}${teile.length ? ": " + teile.join(", ") : ""}`;
  }
  function wertName(s, klasse) {
    const klassenName = (KLASSEN.find((k) => k[0] === klasse) || [])[1] || klasse;
    if (!s) return `alle ${klassenName} der Watchlist`;
    const w = daten && daten.werte.find((x) => x.s === s);
    const e = zustand.extra.find((x) => x.s === s);
    return (w && w.name) || (e && e.n) || s;
  }
  // Die zuletzt gerechnete Strategie, wie sie gespeichert würde (nur wenn der Report zu den Regeln passt)
  function setupRegel() {
    if (!daten || !ergebnis || !SK) return null;
    const extra = zustand.extra.find((e) => e.s === zustand.wert && e.t === zustand.klasse) || null;
    const worte = (($(".bt-worte", huelle) || {}).textContent || "").replace(/^\s*In Worten:\s*/, "").replace(/\s+/g, " ").trim();
    return {
      regel: { klasse: zustand.klasse, wert: zustand.wert, extra: extra ? { s: extra.s, n: extra.n, t: extra.t } : null,
               werte: (ergebnis.werte || []).map((w) => w.s), jahre: zustand.jahre, fakten: aktiveFakten().map((f) => ({ ...f })), params: schwellen(zustand.klasse) },
      worte, ergebnis: SK.zusammenfassung(ergebnis), daten: { stand: daten.stand, demo: !!daten.demo },
      frisch: !veraltet, herkunft: zustand.setup, titel: ergebnis.titel,
    };
  }
  // Ein gespeichertes Setup in den Baukasten laden und sofort rechnen
  function setupLaden(regel, herkunft) {
    return datenLaden().then(() => {
      if (regel.extra && !zustand.extra.some((e) => e.s === regel.extra.s)) zustand.extra = zustand.extra.concat({ ...regel.extra }).slice(-30);
      Object.assign(zustand, { klasse: regel.klasse, wert: regel.wert, jahre: regel.jahre, fakten: regel.fakten.map((f) => ({ ...f })), setup: herkunft || null });
      sichern();
      const ext = regel.extra && zustand.extra.find((e) => e.s === regel.extra.s);
      return (ext ? extraLaden(ext).catch(() => null) : Promise.resolve()).then(() => {
        modusSetzen("fakten"); formular(); starten(false);
        const nutzt = regel.fakten.some((f) => f.typ === "kriterium");
        return { schwellenAnders: nutzt && SK.stabil(SK.pruefeRegel(regel).params) !== SK.stabil(SK.pruefeRegel(Object.assign({}, regel, { params: schwellen(regel.klasse) })).params),
                 wertFehlt: !!regel.wert && zustand.wert !== regel.wert };
      });
    });
  }
  // Bewährungsprobe: gespeicherte Regeln auf den heutigen Daten, ab dem ersten Tag des gespeicherten Backtests.
  // Nur der Hauptlauf (ohne die teure Rechnung „was jeder Fakt beiträgt“); eine Probe zur Zeit.
  let probeLaeuft = null;
  function setupPruefen(regel, vonTag) {
    if (probeLaeuft) return Promise.reject(new Error("Es läuft schon eine Prüfung."));
    const fehlend = [];
    probeLaeuft = datenLaden().then(() => {
      if (!regel.extra) return null;
      const ext = zustand.extra.find((e) => e.s === regel.extra.s) || { ...regel.extra };
      return extraLaden(ext);
    }).then(() => {
      let werte;
      if (regel.wert) {
        werte = daten.werte.filter((w) => w.s === regel.wert && w.typ === regel.klasse && !!w.extra === !!regel.extra);
        if (!werte.length) fehlend.push(regel.wert);
      } else {
        const alle = werteDerKlasse(regel.klasse);
        werte = regel.werte.length ? alle.filter((w) => regel.werte.includes(w.s)) : alle;
        regel.werte.forEach((s) => { if (!alle.some((w) => w.s === s)) fehlend.push(s); });
      }
      if (!werte.length) throw new Error("Für dieses Setup gibt es in den heutigen Daten keine Kurse mehr.");
      return intradayLaden(werte).then(() => new Promise((ok) => setTimeout(() => ok(werte), 20)));
    }).then((werte) => {
      const s = K.strategie(regel.fakten, katalog(regel.klasse), regel.params, daten.ereignisse);
      const ende = Math.max(...werte.map((w) => w.tag[w.n - 1])), anfang = Math.min(...werte.map((w) => w.tag[0]));
      const r = K.lauf(werte, s, SK.jahreAb(vonTag, ende) || regel.jahre);
      return { trades: r.trades, ruin: r.ruin, ende, anfang, annahmen: s.annahmen, fehlend, demo: !!daten.demo, stand: daten.stand };
    }).finally(() => { probeLaeuft = null; });
    return probeLaeuft;
  }

  window.WBBacktest = { oeffnen, schliessen, zustand: () => zustand, ergebnis: () => ergebnis, datenLaden, intradayLaden, suche: sucheNach, TYPNAME,
    setupRegel, setupLaden, setupPruefen, faktText, wertName, modusSetzen: (m) => { if (huelle) modusSetzen(m); },
    hinweis: (t) => { if (huelle) meldung(t); },
    datenStand: () => (daten ? { stand: daten.stand, demo: !!daten.demo } : null),
    // Einen Wert außerhalb der Watchlist laden (Katalog oder lokaler Server), z. B. für eine gespeicherte Chart-Taktik
    wertBereit: (e) => datenLaden().then(() => {
      if (daten.werte.some((w) => w.s === e.s)) return null;
      let x = zustand.extra.find((v) => v.s === e.s);
      if (!x) { x = { s: e.s, n: String(e.n || e.s).slice(0, 80), t: KLASSEN.some(([t]) => t === e.t) ? e.t : "aktie" }; zustand.extra = zustand.extra.concat(x).slice(-30); sichern(); }
      return extraLaden(x);
    }),
    vergessen: (id) => { if (zustand.setup && zustand.setup.id === id) { zustand.setup = null; sichern(); } },
    herkunftSetzen: (h) => { zustand.setup = h; sichern(); } };
})();
