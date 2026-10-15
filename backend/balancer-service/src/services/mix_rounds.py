"""One recorded mix round, written onto the encounter layer in the caller's transaction (D75).

An encounter owned by the mix (2 slots, Bo1), two participations with the roster snapshot of the selected
variant, one confirmed game, a ``host`` result through the single result writer (one journal row, actor = the
recorder), and the balancer's ``custom_game_round``/``custom_game_round_member`` rows. No tournament event, outbox, standings or
achievement is raised: nothing listens for a mix. A draw is 0:0.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy.ext.asyncio import AsyncSession

from shared import models
from shared.core.enums import (
    EncounterGameResultSource,
    EncounterGameState,
    EncounterResultAuditAction,
    EncounterResultSource,
    EncounterStatus,
)
from shared.disciplines import discipline
from shared.domain.encounter_scoring import GameLine, compile_rules, evaluate_encounter
from shared.domain.roster_shape import FLEX_SLOT_CODE
from shared.repository import (
    CustomGameRoundRepository,
    EncounterGameRepository,
    EncounterGameTeamRepository,
    EncounterRepository,
    ScoringRuleRepository,
)
from shared.services.encounter.participants import MemberSnapshot, place_team
from shared.services.encounter.result import apply_result

__all__ = ("MixRoundDraft", "MixRoundSeat", "record_mix_round")

_encounters = EncounterRepository()
_games = EncounterGameRepository()
_game_teams = EncounterGameTeamRepository()
_rules = ScoringRuleRepository()
_rounds = CustomGameRoundRepository()
#: Game score per slot for winner slot 1, 2 and a draw.
_SCORES = {1: (1, 0), 2: (0, 1), None: (0, 0)}


@dataclass(frozen=True, slots=True)
class MixRoundSeat:
    workspace_member_id: int
    display_name: str
    #: Roster slot code (tank / damage / support / flex); ``None`` for a seat balanced without a role.
    role: str | None
    rank: int
    rank_delta_applied: int | None = None


@dataclass(frozen=True, slots=True)
class MixRoundDraft:
    custom_game_id: int
    workspace_id: int
    discipline: str
    scoring_rule_id: int
    lobby_index: int
    map_id: int | None
    #: Slot 1 and slot 2 (team index 0 and 1 of the variant).
    names: tuple[str, str]
    seats: tuple[tuple[MixRoundSeat, ...], tuple[MixRoundSeat, ...]]
    winner_slot: int | None
    points_per_win_applied: int | None
    #: Members on the floor of another lobby; a member also seated here counts as seated.
    busy: frozenset[int]
    #: ``players.user`` id of the recorder (the journal's actor); ``None`` for an account with no player.
    recorder_player_id: int | None


async def record_mix_round(session: AsyncSession, draft: MixRoundDraft) -> models.Encounter:
    encounter = await _encounters.create(
        session,
        models.Encounter(
            workspace_id=draft.workspace_id,
            discipline=draft.discipline,
            tournament_id=None,
            custom_game_id=draft.custom_game_id,
            scoring_rule_id=draft.scoring_rule_id,
            name=f"{draft.names[0]} vs {draft.names[1]}",
            slot_count=2,
            best_of=1,
            status=EncounterStatus.OPEN,
        ),
    )
    participations: list[models.EncounterTeam] = []
    dimension = discipline(draft.discipline).rated_dimension.code
    for slot, (name, team) in enumerate(zip(draft.names, draft.seats, strict=True), start=1):
        participations.append(
            await place_team(
                session,
                encounter,
                slot=slot,
                team_id=None,
                name=name,
                seed=None,
                members=[
                    MemberSnapshot(
                        workspace_member_id=seat.workspace_member_id,
                        display_name=seat.display_name,
                        rank=seat.rank,
                        is_substitute=False,
                        roles=((dimension, seat.role),) if seat.role and seat.role != FLEX_SLOT_CODE else (),
                    )
                    for seat in team
                ],
            )
        )
    scores = _SCORES[draft.winner_slot]
    game = await _games.create(
        session,
        models.EncounterGame(
            encounter_id=encounter.id,
            position=1,
            map_id=draft.map_id,
            state=EncounterGameState.CONFIRMED,
            result_source=EncounterGameResultSource.HOST,
            result_version=1,
            confirmed_at=datetime.now(UTC),
        ),
    )
    await _game_teams.create_many(
        session,
        [
            models.EncounterGameTeam(game_id=game.id, encounter_id=encounter.id, encounter_team_id=team.id, score=score)
            for team, score in zip(participations, scores, strict=True)
        ],
    )
    outcome = evaluate_encounter(
        compile_rules(await _rules.get(session, draft.scoring_rule_id)),
        best_of=1,
        team_ids=[team.id for team in participations],
        games=[
            [
                GameLine(encounter_team_id=team.id, score=score, placement=None, values={})
                for team, score in zip(participations, scores, strict=True)
            ]
        ],
    )
    await apply_result(
        session,
        encounter,
        source=EncounterResultSource.HOST,
        totals=outcome.totals,
        placements=outcome.placements,
        action=EncounterResultAuditAction.CONFIRM,
        audit_source="host",
        actor_user_id=draft.recorder_player_id,
        reason=None,
    )
    seated = {seat.workspace_member_id for team in draft.seats for seat in team}
    await _rounds.create(
        session,
        models.CustomGameRound(
            encounter_id=encounter.id,
            lobby_index=draft.lobby_index,
            points_per_win_applied=draft.points_per_win_applied,
            members=[
                *(
                    models.CustomGameRoundMember(
                        workspace_member_id=seat.workspace_member_id,
                        busy=False,
                        rank_delta_applied=seat.rank_delta_applied,
                    )
                    for team in draft.seats
                    for seat in team
                ),
                *(
                    models.CustomGameRoundMember(workspace_member_id=member_id, busy=True)
                    for member_id in sorted(draft.busy - seated)
                ),
            ],
        ),
    )
    return encounter
