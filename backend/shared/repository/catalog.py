from __future__ import annotations

import json
import typing
from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, aggregate_order_by
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased, selectinload
from sqlalchemy.orm.strategy_options import _AbstractLoad

from shared import models
from shared.core import enums
from shared.repository.base import BaseRepository
from shared.repository.stats_queries import player_facts
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
        if self.discipline is None:
            raise ValueError("Character playtime requires an explicit discipline")
        facts = player_facts(discipline=self.discipline)
        playtime_filters = [
            facts.c.stat_code == enums.LogStatsName.HeroTimePlayed.value,
            facts.c.value > 60,
            facts.c.segment == 0,
            facts.c.entity_id.isnot(None),
        ]
        if user_id is not None and user_id != "all":
            playtime_filters.append(facts.c.player_id == user_id)
        if tournament_id is None:
            playtime_filters.append(facts.c.tournament_id.in_(visible_tournament_ids_subquery(None)))
        else:
            playtime_filters.append(facts.c.tournament_id == tournament_id)
        if workspace_id is not None:
            playtime_filters.append(facts.c.workspace_id == workspace_id)
        playtime_cte = (
            sa.select(
                facts.c.entity_id,
                sa.func.sum(
                    aggregate_order_by(
                        facts.c.value,
                        facts.c.match_id,
                        facts.c.workspace_member_id,
                    )
                ).label("playtime"),
            )
            .where(*playtime_filters)
            .group_by(facts.c.entity_id)
            .cte("playtime_cte")
        )

        overall_playtime = (
            sa.select(
                sa.func.sum(
                    aggregate_order_by(
                        playtime_cte.c.playtime,
                        playtime_cte.c.entity_id,
                    )
                ).label("total_playtime")
            ).select_from(playtime_cte)
        ).scalar_subquery()

        query = (
            sa.select(
                models.CatalogEntity,
                (
                    sa.func.sum(
                        aggregate_order_by(
                            playtime_cte.c.playtime,
                            playtime_cte.c.entity_id,
                        )
                    )
                    / overall_playtime
                ).label("playtime"),
            )
            .select_from(models.CatalogEntity)
            .join(playtime_cte, models.CatalogEntity.id == playtime_cte.c.entity_id)
            .where(*self._scope(), models.CatalogEntity.kind == "character")
            .group_by(models.CatalogEntity.id)
        )

        result = await session.execute(query)
        return result.all()  # type: ignore[return-value]


def _require_miss_kind(kind: str) -> None:
    if kind not in models.ALIAS_MISS_KINDS:
        raise ValueError(f"alias_miss kind must be one of {models.ALIAS_MISS_KINDS}, got {kind!r}")


class CatalogAliasMissRepository(BaseRepository[models.CatalogAliasMiss]):
    """``catalog.alias_miss`` — the unresolved-name worklist.

    Rows are never deleted; ``resolved_at`` is stamped on attach/dismiss and cleared when the same name reappears.
    """

    def __init__(self) -> None:
        super().__init__(models.CatalogAliasMiss)

    async def clear_ingest_job_references(self, session: AsyncSession, ids: Sequence[int]) -> None:
        if ids:
            await session.execute(sa.update(self.model).where(self.model.id.in_(ids)).values(last_ingest_job_id=None))

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
        ids: typing.Mapping[str, int] | None = None,
    ):
        """The upsert statement, so SQL can be asserted without a database."""
        _require_miss_kind(kind)
        names = sorted({name.strip()[:name_max_length] for name in raw_names if name and name.strip()})
        statement = pg_insert(self.model).values(
            [
                {
                    **({"id": ids[name]} if ids is not None else {}),
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
        """Upsert bounded breadcrumb owners with their before/after evidence."""
        _require_miss_kind(kind)
        from shared.services.stats_evidence import capture_stats_evidence, owner_scopes, stage_stats_evidence

        names = sorted({name.strip()[:name_max_length] for name in raw_names if name and name.strip()})
        for offset in range(0, len(names), 100):
            batch = names[offset : offset + 100]
            ids = {}
            for name in batch:
                await session.execute(
                    sa.text("SELECT pg_advisory_xact_lock(hashtext(:key))"),
                    {
                        "key": f"catalog.alias_miss:{discipline}:{kind}:{name}",
                    },
                )
                row_id = await session.scalar(
                    sa.select(self.model.id)
                    .where(
                        self.model.discipline == discipline,
                        self.model.kind == kind,
                        self.model.raw_name == name,
                    )
                    .with_for_update()
                )
                ids[name] = (
                    row_id
                    if row_id is not None
                    else await session.scalar(
                        sa.text(
                            "SELECT nextval(pg_get_serial_sequence('catalog.alias_miss', 'id'))",
                        )
                    )
                )
            scopes = [scope for row_id in ids.values() for scope in owner_scopes("alias", (row_id,))]
            before = await capture_stats_evidence(session, scopes=scopes)
            await session.execute(
                self.build_miss_upsert(
                    discipline,
                    kind,
                    batch,
                    ingest_job_id=ingest_job_id,
                    name_max_length=name_max_length,
                    ids=ids,
                )
            )
            await session.flush()
            after = await capture_stats_evidence(session, scopes=scopes)
            if before != after:
                await stage_stats_evidence(
                    session,
                    operation="stats.reference_update",
                    before=before,
                    after=after,
                    workspace_id=None,
                    entity_type="catalog_alias_miss",
                    entity_id=next(iter(ids.values())),
                )
