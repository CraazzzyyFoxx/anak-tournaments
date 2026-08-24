from shared.services.subscriptions.types import SubscriptionSource
from shared.services.subscriptions.verification import (
    VerificationMethod,
    accepts_code,
    accepts_live,
    accepts_source,
    normalize_verification_method,
    parse_verification_method,
)

LIVE = VerificationMethod.LIVE
CODE = VerificationMethod.CODE
ANY = VerificationMethod.ANY


class TestNormalize:
    def test_known_methods_pass_through(self):
        assert normalize_verification_method("live") == LIVE
        assert normalize_verification_method("code") == CODE
        assert normalize_verification_method("any") == ANY

    def test_case_and_whitespace_are_forgiven(self):
        assert normalize_verification_method("  LIVE ") == LIVE

    def test_unknown_value_widens_to_any(self):
        """A typo must never lock a whole tournament out of registering."""
        assert normalize_verification_method("discord_role") == ANY
        assert normalize_verification_method("both") == ANY

    def test_missing_value_widens_to_any(self):
        assert normalize_verification_method(None) == ANY
        assert normalize_verification_method("") == ANY


class TestParse:
    def test_reads_the_field(self):
        assert parse_verification_method({"verification_method": "code"}) == CODE

    def test_config_written_before_the_field_existed_keeps_todays_behaviour(self):
        assert parse_verification_method({"guild_id": "1"}) == ANY

    def test_none_config(self):
        assert parse_verification_method(None) == ANY


class TestAcceptsCode:
    def test_code_only_accepts_codes(self):
        assert accepts_code(CODE) is True

    def test_any_accepts_codes(self):
        assert accepts_code(ANY) is True

    def test_live_only_refuses_codes(self):
        assert accepts_code(LIVE) is False


class TestAcceptsLive:
    def test_live_only_polls(self):
        assert accepts_live(LIVE) is True

    def test_any_polls(self):
        assert accepts_live(ANY) is True

    def test_code_only_never_polls(self):
        """The point of code-only: no Discord/Twitch call is made at all."""
        assert accepts_live(CODE) is False


class TestAcceptsSource:
    def test_any_accepts_every_source(self):
        for source in (
            SubscriptionSource.CHALLENGE_CODE,
            SubscriptionSource.DISCORD_ROLE,
            SubscriptionSource.TWITCH_HELIX,
            None,
        ):
            assert accepts_source(ANY, source) is True

    def test_live_only_discards_a_stored_code(self):
        """Switching to roles must revoke yesterday's redeemed code, which is
        otherwise never re-polled and would outlive the decision."""
        assert accepts_source(LIVE, SubscriptionSource.CHALLENGE_CODE) is False

    def test_live_only_keeps_both_live_signals(self):
        assert accepts_source(LIVE, SubscriptionSource.DISCORD_ROLE) is True
        assert accepts_source(LIVE, SubscriptionSource.TWITCH_HELIX) is True

    def test_code_only_discards_a_stored_role_verdict(self):
        assert accepts_source(CODE, SubscriptionSource.DISCORD_ROLE) is False
        assert accepts_source(CODE, SubscriptionSource.TWITCH_HELIX) is False

    def test_code_only_keeps_a_stored_code(self):
        assert accepts_source(CODE, SubscriptionSource.CHALLENGE_CODE) is True

    def test_an_unknown_future_source_counts_as_live(self):
        """A new provider must not have to register itself here."""
        assert accepts_source(LIVE, "patreon_api") is True
        assert accepts_source(CODE, "patreon_api") is False

    def test_a_null_source_counts_as_live(self):
        """Legacy rows of unknown origin: only an explicit code-only restriction
        discards them."""
        assert accepts_source(LIVE, None) is True
        assert accepts_source(CODE, None) is False
