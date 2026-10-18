"""The match layer's answer to ingest evidence (P5, D95): may an observed log decide a game?

``stats-service`` observes and publishes :class:`MatchIngestedEvent` -- an opaque evidence id and revision, the
game-result basis it was bound against, canonical placements per bound team and the participants the roster
lacks. It never writes ``encounter.*``; this module alone decides what, if anything, becomes official, and it
imports nothing from the stats package. Every decision, refusals included, is one durable ``match_ingested``
receipt in the room journal (``record_room_event``, source ``stats-service``), written in the SAME transaction as
whatever it decided, so a rolled-back result leaves no receipt and a redelivery applies once.

Owner policy (D23) -- the only owners that can ever say yes:

* **tournament**, live encounter, exact bound team set: valid extra participants join their team as encounter
  substitutes under the roster's own rules -- whatever ``logs_official`` says and whatever the game's result state
  is (P4 always seated them; the switch is about results, D7). Separately, with ``logs_official = true`` an
  unaccepted, uncancelled game of an unconfirmed encounter takes the observed placements as an ``admin_log`` result.
* **mix** (host/co-host records directly) and **scrim** (specified: ``claims`` of both sides, result optional --
  a scrim container is a hidden tournament row today, with no scrim owner of its own): logs never decide anything
  there and never add roster members. Both are refused outright; there is no permissive branch for any other or
  unknown owner.

Outcomes (``apply_match_evidence`` returns exactly one; the first seven are journaled):

``accepted``              the game is CONFIRMED with source ``admin_log`` (one ``result_version`` step)
``logs_disabled``         the tournament does not accept logs as official; a later toggle never replays history
``owner_policy_refused``  mix, scrim, an unpublished (preview) bracket, or an extra participant whose rank/role
                          the roster rules cannot establish or that contradicts the roster
``result_locked``         the game is cancelled/confirmed, or the encounter already has a decided result
``stale_basis``           the game changed since the document was bound (result version or team set)
``result_incomplete``     placements/mandatory organizer inputs do not decide the game, or settlement refuses the
                          result (``bracket_tie``: rolled back in a savepoint); stats stays done
``applied_roster_only``   valid extras were seated but the result was refused; the receipt's reason is the result
                          refusal (``logs_official_off``, ``game_confirmed``, ``placements_missing``, ...)
``duplicate``             this revision of this evidence was already delivered (nothing written)
``stale_revision``        a higher revision of this evidence was already delivered (nothing written)
``ignored``               the encounter or game is gone (nothing written, nothing resurrected)

An event naming another workspace/discipline than its encounter raises :class:`ForeignEvidenceError` (malformed:
dead-letter queue, no receipt, no watermark).

The delivered-revision high-water is a statement about what THIS consumer has seen, not about unseen stats
revisions. First accepted evidence stands: a later revision meets a CONFIRMED game and is refused as locked;
changing an accepted result stays the organizer's explicit reopen/correct action, after which a fresh reparse
captures its new basis.
"""

from __future__ import annotations

from dataclasses import dataclass

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
from shared.models.encounter.team import EncounterTeam
from shared.models.tenancy.workspace import WorkspaceMember
from shared.repository import (
    CatalogRoleRepository,
    EncounterRepository,
    EncounterRoomEventRepository,
    EncounterTeamMemberRepository,
    PlayerRepository,
    TournamentRepository,
    WorkspaceMemberRepository,
)
from shared.schemas.events import MatchIngestedEvent, MatchIngestExtraParticipant
from shared.services.bracket.usability import is_encounter_live
from shared.services.division_grid.access import get_effective_division_grid
from shared.services.encounter.participants import MemberSnapshot, active_teams, add_substitute
from shared.services.member_rank import TOURNAMENT_ORDER, member_rank_service
from shared.services.realtime import Resource, Scope, emit
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
    "ForeignEvidenceError",
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


class ForeignEvidenceError(ValueError):
    """The event names another workspace/discipline than the encounter it points at: malformed, never journaled."""


_tournaments = TournamentRepository()
_encounters = EncounterRepository()
_players = PlayerRepository()
_roles = CatalogRoleRepository()
_members = WorkspaceMemberRepository()
_team_members = EncounterTeamMemberRepository()
_room_events = EncounterRoomEventRepository()


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
    # Any owner, not ``get_for_update``: a mix round is no tournament encounter yet needs its refusal receipt.
    encounter = await _encounters.get_any_owner_for_update(session, event.encounter_id)
    if encounter is None:
        return IGNORED
    # A foreign event is malformed, not a policy decision: it must reach the dead-letter queue before it can write
    # a receipt or be compared with this encounter's delivered-revision watermark.
    if event.workspace_id != encounter.workspace_id or event.discipline != encounter.discipline:
        raise ForeignEvidenceError(
            f"match.ingested {event.event_id} names workspace {event.workspace_id}/{event.discipline}, "
            f"encounter {encounter.id} belongs to {encounter.workspace_id}/{encounter.discipline}"
        )
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
    refusal = await _owner_refusal(session, encounter)
    if refusal is None and not await is_encounter_live(session, encounter):
        # An unpublished preview bracket takes no result and no roster change, whoever proposes it.
        refusal = _Refusal(OWNER_POLICY_REFUSED, "encounter_preview")
    if refusal is not None:
        return refusal.outcome, refusal.reason
    seats = await active_teams(session, encounter.id)
    refusal = _team_set_refusal(seats, event)
    if refusal is not None:
        return refusal.outcome, refusal.reason
    # The roster is the owner's policy (tournament, live encounter, exact team set); whether the log may also decide
    # the game is a separate question (``logs_official``, game state, basis) and never gates the substitutes.
    plan, refusal = await _plan_extras(session, encounter, event, seats)
    if refusal is not None:
        return refusal.outcome, refusal.reason

    lines: list[GameResultIn] = []
    refusal = await _result_refusal(session, encounter, game, event)
    if refusal is None:
        lines, refusal = await _result_lines(session, games, encounter, game, event, seats)
    for participation, snapshot in plan:
        await add_substitute(session, participation, snapshot)
    if refusal is None:
        refusal = await _record(session, games, encounter, game, event, lines)
    if refusal is not None:
        if plan:
            # A refused result does not undo valid roster additions (judged on their own rules): tell the readers.
            await _announce_roster(session, encounter)
        return (APPLIED_ROSTER_ONLY if plan else refusal.outcome), refusal.reason

    # ``record_result`` emits no room invalidations; stage what a correction stages (``game_correction.py``) so the
    # bracket, standings and open rooms refresh on commit.
    await enqueue_tournament_recalculation(session, encounter.tournament_id)
    await emit_pick_ban_update(session, encounter.id)
    await emit_pick_ban_update(session, encounter.id, kind=PickBanKind.HERO.value)
    return ACCEPTED, None


async def _record(
    session: AsyncSession,
    games: EncounterGameService,
    encounter: Encounter,
    game: EncounterGame,
    event: MatchIngestedEvent,
    lines: list[GameResultIn],
) -> _Refusal | None:
    """Write the result and its settlement in a savepoint; a domain refusal undoes only that attempt.

    Settlement can still refuse a result that passed validation (an elimination encounter that would end level
    raises ``bracket_tie``). The no-draw rule stays the settlement's; here the tentative result, version bump and
    cascade are rolled back and the refusal is journaled instead of dead-lettering valid evidence.
    """
    try:
        async with session.begin_nested():
            await games.record_result(
                session,
                encounter,
                game,
                results=lines,
                source=EncounterGameResultSource.ADMIN_LOG,
                actor_user_id=None,
                reason=f"Accepted ingest evidence {event.evidence_id} revision {event.revision}",
            )
    except BaseAPIException as exc:
        await session.refresh(game)
        await session.refresh(encounter)
        return _Refusal(RESULT_INCOMPLETE, _code(exc))
    return None


async def _announce_roster(session: AsyncSession, encounter: Encounter) -> None:
    """Invalidate the cached encounter reads and wake open rooms after a roster-only change (no standings work)."""
    await emit(
        session,
        scope=Scope.tournament(encounter.tournament_id),
        invalidates=[Resource.TOURNAMENT_ENCOUNTERS],
        entity_ids={"encounter_ids": [encounter.id]},
    )
    await emit_pick_ban_update(session, encounter.id)


@dataclass(frozen=True, slots=True)
class _Delivered:
    revisions: frozenset[int]
    event_ids: frozenset[str]


async def _delivered(session: AsyncSession, encounter_id: int, game_id: int, evidence_id: int) -> _Delivered:
    """Every receipt of this evidence on this game: a direct, unbounded read of the scoped journal.

    Deliberately not ``RoomHistoryService.list_history``: that read is capped at 500 newest rows for display, and
    a busy room would push an old receipt out of the window and let a stale revision through.
    """
    rows = await _room_events.receipts_for_evidence(
        session, encounter_id, action=RECEIPT_ACTION, game_id=game_id, evidence_id=evidence_id
    )
    return _Delivered(
        revisions=frozenset(revision for revision, _ in rows if revision is not None),
        event_ids=frozenset(event_id for _, event_id in rows if event_id is not None),
    )


async def _owner_refusal(session: AsyncSession, encounter: Encounter) -> _Refusal | None:
    if encounter.tournament_id is None:
        return _Refusal(OWNER_POLICY_REFUSED, "owner_not_tournament")
    if await is_scrim_container(session, encounter.tournament_id):
        return _Refusal(OWNER_POLICY_REFUSED, "owner_scrim")
    tournament = await _tournaments.get(session, encounter.tournament_id)
    if tournament is None or tournament.workspace_id != encounter.workspace_id:
        return _Refusal(OWNER_POLICY_REFUSED, "owner_mismatch")
    return None


async def _result_refusal(
    session: AsyncSession, encounter: Encounter, game: EncounterGame, event: MatchIngestedEvent
) -> _Refusal | None:
    """Whether the log may decide THIS game: the tournament's ``logs_official`` switch, then the game's own state."""
    tournament = await _tournaments.get(session, encounter.tournament_id)
    if not tournament.logs_official:
        return _Refusal(LOGS_DISABLED, "logs_official_off")
    return _game_refusal(encounter, game, event)


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
) -> tuple[list[tuple[EncounterTeam, MemberSnapshot]], _Refusal | None]:
    """Which substitutes need seating, or the refusal that stops the whole evidence. Writes nothing.

    Idempotent for a member already on the same team; a member already seated on ANOTHER live team of this
    encounter, or rostered on another tournament team, is a contradiction, never a swap. Nothing is guessed: no
    replaced player, and rank and role come from the roster's own authority (:func:`_snapshot`) or the evidence
    is refused.
    """
    seat_by_id = {seat.id: seat for seat in seats}
    plan: list[tuple[EncounterTeam, MemberSnapshot]] = []
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
        member = await _members.get(session, extra.workspace_member_id)
        if member is None or member.workspace_id != encounter.workspace_id:
            return [], _Refusal(OWNER_POLICY_REFUSED, "extra_member_foreign")
        if member.removed_at is not None:
            return [], _Refusal(OWNER_POLICY_REFUSED, "extra_member_removed")
        seated_on = await _team_members.active_team_id(session, encounter.id, member.id)
        if seated_on == participation.id:
            continue
        if seated_on is not None:
            return [], _Refusal(OWNER_POLICY_REFUSED, "extra_member_contradiction")
        snapshot = await _snapshot(session, encounter, participation, member, extra)
        if isinstance(snapshot, _Refusal):
            return [], snapshot
        plan.append((participation, snapshot))
    return plan, None


async def _snapshot(
    session: AsyncSession,
    encounter: Encounter,
    participation: EncounterTeam,
    member: WorkspaceMember,
    extra: MatchIngestExtraParticipant,
) -> MemberSnapshot | _Refusal:
    """The substitute as the roster rules would remember them, or why that cannot be established.

    The tournament's own roster row (``tournament.player``) is authoritative for rank and rated role; a member
    rostered on another team of this tournament is a contradiction. Without one, the rank is the existing
    member-rank resolution (workspace canon, then the native ladder) on the role the observation names, which
    must be the discipline's rated dimension and resolve in this workspace.
    """
    rated = discipline_spec(encounter.discipline).rated_dimension.code
    rostered = await _players.rated_roster_rows(session, encounter.tournament_id, member.id)
    if any(team_id != participation.team_id for team_id, _, _ in rostered):
        return _Refusal(OWNER_POLICY_REFUSED, "extra_member_other_team")
    own_rank, own_role = (rostered[0][1], rostered[0][2]) if rostered else (None, None)

    # Every observed ref is validated on its own (rated dimension, this workspace), whichever role ends up chosen.
    observed = extra.observed_role
    if observed is not None:
        if observed.dimension != rated:
            return _Refusal(OWNER_POLICY_REFUSED, "extra_role_invalid")
        try:
            await _roles.resolve(
                session,
                discipline=encounter.discipline,
                workspace_id=encounter.workspace_id,
                dimension=rated,
                code=observed.role,
            )
        except UnknownRole:
            return _Refusal(OWNER_POLICY_REFUSED, "extra_role_invalid")
    # The roster's assignment is authoritative; the observation only fills a gap.
    code = own_role or (observed.role if observed is not None else None)
    if code is None:
        return _Refusal(OWNER_POLICY_REFUSED, "extra_role_unknown")
    try:
        leaf = await _roles.resolve(
            session, discipline=encounter.discipline, workspace_id=encounter.workspace_id, dimension=rated, code=code
        )
    except UnknownRole:
        return _Refusal(OWNER_POLICY_REFUSED, "extra_role_invalid")

    rank = own_rank
    if rank is None:
        top = leaf.code
        if leaf.parent_role_id is not None:
            top = (await _roles.get(session, leaf.parent_role_id)).code
        grid = await get_effective_division_grid(
            session, encounter.workspace_id, encounter.tournament_id, discipline=encounter.discipline
        )
        resolved = await member_rank_service.resolve(
            session,
            workspace_id=encounter.workspace_id,
            discipline=encounter.discipline,
            members={member.id: member.player_id},
            roles=[top],
            order=TOURNAMENT_ORDER,
            grid=grid,
        )
        rank = resolved[(member.id, top)].value
    if rank is None:
        return _Refusal(OWNER_POLICY_REFUSED, "extra_rank_unknown")
    return MemberSnapshot(
        workspace_member_id=member.id,
        display_name=extra.handle_snapshot,
        rank=rank,
        is_substitute=True,
        roles=((rated, leaf.code),),
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
