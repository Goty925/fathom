/* Fathom: Screener (Finviz), Heatmap (Finviz), Depot-Kopplung (Portfolio Performance, Parqet).
 *
 * Screener: Filter-Chips und Textsuche über jeder Tabelle, Spalten per Klick sortierbar.
 * Heatmap:  Kacheln nach Sektor gruppiert, Fläche = Börsenwert, Farbe = Kursveränderung (1T, 1W oder YTD).
 * Depot:    CSV aus Portfolio Performance oder Parqet im Browser einlesen (bleibt in localStorage),
 *           Positionen bewerten und auf der Watchlist markieren; Export für PP und Parqet.
 */
(function () {
  "use strict";
  const { $, $$, nf, esc, lies, schreib, pct } = window.WBH;
  const basisEl = $("#live-basis");
  const basis = basisEl ? JSON.parse(basisEl.textContent) : { werte: {}, fx: {} };

  // Aktueller Kurs und Tagesveränderung: live, sonst Wochenstand
  function aktuell(slug) {
    const b = basis.werte[slug] || {};
    const s = window.WBLive && window.WBLive.stand[slug];
    return { kurs: s ? s.kurs : b.kurs, heute: s && s.vortag ? s.kurs / s.vortag - 1 : null };
  }

  /* ================================================================ Screener */
  const CHIPS = {
    aktie: [["Treffer", (r) => r.dataset.treffer === "1"], ["Earnings bald", (r) => r.dataset.earnings === "1"],
            ["Drawdown ≥ 20 %", (r) => +r.dataset.dd >= 0.2], ["Upside ≥ 20 %", (r) => r.dataset.upside !== "" && +r.dataset.upside >= 0.2],
            ["Technik: Kaufen", (r) => +r.dataset.technik >= 0.1], ["Im Portfolio", (r) => r.classList.contains("im-depot")]],
    etf: [["Technik: Kaufen", (r) => +r.dataset.technik >= 0.1], ["Im Portfolio", (r) => r.classList.contains("im-depot")]],
    standard: [["Treffer", (r) => r.dataset.treffer === "1"], ["Drawdown ≥ 10 %", (r) => +r.dataset.dd >= 0.1],
               ["Technik: Kaufen", (r) => +r.dataset.technik >= 0.1], ["Technik: Verkaufen", (r) => +r.dataset.technik <= -0.1]],
  };

  function zahlAusText(t) {
    if (!t) return null;
    t = t.replace(/−/g, "-").replace(/\s/g, " ").trim();
    if (t === "–" || t === "-" || t === "") return null;
    const m = t.match(/-?[\d.]*\d(?:,\d+)?/);
    if (!m) return null;
    let x = parseFloat(m[0].replace(/\./g, "").replace(",", "."));
    if (/Bio\./.test(t)) x *= 1e12; else if (/Mrd\./.test(t)) x *= 1e9; else if (/Mio\./.test(t)) x *= 1e6;
    return x;
  }
  function sortWert(td) {
    const akku = $(".akku", td);
    if (akku) return parseFloat(akku.style.getPropertyValue("--s")) || 0;
    if (td.classList.contains("name")) return ($("a", td) || td).textContent.trim().toLowerCase();
    return zahlAusText(($("[data-live]", td) || td).textContent);
  }

  function screener(rahmen, typ) {
    const tabelle = $("table", rahmen);
    if (!tabelle || rahmen.dataset.screener) return;
    rahmen.dataset.screener = "1";
    const zeilen = () => $$("tbody tr[data-slug]", tabelle);
    const mitSzenarien = !!window.WBSzenario && zeilen().some((r) => window.WBSzenario.hat(r.dataset.slug));
    const leiste = document.createElement("div");
    leiste.className = "screener";
    const chips = CHIPS[typ] || CHIPS.standard;
    leiste.innerHTML = `<label class="unsichtbar" for="filter-${typ}">Tabelle filtern</label>
      <input type="search" class="screener-text" id="filter-${typ}" placeholder="Filtern" autocomplete="off">
      <div class="chips" role="group" aria-label="Filter">${chips.map((c, i) => `<button type="button" class="chip" data-chip="${i}" aria-pressed="false">${esc(c[0])}</button>`).join("")}</div>
      <span class="screener-zahl klein" aria-live="polite"></span>
      <div class="ansicht" role="group" aria-label="Ansicht"><button type="button" class="ansicht-knopf" data-ansicht="tabelle" aria-pressed="true">Tabelle</button><button type="button" class="ansicht-knopf" data-ansicht="heatmap" aria-pressed="false">Heatmap</button>${mitSzenarien ? `<button type="button" class="ansicht-knopf" data-ansicht="szenarien" aria-pressed="false">Szenarien</button>` : ""}</div>`;
    rahmen.before(leiste);
    const hm = document.createElement("div");
    hm.className = "heatmap-huelle"; hm.hidden = true; hm.dataset.typ = typ;
    rahmen.after(hm);
    // Szenarien im Vergleich (assets/szenarien.js): dieselben Zeilen in derselben Reihenfolge und mit demselben Filter
    const sv = document.createElement("div");
    sv.className = "szenario-huelle"; sv.hidden = true; sv.dataset.szVergleich = typ;
    sv.wbNeu = () => window.WBSzenario.vergleich(sv, typ, zeilen().filter((r) => !r.hidden).map((r) => r.dataset.slug));
    hm.after(sv);

    function anwenden() {
      const text = $(".screener-text", leiste).value.trim().toLowerCase();
      const aktiv = $$(".chip[aria-pressed='true']", leiste).map((c) => chips[+c.dataset.chip][1]);
      let n = 0;
      zeilen().forEach((r) => {
        const passt = (!text || r.textContent.toLowerCase().includes(text)) && aktiv.every((f) => f(r));
        r.hidden = !passt; if (passt) n++;
      });
      $(".screener-zahl", leiste).textContent = n === zeilen().length ? "" : `${n} von ${zeilen().length}`;
      if (!hm.hidden) heatmap(hm);
      if (!sv.hidden) sv.wbNeu();
    }
    leiste.addEventListener("input", anwenden);
    document.addEventListener("fathom:signale", anwenden);   // eigene Regeln oder Live-Kurse haben Punkte verändert
    leiste.addEventListener("click", (e) => {
      const c = e.target.closest(".chip");
      if (c) { c.setAttribute("aria-pressed", String(c.getAttribute("aria-pressed") !== "true")); anwenden(); return; }
      const a = e.target.closest(".ansicht-knopf");
      if (a) zeigeAnsicht(a.dataset.ansicht, true);
    });
    function zeigeAnsicht(art, merken) {
      if (art === "szenarien" && !mitSzenarien) art = "tabelle";
      $$(".ansicht-knopf", leiste).forEach((k) => k.setAttribute("aria-pressed", String(k.dataset.ansicht === art)));
      rahmen.hidden = art !== "tabelle"; hm.hidden = art !== "heatmap"; sv.hidden = art !== "szenarien";
      if (art === "heatmap") heatmap(hm);
      if (art === "szenarien") sv.wbNeu();
      if (merken) schreib("fathom.ansicht." + typ, art);
    }
    document.addEventListener("wb:szenario", () => { if (!sv.hidden) sv.wbNeu(); });
    const gemerkt = lies("fathom.ansicht." + typ);
    if (gemerkt === "heatmap" || gemerkt === "szenarien") zeigeAnsicht(gemerkt, false);

    // Sortieren per Klick auf den Spaltenkopf (nochmal klicken kehrt um)
    $$("thead th", tabelle).forEach((th, i) => {
      th.classList.add("sortierbar"); th.tabIndex = 0;
      const sortieren = (e) => {
        if (e.target.closest(".def")) return;
        const auf = th.getAttribute("aria-sort") !== "ascending";
        $$("thead th", tabelle).forEach((x) => x.removeAttribute("aria-sort"));
        th.setAttribute("aria-sort", auf ? "ascending" : "descending");
        const tb = $("tbody", tabelle);
        zeilen().map((r) => [r, sortWert(r.children[i])]).sort((a, b) => {
          if (a[1] == null) return 1; if (b[1] == null) return -1;
          const v = typeof a[1] === "string" ? a[1].localeCompare(b[1], "de") : a[1] - b[1];
          return auf ? v : -v;
        }).forEach(([r]) => tb.appendChild(r));
      };
      th.addEventListener("click", sortieren);
      th.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); sortieren(e); } });
    });
  }

  /* ================================================================ Heatmap (Treemap) */
  let hmMass = lies("fathom.heatmap.mass") || "auto";

  function squarify(items, x, y, w, h) {
    const summe = items.reduce((s, i) => s + i.v, 0) || 1;
    let rest = items.map((i) => Object.assign({}, i, { a: (i.v / summe) * w * h }));
    const aus = [];
    const schlechteste = (reihe, s) => {
      const sum = reihe.reduce((t, r) => t + r.a, 0), max = Math.max(...reihe.map((r) => r.a)), min = Math.min(...reihe.map((r) => r.a));
      return Math.max((s * s * max) / (sum * sum), (sum * sum) / (s * s * min));
    };
    while (rest.length) {
      const kurz = Math.min(w, h);
      let reihe = [rest[0]], i = 1;
      while (i < rest.length && schlechteste(reihe.concat(rest[i]), kurz) <= schlechteste(reihe, kurz)) { reihe.push(rest[i]); i++; }
      const flaeche = reihe.reduce((t, r) => t + r.a, 0);
      if (w >= h) {
        const rw = flaeche / h; let yy = y;
        reihe.forEach((r) => { const rh = r.a / rw; aus.push(Object.assign(r, { x, y: yy, w: rw, h: rh })); yy += rh; });
        x += rw; w -= rw;
      } else {
        const rh = flaeche / w; let xx = x;
        reihe.forEach((r) => { const rw = r.a / rh; aus.push(Object.assign(r, { x: xx, y, w: rw, h: rh })); xx += rw; });
        y += rh; h -= rh;
      }
      rest = rest.slice(reihe.length);
    }
    return aus;
  }

  function heatmap(huelle) {
    const typ = huelle.dataset.typ;
    const rahmen = huelle.previousElementSibling;
    const zeilen = $$("tbody tr[data-slug]", rahmen).filter((r) => !r.hidden);
    const live = zeilen.some((r) => aktuell(r.dataset.slug).heute != null);
    const mass = hmMass === "auto" ? (live ? "1T" : "1W") : hmMass;
    const spanne = { "1T": 0.03, "1W": 0.08, "YTD": 0.3 }[mass];
    const daten = zeilen.map((r) => {
      const b = basis.werte[r.dataset.slug] || {};
      const v = mass === "1T" ? aktuell(r.dataset.slug).heute : mass === "1W" ? b.rendite_1w : b.rendite_ytd;
      return { slug: r.dataset.slug, name: b.name, symbol: b.symbol, gruppe: typ === "aktie" ? (b.sektor || "Sonstige") : null,
               v: typ === "aktie" ? Math.max(b.boersenwert_eur || 1e9, 1e9) : 1, wert: v };
    });
    const breite = huelle.clientWidth || 800, hoehe = breite < 640 ? 420 : 460;
    const gruppen = {};
    daten.forEach((d) => (gruppen[d.gruppe || ""] = gruppen[d.gruppe || ""] || []).push(d));
    const gListe = Object.entries(gruppen).map(([g, l]) => ({ g, l: l.sort((a, b) => b.v - a.v), v: l.reduce((s, d) => s + d.v, 0) })).sort((a, b) => b.v - a.v);
    let html = "";
    squarify(gListe, 0, 0, breite, hoehe).forEach((g) => {
      const kopf = g.g && g.h > 40 ? 18 : 0;
      if (kopf) html += `<div class="hm-gruppe" style="left:${g.x}px;top:${g.y}px;width:${g.w}px">${esc(g.g)}</div>`;
      squarify(g.l, g.x, g.y + kopf, g.w, g.h - kopf).forEach((d) => {
        const anteil = d.wert == null ? 0 : Math.min(1, Math.abs(d.wert) / spanne);
        const farbe = d.wert == null ? "var(--hm-neutral)" : `color-mix(in srgb, ${d.wert >= 0 ? "var(--hm-plus)" : "var(--hm-minus)"} ${Math.round(18 + anteil * 82)}%, var(--hm-neutral))`;
        const gross = d.w > 70 && d.h > 38;
        html += `<a class="hm-zelle${anteil > 0.45 ? " kraeftig" : ""}" href="#${esc(d.slug)}" style="left:${d.x}px;top:${d.y}px;width:${d.w}px;height:${d.h}px;background:${farbe}" title="${esc(d.name)}: ${pct(d.wert)} (${mass})">` +
          (d.w > 34 && d.h > 22 ? `<span class="hm-name">${esc(gross ? d.name : d.symbol.split(".")[0])}</span>` + (d.h > 40 ? `<span class="hm-wert">${pct(d.wert)}</span>` : "") : "") + `</a>`;
      });
    });
    huelle.innerHTML = `<div class="hm-leiste"><span class="klein">${typ === "aktie" ? "Fläche: Börsenwert, gruppiert nach Sektor. " : ""}Farbe: Veränderung ${mass === "1T" ? "heute" : mass === "1W" ? "über eine Woche" : "seit Jahresbeginn"}</span>
      <div class="ansicht" role="group" aria-label="Zeitraum">${["1T", "1W", "YTD"].map((m) => `<button type="button" class="ansicht-knopf" data-mass="${m}" aria-pressed="${m === mass}">${m}</button>`).join("")}</div></div>
      <div class="heatmap" style="height:${hoehe}px">${html || '<p class="leer">Keine Werte für diese Auswahl.</p>'}</div>`;
  }
  document.addEventListener("click", (e) => {
    const m = e.target.closest("[data-mass]");
    if (m) { hmMass = m.dataset.mass; schreib("fathom.heatmap.mass", hmMass); $$(".heatmap-huelle:not([hidden])").forEach(heatmap); }
  });
  window.WBHeatmap = () => $$(".heatmap-huelle:not([hidden])").forEach(heatmap);
  setInterval(() => { if (window.WBLive && Object.keys(window.WBLive.stand).length) window.WBHeatmap(); }, 5000);
  window.addEventListener("resize", () => { clearTimeout(window.__hmT); window.__hmT = setTimeout(window.WBHeatmap, 200); });

  /* ================================================================ Depot (Portfolio Performance, Parqet) */
  const DEPOT = "fathom.depot";
  const SPALTEN = {
    datum: ["datum", "date", "datetime", "valuta", "buchungsdatum", "handelstag"],
    typ: ["typ", "type", "transaktion", "art", "buchungsart"],
    isin: ["isin", "identifier"], wkn: ["wkn"], symbol: ["tickersymbol", "ticker", "symbol"],
    name: ["wertpapiername", "wertpapier", "securityname", "name", "bezeichnung"],
    stueck: ["stück", "stueck", "shares", "anzahl", "menge"],
    kurs: ["kurs", "price", "preis", "quote"],
    betrag: ["wert", "betrag", "value", "amount", "gesamtbetrag", "bruttobetrag"],
    gebuehren: ["gebühren", "gebuehren", "fee", "fees"], steuern: ["steuern", "tax", "taxes"],
    waehrung: ["buchungswährung", "transaktionswährung", "währung", "waehrung", "currency"],
  };
  const KAUF = /^(kauf|buy|einlieferung|delivery.?\(?inbound|transferin|transfer.?\(?inbound|sparplan)/i;
  const VERKAUF = /^(verkauf|sell|auslieferung|delivery.?\(?outbound|transferout|transfer.?\(?outbound)/i;

  function zahl(t) {
    if (t == null) return null;
    t = String(t).trim().replace(/[^\d,.\-−]/g, "").replace("−", "-");
    if (!t) return null;
    if (t.includes(",") && t.includes(".")) t = t.lastIndexOf(",") > t.lastIndexOf(".") ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
    else if (t.includes(",")) t = t.replace(",", ".");
    const x = parseFloat(t);
    return isFinite(x) ? x : null;
  }
  function csvZeilen(text) {
    text = text.replace(/^\uFEFF/, "");
    const erste = text.split(/\r?\n/)[0];
    const trenner = [";", "\t", ","].sort((a, b) => erste.split(b).length - erste.split(a).length)[0];
    const zeilen = []; let feld = "", zeile = [], inQ = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQ) { if (c === '"' && text[i + 1] === '"') { feld += '"'; i++; } else if (c === '"') inQ = false; else feld += c; }
      else if (c === '"') inQ = true;
      else if (c === trenner) { zeile.push(feld); feld = ""; }
      else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; zeile.push(feld); if (zeile.some((f) => f.trim())) zeilen.push(zeile); zeile = []; feld = ""; }
      else feld += c;
    }
    zeile.push(feld); if (zeile.some((f) => f.trim())) zeilen.push(zeile);
    return zeilen;
  }
  function einlesen(text) {
    const zeilen = csvZeilen(text);
    if (zeilen.length < 2) throw new Error("Die Datei enthält keine Umsätze.");
    const kopf = zeilen[0].map((h) => h.toLowerCase().replace(/[\s\-_.()]/g, ""));
    const idx = {};
    Object.entries(SPALTEN).forEach(([k, namen]) => { idx[k] = kopf.findIndex((h) => namen.includes(h)); });
    if (idx.stueck < 0 || (idx.isin < 0 && idx.symbol < 0 && idx.name < 0 && idx.wkn < 0))
      throw new Error("Spalten für Stückzahl und Wertpapier (ISIN, Ticker oder Name) nicht gefunden.");
    const t = [];
    zeilen.slice(1).forEach((z) => {
      const g = (k) => (idx[k] >= 0 ? (z[idx[k]] || "").trim() : "");
      const typ = g("typ");
      const richtung = !typ ? (zahl(g("betrag")) < 0 ? 1 : -1) : KAUF.test(typ) ? 1 : VERKAUF.test(typ) ? -1 : 0;
      const stueck = Math.abs(zahl(g("stueck")) || 0);
      if (!richtung || !stueck) return;
      const kurs = zahl(g("kurs"));
      let betrag = Math.abs(zahl(g("betrag")) || 0);
      if (!betrag && kurs) betrag = stueck * kurs + (richtung > 0 ? Math.abs(zahl(g("gebuehren")) || 0) : 0);
      t.push({ datum: g("datum").slice(0, 10), richtung, stueck, betrag, kurs: kurs || (betrag && stueck ? betrag / stueck : null),
               gebuehren: Math.abs(zahl(g("gebuehren")) || 0), steuern: Math.abs(zahl(g("steuern")) || 0),
               isin: g("isin").toUpperCase(), wkn: g("wkn"), symbol: g("symbol"), name: g("name"), waehrung: g("waehrung") || "EUR" });
    });
    if (!t.length) throw new Error("Keine Käufe oder Verkäufe erkannt.");
    return t;
  }
  function positionen(trans) {
    const p = {};
    trans.slice().sort((a, b) => a.datum.localeCompare(b.datum)).forEach((x) => {
      const k = x.isin || x.symbol || x.wkn || x.name;
      const q = (p[k] = p[k] || { isin: x.isin, symbol: x.symbol, name: x.name, stueck: 0, einstand: 0 });
      if (x.richtung > 0) { q.stueck += x.stueck; q.einstand += x.betrag; }
      else if (q.stueck > 0) { const anteil = Math.min(1, x.stueck / q.stueck); q.einstand *= 1 - anteil; q.stueck -= x.stueck; }
      q.name = q.name || x.name;
    });
    return Object.values(p).filter((q) => q.stueck > 1e-9);
  }
  function zuordnen(q) {
    return Object.entries(basis.werte).find(([, b]) => (q.isin && b.isin === q.isin) || (q.symbol && b.symbol && b.symbol.split(".")[0] === q.symbol.split(".")[0]));
  }
  function depotLaden() { try { return JSON.parse(lies(DEPOT) || "null"); } catch (e) { return null; } }

  function depotSpeichern(d) { schreib(DEPOT, d && d.transaktionen.length ? JSON.stringify(d) : null); }
  function schluessel(x) { return x.isin || x.symbol || x.wkn || x.name; }
  const serverDa = () => window.WBWatchlist ? window.WBWatchlist.server() : Promise.resolve(false);

  // Positionen bewerten: Kurs von der Watchlist (live oder Wochenstand), sonst nur Einstand
  function bewerten() {
    const d = depotLaden();
    if (!d) return null;
    const pos = positionen(d.transaktionen);
    let wert = 0, einstand = 0, bewertet = 0;
    const zeilen = pos.map((q) => {
      const treffer = zuordnen(q);
      let w = null;
      if (treffer) {
        const [slug, b] = treffer, a = aktuell(slug), fx = (basis.fx || {})[b.waehrung] || (b.waehrung === "EUR" ? 1 : null);
        if (a.kurs && fx) { w = q.stueck * a.kurs * fx; wert += w; einstand += q.einstand; bewertet++; }
      }
      return { q, treffer, w, typ: treffer ? treffer[1].typ : (q.typ || "aktie") };
    }).sort((a, b) => (b.w || 0) - (a.w || 0));
    return { d, pos, zeilen, wert, einstand, bewertet };
  }

  // Depot-Röntgen: Signale, Währungen, Earnings und Klumpen der bewerteten Positionen
  const punkteVon = (slug) => (window.WBRegeln ? window.WBRegeln.punkte(slug) : null);
  let roentgenNr = 0;
  function roentgen(z) {
    const bew = z.zeilen.filter((x) => x.w != null && x.treffer);
    if (!bew.length || !z.wert) return "";
    const anteil = (w) => w / z.wert;
    const p0 = (x) => nf(0).format(x * 100) + " %";
    // 1. Signale nach Wert
    const zustand = (slug) => (window.WBRegeln ? window.WBRegeln.status(slug) : null);
    const stufen = [
      { name: "Treffer", klasse: "rs-3", f: (r) => r && r.treffer },
      { name: "ein Signal fehlt", klasse: "rs-2", f: (r) => r && r.knapp },
      { name: "übrige", klasse: "rs-0", f: (r) => r && !r.treffer && !r.knapp },
      { name: "ohne Signale (ETF)", klasse: "rs-ohne", f: (r) => !r },
    ].map((s) => {
      const drin = bew.filter((x) => s.f(x.treffer[1].typ === "etf" ? null : zustand(x.treffer[0])));
      return Object.assign(s, { w: drin.reduce((a, x) => a + x.w, 0), namen: drin.map((x) => x.treffer[1].name) });
    }).filter((s) => s.w > 0);
    const balken = `<div class="rs-balken" role="img" aria-label="${esc(stufen.map((s) => `${s.name} ${p0(anteil(s.w))}`).join(", "))}">${stufen.map((s) =>
      `<span class="${s.klasse}" style="flex-grow:${s.w}" title="${esc(s.name)}: ${p0(anteil(s.w))}, ${esc(s.namen.join(", "))}"></span>`).join("")}</div>
      <ul class="rs-legende">${stufen.map((s) => `<li><i class="${s.klasse}"></i><span>${esc(s.name)}</span><b>${p0(anteil(s.w))}</b><span class="rs-namen">${esc(s.namen.join(", "))}</span></li>`).join("")}</ul>`;
    // 2. Währungen, verknüpft mit den Forex-Signalen der Watchlist
    const wae = {};
    bew.forEach((x) => { const c = x.treffer[1].waehrung || "EUR"; wae[c] = (wae[c] || 0) + x.w; });
    const waeListe = Object.entries(wae).sort((a, b) => b[1] - a[1]);
    const fremd = waeListe.filter(([c]) => c !== "EUR").reduce((a, [, w]) => a + w, 0);
    const paar = (c) => Object.entries(basis.werte).find(([, b]) => b.typ === "forex" && (b.symbol || "").toUpperCase() === `EUR${c}=X`);
    const waehrungen = `<ul class="rx-liste">${waeListe.map(([c, w]) => {
      const fx = c === "EUR" ? null : paar(c);
      const hinweis = c === "EUR" ? "kein Währungsrisiko"
        : fx ? `<a href="#${esc(fx[0])}">${esc(fx[1].name)}</a> erfüllt ${punkteVon(fx[0])} von ${(zustand(fx[0]) || {}).max || 4} Signalen für den Euro. Ein stärkerer Euro senkt den Euro-Wert dieser Positionen.`
        : `EUR/${esc(c)} steht nicht auf der Watchlist, über die Suche lässt sich das Paar hinzufügen.`;
      return `<li><div class="rx-zeile"><b>${esc(c)}</b><span>${p0(anteil(w))}</span></div><div class="rx-spur"><i style="width:${(anteil(w) * 100).toFixed(1)}%"></i></div><p>${hinweis}</p></li>`;
    }).join("")}</ul>`;
    // 3. Earnings in den nächsten Tagen
    const ear = bew.filter((x) => x.treffer[1].earnings).sort((a, b) => a.treffer[1].earnings.localeCompare(b.treffer[1].earnings));
    const earW = ear.reduce((a, x) => a + x.w, 0);
    const tag = (d) => new Date(d + "T12:00:00").toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" });
    const earnings = ear.length
      ? `<p class="rx-gross">${p0(anteil(earW))}</p><p>deines bewerteten Depots berichten in den nächsten ${basis.zahlen_warnung_tage || 14} Tagen Quartalszahlen.</p>
         <ul class="rx-termine">${ear.map((x) => `<li><span>${tag(x.treffer[1].earnings)}</span><a href="#${esc(x.treffer[0])}">${esc(x.treffer[1].name)}</a><b>${p0(anteil(x.w))}</b></li>`).join("")}</ul>`
      : `<p class="rx-gross">0 %</p><p>Keine Position berichtet in den nächsten ${basis.zahlen_warnung_tage || 14} Tagen Quartalszahlen.</p>`;
    // 4. Klumpen: größte Position und größter Sektor
    const groesste = bew.slice().sort((a, b) => b.w - a.w)[0];
    const sek = {};
    bew.forEach((x) => { const s = x.treffer[1].sektor || (x.treffer[1].typ === "etf" ? "Breit gestreut (ETF)" : "Ohne Sektor"); sek[s] = (sek[s] || 0) + x.w; });
    const sekGr = Object.entries(sek).sort((a, b) => b[1] - a[1])[0];
    const klumpen = `<dl class="rx-klumpen">
      <div><dt>Größte Position</dt><dd><b>${p0(anteil(groesste.w))}</b> ${esc(groesste.treffer[1].name)}</dd></div>
      <div><dt>Größter Sektor</dt><dd><b>${p0(anteil(sekGr[1]))}</b> ${esc(sekGr[0])}</dd></div>
      <div><dt>Fremdwährung</dt><dd><b>${p0(anteil(fremd))}</b> nicht in Euro notiert</dd></div>
    </dl>`;
    const ohne = z.zeilen.length - bew.length;
    const id = "roentgen-titel-" + ++roentgenNr;  // das Röntgen steht auf der Seite zweimal (Portfolio-Ansicht und Depot)
    return `<section class="roentgen" aria-labelledby="${id}">
      <h3 id="${id}">Depot-Röntgen</h3>
      <p class="klein rx-unter">Anteile am Wert der ${bew.length} bewerteten Positionen${ohne ? `, ${ohne} ohne Kurs nicht eingerechnet` : ""}. Signale ${window.WBRegeln && ["aktie", "forex", "rohstoff", "index"].some(window.WBRegeln.istEigen) ? "nach deiner eigenen Auswahl" : "nach der Auswahl in config.yaml"}.</p>
      <div class="rx-gitter">
        <div class="rx-feld rx-breit"><h4>Wie viel deines Depots Treffer sind</h4>${balken}</div>
        <div class="rx-feld"><h4>Währungen</h4>${waehrungen}</div>
        <div class="rx-feld"><h4>Earnings-Risiko</h4>${earnings}</div>
        <div class="rx-feld"><h4>Klumpen</h4>${klumpen}</div>
        ${window.WBSzenario ? window.WBSzenario.depotFeld(bew.map((x) => ({ slug: x.treffer[0], w: x.w }))) : ""}
      </div></section>`;
  }

  function tabelle(z, mitAktionen, server) {
    const { zeilen, wert, einstand, bewertet, pos } = z;
    const gv = wert - einstand;
    const fehlen = zeilen.filter((x) => !x.treffer);
    return `<dl class="lage depot-lage">
        <div class="lage-feld"><dt>Wert der bewerteten Positionen</dt><dd class="lage-wert">${nf(0).format(wert)}<span> €</span></dd><dd class="lage-namen">${bewertet} von ${pos.length} Positionen mit Kurs von der Watchlist</dd></div>
        <div class="lage-feld"><dt>Einstand</dt><dd class="lage-wert">${nf(0).format(einstand)}<span> €</span></dd><dd class="lage-namen">Durchschnittskosten der bewerteten Positionen</dd></div>
        <div class="lage-feld"><dt>Gewinn oder Verlust</dt><dd class="lage-wert ${gv >= 0 ? "plus" : "minus"}">${(gv >= 0 ? "+" : "−") + nf(0).format(Math.abs(gv))}<span> €</span></dd><dd class="lage-namen">${einstand ? pct(gv / einstand) : "–"} auf den Einstand</dd></div>
      </dl>
      ${roentgen(z)}
      ${mitAktionen && fehlen.length ? `<p class="fehlen-hinweis">${fehlen.length} ${fehlen.length === 1 ? "Position steht" : "Positionen stehen"} noch nicht auf der Watchlist und ${fehlen.length === 1 ? "hat" : "haben"} deshalb keinen Kurs und keine Analyse.
        ${server ? `<button type="button" class="knopf primaer" data-alle-watchlist>Alle ${fehlen.length} auf die Watchlist</button>` : `Mit dem lokalen Server (<code>python live.py</code>) lassen sie sich hier mit einem Klick hinzufügen.`}</p>` : ""}
      <div class="tabelle-rahmen"><table class="depot-tabelle"><thead><tr><th>Position</th><th>Stück</th><th>Einstand</th><th class="nur-gross">Kurs</th><th>Wert</th><th>G/V</th><th class="nur-gross">Anteil</th><th class="nur-breit">Signale</th>${mitAktionen ? "<th></th>" : ""}</tr></thead><tbody>
      ${zeilen.map(({ q, treffer, w }) => {
        const b = treffer ? treffer[1] : null, gvq = w != null ? w - q.einstand : null;
        const signale = treffer ? $(`#kachel-aktie tr[data-slug="${treffer[0]}"] td.nur-klein .akkus, tr[data-slug="${treffer[0]}"] td.nur-klein .akkus`) : null;
        const aktion = !mitAktionen ? "" : `<td class="aktionen">${!treffer && server ? `<button type="button" class="knopf-text" data-position-watchlist="${esc(schluessel(q))}">Auf die Watchlist</button>` : ""}<button type="button" class="knopf-text leise" data-position-entfernen="${esc(schluessel(q))}">Entfernen</button></td>`;
        return `<tr${treffer ? ` data-depot-slug="${esc(treffer[0])}"` : ""}><td class="name">${treffer ? `<a href="#${esc(treffer[0])}">${esc(b.name)}</a>` : esc(q.name || q.isin || q.symbol)}<span class="unter">${esc(q.isin || q.symbol || "")}${treffer ? "" : (q.isin || q.symbol ? ", " : "") + "nicht auf der Watchlist"}</span></td>
          <td>${nf(q.stueck % 1 ? 3 : 0).format(q.stueck)}</td><td>${nf(0).format(q.einstand)} €</td>
          <td class="nur-gross">${b ? nf(b.dez || 2).format(aktuell(treffer[0]).kurs) + " " + esc(b.waehrung || "") : "–"}</td>
          <td>${w != null ? nf(0).format(w) + " €" : "–"}</td>
          <td class="${gvq == null ? "" : gvq >= 0 ? "plus" : "minus"}">${gvq == null ? "–" : pct(gvq / q.einstand)}</td>
          <td class="nur-gross">${w != null && wert ? nf(1).format((w / wert) * 100) + " %" : "–"}</td>
          <td class="nur-breit">${signale ? signale.outerHTML : "–"}</td>${aktion}</tr>`;
      }).join("")}</tbody></table></div>`;
  }

  async function depotZeigen() {
    const z = bewerten();
    $$("tr.im-depot").forEach((r) => r.classList.remove("im-depot"));
    $$(".depot-marke").forEach((m) => m.remove());
    $$("[data-export='parqet'], [data-export='loeschen']").forEach((k) => (k.disabled = !z));
    const server = await serverDa();
    if (!z) {
      if ($("#depot-zahl")) $("#depot-zahl").textContent = "–";
      if ($("#portfolio-anzahl")) $("#portfolio-anzahl").textContent = "";
      if ($("#depot-inhalt")) $("#depot-inhalt").innerHTML = "";
      const ap = $("#aktien-portfolio-inhalt");
      if (ap) ap.innerHTML = `<div class="leer-zustand"><p class="leer-titel">Noch keine Positionen</p><ol class="leer-schritte">
        <li><b>Suchen</b><span>Aktie oben über Name, Kürzel oder ISIN finden.</span></li>
        <li><b>Erfassen</b><span>„Ins Portfolio“ wählen und Stück, Kaufkurs und Datum eintragen.</span></li>
        <li><b>Oder einfügen</b><span>Eine ganze Liste oder die CSV aus Portfolio Performance oder Parqet unten einfügen.</span></li></ol>
        <p class="klein">Dein Portfolio bleibt in diesem Browser und wird nirgends hochgeladen.</p></div>`;
      if ($("#portfolio-einfuegen")) $("#portfolio-einfuegen").open = true;
      document.dispatchEvent(new CustomEvent("wb:depot"));
      return;
    }
    z.zeilen.forEach(({ q, treffer }) => {
      if (!treffer) return;
      $$(`tr[data-slug="${treffer[0]}"]`).forEach((r) => {
        r.classList.add("im-depot");
        const n = $("td.name", r);
        if (n && !$(".depot-marke", n)) n.insertAdjacentHTML("beforeend", `<span class="depot-marke">Im Portfolio, ${nf(q.stueck % 1 ? 2 : 0).format(q.stueck)} Stück</span>`);
      });
    });
    if ($("#depot-zahl")) $("#depot-zahl").textContent = String(z.pos.length);
    if ($("#depot-info")) $("#depot-info").textContent = z.bewertet ? `${nf(0).format(z.wert)} € bewertet` : "eingelesen";
    if ($("#depot-stand")) $("#depot-stand").textContent = `${z.d.datei}, zuletzt geändert am ${new Date(z.d.zeit).toLocaleDateString("de-DE")}: ${z.d.transaktionen.length} Umsätze, ${z.pos.length} Positionen.`;
    if ($("#depot-inhalt")) $("#depot-inhalt").innerHTML = tabelle(z, true, server);
    // In der Aktien-Kachel: nur Aktien (und Positionen, die noch keiner Klasse zugeordnet sind)
    const nurAktien = Object.assign({}, z, { zeilen: z.zeilen.filter((x) => x.typ === "aktie") });
    nurAktien.pos = nurAktien.zeilen.map((x) => x.q);
    nurAktien.wert = nurAktien.zeilen.reduce((s, x) => s + (x.w || 0), 0);
    nurAktien.einstand = nurAktien.zeilen.filter((x) => x.w != null).reduce((s, x) => s + x.q.einstand, 0);
    nurAktien.bewertet = nurAktien.zeilen.filter((x) => x.w != null).length;
    const ap = $("#aktien-portfolio-inhalt");
    if (ap) ap.innerHTML = nurAktien.zeilen.length ? tabelle(nurAktien, true, server) : `<p class="leer">Im Portfolio sind noch keine Aktien.</p>`;
    if ($("#portfolio-anzahl")) $("#portfolio-anzahl").textContent = nurAktien.zeilen.length ? String(nurAktien.zeilen.length) : "";
    document.dispatchEvent(new CustomEvent("wb:depot"));
  }

  // Neue Umsätze übernehmen. Eingelesene Dateien ersetzen frühere Importe; von Hand Erfasstes bleibt erhalten.
  function umsaetzeHinzufuegen(neu, quelle, ersetzen) {
    const d = depotLaden() || { datei: quelle, zeit: Date.now(), transaktionen: [] };
    const behalten = ersetzen ? d.transaktionen.filter((t) => t.quelle === "manuell") : d.transaktionen;
    depotSpeichern({ datei: ersetzen ? quelle : d.datei, zeit: Date.now(), transaktionen: behalten.concat(neu) });
    depotZeigen();
  }

  function datei(f) {
    if (!f) return;
    const melden = (text) => { ["#depot-stand", "#portfolio-meldung"].forEach((s) => { if ($(s)) $(s).textContent = text; }); };
    const uebernehmen = (text) => {
      try { umsaetzeHinzufuegen(einlesen(text), f.name, true); melden(`${f.name} eingelesen.`); }
      catch (e) { melden("Die Datei konnte nicht gelesen werden: " + e.message); }
    };
    const r = new FileReader();
    r.onload = () => {
      if (String(r.result).includes("\uFFFD")) { const r2 = new FileReader(); r2.onload = () => uebernehmen(r2.result); r2.readAsText(f, "windows-1252"); return; }
      uebernehmen(r.result);
    };
    r.readAsText(f, "utf-8");
  }

  // Eingefügter Text: CSV mit Kopfzeile oder einfache Zeilen „Kennung; Stück; Kaufkurs; Datum“
  const ISIN = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/;
  function textEinfuegen(text) {
    const zeilen = text.split(/\r?\n/).map((z) => z.trim()).filter(Boolean);
    if (!zeilen.length) throw new Error("Bitte mindestens eine Zeile einfügen.");
    const kopf = zeilen[0].toLowerCase();
    if (/(isin|wertpapier|stück|shares|ticker|identifier)/.test(kopf) && /(;|\t|,)/.test(kopf)) return einlesen(text).map((t) => Object.assign(t, { quelle: "eingefuegt" }));
    const heute = new Date().toISOString().slice(0, 10);
    return zeilen.map((z, i) => {
      const f = z.split(/\t|;/).map((x) => x.trim());
      if (f.length < 2) throw new Error(`Zeile ${i + 1}: Kennung und Stückzahl durch Semikolon trennen.`);
      const kennung = f[0], stueck = zahl(f[1]), kurs = zahl(f[2]);
      if (!stueck) throw new Error(`Zeile ${i + 1}: Stückzahl fehlt.`);
      const treffer = Object.values(basis.werte).find((b) => b.isin === kennung.toUpperCase() || (b.symbol || "").toUpperCase() === kennung.toUpperCase()
        || (b.name || "").toLowerCase() === kennung.toLowerCase());
      const isin = ISIN.test(kennung.toUpperCase()) ? kennung.toUpperCase() : (treffer && treffer.isin) || "";
      return { datum: /^\d{4}-\d{2}-\d{2}$/.test(f[3] || "") ? f[3] : heute, richtung: 1, stueck, kurs: kurs || null,
               betrag: kurs ? stueck * kurs : 0, gebuehren: 0, steuern: 0, isin, wkn: "",
               symbol: treffer ? treffer.symbol : (isin ? "" : kennung), name: treffer ? treffer.name : kennung,
               waehrung: "EUR", quelle: "manuell", typ: treffer ? treffer.typ : "aktie" };
    });
  }

  async function aufWatchlist(eintraege, text) {
    if (!window.WBWatchlist) return;
    try {
      await window.WBWatchlist.hinzufuegen(eintraege.length === 1 ? eintraege[0] : { eintraege }, text, "aktie");
    } catch (e) { window.WBWatchlist.hinweis("Hinzufügen fehlgeschlagen: " + esc(e.message)); }
  }

  /* ---------------------------------------------------------------- Aktien zusammenstellen */
  let gewaehlt = null, suchT = null, suchAbbruch = null;
  function trefferZeigen(liste, q, server) {
    const ul = $("#komponist-treffer");
    const zeile = (r) => `<li class="treffer"><span class="treffer-text"><span class="treffer-name">${esc(r.name)}</span>
        <span class="treffer-info">${esc(r.symbol)}${r.boerse ? ", " + esc(r.boerse) : ""}${r.de_boersen && r.de_boersen.length ? ", handelbar an " + esc(r.de_boersen.join(", ")) : ""}</span></span>
        <span class="treffer-knoepfe">${r.auf_watchlist ? `<span class="treffer-marke">Auf der Watchlist</span>` : server ? `<button type="button" class="treffer-knopf komponist-knopf" data-zur-watchlist='${esc(JSON.stringify({ symbol: r.symbol, name: r.name, typ: r.typ, isin: r.isin || null }))}'>Zur Watchlist</button>` : ""}
        <button type="button" class="treffer-knopf komponist-knopf" data-ins-portfolio='${esc(JSON.stringify(r))}'>Ins Portfolio</button></span></li>`;
    ul.innerHTML = liste.map(zeile).join("") +
      `<li class="treffer manuell"><span class="treffer-text"><span class="treffer-info">${liste.length ? "Nicht dabei?" : server ? "Nichts gefunden, das in Deutschland handelbar ist." : "Neue Aktien findet die Suche mit dem lokalen Server (python live.py)."} Position von Hand erfassen.</span></span>
        <button type="button" class="treffer-knopf komponist-knopf" data-ins-portfolio='${esc(JSON.stringify({ manuell: true, name: q }))}'>Von Hand erfassen</button></li>`;
    ul.hidden = false;
  }
  async function komponistSuchen(text) {
    const q = text.trim(), ql = q.toLowerCase(), ul = $("#komponist-treffer");
    if (q.length < 2) { ul.hidden = true; return; }
    const eigene = Object.values(basis.werte).filter((b) => ["aktie", "etf"].includes(b.typ) && (b.name + " " + b.symbol + " " + (b.isin || "")).toLowerCase().includes(ql))
      .map((b) => ({ symbol: b.symbol, name: b.name, typ: b.typ, isin: b.isin, auf_watchlist: true }));
    const server = await serverDa();
    trefferZeigen(eigene, q, server);
    if (!server) return;
    clearTimeout(suchT);
    suchT = setTimeout(async () => {
      if (suchAbbruch) suchAbbruch.abort();
      suchAbbruch = new AbortController();
      try {
        const j = await (await fetch("api/suche?q=" + encodeURIComponent(q), { signal: suchAbbruch.signal, cache: "no-store" })).json();
        const neu = (j.ergebnisse || []).filter((r) => ["aktie", "etf"].includes(r.typ) && !eigene.some((e) => e.symbol === r.symbol));
        if ($("#komponist-eingabe").value.trim() === q) trefferZeigen(eigene.concat(neu), q, server);
      } catch (e) { /* abgebrochen oder Server weg */ }
    }, 250);
  }
  function formularOeffnen(r) {
    gewaehlt = r;
    const f = $("#position-form");
    f.reset();
    f.classList.toggle("manuell", !!r.manuell);
    $("#position-titel").textContent = r.manuell ? "Position von Hand erfassen" : `${r.name} ins Portfolio aufnehmen`;
    if (r.manuell) { f.name.value = r.name || ""; f.isin.value = ISIN.test((r.name || "").toUpperCase()) ? r.name.toUpperCase() : ""; }
    f.datum.value = new Date().toISOString().slice(0, 10);
    const b = Object.values(basis.werte).find((x) => x.symbol === r.symbol);
    if (b) {
      const slug = Object.keys(basis.werte).find((k) => basis.werte[k] === b), fx = (basis.fx || {})[b.waehrung] || (b.waehrung === "EUR" ? 1 : null);
      const k = aktuell(slug).kurs;
      if (k && fx) f.kurs.value = nf(2).format(k * fx);
    }
    f.watchlist.checked = !r.auf_watchlist;
    f.watchlist.closest("label").hidden = !!r.auf_watchlist;
    f.hidden = false;
    $("#komponist-treffer").hidden = true;
    (r.manuell ? f.name : f.stueck).focus();
  }
  async function formularSpeichern(e) {
    e.preventDefault();
    const f = e.target, r = gewaehlt || {};
    const stueck = zahl(f.stueck.value), kurs = zahl(f.kurs.value);
    const name = r.manuell ? f.name.value.trim() : r.name;
    const isin = r.manuell ? f.isin.value.trim().toUpperCase() : (r.isin || "");
    if (!stueck || !kurs || !name) { $("#position-titel").textContent = "Bitte Name, Stückzahl und Kaufkurs angeben."; return; }
    umsaetzeHinzufuegen([{ datum: f.datum.value || new Date().toISOString().slice(0, 10), richtung: 1, stueck, kurs, betrag: stueck * kurs,
      gebuehren: 0, steuern: 0, isin: ISIN.test(isin) ? isin : "", wkn: "", symbol: r.manuell ? "" : r.symbol, name,
      waehrung: "EUR", quelle: "manuell", typ: r.typ || "aktie" }], "Von Hand erfasst", false);
    f.hidden = true; $("#komponist-eingabe").value = "";
    aktienAnsicht("portfolio", true);
    if (f.watchlist.checked && !f.watchlist.closest("label").hidden && await serverDa())
      await aufWatchlist([{ symbol: r.manuell ? null : r.symbol, name, typ: r.typ || "aktie", isin: ISIN.test(isin) ? isin : null }],
        `„${esc(name)}“ steht jetzt im Portfolio und auf der Watchlist. Die Analyse wird erstellt, die Seite lädt danach neu …`);
  }

  function aktienAnsicht(art, merken) {
    const k = $("#kachel-aktie"); if (!k) return;
    $$("[data-aktien-ansicht]", k).forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.aktienAnsicht === art)));
    const teil = $(".teil", k);
    [$(".screener", teil), $(".tabelle-rahmen", teil)].forEach((el) => { if (el) el.hidden = art === "portfolio"; });
    const hm = $(".heatmap-huelle", teil);
    if (hm && art === "portfolio") hm.hidden = true;
    else if (hm && art === "watchlist") { const hmKnopf = $(".ansicht-knopf[data-ansicht='heatmap'][aria-pressed='true']", teil); hm.hidden = !hmKnopf; if (hmKnopf) $(".tabelle-rahmen", teil).hidden = true; }
    $("#aktien-portfolio").hidden = art !== "portfolio";
    if (merken) schreib("fathom.aktien.ansicht", art);
  }

  function positionEntfernen(key) {
    const d = depotLaden(); if (!d) return;
    d.transaktionen = d.transaktionen.filter((t) => schluessel(t) !== key && (t.isin || t.symbol || t.wkn || t.name) !== key);
    d.zeit = Date.now(); depotSpeichern(d); depotZeigen();
  }

  function herunterladen(name, text) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["\uFEFF" + text], { type: "text/csv;charset=utf-8" }));
    a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function exportieren(art) {
    if (art === "pp") {
      const z = ["Ticker-Symbol;ISIN;Wertpapiername;Währung"].concat(Object.values(basis.werte)
        .filter((b) => ["aktie", "etf"].includes(b.typ)).map((b) => [b.symbol, b.isin || "", b.name, b.waehrung || ""].join(";")));
      herunterladen("fathom-watchlist-portfolio-performance.csv", z.join("\n"));
    } else if (art === "parqet") {
      const d = depotLaden(); if (!d) return;
      const z = ["date;type;identifier;shares;price;amount;fee;tax;currency"].concat(d.transaktionen.map((t) =>
        [t.datum, t.richtung > 0 ? "Buy" : "Sell", t.isin || t.symbol || t.name, t.stueck, (t.kurs || 0).toFixed(6), (t.betrag || 0).toFixed(2),
         (t.gebuehren || 0).toFixed(2), (t.steuern || 0).toFixed(2), t.waehrung || "EUR"].join(";")));
      herunterladen("fathom-portfolio-parqet.csv", z.join("\n"));
    } else if (art === "loeschen") {
      const k = $("[data-export='loeschen']");
      if (!k.dataset.sicher) { k.dataset.sicher = "1"; k.textContent = "Wirklich löschen?"; setTimeout(() => { delete k.dataset.sicher; k.textContent = "Portfolio aus diesem Browser löschen"; }, 4000); return; }
      schreib(DEPOT, null); depotZeigen();
      if ($("#depot-stand")) $("#depot-stand").textContent = "Portfolio gelöscht.";
      if ($("#depot-info")) $("#depot-info").textContent = "Positionen erfassen";
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    $$(".kachel-inhalt").forEach((k) => { const r = $(".tabelle-rahmen", k); if (r && $("tbody tr[data-slug]", r)) screener(r, k.dataset.kachelInhalt); });
    $$("#depot-datei, .portfolio-datei").forEach((ein) => ein.addEventListener("change", () => { datei(ein.files[0]); ein.value = ""; }));
    $$("#kachel-depot, #aktien-portfolio").forEach((zone) => {
      zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("ziehen"); });
      zone.addEventListener("dragleave", () => zone.classList.remove("ziehen"));
      zone.addEventListener("drop", (e) => { e.preventDefault(); zone.classList.remove("ziehen"); datei(e.dataTransfer.files[0]); });
    });
    const ein = $("#komponist-eingabe");
    if (ein) {
      ein.addEventListener("input", () => komponistSuchen(ein.value));
      ein.addEventListener("keydown", (e) => { if (e.key === "Escape") { $("#komponist-treffer").hidden = true; ein.value = ""; } });
      $("#position-form").addEventListener("submit", formularSpeichern);
    }
    document.addEventListener("click", async (e) => {
      const x = e.target.closest("[data-export]"); if (x) { exportieren(x.dataset.export); return; }
      const ans = e.target.closest("[data-aktien-ansicht]"); if (ans) { aktienAnsicht(ans.dataset.aktienAnsicht, true); return; }
      const ins = e.target.closest("[data-ins-portfolio]"); if (ins) { formularOeffnen(JSON.parse(ins.dataset.insPortfolio)); return; }
      if (e.target.closest("[data-position-abbrechen]")) { $("#position-form").hidden = true; return; }
      const zw = e.target.closest("[data-zur-watchlist]");
      if (zw) {
        const r = JSON.parse(zw.dataset.zurWatchlist);
        zw.disabled = true; zw.textContent = "Wird hinzugefügt …";
        await aufWatchlist([r], `„${esc(r.name)}“ steht jetzt auf der Watchlist. Die Analyse wird erstellt, die Seite lädt danach neu …`);
        zw.outerHTML = `<span class="treffer-marke">Auf der Watchlist</span>`;
        return;
      }
      const pw = e.target.closest("[data-position-watchlist]");
      if (pw) {
        const q = positionen((depotLaden() || { transaktionen: [] }).transaktionen).find((p) => schluessel(p) === pw.dataset.positionWatchlist);
        if (q) { pw.disabled = true; await aufWatchlist([{ symbol: q.symbol || null, isin: q.isin || null, name: q.name, typ: "aktie" }], `„${esc(q.name)}“ wird zur Watchlist hinzugefügt und analysiert …`); }
        return;
      }
      if (e.target.closest("[data-alle-watchlist]")) {
        const z = bewerten(); if (!z) return;
        const fehlen = z.zeilen.filter((r) => !r.treffer).map(({ q }) => ({ symbol: q.symbol || null, isin: q.isin || null, name: q.name, typ: "aktie" }));
        e.target.closest("[data-alle-watchlist]").disabled = true;
        await aufWatchlist(fehlen, `${fehlen.length} Positionen werden zur Watchlist hinzugefügt und analysiert, die Seite lädt danach neu …`);
        return;
      }
      const pe = e.target.closest("[data-position-entfernen]");
      if (pe) {
        if (!pe.dataset.sicher) { pe.dataset.sicher = "1"; pe.textContent = "Wirklich?"; setTimeout(() => { if (pe.isConnected) { delete pe.dataset.sicher; pe.textContent = "Entfernen"; } }, 4000); return; }
        positionEntfernen(pe.dataset.positionEntfernen); return;
      }
      if (e.target.closest("#portfolio-uebernehmen")) {
        try {
          const t = textEinfuegen($("#portfolio-text").value);
          umsaetzeHinzufuegen(t, "Eingefügt", false);
          $("#portfolio-text").value = ""; $("#portfolio-meldung").textContent = `${t.length} ${t.length === 1 ? "Position" : "Positionen"} übernommen.`;
        } catch (err) { $("#portfolio-meldung").textContent = err.message; }
        return;
      }
      if (!e.target.closest(".komponist") && $("#komponist-treffer")) $("#komponist-treffer").hidden = true;
    });
    // Marktband: Mausrad scrollt waagerecht, ausgeblendeter Rand nur solange rechts noch Werte folgen
    const band = $(".marktband-innen");
    if (band) {
      const rand = () => {
        band.classList.toggle("ueberlauf", band.scrollWidth > band.clientWidth + 2);
        band.classList.toggle("am-ende", band.scrollLeft + band.clientWidth >= band.scrollWidth - 2);
      };
      band.addEventListener("scroll", rand, { passive: true });
      window.addEventListener("resize", rand);
      band.addEventListener("wheel", (e) => {
        if (Math.abs(e.deltaY) <= Math.abs(e.deltaX) || band.scrollWidth <= band.clientWidth) return;
        const vorher = band.scrollLeft;
        band.scrollLeft += e.deltaY;
        if (band.scrollLeft !== vorher) e.preventDefault();
      }, { passive: false });
      rand();
    }
    if (lies("fathom.aktien.ansicht") === "portfolio") aktienAnsicht("portfolio", false);
    depotZeigen();
    let depotT = null;
    document.addEventListener("fathom:signale", () => { clearTimeout(depotT); depotT = setTimeout(() => { if (depotLaden()) depotZeigen(); }, 400); });
    document.addEventListener("wb:szenario", () => { clearTimeout(depotT); depotT = setTimeout(() => { if (depotLaden()) depotZeigen(); }, 400); });
    setInterval(() => { if (depotLaden() && window.WBLive && Object.keys(window.WBLive.stand).length) depotZeigen(); }, 15000);
  });
  // Für das Depot-Fenster (assets/seiten.js): dieselbe Bewertung und Tabelle, ohne zweite Rechnung
  window.WBDepot = { einlesen, positionen, textEinfuegen, bewerten, aktuell, laden: depotLaden,
    tabelle: (z) => tabelle(z, false, false) };
})();
