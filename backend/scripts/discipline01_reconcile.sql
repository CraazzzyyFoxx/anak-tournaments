-- Run after discipline01 and again before discipline02. Covers discipline01 and discipline01b. discipline02 refuses while result set 1
-- has a status other than ok or result set 2 has a row.
-- Hard references have no class: an unrewritten id is below every new id and fails its FK.
-- Catalog rows are compared by mapping, discipline and kind only: admins and sync may edit them after release.

-- discipline01b: the leaf a legacy (role, sub_role) names; the revision's LEAF_FUNCTION, verbatim.
CREATE FUNCTION pg_temp.discipline01b_leaf(ws BIGINT, top TEXT, sub TEXT) RETURNS BIGINT
LANGUAGE sql STABLE AS $$
  SELECT coalesce(
    (SELECT r.id
       FROM catalog.role r
       JOIN catalog.role m ON m.id = r.parent_role_id
       JOIN catalog.role_dimension d ON d.id = m.dimension_id
      WHERE d.discipline = 'overwatch' AND d.code = 'player_role' AND m.workspace_id IS NULL
        AND m.code = lower(btrim(top)) AND r.workspace_id = ws
        AND regexp_replace(lower(btrim(sub, U&'\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000')), U&'[\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000]+', '_', 'g') <> '' AND regexp_replace(lower(btrim(sub, U&'\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000')), U&'[\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000]+', '_', 'g') IN (r.code, regexp_replace(lower(btrim(r.name, U&'\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000')), U&'[\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000]+', '_', 'g'))
      ORDER BY (r.code = regexp_replace(lower(btrim(sub, U&'\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000')), U&'[\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000]+', '_', 'g')) DESC, r.id
      LIMIT 1),
    (SELECT m.id
       FROM catalog.role m
       JOIN catalog.role_dimension d ON d.id = m.dimension_id
      WHERE d.discipline = 'overwatch' AND d.code = 'player_role' AND m.workspace_id IS NULL
        AND m.code = lower(btrim(top))))
$$;

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
SELECT 'sub-roles', s.id, s.workspace_id || ' ' || s.role || '/' || s.slug,
       EXISTS (SELECT 1 FROM catalog.role r JOIN catalog.role m ON m.id = r.parent_role_id
                 JOIN catalog.role_dimension d ON d.id = r.dimension_id
                WHERE r.workspace_id = s.workspace_id AND m.workspace_id IS NULL
                  AND d.discipline = 'overwatch' AND d.code = 'player_role'
                  AND m.code = lower(btrim(s.role)) AND r.code = regexp_replace(lower(btrim(s.slug, U&'\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000')), U&'[\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000]+', '_', 'g'))
  FROM tournament.player_sub_role s
UNION ALL
-- Informational: values players and registrations used outside the catalog, kept as inactive sub-roles (Deviation 1).
SELECT 'off-catalog sub-roles (kept inactive)', r.id, r.workspace_id || ' ' || m.code || '/' || r.code, true
  FROM catalog.role r JOIN catalog.role m ON m.id = r.parent_role_id
 WHERE r.workspace_id IS NOT NULL AND NOT r.selectable
   AND NOT EXISTS (SELECT 1 FROM tournament.player_sub_role s
                    WHERE s.workspace_id = r.workspace_id AND lower(btrim(s.role)) = m.code
                      AND regexp_replace(lower(btrim(s.slug, U&'\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000')), U&'[\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000]+', '_', 'g') = r.code)
UNION ALL
-- Informational: flex is no role (D86), so a flex row's sub-role has nothing to hang on.
SELECT 'flex sub-roles (dropped)', p.id, p.sub_role, true
  FROM tournament.player p
 WHERE p.role::text = 'flex' AND regexp_replace(lower(btrim(p.sub_role, U&'\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000')), U&'[\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000]+', '_', 'g') <> ''
UNION ALL
-- Every owner of a slot map (and every tournament and mix) has a format whose quotas are that map.
SELECT 'team formats', o.owner_id, o.source,
       EXISTS (SELECT 1 FROM roster.team_format f
                WHERE f.workspace_id = o.workspace_id
                  AND f.tournament_id IS NOT DISTINCT FROM o.tournament_id
                  AND f.custom_game_id IS NOT DISTINCT FROM o.custom_game_id
                  AND f.starter_max = (SELECT sum(e.value::int) FROM jsonb_each_text(o.slots) e)
                  AND (SELECT coalesce(jsonb_object_agg(r.code, rr.hard_min), '{}'::jsonb)
                         FROM roster.format_role_rule rr JOIN catalog.role r ON r.id = rr.role_id
                        WHERE rr.team_format_id = f.id)
                      = (SELECT coalesce(jsonb_object_agg(e.key, e.value::int), '{}'::jsonb)
                           FROM jsonb_each_text(o.slots) e WHERE e.key <> 'flex'))
  FROM (SELECT 'workspace' AS source, w.id AS owner_id, w.id AS workspace_id, NULL::bigint AS tournament_id,
               NULL::bigint AS custom_game_id, w.default_roster_slots_json AS slots
          FROM workspace w WHERE nullif(w.default_roster_slots_json, '{}'::jsonb) IS NOT NULL
        UNION ALL
        SELECT 'tournament', t.id, t.workspace_id, t.id, NULL,
               coalesce(nullif(t.roster_slots_json, '{}'::jsonb), nullif(w.default_roster_slots_json, '{}'::jsonb),
                        '{"tank": 1, "damage": 2, "support": 2}'::jsonb)
          FROM tournament.tournament t JOIN workspace w ON w.id = t.workspace_id
         WHERE t.created_at <= (SELECT min(f.created_at) FROM roster.team_format f)
        UNION ALL
        SELECT 'mix', g.id, g.workspace_id, NULL, g.id,
               coalesce(nullif(u.role_slots_json, '{}'::jsonb), nullif(w.default_roster_slots_json, '{}'::jsonb),
                        '{"tank": 1, "damage": 2, "support": 2}'::jsonb)
          FROM balancer.custom_game g JOIN workspace w ON w.id = g.workspace_id
          LEFT JOIN balancer.user_config u ON u.user_id = g.host_user_id
         WHERE g.created_at <= (SELECT min(f.created_at) FROM roster.team_format f)) o
UNION ALL
SELECT 'balancer configs', c.id, c.source, NOT (c.config ? 'role_settings' AND c.config -> 'role_settings' ? 'flex')
  FROM (SELECT 'user_config' AS source, u.id, u.config_json AS config FROM balancer.user_config u
        UNION ALL SELECT 'tournament_config', t.id, t.config_json::jsonb FROM balancer.tournament_config t
        UNION ALL SELECT 'workspace_config', w.id, w.config_json::jsonb FROM balancer.workspace_config w
        UNION ALL SELECT 'balance', b.id, b.config_json::jsonb FROM balancer.balance b WHERE b.config_json IS NOT NULL) c
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
 WHERE soft.kind IN ('map', 'hero');

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
