/* Fathom: Szenario-Rechner – Downside, Basis und Upside für die nächsten vier Quartale auf demselben Treiberbaum.
 *
 * Die Standardannahmen kommen aus src/szenarien.py (Feld sz je Wert in live-basis). Hier wird mit denselben Formeln
 * nachgerechnet, sobald du eine Annahme änderst, und daraus entstehen Quartalspfad, Memo und Protokolltexte.
 *
 *   Gewinnmodell (Aktien):  Kurs in 4 Q = Kurs heute × (1 + g) × (1 + v),  Rendite = (1 + g)(1 + v) − 1 + Dividende
 *   Kursmodell (übrige):    Kurs in 4 Q = Kurs heute × (1 + k),             Rendite = k + Ertrag (Carry, Roll-Rendite)
 *
 * Eigene Annahmen: { g: { u: 0.2 }, div: { b: 0.01 } } – Anteile, nicht Prozent; fehlende Werte = Standard.
 * Keine Prognose und keine Empfehlung: jede Zahl folgt aus den genannten Annahmen.
 * Läuft auch unter Node (für Tests): module.exports.
 */
(function (wurzel, fabrik) {
  const kern = fabrik();
  if (typeof module === "object" && module.exports) module.exports = kern;
  else wurzel.WBSzenarioKern = kern;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const SZ = ["d", "b", "u"];
  const SZ_NAME = { d: "Downside", b: "Basis", u: "Upside" };
  const TREIBER = {
    g: { name: "Gewinnwachstum", grenze: [-0.6, 1.5] },
    v: { name: "Bewertung (KGV)", grenze: [-0.6, 1.0] },
    div: { name: "Dividende", grenze: [0, 0.15], einer: true },
    k: { name: "Kursveränderung", grenze: [-0.8, 2.0] },
    e: { name: "Ertrag", grenze: [-0.2, 0.3], einer: true },
  };
  // Kurzformen der Unsicherheiten für Vergleichstabelle und Chips
  const FLAG_KURZ = {
    spanne: "Schätzungen streuen", pauschal_g: "Spanne pauschal", analysten: "wenige Analysten", wachstum: "Wachstum extrem",
    kein_konsens: "kein Konsens", kgv_kurz: "kurze KGV-Historie", verlust: "Verlust", ohne_gewinn: "ohne Gewinnbasis",
    zahlen: "Zahlen bald", vol: "Schwankung erhöht", luecke: "Quartale lückenhaft", ist_alt: "Ist-Zahlen alt",
    waehrung: "Währung umgerechnet", konsens_q: "Abweichung vom Konsens", cagr: "Basis aus Vergangenheit",
    eigen: "eigene Annahmen", demo: "Demo-Daten", fx_fehlt: "Wechselkurs fehlt",
  };
  const REIHENFOLGE = ["g", "v", "div", "k", "e"];
  // Treiber in fester Reihenfolge (die JSON-Daten kommen alphabetisch sortiert an)
  const treiberListe = (sz) => REIHENFOLGE.filter((t) => sz.t[t]).concat(Object.keys(sz.t).filter((t) => !REIHENFOLGE.includes(t)));
  const MONAT = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];

  /* ---------------------------------------------------------------- Format (deutsch, ohne DOM) */
  const formate = {};
  const nf = (d) => formate[d] || (formate[d] = new Intl.NumberFormat("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d }));
  const minus = (s) => s.replace(/-/g, "−");
  const zahl = (x, d = 2) => (x == null || !isFinite(x) ? "–" : minus(nf(d).format(x)));
  const pct = (x, d = 1, vz = true) => {
    if (x == null || !isFinite(x)) return "–";
    const r = Math.abs(x * 100) < 0.5 * Math.pow(10, -d) ? 0 : x;   // keine „−0,0 %“
    return minus((vz && r > 0 ? "+" : "") + nf(d).format(r * 100) + " %");
  };
  // Prozentpunkte ohne Vorzeichen, für „um 12 %“ in Sätzen
  const pp = (x, d = 1) => pct(Math.abs(x), d, false);
  const datum = (iso) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : "–");
  const monat = (iso) => (iso ? `${MONAT[+iso.slice(5, 7) - 1]} ${iso.slice(0, 4)}` : "–");
  const klemme = (x, g) => Math.min(Math.max(x, g[0]), g[1]);

  /* ---------------------------------------------------------------- Rechnen */
  // Annahmen je Szenario; eigene Werte haben Vorrang (ungültige werden ignoriert, Grenzen wie in Python)
  function werte(sz, eigene) {
    const aus = {};
    Object.entries(sz.t).forEach(([name, t]) => {
      const e = (eigene && eigene[name]) || {}, g = (TREIBER[name] || {}).grenze || [-1, 3];
      const nimm = (s, std) => (typeof e[s] === "number" && isFinite(e[s]) ? klemme(e[s], g) : std);
      if (t.d != null) aus[name] = { d: nimm("d", t.d), b: nimm("b", t.b), u: nimm("u", t.u) };
      else { const b = nimm("b", t.b); aus[name] = { d: b, b, u: b }; }
    });
    return aus;
  }

  // Welche Annahmen weichen vom Standard ab? [{ t, s, std, wert }]
  function geaendert(sz, eigene) {
    const w = werte(sz, eigene), aus = [];
    treiberListe(sz).forEach((name) => {
      const t = sz.t[name];
      (t.d != null ? SZ : ["b"]).forEach((s) => {
        const std = t.d != null ? t[s] : t.b;
        if (Math.abs(w[name][s] - std) > 5e-7) aus.push({ t: name, s, std, wert: w[name][s] });
      });
    });
    return aus;
  }

  // Ergebnis je Szenario, Pfad über vier Quartale, Zerlegung der Spanne und Break-even
  function rechne(sz, eigene, kurs) {
    const w = werte(sz, eigene), p0 = kurs || sz.kurs, gewinn = sz.m === "gewinn";
    const erg = { modell: sz.m, kurs: p0, w, szenarien: {}, pfad: {}, quartale: [] };
    SZ.forEach((s) => {
      const faktor = gewinn ? (1 + w.g[s]) * (1 + w.v[s]) : 1 + w.k[s];
      const ertrag = gewinn ? w.div[s] : (w.e ? w.e[s] : 0);
      erg.szenarien[s] = { faktor, kurs: p0 * faktor, rendite: faktor - 1 + ertrag, ertrag,
        eps: gewinn ? sz.anker.eps * (1 + w.g[s]) : null, kgv: gewinn && sz.anker.kgv ? sz.anker.kgv * (1 + w.v[s]) * (kurs ? kurs / sz.kurs : 1) : null };
      // Pfad: heute und nach jedem der vier Quartale
      const pfad = [p0];
      for (let k = 1; k <= 4; k++) {
        if (gewinn) {
          const q = sz.quartale.map((x) => x.eps);
          const ttm = q.slice(k).reduce((a, x) => a + x, 0) + q.slice(0, k).reduce((a, x) => a + x * (1 + w.g[s]), 0);
          pfad.push(p0 * (ttm / sz.anker.eps) * Math.pow(1 + w.v[s], k / 4));
        } else pfad.push(p0 * Math.pow(faktor, k / 4));
      }
      erg.pfad[s] = pfad;
    });
    if (gewinn) {
      // Prognosequartale: gleiches Quartal des Vorjahres × (1 + g)
      erg.quartale = sz.quartale.map((q, i) => ({ bis: sz.prognose[i], vorjahr: q.eps, vorjahrBis: q.bis,
        d: q.eps * (1 + w.g.d), b: q.eps * (1 + w.g.b), u: q.eps * (1 + w.g.u) }));
      const lg = Math.log((1 + w.g.u) / (1 + w.g.d)), lv = Math.log((1 + w.v.u) / (1 + w.v.d));
      erg.zerlegung = lg + lv > 1e-9 && lg >= 0 && lv >= 0 ? { gewinn: lg / (lg + lv), bewertung: lv / (lg + lv) } : null;
      // Break-even: nötiges Gewinnwachstum, damit die Rendite bei der Downside-Bewertung nicht negativ wird
      erg.breakeven = (1 - w.div.b) / (1 + w.v.d) - 1;
    } else {
      erg.quartale = sz.prognose.map((bis, i) => ({ bis, monate: 3 * (i + 1), d: erg.pfad.d[i + 1], b: erg.pfad.b[i + 1], u: erg.pfad.u[i + 1] }));
      erg.zerlegung = { schwankung: 1 };
      erg.breakeven = w.e ? -w.e.b : null;   // Kursveränderung, die der Ertrag gerade ausgleicht
    }
    const d = erg.szenarien.d.rendite, u = erg.szenarien.u.rendite;
    erg.chanceRisiko = d < -1e-9 ? u / -d : null;
    erg.spanne = u - d;
    return erg;
  }

  /* ---------------------------------------------------------------- Unsicherheiten */
  // Hinweise aus Python plus die, die erst im Browser entstehen (eigene Annahmen, Demo)
  function flags(sz, eigene, opt = {}) {
    const f = (sz.f || []).slice();
    const g = geaendert(sz, eigene);
    if (g.length) f.unshift({ k: "eigen", g: 1, t: `${g.length === 1 ? "Eine Annahme stammt" : `${g.length} Annahmen stammen`} von dir: ${g.map((x) => `${TREIBER[x.t].name}${TREIBER[x.t].einer || sz.t[x.t].d == null ? "" : " " + SZ_NAME[x.s]} ${pct(x.wert, 2)} statt ${pct(x.std, 2)}`).join(", ")}.` });
    if (opt.demo) f.unshift({ k: "demo", g: 3, t: "Demo-Daten: Kurse, Gewinne und Schätzungen sind erfunden." });
    return f;
  }

  /* ---------------------------------------------------------------- Memo */
  function treiberName(sz, t) { return t === "e" && sz.t.e ? sz.t.e.n : TREIBER[t].name; }

  // Ein-Seiten-Memo in einfachem Deutsch: { titel, unter, absaetze: [{ titel, text }] }
  function memo(sz, erg, opt = {}) {
    const name = opt.name || "Der Wert", w = erg.w, S = erg.szenarien, wae = sz.waehrung || "";
    const eigene = new Set(geaendert(sz, opt.eigene).map((x) => x.t + x.s));
    const dein = (t, s) => (eigene.has(t + s) || (eigene.has(t + "b") && (sz.t[t] || {}).d == null) ? " (deine Annahme)" : "");
    const bis = sz.prognose[3];
    const fl = flags(sz, opt.eigene, opt).filter((x) => x.k !== "eigen" && x.k !== "demo").sort((a, b) => b.g - a.g);
    const abs = [];
    const kursTxt = (x) => `${zahl(x, sz.dez || 2)} ${wae}`.trim();
    if (sz.m === "gewinn") {
      const a = sz.anker, kgvHeute = a.kgv ? a.kgv * (erg.kurs / sz.kurs) : null;
      abs.push({ titel: "Ausgangspunkt", text: `Die Rechnung setzt auf den zuletzt berichteten Zahlen bis ${datum(a.bis)} auf. In den vier Quartalen davor hat ${name} ${kursTxt(a.eps)} je Aktie verdient${kgvHeute ? `; beim Kurs von ${kursTxt(erg.kurs)} entspricht das einem KGV von ${zahl(kgvHeute, 1)}` : ""}.${a.umgerechnet ? ` Der Gewinn wird in ${a.fin} berichtet und ist zum aktuellen Wechselkurs umgerechnet.` : ""}` });
      const gTxt = (s) => (w.g[s] >= 0 ? `wächst um ${pp(w.g[s])}` : `schrumpft um ${pp(w.g[s])}`);
      const vTxt = (s) => (Math.abs(w.v[s]) < 5e-4 ? "das KGV bleibt gleich" : `das KGV ${w.v[s] > 0 ? "steigt" : "sinkt"} um ${pp(w.v[s])}`);
      const div = w.div.b > 0 ? ` und ${pp(w.div.b)} Dividende` : "";
      abs.push({ titel: "Drei Szenarien", text:
        `Basis: Der Gewinn ${!dein("g", "b") && /^Konsens/.test(sz.t.g.q) ? gTxt("b").replace(" um ", " wie vom Konsens erwartet um ") : gTxt("b")}${dein("g", "b")}, ${vTxt("b")}${dein("v", "b")}. Mit der Kursänderung${div}${dein("div", "b")} ergibt das ${pct(S.b.rendite, 0)} bis ${monat(bis)}, rechnerisch ein Kurs von ${kursTxt(S.b.kurs)}. ` +
        `Upside: Der Gewinn ${gTxt("u")}${dein("g", "u")}, ${vTxt("u")}${dein("v", "u")}: ${pct(S.u.rendite, 0)}. ` +
        `Downside: Der Gewinn ${gTxt("d")}${dein("g", "d")}, ${vTxt("d")}${dein("v", "d")}: ${pct(S.d.rendite, 0)}.` });
      let unterschied = `Zwischen Downside und Upside liegen ${zahl(erg.spanne * 100, 0)} Prozentpunkte.`;
      if (erg.zerlegung) {
        const b = erg.zerlegung.bewertung;
        unterschied += ` Etwa ${pct(b, 0, false)} davon gehen auf die Bewertung zurück, ${pct(1 - b, 0, false)} auf den Gewinn. ` +
          (b >= 0.6 ? `Entscheidend ist also weniger, was ${name} verdient, als was der Markt dafür zu zahlen bereit ist.`
            : b <= 0.4 ? `Entscheidend ist also vor allem, wie sich der Gewinn entwickelt.`
            : `Gewinn und Bewertung wiegen etwa gleich schwer.`);
      }
      abs.push({ titel: "Was den Unterschied macht", text: unterschied });
      let be = w.v.d < 0
        ? `Fällt das KGV wie im Downside um ${pp(w.v.d)}, müsste der Gewinn um mindestens ${pct(erg.breakeven, 1, false)} wachsen, damit unter dem Strich kein Verlust bleibt. Der Konsens liegt bei ${pct(sz.t.g.b, 1)}.`
        : `Im Downside sinkt das KGV nicht; ein Verlust entsteht dann nur, wenn der Gewinn schrumpft.`;
      if (sz.bew && sz.bew.kgv && sz.bew.median) {
        const r = sz.bew.median / sz.bew.kgv - 1;
        if (Math.abs(r) >= 0.1) be += ` Nicht eingerechnet ist eine Rückkehr des Forward-KGV zum eigenen 5-Jahres-Median (${zahl(sz.bew.median, 1)} statt ${zahl(sz.bew.kgv, 1)}): Das allein wären ${pct(r, 0)}.`;
      }
      abs.push({ titel: "Break-even", text: be });
    } else {
      const kTxt = sz.t.k.q.split(" Upside und Downside")[0].replace(/^Basis: /, "");
      const e = sz.t.e;
      abs.push({ titel: "Ausgangspunkt", text: `Ausgangspunkt ist der Schlusskurs vom ${datum(sz.stand)}: ${kursTxt(sz.kurs)}. Eine Gewinnbasis wie bei Aktien gibt es hier nicht, die Szenarien rechnen deshalb mit der Kursschwankung.` });
      abs.push({ titel: "Drei Szenarien", text:
        `Basis: ${dein("k", "b") ? `Du setzt eine Kursveränderung von ${pct(w.k.b, 1)} an.` : kTxt} Das ergibt ${pct(S.b.rendite, 1)} bis ${monat(bis)}${e ? `, ${e.n} von ${pct(w.e.b, 1)} eingerechnet${dein("e", "b")}` : ""}. ` +
        `Upside und Downside liegen eine Jahresschwankung (Volatilität ${pct(sz.sigma, 0, false)}) darüber und darunter: ${pct(S.u.rendite, 0)} und ${pct(S.d.rendite, 0)}${dein("k", "u") || dein("k", "d") ? " (mit deinen Annahmen)" : ""}. Bei normal verteilten Renditen liegen etwa zwei von drei Jahren in dieser Spanne.` });
      abs.push({ titel: "Was den Unterschied macht", text: `Die Spanne von ${zahl(erg.spanne * 100, 0)} Prozentpunkten kommt allein aus der Schwankung des Kurses.${e ? ` Der ${e.n} ist in allen Szenarien gleich und verschiebt nur die Lage.` : ""}` });
      if (e && Math.abs(w.e.b) >= 5e-4) abs.push({ titel: "Break-even", text: w.e.b > 0
        ? `Der ${e.n} von ${pct(w.e.b, 1)} gleicht einen Kursrückgang von bis zu ${pp(w.e.b)} aus.`
        : `Der ${e.n} von ${pct(w.e.b, 1)} kostet Rendite: Der Kurs muss um ${pp(w.e.b)} steigen, damit eine Long-Position nichts verliert.` });
    }
    if (fl.length) abs.push({ titel: "Am wenigsten belastbar", text: fl[0].t + (fl.length > 1 ? ` Außerdem: ${fl.slice(1, 3).map((x) => x.t.replace(/(: |\. ).*$/, "").replace(/\.$/, "")).join("; ")}.` : "") });
    abs.push({ titel: "Nächster Schritt", text: `${sz.termin ? `Mit den Quartalszahlen am ${datum(sz.termin)} kommen neue Ist-Zahlen. ` : ""}Der Wochenbericht setzt die Szenarien jeden Montag automatisch auf die letzten Ist-Zahlen und Kurse auf; was sich an den Annahmen ändert, steht im Protokoll.` });
    return {
      titel: `Szenario-Memo: ${name}, vier Quartale bis ${monat(bis)}`,
      unter: `Stand ${datum(sz.stand)}. Rechnung mit Annahmen, keine Prognose und keine Empfehlung.${opt.demo ? " Demo-Daten." : ""}`,
      absaetze: abs,
    };
  }

  function memoText(m) {
    return [m.titel, m.unter, ...m.absaetze.map((a) => `${a.titel}\n${a.text}`)].join("\n\n");
  }

  /* ---------------------------------------------------------------- Protokoll */
  // Fingerabdruck der Standardannahmen, um Wochenwechsel zu erkennen
  function signatur(sz) {
    const t = {};
    treiberListe(sz).forEach((n) => { const x = sz.t[n]; t[n] = x.d != null ? [x.d, x.b, x.u] : [x.b]; });
    return { stand: sz.stand, bis: sz.anker ? sz.anker.bis : null, eps: sz.anker ? sz.anker.eps : null, m: sz.m, t };
  }

  // Was hat sich gegenüber dem letzten Stand an den Standardannahmen geändert? Liste von Sätzen
  function unterschiede(alt, neu, wae) {
    if (!alt) return [];
    const aus = [];
    if (alt.m !== neu.m) aus.push(neu.m === "gewinn" ? "Jetzt mit Gewinnmodell gerechnet (Gewinn und Bewertung)." : "Jetzt nur mit der Kursschwankung gerechnet.");
    if (neu.bis && alt.bis !== neu.bis) aus.push(`Neu auf die Ist-Zahlen bis ${datum(neu.bis)} gesetzt: Gewinn der letzten vier Quartale ${zahl(alt.eps)} → ${zahl(neu.eps)} ${wae || ""}`.trim() + ".");
    const teile = [];
    REIHENFOLGE.filter((n) => neu.t[n]).map((n) => [n, neu.t[n]]).forEach(([n, v]) => {
      const a = alt.t && alt.t[n];
      if (!a || a.length !== v.length) return;
      v.forEach((x, i) => {
        if (Math.abs(x - a[i]) >= 5e-4) teile.push(`${TREIBER[n] ? TREIBER[n].name : n}${v.length === 3 ? " " + SZ_NAME[SZ[i]] : ""} ${pct(a[i], 2)} → ${pct(x, 2)}`);
      });
    });
    if (teile.length) aus.push(`Standardannahmen neu: ${teile.join(", ")}.`);
    return aus;
  }

  return { SZ, SZ_NAME, TREIBER, FLAG_KURZ, treiberListe, werte, geaendert, rechne, flags, memo, memoText, signatur, unterschiede, treiberName,
           format: { zahl, pct, datum, monat } };
});
