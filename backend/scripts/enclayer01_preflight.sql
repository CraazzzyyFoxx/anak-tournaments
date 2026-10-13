-- Pre-flight for enclayer01 (spec §13.8). Run against the PRODUCTION database
-- before the cutover window:
--
--     psql "$DATABASE_URL" -f backend/scripts/enclayer01_preflight.sql
--
-- Every query must return ZERO rows. A non-empty answer is a decision the
-- migration refuses to make by row order -- which role the player really had,
-- which team they played for, which game a replay code belongs to -- or a row
-- one of the revision's constraints would reject, so the rows are resolved by
-- hand first. The revision runs these same 13 queries as its first act and
-- raises with the offending ids, so running them here only buys time, never
-- permission. The queries are kept identical, text for text, by
-- backend/tests/test_enclayer01_preflight_sql.py.
--
-- Written against the names as they stand BEFORE the move: the checks run
-- before the first ``ALTER TABLE … SET SCHEMA``.

\echo '1. tournament.player rows of one workspace member in one team disagree on role or rank'
SELECT p.team_id, p.workspace_member_id, array_agg(p.id ORDER BY p.id) AS player_ids
  FROM tournament.player p
 GROUP BY p.team_id, p.workspace_member_id
HAVING count(DISTINCT (p.role, p.rank)) > 1
 ORDER BY p.team_id, p.workspace_member_id;

\echo '2. one workspace member sits in two rosters of the same encounter'
WITH seat AS (
    SELECT id AS encounter_id, home_team_id AS team_id
      FROM tournament.encounter WHERE home_team_id IS NOT NULL
     UNION ALL
    SELECT id, away_team_id FROM tournament.encounter WHERE away_team_id IS NOT NULL
     UNION ALL
    SELECT encounter_id, team_id FROM tournament.encounter_participant
),
member_seat AS (
    SELECT seat.encounter_id, p.workspace_member_id, seat.team_id,
           bool_or(NOT p.is_substitution) AS regular
      FROM seat JOIN tournament.player p ON p.team_id = seat.team_id
     GROUP BY seat.encounter_id, p.workspace_member_id, seat.team_id
)
SELECT encounter_id, workspace_member_id, array_agg(team_id ORDER BY team_id) AS team_ids
  FROM member_seat
 GROUP BY encounter_id, workspace_member_id
HAVING count(*) > 1 AND count(*) FILTER (WHERE regular) <> 1
 ORDER BY encounter_id, workspace_member_id;

\echo '3. encounter result status disagrees with encounter status'
SELECT id AS encounter_id, status::text AS status, result_status::text AS result_status
  FROM tournament.encounter
 WHERE (result_status = 'confirmed') <> (status = 'COMPLETED')
 ORDER BY id;

\echo '4. replay code names a position holding both a cancelled and a live game'
SELECT c.id AS map_code_id, r.encounter_id, c.map_index
  FROM tournament.encounter_map_code c
  JOIN tournament.encounter_captain_report r ON r.id = c.report_id
 WHERE EXISTS (SELECT 1 FROM tournament.encounter_game g
                WHERE g.encounter_id = r.encounter_id AND g.position = c.map_index
                  AND g.state = 'cancelled')
   AND EXISTS (SELECT 1 FROM tournament.encounter_game g
                WHERE g.encounter_id = r.encounter_id AND g.position = c.map_index
                  AND g.state <> 'cancelled')
 ORDER BY c.id;

\echo '5. game result placement is below 1, which encounter.game_team cannot store'
SELECT r.id AS game_result_id, r.game_id, r.team_id, r.placement
  FROM tournament.encounter_game_result r
 WHERE r.placement IS NOT NULL AND r.placement < 1
 ORDER BY r.id;

\echo '6. journal row adopted a team that holds no seat in its encounter'
SELECT a.id AS result_audit_id, a.encounter_id, a.adopted_team_id
  FROM tournament.encounter_result_audit a
  JOIN tournament.encounter e ON e.id = a.encounter_id
 WHERE a.adopted_team_id IS NOT NULL
   AND a.adopted_team_id IS DISTINCT FROM e.home_team_id
   AND a.adopted_team_id IS DISTINCT FROM e.away_team_id
   AND NOT EXISTS (SELECT 1 FROM tournament.encounter_participant p
                    WHERE p.encounter_id = a.encounter_id AND p.team_id = a.adopted_team_id)
 ORDER BY a.id;

\echo '7. link repeats a target slot, joins an encounter to itself, or crosses tournaments'
SELECT l.id AS link_id, l.source_encounter_id, l.target_encounter_id, l.target_slot::text AS target_slot
  FROM tournament.encounter_link l
  JOIN tournament.encounter s ON s.id = l.source_encounter_id
  JOIN tournament.encounter t ON t.id = l.target_encounter_id
 WHERE s.tournament_id <> t.tournament_id
    OR l.source_encounter_id = l.target_encounter_id
    OR EXISTS (SELECT 1 FROM tournament.encounter_link o
                WHERE o.target_encounter_id = l.target_encounter_id
                  AND o.target_slot = l.target_slot AND o.id <> l.id)
 ORDER BY l.id;

\echo '8. encounter best_of is below 1'
SELECT id AS encounter_id, best_of FROM tournament.encounter WHERE best_of < 1 ORDER BY id;

\echo '9. duel seats the same team on both sides'
SELECT id AS encounter_id, home_team_id AS team_id
  FROM tournament.encounter
 WHERE home_team_id = away_team_id
 ORDER BY id;

\echo '10. seated team belongs to another tournament than its encounter'
SELECT e.id AS encounter_id, e.tournament_id, t.id AS team_id, t.tournament_id AS team_tournament_id
  FROM tournament.encounter e
  JOIN tournament.team t ON t.id IN (e.home_team_id, e.away_team_id)
 WHERE t.tournament_id <> e.tournament_id
 UNION
SELECT e.id, e.tournament_id, t.id, t.tournament_id
  FROM tournament.encounter_participant p
  JOIN tournament.encounter e ON e.id = p.encounter_id
  JOIN tournament.team t ON t.id = p.team_id
 WHERE t.tournament_id <> e.tournament_id
 ORDER BY 1, 3;

\echo '11. encounter sits in a stage of another tournament, or in a stage item of another stage'
SELECT e.id AS encounter_id, e.tournament_id, e.stage_id, e.stage_item_id
  FROM tournament.encounter e
 WHERE (e.stage_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM tournament.stage s
                         WHERE s.id = e.stage_id AND s.tournament_id = e.tournament_id))
    OR (e.stage_item_id IS NOT NULL AND e.stage_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM tournament.stage_item i
                         WHERE i.id = e.stage_item_id AND i.stage_id = e.stage_id))
 ORDER BY e.id;

\echo '12. pick-ban entry was picked or protected by a side that holds no seat in its encounter'
SELECT en.id AS pick_ban_entry_id, s.encounter_id, v.column_name, v.side
  FROM tournament.pick_ban_entry en
  JOIN tournament.pick_ban_session s ON s.id = en.session_id
  JOIN tournament.encounter e ON e.id = s.encounter_id
  CROSS JOIN LATERAL (VALUES ('picked_by', en.picked_by::text),
                             ('protected_by', en.protected_by::text)) AS v(column_name, side)
 WHERE (v.side = 'home' AND e.home_team_id IS NULL)
    OR (v.side = 'away' AND e.away_team_id IS NULL)
 ORDER BY en.id, v.column_name;

\echo '13. ffa encounter is not in an ffa_league stage, so it would be scored by wins and skipped by the lobby recompute'
SELECT e.id AS encounter_id, e.stage_id, s.stage_type::text AS stage_type
  FROM tournament.encounter e
  LEFT JOIN tournament.stage s ON s.id = e.stage_id
 WHERE e.format = 'ffa' AND s.stage_type::text IS DISTINCT FROM 'ffa_league'
 ORDER BY e.id;
