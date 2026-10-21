"""A match stores its game mode: ``stats.match.mode_entity_id`` and ``encounter.game.mode_id``.

Revision ID: matchmode01
Revises: statrec01
Create Date: 2026-10-21 00:00:00.000000

Deadlock plays Street Brawl and the normal mode on the same map, so the map's catalog parent cannot name a match's
mode. Both columns are twins of the map ones (kind constant + check + composite FK, ``RESTRICT``); existing rows are
backfilled from their map's parent where that parent is a ``mode``, which is exactly what reads derived until now.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "matchmode01"
down_revision: str | Sequence[str] | None = "statrec01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE stats.match
          ADD COLUMN mode_entity_id BIGINT,
          ADD COLUMN mode_kind VARCHAR(16) NOT NULL DEFAULT 'mode'
            CONSTRAINT ck_stats_match_mode_kind CHECK (mode_kind = 'mode'),
          ADD CONSTRAINT fk_match_mode FOREIGN KEY (mode_entity_id, discipline, mode_kind)
            REFERENCES catalog.entity (id, discipline, kind) ON DELETE RESTRICT
        """
    )
    op.execute(
        """
        ALTER TABLE encounter.game
          ADD COLUMN mode_id BIGINT,
          ADD COLUMN mode_kind VARCHAR(16) NOT NULL DEFAULT 'mode' CONSTRAINT ck_game_mode_kind CHECK (mode_kind = 'mode'),
          ADD CONSTRAINT fk_game_mode FOREIGN KEY (mode_id, mode_kind) REFERENCES catalog.entity (id, kind)
            ON DELETE RESTRICT
        """
    )
    op.execute("CREATE INDEX ix_game_mode_id ON encounter.game (mode_id)")
    op.execute(
        """
        UPDATE stats.match m SET mode_entity_id = mp.parent_id
          FROM catalog.entity mp JOIN catalog.entity p ON p.id = mp.parent_id AND p.kind = 'mode'
         WHERE mp.id = m.map_entity_id
        """
    )
    op.execute(
        """
        UPDATE encounter.game g SET mode_id = mp.parent_id
          FROM catalog.entity mp JOIN catalog.entity p ON p.id = mp.parent_id AND p.kind = 'mode'
         WHERE mp.id = g.map_id
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX encounter.ix_game_mode_id")
    op.execute("ALTER TABLE encounter.game DROP CONSTRAINT fk_game_mode, DROP COLUMN mode_kind, DROP COLUMN mode_id")
    op.execute(
        "ALTER TABLE stats.match DROP CONSTRAINT fk_match_mode, DROP COLUMN mode_kind, DROP COLUMN mode_entity_id"
    )
