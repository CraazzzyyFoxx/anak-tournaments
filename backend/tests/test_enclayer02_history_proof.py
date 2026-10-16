"""Exercise the operator proof and destructive gate on real historical uncertainty."""

from __future__ import annotations

import uuid

import pytest
import test_enclayer01_upgrade as transfer

legacy_template = transfer.legacy_template


def _drop_database(name: str) -> None:
    with transfer._connect("postgres") as admin:
        admin.execute(f'DROP DATABASE "{name}" WITH (FORCE)')


@pytest.fixture(scope="module")
def historical_template(legacy_template):
    name = f"enclayer02_history_{uuid.uuid4().hex[:12]}"
    transfer._recreate(name, transfer.TEMPLATE_DB)
    ids = dict(legacy_template["ids"])
    try:
        with transfer._connect(name) as conn:
            member = transfer._scalar(
                conn,
                "SELECT workspace_member_id FROM tournament.player WHERE team_id=%s ORDER BY id LIMIT 1",
                (ids["team_A"],),
            )
            ids["conflicting_player"] = transfer._insert(
                conn,
                "tournament.player",
                name="historical disputed registration",
                rank=3100,
                role="support",
                tournament_id=ids["t"],
                team_id=ids["team_A"],
                workspace_member_id=member,
                is_substitution=True,
            )
            other = transfer._scalar(
                conn,
                "SELECT workspace_member_id FROM tournament.player WHERE team_id=%s ORDER BY id LIMIT 1",
                (ids["team_C"],),
            )
            transfer._insert(
                conn,
                "tournament.player",
                name="historical cross-side claim",
                rank=2000,
                role="tank",
                tournament_id=ids["t"],
                team_id=ids["team_B"],
                workspace_member_id=other,
            )
            ids["metadata_member"] = transfer._scalar(
                conn,
                "SELECT workspace_member_id FROM tournament.player WHERE team_id=%s ORDER BY id LIMIT 1",
                (ids["team_D"],),
            )
            transfer._insert(
                conn,
                "tournament.player",
                name="other historical display name",
                rank=2000,
                role="tank",
                tournament_id=ids["t"],
                team_id=ids["team_D"],
                workspace_member_id=ids["metadata_member"],
                is_substitution=True,
            )
            ids["self_duel"] = ids["e_tbd"]
            conn.execute(
                "UPDATE tournament.encounter SET home_team_id=%s,away_team_id=%s,home_score=1,away_score=3,"
                "status='COMPLETED',result_status='confirmed' WHERE id=%s",
                (ids["team_A"], ids["team_A"], ids["self_duel"]),
            )
            for position in (1, 2):
                transfer._insert(
                    conn,
                    "tournament.encounter_game",
                    encounter_id=ids["e_played"],
                    position=position,
                    state="cancelled",
                )
            transfer._insert(
                conn,
                "tournament.encounter_map_code",
                report_id=ids["captain_A"],
                map_index=2,
                code="SECOND",
            )
            transfer._insert(
                conn,
                "tournament.encounter_map_code",
                report_id=ids["captain_A"],
                map_index=4,
                code="NO-GAME",
            )
            transfer._insert(
                conn,
                "tournament.encounter_game",
                encounter_id=ids["e_played"],
                position=5,
                state="cancelled",
            )
            transfer._insert(
                conn,
                "tournament.encounter_map_code",
                report_id=ids["captain_A"],
                map_index=5,
                code="CANCELLED-ONLY",
            )
            source_players = transfer._scalar(
                conn, "SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM tournament.player p"
            )
            source_codes = transfer._scalar(
                conn,
                "SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM tournament.encounter_map_code c",
            )
            original_duel = transfer._scalar(
                conn,
                "SELECT to_jsonb(e) FROM tournament.encounter e WHERE id=%s",
                (ids["self_duel"],),
            )
        done = transfer._alembic(name, "enclayer01b")
        assert done.returncode == 0, done.stderr[-5000:]
        yield {"name": name, "ids": ids, "players": source_players, "codes": source_codes, "duel": original_duel}
    finally:
        _drop_database(name)


@pytest.fixture
def history_copy(historical_template):
    name = f"enclayer02_proof_{uuid.uuid4().hex[:12]}"
    transfer._recreate(name, historical_template["name"])
    try:
        yield {**historical_template, "name": name}
    finally:
        _drop_database(name)


def _operator_rows(conn):
    create, _summary, _skipped = transfer._statements(transfer.RECONCILE_SQL)
    conn.execute(create)
    return transfer._rows(conn, "SELECT class,legacy_id,detail,ok FROM enclayer01_reconcile ORDER BY 1,2,3")


def test_operator_and_gate_prove_the_same_source_projection(history_copy):
    with transfer._connect(history_copy["name"]) as conn:
        operator = _operator_rows(conn)
        assert operator and all(row[3] is True for row in operator), [row for row in operator if row[3] is not True]
        conn.execute("DROP VIEW enclayer01_reconcile")
        gate = transfer._load(
            "enclayer02_history_gate",
            transfer.BACKEND / "migrations" / "versions" / "enclayer02_drop_legacy.py",
        )
        conn.execute(gate.RECONCILE_VIEW)
        assert (
            transfer._rows(
                conn,
                "SELECT class,legacy_id,detail,ok FROM enclayer01_reconcile ORDER BY 1,2,3",
            )
            == operator
        )
        assert (
            transfer._scalar(
                conn,
                "SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM tournament.player p",
            )
            == history_copy["players"]
        )
        assert (
            transfer._scalar(
                conn,
                "SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM tournament.encounter_map_code c",
            )
            == history_copy["codes"]
        )
        assert transfer._rows(
            conn,
            "SELECT slot,team_id,name,score,placement FROM encounter.team WHERE encounter_id=%s ORDER BY slot",
            (history_copy["ids"]["self_duel"],),
        ) == [(1, history_copy["ids"]["team_A"], "Team A", 1.0, 2), (2, None, "Unknown opponent", 3.0, 1)]
        metadata_snapshots = transfer._rows(
            conn,
            "SELECT tm.display_name_snapshot,tm.rank,tm.is_substitute,"
            "array_agg(mr.role ORDER BY mr.role) FROM encounter.team_member tm "
            "JOIN encounter.team_member_role mr ON mr.team_member_id=tm.id "
            "WHERE tm.workspace_member_id=%s GROUP BY tm.id ORDER BY tm.id",
            (history_copy["ids"]["metadata_member"],),
        )
        assert metadata_snapshots and all(
            row == (f"p{history_copy['ids']['metadata_member']}", 2000, False, ["tank"]) for row in metadata_snapshots
        )


@pytest.mark.parametrize(
    "damage,expected",
    [
        ("DELETE FROM public.audit_log WHERE reason='conflicting_roster_role_rank'", "unresolved roster role/rank"),
        (
            "UPDATE public.audit_log SET before_json=jsonb_set(before_json,'{registrations}',"
            "(before_json->'registrations')-0) WHERE reason='conflicting_roster_role_rank'",
            "unresolved roster role/rank",
        ),
        ("DELETE FROM public.audit_log WHERE reason='conflicting_roster_metadata'", "collapsed roster source evidence"),
        (
            "UPDATE public.audit_log SET before_json=jsonb_set(before_json,'{registrations}',"
            "(before_json->'registrations')-0) WHERE reason='conflicting_roster_metadata'",
            "collapsed roster source evidence",
        ),
        (
            "UPDATE encounter.team_member SET display_name_snapshot='forged canonical identity' WHERE workspace_member_id IN "
            "(SELECT (before_json->>'workspace_member_id')::bigint FROM public.audit_log "
            "WHERE reason='conflicting_roster_metadata')",
            "roster snapshots",
        ),
        (
            "UPDATE public.audit_log SET before_json=jsonb_set(before_json,'{registrations}',"
            "(before_json->'registrations')-0) WHERE reason='ambiguous_roster_seat'",
            "unresolved roster seats",
        ),
        (
            "UPDATE public.audit_log SET before_json=before_json-'away_team_id' WHERE reason='same_team_both_sides'",
            "self-duel source evidence",
        ),
        (
            "UPDATE encounter.team_report SET custom_fields_json=(custom_fields_json::jsonb)-'historical_replay_codes'"
            " WHERE custom_fields_json::jsonb ? 'historical_replay_codes'",
            "captain reports -> team reports",
        ),
        (
            "UPDATE encounter.team_report SET custom_fields_json=jsonb_set(custom_fields_json::jsonb,"
            "'{historical_replay_codes}',(custom_fields_json::jsonb->'historical_replay_codes') || "
            "jsonb_build_array(custom_fields_json::jsonb->'historical_replay_codes'->0))"
            " WHERE custom_fields_json::jsonb ? 'historical_replay_codes'",
            "captain reports -> team reports",
        ),
        (
            "UPDATE encounter.game_team SET replay_code='WRONG' WHERE game_id IN "
            "(SELECT id FROM encounter.game WHERE position=1)",
            "replay codes",
        ),
    ],
)
def test_drop_refuses_missing_or_incomplete_original_claims(history_copy, damage, expected):
    with transfer._connect(history_copy["name"]) as conn:
        assert conn.execute(damage).rowcount > 0
        rows = _operator_rows(conn)
        assert any(row[0] == expected and row[3] is not True for row in rows), rows
    done = transfer._alembic(history_copy["name"], "enclayer02", OWT_APPLY_ENCOUNTER_LAYER_DROP="1")
    assert done.returncode != 0
    assert expected in done.stderr
    with transfer._connect(history_copy["name"]) as conn:
        assert transfer._scalar(conn, "SELECT to_regclass('tournament.encounter_map_code') IS NOT NULL")
        assert transfer._scalar(conn, "SELECT version_num FROM alembic_version") == "enclayer01b"


def test_successful_drop_keeps_the_exact_native_source_evidence(history_copy):
    with transfer._connect(history_copy["name"]) as conn:
        audit = transfer._rows(
            conn,
            "SELECT workspace_id,entity_type,entity_id,reason,before_json,after_json FROM public.audit_log "
            "WHERE action='encounter.history_unresolved' ORDER BY id",
        )
        reports = transfer._rows(conn, "SELECT id,custom_fields_json FROM encounter.team_report ORDER BY id")
        assert audit and any(row[4] == history_copy["duel"] for row in audit)
        historical_codes = [code for _report, fields in reports for code in fields.get("historical_replay_codes", [])]
        expected_codes = [
            {
                **{key: code[key] for key in ("id", "report_id", "map_index", "code")},
                "reason": {
                    1: "cancelled_and_live_position",
                    2: "cancelled_and_live_position",
                    4: "no_live_game_at_position",
                    5: "no_live_game_at_position",
                }[code["map_index"]],
            }
            for code in history_copy["codes"]
        ]
        assert sorted(historical_codes, key=lambda code: code["id"]) == expected_codes
    done = transfer._alembic(history_copy["name"], "enclayer02", OWT_APPLY_ENCOUNTER_LAYER_DROP="1")
    assert done.returncode == 0, done.stderr[-5000:]
    with transfer._connect(history_copy["name"]) as conn:
        assert transfer._scalar(conn, "SELECT to_regclass('tournament.encounter_map_code') IS NULL")
        assert (
            transfer._rows(
                conn,
                "SELECT workspace_id,entity_type,entity_id,reason,before_json,after_json FROM public.audit_log "
                "WHERE action='encounter.history_unresolved' ORDER BY id",
            )
            == audit
        )
        assert transfer._rows(conn, "SELECT id,custom_fields_json FROM encounter.team_report ORDER BY id") == reports
        assert (
            transfer._scalar(
                conn,
                "SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM tournament.player p",
            )
            == history_copy["players"]
        )
