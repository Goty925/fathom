/* Fathom: Signale im Browser – Auswahl im Screener, eigene Schwellen, Rechenweg, Neuberechnung.
 *
 * Die Signale kommen als Spezifikation aus src/kriterien.py (live-basis → spez). Diese Datei wertet sie mit
 * denselben Regeln aus wie Python: Stärke 0–100, genau 50 an der Schwelle, „und“ = schwächster Teil zählt,
 * „oder“ = stärkster Teil zählt. Ohne eigene Auswahl stimmen alle Balken mit dem Wochenbericht überein.
 * Deine Auswahl (zählt, Pflicht, Treffer-Schwelle, Schwellenwerte) liegt nur in diesem Browser.
 */
(function () {
  "use strict";
  const { $, $$, nf, esc, lies, schreib } = window.WBH;
  const basisEl = $("#live-basis");
  if (!basisEl || document.body.hasAttribute("data-archiv")) return;
  const basis = JSON.parse(basisEl.textContent);
  const SPEZ = basis.spez;
  if (!SPEZ) return;
  const KLASSEN = Object.keys(SPEZ.katalog);
  const WORT = { aktie: "Aktien", forex: "Währungspaaren", rohstoff: "Rohstoffen", index: "Indizes" };
  const TITEL = { aktie: "Aktien", forex: "Forex", rohstoff: "Rohstoffe", index: "Indizes & Futures" };

  /* ---------------------------------------------------------------- Formate (wie kriterien.fmt in Python) */
  function fmt(x, code, dez) {
    if (code === "t") return x == null || x === "" ? "–" : String(x);
    if (x == null || typeof x !== "number" || !isFinite(x)) return "–";
    if (code === "kurs") return nf(dez || 2).format(x).replace(/-/g, "−");
    const vz = code.endsWith("v"), c = vz ? code.slice(0, -1) : code, zeichen = vz && x > 0 ? "+" : "";
    let s;
    if (c === "p0" || c === "p1" || c === "p2") s = zeichen + nf(+c[1]).format(x * 100) + " %";
    else if (c === "pp") s = (x > 0 ? "+" : "") + nf(2).format(x * 100) + " Pp.";
    else if (c === "x1" || c === "x2") s = nf(+c[1]).format(x) + "×";
    else if (c === "z0" || c === "z1" || c === "z2") s = zeichen + nf(+c[1]).format(x);
    else if (c === "mrd") s = nf(Math.abs(x) >= 1e11 ? 0 : 1).format(x / 1e9) + " Mrd. €";
    else if (c === "geld") s = nf(1).format(x / 1e9) + " Mrd.";
    else if (c === "zmrd") s = nf(0).format(x) + " Mrd. €";
    else s = nf(2).format(x);
    return s.replace(/-/g, "−");
  }
  function text(vorlage, kz, params, dez) {
    const teile = Array.isArray(vorlage) ? vorlage : [vorlage], aus = [];
    teile.forEach((t) => {
      let fehlt = false;
      const s = t.replace(/\{(@?\w+):(\w+)\}/g, (m, name, code) => {
        const w = name[0] === "@" ? params[name.slice(1)] : kz[name];
        if (w == null) fehlt = true;
        return fmt(w, code, dez);
      });
      if (!fehlt) aus.push(s);
    });
    return aus.length ? aus.join(", ") : null;
  }
  // Für Titel und aria: geschützte Leerzeichen sind dort unnötig
  const flach = (s) => (s || "").replace(/ /g, " ");

  /* ---------------------------------------------------------------- Auswahl und Schwellen */
  const SPEICHER = "fathom.auswahl";
  let eigene = {};
  try { eigene = JSON.parse(lies(SPEICHER) || "{}") || {}; } catch (e) { eigene = {}; }
  // Regler-Werte aus der Vorversion („Eigene Regeln“) übernehmen
  try {
    const alt = JSON.parse(lies("fathom.regeln") || "null");
    if (alt) {
      Object.entries(alt).forEach(([typ, p]) => { eigene[typ] = Object.assign({}, eigene[typ] || {}, { params: Object.assign({}, p, (eigene[typ] || {}).params || {}) }); });
      schreib("fathom.regeln", null); speichern();
    }
  } catch (e) { /* ignorieren */ }
  // Gespeicherte Auswahl prüfen: nur bekannte Klassen, Signale aus dem Katalog, Schwellen als endliche Zahlen.
  // Schützt davor, dass manipulierte Einträge (z. B. aus einer fremden Sicherung) als HTML in die Seite gelangen.
  (function saeubern() {
    const roh = eigene && typeof eigene === "object" && !Array.isArray(eigene) ? eigene : {};
    eigene = {};
    KLASSEN.forEach((typ) => {
      const e = roh[typ]; if (!e || typeof e !== "object") return;
      const namen = Object.keys(SPEZ.katalog[typ] || {});
      const liste = (x) => (Array.isArray(x) ? x.filter((n) => typeof n === "string" && namen.includes(n)) : undefined);
      const sauber = {};
      if (liste(e.zaehlt)) sauber.zaehlt = liste(e.zaehlt);
      if (liste(e.pflicht)) sauber.pflicht = liste(e.pflicht);
      if (Number.isInteger(e.treffer_ab) && e.treffer_ab >= 0 && e.treffer_ab <= namen.length) sauber.treffer_ab = e.treffer_ab;
      if (e.params && typeof e.params === "object") {
        const pr = {};
        Object.entries(e.params).forEach(([k, v]) => { if (k in (SPEZ.params[typ] || {}) && typeof v === "number" && isFinite(v)) pr[k] = v; });
        if (Object.keys(pr).length) sauber.params = pr;
      }
      if (Object.keys(sauber).length) eigene[typ] = sauber;
    });
  })();
  function speichern() {
    Object.keys(eigene).forEach((t) => { if (!Object.keys(eigene[t]).length) delete eigene[t]; });
    schreib(SPEICHER, Object.keys(eigene).length ? JSON.stringify(eigene) : null);
  }
  const gleich = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
  function auswahl(typ) {
    const std = SPEZ.auswahl[typ], e = eigene[typ] || {};
    const zaehlt = e.zaehlt || std.zaehlt, pflicht = e.pflicht || std.pflicht, n = zaehlt.length + pflicht.length;
    let ab = e.treffer_ab;
    if (ab == null) ab = gleich(zaehlt, std.zaehlt) && gleich(pflicht, std.pflicht) ? std.treffer_ab : Math.ceil(n * 0.75);
    return { zaehlt, pflicht, n, treffer_ab: Math.max(n ? 1 : 0, Math.min(n, ab)) };
  }
  const params = (typ) => Object.assign({}, SPEZ.params[typ], (eigene[typ] || {}).params || {});
  const schwellenEigen = (typ) => Object.entries((eigene[typ] || {}).params || {}).some(([k, v]) => SPEZ.params[typ][k] !== v);
  function istEigen(typ) {
    const e = eigene[typ]; if (!e) return false;
    const std = SPEZ.auswahl[typ];
    return schwellenEigen(typ) || (e.zaehlt && !gleich(e.zaehlt, std.zaehlt)) || (e.pflicht && !gleich(e.pflicht, std.pflicht)) || (e.treffer_ab != null && e.treffer_ab !== std.treffer_ab);
  }
  const aktiv = (typ, name) => { const a = auswahl(typ); return a.zaehlt.includes(name) || a.pflicht.includes(name); };

  /* ---------------------------------------------------------------- Auswertung (wie kriterien.pruefe in Python) */
  function skala(x, nul, grenze, voll) {
    if (x == null || !isFinite(x)) return null;
    let s;
    if ((x - grenze) * (voll - grenze) >= 0) s = 50 + 50 * (x - grenze) / (voll - grenze);
    else if (grenze === nul) s = 0;
    else s = 50 * (x - nul) / (grenze - nul);
    return Math.max(0, Math.min(100, s));
  }
  const und = (...w) => { const d = w.filter((x) => x != null); if (!d.length) return null; const s = Math.min(...d); return d.length < w.length ? Math.min(s, 45) : s; };
  const oder = (...w) => { const d = w.filter((x) => x != null); return d.length ? Math.max(...d) : null; };

  // Kennzahlen mit dem aktuellen Kurs; ohne Live-Kurs exakt die Werte des Wochenberichts
  function kennzahlen(b, p) {
    const kz = Object.assign({}, b.kz || {});
    if (p == null || Math.abs(p - b.kurs) < 1e-12) return kz;
    const r = p / b.kurs;
    kz.kurs = p;
    if (kz.hoch != null) {
      const hoch = Math.max(kz.hoch, p), tief = Math.min(kz.tief, p);
      Object.assign(kz, { hoch, tief, abstand_hoch: 1 - p / hoch, position_spanne: hoch > tief ? (p - tief) / (hoch - tief) : null });
    }
    if (kz.boersenwert_eur != null) kz.boersenwert_eur *= r;
    if (kz.fwd_kgv != null) { kz.fwd_kgv *= r; kz.kgv_rel = kz.kgv_median ? kz.fwd_kgv / kz.kgv_median : null; }
    if (kz.ziel != null) kz.kursziel_abstand = kz.ziel / p - 1;
    if (kz.mittel_5j) kz.abweichung_mittel_5j = p / kz.mittel_5j - 1;
    if (kz.gd200) kz.abstand_gd200 = p / kz.gd200 - 1;
    if (kz.kurs_3m) kz.rendite_3m = p / kz.kurs_3m - 1;
    if (kz.fcf_rendite != null) kz.fcf_rendite /= r;
    return kz;
  }

  function teil(t, kz, P, dez) {
    const x = kz[t.k];
    const gRoh = P[t.p] * (t.skal || 1) * (t.vz || 1);
    let xs, g, nul, voll;
    if (t.log) { xs = x == null ? null : Math.log10(Math.max(x, 1)); g = Math.log10(gRoh); nul = g - 1; voll = g + Math.log10(20); }
    else { xs = x; g = gRoh; nul = "n_abs" in t ? t.n_abs : g + t.n; voll = "v_abs" in t ? t.v_abs : g + t.v; }
    const ok = x == null ? null : t.r === ">=" ? xs >= g : xs <= g;
    const f = (v) => (t.log ? fmt(Math.pow(10, v), t.fmt, dez) : fmt(v, t.fmt, dez));
    return { name: t.name, wert: x == null ? "fehlt" : fmt(x, t.fmt, dez), bedingung: (t.r === ">=" ? "≥ " : "≤ ") + fmt(gRoh, t.fmt, dez),
             rechnung: text(t.rechnung, kz, P, dez) || t.rechnung.replace(/\{[^}]+\}/g, "–"), ok, s: skala(xs, nul, g, voll),
             skala: `${t.log ? "logarithmisch, " : ""}0 bei ${f(nul)}, 50 bei ${f(g)}, 100 bei ${f(voll)}` };
  }
  function pruefe(k, kz, P, dez) {
    const teile = k.teile.map((t) => teil(t, kz, P, dez));
    const bekannt = teile.filter((t) => t.ok != null);
    let e, s;
    if (!bekannt.length) { e = null; s = null; }
    else if (k.verkn === "oder") { e = bekannt.some((t) => t.ok); s = oder(...teile.map((t) => t.s)); }
    else if (k.verkn === "und") { e = teile.every((t) => t.ok === true); s = und(...teile.map((t) => t.s)); }
    else { e = teile[0].ok; s = teile[0].s; }
    return { e, s, t: flach(text(k.text, kz, P, dez)) || "Daten fehlen", teile, verkn: k.verkn === "einzeln" ? null : k.verkn };
  }

  function aktuellerKurs(slug) {
    const s = window.WBLive && window.WBLive.stand && window.WBLive.stand[slug];
    return s && s.kurs ? s.kurs : basis.werte[slug].kurs;
  }
  const ergebnisse = {};
  function bewerte(slug, p, mitParams, mitAuswahl) {
    const b = basis.werte[slug];
    if (!b || !SPEZ.katalog[b.typ] || !b.kz) return null;
    p = p || aktuellerKurs(slug);
    const P = mitParams || params(b.typ), kz = kennzahlen(b, p), a = mitAuswahl || auswahl(b.typ);
    const k = {};
    SPEZ.katalog[b.typ].forEach((kr) => (k[kr.name] = pruefe(kr, kz, P, b.dez)));
    const zaehlend = a.zaehlt.concat(a.pflicht);
    const punkte = zaehlend.filter((n) => k[n] && k[n].e === true).length;
    const pflichtOk = a.pflicht.every((n) => k[n] && k[n].e === true);
    return { k, p, punkte, max: zaehlend.length, treffer: pflichtOk && punkte >= a.treffer_ab, knapp: pflichtOk && punkte === a.treffer_ab - 1, pflichtOk };
  }

  /* ---------------------------------------------------------------- Anzeige */
  function setze(slug, r) {
    ergebnisse[slug] = r;
    $$(`[data-slug="${slug}"], [data-depot-slug="${slug}"]`).forEach((w) => {
      Object.entries(r.k).forEach(([name, x]) => {
        $$(`.akku[data-krit="${name}"]`, w).forEach((m) => {
          m.classList.toggle("an", x.e === true);
          m.classList.toggle("offen", x.e == null || x.s == null);
          m.classList.toggle("kritisch", x.s != null && x.s < 10);
          m.style.setProperty("--s", x.s == null ? 0 : (x.s / 100).toFixed(3));
          m.title = `${name}: ${x.t}`;
          m.setAttribute("aria-label", `${name}: ${x.e ? "erfüllt" : x.e == null ? "Daten fehlen" : "nicht erfüllt"}. Rechenweg anzeigen`);
        });
        $$(`[data-krit-status="${name}"]`, w).forEach((el) => {
          el.textContent = x.e ? "erfüllt" : x.e == null ? "Daten fehlen" : "nicht erfüllt";
          el.className = "status " + (x.e ? "ja" : "nein");
        });
        $$(`[data-krit-text="${name}"]`, w).forEach((el) => { if (el.textContent !== x.t) el.textContent = x.t; });
      });
      $$('[data-live="punkte"]', w).forEach((el) => (el.textContent = String(r.punkte)));
      $$('[data-live="max"]', w).forEach((el) => (el.textContent = String(r.max)));
      $$('[data-live="treffer"]', w).forEach((el) => (el.hidden = !r.treffer));
      if (w.matches("tr[data-slug]")) { w.dataset.punkte = String(r.punkte); w.dataset.treffer = r.treffer ? "1" : "0"; }
      $$(".rechenweg-flaeche:not([hidden])", w).forEach((f) => (f.innerHTML = rechenwegHTML(slug, f.dataset.signal)));
    });
    if (tipp && !tipp.hidden && tipp.dataset.slug === slug) tippFuellen(slug, tipp.dataset.signal);
  }
  function status(slug) {
    if (ergebnisse[slug]) return ergebnisse[slug];
    const r = bewerte(slug);
    if (r) ergebnisse[slug] = r;
    return r;
  }
  const punkte = (slug) => { const r = status(slug); return r ? r.punkte : null; };

  let lageGeplant = false;
  function lageSpaeter() {
    if (lageGeplant) return;
    lageGeplant = true;
    requestAnimationFrame(() => { lageGeplant = false; lage(); document.dispatchEvent(new CustomEvent("fathom:signale")); });
  }
  // Lage oben, Kacheln und Signal-Leisten
  function lage() {
    const aktien = Object.entries(basis.werte).filter(([, b]) => b.typ === "aktie");
    const link = ([slug, b]) => `<a href="#${esc(slug)}">${esc(b.name)}</a>`;
    const treffer = aktien.filter(([s]) => status(s) && status(s).treffer).sort((a, b) => punkte(b[0]) - punkte(a[0]));
    const knapp = aktien.filter(([s]) => status(s) && status(s).knapp);
    const setzeHtml = (sel, html) => $$(sel).forEach((el) => { if (el.innerHTML !== html) el.innerHTML = html; });
    const a = auswahl("aktie");
    setzeHtml('[data-lage="treffer-titel"]', `Treffer: mindestens ${a.treffer_ab} von ${a.n} Signalen${a.pflicht.length ? ", alle Pflichtsignale" : ""}`);
    setzeHtml('[data-lage="treffer-zahl"]', `${treffer.length}<span> von ${aktien.length}</span>`);
    setzeHtml('[data-lage="treffer-namen"]', treffer.length ? treffer.map(link).join(", ") : "Diese Woche keine");
    setzeHtml('[data-lage="knapp-zahl"]', String(knapp.length));
    setzeHtml('[data-lage="knapp-namen"]', knapp.length ? knapp.map(link).join(", ") : "Keine");
    KLASSEN.forEach((typ) => {
      const n = Object.keys(basis.werte).filter((s) => basis.werte[s].typ === typ && status(s) && status(s).treffer).length;
      setzeHtml(`[data-kachel-info="${typ}"]`, `${n} ${n === 1 ? "Treffer" : "Treffer"}`);
      leiste(typ);
    });
  }
  function leiste(typ) {
    const a = auswahl(typ), alle = SPEZ.katalog[typ].length;
    $$(`[data-kriterien-leiste="${typ}"]`).forEach((el) => {
      const namen = a.zaehlt.concat(a.pflicht);
      $(".kl-text", el).innerHTML = `<b>${namen.length} von ${alle} Signalen aktiv</b>, Treffer ab ${a.treffer_ab} erfüllten${a.pflicht.length ? `, Pflicht: ${esc(a.pflicht.join(", "))}` : ""}.`
        + `<span class="kl-namen">${esc(a.zaehlt.join(", "))}</span>`;
      $(".kl-marke", el).hidden = !istEigen(typ);
    });
  }

  // Spalten, Signale im Panel und Profil an die Auswahl anpassen
  function spaltenAnwenden(typ) {
    const a = auswahl(typ), namen = a.zaehlt.concat(a.pflicht);
    const box = $(`[data-kachel-inhalt="${typ}"]`);
    if (box) {
      $$("[data-spalte]", box).forEach((el) => {
        el.hidden = !namen.includes(el.dataset.spalte);
        el.classList.toggle("pflicht", a.pflicht.includes(el.dataset.spalte));
      });
      $$(".akkus .akku[data-krit]", box).forEach((m) => (m.hidden = !namen.includes(m.dataset.krit)));
      $$("table[data-kriterien-tabelle]", box).forEach((t) => t.classList.toggle("viele", namen.length > 5));
    }
    Object.keys(basis.werte).filter((s) => basis.werte[s].typ === typ).forEach((slug) => {
      const art = document.getElementById("analyse-" + slug);
      if (!art) return;
      $$(".kriterium[data-kriterium]", art).forEach((k) => {
        k.hidden = !namen.includes(k.dataset.kriterium);
        k.classList.toggle("pflicht", a.pflicht.includes(k.dataset.kriterium));
      });
      const f = $(".rechenweg-flaeche", art);
      if (f && !namen.includes(f.dataset.signal)) f.hidden = true;
    });
    // Portfolio-Tabelle kopiert die Profile: Ausblenden dort genauso
    $$(".depot-tabelle .akkus .akku[data-krit]").forEach((m) => {
      const w = m.closest("[data-depot-slug]"), b = w && basis.werte[w.dataset.depotSlug];
      if (b && b.typ === typ) m.hidden = !namen.includes(m.dataset.krit);
    });
  }

  function alleAnwenden() {
    KLASSEN.forEach(spaltenAnwenden);
    Object.keys(basis.werte).forEach((slug) => { const r = bewerte(slug); if (r) setze(slug, r); });
    lageSpaeter();
    if (fenster && !fenster.hidden) wirkung();
  }

  /* ---------------------------------------------------------------- Rechenweg */
  const SIGNAL_TEXT = { und: "Beide Bedingungen sind nötig, deshalb zählt die schwächere Stärke.", oder: "Eine Bedingung reicht, deshalb zählt die stärkere Stärke." };
  function rechenwegHTML(slug, signal) {
    const r = status(slug), b = basis.werte[slug];
    if (!r || !r.k[signal]) return "";
    const x = r.k[signal], kr = SPEZ.katalog[b.typ].find((k) => k.name === signal);
    const teile = x.teile.map((t) => `
      <div class="rw-teil ${t.ok == null ? "" : t.ok ? "ja" : "nein"}">
        <div class="rw-zeile"><span class="rw-name">${esc(t.name)}</span><b class="rw-wert">${esc(t.wert)}</b></div>
        <div class="rw-rechnung">${esc(t.rechnung)}</div>
        <div class="rw-zeile rw-pruefung"><span>Bedingung ${esc(t.bedingung)}: ${t.ok == null ? "Daten fehlen" : t.ok ? "erfüllt" : "nicht erfüllt"}</span>
          <span class="rw-staerke"><span class="akku${t.s != null && t.s >= 50 ? " an" : ""}${t.s != null && t.s < 10 ? " kritisch" : ""}${t.s == null ? " offen" : ""}" style="--s:${t.s == null ? 0 : (t.s / 100).toFixed(3)}" aria-hidden="true"><i></i></span>${t.s == null ? "–" : nf(0).format(t.s)}</span></div>
        <div class="rw-skala">Stärke ${esc(t.skala)}</div>
      </div>`).join("");
    const fehltTeil = x.verkn === "und" && x.teile.some((t) => t.s == null);
    const schluss = x.s == null ? "Ohne Daten kein Ergebnis. Die Quelle war beim letzten Bericht nicht erreichbar oder liefert für diesen Wert nichts."
      : `${x.verkn ? SIGNAL_TEXT[x.verkn] + " " : ""}${fehltTeil ? "Weil ein Teil fehlt, höchstens 45. " : ""}Stärke ${nf(0).format(x.s)} von 100, damit <b>${x.e ? "erfüllt" : "nicht erfüllt"}</b> (erfüllt ab 50).`;
    const hinweise = [];
    if (kr && kr.quelle) hinweise.push(`Grundlage: ${esc(kr.quelle)}.`);
    if (schwellenEigen(b.typ)) hinweise.push("Gerechnet mit deinen eigenen Schwellen.");
    if (Math.abs(r.p - b.kurs) > 1e-9) hinweise.push(`Mit dem aktuellen Kurs ${fmt(r.p, "kurs", b.dez)} ${esc(b.waehrung || "")} statt dem Wochenstand.`);
    if (!aktiv(b.typ, signal)) hinweise.push("Dieses Signal zählt bei dir gerade nicht mit.");
    return `<p class="rw-kopf"><b>${esc(signal)}</b><span>${esc(b.name)}</span></p>${teile}
      <p class="rw-ergebnis">${schluss}</p>${hinweise.length ? `<p class="rw-hinweis">${hinweise.join(" ")}</p>` : ""}
      <button type="button" class="knopf-text rw-regeln" data-kriterien-oeffnen="${esc(b.typ)}" data-kriterium-fokus="${esc(signal)}">Signal und Schwelle anpassen</button>`;
  }
  function flaecheUmschalten(kriterium, signal) {
    const art = kriterium.closest("[data-slug]"), gitter = kriterium.parentElement, slug = art.dataset.slug;
    let f = $(".rechenweg-flaeche", gitter);
    const zu = f && !f.hidden && f.dataset.signal === signal;
    $$(".rechenweg-knopf", gitter).forEach((k) => {
      const an = !zu && k.dataset.rechenweg === signal;
      k.setAttribute("aria-expanded", String(an));
      k.textContent = an ? "Rechenweg ausblenden" : "Rechenweg";
    });
    if (zu) { f.hidden = true; return; }
    if (!f) { f = document.createElement("div"); f.className = "rechenweg-flaeche rw"; }
    f.dataset.signal = signal;
    f.innerHTML = rechenwegHTML(slug, signal);
    if (window.matchMedia("(max-width: 640px)").matches) kriterium.after(f); else gitter.appendChild(f);
    f.hidden = false;
  }

  let tipp = null, anker = null;
  function tippFuellen(slug, signal) { tipp.innerHTML = `<div class="rw">${rechenwegHTML(slug, signal)}</div>`; }
  function tippZeigen(akku) {
    const w = akku.closest("[data-slug], [data-depot-slug]");
    const slug = w.dataset.slug || w.dataset.depotSlug, signal = akku.dataset.krit;
    if (!basis.werte[slug] || !SPEZ.katalog[basis.werte[slug].typ]) return false;
    if (!tipp) {
      tipp = document.createElement("div");
      tipp.className = "rw-tipp"; tipp.setAttribute("role", "dialog"); tipp.setAttribute("aria-label", "Rechenweg");
      document.body.appendChild(tipp);
    }
    if (!tipp.hidden && anker === akku) { tippZu(); return true; }
    tipp.dataset.slug = slug; tipp.dataset.signal = signal;
    tippFuellen(slug, signal);
    tipp.hidden = false; anker = akku;
    platzieren();
    return true;
  }
  function platzieren() {
    if (!tipp || tipp.hidden || !anker) return;
    if (window.matchMedia("(max-width: 640px)").matches) { tipp.style.left = ""; tipp.style.top = ""; return; }
    const q = anker.getBoundingClientRect(), br = tipp.offsetWidth, ho = tipp.offsetHeight, rand = 8;
    if (q.bottom < 0 || q.top > window.innerHeight) { tippZu(); return; }
    const x = Math.min(Math.max(q.left + q.width / 2 - br / 2, rand), window.innerWidth - br - rand);
    const y = q.bottom + 10 + ho <= window.innerHeight - rand ? q.bottom + 10 : Math.max(rand, q.top - ho - 10);
    tipp.style.left = x + "px"; tipp.style.top = y + "px";
  }
  function tippZu() { if (tipp) tipp.hidden = true; if (anker && document.contains(anker)) anker.focus({ preventScroll: true }); anker = null; }
  document.addEventListener("click", (e) => {
    const akku = e.target.closest(".akku[data-krit]");
    if (akku && akku.closest("[data-slug], [data-depot-slug]") && !akku.closest(".kriterium")) {
      if (tippZeigen(akku)) { e.preventDefault(); e.stopPropagation(); }
      return;
    }
    if (tipp && !tipp.hidden && !tipp.contains(e.target)) tippZu();
  }, true);
  document.addEventListener("keydown", (e) => {
    const akku = e.target.closest && e.target.closest(".akku[data-krit]");
    if (akku && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault(); e.stopPropagation();
      if (akku.closest(".kriterium")) flaecheUmschalten(akku.closest(".kriterium"), akku.dataset.krit);
      else tippZeigen(akku);
      return;
    }
    if (e.key === "Escape" && tipp && !tipp.hidden) { e.preventDefault(); e.stopImmediatePropagation(); tippZu(); return; }
    if (e.key === "Escape" && fenster && !fenster.hidden) { e.preventDefault(); e.stopImmediatePropagation(); fensterZu(); }
  }, true);
  // Zeigen auf einen Balken: sofort Name, Stand und Begründung des Signals
  let bt = null, btAkku = null;
  function balkenTipp(akku) {
    const w = akku.closest("[data-slug], [data-depot-slug]");
    const slug = w && (w.dataset.slug || w.dataset.depotSlug), r = slug && status(slug), x = r && r.k[akku.dataset.krit];
    if (!x) return;
    if (!bt) { bt = document.createElement("div"); bt.className = "balken-tipp"; bt.setAttribute("role", "tooltip"); document.body.appendChild(bt); }
    const b = basis.werte[slug];
    bt.innerHTML = `<b>${esc(akku.dataset.krit)}</b><em class="${x.e ? "ja" : "nein"}" style="font-style:normal">${x.e ? "erfüllt" : x.e == null ? "Daten fehlen" : "nicht erfüllt"}${x.s != null ? `, Stärke ${nf(0).format(x.s)}` : ""}</em>`
      + `<span>${esc(x.t)}</span><small>${esc(b.name)}. Klicken für den Rechenweg</small>`;
    bt.hidden = false;
    if (btAkku) btAkku.classList.remove("gezeigt");
    btAkku = akku; akku.classList.add("gezeigt");
    const q = akku.getBoundingClientRect(), breite = bt.offsetWidth, rand = 8;
    const x0 = Math.min(Math.max(q.left + q.width / 2, rand + breite / 2), window.innerWidth - rand - breite / 2);
    const oben = q.top - bt.offsetHeight - 10 >= rand;
    bt.style.left = x0 + "px"; bt.style.top = (oben ? q.top : q.bottom + bt.offsetHeight + 20) + "px";
  }
  function balkenTippZu() { if (bt) bt.hidden = true; if (btAkku) btAkku.classList.remove("gezeigt"); btAkku = null; }
  document.addEventListener("pointerover", (e) => {
    if (e.pointerType === "touch") return;
    const akku = e.target.closest && e.target.closest(".akku[data-krit]");
    if (akku && akku.closest("[data-slug], [data-depot-slug]") && !akku.closest(".rw, .rw-tipp")) balkenTipp(akku);
  });
  document.addEventListener("pointerout", (e) => {
    const akku = e.target.closest && e.target.closest(".akku[data-krit]");
    if (akku && !akku.contains(e.relatedTarget)) balkenTippZu();
  });
  document.addEventListener("focusin", (e) => { if (e.target.matches && e.target.matches(".akku[data-krit][role='button']")) balkenTipp(e.target); });
  document.addEventListener("focusout", (e) => { if (e.target.matches && e.target.matches(".akku[data-krit]")) balkenTippZu(); });
  document.addEventListener("click", (e) => { if (e.target.closest && e.target.closest(".akku[data-krit]")) balkenTippZu(); }, true);
  window.addEventListener("scroll", balkenTippZu, true);

  window.addEventListener("scroll", platzieren, true);
  window.addEventListener("resize", platzieren);
  document.addEventListener("click", (e) => {
    const knopf = e.target.closest(".kriterium .rechenweg-knopf, .kriterium .akku[data-krit]");
    if (!knopf) return;
    flaecheUmschalten(knopf.closest(".kriterium"), knopf.dataset.rechenweg || knopf.dataset.krit);
  });

  /* ---------------------------------------------------------------- Screener-Fenster */
  let fenster = null, fensterTyp = null, ausloeser = null;
  function fensterBauen() {
    fenster = document.createElement("div");
    fenster.className = "kf-huelle"; fenster.hidden = true;
    fenster.innerHTML = `<div class="kf-schleier" data-kf-zu></div>
      <aside class="kf" role="dialog" aria-modal="true" aria-labelledby="kf-titel" tabindex="-1">
        <header class="kf-kopf">
          <div><p class="kf-klasse"></p><h2 id="kf-titel">Screener</h2></div>
          <button type="button" class="knopf schliessen-knopf" data-kf-zu><svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>Schließen</button>
        </header>
        <div class="kf-inhalt"></div>
      </aside>`;
    document.body.appendChild(fenster);
  }
  const MODI = [["aus", "Aus"], ["zaehlt", "Zählt"], ["pflicht", "Pflicht"]];
  function modus(typ, name) { const a = auswahl(typ); return a.pflicht.includes(name) ? "pflicht" : a.zaehlt.includes(name) ? "zaehlt" : "aus"; }
  function stufeIndex(stufen, v) { let best = 0; stufen.forEach((s, i) => { if (Math.abs(s - v) < Math.abs(stufen[best] - v)) best = i; }); return best; }

  function fensterInhalt(typ) {
    const a = auswahl(typ), P = params(typ), slugs = Object.keys(basis.werte).filter((s) => basis.werte[s].typ === typ);
    const gruppen = [];
    SPEZ.katalog[typ].forEach((k) => { let g = gruppen.find((x) => x[0] === k.familie); if (!g) gruppen.push((g = [k.familie, []])); g[1].push(k); });
    const kriterium = (k) => {
      const m = modus(typ, k.name);
      const mitDaten = slugs.filter((s) => status(s) && status(s).k[k.name] && status(s).k[k.name].e != null);
      const erfuellt = mitDaten.filter((s) => status(s).k[k.name].e === true).length;
      const regler = [...new Set(k.teile.map((t) => t.p))].map((p) => {
        const r = SPEZ.regler[typ][p] || {}, v = P[p], std = SPEZ.params[typ][p], f = r.fmt || "z2";
        const attr = r.stufen ? `min="0" max="${r.stufen.length - 1}" step="1" value="${stufeIndex(r.stufen, v)}"` : `min="${r.min}" max="${r.max}" step="${r.step}" value="${v}"`;
        const teilName = (k.teile.find((t) => t.p === p) || {}).name || p;
        return `<label class="regel"><span class="regel-text">${esc(teilName)} ${k.teile.find((t) => t.p === p).r === ">=" ? "mindestens" : "höchstens"}</span>
          <input type="range" ${attr} data-param="${esc(p)}"><output class="regel-wert${v !== std ? " geaendert" : ""}">${esc(fmt(v, f))}</output>
          <span class="regel-standard">Standard ${esc(fmt(std, f))}</span></label>`;
      }).join("");
      return `<div class="kf-kriterium modus-${m}" data-kf-name="${esc(k.name)}">
        <div class="kf-zeile">
          <div class="kf-text"><b>${esc(k.name)}</b><span class="kf-def">${esc(flach(text(k.definition, {}, P)) || k.definition)}</span></div>
          <div class="kf-modus" role="radiogroup" aria-label="${esc(k.name)}">${MODI.map(([wert, label]) =>
            `<button type="button" role="radio" aria-checked="${m === wert}" data-modus="${wert}">${label}</button>`).join("")}</div>
        </div>
        <p class="kf-info">${mitDaten.length ? `Erfüllt bei ${erfuellt} von ${mitDaten.length} ${WORT[typ]}${mitDaten.length < slugs.length ? `, für ${slugs.length - mitDaten.length} fehlen Daten` : ""}` : "Keine Daten: Die Quelle war beim letzten Bericht nicht erreichbar"}.
          <span class="kf-quelle">${esc(k.quelle)}</span></p>
        <details class="kf-schwellen"${(eigene[typ] && eigene[typ].params && k.teile.some((t) => t.p in eigene[typ].params)) ? " open" : ""}><summary>Schwelle</summary>${regler}</details>
      </div>`;
    };
    return `<p class="kf-einleitung">Wähle, welche Signale zählen. <b>Zählt</b> heißt: Das Signal bringt einen Punkt, wenn es erfüllt ist.
        <b>Pflicht</b> heißt: Ohne dieses Signal ist ein Wert nie ein Treffer, egal wie viele andere erfüllt sind. Die Auswahl gilt für
        Tabelle, Analyse, Lage, Filter und Portfolio in diesem Browser.</p>
      <div class="kf-treffer">
        <div class="kf-treffer-zeile"><span>Treffer ab</span>
          <div class="kf-zaehler"><button type="button" data-treffer-schritt="-1" aria-label="Weniger">−</button><output id="kf-treffer-ab">${a.treffer_ab}</output><button type="button" data-treffer-schritt="1" aria-label="Mehr">+</button></div>
          <span>von <b id="kf-anzahl">${a.n}</b> aktiven Signalen</span></div>
        <p class="kf-wirkung" aria-live="polite"></p>
      </div>
      ${gruppen.map(([fam, liste]) => `<section class="kf-gruppe"><h3>${esc(fam)}</h3>${liste.map(kriterium).join("")}</section>`).join("")}
      <div class="kf-fuss">
        <button type="button" class="knopf" data-kf-zurueck>Auf Standard zurücksetzen</button>
        <button type="button" class="knopf" data-kf-yaml>Für config.yaml kopieren</button>
        <p class="klein">Wochenbericht, E-Mail, Signal-Protokoll und Prüfstand rechnen mit config.yaml. Mit „Für config.yaml kopieren“
        übernimmst du Auswahl und Schwellen dorthin.</p>
      </div>`;
  }
  function wirkung() {
    if (!fenster || fenster.hidden) return;
    const typ = fensterTyp, slugs = Object.keys(basis.werte).filter((s) => basis.werte[s].typ === typ);
    const jetzt = slugs.filter((s) => status(s) && status(s).treffer).length;
    const std = slugs.filter((s) => { const r = bewerte(s, null, SPEZ.params[typ], { ...SPEZ.auswahl[typ], n: SPEZ.auswahl[typ].zaehlt.length + SPEZ.auswahl[typ].pflicht.length }); return r && r.treffer; }).length;
    const a = auswahl(typ);
    $("#kf-treffer-ab", fenster).textContent = a.treffer_ab;
    $("#kf-anzahl", fenster).textContent = a.n;
    $(".kf-wirkung", fenster).textContent = `${jetzt} von ${slugs.length} ${WORT[typ]} sind damit Treffer${istEigen(typ) ? `, mit der Standardauswahl ${std}` : ""}.`;
    $$(".kf-kriterium", fenster).forEach((el) => {
      const m = modus(typ, el.dataset.kfName);
      el.className = `kf-kriterium modus-${m}`;
      $$("[data-modus]", el).forEach((b) => b.setAttribute("aria-checked", String(b.dataset.modus === m)));
    });
  }
  const fensterMelden = window.WBH.fenster("kriterien", () => fensterZu(true));
  function fensterOeffnen(typ, fokus) {
    if (!SPEZ.katalog[typ]) return;
    if (!fenster) fensterBauen();
    if (fenster.hidden) fensterMelden(true);
    fensterTyp = typ; ausloeser = document.activeElement;
    $(".kf-klasse", fenster).textContent = TITEL[typ];
    $(".kf-inhalt", fenster).innerHTML = fensterInhalt(typ);
    fenster.hidden = false;
    document.body.classList.add("fenster-offen");
    wirkung();
    const ziel = fokus && $(`[data-kf-name="${CSS.escape(fokus)}"]`, fenster);
    if (ziel) { $("details", ziel).open = true; ziel.scrollIntoView({ block: "center" }); ziel.classList.add("hervor"); setTimeout(() => ziel.classList.remove("hervor"), 1600); }
    else $(".kf-inhalt", fenster).scrollTop = 0;
    $(".kf", fenster).focus({ preventScroll: true });
  }
  function fensterZu(leise) {
    if (!fenster || fenster.hidden) return;
    fenster.hidden = true;
    document.body.classList.remove("fenster-offen");
    if (!leise && ausloeser && document.contains(ausloeser)) ausloeser.focus({ preventScroll: true });
    fensterMelden(false);
  }
  function aendern(typ, fn) {
    const a = auswahl(typ);
    const e = eigene[typ] = Object.assign({}, eigene[typ] || {});
    e.zaehlt = a.zaehlt.slice(); e.pflicht = a.pflicht.slice();
    fn(e, a);
    const std = SPEZ.auswahl[typ];
    if (gleich(e.zaehlt, std.zaehlt) && gleich(e.pflicht, std.pflicht)) { delete e.zaehlt; delete e.pflicht; }
    speichern();
    alleAnwenden();
  }
  document.addEventListener("click", (e) => {
    const oeffnen = e.target.closest("[data-kriterien-oeffnen]");
    if (oeffnen) {
      e.preventDefault(); tippZu();
      fensterOeffnen(oeffnen.dataset.kriterienOeffnen, oeffnen.dataset.kriteriumFokus);
      return;
    }
    if (!fenster || fenster.hidden || !fenster.contains(e.target)) return;
    if (e.target.closest("[data-kf-zu]")) { fensterZu(); return; }
    const typ = fensterTyp;
    const m = e.target.closest("[data-modus]");
    if (m) {
      const name = m.closest("[data-kf-name]").dataset.kfName, ziel = m.dataset.modus;
      aendern(typ, (x) => {
        x.zaehlt = x.zaehlt.filter((n) => n !== name); x.pflicht = x.pflicht.filter((n) => n !== name);
        const reihe = SPEZ.katalog[typ].map((k) => k.name);
        const sortiert = (l) => l.sort((p, q) => reihe.indexOf(p) - reihe.indexOf(q));
        if (ziel === "zaehlt") x.zaehlt = sortiert(x.zaehlt.concat(name));
        if (ziel === "pflicht") x.pflicht = sortiert(x.pflicht.concat(name));
        if (x.treffer_ab != null) x.treffer_ab = Math.min(x.treffer_ab, x.zaehlt.length + x.pflicht.length);
      });
      return;
    }
    const schritt = e.target.closest("[data-treffer-schritt]");
    if (schritt) {
      const a = auswahl(typ);
      const neu = Math.max(1, Math.min(a.n, a.treffer_ab + +schritt.dataset.trefferSchritt));
      eigene[typ] = Object.assign({}, eigene[typ] || {}, { treffer_ab: neu });
      speichern(); alleAnwenden();
      return;
    }
    if (e.target.closest("[data-kf-zurueck]")) {
      delete eigene[typ]; speichern();
      $(".kf-inhalt", fenster).innerHTML = fensterInhalt(typ);
      alleAnwenden();
      return;
    }
    const yaml = e.target.closest("[data-kf-yaml]");
    if (yaml) {
      const a = auswahl(typ), P = params(typ);
      const liste = (l) => "[" + l.map((n) => JSON.stringify(n)).join(", ") + "]";
      const txt = `${SPEZ.abschnitt[typ]}:\n` + Object.keys(SPEZ.params[typ]).map((k) => `  ${k}: ${P[k]}`).join("\n")
        + `\n\n# unter „auswahl:“ eintragen\n  ${typ}: { zaehlt: ${liste(a.zaehlt)}, pflicht: ${liste(a.pflicht)}, treffer_ab: ${a.treffer_ab} }\n`;
      const fertig = (t) => { yaml.textContent = t; setTimeout(() => (yaml.textContent = "Für config.yaml kopieren"), 2500); };
      if (navigator.clipboard) navigator.clipboard.writeText(txt).then(() => fertig("Kopiert"), () => fertig("Kopieren nicht möglich"));
      else fertig("Kopieren nicht möglich");
    }
  });
  let rechnenGeplant = false;
  document.addEventListener("input", (e) => {
    const regler = e.target.closest("input[data-param]");
    if (!regler || !fenster || !fenster.contains(regler)) return;
    const typ = fensterTyp, p = regler.dataset.param, r = SPEZ.regler[typ][p] || {};
    const v = r.stufen ? r.stufen[+regler.value] : Math.round(+regler.value * 1e6) / 1e6;
    const e2 = eigene[typ] = Object.assign({}, eigene[typ] || {});
    e2.params = Object.assign({}, e2.params || {}, { [p]: v });
    if (v === SPEZ.params[typ][p]) delete e2.params[p];
    if (!Object.keys(e2.params).length) delete e2.params;
    speichern();
    const out = regler.nextElementSibling;
    out.textContent = fmt(v, r.fmt || "z2");
    out.classList.toggle("geaendert", v !== SPEZ.params[typ][p]);
    const kr = regler.closest("[data-kf-name]");
    const k = SPEZ.katalog[typ].find((x) => x.name === kr.dataset.kfName);
    $(".kf-def", kr).textContent = flach(text(k.definition, {}, params(typ))) || k.definition;
    if (!rechnenGeplant) { rechnenGeplant = true; requestAnimationFrame(() => { rechnenGeplant = false; alleAnwenden(); }); }
  });

  // Regel-Prüfstand: Zeitraum nach dem Signal umschalten (3, 6 oder 12 Monate)
  document.addEventListener("click", (e) => {
    const k = e.target.closest("[data-ps-h]");
    if (!k) return;
    const box = k.closest("[data-pruefstand]");
    $$("[data-ps-h]", box).forEach((x) => x.setAttribute("aria-pressed", String(x === k)));
    $$("[data-ps-tabelle]", box).forEach((x) => (x.hidden = x.dataset.psTabelle !== k.dataset.psH));
  });

  // Sternchen-Definitionen mit eigenen Schwellen
  function defHinweis(el) {
    const w = el.closest("[data-kachel-inhalt], [data-slug]");
    const typ = w && (w.dataset.kachelInhalt || (basis.werte[w.dataset.slug] || {}).typ);
    return typ && SPEZ.katalog[typ] && schwellenEigen(typ) ? " Mit deinen eigenen Schwellen gelten andere Werte, siehe Rechenweg." : "";
  }

  document.addEventListener("DOMContentLoaded", () => {
    $$("[data-slug] .akku[data-krit]").forEach((m) => {
      const b = basis.werte[m.closest("[data-slug]").dataset.slug];
      if (!b || !SPEZ.katalog[b.typ]) return;
      m.tabIndex = 0; m.setAttribute("role", "button");
    });
    if (KLASSEN.some(istEigen)) alleAnwenden();
    else { KLASSEN.forEach(spaltenAnwenden); lage(); }
  });

  window.WBRegeln = {
    anwendenFuer(slug, p) { const r = bewerte(slug, p); if (r) { setze(slug, r); lageSpaeter(); } },
    bewerte, status, punkte, istEigen, rechenwegHTML, defHinweis, ergebnisse, alleAnwenden, auswahl, params, fmt, text,
  };
})();
