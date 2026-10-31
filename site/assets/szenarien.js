/* Fathom: Szenarien in der Analyse, im Vergleich der Watchlist und im Depot-Röntgen.
 *
 * Rechnen: assets/szenario-kern.js (WBSzenarioKern). Standardannahmen: src/szenarien.py, je Wert in live-basis (sz).
 * Eigene Annahmen und das Annahmen-Protokoll bleiben in diesem Browser (localStorage „fathom.szenarien“):
 *   { [slug]: { e: { g: { u: 0.3 } }, p: [{ z: Zeitstempel, a: "auto" | "du", t: Text }], s: Signatur der Standardannahmen } }
 * Ändert der Wochenlauf die Standardannahmen (neue Ist-Zahlen, neue Schätzungen), trägt das Panel beim nächsten
 * Öffnen ein, was sich geändert hat. Eigene Annahmen bleiben bestehen, bis du sie zurücksetzt.
 */
(function () {
  "use strict";
  const K = window.WBSzenarioKern;
  if (!K) return;
  const { $, $$, esc, lies, schreib } = window.WBH;
  const { zahl, pct, datum, monat } = K.format;
  const basisEl = $("#live-basis");
  const basis = basisEl ? JSON.parse(basisEl.textContent) : { werte: {} };
  const SPEICHER = "fathom.szenarien";
  const MAX_PROTOKOLL = 40;

  /* ================================================================ Speicher */
  function laden() {
    let roh;
    try { roh = JSON.parse(lies(SPEICHER) || "{}"); } catch (e) { roh = {}; }
    const aus = {};
    if (!roh || typeof roh !== "object") return aus;
    Object.entries(roh).forEach(([slug, x]) => {
      if (!basis.werte[slug] || !x || typeof x !== "object") return;
      const e = {};
      Object.entries(x.e || {}).forEach(([t, v]) => {
        if (!Object.prototype.hasOwnProperty.call(K.TREIBER, t) || !v || typeof v !== "object") return;
        const g = K.TREIBER[t].grenze;
        K.SZ.forEach((s) => { if (typeof v[s] === "number" && isFinite(v[s])) (e[t] = e[t] || {})[s] = Math.min(Math.max(v[s], g[0]), g[1]); });
      });
      const p = (Array.isArray(x.p) ? x.p : []).filter((q) => q && typeof q.t === "string" && typeof q.z === "number")
        .slice(-MAX_PROTOKOLL).map((q) => ({ z: q.z, a: q.a === "du" ? "du" : "auto", t: q.t.slice(0, 600) }));
      aus[slug] = { e, p, s: x.s && typeof x.s === "object" ? x.s : null };
    });
    return aus;
  }
  let speicher = laden();
  const sichern = () => schreib(SPEICHER, Object.keys(speicher).length ? JSON.stringify(speicher) : null);
  const zuletzt = {};   // Wert beim Betreten eines Eingabefelds, für „alt → neu“ im Protokoll
  const eintrag = (slug) => speicher[slug] || (speicher[slug] = { e: {}, p: [], s: null });
  const eigene = (slug) => (speicher[slug] || {}).e || {};
  function protokolliere(slug, a, t) {
    const x = eintrag(slug);
    x.p.push({ z: Date.now(), a, t });
    if (x.p.length > MAX_PROTOKOLL) x.p.splice(0, x.p.length - MAX_PROTOKOLL);
  }

  /* ================================================================ Rechnen */
  const szVon = (slug) => (basis.werte[slug] || {}).sz || null;
  const name = (slug) => (basis.werte[slug] || {}).name || slug;
  function kursJetzt(slug) {
    const s = window.WBLive && window.WBLive.stand && window.WBLive.stand[slug];
    return s && s.kurs ? s.kurs : null;
  }
  function ergebnis(slug) {
    const sz = szVon(slug);
    return sz ? K.rechne(sz, eigene(slug), kursJetzt(slug)) : null;
  }
  const klasse = (x) => (x > 5e-4 ? "plus" : x < -5e-4 ? "minus" : "");
  const kursTxt = (sz, x) => `${zahl(x, sz.dez || 2)} ${esc(sz.waehrung || "")}`.trim();
  // Standardannahmen in einem Satz (für den ersten Protokolleintrag)
  function annahmenText(sz) {
    return K.treiberListe(sz).map((t) => [t, sz.t[t]]).map(([t, x]) => `${K.treiberName(sz, t)} ${x.d != null ? [x.d, x.b, x.u].map((v) => pct(v, 2)).join(" / ") : pct(x.b, 2)}`).join(", ");
  }

  // Wochenwechsel: Standardannahmen mit dem letzten Stand vergleichen und Änderungen ins Protokoll schreiben
  function abgleichen(slug) {
    const sz = szVon(slug), sig = K.signatur(sz), x = speicher[slug];
    if (!x || !x.s) {
      protokolliere(slug, "auto", `Erstmals gerechnet${sz.anker ? ` auf die Ist-Zahlen bis ${datum(sz.anker.bis)} (Gewinn der letzten vier Quartale ${zahl(sz.anker.eps)} ${sz.waehrung})` : ` ab dem Kurs vom ${datum(sz.stand)}`}. Standardannahmen Downside / Basis / Upside: ${annahmenText(sz)}.`);
      eintrag(slug).s = sig;
      sichern();
      return;
    }
    if (JSON.stringify(x.s) === JSON.stringify(sig)) return;
    const u = K.unterschiede(x.s, sig, sz.waehrung);
    if (u.length) {
      const bleibt = K.geaendert(sz, x.e).length ? " Deine eigenen Annahmen bleiben bestehen." : "";
      protokolliere(slug, "auto", `Wochenlauf ${datum(sz.stand)}: ${u.join(" ")}${bleibt}`);
    }
    x.s = sig;
    sichern();
  }

  /* ================================================================ Panel */
  function karten(sz, erg) {
    return K.SZ.map((s) => {
      const r = erg.szenarien[s], w = erg.w;
      const p1 = (x) => (Math.abs(x) < 5e-4 ? "gleich" : pct(x, 1));
      const weg = sz.m === "gewinn"
        ? `Gewinn ${p1(w.g[s])}, KGV ${p1(w.v[s])}`
        : `Kurs ${p1(w.k[s])}${w.e ? `, ${esc(sz.t.e.n)} ${pct(w.e[s], 1)}` : ""}`;
      return `<div class="sz-karte" data-s="${s}"><p class="sz-name">${K.SZ_NAME[s]}</p>
        <p class="sz-rendite ${klasse(r.rendite)}">${pct(r.rendite, 0)}</p>
        <p class="sz-kurs">${kursTxt(sz, r.kurs)}</p><p class="sz-weg">${weg}</p></div>`;
    }).join("");
  }

  // Fächer: Kurs heute und nach jedem Quartal, Band zwischen Downside und Upside
  function faecher(sz, erg) {
    const alle = [].concat(erg.pfad.d, erg.pfad.b, erg.pfad.u);
    let lo = Math.min(...alle), hi = Math.max(...alle);
    const rand = (hi - lo) * 0.08 || hi * 0.05 || 1; lo -= rand; hi += rand;
    const B = 400, H = 120, x = (i) => (i / 4) * B, y = (v) => H - ((v - lo) / (hi - lo)) * H;
    const linie = (p) => p.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
    const band = linie(erg.pfad.u) + erg.pfad.d.slice().reverse().map((v, i) => `L${x(4 - i).toFixed(1)},${y(v).toFixed(1)}`).join("") + "Z";
    const label = (i) => (i === 0 ? "Heute" : sz.m === "gewinn" ? monat(sz.prognose[i - 1]) : `${3 * i} Mon.`);
    const aria = `Kursverlauf in den drei Szenarien: Upside ${kursTxt(sz, erg.szenarien.u.kurs)}, Basis ${kursTxt(sz, erg.szenarien.b.kurs)}, Downside ${kursTxt(sz, erg.szenarien.d.kurs)} nach vier Quartalen`;
    return `<svg class="sz-faecher" viewBox="0 0 ${B} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(aria)}">
        <path class="sz-band" d="${band}"/><path class="sz-heute" d="M0,${y(erg.kurs).toFixed(1)}H${B}"/>
        <path class="sz-linie sz-l-d" d="${linie(erg.pfad.d)}"/><path class="sz-linie sz-l-u" d="${linie(erg.pfad.u)}"/>
        <path class="sz-linie sz-l-b" d="${linie(erg.pfad.b)}"/></svg>
      <div class="sz-achse" aria-hidden="true">${[0, 1, 2, 3, 4].map((i) => `<span>${label(i)}</span>`).join("")}</div>`;
  }

  function eingabe(sz, t, s, wert, std) {
    const g = K.TREIBER[t].grenze, eig = Math.abs(wert - std) > 5e-7;
    const titel = `${K.treiberName(sz, t)}${K.TREIBER[t].einer || sz.t[t].d == null ? "" : " " + K.SZ_NAME[s]} in Prozent`;
    return `<label class="sz-feld${eig ? " eigen" : ""}"><input type="number" inputmode="decimal" step="0.25" min="${g[0] * 100}" max="${g[1] * 100}"
      value="${+(wert * 100).toFixed(2)}" data-sz-t="${t}" data-sz-s="${s}" aria-label="${esc(titel)}"
      title="${eig ? `Deine Annahme, Standard ${pct(std, 2)}` : "Standardannahme"}"><span aria-hidden="true">%</span></label>`;
  }

  // Feste Ausgangswerte: Ist-Gewinn mit KGV zum aktuellen Kurs, im Kursmodell der Kurs selbst
  function ankerZelle(sz, erg) {
    if (sz.m === "gewinn") {
      const kgv = sz.anker.kgv ? sz.anker.kgv * (erg.kurs / sz.kurs) : null;
      return `${kursTxt(sz, sz.anker.eps)}${kgv ? `<span class="sz-unter">KGV heute ${zahl(kgv, 1)}</span>` : ""}`;
    }
    return `${kursTxt(sz, erg.kurs)}<span class="sz-unter">Volatilität ${pct(sz.sigma, 0, false)} pro Jahr</span>`;
  }

  function treiberTabelle(sz, erg) {
    const w = erg.w, zeilen = [];
    const kopf = sz.m === "gewinn" ? `Gewinn je Aktie, Ist<span class="sz-unter">vier Quartale bis ${datum(sz.anker.bis)}</span>`
      : `Kurs heute<span class="sz-unter" data-sz-stand>${kursJetzt(sz.slug) ? "live" : `Schlusskurs vom ${datum(sz.stand)}`}</span>`;
    zeilen.push(`<tr class="sz-fest"><th scope="row">${kopf}</th><td colspan="3" data-sz-anker>${ankerZelle(sz, erg)}</td></tr>`);
    K.treiberListe(sz).forEach((t) => {
      const x = sz.t[t];
      const unter = { g: "nächste vier Quartale", v: "Veränderung des KGV", div: "pro Jahr, in allen Szenarien gleich",
        k: "in vier Quartalen", e: "pro Jahr, in allen Szenarien gleich" }[t];
      const kopf = `<th scope="row">${esc(K.treiberName(sz, t))}<span class="sz-unter">${unter}</span></th>`;
      if (x.d == null) zeilen.push(`<tr>${kopf}<td colspan="3" class="sz-einer">${eingabe(sz, t, "b", w[t].b, x.b)}</td></tr>`);
      else zeilen.push(`<tr>${kopf}${K.SZ.map((s) => `<td>${eingabe(sz, t, s, w[t][s], x[s])}${t === "v" && erg.szenarien[s].kgv ? `<span class="sz-unter" data-sz-kgv="${s}">KGV ${zahl(erg.szenarien[s].kgv, 1)}</span>` : ""}</td>`).join("")}</tr>`);
    });
    return `<div class="tabelle-rahmen kompakt"><table class="sz-tabelle">
      <caption class="unsichtbar">Treiber und Annahmen je Szenario</caption>
      <thead><tr><th scope="col">Treiber</th>${K.SZ.map((s) => `<th scope="col">${K.SZ_NAME[s]}</th>`).join("")}</tr></thead>
      <tbody>${zeilen.join("")}</tbody><tfoot data-sz-erg>${ergebnisZeilen(sz, erg)}</tfoot></table></div>`;
  }

  function ergebnisZeilen(sz, erg) {
    const S = erg.szenarien, z = [];
    if (sz.m === "gewinn") z.push(`<tr><th scope="row">Gewinn je Aktie, nächste vier Quartale</th>${K.SZ.map((s) => `<td>${kursTxt(sz, S[s].eps)}</td>`).join("")}</tr>`);
    z.push(`<tr><th scope="row">Kurs in vier Quartalen</th>${K.SZ.map((s) => `<td>${kursTxt(sz, S[s].kurs)}</td>`).join("")}</tr>`);
    const zusatz = sz.m === "gewinn" ? (erg.w.div.b ? " inkl. Dividende" : "") : sz.t.e ? ` inkl. ${esc(sz.t.e.n)}` : "";
    z.push(`<tr class="sz-summe"><th scope="row">Rendite${zusatz}</th>${K.SZ.map((s) => `<td class="${klasse(S[s].rendite)}">${pct(S[s].rendite, 1)}</td>`).join("")}</tr>`);
    return z.join("");
  }

  function quartalsZeilen(sz, erg) {
    return erg.quartale.map((q) => sz.m === "gewinn"
      ? `<tr><td>${monat(q.bis)}</td><td>${zahl(q.vorjahr)}<span class="sz-unter">${monat(q.vorjahrBis)}</span></td>${K.SZ.map((s) => `<td>${zahl(q[s])}</td>`).join("")}</tr>`
      : `<tr><td>in ${q.monate} Monaten<span class="sz-unter">${datum(q.bis)}</span></td>${K.SZ.map((s) => `<td>${zahl(q[s], sz.dez || 2)}</td>`).join("")}</tr>`).join("");
  }

  function quellen(sz) {
    const z = [];
    if (sz.anker) z.push(["Gewinn je Aktie, Ist", `${sz.anker.q[0].toUpperCase()}${sz.anker.q.slice(1)}, Summe der vier Quartale bis ${datum(sz.anker.bis)}${sz.anker.umgerechnet ? `, umgerechnet aus ${sz.anker.fin}` : ""}.`]);
    K.treiberListe(sz).forEach((t) => z.push([K.treiberName(sz, t), sz.t[t].q]));
    return `<dl class="sz-quellen">${z.map(([n, q]) => `<div><dt>${esc(n)}</dt><dd>${esc(q)}</dd></div>`).join("")}</dl>`;
  }

  function hinweise(sz, slug) {
    const f = K.flags(sz, eigene(slug), { demo: basis.demo });
    return `<h3 class="unterueberschrift">Wo die Rechnung unsicher ist</h3>${f.length
      ? `<ul class="sz-flags">${f.map((x) => `<li data-k="${esc(x.k)}"><b>${esc(K.FLAG_KURZ[x.k] || "Hinweis")}</b>${esc(x.t)}</li>`).join("")}</ul>`
      : `<p class="klein">Keine Unsicherheiten über die üblichen hinaus: Jede Annahme kann trotzdem danebenliegen.</p>`}`;
  }

  function memoHtml(sz, erg, slug) {
    const m = K.memo(sz, erg, { name: name(slug), eigene: eigene(slug), demo: basis.demo });
    return `<div class="sz-memo-kopf"><h3 class="unterueberschrift">Memo</h3>
        <button type="button" class="knopf-text" data-sz-kopieren>Memo kopieren</button></div>
      <article class="sz-memo-text"><p class="sz-memo-titel">${esc(m.titel)}</p><p class="sz-memo-unter">${esc(m.unter)}</p>
        ${m.absaetze.map((a) => `<p><b>${esc(a.titel)}.</b> ${esc(a.text)}</p>`).join("")}</article>`;
  }

  function protokollHtml(slug) {
    const p = (speicher[slug] || {}).p || [];
    const zeit = (z) => new Date(z).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
    return `<summary>Annahmen-Protokoll <span class="sz-zahl">${p.length}</span></summary>
      ${p.length ? `<ol class="sz-log">${p.slice().reverse().map((q) => `<li><time>${zeit(q.z)}</time><span class="sz-wer${q.a === "du" ? " du" : ""}">${q.a === "du" ? "du" : "Wochenlauf"}</span><span>${esc(q.t)}</span></li>`).join("")}</ol>` : `<p class="klein">Noch keine Einträge.</p>`}
      <p class="klein">Jede Änderung an den Annahmen, von dir oder durch neue Ist-Zahlen im Wochenlauf, mit Datum und Größe. Das Protokoll bleibt in diesem Browser.</p>`;
  }

  function zeige(art) {
    const sek = art && $("section[data-szenario]", art);
    if (!sek) return;
    const slug = sek.dataset.szenario, sz = szVon(slug);
    if (!sz) return;
    abgleichen(slug);
    const erg = ergebnis(slug);
    const ziel = $(".sz-inhalt", sek);
    ziel.innerHTML = `<div class="sz-karten" data-sz-karten>${karten(sz, erg)}</div>
      <div class="sz-pfad" data-sz-pfad>${faecher(sz, erg)}</div>
      <h3 class="unterueberschrift">Treiber und Annahmen</h3>
      <div data-sz-tabelle>${treiberTabelle(Object.assign({ slug }, sz), erg)}</div>
      <div class="sz-aktionen"><button type="button" class="knopf-text" data-sz-zurueck${K.geaendert(sz, eigene(slug)).length ? "" : " hidden"}>Deine Annahmen zurücksetzen</button></div>
      <h3 class="unterueberschrift">Grundlage der Annahmen</h3>${quellen(sz)}
      <details class="sz-details"><summary>${sz.m === "gewinn" ? "Vier Quartale im Einzelnen" : "Kurs nach jedem Quartal"}</summary>
        <div class="tabelle-rahmen kompakt"><table class="sz-quartale"><caption class="unsichtbar">Prognose je Quartal</caption>
          <thead><tr>${sz.m === "gewinn" ? `<th scope="col">Quartal bis</th><th scope="col">Vorjahr, Ist</th>` : `<th scope="col">Zeitpunkt</th>`}${K.SZ.map((s) => `<th scope="col">${K.SZ_NAME[s]}</th>`).join("")}</tr></thead>
          <tbody data-sz-quartale>${quartalsZeilen(sz, erg)}</tbody></table></div>
        <p class="klein">${sz.m === "gewinn"
          ? `Gewinn je Aktie in ${esc(sz.waehrung)}. Jedes Quartal ist das gleiche Quartal des Vorjahres mal (1 + Gewinnwachstum), so bleibt die Saison erhalten.${sz.konsens_q ? ` Zum Vergleich der Konsens fürs laufende Quartal: ${kursTxt(sz, sz.konsens_q.eps)}${sz.konsens_q.n ? ` (${sz.konsens_q.n} Analysten)` : ""}.` : ""}`
          : `Kurs in ${esc(sz.waehrung)}, gleichmäßig auf die vier Quartale verteilt. Laufender Ertrag ist darin nicht enthalten.`}</p>
      </details>
      <div data-sz-flags>${hinweise(sz, slug)}</div>
      <div class="sz-memo" data-sz-memo>${memoHtml(sz, erg, slug)}</div>
      <details class="sz-details sz-protokoll" data-sz-protokoll>${protokollHtml(slug)}</details>`;
    sek.dataset.bereit = "1";
  }

  // Nach einer Eingabe nur die abhängigen Teile neu zeichnen, damit Fokus und Eingabefelder bleiben
  function aktualisieren(sek, live) {
    const slug = sek.dataset.szenario, sz = szVon(slug), erg = ergebnis(slug);
    $("[data-sz-karten]", sek).innerHTML = karten(sz, erg);
    $("[data-sz-pfad]", sek).innerHTML = faecher(sz, erg);
    $("[data-sz-erg]", sek).innerHTML = ergebnisZeilen(sz, erg);
    $("[data-sz-anker]", sek).innerHTML = ankerZelle(sz, erg);
    const st = $("[data-sz-stand]", sek);
    if (st && kursJetzt(slug)) st.textContent = "live";
    $("[data-sz-quartale]", sek).innerHTML = quartalsZeilen(sz, erg);
    $("[data-sz-flags]", sek).innerHTML = hinweise(sz, slug);
    // Bei Live-Kursen das Memo nicht unter einer laufenden Markierung oder direkt nach dem Kopieren austauschen
    const memo = $("[data-sz-memo]", sek), auswahl = document.getSelection && document.getSelection();
    const markiert = live && auswahl && auswahl.rangeCount && !auswahl.isCollapsed && memo.contains(auswahl.anchorNode);
    const kopiert = live && $("[data-sz-kopieren]", memo) && $("[data-sz-kopieren]", memo).textContent !== "Memo kopieren";
    if (!markiert && !kopiert) memo.innerHTML = memoHtml(sz, erg, slug);
    K.SZ.forEach((s) => { const k = $(`[data-sz-kgv="${s}"]`, sek); if (k && erg.szenarien[s].kgv) k.textContent = `KGV ${zahl(erg.szenarien[s].kgv, 1)}`; });
    const w = K.werte(sz, eigene(slug));
    $$("input[data-sz-t]", sek).forEach((i) => {
      const t = i.dataset.szT, s = i.dataset.szS, std = sz.t[t].d != null ? sz.t[t][s] : sz.t[t].b;
      const eig = Math.abs(w[t][s] - std) > 5e-7;
      i.closest(".sz-feld").classList.toggle("eigen", eig);
      i.title = eig ? `Deine Annahme, Standard ${pct(std, 2)}` : "Standardannahme";
    });
    $("[data-sz-zurueck]", sek).hidden = !K.geaendert(sz, eigene(slug)).length;
  }

  function wertAus(i) {
    const v = parseFloat(String(i.value).replace(",", "."));
    return isFinite(v) ? v / 100 : null;
  }
  // Eingabe: sofort rechnen; beim Verlassen des Feldes (change) ins Protokoll
  document.addEventListener("input", (e) => {
    const i = e.target.closest("input[data-sz-t]"), sek = i && i.closest("section[data-szenario]");
    if (!sek) return;
    const v = wertAus(i);
    if (v == null) return;
    setzen(sek.dataset.szenario, i.dataset.szT, i.dataset.szS, v, false);
    aktualisieren(sek);
  });
  document.addEventListener("change", (e) => {
    const i = e.target.closest("input[data-sz-t]"), sek = i && i.closest("section[data-szenario]");
    if (!sek) return;
    const slug = sek.dataset.szenario, sz = szVon(slug), t = i.dataset.szT, s = i.dataset.szS;
    let v = wertAus(i);
    const std = sz.t[t].d != null ? sz.t[t][s] : sz.t[t].b;
    if (v == null) v = std;
    const g = K.TREIBER[t].grenze;
    v = Math.min(Math.max(v, g[0]), g[1]);
    i.value = +(v * 100).toFixed(2);
    const vorher = zuletzt[slug];
    setzen(slug, t, s, v, true);
    const alt = vorher && vorher.t === t && vorher.s === s ? vorher.wert : K.werte(sz, Object.assign({}, eigene(slug), { [t]: Object.assign({}, eigene(slug)[t], { [s]: undefined }) }))[t][s];
    zuletzt[slug] = null;
    if (Math.abs(v - alt) > 5e-7) {
      const wo = K.TREIBER[t].einer || sz.t[t].d == null ? "" : " " + K.SZ_NAME[s];
      protokolliere(slug, "du", `${K.treiberName(sz, t)}${wo}: ${pct(alt, 2)} → ${pct(v, 2)}${Math.abs(v - std) <= 5e-7 ? " (wieder Standard)" : ""}.`);
    }
    sichern();
    aktualisieren(sek);
    $("[data-sz-protokoll]", sek).innerHTML = protokollHtml(slug);
    document.dispatchEvent(new CustomEvent("wb:szenario", { detail: slug }));
  });
  // Den Wert vor der ersten Eingabe merken, damit das Protokoll „alt → neu“ richtig zeigt
  document.addEventListener("focusin", (e) => {
    const i = e.target.closest && e.target.closest("input[data-sz-t]"), sek = i && i.closest("section[data-szenario]");
    if (!sek) return;
    const slug = sek.dataset.szenario, t = i.dataset.szT, s = i.dataset.szS;
    zuletzt[slug] = { t, s, wert: K.werte(szVon(slug), eigene(slug))[t][s] };
  });

  function setzen(slug, t, s, v, endgueltig) {
    const sz = szVon(slug), x = eintrag(slug);
    const std = sz.t[t].d != null ? sz.t[t][s] : sz.t[t].b;
    x.e[t] = x.e[t] || {};
    if (Math.abs(v - std) <= 5e-7) delete x.e[t][s];
    else x.e[t][s] = v;
    if (!Object.keys(x.e[t]).length) delete x.e[t];
    if (endgueltig) sichern();
  }

  document.addEventListener("click", (e) => {
    const sek = e.target.closest("section[data-szenario]");
    if (!sek) return;
    const slug = sek.dataset.szenario;
    if (e.target.closest("[data-sz-zurueck]")) {
      const sz = szVon(slug), g = K.geaendert(sz, eigene(slug));
      eintrag(slug).e = {};
      protokolliere(slug, "du", `Eigene Annahmen zurückgesetzt (${g.map((x) => `${K.treiberName(sz, x.t)}${K.TREIBER[x.t].einer || sz.t[x.t].d == null ? "" : " " + K.SZ_NAME[x.s]} ${pct(x.wert, 2)} → ${pct(x.std, 2)}`).join(", ")}).`);
      sichern();
      zeige(sek.closest(".analyse"));
      $("[data-sz-protokoll]", sek).open = true;
      document.dispatchEvent(new CustomEvent("wb:szenario", { detail: slug }));
      return;
    }
    const k = e.target.closest("[data-sz-kopieren]");
    if (k) {
      const sz = szVon(slug);
      const text = K.memoText(K.memo(sz, ergebnis(slug), { name: name(slug), eigene: eigene(slug), demo: basis.demo }));
      const fertig = (t) => { k.textContent = t; setTimeout(() => (k.textContent = "Memo kopieren"), 1600); };
      if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => fertig("Kopiert"), () => fertig("Kopieren nicht möglich"));
      else fertig("Kopieren nicht möglich");
    }
  });

  // Live-Kurse: offene Szenarien mit dem neuen Kurs rechnen, höchstens alle fünf Sekunden (Finnhub tickt viel öfter)
  const liveGeplant = {};
  document.addEventListener("wb:kurse", (e) => {
    (e.detail || []).forEach((slug) => {
      if (liveGeplant[slug]) return;
      liveGeplant[slug] = setTimeout(() => {
        liveGeplant[slug] = null;
        const sek = document.querySelector(`.analyse:not([hidden]) section[data-szenario="${CSS.escape(slug)}"][data-bereit]`);
        if (sek) aktualisieren(sek, true);
      }, 5000);
    });
  });

  /* ================================================================ Vergleich (Ansicht in jeder Wertetabelle) */
  let vergleichSort = { spalte: null, auf: false };
  function vergleich(huelle, typ, slugs) {
    const zeilen = slugs.filter(szVon).map((slug) => ({ slug, sz: szVon(slug), erg: ergebnis(slug) }));
    if (!zeilen.length) { huelle.innerHTML = `<p class="leer">Für diese Werte gibt es keine Szenarien.</p>`; return; }
    const gewinn = zeilen.some((z) => z.sz.m === "gewinn"), ertrag = zeilen.some((z) => z.sz.t.e);
    const lo = Math.min(0, ...zeilen.map((z) => z.erg.szenarien.d.rendite)), hi = Math.max(0, ...zeilen.map((z) => z.erg.szenarien.u.rendite));
    const pos = (x) => (((x - lo) / (hi - lo || 1)) * 100).toFixed(1);
    const spalten = [
      { k: "name", t: "Wert", w: (z) => name(z.slug) },
      { k: "d", t: "Downside", w: (z) => z.erg.szenarien.d.rendite },
      { k: "b", t: "Basis", w: (z) => z.erg.szenarien.b.rendite },
      { k: "u", t: "Upside", w: (z) => z.erg.szenarien.u.rendite },
      { k: "spur", t: "Spanne", w: (z) => z.erg.spanne, nur: "nur-gross" },
      { k: "cr", t: "Chance : Risiko", w: (z) => z.erg.chanceRisiko, nur: "nur-gross" },
      gewinn ? { k: "be", t: "Break-even", w: (z) => (z.sz.m === "gewinn" ? z.erg.breakeven : null), nur: "nur-gross" } : null,
      ertrag ? { k: "e", t: "Ertrag p. a.", w: (z) => (z.erg.w.e ? z.erg.w.e.b : null), nur: "nur-gross" } : null,
      { k: "aus", t: "Spanne kommt aus", w: (z) => (z.erg.zerlegung && z.erg.zerlegung.bewertung != null ? z.erg.zerlegung.bewertung : -1), nur: "nur-breit" },
      { k: "f", t: "Hinweise", w: (z) => K.flags(z.sz, eigene(z.slug), { demo: false }).length, nur: "nur-gross" },
    ].filter(Boolean);
    if (vergleichSort.spalte) {
      const sp = spalten.find((s) => s.k === vergleichSort.spalte);
      if (sp) zeilen.sort((a, b) => {
        const x = sp.w(a), y = sp.w(b);
        if (x == null) return 1; if (y == null) return -1;
        const v = typeof x === "string" ? x.localeCompare(y, "de") : x - y;
        return vergleichSort.auf ? v : -v;
      });
    }
    const zelle = (sp, z) => {
      const S = z.erg.szenarien;
      switch (sp.k) {
        case "name": {
          const n = K.flags(z.sz, eigene(z.slug), { demo: false }).length;
          return `<td class="name"><a href="#${esc(z.slug)}">${esc(name(z.slug))}</a><span class="unter">${esc((basis.werte[z.slug] || {}).symbol || "")}</span>${n ? `<span class="unter sz-mobil">${n} ${n === 1 ? "Hinweis" : "Hinweise"}</span>` : ""}</td>`;
        }
        case "d": case "b": case "u": return `<td class="${klasse(S[sp.k].rendite)}">${pct(S[sp.k].rendite, 0)}</td>`;
        case "spur": return `<td class="nur-gross"><span class="sz-spur" aria-hidden="true"><i class="sz-spur-null" style="left:${pos(0)}%"></i><i class="sz-spur-band" style="left:${pos(S.d.rendite)}%;width:${(pos(S.u.rendite) - pos(S.d.rendite)).toFixed(1)}%"></i><i class="sz-spur-basis" style="left:${pos(S.b.rendite)}%"></i></span></td>`;
        case "cr": return `<td class="nur-gross">${z.erg.chanceRisiko == null ? `<span class="sz-leise" title="Auch im Downside kein Verlust">kein Verlust</span>`
          : z.erg.chanceRisiko > 20 ? `<span title="Das Downside ist fast null (${pct(z.erg.szenarien.d.rendite, 1)}), das Verhältnis deshalb kaum aussagekräftig">über 20 : 1</span>` : `${zahl(z.erg.chanceRisiko, 1)} : 1`}</td>`;
        case "be": return `<td class="nur-gross">${z.sz.m === "gewinn" && z.erg.w.v.d < 0 ? `<span title="Nötiges Gewinnwachstum, damit die Rendite bei der Downside-Bewertung nicht negativ wird">${pct(z.erg.breakeven, 1)}</span>` : "–"}</td>`;
        case "e": return `<td class="nur-gross">${z.erg.w.e ? `${pct(z.erg.w.e.b, 1)}<span class="unter">${esc(z.sz.t.e.n)}</span>` : "–"}</td>`;
        case "aus": {
          const zl = z.erg.zerlegung;
          return `<td class="nur-breit">${zl && zl.bewertung != null ? (zl.bewertung >= 0.5 ? `Bewertung ${pct(zl.bewertung, 0, false)}` : `Gewinn ${pct(zl.gewinn, 0, false)}`) : "Schwankung"}</td>`;
        }
        case "f": {
          const f = K.flags(z.sz, eigene(z.slug), { demo: false });
          const zeigen = f.slice(0, 2).map((x) => `<span class="sz-chip${x.g >= 3 ? " stark" : ""}">${esc(K.FLAG_KURZ[x.k] || "Hinweis")}</span>`).join("");
          return `<td class="sz-hinweis-zelle nur-gross" title="${esc(f.map((x) => x.t).join("\n"))}">${f.length ? zeigen + (f.length > 2 ? `<span class="sz-leise">+${f.length - 2}</span>` : "") : `<span class="sz-leise">–</span>`}</td>`;
        }
      }
      return "<td></td>";
    };
    huelle.innerHTML = `<div class="tabelle-rahmen"><table class="sz-vergleich"><caption class="unsichtbar">Szenarien im Vergleich</caption>
      <thead><tr>${spalten.map((sp) => `<th scope="col" class="sortierbar${sp.nur ? " " + sp.nur : ""}" tabindex="0" data-sz-sort="${sp.k}"${vergleichSort.spalte === sp.k ? ` aria-sort="${vergleichSort.auf ? "ascending" : "descending"}"` : ""}>${sp.t}</th>`).join("")}</tr></thead>
      <tbody>${zeilen.map((z) => `<tr data-href="${esc(z.slug)}">${spalten.map((sp) => zelle(sp, z)).join("")}</tr>`).join("")}</tbody></table></div>
      <p class="klein sz-fuss">Rendite in vier Quartalen${gewinn ? " inklusive Dividende" : ""}${ertrag ? " und laufendem Ertrag" : ""}, gerechnet ab den letzten Ist-Zahlen; der Balken zeigt die Spanne von Downside bis Upside, der Strich die Basis. Chance : Risiko ist das Upside geteilt durch den Betrag des Downside.${gewinn ? " Break-even ist das Gewinnwachstum, das bei der Downside-Bewertung nötig wäre, damit kein Verlust bleibt." : ""} Eigene Annahmen aus den Analysen sind eingerechnet. Rechnung mit Annahmen, keine Empfehlung.</p>`;
    huelle.dataset.typ = typ;
  }
  document.addEventListener("click", (e) => {
    const th = e.target.closest("th[data-sz-sort]");
    if (!th) return;
    sortiereVergleich(th);
  });
  document.addEventListener("keydown", (e) => {
    const th = e.target.closest && e.target.closest("th[data-sz-sort]");
    if (th && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); sortiereVergleich(th); }
  });
  function sortiereVergleich(th) {
    const k = th.dataset.szSort;
    vergleichSort = { spalte: k, auf: vergleichSort.spalte === k ? !vergleichSort.auf : k === "name" };
    const huelle = th.closest("[data-sz-vergleich]");
    if (huelle && huelle.wbNeu) { huelle.wbNeu(); const neu = $(`th[data-sz-sort="${k}"]`, huelle); if (neu) neu.focus(); }
  }

  /* ================================================================ Depot-Röntgen */
  // positionen: [{ slug, w (Wert in €) }] → Feld fürs Röntgen
  function depotFeld(positionen) {
    const mit = positionen.filter((p) => p.w > 0 && szVon(p.slug));
    if (!mit.length) return "";
    const summe = mit.reduce((a, p) => a + p.w, 0), ohne = positionen.length - mit.length;
    const erg = mit.map((p) => ({ p, e: ergebnis(p.slug) }));
    const euro = (s) => erg.reduce((a, x) => a + x.p.w * x.e.szenarien[s].rendite, 0);
    const E = { d: euro("d"), b: euro("b"), u: euro("u") };
    const eur = (x) => `${x > 0.5 ? "+" : x < -0.5 ? "−" : ""}${zahl(Math.abs(x), 0)} €`;
    const schlimm = erg.map((x) => ({ x, v: x.p.w * x.e.szenarien.d.rendite })).sort((a, b) => a.v - b.v)[0];
    const eigen = mit.some((p) => K.geaendert(szVon(p.slug), eigene(p.slug)).length);
    return `<div class="rx-feld rx-breit"><h4>Szenarien für die nächsten vier Quartale</h4>
      <div class="sz-depot">${K.SZ.map((s) => `<div${s === "b" ? ' class="sz-depot-basis"' : ""}><span>${K.SZ_NAME[s]}</span><b class="${klasse(E[s])}">${pct(E[s] / summe, 0)}</b><small>${eur(E[s])}</small></div>`).join("")}</div>
      ${schlimm && schlimm.v < 0 && E.d < 0 ? `<p>Den größten Teil des Downside trägt <a href="#${esc(schlimm.x.p.slug)}">${esc(name(schlimm.x.p.slug))}</a> mit ${eur(schlimm.v)} (${pct(schlimm.v / E.d, 0, false)} des Rückgangs).</p>` : ""}
      <p class="klein">Gewichtet nach dem Wert von ${mit.length} ${mit.length === 1 ? "Position" : "Positionen"}${ohne ? `, ${ohne} ohne Szenario nicht eingerechnet` : ""}. Wechselkurse bleiben unverändert. Im Downside rutschen alle Positionen zugleich ins schlechte Szenario; das zeigt eher die Obergrenze des Risikos als den wahrscheinlichen Fall.${eigen ? " Deine eigenen Annahmen aus den Analysen sind eingerechnet." : ""} Rechnung mit Annahmen, keine Empfehlung.</p></div>`;
  }

  const memoText = (slug) => (szVon(slug) ? K.memoText(K.memo(szVon(slug), ergebnis(slug), { name: name(slug), eigene: eigene(slug), demo: basis.demo })) : null);
  window.WBSzenario = { zeige, ergebnis, eigene, vergleich, depotFeld, memoText, hat: (slug) => !!szVon(slug) };
})();
