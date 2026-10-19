"""The real roster RPC boundary: provider-scoped identities, admission, RBAC and exact wire cutover."""

from __future__ import annotations

import asyncio
import sys
from contextlib import asynccontextmanager
from pathlib import Path
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase
from unittest.mock import patch
from uuid import uuid4

for root in (Path(__file__).resolve().parents[1], Path(__file__).resolve().parents[2]):
    if str(root) not in sys.path:
        sys.path.insert(0, str(root))

import sqlalchemy as sa  # noqa: E402
from sqlalchemy.ext.asyncio import AsyncSession  # noqa: E402

from shared import models  # noqa: E402
from shared.core.errors import ApiHTTPException  # noqa: E402
from shared.core.social import SocialProvider  # noqa: E402
from shared.services import workspace_roster  # noqa: E402
from shared.services.ontology import project_disciplines  # noqa: E402
from shared.services.social_identity import social_identity_service  # noqa: E402
from shared.testing import create_test_async_engine  # noqa: E402
from src.rpc import players  # noqa: E402


class _Broker:
    def __init__(self):
        self.handlers = {}

    def subscriber(self, subject):
        def register(fn):
            self.handlers[subject] = fn
            return fn

        return register


class RosterIdentityTests(IsolatedAsyncioTestCase):
    if sys.platform == "win32":
        loop_factory = asyncio.SelectorEventLoop

    async def asyncSetUp(self):
        self.engine = create_test_async_engine()
        self.connection = await self.engine.connect()
        self.transaction = await self.connection.begin()
        self.session = AsyncSession(
            bind=self.connection, expire_on_commit=False, join_transaction_mode="create_savepoint"
        )
        # The LoL ranked-position ontology is not ambient test-DB state: project it like the other DB tests do.
        await project_disciplines(self.session)
        self.workspace = models.Workspace(
            slug=f"identity-{uuid4().hex}", name="Identity", disciplines_enabled=["overwatch", "lol"]
        )
        self.session.add(self.workspace)
        await self.session.flush()
        self.host = models.AuthUser(username=f"host-{uuid4().hex}", email=f"{uuid4().hex}@example.test")
        self.session.add(self.host)
        await self.session.flush()

    async def asyncTearDown(self):
        await self.session.close()
        await self.transaction.rollback()
        await self.connection.close()
        await self.engine.dispose()

    async def _player(self, name, **fields):
        player = models.User(name=f"{name}-{uuid4().hex[:8]}", **fields)
        self.session.add(player)
        await self.session.flush()
        return player

    async def _account(self, player, provider, handle, **fields):
        return await social_identity_service.upsert(
            self.session, user_id=player.id, provider=provider, username=handle, **fields
        )

    async def _call(self, subject, *, host_only=False, query=None, **body):
        broker = _Broker()
        logger = SimpleNamespace(exception=lambda *a, **k: None, warning=lambda *a, **k: None)
        players.register(broker, logger)

        @asynccontextmanager
        async def factory():
            yield self.session

        identity = {
            "user_id": self.host.id,
            "is_superuser": False,
            "is_active": True,
            "roles": [],
            "permissions": [],
            "workspaces": [
                {
                    "workspace_id": self.workspace.id,
                    "role": "host" if host_only else "admin",
                    "rbac_roles": ["host" if host_only else "admin"],
                    "rbac_permissions": [
                        {"resource": "custom_game", "action": "create"},
                        *([] if host_only else [{"resource": "team", "action": "create"}]),
                    ],
                }
            ],
        }
        with patch.object(players, "_SF", factory):
            return await broker.handlers[subject](
                {"workspace_id": self.workspace.id, "identity": identity, "payload": body, "query": query or {}}, None
            )

    async def test_lol_rpc_normalizes_reuses_real_player_and_keeps_verification_unset(self):
        handle = f"Riot Name {uuid4().hex[:6]}#EUW"
        body = {"discipline": "lol", "identity": {"provider": "riot", "handle": f"  {handle.replace('#', ' # ')}  "}}
        response = await self._call("rpc.balancer.players.upsert", host_only=True, **body)
        assert response["ok"], response
        row = response["data"]
        assert row["identity"] == {"provider": "riot", "handle": handle}
        assert "battle_tag" not in row
        player = await self.session.get(models.User, row["player_id"])
        account = await social_identity_service.find_by_handle(self.session, provider="riot", username=handle)
        member = await self.session.get(models.WorkspaceMember, row["member_id"])
        assert player.auth_user_id is None and player.name == handle
        assert account.user_id == player.id and account.is_primary and not account.is_verified
        assert account.provider_user_id is None and member.observed_only is False
        again = await self._call(
            "rpc.balancer.players.upsert",
            host_only=True,
            discipline="lol",
            identity={"provider": "riot", "handle": handle.lower()},
        )
        assert again["ok"] and again["data"]["member_id"] == member.id
        assert again["data"]["player_id"] == player.id

    async def test_real_conflict_and_provider_format_checks_write_nothing(self):
        handle = f"Collision {uuid4().hex[:5]}#EUW"
        for name in ("one", "two"):
            await self._account(await self._player(name), "riot", handle)
        before = await self.session.scalar(
            sa.select(sa.func.count())
            .select_from(models.WorkspaceMember)
            .where(models.WorkspaceMember.workspace_id == self.workspace.id)
        )
        for discipline, provider, entered, code, status in [
            ("lol", "battlenet", "Valid#1234", "identity.provider_mismatch", 422),
            ("lol", "riot", "missing-tag", "identity.riot.format", 422),
            ("lol", "riot", handle, "identity_conflict", 409),
        ]:
            with self.assertRaises(ApiHTTPException) as caught:
                await workspace_roster.ensure_member_for_identity(
                    self.session,
                    workspace_id=self.workspace.id,
                    discipline=discipline,
                    provider=provider,
                    handle=entered,
                )
            assert caught.exception.status_code == status
            assert caught.exception.detail[0]["code"] == code
        after = await self.session.scalar(
            sa.select(sa.func.count())
            .select_from(models.WorkspaceMember)
            .where(models.WorkspaceMember.workspace_id == self.workspace.id)
        )
        assert before == after == 0
        self.workspace.disciplines_enabled = ["overwatch"]
        await self.session.flush()
        response = await self._call(
            "rpc.balancer.players.upsert", discipline="lol", identity={"provider": "riot", "handle": handle}
        )
        assert not response["ok"] and "discipline_not_enabled" in response["error"]["message"]

    async def test_observation_anchor_is_hidden_until_real_admission_and_verified_account_is_unchanged(self):
        player = await self._player("observed")
        handle = f"Observed {uuid4().hex[:5]}#EUW"
        account = await self._account(player, "riot", handle, is_verified=True, provider_user_id=uuid4().hex)
        subject = account.provider_user_id
        member = models.WorkspaceMember(workspace_id=self.workspace.id, player_id=player.id, observed_only=True)
        self.session.add(member)
        await self.session.flush()
        rows, total = await workspace_roster.roster_page(self.session, workspace_id=self.workspace.id, provider="riot")
        assert not rows and total == 0
        admitted = await workspace_roster.ensure_member_for_identity(
            self.session, workspace_id=self.workspace.id, discipline="lol", provider="riot", handle=handle.lower()
        )
        assert admitted.id == member.id and admitted.observed_only is False
        assert account.username == handle and account.is_verified and account.provider_user_id == subject
        assert player.auth_user_id is None
        rows, total = await workspace_roster.roster_page(self.session, workspace_id=self.workspace.id, provider="riot")
        assert total == 1 and rows[0].identity.handle == handle

    async def test_each_owner_provider_selects_its_own_primary_and_normalized_search(self):
        player = await self._player("both")
        marker = uuid4().hex[:6]
        await self._account(player, "battlenet", f"Battle{marker}#1234")
        await self._account(player, "riot", f"Riot Name {marker}#EUW")
        await self._account(player, "riot", f"Riot Alt {marker}#KR1")
        missing = await self._player("other-game-only")
        await self._account(missing, "battlenet", f"Only{marker}#1234")
        for person in (player, missing):
            self.session.add(models.WorkspaceMember(workspace_id=self.workspace.id, player_id=person.id))
        await self.session.flush()
        lol = await self._call("rpc.balancer.players.list", query={"discipline": "lol"})
        assert lol["ok"], lol
        by_player = {r["player_id"]: r for r in lol["data"]["results"]}
        assert by_player[player.id]["identity"] == {"provider": "riot", "handle": f"Riot Name {marker}#EUW"}
        assert by_player[missing.id]["identity"] is None
        rows, total = await workspace_roster.roster_page(
            self.session, workspace_id=self.workspace.id, provider="riot", search=f"RIOT NAME {marker} # EUW"
        )
        assert total == 1 and rows[0].player_id == player.id
        rows, total = await workspace_roster.roster_page(
            self.session, workspace_id=self.workspace.id, provider="riot", search=f"Battle{marker}#1234"
        )
        assert total == 0
        rows = await workspace_roster.list_roster(
            self.session,
            workspace_id=self.workspace.id,
            provider="battlenet",
            member_ids=[r["member_id"] for r in by_player.values()],
        )
        assert all(r.identity.provider == SocialProvider.BATTLENET for r in rows.values())

    async def test_old_wire_is_forbidden_and_mix_host_cannot_rename_existing_member(self):
        handle = f"Existing {uuid4().hex[:5]}#EUW"
        member = await workspace_roster.ensure_member_for_identity(
            self.session,
            workspace_id=self.workspace.id,
            discipline="lol",
            provider="riot",
            handle=handle,
            display_name="Original",
        )
        response = await self._call(
            "rpc.balancer.players.upsert",
            host_only=True,
            discipline="lol",
            identity={"provider": "riot", "handle": handle},
            display_name="Hijacked",
        )
        assert not response["ok"] and response["error"]["code"] == "forbidden"
        await self.session.refresh(member)
        assert member.display_name == "Original"
        response = await self._call(
            "rpc.balancer.players.upsert",
            discipline="lol",
            identity={"provider": "riot", "handle": handle},
            battle_tag="Legacy#1234",
        )
        assert not response["ok"] and response["error"]["code"] == "unprocessable"
        assert response["error"]["details"]["fields"][0]["field"] == "battle_tag"

    async def test_display_name_never_proves_identity_and_riot_export_uses_exact_accounts(self):
        from shared.services.team_export.identity import find_users_by_handles

        handle = f"Named {uuid4().hex[:5]}#EUW"
        unrelated = models.User(name=handle)
        self.session.add(unrelated)
        await self.session.flush()
        member = await workspace_roster.ensure_member_for_identity(
            self.session, workspace_id=self.workspace.id, discipline="lol", provider="riot", handle=handle
        )
        assert member.player_id != unrelated.id
        player = await self.session.get(models.User, member.player_id)
        assert player.name == f"{handle} (2)"
        resolved = await find_users_by_handles(self.session, [handle, unrelated.name.split("#")[0]], provider="riot")
        assert resolved[handle].id == member.player_id
        assert unrelated.name.split("#")[0] not in resolved
