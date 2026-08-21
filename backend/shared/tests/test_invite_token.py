"""Invite token generation and comparison.

The claims under test are the security properties, not the plumbing: enough
entropy, never stored raw, compared without a timing signal.
"""

from __future__ import annotations

import hashlib
import os
import sys
from pathlib import Path
from unittest import TestCase

BACKEND_ROOT = Path(__file__).resolve().parents[2]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

os.environ.setdefault("PROJECT_URL", "http://localhost")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")

from shared.domain import invite_token  # noqa: E402


class GenerationTests(TestCase):
    def test_raw_and_hash_are_returned_together(self) -> None:
        raw, digest = invite_token.generate_invite_token()
        self.assertEqual(hashlib.sha256(raw.encode("utf-8")).hexdigest(), digest)

    def test_the_raw_token_carries_at_least_256_bits(self) -> None:
        """A weaker token would make the link guessable, and redeeming one writes
        into a stranger's roster."""
        raw, _ = invite_token.generate_invite_token()
        # url-safe base64 packs 6 bits per character.
        self.assertGreaterEqual(len(raw) * 6, 256)

    def test_the_token_is_url_safe(self) -> None:
        """It travels in a link; `+` and `/` would need escaping."""
        raw, _ = invite_token.generate_invite_token()
        self.assertNotIn("+", raw)
        self.assertNotIn("/", raw)
        self.assertNotIn("=", raw)

    def test_tokens_do_not_repeat(self) -> None:
        tokens = {invite_token.generate_invite_token()[0] for _ in range(200)}
        self.assertEqual(200, len(tokens))

    def test_the_hash_is_hex_and_fits_the_column(self) -> None:
        """`token_sha256` is String(64); a longer digest would be silently
        truncated by some drivers."""
        _, digest = invite_token.generate_invite_token()
        self.assertEqual(64, len(digest))
        int(digest, 16)


class ComparisonTests(TestCase):
    def test_a_matching_token_verifies(self) -> None:
        raw, digest = invite_token.generate_invite_token()
        self.assertTrue(invite_token.tokens_match(raw, digest))

    def test_a_different_token_does_not(self) -> None:
        _, digest = invite_token.generate_invite_token()
        other, _ = invite_token.generate_invite_token()
        self.assertFalse(invite_token.tokens_match(other, digest))

    def test_a_truncated_token_does_not_verify(self) -> None:
        """Rules out a prefix comparison."""
        raw, digest = invite_token.generate_invite_token()
        self.assertFalse(invite_token.tokens_match(raw[:-1], digest))

    def test_hashing_is_stable_across_calls(self) -> None:
        raw, digest = invite_token.generate_invite_token()
        self.assertEqual(digest, invite_token.hash_invite_token(raw))

    def test_comparison_is_constant_time(self) -> None:
        """Asserted structurally: a plain `==` on the digest would leak how many
        leading characters matched. Reading the source is the only way to pin
        this, since the timing itself is not observable in a unit test."""
        import inspect

        source = inspect.getsource(invite_token.tokens_match)
        self.assertIn("compare_digest", source)
