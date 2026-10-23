"""Every division grid tier stores its number on its game's native ladder.

Revision ID: canonical01
Revises: mixban02
Create Date: 2026-10-23 00:00:00.000000

Expand plus backfill: ``division_grid_tier.canonical_number`` (nullable), computed for every existing tier per grid
version by ``shared.division_grid.stamp_canonical_numbers`` — the same rule every tier writer applies from here on.
NULL for a game without a native ladder.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Sequence
from types import SimpleNamespace

import sqlalchemy as sa
from alembic import op

from shared.division_grid import stamp_canonical_numbers

revision: str = "canonical01"
down_revision: str | Sequence[str] | None = "mixban02"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("division_grid_tier", sa.Column("canonical_number", sa.BigInteger(), nullable=True))
    bind = op.get_bind()
    versions: dict[int, list[SimpleNamespace]] = defaultdict(list)
    disciplines: dict[int, str] = {}
    for row in bind.execute(
        sa.text(
            "SELECT t.id, t.version_id, g.discipline, t.number, t.rank_min, t.rank_max, "
            "t.native_rank_min, t.native_rank_max "
            "FROM division_grid_tier t "
            "JOIN division_grid_version v ON v.id = t.version_id "
            "JOIN division_grid g ON g.id = v.grid_id"
        )
    ).mappings():
        versions[row["version_id"]].append(SimpleNamespace(**row))
        disciplines[row["version_id"]] = row["discipline"]
    updates = []
    for version_id, tiers in versions.items():
        stamp_canonical_numbers(tiers, disciplines[version_id])
        updates.extend({"id": tier.id, "canonical_number": tier.canonical_number} for tier in tiers)
    if updates:
        bind.execute(
            sa.text("UPDATE division_grid_tier SET canonical_number = :canonical_number WHERE id = :id"), updates
        )


def downgrade() -> None:
    op.drop_column("division_grid_tier", "canonical_number")
