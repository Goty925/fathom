// Tests für den Backtest-Rechenkern: node --test tests/backtest_kern.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const K = require("../assets/backtest-kern.js");

// Handelstage Mo–Fr ab Montag, 2024-01-01 (Tag 19723 seit 1970)
function wert(kerzen, extra = {}) {
  const d0 = 19723, tage = [];
  for (let t = d0; tage.length < kerzen.length; t++) if (K.wochentag(t) >= 1 && K.wochentag(t) <= 5) tage.push(t);
  const c = kerzen.map((k) => k[3]);
  const bp = (j) => kerzen.map((k) => Math.round((k[j] / k[3] - 1) * 1e4));
  return K.dekodiere(Object.assign({ s: "T", n: "Test", t: "aktie", d0, dd: tage.slice(1).map((t, i) => t - tage[i]), c, o: bp(0), h: bp(1), l: bp(2) }, extra));
}
const flach = (n, p = 100) => Array.from({ length: n }, () => [p, p, p, p]);
const lauf = (w, fakten, jahre = 10) => K.rechne([w], fakten, { jahre, katalog: [], params: {} });

test("Take-Profit am Tageshoch, Einstieg zur Eröffnung am Montag", () => {
  const k = flach(30);
  k[6] = [100, 102.5, 99.5, 101]; // Dienstag der zweiten Woche
  const r = lauf(wert(k), [{ typ: "wochentag", tag: 1 }, { typ: "tp", wert: 2 }, { typ: "halten", tage: 3 }, { typ: "kosten", wert: 0 }]);
  const t = r.trades[0];
  assert.equal(K.datum(t.w.tag[t.tagEin]), "2024-01-08");
  assert.equal(t.grund, "ziel");
  assert.ok(Math.abs(t.aus - 102) < 1e-9 && Math.abs(t.netto - 0.02) < 1e-9);
  assert.equal(t.tagAus - t.tagEin + 1, 2);
});

test("Ziel und Stop am selben Tag: der Stop zählt", () => {
  const k = flach(10);
  k[1] = [100, 103, 97, 100];
  const r = lauf(wert(k), [{ typ: "tp", wert: 2 }, { typ: "sl", wert: 2 }, { typ: "kosten", wert: 0 }]);
  assert.equal(r.trades[0].grund, "stop");
  assert.ok(r.trades[0].beide);
  assert.ok(Math.abs(r.trades[0].netto + 0.02) < 1e-9);
});

test("Kurslücke unter den Stop: Ausführung zur Eröffnung, nicht am Stop", () => {
  const k = flach(10);
  k[2] = [95, 96, 94, 95];
  const r = lauf(wert(k), [{ typ: "einstieg", zeit: "schluss" }, { typ: "sl", wert: 2 }, { typ: "kosten", wert: 0 }]);
  const t = r.trades[0];
  assert.equal(t.tagEin, 1);
  assert.equal(t.grund, "stop");
  assert.ok(t.luecke && Math.abs(t.aus - 95) < 1e-9);
});

test("Short: Ziel liegt unter dem Einstieg", () => {
  const k = flach(10);
  k[1] = [100, 100.5, 96.5, 97];
  const r = lauf(wert(k), [{ typ: "richtung", seite: "short" }, { typ: "tp", wert: 3 }, { typ: "kosten", wert: 0 }]);
  assert.equal(r.trades[0].grund, "ziel");
  assert.ok(Math.abs(r.trades[0].netto - 0.03) < 1e-9);
});

test("Quartalszahlen: erster Montag im Fenster, ein Trade je Meldung, schlechte Zahlen zählen nicht", () => {
  const k = flach(60);
  // Reaktionstag 3 (Do 2024-01-04) gut, Reaktionstag 23 schlecht, Reaktionstag 43 gut, aber Fenster ohne Montag
  const w = wert(k, { e: [[3, 1.0, 1.1, "2024-01-03"], [23, 1.0, 0.9, "2024-01-31"], [47, 1.0, 1.2, "2024-03-05"]] });
  const r = lauf(w, [{ typ: "zahlen", seite: "besser", min: 5, fenster: 3 }, { typ: "wochentag", tag: 1 }, { typ: "halten", tage: 1 }]);
  assert.deepEqual(r.trades.map((t) => K.datum(t.w.tag[t.tagEin])), ["2024-01-08"]);
  assert.equal(r.trades[0].zahlen.d, "2024-01-03");
  const ohneTag = lauf(w, [{ typ: "zahlen", seite: "besser", min: 5, fenster: 3 }, { typ: "halten", tage: 1 }]);
  assert.deepEqual(ohneTag.trades.map((t) => t.tagEin), [3, 47]);
});

test("Kein Blick in die Zukunft: Signal am Schluss von Tag i → Eröffnung erst an Tag i+1", () => {
  const k = flach(40);
  k[30] = [100, 106, 100, 105]; // Schluss +5 %
  const fakten = [{ typ: "vortag", r: ">=", wert: 4 }, { typ: "halten", tage: 1 }];
  assert.deepEqual(lauf(wert(k), [{ typ: "einstieg", zeit: "schluss" }, ...fakten]).trades.map((t) => t.tagEin), [30]);
  assert.deepEqual(lauf(wert(k), fakten).trades.map((t) => t.tagEin), [31]);
});

test("Kapital: bei 100 % Positionsgröße entfällt das zweite gleichzeitige Signal", () => {
  const a = wert(flach(10)), b = wert(flach(10));
  b.s = "U";
  const r = K.rechne([a, b], [{ typ: "groesse", wert: 100 }, { typ: "halten", tage: 3 }, { typ: "kosten", wert: 0 }], { jahre: 10, katalog: [], params: {} });
  assert.ok(r.uebersprungen >= 1);
  assert.ok(r.trades.every((t) => t.w.s === "T"));
});

test("Depotkurve und Kennzahlen: zwei Gewinner zu je 2 % bei 50 % Positionsgröße", () => {
  const k = flach(20);
  k[1] = [100, 102.5, 100, 101];
  k[6] = [100, 102.5, 100, 101];
  const r = lauf(wert(k), [{ typ: "tp", wert: 2 }, { typ: "groesse", wert: 50 }, { typ: "halten", tage: 1 }, { typ: "kosten", wert: 0 }]);
  const gewinner = r.trades.filter((t) => t.grund === "ziel").length;
  assert.equal(gewinner, 2);
  const erwartet = (1 + 0.5 * 0.02) ** 2;
  assert.ok(Math.abs(r.kurve[r.kurve.length - 1] / r.start - erwartet) < 1e-9);
  assert.ok(r.depot.rueckgang.max <= 0);
});


/* ---------------------------------------------------------------- Exakte Daten, Hebel, Wirtschaftsdaten */
// Wert im exakten Format (ganze Zahlen in Punkten, Öffnungszeiten, Spread); kerzen: [o, h, l, c], Tage ab Mo 2024-01-01
function exakt(kerzen, { dez = 4, sp = null, sitzung = 1440, start = 22 * 60 - 1440 } = {}) {
  const d0 = 19723, tage = [];
  for (let t = d0; tage.length < kerzen.length; t++) if (K.wochentag(t) >= 1 && K.wochentag(t) <= 5) tage.push(t);
  const f = 10 ** dez, ci = kerzen.map((k) => Math.round(k[3] * f));
  const to = tage.map((t) => t * 1440 + start);
  return K.dekodiere({ s: "EURUSD=X", n: "EUR/USD", t: "forex", dez, d0, dd: tage.slice(1).map((t, i) => t - tage[i]), sl: sitzung,
    t0: to[0], dt: to.slice(1).map((t, i) => t - to[i]), c: ci.map((x, i) => (i ? x - ci[i - 1] : x)),
    o: kerzen.map((k, i) => Math.round(k[0] * f) - ci[i]), h: kerzen.map((k, i) => Math.round(k[1] * f) - ci[i]), l: kerzen.map((k, i) => Math.round(k[2] * f) - ci[i]),
    sp: sp == null ? undefined : kerzen.map(() => Math.round(sp * f)) });
}
const flach2 = (n, p = 1.1) => Array.from({ length: n }, () => [p, p, p, p]);
const rechne = (w, fakten, ereignisse) => K.rechne([w], fakten, { jahre: 10, katalog: [], params: {}, ereignisse: ereignisse || [] });

test("Hebel 10, Einsatz 1000 €: 1 % Kursgewinn = 10 % auf den Einsatz = 100 €", () => {
  const k = flach2(10, 1); k[2] = [1, 1.012, 1, 1.005];
  const r = rechne(exakt(k), [{ typ: "tp", wert: 1, bezug: "kurs" }, { typ: "hebel", wert: 10, zwang: 50, zins: 0 }, { typ: "kosten", wert: 0 },
    { typ: "kapital", start: 10000, wert: 1000, art: "betrag" }, { typ: "groesse", wert: 10 }].slice(0, 4));
  const t = r.trades[0];
  assert.equal(t.grund, "ziel");
  assert.ok(Math.abs(t.netto - 0.1) < 1e-9);
  assert.ok(Math.abs(t.euro - 100) < 1e-6);
  assert.ok(r.trades.length >= 1 && r.kurve[r.kurve.length - 1] > 10000);
});

test("Take-Profit in % vom Einsatz: 20 % bei Hebel 10 = 2 % Kursbewegung", () => {
  const k = flach2(10, 1); k[1] = [1, 1.019, 1, 1.01]; k[2] = [1.01, 1.021, 1.0, 1.01];
  const r = rechne(exakt(k), [{ typ: "tp", wert: 20, bezug: "einsatz" }, { typ: "hebel", wert: 10, zwang: 50, zins: 0 }, { typ: "kosten", wert: 0 }]);
  assert.equal(K.datum(r.trades[0].w.tag[r.trades[0].tagAus]), "2024-01-03");
  assert.ok(Math.abs(r.trades[0].netto - 0.2) < 1e-9);
});

test("Zwangsschließung: Hebel 20, 50 % Regel → bei −2,5 % Kurs ist die Hälfte des Einsatzes weg", () => {
  const k = flach2(10, 1); k[2] = [1, 1, 0.97, 0.98];
  const r = rechne(exakt(k), [{ typ: "halten", tage: 5, einheit: "tage" }, { typ: "hebel", wert: 20, zwang: 50, zins: 0 }, { typ: "kosten", wert: 0 }]);
  const t = r.trades[0];
  assert.equal(t.grund, "zwang");
  assert.ok(Math.abs(t.aus - 0.975) < 1e-9 && Math.abs(t.netto + 0.5) < 1e-9);
});

test("Finanzierung über Nacht auf den geliehenen Teil", () => {
  const r = rechne(exakt(flach2(10, 1)), [{ typ: "halten", tage: 3, einheit: "tage" }, { typ: "hebel", wert: 5, zwang: 50, zins: 7.3 }, { typ: "kosten", wert: 0 }]);
  const t = r.trades[0];
  assert.equal(t.naechte, 3);
  assert.ok(Math.abs(t.finanzR - 4 * 0.073 / 365 * 3) < 1e-12);
  assert.ok(Math.abs(t.netto + t.finanzR) < 1e-12);
});

test("Geld und Brief: Long kauft zum Brief- und verkauft zum Geldkurs", () => {
  const r = rechne(exakt(flach2(10, 1.1), { sp: 0.0002 }), [{ typ: "halten", tage: 1, einheit: "tage" }]);
  const t = r.trades[0];
  assert.ok(Math.abs(t.ein - 1.1001) < 1e-9 && Math.abs(t.aus - 1.0999) < 1e-9);
  assert.ok(t.netto < 0);
});

test("Stundenkerzen entscheiden, was zuerst kam (statt pauschal Stop)", () => {
  const k = flach2(5, 1); k[1] = [1, 1.03, 0.97, 1];
  const w = exakt(k);
  const t0 = w.to[1];
  // Stunde 1: Ziel +2 % erreicht, Stunde 3: Stop −2 % – Tageskerze allein wäre mehrdeutig
  const stunden = Array.from({ length: 24 * 4 }, (_, i) => [1, 1, 1, 1]);
  stunden[1] = [1, 1.025, 0.999, 1.01]; stunden[3] = [1, 1.001, 0.97, 0.98];
  const enc = (arr) => { const ci = arr.map((x) => Math.round(x[3] * 1e4)); return { u: 60, t0, dt: arr.slice(1).map(() => 1), c: ci.map((x, i) => (i ? x - ci[i - 1] : x)),
    o: arr.map((x, i) => Math.round(x[0] * 1e4) - ci[i]), h: arr.map((x, i) => Math.round(x[1] * 1e4) - ci[i]), l: arr.map((x, i) => Math.round(x[2] * 1e4) - ci[i]) }; };
  K.intraday(w, { dez: 4, h: enc(stunden), m: {} });
  const fakten = [{ typ: "tp", wert: 2, bezug: "kurs" }, { typ: "sl", wert: 2, bezug: "kurs" }, { typ: "kosten", wert: 0 }];
  const t = K.rechne([w], fakten, { jahre: 10, katalog: [], params: {}, ereignisse: [] }).trades.find((x) => x.tagEin === 1);
  assert.equal(t.grund, "ziel");
  assert.equal(t.aufl, "std");
  assert.ok(Math.abs(t.netto - 0.02) < 1e-9);
});

test("Wirtschaftsdaten: Ist über Prognose → Einstieg eine Minute nach der Veröffentlichung, minutengenau", () => {
  const w = exakt(flach2(10, 1.1));
  const T = w.to[3] + 15 * 60 + 30; // CPI um 13:30 UTC, Sitzung seit 22:00 UTC des Vortags
  const minuten = Array.from({ length: 245 }, () => [1.1, 1.1, 1.1, 1.1]);
  minuten[6] = [1.1, 1.1, 1.1, 1.1];     // T+1: Einstieg 1,1
  minuten[8] = [1.1, 1.1225, 1.1, 1.12]; // T+3: Ziel 2 % erreicht
  const ci = minuten.map((x) => Math.round(x[3] * 1e4));
  K.intraday(w, { dez: 4, h: { u: 60, t0: 0, dt: [], c: [], o: [], h: [], l: [] }, m: { [T]: { u: 1, t0: T - 5, dt: minuten.slice(1).map(() => 1),
    c: ci.map((x, i) => (i ? x - ci[i - 1] : x)), o: minuten.map((x, i) => Math.round(x[0] * 1e4) - ci[i]), h: minuten.map((x, i) => Math.round(x[1] * 1e4) - ci[i]),
    l: minuten.map((x, i) => Math.round(x[2] * 1e4) - ci[i]) } } });
  const ereignisse = K.wirtschaft([{ id: "us_cpi_j", kurz: "CPI j/j", einheit: "%", termine: [[T, 3.4, 3.2, 3.1, "2024-01"], [T + 1440, 3.0, 3.2, 3.4, "2024-02"]] }]);
  const fakten = [{ typ: "ereignis", ind: "us_cpi_j", vergleich: "prognose", seite: "ueber", abstand: 0.1, masz: "absolut", einstieg: "1" },
    { typ: "tp", wert: 2, bezug: "kurs" }, { typ: "halten", tage: 4, einheit: "stunden" }, { typ: "kosten", wert: 0 }];
  const r = rechne(w, fakten, ereignisse);
  assert.equal(r.trades.length, 1);
  const t = r.trades[0];
  assert.equal(t.einMin, T + 1);
  assert.equal(t.grund, "ziel");
  assert.equal(t.aufl, "min");
  assert.ok(Math.abs(t.netto - 0.02) < 1e-9);
  assert.equal(t.termin.prog, 3.2);
});

test("Wirtschaftsdaten ohne Minutenkerzen: nächste Eröffnung, als ungenau markiert", () => {
  const w = exakt(flach2(10, 1.1), { start: 14 * 60 + 30, sitzung: 390 });
  const T = w.to[3] - 60; // eine Stunde vor Börsenbeginn
  const ereignisse = K.wirtschaft([{ id: "us_nfp", kurz: "NFP", einheit: "Tsd.", termine: [[T, 250, 180, 150, "2024-01"]] }]);
  const r = rechne(w, [{ typ: "ereignis", ind: "us_nfp", vergleich: "prognose", seite: "ueber", abstand: 50, masz: "absolut", einstieg: "1" },
    { typ: "halten", tage: 1, einheit: "tage" }], ereignisse);
  assert.equal(r.trades[0].tagEin, 3);
  assert.ok(r.trades[0].ungenau);
});

test("Vergleich mit Prognose, Vorwert und festem Wert", () => {
  const e = { ist: 3.3, prog: 3.2, vor: 3.4 };
  assert.equal(K.ereignisErfuellt({ vergleich: "prognose", seite: "ueber", abstand: 0.1, masz: "absolut" }, e), true);
  assert.equal(K.ereignisErfuellt({ vergleich: "prognose", seite: "ueber", abstand: 0.2, masz: "absolut" }, e), false);
  assert.equal(K.ereignisErfuellt({ vergleich: "prognose", seite: "ueber", abstand: 0, masz: "absolut" }, { ist: 3.2, prog: 3.2 }), false);
  assert.equal(K.ereignisErfuellt({ vergleich: "vorwert", seite: "unter", abstand: 0, masz: "absolut" }, e), true);
  assert.equal(K.ereignisErfuellt({ vergleich: "prognose", seite: "ueber", abstand: 3, masz: "relativ" }, e), true);
  assert.equal(K.ereignisErfuellt({ vergleich: "wert", seite: "ueber", abstand: 3.3 }, e), true);
  assert.equal(K.ereignisErfuellt({ vergleich: "prognose", seite: "ueber", abstand: 0 }, { ist: 3, prog: null }), false);
});

test("EU-Hebelgrenze wird im Report genannt", () => {
  const r = rechne(exakt(flach2(10, 1.1)), [{ typ: "hebel", wert: 50, zwang: 50, zins: 0 }, { typ: "halten", tage: 1 }]);
  assert.equal(r.grenze, 30);
  assert.ok(r.s.annahmen.some((a) => a.includes("EU-Grenze")));
});
