/* Fathom: Konto als lokales Profil.
 *
 * Kein Server, kein Login: Name, Farbe und alle Einstellungen liegen nur im localStorage dieses Browsers.
 * Das Fenster zeigt, was hier gespeichert ist (eigene Signale, Portfolio, Backtest, Chart-Taktiken, Live-Schlüssel),
 * stellt Hell/Dunkel ein und sichert alles als JSON-Datei, damit man auf ein anderes Gerät umziehen kann.
 * Der Finnhub-Schlüssel kommt nur auf ausdrücklichen Wunsch mit in die Sicherung.
 */
(function () {
  "use strict";
  const { $, $$, esc, lies, schreib, nf, KLASSEN } = window.WBH;
  const json = (k) => { try { return JSON.parse(lies(k) || "null"); } catch (e) { return null; } };

  const PROFIL = "fathom.konto";
  const SCHLUESSEL = "wochenbericht.finnhub";
  const GEHOERT_DAZU = (k) => k.startsWith("fathom.") || k.startsWith(SCHLUESSEL);
  /* Was eine Sicherung zurückschreiben darf: nur bekannte Einträge mit plausiblem Inhalt. Nicht dabei sind die
     Test-Adressen für Finnhub (*.rest, *.ws: sonst ginge der Schlüssel an einen fremden Server) und die Zustimmung
     zu TradingView (fremdes Skript, wird auf jedem Gerät selbst erteilt). */
  const JSON_OBJ = /^fathom\.(konto|auswahl|regeln|depot|backtest|backtest\.letzt|work|taktik|szenarien|alarme|journal|trades|setups)$/;
  const TEXT = { "fathom.design": /^(hell|dunkel)$/, "fathom.kachel": /^[a-z]{2,12}$/, "fathom.heatmap.mass": /^[a-z0-9]{1,12}$/,
    "fathom.aktien.ansicht": /^[a-z]{2,12}$/, "fathom.backtest.modus": /^(fakten|chart|setups)$/, "fathom.chartart": /^(linie|kerzen)$/, "fathom.journal.ansicht": /^kalender$/, [SCHLUESSEL]: /^[A-Za-z0-9_-]{8,80}$/ };
  function zulaessig(k, v) {
    if (typeof k !== "string" || typeof v !== "string" || v.length > 2 * 1048576) return false;
    if (JSON_OBJ.test(k)) { try { const o = JSON.parse(v); return !!o && typeof o === "object"; } catch (e) { return false; } }
    if (/^fathom\.ansicht\.[a-z]{2,12}$/.test(k)) return /^[a-z]{2,12}$/.test(v);
    return !!TEXT[k] && TEXT[k].test(v);
  }
  const FARBEN = [["blau", "Blau"], ["gruen", "Grün"], ["gelb", "Gelb"], ["rot", "Rot"], ["lila", "Lila"], ["tinte", "Tinte"]];

  /* ---------------------------------------------------------------- Profil */
  function profil() {
    let p = json(PROFIL);
    if (!p || typeof p !== "object" || Array.isArray(p)) p = {};
    p = { name: typeof p.name === "string" ? p.name.slice(0, 40) : "", farbe: p.farbe, seit: /^\d{4}-\d{2}-\d{2}$/.test(p.seit || "") ? p.seit : null };
    if (!p.seit) { p.seit = new Date().toISOString().slice(0, 10); schreib(PROFIL, JSON.stringify(p)); }
    if (!FARBEN.some(([f]) => f === p.farbe)) p.farbe = "blau";
    return p;
  }
  function profilSetzen(teil) {
    const p = Object.assign(profil(), teil);
    p.name = String(p.name || "").trim().slice(0, 40);
    schreib(PROFIL, JSON.stringify(p));
    melden();
  }
  function kuerzel(name) {
    const w = String(name || "").trim().split(/\s+/).filter(Boolean);
    return w.length ? (w[0][0] + (w.length > 1 ? w[w.length - 1][0] : "")).toUpperCase() : "";
  }
  const vorname = (name) => String(name || "").trim().split(/\s+/)[0] || "";
  function melden() { document.dispatchEvent(new CustomEvent("wb:konto", { detail: profil() })); }

  /* ---------------------------------------------------------------- Was liegt im Browser */
  function bestand() {
    let bytes = 0, schluessel = 0;
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (GEHOERT_DAZU(k)) { schluessel++; bytes += (k.length + (localStorage.getItem(k) || "").length) * 2; }
      }
    } catch (e) { /* privat */ }
    const R = window.WBRegeln;
    const eigene = R && R.istEigen ? KLASSEN.filter(([k]) => { try { return R.istEigen(k); } catch (e) { return false; } }).map(([, n]) => n) : [];
    const depot = json("fathom.depot");
    const bt = json("fathom.backtest.letzt");
    const basis = $("#live-basis");
    let werte = 0;
    try { werte = basis ? Object.keys(JSON.parse(basis.textContent).werte || {}).length : 0; } catch (e) { werte = 0; }
    return {
      bytes, schluessel, eigene, werte,
      buchungen: depot && Array.isArray(depot.transaktionen) ? depot.transaktionen.length : 0,
      backtest: bt && bt.start ? bt.ende / bt.start - 1 : null,
      live: !!lies(SCHLUESSEL),
    };
  }
  const groesse = (b) => (b < 1024 ? `${b} B` : b < 1048576 ? `${nf(0).format(b / 1024)} KB` : `${nf(1).format(b / 1048576)} MB`);
  const pct = (x) => window.WBH.pct(x, 1);

  /* ---------------------------------------------------------------- Fenster */
  let huelle = null, ausloeser = null;
  function bauen() {
    huelle = document.createElement("div");
    huelle.className = "konto-huelle"; huelle.hidden = true;
    huelle.innerHTML = `<div class="konto-schleier" data-konto-zu></div>
      <section class="konto" role="dialog" aria-modal="true" aria-labelledby="konto-titel" tabindex="-1">
        <header class="konto-kopf">
          <div><p class="konto-zeile">Lokal · nur dieser Browser</p><h2 id="konto-titel">Konto</h2></div>
          <button type="button" class="knopf schliessen-knopf" data-konto-zu><svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>Schließen</button>
        </header>
        <div class="konto-inhalt"></div>
      </section>`;
    document.body.appendChild(huelle);
    huelle.addEventListener("click", klick);
    huelle.addEventListener("input", (e) => { if (e.target.id === "konto-name") { profilSetzen({ name: e.target.value }); kopfZeichnen(); } });
    huelle.addEventListener("change", (e) => { if (e.target.id === "konto-datei") einlesen(e.target.files && e.target.files[0]); });
  }

  function kopfZeichnen() {
    const p = profil(), k = kuerzel(p.name);
    const a = $(".konto-avatar", huelle);
    if (!a) return;
    a.className = `konto-avatar f-${p.farbe}`;
    a.innerHTML = k ? esc(k) : `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="9" r="3.6"/><path d="M5 19.8c1.2-3.5 4-5.2 7-5.2s5.8 1.7 7 5.2"/></svg>`;
    $(".konto-gruss", huelle).textContent = p.name ? `Hallo, ${vorname(p.name)}` : "Hallo";
  }

  function zeichnen() {
    const p = profil(), b = bestand();
    const seit = new Date(p.seit + "T12:00:00").toLocaleDateString("de-DE", { day: "numeric", month: "long", year: "numeric" });
    const design = lies("fathom.design") === "hell" ? "hell" : lies("fathom.design") === "dunkel" ? "dunkel" : "system";
    const kachel = (wert, name, unter, klasse = "") => `<div class="konto-zahl"><b class="${klasse}">${wert}</b><span>${name}</span>${unter ? `<small>${unter}</small>` : ""}</div>`;
    $(".konto-inhalt", huelle).innerHTML = `
      <section class="konto-karte konto-profil">
        <span class="konto-avatar"></span>
        <div class="konto-wer">
          <p class="konto-gruss">Hallo</p>
          <label class="konto-feld"><span>Dein Name</span>
            <input id="konto-name" type="text" autocomplete="given-name" maxlength="40" spellcheck="false" placeholder="Wie sollen wir dich nennen?" value="${esc(p.name || "")}"></label>
          <div class="konto-farben" role="radiogroup" aria-label="Farbe">${FARBEN.map(([f, n]) => `<button type="button" role="radio" class="f-${f}" data-farbe="${f}" aria-checked="${p.farbe === f}" aria-label="${n}" title="${n}"></button>`).join("")}</div>
          <p class="konto-seit">Dabei seit ${esc(seit)}</p>
        </div>
      </section>
      <section class="konto-karte">
        <h3>Deine Daten</h3>
        <div class="konto-zahlen">
          ${kachel(b.werte || "–", "Werte", "auf der Watchlist")}
          ${kachel(b.eigene.length, "eigene Signale", b.eigene.length ? esc(b.eigene.join(", ")) : "Standardauswahl")}
          ${kachel(b.buchungen || "–", "Portfolio", b.buchungen ? "Buchungen importiert" : "noch leer")}
          ${kachel(pct(b.backtest), "letzter Backtest", b.backtest == null ? "noch kein Lauf" : "Ergebnis", b.backtest == null ? "" : b.backtest >= 0 ? "plus" : "minus")}
          ${kachel(b.live ? "an" : "aus", "Finnhub live", b.live ? "Schlüssel gespeichert" : "kein Schlüssel")}
          ${kachel(groesse(b.bytes), "gespeichert", `${b.schluessel} ${b.schluessel === 1 ? "Eintrag" : "Einträge"}`)}
        </div>
      </section>
      <section class="konto-karte">
        <h3>Einstellungen</h3>
        <div class="konto-reihe"><span>Design</span>
          <div class="konto-wahl" role="radiogroup" aria-label="Design">${[["system", "System"], ["hell", "Hell"], ["dunkel", "Dunkel"]].map(([w, n]) => `<button type="button" role="radio" data-design="${w}" aria-checked="${design === w}">${n}</button>`).join("")}</div></div>
        <div class="konto-reihe"><span>Live-Kurse</span><button type="button" class="knopf" data-konto-live>Quellen einstellen</button></div>
        <div class="konto-reihe"><span>Screener</span><button type="button" class="knopf" data-konto-kriterien>Screener anpassen</button></div>
      </section>
      <section class="konto-karte">
        <h3>Sichern und umziehen</h3>
        <p class="konto-text">Lade alles als Datei herunter und spiel sie auf einem anderen Gerät wieder ein: Profil, Screener, Portfolio, Backtest mit Chart-Taktiken, Work-Einstellungen, Szenarien, Alarme, Journal und Trades.</p>
        <label class="konto-haken"><input type="checkbox" id="konto-mit-schluessel"> Finnhub-Schlüssel mitnehmen</label>
        <div class="konto-knoepfe">
          <button type="button" class="knopf primaer" data-konto-sichern><svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19.5h14"/></svg>Sichern</button>
          <label class="knopf konto-laden"><svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M12 15.5v-11m0 0L7.5 9M12 4.5 16.5 9M5 19.5h14"/></svg>Einspielen<input type="file" id="konto-datei" accept="application/json,.json" class="unsichtbar"></label>
          <button type="button" class="knopf konto-weg" data-konto-loeschen>Alles zurücksetzen</button>
        </div>
        <p class="konto-meldung" role="status" aria-live="polite"></p>
      </section>`;
    kopfZeichnen();
  }

  function meldung(text, art = "") { const m = $(".konto-meldung", huelle); if (m) { m.textContent = text; m.className = "konto-meldung " + art; } }

  /* ---------------------------------------------------------------- Aktionen */
  let loeschenScharf = 0;
  function klick(e) {
    const t = e.target;
    if (t.closest("[data-konto-zu]")) { zu(); return; }
    const farbe = t.closest("[data-farbe]");
    if (farbe) { profilSetzen({ farbe: farbe.dataset.farbe }); $$("[data-farbe]", huelle).forEach((b) => b.setAttribute("aria-checked", b === farbe)); kopfZeichnen(); return; }
    const d = t.closest("[data-design]");
    if (d) { design(d.dataset.design); $$("[data-design]", huelle).forEach((b) => b.setAttribute("aria-checked", b === d)); return; }
    if (t.closest("[data-konto-live]")) { zu(); const k = $("#live-knopf"); if (k) k.click(); else meldung("Live-Kurse gibt es auf der Startseite."); return; }
    if (t.closest("[data-konto-kriterien]")) { zu(); const k = $('[data-dock="kriterien"]'); if (k) k.click(); return; }
    if (t.closest("[data-konto-sichern]")) { sichern(); return; }
    const weg = t.closest("[data-konto-loeschen]");
    if (weg) {
      if (Date.now() - loeschenScharf > 4000) {
        loeschenScharf = Date.now(); weg.textContent = "Wirklich alles löschen?"; weg.classList.add("scharf");
        setTimeout(() => { if (Date.now() - loeschenScharf >= 3900) { weg.textContent = "Alles zurücksetzen"; weg.classList.remove("scharf"); } }, 4000);
        return;
      }
      alleSchluessel().forEach((k) => schreib(k, null));
      meldung("Gelöscht. Die Seite lädt neu …");
      setTimeout(() => location.reload(), 700);
    }
  }
  function alleSchluessel() {
    const l = [];
    try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (GEHOERT_DAZU(k)) l.push(k); } } catch (e) { /* privat */ }
    return l;
  }

  function design(wahl) {
    const knopf = $("#design-knopf");
    const istDunkel = window.WBH.istDunkel;
    if (wahl === "system") {
      const vorher = istDunkel();
      schreib("fathom.design", null);
      delete document.documentElement.dataset.theme;
      // Diagramme neu zeichnen lassen, wenn sich das Aussehen dadurch ändert
      if (vorher !== istDunkel() && knopf) { knopf.click(); knopf.click(); schreib("fathom.design", null); delete document.documentElement.dataset.theme; }
      return;
    }
    if ((wahl === "dunkel") !== istDunkel() && knopf) knopf.click();
    else { document.documentElement.dataset.theme = wahl === "dunkel" ? "dark" : "light"; }
    schreib("fathom.design", wahl);
  }

  function sichern() {
    const mit = $("#konto-mit-schluessel", huelle).checked;
    const daten = {};
    alleSchluessel().filter((k) => (mit || k !== SCHLUESSEL) && zulaessig(k, lies(k))).sort().forEach((k) => { daten[k] = lies(k); });
    const datei = { app: "fathom", version: 1, exportiert: new Date().toISOString(), daten };
    const blob = new Blob([JSON.stringify(datei, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `fathom-konto-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    const n = Object.keys(daten).length;
    meldung(`${n} ${n === 1 ? "Eintrag" : "Einträge"} gesichert${mit ? ", mit Schlüssel" : ""}.`, "gut");
  }

  function einlesen(f) {
    if (!f) return;
    if (f.size > 5 * 1048576) { meldung("Die Datei ist zu groß für eine Fathom-Sicherung.", "fehler"); return; }
    f.text().then((text) => {
      let d; try { d = JSON.parse(text); } catch (e) { d = null; }
      if (!d || d.app !== "fathom" || typeof d.daten !== "object" || !d.daten) { meldung("Das ist keine Fathom-Sicherung.", "fehler"); return; }
      const alle = Object.entries(d.daten);
      const eintraege = alle.filter(([k, v]) => zulaessig(k, v));
      if (!eintraege.length) { meldung("In der Datei steht nichts, was Fathom kennt.", "fehler"); return; }
      const ausgelassen = alle.length - eintraege.length;
      eintraege.forEach(([k, v]) => schreib(k, v));
      meldung(`${eintraege.length} ${eintraege.length === 1 ? "Eintrag" : "Einträge"} eingespielt${ausgelassen ? `, ${ausgelassen} unbekannte oder unsichere übersprungen` : ""}. Die Seite lädt neu …`, "gut");
      setTimeout(() => location.reload(), 900);
    }).catch(() => meldung("Die Datei ließ sich nicht lesen.", "fehler"));
  }

  /* ---------------------------------------------------------------- Öffnen und Schließen */
  const fensterMelden = window.WBH.fenster("konto", () => { ausloeser = null; zu(); });
  function oeffnen() {
    if (!huelle) bauen();
    if (!offen()) fensterMelden(true);
    ausloeser = document.activeElement;
    zeichnen();
    huelle.hidden = false;
    document.body.classList.add("konto-offen", "fenster-offen");
    $(".konto", huelle).focus({ preventScroll: true });
    melden();
  }
  function zu() {
    if (!huelle || huelle.hidden) return;
    huelle.hidden = true;
    document.body.classList.remove("konto-offen");
    const kf = $(".kf-huelle");
    if (!kf || kf.hidden) document.body.classList.remove("fenster-offen");
    if (ausloeser && document.contains(ausloeser)) ausloeser.focus({ preventScroll: true });
    melden();
    fensterMelden(false);
  }
  const offen = () => !!huelle && !huelle.hidden;

  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && offen()) { e.preventDefault(); e.stopImmediatePropagation(); zu(); } }, true);
  document.addEventListener("click", (e) => {
    if (e.target.closest('[data-dock="konto"], [data-konto-oeffnen]')) { e.preventDefault(); offen() ? zu() : oeffnen(); return; }
    if (offen() && e.target.closest(".dock [data-dock]")) { ausloeser = null; zu(); } // anderes Widget: Konto macht Platz
  });
  document.addEventListener("DOMContentLoaded", melden);

  window.WBKonto = { oeffnen, zu, offen, profil, kuerzel, vorname, bestand, groesse };
})();
