"""The RPC error vocabulary is declared twice, in two languages.

``shared/schemas/rpc.py`` decides which code a worker emits;
``gateway/internal/rpc/envelope.go`` decides which HTTP status that code becomes.
A code present on only one side degrades to 500 — safe, but silent: the worker
believes it said "retry shortly" and the client is told "we are broken".

Nothing tied the two together before, which is how ``unavailable`` (503) could be
added on the Python side and quietly mean 500 for every caller. Text parsing, so
this needs no Go toolchain.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path
from unittest import TestCase

REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND_ROOT = REPO_ROOT / "backend"
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

ENVELOPE_GO = REPO_ROOT / "gateway" / "internal" / "rpc" / "envelope.go"

from shared.schemas.rpc import ERROR_CODES, status_to_code  # noqa: E402

_CASE_RE = re.compile(r'case\s+"([a-z_]+)":\s*(?://[^\n]*\n\s*)*(?:(?://[^\n]*\n\s*)*)?return\s+(\d{3})')


def _gateway_map() -> dict[str, int]:
    """code -> HTTP status, as the gateway sees it."""
    source = ENVELOPE_GO.read_text(encoding="utf-8")
    body = source[source.index("func StatusForCode") :]
    return {code: int(status) for code, status in _CASE_RE.findall(body)}


class VocabularyParityTests(TestCase):
    def test_the_parser_finds_the_gateway_map(self) -> None:
        """Guards the guard: an empty parse would make everything below vacuous."""
        mapping = _gateway_map()
        self.assertGreaterEqual(len(mapping), 9)
        self.assertEqual(429, mapping.get("rate_limited"))

    def test_every_emittable_code_has_a_gateway_status(self) -> None:
        """``internal`` is the deliberate exception: it is the gateway's *default*,
        so it needs no explicit case."""
        mapping = _gateway_map()
        missing = {code for code in ERROR_CODES if code != "internal"} - set(mapping)
        self.assertEqual(set(), missing, "codes a worker can emit that the gateway maps to 500")

    def test_every_gateway_case_is_a_code_a_worker_can_emit(self) -> None:
        """A case for a code nothing emits is dead, and usually means a rename
        landed on one side only."""
        unknown = set(_gateway_map()) - ERROR_CODES
        self.assertEqual(set(), unknown)

    def test_the_status_round_trip_agrees(self) -> None:
        """The real invariant: a worker raising status N must reach the client as
        status N. Anything else silently rewrites the contract mid-flight."""
        mapping = _gateway_map()
        for status in (400, 401, 403, 404, 409, 410, 413, 422, 429, 503):
            with self.subTest(status=status):
                code = status_to_code(status)
                self.assertIn(code, ERROR_CODES)
                self.assertEqual(status, mapping[code], f"{status} -> {code} -> {mapping[code]}")

    def test_an_unmapped_status_degrades_to_internal(self) -> None:
        """The safe direction, and why adding a code to one side is never a
        breakage — only a missed opportunity."""
        self.assertEqual("internal", status_to_code(418))
        self.assertEqual("internal", status_to_code(500))

    def test_unavailable_is_wired_end_to_end(self) -> None:
        """The code this test file was written for: the invite limiter fails closed
        and must tell the client to retry, not that the server is broken."""
        self.assertEqual("unavailable", status_to_code(503))
        self.assertEqual(503, _gateway_map()["unavailable"])
