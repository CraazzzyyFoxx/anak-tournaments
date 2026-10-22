from __future__ import annotations

import asyncio
import importlib
import sys
import uuid
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, Mock, patch

import sqlalchemy as sa
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from shared import models
from shared.disciplines import discipline
from shared.repository.workspace import WorkspaceRepository
from shared.testing import create_test_async_engine
from src.schemas.workspace import WorkspaceCreate, WorkspaceListItem, WorkspaceRead, WorkspaceUpdate

workspace_service = importlib.import_module("src.services.workspace.service")
workspaces = workspace_service.workspaces


class WorkspaceServiceTests(IsolatedAsyncioTestCase):
    def test_workspace_write_contract_refuses_grid_assignment_fields(self) -> None:
        for field in ("default_division_grid_version_id", "default_division_grid_versions"):
            with self.subTest(field=field):
                with self.assertRaises(ValidationError):
                    WorkspaceCreate.model_validate({"slug": "acme", "name": "Acme", field: 77})
                with self.assertRaises(ValidationError):
                    WorkspaceUpdate.model_validate({field: {"lol": 77}})

    async def test_update_member_roles_refreshes_member_after_flush(self) -> None:
        # Regression: ``updated_at`` (onupdate=func.now()) is server-computed and
        # gets expired by the UPDATE flush. Without refreshing it inside the async
        # context, the later sync read of ``member.updated_at`` triggers a lazy
        # load outside the greenlet -> sqlalchemy.exc.MissingGreenlet (HTTP 500).
        session = SimpleNamespace(flush=AsyncMock(), refresh=AsyncMock())
        member = SimpleNamespace(id=14, player_id=99, workspace_id=2)

        with (
            patch.object(
                workspaces,
                "get_member_auth_user_id",
                AsyncMock(return_value=22),
            ) as get_auth_user_id,
            patch.object(
                workspace_service,
                "user_has_only_workspace_owner_role",
                AsyncMock(return_value=False),
            ),
            patch.object(
                workspace_service,
                "replace_user_workspace_roles",
                AsyncMock(),
            ) as replace_roles,
        ):
            result = await workspaces.update_member_roles(session, member, role_ids=[5])

        self.assertIs(result, member)
        get_auth_user_id.assert_awaited_once_with(session, member)
        replace_roles.assert_awaited_once_with(session, user_id=22, workspace_id=2, role_ids=[5])
        session.flush.assert_awaited_once()
        session.refresh.assert_awaited_once_with(member)

    async def test_add_member_with_roles_refreshes_member_after_flush(self) -> None:
        session = SimpleNamespace(flush=AsyncMock(), refresh=AsyncMock())
        member = SimpleNamespace(id=14, player_id=99, workspace_id=2)

        with (
            patch.object(
                workspaces,
                "add_member",
                AsyncMock(return_value=member),
            ) as add_member,
            patch.object(
                workspace_service,
                "replace_user_workspace_roles",
                AsyncMock(),
            ) as replace_roles,
        ):
            result = await workspaces.add_member_with_roles(
                session,
                2,
                22,
                role_ids=[5],
            )

        self.assertIs(result, member)
        add_member.assert_awaited_once_with(session, 2, 22)
        replace_roles.assert_awaited_once_with(session, user_id=22, workspace_id=2, role_ids=[5])
        session.flush.assert_awaited_once()
        session.refresh.assert_awaited_once_with(member)

    async def test_get_member_auth_user_id_resolves_via_player(self) -> None:
        member = SimpleNamespace(id=14, player_id=99, workspace_id=2)
        player = SimpleNamespace(id=99, auth_user_id=22)
        session = SimpleNamespace()

        with patch.object(
            workspaces.user_repo,
            "get",
            AsyncMock(return_value=player),
        ) as get_player:
            auth_user_id = await workspaces.get_member_auth_user_id(session, member)

        self.assertEqual(22, auth_user_id)
        get_player.assert_awaited_once_with(session, 99)

    async def test_get_member_auth_user_id_raises_when_unlinked(self) -> None:
        member = SimpleNamespace(id=14, player_id=99, workspace_id=2)
        session = SimpleNamespace()

        with patch.object(
            workspaces.user_repo,
            "get",
            AsyncMock(return_value=None),
        ):
            with self.assertRaises(workspace_service.HTTPException):
                await workspaces.get_member_auth_user_id(session, member)

    async def test_add_member_resolves_player_id_from_auth_user_id(self) -> None:
        auth_user = SimpleNamespace(id=22, username="staff", email="s@ex.com")
        session = SimpleNamespace()
        player = SimpleNamespace(id=99, auth_user_id=22)
        created_member = SimpleNamespace(id=14, player_id=99, workspace_id=2)

        with (
            patch.object(
                workspace_service,
                "ensure_workspace_system_roles",
                AsyncMock(),
            ),
            patch.object(
                workspaces.auth_user_repo,
                "get",
                AsyncMock(return_value=auth_user),
            ),
            patch.object(
                workspaces.user_repo,
                "ensure_for_auth_user",
                AsyncMock(return_value=player),
            ) as ensure_for_auth_user,
            patch.object(
                workspace_service,
                "get_or_create_workspace_member",
                AsyncMock(return_value=created_member),
            ) as get_or_create,
        ):
            result = await workspaces.add_member(session, 2, 22)

        self.assertIs(result, created_member)
        ensure_for_auth_user.assert_awaited_once_with(session, auth_user_id=22, name_hint="staff")
        get_or_create.assert_awaited_once_with(session, workspace_id=2, player_id=99)

    async def test_add_member_provisions_player_when_none_linked(self) -> None:
        # Legacy auth user with no players.user: add_member now provisions a bare
        # player on demand (via ensure_for_auth_user) instead of raising 500.
        auth_user = SimpleNamespace(id=22, username="staff", email="s@ex.com")
        session = SimpleNamespace()
        provisioned = SimpleNamespace(id=77, auth_user_id=22)
        created_member = SimpleNamespace(id=14, player_id=77, workspace_id=2)

        with (
            patch.object(
                workspace_service,
                "ensure_workspace_system_roles",
                AsyncMock(),
            ),
            patch.object(
                workspaces.auth_user_repo,
                "get",
                AsyncMock(return_value=auth_user),
            ),
            patch.object(
                workspaces.user_repo,
                "ensure_for_auth_user",
                AsyncMock(return_value=provisioned),
            ) as ensure_for_auth_user,
            patch.object(
                workspace_service,
                "get_or_create_workspace_member",
                AsyncMock(return_value=created_member),
            ) as get_or_create,
        ):
            result = await workspaces.add_member(session, 2, 22)

        self.assertIs(result, created_member)
        ensure_for_auth_user.assert_awaited_once_with(session, auth_user_id=22, name_hint="staff")
        get_or_create.assert_awaited_once_with(session, workspace_id=2, player_id=77)

    async def test_resolve_member_role_ids_prefers_explicit_ids(self) -> None:
        session = SimpleNamespace()
        with (
            patch.object(workspace_service, "ensure_workspace_system_roles", AsyncMock()) as ensure,
            patch.object(workspace_service, "get_workspace_system_role", AsyncMock()) as get_role,
        ):
            result = await workspaces.resolve_member_role_ids(session, 2, role_ids=[9, 8], role_name="admin")
        ensure.assert_awaited_once_with(session, 2)
        get_role.assert_not_awaited()
        self.assertEqual([9, 8], result)

    async def test_resolve_member_role_ids_looks_up_named_system_role(self) -> None:
        session = SimpleNamespace()
        role = SimpleNamespace(id=4)
        with (
            patch.object(workspace_service, "ensure_workspace_system_roles", AsyncMock()),
            patch.object(workspace_service, "get_workspace_system_role", AsyncMock(return_value=role)) as get_role,
        ):
            result = await workspaces.resolve_member_role_ids(session, 2, role_ids=None, role_name=None)
        get_role.assert_awaited_once_with(session, 2, "player")
        self.assertEqual([4], result)


class WorkspaceGetAllVisibilityTests(IsolatedAsyncioTestCase):
    """``get_all`` serves three scopes. ``public`` is the home-page directory:
    ``is_hidden`` and ``unverified`` are dropped for EVERY caller, membership
    and ``is_superuser`` included. ``admin`` is the management list (superuser:
    everything, else own memberships only) and ``all`` unions that with the
    directory for the workspace switcher.

    Against a real database: the filter runs in SQL, and the workspaces below
    are known to the tests by their labels 1-4."""

    if sys.platform == "win32":
        loop_factory = asyncio.SelectorEventLoop

    async def asyncSetUp(self) -> None:
        self.engine = create_test_async_engine()
        self.session = AsyncSession(self.engine, expire_on_commit=False)
        tag = uuid.uuid4().hex
        rows = {
            1: models.Workspace(slug=f"{tag}-1", name="1", is_hidden=False, verification_status="trusted"),
            2: models.Workspace(slug=f"{tag}-2", name="2", is_hidden=True, verification_status="trusted"),
            3: models.Workspace(slug=f"{tag}-3", name="3", is_hidden=False, verification_status="verified"),
            4: models.Workspace(slug=f"{tag}-4", name="4", is_hidden=False, verification_status="unverified"),
        }
        self.session.add_all(rows.values())
        await self.session.flush()
        self.ids = {label: row.id for label, row in rows.items()}
        self.slugs = {label: row.slug for label, row in rows.items()}
        self.session.expunge_all()

    async def asyncTearDown(self) -> None:
        await self.session.rollback()
        await self.session.close()
        await self.engine.dispose()

    def _viewer(self, user):
        """``user`` with its label memberships turned into the test's workspace ids."""
        if user is None:
            return None
        ids = [self.ids.get(label, -label) for label in user.get_workspace_ids()]
        return SimpleNamespace(is_superuser=user.is_superuser, get_workspace_ids=Mock(return_value=ids))

    async def _get_all(self, user, scope: str = "public") -> list[int]:
        """The labels of the test's workspaces ``get_all`` returns; ``user`` names its memberships by label too."""
        result = await workspaces.get_all(self.session, user=self._viewer(user), scope=scope)
        label_of = {id_: label for label, id_ in self.ids.items()}
        return [label_of[w.id] for w in result if w.id in label_of]

    async def _by_slug(self, user) -> list[int]:
        """The labels whose slug resolves for ``user`` -- must be exactly what ``scope=all`` lists."""
        viewer = self._viewer(user)
        return [
            label
            for label, slug in self.slugs.items()
            if await workspaces.get_visible_by_slug(self.session, slug, user=viewer) is not None
        ]

    async def test_a_slug_resolves_exactly_where_the_switcher_lists_it(self) -> None:
        """The community page by slug: a hidden or ``unverified`` workspace opens to its members and
        superusers only, never to a visitor or a non-member."""
        viewers = {
            "anonymous": None,
            "non-member": SimpleNamespace(is_superuser=False, get_workspace_ids=Mock(return_value=[99])),
            "member of 2 and 4": SimpleNamespace(is_superuser=False, get_workspace_ids=Mock(return_value=[2, 4])),
            "superuser": SimpleNamespace(is_superuser=True, get_workspace_ids=Mock(return_value=[])),
        }
        expected = {
            "anonymous": [1, 3],
            "non-member": [1, 3],
            "member of 2 and 4": [1, 2, 3, 4],
            "superuser": [1, 2, 3, 4],
        }
        for name, user in viewers.items():
            with self.subTest(viewer=name):
                self.assertEqual(expected[name], await self._by_slug(user))
                self.assertEqual(expected[name], await self._get_all(user, "all"))

    async def test_a_slug_lookup_is_the_full_read_a_list_row_is_not(self) -> None:
        """The community page renders grids, so by slug answers what by id does, effective grids included."""
        by_slug = await workspaces.get_visible_by_slug(self.session, self.slugs[1], user=None)
        by_id = await workspaces.get_by_id(self.session, self.ids[1])

        self.assertEqual(
            WorkspaceRead.model_validate(by_id, from_attributes=True).model_dump(),
            WorkspaceRead.model_validate(by_slug, from_attributes=True).model_dump(),
        )

    async def test_the_directory_never_loads_a_workspace_it_leaves_out(self) -> None:
        """Every workspace loaded drags in its grid versions and all their tiers: filtering the loaded rows
        instead of the query made each home-page read hold every workspace's grids at once."""
        loaded: list[int] = []

        def on_load(workspace, _context) -> None:
            loaded.append(workspace.id)

        sa.event.listen(models.Workspace, "load", on_load)
        try:
            await workspaces.get_all(self.session)
        finally:
            sa.event.remove(models.Workspace, "load", on_load)

        self.assertEqual({self.ids[1], self.ids[3]}, set(loaded) & set(self.ids.values()))

    async def test_anonymous_sees_non_hidden_verified_and_trusted_workspaces(self) -> None:
        self.assertEqual([1, 3], await self._get_all(None))

    async def test_non_member_is_filtered_exactly_like_an_anonymous_viewer(self) -> None:
        user = SimpleNamespace(is_superuser=False, get_workspace_ids=Mock(return_value=[99]))

        self.assertEqual([1, 3], await self._get_all(user))

    async def test_unverified_stays_out_of_the_public_directory(self) -> None:
        """``unverified`` is the only tier the directory refuses: it is the
        default a self-service workspace is born at, before any superuser has
        looked at it."""
        user = SimpleNamespace(is_superuser=False, get_workspace_ids=Mock(return_value=[]))

        self.assertNotIn(4, await self._get_all(user))

    async def test_member_does_not_see_their_own_unverified_workspace_in_the_directory(self) -> None:
        """The directory is one shared surface: a member's own hidden or
        ``unverified`` workspace is reachable by slug and through the switcher
        (``scope=all``), never on the home page."""
        user = SimpleNamespace(is_superuser=False, get_workspace_ids=Mock(return_value=[2, 4]))

        self.assertEqual([1, 3], await self._get_all(user))

    async def test_superuser_gets_the_same_directory_as_a_visitor(self) -> None:
        """The whole point of the 2026-09-07 revision: an operator browsing the
        home page must not be shown workspaces nobody else can see."""
        user = SimpleNamespace(is_superuser=True, get_workspace_ids=Mock(return_value=[]))

        self.assertEqual([1, 3], await self._get_all(user))

    async def test_all_scope_adds_the_members_own_hidden_and_unverified_workspaces(self) -> None:
        user = SimpleNamespace(is_superuser=False, get_workspace_ids=Mock(return_value=[2, 4]))

        self.assertEqual([1, 2, 3, 4], await self._get_all(user, "all"))

    async def test_all_scope_for_a_superuser_is_every_workspace(self) -> None:
        user = SimpleNamespace(is_superuser=True, get_workspace_ids=Mock(return_value=[]))

        self.assertEqual([1, 2, 3, 4], await self._get_all(user, "all"))

    async def test_admin_scope_is_memberships_only_not_the_directory(self) -> None:
        """The management table must not pad a workspace admin's rows with
        every public workspace they have no business editing."""
        user = SimpleNamespace(is_superuser=False, get_workspace_ids=Mock(return_value=[4]))

        self.assertEqual([4], await self._get_all(user, "admin"))

    async def test_admin_scope_for_a_superuser_is_every_workspace(self) -> None:
        """Including ``unverified`` ones -- this is the list a superuser
        verifies workspaces from, so the tier gate must not reach it."""
        user = SimpleNamespace(is_superuser=True, get_workspace_ids=Mock(return_value=[]))

        self.assertEqual([1, 2, 3, 4], await self._get_all(user, "admin"))

    async def test_admin_scope_is_empty_for_an_anonymous_caller(self) -> None:
        self.assertEqual([], await self._get_all(None, "admin"))


class WorkspacePublicGridTests(IsolatedAsyncioTestCase):
    if sys.platform == "win32":
        loop_factory = asyncio.SelectorEventLoop

    async def test_service_read_serializes_two_explicit_defaults_and_batched_system_fallbacks(self):
        engine = create_test_async_engine()
        async with AsyncSession(engine, expire_on_commit=False) as session:
            tag = uuid.uuid4().hex
            try:
                system = models.DivisionGridVersion(
                    grid=models.DivisionGrid(slug=tag + "-system", name="System OW", discipline="overwatch"),
                    version=1,
                    label="System OW",
                    status="published",
                    tiers=[
                        models.DivisionGridTier(
                            slug="system",
                            number=45,
                            name="System tier",
                            sort_order=0,
                            rank_min=0,
                            rank_max=None,
                            icon_url="/system.png",
                        )
                    ],
                )
                session.add(system)
                await session.flush()
                workspace = await workspaces.create(
                    session, slug=tag, name=tag, disciplines_enabled=["overwatch", "lol"]
                )
                # Each game gets its own native-ladder grid, in force: a new workspace has played nothing yet.
                self.assertEqual(set(workspace.default_division_grid_versions), {"overwatch", "lol"})
                initial = WorkspaceRead.model_validate(workspace, from_attributes=True).model_dump()
                self.assertNotIn("default_division_grid_version_id", initial)
                self.assertNotIn("default_division_grid_version", initial)
                self.assertEqual(
                    {
                        code: data["tiers"][0]["slug"]
                        for code, data in initial["effective_division_grid_versions"].items()
                    },
                    {"overwatch": "champion-1", "lol": "challenger"},
                )
                expected = {}
                for code, number in (("overwatch", 4), ("lol", 9)):
                    grid = models.DivisionGrid(workspace_id=workspace.id, slug=code, name=code, discipline=code)
                    version = models.DivisionGridVersion(
                        grid=grid,
                        version=1,
                        label=code,
                        status="published",
                        tiers=[
                            models.DivisionGridTier(
                                slug=code,
                                number=number,
                                name=code,
                                sort_order=0,
                                rank_min=0,
                                rank_max=None,
                                icon_url="/tier.png",
                            )
                        ],
                    )
                    session.add(version)
                    await session.flush()
                    await WorkspaceRepository().set_default_grid_version(
                        session, workspace, discipline=code, version_id=version.id
                    )
                    expected[code] = version.id
                loaded = await workspaces.get_by_id(session, workspace.id)
                payload = WorkspaceRead.model_validate(loaded, from_attributes=True).model_dump()
                self.assertEqual(payload["default_division_grid_versions"], expected)
                self.assertEqual(
                    {
                        code: data["tiers"][0]["number"]
                        for code, data in payload["effective_division_grid_versions"].items()
                    },
                    {"overwatch": 4, "lol": 9},
                )
                counts = []
                for index in range(2):
                    session.add(models.Workspace(slug=f"{tag}-{index}", name="Public", verification_status="trusted"))
                    await session.flush()
                    session.expunge_all()
                    statements = []

                    def count_sql(*args, statements=statements):
                        statements.append(args[2])

                    sa.event.listen(engine.sync_engine, "before_cursor_execute", count_sql)
                    try:
                        public = await workspaces.get_all(session)
                        serialized = [WorkspaceListItem.model_validate(row, from_attributes=True) for row in public]
                    finally:
                        sa.event.remove(engine.sync_engine, "before_cursor_execute", count_sql)
                    counts.append(len(statements))
                    self.assertTrue(any(item.slug == f"{tag}-{index}" for item in serialized))
                    # A list row carries no grids: neither its queries nor its payload reach a version or a tier.
                    self.assertEqual(
                        [], [sql for sql in statements if "division_grid_version" in sql or "division_grid_tier" in sql]
                    )
                    self.assertNotIn("effective_division_grid_versions", serialized[0].model_dump())
                self.assertEqual(counts[0], counts[1])
                print(
                    f"WorkspaceRead: explicit OW+LoL, scoped effective payloads, no legacy fields; list queries {counts}"
                )
            finally:
                await session.rollback()
        await engine.dispose()

    async def test_enabling_a_game_provisions_and_activates_its_own_grid_once(self):
        engine = create_test_async_engine()
        async with AsyncSession(engine, expire_on_commit=False) as session:
            tag = uuid.uuid4().hex
            try:
                workspace = await workspaces.create(session, slug=tag, name=tag, disciplines_enabled=["overwatch"])
                self.assertEqual(set(workspace.default_division_grid_versions), {"overwatch"})
                await workspaces.update(session, workspace, {"disciplines_enabled": ["overwatch", "lol"]})
                lol = await session.scalar(
                    sa.select(models.DivisionGrid).where(
                        models.DivisionGrid.workspace_id == workspace.id, models.DivisionGrid.discipline == "lol"
                    )
                )
                self.assertEqual(
                    (lol.slug, lol.name, lol.versions[0].status), ("lol-default", "League of Legends", "published")
                )
                payload = WorkspaceRead.model_validate(workspace, from_attributes=True).model_dump()
                self.assertEqual(payload["default_division_grid_versions"]["lol"], lol.versions[0].id)
                self.assertEqual(
                    len(payload["effective_division_grid_versions"]["lol"]["tiers"]),
                    len(discipline("lol").native_ladder),
                )
                # Off and on again: the game already has its own grid, so nothing more is created.
                await workspaces.update(session, workspace, {"disciplines_enabled": ["lol"]})
                await workspaces.update(session, workspace, {"disciplines_enabled": ["lol", "overwatch"]})
                self.assertEqual(
                    await session.scalar(
                        sa.select(sa.func.count())
                        .select_from(models.DivisionGrid)
                        .where(models.DivisionGrid.workspace_id == workspace.id)
                    ),
                    2,
                )
            finally:
                await session.rollback()
        await engine.dispose()
