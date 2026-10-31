/* Fathom: Rechenkern des Work-Modus (ohne Oberfläche, läuft im Browser und unter Node für die Tests).
 *
 *  - Nachrichten: Kurzfassung (die ersten ein bis zwei Sätze der Quelle, ohne Ortsmarke und ohne Wiederholung des
 *    Titels), Zuordnung zu den Werten der Watchlist, Thema, Gewicht (1–3) und Tendenz. Gewicht und Tendenz sind
 *    Schätzungen aus Stichwörtern, keine Bewertung durch einen Menschen.
 *  - Statistik aus Tagesschlusskursen: Renditen, Volatilität, maximaler Rückgang, Sharpe, Beta, Korrelation.
 *  - Börsenzeiten: offen, Mittagspause oder geschlossen, mit Zeit bis zum nächsten Wechsel (ohne Feiertage).
 *  - Kalender: Überraschung gegenüber Prognose bzw. Vorwert, nächster Termin, Marktreaktion früherer Termine.
 */
(function (wurzel, fabrik) {
  const kern = fabrik();
  if (typeof module === "object" && module.exports) module.exports = kern;
  else wurzel.WBWorkKern = kern;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const TAG_MS = 864e5;

  /* ================================================================ Text */
  const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", mdash: "—", ndash: "–", hellip: "…" };
  function bereinige(t) {
    return String(t == null ? "" : t)
      .replace(/<[^>]+>/g, " ")
      .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e) => {
        if (e[0] === "#") {
          const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
          return isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
        }
        return ENT[e.toLowerCase()] != null ? ENT[e.toLowerCase()] : m;
      })
      .replace(/\s+/g, " ").trim();
  }
  // Ortsmarke und Agentur am Anfang: „WASHINGTON, Oct 28 (Reuters) - “, „(AP) — “, „NEW YORK – “
  const AGENTUR = /^[^()]{0,60}\((?:Reuters|AP|AFP|Bloomberg|dpa|dpa-AFX|Dow Jones|MarketWatch|Kyodo|RTTNews)\)\s*[-–—:]?\s*/;
  const ORT = /^[A-ZÄÖÜ][A-ZÄÖÜ .'’-]{2,30}(?:,\s*[A-Z][a-z]{2,9}\.?\s+\d{1,2})?\s*[-–—]\s+/;
  const SCHLUSS = /\s*(?:\[(?:…|\.\.\.)\]|\(\s*(?:…|\.\.\.)\s*\)|\.\.\.|…|Read more\.?|Continue reading\.?|Weiterlesen\.?)\s*$/i;
  const ABK = new Set(["u.s", "u.k", "u.n", "e.u", "inc", "corp", "co", "ltd", "mr", "mrs", "ms", "dr", "st", "jan", "feb", "mar", "apr", "jun", "jul",
    "aug", "sep", "sept", "oct", "nov", "dec", "no", "vs", "z.b", "bzw", "ca", "mio", "mrd", "nr", "s.a", "n.v", "a.m", "p.m", "etc", "approx", "jr", "sr",
    "dt", "u.a", "d.h", "evtl", "inkl", "ggf", "bzgl", "gov", "rep", "sen", "corp", "plc"]);

  function saetze(t) {
    const aus = [];
    const re = /[.!?](?=["'”’)]?\s+["'“‘(]?[A-ZÄÖÜ0-9])/g;
    let start = 0, m;
    while ((m = re.exec(t))) {
      const wort = (t.slice(start, m.index).match(/([A-Za-zÄÖÜäöü.]+)$/) || [])[1] || "";
      if (ABK.has(wort.toLowerCase()) || /^[A-Z]$/.test(wort)) continue; // Abkürzung oder Initiale
      aus.push(t.slice(start, m.index + 1).trim());
      start = m.index + 1;
    }
    const rest = t.slice(start).trim();
    if (rest) aus.push(rest);
    return aus.filter((s) => s.length > 2);
  }
  const woerter = (t) => new Set(String(t).toLowerCase().replace(/[^a-z0-9äöüß ]+/g, " ").split(" ").filter((w) => w.length > 2));
  function aehnlich(a, b) {
    const x = woerter(a), y = woerter(b);
    if (!x.size || !y.size) return false;
    let gleich = 0;
    x.forEach((w) => { if (y.has(w)) gleich++; });
    return gleich / Math.min(x.size, y.size) >= 0.8;
  }
  function kuerzen(t, max) {
    if (t.length <= max) return t;
    const schnitt = t.lastIndexOf(" ", max - 1);
    return t.slice(0, schnitt > max * 0.6 ? schnitt : max - 1).replace(/[\s,;:–—-]+$/, "") + "…";
  }
  // Kurzfassung: ein bis zwei Sätze aus dem Anrisstext der Quelle, höchstens `max` Zeichen
  function kurzfassung(titel, text, max = 240) {
    let t = bereinige(text).replace(AGENTUR, "").replace(ORT, "").replace(SCHLUSS, "").trim();
    if (!t) return "";
    const s = saetze(t).filter((x, i) => !(i === 0 && aehnlich(x, titel)));
    if (!s.length) return "";
    let aus = s[0];
    if (aus.length < max * 0.55 && s[1] && (aus + " " + s[1]).length <= max) aus += " " + s[1]; // höchstens zwei Sätze
    aus = kuerzen(aus, max);
    return aehnlich(aus, titel) && aus.length < titel.length * 1.3 ? "" : aus;
  }

  /* ================================================================ Zuordnung zu Werten */
  const ALIAS = {
    "GC=F": ["gold", "Goldpreis", "bullion"], "SI=F": ["silver", "Silber"], "PL=F": ["platinum", "Platin"],
    "BZ=F": ["Brent", "crude", "oil prices?", "Ölpreis", "OPEC\\+?"], "CL=F": ["WTI", "crude", "oil prices?", "Ölpreis", "OPEC\\+?"],
    "HG=F": ["copper", "Kupfer"], "NG=F": ["natural gas", "Erdgas"],
    "^GSPC": ["S&P 500", "S&P500", "Wall Street", "US-Börsen"], "^NDX": ["Nasdaq"], "^IXIC": ["Nasdaq"], "^DJI": ["Dow Jones"],
    "^GDAXI": ["DAX"], "^STOXX50E": ["Euro Stoxx", "Stoxx 50", "European shares", "europäische Börsen"], "^N225": ["Nikkei"],
    "^FTSE": ["FTSE"], "^HSI": ["Hang Seng"],
  };
  const WAEHRUNG = {
    USD: ["Fed", "FOMC", "Federal Reserve", "dollar", "Dollar", "Treasury yields?", "US-Notenbank", "U\\.S\\. inflation", "payrolls"],
    EUR: ["ECB", "EZB", "Lagarde", "euro zone", "eurozone", "Euroraum", "euro"],
    JPY: ["BOJ", "BoJ", "Bank of Japan", "yen", "Yen"], GBP: ["Bank of England", "BoE", "sterling", "pound", "Pfund"],
    CHF: ["SNB", "Swiss National Bank", "Swiss franc", "Franken"], AUD: ["RBA", "Australian dollar"], CAD: ["Bank of Canada", "Canadian dollar"],
    CNY: ["yuan", "PBOC", "renminbi"],
  };
  const ZUSATZ = /\s*\((?:ETF|ETC)\)|,?\s+(?:Inc\.?|AG|SE|Corp\.?|Corporation|plc|N\.V\.|S\.A\.|Holdings?|Group|Ltd\.?)$/gi;
  const rx = (liste, flags = "i") => new RegExp("(?:^|[^A-Za-zÄÖÜäöü0-9])(?:" + liste.join("|") + ")(?![A-Za-zÄÖÜäöü0-9])", flags);
  const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // Einmal je Watchlist: Suchmuster je Wert. werte: { slug: { symbol, name, typ, finnhub } }
  function muster(werte) {
    return Object.entries(werte).map(([slug, b]) => {
      const name = String(b.name || "").replace(ZUSATZ, "").trim();
      const direkt = [], kurz = [];
      if (b.typ === "aktie" && name) {
        if (name.length >= 4) direkt.push(escRe(name));
        const erstes = name.split(/\s+/)[0];
        if (erstes !== name && erstes.length >= 5) direkt.push(escRe(erstes));
        if (name.length < 4) kurz.push(escRe(name)); // z. B. „SAP“: nur in Großbuchstaben
      }
      const sym = String(b.finnhub || b.symbol || "").toUpperCase();
      const indirekt = (ALIAS[b.symbol] || []).slice();
      if (b.typ === "forex") {
        const m = String(b.symbol).match(/^([A-Z]{3})([A-Z]{3})=X$/);
        if (m) { direkt.push(escRe(m[1] + "/" + m[2]), m[1] + m[2]); indirekt.push(...(WAEHRUNG[m[1]] || []), ...(WAEHRUNG[m[2]] || [])); }
      }
      return {
        slug, typ: b.typ, symbole: new Set([sym, String(b.symbol || "").toUpperCase()].filter(Boolean)),
        direkt: direkt.length ? rx(direkt) : null, kurz: kurz.length ? rx(kurz, "") : null,
        kuerzel: b.typ === "aktie" && sym ? new RegExp("(?:\\$" + escRe(sym) + "\\b|\\((?:[A-Z]+:\\s?)?" + escRe(sym) + "(?:\\.[A-Z]{1,2})?\\))") : null,
        indirekt: indirekt.length ? rx(indirekt) : null,
      };
    });
  }
  // → [{ slug, direkt: bool }], direkte Treffer zuerst
  function zuordnen(e, liste) {
    const text = (e.titel || "") + " " + (e.text || "");
    const sym = new Set((e.symbole || []).map((s) => String(s).toUpperCase()));
    const aus = [];
    for (const m of liste) {
      let direkt = [...m.symbole].some((s) => sym.has(s)) || (m.direkt && m.direkt.test(text)) || (m.kurz && m.kurz.test(text)) || (m.kuerzel && m.kuerzel.test(text));
      const indirekt = !direkt && m.indirekt && m.indirekt.test(text);
      if (direkt || indirekt) aus.push({ slug: m.slug, direkt: !!direkt });
    }
    return aus.sort((a, b) => b.direkt - a.direkt);
  }

  /* ================================================================ Thema, Gewicht, Tendenz */
  // \b kennt in JavaScript nur a–z: „Übernahme“ oder „Ölpreis“ würden nie erkannt. Deshalb eigene Wortgrenzen.
  const grenze = (re) => new RegExp(re.source.replace(/^\\b/, "(?:^|[^\\p{L}\\p{N}])").replace(/\\b$/, "(?![\\p{L}\\p{N}])"), re.flags.replace("u", "") + "u");
  const THEMEN = [
    ["notenbank", grenze(/\b(Fed|FOMC|Federal Reserve|ECB|EZB|central bank|Notenbank|Zentralbank|rate (?:cut|hike|decision)s?|Zins(?:senkung|erhöhung|entscheid)|BOJ|BoJ|Bank of (?:Japan|England|Canada)|BoE|SNB|Lagarde|monetary policy|Geldpolitik)\b/i)],
    ["konjunktur", grenze(/\b(inflation|CPI|PPI|PCE|payrolls|jobs report|nonfarm|GDP|BIP|retail sales|Einzelhandel|PMI|ISM|unemployment|jobless claims|Arbeitslos\w*|consumer (?:confidence|sentiment)|ifo|ZEW|recession|Rezession|Konjunktur)\b/i)],
    ["rohstoffe", grenze(/\b(oil|crude|Brent|WTI|OPEC\+?|gold|silver|copper|natural gas|wheat|commodit\w+|Ölpreis|Rohstoff\w*|Gold|Silber|Kupfer)\b/i)],
    ["devisen", grenze(/\b(dollar|euro|yen|sterling|pound|franc|yuan|forex|currenc\w+|FX|Devisen|Währung\w*|Wechselkurs\w*)\b/i)],
    ["politik", grenze(/\b(tariffs?|sanctions?|Zölle?n?|Sanktion\w*|election|Wahl\w*|war|Krieg|ceasefire|shutdown|White House|Weißes Haus|Congress|Kongress|geopolit\w+|trade (?:deal|war|talks))\b/i)],
    ["unternehmen", grenze(/\b(earnings|revenue|profit|guidance|quarter(?:ly)?|CEO|CFO|acqui\w+|merger|takeover|IPO|buyback|dividend|downgrade|upgrade|price target|Umsatz|Gewinn|Gewinnwarnung|Quartal\w*|Übernahme|Prognose|Kursziel|Aktienrückkauf|Dividende|8-K)\b/i)],
  ];
  const THEMA_NAME = { notenbank: "Notenbanken", konjunktur: "Konjunktur", rohstoffe: "Rohstoffe", devisen: "Devisen", politik: "Politik", unternehmen: "Unternehmen", maerkte: "Märkte" };
  function thema(e) {
    if (e.thema && THEMA_NAME[e.thema]) return e.thema;
    const text = (e.titel || "") + " " + (e.text || "").slice(0, 400);
    for (const [id, re] of THEMEN) if (re.test(e.titel || "")) return id;
    for (const [id, re] of THEMEN) if (re.test(text)) return id;
    return "maerkte";
  }
  const STARK = grenze(/\b(FOMC statement|monetary policy (?:statement|decisions?)|rate (?:cut|hike|decision)|cuts? rates|raises? rates|hikes? rates|holds? rates|Leitzins\w*|Zinsentscheid\w*|CPI|inflation (?:report|data|rate)|payrolls|jobs report|GDP|guidance|outlook|forecast cut|profit warning|Gewinnwarnung|beats?|miss(?:es|ed)?|tops? estimates|record (?:high|low)|Rekord\w*|plunges?|plummets?|soars?|surges?|tumbles?|crash\w*|bankrupt\w*|Insolvenz|acqui(?:re|res|sition)|merger|takeover|Übernahme|downgrades?|upgrades?|Herabstufung|tariffs?|Zölle?n?|sanctions?|halts?|recall|probe|investigation|lawsuit|SEC charges|Ermittlung\w*|default|Notfall|emergency)\b/i);
  const TOPQUELLE = /^(Reuters|Bloomberg|CNBC|Wall Street Journal|WSJ|Financial Times|FT|MarketWatch|Barron'?s|AP|Associated Press|Handelsblatt|dpa-AFX|Federal Reserve|EZB|SEC EDGAR)$/i;
  // 1 = gering, 2 = mittel, 3 = hoch
  function gewicht(e, treffer) {
    let p = 0;
    if (STARK.test(e.titel || "")) p += 2;
    else if (STARK.test((e.text || "").slice(0, 300))) p += 1;
    if ((treffer || []).some((t) => t.direkt)) p += 1;
    if (e.herkunft === "fed" || e.herkunft === "ezb") p += 2;
    if (e.wichtig) p += 2;
    if (TOPQUELLE.test(e.quelle || "")) p += 0.5;
    return p >= 3 ? 3 : p >= 1.5 ? 2 : 1;
  }
  const POSITIV = grenze(/\b(beats?|tops?|surges?|soars?|jumps?|rall(?:y|ies)|gains?|rises?|climbs?|record high|upgrades?|raises? (?:guidance|forecast|outlook|dividend)|strong(?:er)?|better[- ]than[- ]expected|boost\w*|optimis\w+|steigt|klettert|Rekordhoch|hebt .{0,20}(?:Prognose|Kursziel)|übertrifft|stark\w*)\b/i);
  const NEGATIV = grenze(/\b(miss(?:es|ed)?|falls?|drops?|slumps?|plunges?|plummets?|tumbles?|sinks?|slides?|declines?|record low|downgrades?|cuts? (?:guidance|forecast|outlook|jobs)|weak(?:er)?|worse[- ]than[- ]expected|warn\w*|layoffs?|recall|probe|lawsuit|fraud|bankrupt\w*|pessimis\w+|fällt|sinkt|bricht ein|Gewinnwarnung|senkt .{0,20}(?:Prognose|Kursziel)|verfehlt|schwach\w*)\b/i);
  // +1 eher positiv, −1 eher negativ, 0 neutral oder gemischt (aus dem Titel, sonst dem Anfang des Textes)
  function tendenz(e) {
    const zaehle = (t) => (POSITIV.test(t) ? 1 : 0) - (NEGATIV.test(t) ? 1 : 0);
    const t = zaehle(e.titel || "");
    return t !== 0 ? t : zaehle((e.text || "").slice(0, 240));
  }
  // Ein Eintrag mit allem, was die Oberfläche braucht
  // Nur echte Web-Adressen als Link: javascript:, data: oder file: aus fremden Feeds würden sonst beim Klick ausgeführt
  function sichereUrl(u) {
    const s = String(u == null ? "" : u).trim();
    return /^https?:\/\/[^\s"'<>]+$/i.test(s) ? s : "";
  }
  function aufbereiten(e, liste, werte) {
    const treffer = zuordnen(e, liste);
    e = Object.assign({}, e, { url: sichereUrl(e.url) });
    const a = Object.assign({}, e, { kurz: kurzfassung(e.titel, e.text), werte: treffer, thema: thema(e), gewicht: gewicht(e, treffer), tendenz: tendenz(e) });
    a.tags = waehrungen(a, werte);
    a.art = art(a);
    return a;
  }
  // Lage in einem Satz für ein Zeitfenster
  function lage(eintraege, abMs, namen) {
    const liste = eintraege.filter((e) => e.t * 1000 >= abMs);
    const zaehl = {};
    let ton = 0, wichtig = 0;
    liste.forEach((e) => { e.werte.filter((w) => w.direkt).forEach((w) => (zaehl[w.slug] = (zaehl[w.slug] || 0) + 1)); ton += e.tendenz; if (e.gewicht === 3) wichtig++; });
    const top = Object.entries(zaehl).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([s, n]) => ({ slug: s, name: (namen && namen[s]) || s, n }));
    const themen = {};
    liste.forEach((e) => (themen[e.thema] = (themen[e.thema] || 0) + 1));
    const schnitt = liste.length ? ton / liste.length : 0;
    return { n: liste.length, wichtig, top, themen, ton: schnitt, tonText: liste.length < 3 ? "zu wenig Meldungen" : schnitt > 0.15 ? "eher positiv" : schnitt < -0.15 ? "eher negativ" : "gemischt" };
  }

  /* ================================================================ Statistik aus Tagesschlusskursen */
  // liste: [{ date: "JJJJ-MM-TT", close }] → { t: Tage seit 1970, c }
  function reihe(liste) {
    const n = liste.length, t = new Float64Array(n), c = new Float64Array(n);
    const mitKerzen = n > 0 && liste.some((x) => x.open != null);
    const o = mitKerzen ? new Float64Array(n) : null, h = mitKerzen ? new Float64Array(n) : null, l = mitKerzen ? new Float64Array(n) : null;
    for (let i = 0; i < n; i++) {
      t[i] = Math.round(Date.parse(liste[i].date + "T00:00:00Z") / TAG_MS); c[i] = +liste[i].close;
      if (mitKerzen) { // fehlende Werte einzelner Tage: Kerze ohne Docht auf dem Schlusskurs
        const x = liste[i];
        o[i] = x.open != null ? +x.open : c[i]; h[i] = Math.max(x.high != null ? +x.high : c[i], o[i], c[i]); l[i] = Math.min(x.low != null ? +x.low : c[i], o[i], c[i]);
      }
    }
    return { t, c, n, o, h, l };
  }
  function indexBis(r, tag) { let lo = 0, hi = r.n; while (lo < hi) { const m = (lo + hi) >> 1; if (r.t[m] <= tag) lo = m + 1; else hi = m; } return lo - 1; }
  function wertAm(r, tag) { const i = indexBis(r, tag); return i >= 0 ? r.c[i] : null; }
  const ZEITRAEUME = [["1W", 7], ["1M", 30], ["3M", 91], ["6M", 182], ["1J", 365], ["3J", 1095], ["5J", 1826]];
  function renditen(r, kurs) {
    if (!r || r.n < 2) return {};
    const letzter = r.t[r.n - 1], p = kurs || r.c[r.n - 1], aus = {};
    for (const [k, tage] of ZEITRAEUME) {
      if (r.t[0] > letzter - tage + 3) continue;
      const alt = wertAm(r, letzter - tage);
      aus[k] = alt ? p / alt - 1 : null;
    }
    const jahr = new Date(letzter * TAG_MS).getUTCFullYear();
    const ende = wertAm(r, Math.round(Date.UTC(jahr - 1, 11, 31) / TAG_MS));
    aus.YTD = ende && r.t[0] <= Math.round(Date.UTC(jahr - 1, 11, 31) / TAG_MS) ? p / ende - 1 : null;
    return aus;
  }
  function logRenditen(r, n) {
    const ab = Math.max(1, r.n - n), aus = [];
    for (let i = ab; i < r.n; i++) if (r.c[i - 1] > 0 && r.c[i] > 0) aus.push(Math.log(r.c[i] / r.c[i - 1]));
    return aus;
  }
  const mittel = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  function stdabw(a) { if (a.length < 2) return null; const m = mittel(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) * (x - m), 0) / (a.length - 1)); }
  function volatilitaet(r, n = 252) { const s = stdabw(logRenditen(r, n)); return s == null ? null : s * Math.sqrt(252); }
  function maxRueckgang(r, n = 252) {
    const ab = Math.max(0, r.n - n - 1);
    let hoch = -Infinity, hochTag = null, tiefe = 0, von = null, bis = null;
    for (let i = ab; i < r.n; i++) {
      if (r.c[i] > hoch) { hoch = r.c[i]; hochTag = r.t[i]; }
      const d = r.c[i] / hoch - 1;
      if (d < tiefe) { tiefe = d; von = hochTag; bis = r.t[i]; }
    }
    return { tiefe, von, bis };
  }
  function sharpe(r, n = 252, zins = 0) {
    const a = logRenditen(r, n), s = stdabw(a);
    if (!s || a.length < 60) return null;
    return (mittel(a) * 252 - zins) / (s * Math.sqrt(252));
  }
  // gemeinsame Handelstage zweier Reihen → tägliche Renditen
  function gemeinsam(a, b, n = 252) {
    const ma = new Map(), x = [], y = [];
    for (let i = Math.max(0, a.n - n - 10); i < a.n; i++) ma.set(a.t[i], a.c[i]);
    let la = null, lb = null;
    for (let j = Math.max(0, b.n - n - 10); j < b.n; j++) {
      const va = ma.get(b.t[j]);
      if (va == null) continue;
      if (la != null) { x.push(Math.log(va / la)); y.push(Math.log(b.c[j] / lb)); }
      la = va; lb = b.c[j];
    }
    return { x: x.slice(-n), y: y.slice(-n) };
  }
  function korrelation(x, y) {
    if (x.length < 20) return null;
    const mx = mittel(x), my = mittel(y);
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < x.length; i++) { const a = x[i] - mx, b = y[i] - my; sxy += a * b; sxx += a * a; syy += b * b; }
    return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null;
  }
  function betaKorr(r, markt, n = 252) {
    const { x, y } = gemeinsam(r, markt, n);
    const k = korrelation(x, y);
    if (k == null) return { beta: null, korr: null, n: x.length };
    return { beta: k * (stdabw(x) / stdabw(y)), korr: k, n: x.length };
  }
  function korrelationen(reihen, n = 252) {
    const m = reihen.map(() => reihen.map(() => null));
    for (let i = 0; i < reihen.length; i++) {
      m[i][i] = reihen[i] ? 1 : null;
      for (let j = i + 1; j < reihen.length; j++) {
        if (!reihen[i] || !reihen[j]) continue;
        const { x, y } = gemeinsam(reihen[i], reihen[j], n);
        m[i][j] = m[j][i] = korrelation(x, y);
      }
    }
    return m;
  }
  // Tagesbewegung in Standardabweichungen (aus der Volatilität eines Monats)
  const sigma = (veraenderung, vol) => (veraenderung == null || !vol ? null : veraenderung / (vol / Math.sqrt(252)));

  /* ================================================================ Börsenzeiten (Minuten seit Mitternacht, Montag bis Freitag) */
  const BOERSEN = [
    { id: "ny", name: "New York", kurz: "NYSE", tz: "America/New_York", zeiten: [[570, 960]] },
    { id: "fra", name: "Frankfurt", kurz: "Xetra", tz: "Europe/Berlin", zeiten: [[540, 1050]] },
    { id: "ldn", name: "London", kurz: "LSE", tz: "Europe/London", zeiten: [[480, 990]] },
    { id: "tyo", name: "Tokio", kurz: "TSE", tz: "Asia/Tokyo", zeiten: [[540, 690], [750, 930]] },
    { id: "hkg", name: "Hongkong", kurz: "HKEX", tz: "Asia/Hong_Kong", zeiten: [[570, 720], [780, 960]] },
  ];
  // Devisenmarkt: Sonntag 17:00 bis Freitag 17:00 New York
  const FOREX = { id: "fx", name: "Forex", kurz: "FX", tz: "America/New_York", woche: [[17 * 60, 5 * 1440 + 17 * 60]] };
  const formatierer = {};
  const WTAG = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  function ortszeit(tz, ms) {
    const f = formatierer[tz] || (formatierer[tz] = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }));
    const p = {};
    f.formatToParts(new Date(ms)).forEach((x) => (p[x.type] = x.value));
    const h = +p.hour % 24, m = +p.minute, s = +p.second;
    return { wtag: WTAG[p.weekday], min: h * 60 + m, sek: s, hhmm: String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0") };
  }
  function wochenIntervalle(b) {
    if (b.woche) return b.woche;
    const aus = [];
    for (let w = 1; w <= 5; w++) b.zeiten.forEach(([a, z]) => aus.push([w * 1440 + a, w * 1440 + z]));
    return aus;
  }
  // → { offen, pause, wechselMs, ort }
  function boersenStatus(b, ms) {
    const o = ortszeit(b.tz, ms);
    const p = o.wtag * 1440 + o.min + o.sek / 60;
    const iv = wochenIntervalle(b);
    for (const [a, z] of iv) if (p >= a && p < z) return { offen: true, pause: false, wechselMs: (z - p) * 6e4, ort: o.hhmm };
    let naechster = Infinity;
    for (const [a] of iv) { const d = a > p ? a - p : a + 7 * 1440 - p; if (d < naechster) naechster = d; }
    const heute = o.wtag * 1440;
    const pause = !b.woche && iv.some(([a, z]) => a >= heute && z <= p) && iv.some(([a]) => a > p && a < heute + 1440);
    return { offen: false, pause, wechselMs: naechster * 6e4, ort: o.hhmm };
  }

  /* ================================================================ Zeitangaben */
  const zwei = (x) => String(x).padStart(2, "0");
  function dauer(ms) {
    if (ms == null || !isFinite(ms)) return "–";
    const s = Math.max(0, Math.floor(ms / 1000)), t = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sek = s % 60;
    if (t) return `${t} T ${zwei(h)}:${zwei(m)}:${zwei(sek)}`;
    if (h) return `${h}:${zwei(m)}:${zwei(sek)}`;
    return `${zwei(m)}:${zwei(sek)}`;
  }
  function alter(ms) {
    if (ms < 45e3) return "gerade eben";
    if (ms < 3600e3) return `vor ${Math.max(1, Math.round(ms / 6e4))} Min.`;
    if (ms < 86400e3) { const h = Math.floor(ms / 3600e3), m = Math.round((ms % 3600e3) / 6e4); return m && h < 3 ? `vor ${h} Std. ${m} Min.` : `vor ${h} Std.`; }
    const t = Math.floor(ms / 86400e3);
    return t === 1 ? "gestern" : `vor ${t} Tagen`;
  }

  /* ================================================================ Kalender */
  // Demo-Termine liegen in der Woche des Demo-Laufs: um ganze Wochen auf die aktuelle Woche verschieben
  function demoVerschieben(kal, jetztMs) {
    if (!kal || !kal.demo || !kal.heute) return kal;
    const montag = (ms) => { const d = Math.floor(ms / TAG_MS); return d - ((new Date(d * TAG_MS).getUTCDay() + 6) % 7); };
    const wochen = Math.round((montag(jetztMs) - montag(Date.parse(kal.heute + "T12:00:00Z"))) / 7);
    if (!wochen) return kal;
    const tage = wochen * 7;
    const neuerTag = (s) => new Date(Date.parse(s + "T00:00:00Z") + tage * TAG_MS).toISOString().slice(0, 10);
    return Object.assign({}, kal, {
      heute: neuerTag(kal.heute),
      termine: kal.termine.map((e) => Object.assign({}, e, { tag: neuerTag(e.tag), t: e.t == null ? null : e.t + tage * 1440 })),
    });
  }
  // Ist gegenüber Prognose, sonst Vorwert: { diff, bezug, ton (+1 gut für die Währung, −1 schlecht, 0 gleich) }
  function ueberraschung(w) {
    if (!w || w.ist == null) return null;
    const bezug = w.prog != null ? "prog" : w.vor != null ? "vor" : null;
    if (!bezug) return null;
    const diff = w.ist - w[bezug];
    const d = Math.abs(diff) < Math.pow(10, -(w.dez || 0)) / 2 ? 0 : diff;
    return { diff: d, bezug, ton: d === 0 ? 0 : Math.sign(d) * (w.gut || 1) };
  }
  // Startzeit in Minuten (ganztägige Termine: Tagesbeginn in UTC)
  const startMin = (e) => (e.t != null ? e.t : Math.round(Date.parse(e.tag + "T00:00:00Z") / 6e4));
  function naechster(termine, jetztMin, minWichtig = 2) {
    return termine.filter((e) => e.t != null && e.t >= jetztMin && e.wichtig >= minWichtig).sort((a, b) => a.t - b.t)[0] || null;
  }

  // Marktreaktion früherer Termine: Kursbewegung nach 15 und 60 Minuten bzw. am Tag (braucht WBBacktestKern)
  function reaktion(K, w, termine, fenster = [15, 60]) {
    const aus = [];
    for (const e of termine) {
      let vorher = null, nach = {}, aufl = null;
      for (const k of K.kerzenAb(w, e.t)) {
        if (vorher == null) { vorher = k.o; aufl = k.aufl; if (aufl === "tag") break; }
        for (const f of fenster) if (nach[f] == null && k.ende >= e.t + f) nach[f] = k.c;
        if (fenster.every((f) => nach[f] != null)) break;
        if (k.t > e.t + Math.max(...fenster) + 1440) break;
      }
      if (aufl === "tag" || vorher == null) {
        // nur Tageskurse: Schluss am Tag des Termins gegenüber dem Vortagesschluss
        const i = K.tagBei ? K.tagBei(w, e.t) : -1;
        if (i > 0) aus.push({ t: e.t, ueb: e.ueb, aufl: "tag", tag: w.c[i] / w.c[i - 1] - 1 });
        continue;
      }
      const z = { t: e.t, ueb: e.ueb, aufl };
      for (const f of fenster) z[f] = nach[f] != null ? nach[f] / vorher - 1 : null;
      aus.push(z);
    }
    return aus;
  }


  /* ================================================================ News-Feed nach Art von Forex Factory */
  // Währungs-Tags: aus Stichwörtern (Notenbank, Währungsname, Kürzel) und aus den zugeordneten Werten
  const CODES = ["USD", "EUR", "GBP", "JPY", "CHF", "CNY", "AUD", "CAD"];
  const WAEHRUNG_RX = Object.fromEntries(Object.entries(WAEHRUNG).map(([c, l]) => [c, rx(l.concat([c]), "")]));
  function waehrungen(e, werte) {
    const text = (e.titel || "") + " " + (e.text || "").slice(0, 400);
    const aus = [];
    const dazu = (c) => { if (c && CODES.includes(c) && !aus.includes(c)) aus.push(c); };
    for (const t of e.werte || []) {
      const b = werte && werte[t.slug];
      if (!b || !t.direkt) continue;
      const m = String(b.symbol).match(/^([A-Z]{3})([A-Z]{3})=X$/);
      if (m) { dazu(m[1]); dazu(m[2]); } else dazu(b.waehrung);
    }
    for (const c of CODES) if (WAEHRUNG_RX[c] && (WAEHRUNG_RX[c].test(text) || new RegExp("\\b" + c + "\\b").test(text))) dazu(c);
    return aus.slice(0, 3);
  }
  // Art der Meldung: offizielle Mitteilung, Analyse/Ausblick oder Nachricht
  const ANALYSE = grenze(/\b(analysis|outlook|preview|week ahead|what to (?:watch|know|expect)|technical|chart(?:ing)?|strategist|opinion|column|Ausblick|Analyse|Vorschau|Kommentar|Chartanalyse|Wochenausblick)\b/i);
  function art(e) {
    if (e.herkunft === "fed" || e.herkunft === "ezb" || e.herkunft === "sec") return "offiziell";
    return ANALYSE.test(e.titel || "") ? "analyse" : "nachricht";
  }
  // Mehrere Quellen zur selben Geschichte bündeln (ähnliche Titelwörter innerhalb von acht Stunden)
  const STOPP = new Set(["with", "from", "after", "says", "said", "that", "this", "their", "into", "over", "amid", "than", "will", "have", "been", "were",
    "what", "about", "more", "shares", "stock", "stocks", "über", "nach", "eine", "einer", "mehr", "sich", "noch", "beim", "wird", "werden", "aktie", "aktien"]);
  const kernwoerter = (t) => new Set(String(t).toLowerCase().replace(/[^a-z0-9äöüß/ ]+/g, " ").split(" ").filter((w) => w.length > 3 && !STOPP.has(w)));
  // gleich, wenn mindestens drei Kernwörter übereinstimmen oder sich die Titel sehr ähneln
  function gleicheGeschichte(a, b) {
    if (!a.size || !b.size) return false;
    let g = 0;
    a.forEach((w) => { if (b.has(w)) g++; });
    return g >= 3 && g / Math.min(a.size, b.size) >= 0.5 || g / (a.size + b.size - g) >= 0.6;
  }
  function buendeln(liste) {
    const buendel = [];
    const sortiert = liste.slice().sort((a, b) => b.t - a.t);
    const direkt = (e) => new Set((e.werte || []).filter((x) => x.direkt).map((x) => x.slug));
    for (const e of sortiert) {
      const w = kernwoerter(e.titel), d = direkt(e);
      // verschiedene Unternehmen sind nie dieselbe Geschichte, auch bei ähnlichem Titel
      const passt = (g) => !d.size || !g.direkt.size || [...d].some((x) => g.direkt.has(x));
      const ziel = buendel.find((g) => Math.abs(g.t - e.t) < 8 * 3600 && passt(g) && ((e.url && g.urls.has(e.url)) || g.woerter.some((x) => gleicheGeschichte(x, w))));
      if (ziel) {
        ziel.alle.push(e); ziel.woerter.push(w); if (e.url) ziel.urls.add(e.url); d.forEach((x) => ziel.direkt.add(x));
        if (e.gewicht >= ziel.kopf.gewicht) ziel.kopf = e; // bei gleicher Wichtigkeit die erste Meldung (Liste läuft rückwärts)
      } else buendel.push({ kopf: e, alle: [e], woerter: [w], urls: new Set(e.url ? [e.url] : []), t: e.t, direkt: d });
    }
    return buendel.map((g) => {
      const quellen = [...new Set(g.alle.map((x) => x.quelle))];
      const werte = [], tags = [];
      g.alle.forEach((x) => { (x.werte || []).forEach((v) => { if (!werte.some((y) => y.slug === v.slug)) werte.push(v); }); (x.tags || []).forEach((c) => { if (!tags.includes(c)) tags.push(c); }); });
      werte.sort((a, b) => b.direkt - a.direkt);
      return { id: g.kopf.id, kopf: g.kopf, alle: g.alle, t: Math.max(...g.alle.map((x) => x.t)), erst: Math.min(...g.alle.map((x) => x.t)),
               gewicht: Math.max(...g.alle.map((x) => x.gewicht)), quellen, werte, tags: tags.slice(0, 3) };
    });
  }
  // Heiß: Wichtigkeit, Zahl der Quellen, Bezug zu deinen Werten und Frische (Halbwertszeit vier Stunden)
  function heiss(b, jetztSek) {
    const alterStd = Math.max(0, (jetztSek - b.t) / 3600);
    const bezug = b.werte.some((w) => w.direkt) ? 1.5 : 1;
    return b.gewicht * b.gewicht * (1 + 0.6 * (b.quellen.length - 1)) * bezug * Math.pow(0.5, alterStd / 4);
  }
  // Eilmeldung: wichtig und höchstens 30 Minuten alt
  const eil = (b, jetztSek, minuten = 30) => b.gewicht === 3 && jetztSek - b.t <= minuten * 60;

  /* ================================================================ Handelssitzungen (wie die Market Hours bei Forex Factory) */
  const SITZUNGEN = [
    { id: "syd", name: "Sydney", tz: "Australia/Sydney", auf: 8 * 60, zu: 17 * 60 },
    { id: "tyo", name: "Tokio", tz: "Asia/Tokyo", auf: 9 * 60, zu: 18 * 60 },
    { id: "ldn", name: "London", tz: "Europe/London", auf: 8 * 60, zu: 17 * 60 },
    { id: "ny", name: "New York", tz: "America/New_York", auf: 8 * 60, zu: 17 * 60 },
  ];
  const teilFormat = {};
  function versatz(tz, ms) { // Minuten, um die die Ortszeit vor UTC liegt
    const f = teilFormat[tz] || (teilFormat[tz] = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }));
    const p = {};
    f.formatToParts(new Date(ms)).forEach((x) => (p[x.type] = x.value));
    return Math.round((Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - ms) / 6e4);
  }
  function ortszeitZuMs(tz, j, m, t, minuten) { // Wandzeit in einer Zone → Millisekunden UTC
    const roh = Date.UTC(j, m - 1, t, 0, minuten);
    let ms = roh - versatz(tz, roh) * 6e4;
    ms = roh - versatz(tz, ms) * 6e4;
    return ms;
  }
  function datumIn(tz, ms) {
    const p = {};
    (teilFormat[tz + "d"] || (teilFormat[tz + "d"] = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" })))
      .formatToParts(new Date(ms)).forEach((x) => (p[x.type] = x.value));
    return { j: +p.year, m: +p.month, t: +p.day, wtag: WTAG[p.weekday] };
  }
  // Sitzungen des Tages in einer Zone (Standard: deutsche Zeit) als Minuten ab Mitternacht, ohne Wochenenden
  function sitzungen(jetztMs, zone = "Europe/Berlin") {
    const d = datumIn(zone, jetztMs);
    const start = ortszeitZuMs(zone, d.j, d.m, d.t, 0), ende = start + 864e5;
    return SITZUNGEN.map((s) => {
      const teile = [];
      for (const k of [-1, 0, 1]) {
        const lokal = datumIn(s.tz, start + k * 864e5 + 12 * 3600e3);
        if (lokal.wtag === 0 || lokal.wtag === 6) continue;
        const a = ortszeitZuMs(s.tz, lokal.j, lokal.m, lokal.t, s.auf), z = ortszeitZuMs(s.tz, lokal.j, lokal.m, lokal.t, s.zu);
        const von = Math.max(a, start), bis = Math.min(z, ende);
        if (bis > von && !teile.some(([x, y]) => Math.abs(x - (von - start) / 6e4) < 1 && Math.abs(y - (bis - start) / 6e4) < 1)) teile.push([(von - start) / 6e4, (bis - start) / 6e4]);
      }
      const offen = W_offen(s, jetztMs);
      return Object.assign({}, s, { teile, offen });
    });
    function W_offen(s, ms) {
      const o = ortszeit(s.tz, ms);
      return o.wtag >= 1 && o.wtag <= 5 && o.min >= s.auf && o.min < s.zu;
    }
  }
  const minutenHeute = (zone, ms) => { const o = ortszeit(zone, ms); return o.min + o.sek / 60; };

  /* ================================================================ Demo-Nachrichten (erfunden, nur für die Vorschau) */
  const DEMO = [
    { t: "{aktie}: Analyst hebt Kursziel an", x: "Ein Analyst erhöht das Kursziel für {aktie} und verweist auf eine stabile Nachfrage. Die Einstufung bleibt unverändert. Beispieltext für die Vorschau.", th: "unternehmen" },
    { t: "{aktie} übertrifft Erwartungen beim Quartalsumsatz", x: "{aktie} meldet einen Quartalsumsatz über dem Konsens der Analysten. Der Ausblick für das laufende Quartal liegt im Rahmen. Beispieltext.", th: "unternehmen" },
    { t: "{aktie} senkt Prognose für das Gesamtjahr", x: "Das Management von {aktie} rechnet mit schwächeren Margen. Die Aktie gibt nachbörslich nach. Beispieltext für die Vorschau.", th: "unternehmen" },
    { t: "Ölpreis steigt nach Förderkürzung der OPEC+", x: "Brent verteuert sich, nachdem die Förderländer eine geringere Produktion angekündigt haben. Händler erwarten ein knapperes Angebot. Beispieltext.", th: "rohstoffe" },
    { t: "Gold klettert auf Wochenhoch", x: "Der Goldpreis steigt, weil die Renditen von US-Staatsanleihen nachgeben. Auch Silber legt zu. Beispieltext für die Vorschau.", th: "rohstoffe" },
    { t: "Fed-Mitglied: Zinsen bleiben vorerst unverändert", x: "Ein Mitglied des Offenmarktausschusses sieht keinen Anlass für eine schnelle Zinssenkung. Die Inflation sei noch zu hoch. Beispieltext.", th: "notenbank" },
    { t: "EZB-Rat diskutiert weitere Zinssenkung", x: "Mehrere Ratsmitglieder halten eine weitere Senkung im Dezember für möglich. Der Euro gibt leicht nach. Beispieltext für die Vorschau.", th: "notenbank" },
    { t: "Dollar fester vor US-Inflationsdaten", x: "Der Dollar legt gegenüber Euro und Yen zu. Anleger warten auf die Verbraucherpreise am Mittwoch. Beispieltext.", th: "devisen" },
    { t: "Wall Street schließt mit Rekordhoch", x: "Der S&P 500 und der Nasdaq beenden den Handel auf Rekordniveau. Technologiewerte führen die Gewinne an. Beispieltext für die Vorschau.", th: "maerkte" },
    { t: "DAX fällt unter wichtige Marke", x: "Der deutsche Leitindex verliert, belastet von Autowerten. Händler verweisen auf neue Zölle. Beispieltext für die Vorschau.", th: "maerkte" },
    { t: "Kupfer verbilligt sich wegen schwacher Daten aus China", x: "Der Kupferpreis sinkt nach enttäuschenden Industriedaten aus China. Die Nachfrage aus dem Bausektor bleibt gering. Beispieltext.", th: "rohstoffe" },
    { t: "{aktie} kündigt Übernahme an", x: "{aktie} übernimmt einen kleineren Anbieter aus der eigenen Branche. Der Kaufpreis wird in bar bezahlt. Beispieltext für die Vorschau.", th: "unternehmen" },
    { t: "US-Erstanträge auf Arbeitslosenhilfe steigen leicht", x: "Die Zahl der Erstanträge liegt etwas über der Prognose. Der Arbeitsmarkt bleibt insgesamt robust. Beispieltext für die Vorschau.", th: "konjunktur" },
    { t: "Yen schwächer nach Aussagen der Bank of Japan", x: "Die Bank of Japan signalisiert Geduld bei weiteren Zinserhöhungen. Der Yen verliert gegenüber dem Euro. Beispieltext.", th: "devisen" },
    { t: "{aktie} stockt Aktienrückkauf auf", x: "{aktie} erweitert das Rückkaufprogramm. Zugleich steigt die Dividende. Beispieltext für die Vorschau.", th: "unternehmen" },
    { t: "Neue Zölle belasten europäische Börsen", x: "Die angekündigten Zölle treffen vor allem Industrie- und Autowerte. Der Euro Stoxx 50 gibt nach. Beispieltext für die Vorschau.", th: "politik" },
    { t: "Wochenausblick: Anleger blicken auf US-Inflationsdaten", x: "Die Verbraucherpreise am Mittwoch gelten als wichtigster Termin der Woche. Erwartet wird ein leichter Rückgang. Beispieltext.", th: "konjunktur" },
    { t: "Analyse: Warum der Yen weiter nachgibt", x: "Der Zinsabstand zu den USA bleibt groß. Händler sehen wenig Grund für eine schnelle Wende. Beispieltext für die Vorschau.", th: "devisen" },
  ];
  const DEMO_QUELLEN = ["Demo-Ticker", "Demo-Wire", "Demo-Agentur"];
  function zufall(saat) { let s = saat >>> 0 || 1; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
  function demoMeldung(nr, aktien, tMs, rnd, vorlage) {
    const v = DEMO[vorlage != null ? vorlage % DEMO.length : Math.floor(rnd() * DEMO.length)];
    const a = aktien.length ? aktien[Math.floor(rnd() * aktien.length)] : { name: "Beispiel AG", symbol: "BSP" };
    const ersetze = (s) => s.replace(/\{aktie\}/g, a.name);
    return { id: "demo" + nr, nr, t: Math.floor(tMs / 1000), quelle: DEMO_QUELLEN[nr % DEMO_QUELLEN.length], titel: ersetze(v.t), text: ersetze(v.x), url: "",
             symbole: v.t.includes("{aktie}") ? [String(a.finnhub || a.symbol).toUpperCase()] : [], thema: v.th, herkunft: "demo" };
  }
  // dieselbe Geschichte von einer zweiten Demo-Quelle, etwas anders betitelt (zeigt das Bündeln)
  function demoZweitquelle(m, nr, tMs) {
    return Object.assign({}, m, { id: "demo" + nr, nr, t: Math.floor(tMs / 1000), quelle: DEMO_QUELLEN[(DEMO_QUELLEN.indexOf(m.quelle) + 1) % DEMO_QUELLEN.length],
                                  titel: m.titel + " – Bericht" });
  }

  return {
    bereinige, sichereUrl, saetze, kurzfassung, muster, zuordnen, thema, THEMA_NAME, gewicht, tendenz, aufbereiten, lage,
    reihe, wertAm, renditen, logRenditen, volatilitaet, maxRueckgang, sharpe, betaKorr, korrelation, korrelationen, sigma,
    BOERSEN, FOREX, ortszeit, boersenStatus, dauer, alter,
    demoVerschieben, ueberraschung, startMin, naechster, reaktion, demoMeldung, demoZweitquelle, zufall,
    waehrungen, art, buendeln, heiss, eil, SITZUNGEN, sitzungen, minutenHeute, versatz,
  };
});
