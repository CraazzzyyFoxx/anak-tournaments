"""Challonge API v1 client for parser-service.

Thin re-export of ``shared.clients.challonge.ChallongeClient`` — this used to
be a standalone ~120-line copy, byte-identical to tournament-service's except
that it was missing the slug-validation fix on ``fetch_tournament`` (now the
single canonical implementation, patched once).
"""

from __future__ import annotations

from shared.clients.challonge import ChallongeClient
from src.core import config

__all__ = (
    "fetch_tournament",
    "fetch_participants",
    "fetch_matches",
    "update_match",
    "create_participant",
    "update_tournament_state",
)

_client = ChallongeClient.from_settings(config.settings)

fetch_tournament = _client.fetch_tournament
fetch_participants = _client.fetch_participants
fetch_matches = _client.fetch_matches
update_match = _client.update_match
create_participant = _client.create_participant
update_tournament_state = _client.update_tournament_state
