from shared.subscriptions.discord_roles import RoleTier, parse_role_tiers, resolve_role_tier

TIERS = (
    RoleTier(role_id="100", tier_rank=1, tier_label="Уровень 1"),
    RoleTier(role_id="200", tier_rank=2, tier_label="Уровень 2"),
    RoleTier(role_id="300", tier_rank=3, tier_label="Уровень 3"),
)


class TestResolveRoleTier:
    def test_single_matching_role(self):
        assert resolve_role_tier(["200"], TIERS) == TIERS[1]

    def test_highest_tier_wins_when_several_roles_match(self):
        """Boosty leaves lower-level roles in place when a patron upgrades."""
        assert resolve_role_tier(["100", "300", "200"], TIERS) == TIERS[2]

    def test_no_matching_role_returns_none(self):
        assert resolve_role_tier(["999"], TIERS) is None

    def test_empty_roles_returns_none(self):
        assert resolve_role_tier([], TIERS) is None

    def test_empty_mapping_returns_none(self):
        assert resolve_role_tier(["100"], ()) is None

    def test_role_ids_compared_as_strings_not_ints(self):
        """Discord snowflakes exceed 2**53; they must never round-trip via float."""
        big = "1234567890123456789"
        tiers = (RoleTier(role_id=big, tier_rank=1, tier_label="L1"),)
        assert resolve_role_tier([big], tiers) == tiers[0]

    def test_accepts_integer_role_ids_from_discord_client(self):
        """discord.py exposes Role.id as int; comparison must still work."""
        assert resolve_role_tier([200], TIERS) == TIERS[1]


class TestParseRoleTiers:
    def test_reads_rows(self):
        parsed = parse_role_tiers({"role_tiers": [{"role_id": "100", "tier_rank": 1, "tier_label": "L1"}]})
        assert parsed == (RoleTier(role_id="100", tier_rank=1, tier_label="L1"),)

    def test_coerces_integer_role_id_to_string(self):
        parsed = parse_role_tiers({"role_tiers": [{"role_id": 100, "tier_rank": 1}]})
        assert parsed[0].role_id == "100"

    def test_skips_rows_without_role_id(self):
        assert parse_role_tiers({"role_tiers": [{"tier_rank": 1}]}) == ()

    def test_skips_rows_with_unparseable_rank(self):
        assert parse_role_tiers({"role_tiers": [{"role_id": "100", "tier_rank": "abc"}]}) == ()

    def test_missing_key_yields_empty(self):
        assert parse_role_tiers({}) == ()

    def test_none_config_yields_empty(self):
        assert parse_role_tiers(None) == ()
