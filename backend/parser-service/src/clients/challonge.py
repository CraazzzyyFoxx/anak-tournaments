"""Process-global Challonge API client for parser-service.

``shared.clients.challonge.ChallongeClient`` holds a persistent connection
pool for the process lifetime ("one instance per service" per its own
docstring) — this is that one instance, configured with parser-service's own
settings. Lives under ``src/clients/`` (not ``src/services/``) so both
transport (``rpc/``) and service code can import it without a service
reaching into the transport layer or vice versa.
"""

from __future__ import annotations

from shared.clients.challonge import ChallongeClient
from src.core import config

__all__ = ("challonge_client",)

challonge_client = ChallongeClient.from_settings(config.settings)
