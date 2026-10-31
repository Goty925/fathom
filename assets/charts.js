/* Kleine Diagramm-Bibliothek für den Wochenbericht.
 * Zeichnet Linien- und Säulendiagramme als SVG, passend zur Breite des
 * Containers, mit Fadenkreuz und Tooltip (Maus, Touch und Pfeiltasten).
 * Die Daten stehen als JSON im <script id="chart-daten"> der Seite.
 */
(function () {
  "use strict";
  const NS = "http://www.w3.org/2000/svg";
  const de = window.WBH.nf;
  const MONATE = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];

  function el(name, attrs, parent) {
    const n = document.createElementNS(NS, name);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  function text(parent, x, y, s, cls, anchor) {
    const t = el("text", { x, y, class: cls || "achse", "text-anchor": anchor || "start" }, parent);
    t.textContent = s;
    return t;
  }

  // Runde Achsenwerte (1, 2, 2.5, 5 × 10^n)
  function ticks(lo, hi, n) {
    const roh = (hi - lo) / Math.max(n, 1);
    const p = Math.pow(10, Math.floor(Math.log10(roh)));
    const schritt = [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= roh) || 10 * p;
    const start = Math.ceil(lo / schritt) * schritt;
    const out = [];
    for (let v = start; v <= hi + 1e-9; v += schritt) out.push(+v.toFixed(10));
    return { werte: out, schritt };
  }
  function dezimalen(schritt) { return schritt >= 1 ? 0 : schritt >= 0.1 ? 1 : 2; }
  function kurz(v) {
    const a = Math.abs(v);
    if (a >= 1e12) return de(1).format(v / 1e12) + " Bio.";
    if (a >= 1e9) return de(1).format(v / 1e9) + " Mrd.";
    if (a >= 1e6) return de(0).format(v / 1e6) + " Mio.";
    return de(2).format(v);
  }
  function zeitText(iso) {
    const d = new Date(iso);
    return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0") + " Uhr";
  }
  function datumText(iso, mitJahr) {
    const [j, m, t] = iso.split("-");
    return mitJahr === "monat" ? MONATE[+m - 1] + " " + j : `${+t}. ${MONATE[+m - 1]} ${j}`;
  }

  /* ------------------------------------------------------------ Tooltip */
  function tooltip(box) {
    const t = document.createElement("div");
    t.className = "tooltip";
    t.hidden = true;
    box.appendChild(t);
    return {
      zeige(x, y, titel, zeilen) {
        t.replaceChildren();
        const h = document.createElement("div");
        h.className = "tt-titel";
        h.textContent = titel;
        t.appendChild(h);
        for (const z of zeilen) {
          const r = document.createElement("div");
          r.className = "tt-zeile";
          const key = document.createElement("span");
          key.className = "tt-key " + (z.art || "");
          key.style.setProperty("--farbe", z.farbe);
          const w = document.createElement("strong");
          w.textContent = z.wert;
          const l = document.createElement("span");
          l.textContent = z.name;
          r.append(key, w, l);
          t.appendChild(r);
        }
        t.hidden = false;
        const bw = box.clientWidth, tw = t.offsetWidth;
        t.style.left = Math.min(Math.max(x + 12, 0), bw - tw) + "px";
        t.style.top = Math.max(y - t.offsetHeight - 10, 0) + "px";
        if (x + 12 + tw > bw) t.style.left = Math.max(x - tw - 12, 0) + "px";
      },
      verstecke() { t.hidden = true; },
    };
  }

  /* ------------------------------------------------------------ Liniendiagramm */
  function linien(box, cfg) {
    const B = box.clientWidth, H = box.clientHeight;
    const n = cfg.x.length;
    const bandBreite = cfg.band ? 56 : 0;
    const m = { o: 12, r: 52 + bandBreite, u: 28, l: 4 };
    const pw = B - m.l - m.r, ph = H - m.o - m.u;

    // Kerzen statt Linie für die erste Reihe, wenn Eröffnung/Hoch/Tief vorliegen und der Schalter auf Kerzen steht
    const KZ = window.WBKerzen;
    const kerzen = !!(cfg.ohlc && KZ && KZ.art() === "kerzen");
    let werte = [];
    cfg.serien.forEach((s) => s.werte.forEach((v) => v != null && werte.push(v)));
    if (kerzen) { cfg.ohlc.h.forEach((v) => v != null && werte.push(v)); cfg.ohlc.l.forEach((v) => v != null && werte.push(v)); }
    if (cfg.band) werte.push(cfg.band.tief, cfg.band.hoch);
    if (cfg.referenz) werte.push(cfg.referenz.wert);
    let lo = Math.min(...werte), hi = Math.max(...werte);
    const pad = (hi - lo) * 0.08 || 1;
    lo -= pad; hi += pad;
    const t = ticks(lo, hi, B < 500 ? 4 : 5);
    const X = (i) => m.l + (n === 1 ? pw / 2 : (i / (n - 1)) * pw);
    const Y = (v) => m.o + (1 - (v - lo) / (hi - lo)) * ph;
    const fmtAchse = de(dezimalen(t.schritt));
    const fmt = de(cfg.dezimalen != null ? cfg.dezimalen : 2);

    const svg = el("svg", { width: B, height: H, role: "img", "aria-label": cfg.titel });
    // Gitter + Achse rechts
    for (const v of t.werte) {
      el("line", { x1: m.l, x2: m.l + pw + bandBreite, y1: Y(v), y2: Y(v), class: "gitter" }, svg);
      text(svg, B - 4, Y(v) + 4, fmtAchse.format(v), "achse", "end");
    }
    // x-Beschriftung: Stunden (Tageschart), Monatsanfänge oder Jahre (lange Reihen)
    const jahre = !cfg.zeit && n > 1 && (Date.parse(cfg.x[n - 1]) - Date.parse(cfg.x[0])) / 864e5 > 800;
    let letztes = null, letztesX = -1e9;
    cfg.x.forEach((iso, i) => {
      let schluessel, label;
      if (cfg.zeit) {
        const d = new Date(iso);
        schluessel = d.getHours(); label = String(d.getHours()).padStart(2, "0") + ":00";
      } else {
        schluessel = jahre ? iso.slice(0, 4) : iso.slice(0, 7);
        label = jahre ? schluessel : MONATE[+iso.slice(5, 7) - 1];
      }
      if (schluessel !== letztes) {
        if (letztes !== null && X(i) - letztesX > (jahre ? 40 : B < 500 ? 56 : 44)) {
          text(svg, X(i), H - 8, label, "achse", "middle");
          letztesX = X(i);
        }
        letztes = schluessel;
      }
    });
    // Referenzlinie (z. B. 5-Jahres-Median)
    if (cfg.referenz) {
      el("line", { x1: m.l, x2: m.l + pw, y1: Y(cfg.referenz.wert), y2: Y(cfg.referenz.wert), class: "referenz" }, svg);
      text(svg, m.l + 2, Y(cfg.referenz.wert) - 6, cfg.referenz.name + " " + fmt.format(cfg.referenz.wert), "achse-label");
    }
    // Kursziel-Spanne rechts neben dem Verlauf
    if (cfg.band) {
      const bx = m.l + pw + 18;
      el("rect", { x: bx, y: Y(cfg.band.hoch), width: 12, height: Y(cfg.band.tief) - Y(cfg.band.hoch), rx: 3, class: "band" }, svg);
      el("line", { x1: bx - 4, x2: bx + 16, y1: Y(cfg.band.mittel), y2: Y(cfg.band.mittel), class: "band-mitte" }, svg);
      el("line", { x1: X(n - 1), x2: bx - 4, y1: Y(cfg.serien[0].werte[n - 1]), y2: Y(cfg.band.mittel), class: "verbinder" }, svg);
    }
    // Kerzen (erste Reihe), bei Platzmangel zusammengefasst
    if (kerzen) {
      const idx = cfg.x.map((_, i) => i);
      const k = KZ.buendeln(idx, cfg.ohlc.o, cfg.ohlc.h, cfg.ohlc.l, cfg.serien[0].werte, Math.max(10, Math.floor(pw / 4)));
      const Xk = (j) => X((k.von[j] + k.bis[j]) / 2);
      const p = KZ.pfade(k, Xk, Y, KZ.breiteAus(pw / Math.max(1, k.c.length)));
      el("path", { d: p.auf, class: "kerze auf" }, svg);
      el("path", { d: p.ab, class: "kerze ab" }, svg);
    }
    // Linien
    cfg.serien.slice().reverse().forEach((s, j) => {
      if (kerzen && j === cfg.serien.length - 1) return; // erste Reihe steckt in den Kerzen
      let d = "", offen = false;
      s.werte.forEach((v, i) => {
        if (v == null) { offen = false; return; }
        d += (offen ? "L" : "M") + X(i).toFixed(1) + "," + Y(v).toFixed(1);
        offen = true;
      });
      el("path", { d, class: "linie " + s.klasse }, svg);
    });
    const haupt = cfg.serien[0];
    el("circle", { cx: X(n - 1), cy: Y(haupt.werte[n - 1]), r: 4, class: "endpunkt " + haupt.klasse }, svg);

    // Interaktion: Fadenkreuz + Tooltip
    const kreuz = el("line", { y1: m.o, y2: m.o + ph, class: "fadenkreuz", visibility: "hidden" }, svg);
    const punkte = cfg.serien.map((s) => el("circle", { r: 4, class: "endpunkt " + s.klasse, visibility: "hidden" }, svg));
    const flaeche = el("rect", { x: m.l, y: 0, width: pw, height: H, fill: "transparent", tabindex: 0, class: "trefferflaeche" }, svg);
    box.replaceChildren(svg);
    if (cfg.ohlc && KZ) box.insertAdjacentHTML("beforeend", KZ.schalter("im-chart"));
    const tip = tooltip(box);
    let aktiv = n - 1;
    function zeige(i) {
      aktiv = Math.max(0, Math.min(n - 1, i));
      const x = X(aktiv);
      kreuz.setAttribute("x1", x); kreuz.setAttribute("x2", x); kreuz.setAttribute("visibility", "visible");
      const zeilen = [];
      cfg.serien.forEach((s, k) => {
        const v = s.werte[aktiv];
        if (v == null) { punkte[k].setAttribute("visibility", "hidden"); return; }
        punkte[k].setAttribute("cx", x); punkte[k].setAttribute("cy", Y(v)); punkte[k].setAttribute("visibility", "visible");
        if (kerzen && k === 0) {
          const o = cfg.ohlc.o[aktiv], h = cfg.ohlc.h[aktiv], l = cfg.ohlc.l[aktiv];
          if (o != null) {
            const farbe = v >= o ? "var(--plus)" : "var(--minus)";
            [["Eröffnung", o], ["Hoch", h], ["Tief", l], ["Schluss", v]].forEach(([nm, w]) => zeilen.push({ name: nm, wert: fmt.format(w), farbe, art: "flaeche" }));
            return;
          }
        }
        zeilen.push({ name: s.name, wert: fmt.format(v) + (cfg.einheit ? " " + cfg.einheit : ""), farbe: "var(--" + s.klasse + ")", art: "linie" });
      });
      const titel = cfg.zeit ? zeitText(cfg.x[aktiv]) : datumText(cfg.x[aktiv], jahre ? "monat" : "");
      tip.zeige(x, Y(haupt.werte[aktiv] ?? lo), titel, zeilen);
    }
    function aus() { kreuz.setAttribute("visibility", "hidden"); punkte.forEach((p) => p.setAttribute("visibility", "hidden")); tip.verstecke(); }
    flaeche.addEventListener("pointermove", (e) => {
      const r = svg.getBoundingClientRect();
      zeige(Math.round(((e.clientX - r.left - m.l) / pw) * (n - 1)));
    });
    flaeche.addEventListener("pointerleave", aus);
    flaeche.addEventListener("focus", () => zeige(aktiv));
    flaeche.addEventListener("blur", aus);
    flaeche.addEventListener("keydown", (e) => {
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        zeige(aktiv + (e.key === "ArrowRight" ? 1 : -1) * (e.shiftKey ? 20 : 1));
      }
    });
  }

  /* ------------------------------------------------------------ Säulendiagramm */
  function saeulen(box, cfg) {
    const B = box.clientWidth, H = box.clientHeight;
    const n = cfg.werte.length;
    const m = { o: 22, r: 52, u: 28, l: 4 };
    const pw = B - m.l - m.r, ph = H - m.o - m.u;
    const hi0 = Math.max(0, ...cfg.werte.filter((v) => v != null));
    const lo0 = Math.min(0, ...cfg.werte.filter((v) => v != null));
    const t = ticks(lo0, hi0 * 1.08 || 1, 4);
    const lo = Math.min(lo0, t.werte[0]), hi = Math.max(hi0 * 1.08, t.werte[t.werte.length - 1]);
    const Y = (v) => m.o + (1 - (v - lo) / (hi - lo)) * ph;
    const slot = pw / n, breite = Math.min(24, slot * 0.6);
    const svg = el("svg", { width: B, height: H, role: "img", "aria-label": cfg.titel });
    for (const v of t.werte) {
      el("line", { x1: m.l, x2: m.l + pw, y1: Y(v), y2: Y(v), class: v === 0 ? "basis" : "gitter" }, svg);
      text(svg, B - 4, Y(v) + 4, kurz(v), "achse", "end");
    }
    box.replaceChildren(svg);
    const tip = tooltip(box);
    cfg.werte.forEach((v, i) => {
      const cx = m.l + slot * (i + 0.5);
      text(svg, cx, H - 8, cfg.labels[i], "achse", "middle");
      if (v == null) return;
      const y0 = Y(0), y1 = Y(v), h = Math.abs(y0 - y1), r = Math.min(4, h);
      const x = cx - breite / 2, oben = Math.min(y0, y1);
      // oben abgerundet, an der Basis eckig
      const d = v >= 0
        ? `M${x},${y0} V${y1 + r} Q${x},${y1} ${x + r},${y1} H${x + breite - r} Q${x + breite},${y1} ${x + breite},${y1 + r} V${y0} Z`
        : `M${x},${y0} V${y1 - r} Q${x},${y1} ${x + r},${y1} H${x + breite - r} Q${x + breite},${y1} ${x + breite},${y1 - r} V${y0} Z`;
      const s = el("path", { d, class: "saeule" + (i === n - 1 ? " aktuell" : "") }, svg);
      if (i === n - 1) text(svg, cx, oben - 6, kurz(v), "wert", "middle");
      const ziel = el("rect", { x: m.l + slot * i, y: m.o, width: slot, height: ph, fill: "transparent", tabindex: 0 }, svg);
      const an = () => { s.classList.add("hover"); tip.zeige(cx, oben, cfg.tooltipTitel[i], [{ name: cfg.name, wert: kurz(v) + " " + (cfg.einheit || ""), farbe: "var(--reihe-1)", art: "flaeche" }]); };
      const ab = () => { s.classList.remove("hover"); tip.verstecke(); };
      ziel.addEventListener("pointerenter", an); ziel.addEventListener("pointerleave", ab);
      ziel.addEventListener("focus", an); ziel.addEventListener("blur", ab);
    });
  }

  /* ------------------------------------------------------------ Start */
  let daten = null;
  const dynamisch = {};  // von app.js gesetzte Diagramme (z. B. Tageschart aus Live-Daten)

  function zeichne(box) {
    if (!daten) {
      const quelle = document.getElementById("chart-daten");
      daten = quelle ? JSON.parse(quelle.textContent) : {};
    }
    const slug = box.closest("[data-slug]")?.dataset.slug;
    const name = box.dataset.chart;
    const cfg = dynamisch[slug + ":" + name] || (daten[slug] || {})[name];
    if (!cfg || box.clientWidth === 0) return;
    box.querySelectorAll(".tooltip").forEach((t) => t.remove());
    (cfg.art === "saeulen" ? saeulen : linien)(box, cfg);
  }
  // Zeichnet alle sichtbaren Diagramme innerhalb von `wurzel`
  function zeichneIn(wurzel) {
    (wurzel || document).querySelectorAll("[data-chart]").forEach((box) => {
      if (box.offsetParent !== null) zeichne(box);
    });
  }
  function setzeDynamisch(slug, name, cfg) {
    dynamisch[slug + ":" + name] = cfg;
    document.querySelectorAll(`[data-slug="${slug}"] [data-chart="${name}"]`).forEach((box) => {
      if (box.offsetParent !== null) zeichne(box);
    });
  }
  document.addEventListener("wb:chartart", () => zeichneIn(document));
  let timer;
  window.addEventListener("resize", () => { clearTimeout(timer); timer = setTimeout(() => zeichneIn(document), 120); });
  window.WB = { zeichneIn, setzeDynamisch };
})();
