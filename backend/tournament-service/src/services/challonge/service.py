"""Challonge API v1 client for tournament-service.

Thin re-export of ``shared.clients.challonge.ChallongeClient`` — this used to
be a standalone ~150-line copy, byte-identical to parser-service's except for
the slug-validation fix (now the single canonical implementation).
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
