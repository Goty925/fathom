/* Tests für assets/taktik-kern.js: Deuten der Beschreibung und Rückrechnung gezeichneter Taktiken. */
const test = require("node:test");
const assert = require("node:assert/strict");
const T = require("../assets/taktik-kern.js");

// Kerzen aus Schlusskursen: Eröffnung = Vortagesschluss, Hoch/Tief ±0,5
function kerzen(schluss, extra = {}) {
  const k = { tag: [], o: [], h: [], l: [], c: [] };
  schluss.forEach((c, i) => {
    const o = i ? schluss[i - 1] : c;
    k.tag.push(20000 + i); k.o.push(o); k.c.push(c);
    k.h.push(Math.max(o, c) + 0.5); k.l.push(Math.min(o, c) - 0.5);
  });
  Object.entries(extra).forEach(([i, x]) => Object.assign(k, { h: k.h.map((v, j) => (j === +i && x.h != null ? x.h : v)), l: k.l.map((v, j) => (j === +i && x.l != null ? x.l : v)) }));
  return k;
}

test("Deuten: Ausbruch, Stop an der Zone, Ziel in R", () => {
  const Z = [{ id: "L1", art: "linie", p: 110, name: "Widerstand" }, { id: "Z1", art: "zone", t0: 1, t1: 2, oben: 100, unten: 96, verl: true }];
  const d = T.deute("Kaufe, wenn der Kurs über den Widerstand schließt. Stop unter Z1, Ziel 2R.", Z);
  assert.deepEqual(d.regeln.einstieg, [[{ typ: "kreuzt_ueber", ref: "L1" }]]);
  assert.deepEqual(d.regeln.stop, { art: "objekt", ref: "Z1", seite: "unten", puffer: 0 });
  assert.deepEqual(d.regeln.ziel, { art: "r", wert: 2 });
  assert.equal(d.unklar.length, 0);
});

test("Deuten: Short, Prozent-Stop, Haltedauer, Filter mit 200-Tage-Linie", () => {
  const Z = [{ id: "T1", art: "trend", a: { t: 0, p: 100 }, b: { t: 10, p: 110 }, verl: true }];
  const d = T.deute("Short, wenn der Kurs unter die Trendlinie fällt, nur wenn er unter der 200-Tage-Linie liegt. Stop 1,5 %. Spätestens nach 7 Tagen raus.", Z);
  assert.equal(d.regeln.richtung, "short");
  assert.deepEqual(d.regeln.einstieg, [[{ typ: "kreuzt_unter", ref: "T1" }]]);
  assert.deepEqual(d.regeln.filter, [{ typ: "ma", ma: "sma", n: 200, op: "unter" }]);
  assert.deepEqual(d.regeln.stop, { art: "prozent", wert: 0.015 });
  assert.equal(d.regeln.halten, 7);
});

test("Deuten: Unterstützung/Widerstand ohne Namen und Verkauf am Ziel", () => {
  const Z = [{ id: "L1", art: "linie", p: 120 }, { id: "L2", art: "linie", p: 100 }];
  const d = T.deute("Ich kaufe am Support und verkaufe am Widerstand.", Z);
  assert.deepEqual(d.regeln.einstieg, [[{ typ: "beruehrt", ref: "L2", von: "oben" }]]);
  assert.deepEqual(d.regeln.ziel, { art: "objekt", ref: "L1", seite: null, puffer: 0 });
});

test("Trendlinie: Preis zwischen und hinter den Punkten, ohne Verlängerung endet sie", () => {
  const k = kerzen(Array.from({ length: 30 }, () => 100));
  const z = { id: "T1", art: "trend", a: { t: 20000, p: 100 }, b: { t: 20010, p: 110 }, verl: true };
  assert.equal(T.wertAn(z, k, 5).p, 105);
  assert.equal(T.wertAn(z, k, 20).p, 120);
  assert.equal(T.wertAn({ ...z, verl: false }, k, 20), null);
});

test("Rückrechnung: Ausbruch über eine Linie, Ziel 2R wird erreicht", () => {
  // Tag 0–4 unter 110, Tag 5 schließt bei 112 (Signal), Tag 6 Eröffnung 112, danach steigt der Kurs
  const k = kerzen([100, 104, 106, 108, 109, 112, 113, 116, 118, 121, 123, 125]);
  const Z = [{ id: "L1", art: "linie", p: 110 }];
  const regeln = { richtung: "long", einstieg: [[{ typ: "kreuzt_ueber", ref: "L1" }]], stop: { art: "objekt", ref: "L1", seite: null, puffer: 0 }, ziel: { art: "r", wert: 2 } };
  const e = T.teste(k, Z, regeln, { kosten: 0 });
  assert.equal(e.trades.length, 1);
  const t = e.trades[0];
  assert.equal(t.signal, 5); assert.equal(t.ein_i, 6); assert.equal(t.ein, 112);
  assert.equal(t.stop, 110); assert.equal(t.ziel, 116);
  assert.equal(t.grund, "ziel"); assert.equal(t.aus, 116); assert.ok(Math.abs(t.r - 2) < 1e-9);
});

test("Rückrechnung: Stop und Ziel in derselben Kerze zählen als Stop; Stop auf der falschen Seite verhindert den Trade", () => {
  const k = kerzen([100, 104, 106, 108, 109, 112, 113, 113, 113]);
  k.h[7] = 130; k.l[7] = 100; // eine Kerze reißt beides
  const Z = [{ id: "L1", art: "linie", p: 110 }];
  const e = T.teste(k, Z, { einstieg: [[{ typ: "kreuzt_ueber", ref: "L1" }]], stop: { art: "objekt", ref: "L1", puffer: 0 }, ziel: { art: "r", wert: 3 } }, { kosten: 0 });
  assert.equal(e.trades[0].grund, "stop");
  assert.ok(e.hinweise.some((h) => h.includes("dieselbe Kerze")));
  const f = T.teste(k, Z, { einstieg: [[{ typ: "kreuzt_ueber", ref: "L1" }]], stop: { art: "objekt", ref: "L1", seite: null, puffer: -0 }, ziel: null, richtung: "short" }, { kosten: 0 });
  assert.equal(f.trades.length, 0);
});

test("Wochenkerzen und Prüfen fremder Regeln", () => {
  const k = { tag: [], o: [], h: [], l: [], c: [] };
  for (let i = 0; i < 14; i++) { k.tag.push(19996 + i); k.o.push(i); k.h.push(i + 1); k.l.push(i - 1); k.c.push(i + 0.5); } // 19996 = Montag
  const w = T.wochen(k);
  assert.equal(w.c.length, 2); assert.equal(w.o[0], 0); assert.equal(w.c[0], 6.5); assert.equal(w.h[1], 14);
  const r = T.pruefe({ richtung: "x", einstieg: [[{ typ: "kreuzt_ueber", ref: "<img>" }, { typ: "sma", n: 50, seite: "ueber" }]], stop: { art: "prozent", wert: 5 } }, [{ id: "L1" }]);
  assert.deepEqual(r.einstieg, [[{ typ: "sma", n: 50, seite: "ueber" }]]);
  assert.equal(r.richtung, "long"); assert.equal(r.stop, null);
  const z = T.pruefeZeichnungen([{ art: "linie", p: 5, name: "<b>Widerstand</b>" }, { art: "zone", t0: 1, t1: 2, oben: 1, unten: 3 }, { art: "boese" }]);
  assert.equal(z.length, 2); assert.equal(z[0].name, "bWiderstandb"); assert.equal(z[1].oben, 3);
});

// ---------------------------------------------------------------- Indikatoren
function zufallsKerzen(n, seed) {
  let x = seed;
  const z = () => { x = (x * 16807) % 2147483647; return x / 2147483647; };
  const k = { tag: [], o: [], h: [], l: [], c: [] };
  let p = 100;
  for (let i = 0; i < n; i++) {
    const o = p; p = p * (1 + (z() - 0.5) * 0.04);
    k.tag.push(20000 + i); k.o.push(o); k.c.push(p); k.h.push(Math.max(o, p) * (1 + z() * 0.01)); k.l.push(Math.min(o, p) * (1 - z() * 0.01));
  }
  return k;
}
const nah = (a, b, eps = 1e-9) => (Number.isNaN(a) && Number.isNaN(b)) || Math.abs(a - b) <= eps * Math.max(1, Math.abs(b));

test("Indikatoren stimmen mit einer direkten Rechnung überein", () => {
  const k = zufallsKerzen(300, 7), c = k.c;
  // RSI nach Wilder, Schritt für Schritt
  const rsi = T.reihen.rsi(c, 14);
  let g = 0, v = 0;
  for (let i = 1; i <= 14; i++) { const d = c[i] - c[i - 1]; g += Math.max(d, 0); v += Math.max(-d, 0); }
  g /= 14; v /= 14;
  assert.ok(nah(rsi[14], 100 - 100 / (1 + g / v)));
  for (let i = 15; i < c.length; i++) { const d = c[i] - c[i - 1]; g = (g * 13 + Math.max(d, 0)) / 14; v = (v * 13 + Math.max(-d, 0)) / 14; assert.ok(nah(rsi[i], 100 - 100 / (1 + g / v))); }
  assert.ok(Number.isNaN(rsi[13]));
  // Bollinger: Standardabweichung der Grundgesamtheit
  const bb = T.reihen.bb(c, 20, 2), fenster = c.slice(100, 120), m = fenster.reduce((a, b) => a + b) / 20;
  const sd = Math.sqrt(fenster.reduce((a, b) => a + (b - m) ** 2, 0) / 20);
  assert.ok(nah(bb.mitte[119], m, 1e-9) && nah(bb.oben[119], m + 2 * sd, 1e-8) && nah(bb.unten[119], m - 2 * sd, 1e-8));
  // EMA: Start mit dem Durchschnitt, dann geglättet
  const ema = T.reihen.ema(c, 10);
  let e = c.slice(0, 10).reduce((a, b) => a + b) / 10;
  assert.ok(nah(ema[9], e));
  for (let i = 10; i < 50; i++) e += (2 / 11) * (c[i] - e);
  assert.ok(nah(ema[49], e));
  // ATR nach Wilder
  const atr = T.reihen.atr(k, 14);
  const tr = (i) => (i ? Math.max(k.h[i] - k.l[i], Math.abs(k.h[i] - c[i - 1]), Math.abs(k.l[i] - c[i - 1])) : k.h[i] - k.l[i]);
  let a = 0; for (let i = 0; i < 14; i++) a += tr(i);
  a /= 14; assert.ok(nah(atr[13], a));
  for (let i = 14; i < 40; i++) a = (a * 13 + tr(i)) / 14;
  assert.ok(nah(atr[39], a));
  // MACD = EMA 12 − EMA 26, Signal = EMA 9 des MACD
  const md = T.reihen.macd(c, 12, 26, 9), e12 = T.reihen.ema(c, 12), e26 = T.reihen.ema(c, 26);
  assert.ok(nah(md.macd[100], e12[100] - e26[100]) && Number.isNaN(md.signal[32]) && Number.isFinite(md.signal[33]));
});

test("Indikatoren ohne Blick in die Zukunft: Wert an Kerze i hängt nur von Kursen bis i ab", () => {
  const k = zufallsKerzen(260, 11);
  const kurz = { tag: k.tag.slice(0, 200), o: k.o.slice(0, 200), h: k.h.slice(0, 200), l: k.l.slice(0, 200), c: k.c.slice(0, 200) };
  const paare = [[T.reihen.rsi(k.c, 14), T.reihen.rsi(kurz.c, 14)], [T.reihen.ema(k.c, 20), T.reihen.ema(kurz.c, 20)], [T.reihen.sma(k.c, 50), T.reihen.sma(kurz.c, 50)],
    [T.reihen.bb(k.c, 20, 2).unten, T.reihen.bb(kurz.c, 20, 2).unten], [T.reihen.atr(k, 14), T.reihen.atr(kurz, 14)], [T.reihen.macd(k.c, 12, 26, 9).signal, T.reihen.macd(kurz.c, 12, 26, 9).signal]];
  paare.forEach(([voll, abgeschnitten]) => { for (let i = 0; i < 200; i++) assert.ok(nah(voll[i], abgeschnitten[i]), `Index ${i}`); });
});

// ---------------------------------------------------------------- Deuten mit Indikatoren und neuen Werkzeugen
test("Deuten: RSI, ATR-Stop, EMA-Ausbruch mit RSI-Filter, Golden Cross, MACD-Ausstieg", () => {
  let d = T.deute("Kaufe, wenn der RSI über 30 steigt. Stop 2 ATR, Ziel 2R.", []);
  assert.deepEqual(d.regeln.einstieg, [[{ typ: "rsi", n: 14, op: "kreuzt_ueber", wert: 30 }]]);
  assert.deepEqual(d.regeln.stop, { art: "atr", wert: 2, n: 14 });
  assert.deepEqual(d.regeln.ziel, { art: "r", wert: 2 });
  d = T.deute("Kaufe, wenn der Kurs über dem EMA 20 schließt und der RSI(14) über 50 ist.", []);
  assert.deepEqual(d.regeln.einstieg, [[{ typ: "ma", ma: "ema", n: 20, op: "kreuzt_ueber" }]]);
  assert.deepEqual(d.regeln.filter, [{ typ: "rsi", n: 14, op: "ueber", wert: 50 }]);
  d = T.deute("Kaufe beim Golden Cross. Raus, wenn der MACD unter die Signallinie fällt.", []);
  assert.deepEqual(d.regeln.einstieg, [[{ typ: "ma_kreuz", a: { ma: "sma", n: 50 }, b: { ma: "sma", n: 200 }, op: "kreuzt_ueber" }]]);
  assert.deepEqual(d.regeln.ausstieg, [{ typ: "macd", schnell: 12, langsam: 26, signal: 9, gegen: "signal", op: "kreuzt_unter" }]);
  d = T.deute("Kaufe, wenn der EMA 20 über den EMA 50 kreuzt.", []);
  assert.deepEqual(d.regeln.einstieg, [[{ typ: "ma_kreuz", a: { ma: "ema", n: 20 }, b: { ma: "ema", n: 50 }, op: "kreuzt_ueber" }]]);
  d = T.deute("Kaufe, wenn der RSI unter 30 ist.", []);
  assert.deepEqual(d.regeln.einstieg, [[{ typ: "rsi", n: 14, op: "unter", wert: 30 }]]);
  d = T.deute("Short, wenn der RSI überkauft ist und der MACD die Signallinie nach unten kreuzt. Ziel 3 %.", []);
  assert.equal(d.regeln.richtung, "short");
  assert.deepEqual(d.regeln.einstieg, [[{ typ: "macd", schnell: 12, langsam: 26, signal: 9, gegen: "signal", op: "kreuzt_unter" }]]);
  assert.deepEqual(d.regeln.filter, [{ typ: "rsi", n: 14, op: "ueber", wert: 70 }]);
  d = T.deute("Kaufe, wenn der MACD(8, 21, 5) die Nulllinie nach oben kreuzt.", []);
  assert.deepEqual(d.regeln.einstieg, [[{ typ: "macd", schnell: 8, langsam: 21, signal: 5, gegen: "null", op: "kreuzt_ueber" }]]);
});

test("Deuten: Bollinger-Bänder für Einstieg und Ziel", () => {
  let d = T.deute("Kaufe, wenn der Kurs das untere Bollinger-Band berührt. Ziel oberes Bollinger-Band. Stop 3 %.", []);
  assert.deepEqual(d.regeln.einstieg, [[{ typ: "bb", n: 20, k: 2, band: "unten", op: "beruehrt" }]]);
  assert.deepEqual(d.regeln.ausstieg, [{ typ: "bb", n: 20, k: 2, band: "oben", op: "beruehrt" }]);
  d = T.deute("Kaufe, wenn der Kurs zurück ins Bollinger-Band (20, 2,5) unten schließt.", []);
  assert.deepEqual(d.regeln.einstieg, [[{ typ: "bb", n: 20, k: 2.5, band: "unten", op: "kreuzt_ueber" }]]);
});

const FIB = { id: "F1", art: "fib", a: { t: 20000, p: 100 }, b: { t: 20010, p: 120 }, verl: true };
test("Fibonacci: Level, Golden Pocket, Stop und Ziel an Leveln", () => {
  const k = kerzen(Array.from({ length: 30 }, () => 110));
  assert.ok(Math.abs(T.wertAn(FIB, k, 15, { stufe: 0.618 }).p - (120 - 0.618 * 20)) < 1e-9);
  assert.equal(T.wertAn(FIB, k, 15, { stufe: 0 }).p, 120);
  const zone = T.wertAn(FIB, k, 15, { stufe: 0.5, stufe2: 0.618 });
  assert.ok(Math.abs(zone.oben - 110) < 1e-9 && Math.abs(zone.unten - 107.64) < 1e-9);
  let d = T.deute("Kaufe, wenn der Kurs das 61,8-%-Level von F1 berührt. Stop unter 78,6 % von F1. Ziel 0 % von F1.", [FIB]);
  assert.deepEqual(d.regeln.einstieg, [[{ typ: "beruehrt", ref: "F1", von: "oben", stufe: 0.618 }]]);
  assert.deepEqual(d.regeln.stop, { art: "objekt", ref: "F1", seite: "unten", puffer: 0, stufe: 0.786 });
  assert.deepEqual(d.regeln.ziel, { art: "objekt", ref: "F1", seite: null, puffer: 0, stufe: 0 });
  d = T.deute("Kaufe, wenn der Kurs in den Golden Pocket des Retracements läuft.", [FIB]);
  assert.deepEqual(d.regeln.einstieg, [[{ typ: "in_zone", ref: "F1", von: "oben", stufe: 0.618, stufe2: 0.65 }]]);
  d = T.deute("Kaufe am Fibonacci.", [FIB]);
  assert.ok(d.hinweise.some((h) => h.includes("ohne Level")));
});

test("Kanal, Strahl, senkrechte Linie und Position", () => {
  const k = kerzen(Array.from({ length: 30 }, () => 100));
  const K = { id: "K1", art: "kanal", a: { t: 20000, p: 100 }, b: { t: 20010, p: 110 }, d: -6, verl: true };
  const w = T.wertAn(K, k, 5);
  assert.ok(Math.abs(w.oben - 105) < 1e-9 && Math.abs(w.unten - 99) < 1e-9);
  assert.ok(Math.abs(T.wertAn(K, k, 5, { kante: "unten" }).p - 99) < 1e-9);
  const S = { id: "S1", art: "strahl", p: 105, t: 20010 };
  assert.equal(T.wertAn(S, k, 9), null);
  assert.equal(T.wertAn(S, k, 10).p, 105);
  const L = { id: "L1", art: "linie", p: 103 }, V = { id: "V1", art: "senkrecht", t: 20015 };
  const P = { id: "P1", art: "position", t: 20000, t1: 20020, ein: 100, stop: 98, ziel: 106 };
  let d = T.deute("Kaufe, wenn der Kurs die untere Kanallinie von K1 berührt. Raus, wenn der Kurs den Kanal nach unten verlässt.", [K]);
  assert.deepEqual(d.regeln.einstieg, [[{ typ: "beruehrt", ref: "K1", von: "oben", kante: "unten" }]]);
  assert.deepEqual(d.regeln.ausstieg, [{ typ: "verlaesst_unten", ref: "K1" }]);
  d = T.deute("Kaufe nach V1, wenn der Kurs über L1 schließt.", [L, V, P]);
  assert.deepEqual(d.regeln.einstieg, [[{ typ: "kreuzt_ueber", ref: "L1" }]]);
  assert.deepEqual(d.regeln.filter, [{ typ: "nach", ref: "V1" }]);
  assert.deepEqual(d.regeln.stop, { art: "position", ref: "P1" });
  assert.deepEqual(d.regeln.ziel, { art: "position", ref: "P1" });
  assert.ok(d.hinweise.some((h) => h.includes("aus P1 übernommen")));
  d = T.deute("Kaufe über dem Widerstand.", [S]);
  assert.deepEqual(d.regeln.einstieg, [[{ typ: "kreuzt_ueber", ref: "S1" }]]);
  // Short-Position ohne genannte Richtung: Short
  d = T.deute("Einstieg, wenn der Kurs unter L1 schließt.", [L, { id: "P1", art: "position", t: 20000, t1: 20020, ein: 100, stop: 102, ziel: 95 }]);
  assert.equal(d.regeln.richtung, "short");
});

test("Rückrechnung: ATR-Stop, Abstände aus der Position, RSI-Einstieg, Start erst ab einer Kerze", () => {
  const k = kerzen([100, 104, 106, 108, 109, 112, 113, 116, 118, 121, 123, 125, 126, 127]);
  const P = { id: "P1", art: "position", t: 20000, t1: 20010, ein: 100, stop: 98, ziel: 104 };
  const Z = [{ id: "L1", art: "linie", p: 110 }, P];
  let e = T.teste(k, Z, { einstieg: [[{ typ: "kreuzt_ueber", ref: "L1" }]], stop: { art: "position", ref: "P1" }, ziel: { art: "position", ref: "P1" } }, { kosten: 0 });
  assert.equal(e.trades.length, 1);
  assert.ok(Math.abs(e.trades[0].stop - 112 * 0.98) < 1e-9 && Math.abs(e.trades[0].ziel - 112 * 1.04) < 1e-9);
  e = T.teste(k, Z, { einstieg: [[{ typ: "kreuzt_ueber", ref: "L1" }]], stop: { art: "atr", wert: 1, n: 3 }, ziel: { art: "r", wert: 1 } }, { kosten: 0 });
  const atr = T.reihen.atr(k, 3)[5];
  assert.ok(Math.abs(e.trades[0].stop - (112 - atr)) < 1e-9 && Math.abs(e.trades[0].ziel - (112 + atr)) < 1e-9);
  // Mit „ab“ werden frühere Signale nicht gehandelt
  assert.equal(T.teste(k, Z, { einstieg: [[{ typ: "kreuzt_ueber", ref: "L1" }]], halten: 2 }, { kosten: 0, ab: 6 }).trades.length, 0);
  // RSI: steigt über 50 nach einem Rückgang
  const k2 = kerzen([100, 98, 96, 94, 92, 90, 88, 86, 85, 84, 83, 82, 81, 80, 84, 89, 95, 99, 102, 104, 105]);
  e = T.teste(k2, [], { einstieg: [[{ typ: "rsi", n: 5, op: "kreuzt_ueber", wert: 50 }]], halten: 2 }, { kosten: 0 });
  const r = T.reihen.rsi(k2.c, 5);
  assert.ok(e.trades.length >= 1);
  assert.ok(r[e.trades[0].signal] > 50 && r[e.trades[0].signal - 1] <= 50);
});

test("Prüfen: neue Werkzeuge und Bedingungen nur mit gültigen Werten", () => {
  const Z = T.pruefeZeichnungen([
    { id: "P1", art: "position", t: 1, ein: 100, stop: 101, ziel: 105 },            // Stop auf der falschen Seite: weg
    { id: "P7", art: "position", t: 1, ein: 100, stop: 98, ziel: 105 },
    { id: "X1", art: "kanal", a: { t: 1, p: 1 }, b: { t: 2, p: 2 }, d: 1 },          // falsches Kürzel: neue Kennung
    { art: "fib", a: { t: 1, p: 5 }, b: { t: 2, p: 5 } },                             // ohne Spanne: weg
    { art: "senkrecht", t: 20005.4 }, { art: "strahl", p: 3 },                        // Strahl ohne Startzeit: weg
  ]);
  assert.deepEqual(Z.map((z) => z.id), ["P7", "K1", "V1"]);
  assert.equal(Z[0].t1, 29); assert.equal(Z[2].t, Math.round(20005.4 * 1440) / 1440);  // auf die Minute genau (Minuten- und Stundenkerzen)
  const r = T.pruefe({ einstieg: [[{ typ: "rsi", n: 14, op: "ueber", wert: 150 }, { typ: "macd", schnell: 26, langsam: 12, signal: 9, op: "ueber" },
    { typ: "nach", ref: "K1" }, { typ: "nach", ref: "V1" }, { typ: "ma", ma: "wma", n: 20, op: "ueber" }, { typ: "bb", n: 20, k: 2, band: "unten", op: "beruehrt", boese: 1 }]],
    stop: { art: "position", ref: "K1" }, ziel: { art: "atr", wert: 3 } }, Z);
  assert.deepEqual(r.einstieg, [[{ typ: "nach", ref: "V1" }, { typ: "bb", n: 20, k: 2, band: "unten", op: "beruehrt" }]]);
  assert.equal(r.stop, null);
  assert.deepEqual(r.ziel, { art: "atr", wert: 3, n: 14 });
  assert.deepEqual(T.pruefeIndikatoren([{ art: "ema", n: 20 }, { art: "ema", n: 20 }, { art: "macd", schnell: 12, langsam: 26, signal: 9 }, { art: "rsi", n: 1 }, { art: "__proto__" }]),
    [{ art: "ema", n: 20 }, { art: "macd", schnell: 12, langsam: 26, signal: 9 }]);
});

test("Beschreiben und benötigte Indikatoren", () => {
  const regeln = T.pruefe({ einstieg: [[{ typ: "ma_kreuz", a: { ma: "ema", n: 20 }, b: { ma: "ema", n: 50 }, op: "kreuzt_ueber" }]],
    filter: [{ typ: "rsi", n: 14, op: "ueber", wert: 50 }], stop: { art: "atr", wert: 1.5, n: 14 }, ausstieg: [{ typ: "bb", n: 20, k: 2, band: "oben", op: "beruehrt" }] }, []);
  const text = T.beschreibe(regeln, []).map((z) => z.text).join(" | ");
  assert.match(text, /EMA 20 kreuzt über EMA 50/);
  assert.match(text, /nur wenn RSI 14 über 50/);
  assert.match(text, /Stop: 1,5 × ATR 14/);
  assert.match(text, /oberen Bollinger-Band/);
  assert.deepEqual(T.indikatorenAus(regeln).map(T.indName), ["EMA 20", "EMA 50", "RSI 14", "Bollinger 20/2", "ATR 14"]);
  assert.equal(T.abTag({ einstieg: [[{ typ: "beruehrt", ref: "F1" }]] }, [FIB]), 20010);
});

test("Zeiträume: Woche, Monat und 4 Stunden je Handelssitzung", () => {
  assert.deepEqual(Object.keys(T.EBENEN), ["1m", "5m", "15m", "1h", "4h", "tag", "woche", "monat"]);
  assert.equal(T.ebeneOk("4h"), "4h"); assert.equal(T.ebeneOk("jahr"), "tag"); assert.equal(T.ebeneOk("__proto__"), "tag");
  assert.equal(T.rundeZeit(20000.4, "tag"), 20000); assert.equal(T.rundeZeit(20000.40001, "1h"), Math.round(20000.4 * 1440) / 1440);
  // Monat: 31.12.2024, 2. und 31.1.2025, 3.2.2025 → drei Monatskerzen
  const tage = [20088, 20090, 20119, 20122], k = { tag: tage, o: [1, 2, 3, 4], h: [1.5, 2.5, 3.5, 4.5], l: [0.5, 1.5, 2.5, 3.5], c: [1.2, 2.2, 3.2, 4.2] };
  const m = T.fasse(k, "monat");
  assert.deepEqual(m.tag, [20088, 20090, 20122]);
  assert.deepEqual(m.o, [1, 2, 4]); assert.deepEqual(m.c, [1.2, 3.2, 4.2]); assert.deepEqual(m.h, [1.5, 3.5, 4.5]); assert.deepEqual(m.l, [0.5, 1.5, 3.5]);
  assert.deepEqual(T.wochen(k).tag, T.fasse(k, "woche").tag);
  // Börse 9:30 bis 16:00 (Stundenkerzen 9:30 … 15:30), zwei Tage: je Tag eine 4h-Kerze ab 9:30 und eine ab 13:30
  const h = { tag: [], o: [], h: [], l: [], c: [] };
  [20000, 20001].forEach((d) => { for (let s = 0; s < 7; s++) { h.tag.push(d + (570 + s * 60) / 1440); h.o.push(10 + s); h.h.push(11 + s); h.l.push(9 + s); h.c.push(10.5 + s); } });
  const v = T.fasse(h, 240);
  assert.deepEqual(v.tag.map((t) => Math.round((t % 1) * 1440)), [570, 810, 570, 810]);
  assert.deepEqual(v.o, [10, 14, 10, 14]); assert.deepEqual(v.c, [13.5, 16.5, 13.5, 16.5]); assert.deepEqual(v.h, [14, 17, 14, 17]); assert.deepEqual(v.l, [9, 13, 9, 13]);
  // Rund um die Uhr (Devisen): eine fehlende Stunde verschiebt die Blöcke nicht, erst eine Pause über drei Stunden beginnt neu
  const fx = { tag: [], o: [], h: [], l: [], c: [] };
  [0, 1, 2, 3, 5, 6, 7, 8, 13 * 60, 14, 15].forEach((x, i) => { const st = x > 100 ? x / 60 : x; fx.tag.push(20000 + (22 * 60 + st * 60) / 1440); fx.o.push(i); fx.h.push(i); fx.l.push(i); fx.c.push(i); });
  assert.deepEqual(T.fasse(fx, 240).o, [0, 4, 7, 8]);  // Blöcke 22–2, 2–6, 6–10 Uhr, nach fünf Stunden Pause neu
});

test("Rückrechnung auf Minutenkerzen: Zeiten als Kommatage, senkrechte Linie mit Uhrzeit", () => {
  const k = kerzen([100, 100, 100, 101, 103, 104, 103, 105, 106, 108, 107, 109]);
  k.tag = k.tag.map((t, i) => 20000 + (870 + i * 5) / 1440);  // 5-Minuten-Kerzen ab 14:30 UTC
  const Z = T.pruefeZeichnungen([{ id: "L1", art: "linie", p: 102 }, { id: "V1", art: "senkrecht", t: 20000 + (870 + 12) / 1440 }]);
  const r = T.pruefe({ einstieg: [[{ typ: "kreuzt_ueber", ref: "L1" }, { typ: "nach", ref: "V1" }]], halten: 3 }, Z);
  const e = T.teste(k, Z, r, { kosten: 0 });
  assert.equal(e.trades.length, 1);
  assert.equal(e.trades[0].signal, 4);        // Kreuzen bei 103 um 14:50, nach V1 (14:42)
  assert.equal(e.trades[0].ein_i, 5);
  assert.equal(e.trades[0].grund, "zeit");     // drei Kerzen gehalten
  assert.ok(Math.abs(e.trades[0].tage * 1440 - 10) < 1e-6);  // 14:55 bis 15:05
  assert.equal(T.abTag(r, Z), Z[1].t);
});
