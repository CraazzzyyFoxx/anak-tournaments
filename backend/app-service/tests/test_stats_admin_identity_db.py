"""Native admin identity/provenance transactions against PostgreSQL; no legacy writers."""

from __future__ import annotations

import asyncio
import base64
import copy
import hashlib
from importlib import import_module
from unittest import IsolatedAsyncioTestCase
from unittest.mock import Mock, patch
from uuid import uuid4

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from shared import models
from shared.core.errors import BaseAPIException
from shared.repository.stats import StatsMatchRepository
from shared.testing import configure_test_cache
from shared.testing.db import create_test_async_engine, ensure_test_postgres
from shared.tests.test_stats_integrity_db import seed_native_stats
from src import schemas
from src.rpc import binary
from src.services.admin.user import UserAdminService
from src.services.admin.user_merge import UserMergeService
from src.services.workspace.service import WorkspaceService


class StatsAdminIdentityTests(IsolatedAsyncioTestCase):
    loop_factory = asyncio.SelectorEventLoop

    async def asyncSetUp(self):
        ensure_test_postgres()
        configure_test_cache()
        self.engine = create_test_async_engine()
        self.connection = await self.engine.connect()
        self.transaction = await self.connection.begin()
        self.factory = async_sessionmaker(
            self.connection,
            expire_on_commit=False,
            join_transaction_mode="create_savepoint",
        )
        self.session: AsyncSession = self.factory()
        self.seed = await seed_native_stats(self.session, f"identity-{uuid4().hex[:12]}")
        self.source_id = self.seed["users"][0].id
        self.source_member_id = self.seed["members"][0].id
        target = models.User(name=f"survivor-{uuid4().hex}")
        self.session.add(target)
        await self.session.flush()
        self.target_id = target.id
        self.merges = UserMergeService()
        await self.session.commit()

    async def asyncTearDown(self):
        await self.session.close()
        await self.transaction.rollback()
        await self.connection.close()
        await self.engine.dispose()

    async def _request(self, source_id=None, target_id=None):
        preview = await self.merges.preview_merge(
            self.session,
            schemas.UserMergePreviewRequest(
                source_user_id=source_id or self.source_id,
                target_user_id=target_id or self.target_id,
            ),
        )
        return preview, schemas.UserMergeExecuteRequest(
            source_user_id=preview.source.id,
            target_user_id=preview.target.id,
            preview_fingerprint=preview.preview_fingerprint,
            field_policy={},
            identity_selection={},
        )

    async def _job(self, *, uploader=None, raw_ref="prepared/nested/original-object", filename="display.txt"):
        job = models.IngestJob(
            workspace_id=self.seed["workspace"].id,
            discipline=self.seed["spec"].code,
            source_kind="manual",
            external_id=uuid4().hex,
            content_hash="a" * 64,
            raw_ref=raw_ref,
            filename=filename,
            status=models.IngestJobStatus.DONE,
            uploader_user_id=uploader,
            hint_tournament_id=self.seed["tournament"].id,
        )
        self.session.add(job)
        await self.session.flush()
        return job

    async def _evidence(self, audit_id):
        merge = await self.session.get(models.UserMergeAudit, audit_id)
        original = merge.preview_snapshot_json["stats_evidence"]
        self.assertEqual(self.source_id, original["source_user_id"])
        self.assertEqual(self.target_id, original["target_user_id"])
        self.assertIsNone(merge.source_user_id)
        audits = (
            await self.session.scalars(
                sa.select(models.AuditLog)
                .where(
                    models.AuditLog.id.in_(original["audit_ids"]),
                )
                .order_by(models.AuditLog.id)
            )
        ).all()
        self.assertEqual(len(original["audit_ids"]), len(audits))
        for audit in audits:
            states = audit.before_json["stats_evidence"]["states"]
            self.assertLessEqual(len({(s["owner_kind"], tuple(s["owner_key"])) for s in states}), 100)
            mapping = audit.before_json["stats_evidence"]["identity_map"]
            self.assertLessEqual(len(mapping), 100)
            member_owners = {state["owner_key"][0] for state in states if state["owner_kind"] == "member"}
            if member_owners:
                self.assertEqual(
                    member_owners, {entry[key] for entry in mapping for key in ("source_member_id", "target_member_id")}
                )
            if all(state["owner_kind"] == "job" for state in states):
                self.assertEqual([{"source_user_id": self.source_id, "target_user_id": self.target_id}], mapping)
        return original, audits

    async def test_overlap_preview_and_execute_refuse_without_mutation(self):
        target_id = self.seed["users"][1].id
        preview, request = await self._request(target_id=target_id)
        self.assertEqual(
            [
                {
                    "workspace_id": self.seed["workspace"].id,
                    "source_member_id": self.source_member_id,
                    "target_member_id": self.seed["members"][1].id,
                    "match_id": self.seed["match"].id,
                }
            ],
            preview.conflicts.stats_member_history_conflicts,
        )
        query = sa.select(models.StatsFact.__table__).where(models.StatsFact.match_id == self.seed["match"].id)
        before = (await self.session.execute(query)).all()
        with self.assertRaises(BaseAPIException) as caught:
            await self.merges.execute_merge(self.session, request, operator_auth_user_id=None)
        self.assertEqual(409, caught.exception.status_code)
        self.assertEqual("stats_member_history_conflict", caught.exception.detail)
        self.assertEqual(before, (await self.session.execute(query)).all())
        self.assertIsNotNone(await self.session.get(models.User, self.source_id))
        self.assertEqual(
            0,
            await self.session.scalar(
                sa.select(sa.func.count())
                .select_from(models.UserMergeAudit)
                .where(models.UserMergeAudit.target_user_id == target_id)
            ),
        )

    async def test_move_keeps_member_id_and_complete_audit_map(self):
        job = await self._job(uploader=self.source_id)
        job_id, updated_at = job.id, job.updated_at
        await self.session.commit()
        _, request = await self._request()
        result = await self.merges.execute_merge(self.session, request, operator_auth_user_id=None)
        self.assertEqual(
            self.target_id,
            await self.session.scalar(
                sa.select(models.WorkspaceMember.player_id).where(
                    models.WorkspaceMember.id == self.source_member_id,
                )
            ),
        )
        self.assertEqual(
            self.source_member_id,
            await self.session.scalar(
                sa.select(models.StatsFact.workspace_member_id).where(
                    models.StatsFact.match_id == self.seed["match"].id
                )
            ),
        )
        self.assertEqual(
            self.target_id,
            await self.session.scalar(
                sa.select(models.IngestJob.uploader_user_id).where(
                    models.IngestJob.id == job_id,
                )
            ),
        )
        self.assertEqual(
            updated_at,
            await self.session.scalar(
                sa.select(models.IngestJob.updated_at).where(
                    models.IngestJob.id == job_id,
                )
            ),
        )
        original, audits = await self._evidence(result.audit_id)
        self.assertTrue(audits)
        self.assertEqual(
            [
                {
                    "workspace_id": self.seed["workspace"].id,
                    "source_member_id": self.source_member_id,
                    "target_member_id": self.source_member_id,
                    "mode": "move",
                    "source_user_id": self.source_id,
                    "target_user_id": self.target_id,
                }
            ],
            original["identity_map"],
        )
        self.assertEqual(
            (1, 1, 1, 1),
            tuple(
                result.affected_counts[k]
                for k in (
                    "stats_matches",
                    "stats_players",
                    "stats_facts",
                    "stats_events",
                )
            ),
        )
        await self.session.execute(sa.text("SET CONSTRAINTS ALL IMMEDIATE"))

    async def test_disjoint_histories_repoint_without_losing_values_or_events(self):
        member = models.WorkspaceMember(workspace_id=self.seed["workspace"].id, player_id=self.target_id)
        game = models.EncounterGame(
            encounter_id=self.seed["encounter"].id, position=2, map_id=self.seed["catalog"][0].id
        )
        self.session.add_all([member, game])
        await self.session.flush()
        self.session.add_all(
            [
                models.EncounterGameTeam(
                    game_id=game.id,
                    encounter_id=self.seed["encounter"].id,
                    encounter_team_id=team.id,
                )
                for team in self.seed["participants"]
            ]
        )
        match = models.StatsMatch(
            workspace_id=self.seed["workspace"].id,
            discipline=self.seed["spec"].code,
            encounter_id=self.seed["encounter"].id,
            encounter_game_id=game.id,
            map_entity_id=self.seed["catalog"][0].id,
        )
        self.session.add(match)
        await self.session.flush()
        observations = copy.deepcopy(self.seed["observations"])
        for rows in observations.values():
            for row in rows:
                row["match_id"] = match.id
                for key in ("workspace_member_id", "actor_member_id", "target_member_id"):
                    if row.get(key) == self.source_member_id:
                        row[key] = member.id
        await StatsMatchRepository().replace_observations(self.session, match=match, **observations)
        target_member_id = member.id
        await self.session.commit()
        _, request = await self._request()
        result = await self.merges.execute_merge(self.session, request, operator_auth_user_id=None)
        facts = (
            await self.session.execute(
                sa.select(models.StatsFact.workspace_member_id, models.StatsFact.value).where(
                    models.StatsFact.match_id.in_((self.seed["match"].id, match.id))
                )
            )
        ).all()
        self.assertCountEqual([(target_member_id, 17.5), (target_member_id, 17.5)], facts)
        self.assertEqual(
            [target_member_id, target_member_id],
            list(
                (
                    await self.session.scalars(
                        sa.select(models.StatsEvent.actor_member_id)
                        .where(
                            models.StatsEvent.match_id.in_((self.seed["match"].id, match.id)),
                        )
                        .order_by(models.StatsEvent.id),
                    )
                ).all()
            ),
        )
        self.assertIsNone(
            await self.session.scalar(
                sa.select(models.WorkspaceMember.id).where(
                    models.WorkspaceMember.id == self.source_member_id,
                )
            )
        )
        original, _ = await self._evidence(result.audit_id)
        self.assertEqual("retain", original["identity_map"][0]["mode"])
        self.assertEqual(target_member_id, original["identity_map"][0]["target_member_id"])
        await self.session.execute(sa.text("SET CONSTRAINTS ALL IMMEDIATE"))

    async def test_uploader_only_merge_has_global_pair_and_bounded_job_chunks(self):
        source = models.User(name=f"uploader-{uuid4().hex}")
        self.session.add(source)
        await self.session.flush()
        self.source_id = source.id
        for index in range(101):
            await self._job(uploader=source.id, raw_ref=f"prepared/{index}")
        await self.session.commit()
        _, request = await self._request()
        result = await self.merges.execute_merge(self.session, request, operator_auth_user_id=None)
        original, audits = await self._evidence(result.audit_id)
        self.assertEqual([], original["identity_map"])
        self.assertEqual(2, len(audits))
        for audit in audits:
            self.assertEqual(
                [{"source_user_id": self.source_id, "target_user_id": self.target_id}],
                audit.before_json["stats_evidence"]["identity_map"],
            )
        self.assertEqual(
            101,
            await self.session.scalar(
                sa.select(sa.func.count())
                .select_from(models.IngestJob)
                .where(models.IngestJob.uploader_user_id == self.target_id)
            ),
        )
        self.assertEqual(
            0,
            await self.session.scalar(
                sa.select(sa.func.count())
                .select_from(models.WorkspaceMember)
                .where(models.WorkspaceMember.player_id == self.target_id)
            ),
        )

    async def test_unbound_raw_download_checks_owner_before_source_state_and_bytes(self):
        raw = b"original prepared bytes\x00\xff"
        job = await self._job()
        job.content_hash = hashlib.sha256(raw).hexdigest().upper()
        self.seed["match"].ingest_job_id = job.id
        self.seed["match"].encounter_game_id = None
        self.seed["tournament"].is_hidden = True
        # Source hints are not permission to read the observation's real owner.
        job.hint_tournament_id = None
        await self.session.commit()
        handlers = {}

        class Broker:
            def subscriber(self, subject):
                def register(handler):
                    handlers[subject] = handler
                    return handler

                return register

        binary.register(Broker(), Mock())
        storage = import_module("src.services.workspace.binary")
        accessed = []
        response_bytes = raw

        async def get_object(key):
            accessed.append(key)
            return response_bytes if key == "prepared/nested/original-object" else None

        with patch.object(binary, "_SF", self.factory), patch.object(storage.s3_client, "get_object", get_object):
            handler = handlers["rpc.app.matches.log"]
            denied = await handler({"id": self.seed["match"].id}, None)
            self.assertFalse(denied["ok"])
            self.assertEqual([], accessed)
            foreign = await handler(
                {
                    "id": self.seed["match"].id,
                    "identity": {
                        "user_id": 1,
                        "is_active": True,
                        "workspaces": [{"workspace_id": self.seed["workspace"].id + 1}],
                    },
                },
                None,
            )
            self.assertFalse(foreign["ok"])
            self.assertEqual([], accessed)
            allowed = await handler(
                {
                    "id": self.seed["match"].id,
                    "identity": {
                        "user_id": 1,
                        "is_active": True,
                        "is_superuser": True,
                    },
                },
                None,
            )
            self.assertTrue(allowed["ok"], allowed)
            self.assertEqual(raw, base64.b64decode(allowed["data"]["content_b64"]))
            self.assertEqual("display.txt", allowed["data"]["filename"])
            self.assertEqual(["prepared/nested/original-object"], accessed)
            original_hash = job.content_hash
            for raw_status, content_hash, expected_code in (
                (models.RawSourceStatus.MISSING, original_hash, "not_found"),
                (models.RawSourceStatus.CONFLICT, original_hash, "conflict"),
                (models.RawSourceStatus.UNVERIFIED, original_hash, "conflict"),
                (models.RawSourceStatus.UNVERIFIED, None, "conflict"),
            ):
                with self.subTest(raw_status=raw_status, content_hash=content_hash):
                    job.raw_status = raw_status
                    job.content_hash = content_hash
                    await self.session.commit()
                    accessed.clear()
                    hidden = await handler({"id": self.seed["match"].id}, None)
                    self.assertEqual("not_found", hidden["error"]["code"])
                    refused = await handler(
                        {
                            "id": self.seed["match"].id,
                            "identity": {"user_id": 1, "is_active": True, "is_superuser": True},
                        },
                        None,
                    )
                    self.assertEqual(expected_code, refused["error"]["code"])
                    self.assertEqual([], accessed)

            for content_hash in (None, "unknown"):
                accessed.clear()
                with self.assertRaises(BaseAPIException) as refused:
                    await storage.workspace_binary.fetch_log_bytes(
                        job.raw_ref, raw_status=models.RawSourceStatus.AVAILABLE, content_hash=content_hash
                    )
                self.assertEqual(409, refused.exception.status_code)
                self.assertEqual([], accessed)

            job.raw_status = models.RawSourceStatus.AVAILABLE
            job.content_hash = original_hash
            await self.session.commit()
            for response_bytes, expected_code in (
                (b"corrupted bytes", "conflict"),
                (None, "not_found"),
                (b"", "conflict"),
            ):
                with self.subTest(response_bytes=response_bytes):
                    accessed.clear()
                    refused = await handler(
                        {
                            "id": self.seed["match"].id,
                            "identity": {"user_id": 1, "is_active": True, "is_superuser": True},
                        },
                        None,
                    )
                    self.assertEqual(expected_code, refused["error"]["code"])
                    self.assertEqual(["prepared/nested/original-object"], accessed)
            await self.session.refresh(job)
            self.assertEqual(original_hash, job.content_hash)
            self.assertEqual("prepared/nested/original-object", job.raw_ref)
            self.assertEqual(models.RawSourceStatus.AVAILABLE, job.raw_status)

    async def test_auth_merge_preserves_member_and_chains_key_deletion_before_identity(self):
        from shared.schemas.user_merge_auth import AuthMergeOAuthDestination, AuthMergePolicy

        tag = uuid4().hex
        donor = models.AuthUser(email=f"donor-{tag}@test.invalid", username=f"donor-{tag}", hashed_password="hash")
        survivor = models.AuthUser(
            email=f"survivor-{tag}@test.invalid",
            username=f"survivor-{tag}",
            hashed_password="hash",
        )
        self.session.add_all([donor, survivor])
        await self.session.flush()
        donor_id, survivor_id = donor.id, survivor.id
        oauth = models.OAuthConnection(
            auth_user_id=donor_id,
            provider="discord",
            provider_user_id=tag,
            username=f"oauth-{tag}",
        )
        self.session.add(oauth)
        await self.session.flush()
        oauth_id = oauth.id
        await self.session.execute(
            sa.update(models.User).where(models.User.id == self.source_id).values(auth_user_id=donor_id)
        )
        await self.session.execute(
            sa.update(models.User).where(models.User.id == self.target_id).values(auth_user_id=survivor_id)
        )
        key = models.ApiKey(
            auth_user_id=donor_id,
            workspace_id=self.seed["workspace"].id,
            public_id=tag,
            secret_hash="not-a-real-secret",
            name="Merge key",
        )
        self.session.add(key)
        await self.session.flush()
        job = await self._job(uploader=self.source_id)
        job.api_key_id = key.id
        await self.session.flush()
        key_id, job_id = key.id, job.id
        updated_at = await self.session.scalar(
            sa.select(models.IngestJob.updated_at).where(models.IngestJob.id == job_id)
        )
        await self.session.commit()

        async def request():
            preview = await self.merges.preview_merge(
                self.session,
                schemas.UserMergePreviewRequest(
                    source_user_id=self.source_id,
                    target_user_id=self.target_id,
                    auth_policy=AuthMergePolicy(
                        surviving_auth_user_id=survivor_id,
                        other_account_action="keep",
                        oauth_destinations=[
                            AuthMergeOAuthDestination(connection_id=oauth_id, auth_user_id=survivor_id)
                        ],
                    ),
                ),
            )
            self.assertEqual([], preview.auth_merge.issues)
            return schemas.UserMergeExecuteRequest(
                source_user_id=self.source_id,
                target_user_id=self.target_id,
                preview_fingerprint=preview.preview_fingerprint,
                auth_policy=preview.auth_merge.policy,
                field_policy={},
                identity_selection={},
                confirm_auth_changes=True,
                confirm_permission_changes=True,
            )

        async def unavailable(_result):
            raise RuntimeError("Identity unavailable")

        with self.assertRaisesRegex(RuntimeError, "Identity unavailable"):
            await self.merges.execute_merge(
                self.session,
                await request(),
                operator_auth_user_id=None,
                auth_finalizer=unavailable,
            )
        self.assertEqual(
            self.source_id,
            await self.session.scalar(
                sa.select(models.WorkspaceMember.player_id).where(models.WorkspaceMember.id == self.source_member_id)
            ),
        )
        self.assertEqual(
            key_id,
            await self.session.scalar(sa.select(models.IngestJob.api_key_id).where(models.IngestJob.id == job_id)),
        )
        self.assertIsNotNone(await self.session.get(models.ApiKey, key_id))
        self.assertEqual(
            donor_id,
            await self.session.scalar(
                sa.select(models.OAuthConnection.auth_user_id).where(models.OAuthConnection.id == oauth_id)
            ),
        )
        # Keep real, expired instances in the identity map across the retry:
        # neither OAuth transfer nor its final synchronization may lazy-load IDs.
        for instance in (donor, survivor, oauth):
            self.session.expire(instance)

        async def finalized(result):
            self.assertCountEqual([donor_id, survivor_id], result.affected_auth_user_ids)

        result = await self.merges.execute_merge(
            self.session,
            await request(),
            operator_auth_user_id=None,
            auth_finalizer=finalized,
        )
        self.assertEqual(
            self.target_id,
            await self.session.scalar(
                sa.select(models.WorkspaceMember.player_id).where(models.WorkspaceMember.id == self.source_member_id)
            ),
        )
        self.assertIsNone(
            await self.session.scalar(sa.select(models.IngestJob.api_key_id).where(models.IngestJob.id == job_id))
        )
        self.assertEqual(
            updated_at,
            await self.session.scalar(sa.select(models.IngestJob.updated_at).where(models.IngestJob.id == job_id)),
        )
        self.assertEqual(
            survivor_id,
            await self.session.scalar(
                sa.select(models.OAuthConnection.auth_user_id).where(models.OAuthConnection.id == oauth_id)
            ),
        )
        self.assertEqual([oauth_id], result.auth_merge.moved_oauth_connection_ids)
        original, merge_audits = await self._evidence(result.audit_id)
        self.assertEqual("move", original["identity_map"][0]["mode"])
        key_audits = (
            await self.session.scalars(
                sa.select(models.AuditLog).where(
                    models.AuditLog.action == "stats.owner_delete",
                    models.AuditLog.entity_type == "auth_merge",
                    models.AuditLog.entity_id == self.target_id,
                )
            )
        ).all()
        self.assertTrue(key_audits)
        self.assertLess(max(a.id for a in key_audits), min(a.id for a in merge_audits))
        key_after = {
            s["subset"]: s
            for a in key_audits
            for s in a.after_json["stats_evidence"]["states"]
            if s["owner_kind"] == "job" and s["owner_key"] == [job_id]
        }
        merge_before = {
            s["subset"]: s
            for a in merge_audits
            for s in a.before_json["stats_evidence"]["states"]
            if s["owner_kind"] == "job" and s["owner_key"] == [job_id]
        }
        self.assertEqual(key_after["identity"]["sha256"], merge_before["identity"]["sha256"])
        await self.session.execute(sa.text("SET CONSTRAINTS ALL IMMEDIATE"))

    async def test_alias_breadcrumb_joins_native_job_tournament(self):
        from src.services.admin.catalog_aliases import CatalogAliasService

        job = await self._job()
        miss = models.CatalogAliasMiss(
            discipline=self.seed["spec"].code,
            kind="character",
            raw_name="Unresolved",
            last_ingest_job_id=job.id,
        )
        self.session.add(miss)
        await self.session.flush()
        result = await CatalogAliasService().list_misses(
            self.session,
            schemas.CatalogAliasMissListParams(discipline=self.seed["spec"].code),
        )
        self.assertEqual(1, result["total"])
        self.assertEqual(job.id, result["results"][0].last_ingest_job_id)
        self.assertEqual(self.seed["tournament"].id, result["results"][0].last_log_tournament_id)

    async def test_missing_raw_job_is_not_a_reconstructed_object_key(self):
        service = import_module("src.services.workspace.binary").workspace_binary
        raw_ref, _, tournament_id, raw_status, content_hash = await service.resolve_match_log_ref(
            self.session, self.seed["match"].id
        )
        self.assertEqual(self.seed["tournament"].id, tournament_id)
        with self.assertRaises(BaseAPIException) as caught:
            await service.fetch_log_bytes(raw_ref, raw_status=raw_status, content_hash=content_hash)
        self.assertEqual(404, caught.exception.status_code)

    async def test_member_evidence_chunks_cover_each_original_member_once(self):
        members = [self.source_member_id]
        for index in range(100):
            workspace = models.Workspace(slug=f"merge-{uuid4().hex}", name=f"Merge {index}")
            self.session.add(workspace)
            await self.session.flush()
            member = models.WorkspaceMember(workspace_id=workspace.id, player_id=self.source_id)
            self.session.add(member)
            await self.session.flush()
            members.append(member.id)
            if index % 2 == 0:
                target_member = models.WorkspaceMember(workspace_id=workspace.id, player_id=self.target_id)
                self.session.add(target_member)
                await self.session.flush()
                members.append(target_member.id)
        await self.session.commit()
        _, request = await self._request()
        result = await self.merges.execute_merge(self.session, request, operator_auth_user_id=None)
        original, audits = await self._evidence(result.audit_id)
        self.assertEqual(101, len(original["identity_map"]))
        self.assertEqual(50, sum(entry["mode"] == "retain" for entry in original["identity_map"]))
        self.assertEqual(51, sum(entry["mode"] == "move" for entry in original["identity_map"]))
        observed = [
            state["owner_key"][0]
            for audit in audits
            for state in audit.before_json["stats_evidence"]["states"]
            if state["owner_kind"] == "member"
        ]
        self.assertCountEqual(members, observed)

    async def test_user_delete_preserves_uploader_null_evidence(self):
        source = models.User(name=f"delete-uploader-{uuid4().hex}")
        self.session.add(source)
        await self.session.flush()
        job = await self._job(uploader=source.id)
        user_id, job_id = source.id, job.id
        await self.session.commit()
        await UserAdminService().delete_user(self.session, user_id)
        self.assertIsNone(
            await self.session.scalar(
                sa.select(models.IngestJob.uploader_user_id).where(
                    models.IngestJob.id == job_id,
                )
            )
        )
        audits = (
            await self.session.scalars(
                sa.select(models.AuditLog).where(
                    models.AuditLog.action == "stats.owner_delete",
                    models.AuditLog.entity_id == user_id,
                )
            )
        ).all()
        self.assertTrue(audits)
        self.assertEqual("stats.owner_delete", audits[0].after_json["stats_evidence"]["operation"])

    async def test_workspace_delete_captures_match_disappearance_before_commit(self):
        workspace_id, match_id = self.seed["workspace"].id, self.seed["match"].id
        await WorkspaceService().delete(self.session, self.seed["workspace"])
        audits = (
            await self.session.scalars(
                sa.select(models.AuditLog).where(
                    models.AuditLog.action == "stats.owner_delete",
                    models.AuditLog.entity_id == workspace_id,
                )
            )
        ).all()
        states = [state for audit in audits for state in audit.after_json["stats_evidence"]["states"]]
        self.assertTrue(
            any(
                state["owner_kind"] == "match" and state["owner_key"] == [match_id] and not state["owner_exists"]
                for state in states
            )
        )
        await self.session.execute(sa.text("SET CONSTRAINTS ALL IMMEDIATE"))
        await self.session.rollback()
        self.assertIsNotNone(await self.session.get(models.StatsMatch, match_id))
