"""Log lookup keeps provider and team boundaries on real PostgreSQL identities."""

from __future__ import annotations

import asyncio
import sys
import uuid
from unittest import IsolatedAsyncioTestCase

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import async_sessionmaker

from shared import models
from shared.core.social import normalize_social_handle
from shared.testing import create_test_async_engine
from src.services.match_logs import service


class MatchLogIdentityTests(IsolatedAsyncioTestCase):
    if sys.platform == "win32":
        loop_factory = asyncio.SelectorEventLoop

    async def asyncSetUp(self) -> None:
        self.engine = create_test_async_engine()
        self.Session = async_sessionmaker(self.engine, expire_on_commit=False)
        tag = f"id {uuid.uuid4().hex[:8]}"
        self.handle = f"{tag}#1234"
        self.users = {}
        self.players = {}
        async with self.Session() as s:
            workspace = models.Workspace(slug=tag, name=tag)
            s.add(workspace)
            await s.flush()
            self.workspace_id = workspace.id
            tournament = models.Tournament(workspace_id=workspace.id, name=tag, slug=tag)
            s.add(tournament)
            await s.flush()
            self.team = models.Team(tournament_id=tournament.id, name=tag, balancer_name=tag)
            self.other_team = models.Team(tournament_id=tournament.id, name="Other", balancer_name="Other")
            s.add_all([self.team, self.other_team])
            await s.flush()
            for provider in ("battlenet", "riot"):
                user = models.User(name=f"{tag}-{provider}")
                s.add(user)
                await s.flush()
                self.users[provider] = user.id
                member = models.WorkspaceMember(workspace_id=workspace.id, player_id=user.id)
                s.add_all(
                    [
                        member,
                        models.SocialAccount(
                            user_id=user.id,
                            provider=provider,
                            username=self.handle,
                            username_normalized=normalize_social_handle(provider, self.handle),
                        ),
                        models.SocialAccount(
                            user_id=user.id,
                            provider=provider,
                            username=f"{tag}-{provider}#1234",
                            username_normalized=f"{tag}-{provider}#1234",
                        ),
                    ]
                )
                await s.flush()
                player = models.Player(
                    tournament_id=tournament.id,
                    team_id=self.team.id,
                    workspace_member_id=member.id,
                    name=user.name,
                    rank=0,
                )
                s.add(player)
                await s.flush()
                self.players[provider] = player.id
            await s.commit()

    async def asyncTearDown(self) -> None:
        async with self.Session() as s:
            await s.execute(sa.delete(models.Workspace).where(models.Workspace.id == self.workspace_id))
            await s.execute(sa.delete(models.User).where(models.User.id.in_(self.users.values())))
            await s.commit()
        await self.engine.dispose()

    async def test_batch_lookup_scopes_name_and_full_handle_without_fallback(self) -> None:
        name = self.handle.split("#", 1)[0].upper()
        full = self.handle.upper()
        for provider in ("battlenet", "riot"):
            other = "riot" if provider == "battlenet" else "battlenet"
            absent = f"{self.handle.split('#', 1)[0]}-{other}"
            async with self.Session() as s:
                users = await service.get_users_by_battle_names(s, [name, full, absent], provider=provider)
                players = await service.get_players_by_team_and_battle_names(
                    s,
                    self.team,
                    [name, full, absent],
                    provider=provider,
                )
                outside = await service.get_players_by_team_and_battle_names(
                    s,
                    self.other_team,
                    [name, full],
                    provider=provider,
                )
            assert {key: user.id for key, user in users.items()} == {
                name: self.users[provider],
                full: self.users[provider],
            }
            assert {key: player.id for key, player in players.items()} == {
                name: self.players[provider],
                full: self.players[provider],
            }
            assert outside == {}
