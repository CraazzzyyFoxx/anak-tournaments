"""Fold SHAP into performance, drop dead analytics tables, add uniques.

Revision ID: anlcln01
Revises: mrank02
Create Date: 2026-08-25 00:00:00.000000

* ``analytics.performance.contributions`` / ``base_value`` take over
  ``analytics.explanation`` (entity_kind was only ever ``player``).
* ``analytics.ml_features`` had no writers — feature cache is pickle files.
* ``analytics.match_quality.anomaly_flags`` was a copy of ``player_anomaly``.
* Unique on ``player_shift (tournament_id, player_id)`` and
  ``shifts (tournament_id, player_id, algorithm_id)``.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "anlcln01"
down_revision: str | Sequence[str] | None = "mrank02"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("performance", sa.Column("contributions", sa.JSON(), nullable=True), schema="analytics")
    op.add_column("performance", sa.Column("base_value", sa.Float(), nullable=True), schema="analytics")

    op.execute(
        sa.text(
            """
            UPDATE analytics.performance AS p
            SET contributions = e.contributions,
                base_value = e.base_value
            FROM (
                SELECT DISTINCT ON (tournament_id, entity_id, algorithm_id)
                    tournament_id, entity_id, algorithm_id, contributions, base_value
                FROM analytics.explanation
                WHERE entity_kind = 'player'
                ORDER BY tournament_id, entity_id, algorithm_id, created_at DESC
            ) AS e
            WHERE e.entity_id = p.player_id
              AND e.tournament_id = p.tournament_id
              AND e.algorithm_id = p.algorithm_id
            """
        )
    )
    op.execute(
        sa.text(
            """
            UPDATE analytics.performance
            SET contributions = top_features
            WHERE contributions IS NULL AND top_features IS NOT NULL
            """
        )
    )
    op.drop_column("performance", "top_features", schema="analytics")
    op.drop_table("explanation", schema="analytics")
    op.drop_table("ml_features", schema="analytics")
    op.drop_column("match_quality", "anomaly_flags", schema="analytics")

    op.execute(
        sa.text(
            """
            DELETE FROM analytics.player_shift AS a
            USING analytics.player_shift AS b
            WHERE a.tournament_id = b.tournament_id
              AND a.player_id = b.player_id
              AND a.id < b.id
            """
        )
    )
    op.create_unique_constraint(
        "uq_analytics_player_shift",
        "player_shift",
        ["tournament_id", "player_id"],
        schema="analytics",
    )

    op.execute(
        sa.text(
            """
            DELETE FROM analytics.shifts AS a
            USING analytics.shifts AS b
            WHERE a.tournament_id = b.tournament_id
              AND a.player_id = b.player_id
              AND a.algorithm_id = b.algorithm_id
              AND a.id < b.id
            """
        )
    )
    op.create_unique_constraint(
        "uq_analytics_shifts",
        "shifts",
        ["tournament_id", "player_id", "algorithm_id"],
        schema="analytics",
    )


def downgrade() -> None:
    op.drop_constraint("uq_analytics_shifts", "shifts", schema="analytics", type_="unique")
    op.drop_constraint("uq_analytics_player_shift", "player_shift", schema="analytics", type_="unique")

    op.add_column("match_quality", sa.Column("anomaly_flags", sa.JSON(), nullable=True), schema="analytics")

    op.create_table(
        "ml_features",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("tournament_id", sa.BigInteger(), nullable=False),
        sa.Column("granularity", sa.String(length=16), nullable=False),
        sa.Column("entity_id", sa.Integer(), nullable=False),
        sa.Column("feature_version", sa.String(length=32), nullable=False),
        sa.Column("features", sa.JSON(), nullable=False),
        sa.Column("log_coverage", sa.Float(), server_default="0", nullable=False),
        sa.ForeignKeyConstraint(["tournament_id"], ["tournament.tournament.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "tournament_id", "granularity", "entity_id", "feature_version", name="uq_analytics_ml_features"
        ),
        schema="analytics",
    )
    op.create_index("ix_analytics_ml_features_entity_id", "ml_features", ["entity_id"], schema="analytics")
    op.create_index("ix_analytics_ml_features_granularity", "ml_features", ["granularity"], schema="analytics")
    op.create_index("ix_analytics_ml_features_tournament_id", "ml_features", ["tournament_id"], schema="analytics")

    op.create_table(
        "explanation",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("algorithm_id", sa.BigInteger(), nullable=False),
        sa.Column("entity_id", sa.Integer(), nullable=False),
        sa.Column("entity_kind", sa.String(length=16), nullable=False),
        sa.Column("tournament_id", sa.BigInteger(), nullable=False),
        sa.Column("base_value", sa.Float(), nullable=False),
        sa.Column("contributions", sa.JSON(), nullable=False),
        sa.ForeignKeyConstraint(["algorithm_id"], ["analytics.algorithms.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tournament_id"], ["tournament.tournament.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        schema="analytics",
    )
    op.create_index("ix_analytics_explanation_algorithm_id", "explanation", ["algorithm_id"], schema="analytics")
    op.create_index("ix_analytics_explanation_entity_id", "explanation", ["entity_id"], schema="analytics")
    op.create_index("ix_analytics_explanation_entity_kind", "explanation", ["entity_kind"], schema="analytics")
    op.create_index("ix_analytics_explanation_tournament_id", "explanation", ["tournament_id"], schema="analytics")

    op.add_column("performance", sa.Column("top_features", sa.JSON(), nullable=True), schema="analytics")
    op.execute(
        sa.text(
            """
            UPDATE analytics.performance
            SET top_features = contributions
            WHERE contributions IS NOT NULL
            """
        )
    )
    op.execute(
        sa.text(
            """
            INSERT INTO analytics.explanation (
                tournament_id, algorithm_id, entity_id, entity_kind, base_value, contributions
            )
            SELECT tournament_id, algorithm_id, player_id, 'player',
                   COALESCE(base_value, 0), contributions
            FROM analytics.performance
            WHERE contributions IS NOT NULL
            """
        )
    )
    op.drop_column("performance", "base_value", schema="analytics")
    op.drop_column("performance", "contributions", schema="analytics")
