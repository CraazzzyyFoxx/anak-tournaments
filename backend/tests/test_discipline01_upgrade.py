"""``discipline01`` against a POPULATED database with the ``overwatch`` catalog.

A template database is upgraded to ``mixround01`` (the revision before ``discipline01``; ``enclayer02`` with its flag,
as the release runs it), seeded with a legacy catalog, checked by the operator's pre-flight, upgraded to
``discipline01`` and read back. A copy whose map names collide after slugify must stop the revision with their ids.
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
from psycopg.types.json import Jsonb

from shared.testing.db import ensure_test_postgres, is_ephemeral_test_dsn, postgres_env

BACKEND = pathlib.Path(__file__).resolve().parents[1]
PRE_REVISION = "mixround01"
TARGET = "discipline01"
TEMPLATE_DB = "discipline01_legacy_tpl"
MIGRATED_DB = "discipline01_migrated"
REJECTED_DB = "discipline01_rejected"
#: Every overwatch id the template ever issued is below this; every new id must be above it.
ID_FLOOR = 900

_spec = importlib.util.spec_from_file_location(
    "discipline01_revision", BACKEND / "migrations" / "versions" / "discipline01_catalog.py"
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


def _rows(conn, sql: str, params=None) -> list[tuple]:
    return conn.execute(sql, params).fetchall()


def _scalar(conn, sql: str, params=None):
    return conn.execute(sql, params).fetchone()[0]


def _insert(conn, table: str, **columns) -> int:
    names = ", ".join(f'"{name}"' for name in columns)
    placeholders = ", ".join(f"%({name})s" for name in columns)
    return conn.execute(f"INSERT INTO {table} ({names}) VALUES ({placeholders}) RETURNING id", columns).fetchone()[0]


def _statements(sql: str) -> list[str]:
    text = "\n".join(
        line for line in sql.splitlines() if not line.startswith("\\") and not line.lstrip().startswith("--")
    )
    return [part.strip() for part in re.split(r";\s*\n", text + "\n") if part.strip()]


def _seed(conn) -> dict:
    ids: dict = {}
    # Push the issued ids up so the floor is observable, and leave a deleted map behind it.
    conn.execute(f"SELECT setval('overwatch.map_id_seq', {ID_FLOOR}, true)")
    ids["control"] = _insert(
        conn,
        "overwatch.gamemode",
        slug="control-d1",
        name="Control D1",
        image_path="https://cdn/control.png",
        description="Best of three",
        aliases=Jsonb(["Контроль"]),
    )
    ids["push"] = _insert(conn, "overwatch.gamemode", slug="push-d1", name="Push D1", image_path="", aliases=Jsonb([]))
    ids["ilios"] = _insert(
        conn,
        "overwatch.map",
        gamemode_id=ids["control"],
        name="Ilios D1",
        image_path="https://cdn/ilios.jpg",
        in_competitive=True,
        aliases=Jsonb(["Илиос"]),
    )
    ids["kings"] = _insert(
        conn,
        "overwatch.map",
        gamemode_id=ids["push"],
        name="King's Row D1",
        image_path="https://cdn/kings.jpg",
        in_competitive=False,
        aliases=Jsonb([]),
    )
    ids["colosseo"] = _insert(
        conn,
        "overwatch.map",
        gamemode_id=ids["push"],
        name="Колизей",
        image_path="",
        in_competitive=True,
        aliases=Jsonb([]),
    )
    ids["ana"] = _insert(
        conn,
        "overwatch.hero",
        slug="ana-d1",
        name="Ana D1",
        image_path="https://cdn/ana.png",
        type="support",
        color="#718ab3",
        aliases=Jsonb(["Ана"]),
    )
    ids["rein"] = _insert(
        conn,
        "overwatch.hero",
        slug="reinhardt-d1",
        name="Reinhardt D1",
        image_path="https://cdn/rein.png",
        type="tank",
        aliases=Jsonb([]),
    )
    ids["miss_open"] = _insert(
        conn,
        "overwatch.catalog_alias_miss",
        entity_type="hero",
        raw_name="Анна",
        occurrences=3,
    )
    ids["miss_closed"] = _insert(
        conn,
        "overwatch.catalog_alias_miss",
        entity_type="gamemode",
        raw_name="Захват",
        occurrences=1,
        resolved_at="2026-10-01T00:00:00Z",
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
        preflight = {question: _rows(conn, sql) for question, sql in revision.PREFLIGHT}
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


def _entity_of(conn, legacy_kind: str, legacy_id: int) -> int:
    return _scalar(
        conn,
        "SELECT entity_id FROM catalog.entity_legacy WHERE legacy_kind = %s AND legacy_id = %s",
        (legacy_kind, legacy_id),
    )


_ENTITY = "SELECT discipline, kind, slug, name, image_path, parent_id, attrs, aliases, active FROM catalog.entity WHERE id = %s"


def test_the_preflight_is_silent_on_clean_legacy_data(legacy_template) -> None:
    assert {q: rows for q, rows in legacy_template["preflight"].items() if rows} == {}


def test_maps_colliding_after_slugify_stop_the_revision(legacy_template) -> None:
    ids = legacy_template["ids"]
    _recreate(REJECTED_DB, TEMPLATE_DB)
    with _connect(REJECTED_DB) as conn:
        twin = _insert(
            conn, "overwatch.map", gamemode_id=ids["control"], name="ILIOS  d1!", image_path="", aliases=Jsonb([])
        )
    done = _alembic(REJECTED_DB, TARGET)
    assert done.returncode != 0
    assert "maps whose names collide after slugify" in done.stderr
    assert str(ids["ilios"]) in done.stderr and str(twin) in done.stderr


@pytest.mark.parametrize(
    ("legacy_kind", "column", "field", "character", "limit", "id_key"),
    [
        ("hero", "slug", "slug", "h", 64, "ana"),
        ("gamemode", "slug", "slug", "g", 64, "control"),
        ("map", "name", "slug", "m", 64, "ilios"),
        ("hero", "name", "name", "英", 128, "ana"),
        ("gamemode", "name", "name", "模", 128, "control"),
        ("map", "name", "name", "К", 128, "colosseo"),
    ],
)
def test_overlong_catalog_values_stop_before_copy_and_are_listed(
    legacy_template, legacy_kind, column, field, character, limit, id_key
) -> None:
    legacy_id = legacy_template["ids"][id_key]
    _recreate(REJECTED_DB, TEMPLATE_DB)
    with _connect(REJECTED_DB) as conn:
        conn.execute(
            f"UPDATE overwatch.{legacy_kind} SET {column} = %s WHERE id = %s",
            (character * limit, legacy_id),
        )
        assert {q: _rows(conn, sql) for q, sql in revision.PREFLIGHT if _rows(conn, sql)} == {}
        conn.execute(
            f"UPDATE overwatch.{legacy_kind} SET {column} = %s WHERE id = %s",
            (character * (limit + 1), legacy_id),
        )
    done = _alembic(REJECTED_DB, TARGET)
    assert done.returncode != 0
    assert "catalog values too long" in done.stderr
    assert f"'legacy_kind': '{legacy_kind}'" in done.stderr
    assert f"'legacy_id': {legacy_id}" in done.stderr
    assert f"'field': '{field}'" in done.stderr
    assert f"'value_length': {limit + 1}" in done.stderr
    with _connect(REJECTED_DB) as conn:
        query = dict(revision.PREFLIGHT)["catalog values too long"]
        assert _rows(conn, query) == [(legacy_kind, legacy_id, field, limit + 1)]
        assert _scalar(conn, "SELECT version_num FROM public.alembic_version") == PRE_REVISION
        assert _scalar(conn, "SELECT to_regclass('catalog.entity')") is None
        assert _scalar(
            conn, f"SELECT {column} FROM overwatch.{legacy_kind} WHERE id = %s", (legacy_id,)
        ) == character * (limit + 1)


def test_gamemodes_become_modes(migrated) -> None:
    conn, ids = migrated["conn"], migrated["ids"]
    assert _rows(conn, _ENTITY, (_entity_of(conn, "gamemode", ids["control"]),)) == [
        (
            "overwatch",
            "mode",
            "control-d1",
            "Control D1",
            "https://cdn/control.png",
            None,
            {"description": "Best of three"},
            ["Контроль"],
            True,
        )
    ]
    assert _rows(conn, _ENTITY, (_entity_of(conn, "gamemode", ids["push"]),)) == [
        ("overwatch", "mode", "push-d1", "Push D1", "", None, {}, [], True)
    ]


def test_heroes_become_characters_with_their_class_and_color(migrated) -> None:
    conn, ids = migrated["conn"], migrated["ids"]
    assert _rows(conn, _ENTITY, (_entity_of(conn, "hero", ids["ana"]),)) == [
        (
            "overwatch",
            "character",
            "ana-d1",
            "Ana D1",
            "https://cdn/ana.png",
            None,
            {"class": "support", "color": "#718ab3"},
            ["Ана"],
            True,
        )
    ]
    assert _rows(conn, "SELECT attrs FROM catalog.entity WHERE id = %s", (_entity_of(conn, "hero", ids["rein"]),)) == [
        ({"class": "tank", "color": "#ffffff"},)
    ]


def test_maps_get_a_slug_their_mode_as_parent_and_the_competitive_flag(migrated) -> None:
    conn, ids = migrated["conn"], migrated["ids"]
    control, push = _entity_of(conn, "gamemode", ids["control"]), _entity_of(conn, "gamemode", ids["push"])
    assert _rows(conn, _ENTITY, (_entity_of(conn, "map", ids["ilios"]),)) == [
        (
            "overwatch",
            "map",
            "ilios-d1",
            "Ilios D1",
            "https://cdn/ilios.jpg",
            control,
            {"in_competitive": True},
            ["Илиос"],
            True,
        )
    ]
    kings = _rows(
        conn,
        "SELECT slug, parent_id, attrs FROM catalog.entity WHERE id = %s",
        (_entity_of(conn, "map", ids["kings"]),),
    )
    assert kings == [("king-s-row-d1", push, {"in_competitive": False})]
    assert (
        _scalar(conn, "SELECT slug FROM catalog.entity WHERE id = %s", (_entity_of(conn, "map", ids["colosseo"]),))
        == "map"
    )


def test_new_ids_start_above_every_id_overwatch_ever_issued(migrated) -> None:
    conn = migrated["conn"]
    assert _scalar(conn, "SELECT min(id) FROM catalog.entity") > ID_FLOOR
    assert _scalar(conn, "SELECT count(*) FROM catalog.entity_legacy") == 7
    assert _scalar(conn, "SELECT count(DISTINCT entity_id) FROM catalog.entity_legacy") == 7


def test_alias_misses_move_with_their_kind(migrated) -> None:
    conn = migrated["conn"]
    rows = _rows(
        conn,
        "SELECT discipline, kind, raw_name, occurrences, resolved_at IS NOT NULL, last_ingest_job_id"
        " FROM catalog.alias_miss WHERE raw_name IN ('Анна', 'Захват')",
    )
    assert set(rows) == {
        ("overwatch", "mode", "Захват", 1, True, None),
        ("overwatch", "character", "Анна", 3, False, None),
    }


def test_league_of_legends_is_a_known_discipline(migrated) -> None:
    assert _rows(migrated["conn"], "SELECT name FROM catalog.discipline WHERE code = 'lol'") == [("League of Legends",)]


def test_the_reconcile_report_is_clean(migrated) -> None:
    with _connect(MIGRATED_DB, autocommit=False) as tx:
        create, summary, skipped = _statements(RECONCILE_SQL)
        tx.execute(create)
        statuses = {row[0]: row[3] for row in _rows(tx, summary)}
        listed = _rows(tx, skipped)
        tx.rollback()
    assert listed == []
    assert set(statuses.values()) == {"ok"}
    assert {"heroes", "gamemodes", "maps", "alias misses"} <= set(statuses)


def test_the_chain_ends_at_discipline01_with_every_constraint_validated(migrated) -> None:
    conn = migrated["conn"]
    assert _scalar(conn, "SELECT version_num FROM public.alembic_version") == TARGET
    assert _rows(conn, "SELECT conrelid::regclass::text, conname FROM pg_constraint WHERE NOT convalidated") == []
