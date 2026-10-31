/* Fathom: Backtest-Rechenkern (ohne Oberfläche, läuft im Browser und unter Node für die Tests).
 *
 * Grundsätze:
 *  - Kein Blick in die Zukunft: Wer zur Eröffnung einsteigt, sieht nur Kurse bis zum Vortagesschluss, die Lücke des
 *    Tages und Zahlen, die vor Börsenbeginn gemeldet wurden. Wirtschaftsdaten zählen ab der Minute ihrer
 *    Veröffentlichung; eingestiegen wird frühestens eine Minute danach.
 *  - Feinste verfügbare Auflösung: Minutenkerzen um Termine, sonst Stundenkerzen, sonst Tageskerzen. Take-Profit,
 *    Stop und Zwangsschließung werden Kerze für Kerze geprüft. Treffen Ziel und Stop in derselben Kerze, zählt der
 *    Stop (die Reihenfolge innerhalb der Kerze ist unbekannt). Öffnet der Kurs jenseits einer Marke, wird zur
 *    Eröffnung ausgeführt (Kurslücke, kein Wunschpreis).
 *  - Geld- und Briefkurse: Long kauft zum Brief- und verkauft zum Geldkurs, Short umgekehrt. Ziel und Stop beziehen
 *    sich auf den Kurs, zu dem die Position tatsächlich geschlossen würde.
 *  - Hebel: Gewinn und Verlust auf den Einsatz = Hebel × Kursbewegung. Zwangsschließung, wenn der Verlust einen Anteil
 *    des Einsatzes erreicht (EU-Regel für Privatkunden: 50 %). Finanzierung je Nacht auf den geliehenen Teil.
 *  - Je Wert höchstens eine Position gleichzeitig, je Quartalsmeldung bzw. Termin höchstens ein Trade.
 *  - Kriterien rechnen mit denselben Definitionen wie der Wochenbericht (src/pruefstand.py, src/kriterien.py).
 */
(function (wurzel, fabrik) {
  const kern = fabrik();
  if (typeof module === "object" && module.exports) module.exports = kern;
  else wurzel.WBBacktestKern = kern;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const J = 252;
  const TAG_MS = 864e5;

  /* ---------------------------------------------------------------- Daten */
  // Kursreihe aus ganzen Zahlen in Punkten (siehe src/backtest.py): c als Abstände, o/h/l relativ zum Schluss
  function reiheAus(r, dez, einheit) {
    const n = r.c.length, f = Math.pow(10, -dez), u = r.u || einheit || 1;
    const t = new Float64Array(n), o = new Float64Array(n), h = new Float64Array(n), l = new Float64Array(n), c = new Float64Array(n), sp = new Float64Array(n);
    let ci = 0;
    for (let i = 0; i < n; i++) {
      ci += r.c[i];
      t[i] = i ? t[i - 1] + r.dt[i - 1] * u : r.t0;
      c[i] = ci * f; o[i] = (ci + r.o[i]) * f; h[i] = (ci + r.h[i]) * f; l[i] = (ci + r.l[i]) * f;
      sp[i] = r.sp ? r.sp[i] * f : 0;
    }
    return { n, t, o, h, l, c, sp, u, mitSpread: !!r.sp };
  }

  function dekodiere(w) {
    const n = w.c.length;
    const tag = new Int32Array(n);
    tag[0] = w.d0;
    for (let i = 1; i < n; i++) tag[i] = tag[i - 1] + w.dd[i - 1];
    let o, h, l, c, sp = null, to = null;
    if (w.dez != null) {
      const r = reiheAus(w, w.dez, 1);
      ({ o, h, l, c } = r); to = r.t; if (r.mitSpread) sp = r.sp;
    } else { // älteres Format: Schlusskurse, o/h/l in Basispunkten
      c = Float64Array.from(w.c); o = new Float64Array(n); h = new Float64Array(n); l = new Float64Array(n);
      for (let i = 0; i < n; i++) { o[i] = c[i] * (1 + w.o[i] / 1e4); h[i] = c[i] * (1 + w.h[i] / 1e4); l[i] = c[i] * (1 + w.l[i] / 1e4); }
    }
    const e = (w.e || []).map(([i, sch, ist, d]) => ({ i, sch, ist, d, u: sch != null && sch > 0 ? ist / sch - 1 : null }))
      .sort((a, b) => a.i - b.i);
    return { s: w.s, name: w.n, typ: w.t, waehrung: w.w, quelle: w.q || null, dez: w.dez != null ? w.dez : null, tag, to, sl: w.sl || 390, o, h, l, c, sp, e, n,
             nurSchluss: !!w.nur_schluss, pr: w.pr || null, iUrl: w.i || null, im: w.im || 0, std: null, min: null, minKeys: null, r: {} };
  }
  // Stunden- und Minutenkerzen nachladen (daten/backtest/<wert>.json)
  function intraday(w, j) {
    w.std = j.h && j.h.c && j.h.c.length ? reiheAus(j.h, j.dez, 60) : null;
    w.min = new Map();
    Object.entries(j.m || {}).forEach(([k, r]) => { if (r.c && r.c.length) w.min.set(+k, reiheAus(r, j.dez, 1)); });
    w.minKeys = Float64Array.from([...w.min.keys()].sort((a, b) => a - b));
    return w;
  }
  function wirtschaft(liste) {
    return (liste || []).map((x) => {
      const termine = x.termine.map(([t, ist, prog, vor, periode]) => ({ t, ist, prog, vor, periode })).sort((a, b) => a.t - b.t);
      return Object.assign({}, x, { termine, nachZeit: new Map(termine.map((e) => [e.t, e])) });
    });
  }

  const wochentag = (t) => (t + 4) % 7; // 1970-01-01 war ein Donnerstag; 0 = Sonntag
  const datum = (t) => new Date(t * TAG_MS).toISOString().slice(0, 10);
  const monat = (t) => new Date(t * TAG_MS).getUTCMonth() + 1;
  const jahr = (t) => new Date(t * TAG_MS).getUTCFullYear();
  const beginn = (w, i) => (w.to ? w.to[i] : w.tag[i] * 1440 + 870);
  const ende = (w, i) => beginn(w, i) + w.sl;
  // erster Index mit a[i] >= x
  function abHier(a, x, n = a.length) { let lo = 0, hi = n; while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] < x) lo = m + 1; else hi = m; } return lo; }
  function tagAb(w, minute) { // erster Handelstag, der zu oder nach `minute` beginnt
    if (w.to) return abHier(w.to, minute);
    let i = 0; while (i < w.n && beginn(w, i) < minute) i++; return i;
  }
  function tagBei(w, minute) { // letzter Handelstag, der vor oder zu `minute` begonnen hat
    return Math.max(0, tagAb(w, minute + 1) - 1);
  }

  /* ---------------------------------------------------------------- Kerzen ab einem Zeitpunkt (feinste Auflösung) */
  function* kerzenAb(w, ab) {
    let jetzt = ab;
    if (w.min && w.minKeys.length) {
      const k = abHier(w.minKeys, ab + 6) - 1; // Fenster beginnt 5 Minuten vor dem Termin
      const r = k >= 0 ? w.min.get(w.minKeys[k]) : null;
      if (r && r.t[0] <= ab && ab < r.t[r.n - 1] + 1) {
        for (let i = abHier(r.t, ab); i < r.n; i++) yield { t: r.t[i], ende: r.t[i] + 1, o: r.o[i], h: r.h[i], l: r.l[i], c: r.c[i], sp: r.sp[i], aufl: "min" };
        jetzt = r.t[r.n - 1] + 1;
      }
    }
    if (w.std && w.std.n && jetzt >= w.std.t[0]) {
      const r = w.std;
      for (let i = abHier(r.t, jetzt); i < r.n; i++) yield { t: r.t[i], ende: r.t[i] + 60, o: r.o[i], h: r.h[i], l: r.l[i], c: r.c[i], sp: r.sp[i], aufl: "std" };
      jetzt = Math.max(jetzt, r.t[r.n - 1] + 60);
    }
    for (let i = tagAb(w, jetzt); i < w.n; i++) {
      yield { t: beginn(w, i), ende: ende(w, i), o: w.o[i], h: w.h[i], l: w.l[i], c: w.c[i], sp: w.sp ? w.sp[i] : 0, aufl: "tag" };
    }
  }

  /* ---------------------------------------------------------------- Kennzahlen je Handelstag (wie pruefstand.reihen) */
  const leer = (n) => new Float64Array(n).fill(NaN);
  function rollend(x, fenster, minDaten, fn) {
    const n = x.length, aus = leer(n);
    for (let i = 0; i < n; i++) {
      const werte = [];
      for (let j = Math.max(0, i - fenster + 1); j <= i; j++) if (!Number.isNaN(x[j])) werte.push(x[j]);
      if (werte.length >= minDaten) aus[i] = fn(werte);
    }
    return aus;
  }
  const mittel = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  const stdAbw = (a) => { const m = mittel(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
  const median = (a) => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  function gleitend(x, fenster, minDaten) { // gleitender Mittelwert in O(n) für lückenlose Reihen
    const n = x.length, aus = leer(n); let summe = 0;
    for (let i = 0; i < n; i++) {
      summe += x[i]; if (i >= fenster) summe -= x[i - fenster];
      const anzahl = Math.min(i + 1, fenster);
      if (anzahl >= minDaten) aus[i] = summe / anzahl;
    }
    return aus;
  }
  function extrem(x, fenster, groesser) {
    const n = x.length, aus = leer(n);
    for (let i = fenster - 1; i < n; i++) {
      let m = x[i];
      for (let j = i - fenster + 1; j < i; j++) if (groesser ? x[j] > m : x[j] < m) m = x[j];
      aus[i] = m;
    }
    return aus;
  }
  const verschoben = (x, k) => { const aus = leer(x.length); for (let i = k; i < x.length; i++) aus[i] = x[i - k]; return aus; };

  function reihe(w, name) {
    if (w.r[name]) return w.r[name];
    const c = w.c, n = w.n;
    const r = w.r;
    const brauch = (k) => reihe(w, k);
    let aus;
    switch (name) {
      case "kurs": aus = c; break;
      case "hoch": aus = extrem(c, J, true); break;
      case "tief": aus = extrem(c, J, false); break;
      case "abstand_hoch": { const h = brauch("hoch"); aus = leer(n); for (let i = 0; i < n; i++) aus[i] = 1 - c[i] / h[i]; break; }
      case "position_spanne": {
        const h = brauch("hoch"), t = brauch("tief"); aus = leer(n);
        for (let i = 0; i < n; i++) { const sp = h[i] - t[i]; aus[i] = sp > 0 ? (c[i] - t[i]) / sp : NaN; }
        break;
      }
      case "momentum_12_1": { const a = verschoben(c, 21), b = verschoben(c, J); aus = leer(n); for (let i = 0; i < n; i++) aus[i] = a[i] / b[i] - 1; break; }
      case "mittel_5j": aus = gleitend(c, 5 * J, J); break;
      case "abweichung_mittel_5j": { const m = brauch("mittel_5j"); aus = leer(n); for (let i = 0; i < n; i++) aus[i] = c[i] / m[i] - 1; break; }
      case "renditen": { aus = leer(n); for (let i = 1; i < n; i++) aus[i] = c[i] / c[i - 1] - 1; break; }
      case "vol_1m": aus = rollend(brauch("renditen"), 21, 21, (a) => stdAbw(a) * Math.sqrt(J)); break;
      case "vol_median_1j": aus = rollend(brauch("vol_1m"), J, 200, median); break;
      case "vol_verhaeltnis": { const v = brauch("vol_1m"), m = brauch("vol_median_1j"); aus = leer(n); for (let i = 0; i < n; i++) aus[i] = v[i] / m[i]; break; }
      case "gd200": aus = gleitend(c, 200, 200); break;
      case "abstand_gd200": { const g = brauch("gd200"); aus = leer(n); for (let i = 0; i < n; i++) aus[i] = c[i] / g[i] - 1; break; }
      case "kurs_3m": aus = verschoben(c, 63); break;
      case "rendite_3m": { const k = brauch("kurs_3m"); aus = leer(n); for (let i = 0; i < n; i++) aus[i] = c[i] / k[i] - 1; break; }
      case "vol_1j": aus = rollend(brauch("renditen"), J - 1, 200, (a) => stdAbw(a) * Math.sqrt(J)); break;
      default: throw new Error("Unbekannte Kennzahl " + name);
    }
    r[name] = aus;
    return aus;
  }
  function wert(w, name, i) { if (i < 0) return null; const x = reihe(w, name)[i]; return Number.isFinite(x) ? x : null; }

  /* ---------------------------------------------------------------- Kriterien (wie kriterien.pruefe → erfuellt) */
  function teilOk(t, w, i, P) {
    const x = wert(w, t.k, i);
    if (x == null) return null;
    const g = P[t.p] * (t.skal || 1) * (t.vz || 1);
    return t.log ? (t.r === ">=" ? Math.log10(Math.max(x, 1)) >= Math.log10(g) : Math.log10(Math.max(x, 1)) <= Math.log10(g))
      : (t.r === ">=" ? x >= g : x <= g);
  }
  function kriteriumErfuellt(k, w, i, P) {
    const teile = k.teile.map((t) => teilOk(t, w, i, P));
    const bekannt = teile.filter((x) => x != null);
    if (!bekannt.length) return null;
    if (k.verkn === "oder") return bekannt.some(Boolean);
    if (k.verkn === "und") return teile.every((x) => x === true);
    return teile[0];
  }

  /* ---------------------------------------------------------------- Fakten */
  const VERGLEICH = [[">=", "mindestens"], ["<=", "höchstens"]];
  const TAGE = [["1", "Montag"], ["2", "Dienstag"], ["3", "Mittwoch"], ["4", "Donnerstag"], ["5", "Freitag"]];
  const MONATE = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
  const MONAT_OPT = MONATE.map((m, i) => [String(i + 1), m]);
  const GRUPPEN = { signal: "Wann einsteigen", handel: "Wie handeln", ausstieg: "Wann aussteigen", risiko: "Kapital, Hebel und Kosten" };
  const pz = (x) => String(x).replace(".", ",").replace("-", "−");
  const vgl = (r) => (r === ">=" ? "mindestens" : "höchstens");
  const EINSTIEG_EREIGNIS = [["1", "1 Minute danach"], ["5", "5 Minuten danach"], ["15", "15 Minuten danach"], ["30", "30 Minuten danach"],
    ["60", "1 Stunde danach"], ["eroeffnung", "zur nächsten Börseneröffnung"]];
  const HALTE_EINHEIT = [["tage", "Handelstage"], ["stunden", "Stunden"], ["minuten", "Minuten"]];
  const BEZUG = [["kurs", "vom Kurs"], ["einsatz", "vom Einsatz"]];
  let EREIGNISSE = []; // vom Aufrufer gesetzt (Namen und Einheiten für Sätze)
  const indikator = (id) => EREIGNISSE.find((x) => x.id === id);
  const einheitText = (ind, masz) => (masz === "relativ" ? "%" : ind && ind.einheit === "%" ? "Prozentpunkte" : ind ? ind.einheit : "");
  const FAKTEN = {
    ereignis: { gruppe: "signal", titel: "Wirtschaftsdaten", felder: [
      { k: "ind", art: "ereignis" },
      { k: "vergleich", art: "wahl", vor: "Ist", opt: [["prognose", "gegenüber der Prognose"], ["vorwert", "gegenüber dem Vorwert"], ["wert", "als Wert"]], std: "prognose" },
      { k: "seite", art: "wahl", opt: [["ueber", "darüber"], ["unter", "darunter"]], std: "ueber" },
      { k: "abstand", art: "zahl", vor: "um mindestens", nach: "@einheit", std: 0.25, min: -100000, max: 100000, schritt: 0.25 },
      { k: "masz", art: "wahl", opt: [["absolut", "in der Einheit des Werts"], ["relativ", "in % des Vergleichswerts"]], std: "absolut" },
      { k: "einstieg", art: "wahl", vor: "Einstieg", opt: EINSTIEG_EREIGNIS, std: "1" }],
      satz: (f) => {
        const ind = indikator(f.ind), name = ind ? ind.kurz : f.ind, e = einheitText(ind, f.masz);
        const ein = (EINSTIEG_EREIGNIS.find((x) => x[0] === String(f.einstieg)) || [0, ""])[1];
        if (f.vergleich === "wert") return `${name} ${f.seite === "unter" ? "höchstens" : "mindestens"} ${pz(f.abstand)} ${ind && ind.einheit === "%" ? "%" : e}, Einstieg ${ein}`;
        const ref = f.vergleich === "vorwert" ? "dem Vorwert" : "der Prognose";
        const um = +f.abstand > 0 ? ` um mindestens ${pz(f.abstand)} ${e}` : "";
        return `${name}${um} ${f.seite === "unter" ? "unter" : "über"} ${ref}, Einstieg ${ein}`;
      } },
    zahlen: { gruppe: "signal", titel: "Quartalszahlen", nur: ["aktie"], felder: [
      { k: "seite", art: "wahl", opt: [["besser", "über der Schätzung"], ["schlechter", "unter der Schätzung"]], std: "besser" },
      { k: "min", art: "zahl", vor: "um mindestens", nach: "%", std: 0, min: 0, max: 200, schritt: 0.25 },
      { k: "fenster", art: "zahl", vor: "Einstieg bis", nach: "Handelstage danach", std: 5, min: 1, max: 60, schritt: 1 }],
      satz: (f) => `Gewinn je Aktie ${f.seite === "besser" ? "über" : "unter"} der Schätzung${+f.min > 0 ? ` (um mindestens ${pz(f.min)} %)` : ""}, Einstieg innerhalb von ${f.fenster} Handelstagen nach den Zahlen` },
    wochentag: { gruppe: "signal", titel: "Wochentag", felder: [{ k: "tag", art: "wahl", opt: TAGE, std: "1" }],
      satz: (f) => `nur ${TAGE.find((t) => t[0] === String(f.tag))[1].toLowerCase()}s` },
    kriterium: { gruppe: "signal", titel: "Fathom-Signal", felder: [{ k: "name", art: "kriterium" },
      { k: "soll", art: "wahl", opt: [["ja", "erfüllt"], ["nein", "nicht erfüllt"]], std: "ja" }],
      satz: (f) => `Signal ${f.name} ${f.soll === "ja" ? "erfüllt" : "nicht erfüllt"}` },
    trend: { gruppe: "signal", titel: "Trend", felder: [{ k: "lage", art: "wahl", opt: [["ueber", "Kurs über der 200-Tage-Linie"], ["unter", "Kurs unter der 200-Tage-Linie"]], std: "ueber" }],
      satz: (f) => `Kurs ${f.lage === "ueber" ? "über" : "unter"} der 200-Tage-Linie` },
    rendite: { gruppe: "signal", titel: "Kursveränderung", felder: [
      { k: "tage", art: "zahl", vor: "über", nach: "Handelstage", std: 20, min: 1, max: 260, schritt: 1 },
      { k: "r", art: "wahl", opt: VERGLEICH, std: "<=" }, { k: "wert", art: "zahl", nach: "%", std: -5, min: -95, max: 500, schritt: 0.25 }],
      satz: (f) => `Kursveränderung über ${f.tage} Handelstage ${vgl(f.r)} ${pz(f.wert)} %` },
    vortag: { gruppe: "signal", titel: "Letzter Handelstag", felder: [{ k: "r", art: "wahl", opt: VERGLEICH, std: "<=" },
      { k: "wert", art: "zahl", nach: "%", std: -2, min: -50, max: 50, schritt: 0.25 }],
      satz: (f) => `Tagesveränderung zuletzt ${vgl(f.r)} ${pz(f.wert)} %` },
    luecke: { gruppe: "signal", titel: "Eröffnungslücke", felder: [{ k: "r", art: "wahl", opt: VERGLEICH, std: ">=" },
      { k: "wert", art: "zahl", nach: "%", std: 1, min: -50, max: 50, schritt: 0.25 }],
      satz: (f) => `Eröffnung ${vgl(f.r)} ${pz(f.wert)} % gegenüber dem Vortagesschluss` },
    hoch: { gruppe: "signal", titel: "Abstand zum 52-Wochen-Hoch", felder: [{ k: "r", art: "wahl", opt: VERGLEICH, std: ">=" },
      { k: "wert", art: "zahl", nach: "%", std: 10, min: 0, max: 99, schritt: 0.25 }],
      satz: (f) => `${vgl(f.r)} ${pz(f.wert)} % unter dem 52-Wochen-Hoch` },
    vola: { gruppe: "signal", titel: "Volatilität (1 Monat, annualisiert)", felder: [{ k: "r", art: "wahl", opt: VERGLEICH, std: "<=" },
      { k: "wert", art: "zahl", nach: "%", std: 30, min: 1, max: 300, schritt: 0.25 }],
      satz: (f) => `Volatilität ${vgl(f.r)} ${pz(f.wert)} %` },
    monat: { gruppe: "signal", titel: "Kalendermonate", felder: [{ k: "von", art: "wahl", vor: "von", opt: MONAT_OPT, std: "1" },
      { k: "bis", art: "wahl", vor: "bis", opt: MONAT_OPT, std: "12" }],
      satz: (f) => `nur von ${MONATE[f.von - 1]} bis ${MONATE[f.bis - 1]}` },
    richtung: { gruppe: "handel", einmal: true, titel: "Richtung", felder: [{ k: "seite", art: "wahl", opt: [["long", "Long, auf steigende Kurse"], ["short", "Short, auf fallende Kurse"]], std: "long" }] },
    einstieg: { gruppe: "handel", einmal: true, titel: "Einstieg", felder: [{ k: "zeit", art: "wahl", opt: [["eroeffnung", "zur Eröffnung der Börsensitzung"], ["schluss", "zum Schluss der Börsensitzung"]], std: "eroeffnung" }] },
    tp: { gruppe: "ausstieg", einmal: true, titel: "Take-Profit", felder: [{ k: "wert", art: "zahl", vor: "Gewinnziel", nach: "%", std: 2, min: 0.25, max: 1000, schritt: 0.25 },
      { k: "bezug", art: "wahl", opt: BEZUG, std: "kurs" }] },
    sl: { gruppe: "ausstieg", einmal: true, titel: "Stop-Loss", felder: [{ k: "wert", art: "zahl", vor: "Verlust höchstens", nach: "%", std: 2, min: 0.25, max: 100, schritt: 0.25 },
      { k: "bezug", art: "wahl", opt: BEZUG, std: "kurs" }] },
    halten: { gruppe: "ausstieg", einmal: true, titel: "Haltedauer", felder: [{ k: "tage", art: "zahl", vor: "höchstens", std: 10, min: 1, max: 5000, schritt: 1 },
      { k: "einheit", art: "wahl", opt: HALTE_EINHEIT, std: "tage" }] },
    kapital: { gruppe: "risiko", einmal: true, titel: "Kapital und Einsatz", felder: [
      { k: "start", art: "zahl", vor: "Startkapital", nach: "€", std: 10000, min: 100, max: 1e9, schritt: 100 },
      { k: "wert", art: "zahl", vor: "Einsatz je Trade", std: 1000, min: 0.01, max: 1e9, schritt: 1 },
      { k: "art", art: "wahl", opt: [["betrag", "€"], ["prozent", "% des Kontos"]], std: "betrag" }] },
    hebel: { gruppe: "risiko", einmal: true, titel: "Hebel", felder: [
      { k: "wert", art: "regler", nach: "×", std: 10, min: 1, max: 100, schritt: 1 },
      { k: "zwang", art: "zahl", vor: "Zwangsschließung bei", nach: "% Verlust des Einsatzes", std: 50, min: 5, max: 100, schritt: 0.25 },
      { k: "zins", art: "zahl", vor: "Finanzierung", nach: "% p. a. über Nacht", std: 5, min: 0, max: 40, schritt: 0.25 }] },
    kosten: { gruppe: "risiko", einmal: true, titel: "Kommission", felder: [{ k: "wert", art: "zahl", nach: "% vom Positionswert je Kauf und Verkauf", std: 0.05, min: 0, max: 5, schritt: 0.01 }] },
    groesse: { gruppe: "risiko", einmal: true, alt: true, titel: "Positionsgröße", felder: [{ k: "wert", art: "zahl", nach: "% des Kapitals je Trade", std: 10, min: 1, max: 100, schritt: 1 }] },
  };
  const MAX_FAKTEN = 30; // genug für alle Signale einer Klasse plus Handel, Ausstieg und Risiko
  function standardFakt(typ) {
    const f = { typ };
    FAKTEN[typ].felder.forEach((d) => { if ("std" in d) f[d.k] = d.std; });
    if (typ === "ereignis" && EREIGNISSE.length) f.ind = EREIGNISSE[0].id;
    return f;
  }

  // EU-Höchsthebel für Privatkunden (ESMA): Forex-Hauptpaare 30, andere Paare, Gold und Hauptindizes 20, Rohstoffe 10, Aktien 5
  const HAUPT = ["USD", "EUR", "JPY", "GBP", "CAD", "CHF"];
  function esmaGrenze(w) {
    const s = String(w.s).toUpperCase();
    if (w.typ === "forex") { const p = s.replace("=X", ""); return HAUPT.includes(p.slice(0, 3)) && HAUPT.includes(p.slice(3, 6)) ? 30 : 20; }
    if (w.typ === "index") return ["^GDAXI", "^GSPC", "^NDX", "^STOXX50E", "^DJI", "^FTSE", "^N225", "^FCHI", "ES=F", "NQ=F"].includes(s) ? 20 : 10;
    if (w.typ === "rohstoff") return s === "GC=F" ? 20 : 10;
    return 5;
  }

  // Fakten → Strategie. katalog: Kriterien der Klasse (Spezifikation), P: Schwellen der Klasse
  function strategie(fakten, katalog, P, ereignisse) {
    const s = { bedingungen: [], ereignisse: [], long: true, eroeffnung: true, tp: null, tpEinsatz: false, sl: null, slEinsatz: false,
                halten: null, haltenEinheit: "tage", kapital: { start: 10000, art: "prozent", wert: 10 }, hebel: 1, zwang: 0.5, zins: 0.05,
                kosten: null, annahmen: [], gesetzt: {} };
    const inds = ereignisse || EREIGNISSE;
    for (const f of fakten) {
      const d = FAKTEN[f.typ];
      if (!d) continue;
      s.gesetzt[f.typ] = true;
      const zahl = (k) => Number(f[k]);
      switch (f.typ) {
        case "richtung": s.long = f.seite !== "short"; break;
        case "einstieg": s.eroeffnung = f.zeit !== "schluss"; break;
        case "tp": s.tp = zahl("wert") / 100; s.tpEinsatz = f.bezug === "einsatz"; break;
        case "sl": s.sl = zahl("wert") / 100; s.slEinsatz = f.bezug === "einsatz"; break;
        case "halten": s.halten = Math.max(1, Math.round(zahl("tage"))); s.haltenEinheit = f.einheit || "tage"; break;
        case "groesse": s.kapital = { start: 10000, art: "prozent", wert: Math.min(100, Math.max(1, zahl("wert"))) }; break;
        case "kapital": s.kapital = { start: Math.max(1, zahl("start") || 10000), art: f.art === "prozent" ? "prozent" : "betrag", wert: Math.max(0.01, zahl("wert") || 0) }; break;
        case "hebel": s.hebel = Math.min(100, Math.max(1, Math.round(zahl("wert") || 1))); s.zwang = Math.min(1, Math.max(0.05, (zahl("zwang") || 50) / 100));
          s.zins = Math.max(0, (Number.isFinite(zahl("zins")) ? zahl("zins") : 5) / 100); break;
        case "kosten": s.kosten = Math.max(0, zahl("wert") / 100); break;
        case "kriterium": {
          const k = (katalog || []).find((x) => x.name === f.name);
          if (!k || !k.kursbasiert) { s.annahmen.push(`Signal „${f.name || "?"}“ übersprungen: dafür gibt es keine Kurshistorie.`); break; }
          s.bedingungen.push({ f, k, P }); break;
        }
        case "ereignis": {
          const ind = inds.find((x) => x.id === f.ind);
          if (!ind) { s.annahmen.push("Wirtschaftsdaten-Fakt übersprungen: Für diesen Indikator liegen keine Termine vor."); break; }
          s.ereignisse.push({ f, ind }); break;
        }
        default: s.bedingungen.push({ f });
      }
    }
    if (s.ereignisse.length) {
      const e = s.ereignisse[0].f.einstieg;
      s.ereignisMinuten = e === "eroeffnung" ? null : Math.max(1, +e || 1);
      if (s.gesetzt.einstieg) s.annahmen.push("Mit einem Wirtschaftsdaten-Fakt bestimmt dessen Einstieg den Zeitpunkt; der Fakt „Einstieg“ zählt dann nicht.");
    }
    if (!s.gesetzt.richtung) s.annahmen.push("Richtung nicht angegeben: Long.");
    if (!s.gesetzt.einstieg && !s.ereignisse.length) s.annahmen.push("Einstieg nicht angegeben: zur Eröffnung.");
    if (s.tp == null && s.sl == null && s.halten == null) { s.halten = 20; s.annahmen.push("Keine Ausstiegsregel angegeben: Verkauf spätestens nach 20 Handelstagen."); }
    if (!s.gesetzt.kapital && !s.gesetzt.groesse) s.annahmen.push("Kapital nicht angegeben: 10 000 € Startkapital, Einsatz 10 % des Kontos je Trade.");
    if (s.hebel > 1 && !s.gesetzt.hebel) s.annahmen.push("Hebel ohne Angabe zur Finanzierung: 5 % p. a. auf den geliehenen Teil.");
    if (s.kosten == null) s.annahmen.push("Kommission nicht angegeben: 0 % bei Werten mit Geld- und Briefkursen (der Spread ist schon eingerechnet), sonst 0,05 % je Kauf und Verkauf.");
    return s;
  }

  // Erfüllt die Bedingung an Tag i? b = letzter Tag, dessen Schlusskurs beim Einstieg bekannt ist; kal = Kalendertag (Tage seit 1970)
  function bedingung(bd, w, i, b, verbraucht, kal) {
    const f = bd.f;
    const zahl = (k) => Number(f[k]);
    const cmp = (x, r, g) => x != null && Number.isFinite(x) && (r === ">=" ? x >= g : x <= g);
    const tagK = kal == null ? w.tag[i] : kal;
    switch (f.typ) {
      case "zahlen": {
        let e = null;
        for (const x of w.e) { if (x.i <= i) e = x; else break; }
        if (!e || i - e.i >= zahl("fenster") || verbraucht.has(e.i) || e.sch == null) return false;
        const min = zahl("min") / 100;
        const ok = f.seite === "schlechter" ? e.ist < e.sch && (min <= 0 || (e.u != null && e.u <= -min))
          : e.ist > e.sch && (min <= 0 || (e.u != null && e.u >= min));
        return ok ? { ereignis: e } : false;
      }
      case "wochentag": return wochentag(tagK) === zahl("tag");
      case "monat": { const m = monat(tagK), v = zahl("von"), bis = zahl("bis"); return v <= bis ? m >= v && m <= bis : m >= v || m <= bis; }
      case "kriterium": return b >= 0 && kriteriumErfuellt(bd.k, w, b, bd.P) === (f.soll !== "nein");
      case "trend": { const g = wert(w, "gd200", b); return g != null && (f.lage === "unter" ? w.c[b] < g : w.c[b] > g); }
      case "rendite": { const t = Math.round(zahl("tage")); return b - t >= 0 && cmp(w.c[b] / w.c[b - t] - 1, f.r, zahl("wert") / 100); }
      case "vortag": return b >= 1 && cmp(w.c[b] / w.c[b - 1] - 1, f.r, zahl("wert") / 100);
      case "luecke": return i >= 1 && cmp(w.o[i] / w.c[i - 1] - 1, f.r, zahl("wert") / 100);
      case "hoch": return cmp(wert(w, "abstand_hoch", b), f.r, zahl("wert") / 100);
      case "vola": return cmp(wert(w, "vol_1m", b), f.r, zahl("wert") / 100);
      default: return false;
    }
  }
  // Wirtschaftsdaten: Ist gegenüber Prognose/Vorwert oder als Wert
  function ereignisErfuellt(f, e) {
    if (!e || e.ist == null) return false;
    const a = Number(f.abstand) || 0, ueber = f.seite !== "unter";
    if (f.vergleich === "wert") return ueber ? e.ist >= a : e.ist <= a;
    const ref = f.vergleich === "vorwert" ? e.vor : e.prog;
    if (ref == null) return false;
    const diff = f.masz === "relativ" ? (ref === 0 ? null : ((e.ist - ref) / Math.abs(ref)) * 100) : e.ist - ref;
    if (diff == null) return false;
    const eps = 1e-9;
    return ueber ? (a > 0 ? diff >= a - eps : diff > eps) : (a > 0 ? diff <= -a + eps : diff < -eps);
  }

  /* ---------------------------------------------------------------- Ein Trade: Einstieg, Kerze für Kerze bis zum Ausstieg */
  // e = { ab: Minute, preis: Mittelkurs oder null (= Eröffnung der ersten Kerze), sp, tag: Handelstag des Einstiegs }
  function handel(w, s, e) {
    const dir = s.long ? 1 : -1, hebel = s.hebel;
    const kosten = s.kosten != null ? s.kosten : (w.sp ? 0 : 0.0005);
    const it = kerzenAb(w, e.ab);
    let k = it.next();
    if (k.done) return null;
    const erste = k.value, beiEroeffnung = e.preis == null;
    const mitteEin = beiEroeffnung ? erste.o : e.preis, spEin = beiEroeffnung ? erste.sp : (e.sp || 0);
    const ein = mitteEin + dir * spEin / 2, einMin = beiEroeffnung ? erste.t : e.ab;
    const tpK = s.tp == null ? null : s.tpEinsatz ? s.tp / hebel : s.tp;
    const slK = s.sl == null ? null : s.slEinsatz ? s.sl / hebel : s.sl;
    const ziel = tpK == null ? null : ein * (1 + dir * tpK);
    const stop = slK == null ? null : ein * (1 - dir * slK);
    const zwang = hebel > 1 ? ein * (1 - dir * s.zwang / hebel) : null;
    // Wer zuerst getroffen würde: bei Long die höhere Marke, bei Short die niedrigere
    const marken = [[stop, "stop"], [zwang, "zwang"]].filter((m) => m[0] != null).sort((a, b) => dir * (b[0] - a[0]));
    let frist = null;
    if (s.halten != null) {
      if (s.haltenEinheit === "stunden") frist = einMin + s.halten * 60;
      else if (s.haltenEinheit === "minuten") frist = einMin + s.halten;
      else frist = ende(w, Math.min(w.n - 1, (e.haltAb != null ? e.haltAb : e.tag) + s.halten - 1));
    }
    const fein = { min: 0, std: 0, tag: 0 };
    const raus = (kerze, kurs, grund, extra) => {
      const ausMin = extra && extra.zeitpunkt != null ? extra.zeitpunkt : kerze.ende;
      const brutto = dir * (kurs / ein - 1);
      const naechte = Math.max(0, Math.floor(ausMin / 1440) - Math.floor(einMin / 1440));
      const kostenR = 2 * kosten * hebel, finanzR = hebel > 1 ? (hebel - 1) * s.zins / 365 * naechte : 0;
      return Object.assign({ w, einMin, ausMin, ein, aus: kurs, grund, dir, brutto, netto: hebel * brutto - kostenR - finanzR, kostenR, finanzR, naechte,
                             tagEin: e.tag, tagAus: tagBei(w, ausMin - 1), aufl: kerze.aufl, fein, ungenau: !!e.ungenau }, extra || {});
    };
    let letzte = erste;
    for (; !k.done; k = it.next()) {
      const b = k.value; letzte = b; fein[b.aufl]++;
      const zu = (m) => m - dir * b.sp / 2; // Kurs, zu dem die Position schließt (Long: Geld, Short: Brief)
      const istErste = b === erste && beiEroeffnung;
      if (!istErste) {
        const op = zu(b.o);
        for (const [lvl, grund] of marken) if (dir > 0 ? op <= lvl : op >= lvl) return raus(b, op, grund, { luecke: true, zeitpunkt: b.t });
        if (ziel != null && (dir > 0 ? op >= ziel : op <= ziel)) return raus(b, op, "ziel", { luecke: true, zeitpunkt: b.t });
      }
      const schlecht = zu(dir > 0 ? b.l : b.h), gut = zu(dir > 0 ? b.h : b.l);
      const zielTreffer = ziel != null && (dir > 0 ? gut >= ziel : gut <= ziel);
      for (const [lvl, grund] of marken) {
        if (dir > 0 ? schlecht <= lvl : schlecht >= lvl) return raus(b, lvl, grund, { beide: zielTreffer, zeitpunkt: b.t + (b.ende - b.t) / 2 });
      }
      if (zielTreffer) return raus(b, ziel, "ziel", { zeitpunkt: b.t + (b.ende - b.t) / 2 });
      if (frist != null && b.ende >= frist) return raus(b, zu(b.c), "zeit");
    }
    return raus(letzte, letzte.c - dir * letzte.sp / 2, "offen");
  }

  /* ---------------------------------------------------------------- Trades je Wert */
  function tradesWert(w, s, vonTag) {
    const trades = [], verbraucht = new Set(), letzter = w.n - 1;
    let i = 1;
    while (i < w.n && w.tag[i] < vonTag) i++;
    for (; i <= letzter; i++) {
      const b = s.eroeffnung ? i - 1 : i;
      let ok = true, ereignis = null;
      for (const bd of s.bedingungen) {
        const r = bedingung(bd, w, i, b, verbraucht);
        if (!r) { ok = false; break; }
        if (r.ereignis) ereignis = r.ereignis;
      }
      if (!ok) continue;
      if (s.eroeffnung && i === letzter) break; // Einstieg in der letzten Kerze: kein Verlauf mehr
      const t = handel(w, s, s.eroeffnung ? { ab: beginn(w, i), preis: null, tag: i }
        : { ab: ende(w, i), preis: w.c[i], sp: w.sp ? w.sp[i] : 0, tag: i, haltAb: i + 1 });
      if (!t) break;
      if (ereignis) { verbraucht.add(ereignis.i); t.zahlen = ereignis; }
      trades.push(t);
      i = Math.max(i, t.tagAus);
    }
    return trades;
  }

  // Wirtschaftsdaten als Auslöser: je Termin höchstens ein Trade
  function tradesEreignis(w, s, vonTag) {
    const trades = [], verbraucht = new Set(), haupt = s.ereignisse[0];
    let frei = -Infinity;
    for (const e of haupt.ind.termine) {
      if (e.t < vonTag * 1440 || e.t < frei) continue;
      if (!s.ereignisse.every((x) => ereignisErfuellt(x.f, x.ind.nachZeit.get(e.t)))) continue;
      const k = tagAb(w, e.t); // nächste Eröffnung nach der Veröffentlichung
      if (k >= w.n) continue;
      const j = k > 0 && ende(w, k - 1) > e.t ? k - 1 : null; // Sitzung, in die die Veröffentlichung fällt
      const iKal = j != null ? j : k, b = iKal - 1;
      const kal = Math.floor(e.t / 1440);
      if (!s.bedingungen.every((bd) => bedingung(bd, w, iKal, b, verbraucht, kal))) continue;
      let start;
      if (s.ereignisMinuten != null) {
        const ab = e.t + s.ereignisMinuten;
        const hatMinuten = w.min && w.min.has(e.t);
        start = hatMinuten ? { ab, preis: null, tag: iKal } : { ab: w.std ? Math.ceil(ab / 60) * 60 : beginn(w, k), preis: null, tag: w.std ? iKal : k, ungenau: true };
      } else start = { ab: beginn(w, k), preis: null, tag: k };
      const t = handel(w, s, start);
      if (!t) continue;
      t.termin = Object.assign({ id: haupt.ind.id, kurz: haupt.ind.kurz, einheit: haupt.ind.einheit }, e);
      trades.push(t);
      frei = t.ausMin;
    }
    return trades;
  }

  /* ---------------------------------------------------------------- Konto über alle Werte (in Euro) */
  function depot(werte, trades, s, vonTag) {
    const tageSet = new Set();
    werte.forEach((w) => { for (let i = 0; i < w.n; i++) if (w.tag[i] >= vonTag) tageSet.add(w.tag[i]); });
    trades.forEach((t) => { tageSet.add(Math.floor(t.einMin / 1440)); tageSet.add(Math.floor(t.ausMin / 1440)); });
    const tage = [...tageSet].filter((d) => d >= vonTag).sort((a, b) => a - b);
    const ablauf = [];
    trades.forEach((t) => { ablauf.push({ m: t.einMin, art: 1, t }); ablauf.push({ m: t.ausMin, art: 0, t }); });
    ablauf.sort((a, b) => a.m - b.m || a.art - b.art || a.t.w.s.localeCompare(b.t.w.s));
    const K = s.kapital, start = K.start;
    let bar = start, wertVor = start, p = 0, ruin = null;
    const offen = new Set(), kurve = new Float64Array(tage.length), investiert = new Uint8Array(tage.length);
    tage.forEach((tag, k) => {
      while (p < ablauf.length && Math.floor(ablauf[p].m / 1440) <= tag) {
        const { art, t } = ablauf[p++];
        if (art === 1) {
          const betrag = K.art === "prozent" ? wertVor * K.wert / 100 : K.wert;
          if (ruin != null || wertVor <= 0 || betrag <= 0 || bar < betrag * 0.999) { t.uebersprungen = true; continue; }
          t.betrag = Math.min(betrag, bar); bar -= t.betrag; t.ptr = t.tagEin; offen.add(t);
        } else if (offen.has(t)) {
          t.euro = t.betrag * t.netto; t.kostenEuro = t.betrag * t.kostenR; t.finanzEuro = t.betrag * t.finanzR;
          bar += t.betrag + t.euro; offen.delete(t);
        }
      }
      let summe = bar;
      offen.forEach((t) => {
        while (t.ptr + 1 < t.w.n && t.w.tag[t.ptr + 1] <= tag) t.ptr++;
        summe += t.betrag * (1 + s.hebel * t.dir * (t.w.c[t.ptr] / t.ein - 1));
      });
      if (summe <= 0 && ruin == null) ruin = tag;
      kurve[k] = Math.max(0, summe); wertVor = kurve[k]; investiert[k] = offen.size > 0 ? 1 : 0;
    });
    return { tage, kurve, investiert, ruin, start };
  }

  // Kaufen und Halten: alle Werte gleich gewichtet, täglich ausgeglichen, ohne Hebel
  function vergleichskurve(werte, tage) {
    const ptr = werte.map(() => 0), kurve = new Float64Array(tage.length);
    let stand = 1;
    tage.forEach((tag, k) => {
      const r = [];
      werte.forEach((w, n) => {
        let p = ptr[n];
        while (p + 1 < w.n && w.tag[p + 1] <= tag) p++;
        if (w.tag[p] === tag && p > 0 && k > 0) r.push(w.c[p] / w.c[p - 1] - 1);
        ptr[n] = p;
      });
      if (r.length) stand *= 1 + mittel(r);
      kurve[k] = stand;
    });
    return kurve;
  }

  /* ---------------------------------------------------------------- Kennzahlen */
  function rueckgang(kurve, tage) {
    let spitze = kurve[0], ks = 0, max = 0, von = 0, bis = 0;
    for (let k = 0; k < kurve.length; k++) {
      if (kurve[k] > spitze) { spitze = kurve[k]; ks = k; }
      const dd = spitze > 0 ? kurve[k] / spitze - 1 : 0;
      if (dd < max) { max = dd; von = ks; bis = k; }
    }
    return { max, von: tage[von], bis: tage[bis] };
  }
  function kurvenwerte(kurve, tage) {
    if (!kurve.length) return null;
    const jahre = Math.max((tage[tage.length - 1] - tage[0]) / 365.25, 1 / 365.25);
    const ende = kurve[kurve.length - 1] / kurve[0];
    const r = [];
    for (let k = 1; k < kurve.length; k++) r.push(kurve[k - 1] > 0 ? kurve[k] / kurve[k - 1] - 1 : 0);
    const sd = r.length > 2 ? stdAbw(r) : null;
    return { gesamt: ende - 1, jaehrlich: ende > 0 ? Math.pow(ende, 1 / jahre) - 1 : -1, rueckgang: rueckgang(kurve, tage),
             sharpe: sd ? (mittel(r) / sd) * Math.sqrt(J) : null, vola: sd ? sd * Math.sqrt(J) : null };
  }
  function tradewerte(ts) {
    const n = ts.length;
    if (!n) return { n: 0 };
    const r = ts.map((t) => t.netto), plus = r.filter((x) => x > 0), minus = r.filter((x) => x <= 0);
    const m = mittel(r), sd = n > 1 ? stdAbw(r) : null;
    const gewinne = plus.reduce((a, x) => a + x, 0), verluste = -minus.reduce((a, x) => a + x, 0);
    const gruende = { ziel: 0, stop: 0, zwang: 0, zeit: 0, offen: 0 };
    ts.forEach((t) => { gruende[t.grund]++; });
    const summe = (k) => ts.reduce((a, t) => a + (t[k] || 0), 0);
    const aufl = { min: 0, std: 0, tag: 0 };
    ts.forEach((t) => { aufl[t.fein.min ? "min" : t.fein.std ? "std" : "tag"]++; });
    return {
      n, quote: plus.length / n, mittel: m, median: median(r), bester: Math.max(...r), schlechtester: Math.min(...r),
      mittelGewinn: plus.length ? gewinne / plus.length : null, mittelVerlust: minus.length ? -verluste / minus.length : null,
      faktor: verluste > 0 ? gewinne / verluste : null, dauer: mittel(ts.map((t) => (t.ausMin - t.einMin) / 1440)),
      kurs: mittel(ts.map((t) => t.brutto)),
      t: sd ? m / (sd / Math.sqrt(n)) : null, gruende, luecken: ts.filter((t) => t.luecke).length, beide: ts.filter((t) => t.beide).length,
      euro: summe("euro"), kostenEuro: summe("kostenEuro"), finanzEuro: summe("finanzEuro"), aufl, ungenau: ts.filter((t) => t.ungenau).length,
    };
  }
  function verteilung(ts, faecher = 21) {
    if (ts.length < 2) return null;
    const r = ts.map((t) => t.netto).sort((a, b) => a - b);
    const q = (p) => r[Math.min(r.length - 1, Math.max(0, Math.round(p * (r.length - 1))))];
    let lo = q(0.02), hi = q(0.98);
    if (hi - lo < 1e-6) { lo -= 0.005; hi += 0.005; }
    const breite = (hi - lo) / faecher, n = new Array(faecher).fill(0);
    r.forEach((x) => { n[Math.min(faecher - 1, Math.max(0, Math.floor((x - lo) / breite)))]++; });
    return { von: lo, breite, n };
  }

  /* ---------------------------------------------------------------- Ein kompletter Lauf */
  function lauf(werte, s, jahre, mitDepot = true) {
    const ende = Math.max(...werte.map((w) => w.tag[w.n - 1]));
    const vonTag = Math.round(ende - jahre * 365.25);
    const alle = [];
    werte.forEach((w) => (s.ereignisse.length ? tradesEreignis(w, s, vonTag) : tradesWert(w, s, vonTag)).forEach((t) => alle.push(t)));
    alle.sort((a, b) => a.einMin - b.einMin || a.w.s.localeCompare(b.w.s));
    if (!mitDepot) return { trades: alle, kennzahlen: tradewerte(alle) };
    const d = depot(werte, alle, s, vonTag);
    const genommen = alle.filter((t) => !t.uebersprungen);
    return { trades: genommen, uebersprungen: alle.length - genommen.length, vonTag, ende, ...d, kennzahlen: tradewerte(genommen) };
  }

  function rechne(werte, fakten, opt) {
    if (opt.ereignisse) EREIGNISSE = opt.ereignisse;
    const s = strategie(fakten, opt.katalog, opt.params, opt.ereignisse);
    const grenze = Math.min(...werte.map(esmaGrenze));
    if (s.hebel > grenze) s.annahmen.push(`Hebel ${s.hebel}× liegt über der EU-Grenze für Privatkunden bei diesen Werten (${grenze}:1). Mehr erlauben nur professionelle Konten oder Broker außerhalb der EU.`);
    const haupt = lauf(werte, s, opt.jahre);
    const tage = haupt.tage;
    const vergleich = vergleichskurve(werte, tage);
    const jahreListe = [];
    let start = 0;
    for (let k = 0; k < tage.length; k++) {
      if (k === tage.length - 1 || jahr(tage[k + 1]) !== jahr(tage[k])) {
        const basisS = start > 0 ? haupt.kurve[start - 1] : haupt.start, basisV = start > 0 ? vergleich[start - 1] : 1;
        const j = jahr(tage[k]);
        const ts = haupt.trades.filter((t) => jahr(Math.floor(t.ausMin / 1440)) === j);
        jahreListe.push({ jahr: j, strategie: basisS > 0 ? haupt.kurve[k] / basisS - 1 : null, euro: haupt.kurve[k] - basisS, vergleich: vergleich[k] / basisV - 1, n: ts.length,
                          quote: ts.length ? ts.filter((t) => t.netto > 0).length / ts.length : null, teil: !(start > 0 && k < tage.length - 1) });
        start = k + 1;
      }
    }
    const jeWert = werte.map((w) => {
      const ts = haupt.trades.filter((t) => t.w === w);
      return { s: w.s, name: w.name, ...tradewerte(ts), summe: ts.reduce((a, t) => a + t.netto, 0), zahlen: w.e.length, nurSchluss: w.nurSchluss };
    }).sort((a, b) => (b.n || 0) - (a.n || 0) || a.name.localeCompare(b.name));
    const beitrag = [...s.bedingungen.map((bd, k) => ({ bd, ohne: Object.assign({}, s, { bedingungen: s.bedingungen.filter((_, x) => x !== k) }) })),
      ...s.ereignisse.slice(1).map((bd, k) => ({ bd, ohne: Object.assign({}, s, { ereignisse: s.ereignisse.filter((_, x) => x !== k + 1) }) }))]
      .map(({ bd, ohne }) => { const r = lauf(werte, ohne, opt.jahre, false).kennzahlen; return { f: bd.f, n: r.n, quote: r.quote, mittel: r.mittel }; });
    const exposition = haupt.investiert.reduce((a, x) => a + x, 0) / Math.max(1, tage.length);
    const norm = Float64Array.from(haupt.kurve, (x) => x / haupt.start);
    return {
      s, trades: haupt.trades, uebersprungen: haupt.uebersprungen, tage, kurve: haupt.kurve, start: haupt.start, ruin: haupt.ruin, vergleich, exposition,
      kennzahlen: haupt.kennzahlen, depot: kurvenwerte(norm, tage), markt: kurvenwerte(vergleich, tage), grenze,
      jahre: jahreListe, jeWert, beitrag, verteilung: verteilung(haupt.trades), von: tage[0], bis: tage[tage.length - 1],
      ohneZahlen: s.bedingungen.some((b) => b.f.typ === "zahlen") ? werte.filter((w) => !w.e.length).map((w) => w.name) : [],
      ohneMinuten: s.ereignisse.length && s.ereignisMinuten != null ? werte.filter((w) => !w.min || !w.min.size).map((w) => w.name) : [],
      nurSchluss: werte.filter((w) => w.nurSchluss).map((w) => w.name),
      quellen: [...new Set(werte.map((w) => w.quelle).filter(Boolean))],
    };
  }

  return { J, FAKTEN, GRUPPEN, MAX_FAKTEN, MONATE, reiheAus, dekodiere, intraday, wirtschaft, kerzenAb, reihe, wert, kriteriumErfuellt, standardFakt, strategie,
           bedingung, ereignisErfuellt, handel, tradesWert, tradesEreignis, depot, vergleichskurve, tradewerte, kurvenwerte, rueckgang, verteilung,
           lauf, rechne, esmaGrenze, datum, wochentag, monat, jahr, beginn, ende, tagAb, tagBei,
           setzeEreignisse: (e) => { EREIGNISSE = e || []; }, einheitText, indikator: (id) => indikator(id) };
});
