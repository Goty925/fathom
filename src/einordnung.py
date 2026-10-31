"""Automatische, datenbasierte Einordnung: was dafür und was dagegen spricht.

Das sind feste Regeln auf den Kennzahlen, keine Meinung und keine Empfehlung.
Jede Aussage nennt die Zahl, auf der sie beruht.
"""
from __future__ import annotations


def _p(x: float, vorzeichen: bool = True) -> str:
    s = f"{x * 100:{'+' if vorzeichen else ''}.0f} %"
    return s.replace("-", "−")


def _de(x: float) -> str:
    return f"{x:.1f}".replace(".", ",")


def einordnen(z: dict, zahlen_warnung_tage: int) -> dict[str, list[str]]:
    dafuer, dagegen = [], []

    u, g = z.get("umsatzwachstum"), z.get("gewinnwachstum")
    if u is not None and u >= 0.08:
        dafuer.append(f"Umsatz im letzten Quartal {_p(u)} gegenüber dem Vorjahr.")
    elif u is not None and u < 0.02:
        dagegen.append(f"Umsatz wächst kaum oder schrumpft ({_p(u)} gegenüber dem Vorjahr).")
    if g is not None and g < 0:
        dagegen.append(f"Gewinn im letzten Quartal geschrumpft ({_p(g)}).")
    elif g is not None and g >= 0.10:
        dafuer.append(f"Gewinn im letzten Quartal {_p(g)} gegenüber dem Vorjahr.")

    fkgv, med = z.get("forward_kgv"), z.get("forward_kgv_median_5j")
    if fkgv and med:
        rel = fkgv / med - 1
        if rel <= -0.15:
            dafuer.append(f"Forward-KGV {_de(fkgv)} liegt {_p(-rel, False)} unter dem eigenen 5-Jahres-Median ({_de(med)}).")
        elif rel >= 0.15:
            dagegen.append(f"Forward-KGV {_de(fkgv)} liegt {_p(rel, False)} über dem eigenen 5-Jahres-Median ({_de(med)}).")

    ziel = z.get("kursziel_abstand")
    if ziel is not None:
        if ziel >= 0.15:
            dafuer.append(f"Durchschnittliches Analysten-Kursziel {_p(ziel)} über dem aktuellen Kurs.")
        elif ziel < 0:
            dagegen.append(f"Kurs liegt bereits über dem durchschnittlichen Kursziel ({_p(ziel)}).")

    for s in z.get("schaetzungen", []):
        if s["periode"] != "Nächstes Geschäftsjahr":
            continue
        hoch, runter = s.get("hoch_30") or 0, s.get("runter_30") or 0
        if hoch + runter:
            if hoch > runter:
                dafuer.append(f"Gewinnschätzungen fürs nächste Geschäftsjahr in 30 Tagen {int(hoch)}× angehoben, {int(runter)}× gesenkt.")
            elif runter > hoch:
                dagegen.append(f"Gewinnschätzungen fürs nächste Geschäftsjahr in 30 Tagen {int(runter)}× gesenkt, {int(hoch)}× angehoben.")
        alt, neu = s.get("eps_vor_90_tagen"), s.get("eps_mittel")
        if alt and neu and alt > 0:
            d = neu / alt - 1
            if d <= -0.03:
                dagegen.append(f"Gewinnerwartung fürs nächste Geschäftsjahr seit 90 Tagen {_p(d)}.")
            elif d >= 0.03:
                dafuer.append(f"Gewinnerwartung fürs nächste Geschäftsjahr seit 90 Tagen {_p(d)}.")

    hist = [e for e in z.get("eps_historie", []) if e.get("ueberraschung") is not None]
    if len(hist) >= 3:
        positiv = sum(e["ueberraschung"] > 0 for e in hist)
        if positiv == len(hist):
            dafuer.append(f"Gewinn je Aktie lag in allen letzten {len(hist)} Quartalen über der Erwartung.")
        elif positiv <= len(hist) / 2:
            dagegen.append(f"Erwartungen nur in {positiv} von {len(hist)} Quartalen übertroffen.")

    gd = z.get("abstand_gd200")
    if gd is not None:
        if gd < -0.05:
            dagegen.append(f"Kurs {_p(-gd, False)} unter der 200-Tage-Linie: Der Abwärtstrend ist nicht gebrochen.")
        elif gd > 0.05:
            dafuer.append(f"Kurs {_p(gd, False)} über der 200-Tage-Linie.")

    rsi = z.get("rsi14")
    if rsi is not None and rsi < 30:
        dafuer.append(f"RSI {rsi:.0f}: kurzfristig überverkauft, Gegenbewegungen sind häufig.")
    elif rsi is not None and rsi > 70:
        dagegen.append(f"RSI {rsi:.0f}: kurzfristig überkauft.")

    vola = z.get("volatilitaet")
    if vola is not None and vola >= 0.40:
        dagegen.append(f"Hohe Schwankung ({_p(vola, False)} pro Jahr), für Hebelprodukte besonders riskant.")

    if z.get("zahlen_bald") and z.get("naechste_zahlen"):
        dagegen.append(f"Quartalszahlen am {z['naechste_zahlen'].strftime('%d.%m.%Y')}: Kurslücken in beide Richtungen möglich.")

    return {"dafuer": dafuer, "dagegen": dagegen}
