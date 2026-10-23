"""The public browse's status filter, play date and order (``services/encounter/service.py``).

Against the real Postgres: the live reading is SQL for the filter and Python for the row, and the two must agree;
the play date and its order are correlated subqueries over the tournament's dates and the parsed maps.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from unittest import TestCase

import sqlalchemy as sa
from pydantic import ValidationError

from shared.core import enums
from shared.core.errors import BaseAPIException
from shared.models.encounter import Encounter
from shared.models.tournament.tournament import Tournament
from src import schemas
from src.services.encounter.service import encounter_is_live, encounter_service
from tests._encounter_layer import EncounterLayerCase

_START = datetime(2024, 5, 4, 12, tzinfo=UTC)
_END = datetime(2024, 5, 5, 20, tzinfo=UTC)


class BrowseReadTests(EncounterLayerCase):
    async def asyncSetUp(self) -> None:
        await super().asyncSetUp()
        async with self.Session() as s:
            await s.execute(
                sa.update(Tournament)
                .where(Tournament.id == self.tournament_id)
                .values(start_date=_START, end_date=_END)
            )
            await s.commit()

    async def ids(self, **params) -> list[int]:
        async with self.Session() as s:
            rows, _ = await encounter_service.get_all_encounters(
                s, schemas.EncounterSearchParams(per_page=50, tournament_id=self.tournament_id, **params)
            )
        return [row.id for row in rows]

    async def set(self, encounter_id: int, **values) -> None:
        async with self.Session() as s:
            await s.execute(sa.update(Encounter).where(Encounter.id == encounter_id).values(**values))
            await s.commit()

    async def test_live_and_upcoming_split_the_unfinished_series_the_way_the_row_reads_it(self) -> None:
        now = datetime.now(UTC)
        decided = await self.encounter(0, 1, scores=[2, 1])
        waiting = await self.encounter(2, 3)
        playing = await self.encounter(0, 2, status=enums.EncounterStatus.PENDING, current_game_position=1)
        due = await self.encounter(1, 3, status=enums.EncounterStatus.PENDING, scheduled_at=now + timedelta(days=1))
        started = await self.encounter(1, 2, started_at=now - timedelta(minutes=5))
        # A decided series is never live, whatever its hand-set clock says.
        await self.set(decided, started_at=now - timedelta(hours=1))

        self.assertEqual({playing, started}, set(await self.ids(status="live")))
        self.assertEqual({waiting, due}, set(await self.ids(status="upcoming")))
        self.assertEqual([decided], await self.ids(status="completed"))
        async with self.Session() as s:
            rows = (
                (await s.execute(sa.select(Encounter).where(Encounter.tournament_id == self.tournament_id)))
                .scalars()
                .all()
            )
        self.assertEqual({playing, started}, {row.id for row in rows if encounter_is_live(row, datetime.now(UTC))})

    async def test_an_unknown_status_is_refused_with_every_accepted_one(self) -> None:
        with self.assertRaises(BaseAPIException) as caught:
            await self.ids(status="finished")
        self.assertEqual(400, caught.exception.status_code)
        self.assertIn("upcoming", str(caught.exception.detail))

    async def test_a_clock_is_a_play_date_only_inside_the_tournament_dates(self) -> None:
        on_time = await self.encounter(0, 1, scores=[2, 0])
        imported = await self.encounter(2, 3, scores=[2, 1])
        unfinished = await self.encounter(0, 2)
        played = _START + timedelta(hours=3)
        await self.set(on_time, confirmed_at=played)
        # History imported later carries the import's time, not the match's.
        await self.set(imported, confirmed_at=_END + timedelta(days=200))

        async with self.Session() as s:
            got = await encounter_service.played_at_by_encounter(s, [on_time, imported, unfinished])

        self.assertEqual({on_time: played, imported: None, unfinished: None}, got)

    async def test_the_date_order_is_play_then_due_then_the_tournament_dates(self) -> None:
        early = await self.encounter(0, 1, scores=[2, 0])
        late = await self.encounter(2, 3, scores=[2, 1])
        imported = await self.encounter(0, 2, scores=[1, 2])
        upcoming = await self.encounter(1, 3, scheduled_at=_END + timedelta(days=30))
        await self.set(early, confirmed_at=_START + timedelta(hours=1))
        await self.set(late, confirmed_at=_START + timedelta(hours=5))
        await self.set(imported, confirmed_at=_END + timedelta(days=400))

        self.assertEqual([upcoming, imported, late, early], await self.ids(sort="played_at", order="desc"))
        self.assertEqual([early, late, imported, upcoming], await self.ids(sort="played_at", order="asc"))

    async def test_a_sort_with_nulls_puts_them_last_both_ways(self) -> None:
        close = await self.encounter(0, 1, scores=[2, 1])
        unrated = await self.encounter(2, 3)
        await self.set(close, closeness=0.7)

        self.assertEqual([close, unrated], await self.ids(sort="closeness", order="desc"))
        self.assertEqual([close, unrated], await self.ids(sort="closeness", order="asc"))


class SortKeyTests(TestCase):
    def test_the_browse_sorts_only_by_its_own_keys(self) -> None:
        for sort in ("played_at", "closeness", "scheduled_at", "id"):
            self.assertEqual(sort, schemas.EncounterSearchQueryParams(sort=sort).sort)
        for sort in ("tournament.name", "similarity:name", "created_at"):
            with self.assertRaises(ValidationError, msg=sort):
                schemas.EncounterSearchQueryParams(sort=sort)
