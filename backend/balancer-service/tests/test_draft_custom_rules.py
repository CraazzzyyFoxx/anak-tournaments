from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path
from unittest import IsolatedAsyncioTestCase

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

REPO_BACKEND_ROOT = Path(__file__).resolve().parents[2]
BALANCER_SERVICE_ROOT = REPO_BACKEND_ROOT / "balancer-service"
for candidate in (str(REPO_BACKEND_ROOT), str(BALANCER_SERVICE_ROOT)):
    if candidate not in sys.path:
        sys.path.insert(0, candidate)

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from shared.core.enums import DraftFormat, DraftPickStatus, DraftPlayerStatus, DraftStatus, HeroClass
from shared.core.errors import ApiHTTPException
from shared.domain.roster_shape import parse_roster_slots
from shared.models.balancer.draft import DraftPick
from shared.models.identity.user import User
from shared.models.tenancy.workspace import Workspace
from shared.models.tournament import Tournament
from src import models
from src.services.draft import lifecycle, selection

# The 5-slot roster these tests draft for, replacing `rounds=4, team_size=5`:
# `role_targets_for_team_size(5)` resolved to 1 tank / 2 dps / 2 support, and
# `draft_rounds` derives the same 4 rounds.
_SHAPE = parse_roster_slots({"tank": 1, "dps": 2, "support": 2})


def _async_url() -> str:
    u = os.environ.get("POSTGRES_USER", "postgres")
    p = os.environ.get("POSTGRES_PASSWORD", "postgres")
    h = os.environ.get("POSTGRES_HOST", "localhost")
    port = os.environ.get("POSTGRES_PORT", "5432")
    db = os.environ.get("POSTGRES_DB", "postgres")
    return f"postgresql+psycopg://{u}:{p}@{h}:{port}/{db}"


_UNIQUE = 0


def _uniq() -> int:
    global _UNIQUE
    _UNIQUE += 1
    return _UNIQUE


class DraftCustomRulesTests(IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.engine = create_async_engine(_async_url(), connect_args={"connect_timeout": 30})
        try:
            async with self.engine.connect() as c:
                db = (await c.execute(sa.text("select current_database()"))).scalar()
                if db == "anak_v5":
                    self.skipTest("refusing to run integration tests against production")
        except Exception as exc:
            await self.engine.dispose()
            self.skipTest(f"database unreachable: {exc}")

        self.Session = async_sessionmaker(self.engine, expire_on_commit=False)
        self._suffix = f"draft-custom-{os.getpid()}-{_uniq()}"
        async with self.Session() as s:
            ws = Workspace(slug=f"ws-{self._suffix}", name=f"WS {self._suffix}")
            s.add(ws)
            await s.flush()
            tourn = Tournament(workspace_id=ws.id, name=f"T {self._suffix}", status="draft")
            s.add(tourn)
            await s.flush()
            users = []
            # We need 3 captains with different ranks
            ranks = [2000, 3000, 2500]  # Cap0 (2000), Cap1 (3000), Cap2 (2500)
            for i, _r in enumerate(ranks):
                u = User(name=f"cap-{self._suffix}-{i}")
                s.add(u)
                users.append(u)
            await s.flush()
            self.workspace_id = ws.id
            self.tournament_id = tourn.id
            self.captain_user_ids = [u.id for u in users]
            self.captain_ranks = ranks
            await s.commit()

    async def asyncTearDown(self) -> None:
        if not hasattr(self, "Session"):
            await self.engine.dispose()
            return
        async with self.Session() as s:
            from shared.models.balancer.draft import DraftSession

            ids = (
                await s.scalars(sa.select(DraftSession.id).where(DraftSession.tournament_id == self.tournament_id))
            ).all()
            for sid in ids:
                await s.execute(sa.delete(DraftSession).where(DraftSession.id == sid))
            await s.execute(sa.delete(models.Player).where(models.Player.tournament_id == self.tournament_id))
            await s.execute(sa.delete(models.Team).where(models.Team.tournament_id == self.tournament_id))
            await s.execute(sa.delete(Tournament).where(Tournament.id == self.tournament_id))
            await s.execute(sa.delete(User).where(User.id.in_(self.captain_user_ids)))
            await s.execute(sa.delete(Workspace).where(Workspace.id == self.workspace_id))
            await s.commit()
        await self.engine.dispose()

    def _captains(self) -> list[lifecycle.CaptainSeed]:
        roles = [HeroClass.tank, HeroClass.damage, HeroClass.support]
        return [
            lifecycle.CaptainSeed(
                name=f"Cap{i}",
                draft_position=i + 1,
                user_id=uid,
                rank_value=self.captain_ranks[i],
                primary_role=roles[i % 3],
            )
            for i, uid in enumerate(self.captain_user_ids)
        ]

    def _players(self) -> list[lifecycle.PlayerSeed]:
        roles = [HeroClass.tank, HeroClass.damage, HeroClass.support]
        return [
            lifecycle.PlayerSeed(primary_role=roles[i % 3], rank_value=2800 + i * 10, battle_tag=f"P{i}#1")
            for i in range(15)
        ]

    async def test_custom_format_static_rules(self) -> None:
        async with self.Session() as s:
            rules = ["linear", "reverse", "weakest_first", "strongest_first"]
            draft = await lifecycle.create_session(
                s,
                tournament_id=self.tournament_id,
                workspace_id=self.workspace_id,
                shape=_SHAPE,
                fmt=DraftFormat.CUSTOM,
                settings={"round_rules": rules},
            )
            await lifecycle.seed(s, draft, captains=self._captains(), players=self._players())
            await s.commit()

            picks = (
                await s.scalars(
                    sa.select(DraftPick).where(DraftPick.session_id == draft.id).order_by(DraftPick.overall_no.asc())
                )
            ).all()

            teams = (
                await s.scalars(sa.select(lifecycle.DraftTeam).where(lifecycle.DraftTeam.session_id == draft.id))
            ).all()
            team_by_pos = {t.draft_position: t.id for t in teams}

            # Overall picks: 3 teams x 4 rounds = 12 picks
            self.assertEqual(len(picks), 12)

            # Round 1 (picks 1..3): linear [Cap0, Cap1, Cap2] -> positions [1, 2, 3]
            self.assertEqual(picks[0].draft_team_id, team_by_pos[1])
            self.assertEqual(picks[1].draft_team_id, team_by_pos[2])
            self.assertEqual(picks[2].draft_team_id, team_by_pos[3])

            # Round 2 (picks 4..6): reverse [Cap2, Cap1, Cap0] -> positions [3, 2, 1]
            self.assertEqual(picks[3].draft_team_id, team_by_pos[3])
            self.assertEqual(picks[4].draft_team_id, team_by_pos[2])
            self.assertEqual(picks[5].draft_team_id, team_by_pos[1])

            # Round 3 (picks 7..9): weakest_first.
            # Captain ranks: Cap0(2000), Cap1(3000), Cap2(2500). Weakest first: Cap0 (pos 1), Cap2 (pos 3), Cap1 (pos 2).
            self.assertEqual(picks[6].draft_team_id, team_by_pos[1])
            self.assertEqual(picks[7].draft_team_id, team_by_pos[3])
            self.assertEqual(picks[8].draft_team_id, team_by_pos[2])

            # Round 4 (picks 10..12): strongest_first.
            # Ranks: Cap0(2000), Cap1(3000), Cap2(2500). Strongest first: Cap1 (pos 2), Cap2 (pos 3), Cap0 (pos 1).
            self.assertEqual(picks[9].draft_team_id, team_by_pos[2])
            self.assertEqual(picks[10].draft_team_id, team_by_pos[3])
            self.assertEqual(picks[11].draft_team_id, team_by_pos[1])

    async def test_changing_a_rule_after_seeding_reorders_the_untouched_rounds(self) -> None:
        """The bug: round_rules lived on the session, the seat order on the picks.

        Changing a rule wrote settings_json and nothing else, so the wizard
        previewed the new order while the board kept drafting the seeded one.
        """
        async with self.Session() as s:
            draft = await lifecycle.create_session(
                s,
                tournament_id=self.tournament_id,
                workspace_id=self.workspace_id,
                shape=_SHAPE,
                fmt=DraftFormat.CUSTOM,
                settings={"round_rules": ["linear", "linear", "linear", "linear"]},
            )
            await lifecycle.seed(s, draft, captains=self._captains(), players=self._players())
            await lifecycle.start(s, draft)
            await s.commit()

            teams = (
                await s.scalars(sa.select(lifecycle.DraftTeam).where(lifecycle.DraftTeam.session_id == draft.id))
            ).all()
            team_by_pos = {t.draft_position: t.id for t in teams}

            # Round 1 is on the clock, so it is history and must not move.
            draft.settings_json = {"round_rules": ["reverse", "reverse", "linear", "linear"]}
            moved = await lifecycle.resync_pick_order(s, draft)
            await s.commit()

            picks = (
                await s.scalars(
                    sa.select(DraftPick).where(DraftPick.session_id == draft.id).order_by(DraftPick.overall_no.asc())
                )
            ).all()

            self.assertEqual(moved, 2)  # only round 2's outer seats swap
            # Round 1 untouched: it already started under the old rule.
            self.assertEqual(
                [p.draft_team_id for p in picks[:3]],
                [team_by_pos[1], team_by_pos[2], team_by_pos[3]],
            )
            # Round 2 now reads N -> 1, the rule the admin just chose.
            self.assertEqual(
                [p.draft_team_id for p in picks[3:6]],
                [team_by_pos[3], team_by_pos[2], team_by_pos[1]],
            )
            # Rounds 3-4 stayed linear, and a second resync is a no-op.
            self.assertEqual(
                [p.draft_team_id for p in picks[6:9]],
                [team_by_pos[1], team_by_pos[2], team_by_pos[3]],
            )
            self.assertEqual(await lifecycle.resync_pick_order(s, draft), 0)

    async def test_custom_format_dynamic_rules(self) -> None:
        async with self.Session() as s:
            rules = ["linear", "team_avg_asc", "linear", "linear"]
            draft = await lifecycle.create_session(
                s,
                tournament_id=self.tournament_id,
                workspace_id=self.workspace_id,
                shape=_SHAPE,
                fmt=DraftFormat.CUSTOM,
                settings={"round_rules": rules},
            )
            await lifecycle.seed(s, draft, captains=self._captains(), players=self._players())
            await lifecycle.start(s, draft)
            await s.commit()

            available = (
                await s.scalars(
                    sa.select(lifecycle.DraftPlayer).where(
                        lifecycle.DraftPlayer.session_id == draft.id,
                        lifecycle.DraftPlayer.status == DraftPlayerStatus.AVAILABLE.value,
                    )
                )
            ).all()

            # Filter available players by role to satisfy draft limits
            dps_players = [p for p in available if p.primary_role == HeroClass.damage.slot_code]
            support_players = [p for p in available if p.primary_role == HeroClass.support.slot_code]
            tank_players = [p for p in available if p.primary_role == HeroClass.tank.slot_code]

            # Pick 1 (Cap0: TANK) picks a DPS player
            p1 = dps_players[0]
            p1.rank_value = 3500

            # Pick 2 (Cap1: DPS) picks a SUPPORT player
            p2 = support_players[0]
            p2.rank_value = 1000

            # Pick 3 (Cap2: SUPPORT) picks a TANK player
            p3 = tank_players[0]
            p3.rank_value = 2000

            await s.flush()

            # Execute Pick 1 (Cap0)
            current = await s.get(DraftPick, draft.current_pick_id)
            await selection.select(
                s,
                draft,
                current,
                player_id=p1.id,
                expected_version=current.version,
                target_role=None,
                actor_user_id=None,
                is_admin=True,
            )
            await s.commit()

            # Execute Pick 2 (Cap1)
            current = await s.get(DraftPick, draft.current_pick_id)
            await selection.select(
                s,
                draft,
                current,
                player_id=p2.id,
                expected_version=current.version,
                target_role=None,
                actor_user_id=None,
                is_admin=True,
            )
            await s.commit()

            # Execute Pick 3 (Cap2) - triggers dynamic sort for Round 2
            current = await s.get(DraftPick, draft.current_pick_id)
            await selection.select(
                s,
                draft,
                current,
                player_id=p3.id,
                expected_version=current.version,
                target_role=None,
                actor_user_id=None,
                is_admin=True,
            )
            await s.commit()

            # Verify Round 2 picks order
            await s.refresh(draft)
            picks = (
                await s.scalars(
                    sa.select(DraftPick).where(DraftPick.session_id == draft.id).order_by(DraftPick.overall_no.asc())
                )
            ).all()

            teams = (
                await s.scalars(sa.select(lifecycle.DraftTeam).where(lifecycle.DraftTeam.session_id == draft.id))
            ).all()
            team_by_pos = {t.draft_position: t.id for t in teams}

            # Expected order for Round 2: Cap1 (pos 2), Cap2 (pos 3), Cap0 (pos 1)
            self.assertEqual(picks[3].draft_team_id, team_by_pos[2])
            self.assertEqual(picks[4].draft_team_id, team_by_pos[3])
            self.assertEqual(picks[5].draft_team_id, team_by_pos[1])

            # The seats moved under the captains, so the draft locks instead of
            # dropping the new leader onto a running clock.
            self.assertEqual(draft.status, DraftStatus.PAUSED.value)
            self.assertEqual(draft.blocked_reason, "order_recalculated")
            self.assertEqual(draft.current_pick_id, picks[3].id)
            self.assertEqual(picks[3].status, DraftPickStatus.ON_CLOCK.value)
            self.assertIsNone(picks[3].clock_expires_at)

            # Nobody — captain or admin — can pick through the lock.
            with self.assertRaises(ApiHTTPException):
                await selection.select(
                    s,
                    draft,
                    picks[3],
                    player_id=dps_players[1].id,
                    expected_version=picks[3].version,
                    target_role=None,
                    actor_user_id=None,
                    is_admin=True,
                )

            # Resuming arms a full timer for whoever the new order put on clock.
            await lifecycle.resume(s, draft)
            self.assertEqual(draft.status, DraftStatus.LIVE.value)
            self.assertIsNone(draft.blocked_reason)
            self.assertIsNotNone(picks[3].clock_expires_at)

            # A settings save must not undo the average-driven seating. The round
            # is on the clock, so `resync_pick_order` treats it as history; only
            # rounds that have not started are re-seated from the rules.
            draft.settings_json = {"round_rules": ["linear", "team_avg_asc", "reverse", "linear"]}
            moved = await lifecycle.resync_pick_order(s, draft)
            await s.commit()

            picks = (
                await s.scalars(
                    sa.select(DraftPick).where(DraftPick.session_id == draft.id).order_by(DraftPick.overall_no.asc())
                )
            ).all()

            self.assertEqual([p.draft_team_id for p in picks[3:6]], [team_by_pos[2], team_by_pos[3], team_by_pos[1]])
            # Round 3 became `reverse`, so its two outer seats swapped.
            self.assertEqual(moved, 2)
            self.assertEqual([p.draft_team_id for p in picks[6:9]], [team_by_pos[3], team_by_pos[2], team_by_pos[1]])
