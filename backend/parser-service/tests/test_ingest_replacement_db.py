"""Task 4 atomic observation replacement, revisions, evidence and the match.ingested outbox (real PostgreSQL).

Independent sessions and barriers drive simultaneous replacements; failures are injected at the real repository flush
boundary; assertions read the native tables, the outbox and the audit journal back.
"""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from unittest.mock import patch

import pytest
import sqlalchemy as sa

from shared import models
from shared.repository import stats as stats_repository
from shared.services.stats_evidence import capture_stats_evidence, owner_scopes
from src.services.ingest import jobs, process, writer
from src.services.ingest.jobs import IngestRejected
from tests._ingest_support import open_environment
from tests.ingest_seed import (
    build_document,
    count_revision_events,
    observation_snapshot,
)
from tests.test_ingest_binding_db import admin, job_row, new_case, process_job, snapshot, submit

Status = models.IngestJobStatus


class InjectedWriteFailure(RuntimeError):
    """Raised at the real repository flush boundary."""


def run(ingest_database, scenario):
    url, seeded = ingest_database

    async def main():
        async with open_environment(url, seeded) as env:
            return await scenario(env)

    return asyncio.run(main())


@asynccontextmanager
async def db(env):
    async with env.sf() as session:
        yield session


def with_stat_values(case, external_id, offset):
    doc = build_document(case, external_id=external_id)
    for fact in doc["facts"]:
        if "participant" in fact:
            fact["value"] += offset
    return doc


async def run_replacement_with_failure(env, job_id, *, fail_at):
    """The production service in its own transaction while only the named real boundary is patched."""
    real_insert = stats_repository._bulk_insert

    async def failing_insert(session, model, rows):
        if fail_at == "after_delete" and model is models.StatsFact:
            raise InjectedWriteFailure("flush failed after the delete")
        return await real_insert(session, model, rows)

    real_enqueue = writer.enqueue_outbox_event

    async def failing_enqueue(session, event, **kwargs):
        if fail_at == "before_outbox" and getattr(event, "event_type", "") == "match_ingested":
            raise InjectedWriteFailure("outbox failed before commit")
        return await real_enqueue(session, event, **kwargs)

    with (
        patch.object(stats_repository, "_bulk_insert", failing_insert),
        patch.object(writer, "enqueue_outbox_event", failing_enqueue),
    ):
        async with db(env) as session:
            return await process.process_ingest_job(session, job_id, env.s3, is_raise=True)


async def audit_operations(env, workspace_id):
    async with db(env) as session:
        rows = (
            await session.execute(
                sa.select(models.AuditLog.entity_type, models.AuditLog.entity_id, models.AuditLog.after_json)
                .where(models.AuditLog.workspace_id == workspace_id)
                .order_by(models.AuditLog.id)
            )
        ).all()
    return [
        (entity_type, entity_id, (after or {}).get("stats_evidence", {}).get("operation"))
        for entity_type, entity_id, after in rows
        if (after or {}).get("stats_evidence")
    ]


def test_first_publication_stages_disjoint_match_and_job_audits_and_one_event(ingest_database):
    async def scenario(env):
        case = await new_case(env, "audit")
        job_id = await submit(env, case)
        assert await process_job(env, job_id) == Status.DONE
        snap = await snapshot(env, case)
        operations = await audit_operations(env, case.workspace_id)
        assert ("stats_match", snap["match_id"], "stats.reparse") in operations
        assert ("ingest_job", job_id, "stats.job_transition") in operations
        # the match audit never mentions the job owner and vice versa: two disjoint records
        async with db(env) as session:
            rows = (
                await session.execute(
                    sa.select(models.AuditLog.entity_type, models.AuditLog.after_json).where(
                        models.AuditLog.workspace_id == case.workspace_id,
                        models.AuditLog.entity_type.in_(["stats_match", "ingest_job"]),
                    )
                )
            ).all()
        for _entity_type, after in rows:
            kinds = {state["owner_kind"] for state in after["stats_evidence"]["states"]}
            if after["stats_evidence"]["operation"] == "stats.reparse":
                assert kinds == {"match"}
            elif after["stats_evidence"]["operation"] == "stats.job_transition":
                assert kinds == {"job"}
        async with db(env) as session:
            assert await count_revision_events(session, snap["match_id"], 1) == 1
            event = (
                await session.scalars(
                    sa.select(models.EventOutbox).where(
                        models.EventOutbox.event_id == f"match.ingested:{snap['match_id']}:1"
                    )
                )
            ).one()
        assert event.exchange == "match.ingested" and event.routing_key == "match.ingested"
        payload = event.payload_json
        assert payload["ingest_job_id"] == job_id and payload["encounter_game_id"] == case.game_id
        assert payload["evidence_id"] == snap["match_id"] and payload["revision"] == 1
        assert payload["placements"] == [
            {"encounter_team_id": seat, "placement": index + 1} for index, seat in enumerate(case.team_ids)
        ]
        assert payload["extra_participants"] == []
        assert set(payload) >= {"basis_game_result_version", "workspace_id", "discipline", "encounter_id"}

    run(ingest_database, scenario)


def test_a_distinct_document_replaces_atomically_and_a_replayed_job_does_not(ingest_database):
    async def scenario(env):
        case = await new_case(env, "replace")
        first = await submit(env, case, with_stat_values(case, "rep-1", 0))
        assert await process_job(env, first) == Status.DONE
        one = await snapshot(env, case)
        # redelivery of the completed job: no revision, no event
        assert await process_job(env, first) == Status.DONE
        assert await snapshot(env, case) == one

        second = await submit(env, case, with_stat_values(case, "rep-2", 10))
        assert await process_job(env, second) == Status.DONE
        two = await snapshot(env, case)
        assert two["revision"] == 2 and two["match_id"] == one["match_id"] and two["ingest_job_id"] == second
        assert [fact["value"] for fact in two["facts"]] != [fact["value"] for fact in one["facts"]]
        async with db(env) as session:
            assert await count_revision_events(session, one["match_id"], 2) == 1

        # an old job's re-delivery cannot replace the newer evidence, and its explicit reparse is stale
        assert await process_job(env, first) == Status.DONE
        assert (await snapshot(env, case)) == two
        async with db(env) as session:
            with pytest.raises(IngestRejected) as stale:
                await process.reparse_ingest_job(
                    session, job_id=first, expected_revision=2, user=admin(case), s3=env.s3
                )
            assert stale.value.code == "stale_binding"

    run(ingest_database, scenario)


def test_explicit_reparse_requires_the_seen_revision_and_replaces_with_the_same_mapping(ingest_database):
    async def scenario(env):
        case = await new_case(env, "reparse", teams=3)
        job_id = await submit(env, case)
        assert await process_job(env, job_id) == Status.DONE
        one = await snapshot(env, case)
        async with db(env) as session:
            before = await capture_stats_evidence(session, scopes=owner_scopes("match", (one["match_id"],)))
        async with db(env) as session:
            with pytest.raises(IngestRejected) as stale:
                await process.reparse_ingest_job(
                    session, job_id=job_id, expected_revision=5, user=admin(case), s3=env.s3
                )
            assert stale.value.code == "stale_revision"
        assert await snapshot(env, case) == one

        async with db(env) as session:
            read = await process.reparse_ingest_job(
                session, job_id=job_id, expected_revision=1, user=admin(case), s3=env.s3
            )
        assert read.status == Status.DONE and read.binding.revision == 2
        two = await snapshot(env, case)
        assert two["teams"] == one["teams"] and two["players"] == one["players"] and two["facts"] == one["facts"]
        assert two["revision"] == 2
        async with db(env) as session:
            after = await capture_stats_evidence(session, scopes=owner_scopes("match", (one["match_id"],)))

        def header(states):
            return [state for state in states if state["subset"] == "header"]

        assert header(before) == header(after), "bind/reparse never rebinds the immutable header"
        async with db(env) as session:
            assert await count_revision_events(session, one["match_id"], 2) == 1

    run(ingest_database, scenario)


@pytest.mark.parametrize("fail_at", ["after_delete", "before_outbox"])
def test_failure_inside_replacement_leaves_the_old_revision_and_no_success_trace(ingest_database, fail_at):
    async def scenario(env):
        case = await new_case(env, f"fail-{fail_at}")
        first = await submit(env, case, with_stat_values(case, "fail-1", 0))
        assert await process_job(env, first) == Status.DONE
        old = await snapshot(env, case)
        operations = await audit_operations(env, case.workspace_id)
        second = await submit(env, case, with_stat_values(case, "fail-2", 10))

        with pytest.raises(InjectedWriteFailure):
            await run_replacement_with_failure(env, second, fail_at=fail_at)

        assert await snapshot(env, case) == old
        async with db(env) as session:
            assert await count_revision_events(session, old["match_id"], old["revision"] + 1) == 0
        # only the fenced failed-job transition of the attempt is recorded: no second stats.reparse
        after = await audit_operations(env, case.workspace_id)
        new = after[len(operations) :]
        assert ("stats_match", old["match_id"], "stats.reparse") not in new
        assert {entry[2] for entry in new} <= {"stats.job_transition", "stats.reference_update"}, new
        assert {entry[1] for entry in new if entry[0] == "ingest_job"} == {second}, new
        failed = await job_row(env, second)
        assert failed.status == Status.FAILED
        assert jobs.decode_error(failed.error_message).code == "internal_error"

    run(ingest_database, scenario)


def test_simultaneous_distinct_replacements_serialize_into_consecutive_complete_revisions(ingest_database):
    async def scenario(env):
        case = await new_case(env, "race")
        first = await submit(env, case, with_stat_values(case, "race-1", 0))
        second = await submit(env, case, with_stat_values(case, "race-2", 10))
        barrier = asyncio.Barrier(2)
        real_lock = writer.lock_owners

        async def gated_lock(*args, **kwargs):
            await barrier.wait()  # both transactions reach the final locks together
            return await real_lock(*args, **kwargs)

        with patch.object(process, "lock_owners", gated_lock):
            statuses = await asyncio.gather(process_job(env, first), process_job(env, second))
        assert statuses == [Status.DONE, Status.DONE]
        final = await snapshot(env, case)
        assert final["revision"] == 2
        winner = final["ingest_job_id"]
        assert winner in {first, second}
        # one document's facts, entirely: the winner's values, none of the other's
        offset = 0 if winner == first else 10
        expected = sorted(
            float(fact["value"] + (offset if "participant" in fact else 0)) for fact in build_document(case)["facts"]
        )
        assert sorted(fact["value"] for fact in final["facts"]) == expected
        async with db(env) as session:
            assert await count_revision_events(session, final["match_id"], 1) == 1
            assert await count_revision_events(session, final["match_id"], 2) == 1
            events = await session.scalar(
                sa.select(sa.func.count())
                .select_from(models.EventOutbox)
                .where(
                    models.EventOutbox.event_type == "match_ingested",
                    models.EventOutbox.payload_json["evidence_id"].as_integer() == final["match_id"],
                )
            )
            assert events == 2

    run(ingest_database, scenario)


def test_a_reader_never_observes_a_partially_replaced_revision(ingest_database):
    async def scenario(env):
        case = await new_case(env, "reader")
        first = await submit(env, case, with_stat_values(case, "read-1", 0))
        assert await process_job(env, first) == Status.DONE
        old = await snapshot(env, case)
        second = await submit(env, case, with_stat_values(case, "read-2", 10))
        real_insert = stats_repository._bulk_insert
        started = asyncio.Event()

        async def slow_insert(session, model, rows):
            started.set()
            await asyncio.sleep(0.4)  # the replacement is mid-flight: deleted, partly inserted
            return await real_insert(session, model, rows)

        seen = []

        async def reader():
            await started.wait()
            for _ in range(10):
                async with db(env) as session:
                    seen.append(await observation_snapshot(session, case.game_id))
                await asyncio.sleep(0.05)

        with patch.object(stats_repository, "_bulk_insert", slow_insert):
            status, _ = await asyncio.gather(process_job(env, second), reader())
        assert status == Status.DONE
        new = await snapshot(env, case)
        assert new["revision"] == 2
        for observed in seen:
            assert observed in (old, new), "a reader saw neither the complete old nor the complete new observation"
        assert old in seen

    run(ingest_database, scenario)


def test_removed_member_keeps_observations_and_is_not_revived(ingest_database):
    async def scenario(env):
        case = await new_case(env, "removed")
        async with db(env) as session:
            removed_member = case.member_ids[0][1]
            await session.execute(
                sa.update(models.WorkspaceMember)
                .where(models.WorkspaceMember.id == removed_member)
                .values(removed_at=sa.func.now())
            )
            stamped = await session.scalar(
                sa.select(models.WorkspaceMember.removed_at).where(models.WorkspaceMember.id == removed_member)
            )
            await session.commit()
        assert await process_job(env, await submit(env, case)) == Status.DONE
        async with db(env) as session:
            row = await session.scalar(
                sa.select(models.WorkspaceMember.removed_at).where(models.WorkspaceMember.id == removed_member)
            )
            assert row == stamped
        snap = await snapshot(env, case)
        assert removed_member in {player["workspace_member_id"] for player in snap["players"]}

    run(ingest_database, scenario)


def test_extra_participants_are_the_members_the_bound_roster_lacks(ingest_database):
    async def scenario(env):
        case = await new_case(env, "extra")
        doc = build_document(case, external_id="extra-1")
        doc["participants"].append(
            {
                "key": "sub",
                "team": "t2",
                "identity": {"provider": case.provider, "id": "Substitute#8001"},
                "role": dict(case.role),
            }
        )
        assert await process_job(env, await submit(env, case, doc)) == Status.DONE
        snap = await snapshot(env, case)
        async with db(env) as session:
            event = (
                await session.scalars(
                    sa.select(models.EventOutbox).where(
                        models.EventOutbox.event_id == f"match.ingested:{snap['match_id']}:1"
                    )
                )
            ).one()
            sub_member = await session.scalar(
                sa.select(models.WorkspaceMember.id)
                .join(models.SocialAccount, models.SocialAccount.user_id == models.WorkspaceMember.player_id)
                .where(
                    models.WorkspaceMember.workspace_id == case.workspace_id,
                    models.SocialAccount.username_normalized == "substitute#8001",
                )
            )
        (extra,) = event.payload_json["extra_participants"]
        assert extra["encounter_team_id"] == case.team_ids[1] and extra["workspace_member_id"] == sub_member
        assert extra["handle_snapshot"] == "Substitute#8001"
        assert extra["observed_role"]["dimension"] == case.role["dimension"]
        assert extra["observed_role"]["role"] == case.role["role"]
        assert "observed_role_id" not in extra

    run(ingest_database, scenario)


def test_two_reparses_prepared_at_one_revision_second_gets_stale_revision(ingest_database):
    async def scenario(env):
        case = await new_case(env, "tworeparse")
        job_id = await submit(env, case)
        assert await process_job(env, job_id) == Status.DONE
        barrier = asyncio.Barrier(2)
        real_lock = process.lock_owners

        async def gated_lock(*args, **kwargs):
            await barrier.wait()  # both reparses were prepared against revision 1 and reach the final locks together
            return await real_lock(*args, **kwargs)

        async def reparse():
            async with db(env) as session:
                return await process.reparse_ingest_job(
                    session, job_id=job_id, expected_revision=1, user=admin(case), s3=env.s3
                )

        with patch.object(process, "lock_owners", gated_lock):
            outcomes = await asyncio.gather(reparse(), reparse(), return_exceptions=True)
        won = [o for o in outcomes if not isinstance(o, BaseException)]
        lost = [o for o in outcomes if isinstance(o, BaseException)]
        assert len(won) == 1 and won[0].binding.revision == 2
        assert len(lost) == 1 and isinstance(lost[0], IngestRejected) and lost[0].code == "stale_revision", lost
        snap = await snapshot(env, case)
        assert snap["revision"] == 2
        async with db(env) as session:
            assert await count_revision_events(session, snap["match_id"], 2) == 1

    run(ingest_database, scenario)


async def _make_push(env, case):
    async with db(env) as session:
        push = await session.scalar(
            sa.select(models.CatalogEntity).where(
                models.CatalogEntity.discipline == "overwatch",
                models.CatalogEntity.kind == "mode",
                models.CatalogEntity.slug == "push",
            )
        )
        if push is None:
            push = models.CatalogEntity(discipline="overwatch", kind="mode", slug="push", name="Push", attrs={})
            session.add(push)
            await session.flush()
        (await session.get(models.CatalogEntity, case.map_id)).parent_id = push.id
        await session.commit()


async def _team_scores(env, case):
    async with db(env) as session:
        return sorted(
            await session.scalars(
                sa.select(models.StatsFact.value)
                .join(models.StatDef, models.StatDef.id == models.StatsFact.stat_id)
                .join(models.StatsMatch, models.StatsMatch.id == models.StatsFact.match_id)
                .where(
                    models.StatsMatch.encounter_game_id == case.game_id,
                    models.StatDef.code == "score",
                    models.StatsFact.workspace_member_id.is_(None),
                )
            )
        )


def test_canonical_observations_keep_their_scores_and_only_decoded_ones_are_normalized(ingest_database):
    async def scenario(env):
        case = await new_case(env, "push")
        await _make_push(env, case)
        job_id = await submit(env, case)
        assert await process_job(env, job_id) == Status.DONE
        assert await _team_scores(env, case) == [1.0, 2.0], (
            "a canonical producer's Push scores are exactly as submitted"
        )

        from src.services.match_logs.objectiveless import load_producers, resolve_encounter_maps

        async with db(env) as session:
            producers = await load_producers(session, env.s3, case.encounter_id)
            assert producers == {job_id: "canonical"}
            assert await resolve_encounter_maps(session, case.encounter_id, producers=producers) is False
            await session.commit()
        assert await _team_scores(env, case) == [1.0, 2.0]
        # The same observation read as raw Workshop input is what the normalization is for: it does rewrite it.
        async with db(env) as session:
            assert await resolve_encounter_maps(session, case.encounter_id, producers={job_id: "decoded"}) is True
            await session.commit()
        assert await _team_scores(env, case) != [1.0, 2.0]

    run(ingest_database, scenario)


def test_tournament_wide_processing_never_repends_done_jobs_and_replays_current_ones_by_revision(ingest_database):
    async def scenario(env):
        from src.services.match_logs.log_records import log_records_service

        case = await new_case(env, "bulk")
        hint = {"tournament_id": case.tournament_id}
        first = await submit(env, case, with_stat_values(case, "bulk-1", 0), hint=hint)
        assert await process_job(env, first) == Status.DONE
        second = await submit(env, case, with_stat_values(case, "bulk-2", 10), hint=hint)
        assert await process_job(env, second) == Status.DONE
        pending = await submit(env, case, with_stat_values(case, "bulk-3", 20), hint=hint)
        before = await snapshot(env, case)

        async with db(env) as session:
            requeued = await log_records_service.requeue_tournament(session, case.tournament_id)
        # the superseded job is neither re-pended nor replayed; the current one carries the revision seen now
        assert requeued.queue == [pending], requeued
        assert requeued.replay == {second: 2}
        assert (await job_row(env, first)).status == Status.DONE
        assert (await job_row(env, second)).status == Status.DONE
        assert await snapshot(env, case) == before

        # someone else replaces the game before the replay runs: the captured revision is stale and refuses
        third = await submit(env, case, with_stat_values(case, "bulk-4", 30), hint=hint)
        assert await process_job(env, third) == Status.DONE
        async with db(env) as session:
            with pytest.raises(IngestRejected) as stale:
                await process.reparse_authorized_job(session, job_id=second, expected_revision=2, s3=env.s3)
        assert stale.value.code == "stale_binding"
        assert (await snapshot(env, case))["revision"] == 3

    run(ingest_database, scenario)
