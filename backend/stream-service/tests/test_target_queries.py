"""Guards on the poll-target queries — the privacy one above all.

A player's Twitch account is public only when a ``social_account_visibility`` row
with ``workspace_id IS NULL`` exists. That rule is enforced by an INNER JOIN
inside the ``SELECT``, not by a check in a serializer, precisely so a future code
path cannot forget it. These tests assert the JOIN and its predicate are in the
compiled SQL: with the JOIN present a verified account that has no global
visibility row is unreachable by the query and therefore cannot reach a public
response; drop the JOIN, or relax it to a LEFT OUTER, and the feature starts
publishing channels players hid from their profile
(``backend/app-service/src/services/user/flows.py`` ``visible_only``).

The second privacy rule is the owner's own veto (``players.user.stream_visible``).
It has to hold in BOTH source queries, which is the interesting part: the verified
path had no off switch at all before it, and a veto honoured by one query and not
the other publishes the channel anyway.

Statements are compiled, not executed: the shape is the contract, and a DB
fixture would test SQLAlchemy rather than this module.
"""

from __future__ import annotations

import os
from typing import Any
from unittest import IsolatedAsyncioTestCase

from sqlalchemy.dialects import postgresql

os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")
os.environ.setdefault("POSTGRES_USER", "postgres")
os.environ.setdefault("POSTGRES_PASSWORD", "postgres")
os.environ.setdefault("POSTGRES_DB", "postgres")
os.environ.setdefault("POSTGRES_HOST", "localhost")
os.environ.setdefault("POSTGRES_PORT", "5432")

from shared.core import enums  # noqa: E402
from src.services import targets  # noqa: E402


class _Result:
    def __init__(self, rows: list[Any]) -> None:
        self._rows = rows

    def all(self) -> list[Any]:
        return self._rows

    def scalars(self) -> _Result:
        return self

    def __iter__(self) -> Any:
        return iter(self._rows)


class _CapturingSession:
    """Fake AsyncSession: records every statement and replays queued row sets."""

    def __init__(self, *row_sets: list[Any]) -> None:
        self.statements: list[Any] = []
        self._row_sets = list(row_sets)

    async def execute(self, stmt: Any, *args: Any, **kwargs: Any) -> _Result:
        self.statements.append(stmt)
        return _Result(self._row_sets.pop(0) if self._row_sets else [])


def _compiled(stmt: Any) -> str:
    return str(stmt.compile(dialect=postgresql.dialect()))


class ActiveTournamentQueryTests(IsolatedAsyncioTestCase):
    async def test_finished_tournaments_are_never_polled(self) -> None:
        polled = set(targets.POLLED_TOURNAMENT_STATUSES)

        self.assertNotIn(enums.TournamentStatus.COMPLETED, polled)
        self.assertNotIn(enums.TournamentStatus.ARCHIVED, polled)
        # `registration` can run for weeks with nobody broadcasting; polling it
        # would burn a Helix bucket shared with identity-service for nothing.
        self.assertNotIn(enums.TournamentStatus.REGISTRATION, polled)
        self.assertEqual(
            polled,
            {
                enums.TournamentStatus.CHECK_IN,
                enums.TournamentStatus.DRAFT,
                enums.TournamentStatus.LIVE,
                enums.TournamentStatus.PLAYOFFS,
            },
        )

    async def test_selection_filters_on_status_not_is_finished(self) -> None:
        """``Tournament.is_finished`` is maintained separately and drifts from ``status``."""
        session = _CapturingSession([])

        await targets.active_tournament_ids(session)

        sql = _compiled(session.statements[0])
        self.assertIn("tournament.tournament.status IN", sql)
        self.assertNotIn("is_finished", sql)

    async def test_row_shape_carries_workspace_and_hidden_flag(self) -> None:
        session = _CapturingSession([(7, 3, True)])

        [tournament] = await targets.active_tournament_ids(session)

        self.assertEqual(tournament.tournament_id, 7)
        self.assertEqual(tournament.workspace_id, 3)
        self.assertTrue(tournament.is_hidden)


class OfficialLinkQueryTests(IsolatedAsyncioTestCase):
    async def test_only_active_stream_links_in_organizer_order(self) -> None:
        session = _CapturingSession([])

        await targets.official_stream_links(session, 7)

        sql = _compiled(session.statements[0])
        self.assertIn("tournament.tournament_link.kind =", sql)
        self.assertIn("tournament.tournament_link.is_active IS true", sql)
        self.assertIn("ORDER BY tournament.tournament_link.sort_order ASC", sql)


class ParticipantVisibilityTests(IsolatedAsyncioTestCase):
    """The privacy control. Do not weaken these without re-reading design §4.5."""

    async def _verified_sql(self) -> str:
        session = _CapturingSession([], [])
        await targets.participant_channels(session, 7)
        # [0] is the self-declared source, [1] the verified one.
        return _compiled(session.statements[1])

    async def test_verified_source_joins_global_visibility(self) -> None:
        sql = await self._verified_sql()

        self.assertIn("JOIN players.social_account_visibility", sql)
        self.assertIn("players.social_account_visibility.workspace_id IS NULL", sql)

    async def test_visibility_join_is_inner_so_hidden_accounts_drop_out(self) -> None:
        """A LEFT OUTER JOIN would keep the row and publish the hidden channel."""
        sql = await self._verified_sql()

        self.assertNotIn("LEFT OUTER JOIN players.social_account_visibility", sql)

    async def test_verified_source_requires_a_proven_twitch_account(self) -> None:
        sql = await self._verified_sql()

        self.assertIn("players.social_account.provider =", sql)
        self.assertIn("players.social_account.is_verified IS true", sql)


class ParticipantSelfDeclaredTests(IsolatedAsyncioTestCase):
    async def _self_declared_sql(self) -> str:
        session = _CapturingSession([], [])
        await targets.participant_channels(session, 7)
        return _compiled(session.statements[0])

    async def test_requires_the_explicit_stream_pov_opt_in(self) -> None:
        sql = await self._self_declared_sql()

        self.assertIn("balancer.registration.stream_pov IS true", sql)
        self.assertIn("balancer.registration.twitch_nick IS NOT NULL", sql)

    async def test_excludes_withdrawn_and_deleted_registrations(self) -> None:
        sql = await self._self_declared_sql()

        self.assertIn("balancer.registration.deleted_at IS NULL", sql)
        self.assertIn("balancer.registration.status =", sql)

    async def test_player_identity_comes_through_workspace_member(self) -> None:
        sql = await self._self_declared_sql()

        self.assertIn("JOIN workspace_member ON", sql)
        self.assertIn("workspace_member.player_id", sql)


class StreamVetoCollectionGateTests(IsolatedAsyncioTestCase):
    """``players.user.stream_visible`` must gate BOTH sources, or it gates neither.

    A veto in only one query is worse than none: the player believes they opted out
    while the other source keeps feeding their channel to the poller.
    ``user`` is a reserved word, so the compiled SQL quotes it: ``players."user"``.
    """

    # The veto predicate as PostgreSQL renders it. One constant, because the point of
    # these tests is that the two statements carry the SAME condition.
    VETO = 'players."user".stream_visible IS true'

    async def _both_sql(self) -> tuple[str, str]:
        session = _CapturingSession([], [])
        await targets.participant_channels(session, 7)
        # [0] is the self-declared source, [1] the verified one.
        return _compiled(session.statements[0]), _compiled(session.statements[1])

    async def test_the_self_declared_source_drops_a_vetoed_player(self) -> None:
        # Even with ``stream_pov`` set and a nick filled in: the veto outranks the
        # per-tournament opt-in, so both predicates have to be in the same WHERE.
        self_declared, _ = await self._both_sql()

        self.assertIn("balancer.registration.stream_pov IS true", self_declared)
        self.assertIn(self.VETO, self_declared)

    async def test_the_self_declared_source_joins_user_to_reach_the_flag(self) -> None:
        """Without the join there is no column to test, and the filter silently
        becomes a cartesian condition on some other ``user`` alias."""
        self_declared, _ = await self._both_sql()

        self.assertIn('JOIN players."user" ON workspace_member.player_id = players."user".id', self_declared)
        self.assertNotIn('LEFT OUTER JOIN players."user"', self_declared)

    async def test_the_verified_source_drops_a_vetoed_player(self) -> None:
        # The gap this closes: a verified + globally visible Twitch account used to be
        # consent enough, with no per-tournament or per-player way to say no.
        _, verified = await self._both_sql()

        self.assertIn("players.social_account.is_verified IS true", verified)
        self.assertIn(self.VETO, verified)

    async def test_the_predicate_is_the_same_in_both_sources(self) -> None:
        """The anti-drift guard: one shared helper, not two hand-written copies."""
        self_declared, verified = await self._both_sql()

        self.assertEqual(self_declared.count(self.VETO), 1)
        self.assertEqual(verified.count(self.VETO), 1)


class ParticipantMergeTests(IsolatedAsyncioTestCase):
    async def test_verified_wins_a_login_collision(self) -> None:
        """Same channel from both sources: keep the one carrying a stable id."""
        session = _CapturingSession(
            [(11, "CasterOne")],
            [(11, "CasterOne", "casterone", "id-42")],
        )

        [channel] = await targets.participant_channels(session, 7)

        self.assertEqual(channel.source, "verified")
        self.assertEqual(channel.provider_user_id, "id-42")
        self.assertEqual(channel.login, "casterone")

    async def test_self_declared_survives_without_a_verified_twin(self) -> None:
        session = _CapturingSession([(11, " SoloCaster ")], [])

        [channel] = await targets.participant_channels(session, 7)

        self.assertEqual(channel.source, "self_declared")
        self.assertEqual(channel.login, "solocaster")
        self.assertIsNone(channel.provider_user_id)

    async def test_blank_nicks_are_dropped(self) -> None:
        session = _CapturingSession([(11, "   "), (12, None)], [])

        self.assertEqual(await targets.participant_channels(session, 7), [])


class UrlHelperTests(IsolatedAsyncioTestCase):
    async def test_channel_urls_yield_a_pollable_login(self) -> None:
        self.assertEqual(targets.twitch_channel_from_url("https://twitch.tv/CasterOne"), "casterone")
        self.assertEqual(targets.twitch_channel_from_url("https://www.twitch.tv/casterone/"), "casterone")

    async def test_unpollable_twitch_urls_yield_none(self) -> None:
        """A VOD or a category page has no live status — the reader must render
        ``live=None`` ("no detection"), never ``live=False`` ("checked, offline")."""
        self.assertIsNone(targets.twitch_channel_from_url("https://twitch.tv/videos/123456"))
        self.assertIsNone(targets.twitch_channel_from_url("https://twitch.tv/directory/game/Overwatch"))
        self.assertIsNone(targets.twitch_channel_from_url("https://twitch.tv/"))
        self.assertIsNone(targets.twitch_channel_from_url("https://youtube.com/@owt"))

    async def test_platform_detection(self) -> None:
        self.assertEqual(targets.platform_from_url("https://www.twitch.tv/casterone"), "twitch")
        self.assertEqual(targets.platform_from_url("https://youtu.be/abc"), "youtube")
        self.assertEqual(targets.platform_from_url("https://vk.com/video1"), "other")
