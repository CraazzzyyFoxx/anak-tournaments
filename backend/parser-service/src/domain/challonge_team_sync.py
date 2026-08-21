"""Pure Challonge <-> team-roster reconciliation logic (name normalization,
suggestion indexing, mapping validation, roster placement, balancer-payload
shaping). Zero session, zero await, zero asyncio — see ``backend/ARCHITECTURE.md``'s
``domain/`` boundary. DB access and orchestration around these stay in
``src.services.team.flows``.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from shared.services.team_export import MaterializationMember, MaterializationTeam
from src import models, schemas

__all__ = (
    "_ChallongeParticipantRow",
    "_ParticipantFetchPlan",
    "_ParticipantGroupContext",
    "_build_team_suggestion_index",
    "_effective_challonge_id",
    "_suggest_team_id",
    "_to_materialization_teams",
    "_validate_challonge_team_mappings",
    "normalize_challonge_team_name",
    "resolve_team_placement",
)


def resolve_team_placement(team: models.Team) -> int | None:
    standings = getattr(team, "standings", None) or []
    positive_positions = [
        standing.overall_position for standing in standings if getattr(standing, "overall_position", 0) > 0
    ]
    if positive_positions:
        return min(positive_positions)
    return None


def _to_materialization_teams(payload: list[schemas.BalancerTeam]) -> list[MaterializationTeam]:
    """``BalancerTeam`` -> shared writer input.

    ``BalancerTeam.name`` is both the stored ``balancer_name`` and, by
    convention, the captain's battle tag; each member's ``name`` is their own tag.
    """
    return [
        MaterializationTeam(
            balancer_name=team_data.name,
            members=tuple(
                MaterializationMember(
                    name=member.name,
                    rank=member.rank,
                    slot_code=member.role,
                    sub_role=member.sub_role,
                )
                for member in team_data.members
            ),
        )
        for team_data in payload
    ]


_TEAM_WORD_RE = re.compile(r"\bteam\b", flags=re.IGNORECASE)
_WHITESPACE_RE = re.compile(r"\s+")


@dataclass(frozen=True)
class _ChallongeParticipantRow:
    participant_id: int
    challonge_id: int
    source_id: int | None
    group_id: int | None
    group_name: str | None
    challonge_tournament_id: int
    name: str
    active: bool


def normalize_challonge_team_name(name: str) -> str:
    normalized = name.split("#", 1)[0]
    normalized = _TEAM_WORD_RE.sub("", normalized)
    normalized = _WHITESPACE_RE.sub(" ", normalized)
    return normalized.strip().casefold()


def _effective_challonge_id(
    participant: schemas.ChallongeParticipant,
    *,
    is_playoff: bool,
) -> int:
    if is_playoff and participant.group_player_ids:
        return participant.group_player_ids[0]
    return participant.id


def _build_team_suggestion_index(
    teams: list[models.Team],
) -> dict[str, int]:
    candidates: dict[str, set[int]] = {}
    for team in teams:
        for name in {team.name, team.balancer_name}:
            if not name:
                continue
            normalized = normalize_challonge_team_name(name)
            if not normalized:
                continue
            candidates.setdefault(normalized, set()).add(team.id)

    return {normalized: next(iter(team_ids)) for normalized, team_ids in candidates.items() if len(team_ids) == 1}


def _suggest_team_id(
    participant_name: str,
    team_suggestion_index: dict[str, int],
) -> int | None:
    return team_suggestion_index.get(normalize_challonge_team_name(participant_name))


@dataclass(frozen=True)
class _ParticipantGroupContext:
    group_id: int | None
    group_name: str | None
    is_playoff: bool


@dataclass(frozen=True)
class _ParticipantFetchPlan:
    challonge_tournament_id: int
    source_id: int | None
    group_contexts: tuple[_ParticipantGroupContext, ...]


def _validate_challonge_team_mappings(
    mappings: list[schemas.ChallongeTeamMapping],
    rows_by_request_key: dict[tuple[int, int | None], _ChallongeParticipantRow],
    team_ids: set[int],
) -> list[str]:
    errors_out: list[str] = []
    seen: set[tuple[int, int | None]] = set()

    for mapping in mappings:
        key = (mapping.participant_id, mapping.group_id)
        if key in seen:
            errors_out.append(
                f"Duplicate mapping for participant {mapping.participant_id} in group {mapping.group_id}."
            )
            continue
        seen.add(key)

        if key not in rows_by_request_key:
            errors_out.append(
                f"Challonge participant {mapping.participant_id} in group {mapping.group_id} was not found."
            )
        if mapping.team_id not in team_ids:
            errors_out.append(f"Team {mapping.team_id} does not belong to this tournament.")

    return errors_out
