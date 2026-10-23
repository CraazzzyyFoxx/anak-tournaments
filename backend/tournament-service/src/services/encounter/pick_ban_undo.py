"""Undo the last pick-ban step, once BOTH captains have agreed to it.

The captains' own, surgical alternative to an organizer resetting the session
(which scraps the whole round) -- and deliberately a two-sided consent rather
than a unilateral take-back, because a settled step is information the opponent
has already acted on. (The unilateral door exists too, but only for a BLIND step
that both sides replay from scratch: ``pick_ban_action.dispute_step``.) Same
shape as the two other agreements this room runs on (``EncounterReadiness``,
``EncounterGameClaim``): one side records its consent, the other side's
matching call is what applies it.

What "the last step" means is ``pick_ban_rules.undo_target``: the latest step
holding an applied item from a captain. Reverting VOIDS that step's live
submissions and every later one -- a system step resolved off its back, a draft
already started on the next step -- and re-projects the board from what is
left, which is the whole revert: ``PickBanEntry`` is a projection, so nothing
has to be un-set by hand. The restored step gets a fresh clock; without that
``_settle`` would re-take it at random on the very next read, the timer having
long since run out on the step being restored.

The one thing that is NOT a projection is a side: a ``side_pick`` writes the
game's ``starting_side`` rows, so an undo of one clears them -- and refuses with
409 ``side_locked`` once that game was played on (claimed or confirmed).
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import sqlalchemy as sa
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.core import http_status as status
from shared.core.enums import EncounterGameState, MapVetoSessionStatus, PickBanKind
from shared.core.errors import ApiExc
from shared.core.errors import BaseAPIException as HTTPException
from shared.domain import pick_ban_engine as engine
from shared.domain import pick_ban_rules as pbr
from shared.models.encounter.pick_ban import PickBanEntry, PickBanSession
from shared.repository import PickBanEntryRepository, PickBanSubmissionRepository
from src.services.encounter.pick_ban_session import (
    PickBanSessionService,
    assert_not_paused,
    pick_ban_session_service,
    resolved_steps,
)
from src.services.encounter.realtime_commit import emit_pick_ban_update
from src.services.encounter.room_journal import record_room_event


def clear_undo_request(pick_ban: PickBanSession) -> None:
    """Drop any open request. Called on every new action as well as after an
    undo lands: a consent is given for ONE specific step, so it must never
    outlive the state it was read against."""
    pick_ban.undo_requested_by_team_id = None
    pick_ban.undo_target_index = None


def side_locked() -> HTTPException:
    """The refusal of every rewind that would take back a side somebody played on."""
    return HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail=[ApiExc(code="side_locked", msg="This side was already played on; it can no longer be taken back")],
    )


def undone_side_positions(
    steps: list[pbr.ResolvedStep], submissions: list[pbr.SubmissionLike], *, target: int
) -> frozenset[int]:
    """The positions whose sides an undo of ``target`` takes back: every
    ``side_pick`` from the target on that still holds a live answer."""
    return frozenset(
        step.round or 1
        for step in steps
        if step.action == "side_pick"
        and step.index >= target
        and any(
            row.step_index == step.index
            and row.attempt == pbr.current_attempt(submissions, step.index)
            and row.state != pbr.VOIDED
            for row in submissions
        )
    )


def undo_state(
    pick_ban: PickBanSession | None,
    steps: list[pbr.ResolvedStep],
    submissions: list[pbr.SubmissionLike],
) -> dict[str, Any]:
    """The room's undo block: what an undo would revert right now, and who has
    already agreed to it.

    ``item_ids`` empty means nothing is undoable -- the single signal the UI
    needs to decide whether the affordance exists at all.
    ``requested_by_team_id`` is reported only while it still matches the step
    in play; a request left behind by a since-superseded step reads as no
    request, exactly as the consent check itself treats it.
    """
    target = pbr.undo_target(steps, submissions)
    if target is None:
        return {
            "requested_by_team_id": None,
            "step_index": None,
            "item_ids": [],
            "action": None,
            "encounter_team_id": None,
        }
    step = next(candidate for candidate in steps if candidate.index == target)
    actors = step.acting_actors
    requested_by = (
        pick_ban.undo_requested_by_team_id if pick_ban is not None and pick_ban.undo_target_index == target else None
    )
    return {
        "requested_by_team_id": requested_by,
        "step_index": target,
        # Play order, so the UI lists them the way they were committed -- the
        # step itself plus everything resolved off its back.
        "item_ids": [
            applied.item_id for applied in pbr.applied_items(steps, submissions) if applied.step_index >= target
        ],
        "action": step.action,
        # A simultaneous step belongs to no participation in particular.
        "encounter_team_id": actors[0] if len(actors) == 1 else None,
    }


def apply_undo(
    pick_ban: PickBanSession,
    steps: list[pbr.ResolvedStep],
    submissions: list[pbr.SubmissionLike],
    entries: list[PickBanEntry],
    *,
    target: int,
    now: datetime,
) -> None:
    """Pure step: void the target step's live submissions and every later one,
    re-project the board, un-bind whatever a voided ``side_pick`` had assigned,
    and reopen the step."""
    undone_side_rounds: set[int | None] = set()
    for step in steps:
        if step.index < target:
            continue
        attempt = pbr.current_attempt(submissions, step.index)
        for row in submissions:
            if row.step_index == step.index and row.attempt == attempt and row.state != pbr.VOIDED:
                row.state = pbr.VOIDED
                if step.action == "side_pick":
                    undone_side_rounds.add(step.round)
    # A ``side:<code>`` step was bound to whoever the pick handed that side to;
    # taking the pick back has to take the binding with it, or a re-pick would
    # leave the later steps acting for the OLD assignment.
    if undone_side_rounds:
        for index, step in enumerate(steps):
            if step.round in undone_side_rounds and step.is_bound_to_side:
                steps[index] = step.unbound()
        pick_ban.resolved_sequence_json = [step.to_json() for step in steps]
    pbr.project_entries(entries, steps, submissions)
    clear_undo_request(pick_ban)
    # A completed session ran out of sequence, which an undo puts back -- a
    # cancelled one is a different thing entirely and never gets here.
    if str(pick_ban.status) == MapVetoSessionStatus.COMPLETED:
        pick_ban.status = MapVetoSessionStatus.ACTIVE
    pick_ban.current_step_started_at = now


class PickBanUndoService:
    def __init__(
        self,
        *,
        entry_repo: PickBanEntryRepository = PickBanEntryRepository(),
        submission_repo: PickBanSubmissionRepository = PickBanSubmissionRepository(),
        sessions: PickBanSessionService = pick_ban_session_service,
    ) -> None:
        self.entry_repo = entry_repo
        self.submission_repo = submission_repo
        self.sessions = sessions

    async def perform_undo(
        self,
        session: AsyncSession,
        encounter_id: int,
        kind: PickBanKind,
        encounter_team_id: int,
        *,
        consent: bool = True,
        actor_auth_user_id: int | None = None,
    ) -> dict[str, Any]:
        """Record ``encounter_team_id``'s consent to undo the last step,
        applying it the moment the opponent has given it too. ``consent=False``
        withdraws an open request (either side may: the asker changes their
        mind, or the opponent refuses).

        Returns the resulting undo block, so the caller renders the outcome
        without a second read.
        """
        # Encounter first, then the session -- the lock every committing path
        # takes: an undo moves the step cursor exactly as taking a step does
        # (the consent it reads, `undo_target_index`, is compared against the
        # log it loads below), and a side undo writes the game rows a result
        # correction holds the encounter lock for.
        encounter = await self.sessions._lock_encounter(session, encounter_id)
        pick_ban = await self.sessions.get_pick_ban_session(session, encounter_id, kind, for_update=True)
        if pick_ban is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Pick-ban session is not initialized")
        if str(pick_ban.status) == MapVetoSessionStatus.CANCELLED:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Pick-ban session is cancelled")
        # Undo is a captains-only agreement, so a paused room refuses it outright.
        assert_not_paused(pick_ban)

        steps = resolved_steps(pick_ban, await self.sessions.teams_of(session, encounter_id))
        entries = list(
            await self.entry_repo.list_by_session(session, pick_ban.id, ordered=True, populate_existing=True)
        )
        submissions = list(await self.submission_repo.list_by_session(session, pick_ban.id, populate_existing=True))
        target = pbr.undo_target(steps, submissions)
        if target is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="There is no action left to undo")
        step = next(candidate for candidate in steps if candidate.index == target)
        if kind == PickBanKind.MAP:
            await self._assert_hero_round_unstarted(session, encounter_id, step.round)
            await self._assert_positions_unclaimed(session, encounter_id, entries, steps, submissions, target)
        sides = undone_side_positions(steps, submissions, target=target)
        # A withdrawal takes nothing back, so only a consent is refused.
        if consent and sides & await self.sessions.games.played_positions(session, encounter_id):
            raise side_locked()

        # One row per real change: a captain re-sending the request they already
        # have, or withdrawing one nobody opened, moves nothing worth recording.
        journaled: str | None = None
        if not consent:
            if pick_ban.undo_requested_by_team_id is not None:
                journaled = "undo_withdrawn"
            clear_undo_request(pick_ban)
        else:
            # A request standing against a DIFFERENT step is stale, not an
            # agreement -- this call then opens a fresh one instead of applying it.
            pending = pick_ban.undo_requested_by_team_id if pick_ban.undo_target_index == target else None
            if pending is None or pending == encounter_team_id:
                if pending != encounter_team_id:
                    journaled = "undo_requested"
                pick_ban.undo_requested_by_team_id = encounter_team_id
                pick_ban.undo_target_index = target
            else:
                journaled = "undo_applied"
                apply_undo(pick_ban, steps, submissions, entries, target=target, now=datetime.now(UTC))
                await session.flush()
                await self.sessions.games.clear_sides(session, encounter_id, sides)
                if kind == PickBanKind.MAP:
                    # The pick is gone, so the position it opened must go with it.
                    await self.sessions.games.sync_games_with_picks(session, encounter, pick_ban)

        if journaled is not None:
            await record_room_event(
                session,
                encounter_id,
                action=journaled,
                source="captain",
                kind=kind.value,
                encounter_team_id=encounter_team_id,
                actor_auth_user_id=actor_auth_user_id,
                data={"step_index": target},
            )
        await emit_pick_ban_update(session, encounter_id, kind=kind.value)
        await session.commit()
        return undo_state(pick_ban, steps, submissions)

    async def _assert_hero_round_unstarted(
        self, session: AsyncSession, encounter_id: int, round_number: int | None
    ) -> None:
        """Refuse to undo a MAP action once heroes have been banned for that round.

        A hero round opens off the map pick (``sync_hero_rounds``) and is never
        withdrawn, so taking the pick back with bans already committed against it
        would leave those bans attached to a map nobody has picked. The captains'
        way through is the composable one: undo the hero actions first (they are the
        last actions of THEIR session), then the map pick — reverted hero entries do
        not count as committed, so this releases on its own.
        """
        hero_session = await self.sessions.get_pick_ban_session(session, encounter_id, PickBanKind.HERO)
        if hero_session is None:
            return
        # A carried ban never counts -- it carries no `action_index`, being a
        # fixed copy of an earlier round's.
        committed = await session.scalar(
            select(sa.func.count())
            .select_from(PickBanEntry)
            .where(
                PickBanEntry.session_id == hero_session.id,
                PickBanEntry.action_index.is_not(None),
                PickBanEntry.round == round_number if round_number is not None else sa.true(),
            )
        )
        if committed:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Undo this round's hero bans first — they were made for the map you are taking back",
            )

    async def _assert_positions_unclaimed(
        self,
        session: AsyncSession,
        encounter_id: int,
        entries: list[PickBanEntry],
        steps: list[pbr.ResolvedStep],
        submissions: list[pbr.SubmissionLike],
        target: int,
    ) -> None:
        """Refuse to undo a MAP pick once its position has a result claim.

        A pick opens a series position (``EncounterGame``); taking it back
        cancels that position. Doing so with a captain's claim already on it —
        or with the result accepted — would drop a played map's evidence on a
        click, so the series score would move because two captains agreed to
        change a MAP. Corrections are the admin command, with a reason.
        """
        undone = {
            (applied.round, applied.item_id)
            for applied in pbr.applied_items(steps, submissions)
            if applied.step_index >= target and applied.action in ("pick", "decider")
        }
        if not undone:
            return
        settled = engine.settled_in_order(entries)
        positions = {index for index, entry in enumerate(settled, 1) if (entry.round, entry.item_id) in undone}
        if not positions:
            return
        games = [
            game for game in await self.sessions.games.list_games(session, encounter_id) if game.position in positions
        ]
        claims = await self.sessions.games.claims_by_game(session, games)
        if any(game.state == EncounterGameState.CONFIRMED or claims.get(game.id) for game in games):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Undo is not possible: this map already has a result claim",
            )


pick_ban_undo_service = PickBanUndoService()
