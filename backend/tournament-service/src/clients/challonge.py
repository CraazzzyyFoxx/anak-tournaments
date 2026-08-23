"""Challonge API v1 client for tournament-service.

One constructed ``shared.clients.challonge.ChallongeClient`` for this service's
settings, and nothing else. This replaced
``services/challonge/service.py``, which rebound each client method to a
module-level name (``fetch_tournament = _client.fetch_tournament``, six of
them) — the shape ``backend/ARCHITECTURE.md`` names as the trap for this exact
file: it read like a ``service.py`` while holding no orchestration and no
session, and cost an ``__all__`` entry by hand every time the wrapped client
grew a method. Callers import the instance and call its real bound methods.
"""

from __future__ import annotations

from shared.clients.challonge import ChallongeClient
from src.core import config

__all__ = ("challonge_client",)

challonge_client = ChallongeClient.from_settings(config.settings)
