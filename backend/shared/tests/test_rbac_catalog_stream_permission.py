from shared.rbac.catalog import CRUD, PERMISSION_CATALOG, permission_names_for_workspace_role


def test_tournament_link_crud_and_stream_verbs_are_in_the_catalog():
    pairs = {(p.resource, p.action) for p in PERMISSION_CATALOG}
    for action in CRUD:
        assert ("tournament_link", action) in pairs
    assert ("stream", "read") in pairs
    assert ("stream", "update") in pairs


def test_workspace_admin_role_grants_tournament_link_and_stream():
    # `owner` is the `admin.*` wildcard, so it needs no explicit entry; `admin` is an
    # enumerated grant list and would 403 on the links/streams tabs without the entries.
    admin = permission_names_for_workspace_role("admin")
    for action in CRUD:
        assert f"tournament_link.{action}" in admin
    assert "stream.read" in admin
    assert "stream.update" in admin
    assert permission_names_for_workspace_role("owner") == ("admin.*",)


def test_member_reads_links_only_and_player_gets_nothing():
    # Links are part of the public tournament page, so `member` reads them like any
    # other tournament child. Writes stay admin-only, and stream.read is poller
    # health -- an operational signal, not tournament content (same call as rank /
    # subscription / audit, which are also absent from _MEMBER_READ_RESOURCES).
    member = permission_names_for_workspace_role("member")
    assert "tournament_link.read" in member
    assert "tournament_link.create" not in member
    assert "tournament_link.update" not in member
    assert "tournament_link.delete" not in member
    assert "stream.read" not in member
    assert "stream.update" not in member
    assert permission_names_for_workspace_role("player") == ()
