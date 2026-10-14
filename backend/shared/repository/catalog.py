from __future__ import annotations

import json
import typing
from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased, selectinload
from sqlalchemy.orm.strategy_options import _AbstractLoad

from shared import models
from shared.core import enums
from shared.repository.base import BaseRepository
from shared.services.tournament.visibility import visible_tournament_ids_subquery


def _jsonb_array(value: str) -> sa.Cast[typing.Any]:
    """`'["value"]'::jsonb` as an explicit cast of a string literal.

    JSONB has no literal renderer, so binding a Python list directly makes the
    statement impossible to compile with `literal_binds` — i.e. impossible to
    assert on without a live connection. Casting a serialised string keeps the
    emitted SQL identical and the query inspectable.
    """
    return sa.cast(sa.literal(json.dumps([value])), JSONB)


class CatalogEntityRepository(BaseRepository[models.CatalogEntity]):
    """``catalog.entity``, optionally narrowed to one kind and/or one discipline.

    Reads through ``select()``/``count_select()`` are scoped, so a repository built as
    ``CatalogEntityRepository("map", discipline="overwatch")`` never returns a hero or a champion.
    """

    def __init__(self, kind: str | None = None, *, discipline: str | None = None) -> None:
        super().__init__(models.CatalogEntity)
        self.kind = kind
        self.discipline = discipline

    def _scope(self) -> list[sa.ColumnElement[bool]]:
        clauses: list[sa.ColumnElement[bool]] = []
        if self.kind is not None:
            clauses.append(models.CatalogEntity.kind == self.kind)
        if self.discipline is not None:
            clauses.append(models.CatalogEntity.discipline == self.discipline)
        return clauses

    def select(self) -> sa.Select[tuple[models.CatalogEntity]]:
        return super().select().where(*self._scope())

    def count_select(self) -> sa.Select[tuple[int]]:
        return super().count_select().where(*self._scope())

    async def count(self, session: AsyncSession, *, filters: Sequence[sa.ColumnElement[bool]] | None = None) -> int:
        return await super().count(session, filters=[*self._scope(), *(filters or ())])

    async def exists(
        self,
        session: AsyncSession,
        *,
        filters: Sequence[sa.ColumnElement[bool]] | None = None,
        **filter_by: typing.Any,
    ) -> bool:
        return await super().exists(session, filters=[*self._scope(), *(filters or ())], **filter_by)

    @staticmethod
    def load_options(entities: Sequence[str]) -> list[_AbstractLoad]:
        """A map's mode is its only expandable relation; ``gamemode`` stays the wire token for it."""
        return [selectinload(models.CatalogEntity.parent)] if "gamemode" in entities else []

    async def list_lookup(self, session: AsyncSession) -> Sequence[sa.Row[tuple[int, str]]]:
        """``(id, name)`` name-ordered, for admin/filter pickers."""
        entity = models.CatalogEntity
        result = await session.execute(sa.select(entity.id, entity.name).where(*self._scope()).order_by(entity.name))
        return result.all()

    async def get_by_legacy_id(
        self, session: AsyncSession, legacy_kind: str, legacy_id: int
    ) -> models.CatalogEntity | None:
        """The entity an ``overwatch.*`` id became (``catalog.entity_legacy``; both go in ``discipline02``)."""
        legacy = models.CatalogEntityLegacy
        query = (
            self.select()
            .join(legacy, legacy.entity_id == models.CatalogEntity.id)
            .where(legacy.legacy_kind == legacy_kind, legacy.legacy_id == legacy_id)
        )
        return (await session.execute(query)).scalars().first()

    @staticmethod
    def build_map_name_or_alias_query(
        *, discipline: str, name: str, mode_name: str
    ) -> sa.Select[tuple[models.CatalogEntity]]:
        """A map by name-or-alias inside a mode by name-or-alias, as a match log names both. Synchronous so the
        predicates can be asserted without a database; ``aliases @> '["…"]'`` on each side.

        ponytail: no GIN index on aliases — ~45 maps and ~10 modes, one query per log. Add
        ``USING gin (aliases jsonb_path_ops)`` when maps reach the hundreds.
        """
        game_map = models.CatalogEntity
        mode = aliased(models.CatalogEntity, name="mode")
        return (
            sa.select(game_map)
            .join(mode, mode.id == game_map.parent_id)
            .where(
                game_map.discipline == discipline,
                game_map.kind == "map",
                mode.kind == "mode",
                sa.or_(game_map.name == name, game_map.aliases.contains(_jsonb_array(name))),
                sa.or_(mode.name == mode_name, mode.aliases.contains(_jsonb_array(mode_name))),
            )
        )

    async def get_map_by_name_or_alias(
        self, session: AsyncSession, *, discipline: str, name: str, mode_name: str
    ) -> models.CatalogEntity | None:
        query = self.build_map_name_or_alias_query(discipline=discipline, name=name, mode_name=mode_name)
        return (await session.execute(query)).scalar_one_or_none()

    async def playtime(
        self,
        session: AsyncSession,
        *,
        user_id: int | typing.Literal["all"] | None = "all",
        tournament_id: int | None = None,
        workspace_id: int | None = None,
    ) -> Sequence[tuple[models.CatalogEntity, float]]:
        """Aggregated per-hero playtime share.

        Returns rows of `(CatalogEntity, playtime_share)` where the share is normalized
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
                models.CatalogEntity,
                (sa.func.sum(playtime_cte.c.playtime) / overall_playtime).label("playtime"),
            )
            .select_from(models.CatalogEntity)
            .join(playtime_cte, models.CatalogEntity.id == playtime_cte.c.hero_id)
            .where(*self._scope())
            .group_by(models.CatalogEntity.id)
        )

        result = await session.execute(query)
        return result.all()  # type: ignore[return-value]


class CatalogAliasMissRepository(BaseRepository[models.CatalogAliasMiss]):
    """``catalog.alias_miss`` — the unresolved-name worklist.

    Rows are never deleted; ``resolved_at`` is stamped on attach/dismiss and cleared when the same name reappears.
    """

    def __init__(self) -> None:
        super().__init__(models.CatalogAliasMiss)

    async def resolve_by_raw_name(self, session: AsyncSession, *, discipline: str, kind: str, raw_name: str) -> None:
        """Close a miss, which may legitimately be absent (an alias attached before any log missed on it)."""
        miss = models.CatalogAliasMiss
        await session.execute(
            sa.update(miss)
            .where(miss.discipline == discipline, miss.kind == kind, miss.raw_name == raw_name)
            .values(resolved_at=sa.func.now())
        )

    def build_miss_upsert(
        self,
        discipline: str,
        kind: str,
        raw_names: typing.Iterable[str],
        *,
        ingest_job_id: int | None = None,
        name_max_length: int = 128,
    ):
        """The upsert statement, so SQL can be asserted without a database."""
        names = sorted({name.strip() for name in raw_names if name and name.strip()})
        statement = pg_insert(self.model).values(
            [
                {
                    "discipline": discipline,
                    "kind": kind,
                    "raw_name": name[:name_max_length],
                    "last_ingest_job_id": ingest_job_id,
                }
                for name in names
            ]
        )
        return statement.on_conflict_do_update(
            constraint="uq_alias_miss",
            set_={
                "occurrences": self.model.occurrences + 1,
                "last_seen_at": sa.func.now(),
                "last_ingest_job_id": statement.excluded.last_ingest_job_id,
                "resolved_at": None,
            },
        )

    async def record_miss(
        self,
        session: AsyncSession,
        discipline: str,
        kind: str,
        raw_names: typing.Iterable[str],
        *,
        ingest_job_id: int | None = None,
        name_max_length: int = 128,
    ) -> None:
        """Upsert one occurrence-tracked row per cleaned name; reappearing names reopen dismissed misses."""
        names = sorted({name.strip() for name in raw_names if name and name.strip()})
        if not names:
            return
        await session.execute(
            self.build_miss_upsert(
                discipline, kind, names, ingest_job_id=ingest_job_id, name_max_length=name_max_length
            )
        )
