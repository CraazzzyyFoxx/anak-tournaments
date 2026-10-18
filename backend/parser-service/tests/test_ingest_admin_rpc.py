"""Admin surface of Task 4 through the real RPC handlers: history reads, bind, retry/reparse (real database)."""

from __future__ import annotations

import asyncio

from loguru import logger

from src.rpc import ingest as rpc_ingest
from src.rpc import logs as rpc_logs
from tests._ingest_support import open_environment
from tests.ingest_seed import build_document
from tests.test_ingest_binding_db import new_case, process_job, submit
from tests.test_ingest_replacement_db import with_stat_values

ROOT = {"sub": 1, "username": "root", "is_superuser": True, "roles": ["admin"], "workspaces": []}
NOBODY = {"sub": 2, "username": "nobody", "is_superuser": False, "workspaces": []}


class _Broker:
    def __init__(self) -> None:
        self.handlers = {}

    def subscriber(self, name, **_):
        def decorate(fn):
            self.handlers[name] = fn
            return fn

        return decorate


def run(ingest_database, monkeypatch, scenario):
    url, seeded = ingest_database

    async def go():
        async with open_environment(url, seeded) as env:
            broker = _Broker()
            for module in (rpc_ingest, rpc_logs):
                monkeypatch.setattr(module, "_SF", env.sf)
                monkeypatch.setattr(module._clients, "s3_client", env.s3)
            rpc_ingest.register(broker, logger)
            rpc_logs.register(broker, logger)

            def call(subject, **data):
                return broker.handlers[subject](data, None)

            await scenario(env, call)

    asyncio.run(go())


def unknown_document(case, external_id):
    doc = build_document(case, external_id=external_id)
    for index, person in enumerate(doc["participants"]):
        person["identity"] = {"provider": case.provider, "id": f"Nobody{index}#{6500 + index}"}
    return doc


def code_of(reply):
    """The refusal's machine code: the first detail field, else the envelope's status-derived code."""
    error = reply["error"]
    fields = (error.get("details") or {}).get("fields")
    return fields[0]["code"] if fields else error["code"]


async def history_item(call, case, job_id):
    reply = await call(
        "rpc.parser.logs.history", identity=ROOT, query={"workspace_id": [str(case.workspace_id)], "limit": ["200"]}
    )
    assert reply["ok"], reply
    (item,) = [row for row in reply["data"]["items"] if row["id"] == job_id]
    return item


def test_history_bind_and_reparse_flow_through_the_rpc_surface(ingest_database, monkeypatch):
    async def scenario(env, call):
        case = await new_case(env, "rpc")
        job_id = await submit(env, case, unknown_document(case, "rpc-1"))
        assert await process_job(env, job_id)

        parked = await history_item(call, case, job_id)
        assert parked["status"] == "awaiting_link" and parked["observation_revision"] is None
        assert parked["is_current_provenance"] is False
        assert parked["error"]["code"] == "awaiting_link" and parked["error_message"] == parked["error"]["message"]
        assert [(team["key"], team["source_position"]) for team in parked["teams"]] == [("t1", 1), ("t2", 2)]
        assert all(team["participants"] for team in parked["teams"])

        teams = {f"t{i + 1}": seat for i, seat in enumerate(case.team_ids)}
        denied = await call(
            "rpc.stats.ingest.bind",
            identity=NOBODY,
            id=str(job_id),
            payload={"encounter_game_id": case.game_id, "teams": teams},
        )
        assert denied["ok"] is False
        invalid = await call("rpc.stats.ingest.bind", identity=ROOT, id=str(job_id), payload={"teams": teams})
        assert invalid["ok"] is False and code_of(invalid) == "invalid_request"
        bound = await call(
            "rpc.stats.ingest.bind",
            identity=ROOT,
            id=str(job_id),
            payload={"encounter_game_id": case.game_id, "teams": teams},
        )
        assert bound["ok"] is True and bound["data"]["status"] == "done" and bound["data"]["binding"]["revision"] == 1

        done = await history_item(call, case, job_id)
        assert done["observation_revision"] == 1 and done["is_current_provenance"] is True and done["teams"] == []
        assert done["error"] is None and done["error_message"] is None

        plain = await call("rpc.parser.logs.retry", identity=ROOT, id=str(job_id), payload={})
        assert plain["ok"] is False and "reparse_required" in str(plain["error"])
        missing = await call("rpc.parser.logs.retry", identity=ROOT, id=str(job_id), payload={"reparse": True})
        assert missing["ok"] is False
        stale = await call(
            "rpc.parser.logs.retry", identity=ROOT, id=str(job_id), payload={"reparse": True, "expected_revision": 7}
        )
        assert stale["ok"] is False and code_of(stale) == "stale_revision"
        again = await call(
            "rpc.parser.logs.retry", identity=ROOT, id=str(job_id), payload={"reparse": True, "expected_revision": 1}
        )
        assert again["ok"] is True and again["data"]["observation_revision"] == 2
        assert again["data"]["status"] == "done"

        # a newer document supersedes the job: the old job is no longer current provenance, so its reparse is stale
        newer = await submit(env, case, with_stat_values(case, "rpc-2", 5))
        assert await process_job(env, newer)
        old = await history_item(call, case, job_id)
        assert old["is_current_provenance"] is False and old["observation_revision"] is None
        superseded = await call(
            "rpc.parser.logs.retry", identity=ROOT, id=str(job_id), payload={"reparse": True, "expected_revision": 3}
        )
        assert superseded["ok"] is False and code_of(superseded) == "stale_binding"

    run(ingest_database, monkeypatch, scenario)
