"""Role ontology, team formats and role assignments (V3 P2; D31-D36, D86, D88, D89, spec §14.3, §14.5, §14.6).

The second half of §14.7's ``discipline01`` (P1 Deviation 2). Seeds Overwatch's ``player_role`` exactly as
``shared.disciplines.overwatch`` declares it -- copied, not imported: a migration keeps meaning what it meant when it
ran; the startup projection then finds the rows identical. Workspace sub-roles become ``catalog.role`` rows; every role
column of §14.3's table gets its ``role_id``; ``roster.team_format`` replaces the ``*_slots_json`` columns. The old
columns stay until the gated ``discipline02``. Forward-fix only.

Revision ID: discipline01b
Revises: discipline01
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "discipline01b"
down_revision: str | Sequence[str] | None = "discipline01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

#: Python's Unicode whitespace set, pinned here rather than PostgreSQL's locale-dependent ``\s``.
SUB_ROLE_WHITESPACE = (
    r"\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680"
    r"\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000"
)
#: SQL twin of ``shared.domain.player_sub_roles.normalize_sub_role``: trim, lower-case, whitespace runs -> ``_``.
SUB_ROLE_CODE = (
    rf"regexp_replace(lower(btrim({{0}}, U&'{SUB_ROLE_WHITESPACE}')), U&'[{SUB_ROLE_WHITESPACE}]+', '_', 'g')"
)
MODULE_ROLES = "('tank', 'damage', 'support')"


def _code(expression: str) -> str:
    return SUB_ROLE_CODE.format(expression)


#: The workspace sub-roles this revision creates: the catalog's rows, then every value players, registrations and
#: encounter rosters use that no catalog row of the same workspace and role names by code or label (Deviation 1).
SUB_ROLE_PLAN = f"""
    WITH catalog_rows AS (
        SELECT s.workspace_id, lower(btrim(s.role)) AS parent, {_code("s.slug")} AS code, btrim(s.label) AS name,
               s.description, s.sort_order, s.is_active AS active, true AS selectable
          FROM tournament.player_sub_role s
    ), used AS (
        SELECT t.workspace_id, p.role::text AS parent, btrim(p.sub_role) AS raw
          FROM tournament.player p JOIN tournament.tournament t ON t.id = p.tournament_id
         WHERE p.role::text IN {MODULE_ROLES} AND {_code("p.sub_role")} <> ''
        UNION
        SELECT t.workspace_id, lower(btrim(r.role)), btrim(r.subrole)
          FROM balancer.registration_role r
          JOIN balancer.registration g ON g.id = r.registration_id
          JOIN tournament.tournament t ON t.id = g.tournament_id
         WHERE lower(btrim(r.role)) IN {MODULE_ROLES} AND {_code("r.subrole")} <> ''
        UNION
        SELECT e.workspace_id, top.role, btrim(sub.role)
          FROM encounter.team_member_role top
          JOIN encounter.team_member_role sub
            ON sub.team_member_id = top.team_member_id AND sub.dimension = top.dimension
           AND sub.role NOT IN ('tank', 'damage', 'support', 'flex')
          JOIN encounter.team_member tm ON tm.id = top.team_member_id
          JOIN encounter.encounter e ON e.id = tm.encounter_id
         WHERE top.dimension = 'player_role' AND top.role IN {MODULE_ROLES}
    ), off_catalog AS (
        SELECT u.workspace_id, u.parent, {_code("u.raw")} AS code, min(u.raw) AS name
          FROM used u
         WHERE NOT EXISTS (SELECT 1 FROM catalog_rows c
                            WHERE c.workspace_id = u.workspace_id AND c.parent = u.parent
                              AND {_code("u.raw")} IN (c.code, {_code("c.name")}))
         GROUP BY u.workspace_id, u.parent, {_code("u.raw")}
    )
    SELECT workspace_id, parent, code, name, description, sort_order, active, selectable FROM catalog_rows
    UNION ALL
    SELECT workspace_id, parent, code, left(name, 128),
           'Kept by discipline01b: used by players or registrations, absent from the workspace sub-role catalog.',
           1000, false, false
      FROM off_catalog
"""

#: Questions the data must answer before anything moves; a non-empty answer stops the revision (spec §14.5, classes
#: 2-3). Numbered after discipline01's in backend/scripts/discipline01_preflight.sql, text for text
#: (tests/test_discipline01_preflight_sql.py).
PREFLIGHT: tuple[tuple[str, str], ...] = (
    (
        "role values outside tank|damage|support|flex",
        """
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
         ORDER BY v.source, v.value
        """,
    ),
    (
        "flex where a role is required",
        """
        SELECT v.source, v.row_id
          FROM (SELECT 'balancer.registration_role' AS source, r.id AS row_id, lower(btrim(r.role)) AS value
                  FROM balancer.registration_role r
                UNION ALL
                SELECT 'balancer.custom_game_player_role', c.custom_game_player_id, lower(btrim(c.role))
                  FROM balancer.custom_game_player_role c) v
         WHERE v.value = 'flex'
         ORDER BY v.source, v.row_id
        """,
    ),
    (
        "encounter roster roles outside dimension player_role",
        """
        SELECT r.dimension, count(*) AS row_count
          FROM encounter.team_member_role r
         WHERE r.dimension <> 'player_role'
         GROUP BY r.dimension
         ORDER BY r.dimension
        """,
    ),
    (
        "workspace sub-roles that cannot become catalog roles",
        f"""
        SELECT p.workspace_id, p.code, array_agg(p.parent ORDER BY p.parent) AS parents
          FROM ({SUB_ROLE_PLAN}) p
         GROUP BY p.workspace_id, p.code
        HAVING count(*) > 1 OR p.code IN ('tank', 'damage', 'support', 'flex', '') OR char_length(p.code) > 64
            OR bool_or(p.parent NOT IN {MODULE_ROLES})
         ORDER BY p.workspace_id, p.code
        """,
    ),
)
PREFLIGHT_SAMPLE = 20

#: Not stops (Deviation 1): values kept as inactive sub-roles, and flex rows whose sub-role has no role to hang on.
OFF_CATALOG_SUB_ROLES = f"""
SELECT count(*) AS off_catalog_sub_roles FROM ({SUB_ROLE_PLAN}) p WHERE NOT p.selectable
"""
FLEX_SUB_ROLES = f"""
SELECT count(*) AS flex_rows_with_a_sub_role
  FROM tournament.player p
 WHERE p.role::text = 'flex' AND {_code("p.sub_role")} <> ''
"""

#: The leaf a legacy ``(role, sub_role)`` pair names in one workspace: the Overwatch sub-role matched by code, else by
#: name, under that role; else the module role; NULL for ``flex`` or no role (D86). Kept verbatim in
#: backend/scripts/discipline01_reconcile.sql.
LEAF_FUNCTION = f"""
CREATE FUNCTION pg_temp.discipline01b_leaf(ws BIGINT, top TEXT, sub TEXT) RETURNS BIGINT
LANGUAGE sql STABLE AS $$
  SELECT coalesce(
    (SELECT r.id
       FROM catalog.role r
       JOIN catalog.role m ON m.id = r.parent_role_id
       JOIN catalog.role_dimension d ON d.id = m.dimension_id
      WHERE d.discipline = 'overwatch' AND d.code = 'player_role' AND m.workspace_id IS NULL
        AND m.code = lower(btrim(top)) AND r.workspace_id = ws
        AND {_code("sub")} <> '' AND {_code("sub")} IN (r.code, {_code("r.name")})
      ORDER BY (r.code = {_code("sub")}) DESC, r.id
      LIMIT 1),
    (SELECT m.id
       FROM catalog.role m
       JOIN catalog.role_dimension d ON d.id = m.dimension_id
      WHERE d.discipline = 'overwatch' AND d.code = 'player_role' AND m.workspace_id IS NULL
        AND m.code = lower(btrim(top))))
$$
"""


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
        raise RuntimeError("discipline01b pre-flight failed; resolve these rows by hand first:\n" + "\n".join(failures))


_SCHEMA = (
    "ALTER TABLE workspace ADD COLUMN disciplines_enabled VARCHAR(32)[] NOT NULL DEFAULT '{overwatch}'",
    """
    CREATE TABLE catalog.role_dimension (
      id             BIGSERIAL PRIMARY KEY,
      discipline     VARCHAR(32) NOT NULL CONSTRAINT fk_role_dimension_discipline REFERENCES catalog.discipline (code),
      code           VARCHAR(32) NOT NULL,
      name           VARCHAR(64) NOT NULL,
      selection_mode VARCHAR(8) NOT NULL CONSTRAINT ck_role_dimension_selection_mode CHECK (selection_mode IN ('single', 'multi')),
      rated          BOOLEAN NOT NULL DEFAULT false,
      active         BOOLEAN NOT NULL DEFAULT true,
      sort_order     INTEGER NOT NULL DEFAULT 0,
      CONSTRAINT uq_role_dimension_code UNIQUE (discipline, code),
      CONSTRAINT uq_role_dimension_key UNIQUE (id, discipline)
    )
    """,
    "CREATE UNIQUE INDEX uq_role_dimension_rated ON catalog.role_dimension (discipline) WHERE rated",
    """
    CREATE TABLE catalog.role (
      id             BIGSERIAL PRIMARY KEY,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at     TIMESTAMPTZ,
      dimension_id   BIGINT NOT NULL CONSTRAINT fk_role_dimension REFERENCES catalog.role_dimension (id),
      workspace_id   BIGINT CONSTRAINT fk_role_workspace REFERENCES workspace (id) ON DELETE CASCADE,
      parent_role_id BIGINT,
      code           VARCHAR(64) NOT NULL,
      name           VARCHAR(128) NOT NULL,
      description    TEXT,
      selectable     BOOLEAN NOT NULL DEFAULT true,
      active         BOOLEAN NOT NULL DEFAULT true,
      sort_order     INTEGER NOT NULL DEFAULT 0,
      attrs          JSONB NOT NULL DEFAULT '{}'::jsonb,
      CONSTRAINT uq_role_key UNIQUE (id, dimension_id),
      CONSTRAINT fk_role_parent FOREIGN KEY (parent_role_id, dimension_id) REFERENCES catalog.role (id, dimension_id),
      CONSTRAINT ck_role_workspace_is_child CHECK (workspace_id IS NULL OR parent_role_id IS NOT NULL),
      CONSTRAINT ck_role_attrs CHECK (jsonb_typeof(attrs) = 'object')
    )
    """,
    "CREATE UNIQUE INDEX uq_role_module_code ON catalog.role (dimension_id, code) WHERE workspace_id IS NULL",
    """
    CREATE UNIQUE INDEX uq_role_workspace_code ON catalog.role (dimension_id, workspace_id, code)
     WHERE workspace_id IS NOT NULL
    """,
)

_ONTOLOGY = (
    """
    INSERT INTO catalog.role_dimension (discipline, code, name, selection_mode, rated, sort_order)
    VALUES ('overwatch', 'player_role', 'Role', 'single', true, 0)
    """,
    """
    INSERT INTO catalog.role (dimension_id, code, name, sort_order)
    SELECT d.id, v.code, v.name, v.sort_order
      FROM catalog.role_dimension d
     CROSS JOIN (VALUES ('tank', 'Tank', 0), ('damage', 'Damage', 1), ('support', 'Support', 2)) AS v(code, name, sort_order)
     WHERE d.discipline = 'overwatch' AND d.code = 'player_role'
    """,
    LEAF_FUNCTION,
)

_SUB_ROLES = (
    f"""
    INSERT INTO catalog.role (dimension_id, workspace_id, parent_role_id, code, name, description, selectable, active, sort_order)
    SELECT m.dimension_id, p.workspace_id, m.id, p.code, p.name, p.description, p.selectable, p.active, p.sort_order
      FROM ({SUB_ROLE_PLAN}) p
      JOIN catalog.role m ON m.workspace_id IS NULL AND m.code = p.parent
      JOIN catalog.role_dimension d ON d.id = m.dimension_id AND d.discipline = 'overwatch' AND d.code = 'player_role'
     ORDER BY p.workspace_id, p.parent, p.sort_order, p.code
    """,
)


def upgrade() -> None:
    # discipline01 ran in this same transaction and leaves RI events pending on tables altered below.
    op.execute("SET CONSTRAINTS ALL IMMEDIATE")
    _preflight()
    for statement in (*_SCHEMA, *_ONTOLOGY, *_SUB_ROLES):
        op.execute(statement)
    op.execute("SET CONSTRAINTS ALL DEFERRED")


def downgrade() -> None:
    raise RuntimeError("discipline01b is forward-fix only; restore from a backup to go back")
