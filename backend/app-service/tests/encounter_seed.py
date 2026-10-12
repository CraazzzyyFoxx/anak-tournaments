"""Seed an encounter with its participations for the real-Postgres read-model suites.

An encounter seats ``slot_count`` participations (``encounter.team``); its result
is the ``score`` / ``placement`` those rows carry, so a test states the series
score per team and the placements follow (competition ranking, equal scores
share a place).
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from shared.core import enums
from shared.models.encounter import Encounter, EncounterTeam, ScoringRule
from shared.models.tournament import Team, Tournament
from shared.models.tournament.bracket_encounter import BracketEncounter

WINS_END = "games >= best_of or max_wins * 2 > best_of"


async def seed_scoring_rule(session: Any, workspace_id: int) -> int:
    rule = ScoringRule(workspace_id=workspace_id, preset="wins", game_formula="win", end_formula=WINS_END)
    session.add(rule)
    await session.flush()
    return rule.id


async def seed_encounter(
    session: Any,
    tournament: Tournament,
    scoring_rule_id: int,
    seats: Sequence[tuple[Team | None, float]],
    *,
    name: str,
    completed: bool = True,
    round_: int | None = 1,
    **columns: Any,
) -> Encounter:
    """One encounter, one active participation per ``(team, score)`` in slot order.

    ``completed`` writes the confirmed result (admin source, placements from the
    scores); otherwise the encounter is open and nobody has a place yet.
    """
    encounter = Encounter(
        workspace_id=tournament.workspace_id,
        discipline=tournament.discipline,
        tournament_id=tournament.id,
        scoring_rule_id=scoring_rule_id,
        name=name,
        slot_count=len(seats),
        status=enums.EncounterStatus.COMPLETED if completed else enums.EncounterStatus.OPEN,
        result_status=enums.EncounterResultStatus.CONFIRMED if completed else enums.EncounterResultStatus.NONE,
        result_source="admin" if completed else None,
        **columns,
    )
    session.add(encounter)
    await session.flush()
    if round_ is not None:
        session.add(BracketEncounter(encounter_id=encounter.id, tournament_id=tournament.id, round=round_))
    scores = [score for _team, score in seats]
    for slot, (team, score) in enumerate(seats, 1):
        session.add(
            EncounterTeam(
                encounter_id=encounter.id,
                tournament_id=tournament.id,
                slot=slot,
                team_id=team.id if team is not None else None,
                name=team.name if team is not None else f"Seat {slot}",
                score=score,
                placement=1 + sum(1 for other in scores if other > score) if completed else None,
            )
        )
    await session.flush()
    return encounter
