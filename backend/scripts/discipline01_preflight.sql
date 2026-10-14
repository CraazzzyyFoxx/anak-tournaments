-- Run against production before the migration window. Every numbered query must return zero rows.
-- The revision runs these same checks first; tests/test_discipline01_preflight_sql.py keeps them text for text.
-- P2 appends its reference classes.

\echo '1. maps whose names collide after slugify'
SELECT s.slug, array_agg(s.id ORDER BY s.id) AS map_ids, array_agg(s.name ORDER BY s.id) AS names
  FROM (SELECT m.id, m.name, coalesce(nullif(btrim(regexp_replace(lower(btrim(m.name)), '[^a-z0-9]+', '-', 'g'), '-'), ''), 'map') AS slug FROM overwatch.map m) s
 GROUP BY s.slug
HAVING count(*) > 1
 ORDER BY s.slug;
