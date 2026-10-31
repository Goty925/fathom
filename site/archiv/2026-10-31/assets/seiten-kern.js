/* Fathom: Rechenkern der Fenster Termine, Alarme, Depot und Journal (ohne Oberfläche).
 *
 * Alarme:  { id, slug, art, wert, notiz, an, erstellt, ausgeloest, gesehen }
 *          art: kurs_ueber | kurs_unter | tag_plus | tag_minus | abstand_hoch | treffer | kein_treffer | downside | zahlen
 *          Ein Alarm löst aus, sobald seine Bedingung erfüllt ist, und bleibt ausgelöst, bis du ihn quittierst. Danach ist er
 *          wieder scharf, sobald die Bedingung nicht mehr gilt.
 * Journal: { id, slug, name, art, text, falsch, wv, erstellt, kurs, waehrung, basis, erledigt }
 *          art: kauf | verkauf | idee | beobachtung; wv = Wiedervorlage als ISO-Datum
 * Trades:  { id, datum, eroeffnet, slug, instrument, richtung, stueck, ein, aus, waehrung, fx, gebuehren, ergebnis, notiz }
 *          für den Trading-Kalender im Journal; dazu realisierte Gewinne aus den Depot-Verkäufen (depotTrades)
 * Termine: Quartalszahlen der Watchlist, Notenbanken, wichtige Wirtschaftsdaten und Wiedervorlagen aus dem Journal.
 * Alles bleibt im Browser; was aus dem Speicher kommt, wird hier geprüft (fremde Kontosicherungen sind möglich).
 * Läuft auch unter Node (für Tests): module.exports.
 */
(function (wurzel, fabrik) {
  const kern = fabrik();
  if (typeof module === "object" && module.exports) module.exports = kern;
  else wurzel.WBSeitenKern = kern;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const TAG = 864e5;

  /* ---------------------------------------------------------------- Format */
  const formate = {};
  const nf = (d) => formate[d] || (formate[d] = new Intl.NumberFormat("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d }));
  const minus = (s) => s.replace(/-/g, "−");
  const zahl = (x, d = 2) => (x == null || !isFinite(x) ? "–" : minus(nf(d).format(x)));
  const pct = (x, d = 1, vz = true) => (x == null || !isFinite(x) ? "–" : minus((vz && x > 0 ? "+" : "") + nf(d).format(Math.abs(x) < 0.5 * Math.pow(10, -d - 2) ? 0 : x * 100) + " %"));
  // Euro kurz genug für ein schmales Widget: 9.870 €, 123 T€, 1,2 Mio
  function euroKurz(x) {
    if (x == null || !isFinite(x)) return "–";
    const a = Math.abs(x), v = x < 0 ? "−" : "";
    if (a >= 1e6) return `${v}${nf(a >= 1e7 ? 0 : 1).format(a / 1e6)} Mio`;
    if (a >= 1e5) return `${v}${nf(0).format(a / 1e3)} T€`;
    return `${v}${nf(0).format(a)} €`;
  }
  const istDatum = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + "T12:00:00"));
  // Tage zwischen zwei Kalendertagen (lokale Zeit), 0 = heute
  function tageBis(iso, jetztMs) {
    const a = new Date(jetztMs); a.setHours(12, 0, 0, 0);
    return Math.round((Date.parse(iso + "T12:00:00") - a.getTime()) / TAG);
  }
  function tagText(iso, jetztMs) {
    const t = tageBis(iso, jetztMs);
    if (t === 0) return "heute";
    if (t === 1) return "morgen";
    if (t === -1) return "gestern";
    return t > 0 ? `in ${t} Tagen` : `vor ${-t} Tagen`;
  }
  const isoTag = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

  /* ---------------------------------------------------------------- Alarme */
  const ARTEN = {
    kurs_ueber: { name: "Kurs steigt über", einheit: "kurs", schritt: "any" },
    kurs_unter: { name: "Kurs fällt unter", einheit: "kurs", schritt: "any" },
    tag_plus: { name: "Tagesplus mindestens", einheit: "%", schritt: 0.25, min: 0.1, max: 50 },
    tag_minus: { name: "Tagesminus mindestens", einheit: "%", schritt: 0.25, min: 0.1, max: 50 },
    abstand_hoch: { name: "Abstand zum 52-Wochen-Hoch mindestens", einheit: "%", schritt: 1, min: 1, max: 95 },
    treffer: { name: "wird Treffer im Screener", einheit: null },
    kein_treffer: { name: "ist kein Treffer mehr", einheit: null },
    downside: { name: "Szenario-Downside schlechter als", einheit: "%", schritt: 1, min: -95, max: 50 },
    zahlen: { name: "Quartalszahlen in höchstens", einheit: "Tagen", schritt: 1, min: 0, max: 60 },
  };
  const ID = /^[a-z0-9]{4,24}$/;
  const SLUG = /^[a-z0-9-]{1,40}$/;
  const neueId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const text = (s, n) => (typeof s === "string" ? s.slice(0, n) : "");
  const zeit = (x) => (typeof x === "number" && isFinite(x) && x > 0 ? x : null);

  // Ein Alarm aus dem Speicher oder dem Formular: null, wenn er nicht taugt
  function alarmPruefen(a, slugs) {
    if (!a || typeof a !== "object") return null;
    const art = ARTEN[a.art];
    if (!art || !Object.prototype.hasOwnProperty.call(ARTEN, a.art)) return null;
    if (typeof a.slug !== "string" || !SLUG.test(a.slug) || (slugs && !slugs.has(a.slug))) return null;
    let wert = null;
    if (art.einheit) {
      wert = Number(a.wert);
      if (!isFinite(wert)) return null;
      if (art.einheit === "kurs" && !(wert > 0)) return null;
      if (art.min != null) wert = Math.min(Math.max(wert, art.min), art.max);
    }
    return {
      id: typeof a.id === "string" && ID.test(a.id) ? a.id : neueId(), slug: a.slug, art: a.art, wert,
      notiz: text(a.notiz, 200), an: a.an !== false, erstellt: zeit(a.erstellt) || Date.now(),
      ausgeloest: zeit(a.ausgeloest), gesehen: !!a.gesehen,
    };
  }

  // Bedingung prüfen. lage: { kurs, heute, hoch, treffer, downside, zahlenTage, dez, waehrung }
  // Rückgabe { erfuellt: true | false | null (Daten fehlen), ist: Text zum aktuellen Stand }
  function pruefe(a, l) {
    l = l || {};
    const k = l.kurs, d = l.dez != null ? l.dez : 2;
    switch (a.art) {
      case "kurs_ueber": case "kurs_unter":
        if (k == null) return { erfuellt: null, ist: "kein Kurs" };
        return { erfuellt: a.art === "kurs_ueber" ? k > a.wert : k < a.wert, ist: `${zahl(k, d)} ${l.waehrung || ""}`.trim() };
      case "tag_plus": case "tag_minus":
        if (l.heute == null) return { erfuellt: null, ist: "nur mit Live-Kursen" };
        return { erfuellt: a.art === "tag_plus" ? l.heute * 100 >= a.wert : -l.heute * 100 >= a.wert, ist: `heute ${pct(l.heute)}` };
      case "abstand_hoch": {
        if (k == null || !l.hoch) return { erfuellt: null, ist: "kein 52-Wochen-Hoch" };
        const ab = 1 - k / Math.max(l.hoch, k);
        return { erfuellt: ab * 100 >= a.wert, ist: `${pct(ab, 1, false)} unter dem Hoch` };
      }
      case "treffer": case "kein_treffer":
        if (l.treffer == null) return { erfuellt: null, ist: "ohne Signale" };
        return { erfuellt: a.art === "treffer" ? !!l.treffer : !l.treffer, ist: l.treffer ? "Treffer" : "kein Treffer" };
      case "downside":
        if (l.downside == null) return { erfuellt: null, ist: "kein Szenario" };
        return { erfuellt: l.downside * 100 < a.wert, ist: `Downside ${pct(l.downside, 0)}` };
      case "zahlen":
        if (l.zahlenTage == null) return { erfuellt: null, ist: "kein Termin bekannt" };
        return { erfuellt: l.zahlenTage >= 0 && l.zahlenTage <= a.wert, ist: l.zahlenTage === 0 ? "heute" : `in ${l.zahlenTage} Tagen` };
    }
    return { erfuellt: null, ist: "" };
  }

  // Alle Alarme gegen die aktuelle Lage: setzt ausgeloest/gesehen; gibt die neu ausgelösten zurück
  function auswerten(liste, lagen, jetzt) {
    const neu = [];
    liste.forEach((a) => {
      if (!a.an) return;
      const p = pruefe(a, lagen[a.slug]);
      a.ist = p.ist; a.erfuellt = p.erfuellt;
      if (p.erfuellt === true && !a.ausgeloest) { a.ausgeloest = jetzt; a.gesehen = false; neu.push(a); }
      else if (p.erfuellt === false && a.ausgeloest && a.gesehen) { a.ausgeloest = null; a.gesehen = false; }   // wieder scharf
    });
    return neu;
  }
  const offeneAlarme = (liste) => liste.filter((a) => a.an && a.ausgeloest && !a.gesehen);

  function alarmText(a, name, l) {
    const art = ARTEN[a.art];
    let w = "";
    if (art.einheit === "kurs") w = ` ${zahl(a.wert, (l && l.dez) || 2)} ${(l && l.waehrung) || ""}`.trimEnd();
    else if (art.einheit === "%") w = ` ${a.art === "downside" ? pct(a.wert / 100, 0) : zahl(a.wert, a.wert % 1 ? 2 : 0) + " %"}`;
    else if (art.einheit === "Tagen") w = ` ${a.wert} ${a.wert === 1 ? "Tag" : "Tagen"}`;
    return `${name}: ${art.name}${w}`;
  }

  /* ---------------------------------------------------------------- Journal */
  const JOURNAL_ARTEN = { kauf: "Kauf", verkauf: "Verkauf", idee: "Idee", beobachtung: "Beobachtung" };
  function eintragPruefen(e, slugs) {
    if (!e || typeof e !== "object") return null;
    const slug = e.slug == null || e.slug === "" ? null : e.slug;
    if (slug != null && (typeof slug !== "string" || !SLUG.test(slug) || (slugs && !slugs.has(slug)))) return null;
    const t = text(e.text, 4000).trim();
    if (!t) return null;
    const kurs = Number(e.kurs);
    const basis = Number(e.basis);
    return {
      id: typeof e.id === "string" && ID.test(e.id) ? e.id : neueId(), slug, name: text(e.name, 80),
      art: Object.prototype.hasOwnProperty.call(JOURNAL_ARTEN, e.art) ? e.art : "beobachtung",
      text: t, falsch: text(e.falsch, 600).trim(), wv: istDatum(e.wv) ? e.wv : null,
      erstellt: zeit(e.erstellt) || Date.now(), kurs: e.kurs != null && isFinite(kurs) && kurs > 0 ? kurs : null,
      waehrung: /^[A-Za-z]{2,4}$/.test(e.waehrung || "") ? e.waehrung : "",
      basis: e.basis != null && isFinite(basis) ? Math.min(Math.max(basis, -1), 5) : null, erledigt: !!e.erledigt,
    };
  }
  // Wiedervorlagen, die heute oder früher fällig und noch offen sind
  const faellig = (liste, jetztMs) => liste.filter((e) => e.wv && !e.erledigt && tageBis(e.wv, jetztMs) <= 0);
  const seitEintrag = (e, kurs) => (e.kurs && kurs ? kurs / e.kurs - 1 : null);

  /* ---------------------------------------------------------------- Termine */
  // kalender: Termine aus daten/kalender.json (schon auf heute verschoben), werte: live-basis.werte,
  // depot: Set der Slugs im Depot, journal: Einträge. Rückgabe sortiert, nur die nächsten `tage` Tage.
  function termine({ kalender = [], werte = {}, depot = new Set(), journal = [] }, jetztMs, tage = 21) {
    const heute = isoTag(jetztMs), aus = [], gesehen = new Set();
    const inFrist = (tag) => { const t = tageBis(tag, jetztMs); return t >= 0 && t <= tage; };
    kalender.forEach((e) => {
      if (!e || !istDatum(e.tag) || !inFrist(e.tag)) return;
      if (e.art === "konjunktur" && (e.wichtig || 0) < 2) return;
      const ms = e.t != null ? e.t * 6e4 : null;
      if (ms != null && ms < jetztMs - 2 * 3600e3) return;   // vorbei (mit zwei Stunden Nachlauf)
      if (e.art === "zahlen" && e.slug) gesehen.add(e.slug);
      aus.push({ id: e.id, art: e.art === "zahlen" ? "zahlen" : e.art === "notenbank" ? "notenbank" : "konjunktur", tag: e.tag, ms,
        titel: e.titel, land: e.land, wichtig: e.wichtig || 1, slug: e.slug || null, info: e.info || "",
        mein: !!(e.slug && (werte[e.slug] || depot.has(e.slug))), depot: !!(e.slug && depot.has(e.slug)),
        erwartung: e.art === "zahlen" ? (e.werte || []).find((w) => w.id === "eps") || null : null });
    });
    // Quartalszahlen aus der Watchlist, die der Kalender nicht kennt
    Object.entries(werte).forEach(([slug, w]) => {
      if (!w || !w.earnings || gesehen.has(slug) || !istDatum(w.earnings) || !inFrist(w.earnings)) return;
      aus.push({ id: "zahlen-" + slug, art: "zahlen", tag: w.earnings, ms: null, titel: `Quartalszahlen ${w.name}`, land: "", wichtig: 2,
        slug, info: "", mein: true, depot: depot.has(slug), erwartung: null });
    });
    journal.forEach((e) => {
      if (!e.wv || e.erledigt) return;
      const t = tageBis(e.wv, jetztMs);
      if (t > tage) return;
      aus.push({ id: "wv-" + e.id, art: "wiedervorlage", tag: t < 0 ? heute : e.wv, ms: null, ueberfaellig: t < 0, seit: e.wv,
        titel: `Wiedervorlage${e.name ? ": " + e.name : ""}`, land: "", wichtig: 2, slug: e.slug, info: e.text.length > 160 ? e.text.slice(0, 157).trimEnd() + " …" : e.text,
        mein: true, depot: !!(e.slug && depot.has(e.slug)), journal: e.id });
    });
    return aus.sort((a, b) => a.tag.localeCompare(b.tag) || (a.ms == null) - (b.ms == null) || (a.ms || 0) - (b.ms || 0) || b.wichtig - a.wichtig);
  }
  // Nächster Termin, der dich betrifft (eigene Werte, Depot, Wiedervorlage), sonst der nächste wichtige
  function naechsterMeiner(liste) {
    return liste.find((t) => t.mein) || liste.find((t) => t.wichtig >= 3) || null;
  }

  /* ---------------------------------------------------------------- Depot */
  // zeilen: [{ slug, name, typ, w, heute, woche }] → Summen und Aufteilung nach Klasse
  function depotLage(zeilen) {
    const mit = zeilen.filter((z) => z.w > 0);
    const wert = mit.reduce((s, z) => s + z.w, 0);
    const heuteAlle = mit.every((z) => z.heute != null);
    const heuteEuro = mit.reduce((s, z) => s + (z.heute != null ? (z.w * z.heute) / (1 + z.heute) : 0), 0);
    const wocheEuro = mit.reduce((s, z) => s + (z.woche != null ? (z.w * z.woche) / (1 + z.woche) : 0), 0);
    const klassen = {};
    mit.forEach((z) => { klassen[z.typ] = (klassen[z.typ] || 0) + z.w; });
    return {
      wert, n: mit.length,
      heute: mit.some((z) => z.heute != null) ? { euro: heuteEuro, pct: wert - heuteEuro ? heuteEuro / (wert - heuteEuro) : 0, vollstaendig: heuteAlle } : null,
      woche: mit.some((z) => z.woche != null) ? { euro: wocheEuro, pct: wert - wocheEuro ? wocheEuro / (wert - wocheEuro) : 0 } : null,
      klassen: Object.entries(klassen).map(([typ, w]) => ({ typ, w, anteil: wert ? w / wert : 0 })).sort((a, b) => b.w - a.w),
    };
  }

  /* ---------------------------------------------------------------- Trades und Kalender */
  // Trade: { id, datum (Schließtag), eroeffnet, slug, instrument, richtung long|short, stueck, ein, aus, waehrung, fx,
  //          gebuehren (€), ergebnis (€, nur wenn ohne Kurse eingetragen), notiz, erstellt }
  const zahlOder = (x) => { const v = typeof x === "string" ? Number(x.replace(",", ".")) : Number(x); return x == null || x === "" || !isFinite(v) ? null : v; };
  function tradePruefen(t, slugs) {
    if (!t || typeof t !== "object" || !istDatum(t.datum)) return null;
    const slug = t.slug == null || t.slug === "" ? null : t.slug;
    if (slug != null && (typeof slug !== "string" || !SLUG.test(slug) || (slugs && !slugs.has(slug)))) return null;
    const stueck = zahlOder(t.stueck), ein = zahlOder(t.ein), aus = zahlOder(t.aus), ergebnis = zahlOder(t.ergebnis), fx = zahlOder(t.fx);
    const mitKursen = stueck > 0 && ein > 0 && aus > 0;
    if (!mitKursen && ergebnis == null) return null;            // ohne Kurse braucht es ein Ergebnis
    const instrument = text(t.instrument, 80).trim();
    if (!slug && !instrument) return null;
    return {
      id: typeof t.id === "string" && ID.test(t.id) ? t.id : neueId(), datum: t.datum, eroeffnet: istDatum(t.eroeffnet) && t.eroeffnet <= t.datum ? t.eroeffnet : null,
      slug, instrument, richtung: t.richtung === "short" ? "short" : "long",
      stueck: mitKursen ? stueck : null, ein: mitKursen ? ein : null, aus: mitKursen ? aus : null,
      waehrung: /^[A-Za-z]{3}$/.test(t.waehrung || "") ? t.waehrung.toUpperCase() : "EUR", fx: fx > 0 && fx < 1000 ? fx : 1,
      gebuehren: Math.max(0, zahlOder(t.gebuehren) || 0), ergebnis: mitKursen ? null : ergebnis, notiz: text(t.notiz, 600), erstellt: zeit(t.erstellt) || Date.now(),
    };
  }
  // Ergebnis in Euro nach Gebühren; fx = Euro je Einheit der Handelswährung (zum Zeitpunkt des Eintrags)
  function tradeErgebnis(t) {
    if (t.ergebnis != null) return t.ergebnis - (t.gebuehren || 0);
    const roh = (t.aus - t.ein) * t.stueck * (t.richtung === "short" ? -1 : 1);
    return roh * (t.fx || 1) - (t.gebuehren || 0);
  }
  const tradeRendite = (t) => (t.ein && t.stueck ? tradeErgebnis(t) / (t.ein * t.stueck * (t.fx || 1)) : null);

  // Datum aus Depot-Dateien: 2024-03-12 oder 12.03.2024
  function isoAus(d) {
    if (istDatum(d)) return d;
    const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(d || "");
    if (!m) return null;
    const iso = `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    return istDatum(iso) ? iso : null;
  }
  // Realisierte Gewinne aus den Depot-Umsätzen (Durchschnittskosten, wie die Positionstabelle). Ein Verkauf = ein Trade.
  function depotTrades(transaktionen, zuordnen) {
    const bestand = {}, aus = [];
    (transaktionen || []).filter((x) => x && isoAus(x.datum) && x.stueck > 0 && x.betrag >= 0)
      .map((x) => Object.assign({}, x, { iso: isoAus(x.datum) }))
      .sort((a, b) => a.iso.localeCompare(b.iso) || b.richtung - a.richtung)
      .forEach((x) => {
        const k = x.isin || x.symbol || x.wkn || x.name;
        const q = (bestand[k] = bestand[k] || { stueck: 0, einstand: 0, erster: x.iso });
        if (x.richtung > 0) { if (!q.stueck) q.erster = x.iso; q.stueck += x.stueck; q.einstand += x.betrag; return; }
        if (q.stueck <= 1e-9) return;                                 // Verkauf ohne bekannten Kauf: kein Ergebnis berechenbar
        const v = Math.min(x.stueck, q.stueck), erloes = (x.betrag * v) / x.stueck, kosten = (q.einstand * v) / q.stueck;
        aus.push({ id: "depot-" + aus.length, quelle: "depot", datum: x.iso, eroeffnet: q.erster, slug: zuordnen ? zuordnen(x) : null,
          instrument: x.name || x.symbol || x.isin || "Position", richtung: "long", stueck: v, ein: kosten / v, aus: erloes / v,
          waehrung: "EUR", fx: 1, gebuehren: 0, ergebnis: null });
        q.einstand -= kosten; q.stueck -= v;
      });
    return aus;
  }

  // Kennzahlen über eine Liste von Trades
  function statistik(trades) {
    const e = trades.map(tradeErgebnis), plus = e.filter((x) => x > 0), minus = e.filter((x) => x < 0);
    const tage = {};
    trades.forEach((t, i) => { tage[t.datum] = (tage[t.datum] || 0) + e[i]; });
    const tw = Object.entries(tage).sort((a, b) => a[1] - b[1]);
    const summe = (l) => l.reduce((s, x) => s + x, 0);
    return {
      n: trades.length, netto: summe(e), gewinner: plus.length, verlierer: minus.length,
      quote: trades.length ? plus.length / trades.length : null,
      profitFaktor: minus.length ? summe(plus) / -summe(minus) : plus.length ? Infinity : null,
      schnittGewinn: plus.length ? summe(plus) / plus.length : null, schnittVerlust: minus.length ? summe(minus) / minus.length : null,
      groessterGewinn: plus.length ? Math.max(...plus) : null, groessterVerlust: minus.length ? Math.min(...minus) : null,
      handelstage: tw.length, gruenTage: tw.filter(([, v]) => v > 0).length,
      besterTag: tw.length && tw[tw.length - 1][1] > 0 ? { tag: tw[tw.length - 1][0], wert: tw[tw.length - 1][1] } : null,
      schlechtesterTag: tw.length && tw[0][1] < 0 ? { tag: tw[0][0], wert: tw[0][1] } : null,
    };
  }

  // Monatsraster (Montag zuerst): Wochen mit je 7 Tagen { iso, imMonat, summe, n } und der Wochensumme
  function monatsKalender(trades, jahr, monat) {
    const proTag = {};
    trades.forEach((t) => { const d = (proTag[t.datum] = proTag[t.datum] || { summe: 0, n: 0 }); d.summe += tradeErgebnis(t); d.n++; });
    const erster = new Date(jahr, monat, 1, 12), start = new Date(erster);
    start.setDate(1 - ((erster.getDay() + 6) % 7));
    const wochen = [];
    for (let d = new Date(start); wochen.length < 6; ) {
      const tage = [];
      for (let i = 0; i < 7; i++, d.setDate(d.getDate() + 1)) {
        const iso = isoTag(d.getTime()), x = proTag[iso];
        tage.push({ iso, tag: d.getDate(), imMonat: d.getMonth() === monat, summe: x ? x.summe : null, n: x ? x.n : 0 });
      }
      if (!tage.some((t) => t.imMonat)) break;
      const imM = tage.filter((t) => t.imMonat && t.n);
      wochen.push({ tage, summe: imM.length ? imM.reduce((s, t) => s + t.summe, 0) : null, n: imM.reduce((s, t) => s + t.n, 0) });
    }
    const mt = trades.filter((t) => t.datum.slice(0, 7) === `${jahr}-${String(monat + 1).padStart(2, "0")}`);
    return { jahr, monat, wochen, statistik: statistik(mt), trades: mt, max: Math.max(0, ...Object.values(proTag).map((d) => Math.abs(d.summe))) };
  }

  return { ARTEN, JOURNAL_ARTEN, alarmPruefen, pruefe, auswerten, offeneAlarme, alarmText, eintragPruefen, faellig, seitEintrag,
           termine, naechsterMeiner, depotLage, tageBis, tagText, isoTag, istDatum, neueId,
           tradePruefen, tradeErgebnis, tradeRendite, depotTrades, isoAus, statistik, monatsKalender, format: { zahl, pct, euroKurz } };
});
