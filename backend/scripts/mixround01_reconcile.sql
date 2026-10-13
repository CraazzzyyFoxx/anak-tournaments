-- Reconcile for mixround01: legacy casual.* rows against the encounter-layer rows carried across.
--
--     psql "$DATABASE_URL" -f backend/scripts/mixround01_reconcile.sql
--
-- Run after mixround01 and again before mixround02. mixround02 refuses while result set 1 has a status other
-- than ok or result set 2 has a row. The key of a legacy round is its mix, lobby and created_at; it is not unique
-- (rounds recorded in one transaction share now()), so a key counts as carried only when as many encounters of
-- that mix carry it as legacy rounds do, and its rounds are paired with those encounters one to one by ordinal
-- (mixround01 numbered encounters in legacy casual.match.id order): every class below is checked against
-- the encounter of its own round, so a swap of content between two rounds of one key is listed. A seat's roles are
-- compared as a set (a carried seat has exactly its legacy role row, or none), so a seat with several player_role rows
-- is a mismatch, never an error.

CREATE TEMP VIEW mixround01_reconcile AS
WITH legacy_key AS (
    SELECT custom_game_id, lobby_index, created_at, count(*) AS rounds
      FROM casual.match
     GROUP BY custom_game_id, lobby_index, created_at
), carried_key AS (
    SELECT e.custom_game_id, r.lobby_index, e.created_at, count(*) AS rounds
      FROM encounter.encounter e JOIN balancer.mix_round r ON r.encounter_id = e.id
     GROUP BY e.custom_game_id, r.lobby_index, e.created_at
), legacy_ord AS (
    SELECT m.id AS match_id, m.custom_game_id, m.lobby_index, m.created_at,
           row_number() OVER (PARTITION BY m.custom_game_id, m.lobby_index, m.created_at ORDER BY m.id) AS ord
      FROM casual.match m
), carried_ord AS (
    SELECT e.id AS encounter_id, e.custom_game_id, r.lobby_index, e.created_at,
           row_number() OVER (PARTITION BY e.custom_game_id, r.lobby_index, e.created_at ORDER BY e.id) AS ord
      FROM encounter.encounter e JOIN balancer.mix_round r ON r.encounter_id = e.id
), image AS (
    SELECT lo.match_id, co.encounter_id
      FROM legacy_ord lo
      JOIN legacy_key lk ON lk.custom_game_id = lo.custom_game_id AND lk.lobby_index = lo.lobby_index
                        AND lk.created_at = lo.created_at
      JOIN carried_key ck ON ck.custom_game_id = lk.custom_game_id AND ck.lobby_index = lk.lobby_index
                         AND ck.created_at = lk.created_at AND ck.rounds = lk.rounds
      JOIN carried_ord co ON co.custom_game_id = lo.custom_game_id AND co.lobby_index = lo.lobby_index
                         AND co.created_at = lo.created_at AND co.ord = lo.ord
)
SELECT 'rounds' AS class, m.id AS legacy_id, ''::text AS detail,
       EXISTS (SELECT 1 FROM image i
                 JOIN balancer.mix_round r ON r.encounter_id = i.encounter_id
                 JOIN encounter.game g ON g.encounter_id = i.encounter_id
                 JOIN encounter.result_audit a ON a.encounter_id = i.encounter_id
                WHERE i.match_id = m.id
                  AND r.points_per_win_applied IS NOT DISTINCT FROM m.points_per_win_applied
                  AND g.map_id IS NOT DISTINCT FROM m.map_id
                  AND (   (m.recorded_by IS NULL AND a.actor_user_id IS NULL)
                       OR a.actor_user_id IN (SELECT u.id FROM players."user" u WHERE u.auth_user_id = m.recorded_by))) AS ok
  FROM casual.match m
UNION ALL
SELECT 'sides', t.id, 'round ' || t.match_id || ' ' || t.side,
       EXISTS (SELECT 1 FROM image i
                 JOIN encounter.team et ON et.encounter_id = i.encounter_id
                 JOIN encounter.game_team gt ON gt.encounter_team_id = et.id
                WHERE i.match_id = t.match_id AND et.name = t.name AND gt.score = t.score
                  AND et.slot = CASE t.side WHEN 'home' THEN 1 ELSE 2 END)
  FROM casual.team t
UNION ALL
SELECT 'seats', p.id, 'round ' || t.match_id || ' member ' || coalesce(p.workspace_member_id::text, 'none'),
       EXISTS (SELECT 1 FROM image i
                 JOIN encounter.team_member tm ON tm.encounter_id = i.encounter_id
                 JOIN encounter.team et ON et.id = tm.encounter_team_id
                 JOIN balancer.mix_round_member rm ON rm.encounter_id = i.encounter_id
                                                  AND rm.workspace_member_id = tm.workspace_member_id AND NOT rm.busy
                WHERE i.match_id = t.match_id
                  AND tm.workspace_member_id = p.workspace_member_id
                  AND et.slot = CASE t.side WHEN 'home' THEN 1 ELSE 2 END
                  AND tm.display_name_snapshot = p.display_name_snapshot
                  AND tm.rank = p.rank
                  AND rm.rank_delta_applied IS NOT DISTINCT FROM p.rank_delta_applied
                  AND ARRAY(SELECT r.role::text FROM encounter.team_member_role r
                             WHERE r.team_member_id = tm.id AND r.dimension = 'player_role' ORDER BY r.role)
                      = CASE WHEN p.role IS NULL THEN ARRAY[]::text[] ELSE ARRAY[p.role::text] END)
  FROM casual.player p JOIN casual.team t ON t.id = p.team_id
UNION ALL
SELECT 'busy players', b.match_id, 'member ' || b.workspace_member_id,
       EXISTS (SELECT 1 FROM image i
                 JOIN balancer.mix_round_member rm ON rm.encounter_id = i.encounter_id
                WHERE i.match_id = b.match_id AND rm.workspace_member_id = b.workspace_member_id AND rm.busy)
  FROM casual.match_busy_player b;

\echo '--- legacy rows against rows carried across; every status must be ok'
SELECT class, count(*) AS legacy, count(*) FILTER (WHERE ok) AS migrated,
       CASE WHEN bool_and(ok) THEN 'ok' ELSE 'MISMATCH' END AS status
  FROM mixround01_reconcile
 GROUP BY class
 ORDER BY class;

\echo '--- skipped rows; this must return no row'
SELECT class, legacy_id, detail
  FROM mixround01_reconcile
 WHERE NOT ok
 ORDER BY class, legacy_id;
