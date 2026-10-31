"""Szenarien für die nächsten vier Quartale: Downside, Basis und Upside auf demselben Treiberbaum.

Vorgehen wie bei „Forecast & scenario modeling“: auf die zuletzt berichteten Ist-Zahlen aufsetzen, vier Quartale
fortschreiben, drei Szenarien rechnen, in denen sich nur die begründeten Annahmen unterscheiden, jede Annahme mit
Größe und Quelle festhalten und offen sagen, wo die Rechnung unsicher ist. Der Wochenlauf setzt jeden Montag neu
auf die letzten Ist-Zahlen auf. Der Browser (assets/szenario-kern.js) rechnet mit derselben Formel nach, wenn du
eine Annahme änderst, und schreibt daraus das Memo; hier entstehen die Standardannahmen und die Zeile der E-Mail.

Aktien mit positivem Gewinn (Gewinnmodell):
    Kurs in 4 Quartalen = Kurs heute × (1 + Gewinnwachstum g) × (1 + Bewertungsänderung v)
    Rendite             = (1 + g)(1 + v) − 1 + Dividendenrendite
    g  Basis: Konsens-Wachstum; Upside/Downside: höchste und niedrigste Analystenschätzung relativ zum Mittel
    v  Basis: 0 (das KGV bleibt); Upside/Downside: typische Veränderung des KGV binnen eines Jahres (5 Jahre Historie)
    Jedes Prognosequartal = gleiches Quartal des Vorjahres × (1 + g), so bleibt die Saison erhalten.
Übrige Anlageklassen und Aktien ohne Gewinn (Kursmodell):
    Rendite = Kursveränderung k + laufender Ertrag (Carry bei Devisen, Roll-Rendite bei Rohstoffen)
    k  Basis μ; Upside/Downside eine Jahresschwankung σ darüber und darunter (ln(1 + μ) ± σ)

Keine Prognose und keine Empfehlung: jede Zahl folgt aus den genannten Annahmen.
"""
from __future__ import annotations

import datetime as dt
import math

import pandas as pd

SZENARIEN = ("d", "b", "u")                 # Downside, Basis, Upside
GRENZE = {"g": (-0.6, 1.5), "v": (-0.6, 1.0), "k": (-0.8, 2.0)}
MIN_SPANNE_G = 0.03                         # Upside/Downside mindestens 3 Prozentpunkte vom Konsens entfernt
PAUSCHAL_G = 0.05                           # ohne Spanne der Schätzungen
PAUSCHAL_V = math.log(1.15)                 # ohne ausreichende KGV-Historie: ±15 %
SIGMA_V = (0.05, 0.5)
MU_ETF = (0.0, 0.10)                        # Vergangenheitsrendite als Basis, gedeckelt
UNTEREINHEIT = {"GBp": ("GBP", 100), "GBX": ("GBP", 100), "ZAc": ("ZAR", 100), "ILA": ("ILS", 100)}


def _f(x) -> float | None:
    try:
        x = float(x)
    except (TypeError, ValueError):
        return None
    return x if math.isfinite(x) else None


def _datum(x) -> dt.date | None:
    if x is None:
        return None
    if isinstance(x, dt.datetime):
        return x.date()
    if isinstance(x, dt.date):
        return x
    try:
        return pd.Timestamp(x).date()
    except (TypeError, ValueError):
        return None


def _klemme(x: float, grenze: tuple[float, float]) -> float:
    return min(max(x, grenze[0]), grenze[1])


def _p(x: float, nk: int = 1, vz: bool = True) -> str:
    vz = vz and round(x * 100, nk) != 0   # keine „+0 %“ und „−0,0 %“
    x = x if round(x * 100, nk) != 0 else 0.0
    s = f"{x * 100:{'+' if vz else ''}.{nk}f}".replace(".", ",").replace("-", "−")
    return s + " %"


def _z(x: float, nk: int = 2) -> str:
    return f"{x:,.{nk}f}".replace(",", "§").replace(".", ",").replace("§", ".").replace("-", "−")


def _de(d: dt.date) -> str:
    return d.strftime("%d.%m.%Y")


def _monatsende(d: dt.date, monate: int) -> dt.date:
    m = d.month - 1 + monate
    j, m = d.year + m // 12, m % 12 + 1
    naechster = dt.date(j + (m == 12), m % 12 + 1, 1)
    return naechster - dt.timedelta(days=1)


def _flag(liste: list, k: str, text: str, gewicht: int) -> None:
    liste.append({"k": k, "t": text, "g": gewicht})


# ---------------------------------------------------------------- Bausteine

def ist_quartale(z: dict) -> tuple[list[dict] | None, str | None]:
    """Die letzten vier berichteten Quartale (Gewinn je Aktie). Bevorzugt die bereinigten Zahlen, auf die sich auch
    die Analystenschätzungen beziehen; sonst die Gewinn- und Verlustrechnung."""
    hist = sorted(((_datum(e.get("quartal")), _f(e.get("ist"))) for e in z.get("eps_historie") or []),
                  key=lambda x: x[0] or dt.date.min)
    hist = [(d, e) for d, e in hist if d and e is not None]
    if len(hist) >= 4:
        return [{"bis": d, "eps": e} for d, e in hist[-4:]], "berichteter Gewinn je Aktie, bereinigt wie in den Analystenschätzungen"
    q = sorted(((_datum(x.get("datum")), _f(x.get("eps"))) for x in z.get("quartale") or []), key=lambda x: x[0] or dt.date.min)
    q = [(d, e) for d, e in q if d and e is not None]
    if len(q) >= 4:
        return [{"bis": d, "eps": e} for d, e in q[-4:]], "Gewinn je Aktie laut Gewinn- und Verlustrechnung"
    return None, None


def _wachstum(z: dict, flags: list) -> tuple[dict | None, dict]:
    """Gewinnwachstum für die nächsten vier Quartale: Konsens, Spanne aus höchster und niedrigster Schätzung."""
    schaetzungen = {s.get("periode"): s for s in z.get("schaetzungen") or []}
    for periode, wort in (("Nächstes Geschäftsjahr", "das nächste Geschäftsjahr"), ("Laufendes Geschäftsjahr", "das laufende Geschäftsjahr")):
        s = schaetzungen.get(periode) or {}
        g = _f(s.get("eps_wachstum"))
        if g is None:
            continue
        m, h, t, n = _f(s.get("eps_mittel")), _f(s.get("eps_hoch")), _f(s.get("eps_tief")), _f(s.get("analysten"))
        info = {"analysten": int(n) if n else None, "periode": periode}
        g = _klemme(g, GRENZE["g"])
        if m and m > 0 and h is not None and t is not None and h >= m >= t:
            hoch, tief = max(h / m - 1, MIN_SPANNE_G), min(t / m - 1, -MIN_SPANNE_G)
            quelle = (f"Konsens für {wort}: {_p(g)}{f' ({int(n)} Analysten)' if n else ''}. Upside und Downside aus der höchsten "
                      f"({_p(h / m - 1)}) und der niedrigsten Schätzung ({_p(t / m - 1)}) gegenüber dem Mittel.")
            if h > m and t < m and (h - t) / m > 0.4:
                _flag(flags, "spanne", f"Die Gewinnschätzungen liegen weit auseinander: höchste und niedrigste trennen {_p((h - t) / m, 0, False)} "
                                       "des Mittelwerts.", 3)
        else:
            hoch, tief = PAUSCHAL_G, -PAUSCHAL_G
            quelle = f"Konsens für {wort}: {_p(g)}. Ohne Spanne der Schätzungen: Upside und Downside pauschal ±5 Prozentpunkte."
            _flag(flags, "pauschal_g", "Für das Gewinnwachstum gibt es keine Spanne der Schätzungen; Upside und Downside sind pauschal "
                                       "±5 Prozentpunkte.", 2)
        if n is not None and n < 5:
            _flag(flags, "analysten", f"Nur {int(n)} {'Analyst schätzt' if n == 1 else 'Analysten schätzen'} den Gewinn: "
                                      "der Konsens steht auf wenigen Meinungen.", 2)
        werte = {"d": _klemme((1 + g) * (1 + tief) - 1, GRENZE["g"]), "b": g, "u": _klemme((1 + g) * (1 + hoch) - 1, GRENZE["g"]), "q": quelle}
        if abs(g) > 0.4:
            _flag(flags, "wachstum", f"Sehr hohes erwartetes Gewinnwachstum ({_p(g, 0)}), oft aus einer niedrigen Ausgangsbasis: "
                                     "kleine Änderungen am Gewinn verschieben das Ergebnis stark.", 2)
        return werte, info
    g = _f(z.get("eps_wachstum_naechstes_jahr"))
    if g is not None:
        g = _klemme(g, GRENZE["g"])
        _flag(flags, "pauschal_g", "Für das Gewinnwachstum gibt es keine Spanne der Schätzungen; Upside und Downside sind pauschal "
                                   "±5 Prozentpunkte.", 2)
        return ({"d": g - PAUSCHAL_G, "b": g, "u": g + PAUSCHAL_G,
                 "q": f"Erwartetes Gewinnwachstum im nächsten Jahr: {_p(g)}. Upside und Downside pauschal ±5 Prozentpunkte."}, {})
    # Kein Konsens: Wachstum der letzten vier Quartale gegenüber den vier davor fortschreiben
    q = sorted(((_datum(x.get("datum")), _f(x.get("eps"))) for x in z.get("quartale") or []), key=lambda x: x[0] or dt.date.min)
    eps = [e for d, e in q if d and e is not None]
    if len(eps) >= 8 and sum(eps[-8:-4]) > 0:
        g = _klemme(sum(eps[-4:]) / sum(eps[-8:-4]) - 1, GRENZE["g"])
        _flag(flags, "kein_konsens", "Es gibt keinen Analysten-Konsens: das Wachstum der letzten vier Quartale wird fortgeschrieben, "
                                     "Upside und Downside sind pauschal.", 3)
        return ({"d": g - PAUSCHAL_G * 2, "b": g, "u": g + PAUSCHAL_G * 2,
                 "q": f"Kein Konsens: Gewinnwachstum der letzten vier Quartale gegenüber den vier davor ({_p(g)}) fortgeschrieben, "
                      "Upside und Downside ±10 Prozentpunkte."}, {})
    return None, {}


def _bewertung(z: dict, flags: list) -> dict:
    """KGV-Veränderung binnen vier Quartalen. Basis 0, Upside/Downside die typische Jahresveränderung des KGV
    (quadratisches Mittel der Veränderungen über je vier Quartale) in der Historie."""
    reihe = sorted(((_datum(h.get("datum")), _f(h.get("wert"))) for h in z.get("kgv_historie") or []), key=lambda x: x[0] or dt.date.min)
    werte = [w for d, w in reihe if d and w and w > 0]
    if len(werte) >= 8:
        aend = [math.log(werte[i + 4] / werte[i]) for i in range(len(werte) - 4)]
        s = _klemme(math.sqrt(sum(a * a for a in aend) / len(aend)), SIGMA_V)
        jahre = max(1, round(len(werte) / 4))
        quelle = (f"Basis: das KGV bleibt, wie es ist. Upside und Downside: so stark, wie sich das Forward-KGV in den letzten "
                  f"{jahre} Jahren binnen eines Jahres typischerweise verändert hat ({_p(math.exp(s) - 1, 0)} / {_p(math.exp(-s) - 1, 0)}).")
    else:
        s = PAUSCHAL_V
        quelle = "Basis: das KGV bleibt, wie es ist. Für Upside und Downside fehlt eine ausreichende KGV-Historie: pauschal +15 % / −13 %."
        _flag(flags, "kgv_kurz", "Die KGV-Historie ist zu kurz für eine eigene Spanne: die Bewertungsänderung ist pauschal ±15 %.", 2)
    return {"d": math.exp(-s) - 1, "b": 0.0, "u": math.exp(s) - 1, "q": quelle}


def _cagr(kurse: pd.Series | None, jahre_max: int = 10) -> tuple[float | None, float]:
    if kurse is None or len(kurse) < 2:
        return None, 0.0
    k = kurse.dropna()
    k = k[k.index >= k.index[-1] - pd.DateOffset(years=jahre_max)]
    if len(k) < 2 or k.iloc[0] <= 0:
        return None, 0.0
    jahre = (k.index[-1] - k.index[0]).days / 365.25
    if jahre < 1:
        return None, jahre
    return float((k.iloc[-1] / k.iloc[0]) ** (1 / jahre) - 1), jahre


def _gemeinsame_flags(z: dict, heute: dt.date, flags: list) -> None:
    if z.get("typ") == "aktie" and z.get("zahlen_bald") and z.get("naechste_zahlen"):
        _flag(flags, "zahlen", f"Quartalszahlen am {_de(_datum(z['naechste_zahlen']))}: danach setzt die Rechnung auf die neuen Ist-Zahlen auf, "
                               "bis dahin ist der Gewinn die unsicherste Annahme.", 2)
    v1, vm = _f(z.get("vol_1m")), _f(z.get("vol_median_1j"))
    if v1 and vm and v1 > 1.5 * vm:
        _flag(flags, "vol", f"Die Kurse schwanken gerade {_z(v1 / vm, 1)}-mal so stark wie im Jahresmittel: "
                            "die Spanne der Szenarien kann zu eng sein.", 2)


# ---------------------------------------------------------------- Modelle

def _gewinnmodell(z: dict, fx: dict, heute: dt.date, flags: list) -> dict | None:
    quartale, quelle_ist = ist_quartale(z)
    if not quartale:
        return None
    wae = z.get("waehrung") or ""
    fin = z.get("finanzwaehrung") or wae
    umrechnung = 1.0
    if fin and wae and fin != wae:
        teil = UNTEREINHEIT.get(wae)            # z. B. Kurs in Pence (GBp), Gewinn in Pfund
        a = _f((fx or {}).get(fin))
        b = _f((fx or {}).get(teil[0])) / teil[1] if teil and _f((fx or {}).get(teil[0])) else _f((fx or {}).get(wae))
        if teil and teil[0] == fin:
            a, b = 1.0, 1.0 / teil[1]
        if not a or not b:
            _flag(flags, "fx_fehlt", f"Für die Umrechnung der Gewinne von {fin} in {wae} fehlt ein Wechselkurs: "
                                     "die Szenarien rechnen nur mit der Kursschwankung.", 3)
            return None
        umrechnung = a / b
        if not (UNTEREINHEIT.get(wae) or ("",))[0] == fin:
            _flag(flags, "waehrung", f"Gewinne werden in {fin} berichtet, der Kurs notiert in {wae}: umgerechnet zum aktuellen Wechselkurs, "
                                     "Wechselkursänderungen sind nicht eingerechnet.", 1)
    e0 = sum(q["eps"] for q in quartale) * umrechnung
    if e0 <= 0:
        _flag(flags, "verlust", "In den letzten vier Quartalen stand unter dem Strich ein Verlust: ohne positive Gewinnbasis "
                                "rechnen die Szenarien nur mit der Kursschwankung.", 3)
        return None
    g, info = _wachstum(z, flags)
    if g is None:
        return None
    kurs = _f(z.get("kurs"))
    letzte = quartale[-1]["bis"]
    if (letzte - quartale[0]["bis"]).days > 300:
        _flag(flags, "luecke", "Die letzten vier berichteten Quartale sind nicht lückenlos: der Ist-Gewinn ist eine Näherung.", 2)
    if (heute - letzte).days > 150:
        _flag(flags, "ist_alt", f"Die letzten Ist-Zahlen reichen nur bis {_de(letzte)}, das ist über fünf Monate her.", 2)
    v = _bewertung(z, flags)
    div = _f((z.get("multiples") or {}).get("dividendenrendite"))
    div = _klemme(div, (0.0, 0.15)) if div is not None else 0.0
    prognose = [_monatsende(letzte, 3 * k) for k in range(1, 5)]
    # Gegenprobe: das erste Prognosequartal gegen den Konsens fürs laufende Quartal
    konsens = None
    q0 = next((s for s in z.get("schaetzungen") or [] if s.get("periode") == "Laufendes Quartal"), None)
    if q0 and _f(q0.get("eps_mittel")) and q0["eps_mittel"] > 0:
        konsens = {"eps": q0["eps_mittel"] * umrechnung, "n": int(q0["analysten"]) if _f(q0.get("analysten")) else None}
        basis_q1 = quartale[0]["eps"] * umrechnung * (1 + g["b"])
        abw = basis_q1 / konsens["eps"] - 1
        if abs(abw) > 0.15 and quartale[0]["eps"] > 0:
            _flag(flags, "konsens_q", f"Fürs laufende Quartal rechnet die Basis {_p(abw, 0)} {'über' if abw > 0 else 'unter'} dem Konsens "
                                      f"({_z(basis_q1)} statt {_z(konsens['eps'])} {wae}): die Hochrechnung aus dem Vorjahresquartal "
                                      "trifft Sondereffekte nicht.", 1)
    fkgv, med = _f(z.get("forward_kgv")), _f(z.get("forward_kgv_median_5j"))
    return {
        "m": "gewinn",
        "anker": {"bis": letzte.isoformat(), "eps": e0, "kgv": kurs / e0 if kurs else None, "fin": fin,
                  "umgerechnet": fin != wae, "q": quelle_ist},
        "quartale": [{"bis": q["bis"].isoformat(), "eps": q["eps"] * umrechnung} for q in quartale],
        "prognose": [d.isoformat() for d in prognose],
        "konsens_q": konsens,
        "t": {"g": g, "v": v,
              "div": {"b": div, "q": f"Dividendenrendite der letzten zwölf Monate: {_p(div, 1, False)}, in allen Szenarien gleich."
                      if div else "Keine Dividende gemeldet."}},
        "bew": {"kgv": fkgv, "median": med} if fkgv and med else None,
        "analysten": info.get("analysten"),
    }


def _kursmodell(z: dict, kurse: pd.Series | None, flags: list) -> dict | None:
    sigma = _f(z.get("volatilitaet"))
    if not sigma:
        return None
    typ = z.get("typ")
    ertrag = None
    if typ == "forex":
        mu, q_mu = 0.0, "Basis: Wechselkurse folgen keinem verlässlichen Trend, die Basis nimmt den heutigen Kurs an."
        c = _f(z.get("zinsdifferenz"))
        if c is not None:
            ertrag = {"b": c, "n": "Carry", "q": f"Zinsvorsprung der Basiswährung: {_p(c, 2)} pro Jahr. Eine gehebelte Long-Position "
                                                    f"{'erhält' if c >= 0 else 'bezahlt'} ihn, in allen Szenarien gleich."}
    elif typ == "rohstoff":
        mu, q_mu = 0.0, "Basis: der Front-Month-Kurs bleibt, wie er ist; Rohstoffpreise haben auf ein Jahr keinen verlässlichen Trend."
        r = _f((z.get("kz") or {}).get("roll_rendite"))
        if r is not None:
            ertrag = {"b": r, "n": "Roll-Rendite", "q": f"Roll-Rendite aus der Terminkurve: {_p(r, 1)} pro Jahr "
                                                        f"({'Backwardation' if r >= 0 else 'Contango'}), in allen Szenarien gleich."}
    elif typ in ("etf", "index"):
        cagr, jahre = _cagr(kurse)
        if cagr is None:
            mu, q_mu = 0.0, "Basis: zu kurze Kurshistorie für eine Durchschnittsrendite, angenommen wird ein unveränderter Kurs."
            _flag(flags, "cagr", "Die Kurshistorie ist zu kurz für eine Durchschnittsrendite: die Basis nimmt einen unveränderten Kurs an.", 2)
        else:
            mu = _klemme(cagr, MU_ETF)
            q_mu = (f"Basis: Durchschnittsrendite der letzten {_z(jahre, 0)} Jahre ({_p(cagr)} pro Jahr)"
                    + (f", gedeckelt auf {_p(mu, 0)}" if mu != cagr else "") + ". Vergangene Renditen sind keine Zusage für die Zukunft.")
            if jahre < 5:
                _flag(flags, "cagr", f"Die Durchschnittsrendite stützt sich auf nur {_z(jahre, 1)} Jahre Kurshistorie.", 2)
            elif mu != cagr:
                _flag(flags, "cagr", f"Die Durchschnittsrendite der Vergangenheit ({_p(cagr, 1)}) ist für die Basis auf {_p(mu, 0)} gedeckelt.", 1)
    else:
        mu, q_mu = 0.0, "Basis: ohne positive Gewinnbasis nimmt die Rechnung einen unveränderten Kurs an."
    lm = math.log(1 + mu)
    k = {"d": math.exp(lm - sigma) - 1, "b": mu, "u": math.exp(lm + sigma) - 1,
         "q": f"{q_mu} Upside und Downside: eine Jahresschwankung (Volatilität {_p(sigma, 0, False)}) darüber und darunter; "
              "bei normal verteilten Renditen liegen etwa zwei von drei Jahren in dieser Spanne."}
    t = {"k": k}
    if ertrag:
        t["e"] = ertrag
    return {"m": "kurs", "sigma": sigma, "t": t}


# ---------------------------------------------------------------- Öffentlich

def treiber(z: dict, kurse: pd.Series | None, heute: dt.date, fx: dict | None = None) -> dict | None:
    """Standardannahmen, Ist-Anker, Prognosequartale und Unsicherheiten eines Werts (für Browser und E-Mail)."""
    kurs = _f(z.get("kurs"))
    if not kurs or kurs <= 0:
        return None
    flags: list[dict] = []
    sz = _gewinnmodell(z, fx or {}, heute, flags) if z.get("typ") == "aktie" else None
    if sz is None:
        if z.get("typ") == "aktie" and not any(f["k"] in ("verlust", "fx_fehlt") for f in flags):
            _flag(flags, "ohne_gewinn", "Für diese Aktie fehlen berichtete Quartalsgewinne: die Szenarien rechnen nur mit der Kursschwankung.", 3)
        sz = _kursmodell(z, kurse, flags)
        if sz is None:
            return None
        sz["prognose"] = [(heute + dt.timedelta(days=round(91.3 * k))).isoformat() for k in range(1, 5)]
    _gemeinsame_flags(z, heute, flags)
    termin = _datum(z.get("naechste_zahlen")) if z.get("typ") == "aktie" else None
    sz |= {"kurs": kurs, "waehrung": z.get("waehrung") or "", "dez": z.get("dezimalen") or 2,
           "stand": (_datum(z.get("kurs_datum")) or heute).isoformat(),
           "termin": termin.isoformat() if termin and termin >= heute else None,
           "f": sorted(flags, key=lambda f: -f["g"])}
    return _runden(sz)


def _runden(x):
    if isinstance(x, float):
        return round(x, 6) + 0.0   # + 0.0 macht aus −0.0 eine 0
    if isinstance(x, dict):
        return {k: _runden(v) for k, v in x.items()}
    if isinstance(x, list):
        return [_runden(v) for v in x]
    return x


def werte(sz: dict, eigene: dict | None = None) -> dict:
    """Annahmen je Szenario, eigene Änderungen ({treiber: {szenario: wert}}) haben Vorrang."""
    eigene = eigene or {}
    aus = {}
    for name, t in sz["t"].items():
        e = eigene.get(name) or {}
        if "d" in t:
            aus[name] = {s: e.get(s, t[s]) for s in SZENARIEN}
        else:
            b = e.get("b", t["b"])
            aus[name] = {s: b for s in SZENARIEN}
    return aus


def ergebnis(sz: dict, eigene: dict | None = None, kurs: float | None = None) -> dict:
    """Kursfaktor, Kurs und Rendite je Szenario. Gleiche Formel wie rechne() in assets/szenario-kern.js."""
    w = werte(sz, eigene)
    p0 = kurs or sz["kurs"]
    aus = {}
    for s in SZENARIEN:
        if sz["m"] == "gewinn":
            faktor = (1 + w["g"][s]) * (1 + w["v"][s])
            rendite = faktor - 1 + w["div"][s]
        else:
            faktor = 1 + w["k"][s]
            rendite = faktor - 1 + (w["e"][s] if "e" in w else 0.0)
        aus[s] = {"faktor": faktor, "kurs": p0 * faktor, "rendite": rendite}
    return aus


def zeile(sz: dict | None) -> str | None:
    """Kurzfassung für die E-Mail: „Szenarien für vier Quartale: Downside −8 %, Basis +13 %, Upside +34 %“."""
    if not sz:
        return None
    e = ergebnis(sz)
    return "Szenarien für vier Quartale: " + ", ".join(f"{n} {_p(e[s]['rendite'], 0)}" for s, n in zip(SZENARIEN, ("Downside", "Basis", "Upside")))
