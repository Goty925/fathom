/* Fathom: gemeinsame Helfer für alle Skripte der Seite (wird vor ihnen geladen).
 * Die Rechenkerne (*-kern.js, kerzen.js) bleiben davon unabhängig, damit sie auch unter Node laufen.
 */
(function () {
  "use strict";
  const formate = {};
  const H = {
    $: (s, r = document) => r.querySelector(s),
    $$: (s, r = document) => [...r.querySelectorAll(s)],
    // Text sicher in HTML einsetzen
    esc: (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])),
    // localStorage, das auch in privaten Fenstern oder bei gesperrtem Speicher nicht abbricht; null löscht
    lies: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } },
    schreib: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) { /* privat */ } },
    // Zahlenformat mit d Nachkommastellen (zwischengespeichert)
    nf: (d) => formate[d] || (formate[d] = new Intl.NumberFormat("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d })),
    minus: (s) => s.replace(/-/g, "−"),
    KLASSEN: [["aktie", "Aktien"], ["etf", "ETFs"], ["forex", "Forex"], ["rohstoff", "Rohstoffe"], ["index", "Indizes"]],
  };
  H.zahl = (x, d = 2) => (x == null || !isFinite(x) ? "–" : H.minus(H.nf(d).format(x)));
  // Prozent aus einem Anteil (0,05 → „+5,0 %“), vz = mit Pluszeichen
  H.pct = (x, d = 1, vz = true) => (x == null || !isFinite(x) ? "–" : H.minus((vz && x > 0 ? "+" : "") + H.nf(d).format(x * 100) + " %"));
  H.zwei = (x) => String(x).padStart(2, "0");
  // Nachkommastellen für angezeigte Kurse eines Backtest-Werts: Aktien und ETFs zwei, sonst wie notiert (höchstens max)
  H.kursStellen = (w, max = 4) => {
    const typ = w && (w.typ || w.t);  // entpackt (backtest-kern.js) heißt es typ, in der JSON-Datei t
    return Math.min(typ === "aktie" || typ === "etf" ? 2 : max, w && w.dez != null ? w.dez : 2);
  };
  // Dunkles Design aktiv? (Knopf per data-theme, sonst die Systemeinstellung)
  H.istDunkel = () => (document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")) === "dark";
  // Finnhub: Schlüssel und Adressen aus diesem Browser. Eigene Adressen gibt es nur für Tests auf diesem Rechner,
  // sonst ginge der Schlüssel an einen fremden Server.
  const lokal = (u, art) => (new RegExp(`^${art}://(localhost|127\\.0\\.0\\.1)(:\\d+)?(/|$)`).test(u || "") ? u : null);
  H.finnhub = {
    schluessel: () => H.lies("wochenbericht.finnhub"),
    rest: () => lokal(H.lies("wochenbericht.finnhub.rest"), "https?") || "https://finnhub.io/api/v1",
    ws: () => lokal(H.lies("wochenbericht.finnhub.ws"), "wss?") || "wss://ws.finnhub.io",
  };
  // Der Live-Server (python live.py) antwortet nur auf diesem Rechner. Anderswo (GitHub Pages) gar nicht erst fragen,
  // das spart Anfragen und Fehlermeldungen in der Konsole. Die statische Vorschau simuliert ihn.
  H.serverMoeglich = () => /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) || !!window.WBVorschau;
  // Fenster (Work, Backtest, Screener, Konto): immer nur eines offen. Öffnet sich eines, schließen die anderen
  // leise (ohne den Fokus auf ihr altes Widget zurückzulegen). Rückgabe: melden(offen) für Öffnen und Schließen.
  H.fenster = (name, leiseZu) => {
    document.addEventListener("wb:fenster", (e) => { if (e.detail.offen && e.detail.name !== name) leiseZu(); });
    return (offen) => document.dispatchEvent(new CustomEvent("wb:fenster", { detail: { name, offen } }));
  };
  window.WBH = H;
})();
