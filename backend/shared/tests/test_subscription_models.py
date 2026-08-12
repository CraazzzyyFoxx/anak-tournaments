from shared import models


def _uniques(table) -> set[tuple[str, ...]]:
    return {
        tuple(c.name for c in constraint.columns)
        for constraint in table.constraints
        if constraint.__class__.__name__ == "UniqueConstraint"
    }


def _indexes(table) -> set[tuple[str, ...]]:
    return {tuple(c.name for c in index.columns) for index in table.indexes}


class TestProviderConfig:
    def test_lives_in_subscriptions_schema(self):
        assert models.SubscriptionProviderConfig.__table__.schema == "subscriptions"

    def test_workspace_provider_is_unique(self):
        assert ("workspace_id", "provider") in _uniques(models.SubscriptionProviderConfig.__table__)

    def test_workspace_fk_cascades(self):
        fk = next(iter(models.SubscriptionProviderConfig.__table__.c.workspace_id.foreign_keys))
        assert fk.ondelete == "CASCADE"

    def test_enabled_defaults_to_false(self):
        """A newly created config must never silently start enforcing."""
        column = models.SubscriptionProviderConfig.__table__.c.enabled
        assert column.server_default.arg == "false"
        assert column.nullable is False

    def test_config_json_defaults_to_empty_object(self):
        column = models.SubscriptionProviderConfig.__table__.c.config_json
        assert column.server_default.arg == "{}"
        assert column.nullable is False


class TestEntitlement:
    def test_lives_in_subscriptions_schema(self):
        assert models.SubscriptionEntitlement.__table__.schema == "subscriptions"

    def test_one_row_per_workspace_user_provider(self):
        assert ("workspace_id", "auth_user_id", "provider") in _uniques(models.SubscriptionEntitlement.__table__)

    def test_workspace_fk_cascades(self):
        fk = next(iter(models.SubscriptionEntitlement.__table__.c.workspace_id.foreign_keys))
        assert fk.ondelete == "CASCADE"

    def test_auth_user_fk_cascades(self):
        fk = next(iter(models.SubscriptionEntitlement.__table__.c.auth_user_id.foreign_keys))
        assert fk.ondelete == "CASCADE"

    def test_auth_user_fk_targets_auth_schema(self):
        fk = next(iter(models.SubscriptionEntitlement.__table__.c.auth_user_id.foreign_keys))
        assert fk.target_fullname == "auth.user.id"

    def test_state_defaults_to_unknown(self):
        """An unresolved row must read as unknown, which fails open."""
        assert models.SubscriptionEntitlement.__table__.c.state.server_default.arg == "unknown"

    def test_tier_rank_is_nullable(self):
        """An active-but-levelless verdict (base challenge code) has no rank."""
        assert models.SubscriptionEntitlement.__table__.c.tier_rank.nullable is True

    def test_has_index_for_bulk_workspace_reads(self):
        """List views read every registrant's verdict for one workspace+provider."""
        assert ("workspace_id", "provider") in _indexes(models.SubscriptionEntitlement.__table__)

    def test_timestamps_are_timezone_aware(self):
        """Naive timestamps would break TTL comparison against an aware `now`."""
        for name in ("checked_at", "expires_at"):
            assert models.SubscriptionEntitlement.__table__.c[name].type.timezone is True

    def test_evidence_json_is_nullable(self):
        assert models.SubscriptionEntitlement.__table__.c.evidence_json.nullable is True


class TestImportSurface:
    def test_both_models_are_exported_from_shared_models(self):
        """`from shared.models import X` is the established import path."""
        assert hasattr(models, "SubscriptionProviderConfig")
        assert hasattr(models, "SubscriptionEntitlement")

    def test_mappers_configure(self):
        """A broken relationship string only surfaces on configure_mappers()."""
        from sqlalchemy.orm import configure_mappers

        configure_mappers()
