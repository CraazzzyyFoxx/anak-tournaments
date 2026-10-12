-- Reconcile for enclayer01 (spec 13.8): what the migration carried across, and
-- every legacy row it could not. Run against the migrated database, after
-- enclayer01b and the lobby recompute, and again before enclayer02 is allowed to
-- drop the legacy columns and tables:
--
--     psql "$DATABASE_URL" -f backend/scripts/enclayer01_reconcile.sql
--
-- The migration joins on seats and games and skips whatever it cannot resolve
-- without a count or a log line: a report from a side that holds no seat, a
-- replay code at a position with no live game, a journal line of a team without
-- a participation, a roster row collapsed into its twin. Nothing is lost while
-- the legacy tables stay, and enclayer02 is what makes it permanent, so
-- enclayer02 MUST NOT run while the second result set below has any row, or the
-- first has any status but ok.
--
-- Every check is one legacy row and whether its image exists in the new tables.
-- The image is found by what the migration keyed on (encounter and slot, game and
-- slot, team and encounter), and where V1 can write a row of its own at that same
-- key (a claim, a team report, a readiness, a replay code) it must also carry what
-- the legacy row carried: its creation time and author for the first three, the
-- code itself for the last. A V1 row that merely sits at the key proves nothing, so
-- a skipped legacy row stays listed while V1 runs. The price is the opposite error:
-- a migrated row V1 has since replaced (a replay code a captain re-filed) reads as
-- not carried; look at it, then resolve it by hand before enclayer02. Legacy
-- encounters are the ones whose old round column is set: V1 never writes it.
--
-- Result set 1: one line per class, legacy rows against rows carried across.
-- Result set 2: every skipped row, with the legacy id that identifies it.

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
SELECT 'roster rows collapsed by the snapshot', p.id,
       'team ' || p.team_id || ' member ' || p.workspace_member_id || ', kept player ' || k.id,
       (p.sub_role, p.is_substitution, p.name) IS NOT DISTINCT FROM (k.sub_role, k.is_substitution, k.name)
  FROM tournament.player p
  JOIN tournament.player k ON k.id = (SELECT min(m.id) FROM tournament.player m
                                       WHERE m.team_id = p.team_id
                                         AND m.workspace_member_id IS NOT DISTINCT FROM p.workspace_member_id)
 WHERE p.id <> k.id
   AND EXISTS (SELECT 1 FROM encounter.team t WHERE t.team_id = p.team_id);

\echo '--- legacy rows against rows carried across; every status must be ok'
SELECT class, count(*) AS legacy, count(*) FILTER (WHERE ok) AS migrated,
       CASE WHEN bool_and(ok) THEN 'ok' ELSE 'MISMATCH' END AS status
  FROM enclayer01_reconcile
 GROUP BY class
 ORDER BY class;

\echo '--- skipped rows; this must return no row'
SELECT class, legacy_id, detail
  FROM enclayer01_reconcile
 WHERE NOT ok
 ORDER BY class, legacy_id;
