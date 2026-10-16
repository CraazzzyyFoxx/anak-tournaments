"""Capture stats01's initial proof, or reconcile its complete owner/audit chains.

Run with all writers drained for capture. Receipt files are immutable release
artifacts, not runtime storage. Exit 0=unchanged, 2=review required, 1=blocking.
Receipt v2 requires streamed per-observation handles.jsonl as well as owners.jsonl;
neither today's roster nor a global account name can reconstruct that evidence.
"""

from __future__ import annotations

import argparse
import hashlib
import heapq
import importlib.util
import itertools
import json
import os
import sys
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

import sqlalchemy as sa

from shared.services.stats_evidence import (
    CODEC,
    OPERATIONS,
    OWNER_BATCH,
    OWNER_QUERIES,
    PARTITIONS,
    ROW_BATCH,
    EvidenceError,
    _states,
    capture_native,
    empty_state,
    encode_value,
    owner_scopes,
    scope_key,
    semantic_bytes,
    semantic_digest,
    state_equal,
    state_scope,
    validate_transition,
)

FORMAT = "stats01-receipt/2"
DETAIL_LIMIT = 100
LIVE_MV_LABELS = {"username", "map_name", "map_image_path", "tournament_name"}
LEGACY_NULL_REFERENCES = {
    "jobs": ("uploader_user_id", "hint_encounter_id", "hint_tournament_id"),
    "matches": ("ingest_job_id",),
}


def revision_module():
    path = Path(__file__).resolve().parents[1] / "migrations" / "versions" / "stats01_stats.py"
    spec = importlib.util.spec_from_file_location("stats01_frozen_revision", path)
    if spec is None or spec.loader is None:
        raise EvidenceError("stats01 frozen revision unavailable")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _json(raw):
    try:
        return json.loads(
            raw, parse_constant=lambda value: (_ for _ in ()).throw(EvidenceError(f"invalid JSON number {value}"))
        )
    except (ValueError, TypeError) as exc:
        raise EvidenceError("invalid receipt JSON") from exc


def _dump(value) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")


def _owner_sort(owner):
    return scope_key((owner[0], tuple(owner[1]), ""))[:2]


def _publish(temp: Path, target: Path):
    # A hard link publishes an already-closed file atomically and refuses overwrite
    # on both Windows and POSIX. Both paths are in the same receipt directory.
    os.link(temp, target)
    temp.unlink()


def load_manifest(receipt_dir: Path, revision=None) -> dict:
    try:
        manifest = _json((receipt_dir / "manifest.json").read_bytes())
        if (
            not isinstance(manifest, dict)
            or manifest.get("format") != FORMAT
            or manifest.get("revision") != "stats01"
            or manifest.get("codec") != CODEC
            or manifest.get("owners_file") != "owners.jsonl"
            or manifest.get("handles_file") != "handles.jsonl"
        ):
            raise EvidenceError("unsupported receipt format")
        required = {
            "captured_at",
            "database_name",
            "snapshot",
            "audit_highwater",
            "proof",
            "owners_count",
            "owners_sha256",
            "handles_count",
            "handles_sha256",
        }
        if not required <= manifest.keys():
            raise EvidenceError("incomplete receipt manifest")
        if (
            not isinstance(manifest["audit_highwater"], dict)
            or type(manifest["owners_count"]) is not int
            or manifest["owners_count"] < 0
        ):
            raise EvidenceError("invalid receipt control fields")
        if any(
            not isinstance(manifest[field], str) or not manifest[field]
            for field in ("captured_at", "database_name", "snapshot")
        ):
            raise EvidenceError("missing receipt snapshot identity")
        captured_at = datetime.fromisoformat(manifest["captured_at"].replace("Z", "+00:00"))
        if captured_at.tzinfo is None or captured_at.utcoffset().total_seconds() != 0:
            raise EvidenceError("receipt capture time is not UTC")
        for field in ("audit_log_id", "user_merge_audit_id"):
            value = manifest["audit_highwater"].get(field)
            if type(value) is not int or value < 0:
                raise EvidenceError("invalid receipt audit highwater")
        if not isinstance(manifest["proof"], list) or not manifest["proof"]:
            raise EvidenceError("missing initial full proof")
        classes = set()
        for proof in manifest["proof"]:
            if (
                not isinstance(proof, dict)
                or not isinstance(proof.get("class"), str)
                or any(type(proof.get(field)) is not int or proof[field] < 0 for field in ("legacy", "migrated"))
            ):
                raise EvidenceError("malformed initial proof class")
            if (
                proof.get("class") in classes
                or proof.get("status") != "ok"
                or proof.get("legacy") != proof.get("migrated")
            ):
                raise EvidenceError("invalid initial proof class")
            if proof["class"] == "mv":
                for field in ("non_avg_semantic_sha256", "native_semantic_sha256"):
                    semantic = proof.get(field)
                    if (
                        not isinstance(semantic, str)
                        or len(semantic) != 64
                        or any(char not in "0123456789abcdef" for char in semantic)
                    ):
                        raise EvidenceError("missing initial MV semantic proof")
                averages = proof.get("avg_comparison")
                tolerance = revision.MV_AVG_ABS_TOLERANCE if revision is not None else 1e-12
                if not isinstance(averages, dict) or set(averages) != {
                    "absolute_tolerance",
                    "changed_rows",
                    "max_abs_delta",
                }:
                    raise EvidenceError("missing initial MV average policy")
                if (
                    type(averages["absolute_tolerance"]) is not float
                    or averages["absolute_tolerance"] != tolerance
                    or type(averages["changed_rows"]) is not int
                    or not 0 <= averages["changed_rows"] <= proof["legacy"]
                    or type(averages["max_abs_delta"]) not in (int, float)
                    or not 0 <= averages["max_abs_delta"] <= tolerance
                ):
                    raise EvidenceError("invalid initial MV average policy")
            classes.add(proof["class"])
        if revision is not None and classes != {item[0] for item in revision.RECONCILE_CLASSES}:
            raise EvidenceError("receipt omits or invents an initial proof class")
        players = next((row for row in manifest["proof"] if row["class"] == "players"), None)
        if (
            players is None
            or type(manifest["handles_count"]) is not int
            or manifest["handles_count"] != players["legacy"]
        ):
            raise EvidenceError("receipt omits observation handle evidence")
        for name in ("owners", "handles"):
            digest = hashlib.sha256()
            count = 0
            with (receipt_dir / f"{name}.jsonl").open("rb") as stream:
                for line in stream:
                    digest.update(line)
                    count += 1
            if count != manifest[f"{name}_count"] or digest.hexdigest() != manifest[f"{name}_sha256"]:
                raise EvidenceError(f"receipt {name} file digest/count mismatch")
        # Validate every partition, even when a later check only queries one owner.
        for _ in saved_owners(receipt_dir):
            pass
        for _ in saved_handles(receipt_dir):
            pass
        return manifest
    except EvidenceError:
        raise
    except (OSError, KeyError, TypeError, ValueError) as exc:
        raise EvidenceError("missing or malformed receipt") from exc


def saved_owners(receipt_dir: Path):
    previous = None
    current_owner = None
    rows = []
    with (receipt_dir / "owners.jsonl").open("rb") as stream:
        for line in stream:
            state = _json(line)
            scope = state_scope(state)
            order = scope_key(scope)
            if previous is not None and order <= previous:
                raise EvidenceError("receipt owner rows are duplicate or unordered")
            previous = order
            owner = scope[:2]
            if current_owner is not None and owner != current_owner:
                _states(rows)
                yield current_owner, rows
                rows = []
            current_owner = owner
            if not state.get("owner_exists") or state.get("identity_sha256") is not None:
                raise EvidenceError("initial receipt contains an absent/merged owner")
            if "workspace_id" not in state or "discipline" not in state:
                raise EvidenceError("receipt owner lacks authority fields")
            if "values" in state:
                if semantic_digest(scope, state["values"], encoded=True) != (state["row_count"], state["sha256"]):
                    raise EvidenceError("receipt named values contradict owner digest")
            rows.append(state)
        if current_owner is not None:
            _states(rows)
            yield current_owner, rows


def saved_handles(receipt_dir: Path):
    """One bounded row at a time, keyed by the original observation identity."""
    previous = None
    with (receipt_dir / "handles.jsonl").open("rb") as stream:
        for line in stream:
            row = _json(line)
            if not isinstance(row, dict) or set(row) != {"match_id", "player_id", "team_id", "handle_snapshot"}:
                raise EvidenceError("invalid receipt handle fields")
            key = tuple(row[name] for name in ("match_id", "player_id", "team_id"))
            if any(type(value) is not int or value <= 0 for value in key):
                raise EvidenceError("invalid receipt handle identity")
            if previous is not None and key <= previous:
                raise EvidenceError("receipt handles are duplicate or unordered")
            handle = row["handle_snapshot"]
            if not isinstance(handle, str) or not handle.strip(" ") or len(handle) > 255:
                raise EvidenceError("invalid receipt handle snapshot")
            previous = key
            yield row


def _authority(conn, kind: str, key: tuple) -> dict:
    result = {"workspace_id": None, "discipline": None}
    queries = {
        "match": "SELECT m.workspace_id,m.discipline,e.tournament_id,e.id AS encounter_id,m.encounter_game_id AS game_id FROM stats.match m JOIN encounter.game g ON g.id=m.encounter_game_id JOIN encounter.encounter e ON e.id=g.encounter_id WHERE m.id=:id",
        "job": "SELECT workspace_id,discipline,hint_tournament_id AS tournament_id,hint_encounter_id AS encounter_id,hint_encounter_game_id AS game_id FROM stats.ingest_job WHERE id=:id",
        "member": "SELECT workspace_id,player_id FROM workspace_member WHERE id=:id",
        "channel": "SELECT t.workspace_id,t.discipline,c.tournament_id FROM stats.discord_channel c JOIN tournament.tournament t ON t.id=c.tournament_id WHERE c.id=:id",
        "alias": "SELECT discipline FROM catalog.alias_miss WHERE id=:id",
        "rule": "SELECT workspace_id,discipline FROM achievements.rule WHERE id=:id",
        "evaluation": "SELECT r.workspace_id,r.discipline,e.tournament_id,e.encounter_id FROM achievements.evaluation_result e JOIN achievements.rule r ON r.id=e.achievement_rule_id WHERE e.id=:id",
        "override": "SELECT r.workspace_id,r.discipline,e.tournament_id FROM achievements.override e JOIN achievements.rule r ON r.id=e.achievement_rule_id WHERE e.id=:id",
        "outbox": "SELECT (payload_json->>'workspace_id')::bigint AS workspace_id,(payload_json->>'tournament_id')::bigint AS tournament_id FROM event_outbox WHERE id=:id",
    }
    if kind in queries:
        row = conn.execute(sa.text(queries[kind]), {"id": key[0]}).mappings().first()
        if row is not None:
            result.update(dict(row))
    elif kind in {"vocabulary", "baseline", "mv"}:
        result["discipline"] = key[0]
    if kind == "match":
        result["legacy_teams"] = [
            dict(row)
            for row in conn.execute(
                sa.text(
                    "SELECT mt.encounter_team_id,et.team_id FROM stats.match_team mt JOIN encounter.team et ON et.id=mt.encounter_team_id WHERE mt.match_id=:id ORDER BY mt.source_position"
                ),
                {"id": key[0]},
            ).mappings()
        ]
    return result


def current_owners(conn, *, highwater: int | None = None):
    queries = [f"SELECT '{kind}'::text AS kind,key FROM ({query}) q" for kind, query in OWNER_QUERIES.items()]
    params = {}
    if highwater is not None:
        params["highwater"] = highwater
        queries.append("""SELECT s->>'owner_kind' AS kind,s->'owner_key' AS key
            FROM audit_log a CROSS JOIN LATERAL jsonb_array_elements(
              COALESCE(a.after_json->'stats_evidence'->'states','[]'::jsonb)) s
            WHERE a.id>:highwater AND a.after_json ? 'stats_evidence'""")
    query = (
        "SELECT kind,key FROM (SELECT DISTINCT kind,key FROM ("
        + " UNION ALL ".join(queries)
        + ') owners) unique_owners ORDER BY kind COLLATE "C",key::text COLLATE "C"'
    )
    with conn.execute(sa.text(query).execution_options(yield_per=OWNER_BATCH), params) as cursor:
        for row in cursor:
            kind, key = row[0], tuple(row[1])
            if kind not in PARTITIONS:
                raise EvidenceError("audit names unknown owner kind")
            state_scope({"owner_kind": kind, "owner_key": key, "subset": PARTITIONS[kind][0]})
            yield (kind, key), None


def _initial_proof(conn, revision) -> list[dict]:
    proof = [dict(row) for row in conn.execute(sa.text(revision.RECONCILE_SUMMARY)).mappings()]
    names = {row["class"] for row in proof}
    if len(names) != len(proof) or names != {item[0] for item in revision.RECONCILE_CLASSES}:
        raise EvidenceError("initial proof omitted a compare class")
    failures = [row for row in proof if row["status"] != "ok" or row["legacy"] != row["migrated"]]
    if failures:
        details = [
            encode_value(dict(row))
            for row in conn.execute(
                sa.text("SELECT class,direction,row FROM stats01_reconcile LIMIT :limit"), {"limit": DETAIL_LIMIT}
            ).mappings()
        ]
        raise EvidenceError(
            json.dumps(
                {"reason": "initial relational proof failed", "classes": failures, "details": details},
                ensure_ascii=False,
            )
        )
    # FLOAT8/JSON types and signed zero remain exact outside the one approved
    # legacy-average exception. mv_derivation separately checks both float bit
    # patterns against the deterministic native SELECT.
    _, expected, actual = next(item for item in revision.RECONCILE_CLASSES if item[0] == "mv")
    scope = ("mv", ("initial_projection", 0, 0), "derived_row")
    queries = (
        f"SELECT discipline,stat_id,entity_id,best_value,metadata FROM ({query}) p" for query in (expected, actual)
    )
    expected_digest, actual_digest = (_projection_digest(conn, query, scope) for query in queries)
    if expected_digest != actual_digest:
        raise EvidenceError("initial MV non-average semantic projection differs")
    mv = next(row for row in proof if row["class"] == "mv")
    mv["non_avg_semantic_sha256"] = expected_digest[1]
    mv["native_semantic_sha256"] = _projection_digest(conn, actual, scope)[1]
    mv["avg_comparison"] = {
        "absolute_tolerance": revision.MV_AVG_ABS_TOLERANCE,
        **dict(conn.execute(sa.text(revision.MV_AVG_DIFFERENCES)).mappings().one()),
    }
    return proof


def prepare_connection(conn, revision, *, receipt_dir: Path | None = None):
    """Only connection-local SQL setup; all data reads occur in the next snapshot."""
    if receipt_dir is not None:
        load_manifest(receipt_dir, revision)
    for sql in revision.RECONCILE_SETUP:
        conn.execute(sa.text(sql))
    conn.execute(sa.text(revision.RECONCILE_VIEW))
    if receipt_dir is not None:
        conn.execute(
            sa.text(
                "CREATE TEMP TABLE stats01_receipt_match AS SELECT match_id,game_id,workspace_id,discipline,tournament_id,encounter_id FROM stats01_match WITH NO DATA"
            )
        )
        conn.execute(
            sa.text(
                "CREATE TEMP TABLE stats01_receipt_member AS SELECT workspace_id,player_id,id FROM stats01_member WITH NO DATA"
            )
        )
        conn.execute(
            sa.text(
                "CREATE TEMP TABLE stats01_receipt_team AS SELECT match_id,game_id,team_id,encounter_team_id FROM stats01_team WITH NO DATA"
            )
        )
        conn.execute(
            sa.text(
                "CREATE TEMP TABLE stats01_receipt_handles AS SELECT match_id,player_id,team_id,handle_snapshot FROM stats01_handles WITH NO DATA"
            )
        )
        conn.execute(sa.text("CREATE TEMP TABLE stats01_receipt_owners(kind text,key jsonb,PRIMARY KEY(kind,key))"))
        for (kind, key), states in saved_owners(receipt_dir):
            row = states[0]
            conn.execute(
                sa.text("INSERT INTO stats01_receipt_owners VALUES(:kind,CAST(:key AS jsonb))"),
                {"kind": kind, "key": json.dumps(key)},
            )
            if kind == "match":
                params = {**row, "match_id": key[0], "game_id": row["game_id"]}
                conn.execute(
                    sa.text(
                        "INSERT INTO stats01_receipt_match VALUES(:match_id,:game_id,:workspace_id,:discipline,:tournament_id,:encounter_id)"
                    ),
                    params,
                )
                for team in row["legacy_teams"]:
                    conn.execute(
                        sa.text(
                            "INSERT INTO stats01_receipt_team VALUES(:match_id,:game_id,:team_id,:encounter_team_id)"
                        ),
                        {**params, **team},
                    )
            elif kind == "member":
                conn.execute(
                    sa.text("INSERT INTO stats01_receipt_member VALUES(:workspace_id,:player_id,:id)"),
                    {**row, "id": key[0]},
                )
        for row in saved_handles(receipt_dir):
            conn.execute(
                sa.text("INSERT INTO stats01_receipt_handles VALUES(:match_id,:player_id,:team_id,:handle_snapshot)"),
                row,
            )
        for name, columns in (
            ("match", "match_id,game_id,workspace_id,discipline,tournament_id,encounter_id"),
            ("member", "workspace_id,player_id,id"),
            ("team", "match_id,game_id,team_id,encounter_team_id"),
            ("handles", "match_id,player_id,team_id,handle_snapshot"),
        ):
            conn.execute(
                sa.text(f"CREATE OR REPLACE TEMP VIEW stats01_{name} AS SELECT {columns} FROM stats01_receipt_{name}")
            )
        for name, columns in (
            ("match", "match_id"),
            ("member", "workspace_id,player_id"),
            ("team", "match_id,team_id"),
            ("handles", "match_id,player_id,team_id"),
        ):
            conn.execute(sa.text(f"CREATE INDEX ON stats01_receipt_{name}({columns})"))
    conn.commit()


@contextmanager
def readonly_snapshot(engine, revision, *, receipt_dir: Path | None = None):
    with engine.connect() as conn:
        prepare_connection(conn, revision, receipt_dir=receipt_dir)
        conn = conn.execution_options(isolation_level="REPEATABLE READ")
        with conn.begin():
            conn.execute(sa.text("SET TRANSACTION READ ONLY"))
            conn.execute(sa.text("SET LOCAL TIME ZONE 'UTC'"))
            conn.execute(sa.text("SET LOCAL extra_float_digits=3"))
            yield conn


def _require_snapshot(conn):
    if (
        conn.scalar(sa.text("SHOW transaction_isolation")) != "repeatable read"
        or conn.scalar(sa.text("SHOW transaction_read_only")) != "on"
    ):
        raise EvidenceError("receipt operations require one repeatable-read read-only snapshot")


def capture_receipt(conn, receipt_dir: Path, revision) -> dict:
    _require_snapshot(conn)
    if any((receipt_dir / name).exists() for name in ("manifest.json", "owners.jsonl", "handles.jsonl")):
        raise EvidenceError("receipt already exists; refusing overwrite")
    proof = _initial_proof(conn, revision)
    receipt_dir.mkdir(parents=True, exist_ok=True)
    nonce = uuid4().hex
    owner_temp = receipt_dir / f".owners.{nonce}.tmp"
    handle_temp = receipt_dir / f".handles.{nonce}.tmp"
    manifest_temp = receipt_dir / f".manifest.{nonce}.tmp"
    digest = hashlib.sha256()
    count = 0
    try:
        handles_digest = hashlib.sha256()
        handles_count = 0
        query = (
            "SELECT match_id,player_id,team_id,handle_snapshot FROM stats01_handles ORDER BY match_id,player_id,team_id"
        )
        with (
            handle_temp.open("xb") as stream,
            conn.execute(sa.text(query).execution_options(yield_per=ROW_BATCH)) as cursor,
        ):
            for row in cursor.mappings():
                raw = _dump(dict(row)) + b"\n"
                stream.write(raw)
                handles_digest.update(raw)
                handles_count += 1
            stream.flush()
            os.fsync(stream.fileno())
        if handles_count != next(row["legacy"] for row in proof if row["class"] == "players"):
            raise EvidenceError("initial proof omits observation handle evidence")
        with owner_temp.open("xb") as stream:
            for (kind, key), _ in current_owners(conn):
                states = capture_native(conn, scopes=owner_scopes(kind, key))
                authority = _authority(conn, kind, key)
                legacy = _legacy_digests(conn, revision, (kind, key), compare_native=True)
                values = {state_scope(row): row["rows"] for row in states.values}
                for index, state in enumerate(states):
                    row = {**state, **authority}
                    if index == 0:
                        row["legacy_proof"] = legacy
                    # MV metadata and original identity/game mapping are necessary
                    # to distinguish descriptive refresh from statistical changes.
                    if kind in {"mv", "member"}:
                        row["values"] = values[state_scope(state)]
                    raw = _dump(row) + b"\n"
                    stream.write(raw)
                    digest.update(raw)
                    count += 1
            stream.flush()
            os.fsync(stream.fileno())
        info = conn.execute(
            sa.text(
                "SELECT current_database(),pg_current_snapshot()::text,COALESCE((SELECT max(id) FROM audit_log),0),COALESCE((SELECT max(id) FROM players.user_merge_audit),0)"
            )
        ).one()
        manifest = {
            "format": FORMAT,
            "revision": "stats01",
            "codec": CODEC,
            "captured_at": datetime.now(UTC).isoformat(timespec="microseconds").replace("+00:00", "Z"),
            "database_name": info[0],
            "snapshot": info[1],
            "audit_highwater": {"audit_log_id": info[2], "user_merge_audit_id": info[3]},
            "proof": proof,
            "owners_file": "owners.jsonl",
            "owners_count": count,
            "owners_sha256": digest.hexdigest(),
            "handles_file": "handles.jsonl",
            "handles_count": handles_count,
            "handles_sha256": handles_digest.hexdigest(),
        }
        with manifest_temp.open("xb") as stream:
            stream.write(_dump(manifest) + b"\n")
            stream.flush()
            os.fsync(stream.fileno())
        _publish(owner_temp, receipt_dir / "owners.jsonl")
        _publish(handle_temp, receipt_dir / "handles.jsonl")
        _publish(manifest_temp, receipt_dir / "manifest.json")
        return {"status": "unchanged", "exit_code": 0, "proof": proof, "owners_count": count}
    finally:
        # A failed publication never creates a usable manifest. Do not remove a
        # published owners file: its presence correctly prevents accidental reuse.
        owner_temp.unlink(missing_ok=True)
        handle_temp.unlink(missing_ok=True)
        manifest_temp.unlink(missing_ok=True)


def _audit_payload(row):
    before_json, after_json = row["before_json"], row["after_json"]
    if not isinstance(before_json, dict) or not isinstance(after_json, dict):
        raise EvidenceError("missing before/after audit evidence")
    before, after = before_json.get("stats_evidence"), after_json.get("stats_evidence")
    if (
        not isinstance(before, dict)
        or not isinstance(after, dict)
        or before.get("version") != 1
        or after.get("version") != 1
    ):
        raise EvidenceError("unsupported/missing audit evidence version")
    if before.get("operation") != after.get("operation") or before.get("identity_map") != after.get("identity_map"):
        raise EvidenceError("contradictory audit envelope")
    if not validate_transition(
        after["operation"],
        before["states"],
        after["states"],
        identity_map=after["identity_map"],
        before_values=before_json.get("stats_values", []),
        after_values=after_json.get("stats_values", []),
    ):
        raise EvidenceError("no-op audit is not mutation evidence")
    return before, after


def _original_mapping(entry, original):
    if set(entry) == {"source_user_id", "target_user_id"}:
        return entry == {key: original.get(key) for key in entry}
    return entry in original.get("identity_map", [])


def _merge_evidence(conn, audit_id: int, mapping: list[dict], merge_highwater: int):
    rows = conn.execute(
        sa.text("""SELECT id,preview_snapshot_json,affected_counts_json
        FROM players.user_merge_audit WHERE id>:highwater
        AND preview_snapshot_json::jsonb->'stats_evidence'->'audit_ids' @> CAST(:id AS jsonb)"""),
        {"highwater": merge_highwater, "id": json.dumps([audit_id])},
    ).mappings()
    found = None
    for row in rows:
        if found is not None:
            raise EvidenceError("duplicate original merge evidence")
        found = row
    if found is None:
        raise EvidenceError("original user_merge_audit evidence unavailable")
    original = found["preview_snapshot_json"]["stats_evidence"]
    if (
        not isinstance(original.get("identity_map"), list)
        or any(not _original_mapping(item, original) for item in mapping)
        or not original.get("audit_ids")
        or len(set(original["audit_ids"])) != len(original["audit_ids"])
    ):
        raise EvidenceError("merge JSON mapping/audit ids contradict stats evidence")
    if any(
        item["source_user_id"] != original.get("source_user_id")
        or item["target_user_id"] != original.get("target_user_id")
        for item in mapping
    ):
        raise EvidenceError("merge lost original player ids")
    counts = found["affected_counts_json"]
    if any(
        type(counts.get(key)) is not int or counts[key] < 0
        for key in ("stats_matches", "stats_players", "stats_facts", "stats_events")
    ):
        raise EvidenceError("merge lost moved observation counts")
    return dict(found)


def _zero_impact_merge(conn, row, original):
    """An empty native merge has an original record, never a fabricated stats audit.

    Former owners still require their complete receipt-to-current chains below.
    Auth/API-key SET NULL changes likewise need separate owner-delete evidence.
    """
    snapshot = row["preview_snapshot_json"]
    source, target = original.get("source_user_id"), original.get("target_user_id")
    if (
        type(source) is not int
        or type(target) is not int
        or source <= 0
        or target <= 0
        or source == target
        or original.get("identity_map") != []
        or original.get("audit_ids") != []
    ):
        raise EvidenceError("invalid zero-impact original merge identity")
    for side, user_id in (("source", source), ("target", target)):
        summary = snapshot.get(side)
        if not isinstance(summary, dict) or type(summary.get("id")) is not int or summary["id"] != user_id:
            raise EvidenceError("zero-impact merge contradicts original preview pair")
    if row["source_user_id"] is not None or row["target_user_id"] not in (None, target):
        raise EvidenceError("zero-impact merge contradicts original user references")
    fields = ("stats_matches", "stats_players", "stats_facts", "stats_events", "stats.ingest_job.uploader_user_id")
    for counts in (snapshot.get("affected_counts"), row["affected_counts_json"]):
        if not isinstance(counts, dict) or any(type(counts.get(key)) is not int or counts[key] != 0 for key in fields):
            raise EvidenceError("zero-impact merge lacks exact zero native counts")
    if conn.scalar(
        sa.text("""SELECT EXISTS(SELECT 1 FROM players."user" WHERE id=:source)
        OR EXISTS(SELECT 1 FROM workspace_member WHERE player_id=:source)
        OR EXISTS(SELECT 1 FROM stats.ingest_job WHERE uploader_user_id=:source)"""),
        {"source": source},
    ):
        raise EvidenceError("zero-impact merge retains source identity or native owners")


def _audit_precheck(conn, manifest, export):
    highwater = manifest["audit_highwater"]
    query = """SELECT id,action,before_json,after_json FROM audit_log WHERE id>:id
        AND (action LIKE 'stats.%' OR before_json ? 'stats_evidence' OR after_json ? 'stats_evidence') ORDER BY id"""
    with conn.execute(sa.text(query).execution_options(yield_per=1), {"id": highwater["audit_log_id"]}) as cursor:
        for row in cursor.mappings():
            before, after = _audit_payload(row)
            if row["action"].startswith("stats.") and row["action"] != after["operation"]:
                raise EvidenceError("audit action contradicts evidence operation")
            if export is not None:
                export.write(_dump({"kind": "audit_log", **dict(row)}) + b"\n")
            if after["operation"] == "stats.member_merge":
                _merge_evidence(conn, row["id"], after["identity_map"], highwater["user_merge_audit_id"])
    # Original merge records cannot disappear from the other direction either.
    query = """SELECT id,source_user_id,target_user_id,preview_snapshot_json,affected_counts_json
        FROM players.user_merge_audit WHERE id>:id ORDER BY id"""
    with conn.execute(
        sa.text(query).execution_options(yield_per=1), {"id": highwater["user_merge_audit_id"]}
    ) as cursor:
        for row in cursor.mappings():
            original = (row["preview_snapshot_json"] or {}).get("stats_evidence")
            if not isinstance(original, dict):
                raise EvidenceError("post-cutover merge lacks original stats evidence")
            ids = original.get("audit_ids")
            if (
                not isinstance(ids, list)
                or any(type(value) is not int or value <= highwater["audit_log_id"] for value in ids)
                or len(set(ids)) != len(ids)
            ):
                raise EvidenceError("invalid original merge audit ids")
            original_map = original.get("identity_map")
            if not isinstance(original_map, list):
                raise EvidenceError("missing complete original identity mapping")
            if len({semantic_bytes(item) for item in original_map}) != len(original_map):
                raise EvidenceError("duplicate original merge identity mapping")
            if not ids:
                _zero_impact_merge(conn, row, original)
            seen_mapping = set()
            member_owners = set()
            global_pair_seen = False
            for audit_id in ids:
                audit = (
                    conn.execute(
                        sa.text("SELECT id,action,before_json,after_json FROM audit_log WHERE id=:id"), {"id": audit_id}
                    )
                    .mappings()
                    .first()
                )
                if audit is None:
                    raise EvidenceError("original merge names missing audit link")
                before, after = _audit_payload(audit)
                if after["operation"] != "stats.member_merge" or any(
                    not _original_mapping(item, original) for item in after["identity_map"]
                ):
                    raise EvidenceError("original merge names contradictory audit link")
                seen_mapping.update(semantic_bytes(item) for item in after["identity_map"] if "workspace_id" in item)
                global_pair_seen |= any("workspace_id" not in item for item in after["identity_map"])
                for state in after["states"]:
                    if state["owner_kind"] == "member":
                        member_id = state["owner_key"][0]
                        if member_id in member_owners:
                            raise EvidenceError("merge repeats a member before-after chain across chunks")
                        member_owners.add(member_id)
            if seen_mapping != {semantic_bytes(item) for item in original_map}:
                raise EvidenceError("original merge mapping is not fully evidenced")
            required_members = {item[key] for item in original_map for key in ("source_member_id", "target_member_id")}
            if member_owners != required_members:
                raise EvidenceError("merge omits a member identity owner across chunks")
            if ids and not original_map and not global_pair_seen:
                raise EvidenceError("uploader-only merge omits the original global pair")
            if export is not None:
                export.write(_dump({"kind": "user_merge_audit", **dict(row)}) + b"\n")


def _owner_chain(conn, owner, initial, manifest):
    scopes = owner_scopes(*owner)
    last = (
        {state_scope(state): state for state in initial} if initial else {scope: empty_state(scope) for scope in scopes}
    )
    ids = {scope: [] for scope in scopes}
    operations = set()
    query = """SELECT id,action,before_json,after_json FROM audit_log a WHERE id>:highwater
      AND EXISTS(SELECT 1 FROM jsonb_array_elements(a.after_json->'stats_evidence'->'states') s
        WHERE s->>'owner_kind'=:kind AND s->'owner_key'=CAST(:key AS jsonb)) ORDER BY id"""
    params = {"highwater": manifest["audit_highwater"]["audit_log_id"], "kind": owner[0], "key": json.dumps(owner[1])}
    with conn.execute(sa.text(query).execution_options(yield_per=1), params) as cursor:
        for row in cursor.mappings():
            before, after = _audit_payload(row)
            before_states = {state_scope(s): s for s in before["states"] if state_scope(s)[:2] == owner}
            after_states = {state_scope(s): s for s in after["states"] if state_scope(s)[:2] == owner}
            if before_states.keys() != last.keys() or any(
                not state_equal(last[scope], state) for scope, state in before_states.items()
            ):
                raise EvidenceError(f"missing/reordered before-after link at audit {row['id']}")
            for scope, state in after_states.items():
                identity_change = (
                    after["operation"] == "stats.member_merge"
                    and scope[2] in OPERATIONS["stats.member_merge"][scope[0]]
                )
                if not state_equal(last[scope], state) or identity_change:
                    operations.add(after["operation"])
                    ids[scope].append(row["id"])
            last = after_states
    current = capture_native(conn, scopes=scopes)
    statuses = []
    for state in current:
        scope = state_scope(state)
        if not state_equal(last[scope], state):
            raise EvidenceError(f"current state differs from last after: {scope[2]}")
        statuses.append(
            {
                "owner_kind": owner[0],
                "owner_key": list(owner[1]),
                "subset": scope[2],
                "status": "changed_since_cutover" if ids[scope] else "unchanged",
                "audit_ids": ids[scope],
            }
        )
    if initial is None and not any(ids.values()):
        raise EvidenceError("unexpected current owner without creation evidence")
    return statuses, operations


def _mv_structure(rows):
    cleaned = []
    for row in rows:
        copy = list(row)
        if not isinstance(copy[-1], dict):
            raise EvidenceError("invalid MV metadata")
        copy[-1] = {key: value for key, value in copy[-1].items() if key not in LIVE_MV_LABELS}
        cleaned.append(copy)
    return cleaned


def _check_mv(conn, revision):
    actual = "SELECT discipline,stat_id,entity_id,best_value,avg,metadata FROM stats.mv_entity_global_stats"
    scope = ("mv", ("current_projection", 0, 0), "derived_row")
    digests = [_projection_digest(conn, query, scope) for query in (revision.NATIVE_MV_SELECT, actual)]
    if digests[0] != digests[1]:
        raise EvidenceError("native MV is stale or numerically/structurally corrupted; refresh normally, then recheck")


def _ordered_projection(conn, query, *, omit=()):
    """Keep database float/timestamp types; JSON row wrapping would lose -0.0."""
    descriptions = conn.info.setdefault("stats01_proof_columns", {})
    if query not in descriptions:
        with conn.execute(sa.text(f"{query} LIMIT 0")) as result:
            descriptions[query] = [(column[0], column[1]) for column in result.cursor.description]
    columns, scalars, jsons, float_ties = [], [], [], []
    for name, oid in descriptions[query]:
        if name in omit:
            continue
        column = 'p."' + name.replace('"', '""') + '"'
        columns.append(column)
        if oid in {114, 3802}:  # PostgreSQL JSON / JSONB.
            jsons.append(f'{column}::jsonb::text COLLATE "C" NULLS FIRST')
            columns.append(f"{column} IS NULL")
            scalars.append(f"({column} IS NULL)")
        else:
            collate = ' COLLATE "C"' if oid in {18, 19, 25, 1042, 1043} else ""
            scalars.append(f"{column}{collate} NULLS FIRST")
            if oid in {700, 701}:
                float_ties.append(f"""encode(float8send({column}::double precision),'hex') COLLATE "C" NULLS FIRST""")
    return ", ".join(columns), ", ".join(scalars + jsons + float_ties)


def _projection_digest(conn, query, scope):
    columns, ordering = _ordered_projection(conn, query)
    with conn.execute(
        sa.text(f"SELECT {columns} FROM ({query}) p ORDER BY {ordering}").execution_options(yield_per=ROW_BATCH)
    ) as cursor:
        return semantic_digest(scope, cursor)


def _legacy_digests(conn, revision, owner, *, compare_native=False):
    """Independent frozen expected projections, with multiplicity and original mapping."""
    result = []
    for name, expected, actual in revision.RECONCILE_CLASSES:
        attribution = revision.RECONCILE_OWNERS.get(name)
        if attribution is None or attribution[0] != owner[0] or name == "mv":
            continue
        key_sql = attribution[1]
        scope = (owner[0], owner[1], f"legacy/{name}")

        def digest(query, *, omit=(), key_sql=key_sql, scope=scope):
            columns, ordering = _ordered_projection(conn, query, omit=omit)
            sql = f"SELECT {columns} FROM ({query}) p WHERE {key_sql}=CAST(:key AS jsonb) ORDER BY {ordering}"
            with conn.execute(
                sa.text(sql).execution_options(yield_per=ROW_BATCH), {"key": json.dumps(owner[1])}
            ) as cursor:
                return semantic_digest(scope, cursor)

        count, sha256 = digest(expected)
        if compare_native and (count, sha256) != digest(actual):
            raise EvidenceError(f"initial expected/native owner proof differs: {name}/{owner}")
        evidence = {"class": name, "row_count": count, "sha256": sha256}
        if name in LEGACY_NULL_REFERENCES:
            fields = LEGACY_NULL_REFERENCES[name]
            row = conn.execute(
                sa.text(f"SELECT to_jsonb(p) FROM ({expected}) p WHERE {key_sql}=CAST(:key AS jsonb)"),
                {"key": json.dumps(owner[1])},
            ).scalar_one_or_none()
            evidence["references"] = {field: row[field] for field in fields} if row is not None else None
            evidence["complement_sha256"] = digest(expected, omit=fields)[1]
        result.append(evidence)
    return result


def _legacy_owner_check(conn, revision, owner, initial, operations, *, merge_highwater):
    if initial is None:
        return "not_legacy"
    saved = initial[0].get("legacy_proof")
    if not isinstance(saved, list):
        raise EvidenceError("receipt lacks original per-owner legacy proof")
    current = _legacy_digests(conn, revision, owner)
    if [row["class"] for row in saved] != [row["class"] for row in current]:
        raise EvidenceError("receipt omits a legacy owner class")
    incomplete = False
    for original, now in zip(saved, current, strict=True):
        if original == now:
            continue
        # Source SET NULL columns are narrow exceptions bound to a separate
        # full-row complement; a later value/error/timestamp change still blocks.
        if now["class"] in LEGACY_NULL_REFERENCES and now["row_count"] == original["row_count"] == 1:
            old_refs, new_refs = original.get("references"), now.get("references")
            if (
                isinstance(old_refs, dict)
                and isinstance(new_refs, dict)
                and old_refs.keys() == new_refs.keys()
                and original.get("complement_sha256") == now.get("complement_sha256")
            ):
                evidenced = bool(operations & {"stats.owner_delete", "stats.member_merge"})
                if (
                    not evidenced
                    and now["class"] == "jobs"
                    and "stats.job_hint" in operations
                    and old_refs.get("uploader_user_id") is not None
                    and new_refs == {**old_refs, "uploader_user_id": None}
                ):
                    # A prior, fully checked native hint can retire this uploader
                    # before an empty merge. Only that validated original source's
                    # legacy uploader may then clear; no other reference is waived.
                    evidenced = conn.scalar(
                        sa.text("""SELECT EXISTS(
                        SELECT 1 FROM players.user_merge_audit m,stats.ingest_job j
                        WHERE m.id>:highwater AND j.id=:job AND j.uploader_user_id IS DISTINCT FROM :source
                          AND m.preview_snapshot_json::jsonb->'stats_evidence'->'source_user_id'=to_jsonb(CAST(:source AS bigint))
                          AND m.preview_snapshot_json::jsonb->'stats_evidence'->'identity_map'='[]'::jsonb
                          AND m.preview_snapshot_json::jsonb->'stats_evidence'->'audit_ids'='[]'::jsonb)"""),
                        {"highwater": merge_highwater, "job": owner[1][0], "source": old_refs["uploader_user_id"]},
                    )
                if evidenced and all(old_refs[key] == value or value is None for key, value in new_refs.items()):
                    incomplete = True
                    continue
        # Only an evidenced cascade may make a source no longer complete.
        if now["row_count"] < original["row_count"] and operations & {"stats.owner_delete", "stats.member_merge"}:
            incomplete = True
            continue
        raise EvidenceError(f"legacy projection changed without evidenced source cascade: {now['class']}")
    return "source_incomplete_after_evidenced_cascade" if incomplete else "unchanged"


def _later_global_proof(conn, revision):
    for name, expected, actual in revision.RECONCILE_CLASSES:
        if name not in {"oracle_integrity", "external_constraints"}:
            continue
        query = f"SELECT EXISTS(SELECT 1 FROM (({expected}) EXCEPT ALL ({actual})) a) OR EXISTS(SELECT 1 FROM (({actual}) EXCEPT ALL ({expected})) b)"
        if conn.scalar(sa.text(query)):
            raise EvidenceError(f"retained transfer proof is invalid: {name}")
    for kind, relation in (("match", "matches.match"), ("job", "log_processing.record")):
        if conn.scalar(
            sa.text(f"""SELECT EXISTS(SELECT 1 FROM {relation} l WHERE NOT EXISTS(
            SELECT 1 FROM stats01_receipt_owners r WHERE r.kind=:kind AND r.key=jsonb_build_array(l.id)))"""),
            {"kind": kind},
        ):
            raise EvidenceError("post-cutover writes created unexpected legacy owners")


def _all_owners(conn, receipt_dir, manifest):
    merged = heapq.merge(
        saved_owners(receipt_dir),
        current_owners(conn, highwater=manifest["audit_highwater"]["audit_log_id"]),
        key=lambda item: _owner_sort(item[0]),
    )
    for _, grouped in itertools.groupby(merged, key=lambda item: _owner_sort(item[0])):
        pairs = list(grouped)  # At most two entries, never the global owner set.
        yield pairs[0][0], next((states for _, states in pairs if states is not None), None)


def check_receipt(conn, receipt_dir: Path, revision, *, export=None, owner_sink=None) -> dict:
    _require_snapshot(conn)
    manifest = load_manifest(receipt_dir, revision)
    if conn.scalar(sa.text("SELECT current_database()")) != manifest["database_name"]:
        raise EvidenceError("receipt belongs to a different database")
    _audit_precheck(conn, manifest, export)
    _later_global_proof(conn, revision)
    results = []
    counts = {"unchanged": 0, "changed_since_cutover": 0, "blocking": 0}
    changed_disciplines = set()

    def emit(row):
        counts[row["status"]] += 1
        if owner_sink is not None:
            owner_sink(row)
        elif len(results) < DETAIL_LIMIT:
            results.append(row)

    for owner, initial in _all_owners(conn, receipt_dir, manifest):
        if owner[0] == "mv":
            continue
        try:
            statuses, operations = _owner_chain(conn, owner, initial, manifest)
            legacy_status = _legacy_owner_check(
                conn,
                revision,
                owner,
                initial,
                operations,
                merge_highwater=manifest["audit_highwater"]["user_merge_audit_id"],
            )
            if operations and owner[0] == "match":
                discipline = initial[0].get("discipline") if initial else _authority(conn, *owner).get("discipline")
                if discipline is not None:
                    changed_disciplines.add(discipline)
            for status in statuses:
                emit({**status, "legacy_status": legacy_status})
        except (EvidenceError, KeyError, TypeError) as exc:
            emit(
                {
                    "owner_kind": owner[0],
                    "owner_key": list(owner[1]),
                    "status": "blocking",
                    "reason": str(exc),
                    "audit_ids": [],
                }
            )
    # Re-stream MV owners rather than retaining a global control list.
    try:
        _check_mv(conn, revision)
        for owner, initial in _all_owners(conn, receipt_dir, manifest):
            if owner[0] != "mv":
                continue
            current = capture_native(conn, scopes=owner_scopes(*owner))
            rows = current.values[0]["rows"]
            original = initial[0]["values"] if initial else []
            structural_change = _mv_structure(rows) != _mv_structure(original)
            status = "unchanged"
            if structural_change:
                if owner[1][0] not in changed_disciplines:
                    raise EvidenceError("MV numeric/best-owner/encounter change has no validated base-owner evidence")
                status = "changed_since_cutover"
            emit(
                {
                    "owner_kind": "mv",
                    "owner_key": list(owner[1]),
                    "subset": "derived_row",
                    "status": status,
                    "audit_ids": [],
                }
            )
    except EvidenceError as exc:
        emit({"class": "mv", "status": "blocking", "reason": str(exc)})
    code = 1 if counts["blocking"] else 2 if counts["changed_since_cutover"] else 0
    report = {
        "status": "blocking" if code == 1 else "changed_since_cutover" if code == 2 else "unchanged",
        "exit_code": code,
        "counts": counts,
    }
    if owner_sink is None:
        report.update(owners=results, details_truncated=sum(counts.values()) > len(results))
    return report


def _database_url():
    from shared.core.config import BaseServiceSettings

    settings = BaseServiceSettings()
    return sa.URL.create(
        "postgresql+psycopg",
        username=settings.postgres_user,
        password=settings.postgres_password,
        host=settings.postgres_host,
        port=int(settings.postgres_port),
        database=settings.postgres_db,
    )


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", choices=("capture", "check"), required=True)
    parser.add_argument("--receipt-dir", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--audit-source", choices=("database",), default="database")
    parser.add_argument("--export-audit", type=Path)
    args = parser.parse_args(argv)
    protected = {(args.receipt_dir / name).resolve() for name in ("manifest.json", "owners.jsonl", "handles.jsonl")}
    if args.report.resolve() in protected:
        print("blocking: report output cannot overwrite immutable receipt files", file=sys.stderr)
        return 1
    export = None
    engine = None
    report_stream = args.report.open("wb")
    report_stream.write(b'{"owners":[')
    emitted = False

    def emit_owner(row):
        nonlocal emitted
        if emitted:
            report_stream.write(b",")
        report_stream.write(_dump(row))
        emitted = True

    try:
        revision = revision_module()
        if args.mode == "check":
            load_manifest(args.receipt_dir, revision)
        if args.export_audit is not None:
            if args.mode != "check":
                raise EvidenceError("audit export is available only in check mode")
            export = args.export_audit.open("xb")
        engine = sa.create_engine(_database_url(), poolclass=sa.pool.NullPool)
        with readonly_snapshot(
            engine, revision, receipt_dir=args.receipt_dir if args.mode == "check" else None
        ) as conn:
            report = (
                capture_receipt(conn, args.receipt_dir, revision)
                if args.mode == "capture"
                else check_receipt(conn, args.receipt_dir, revision, export=export, owner_sink=emit_owner)
            )
    except Exception as exc:
        # SQL/connection failures are blockers too. Never print a DSN or driver
        # exception containing bind values (filenames, credential configuration).
        reason = str(exc) if isinstance(exc, EvidenceError) else f"{type(exc).__name__}: reconciliation unavailable"
        report = {"status": "blocking", "exit_code": 1, "reason": reason}
    finally:
        if export is not None:
            export.close()
        if engine is not None:
            engine.dispose()
    report_stream.write(b"]," + _dump(report)[1:] + b"\n")
    report_stream.close()
    return report["exit_code"]


if __name__ == "__main__":
    sys.exit(main())
