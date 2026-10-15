"""Advancement: a bracket moves PLACES into SEATS (D13, D55, D65).

An ``EncounterLink`` says "whoever finished at ``source_position`` of this
encounter takes ``target_slot`` of that one". There is no winner/loser enum and
no home/away: a lobby that pays out four places wires up exactly like a duel.

Two entry points, and the split between them is the point:

* :func:`advance_after_result` only ever FILLS empty seats. It reads the
  standing the result writer materialised on the participations, resolves each
  linked position, and seats the team. A position two teams share blocks: it is
  reported, not guessed.
* :func:`reset_downstream` is the destructive half. It retires the seats this
  encounter filled, cancels the games those seats had not played, and
  re-materialises each target's standing -- recursively, because a correction
  three rounds up invalidates everything below it. It takes the admin's id,
  because taking a decided result off an encounter is :func:`reopen`, and that
  is a human act.

A correction is therefore the two of them in order: reopen, reset downstream,
write the new result, advance. Calling :func:`advance_after_result` into a seat
another team still holds is a 409 from the participation writer, which is the
caller being told it skipped the reset.

Nothing here commits; every change rides the caller's transaction.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field

import sqlalchemy as sa
from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession

from shared.core import enums
from shared.domain.encounter_naming import build_encounter_name
from shared.models.encounter.encounter import Encounter
from shared.models.encounter.game import EncounterGame
from shared.models.encounter.team import EncounterTeam, EncounterTeamMember, EncounterTeamMemberRole
from shared.models.tournament.bracket_encounter import BracketEncounter
from shared.models.tournament.encounter_link import EncounterLink
from shared.models.tournament.stage import Stage
from shared.services.bracket.types import AdvancementEdge
from shared.services.encounter.participants import MemberSnapshot, active_teams, place_team, vacate_slot
from shared.services.encounter.result import lock_encounter, refresh_from_games, reopen

__all__ = (
    "AdvanceOutcome",
    "SlotSource",
    "advance_after_result",
    "persist_advancement_edges",
    "reset_downstream",
    "resolve_slot_sources",
)

#: What a bracket cascade writes into the result journal.
_AUDIT_SOURCE = "bracket"


@dataclass(frozen=True)
class SlotSource:
    """One incoming advancement edge, from the target's point of view: ``slot``
    is filled by whoever finishes at ``source_position`` of ``encounter_id``."""

    encounter_id: int
    source_position: int
    slot: int


@dataclass(frozen=True)
class AdvanceOutcome:
    """What one advancement pass did.

    ``placed`` is ``(target encounter id, slot)`` per seat filled.
    ``blocked_positions`` are the linked positions this encounter's standing
    does not resolve to exactly one team -- a draw shares a place, so nobody
    advances out of it until an admin breaks the tie.
    """

    placed: list[tuple[int, int]] = field(default_factory=list)
    blocked_positions: list[int] = field(default_factory=list)


async def resolve_slot_sources(session: AsyncSession, encounter_ids: Iterable[int]) -> dict[int, list[SlotSource]]:
    """Incoming advancement edges, keyed by TARGET encounter id.

    ``EncounterLink`` is the bracket's real topology, but a reader used to have
    to infer where an empty slot's team would come from out of round numbers
    and match counts. That inference cannot tell a lower bracket seeded
    straight from the group stage -- whose round 1 holds seeds, so its slots
    really are TBD -- from a standard one whose round 1 holds the upper
    bracket's first losers. Handing the edges out removes the guess.
    """
    targets = {encounter_id for encounter_id in encounter_ids if encounter_id is not None}
    if not targets:
        return {}

    rows = await session.execute(
        sa.select(
            EncounterLink.target_encounter_id,
            EncounterLink.source_encounter_id,
            EncounterLink.source_position,
            EncounterLink.target_slot,
        )
        .where(EncounterLink.target_encounter_id.in_(targets))
        .order_by(EncounterLink.target_encounter_id, EncounterLink.id)
    )

    sources: dict[int, list[SlotSource]] = {}
    for target_id, source_id, position, slot in rows.all():
        sources.setdefault(target_id, []).append(
            SlotSource(encounter_id=source_id, source_position=position, slot=slot)
        )
    return sources


async def persist_advancement_edges(
    session: AsyncSession,
    *,
    edges: Iterable[AdvancementEdge],
    encounters_by_local_id: dict[int, Encounter],
) -> list[EncounterLink]:
    """Create ``EncounterLink`` rows from a skeleton's advancement edges.

    Silently skips an edge whose local_id was not persisted (a bye-induced
    match). An edge aimed past the target's card is a generator bug, not a
    skippable one: the seat it names can never be filled, so it raises.
    """
    links: list[EncounterLink] = []
    for edge in edges:
        source = encounters_by_local_id.get(edge.source_local_id)
        target = encounters_by_local_id.get(edge.target_local_id)
        if source is None or target is None:
            continue
        if not 1 <= edge.target_slot <= target.slot_count:
            raise ValueError(
                f"Advancement edge targets slot {edge.target_slot} of encounter {target.id}, "
                f"which seats {target.slot_count}"
            )
        link = EncounterLink(
            tournament_id=target.tournament_id,
            source_encounter_id=source.id,
            source_position=edge.source_position,
            target_encounter_id=target.id,
            target_slot=edge.target_slot,
        )
        session.add(link)
        links.append(link)

    if links:
        await session.flush()
    return links


async def advance_after_result(session: AsyncSession, encounter: Encounter) -> AdvanceOutcome:
    """Seat this encounter's standing into every slot its links name.

    Does nothing until the result stands: a pending or disputed submission has
    decided nothing. A double elimination's Grand Final additionally
    materialises -- or drops -- its Reset here, because whether a second Grand
    Final exists is exactly the question "did the lower bracket's champion win
    the first one".
    """
    outcome = AdvanceOutcome()
    if encounter.result_status != enums.EncounterResultStatus.CONFIRMED:
        return outcome

    seats = await active_teams(session, encounter.id)
    by_position: dict[int, list[EncounterTeam]] = {}
    for seat in seats:
        if seat.placement is not None:
            by_position.setdefault(seat.placement, []).append(seat)

    links = await _resolve_grand_final_reset(session, encounter, by_position)
    for link in links:
        holders = by_position.get(link.source_position, [])
        if len(holders) != 1:
            # Either two teams share the place or the standing never reached
            # it; both mean this edge has nobody to move.
            outcome.blocked_positions.append(link.source_position)
            continue
        if await _seat(session, link, holders[0]):
            outcome.placed.append((link.target_encounter_id, link.target_slot))

    outcome.blocked_positions.sort()
    return outcome


async def reset_downstream(session: AsyncSession, encounter: Encounter, *, actor_user_id: int | None) -> None:
    """Empty every seat this encounter filled, and everything they filled.

    Each target loses the occupant, its unplayed positions (``vacate_slot``
    cancels them) and its standing: a decided result is reopened, then the
    standing is re-materialised from the games the LIVE seats still cover --
    which is how an encounter that was complete goes back to OPEN after the
    line-up that played it was retired.

    ``actor_user_id`` is the person who caused it, as a PLAYER identity; it is
    ``None`` only when the caller genuinely has none -- an organizer account
    with no linked player profile -- and the journal then reads as a machine
    actor, which is what its nullable column means.
    """
    for link in await _outgoing(session, encounter.id):
        target = await lock_encounter(session, link.target_encounter_id)
        if await vacate_slot(session, target, slot=link.target_slot) is None:
            continue
        await _rename(session, target)
        await reset_downstream(session, target, actor_user_id=actor_user_id)
        await _restate(session, target, actor_user_id=actor_user_id)


async def _seat(session: AsyncSession, link: EncounterLink, holder: EncounterTeam) -> bool:
    """Put ``holder``'s team in the slot ``link`` names; ``False`` if it is
    already there (a re-advance of an unchanged result)."""
    target = await lock_encounter(session, link.target_encounter_id)
    seated = await _active_slot(session, target.id, link.target_slot)
    if seated is not None and seated.team_id == holder.team_id:
        return False
    await place_team(
        session,
        target,
        slot=link.target_slot,
        team_id=holder.team_id,
        name=holder.name,
        seed=holder.seed,
        members=await _roster(session, holder),
    )
    await _rename(session, target)
    return True


async def _restate(session: AsyncSession, encounter: Encounter, *, actor_user_id: int | None) -> None:
    """Make the standing agree with the live seats again."""
    if encounter.result_source is not None and encounter.result_source != enums.EncounterResultSource.GAMES.value:
        # A decided result survives a recalculation by design, so it has to be
        # taken off first -- the line-up it was decided about is gone.
        await reopen(session, encounter, actor_user_id=actor_user_id, reason="bracket_reset")
    await refresh_from_games(
        session,
        encounter,
        action=enums.EncounterResultAuditAction.CASCADE_RESET,
        audit_source=_AUDIT_SOURCE,
        actor_user_id=actor_user_id,
    )


async def _outgoing(session: AsyncSession, encounter_id: int) -> list[EncounterLink]:
    rows = await session.execute(
        sa.select(EncounterLink)
        .where(EncounterLink.source_encounter_id == encounter_id)
        .order_by(EncounterLink.source_position, EncounterLink.id)
    )
    return list(rows.scalars().all())


async def _active_slot(session: AsyncSession, encounter_id: int, slot: int) -> EncounterTeam | None:
    return await session.scalar(
        sa.select(EncounterTeam).where(
            EncounterTeam.encounter_id == encounter_id,
            EncounterTeam.slot == slot,
            EncounterTeam.active.is_(True),
        )
    )


async def _rename(session: AsyncSession, encounter: Encounter) -> None:
    """The display name is the live seats in slot order; an empty seat is TBD."""
    seated = {seat.slot: seat.name for seat in await active_teams(session, encounter.id)}
    encounter.name = build_encounter_name([seated.get(slot) for slot in range(1, encounter.slot_count + 1)])


async def _roster(session: AsyncSession, participation: EncounterTeam) -> list[MemberSnapshot]:
    """The line-up as the next encounter should remember it.

    Carried forward rather than re-read from the tournament team: the snapshot
    is what the team actually fielded, and a roster change between rounds must
    not rewrite the round that was already played.
    """
    members = (
        (
            await session.execute(
                sa.select(EncounterTeamMember)
                .where(EncounterTeamMember.encounter_team_id == participation.id)
                .order_by(EncounterTeamMember.id)
            )
        )
        .scalars()
        .all()
    )
    if not members:
        return []
    roles: dict[int, list[tuple[str, str]]] = {}
    rows = await session.execute(
        sa.select(EncounterTeamMemberRole)
        .where(EncounterTeamMemberRole.team_member_id.in_([member.id for member in members]))
        .order_by(EncounterTeamMemberRole.role_id)
    )
    for row in rows.scalars().all():
        roles.setdefault(row.team_member_id, []).append((row.dimension, row.role))
    return [
        MemberSnapshot(
            workspace_member_id=member.workspace_member_id,
            display_name=member.display_name_snapshot,
            rank=member.rank,
            is_substitute=member.is_substitute,
            roles=tuple(roles.get(member.id, ())),
        )
        for member in members
    ]


async def _resolve_grand_final_reset(
    session: AsyncSession,
    encounter: Encounter,
    by_position: dict[int, list[EncounterTeam]],
) -> list[EncounterLink]:
    """The links :func:`advance_after_result` should seat, Reset included.

    Rules:
    - The stage is double elimination AND ``de_grand_final_type ==
      "with_reset"``; a ``no_reset`` stage ends at the Grand Final.
    - The encounter is a Grand Final iff it has an incoming link from a source
      in a negative (lower-bracket) round taking position 1. That link's
      ``target_slot`` is the seat the lower bracket's champion plays in. Round
      numbers cannot say this: a materialised Reset is a positive round too.
    - The Reset is fed by two links from the Grand Final, so it fills itself
      through the ordinary loop and ``reset_downstream`` empties it again.
    - The upper bracket's champion winning ends the tournament: an untouched
      leftover Reset is dropped.
    """
    links = await _outgoing(session, encounter.id)
    position = await session.get(BracketEncounter, encounter.id)
    if position is None or position.round <= 0 or position.stage_id is None:
        return links
    stage = await session.get(Stage, position.stage_id)
    if stage is None or stage.stage_type != enums.StageType.DOUBLE_ELIMINATION:
        return links
    if stage.de_grand_final_type != "with_reset":
        return links

    lower_slot = await session.scalar(
        sa.select(EncounterLink.target_slot)
        .join(BracketEncounter, BracketEncounter.encounter_id == EncounterLink.source_encounter_id)
        .where(
            EncounterLink.target_encounter_id == encounter.id,
            EncounterLink.source_position == 1,
            BracketEncounter.round < 0,
        )
    )
    if lower_slot is None:
        return links

    champions = by_position.get(1, [])
    if len(champions) == 1 and champions[0].slot == lower_slot:
        if links:
            # The Reset already exists; the ordinary loop refills it.
            return links
        return await _create_grand_final_reset(session, encounter, position, lower_slot)

    return await _drop_leftover_reset(session, links)


async def _create_grand_final_reset(
    session: AsyncSession,
    encounter: Encounter,
    position: BracketEncounter,
    lower_slot: int,
) -> list[EncounterLink]:
    reset = Encounter(
        workspace_id=encounter.workspace_id,
        discipline=encounter.discipline,
        tournament_id=encounter.tournament_id,
        scoring_rule_id=encounter.scoring_rule_id,
        name=build_encounter_name([None] * encounter.slot_count),
        slot_count=encounter.slot_count,
        # The Reset continues the Grand Final's series, so it is the same
        # length; it is materialised here rather than by the generator that
        # resolves best-of, and would otherwise take the column default.
        best_of=encounter.best_of,
        status=enums.EncounterStatus.OPEN,
    )
    session.add(reset)
    await session.flush()
    session.add(
        BracketEncounter(
            encounter_id=reset.id,
            tournament_id=encounter.tournament_id,
            stage_id=position.stage_id,
            stage_item_id=position.stage_item_id,
            round=position.round + 1,
        )
    )
    other_slot = next(slot for slot in range(1, encounter.slot_count + 1) if slot != lower_slot)
    links = [
        EncounterLink(
            tournament_id=encounter.tournament_id,
            source_encounter_id=encounter.id,
            source_position=source_position,
            target_encounter_id=reset.id,
            target_slot=target_slot,
        )
        for source_position, target_slot in ((1, lower_slot), (2, other_slot))
    ]
    session.add_all(links)
    await session.flush()
    logger.info(
        "Created Grand Final Reset {} for tournament={} stage={} (lower bracket won the Grand Final)",
        reset.id,
        encounter.tournament_id,
        position.stage_id,
    )
    return links


async def _drop_leftover_reset(session: AsyncSession, links: Sequence[EncounterLink]) -> list[EncounterLink]:
    """Remove a Reset left over from an earlier lower-bracket result.

    Only an unplayed one. ``status``/``result_status`` cannot answer that on
    their own: the correction that gets here ran :func:`reset_downstream`
    first, which vacates the Reset's seats and re-states it, so a Reset that
    WAS played is sitting at OPEN/none by the time this looks. The positions
    are the honest record -- a game that is not cancelled was played, and the
    ``ON DELETE CASCADE`` behind this row would take it, the participations
    that played it and the result journal with it.
    """
    kept = list(links)
    for reset_id in {link.target_encounter_id for link in links}:
        leftover = await lock_encounter(session, reset_id)
        if (
            leftover.status != enums.EncounterStatus.OPEN
            or leftover.result_status != enums.EncounterResultStatus.NONE
            or await _has_played_position(session, reset_id)
        ):
            continue
        for link in links:
            if link.target_encounter_id == reset_id:
                await session.delete(link)
        await session.delete(leftover)
        kept = [link for link in kept if link.target_encounter_id != reset_id]
    await session.flush()
    return kept


async def _has_played_position(session: AsyncSession, encounter_id: int) -> bool:
    """Does this encounter hold a position that was not retired?"""
    return (
        await session.scalar(
            sa.select(EncounterGame.id)
            .where(
                EncounterGame.encounter_id == encounter_id,
                EncounterGame.state != enums.EncounterGameState.CANCELLED,
            )
            .limit(1)
        )
    ) is not None
