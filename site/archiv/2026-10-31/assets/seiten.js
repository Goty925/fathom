/* Fathom: Fenster Termine, Alarme, Depot und Journal (Widgets in der Taskleiste).
 *
 * Alle vier öffnen sich als Schublade von rechts (wie das Konto), immer nur ein Fenster zugleich (WBH.fenster).
 * Rechnen und Prüfen: assets/seiten-kern.js. Gespeichert wird nur im Browser:
 *   fathom.alarme   { liste: [Alarm], verlauf: [{ z, t, slug }], benachrichtigen }
 *   fathom.journal  { eintraege: [Eintrag] }
 *   fathom.trades   { liste: [Trade], depot: true }   (Trading-Kalender im Journal)
 * Beides gehört zur Kontosicherung und wird beim Laden geprüft.
 */
(function () {
  "use strict";
  const K = window.WBSeitenKern;
  const dock = document.getElementById("dock");
  if (!K || !dock || dock.dataset.dockArchiv === "1") return;
  const { $, $$, esc, lies, schreib, nf } = window.WBH;
  const { zahl, pct, euroKurz } = K.format;
  const basisEl = $("#live-basis");
  const basis = basisEl ? JSON.parse(basisEl.textContent) : { werte: {} };
  const WERTE = basis.werte || {};
  const SLUGS = new Set(Object.keys(WERTE));
  const KLASSEN = window.WBH.KLASSEN;
  const klassenName = Object.fromEntries(KLASSEN);
  const json = (k) => { try { return JSON.parse(lies(k) || "null"); } catch (e) { return null; } };
  const name = (slug) => (WERTE[slug] || {}).name || slug;
  const fDatum = (iso, art = "kurz") => new Date(iso + "T12:00:00").toLocaleDateString("de-DE", art === "lang"
    ? { weekday: "long", day: "numeric", month: "long" } : { weekday: "short", day: "2-digit", month: "2-digit" });
  const fZeit = (ms) => new Date(ms).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const klasse = (x) => (x > 5e-4 ? "plus" : x < -5e-4 ? "minus" : "");
  const wertWahl = (aktuell, mitAllgemein) => `${mitAllgemein ? `<option value="">Allgemein, ohne Wert</option>` : ""}${KLASSEN.map(([typ, n]) => {
    const l = Object.entries(WERTE).filter(([, w]) => w.typ === typ);
    return l.length ? `<optgroup label="${esc(n)}">${l.map(([s, w]) => `<option value="${esc(s)}"${s === aktuell ? " selected" : ""}>${esc(w.name)}</option>`).join("")}</optgroup>` : "";
  }).join("")}`;

  /* ================================================================ Lage je Wert (Kurs live oder Wochenstand) */
  function kursVon(slug) {
    const b = WERTE[slug] || {}, s = window.WBLive && window.WBLive.stand && window.WBLive.stand[slug];
    return { kurs: s && s.kurs ? s.kurs : b.kurs, heute: s && s.vortag ? s.kurs / s.vortag - 1 : null, live: !!(s && s.kurs) };
  }
  function lage(slug) {
    const b = WERTE[slug] || {}, k = kursVon(slug);
    const st = window.WBRegeln && window.WBRegeln.status ? window.WBRegeln.status(slug) : null;
    const sz = window.WBSzenario && window.WBSzenario.hat(slug) ? window.WBSzenario.ergebnis(slug) : null;
    const z = termineListe.find((t) => t.art === "zahlen" && t.slug === slug);
    return { kurs: k.kurs, heute: k.heute, hoch: b.hoch, treffer: st ? !!st.treffer : null, downside: sz ? sz.szenarien.d.rendite : null,
      zahlenTage: z ? K.tageBis(z.tag, Date.now()) : null, dez: b.dez || 2, waehrung: b.waehrung || "" };
  }

  /* ================================================================ Speicher */
  let alarme = [], verlauf = [], benachrichtigen = false, journal = [], trades = [], mitDepot = true;
  function laden() {
    const a = json("fathom.alarme") || {};
    alarme = (Array.isArray(a.liste) ? a.liste : []).map((x) => K.alarmPruefen(x, SLUGS)).filter(Boolean).slice(0, 100);
    verlauf = (Array.isArray(a.verlauf) ? a.verlauf : []).filter((v) => v && typeof v.t === "string" && typeof v.z === "number")
      .slice(-50).map((v) => ({ z: v.z, t: v.t.slice(0, 300), slug: SLUGS.has(v.slug) ? v.slug : null }));
    benachrichtigen = a.benachrichtigen === true;
    const j = json("fathom.journal") || {};
    journal = (Array.isArray(j.eintraege) ? j.eintraege : []).map((x) => K.eintragPruefen(x, SLUGS)).filter(Boolean).slice(-500);
    const t = json("fathom.trades") || {};
    trades = (Array.isArray(t.liste) ? t.liste : []).map((x) => K.tradePruefen(x, SLUGS)).filter(Boolean).slice(-3000);
    mitDepot = t.depot !== false;
  }
  const tradesSichern = () => schreib("fathom.trades", trades.length || !mitDepot ? JSON.stringify({ liste: trades, depot: mitDepot }) : null);
  const alarmeSichern = () => schreib("fathom.alarme", alarme.length || verlauf.length || benachrichtigen
    ? JSON.stringify({ liste: alarme.map(({ ist, erfuellt, ...rest }) => rest), verlauf: verlauf.slice(-50), benachrichtigen }) : null);
  const journalSichern = () => schreib("fathom.journal", journal.length ? JSON.stringify({ eintraege: journal }) : null);
  laden();
  window.addEventListener("storage", (e) => { if (["fathom.alarme", "fathom.journal", "fathom.trades"].includes(e.key)) { laden(); alles(); } });

  /* ================================================================ Kalender (wie im Work-Modus) */
  let kalender = [], termineListe = [];
  function kalenderLaden() {
    const W = window.WBWorkKern;
    const inline = $("#kalender-daten");
    const roh = inline ? Promise.resolve(JSON.parse(inline.textContent))
      : fetch("daten/kalender.json", { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null));
    roh.then((k) => { if (k) kalender = (W ? W.demoVerschieben(k, Date.now()) : k).termine || []; alles(); }).catch(() => {});
  }
  function depotSlugs() {
    const z = window.WBDepot && window.WBDepot.bewerten ? window.WBDepot.bewerten() : null;
    return new Set(z ? z.zeilen.filter((x) => x.treffer).map((x) => x.treffer[0]) : []);
  }
  const termineNeu = () => (termineListe = K.termine({ kalender, werte: WERTE, depot: depotSlugs(), journal }, Date.now(), 21));

  /* ================================================================ Schublade */
  const SEITEN = {
    termine: { titel: "Termine", zeile: "Nächste drei Wochen" },
    alarme: { titel: "Alarme", zeile: "Lokal · prüft mit jedem Kurs" },
    depot: { titel: "Depot", zeile: "Lokal · nur dieser Browser" },
    journal: { titel: "Journal", zeile: "Notizen und Trading-Kalender · nur dieser Browser" },
  };
  let huelle = null, offen = null, ausloeser = null, vorgabe = {};
  function bauen() {
    huelle = document.createElement("div");
    huelle.className = "seite-huelle"; huelle.hidden = true;
    huelle.innerHTML = `<div class="seite-schleier" data-seite-zu></div>
      <section class="seite-fenster" role="dialog" aria-modal="true" aria-labelledby="seite-titel" tabindex="-1">
        <header class="seite-kopf"><div><p class="seite-zeile"></p><h2 id="seite-titel"></h2></div>
          <button type="button" class="knopf schliessen-knopf" data-seite-zu><svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>Schließen</button></header>
        <div class="seite-inhalt"></div>
      </section>`;
    document.body.appendChild(huelle);
    huelle.addEventListener("click", klick);
    huelle.addEventListener("change", aenderung);
    huelle.addEventListener("input", eingabe);
    huelle.addEventListener("submit", absenden);
  }
  const fensterMelden = window.WBH.fenster("seiten", () => { ausloeser = null; zu(); });
  function oeffnen(seite, v) {
    if (!SEITEN[seite]) return;
    if (!huelle) bauen();
    if (!offen) { fensterMelden(true); ausloeser = document.activeElement; }
    if (offen === "journal" && seite !== "journal") adresseSetzen(null);
    offen = seite; vorgabe = v || {};
    adresseSetzen(seite);
    $(".seite-zeile", huelle).textContent = SEITEN[seite].zeile;
    $("#seite-titel", huelle).textContent = SEITEN[seite].titel;
    huelle.dataset.seite = seite;
    zeichnen();
    huelle.hidden = false;
    document.body.classList.add("seite-offen", "fenster-offen");
    document.body.dataset.seite = seite;
    $(".seite-inhalt", huelle).scrollTop = 0;
    const ziel = vorgabe.fokus && $(vorgabe.fokus, huelle);
    (ziel || $(".seite-fenster", huelle)).focus({ preventScroll: true });
    document.dispatchEvent(new CustomEvent("wb:seite"));
  }
  // Das Journal ist eine ganze Seite mit eigener Adresse (#journal), wie Work und Backtest
  function adresseSetzen(seite) {
    if (seite === "journal" && location.hash !== "#journal") history.pushState(null, "", "#journal");
    else if (seite !== "journal" && location.hash === "#journal") history.replaceState(null, "", location.pathname + location.search);
  }
  window.addEventListener("hashchange", () => {
    if (location.hash === "#journal" && offen !== "journal") oeffnen("journal");
    else if (location.hash !== "#journal" && offen === "journal") zu();
  });
  document.addEventListener("DOMContentLoaded", () => { if (location.hash === "#journal") setTimeout(() => oeffnen("journal"), 0); });
  function zu() {
    if (!huelle || huelle.hidden) return;
    if (offen === "journal") adresseSetzen(null);
    huelle.hidden = true;
    offen = null;
    document.body.classList.remove("seite-offen");
    delete document.body.dataset.seite;
    const kf = $(".kf-huelle");
    if ((!kf || kf.hidden) && !document.body.classList.contains("konto-offen")) document.body.classList.remove("fenster-offen");
    if (ausloeser && document.contains(ausloeser)) ausloeser.focus({ preventScroll: true });
    fensterMelden(false);
    document.dispatchEvent(new CustomEvent("wb:seite"));
  }
  function zeichnen() {
    if (!offen) return;
    const ziel = $(".seite-inhalt", huelle);
    // Eingaben in Formularen beim Neuzeichnen behalten (Live-Kurse zeichnen das Fenster neu)
    const fokus = document.activeElement && huelle.contains(document.activeElement) ? document.activeElement.id : null;
    const form = $("form", ziel);
    const behalten = form ? [...form.elements].filter((e) => e.id).map((e) => [e.id, e.type === "checkbox" ? e.checked : e.value]) : null;
    ziel.innerHTML = ({ termine: termineSeite, alarme: alarmeSeite, depot: depotSeite, journal: journalSeite })[offen]();
    if (behalten && !vorgabe.neu) behalten.forEach(([id, v]) => { const e = document.getElementById(id); if (e && huelle.contains(e)) { if (e.type === "checkbox") e.checked = v; else e.value = v; } });
    vorgabe.neu = false;
    if (fokus) { const e = document.getElementById(fokus); if (e) e.focus({ preventScroll: true }); }
    if (offen === "alarme") alarmFormHinweis();
    if (offen === "journal" && $("#tk-vorschau", huelle)) tradeVorschau();
  }
  // Nur neu zeichnen, wenn niemand gerade tippt
  function auffrischen() {
    if (!offen) return;
    const a = document.activeElement;
    if (a && huelle.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return;
    zeichnen();
  }

  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && offen) { e.preventDefault(); e.stopImmediatePropagation(); zu(); } }, true);
  document.addEventListener("click", (e) => {
    const w = e.target.closest(".dock [data-dock]");
    if (w && SEITEN[w.dataset.dock]) { e.preventDefault(); offen === w.dataset.dock ? zu() : oeffnen(w.dataset.dock); return; }
    if (w && offen) { ausloeser = null; zu(); return; }   // anderes Widget: Platz machen
    const o = e.target.closest("[data-seite-oeffnen]");
    if (o) {
      e.preventDefault();
      const s = o.dataset.seiteOeffnen;
      oeffnen(s, { slug: o.dataset.slug || null, neu: true, fokus: s === "journal" ? "#jn-text" : s === "alarme" ? "#al-art" : null });
    }
  });

  /* ================================================================ Termine */
  let terminFilter = "alle";
  const TERMIN_ART = { zahlen: "Quartalszahlen", notenbank: "Notenbank", konjunktur: "Wirtschaft", wiedervorlage: "Wiedervorlage" };
  function termineSeite() {
    termineNeu();
    const jetzt = Date.now();
    const filter = { alle: () => true, meine: (t) => t.mein, notenbank: (t) => t.art === "notenbank", konjunktur: (t) => t.art === "konjunktur", wiedervorlage: (t) => t.art === "wiedervorlage" };
    const liste = termineListe.filter(filter[terminFilter] || filter.alle);
    const n = K.naechsterMeiner(termineListe);
    const zaehl = (f) => termineListe.filter(filter[f]).length;
    const tage = {};
    liste.forEach((t) => { (tage[t.tag] = tage[t.tag] || []).push(t); });
    const zeile = (t) => {
      const uhr = t.ms != null ? new Date(t.ms).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) : t.art === "zahlen" ? "ganztags" : "";
      let mehr = "";
      if (t.erwartung && t.erwartung.prog != null) mehr = `Erwartet: Gewinn je Aktie ${zahl(t.erwartung.prog)} ${esc(t.erwartung.einheit || "")}${t.erwartung.vor ? `, Vorjahr ${zahl(t.erwartung.vor)} (${pct(t.erwartung.prog / t.erwartung.vor - 1, 0)})` : ""}`;
      else if (t.art === "wiedervorlage") mehr = esc(t.info) + (t.ueberfaellig ? ` <b class="minus">fällig seit ${esc(fDatum(t.seit))}</b>` : "");
      else if (t.info) mehr = esc(t.info);
      const aktionen = [
        t.slug && WERTE[t.slug] ? `<a href="#${esc(t.slug)}" class="knopf-text" data-seite-weg>Analyse</a>` : "",
        t.art === "zahlen" && t.slug && WERTE[t.slug] ? `<button type="button" class="knopf-text" data-alarm-zahlen="${esc(t.slug)}">Alarm 1 Tag vorher</button>` : "",
        t.art === "wiedervorlage" ? `<button type="button" class="knopf-text" data-jn-erledigt="${esc(t.journal)}">Erledigt</button><button type="button" class="knopf-text" data-jn-zeigen="${esc(t.journal)}">Eintrag</button>` : "",
      ].join("");
      return `<li class="tm-zeile tm-${t.art}${t.mein ? " mein" : ""}">
        <span class="tm-uhr">${esc(uhr)}</span>
        <div class="tm-text"><p class="tm-titel"><span class="tm-art">${TERMIN_ART[t.art]}</span>${t.land ? `<span class="tm-land">${esc(t.land)}</span>` : ""}${t.art !== "wiedervorlage" && t.art !== "zahlen" ? `<span class="dock-g g${Math.min(3, t.wichtig)}" title="Wichtigkeit ${t.wichtig} von 3"><i></i><i></i><i></i></span>` : ""}${t.depot ? `<span class="tm-depot">im Depot</span>` : ""}</p>
          <p class="tm-name">${esc(t.titel)}</p>${mehr ? `<p class="tm-mehr">${mehr}</p>` : ""}${aktionen ? `<p class="tm-aktionen">${aktionen}</p>` : ""}</div></li>`;
    };
    return `<section class="seite-karte tm-als-naechstes">
        ${n ? `<p class="seite-klein">Als Nächstes für dich</p><p class="tm-gross">${esc(n.titel)}</p>
          <p class="seite-klein">${esc(fDatum(n.tag, "lang"))}${n.ms ? `, ${new Date(n.ms).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })} Uhr` : ""} · <b>${esc(K.tagText(n.tag, jetzt))}</b></p>`
          : `<p class="seite-klein">In den nächsten drei Wochen steht nichts für deine Werte an.</p>`}
      </section>
      <div class="seite-chips" role="group" aria-label="Termine filtern">${[["alle", "Alle"], ["meine", "Meine Werte"], ["notenbank", "Notenbanken"], ["konjunktur", "Wirtschaft"], ["wiedervorlage", "Wiedervorlagen"]].map(([f, t]) =>
        `<button type="button" class="chip" data-tm-filter="${f}" aria-pressed="${terminFilter === f}">${t} <span class="seite-zahl">${zaehl(f)}</span></button>`).join("")}</div>
      ${Object.keys(tage).length ? Object.entries(tage).map(([tag, l]) => `<section class="seite-karte tm-tag"><h3>${esc(fDatum(tag, "lang"))}<span>${esc(K.tagText(tag, jetzt))}</span></h3><ul class="tm-liste">${l.map(zeile).join("")}</ul></section>`).join("")
        : `<p class="seite-leer">Keine Termine für diesen Filter.</p>`}
      <p class="seite-fuss">Quartalszahlen deiner Watchlist, Sitzungen der Notenbanken und Wirtschaftsdaten ab mittlerer Wichtigkeit aus dem Kalender des Work-Modus, dazu die Wiedervorlagen aus deinem Journal.${basis.demo ? " Demo-Daten: Termine sind erfunden." : ""}</p>`;
  }

  /* ================================================================ Alarme */
  function alarmFormHinweis() {
    const s = $("#al-wert", huelle), a = $("#al-art", huelle), h = $("#al-hinweis", huelle), feld = $("#al-schwelle", huelle), einheit = $("#al-einheit", huelle);
    if (!s || !a) return;
    const art = K.ARTEN[a.value], l = lage(s.value), b = WERTE[s.value] || {};
    feld.closest(".seite-feld").hidden = !art.einheit;
    feld.required = !!art.einheit;
    einheit.textContent = art.einheit === "kurs" ? b.waehrung || "" : art.einheit || "";
    feld.step = art.schritt || "any";
    if (art.min != null) { feld.min = art.min; feld.max = art.max; } else { feld.removeAttribute("min"); feld.removeAttribute("max"); }
    const p = K.pruefe({ art: a.value, wert: Number(feld.value) || 0 }, l);
    h.textContent = `Aktuell: ${p.ist || "–"}`;
    feld.placeholder = art.einheit === "kurs" && l.kurs ? String(+l.kurs.toFixed(b.dez || 2)) : art.einheit === "%" && a.value === "downside" ? "-20" : art.min != null ? String(art.min) : "";
  }
  function alarmeSeite() {
    const v = vorgabe.slug && WERTE[vorgabe.slug] ? vorgabe.slug : Object.keys(WERTE)[0];
    const offeneL = K.offeneAlarme(alarme);
    const status = (a) => !a.an ? `<span class="al-status aus">aus</span>`
      : a.ausgeloest && !a.gesehen ? `<span class="al-status los">ausgelöst ${esc(fZeit(a.ausgeloest))}</span>`
      : a.ausgeloest ? `<span class="al-status">quittiert, wird wieder scharf</span>`
      : a.erfuellt == null ? `<span class="al-status aus">Daten fehlen</span>` : `<span class="al-status scharf">scharf</span>`;
    const zeile = (a) => `<li class="al-zeile${a.ausgeloest && !a.gesehen ? " los" : ""}">
      <div><p class="al-text"><a href="#${esc(a.slug)}" data-seite-weg>${esc(name(a.slug))}</a> ${esc(K.alarmText(a, "", lage(a.slug)).replace(/^: /, ""))}</p>
        <p class="seite-klein">${status(a)} · jetzt ${esc(a.ist || "–")}${a.notiz ? ` · ${esc(a.notiz)}` : ""}</p></div>
      <div class="al-aktionen">${a.ausgeloest && !a.gesehen ? `<button type="button" class="knopf-text" data-al-gesehen="${esc(a.id)}">Gesehen</button>` : ""}
        <button type="button" class="knopf-text" data-al-an="${esc(a.id)}">${a.an ? "Pausieren" : "Einschalten"}</button>
        <button type="button" class="knopf-text leise" data-al-weg="${esc(a.id)}">Löschen</button></div></li>`;
    const nicht = typeof Notification === "undefined" ? "Dieser Browser kann keine Benachrichtigungen zeigen."
      : Notification.permission === "denied" ? "Benachrichtigungen sind im Browser gesperrt." : "";
    return `<form class="seite-karte al-form" data-form="alarm" autocomplete="off">
        <h3>Neuer Alarm</h3>
        <div class="seite-felder">
          <label class="seite-feld"><span>Wert</span><select id="al-wert">${wertWahl(v)}</select></label>
          <label class="seite-feld"><span>Bedingung</span><select id="al-art">${Object.entries(K.ARTEN).map(([k, a]) => `<option value="${k}">${esc(a.name)}</option>`).join("")}</select></label>
          <label class="seite-feld al-schwelle"><span>Schwelle</span><span class="seite-mit-einheit"><input id="al-schwelle" type="number" inputmode="decimal" step="any" required><em id="al-einheit"></em></span></label>
          <label class="seite-feld seite-breit"><span>Notiz (optional)</span><input id="al-notiz" type="text" maxlength="200" placeholder="z. B. Nachkaufen prüfen"></label>
        </div>
        <p class="seite-klein" id="al-hinweis" aria-live="polite"></p>
        <div class="seite-knoepfe"><button type="submit" class="knopf primaer">Alarm anlegen</button></div>
      </form>
      ${offeneL.length ? `<section class="seite-karte"><div class="seite-karte-kopf"><h3>Ausgelöst <span class="seite-zahl los">${offeneL.length}</span></h3><button type="button" class="knopf-text" data-al-alle-gesehen>Alle gesehen</button></div><ul class="al-liste">${offeneL.map(zeile).join("")}</ul></section>` : ""}
      <section class="seite-karte"><h3>Deine Alarme <span class="seite-zahl">${alarme.length}</span></h3>
        ${alarme.length ? `<ul class="al-liste">${alarme.filter((a) => !(a.ausgeloest && !a.gesehen && a.an)).map(zeile).join("")}</ul>` : `<p class="seite-leer">Noch keine Alarme. Lege oben einen an oder nutze „Alarm setzen“ in einer Analyse.</p>`}
        <label class="seite-haken"><input type="checkbox" id="al-benachrichtigen"${benachrichtigen && !nicht ? " checked" : ""}${nicht ? " disabled" : ""}> Auch als Benachrichtigung des Browsers, solange Fathom offen ist</label>
        ${nicht ? `<p class="seite-klein">${nicht}</p>` : ""}
      </section>
      ${verlauf.length ? `<section class="seite-karte"><h3>Verlauf</h3><ol class="al-verlauf">${verlauf.slice().reverse().slice(0, 20).map((x) => `<li><time>${esc(fZeit(x.z))}</time><span>${esc(x.t)}</span></li>`).join("")}</ol></section>` : ""}
      <p class="seite-fuss">Fathom prüft deine Alarme mit jedem Kurs, sobald die Seite offen ist: mit Live-Kursen laufend, sonst mit dem Wochenstand. Tagesbewegungen gibt es nur mit Live-Kursen. Ein ausgelöster Alarm bleibt sichtbar, bis du ihn als gesehen markierst, und ist danach wieder scharf, sobald die Bedingung nicht mehr gilt.</p>`;
  }

  // Alarme prüfen; neue Auslöser melden
  let pruefT = null;
  function pruefen() {
    clearTimeout(pruefT); pruefT = null;
    if (!alarme.length) { widgets(); return; }
    termineNeu();
    const lagen = {};
    alarme.forEach((a) => { if (!lagen[a.slug]) lagen[a.slug] = lage(a.slug); });
    const neu = K.auswerten(alarme, lagen, Date.now());
    if (neu.length) {
      neu.forEach((a) => {
        const t = `${K.alarmText(a, name(a.slug), lagen[a.slug])} (jetzt ${a.ist})`;
        verlauf.push({ z: Date.now(), t, slug: a.slug });
        melden(t, a.slug);
      });
    }
    alarmeSichern();
    widgets();
    if (offen === "alarme") auffrischen();
  }
  const bald = () => { if (!pruefT) pruefT = setTimeout(pruefen, 800); };

  // Meldung unten rechts, auf Wunsch zusätzlich als Benachrichtigung des Browsers
  function melden(text, slug) {
    let stapel = $(".al-meldungen");
    if (!stapel) { stapel = document.createElement("div"); stapel.className = "al-meldungen"; stapel.setAttribute("role", "status"); stapel.setAttribute("aria-live", "polite"); document.body.appendChild(stapel); }
    const m = document.createElement("button");
    m.type = "button"; m.className = "al-meldung"; m.dataset.seiteOeffnen = "alarme";
    m.innerHTML = `<b>Alarm</b><span>${esc(text)}</span>`;
    stapel.appendChild(m);
    while (stapel.children.length > 3) stapel.firstElementChild.remove();   // höchstens drei Meldungen zugleich
    setTimeout(() => m.remove(), 9000);
    if (benachrichtigen && typeof Notification !== "undefined" && Notification.permission === "granted") {
      try { new Notification("Fathom: Alarm", { body: text, tag: "fathom-" + slug }); } catch (e) { /* manche Browser nur über Service Worker */ }
    }
  }

  /* ================================================================ Depot */
  function depotZeilen() {
    const z = window.WBDepot && window.WBDepot.bewerten ? window.WBDepot.bewerten() : null;
    if (!z) return null;
    const zeilen = z.zeilen.filter((x) => x.w != null && x.treffer).map((x) => {
      const slug = x.treffer[0], b = x.treffer[1];
      return { slug, name: b.name, typ: b.typ, w: x.w, heute: kursVon(slug).heute, woche: b.rendite_1w != null ? b.rendite_1w : null, q: x.q };
    });
    return { z, zeilen, lage: K.depotLage(zeilen) };
  }
  function depotSeite() {
    const d = depotZeilen();
    if (!d) return `<section class="seite-karte seite-leerzustand"><h3>Noch kein Depot</h3>
        <p class="seite-text">Lies deine Umsätze aus Portfolio Performance oder Parqet ein oder füge eine Liste ein. Alles bleibt in diesem Browser.</p>
        <div class="seite-knoepfe"><button type="button" class="knopf primaer" data-zum-portfolio>Portfolio einlesen</button></div></section>`;
    const { z, zeilen, lage: L } = d;
    const bew = L.heute || L.woche, wort = L.heute ? "heute" : "in der Woche", feld = L.heute ? "heute" : "woche";
    const bewegt = zeilen.filter((x) => x[feld] != null).map((x) => ({ x, e: (x.w * x[feld]) / (1 + x[feld]) })).sort((a, b) => Math.abs(b.e) - Math.abs(a.e));
    const zaehle = (slug) => ({ j: journal.filter((e) => e.slug === slug).length, a: alarme.filter((a) => a.slug === slug && a.an).length });
    return `<section class="seite-karte dp-kopf">
        <div><p class="seite-klein">Wert der bewerteten Positionen</p><p class="dp-gross">${nf(0).format(L.wert)} <span>€</span></p></div>
        ${bew ? `<div><p class="seite-klein">Bewegung ${wort}${L.heute && !L.heute.vollstaendig ? " (teilweise live)" : ""}</p><p class="dp-mittel ${klasse(bew.euro)}">${bew.euro >= 0 ? "+" : "−"}${nf(0).format(Math.abs(bew.euro))} € <span>${pct(bew.pct)}</span></p></div>` : ""}
      </section>
      ${bewegt.length ? `<section class="seite-karte"><h3>Was ${wort} bewegt hat</h3><ul class="dp-liste">${bewegt.slice(0, 8).map(({ x, e }) => `<li>
          <a href="#${esc(x.slug)}" data-seite-weg>${esc(x.name)}</a><span class="seite-klein">${pct(x.w / L.wert, 0, false)} Anteil</span>
          <b class="${klasse(x[feld])}">${pct(x[feld])}</b><b class="${klasse(e)}">${e >= 0 ? "+" : "−"}${nf(0).format(Math.abs(e))} €</b></li>`).join("")}</ul>
          ${!L.heute ? `<p class="seite-klein">Ohne Live-Kurse: Veränderung seit dem letzten Wochenbericht.</p>` : ""}</section>` : ""}
      <section class="seite-karte"><h3>Aufteilung</h3><div class="dp-balken" role="img" aria-label="${esc(L.klassen.map((k) => `${klassenName[k.typ] || k.typ} ${pct(k.anteil, 0, false)}`).join(", "))}">${L.klassen.map((k) => `<span class="dp-k-${esc(k.typ)}" style="flex-grow:${k.w}"></span>`).join("")}</div>
        <ul class="dp-legende">${L.klassen.map((k) => `<li><i class="dp-k-${esc(k.typ)}"></i>${esc(klassenName[k.typ] || k.typ)}<b>${pct(k.anteil, 0, false)}</b></li>`).join("")}</ul></section>
      <section class="seite-karte"><h3>Notizen und Alarme je Position</h3><ul class="dp-notizen">${zeilen.map((x) => { const c = zaehle(x.slug); return `<li>
          <a href="#${esc(x.slug)}" data-seite-weg>${esc(x.name)}</a>
          <span class="seite-klein">${c.j ? `${c.j} ${c.j === 1 ? "Notiz" : "Notizen"}` : "keine Notiz"} · ${c.a ? `${c.a} ${c.a === 1 ? "Alarm" : "Alarme"}` : "kein Alarm"}</span>
          <span class="dp-schnell"><button type="button" class="knopf-text" data-seite-oeffnen="journal" data-slug="${esc(x.slug)}">Notiz</button><button type="button" class="knopf-text" data-seite-oeffnen="alarme" data-slug="${esc(x.slug)}">Alarm</button></span></li>`; }).join("")}</ul></section>
      <section class="seite-karte dp-tabelle">${window.WBDepot.tabelle(z)}</section>
      <div class="seite-knoepfe"><button type="button" class="knopf" data-zum-portfolio>Umsätze einlesen, exportieren, bearbeiten</button></div>`;
  }

  /* ================================================================ Journal */
  let jnFilter = "", jnSuche = "", jnNurOffen = false, jnBearbeiten = null;
  /* ---------------------------------------------------------------- Journal: Notizen oder Trading-Kalender */
  let jnAnsicht = lies("fathom.journal.ansicht") === "kalender" ? "kalender" : "notizen";
  function journalSeite() {
    return `<div class="seite-wahl jn-ansicht" role="tablist" aria-label="Journal">${[["notizen", "Notizen"], ["kalender", "Trading-Kalender"]].map(([k, n]) =>
      `<button type="button" role="tab" data-jn-ansicht="${k}" aria-selected="${jnAnsicht === k}" aria-checked="${jnAnsicht === k}">${n}</button>`).join("")}</div>`
      + (jnAnsicht === "kalender" ? kalenderSeite() : notizenSeite());
  }

  /* ---------------------------------------------------------------- Trading-Kalender */
  const heuteD = new Date();
  let tkJahr = heuteD.getFullYear(), tkMonat = heuteD.getMonth(), tkTag = null, tkBearbeiten = null;
  const MONATE = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
  function depotVerkaeufe() {
    const d = window.WBDepot && window.WBDepot.laden ? window.WBDepot.laden() : null;
    if (!d || !Array.isArray(d.transaktionen)) return [];
    const zu = (x) => {
      const t = Object.entries(WERTE).find(([, b]) => (x.isin && b.isin === x.isin) || (x.symbol && b.symbol && b.symbol.split(".")[0] === String(x.symbol).split(".")[0]));
      return t ? t[0] : null;
    };
    return K.depotTrades(d.transaktionen, zu);
  }
  const alleTrades = () => trades.concat(mitDepot ? depotVerkaeufe() : []);
  const eur = (x, vz = true) => (x == null || !isFinite(x) ? "–" : `${vz && x > 0.5 ? "+" : x < -0.5 ? "−" : ""}${nf(Math.abs(x) < 100 ? 2 : 0).format(Math.abs(x))} €`);
  const eurKurz = (x) => {
    const a = Math.abs(x), v = x > 0.5 ? "+" : x < -0.5 ? "−" : "";
    return a >= 1e5 ? `${v}${nf(0).format(a / 1e3)}k` : a >= 1e4 ? `${v}${nf(1).format(a / 1e3)}k` : `${v}${nf(0).format(a)}`;
  };
  function kalenderSeite() {
    const alle = alleTrades();
    const m = K.monatsKalender(alle, tkJahr, tkMonat), st = m.statistik, ges = K.statistik(alle);
    const heute = K.isoTag(Date.now());
    const farbe = (x) => (x == null ? "" : ` style="--st:${Math.min(1, Math.abs(x) / (m.max || 1)).toFixed(3)}"`);
    const zelle = (t) => `<button type="button" class="tk-tag${t.imMonat ? "" : " fremd"}${t.iso === heute ? " heute" : ""}${t.summe != null ? (t.summe >= 0 ? " plus" : " minus") : ""}${t.iso === tkTag ? " gewaehlt" : ""}"
        data-tk-tag="${t.iso}" aria-pressed="${t.iso === tkTag}"${farbe(t.summe)} aria-label="${esc(`${t.tag}. ${t.n ? `${eur(t.summe)}, ${t.n} ${t.n === 1 ? "Trade" : "Trades"}` : "keine Trades"}`)}">
        <span class="tk-nr">${t.tag}</span>${t.n ? `<span class="tk-betrag">${eurKurz(t.summe)}</span><span class="tk-n">${t.n} ${t.n === 1 ? "Trade" : "Trades"}</span><i class="tk-punkt" aria-hidden="true"></i>` : ""}</button>`;
    // Kapitalkurve des Monats: aufsummiert je Handelstag
    const tage = [...new Set(st.n ? m.trades.map((t) => t.datum) : [])].sort();
    let kum = 0;
    const punkte = [0].concat(tage.map((d) => (kum += m.trades.filter((t) => t.datum === d).reduce((s, t) => s + K.tradeErgebnis(t), 0))));
    const lo = Math.min(...punkte), hi = Math.max(...punkte), B = 300, H = 60;
    const pfad = punkte.map((v, i) => `${i ? "L" : "M"}${((i / Math.max(1, punkte.length - 1)) * B).toFixed(1)},${(H - 4 - ((v - lo) / (hi - lo || 1)) * (H - 8)).toFixed(1)}`).join("");
    const kennzahl = (wert, name, klasse = "") => `<div class="tk-zahl"><b class="${wert === "–" ? "" : klasse}">${wert}</b><span>${name}</span></div>`;
    const tagTrades = tkTag ? alle.filter((t) => t.datum === tkTag).sort((a, b) => (a.quelle === "depot") - (b.quelle === "depot")) : [];
    return `<div class="jn-spalten"><div class="jn-links"><section class="seite-karte tk-kopf">
        <div class="tk-monat"><button type="button" class="knopf-text" data-tk-monat="-1" aria-label="Voriger Monat">‹</button>
          <h3>${MONATE[tkMonat]} ${tkJahr}</h3><button type="button" class="knopf-text" data-tk-monat="1" aria-label="Nächster Monat">›</button>
          <button type="button" class="knopf-text tk-heute-knopf" data-tk-monat="0">Heute</button></div>
        <div class="tk-netto"><p class="seite-klein">Netto im ${MONATE[tkMonat]}</p><p class="tk-gross ${klasse(st.netto)}">${st.n ? eur(st.netto) : "–"}</p>
          ${st.n > 1 ? `<svg class="tk-kurve ${st.netto >= 0 ? "plus" : "minus"}" viewBox="0 0 ${B} ${H}" preserveAspectRatio="none" aria-hidden="true"><path class="null" d="M0,${(H - 4 - ((0 - lo) / (hi - lo || 1)) * (H - 8)).toFixed(1)}H${B}"/><path d="${pfad}"/></svg>` : ""}</div>
        <div class="tk-zahlen">
          ${kennzahl(st.n || "–", st.n === 1 ? "Trade" : "Trades")}
          ${kennzahl(st.quote == null ? "–" : pct(st.quote, 0, false), "Trefferquote")}
          ${kennzahl(st.profitFaktor == null ? "–" : st.profitFaktor === Infinity ? "∞" : zahl(st.profitFaktor, 2), "Profit-Faktor")}
          ${kennzahl(st.schnittGewinn == null ? "–" : eur(st.schnittGewinn), "Ø Gewinn", "plus")}
          ${kennzahl(st.schnittVerlust == null ? "–" : eur(st.schnittVerlust), "Ø Verlust", "minus")}
          ${kennzahl(st.handelstage ? `${st.gruenTage}/${st.handelstage}` : "–", "Tage im Plus")}
        </div>
      </section>
      <section class="seite-karte tk-raster-karte">
        <div class="tk-raster" role="group" aria-label="Ergebnis je Tag im ${MONATE[tkMonat]} ${tkJahr}">
          ${["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So", "Woche"].map((d) => `<span class="tk-kopftag${d === "Woche" ? " tk-woche-kopf" : ""}">${d}</span>`).join("")}
          ${m.wochen.map((w) => w.tage.map(zelle).join("") + `<span class="tk-woche ${w.summe == null ? "" : klasse(w.summe)}">${w.summe == null ? "" : `<b>${eurKurz(w.summe)}</b><span>${w.n} ${w.n === 1 ? "Trade" : "Trades"}</span>`}</span>`).join("")}
        </div>
        <p class="seite-klein tk-legende">Grün ein Tag im Plus, Rot im Minus, je kräftiger, desto größer. Beträge in Euro nach Gebühren. ${st.besterTag ? `Bester Tag ${esc(fDatum(st.besterTag.tag))} ${eur(st.besterTag.wert)}` : ""}${st.schlechtesterTag ? `, schwächster ${esc(fDatum(st.schlechtesterTag.tag))} ${eur(st.schlechtesterTag.wert)}` : ""}${st.besterTag || st.schlechtesterTag ? "." : ""}</p>
        <label class="seite-haken"><input type="checkbox" id="tk-depot"${mitDepot ? " checked" : ""}> Verkäufe aus dem Depot einrechnen (Gewinn gegenüber den Durchschnittskosten)</label>
      </section>
      <section class="seite-karte tk-gesamt"><h3>Seit dem ersten Trade</h3>
        <div class="tk-zahlen">${kennzahl(ges.n ? eur(ges.netto) : "–", "Netto", klasse(ges.netto))}${kennzahl(ges.n || "–", "Trades")}${kennzahl(ges.quote == null ? "–" : pct(ges.quote, 0, false), "Trefferquote")}
          ${kennzahl(ges.profitFaktor == null ? "–" : ges.profitFaktor === Infinity ? "∞" : zahl(ges.profitFaktor, 2), "Profit-Faktor")}${kennzahl(ges.groessterGewinn == null ? "–" : eur(ges.groessterGewinn), "größter Gewinn", "plus")}${kennzahl(ges.groessterVerlust == null ? "–" : eur(ges.groessterVerlust), "größter Verlust", "minus")}</div>
      </section>
      <p class="seite-fuss tk-fuss">Profit-Faktor: Summe der Gewinne geteilt durch die Summe der Verluste; über 1 heißt, unter dem Strich verdient. Trades in Fremdwährung rechnet Fathom mit dem Wechselkurs vom Tag des Eintrags in Euro um. Alles bleibt in diesem Browser.</p></div>
      <div class="jn-rechts">${tkTag ? tagKarte(tkTag, tagTrades) : `<section class="seite-karte tk-hinweis"><h3>Ein Tag im Detail</h3><p class="seite-text">Tippe im Kalender auf einen Tag: Hier erscheinen seine Trades und das Formular, um einen neuen einzutragen.</p>
        <div class="seite-knoepfe"><button type="button" class="knopf primaer" data-tk-tag="${K.isoTag(Date.now())}">Trade für heute eintragen</button></div></section>`}</div></div>`;
  }
  function tagKarte(iso, liste) {
    const st = K.statistik(liste), t0 = tkBearbeiten ? trades.find((t) => t.id === tkBearbeiten) : null;
    const zeile = (t) => {
      const e = K.tradeErgebnis(t), r = K.tradeRendite(t), b = WERTE[t.slug] || {};
      const nameT = t.slug ? name(t.slug) : t.instrument;
      return `<li class="tk-trade">
        <div><p class="tk-trade-kopf"><span class="tk-richtung ${t.richtung}">${t.richtung === "short" ? "Short" : "Long"}</span>${t.slug ? `<a href="#${esc(t.slug)}" data-seite-weg>${esc(nameT)}</a>` : `<b>${esc(nameT)}</b>`}${t.quelle === "depot" ? `<span class="tk-quelle">aus dem Depot</span>` : ""}</p>
          <p class="seite-klein">${t.ein != null ? `${zahl(t.stueck, t.stueck % 1 ? 3 : 0)} × ${zahl(t.ein, b.dez || 2)} → ${zahl(t.aus, b.dez || 2)} ${esc(t.waehrung)}` : "Ergebnis direkt eingetragen"}${t.gebuehren ? ` · Gebühren ${eur(t.gebuehren, false)}` : ""}${t.eroeffnet && t.eroeffnet !== t.datum ? ` · eröffnet ${esc(fDatum(t.eroeffnet))}` : ""}${t.notiz ? ` · ${esc(t.notiz)}` : ""}</p></div>
        <div class="tk-trade-ergebnis"><b class="${klasse(e)}">${eur(e)}</b>${r != null ? `<span class="${klasse(r)}">${pct(r)}</span>` : ""}
          ${t.quelle === "depot" ? "" : `<span class="tk-aktionen"><button type="button" class="knopf-text" data-tk-bearbeiten="${esc(t.id)}">Bearbeiten</button><button type="button" class="knopf-text leise" data-tk-weg="${esc(t.id)}">Löschen</button></span>`}</div></li>`;
    };
    const v = t0 ? t0.slug || "" : "";
    return `<section class="seite-karte tk-tagkarte" id="tk-tagkarte"><div class="seite-karte-kopf"><h3>${esc(fDatum(iso, "lang"))}</h3>${liste.length ? `<b class="tk-tag-summe ${klasse(st.netto)}">${eur(st.netto)}</b>` : ""}</div>
        ${liste.length ? `<ul class="tk-trades">${liste.map(zeile).join("")}</ul>` : `<p class="seite-leer">An diesem Tag ist noch kein Trade eingetragen.</p>`}
      </section>
      <form class="seite-karte tk-form" data-form="trade" autocomplete="off">
        <h3>${t0 ? "Trade bearbeiten" : `Trade am ${esc(fDatum(iso))} eintragen`}</h3>
        <div class="seite-felder">
          <label class="seite-feld"><span>Wert</span><select id="tk-wert">${wertWahl(v, true).replace("Allgemein, ohne Wert", "Anderes Instrument")}</select></label>
          <label class="seite-feld" id="tk-instrument-feld"${v ? " hidden" : ""}><span>Instrument</span><input id="tk-instrument" type="text" maxlength="80" value="${t0 ? esc(t0.instrument) : ""}" placeholder="z. B. DAX Long Knock-out"></label>
          <div class="seite-feld"><span id="tk-richtung-titel">Richtung</span><div class="seite-wahl" role="radiogroup" aria-labelledby="tk-richtung-titel">${[["long", "Long"], ["short", "Short"]].map(([k, n]) =>
            `<button type="button" role="radio" data-tk-richtung="${k}" aria-checked="${(t0 ? t0.richtung : "long") === k}">${n}</button>`).join("")}</div></div>
          <label class="seite-feld"><span>Stück</span><input id="tk-stueck" type="number" inputmode="decimal" step="any" min="0" value="${t0 && t0.stueck != null ? t0.stueck : ""}"></label>
          <label class="seite-feld"><span>Einstieg <em id="tk-waehrung">${esc(t0 ? t0.waehrung : "EUR")}</em></span><input id="tk-ein" type="number" inputmode="decimal" step="any" min="0" value="${t0 && t0.ein != null ? t0.ein : ""}"></label>
          <label class="seite-feld"><span>Ausstieg</span><input id="tk-aus" type="number" inputmode="decimal" step="any" min="0" value="${t0 && t0.aus != null ? t0.aus : ""}"></label>
          <label class="seite-feld"><span>Gebühren in €</span><input id="tk-gebuehren" type="number" inputmode="decimal" step="any" min="0" value="${t0 && t0.gebuehren ? t0.gebuehren : ""}"></label>
          <label class="seite-feld"><span>oder Ergebnis direkt in €</span><input id="tk-ergebnis" type="number" inputmode="decimal" step="any" value="${t0 && t0.ergebnis != null ? t0.ergebnis : ""}" placeholder="ohne Kurse, z. B. −40"></label>
          <label class="seite-feld"><span>Eröffnet am (optional)</span><input id="tk-eroeffnet" type="date" max="${iso}" value="${t0 && t0.eroeffnet ? esc(t0.eroeffnet) : ""}"></label>
          <label class="seite-feld"><span>Geschlossen am</span><input id="tk-datum" type="date" value="${esc(t0 ? t0.datum : iso)}" required></label>
          <label class="seite-feld seite-breit"><span>Notiz (optional)</span><input id="tk-notiz" type="text" maxlength="600" value="${t0 ? esc(t0.notiz) : ""}" placeholder="z. B. Ausbruch über das Hoch, Stop nachgezogen"></label>
        </div>
        <p class="seite-klein" id="tk-vorschau" aria-live="polite"></p>
        <div class="seite-knoepfe"><button type="submit" class="knopf primaer">${t0 ? "Änderung speichern" : "Trade eintragen"}</button>${t0 ? `<button type="button" class="knopf-text" data-tk-abbrechen>Abbrechen</button>` : ""}</div>
      </form>`;
  }
  function tradeAusForm() {
    const slug = $("#tk-wert", huelle).value || null, b = WERTE[slug] || {};
    const w = slug ? b.waehrung || "EUR" : "EUR";
    const alt = tkBearbeiten ? trades.find((t) => t.id === tkBearbeiten) : null;
    return {
      id: alt ? alt.id : undefined, erstellt: alt ? alt.erstellt : undefined, datum: $("#tk-datum", huelle).value, eroeffnet: $("#tk-eroeffnet", huelle).value || null,
      slug, instrument: slug ? name(slug) : $("#tk-instrument", huelle).value, richtung: ($("[data-tk-richtung][aria-checked='true']", huelle) || {}).dataset?.tkRichtung || "long",
      stueck: $("#tk-stueck", huelle).value, ein: $("#tk-ein", huelle).value, aus: $("#tk-aus", huelle).value, gebuehren: $("#tk-gebuehren", huelle).value,
      ergebnis: $("#tk-ergebnis", huelle).value, notiz: $("#tk-notiz", huelle).value, waehrung: w,
      fx: alt && alt.waehrung === w ? alt.fx : w === "EUR" ? 1 : (basis.fx || {})[w] || 1,
    };
  }
  function tradeVorschau() {
    const v = $("#tk-vorschau", huelle); if (!v) return;
    const slug = $("#tk-wert", huelle).value;
    $("#tk-instrument-feld", huelle).hidden = !!slug;
    $("#tk-waehrung", huelle).textContent = slug ? (WERTE[slug] || {}).waehrung || "EUR" : "EUR";
    const t = K.tradePruefen(tradeAusForm(), SLUGS);
    v.textContent = t ? `Ergebnis: ${eur(K.tradeErgebnis(t))}${t.waehrung !== "EUR" ? ` (umgerechnet mit ${zahl(t.fx, 4)} € je ${t.waehrung})` : ""}` : "Wert oder Instrument, dazu Stück, Einstieg und Ausstieg oder ein Ergebnis eintragen.";
  }
  function tradeSpeichern() {
    const t = K.tradePruefen(tradeAusForm(), SLUGS);
    if (!t) { tradeVorschau(); return; }
    const i = trades.findIndex((x) => x.id === t.id);
    if (i >= 0) trades[i] = t; else trades.push(t);
    tkBearbeiten = null; tkTag = t.datum;
    const d = new Date(t.datum + "T12:00:00"); tkJahr = d.getFullYear(); tkMonat = d.getMonth();
    tradesSichern();
    vorgabe = { neu: true };
    zeichnen(); widgets();
    const k = $("#tk-tagkarte", huelle); if (k) k.scrollIntoView({ block: "nearest" });
  }

  function notizenSeite() {
    const jetzt = Date.now();
    const e0 = jnBearbeiten ? journal.find((e) => e.id === jnBearbeiten) : null;
    const v = e0 ? e0.slug || "" : vorgabe.slug && WERTE[vorgabe.slug] ? vorgabe.slug : "";
    const mitEintraegen = [...new Set(journal.map((e) => e.slug || ""))];
    const q = jnSuche.toLowerCase();
    const liste = journal.filter((e) => (!jnFilter || (jnFilter === "_" ? !e.slug : e.slug === jnFilter)) && (!jnNurOffen || (e.wv && !e.erledigt))
      && (!q || `${e.text} ${e.falsch} ${e.name}`.toLowerCase().includes(q))).sort((a, b) => b.erstellt - a.erstellt);
    const fae = K.faellig(journal, jetzt);
    const karte = (e) => {
      const k = e.slug ? kursVon(e.slug).kurs : null, seit = K.seitEintrag(e, k), b = WERTE[e.slug] || {};
      const t = e.wv ? K.tageBis(e.wv, jetzt) : null;
      return `<li class="jn-eintrag${e.wv && !e.erledigt && t <= 0 ? " faellig" : ""}" id="jn-${esc(e.id)}">
        <p class="jn-kopf"><span class="jn-art jn-${esc(e.art)}">${esc(K.JOURNAL_ARTEN[e.art])}</span>${e.slug ? `<a href="#${esc(e.slug)}" data-seite-weg>${esc(e.name || name(e.slug))}</a>` : `<span>Allgemein</span>`}<time>${esc(fZeit(e.erstellt))}</time></p>
        <p class="jn-text">${esc(e.text)}</p>
        ${e.falsch ? `<p class="jn-falsch"><b>Falsch, wenn:</b> ${esc(e.falsch)}</p>` : ""}
        ${e.kurs ? `<p class="jn-damals">Kurs damals ${zahl(e.kurs, b.dez || 2)} ${esc(e.waehrung)}${k ? ` · jetzt ${zahl(k, b.dez || 2)} <b class="${klasse(seit)}">${pct(seit)}</b>` : ""}${e.basis != null ? ` · Basis-Szenario damals ${pct(e.basis, 0)}` : ""}</p>` : ""}
        <p class="jn-fuss">${e.wv ? `<span class="jn-wv${e.erledigt ? " erledigt" : t <= 0 ? " faellig" : ""}">Wiedervorlage ${esc(fDatum(e.wv))}${e.erledigt ? ", erledigt" : `, ${esc(K.tagText(e.wv, jetzt))}`}</span>` : ""}
          ${e.wv && !e.erledigt ? `<button type="button" class="knopf-text" data-jn-erledigt="${esc(e.id)}">Erledigt</button>` : ""}
          <button type="button" class="knopf-text" data-jn-bearbeiten="${esc(e.id)}">Bearbeiten</button>
          <button type="button" class="knopf-text leise" data-jn-weg="${esc(e.id)}">Löschen</button></p></li>`;
    };
    const plus = (tage) => K.isoTag(jetzt + tage * 864e5);
    const zahlenTag = v ? (termineNeu(), termineListe.find((t) => t.art === "zahlen" && t.slug === v)) : null;
    return `<div class="jn-spalten"><div class="jn-links"><form class="seite-karte jn-form" data-form="journal" autocomplete="off">
        <h3>${e0 ? "Eintrag bearbeiten" : "Neuer Eintrag"}</h3>
        <div class="seite-felder">
          <label class="seite-feld"><span>Wert</span><select id="jn-wert">${wertWahl(v, true)}</select></label>
          <div class="seite-feld"><span id="jn-art-titel">Art</span><div class="seite-wahl" role="radiogroup" aria-labelledby="jn-art-titel">${Object.entries(K.JOURNAL_ARTEN).map(([k, n]) =>
            `<button type="button" role="radio" data-jn-art="${k}" aria-checked="${(e0 ? e0.art : "idee") === k}">${n}</button>`).join("")}</div></div>
          <label class="seite-feld seite-breit"><span>Warum? Deine These in eigenen Worten</span><textarea id="jn-text" rows="5" maxlength="4000" required placeholder="z. B. Bewertung unter dem eigenen Median, Gewinnschätzungen steigen, Pullback von 20 %.">${e0 ? esc(e0.text) : ""}</textarea></label>
          <label class="seite-feld seite-breit"><span>Woran merkst du, dass du falsch liegst?</span><input id="jn-falsch" type="text" maxlength="600" value="${e0 ? esc(e0.falsch) : ""}" placeholder="z. B. Umsatzwachstum unter 5 % oder Kurs unter 180"></label>
          <label class="seite-feld"><span>Wiedervorlage</span><input id="jn-wv" type="date" value="${e0 && e0.wv ? esc(e0.wv) : ""}"></label>
          <div class="seite-feld seite-schnell"><span>Schnell</span><div><button type="button" class="chip" data-jn-wv="${plus(7)}">in 1 Woche</button><button type="button" class="chip" data-jn-wv="${plus(30)}">in 1 Monat</button>${zahlenTag ? `<button type="button" class="chip" data-jn-wv="${K.isoTag(Date.parse(zahlenTag.tag + "T12:00:00") + 864e5)}">nach den Zahlen</button>` : ""}</div></div>
        </div>
        <div class="seite-knoepfe">
          <button type="submit" class="knopf primaer">${e0 ? "Änderung speichern" : "Eintragen"}</button>
          ${window.WBSzenario ? `<button type="button" class="knopf" data-jn-memo${v && window.WBSzenario.hat(v) ? "" : " hidden"}>Szenario-Memo einfügen</button>` : ""}
          ${e0 ? `<button type="button" class="knopf-text" data-jn-abbrechen>Abbrechen</button>` : ""}
        </div>
        <p class="seite-klein">Beim Eintragen merkt sich Fathom Kurs, Signale und Basis-Szenario des Werts, damit du später siehst, was seitdem passiert ist.</p>
      </form>
      ${fae.length ? `<section class="seite-karte jn-faellig"><h3>Fällig <span class="seite-zahl los">${fae.length}</span></h3><ul class="jn-kurz">${fae.map((e) => `<li><button type="button" class="knopf-text" data-jn-zeigen="${esc(e.id)}">${esc(e.name || "Allgemein")}</button><span>${esc(e.text.slice(0, 90))}${e.text.length > 90 ? " …" : ""}</span></li>`).join("")}</ul></section>` : ""}
      </div><div class="jn-rechts"><section class="seite-karte jn-eintraege">
        <div class="seite-karte-kopf"><h3>Einträge <span class="seite-zahl">${journal.length}</span></h3></div>
        ${journal.length ? `<div class="jn-filter">
          <select id="jn-filter" aria-label="Nach Wert filtern"><option value="">Alle Werte</option>${mitEintraegen.includes("") ? `<option value="_"${jnFilter === "_" ? " selected" : ""}>Allgemein</option>` : ""}${mitEintraegen.filter(Boolean).map((s) => `<option value="${esc(s)}"${jnFilter === s ? " selected" : ""}>${esc(name(s))}</option>`).join("")}</select>
          <input id="jn-suche" type="search" placeholder="Suchen" value="${esc(jnSuche)}" aria-label="Einträge durchsuchen">
          <label class="seite-haken"><input type="checkbox" id="jn-offen"${jnNurOffen ? " checked" : ""}> nur offene Wiedervorlagen</label></div>
          ${liste.length ? `<ol class="jn-liste">${liste.map(karte).join("")}</ol>` : `<p class="seite-leer">Kein Eintrag passt zum Filter.</p>`}`
          : `<p class="seite-leer">Noch keine Einträge. Schreib auf, warum du einen Wert kaufst oder beobachtest; in ein paar Monaten ist das Gold wert.</p>`}
      </section></div></div>`;
  }
  function journalSpeichern() {
    const t = $("#jn-text", huelle).value.trim();
    if (!t) { $("#jn-text", huelle).focus(); return; }
    const slug = $("#jn-wert", huelle).value || null;
    const art = ($("[data-jn-art][aria-checked='true']", huelle) || {}).dataset;
    const alt = jnBearbeiten ? journal.find((e) => e.id === jnBearbeiten) : null;
    const k = slug ? kursVon(slug).kurs : null;
    const sz = slug && window.WBSzenario && window.WBSzenario.hat(slug) ? window.WBSzenario.ergebnis(slug) : null;
    const roh = Object.assign({}, alt || { erstellt: Date.now(), kurs: k, waehrung: slug ? (WERTE[slug] || {}).waehrung : "", basis: sz ? sz.szenarien.b.rendite : null },
      { slug, name: slug ? name(slug) : "", art: art ? art.jnArt : "idee", text: t, falsch: $("#jn-falsch", huelle).value, wv: $("#jn-wv", huelle).value || null });
    if (alt && alt.slug !== slug) Object.assign(roh, { kurs: k, waehrung: slug ? (WERTE[slug] || {}).waehrung : "", basis: sz ? sz.szenarien.b.rendite : null });
    const e = K.eintragPruefen(roh, SLUGS);
    if (!e) return;
    if (alt) journal[journal.indexOf(alt)] = e; else journal.push(e);
    jnBearbeiten = null;
    journalSichern();
    vorgabe = { neu: true };
    zeichnen();
    widgets();
    const el = $("#jn-" + CSS.escape(e.id), huelle);
    if (el) { el.classList.add("neu"); el.scrollIntoView({ block: "nearest" }); }
  }

  /* ================================================================ Ereignisse im Fenster */
  let loeschScharf = null;
  function klick(e) {
    const t = e.target;
    if (t.closest("[data-seite-zu]")) { zu(); return; }
    if (t.closest("[data-seite-weg], a[href^='#']")) { ausloeser = null; zu(); return; }   // Link zur Analyse: Fenster macht Platz
    if (t.closest("[data-zum-portfolio]")) {
      ausloeser = null; zu();
      const k = $('[data-kachel="depot"]'); if (k) { k.click(); k.scrollIntoView({ block: "start", behavior: "smooth" }); }
      return;
    }
    const f = t.closest("[data-tm-filter]");
    if (f) { terminFilter = f.dataset.tmFilter; zeichnen(); return; }
    const az = t.closest("[data-alarm-zahlen]");
    if (az) {
      const a = K.alarmPruefen({ slug: az.dataset.alarmZahlen, art: "zahlen", wert: 1, notiz: "aus den Terminen" }, SLUGS);
      if (a && !alarme.some((x) => x.slug === a.slug && x.art === "zahlen" && x.wert === 1)) { alarme.push(a); pruefen(); }
      az.textContent = "Alarm gesetzt"; az.disabled = true;
      return;
    }
    // Alarme
    const g = t.closest("[data-al-gesehen]");
    if (g) { const a = alarme.find((x) => x.id === g.dataset.alGesehen); if (a) a.gesehen = true; alarmeSichern(); pruefen(); zeichnen(); return; }
    if (t.closest("[data-al-alle-gesehen]")) { alarme.forEach((a) => { if (a.ausgeloest) a.gesehen = true; }); alarmeSichern(); pruefen(); zeichnen(); return; }
    const an = t.closest("[data-al-an]");
    if (an) { const a = alarme.find((x) => x.id === an.dataset.alAn); if (a) { a.an = !a.an; a.ausgeloest = null; a.gesehen = false; } pruefen(); zeichnen(); return; }
    const weg = t.closest("[data-al-weg], [data-jn-weg]");
    if (weg) {
      const id = weg.dataset.alWeg || weg.dataset.jnWeg;
      if (loeschScharf !== id) { loeschScharf = id; weg.textContent = "Wirklich löschen?"; setTimeout(() => { if (loeschScharf === id) { loeschScharf = null; if (weg.isConnected) weg.textContent = "Löschen"; } }, 4000); return; }
      loeschScharf = null;
      if (weg.dataset.alWeg) { alarme = alarme.filter((a) => a.id !== id); alarmeSichern(); }
      else { journal = journal.filter((x) => x.id !== id); if (jnBearbeiten === id) jnBearbeiten = null; journalSichern(); }
      zeichnen(); widgets(); return;
    }
    // Journal: Ansicht und Trading-Kalender
    const an2 = t.closest("[data-jn-ansicht]");
    if (an2) { jnAnsicht = an2.dataset.jnAnsicht; schreib("fathom.journal.ansicht", jnAnsicht === "kalender" ? "kalender" : null); vorgabe = { neu: true }; zeichnen(); return; }
    const mo = t.closest("[data-tk-monat]");
    if (mo) {
      const d = +mo.dataset.tkMonat;
      if (!d) { const h = new Date(); tkJahr = h.getFullYear(); tkMonat = h.getMonth(); tkTag = K.isoTag(Date.now()); }
      else { const n = new Date(tkJahr, tkMonat + d, 1); tkJahr = n.getFullYear(); tkMonat = n.getMonth(); tkTag = null; }
      tkBearbeiten = null; vorgabe = { neu: true }; zeichnen(); return;
    }
    const tg = t.closest("[data-tk-tag]");
    if (tg) {
      tkTag = tkTag === tg.dataset.tkTag ? null : tg.dataset.tkTag; tkBearbeiten = null;
      const d = new Date(tg.dataset.tkTag + "T12:00:00");
      if (d.getMonth() !== tkMonat) { tkJahr = d.getFullYear(); tkMonat = d.getMonth(); }
      vorgabe = { neu: true }; zeichnen();
      const k = $("#tk-tagkarte", huelle); if (k) k.scrollIntoView({ block: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      const f = $(`[data-tk-tag="${tkTag}"]`, huelle); if (f) f.focus({ preventScroll: true });
      return;
    }
    const ri = t.closest("[data-tk-richtung]");
    if (ri) { $$("[data-tk-richtung]", huelle).forEach((b) => b.setAttribute("aria-checked", String(b === ri))); tradeVorschau(); return; }
    const tb = t.closest("[data-tk-bearbeiten]");
    if (tb) { tkBearbeiten = tb.dataset.tkBearbeiten; vorgabe = { neu: true }; zeichnen(); const f = $(".tk-form", huelle); if (f) { f.scrollIntoView({ block: "start" }); tradeVorschau(); } return; }
    if (t.closest("[data-tk-abbrechen]")) { tkBearbeiten = null; vorgabe = { neu: true }; zeichnen(); return; }
    const tw = t.closest("[data-tk-weg]");
    if (tw) {
      const id = tw.dataset.tkWeg;
      if (loeschScharf !== id) { loeschScharf = id; tw.textContent = "Wirklich löschen?"; setTimeout(() => { if (loeschScharf === id) { loeschScharf = null; if (tw.isConnected) tw.textContent = "Löschen"; } }, 4000); return; }
      loeschScharf = null; trades = trades.filter((x) => x.id !== id); if (tkBearbeiten === id) tkBearbeiten = null;
      tradesSichern(); zeichnen(); widgets(); return;
    }
    // Journal
    const art = t.closest("[data-jn-art]");
    if (art) { $$("[data-jn-art]", huelle).forEach((b) => b.setAttribute("aria-checked", String(b === art))); return; }
    const wv = t.closest("[data-jn-wv]");
    if (wv) { $("#jn-wv", huelle).value = wv.dataset.jnWv; return; }
    if (t.closest("[data-jn-memo]")) {
      const s = $("#jn-wert", huelle).value, m = s && window.WBSzenario ? window.WBSzenario.memoText(s) : null, feld = $("#jn-text", huelle);
      if (m) { feld.value = (feld.value.trim() ? feld.value.trim() + "\n\n" : "") + m; feld.focus(); }
      return;
    }
    const er = t.closest("[data-jn-erledigt]");
    if (er) { const x = journal.find((e) => e.id === er.dataset.jnErledigt); if (x) x.erledigt = true; journalSichern(); zeichnen(); widgets(); return; }
    const be = t.closest("[data-jn-bearbeiten]");
    if (be) { jnBearbeiten = be.dataset.jnBearbeiten; vorgabe = { neu: true }; zeichnen(); $(".seite-inhalt", huelle).scrollTop = 0; $("#jn-text", huelle).focus(); return; }
    if (t.closest("[data-jn-abbrechen]")) { jnBearbeiten = null; vorgabe = { neu: true }; zeichnen(); return; }
    const zg = t.closest("[data-jn-zeigen]");
    if (zg) {
      if (offen !== "journal") oeffnen("journal");
      jnFilter = ""; jnSuche = ""; jnNurOffen = false; zeichnen();
      const el = $("#jn-" + CSS.escape(zg.dataset.jnZeigen), huelle);
      if (el) { el.scrollIntoView({ block: "center" }); el.classList.add("neu"); }
    }
  }
  function aenderung(e) {
    const t = e.target;
    if (t.id === "al-benachrichtigen") {
      benachrichtigen = t.checked;
      if (t.checked && typeof Notification !== "undefined" && Notification.permission === "default") {
        Notification.requestPermission().then((p) => { if (p !== "granted") { benachrichtigen = false; t.checked = false; } alarmeSichern(); });
      }
      alarmeSichern(); return;
    }
    if (t.id === "al-wert" || t.id === "al-art") { alarmFormHinweis(); return; }
    if (t.id === "jn-wert") { const m = $("[data-jn-memo]", huelle); if (m) m.hidden = !(t.value && window.WBSzenario && window.WBSzenario.hat(t.value)); return; }
    if (t.id === "jn-filter") { jnFilter = t.value; zeichnen(); return; }
    if (t.id === "tk-depot") { mitDepot = t.checked; tradesSichern(); zeichnen(); widgets(); return; }
    if (t.id && t.id.startsWith("tk-")) { tradeVorschau(); return; }
    if (t.id === "jn-offen") { jnNurOffen = t.checked; zeichnen(); }
  }
  function eingabe(e) {
    if (e.target.id === "al-schwelle") alarmFormHinweis();
    if (e.target.id && e.target.id.startsWith("tk-")) tradeVorschau();
    if (e.target.id === "jn-suche") {
      jnSuche = e.target.value;
      const pos = e.target.selectionStart;
      zeichnen();
      const s = $("#jn-suche", huelle); if (s) { s.focus(); s.setSelectionRange(pos, pos); }
    }
  }
  function absenden(e) {
    e.preventDefault();
    const f = e.target.dataset.form;
    if (f === "journal") { journalSpeichern(); return; }
    if (f === "trade") { tradeSpeichern(); return; }
    if (f === "alarm") {
      const a = K.alarmPruefen({ slug: $("#al-wert", huelle).value, art: $("#al-art", huelle).value, wert: $("#al-schwelle", huelle).value, notiz: $("#al-notiz", huelle).value }, SLUGS);
      if (!a) { $("#al-hinweis", huelle).textContent = "Bitte eine gültige Schwelle eintragen."; return; }
      alarme.push(a);
      vorgabe = { neu: true, slug: a.slug };
      pruefen();
      zeichnen();
    }
  }

  /* ================================================================ Widgets in der Taskleiste */
  const wert = (id) => $(`[data-dock-wert="${id}"]`, dock);
  // Nur schreiben, was sich geändert hat (sonst gehen Klicks unter dem Zeiger verloren)
  const mehr = (id) => { const el = $(`[data-dock-mehr="${id}"]`, dock); return { set innerHTML(h) { if (el && el.innerHTML !== h) el.innerHTML = h; } }; };
  const widget = (id) => $(`[data-dock="${id}"]`, dock);
  function setze(id, text, an, bald, extra) {
    const w = widget(id); if (!w) return;
    if (wert(id).textContent !== text) wert(id).textContent = text;
    w.classList.toggle("bald", !!bald);
    const led = $(".dock-led", w);
    led.classList.toggle("an", !!an);
    led.classList.toggle("minus", extra === "minus");
  }
  function widgets() {
    const jetzt = Date.now();
    // Termine
    termineNeu();
    const n = K.naechsterMeiner(termineListe), tn = n ? K.tageBis(n.tag, jetzt) : null;
    setze("termine", n ? (tn === 0 ? "heute" : tn === 1 ? "morgen" : `${tn} T`) : "–", !!n && n.mein, n && n.mein && tn <= 1);
    const meine = termineListe.filter((t) => t.mein).slice(0, 3);
    mehr("termine").innerHTML = meine.length ? meine.map((t) => `<span class="dock-k-zeile"><b>${esc(t.titel.replace(/^Quartalszahlen /, ""))}</b> · ${esc(t.art === "zahlen" ? "Zahlen" : TERMIN_ART[t.art])}, ${esc(K.tagText(t.tag, jetzt))}</span>`).join("")
      : `<span class="dock-k-zeile">Nichts für deine Werte in den nächsten drei Wochen.</span>`;
    // Alarme
    const los = K.offeneAlarme(alarme), aktiv = alarme.filter((a) => a.an);
    setze("alarme", los.length ? `${los.length} neu` : aktiv.length ? String(aktiv.length) : "neu", los.length > 0, los.length > 0);
    mehr("alarme").innerHTML = los.length ? los.slice(0, 3).map((a) => `<span class="dock-k-zeile"><b>${esc(name(a.slug))}</b> ${esc(K.ARTEN[a.art].name)}</span>`).join("")
      : `<span class="dock-k-zeile">${aktiv.length ? `${aktiv.length} ${aktiv.length === 1 ? "Alarm" : "Alarme"} scharf, keiner ausgelöst.` : "Noch keine Alarme."}</span>`;
    // Depot
    const d = depotZeilen();
    if (d && d.lage.n) {
      const b = d.lage.heute || d.lage.woche;
      setze("depot", euroKurz(d.lage.wert), !!b, false, b && b.euro < 0 ? "minus" : null);
      const gr = d.zeilen.slice().sort((a, x) => x.w - a.w)[0];
      mehr("depot").innerHTML = `${b ? `<span class="dock-k-zeile">${d.lage.heute ? "Heute" : "Woche"}: <b class="${klasse(b.euro)}">${b.euro >= 0 ? "+" : "−"}${nf(0).format(Math.abs(b.euro))} € (${pct(b.pct)})</b></span>` : ""}
        <span class="dock-k-zeile">${d.lage.n} Positionen · größte: ${esc(gr.name)} ${pct(gr.w / d.lage.wert, 0, false)}</span>`;
    } else { setze("depot", "leer", false, false); mehr("depot").innerHTML = `<span class="dock-k-zeile">Noch kein Depot eingelesen.</span>`; }
    // Journal
    const fae = K.faellig(journal, jetzt);
    setze("journal", fae.length ? `${fae.length} fällig` : journal.length ? String(journal.length) : "neu", fae.length > 0, fae.length > 0);
    const letzt = journal.slice().sort((a, b) => b.erstellt - a.erstellt)[0];
    const mon = K.monatsKalender(alleTrades(), new Date().getFullYear(), new Date().getMonth()).statistik;
    const monZeile = mon.n ? `<span class="dock-k-zeile">${MONATE[new Date().getMonth()]}: <b class="${klasse(mon.netto)}">${eur(mon.netto)}</b> aus ${mon.n} ${mon.n === 1 ? "Trade" : "Trades"}</span>` : "";
    mehr("journal").innerHTML = monZeile + (fae.length ? fae.slice(0, 3).map((e) => `<span class="dock-k-zeile"><b>${esc(e.name || "Allgemein")}</b> · Wiedervorlage ${esc(K.tagText(e.wv, jetzt))}</span>`).join("")
      : letzt ? `<span class="dock-k-zeile">Zuletzt: <b>${esc(letzt.name || "Allgemein")}</b>, ${esc(new Date(letzt.erstellt).toLocaleDateString("de-DE"))}</span>` : `<span class="dock-k-zeile">Noch keine Einträge.</span>`);
  }
  function alles() { pruefen(); widgets(); auffrischen(); }

  /* ================================================================ Takt */
  let kursT = 0;
  document.addEventListener("wb:kurse", () => { if (Date.now() - kursT > 2000) { kursT = Date.now(); bald(); if (offen === "depot") auffrischen(); } });
  ["fathom:signale", "wb:szenario"].forEach((ev) => document.addEventListener(ev, bald));
  document.addEventListener("wb:depot", () => { widgets(); if (offen === "depot") auffrischen(); });
  document.addEventListener("DOMContentLoaded", () => {
    kalenderLaden();
    setTimeout(alles, 300);   // nach Screener-Regeln und Szenarien
    setInterval(() => { if (!document.hidden) { pruefen(); } }, 60000);
  });

  window.WBSeiten = { oeffnen, zu, offen: () => offen, alarme: () => alarme.slice(), journal: () => journal.slice() };
})();
