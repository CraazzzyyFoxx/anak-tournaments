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
  FROM overwatch.catalog_alias_miss a;

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
