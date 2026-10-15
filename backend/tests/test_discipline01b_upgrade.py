"""``discipline01b`` against a POPULATED database (spec §14.3, §14.5, §14.6).

A template database is upgraded to ``discipline01`` (``enclayer02`` with its flag, as the release runs it), seeded with
the role data of every table P2 carries, checked by the operator's pre-flight, its live object names scrambled, upgraded
to ``discipline01b`` and read back. Copies with broken data must stop the revision with the offending rows listed.
Needs the ephemeral test Postgres; skips otherwise.
"""

from __future__ import annotations

import importlib.util
import os
import pathlib
import re
import subprocess
import sys

import psycopg
import pytest

from shared.disciplines import DISCIPLINES
from shared.domain.player_sub_roles import normalize_sub_role
from shared.testing.db import ensure_test_postgres, is_ephemeral_test_dsn, postgres_env

BACKEND = pathlib.Path(__file__).resolve().parents[1]
PRE_REVISION = "discipline01"
TARGET = "discipline01b"
TEMPLATE_DB = "discipline01b_legacy_tpl"
MIGRATED_DB = "discipline01b_migrated"
REJECTED_DB = "discipline01b_rejected"

_spec = importlib.util.spec_from_file_location(
    "discipline01b_revision", BACKEND / "migrations" / "versions" / "discipline01b_roles.py"
)
assert _spec is not None and _spec.loader is not None
revision = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(revision)
RECONCILE_SQL = (BACKEND / "scripts" / "discipline01_reconcile.sql").read_text(encoding="utf-8")


def _connect(dbname: str, *, autocommit: bool = True) -> psycopg.Connection:
    env = postgres_env()
    return psycopg.connect(
        host=env["host"],
        port=int(env["port"]),
        dbname=dbname,
        user=env["user"],
        password=env["password"],
        autocommit=autocommit,
    )


def _url(dbname: str) -> str:
    env = postgres_env()
    return f"postgresql+psycopg://{env['user']}:{env['password']}@{env['host']}:{env['port']}/{dbname}"


def _recreate(dbname: str, template: str | None = None) -> None:
    with _connect("postgres") as admin:
        admin.execute(f'DROP DATABASE IF EXISTS "{dbname}" WITH (FORCE)')
        admin.execute(f'CREATE DATABASE "{dbname}"' + (f' TEMPLATE "{template}"' if template else ""))


def _alembic(dbname: str, target: str, **env: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", target],
        cwd=str(BACKEND),
        env={**os.environ, "DATABASE_URL": _url(dbname), **env},
        capture_output=True,
        text=True,
        timeout=300,
        check=False,
    )


def _rows(conn, query: str, params=None) -> list[tuple]:
    return conn.execute(query, params).fetchall()


def _scalar(conn, query: str, params=None):
    return conn.execute(query, params).fetchone()[0]


def _insert(conn, table: str, **columns) -> int:
    names = ", ".join(f'"{name}"' for name in columns)
    placeholders = ", ".join(f"%({name})s" for name in columns)
    return conn.execute(f"INSERT INTO {table} ({names}) VALUES ({placeholders}) RETURNING id", columns).fetchone()[0]


def _statements(script: str) -> list[str]:
    text = "\n".join(
        line for line in script.splitlines() if not line.startswith("\\") and not line.lstrip().startswith("--")
    )
    return [part.strip() for part in re.split(r";\s*\n", text + "\n") if part.strip()]


def _seed(conn) -> dict:
    ids: dict = {}
    ids["ws_a"] = _insert(conn, "workspace", slug="d1b-a", name="d1b-a")
    ids["ws_b"] = _insert(conn, "workspace", slug="d1b-b", name="d1b-b")
    catalog = "tournament.player_sub_role"
    ids["hitscan"] = _insert(
        conn, catalog, workspace_id=ids["ws_a"], role="damage", slug="hitscan", label="Hitscan", sort_order=1
    )
    ids["main_heal"] = _insert(
        conn,
        catalog,
        workspace_id=ids["ws_a"],
        role="support",
        slug="main_heal",
        label="Main Heal",
        sort_order=2,
        description="Primary healer",
    )
    ids["off_tank"] = _insert(
        conn, catalog, workspace_id=ids["ws_a"], role="tank", slug="off tank", label="Off Tank", is_active=False
    )
    for key in ("a", "b"):
        ids[f"t_{key}"] = _insert(
            conn, "tournament.tournament", workspace_id=ids[f"ws_{key}"], name=key, slug=f"d1b-t-{key}", status="live"
        )
        ids[f"team_{key}"] = _insert(
            conn, "tournament.team", tournament_id=ids[f"t_{key}"], name=key, balancer_name=key
        )
    for key, side, role, sub_role in (
        ("by_slug", "a", "damage", "hitscan"),
        ("whitespace", "a", "damage", "\tHitscan\n"),
        ("by_label", "a", "support", "Main Heal"),
        ("off_catalog", "a", "support", "light heal"),
        ("plain", "a", "tank", None),
        ("flex_sub", "a", "flex", "main"),
        ("no_catalog", "b", "damage", "projectile"),
    ):
        user = _insert(conn, "players.user", name=f"d1b-{key}")
        ids[f"member_{key}"] = _insert(conn, "workspace_member", workspace_id=ids[f"ws_{side}"], player_id=user)
        ids[key] = _insert(
            conn,
            "tournament.player",
            tournament_id=ids[f"t_{side}"],
            team_id=ids[f"team_{side}"],
            workspace_member_id=ids[f"member_{key}"],
            name=key,
            rank=2000,
            role=role,
            sub_role=sub_role,
        )
    for key, side, role, subrole in (("reg_a", "a", "damage", "Hitscan"), ("reg_b", "b", "support", "main_heal")):
        ids[key] = _insert(conn, "balancer.registration", tournament_id=ids[f"t_{side}"])
        ids[f"{key}_role"] = _insert(
            conn, "balancer.registration_role", registration_id=ids[key], role=role, subrole=subrole, priority=1
        )
    return ids


@pytest.fixture(scope="module")
def legacy_template():
    ensure_test_postgres()
    if not is_ephemeral_test_dsn():
        pytest.skip("creates scratch databases: only on the ephemeral test Postgres")
    _recreate(TEMPLATE_DB)
    done = _alembic(TEMPLATE_DB, PRE_REVISION, OWT_APPLY_ENCOUNTER_LAYER_DROP="1")
    assert done.returncode == 0, done.stderr[-3000:]
    with _connect(TEMPLATE_DB) as conn:
        ids = _seed(conn)
        preflight = {question: _rows(conn, query) for question, query in revision.PREFLIGHT}
    yield {"ids": ids, "preflight": preflight}
    with _connect("postgres") as admin:
        for name in (MIGRATED_DB, REJECTED_DB, TEMPLATE_DB):
            admin.execute(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')


@pytest.fixture(scope="module")
def migrated(legacy_template):
    _recreate(MIGRATED_DB, TEMPLATE_DB)
    done = _alembic(MIGRATED_DB, TARGET)
    assert done.returncode == 0, done.stderr[-3000:]
    with _connect(MIGRATED_DB) as conn:
        yield {**legacy_template, "conn": conn}


def _rejected(statement: str, params=None) -> subprocess.CompletedProcess[str]:
    """A copy of the template with one row broken, upgraded."""
    _recreate(REJECTED_DB, TEMPLATE_DB)
    with _connect(REJECTED_DB) as conn:
        conn.execute(statement, params)
    return _alembic(REJECTED_DB, TARGET)


_SUB_ROLES = """
    SELECT r.workspace_id, m.code, r.code, r.name, r.description, r.sort_order, r.active, r.selectable
      FROM catalog.role r JOIN catalog.role m ON m.id = r.parent_role_id
     WHERE r.workspace_id = %s
     ORDER BY m.code, r.code
"""


def test_the_preflight_is_silent_on_clean_data(legacy_template) -> None:
    assert {question: rows for question, rows in legacy_template["preflight"].items() if rows} == {}


def test_the_overwatch_ontology_is_seeded_as_the_module_declares(migrated) -> None:
    conn = migrated["conn"]
    declared = DISCIPLINES["overwatch"].rated_dimension
    assert _rows(
        conn, "SELECT code, name, selection_mode, rated FROM catalog.role_dimension WHERE discipline = 'overwatch'"
    ) == [(declared.code, declared.name, declared.selection_mode, declared.rated)]
    assert _rows(
        conn,
        "SELECT r.code, r.name, r.sort_order FROM catalog.role r JOIN catalog.role_dimension d ON d.id = r.dimension_id"
        " WHERE d.discipline = 'overwatch' AND r.workspace_id IS NULL ORDER BY r.sort_order",
    ) == [(role.code, role.name, order) for order, role in enumerate(declared.roles)]


def test_catalog_sub_roles_become_workspace_roles_under_their_role(migrated) -> None:
    conn, ids = migrated["conn"], migrated["ids"]
    assert _rows(conn, _SUB_ROLES, (ids["ws_a"],)) == [
        (ids["ws_a"], "damage", "hitscan", "Hitscan", None, 1, True, True),
        (
            ids["ws_a"],
            "support",
            "light_heal",
            "light heal",
            "Kept by discipline01b: used by players or registrations, absent from the workspace sub-role catalog.",
            1000,
            False,
            False,
        ),
        (ids["ws_a"], "support", "main_heal", "Main Heal", "Primary healer", 2, True, True),
        (ids["ws_a"], "tank", "off_tank", "Off Tank", None, 0, False, True),
    ]


def test_legacy_whitespace_matches_the_existing_catalog_leaf(migrated) -> None:
    conn, ids = migrated["conn"], migrated["ids"]
    with conn.transaction(force_rollback=True):
        conn.execute(revision.LEAF_FUNCTION)
        leaf_id = _scalar(
            conn,
            "SELECT id FROM catalog.role WHERE workspace_id = %s AND code = 'hitscan'",
            (ids["ws_a"],),
        )
        assert (
            _scalar(
                conn,
                "SELECT pg_temp.discipline01b_leaf(%s, 'damage', sub_role) FROM tournament.player WHERE id = %s",
                (ids["ws_a"], ids["whitespace"]),
            )
            == leaf_id
        )


def test_sql_normalization_matches_python_whitespace(migrated) -> None:
    # Python's whitespace set includes control separators and Unicode spaces that
    # PostgreSQL's locale-dependent \s does not necessarily recognise.
    whitespace = "\t\n\v\f\r\x1c\x1d\x1e\x1f \x85\xa0\u1680" + "".join(map(chr, range(0x2000, 0x200B)))
    whitespace += "\u2028\u2029\u202f\u205f\u3000"
    conn = migrated["conn"]
    for char in whitespace:
        for value in (f"{char}Hitscan{char}", f"Main{char}{char}Heal", char):
            assert _scalar(conn, f"SELECT {revision._code('%s')}", (value,)) == (normalize_sub_role(value) or "")


def test_values_outside_the_catalog_become_inactive_unselectable_sub_roles(migrated) -> None:
    conn, ids = migrated["conn"], migrated["ids"]
    assert [
        (parent, code, active, selectable)
        for _, parent, code, _, _, _, active, selectable in _rows(conn, _SUB_ROLES, (ids["ws_b"],))
    ] == [("damage", "projectile", False, False), ("support", "main_heal", False, False)]


def test_a_flex_sub_role_creates_nothing(migrated) -> None:
    conn = migrated["conn"]
    assert _scalar(conn, "SELECT count(*) FROM catalog.role WHERE code = 'main'") == 0


@pytest.mark.parametrize(
    ("statement", "listed"),
    [
        (
            "INSERT INTO tournament.player_sub_role (workspace_id, role, slug, label) VALUES (%(ws)s, 'tank', 'hitscan', 'Hitscan tank')",
            "'code': 'hitscan', 'parents': ['damage', 'tank']",
        ),
        (
            "INSERT INTO tournament.player_sub_role (workspace_id, role, slug, label) VALUES (%(ws)s, 'support', 'Tank', 'Tank')",
            "'code': 'tank'",
        ),
        (
            "INSERT INTO tournament.player_sub_role (workspace_id, role, slug, label) VALUES (%(ws)s, 'flex', 'anchor', 'Anchor')",
            "'code': 'anchor', 'parents': ['flex']",
        ),
    ],
)
def test_unusable_sub_role_codes_stop_the_revision(legacy_template, statement: str, listed: str) -> None:
    done = _rejected(statement, {"ws": legacy_template["ids"]["ws_a"]})
    assert done.returncode != 0
    assert "workspace sub-roles that cannot become catalog roles" in done.stderr
    assert listed in done.stderr


def test_role_values_outside_the_vocabulary_stop_the_revision(legacy_template) -> None:
    done = _rejected(
        "UPDATE balancer.registration_role SET role = 'healer' WHERE id = %s", (legacy_template["ids"]["reg_a_role"],)
    )
    assert done.returncode != 0
    assert "role values outside tank|damage|support|flex" in done.stderr
    assert "'source': 'balancer.registration_role', 'value': 'healer'" in done.stderr


def test_flex_where_a_role_is_required_stops_the_revision(legacy_template) -> None:
    row = legacy_template["ids"]["reg_b_role"]
    done = _rejected("UPDATE balancer.registration_role SET role = 'flex' WHERE id = %s", (row,))
    assert done.returncode != 0
    assert "flex where a role is required" in done.stderr
    assert f"'row_id': {row}" in done.stderr


def test_every_workspace_may_play_overwatch_only_by_default(migrated) -> None:
    conn, ids = migrated["conn"], migrated["ids"]
    assert _scalar(conn, "SELECT disciplines_enabled FROM workspace WHERE id = %s", (ids["ws_a"],)) == ["overwatch"]


def test_the_reconcile_report_is_clean(migrated) -> None:
    with _connect(MIGRATED_DB, autocommit=False) as tx:
        function, create, summary, skipped = _statements(RECONCILE_SQL)
        tx.execute(function)
        tx.execute(create)
        statuses = {row[0]: row[3] for row in _rows(tx, summary)}
        listed = _rows(tx, skipped)
        tx.rollback()
    assert listed == []
    assert set(statuses.values()) == {"ok"}
    assert {"sub-roles", "off-catalog sub-roles (kept inactive)", "flex sub-roles (dropped)"} <= set(statuses)


def test_the_chain_ends_at_discipline01b_with_every_constraint_validated(migrated) -> None:
    conn = migrated["conn"]
    assert _scalar(conn, "SELECT version_num FROM public.alembic_version") == TARGET
    assert _rows(conn, "SELECT conrelid::regclass::text, conname FROM pg_constraint WHERE NOT convalidated") == []
