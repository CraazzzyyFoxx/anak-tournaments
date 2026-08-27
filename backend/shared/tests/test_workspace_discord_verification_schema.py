"""Pin the DDL ``Workspace`` gains for self-service Discord-guild verification
and per-user create-limit accounting (workspace self-service design,
``docs/superpowers/specs/2026-08-26-workspace-self-service-design.md`` §4.1/§4.2/§4.4).

* ``discord_guild_id`` becomes UNIQUE — a guild claimed by one workspace can
  no longer be claimed by a second (previously: plain nullable string, no
  uniqueness at all).
* ``discord_guild_verified_at``/``discord_guild_verified_by_auth_user_id``
  record *who* proved ownership and *when* — same audit shape as
  ``custom_domain_verified_at``.
* ``owner_id`` is a plain FK to ``auth.user``, decoupled from the RBAC
  ``owner`` role: it answers "who created this workspace", not "who currently
  holds owner permissions" — see the design's Decision Log for why the two
  must not be conflated.

This is a metadata check, not a substitute for applying the schema: run the
migration against a real database too.
"""

from __future__ import annotations

from shared import models

TABLE = models.Workspace.__table__


def test_discord_guild_id_is_unique():
    assert TABLE.columns["discord_guild_id"].unique is True


def test_discord_guild_verification_columns_exist_and_are_nullable():
    for name in ("discord_guild_verified_at", "discord_guild_verified_by_auth_user_id"):
        assert name in TABLE.columns
        assert TABLE.columns[name].nullable is True


def test_discord_guild_verified_by_fk_targets_auth_user_set_null():
    (fk,) = TABLE.columns["discord_guild_verified_by_auth_user_id"].foreign_keys
    assert fk.target_fullname == "auth.user.id"
    assert fk.ondelete == "SET NULL"


def test_owner_id_exists_nullable_indexed():
    assert "owner_id" in TABLE.columns
    assert TABLE.columns["owner_id"].nullable is True
    indexed_columns = {col.name for index in TABLE.indexes for col in index.columns}
    assert "owner_id" in indexed_columns


def test_owner_id_fk_targets_auth_user_set_null():
    (fk,) = TABLE.columns["owner_id"].foreign_keys
    assert fk.target_fullname == "auth.user.id"
    assert fk.ondelete == "SET NULL"


def test_owner_id_is_decoupled_from_rbac_no_unique_no_role_reference():
    """A workspace's ``owner_id`` is a plain accountability stamp, not a
    permission grant — it must not carry a uniqueness constraint (nothing
    stops the *same* auth user owning several workspaces below the cap) and
    must not be confused with ``auth.roles``/``auth.user_roles`` at the
    schema level.
    """
    assert TABLE.columns["owner_id"].unique is not True
