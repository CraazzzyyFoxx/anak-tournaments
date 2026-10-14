-- Run after discipline01 and again before discipline02. discipline02 refuses while result set 1
-- has a status other than ok or result set 2 has a row.
-- Hard references have no class: an unrewritten id is below every new id and fails its FK.
-- Catalog rows are compared by mapping, discipline and kind only: admins and sync may edit them after release.

CREATE TEMP VIEW discipline01_reconcile AS
SELECT 'heroes' AS class, h.id AS legacy_id, h.name::text AS detail,
       EXISTS (SELECT 1 FROM catalog.entity_legacy l JOIN catalog.entity e ON e.id = l.entity_id
                WHERE l.legacy_kind = 'hero' AND l.legacy_id = h.id
                  AND e.discipline = 'overwatch' AND e.kind = 'character') AS ok
  FROM overwatch.hero h
UNION ALL
SELECT 'gamemodes', g.id, g.name::text,
       EXISTS (SELECT 1 FROM catalog.entity_legacy l JOIN catalog.entity e ON e.id = l.entity_id
                WHERE l.legacy_kind = 'gamemode' AND l.legacy_id = g.id
                  AND e.discipline = 'overwatch' AND e.kind = 'mode')
  FROM overwatch.gamemode g
UNION ALL
SELECT 'maps', m.id, m.name::text,
       EXISTS (SELECT 1 FROM catalog.entity_legacy l JOIN catalog.entity e ON e.id = l.entity_id
                WHERE l.legacy_kind = 'map' AND l.legacy_id = m.id
                  AND e.discipline = 'overwatch' AND e.kind = 'map')
  FROM overwatch.map m
UNION ALL
SELECT 'alias misses', a.id, a.entity_type::text || ' ' || a.raw_name,
       EXISTS (SELECT 1 FROM catalog.alias_miss n
                WHERE n.discipline = 'overwatch' AND n.raw_name = a.raw_name
                  AND n.kind = CASE a.entity_type::text WHEN 'hero' THEN 'character'
                                                        WHEN 'gamemode' THEN 'mode' ELSE 'map' END)
  FROM overwatch.catalog_alias_miss a
UNION ALL
-- A soft id still in legacy space is uncarried. Dangling ids (no legacy row) pass: preflight counts them.
SELECT 'pick-ban ids', soft.owner_id, soft.family || ' ' || soft.item_id,
       NOT EXISTS (SELECT 1 FROM catalog.entity_legacy l WHERE l.legacy_kind = soft.kind AND l.legacy_id = soft.item_id)
  FROM (
    SELECT c.kind::text AS kind, 'config item' AS family, i.id AS owner_id, i.item_id::bigint AS item_id
      FROM tournament.pick_ban_config_item i JOIN tournament.pick_ban_config c ON c.id = i.pick_ban_config_id
    UNION ALL
    SELECT c.kind::text, 'config slot item', si.id, si.item_id
      FROM tournament.pick_ban_config_slot_item si
      JOIN tournament.pick_ban_config_slot sl ON sl.id = si.pick_ban_config_slot_id
      JOIN tournament.pick_ban_config c ON c.id = sl.pick_ban_config_id
    UNION ALL
    SELECT c.kind::text, 'config slot reserve', sl.id, sl.reserve_item_id
      FROM tournament.pick_ban_config_slot sl JOIN tournament.pick_ban_config c ON c.id = sl.pick_ban_config_id
     WHERE sl.reserve_item_id IS NOT NULL
    UNION ALL
    SELECT c.kind::text, 'config rules', c.id, v::bigint
      FROM tournament.pick_ban_config c,
           jsonb_path_query(c.ruleset_json::jsonb, 'lax $.** ? (@.type == "item_in").params.item_ids[*]') v
    UNION ALL
    SELECT s.kind::text, 'session pool', s.id, v::bigint
      FROM encounter.pick_ban_session s, jsonb_path_query(s.pool_json::jsonb, 'lax $.items[*]') v
    UNION ALL
    SELECT s.kind::text, 'session slot pool', s.id, v::bigint
      FROM encounter.pick_ban_session s, jsonb_path_query(s.pool_json::jsonb, 'lax $.slots[*][*]') v
    UNION ALL
    SELECT s.kind::text, 'session reserve', s.id, r.value::bigint
      FROM encounter.pick_ban_session s, jsonb_each_text(coalesce(s.slot_reserves_json::jsonb, '{}'::jsonb)) r
    UNION ALL
    SELECT s.kind::text, 'session rules', s.id, v::bigint
      FROM encounter.pick_ban_session s,
           jsonb_path_query(jsonb_build_array(s.ruleset_json::jsonb, s.resolved_sequence_json::jsonb),
                            'lax $.** ? (@.type == "item_in").params.item_ids[*]') v
    UNION ALL
    SELECT s.kind::text, 'board entry', e.id, e.item_id
      FROM encounter.pick_ban_entry e JOIN encounter.pick_ban_session s ON s.id = e.session_id
    UNION ALL
    SELECT s.kind::text, 'submission', sub.id, v::bigint
      FROM encounter.pick_ban_submission sub
      JOIN encounter.pick_ban_session s ON s.id = sub.session_id,
           jsonb_path_query(sub.items_json::jsonb, 'lax $[*].item_id') v
     WHERE NOT jsonb_path_exists(s.resolved_sequence_json::jsonb, '$[*] ? (@.index == $i && @.action == "side_pick")',
                                 jsonb_build_object('i', sub.step_index))
    UNION ALL
    SELECT r.kind, 'room journal', r.id, v::bigint
      FROM encounter.room_event r
      LEFT JOIN encounter.pick_ban_session s ON s.encounter_id = r.encounter_id AND s.kind::text = r.kind
     CROSS JOIN LATERAL (VALUES ('lax $.item_id'), ('lax $.items[*].item_id'), ('lax $.item_ids[*]')) p(path)
     CROSS JOIN LATERAL jsonb_path_query(r.data::jsonb, p.path::jsonpath) v
     WHERE r.action IN ('acted', 'draft_locked', 'draft_set', 'step_auto_resolved')
       AND r.data::jsonb ->> 'action' IS DISTINCT FROM 'side_pick'
       AND NOT coalesce(jsonb_path_exists(s.resolved_sequence_json::jsonb, '$[*] ? (@.index == $i && @.action == "side_pick")',
                                          jsonb_build_object('i', (r.data::jsonb ->> 'step_index')::int)), false)
  ) soft
 WHERE soft.kind IN ('map');

\echo '--- legacy rows against rows carried across; every status must be ok'
SELECT class, count(*) AS legacy, count(*) FILTER (WHERE ok) AS migrated,
       CASE WHEN bool_and(ok) THEN 'ok' ELSE 'MISMATCH' END AS status
  FROM discipline01_reconcile
 GROUP BY class
 ORDER BY class;

\echo '--- rows not carried; this must return no row'
SELECT class, legacy_id, detail
  FROM discipline01_reconcile
 WHERE NOT ok
 ORDER BY class, legacy_id;
