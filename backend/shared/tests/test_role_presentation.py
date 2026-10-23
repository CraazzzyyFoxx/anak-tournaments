"""Role presentation (P7 §1.5): ``icon``/``color`` ride ``catalog.role.attrs`` from module declaration to child CRUD.

Pure checks plus the projection, the ontology/dictionary split and the sub-role service on the test Postgres.
"""

from __future__ import annotations

import asyncio
import itertools
import logging
import os
import sys
from unittest import IsolatedAsyncioTestCase

import pytest
import sqlalchemy as sa
from sqlalchemy.ext.asyncio import async_sessionmaker

from shared import models
from shared.core.errors import BaseAPIException
from shared.disciplines import DISCIPLINES, DimensionSpec, DisciplineSpec, RoleSpec
from shared.domain.roles import public_role_attrs, validate_presentation
from shared.repository import CatalogRoleRepository
from shared.rpc.player_sub_role import player_sub_role_entity
from shared.schemas.player_sub_role import PlayerSubRoleCreate, PlayerSubRoleUpdate
from shared.services.ontology import project_disciplines
from shared.services.player_sub_role import PlayerSubRoleService
from shared.testing import create_test_async_engine
from shared.testing.db import ensure_test_postgres

_TAG = itertools.count()


@pytest.mark.parametrize(
    "attrs",
    [
        {},
        {"icon": None, "color": None},
        {"icon": "https://cdn.example/roles/tank.svg", "color": "#0EA5e9"},
        {"icon": "assets/overwatch/roles/tank.svg"},
        {"icon": "/disciplines/overwatch/roles/tank.svg"},
        {"icon": "/disciplines/overwatch/roles/sub/main_tank.webp", "other": {"free": "form"}},
    ],
)
def test_declared_presentation_is_accepted(attrs: dict) -> None:
    validate_presentation(attrs, discipline="overwatch")


@pytest.mark.parametrize(
    "attrs",
    [
        {"icon": "javascript:alert(1)"},
        {"icon": "data:image/svg+xml;base64,AAAA"},
        {"icon": "http://cdn.example/tank.svg"},
        {"icon": "https://cdn.example/a b.svg"},
        {"icon": 'https://cdn.example/"onload=x.svg'},
        {"icon": "https://cdn.example/<svg>.svg"},
        {"icon": "https://cdn.example\\tank.svg"},
        {"icon": "https://cdn.example/../tank.svg"},
        {"icon": "assets/lol/roles/top.svg"},  # another game's key
        {"icon": "/disciplines/lol/roles/top.svg"},
        {"icon": "/disciplines/overwatch/roles/tank.gif"},
        {"icon": "/disciplines/overwatch/../../secret.svg"},
        {"icon": "https://" + "a" * 520},
        {"icon": 5},
        {"color": "red"},
        {"color": "#fff"},
        {"color": "#12345g"},
        {"color": "url(javascript:alert(1))"},
        {"color": 0xFFFFFF},
    ],
)
def test_arbitrary_css_html_and_foreign_urls_are_refused(attrs: dict) -> None:
    with pytest.raises(ValueError):
        validate_presentation(attrs, discipline="overwatch")


def test_a_module_cannot_project_an_unsafe_icon() -> None:
    spec = DisciplineSpec(
        "chess",
        "Chess",
        dimensions=(DimensionSpec("side", "Side", "single", True, (RoleSpec("w", "W", {"icon": "javascript:x"}),)),),
    )
    with pytest.raises(ValueError):
        asyncio.run(CatalogRoleRepository().project_module(None, spec))  # type: ignore[arg-type]  # refused first


def test_a_stored_object_key_resolves_to_the_public_url_and_other_forms_pass_through() -> None:
    attrs = {"icon": "assets/overwatch/roles/tank.svg", "color": "#0ea5e9", "extra": 1}
    assert public_role_attrs(attrs, public_origin="https://s3.example/aqt/") == {
        "icon": "https://s3.example/aqt/assets/overwatch/roles/tank.svg",
        "color": "#0ea5e9",
        "extra": 1,
    }
    for icon in ("https://x.example/a.svg", "/disciplines/overwatch/roles/tank.svg"):
        assert public_role_attrs({"icon": icon}, public_origin=None) == {"icon": icon}
    assert public_role_attrs({"color": "#000000"}, public_origin=None) == {"color": "#000000"}  # key stays absent


def test_an_unconfigured_public_origin_nulls_the_icon_with_one_warning(caplog: pytest.LogCaptureFixture) -> None:
    with caplog.at_level(logging.WARNING, logger="shared.domain.roles"):
        out = public_role_attrs({"icon": "assets/overwatch/roles/tank.svg"}, public_origin=None)
    assert out == {"icon": None}  # present and null: the key is not lost
    assert len(caplog.records) == 1


def test_the_installed_declarations_validate_and_overwatch_declares_its_three_accents() -> None:
    for code, spec in DISCIPLINES.items():
        for dimension in spec.dimensions:
            for role in dimension.roles:
                validate_presentation(role.attrs, discipline=code)
    declared = {role.code: role.attrs for role in DISCIPLINES["overwatch"].rated_dimension.roles}
    assert declared == {
        "tank": {"icon": "/disciplines/overwatch/roles/tank.svg", "color": "#5da8ef"},
        "damage": {"icon": "/disciplines/overwatch/roles/damage.svg", "color": "#ef6298"},
        "support": {"icon": "/disciplines/overwatch/roles/support.svg", "color": "#3fca85"},
    }
    assert all(not role.attrs for role in DISCIPLINES["lol"].rated_dimension.roles)


def _create(workspace_id: int, role: str, label: str, **fields) -> PlayerSubRoleCreate:
    return PlayerSubRoleCreate(workspace_id=workspace_id, discipline="overwatch", role=role, label=label, **fields)


class RolePresentationDbTests(IsolatedAsyncioTestCase):
    if sys.platform == "win32":
        loop_factory = asyncio.SelectorEventLoop  # psycopg async cannot run on the Proactor loop

    async def asyncSetUp(self) -> None:
        ensure_test_postgres()
        self.engine = create_test_async_engine()
        self.Session = async_sessionmaker(self.engine, expire_on_commit=False)
        self.tag = f"pres-{os.getpid()}-{next(_TAG)}"
        self.roles = CatalogRoleRepository()
        self.service = PlayerSubRoleService()
        self.workspaces: list[int] = []

    async def asyncTearDown(self) -> None:
        async with self.Session() as s:
            dims = sa.select(models.RoleDimension.id).where(models.RoleDimension.discipline == self.tag)
            await s.execute(sa.delete(models.CatalogRole).where(models.CatalogRole.dimension_id.in_(dims)))
            await s.execute(sa.delete(models.RoleDimension).where(models.RoleDimension.discipline == self.tag))
            await s.execute(sa.delete(models.Discipline).where(models.Discipline.code == self.tag))
            if self.workspaces:
                await s.execute(sa.delete(models.Workspace).where(models.Workspace.id.in_(self.workspaces)))
            await s.commit()
        await self.engine.dispose()

    async def _workspace(self, suffix: str) -> int:
        async with self.Session() as s:
            workspace = models.Workspace(slug=f"{self.tag}-{suffix}", name=f"{self.tag} {suffix}")
            s.add(workspace)
            await s.commit()
            self.workspaces.append(workspace.id)
            return workspace.id

    async def _project(self, spec: DisciplineSpec) -> None:
        async with self.Session() as s:
            await self.roles.project_module(s, spec)
            await s.commit()

    async def _row(self, role_id: int) -> models.CatalogRole:
        async with self.Session() as s:
            return await self.roles.get(s, role_id)

    async def _make(self, data: PlayerSubRoleCreate) -> models.CatalogRole:
        async with self.Session() as s:
            return await self.service.create_sub_role(s, data)

    async def _update(self, role_id: int, data: PlayerSubRoleUpdate) -> None:
        async with self.Session() as s:
            await self.service.update_sub_role(s, role_id, data)

    async def test_overwatch_module_roles_carry_their_declared_presentation_after_projection(self) -> None:
        async with self.Session() as s:
            await project_disciplines(s)
            await s.commit()
        async with self.Session() as s:
            ontology = await self.roles.ontology(s, discipline="overwatch", workspace_id=None)
            lol = await self.roles.ontology(s, discipline="lol", workspace_id=None)
        tank = ontology.node("player_role", "tank")
        assert dict(tank.attrs) == {"icon": "/disciplines/overwatch/roles/tank.svg", "color": "#5da8ef"}
        assert {r.code: r.attrs.get("color") for r in ontology.roots("player_role")} == {
            "tank": "#5da8ef",
            "damage": "#ef6298",
            "support": "#3fca85",
        }
        assert all(dict(r.attrs) == {} for r in lol.roots("position"))

    async def test_reprojection_rewrites_module_attrs_but_never_touches_a_child(self) -> None:
        async with self.Session() as s:
            await project_disciplines(s)
            await s.commit()
        workspace = await self._workspace("ws")
        child = await self._make(_create(workspace, "damage", "Hitscan", icon=None, color="#123456"))
        async with self.Session() as s:
            damage = await self.roles.resolve(
                s, discipline="overwatch", workspace_id=None, dimension=None, code="damage"
            )
            damage.attrs = {"color": "#000000", "stale": True}  # a drifted module row
            await s.commit()
        async with self.Session() as s:
            await project_disciplines(s)
            await s.commit()
        async with self.Session() as s:
            damage = await self.roles.resolve(
                s, discipline="overwatch", workspace_id=None, dimension=None, code="damage"
            )
        assert damage.attrs == {"icon": "/disciplines/overwatch/roles/damage.svg", "color": "#ef6298"}
        assert (await self._row(child.id)).attrs == {"icon": None, "color": "#123456"}

    async def test_omitted_keys_inherit_explicit_null_clears_and_unrelated_attrs_survive_updates(self) -> None:
        workspace = await self._workspace("ws")
        inherit = await self._make(_create(workspace, "tank", "Inherit"))
        cleared = await self._make(_create(workspace, "tank", "Cleared", icon=None))
        assert inherit.attrs == {}  # absent key = inherit the ancestor at render time
        assert cleared.attrs == {"icon": None}  # explicit null = a cleared presentation

        async with self.Session() as s:
            row = await self.roles.get(s, inherit.id)
            row.attrs = {"note": "keep me"}
            await s.commit()
        await self._update(inherit.id, PlayerSubRoleUpdate(color="#abcdef"))
        assert (await self._row(inherit.id)).attrs == {"note": "keep me", "color": "#abcdef"}
        await self._update(inherit.id, PlayerSubRoleUpdate(label="Renamed"))  # names neither key: attrs untouched
        assert (await self._row(inherit.id)).attrs == {"note": "keep me", "color": "#abcdef"}
        await self._update(inherit.id, PlayerSubRoleUpdate(color=None))  # explicit null stores null
        assert (await self._row(inherit.id)).attrs == {"note": "keep me", "color": None}

    async def test_an_unsafe_presentation_is_a_422_and_writes_nothing(self) -> None:
        workspace = await self._workspace("ws")
        for bad in ({"icon": "javascript:alert(1)"}, {"color": "red"}, {"icon": "/disciplines/lol/roles/top.svg"}):
            with pytest.raises(BaseAPIException) as refused:
                await self._make(_create(workspace, "tank", "Bad", **bad))
            assert refused.value.status_code == 422
            assert "invalid_role_presentation" in str(refused.value.detail)
        good = await self._make(_create(workspace, "tank", "Good"))
        with pytest.raises(BaseAPIException) as refused:
            await self._update(good.id, PlayerSubRoleUpdate(icon="http://x.example/a.svg"))
        assert refused.value.status_code == 422
        assert (await self._row(good.id)).attrs == {}
        async with self.Session() as s:
            listed = await self.service.list_sub_roles(s, workspace_id=workspace, discipline="overwatch")
        assert [row.name for row in listed] == ["Good"]

    async def test_the_crud_wire_serializes_raw_presence_with_the_icon_resolved(self) -> None:
        workspace = await self._workspace("ws")
        child = await self._make(_create(workspace, "support", "Anchor", icon="assets/overwatch/roles/anchor.svg"))
        async with self.Session() as s:
            child = await self.service.get_sub_role(s, child.id)
            wired = await player_sub_role_entity("https://s3.example/aqt").serializer(s, child)
            bare = await player_sub_role_entity().serializer(s, child)
        assert wired["attrs"] == {"icon": "https://s3.example/aqt/assets/overwatch/roles/anchor.svg"}
        assert bare["attrs"] == {"icon": None}  # origin unconfigured: null, not a 500
        assert wired["discipline"] == "overwatch"

    async def test_a_create_must_name_its_discipline(self) -> None:
        with pytest.raises(ValueError):
            PlayerSubRoleCreate.model_validate({"workspace_id": 1, "role": "tank", "label": "x"})

    async def test_the_selection_ontology_is_ordered_and_active_while_the_dictionary_keeps_history(self) -> None:
        zeta = DimensionSpec("zeta", "Zeta", "single", False, (RoleSpec("z1", "Z1"), RoleSpec("z0", "Z0")))
        alpha = DimensionSpec("alpha", "Alpha", "single", True, (RoleSpec("a", "A", {"color": "#111111"}),))
        beta = DimensionSpec("beta", "Beta", "multi", False, (RoleSpec("b", "B"),))
        await self._project(DisciplineSpec(self.tag, self.tag, dimensions=(zeta, alpha, beta)))
        # The module drops "beta" and zeta's "z0": both deactivated, never deleted.
        zeta_v2 = DimensionSpec("zeta", "Zeta", "single", False, (RoleSpec("z1", "Z1"),))
        await self._project(DisciplineSpec(self.tag, self.tag, dimensions=(zeta_v2, alpha)))
        async with self.Session() as s:
            await s.execute(  # a sort_order tie: the code decides
                sa.update(models.RoleDimension)
                .where(models.RoleDimension.discipline == self.tag, models.RoleDimension.code == "alpha")
                .values(sort_order=0)
            )
            await s.commit()
        async with self.Session() as s:
            ontology = await self.roles.ontology(s, discipline=self.tag, workspace_id=None)
            dimensions, history = await self.roles.dictionary(s, discipline=self.tag, workspace_id=None)
        assert list(ontology.dimensions) == ["alpha", "zeta"]  # selection: active only, (sort_order, code)
        assert [d.code for d in dimensions] == ["alpha", "zeta", "beta"]  # history: beta (sort 2, inactive) last
        assert {d.code: d.active for d in dimensions} == {"alpha": True, "zeta": True, "beta": False}
        assert "b" in {r.code for r in history}  # a retired dimension's role is still renderable
        assert {r.code: r.active for r in history if r.dimension == "zeta"} == {"z1": True, "z0": False}
        assert dict(next(r for r in history if r.code == "a").attrs) == {"color": "#111111"}
        assert "b" not in {r.code for r in ontology.roles("beta")}

    async def test_the_dictionary_scopes_children_to_one_workspace(self) -> None:
        mine, theirs = await self._workspace("mine"), await self._workspace("theirs")
        a = await self._make(_create(mine, "damage", "Main"))
        b = await self._make(_create(theirs, "damage", "Main"))
        async with self.Session() as s:
            _, in_mine = await self.roles.dictionary(s, discipline="overwatch", workspace_id=mine)
            _, in_global = await self.roles.dictionary(s, discipline="overwatch", workspace_id=None)
        assert a.code == b.code and a.id != b.id  # same name, two rows
        assert {r.id for r in in_mine if r.workspace_id is not None} == {a.id}
        assert not [r for r in in_global if r.workspace_id is not None]
