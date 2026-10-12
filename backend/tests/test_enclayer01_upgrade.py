"""``enclayer01`` + ``enclayer01b`` against a POPULATED, legacy-shaped database.

The converters are golden-tested on their own (``test_enclayer01_convert.py``)
and the constraints on a fresh schema (``shared/tests``). Neither runs the ~30
backfill statements, the notification SQL, the ``auto_pending`` label or the two
revisions end to end on rows that exist. This does:

1. a template database is upgraded to the revision BEFORE ``enclayer01`` and
   seeded with legacy-shaped rows that cover every converter -- duels (played by
   games, admin-set), a points lobby, pick-ban rooms in every pool mode, links,
   journal rows, notifications;
2. the operator's pre-flight SQL must come back empty on it;
3. ``alembic upgrade head`` runs, and the result is read back row by row;
4. the lobby recompute step and the reconcile SQL run on the migrated rows;
5. a second copy, seeded with one row of every class the pre-flight rejects,
   must stop the revision with those ids.

Needs the ephemeral test Postgres (``docker-compose.test.yml``); skips otherwise.
Databases are created on that server under their own names and dropped after --
the shared ``anak_test`` is never touched.
"""

from __future__ import annotations

import asyncio
import importlib.util
import os
import pathlib
import re
import subprocess
import sys

import psycopg
import pytest
from psycopg.types.json import Json, Jsonb

from shared.testing.db import ensure_test_postgres, is_ephemeral_test_dsn, postgres_env

BACKEND = pathlib.Path(__file__).resolve().parents[1]
PRE_REVISION = "apikeysu01"
TEMPLATE_DB = "enclayer01_legacy_tpl"
MIGRATED_DB = "enclayer01_migrated"
REJECTED_DB = "enclayer01_rejected"


def _load(name: str, path: pathlib.Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module  # dataclass/pydantic imports resolve through sys.modules
    spec.loader.exec_module(module)
    return module


revision = _load("enclayer01_revision", BACKEND / "migrations" / "versions" / "enclayer01_encounter_layer.py")
recompute_script = _load("enclayer01_recompute", BACKEND / "scripts" / "enclayer01_recompute_lobbies.py")
RECONCILE_SQL = (BACKEND / "scripts" / "enclayer01_reconcile.sql").read_text(encoding="utf-8")
PREFLIGHT_SQL = (BACKEND / "scripts" / "enclayer01_preflight.sql").read_text(encoding="utf-8")


# --------------------------------------------------------------------------- #
# Plumbing
# --------------------------------------------------------------------------- #


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


def _url(dbname: str, *, driver: str = "psycopg") -> str:
    env = postgres_env()
    return f"postgresql+{driver}://{env['user']}:{env['password']}@{env['host']}:{env['port']}/{dbname}"


def _recreate(dbname: str, template: str | None = None) -> None:
    with _connect("postgres") as admin:
        admin.execute(f'DROP DATABASE IF EXISTS "{dbname}" WITH (FORCE)')
        admin.execute(f'CREATE DATABASE "{dbname}"' + (f' TEMPLATE "{template}"' if template else ""))


def _alembic(dbname: str, target: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", target],
        cwd=str(BACKEND),
        env={**os.environ, "DATABASE_URL": _url(dbname)},
        capture_output=True,
        text=True,
        timeout=300,
        check=False,
    )


def _rows(conn: psycopg.Connection, sql: str, params=None) -> list[tuple]:
    return conn.execute(sql, params).fetchall()


def _scalar(conn: psycopg.Connection, sql: str, params=None):
    return conn.execute(sql, params).fetchone()[0]


def _insert(conn: psycopg.Connection, table: str, **columns) -> int:
    names = ", ".join(f'"{name}"' for name in columns)
    placeholders = ", ".join(f"%({name})s" for name in columns)
    return conn.execute(f"INSERT INTO {table} ({names}) VALUES ({placeholders}) RETURNING id", columns).fetchone()[0]


def _statements(sql: str) -> list[str]:
    """A psql script as plain statements: meta-commands dropped, split on ``;``."""
    text = "\n".join(
        line for line in sql.splitlines() if not line.startswith("\\") and not line.lstrip().startswith("--")
    )
    return [part.strip() for part in re.split(r";\s*\n", text + "\n") if part.strip()]


def _run_checks(conn: psycopg.Connection, queries) -> dict[str, list[tuple]]:
    return {question: _rows(conn, sql) for question, sql in queries}


# --------------------------------------------------------------------------- #
# The legacy seed
# --------------------------------------------------------------------------- #

V2_RULESET = {
    "version": 2,
    "phases": [{"name": "bans", "steps": [{"kind": "ban", "actors": "home"}, {"kind": "ban", "actors": "away"}]}],
}
OTHER_PAYLOAD = {"encounter_id": 1, "home_team_name": "Keep", "away_team_name": "Me"}


def _seed(conn: psycopg.Connection) -> dict[str, int]:
    ids: dict[str, int] = {}
    ids["ws"] = _insert(conn, "workspace", slug="enc-up", name="enc-up")
    members = []
    for index in range(9):
        user = _insert(conn, '"players"."user"', name=f"enc-up-{index}")
        members.append(_insert(conn, "workspace_member", workspace_id=ids["ws"], player_id=user))
    ids["t"] = _insert(conn, "tournament.tournament", workspace_id=ids["ws"], name="T", slug="enc-up-t", status="live")
    ids["t2"] = _insert(
        conn, "tournament.tournament", workspace_id=ids["ws"], name="T2", slug="enc-up-t2", status="live"
    )
    teams = {}
    for letter, (first, second) in zip("ABCD", ((0, 1), (2, 3), (4, 5), (6, 7)), strict=True):
        teams[letter] = _insert(
            conn, "tournament.team", tournament_id=ids["t"], name=f"Team {letter}", balancer_name=letter
        )
        for member, role in ((members[first], "tank"), (members[second], "damage")):
            _insert(
                conn,
                "tournament.player",
                name=f"p{member}",
                rank=2000,
                role=role,
                tournament_id=ids["t"],
                workspace_member_id=member,
                team_id=teams[letter],
            )
    ids["foreign_team"] = _insert(conn, "tournament.team", tournament_id=ids["t2"], name="Foreign", balancer_name="F")
    ids.update({f"team_{letter}": team for letter, team in teams.items()})

    ids["stage_duel"] = _insert(
        conn, "tournament.stage", tournament_id=ids["t"], name="Bracket", stage_type="single_elimination", order=1
    )
    ids["stage_ffa"] = _insert(
        conn,
        "tournament.stage",
        tournament_id=ids["t"],
        name="League",
        stage_type="ffa_league",
        order=2,
        ffa_columns=Jsonb([{"key": "kills", "label": "K", "public": True, "better": "higher"}]),
        ffa_formula="place_pts + kills",
        ffa_placement_points=[10.0, 6.0, 3.0],
    )
    ids["stage_other"] = _insert(
        conn, "tournament.stage", tournament_id=ids["t2"], name="Other", stage_type="single_elimination", order=1
    )
    ids["item_duel"] = _insert(
        conn, "tournament.stage_item", stage_id=ids["stage_duel"], name="Upper", type="single_bracket", order=1
    )

    def encounter(
        name,
        home,
        away,
        *,
        round_,
        status="OPEN",
        result="none",
        scores=(0, 0),
        best_of=3,
        stage="stage_duel",
        format_="duel",
        tournament="t",
    ):
        return _insert(
            conn,
            "tournament.encounter",
            name=name,
            tournament_id=ids[tournament],
            home_team_id=home,
            away_team_id=away,
            home_score=scores[0],
            away_score=scores[1],
            round=round_,
            best_of=best_of,
            status=status,
            result_status=result,
            stage_id=ids[stage] if stage else None,
            stage_item_id=ids["item_duel"] if stage == "stage_duel" else None,
            format=format_,
            confirmed_at=None if result == "none" else "2026-10-01T12:00:00Z",
        )

    ids["e_played"] = encounter(
        "played", teams["A"], teams["B"], round_=1, status="COMPLETED", result="confirmed", scores=(2, 1)
    )
    ids["e_admin"] = encounter(
        "admin set", teams["A"], teams["C"], round_=1, status="COMPLETED", result="confirmed", scores=(2, 0)
    )
    ids["e_slots"] = encounter("slot veto", teams["B"], teams["D"], round_=2)
    ids["e_hero"] = encounter("hero veto", teams["A"], teams["D"], round_=2, best_of=5)
    ids["e_pool"] = encounter("classic veto", teams["C"], teams["D"], round_=3, best_of=1, stage=None)
    ids["e_gone"] = encounter("config deleted", teams["B"], teams["C"], round_=3)
    ids["e_tbd"] = encounter("not yet seated", None, None, round_=4)
    ids["e_lobby"] = encounter(
        "lobby",
        None,
        None,
        round_=1,
        status="COMPLETED",
        result="confirmed",
        best_of=2,
        stage="stage_ffa",
        format_="ffa",
    )
    for slot, letter in enumerate("ABC", start=1):
        _insert(conn, "tournament.encounter_participant", encounter_id=ids["e_lobby"], team_id=teams[letter], slot=slot)

    # ── games of the played series: A wins 1-0, loses 0-1, wins 1-0 ──
    ids["games"] = []
    for position, (home, away) in enumerate(((1, 0), (0, 1), (1, 0)), start=1):
        ids["games"].append(
            _insert(
                conn,
                "tournament.encounter_game",
                encounter_id=ids["e_played"],
                position=position,
                state="confirmed",
                accepted_home_score=home,
                accepted_away_score=away,
                result_source="captain_agreement",
                confirmed_at="2026-10-01T11:00:00Z",
            )
        )
    first = ids["games"][0]
    for side in ("home", "away"):
        ids[f"map_report_{side}"] = _insert(
            conn, "tournament.encounter_map_report", game_id=first, side=side, home_score=1, away_score=0
        )
    for letter in "AB":
        ids[f"captain_{letter}"] = _insert(
            conn,
            "tournament.encounter_captain_report",
            encounter_id=ids["e_played"],
            team_id=teams[letter],
            home_score=2,
            away_score=1,
            closeness=3,
            comment=f"report {letter}",
            custom_fields_json=Json({"mvp": letter}),
        )
    ids["map_code"] = _insert(
        conn, "tournament.encounter_map_code", report_id=ids["captain_A"], map_index=1, code="ABC123"
    )
    _insert(conn, "tournament.encounter_readiness", encounter_id=ids["e_played"], side="home")
    _insert(
        conn,
        "tournament.encounter_room_event",
        encounter_id=ids["e_played"],
        action="ready",
        source="captain",
        side="home",
    )
    _insert(
        conn,
        "tournament.encounter_result_audit",
        encounter_id=ids["e_played"],
        action="game_confirm",
        to_result_status="none",
        away_score_after=0,
        home_score_after=1,
        source="captain_agreement",
        game_id=first,
    )
    ids["audit_confirm"] = _insert(
        conn,
        "tournament.encounter_result_audit",
        encounter_id=ids["e_played"],
        action="confirm",
        from_result_status="none",
        to_result_status="confirmed",
        home_score_before=1,
        away_score_before=0,
        home_score_after=2,
        away_score_after=1,
        adopted_team_id=teams["A"],
        source="captain",
    )
    _insert(
        conn,
        "tournament.encounter_result_audit",
        encounter_id=ids["e_admin"],
        action="import",
        to_result_status="confirmed",
        home_score_after=2,
        away_score_after=0,
        source="import",
    )

    # ── a points lobby: A 15+8, B 15+11, C 4+3 ──
    lobby_games = []
    for position, rows in enumerate(
        (
            {"A": (1, 5), "B": (2, 9), "C": (3, 1)},
            {"A": (2, 2), "B": (1, 1), "C": (3, 0)},
        ),
        start=1,
    ):
        game = _insert(
            conn,
            "tournament.encounter_game",
            encounter_id=ids["e_lobby"],
            position=position,
            state="confirmed",
            result_source="admin",
            confirmed_at="2026-10-01T11:00:00Z",
            format="ffa",
        )
        lobby_games.append(game)
        for letter, (place, kills) in rows.items():
            _insert(
                conn,
                "tournament.encounter_game_result",
                game_id=game,
                encounter_id=ids["e_lobby"],
                team_id=teams[letter],
                placement=place,
                stats=Jsonb({"kills": kills}),
            )
    ids["lobby_games"] = lobby_games
    ids["audit_lobby"] = _insert(
        conn,
        "tournament.encounter_result_audit",
        encounter_id=ids["e_lobby"],
        action="confirm",
        to_result_status="confirmed",
        source="admin",
        ffa_results_json=Jsonb(
            {
                "before": [],
                "after": [
                    {"team_id": teams[letter], "points": points, "games": 2}
                    for letter, points in zip("ABC", (23, 26, 7), strict=True)
                ],
            }
        ),
    )

    # ── pick-ban rooms: slots, hero pool, classic pool, deleted config ──
    slots_cfg = _insert(
        conn,
        "tournament.pick_ban_config",
        tournament_id=ids["t"],
        kind="map",
        stage_id=ids["stage_duel"],
        round=2,
        mode="slots",
        first_ban_rotation="alternate",
        ruleset_json=Json(V2_RULESET),
    )
    for position, items in ((1, (11, 12, 13)), (2, (21, 22)), (3, (31,)), (4, (41,))):
        slot = _insert(
            conn,
            "tournament.pick_ban_config_slot",
            pick_ban_config_id=slots_cfg,
            position=position,
            reserve_item_id=items[0],
        )
        for order, item in enumerate(items):
            _insert(
                conn,
                "tournament.pick_ban_config_slot_item",
                pick_ban_config_slot_id=slot,
                item_id=item,
                sort_order=order,
            )
    hero_cfg = _insert(
        conn,
        "tournament.pick_ban_config",
        tournament_id=ids["t"],
        kind="hero",
        mode="pool",
        first_ban_rotation="result_loser_choice",
        ruleset_json=Json(V2_RULESET),
    )
    for order, item in enumerate((103, 101, 102)):
        _insert(conn, "tournament.pick_ban_config_item", pick_ban_config_id=hero_cfg, item_id=item, sort_order=order)
    pool_cfg = _insert(
        conn,
        "tournament.pick_ban_config",
        tournament_id=ids["t"],
        kind="map",
        mode="pool",
        first_ban_rotation="fixed",
        ruleset_json=Json(V2_RULESET),
    )
    for order, item in enumerate((7, 3, 9)):
        _insert(conn, "tournament.pick_ban_config_item", pick_ban_config_id=pool_cfg, item_id=item, sort_order=order)

    def session(encounter_key, kind, config, **extra):
        return _insert(
            conn,
            "tournament.pick_ban_session",
            encounter_id=ids[encounter_key],
            kind=kind,
            config_id=config,
            seed_source="standings",
            resolved_sequence_json=Json([]),
            ruleset_json=Json(V2_RULESET),
            **extra,
        )

    ids["s_slots"] = session(
        "e_slots",
        "map",
        slots_cfg,
        first_side="home",
        home_seed=1,
        away_seed=2,
        pending_loser_side="away",
        undo_requested_by="home",
    )
    ids["s_hero"] = session("e_hero", "hero", hero_cfg)
    ids["s_pool"] = session("e_pool", "map", pool_cfg)
    ids["s_gone"] = session("e_gone", "hero", None)
    for order, (picked, protected) in enumerate(
        (("home", None), ("away", None), ("decider", "admin"), (None, "home")), start=1
    ):
        _insert(
            conn,
            "tournament.pick_ban_entry",
            session_id=ids["s_slots"],
            item_id=10 + order,
            order=order,
            picked_by=picked,
            protected_by=protected,
        )
    for step, side in enumerate(("home", "away", "system")):
        _insert(
            conn,
            "tournament.pick_ban_submission",
            session_id=ids["s_slots"],
            step_index=step,
            side=side,
            state="locked",
        )

    # ── bracket links ──
    _insert(
        conn,
        "tournament.encounter_link",
        source_encounter_id=ids["e_played"],
        target_encounter_id=ids["e_slots"],
        role="winner",
        target_slot="home",
    )
    _insert(
        conn,
        "tournament.encounter_link",
        source_encounter_id=ids["e_played"],
        target_encounter_id=ids["e_hero"],
        role="loser",
        target_slot="away",
    )

    # ── stored notifications ──
    for kind, payload in (
        (
            "encounter.scheduled",
            {"encounter_id": ids["e_played"], "home_team_name": "Team A", "away_team_name": "Team B"},
        ),
        (
            "encounter.dispute_review",
            {"encounter_id": ids["e_played"], "home_team_name": "Team A", "away_team_name": "Team B"},
        ),
        ("some.other", OTHER_PAYLOAD),
    ):
        ids[f"notification_{kind}"] = _insert(
            conn, "notification", audience="all", kind=kind, payload_json=Jsonb(payload)
        )

    # ── a played match, for the team-delete proof ──
    mode = _insert(conn, "overwatch.gamemode", slug="enc-up", name="enc-up", image_path="x")
    map_id = _insert(conn, "overwatch.map", gamemode_id=mode, name="enc-up", image_path="x")
    ids["match"] = _insert(
        conn,
        "matches.match",
        home_team_id=teams["A"],
        away_team_id=teams["B"],
        home_score=1,
        away_score=0,
        encounter_id=ids["e_played"],
        map_id=map_id,
    )
    return ids


MOVED_TABLES = (
    "tournament.encounter",
    "tournament.encounter_game",
    "tournament.encounter_result_audit",
    "tournament.encounter_room_event",
    "tournament.pick_ban_session",
    "tournament.pick_ban_entry",
    "tournament.pick_ban_submission",
)


def _id_ranges_of(conn: psycopg.Connection, table: str) -> tuple:
    return _rows(conn, f"SELECT min(id), max(id), count(id) FROM {table}")[0]


def _id_ranges(conn: psycopg.Connection) -> dict[str, tuple]:
    return {table: _id_ranges_of(conn, table) for table in MOVED_TABLES}


# --------------------------------------------------------------------------- #
# Fixtures
# --------------------------------------------------------------------------- #


@pytest.fixture(scope="module")
def legacy_template():
    ensure_test_postgres()
    if not is_ephemeral_test_dsn():
        pytest.skip("creates scratch databases: only on the ephemeral test Postgres")
    _recreate(TEMPLATE_DB)
    done = _alembic(TEMPLATE_DB, PRE_REVISION)
    assert done.returncode == 0, done.stderr[-3000:]
    with _connect(TEMPLATE_DB) as conn:
        ids = _seed(conn)
        before = _id_ranges(conn)
        preflight = _run_checks(conn, _preflight_queries())
    yield {"ids": ids, "before": before, "preflight": preflight}
    with _connect("postgres") as admin:
        for name in (MIGRATED_DB, REJECTED_DB, TEMPLATE_DB):
            admin.execute(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')


def _preflight_queries():
    return [*revision.PREFLIGHT, *revision.GUARDS]


@pytest.fixture(scope="module")
def migrated(legacy_template):
    _recreate(MIGRATED_DB, TEMPLATE_DB)
    done = _alembic(MIGRATED_DB, "head")
    assert done.returncode == 0, done.stderr[-3000:]
    with _connect(MIGRATED_DB) as conn:
        yield {**legacy_template, "conn": conn}


# --------------------------------------------------------------------------- #
# Pre-flight
# --------------------------------------------------------------------------- #


def test_the_preflight_is_silent_on_clean_legacy_data(legacy_template) -> None:
    assert {q: rows for q, rows in legacy_template["preflight"].items() if rows} == {}


def test_the_operators_preflight_file_is_silent_too(legacy_template) -> None:
    with _connect(TEMPLATE_DB) as conn:
        results = [_rows(conn, statement) for statement in _statements(PREFLIGHT_SQL)]
    assert len(results) == len(_preflight_queries())
    assert [rows for rows in results if rows] == []


def test_every_class_the_converter_rejects_is_reported_with_its_ids_and_stops_the_revision(legacy_template) -> None:
    ids = legacy_template["ids"]
    _recreate(REJECTED_DB, TEMPLATE_DB)
    with _connect(REJECTED_DB) as conn:
        conn.execute(
            "INSERT INTO tournament.encounter (name, tournament_id, home_score, away_score, round, status, best_of)"
            " VALUES ('x', %(t)s, 0, 0, 1, 'OPEN', 0)",
            {"t": ids["t"]},
        )
        bad_best_of = _scalar(conn, "SELECT id FROM tournament.encounter WHERE name = 'x'")

        def duel(name, home, away, **extra):
            columns = {
                "name": name,
                "tournament_id": ids["t"],
                "home_team_id": home,
                "away_team_id": away,
                "home_score": 0,
                "away_score": 0,
                "round": 9,
                "status": "OPEN",
                **extra,
            }
            return _insert(conn, "tournament.encounter", **columns)

        same_team = duel("same team", ids["team_C"], ids["team_C"])
        foreign_team = duel("foreign team", ids["foreign_team"], None)
        foreign_stage = duel("foreign stage", None, None, stage_id=ids["stage_other"])
        ffa_in_bracket = duel("ffa in a bracket", None, None, stage_id=ids["stage_duel"], format="ffa")
        unseated = duel("unseated pick", ids["team_C"], None)
        session = _insert(
            conn,
            "tournament.pick_ban_session",
            encounter_id=unseated,
            kind="map",
            seed_source="standings",
            resolved_sequence_json=Json([]),
            ruleset_json=Json(V2_RULESET),
        )
        entry = _insert(conn, "tournament.pick_ban_entry", session_id=session, item_id=1, order=1, picked_by="away")
        link_a = duel("link a", None, None)
        link_b = duel("link b", None, None)
        link_foreign = _insert(
            conn,
            "tournament.encounter",
            name="t2",
            tournament_id=ids["t2"],
            home_score=0,
            away_score=0,
            round=1,
            status="OPEN",
        )
        dup_one = _insert(
            conn,
            "tournament.encounter_link",
            source_encounter_id=link_a,
            target_encounter_id=ids["e_tbd"],
            role="winner",
            target_slot="home",
        )
        dup_two = _insert(
            conn,
            "tournament.encounter_link",
            source_encounter_id=link_b,
            target_encounter_id=ids["e_tbd"],
            role="winner",
            target_slot="home",
        )
        cross = _insert(
            conn,
            "tournament.encounter_link",
            source_encounter_id=link_a,
            target_encounter_id=link_foreign,
            role="loser",
            target_slot="away",
        )

        found = _run_checks(conn, revision.GUARDS)

    def ids_of(fragment: str, column: int) -> set[int]:
        (rows,) = [rows for question, rows in found.items() if fragment in question]
        return {row[column] for row in rows}

    assert ids_of("link repeats a target slot", 0) == {dup_one, dup_two, cross}
    assert ids_of("best_of is below 1", 0) == {bad_best_of}
    assert ids_of("same team on both sides", 0) == {same_team}
    assert ids_of("another tournament than its encounter", 0) == {foreign_team}
    assert ids_of("stage of another tournament", 0) == {foreign_stage}
    assert ids_of("pick-ban entry", 0) == {entry}
    assert ids_of("not in an ffa_league stage", 0) == {ffa_in_bracket}

    done = _alembic(REJECTED_DB, "head")
    assert done.returncode != 0
    assert "pre-flight failed" in done.stderr
    for fragment, expected in (
        ("link repeats a target slot", dup_one),
        ("best_of is below 1", bad_best_of),
        ("same team on both sides", same_team),
        ("another tournament than its encounter", foreign_team),
        ("stage of another tournament", foreign_stage),
        ("pick-ban entry", entry),
        ("not in an ffa_league stage", ffa_in_bracket),
    ):
        line = next(line for line in done.stderr.splitlines() if fragment in line)
        assert str(expected) in line, f"{fragment}: id {expected} missing from {line}"


# --------------------------------------------------------------------------- #
# The upgrade
# --------------------------------------------------------------------------- #


def test_the_chain_ends_at_enclayer01b_with_every_constraint_validated(migrated) -> None:
    conn = migrated["conn"]
    assert _scalar(conn, "SELECT version_num FROM public.alembic_version") == "enclayer01b"
    assert _rows(conn, "SELECT conrelid::regclass::text, conname FROM pg_constraint WHERE NOT convalidated") == []


def test_ids_survive_the_move(migrated) -> None:
    conn = migrated["conn"]
    moved_to = {
        "tournament.encounter": "encounter.encounter",
        "tournament.encounter_game": "encounter.game",
        "tournament.encounter_result_audit": "encounter.result_audit",
        "tournament.encounter_room_event": "encounter.room_event",
        "tournament.pick_ban_session": "encounter.pick_ban_session",
        "tournament.pick_ban_entry": "encounter.pick_ban_entry",
        "tournament.pick_ban_submission": "encounter.pick_ban_submission",
    }
    after = {table: _id_ranges_of(conn, moved_to[table]) for table in MOVED_TABLES}
    assert after == migrated["before"]


def test_the_audit_label_added_for_the_pending_hold_exists(migrated) -> None:
    labels = _scalar(
        migrated["conn"],
        "SELECT array_agg(e.enumlabel::text) FROM pg_enum e WHERE e.enumtypid = 'encounter.encounterresultauditaction'::regtype",
    )
    assert "auto_pending" in labels


def test_seats_slots_and_placements_come_from_the_sides(migrated) -> None:
    conn, ids = migrated["conn"], migrated["ids"]
    played = _rows(
        conn,
        "SELECT slot, team_id, score, placement, active FROM encounter.team WHERE encounter_id = %s ORDER BY slot",
        (ids["e_played"],),
    )
    assert played == [(1, ids["team_A"], 2.0, 1, True), (2, ids["team_B"], 1.0, 2, True)]
    # Nothing official yet: no place until there is a result.
    open_ = _rows(
        conn, "SELECT slot, placement FROM encounter.team WHERE encounter_id = %s ORDER BY slot", (ids["e_slots"],)
    )
    assert open_ == [(1, None), (2, None)]
    # An empty seat gets no row; the encounter still holds two.
    assert _scalar(conn, "SELECT count(*) FROM encounter.team WHERE encounter_id = %s", (ids["e_tbd"],)) == 0
    assert _scalar(conn, "SELECT slot_count FROM encounter.encounter WHERE id = %s", (ids["e_tbd"],)) == 2
    lobby = _rows(
        conn, "SELECT slot, team_id FROM encounter.team WHERE encounter_id = %s ORDER BY slot", (ids["e_lobby"],)
    )
    assert lobby == [(1, ids["team_A"]), (2, ids["team_B"]), (3, ids["team_C"])]
    assert _scalar(conn, "SELECT slot_count FROM encounter.encounter WHERE id = %s", (ids["e_lobby"],)) == 3


def test_rosters_are_snapshotted_with_their_roles(migrated) -> None:
    conn, ids = migrated["conn"], migrated["ids"]
    rows = _rows(
        conn,
        "SELECT tm.workspace_member_id, r.dimension, r.role FROM encounter.team_member tm"
        " JOIN encounter.team t ON t.id = tm.encounter_team_id"
        " JOIN encounter.team_member_role r ON r.team_member_id = tm.id"
        " WHERE t.encounter_id = %s AND t.slot = 1 ORDER BY tm.workspace_member_id",
        (ids["e_played"],),
    )
    assert [(dimension, role) for _, dimension, role in rows] == [("player_role", "tank"), ("player_role", "damage")]


def test_result_sources(migrated) -> None:
    conn, ids = migrated["conn"], migrated["ids"]
    sources = dict(_rows(conn, "SELECT id, result_source FROM encounter.encounter WHERE result_status = 'confirmed'"))
    assert sources[ids["e_played"]] == "games"  # stored 2-1 IS the games' 2-1
    assert sources[ids["e_admin"]] == "import"  # somebody's number, no games behind it
    assert sources[ids["e_lobby"]] == "games"  # a lobby is always its games
    assert _scalar(conn, "SELECT result_source FROM encounter.encounter WHERE id = %s", (ids["e_slots"],)) is None


def test_games_claims_reports_and_replay_codes(migrated) -> None:
    conn, ids = migrated["conn"], migrated["ids"]
    first = ids["games"][0]
    scores = _rows(
        conn,
        "SELECT t.slot, gt.score, gt.placement, gt.replay_code FROM encounter.game_team gt"
        " JOIN encounter.team t ON t.id = gt.encounter_team_id WHERE gt.game_id = %s ORDER BY t.slot",
        (first,),
    )
    assert scores == [(1, 1, 1, "ABC123"), (2, 0, 2, None)]
    assert _scalar(conn, "SELECT count(*) FROM encounter.game_claim WHERE game_id = %s", (first,)) == 2
    assert _scalar(conn, "SELECT count(*) FROM encounter.game_claim_result WHERE game_id = %s", (first,)) == 4
    assert _scalar(conn, "SELECT count(*) FROM encounter.team_report WHERE encounter_id = %s", (ids["e_played"],)) == 2
    assert (
        _scalar(conn, "SELECT count(*) FROM encounter.team_report_result WHERE encounter_id = %s", (ids["e_played"],))
        == 4
    )
    assert _scalar(conn, "SELECT count(*) FROM encounter.readiness WHERE encounter_id = %s", (ids["e_played"],)) == 1
    assert (
        _scalar(
            conn,
            "SELECT count(*) FROM encounter.room_event WHERE encounter_id = %s AND encounter_team_id IS NOT NULL",
            (ids["e_played"],),
        )
        == 1
    )


def test_the_journal_is_numbered_and_speaks_participations(migrated) -> None:
    conn, ids = migrated["conn"], migrated["ids"]
    rows = _rows(
        conn,
        'SELECT result_version, snapshot_scope, jsonb_array_length("after") FROM encounter.result_audit WHERE encounter_id = %s ORDER BY id',
        (ids["e_played"],),
    )
    assert rows == [(1, "game", 2), (2, "encounter", 2)]
    assert _scalar(conn, "SELECT result_version FROM encounter.encounter WHERE id = %s", (ids["e_played"],)) == 2
    adopted = _scalar(conn, "SELECT adopted_team_id FROM encounter.result_audit WHERE id = %s", (ids["audit_confirm"],))
    assert adopted == _scalar(
        conn, "SELECT id FROM encounter.team WHERE encounter_id = %s AND slot = 1", (ids["e_played"],)
    )
    # The lobby totals row keeps its legacy keys, keyed by participation, as an encounter snapshot.
    scope, after = _rows(
        conn, 'SELECT snapshot_scope, "after" FROM encounter.result_audit WHERE id = %s', (ids["audit_lobby"],)
    )[0]
    assert scope == "encounter" and len(after) == 3 and {"encounter_team_id", "points", "games"} <= set(after[0])


def test_pick_ban_rooms_carry_the_pool_the_room_reads(migrated) -> None:
    conn, ids = migrated["conn"], migrated["ids"]
    pools = {
        key: _scalar(conn, "SELECT pool_json::jsonb FROM encounter.pick_ban_session WHERE id = %s", (ids[key],))
        for key in ("s_slots", "s_hero", "s_pool", "s_gone")
    }
    assert pools["s_slots"] == {
        "mode": "slots",
        "rotation": "alternate",
        "progressive": True,
        "items": [],
        "slots": [[11, 12, 13], [21, 22], [31]],  # best_of 3 cuts the fourth slot
    }
    assert pools["s_hero"] == {
        "mode": "pool",
        "rotation": "result_loser_choice",
        "progressive": True,
        "items": [103, 101, 102],
        "slots": [],
    }
    assert pools["s_pool"] == {
        "mode": "pool",
        "rotation": "fixed",
        "progressive": False,
        "items": [7, 3, 9],
        "slots": [],
    }
    assert pools["s_gone"] == {"mode": "pool", "rotation": "fixed", "progressive": True, "items": [], "slots": []}


def test_pick_ban_sides_become_participations_and_the_ruleset_speaks_slots(migrated) -> None:
    conn, ids = migrated["conn"], migrated["ids"]
    first, pending, undo = _rows(
        conn,
        "SELECT first_team_id, pending_chooser_team_id, undo_requested_by_team_id FROM encounter.pick_ban_session WHERE id = %s",
        (ids["s_slots"],),
    )[0]
    seats = dict(_rows(conn, "SELECT slot, id FROM encounter.team WHERE encounter_id = %s", (ids["e_slots"],)))
    assert (first, pending, undo) == (seats[1], seats[2], seats[1])
    kinds = _rows(
        conn, "SELECT picked_by_kind::text, protected_by_kind::text FROM encounter.pick_ban_entry ORDER BY id"
    )
    assert kinds == [("team", None), ("team", None), ("decider", "admin"), (None, "team")]
    assert _scalar(conn, "SELECT count(*) FROM encounter.pick_ban_submission WHERE encounter_team_id IS NOT NULL") == 2
    actors = _scalar(
        conn,
        "SELECT ruleset_json::jsonb #>> '{phases,0,steps,0,actors}' FROM encounter.pick_ban_session WHERE id = %s",
        (ids["s_slots"],),
    )
    assert actors == "slot:1"
    assert _scalar(conn, "SELECT seed FROM encounter.team WHERE encounter_id = %s AND slot = 1", (ids["e_slots"],)) == 1


def test_links_and_bracket_positions(migrated) -> None:
    conn, ids = migrated["conn"], migrated["ids"]
    links = _rows(conn, "SELECT source_position, target_slot, tournament_id FROM tournament.encounter_link ORDER BY id")
    assert links == [(1, 1, ids["t"]), (2, 2, ids["t"])]
    assert _scalar(conn, "SELECT count(*) FROM tournament.bracket_encounter") == _scalar(
        conn, "SELECT count(*) FROM encounter.encounter"
    )


def test_stored_notifications_say_team_names(migrated) -> None:
    conn, ids = migrated["conn"], migrated["ids"]
    for kind in ("encounter.scheduled", "encounter.dispute_review"):
        payload = _scalar(conn, "SELECT payload_json FROM notification WHERE id = %s", (ids[f"notification_{kind}"],))
        assert payload == {"encounter_id": ids["e_played"], "team_names": ["Team A", "Team B"]}
    # Another kind is not this migration's business.
    assert (
        _scalar(conn, "SELECT payload_json FROM notification WHERE id = %s", (ids["notification_some.other"],))
        == OTHER_PAYLOAD
    )


def test_the_scoring_rules_follow_the_stages(migrated) -> None:
    conn, ids = migrated["conn"], migrated["ids"]
    preset = lambda key: _scalar(  # noqa: E731
        conn,
        "SELECT r.preset FROM encounter.encounter e JOIN encounter.scoring_rule r ON r.id = e.scoring_rule_id WHERE e.id = %s",
        (ids[key],),
    )
    assert (preset("e_played"), preset("e_pool"), preset("e_lobby")) == ("wins", "wins", "points")


# --------------------------------------------------------------------------- #
# Post-upgrade steps
# --------------------------------------------------------------------------- #


def _run_recompute(dry_run: bool) -> int:
    from sqlalchemy.ext.asyncio import create_async_engine
    from sqlalchemy.pool import NullPool

    async def go() -> int:
        engine = create_async_engine(_url(MIGRATED_DB), poolclass=NullPool)
        try:
            return await recompute_script.recompute(dry_run, engine)
        finally:
            await engine.dispose()

    loop_factory = asyncio.SelectorEventLoop if sys.platform == "win32" else None
    return asyncio.run(go(), loop_factory=loop_factory)


def test_the_lobby_recompute_fills_standings_dry_then_for_real_then_does_nothing(migrated) -> None:
    conn, ids = migrated["conn"], migrated["ids"]
    standings = "SELECT t.slot, t.score, t.placement FROM encounter.team t WHERE t.encounter_id = %s ORDER BY t.slot"
    assert _rows(conn, standings, (ids["e_lobby"],)) == [(1, 0.0, None), (2, 0.0, None), (3, 0.0, None)]

    # Dry run: reports the work, writes nothing.
    assert _run_recompute(True) == 3
    assert _rows(conn, standings, (ids["e_lobby"],)) == [(1, 0.0, None), (2, 0.0, None), (3, 0.0, None)]

    # Real run: A 10+5 and 6+2, B 6+9 and 10+1, C 3+1 and 3+0.
    assert _run_recompute(False) == 3
    assert _rows(conn, standings, (ids["e_lobby"],)) == [(1, 23.0, 2), (2, 26.0, 1), (3, 7.0, 3)]
    # Series are not lobbies: their seats keep what the migration wrote.
    assert _rows(conn, standings, (ids["e_played"],)) == [(1, 2.0, 1), (2, 1.0, 2)]

    assert _run_recompute(False) == 0


def test_the_reconcile_report_is_clean_on_a_faithful_migration(migrated) -> None:
    conn = migrated["conn"]
    with _connect(MIGRATED_DB, autocommit=False) as tx:
        create, summary, skipped = _statements(RECONCILE_SQL)
        tx.execute(create)
        report = _rows(tx, summary)
        assert [row for row in report if row[3] != "ok"] == []
        classes = {row[0]: row[1:3] for row in report}
        assert classes["duel seats"] == (12, 12)  # six seated duels, two seats each; the TBD one has none
        assert classes["lobby seats"] == (3, 3)
        assert classes["map reports -> claims"] == (2, 2)
        assert classes["captain reports -> team reports"] == (2, 2)
        assert classes["replay codes"] == (1, 1)
        assert _rows(tx, skipped) == []
    assert conn


def test_the_reconcile_report_names_every_row_the_migration_could_not_carry(migrated) -> None:
    ids = migrated["ids"]
    with _connect(MIGRATED_DB, autocommit=False) as tx:
        # A legacy report from a side that holds no seat, and a replay code for a position with no live game.
        orphan_game = _insert(tx, "encounter.game", encounter_id=ids["e_tbd"], position=1)
        report = _insert(
            tx, "tournament.encounter_map_report", game_id=orphan_game, side="away", home_score=1, away_score=0
        )
        code = _insert(tx, "tournament.encounter_map_code", report_id=ids["captain_B"], map_index=2, code="ZZZ999")
        # Two rows of one member in one team that agree on role and rank but not on name.
        twin = _insert(
            tx,
            "tournament.player",
            name="twin",
            rank=2000,
            role="tank",
            tournament_id=ids["t"],
            workspace_member_id=_scalar(
                tx,
                "SELECT workspace_member_id FROM tournament.player WHERE team_id = %s AND role = 'tank'",
                (ids["team_A"],),
            ),
            team_id=ids["team_A"],
        )
        create, summary, skipped = _statements(RECONCILE_SQL)
        tx.execute(create)
        statuses = {row[0]: row[3] for row in _rows(tx, summary)}
        listed = {(row[0], row[1]) for row in _rows(tx, skipped)}
        tx.rollback()
    assert statuses["map reports -> claims"] == "MISMATCH"
    assert statuses["replay codes"] == "MISMATCH"
    assert statuses["roster rows collapsed by the snapshot"] == "MISMATCH"
    assert ("map reports -> claims", report) in listed
    assert ("replay codes", code) in listed
    assert ("roster rows collapsed by the snapshot", twin) in listed  # the discarded twin, not the row kept


def test_a_v1_write_at_the_same_key_does_not_stand_in_for_a_row_the_migration_skipped(migrated) -> None:
    ids = migrated["ids"]
    long_ago = "2026-01-01T00:00:00Z"
    with _connect(MIGRATED_DB, autocommit=False) as tx:
        seat = {
            slot: _scalar(
                tx, "SELECT id FROM encounter.team WHERE encounter_id = %s AND slot = %s", (ids["e_played"], slot)
            )
            for slot in (1, 2)
        }
        # Legacy rows the migration never carried: a second game's home report, the away side's readiness,
        # and a replay code for a position B's seat has no code at.
        report = _insert(
            tx,
            "tournament.encounter_map_report",
            game_id=ids["games"][1],
            side="home",
            home_score=0,
            away_score=1,
            created_at=long_ago,
        )
        readiness = _insert(
            tx, "tournament.encounter_readiness", encounter_id=ids["e_played"], side="away", created_at=long_ago
        )
        code = _insert(tx, "tournament.encounter_map_code", report_id=ids["captain_B"], map_index=2, code="ZZZ999")
        create, _summary, skipped = _statements(RECONCILE_SQL)
        tx.execute(create)
        assert {("map reports -> claims", report), ("readiness", readiness), ("replay codes", code)} <= {
            (row[0], row[1]) for row in _rows(tx, skipped)
        }

        # V1 now writes its own claim, readiness and replay code at those very keys.
        tx.execute(
            "INSERT INTO encounter.game_claim (encounter_id, game_id, claimant_team_id, basis_version)"
            " VALUES (%s, %s, %s, 1)",
            (ids["e_played"], ids["games"][1], seat[1]),
        )
        tx.execute(
            "INSERT INTO encounter.readiness (encounter_id, encounter_team_id) VALUES (%s, %s)",
            (ids["e_played"], seat[2]),
        )
        tx.execute(
            "UPDATE encounter.game_team SET replay_code = 'V1CODE' WHERE game_id = %s AND encounter_team_id = %s",
            (
                ids["games"][1],
                _scalar(
                    tx,
                    "SELECT id FROM encounter.team WHERE encounter_id = %s AND team_id = %s",
                    (ids["e_played"], ids["team_B"]),
                ),
            ),
        )
        still_listed = {(row[0], row[1]) for row in _rows(tx, skipped)}
        tx.rollback()
    assert ("map reports -> claims", report) in still_listed
    assert ("readiness", readiness) in still_listed
    assert ("replay codes", code) in still_listed


def test_deleting_a_team_after_the_upgrade_keeps_the_encounters_it_played(migrated) -> None:
    conn, ids = migrated["conn"], migrated["ids"]
    with _connect(MIGRATED_DB, autocommit=False) as tx:
        # Team C is home/away of migrated encounters whose legacy side columns still name it.
        assert (
            _scalar(
                tx,
                "SELECT count(*) FROM encounter.encounter WHERE home_team_id = %s OR away_team_id = %s",
                (ids["team_C"], ids["team_C"]),
            )
            == 3
        )
        tx.execute("DELETE FROM tournament.team WHERE id = %s", (ids["team_C"],))
        tx.commit()
        assert (
            _scalar(
                tx,
                "SELECT count(*) FROM encounter.encounter WHERE id = ANY(%s)",
                ([ids["e_admin"], ids["e_pool"], ids["e_gone"]],),
            )
            == 3
        )
        assert _scalar(tx, "SELECT count(*) FROM matches.match WHERE id = %s", (ids["match"],)) == 1
        assert _scalar(tx, "SELECT count(*) FROM encounter.team WHERE team_id IS NULL AND name = 'Team C'") == 4
    assert conn  # the module connection stays open for the tests that follow
