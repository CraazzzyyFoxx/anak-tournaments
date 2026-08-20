"""Rebase ``overwatch_rank.rank_snapshot.rank_value`` onto the Emerald ladder.

Revision ID: owemerald01
Revises: stagepub01
Create Date: 2026-08-14 00:00:00.000000

Overwatch added an Emerald division between Platinum and Diamond and re-anchored
the ladder at Bronze 5 = 500. The default division+tier -> ``rank_value`` table
(parser-service ``overwatch_rank.mapping``) moved with it -- ``ow2-default-v1``
-> ``ow2-default-v2``:

    bronze  1000 -> 500      emerald    ---- -> 2500
    silver  1500 -> 1000     diamond    3000 -> 3000
    gold    2000 -> 1500     master     3500 -> 3500
    platinum 2500 -> 2000    grandmaster 4000 -> 4000
                             ultimate   4500 -> 4500

Diamond and above are untouched; bronze..platinum each moved down 500 and
emerald took the band platinum vacated. That makes every stored ``rank_value``
below 3000 read one division too high (1000 was Bronze 5, it is now Silver 5),
so the mapped column has to be recomputed. It can be, losslessly: the native
``division``/``tier`` are stored on every snapshot precisely so a rebase of the
table is reversible.

Scope is deliberately just this table. ``balancer.registration_role.rank_value``
also holds OW-derived numbers (the registration autofill maps a snapshot through
the tournament's division grid), but those are *recorded registrations* on a
workspace grid, not a derived cache -- rewriting them would rewrite tournament
history. Workspaces adopt the new ladder by publishing a new grid version, which
leaves past tournaments pointed at the version they were played on.

Rows stamped with an admin-authored mapping version are skipped: those cells are
owned by ``parser.rank_mapping``, not by this table. Rows still stamped
``ow2-default-v1`` after this migration are the ones v1 itself never mapped
(unknown or NULL division, hence ``rank_value IS NULL``) -- there is nothing to
recompute and re-stamping them would claim a derivation that never happened.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "owemerald01"
down_revision: str | Sequence[str] | None = "stagepub01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

V1_VERSION = "ow2-default-v1"
V2_VERSION = "ow2-default-v2"

#: Tier-5 (bottom of division) rank_value per native division, per table version.
V1_BASES: dict[str, int] = {
    "bronze": 1000,
    "silver": 1500,
    "gold": 2000,
    "platinum": 2500,
    "diamond": 3000,
    "master": 3500,
    "grandmaster": 4000,
    "ultimate": 4500,
}
V2_BASES: dict[str, int] = {
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


def _remap(bases: dict[str, int], from_version: str, to_version: str) -> None:
    """Recompute ``rank_value`` from native (division, tier) using ``bases``.

    Tier 5 is the bottom of a division and tier 1 the top, 100 apart -- the same
    arithmetic as ``mapping.build_default_lookup``.
    """
    values = ", ".join(f"('{division}', {base})" for division, base in bases.items())
    op.execute(
        f"""
        UPDATE overwatch_rank.rank_snapshot AS s
        SET rank_value = b.base + (5 - s.tier) * 100,
            mapping_version = '{to_version}'
        FROM (VALUES {values}) AS b(division, base)
        WHERE s.mapping_version = '{from_version}'
          AND s.division IS NOT NULL
          AND s.tier BETWEEN 1 AND 5
          AND lower(s.division) = b.division
        """
    )


def upgrade() -> None:
    _remap(V2_BASES, from_version=V1_VERSION, to_version=V2_VERSION)


def downgrade() -> None:
    # Emerald has no v1 cell, so those snapshots go back to unmapped -- the
    # native division/tier stay, which is exactly the state v1 left an unknown
    # division in.
    op.execute(
        f"""
        UPDATE overwatch_rank.rank_snapshot
        SET rank_value = NULL,
            mapping_version = NULL
        WHERE mapping_version = '{V2_VERSION}'
          AND lower(division) = 'emerald'
        """
    )
    _remap(V1_BASES, from_version=V2_VERSION, to_version=V1_VERSION)
