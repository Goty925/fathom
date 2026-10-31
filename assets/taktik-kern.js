/* Fathom: Chart-Taktik – Zeichnungen, Indikatoren und eine Beschreibung in Worten werden zu prüfbaren Regeln und
 * auf Kerzen zurückgerechnet.
 *
 * Zeichnungen (Zeit als Tag seit 1970 in UTC, bei Minuten- und Stundenkerzen mit Nachkommastellen; Preis in der Währung des Werts):
 *   { id: "L1", art: "linie", p, t? }                              waagerechte Linie (gilt über die ganze Zeit)
 *   { id: "S1", art: "strahl", p, t }                              waagerechter Strahl: ab Tag t nach rechts
 *   { id: "T1", art: "trend", a: { t, p }, b: { t, p }, verl, vorne } Trendlinie; verl/vorne = nach rechts/links verlängert
 *   { id: "V1", art: "senkrecht", t }                              senkrechte Linie (Stichtag)
 *   { id: "Z1", art: "zone", t0, t1, oben, unten, verl }           Rechteck/Zone
 *   { id: "K1", art: "kanal", a, b, d, verl }                      paralleler Kanal: Linie a→b und Parallele im Abstand d
 *   { id: "F1", art: "fib", a, b, verl }                           Fibonacci-Retracement von a nach b (0 % bei b, 100 % bei a)
 *   { id: "P1", art: "position", t, t1, ein, stop, ziel }          Long- oder Short-Position mit Einstieg, Stop und Ziel
 * Jede Zeichnung kann einen Namen tragen (z. B. „Widerstand“), über den sie in der Beschreibung angesprochen wird.
 *
 * Indikatoren (Anzeige im Chart und Bedingungen): SMA, EMA, Bollinger-Bänder, RSI, MACD, ATR, wie in gängigen
 * Charttools definiert (RSI und ATR nach Wilder, Bollinger mit Standardabweichung der Grundgesamtheit).
 *
 * Regeln (aus deute() oder von der KI, geprüft mit pruefe()):
 *   richtung "long" | "short", einstieg: [[Bedingung, …], …] (innen UND, außen ODER), filter: [Bedingung, …] (immer UND),
 *   stop, ziel, ausstieg: [Bedingung, …], halten (Kerzen des gewählten Zeitraums), zeitpunkt "eroeffnung" | "schluss".
 * Bedingung an einer Zeichnung: { typ, ref, von?, stufe?, stufe2?, kante? } mit typ kreuzt_ueber | kreuzt_unter |
 *   beruehrt | in_zone | verlaesst_oben | verlaesst_unten | ueber | unter; an einer senkrechten Linie { typ: nach | vor, ref }.
 * Bedingung an einem Indikator: { typ: "ma", ma: "sma"|"ema", n, op } · { typ: "ma_kreuz", a: {ma, n}, b: {ma, n}, op } ·
 *   { typ: "rsi", n, op, wert } · { typ: "macd", schnell, langsam, signal, gegen: "signal"|"null", op } ·
 *   { typ: "bb", n, k, band: "oben"|"unten"|"mitte", op }; ältere Regeln: { typ: "sma", n, seite }.
 * Stop und Ziel: prozent | r | kerze | objekt (an einer Zeichnung) | atr (Vielfaches der ATR) | position (Abstände aus P1).
 *
 * Gerechnet wird ohne Blick in die Zukunft: Signal am Schluss einer Kerze (Indikatoren nur aus Kursen bis dahin),
 * Einstieg zur nächsten Eröffnung (oder zum Schluss), Stop und Ziel innerhalb der Kerze über Hoch und Tief; trifft eine
 * Kerze beide, zählt vorsichtig der Stop. Läuft auch unter Node (für Tests): module.exports.
 */
(function (wurzel, fabrik) {
  const kern = fabrik();
  if (typeof module === "object" && module.exports) module.exports = kern;
  else wurzel.WBTaktik = kern;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const ARTEN = { linie: "Linie", strahl: "Strahl", trend: "Trendlinie", senkrecht: "Senkrechte Linie", zone: "Zone", kanal: "Kanal",
                  fib: "Fibonacci", position: "Position" };
  const KUERZEL = { linie: "L", strahl: "S", trend: "T", senkrecht: "V", zone: "Z", kanal: "K", fib: "F", position: "P" };
  const OPS = ["ueber", "unter", "kreuzt_ueber", "kreuzt_unter", "beruehrt"];
  const BED = ["kreuzt_ueber", "kreuzt_unter", "beruehrt", "in_zone", "verlaesst_oben", "verlaesst_unten", "ueber", "unter", "nach", "vor",
               "sma", "ma", "ma_kreuz", "rsi", "macd", "bb"];
  const FIB_STUFEN = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.618];
  const zahl = (x) => (typeof x === "number" && isFinite(x) ? x : null);
  const ganz = (x, lo, hi) => { const n = Math.round(+x); return Number.isFinite(n) && n >= lo && n <= hi ? n : null; };

  /* ================================================================ Kerzen */
  // Zeiträume einer Kerze. n = Länge in Minuten (Monat gerundet). Zeiten sind immer Tage seit 1970 (UTC); Minuten- und
  // Stundenkerzen haben Kommatage (Minute ÷ 1440), damit Zeichnungen in jedem Zeitraum an derselben Stelle liegen.
  const EBENEN = {
    "1m": { n: 1, titel: "1 Minute", kerzen: "1-Minuten-Kerzen", kurz: "1m" },
    "5m": { n: 5, titel: "5 Minuten", kerzen: "5-Minuten-Kerzen", kurz: "5m" },
    "15m": { n: 15, titel: "15 Minuten", kerzen: "15-Minuten-Kerzen", kurz: "15m" },
    "1h": { n: 60, titel: "1 Stunde", kerzen: "Stundenkerzen", kurz: "1h" },
    "4h": { n: 240, titel: "4 Stunden", kerzen: "4-Stunden-Kerzen", kurz: "4h" },
    tag: { n: 1440, titel: "1 Tag", kerzen: "Tageskerzen", kurz: "T" },
    woche: { n: 10080, titel: "1 Woche", kerzen: "Wochenkerzen", kurz: "W" },
    monat: { n: 43200, titel: "1 Monat", kerzen: "Monatskerzen", kurz: "M" },
  };
  const ebeneOk = (e) => (typeof e === "string" && Object.prototype.hasOwnProperty.call(EBENEN, e) ? e : "tag");
  // Zeit auf die Auflösung eines Zeitraums runden: ganze Tage ab „Tag“, sonst ganze Minuten
  const rundeZeit = (t, ebene) => (EBENEN[ebeneOk(ebene)].n >= 1440 ? Math.round(t) : Math.round(t * 1440) / 1440);
  /* Kerzen zusammenfassen. ziel "woche" (Montag bis Sonntag) oder "monat" (Kalendermonat) aus Tageskerzen;
     eine Zahl (Minuten, z. B. 240) aus kürzeren Kerzen: Die Blöcke beginnen mit jeder Handelssitzung neu (nach einer
     Pause von mehr als drei Stunden, z. B. über Nacht oder am Wochenende), wie bei gängigen Charttools. */
  function fasse(k, ziel) {
    const aus = { tag: [], o: [], h: [], l: [], c: [] };
    let schl = null, sitzung = null;
    for (let i = 0; i < k.c.length; i++) {
      const t = k.tag[i];
      let s;
      if (ziel === "woche") s = Math.floor((Math.floor(t) + 3) / 7);
      else if (ziel === "monat") { const d = new Date(Math.floor(t) * 864e5); s = d.getUTCFullYear() * 12 + d.getUTCMonth(); }
      else {
        const m = Math.round(t * 1440);
        if (sitzung == null || m - Math.round(k.tag[i - 1] * 1440) > 180) sitzung = m;
        s = sitzung * 1e4 + Math.floor((m - sitzung) / ziel);
      }
      if (s !== schl) { schl = s; aus.tag.push(t); aus.o.push(k.o[i]); aus.h.push(k.h[i]); aus.l.push(k.l[i]); aus.c.push(k.c[i]); continue; }
      const j = aus.c.length - 1;
      aus.h[j] = Math.max(aus.h[j], k.h[i]); aus.l[j] = Math.min(aus.l[j], k.l[i]); aus.c[j] = k.c[i];
    }
    return aus;
  }
  // Tageskerzen zu Wochenkerzen (Montag bis Sonntag)
  const wochen = (k) => fasse(k, "woche");
  // Index der Kerze, die den Tag t enthält (letzte Kerze mit Starttag ≤ t)
  function indexAm(k, t) {
    let lo = 0, hi = k.tag.length - 1;
    if (t <= k.tag[0]) return 0;
    if (t >= k.tag[hi]) return hi;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (k.tag[m] <= t) lo = m; else hi = m - 1; }
    return lo;
  }
  // Index als Kommazahl für Zeitpunkte zwischen oder nach den Kerzen (Trendlinien in die Zukunft)
  function indexGenau(k, t) {
    const n = k.tag.length, i = indexAm(k, t);
    if (t > k.tag[n - 1]) { const schritt = n > 1 ? (k.tag[n - 1] - k.tag[0]) / (n - 1) : 1; return n - 1 + (t - k.tag[n - 1]) / (schritt || 1); }
    if (t < k.tag[0]) { const schritt = n > 1 ? (k.tag[n - 1] - k.tag[0]) / (n - 1) : 1; return (t - k.tag[0]) / (schritt || 1); }
    if (i >= n - 1 || k.tag[i] === t) return i;
    return i + (t - k.tag[i]) / ((k.tag[i + 1] - k.tag[i]) || 1);
  }

  /* ================================================================ Indikatoren */
  // Reihen werden je Kerzensatz einmal berechnet; der Wert an Kerze i nutzt nur Kurse bis einschließlich i.
  const CACHE = typeof WeakMap === "function" ? new WeakMap() : null;
  function reihe(k, schluessel, fn) {
    if (!CACHE) return fn();
    let m = CACHE.get(k);
    if (!m) { m = new Map(); CACHE.set(k, m); }
    if (!m.has(schluessel)) m.set(schluessel, fn());
    return m.get(schluessel);
  }
  const leer = (n) => { const a = new Float64Array(n); a.fill(NaN); return a; };
  function smaReihe(x, n) {
    const aus = leer(x.length); let s = 0;
    for (let i = 0; i < x.length; i++) { s += x[i]; if (i >= n) s -= x[i - n]; if (i >= n - 1) aus[i] = s / n; }
    return aus;
  }
  // EMA ab dem ersten gültigen Wert, Start mit dem einfachen Durchschnitt der ersten n Werte
  function emaReihe(x, n) {
    const aus = leer(x.length), a = 2 / (n + 1);
    let f = 0; while (f < x.length && !Number.isFinite(x[f])) f++;
    if (f + n - 1 >= x.length) return aus;
    let s = 0; for (let i = f; i < f + n; i++) s += x[i];
    let e = s / n; aus[f + n - 1] = e;
    for (let i = f + n; i < x.length; i++) { e += a * (x[i] - e); aus[i] = e; }
    return aus;
  }
  function rsiReihe(c, n) {
    const aus = leer(c.length);
    if (c.length <= n) return aus;
    let g = 0, v = 0;
    for (let i = 1; i <= n; i++) { const d = c[i] - c[i - 1]; if (d > 0) g += d; else v -= d; }
    g /= n; v /= n;
    aus[n] = v === 0 ? (g === 0 ? 50 : 100) : 100 - 100 / (1 + g / v);
    for (let i = n + 1; i < c.length; i++) {
      const d = c[i] - c[i - 1];
      g = (g * (n - 1) + Math.max(d, 0)) / n; v = (v * (n - 1) + Math.max(-d, 0)) / n;
      aus[i] = v === 0 ? (g === 0 ? 50 : 100) : 100 - 100 / (1 + g / v);
    }
    return aus;
  }
  function bbReihe(c, n, faktor) {
    const mitte = leer(c.length), oben = leer(c.length), unten = leer(c.length);
    let s = 0, q = 0;
    for (let i = 0; i < c.length; i++) {
      s += c[i]; q += c[i] * c[i];
      if (i >= n) { s -= c[i - n]; q -= c[i - n] * c[i - n]; }
      if (i >= n - 1) { const m = s / n, sd = Math.sqrt(Math.max(0, q / n - m * m)); mitte[i] = m; oben[i] = m + faktor * sd; unten[i] = m - faktor * sd; }
    }
    return { mitte, oben, unten };
  }
  function atrReihe(k, n) {
    const len = k.c.length, aus = leer(len);
    if (len < n) return aus;
    const tr = (i) => (i ? Math.max(k.h[i] - k.l[i], Math.abs(k.h[i] - k.c[i - 1]), Math.abs(k.l[i] - k.c[i - 1])) : k.h[i] - k.l[i]);
    let a = 0; for (let i = 0; i < n; i++) a += tr(i);
    a /= n; aus[n - 1] = a;
    for (let i = n; i < len; i++) { a = (a * (n - 1) + tr(i)) / n; aus[i] = a; }
    return aus;
  }
  function macdReihe(c, schnell, langsam, signal) {
    const f = emaReihe(c, schnell), s = emaReihe(c, langsam), m = leer(c.length);
    for (let i = 0; i < c.length; i++) m[i] = f[i] - s[i];
    const sig = emaReihe(m, signal), hist = leer(c.length);
    for (let i = 0; i < c.length; i++) hist[i] = m[i] - sig[i];
    return { macd: m, signal: sig, hist };
  }
  const maReihe = (k, ma, n) => reihe(k, `${ma}${n}`, () => (ma === "ema" ? emaReihe(k.c, n) : smaReihe(k.c, n)));
  const rsiR = (k, n) => reihe(k, `rsi${n}`, () => rsiReihe(k.c, n));
  const bbR = (k, n, f) => reihe(k, `bb${n}/${f}`, () => bbReihe(k.c, n, f));
  const atrR = (k, n) => reihe(k, `atr${n}`, () => atrReihe(k, n));
  const macdR = (k, a, b, s) => reihe(k, `macd${a}/${b}/${s}`, () => macdReihe(k.c, a, b, s));

  // Angezeigte Indikatoren (je Wert gespeichert): prüfen und benennen
  const IND_ARTEN = { sma: "SMA", ema: "EMA", bb: "Bollinger-Bänder", rsi: "RSI", macd: "MACD", atr: "ATR" };
  function pruefeIndikator(x) {
    if (!x || typeof x !== "object" || !IND_ARTEN[x.art]) return null;
    if (x.art === "sma" || x.art === "ema") { const n = ganz(x.n, 2, 400); return n ? { art: x.art, n } : null; }
    if (x.art === "rsi" || x.art === "atr") { const n = ganz(x.n, 2, 100); return n ? { art: x.art, n } : null; }
    if (x.art === "bb") { const n = ganz(x.n, 2, 400), f = zahl(+x.k); return n && f && f >= 0.5 && f <= 5 ? { art: "bb", n, k: +f.toFixed(2) } : null; }
    const a = ganz(x.schnell, 2, 100), b = ganz(x.langsam, 3, 200), s = ganz(x.signal, 2, 100);
    return a && b && s && a < b ? { art: "macd", schnell: a, langsam: b, signal: s } : null;
  }
  function pruefeIndikatoren(liste) {
    if (!Array.isArray(liste)) return [];
    const aus = [];
    liste.slice(0, 12).forEach((x) => { const p = pruefeIndikator(x); if (p && !aus.some((y) => indName(y) === indName(p))) aus.push(p); });
    return aus.slice(0, 8);
  }
  const zz = (x) => String(x).replace(".", ",");
  function indName(x) {
    if (x.art === "sma" || x.art === "ema") return `${IND_ARTEN[x.art]} ${x.n}`;
    if (x.art === "bb") return `Bollinger ${x.n}/${zz(x.k)}`;
    if (x.art === "macd") return `MACD ${x.schnell}/${x.langsam}/${x.signal}`;
    return `${IND_ARTEN[x.art]} ${x.n}`;
  }
  // Reihen eines angezeigten Indikators für das Zeichnen
  function indikatorReihen(k, x) {
    if (x.art === "sma" || x.art === "ema") return { linie: maReihe(k, x.art, x.n) };
    if (x.art === "bb") return bbR(k, x.n, x.k);
    if (x.art === "rsi") return { linie: rsiR(k, x.n) };
    if (x.art === "atr") return { linie: atrR(k, x.n) };
    return macdR(k, x.schnell, x.langsam, x.signal);
  }
  // Indikatoren, die eine Regel braucht (damit der Chart sie zeigt)
  function indikatorenAus(regeln) {
    const aus = [];
    const bed = (b) => {
      if (b.typ === "sma") aus.push({ art: "sma", n: b.n });
      if (b.typ === "ma") aus.push({ art: b.ma, n: b.n });
      if (b.typ === "ma_kreuz") aus.push({ art: b.a.ma, n: b.a.n }, { art: b.b.ma, n: b.b.n });
      if (b.typ === "rsi") aus.push({ art: "rsi", n: b.n });
      if (b.typ === "macd") aus.push({ art: "macd", schnell: b.schnell, langsam: b.langsam, signal: b.signal });
      if (b.typ === "bb") aus.push({ art: "bb", n: b.n, k: b.k });
    };
    if (!regeln) return [];
    [...(regeln.einstieg || []).flat(), ...(regeln.filter || []), ...(regeln.ausstieg || [])].forEach(bed);
    [regeln.stop, regeln.ziel].forEach((x) => { if (x && x.art === "atr") aus.push({ art: "atr", n: x.n }); });
    return pruefeIndikatoren(aus);
  }

  /* ================================================================ Zeichnungen */
  const fibPreis = (z, stufe) => z.b.p + stufe * (z.a.p - z.b.p);
  function linieAn(a, b, k, i, verl, vorne) {
    const ia = indexGenau(k, a.t), ib = indexGenau(k, b.t);
    const links = Math.min(ia, ib), rechts = Math.max(ia, ib);
    if ((!vorne && i < Math.floor(links)) || (!verl && i > Math.ceil(rechts))) return null;
    return ib === ia ? a.p : a.p + ((b.p - a.p) * (i - ia)) / (ib - ia);
  }
  // Preis einer Zeichnung an Kerze i: { p } für Linien, { oben, unten } für Flächen, null = dort nicht aktiv
  function grundwert(z, k, i) {
    switch (z.art) {
      case "linie": return { p: z.p, oben: z.p, unten: z.p };
      case "strahl": return i < indexAm(k, z.t) || (z.t > k.tag[k.tag.length - 1]) ? null : { p: z.p, oben: z.p, unten: z.p };
      case "trend": { const p = linieAn(z.a, z.b, k, i, z.verl, z.vorne); return p == null ? null : { p, oben: p, unten: p }; }
      case "zone": {
        const i0 = indexAm(k, Math.min(z.t0, z.t1)), i1 = indexAm(k, Math.max(z.t0, z.t1));
        if (i < i0 || (!z.verl && i > i1)) return null;
        return { oben: Math.max(z.oben, z.unten), unten: Math.min(z.oben, z.unten), p: (z.oben + z.unten) / 2 };
      }
      case "kanal": {
        const p = linieAn(z.a, z.b, k, i, z.verl, false);
        if (p == null) return null;
        return { oben: Math.max(p, p + z.d), unten: Math.min(p, p + z.d), p: p + z.d / 2 };
      }
      case "fib": {
        const i0 = indexAm(k, Math.min(z.a.t, z.b.t)), i1 = indexAm(k, Math.max(z.a.t, z.b.t));
        if (i < i0 || (!z.verl && i > i1)) return null;
        return { oben: Math.max(z.a.p, z.b.p), unten: Math.min(z.a.p, z.b.p), p: fibPreis(z, 0.5) };
      }
      case "position": return i < indexAm(k, z.t) ? null : { p: z.ein, oben: z.ein, unten: z.ein };
      default: return null;
    }
  }
  // opt: { stufe, stufe2 } für Fibonacci-Level, { kante: "oben" | "unten" | "mitte" } für eine Kante von Zone, Kanal, Fib
  function wertAn(z, k, i, opt) {
    const w = grundwert(z, k, i);
    if (!w || !opt) return w;
    if (z.art === "fib" && opt.stufe != null) {
      const p1 = fibPreis(z, opt.stufe);
      if (opt.stufe2 != null) { const p2 = fibPreis(z, opt.stufe2); return { oben: Math.max(p1, p2), unten: Math.min(p1, p2), p: (p1 + p2) / 2 }; }
      return { p: p1, oben: p1, unten: p1 };
    }
    if (opt.kante) {
      const p = opt.kante === "oben" ? w.oben : opt.kante === "unten" ? w.unten : (w.oben + w.unten) / 2;
      return { p, oben: p, unten: p };
    }
    return w;
  }
  function neueId(zeichnungen, art) {
    let n = 1;
    while (zeichnungen.some((z) => z.id === KUERZEL[art] + n)) n++;
    return KUERZEL[art] + n;
  }
  function anzeigeName(z) { return z.name ? `${z.name} (${z.id})` : z.id; }
  const istPositionLong = (z) => z.ziel > z.ein;
  // Rechtes Ende einer Zeichnung (Tag): danach weiß sie nichts mehr über die Zukunft
  function rechtesEnde(z) {
    switch (z.art) {
      case "linie": case "strahl": case "senkrecht": case "position": return z.t != null ? z.t : null;
      case "trend": case "kanal": case "fib": return Math.max(z.a.t, z.b.t);
      case "zone": return Math.max(z.t0, z.t1);
      default: return null;
    }
  }
  // Tag, ab dem ohne Rückschaufehler gerechnet werden kann: rechtes Ende aller Zeichnungen, die die Regeln nutzen
  function abTag(regeln, zeichnungen) {
    if (!regeln) return null;
    const ids = new Set([...(regeln.einstieg || []).flat(), ...(regeln.filter || []), ...(regeln.ausstieg || [])].map((b) => b.ref)
      .concat([regeln.stop && regeln.stop.ref, regeln.ziel && regeln.ziel.ref]).filter(Boolean));
    let ab = null;
    (zeichnungen || []).filter((z) => ids.has(z.id)).forEach((z) => { const r = rechtesEnde(z); if (r != null) ab = Math.max(ab == null ? -Infinity : ab, r); });
    return ab;
  }

  /* ================================================================ Prüfen (gespeicherte Daten, KI-Antworten) */
  const punkt = (x) => (x && zahl(x.t) != null && zahl(x.p) ? { t: x.t, p: x.p } : null);
  function pruefeZeichnungen(liste) {
    if (!Array.isArray(liste)) return [];
    const aus = [];
    liste.slice(0, 40).forEach((z) => {
      if (!z || typeof z !== "object" || !Object.prototype.hasOwnProperty.call(ARTEN, z.art)) return;
      const rx = new RegExp(`^${KUERZEL[z.art]}\\d{1,3}$`);
      const id = typeof z.id === "string" && rx.test(z.id) && !aus.some((x) => x.id === z.id) ? z.id : neueId(aus, z.art);
      const name = typeof z.name === "string" ? z.name.replace(/[^\p{L}\p{N} ._-]/gu, "").trim().slice(0, 30) : "";
      const a = punkt(z.a), b = punkt(z.b);
      if (z.art === "linie" && zahl(z.p)) aus.push(Object.assign({ id, art: "linie", p: z.p, name }, zahl(z.t) != null ? { t: z.t } : {}));
      else if (z.art === "strahl" && zahl(z.p) && zahl(z.t) != null) aus.push({ id, art: "strahl", p: z.p, t: z.t, name });
      else if (z.art === "trend" && a && b) aus.push({ id, art: "trend", a, b, verl: z.verl !== false, vorne: z.vorne === true, name });
      else if (z.art === "senkrecht" && zahl(z.t) != null) aus.push({ id, art: "senkrecht", t: Math.round(z.t * 1440) / 1440, name });
      else if (z.art === "zone" && [z.t0, z.t1].every((x) => zahl(x) != null) && zahl(z.oben) && zahl(z.unten))
        aus.push({ id, art: "zone", t0: z.t0, t1: z.t1, oben: Math.max(z.oben, z.unten), unten: Math.min(z.oben, z.unten), verl: z.verl !== false, name });
      else if (z.art === "kanal" && a && b && zahl(z.d) != null) aus.push({ id, art: "kanal", a, b, d: z.d, verl: z.verl !== false, name });
      else if (z.art === "fib" && a && b && a.p !== b.p) aus.push({ id, art: "fib", a, b, verl: z.verl !== false, name });
      else if (z.art === "position" && zahl(z.t) != null && zahl(z.ein) && zahl(z.stop) && zahl(z.ziel) && (z.ziel - z.ein) * (z.ein - z.stop) > 0)
        aus.push({ id, art: "position", t: z.t, t1: zahl(z.t1) != null && z.t1 > z.t ? z.t1 : z.t + 28, ein: z.ein, stop: z.stop, ziel: z.ziel, name });
    });
    return aus;
  }
  const maSpec = (x) => (x && (x.ma === "sma" || x.ma === "ema") && ganz(x.n, 2, 400) ? { ma: x.ma, n: ganz(x.n, 2, 400) } : null);
  const stufeOk = (x) => { const v = zahl(+x); return v != null && v >= -3 && v <= 5 ? +v.toFixed(4) : null; };
  function pruefeBed(b, nachId) {
    if (!b || typeof b !== "object" || !BED.includes(b.typ)) return null;
    if (b.typ === "sma") {
      const n = Math.round(+b.n);
      return n >= 2 && n <= 400 && (b.seite === "ueber" || b.seite === "unter") ? { typ: "sma", n, seite: b.seite } : null;
    }
    if (b.typ === "ma") { const m = maSpec(b); return m && OPS.includes(b.op) ? { typ: "ma", ma: m.ma, n: m.n, op: b.op } : null; }
    if (b.typ === "ma_kreuz") {
      const a = maSpec(b.a), c = maSpec(b.b);
      return a && c && OPS.slice(0, 4).includes(b.op) && !(a.ma === c.ma && a.n === c.n) ? { typ: "ma_kreuz", a, b: c, op: b.op } : null;
    }
    if (b.typ === "rsi") {
      const n = ganz(b.n, 2, 100), w = zahl(+b.wert);
      return n && w != null && w >= 0 && w <= 100 && OPS.slice(0, 4).includes(b.op) ? { typ: "rsi", n, op: b.op, wert: w } : null;
    }
    if (b.typ === "macd") {
      const a = ganz(b.schnell, 2, 100), l = ganz(b.langsam, 3, 200), s = ganz(b.signal, 2, 100);
      return a && l && s && a < l && OPS.slice(0, 4).includes(b.op) ? { typ: "macd", schnell: a, langsam: l, signal: s, gegen: b.gegen === "null" ? "null" : "signal", op: b.op } : null;
    }
    if (b.typ === "bb") {
      const n = ganz(b.n, 2, 400), f = zahl(+b.k);
      return n && f && f >= 0.5 && f <= 5 && ["oben", "unten", "mitte"].includes(b.band) && OPS.includes(b.op)
        ? { typ: "bb", n, k: +f.toFixed(2), band: b.band, op: b.op } : null;
    }
    const z = nachId[b.ref];
    if (!z) return null;
    if (b.typ === "nach" || b.typ === "vor") return z.art === "senkrecht" ? { typ: b.typ, ref: b.ref } : null;
    if (z.art === "senkrecht") return null;
    const aus = { typ: b.typ, ref: b.ref };
    if (b.typ === "beruehrt" || b.typ === "in_zone") aus.von = b.von === "unten" ? "unten" : b.von === "oben" ? "oben" : null;
    if (z.art === "fib") {
      const s1 = stufeOk(b.stufe), s2 = stufeOk(b.stufe2);
      if (s1 != null) aus.stufe = s1;
      if (s1 != null && s2 != null && s2 !== s1) aus.stufe2 = s2;
    }
    if (["zone", "kanal", "fib"].includes(z.art) && ["oben", "unten", "mitte"].includes(b.kante) && aus.stufe == null) aus.kante = b.kante;
    return aus;
  }
  function pruefeAusstiegsart(x, nachId) {
    if (!x || typeof x !== "object") return null;
    if (x.art === "prozent" && zahl(+x.wert) && +x.wert > 0 && +x.wert < 1) return { art: "prozent", wert: +x.wert };
    if (x.art === "r" && zahl(+x.wert) && +x.wert > 0 && +x.wert <= 50) return { art: "r", wert: +x.wert };
    if (x.art === "kerze") return { art: "kerze" };
    if (x.art === "atr" && zahl(+x.wert) && +x.wert > 0 && +x.wert <= 20) return { art: "atr", wert: +x.wert, n: ganz(x.n, 2, 100) || 14 };
    const z = nachId[x.ref];
    if (x.art === "position" && z && z.art === "position") return { art: "position", ref: x.ref };
    if (x.art === "objekt" && z && z.art !== "senkrecht") {
      const puffer = zahl(+x.puffer) && +x.puffer >= 0 && +x.puffer < 0.5 ? +x.puffer : 0;
      const aus = { art: "objekt", ref: x.ref, seite: x.seite === "oben" ? "oben" : x.seite === "unten" ? "unten" : null, puffer };
      if (z.art === "fib" && stufeOk(x.stufe) != null) aus.stufe = stufeOk(x.stufe);
      return aus;
    }
    return null;
  }
  function pruefe(r, zeichnungen) {
    const nachId = {};
    (zeichnungen || []).forEach((z) => { if (z && typeof z.id === "string") nachId[z.id] = z; });
    if (!r || typeof r !== "object") r = {};
    const einstieg = (Array.isArray(r.einstieg) ? r.einstieg : []).map((g) => (Array.isArray(g) ? g : [g]).map((b) => pruefeBed(b, nachId)).filter(Boolean)).filter((g) => g.length).slice(0, 8);
    const halten = Math.round(+r.halten);
    return {
      richtung: r.richtung === "short" ? "short" : "long",
      einstieg,
      filter: (Array.isArray(r.filter) ? r.filter : []).map((b) => pruefeBed(b, nachId)).filter(Boolean).slice(0, 8),
      stop: pruefeAusstiegsart(r.stop, nachId),
      ziel: pruefeAusstiegsart(r.ziel, nachId),
      ausstieg: (Array.isArray(r.ausstieg) ? r.ausstieg : []).map((b) => pruefeBed(b, nachId)).filter(Boolean).slice(0, 8),
      halten: halten >= 1 && halten <= 2000 ? halten : null,
      zeitpunkt: r.zeitpunkt === "schluss" ? "schluss" : "eroeffnung",
    };
  }

  /* ================================================================ Deuten: Beschreibung in Worten → Regeln */
  const W = (s) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${s})(?![\\p{L}\\p{N}])`, "iu");
  const RX = {
    short: W("short|shorten|leerverkauf\\w*|auf fallende kurse|put|sell short|verkaufe short"),
    long: W("long|kaufe|kaufen|kauf|kaufe ich|steige ein|einsteigen|einstieg|buy|go long"),
    stop: W("stop|stopp|stops|sl|stop-loss|stoploss|stop loss|absicherung|absichern|verlustbegrenzung"),
    ziel: W("ziel|ziele|kursziel|gewinnziel|take-profit|take profit|takeprofit|tp|target|gewinne? mitnehmen|gewinnmitnahme"),
    raus: W("raus|aussteigen|steige aus|ausstieg|schließe|schliesse|schließen|glattstellen|exit|position schließen|verkaufe ich|verkaufen"),
    hoch: W("über|ueber|oberhalb|nach oben|above|darüber|überwindet|ueberwindet|ausbruch nach oben"),
    tief: W("unter|unterhalb|nach unten|below|darunter|unterschreitet"),
    kreuz: W("bricht|durchbricht|durchbrochen|kreuzt|gekreuzt|ausbruch|ausbricht|breakout|breakdown|überwindet|ueberwindet|unterschreitet|steigt|fällt|faellt|rutscht|sinkt|springt|schließt|schliesst|schlusskurs|close|closes|geht|durch|dreht|wechselt"),
    beruehr: W("berührt|beruehrt|berühren|testet|test|retest|erreicht|erreichen|tippt|zurückkommt|zurueckkommt|kommt zurück|zurück an|zurück zu|zurück zur|zurück in|prallt|abprall\\w*|bounce|touch\\w*|fasst|läuft an|anläuft"),
    in: W("in die|in den|in das|in der|im|innerhalb|betritt|hinein|läuft in|kommt in|eintaucht|in"),
    verlass: W("verlässt|verlaesst|raus aus|bricht aus|ausbruch aus|ausbricht"),
    zustand: W("solange|nur wenn|sofern|nur falls|filter|liegt|notiert|bleibt|ist|sind"),
    vonOben: W("von oben|aus der höhe|von darüber"),
    vonUnten: W("von unten|von darunter"),
    oberkante: W("oberkante|obere kante|oberen kante|oberen rand|oberer rand|obere linie|oberen linie|obere kanallinie|oberen kanallinie|obere begrenzung|oberen begrenzung|top|dach|decke"),
    unterkante: W("unterkante|untere kante|unteren kante|unteren rand|unterer rand|untere linie|unteren linie|untere kanallinie|unteren kanallinie|untere begrenzung|unteren begrenzung|boden|bottom"),
    mitte: W("mitte|mittellinie|mittleren linie|mittlere linie|mittelband|basis"),
    schluss: W("zum schluss|am schluss|schlusskurs der signalkerze|sofort|direkt zum schluss|zum schlusskurs"),
    an: W("am|an der|an dem|an die|beim|bei der|bei dem|auf der|auf dem|an|at"),
    signalkerze: W("signalkerze|letzten kerze|letzte kerze|vorkerze|kerzentief|kerzenhoch|tief der kerze|hoch der kerze"),
    vor: W("vor|bis|before|until|bevor"),
    zurueck: W("zurück ins|zurück in das|zurück in den|wieder ins|wieder in das|wieder in den|zurück über|zurück unter|wieder über|wieder unter|kehrt zurück|zurückkehrt"),
  };
  function referenzen(zeichnungen) {
    const refs = [];
    const add = (wort, id) => { if (wort && wort.length >= 2) refs.push({ wort: wort.toLowerCase(), id }); };
    zeichnungen.forEach((z) => { add(z.id, z.id); if (z.name) add(z.name, z.id); });
    const art = (a) => zeichnungen.filter((z) => z.art === a);
    const einzeln = (a, woerter) => { const l = art(a); if (l.length === 1) woerter.forEach((w) => add(w, l[0].id)); };
    einzeln("linie", ["linie", "horizontale linie", "waagerechte linie", "level", "marke", "niveau", "line"]);
    einzeln("strahl", ["strahl", "horizontaler strahl", "ray"]);
    einzeln("trend", ["trendlinie", "trend-linie", "trendline", "diagonale", "trend linie"]);
    einzeln("senkrecht", ["senkrechte linie", "vertikale linie", "stichtag", "datum", "senkrechten linie", "vertikalen linie"]);
    einzeln("zone", ["zone", "rechteck", "box", "bereich", "range", "kiste", "rectangle"]);
    einzeln("kanal", ["kanal", "trendkanal", "channel", "kanals", "trendkanals"]);
    einzeln("fib", ["fib", "fibo", "fibonacci", "retracement", "retracements", "fib-retracement", "fibonacci-retracement", "golden pocket", "golden-pocket"]);
    einzeln("position", ["position", "long-position", "short-position", "positionswerkzeug", "plan"]);
    // Unterstützung und Widerstand: höchste bzw. tiefste waagerechte Linie oder Strahl (ohne eigenen Namen)
    const flach = zeichnungen.filter((z) => z.art === "linie" || z.art === "strahl");
    if (flach.length) {
      const sortiert = flach.slice().sort((a, b) => a.p - b.p);
      ["widerstand", "resistance", "widerstandslinie"].forEach((w) => add(w, sortiert[sortiert.length - 1].id));
      ["unterstützung", "unterstuetzung", "support", "unterstützungslinie"].forEach((w) => add(w, sortiert[0].id));
    }
    return refs.sort((a, b) => b.wort.length - a.wort.length);
  }
  const escRx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Alle Stellen im Text, an denen eine Zeichnung genannt wird (längste Treffer zuerst, ohne Überlappung)
  function fundstellen(text, refs, belegt) {
    belegt = belegt || [];
    const aus = [];
    refs.forEach((r) => {
      const rx = new RegExp(`(?<![\\p{L}\\p{N}])${escRx(r.wort)}(?![\\p{L}\\p{N}])`, "giu");
      let m;
      while ((m = rx.exec(text))) {
        const a = m.index, b = a + m[0].length;
        if (belegt.some(([x, y]) => a < y && b > x)) continue;
        belegt.push([a, b]); aus.push({ id: r.id, a, b });
      }
    });
    return aus.sort((x, y) => x.a - y.a);
  }
  const prozent = (s) => { const m = s.match(/(\d+(?:[.,]\d+)?)\s*(?:%|prozent)/i); return m ? +m[1].replace(",", ".") / 100 : null; };
  const zahlAus = (s) => +String(s).replace(",", ".");

  // Indikatoren im Text: Stellen mit Art und Einstellungen
  function indikatorFunde(text, belegt) {
    const aus = [];
    const add = (a, b, ind) => {
      if (belegt.some(([x, y]) => a < y && b > x)) return;
      belegt.push([a, b]); aus.push({ a, b, ind });
    };
    const alle = (rx, fn) => { let m; rx.lastIndex = 0; while ((m = rx.exec(text))) { const ind = fn(m); if (ind) add(m.index, m.index + m[0].length, ind); } };
    alle(/(?<![\p{L}])(golden[ -]?cross|death[ -]?cross|todeskreuz)(?![\p{L}])/giu, (m) => ({ art: "kreuz", golden: /golden/i.test(m[1]) }));
    alle(/(?<![\p{L}])macd(?:\s*\(\s*(\d{1,3})\s*[,;/]\s*(\d{1,3})\s*[,;/]\s*(\d{1,3})\s*\))?(?![\p{L}])/giu,
      (m) => ({ art: "macd", schnell: +m[1] || 12, langsam: +m[2] || 26, signal: +m[3] || 9 }));
    alle(/(?<![\p{L}])rsi(?:\s*\(\s*(\d{1,3})\s*\)|\s*(\d{1,2})(?=\s*(?:über|ueber|unter|oberhalb|unterhalb|kreuzt|steigt|fällt|faellt|ist|liegt|>|<)))?(?![\p{L}\d])/giu,
      (m) => ({ art: "rsi", n: +(m[1] || m[2]) || 14 }));
    alle(/(?<![\p{L}])(überverkauft\p{L}*|ueberverkauft\p{L}*|oversold|überkauft\p{L}*|ueberkauft\p{L}*|overbought)(?![\p{L}])/giu,
      (m) => ({ art: "rsi", n: 14, preset: /verkauft|oversold/i.test(m[1]) ? "unten" : "oben" }));
    alle(/(?<![\p{L}])(?:(obere[nrsm]?|untere[nrsm]?|mittlere[nrsm]?)\s+)?bollinger(?:[- ]?(?:bänder[n]?|baender[n]?|bandes|band|bands))?(?:\s*\(\s*(\d{1,3})\s*[,;/]\s*(\d(?:[.,]\d+)?)\s*\))?/giu,
      (m) => ({ art: "bb", n: +m[2] || 20, k: m[3] ? zahlAus(m[3]) : 2, band: m[1] ? (/^ober/i.test(m[1]) ? "oben" : /^unter/i.test(m[1]) ? "unten" : "mitte") : null }));
    alle(/(?<![\p{L}])(obere[nrsm]?|untere[nrsm]?)\s+band(?![\p{L}])/giu, (m) => ({ art: "bb", n: 20, k: 2, band: /^ober/i.test(m[1]) ? "oben" : "unten" }));
    alle(/(?<![\p{L}\d])(\d{1,3})\s*(?:er|-er)?\s*[- ]?(tage[- ]?linie|tages[- ]?linie|tage[- ]?durchschnitt|kerzen[- ]?linie|wochen[- ]?linie|sma|ema|gd|ma|day(?:\s*(?:sma|ema|ma))?)(?![\p{L}])/giu,
      (m) => { const n = +m[1]; return n >= 2 && n <= 400 ? { art: "ma", ma: /ema/i.test(m[2]) ? "ema" : "sma", n } : null; });
    alle(/(?<![\p{L}])(sma|ema|gd|ma|gleitende[nrsm]?\s+durchschnitts?|exponentielle[nrsm]?\s+durchschnitts?)\s*\(?\s*(\d{1,3})\s*\)?(?![\d])/giu,
      (m) => { const n = +m[2]; return n >= 2 && n <= 400 ? { art: "ma", ma: /ema|exponent/i.test(m[1]) ? "ema" : "sma", n } : null; });
    return aus.sort((x, y) => x.a - y.a);
  }
  // Richtung einer Kreuzung oder eines Zustands aus den Worten um die Stelle
  function lage(fenster, richtung, istAusstieg) {
    const hoch = RX.hoch.test(fenster) || RX.vonUnten.test(fenster), tief = RX.tief.test(fenster) || RX.vonOben.test(fenster);
    const kreuz = RX.kreuz.test(fenster) || RX.verlass.test(fenster);
    const zustand = RX.zustand.test(fenster);
    const vorzug = (richtung === "long") !== !!istAusstieg ? "ueber" : "unter";
    let seite = hoch && !tief ? "ueber" : tief && !hoch ? "unter" : null;
    if (hoch && tief) {
      const t = fenster.toLowerCase();
      const ih = Math.max(t.lastIndexOf("über"), t.lastIndexOf("oben")), it = Math.max(t.lastIndexOf("unter"), t.lastIndexOf("unten"));
      seite = ih > it ? "ueber" : "unter";
    }
    return { seite, kreuz, zustand, vorzug };
  }
  function opAus(fenster, richtung, istAusstieg, standardKreuz) {
    const l = lage(fenster, richtung, istAusstieg);
    if (RX.beruehr.test(fenster) && !(l.kreuz && l.seite)) return "beruehrt";
    if (l.kreuz && !(l.zustand && !/kreuzt|bricht|steigt|fällt|faellt|dreht|schließt|schliesst/i.test(fenster))) return `kreuzt_${l.seite || l.vorzug}`;
    if (l.seite) return l.zustand || !standardKreuz ? l.seite : `kreuzt_${l.seite}`;
    return standardKreuz ? `kreuzt_${l.vorzug}` : null;
  }
  function indikatorBedingung(f, fenster, nach, richtung, istAusstieg) {
    const x = f.ind;
    if (x.art === "kreuz") return { typ: "ma_kreuz", a: { ma: "sma", n: 50 }, b: { ma: "sma", n: 200 }, op: x.golden ? "kreuzt_ueber" : "kreuzt_unter" };
    if (x.art === "ma") {
      const op = opAus(fenster, richtung, istAusstieg, false) || (RX.an.test(fenster) ? "beruehrt" : null);
      return op ? { typ: "ma", ma: x.ma, n: x.n, op } : null;
    }
    if (x.art === "rsi") {
      const l = lage(fenster, richtung, istAusstieg);
      if (x.preset) {
        const grenze = x.preset === "unten" ? 30 : 70;
        if (RX.verlass.test(fenster) || /(?<![\p{L}])(?:wieder|zurück|aus|dreht|verlässt|verlaesst)(?![\p{L}])/iu.test(fenster)) return { typ: "rsi", n: x.n, op: x.preset === "unten" ? "kreuzt_ueber" : "kreuzt_unter", wert: grenze };
        return { typ: "rsi", n: x.n, op: x.preset === "unten" ? "unter" : "ueber", wert: grenze };
      }
      const m = nach.match(/(?<![\p{L}\d])(\d{1,3}(?:[.,]\d+)?)(?!\s*(?:%|tage|tagen|kerzen|r\b))/iu);
      const wert = m ? zahlAus(m[1]) : null;
      if (wert == null || wert > 100) return null;
      const zeichen = /<|kleiner|weniger als/i.test(nach) ? "unter" : />|größer|groesser|mehr als/i.test(nach) ? "ueber" : null;
      const seite = zeichen || l.seite;
      const op = l.kreuz && !(l.zustand && !/kreuzt|steigt|fällt|faellt|dreht|bricht/i.test(fenster)) ? `kreuzt_${seite || l.vorzug}` : seite;
      return op ? { typ: "rsi", n: x.n, op, wert } : null;
    }
    if (x.art === "macd") {
      const gegen = /(?<![\p{L}])(null|nulllinie|null-linie|nullinie|zero|0)(?![\p{L}\d])/iu.test(nach) ? "null" : "signal";
      let op = opAus(fenster.replace(/signal[- ]?linie|signallinie|signal/gi, ""), richtung, istAusstieg, true);
      if (/histogramm/i.test(fenster) && /positiv/i.test(fenster)) op = "ueber";
      if (/histogramm/i.test(fenster) && /negativ/i.test(fenster)) op = "unter";
      if (op === "beruehrt") op = `kreuzt_${(richtung === "long") !== !!istAusstieg ? "ueber" : "unter"}`;
      return { typ: "macd", schnell: x.schnell, langsam: x.langsam, signal: x.signal, gegen, op };
    }
    if (x.art === "bb") {
      let band = x.band || (RX.oberkante.test(fenster) || /obere[nrsm]?\s+band/i.test(fenster) ? "oben" : RX.unterkante.test(fenster) || /untere[nrsm]?\s+band/i.test(fenster) ? "unten"
        : RX.mitte.test(fenster) ? "mitte" : null);
      if (!band) band = (richtung === "long") !== !!istAusstieg ? "unten" : "oben";
      let op;
      if (RX.zurueck.test(fenster)) op = band === "unten" ? "kreuzt_ueber" : band === "oben" ? "kreuzt_unter" : `kreuzt_${(richtung === "long") !== !!istAusstieg ? "ueber" : "unter"}`;
      else op = opAus(fenster, richtung, istAusstieg, false) || "beruehrt";
      return { typ: "bb", n: x.n, k: x.k, band, op };
    }
    return null;
  }
  // Fibonacci-Level aus dem Text (61,8 · 0,618 · 61.8 % · „Golden Pocket“)
  function fibStufen(fenster) {
    if (/golden[ -]?pocket/i.test(fenster)) return [0.618, 0.65];
    const aus = [];
    const rx = /(?<![\p{L}\d.,])(-?\d{1,3}(?:[.,]\d{1,3})?)(?!\s*(?:r\b|tage|tagen|kerzen|wochen|atr|x\b|×|mal))/giu;
    let m;
    while ((m = rx.exec(fenster))) {
      let v = zahlAus(m[1]);
      if (Math.abs(v) > 5) v /= 100;
      if (v >= -3 && v <= 5) aus.push(+v.toFixed(4));
    }
    return aus;
  }
  function bedingungFuer(fenster, z, richtung, istAusstieg) {
    const hoch = RX.hoch.test(fenster), tief = RX.tief.test(fenster);
    const von = RX.vonOben.test(fenster) ? "oben" : RX.vonUnten.test(fenster) ? "unten" : null;
    if (z.art === "senkrecht") return { typ: RX.vor.test(fenster) ? "vor" : "nach", ref: z.id };
    const extra = {};
    if (z.art === "fib") {
      const stufen = fibStufen(fenster.replace(new RegExp(escRx(z.id), "gi"), ""));
      if (!stufen.length) return null;
      extra.stufe = stufen[0];
      if (stufen.length > 1 && (/zwischen|bereich|zone|pocket/i.test(fenster))) extra.stufe2 = stufen[1];
      if (extra.stufe2 == null) z = Object.assign({}, z, { art: "linie" }); // ein Level wirkt wie eine Linie
    }
    if ((z.art === "zone" || z.art === "kanal") && !RX.verlass.test(fenster)) {
      const kante = RX.oberkante.test(fenster) ? "oben" : RX.unterkante.test(fenster) ? "unten" : RX.mitte.test(fenster) ? "mitte" : null;
      if (kante && (RX.beruehr.test(fenster) || RX.kreuz.test(fenster) || RX.an.test(fenster))) { extra.kante = kante; z = Object.assign({}, z, { art: "linie" }); }
    }
    const mit = (b) => Object.assign(b, extra);
    if (z.art === "zone" || z.art === "kanal" || (z.art === "fib" && extra.stufe2 != null)) {
      if (RX.verlass.test(fenster) || (RX.kreuz.test(fenster) && (hoch || tief) && !RX.in.test(fenster)))
        return mit({ typ: tief && !hoch ? "verlaesst_unten" : "verlaesst_oben", ref: z.id });
      if (RX.zustand.test(fenster) && (hoch || tief) && !RX.in.test(fenster)) return mit({ typ: hoch ? "ueber" : "unter", ref: z.id });
      return mit({ typ: "in_zone", ref: z.id, von: von || (istAusstieg ? null : richtung === "long" ? "oben" : "unten") });
    }
    if (RX.beruehr.test(fenster) && !(RX.kreuz.test(fenster) && (hoch || tief) && !von)) {
      return mit({ typ: "beruehrt", ref: z.id, von: von || (richtung === "long" ? "oben" : "unten") });
    }
    if (RX.zustand.test(fenster) && !RX.kreuz.test(fenster) && (hoch || tief)) return mit({ typ: hoch ? "ueber" : "unter", ref: z.id });
    if (hoch && !tief) return mit({ typ: "kreuzt_ueber", ref: z.id });
    if (tief && !hoch) return mit({ typ: "kreuzt_unter", ref: z.id });
    if (hoch && tief) { // beides genannt: das Wort direkt vor der Zeichnung entscheidet
      const ih = Math.max(fenster.toLowerCase().lastIndexOf("über"), fenster.toLowerCase().lastIndexOf("oben")), it = Math.max(fenster.toLowerCase().lastIndexOf("unter"), fenster.toLowerCase().lastIndexOf("unten"));
      return mit({ typ: ih > it ? "kreuzt_ueber" : "kreuzt_unter", ref: z.id });
    }
    if (RX.kreuz.test(fenster)) return mit({ typ: richtung === "long" ? "kreuzt_ueber" : "kreuzt_unter", ref: z.id });
    if (RX.an.test(fenster)) return mit({ typ: "beruehrt", ref: z.id, von: von || (richtung === "long" ? "oben" : "unten") }); // „kaufe am Support“
    return null;
  }
  const ATR_RX = /(\d+(?:[.,]\d+)?)\s*(?:x|×|mal|-?fache[nsr]?)?\s*(?:den|die|der|des)?\s*atr(?:\s*\(?\s*(\d{1,3})\s*\)?)?(?![\p{L}])/iu;
  const TRENNER = /[,;]|\s(?:und|sowie|aber|oder|and)\s/i;
  const ZUSTAND_TYPEN = ["ueber", "unter", "nach", "vor"];
  const istZustand = (b) => (b.ref ? ZUSTAND_TYPEN.includes(b.typ) : b.typ === "sma" || ["ueber", "unter"].includes(b.op));

  function deute(text, zeichnungen) {
    zeichnungen = zeichnungen || [];
    const roh = String(text || "").slice(0, 4000);
    const refs = referenzen(zeichnungen);
    const nachId = Object.fromEntries(zeichnungen.map((z) => [z.id, z]));
    const r = { richtung: "long", einstieg: [], filter: [], stop: null, ziel: null, ausstieg: [], halten: null, zeitpunkt: "eroeffnung" };
    const erkannt = [], unklar = [], hinweise = [];
    const positionen = zeichnungen.filter((z) => z.art === "position");
    const richtungGenannt = RX.short.test(roh) || W("long|kaufe|kaufen|kauf|buy|go long").test(roh);
    if (RX.short.test(roh) && !W("long").test(roh)) r.richtung = "short";
    if (RX.schluss.test(roh)) r.zeitpunkt = "schluss";
    const saetze = roh.split(/(?<=[.!?;\n])\s+|\n+/).map((s) => s.trim()).filter((s) => s.length > 1);
    saetze.forEach((satz) => {
      const teile = satz.split(/,(?=[^,]*(?:stop|stopp|sl\b|ziel|take|tp\b|target|raus|ausstieg|spätestens|nach \d))|\s+und\s+(?=(?:ich\s+)?(?:verkaufe|raus|schließe|schliesse|steige aus|nehme|gehe raus|stoppe))/i)
        .map((s) => s.trim()).filter(Boolean);
      let verstanden = false;
      teile.forEach((teil) => {
        const belegt = [];
        const ind = indikatorFunde(teil, belegt);   // zuerst: „50-Tage-Linie“ ist ein Durchschnitt, keine gezeichnete Linie
        const funde = fundstellen(teil, refs, belegt);
        // Stop
        if (RX.stop.test(teil)) {
          const f = funde[0], atr = teil.match(ATR_RX);
          if (atr) r.stop = { art: "atr", wert: zahlAus(atr[1]), n: +atr[2] || 14 };
          else if (f && nachId[f.id].art === "position") r.stop = { art: "position", ref: f.id };
          else if (f) {
            const z = nachId[f.id], nach = teil.slice(Math.max(0, f.a - 40), f.a).toLowerCase();
            let seite = RX.oberkante.test(teil) ? "oben" : RX.unterkante.test(teil) ? "unten" : /über|ueber|oberhalb/.test(nach) ? "oben" : /unter|unterhalb/.test(nach) ? "unten" : null;
            if (!seite) seite = r.richtung === "long" ? "unten" : "oben";
            const stop = { art: "objekt", ref: z.id, seite, puffer: 0 };
            if (z.art === "fib") {
              const st = fibStufen(teil.replace(new RegExp(escRx(z.id), "gi"), ""));
              if (st.length) stop.stufe = st[0];
              const pm = teil.match(/(\d+(?:[.,]\d+)?)\s*(?:%|prozent)\s*(?:darunter|darüber|unterhalb|oberhalb|puffer|abstand|tiefer|höher)/i);
              if (pm) stop.puffer = zahlAus(pm[1]) / 100;
            } else stop.puffer = prozent(teil) || 0;
            r.stop = stop;
          } else if (RX.signalkerze.test(teil)) r.stop = { art: "kerze" };
          else if (prozent(teil)) r.stop = { art: "prozent", wert: prozent(teil) };
          if (r.stop) { verstanden = true; return; }
        }
        // Ziel
        if (RX.ziel.test(teil)) {
          const rm = teil.match(/(\d+(?:[.,]\d+)?)\s*(?:r\b|crv|:\s*1|mal (?:das|dem|den) risiko|x risiko|faches risiko)/i);
          const atr = teil.match(ATR_RX);
          const f = funde[0];
          if (rm) r.ziel = { art: "r", wert: zahlAus(rm[1]) };
          else if (atr) r.ziel = { art: "atr", wert: zahlAus(atr[1]), n: +atr[2] || 14 };
          else if (f && nachId[f.id].art === "position") r.ziel = { art: "position", ref: f.id };
          else if (f) {
            const z = nachId[f.id];
            let seite = RX.oberkante.test(teil) ? "oben" : RX.unterkante.test(teil) ? "unten" : null;
            if (!seite && (z.art === "zone" || z.art === "kanal")) seite = r.richtung === "long" ? "unten" : "oben";
            const ziel = { art: "objekt", ref: z.id, seite: seite || null, puffer: 0 };
            if (z.art === "fib") { const st = fibStufen(teil.replace(new RegExp(escRx(z.id), "gi"), "")); if (st.length) ziel.stufe = st[0]; }
            r.ziel = ziel;
          } else if (ind.length && ["bb", "ma"].includes(ind[0].ind.art)) { // Ziel an einem Band oder Durchschnitt: Ausstieg beim Berühren
            const x = ind[0].ind;
            r.ausstieg.push(x.art === "bb" ? { typ: "bb", n: x.n, k: x.k, band: x.band || (r.richtung === "long" ? "oben" : "unten"), op: "beruehrt" } : { typ: "ma", ma: x.ma, n: x.n, op: "beruehrt" });
            verstanden = true; return;
          } else if (prozent(teil)) r.ziel = { art: "prozent", wert: prozent(teil) };
          if (r.ziel) { verstanden = true; return; }
        }
        // Haltedauer
        const hm = teil.match(/(?:nach|spätestens nach|spaetestens nach|maximal|höchstens|hoechstens|max\.?|nicht länger als|after)\s*(\d{1,4})\s*(tag|tage|tagen|handelstag\w*|kerze\w*|bars?|candles?|woche\w*|days?)/i);
        if (hm && (RX.raus.test(teil) || /halte|halten|spätestens|spaetestens|maximal|höchstens/i.test(teil))) {
          r.halten = +hm[1]; verstanden = true; return;
        }
        // Zeichnungen und Indikatoren in Reihenfolge des Texts
        const alle = [...funde.map((f) => Object.assign({ art: "z" }, f)), ...ind.map((f) => Object.assign({ art: "i" }, f))].sort((x, y) => x.a - y.a);
        if (!alle.length) return;
        const startetMitAusstieg = /^(?:ich\s+)?(?:verkaufe|raus|schließe|schliesse|steige aus|nehme|gehe raus)/i.test(teil) && r.richtung === "long";
        const istAusstieg = startetMitAusstieg || (RX.raus.test(teil) && !(r.richtung === "short" && RX.short.test(teil)) && (r.einstieg.length > 0 || r.filter.length > 0));
        const bed = [];
        for (let k = 0; k < alle.length; k++) {
          const f = alle[k], naechste = alle[k + 1];
          const fenster = teil.slice(k ? alle[k - 1].b : 0, naechste ? naechste.a : teil.length);
          // Zwei Durchschnitte: Kreuzung der Linien („EMA 20 kreuzt über EMA 50“)
          if (f.art === "i" && f.ind.art === "ma" && naechste && naechste.art === "i" && naechste.ind.art === "ma") {
            const zwischen = teil.slice(f.b, naechste.a);
            const l = lage(teil.slice(k ? alle[k - 1].b : 0, alle[k + 2] ? alle[k + 2].a : teil.length), r.richtung, istAusstieg);
            if (RX.hoch.test(zwischen) || RX.tief.test(zwischen) || RX.kreuz.test(zwischen)) {
              const seite = RX.hoch.test(zwischen) ? "ueber" : RX.tief.test(zwischen) ? "unter" : l.vorzug;
              const op = RX.kreuz.test(zwischen) || (l.kreuz && !l.zustand) ? `kreuzt_${seite}` : seite;
              bed.push({ typ: "ma_kreuz", a: { ma: f.ind.ma, n: f.ind.n }, b: { ma: naechste.ind.ma, n: naechste.ind.n }, op });
              k++; continue;
            }
          }
          let b;
          if (f.art === "z") b = bedingungFuer(fenster, nachId[f.id], r.richtung, istAusstieg);
          else { // Indikatoren: nur der eigene Satzteil zählt (bis zum nächsten Komma oder „und“)
            const vor = teil.slice(k ? alle[k - 1].b : 0, f.a).split(TRENNER).pop();
            const nach = teil.slice(f.b, naechste ? naechste.a : teil.length).split(TRENNER)[0];
            b = indikatorBedingung(f, vor + teil.slice(f.a, f.b) + nach, nach, r.richtung, istAusstieg);
          }
          if (b) bed.push(b);
        }
        if (!bed.length) return;
        verstanden = true;
        if (istAusstieg) {
          const ber = bed.find((b) => b.ref && (b.typ === "beruehrt" || b.typ === "in_zone"));
          if (ber && !r.ziel) { // Verkauf beim Erreichen einer Marke: das ist ein Kursziel
            const z = nachId[ber.ref];
            r.ziel = { art: "objekt", ref: ber.ref, seite: z.art === "zone" || z.art === "kanal" ? (r.richtung === "long" ? "unten" : "oben") : ber.kante === "oben" || ber.kante === "unten" ? ber.kante : null, puffer: 0 };
            if (ber.stufe != null) r.ziel.stufe = ber.stufe;
            bed.splice(bed.indexOf(ber), 1);
          }
          r.ausstieg.push(...bed); return;
        }
        const ereignisse = bed.filter((b) => !istZustand(b));
        const zustaende = bed.filter(istZustand);
        if (ereignisse.length) {
          r.filter.push(...zustaende);
          if (/(?<![\p{L}])oder(?![\p{L}])|(?<![\p{L}])or(?![\p{L}])/iu.test(teil)) ereignisse.forEach((b) => r.einstieg.push([b]));
          else r.einstieg.push(ereignisse);
        } else r.filter.push(...zustaende);
      });
      (verstanden ? erkannt : unklar).push(satz);
    });
    if (!r.einstieg.length && r.filter.length) {
      // Nur Zustände genannt: An einer Zeichnung ist der Wechsel in den Zustand das Signal; bei Indikatoren der Zustand selbst
      const zeichnung = r.filter.filter((b) => b.ref && (b.typ === "ueber" || b.typ === "unter"));
      const indikator = r.filter.filter((b) => !b.ref);
      if (zeichnung.length) {
        zeichnung.forEach((b) => r.einstieg.push([Object.assign({}, b, { typ: b.typ === "ueber" ? "kreuzt_ueber" : "kreuzt_unter" })]));
        r.filter = r.filter.filter((b) => !zeichnung.includes(b));
      } else if (indikator.length) {
        r.einstieg.push(indikator);
        r.filter = r.filter.filter((b) => !indikator.includes(b));
      }
    }
    // Positionswerkzeug: fehlender Stop, fehlendes Ziel und die Richtung kommen aus der gezeichneten Position
    const pos = positionen.find((p) => refs.some((x) => x.id === p.id && W(escRx(x.wort)).test(roh))) || (positionen.length === 1 ? positionen[0] : null);
    if (pos) {
      const uebernommen = [];
      if (!richtungGenannt && !istPositionLong(pos)) r.richtung = "short";
      if (!r.stop) { r.stop = { art: "position", ref: pos.id }; uebernommen.push("Stop"); }
      if (!r.ziel) { r.ziel = { art: "position", ref: pos.id }; uebernommen.push("Ziel"); }
      if (uebernommen.length) hinweise.push(`${uebernommen.join(" und ")} aus ${pos.id} übernommen (Abstände in Prozent vom Einstieg).`);
    }
    const regeln = pruefe(r, zeichnungen);
    if (!zeichnungen.length && !regeln.einstieg.length) hinweise.push("Zeichne Linien, Zonen oder andere Werkzeuge in den Chart oder nenne Indikatoren (z. B. „RSI unter 30“, „Kurs schließt über EMA 20“).");
    if (!regeln.einstieg.length) hinweise.push("Kein Einstieg erkannt. Beispiele: „Kaufe, wenn der Kurs über L1 schließt.“ oder „Kaufe, wenn der RSI über 30 steigt.“");
    if (!regeln.stop && !regeln.ziel && !regeln.ausstieg.length && !regeln.halten) hinweise.push("Kein Ausstieg erkannt. Ohne Stop, Ziel oder Haltedauer rechnet Fathom mit höchstens 20 Kerzen.");
    zeichnungen.filter((z) => z.art === "fib").forEach((z) => {
      if (refs.some((x) => x.id === z.id && W(escRx(x.wort)).test(roh)) && !JSON.stringify(regeln).includes(`"${z.id}"`))
        hinweise.push(`${z.id} wurde genannt, aber ohne Level. Schreibe zum Beispiel „61,8 % von ${z.id}“.`);
    });
    return { regeln, erkannt, unklar, hinweise };
  }

  /* ================================================================ Beschreiben: Regeln → deutscher Text */
  const pz = (v) => String(+(v * 100).toFixed(2)).replace(".", ",");
  const maText = (x) => `${(x.ma || "sma").toUpperCase()} ${x.n}`;
  const OP_TEXT = { ueber: "über", unter: "unter", kreuzt_ueber: "kreuzt über", kreuzt_unter: "kreuzt unter", beruehrt: "berührt" };
  function beschreibe(r, zeichnungen) {
    const nachId = Object.fromEntries((zeichnungen || []).map((x) => [x.id, x]));
    const z = (id) => (nachId[id] ? anzeigeName(nachId[id]) : id);
    const objekt = (b) => {
      const x = nachId[b.ref];
      if (x && x.art === "fib" && b.stufe != null) return b.stufe2 != null ? `${pz(b.stufe)}–${pz(b.stufe2)} % von ${z(b.ref)}` : `${pz(b.stufe)}-%-Level von ${z(b.ref)}`;
      if (b.kante) return `${b.kante === "oben" ? "Oberkante" : b.kante === "unten" ? "Unterkante" : "Mitte"} von ${z(b.ref)}`;
      return z(b.ref);
    };
    const preisGegen = (op, was) => (op === "kreuzt_ueber" ? `Schluss über ${was} (Kreuzung von unten)` : op === "kreuzt_unter" ? `Schluss unter ${was} (Kreuzung von oben)`
      : op === "beruehrt" ? `Kurs berührt ${was}` : `Kurs ${op === "ueber" ? "über" : "unter"} ${was}`);
    const bandText = (b) => `${b.band === "oben" ? "oberen" : b.band === "unten" ? "unteren" : "mittleren"} Bollinger-Band (${b.n}/${zz(b.k)})`;
    const bed = (b) => {
      switch (b.typ) {
        case "kreuzt_ueber": return `Schluss über ${objekt(b)} (Kreuzung von unten)`;
        case "kreuzt_unter": return `Schluss unter ${objekt(b)} (Kreuzung von oben)`;
        case "beruehrt": return `Kurs berührt ${objekt(b)}${b.von ? ` von ${b.von}` : ""}`;
        case "in_zone": return `Kurs läuft in ${objekt(b)}${b.von ? ` (von ${b.von})` : ""}`;
        case "verlaesst_oben": return `Schluss über der Oberkante von ${objekt(b)}`;
        case "verlaesst_unten": return `Schluss unter der Unterkante von ${objekt(b)}`;
        case "ueber": return `Kurs über ${objekt(b)}`;
        case "unter": return `Kurs unter ${objekt(b)}`;
        case "nach": return `ab ${z(b.ref)}`;
        case "vor": return `vor ${z(b.ref)}`;
        case "sma": return `Kurs ${b.seite === "ueber" ? "über" : "unter"} der ${b.n}-Kerzen-Linie`;
        case "ma": return preisGegen(b.op, maText(b)).replace("Kurs berührt", "Kurs berührt den");
        case "ma_kreuz": return `${maText(b.a)} ${OP_TEXT[b.op]} ${maText(b.b)}`;
        case "rsi": return `RSI ${b.n} ${OP_TEXT[b.op]} ${String(b.wert).replace(".", ",")}`;
        case "macd": return `MACD (${b.schnell}/${b.langsam}/${b.signal}) ${OP_TEXT[b.op]} ${b.gegen === "null" ? "der Nulllinie" : "der Signallinie"}`
          .replace("kreuzt über der", "kreuzt über die").replace("kreuzt unter der", "kreuzt unter die");
        case "bb": return b.op === "beruehrt" ? `Kurs berührt das ${bandText(b)}` : preisGegen(b.op, `dem ${bandText(b)}`);
        default: return b.typ;
      }
    };
    const aus = (x, was) => {
      if (!x) return null;
      if (x.art === "prozent") return `${was}: ${pz(x.wert)} % ${was === "Stop" ? "Verlust" : "Gewinn"} vom Einstieg`;
      if (x.art === "r") return `${was}: ${String(x.wert).replace(".", ",")} R, das ${String(x.wert).replace(".", ",")}-Fache des Risikos bis zum Stop`;
      if (x.art === "kerze") return `${was}: ${r.richtung === "long" ? "Tief" : "Hoch"} der Signalkerze`;
      if (x.art === "atr") return `${was}: ${String(x.wert).replace(".", ",")} × ATR ${x.n} vom Einstieg`;
      if (x.art === "position") {
        const p = nachId[x.ref];
        if (!p) return `${was}: wie ${x.ref}`;
        const abstand = was === "Stop" ? Math.abs(p.ein - p.stop) / p.ein : Math.abs(p.ziel - p.ein) / p.ein;
        return `${was}: wie ${z(x.ref)}, ${pz(abstand)} % vom Einstieg`;
      }
      const zz2 = nachId[x.ref];
      const kante = zz2 && (zz2.art === "zone" || zz2.art === "kanal") ? (x.seite === "oben" ? "Oberkante von " : x.seite === "unten" ? "Unterkante von " : "") : "";
      const name = zz2 && zz2.art === "fib" && x.stufe != null ? `${pz(x.stufe)}-%-Level von ${z(x.ref)}` : z(x.ref);
      return `${was}: ${kante}${name}${x.puffer ? `, ${pz(x.puffer)} % ${was === "Stop" ? (r.richtung === "long" ? "darunter" : "darüber") : "davor"}` : ""}`;
    };
    const zeilen = [];
    zeilen.push({ art: "richtung", text: r.richtung === "short" ? "Short: auf fallende Kurse" : "Long: auf steigende Kurse" });
    r.einstieg.forEach((g, i) => zeilen.push({ art: "einstieg", text: `${i ? "oder " : ""}Einstieg, wenn ${g.map(bed).join(" und ")}` }));
    r.filter.forEach((b) => zeilen.push({ art: "filter", text: `nur wenn ${bed(b)}` }));
    zeilen.push({ art: "zeit", text: r.zeitpunkt === "schluss" ? "Einstieg zum Schluss der Signalkerze" : "Einstieg zur Eröffnung der nächsten Kerze" });
    const s = aus(r.stop, "Stop"), t = aus(r.ziel, "Ziel");
    if (s) zeilen.push({ art: "stop", text: s });
    if (t) zeilen.push({ art: "ziel", text: t });
    r.ausstieg.forEach((b) => zeilen.push({ art: "ausstieg", text: `Ausstieg, wenn ${bed(b)}` }));
    if (r.halten) zeilen.push({ art: "halten", text: `spätestens nach ${r.halten} ${r.halten === 1 ? "Kerze" : "Kerzen"} raus` });
    return zeilen;
  }

  /* ================================================================ Rechnen */
  function sma(k, n, i) {
    if (i < n - 1) return null;
    let s = 0; for (let j = i - n + 1; j <= i; j++) s += k.c[j];
    return s / n;
  }
  const ok = (x) => Number.isFinite(x);
  // Schlusskurs gegen eine Linie y (Wert an i und i−1)
  function gegenLinie(op, k, i, y, y0) {
    if (!ok(y)) return false;
    const c = k.c[i], c0 = k.c[i - 1];
    switch (op) {
      case "ueber": return c > y;
      case "unter": return c < y;
      case "kreuzt_ueber": return ok(y0) && c0 <= y0 && c > y;
      case "kreuzt_unter": return ok(y0) && c0 >= y0 && c < y;
      case "beruehrt": return k.l[i] <= y && k.h[i] >= y;
      default: return false;
    }
  }
  // Zwei Reihen gegeneinander (Indikator gegen Wert oder zweite Linie)
  function gegenReihe(op, x, x0, y, y0) {
    if (!ok(x) || !ok(y)) return false;
    switch (op) {
      case "ueber": return x > y;
      case "unter": return x < y;
      case "kreuzt_ueber": return ok(x0) && ok(y0) && x0 <= y0 && x > y;
      case "kreuzt_unter": return ok(x0) && ok(y0) && x0 >= y0 && x < y;
      default: return false;
    }
  }
  function erfuellt(b, k, i, nachId) {
    if (i < 1) return false;
    switch (b.typ) {
      case "sma": { const m = sma(k, b.n, i); return m != null && (b.seite === "ueber" ? k.c[i] > m : k.c[i] < m); }
      case "ma": { const m = maReihe(k, b.ma, b.n); return gegenLinie(b.op, k, i, m[i], m[i - 1]); }
      case "ma_kreuz": { const a = maReihe(k, b.a.ma, b.a.n), c = maReihe(k, b.b.ma, b.b.n); return gegenReihe(b.op, a[i], a[i - 1], c[i], c[i - 1]); }
      case "rsi": { const x = rsiR(k, b.n); return gegenReihe(b.op, x[i], x[i - 1], b.wert, b.wert); }
      case "macd": {
        const m = macdR(k, b.schnell, b.langsam, b.signal);
        return b.gegen === "null" ? gegenReihe(b.op, m.macd[i], m.macd[i - 1], 0, 0) : gegenReihe(b.op, m.macd[i], m.macd[i - 1], m.signal[i], m.signal[i - 1]);
      }
      case "bb": { const x = bbR(k, b.n, b.k)[b.band]; return gegenLinie(b.op, k, i, x[i], x[i - 1]); }
      default: break;
    }
    const z = nachId[b.ref]; if (!z) return false;
    if (b.typ === "nach") return z.art === "senkrecht" && k.tag[i] >= z.t;
    if (b.typ === "vor") return z.art === "senkrecht" && k.tag[i] < z.t;
    const opt = b.stufe != null || b.kante ? { stufe: b.stufe, stufe2: b.stufe2, kante: b.kante } : null;
    const w = wertAn(z, k, i, opt), v = wertAn(z, k, i - 1, opt);
    if (!w) return false;
    const c = k.c[i], c0 = k.c[i - 1];
    switch (b.typ) {
      case "kreuzt_ueber": return !!v && c0 <= v.oben && c > w.oben;
      case "kreuzt_unter": return !!v && c0 >= v.unten && c < w.unten;
      case "beruehrt":
        if (b.von === "unten") return c0 < (v ? v.unten : w.unten) && k.h[i] >= w.unten;
        if (b.von === "oben") return c0 > (v ? v.oben : w.oben) && k.l[i] <= w.oben;
        return k.l[i] <= w.oben && k.h[i] >= w.unten;
      case "in_zone": {
        const drin = k.l[i] <= w.oben && k.h[i] >= w.unten;
        if (!drin) return false;
        if (b.von === "oben") return c0 > (v ? v.oben : w.oben);
        if (b.von === "unten") return c0 < (v ? v.unten : w.unten);
        return !(v && k.l[i - 1] <= v.oben && k.h[i - 1] >= v.unten); // erste Kerze in der Zone
      }
      case "verlaesst_oben": return !!v && c0 <= v.oben && c > w.oben;
      case "verlaesst_unten": return !!v && c0 >= v.unten && c < w.unten;
      case "ueber": return c > w.oben;
      case "unter": return c < w.unten;
      default: return false;
    }
  }
  function preisAus(x, z, k, i, long, einstieg, signal) {
    if (!x) return null;
    if (x.art === "prozent" || x.art === "r" || x.art === "atr" || x.art === "position") return null; // relativ, wird beim Einstieg gerechnet
    if (x.art === "kerze") return long ? k.l[signal] : k.h[signal];
    const opt = x.stufe != null ? { stufe: x.stufe } : null;
    const w = z ? wertAn(z, k, Math.min(i, k.c.length - 1), opt) || wertAn(z, k, signal, opt) : null;
    if (!w) return null;
    return x.seite === "oben" ? w.oben : x.seite === "unten" ? w.unten : w.p;
  }
  // Abstand aus einer gezeichneten Position (als Anteil vom Einstieg)
  const positionsAbstand = (p, was) => (was === "stop" ? Math.abs(p.ein - p.stop) / p.ein : Math.abs(p.ziel - p.ein) / p.ein);

  /* kerzen: { tag, o, h, l, c }; opt: { kosten (je Seite, 0.0005 = 0,05 %), start (Kapital), haltenStandard, ab (erste Signalkerze) } */
  function teste(kerzen, zeichnungen, regeln, opt) {
    opt = opt || {};
    const k = kerzen, n = k.c.length;
    const nachId = Object.fromEntries((zeichnungen || []).map((z) => [z.id, z]));
    const r = pruefe(regeln, zeichnungen);
    const long = r.richtung === "long";
    const kosten = opt.kosten != null ? opt.kosten : 0.0005;
    const halten = r.halten || (!r.stop && !r.ziel && !r.ausstieg.length ? opt.haltenStandard || 20 : null);
    const ab = Math.max(1, Math.round(opt.ab || 1));
    const trades = [], hinweise = [];
    let ungueltigerStop = 0, beidesInEinerKerze = 0, ohneAtr = 0;
    if (!r.einstieg.length) return { regeln: r, trades, hinweise: ["Kein Einstieg definiert."], kennzahlen: kennzahlen([], k, opt), kurve: [] };
    const abstand = (x, i) => {
      if (x.art === "atr") { const a = atrR(k, x.n)[i]; return ok(a) ? a : null; }
      return null;
    };
    let i = ab;
    while (i < n - 1) {
      const signal = r.filter.every((b) => erfuellt(b, k, i, nachId)) && r.einstieg.some((g) => g.every((b) => erfuellt(b, k, i, nachId)));
      if (!signal) { i++; continue; }
      const e = r.zeitpunkt === "schluss" ? i : i + 1;
      const ein = r.zeitpunkt === "schluss" ? k.c[i] : k.o[i + 1];
      const zs = r.stop && r.stop.ref ? nachId[r.stop.ref] : null, zz = r.ziel && r.ziel.ref ? nachId[r.ziel.ref] : null;
      let stop = null, ziel = null;
      if (r.stop) {
        if (r.stop.art === "prozent") stop = ein * (long ? 1 - r.stop.wert : 1 + r.stop.wert);
        else if (r.stop.art === "position") { const d = positionsAbstand(zs, "stop"); stop = ein * (long ? 1 - d : 1 + d); }
        else if (r.stop.art === "atr") { const a = abstand(r.stop, i); if (a == null) { ohneAtr++; i++; continue; } stop = ein + (long ? -1 : 1) * r.stop.wert * a; }
        else { const b = preisAus(r.stop, zs, k, e, long, ein, i); if (b != null) stop = b * (long ? 1 - (r.stop.puffer || 0) : 1 + (r.stop.puffer || 0)); }
        if (stop != null && (long ? stop >= ein : stop <= ein)) { ungueltigerStop++; i++; continue; } // Stop auf der falschen Seite: kein Trade
      }
      const risiko = stop != null ? Math.abs(ein - stop) : null;
      if (r.ziel) {
        if (r.ziel.art === "prozent") ziel = ein * (long ? 1 + r.ziel.wert : 1 - r.ziel.wert);
        else if (r.ziel.art === "r") ziel = risiko != null ? ein + (long ? 1 : -1) * r.ziel.wert * risiko : null;
        else if (r.ziel.art === "position") { const d = positionsAbstand(zz, "ziel"); ziel = ein * (long ? 1 + d : 1 - d); }
        else if (r.ziel.art === "atr") { const a = abstand(r.ziel, i); ziel = a == null ? null : ein + (long ? 1 : -1) * r.ziel.wert * a; }
        else ziel = preisAus(r.ziel, zz, k, e, long, ein, i);
        if (ziel != null && (long ? ziel <= ein : ziel >= ein)) ziel = null; // Ziel schon erreicht: ignorieren
      }
      // Position führen
      let aus = null, grund = null, j = e;
      for (; j < n; j++) {
        const o = k.o[j], h = k.h[j], l = k.l[j];
        const stopHit = stop != null && (long ? l <= stop : h >= stop) && !(j === e && r.zeitpunkt === "schluss");
        const zielHit = ziel != null && (long ? h >= ziel : l <= ziel) && !(j === e && r.zeitpunkt === "schluss");
        if (stopHit && zielHit) beidesInEinerKerze++;
        if (stopHit) { aus = long ? Math.min(stop, o) : Math.max(stop, o); grund = "stop"; break; }
        if (zielHit) { aus = long ? Math.max(ziel, o) : Math.min(ziel, o); grund = "ziel"; break; }
        if (j > i && r.ausstieg.some((b) => erfuellt(b, k, j, nachId))) { aus = k.c[j]; grund = "regel"; break; }
        if (halten && j - e + 1 >= halten) { aus = k.c[j]; grund = "zeit"; break; }
      }
      if (aus == null) { j = n - 1; aus = k.c[j]; grund = "offen"; }
      const brutto = long ? aus / ein - 1 : ein / aus - 1;
      const netto = (1 + brutto) * (1 - kosten) * (1 - kosten) - 1;
      trades.push({ signal: i, ein_i: e, aus_i: j, ein, aus, stop, ziel, grund, brutto, netto,
                    r: risiko ? ((long ? aus - ein : ein - aus) / risiko) : null, tage: k.tag[j] - k.tag[e] });
      i = Math.max(j + 1, i + 1);
    }
    if (ungueltigerStop) hinweise.push(`${ungueltigerStop} Signale ohne Trade: Der Stop lag schon auf der falschen Seite des Einstiegs.`);
    if (beidesInEinerKerze) hinweise.push(`${beidesInEinerKerze}× trafen Stop und Ziel dieselbe Kerze; gezählt wurde vorsichtig der Stop.`);
    if (ohneAtr) hinweise.push(`${ohneAtr} Signale ohne Trade: Für die ATR gab es noch zu wenige Kerzen.`);
    const kurve = [];
    let kapital = opt.start || 10000;
    trades.forEach((t) => { kapital *= 1 + t.netto; kurve.push({ i: t.aus_i, kapital }); });
    return { regeln: r, trades, hinweise, kennzahlen: kennzahlen(trades, k, opt), kurve };
  }
  function kennzahlen(trades, k, opt) {
    const start = (opt && opt.start) || 10000;
    const n = trades.length, gewinner = trades.filter((t) => t.netto > 0);
    let kap = start, hoch = start, maxRueck = 0;
    trades.forEach((t) => { kap *= 1 + t.netto; hoch = Math.max(hoch, kap); maxRueck = Math.min(maxRueck, kap / hoch - 1); });
    const plus = gewinner.reduce((s, t) => s + t.netto, 0), minus = trades.filter((t) => t.netto < 0).reduce((s, t) => s - t.netto, 0);
    const mitR = trades.filter((t) => t.r != null);
    const ab = Math.max(0, Math.round(((opt && opt.ab) || 1) - 1));
    const n0 = k && k.c.length ? k.c[Math.min(ab, k.c.length - 1)] : null, n1 = k && k.c.length ? k.c[k.c.length - 1] : null;
    return {
      n, quote: n ? gewinner.length / n : null, gesamt: kap / start - 1, ende: kap,
      mittel: n ? trades.reduce((s, t) => s + t.netto, 0) / n : null,
      rMittel: mitR.length ? mitR.reduce((s, t) => s + t.r, 0) / mitR.length : null,
      profitFaktor: minus > 0 ? plus / minus : plus > 0 ? Infinity : null,
      maxRueckgang: maxRueck, kaufenHalten: n0 && n1 ? n1 / n0 - 1 : null,
      tageMittel: n ? trades.reduce((s, t) => s + t.tage, 0) / n : null,
    };
  }

  return { ARTEN, KUERZEL, BED, FIB_STUFEN, IND_ARTEN, EBENEN, ebeneOk, rundeZeit, fasse, wochen, indexAm, indexGenau, wertAn, fibPreis, neueId, anzeigeName, rechtesEnde, abTag,
           pruefeZeichnungen, pruefeIndikatoren, pruefeIndikator, indName, indikatorReihen, indikatorenAus, pruefe, deute, beschreibe, erfuellt, teste,
           kennzahlen, istPositionLong, reihen: { sma: smaReihe, ema: emaReihe, rsi: rsiReihe, bb: bbReihe, atr: atrReihe, macd: macdReihe } };
});
