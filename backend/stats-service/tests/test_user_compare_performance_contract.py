"""Comparison catalog isolation and empty-population behavior."""

import asyncio
import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from shared import models
from shared.core import errors
from shared.division_grid import DEFAULT_GRID
from src import schemas
from src.services.user.queries.compare import UserCompareQueries
from src.services.user.service import UserService

users = UserService.of("overwatch")
compare_queries = UserCompareQueries.of("overwatch")


@pytest.mark.parametrize(
    ("discipline", "kind", "valid_map"),
    [
        ("overwatch", "map", True),
        ("overwatch", "mode", False),
        ("overwatch", "character", False),
        ("lol", "map", False),
    ],
)
def test_character_compare_resolves_only_this_games_maps(
    db_session, discipline: str, kind: str, valid_map: bool
) -> None:
    async def run() -> None:
        tag = f"compare-map-{uuid.uuid4().hex}"
        try:
            parent_id = None
            if valid_map:
                mode = models.CatalogEntity(discipline="overwatch", kind="mode", slug=tag, name=tag)
                db_session.add(mode)
                await db_session.flush()
                parent_id = mode.id
            entity = models.CatalogEntity(discipline=discipline, kind=kind, slug=tag, name=tag, parent_id=parent_id)
            db_session.add(entity)
            await db_session.flush()
            params = schemas.UserCharacterCompareParams(baseline="global", map_id=entity.id)
            with (
                patch.object(users, "get", AsyncMock(return_value=SimpleNamespace(id=7, name="Subject"))),
                patch.object(compare_queries, "get_user_hero_compare_stats", AsyncMock(return_value=(1200.0, {}))),
                patch.object(
                    compare_queries, "get_users_hero_compare_stats", AsyncMock(return_value=({8: 1200.0}, {}))
                ),
            ):
                if valid_map:
                    response = await users.get_hero_compare(db_session, 7, params, grid=DEFAULT_GRID)
                    assert response.map.id == entity.id
                else:
                    with pytest.raises(errors.ApiHTTPException) as exc:
                        await users.get_hero_compare(db_session, 7, params, grid=DEFAULT_GRID)
                    assert exc.value.status_code == 404
                    assert exc.value.detail[0]["code"] == "not_found"
        finally:
            await db_session.rollback()

    asyncio.run(run())


def test_hero_compare_empty_sample_without_population_is_baseline_404() -> None:
    get_user = AsyncMock(return_value=SimpleNamespace(id=7, name="Subject"))
    get_left = AsyncMock(return_value=(0.0, {}))
    get_pop = AsyncMock(return_value=({}, {}))
    exists = AsyncMock(return_value=False)

    with (
        patch.object(users, "get", get_user),
        patch.object(compare_queries, "get_user_hero_compare_stats", get_left),
        patch.object(compare_queries, "get_users_hero_compare_stats", get_pop),
        patch.object(compare_queries, "compare_population_exists", exists),
        pytest.raises(errors.ApiHTTPException) as exc,
    ):
        asyncio.run(
            users.get_hero_compare(
                AsyncMock(),
                7,
                schemas.UserCharacterCompareParams(baseline="global"),
                grid=DEFAULT_GRID,
            )
        )

    assert exc.value.status_code == 404


def test_hero_compare_empty_sample_with_population_is_hero_map_404() -> None:
    get_user = AsyncMock(return_value=SimpleNamespace(id=7, name="Subject"))
    get_left = AsyncMock(return_value=(0.0, {}))
    get_pop = AsyncMock(return_value=({8: 0.0}, {}))
    exists = AsyncMock(return_value=True)

    with (
        patch.object(users, "get", get_user),
        patch.object(compare_queries, "get_user_hero_compare_stats", get_left),
        patch.object(compare_queries, "get_users_hero_compare_stats", get_pop),
        patch.object(compare_queries, "compare_population_exists", exists),
        pytest.raises(errors.ApiHTTPException) as exc,
    ):
        asyncio.run(
            users.get_hero_compare(
                AsyncMock(),
                7,
                schemas.UserCharacterCompareParams(baseline="global"),
                grid=DEFAULT_GRID,
            )
        )

    assert exc.value.status_code == 404
