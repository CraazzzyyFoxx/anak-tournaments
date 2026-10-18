"""Which encounter game a validated document belongs to, and which of its teams is which seat.

Pure evidence, never a guess: a candidate is a non-cancelled game of this workspace and discipline on the document's
map; its seats are the game's actual ``game_team`` participations and their ``team_member`` rosters (a seat that went
inactive later still counts for a game it played). A document team is tied to a seat only by the identities of its
participants:

* every known participant of the team is rostered on that one seat and on no other seat of the game,
* at least one is (an all-unknown team identifies nothing, and a hint cannot stand in for evidence),
* and the teams map one-to-one onto the game's seats. Team names and document order are never identity.

A unique fitting game is the binding, occupied or not. Several fitting games leave the choice to an administrator;
occupancy alone never decides. A hint (already validated by ``validate_document``) only narrows candidates: a locally
valid hint the evidence contradicts is :class:`BindingMismatch`.

Everything here reads; locks and writes belong to the writer.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Literal

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from shared import models
from shared.core import enums
from shared.disciplines.ingest import BoundMatch, BoundParticipant
from shared.domain.pick_ban_config import pool_allows
from shared.repository.pick_ban import CONFIG_POOL_LOAD, PickBanConfigRepository
from shared.repository.roles import CatalogRoleRepository
from shared.schemas.match_doc import MatchDoc, MatchHint
from src.services.ingest.validation import ValidatedDocument

__all__ = (
    "BindingMismatch",
    "InvalidTeamMap",
    "MapNotInPool",
    "check_map_pool",
    "GameSeats",
    "bound_match",
    "check_forced_teams",
    "bound_participants",
    "find_binding",
    "load_game_seats",
    "match_teams",
)

Verdict = Literal["bound", "unevidenced", "contradicted"]


class BindingMismatch(ValueError):
    """A hint or an operator's team map names a game the document's own participants contradict."""

    code = "binding_mismatch"


class MapNotInPool(ValueError):
    """The game's map is outside the pool its tournament/stage/round allows (P4's ``map_not_in_pool``)."""

    code = "map_not_in_pool"


class InvalidTeamMap(BindingMismatch):
    """The operator's map is not a complete bijection onto the document's teams and the game's seats."""

    code = "invalid_team_map"


@dataclass(frozen=True, slots=True)
class GameSeats:
    """One candidate game as it is right now: its seats and each seat's rostered global players and member ids."""

    game_id: int
    encounter_id: int
    map_id: int | None
    result_version: int
    seats: tuple[int, ...]
    #: seat (``encounter.team`` id) -> global player ids of its roster
    players: Mapping[int, frozenset[int]]
    #: seat -> workspace member ids of its roster
    members: Mapping[int, frozenset[int]]


def _seat_hits(doc: MatchDoc, known: Mapping[str, int], game: GameSeats) -> dict[str, set[int]]:
    """Document team key -> the seats of this game that any known participant of the team is rostered on."""
    hits: dict[str, set[int]] = {team.key: set() for team in doc.teams}
    for person in doc.participants:
        player = known.get(person.key)
        if player is None:
            continue
        hits[person.team].update(seat for seat in game.seats if player in game.players.get(seat, ()))
    return hits


def match_teams(doc: MatchDoc, known: Mapping[str, int], game: GameSeats) -> tuple[Verdict, dict[str, int] | None]:
    """Classify ``game`` for the document and give the unique team -> seat map when the evidence proves one."""
    if len(doc.teams) != len(game.seats):
        return "contradicted", None
    hits = _seat_hits(doc, known, game)
    if any(len(seats) > 1 for seats in hits.values()):
        return "contradicted", None
    mapped = {key: next(iter(seats)) for key, seats in hits.items() if seats}
    if len(set(mapped.values())) != len(mapped):
        return "contradicted", None
    if len(mapped) != len(doc.teams):
        return "unevidenced", None
    return "bound", mapped


def check_forced_teams(doc: MatchDoc, known: Mapping[str, int], game: GameSeats, teams: Mapping[str, int]) -> None:
    """An operator's complete map: a bijection onto the game's seats that no known participant contradicts.

    Zero overlap is allowed (that is what the operator is resolving); a participant rostered on another seat is not.
    """
    if set(teams) != {team.key for team in doc.teams}:
        raise InvalidTeamMap("the team map must name every document team exactly once")
    if len(set(teams.values())) != len(teams) or set(teams.values()) != set(game.seats):
        raise InvalidTeamMap("the team map must be a bijection onto the game's participating teams")
    for key, seats in _seat_hits(doc, known, game).items():
        if seats - {teams[key]}:
            raise BindingMismatch(f"team {key!r} has a participant rostered on another team of this game")


async def load_game_seats(
    session: AsyncSession,
    *,
    workspace_id: int,
    discipline: str,
    map_id: int | None = None,
    game_ids: Sequence[int] | None = None,
    encounter_id: int | None = None,
    tournament_id: int | None = None,
    players: Sequence[int] | None = None,
) -> list[GameSeats]:
    """Non-cancelled games of the owner, filtered by the given constraints, with their seats and rosters.

    ``players`` keeps only games where at least one of those global players is rostered on a participating seat, so
    the search starts from evidence and never walks a workspace's whole history.
    """
    game, encounter, side, member, anchor = (
        models.EncounterGame,
        models.Encounter,
        models.EncounterGameTeam,
        models.EncounterTeamMember,
        models.WorkspaceMember,
    )
    rostered = (
        sa.select(side.game_id)
        .join(member, member.encounter_team_id == side.encounter_team_id)
        .join(anchor, anchor.id == member.workspace_member_id)
        .where(side.encounter_id == game.encounter_id, anchor.workspace_id == workspace_id)
    )
    query = (
        sa.select(game.id, game.encounter_id, game.map_id, game.result_version)
        .join(encounter, encounter.id == game.encounter_id)
        .where(
            encounter.workspace_id == workspace_id,
            encounter.discipline == discipline,
            game.state != enums.EncounterGameState.CANCELLED,
        )
        .order_by(game.id)
    )
    if map_id is not None:
        query = query.where(game.map_id == map_id)
    if game_ids is not None:
        query = query.where(game.id.in_(game_ids))
    if encounter_id is not None:
        query = query.where(game.encounter_id == encounter_id)
    if tournament_id is not None:
        query = query.where(encounter.tournament_id == tournament_id)
    if players is not None:
        if not players:
            return []
        query = query.where(game.id.in_(rostered.where(anchor.player_id.in_(players))))
    games = (await session.execute(query)).all()
    if not games:
        return []
    ids = [row.id for row in games]
    seats: dict[int, list[int]] = {game_id: [] for game_id in ids}
    for game_id, seat in await session.execute(
        sa.select(side.game_id, side.encounter_team_id)
        .where(side.game_id.in_(ids))
        .order_by(side.game_id, side.encounter_team_id)
    ):
        seats[game_id].append(seat)
    seat_ids = {seat for rows in seats.values() for seat in rows}
    roster_players: dict[int, set[int]] = {seat: set() for seat in seat_ids}
    roster_members: dict[int, set[int]] = {seat: set() for seat in seat_ids}
    if seat_ids:
        for seat, member_id, player_id in await session.execute(
            sa.select(member.encounter_team_id, member.workspace_member_id, anchor.player_id)
            .join(anchor, anchor.id == member.workspace_member_id)
            .where(member.encounter_team_id.in_(seat_ids), anchor.workspace_id == workspace_id)
        ):
            roster_players[seat].add(player_id)
            roster_members[seat].add(member_id)
    return [
        GameSeats(
            game_id=row.id,
            encounter_id=row.encounter_id,
            map_id=row.map_id,
            result_version=row.result_version,
            seats=tuple(seats[row.id]),
            players={seat: frozenset(roster_players[seat]) for seat in seats[row.id]},
            members={seat: frozenset(roster_members[seat]) for seat in seats[row.id]},
        )
        for row in games
    ]


def bound_match(workspace_id: int, discipline: str, game: GameSeats, teams: Mapping[str, int]) -> BoundMatch:
    """The candidate binding: members are not known until identities are materialized."""
    return BoundMatch(
        workspace_id=workspace_id,
        encounter_id=game.encounter_id,
        encounter_game_id=game.game_id,
        participants={},
        discipline=discipline,
        team_ids=dict(teams),
        basis_game_result_version=game.result_version,
    )


async def find_binding(
    session: AsyncSession,
    *,
    workspace_id: int,
    doc: ValidatedDocument,
    known_players: Mapping[str, int],
    hint: MatchHint | None = None,
    linked_game_id: int | None = None,
) -> BoundMatch | None:
    """The one game ``doc`` provably belongs to, or ``None`` (unlinked or ambiguous -> awaiting an administrator).

    ``hint`` is the job's current candidate constraint (the stored document's hint may predate an operator edit);
    ``linked_game_id`` pins a document whose observation already exists to that game.
    """
    if not known_players:
        return None
    hint = hint if hint is not None and hint.model_dump(exclude_none=True) else None
    game_ids = None if linked_game_id is None else [linked_game_id]
    if hint is not None and hint.encounter_game_id is not None:
        if game_ids is not None and game_ids != [hint.encounter_game_id]:
            raise BindingMismatch("the attached game differs from the game this log is already bound to")
        game_ids = [hint.encounter_game_id]
    candidates = await load_game_seats(
        session,
        workspace_id=workspace_id,
        discipline=doc.discipline,
        map_id=doc.map_id,
        game_ids=game_ids,
        encounter_id=None if hint is None else hint.encounter_id,
        tournament_id=None if hint is None else hint.tournament_id,
        # Evidence first: without a hint only games where a known participant is rostered are searched at all.
        players=None if hint is not None or game_ids is not None else sorted(set(known_players.values())),
    )
    if hint is not None and hint.encounter_game_id is not None and not candidates:
        # The hint names a game of this workspace (validated) that is not a live game on the document's map.
        raise BindingMismatch("the attached game is cancelled or is played on another map than the log's")
    verdicts = [(game, *match_teams(doc.doc, known_players, game)) for game in candidates]
    fitting = [(game, teams) for game, verdict, teams in verdicts if verdict == "bound"]
    if hint is not None and not fitting:
        # A valid hint says where the log should be: its games are either refuted by the participants (mismatch)
        # or merely lack evidence, or no such game exists yet (the log waits for an administrator).
        if verdicts and all(verdict == "contradicted" for _, verdict, _ in verdicts):
            raise BindingMismatch("the attached game or encounter does not agree with the log's map and players")
        return None
    if fitting:
        permitted = [
            (game, teams)
            for game, teams in fitting
            if await map_pool_allows(session, encounter_id=game.encounter_id, map_id=doc.map_id)
        ]
        if not permitted:
            raise MapNotInPool("the map is outside the configured map pool of every matching encounter")
        fitting = permitted
    if len(fitting) != 1:
        return None
    game, teams = fitting[0]
    return bound_match(workspace_id, doc.discipline, game, teams)


async def bound_participants(
    session: AsyncSession,
    *,
    doc: MatchDoc,
    binding: BoundMatch,
    game: GameSeats,
    members: Mapping[str, models.WorkspaceMember],
) -> dict[str, BoundParticipant]:
    """Every participant as the discipline's derivation needs it: member, global player, seat, roster rank and role.

    A player (substitutes registered on the team included) on the tournament roster of the seat's source team keeps P4's inputs: the current tournament-player
    registration rank and rated role (the baselines bucket on that boundary, D96). Only a participant the tournament
    roster does not have (substitute, virtual player) falls back to the encounter roster snapshot, and without any row
    carries rank 0 and no role.
    """
    tournament_roster: dict[tuple[int, int], tuple[int, str | None]] = {}
    if game.seats:
        player, seat_row = models.Player, models.EncounterTeam
        for seat_id, member_id, rank, role in await session.execute(
            sa.select(seat_row.id, player.workspace_member_id, player.rank, player.role)
            .join(player, sa.and_(player.team_id == seat_row.team_id, player.tournament_id == seat_row.tournament_id))
            .where(
                seat_row.id.in_(game.seats),
                player.workspace_member_id.in_([anchor.id for anchor in members.values()]),
            )
            # P4 matched every roster Player of the team, registered substitutes included; the regular row wins.
            .order_by(player.is_substitution, player.id)
        ):
            tournament_roster.setdefault((seat_id, member_id), (rank, role))
    member = models.EncounterTeamMember
    roster: dict[tuple[int, int], tuple[int, int | None]] = {}
    role_of: dict[int, int] = {}
    if game.seats:
        rows = (
            await session.execute(
                sa.select(member.id, member.encounter_team_id, member.workspace_member_id, member.rank).where(
                    member.encounter_team_id.in_(game.seats)
                )
            )
        ).all()
        roster = {(row.encounter_team_id, row.workspace_member_id): (row.id, row.rank) for row in rows}
        if rows:
            for team_member_id, role_id in await session.execute(
                sa.select(models.EncounterTeamMemberRole.team_member_id, models.EncounterTeamMemberRole.role_id)
                .where(models.EncounterTeamMemberRole.team_member_id.in_([row.id for row in rows]))
                .order_by(models.EncounterTeamMemberRole.role_id.desc())
            ):
                role_of[team_member_id] = role_id
    ontology = (
        await CatalogRoleRepository().ontology(
            session, discipline=binding.discipline, workspace_id=binding.workspace_id
        )
        if role_of
        else None
    )
    rated = None if ontology is None else ontology.rated.code
    out: dict[str, BoundParticipant] = {}
    for person in doc.participants:
        anchor = members[person.key]
        seat = binding.team_ids[person.team]
        row_id, rank = roster.get((seat, anchor.id), (None, None))
        role_code = None
        if row_id is not None and row_id in role_of and ontology is not None:
            node = ontology.by_id(role_of[row_id])
            if node.dimension == rated:
                role_code = ontology.root(node).code
        registered = tournament_roster.get((seat, anchor.id))
        if registered is not None:
            rank, role_code = registered[0], registered[1] or role_code
        out[person.key] = BoundParticipant(
            member_id=anchor.id,
            user_id=anchor.player_id,
            encounter_team_id=seat,
            rank=rank or 0,
            role=role_code,
        )
    return out


async def map_pool_allows(session: AsyncSession, *, encounter_id: int, map_id: int) -> bool:
    """Whether the effective tournament/stage/round map pool of the encounter admits ``map_id`` (no pool admits all)."""
    tournament_id = await session.scalar(
        sa.select(models.Encounter.tournament_id).where(models.Encounter.id == encounter_id)
    )
    if tournament_id is None:
        return True  # mixes and scrims carry no tournament pool
    stage_id, round_ = (
        await session.execute(
            sa.select(models.BracketEncounter.stage_id, models.BracketEncounter.round).where(
                models.BracketEncounter.encounter_id == encounter_id
            )
        )
    ).first() or (None, None)
    pools = await PickBanConfigRepository().list_by_tournament(
        session, tournament_id, kind=enums.PickBanKind.MAP, options=CONFIG_POOL_LOAD
    )
    return pool_allows(pools, stage_id=stage_id, round=round_, item_id=map_id)


async def check_map_pool(session: AsyncSession, *, encounter_id: int, map_id: int) -> None:
    if not await map_pool_allows(session, encounter_id=encounter_id, map_id=map_id):
        raise MapNotInPool(f"map {map_id} is outside the configured map pool for encounter {encounter_id}")
