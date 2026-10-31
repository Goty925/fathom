// Tests für den Work-Modus-Kern: node --test tests/work_kern.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const W = require("../assets/work-kern.js");
const K = require("../assets/backtest-kern.js");

const WERTE = {
  msft: { symbol: "MSFT", finnhub: "MSFT", name: "Microsoft", typ: "aktie" },
  "sap-de": { symbol: "SAP.DE", name: "SAP", typ: "aktie" },
  crm: { symbol: "CRM", finnhub: "CRM", name: "Salesforce", typ: "aktie" },
  "2899-hk": { symbol: "2899.HK", name: "Zijin Mining", typ: "aktie" },
  "eurusd-x": { symbol: "EURUSD=X", name: "EUR/USD", typ: "forex" },
  "gc-f": { symbol: "GC=F", name: "Gold", typ: "rohstoff" },
  gdaxi: { symbol: "^GDAXI", name: "DAX", typ: "index" },
};
const M = W.muster(WERTE);

test("Kurzfassung: Ortsmarke weg, Titel nicht wiederholt, höchstens zwei Sätze", () => {
  const titel = "Fed holds rates steady, signals patience";
  const text = "WASHINGTON, Oct 28 (Reuters) - The Fed holds rates steady and signals patience. Officials said the U.S. economy remains solid. Inflation is still above 2%. More details later.";
  const k = W.kurzfassung(titel, text);
  assert.equal(k, "Officials said the U.S. economy remains solid. Inflation is still above 2%.");
  assert.equal(W.kurzfassung("Titel", "<p>Erster Satz &amp; mehr.</p>"), "Erster Satz & mehr.");
  assert.equal(W.kurzfassung("Gold steigt", ""), "");
  const lang = W.kurzfassung("x", "A".repeat(10) + " " + "wort ".repeat(80));
  assert.ok(lang.length <= 240 && lang.endsWith("…"));
});

test("Satzgrenzen: Abkürzungen, Zahlen und Initialen trennen nicht", () => {
  assert.deepEqual(W.saetze("Apple Inc. raised its target to $3.5 bn. J. Smith agreed. Next."), ["Apple Inc. raised its target to $3.5 bn.", "J. Smith agreed.", "Next."]);
});

test("Zuordnung zu Werten: Kürzel, Name, Alias, Währung", () => {
  const z = (titel, text = "", symbole = []) => W.zuordnen({ titel, text, symbole }, M).map((t) => t.slug + (t.direkt ? "" : "?"));
  assert.deepEqual(z("Microsoft beats estimates"), ["msft"]);
  assert.deepEqual(z("Cloud demand lifts results", "", ["MSFT"]), ["msft"]);
  assert.deepEqual(z("SAP raises outlook"), ["sap-de"]);
  assert.deepEqual(z("Sapphire rises"), []);                       // kein SAP in Sapphire
  assert.deepEqual(z("CRM software market grows"), []);            // Abkürzung CRM ist nicht Salesforce
  assert.deepEqual(z("Salesforce (NYSE:CRM) jumps"), ["crm"]);
  assert.deepEqual(z("Zijin lifts copper output"), ["2899-hk"]);
  assert.deepEqual(z("Goldman Sachs hires"), []);                  // nicht Gold
  assert.deepEqual(z("Gold hits record"), ["gc-f?"]);
  assert.deepEqual(z("ECB keeps rates on hold"), ["eurusd-x?"]);
  assert.deepEqual(z("EUR/USD slips below 1.08"), ["eurusd-x"]);
  assert.deepEqual(z("DAX fällt"), ["gdaxi?"]);
});

test("Thema, Gewicht und Tendenz", () => {
  const e = (titel, extra = {}) => W.aufbereiten(Object.assign({ titel, text: "", quelle: "Blog" }, extra), M);
  assert.equal(e("Fed raises rates by 25 basis points").thema, "notenbank");
  assert.equal(e("Fed raises rates by 25 basis points").gewicht, 2);
  assert.equal(e("FOMC statement", { herkunft: "fed", quelle: "Federal Reserve" }).gewicht, 3);
  assert.equal(e("Microsoft beats estimates, raises guidance", { quelle: "Reuters" }).gewicht, 3);
  assert.equal(e("Ten tips for retirement").gewicht, 1);
  assert.equal(e("Oil prices climb as OPEC+ trims output").thema, "rohstoffe");
  assert.equal(e("Microsoft beats estimates").tendenz, 1);
  assert.equal(e("Nvidia shares plunge after warning").tendenz, -1);
  assert.equal(e("Market wrap").tendenz, 0);
  const l = W.lage([e("Microsoft beats estimates", { t: 2000 }), e("Microsoft jumps", { t: 2000 }), e("Gold rises", { t: 2000 }), e("alt", { t: 1 })], 1000 * 1000, { msft: "Microsoft" });
  assert.equal(l.n, 3); assert.equal(l.top[0].slug, "msft"); assert.equal(l.top[0].n, 2); assert.equal(l.tonText, "eher positiv");
});

test("Statistik: Renditen, Volatilität, Rückgang, Beta", () => {
  const liste = [], markt = [];
  let p = 100, q = 100;
  for (let i = 0; i < 800; i++) {
    const d = new Date(Date.UTC(2023, 0, 2) + i * 864e5);
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    const m = Math.sin(i * 0.7) * 0.01;
    q *= 1 + m; p *= 1 + 2 * m;
    liste.push({ date: d.toISOString().slice(0, 10), close: p }); markt.push({ date: d.toISOString().slice(0, 10), close: q });
  }
  const r = W.reihe(liste), mk = W.reihe(markt);
  const re = W.renditen(r);
  assert.ok(Math.abs(re["1W"] - (r.c[r.n - 1] / W.wertAm(r, r.t[r.n - 1] - 7) - 1)) < 1e-12);
  assert.equal(re["3J"], undefined);                                // zu kurze Reihe
  const bk = W.betaKorr(r, mk);
  assert.ok(Math.abs(bk.beta - 2) < 0.05 && bk.korr > 0.99, JSON.stringify(bk));
  assert.ok(W.volatilitaet(r) > W.volatilitaet(mk) * 1.9);
  const flach = W.reihe([{ date: "2024-01-01", close: 100 }, { date: "2024-01-02", close: 120 }, { date: "2024-01-03", close: 90 }, { date: "2024-01-04", close: 110 }]);
  const md = W.maxRueckgang(flach);
  assert.ok(Math.abs(md.tiefe - (90 / 120 - 1)) < 1e-12);
  assert.equal(W.sigma(0.01, 0.16), 0.01 / (0.16 / Math.sqrt(252)));
  const km = W.korrelationen([r, mk, null]);
  assert.equal(km[0][0], 1); assert.equal(km[2][0], null); assert.ok(km[0][1] > 0.99);
});

test("Börsenzeiten: offen, Mittagspause, geschlossen; Forex am Wochenende zu", () => {
  const ny = W.BOERSEN.find((b) => b.id === "ny"), tyo = W.BOERSEN.find((b) => b.id === "tyo");
  // Mittwoch, 21.10.2026, 15:00 UTC = 11:00 New York
  const mi = Date.UTC(2026, 9, 21, 15, 0);
  const s = W.boersenStatus(ny, mi);
  assert.equal(s.offen, true); assert.equal(s.ort, "11:00"); assert.equal(s.wechselMs, 5 * 3600e3);
  // 03:00 UTC = 12:00 Tokio: Mittagspause, öffnet 12:30
  const p = W.boersenStatus(tyo, Date.UTC(2026, 9, 21, 3, 0));
  assert.equal(p.offen, false); assert.equal(p.pause, true); assert.equal(p.wechselMs, 30 * 6e4);
  // Samstag: New York zu bis Montag 9:30
  const sa = W.boersenStatus(ny, Date.UTC(2026, 9, 24, 14, 0)); // Sa 10:00 NY
  assert.equal(sa.offen, false); assert.equal(sa.pause, false); assert.equal(sa.wechselMs, (2 * 1440 - 30) * 6e4);
  assert.equal(W.boersenStatus(W.FOREX, Date.UTC(2026, 9, 24, 14, 0)).offen, false);
  assert.equal(W.boersenStatus(W.FOREX, Date.UTC(2026, 9, 21, 14, 0)).offen, true);
  assert.equal(W.dauer(90061e3), "1 T 01:01:01"); assert.equal(W.dauer(61e3), "01:01"); assert.equal(W.alter(5 * 6e4), "vor 5 Min.");
});

test("Kalender: Überraschung mit Richtung, nächster Termin, Demo auf aktuelle Woche", () => {
  assert.deepEqual(W.ueberraschung({ ist: 3.1, prog: 2.9, vor: 3.0, gut: 1, dez: 1 }), { diff: 3.1 - 2.9, bezug: "prog", ton: 1 });
  assert.equal(W.ueberraschung({ ist: 4.4, prog: null, vor: 4.3, gut: -1, dez: 1 }).ton, -1); // Arbeitslosenquote höher: schlecht
  assert.equal(W.ueberraschung({ ist: 2.9, prog: 2.9, vor: 3, gut: 1, dez: 1 }).ton, 0);
  assert.equal(W.ueberraschung({ ist: null, prog: 1 }), null);
  const t = [{ t: 100, wichtig: 3 }, { t: 50, wichtig: 3 }, { t: 60, wichtig: 1 }, { t: null, wichtig: 3 }];
  assert.equal(W.naechster(t, 55).t, 100);
  const kal = { demo: true, heute: "2026-10-18", termine: [{ tag: "2026-10-21", t: 29856000 }] };
  const neu = W.demoVerschieben(kal, Date.UTC(2026, 11, 2, 12)); // sieben Wochen später, Mittwoch
  assert.equal(neu.termine[0].tag, "2026-12-09"); assert.equal(neu.termine[0].t, 29856000 + 49 * 1440);
  assert.equal(new Date(Date.parse(neu.termine[0].tag)).getUTCDay(), 3);
});

test("Marktreaktion: Tageskurse als Rückfall", () => {
  const tage = [], c = [];
  for (let d = 20000; tage.length < 10; d++) if (K.wochentag(d) >= 1 && K.wochentag(d) <= 5) tage.push(d);
  tage.forEach((_, i) => c.push(100 + i));
  const w = K.dekodiere({ s: "X", n: "X", t: "index", d0: tage[0], dd: tage.slice(1).map((t, i) => t - tage[i]), c, o: c.map(() => 0), h: c.map(() => 0), l: c.map(() => 0) });
  const r = W.reaktion(K, w, [{ t: tage[5] * 1440 + 900, ueb: 0.2 }]);
  assert.equal(r[0].aufl, "tag"); assert.ok(Math.abs(r[0].tag - (105 / 104 - 1)) < 1e-12);
});

test("Demo-Meldungen sind als Demo gekennzeichnet", () => {
  const rnd = W.zufall(7);
  const m = W.demoMeldung(1, [{ name: "Microsoft", finnhub: "MSFT", symbol: "MSFT" }], Date.now(), rnd);
  assert.match(m.quelle, /^Demo/); assert.match(m.text, /Beispieltext/);
});

test("News-Feed: Währungs-Tags, Art, Bündeln, Heiß-Rang, Eilmeldung", () => {
  const werte = Object.assign({}, WERTE, { msft: Object.assign({ waehrung: "USD" }, WERTE.msft) });
  const e = (titel, extra = {}) => W.aufbereiten(Object.assign({ titel, text: "", quelle: "Reuters", t: 1000000, id: titel }, extra), M, werte);
  assert.deepEqual(e("ECB holds rates, euro slips").tags, ["EUR"]);
  assert.deepEqual(e("EUR/USD slips below 1.08").tags, ["EUR", "USD"]);
  assert.deepEqual(e("Microsoft beats estimates").tags, ["USD"]);
  assert.equal(e("Week ahead: CPI in focus").art, "analyse");
  assert.equal(e("FOMC statement", { herkunft: "fed" }).art, "offiziell");
  assert.equal(e("Gold rises").art, "nachricht");
  const liste = [
    e("Microsoft beats estimates as cloud revenue jumps", { id: "a", t: 1000000, quelle: "Reuters" }),
    e("Microsoft cloud revenue jumps, beats estimates", { id: "b", t: 1000600, quelle: "CNBC" }),
    e("Gold climbs to record high", { id: "c", t: 1000300, quelle: "MarketWatch" }),
    e("Microsoft beats estimates as cloud revenue jumps", { id: "d", t: 1000000 + 10 * 3600, quelle: "Blog" }), // zu spät: eigene Geschichte
  ];
  const b = W.buendeln(liste);
  assert.equal(b.length, 3);
  const ms = b.find((x) => x.alle.length === 2);
  assert.deepEqual(ms.quellen.sort(), ["CNBC", "Reuters"]); assert.equal(ms.t, 1000600);
  const gold = b.find((x) => x.kopf.id === "c");
  assert.ok(W.heiss(ms, 1000600) > W.heiss(gold, 1000600)); // zwei Quellen und eigener Wert
  assert.ok(W.heiss(ms, 1000600 + 8 * 3600) < W.heiss(ms, 1000600) / 3.9); // nach acht Stunden ein Viertel
  assert.equal(W.eil({ gewicht: 3, t: 1000 }, 1000 + 20 * 60), true);
  assert.equal(W.eil({ gewicht: 3, t: 1000 }, 1000 + 40 * 60), false);
});

test("Handelssitzungen in deutscher Zeit, mit Sommerzeit und Wochenende", () => {
  const h = (x) => Math.round((x / 60) * 10) / 10;
  const mi = W.sitzungen(Date.UTC(2026, 9, 21, 12, 0)); // Mittwoch, Berlin und London noch Sommerzeit
  const ld = mi.find((s) => s.id === "ldn"), ny = mi.find((s) => s.id === "ny"), syd = mi.find((s) => s.id === "syd");
  assert.deepEqual(ld.teile.map((t) => t.map(h)), [[9, 18]]);
  assert.deepEqual(ny.teile.map((t) => t.map(h)), [[14, 23]]);
  assert.deepEqual(syd.teile.map((t) => t.map(h)), [[0, 8], [23, 24]]);
  assert.equal(ld.offen, true); assert.equal(syd.offen, false);
  // 28.10.: Europa schon Winterzeit, New York noch Sommerzeit → New York 13 bis 22 Uhr deutscher Zeit
  assert.deepEqual(W.sitzungen(Date.UTC(2026, 9, 28, 12, 0)).find((s) => s.id === "ny").teile.map((t) => t.map(h)), [[13, 22]]);
  // Samstag: keine Sitzung in Europa und Amerika
  const sa = W.sitzungen(Date.UTC(2026, 9, 24, 12, 0));
  assert.equal(sa.find((s) => s.id === "ldn").teile.length, 0);
  assert.equal(sa.find((s) => s.id === "ny").teile.length, 0);
});

test("Deutsche Wörter mit Umlaut am Anfang werden erkannt", () => {
  const e = (titel) => W.aufbereiten({ titel, text: "", quelle: "X" }, M, WERTE);
  assert.equal(e("SAP kündigt Übernahme an").gewicht, 3);
  assert.equal(e("Ölpreis steigt kräftig").thema, "rohstoffe");
  assert.equal(e("Gewinnwarnung bei SAP").thema, "unternehmen");
  assert.equal(e("Gewinnwarnung bei SAP").tendenz, -1);
});

test("Bündeln: verschiedene Unternehmen mit gleichem Satzbau bleiben getrennt", () => {
  const e = (titel, id, t) => W.aufbereiten({ titel, text: "", quelle: id, t, id }, M, WERTE);
  const b = W.buendeln([e("Salesforce kündigt Übernahme an", "a", 1000), e("Microsoft kündigt Übernahme an", "b", 1100),
    e("Microsoft kündigt Übernahme an – Bericht", "c", 1200), e("Gold steigt", "d", 1300), e("Silber steigt", "e", 1400)]);
  assert.deepEqual(b.map((x) => x.alle.map((y) => y.id).sort().join("")).sort(), ["a", "bc", "d", "e"]);
});

test("Sicherheit: nur http(s)-Links aus Nachrichten", () => {
  assert.equal(W.sichereUrl("javascript:alert(1)"), "");
  assert.equal(W.sichereUrl("JaVaScRiPt:alert(1)"), "");
  assert.equal(W.sichereUrl("data:text/html,<script>"), "");
  assert.equal(W.sichereUrl('https://x.example/" onmouseover="a'), "");
  assert.equal(W.sichereUrl("https://www.federalreserve.gov/a.htm"), "https://www.federalreserve.gov/a.htm");
  const a = W.aufbereiten({ id: "1", t: 1, titel: "Fed hält Zinsen", text: "", url: "javascript:alert(1)", symbole: [] }, [], {});
  assert.equal(a.url, "");
});
