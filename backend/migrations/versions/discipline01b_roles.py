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

_CONSTRAINTS_ON = """
    SELECT c.conname FROM pg_constraint c
     WHERE c.conrelid = CAST(:table AS regclass) AND c.contype = :contype
       AND (:contype = 'p' OR
            ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
                    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
                   ORDER BY k.ord) = CAST(:columns AS text[]))
     ORDER BY c.conname
"""


def _name(table: str, columns: Sequence[str], contype: str) -> str:
    bind = op.get_bind()
    names = (
        bind.execute(sa.text(_CONSTRAINTS_ON), {"table": table, "columns": list(columns), "contype": contype})
        .scalars()
        .all()
    )
    if len(names) != 1:
        raise RuntimeError(f"discipline01b expected exactly one {contype} on {table}{tuple(columns)}, found {names}")
    return bind.dialect.identifier_preparer.quote(names[0])


def _drop_constraint(table: str, columns: Sequence[str], contype: str):
    def run() -> None:
        op.execute(f"ALTER TABLE {table} DROP CONSTRAINT {_name(table, columns, contype)}")

    return run


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


def _workspace_code(parent: str, slug: str) -> str:
    """SQL mirror of ``workspace_sub_role_code`` for a normalized parent expression and a legacy slug."""
    return f"({parent} || '_' || nullif({_code(slug)}, ''))"


#: The workspace sub-roles this revision creates: the catalog's rows, then every value players, registrations and
#: encounter rosters use that no catalog row of the same workspace and role names by code or label (Deviation 1).
SUB_ROLE_PLAN = f"""
    WITH catalog_rows AS (
        SELECT s.workspace_id, lower(btrim(s.role)) AS parent, {_workspace_code("lower(btrim(s.role))", "s.slug")} AS code, btrim(s.label) AS name,
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
        SELECT u.workspace_id, u.parent, {_workspace_code("u.parent", "u.raw")} AS code, min(u.raw) AS name
          FROM used u
         WHERE NOT EXISTS (SELECT 1 FROM catalog_rows c
                            WHERE c.workspace_id = u.workspace_id AND c.parent = u.parent
                              AND ({_workspace_code("u.parent", "u.raw")} = c.code OR {_code("u.raw")} = {_code("c.name")}))
         GROUP BY u.workspace_id, u.parent, {_workspace_code("u.parent", "u.raw")}
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
        HAVING count(*) > 1 OR p.code IS NULL OR char_length(p.code) > 64
            OR bool_or(p.parent NOT IN {MODULE_ROLES})
         ORDER BY p.workspace_id, p.code
        """,
    ),
    (
        "roster slot maps that cannot become a team format",
        """
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
         ORDER BY s.source, s.owner_id
        """,
    ),
    (
        "encounter roster members whose leaf role is ambiguous",
        """
        SELECT r.team_member_id, array_agg(r.role ORDER BY r.role) AS roles
          FROM encounter.team_member_role r
         WHERE r.dimension = 'player_role'
         GROUP BY r.team_member_id
        HAVING count(*) FILTER (WHERE r.role IN ('tank', 'damage', 'support', 'flex')) > 1
            OR count(*) FILTER (WHERE r.role NOT IN ('tank', 'damage', 'support', 'flex')) > 1
            OR (count(*) FILTER (WHERE r.role NOT IN ('tank', 'damage', 'support', 'flex')) = 1
                AND count(*) FILTER (WHERE r.role IN ('tank', 'damage', 'support', 'flex')) = 0)
         ORDER BY r.team_member_id
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
        AND {_code("sub")} <> ''
        AND ({_workspace_code("m.code", "sub")} = r.code OR {_code("sub")} = {_code("r.name")})
      ORDER BY (r.code = {_workspace_code("m.code", "sub")}) DESC, r.id
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


#: §14.3: one leaf on the rated dimension; flex holds no assignment (D86).
#: Defer leaf checks so workspace-owned roles and their assignment owners can cascade in either order.
_PLAYER_ROLES = (
    """
    CREATE TABLE tournament.player_role (
      player_id    BIGINT NOT NULL CONSTRAINT fk_player_role_player REFERENCES tournament.player (id) ON DELETE CASCADE,
      dimension_id BIGINT NOT NULL,
      role_id      BIGINT NOT NULL,
      PRIMARY KEY (player_id, role_id),
      CONSTRAINT fk_player_role_role FOREIGN KEY (role_id, dimension_id) REFERENCES catalog.role (id, dimension_id) DEFERRABLE INITIALLY DEFERRED
    )
    """,
    """
    INSERT INTO tournament.player_role (player_id, dimension_id, role_id)
    SELECT p.id, r.dimension_id, r.id
      FROM tournament.player p
      JOIN tournament.tournament t ON t.id = p.tournament_id
      JOIN catalog.role r ON r.id = pg_temp.discipline01b_leaf(t.workspace_id, p.role::text, p.sub_role)
     WHERE p.role::text IN ('tank', 'damage', 'support')
    """,
)


_REGISTRATION_ROLES = (
    "ALTER TABLE balancer.registration_role ADD COLUMN dimension_id BIGINT, ADD COLUMN role_id BIGINT",
    """
    UPDATE balancer.registration_role rr
       SET role_id = r.id, dimension_id = r.dimension_id
      FROM balancer.registration g
      JOIN tournament.tournament t ON t.id = g.tournament_id,
           catalog.role r
     WHERE g.id = rr.registration_id
       AND r.id = pg_temp.discipline01b_leaf(t.workspace_id, rr.role, rr.subrole)
    """,
    _drop_constraint("balancer.registration_role", ("registration_id", "role"), "u"),
    """
    ALTER TABLE balancer.registration_role
      ALTER COLUMN role DROP NOT NULL,
      ALTER COLUMN dimension_id SET NOT NULL,
      ALTER COLUMN role_id SET NOT NULL,
      ADD CONSTRAINT fk_registration_role_role FOREIGN KEY (role_id, dimension_id) REFERENCES catalog.role (id, dimension_id) DEFERRABLE INITIALLY DEFERRED,
      ADD CONSTRAINT uq_registration_role_role UNIQUE (registration_id, role_id)
    """,
)


def _rename_legacy_roster_roles() -> None:
    """Keep the original rows for reconciliation; move their PK index name with them."""
    pkey = _name("encounter.team_member_role", (), "p")
    op.execute("ALTER TABLE encounter.team_member_role RENAME TO team_member_role_legacy")
    op.execute(
        f"ALTER TABLE encounter.team_member_role_legacy RENAME CONSTRAINT {pkey} TO team_member_role_legacy_pkey"
    )


#: §14.3: role + sub-role becomes one leaf; Deviation 5 preserves the legacy table.
_TEAM_MEMBER_ROLES = (
    _rename_legacy_roster_roles,
    """
    CREATE TABLE encounter.team_member_role (
      team_member_id BIGINT NOT NULL CONSTRAINT fk_team_member_role_member REFERENCES encounter.team_member (id) ON DELETE CASCADE,
      dimension_id   BIGINT NOT NULL,
      role_id        BIGINT NOT NULL,
      PRIMARY KEY (team_member_id, role_id),
      CONSTRAINT fk_team_member_role_role FOREIGN KEY (role_id, dimension_id) REFERENCES catalog.role (id, dimension_id) DEFERRABLE INITIALLY DEFERRED
    )
    """,
    """
    INSERT INTO encounter.team_member_role (team_member_id, dimension_id, role_id)
    SELECT top.team_member_id, r.dimension_id, r.id
      FROM encounter.team_member_role_legacy top
      JOIN encounter.team_member tm ON tm.id = top.team_member_id
      JOIN encounter.encounter e ON e.id = tm.encounter_id
      LEFT JOIN encounter.team_member_role_legacy sub
        ON sub.team_member_id = top.team_member_id AND sub.dimension = 'player_role'
       AND sub.role NOT IN ('tank', 'damage', 'support', 'flex')
      JOIN catalog.role r ON r.id = pg_temp.discipline01b_leaf(e.workspace_id, top.role, sub.role)
     WHERE top.dimension = 'player_role' AND top.role IN ('tank', 'damage', 'support')
    """,
)


#: §14.3: mix preferences refer only to module roles on the owning mix's rated dimension.
_MIX_ROLES = (
    "ALTER TABLE balancer.custom_game_player_role ADD COLUMN dimension_id BIGINT, ADD COLUMN role_id BIGINT",
    """
    UPDATE balancer.custom_game_player_role pr
       SET role_id = r.id, dimension_id = r.dimension_id
      FROM balancer.custom_game_player p
      JOIN balancer.custom_game g ON g.id = p.custom_game_id,
           catalog.role r
      JOIN catalog.role_dimension d ON d.id = r.dimension_id
     WHERE p.id = pr.custom_game_player_id AND d.discipline = g.discipline AND d.rated
       AND r.workspace_id IS NULL AND r.code = lower(btrim(pr.role))
    """,
    _drop_constraint("balancer.custom_game_player_role", (), "p"),
    """
    ALTER TABLE balancer.custom_game_player_role
      ALTER COLUMN role DROP NOT NULL,
      ALTER COLUMN dimension_id SET NOT NULL,
      ALTER COLUMN role_id SET NOT NULL,
      ADD CONSTRAINT custom_game_player_role_pkey PRIMARY KEY (custom_game_player_id, role_id),
      ADD CONSTRAINT fk_custom_game_player_role_role FOREIGN KEY (role_id, dimension_id) REFERENCES catalog.role (id, dimension_id) DEFERRABLE INITIALLY DEFERRED
    """,
)

#: §14.3: draft decisions reference module roles; flex is an open slot, not a role.
_DRAFT_ROLES = tuple(
    statement
    for table, column, new in (
        ("balancer.draft_player", "captain_role", "captain_role_id"),
        ("balancer.draft_pick", "target_role", "target_role_id"),
    )
    for statement in (
        f"ALTER TABLE {table} ADD COLUMN dimension_id BIGINT, ADD COLUMN {new} BIGINT",
        f"""
        UPDATE {table} x
           SET {new} = r.id, dimension_id = r.dimension_id
          FROM balancer.draft_session s
          JOIN tournament.tournament t ON t.id = s.tournament_id,
               catalog.role r
          JOIN catalog.role_dimension d ON d.id = r.dimension_id
         WHERE s.id = x.session_id AND d.discipline = t.discipline AND d.rated
           AND r.workspace_id IS NULL AND r.code = lower(btrim(x.{column}))
        """,
        f"""
        ALTER TABLE {table} ADD CONSTRAINT fk_{table.split(".")[1]}_{new.removesuffix("_id")}
          FOREIGN KEY ({new}, dimension_id) REFERENCES catalog.role (id, dimension_id)
          DEFERRABLE INITIALLY DEFERRED
        """,
    )
)


def upgrade() -> None:
    # discipline01 ran in this same transaction and leaves RI events pending on tables altered below.
    op.execute("SET CONSTRAINTS ALL IMMEDIATE")
    _preflight()
    for statement in (
        *_SCHEMA,
        *_ONTOLOGY,
        *_SUB_ROLES,
        *_TEAM_FORMATS,
        *_CONFIG_JSON,
        *_PLAYER_ROLES,
        *_REGISTRATION_ROLES,
        *_TEAM_MEMBER_ROLES,
        *_MIX_ROLES,
        *_DRAFT_ROLES,
    ):
        if callable(statement):
            statement()
        else:
            op.execute(statement)
    op.execute("SET CONSTRAINTS ALL DEFERRED")


def downgrade() -> None:
    raise RuntimeError("discipline01b is forward-fix only; restore from a backup to go back")


#: Exact carried semantics and an independent owner set, shared with the operator's reconciliation SQL.
TEAM_FORMAT_RECONCILE = """
SELECT 'team formats', coalesce(o.tournament_id, o.custom_game_id, o.workspace_id),
       CASE WHEN o.tournament_id IS NOT NULL THEN 'tournament'
            WHEN o.custom_game_id IS NOT NULL THEN 'mix' ELSE 'workspace' END,
       EXISTS (SELECT 1 FROM roster.team_format f
                WHERE f.workspace_id = o.workspace_id AND f.discipline = o.discipline
                  AND f.tournament_id IS NOT DISTINCT FROM o.tournament_id
                  AND f.custom_game_id IS NOT DISTINCT FROM o.custom_game_id
                  AND f.starter_min = total.slots AND f.starter_max = total.slots
                  AND f.substitute_min = 0 AND f.substitute_max = 0
                  AND (SELECT coalesce(jsonb_agg(jsonb_build_array(d.code, fd.mode,
                                      fd.player_min_assignments, fd.player_max_assignments) ORDER BY d.code), '[]'::jsonb)
                         FROM roster.team_format_dimension fd JOIN catalog.role_dimension d ON d.id = fd.dimension_id
                        WHERE fd.team_format_id = f.id)
                      = jsonb_build_array(jsonb_build_array('player_role',
                          CASE WHEN EXISTS (SELECT 1 FROM jsonb_object_keys(o.slots) k WHERE k <> 'flex')
                               THEN 'enforced' ELSE 'off' END, NULL, NULL))
                  AND (SELECT coalesce(jsonb_agg(jsonb_build_array(d.code, r.code, r.workspace_id,
                                      rr.hard_min, rr.hard_max, rr.recommended_min, rr.recommended_max,
                                      rr.include_descendants) ORDER BY d.code, r.code, r.workspace_id), '[]'::jsonb)
                         FROM roster.format_role_rule rr
                         JOIN catalog.role r ON r.id = rr.role_id
                         JOIN catalog.role_dimension d ON d.id = rr.dimension_id
                        WHERE rr.team_format_id = f.id)
                      = (SELECT coalesce(jsonb_agg(jsonb_build_array('player_role', e.key, NULL,
                                        e.value::int, e.value::int, NULL, NULL, true) ORDER BY e.key), '[]'::jsonb)
                           FROM jsonb_each_text(o.slots) e WHERE e.key <> 'flex'))
  FROM roster.team_format_legacy o
 CROSS JOIN LATERAL (SELECT sum(e.value::int) AS slots FROM jsonb_each_text(o.slots) e) total
"""


#: §14.3 verbatim, with names for the constraints the spec leaves unnamed.
_TEAM_FORMAT_SCHEMA = (
    "CREATE SCHEMA roster",
    """
    CREATE TABLE roster.team_format (
      id             BIGSERIAL PRIMARY KEY,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at     TIMESTAMPTZ,
      workspace_id   BIGINT NOT NULL CONSTRAINT fk_team_format_workspace REFERENCES workspace (id) ON DELETE CASCADE,
      discipline     VARCHAR(32) NOT NULL CONSTRAINT fk_team_format_discipline REFERENCES catalog.discipline (code),
      tournament_id  BIGINT,
      custom_game_id BIGINT,
      preset_code    VARCHAR(64),
      name           VARCHAR(128) NOT NULL,
      starter_min    INTEGER NOT NULL,
      starter_max    INTEGER NOT NULL,
      substitute_min INTEGER NOT NULL DEFAULT 0,
      substitute_max INTEGER NOT NULL DEFAULT 0,
      CONSTRAINT ck_team_format_owner CHECK (num_nonnulls(tournament_id, custom_game_id) <= 1),
      CONSTRAINT ck_team_format_sizes CHECK (1 <= starter_min AND starter_min <= starter_max
                                             AND 0 <= substitute_min AND substitute_min <= substitute_max),
      CONSTRAINT uq_team_format_key UNIQUE (id, discipline),
      CONSTRAINT uq_team_format_tournament UNIQUE (tournament_id),
      CONSTRAINT uq_team_format_custom_game UNIQUE (custom_game_id),
      CONSTRAINT fk_team_format_tournament FOREIGN KEY (tournament_id, workspace_id, discipline)
        REFERENCES tournament.tournament (id, workspace_id, discipline) ON DELETE CASCADE,
      CONSTRAINT fk_team_format_custom_game FOREIGN KEY (custom_game_id, workspace_id, discipline)
        REFERENCES balancer.custom_game (id, workspace_id, discipline) ON DELETE CASCADE
    )
    """,
    """
    CREATE UNIQUE INDEX uq_team_format_workspace_default ON roster.team_format (workspace_id, discipline)
      WHERE tournament_id IS NULL AND custom_game_id IS NULL
    """,
    """
    CREATE TABLE roster.team_format_dimension (
      team_format_id          BIGINT NOT NULL,
      discipline              VARCHAR(32) NOT NULL,
      dimension_id            BIGINT NOT NULL,
      mode                    VARCHAR(16) NOT NULL CONSTRAINT ck_tfd_mode CHECK (mode IN ('off', 'informational', 'preference', 'enforced')),
      player_min_assignments  INTEGER,
      player_max_assignments  INTEGER,
      PRIMARY KEY (team_format_id, dimension_id),
      CONSTRAINT fk_tfd_format FOREIGN KEY (team_format_id, discipline)
        REFERENCES roster.team_format (id, discipline) ON DELETE CASCADE,
      CONSTRAINT fk_tfd_dimension FOREIGN KEY (dimension_id, discipline) REFERENCES catalog.role_dimension (id, discipline),
      CONSTRAINT ck_tfd_assignments CHECK (player_min_assignments IS NULL OR player_max_assignments IS NULL
                                           OR player_min_assignments <= player_max_assignments)
    )
    """,
    """
    CREATE TABLE roster.format_role_rule (
      team_format_id      BIGINT NOT NULL,
      dimension_id        BIGINT NOT NULL,
      role_id             BIGINT NOT NULL,
      hard_min            INTEGER,
      hard_max            INTEGER,
      recommended_min     INTEGER,
      recommended_max     INTEGER,
      include_descendants BOOLEAN NOT NULL DEFAULT true,
      PRIMARY KEY (team_format_id, role_id),
      CONSTRAINT fk_frr_dimension FOREIGN KEY (team_format_id, dimension_id)
        REFERENCES roster.team_format_dimension (team_format_id, dimension_id) ON DELETE CASCADE,
      CONSTRAINT fk_frr_role FOREIGN KEY (role_id, dimension_id) REFERENCES catalog.role (id, dimension_id) DEFERRABLE INITIALLY DEFERRED,
      CONSTRAINT ck_frr_nonnegative CHECK (hard_min >= 0 AND hard_max >= 0 AND recommended_min >= 0 AND recommended_max >= 0),
      CONSTRAINT ck_frr_hard CHECK (hard_min IS NULL OR hard_max IS NULL OR hard_min <= hard_max),
      CONSTRAINT ck_frr_recommended CHECK (recommended_min IS NULL OR recommended_max IS NULL OR recommended_min <= recommended_max)
    )
    """,
)

#: Today's built-in shape (ex ``DEFAULT_ROSTER_SLOTS``) and Overwatch's preset; a map equal to it becomes the preset.
_ROLE_QUEUE = """'{"tank": 1, "damage": 2, "support": 2}'::jsonb"""

#: §14.6: a slot count -> ``hard n..n`` on an ENFORCED ``player_role``; ``flex`` -> the rest of the starters; a
#: tournament without its own map gets a copy of the workspace's; an existing mix a copy of its host's at migration.
_TEAM_FORMATS = (
    *_TEAM_FORMAT_SCHEMA,
    f"""
    CREATE TABLE roster.team_format_legacy AS
    SELECT nextval(pg_get_serial_sequence('roster.team_format', 'id')) AS id, s.workspace_id, s.discipline,
           s.tournament_id, s.custom_game_id, s.slots
      FROM (SELECT w.id AS workspace_id, 'overwatch'::varchar AS discipline, NULL::bigint AS tournament_id,
                   NULL::bigint AS custom_game_id, w.default_roster_slots_json AS slots
              FROM workspace w
             WHERE nullif(nullif(w.default_roster_slots_json, '{{}}'::jsonb), 'null'::jsonb) IS NOT NULL
            UNION ALL
            SELECT t.workspace_id, t.discipline, t.id, NULL,
                   coalesce(nullif(nullif(t.roster_slots_json, '{{}}'::jsonb), 'null'::jsonb),
                            nullif(nullif(w.default_roster_slots_json, '{{}}'::jsonb), 'null'::jsonb), {_ROLE_QUEUE})
              FROM tournament.tournament t JOIN workspace w ON w.id = t.workspace_id
            UNION ALL
            SELECT g.workspace_id, g.discipline, NULL, g.id,
                   coalesce(nullif(nullif(u.role_slots_json, '{{}}'::jsonb), 'null'::jsonb),
                            nullif(nullif(w.default_roster_slots_json, '{{}}'::jsonb), 'null'::jsonb), {_ROLE_QUEUE})
              FROM balancer.custom_game g
              JOIN workspace w ON w.id = g.workspace_id
              LEFT JOIN balancer.user_config u ON u.user_id = g.host_user_id) s
    """,
    """
    ALTER TABLE roster.team_format_legacy
      ADD CONSTRAINT pk_team_format_legacy PRIMARY KEY (id),
      ADD CONSTRAINT fk_team_format_legacy_workspace FOREIGN KEY (workspace_id)
        REFERENCES workspace (id) ON DELETE CASCADE,
      ADD CONSTRAINT fk_team_format_legacy_tournament FOREIGN KEY (tournament_id, workspace_id, discipline)
        REFERENCES tournament.tournament (id, workspace_id, discipline) ON DELETE CASCADE,
      ADD CONSTRAINT fk_team_format_legacy_custom_game FOREIGN KEY (custom_game_id, workspace_id, discipline)
        REFERENCES balancer.custom_game (id, workspace_id, discipline) ON DELETE CASCADE
    """,
    "COMMENT ON TABLE roster.team_format_legacy IS 'discipline01b owner snapshot for reconciliation; drop in discipline02'",
    f"""
    INSERT INTO roster.team_format (id, workspace_id, discipline, tournament_id, custom_game_id, preset_code, name,
                                    starter_min, starter_max)
    SELECT f.id, f.workspace_id, f.discipline, f.tournament_id, f.custom_game_id,
           CASE WHEN f.slots = {_ROLE_QUEUE} THEN 'role_queue_5v5' END,
           CASE WHEN f.slots = {_ROLE_QUEUE} THEN '5v5 role queue' ELSE 'Custom roster' END,
           s.total, s.total
      FROM roster.team_format_legacy f
     CROSS JOIN LATERAL (SELECT sum(e.value::int) AS total FROM jsonb_each_text(f.slots) e) s
    """,
    """
    INSERT INTO roster.team_format_dimension (team_format_id, discipline, dimension_id, mode)
    SELECT f.id, f.discipline, d.id,
           CASE WHEN EXISTS (SELECT 1 FROM jsonb_object_keys(f.slots) k WHERE k IN ('tank', 'damage', 'support'))
                THEN 'enforced' ELSE 'off' END
      FROM roster.team_format_legacy f
      JOIN catalog.role_dimension d ON d.discipline = f.discipline AND d.rated
    """,
    """
    INSERT INTO roster.format_role_rule (team_format_id, dimension_id, role_id, hard_min, hard_max)
    SELECT f.id, r.dimension_id, r.id, e.value::int, e.value::int
      FROM roster.team_format_legacy f
     CROSS JOIN LATERAL jsonb_each_text(f.slots) e
      JOIN catalog.role_dimension d ON d.discipline = f.discipline AND d.rated
      JOIN catalog.role r ON r.dimension_id = d.id AND r.workspace_id IS NULL AND r.code = e.key
    """,
)

#: §14.3: "ключ ``flex`` весов переходит в настройки слота без ограничения" -- ``role_settings.flex`` becomes the
#: top-level ``open_slot_settings`` in every stored balancer config.
_CONFIG_JSON = tuple(
    f"""
    UPDATE {table}
       SET config_json = (({column} #- '{{role_settings,flex}}')
                          || jsonb_build_object('open_slot_settings', {column} #> '{{role_settings,flex}}')){cast}
     WHERE {column} #> '{{role_settings,flex}}' IS NOT NULL
    """
    for table, column, cast in (
        ("balancer.user_config", "config_json", ""),
        ("balancer.tournament_config", "config_json::jsonb", "::json"),
        ("balancer.workspace_config", "config_json::jsonb", "::json"),
        ("balancer.balance", "config_json::jsonb", "::json"),
    )
)
