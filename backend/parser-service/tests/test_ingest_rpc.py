"""RPC envelopes of ``rpc.stats.ingest.{submit,get}`` and the published OpenAPI contract.

The handlers run for real (rehydrated identity, real database, real serializers); only S3 is substituted.
"""

from __future__ import annotations

import asyncio
import base64
import json
from pathlib import Path

import pytest
from loguru import logger

from shared.schemas.match_doc import MatchDoc
from src import openapi_docs, openapi_schemas
from src.rpc import ingest as rpc_ingest
from tests._ingest_support import body, make_doc, open_environment

MANIFEST = Path(__file__).resolve().parents[3] / "gateway" / "internal" / "openapi" / "schemas.json"


class _Broker:
    def __init__(self) -> None:
        self.handlers = {}

    def subscriber(self, name):
        def decorate(fn):
            self.handlers[name] = fn
            return fn

        return decorate


def run(database, monkeypatch, scenario):
    url, seeded = database

    async def go():
        async with open_environment(url, seeded) as env:
            broker = _Broker()
            monkeypatch.setattr(rpc_ingest, "_SF", env.sf)
            monkeypatch.setattr(rpc_ingest._clients, "s3_client", env.s3)
            rpc_ingest.register(broker, logger)

            def call(subject, **data):
                return broker.handlers[subject](data, None)

            await scenario(env, call)

    asyncio.run(go())


def identity(env, label="ok"):
    return env.session_identity if label == "session" else env.keys[label]["identity"]


def raw64(raw: bytes) -> str:
    return base64.b64encode(raw).decode()


def test_submit_and_get_return_the_actual_job_in_the_rpc_envelope(ingest_database, monkeypatch):
    async def scenario(env, call):
        reply = await call("rpc.stats.ingest.submit", identity=identity(env), raw_base64=raw64(body(make_doc())))
        assert reply["ok"] is True
        job = reply["data"]
        assert job["status"] == "pending" and job["workspace_id"] == env.ws["A"] and job["binding"] is None
        assert job["error"] is None and job["attempts"] == 0
        assert not {"raw_ref", "document_ref", "api_key_id", "raw_base64", "producer"} & job.keys()
        again = await call("rpc.stats.ingest.submit", identity=identity(env), raw_base64=raw64(body(make_doc())))
        assert again["data"]["id"] == job["id"]
        got = await call("rpc.stats.ingest.get", identity=identity(env), id=str(job["id"]))
        assert got == {"ok": True, "data": job}
        foreign = await call("rpc.stats.ingest.get", identity=identity(env, "super"), id=str(job["id"]))
        assert foreign["ok"] is False and foreign["error"]["code"] == "not_found"

    run(ingest_database, monkeypatch, scenario)


def test_semantic_failure_surfaces_the_job_id_in_error_details(ingest_database, monkeypatch):
    async def scenario(env, call):
        reply = await call(
            "rpc.stats.ingest.submit", identity=identity(env), raw_base64=raw64(body(make_doc("x", map="nowhere")))
        )
        assert reply["ok"] is False and reply["error"]["code"] == "unprocessable"
        details = reply["error"]["details"]
        assert isinstance(details["ingest_job_id"], int)
        assert details["fields"][0]["code"] == "unknown_code"
        assert details["issues"][0]["raw_name"] == "nowhere" and details["issues"][0]["kind"] == "map"
        got = await call("rpc.stats.ingest.get", identity=identity(env), id=str(details["ingest_job_id"]))
        assert got["data"]["status"] == "failed" and got["data"]["error"]["code"] == "unknown_code"

    run(ingest_database, monkeypatch, scenario)


@pytest.mark.parametrize(
    ("data", "code", "field_code"),
    [
        ({"raw_base64": "!!!not base64!!!"}, "bad_request", "invalid_request"),
        ({}, "bad_request", "invalid_request"),
        ({"raw_base64": "A" * ((25 * 1024 * 1024 // 3 + 1) * 4 + 4)}, "payload_too_large", "match_document_too_large"),
    ],
)
def test_malformed_transport_payloads_are_rejected_before_any_work(
    ingest_database, monkeypatch, data, code, field_code
):
    async def scenario(env, call):
        reply = await call("rpc.stats.ingest.submit", identity=identity(env), **data)
        assert reply["ok"] is False and reply["error"]["code"] == code
        assert reply["error"]["details"]["fields"][0]["code"] == field_code
        assert env.s3.objects == {}

    run(ingest_database, monkeypatch, scenario)


def test_identity_comes_only_from_the_trusted_envelope(ingest_database, monkeypatch):
    async def scenario(env, call):
        missing = await call("rpc.stats.ingest.submit", raw_base64=raw64(body(make_doc())))
        assert missing["ok"] is False and missing["error"]["code"] == "unauthorized"
        # Fields smuggled next to the payload (or inside the document) never select a workspace or key.
        smuggled = await call(
            "rpc.stats.ingest.submit",
            identity=identity(env),
            workspace_id=env.ws["B"],
            api_key_id=999,
            raw_base64=raw64(body(make_doc())),
        )
        assert smuggled["data"]["workspace_id"] == env.ws["A"]
        inside = await call(
            "rpc.stats.ingest.submit",
            identity=identity(env),
            raw_base64=raw64(body({**make_doc("y"), "workspace_id": env.ws["B"]})),
        )
        assert inside["ok"] is False and inside["error"]["code"] == "unprocessable"
        denied = await call(
            "rpc.stats.ingest.submit", identity=identity(env, "session"), raw_base64=raw64(body(make_doc("z")))
        )
        assert (
            denied["error"]["code"] == "forbidden"
            and denied["error"]["details"]["fields"][0]["code"] == "api_key_required"
        )

    run(ingest_database, monkeypatch, scenario)


def test_openapi_declares_the_bare_document_never_the_private_transport():
    submit = openapi_schemas.OPERATIONS["rpc.stats.ingest.submit"]
    assert submit.request is MatchDoc
    public = set(MatchDoc.model_json_schema()["properties"])
    assert not {"producer", "raw_base64", "identity", "workspace_id", "api_key_id"} & public
    for subject in ("rpc.stats.ingest.submit", "rpc.stats.ingest.get"):
        assert openapi_docs.DOCS[subject]["summary"] and "stats.ingest" in openapi_docs.DOCS[subject]["description"]
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    operation = manifest["operations"]["rpc.stats.ingest.submit"]
    assert operation["request"]["ref"] == "parser.MatchDoc"
    assert operation["response"]["ref"] == "parser.IngestJobRead"
    assert manifest["operations"]["rpc.stats.ingest.get"]["response"]["ref"] == "parser.IngestJobRead"
    pool = json.dumps(manifest["schemas"])
    assert "raw_base64" not in pool
    assert "producer" not in json.dumps(manifest["schemas"]["parser.MatchDoc"])
