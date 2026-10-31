"""Gemeinsame Test-Einstellungen.

Die Tests laufen unabhängig von der Umgebung, in der pytest gestartet wird: Der Staging-Workflow setzt
FATHOM_UMGEBUNG=staging für den ganzen Job, und das darf Tests, die das Verhalten von Production prüfen (z. B. den
Mailversand mit einem Test-Server), nicht verändern. Tests, die Staging prüfen, setzen die Variable selbst.
"""
import pytest


@pytest.fixture(autouse=True)
def _umgebung_neutral(monkeypatch):
    monkeypatch.delenv("FATHOM_UMGEBUNG", raising=False)
