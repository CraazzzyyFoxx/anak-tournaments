"""Drop the ``parser.rank_mapping`` override: every Overwatch ``rank_value`` is the ladder's again.

Revision ID: owmapdrop01
Revises: matchmode01
Create Date: 2026-10-21 00:00:00.000000

The setting let an admin say "Gold 3 in game is Platinum 1 on the ladder" for every workspace at once, and froze the
answer into each snapshot at write time. Each grid's native ranges already place a ladder value on a workspace's own
divisions, at read time, so the override only ever produced a ``rank_value`` that contradicts the stored native
``division``/``tier`` (``owmapfix01`` cleaned up the worst of it). The collector now maps through the ladder alone.

1. The snapshots: every Overwatch row whose ``rank_value`` differs from the ladder value of its native
   ``division``/``tier`` gets the ladder value, stamped ``ow2-default-v2``. Lossless: the native rank is on every row.
   A cell the ladder does not know keeps its row as it is, as in ``owemerald01``.
2. The recompute can leave two identical rows in a row of one series, the override's and the ladder's. The later one
   goes: ``rank_snapshot`` stores changes, not polls (``rankdedup01``), and it is not a change.
3. The setting row goes.

``balancer.registration_role.rank_value`` is left alone for the reason ``owemerald01`` gives: those are recorded
registrations, not a cache.

Downgrade is a no-op: the override is gone with the setting, and ladder values are what the previous revision's
collector writes without one.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "owmapdrop01"
down_revision: str | Sequence[str] | None = "matchmode01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SETTING_KEY = "parser.rank_mapping"
LADDER_VERSION = "ow2-default-v2"

#: Tier-5 rank_value per native division on the v2 ladder; tier 1 is +400 (as in ``owmapfix01``).
LADDER_BASES: dict[str, int] = {
    "bronze": 500,
    "silver": 1000,
    "gold": 1500,
    "platinum": 2000,
    "emerald": 2500,
    "diamond": 3000,
    "master": 3500,
    "grandmaster": 4000,
    "ultimate": 4500,
}


def upgrade() -> None:
    bind = op.get_bind()
    cells = [
        (division, tier, base + (5 - tier) * 100) for division, base in LADDER_BASES.items() for tier in range(1, 6)
    ]
    bind.execute(
        sa.text(
            """
            UPDATE rank.rank_snapshot AS s
            SET rank_value = l.rank_value,
                mapping_version = :version
            FROM unnest(CAST(:divisions AS text[]), CAST(:tiers AS int[]), CAST(:values AS int[]))
                AS l(division, tier, rank_value)
            WHERE s.discipline = 'overwatch'
              AND lower(s.division) = l.division
              AND s.tier = l.tier
              AND s.rank_value IS DISTINCT FROM l.rank_value
            """
        ),
        {
            "version": LADDER_VERSION,
            "divisions": [division for division, _, _ in cells],
            "tiers": [tier for _, tier, _ in cells],
            "values": [value for _, _, value in cells],
        },
    )
    op.execute(
        """
        DELETE FROM rank.rank_snapshot AS s
        USING (
            SELECT id,
                   (division, tier, is_ranked, rank_value) IS NOT DISTINCT FROM (
                       LAG(division) OVER w, LAG(tier) OVER w, LAG(is_ranked) OVER w, LAG(rank_value) OVER w
                   ) AND LAG(id) OVER w IS NOT NULL AS repeats
            FROM rank.rank_snapshot
            WHERE discipline = 'overwatch'
            WINDOW w AS (PARTITION BY social_account_id, role, platform ORDER BY captured_at, id)
        ) AS r
        WHERE s.id = r.id AND r.repeats
        """
    )
    bind.execute(sa.text("DELETE FROM settings WHERE key = :key"), {"key": SETTING_KEY})


def downgrade() -> None:
    pass
