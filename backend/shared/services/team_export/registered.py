"""Synthesize a materialization payload from pre-formed registered teams.

Decision 14 of ``docs/plans/2026-08-20-team-registration.md``: rather than adding a
third direct writer of ``tournament.team``/``tournament.player``, a registered team
is turned into the same :class:`MaterializationTeam` payload the balancer and draft
exports already produce, and handed to the same orchestrator. Battle-tag
resolution, name dedup, newcomer computation and the slot -> ``HeroClass`` mapping
all come for free and cannot drift.

Two rules here are borrowed rather than invented, deliberately:

* **Rank.** ``BalancerRegistrationRole.rank_value`` is nullable but
  ``Player.rank`` is ``NOT NULL``. A missing rank becomes ``0`` — the same answer
  ``registration/export.py`` gives when building the balancer pool. Raising
  instead would make the feature unusable for tournaments that never collect
  ranks.
* **Which rank.** Mirrors ``draft/ranks.py``: on a role shape the rank is
  role-specific with the primary role as fallback; on a role-less (all-``flex``)
  roster it is the member's best across every role they carry one for.

Members are passed with ``workspace_member_id`` already set, so the seam's
"silently skipped because the battle tag did not resolve" branch — the one that
can produce an under-sized roster with no error — is unreachable on this path.
"""

from __future__ import annotations

import logging
from collections.abc import Sequence
from dataclasses import dataclass, field

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from shared.domain.roster_shape import FLEX_SLOT_CODE, RosterShape
from shared.models.registration.registration import (
    BalancerRegistration,
    BalancerRegistrationRole,
    BalancerRegistrationTeam,
)
from shared.models.tenancy.workspace import WorkspaceMember
from shared.services.team_export.materialization import MaterializationMember, MaterializationTeam

__all__ = (
    "RegisteredExportPayload",
    "SkippedTeam",
    "build_registered_export",
    "registration_slot_rank",
)

logger = logging.getLogger(__name__)

#: Statuses that mean a member is not on the roster (their slot was released).
_RELEASED_STATUSES = frozenset({"withdrawn", "rejected"})
#: Only a complete team may be materialized: an incomplete one would produce an
#: under-sized ``tournament.team``, which the bracket then treats as real.
_EXPORTABLE_STATUS = "complete"


@dataclass(frozen=True)
class SkippedTeam:
    """A team the export deliberately left behind, with a machine-readable why."""

    team_id: int
    name: str
    code: str


@dataclass
class RegisteredExportPayload:
    teams: list[MaterializationTeam] = field(default_factory=list)
    #: ``tournament.team`` ids from a previous export of these same registered
    #: teams — deleted and rebuilt, so a re-export is idempotent rather than
    #: additive.
    prior_team_ids: list[int] = field(default_factory=list)
    skipped: list[SkippedTeam] = field(default_factory=list)
    #: The source rows, for the finalize/unlink hooks to stamp.
    source_teams: list[BalancerRegistrationTeam] = field(default_factory=list)


def registration_slot_rank(
    role_ranks: dict[str, int],
    slot_code: str | None,
    shape: RosterShape,
    *,
    primary_rank: int | None = None,
) -> int:
    """The rank representing a member on their roster slot.

    Mirrors :func:`balancer-service ... draft.ranks.slot_rank`. Returns ``0`` for
    "no rank recorded", matching ``registration/export.py``'s ``build_class``,
    because ``Player.rank`` cannot be NULL.
    """
    if not shape.has_role_slots:
        # Role-less roster: no role for rank to be a function of, so take the best
        # the member demonstrably has.
        candidates = [*role_ranks.values()]
        if primary_rank is not None:
            candidates.append(primary_rank)
        return max(candidates, default=0)
    if slot_code is not None and slot_code != FLEX_SLOT_CODE:
        exact = role_ranks.get(slot_code)
        if exact is not None:
            return exact
    # A flex slot on a role shape, or a role with no rank of its own: fall back to
    # the primary role's rank, exactly as ``role_rank`` does.
    if primary_rank is not None:
        return primary_rank
    return max([*role_ranks.values()], default=0)


def _role_view(roles: Sequence[BalancerRegistrationRole]) -> tuple[dict[str, int], int | None]:
    """``({role_code: rank}, primary_rank)`` from a registration's role rows."""
    role_ranks: dict[str, int] = {}
    primary_rank: int | None = None
    for role in sorted(roles, key=lambda entry: entry.priority):
        if role.rank_value is None:
            continue
        role_ranks.setdefault(role.role, int(role.rank_value))
        if role.is_primary and primary_rank is None:
            primary_rank = int(role.rank_value)
    if primary_rank is None:
        # No role flagged primary: the lowest-priority entry is the de-facto
        # default, which is the order ``export.py`` already sorts by.
        ordered = [role for role in sorted(roles, key=lambda e: e.priority) if role.rank_value is not None]
        primary_rank = int(ordered[0].rank_value) if ordered else None
    return role_ranks, primary_rank


def _sub_role_for(roles: Sequence[BalancerRegistrationRole], slot_code: str | None) -> str | None:
    if slot_code is None:
        return None
    for role in sorted(roles, key=lambda entry: entry.priority):
        if role.role == slot_code and role.subrole:
            return role.subrole
    return None


def _member_name(registration: BalancerRegistration) -> str:
    return registration.battle_tag or registration.display_name or f"registration-{registration.id}"


async def build_registered_export(
    session: AsyncSession,
    tournament_id: int,
    shape: RosterShape,
    *,
    team_ids: Sequence[int] | None = None,
) -> RegisteredExportPayload:
    """Turn this tournament's complete registered teams into an export payload.

    ``team_ids`` narrows to a subset (one organizer exporting one team); omitted,
    every complete team is taken. Incomplete and terminal teams are reported in
    ``skipped`` rather than silently dropped — §12.5's whole point is that the
    people in a stuck team must be told.
    """
    payload = RegisteredExportPayload()

    conditions = [
        BalancerRegistrationTeam.tournament_id == tournament_id,
        BalancerRegistrationTeam.deleted_at.is_(None),
    ]
    if team_ids is not None:
        conditions.append(BalancerRegistrationTeam.id.in_(list(team_ids)))
    teams = list(
        await session.scalars(
            sa.select(BalancerRegistrationTeam).where(*conditions).order_by(BalancerRegistrationTeam.name_normalized)
        )
    )
    if not teams:
        return payload

    # One query for every roster row across every team, with roles eager-loaded:
    # the per-member role fan would otherwise be O(members) round-trips.
    rosters = list(
        await session.scalars(
            sa.select(BalancerRegistration)
            .where(
                BalancerRegistration.registration_team_id.in_([team.id for team in teams]),
                BalancerRegistration.deleted_at.is_(None),
                BalancerRegistration.status.notin_(_RELEASED_STATUSES),
            )
            .options(selectinload(BalancerRegistration.roles))
        )
    )
    members_by_team: dict[int, list[BalancerRegistration]] = {}
    for registration in rosters:
        members_by_team.setdefault(registration.registration_team_id or 0, []).append(registration)

    # The captain is identified by a player id, not a battle tag, so the seam does
    # not have to resolve a tag that may not exist.
    captain_registration_ids = [team.captain_registration_id for team in teams if team.captain_registration_id]
    captain_player_by_registration: dict[int, int] = {}
    if captain_registration_ids:
        rows = (
            await session.execute(
                sa.select(BalancerRegistration.id, WorkspaceMember.player_id)
                .join(WorkspaceMember, WorkspaceMember.id == BalancerRegistration.workspace_member_id)
                .where(BalancerRegistration.id.in_(captain_registration_ids))
            )
        ).all()
        captain_player_by_registration = dict(rows)

    for team in teams:
        if team.status != _EXPORTABLE_STATUS:
            payload.skipped.append(SkippedTeam(team_id=team.id, name=team.name, code="team_incomplete"))
            continue
        roster = members_by_team.get(team.id, [])
        if not roster:
            payload.skipped.append(SkippedTeam(team_id=team.id, name=team.name, code="team_empty"))
            continue

        members: list[MaterializationMember] = []
        for registration in roster:
            role_ranks, primary_rank = _role_view(registration.roles)
            members.append(
                MaterializationMember(
                    name=_member_name(registration),
                    rank=registration_slot_rank(
                        role_ranks,
                        registration.team_slot_code,
                        shape,
                        primary_rank=primary_rank,
                    ),
                    slot_code=registration.team_slot_code,
                    sub_role=_sub_role_for(registration.roles, registration.team_slot_code),
                    battle_tag=registration.battle_tag,
                    workspace_member_id=registration.workspace_member_id,
                    is_substitute=bool(registration.is_substitute),
                )
            )

        payload.teams.append(
            MaterializationTeam(
                # The registered name IS the balancer name here: there is no
                # captain tag standing in for it. ``create_team`` rejects "#" in a
                # team name precisely because the seam splits on it to derive
                # ``Team.name``.
                balancer_name=team.name,
                members=tuple(members),
                captain_player_id=(
                    captain_player_by_registration.get(team.captain_registration_id)
                    if team.captain_registration_id
                    else None
                ),
            )
        )
        payload.source_teams.append(team)
        if team.exported_team_id is not None:
            payload.prior_team_ids.append(team.exported_team_id)

    return payload
