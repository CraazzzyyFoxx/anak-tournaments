"""One mix match on the encounter layer, in two writes, each in the caller's transaction.

:func:`start_mix_match` opens it: an encounter owned by the mix (2 slots, Bo1, open, ``started_at``), two
participations with the roster snapshot of the lobby's lineup -- captains included -- both marked ready, and one game
on the lobby's next map, waiting for its result. With hero bans it also asks tournament-service, through the outbox, to
open the encounter's ban room. :func:`record_mix_result` closes it: the game's score, a ``host`` result through the
single result writer (one journal row, actor = the recorder) and the balancer's ``mix.round``/``mix.round_member`` rows.

A started match has no ``mix.round`` row, so history, leaderboard, rotation, ranker and undo -- which all read rounds --
do not see it until it is recorded. No tournament result event, standings or achievement is raised: nothing listens
for a mix result. A draw is 0:0.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import UTC, datetime

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

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
from shared.messaging.config import TOURNAMENT_EVENTS_EXCHANGE, TOURNAMENT_PICK_BAN_ROOM_OPEN_QUEUE
from shared.messaging.outbox import enqueue_outbox_event
from shared.repository import (
    CustomGameRoundRepository,
    EncounterGameRepository,
    EncounterGameTeamRepository,
    EncounterRepository,
    ScoringRuleRepository,
)
from shared.schemas.events import PickBanRoomOpenRequestedEvent
from shared.services.encounter.participants import MemberSnapshot, active_teams, place_team
from shared.services.encounter.result import apply_result

__all__ = ("MixMatchDraft", "MixMatchSeat", "MixResultDraft", "record_mix_result", "start_mix_match")

_encounters = EncounterRepository()
_games = EncounterGameRepository()
_game_teams = EncounterGameTeamRepository()
_rules = ScoringRuleRepository()
_rounds = CustomGameRoundRepository()
#: Game score per lineup team for winner 1, 2 and a draw.
_SCORES = {1: (1, 0), 2: (0, 1), None: (0, 0)}


@dataclass(frozen=True, slots=True)
class MixMatchSeat:
    workspace_member_id: int
    display_name: str
    #: Roster slot code (tank / damage / support / flex); ``None`` for a seat balanced without a role.
    role: str | None
    rank: int
    #: The lineup team's captain (``teams[t].captain_member_id``).
    is_captain: bool = False


@dataclass(frozen=True, slots=True)
class MixMatchDraft:
    custom_game_id: int
    workspace_id: int
    discipline: str
    scoring_rule_id: int
    #: The lobby's next map, fixed for this match; ``None`` when nothing was rolled.
    map_id: int | None
    #: Slot 1 and slot 2: the ban opener first (spec §5.1).
    names: tuple[str, str]
    seats: tuple[tuple[MixMatchSeat, ...], tuple[MixMatchSeat, ...]]
    #: Open a hero ban room: ask tournament-service to open it once the match is committed.
    bans: bool = False


@dataclass(frozen=True, slots=True)
class MixResultDraft:
    encounter_id: int
    lobby_index: int
    #: The lobby's team names at record time: a rename while the match ran lands on the record.
    names: tuple[str, str]
    #: The lineup's first team's members: Start may have seated it in slot 2 (it banned second).
    lineup_first_team: frozenset[int]
    #: The lineup team that won (1 or 2); None for a draw.
    winner: int | None
    points_per_win_applied: int | None
    #: The ranker's frozen move per seated member; a member absent here moved nothing.
    rank_deltas: Mapping[int, int] = field(default_factory=dict)
    #: Members on the floor of another lobby, or away; a member also seated here counts as seated.
    busy: frozenset[int] = frozenset()
    #: ``players.user`` id of the recorder (the journal's actor); ``None`` for an account with no player.
    recorder_player_id: int | None = None


async def _map_mode(session: AsyncSession, map_id: int | None) -> int | None:
    """The catalog mode ``map_id`` belongs to: its parent when that parent is a ``mode``, else ``None``."""
    if map_id is None:
        return None
    mode = aliased(models.CatalogEntity, name="mode")
    return await session.scalar(
        sa.select(mode.id)
        .select_from(models.CatalogEntity)
        .join(mode, mode.id == models.CatalogEntity.parent_id)
        .where(models.CatalogEntity.id == map_id, mode.kind == "mode")
    )


async def start_mix_match(session: AsyncSession, draft: MixMatchDraft) -> models.Encounter:
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
            # The cards' elapsed clock; set here rather than by the database so the caller reads it at once.
            started_at=datetime.now(UTC),
        ),
    )
    dimension = discipline(draft.discipline).rated_dimension.code
    for slot, (name, team) in enumerate(zip(draft.names, draft.seats, strict=True), start=1):
        participation = await place_team(
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
                    is_captain=seat.is_captain,
                )
                for seat in team
            ],
        )
        # Ready at once, bans or not (spec §5.1 step 4): the room's open rule stays the tournament one.
        session.add(models.EncounterReadiness(encounter_id=encounter.id, encounter_team_id=participation.id))
    await _games.create(
        session,
        models.EncounterGame(
            encounter_id=encounter.id,
            position=1,
            map_id=draft.map_id,
            mode_id=await _map_mode(session, draft.map_id),
            state=EncounterGameState.AWAITING_RESULT,
        ),
    )
    if draft.bans:
        # tournament-service opens the room once this commits (step 5); the request dies with a rolled-back Start.
        await enqueue_outbox_event(
            session,
            PickBanRoomOpenRequestedEvent(encounter_id=encounter.id, source_service="balancer-service"),
            exchange=TOURNAMENT_EVENTS_EXCHANGE,
            routing_key=TOURNAMENT_PICK_BAN_ROOM_OPEN_QUEUE.routing_key,
        )
    return encounter


async def record_mix_result(session: AsyncSession, draft: MixResultDraft) -> models.Encounter:
    # Mix-owned, so not through ``get_for_update`` (tournament encounters only, D77); the result writer needs the lock.
    encounter = await _encounters.get_any_owner_for_update(session, draft.encounter_id)
    participations = await active_teams(session, encounter.id)
    slot_one = set(
        await session.scalars(
            sa.select(models.EncounterTeamMember.workspace_member_id).where(
                models.EncounterTeamMember.encounter_team_id == participations[0].id,
                models.EncounterTeamMember.active.is_(True),
            )
        )
    )
    # Start seats the team that bans first in slot 1 (spec §5.1): line the seats up with the lineup's team order.
    if slot_one != draft.lineup_first_team:
        participations.reverse()
    for participation, name in zip(participations, draft.names, strict=True):
        participation.name = name
    encounter.name = " vs ".join(team.name for team in sorted(participations, key=lambda team: team.slot))
    [game] = await _games.list_for_encounter(session, encounter.id)
    game.state = EncounterGameState.CONFIRMED
    game.result_source = EncounterGameResultSource.HOST
    game.result_version = 1
    game.confirmed_at = datetime.now(UTC)
    scores = _SCORES[draft.winner]
    # A LoL side pick already wrote this game's lines (``starting_side``); keep them and add the score.
    lines = {row.encounter_team_id: row for row in await _game_teams.list_for_games(session, [game.id])}
    for team, score in zip(participations, scores, strict=True):
        line = lines.get(team.id) or _game_teams.add(
            session, models.EncounterGameTeam(game_id=game.id, encounter_id=encounter.id, encounter_team_id=team.id)
        )
        line.score = score
    await session.flush()
    outcome = evaluate_encounter(
        compile_rules(await _rules.get(session, encounter.scoring_rule_id)),
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
    seated = set(
        await session.scalars(
            sa.select(models.EncounterTeamMember.workspace_member_id).where(
                models.EncounterTeamMember.encounter_id == encounter.id,
                models.EncounterTeamMember.active.is_(True),
            )
        )
    )
    await _rounds.create(
        session,
        models.CustomGameRound(
            encounter_id=encounter.id,
            lobby_index=draft.lobby_index,
            points_per_win_applied=draft.points_per_win_applied,
            members=[
                *(
                    models.CustomGameRoundMember(
                        workspace_member_id=member_id,
                        busy=False,
                        rank_delta_applied=draft.rank_deltas.get(member_id),
                    )
                    for member_id in sorted(seated)
                ),
                *(
                    models.CustomGameRoundMember(workspace_member_id=member_id, busy=True)
                    for member_id in sorted(draft.busy - seated)
                ),
            ],
        ),
    )
    return encounter
