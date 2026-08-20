from __future__ import annotations

import json
import typing
from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from sqlalchemy.orm.strategy_options import _AbstractLoad

from shared import models
from shared.core import enums
from shared.core.pagination import PaginationSortParams, PaginationSortSearchParams
from shared.repository.base import BaseRepository
from shared.services.tournament_visibility import visible_tournament_ids_subquery


def _jsonb_array(value: str) -> sa.Cast[typing.Any]:
    """`'["value"]'::jsonb` as an explicit cast of a string literal.

    JSONB has no literal renderer, so binding a Python list directly makes the
    statement impossible to compile with `literal_binds` — i.e. impossible to
    assert on without a live connection. Casting a serialised string keeps the
    emitted SQL identical and the query inspectable.
    """
    return sa.cast(sa.literal(json.dumps([value])), JSONB)


class HeroRepository(BaseRepository[models.Hero]):
    def __init__(self) -> None:
        super().__init__(models.Hero)

    async def get_by_name(self, session: AsyncSession, name: str) -> models.Hero | None:
        return await self.get_by(session, name=name)

    async def list_lookup(self, session: AsyncSession) -> Sequence[sa.Row[tuple[int, str]]]:
        """``(id, name)`` name-ordered, for admin/filter pickers.

        A two-column projection rather than `get_all`: the pickers render a
        label, and hydrating ~40 full hero rows (aliases JSONB included) to read
        two columns is waste.
        """
        result = await session.execute(sa.select(models.Hero.id, models.Hero.name).order_by(models.Hero.name))
        return result.all()

    async def list_by_role(
        self,
        session: AsyncSession,
        role: str | None = None,
    ) -> Sequence[models.Hero]:
        query = sa.select(models.Hero)
        if role is not None:
            query = query.where(models.Hero.type == role)
        result = await session.execute(query.order_by(models.Hero.name.asc()))
        return result.scalars().all()

    async def all(
        self,
        session: AsyncSession,
        params: PaginationSortSearchParams,
    ) -> tuple[Sequence[models.Hero], int]:
        """Paginated heroes — applies sort + search via `params`."""
        return await self.get_all(session, params)

    async def playtime(
        self,
        session: AsyncSession,
        *,
        user_id: int | typing.Literal["all"] | None = "all",
        tournament_id: int | None = None,
        workspace_id: int | None = None,
    ) -> Sequence[tuple[models.Hero, float]]:
        """Aggregated per-hero playtime share.

        Returns rows of `(Hero, playtime_share)` where the share is normalized
        across all returned heroes. Filters:

        - ``user_id``: a specific user id, or ``"all"`` / ``None`` for everyone.
        - ``tournament_id``: restrict to one tournament.
        - ``workspace_id``: restrict to one workspace.

        The caller is responsible for any sorting/pagination on the result —
        the dataset is intrinsically small (at most one row per hero).
        """
        narrow_to_user = user_id is not None and user_id != "all"

        playtime_filters = [
            models.MatchStatistics.name == enums.LogStatsName.HeroTimePlayed,
            models.MatchStatistics.value > 60,
            models.MatchStatistics.round == 0,
            models.MatchStatistics.hero_id.isnot(None),
        ]
        if narrow_to_user:
            playtime_filters.append(models.MatchStatistics.user_id == user_id)
        if tournament_id is None:
            # Cross-tournament aggregate: exclude hidden tournaments' stats (issue
            # #115). A specific tournament_id is authorized by the caller's gate.
            playtime_filters.append(
                models.MatchStatistics.match_id.in_(
                    sa.select(models.Match.id)
                    .join(models.Encounter, models.Encounter.id == models.Match.encounter_id)
                    .where(models.Encounter.tournament_id.in_(visible_tournament_ids_subquery(None)))
                )
            )

        playtime_cte = (
            sa.select(
                models.MatchStatistics.hero_id,
                sa.func.sum(models.MatchStatistics.value).label("playtime"),
            )
            .where(sa.and_(*playtime_filters))
            .group_by(models.MatchStatistics.hero_id)
        )

        if tournament_id is not None:
            playtime_cte = (
                playtime_cte.join(models.Match, models.Match.id == models.MatchStatistics.match_id)
                .join(models.Encounter, models.Encounter.id == models.Match.encounter_id)
                .where(models.Encounter.tournament_id == tournament_id)
            )

        if workspace_id is not None:
            if tournament_id is None:
                playtime_cte = playtime_cte.join(models.Match, models.Match.id == models.MatchStatistics.match_id).join(
                    models.Encounter, models.Encounter.id == models.Match.encounter_id
                )
            playtime_cte = playtime_cte.join(
                models.Tournament, models.Tournament.id == models.Encounter.tournament_id
            ).where(models.Tournament.workspace_id == workspace_id)

        playtime_cte = playtime_cte.cte("playtime_cte")

        overall_playtime = (
            sa.select(sa.func.sum(playtime_cte.c.playtime).label("total_playtime")).select_from(playtime_cte)
        ).scalar_subquery()

        query = (
            sa.select(
                models.Hero,
                (sa.func.sum(playtime_cte.c.playtime) / overall_playtime).label("playtime"),
            )
            .select_from(models.Hero)
            .join(playtime_cte, models.Hero.id == playtime_cte.c.hero_id)
            .group_by(models.Hero.id)
        )

        result = await session.execute(query)
        return result.all()  # type: ignore[return-value]


class GamemodeRepository(BaseRepository[models.Gamemode]):
    def __init__(self) -> None:
        super().__init__(models.Gamemode)

    async def get_by_name(self, session: AsyncSession, name: str) -> models.Gamemode | None:
        return await self.get_by(session, name=name)

    async def list_lookup(self, session: AsyncSession) -> Sequence[sa.Row[tuple[int, str]]]:
        """``(id, name)`` name-ordered — see `HeroRepository.list_lookup`."""
        result = await session.execute(sa.select(models.Gamemode.id, models.Gamemode.name).order_by(models.Gamemode.name))
        return result.all()

    @staticmethod
    def load_options(entities: Sequence[str]) -> list[_AbstractLoad]:
        """Loader options for the relations an ``entities`` token list asks for.

        ``maps`` is the only expandable relation on a gamemode. Which relation a
        token loads is a property of the table, not of the request, so it lives
        here rather than in a per-caller ``if "maps" in entities`` branch — and
        unknown tokens are ignored, so a caller may pass its whole list through.
        """
        return [selectinload(models.Gamemode.maps)] if "maps" in entities else []

    async def get_expanded(
        self, session: AsyncSession, gamemode_id: int, entities: Sequence[str] = ()
    ) -> models.Gamemode | None:
        return await self.get(session, gamemode_id, options=self.load_options(entities))

    async def all(
        self,
        session: AsyncSession,
        params: PaginationSortSearchParams,
        *,
        entities: Sequence[str] = (),
    ) -> tuple[Sequence[models.Gamemode], int]:
        return await self.get_all(session, params, options=self.load_options(entities))


class MapRepository(BaseRepository[models.Map]):
    def __init__(self) -> None:
        super().__init__(models.Map)

    @staticmethod
    def load_options(entities: Sequence[str]) -> list[_AbstractLoad]:
        """``gamemode`` is the only expandable relation on a map — see
        `GamemodeRepository.load_options`."""
        return [selectinload(models.Map.gamemode)] if "gamemode" in entities else []

    async def get_expanded(
        self, session: AsyncSession, map_id: int, entities: Sequence[str] = ()
    ) -> models.Map | None:
        return await self.get(session, map_id, options=self.load_options(entities))

    async def list_lookup(self, session: AsyncSession) -> Sequence[sa.Row[tuple[int, str]]]:
        """``(id, name)`` name-ordered — see `HeroRepository.list_lookup`."""
        result = await session.execute(sa.select(models.Map.id, models.Map.name).order_by(models.Map.name))
        return result.all()

    async def get_by_name(
        self,
        session: AsyncSession,
        name: str,
        *,
        entities: Sequence[str] = (),
    ) -> models.Map | None:
        return await self.get_by(session, options=self.load_options(entities), name=name)

    @staticmethod
    def build_name_or_alias_query(*, name: str, gamemode: str) -> sa.Select:
        """Map by name-or-alias inside a gamemode by name-or-alias.

        Replaces the three hardcoded translation dicts the parser used to carry:
        `aliases` is filled by the OverFast sync (heroes) and by the admin UI
        (maps, gamemodes). Kept synchronous and separate from the executing
        wrapper so the predicates can be asserted without a database.

        `JSONB.contains(...)` compiles to `aliases @> CAST('["…"]' AS JSONB)`.
        """
        # ponytail: no GIN index on aliases — ~45 maps and ~10 gamemodes, one
        # query per log. Add `USING gin (aliases jsonb_path_ops)` when maps
        # reach the hundreds.
        return (
            sa.select(models.Map)
            .join(models.Gamemode)
            .where(
                sa.or_(models.Map.name == name, models.Map.aliases.contains(_jsonb_array(name))),
                sa.or_(
                    models.Gamemode.name == gamemode,
                    models.Gamemode.aliases.contains(_jsonb_array(gamemode)),
                ),
            )
        )

    async def get_by_name_or_alias_and_gamemode(
        self,
        session: AsyncSession,
        *,
        name: str,
        gamemode: str,
        with_gamemode: bool = False,
    ) -> models.Map | None:
        query = self.build_name_or_alias_query(name=name, gamemode=gamemode)
        if with_gamemode:
            query = query.options(selectinload(models.Map.gamemode))
        result = await session.execute(query)
        return result.scalar_one_or_none()

    async def all(
        self,
        session: AsyncSession,
        params: PaginationSortParams | PaginationSortSearchParams,
        *,
        entities: Sequence[str] = (),
    ) -> tuple[Sequence[models.Map], int]:
        return await self.get_all(session, params, options=self.load_options(entities))


class CatalogAliasMissRepository(BaseRepository[models.CatalogAliasMiss]):
    """``overwatch.catalog_alias_miss`` — the unresolved-name worklist.

    Rows are never deleted; ``resolved_at`` is stamped on attach/dismiss and
    cleared again when the same name reappears (see the model docstring).
    """

    def __init__(self) -> None:
        super().__init__(models.CatalogAliasMiss)

    async def resolve_by_raw_name(
        self,
        session: AsyncSession,
        *,
        entity_type: enums.CatalogEntityType,
        raw_name: str,
    ) -> None:
        """Close the miss for one ``(entity_type, raw_name)`` pair.

        Set-based rather than load-then-mutate: the pair is unique
        (``uq_catalog_alias_miss_entity_raw``) but may legitimately be absent —
        an alias can be attached before any log ever missed on it.
        """
        await session.execute(
            sa.update(models.CatalogAliasMiss)
            .where(
                models.CatalogAliasMiss.entity_type == entity_type,
                models.CatalogAliasMiss.raw_name == raw_name,
            )
            .values(resolved_at=sa.func.now())
        )
