"""What drives ``PickBanActionService.reconcile_room``.

The room's state read is pure (see ``pick_ban_action``), so nothing heals a
room by being looked at any more. Three things heal it instead:

* a POST-COMMIT trigger -- every write that touches a room already signals it
  through ``emit_pick_ban_update``, so staging a reconcile alongside that signal
  covers captain actions, undo, readiness, resets, map reports, corrections and
  the organizer's controls in one place. The few room-moving writes that emit
  nothing stage it themselves: team changes through
  :func:`request_room_reconcile`, stage activation through
  :func:`request_stage_reconcile`, pick-ban config edits through
  :func:`request_tournament_reconcile`;
* a one-second DUE-ROOM tick, for the only change nothing writes: a step's
  timer running out;
* a one-minute BACKSTOP sweep, for writes that happen in another service
  entirely (stats-service finalizing a map, app-service CRUD) and so never
  reach this process's commit hooks.

The trigger stages onto the session exactly the way ``shared.services.realtime.
emit`` stages its events -- same ``session.info`` dict, same both-rollback-hooks
drop -- because it has the same requirement: a reconcile describing a write that
was rolled back must not run, and a unit test's stand-in session must not
explode for lacking hooks to hang it on.

Each sweep passes ``skip_locked=True``: tournament-service runs two replicas and
both schedule these jobs, and a room another writer already holds needs no
second healer waiting behind them.
"""

from __future__ import annotations

import asyncio
from typing import Any

from loguru import logger
from sqlalchemy import event, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session

from shared.core.enums import (
    EncounterStatus,
    MapVetoSessionStatus,
    TournamentStatus,
)
from shared.domain import pick_ban_rules as pbr
from shared.models.encounter.encounter import Encounter
from shared.models.encounter.pick_ban import PickBanSession, PickBanSubmission
from shared.models.encounter.team import EncounterTeam
from shared.models.tournament.bracket_encounter import BracketEncounter
from shared.models.tournament.stage import Stage
from shared.models.tournament.tournament import Tournament
from src.core import db
from src.services.encounter.veto_session import ROOM_SLOT_COUNT

__all__ = (
    "reconcile_due_rooms",
    "reconcile_encounter",
    "reconcile_stalled_rooms",
    "request_room_reconcile",
    "request_stage_reconcile",
    "request_tournament_reconcile",
)

_STAGED_KEY = "pick_ban_reconcile_staged"
_SAVEPOINTS_KEY = "pick_ban_reconcile_savepoints"

# asyncio keeps only a weak reference to a running task, so a fire-and-forget
# reconcile whose handle nobody holds can be collected mid-flight.
_background_tasks: set[asyncio.Task[Any]] = set()

#: Scopes whose reconcile is queued but has not started yet. A burst of writes
#: on one room (both captains locking a blind step, say) then costs one pass,
#: not one per write -- and the pass reads the state AFTER all of them.
_queued: set[tuple[str, int]] = set()


def _service() -> Any:
    """``pick_ban_action_service``, imported on use.

    At module scope it would be a cycle: ``pick_ban_action`` imports
    ``realtime_commit`` for the room's signal, and ``realtime_commit`` imports
    this module for the trigger that rides along with it.
    """
    from src.services.encounter.pick_ban_action import pick_ban_action_service

    return pick_ban_action_service


def _stage(session: Any, scope: tuple[str, int]) -> None:
    sync_session = getattr(session, "sync_session", None)
    info = getattr(sync_session or session, "info", None)
    # A real Session.info is always a dict. Anything else means this is not a
    # session at all (a stand-in in a unit test), and there is nothing to hang
    # the commit hook on -- those suites reconcile explicitly instead.
    if not isinstance(info, dict):
        return
    info.setdefault(_STAGED_KEY, set()).add(scope)


def request_room_reconcile(session: Any, encounter_id: int) -> None:
    """Heal ``encounter_id``'s room once this transaction commits.

    Idempotent per transaction and safe to call from anywhere in a room write --
    the reconcile itself runs in a FRESH session, after the commit, so it sees
    the write it was asked about and holds no lock the caller still needs.
    """
    _stage(session, ("encounter", int(encounter_id)))


def request_tournament_reconcile(session: Any, tournament_id: int) -> None:
    """Heal every in-play room of one tournament once this commits.

    For writes that change what a room's RULES are rather than its state -- a
    pick-ban config created, edited or deleted. Every encounter the cascade may
    now resolve differently has to re-answer "is a session owed", and nothing
    about those encounters themselves is written for a per-room trigger to ride
    on. WHICH encounters those are is resolved in the background pass, not here:
    a config write reads and writes config rows only.
    """
    _stage(session, ("tournament", int(tournament_id)))


def request_stage_reconcile(session: Any, stage_id: int) -> None:
    """Heal every room of a stage once this commits.

    ``Stage.is_published`` IS the gate ``creation_plan`` reads, so activating a
    stage turns a preview bracket's encounters into playable rooms without
    writing anything on the encounters themselves.
    """
    _stage(session, ("stage", int(stage_id)))


@event.listens_for(Session, "after_commit")
def _run_staged(session: Session) -> None:
    if session.in_nested_transaction():
        return  # a SAVEPOINT release is not a commit: nothing may run before the root commit
    staged: set[tuple[str, int]] = session.info.pop(_STAGED_KEY, set())
    if not staged:
        return
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        logger.warning("Cannot reconcile pick-ban rooms without a running event loop")
        return
    for scope in sorted(staged):
        if scope in _queued:
            continue
        _queued.add(scope)
        task = loop.create_task(_reconcile_in_new_session(scope))
        _background_tasks.add(task)
        task.add_done_callback(_background_tasks.discard)


# Rollback hooks, split so a SAVEPOINT rollback only forgets what the savepoint staged (the snapshot taken when it
# opened comes back) while a root rollback drops everything. ``after_rollback`` fires only when a DBAPI transaction
# was actually begun, so both it and ``after_soft_rollback`` stay: a session that staged a reconcile and rolled back
# before touching the database would otherwise run it on its NEXT commit.
@event.listens_for(Session, "after_transaction_create")
def _snapshot_at_savepoint(session: Session, transaction: Any) -> None:
    if transaction.nested:
        session.info.setdefault(_SAVEPOINTS_KEY, {})[transaction] = set(session.info.get(_STAGED_KEY, ()))


@event.listens_for(Session, "after_transaction_end")
def _forget_savepoint(session: Session, transaction: Any) -> None:
    if transaction.nested:
        session.info.get(_SAVEPOINTS_KEY, {}).pop(transaction, None)


@event.listens_for(Session, "after_rollback")
def _drop_staged_on_rollback(session: Session) -> None:
    nested = session.get_nested_transaction()
    snapshots: dict[Any, set[tuple[str, int]]] = session.info.get(_SAVEPOINTS_KEY, {})
    if nested is not None and nested in snapshots:
        restored = snapshots[nested]
        if restored:
            session.info[_STAGED_KEY] = restored
        else:
            session.info.pop(_STAGED_KEY, None)
        return
    session.info.pop(_STAGED_KEY, None)


@event.listens_for(Session, "after_soft_rollback")
def _drop_staged_on_soft_rollback(session: Session, previous_transaction: Any) -> None:
    if not previous_transaction.nested:
        session.info.pop(_STAGED_KEY, None)


async def _reconcile_in_new_session(scope: tuple[str, int]) -> None:
    # Released before the work starts, not after: a write landing WHILE this
    # pass runs happened after the state it read, and owes its own pass.
    _queued.discard(scope)
    kind, scope_id = scope
    try:
        async with db.async_session_maker() as session:
            for encounter_id in await _encounters_of(session, kind, scope_id):
                await reconcile_encounter(session, encounter_id)
    except Exception:
        logger.exception("Pick-ban room reconcile failed", scope=kind, scope_id=scope_id)


def _fully_seated() -> Any:
    """ "Every slot of the card has a live participation" as one predicate.

    The sweeps used to ask ``home_team_id IS NOT NULL AND away_team_id IS NOT
    NULL``; counting the live seats is the same question for a card of any
    width, and it is the same one ``creation_plan`` asks.
    """
    return (
        select(func.count())
        .select_from(EncounterTeam)
        .where(EncounterTeam.encounter_id == Encounter.id, EncounterTeam.active.is_(True))
        .correlate(Encounter)
        .scalar_subquery()
    ) == Encounter.slot_count


async def _encounters_of(session: AsyncSession, kind: str, scope_id: int) -> list[int]:
    """The rooms one staged scope covers."""
    if kind == "encounter":
        return [scope_id]
    query = select(Encounter.id).where(
        Encounter.slot_count == ROOM_SLOT_COUNT,
        Encounter.status != EncounterStatus.COMPLETED,
        _fully_seated(),
    )
    if kind == "tournament":
        query = query.where(Encounter.tournament_id == scope_id)
    else:
        query = query.join(BracketEncounter, BracketEncounter.encounter_id == Encounter.id).where(
            BracketEncounter.stage_id == scope_id
        )
    result = await session.execute(query)
    return sorted(result.scalars().all())


async def reconcile_encounter(session: AsyncSession, encounter_id: int, *, skip_locked: bool = False) -> bool:
    """One room, healed. The entry point every trigger and sweep shares."""
    return bool(await _service().reconcile_room(session, encounter_id, skip_locked=skip_locked))


async def _sweep(session: AsyncSession, encounter_ids: list[int]) -> None:
    """Heal each room, isolated from the others.

    A room whose config the organizer broke answers with a 422 rather than a
    heal; letting that escape would take the whole tick down and freeze every
    OTHER room's clock with it.
    """
    for encounter_id in encounter_ids:
        try:
            await reconcile_encounter(session, encounter_id, skip_locked=True)
        except Exception:
            logger.exception("Pick-ban room reconcile failed", encounter_id=encounter_id)
            await session.rollback()


async def reconcile_due_rooms() -> None:
    """Every second: settle the rooms whose clock has run out.

    A step's timer expiring is the one thing that moves a room with nobody
    writing anything, so it is the one thing a post-commit trigger cannot catch.
    The due set is computed from two batched queries and a pure Python check
    (``session_pending``) -- never one query per room -- and only genuinely due
    rooms are then locked.
    """
    async with db.async_session_maker() as session:
        sessions = list(
            (
                await session.execute(
                    select(PickBanSession)
                    .join(Encounter, Encounter.id == PickBanSession.encounter_id)
                    .where(
                        PickBanSession.status == MapVetoSessionStatus.ACTIVE,
                        # A paused room is untimed (``step_deadline``), so it can
                        # never be due; excluded in SQL to keep the scan small.
                        PickBanSession.paused_at.is_(None),
                        # Rooms abandoned mid-veto on a finished match stay ACTIVE
                        # forever; ``reconcile_room`` refuses them anyway.
                        Encounter.status != EncounterStatus.COMPLETED,
                    )
                )
            )
            .scalars()
            .all()
        )
        if not sessions:
            return
        submissions: dict[int, list[PickBanSubmission]] = {}
        rows = await session.execute(
            select(PickBanSubmission).where(PickBanSubmission.session_id.in_([row.id for row in sessions]))
        )
        for row in rows.scalars().all():
            submissions.setdefault(row.session_id, []).append(row)
        # One seat read for the whole batch: a sequence written before §13.4
        # still names slots, and translating it needs the encounter's seats.
        slots: dict[int, dict[int, int]] = {}
        seats = await session.execute(
            select(EncounterTeam).where(
                EncounterTeam.encounter_id.in_({row.encounter_id for row in sessions}),
                EncounterTeam.active.is_(True),
            )
        )
        for seat in seats.scalars().all():
            slots.setdefault(seat.encounter_id, {})[seat.slot] = seat.id

        actions = _service()
        due = sorted(
            {
                row.encounter_id
                for row in sessions
                if actions.session_pending(
                    row,
                    pbr.resolved_steps_from_json(
                        list(row.resolved_sequence_json or []),
                        actors_by_slot=slots.get(row.encounter_id, {}),
                    ),
                    submissions.get(row.id, []),
                )
            }
        )
        await _sweep(session, due)


async def reconcile_stalled_rooms() -> None:
    """Every minute: catch up rooms whose last mover was another service.

    stats-service finalizing a map and app-service's encounter CRUD commit in
    their own processes, so no commit hook here ever sees them. The sweep is
    bounded to encounters that can still be played -- every slot seated, a live
    tournament, a non-terminal status, a published stage (or none) -- and every
    one of them is prechecked unlocked before anything is locked.
    """
    async with db.async_session_maker() as session:
        result = await session.execute(
            select(Encounter.id)
            .join(Tournament, Tournament.id == Encounter.tournament_id)
            .outerjoin(BracketEncounter, BracketEncounter.encounter_id == Encounter.id)
            .outerjoin(Stage, Stage.id == BracketEncounter.stage_id)
            .where(
                Encounter.slot_count == ROOM_SLOT_COUNT,
                Encounter.status != EncounterStatus.COMPLETED,
                _fully_seated(),
                Tournament.status.notin_((TournamentStatus.COMPLETED, TournamentStatus.ARCHIVED)),
                or_(BracketEncounter.stage_id.is_(None), Stage.is_published.is_(True)),
            )
        )
        await _sweep(session, sorted(result.scalars().all()))
