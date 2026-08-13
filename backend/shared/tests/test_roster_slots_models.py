"""Pin the per-tournament roster shape columns against drift.

Two nullable JSONB columns carry the shape (``tournament.roster_slots_json``,
``workspace.default_roster_slots_json``). NULL is the "inherit" signal that the
fallback chain in ``shared.domain.roster_shape.resolve_roster_shape`` reads, so
neither column may ever gain a NOT NULL or a server default, and both must
compile to the same type -- the resolution chain compares a tournament value
against a workspace value.

The other half of the story is the scalar this shape replaced:
``balancer.draft_session.team_size`` is gone, while ``rounds`` -- per-session
state, not a second copy of the shape -- survives. ``TestTeamSizeIsGone`` guards
that pair.

These tests compile the models against the Postgres dialect. The assertions that
parsed the ``roster0001``/``roster0002`` revision files -- their ``op.add_column``
and ``op.drop_column`` calls, the downgrade backfill -- went away with the
``initial_v6`` squash, which replaced every per-revision file with one generated
baseline.
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from sqlalchemy.schema import CreateTable

from shared import models

TOURNAMENT_COLUMN = "roster_slots_json"
WORKSPACE_COLUMN = "default_roster_slots_json"


def _ddl(model) -> str:
    return str(CreateTable(model.__table__).compile(dialect=postgresql.dialect()))


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


class TestSchemaPlacement:
    def test_tournament_lives_in_its_own_schema_and_workspace_in_public(self):
        """Pins the premise of the assertion above: a schema-less ``add_column``
        for ``tournament`` would target ``public.tournament`` and fail."""
        assert models.Tournament.__table__.schema == "tournament"
        assert models.Workspace.__table__.schema is None


class TestTeamSizeIsGone:
    """The inversion ``TestTeamSizeSurvives`` announced.

    The balancer no longer reads or writes ``balancer.draft_session.team_size``:
    a draft's size is resolved from the roster shape and ``rounds`` is derived
    from it. Two answers to "how big is a team here" is exactly the mirroring
    this feature removes, so the column and the mapped attribute both go.
    """

    def test_draft_session_no_longer_maps_team_size(self):
        assert "team_size" not in models.DraftSession.__table__.columns

    def test_the_rounds_column_survives(self):
        """``rounds`` is per-session state (the pick grid is built from it), not a
        second copy of the shape, so the drop must not take it along."""
        assert "rounds" in models.DraftSession.__table__.columns
