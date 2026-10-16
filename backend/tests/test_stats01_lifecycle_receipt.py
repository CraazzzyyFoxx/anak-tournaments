"""Real stats01 receipts and transaction chains; controller runs on isolated PostgreSQL."""

from __future__ import annotations

import asyncio
import copy
import hashlib
import io
import json
import os
import subprocess
import sys
from datetime import UTC, datetime, timedelta, timezone
from pathlib import Path

import pytest
import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from scripts import stats01_reconcile as reconcile
from shared.services.audit import record_audit
from shared.services.stats_evidence import (
    EvidenceError,
    capture_native,
    capture_stats_evidence,
    owner_scopes,
    semantic_bytes,
    semantic_digest,
    stage_stats_evidence,
    validate_transition,
)
from shared.testing.stats_parity import upgrade_database


def test_codec_is_exact_recursive_and_timezone_independent():
    # Decimal text rounding, naive timestamp acceptance, or JSON-key ordering drift breaks receipts.
    row = [None, False, 7, -0.0, {"z": [1.5], "a": "é"}, datetime(2026, 1, 1, tzinfo=UTC)]
    assert semantic_bytes(row) == (
        b'[null,false,7,{"$float":"-0x0.0p+0"},{"a":"\xc3\xa9","z":[{"$float":"0x1.8000000000000p+0"}]},'
        b'{"$timestamp":"2026-01-01T00:00:00.000000Z"}]'
    )
    shifted = copy.deepcopy(row)
    shifted[-1] = datetime(2026, 1, 1, 3, tzinfo=timezone(timedelta(hours=3)))
    assert semantic_bytes(shifted) == semantic_bytes(row)
    for invalid in (float("nan"), float("inf"), datetime(2026, 1, 1)):
        with pytest.raises(EvidenceError):
            semantic_bytes([invalid])


def test_digest_keeps_duplicates_empty_partition_and_owner_identity():
    scope = ("match", (42,), "event_body")
    once = semantic_digest(scope, [[0, 1.0]])
    twice = semantic_digest(scope, [[0, 1.0], [0, 1.0]])
    assert once[0] == 1 and twice[0] == 2 and once[1] != twice[1]
    assert semantic_digest(scope, [])[1] != semantic_digest(("match", (43,), "event_body"), [])[1]
    assert semantic_digest(scope, [])[1] != semantic_digest(("match", (42,), "event_fight"), [])[1]


def test_whitelist_rejects_missing_complements_and_unknown_operation():
    state = {
        "owner_kind": "match",
        "owner_key": [42],
        "subset": "duration",
        "owner_exists": True,
        "row_count": 1,
        "sha256": "a" * 64,
        "identity_sha256": None,
    }
    with pytest.raises(EvidenceError):
        validate_transition("stats.match_edit", [state], [state])
    with pytest.raises(EvidenceError):
        validate_transition("stats.anything", [], [])


def test_receipt_json_rejects_nonfinite_numbers():
    # Receipt JSON is portable, not Python's nonstandard NaN extension.
    with pytest.raises(EvidenceError):
        semantic_bytes(json.loads("[NaN]"))
    assert semantic_bytes([1.0]) != semantic_bytes([{"$float": "0x1.0000000000000p+0"}])
    assert semantic_bytes([{"$float": "x"}]) != semantic_bytes([{"$object": {"$float": "x"}}])


@pytest.fixture
def native(stats01_database):
    url, ids = stats01_database
    engine = sa.create_engine(url, poolclass=sa.pool.NullPool)
    try:
        yield engine, ids, url
    finally:
        engine.dispose()


def _capture(native, path):
    engine, _, _ = native
    revision = reconcile.revision_module()
    with reconcile.readonly_snapshot(engine, revision) as conn:
        result = reconcile.capture_receipt(conn, path, revision)
    assert result["exit_code"] == 0
    return path


def _check(native, receipt, *, export=None):
    revision = reconcile.revision_module()
    with reconcile.readonly_snapshot(native[0], revision, receipt_dir=receipt) as conn:
        return reconcile.check_receipt(conn, receipt, revision, export=export)


def _execute_user_merge(native, source_user, target_user):
    """Run the actual app service without sharing another service's ``src`` imports."""
    backend = Path(__file__).resolve().parents[1]
    url = sa.make_url(native[2])
    env = {
        **os.environ,
        "POSTGRES_HOST": url.host,
        "POSTGRES_PORT": str(url.port),
        "POSTGRES_USER": url.username,
        "POSTGRES_PASSWORD": url.password,
        "POSTGRES_DB": url.database,
        "PYTHONPATH": os.pathsep.join(filter(None, (str(backend), os.environ.get("PYTHONPATH")))),
    }
    script = """
import asyncio
import json
import sys
from unittest.mock import AsyncMock, Mock, patch
import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from shared.testing import apply_test_env_defaults, configure_test_cache
apply_test_env_defaults()
from src import schemas
from src.services.admin.user_merge import UserMergeService

async def run():
    configure_test_cache()
    engine = create_async_engine(sa.make_url(sys.argv[1]).set(drivername="postgresql+asyncpg"), poolclass=sa.pool.NullPool)
    try:
        async with AsyncSession(engine, expire_on_commit=False) as session:
            service = UserMergeService()
            preview = await service.preview_merge(session, schemas.UserMergePreviewRequest(
                source_user_id=int(sys.argv[2]), target_user_id=int(sys.argv[3]),
            ))
            request = schemas.UserMergeExecuteRequest(
                source_user_id=preview.source.id, target_user_id=preview.target.id,
                preview_fingerprint=preview.preview_fingerprint, field_policy={}, identity_selection={},
                auth_policy=preview.auth_merge.policy if preview.auth_merge else None,
                confirm_auth_changes=True, confirm_auth_deletion=True, confirm_permission_changes=True,
            )
            async def finalized(result):
                assert result.affected_auth_user_ids
            redis = Mock(delete=AsyncMock(), aclose=AsyncMock())
            with patch("src.services.admin.user_merge.Redis.from_url", return_value=redis):
                result = await service.execute_merge(
                    session, request, operator_auth_user_id=None, auth_finalizer=finalized,
                )
            print(json.dumps({"audit_id": result.audit_id}))
    finally:
        await engine.dispose()
asyncio.run(run())
"""
    completed = subprocess.run(
        [sys.executable, "-c", script, native[2], str(source_user), str(target_user)],
        cwd=backend / "app-service",
        env=env,
        capture_output=True,
        text=True,
        timeout=300,
    )
    assert completed.returncode == 0, (completed.stdout, completed.stderr)
    return json.loads(completed.stdout.splitlines()[-1])["audit_id"]


def _mutate(native, owners, operation, statements, *, mapping=(), rollback=False, reuse=False):
    """Actual SQL, captures and audit insertion in one real async transaction."""
    _, ids, url = native

    async def run():
        engine = create_async_engine(sa.make_url(url).set(drivername="postgresql+asyncpg"), poolclass=sa.pool.NullPool)
        try:
            async with AsyncSession(engine, expire_on_commit=False) as session:
                async with session.begin():
                    scopes = [scope for kind, key in owners for scope in owner_scopes(kind, key)]
                    before = await capture_stats_evidence(session, scopes=scopes, identity_map=mapping)
                    for statement in statements:
                        result = await session.execute(sa.text(statement), ids)
                        assert result.rowcount != 0, "mutation must exercise real fixture rows"
                    await session.flush()
                    after = await capture_stats_evidence(session, scopes=scopes, identity_map=mapping)
                    pending = (
                        await record_audit(
                            session,
                            action="test.domain_edit",
                            source="admin",
                            before={"named": "before"},
                            after={"named": "after"},
                        )
                        if reuse
                        else None
                    )
                    row = await stage_stats_evidence(
                        session,
                        operation=operation,
                        before=before,
                        after=after,
                        workspace_id=ids["workspace"],
                        entity_type="stats_test",
                        entity_id=ids["match"],
                        audit=pending,
                        identity_map=mapping,
                    )
                    result = (row.id, before, after)
                    if rollback:
                        await session.rollback()
                    return result
        finally:
            await engine.dispose()

    return asyncio.run(run())


def _refresh(native):
    with native[0].begin() as conn:
        conn.execute(sa.text("REFRESH MATERIALIZED VIEW stats.mv_entity_global_stats"))


def test_receipt_roundtrip_complete_owners_and_immutable_publication(native, tmp_path):
    receipt = _capture(native, tmp_path / "receipt")
    manifest = reconcile.load_manifest(receipt, reconcile.revision_module())
    assert manifest["snapshot"] and manifest["database_name"]
    owners = {owner for owner, _ in reconcile.saved_owners(receipt)}
    ids = native[1]
    assert {
        ("match", (ids["match"],)),
        ("job", (ids["record"],)),
        ("member", (ids["member"],)),
        ("channel", (ids["channel"],)),
        ("alias", (ids["alias_miss"],)),
        ("evaluation", (ids["evaluation_result"],)),
        ("override", (ids["override"],)),
        ("rule", (ids["rule"],)),
        ("outbox", (ids["outbox"],)),
    } <= owners
    assert any(kind == "baseline" for kind, _ in owners)
    assert _check(native, receipt)["exit_code"] == 0
    original = (receipt / "manifest.json").read_bytes()
    with pytest.raises(EvidenceError, match="already exists"):
        _capture(native, receipt)
    assert (receipt / "manifest.json").read_bytes() == original


def test_initial_receipt_records_bounded_average_deltas_and_rejects_policy_tampering(native, tmp_path):
    receipt = _capture(native, tmp_path / "receipt")
    manifest = reconcile.load_manifest(receipt, reconcile.revision_module())
    mv = next(proof for proof in manifest["proof"] if proof["class"] == "mv")
    assert 0 < mv["avg_comparison"]["max_abs_delta"] <= 1e-12
    assert mv["non_avg_semantic_sha256"] != mv["native_semantic_sha256"]
    mv["avg_comparison"]["absolute_tolerance"] = 1.0
    (receipt / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    with pytest.raises(EvidenceError, match="invalid initial MV average policy"):
        reconcile.load_manifest(receipt, reconcile.revision_module())


@pytest.mark.parametrize("damage", ["missing_manifest", "missing_owners", "byte_tamper", "missing_partition"])
def test_receipt_corruption_never_becomes_success(native, tmp_path, damage):
    receipt = _capture(native, tmp_path / "receipt")
    if damage == "missing_manifest":
        (receipt / "manifest.json").unlink()
    elif damage == "missing_owners":
        (receipt / "owners.jsonl").unlink()
    elif damage == "byte_tamper":
        with (receipt / "owners.jsonl").open("ab") as stream:
            stream.write(b"{}\n")
    else:
        # Even a correctly re-hashed file cannot silently omit one complement.
        lines = (receipt / "owners.jsonl").read_bytes().splitlines(keepends=True)
        index = next(i for i, line in enumerate(lines) if json.loads(line)["owner_kind"] == "match")
        del lines[index]
        raw = b"".join(lines)
        (receipt / "owners.jsonl").write_bytes(raw)
        manifest = json.loads((receipt / "manifest.json").read_bytes())
        manifest.update(owners_count=len(lines), owners_sha256=hashlib.sha256(raw).hexdigest())
        (receipt / "manifest.json").write_text(json.dumps(manifest))
    with pytest.raises(EvidenceError):
        reconcile.load_manifest(receipt, reconcile.revision_module())


@pytest.mark.parametrize(
    "sql",
    [
        "UPDATE stats.discord_channel SET channel_name='tampered before receipt' WHERE id=:channel",
        "UPDATE catalog.alias_miss SET last_ingest_job_id=NULL WHERE id=:alias_miss",
        "UPDATE achievements.evaluation_result SET match_id=NULL WHERE id=:evaluation_result",
        'UPDATE achievements.rule SET depends_on=\'["stats.event","unrelated"]\'::json WHERE id=:rule',
        "UPDATE event_outbox SET payload_json=jsonb_set(payload_json::jsonb,'{changed_tables}','[\"unrelated\"]'::jsonb) WHERE id=:outbox",
        "UPDATE stats.fact SET value=value+1 WHERE match_id=:match AND workspace_member_id=:member",
        "DELETE FROM stats.event WHERE id=(SELECT min(id) FROM stats.event WHERE match_id=:match)",
    ],
)
def test_pre_capture_corruption_cannot_certify_itself(native, tmp_path, sql):
    with native[0].begin() as conn:
        assert conn.execute(sa.text(sql), native[1]).rowcount > 0
    with pytest.raises(EvidenceError):
        _capture(native, tmp_path / "receipt")
    assert not (tmp_path / "receipt" / "manifest.json").exists()


@pytest.mark.parametrize("damage", ["chunk", "manifest", "delete_chunk", "duplicate_chunk"])
def test_initial_oracle_manifest_cannot_shrink_or_be_replaced(native, tmp_path, damage):
    with native[0].begin() as conn:
        if damage == "chunk":
            conn.execute(
                sa.text(
                    "UPDATE audit_log SET after_json=jsonb_set(after_json,'{stats01_oracle,sha256}',to_jsonb(repeat('0',64))) WHERE action='stats.initial_transfer' AND after_json->'stats01_oracle'->>'kind'='chunk'"
                )
            )
        elif damage == "manifest":
            conn.execute(
                sa.text(
                    "UPDATE audit_log SET after_json=jsonb_set(after_json,'{stats01_oracle,classes}','[]') WHERE action='stats.initial_transfer' AND after_json->'stats01_oracle'->>'kind'='manifest'"
                )
            )
        elif damage == "delete_chunk":
            conn.execute(
                sa.text(
                    "DELETE FROM audit_log WHERE id=(SELECT min(id) FROM audit_log WHERE after_json->'stats01_oracle'->>'kind'='chunk')"
                )
            )
        else:
            conn.execute(
                sa.text(
                    "INSERT INTO audit_log(source,action,after_json) SELECT source,action,after_json FROM audit_log WHERE after_json->'stats01_oracle'->>'kind'='chunk' LIMIT 1"
                )
            )
    with pytest.raises(EvidenceError):
        _capture(native, tmp_path / "receipt")


@pytest.mark.parametrize(
    "operation,kind,key,sql",
    [
        (
            "stats.reparse",
            "match",
            "match",
            "UPDATE stats.match SET revision=revision+1,duration_s=duration_s+1 WHERE id=:match",
        ),
        (
            "stats.job_transition",
            "job",
            "record",
            "UPDATE stats.ingest_job SET status='failed',attempts=attempts+1,error_message='retryable' WHERE id=:record",
        ),
        (
            "stats.job_hint",
            "job",
            "record",
            "UPDATE stats.ingest_job SET hint_encounter_game_id=:game WHERE id=:record",
        ),
        (
            "stats.derived_backfill",
            "match",
            "match",
            "UPDATE stats.event SET data=jsonb_set(COALESCE(data,'{}'),'{fight}','991') WHERE match_id=:match AND data IS NOT NULL",
        ),
        (
            "stats.score_edit",
            "match",
            "match",
            "UPDATE stats.fact SET value=value+1 WHERE match_id=:match AND workspace_member_id IS NULL AND entity_id IS NULL AND segment=0 AND stat_id=(SELECT id FROM stats.stat_def WHERE discipline='overwatch' AND code='score')",
        ),
        (
            "stats.match_edit",
            "match",
            "match",
            "UPDATE stats.match SET duration_s=duration_s+1,updated_at=clock_timestamp() WHERE id=:match",
        ),
        (
            "stats.reference_update",
            "channel",
            "channel",
            "UPDATE stats.discord_channel SET channel_name='reviewed channel' WHERE id=:channel",
        ),
    ],
)
def test_permitted_operations_are_review_required_and_complements_remain_exact(
    native, tmp_path, operation, kind, key, sql
):
    receipt = _capture(native, tmp_path / "receipt")
    audit_id, before, after = _mutate(native, [(kind, (native[1][key],))], operation, [sql], reuse=True)
    _refresh(native)
    result = _check(native, receipt)
    assert result["exit_code"] == 2, result
    with native[0].connect() as conn:
        row = conn.execute(sa.text("SELECT before_json,after_json FROM audit_log WHERE id=:id"), {"id": audit_id}).one()
        assert row.before_json["named"] == "before" and row.after_json["named"] == "after"
        assert row.after_json["stats_evidence"]["operation"] == operation
    assert len(before) == len(after)
    changed = {left["subset"] for left, right in zip(before, after, strict=True) if left["sha256"] != right["sha256"]}
    from shared.services.stats_evidence import OPERATIONS

    assert changed and changed <= OPERATIONS[operation][kind]


def test_baseline_and_vocabulary_changes_have_disjoint_owner_evidence(native, tmp_path):
    receipt = _capture(native, tmp_path / "receipt")
    with native[0].connect() as conn:
        version = conn.scalar(sa.text("SELECT formula_version FROM stats.stat_baseline WHERE id=:baseline"), native[1])
    _mutate(
        native,
        [("baseline", ("overwatch", version))],
        "stats.baseline_recompute",
        ["UPDATE stats.stat_baseline SET mean=mean+1 WHERE id=:baseline"],
    )
    _mutate(
        native,
        [("vocabulary", ("overwatch", "stat", "score"))],
        "stats.vocabulary_project",
        ["UPDATE stats.stat_def SET name='Reviewed score' WHERE discipline='overwatch' AND code='score'"],
    )
    assert _check(native, receipt)["exit_code"] == 2
    with native[0].begin() as conn:
        conn.execute(sa.text("UPDATE stats.stat_baseline SET std=std+5 WHERE id=:baseline"), native[1])
    assert _check(native, receipt)["exit_code"] == 1


@pytest.mark.parametrize(
    "kind,key,sql",
    [
        ("alias", "alias_miss", "UPDATE catalog.alias_miss SET last_ingest_job_id=NULL WHERE id=:alias_miss"),
        (
            "evaluation",
            "evaluation_result",
            "UPDATE achievements.evaluation_result SET match_id=:match_reversed WHERE id=:evaluation_result",
        ),
        ("override", "override", "UPDATE achievements.override SET match_id=:match WHERE id=:override"),
        (
            "rule",
            "rule",
            'UPDATE achievements.rule SET depends_on=\'["stats.event","stats.fact"]\'::json WHERE id=:rule',
        ),
        (
            "outbox",
            "outbox",
            "UPDATE event_outbox SET payload_json=jsonb_set(payload_json::jsonb,'{changed_tables}','[\"stats.event\",\"stats.fact\"]'::jsonb) WHERE id=:outbox",
        ),
    ],
)
def test_reference_updates_preserve_complete_owner_set(native, tmp_path, kind, key, sql):
    receipt = _capture(native, tmp_path / "receipt")
    _mutate(native, [(kind, (native[1][key],))], "stats.reference_update", [sql])
    assert _check(native, receipt)["exit_code"] == 2


def test_rollback_keeps_data_and_evidence_atomic(native, tmp_path):
    receipt = _capture(native, tmp_path / "receipt")
    audit_id, _, _ = _mutate(
        native,
        [("match", (native[1]["match"],))],
        "stats.match_edit",
        ["UPDATE stats.match SET duration_s=duration_s+25 WHERE id=:match"],
        rollback=True,
    )
    with native[0].connect() as conn:
        assert conn.scalar(sa.text("SELECT count(*) FROM audit_log WHERE id=:id"), {"id": audit_id}) == 0
    assert _check(native, receipt)["exit_code"] == 0


@pytest.mark.parametrize(
    "sql",
    [
        "UPDATE stats.fact SET value=value+1 WHERE match_id=:match AND workspace_member_id=:member",
        "UPDATE stats.event SET data=jsonb_set(COALESCE(data,'{}'),'{fight}','999') WHERE match_id=:match",
        "UPDATE stats.fact SET value=value+1 WHERE match_id=:match AND workspace_member_id IS NULL",
        "UPDATE stats.match SET revision=revision+1 WHERE id=:match",
        "UPDATE stats.match_team SET source_position=source_position+10 WHERE match_id=:match",
    ],
)
def test_legitimate_change_is_not_a_blanket_waiver_for_later_tamper(native, tmp_path, sql):
    receipt = _capture(native, tmp_path / "receipt")
    _mutate(
        native,
        [("match", (native[1]["match"],))],
        "stats.match_edit",
        ["UPDATE stats.match SET duration_s=duration_s+1 WHERE id=:match"],
    )
    with native[0].begin() as conn:
        assert conn.execute(sa.text(sql), native[1]).rowcount > 0
    _refresh(native)
    assert _check(native, receipt)["exit_code"] == 1


@pytest.mark.parametrize("damage", ["missing", "reordered", "before", "unsupported"])
def test_missing_or_reordered_chain_links_block(native, tmp_path, damage):
    receipt = _capture(native, tmp_path / "receipt")
    first, _, _ = _mutate(
        native,
        [("match", (native[1]["match"],))],
        "stats.match_edit",
        ["UPDATE stats.match SET duration_s=duration_s+1 WHERE id=:match"],
    )
    second, _, _ = _mutate(
        native,
        [("match", (native[1]["match"],))],
        "stats.match_edit",
        ["UPDATE stats.match SET duration_s=duration_s+2 WHERE id=:match"],
    )
    with native[0].begin() as conn:
        if damage == "missing":
            conn.execute(sa.text("DELETE FROM audit_log WHERE id=:id"), {"id": first})
        elif damage == "reordered":
            one = conn.execute(
                sa.text("SELECT before_json,after_json FROM audit_log WHERE id=:id"), {"id": first}
            ).one()
            two = conn.execute(
                sa.text("SELECT before_json,after_json FROM audit_log WHERE id=:id"), {"id": second}
            ).one()
            for audit_id, row in ((first, two), (second, one)):
                conn.execute(
                    sa.text(
                        "UPDATE audit_log SET before_json=CAST(:b AS jsonb),after_json=CAST(:a AS jsonb) WHERE id=:id"
                    ),
                    {"id": audit_id, "b": json.dumps(row.before_json), "a": json.dumps(row.after_json)},
                )
        elif damage == "before":
            conn.execute(sa.text("UPDATE audit_log SET before_json=after_json WHERE id=:id"), {"id": second})
        else:
            conn.execute(sa.text("UPDATE audit_log SET action='stats.unapproved' WHERE id=:id"), {"id": second})
    _refresh(native)
    try:
        result = _check(native, receipt)
    except EvidenceError:
        return
    assert result["exit_code"] == 1


@pytest.mark.parametrize("evidenced", [False, True])
def test_disappearance_of_both_legacy_and_native_owner_is_not_invisible(native, tmp_path, evidenced):
    receipt = _capture(native, tmp_path / "receipt")
    statements = ["DELETE FROM stats.match WHERE id=:match_no_raw", "DELETE FROM matches.match WHERE id=:match_no_raw"]
    if evidenced:
        _mutate(native, [("match", (native[1]["match_no_raw"],))], "stats.owner_delete", statements)
    else:
        with native[0].begin() as conn:
            for sql in statements:
                conn.execute(sa.text(sql), native[1])
    _refresh(native)
    assert _check(native, receipt)["exit_code"] == (2 if evidenced else 1)


def test_display_rename_requires_fresh_authoritative_mv_not_stats_waiver(native, tmp_path):
    receipt = _capture(native, tmp_path / "receipt")
    with native[0].begin() as conn:
        conn.execute(sa.text("UPDATE players.\"user\" SET name=name||' renamed' WHERE id=:player"), native[1])
    stale = _check(native, receipt)
    assert stale["exit_code"] == 1
    _refresh(native)
    assert _check(native, receipt)["exit_code"] == 0
    # An actual fact/best-owner change is not one of the four descriptive fields.
    with native[0].begin() as conn:
        conn.execute(
            sa.text("UPDATE stats.fact SET value=value+100000 WHERE match_id=:match AND workspace_member_id=:member"),
            native[1],
        )
    _refresh(native)
    assert _check(native, receipt)["exit_code"] == 1


def test_cli_reports_real_database_exit_codes_and_streams_every_owner(native, tmp_path):
    url = sa.make_url(native[2])
    env = {
        **os.environ,
        "POSTGRES_HOST": url.host,
        "POSTGRES_PORT": str(url.port),
        "POSTGRES_USER": url.username,
        "POSTGRES_PASSWORD": url.password,
        "POSTGRES_DB": url.database,
    }
    receipt, report = tmp_path / "receipt", tmp_path / "report.json"
    command = [sys.executable, "scripts/stats01_reconcile.py", "--receipt-dir", str(receipt), "--report", str(report)]
    captured = subprocess.run(
        [*command, "--mode", "capture"],
        cwd=Path(__file__).resolve().parents[1],
        env=env,
        capture_output=True,
        text=True,
        timeout=300,
    )
    assert captured.returncode == 0, (captured.stdout, captured.stderr, report.read_text() if report.exists() else None)
    checked = subprocess.run(
        [*command, "--mode", "check", "--audit-source", "database"],
        cwd=Path(__file__).resolve().parents[1],
        env=env,
        capture_output=True,
        text=True,
        timeout=300,
    )
    assert checked.returncode == 0, (checked.stdout, checked.stderr, report.read_text() if report.exists() else None)
    result = json.loads(report.read_bytes())
    assert len(result["owners"]) == sum(result["counts"].values())
    _mutate(
        native,
        [("job", (native[1]["record"],))],
        "stats.job_transition",
        ["UPDATE stats.ingest_job SET attempts=attempts+1 WHERE id=:record"],
    )
    checked = subprocess.run(
        [*command, "--mode", "check"],
        cwd=Path(__file__).resolve().parents[1],
        env=env,
        capture_output=True,
        text=True,
        timeout=300,
    )
    assert checked.returncode == 2, (checked.stdout, checked.stderr, report.read_text() if report.exists() else None)
    with native[0].begin() as conn:
        conn.execute(sa.text("UPDATE stats.ingest_job SET content_hash=repeat('a',64) WHERE id=:record"), native[1])
    checked = subprocess.run(
        [*command, "--mode", "check"],
        cwd=Path(__file__).resolve().parents[1],
        env=env,
        capture_output=True,
        text=True,
        timeout=300,
    )
    assert checked.returncode == 1, (checked.stdout, checked.stderr, report.read_text() if report.exists() else None)


def test_repeated_backfill_chains_and_raw_complement_are_independent(native, tmp_path):
    receipt = _capture(native, tmp_path / "receipt")
    owners = [("match", (native[1]["match"],))]
    audit_ids = []
    for fight in (701, 702):
        audit_id, before, after = _mutate(
            native,
            owners,
            "stats.derived_backfill",
            [
                f"UPDATE stats.event SET data=jsonb_set(data,'{{fight}}','{fight}') WHERE match_id=:match AND data IS NOT NULL"
            ],
        )
        audit_ids.append(audit_id)
        old = {row["subset"]: row for row in before}
        new = {row["subset"]: row for row in after}
        assert old["event_body"]["sha256"] == new["event_body"]["sha256"]
        assert old["raw_facts"]["sha256"] == new["raw_facts"]["sha256"]
        assert old["event_fight"]["sha256"] != new["event_fight"]["sha256"]
    exported = io.BytesIO()
    assert _check(native, receipt, export=exported)["exit_code"] == 2
    rows = [json.loads(line) for line in exported.getvalue().splitlines()]
    assert [row["id"] for row in rows if row["kind"] == "audit_log"] == audit_ids


def test_job_creation_requires_explicit_absent_owner_and_identity_is_not_mutable(native, tmp_path):
    receipt = _capture(native, tmp_path / "receipt")
    with native[0].connect() as conn:
        new_id = conn.scalar(sa.text("SELECT max(id)+100 FROM stats.ingest_job"))
    native[1]["new_job"] = new_id
    # A real-byte hash, not a generated id checksum. Persistence of the object is
    # the ingest caller's responsibility; this test exercises its DB boundary.
    raw = b"persisted canonical fixture bytes\n"
    native[1]["new_hash"] = hashlib.sha256(raw).hexdigest()
    _mutate(
        native,
        [("job", (new_id,))],
        "stats.job_transition",
        [
            "INSERT INTO stats.ingest_job(id,workspace_id,discipline,source_kind,external_id,content_hash,raw_ref,status,attempts) VALUES(:new_job,:workspace,'overwatch','workshop_csv','receipt-test',:new_hash,'logs/receipt-test','pending',0)"
        ],
    )
    assert _check(native, receipt)["exit_code"] == 2
    with pytest.raises(EvidenceError, match="complement"):
        _mutate(
            native,
            [("job", (new_id,))],
            "stats.job_transition",
            ["UPDATE stats.ingest_job SET raw_ref='logs/rebound' WHERE id=:new_job"],
        )
    assert _check(native, receipt)["exit_code"] == 2


def test_member_creation_reuse_races_and_rollback_keep_complete_receipt(native, tmp_path):
    from shared import models
    from shared.repository.workspace import WorkspaceMemberRepository, get_or_create_workspace_member

    receipt = _capture(native, tmp_path / "receipt")
    ids, url = native[1], native[2]

    async def create(*, rollback=False):
        engine = create_async_engine(sa.make_url(url).set(drivername="postgresql+asyncpg"), poolclass=sa.pool.NullPool)
        try:
            async with AsyncSession(engine, expire_on_commit=False) as session, session.begin():
                member = await get_or_create_workspace_member(
                    session,
                    workspace_id=ids["workspace"],
                    player_id=ids["player_no_member"],
                )
                member_id = member.id
                if rollback:
                    await session.rollback()
                return member_id
        finally:
            await engine.dispose()

    asyncio.run(create(rollback=True))
    assert _check(native, receipt)["exit_code"] == 0
    member_id = asyncio.run(create())
    ids["created_member"] = member_id
    for sql in (
        "UPDATE workspace_member SET player_id=:player_other WHERE id=:created_member",
        "DELETE FROM workspace_member WHERE id=:created_member",
    ):
        with pytest.raises(EvidenceError):
            _mutate(native, [("member", (member_id,))], "stats.member_create", [sql])

    async def exercise_bulk_and_race():
        engine = create_async_engine(sa.make_url(url).set(drivername="postgresql+asyncpg"), poolclass=sa.pool.NullPool)
        try:
            async with AsyncSession(engine, expire_on_commit=False) as session, session.begin():
                members = await WorkspaceMemberRepository().bulk_get_or_create(
                    session,
                    workspace_id=ids["workspace_other"],
                    player_ids={ids["player"], ids["player_no_member"], ids["player_event_only"]},
                )
                assert members[ids["player"]] == ids["member_other"]
                assert len(set(members.values())) == 3

            async def competing_create():
                async with AsyncSession(engine, expire_on_commit=False) as session, session.begin():
                    return (
                        await get_or_create_workspace_member(
                            session,
                            workspace_id=ids["workspace"],
                            player_id=ids["player_other"],
                        )
                    ).id

            first, second = await asyncio.gather(competing_create(), competing_create())
            assert first == second
            async with AsyncSession(engine, expire_on_commit=False) as session, session.begin():
                original = await get_or_create_workspace_member(
                    session,
                    workspace_id=ids["workspace"],
                    player_id=ids["player_no_member"],
                )
                assert original.id == member_id
                repeated = await WorkspaceMemberRepository().bulk_get_or_create(
                    session,
                    workspace_id=ids["workspace_other"],
                    player_ids=set(members),
                )
                assert repeated == members
                revived = await get_or_create_workspace_member(
                    session,
                    workspace_id=ids["workspace"],
                    player_id=ids["player_removed"],
                )
                assert revived.id == ids["member_removed"] and revived.removed_at is None
                audit_ids = list(
                    await session.scalars(
                        sa.select(models.AuditLog.entity_id).where(models.AuditLog.action == "stats.member_create")
                    )
                )
                expected = {member_id, first, members[ids["player_no_member"]], members[ids["player_event_only"]]}
                assert set(audit_ids) == expected and len(audit_ids) == len(expected)
        finally:
            await engine.dispose()

    asyncio.run(exercise_bulk_and_race())
    result = _check(native, receipt)
    assert result["exit_code"] == 2, result


def test_reference_set_null_requires_delete_operation_not_job_transition(native, tmp_path):
    receipt = _capture(native, tmp_path / "receipt")
    owners = [("job", (native[1]["record"],))]
    with pytest.raises(EvidenceError):
        _mutate(
            native,
            owners,
            "stats.job_transition",
            ["UPDATE stats.ingest_job SET hint_tournament_id=NULL WHERE id=:record"],
        )
    _mutate(
        native,
        owners,
        "stats.job_hint",
        ["UPDATE stats.ingest_job SET hint_encounter_game_id=:game_no_raw WHERE id=:record"],
    )
    _mutate(
        native,
        [*owners, ("match", (native[1]["match_no_raw"],))],
        "stats.owner_delete",
        [
            "DELETE FROM encounter.game_team WHERE game_id=:game_no_raw",
            "DELETE FROM encounter.game WHERE id=:game_no_raw",
        ],
    )
    _refresh(native)
    assert _check(native, receipt)["exit_code"] == 2
    with pytest.raises(EvidenceError, match="SET NULL"):
        _mutate(
            native,
            owners,
            "stats.owner_delete",
            ["UPDATE stats.ingest_job SET hint_encounter_game_id=:game WHERE id=:record"],
        )


def test_capture_streams_more_than_one_batch_and_preserves_duplicate_multiplicity(native):
    engine, ids, _ = native
    with engine.begin() as conn:
        before = capture_native(conn, scopes=owner_scopes("match", (ids["match"],)))
        conn.execute(
            sa.text("""INSERT INTO stats.event(match_id,segment,t,type_id,actor_member_id,actor_team_id,
           target_member_id,target_team_id,entity_id,related_entity_id,entity_kind,data)
           SELECT e.match_id,e.segment,e.t,e.type_id,e.actor_member_id,e.actor_team_id,
           e.target_member_id,e.target_team_id,e.entity_id,e.related_entity_id,e.entity_kind,e.data
           FROM (SELECT * FROM stats.event WHERE match_id=:match ORDER BY id LIMIT 1) e
           CROSS JOIN generate_series(1,2101)"""),
            ids,
        )
        after = capture_native(conn, scopes=owner_scopes("match", (ids["match"],)))
        old = {row["subset"]: row for row in before}
        new = {row["subset"]: row for row in after}
        assert new["event_body"]["row_count"] == old["event_body"]["row_count"] + 2101
        assert new["event_body"]["sha256"] != old["event_body"]["sha256"]
        assert old["raw_facts"] == new["raw_facts"]
        with pytest.raises(EvidenceError, match="100 owners"):
            capture_native(conn, scopes=[("job", (n,), "identity") for n in range(1, 102)])


def test_staging_cannot_retrofit_committed_audit_or_tampered_capture(native):
    _, ids, url = native

    async def run():
        engine = create_async_engine(sa.make_url(url).set(drivername="postgresql+asyncpg"), poolclass=sa.pool.NullPool)
        try:
            async with AsyncSession(engine, expire_on_commit=False) as session:
                old = await record_audit(session, action="test.old", source="system")
                await session.commit()
                async with session.begin():
                    scopes = owner_scopes("match", (ids["match"],))
                    before = await capture_stats_evidence(session, scopes=scopes)
                    await session.execute(
                        sa.text("UPDATE stats.match SET duration_s=duration_s+1 WHERE id=:match"), ids
                    )
                    after = await capture_stats_evidence(session, scopes=scopes)
                    kwargs = {
                        "operation": "stats.match_edit",
                        "before": before,
                        "after": after,
                        "workspace_id": ids["workspace"],
                        "entity_type": "stats_match",
                        "entity_id": ids["match"],
                    }
                    with pytest.raises(EvidenceError, match="retrofit"):
                        await stage_stats_evidence(session, audit=old, **kwargs)
                    after[0]["sha256"] = "0" * 64
                    with pytest.raises(EvidenceError, match="modified"):
                        await stage_stats_evidence(session, **kwargs)
                    await session.rollback()
        finally:
            await engine.dispose()

    asyncio.run(run())


def _merge_member(native, *, mode, receipt, split=False):
    """Use event-only identity so real old-source cascades are observable."""
    engine, ids, url = native
    source_id = ids["member_event_only"]
    source_user = ids["player_event_only"]
    target_user = ids["player_no_member"]
    with engine.connect() as conn:
        target_id = (
            source_id
            if mode == "move"
            else conn.scalar(
                sa.text(
                    "SELECT id FROM workspace_member WHERE workspace_id=:workspace AND player_id=:player_no_member"
                ),
                ids,
            )
        )
        matches = list(
            conn.execute(
                sa.text(
                    "SELECT DISTINCT match_id FROM stats.match_player WHERE workspace_member_id=:id ORDER BY match_id"
                ),
                {"id": source_id},
            ).scalars()
        )
        jobs = list(
            conn.execute(
                sa.text("SELECT id FROM stats.ingest_job WHERE uploader_user_id=:id ORDER BY id"), {"id": source_user}
            ).scalars()
        )
    mapping = [
        {
            "workspace_id": ids["workspace"],
            "source_member_id": source_id,
            "target_member_id": target_id,
            "mode": mode,
            "source_user_id": source_user,
            "target_user_id": target_user,
        }
    ]
    owners = [("match", (match,)) for match in matches] + [("job", (job,)) for job in jobs]
    owners += [("member", (member,)) for member in sorted({source_id, target_id})]

    async def run():
        async_engine = create_async_engine(
            sa.make_url(url).set(drivername="postgresql+asyncpg"), poolclass=sa.pool.NullPool
        )
        try:
            async with AsyncSession(async_engine, expire_on_commit=False) as session:
                async with session.begin():
                    groups = (
                        (
                            [owner for owner in owners if owner[0] != "member"],
                            [owner for owner in owners if owner[0] == "member"],
                        )
                        if split
                        else (owners,)
                    )
                    scopes = [
                        [scope for kind, key in group for scope in owner_scopes(kind, key)] for group in groups if group
                    ]
                    before_chunks = [
                        await capture_stats_evidence(session, scopes=chunk, identity_map=mapping) for chunk in scopes
                    ]
                    params = {
                        "source": source_id,
                        "target": target_id,
                        "source_user": source_user,
                        "target_user": target_user,
                    }
                    counts = {}
                    for label, query in {
                        "stats_matches": "SELECT count(DISTINCT match_id) FROM stats.match_player WHERE workspace_member_id=:source",
                        "stats_players": "SELECT count(*) FROM stats.match_player WHERE workspace_member_id=:source",
                        "stats_facts": "SELECT count(*) FROM stats.fact WHERE workspace_member_id=:source",
                        "stats_events": "SELECT count(*) FROM stats.event WHERE actor_member_id=:source OR target_member_id=:source",
                    }.items():
                        counts[label] = await session.scalar(sa.text(query), params)
                    if mode == "retain":
                        for query in (
                            "UPDATE stats.match_player SET workspace_member_id=:target WHERE workspace_member_id=:source",
                            "UPDATE stats.fact SET workspace_member_id=:target WHERE workspace_member_id=:source",
                            "UPDATE stats.event SET actor_member_id=:target WHERE actor_member_id=:source",
                            "UPDATE stats.event SET target_member_id=:target WHERE target_member_id=:source",
                            "UPDATE encounter.team_member SET workspace_member_id=:target WHERE workspace_member_id=:source",
                            "DELETE FROM workspace_member WHERE id=:source",
                        ):
                            await session.execute(sa.text(query), params)
                    else:
                        await session.execute(
                            sa.text("UPDATE workspace_member SET player_id=:target_user WHERE id=:source"), params
                        )
                    await session.execute(
                        sa.text(
                            "UPDATE stats.ingest_job SET uploader_user_id=:target_user WHERE uploader_user_id=:source_user"
                        ),
                        params,
                    )
                    await session.execute(sa.text('DELETE FROM players."user" WHERE id=:source_user'), params)
                    await session.flush()
                    after_chunks = [
                        await capture_stats_evidence(session, scopes=chunk, identity_map=mapping) for chunk in scopes
                    ]
                    audit_ids = []
                    for before, after in zip(before_chunks, after_chunks, strict=True):
                        audit = await stage_stats_evidence(
                            session,
                            operation="stats.member_merge",
                            before=before,
                            after=after,
                            workspace_id=ids["workspace"],
                            entity_type="user",
                            entity_id=source_user,
                            identity_map=mapping,
                        )
                        audit_ids.append(audit.id)
                    original = {
                        "stats_evidence": {
                            "source_user_id": source_user,
                            "target_user_id": target_user,
                            "identity_map": mapping,
                            "audit_ids": audit_ids,
                        }
                    }
                    await session.execute(
                        sa.text("""INSERT INTO players.user_merge_audit(source_user_id,target_user_id,
                         field_policy_json,moved_identity_ids_json,deduped_identity_ids_json,affected_counts_json,preview_snapshot_json)
                         VALUES(NULL,:target_user,'{}','{}','{}',CAST(:counts AS json),CAST(:original AS json))"""),
                        {"target_user": target_user, "counts": json.dumps(counts), "original": json.dumps(original)},
                    )
                    return (
                        audit_ids[-1],
                        [row for chunk in before_chunks for row in chunk],
                        [row for chunk in after_chunks for row in chunk],
                    )
        finally:
            await async_engine.dispose()

    return asyncio.run(run())


@pytest.mark.parametrize("mode,split", [("retain", False), ("move", False), ("retain", True), ("move", True)])
def test_merge_preserves_rewritten_order_identity_and_original_json(native, tmp_path, mode, split):
    if mode == "retain":
        # Higher target id forces rewritten player ordering, not old-id ordering.
        with native[0].begin() as conn:
            conn.execute(
                sa.text(
                    "INSERT INTO workspace_member(id,workspace_id,player_id) SELECT max(id)+100,:workspace,:player_no_member FROM workspace_member"
                ),
                native[1],
            )
    receipt = _capture(native, tmp_path / "receipt")
    audit_id, before, after = _merge_member(native, mode=mode, receipt=receipt, split=split)
    old = {(row["owner_kind"], tuple(row["owner_key"]), row["subset"]): row for row in before}
    for row in after:
        if row["identity_sha256"] is not None:
            key = (row["owner_kind"], tuple(row["owner_key"]), row["subset"])
            assert row["identity_sha256"] == old[key]["identity_sha256"]
            assert row["row_count"] == old[key]["row_count"]
    _refresh(native)
    exported = io.BytesIO()
    result = _check(native, receipt, export=exported)
    assert result["exit_code"] == 2, result
    original = next(
        row for row in map(json.loads, exported.getvalue().splitlines()) if row["kind"] == "user_merge_audit"
    )
    assert original["preview_snapshot_json"]["stats_evidence"]["source_user_id"] == native[1]["player_event_only"]
    with native[0].begin() as conn:
        conn.execute(
            sa.text(
                "UPDATE players.user_merge_audit SET preview_snapshot_json='{}' WHERE preview_snapshot_json::jsonb->'stats_evidence'->'audit_ids' @> CAST(:id AS jsonb)"
            ),
            {"id": json.dumps([audit_id])},
        )
    with pytest.raises(EvidenceError, match="merge"):
        _check(native, receipt)


def test_rewrite_projection_reorders_full_multiset_not_original_identity_order(native):
    # Two same-team observations straddle the rewritten id. This is intentionally
    # an isolated helper transaction, not an initial-transfer self-oracle.
    engine, ids, _ = native
    with engine.begin() as conn:
        target = conn.scalar(sa.text("SELECT max(id)+100 FROM workspace_member"))
        conn.execute(
            sa.text("INSERT INTO workspace_member(id,workspace_id,player_id) VALUES(:id,:workspace,:player_no_member)"),
            {**ids, "id": target},
        )
        mapping = [
            {
                "workspace_id": ids["workspace"],
                "source_member_id": ids["member"],
                "target_member_id": target,
                "source_user_id": ids["player"],
                "target_user_id": ids["player_no_member"],
                "mode": "retain",
            }
        ]
        scopes = owner_scopes("match", (ids["match"],))
        before = capture_native(conn, scopes=scopes, identity_map=mapping)
        for relation, column in (
            ("match_player", "workspace_member_id"),
            ("fact", "workspace_member_id"),
            ("event", "actor_member_id"),
            ("event", "target_member_id"),
        ):
            conn.execute(
                sa.text(f"UPDATE stats.{relation} SET {column}=:target WHERE match_id=:match AND {column}=:member"),
                {**ids, "target": target},
            )
        after = capture_native(conn, scopes=scopes, identity_map=mapping)
        old = {row["subset"]: row for row in before}
        new = {row["subset"]: row for row in after}
        assert old["players"]["sha256"] != new["players"]["sha256"]
        assert old["players"]["identity_sha256"] == new["players"]["identity_sha256"]
        assert old["raw_facts"]["identity_sha256"] == new["raw_facts"]["identity_sha256"]
        assert old["event_body"]["identity_sha256"] == new["event_body"]["identity_sha256"]


def test_initial_empty_classes_are_explicit_ok(stats01_legacy_database, tmp_path):
    url, ids = stats01_legacy_database
    engine = sa.create_engine(url, poolclass=sa.pool.NullPool)
    try:
        with engine.begin() as conn:
            for table in (
                "log_processing.discord_channel",
                "matches.stat_baselines",
                "catalog.alias_miss",
                "achievements.evaluation_result",
                "achievements.override",
                "achievements.rule",
                "event_outbox",
            ):
                conn.execute(sa.text(f"DELETE FROM {table}"))
        upgraded = upgrade_database(url, "stats01")
        assert upgraded.returncode == 0, upgraded.stdout + upgraded.stderr
        receipt = _capture((engine, ids, url), tmp_path / "receipt")
        proof = {row["class"]: row for row in reconcile.load_manifest(receipt)["proof"]}
        for name in (
            "baselines",
            "channel",
            "alias_ref",
            "evaluation_ref",
            "override_ref",
            "rule_dependency",
            "outbox_dependency",
        ):
            assert proof[name]["status"] == "ok"
            assert proof[name]["legacy"] == proof[name]["migrated"] == 0
        assert _check((engine, ids, url), receipt)["exit_code"] == 0
    finally:
        engine.dispose()


def test_extra_native_job_before_capture_and_unevidenced_new_owner_after_capture_block(native, tmp_path):
    receipt = _capture(native, tmp_path / "receipt")
    with native[0].begin() as conn:
        conn.execute(
            sa.text("""INSERT INTO stats.ingest_job(workspace_id,discipline,source_kind,external_id,content_hash,raw_ref,status)
            VALUES(:workspace,'overwatch','external','unreviewed',:hash,'logs/unreviewed','pending')"""),
            {**native[1], "hash": hashlib.sha256(b"unreviewed real bytes").hexdigest()},
        )
    assert _check(native, receipt)["exit_code"] == 1
    with pytest.raises(EvidenceError):
        _capture(native, tmp_path / "uncertifiable")


def test_event_fight_absence_null_and_nonobject_payloads_remain_distinct(native):
    with native[0].begin() as conn:
        params = native[1]
        event_id = conn.scalar(sa.text("SELECT min(id) FROM stats.event WHERE match_id=:match"), params)
        scopes = [("match", (params["match"],), subset) for subset in ("event_body", "event_fight")]
        states = []
        for payload in ("{}", '{"fight":null}', '["fight"]', "null", '{"$float":"0x1.0000000000000p+0"}', "1.0", None):
            conn.execute(
                sa.text("UPDATE stats.event SET data=CAST(:data AS jsonb) WHERE id=:id"),
                {"data": payload, "id": event_id},
            )
            states.append({state["subset"]: state["sha256"] for state in capture_native(conn, scopes=scopes)})
        assert states[0]["event_body"] == states[1]["event_body"]
        assert states[0]["event_fight"] != states[1]["event_fight"]
        assert len({state["event_body"] for state in states[1:]}) == 6
        assert states[3]["event_body"] != states[-1]["event_body"]  # JSON null is not SQL NULL.


def test_native_owner_locks_serialize_audit_ids_and_before_after_chain(native, tmp_path):
    receipt = _capture(native, tmp_path / "receipt")
    _, ids, url = native

    async def run():
        engine = create_async_engine(sa.make_url(url).set(drivername="postgresql+asyncpg"), poolclass=sa.pool.NullPool)
        first_locked, second_started, second_locked, release = (asyncio.Event() for _ in range(4))
        scopes = owner_scopes("job", (ids["record"],))
        audit_ids = []

        async def writer(first):
            async with AsyncSession(engine, expire_on_commit=False) as session:
                async with session.begin():
                    if not first:
                        second_started.set()
                    before = await capture_stats_evidence(session, scopes=scopes)
                    if first:
                        first_locked.set()
                        await release.wait()
                    else:
                        second_locked.set()
                    await session.execute(
                        sa.text("UPDATE stats.ingest_job SET attempts=attempts+1 WHERE id=:record"), ids
                    )
                    after = await capture_stats_evidence(session, scopes=scopes)
                    audit = await stage_stats_evidence(
                        session,
                        operation="stats.job_transition",
                        before=before,
                        after=after,
                        workspace_id=ids["workspace"],
                        entity_type="stats_job",
                        entity_id=ids["record"],
                    )
                    audit_ids.append(audit.id)

        try:
            one = asyncio.create_task(writer(True))
            await asyncio.wait_for(first_locked.wait(), 10)
            two = asyncio.create_task(writer(False))
            await asyncio.wait_for(second_started.wait(), 10)
            with pytest.raises(TimeoutError):
                await asyncio.wait_for(second_locked.wait(), 0.1)
            release.set()
            await asyncio.wait_for(asyncio.gather(one, two), 10)
            assert len(audit_ids) == 2 and audit_ids[0] < audit_ids[1]
        finally:
            release.set()
            await engine.dispose()

    asyncio.run(run())
    assert _check(native, receipt)["exit_code"] == 2


@pytest.mark.parametrize("prior_owner", ["none", "member", "job"])
def test_actual_zero_impact_merge_needs_only_its_original_record(native, tmp_path, prior_owner):
    engine, ids, _ = native
    source, target = ids["player_no_member"], ids["player_away"]
    with engine.begin() as conn:
        conn.execute(sa.text('UPDATE players."user" SET auth_user_id=NULL WHERE id=:player_no_member'), ids)
        if prior_owner == "member":
            ids["former_member"] = conn.scalar(
                sa.text("""INSERT INTO workspace_member(id,workspace_id,player_id)
                SELECT max(id)+100,:workspace,:player_no_member FROM workspace_member RETURNING id"""),
                ids,
            )
        elif prior_owner == "job":
            conn.execute(
                sa.text("UPDATE log_processing.record SET uploader_id=:player_no_member WHERE id=:record_unlinked"), ids
            )
            conn.execute(
                sa.text("UPDATE stats.ingest_job SET uploader_user_id=:player_no_member WHERE id=:record_unlinked"), ids
            )
    receipt = _capture(native, tmp_path / "receipt")
    if prior_owner == "member":
        _mutate(
            native,
            [("member", (ids["former_member"],))],
            "stats.owner_delete",
            ["DELETE FROM workspace_member WHERE id=:former_member"],
        )
    elif prior_owner == "job":
        _mutate(
            native,
            [("job", (ids["record_unlinked"],))],
            "stats.owner_delete",
            [
                "DELETE FROM stats.ingest_job WHERE id=:record_unlinked",
                "DELETE FROM log_processing.record WHERE id=:record_unlinked",
            ],
        )
    with engine.connect() as conn:
        audit_highwater = conn.scalar(sa.text("SELECT coalesce(max(id),0) FROM audit_log"))
    merge_id = _execute_user_merge(native, source, target)
    exported = io.BytesIO()
    result = _check(native, receipt, export=exported)
    assert result["exit_code"] == (0 if prior_owner == "none" else 2), result
    original = next(
        row
        for row in map(json.loads, exported.getvalue().splitlines())
        if row["kind"] == "user_merge_audit" and row["id"] == merge_id
    )
    assert original["preview_snapshot_json"]["stats_evidence"] == {
        "source_user_id": source,
        "target_user_id": target,
        "identity_map": [],
        "audit_ids": [],
    }
    with engine.connect() as conn:
        assert conn.scalar(sa.text("SELECT coalesce(max(id),0) FROM audit_log")) == audit_highwater
        assert not conn.scalar(sa.text('SELECT EXISTS(SELECT 1 FROM players."user" WHERE id=:id)'), {"id": source})
    # A zero-impact original is never a waiver for unrelated or formerly owned data.
    with engine.begin() as conn:
        conn.execute(sa.text("UPDATE stats.ingest_job SET attempts=attempts+1 WHERE id=:record"), ids)
    assert _check(native, receipt)["exit_code"] == 1


@pytest.mark.parametrize(
    "tamper",
    [
        "missing_original",
        "missing_hint",
        "wrong_source",
        "legacy_error",
        "legacy_timestamp",
        "legacy_other_hint",
    ],
)
def test_prior_uploader_hint_then_zero_impact_merge_allows_only_legacy_uploader_null(native, tmp_path, tamper):
    engine, ids, _ = native
    with engine.begin() as conn:
        conn.execute(sa.text('UPDATE players."user" SET auth_user_id=NULL WHERE id=:player_no_member'), ids)
        conn.execute(sa.text("UPDATE log_processing.record SET uploader_id=:player_no_member WHERE id=:record"), ids)
        conn.execute(sa.text("UPDATE stats.ingest_job SET uploader_user_id=:player_no_member WHERE id=:record"), ids)
    receipt = _capture(native, tmp_path / "receipt")
    hint_id, _, _ = _mutate(
        native,
        [("job", (ids["record"],))],
        "stats.job_hint",
        ["UPDATE stats.ingest_job SET uploader_user_id=:player_away WHERE id=:record"],
    )
    merge_id = _execute_user_merge(native, ids["player_no_member"], ids["player_away"])
    result = _check(native, receipt)
    assert result["exit_code"] == 2, result
    with engine.begin() as conn:
        assert conn.scalar(sa.text("SELECT uploader_id FROM log_processing.record WHERE id=:record"), ids) is None
        if tamper == "missing_original":
            conn.execute(sa.text("DELETE FROM players.user_merge_audit WHERE id=:id"), {"id": merge_id})
        elif tamper == "missing_hint":
            conn.execute(sa.text("DELETE FROM audit_log WHERE id=:id"), {"id": hint_id})
        elif tamper == "wrong_source":
            snapshot = conn.scalar(
                sa.text("SELECT preview_snapshot_json FROM players.user_merge_audit WHERE id=:id"), {"id": merge_id}
            )
            snapshot["stats_evidence"]["source_user_id"] = ids["player_event_only"]
            conn.execute(
                sa.text(
                    "UPDATE players.user_merge_audit SET preview_snapshot_json=CAST(:snapshot AS json) WHERE id=:id"
                ),
                {"id": merge_id, "snapshot": json.dumps(snapshot)},
            )
        elif tamper == "legacy_error":
            conn.execute(sa.text("UPDATE log_processing.record SET error_message='unexplained' WHERE id=:record"), ids)
        elif tamper == "legacy_timestamp":
            conn.execute(
                sa.text("UPDATE log_processing.record SET updated_at=updated_at+interval '1 second' WHERE id=:record"),
                ids,
            )
        else:
            conn.execute(sa.text("UPDATE log_processing.record SET attached_encounter_id=NULL WHERE id=:record"), ids)
    if tamper == "wrong_source":
        with pytest.raises(EvidenceError):
            _check(native, receipt)
    else:
        assert _check(native, receipt)["exit_code"] == 1


@pytest.mark.parametrize(
    "tamper",
    [
        "missing_pair",
        "boolean_source",
        "same_pair",
        "wrong_preview",
        "live_source",
        "missing_map",
        "missing_ids",
        "missing_counts",
        "nonzero_count",
        "boolean_count",
        "preview_count",
    ],
)
def test_zero_impact_merge_rejects_tampered_original(native, tmp_path, tamper):
    engine, ids, _ = native
    with engine.begin() as conn:
        conn.execute(sa.text('UPDATE players."user" SET auth_user_id=NULL WHERE id=:player_no_member'), ids)
    receipt = _capture(native, tmp_path / "receipt")
    merge_id = _execute_user_merge(native, ids["player_no_member"], ids["player_away"])
    with engine.begin() as conn:
        snapshot, counts = conn.execute(
            sa.text("""SELECT preview_snapshot_json,affected_counts_json
            FROM players.user_merge_audit WHERE id=:id"""),
            {"id": merge_id},
        ).one()
        original = snapshot["stats_evidence"]
        if tamper == "missing_pair":
            del original["source_user_id"]
        elif tamper == "boolean_source":
            original["source_user_id"] = True
        elif tamper == "same_pair":
            original["source_user_id"] = original["target_user_id"]
        elif tamper == "wrong_preview":
            snapshot["target"]["id"] = ids["player"]
        elif tamper == "live_source":
            original["source_user_id"] = snapshot["source"]["id"] = ids["player"]
        elif tamper == "missing_map":
            del original["identity_map"]
        elif tamper == "missing_ids":
            del original["audit_ids"]
        elif tamper == "missing_counts":
            del counts["stats.ingest_job.uploader_user_id"]
        elif tamper == "nonzero_count":
            counts["stats_facts"] = 1
        elif tamper == "boolean_count":
            counts["stats_facts"] = False
        else:
            snapshot["affected_counts"]["stats_players"] = 1
        conn.execute(
            sa.text("""UPDATE players.user_merge_audit SET preview_snapshot_json=CAST(:snapshot AS json),
            affected_counts_json=CAST(:counts AS json) WHERE id=:id"""),
            {"id": merge_id, "snapshot": json.dumps(snapshot), "counts": json.dumps(counts)},
        )
    with pytest.raises(EvidenceError):
        _check(native, receipt)


@pytest.mark.parametrize("owner", ["member", "uploader"])
@pytest.mark.parametrize("tamper", ["missing_link", "forged_pair", "zero_claim", "erased_zero_claim"])
def test_mutating_merge_cannot_use_zero_impact_exemption(native, tmp_path, owner, tamper):
    engine, ids, _ = native
    with engine.begin() as conn:
        conn.execute(sa.text('UPDATE players."user" SET auth_user_id=NULL WHERE id=:player_no_member'), ids)
        if owner == "member":
            conn.execute(
                sa.text("""INSERT INTO workspace_member(id,workspace_id,player_id)
                SELECT max(id)+100,:workspace,:player_no_member FROM workspace_member"""),
                ids,
            )
        else:
            conn.execute(
                sa.text("UPDATE log_processing.record SET uploader_id=:player_no_member WHERE id=:record"), ids
            )
            conn.execute(
                sa.text("UPDATE stats.ingest_job SET uploader_user_id=:player_no_member WHERE id=:record"), ids
            )
    receipt = _capture(native, tmp_path / "receipt")
    merge_id = _execute_user_merge(native, ids["player_no_member"], ids["player_away"])
    result = _check(native, receipt)
    assert result["exit_code"] == 2, result
    with engine.begin() as conn:
        snapshot, counts = conn.execute(
            sa.text("""SELECT preview_snapshot_json,affected_counts_json
            FROM players.user_merge_audit WHERE id=:id"""),
            {"id": merge_id},
        ).one()
        original = snapshot["stats_evidence"]
        assert original["audit_ids"]
        if tamper in {"missing_link", "erased_zero_claim"}:
            conn.execute(sa.text("DELETE FROM audit_log WHERE id=ANY(:ids)"), {"ids": original["audit_ids"]})
        if tamper == "forged_pair":
            original["target_user_id"] = ids["player"]
        elif tamper in {"zero_claim", "erased_zero_claim"}:
            original["identity_map"] = []
            original["audit_ids"] = []
            for side in (counts, snapshot["affected_counts"]):
                for key in (
                    "stats_matches",
                    "stats_players",
                    "stats_facts",
                    "stats_events",
                    "stats.ingest_job.uploader_user_id",
                ):
                    side[key] = 0
        conn.execute(
            sa.text("""UPDATE players.user_merge_audit SET preview_snapshot_json=CAST(:snapshot AS json),
            affected_counts_json=CAST(:counts AS json) WHERE id=:id"""),
            {"id": merge_id, "snapshot": json.dumps(snapshot), "counts": json.dumps(counts)},
        )
    if tamper == "erased_zero_claim":
        assert _check(native, receipt)["exit_code"] == 1
    else:
        with pytest.raises(EvidenceError):
            _check(native, receipt)


@pytest.mark.parametrize("tamper", ["missing_delete", "merge_link"])
def test_zero_member_uploader_merge_keeps_separate_api_key_delete_evidence(native, tmp_path, tamper):
    engine, ids, _ = native
    with engine.begin() as conn:
        conn.execute(
            sa.text('UPDATE auth."user" SET hashed_password=:password WHERE id=:auth_user_no_member'),
            {**ids, "password": "receipt-test-password-hash"},
        )
        ids["merge_key"] = conn.scalar(
            sa.text("""INSERT INTO auth.api_key
            (auth_user_id,workspace_id,public_id,secret_hash,name,created_at,updated_at)
            VALUES(:auth_user_no_member,:workspace,'receipt-merge-key','test-only-hash','Receipt key',now(),now())
            RETURNING id"""),
            ids,
        )
        ids["key_job"] = conn.scalar(sa.text("SELECT max(id)+100 FROM stats.ingest_job"))
    receipt = _capture(native, tmp_path / "receipt")
    ids["key_job_hash"] = hashlib.sha256(b"real key-attributed receipt bytes\n").hexdigest()
    _mutate(
        native,
        [("job", (ids["key_job"],))],
        "stats.job_transition",
        [
            """INSERT INTO stats.ingest_job(id,workspace_id,discipline,source_kind,external_id,content_hash,
            raw_ref,status,attempts,api_key_id,uploader_user_id)
            VALUES(:key_job,:workspace,'overwatch','manual','receipt-key',:key_job_hash,
                'logs/receipt-key','pending',0,:merge_key,:player_away)""",
        ],
    )
    merge_id = _execute_user_merge(native, ids["player_no_member"], ids["player_away"])
    result = _check(native, receipt)
    assert result["exit_code"] == 2, result
    with engine.begin() as conn:
        snapshot = conn.scalar(
            sa.text("SELECT preview_snapshot_json FROM players.user_merge_audit WHERE id=:id"), {"id": merge_id}
        )
        assert snapshot["stats_evidence"]["identity_map"] == snapshot["stats_evidence"]["audit_ids"] == []
        assert conn.scalar(sa.text("SELECT api_key_id FROM stats.ingest_job WHERE id=:key_job"), ids) is None
        delete_id = conn.scalar(
            sa.text("""SELECT id FROM audit_log WHERE action='stats.owner_delete'
            AND entity_type='auth_merge' AND entity_id=:player_away"""),
            ids,
        )
        assert delete_id is not None
        if tamper == "missing_delete":
            conn.execute(sa.text("DELETE FROM audit_log WHERE id=:id"), {"id": delete_id})
        else:
            snapshot["stats_evidence"]["audit_ids"] = [delete_id]
            conn.execute(
                sa.text(
                    "UPDATE players.user_merge_audit SET preview_snapshot_json=CAST(:snapshot AS json) WHERE id=:id"
                ),
                {"id": merge_id, "snapshot": json.dumps(snapshot)},
            )
    if tamper == "missing_delete":
        assert _check(native, receipt)["exit_code"] == 1
    else:
        with pytest.raises(EvidenceError, match="contradictory audit link"):
            _check(native, receipt)


@pytest.mark.parametrize("wrong_pair", [False, True])
def test_uploader_only_merge_uses_original_global_pair_without_fake_members(native, tmp_path, wrong_pair):
    engine, ids, url = native
    source_user, target_user = ids["player_no_member"], ids["player"]
    with engine.begin() as conn:
        assert (
            conn.scalar(sa.text("SELECT count(*) FROM workspace_member WHERE player_id=:id"), {"id": source_user}) == 0
        )
        # Set up the genuine legacy/native uploader before establishing the initial
        # receipt. No membership is introduced to make the test pass.
        conn.execute(
            sa.text("UPDATE log_processing.record SET uploader_id=:source WHERE id=:record"),
            {**ids, "source": source_user},
        )
        conn.execute(
            sa.text("UPDATE stats.ingest_job SET uploader_user_id=:source WHERE id=:record"),
            {**ids, "source": source_user},
        )
    receipt = _capture(native, tmp_path / "receipt")

    async def run():
        async_engine = create_async_engine(
            sa.make_url(url).set(drivername="postgresql+asyncpg"), poolclass=sa.pool.NullPool
        )
        try:
            async with AsyncSession(async_engine, expire_on_commit=False) as session:
                async with session.begin():
                    mapping = [
                        {
                            "source_user_id": source_user,
                            "target_user_id": ids["player_away"] if wrong_pair else target_user,
                        }
                    ]
                    scopes = owner_scopes("job", (ids["record"],))
                    before = await capture_stats_evidence(session, scopes=scopes, identity_map=mapping)
                    await session.execute(
                        sa.text("UPDATE stats.ingest_job SET uploader_user_id=:target WHERE id=:record"),
                        {**ids, "target": target_user},
                    )
                    await session.execute(
                        sa.text('DELETE FROM players."user" WHERE id=:source'), {"source": source_user}
                    )
                    after = await capture_stats_evidence(session, scopes=scopes, identity_map=mapping)
                    kwargs = {
                        "operation": "stats.member_merge",
                        "before": before,
                        "after": after,
                        "identity_map": mapping,
                        "workspace_id": ids["workspace"],
                        "entity_type": "user",
                        "entity_id": source_user,
                    }
                    if wrong_pair:
                        with pytest.raises(EvidenceError, match="identity"):
                            await stage_stats_evidence(session, **kwargs)
                        await session.rollback()
                        return
                    audit = await stage_stats_evidence(session, **kwargs)
                    original = {
                        "stats_evidence": {
                            "source_user_id": source_user,
                            "target_user_id": target_user,
                            "identity_map": [],
                            "audit_ids": [audit.id],
                        }
                    }
                    counts = dict.fromkeys(("stats_matches", "stats_players", "stats_facts", "stats_events"), 0)
                    await session.execute(
                        sa.text("""INSERT INTO players.user_merge_audit(source_user_id,target_user_id,
                        field_policy_json,moved_identity_ids_json,deduped_identity_ids_json,affected_counts_json,preview_snapshot_json)
                        VALUES(NULL,:target,'{}','{}','{}',CAST(:counts AS json),CAST(:original AS json))"""),
                        {"target": target_user, "counts": json.dumps(counts), "original": json.dumps(original)},
                    )
        finally:
            await async_engine.dispose()

    asyncio.run(run())
    assert _check(native, receipt)["exit_code"] == (0 if wrong_pair else 2)
    with engine.connect() as conn:
        assert (
            conn.scalar(sa.text("SELECT count(*) FROM workspace_member WHERE player_id=:id"), {"id": source_user}) == 0
        )
    if not wrong_pair:
        with engine.begin() as conn:
            conn.execute(
                sa.text(
                    "UPDATE log_processing.record SET error_message='unexplained after valid merge' WHERE id=:record"
                ),
                ids,
            )
        assert _check(native, receipt)["exit_code"] == 1


def test_player_only_mapping_cannot_waive_observation_changes(native):
    ids = native[1]
    mapping = [{"source_user_id": ids["player"], "target_user_id": ids["player_away"]}]
    with pytest.raises(EvidenceError, match="job uploader"):
        _mutate(
            native,
            [("match", (ids["match"],))],
            "stats.member_merge",
            ["UPDATE stats.fact SET value=value+1 WHERE match_id=:match"],
            mapping=mapping,
        )


def test_fabricated_resident_mv_description_is_not_a_live_label_exemption(native, tmp_path):
    receipt = _capture(native, tmp_path / "receipt")
    with native[0].begin() as conn:
        conn.execute(sa.text("ALTER MATERIALIZED VIEW stats.mv_entity_global_stats RENAME TO evidence_bad_mv_source"))
        conn.execute(
            sa.text("""CREATE MATERIALIZED VIEW stats.mv_entity_global_stats AS
            SELECT discipline,stat_id,entity_id,best_value,avg,
              jsonb_set(metadata,'{username}','\"fabricated resident name\"'::jsonb) AS metadata
            FROM stats.evidence_bad_mv_source""")
        )
    assert _check(native, receipt)["exit_code"] == 1


def test_report_output_cannot_overwrite_a_published_receipt(native, tmp_path):
    receipt = _capture(native, tmp_path / "receipt")
    original = (receipt / "manifest.json").read_bytes()
    assert (
        reconcile.main(["--mode", "check", "--receipt-dir", str(receipt), "--report", str(receipt / "manifest.json")])
        == 1
    )
    assert (receipt / "manifest.json").read_bytes() == original


def test_initial_semantic_proof_preserves_float_signed_zero(native, tmp_path):
    native_update = """UPDATE stats.fact SET value=CAST(:value AS double precision)
        WHERE match_id=:match AND segment=0 AND entity_id IS NULL
          AND stat_id=(SELECT id FROM stats.stat_def WHERE discipline='overwatch' AND code='hero_time_played')"""
    with native[0].begin() as conn:
        params = {**native[1], "value": "-0"}
        source = conn.execute(
            sa.text("""UPDATE matches.statistics SET value=CAST(:value AS double precision)
            WHERE match_id=:match AND round=0 AND hero_id IS NULL AND name::text='HeroTimePlayed'"""),
            params,
        )
        target = conn.execute(sa.text(native_update), params)
        assert source.rowcount == target.rowcount > 0
    _refresh(native)
    _capture(native, tmp_path / "negative-zero")
    with native[0].begin() as conn:
        conn.execute(sa.text(native_update), {**native[1], "value": "0"})
    with pytest.raises(reconcile.EvidenceError):
        _capture(native, tmp_path / "positive-zero")


@pytest.mark.parametrize("directory", ("receipt", "prior"))
@pytest.mark.parametrize("filename", ("manifest.json", "owners.jsonl", "handles.jsonl"))
@pytest.mark.parametrize("alias", (False, True), ids=("direct", "hardlink"))
def test_report_preserves_both_receipts_before_verification(tmp_path, directory, filename, alias):
    originals = {}
    for name in ("receipt", "prior"):
        root = tmp_path / name
        root.mkdir()
        for artifact in ("manifest.json", "owners.jsonl", "handles.jsonl"):
            path = root / artifact
            originals[path] = f"immutable {name}/{artifact}\n".encode()
            path.write_bytes(originals[path])
    report = tmp_path / directory / filename
    if alias:
        link = tmp_path / "report.json"
        os.link(report, link)
        report = link
    assert (
        reconcile.main(
            [
                "--mode",
                "capture",
                "--receipt-dir",
                str(tmp_path / "receipt"),
                "--prior-receipt-dir",
                str(tmp_path / "prior"),
                "--report",
                str(report),
            ]
        )
        == 1
    )
    assert {path: path.read_bytes() for path in originals} == originals


@pytest.mark.parametrize("deleted", ("encounter", "max_record"))
def test_historical_reference_receipt_keeps_survivor_ids_after_cascade(stats01_legacy_database, tmp_path, deleted):
    url, ids = stats01_legacy_database
    engine = sa.create_engine(url, poolclass=sa.pool.NullPool)
    native = engine, ids, url
    try:
        with engine.begin() as conn:
            conn.execute(
                sa.text("UPDATE matches.match SET log_record_id=NULL WHERE id IN (:match_other,:match_hidden)"),
                ids,
            )
            max_record = conn.scalar(sa.text("SELECT max(id) FROM log_processing.record"))
            assert max_record == ids["record_unlinked"]
        upgraded = upgrade_database(url, "stats01a")
        assert upgraded.returncode == 0, upgraded.stdout + upgraded.stderr
        ids["historical_other"], ids["historical_hidden"] = max_record + 1, max_record + 2
        with engine.begin() as conn:
            conn.execute(sa.text("UPDATE stats.match SET ingest_job_id=:historical_other WHERE id=:match_hidden"), ids)
        with pytest.raises(EvidenceError):
            _capture(native, tmp_path / "wrong-native-mapping")
        with engine.begin() as conn:
            conn.execute(sa.text("UPDATE stats.match SET ingest_job_id=:historical_hidden WHERE id=:match_hidden"), ids)
        receipt = _capture(native, tmp_path / "receipt")
        originals = {path: path.read_bytes() for path in receipt.iterdir()}
        if deleted == "encounter":
            _mutate(
                native,
                [
                    ("match", (ids["match_other"],)),
                    ("job", (ids["record_other"],)),
                    ("job", (ids["historical_other"],)),
                ],
                "stats.owner_delete",
                ["DELETE FROM encounter.encounter WHERE id=:encounter_other"],
            )
        else:
            _mutate(
                native,
                [("job", (ids["record_unlinked"],))],
                "stats.owner_delete",
                [
                    "DELETE FROM stats.ingest_job WHERE id=:record_unlinked",
                    "DELETE FROM log_processing.record WHERE id=:record_unlinked",
                ],
            )
        _refresh(native)
        revision = reconcile.revision_module()
        owners = []
        with reconcile.readonly_snapshot(engine, revision, receipt_dir=receipt) as conn:
            result = reconcile.check_receipt(conn, receipt, revision, owner_sink=owners.append)
            assert (
                conn.scalar(sa.text("SELECT ingest_job_id FROM stats.match WHERE id=:match_hidden"), ids)
                == ids["historical_hidden"]
            )
        assert result["exit_code"] == 2, (result, owners)
        survivors = [
            row
            for row in owners
            if (row.get("owner_kind"), tuple(row.get("owner_key", ())))
            in {("match", (ids["match_hidden"],)), ("job", (ids["historical_hidden"],))}
        ]
        assert survivors and all(row["status"] == row["legacy_status"] == "unchanged" for row in survivors)
        assert {path: path.read_bytes() for path in originals} == originals
        with engine.begin() as conn:
            conn.execute(sa.text("UPDATE stats.match SET ingest_job_id=:historical_other WHERE id=:match_hidden"), ids)
        assert _check(native, receipt)["exit_code"] == 1
    finally:
        engine.dispose()


@pytest.mark.parametrize("damage", ("missing", "boolean", "wrong_job"))
def test_receipt_missing_or_invalid_historical_mapping_fails_closed(native, tmp_path, damage):
    receipt = _capture(native, tmp_path / "receipt")
    rows = [json.loads(line) for line in (receipt / "owners.jsonl").read_bytes().splitlines()]
    match = next(row for row in rows if row["owner_kind"] == "match")
    if damage == "missing":
        match.pop("historical_reference_id", None)
    else:
        match["historical_reference_id"] = True if damage == "boolean" else native[1]["record_unlinked"]
    raw = b"".join(json.dumps(row).encode() + b"\n" for row in rows)
    (receipt / "owners.jsonl").write_bytes(raw)
    manifest = json.loads((receipt / "manifest.json").read_bytes())
    manifest["owners_sha256"] = hashlib.sha256(raw).hexdigest()
    (receipt / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    with pytest.raises(EvidenceError, match="historical reference"):
        _check(native, receipt)
