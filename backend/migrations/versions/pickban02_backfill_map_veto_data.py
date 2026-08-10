"""Backfill map veto data onto the generic pick-ban engine (kind=map).

Revision ID: pickban02
Revises: pickban01
Create Date: 2026-08-09 00:00:01.000000

Per docs/plans/2026-08-09-generic-pickban-engine.md Decision log #3 ("Map
veto rewritten onto the new engine immediately") and #12 ("Map-veto API
paths/shapes stay as-is... one engine underneath"), this copies every
existing ``map_veto_config``(+map/slot/slot-map)/``encounter_veto_session``/
``encounter_map_pool`` row onto ``pick_ban_config``(kind=map)(+item/slot/
slot-item)/``pick_ban_session``(kind=map)/``pick_ban_entry`` — the tables the
application code now reads and writes for map veto (public_rpc.py's
``captain_map_pool*``/``captain_veto``, veto_admin.py's reset/act,
pick_ban_admin.py's config CRUD).

Purely additive and idempotent: the legacy tables are left completely
untouched (no delete, no update), and every insert is guarded by a lookup on
the target table's own uniqueness (config: ``(tournament_id, kind, stage_id,
round)``; session: ``(encounter_id, kind)``) so re-running this migration, or
running it after some sessions have already been organically created by the
new engine, only fills in what is missing.

Field mapping is mechanical (the generic engine was designed as a straight
generalization of the legacy one — see pick_ban.py's own module docstring):
``map_id``/``map_pool`` -> ``item_id``/``items``, ``slot`` -> ``round``,
``veto_sequence_json`` -> ``sequence_json``. New generic-only columns absent
from the legacy schema (``no_repeat_scope``, ``unique_attribute_per_side_per_
round``, ``allow_protect``, ``awaiting_choice``, ``pending_loser_side``) get
their default/false/null value, which is exactly what every legacy config's
implicit behavior already was (no cross-round memory, no attribute
uniqueness, no protect step, no result-dependent rotation state).

Row-by-row in Python (not a set-based INSERT...SELECT), because a session's
``config_id`` and a slot-item's ``pick_ban_config_slot_id`` both need the
NEWLY generated parent id, and set-based SQL cannot correlate an old id to a
freshly inserted new one without a temp mapping table. Production volume at
authoring time: 13 configs, 14 sessions (all active), 114 pool entries --
trivial either way.
"""

from __future__ import annotations

import json
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "pickban02"
down_revision: str | Sequence[str] | None = "pickban01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _json_param(value) -> str | None:
    """Normalizes a JSON column's driver-returned value (already a Python
    object, or raw text, depending on driver/typing) into text for
    ``CAST(:param AS json)`` -- mirrors catalias0001's ``_seed`` convention of
    always going through ``json.dumps`` for JSON parameters, extended to
    tolerate a driver that already deserialized the source column."""
    if value is None:
        return None
    if isinstance(value, str):
        return value
    return json.dumps(value)


def upgrade() -> None:
    conn = op.get_bind()

    # ── configs (+ items, + slots + slot-items) ─────────────────────────────
    config_id_map: dict[int, int] = {}
    configs = conn.execute(
        sa.text(
            "SELECT id, created_at, updated_at, tournament_id, stage_id, round, mode, first_pick_rule, "
            "first_ban_rotation, turn_timer_seconds, preset, veto_sequence_json "
            "FROM tournament.map_veto_config ORDER BY id"
        )
    ).mappings().all()

    for cfg in configs:
        existing_id = conn.execute(
            sa.text(
                "SELECT id FROM tournament.pick_ban_config WHERE tournament_id = :tid AND kind = 'map' "
                "AND stage_id IS NOT DISTINCT FROM :stage_id AND round IS NOT DISTINCT FROM :round"
            ),
            {"tid": cfg["tournament_id"], "stage_id": cfg["stage_id"], "round": cfg["round"]},
        ).scalar()
        if existing_id is not None:
            config_id_map[cfg["id"]] = existing_id
            continue

        new_config_id = conn.execute(
            sa.text(
                "INSERT INTO tournament.pick_ban_config "
                "(created_at, updated_at, tournament_id, kind, stage_id, round, mode, first_pick_rule, "
                "first_ban_rotation, turn_timer_seconds, preset, sequence_json, no_repeat_scope, "
                "unique_attribute_per_side_per_round, allow_protect) "
                "VALUES (:created_at, :updated_at, :tournament_id, 'map', :stage_id, :round, :mode, "
                ":first_pick_rule, :first_ban_rotation, :turn_timer_seconds, :preset, "
                "CAST(:sequence_json AS json), 'none', NULL, false) "
                "RETURNING id"
            ),
            {
                "created_at": cfg["created_at"],
                "updated_at": cfg["updated_at"],
                "tournament_id": cfg["tournament_id"],
                "stage_id": cfg["stage_id"],
                "round": cfg["round"],
                "mode": cfg["mode"],
                "first_pick_rule": cfg["first_pick_rule"],
                "first_ban_rotation": cfg["first_ban_rotation"],
                "turn_timer_seconds": cfg["turn_timer_seconds"],
                "preset": cfg["preset"],
                "sequence_json": _json_param(cfg["veto_sequence_json"]),
            },
        ).scalar_one()
        config_id_map[cfg["id"]] = new_config_id

        items = conn.execute(
            sa.text(
                "SELECT map_id, sort_order FROM tournament.map_veto_config_map "
                "WHERE map_veto_config_id = :cid ORDER BY sort_order"
            ),
            {"cid": cfg["id"]},
        ).all()
        for map_id, sort_order in items:
            conn.execute(
                sa.text(
                    "INSERT INTO tournament.pick_ban_config_item "
                    "(created_at, updated_at, pick_ban_config_id, item_id, sort_order) "
                    "VALUES (now(), now(), :pbcid, :item_id, :sort_order)"
                ),
                {"pbcid": new_config_id, "item_id": map_id, "sort_order": sort_order},
            )

        slots = conn.execute(
            sa.text(
                "SELECT id, position, reserve_map_id FROM tournament.map_veto_config_slot "
                "WHERE map_veto_config_id = :cid ORDER BY position"
            ),
            {"cid": cfg["id"]},
        ).all()
        for slot_id, position, reserve_map_id in slots:
            new_slot_id = conn.execute(
                sa.text(
                    "INSERT INTO tournament.pick_ban_config_slot "
                    "(created_at, updated_at, pick_ban_config_id, position, reserve_item_id) "
                    "VALUES (now(), now(), :pbcid, :position, :reserve_item_id) "
                    "RETURNING id"
                ),
                {"pbcid": new_config_id, "position": position, "reserve_item_id": reserve_map_id},
            ).scalar_one()

            slot_items = conn.execute(
                sa.text(
                    "SELECT map_id, sort_order FROM tournament.map_veto_config_slot_map "
                    "WHERE map_veto_config_slot_id = :sid ORDER BY sort_order"
                ),
                {"sid": slot_id},
            ).all()
            for map_id, sort_order in slot_items:
                conn.execute(
                    sa.text(
                        "INSERT INTO tournament.pick_ban_config_slot_item "
                        "(created_at, updated_at, pick_ban_config_slot_id, item_id, sort_order) "
                        "VALUES (now(), now(), :nsid, :item_id, :sort_order)"
                    ),
                    {"nsid": new_slot_id, "item_id": map_id, "sort_order": sort_order},
                )

    # ── sessions (+ entries) ─────────────────────────────────────────────────
    sessions = conn.execute(
        sa.text(
            "SELECT id, created_at, updated_at, encounter_id, config_id, first_side, seed_source, "
            "home_seed, away_seed, resolved_sequence_json, slot_reserves_json, turn_timer_seconds, "
            "status, started_at, current_step_started_at "
            "FROM tournament.encounter_veto_session ORDER BY id"
        )
    ).mappings().all()

    for sess in sessions:
        existing_id = conn.execute(
            sa.text(
                "SELECT id FROM tournament.pick_ban_session WHERE encounter_id = :eid AND kind = 'map'"
            ),
            {"eid": sess["encounter_id"]},
        ).scalar()
        if existing_id is not None:
            continue

        new_config_id = config_id_map.get(sess["config_id"]) if sess["config_id"] is not None else None
        new_session_id = conn.execute(
            sa.text(
                "INSERT INTO tournament.pick_ban_session "
                "(created_at, updated_at, encounter_id, kind, config_id, first_side, seed_source, "
                "home_seed, away_seed, resolved_sequence_json, slot_reserves_json, turn_timer_seconds, "
                "status, awaiting_choice, pending_loser_side, started_at, current_step_started_at) "
                "VALUES (:created_at, :updated_at, :encounter_id, 'map', :config_id, :first_side, "
                ":seed_source, :home_seed, :away_seed, CAST(:resolved_sequence_json AS json), "
                "CAST(:slot_reserves_json AS json), :turn_timer_seconds, :status, false, NULL, "
                ":started_at, :current_step_started_at) "
                "RETURNING id"
            ),
            {
                "created_at": sess["created_at"],
                "updated_at": sess["updated_at"],
                "encounter_id": sess["encounter_id"],
                "config_id": new_config_id,
                "first_side": sess["first_side"],
                "seed_source": sess["seed_source"],
                "home_seed": sess["home_seed"],
                "away_seed": sess["away_seed"],
                "resolved_sequence_json": _json_param(sess["resolved_sequence_json"]),
                "slot_reserves_json": _json_param(sess["slot_reserves_json"]),
                "turn_timer_seconds": sess["turn_timer_seconds"],
                "status": sess["status"],
                "started_at": sess["started_at"],
                "current_step_started_at": sess["current_step_started_at"],
            },
        ).scalar_one()

        pool_rows = conn.execute(
            sa.text(
                'SELECT map_id, "order", action_index, slot, picked_by, status, team_id '
                "FROM tournament.encounter_map_pool WHERE encounter_id = :eid ORDER BY \"order\""
            ),
            {"eid": sess["encounter_id"]},
        ).all()
        for map_id, order, action_index, slot, picked_by, entry_status, team_id in pool_rows:
            conn.execute(
                sa.text(
                    "INSERT INTO tournament.pick_ban_entry "
                    '(created_at, updated_at, session_id, item_id, "order", action_index, round, '
                    "picked_by, status, team_id) "
                    'VALUES (now(), now(), :sid, :item_id, :order, :action_index, :round, :picked_by, '
                    ":status, :team_id)"
                ),
                {
                    "sid": new_session_id,
                    "item_id": map_id,
                    "order": order,
                    "action_index": action_index,
                    "round": slot,
                    "picked_by": picked_by,
                    "status": entry_status,
                    "team_id": team_id,
                },
            )


def downgrade() -> None:
    # Reversible: delete every kind=map row this migration could have created.
    # Session delete cascades its entries (pick_ban_entry.session_id is
    # ON DELETE CASCADE); config delete cascades its items/slots the same way.
    conn = op.get_bind()
    conn.execute(sa.text("DELETE FROM tournament.pick_ban_session WHERE kind = 'map'"))
    conn.execute(sa.text("DELETE FROM tournament.pick_ban_config WHERE kind = 'map'"))
