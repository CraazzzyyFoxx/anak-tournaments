"""Drop legacy map-veto tables and rename two lying table names.

Revision ID: schema01
Revises: wsplyr05
Create Date: 2026-08-25 00:00:00.000000

Live write paths already use ``pick_ban_*``. This copies any leftover
``map_veto_*`` / ``encounter_veto_session`` / ``encounter_map_pool`` rows into
the pick-ban tables (skipping cascade keys that already exist), then drops the
old engine. Also:

- ``analytics.tournament`` → ``analytics.player_shift``
- ``matches.assists`` → ``matches.event``
"""

from collections.abc import Sequence

from alembic import op

revision: str = "schema01"
down_revision: str | Sequence[str] | None = "wsplyr05"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        INSERT INTO tournament.pick_ban_config (
            created_at, updated_at, tournament_id, kind, stage_id, round,
            mode, first_pick_rule, first_ban_rotation, turn_timer_seconds, preset,
            sequence_json, no_repeat_scope, allow_protect
        )
        SELECT
            m.created_at, m.updated_at, m.tournament_id, 'map', m.stage_id, m.round,
            m.mode::text::tournament.pickbanmode,
            m.first_pick_rule::text::tournament.pickbanfirstpickrule,
            m.first_ban_rotation::text::tournament.pickbanrotation,
            m.turn_timer_seconds, m.preset, m.veto_sequence_json,
            'none', false
        FROM tournament.map_veto_config m
        WHERE NOT EXISTS (
            SELECT 1 FROM tournament.pick_ban_config p
            WHERE p.tournament_id = m.tournament_id
              AND p.kind = 'map'
              AND p.stage_id IS NOT DISTINCT FROM m.stage_id
              AND p.round IS NOT DISTINCT FROM m.round
        )
        """
    )
    op.execute(
        """
        INSERT INTO tournament.pick_ban_config_item (
            created_at, updated_at, pick_ban_config_id, item_id, sort_order
        )
        SELECT mm.created_at, mm.updated_at, p.id, mm.map_id, mm.sort_order
        FROM tournament.map_veto_config_map mm
        JOIN tournament.map_veto_config m ON m.id = mm.map_veto_config_id
        JOIN tournament.pick_ban_config p
          ON p.tournament_id = m.tournament_id
         AND p.kind = 'map'
         AND p.stage_id IS NOT DISTINCT FROM m.stage_id
         AND p.round IS NOT DISTINCT FROM m.round
        WHERE NOT EXISTS (
            SELECT 1 FROM tournament.pick_ban_config_item i
            WHERE i.pick_ban_config_id = p.id AND i.item_id = mm.map_id
        )
        """
    )
    op.execute(
        """
        INSERT INTO tournament.pick_ban_config_slot (
            created_at, updated_at, pick_ban_config_id, position, reserve_item_id
        )
        SELECT s.created_at, s.updated_at, p.id, s.position, s.reserve_map_id
        FROM tournament.map_veto_config_slot s
        JOIN tournament.map_veto_config m ON m.id = s.map_veto_config_id
        JOIN tournament.pick_ban_config p
          ON p.tournament_id = m.tournament_id
         AND p.kind = 'map'
         AND p.stage_id IS NOT DISTINCT FROM m.stage_id
         AND p.round IS NOT DISTINCT FROM m.round
        WHERE NOT EXISTS (
            SELECT 1 FROM tournament.pick_ban_config_slot x
            WHERE x.pick_ban_config_id = p.id AND x.position = s.position
        )
        """
    )
    op.execute(
        """
        INSERT INTO tournament.pick_ban_config_slot_item (
            created_at, updated_at, pick_ban_config_slot_id, item_id, sort_order
        )
        SELECT sm.created_at, sm.updated_at, ps.id, sm.map_id, sm.sort_order
        FROM tournament.map_veto_config_slot_map sm
        JOIN tournament.map_veto_config_slot s ON s.id = sm.map_veto_config_slot_id
        JOIN tournament.map_veto_config m ON m.id = s.map_veto_config_id
        JOIN tournament.pick_ban_config p
          ON p.tournament_id = m.tournament_id
         AND p.kind = 'map'
         AND p.stage_id IS NOT DISTINCT FROM m.stage_id
         AND p.round IS NOT DISTINCT FROM m.round
        JOIN tournament.pick_ban_config_slot ps
          ON ps.pick_ban_config_id = p.id AND ps.position = s.position
        WHERE NOT EXISTS (
            SELECT 1 FROM tournament.pick_ban_config_slot_item i
            WHERE i.pick_ban_config_slot_id = ps.id AND i.item_id = sm.map_id
        )
        """
    )
    op.execute(
        """
        INSERT INTO tournament.pick_ban_session (
            created_at, updated_at, encounter_id, kind, config_id, first_side,
            seed_source, home_seed, away_seed, resolved_sequence_json,
            slot_reserves_json, turn_timer_seconds, status, awaiting_choice,
            started_at, current_step_started_at
        )
        SELECT
            s.created_at, s.updated_at, s.encounter_id, 'map', p.id,
            s.first_side::text::tournament.pickbanside,
            s.seed_source::text::tournament.pickbanseedsource,
            s.home_seed, s.away_seed, s.resolved_sequence_json,
            s.slot_reserves_json, s.turn_timer_seconds,
            s.status::text::tournament.pickbansessionstatus,
            false, s.started_at, s.current_step_started_at
        FROM tournament.encounter_veto_session s
        LEFT JOIN tournament.map_veto_config m ON m.id = s.config_id
        LEFT JOIN tournament.pick_ban_config p
          ON p.tournament_id = m.tournament_id
         AND p.kind = 'map'
         AND p.stage_id IS NOT DISTINCT FROM m.stage_id
         AND p.round IS NOT DISTINCT FROM m.round
        WHERE NOT EXISTS (
            SELECT 1 FROM tournament.pick_ban_session x
            WHERE x.encounter_id = s.encounter_id AND x.kind = 'map'
        )
        """
    )
    op.execute(
        """
        INSERT INTO tournament.pick_ban_entry (
            created_at, updated_at, session_id, item_id, "order", action_index,
            round, picked_by, status, team_id
        )
        SELECT
            e.created_at, e.updated_at, ps.id, e.map_id, e."order", e.action_index,
            e.slot,
            e.picked_by::text::tournament.pickbanside,
            e.status::text::tournament.pickbanentrystatus,
            e.team_id
        FROM tournament.encounter_map_pool e
        JOIN tournament.pick_ban_session ps
          ON ps.encounter_id = e.encounter_id AND ps.kind = 'map'
        WHERE NOT EXISTS (
            SELECT 1 FROM tournament.pick_ban_entry pe
            WHERE pe.session_id = ps.id AND pe.item_id = e.map_id
        )
        """
    )

    op.execute("DROP TABLE IF EXISTS tournament.encounter_map_pool")
    op.execute("DROP TABLE IF EXISTS tournament.encounter_veto_session")
    op.execute("DROP TABLE IF EXISTS tournament.map_veto_config_slot_map")
    op.execute("DROP TABLE IF EXISTS tournament.map_veto_config_slot")
    op.execute("DROP TABLE IF EXISTS tournament.map_veto_config_map")
    op.execute("DROP TABLE IF EXISTS tournament.map_veto_config")

    op.execute("ALTER TABLE analytics.tournament RENAME TO player_shift")
    op.execute("ALTER TABLE matches.assists RENAME TO event")


def downgrade() -> None:
    op.execute("ALTER TABLE matches.event RENAME TO assists")
    op.execute("ALTER TABLE analytics.player_shift RENAME TO tournament")
    # Old veto tables are not rebuilt: live traffic already used pick_ban_*.
