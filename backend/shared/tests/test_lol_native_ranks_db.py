"""LoL's native rank against the test DB: the newest fresh Solo/Duo snapshot, the best account, never Flex."""

from __future__ import annotations

import asyncio
import itertools
import os
import sys
from datetime import UTC, datetime, timedelta
from unittest import IsolatedAsyncioTestCase

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import async_sessionmaker

from shared import models
from shared.disciplines.lol.ranks import native_ranks, positions
from shared.testing import create_test_async_engine
from shared.testing.db import ensure_test_postgres

_TAG = itertools.count()


def _snap(user_id: int, account: int, queue: str, division: str, tier: int | None, lp: int, value: int, at: datetime):
    return models.UserRankSnapshot(
        discipline="lol",
        user_id=user_id,
        social_account_id=account,
        handle="x#EUW",
        queue=queue,
        division=division,
        tier=tier,
        lp=lp,
        wins=10,
        losses=5,
        rank_value=value,
        is_ranked=True,
        captured_at=at,
        source="scheduled",
    )


class LolNativeRanksDbTests(IsolatedAsyncioTestCase):
    if sys.platform == "win32":
        loop_factory = asyncio.SelectorEventLoop

    async def asyncSetUp(self) -> None:
        ensure_test_postgres()
        self.engine = create_test_async_engine()
        self.Session = async_sessionmaker(self.engine, expire_on_commit=False)
        tag = f"lolnr-{os.getpid()}-{next(_TAG)}"
        now = datetime.now(UTC)
        async with self.Session() as s:
            user = models.User(name=tag)
            s.add(user)
            await s.flush()
            main = models.SocialAccount(
                user_id=user.id, provider="riot", username=f"{tag}#EUW", username_normalized=f"{tag}#euw"
            )
            stale = models.SocialAccount(
                user_id=user.id, provider="riot", username=f"{tag}x#EUW", username_normalized=f"{tag}x#euw"
            )
            s.add_all([main, stale])
            await s.flush()
            s.add_all(
                [
                    models.RankAccountState(
                        discipline="lol", social_account_id=main.id, handle=main.username, last_success_at=now
                    ),
                    models.RankAccountState(
                        discipline="lol",
                        social_account_id=stale.id,
                        handle=stale.username,
                        last_success_at=now - timedelta(days=31),
                    ),
                    _snap(user.id, main.id, "solo", "GOLD", 2, 50, 1450, now - timedelta(days=2)),
                    _snap(user.id, main.id, "solo", "PLATINUM", 4, 10, 1610, now - timedelta(days=1)),
                    _snap(user.id, main.id, "flex", "DIAMOND", 1, 0, 2700, now),
                    _snap(user.id, stale.id, "solo", "MASTER", None, 400, 3200, now),
                ]
            )
            await s.commit()
            self.user_id, self.main_id = user.id, main.id

    async def asyncTearDown(self) -> None:
        async with self.Session() as s:
            await s.execute(sa.delete(models.User).where(models.User.id == self.user_id))
            await s.commit()
        await self.engine.dispose()

    async def test_the_newest_fresh_solo_rank_is_the_native_rank_on_every_position(self) -> None:
        async with self.Session() as s:
            # The stale account (last poll 31 days ago) and the Flex queue never count.
            self.assertEqual(await native_ranks(s, [self.user_id]), {self.user_id: dict.fromkeys(positions(), 1610)})

    async def test_a_player_with_only_flex_has_no_native_rank(self) -> None:
        async with self.Session() as s:
            await s.execute(
                sa.delete(models.UserRankSnapshot).where(
                    models.UserRankSnapshot.social_account_id == self.main_id, models.UserRankSnapshot.queue == "solo"
                )
            )
            await s.commit()
            self.assertEqual(await native_ranks(s, [self.user_id]), {})
