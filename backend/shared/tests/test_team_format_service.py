"""Team formats in the DB (D35, D88): fallbacks, copies, replacement, slot shapes. Needs the test Postgres."""

from __future__ import annotations

import asyncio
import itertools
import os
import sys
from dataclasses import replace
from unittest import IsolatedAsyncioTestCase

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import async_sessionmaker

from shared import models
from shared.core.errors import BaseAPIException
from shared.disciplines import DISCIPLINES
from shared.domain.roster_shape import RosterShape
from shared.domain.team_format import FormatDimension, FormatRule, TeamFormat
from shared.services import team_format as formats
from shared.services.ontology import project_disciplines
from shared.testing import create_test_async_engine
from shared.testing.db import ensure_test_postgres

_TAG = itertools.count()
OW_PRESET = TeamFormat.from_preset("overwatch", DISCIPLINES["overwatch"].preset())
ONE_TANK = TeamFormat(
    "overwatch",
    "1 tank + open",
    6,
    6,
    dimensions=(FormatDimension("player_role", "enforced"),),
    rules=(FormatRule("player_role", "tank", hard_min=1, hard_max=1),),
)


class TeamFormatServiceTests(IsolatedAsyncioTestCase):
    if sys.platform == "win32":
        loop_factory = asyncio.SelectorEventLoop

    async def asyncSetUp(self) -> None:
        ensure_test_postgres()
        self.engine = create_test_async_engine()
        self.Session = async_sessionmaker(self.engine, expire_on_commit=False)
        tag = f"tf-{os.getpid()}-{next(_TAG)}"
        async with self.Session() as s:
            await project_disciplines(s)
            workspace = models.Workspace(slug=tag, name=tag, disciplines_enabled=["overwatch", "lol"])
            s.add(workspace)
            await s.flush()
            self.workspace_id = workspace.id
            self.tournaments = []
            for index, discipline in enumerate(("overwatch", "overwatch", "lol")):
                tournament = models.Tournament(
                    workspace_id=workspace.id,
                    discipline=discipline,
                    name=f"{tag}-{index}",
                    slug=f"{tag}-{index}",
                )
                s.add(tournament)
                self.tournaments.append(tournament)
            await s.commit()

    async def asyncTearDown(self) -> None:
        async with self.Session() as s:
            await s.execute(sa.delete(models.Workspace).where(models.Workspace.id == self.workspace_id))
            await s.commit()
        await self.engine.dispose()

    async def test_a_tournament_without_its_own_row_reads_the_workspace_default_then_the_preset(self) -> None:
        overwatch = self.tournaments[0]
        async with self.Session() as s:
            assert await formats.tournament_format(s, overwatch) == (OW_PRESET, "preset")
            await formats.save_workspace_format(
                s, workspace_id=self.workspace_id, discipline="overwatch", team_format=ONE_TANK
            )
            await s.commit()
            assert await formats.tournament_format(s, overwatch) == (ONE_TANK, "workspace")

    async def test_a_copy_does_not_follow_later_edits_of_the_default(self) -> None:
        overwatch = self.tournaments[0]
        async with self.Session() as s:
            await formats.save_workspace_format(
                s, workspace_id=self.workspace_id, discipline="overwatch", team_format=ONE_TANK
            )
            await formats.copy_for_tournament(s, overwatch)
            await formats.save_workspace_format(
                s, workspace_id=self.workspace_id, discipline="overwatch", team_format=OW_PRESET
            )
            await s.commit()
            assert await formats.tournament_format(s, overwatch) == (ONE_TANK, "tournament")

    async def test_saving_again_replaces_the_dimensions_and_the_rules(self) -> None:
        overwatch = self.tournaments[0]
        async with self.Session() as s:
            await formats.save_tournament_format(s, overwatch, OW_PRESET)
            await formats.save_tournament_format(s, overwatch, ONE_TANK)
            await s.commit()
            assert await formats.tournament_slot_shape(s, overwatch.id) == RosterShape(
                entries=(("tank", 1), ("flex", 5))
            )

    async def test_a_format_that_cannot_be_stored_is_a_422_naming_its_code(self) -> None:
        async with self.Session() as s:
            with self.assertRaises(BaseAPIException) as raised:
                await formats.save_tournament_format(s, self.tournaments[0], replace(ONE_TANK, starter_min=0))
        assert raised.exception.status_code == 422
        assert "team_format_sizes" in str(raised.exception.detail)

    async def test_a_lol_tournament_projects_its_positions(self) -> None:
        async with self.Session() as s:
            await formats.copy_for_tournament(s, self.tournaments[2])
            await s.commit()
            assert (await formats.tournament_slot_shape(s, self.tournaments[2].id)).slots == {
                "top": 1,
                "jungle": 1,
                "mid": 1,
                "bot": 1,
                "support": 1,
            }

    async def test_a_page_of_tournaments_reads_every_shape_with_its_source(self) -> None:
        async with self.Session() as s:
            await formats.save_tournament_format(s, self.tournaments[1], ONE_TANK)
            await s.commit()
            reads = await formats.tournament_shape_reads(s, self.tournaments[:2])
        assert (reads[self.tournaments[0].id].source, reads[self.tournaments[0].id].slots) == (
            "preset",
            {"tank": 1, "damage": 2, "support": 2},
        )
        assert (reads[self.tournaments[1].id].source, reads[self.tournaments[1].id].dimension) == (
            "tournament",
            "player_role",
        )

    async def test_a_mix_copies_its_preset_or_the_format_of_the_mix_it_was_cloned_from(self) -> None:
        async with self.Session() as s:
            rule = models.ScoringRule(
                workspace_id=self.workspace_id, preset="wins", game_formula="win", end_formula="1"
            )
            s.add(rule)
            await s.flush()
            source, clone = (
                models.CustomGame(workspace_id=self.workspace_id, name=name, scoring_rule_id=rule.id, discipline="lol")
                for name in ("source", "clone")
            )
            s.add_all([source, clone])
            await s.flush()
            await formats.copy_for_custom_game(s, source, preset_code="open_5v5")
            await formats.copy_for_custom_game(s, clone, source_game_id=source.id)
            await s.commit()
            assert (await formats.custom_game_slot_shape(s, clone)).slots == {"flex": 5}
            assert (await formats.custom_game_format(s, clone))[1] == "custom_game"
