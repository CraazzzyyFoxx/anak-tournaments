"""``stats.match_fetch`` reads and writes. Repositories flush; the stats service owns retries and commit boundaries."""

from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from shared.models import MatchFetch, MatchFetchStatus

__all__ = ("MatchFetchRepository",)


class MatchFetchRepository:
    async def get_for_update(self, session: AsyncSession, fetch_id: int) -> MatchFetch | None:
        return await session.get(MatchFetch, fetch_id, with_for_update=True, populate_existing=True)

    async def for_game(self, session: AsyncSession, encounter_game_id: int) -> Sequence[MatchFetch]:
        """A game's requests, newest first."""
        return (
            await session.scalars(
                sa.select(MatchFetch)
                .where(MatchFetch.hint_encounter_game_id == encounter_game_id)
                .order_by(MatchFetch.created_at.desc(), MatchFetch.id.desc())
            )
        ).all()

    async def active_elsewhere(
        self, session: AsyncSession, *, workspace_id: int, source_kind: str, external_id: str, encounter_game_id: int
    ) -> bool:
        """Whether another game of the workspace already holds this match (a failed request holds nothing)."""
        return bool(
            await session.scalar(
                sa.select(
                    sa.exists().where(
                        MatchFetch.workspace_id == workspace_id,
                        MatchFetch.source_kind == source_kind,
                        MatchFetch.external_id == external_id,
                        MatchFetch.hint_encounter_game_id != encounter_game_id,
                        MatchFetch.status != MatchFetchStatus.FAILED,
                    )
                )
            )
        )

    async def get_or_create(self, session: AsyncSession, **values: object) -> MatchFetch:
        """The row of ``(source_kind, external_id, hint_encounter_game_id)``, locked; inserted when absent."""
        await session.execute(
            pg_insert(MatchFetch).values(**values).on_conflict_do_nothing(constraint="uq_match_fetch_game")
        )
        return (
            await session.scalars(
                sa.select(MatchFetch)
                .where(
                    MatchFetch.source_kind == values["source_kind"],
                    MatchFetch.external_id == values["external_id"],
                    MatchFetch.hint_encounter_game_id == values["hint_encounter_game_id"],
                )
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        ).one()

    async def due_ids(
        self, session: AsyncSession, *, now: datetime, limit: int, disciplines: Sequence[str]
    ) -> list[int]:
        return list(
            await session.scalars(
                sa.select(MatchFetch.id)
                .where(
                    MatchFetch.status == MatchFetchStatus.PENDING,
                    MatchFetch.next_attempt_at <= now,
                    MatchFetch.discipline.in_(disciplines),
                )
                .order_by(MatchFetch.next_attempt_at)
                .limit(limit)
            )
        )
