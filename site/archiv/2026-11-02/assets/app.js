/* Fathom: Analyse-Panel, Live-Kurse, hell/dunkel.
 *
 * Panel: Klick auf eine Zeile öffnet die Analyse rechts als Panel (Adresse #kürzel,
 * dadurch funktionieren Zurück-Taste und direkte Links). Esc oder "Schließen" beendet es.
 *
 * Live: Zwei Quellen, beide optional.
 *   1. Lokaler Live-Server (python live.py): alle Werte über Yahoo Finance, alle 30 s.
 *   2. Finnhub (eigener kostenloser Schlüssel, nur im Browser gespeichert): Echtzeit-Trades für US-Aktien.
 * Aus jedem neuen Kurs werden Tagesveränderung, Abstand zum Hoch, Kursziel-Abstand,
 * Forward-KGV und die Signale neu berechnet.
 */
(function () {
  "use strict";
  const { $, $$, nf, lies, schreib, esc, pct, istDunkel } = window.WBH;
  const uhr = (ms, sek) => new Date(ms).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", second: sek ? "2-digit" : undefined });
  const zeichneIn = (w) => window.WB && window.WB.zeichneIn(w);

  /* ================================================================ Panel */
  const huelle = $("#panel");
  const panel = huelle && $(".panel", huelle);
  let offen = null, perKlick = false, ausloeser = null;

  function oeffne(slug) {
    const art = document.getElementById("analyse-" + slug);
    if (!art || !huelle) return false;
    $$(".analyse", huelle).forEach((a) => (a.hidden = a !== art));
    const warZu = huelle.hidden;
    huelle.hidden = false;
    document.body.classList.add("panel-offen");
    panel.scrollTop = 0;
    offen = slug;
    if (warZu) panel.focus({ preventScroll: true });
    requestAnimationFrame(() => { zeichneIn(art); live.zeichneHeute(slug); live.ladeTag(slug); tvAutomatisch(art); if (window.WBSzenario) window.WBSzenario.zeige(art); });
    return true;
  }
  function zu() {
    if (!huelle || huelle.hidden) return;
    huelle.hidden = true;
    document.body.classList.remove("panel-offen");
    offen = null;
    if (ausloeser && document.contains(ausloeser)) ausloeser.focus({ preventScroll: true });
  }
  function schliessen() {
    // Mit Zurück schließen, wenn das Panel per Klick geöffnet wurde (sauberer Verlauf)
    if (perKlick && location.hash) { perKlick = false; history.back(); return; }
    history.replaceState(null, "", location.pathname + location.search);
    zu();
  }
  function ausAdresse() {
    const slug = decodeURIComponent(location.hash.slice(1));
    if (!slug || !oeffne(slug)) zu();
  }
  window.addEventListener("hashchange", ausAdresse);
  document.addEventListener("DOMContentLoaded", ausAdresse);

  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-aktion='schliessen']")) { e.preventDefault(); schliessen(); return; }
    const link = e.target.closest("a[href^='#']");
    // Blättern im offenen Panel ersetzt den Verlaufseintrag, damit Esc/Zurück das Panel schließt
    if (link && offen && panel.contains(link)) {
      e.preventDefault();
      history.replaceState(null, "", link.getAttribute("href"));
      oeffne(link.getAttribute("href").slice(1));
      panel.focus({ preventScroll: true });
      return;
    }
    const zeile = e.target.closest("tr[data-href]");
    if (zeile || link) {
      if (!offen) ausloeser = zeile ? $("a", zeile) : link;
      perKlick = perKlick || !offen;
    }
    if (zeile && !link) location.hash = zeile.dataset.href;
  });
  document.addEventListener("keydown", (e) => {
    if (!offen) return;
    if (e.key === "Escape") { e.preventDefault(); schliessen(); }
    if (e.key === "Tab" && !panel.contains(document.activeElement)) { e.preventDefault(); panel.focus(); }
  });

  /* ================================================================ Live */
  const basisEl = $("#live-basis");
  const aktiv = basisEl && !document.body.hasAttribute("data-archiv");
  const basis = aktiv ? JSON.parse(basisEl.textContent) : { werte: {}, kriterien: {} };
  const stand = {};      // slug → { kurs, vortag, zeit (ms), quelle }
  const tag = {};        // slug → { x: [...ISO], y: [...] } Kursverlauf des Handelstags
  const ticks = {};      // slug → { minute → Preis } aus Finnhub-Trades
  const angezeigt = {};  // slug → zuletzt angezeigter Kurs (für die Farbe des Aufblinkens)
  const quellen = { lokal: false, finnhub: false };
  const finnhubZuSlug = {};
  Object.entries(basis.werte).forEach(([slug, b]) => { if (b.finnhub) finnhubZuSlug[b.finnhub] = slug; });

  const live = {
    zeichneHeute(slug) {
      const b = basis.werte[slug], s = stand[slug];
      if (!b || !s) return;
      let x = [], y = [], o = null, h = null, l = null;
      if (tag[slug] && tag[slug].x.length) {
        x = tag[slug].x.slice(); y = tag[slug].y.slice();
        if (tag[slug].o && tag[slug].o.length === x.length) { o = tag[slug].o.slice(); h = tag[slug].h.slice(); l = tag[slug].l.slice(); }
      }
      const neu = (zeit, kurs) => { // Ticks ohne eigene Kerze: Eröffnung beim letzten Kurs
        const vor = y.length ? y[y.length - 1] : kurs;
        x.push(zeit); y.push(kurs);
        if (o) { o.push(vor); h.push(Math.max(vor, kurs)); l.push(Math.min(vor, kurs)); }
      };
      const t = ticks[slug] || {};
      Object.keys(t).sort().forEach((m) => { if (!x.length || m > x[x.length - 1]) neu(m, t[m]); });
      if (x.length && s.zeit > Date.parse(x[x.length - 1])) neu(new Date(s.zeit).toISOString(), s.kurs);
      if (x.length < 2) return;
      window.WB.setzeDynamisch(slug, "heute", {
        art: "linien", zeit: true, titel: "Kursverlauf heute, " + b.name, x,
        serien: [{ name: "Kurs", werte: y, klasse: "reihe-1" }], ohlc: o ? { o, h, l } : null,
        referenz: s.vortag ? { wert: s.vortag, name: "Vortag" } : null,
        einheit: b.waehrung || "",
      });
    },
    async ladeTag(slug) {
      if (!quellen.lokal || !basis.werte[slug]) return;
      try {
        const r = await fetch("api/tag?symbol=" + encodeURIComponent(basis.werte[slug].symbol), { cache: "no-store" });
        if (!r.ok) return;
        tag[slug] = await r.json();
        live.zeichneHeute(slug);
      } catch (e) { /* Server weg: nichts tun */ }
    },
  };

  function setzeKurs(slug, kurs, vortag, zeit, quelle) {
    if (!slug || !basis.werte[slug] || !(kurs > 0)) return;
    const alt = stand[slug];
    // Läuft Finnhub für diesen Wert, gilt dessen Echtzeit-Kurs; Yahoo ergänzt höchstens den Vortag
    if (quelle === "yahoo" && quellen.finnhub && basis.werte[slug].finnhub && alt && alt.quelle === "finnhub") {
      if (!alt.vortag && vortag) { alt.vortag = vortag; vormerken(slug); }
      return;
    }
    if (alt && alt.zeit > zeit && alt.quelle === quelle) return; // nur neuere Kurse übernehmen
    stand[slug] = { kurs, vortag: vortag || (alt && alt.vortag) || null, zeit, quelle };
    if (quelle === "finnhub") {
      const minute = new Date(Math.floor(zeit / 60000) * 60000).toISOString();
      (ticks[slug] = ticks[slug] || {})[minute] = kurs;
    }
    vormerken(slug);
  }

  // Anzeige gesammelt einmal pro Frame aktualisieren (Finnhub kann sehr viele Trades schicken)
  const offenAnzeige = new Set();
  let geplant = false;
  function vormerken(slug) {
    offenAnzeige.add(slug);
    if (!geplant) { geplant = true; requestAnimationFrame(() => { geplant = false; const erster = !Object.keys(angezeigt).length; offenAnzeige.forEach(anzeigen);
      // für den Work-Modus (assets/work.js): welche Werte neue Kurse haben
      document.dispatchEvent(new CustomEvent("wb:kurse", { detail: [...offenAnzeige] })); offenAnzeige.clear(); if (erster) kopfzeile(); }); }
  }

  // Abstand zum Hoch, Lage in der Spanne, Kursziel-Abstand und Forward-KGV zum aktuellen Kurs.
  // Die Signale selbst rechnet assets/regeln.js (mit den eigenen Schwellen).
  function pruefe(b, p) {
    const hoch = Math.max(b.hoch, p), tief = Math.min(b.tief, p);
    return { abstand: 1 - p / hoch, lage: hoch > tief ? (p - tief) / (hoch - tief) : null,
             ziel: b.ziel ? b.ziel / p - 1 : null, kgv: b.fwd_kgv ? (b.fwd_kgv * p) / b.kurs : null };
  }

  function text(wurzel, name, inhalt, klasse) {
    $$(`[data-live="${name}"]`, wurzel).forEach((el) => {
      if (el.textContent !== inhalt) el.textContent = inhalt;
      if (klasse !== undefined) {
        el.classList.remove("plus", "minus", "leise");
        if (klasse) el.classList.add(klasse);
      }
    });
  }
  const vz = (x) => (x > 0 ? "plus" : x < 0 ? "minus" : "");

  function anzeigen(slug) {
    const b = basis.werte[slug], s = stand[slug];
    const p = s.kurs;
    const heute = s.vortag ? p / s.vortag - 1 : null;
    const verzoegert = s.quelle !== "finnhub";
    const alter = Date.now() - s.zeit;
    const zeitKurz = alter < 20 * 60e3 ? uhr(s.zeit) : new Date(s.zeit).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
    const r = b.typ === "aktie" ? pruefe(b, p) : { abstand: 1 - p / Math.max(b.hoch, p) };

    const richtung = angezeigt[slug] == null || p === angezeigt[slug] ? 0 : p > angezeigt[slug] ? 1 : -1;
    $$(`[data-slug="${slug}"]`).forEach((w) => {
      const neu = nf(b.dez || 2).format(p);
      const geaendert = $$(`[data-live="kurs"]`, w).some((el) => el.textContent !== neu);
      text(w, "kurs", neu);
      text(w, "heute", pct(heute), heute == null ? "leise" : vz(heute));
      // Neuer Kurs: Zahl leuchtet kurz grün (gestiegen) oder rot (gefallen) auf und verblasst
      if (richtung && geaendert) $$(`[data-live="kurs"], [data-live="heute"]`, w).forEach((el) => blitz(el, richtung > 0));
      text(w, "zeit-kurz", `${b.waehrung || ""}, ${zeitKurz}`);
      text(w, "zeit", (alter < 20 * 60e3 ? "Live-Kurs " : "Letzter Kurs ") +
        `vom ${new Date(s.zeit).toLocaleDateString("de-DE")} um ${uhr(s.zeit, true)} Uhr, ` +
        (verzoegert ? "über Yahoo Finance (je nach Börse bis zu 15 Minuten verzögert)" : "Echtzeit über Finnhub"));
      text(w, "unter-hoch", pct(r.abstand, 0, false));
      $$("[data-live-sichtbar]", w).forEach((el) => (el.hidden = false));
      if (b.typ !== "aktie") return;
      text(w, "lage", pct(r.lage, 0, false));
      text(w, "kursziel", pct(r.ziel, 0), vz(r.ziel));
      text(w, "kgv", r.kgv ? nf(1).format(r.kgv) : "–");
    });
    // Signale, Punkte und Rechenweg für alle Anlageklassen (mit den eigenen Regeln, falls gesetzt): assets/regeln.js
    if (window.WBRegeln) window.WBRegeln.anwendenFuer(slug, p);
    angezeigt[slug] = p;
    if (offen === slug) live.zeichneHeute(slug);
  }

  function blitz(el, hoch) {
    el.classList.remove("tick-hoch", "tick-runter");
    void el.offsetWidth;
    el.classList.add(hoch ? "tick-hoch" : "tick-runter");
  }

  // Oben rechts: Uhr, die jede Sekunde weiterläuft, solange eine Live-Quelle frische Kurse liefert.
  // Der grüne Punkt schlägt im Sekundentakt mit.
  function kopfzeile() {
    const t = $("#live-text"), knopf = $("#live-knopf");
    if (!t) return;
    const zeiten = Object.values(stand).map((s) => s.zeit);
    if (!zeiten.length) { t.textContent = "Wochenstand"; knopf.classList.remove("an"); knopf.title = "Live-Kurse einrichten"; return; }
    const neueste = Math.max(...zeiten);
    const frisch = Date.now() - neueste < 20 * 60e3;
    knopf.classList.toggle("an", frisch);
    if (frisch) {
      t.innerHTML = "<b>Live</b>" + uhr(Date.now(), true);
      const punkt = $(".live-punkt", knopf);
      punkt.classList.remove("schlag"); void punkt.offsetWidth; punkt.classList.add("schlag");
    } else {
      t.textContent = `Letzte Kurse ${new Date(neueste).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}`;
    }
    knopf.title = `Letzter Kurs um ${uhr(neueste, true)} Uhr. Quellen: ` +
      ([quellen.lokal && "lokaler Live-Server (Yahoo)", quellen.finnhub && "Finnhub (Echtzeit)"].filter(Boolean).join(", ") || "keine");
  }
  function status(id, inhalt, ok) {
    const el = document.getElementById(id);
    if (el) { el.textContent = inhalt; el.classList.toggle("ok", !!ok); }
  }

  /* ---------------------------------------------------------------- Quelle 1: lokaler Live-Server */
  let intervall = 30000;
  async function lokal() {
    if (!window.WBH.serverMoeglich()) return;
    try {
      const r = await fetch("api/kurse", { cache: "no-store" });
      if (!r.ok) throw new Error(r.status);
      const j = await r.json();
      intervall = (j.intervall || 30) * 1000;
      quellen.lokal = true;
      status("status-lokal", `verbunden, ${j.demo ? "simulierte Kurse, " : ""}alle ${intervall / 1000} s`, true);
      for (const [symbol, w] of Object.entries(j.werte || {})) {
        const slug = Object.keys(basis.werte).find((k) => basis.werte[k].symbol === symbol);
        setzeKurs(slug, w.kurs, w.vortag, w.zeit * 1000, "yahoo");
      }
      if (offen) live.ladeTag(offen);
      setTimeout(lokal, intervall);
    } catch (e) {
      if (quellen.lokal) { status("status-lokal", "Verbindung verloren, neuer Versuch in 30 s"); setTimeout(lokal, 30000); }
      quellen.lokal = false;
    }
  }

  /* ---------------------------------------------------------------- Quelle 2: Finnhub (Echtzeit USA) */
  // Neben der Watchlist können andere Teile (Chart-Taktik) weitere US-Kürzel abonnieren und jeden Handel mitlesen.
  const SPEICHER = "wochenbericht.finnhub";
  let ws = null, wsVersuch = 0, wsFehler = null;
  const extraAbos = new Map(), tradeHoerer = new Set();  // Kürzel → Zahl der Nutzer; Funktionen, die Trades bekommen
  const US_KUERZEL = /^[A-Z]{1,5}(\.[A-Z])?$/;
  const wsSende = (typ, sym) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: typ, symbol: sym })); };
  function liveAbo(sym, an) {
    if (!US_KUERZEL.test(sym || "")) return false;
    const n = (extraAbos.get(sym) || 0) + (an ? 1 : -1);
    if (n > 0) extraAbos.set(sym, n); else extraAbos.delete(sym);
    if (finnhubZuSlug[sym]) return true;                       // Watchlist-Werte laufen ohnehin
    if (an && n === 1) { if (ws) wsSende("subscribe", sym); else finnhub(); }
    if (!an && n <= 0) wsSende("unsubscribe", sym);
    return true;
  }
  function finnhub() {
    const schluessel = lies(SPEICHER);
    if (ws) { ws.onclose = null; ws.close(); ws = null; }
    quellen.finnhub = false;
    const symbole = Object.keys(finnhubZuSlug);
    const alle = [...new Set(symbole.concat([...extraAbos.keys()]))];
    if (!schluessel) { status("status-finnhub", "aus"); return; }
    if (!alle.length) { status("status-finnhub", "keine US-Aktien in der Watchlist"); return; }
    const rest = window.WBH.finnhub.rest(), wsUrl = window.WBH.finnhub.ws();
    // Startkurs und Vortagesschluss per Abfrage, danach laufend jeder Handel per WebSocket
    symbole.forEach(async (sym) => {
      try {
        const r = await fetch(`${rest}/quote?symbol=${encodeURIComponent(sym)}&token=${encodeURIComponent(schluessel)}`);
        const q = await r.json();
        if (q && q.c) setzeKurs(finnhubZuSlug[sym], q.c, q.pc, (q.t || Date.now() / 1000) * 1000, "finnhub");
      } catch (e) { /* Abfrage fehlgeschlagen: WebSocket reicht */ }
    });
    status("status-finnhub", "verbinde …");
    wsFehler = null;
    ws = new WebSocket(`${wsUrl}?token=${encodeURIComponent(schluessel)}`);
    ws.onopen = () => {
      wsVersuch = 0; quellen.finnhub = true;
      alle.forEach((s) => ws.send(JSON.stringify({ type: "subscribe", symbol: s })));
      [...extraAbos.keys()].filter((s) => !alle.includes(s)).forEach((s) => wsSende("subscribe", s));  // während des Verbindens dazugekommen
      status("status-finnhub", `verbunden, ${new Set(alle.concat([...extraAbos.keys()])).size} US-Werte in Echtzeit`, true);
    };
    ws.onmessage = (ereignis) => {
      let m; try { m = JSON.parse(ereignis.data); } catch (e) { return; }
      if (m.type === "trade") (m.data || []).forEach((d) => {
        if (!d || typeof d.s !== "string" || !(d.p > 0) || !Number.isFinite(d.t)) return;
        if (finnhubZuSlug[d.s]) setzeKurs(finnhubZuSlug[d.s], d.p, null, d.t, "finnhub");
        tradeHoerer.forEach((f) => { try { f({ s: d.s, p: d.p, t: d.t, v: Number.isFinite(d.v) ? d.v : 0 }); } catch (e) { /* Hörer-Fehler nicht weitergeben */ } });
      });
      else if (m.type === "error") { wsFehler = m.msg || "unbekannter Fehler"; status("status-finnhub", "Fehler: " + wsFehler); }
    };
    ws.onclose = () => {
      quellen.finnhub = false;
      if (wsFehler && /key|token|auth/i.test(wsFehler)) {
        status("status-finnhub", "Schlüssel abgelehnt (" + wsFehler + "). Bitte prüfen und neu speichern.");
        return;  // ohne gültigen Schlüssel nicht endlos neu verbinden
      }
      const warte = Math.min(60, 5 * 2 ** wsVersuch++);
      status("status-finnhub", `getrennt, neuer Versuch in ${warte} s`);
      setTimeout(finnhub, warte * 1000);
    };
  }

  /* ---------------------------------------------------------------- Kursverlauf beim Zeigen auf 1T, 1W, YTD … */
  // Maus: erscheint beim Darüberfahren, verschwindet beim Wegbewegen. Handy: nur solange der Finger draufbleibt.
  const chartDaten = (() => { try { return JSON.parse($("#chart-daten").textContent); } catch (e) { return {}; } })();
  const ZEITRAUM = { "1T": "Heute", "1W": "1 Woche", "1M": "1 Monat", "YTD": "Seit Jahresbeginn", "6M": "6 Monate", "12M": "12 Monate" };
  const vt = document.createElement("div");
  vt.className = "verlauf-tipp"; vt.hidden = true; vt.setAttribute("aria-hidden", "true");

  function reihe(slug, z) {
    if (z === "1T") {
      const d = tag[slug];
      if (!d || !d.x || d.x.length < 2) return null;
      const x = d.x.map((s) => Date.parse(s)), y = d.y.slice();
      const s = stand[slug];
      if (s && s.zeit > x[x.length - 1]) { x.push(s.zeit); y.push(s.kurs); }
      return { x, y, start: s && s.vortag ? s.vortag : y[0], zeit: true };
    }
    const k = chartDaten[slug] && chartDaten[slug].kurs;
    if (!k) return null;
    let x = k.x.map((s) => Date.parse(s)), y = k.serien[0].werte.slice();
    const s = stand[slug];
    if (s && s.zeit > x[x.length - 1] + 12 * 3600e3) { x.push(s.zeit); y.push(s.kurs); }
    const ende = new Date(x[x.length - 1]);
    let ab;
    if (z === "1W") ab = ende - 7 * 864e5;
    else if (z === "1M") ab = new Date(ende).setMonth(ende.getMonth() - 1);
    else if (z === "6M") ab = new Date(ende).setMonth(ende.getMonth() - 6);
    else if (z === "YTD") ab = new Date(ende.getFullYear(), 0, 1) - 1;  // ab dem letzten Schlusskurs des Vorjahres
    else ab = -Infinity;
    let i = x.findIndex((t) => t >= ab);
    if (z === "YTD" && i > 0) i -= 1;      // Startpunkt: Schluss des Vorjahres
    if (z !== "YTD" && z !== "12M" && i > 0) i -= 1;
    x = x.slice(Math.max(0, i)); y = y.slice(Math.max(0, i));
    return x.length > 1 ? { x, y, start: y[0], zeit: false } : null;
  }

  function zeichneVerlauf(r) {
    const B = 252, H = 96, lo = Math.min(...r.y, r.start), hi = Math.max(...r.y, r.start), sp = hi - lo || 1;
    const t0 = r.x[0], t1 = r.x[r.x.length - 1];
    const px = (t) => ((t - t0) / (t1 - t0 || 1)) * B, py = (v) => H - 4 - ((v - lo) / sp) * (H - 8);
    const pts = r.x.map((t, i) => `${px(t).toFixed(1)},${py(r.y[i]).toFixed(1)}`).join(" ");
    const auf = r.y[r.y.length - 1] >= r.start, farbe = auf ? "var(--plus)" : "var(--minus)";
    const id = "vg" + Math.random().toString(36).slice(2, 7);
    return `<div class="vt-chart"><svg viewBox="0 0 ${B} ${H}" preserveAspectRatio="none">
      <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${farbe}" stop-opacity=".22"/><stop offset="1" stop-color="${farbe}" stop-opacity="0"/></linearGradient></defs>
      <line x1="0" x2="${B}" y1="${py(r.start)}" y2="${py(r.start)}" stroke="var(--tinte-3)" stroke-width="1" stroke-dasharray="2 3" vector-effect="non-scaling-stroke"/>
      <polygon points="0,${H} ${pts} ${B},${H}" fill="url(#${id})"/>
      <polyline points="${pts}" fill="none" stroke="${farbe}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
      <circle cx="${px(t1)}" cy="${py(r.y[r.y.length - 1])}" r="2.6" fill="${farbe}"/></svg>
      <span class="vt-preis ${auf ? "plus" : "minus"}" style="top:${(py(r.y[r.y.length - 1]) / H * 96).toFixed(1)}px">${nf(r.dez || 2).format(r.y[r.y.length - 1])}${r.einheit ? " <small>" + r.einheit + "</small>" : ""}</span></div>`;
  }

  function zeigeVerlauf(el) {
    const z = el.dataset.zeitraum, w = el.closest("[data-slug]");
    if (!w) return;
    const slug = w.dataset.slug, b = basis.werte[slug] || { name: "", waehrung: "" };
    const name = (chartDaten[slug] && chartDaten[slug].kurs && chartDaten[slug].kurs.titel || "").replace(/^Kursverlauf (.*), 12 Monate$/, "$1") || b.name;
    const wertEl = el.querySelector("[data-live='heute'], b") || el;
    const wert = (wertEl.textContent || "").trim();
    const r = reihe(slug, z);
    const fmt = (t) => r.zeit ? uhr(t) : new Date(t).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" });
    const klasse = wertEl.classList.contains("plus") || el.classList.contains("plus") ? "plus" : wertEl.classList.contains("minus") || el.classList.contains("minus") ? "minus" : "";
    vt.innerHTML = `<div class="vt-kopf"><strong>${name}, ${ZEITRAUM[z] || z}</strong>${wert && wert !== "–" && !el.querySelector(".spark") ? `<b class="${klasse}">${wert}</b>` : ""}</div>` +
      (r ? zeichneVerlauf(Object.assign(r, { einheit: b.waehrung || "", dez: b.dez })) + `<div class="vt-fuss"><span>${fmt(r.x[0])}</span><span>${fmt(r.x[r.x.length - 1])}</span></div>`
         : `<p class="vt-leer">${z === "1T" ? "Der Tagesverlauf erscheint, sobald Live-Kurse laufen." : "Für diesen Zeitraum liegen keine Kursdaten vor."}</p>`);
    if (!document.body.contains(vt)) document.body.appendChild(vt);
    vt.hidden = false;
    const q = el.getBoundingClientRect(), br = vt.offsetWidth, ho = vt.offsetHeight, rand = 8;
    const x = Math.min(Math.max(q.left + q.width / 2 - br / 2, rand), window.innerWidth - br - rand);
    const y = q.top - ho - 10 >= rand ? q.top - ho - 10 : q.bottom + 10;   // bevorzugt darüber, sonst darunter
    vt.style.left = x + "px"; vt.style.top = y + "px";
  }
  const versteckeVerlauf = () => { vt.hidden = true; };

  document.addEventListener("mouseover", (e) => {
    if (e.sourceCapabilities && e.sourceCapabilities.firesTouchEvents) return;
    const el = e.target.closest("[data-zeitraum]");
    if (el && !el.contains(e.relatedTarget)) zeigeVerlauf(el);
  });
  document.addEventListener("mouseout", (e) => {
    const el = e.target.closest("[data-zeitraum]");
    if (el && !el.contains(e.relatedTarget)) versteckeVerlauf();
  });
  // Touch: gedrückt halten (ca. 0,35 s) zeigt den Verlauf, Loslassen blendet ihn aus und löst keinen Klick aus
  let haltTimer = null, gehalten = false, startPunkt = null;
  document.addEventListener("touchstart", (e) => {
    const el = e.target.closest("[data-zeitraum]");
    gehalten = false;
    if (!el) return;
    startPunkt = [e.touches[0].clientX, e.touches[0].clientY];
    haltTimer = setTimeout(() => { gehalten = true; zeigeVerlauf(el); }, 350);
  }, { passive: true });
  document.addEventListener("touchmove", (e) => {
    if (!startPunkt) return;
    const d = Math.hypot(e.touches[0].clientX - startPunkt[0], e.touches[0].clientY - startPunkt[1]);
    if (d > 10 && !gehalten) { clearTimeout(haltTimer); startPunkt = null; }
    if (gehalten) e.preventDefault();
  }, { passive: false });
  const loslassen = (e) => {
    clearTimeout(haltTimer); startPunkt = null;
    if (gehalten) { versteckeVerlauf(); if (e.cancelable) e.preventDefault(); }
  };
  document.addEventListener("touchend", loslassen);
  document.addEventListener("touchcancel", loslassen);
  document.addEventListener("click", (e) => { if (gehalten) { e.stopPropagation(); e.preventDefault(); gehalten = false; } }, true);
  document.addEventListener("contextmenu", (e) => { if (e.target.closest("[data-zeitraum]")) e.preventDefault(); });
  window.addEventListener("scroll", versteckeVerlauf, true);

  /* ---------------------------------------------------------------- Einstellungen */
  function einstellungen() {
    const knopf = $("#live-knopf"), box = $("#live-einstellungen");
    if (!knopf || !box) return;
    knopf.addEventListener("click", () => {
      box.hidden = !box.hidden;
      knopf.setAttribute("aria-expanded", String(!box.hidden));
      if (!box.hidden) box.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
    const feld = $("#finnhub-schluessel");
    if (lies(SPEICHER)) feld.placeholder = "Schlüssel gespeichert";
    $("#finnhub-form").addEventListener("submit", (e) => {
      e.preventDefault();
      if (!feld.value.trim()) return;
      schreib(SPEICHER, feld.value.trim());
      feld.value = ""; feld.placeholder = "Schlüssel gespeichert";
      finnhub();
    });
    $("#finnhub-entfernen").addEventListener("click", () => {
      schreib(SPEICHER, null);
      feld.placeholder = "Finnhub-Schlüssel";
      finnhub();
    });
  }

  if (aktiv) {
    document.addEventListener("DOMContentLoaded", () => {
      einstellungen();
      lokal();
      finnhub();
      // auf die volle Sekunde ausrichten, damit die Uhr gleichmäßig tickt
      setTimeout(() => { kopfzeile(); setInterval(kopfzeile, 1000); }, 1000 - (Date.now() % 1000));
    });
  }
  /* ================================================================ Kacheln je Anlageklasse */
  // Ohne JavaScript stehen alle Klassen untereinander; mit JavaScript zeigt die Seite immer eine Kachel.
  const KACHEL = "fathom.kachel";
  document.documentElement.classList.add("js");
  function zeigeKachel(typ, merken) {
    const knopf = $(`.kachel[data-kachel="${typ}"]`);
    if (!knopf) return;
    $$(".kachel").forEach((k) => k.setAttribute("aria-pressed", String(k === knopf)));
    $$(".kachel-inhalt").forEach((c) => c.classList.toggle("aktiv", c.dataset.kachelInhalt === typ));
    if (merken) { try { localStorage.setItem(KACHEL, typ); } catch (e) { /* privat */ } }
  }
  document.addEventListener("DOMContentLoaded", () => {
    if (!$(".kacheln")) return;
    let start = "aktie";
    try { start = localStorage.getItem(KACHEL) || start; } catch (e) { /* privat */ }
    zeigeKachel($(`.kachel[data-kachel="${start}"]`) ? start : "aktie", false);
    $(".kacheln").addEventListener("click", (e) => { const k = e.target.closest(".kachel"); if (k) zeigeKachel(k.dataset.kachel, true); });
  });
  window.WBKachel = zeigeKachel;

  /* ================================================================ Definitionen am Sternchen */
  // Ein kleines Textfeld über dem Sternchen, beim Zeigen mit der Maus, per Tastatur oder durch Antippen.
  // Es liegt fest über der Seite (position: fixed), damit es auch in scrollbaren Tabellen nicht abgeschnitten wird.
  const tipp = document.createElement("div");
  tipp.className = "def-tipp"; tipp.id = "def-tipp"; tipp.setAttribute("role", "tooltip"); tipp.hidden = true;
  let tippVon = null;
  function zeigeTipp(knopf) {
    if (!document.body.contains(tipp)) document.body.appendChild(tipp);
    tipp.textContent = knopf.dataset.def + (window.WBRegeln ? window.WBRegeln.defHinweis(knopf) : "");
    tipp.hidden = false;
    if (tippVon && tippVon !== knopf) tippVon.setAttribute("aria-expanded", "false");
    tippVon = knopf; knopf.setAttribute("aria-expanded", "true"); knopf.setAttribute("aria-describedby", "def-tipp");
    const r = knopf.getBoundingClientRect(), mitte = r.left + r.width / 2;
    const breite = tipp.offsetWidth, rand = 8;
    const x = Math.min(Math.max(mitte, rand + breite / 2), window.innerWidth - rand - breite / 2);
    tipp.style.left = x + "px";
    tipp.style.top = r.top + "px";
    tipp.style.setProperty("--pfeil", (breite / 2 + mitte - x) + "px");
  }
  function versteckeTipp() {
    if (tipp.hidden) return;
    tipp.hidden = true;
    if (tippVon) { tippVon.setAttribute("aria-expanded", "false"); tippVon.removeAttribute("aria-describedby"); }
    tippVon = null;
  }
  document.addEventListener("mouseover", (e) => { const k = e.target.closest(".def"); if (k) zeigeTipp(k); });
  document.addEventListener("mouseout", (e) => { const k = e.target.closest(".def"); if (k && !k.contains(e.relatedTarget) && document.activeElement !== k && !k.dataset.offen) versteckeTipp(); });
  document.addEventListener("focusin", (e) => { if (e.target.matches && e.target.matches(".def")) zeigeTipp(e.target); });
  document.addEventListener("focusout", (e) => { if (e.target.matches && e.target.matches(".def")) { delete e.target.dataset.offen; versteckeTipp(); } });
  document.addEventListener("click", (e) => {
    const k = e.target.closest(".def");
    // Erster Klick (oder Tippen) öffnet und hält das Feld offen, ein zweiter Klick schließt es
    if (k) {
      e.stopPropagation(); e.preventDefault();
      if (tippVon === k && !tipp.hidden && k.dataset.offen) { delete k.dataset.offen; versteckeTipp(); }
      else { zeigeTipp(k); k.dataset.offen = "1"; }
      return;
    }
    if (tippVon) delete tippVon.dataset.offen;
    versteckeTipp();
  }, true);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !tipp.hidden) { versteckeTipp(); e.stopImmediatePropagation(); } }, true);
  // Beim Scrollen wandert das Feld mit dem Sternchen mit
  window.addEventListener("scroll", () => { if (!tipp.hidden && tippVon) zeigeTipp(tippVon); }, true);
  window.addEventListener("resize", versteckeTipp);

  /* ================================================================ Hell / Dunkel */
  // Ohne eigene Wahl folgt die Seite der Einstellung des Systems. Die Wahl wird nur in diesem Browser gespeichert.
  const DESIGN = "fathom.design";
  const dunkelSystem = window.matchMedia("(prefers-color-scheme: dark)");
  function designKnopf() {
    const k = $("#design-knopf");
    if (k) k.setAttribute("aria-label", istDunkel() ? "Helles Design einschalten" : "Dunkles Design einschalten");
    // Browserleiste (theme-color) folgt auch der eigenen Wahl, nicht nur dem System
    const leinwand = getComputedStyle(document.documentElement).getPropertyValue("--leinwand").trim();
    if (leinwand) $$('meta[name="theme-color"]').forEach((m) => m.setAttribute("content", leinwand));
  }
  document.addEventListener("DOMContentLoaded", () => {
    designKnopf();
    const k = $("#design-knopf");
    if (k) k.addEventListener("click", () => {
      const dunkel = !istDunkel();
      document.documentElement.dataset.theme = dunkel ? "dark" : "light";
      try { localStorage.setItem(DESIGN, dunkel ? "dunkel" : "hell"); } catch (e) { /* privat */ }
      designKnopf();
      if (offen) zeichneIn(document.getElementById("analyse-" + offen));
      $$(".tv-rahmen.geladen").forEach(ladeTV);
      if (window.WBHeatmap) window.WBHeatmap();
    });
    dunkelSystem.addEventListener("change", designKnopf);
  });

  /* ================================================================ Suche und Watchlist */
  // Suchen in der eigenen Watchlist geht immer. Neue Werte finden und hinzufügen geht über den lokalen
  // Server (python live.py): Er sucht bei Yahoo Finance, schreibt config.yaml und baut den Bericht neu.
  const KLASSE = { aktie: "Aktien", etf: "ETFs", forex: "Forex", rohstoff: "Rohstoffe", index: "Indizes & Futures" };
  let server = null;          // null = noch nicht geprüft, true/false = lokaler Server erreichbar
  let suchAbbruch = null, suchTimer = null;

  async function serverPruefen() {
    if (server !== null) return server;
    if (!window.WBH.serverMoeglich()) return (server = false);
    try { const r = await fetch("api/status", { cache: "no-store" }); server = r.ok; } catch (e) { server = false; }
    if (server) $$(".entfernen-knopf").forEach((k) => (k.hidden = false));
    return server;
  }

  function sucheOeffnen() {
    const s = $("#suche"); if (!s) return;
    s.hidden = false; document.body.classList.add("suche-offen");
    $("#such-knopf").setAttribute("aria-expanded", "true");
    const ein = $("#suche-eingabe"); ein.focus(); ein.select();
    serverPruefen().then(() => sucheAnzeigen(ein.value));
  }
  function sucheSchliessen() {
    const s = $("#suche"); if (!s || s.hidden) return;
    s.hidden = true; document.body.classList.remove("suche-offen");
    $("#such-knopf").setAttribute("aria-expanded", "false");
    $("#such-knopf").focus({ preventScroll: true });
  }

  function trefferZeile(r, lokal) {
    const info = lokal ? `${esc(r.symbol)}, ${KLASSE[r.typ] || ""}` :
      [esc(r.symbol), esc(r.boerse), r.de_boersen && r.de_boersen.length ? "handelbar an " + esc(r.de_boersen.join(", ")) : ""].filter(Boolean).join(", ");
    const knopf = lokal ? `<span class="treffer-marke">Auf der Watchlist</span>` : r.auf_watchlist
      ? `<span class="treffer-marke">Auf der Watchlist</span>`
      : `<button type="button" class="treffer-knopf" data-symbol="${esc(r.symbol)}" data-name="${esc(r.name)}" data-typ="${esc(r.typ)}">Hinzufügen</button>`;
    return `<li class="treffer${lokal ? " lokal" : ""}"${lokal ? ` data-oeffnen="${esc(r.slug)}" data-typ="${esc(r.typ)}" tabindex="0" role="button"` : ""}>
      <span class="treffer-text"><span class="treffer-name">${esc(r.name)}</span><span class="treffer-info">${info}</span></span>${knopf}</li>`;
  }

  async function sucheAnzeigen(text) {
    const ziel = $("#suche-ergebnisse"); if (!ziel) return;
    const q = text.trim().toLowerCase();
    const eigene = Object.entries(basis.werte)
      .filter(([, b]) => q && (b.name + " " + b.symbol).toLowerCase().includes(q))
      .map(([slug, b]) => ({ slug, name: b.name, symbol: b.symbol, typ: b.typ }));
    let html = "";
    if (eigene.length) html += `<h3>Auf deiner Watchlist</h3><ul>${eigene.map((r) => trefferZeile(r, true)).join("")}</ul>`;
    if (!q) html = `<p class="suche-hinweis">Name, Kürzel oder ISIN eingeben, zum Beispiel „Allianz“, „US0378331005“, „EUR/USD“, „Gold“ oder „DAX“.</p>`;
    else if (server === false) html += `<p class="suche-hinweis">Neue Werte finden und zur Watchlist hinzufügen funktioniert mit dem lokalen Server: im Projektordner <code>python live.py</code> starten und die Seite über <code>http://localhost:8000</code> öffnen.</p>`;
    else if (q.length >= 2) html += `<p class="suche-hinweis" data-laedt>Suche bei Yahoo Finance …</p>`;
    ziel.innerHTML = html;
    if (!server || q.length < 2) return;
    clearTimeout(suchTimer);
    suchTimer = setTimeout(async () => {
      if (suchAbbruch) suchAbbruch.abort();
      suchAbbruch = new AbortController();
      try {
        const r = await fetch("api/suche?q=" + encodeURIComponent(text.trim()), { signal: suchAbbruch.signal, cache: "no-store" });
        const j = await r.json();
        const lade = $("[data-laedt]", ziel); if (lade) lade.remove();
        const gruppen = {};
        (j.ergebnisse || []).filter((x) => !eigene.some((e) => e.symbol === x.symbol)).forEach((x) => (gruppen[x.typ] = gruppen[x.typ] || []).push(x));
        let mehr = "";
        Object.keys(KLASSE).forEach((typ) => { if (gruppen[typ]) mehr += `<h3>${KLASSE[typ]}</h3><ul>${gruppen[typ].map((x) => trefferZeile(x, false)).join("")}</ul>`; });
        if (!mehr && !eigene.length) mehr = `<p class="suche-hinweis">${j.fehler ? esc(j.fehler) : "Nichts gefunden, das in Deutschland handelbar ist. Anderen Namen, das Kürzel oder die ISIN versuchen."}</p>`;
        ziel.insertAdjacentHTML("beforeend", mehr);
      } catch (e) {
        if (e.name !== "AbortError") { const lade = $("[data-laedt]", ziel); if (lade) lade.textContent = "Die Suche ist gerade nicht erreichbar."; }
      }
    }, 250);
  }

  function hinweis(text) {
    const h = $("#aufbau-hinweis"); if (!h) return;
    h.innerHTML = text; h.hidden = false;
  }
  async function aufNeuaufbauWarten(startVersion, kachel) {
    // Bericht wird im Hintergrund neu erstellt; danach die Seite neu laden (gewählte Kachel bleibt)
    for (;;) {
      await new Promise((r) => setTimeout(r, 2000));
      try {
        const s = await (await fetch("api/status", { cache: "no-store" })).json();
        if (!s.aufbau && s.version > startVersion) {
          if (s.fehler) { hinweis("Die Analyse konnte nicht erstellt werden: " + esc(s.fehler)); return; }
          try { if (kachel) localStorage.setItem(KACHEL, kachel); } catch (e) { /* privat */ }
          location.reload(); return;
        }
      } catch (e) { /* Server kurz weg: weiter warten */ }
    }
  }
  async function watchlistAendern(methode, daten, text, kachel) {
    if (window.WBVorschau) {  // statische Vorschau: es gibt keinen Server, der config.yaml schreiben könnte
      hinweis(window.WBVorschau(methode, daten));
      setTimeout(() => { const h = $("#aufbau-hinweis"); if (h) h.hidden = true; }, 6000);
      return "vorschau";
    }
    const url = methode === "DELETE" ? "api/watchlist?symbol=" + encodeURIComponent(daten.symbol) : "api/watchlist";
    const r = await fetch(url, { method: methode, headers: { "Content-Type": "application/json" }, body: methode === "POST" ? JSON.stringify(daten) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.fehler || "Fehler " + r.status);
    if (methode === "POST" && j.neu === false) {  // nichts Neues (schon drauf oder nicht gefunden): kein Neuaufbau
      hinweis(j.nicht_gefunden && j.nicht_gefunden.length ? "Nicht gefunden: " + esc(j.nicht_gefunden.join(", ")) : "Steht schon auf der Watchlist.");
      setTimeout(() => { const h = $("#aufbau-hinweis"); if (h) h.hidden = true; }, 6000);
      return j;
    }
    hinweis(`<span class="laeuft"></span>${text}` + (j.nicht_gefunden && j.nicht_gefunden.length ? ` Nicht gefunden: ${esc(j.nicht_gefunden.join(", "))}.` : ""));
    aufNeuaufbauWarten(j.version, kachel);
    return j;
  }

  document.addEventListener("click", async (e) => {
    if (e.target.closest("#such-knopf")) { e.preventDefault(); sucheOeffnen(); return; }
    if (e.target.closest("[data-suche-zu]")) { sucheSchliessen(); return; }
    const eigen = e.target.closest("[data-oeffnen]");
    if (eigen) {
      sucheSchliessen();
      if (window.WBKachel) window.WBKachel(eigen.dataset.typ, true);
      location.hash = eigen.dataset.oeffnen; return;
    }
    const add = e.target.closest(".treffer-knopf:not(.komponist-knopf)");
    if (add) {
      add.disabled = true; add.textContent = "Wird hinzugefügt …";
      try {
        const ergebnis = await watchlistAendern("POST", { symbol: add.dataset.symbol, name: add.dataset.name, typ: add.dataset.typ },
          `„${esc(add.dataset.name)}“ steht jetzt auf der Watchlist. Die Analyse wird erstellt, die Seite lädt danach neu …`, add.dataset.typ);
        if (ergebnis === "vorschau") { add.disabled = false; add.textContent = "Hinzufügen"; }
        else add.outerHTML = `<span class="treffer-marke">Auf der Watchlist</span>`;
      } catch (err) { add.disabled = false; add.textContent = "Erneut versuchen"; add.title = err.message; }
      return;
    }
    const weg = e.target.closest(".entfernen-knopf");
    if (weg) {
      // zweistufig statt Bestätigungsdialog: erster Klick fragt nach, zweiter entfernt
      if (!weg.dataset.sicher) { weg.dataset.sicher = "1"; weg.textContent = "Wirklich entfernen?"; setTimeout(() => { delete weg.dataset.sicher; weg.textContent = "Von der Watchlist entfernen"; }, 4000); return; }
      weg.disabled = true;
      try { await watchlistAendern("DELETE", { symbol: weg.dataset.entfernen }, `„${esc(weg.dataset.name)}“ wurde entfernt. Der Bericht wird neu erstellt …`); }
      catch (err) { weg.disabled = false; weg.textContent = "Entfernen fehlgeschlagen"; }
    }
  });
  document.addEventListener("input", (e) => { if (e.target.id === "suche-eingabe") sucheAnzeigen(e.target.value); });
  document.addEventListener("keydown", (e) => {
    const s = $("#suche");
    if (s && !s.hidden) {
      if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); sucheSchliessen(); }
      else if (e.key === "Enter" && e.target.matches("[data-oeffnen]")) e.target.click();
      return;
    }
    const tippt = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName);
    if (!tippt && !offen && !document.body.classList.contains("fenster-offen") && (e.key === "/" || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k"))) { e.preventDefault(); sucheOeffnen(); }
  }, true);
  if (aktiv) document.addEventListener("DOMContentLoaded", () => setTimeout(serverPruefen, 300));

  /* ================================================================ TradingView-Chart */
  // Lädt erst nach Zustimmung (Klick), weil dabei Daten von TradingView abgerufen werden. Die Zustimmung gilt für alle Werte.
  const TV = "fathom.tradingview";
  function tvErlaubt() { try { return localStorage.getItem(TV) === "ja"; } catch (e) { return false; } }
  function ladeTV(rahmen) {
    const panelFarbe = getComputedStyle(document.documentElement).getPropertyValue("--panel").trim() || "#ffffff";
    rahmen.classList.add("geladen");
    rahmen.innerHTML = '<div class="tradingview-widget-container"><div class="tradingview-widget-container__widget"></div>' +
      '<div class="tradingview-widget-copyright"><a href="https://de.tradingview.com/" rel="noopener nofollow" target="_blank">Charts von TradingView</a></div></div>';
    const s = document.createElement("script");
    s.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    s.async = true;
    s.textContent = JSON.stringify({
      autosize: true, symbol: rahmen.dataset.tv, interval: "D", timezone: "Europe/Berlin", style: "1", locale: "de_DE",
      theme: istDunkel() ? "dark" : "light", backgroundColor: panelFarbe, allow_symbol_change: true,
      calendar: false, support_host: "https://www.tradingview.com",
    });
    rahmen.firstChild.appendChild(s);
  }
  function tvAutomatisch(wurzel) {
    if (!tvErlaubt()) return;
    $$(".tv-rahmen:not(.geladen)", wurzel).forEach(ladeTV);
  }
  document.addEventListener("click", (e) => {
    const k = e.target.closest(".tv-laden");
    if (k) {
      try { localStorage.setItem(TV, "ja"); } catch (err) { /* privat */ }
      ladeTV(k.closest(".tv-rahmen"));
      return;
    }
    const feed = e.target.closest(".feed-kopieren");
    if (feed) {
      const url = new URL(feed.dataset.feed, location.href).href;
      const fertig = () => { feed.textContent = "Adresse kopiert"; setTimeout(() => (feed.textContent = "Feed-Adresse kopieren"), 2500); };
      const zeigen = () => { if (!feed.nextElementSibling || feed.nextElementSibling.tagName !== "CODE") feed.insertAdjacentHTML("afterend", `<code class="feed-adresse">${esc(url)}</code>`); };
      if (navigator.clipboard) navigator.clipboard.writeText(url).then(fertig, zeigen);
      else zeigen();
    }
  });

  // Für die Aktien-Kachel (assets/werkzeuge.js): Werte hinzufügen und Server prüfen
  window.WBWatchlist = {
    hinzufuegen: (daten, text, kachel) => watchlistAendern("POST", daten, text, kachel),
    server: serverPruefen,
    hinweis,
  };

  // Für Tests, die Vorschau und eigene Erweiterungen
  window.WBLive = {
    setzeKurs, stand, quellen, tag,
    // Echtzeit-Trades für weitere US-Kürzel (Chart-Taktik): liveAbo(kürzel, true|false), aufTrade(fn) → abmelden()
    liveAbo, aufTrade: (f) => { tradeHoerer.add(f); return () => tradeHoerer.delete(f); },
    finnhubSchluessel: () => !!lies(SPEICHER),
    setzeTag(slug, d) { tag[slug] = d; if (offen === slug) live.zeichneHeute(slug); },
    // Kursverlauf des Handelstags vom lokalen Live-Server holen (Work-Modus)
    async holeTag(slug) {
      if (!quellen.lokal || !basis.werte[slug]) return tag[slug] || null;
      try {
        const r = await fetch("api/tag?symbol=" + encodeURIComponent(basis.werte[slug].symbol), { cache: "no-store" });
        if (r.ok) tag[slug] = await r.json();
      } catch (e) { /* Server weg */ }
      return tag[slug] || null;
    },
    ticks,
  };
})();

/* Abschnitte blenden beim ersten Erscheinen einmal sanft ein (nur ganze Abschnitte, nie Zeilen; aus bei
   „Bewegung reduzieren“, siehe .einblenden in stil.css). */
(function () {
  if (!("IntersectionObserver" in window) || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  document.addEventListener("DOMContentLoaded", () => {
    const ziele = [...document.querySelectorAll("main .protokoll, main section.abschnitt, main .kacheln")];
    const beobachter = new IntersectionObserver((eintraege) => {
      eintraege.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("bereit"); beobachter.unobserve(e.target); } });
    }, { rootMargin: "0px 0px -8% 0px" });
    ziele.forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.top < innerHeight && r.bottom > 0) return; // schon sichtbar: nichts verstecken
      el.classList.add("einblenden");
      beobachter.observe(el);
    });
  });
})();


