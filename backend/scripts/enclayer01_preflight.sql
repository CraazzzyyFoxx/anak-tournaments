-- Pre-flight for enclayer01 (spec §13.8). Run against the PRODUCTION database
-- before the cutover window:
--
--     psql "$DATABASE_URL" -f backend/scripts/enclayer01_preflight.sql
--
-- Every query must return ZERO rows. A non-empty answer is a decision the
-- migration refuses to make by row order -- which role the player really had,
-- which team they played for, which game a replay code belongs to -- so the
-- rows are resolved by hand first. The revision runs these same four queries
-- as its first act and raises with the offending ids, so running them here
-- only buys time, never permission.
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
)
SELECT seat.encounter_id, p.workspace_member_id, array_agg(DISTINCT seat.team_id) AS team_ids
  FROM seat JOIN tournament.player p ON p.team_id = seat.team_id
 GROUP BY seat.encounter_id, p.workspace_member_id
HAVING count(DISTINCT seat.team_id) > 1
 ORDER BY seat.encounter_id, p.workspace_member_id;

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

-- Beyond §13.8's four: two states the revision cannot carry across and will not
-- guess at either. Both are already forbidden by a validated legacy CHECK or by
-- the data model, so they are expected to be empty forever -- they are here so
-- that a database where one is not stops the cutover BEFORE the lock is taken,
-- not halfway through the backfill. The revision runs these two as well.

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
