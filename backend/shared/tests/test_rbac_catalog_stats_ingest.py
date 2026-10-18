from shared.rbac import ALL_SCOPE_NAMES, normalize_scopes
from shared.rbac.catalog import PERMISSION_CATALOG, permission_names_for_workspace_role


def test_stats_ingest_is_one_catalog_permission_and_api_key_scope():
    names = [p.name for p in PERMISSION_CATALOG]
    assert names.count("stats.ingest") == 1
    assert "stats:ingest" not in ALL_SCOPE_NAMES
    assert normalize_scopes(["stats.ingest", "stats:ingest"]) == ("stats.ingest",)


def test_stats_ingest_reaches_owner_and_admin_but_not_readers_or_referees():
    assert permission_names_for_workspace_role("owner") == ("admin.*",)
    assert "stats.ingest" in permission_names_for_workspace_role("admin")
    for role in ("referee", "host", "player"):
        assert "stats.ingest" not in permission_names_for_workspace_role(role)
