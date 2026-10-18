"""The match layer's answer to ingest evidence (P5, D95): may an observed log decide a game?

``stats-service`` observes and publishes :class:`MatchIngestedEvent` -- an opaque evidence id and revision, the
game-result basis it was bound against, canonical placements per bound team and the participants the roster
lacks. It never writes ``encounter.*``; this module alone decides what, if anything, becomes official, and it
imports nothing from the stats package. Every decision, refusals included, is one durable ``match_ingested``
receipt in the room journal (``record_room_event``, source ``stats-service``), written in the SAME transaction as
whatever it decided, so a rolled-back result leaves no receipt and a redelivery applies once.

Owner policy (D23) -- the only owners that can ever say yes:

* **tournament** with ``logs_official = true``: an unaccepted, uncancelled game of an unconfirmed encounter takes
  the observed placements as an ``admin_log`` result, and valid extra participants join their team as
  encounter substitutes under the roster's own rules.
* **mix** (host/co-host records directly) and **scrim** (specified: ``claims`` of both sides, result optional --
  a scrim container is a hidden tournament row today, with no scrim owner of its own): logs never decide anything
  there and never add roster members. Both are refused outright; there is no permissive branch for any other or
  unknown owner.

Outcomes (``apply_match_evidence`` returns exactly one; the first seven are journaled):

``accepted``              the game is CONFIRMED with source ``admin_log`` (one ``result_version`` step)
``logs_disabled``         the tournament does not accept logs as official; a later toggle never replays history
``owner_policy_refused``  wrong/foreign owner, mix, scrim, or an extra participant the roster rules refuse
``result_locked``         the game is cancelled/confirmed, or the encounter already has a decided result
``stale_basis``           the game changed since the document was bound (result version or team set)
``result_incomplete``     placements/mandatory organizer inputs do not decide the game; stats stays done
``applied_roster_only``   valid extras were seated but the result could not be accepted (see above)
``duplicate``             this revision of this evidence was already delivered (nothing written)
``stale_revision``        a higher revision of this evidence was already delivered (nothing written)
``ignored``               the encounter or game is gone (nothing written, nothing resurrected)

The delivered-revision high-water is a statement about what THIS consumer has seen, not about unseen stats
revisions. First accepted evidence stands: a later revision meets a CONFIRMED game and is refused as locked;
changing an accepted result stays the organizer's explicit reopen/correct action, after which a fresh reparse
captures its new basis.
"""

from __future__ import annotations

from dataclasses import dataclass

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from shared.core.enums import (
    EncounterGameResultSource,
    EncounterGameState,
    EncounterResultSource,
    EncounterResultStatus,
    PickBanKind,
)
from shared.core.errors import BaseAPIException
from shared.disciplines import discipline as discipline_spec
from shared.domain.roles import UnknownRole
from shared.models.encounter.encounter import Encounter
from shared.models.encounter.game import EncounterGame
from shared.models.encounter.room_event import EncounterRoomEvent
from shared.models.encounter.team import EncounterTeam, EncounterTeamMember
from shared.models.tenancy.workspace import WorkspaceMember
from shared.repository import CatalogRoleRepository, TournamentRepository
from shared.schemas.events import MatchIngestedEvent, MatchIngestExtraParticipant
from shared.services.encounter.participants import MemberSnapshot, active_teams, add_substitute
from shared.services.scrim_scope import is_scrim_container
from src.services.encounter.games import (
    EncounterGameService,
    GameResultIn,
    encounter_game_service,
    normalize_results,
    require_filled_seats,
)
from src.services.encounter.realtime_commit import emit_pick_ban_update
from src.services.encounter.room_journal import record_room_event
from src.services.tournament.events import enqueue_tournament_recalculation

__all__ = (
    "ACCEPTED",
    "APPLIED_ROSTER_ONLY",
    "DUPLICATE",
    "IGNORED",
    "LOGS_DISABLED",
    "OWNER_POLICY_REFUSED",
    "RECEIPT_ACTION",
    "RECEIPT_SOURCE",
    "RESULT_INCOMPLETE",
    "RESULT_LOCKED",
    "STALE_BASIS",
    "STALE_REVISION",
    "apply_match_evidence",
)

RECEIPT_ACTION = "match_ingested"
RECEIPT_SOURCE = "stats-service"

ACCEPTED = "accepted"
LOGS_DISABLED = "logs_disabled"
OWNER_POLICY_REFUSED = "owner_policy_refused"
RESULT_LOCKED = "result_locked"
STALE_BASIS = "stale_basis"
RESULT_INCOMPLETE = "result_incomplete"
APPLIED_ROSTER_ONLY = "applied_roster_only"
DUPLICATE = "duplicate"
STALE_REVISION = "stale_revision"
IGNORED = "ignored"

_tournaments = TournamentRepository()
_roles = CatalogRoleRepository()


@dataclass(frozen=True, slots=True)
class _Refusal:
    """A decision that writes only its receipt: the outcome and the short code the journal keeps as the reason."""

    outcome: str
    reason: str


async def apply_match_evidence(
    session: AsyncSession,
    event: MatchIngestedEvent,
    *,
    games: EncounterGameService = encounter_game_service,
) -> str:
    """Decide ``event`` and stage everything it caused in the caller's transaction. Never commits.

    The caller commits once, after this returns, and acknowledges the delivery only after that commit.
    """
    # Not ``EncounterRepository``: its select is tournament-owned only, and a mix round needs its refusal receipt.
    encounter = await session.scalar(
        sa.select(Encounter)
        .where(Encounter.id == event.encounter_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if encounter is None:
        return IGNORED
    game = await games.game_repo.get_for_update(session, event.encounter_game_id)
    if game is None or game.encounter_id != encounter.id:
        return IGNORED

    delivered = await _delivered(session, encounter.id, game.id, event.evidence_id)
    if event.revision in delivered.revisions or event.event_id in delivered.event_ids:
        return DUPLICATE
    if delivered.revisions and event.revision < max(delivered.revisions):
        return STALE_REVISION

    outcome, reason = await _decide(session, games, encounter, game, event)
    await record_room_event(
        session,
        encounter.id,
        action=RECEIPT_ACTION,
        source=RECEIPT_SOURCE,
        reason=reason,
        data={
            "game_id": game.id,
            "evidence_id": event.evidence_id,
            "revision": event.revision,
            "event_id": event.event_id,
            "basis_game_result_version": event.basis_game_result_version,
            "accepted_game_result_version": game.result_version or 0,
            "outcome": outcome,
        },
    )
    await session.flush()
    return outcome


async def _decide(
    session: AsyncSession,
    games: EncounterGameService,
    encounter: Encounter,
    game: EncounterGame,
    event: MatchIngestedEvent,
) -> tuple[str, str | None]:
    """``(outcome, reason)`` of one undelivered revision; stages the roster and result it decided to apply."""
    refusal = await _owner_refusal(session, encounter, event) or _game_refusal(encounter, game, event)
    if refusal is not None:
        return refusal.outcome, refusal.reason
    seats = await active_teams(session, encounter.id)
    refusal = _team_set_refusal(seats, event)
    if refusal is not None:
        return refusal.outcome, refusal.reason
    plan, refusal = await _plan_extras(session, encounter, event, seats)
    if refusal is not None:
        return refusal.outcome, refusal.reason

    lines, refusal = await _result_lines(session, games, encounter, game, event, seats)
    for participation, extra in plan:
        await _seat_extra(session, participation, extra)
    if refusal is not None:
        # A refused result does not undo valid roster additions: they are judged on their own rules.
        return (APPLIED_ROSTER_ONLY if plan else refusal.outcome), refusal.reason

    await games.record_result(
        session,
        encounter,
        game,
        results=lines,
        source=EncounterGameResultSource.ADMIN_LOG,
        actor_user_id=None,
        reason=f"Accepted ingest evidence {event.evidence_id} revision {event.revision}",
    )
    # ``record_result`` emits no room invalidations; stage what a correction stages (``game_correction.py``) so the
    # bracket, standings and open rooms refresh on commit.
    await enqueue_tournament_recalculation(session, encounter.tournament_id)
    await emit_pick_ban_update(session, encounter.id)
    await emit_pick_ban_update(session, encounter.id, kind=PickBanKind.HERO.value)
    return ACCEPTED, None


@dataclass(frozen=True, slots=True)
class _Delivered:
    revisions: frozenset[int]
    event_ids: frozenset[str]


async def _delivered(session: AsyncSession, encounter_id: int, game_id: int, evidence_id: int) -> _Delivered:
    """Every receipt of this evidence on this game: a direct, unbounded read of the scoped journal.

    Deliberately not ``RoomHistoryService.list_history``: that read is capped at 500 newest rows for display, and
    a busy room would push an old receipt out of the window and let a stale revision through.
    """
    data = EncounterRoomEvent.data
    rows = (
        await session.execute(
            sa.select(data["revision"].as_integer(), data["event_id"].as_string()).where(
                EncounterRoomEvent.encounter_id == encounter_id,
                EncounterRoomEvent.action == RECEIPT_ACTION,
                data["game_id"].as_integer() == game_id,
                data["evidence_id"].as_integer() == evidence_id,
            )
        )
    ).all()
    return _Delivered(
        revisions=frozenset(revision for revision, _ in rows if revision is not None),
        event_ids=frozenset(event_id for _, event_id in rows if event_id is not None),
    )


async def _owner_refusal(session: AsyncSession, encounter: Encounter, event: MatchIngestedEvent) -> _Refusal | None:
    if event.workspace_id != encounter.workspace_id or event.discipline != encounter.discipline:
        return _Refusal(OWNER_POLICY_REFUSED, "owner_mismatch")
    if encounter.tournament_id is None:
        return _Refusal(OWNER_POLICY_REFUSED, "owner_not_tournament")
    if await is_scrim_container(session, encounter.tournament_id):
        return _Refusal(OWNER_POLICY_REFUSED, "owner_scrim")
    tournament = await _tournaments.get(session, encounter.tournament_id)
    if tournament is None or tournament.workspace_id != encounter.workspace_id:
        return _Refusal(OWNER_POLICY_REFUSED, "owner_mismatch")
    if not tournament.logs_official:
        return _Refusal(LOGS_DISABLED, "logs_official_off")
    return None


def _game_refusal(encounter: Encounter, game: EncounterGame, event: MatchIngestedEvent) -> _Refusal | None:
    if game.state == EncounterGameState.CANCELLED:
        return _Refusal(RESULT_LOCKED, "game_cancelled")
    if game.state == EncounterGameState.CONFIRMED:
        return _Refusal(RESULT_LOCKED, "game_confirmed")
    # A decided encounter (confirmed, or a series claim/admin/import/host result) owns the standing; only the
    # games-derived result may be refreshed by a new game.
    if encounter.result_status == EncounterResultStatus.CONFIRMED or encounter.result_source not in (
        None,
        EncounterResultSource.GAMES.value,
    ):
        return _Refusal(RESULT_LOCKED, "encounter_decided")
    if event.basis_game_result_version != (game.result_version or 0):
        return _Refusal(STALE_BASIS, "basis_version")
    return None


def _team_set_refusal(seats: list[EncounterTeam], event: MatchIngestedEvent) -> _Refusal | None:
    """The bound team set must still be exactly the live seats: a swapped/vacated seat makes the binding stale."""
    if not event.placements:
        return None  # nothing to compare; the result step reports the missing placements
    bound = [row.encounter_team_id for row in event.placements]
    if len(set(bound)) != len(bound) or set(bound) != {seat.id for seat in seats}:
        return _Refusal(STALE_BASIS, "team_set")
    return None


async def _plan_extras(
    session: AsyncSession, encounter: Encounter, event: MatchIngestedEvent, seats: list[EncounterTeam]
) -> tuple[list[tuple[EncounterTeam, MatchIngestExtraParticipant]], _Refusal | None]:
    """Which extras need seating, or the refusal that stops the whole evidence. Writes nothing.

    Idempotent for a member already on the same team; a member already seated on ANOTHER live team of this
    encounter is a contradiction, never a swap. Nothing is guessed: no replaced player, no rank, no role the
    observation did not state and the workspace does not own.
    """
    seat_by_id = {seat.id: seat for seat in seats}
    rated = discipline_spec(encounter.discipline).rated_dimension.code
    plan: list[tuple[EncounterTeam, MatchIngestExtraParticipant]] = []
    claimed: dict[int, int] = {}
    for extra in event.extra_participants:
        participation = seat_by_id.get(extra.encounter_team_id)
        if participation is None:
            return [], _Refusal(OWNER_POLICY_REFUSED, "extra_team_unknown")
        if extra.workspace_member_id in claimed:
            if claimed[extra.workspace_member_id] != participation.id:
                return [], _Refusal(OWNER_POLICY_REFUSED, "extra_member_contradiction")
            continue  # the same member listed twice for one team
        claimed[extra.workspace_member_id] = participation.id
        member = await session.get(WorkspaceMember, extra.workspace_member_id)
        if member is None or member.workspace_id != encounter.workspace_id:
            return [], _Refusal(OWNER_POLICY_REFUSED, "extra_member_foreign")
        if member.removed_at is not None:
            return [], _Refusal(OWNER_POLICY_REFUSED, "extra_member_removed")
        seated_on = await session.scalar(
            sa.select(EncounterTeamMember.encounter_team_id).where(
                EncounterTeamMember.encounter_id == encounter.id,
                EncounterTeamMember.workspace_member_id == member.id,
                EncounterTeamMember.active.is_(True),
            )
        )
        if seated_on == participation.id:
            continue
        if seated_on is not None:
            return [], _Refusal(OWNER_POLICY_REFUSED, "extra_member_contradiction")
        role = extra.observed_role
        if role is not None:
            if role.dimension != rated:
                return [], _Refusal(OWNER_POLICY_REFUSED, "extra_role_invalid")
            try:
                await _roles.resolve(
                    session,
                    discipline=encounter.discipline,
                    workspace_id=encounter.workspace_id,
                    dimension=role.dimension,
                    code=role.role,
                )
            except UnknownRole:
                return [], _Refusal(OWNER_POLICY_REFUSED, "extra_role_invalid")
        plan.append((participation, extra))
    return plan, None


async def _seat_extra(session: AsyncSession, participation: EncounterTeam, extra: MatchIngestExtraParticipant) -> None:
    role = extra.observed_role
    await add_substitute(
        session,
        participation,
        MemberSnapshot(
            workspace_member_id=extra.workspace_member_id,
            display_name=extra.handle_snapshot,
            # ponytail: no rank guess -- the roster's rank rules own it; the organizer sets it if the format needs one
            rank=None,
            is_substitute=True,
            roles=((role.dimension, role.role),) if role is not None else (),
        ),
    )


async def _result_lines(
    session: AsyncSession,
    games: EncounterGameService,
    encounter: Encounter,
    game: EncounterGame,
    event: MatchIngestedEvent,
    seats: list[EncounterTeam],
) -> tuple[list[GameResultIn], _Refusal | None]:
    """The game's placement-only lines, or why they cannot decide it (nothing is invented or zero-filled).

    ``record_result`` validates the same things first and raises before it mutates anything, so checking here
    first turns those 409/422 into a journaled outcome instead of an error that would retry or dead-letter.
    """
    placements = {row.encounter_team_id: row.placement for row in event.placements}
    if not placements or any(value is None for value in placements.values()):
        return [], _Refusal(RESULT_INCOMPLETE, "placements_missing")
    lines = [
        GameResultIn(encounter_team_id=seat.id, score=None, placement=placements[seat.id], column_values={})
        for seat in seats
    ]
    try:
        await games.assert_side_settled(session, encounter, game)
        require_filled_seats(encounter, seats)
        normalize_results(lines, [seat.id for seat in seats], await games.rules(session, encounter))
    except BaseAPIException as exc:
        return [], _Refusal(RESULT_INCOMPLETE, _code(exc))
    return lines, None


def _code(exc: BaseAPIException) -> str:
    detail = exc.detail
    first = detail[0] if isinstance(detail, list) and detail else None
    code = first.get("code") if isinstance(first, dict) else getattr(first, "code", None)
    return str(code or "result_invalid")
