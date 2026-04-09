from collections.abc import Sequence
from typing import Any, Generic, TypeVar

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.strategy_options import _AbstractLoad

from shared.core.db import Base
from shared.core.pagination import PaginationSortParams, PaginationSortSearchParams

ModelType = TypeVar("ModelType", bound=Base)


class BaseRepository(Generic[ModelType]):
    """Generic async repository for common CRUD operations.

    Stateless — instantiate at module level, pass session per-call.

    Usage::

        hero_repo = BaseRepository(Hero)
        hero = await hero_repo.get(session, id=1)
        heroes, total = await hero_repo.get_all(session, params)
    """

    def __init__(self, model: type[ModelType]) -> None:
        self.model = model

    # ── Read ──────────────────────────────────────────────────────────

    async def get(
        self,
        session: AsyncSession,
        id: int | str,
        *,
        options: list[_AbstractLoad] | None = None,
    ) -> ModelType | None:
        query = sa.select(self.model).where(self.model.id == id)
        if options:
            query = query.options(*options)
        result = await session.execute(query)
        return result.unique().scalars().first()

    async def get_by(
        self,
        session: AsyncSession,
        *,
        options: list[_AbstractLoad] | None = None,
        **filters: Any,
    ) -> ModelType | None:
        query = sa.select(self.model).filter_by(**filters)
        if options:
            query = query.options(*options)
        result = await session.execute(query)
        return result.unique().scalars().first()

    async def get_all(
        self,
        session: AsyncSession,
        params: PaginationSortParams | PaginationSortSearchParams,
        *,
        options: list[_AbstractLoad] | None = None,
        filters: list[sa.ColumnElement[bool]] | None = None,
    ) -> tuple[Sequence[ModelType], int]:
        query = sa.select(self.model)
        total_query = sa.select(sa.func.count(self.model.id))

        if options:
            query = query.options(*options)
        if filters:
            for f in filters:
                query = query.where(f)
                total_query = total_query.where(f)

        if isinstance(params, PaginationSortSearchParams):
            query = params.apply_search(query, self.model)
            total_query = params.apply_search(total_query, self.model)

        query = params.apply_pagination_sort(query, self.model)

        result = await session.execute(query)
        total_result = await session.execute(total_query)
        return result.unique().scalars().all(), total_result.scalar_one()

    async def get_bulk(
        self,
        session: AsyncSession,
        ids: list[int | str],
        *,
        options: list[_AbstractLoad] | None = None,
    ) -> Sequence[ModelType]:
        query = sa.select(self.model).where(self.model.id.in_(ids))
        if options:
            query = query.options(*options)
        result = await session.execute(query)
        return result.unique().scalars().all()

    async def count(
        self,
        session: AsyncSession,
        *,
        filters: list[sa.ColumnElement[bool]] | None = None,
    ) -> int:
        query = sa.select(sa.func.count(self.model.id))
        if filters:
            for f in filters:
                query = query.where(f)
        result = await session.execute(query)
        return result.scalar_one()

    # ── Write ─────────────────────────────────────────────────────────

    async def create(
        self,
        session: AsyncSession,
        instance: ModelType,
        *,
        commit: bool = True,
    ) -> ModelType:
        session.add(instance)
        if commit:
            await session.commit()
            await session.refresh(instance)
        return instance

    async def create_many(
        self,
        session: AsyncSession,
        instances: list[ModelType],
        *,
        commit: bool = True,
    ) -> list[ModelType]:
        session.add_all(instances)
        if commit:
            await session.commit()
        return instances

    async def update(
        self,
        session: AsyncSession,
        instance: ModelType,
        data: dict[str, Any],
        *,
        commit: bool = True,
    ) -> ModelType:
        for field, value in data.items():
            setattr(instance, field, value)
        if commit:
            await session.commit()
            await session.refresh(instance)
        return instance

    async def delete(
        self,
        session: AsyncSession,
        instance: ModelType,
        *,
        commit: bool = True,
    ) -> None:
        await session.delete(instance)
        if commit:
            await session.commit()
