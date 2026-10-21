from __future__ import annotations

import importlib
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase, TestCase
from unittest.mock import AsyncMock, patch

backend_root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(backend_root))
sys.path.insert(0, str(backend_root / "analytics-service"))


job_runner = importlib.import_module("src.worker.job_runner")
job_service = importlib.import_module("src.core.jobs")
tournament_events = importlib.import_module("src.worker.tournament_events")

from shared.core.errors import BaseAPIException  # noqa: E402
from shared.jobs import JobConflict  # noqa: E402
from shared.schemas.events import TournamentStateChangedEvent  # noqa: E402


def _job() -> SimpleNamespace:
    return SimpleNamespace(
        id=10,
        workspace_id=1,
        tournament_id=7,
        requested_by_user_id=5,
        kind=job_runner.JOB_KIND_COMPUTE,
        status="pending",
        progress={},
        algorithms=None,
        training_workspace_ids=None,
    )


class _ExpiringJob:
    def __init__(self) -> None:
        self._expired = False
        self._id = 10
        self.workspace_id = 1
        self.tournament_id = 7
        self.requested_by_user_id = 5
        self.kind = job_runner.JOB_KIND_TRAIN_ML
        self.status = "pending"
        self.progress = {}
        self.algorithms = None
        self.training_workspace_ids = None

    @property
    def id(self) -> int:
        if self._expired:
            raise RuntimeError("expired ORM attribute access")
        return self._id

    def expire(self) -> None:
        self._expired = True


class AnalyticsJobRunnerFailureTests(IsolatedAsyncioTestCase):
    async def test_run_job_rolls_back_before_marking_job_failed(self) -> None:
        job = _job()
        session = SimpleNamespace(rollback=AsyncMock(), commit=AsyncMock())

        with (
            patch.object(job_runner.runner_service.runtime, "get", AsyncMock(side_effect=[job, job, job])),
            patch.object(job_runner.runner_service.runtime, "mark_running", AsyncMock()),
            patch.object(job_runner.runner_service, "_emit", AsyncMock()),
            patch.object(job_runner.runner_service, "_run_compute", AsyncMock(side_effect=RuntimeError("boom"))),
            patch.object(job_runner.runner_service.runtime, "mark_failed", AsyncMock()) as mark_failed,
        ):
            await job_runner.runner_service.run_job(session, job.id)

        session.rollback.assert_awaited()
        mark_failed.assert_awaited_once()
        self.assertIn("boom", mark_failed.await_args.kwargs["error"])

    async def test_run_job_uses_cached_job_id_after_inner_rollback_expires_orm_object(self) -> None:
        job = _ExpiringJob()
        session = SimpleNamespace(rollback=AsyncMock(), commit=AsyncMock())

        async def fail_train(*_args, **_kwargs) -> None:
            job.expire()
            raise RuntimeError("lightgbm exploded")

        with (
            patch.object(job_runner.runner_service.runtime, "get", AsyncMock(return_value=job)),
            patch.object(job_runner.runner_service.runtime, "mark_running", AsyncMock()),
            patch.object(job_runner.runner_service, "_emit", AsyncMock()),
            patch.object(job_runner.runner_service, "_run_train_ml", AsyncMock(side_effect=fail_train)),
            patch.object(job_runner.runner_service.runtime, "mark_failed", AsyncMock()) as mark_failed,
        ):
            await job_runner.runner_service.run_job(session, 10)

        mark_failed.assert_awaited_once()
        self.assertEqual(10, mark_failed.await_args.args[1])
        self.assertIn("lightgbm exploded", mark_failed.await_args.kwargs["error"])

    async def test_run_job_skips_a_finished_job_and_resumes_a_running_one(self) -> None:
        # Outbox replay must not run a finished job again; a redelivered ``running`` job is a crashed attempt.
        for status, runs in (("succeeded", 0), ("failed", 0), ("running", 1)):
            job = _job()
            job.status = status
            with (
                patch.object(job_runner.runner_service.runtime, "get", AsyncMock(return_value=job)),
                patch.object(job_runner.runner_service.runtime, "mark_running", AsyncMock()),
                patch.object(job_runner.runner_service.runtime, "mark_succeeded", AsyncMock()),
                patch.object(job_runner.runner_service, "_emit", AsyncMock()),
                patch.object(job_runner.runner_service, "_run_compute", AsyncMock()) as run_compute,
            ):
                await job_runner.runner_service.run_job(SimpleNamespace(commit=AsyncMock()), job.id)

            self.assertEqual(runs, run_compute.await_count, status)

    async def test_compute_stage_rolls_back_before_failed_progress_update(self) -> None:
        job = _job()
        session = SimpleNamespace(rollback=AsyncMock())

        with (
            patch.object(job_runner, "update_progress", AsyncMock()) as update_progress,
            patch.object(job_runner.runner_service.runtime, "get", AsyncMock(return_value=job)),
            patch.object(job_runner.runner_service, "_emit", AsyncMock()),
            patch.object(
                job_runner.flows_service,
                "recalculate_analytics",
                AsyncMock(side_effect=RuntimeError("ratings exploded")),
            ),
        ):
            with self.assertRaises(RuntimeError):
                await job_runner.runner_service._run_compute(session, job)

        session.rollback.assert_awaited()
        failed_updates = [call for call in update_progress.await_args_list if call.kwargs.get("state") == "failed"]
        self.assertEqual(1, len(failed_updates))
        self.assertEqual("ratings_recalc", failed_updates[0].kwargs["stage"])

    async def test_train_job_uses_training_workspace_ids_as_sample_scope(self) -> None:
        job = _job()
        job.kind = job_runner.JOB_KIND_TRAIN_ML
        job.training_workspace_ids = [1, 3]
        session = SimpleNamespace(rollback=AsyncMock())

        with (
            patch.object(job_runner, "update_progress", AsyncMock()),
            patch.object(job_runner.runner_service.runtime, "get", AsyncMock(return_value=job)),
            patch.object(job_runner.runner_service, "_emit", AsyncMock()),
            patch.object(job_runner, "train_all_models", AsyncMock(return_value={})) as train_all,
        ):
            await job_runner.runner_service._run_train_ml(session, job)

        train_all.assert_awaited_once_with(
            session,
            cutoff_tournament_id=job.tournament_id,
            model_kinds=None,
            workspace_id=None,
            workspace_ids=[1, 3],
        )


class AnalyticsJobServiceTests(TestCase):
    def test_failed_progress_stage_marks_job_as_reconcilable(self) -> None:
        self.assertTrue(
            job_service._progress_has_failed_stage({"ml_inference": {"state": "failed", "detail": {"error": "boom"}}})
        )
        self.assertFalse(job_service._progress_has_failed_stage({"ml_inference": {"state": "running"}}))


class AnalyticsJobDispatchTests(IsolatedAsyncioTestCase):
    async def test_the_dispatch_event_commits_with_the_job_row(self) -> None:
        calls: list = []
        session = SimpleNamespace(commit=AsyncMock(side_effect=lambda: calls.append("commit")))

        async def enqueue(session, event, *, exchange, routing_key):
            calls.append((event.job_id, event.event_id, exchange, routing_key))

        with (
            patch.object(job_service, "reconcile_failed_active_jobs", AsyncMock()),
            patch.object(job_service.job_runtime, "create", AsyncMock(return_value=SimpleNamespace(id=42))),
            patch.object(job_service, "enqueue_outbox_event", enqueue),
        ):
            await job_service.create_analytics_job(
                session, workspace_id=1, tournament_id=7, kind="compute", algorithms=None, requested_by_user_id=None
            )

        self.assertEqual([(42, "analytics_job:42", "", "analytics_job"), "commit"], calls)

    async def test_a_completed_tournament_gets_a_compute_job_and_a_refusal_is_a_skip(self) -> None:
        def changed(old: str, new: str) -> TournamentStateChangedEvent:
            return TournamentStateChangedEvent(tournament_id=7, workspace_id=1, old_status=old, new_status=new)

        admit = tournament_events.admit_completed_tournament
        create = AsyncMock(return_value=SimpleNamespace(id=5))
        verified = AsyncMock()
        with (
            patch.object(tournament_events, "require_verified_workspace", verified),
            patch.object(tournament_events, "require_analytics_owner", AsyncMock()),
            patch.object(tournament_events, "create_analytics_job", create),
        ):
            self.assertEqual("ignored", await admit(None, changed("live", "playoffs")))
            self.assertEqual("ignored", await admit(None, changed("archived", "completed")))
            self.assertEqual("created job 5", await admit(None, changed("playoffs", "completed")))
            create.assert_awaited_once_with(
                None, workspace_id=1, tournament_id=7, kind="compute", algorithms=None, requested_by_user_id=None
            )

            create.side_effect = JobConflict(3)
            self.assertIn("skipped", await admit(None, changed("live", "completed")))

            verified.side_effect = BaseAPIException(status_code=403, detail="workspace_not_verified")
            self.assertEqual("skipped: workspace_not_verified", await admit(None, changed("live", "completed")))
            self.assertEqual(2, create.await_count)
