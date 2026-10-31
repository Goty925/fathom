// Tests für den Setup-Lab-Kern (assets/setup-kern.js): node --test tests/setup_kern.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../assets/setup-kern.js");
const K = require("../assets/backtest-kern.js");

const JETZT = Date.UTC(2026, 9, 28, 12, 0);
const REGEL = { klasse: "aktie", wert: "", werte: ["SAP.DE", "MSFT"], jahre: 10, params: { kgv_max: 25 },
  fakten: [{ typ: "wochentag", tag: "1" }, { typ: "tp", wert: 2, bezug: "kurs" }, { typ: "halten", tage: 10, einheit: "tage" }] };
const VERSION = { regel: REGEL, worte: "Long zur Eröffnung …", daten: { stand: "2026-10-26", demo: false },
  ergebnis: { n: 40, offen: 1, quote: 0.6, mittel: 0.004, sd: 0.02 } };

test("Speicher prüfen: Ungültiges fällt weg, Texte werden gekürzt, Doppelte entfernt", () => {
  const roh = { liste: [
    { id: "sabcdef12", name: "A".repeat(300), these: "Zeile 1\u0000\n\n\n\nZeile 2", versionen: [Object.assign({ nr: 1, zeit: JETZT }, VERSION)] },
    { id: "sabcdef12", name: "Doppelt", versionen: [Object.assign({ nr: 1, zeit: JETZT }, VERSION)] },
    { id: "../x", name: "böse Id", versionen: [Object.assign({ nr: 1, zeit: JETZT }, VERSION)] },
    { id: "sohneversion", name: "leer", versionen: [] },
    { id: "skaputtregel", name: "Regel", versionen: [{ nr: 1, zeit: JETZT, regel: { klasse: "anleihe", fakten: [] } }] },
    "kein Objekt", null,
  ] };
  const sp = S.pruefeSpeicher(roh);
  assert.equal(sp.liste.length, 1);
  assert.equal(sp.liste[0].name.length, S.GRENZEN.name);
  assert.equal(sp.liste[0].these, "Zeile 1 \n\nZeile 2");
  assert.deepEqual(S.pruefeSpeicher("Unsinn"), { v: 1, liste: [] });
  assert.deepEqual(S.pruefeSpeicher({ liste: { length: 3 } }), { v: 1, liste: [] });
});

test("Regel prüfen: nur bekannte Klassen, gültige Kürzel, flache Fakten und Zahlen-Schwellen", () => {
  const r = S.pruefeRegel({ klasse: "aktie", wert: "<script>", werte: ["SAP.DE", "x y", "SAP.DE"], jahre: 99,
    fakten: [{ typ: "tp", wert: 2, boese: { tief: 1 }, "__proto__": 1 }, { typ: "Böse!" }, { typ: "kriterium", name: "x".repeat(500) }],
    params: { a: 1, b: "zwei", c: Infinity, "d e": 3 } });
  assert.equal(r.wert, "");
  assert.deepEqual(r.werte, ["SAP.DE"]);
  assert.equal(r.jahre, 10);
  assert.equal(r.fakten.length, 2);
  assert.deepEqual(r.fakten[0], { typ: "tp", wert: 2 });
  assert.equal(r.fakten[1].name.length, 120);
  assert.deepEqual(r.params, { a: 1 });
  assert.equal(S.pruefeRegel({ klasse: "aktie" }), null);
  // Extra-Wert nur, wenn er der gewählte Wert ist
  assert.equal(S.pruefeRegel(Object.assign({}, REGEL, { wert: "ALV.DE", extra: { s: "ALV.DE", n: "Allianz", t: "aktie" } })).extra.n, "Allianz");
  assert.equal(S.pruefeRegel(Object.assign({}, REGEL, { wert: "", extra: { s: "ALV.DE", n: "Allianz", t: "aktie" } })).extra, null);
});

test("Signatur: Schlüsselreihenfolge egal, Fakten und Werte nicht; Schwellen nur mit Fathom-Signal", () => {
  const a = S.signatur(REGEL);
  const b = S.signatur({ jahre: 10, fakten: [{ tag: "1", typ: "wochentag" }, { bezug: "kurs", wert: 2, typ: "tp" }, { typ: "halten", einheit: "tage", tage: 10 }],
    werte: ["MSFT", "SAP.DE"], wert: "", klasse: "aktie", params: { kgv_max: 99 } });
  assert.equal(a, b);  // ohne Fathom-Signal spielen die Schwellen keine Rolle
  assert.notEqual(a, S.signatur(Object.assign({}, REGEL, { jahre: 5 })));
  assert.notEqual(a, S.signatur(Object.assign({}, REGEL, { werte: ["SAP.DE"] })));
  const mitSignal = Object.assign({}, REGEL, { fakten: [...REGEL.fakten, { typ: "kriterium", name: "KGV", soll: "ja" }] });
  assert.notEqual(S.signatur(mitSignal), S.signatur(Object.assign({}, mitSignal, { params: { kgv_max: 30 } })));
});

test("Anlegen, neue Version nur bei geänderten Regeln, Grenzen", () => {
  let r = S.anlegen({ v: 1, liste: [] }, { name: "  " }, VERSION, JETZT);
  assert.match(r.fehler, /Namen/);
  r = S.anlegen({ v: 1, liste: [] }, { name: "Montags-Drift", these: "Montags kaufen lohnt sich" }, VERSION, JETZT);
  assert.equal(r.setup.versionen.length, 1);
  assert.equal(r.setup.versionen[0].nr, 1);
  assert.equal(r.setup.versionen[0].zeit, JETZT);
  const id = r.setup.id;
  let sp = r.speicher;
  const gleich = S.versionHinzu(sp, id, VERSION, JETZT + 1000);
  assert.equal(gleich.gleich, 1);
  assert.match(gleich.fehler, /schon als v1/);
  const v2 = S.versionHinzu(sp, id, Object.assign({}, VERSION, { regel: Object.assign({}, REGEL, { jahre: 5 }), notiz: "kürzer" }), JETZT + 2000);
  assert.equal(v2.version.nr, 2);
  assert.equal(v2.setup.versionen[0].regel.jahre, 10);  // alte Version bleibt unverändert
  sp = v2.speicher;
  // Grenze Versionen
  let s = sp;
  for (let j = 3; j <= S.GRENZEN.versionen; j++) s = S.versionHinzu(s, id, Object.assign({}, VERSION, { regel: Object.assign({}, REGEL, { werte: [`W${j}`] }) }), JETZT + j).speicher;
  const voll = S.versionHinzu(s, id, Object.assign({}, VERSION, { regel: Object.assign({}, REGEL, { werte: ["ZZ"] }) }), JETZT + 99);
  assert.match(voll.fehler, /Höchstens 20 Versionen/);
  // Grenze Setups
  let viele = { v: 1, liste: [] };
  for (let j = 0; j < S.GRENZEN.setups; j++) viele = S.anlegen(viele, { name: `S${j}` }, VERSION, JETZT + j).speicher;
  assert.match(S.anlegen(viele, { name: "eins zu viel" }, VERSION, JETZT).fehler, /Höchstens 50/);
});

test("Texte ändern ohne neue Version, Entfernen, Vermerken für lokale Metriken", () => {
  const { speicher, setup } = S.anlegen({ v: 1, liste: [] }, { name: "A" }, VERSION, JETZT);
  const t = S.textAendern(speicher, setup.id, { these: "neu\u2028zeile", widerlegt: "Ø Trade unter 0" }, JETZT + 1);
  assert.equal(t.speicher.liste[0].these, "neu\nzeile");
  assert.equal(t.speicher.liste[0].versionen.length, 1);
  assert.match(S.textAendern(speicher, setup.id, { name: "" }, JETZT).fehler, /Name/);
  let sp = S.vermerken(t.speicher, setup.id, "geoeffnet", JETZT + 2);
  sp = S.vermerken(sp, setup.id, "geprueft", JETZT + 8 * 864e5, 1, { zeit: JETZT + 8 * 864e5, stand: "2026-11-02", n: 3, quote: 2 / 3, mittel: 0.01, summe: 0.03, art: "zu_wenig" });
  const s = sp.liste[0];
  assert.equal(s.geoeffnet, 1);
  assert.equal(s.proben, 1);
  assert.equal(s.versionen[0].probe.n, 3);
  const m = S.metriken(sp, JETZT + 9 * 864e5);
  assert.deepEqual(m, { setups: 1, versionen: 1, mitMehrerenVersionen: 0, geoeffnet: 1, proben: 1, wiederkehr7Tage: 1, mitNeuenTrades: 1, erstesSetupVorTagen: 9 });
  assert.ok(!JSON.stringify(m).includes("A"));  // keine Namen oder Regeln
  assert.equal(S.entfernen(sp, setup.id).liste.length, 0);
});

test("Kennzahlen: nur abgeschlossene Trades, Profit-Faktor ohne Verluste ist null, keine Fantasiewerte", () => {
  assert.deepEqual(S.kennzahlen([]).n, 0);
  assert.equal(S.kennzahlen([]).quote, null);
  const k = S.kennzahlen([{ netto: 0.02, grund: "ziel" }, { netto: -0.01, grund: "stop" }, { netto: 0.03, grund: "zeit" }, { netto: 0.5, grund: "offen" }, { netto: NaN }]);
  assert.equal(k.n, 3);
  assert.equal(k.offen, 1);
  assert.ok(Math.abs(k.quote - 2 / 3) < 1e-12);
  assert.ok(Math.abs(k.mittel - 0.04 / 3) < 1e-12);
  assert.ok(Math.abs(k.faktor - 5) < 1e-12);
  assert.ok(Math.abs(k.summe - 0.04) < 1e-12);
  assert.equal(S.kennzahlen([{ netto: 0.01, grund: "ziel" }]).faktor, null);
  assert.equal(S.kennzahlen([{ netto: 0.01, grund: "ziel" }]).sd, null);
});

test("Stichprobe und Vergleich: erst ab 10 neuen Trades, Abweichung über den Standardfehler", () => {
  assert.equal(S.stichprobe(0).art, "keine");
  assert.equal(S.stichprobe(9).art, "sehr_klein");
  assert.equal(S.stichprobe(29).art, "klein");
  assert.equal(S.stichprobe(30).art, "brauchbar");
  const bt = { n: 100, mittel: 0.01, sd: 0.02 };
  assert.deepEqual(S.vergleich(bt, { n: 0 }), { art: "keine", fehlen: 10, z: null });
  assert.equal(S.vergleich(bt, { n: 9, mittel: -0.5 }).art, "zu_wenig");
  assert.equal(S.vergleich(bt, { n: 16, mittel: 0.005 }).art, "im_rahmen");     // z = −1
  assert.equal(S.vergleich(bt, { n: 16, mittel: -0.001 }).art, "schlechter");   // z = −2,2
  assert.equal(S.vergleich(bt, { n: 16, mittel: 0.025 }).art, "besser");        // z = 3
  assert.equal(S.vergleich({ n: 1, mittel: 0.01, sd: null }, { n: 12, mittel: 0 }).art, "ohne_streuung");
  assert.equal(S.datenGeaendert({ n: 10, mittel: 0.01 }, { n: 10, mittel: 0.01 }), false);
  assert.equal(S.datenGeaendert({ n: 10, mittel: 0.01 }, { n: 11, mittel: 0.01 }), true);
  assert.equal(S.datenGeaendert({ n: 10, mittel: 0.01 }, { n: 10, mittel: 0.0102 }), true);
});

test("Änderungen in Worten: neu, entfernt, geändert, Markt und Zeitraum", () => {
  const satz = (f) => `${f.typ}${f.wert != null ? " " + f.wert : ""}`;
  const neu = Object.assign({}, REGEL, { jahre: 5, fakten: [{ typ: "wochentag", tag: "1" }, { typ: "tp", wert: 3, bezug: "kurs" }, { typ: "sl", wert: 2, bezug: "kurs" }] });
  assert.deepEqual(S.aenderungen(REGEL, neu, satz), ["Zeitraum: 10 → 5 Jahre", "geändert: tp 2 → tp 3", "entfernt: halten", "neu: sl 2"]);
  assert.deepEqual(S.aenderungen(REGEL, REGEL, satz), []);
  assert.deepEqual(S.aenderungen(REGEL, Object.assign({}, REGEL, { wert: "SAP.DE" }), satz, (w) => w || "alle"), ["Markt: alle → SAP.DE"]);
});

// ---------------------------------------------------------------- Mit dem echten Backtest-Kern

function wert(n, seed) {
  // Zufallspfad mit festem Startwert, Mo–Fr ab 2024-01-01
  let x = seed;
  const zufall = () => { x = (x * 16807) % 2147483647; return x / 2147483647; };
  const d0 = 19723, tage = [];
  for (let t = d0; tage.length < n; t++) if (K.wochentag(t) >= 1 && K.wochentag(t) <= 5) tage.push(t);
  const c = [100];
  for (let i = 1; i < n; i++) c.push(c[i - 1] * (1 + (zufall() - 0.5) * 0.04));
  const bp = (f) => c.map(() => Math.round(f() * 1e4));
  return { s: "T", n: "Test", t: "aktie", d0, dd: tage.slice(1).map((t, i) => t - tage[i]), c,
           o: bp(() => (zufall() - 0.5) * 0.01), h: bp(() => 0.012 + zufall() * 0.01), l: bp(() => -0.012 - zufall() * 0.01) };
}
function abschneiden(roh, n) {
  return Object.assign({}, roh, { dd: roh.dd.slice(0, n - 1), c: roh.c.slice(0, n), o: roh.o.slice(0, n), h: roh.h.slice(0, n), l: roh.l.slice(0, n) });
}
const FAKTEN = [{ typ: "rendite", tage: 5, r: "<=", wert: -1 }, { typ: "tp", wert: 3, bezug: "kurs" }, { typ: "sl", wert: 2, bezug: "kurs" },
  { typ: "halten", tage: 8, einheit: "tage" }, { typ: "kosten", wert: 0.05 }];

test("Bewährungsprobe ohne Blick in die Zukunft: Trades vor dem Stichtag hängen nicht von späteren Kursen ab", () => {
  const roh = wert(400, 42), stichI = 300;
  const heute = K.dekodiere(roh), damals = K.dekodiere(abschneiden(roh, stichI + 1));
  // Gespeichert am Abend des Tages stichI (Daten bis einschließlich dieses Schlusses)
  const stichMin = K.ende(damals, stichI);
  const opt = { jahre: 10, katalog: [], params: {} };
  const rDamals = K.rechne([damals], FAKTEN, opt), rHeute = K.rechne([heute], FAKTEN, opt);
  const { vorher, nachher } = S.teile(rHeute.trades, stichMin);
  // Gleiche Einstiege vor dem Stichtag, in beiden Läufen. Einzige Ausnahme: ein Einstieg zur Eröffnung des letzten
  // Tages vor dem Speichern. Damals fehlte jeder Kurs danach, darum hat ihn der Backtest nicht gezeigt; er zählt
  // trotzdem nicht als neu, weil er vor dem Speichern eröffnet wurde.
  const letzterTag = K.beginn(damals, stichI);
  assert.deepEqual(vorher.filter((t) => t.einMin < letzterTag).map((t) => t.einMin), rDamals.trades.map((t) => t.einMin));
  assert.ok(vorher.filter((t) => t.einMin >= letzterTag).length <= 1);
  // Alles, was damals schon abgeschlossen war, ist heute identisch
  rDamals.trades.filter((t) => t.grund !== "offen").forEach((t, i) => {
    assert.equal(vorher[i].ausMin, t.ausMin);
    assert.ok(Math.abs(vorher[i].netto - t.netto) < 1e-12);
  });
  // Neue Trades beginnen erst nach dem Stichtag
  assert.ok(nachher.length > 0);
  assert.ok(nachher.every((t) => t.einMin >= stichMin));
  // Die gespeicherte Momentaufnahme stimmt mit der Nachrechnung des Backtest-Teils überein
  const damalsK = S.zusammenfassung(rDamals), heuteVorher = S.kennzahlen(S.nachgerechnet(vorher, rDamals.bis));
  assert.equal(S.datenGeaendert(damalsK, heuteVorher), false);
  assert.ok(damalsK.n > 10 && damalsK.rueckgang <= 0 && damalsK.kostenEuro > 0);
  assert.equal(heuteVorher.n, damalsK.n);
  // Geänderte Kurse im Backtest-Teil (z. B. Split-Bereinigung) fallen auf
  const roh2 = wert(400, 42); roh2.c = roh2.c.map((c, i) => (i > 100 && i < 120 ? c * 0.97 : c));
  const geaendert = S.teile(K.rechne([K.dekodiere(roh2)], FAKTEN, opt).trades, stichMin).vorher;
  assert.equal(S.datenGeaendert(damalsK, S.kennzahlen(S.nachgerechnet(geaendert, rDamals.bis))), true);
});

test("Momentaufnahme enthält nur berechenbare Felder", () => {
  const r = K.rechne([K.dekodiere(wert(300, 7))], FAKTEN, { jahre: 10, katalog: [], params: {} });
  const z = S.zusammenfassung(r);
  assert.deepEqual(Object.keys(z).sort(), ["bester", "bis", "ende", "faktor", "finanzEuro", "gesamt", "hebel", "jaehrlich", "kostenEuro", "median",
    "mittel", "mittelGewinn", "mittelVerlust", "n", "offen", "quote", "rueckgang", "schlechtester", "sd", "start", "summe", "t", "von"].sort());
  assert.equal(z.n + z.offen, r.trades.length);
  assert.equal(S.zusammenfassung(null), null);
  assert.equal(S.jahreAb(100, 100), null);
  assert.ok(Math.abs(S.jahreAb(0, 365.25 * 3) - 3) < 1e-12);
});

// ---------------------------------------------------------------- Chart-Taktik als Setup
const TAKTIK = { wert: "SAP.DE", wertName: "SAP", typ: "aktie", ebene: "tag", kosten: 0.0005, nurDanach: true, text: "Kaufe, wenn der Kurs über L1 schließt.",
  zeichnungen: [{ id: "L1", art: "linie", p: 180, name: "Widerstand" }], indikatoren: [{ art: "rsi", n: 14 }],
  regeln: { richtung: "long", einstieg: [[{ typ: "kreuzt_ueber", ref: "L1" }]], filter: [], stop: { art: "prozent", wert: 0.02 }, ziel: null, ausstieg: [], halten: null, zeitpunkt: "eroeffnung" } };
const TV = { art: "taktik", taktik: TAKTIK, worte: "Long …", daten: { stand: "2026-10-26", demo: false }, ergebnis: { n: 12, quote: 0.5, mittel: 0.01, sd: 0.03 } };

test("Chart-Taktik: prüfen, säubern, Prototyp-Schlüssel verwerfen", () => {
  const roh = JSON.parse(JSON.stringify(TAKTIK));
  // wie aus einer manipulierten Sicherung: "__proto__" als eigener Schlüssel (JSON.parse legt ihn so an)
  roh.zeichnungen.push(JSON.parse(`{"id": "Z1", "art": "zone", "name": "${"x".repeat(500)}", "__proto__": {"boese": true}, "tief": {"tiefer": {"noch": {"tiefer": 1}}}}`));
  roh.regeln = Object.assign(JSON.parse('{"constructor": {"x": 1}}'), roh.regeln);
  roh.kosten = 0.3; roh.ebene = "jahr"; roh.wert = "SAP.DE";
  const v = S.pruefeVersion(Object.assign({ nr: 1, zeit: JETZT }, TV, { taktik: roh }));
  assert.equal(v.art, "taktik");
  assert.equal(v.regel, null);
  assert.equal(v.taktik.kosten, 0.0005);
  assert.equal(v.taktik.ebene, "tag");
  assert.equal(v.taktik.zeichnungen[1].name.length, 200);
  assert.ok(!Object.prototype.hasOwnProperty.call(v.taktik.zeichnungen[1], "__proto__"));
  assert.equal(({}).boese, undefined);
  assert.ok(!Object.keys(v.taktik.regeln).includes("constructor"));
  assert.equal(Object.getPrototypeOf(v.taktik.zeichnungen[1]), Object.prototype);
  assert.deepEqual(v.taktik.zeichnungen[1].tief, {});   // Tiefe begrenzt (Punkte wie a: { t, p } bleiben erhalten)
  assert.equal(S.pruefeVersion(Object.assign({ nr: 1, zeit: JETZT }, TV, { taktik: Object.assign({}, TAKTIK, { wert: "<x>" }) })), null);
});

test("Chart-Taktik: Signatur ohne Text und Indikatoren, keine Mischung mit Fakten, Änderungen in Worten", () => {
  const { speicher, setup } = S.anlegen({ v: 1, liste: [] }, { name: "Ausbruch SAP" }, TV, JETZT);
  assert.equal(setup.versionen[0].art, "taktik");
  const nurText = Object.assign({}, TV, { taktik: Object.assign({}, TAKTIK, { text: "Anders formuliert", indikatoren: [] }) });
  assert.match(S.versionHinzu(speicher, setup.id, nurText, JETZT + 1).fehler, /schon als v1/);
  assert.match(S.versionHinzu(speicher, setup.id, VERSION, JETZT + 1).fehler, /Chart-Taktik/);
  const neu = JSON.parse(JSON.stringify(TAKTIK));
  neu.zeichnungen[0].p = 185; neu.zeichnungen.push({ id: "V1", art: "senkrecht", t: 20000 }); neu.ebene = "woche";
  neu.regeln.filter = [{ typ: "rsi", n: 14, op: "ueber", wert: 50 }];
  const r = S.versionHinzu(speicher, setup.id, Object.assign({}, TV, { taktik: neu }), JETZT + 2);
  assert.equal(r.version.nr, 2);
  const satz = (t) => [`Einstieg ${t.regeln.einstieg.length}`, ...(t.regeln.filter || []).map((b) => `Filter ${b.typ} ${b.wert}`)];
  assert.deepEqual(S.aenderungenTaktik(TAKTIK, neu, satz), ["Kerzen: Tag → Woche", "Zeichnung verändert: L1", "neue Zeichnung: V1", "neu: Filter rsi 50"]);
});

test("Chart-Taktik mit Minuten- und Stundenkerzen", () => {
  const roh = JSON.parse(JSON.stringify(TAKTIK));
  roh.ebene = "5m";
  assert.equal(S.pruefeTaktik(roh).ebene, "5m");
  roh.ebene = "constructor";
  assert.equal(S.pruefeTaktik(roh).ebene, "tag");
  const neu = Object.assign(JSON.parse(JSON.stringify(TAKTIK)), { ebene: "4h" });
  assert.deepEqual(S.aenderungenTaktik(TAKTIK, neu, () => []).slice(0, 1), ["Kerzen: Tag → 4 Stunden"]);
  assert.notEqual(S.signaturVersion({ art: "taktik", taktik: TAKTIK }), S.signaturVersion({ art: "taktik", taktik: neu }));
});
