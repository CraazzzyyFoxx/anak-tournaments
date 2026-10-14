-- Run against production before the migration window. Every numbered query must return zero rows.
-- The revision runs these same checks first; tests/test_discipline01_preflight_sql.py keeps them text for text.
-- P2 appends its reference classes.

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
