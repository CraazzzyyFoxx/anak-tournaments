"""The user encounter reads over participations, executed against a real Postgres.

"The team played the encounter" is an active participation carrying its ``team_id``;
a win, loss or draw is read off ``placement`` (a shared first place is a draw) and
the maps off the seats' ``score``. A lobby counts for the record but not for the
maps. One disposable workspace, dropped again at the end::

    uv run pytest app-service/tests/test_user_encounters_participations.py -v
"""

from __future__ import annotations

import asyncio
import uuid
from typing import Any

import sqlalchemy as sa
from sqlalchemy.orm import joinedload

from shared.core import enums
from shared.models.encounter import Encounter, EncounterTeamMember, EncounterTeamMemberRole
from shared.models.identity.user import User
from shared.models.tenancy.workspace import Workspace, WorkspaceMember
from shared.models.tournament import Player, Stage, Team, Tournament
from shared.models.tournament.bracket_encounter import BracketEncounter
from src.core import pagination
from src.services.user import _mappers
from src.services.user.queries.encounters import encounters as encounter_queries
from src.services.user.queries.overview import overview as overview_queries
from tests.encounter_seed import seed_encounter, seed_scoring_rule


class _Seed:
    def __init__(self) -> None:
        self.workspace_id = 0
        self.users: dict[str, int] = {}
        self.teams: dict[str, int] = {}
        self.encounters: dict[str, int] = {}
        self.stage_name = ""


async def _seed(session: Any) -> _Seed:
    suffix = uuid.uuid4().hex[:10]
    seed = _Seed()
    workspace = Workspace(slug=f"seats-{suffix}", name=f"Seats {suffix}")
    session.add(workspace)
    await session.flush()
    seed.workspace_id = workspace.id

    members: dict[str, int] = {}
    for key in ("alice", "bob", "carol"):
        user = User(name=f"zz{suffix}-{key}")
        session.add(user)
        await session.flush()
        seed.users[key] = user.id
        member = WorkspaceMember(workspace_id=workspace.id, player_id=user.id)
        session.add(member)
        await session.flush()
        members[key] = member.id

    tournament = Tournament(
        workspace_id=workspace.id,
        name=f"Seats {suffix}",
        slug=f"seats-{suffix}",
        status=enums.TournamentStatus.COMPLETED,
        is_finished=True,
        is_league=False,
    )
    session.add(tournament)
    await session.flush()
    rule_id = await seed_scoring_rule(session, workspace.id)
    stage = Stage(
        tournament_id=tournament.id,
        name="Playoffs",
        stage_type=enums.StageType.SINGLE_ELIMINATION,
        order=1,
        scoring_rule_id=rule_id,
    )
    session.add(stage)
    await session.flush()
    seed.stage_name = stage.name

    teams: dict[str, Team] = {}
    for key in ("X", "Y", "Z"):
        team = Team(tournament_id=tournament.id, name=f"Team {key} {suffix}", balancer_name=f"team-{key}-{suffix}")
        session.add(team)
        teams[key] = team
    await session.flush()
    seed.teams = {key: team.id for key, team in teams.items()}
    for key, user_key in (("X", "alice"), ("Y", "bob"), ("Z", "carol")):
        session.add(
            Player(
                name=f"zz{suffix}-{user_key}",
                rank=2000,
                role=enums.HeroClass.tank,
                is_substitution=False,
                tournament_id=tournament.id,
                team_id=teams[key].id,
                workspace_member_id=members[user_key],
            )
        )
    await session.flush()

    # alice plays for X: she wins E1 and the lobby, draws E2 and loses E4.
    plan = {
        "E1": [(teams["X"], 2), (teams["Y"], 1)],
        "E2": [(teams["X"], 2), (teams["Z"], 2)],
        "LOBBY": [(teams["X"], 30), (teams["Y"], 20), (teams["Z"], 10)],
        "E4": [(teams["Y"], 2), (teams["X"], 0)],
    }
    for name, seats in plan.items():
        encounter = await seed_encounter(session, tournament, rule_id, seats, name=name, round_=None)
        seed.encounters[name] = encounter.id
    # Only E1 sits in the bracket, on the stage.
    session.add(
        BracketEncounter(encounter_id=seed.encounters["E1"], tournament_id=tournament.id, stage_id=stage.id, round=3)
    )
    await session.flush()

    # The roster snapshot of E1's first seat: alice, as a tank.
    first_seat = (
        await session.execute(
            sa.text("select id from encounter.team where encounter_id = :e and slot = 1"),
            {"e": seed.encounters["E1"]},
        )
    ).scalar_one()
    member = EncounterTeamMember(
        encounter_id=seed.encounters["E1"],
        encounter_team_id=first_seat,
        active=True,
        workspace_member_id=members["alice"],
        display_name_snapshot="Alice",
    )
    session.add(member)
    await session.flush()
    session.add(EncounterTeamMemberRole(team_member_id=member.id, dimension="player_role", role="tank"))
    await session.commit()
    return seed


async def _drop(session: Any, seed: _Seed) -> None:
    await session.rollback()
    await session.execute(sa.delete(Workspace).where(Workspace.id == seed.workspace_id))
    await session.execute(sa.delete(User).where(User.id.in_(list(seed.users.values()))))
    await session.commit()


def _params(**overrides: Any) -> pagination.PaginationSortParams:
    return pagination.PaginationSortParams(**{"page": 1, "per_page": 50, "sort": "id", "order": "asc", **overrides})


def _run(db_session, body):
    async def _go():
        seed = await _seed(db_session)
        try:
            return seed, await body(seed)
        finally:
            await _drop(db_session, seed)

    return asyncio.run(_go())


def test_the_encounter_list_filters_by_the_outcome_of_the_viewers_seat(db_session) -> None:
    async def body(seed: _Seed) -> dict[str, list[int]]:
        found: dict[str, list[int]] = {}
        for result in (None, "win", "loss", "draw"):
            rows, total = await encounter_queries.get_user_encounters_paginated(
                db_session, seed.users["alice"], _params(), seed.workspace_id, result=result
            )
            assert total == len({row[0].id for row in rows})
            found[str(result)] = sorted({row[0].id for row in rows})
        return found

    seed, found = _run(db_session, body)
    ids = seed.encounters
    assert found["None"] == sorted(ids.values())
    # A win is a sole first place, so the lobby counts; a shared first place is a draw.
    assert found["win"] == sorted([ids["E1"], ids["LOBBY"]])
    assert found["loss"] == [ids["E4"]]
    assert found["draw"] == [ids["E2"]]


def test_the_opponent_filter_and_the_sort_by_round_read_the_other_seats(db_session) -> None:
    async def body(seed: _Seed) -> tuple[list[int], list[int]]:
        rows, _ = await encounter_queries.get_user_encounters_paginated(
            db_session, seed.users["alice"], _params(), seed.workspace_id, opponent="Team Z"
        )
        by_opponent = sorted({row[0].id for row in rows})
        rows, _ = await encounter_queries.get_user_encounters_paginated(
            db_session, seed.users["alice"], _params(sort="round"), seed.workspace_id, stage="playoffs"
        )
        return by_opponent, sorted({row[0].id for row in rows})

    seed, (by_opponent, in_playoffs) = _run(db_session, body)
    assert by_opponent == sorted([seed.encounters["E2"], seed.encounters["LOBBY"]])
    assert in_playoffs == [seed.encounters["E1"]]


def test_opponents_and_stage_records_are_read_off_placements(db_session) -> None:
    async def body(seed: _Seed):
        opponents = await encounter_queries.get_user_opponents(db_session, seed.users["alice"], seed.workspace_id)
        stages = await encounter_queries.get_user_stage_breakdown(db_session, seed.users["alice"], seed.workspace_id)
        return opponents, stages

    seed, (opponents, stages) = _run(db_session, body)
    by_name = {row.name.split()[1]: (row.wins, row.losses, row.draws) for row in opponents}
    # Y: won E1 and the lobby, lost E4. Z: drew E2, trailed alice in the lobby.
    assert by_name == {"Y": (2, 1, 0), "Z": (1, 0, 1)}
    # Only E1 sits in a stage, and "Playoffs" classifies; the rest have no bracket row.
    assert {row.kind: (row.w, row.l) for row in stages if row.kind} == {"playoffs": (1, 0)}


def test_the_dossier_context_carries_the_live_seats_roster_and_bracket_position(db_session) -> None:
    async def body(seed: _Seed) -> None:
        contexts = await encounter_queries.get_encounter_contexts(db_session, list(seed.encounters.values()))
        orm = (
            await db_session.execute(
                sa.select(Encounter)
                .options(joinedload(Encounter.tournament))
                .where(Encounter.id == seed.encounters["E1"])
            )
        ).scalar_one()
        read = _mappers.to_encounter_with_user_stats(
            orm, contexts[seed.encounters["E1"]], [], viewer_user_id=seed.users["alice"]
        )
        assert [seat.slot for seat in contexts[seed.encounters["LOBBY"]].participations] == [1, 2, 3]
        assert read.slot_count == 2 and read.round == 3
        assert read.stage is not None and read.stage.name == seed.stage_name
        assert [(team.slot, team.score, team.placement) for team in read.teams] == [(1, 2.0, 1), (2, 1.0, 2)]
        assert read.user_team_id == seed.teams["X"]
        assert [(player.user_id, player.name, player.role) for player in read.teams[0].players] == [
            (seed.users["alice"], "Alice", enums.HeroClass.tank)
        ]
        assert read.teams[1].players == []
        # An encounter outside any bracket reads round 0 and no stage.
        assert contexts[seed.encounters["E2"]].position is None

    _run(db_session, body)


def test_map_records_count_duels_only(db_session) -> None:
    async def body(seed: _Seed):
        return await overview_queries.get_overview_map_records(db_session, [seed.users["alice"]], seed.workspace_id)

    seed, records = _run(db_session, body)
    # E1 2-1, E2 2-2, E4 0-2: the lobby's 30 points are not maps, and every duel has a result.
    assert records[seed.users["alice"]] == (4, 5, 3)
