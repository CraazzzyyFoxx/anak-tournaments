"""Frozen P4 Overwatch parser reference for P5 decoder parity.

`fixtures/ow_decoder_reference/` holds the original Workshop bytes (`workshop.csv`), the observations the
completed-P4 parser path (`flows.process_match_log` -> `MatchLogProcessor.start`, real PostgreSQL, the same
`environment`/`upload`/`process` harness as `test_stats_ingest_db.py`) wrote for them (`expected.json`), and a
`manifest.json` binding both to a SHA-256 and the source HEAD.

* `test_reference_is_intact` runs in the normal suite and needs no database.
* `test_capture_p4_reference` is a recapture harness and is skipped unless `P5_CAPTURE_OW_REFERENCE=1`. It must
  only be run against the P4 parser (the P5 decoder replaces it); never regenerate expected output with a decoder
  under test. Task 3's parity test reads `expected.json`; it never calls this module.

Observations are keyed by participant handle and team `source_position` (home=1, away=2), never by database ids.
Every float is stored as its IEEE-754 big-endian hex plus the decimal value, so signed zero and the last ulp
are comparable exactly. Events are a canonically sorted multiset (duplicates kept); P4's insertion order
(kills first, then other events) is not part of the contract.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import struct
import subprocess
from pathlib import Path

import pytest
import sqlalchemy as sa

from shared import models
from tests.test_stats_ingest_db import STATUS, environment, process, upload

DIRECTORY = Path(__file__).parent / "fixtures" / "ow_decoder_reference"
RAW, EXPECTED, MANIFEST = DIRECTORY / "workshop.csv", DIRECTORY / "expected.json", DIRECTORY / "manifest.json"
CAPTURE_COMMAND = (
    "cd backend/parser-service && export POSTGRES_DB=anak_test POSTGRES_HOST=127.0.0.1 POSTGRES_PORT=55432 "
    "POSTGRES_USER=postgres POSTGRES_PASSWORD=postgres && P5_CAPTURE_OW_REFERENCE=1 "
    "uv run pytest tests/test_ow_decoder_reference_capture.py -k capture -s"
)
SECOND_HERO = {"slug": "ingest-reaper", "name": "Ingest Reaper", "attrs": {"class": "damage"}}


def bits(value: float) -> dict:
    assert math.isfinite(value), value
    return {"value": value, "bits": struct.pack(">d", value).hex()}


def _git(*args: str) -> str:
    return subprocess.run(["git", *args], capture_output=True, text=True, check=True).stdout.rstrip("\n")


async def observe(env) -> dict:
    async with env.sf() as session:
        match = await session.scalar(
            sa.select(models.StatsMatch).where(models.StatsMatch.encounter_game_id == env.game)
        )
        entity = dict((await session.execute(sa.select(models.CatalogEntity.id, models.CatalogEntity.slug))).all())
        stat = dict((await session.execute(sa.select(models.StatDef.id, models.StatDef.code))).all())
        kind = dict((await session.execute(sa.select(models.EventType.id, models.EventType.code))).all())
        role = dict((await session.execute(sa.select(models.CatalogRole.id, models.CatalogRole.code))).all())
        scoped = {"match_id": match.id}
        position = dict(
            (
                await session.execute(
                    sa.select(models.StatsMatchTeam.encounter_team_id, models.StatsMatchTeam.source_position).where(
                        models.StatsMatchTeam.match_id == match.id
                    )
                )
            ).all()
        )
        players = (
            await session.scalars(
                sa.select(models.StatsMatchPlayer).where(models.StatsMatchPlayer.match_id == match.id)
            )
        ).all()
        handle = {player.workspace_member_id: player.handle_snapshot for player in players}
        facts = (await session.scalars(sa.select(models.StatsFact).filter_by(**scoped))).all()
        events = (await session.scalars(sa.select(models.StatsEvent).filter_by(**scoped))).all()
        segments = (await session.scalars(sa.select(models.StatsSegment).filter_by(**scoped))).all()

    def who(member, team):
        return {"team_position": position.get(team), "handle": handle.get(member)}

    fact_rows = sorted(
        (
            {
                "segment": fact.segment,
                "team_position": position[fact.encounter_team_id],
                "handle": handle.get(fact.workspace_member_id),
                "hero": entity.get(fact.entity_id),
                "stat": stat[fact.stat_id],
                **bits(fact.value),
            }
            for fact in facts
        ),
        key=lambda row: (row["segment"], row["team_position"], row["handle"] or "", row["hero"] or "", row["stat"]),
    )
    event_rows = sorted(
        (
            {
                "segment": event.segment,
                "t": bits(event.t),
                "type": kind[event.type_id],
                "actor": who(event.actor_member_id, event.actor_team_id),
                "target": who(event.target_member_id, event.target_team_id),
                "hero": entity.get(event.entity_id),
                "related_hero": entity.get(event.related_entity_id),
                "data": event.data,
            }
            for event in events
        ),
        key=lambda row: json.dumps(row, sort_keys=True),
    )
    return {
        "match": {
            "map": entity[match.map_entity_id],
            "revision": match.revision,
            "duration_s": bits(match.duration_s),
        },
        "segments": sorted(({"segment": s.segment, "kind": s.kind} for s in segments), key=lambda s: s["segment"]),
        "team_scores": {
            str(row["team_position"]): {"value": row["value"], "bits": row["bits"]}
            for row in fact_rows
            if row["stat"] == "score" and row["segment"] == 0 and row["handle"] is None
        },
        "players": {
            player.handle_snapshot: {
                "team_position": position[player.encounter_team_id],
                "observed_role": role.get(player.observed_role_id),
            }
            for player in sorted(players, key=lambda p: p.handle_snapshot)
        },
        "facts": fact_rows,
        "events": event_rows,
    }


@pytest.mark.skipif(
    os.environ.get("P5_CAPTURE_OW_REFERENCE") != "1", reason="recapture harness: set P5_CAPTURE_OW_REFERENCE=1"
)
def test_capture_p4_reference(stats_parity_database, monkeypatch):
    import asyncio

    async def run():
        async with environment(stats_parity_database, monkeypatch) as env:
            async with env.sf() as session:
                session.add(models.CatalogEntity(discipline="overwatch", kind="character", **SECOND_HERO))
                await session.commit()
            raw = RAW.read_bytes()
            job = await upload(env, raw, filename="workshop.csv")
            assert await process(env, job.id) == STATUS.DONE
            return await observe(env)

    expected = asyncio.run(run())
    raw = RAW.read_bytes()
    EXPECTED.write_bytes((json.dumps(expected, indent=1, sort_keys=True, ensure_ascii=False) + "\n").encode())
    root = _git("rev-parse", "--show-toplevel")
    MANIFEST.write_bytes(
        (
            json.dumps(
                {
                    "source_head": _git("rev-parse", "HEAD"),
                    "uncommitted_paths_at_capture": _git(
                        "-C", root, "status", "--porcelain", "--", "backend/parser-service/src", "backend/shared"
                    ).splitlines(),
                    "capture_command": CAPTURE_COMMAND,
                    "parser_path": "src.services.match_logs.flows.process_match_log -> MatchLogProcessor.start",
                    "raw": {"file": RAW.name, "sha256": hashlib.sha256(raw).hexdigest(), "bytes": len(raw)},
                    "expected": {"file": EXPECTED.name, "sha256": hashlib.sha256(EXPECTED.read_bytes()).hexdigest()},
                    "second_catalog_hero": SECOND_HERO,
                    "counts": {
                        "facts": len(expected["facts"]),
                        "events": len(expected["events"]),
                        "players": len(expected["players"]),
                    },
                },
                indent=1,
                sort_keys=True,
            )
            + "\n"
        ).encode()
    )
    print(
        f"captured {len(expected['facts'])} facts, {len(expected['events'])} events, {len(expected['players'])} players"
    )


def test_reference_is_intact():
    manifest = json.loads(MANIFEST.read_bytes())
    assert hashlib.sha256(RAW.read_bytes()).hexdigest() == manifest["raw"]["sha256"]
    assert hashlib.sha256(EXPECTED.read_bytes()).hexdigest() == manifest["expected"]["sha256"]
    expected = json.loads(EXPECTED.read_bytes())
    assert sorted(expected["team_scores"]) == ["1", "2"]
    assert expected["segments"] == [{"segment": n, "kind": "round"} for n in (1, 2)]

    def check(node):
        if isinstance(node, dict):
            if "bits" in node:
                assert struct.pack(">d", node["value"]).hex() == node["bits"]
            for child in node.values():
                check(child)
        elif isinstance(node, list):
            for child in node:
                check(child)

    check(expected)
