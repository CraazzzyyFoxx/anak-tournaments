from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime

__all__ = (
    "BackfillPlan",
    "PlannedWorkspacePlayer",
    "RegistrationBackfillRow",
    "RoleBackfillRow",
    "plan_backfill",
)

_MIN = datetime.min.replace(tzinfo=UTC)


@dataclass(frozen=True, slots=True)
class RoleBackfillRow:
    role: str
    rank_value: int | None
    updated_at: datetime | None = None


@dataclass(frozen=True, slots=True)
class RegistrationBackfillRow:
    id: int
    workspace_id: int
    battle_tag: str | None
    battle_tag_normalized: str | None
    display_name: str | None
    player_id: int | None
    overridden_at: datetime | None
    roles: Sequence[RoleBackfillRow] = ()
    submitted_at: datetime | None = None
    updated_at: datetime | None = None


@dataclass(frozen=True, slots=True)
class PlannedWorkspacePlayer:
    workspace_id: int
    battle_tag_normalized: str
    battle_tag: str | None
    display_name: str | None
    player_id: int | None
    ranks: dict[str, int]
    registration_ids: tuple[int, ...]


@dataclass(frozen=True, slots=True)
class BackfillPlan:
    players: tuple[PlannedWorkspacePlayer, ...]
    pin_ids: frozenset[int]


def _when(value: datetime | None) -> datetime:
    if value is None:
        return _MIN
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value


def _row_when(row: RegistrationBackfillRow) -> tuple[datetime, int]:
    times = [row.updated_at, row.submitted_at, *(role.updated_at for role in row.roles)]
    stamped = [_when(t) for t in times if t is not None]
    return (max(stamped, default=_MIN), row.id)


def plan_backfill(rows: Sequence[RegistrationBackfillRow]) -> BackfillPlan:
    groups: dict[tuple[int, str], list[RegistrationBackfillRow]] = {}
    for row in rows:
        tag = row.battle_tag_normalized
        if not tag:
            continue
        groups.setdefault((row.workspace_id, tag), []).append(row)

    claimed: set[tuple[int, int]] = set()
    players: list[PlannedWorkspacePlayer] = []
    pin_ids: set[int] = set()
    for key in sorted(groups):
        group = groups[key]
        latest = max(group, key=_row_when)
        player_id = next((row.player_id for row in sorted(group, key=_row_when, reverse=True) if row.player_id), None)
        if player_id is not None:
            claim = (key[0], player_id)
            if claim in claimed:
                player_id = None
            else:
                claimed.add(claim)

        best: dict[str, tuple[datetime, int, int]] = {}
        for row in group:
            for role in row.roles:
                if role.rank_value is None:
                    continue
                stamp = (_when(role.updated_at), row.id)
                prev = best.get(role.role)
                if prev is None or stamp > prev[:2]:
                    best[role.role] = (*stamp, role.rank_value)
        ranks = {role: value for role, (*_, value) in best.items()}

        for row in group:
            if row.overridden_at is not None:
                pin_ids.add(row.id)
                continue
            if any(
                role.rank_value is not None
                and (canon := ranks.get(role.role)) is not None
                and role.rank_value != canon
                for role in row.roles
            ):
                pin_ids.add(row.id)

        players.append(
            PlannedWorkspacePlayer(
                workspace_id=key[0],
                battle_tag_normalized=key[1],
                battle_tag=latest.battle_tag,
                display_name=latest.display_name,
                player_id=player_id,
                ranks=ranks,
                registration_ids=tuple(sorted(row.id for row in group)),
            )
        )
    return BackfillPlan(players=tuple(players), pin_ids=frozenset(pin_ids))
