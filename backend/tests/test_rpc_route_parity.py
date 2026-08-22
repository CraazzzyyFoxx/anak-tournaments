"""Every gateway route must name a subject some worker actually consumes.

A mismatch between the Go route table and the Python `@broker.subscriber` names is
invisible at startup and at build time: the gateway happily publishes to a queue
with no consumer, and the caller sees a request *timeout*. Nothing logs "unknown
subject". That makes this the one wiring bug in the RPC layer with no natural
signal, so it gets a static guard.

Text parsing on purpose — no Go toolchain, no broker, no RabbitMQ. The two sides
are literal strings in both languages, which is exactly what makes them driftable
and exactly what makes them comparable.
"""

from __future__ import annotations

import re
from pathlib import Path
from unittest import TestCase

REPO_ROOT = Path(__file__).resolve().parents[2]
GATEWAY_TOURNAMENT = REPO_ROOT / "gateway" / "internal" / "tournament"
GATEWAY_BALANCER = REPO_ROOT / "gateway" / "internal" / "balancer"
TOURNAMENT_SRC = REPO_ROOT / "backend" / "tournament-service" / "src"
BALANCER_SRC = REPO_ROOT / "backend" / "balancer-service" / "src"

#: Modules that *name* subjects without registering them. Scanning them would let a
#: genuine orphan hide behind its own documentation entry.
_DOC_ONLY_MODULES = frozenset({"openapi_docs.py", "openapi_schemas.py"})

#: The two (route dir, worker src) pairs this guard covers. Kept explicit rather
#: than globbing every service: a pair only belongs here once its route table and
#: its subscribers are known to be in sync, so adding one is a deliberate act.
_PAIRS = (
    ("rpc.tournament", GATEWAY_TOURNAMENT, TOURNAMENT_SRC),
    ("rpc.balancer", GATEWAY_BALANCER, BALANCER_SRC),
)


def _queue_re(prefix: str) -> re.Pattern[str]:
    return re.compile(rf'Queue:\s*"({re.escape(prefix)}\.[a-z0-9_.]+)"')


def _subject_re(prefix: str) -> re.Pattern[str]:
    """Any subject literal in the worker's source.

    Deliberately NOT anchored to ``@broker.subscriber("...")``. Two real
    registration styles defeat an anchored pattern, and both were found by trying
    it: five balancer draft subjects register through a
    ``_make_lifecycle(subject, ...)`` factory, and the whole
    ``rpc.tournament.admin.*`` CRUD family registers from
    ``services/admin/registry.py`` — outside ``src/rpc`` entirely. Matching any
    literal, minus the doc-only modules, is the accurate trade.
    """
    return re.compile(rf'"({re.escape(prefix)}\.[a-z0-9_.]+)"')


def _routed_subjects() -> dict[str, set[str]]:
    """Subject -> the route files naming it."""
    found: dict[str, set[str]] = {}
    for prefix, gateway_dir, _service in _PAIRS:
        pattern = _queue_re(prefix)
        for path in sorted(gateway_dir.glob("*.go")):
            if path.name.endswith("_test.go"):
                continue
            for subject in pattern.findall(path.read_text(encoding="utf-8")):
                found.setdefault(subject, set()).add(f"{gateway_dir.name}/{path.name}")
    return found


def _consumed_subjects() -> set[str]:
    consumed: set[str] = set()
    for prefix, _gateway_dir, service_dir in _PAIRS:
        pattern = _subject_re(prefix)
        for path in service_dir.rglob("*.py"):
            if path.name in _DOC_ONLY_MODULES:
                continue
            consumed.update(pattern.findall(path.read_text(encoding="utf-8")))
    return consumed


class RouteSubjectParityTests(TestCase):
    def test_the_parser_finds_both_sides(self) -> None:
        """Guards the guard: a regex that silently matches nothing would make every
        assertion below vacuously true."""
        self.assertGreater(len(_routed_subjects()), 40)
        self.assertGreater(len(_consumed_subjects()), 40)

    def test_every_routed_subject_has_a_consumer(self) -> None:
        """A route pointing at a subject nobody subscribes to times out instead of
        failing — the caller cannot tell it apart from a slow worker."""
        routed = _routed_subjects()
        consumed = _consumed_subjects()
        orphans = {subject: sorted(files) for subject, files in routed.items() if subject not in consumed}
        self.assertEqual({}, orphans)

    def test_the_team_registration_subjects_are_wired_end_to_end(self) -> None:
        """Named explicitly rather than relying on the sweep above: these eleven
        are the whole HTTP surface of the team-registration feature, and a missing
        one is a flow that simply cannot be reached."""
        expected = {
            "rpc.tournament.regteam_create",
            "rpc.tournament.regteam_invite",
            "rpc.tournament.regteam_invite_revoke",
            "rpc.tournament.regteam_accept",
            "rpc.tournament.regteam_decline",
            "rpc.tournament.regteam_kick",
            "rpc.tournament.regteam_leave",
            "rpc.tournament.regteam_transfer_captain",
            "rpc.tournament.regteam_disband",
            "rpc.tournament.regteam_list",
            "rpc.tournament.regteam_reject",
            "rpc.tournament.regteam_list_public",
            "rpc.balancer.teams.export_registered",
        }
        routed = set(_routed_subjects())
        consumed = _consumed_subjects()
        self.assertEqual(set(), expected - routed, "team subjects with no gateway route")
        self.assertEqual(set(), expected - consumed, "team subjects with no worker subscriber")

    def test_no_team_subject_is_routed_twice(self) -> None:
        """Scoped to the subjects this feature added, not the whole repo.

        Repo-wide this would fail today and legitimately so: several subjects are
        deliberately exposed at two paths (a current route plus a legacy alias).
        The handler cannot tell which path it was reached by, so for a *new* subject
        a second route means one of them silently drops its path params — which is
        why the check is worth having here and not worth asserting globally.
        """
        duplicates = {
            subject: sorted(files)
            for subject, files in _routed_subjects().items()
            if len(files) > 1 and (".regteam_" in subject or subject.endswith("export_registered"))
        }
        self.assertEqual({}, duplicates)


class TeamRouteShapeTests(TestCase):
    """Three security decisions live in the route table itself: which team routes
    exist, that only a read may be anonymous, and that no token rides a URL."""

    def _team_route_lines(self) -> list[str]:
        lines: list[str] = []
        for name in ("public_routes.go", "registration_routes.go"):
            for line in (GATEWAY_TOURNAMENT / name).read_text(encoding="utf-8").splitlines():
                if "rpc.tournament.regteam_" in line:
                    lines.append(line)
        return lines

    def test_all_team_routes_are_present(self) -> None:
        """Twenty: fourteen flows and six reads — the public roster, the admin
        roster, the free-agent picker, a player's own invites, and the invite
        history from each side."""
        self.assertEqual(20, len(self._team_route_lines()))

    def test_no_team_WRITE_route_is_anonymous(self) -> None:
        """Even redeeming a link invite writes a registration bound to an account:
        the token authorizes which *slot* you may take, never who you are. An
        ``AuthOptional`` write would be an unauthenticated write surface.

        The invite preview is the single exception, and it is named rather than
        counted around: it is a POST only so the token stays out of the query
        string, and it mutates nothing (pinned below). Bumping a number here
        instead would let the next anonymous route in silently.

        Scoped to writes deliberately. The public roster read is ``AuthOptional`` by
        design — anyone may see the field, and the server omits invites from it —
        so asserting this over every team route would be asserting something false.
        """
        writes = [line for line in self._team_route_lines() if '"POST"' in line or '"DELETE"' in line]
        preview = [line for line in writes if "regteam_invite_preview" in line]
        mutating = [line for line in writes if "regteam_invite_preview" not in line]

        self.assertEqual(1, len(preview))
        self.assertIn("edge.AuthOptional", preview[0])
        # Thirteen mutating writes; the rest of the team routes are reads.
        self.assertEqual(13, len(mutating))
        for line in mutating:
            with self.subTest(route=line.strip()[:80]):
                self.assertIn("edge.AuthRequired", line)
                self.assertNotIn("edge.AuthOptional", line)

    def test_organizer_invite_writes_authorize_against_the_tournament(self) -> None:
        """The two organizer powers over someone else's roster are authorized by
        ``_tournament_ctx``, which reads ``IDParam``. If that ever named the invite
        or team instead, the permission check would resolve the wrong workspace and
        an organizer of one event could act on another's teams — the service's own
        scope check is the second lock, not the first.
        """
        organizer_writes = [
            line
            for line in self._team_route_lines()
            if "regteam_invite_revoke_admin" in line or "regteam_invite_cap_reset" in line
        ]

        self.assertEqual(2, len(organizer_writes))
        for line in organizer_writes:
            with self.subTest(route=line.strip()[:80]):
                self.assertIn('IDParam: "tournament_id"', line)
                self.assertIn("/admin/balancer/tournaments/", line)

    def test_the_anonymous_invite_preview_only_reads(self) -> None:
        """The one anonymous team route is a POST, so nothing about its method stops
        it from growing a write. Its safety is that the service function it calls
        mutates nothing — asserted here rather than trusted from the name."""
        source = (
            REPO_ROOT / "backend" / "tournament-service" / "src" / "services" / "registration" / "teams.py"
        ).read_text(encoding="utf-8")
        body = source[source.index("async def preview_invite") :]
        body = body[: body.index("async def accept_invite")]
        for writer in ("session.add", "sa.update", "sa.insert", "sa.delete", "commit()", "flush()"):
            with self.subTest(writer=writer):
                self.assertNotIn(writer, body)

    def test_the_public_team_read_leaks_no_invites(self) -> None:
        """The one AuthOptional team route. Its safety is server-side — the handler
        calls ``describe_team`` without ``include_invites`` — so this pins the
        handler, not the route."""
        source = (REPO_ROOT / "backend" / "tournament-service" / "src" / "rpc" / "public_rpc.py").read_text(
            encoding="utf-8"
        )
        handler = source[source.index("_regteam_list_public") :]
        handler = handler[: handler.index("# ── public team registration")]
        self.assertIn("describe_team(session, team)", handler)
        self.assertNotIn("include_invites=True", handler)

    def test_the_invite_token_never_travels_in_a_url(self) -> None:
        """A raw token in the path or query string lands in access logs, browser
        history and `Referer` headers — which is why every route that takes one
        takes it in the body.

        The preview matters most here: it is the route the shareable link resolves
        against, so a GET would put the token in the query string of the one request
        every invitee makes. The link itself keeps the token in the URL *fragment*,
        which no browser ever sends to a server.
        """
        for line in self._team_route_lines():
            with self.subTest(route=line.strip()[:80]):
                self.assertNotIn("{token}", line)
        for queue in ("regteam_accept", "regteam_invite_preview"):
            matches = [line for line in self._team_route_lines() if queue in line]
            with self.subTest(queue=queue):
                self.assertEqual(1, len(matches))
                self.assertIn("Body: true", matches[0])
                self.assertNotIn("AllQuery", matches[0])
