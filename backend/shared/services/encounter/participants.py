"""The only writer of an encounter's seats (D55, D56).

A participation is append-only. Taking a seat from one team and giving it to
another is :func:`vacate_slot` followed by :func:`place_team`: the retired row
stays, inactive, with the games it played, the claims it filed and the journal
entries that name it still pointing at it. That is what makes "who actually
played this map" answerable after a bracket correction — the question the old
``encounter.home_team_id`` could not answer, because it was simply overwritten.

Like the result writer beside it, nothing here commits: every change rides the
caller's transaction, so a rolled-back correction leaves no half-moved seat.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, replace

from sqlalchemy.ext.asyncio import AsyncSession

from shared.core import enums, http_status
from shared.core.errors import BaseAPIException
from shared.models.encounter.encounter import Encounter
from shared.models.encounter.team import EncounterTeam, EncounterTeamMember, EncounterTeamMemberRole
from shared.repository import (
    EncounterGameRepository,
    EncounterTeamMemberRepository,
    EncounterTeamMemberRoleRepository,
    EncounterTeamRepository,
)
from shared.services.encounter.game_audit import cancel_games

__all__ = (
    "MemberSnapshot",
    "active_teams",
    "add_substitute",
    "place_team",
    "vacate_slot",
)

_teams = EncounterTeamRepository()
_members = EncounterTeamMemberRepository()
_roles = EncounterTeamMemberRoleRepository()
_games = EncounterGameRepository()


@dataclass(frozen=True, slots=True)
class MemberSnapshot:
    """One roster member as the encounter will remember them.

    Everything is a copy taken at placement time: the workspace member is the
    anchor (D66), the rest is what was true when the seat was filled, so a
    renamed account or a re-ranked player does not rewrite history.
    """

    workspace_member_id: int
    display_name: str
    rank: int | None
    is_substitute: bool
    #: ``(dimension, role)`` pairs, e.g. ``("player_role", "tank")``; a sub-role
    #: is a second pair, not a second field (D36, D67).
    roles: tuple[tuple[str, str], ...]


async def active_teams(session: AsyncSession, encounter_id: int) -> list[EncounterTeam]:
    """The live seats, in slot order. Retired participations are history."""
    return list(await _teams.list_active(session, encounter_id))


async def place_team(
    session: AsyncSession,
    encounter: Encounter,
    *,
    slot: int,
    team_id: int | None,
    name: str,
    seed: int | None,
    members: Sequence[MemberSnapshot],
) -> EncounterTeam:
    """Seat ``team_id`` in ``slot`` and snapshot its roster.

    Refuses a slot outside the card and a slot that is already taken: filling
    an occupied seat is always two decisions (who leaves, who arrives), and
    making the caller spell out the first is what keeps the leaving team's
    games attached to the row that played them.

    ``team_id`` may be ``None`` for a seat with no tournament team behind it;
    ``name`` is the snapshot that survives the source team's deletion.
    """
    if not 1 <= slot <= encounter.slot_count:
        raise BaseAPIException(
            status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Slot {slot} is outside this encounter's seats (1..{encounter.slot_count})",
        )
    if await _teams.get_active_slot(session, encounter.id, slot) is not None:
        raise BaseAPIException(
            status_code=http_status.HTTP_409_CONFLICT,
            detail=f"Slot {slot} is already taken — vacate it before seating another team",
        )
    participation = await _teams.create(
        session,
        EncounterTeam(
            encounter_id=encounter.id,
            tournament_id=encounter.tournament_id,
            slot=slot,
            team_id=team_id,
            name=name,
            seed=seed,
            active=True,
        ),
    )
    for member in members:
        await _snapshot_member(session, participation, member)
    return participation


async def vacate_slot(session: AsyncSession, encounter: Encounter, *, slot: int) -> EncounterTeam | None:
    """Retire the seat's occupant; ``None`` when it was empty.

    The positions this encounter has not played yet go with it — a planned or
    awaiting-result game belongs to the line-up that was supposed to play it,
    and keeping it would hand the next occupant someone else's fixture. A
    CONFIRMED game is history and stays with the participation that played it;
    dropping its points from the standing is the result writer's job, through
    the one write the caller makes next.

    The retired roster follows on its own: ``team_member.active`` is carried
    by ``fk_team_member_team``'s ON UPDATE CASCADE, which is what lets the
    partial index say "one active seat per member per encounter" without a
    trigger. Writing those rows here too would be a second author of one fact.
    """
    participation = await _teams.get_active_slot(session, encounter.id, slot)
    if participation is None:
        return None
    await _teams.update_fields(session, participation, {"active": False})
    unplayed = [
        game
        for game in await _games.list_for_encounter(session, encounter.id)
        if game.state != enums.EncounterGameState.CONFIRMED
    ]
    cancel_games(unplayed)
    await session.flush()
    return participation


async def add_substitute(
    session: AsyncSession, participation: EncounterTeam, member: MemberSnapshot
) -> EncounterTeamMember:
    """Seat a player who joined the roster mid-encounter (D19).

    The flag is forced rather than read off the snapshot: a player added after
    the line-up was taken IS the substitute, whatever the caller filled in.
    """
    return await _snapshot_member(session, participation, replace(member, is_substitute=True))


async def _snapshot_member(
    session: AsyncSession, participation: EncounterTeam, member: MemberSnapshot
) -> EncounterTeamMember:
    row = await _members.create(
        session,
        EncounterTeamMember(
            encounter_id=participation.encounter_id,
            encounter_team_id=participation.id,
            # Copied, not derived: the composite FK carries it forward from here.
            active=participation.active,
            workspace_member_id=member.workspace_member_id,
            display_name_snapshot=member.display_name,
            rank=member.rank,
            is_substitute=member.is_substitute,
        ),
    )
    if member.roles:
        await _roles.create_many(
            session,
            [
                EncounterTeamMemberRole(team_member_id=row.id, dimension=dimension, role=role)
                for dimension, role in member.roles
            ],
        )
    return row
