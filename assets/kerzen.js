/* Fathom: Kerzencharts (Candlesticks) für alle Kursdiagramme.
 *
 * Ein Schalter „Linie | Kerzen“ an jedem Kurschart; die Wahl gilt überall und bleibt in diesem Browser gespeichert
 * (fathom.chartart). Diagramme hören auf das Ereignis „wb:chartart“ und zeichnen sich neu.
 * Grüne Kerze: Schluss über Eröffnung, rote Kerze: Schluss unter Eröffnung; der Docht reicht von Tief bis Hoch.
 * Sind es mehr Kerzen, als nebeneinander passen, werden benachbarte zusammengefasst (z. B. Tage zu Wochen).
 * Läuft auch unter Node (für Tests): module.exports.
 */
(function (wurzel, fabrik) {
  const kern = fabrik();
  if (typeof module === "object" && module.exports) module.exports = kern;
  else wurzel.WBKerzen = kern;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const SCHLUESSEL = "fathom.chartart";
  let gemerkt = null;
  function art() {
    if (gemerkt) return gemerkt;
    try { gemerkt = localStorage.getItem(SCHLUESSEL) === "kerzen" ? "kerzen" : "linie"; } catch (e) { gemerkt = "linie"; }
    return gemerkt;
  }
  function setze(neu) {
    gemerkt = neu === "kerzen" ? "kerzen" : "linie";
    try { localStorage.setItem(SCHLUESSEL, gemerkt); } catch (e) { /* privat */ }
    if (typeof document !== "undefined") {
      document.querySelectorAll("[data-chartart]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.chartart === gemerkt)));
      document.dispatchEvent(new CustomEvent("wb:chartart", { detail: gemerkt }));
    }
  }
  // Umschalter als HTML (Knöpfe tragen data-chartart; ein Klick irgendwo auf der Seite schaltet alle Charts um)
  function schalter(klasse) {
    const a = art();
    return `<span class="chart-art ${klasse || ""}" role="group" aria-label="Darstellung">`
      + `<button type="button" data-chartart="linie" aria-pressed="${a === "linie"}" title="Linie">${ICON.linie}<span>Linie</span></button>`
      + `<button type="button" data-chartart="kerzen" aria-pressed="${a === "kerzen"}" title="Kerzen">${ICON.kerzen}<span>Kerzen</span></button></span>`;
  }
  const ICON = {
    linie: '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M1.5 12 6 7l3 3 5.5-6"/></svg>',
    kerzen: '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M4 2v12M12 3v11"/><rect x="2.3" y="5" width="3.4" height="5" class="voll"/><rect x="10.3" y="6" width="3.4" height="4.5"/></svg>',
  };

  /* Benachbarte Kerzen zusammenfassen, bis höchstens `ziel` übrig sind.
     Eingabe: x (Zeitpunkte), o, h, l, c (gleich lange Arrays; fehlende o/h/l → Schlusskurs). */
  function buendeln(x, o, h, l, c, ziel) {
    const n = c.length;
    const k = Math.max(1, Math.ceil(n / Math.max(1, ziel)));
    const aus = { x: [], o: [], h: [], l: [], c: [], von: [], bis: [], k };
    for (let a = 0; a < n; a += k) {
      const b = Math.min(n, a + k);
      let hi = -Infinity, lo = Infinity, oo = null, cc = null;
      for (let i = a; i < b; i++) {
        const ci = c[i]; if (ci == null || !isFinite(ci)) continue;
        const oi = o && o[i] != null ? o[i] : ci, hi_ = h && h[i] != null ? h[i] : Math.max(oi, ci), lo_ = l && l[i] != null ? l[i] : Math.min(oi, ci);
        if (oo == null) oo = oi;
        cc = ci; hi = Math.max(hi, hi_, oi, ci); lo = Math.min(lo, lo_, oi, ci);
      }
      if (oo == null) continue;
      aus.x.push(x[a]); aus.o.push(oo); aus.h.push(hi); aus.l.push(lo); aus.c.push(cc); aus.von.push(a); aus.bis.push(b - 1);
    }
    return aus;
  }

  /* SVG-Pfade für Kerzen. X(i) liefert die Mitte der Kerze i, Y(v) die Höhe; breite in Pixeln.
     Zurück: { auf, ab } als d-Attribute (Docht und Körper in einem Pfad je Richtung). */
  function pfade(k, X, Y, breite) {
    let auf = "", ab = "";
    const b = Math.max(1, breite), hb = b / 2;
    for (let i = 0; i < k.c.length; i++) {
      const x = X(i), o = k.o[i], c = k.c[i], hoch = Y(k.h[i]), tief = Y(k.l[i]);
      const oben = Y(Math.max(o, c)), unten = Y(Math.min(o, c));
      const koerper = Math.max(1, unten - oben);
      const d = `M${x.toFixed(1)} ${hoch.toFixed(1)}V${oben.toFixed(1)}M${x.toFixed(1)} ${(oben + koerper).toFixed(1)}V${tief.toFixed(1)}`
        + `M${(x - hb).toFixed(1)} ${oben.toFixed(1)}h${b.toFixed(1)}v${koerper.toFixed(1)}h${(-b).toFixed(1)}Z`;
      if (c >= o) auf += d; else ab += d;
    }
    return { auf, ab };
  }
  // Kerzenbreite aus dem Abstand zweier Kerzen (70 %, mindestens 1 px, höchstens 14 px)
  const breiteAus = (abstand) => Math.max(1, Math.min(14, abstand * 0.7));

  if (typeof document !== "undefined") {
    document.addEventListener("click", (e) => {
      const b = e.target.closest("[data-chartart]");
      if (b) { e.preventDefault(); setze(b.dataset.chartart); }
    });
  }
  return { art, setze, schalter, buendeln, pfade, breiteAus, ICON };
});
