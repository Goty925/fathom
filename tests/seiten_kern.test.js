/* Tests für assets/seiten-kern.js: Alarme, Journal, Termine und Depot-Lage. */
const test = require("node:test");
const assert = require("node:assert/strict");
const K = require("../assets/seiten-kern.js");

const SLUGS = new Set(["sap-de", "msft"]);
const JETZT = new Date(2026, 9, 27, 10, 0).getTime();   // Di 27.10.2026, 10:00 Ortszeit

test("Alarm prüfen: ungültige Einträge fallen weg, Grenzen greifen", () => {
  assert.equal(K.alarmPruefen({ slug: "sap-de", art: "kurs_unter", wert: 180 }, SLUGS).wert, 180);
  assert.equal(K.alarmPruefen({ slug: "sap-de", art: "kurs_unter", wert: -5 }, SLUGS), null);        // Kurs muss positiv sein
  assert.equal(K.alarmPruefen({ slug: "fremd", art: "kurs_unter", wert: 1 }, SLUGS), null);
  assert.equal(K.alarmPruefen({ slug: "sap-de", art: "__proto__", wert: 1 }, SLUGS), null);
  assert.equal(K.alarmPruefen({ slug: "sap-de", art: "toString" }, SLUGS), null);
  assert.equal(K.alarmPruefen({ slug: "sap-de", art: "tag_minus", wert: 500 }, SLUGS).wert, 50);    // auf die Grenze gesetzt
  const t = K.alarmPruefen({ slug: "sap-de", art: "treffer", wert: "egal", notiz: "x".repeat(500) }, SLUGS);
  assert.equal(t.wert, null);
  assert.equal(t.notiz.length, 200);
  assert.equal(t.an, true);
});

test("Alarme: auslösen, quittieren, wieder scharf", () => {
  const a = K.alarmPruefen({ slug: "sap-de", art: "kurs_unter", wert: 180 }, SLUGS);
  const liste = [a];
  assert.deepEqual(K.auswerten(liste, { "sap-de": { kurs: 190 } }, 1), []);
  assert.equal(a.erfuellt, false);
  const neu = K.auswerten(liste, { "sap-de": { kurs: 175, waehrung: "EUR" } }, 2);
  assert.equal(neu.length, 1);
  assert.equal(a.ausgeloest, 2);
  assert.equal(K.offeneAlarme(liste).length, 1);
  assert.deepEqual(K.auswerten(liste, { "sap-de": { kurs: 170 } }, 3), []);   // bleibt ausgelöst, kein zweites Mal
  a.gesehen = true;
  assert.equal(K.offeneAlarme(liste).length, 0);
  K.auswerten(liste, { "sap-de": { kurs: 175 } }, 4);
  assert.equal(a.ausgeloest, 2);                                               // noch erfüllt: bleibt quittiert
  K.auswerten(liste, { "sap-de": { kurs: 185 } }, 5);
  assert.equal(a.ausgeloest, null);                                            // wieder scharf
  assert.equal(K.auswerten(liste, { "sap-de": { kurs: 179 } }, 6).length, 1);
  a.an = false; a.ausgeloest = null;
  assert.deepEqual(K.auswerten(liste, { "sap-de": { kurs: 100 } }, 7), []);    // pausiert
});

test("Alarm-Bedingungen je Art", () => {
  const p = (art, wert, l) => K.pruefe({ art, wert }, l);
  assert.equal(p("kurs_ueber", 200, { kurs: 201 }).erfuellt, true);
  assert.equal(p("tag_plus", 2, { kurs: 1, heute: 0.025 }).erfuellt, true);
  assert.equal(p("tag_minus", 2, { kurs: 1, heute: -0.019 }).erfuellt, false);
  assert.equal(p("tag_minus", 2, { kurs: 1, heute: null }).erfuellt, null);   // ohne Live-Kurse unbekannt
  assert.equal(p("abstand_hoch", 20, { kurs: 79, hoch: 100 }).erfuellt, true);
  assert.equal(p("treffer", null, { treffer: true }).erfuellt, true);
  assert.equal(p("kein_treffer", null, { treffer: true }).erfuellt, false);
  assert.equal(p("treffer", null, {}).erfuellt, null);
  assert.equal(p("downside", -20, { downside: -0.25 }).erfuellt, true);
  assert.equal(p("downside", -20, { downside: -0.15 }).erfuellt, false);
  assert.equal(p("zahlen", 3, { zahlenTage: 2 }).erfuellt, true);
  assert.equal(p("zahlen", 3, { zahlenTage: -1 }).erfuellt, false);
  assert.match(K.alarmText({ art: "kurs_unter", wert: 180 }, "SAP", { dez: 2, waehrung: "EUR" }), /^SAP: Kurs fällt unter 180,00 EUR$/);
  assert.match(K.alarmText({ art: "downside", wert: -20 }, "SAP"), /Downside schlechter als −20 %/);
});

test("Journal: Prüfen, Fälligkeit, Entwicklung seit dem Eintrag", () => {
  assert.equal(K.eintragPruefen({ text: "  " }, SLUGS), null);
  assert.equal(K.eintragPruefen({ slug: "fremd", text: "x" }, SLUGS), null);
  const e = K.eintragPruefen({ slug: "sap-de", text: "These", art: "constructor", wv: "2026-02-30x", kurs: "190", basis: 9, waehrung: "<b>" }, SLUGS);
  assert.equal(e.art, "beobachtung");
  assert.equal(e.wv, null);
  assert.equal(e.kurs, 190);
  assert.equal(e.basis, 5);            // begrenzt
  assert.equal(e.waehrung, "");
  const allg = K.eintragPruefen({ slug: "", text: "Allgemein", wv: "2026-10-26" }, SLUGS);
  assert.equal(allg.slug, null);
  const spaet = K.eintragPruefen({ text: "später", wv: "2026-11-30" }, SLUGS);
  const fertig = K.eintragPruefen({ text: "erledigt", wv: "2026-10-01", erledigt: true }, SLUGS);
  assert.deepEqual(K.faellig([allg, spaet, fertig], JETZT).map((x) => x.text), ["Allgemein"]);
  assert.ok(Math.abs(K.seitEintrag(e, 209) - 0.1) < 1e-12);
  assert.equal(K.tagText("2026-10-27", JETZT), "heute");
  assert.equal(K.tagText("2026-10-28", JETZT), "morgen");
  assert.equal(K.tagText("2026-10-24", JETZT), "vor 3 Tagen");
});

test("Termine: Kalender, Watchlist und Wiedervorlagen zusammen, sortiert", () => {
  const kalender = [
    { id: "a", art: "konjunktur", tag: "2026-10-28", t: Math.round(new Date(2026, 9, 28, 14, 30).getTime() / 6e4), titel: "CPI", wichtig: 3, land: "US" },
    { id: "b", art: "konjunktur", tag: "2026-10-28", t: null, titel: "Unwichtig", wichtig: 1 },
    { id: "c", art: "zahlen", tag: "2026-10-29", t: null, titel: "Quartalszahlen SAP", slug: "sap-de", wichtig: 2, werte: [{ id: "eps", prog: 2.1, vor: 2 }] },
    { id: "d", art: "notenbank", tag: "2026-12-30", titel: "Zu spät", wichtig: 3 },
    { id: "e", art: "konjunktur", tag: "2026-10-27", t: Math.round(new Date(2026, 9, 27, 6, 0).getTime() / 6e4), titel: "Vorbei", wichtig: 3 },
  ];
  const werte = { "sap-de": { name: "SAP", earnings: "2026-10-29" }, msft: { name: "Microsoft", earnings: "2026-11-03" } };
  const journal = [K.eintragPruefen({ slug: "msft", name: "Microsoft", text: "Prüfen", wv: "2026-10-20" }, SLUGS)];
  const l = K.termine({ kalender, werte, depot: new Set(["sap-de"]), journal }, JETZT, 21);
  assert.deepEqual(l.map((t) => t.titel), ["Wiedervorlage: Microsoft", "CPI", "Quartalszahlen SAP", "Quartalszahlen Microsoft"]);
  assert.equal(l[0].ueberfaellig, true);
  assert.equal(l[0].tag, "2026-10-27");                 // Überfälliges steht bei heute
  assert.equal(l[2].depot, true);
  assert.equal(l[2].erwartung.prog, 2.1);
  assert.equal(K.naechsterMeiner(l).titel, "Wiedervorlage: Microsoft");
  assert.equal(K.naechsterMeiner(l.filter((t) => !t.mein)).titel, "CPI");
});

test("Depot-Lage und kurze Euro-Beträge", () => {
  const L = K.depotLage([
    { slug: "a", typ: "aktie", w: 6000, heute: 0.02, woche: 0.05 },
    { slug: "b", typ: "etf", w: 4000, heute: null, woche: -0.01 },
    { slug: "c", typ: "aktie", w: null },
  ]);
  assert.equal(L.wert, 10000);
  assert.equal(L.n, 2);
  assert.ok(Math.abs(L.heute.euro - 6000 * 0.02 / 1.02) < 1e-9);
  assert.equal(L.heute.vollstaendig, false);
  assert.deepEqual(L.klassen.map((k) => [k.typ, k.anteil]), [["aktie", 0.6], ["etf", 0.4]]);
  assert.equal(K.format.euroKurz(9870), "9.870 €");
  assert.equal(K.format.euroKurz(123456), "123 T€");
  assert.equal(K.format.euroKurz(1234567), "1,2 Mio");
  assert.equal(K.format.euroKurz(-2500), "−2.500 €");
  assert.equal(K.depotLage([]).heute, null);
});

test("Trades: prüfen und Ergebnis in Euro", () => {
  assert.equal(K.tradePruefen({ datum: "2026-10-27", slug: "sap-de", stueck: 10 }, SLUGS), null);           // weder Kurse noch Ergebnis
  assert.equal(K.tradePruefen({ datum: "27.10.2026", instrument: "X", ergebnis: 5 }, SLUGS), null);         // Datum im ISO-Format
  assert.equal(K.tradePruefen({ datum: "2026-10-27", ergebnis: 5 }, SLUGS), null);                          // ohne Wert und ohne Namen
  const l = K.tradePruefen({ datum: "2026-10-27", slug: "sap-de", richtung: "long", stueck: "10", ein: "190", aus: "200,5", gebuehren: 2 }, SLUGS);
  assert.equal(K.tradeErgebnis(l), 103);
  const s = K.tradePruefen({ datum: "2026-10-27", instrument: "Nasdaq Short", richtung: "short", stueck: 2, ein: 100, aus: 110, waehrung: "usd", fx: 0.9 }, SLUGS);
  assert.equal(s.waehrung, "USD");
  assert.ok(Math.abs(K.tradeErgebnis(s) - -18) < 1e-9);
  const d = K.tradePruefen({ datum: "2026-10-28", instrument: "Knock-out", ergebnis: -40, gebuehren: 1, eroeffnet: "2026-10-29" }, SLUGS);
  assert.equal(K.tradeErgebnis(d), -41);
  assert.equal(d.eroeffnet, null);                                                                          // Eröffnung nach dem Schluss verworfen
  assert.ok(Math.abs(K.tradeRendite(l) - 103 / 1900) < 1e-12);
});

test("Depot-Verkäufe werden zu Trades (Durchschnittskosten)", () => {
  const tr = K.depotTrades([
    { datum: "2026-01-10", richtung: 1, stueck: 10, betrag: 1000, isin: "A", name: "Alpha" },
    { datum: "15.02.2026", richtung: 1, stueck: 10, betrag: 1200, isin: "A", name: "Alpha" },
    { datum: "2026-03-01", richtung: -1, stueck: 5, betrag: 650, isin: "A", name: "Alpha" },
    { datum: "2026-03-02", richtung: -1, stueck: 3, betrag: 300, isin: "B", name: "Ohne Kauf" },
    { datum: "2026-04-01", richtung: -1, stueck: 20, betrag: 2000, isin: "A", name: "Alpha" },
  ], (x) => (x.isin === "A" ? "sap-de" : null));
  assert.equal(tr.length, 2);
  assert.deepEqual([tr[0].datum, tr[0].slug, tr[0].eroeffnet], ["2026-03-01", "sap-de", "2026-01-10"]);
  assert.ok(Math.abs(K.tradeErgebnis(tr[0]) - (650 - 550)) < 1e-9);                     // Ø-Kosten 110 je Stück
  assert.equal(tr[1].stueck, 15);                                                       // nur der Bestand zählt
  assert.ok(Math.abs(K.tradeErgebnis(tr[1]) - (1500 - 1650)) < 1e-9);
});

test("Statistik und Monatskalender", () => {
  const t = (datum, ergebnis) => K.tradePruefen({ datum, instrument: "X", ergebnis }, SLUGS);
  const liste = [t("2026-10-01", 100), t("2026-10-01", -30), t("2026-10-05", -50), t("2026-10-26", 200), t("2026-09-30", 999)];
  const st = K.statistik(liste.slice(0, 4));
  assert.equal(st.netto, 220);
  assert.equal(st.quote, 0.5);
  assert.ok(Math.abs(st.profitFaktor - 300 / 80) < 1e-12);
  assert.deepEqual([st.handelstage, st.gruenTage, st.besterTag.tag, st.schlechtesterTag.tag], [3, 2, "2026-10-26", "2026-10-05"]);
  assert.equal(K.statistik([]).quote, null);
  const m = K.monatsKalender(liste, 2026, 9);
  assert.equal(m.wochen.length, 5);                                                     // Oktober 2026: Do 1. bis Sa 31.
  assert.equal(m.wochen[0].tage[0].iso, "2026-09-28");                                  // Montag zuerst
  assert.equal(m.wochen[0].tage[0].imMonat, false);
  assert.equal(m.wochen[0].tage[2].summe, 999);                                         // Vormonat im Raster sichtbar …
  assert.equal(m.wochen[0].summe, 70);                                                  // … zählt aber nicht zur Woche
  assert.deepEqual([m.statistik.n, m.statistik.netto], [4, 220]);
  const tag5 = m.wochen[1].tage.find((x) => x.iso === "2026-10-05");
  assert.deepEqual([tag5.summe, tag5.n], [-50, 1]);
});
