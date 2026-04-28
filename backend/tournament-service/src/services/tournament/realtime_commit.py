from __future__ import annotations

import asyncio
from collections.abc import Iterable
from typing import Any, Literal

from loguru import logger
from sqlalchemy import event
from sqlalchemy.orm import Session

TournamentRealtimeReason = Literal["results_changed", "structure_changed"]

_SESSION_KEY = "tournament_realtime_updates"
_RESULTS_CHANGED: TournamentRealtimeReason = "results_changed"
_STRUCTURE_CHANGED: TournamentRealtimeReason = "structure_changed"


def _normalize_reason(reason: str) -> TournamentRealtimeReason | None:
    if reason == _RESULTS_CHANGED:
        return _RESULTS_CHANGED
    if reason == _STRUCTURE_CHANGED:
        return _STRUCTURE_CHANGED
    return None


def _merge_updates(
    updates: Iterable[tuple[int, TournamentRealtimeReason]],
) -> list[tuple[int, TournamentRealtimeReason]]:
    reasons_by_tournament: dict[int, set[TournamentRealtimeReason]] = {}
    for tournament_id, reason in updates:
        reasons_by_tournament.setdefault(tournament_id, set()).add(reason)

    merged: list[tuple[int, TournamentRealtimeReason]] = []
    for tournament_id, reasons in sorted(reasons_by_tournament.items()):
        if _STRUCTURE_CHANGED in reasons:
            merged.append((tournament_id, _STRUCTURE_CHANGED))
        elif _RESULTS_CHANGED in reasons:
            merged.append((tournament_id, _RESULTS_CHANGED))
    return merged


def register_tournament_realtime_update(
    session: Any,
    tournament_id: int,
    reason: TournamentRealtimeReason | str,
) -> None:
    normalized_reason = _normalize_reason(str(reason))
    if normalized_reason is None:
        logger.warning(
            "Ignoring tournament realtime update with unsupported reason",
            tournament_id=tournament_id,
            reason=reason,
        )
        return

    sync_session = getattr(session, "sync_session", None)
    info = getattr(sync_session or session, "info", None)
    if info is None:
        return

    updates = info.setdefault(_SESSION_KEY, set())
    updates.add((int(tournament_id), normalized_reason))


def pop_registered_tournament_realtime_updates(
    session: Any,
) -> list[tuple[int, TournamentRealtimeReason]]:
    sync_session = getattr(session, "sync_session", None)
    info = getattr(sync_session or session, "info", None)
    if info is None:
        return []

    updates = info.pop(_SESSION_KEY, set())
    return _merge_updates(updates)


async def publish_tournament_realtime_updates(
    updates: Iterable[tuple[int, TournamentRealtimeReason]],
) -> None:
    from src.services.tournament.realtime_pubsub import publish_tournament_update

    for tournament_id, reason in updates:
        try:
            await publish_tournament_update(tournament_id, reason)
        except Exception:
            logger.exception(
                "Failed to publish tournament realtime update",
                tournament_id=tournament_id,
                reason=reason,
            )


@event.listens_for(Session, "after_commit")
def _publish_registered_updates_after_commit(session: Session) -> None:
    updates = pop_registered_tournament_realtime_updates(session)
    if not updates:
        return

    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        logger.warning("Cannot publish tournament realtime updates without a running event loop")
        return

    loop.create_task(publish_tournament_realtime_updates(updates))


@event.listens_for(Session, "after_rollback")
def _clear_registered_updates_after_rollback(session: Session) -> None:
    pop_registered_tournament_realtime_updates(session)
