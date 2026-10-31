/* Fathom: Setup-Lab-Rechenkern (ohne Oberfläche, läuft im Browser und unter Node für die Tests).
 *
 * Ein Setup ist eine Strategie aus dem Backtest mit Zeitstempel: Regeln, These, Kennzahlen und Datenstand werden beim
 * Speichern eingefroren. Jede Regeländerung ist eine neue Version; die alten bleiben unverändert.
 * Die Bewährungsprobe trennt die Trades einer Version am Zeitpunkt des Speicherns: Was danach eröffnet wurde, beruht
 * auf Kursen, die beim Festlegen der Regeln noch niemand kannte (echtes Out-of-Sample).
 *
 * Grundsätze:
 *  - Nur Kennzahlen, die sich aus den Trades korrekt berechnen lassen; fehlt etwas, steht null (Anzeige „–“).
 *  - Offene Positionen zählen nicht in die Kennzahlen (ihr Ergebnis steht noch nicht fest), sie werden getrennt gezeigt.
 *  - Ein Vergleich zwischen Backtest und Bewährungsprobe erst ab MIN_VERGLEICH neuen Trades.
 *  - Alles, was aus dem Speicher kommt, wird geprüft: unbekannte Felder fallen weg, Texte werden gekürzt.
 */
(function (wurzel, fabrik) {
  const kern = fabrik();
  if (typeof module === "object" && module.exports) module.exports = kern;
  else wurzel.WBSetupKern = kern;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const GRENZEN = { setups: 50, versionen: 20, name: 80, these: 1200, widerlegt: 400, notiz: 300, worte: 2000, fakten: 30, werte: 60, params: 80 };
  const MIN_VERGLEICH = 10;
  const KLASSEN = ["aktie", "etf", "forex", "rohstoff", "index"];
  const KUERZEL = /^[A-Za-z0-9.\-=^&]{1,24}$/;
  const SCHLUESSEL_NAME = /^[A-Za-z0-9_]{1,40}$/;
  const ID = /^s[a-z0-9]{6,24}$/;
  const TAG_MIN = 1440;

  const endlich = (x) => typeof x === "number" && Number.isFinite(x);
  const zahlOderNull = (x) => (endlich(x) ? x : null);

  /** Text ohne Steuerzeichen (Zeilenumbrüche nur, wenn erlaubt), gekürzt. */
  function text(x, max, mehrzeilig) {
    if (typeof x !== "string") return "";
    let t = x.replace(/[\u2028\u2029]/g, "\n").replace(mehrzeilig ? /[\u0000-\u0009\u000b-\u001f\u007f]/g : /[\u0000-\u001f\u007f]/g, " ");
    if (mehrzeilig) t = t.replace(/\n{3,}/g, "\n\n");
    t = t.trim();
    return t.length > max ? t.slice(0, max).trimEnd() : t;
  }

  /* ---------------------------------------------------------------- Prüfen und Normalisieren */
  function pruefeFakt(f) {
    if (!f || typeof f !== "object" || Array.isArray(f) || typeof f.typ !== "string" || !/^[a-z_]{2,20}$/.test(f.typ)) return null;
    const aus = {};
    let felder = 0;
    for (const [k, v] of Object.entries(f)) {
      if (!SCHLUESSEL_NAME.test(k) || ++felder > 16) continue;
      if (typeof v === "string") aus[k] = text(v, 120);
      else if (endlich(v) || typeof v === "boolean") aus[k] = v;
    }
    return aus;
  }
  function pruefeParams(p) {
    const aus = {};
    if (!p || typeof p !== "object" || Array.isArray(p)) return aus;
    Object.keys(p).slice(0, GRENZEN.params).forEach((k) => { if (SCHLUESSEL_NAME.test(k) && endlich(p[k])) aus[k] = p[k]; });
    return aus;
  }
  function pruefeRegel(r) {
    if (!r || typeof r !== "object" || !KLASSEN.includes(r.klasse) || !Array.isArray(r.fakten)) return null;
    const wert = typeof r.wert === "string" && KUERZEL.test(r.wert) ? r.wert : "";
    const extra = r.extra && typeof r.extra === "object" && typeof r.extra.s === "string" && KUERZEL.test(r.extra.s) && r.extra.s === wert && KLASSEN.includes(r.extra.t)
      ? { s: r.extra.s, n: text(r.extra.n || r.extra.s, 80), t: r.extra.t } : null;
    const werte = (Array.isArray(r.werte) ? r.werte : []).filter((s) => typeof s === "string" && KUERZEL.test(s));
    const fakten = r.fakten.slice(0, GRENZEN.fakten).map(pruefeFakt).filter(Boolean);
    const jahre = Math.min(10, Math.max(1, Math.round(Number(r.jahre)) || 10));
    return { klasse: r.klasse, wert, extra, werte: [...new Set(werte)].slice(0, GRENZEN.werte), jahre, fakten, params: pruefeParams(r.params) };
  }
  const ERGEBNIS_FELDER = ["n", "offen", "quote", "mittel", "sd", "median", "mittelGewinn", "mittelVerlust", "faktor", "summe", "t", "bester",
    "schlechtester", "rueckgang", "gesamt", "jaehrlich", "kostenEuro", "finanzEuro", "von", "bis", "start", "ende", "hebel"];
  function pruefeErgebnis(e) {
    if (!e || typeof e !== "object") return null;
    const aus = {};
    ERGEBNIS_FELDER.forEach((k) => { aus[k] = zahlOderNull(e[k]); });
    aus.n = Math.max(0, Math.round(aus.n || 0));
    aus.offen = Math.max(0, Math.round(aus.offen || 0));
    return aus;
  }
  // Beliebiges JSON auf Grundtypen beschränken (für Zeichnungen und Regeln einer Chart-Taktik; geprüft wird beim Laden
  // zusätzlich vom Taktik-Kern). Nur einfache Schlüssel, keine Prototyp-Namen, begrenzte Tiefe und Länge.
  const VERBOTEN = new Set(["__proto__", "constructor", "prototype"]);
  function sauber(x, tiefe) {
    if (x === null) return null;
    if (typeof x === "string") return text(x, 200);
    if (typeof x === "boolean" || endlich(x)) return x;
    if (tiefe <= 0 || typeof x !== "object") return undefined;
    if (Array.isArray(x)) return x.slice(0, 60).map((y) => sauber(y, tiefe - 1)).filter((y) => y !== undefined);
    const aus = {};
    Object.keys(x).slice(0, 24).forEach((k) => {
      if (!SCHLUESSEL_NAME.test(k) || VERBOTEN.has(k)) return;
      const v = sauber(x[k], tiefe - 1);
      if (v !== undefined) aus[k] = v;
    });
    return aus;
  }
  const KOSTEN = [0, 0.0005, 0.001, 0.0025];
  // Kerzen einer Chart-Taktik (wie EBENEN im Taktik-Kern); ältere Setups kennen nur Tag und Woche
  const EBENEN = { "1m": "1 Minute", "5m": "5 Minuten", "15m": "15 Minuten", "1h": "1 Stunde", "4h": "4 Stunden", tag: "Tag", woche: "Woche", monat: "Monat" };
  const ebeneOk = (e) => (typeof e === "string" && Object.prototype.hasOwnProperty.call(EBENEN, e) ? e : "tag");
  function pruefeTaktik(t) {
    if (!t || typeof t !== "object" || typeof t.wert !== "string" || !KUERZEL.test(t.wert)) return null;
    if (!t.regeln || typeof t.regeln !== "object" || Array.isArray(t.regeln)) return null;
    return { wert: t.wert, wertName: text(t.wertName || t.wert, 80) || t.wert, typ: KLASSEN.includes(t.typ) ? t.typ : null, extra: !!t.extra,
             ebene: ebeneOk(t.ebene), kosten: KOSTEN.includes(t.kosten) ? t.kosten : 0.0005, nurDanach: !!t.nurDanach,
             zeichnungen: Array.isArray(t.zeichnungen) ? sauber(t.zeichnungen.slice(0, 40), 3) : [],
             indikatoren: Array.isArray(t.indikatoren) ? sauber(t.indikatoren.slice(0, 8), 2) : [],
             text: text(t.text, 4000, true), regeln: sauber(t.regeln, 6) };
  }
  const PROBE_ARTEN = ["keine", "zu_wenig", "im_rahmen", "schlechter", "besser", "ohne_streuung", "demo"];
  function pruefeProbe(p) {
    if (!p || typeof p !== "object" || !endlich(p.zeit)) return null;
    const offen = p.offen && typeof p.offen === "object" && typeof p.offen.s === "string" && KUERZEL.test(p.offen.s) && endlich(p.offen.seit)
      ? { s: p.offen.s, seit: p.offen.seit, dir: p.offen.dir === -1 ? -1 : 1 } : null;
    return { zeit: p.zeit, stand: typeof p.stand === "string" && /^\d{4}-\d{2}-\d{2}$/.test(p.stand) ? p.stand : null,
             n: Math.max(0, Math.round(Number(p.n) || 0)), quote: zahlOderNull(p.quote), mittel: zahlOderNull(p.mittel), summe: zahlOderNull(p.summe),
             art: PROBE_ARTEN.includes(p.art) ? p.art : "keine", offen };
  }
  function pruefeVersion(v) {
    if (!v || typeof v !== "object" || !endlich(v.zeit) || v.zeit <= 0) return null;
    const art = v.art === "taktik" ? "taktik" : "fakten";
    const regel = art === "fakten" ? pruefeRegel(v.regel) : null, taktik = art === "taktik" ? pruefeTaktik(v.taktik) : null;
    if (!regel && !taktik) return null;
    const d = v.daten && typeof v.daten === "object" ? v.daten : {};
    return { nr: Math.max(1, Math.round(Number(v.nr) || 1)), zeit: v.zeit, art, notiz: text(v.notiz, GRENZEN.notiz), regel, taktik, worte: text(v.worte, GRENZEN.worte),
             daten: { stand: typeof d.stand === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d.stand) ? d.stand : null, demo: !!d.demo },
             ergebnis: pruefeErgebnis(v.ergebnis), probe: pruefeProbe(v.probe) };
  }
  function pruefeSetup(s) {
    if (!s || typeof s !== "object" || typeof s.id !== "string" || !ID.test(s.id)) return null;
    const versionen = (Array.isArray(s.versionen) ? s.versionen : []).map(pruefeVersion).filter(Boolean)
      .sort((a, b) => a.nr - b.nr).filter((v, i, a) => i === 0 || v.nr !== a[i - 1].nr).slice(0, GRENZEN.versionen);
    if (!versionen.length) return null;
    const name = text(s.name, GRENZEN.name) || "Ohne Namen";
    const erstellt = endlich(s.erstellt) ? s.erstellt : versionen[0].zeit;
    return { id: s.id, name, these: text(s.these, GRENZEN.these, true), widerlegt: text(s.widerlegt, GRENZEN.widerlegt, true),
             erstellt, geaendert: endlich(s.geaendert) ? s.geaendert : versionen[versionen.length - 1].zeit,
             geoeffnet: Math.max(0, Math.round(Number(s.geoeffnet) || 0)), proben: Math.max(0, Math.round(Number(s.proben) || 0)),
             zuletzt: endlich(s.zuletzt) ? s.zuletzt : null, versionen };
  }
  /** Speicherinhalt (beliebiges JSON) → { v: 1, liste: [...] }; Ungültiges fällt weg, Doppelte auch. */
  function pruefeSpeicher(roh) {
    const liste = roh && typeof roh === "object" && Array.isArray(roh.liste) ? roh.liste : [];
    const gesehen = new Set(), aus = [];
    for (const s of liste) {
      const p = pruefeSetup(s);
      if (p && !gesehen.has(p.id)) { gesehen.add(p.id); aus.push(p); }
      if (aus.length >= GRENZEN.setups) break;
    }
    return { v: 1, liste: aus };
  }

  /* ---------------------------------------------------------------- Signatur und Änderungen */
  function stabil(x) {
    if (Array.isArray(x)) return `[${x.map(stabil).join(",")}]`;
    if (x && typeof x === "object") return `{${Object.keys(x).sort().map((k) => `${JSON.stringify(k)}:${stabil(x[k])}`).join(",")}}`;
    return JSON.stringify(x === undefined ? null : x);
  }
  /** Gleiche Regeln ⇔ gleiche Signatur (Reihenfolge der Schlüssel egal, Reihenfolge der Fakten nicht). */
  function signatur(regel) {
    const r = pruefeRegel(regel);
    if (!r) return "";
    const nutzt = r.fakten.some((f) => f.typ === "kriterium");
    return stabil({ klasse: r.klasse, wert: r.wert, werte: r.wert ? [] : r.werte.slice().sort(), jahre: r.jahre, fakten: r.fakten, params: nutzt ? r.params : {} });
  }
  /** Signatur einer Version: Fakten-Strategie wie oben; Chart-Taktik aus Wert, Kerzen, Kosten, Zeichnungen und Regeln
   *  (Text und angezeigte Indikatoren ändern die Strategie nicht). */
  function signaturVersion(v) {
    if (!v) return "";
    if (v.art === "taktik") {
      const t = pruefeTaktik(v.taktik);
      return t ? stabil({ art: "taktik", wert: t.wert, ebene: t.ebene, kosten: t.kosten, nurDanach: t.nurDanach, zeichnungen: t.zeichnungen, regeln: t.regeln }) : "";
    }
    return signatur(v.regel);
  }
  /** Änderungen zwischen zwei Chart-Taktiken; `beschreibe(taktik)` liefert die Regeln als Sätze (aus dem Taktik-Kern). */
  function aenderungenTaktik(alt, neu, beschreibe) {
    const a = pruefeTaktik(alt), b = pruefeTaktik(neu);
    if (!a || !b) return [];
    const liste = [];
    const pzk = (x) => `${String(+(x * 100).toFixed(2)).replace(".", ",")} %`;
    if (a.wert !== b.wert) liste.push(`Wert: ${a.wertName} → ${b.wertName}`);
    if (a.ebene !== b.ebene) liste.push(`Kerzen: ${EBENEN[a.ebene]} → ${EBENEN[b.ebene]}`);
    if (a.kosten !== b.kosten) liste.push(`Kosten: ${pzk(a.kosten)} → ${pzk(b.kosten)} je Kauf und Verkauf`);
    if (a.nurDanach !== b.nurDanach) liste.push(b.nurDanach ? "nur Kerzen nach den Zeichnungen" : "alle Kerzen statt nur nach den Zeichnungen");
    const ohneName = (z) => { const c = Object.assign({}, z); delete c.name; return stabil(c); };
    const za = Object.fromEntries(a.zeichnungen.filter((z) => z && typeof z.id === "string").map((z) => [z.id, z]));
    const zb = Object.fromEntries(b.zeichnungen.filter((z) => z && typeof z.id === "string").map((z) => [z.id, z]));
    Object.keys(zb).forEach((id) => { if (!za[id]) liste.push(`neue Zeichnung: ${id}`); else if (ohneName(za[id]) !== ohneName(zb[id])) liste.push(`Zeichnung verändert: ${id}`); });
    Object.keys(za).forEach((id) => { if (!zb[id]) liste.push(`Zeichnung entfernt: ${id}`); });
    if (typeof beschreibe === "function") {
      let la = [], lb = [];
      try { la = beschreibe(a); lb = beschreibe(b); } catch (e) { la = []; lb = []; }
      lb.filter((x) => !la.includes(x)).forEach((x) => liste.push(`neu: ${x}`));
      la.filter((x) => !lb.includes(x)).forEach((x) => liste.push(`entfernt: ${x}`));
    }
    return liste;
  }
  /** Was sich zwischen zwei Regeln geändert hat, in Worten. `satz(f)` beschreibt einen Fakt (aus dem Backtest-Kern). */
  function aenderungen(alt, neu, satz, wertName) {
    const a = pruefeRegel(alt), b = pruefeRegel(neu);
    if (!a || !b) return [];
    const s = typeof satz === "function" ? satz : (f) => f.typ;
    const name = typeof wertName === "function" ? wertName : (x) => x || "alle Werte";
    const liste = [];
    if (a.klasse !== b.klasse || a.wert !== b.wert) liste.push(`Markt: ${name(a.wert, a.klasse)} → ${name(b.wert, b.klasse)}`);
    else if (!a.wert && stabil(a.werte.slice().sort()) !== stabil(b.werte.slice().sort())) liste.push(`Werte der Watchlist: ${a.werte.length} → ${b.werte.length}`);
    if (a.jahre !== b.jahre) liste.push(`Zeitraum: ${a.jahre} → ${b.jahre} Jahre`);
    const rest = b.fakten.map((f) => [stabil(f), f]);
    const weg = [];
    a.fakten.forEach((f) => {
      const k = stabil(f), i = rest.findIndex(([x]) => x === k);
      if (i >= 0) rest.splice(i, 1); else weg.push(f);
    });
    // Gleicher Typ weg und neu: als Änderung zusammenfassen
    const neuListe = rest.map(([, f]) => f);
    weg.forEach((f) => {
      const i = neuListe.findIndex((g) => g.typ === f.typ && (f.typ !== "kriterium" || g.name === f.name));
      if (i >= 0) { liste.push(`geändert: ${s(f)} → ${s(neuListe[i])}`); neuListe.splice(i, 1); }
      else liste.push(`entfernt: ${s(f)}`);
    });
    neuListe.forEach((f) => liste.push(`neu: ${s(f)}`));
    if (stabil(a.params) !== stabil(b.params) && b.fakten.some((f) => f.typ === "kriterium")) liste.push("Signal-Schwellen geändert");
    return liste;
  }

  /* ---------------------------------------------------------------- Kennzahlen */
  function mittel(x) { return x.length ? x.reduce((a, b) => a + b, 0) / x.length : null; }
  function median(x) {
    if (!x.length) return null;
    const s = x.slice().sort((a, b) => a - b), m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  function stdAbw(x) {
    if (x.length < 2) return null;
    const m = mittel(x);
    return Math.sqrt(x.reduce((a, v) => a + (v - m) * (v - m), 0) / (x.length - 1));
  }
  /** Kennzahlen je Trade (Rendite auf den Einsatz nach Kosten, `netto`); offene Positionen getrennt. */
  function kennzahlen(trades) {
    const alle = (trades || []).filter((t) => t && endlich(t.netto));
    const zu = alle.filter((t) => t.grund !== "offen"), r = zu.map((t) => t.netto);
    const n = r.length, offen = alle.length - n;
    if (!n) return { n: 0, offen, quote: null, mittel: null, sd: null, median: null, mittelGewinn: null, mittelVerlust: null, faktor: null, summe: null, t: null, bester: null, schlechtester: null };
    const plus = r.filter((x) => x > 0), minus = r.filter((x) => x <= 0);
    const gewinne = plus.reduce((a, x) => a + x, 0), verluste = -minus.reduce((a, x) => a + x, 0);
    const m = mittel(r), sd = stdAbw(r);
    return { n, offen, quote: plus.length / n, mittel: m, sd, median: median(r), mittelGewinn: plus.length ? gewinne / plus.length : null,
             mittelVerlust: minus.length ? -verluste / minus.length : null, faktor: verluste > 0 ? gewinne / verluste : null,
             summe: r.reduce((a, x) => a + x, 0), t: sd ? m / (sd / Math.sqrt(n)) : null, bester: Math.max(...r), schlechtester: Math.min(...r) };
  }
  /** Momentaufnahme eines Backtest-Laufs (Form wie WBBacktestKern.rechne) für das Speichern. */
  function zusammenfassung(r) {
    if (!r || !Array.isArray(r.trades)) return null;
    const k = kennzahlen(r.trades), d = r.depot || {}, kk = r.kennzahlen || {};
    const kurve = r.kurve && r.kurve.length ? r.kurve : null;
    return pruefeErgebnis(Object.assign({}, k, {
      rueckgang: d.rueckgang ? d.rueckgang.max : null, gesamt: d.gesamt, jaehrlich: d.jaehrlich, kostenEuro: kk.kostenEuro, finanzEuro: kk.finanzEuro,
      von: r.von, bis: r.bis, start: r.start, ende: kurve ? kurve[kurve.length - 1] : null, hebel: r.s ? r.s.hebel : null }));
  }

  /* ---------------------------------------------------------------- Bewährungsprobe */
  /** Trades am Stichtag (Minuten seit 1970, UTC) teilen: vorher eröffnet = Backtest, ab Stichtag = neu. */
  function teile(trades, stichMin) {
    const vorher = [], nachher = [];
    (trades || []).forEach((t) => { (t.einMin >= stichMin ? nachher : vorher).push(t); });
    return { vorher, nachher };
  }
  function stichprobe(n) {
    if (!n) return { art: "keine", text: "keine abgeschlossenen Trades" };
    if (n < 10) return { art: "sehr_klein", text: `sehr kleine Stichprobe (${n} Trades): keine belastbare Aussage` };
    if (n < 30) return { art: "klein", text: `kleine Stichprobe (${n} Trades): nur als Hinweis lesen` };
    return { art: "brauchbar", text: `${n} Trades: genug für eine erste Einschätzung, keine Garantie` };
  }
  /** Passt der Ø Trade seit dem Speichern zum Backtest? Standardfehler aus der Streuung des Backtests. */
  function vergleich(bt, neu) {
    const n = neu && neu.n ? neu.n : 0;
    if (n < MIN_VERGLEICH) return { art: n ? "zu_wenig" : "keine", fehlen: MIN_VERGLEICH - n, z: null };
    if (!bt || !endlich(bt.mittel) || !endlich(bt.sd) || bt.sd <= 0 || bt.n < 2) return { art: "ohne_streuung", fehlen: 0, z: null };
    const z = (neu.mittel - bt.mittel) / (bt.sd / Math.sqrt(n));
    return { art: z <= -2 ? "schlechter" : z >= 2 ? "besser" : "im_rahmen", fehlen: 0, z };
  }
  /** Trades, die schon beim Speichern abgeschlossen waren (Daten bis einschließlich Tag `bisTag`): nur sie sind mit der
   *  Momentaufnahme vergleichbar. Damals offene Trades und ein Einstieg am letzten Tag (damals ohne Kurse danach) nicht. */
  function nachgerechnet(trades, bisTag) {
    if (!endlich(bisTag)) return [];
    return (trades || []).filter((t) => t.grund !== "offen" && Math.floor(t.einMin / TAG_MIN) < bisTag && Math.floor(t.ausMin / TAG_MIN) <= bisTag);
  }
  /** Weicht der heute nachgerechnete Backtest-Teil von der Momentaufnahme ab (geänderte Kurse, Splits, Korrekturen)? */
  function datenGeaendert(gespeichert, heute) {
    if (!gespeichert || !heute) return false;
    if (gespeichert.n !== heute.n) return true;
    if (gespeichert.n && endlich(gespeichert.mittel) && endlich(heute.mittel)) return Math.abs(gespeichert.mittel - heute.mittel) > 1e-4;
    return false;
  }
  /** Zeitraum für die Nachrechnung: ab dem ersten Tag des gespeicherten Backtests bis heute. */
  function jahreAb(vonTag, endeTag) {
    if (!endlich(vonTag) || !endlich(endeTag) || endeTag <= vonTag) return null;
    return (endeTag - vonTag) / 365.25;
  }
  /** Kurzfassung für die Liste (wird in der Version gespeichert). */
  function probeAus(zeit, stand, neu, art, offen) {
    return pruefeProbe({ zeit, stand, n: neu.n, quote: neu.quote, mittel: neu.mittel, summe: neu.summe, art,
                         offen: offen ? { s: offen.w ? offen.w.s : offen.s, seit: offen.einMin, dir: offen.dir } : null });
  }

  /* ---------------------------------------------------------------- Speicher ändern (immer neue Objekte) */
  function neueId(zufall) {
    const r = typeof zufall === "function" ? zufall : Math.random;
    let s = "s" + Date.now().toString(36);
    while (s.length < 14) s += Math.floor(r() * 36).toString(36);
    return s;
  }
  function version(nr, zeit, regel, worte, daten, ergebnis, notiz) {
    return pruefeVersion({ nr, zeit, regel, worte, daten, ergebnis, notiz });
  }
  /** Neues Setup. Rückgabe { speicher, setup } oder { fehler }. */
  function anlegen(speicher, kopf, v, jetzt, id) {
    const sp = pruefeSpeicher(speicher);
    if (sp.liste.length >= GRENZEN.setups) return { fehler: `Höchstens ${GRENZEN.setups} Setups. Lösche zuerst ein altes.` };
    const name = text(kopf && kopf.name, GRENZEN.name);
    if (!name) return { fehler: "Bitte gib dem Setup einen Namen." };
    const ver = pruefeVersion(Object.assign({}, v, { nr: 1, zeit: jetzt }));
    if (!ver) return { fehler: "Die Regeln ließen sich nicht speichern." };
    const neuId = id && ID.test(id) && !sp.liste.some((s) => s.id === id) ? id : neueId();
    const setup = pruefeSetup({ id: neuId, name, these: kopf.these, widerlegt: kopf.widerlegt, erstellt: jetzt, geaendert: jetzt, versionen: [ver] });
    return { speicher: { v: 1, liste: [setup, ...sp.liste] }, setup };
  }
  /** Neue Version eines Setups, nur wenn sich die Regeln geändert haben. */
  function versionHinzu(speicher, id, v, jetzt) {
    const sp = pruefeSpeicher(speicher);
    const s = sp.liste.find((x) => x.id === id);
    if (!s) return { fehler: "Dieses Setup gibt es nicht mehr." };
    const letzte = s.versionen[s.versionen.length - 1];
    if ((letzte.art || "fakten") !== (v.art === "taktik" ? "taktik" : "fakten"))
      return { fehler: `Dieses Setup ist eine ${letzte.art === "taktik" ? "Chart-Taktik" : "Fakten-Strategie"}. Speichere die Regeln als neues Setup.` };
    if (signaturVersion(letzte) === signaturVersion(Object.assign({ art: "fakten" }, v))) return { fehler: `Diese Regeln sind schon als v${letzte.nr} gespeichert.`, gleich: letzte.nr };
    if (s.versionen.length >= GRENZEN.versionen) return { fehler: `Höchstens ${GRENZEN.versionen} Versionen je Setup. Speichere die Regeln als neues Setup.` };
    const ver = pruefeVersion(Object.assign({}, v, { nr: letzte.nr + 1, zeit: jetzt }));
    if (!ver) return { fehler: "Die Regeln ließen sich nicht speichern." };
    const neu = Object.assign({}, s, { versionen: [...s.versionen, ver], geaendert: jetzt });
    return { speicher: { v: 1, liste: [neu, ...sp.liste.filter((x) => x.id !== id)] }, setup: neu, version: ver };
  }
  /** Name, These, „widerlegt, wenn“ ändern (keine neue Version: die Regeln bleiben gleich). */
  function textAendern(speicher, id, teil, jetzt) {
    const sp = pruefeSpeicher(speicher);
    let fehler = null;
    const liste = sp.liste.map((s) => {
      if (s.id !== id) return s;
      const name = teil.name != null ? text(teil.name, GRENZEN.name) : s.name;
      if (!name) { fehler = "Der Name darf nicht leer sein."; return s; }
      return Object.assign({}, s, { name, these: teil.these != null ? text(teil.these, GRENZEN.these, true) : s.these,
        widerlegt: teil.widerlegt != null ? text(teil.widerlegt, GRENZEN.widerlegt, true) : s.widerlegt, geaendert: jetzt });
    });
    return fehler ? { fehler } : { speicher: { v: 1, liste } };
  }
  function entfernen(speicher, id) {
    const sp = pruefeSpeicher(speicher);
    return { v: 1, liste: sp.liste.filter((s) => s.id !== id) };
  }
  /** Zähler für die lokalen Metriken (öffnen, prüfen) und das Ergebnis der letzten Probe. */
  function vermerken(speicher, id, art, jetzt, nr, probe) {
    const sp = pruefeSpeicher(speicher);
    return { v: 1, liste: sp.liste.map((s) => {
      if (s.id !== id) return s;
      const neu = Object.assign({}, s);
      if (art === "geoeffnet") neu.geoeffnet = s.geoeffnet + 1;
      if (art === "geprueft") {
        neu.proben = s.proben + 1; neu.zuletzt = jetzt;
        const p = pruefeProbe(probe);
        if (p) neu.versionen = s.versionen.map((v) => (v.nr === nr ? Object.assign({}, v, { probe: p }) : v));
      }
      return neu;
    }) };
  }

  /** Lokale Produktmetriken ohne Namen, Regeln oder Kennzahlen (nichts davon verlässt den Browser). */
  function metriken(speicher, jetzt) {
    const sp = pruefeSpeicher(speicher), l = sp.liste, woche = 7 * TAG_MIN * 6e4;
    return {
      setups: l.length,
      versionen: l.reduce((a, s) => a + s.versionen.length, 0),
      mitMehrerenVersionen: l.filter((s) => s.versionen.length > 1).length,
      geoeffnet: l.reduce((a, s) => a + s.geoeffnet, 0),
      proben: l.reduce((a, s) => a + s.proben, 0),
      wiederkehr7Tage: l.filter((s) => s.zuletzt != null && s.zuletzt - s.erstellt >= woche).length,
      mitNeuenTrades: l.filter((s) => s.versionen.some((v) => v.probe && v.probe.n > 0)).length,
      erstesSetupVorTagen: l.length ? Math.floor((jetzt - Math.min(...l.map((s) => s.erstellt))) / (TAG_MIN * 6e4)) : null,
    };
  }

  return { GRENZEN, MIN_VERGLEICH, text, pruefeFakt, pruefeRegel, pruefeErgebnis, pruefeProbe, pruefeVersion, pruefeSetup, pruefeSpeicher,
           EBENEN, stabil, signatur, signaturVersion, aenderungen, aenderungenTaktik, pruefeTaktik, sauber, kennzahlen, zusammenfassung, teile, stichprobe, vergleich, nachgerechnet, datenGeaendert, jahreAb, probeAus,
           neueId, version, anlegen, versionHinzu, textAendern, entfernen, vermerken, metriken };
});
