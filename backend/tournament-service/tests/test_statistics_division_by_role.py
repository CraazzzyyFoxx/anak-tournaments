"""Average division per tournament is ONE game's, keyed by that game's own rated role codes (P7 slice 8b).

One workspace runs Overwatch and League: each read sees only its game's tournaments, groups by the
top-level role of the game's rated dimension (``tank``/``support``, ``jungle``/``support``), leaves
an open slot and an unplayed role out, and never borrows another game's vocabulary.

Real database::

    uv run pytest tournament-service/tests/test_statistics_division_by_role.py -q
"""

from __future__ import annotations

import asyncio
import sys
import uuid
from pathlib import Path
from typing import Any

import sqlalchemy as sa

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from shared.core import enums  # noqa: E402
from shared.division_grid import DivisionGrid, DivisionTier  # noqa: E402
from shared.models.tenancy.workspace import Workspace  # noqa: E402
from shared.models.tournament import Team, Tournament  # noqa: E402
from shared.models.tournament.player_role import PlayerRole  # noqa: E402
from shared.models.tournament.team import Player  # noqa: E402
from shared.repository import CatalogRoleRepository  # noqa: E402
from shared.services.ontology import project_disciplines  # noqa: E402
from src import models  # noqa: E402
from src.services.tournament.flows import flows_service  # noqa: E402

GRID = DivisionGrid(
    version_id=None,
    tiers=(
        DivisionTier(id=None, slug=None, number=1, name="1", rank_min=2000, rank_max=None, icon_url=""),
        DivisionTier(id=None, slug=None, number=2, name="2", rank_min=1000, rank_max=1999, icon_url=""),
        DivisionTier(id=None, slug=None, number=3, name="3", rank_min=0, rank_max=999, icon_url=""),
    ),
)
#: (role code or None for an open slot, rank) per seeded player, by game.
ROSTERS = {
    "overwatch": [("tank", 2500), ("tank", 1500), ("support", 500), (None, 2500)],
    "lol": [("jungle", 1500), ("support", 2500)],
}


async def _seed(session: Any) -> dict[str, Any]:
    await project_disciplines(session)
    suffix = uuid.uuid4().hex[:12]
    workspace = Workspace(slug=f"divrole-{suffix}", name=f"Div role {suffix}", disciplines_enabled=["overwatch", "lol"])
    session.add(workspace)
    await session.flush()
    roles = CatalogRoleRepository()
    seeded: dict[str, Any] = {"workspace_id": workspace.id, "users": [], "tournaments": {}}
    for discipline, roster in ROSTERS.items():
        tournament = Tournament(
            workspace_id=workspace.id,
            name=f"{discipline} {suffix}",
            slug=f"divrole-{discipline}-{suffix}",
            discipline=discipline,
            status=enums.TournamentStatus.COMPLETED,
        )
        session.add(tournament)
        await session.flush()
        team = Team(
            tournament_id=tournament.id, name=f"T {discipline} {suffix}", balancer_name=f"t-{discipline}-{suffix}"
        )
        session.add(team)
        await session.flush()
        seeded["tournaments"][discipline] = tournament.id
        for index, (code, rank) in enumerate(roster):
            user = models.User(name=f"divrole-{discipline}-{index}-{suffix}")
            session.add(user)
            await session.flush()
            seeded["users"].append(user.id)
            member = models.WorkspaceMember(workspace_id=workspace.id, player_id=user.id)
            session.add(member)
            await session.flush()
            player = Player(
                tournament_id=tournament.id, team_id=team.id, workspace_member_id=member.id, name=user.name, rank=rank
            )
            session.add(player)
            await session.flush()
            if code is not None:
                role = await roles.resolve(session, discipline=discipline, workspace_id=None, dimension=None, code=code)
                session.add(PlayerRole(player_id=player.id, dimension_id=role.dimension_id, role_id=role.id))
    await session.commit()
    return seeded


def test_each_game_averages_its_own_tournaments_by_its_own_rated_roles(db_session) -> None:
    async def _run() -> tuple[dict[str, Any], dict[str, list[Any]]]:
        seeded = await _seed(db_session)
        try:
            reads = {
                discipline: await flows_service.get_avg_divisions_tournaments(
                    db_session, discipline, workspace_id=seeded["workspace_id"], fallback_grid=GRID
                )
                for discipline in ROSTERS
            }
            return seeded, reads
        finally:
            await db_session.rollback()
            await db_session.execute(sa.delete(Workspace).where(Workspace.id == seeded["workspace_id"]))
            await db_session.execute(sa.delete(models.User).where(models.User.id.in_(seeded["users"])))
            await db_session.commit()

    seeded, reads = asyncio.run(_run())

    overwatch = reads["overwatch"]
    assert [row.id for row in overwatch] == [seeded["tournaments"]["overwatch"]]
    # Two tanks in divisions 1 and 2, one support in 3; the open slot and the unplayed `damage` are absent.
    assert overwatch[0].role_avg_divs == {"tank": 1.5, "support": 3.0}

    lol = reads["lol"]
    assert [row.id for row in lol] == [seeded["tournaments"]["lol"]]
    assert lol[0].role_avg_divs == {"jungle": 2.0, "support": 1.0}
