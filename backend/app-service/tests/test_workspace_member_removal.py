"""Soft removal of workspace members (D66): ``remove_member`` keeps the row.

A roster snapshot (``encounter.team_member``) is anchored on the member row, so
removing somebody revokes their roles and access and stamps ``removed_at``;
every member list/lookup that means "who may act in this workspace" hides the
row, and re-adding the same player reuses it. Needs the test Postgres; skips
otherwise.
"""

from __future__ import annotations

import asyncio
import itertools
import os
import sys
from unittest import IsolatedAsyncioTestCase

import sqlalchemy as sa

from shared.core import enums
from shared.models.encounter import Encounter, EncounterTeam, EncounterTeamMember, ScoringRule
from shared.models.identity.auth_user import AuthUser
from shared.models.identity.user import User
from shared.models.tenancy.workspace import Workspace, WorkspaceMember
from shared.models.tournament.tournament import Tournament
from shared.rbac import get_workspace_system_role, user_has_any_workspace_role
from shared.repository import WorkspaceMemberRepository, get_or_create_workspace_member
from shared.testing.db import real_db_sessionmaker
from src.services.workspace.service import workspaces as workspace_service

_TAG = itertools.count()
_WINS_END = "games >= best_of or max_wins * 2 > best_of"


class WorkspaceMemberRemovalTests(IsolatedAsyncioTestCase):
    if sys.platform == "win32":
        loop_factory = asyncio.SelectorEventLoop  # psycopg/asyncpg cannot run on the Proactor loop here

    async def asyncSetUp(self) -> None:
        self.workspace_ids: list[int] = []
        self.player_ids: list[int] = []
        self.auth_ids: list[int] = []
        ctx = real_db_sessionmaker()
        self._ctx = ctx
        self.Session = await ctx.__aenter__()
        self.addAsyncCleanup(self._cleanup)
        self.members = WorkspaceMemberRepository()

    async def _cleanup(self) -> None:
        try:
            async with self.Session() as s:
                await s.execute(sa.delete(Workspace).where(Workspace.id.in_(self.workspace_ids)))
                await s.execute(sa.delete(User).where(User.id.in_(self.player_ids)))
                await s.execute(sa.delete(AuthUser).where(AuthUser.id.in_(self.auth_ids)))
                await s.commit()
        finally:
            await self._ctx.__aexit__(None, None, None)

    async def _seed(self, session) -> tuple[Workspace, AuthUser, User]:
        tag = f"rm-{os.getpid()}-{next(_TAG)}"
        workspace = Workspace(slug=tag, name=tag)
        auth_user = AuthUser(email=f"{tag}@example.com", username=tag, hashed_password="x")
        session.add_all([workspace, auth_user])
        await session.flush()
        player = User(name=tag, auth_user_id=auth_user.id)
        session.add(player)
        await session.flush()
        self.workspace_ids.append(workspace.id)
        self.auth_ids.append(auth_user.id)
        self.player_ids.append(player.id)
        return workspace, auth_user, player

    async def _add_admin(self, session, workspace, auth_user) -> WorkspaceMember:
        await workspace_service.add_member(session, workspace.id, auth_user.id)  # provisions the system roles
        admin = await get_workspace_system_role(session, workspace.id, "admin")
        return await workspace_service.add_member_with_roles(session, workspace.id, auth_user.id, role_ids=[admin.id])

    async def _roster_row(self, session, workspace, member) -> EncounterTeamMember:
        tag = f"rm-enc-{os.getpid()}-{next(_TAG)}"
        tournament = Tournament(
            workspace_id=workspace.id, discipline="overwatch", name=tag, slug=tag, status=enums.TournamentStatus.LIVE
        )
        rule = ScoringRule(workspace_id=workspace.id, preset="wins", game_formula="win", end_formula=_WINS_END)
        session.add_all([tournament, rule])
        await session.flush()
        encounter = Encounter(
            workspace_id=workspace.id,
            discipline="overwatch",
            tournament_id=tournament.id,
            scoring_rule_id=rule.id,
            name="E",
            slot_count=2,
            status=enums.EncounterStatus.OPEN,
        )
        session.add(encounter)
        await session.flush()
        team = EncounterTeam(encounter_id=encounter.id, tournament_id=tournament.id, slot=1, name="T")
        session.add(team)
        await session.flush()
        row = EncounterTeamMember(
            encounter_id=encounter.id,
            encounter_team_id=team.id,
            active=True,
            workspace_member_id=member.id,
            display_name_snapshot="snap",
        )
        session.add(row)
        await session.flush()
        return row

    async def test_remove_member_revokes_roles_and_keeps_the_row_and_its_roster(self) -> None:
        async with self.Session() as s:
            workspace, auth_user, _player = await self._seed(s)
            member = await self._add_admin(s, workspace, auth_user)
            roster = await self._roster_row(s, workspace, member)
            await s.commit()

            await workspace_service.revoke_member(s, member)  # commits

            row = await s.scalar(sa.select(WorkspaceMember).where(WorkspaceMember.id == member.id))
            self.assertIsNotNone(row)
            self.assertIsNotNone(row.removed_at)
            self.assertFalse(
                await user_has_any_workspace_role(s, user_id=auth_user.id, workspace_id=workspace.id),
            )
            kept = await s.scalar(
                sa.select(EncounterTeamMember.workspace_member_id).where(EncounterTeamMember.id == roster.id)
            )
            self.assertEqual(member.id, kept)

    async def test_member_lists_and_lookups_hide_a_removed_member(self) -> None:
        async with self.Session() as s:
            workspace, auth_user, player = await self._seed(s)
            member = await self._add_admin(s, workspace, auth_user)
            self.assertEqual([member.id], [m.id for m in await workspace_service.get_members(s, workspace.id)])

            await workspace_service.remove_member(s, member)
            await s.flush()

            self.assertEqual([], list(await workspace_service.get_members(s, workspace.id)))
            total, rows = await workspace_service.list_members_page(s, workspace.id, page=1, per_page=50, search=None)
            self.assertEqual((0, []), (total, rows))
            self.assertIsNone(await workspace_service.get_member(s, workspace.id, auth_user.id))
            self.assertFalse(
                await self.members.exists_for_auth_user(s, workspace_id=workspace.id, auth_user_id=auth_user.id)
            )
            self.assertEqual([], await self.members.list_memberships_for_auth_user(s, auth_user.id))
            self.assertEqual([], list(await self.members.workspace_ids_for_player(s, player.id)))
            # The role autofill must not hand a removed member their baseline role back.
            self.assertEqual(0, await workspace_service.autofill_member_roles(s, workspace.id))
            self.assertFalse(await user_has_any_workspace_role(s, user_id=auth_user.id, workspace_id=workspace.id))

    async def test_re_adding_a_removed_member_reuses_the_row_and_clears_removed_at(self) -> None:
        async with self.Session() as s:
            workspace, auth_user, _player = await self._seed(s)
            member = await self._add_admin(s, workspace, auth_user)
            await workspace_service.remove_member(s, member)
            await s.flush()

            invited = await workspace_service.add_member(s, workspace.id, auth_user.id)

            self.assertEqual(member.id, invited.id)
            self.assertIsNone(invited.removed_at)
            self.assertEqual([member.id], [m.id for m in await workspace_service.get_members(s, workspace.id)])
            self.assertTrue(await user_has_any_workspace_role(s, user_id=auth_user.id, workspace_id=workspace.id))

    async def test_anchoring_a_removed_player_again_clears_removed_at(self) -> None:
        async with self.Session() as s:
            workspace, auth_user, player = await self._seed(s)
            member = await self._add_admin(s, workspace, auth_user)
            await workspace_service.remove_member(s, member)
            await s.flush()

            again = await get_or_create_workspace_member(s, workspace_id=workspace.id, player_id=player.id)
            self.assertEqual(member.id, again.id)
            self.assertIsNone(again.removed_at)

            await workspace_service.remove_member(s, again)
            await s.flush()
            by_player = await self.members.bulk_get_or_create(s, workspace_id=workspace.id, player_ids=[player.id])
            self.assertEqual({player.id: member.id}, by_player)
            await s.refresh(member)
            self.assertIsNone(member.removed_at)
            self.assertTrue(await user_has_any_workspace_role(s, user_id=auth_user.id, workspace_id=workspace.id))
