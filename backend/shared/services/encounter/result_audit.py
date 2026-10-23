"""The single way to append to an encounter's result history.

``before``/``after`` are arrays of ``{encounter_team_id, score, placement}``,
so a duel and an N-seat lobby are recorded identically and a reader never has
to know which shape it is looking at. The "after" half is read off the
participations the caller has just written, so it cannot disagree with what
actually landed.

Never commits: the row rides the caller's transaction, so a rolled-back result
leaves no trail of having happened.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from shared.core.enums import AuditSnapshotScope, EncounterResultAuditAction, EncounterResultStatus
from shared.models.encounter.audit import EncounterResultAudit
from shared.models.encounter.encounter import Encounter
from shared.models.encounter.game import EncounterGame
from shared.models.encounter.team import EncounterTeam
from shared.repository import EncounterResultAuditRepository

__all__ = ("record_result_transition", "snapshot")

_result_audit = EncounterResultAuditRepository()


def snapshot(participations: Sequence[EncounterTeam]) -> list[dict[str, Any]]:
    """One standing as the journal stores it, in the order the seats are read."""
    return [{"encounter_team_id": seat.id, "score": seat.score, "placement": seat.placement} for seat in participations]


def record_result_transition(
    session: AsyncSession,
    encounter: Encounter,
    *,
    action: EncounterResultAuditAction,
    source: str,
    actor_user_id: int | None = None,
    from_result_status: EncounterResultStatus | None = None,
    before: list[dict[str, Any]] | None = None,
    after: list[dict[str, Any]],
    scope: AuditSnapshotScope = AuditSnapshotScope.ENCOUNTER,
    game: EncounterGame | None = None,
    adopted_team_id: int | None = None,
    reason: str | None = None,
) -> EncounterResultAudit:
    """Append one transition row. ``actor_user_id=None`` means a machine actor.

    ``result_version`` is read off the encounter the caller has already
    bumped: the journal IS the version sequence (``uq_result_audit_version``),
    so a second row for one version is a constraint violation rather than a
    silent duplicate.
    """
    row = EncounterResultAudit(
        encounter_id=encounter.id,
        result_version=encounter.result_version,
        snapshot_scope=scope.value,
        game_id=None if game is None else game.id,
        game_result_version=None if game is None else game.result_version,
        actor_user_id=actor_user_id,
        action=action,
        from_result_status=from_result_status,
        to_result_status=encounter.result_status,
        before=before,
        after=after,
        adopted_team_id=adopted_team_id,
        reason=reason,
        source=source,
    )
    return _result_audit.add(session, row)
