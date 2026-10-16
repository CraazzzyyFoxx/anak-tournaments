"""Execute the operator inventory/blockers against real legacy PostgreSQL rows."""

from __future__ import annotations

import re
import uuid

import pytest
import test_enclayer01_upgrade as transfer
from psycopg.types.json import Json

legacy_template = transfer.legacy_template


@pytest.fixture
def preflight_copy(legacy_template):
    name = f"enclayer01_preflight_{uuid.uuid4().hex[:12]}"
    transfer._recreate(name, transfer.TEMPLATE_DB)
    try:
        with transfer._connect(name) as conn:
            yield conn, legacy_template["ids"]
    finally:
        with transfer._connect("postgres") as admin:
            admin.execute(f'DROP DATABASE "{name}" WITH (FORCE)')


def _operator_results(conn):
    results = {"WARNING": {}, "BLOCKER": {}}
    for kind, _number, question, body in re.findall(
        r"^\\echo '(WARNING|BLOCKER) (\d+)\. ([^\n]*)'\n(.*?)(?=\n\\echo|\Z)",
        transfer.PREFLIGHT_SQL,
        re.M | re.S,
    ):
        (statement,) = transfer._statements(body)
        results[kind][question] = transfer._rows(conn, statement)
    assert results["WARNING"] and results["BLOCKER"]
    return results


def test_clean_source_passes_operator_and_migration_blockers(preflight_copy):
    conn, _ids = preflight_copy
    operator = _operator_results(conn)
    assert not any(operator["WARNING"].values()), operator
    assert not any(operator["BLOCKER"].values()), operator
    assert operator["BLOCKER"] == transfer._run_checks(conn, transfer._preflight_queries())


def test_approved_uncertainty_is_visible_without_becoming_a_blocker(preflight_copy):
    conn, ids = preflight_copy
    member = transfer._scalar(
        conn,
        "SELECT workspace_member_id FROM tournament.player WHERE team_id=%s ORDER BY id LIMIT 1",
        (ids["team_A"],),
    )
    conflicting = transfer._insert(
        conn,
        "tournament.player",
        team_id=ids["team_A"],
        tournament_id=ids["t"],
        workspace_member_id=member,
        name="disputed source role",
        role="support",
        rank=3100,
    )
    metadata_member = transfer._scalar(
        conn,
        "SELECT workspace_member_id FROM tournament.player WHERE team_id=%s ORDER BY id LIMIT 1",
        (ids["team_D"],),
    )
    metadata = transfer._insert(
        conn,
        "tournament.player",
        team_id=ids["team_D"],
        tournament_id=ids["t"],
        workspace_member_id=metadata_member,
        name="other historical display",
        role="tank",
        rank=2000,
        is_substitution=True,
    )
    transfer._spare_member_on(conn, ids, A=False, D=False)
    conn.execute(
        "UPDATE tournament.encounter SET home_team_id=%s,away_team_id=%s WHERE id=%s",
        (ids["team_A"], ids["team_A"], ids["e_tbd"]),
    )
    transfer._insert(conn, "tournament.encounter_game", encounter_id=ids["e_played"], position=1, state="cancelled")
    operator = _operator_results(conn)
    warnings = operator["WARNING"]
    assert all(warnings.values()), operator
    role_rows = next(rows for question, rows in warnings.items() if question.startswith("conflicting role/rank"))
    metadata_rows = next(rows for question, rows in warnings.items() if question.startswith("agreeing role/rank"))
    replay_rows = next(rows for question, rows in warnings.items() if question.startswith("cancelled/live"))
    self_rows = next(rows for question, rows in warnings.items() if question.startswith("self-duel"))
    assert any(conflicting in row[2] for row in role_rows)
    assert any(metadata in row[2] for row in metadata_rows)
    assert (ids["map_code"], ids["e_played"], 1) in replay_rows
    assert (ids["e_tbd"], ids["team_A"]) in self_rows
    assert not any(operator["BLOCKER"].values()), operator
    assert operator["BLOCKER"] == transfer._run_checks(conn, transfer._preflight_queries())


@pytest.mark.parametrize("custom_fields", [{"historical_replay_codes": []}, [], "text", None])
@pytest.mark.parametrize("position,state", [(1, "cancelled"), (4, None), (5, "cancelled")])
def test_unsafe_replay_evidence_overwrite_remains_blocking(preflight_copy, custom_fields, position, state):
    conn, ids = preflight_copy
    if state is not None:
        transfer._insert(
            conn,
            "tournament.encounter_game",
            encounter_id=ids["e_played"],
            position=position,
            state=state,
        )
    code = (
        ids["map_code"]
        if position == 1
        else transfer._insert(
            conn,
            "tournament.encounter_map_code",
            report_id=ids["captain_A"],
            map_index=position,
            code="UNBOUND",
        )
    )
    conn.execute(
        "UPDATE tournament.encounter_captain_report SET custom_fields_json=%s WHERE id=%s",
        (Json(custom_fields), ids["captain_A"]),
    )
    operator = _operator_results(conn)
    question = "ambiguous replay report custom fields cannot preserve historical_replay_codes without overwrite"
    assert operator["BLOCKER"][question] == [(ids["captain_A"], ids["e_played"], code, position)]
    assert operator["BLOCKER"] == transfer._run_checks(conn, transfer._preflight_queries())


def test_foreign_team_remains_blocking(preflight_copy):
    conn, ids = preflight_copy
    conn.execute("UPDATE tournament.encounter SET home_team_id=%s WHERE id=%s", (ids["foreign_team"], ids["e_tbd"]))
    operator = _operator_results(conn)
    question = "seated team belongs to another tournament than its encounter"
    assert operator["BLOCKER"][question] == [(ids["e_tbd"], ids["t"], ids["foreign_team"], ids["t2"])]
    assert operator["BLOCKER"] == transfer._run_checks(conn, transfer._preflight_queries())
