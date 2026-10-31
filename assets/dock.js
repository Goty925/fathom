/* Fathom: Taskleiste mit Widgets links (auch auf dem Handy).
 *
 * Jedes Widget führt zu einer Unterseite und zeigt dazu etwas Lebendiges:
 *   Work       Countdown bis zum nächsten wichtigen Wirtschaftstermin, offene Börsen
 *   Backtest   Ergebnis des letzten eigenen Laufs mit Kapitalkurve (nur in diesem Browser gespeichert)
 *   Screener   Treffer über alle Klassen, mit den eigenen Signalen und Live-Kursen gerechnet
 *   Home       zurück zur Startseite: schließt alle Fenster und springt nach oben
 *   Woche      neu erfüllte und verlorene Signale seit dem letzten Bericht (kommt fertig aus dem Bericht)
 *   Termine, Alarme, Depot, Journal   eigene Fenster mit Live-Wert (assets/seiten.js)
 *   Konto      lokales Profil mit Name, Farbe, Einstellungen und Sicherung (assets/konto.js)
 * Beim Zeigen klappt neben dem Widget eine Karte mit mehr Details auf.
 */
(function () {
  "use strict";
  const dock = document.getElementById("dock");
  if (!dock) return;
  const W = window.WBWorkKern;
  const { $, $$, esc, lies, nf, zwei } = window.WBH;
  const pct = (x, d = 0) => (x == null || !isFinite(x) ? "–" : ((x > 0 ? "+" : "") + nf(d).format(x * 100) + " %").replace("-", "−"));
  const euro = (x) => nf(0).format(x) + " €";
  const fTermin = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", weekday: "short", hour: "2-digit", minute: "2-digit" });
  const archiv = dock.dataset.dockArchiv === "1";
  const wert = (id) => $(`[data-dock-wert="${id}"]`, dock);
  const mehr = (id) => $(`[data-dock-mehr="${id}"]`, dock);
  const widget = (id) => $(`[data-dock="${id}"]`, dock);

  // Kurzer Countdown, der in ein schmales Widget passt
  function kurz(ms) {
    const s = Math.max(0, Math.floor(ms / 1000)), t = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
    if (t) return `${t} T ${h} h`;
    if (h) return `${h}:${zwei(m)}:${zwei(s % 60)}`;
    return `${zwei(m)}:${zwei(s % 60)}`;
  }

  /* ---------------------------------------------------------------- Work: Kalender und Börsen */
  let termine = [];
  function kalenderLaden() {
    if (archiv || !W) return;
    const inline = $("#kalender-daten");
    const roh = inline ? Promise.resolve(JSON.parse(inline.textContent))
      : fetch("daten/kalender.json", { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null));
    roh.then((k) => { if (k) termine = W.demoVerschieben(k, Date.now()).termine || []; work(); }).catch(() => {});
  }
  function work() {
    if (!W) return;
    const jetzt = Date.now();
    const n = W.naechster(termine, jetzt / 6e4, 2);
    const w = widget("work");
    const ms = n ? n.t * 6e4 - jetzt : null;
    wert("work").textContent = n ? kurz(ms) : "–";
    w.classList.toggle("bald", ms != null && ms < 15 * 60e3);
    const boersen = [...W.BOERSEN.filter((b) => ["ny", "fra", "ldn", "tyo"].includes(b.id)), W.FOREX].map((b) => ({ b, s: W.boersenStatus(b, jetzt) }));
    $(".dock-led", w).classList.toggle("an", boersen.some((x) => x.s.offen && x.b.id !== "fx"));
    if (!w.parentElement.matches(":hover, :focus-within")) return; // Karte nur füllen, wenn sie zu sehen ist
    mehr("work").innerHTML = (n ? `<span class="dock-k-termin"><span><span class="dock-g g${n.wichtig}"><i></i><i></i><i></i></span> ${esc(n.land)} · ${esc(fTermin.format(n.t * 6e4))}</span>
        <b>${esc(n.titel)}</b><span class="dock-k-uhr">${esc(W.dauer(ms))}</span></span>` : archiv ? "" : `<span class="dock-k-zeile">Kein Kalender geladen.</span>`)
      + `<span class="dock-k-boersen">${boersen.map(({ b, s }) => `<span class="${s.offen ? "offen" : s.pause ? "pause" : ""}"><i></i>${esc(b.name)}<em>${s.offen ? "zu in" : s.pause ? "Pause," : "auf in"} ${esc(W.dauer(s.wechselMs).replace(/:\d\d$/, ""))}</em></span>`).join("")}</span>`;
  }

  /* ---------------------------------------------------------------- Backtest: letzter Lauf */
  function backtest() {
    let l = null;
    try { l = JSON.parse(lies("fathom.backtest.letzt")); } catch (e) { l = null; }
    const w = widget("backtest");
    if (!w) return;
    $(".dock-led", w).classList.toggle("an", !!l);
    if (!l || !l.start) {
      wert("backtest").textContent = "neu";
      mehr("backtest").innerHTML = `<span class="dock-k-zeile">Noch kein eigener Lauf. Im Fenster sind zwei Beispiele eingebaut: Quartalszahlen sowie CPI und Forex.</span>`;
      return;
    }
    const r = Number(l.ende) / Number(l.start) - 1;
    l.kurve = Array.isArray(l.kurve) ? l.kurve.map(Number).filter(isFinite).slice(0, 400) : [];
    const b = wert("backtest");
    b.textContent = pct(r);
    b.className = "dock-wert " + (r > 0.0005 ? "plus" : r < -0.0005 ? "minus" : "");
    const k = l.kurve || [], lo = Math.min(...k), hi = Math.max(...k), B = 196, H = 44;
    const pfad = k.map((v, i) => `${i ? "L" : "M"}${((i / Math.max(1, k.length - 1)) * B).toFixed(1)} ${(H - 2 - ((v - lo) / (hi - lo || 1)) * (H - 4)).toFixed(1)}`).join("");
    const datum = (t) => new Date(t * 864e5).toLocaleDateString("de-DE", { month: "2-digit", year: "2-digit" });
    mehr("backtest").innerHTML = `<span class="dock-k-zeile">${esc(l.titel || "")}${l.von != null ? ` · ${datum(l.von)} bis ${datum(l.bis)}` : ""}</span>
      ${k.length > 1 ? `<svg class="dock-k-kurve ${r >= 0 ? "plus" : "minus"}" viewBox="0 0 ${B} ${H}" preserveAspectRatio="none" aria-hidden="true"><path d="${pfad}L${B} ${H}L0 ${H}Z" class="flaeche"/><path d="${pfad}" class="linie"/></svg>` : ""}
      <span class="dock-k-zeile">Aus ${euro(l.start)} wurden <b class="${r >= 0 ? "plus" : "minus"}">${euro(l.ende)}</b></span>
      <span class="dock-k-zeile">${nf(0).format(Number(l.n) || 0)} Trades, ${pct(Number(l.quote)).replace("+", "")} Gewinner</span>`;
  }

  /* ---------------------------------------------------------------- Screener: Treffer je Klasse */
  const basisEl = $("#live-basis");
  const WERTE = basisEl ? JSON.parse(basisEl.textContent).werte || {} : {};
  const KLASSEN = [["aktie", "Aktien"], ["forex", "Forex"], ["rohstoff", "Rohstoffe"], ["index", "Indizes"]];
  function kriterien() {
    const w = widget("kriterien");
    if (!w || !window.WBRegeln || !window.WBRegeln.status) return;
    const zeilen = KLASSEN.map(([typ, name]) => {
      const l = Object.keys(WERTE).filter((s) => WERTE[s].typ === typ);
      const t = l.filter((s) => { const r = window.WBRegeln.status(s); return r && r.treffer; }).length;
      const a = window.WBRegeln.auswahl ? window.WBRegeln.auswahl(typ) : null;
      return { typ, name, n: l.length, t, a };
    }).filter((z) => z.n);
    const summe = zeilen.reduce((s, z) => s + z.t, 0);
    wert("kriterien").textContent = String(summe);
    $(".dock-led", w).classList.toggle("an", summe > 0);
    // Screener für die gerade gezeigte Kachel öffnen
    const kachel = $('[data-kachel][aria-pressed="true"]');
    const typ = kachel && KLASSEN.some(([k]) => k === kachel.dataset.kachel) ? kachel.dataset.kachel : "aktie";
    w.dataset.kriterienOeffnen = typ;
    mehr("kriterien").innerHTML = `<span class="dock-k-klassen">${zeilen.map((z) => `<span${z.typ === typ ? ' class="jetzt"' : ""}>${esc(z.name)}
      <i style="--a:${z.n ? (z.t / z.n).toFixed(3) : 0}"></i><b>${z.t}</b><em>von ${z.n}</em></span>`).join("")}</span>
      <span class="dock-k-zeile">Klick öffnet den Screener für ${esc((KLASSEN.find(([k]) => k === typ) || [])[1] || "Aktien")}.</span>`;
  }

  /* ---------------------------------------------------------------- Home: alles schließen, nach oben */
  function heim() {
    if (location.hash) { history.pushState(null, "", location.pathname + location.search); window.dispatchEvent(new HashChangeEvent("hashchange")); }
    const kf = $(".kf-huelle");
    if (kf && !kf.hidden) document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    if (window.WBKonto) window.WBKonto.zu();
    if (window.WBSeiten) window.WBSeiten.zu();
    const suche = $("#suche"); if (suche && !suche.hidden) { const z = $("[data-suche-zu]", suche); if (z) z.click(); }
    const ruhig = matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: ruhig ? "auto" : "smooth" });
    setTimeout(aktiv, 0);
  }
  if (!archiv) dock.addEventListener("click", (e) => { if (e.target.closest('[data-dock="home"]')) { e.preventDefault(); heim(); } });
  function home() {
    const m = mehr("home"); if (!m) return;
    const offen = [["wm-offen", "Work-Modus"], ["bt-offen", "Backtest"], ["panel-offen", "Analyse"], ["konto-offen", "Konto"]].filter(([k]) => document.body.classList.contains(k)).map(([, n]) => n);
    const seite = document.body.dataset.seite; if (seite) offen.push(seite[0].toUpperCase() + seite.slice(1));
    const kf = $(".kf-huelle"); if (kf && !kf.hidden) offen.push("Screener");
    m.innerHTML = offen.length ? `<span class="dock-k-zeile">Offen: <b>${esc(offen.join(", "))}</b></span>` : "";
  }

  /* ---------------------------------------------------------------- Konto: Name und Farbe */
  function konto(p) {
    const K = window.WBKonto; if (!K) return;
    p = p || K.profil();
    const w = widget("konto"); if (!w) return;
    const k = K.kuerzel(p.name), av = $("[data-konto-avatar]", w);
    // Nur ändern, was sich ändert: ein neu gesetztes Symbol unter dem Zeiger löst sonst immer wieder pointerover aus
    // und schluckt den Klick
    const klasse = `dock-symbol dock-avatar f-${p.farbe}${k ? " mit-name" : ""}`;
    if (av.className !== klasse) av.className = klasse;
    if (k ? av.textContent !== k || av.querySelector("svg") : !av.querySelector("svg")) {
      if (k) av.textContent = k;
      else av.innerHTML = `<svg class="dock-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="9" r="3.6"/><path d="M5 19.8c1.2-3.5 4-5.2 7-5.2s5.8 1.7 7 5.2"/></svg>`;
    }
    const vn = K.vorname(p.name) || "Profil";
    if (wert("konto").textContent !== vn) wert("konto").textContent = vn;
    const b = K.bestand();
    const html = `<span class="dock-k-zeile">${p.name ? `Angemeldet als <b>${esc(p.name)}</b>` : "Noch ohne Namen."}</span>
      <span class="dock-k-zeile">${b.eigene.length} eigene Signale · ${b.buchungen ? `${b.buchungen} Buchungen` : "Portfolio leer"} · ${esc(K.groesse(b.bytes))}</span>`;
    if (mehr("konto").innerHTML !== html) mehr("konto").innerHTML = html;
  }
  document.addEventListener("wb:konto", (e) => { konto(e.detail); aktiv(); });

  /* ---------------------------------------------------------------- Aktiv: welche Unterseite ist offen */
  function aktiv() {
    const b = document.body.classList;
    const kf = $(".kf-huelle");
    const seite = document.body.dataset.seite;
    const offen = { work: b.contains("wm-offen"), backtest: b.contains("bt-offen"), kriterien: !!kf && !kf.hidden, protokoll: location.hash === "#protokoll", konto: b.contains("konto-offen"),
      termine: seite === "termine", alarme: seite === "alarme", depot: seite === "depot", journal: seite === "journal" };
    offen.home = !archiv && !Object.values(offen).some(Boolean) && !b.contains("panel-offen");
    $$(".dock-w", dock).forEach((w) => {
      const an = !!offen[w.dataset.dock];
      w.classList.toggle("aktiv", an);
      if (an) w.setAttribute("aria-current", "page"); else w.removeAttribute("aria-current");
    });
  }

  dock.addEventListener("pointerover", (e) => {
    const li = e.target.closest("li"); if (!li) return;
    if (li.querySelector('[data-dock="work"]')) work();
    else if (li.querySelector('[data-dock="home"]')) home();
    else if (li.querySelector('[data-dock="konto"]')) konto();
  });
  dock.addEventListener("focusin", (e) => { if (e.target.closest('[data-dock="work"]')) work(); });

  /* ---------------------------------------------------------------- Takt */
  let kursTakt = 0;
  document.addEventListener("wb:kurse", () => { if (Date.now() - kursTakt > 3000) { kursTakt = Date.now(); kriterien(); } });
  document.addEventListener("wb:backtest", backtest);
  window.addEventListener("storage", (e) => { if (e.key === "fathom.backtest.letzt") backtest(); });
  window.addEventListener("hashchange", () => setTimeout(aktiv, 0));
  // sofort, nicht erst beim nächsten Sekundentakt; ein zweites Mal, wenn das neue Fenster fertig geöffnet ist
  document.addEventListener("wb:fenster", () => { aktiv(); setTimeout(aktiv, 0); });
  document.addEventListener("wb:seite", aktiv);   // Wechsel zwischen Termine, Alarme, Depot und Journal
  document.addEventListener("click", (e) => { if (e.target.closest("[data-kachel]")) setTimeout(kriterien, 0); });
  document.addEventListener("DOMContentLoaded", () => {
    kalenderLaden(); backtest(); konto(); aktiv();
    setTimeout(kriterien, 200); // nach regeln.js
    let n = 0;
    setInterval(() => { if (!document.hidden) { work(); aktiv(); if (++n % 15 === 0) kriterien(); } }, 1000);
  });
})();
