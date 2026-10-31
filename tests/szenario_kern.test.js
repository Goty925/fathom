/* Tests für assets/szenario-kern.js: Treiberbaum, eigene Annahmen, Quartalspfad, Memo und Protokoll. */
const test = require("node:test");
const assert = require("node:assert/strict");
const K = require("../assets/szenario-kern.js");

const nah = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);

// Aktie mit vier Ist-Quartalen (Summe 4,0), Kurs 100 → KGV 25
const AKTIE = {
  m: "gewinn", kurs: 100, waehrung: "EUR", dez: 2, stand: "2026-10-27", termin: "2026-11-05",
  anker: { bis: "2026-09-30", eps: 4.0, kgv: 25, fin: "EUR", umgerechnet: false, q: "berichteter Gewinn je Aktie" },
  quartale: [{ bis: "2025-12-31", eps: 0.9 }, { bis: "2026-03-31", eps: 1.0 }, { bis: "2026-06-30", eps: 1.0 }, { bis: "2026-09-30", eps: 1.1 }],
  prognose: ["2026-12-31", "2027-03-31", "2027-06-30", "2027-09-30"],
  konsens_q: { eps: 1.0, n: 12 },
  t: {
    div: { b: 0.02, q: "Dividende 2 %" },
    g: { d: 0.0, b: 0.1, u: 0.2, q: "Konsens für das nächste Geschäftsjahr: +10 %" },
    v: { d: -0.2, b: 0.0, u: 0.25, q: "Basis: das KGV bleibt" },
  },
  bew: { kgv: 20, median: 25 },
  f: [{ k: "zahlen", g: 2, t: "Quartalszahlen am 05.11.2026: danach neu." }, { k: "waehrung", g: 1, t: "Gewinne in CNY: umgerechnet." }],
};
const FOREX = {
  m: "kurs", kurs: 1.1, waehrung: "USD", dez: 4, stand: "2026-10-27", termin: null, sigma: 0.08,
  prognose: ["2027-01-26", "2027-04-28", "2027-07-28", "2027-10-27"],
  t: { e: { b: -0.02, n: "Carry", q: "Zinsvorsprung" }, k: { d: -0.0769, b: 0, u: 0.0833, q: "Basis: Wechselkurse folgen keinem Trend. Upside und Downside: eine Jahresschwankung." } },
  f: [],
};

test("Gewinnmodell: Rendite = (1 + g)(1 + v) − 1 + Dividende, Pfad endet beim Kursziel", () => {
  const e = K.rechne(AKTIE);
  nah(e.szenarien.b.rendite, 1.1 * 1.0 - 1 + 0.02);
  nah(e.szenarien.u.rendite, 1.2 * 1.25 - 1 + 0.02);
  nah(e.szenarien.d.rendite, 1.0 * 0.8 - 1 + 0.02);
  nah(e.szenarien.u.kurs, 150);
  nah(e.szenarien.b.eps, 4.4);
  nah(e.szenarien.d.kgv, 20);
  K.SZ.forEach((s) => { nah(e.pfad[s][0], 100); nah(e.pfad[s][4], e.szenarien[s].kurs, 1e-9); });
  // Prognosequartale: Vorjahresquartal × (1 + g), Saison bleibt
  assert.deepEqual(e.quartale.map((q) => +q.b.toFixed(4)), [0.99, 1.1, 1.1, 1.21]);
  assert.equal(e.quartale[0].bis, "2026-12-31");
  // Zerlegung der Spanne und Break-even
  nah(e.zerlegung.gewinn + e.zerlegung.bewertung, 1);
  assert.ok(e.zerlegung.bewertung > 0.5);
  nah(e.breakeven, (1 - 0.02) / 0.8 - 1);
  nah(e.chanceRisiko, e.szenarien.u.rendite / -e.szenarien.d.rendite);
});

test("Live-Kurs: Renditen gleich, Kurse und KGV skalieren mit", () => {
  const a = K.rechne(AKTIE), b = K.rechne(AKTIE, null, 110);
  K.SZ.forEach((s) => { nah(a.szenarien[s].rendite, b.szenarien[s].rendite); nah(b.szenarien[s].kurs, a.szenarien[s].kurs * 1.1, 1e-9); });
  nah(b.szenarien.b.kgv, 27.5);
});

test("Eigene Annahmen haben Vorrang, Grenzen greifen, Ungültiges wird ignoriert", () => {
  const eigene = { g: { u: 0.5, d: "x" }, v: { d: -5 }, div: { b: 0.03 } };
  const w = K.werte(AKTIE, eigene);
  assert.equal(w.g.u, 0.5);
  assert.equal(w.g.d, 0.0);         // "x" ignoriert
  assert.equal(w.v.d, -0.6);        // Grenze
  assert.deepEqual(w.div, { d: 0.03, b: 0.03, u: 0.03 });
  const g = K.geaendert(AKTIE, eigene).map((x) => x.t + x.s);
  assert.deepEqual(g, ["gu", "vd", "divb"]);
  assert.equal(K.geaendert(AKTIE, { g: { b: 0.1 } }).length, 0);   // gleich dem Standard: keine Änderung
});

test("Kursmodell: Ertrag zählt in allen Szenarien, Pfad gleichmäßig, Break-even = −Ertrag", () => {
  const e = K.rechne(FOREX);
  nah(e.szenarien.b.rendite, -0.02);
  nah(e.szenarien.u.rendite, 0.0833 - 0.02);
  nah(e.pfad.u[2], 1.1 * Math.pow(1.0833, 0.5));
  nah(e.breakeven, 0.02);
  assert.deepEqual(e.zerlegung, { schwankung: 1 });
  assert.equal(e.quartale[3].monate, 12);
});

test("Memo: einfache Sätze, eigene Annahme markiert, keine Lücken", () => {
  const eigene = { g: { u: 0.3 } };
  const m = K.memo(AKTIE, K.rechne(AKTIE, eigene), { name: "Testfirma", eigene, demo: true });
  const t = K.memoText(m);
  assert.match(m.titel, /Szenario-Memo: Testfirma, vier Quartale bis Sep 2027/);
  assert.match(t, /Ist-Zahlen|berichteten Zahlen bis 30\.09\.2026/);
  assert.match(t, /wie vom Konsens erwartet um 10,0 %/);
  assert.match(t, /\(deine Annahme\)/);
  assert.match(t, /Break-even/);
  assert.match(t, /5-Jahres-Median \(25,0 statt 20,0\)/);
  assert.match(t, /Am wenigsten belastbar\nQuartalszahlen am 05\.11\.2026: danach neu\. Außerdem: Gewinne in CNY\./);
  assert.match(t, /keine Empfehlung/);
  assert.doesNotMatch(t, /undefined|NaN|null/);
  const f = K.memoText(K.memo(FOREX, K.rechne(FOREX), { name: "EUR/USD" }));
  assert.match(f, /Carry von −2,0 % kostet Rendite/);
  assert.doesNotMatch(f, /undefined|NaN|null/);
});

test("Unsicherheiten: eigene Annahmen und Demo kommen dazu", () => {
  const f = K.flags(AKTIE, { v: { u: 0.4 } }, { demo: true });
  assert.deepEqual(f.map((x) => x.k), ["demo", "eigen", "zahlen", "waehrung"]);
  assert.match(f[1].t, /Bewertung \(KGV\) Upside \+40,00 % statt \+25,00 %/);
});

test("Protokoll: Wochenwechsel mit neuen Ist-Zahlen und geänderten Annahmen", () => {
  const alt = K.signatur(AKTIE);
  const neu = K.signatur(Object.assign({}, AKTIE, { anker: Object.assign({}, AKTIE.anker, { bis: "2026-12-31", eps: 4.2 }),
    t: Object.assign({}, AKTIE.t, { g: Object.assign({}, AKTIE.t.g, { b: 0.12 }) }) }));
  const u = K.unterschiede(alt, neu, "EUR");
  assert.equal(u.length, 2);
  assert.match(u[0], /Ist-Zahlen bis 31\.12\.2026 gesetzt: Gewinn der letzten vier Quartale 4,00 → 4,20 EUR/);
  assert.match(u[1], /Gewinnwachstum Basis \+10,00 % → \+12,00 %/);
  assert.deepEqual(K.unterschiede(alt, alt, "EUR"), []);
  assert.deepEqual(K.unterschiede(null, alt, "EUR"), []);
  // feste Reihenfolge der Treiber, auch wenn die Daten alphabetisch ankommen
  assert.deepEqual(K.treiberListe(AKTIE), ["g", "v", "div"]);
  assert.deepEqual(K.treiberListe(FOREX), ["k", "e"]);
});
