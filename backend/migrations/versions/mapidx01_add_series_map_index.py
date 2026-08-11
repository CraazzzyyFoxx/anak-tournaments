"""Per-map results carry the map's POSITION in the series, not just its map id

Revision ID: mapidx01
Revises: pbundo01
Create Date: 2026-08-11 12:00:00.000000

A series may play the same map twice -- a slot config that lists it in two
rounds, with ``no_repeat_scope=none``. Both per-map result tables keyed a played
map by ``map_id`` alone, so the second play collided with the first:

- ``tournament.encounter_map_report`` was unique on ``(encounter, map, team)``,
  so the second play read back the FIRST play's claims as already filed (and,
  once they agreed, as already reconciled) and the room refused to move on.
- ``matches.match`` had no position either, so the second play's confirmed score
  overwrote the first play's row instead of standing beside it.

Both gain ``map_index`` -- the 1-based position in play order, the same index
``encounter_map_code.map_index`` already uses:

- on the report it is NOT NULL (0 = "no position", a report for an encounter
  with no map pick-ban session) and joins the unique constraint;
- on the match it is nullable, because every parsed log and every pre-existing
  row genuinely has no known position; the report path stamps the row it
  reconciles, and reads adopt a positionless row before writing a second one.

Existing report rows are backfilled from the map pick-ban pool: play order is
``COALESCE(action_index, "order")`` over the settled (``picked``/``played``)
entries of the encounter's ``kind=map`` session -- the same ordering
``captain._picked_map_ids`` resolves map codes with.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "mapidx01"
down_revision: str | Sequence[str] | None = "pbundo01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_BACKFILL_REPORT_INDEX = sa.text(
    """
    WITH settled AS (
        SELECT
            pbs.encounter_id AS encounter_id,
            pbe.item_id AS map_id,
            ROW_NUMBER() OVER (
                PARTITION BY pbs.encounter_id
                ORDER BY COALESCE(pbe.action_index, pbe."order"), pbe.id
            ) AS map_index
        FROM tournament.pick_ban_entry pbe
        JOIN tournament.pick_ban_session pbs ON pbs.id = pbe.session_id
        WHERE pbs.kind = 'map' AND pbe.status IN ('picked', 'played')
    )
    UPDATE tournament.encounter_map_report AS r
    SET map_index = s.map_index
    FROM settled AS s
    WHERE s.encounter_id = r.encounter_id AND s.map_id = r.map_id
    """
)


def upgrade() -> None:
    op.add_column(
        "encounter_map_report",
        sa.Column("map_index", sa.Integer(), nullable=False, server_default="0"),
        schema="tournament",
    )
    op.execute(_BACKFILL_REPORT_INDEX)
    op.drop_constraint(
        "uq_encounter_map_report_encounter_map_team",
        "encounter_map_report",
        schema="tournament",
        type_="unique",
    )
    op.create_unique_constraint(
        "uq_encounter_map_report_encounter_map_index_team",
        "encounter_map_report",
        ["encounter_id", "map_id", "map_index", "team_id"],
        schema="tournament",
    )
    op.create_check_constraint(
        "ck_encounter_map_report_index",
        "encounter_map_report",
        "map_index >= 0",
        schema="tournament",
    )

    op.add_column(
        "match",
        sa.Column("map_index", sa.Integer(), nullable=True),
        schema="matches",
    )


def downgrade() -> None:
    op.drop_column("match", "map_index", schema="matches")

    op.drop_constraint(
        "ck_encounter_map_report_index",
        "encounter_map_report",
        schema="tournament",
        type_="check",
    )
    op.drop_constraint(
        "uq_encounter_map_report_encounter_map_index_team",
        "encounter_map_report",
        schema="tournament",
        type_="unique",
    )
    # Two plays of one map collapse back into one row per (encounter, map, team):
    # keep the latest claim, which is the one the room last showed.
    op.execute(
        sa.text(
            """
            DELETE FROM tournament.encounter_map_report r
            USING tournament.encounter_map_report other
            WHERE r.encounter_id = other.encounter_id
              AND r.map_id = other.map_id
              AND r.team_id = other.team_id
              AND r.id < other.id
            """
        )
    )
    op.create_unique_constraint(
        "uq_encounter_map_report_encounter_map_team",
        "encounter_map_report",
        ["encounter_id", "map_id", "team_id"],
        schema="tournament",
    )
    op.drop_column("encounter_map_report", "map_index", schema="tournament")
