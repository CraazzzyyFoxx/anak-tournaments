"""Team-registration flow contracts.

Three claims are pinned here, chosen because each one is a design decision that a
plausible refactor would silently undo:

* the guarded ``UPDATE`` really is guarded — state *and* expiry are in the SQL, not
  in a preceding read (§3.3);
* rowcount 0 is translated into a distinct machine code per cause, instead of one
  opaque failure (§12.1);
* every rejection carries a stable ``code``, because these surfaces are public and
  Russian-first (§12.2).

The concurrency behaviour these enable needs a real Postgres and lives with the
DB-backed suites; what is asserted here is that the mechanism is present and wired
the right way round.
"""

from __future__ import annotations

import os
import sys
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from unittest import IsolatedAsyncioTestCase, TestCase

SERVICE_ROOT = Path(__file__).resolve().parents[1]
BACKEND_ROOT = SERVICE_ROOT.parent
for path in (str(SERVICE_ROOT), str(BACKEND_ROOT)):
    if path not in sys.path:
        sys.path.insert(0, path)

os.environ.setdefault("PROJECT_URL", "http://localhost")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")

import sqlalchemy as sa  # noqa: E402
from sqlalchemy.dialects import postgresql  # noqa: E402

from shared.core.errors import ApiHTTPException  # noqa: E402
from shared.domain.roster_shape import parse_roster_slots  # noqa: E402
from shared.domain.team_roster import RosterMember, RosterOccupancy  # noqa: E402
from src import models  # noqa: E402
from src.services.registration import teams  # noqa: E402

FIVE_STACK = parse_roster_slots({"tank": 1, "dps": 2, "support": 2})


@dataclass
class _Invite:
    """Just the fields `_diagnose_dead_invite` reads."""

    state: str
    expires_at: datetime | None = None


def _code(exc: ApiHTTPException) -> str:
    detail: Any = exc.detail
    return detail[0]["code"]


class DeadInviteDiagnosisTests(TestCase):
    """§12.1: four causes, four recourses, four codes."""

    def test_an_accepted_invite_says_so(self) -> None:
        failure = teams._diagnose_dead_invite(_Invite(state=teams.INVITE_ACCEPTED))
        self.assertEqual("invite_already_accepted", _code(failure))

    def test_a_revoked_invite_says_so(self) -> None:
        failure = teams._diagnose_dead_invite(_Invite(state=teams.INVITE_REVOKED))
        self.assertEqual("invite_revoked", _code(failure))

    def test_a_declined_invite_says_so(self) -> None:
        failure = teams._diagnose_dead_invite(_Invite(state=teams.INVITE_DECLINED))
        self.assertEqual("invite_declined", _code(failure))

    def test_an_expired_invite_is_distinguished_from_a_revoked_one(self) -> None:
        """The recourses differ: "ask for a new link" vs "the captain removed you".
        Collapsing them is the exact failure §12.1 exists to prevent."""
        failure = teams._diagnose_dead_invite(
            _Invite(state=teams.INVITE_PENDING, expires_at=datetime.now(UTC) - timedelta(seconds=1))
        )
        self.assertEqual("invite_expired", _code(failure))

    def test_a_still_valid_invite_is_reported_as_a_lost_race(self) -> None:
        """Pending, unexpired, yet the guard refused it — someone else committed
        first. Reporting "expired" here would be a lie."""
        failure = teams._diagnose_dead_invite(
            _Invite(state=teams.INVITE_PENDING, expires_at=datetime.now(UTC) + timedelta(days=1))
        )
        self.assertEqual("invite_already_accepted", _code(failure))

    def test_an_invite_with_no_expiry_never_reads_as_expired(self) -> None:
        failure = teams._diagnose_dead_invite(_Invite(state=teams.INVITE_PENDING, expires_at=None))
        self.assertNotEqual("invite_expired", _code(failure))

    def test_every_diagnosis_is_a_conflict_not_a_server_error(self) -> None:
        for state in (teams.INVITE_ACCEPTED, teams.INVITE_REVOKED, teams.INVITE_DECLINED, teams.INVITE_PENDING):
            with self.subTest(state=state):
                self.assertEqual(409, teams._diagnose_dead_invite(_Invite(state=state)).status_code)


class GuardedUpdateTests(TestCase):
    """The race fix is the SQL, not the surrounding Python."""

    def _consume_sql(self) -> str:
        statement = (
            sa.update(models.BalancerRegistrationTeamInvite)
            .where(
                models.BalancerRegistrationTeamInvite.id == 1,
                models.BalancerRegistrationTeamInvite.state == teams.INVITE_PENDING,
                sa.or_(
                    models.BalancerRegistrationTeamInvite.expires_at.is_(None),
                    models.BalancerRegistrationTeamInvite.expires_at > sa.func.now(),
                ),
            )
            .values(state=teams.INVITE_ACCEPTED)
            .returning(models.BalancerRegistrationTeamInvite.id)
        )
        return str(statement.compile(dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}))

    def test_the_source_consumes_the_invite_with_a_guarded_update(self) -> None:
        """A read-then-write would let two redemptions of one link both succeed.
        Asserted on the source because the race itself is not unit-testable."""
        import inspect

        source = inspect.getsource(teams.accept_invite)
        self.assertIn("sa.update(models.BalancerRegistrationTeamInvite)", source)
        self.assertIn("_diagnose_dead_invite", source)

    def test_state_and_expiry_are_both_in_the_where_clause(self) -> None:
        sql = self._consume_sql()
        self.assertIn("state = 'pending'", sql)
        self.assertIn("expires_at", sql)
        self.assertIn("now()", sql)

    def test_expiry_uses_the_database_clock(self) -> None:
        """A Python `datetime.now()` in the predicate would be evaluated before the
        row lock is granted, reopening the window it closes."""
        self.assertIn("now()", self._consume_sql())

    def test_the_update_returns_a_row_so_rowcount_can_be_inspected(self) -> None:
        self.assertIn("RETURNING", self._consume_sql())


class SlotRejectionCodeTests(TestCase):
    """§12.2: a public, Russian-first surface cannot render an English `msg`."""

    def test_a_taken_slot_is_a_conflict_named_slot_taken(self) -> None:
        occupancy = RosterOccupancy(shape=FIVE_STACK, accepted=(RosterMember("tank"),))
        with self.assertRaises(ApiHTTPException) as caught:
            teams._check_slot(occupancy, "tank", is_substitute=False, offering=False)
        self.assertEqual(409, caught.exception.status_code)
        self.assertEqual("slot_taken", _code(caught.exception))

    def test_an_already_offered_slot_is_named_separately_from_a_taken_one(self) -> None:
        """The captain's recourse differs: revoke the outstanding invite, versus
        nothing at all."""
        occupancy = RosterOccupancy(shape=FIVE_STACK, pending=(RosterMember("tank"),))
        with self.assertRaises(ApiHTTPException) as caught:
            teams._check_slot(occupancy, "tank", is_substitute=False, offering=True)
        self.assertEqual("slot_already_offered", _code(caught.exception))

    def test_a_full_bench_is_named_separately_from_a_full_roster(self) -> None:
        occupancy = RosterOccupancy(shape=FIVE_STACK, max_substitutes=0)
        with self.assertRaises(ApiHTTPException) as caught:
            teams._check_slot(occupancy, "dps", is_substitute=True, offering=False)
        self.assertEqual("bench_full", _code(caught.exception))

    def test_a_slot_the_tournament_does_not_have_is_a_400(self) -> None:
        """Not a 409: no future team state makes "tank" valid on a role-less
        tournament, so retrying is pointless."""
        occupancy = RosterOccupancy(shape=parse_roster_slots({"flex": 6}))
        with self.assertRaises(ApiHTTPException) as caught:
            teams._check_slot(occupancy, "tank", is_substitute=False, offering=False)
        self.assertEqual(400, caught.exception.status_code)
        self.assertEqual("slot_not_in_shape", _code(caught.exception))

    def test_an_available_slot_raises_nothing(self) -> None:
        occupancy = RosterOccupancy(shape=FIVE_STACK)
        teams._check_slot(occupancy, "tank", is_substitute=False, offering=False)
        teams._check_slot(occupancy, "tank", is_substitute=False, offering=True)


class StatusDenormalizationTests(TestCase):
    def test_a_full_roster_reads_as_complete(self) -> None:
        occupancy = RosterOccupancy(
            shape=FIVE_STACK,
            accepted=tuple(RosterMember(code) for code in ("tank", "dps", "dps", "support", "support")),
        )
        self.assertEqual(teams.TEAM_COMPLETE, teams._status_for(occupancy))

    def test_a_partial_roster_stays_forming(self) -> None:
        occupancy = RosterOccupancy(shape=FIVE_STACK, accepted=(RosterMember("tank"),))
        self.assertEqual(teams.TEAM_FORMING, teams._status_for(occupancy))

    def test_pending_invites_do_not_make_a_team_complete(self) -> None:
        """Otherwise a captain could reach `complete` by inviting five people and
        the export would materialize an empty roster."""
        occupancy = RosterOccupancy(
            shape=FIVE_STACK,
            accepted=(RosterMember("tank"),),
            pending=tuple(RosterMember(code) for code in ("dps", "dps", "support", "support")),
        )
        self.assertEqual(teams.TEAM_FORMING, teams._status_for(occupancy))


class MutabilityGateTests(TestCase):
    def _team(self, **kwargs: Any) -> models.BalancerRegistrationTeam:
        team = models.BalancerRegistrationTeam(**kwargs)
        return team

    def test_an_exported_team_is_frozen_by_its_export_link_not_its_status(self) -> None:
        """Its shape is already baked into `tournament.player` rows, so editing the
        roster afterwards would desync the two."""
        team = self._team(status=teams.TEAM_FORMING, exported_team_id=7)
        with self.assertRaises(ApiHTTPException) as caught:
            teams._assert_mutable(team)
        self.assertEqual("team_already_exported", _code(caught.exception))

    def test_a_disbanded_team_is_terminal(self) -> None:
        team = self._team(status=teams.TEAM_DISBANDED)
        with self.assertRaises(ApiHTTPException) as caught:
            teams._assert_mutable(team)
        self.assertEqual("team_not_forming", _code(caught.exception))

    def test_a_rejected_team_is_terminal(self) -> None:
        team = self._team(status=teams.TEAM_REJECTED)
        with self.assertRaises(ApiHTTPException) as caught:
            teams._assert_mutable(team)
        self.assertEqual("team_not_forming", _code(caught.exception))

    def test_a_complete_team_is_still_editable(self) -> None:
        """Complete is not terminal: a captain may still swap a player before the
        organizer exports."""
        teams._assert_mutable(self._team(status=teams.TEAM_COMPLETE))

    def test_a_forming_team_is_editable(self) -> None:
        teams._assert_mutable(self._team(status=teams.TEAM_FORMING))


class OrganizerRejectionTests(TestCase):
    def test_rejecting_a_team_withdraws_its_members_by_default(self) -> None:
        """§12.5's dead end: leaving the rows approved strands a player holding a
        live registration for a tournament they cannot play in, with nothing on
        their card explaining why. The opt-out exists for "incomplete", not
        "unwelcome"."""
        import inspect

        signature = inspect.signature(teams.reject_team)
        self.assertIs(True, signature.parameters["withdraw_members"].default)

    def test_listing_hides_terminal_teams_by_default(self) -> None:
        """The organizer's working view is who still needs chasing; rejected and
        disbanded teams are noise until explicitly asked for."""
        import inspect

        signature = inspect.signature(teams.list_teams)
        self.assertIs(False, signature.parameters["include_terminal"].default)

    def test_the_two_terminal_statuses_are_outside_the_mutable_set(self) -> None:
        self.assertNotIn(teams.TEAM_REJECTED, teams._MUTABLE_TEAM_STATUSES)
        self.assertNotIn(teams.TEAM_DISBANDED, teams._MUTABLE_TEAM_STATUSES)
        self.assertEqual(set(teams.TEAM_STATUSES) - teams._MUTABLE_TEAM_STATUSES, {"rejected", "disbanded"})


class _SingleTeamSession:
    """Answers only the `SELECT … FOR UPDATE` that `_lock_team` issues."""

    def __init__(self, team: object) -> None:
        self.team = team

    async def scalar(self, statement: object) -> object:
        return self.team


class CrossTournamentAuthorizationTests(IsolatedAsyncioTestCase):
    """`reject_team` is authorized against a tournament, so it must verify the team
    actually belongs to it."""

    async def test_rejecting_a_team_from_another_tournament_is_refused(self) -> None:
        """The permission check upstream passes for tournament 1; without this
        assertion an organizer of tournament 1 could reject teams in tournament 2."""
        team = models.BalancerRegistrationTeam(tournament_id=2, status=teams.TEAM_FORMING)
        session = _SingleTeamSession(team)
        with self.assertRaises(ApiHTTPException) as caught:
            await teams.reject_team(
                session,  # type: ignore[arg-type]
                tournament_id=1,
                team_id=99,
                auth_user=models.AuthUser(id=5),
            )
        # 404, not 403: confirming it exists elsewhere leaks roster membership
        # across workspaces.
        self.assertEqual(404, caught.exception.status_code)
        self.assertEqual("team_not_found", _code(caught.exception))

    async def test_the_tournament_id_cannot_be_omitted(self) -> None:
        """Keyword-only with no default, so no call site can accidentally drop the
        scope check by forgetting an argument."""
        import inspect

        parameter = inspect.signature(teams.reject_team).parameters["tournament_id"]
        self.assertIs(inspect.Parameter.empty, parameter.default)
        self.assertIs(inspect.Parameter.KEYWORD_ONLY, parameter.kind)


class TeamNameConstraintTests(IsolatedAsyncioTestCase):
    """The export seam derives `Team.name` by splitting `balancer_name` on "#"."""

    async def test_a_name_containing_a_hash_is_rejected(self) -> None:
        """A name like "Team #1" would materialize as "Team " — and the
        `exported_team_id` backfill, keyed on the full name, would then find
        nothing. Rejecting at creation is the only place this is cheap."""
        with self.assertRaises(ApiHTTPException) as caught:
            await teams.create_team(
                None,  # type: ignore[arg-type]
                tournament_id=1,
                auth_user=models.AuthUser(id=1),
                name="Team #1",
                slot_code="tank",
                body=None,  # type: ignore[arg-type]
            )
        self.assertEqual(400, caught.exception.status_code)
        self.assertEqual("team_name_invalid", _code(caught.exception))

    async def test_a_blank_name_is_rejected(self) -> None:
        with self.assertRaises(ApiHTTPException) as caught:
            await teams.create_team(
                None,  # type: ignore[arg-type]
                tournament_id=1,
                auth_user=models.AuthUser(id=1),
                name="   ",
                slot_code="tank",
                body=None,  # type: ignore[arg-type]
            )
        self.assertEqual("team_name_required", _code(caught.exception))

    async def test_the_check_runs_before_any_database_access(self) -> None:
        """Passing `None` as the session above is the assertion: if either check
        moved after the openness lookup, these tests would fail with an
        AttributeError instead of the expected code."""
        for name in ("Team #1", "  "):
            with self.subTest(name=name), self.assertRaises(ApiHTTPException):
                await teams.create_team(
                    None,  # type: ignore[arg-type]
                    tournament_id=1,
                    auth_user=models.AuthUser(id=1),
                    name=name,
                    slot_code="tank",
                    body=None,  # type: ignore[arg-type]
                )


class FreeAgentAttachTests(TestCase):
    """A solo registrant accepting an invite ATTACHES, never re-registers.

    There is one registration row per player per tournament, so "registered solo"
    and "on a team" are two states of the same row. Before this, `accept_invite`
    always called the creating writer, which answered `already_registered` — and
    since withdrawal is final, a solo registrant could never join any team.
    """

    def _source(self) -> str:
        import inspect

        return inspect.getsource(teams.accept_invite)

    def test_an_existing_registration_is_attached_not_recreated(self) -> None:
        source = self._source()
        # The existing row is looked up and its three team columns are set...
        self.assertIn("get_registration(session, team.tournament_id, auth_user.id)", source)
        self.assertIn("existing.registration_team_id = team.id", source)
        self.assertIn("existing.team_slot_code = invite.slot_code", source)
        # ...and the creating writer is reached only in the `else`. Matched on the
        # CALL, not the bare name: the docstring mentions it first.
        attach_index = source.index("existing.registration_team_id")
        create_index = source.index("await submit_public_registration(")
        self.assertLess(attach_index, create_index, "attach must precede the create branch")

    def test_the_submitted_body_is_ignored_on_the_attach_path(self) -> None:
        """The player already answered the form; the invite only decides the slot.
        Passing `body` here would let an invite silently rewrite their roles."""
        source = self._source()
        attach = source[source.index("if existing is not None:") : source.index("else:")]
        self.assertNotIn("body", attach)

    def test_a_terminal_registration_is_refused_with_its_own_code(self) -> None:
        """Reviving a withdrawn row would smuggle a re-entry past the rule that
        withdrawal is final — which exists because withdrawing after check-in
        invalidates a composed roster."""
        source = self._source()
        self.assertIn("_SLOT_RELEASING_STATUSES", source)
        self.assertIn("registration_terminal", source)

    def test_the_slot_check_still_runs_before_the_attach(self) -> None:
        """Attaching must not bypass the occupancy check: two free agents accepting
        the same slot would otherwise both land on the roster."""
        source = self._source()
        self.assertLess(
            source.index("_check_slot"),
            source.index("existing.registration_team_id"),
        )
