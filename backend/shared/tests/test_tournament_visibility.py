"""Unit tests for the hidden-tournament visibility rule (pure, no DB).

Full matrix: not-hidden / hidden+anon / hidden+superuser / hidden+ws-admin /
hidden+admin-of-other-ws / hidden+allowlisted / hidden+non-allowlisted.
Mirrors the in-memory AuthUser style of test_auth_user_workspace_deny.py.
"""

from shared.models.identity.auth_user import AuthUser
from shared.models.tournament.tournament import Tournament
from shared.services.tournament.visibility import (
    admin_visible_workspace_ids,
    can_view_tournament,
    can_view_workspace_tournaments,
    visible_tournament_ids_subquery,
    visible_tournaments_predicate,
)


def _tournament(is_hidden: bool, workspace_id: int = 1) -> Tournament:
    t = Tournament()
    t.id = 100
    t.workspace_id = workspace_id
    t.is_hidden = is_hidden
    return t


def _user(
    user_id: int, *, superuser: bool = False, ws_admin: list[int] | None = None, member_of: list[int] | None = None
) -> AuthUser:
    u = AuthUser()
    u.id = user_id
    u.is_superuser = superuser
    u.is_active = True
    ws_admin = ws_admin or []
    # A member without admin rights: membership (workspaces=) and admin rbac
    # (workspace_rbac=) are independent caches -- admin workspaces are always
    # also members, but member_of lets a test add plain membership on top.
    workspaces = sorted(set(ws_admin) | set(member_of or []))
    ws_rbac = {ws: {"roles": [], "permissions": [{"resource": "*", "action": "*"}]} for ws in ws_admin}
    u.set_rbac_cache(
        role_names=[],
        permissions=[],
        workspaces=[{"workspace_id": w} for w in workspaces],
        workspace_rbac=ws_rbac,
    )
    return u


def test_not_hidden_visible_to_everyone():
    assert can_view_tournament(None, _tournament(False), set()) is True
    assert can_view_tournament(_user(5), _tournament(False), set()) is True


def test_hidden_hidden_from_anonymous():
    assert can_view_tournament(None, _tournament(True), set()) is False


def test_hidden_visible_to_superuser():
    assert can_view_tournament(_user(5, superuser=True), _tournament(True), set()) is True


def test_hidden_visible_to_workspace_admin():
    assert can_view_tournament(_user(5, ws_admin=[1]), _tournament(True, workspace_id=1), set()) is True


def test_hidden_visible_to_workspace_role_admin_and_owner():
    u_admin = AuthUser()
    u_admin.id = 10
    u_admin.set_rbac_cache(
        role_names=[],
        permissions=[],
        workspaces=[{"workspace_id": 1}],
        workspace_rbac={1: {"roles": ["admin"], "permissions": []}},
    )
    assert can_view_tournament(u_admin, _tournament(True, workspace_id=1), set()) is True
    assert admin_visible_workspace_ids(u_admin) == [1]

    u_owner = AuthUser()
    u_owner.id = 11
    u_owner.set_rbac_cache(
        role_names=[],
        permissions=[],
        workspaces=[{"workspace_id": 1}],
        workspace_rbac={1: {"roles": ["owner"], "permissions": []}},
    )
    assert can_view_tournament(u_owner, _tournament(True, workspace_id=1), set()) is True
    assert admin_visible_workspace_ids(u_owner) == [1]


def test_hidden_not_visible_to_admin_of_other_workspace():
    assert can_view_tournament(_user(5, ws_admin=[2]), _tournament(True, workspace_id=1), set()) is False


def test_hidden_visible_to_allowlisted_user():
    assert can_view_tournament(_user(7), _tournament(True), {7}) is True


def test_hidden_not_visible_to_non_allowlisted_logged_in_user():
    assert can_view_tournament(_user(9), _tournament(True), {7}) is False


def test_visible_ids_subquery_excludes_hidden_for_anonymous():
    # The cross-tournament browse/aggregate filter (encounters/matches/teams/
    # stats) reduces to "non-hidden tournaments" for user=None.
    sql = str(visible_tournament_ids_subquery(None).compile(compile_kwargs={"literal_binds": True})).lower()
    assert "is_hidden" in sql
    assert "false" in sql


def test_admin_visible_workspace_ids_filters_to_admin_only():
    # Member of ws 1 (admin) and ws 2 (no wildcard) -> only 1 is admin-visible.
    u = AuthUser()
    u.id = 5
    u.is_superuser = False
    u.set_rbac_cache(
        role_names=[],
        permissions=[],
        workspaces=[{"workspace_id": 1}, {"workspace_id": 2}],
        workspace_rbac={
            1: {"roles": [], "permissions": [{"resource": "*", "action": "*"}]},
            2: {"roles": [], "permissions": []},
        },
    )
    assert admin_visible_workspace_ids(u) == [1]


# ── workspace-cascade dimension: independent of the tournament's own is_hidden
# (see module docstring). A tournament with is_hidden=False can still be gated
# because its WORKSPACE is hidden -- any member (not just admins) sees it.


def test_workspace_not_hidden_is_visible_to_everyone():
    assert can_view_workspace_tournaments(None, 1, False) is True
    assert can_view_workspace_tournaments(_user(5), 1, False) is True


def test_workspace_hidden_is_hidden_from_anonymous():
    assert can_view_workspace_tournaments(None, 1, True) is False


def test_workspace_hidden_is_hidden_from_a_non_member():
    assert can_view_workspace_tournaments(_user(5, member_of=[2]), 1, True) is False


def test_workspace_hidden_is_visible_to_a_plain_member():
    # No admin role required -- unlike can_view_tournament's own is_hidden rule.
    assert can_view_workspace_tournaments(_user(5, member_of=[1]), 1, True) is True


def test_workspace_hidden_is_visible_to_superuser():
    assert can_view_workspace_tournaments(_user(5, superuser=True), 1, True) is True


def test_visible_tournaments_predicate_excludes_hidden_workspace_for_anonymous():
    sql = str(visible_tournaments_predicate(None).compile(compile_kwargs={"literal_binds": True})).lower()
    assert "workspace" in sql
    assert "is_hidden" in sql


def test_visible_tournaments_predicate_lets_a_member_back_in():
    # A member's own hidden-workspace id must be excluded from the excluded
    # set: "hidden workspaces the viewer is NOT already a member of".
    sql = str(
        visible_tournaments_predicate(_user(5, member_of=[1])).compile(compile_kwargs={"literal_binds": True})
    ).lower()
    assert "workspace.is_hidden is true and (workspace.id not in (1))" in sql


def test_visible_tournaments_predicate_is_unfiltered_for_superuser():
    assert str(visible_tournaments_predicate(_user(5, superuser=True))) == "true"
