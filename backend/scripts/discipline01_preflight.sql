-- Run against production before the migration window. Every numbered query must return zero rows.
-- The revision runs these same checks first; tests/test_discipline01_preflight_sql.py keeps them text for text.
-- discipline01b (P2) appends classes 3-6 and two counts.

\echo '1. maps whose names collide after slugify'
SELECT s.slug, array_agg(s.id ORDER BY s.id) AS map_ids, array_agg(s.name ORDER BY s.id) AS names
  FROM (SELECT m.id, m.name, coalesce(nullif(btrim(regexp_replace(lower(btrim(m.name)), '[^a-z0-9]+', '-', 'g'), '-'), ''), 'map') AS slug FROM overwatch.map m) s
 GROUP BY s.slug
HAVING count(*) > 1
 ORDER BY s.slug;

\echo '2. catalog values too long'
SELECT v.legacy_kind, v.legacy_id, v.field, v.value_length
  FROM (
    SELECT 'hero' AS legacy_kind, h.id AS legacy_id, 'slug' AS field,
           char_length(h.slug) AS value_length, 64 AS max_length FROM overwatch.hero h
    UNION ALL
    SELECT 'gamemode', g.id, 'slug', char_length(g.slug), 64 FROM overwatch.gamemode g
    UNION ALL
    SELECT 'map', m.id, 'slug', char_length(coalesce(nullif(btrim(regexp_replace(lower(btrim(m.name)), '[^a-z0-9]+', '-', 'g'), '-'), ''), 'map')), 64 FROM overwatch.map m
    UNION ALL
    SELECT 'hero', h.id, 'name', char_length(h.name), 128 FROM overwatch.hero h
    UNION ALL
    SELECT 'gamemode', g.id, 'name', char_length(g.name), 128 FROM overwatch.gamemode g
    UNION ALL
    SELECT 'map', m.id, 'name', char_length(m.name), 128 FROM overwatch.map m
  ) v
 WHERE v.value_length > v.max_length
 ORDER BY v.legacy_kind, v.legacy_id, v.field;

\echo 'count: pick-ban ids that name no catalog row (left as they are; below every new id)'
SELECT count(*) AS dangling_pick_ban_ids
  FROM (SELECT c.kind::text AS kind, i.item_id::bigint AS item_id
          FROM tournament.pick_ban_config_item i JOIN tournament.pick_ban_config c ON c.id = i.pick_ban_config_id
        UNION ALL
        SELECT c.kind::text, si.item_id
          FROM tournament.pick_ban_config_slot_item si
          JOIN tournament.pick_ban_config_slot sl ON sl.id = si.pick_ban_config_slot_id
          JOIN tournament.pick_ban_config c ON c.id = sl.pick_ban_config_id
        UNION ALL
        SELECT c.kind::text, sl.reserve_item_id
          FROM tournament.pick_ban_config_slot sl JOIN tournament.pick_ban_config c ON c.id = sl.pick_ban_config_id
         WHERE sl.reserve_item_id IS NOT NULL
        UNION ALL
        SELECT s.kind::text, e.item_id
          FROM encounter.pick_ban_entry e JOIN encounter.pick_ban_session s ON s.id = e.session_id) x
 WHERE (x.kind = 'map' AND NOT EXISTS (SELECT 1 FROM overwatch.map m WHERE m.id = x.item_id))
    OR (x.kind = 'hero' AND NOT EXISTS (SELECT 1 FROM overwatch.hero h WHERE h.id = x.item_id));

\echo '3. role values outside tank|damage|support|flex'
SELECT v.source, v.value, count(*) AS row_count
          FROM (SELECT 'balancer.member_rank' AS source, lower(btrim(m.role)) AS value FROM balancer.member_rank m
                UNION ALL
                SELECT 'balancer.member_hidden_rating', lower(btrim(h.role)) FROM balancer.member_hidden_rating h
                UNION ALL
                SELECT 'balancer.registration_role', lower(btrim(r.role)) FROM balancer.registration_role r
                UNION ALL
                SELECT 'balancer.custom_game_player_role', lower(btrim(c.role)) FROM balancer.custom_game_player_role c
                UNION ALL
                SELECT 'balancer.draft_player.captain_role', lower(btrim(d.captain_role))
                  FROM balancer.draft_player d WHERE d.captain_role IS NOT NULL
                UNION ALL
                SELECT 'balancer.draft_pick.target_role', lower(btrim(k.target_role))
                  FROM balancer.draft_pick k WHERE k.target_role IS NOT NULL
                UNION ALL
                SELECT 'balancer.team_slot', lower(btrim(s.role)) FROM balancer.team_slot s
                UNION ALL
                SELECT 'analytics.ml_model_artifact', lower(btrim(a.role))
                  FROM analytics.ml_model_artifact a WHERE a.role IS NOT NULL) v
         WHERE v.value NOT IN ('tank', 'damage', 'support', 'flex')
         GROUP BY v.source, v.value
         ORDER BY v.source, v.value;

\echo '4. flex where a role is required'
SELECT v.source, v.row_id
          FROM (SELECT 'balancer.registration_role' AS source, r.id AS row_id, lower(btrim(r.role)) AS value
                  FROM balancer.registration_role r
                UNION ALL
                SELECT 'balancer.custom_game_player_role', c.custom_game_player_id, lower(btrim(c.role))
                  FROM balancer.custom_game_player_role c) v
         WHERE v.value = 'flex'
         ORDER BY v.source, v.row_id;

\echo '5. encounter roster roles outside dimension player_role'
SELECT r.dimension, count(*) AS row_count
          FROM encounter.team_member_role r
         WHERE r.dimension <> 'player_role'
         GROUP BY r.dimension
         ORDER BY r.dimension;

\echo '6. workspace sub-roles that cannot become catalog roles'
SELECT p.workspace_id, p.code, array_agg(p.parent ORDER BY p.parent) AS parents
          FROM (
    WITH catalog_rows AS (
        SELECT s.workspace_id, lower(btrim(s.role)) AS parent, (lower(btrim(s.role)) || '_' || nullif(regexp_replace(lower(btrim(s.slug, U&'\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000')), U&'[\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000]+', '_', 'g'), '')) AS code, btrim(s.label) AS name,
               s.description, s.sort_order, s.is_active AS active, true AS selectable
          FROM tournament.player_sub_role s
    ), used AS (
        SELECT t.workspace_id, p.role::text AS parent, btrim(p.sub_role) AS raw
          FROM tournament.player p JOIN tournament.tournament t ON t.id = p.tournament_id
         WHERE p.role::text IN ('tank', 'damage', 'support') AND regexp_replace(lower(btrim(p.sub_role, U&'\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000')), U&'[\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000]+', '_', 'g') <> ''
        UNION
        SELECT t.workspace_id, lower(btrim(r.role)), btrim(r.subrole)
          FROM balancer.registration_role r
          JOIN balancer.registration g ON g.id = r.registration_id
          JOIN tournament.tournament t ON t.id = g.tournament_id
         WHERE lower(btrim(r.role)) IN ('tank', 'damage', 'support') AND regexp_replace(lower(btrim(r.subrole, U&'\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000')), U&'[\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000]+', '_', 'g') <> ''
        UNION
        SELECT e.workspace_id, top.role, btrim(sub.role)
          FROM encounter.team_member_role top
          JOIN encounter.team_member_role sub
            ON sub.team_member_id = top.team_member_id AND sub.dimension = top.dimension
           AND sub.role NOT IN ('tank', 'damage', 'support', 'flex')
          JOIN encounter.team_member tm ON tm.id = top.team_member_id
          JOIN encounter.encounter e ON e.id = tm.encounter_id
         WHERE top.dimension = 'player_role' AND top.role IN ('tank', 'damage', 'support')
    ), off_catalog AS (
        SELECT u.workspace_id, u.parent, (u.parent || '_' || nullif(regexp_replace(lower(btrim(u.raw, U&'\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000')), U&'[\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000]+', '_', 'g'), '')) AS code, min(u.raw) AS name
          FROM used u
         WHERE NOT EXISTS (SELECT 1 FROM catalog_rows c
                            WHERE c.workspace_id = u.workspace_id AND c.parent = u.parent
                              AND ((u.parent || '_' || nullif(regexp_replace(lower(btrim(u.raw, U&'\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000')), U&'[\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000]+', '_', 'g'), '')) = c.code OR regexp_replace(lower(btrim(u.raw, U&'\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000')), U&'[\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000]+', '_', 'g') = regexp_replace(lower(btrim(c.name, U&'\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000')), U&'[\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000]+', '_', 'g')))
         GROUP BY u.workspace_id, u.parent, (u.parent || '_' || nullif(regexp_replace(lower(btrim(u.raw, U&'\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000')), U&'[\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000]+', '_', 'g'), ''))
    )
    SELECT workspace_id, parent, code, name, description, sort_order, active, selectable FROM catalog_rows
    UNION ALL
    SELECT workspace_id, parent, code, left(name, 128),
           'Kept by discipline01b: used by players or registrations, absent from the workspace sub-role catalog.',
           1000, false, false
      FROM off_catalog
) p
         GROUP BY p.workspace_id, p.code
        HAVING count(*) > 1 OR p.code IS NULL OR char_length(p.code) > 64
            OR bool_or(p.parent NOT IN ('tank', 'damage', 'support'))
         ORDER BY p.workspace_id, p.code;

\echo 'count: off-catalog sub-role values kept as inactive sub-roles'
SELECT count(*) AS off_catalog_sub_roles FROM (
    WITH catalog_rows AS (
        SELECT s.workspace_id, lower(btrim(s.role)) AS parent, (lower(btrim(s.role)) || '_' || nullif(regexp_replace(lower(btrim(s.slug, U&'\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000')), U&'[\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000]+', '_', 'g'), '')) AS code, btrim(s.label) AS name,
               s.description, s.sort_order, s.is_active AS active, true AS selectable
          FROM tournament.player_sub_role s
    ), used AS (
        SELECT t.workspace_id, p.role::text AS parent, btrim(p.sub_role) AS raw
          FROM tournament.player p JOIN tournament.tournament t ON t.id = p.tournament_id
         WHERE p.role::text IN ('tank', 'damage', 'support') AND regexp_replace(lower(btrim(p.sub_role, U&'\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000')), U&'[\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000]+', '_', 'g') <> ''
        UNION
        SELECT t.workspace_id, lower(btrim(r.role)), btrim(r.subrole)
          FROM balancer.registration_role r
          JOIN balancer.registration g ON g.id = r.registration_id
          JOIN tournament.tournament t ON t.id = g.tournament_id
         WHERE lower(btrim(r.role)) IN ('tank', 'damage', 'support') AND regexp_replace(lower(btrim(r.subrole, U&'\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000')), U&'[\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000]+', '_', 'g') <> ''
        UNION
        SELECT e.workspace_id, top.role, btrim(sub.role)
          FROM encounter.team_member_role top
          JOIN encounter.team_member_role sub
            ON sub.team_member_id = top.team_member_id AND sub.dimension = top.dimension
           AND sub.role NOT IN ('tank', 'damage', 'support', 'flex')
          JOIN encounter.team_member tm ON tm.id = top.team_member_id
          JOIN encounter.encounter e ON e.id = tm.encounter_id
         WHERE top.dimension = 'player_role' AND top.role IN ('tank', 'damage', 'support')
    ), off_catalog AS (
        SELECT u.workspace_id, u.parent, (u.parent || '_' || nullif(regexp_replace(lower(btrim(u.raw, U&'\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000')), U&'[\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000]+', '_', 'g'), '')) AS code, min(u.raw) AS name
          FROM used u
         WHERE NOT EXISTS (SELECT 1 FROM catalog_rows c
                            WHERE c.workspace_id = u.workspace_id AND c.parent = u.parent
                              AND ((u.parent || '_' || nullif(regexp_replace(lower(btrim(u.raw, U&'\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000')), U&'[\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000]+', '_', 'g'), '')) = c.code OR regexp_replace(lower(btrim(u.raw, U&'\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000')), U&'[\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000]+', '_', 'g') = regexp_replace(lower(btrim(c.name, U&'\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000')), U&'[\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000]+', '_', 'g')))
         GROUP BY u.workspace_id, u.parent, (u.parent || '_' || nullif(regexp_replace(lower(btrim(u.raw, U&'\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000')), U&'[\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000]+', '_', 'g'), ''))
    )
    SELECT workspace_id, parent, code, name, description, sort_order, active, selectable FROM catalog_rows
    UNION ALL
    SELECT workspace_id, parent, code, left(name, 128),
           'Kept by discipline01b: used by players or registrations, absent from the workspace sub-role catalog.',
           1000, false, false
      FROM off_catalog
) p WHERE NOT p.selectable;

\echo 'count: flex rows whose sub-role is dropped'
SELECT count(*) AS flex_rows_with_a_sub_role
  FROM tournament.player p
 WHERE p.role::text = 'flex' AND regexp_replace(lower(btrim(p.sub_role, U&'\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000')), U&'[\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000]+', '_', 'g') <> '';

\echo '7. roster slot maps that cannot become a team format'
        SELECT s.source, s.owner_id, s.slots
          FROM (SELECT 'workspace' AS source, w.id AS owner_id, w.default_roster_slots_json AS slots
                  FROM workspace w WHERE w.default_roster_slots_json IS NOT NULL
                UNION ALL
                SELECT 'tournament', t.id, t.roster_slots_json FROM tournament.tournament t WHERE t.roster_slots_json IS NOT NULL
                UNION ALL
                SELECT 'host', u.user_id, u.role_slots_json FROM balancer.user_config u WHERE u.role_slots_json IS NOT NULL) s
         WHERE CASE WHEN s.slots = 'null'::jsonb OR s.slots = '{}'::jsonb THEN false
                    WHEN jsonb_typeof(s.slots) <> 'object' THEN true
                    ELSE EXISTS (SELECT 1 FROM jsonb_each(s.slots) e
                                  WHERE e.key NOT IN ('tank', 'damage', 'support', 'flex')
                                     OR jsonb_typeof(e.value) <> 'number' OR e.value::text !~ '^[1-9][0-9]*$')
                      OR (SELECT sum(e.value::text::int) FROM jsonb_each(s.slots) e) NOT BETWEEN 1 AND 12
               END
         ORDER BY s.source, s.owner_id;

\echo '8. encounter roster members whose leaf role is ambiguous'
        SELECT r.team_member_id, array_agg(r.role ORDER BY r.role) AS roles
          FROM encounter.team_member_role r
         WHERE r.dimension = 'player_role'
         GROUP BY r.team_member_id
        HAVING count(*) FILTER (WHERE r.role IN ('tank', 'damage', 'support', 'flex')) > 1
            OR count(*) FILTER (WHERE r.role NOT IN ('tank', 'damage', 'support', 'flex')) > 1
            OR (count(*) FILTER (WHERE r.role NOT IN ('tank', 'damage', 'support', 'flex')) = 1
                AND count(*) FILTER (WHERE r.role IN ('tank', 'damage', 'support', 'flex')) = 0)
         ORDER BY r.team_member_id;
