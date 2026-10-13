"""Contract half of the V1 encounter layer: drop the legacy shape ``enclayer01`` kept.

GATED -- fail-closed (CONTRIBUTING.md, "Destructive migrations are gated"). Runs only with
``OWT_APPLY_ENCOUNTER_LAYER_DROP=1``; without it ``upgrade()`` is a no-op stamp and alembic never re-runs a
stamped revision. With the flag it still refuses while ``backend/scripts/enclayer01_reconcile.sql`` lists a
legacy row the migration did not carry: the drop is what would make that loss permanent. A row the operator
accepts is resolved in the data first, never waved through here. ``RECONCILE_VIEW`` is that file's view,
text for text (``backend/tests/test_enclayer02_reconcile_sql.py``).

Ships in the V2 deploy, run with the flag. Drops V1 Task 16's list and every other V1 leftover; each datum a dropped
column carried is proven carried by a class of the reconcile view first.

Revision ID: enclayer02
Revises: enclayer01b
"""

from __future__ import annotations

import os
import time
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.exc import OperationalError

revision: str = "enclayer02"
down_revision: str | Sequence[str] | None = "enclayer01b"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

FLAG = "OWT_APPLY_ENCOUNTER_LAYER_DROP"
RETRYABLE_SQLSTATES = frozenset({"55P03", "40P01"})
LOCK_TIMEOUT = "3s"
LOCK_ATTEMPTS = 40
LOCK_BACKOFF_SECONDS = 6.0
SAMPLE = 20

_DROP_TABLES = (
    # Children first: a map code hangs off a captain report.
    "tournament.encounter_map_code",
    "tournament.encounter_map_report",
    "tournament.encounter_captain_report",
    "tournament.encounter_game_result",
    "tournament.encounter_participant",
    "tournament.encounter_readiness",
)
_DROP_COLUMNS = (
    (
        "encounter.encounter",
        ("format", "home_team_id", "away_team_id", "home_score", "away_score", "stage_id", "stage_item_id", "round"),
    ),
    ("encounter.game", ("format", "accepted_home_score", "accepted_away_score")),
    ("encounter.pick_ban_entry", ("picked_by", "protected_by", "team_id")),
    (
        "encounter.pick_ban_session",
        ("first_side", "pending_loser_side", "undo_requested_by", "home_seed", "away_seed", "config_id"),
    ),
    ("encounter.pick_ban_submission", ("side",)),
    (
        "encounter.result_audit",
        ("home_score_before", "away_score_before", "home_score_after", "away_score_after", "ffa_results_json"),
    ),
    ("encounter.room_event", ("side",)),
    ("tournament.encounter_link", ("role", "legacy_target_slot")),
    # split_lower_bracket: already gone wherever bsplit02 ran with its flag, hence IF EXISTS below.
    ("tournament.stage", ("ffa_placement_points", "ffa_columns", "ffa_formula", "split_lower_bracket")),
)
#: Typed the legacy columns above; dropped after them.
_DROP_TYPES = ("tournament.encounterlinkrole", "tournament.encounterlinkslot", "tournament.pickbanside")
#: Type no column at all (left over from map veto); IF EXISTS, a restored database may not carry every one.
_DROP_UNUSED_TYPES = (
    "tournament.firstbanrotation",
    "tournament.firstpickrule",
    "tournament.mappickside",
    "tournament.mappoolentrystatus",
    "tournament.mapvetomode",
    "tournament.mapvetosessionstatus",
    "tournament.vetoseedsource",
)
_EXCLUSIVE = ", ".join([*(table for table, _columns in _DROP_COLUMNS), *_DROP_TABLES])

RECONCILE_VIEW = r"""
CREATE TEMP VIEW enclayer01_reconcile AS
WITH legacy_encounter AS (
    SELECT * FROM encounter.encounter WHERE round IS NOT NULL
)
SELECT 'encounters' AS class, e.id AS legacy_id, ''::text AS detail,
       (e.workspace_id IS NOT NULL AND e.scoring_rule_id IS NOT NULL AND e.slot_count IS NOT NULL
        AND (e.result_status::text <> 'confirmed' OR e.result_source IS NOT NULL)) AS ok
  FROM legacy_encounter e
UNION ALL
SELECT 'bracket positions', e.id, '',
       EXISTS (SELECT 1 FROM tournament.bracket_encounter b WHERE b.encounter_id = e.id)
  FROM legacy_encounter e
UNION ALL
SELECT 'duel seats', e.id, 'slot ' || v.slot,
       EXISTS (SELECT 1 FROM encounter.team t WHERE t.encounter_id = e.id AND t.slot = v.slot)
  FROM legacy_encounter e
 CROSS JOIN LATERAL (VALUES (1, e.home_team_id), (2, e.away_team_id)) AS v(slot, team_id)
 WHERE e.format = 'duel' AND v.team_id IS NOT NULL
UNION ALL
SELECT 'lobby seats', p.encounter_id, 'slot ' || p.slot,
       EXISTS (SELECT 1 FROM encounter.team t WHERE t.encounter_id = p.encounter_id AND t.slot = p.slot)
  FROM tournament.encounter_participant p
UNION ALL
SELECT 'games', g.id, 'encounter ' || g.encounter_id,
       EXISTS (SELECT 1 FROM encounter.game_team gt WHERE gt.game_id = g.id)
       OR NOT EXISTS (SELECT 1 FROM encounter.team t WHERE t.encounter_id = g.encounter_id)
  FROM encounter.game g
  JOIN legacy_encounter e ON e.id = g.encounter_id
UNION ALL
SELECT 'duel game scores', g.id, 'encounter ' || g.encounter_id,
       (SELECT count(DISTINCT t.slot)
          FROM encounter.game_team gt JOIN encounter.team t ON t.id = gt.encounter_team_id
         WHERE gt.game_id = g.id AND t.slot IN (1, 2)) = 2
  FROM encounter.game g
  JOIN legacy_encounter e ON e.id = g.encounter_id
 WHERE g.accepted_home_score IS NOT NULL AND g.accepted_away_score IS NOT NULL
UNION ALL
SELECT 'game results', r.id, 'game ' || r.game_id || ' team ' || r.team_id,
       EXISTS (SELECT 1 FROM encounter.team t JOIN encounter.game_team gt ON gt.encounter_team_id = t.id
                WHERE t.encounter_id = r.encounter_id AND t.team_id = r.team_id AND gt.game_id = r.game_id)
  FROM tournament.encounter_game_result r
UNION ALL
SELECT 'map reports -> claims', mr.id, 'game ' || mr.game_id || ' side ' || mr.side,
       EXISTS (SELECT 1 FROM encounter.game_claim c JOIN encounter.team t ON t.id = c.claimant_team_id
                WHERE c.game_id = mr.game_id
                  AND t.slot = CASE mr.side WHEN 'home' THEN 1 WHEN 'away' THEN 2 END
                  AND c.created_at = mr.created_at
                  AND c.reporter_user_id IS NOT DISTINCT FROM mr.reporter_user_id)
  FROM tournament.encounter_map_report mr
UNION ALL
SELECT 'captain reports -> team reports', cr.id, 'encounter ' || cr.encounter_id || ' team ' || cr.team_id,
       EXISTS (SELECT 1 FROM encounter.team_report tr JOIN encounter.team t ON t.id = tr.encounter_team_id
                WHERE tr.encounter_id = cr.encounter_id AND t.team_id = cr.team_id
                  AND tr.created_at = cr.created_at
                  AND tr.reporter_user_id IS NOT DISTINCT FROM cr.reporter_user_id)
  FROM tournament.encounter_captain_report cr
UNION ALL
SELECT 'readiness', rd.id, 'encounter ' || rd.encounter_id || ' side ' || rd.side,
       EXISTS (SELECT 1 FROM encounter.readiness r JOIN encounter.team t ON t.id = r.encounter_team_id
                WHERE r.encounter_id = rd.encounter_id
                  AND t.slot = CASE rd.side WHEN 'home' THEN 1 WHEN 'away' THEN 2 END
                  AND r.created_at = rd.created_at
                  AND r.ready_user_id IS NOT DISTINCT FROM rd.ready_user_id)
  FROM tournament.encounter_readiness rd
UNION ALL
SELECT 'room events with a side', re.id, 'encounter ' || re.encounter_id || ' side ' || re.side,
       re.encounter_team_id IS NOT NULL
  FROM encounter.room_event re
 WHERE re.side IN ('home', 'away')
UNION ALL
SELECT 'replay codes', c.id, 'report ' || c.report_id || ' position ' || c.map_index,
       EXISTS (SELECT 1
                 FROM tournament.encounter_captain_report r
                 JOIN encounter.team t ON t.encounter_id = r.encounter_id AND t.team_id = r.team_id
                 JOIN encounter.game g ON g.encounter_id = r.encounter_id AND g.position = c.map_index
                                      AND g.state::text <> 'cancelled'
                 JOIN encounter.game_team gt ON gt.game_id = g.id AND gt.encounter_team_id = t.id
                WHERE r.id = c.report_id AND gt.replay_code = c.code)
  FROM tournament.encounter_map_code c
UNION ALL
SELECT 'result journal lines', a.id, 'encounter ' || a.encounter_id,
       (CASE WHEN a.ffa_results_json IS NOT NULL THEN
               CASE WHEN jsonb_typeof(a.ffa_results_json -> 'before') = 'array'
                    THEN jsonb_array_length(a.ffa_results_json -> 'before') ELSE 0 END
             + CASE WHEN jsonb_typeof(a.ffa_results_json -> 'after') = 'array'
                    THEN jsonb_array_length(a.ffa_results_json -> 'after') ELSE 0 END
             ELSE (a.home_score_before IS NOT NULL)::int + (a.away_score_before IS NOT NULL)::int
                + (a.home_score_after IS NOT NULL)::int + (a.away_score_after IS NOT NULL)::int
        END)
       = (CASE WHEN jsonb_typeof(a."before") = 'array' THEN jsonb_array_length(a."before") ELSE 0 END
        + CASE WHEN jsonb_typeof(a."after") = 'array' THEN jsonb_array_length(a."after") ELSE 0 END)
  FROM encounter.result_audit a
 WHERE a.ffa_results_json IS NOT NULL OR a.home_score_after IS NOT NULL
UNION ALL
SELECT 'pick-ban entry sides', en.id, 'session ' || en.session_id,
       (en.picked_by::text IS NULL OR en.picked_by::text NOT IN ('home', 'away')
        OR (en.picked_by_kind::text = 'team' AND en.picked_by_team_id IS NOT NULL))
       AND (en.protected_by::text IS NULL OR en.protected_by::text NOT IN ('home', 'away')
        OR (en.protected_by_kind::text = 'team' AND en.protected_by_team_id IS NOT NULL))
  FROM encounter.pick_ban_entry en
 WHERE en.picked_by::text IN ('home', 'away') OR en.protected_by::text IN ('home', 'away')
UNION ALL
SELECT 'pick-ban submissions', sub.id, 'session ' || sub.session_id || ' side ' || sub.side,
       sub.encounter_team_id IS NOT NULL
  FROM encounter.pick_ban_submission sub
 WHERE sub.side IN ('home', 'away')
UNION ALL
SELECT 'pick-ban first side', s.id, 'encounter ' || s.encounter_id,
       s.first_team_id IS NOT NULL
  FROM encounter.pick_ban_session s
 WHERE s.first_side::text IN ('home', 'away')
UNION ALL
SELECT 'pick-ban pending chooser', s.id, 'encounter ' || s.encounter_id,
       s.pending_chooser_team_id IS NOT NULL
  FROM encounter.pick_ban_session s
 WHERE s.pending_loser_side::text IN ('home', 'away')
UNION ALL
SELECT 'pick-ban undo requester', s.id, 'encounter ' || s.encounter_id,
       s.undo_requested_by_team_id IS NOT NULL
  FROM encounter.pick_ban_session s
 WHERE s.undo_requested_by::text IN ('home', 'away')
UNION ALL
SELECT 'pick-ban seeds', s.id, 'encounter ' || s.encounter_id || ' seeds ' || coalesce(s.home_seed::text, '-')
                              || '/' || coalesce(s.away_seed::text, '-'),
       (s.home_seed IS NULL OR EXISTS (SELECT 1 FROM encounter.team t
                                        WHERE t.encounter_id = s.encounter_id AND t.slot = 1 AND t.seed = s.home_seed))
       AND (s.away_seed IS NULL OR EXISTS (SELECT 1 FROM encounter.team t
                                            WHERE t.encounter_id = s.encounter_id AND t.slot = 2 AND t.seed = s.away_seed))
       AND NOT EXISTS (SELECT 1 FROM encounter.pick_ban_session o
                        WHERE o.encounter_id = s.encounter_id AND o.id <> s.id
                          AND (o.home_seed <> s.home_seed OR o.away_seed <> s.away_seed))
  FROM encounter.pick_ban_session s
 WHERE s.home_seed IS NOT NULL OR s.away_seed IS NOT NULL
UNION ALL
SELECT 'pick-ban pool snapshots', s.id, 'encounter ' || s.encounter_id,
       s.pool_json::jsonb ?& ARRAY['mode', 'rotation', 'progressive', 'items', 'slots']
  FROM encounter.pick_ban_session s
UNION ALL
SELECT 'pick-ban rulesets', x.id, x.source,
       x.ruleset_json::text !~ '"actors"\s*:\s*"(home|away)"'
  FROM (SELECT id, 'config' AS source, ruleset_json FROM tournament.pick_ban_config
         UNION ALL
        SELECT id, 'session', ruleset_json FROM encounter.pick_ban_session) x
UNION ALL
SELECT 'notification payloads', n.id, n.kind,
       NOT (n.payload_json ?| ARRAY['home_team_name', 'away_team_name'])
  FROM public.notification n
 WHERE n.kind IN ('encounter.scheduled', 'encounter.dispute_review')
UNION ALL
SELECT 'pick-ban entry teams', en.id, 'session ' || en.session_id || ' team ' || en.team_id,
       EXISTS (SELECT 1 FROM encounter.team t
                WHERE t.id IN (en.picked_by_team_id, en.protected_by_team_id) AND t.team_id = en.team_id)
  FROM encounter.pick_ban_entry en
 WHERE en.team_id IS NOT NULL
UNION ALL
SELECT 'roster rows collapsed by the snapshot', p.id,
       'team ' || p.team_id || ' member ' || p.workspace_member_id || ', kept player ' || k.id,
       (p.sub_role, p.is_substitution, p.name) IS NOT DISTINCT FROM (k.sub_role, k.is_substitution, k.name)
  FROM tournament.player p
  JOIN tournament.player k ON k.id = (SELECT min(m.id) FROM tournament.player m
                                       WHERE m.team_id = p.team_id
                                         AND m.workspace_member_id IS NOT DISTINCT FROM p.workspace_member_id)
 WHERE p.id <> k.id
   AND EXISTS (SELECT 1 FROM encounter.team t WHERE t.team_id = p.team_id)
"""


def _take_locks() -> None:
    """Lock every altered table first, retrying past busy readers (``bsplit02``)."""
    bind = op.get_bind()
    bind.execute(sa.text(f"SET LOCAL lock_timeout = '{LOCK_TIMEOUT}'"))
    for attempt in range(1, LOCK_ATTEMPTS + 1):
        savepoint = bind.begin_nested()
        try:
            bind.execute(sa.text(f"LOCK TABLE {_EXCLUSIVE} IN ACCESS EXCLUSIVE MODE"))
        except OperationalError as exc:
            savepoint.rollback()
            if getattr(exc.orig, "sqlstate", None) not in RETRYABLE_SQLSTATES or attempt == LOCK_ATTEMPTS:
                raise
            time.sleep(LOCK_BACKOFF_SECONDS)
        else:
            savepoint.commit()
            return


def upgrade() -> None:
    if os.environ.get(FLAG) != "1":
        return
    _take_locks()
    bind = op.get_bind()
    bind.execute(sa.text(RECONCILE_VIEW))
    skipped = bind.execute(
        sa.text("SELECT class, legacy_id, detail FROM enclayer01_reconcile WHERE NOT ok ORDER BY class, legacy_id")
    ).all()
    if skipped:
        listed = "; ".join(f"{cls} {legacy_id} ({detail})" for cls, legacy_id, detail in skipped[:SAMPLE])
        rest = len(skipped) - SAMPLE
        raise RuntimeError(
            f"enclayer02 refuses the drop: enclayer01_reconcile lists {len(skipped)} legacy row(s) not carried: "
            + listed
            + (f"; … {rest} more" if rest > 0 else "")
        )
    bind.execute(sa.text("DROP VIEW enclayer01_reconcile"))
    for table in _DROP_TABLES:
        op.execute(f"DROP TABLE {table}")
    for table, columns in _DROP_COLUMNS:
        op.execute(f"ALTER TABLE {table} " + ", ".join(f"DROP COLUMN IF EXISTS {column}" for column in columns))
    for name in _DROP_TYPES:
        op.execute(f"DROP TYPE {name}")
    for name in _DROP_UNUSED_TYPES:
        op.execute(f"DROP TYPE IF EXISTS {name}")


def downgrade() -> None:
    raise RuntimeError("enclayer02 is forward-fix only; restore from a backup to go back")
