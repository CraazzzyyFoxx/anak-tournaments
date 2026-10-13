-- Pre-flight for mixround01. Run against the PRODUCTION database before the cutover window:
--
--     psql "$DATABASE_URL" -f backend/scripts/mixround01_preflight.sql
--
-- Every numbered query must return ZERO rows. A non-empty answer is a legacy round the migration cannot
-- represent as one encounter, so the rows are resolved by hand first. The revision runs these same 2 queries
-- as its first act and raises with the offending ids, so running them here only buys time, never permission.
-- The queries are kept identical, text for text, by backend/tests/test_mixround01_preflight_sql.py.
-- The "count:" block is informational: it never stops the revision.

\echo '1. one workspace member sits on two seats of one round'
SELECT t.match_id, p.workspace_member_id, array_agg(p.id ORDER BY p.id) AS player_ids
  FROM casual.player p JOIN casual.team t ON t.id = p.team_id
 WHERE p.workspace_member_id IS NOT NULL
 GROUP BY t.match_id, p.workspace_member_id
HAVING count(*) > 1
 ORDER BY t.match_id, p.workspace_member_id;

\echo '2. round does not have exactly two teams'
SELECT m.id AS match_id, count(t.id) AS teams
  FROM casual.match m LEFT JOIN casual.team t ON t.match_id = m.id
 GROUP BY m.id
HAVING count(t.id) <> 2
 ORDER BY m.id;

\echo 'count: seats without a workspace member (dropped by the migration)'
SELECT count(*) AS seats_without_member FROM casual.player WHERE workspace_member_id IS NULL;
