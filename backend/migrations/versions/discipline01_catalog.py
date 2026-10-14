"""The catalog of every discipline (V3 P1; D84, D85, D101, spec §14.2).

``catalog.entity`` replaces ``overwatch.hero/map/gamemode`` with new ids, ``catalog.alias_miss`` replaces
``overwatch.catalog_alias_miss``, ``catalog.entity_legacy`` maps the old ids for the reconcile and the redirect of old
URLs. New ids start above every id the three legacy tables ever issued (their sequences AND their maxima): an old id
and a new id never coincide, so a hard reference left unrewritten fails its new FK and a soft one left behind shows in
``scripts/discipline01_reconcile.sql``.

``overwatch.*`` stays until the gated ``discipline02``. Forward-fix only.

Revision ID: discipline01
Revises: mixround01
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "discipline01"
down_revision: str | Sequence[str] | None = "mixround01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

#: SQL twin of the map slug rule (``re.sub(r"[^a-z0-9]+", "-", name.strip().lower()).strip("-") or "map"``, which
#: also names every mirrored map image). Copied, not imported: a migration keeps meaning what it meant when it ran.
MAP_SLUG = "coalesce(nullif(btrim(regexp_replace(lower(btrim(m.name)), '[^a-z0-9]+', '-', 'g'), '-'), ''), 'map')"

#: Questions the data must answer before anything moves; a non-empty answer stops the revision (spec §14.5).
#: Kept text for text in backend/scripts/discipline01_preflight.sql (tests/test_discipline01_preflight_sql.py).
PREFLIGHT: tuple[tuple[str, str], ...] = (
    (
        "maps whose names collide after slugify",
        f"""
        SELECT s.slug, array_agg(s.id ORDER BY s.id) AS map_ids, array_agg(s.name ORDER BY s.id) AS names
          FROM (SELECT m.id, m.name, {MAP_SLUG} AS slug FROM overwatch.map m) s
         GROUP BY s.slug
        HAVING count(*) > 1
         ORDER BY s.slug
        """,
    ),
    (
        "catalog values too long",
        f"""
        SELECT v.legacy_kind, v.legacy_id, v.field, v.value_length
          FROM (
            SELECT 'hero' AS legacy_kind, h.id AS legacy_id, 'slug' AS field,
                   char_length(h.slug) AS value_length, 64 AS max_length FROM overwatch.hero h
            UNION ALL
            SELECT 'gamemode', g.id, 'slug', char_length(g.slug), 64 FROM overwatch.gamemode g
            UNION ALL
            SELECT 'map', m.id, 'slug', char_length({MAP_SLUG}), 64 FROM overwatch.map m
            UNION ALL
            SELECT 'hero', h.id, 'name', char_length(h.name), 128 FROM overwatch.hero h
            UNION ALL
            SELECT 'gamemode', g.id, 'name', char_length(g.name), 128 FROM overwatch.gamemode g
            UNION ALL
            SELECT 'map', m.id, 'name', char_length(m.name), 128 FROM overwatch.map m
          ) v
         WHERE v.value_length > v.max_length
         ORDER BY v.legacy_kind, v.legacy_id, v.field
        """,
    ),
)
PREFLIGHT_SAMPLE = 20


def _preflight() -> None:
    bind = op.get_bind()
    failures: list[str] = []
    for question, query in PREFLIGHT:
        rows = bind.execute(sa.text(query)).mappings().all()
        if rows:
            sample = "; ".join(str(dict(row)) for row in rows[:PREFLIGHT_SAMPLE])
            rest = len(rows) - PREFLIGHT_SAMPLE
            failures.append(f"{question} [{len(rows)}]: {sample}" + (f"; … {rest} more" if rest > 0 else ""))
    if failures:
        raise RuntimeError("discipline01 pre-flight failed; resolve these rows by hand first:\n" + "\n".join(failures))


_SCHEMA = (
    "INSERT INTO catalog.discipline (code, name) VALUES ('lol', 'League of Legends') ON CONFLICT (code) DO NOTHING",
    """
    CREATE TABLE catalog.entity (
      id          BIGSERIAL PRIMARY KEY,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at  TIMESTAMPTZ,
      discipline  VARCHAR(32) NOT NULL CONSTRAINT fk_entity_discipline REFERENCES catalog.discipline (code),
      kind        VARCHAR(16) NOT NULL,
      slug        VARCHAR(64) NOT NULL,
      name        VARCHAR(128) NOT NULL,
      image_path  VARCHAR,
      parent_id   BIGINT,
      attrs       JSONB NOT NULL DEFAULT '{}'::jsonb,
      aliases     JSONB NOT NULL DEFAULT '[]'::jsonb,
      active      BOOLEAN NOT NULL DEFAULT true,
      CONSTRAINT ck_entity_kind CHECK (kind IN ('character', 'map', 'mode')),
      CONSTRAINT ck_entity_attrs CHECK (jsonb_typeof(attrs) = 'object'),
      CONSTRAINT ck_entity_aliases CHECK (jsonb_typeof(aliases) = 'array'),
      CONSTRAINT uq_entity_slug UNIQUE (discipline, kind, slug),
      CONSTRAINT uq_entity_name UNIQUE (discipline, kind, name),
      CONSTRAINT uq_entity_id_kind UNIQUE (id, kind),
      CONSTRAINT uq_entity_id_discipline UNIQUE (id, discipline),
      CONSTRAINT uq_entity_key UNIQUE (id, discipline, kind),
      CONSTRAINT fk_entity_parent FOREIGN KEY (parent_id, discipline) REFERENCES catalog.entity (id, discipline)
    )
    """,
    """
    CREATE TABLE catalog.alias_miss (
      id                 BIGSERIAL PRIMARY KEY,
      created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at         TIMESTAMPTZ,
      discipline         VARCHAR(32) NOT NULL CONSTRAINT fk_alias_miss_discipline REFERENCES catalog.discipline (code),
      kind               VARCHAR(16) NOT NULL CONSTRAINT ck_alias_miss_kind CHECK (kind IN ('character', 'map', 'mode')),
      raw_name           VARCHAR(128) NOT NULL,
      occurrences        INTEGER NOT NULL DEFAULT 1,
      first_seen_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_seen_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_ingest_job_id BIGINT,
      resolved_at        TIMESTAMPTZ,
      CONSTRAINT uq_alias_miss UNIQUE (discipline, kind, raw_name)
    )
    """,
    """
    CREATE TABLE catalog.entity_legacy (
      legacy_kind VARCHAR(16) NOT NULL CONSTRAINT ck_entity_legacy_kind CHECK (legacy_kind IN ('hero', 'map', 'gamemode')),
      legacy_id   BIGINT NOT NULL,
      entity_id   BIGINT NOT NULL CONSTRAINT fk_entity_legacy_entity REFERENCES catalog.entity (id),
      PRIMARY KEY (legacy_kind, legacy_id)
    )
    """,
)

_NEXT_ENTITY_ID = "nextval(pg_get_serial_sequence('catalog.entity', 'id'))"

# Set-based. nextval in an ordered select list runs after ORDER BY (PG >= 9.6): ids follow the legacy order.
_COPY = (
    """
    SELECT setval(pg_get_serial_sequence('catalog.entity', 'id'), greatest(
      (SELECT last_value FROM overwatch.hero_id_seq),
      (SELECT last_value FROM overwatch.map_id_seq),
      (SELECT last_value FROM overwatch.gamemode_id_seq),
      (SELECT coalesce(max(id), 1) FROM overwatch.hero),
      (SELECT coalesce(max(id), 1) FROM overwatch.map),
      (SELECT coalesce(max(id), 1) FROM overwatch.gamemode)
    ))
    """,
    """
    CREATE TEMP TABLE discipline01_entity (legacy_kind VARCHAR(16), legacy_id BIGINT, entity_id BIGINT) ON COMMIT DROP
    """,
    f"INSERT INTO discipline01_entity SELECT 'gamemode', g.id, {_NEXT_ENTITY_ID} FROM overwatch.gamemode g ORDER BY g.id",
    f"INSERT INTO discipline01_entity SELECT 'hero', h.id, {_NEXT_ENTITY_ID} FROM overwatch.hero h ORDER BY h.id",
    f"INSERT INTO discipline01_entity SELECT 'map', m.id, {_NEXT_ENTITY_ID} FROM overwatch.map m ORDER BY m.id",
    """
    INSERT INTO catalog.entity (id, created_at, updated_at, discipline, kind, slug, name, image_path, attrs, aliases)
    SELECT x.entity_id, g.created_at, g.updated_at, 'overwatch', 'mode', g.slug, g.name, g.image_path,
           jsonb_strip_nulls(jsonb_build_object('description', g.description)), g.aliases
      FROM discipline01_entity x JOIN overwatch.gamemode g ON g.id = x.legacy_id
     WHERE x.legacy_kind = 'gamemode'
    """,
    """
    INSERT INTO catalog.entity (id, created_at, updated_at, discipline, kind, slug, name, image_path, attrs, aliases)
    SELECT x.entity_id, h.created_at, h.updated_at, 'overwatch', 'character', h.slug, h.name, h.image_path,
           jsonb_build_object('class', h.type::text, 'color', h.color), h.aliases
      FROM discipline01_entity x JOIN overwatch.hero h ON h.id = x.legacy_id
     WHERE x.legacy_kind = 'hero'
    """,
    f"""
    INSERT INTO catalog.entity
           (id, created_at, updated_at, discipline, kind, slug, name, image_path, parent_id, attrs, aliases)
    SELECT x.entity_id, m.created_at, m.updated_at, 'overwatch', 'map', {MAP_SLUG}, m.name, m.image_path, p.entity_id,
           jsonb_build_object('in_competitive', m.in_competitive), m.aliases
      FROM discipline01_entity x
      JOIN overwatch.map m ON m.id = x.legacy_id
      JOIN discipline01_entity p ON p.legacy_kind = 'gamemode' AND p.legacy_id = m.gamemode_id
     WHERE x.legacy_kind = 'map'
    """,
    "INSERT INTO catalog.entity_legacy (legacy_kind, legacy_id, entity_id) SELECT legacy_kind, legacy_id, entity_id FROM discipline01_entity",
    """
    INSERT INTO catalog.alias_miss
           (created_at, updated_at, discipline, kind, raw_name, occurrences, first_seen_at, last_seen_at,
            last_ingest_job_id, resolved_at)
    SELECT a.created_at, a.updated_at, 'overwatch',
           CASE a.entity_type::text WHEN 'hero' THEN 'character' WHEN 'gamemode' THEN 'mode' ELSE 'map' END,
           a.raw_name, a.occurrences, a.first_seen_at, a.last_seen_at, a.last_log_record_id, a.resolved_at
      FROM overwatch.catalog_alias_miss a ORDER BY a.id
    """,
)


def upgrade() -> None:
    _preflight()
    for statement in (*_SCHEMA, *_COPY):
        op.execute(statement)


def downgrade() -> None:
    raise RuntimeError("discipline01 is forward-fix only; restore from a backup to go back")
