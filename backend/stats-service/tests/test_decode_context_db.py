"""``load_decode_context`` against a real catalog: what a raw decoder may resolve, and in which precedence."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime

import sqlalchemy as sa
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from shared import models
from shared.schemas.match_doc import MatchSource
from src.services.ingest.decode_context import load_decode_context


def test_names_aliases_modes_and_activity_resolve_with_the_p4_precedence(stats_parity_database):
    url, _ = stats_parity_database

    async def run() -> None:
        engine = create_async_engine(make_url(url).set(drivername="postgresql+asyncpg"))
        try:
            async with async_sessionmaker(engine, expire_on_commit=False)() as session:
                entity = models.CatalogEntity
                # An alias registered BEFORE its namesake's own row must not shadow the canonical name.
                rival = entity(
                    discipline="overwatch",
                    kind="character",
                    slug="ctx-rival",
                    name="Rival",
                    aliases=["Ctx Ana"],
                    attrs={"class": "damage"},
                )
                ana = entity(
                    discipline="overwatch",
                    kind="character",
                    slug="ctx-ana",
                    name="Ctx Ana",
                    aliases=["Ана ctx"],
                    attrs={"class": "support"},
                )
                retired = entity(
                    discipline="overwatch",
                    kind="character",
                    slug="ctx-old",
                    name="Retired",
                    attrs={"class": "tank"},
                    active=False,
                )
                control = entity(
                    discipline="overwatch", kind="mode", slug="ctx-control", name="CtxControl", aliases=["КонтрольCtx"]
                )
                escort = entity(discipline="overwatch", kind="mode", slug="ctx-escort", name="CtxEscort")
                push = entity(discipline="overwatch", kind="mode", slug="push", name="CtxPush", aliases=["ПушCtx"])
                existing_push = await session.scalar(
                    sa.select(entity).where(
                        entity.discipline == "overwatch", entity.kind == "mode", entity.slug == "push"
                    )
                )
                session.add_all([rival, ana, retired, control, escort, *([push] if existing_push is None else [])])
                await session.flush()
                session.add_all(
                    [
                        entity(
                            discipline="overwatch",
                            kind="map",
                            slug="ctx-a",
                            name="Twin",
                            parent_id=control.id,
                            aliases=["Близнец"],
                        ),
                        entity(
                            discipline="overwatch",
                            kind="map",
                            slug="ctx-b",
                            name="Twin Two",
                            parent_id=escort.id,
                            aliases=["Близнец"],
                        ),
                        entity(
                            discipline="overwatch",
                            kind="map",
                            slug="ctx-c",
                            name="Twin Three",
                            parent_id=escort.id,
                            aliases=["Близнец"],
                        ),
                    ]
                )
                await session.flush()

                ctx = await load_decode_context(
                    session,
                    discipline="overwatch",
                    source=MatchSource(kind="upload"),
                    hint=None,
                    received_at=datetime(2026, 10, 18, tzinfo=UTC),
                )

                assert ctx.characters["Ctx Ana"] == "ctx-ana"
                assert ctx.characters["Rival"] == "ctx-rival"
                assert ctx.characters["Ана ctx"] == "ctx-ana"
                assert "Retired" not in ctx.characters and "ctx-old" not in ctx.attrs
                assert ctx.attrs["ctx-ana"] == {"class": "support"}
                # Catalog id order is what the formulas sum in.
                order = list(ctx.attrs)
                assert order.index("ctx-rival") < order.index("ctx-ana")
                assert ctx.maps[("CtxControl", "Twin")] == "ctx-a"
                assert ctx.maps[("КонтрольCtx", "Близнец")] == "ctx-a"
                # Two escort maps share that alias: refused for the pair, never resolved to the lower id.
                assert ("CtxEscort", "Близнец") in ctx.ambiguous_maps and ("CtxEscort", "Близнец") not in ctx.maps
                assert ctx.maps[("CtxEscort", "Twin Two")] == "ctx-b"
                assert ("CtxControl", "Близнец") not in ctx.ambiguous_maps
                # Push/Clash modes (by name or alias) are the ones whose log carries no result.
                push = existing_push or push
                assert {push.name, *push.aliases} <= ctx.objectiveless_modes
                assert "CtxControl" not in ctx.objectiveless_modes and "CtxEscort" not in ctx.objectiveless_modes
                await session.rollback()
        finally:
            await engine.dispose()

    asyncio.run(run())
