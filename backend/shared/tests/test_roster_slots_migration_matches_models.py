"""Guard ``roster0001`` — the per-tournament roster shape columns — against drift.

The revision adds two nullable JSONB columns (``tournament.roster_slots_json``,
``workspace.default_roster_slots_json``) and nothing else. Both stay ``NULL`` for
every existing row, which the fallback chain in
``shared.domain.roster_shape.resolve_roster_shape`` reads as "inherit", so the
migration needs no backfill to preserve today's 1/2/2 behaviour.

The deliberate omission is the point of half these tests: the revision must NOT
drop ``balancer.draft_session.team_size``. The balancer still reads that column,
and its tests still construct ``DraftSession(..., team_size=...)`` directly.
Dropping it here would leave ``balancer-service/tests`` red for six tasks; the
drop belongs in a later revision, alongside the code that stops writing it.

A metadata check: the models are compiled against the Postgres dialect and the
revision is parsed, so no live database is needed. Not a substitute for applying
the revision — run ``alembic upgrade heads`` against a real database too.
"""

from __future__ import annotations

import ast
import pathlib
import re

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from sqlalchemy.schema import CreateTable

from shared import models

MIGRATION = (
    pathlib.Path(__file__).resolve().parents[2] / "migrations" / "versions" / "roster0001_add_roster_slots.py"
)

TOURNAMENT_COLUMN = "roster_slots_json"
WORKSPACE_COLUMN = "default_roster_slots_json"


def _text() -> str:
    return MIGRATION.read_text(encoding="utf-8")


def _ddl(model) -> str:
    return str(CreateTable(model.__table__).compile(dialect=postgresql.dialect()))


def _function(name: str) -> ast.FunctionDef:
    """The revision's ``upgrade``/``downgrade`` body as an AST node.

    Parsed rather than string-matched because the whole point of
    ``TestUpgradeDropsNothing`` is *which* function a ``drop_column`` sits in —
    ``downgrade`` legitimately has two of them.
    """
    for node in ast.parse(_text()).body:
        if isinstance(node, ast.FunctionDef) and node.name == name:
            return node
    raise AssertionError(f"revision has no {name}()")


def _op_calls(function: str, op_name: str) -> list[ast.Call]:
    return [
        node
        for node in ast.walk(_function(function))
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and node.func.attr == op_name
        and isinstance(node.func.value, ast.Name)
        and node.func.value.id == "op"
    ]


def _schema_of(call: ast.Call) -> str | None:
    for keyword in call.keywords:
        if keyword.arg == "schema":
            return ast.literal_eval(keyword.value)
    return None


def _added_columns(function: str = "upgrade") -> list[tuple[str, str, str | None]]:
    """``(table, column, schema)`` for every ``op.add_column`` in ``function``."""
    described = []
    for call in _op_calls(function, "add_column"):
        table = ast.literal_eval(call.args[0])
        column_call = call.args[1]
        assert isinstance(column_call, ast.Call), "add_column's 2nd arg must be sa.Column(...)"
        described.append((table, ast.literal_eval(column_call.args[0]), _schema_of(call)))
    return described


def _dropped_columns(function: str = "downgrade") -> list[tuple[str, str, str | None]]:
    return [
        (ast.literal_eval(call.args[0]), ast.literal_eval(call.args[1]), _schema_of(call))
        for call in _op_calls(function, "drop_column")
    ]


class TestRevisionWiring:
    def test_migration_is_present(self):
        assert MIGRATION.is_file(), f"missing {MIGRATION}"

    def test_revision_id_matches_the_filename(self):
        match = re.search(r'^revision[^=]*=\s*"([^"]+)"', _text(), re.M)
        assert match, "revision must be a single quoted id"
        assert MIGRATION.name.startswith(f"{match.group(1)}_")

    def test_chains_off_a_committed_revision(self):
        """``down_revision`` must not point at uncommitted local work, or this
        migration dangles for anyone who checks out the commit without it."""
        match = re.search(r'^down_revision[^=]*=\s*"([^"]+)"', _text(), re.M)
        assert match, "down_revision must be a single quoted revision id"
        assert match.group(1) == "catalias0001"


class TestModelColumns:
    def test_tournament_maps_a_nullable_json_column(self):
        column = models.Tournament.__table__.columns[TOURNAMENT_COLUMN]
        assert column.nullable is True, "NULL is the 'inherit from workspace' signal"
        assert isinstance(column.type, sa.JSON)

    def test_workspace_maps_a_nullable_json_column(self):
        column = models.Workspace.__table__.columns[WORKSPACE_COLUMN]
        assert column.nullable is True, "NULL is the 'inherit the built-in default' signal"
        assert isinstance(column.type, sa.JSON)

    def test_both_columns_compile_to_jsonb(self):
        """JSONB, not JSON: admin tournament listings filter on the shape, and
        Postgres ``json`` supports no operator class for that without a cast."""
        assert f"{TOURNAMENT_COLUMN} JSONB" in _ddl(models.Tournament)
        assert f"{WORKSPACE_COLUMN} JSONB" in _ddl(models.Workspace)

    def test_neither_column_is_not_null(self):
        assert f"{TOURNAMENT_COLUMN} JSONB NOT NULL" not in _ddl(models.Tournament)
        assert f"{WORKSPACE_COLUMN} JSONB NOT NULL" not in _ddl(models.Workspace)

    def test_both_columns_share_one_type(self):
        """The resolution chain compares a tournament value against a workspace
        value, so a type split between the two levels would be a latent bug."""
        tournament = models.Tournament.__table__.columns[TOURNAMENT_COLUMN]
        workspace = models.Workspace.__table__.columns[WORKSPACE_COLUMN]
        assert type(tournament.type) is type(workspace.type)


class TestUpgradeAddsExactlyTheModelColumns:
    def test_adds_the_two_columns_into_the_model_schemas(self):
        assert _added_columns() == [
            (models.Tournament.__table__.name, TOURNAMENT_COLUMN, models.Tournament.__table__.schema),
            (models.Workspace.__table__.name, WORKSPACE_COLUMN, models.Workspace.__table__.schema),
        ]

    def test_tournament_lives_in_its_own_schema_and_workspace_in_public(self):
        """Pins the premise of the assertion above: a schema-less ``add_column``
        for ``tournament`` would target ``public.tournament`` and fail."""
        assert models.Tournament.__table__.schema == "tournament"
        assert models.Workspace.__table__.schema is None

    def test_added_columns_are_nullable(self):
        for call in _op_calls("upgrade", "add_column"):
            column_call = call.args[1]
            nullable = [kw for kw in column_call.keywords if kw.arg == "nullable"]
            assert nullable, "sa.Column must state nullable explicitly"
            assert ast.literal_eval(nullable[0].value) is True

    def test_added_columns_have_no_server_default(self):
        """An empty-map default would make "no override" indistinguishable from
        "a roster with zero slots"; NULL has to stay the only inherit signal."""
        for call in _op_calls("upgrade", "add_column"):
            args = {kw.arg for kw in call.args[1].keywords}
            assert "server_default" not in args


class TestUpgradeDropsNothing:
    """``upgrade`` must be purely additive.

    ``balancer.draft_session.team_size`` is the column this whole feature
    eventually replaces, and it is tempting to drop it in the same revision.
    It must not happen here: the balancer keeps reading and writing
    ``team_size`` for several more tasks, so an early drop turns
    ``balancer-service/tests`` red across all of them. The drop gets its own
    revision, landed with the code change that stops using the column.
    """

    def test_upgrade_has_no_drop_column(self):
        assert _dropped_columns("upgrade") == []

    def test_upgrade_drops_nothing_at_all(self):
        for op_name in ("drop_column", "drop_table", "drop_constraint", "drop_index"):
            assert _op_calls("upgrade", op_name) == [], f"upgrade must not call op.{op_name}"


class TestDowngradeIsSymmetric:
    def test_drops_exactly_the_two_added_columns(self):
        added = {(table, column, schema) for table, column, schema in _added_columns()}
        assert {(table, column, schema) for table, column, schema in _dropped_columns()} == added

    def test_drops_nothing_else(self):
        assert len(_dropped_columns()) == 2


class TestTeamSizeSurvives:
    """This task must not touch ``DraftSession.team_size``.

    Deliberately inverted later: the task that teaches the balancer to read the
    roster shape instead will delete this column and flip this assertion to
    ``not in``. If you are reading this because the assertion failed, check
    whether that task landed before assuming the test rotted.
    """

    def test_draft_session_still_maps_team_size(self):
        assert "team_size" in models.DraftSession.__table__.columns

    def test_the_revision_never_touches_the_column(self):
        """Checked against the DDL calls, not the source text: the docstring
        deliberately *does* mention ``team_size`` to explain why it survives."""
        for function in ("upgrade", "downgrade"):
            literals = {
                node.value
                for node in ast.walk(_function(function))
                if isinstance(node, ast.Constant) and isinstance(node.value, str)
            }
            assert "team_size" not in literals
            assert "draft_session" not in literals
            assert "balancer" not in literals
