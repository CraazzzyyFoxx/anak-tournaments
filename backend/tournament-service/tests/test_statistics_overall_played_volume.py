"""The played-volume half of the overall statistics, on real Postgres.

``days`` is a UNION of date ranges (overlapping tournaments must count a shared
day once) and ``hours`` floors a SUM over a nullable column -- neither is
checkable without a database, so this seeds its own workspace and drops it
again::

    uv run pytest tournament-service/tests/test_statistics_overall_played_volume.py -v

SKIPs when Postgres is unreachable, like every other integration test here.
"""

from __future__ import annotations

import asyncio
import sys
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import sqlalchemy as sa

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from shared.core import enums  # noqa: E402
from shared.models.catalog.gamemode import Gamemode  # noqa: E402
from shared.models.catalog.map import Map  # noqa: E402
from shared.models.matches.match import Match  # noqa: E402
from shared.models.tenancy.workspace import Workspace  # noqa: E402
from shared.models.tournament import Team, Tournament  # noqa: E402
from src.services.tournament.service import tournament_service  # noqa: E402
from tests._encounter_layer import add_encounter, add_scoring_rule  # noqa: E402


def _day(year: int, month: int, day: int) -> datetime:
    return datetime(year, month, day, 12, 0, tzinfo=UTC)


async def _seed(session: Any) -> tuple[int, int]:
    """Two counted tournaments sharing a day, plus a hidden one that must not count.

    Returns ``(workspace id, gamemode id)``; the map is the gamemode's own, so
    dropping both clears the lot (the test DB ships no maps to borrow).
    """
    suffix = uuid.uuid4().hex[:12]
    gamemode = Gamemode(slug=f"ovstat-{suffix}", name=f"Overall stats {suffix}", image_path="x")
    session.add(gamemode)
    await session.flush()
    played_map = Map(gamemode_id=gamemode.id, name=f"Overall stats {suffix}", image_path="x")
    session.add(played_map)
    await session.flush()
    map_id = played_map.id

    workspace = Workspace(slug=f"ovstat-{suffix}", name=f"Overall stats {suffix}")
    session.add(workspace)
    await session.flush()

    def _tournament(label: str, start: datetime, end: datetime, **kwargs: Any) -> Tournament:
        return Tournament(
            workspace_id=workspace.id,
            name=f"Overall {label} {suffix}",
            slug=f"ovstat-{label}-{suffix}",
            status=enums.TournamentStatus.COMPLETED,
            start_date=start,
            end_date=end,
            **kwargs,
        )

    # 1-3 Jan and 3-4 Jan overlap on the 3rd: four distinct days, not five.
    first = _tournament("a", _day(2031, 1, 1), _day(2031, 1, 3))
    second = _tournament("b", _day(2031, 1, 3), _day(2031, 1, 4))
    # Hidden and league tournaments are excluded from every public count, their
    # days and maps included.
    hidden = _tournament("h", _day(2031, 6, 1), _day(2031, 6, 9), is_hidden=True)
    league = _tournament("l", _day(2031, 7, 1), _day(2031, 7, 9), is_league=True)
    session.add_all([first, second, hidden, league])
    await session.flush()

    teams = [
        Team(tournament_id=first.id, name=f"T{index} {suffix}", balancer_name=f"t{index}-{suffix}")
        for index in range(2)
    ]
    session.add_all(teams)
    await session.flush()

    rule = await add_scoring_rule(session, workspace.id)
    done = await add_encounter(session, first, rule.id, teams=[teams[0].id, teams[1].id], scores=(2, 0))
    open_one = await add_encounter(session, first, rule.id, teams=[teams[0].id, teams[1].id])
    # A finished duel of the hidden tournament, counted nowhere.
    hidden_teams = [
        Team(tournament_id=hidden.id, name=f"H{index} {suffix}", balancer_name=f"h{index}-{suffix}")
        for index in range(2)
    ]
    session.add_all(hidden_teams)
    await session.flush()
    await add_encounter(session, hidden, rule.id, teams=[team.id for team in hidden_teams], scores=(2, 0))
    await session.flush()

    # 3600 + 1800 on the finished encounter, 1800 on the open one: three maps,
    # 7200 seconds -> exactly two hours. The unfinished encounter's maps still
    # count as maps -- only `encounters` is status-filtered.
    session.add_all(
        [
            Match(
                home_team_id=teams[0].id,
                away_team_id=teams[1].id,
                home_score=1,
                away_score=0,
                time=seconds,
                encounter_id=encounter.id,
                map_id=map_id,
            )
            for encounter, seconds in ((done, 3600.0), (done, 1800.0), (open_one, 1800.0))
        ]
    )
    # A logless legacy row: NULL time must not NULL the whole sum.
    session.add(
        Match(
            home_team_id=teams[0].id,
            away_team_id=teams[1].id,
            home_score=1,
            away_score=0,
            time=None,
            encounter_id=done.id,
            map_id=map_id,
        )
    )
    await session.commit()
    return workspace.id, gamemode.id


def test_overall_counts_played_volume(db_session) -> None:
    async def _run():
        seeded = await _seed(db_session)
        try:
            return await tournament_service.get_tournaments_overall(db_session, workspace_id=seeded[0])
        finally:
            # One loop for seed, read and drop: the session's connection is bound to it.
            await db_session.rollback()
            # Workspace first: its matches hold the map.
            await db_session.execute(sa.delete(Workspace).where(Workspace.id == seeded[0]))
            await db_session.execute(sa.delete(Map).where(Map.gamemode_id == seeded[1]))
            await db_session.execute(sa.delete(Gamemode).where(Gamemode.id == seeded[1]))
            await db_session.commit()

    overall = asyncio.run(_run())

    assert overall.tournaments == 2
    assert overall.encounters == 1
    assert overall.maps == 4
    # 1-3 Jan plus 3-4 Jan = 1,2,3,4 — the shared 3rd counted once.
    assert overall.days == 4
    assert overall.hours == 2
