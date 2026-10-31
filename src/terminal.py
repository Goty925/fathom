"""Fundamentals-Terminal nach dem Vorbild von TIKR und Koyfin.

- jahreswerte:   bis zu 10 Geschäftsjahre Umsatz, Margen, Gewinn, EPS, freier Cashflow
- multiples:     historische Bewertung je Geschäftsjahr (KGV, KUV, EV/EBITDA, FCF-Rendite)
- peer_vergleich: Vergleich mit anderen Werten derselben Branche auf der Watchlist

Quellen: Eulerpool-Bewertungshistorie (falls vorhanden) und Jahresabschlüsse über Yahoo als Rückfall.
Alle Multiples werden in der Berichtswährung gerechnet (Kurs wird bei Bedarf umgerechnet).
"""
from __future__ import annotations

import statistics


def _q(a, b):
    return a / b if a is not None and b not in (None, 0) else None


def jahreswerte(z: dict) -> list[dict]:
    jahre = {j["jahr"]: dict(j) for j in z.get("jahreszahlen") or []}
    ep = z.get("eulerpool_bewertung") or {}
    reihen = {"umsatz": ep.get("umsatz") or {}, "nettogewinn": ep.get("gewinn") or {}, "ebit": ep.get("ebit") or {}}
    # Eulerpool liefert Beträge teils in Millionen: an den Yahoo-Werten oder der Größenordnung erkennen
    for feld, reihe in reihen.items():
        if not reihe:
            continue
        faktor = 1.0
        if max(abs(v) for v in reihe.values()) < 1e7:
            faktor = 1e6
        for jahr, wert in reihe.items():
            jahre.setdefault(jahr, {"jahr": jahr})
            if jahre[jahr].get(feld) is None:
                jahre[jahr][feld] = wert * faktor
    zeilen = []
    for jahr in sorted(jahre)[-10:]:
        j = jahre[jahr]
        vor = jahre.get(jahr - 1, {})
        zeilen.append(j | {
            "umsatz_wachstum": _q(j.get("umsatz"), vor.get("umsatz")) - 1 if _q(j.get("umsatz"), vor.get("umsatz")) else None,
            "bruttomarge": _q(j.get("bruttogewinn"), j.get("umsatz")),
            "ebit_marge": _q(j.get("ebit"), j.get("umsatz")),
            "netto_marge": _q(j.get("nettogewinn"), j.get("umsatz")),
            "fcf_marge": _q(j.get("fcf"), j.get("umsatz")),
        })
    return zeilen


def multiples(z: dict, kurse, fx: dict) -> list[dict]:
    """Bewertung je Geschäftsjahr zum Kurs am Jahresende, dazu die aktuelle Bewertung (TTM-nah)."""
    import pandas as pd
    ep = (z.get("eulerpool_bewertung") or {}).get("multiples") or {}
    w, fw = z.get("waehrung"), z.get("finanzwaehrung") or z.get("waehrung")
    umrechnung = (fx.get(w) / fx.get(fw)) if w != fw and fx.get(w) and fx.get(fw) else 1.0
    aktien_heute = z.get("aktien_anzahl")
    zeilen = []
    for j in z.get("jahreswerte") or []:
        e = ep.get(j["jahr"], {})
        preis = None
        if kurse is not None and len(kurse) and j.get("ende"):
            vorher = kurse[kurse.index <= pd.Timestamp(j["ende"])]
            preis = float(vorher.iloc[-1]) * umrechnung if len(vorher) else None
        aktien = j.get("aktien") or aktien_heute
        mcap = preis * aktien if preis and aktien else None
        ev = mcap + (j.get("schulden") or 0) - (j.get("cash") or 0) if mcap else None
        zeilen.append({
            "jahr": j["jahr"],
            "kgv": e.get("kgv") or (_q(preis, j.get("eps")) if (j.get("eps") or 0) > 0 else None),
            "kuv": e.get("kuv") or _q(mcap, j.get("umsatz")),
            "ev_ebitda": _q(ev, j.get("ebitda")) if (j.get("ebitda") or 0) > 0 else None,
            "fcf_rendite": _q(j.get("fcf"), mcap),
        })
    for jahr, e in sorted(ep.items()):  # Jahre, die nur Eulerpool kennt
        if not any(r["jahr"] == jahr for r in zeilen):
            zeilen.append({"jahr": jahr, "kgv": e.get("kgv"), "kuv": e.get("kuv"), "ev_ebitda": None, "fcf_rendite": None})
    zeilen.sort(key=lambda r: r["jahr"])
    return [r for r in zeilen if any(r[k] is not None for k in ("kgv", "kuv", "ev_ebitda", "fcf_rendite"))][-10:]


PEER_FELDER = ("boersenwert_eur", "forward_kgv", "ev_ebitda", "umsatzwachstum", "bruttomarge", "operative_marge",
               "fcf_rendite", "eigenkapitalrendite", "abstand_hoch")


def peer_zeile(z: dict) -> dict:
    b, m = z.get("bilanz") or {}, z.get("multiples") or {}
    return {
        "name": z["name"], "symbol": z["symbol"], "punkte": z.get("punkte"),
        "boersenwert_eur": z.get("boersenwert_eur"), "forward_kgv": z.get("forward_kgv"), "ev_ebitda": m.get("ev_ebitda"),
        "umsatzwachstum": z.get("umsatzwachstum"), "bruttomarge": b.get("bruttomarge"), "operative_marge": b.get("operative_marge"),
        "fcf_rendite": _q(b.get("freier_cashflow"), z.get("boersenwert")) if b.get("freier_cashflow") else None,
        "eigenkapitalrendite": b.get("eigenkapitalrendite"), "abstand_hoch": z.get("abstand_hoch"),
    }


def peer_vergleich(aktien: list[dict]) -> None:
    """Je Aktie: Vergleichsgruppe = Werte derselben Branche (sonst desselben Sektors) auf der Watchlist."""
    for a in aktien:
        p = a.get("profil") or {}
        gleich = [x for x in aktien if x is not a and p.get("branche") and (x.get("profil") or {}).get("branche") == p["branche"]]
        if len(gleich) < 2:
            gleich = [x for x in aktien if x is not a and p.get("sektor") and (x.get("profil") or {}).get("sektor") == p["sektor"]]
        zeilen = [peer_zeile(a) | {"selbst": True}] + [peer_zeile(x) for x in gleich]
        median = {}
        for f in PEER_FELDER:
            werte = [r[f] for r in zeilen if r.get(f) is not None]
            median[f] = statistics.median(werte) if len(werte) >= 2 else None
        bekannte = {x["name"].lower() for x in aktien}
        a["peers_tabelle"] = {"zeilen": zeilen, "median": median, "gruppe": p.get("branche") if len(gleich) >= 2 or not p.get("sektor") else p.get("sektor"),
                              "weitere": [q for q in a.get("peers") or [] if (q.get("name") or "").lower() not in bekannte][:8]}
