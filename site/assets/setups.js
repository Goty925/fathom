/* Fathom: Setup Lab im Backtest-Fenster (Reiter „Setups“ und „Als Setup speichern“ im Report).
 *
 * Ein Setup friert eine getestete Strategie mit Zeitstempel ein: Regeln, These, Kennzahlen, Datenstand. Das geht für
 * Fakten-Strategien (Reiter „Fakten“) und für Chart-Taktiken (Zeichnungen, Indikatoren und Text). Jede
 * Regeländerung wird eine neue Version. Die Bewährungsprobe rechnet eine Version auf den heutigen Daten und zeigt
 * getrennt, was nach dem Speichern geschah: Trades auf Kursen, die beim Festlegen der Regeln niemand kannte.
 * Rechenkern: assets/setup-kern.js (mit Node-Tests). Gerechnet wird mit dem Backtest-Kern über window.WBBacktest.
 * Alles bleibt in diesem Browser (fathom.setups) und kommt mit in die Kontosicherung. Kein Tracking, keine KI.
 */
(function () {
  "use strict";
  const SK = window.WBSetupKern, K = window.WBBacktestKern;
  if (!SK || !K || !window.WBH) return;
  const { $, $$, esc, lies, nf, minus, zahl, KLASSEN } = window.WBH;
  const BT = () => window.WBBacktest;
  const SPEICHER = "fathom.setups";
  const pct = (x, d = 1, vz = true) => window.WBH.pct(x, d, vz);
  const ton = (x) => (x == null || !isFinite(x) || Math.abs(x) < 5e-5 ? "" : x > 0 ? "plus" : "minus");
  const zeitFmt = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const tagFmt = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", year: "numeric" });
  const zeitText = (ms) => zeitFmt.format(new Date(ms));
  const datumText = (ms) => tagFmt.format(new Date(ms));
  const tagText = (t) => { const [j, m, d] = K.datum(t).split("-"); return `${d}.${m}.${j}`; };
  const standText = (s) => (s ? s.split("-").reverse().join(".") : "–");
  const klassenName = (k) => (KLASSEN.find((x) => x[0] === k) || [])[1] || k;
  const GRUND = { ziel: "Take-Profit", stop: "Stop", zeit: "Zeit", zwang: "Zwangsschließung", regel: "Ausstiegsregel", offen: "noch offen" };
  const TL = () => window.WBTaktikLabor;
  const istTaktik = (v) => v && v.art === "taktik";
  const ICON_ZU = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';

  /* ================================================================ Speicher */
  function lesen() {
    let roh = null;
    try { roh = JSON.parse(lies(SPEICHER) || "null"); } catch (e) { roh = null; }
    return SK.pruefeSpeicher(roh);
  }
  // Schreiben mit Rückmeldung: localStorage kann voll oder gesperrt sein (privates Fenster)
  function schreiben(sp) {
    try { localStorage.setItem(SPEICHER, JSON.stringify(sp)); } catch (e) { return false; }
    document.dispatchEvent(new CustomEvent("wb:setups"));
    return true;
  }
  let sp = lesen();
  window.addEventListener("storage", (e) => { if (e.key === SPEICHER) { sp = lesen(); if (wurzel && wurzel.isConnected) zeichnen(); } });

  /* ================================================================ Zustand der Oberfläche */
  let wurzel = null, wahl = null, bearbeiten = false, loeschScharf = null, ladenScharf = null, meldungText = "";
  const proben = {};  // `${id}:${nr}:${stand}` → Ergebnis der Bewährungsprobe (nur im Speicher, je Datenstand)
  let rechnet = null;
  const setupVon = (id) => sp.liste.find((s) => s.id === id) || null;
  const aktVersion = (s) => (s ? s.versionen.find((v) => v.nr === (wahl && wahl.id === s.id ? wahl.nr : null)) || s.versionen[s.versionen.length - 1] : null);

  function zeigen(el) {
    wurzel = el;
    sp = lesen();
    if (!wahl || !setupVon(wahl.id)) wahl = sp.liste.length ? { id: sp.liste[0].id, nr: sp.liste[0].versionen[sp.liste[0].versionen.length - 1].nr } : null;
    if (!el.dataset.gebunden) {
      el.dataset.gebunden = "1";
      el.addEventListener("click", klick);
      el.addEventListener("keydown", taste);
      el.addEventListener("submit", absenden);
    }
    if (wahl) vermerken(wahl.id, "geoeffnet");
    zeichnen();
  }

  /* ================================================================ Darstellung */
  function zeichnen() {
    if (!wurzel) return;
    const fokusId = document.activeElement && wurzel.contains(document.activeElement) && document.activeElement.dataset ? document.activeElement.dataset.slId : null;
    wurzel.innerHTML = `<div class="sl">
      <aside class="sl-seite" aria-label="Gespeicherte Setups">
        <p class="bt-einleitung">Ein <b>Setup</b> ist eine getestete Strategie mit Zeitstempel: Regeln, These und Ergebnis werden beim Speichern eingefroren.
          Die <b>Bewährungsprobe</b> zeigt danach, wie die Regeln auf Kursen liefen, die beim Speichern noch niemand kannte. Neue Kurse kommen mit jedem Wochenlauf.</p>
        <div class="sl-listenkopf"><h3>Setups</h3><span class="bt-anzahl">${sp.liste.length} von ${SK.GRENZEN.setups}</span></div>
        ${sp.liste.length ? `<ul class="sl-liste">${sp.liste.map(eintrag).join("")}</ul>` : leerListe()}
      </aside>
      <div class="sl-detail" aria-live="polite">${detail()}</div>
    </div>`;
    if (fokusId) { const b = $(`[data-sl-id="${CSS.escape(fokusId)}"]`, wurzel); if (b) b.focus({ preventScroll: true }); }
  }
  function leerListe() {
    return `<div class="sl-leer"><p>Noch keine Setups.</p>
      <p class="klein">So entsteht eins: im Reiter <b>Fakten</b> oder <b>Chart-Taktik</b> eine Strategie testen, dann im Ergebnis <b>„Als Setup speichern“</b>.</p>
      <div class="sl-knoepfe"><button type="button" class="knopf" data-sl-zu-fakten>Zu den Fakten</button><button type="button" class="knopf" data-sl-zu-chart>Zur Chart-Taktik</button></div></div>`;
  }
  const kerzenName = (e) => (window.WBTaktik && window.WBTaktik.EBENEN[e] ? window.WBTaktik.EBENEN[e].kerzen : e === "woche" ? "Wochenkerzen" : "Tageskerzen");
  function marktText(v) {
    if (istTaktik(v)) return `${esc(v.taktik.wertName)} · Chart-Taktik · ${esc(kerzenName(v.taktik.ebene))}`;
    const r = v.regel;
    if (r.wert) return esc(BT() ? BT().wertName(r.wert, r.klasse) : r.wert);
    return `${r.werte.length ? r.werte.length + " " : "alle "}${esc(klassenName(r.klasse))}`;
  }
  // Was sich gegenüber einer anderen Version geändert hat
  function aenderungenZwischen(alt, neu) {
    if (!alt || !neu || (alt.art || "fakten") !== (neu.art || "fakten")) return [];
    if (istTaktik(neu)) return SK.aenderungenTaktik(alt.taktik, neu.taktik, TL() ? TL().beschreibe : null);
    const bt = BT();
    return bt ? SK.aenderungen(alt.regel, neu.regel, bt.faktText, bt.wertName) : [];
  }
  function eintrag(s) {
    const v = s.versionen[s.versionen.length - 1], p = v.probe;
    const an = wahl && wahl.id === s.id;
    let status = '<span class="sl-status">noch nicht geprüft</span>';
    if (p) {
      status = p.n ? `<span class="sl-status">seit ${datumText(v.zeit)}: ${p.n} ${p.n === 1 ? "Trade" : "Trades"}, Ø <span class="${ton(p.mittel)}">${pct(p.mittel, 2)}</span></span>`
        : `<span class="sl-status">seit ${datumText(v.zeit)}: noch kein neuer Trade</span>`;
      if (p.offen) status += '<span class="sl-offen">Position offen</span>';
    }
    return `<li><button type="button" class="sl-eintrag${an ? " an" : ""}" data-sl-id="${esc(s.id)}" aria-current="${an}">
      <span class="sl-name">${esc(s.name)}</span>
      <span class="sl-markt">${marktText(v)} · v${v.nr}${s.versionen.length > 1 ? ` von ${s.versionen.length}` : ""}</span>
      ${status}</button></li>`;
  }

  function detail() {
    const s = wahl && setupVon(wahl.id);
    if (!s) {
      return sp.liste.length ? '<p class="klein sl-hinweis">Wähle links ein Setup.</p>'
        : `<div class="sl-leer-detail"><p class="bt-zeile">Setup Lab</p><p class="sl-titel">Hypothesen festhalten, später ehrlich prüfen.</p>
          <ol class="sl-schritte"><li>Strategie im Reiter Fakten oder Chart-Taktik testen.</li><li>Mit These speichern: Die Regeln bekommen einen Zeitstempel.</li>
          <li>Nach neuen Wochenläufen die Bewährungsprobe rechnen: Nur Trades nach dem Speichern zählen.</li></ol></div>`;
    }
    const v = aktVersion(s), letzte = s.versionen[s.versionen.length - 1];
    const vorher = s.versionen.filter((x) => x.nr < v.nr).pop();
    const aend = aenderungenZwischen(vorher, v);
    const tk = istTaktik(v) ? v.taktik : null;
    return `
      <p class="bt-zeile">Setup · v${v.nr}${s.versionen.length > 1 ? ` von ${letzte.nr}` : ""} · gespeichert ${zeitText(v.zeit)} · Daten bis ${standText(v.daten.stand)}${v.daten.demo ? " · Demo-Daten" : ""}</p>
      ${bearbeiten ? textFormular(s) : `
      <h3 class="sl-titel">${esc(s.name)}</h3>
      <dl class="sl-these">
        <div><dt>These</dt><dd>${s.these ? esc(s.these) : '<span class="leise">Keine These notiert.</span>'}</dd></div>
        <div><dt>Widerlegt, wenn</dt><dd>${s.widerlegt ? esc(s.widerlegt) : '<span class="leise">Nicht festgelegt.</span>'}</dd></div>
      </dl>`}
      <div class="bt-aktionen">
        <button type="button" class="knopf primaer" data-sl-pruefen>${proben[probenSchluessel(s, v)] ? "Neu prüfen" : "Bewährungsprobe rechnen"}</button>
        <button type="button" class="knopf" data-sl-laden>${tk ? (ladenScharf === s.id ? `Ersetzt deine Zeichnungen für ${esc(tk.wertName)}. Trotzdem öffnen?` : "In der Chart-Taktik öffnen") : "Im Baukasten öffnen"}</button>
        ${bearbeiten ? "" : '<button type="button" class="knopf" data-sl-bearbeiten>These bearbeiten</button>'}
        <button type="button" class="knopf sl-weg" data-sl-weg>${loeschScharf === s.id ? "Wirklich löschen?" : "Löschen"}</button>
      </div>
      <p class="bt-meldung klein sl-meldung" role="status">${esc(meldungText)}</p>
      ${probeBlock(s, v)}
      <section class="bt-block">
        <div class="bt-block-kopf"><h3>Regeln von v${v.nr}</h3><p class="klein">${tk
          ? `${marktText(v)} · ${tk.zeichnungen.length} ${tk.zeichnungen.length === 1 ? "Zeichnung" : "Zeichnungen"}${tk.indikatoren.length ? ` · ${tk.indikatoren.length} Indikatoren` : ""}${tk.nurDanach ? " · nur nach den Zeichnungen" : ""}`
          : `${marktText(v)} · ${v.regel.jahre} ${v.regel.jahre === 1 ? "Jahr" : "Jahre"} · ${v.regel.fakten.length} Fakten`}</p></div>
        <p class="bt-worte"><b>${tk ? "So verstanden" : "In Worten"}:</b> ${esc(v.worte || "–")}</p>
        ${tk && tk.text ? `<p class="sl-taktik-text"><b>Deine Beschreibung:</b> ${esc(tk.text)}</p>` : ""}
        ${v.notiz || aend.length ? `<div class="sl-aenderung"><p class="klein"><b>Geändert gegenüber v${vorher ? vorher.nr : "?"}</b>${v.notiz ? `: ${esc(v.notiz)}` : ""}</p>
          ${aend.length ? `<ul>${aend.map((a) => `<li>${esc(a)}</li>`).join("")}</ul>` : ""}</div>` : ""}
      </section>
      ${versionenBlock(s, v)}
      <section class="bt-block bt-grenzen"><div class="bt-block-kopf"><h3>Grenzen</h3></div><ul>
        <li>Die Bewährungsprobe zählt nur Trades, die <b>nach</b> dem Speichern eröffnet wurden. Was vorher begann, gehört zum Backtest, auch wenn es erst danach endete.</li>
        <li>Kosten wie im Backtest: Kommission und Finanzierung aus den Regeln, Geld-Brief-Spread bei Werten mit Spread-Daten. Slippage darüber hinaus ist nicht enthalten; echte Ausführungen sind oft schlechter.</li>
        <li>Wenige Trades sagen wenig. Ein Vergleich mit dem Backtest erscheint erst ab ${SK.MIN_VERGLEICH} neuen Trades und ist auch dann keine Garantie.</li>
        ${tk ? "<li>Zeichnungen gelten so, wie sie beim Speichern lagen. Neue Trades danach beruhen nur auf Kursen, die beim Zeichnen niemand kannte.</li>"
          : "<li>Signal-Schwellen sind mit der Version gespeichert.</li>"}
        <li>Ändern sich Kursdaten nachträglich (Splits, Dividenden, Korrekturen) oder Definitionen in Fathom, weist die Probe darauf hin.</li>
        <li>Alles liegt nur in diesem Browser. Sichern über Konto → Sicherung. Keine Anlageberatung, keine Gewinnversprechen.</li>
      </ul></section>`;
  }

  function textFormular(s) {
    return `<form class="sl-text bt-block" data-sl-textform data-bt-esc novalidate>
      <div class="seite-felder">
        <label class="seite-feld seite-breit">Name<input type="text" name="name" maxlength="${SK.GRENZEN.name}" required value="${esc(s.name)}"></label>
        <label class="seite-feld seite-breit">These: Warum sollte das funktionieren?<textarea name="these" maxlength="${SK.GRENZEN.these}">${esc(s.these)}</textarea></label>
        <label class="seite-feld seite-breit">Widerlegt, wenn …<input type="text" name="widerlegt" maxlength="${SK.GRENZEN.widerlegt}" value="${esc(s.widerlegt)}" placeholder="z. B. Ø Trade nach 20 neuen Trades unter 0"></label>
      </div>
      <div class="sl-knoepfe"><button type="submit" class="knopf primaer">Speichern</button><button type="button" class="knopf" data-sl-abbrechen>Abbrechen</button></div>
      <p class="klein">Name und These ändern keine Version: Die Regeln bleiben, wie sie sind.</p>
    </form>`;
  }

  const probenSchluessel = (s, v) => {
    const d = BT() && BT().datenStand();
    return `${s.id}:${v.nr}:${d ? d.stand : "?"}`;
  };

  function probeBlock(s, v) {
    const key = probenSchluessel(s, v), p = proben[key], e = v.ergebnis || {};
    const kopf = `<div class="bt-block-kopf"><h3>Bewährungsprobe</h3><p class="klein">seit ${zeitText(v.zeit)}</p></div>`;
    if (rechnet === key) return `<section class="bt-block sl-probe">${kopf}<p class="klein bt-laedt">Rechnet die Regeln von v${v.nr} auf den heutigen Daten …</p></section>`;
    if (!p) {
      const alt = v.probe ? `<p class="klein">Letzte Prüfung ${zeitText(v.probe.zeit)} (Daten bis ${standText(v.probe.stand)}): ${v.probe.n} neue ${v.probe.n === 1 ? "Trade" : "Trades"}${v.probe.n ? `, Ø ${pct(v.probe.mittel, 2)}` : ""}.</p>` : "";
      return `<section class="bt-block sl-probe">${kopf}
        <p class="sl-satz">Noch nicht für den aktuellen Datenstand geprüft.</p>${alt}
        ${vergleichsTabelle(e, null)}</section>`;
    }
    if (p.fehler) return `<section class="bt-block sl-probe">${kopf}<p class="bt-fehler">${esc(p.fehler)}</p>${vergleichsTabelle(e, null)}</section>`;
    const n = p.neu.n, offen = p.offen;
    const demo = p.demo || v.daten.demo;
    const satz = n ? `${n} ${n === 1 ? "neuer Trade" : "neue Trades"} seit dem Speichern, ${Math.round(p.neu.quote * n)} im Plus.`
      : offen ? "Seit dem Speichern noch kein abgeschlossener Trade." : "Seit dem Speichern noch kein neuer Trade.";
    const urteil = {
      keine: `Eine Aussage gibt es erst ab ${SK.MIN_VERGLEICH} neuen Trades. Daten bis ${standText(p.stand)}; neue Kurse kommen mit dem nächsten Wochenlauf.`,
      zu_wenig: `Erst ${n} von ${SK.MIN_VERGLEICH} Trades: Für einen Vergleich mit dem Backtest ist das zu wenig.`,
      im_rahmen: `Der Ø Trade seit dem Speichern liegt im Rahmen des Backtests (${zahl(Math.abs(p.vergleich.z), 1)} Standardfehler Abstand). Das bestätigt die These nicht, widerlegt sie aber auch nicht.`,
      schlechter: `Der Ø Trade seit dem Speichern liegt deutlich unter dem Backtest (${zahl(Math.abs(p.vergleich.z), 1)} Standardfehler). Mögliche Gründe: Überanpassung an die Vergangenheit, ein anderes Marktumfeld oder Zufall.`,
      besser: `Der Ø Trade seit dem Speichern liegt deutlich über dem Backtest (${zahl(p.vergleich.z, 1)} Standardfehler). Auch das kann Zufall oder ein anderes Marktumfeld sein.`,
      ohne_streuung: "Der Backtest hatte zu wenige Trades, um die Streuung zu schätzen. Ein Vergleich ist nicht möglich.",
      demo: "Mit Demo-Daten gibt es keinen Vergleich mit dem Backtest.",
    }[p.vergleich.art];
    return `<section class="bt-block sl-probe">${kopf}
      ${demo ? '<p class="sl-warnung">Demo-Daten: Die Kurse werden bei jedem Lauf neu erzeugt. Die Bewährungsprobe zeigt hier nur, wie die Funktion arbeitet, und sagt nichts über die Strategie.</p>' : ""}
      <p class="sl-satz">${satz}</p>
      <p class="klein sl-urteil">${esc(urteil)}</p>
      ${offen ? `<p class="sl-offen-zeile">Offen: ${offen.dir > 0 ? "Long" : "Short"} ${esc(offen.name)} seit ${tagText(Math.floor(offen.einMin / 1440))} zum Kurs ${zahl(offen.ein, offen.dez)} · vorläufig <span class="${ton(offen.netto)}">${pct(offen.netto, 2)}</span> (Stand ${tagText(p.ende)})</p>` : ""}
      ${vergleichsTabelle(e, p.neu)}
      ${p.hinweise.length ? `<ul class="sl-hinweise">${p.hinweise.map((h) => `<li>${esc(h)}</li>`).join("")}</ul>` : ""}
      ${p.liste.length ? `<div class="tabelle-rahmen"><table class="bt-tabelle sl-trades"><caption class="klein">Neue Trades, neueste zuerst${p.liste.length > 50 ? " (die letzten 50)" : ""}</caption>
        <thead><tr><th>Einstieg</th><th>Wert</th><th>Richtung</th><th>Ausstieg</th><th>Grund</th><th>Ergebnis</th></tr></thead>
        <tbody>${p.liste.slice(-50).reverse().map((t) => `<tr><td>${tagText(Math.floor(t.einMin / 1440))}</td><td>${esc(t.name)}</td><td>${t.dir > 0 ? "Long" : "Short"}</td>
          <td>${t.grund === "offen" ? "–" : tagText(Math.floor(t.ausMin / 1440))}</td><td>${GRUND[t.grund] || esc(t.grund)}</td><td class="${ton(t.netto)}">${pct(t.netto, 2)}${t.grund === "offen" ? '<span class="unter">vorläufig</span>' : ""}</td></tr>`).join("")}</tbody>
      </table></div>` : ""}
    </section>`;
  }

  // Backtest beim Speichern gegen die Zeit danach. Was sich nicht berechnen lässt, steht als „–“ mit Grund.
  function vergleichsTabelle(bt, neu) {
    const z = (x, f) => (x == null || !isFinite(x) ? "–" : f(x));
    const zeile = (titel, a, b, kl) => `<tr><td>${titel}</td><td class="${kl ? kl(bt) : ""}">${a}</td><td class="${neu && kl ? kl(neu) : ""}">${neu ? b : "–"}</td></tr>`;
    const st = SK.stichprobe(bt.n), stNeu = neu ? SK.stichprobe(neu.n) : null;
    return `<div class="tabelle-rahmen"><table class="bt-vergleich sl-vergleich">
      <thead><tr><th></th><th>Backtest<span class="sl-lang"> beim Speichern</span></th><th><span class="sl-lang">Seit dem </span><span class="sl-kurz">Seit </span>Speichern</th></tr></thead>
      <tbody>
        ${zeile("Abgeschlossene Trades", `${nf(0).format(bt.n)}${bt.offen ? ` <span class="unter">+${bt.offen} offen</span>` : ""}`, neu ? `${nf(0).format(neu.n)}${neu.offen ? ` <span class="unter">+${neu.offen} offen</span>` : ""}` : "")}
        ${zeile("Trefferquote", z(bt.quote, (x) => pct(x, 0, false)), neu && z(neu.quote, (x) => pct(x, 0, false)))}
        ${zeile("Ø Trade (Erwartungswert)", z(bt.mittel, (x) => pct(x, 2)), neu && z(neu.mittel, (x) => pct(x, 2)), (k) => ton(k && k.mittel))}
        ${zeile("Ø Gewinn · Ø Verlust", `${z(bt.mittelGewinn, (x) => pct(x, 1))} · ${z(bt.mittelVerlust, (x) => pct(x, 1))}`, neu && `${z(neu.mittelGewinn, (x) => pct(x, 1))} · ${z(neu.mittelVerlust, (x) => pct(x, 1))}`)}
        ${zeile("Profit-Faktor", bt.n && bt.faktor == null ? "nur Gewinne" : z(bt.faktor, (x) => zahl(x, 2)), neu && (neu.n && neu.faktor == null ? "nur Gewinne" : z(neu.faktor, (x) => zahl(x, 2))))}
        ${zeile("Summe der Trade-Renditen", z(bt.summe, (x) => pct(x, 1)), neu && z(neu.summe, (x) => pct(x, 1)), (k) => ton(k && k.summe))}
        ${zeile("t-Wert", z(bt.t, (x) => zahl(x, 1)), neu && z(neu.t, (x) => zahl(x, 1)))}
        ${zeile("Größter Rückgang (Konto)", z(bt.rueckgang, (x) => pct(x, 1)), neu ? '<span class="unter">nur im Backtest</span>' : "", (k) => (k === bt ? ton(bt.rueckgang) : ""))}
      </tbody></table></div>
      <p class="klein sl-stichprobe">Backtest: ${esc(st.text)}${stNeu ? ` · Seit dem Speichern: ${esc(stNeu.text)}` : ""}. Renditen je Trade auf den Einsatz nach Kosten${bt.hebel > 1 ? `, mit Hebel ${bt.hebel}×` : ""}.
        ${bt.kostenEuro != null ? `Kosten im Backtest ${nf(0).format(bt.kostenEuro + (bt.finanzEuro || 0))} €.` : ""}</p>`;
  }

  function versionenBlock(s, v) {
    if (s.versionen.length < 2) return "";
    return `<section class="bt-block"><div class="bt-block-kopf"><h3>Versionen vergleichen</h3><p class="klein">Zeile wählen, um eine Version anzusehen</p></div>
      <div class="tabelle-rahmen"><table class="bt-tabelle sl-versionen">
        <thead><tr><th>Version</th><th>Gespeichert</th><th>Trades</th><th>Treffer</th><th>Ø Trade</th><th>Profit-Faktor</th><th>Rückgang</th><th>Seit dem Speichern</th></tr></thead>
        <tbody>${s.versionen.slice().reverse().map((x) => {
          const e = x.ergebnis || {}, p = x.probe;
          return `<tr data-sl-nr="${x.nr}" tabindex="0" aria-selected="${x.nr === v.nr}" class="${x.nr === v.nr ? "an" : ""}">
            <td>v${x.nr}${x.notiz ? `<span class="unter">${esc(x.notiz)}</span>` : ""}</td><td>${datumText(x.zeit)}</td><td>${e.n}</td>
            <td>${e.quote == null ? "–" : pct(e.quote, 0, false)}</td><td class="${ton(e.mittel)}">${e.mittel == null ? "–" : pct(e.mittel, 2)}</td>
            <td>${e.n && e.faktor == null ? "nur Gewinne" : e.faktor == null ? "–" : zahl(e.faktor, 2)}</td><td class="${ton(e.rueckgang)}">${e.rueckgang == null ? "–" : pct(e.rueckgang, 1)}</td>
            <td>${p ? (p.n ? `${p.n} · Ø <span class="${ton(p.mittel)}">${pct(p.mittel, 2)}</span>` : "kein Trade") : '<span class="leise">nicht geprüft</span>'}</td></tr>`;
        }).join("")}</tbody>
      </table></div>
      <p class="klein">Die Kennzahlen jeder Version sind die beim Speichern. Ältere Versionen haben mehr Zeit für die Bewährungsprobe gehabt; vergleiche die Zahl der neuen Trades mit.</p></section>`;
  }

  /* ================================================================ Bewährungsprobe */
  function pruefen(s, v) {
    const bt = BT();
    if (!bt || rechnet || (istTaktik(v) && !TL())) return;
    const key = probenSchluessel(s, v);
    rechnet = key; meldungText = ""; zeichnen();
    const stichMin = Math.floor(v.zeit / 6e4);
    const lauf = istTaktik(v) ? TL().pruefen(v.taktik) : bt.setupPruefen(v.regel, v.ergebnis ? v.ergebnis.von : null);
    lauf.then((r) => {
      const namen = {};
      r.trades.forEach((t) => { namen[t.w.s] = t.w.name; });
      const { vorher, nachher } = SK.teile(r.trades, stichMin);
      const neu = SK.kennzahlen(nachher);
      const offenT = nachher.filter((t) => t.grund === "offen").pop() || null;
      const hinweise = [];
      if (r.fehlend.length) hinweise.push(`Nicht mehr in den Daten und darum nicht mitgerechnet: ${r.fehlend.join(", ")}.`);
      const teilweise = !!(v.ergebnis && v.ergebnis.von != null && r.anfang > v.ergebnis.von);
      if (teilweise) hinweise.push(`Die Kursdaten beginnen heute erst am ${tagText(r.anfang)}; der Backtest-Teil ist nur teilweise nachgerechnet.`);
      // Quellen mit begrenztem Zeitraum (z. B. Yahoo: 1-Minuten-Kerzen nur 7 Tage): Trades kurz nach dem Speichern können fehlen
      if (r.fenster && r.anfang * 1440 > stichMin) hinweise.push(`Die ${kerzenName(v.taktik.ebene)} reichen heute nur bis zum ${tagText(r.anfang)} zurück (Quelle: letzte ${String(r.fenster).slice(0, 20)}). Trades zwischen dem Speichern und diesem Tag fehlen in der Probe; prüfe solche Setups regelmäßig.`);
      const heuteVorher = SK.kennzahlen(SK.nachgerechnet(vorher, v.ergebnis ? v.ergebnis.bis : null));
      if (v.ergebnis && !teilweise && SK.datenGeaendert(v.ergebnis, heuteVorher)) {
        hinweise.push(`Der Backtest-Teil ergibt heute ${heuteVorher.n} abgeschlossene Trades mit Ø ${pct(heuteVorher.mittel, 2)} (beim Speichern ${v.ergebnis.n}, Ø ${pct(v.ergebnis.mittel, 2)}). `
          + "Kursdaten, Werte oder Definitionen haben sich seitdem geändert; die Bewährungsprobe rechnet mit den heutigen Daten.");
      }
      if (r.ruin != null) hinweise.push(`Das Konto der Strategie war am ${tagText(r.ruin)} aufgebraucht; danach wurden keine Trades mehr eröffnet.`);
      r.annahmen.filter((a) => /übersprungen/.test(a)).forEach((a) => hinweise.push(a));
      const vergleich = r.demo || v.daten.demo ? { art: "demo", z: null } : SK.vergleich(v.ergebnis, neu);
      const liste = nachher.map((t) => ({ einMin: t.einMin, ausMin: t.ausMin, dir: t.dir, grund: t.grund, netto: t.netto, name: namen[t.w.s] || t.w.s }));
      proben[key] = { neu, liste, vergleich, hinweise, demo: r.demo, stand: r.stand, ende: r.ende,
        offen: offenT ? { dir: offenT.dir, name: offenT.w.name, einMin: offenT.einMin, ein: offenT.ein, netto: offenT.netto, dez: Math.max(2, window.WBH.kursStellen(offenT.w, 5)) } : null };
      const art = r.demo || v.daten.demo ? "demo" : vergleich.art;
      vermerken(s.id, "geprueft", v.nr, SK.probeAus(Date.now(), r.stand, neu, art, offenT));
    }).catch((err) => {
      proben[key] = { fehler: err && err.message ? err.message : "Die Bewährungsprobe ließ sich nicht rechnen." };
    }).finally(() => {
      rechnet = null;
      zeichnen();
      const block = wurzel && $(".sl-probe", wurzel);
      if (block && matchMedia("(max-width: 960px)").matches) block.scrollIntoView({ block: "nearest" });
    });
  }

  function vermerken(id, art, nr, probe) {
    const neu = SK.vermerken(sp, id, art, Date.now(), nr, probe);
    if (schreiben(neu)) sp = neu;
  }

  /* ================================================================ Bedienung */
  function klick(e) {
    const t = e.target;
    const eintragKnopf = t.closest("[data-sl-id]");
    if (eintragKnopf) {
      const s = setupVon(eintragKnopf.dataset.slId);
      if (!s) return;
      if (!wahl || wahl.id !== s.id) { wahl = { id: s.id, nr: s.versionen[s.versionen.length - 1].nr }; bearbeiten = false; loeschScharf = null; meldungText = ""; vermerken(s.id, "geoeffnet"); }
      zeichnen();
      if (matchMedia("(max-width: 960px)").matches) { const d = $(".sl-detail", wurzel); if (d) d.scrollIntoView({ block: "start" }); }
      return;
    }
    const zeile = t.closest("[data-sl-nr]");
    if (zeile && wahl) { wahl = { id: wahl.id, nr: +zeile.dataset.slNr }; zeichnen(); const z = $(`[data-sl-nr="${wahl.nr}"]`, wurzel); if (z) z.focus({ preventScroll: true }); return; }
    if (t.closest("[data-sl-zu-fakten]")) { BT().modusSetzen("fakten"); return; }
    if (t.closest("[data-sl-zu-chart]")) { BT().modusSetzen("chart"); return; }
    const s = wahl && setupVon(wahl.id);
    if (!s) return;
    const v = aktVersion(s);
    if (t.closest("[data-sl-pruefen]")) { pruefen(s, v); return; }
    if (t.closest("[data-sl-laden]")) {
      if (istTaktik(v)) {
        if (!TL()) return;
        if (ladenScharf !== s.id && TL().ersetztEtwas(v.taktik)) {
          ladenScharf = s.id; zeichnen(); const b = $("[data-sl-laden]", wurzel); if (b) b.focus();
          setTimeout(() => { if (ladenScharf === s.id) { ladenScharf = null; if (wurzel && wurzel.isConnected) zeichnen(); } }, 5000);
          return;
        }
        ladenScharf = null;
        TL().laden(v.taktik, { id: s.id, nr: v.nr }).catch((err) => { meldungText = err.message || "Konnte nicht geladen werden."; zeichnen(); });
        return;
      }
      BT().setupLaden(v.regel, { id: s.id, nr: v.nr }).then((r) => {
        const hinweis = [r.schwellenAnders ? "Deine Signal-Schwellen haben sich seit dem Speichern geändert; der Baukasten rechnet mit den aktuellen." : "",
          r.wertFehlt ? "Der gespeicherte Wert ist gerade nicht verfügbar." : ""].filter(Boolean).join(" ");
        if (hinweis) BT().hinweis(hinweis);
      }).catch((err) => { meldungText = err.message || "Konnte nicht geladen werden."; zeichnen(); });
      return;
    }
    if (t.closest("[data-sl-bearbeiten]")) { bearbeiten = true; zeichnen(); const f = $("[data-sl-textform] input", wurzel); if (f) f.focus(); return; }
    if (t.closest("[data-sl-abbrechen]")) { bearbeiten = false; zeichnen(); const b = $("[data-sl-bearbeiten]", wurzel); if (b) b.focus(); return; }
    if (t.closest("[data-sl-weg]")) {
      if (loeschScharf !== s.id) {
        loeschScharf = s.id; zeichnen(); const b = $("[data-sl-weg]", wurzel); if (b) b.focus();
        setTimeout(() => { if (loeschScharf === s.id) { loeschScharf = null; const k = wurzel && $("[data-sl-weg]", wurzel); if (k) k.textContent = "Löschen"; } }, 4000);
        return;
      }
      loeschScharf = null;
      const neu = SK.entfernen(sp, s.id);
      if (!schreiben(neu)) { meldungText = "Konnte nicht löschen: Der Speicher des Browsers ist gesperrt."; zeichnen(); return; }
      sp = neu; BT().vergessen(s.id);
      Object.keys(proben).forEach((k) => { if (k.startsWith(s.id + ":")) delete proben[k]; });
      wahl = sp.liste.length ? { id: sp.liste[0].id, nr: sp.liste[0].versionen[sp.liste[0].versionen.length - 1].nr } : null;
      meldungText = ""; zeichnen();
      const erster = $("[data-sl-id]", wurzel) || $("[data-sl-zu-fakten]", wurzel); if (erster) erster.focus();
    }
  }
  function taste(e) {
    const knopf = e.target.closest && e.target.closest("[data-sl-id]");
    if (knopf && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      const alle = $$("[data-sl-id]", wurzel), i = alle.indexOf(knopf), j = i + (e.key === "ArrowDown" ? 1 : -1);
      if (alle[j]) { e.preventDefault(); alle[j].focus(); }
      return;
    }
    const zeile = e.target.closest && e.target.closest("[data-sl-nr]");
    if (zeile && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); zeile.click(); return; }
    if (e.key === "Escape" && e.target.closest && e.target.closest("[data-sl-textform]")) { e.preventDefault(); bearbeiten = false; zeichnen(); const b = $("[data-sl-bearbeiten]", wurzel); if (b) b.focus(); }
  }
  function absenden(e) {
    const f = e.target.closest("[data-sl-textform]");
    if (!f) return;
    e.preventDefault();
    const s = wahl && setupVon(wahl.id);
    if (!s) return;
    const r = SK.textAendern(sp, s.id, { name: f.elements.name.value, these: f.elements.these.value, widerlegt: f.elements.widerlegt.value }, Date.now());
    if (r.fehler) { meldungText = r.fehler; zeichnen(); return; }
    if (!schreiben(r.speicher)) { meldungText = "Konnte nicht speichern: Der Speicher des Browsers ist voll oder gesperrt."; zeichnen(); return; }
    sp = r.speicher; bearbeiten = false; meldungText = "Gespeichert."; zeichnen();
  }

  /* ================================================================ „Als Setup speichern“ im Report */
  // quelle: "fakten" (Report im Reiter Fakten) oder "taktik" (Ergebnis im Reiter Chart-Taktik)
  function speichernZeigen(report, quelle) {
    const bt = BT();
    const taktik = quelle === "taktik";
    if (!bt || !report || (taktik && !TL())) return;
    // Momentaufnahme aus dem jeweiligen Reiter; gleiche Form für beide Arten
    const holen = () => {
      const x = taktik ? TL().setupDaten() : bt.setupRegel();
      if (!x) return null;
      return Object.assign({}, x, { version: taktik ? { art: "taktik", taktik: x.taktik, worte: x.worte, daten: x.daten, ergebnis: x.ergebnis }
        : { regel: x.regel, worte: x.worte, daten: x.daten, ergebnis: x.ergebnis } });
    };
    const knopfSel = taktik ? "[data-tl-setup]" : "[data-bt-setup]";
    const herkunftSetzen = (h) => (taktik ? TL().herkunftSetzen(h) : bt.herkunftSetzen(h));
    let box = $(".sl-speichern", report);
    if (box && $("form", box)) { const n = $("input:not([hidden]), textarea", box); if (n) n.focus(); return; }
    if (box) box.remove();  // Bestätigung oder Hinweis von vorhin: neu aufbauen
    const anker = $(".bt-ergebnis", report);
    if (!anker) return;
    box = document.createElement("div");
    box.className = "sl-speichern";
    anker.after(box);
    const a = holen();
    sp = lesen();
    if (!a) { box.innerHTML = '<p class="bt-fehler">Erst einen Backtest starten, dann speichern.</p>'; return; }
    if (!a.frisch) { box.innerHTML = '<p class="bt-fehler sl-veraltet">Die Strategie wurde geändert. Starte den Backtest neu, damit Regeln und Ergebnis zusammenpassen, und speichere dann.</p>'; return; }
    let herkunft = a.herkunft && setupVon(a.herkunft.id);
    let letzte = herkunft && herkunft.versionen[herkunft.versionen.length - 1];
    if (letzte && (letzte.art || "fakten") !== (taktik ? "taktik" : "fakten")) { herkunft = null; letzte = null; }  // andere Art: nur neues Setup
    const gleich = letzte && SK.signaturVersion(letzte) === SK.signaturVersion(Object.assign({ art: "fakten" }, a.version));
    const aend = letzte && !gleich ? aenderungenZwischen(letzte, Object.assign({ art: "fakten" }, a.version, { nr: letzte.nr + 1 })) : [];
    const e = a.ergebnis;
    box.innerHTML = `<form class="bt-block sl-form" data-bt-esc novalidate>
      <div class="bt-block-kopf"><h3>Als Setup speichern</h3><p class="klein">Regeln, Ergebnis und Zeitpunkt werden eingefroren</p></div>
      ${herkunft ? `<div class="seite-wahl sl-art" role="radiogroup" aria-label="Wie speichern">
          <button type="button" role="radio" data-sl-art="version" aria-checked="${!gleich}"${gleich ? " disabled" : ""}>Neue Version von „${esc(herkunft.name)}“ (v${letzte.nr + 1})</button>
          <button type="button" role="radio" data-sl-art="neu" aria-checked="${!!gleich}">Neues Setup</button></div>
        ${gleich ? `<p class="klein">Diese Regeln sind schon als v${letzte.nr} von „${esc(herkunft.name)}“ gespeichert.</p>` : ""}` : ""}
      <div class="seite-felder">
        <label class="seite-feld seite-breit" data-sl-fuer="neu"${herkunft && !gleich ? " hidden" : ""}>Name<input type="text" name="name" maxlength="${SK.GRENZEN.name}" placeholder="${taktik ? "z. B. Ausbruch über den Widerstand" : "z. B. Montags nach guten Zahlen"}" value="${esc(herkunft && gleich ? herkunft.name + " (Kopie)" : "")}"></label>
        <label class="seite-feld seite-breit" data-sl-fuer="neu"${herkunft && !gleich ? " hidden" : ""}>These: Warum sollte das funktionieren?<textarea name="these" maxlength="${SK.GRENZEN.these}" placeholder="z. B. Positive Überraschungen werden am ersten Handelstag nicht ganz eingepreist."></textarea></label>
        <label class="seite-feld seite-breit" data-sl-fuer="neu"${herkunft && !gleich ? " hidden" : ""}>Widerlegt, wenn …<input type="text" name="widerlegt" maxlength="${SK.GRENZEN.widerlegt}" placeholder="z. B. Ø Trade nach 20 neuen Trades unter 0"></label>
        <label class="seite-feld seite-breit" data-sl-fuer="version"${herkunft && !gleich ? "" : " hidden"}>Was hat sich geändert?<input type="text" name="notiz" maxlength="${SK.GRENZEN.notiz}" value="${esc(aend.slice(0, 3).join("; "))}"></label>
      </div>
      <p class="klein sl-zusammenfassung">Gespeichert wird: ${esc(a.titel)} · ${nf(0).format(e.n)} abgeschlossene Trades · ${e.quote == null ? "–" : pct(e.quote, 0, false)} Treffer · Ø ${e.mittel == null ? "–" : pct(e.mittel, 2)} · Daten bis ${standText(a.daten.stand)}.
        ${e.n < 30 ? `<b>${esc(SK.stichprobe(e.n).text)}.</b>` : ""}</p>
      ${a.daten.demo ? '<p class="klein sl-warnung">Demo-Daten: Speichern geht, eine Bewährungsprobe ist mit zufälligen Kursen aber nicht aussagekräftig.</p>' : ""}
      <div class="sl-knoepfe"><button type="submit" class="knopf primaer">Speichern</button><button type="button" class="knopf" data-sl-form-zu>Abbrechen</button></div>
      <p class="klein sl-form-meldung" role="status"></p>
    </form>`;
    const form = $("form", box);
    const art = () => { const b = $('[data-sl-art][aria-checked="true"]', form); return b ? b.dataset.slArt : "neu"; };
    form.addEventListener("click", (ev) => {
      const b = ev.target.closest("[data-sl-art]");
      if (b && !b.disabled) {
        $$("[data-sl-art]", form).forEach((x) => x.setAttribute("aria-checked", String(x === b)));
        $$("[data-sl-fuer]", form).forEach((l) => { l.hidden = l.dataset.slFuer !== b.dataset.slArt; });
        const f = $(`[data-sl-fuer="${b.dataset.slArt}"] input`, form); if (f) f.focus();
      }
      if (ev.target.closest("[data-sl-form-zu]")) { box.remove(); const k = document.querySelector(knopfSel); if (k) k.focus(); }
    });
    form.addEventListener("keydown", (ev) => { if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); box.remove(); const k = document.querySelector(knopfSel); if (k) k.focus(); } });
    form.addEventListener("submit", (ev) => {
      ev.preventDefault();
      const neuA = holen();
      const melde = (t) => { $(".sl-form-meldung", form).textContent = t; };
      if (!neuA || !neuA.frisch) { melde("Die Strategie wurde inzwischen geändert. Bitte neu starten und dann speichern."); return; }
      const version = neuA.version;
      const jetzt = Date.now();
      sp = lesen();
      let r;
      if (art() === "version" && herkunft) r = SK.versionHinzu(sp, herkunft.id, Object.assign({}, version, { notiz: form.elements.notiz.value }), jetzt);
      else r = SK.anlegen(sp, { name: form.elements.name.value, these: form.elements.these.value, widerlegt: form.elements.widerlegt.value }, version, jetzt);
      if (r.fehler) { melde(r.fehler); const n = form.elements.name; if (/Namen/.test(r.fehler) && n) n.focus(); return; }
      if (!schreiben(r.speicher)) { melde("Konnte nicht speichern: Der Speicher des Browsers ist voll oder gesperrt. Lösche alte Setups oder sichere über Konto → Sicherung."); return; }
      sp = r.speicher;
      const nr = r.setup.versionen[r.setup.versionen.length - 1].nr;
      herkunftSetzen({ id: r.setup.id, nr });
      wahl = { id: r.setup.id, nr };
      box.innerHTML = `<div class="bt-block sl-gespeichert" tabindex="-1"><p class="sl-satz">Gespeichert: „${esc(r.setup.name)}“, v${nr}.</p>
        <p class="klein">Ab jetzt zählt jeder neu eröffnete Trade als Bewährungsprobe. Neue Kurse kommen mit dem nächsten Wochenlauf.</p>
        <div class="bt-aktionen"><button type="button" class="knopf" data-sl-hin>Zum Setup</button></div></div>`;
      const g = $(".sl-gespeichert", box); g.focus({ preventScroll: true });
      $("[data-sl-hin]", box).addEventListener("click", () => bt.modusSetzen("setups"));
    });
    const erstes = $('[data-sl-fuer]:not([hidden]) input, [data-sl-fuer]:not([hidden]) textarea', form);
    if (erstes) erstes.focus({ preventScroll: true });
    box.scrollIntoView({ block: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }

  window.WBSetupLab = {
    zeigen,
    speichernZeigen,
    // Lokale Produktmetriken ohne Namen, Regeln oder Kennzahlen (siehe PRODUKT.md); nichts davon wird gesendet
    metriken: () => SK.metriken(lesen(), Date.now()),
  };
})();
