from datetime import UTC, datetime, timedelta

from shared.subscriptions.challenge_code import (
    CodeTier,
    hash_code,
    match_code,
    parse_code_tiers,
)

NOW = datetime(2026, 8, 3, 12, 0, tzinfo=UTC)


def _tier(code: str, rank: int, expires: datetime | None = None) -> CodeTier:
    return CodeTier(
        code_sha256=hash_code(code),
        tier_rank=rank,
        tier_label=f"L{rank}",
        expires_at=expires,
    )


class TestHashCode:
    def test_is_stable_hex_sha256(self):
        assert hash_code("abc") == hash_code("abc")
        assert len(hash_code("abc")) == 64

    def test_is_case_and_whitespace_insensitive(self):
        """Patrons paste codes out of a post; casing and stray spaces are noise."""
        assert hash_code("  AbC ") == hash_code("abc")

    def test_different_codes_differ(self):
        assert hash_code("abc") != hash_code("abd")


class TestMatchCode:
    def test_matching_code_returns_tier(self):
        tiers = (_tier("secret", 2),)
        assert match_code("secret", tiers, now=NOW) == tiers[0]

    def test_normalizes_submitted_code(self):
        tiers = (_tier("secret", 2),)
        assert match_code(" SECRET ", tiers, now=NOW) == tiers[0]

    def test_wrong_code_returns_none(self):
        assert match_code("nope", (_tier("secret", 2),), now=NOW) is None

    def test_expired_code_returns_none(self):
        expired = (_tier("secret", 2, expires=NOW - timedelta(seconds=1)),)
        assert match_code("secret", expired, now=NOW) is None

    def test_code_expiring_in_future_still_matches(self):
        live = (_tier("secret", 2, expires=NOW + timedelta(days=1)),)
        assert match_code("secret", live, now=NOW) is not None

    def test_empty_submission_never_matches(self):
        assert match_code("", (_tier("secret", 2),), now=NOW) is None
        assert match_code("   ", (_tier("secret", 2),), now=NOW) is None
        assert match_code(None, (_tier("secret", 2),), now=NOW) is None

    def test_highest_tier_wins_on_duplicate_code(self):
        """A misconfigured config must not silently downgrade a patron."""
        tiers = (_tier("secret", 1), _tier("secret", 3))
        matched = match_code("secret", tiers, now=NOW)
        assert matched is not None and matched.tier_rank == 3

    def test_naive_expiry_is_treated_as_utc(self):
        """JSON round-trips lose tzinfo; a naive datetime must not raise."""
        naive = (
            CodeTier(
                code_sha256=hash_code("secret"),
                tier_rank=1,
                tier_label="L1",
                expires_at=datetime(2026, 8, 4, 12, 0),
            ),
        )
        assert match_code("secret", naive, now=NOW) is not None

    def test_expiry_from_iso_string_is_parsed(self):
        """``config_json`` stores datetimes as ISO strings, not datetimes."""
        tiers = (
            CodeTier(
                code_sha256=hash_code("secret"),
                tier_rank=1,
                tier_label="L1",
                expires_at="2026-08-04T12:00:00+00:00",  # type: ignore[arg-type]
            ),
        )
        assert match_code("secret", tiers, now=NOW) is not None

    def test_expired_iso_string_does_not_match(self):
        tiers = (
            CodeTier(
                code_sha256=hash_code("secret"),
                tier_rank=1,
                tier_label="L1",
                expires_at="2026-08-02T12:00:00+00:00",  # type: ignore[arg-type]
            ),
        )
        assert match_code("secret", tiers, now=NOW) is None


class TestParseCodeTiers:
    def test_reads_rows(self):
        parsed = parse_code_tiers({"codes": [{"code_sha256": "a" * 64, "tier_rank": 2, "tier_label": "L2"}]})
        assert parsed == (CodeTier(code_sha256="a" * 64, tier_rank=2, tier_label="L2", expires_at=None),)

    def test_parses_iso_expiry_into_datetime(self):
        parsed = parse_code_tiers(
            {
                "codes": [
                    {
                        "code_sha256": "a" * 64,
                        "tier_rank": 1,
                        "expires_at": "2026-08-04T12:00:00+00:00",
                    }
                ]
            }
        )
        assert parsed[0].expires_at == datetime(2026, 8, 4, 12, 0, tzinfo=UTC)

    def test_skips_rows_without_hash(self):
        assert parse_code_tiers({"codes": [{"tier_rank": 1}]}) == ()

    def test_skips_rows_with_unparseable_rank(self):
        assert parse_code_tiers({"codes": [{"code_sha256": "x" * 64, "tier_rank": "abc"}]}) == ()

    def test_missing_codes_key_yields_empty(self):
        assert parse_code_tiers({}) == ()

    def test_none_config_yields_empty(self):
        assert parse_code_tiers(None) == ()

    def test_unparseable_expiry_is_treated_as_no_expiry(self):
        """A bad date must not silently expire a live code, nor raise."""
        parsed = parse_code_tiers({"codes": [{"code_sha256": "a" * 64, "tier_rank": 1, "expires_at": "not-a-date"}]})
        assert parsed[0].expires_at is None
