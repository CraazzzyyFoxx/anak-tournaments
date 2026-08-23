"""The Go gateway's raw SQL must stay in sync with the SQLAlchemy models.

``gateway/internal/workspace/workspace.go`` answers the WebSocket topic ACL with
hand-written SQL against the shared database. Those strings are invisible to
SQLAlchemy, so a schema refactor on the Python side does not break them at build
time — it breaks them in production.

That is exactly what happened: the identity/workspace refactor (iwrefac07)
replaced ``workspace_member.auth_user_id`` with ``player_id``, the Python
repository grew a bridge join through ``players."user"``, and the gateway's
``isMemberSQL`` was left behind. Every gated subscribe then failed with
``column "auth_user_id" does not exist (SQLSTATE 42703)`` and answered
``internal_error`` to the client.

This test pins each (table, column) the gateway depends on and asserts (a) the
column still exists in the models, and (b) the gateway still references it — so
dropping a column, or quietly rewriting the SQL, fails here instead of at
runtime.
"""

from __future__ import annotations

from pathlib import Path
from unittest import TestCase

from shared.core import db  # noqa: F401  (registers metadata)
from shared.models import *  # noqa: F401,F403  (import every model into the registry)

_GATEWAY_SQL_FILE = Path(__file__).resolve().parents[3] / "gateway" / "internal" / "workspace" / "workspace.go"

# (schema, table, column) triples the gateway reads, and the SQL identifier it
# uses for the column (bare name — the gateway aliases tables, not columns).
_GATEWAY_COLUMN_DEPENDENCIES: tuple[tuple[str | None, str, str], ...] = (
    ("tournament", "tournament", "workspace_id"),
    ("tournament", "tournament", "is_hidden"),
    (None, "workspace_member", "player_id"),
    (None, "workspace_member", "workspace_id"),
    ("players", "user", "auth_user_id"),
    (None, "workspace", "custom_domain"),
    (None, "workspace", "custom_domain_verified_at"),
    (None, "workspace", "is_hidden"),
    ("tournament", "tournament_preview_access", "tournament_id"),
    ("tournament", "tournament_preview_access", "auth_user_id"),
    ("tournament", "encounter", "tournament_id"),
)


class GatewayRawSQLMatchesModelsTests(TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.sql = _GATEWAY_SQL_FILE.read_text(encoding="utf-8")
        cls.tables = db.Base.metadata.tables

    def _table(self, schema: str | None, name: str):
        key = f"{schema}.{name}" if schema else name
        self.assertIn(
            key,
            self.tables,
            msg=f"gateway queries {key}, which is not a mapped table — update workspace.go",
        )
        return self.tables[key]

    def test_gateway_file_is_where_this_test_expects(self) -> None:
        self.assertTrue(_GATEWAY_SQL_FILE.is_file(), msg=f"{_GATEWAY_SQL_FILE} moved; update this test")

    def test_every_column_the_gateway_reads_exists_in_the_models(self) -> None:
        for schema, table_name, column in _GATEWAY_COLUMN_DEPENDENCIES:
            with self.subTest(table=table_name, column=column):
                table = self._table(schema, table_name)
                self.assertIn(
                    column,
                    table.c,
                    msg=(
                        f"{table_name}.{column} no longer exists but gateway/internal/workspace/workspace.go "
                        "still selects it; the WS ACL will fail with SQLSTATE 42703"
                    ),
                )

    def test_gateway_still_references_every_pinned_column(self) -> None:
        for _schema, table_name, column in _GATEWAY_COLUMN_DEPENDENCIES:
            with self.subTest(table=table_name, column=column):
                self.assertIn(
                    column,
                    self.sql,
                    msg=(
                        f"workspace.go no longer mentions {column}; if the query legitimately changed, "
                        "update _GATEWAY_COLUMN_DEPENDENCIES so this test keeps guarding the real schema"
                    ),
                )

    def test_membership_lookup_bridges_through_the_player_identity(self) -> None:
        """The regression itself: membership must not key off workspace_member.auth_user_id."""
        membership = self.sql.split("isMemberSQL", 1)[1].split("`", 2)[1]
        normalized = " ".join(membership.split())
        self.assertIn('JOIN players."user"', normalized, msg=normalized)
        self.assertIn("u.id = wm.player_id", normalized, msg=normalized)
        self.assertIn("u.auth_user_id = $1", normalized, msg=normalized)
        self.assertNotIn("wm.auth_user_id", normalized, msg=normalized)

    def test_tournament_hidden_lookup_cascades_the_owning_workspace(self) -> None:
        """A tournament with its own is_hidden=False must still read hidden when
        its workspace is -- the OR is the whole cascade, no second cached call."""
        hidden = self.sql.split("tournamentHiddenSQL", 1)[1].split("`", 2)[1]
        normalized = " ".join(hidden.split())
        self.assertIn("t.is_hidden OR w.is_hidden", normalized, msg=normalized)
        self.assertIn("JOIN workspace w ON w.id = t.workspace_id", normalized, msg=normalized)
