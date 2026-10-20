"""Challonge API v1 client for tournament-service.

One constructed ``shared.clients.challonge.ChallongeClient`` for this service's
settings, and nothing else. Callers import the instance and call its bound
methods.
"""

from __future__ import annotations

from shared.clients.challonge import ChallongeClient
from src.core import config

__all__ = ("challonge_client",)

challonge_client = ChallongeClient.from_settings(config.settings)
