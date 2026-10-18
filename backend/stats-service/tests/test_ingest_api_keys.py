"""Workspace-key authorization of canonical ingest against real ``auth.api_key`` rows.

The keys are created by identity-service's ``ApiKeyService`` and resolved by its real ``validate_token`` handler (see
``_identity_world``); the worker then rehydrates the identity exactly as the RPC layer does. A rejection must leave
SQL and S3 unchanged.
"""

from __future__ import annotations

import asyncio

import pytest

from src.services.ingest import jobs
from tests._ingest_support import (
    body,
    counts,
    make_doc,
    open_environment,
    user_of,
)


def run(database, scenario):
    url, seeded = database

    async def go():
        async with open_environment(url, seeded) as env:
            await scenario(env)

    asyncio.run(go())


async def refused(env, label, doc, *, status, code):
    before = await counts(env)
    with pytest.raises(jobs.IngestRejected) as caught:
        async with env.sf() as session:
            await jobs.submit_document(session, raw=body(doc), user=user_of(env, label), s3=env.s3)
    assert (caught.value.status_code, caught.value.code) == (status, code), caught.value.detail
    assert await counts(env) == before


def test_the_key_with_the_scope_and_owner_permission_is_accepted_in_its_own_workspace(ingest_database):
    async def scenario(env):
        async with env.sf() as session:
            job = await jobs.submit_document(session, raw=body(make_doc()), user=user_of(env, "ok"), s3=env.s3)
        assert job.workspace_id == env.ws["A"] and job.status == "pending" and job.binding is None
        state = await counts(env)
        assert state["jobs"] == 1 and state["outbox"] >= 1
        assert [k.split("/")[:2] for k in state["objects"]] == [["stats", "documents"], ["stats", "raw"]]

    run(ingest_database, scenario)


def test_identity_that_is_not_a_scoped_real_key_is_refused(ingest_database):
    async def scenario(env):
        doc = make_doc()
        await refused(env, "session", doc, status=403, code="api_key_required")
        await refused(env, "no_scope", doc, status=403, code="scope_required")
        # The key still carries the literal scope, but its owner lost the effective permission.
        assert "stats.ingest" in env.keys["removed"]["identity"]["api_key"]["scopes"]
        await refused(env, "removed", doc, status=403, code="scope_required")
        # An owner deny removes the permission from the key's effective rights.
        await refused(env, "denied", doc, status=403, code="scope_required")

    run(ingest_database, scenario)


def test_unusable_credentials_never_become_an_identity(ingest_database):
    _, seeded = ingest_database
    keys = seeded.world["keys"]
    for label in ("expired", "revoked", "inactive"):
        assert keys[label]["identity"] is None, label


def test_owner_permission_gates_key_issue_itself(ingest_database):
    _, seeded = ingest_database
    refusal = seeded.world["create_refused"]
    assert refusal["status"] == 403 and "stats.ingest" in refusal["detail"]


def test_disabled_discipline_and_foreign_objects_are_refused_without_effects(ingest_database):
    async def scenario(env):
        await refused(env, "lol_only", make_doc(), status=403, code="discipline_disabled")
        # Hints name workspace B objects; the key (and even a superuser key) belongs to another workspace.
        foreign = {"hint": {"tournament_id": env.ids["B"]["tournament"]}}
        await refused(env, "ok", make_doc(**foreign), status=404, code="binding_target_not_found")
        await refused(
            env,
            "ok",
            make_doc(hint={"encounter_game_id": env.ids["B"]["game"]}),
            status=404,
            code="binding_target_not_found",
        )
        await refused(
            env,
            "super",
            make_doc(hint={"tournament_id": env.ids["A"]["tournament"]}),
            status=404,
            code="binding_target_not_found",
        )
        # The superuser-backed key is accepted only in its own workspace B.
        async with env.sf() as session:
            job = await jobs.submit_document(
                session, raw=body(make_doc("sup-1")), user=user_of(env, "super"), s3=env.s3
            )
        assert job.workspace_id == env.ws["B"]

    run(ingest_database, scenario)


def test_job_reads_stay_inside_the_keys_workspace(ingest_database):
    async def scenario(env):
        async with env.sf() as session:
            job = await jobs.submit_document(session, raw=body(make_doc()), user=user_of(env, "ok"), s3=env.s3)
        async with env.sf() as session:
            assert (await jobs.get_ingest_job(session, job_id=job.id, user=user_of(env, "ok"))).id == job.id
        for label, code in (
            ("super", "ingest_job_not_found"),
            ("session", "api_key_required"),
            ("no_scope", "scope_required"),
        ):
            with pytest.raises(jobs.IngestRejected) as caught:
                async with env.sf() as session:
                    await jobs.get_ingest_job(session, job_id=job.id, user=user_of(env, label))
            assert caught.value.code == code
        with pytest.raises(jobs.IngestRejected) as caught:
            async with env.sf() as session:
                await jobs.get_ingest_job(session, job_id=job.id + 10_000, user=user_of(env, "ok"))
        assert caught.value.code == "ingest_job_not_found"

    run(ingest_database, scenario)
