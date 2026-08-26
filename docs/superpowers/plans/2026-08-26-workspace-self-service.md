# Workspace Self-Service Creation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** open workspace creation to any active authenticated user, without letting self-service become a Discord-guild-squatting vector or an unmetered GPU/achievement-recompute primitive.

**Architecture:** four independently-deployable phases, in this order because each later phase assumes the previous one's protections are already live: (1) Discord guild ownership verification + uniqueness, (2) `verification_status` tier (manual-only for now) + hard GPU gate, (3) deferred achievement queue for unverified workspaces, (4) the self-service `create` RPC itself plus the trusted-only homepage filter, opened last so it never ships ahead of its own guardrails.

**Tech Stack:** SQLAlchemy 2 + Alembic (hand-written revision ids, chain head `anlcln02` at time of writing — confirm with `alembic heads` before branching), FastStream RPC over RabbitMQ, Pydantic v2, Go gateway (`apidocs/groups.go` auto-generates the OpenAPI manifest from the route table — never hand-edit it), Next.js + React Query frontend.

**Design:** `docs/superpowers/specs/2026-08-26-workspace-self-service-design.md` — read it first; this plan does not repeat the reasoning, only the exact steps. **Note the revision in that document's §3/§4.3/§4.4/§4.5**: no auto-verify wiring in this pass (manual superuser RPC only), a per-user cumulative create cap (default 1) instead of a time-window rate limit, and a trusted-only public homepage filter.

---

## Phase 1 — Discord guild ownership verification

### Task 1: Pre-flight — confirm no existing `discord_guild_id` collisions

**Files:** none (read-only query against `anak_dev` or the production replica, whichever this environment can safely reach).

**Step 1:** Run
```sql
SELECT discord_guild_id, COUNT(*), array_agg(id)
FROM workspace
WHERE discord_guild_id IS NOT NULL
GROUP BY discord_guild_id
HAVING COUNT(*) > 1;
```
Expected: zero rows. If not zero, the UNIQUE index in Task 3 cannot apply — resolve the collision (contact the affected organizers) before proceeding; this is a hard blocker for the rest of Phase 1.

**Step 1b:** Also run, for Task 3's `owner_id` backfill:
```sql
SELECT r.workspace_id, COUNT(DISTINCT ur.user_id) AS owner_holders
FROM auth.user_roles ur
JOIN auth.roles r ON r.id = ur.role_id AND r.name = 'owner'
GROUP BY r.workspace_id
HAVING COUNT(DISTINCT ur.user_id) <> 1;
```
Report the row count (workspaces that will backfill to `owner_id = NULL`, per design §4.2/§6) in the Task 3 commit message. Not a blocker — `NULL` is a valid, harmless outcome — but must be a known number, not a surprise.
Expected: zero rows. If not zero, the UNIQUE index in Task 3 cannot apply — resolve the collision (contact the affected organizers) before proceeding; this is a hard blocker for the rest of Phase 1.

**Step 2:** Also record the current `workspace` row count. Not load-bearing for this pass (no auto-verify threshold in this iteration), but worth pasting into the Task 1 commit message anyway — the written-but-unwired metric in Task 8 will want a real baseline whenever the auto-verify follow-up lands.

**Step 3: Commit** (no code change; commit an empty marker or fold the numbers into Task 3's migration docstring).

### Task 2: Discord OAuth `guilds` scope + guild-list method

**Files:**
- Modify: `backend/identity-service/src/services/oauth_providers.py:83-96` (`DiscordOAuthProvider`)
- Modify: `backend/identity-service/tests/test_oauth_providers.py`

**Step 1: Write the failing test**

```python
def test_discord_authorization_url_requests_guilds_scope():
    provider = oauth_providers.get("discord")
    url = provider.get_authorization_url(state="s")
    assert "scope=identify+email+guilds" in url or "scope=identify%20email%20guilds" in url
```

**Step 2:** Run `pytest backend/identity-service/tests/test_oauth_providers.py -k guilds_scope -v`. Expected: FAIL (`scope=identify+email` only).

**Step 3: Implement.** In `oauth_providers.py:94`, change `"scope": "identify email"` to `"scope": "identify email guilds"`.

**Step 4:** Add `async def get_user_guilds(self, access_token: str) -> list[dict]` to `DiscordOAuthProvider`: `GET https://discord.com/api/users/@me/guilds` with `Authorization: Bearer {access_token}` via `self.http` (the provider's existing HTTP client — mirror the shape of the existing `get_user_info` method for error handling / timeout conventions). Returns Discord's raw list; each item has `id`, `owner: bool`, `permissions: str`.

**Step 5:** Add a small pure helper (co-locate in the same module or `shared/core/social.py` if a Discord-specific home already exists there): `def has_manage_guild(permissions: str) -> bool: return (int(permissions) & 0x20) != 0`. Unit test: `has_manage_guild("32") is True`, `has_manage_guild("16") is False`, plus an `owner=True` short-circuit test at the call site.

**Step 6:** Run the full `test_oauth_providers.py` suite. Expected: PASS.

**Step 7: Commit:** `feat(identity): request guilds OAuth scope, add Discord guild-list fetch`

### Task 3: `Workspace` model + migration — UNIQUE guild id, verified columns

**Files:**
- Create: `backend/migrations/versions/wsgdvrf01_workspace_discord_verification.py`
- Modify: `backend/shared/models/tenancy/workspace.py:71` (and add three columns after it: two Discord-verification columns, plus `owner_id`)
- Test: `backend/shared/tests/test_workspace_discord_verification_schema.py`

**Step 1: Write the failing model test**

```python
def test_workspace_gains_discord_verification_columns():
    cols = models.Workspace.__table__.c
    assert cols["discord_guild_id"].unique is True
    assert "discord_guild_verified_at" in cols
    assert "discord_guild_verified_by_auth_user_id" in cols
    assert "owner_id" in cols
```

**Step 2:** Run it. Expected: FAIL (`unique` currently `False`, columns absent).

**Step 3: Implement the model change** in `backend/shared/models/tenancy/workspace.py`:

```python
discord_guild_id: Mapped[str | None] = mapped_column(String(32), unique=True, nullable=True)
discord_guild_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
discord_guild_verified_by_auth_user_id: Mapped[int | None] = mapped_column(
    ForeignKey("auth.user.id", ondelete="SET NULL"), nullable=True
)
owner_id: Mapped[int | None] = mapped_column(ForeignKey("auth.user.id", ondelete="SET NULL"), nullable=True, index=True)
```

**Step 4:** Run the model test. Expected: PASS.

**Step 5: Write the migration.** `down_revision = "anlcln02"` (confirm against `alembic heads` first — this plan's head is a hint, not authoritative, per the design's own caveat).

```python
"""workspace discord guild verification + owner_id

Adds a UNIQUE constraint to workspace.discord_guild_id (Task 1's pre-flight query
must have found zero collisions before this runs) plus verified_at/verified_by
columns. Also adds owner_id, backfilled from the current RBAC owner-role holder
only where a workspace has exactly one (Task 1's Step 1b pre-flight number).
Pure additive expand.
"""
revision: str = "wsgdvrf01"
down_revision: str | Sequence[str] | None = "anlcln02"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_unique_constraint("uq_workspace_discord_guild_id", "workspace", ["discord_guild_id"])
    op.add_column("workspace", sa.Column("discord_guild_verified_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column(
        "workspace",
        sa.Column(
            "discord_guild_verified_by_auth_user_id",
            sa.Integer(),
            sa.ForeignKey("auth.user.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.add_column(
        "workspace",
        sa.Column("owner_id", sa.Integer(), sa.ForeignKey("auth.user.id", ondelete="SET NULL"), nullable=True),
    )
    op.create_index("ix_workspace_owner_id", "workspace", ["owner_id"])
    # Backfill owner_id from the current RBAC "owner" role, only where a
    # workspace has exactly one holder -- ambiguous cases (0 or >1 holders)
    # stay NULL, per design §4.2/§6 and the Task 1 Step 1b pre-flight count.
    op.execute(
        """
        WITH single_owner AS (
            SELECT r.workspace_id, MIN(ur.user_id) AS user_id
            FROM auth.user_roles ur
            JOIN auth.roles r ON r.id = ur.role_id AND r.name = 'owner'
            GROUP BY r.workspace_id
            HAVING COUNT(DISTINCT ur.user_id) = 1
        )
        UPDATE workspace w
        SET owner_id = so.user_id
        FROM single_owner so
        WHERE so.workspace_id = w.id
        """
    )


def downgrade() -> None:
    op.drop_index("ix_workspace_owner_id", "workspace")
    op.drop_column("workspace", "owner_id")
    op.drop_column("workspace", "discord_guild_verified_by_auth_user_id")
    op.drop_column("workspace", "discord_guild_verified_at")
    op.drop_constraint("uq_workspace_discord_guild_id", "workspace", type_="unique")
```

**Step 6:** Apply against an isolated scratch database (never `anak_dev` directly — it is on a divergent migration lineage per `docs/plans/2026-08-20-team-registration.md:660-669`). Confirm `downgrade` → `upgrade` round-trips cleanly.

**Step 7: Commit:** `feat(workspace): add discord guild uniqueness + owner_id + verification columns (wsgdvrf01)`

### Task 4: `rpc.identity.oauth.discord_guilds`

**Files:**
- Create/modify: `backend/identity-service/src/rpc/oauth.py` (or the existing OAuth RPC module — locate via `grep "rpc.identity.oauth"` first)
- Test: `backend/identity-service/tests/test_discord_guilds_rpc.py`

**Step 1: Write the failing test** — actor with a Discord `OAuthConnection` and a mocked `get_user_guilds` response containing one owned guild and one non-managed guild; assert the RPC returns exactly `{guilds: [{guild_id, name, owner, can_manage}]}` with `can_manage` computed correctly for both.

**Step 2:** Run it, confirm FAIL (subject does not exist yet).

**Step 3: Implement.** Subscriber `rpc.identity.oauth.discord_guilds`: resolve `auth_user_id` from the payload, look up `AuthUser.oauth_connections` filtered `provider="discord"`, refresh the access token via the existing refresh flow if `expires_at` has passed, call `get_user_guilds`, map each entry to `{guild_id: str(id), name, owner: bool(owner), can_manage: owner or has_manage_guild(permissions)}`. No DB write — read-only, computed live per the design's explicit no-caching decision.

**Step 4:** No Discord connection for the actor → return `{guilds: []}`, not an error (the caller — Task 5 — turns an empty/missing match into the 403).

**Step 5:** Run the test. Expected: PASS.

**Step 6: Commit:** `feat(identity): rpc.identity.oauth.discord_guilds — live guild ownership lookup`

### Task 5: `rpc.app.workspaces.discord_guild_verify` + retire `WorkspaceUpdate.discord_guild_id`

**Files:**
- Modify: `backend/app-service/src/rpc/workspaces.py`
- Modify: `backend/app-service/src/schemas/workspace.py:90-166` (`WorkspaceUpdate`)
- Modify: `backend/app-service/src/services/workspace/service.py`
- Test: `backend/app-service/tests/test_workspace_discord_guild_verify.py`
- Test: modify `backend/app-service/tests/test_workspace_discord_guild_schema.py` (the `WorkspaceUpdate.discord_guild_id` tests move/adapt to the new endpoint's schema)

**Step 1: Write the failing tests, one per branch:**
- actor administers the guild (via a patched `rpc.identity.oauth.discord_guilds` response) → 200, `discord_guild_verified_at` set, `discord_guild_verified_by_auth_user_id == actor.id`, one `record_audit` row with `action="workspace.discord_guild_verified"`.
- actor does not administer the guild → 403 `discord_guild_not_administered`, no DB write.
- guild already claimed by another workspace (seed a second workspace with that `discord_guild_id`) → 409 `discord_guild_already_claimed`.
- identity-service RPC call raises/times out → 503, **not** a silent skip (pinned per the design's Risks §6 fail-closed requirement).
- `WorkspaceUpdate.model_validate({"discord_guild_id": "123"})` → the field no longer exists on the schema (`pydantic.ValidationError` on an extra field, or simply absent from `model_fields` — assert `"discord_guild_id" not in schemas.WorkspaceUpdate.model_fields`).

**Step 2:** Run all five. Expected: FAIL (endpoint doesn't exist; field still present).

**Step 3: Implement** `rpc.app.workspaces.discord_guild_verify` in `workspaces.py`, following the four numbered steps in the design §4.1. Remove `discord_guild_id` (and its validator at `schemas/workspace.py:159-166`) from `WorkspaceUpdate`. Keep it on `WorkspaceRead`, plus add `discord_guild_verified_at: datetime | None` there.

**Step 4:** Run the five tests plus the full `test_workspace_discord_guild_schema.py` and `test_workspace_discord_rpc.py` suites (the latter's `discord_guild_id="999"` fixtures must keep passing unchanged — they exercise the bot-presence/`_discord_lookup` path, untouched by this design). Expected: all PASS.

**Step 5: Commit:** `feat(workspace): discord_guild_verify RPC; retire unverified PATCH discord_guild_id path`

### Task 6: Gateway route + OpenAPI manifest + docs

**Files:**
- Modify: `gateway/internal/app/routes.go` (add `POST /api/v1/workspaces/{id}/discord-guild`, `AuthRequired`)
- Modify: `backend/app-service/src/openapi_schemas.py` (mirror the `rpc.app.workspaces.create` entry shape)
- Regenerate: `bash backend/scripts/export_openapi_schemas.sh`
- Modify: `docs/database_erd.md` and `frontend/src/app/docs/diagrams.ts` — add the three new `WORKSPACE` columns, bump the recorded alembic head **in both places**

**Step 1:** Add the Go route, run `cd gateway && rtk go build ./... && rtk go test ./...`. Expected: PASS, and `tests/test_rpc_route_parity.py` (if it exists at this point — added by the team-registration work) confirms the subject/route pair matches.

**Step 2:** Regenerate the manifest; diff review — expect exactly the new entry, per the "generator is all-or-nothing" caution already recorded for this exact script (`docs/superpowers/plans/2026-08-05-catalog-aliases.md:882`).

**Step 3: Commit:** `chore(gateway): route + manifest for discord_guild_verify`

---

## Phase 2 — `verification_status` tier (manual-only) + GPU hard gate

### Task 7: `verification_status` column + backfill

**Files:**
- Create: `backend/migrations/versions/wstier001_workspace_verification_status.py`
- Modify: `backend/shared/models/tenancy/workspace.py`
- Test: `backend/shared/tests/test_workspace_verification_status_schema.py`

**Step 1: Write the failing model test** — `models.Workspace.__table__.c["verification_status"]` exists, `server_default.arg == "unverified"`.

**Step 2:** Implement the column (design §4.2).

**Step 3: Write the migration**, `down_revision = "wsgdvrf01"`:

```python
def upgrade() -> None:
    op.add_column(
        "workspace",
        sa.Column("verification_status", sa.String(16), nullable=False, server_default="unverified"),
    )
    # Backfill: every workspace that exists before self-service ships is
    # grandfathered — self-service must gate new entrants only (design A6/§6).
    op.execute("UPDATE workspace SET verification_status = 'verified'")


def downgrade() -> None:
    op.drop_column("workspace", "verification_status")
```

**Step 4:** Apply against a scratch DB seeded with a handful of pre-existing workspace rows (copy the fixture pattern from `wsguild0001`'s own DB-backed verification). Confirm every pre-existing row reads `verified` after `upgrade`, and the column is gone after `downgrade`.

**Step 5: Commit:** `feat(workspace): verification_status column, existing workspaces grandfathered verified (wstier001)`

### Task 8: `is_verified_or_trusted` gate check + written-but-unwired auto-verify primitives

**Files:**
- Create: `backend/shared/services/workspace_tier.py`
- Test: `backend/shared/tests/test_workspace_tier.py`

**Step 1: Write the failing tests for the actual gate:**
- `verification_status="trusted"` → `is_verified_or_trusted(workspace)` returns `True`.
- `verification_status="verified"` → returns `True`.
- `verification_status="unverified"` → returns `False`. No DB session parameter at all — assert the function signature takes only the already-loaded `Workspace` instance, not a session, so it is structurally incapable of running a query (this is the regression guard that keeps it from silently growing into the auto-upgrade check later without a deliberate signature change).

**Step 2:** Implement `is_verified_or_trusted` per design §4.3 — a one-line pure function.

**Step 3: Write the failing tests for the unwired primitives** (same file, clearly separated with a comment banner matching the design's):
- `count_linked_members(session, workspace_id)` — seed a workspace with two `workspace_member` rows, one whose `player.auth_user_id` is set and one `NULL`; assert it returns `1`.
- `get_setting_int` (or however the `Settings` lookup helper is named) reading `workspace_verification.auto_verify_min_linked_members` — with no row present, returns the documented default; with a row present, returns its value.
- **Regression guard:** `grep -rn "count_linked_members\|auto_verify_min_linked_members" backend/ --include=*.py | grep -v test_workspace_tier.py | grep -v workspace_tier.py` returns nothing — i.e. no production call site anywhere references these two names outside their own definition and this test file. Encode this as an actual test (subprocess grep or an AST-walk over the repo), not just a plan note, so a future PR that wires them in without updating this plan's Decision Log trips a red test instead of silently changing behaviour.

**Step 4:** Implement `count_linked_members` and the settings helper. Both are real, tested code — just uncalled by anything else in this codebase.

**Step 5:** Run all tests including the regression guard. Expected: PASS.

**Step 6: Commit:** `feat(shared): is_verified_or_trusted gate + unwired auto-verify primitives`

### Task 9: `rpc.app.admin.workspace_verification_set`

**Files:**
- Modify: `backend/app-service/src/rpc/workspaces.py` (or a dedicated `rpc/admin_workspace.py` if an admin-only RPC module already exists — check first)
- Modify: `backend/app-service/src/schemas/workspace.py` (new `WorkspaceVerificationSet` body: `{verification_status: Literal["unverified", "verified", "trusted"]}`)
- Test: `backend/app-service/tests/test_workspace_verification_set.py`

**Step 1: Write the failing tests:**
- Superuser sets `unverified → verified` → 200, `verification_status` updated, one `record_audit` row `action="workspace.verification_status_set"` with `before`/`after` both present.
- Non-superuser (even a workspace `owner`) → 403, no write. This is deliberately stricter than `workspace.update` — being an owner of the workspace must not let you self-certify it.
- Invalid status string (`"legit_i_swear"`) → 422, schema-level rejection before the handler runs.
- Setting the same status it already has → 200, no-op, but still audited (idempotent writes still leave a trail — matches the `record_audit` precedent for domain edits elsewhere in this file).

**Step 2:** Implement the four steps from design §4.3.

**Step 3:** Run the four tests. Expected: PASS.

**Step 4: Commit:** `feat(workspace): superuser-only verification_status admin RPC`

### Task 10: GPU hard gate at the `_dispatch` chokepoint

**Files:**
- Modify: `backend/analytics-service/src/rpc/jobs_control.py`
- Test: `backend/analytics-service/tests/test_jobs_gpu_gate.py`

**Step 1: Write the failing tests:**
- `kind=compute`, `workspace_id` set, workspace `unverified` → `create_job` RPC returns 403 `workspace_not_verified`, no `AnalyticsJob` row created (assert the repository's create was never called — mirror the "no partial write" assertions already used in `test_workspace_service.py`).
- Same, but workspace `verified` → 200, unchanged behaviour.
- Same, but workspace `trusted` → 200, unchanged behaviour.
- `kind=train_ml` → unaffected by this gate either way (still governed solely by `is_superuser`); a non-superuser unverified-workspace-owner still gets the existing superuser 403, not a new/different one.
- Deprecated `train`/`infer` RPCs — same 403 for an unverified workspace's `workspace_id`.

**Step 2:** Implement: in `_dispatch`, after `_require_actor`, add the `kind == JOB_KIND_COMPUTE and workspace_id is not None` branch loading the `Workspace` row (avoid a redundant second query if `_require_actor` or `create_analytics_job` already fetches it — check before adding one) and calling `is_verified_or_trusted(workspace)`. Apply the same call in `_train`/`_infer` before their existing permission check.

**Step 3:** Run the five tests plus the full `jobs_control.py`-adjacent suite (`test_analytics_job_runner.py` etc.) to confirm no regression on the `verified`-workspace path. Expected: all PASS.

**Step 4: Commit:** `feat(analytics): hard-gate GPU compute jobs on workspace verification`

---

## Phase 3 — deferred achievement evaluation for unverified workspaces

### Task 11: `EvaluationRunStatus.queued` + deferred queue topology

**Files:**
- Modify: `backend/shared/models/achievements/achievement.py:77-80`
- Modify: `backend/shared/messaging/config.py` (add `ACHIEVEMENT_EVALUATE_DEFERRED_QUEUE`, mirroring the existing `ANALYTICS_*_QUEUE` declarations)
- Test: `backend/shared/tests/test_evaluation_run_status.py`

**Step 1:** Add `queued = "queued"` to `EvaluationRunStatus`. No migration — plain `String()` column (design §2 fact table).

**Step 2:** Declare the new queue constant + its binding, following whatever declarative pattern `ANALYTICS_JOB_QUEUE` uses (durable queue, existing DLX/DLQ topology per `shared/messaging/README.md`).

**Step 3: Write the test** — `EvaluationRunStatus("queued") == EvaluationRunStatus.queued`; queue constant is a distinct string from `ACHIEVEMENT_EVALUATE_QUEUE` (or whatever the existing queue is named — confirm via `grep AchievementEvaluateEvent` first).

**Step 4: Commit:** `feat(shared): EvaluationRunStatus.queued + deferred achievement queue declaration`

### Task 12: Deferral branch in `run_evaluation`

**Files:**
- Modify: `backend/parser-service/src/services/achievement/engine/runner.py:47` (`run_evaluation`)
- Modify: `backend/parser-service/src/services/achievement/engine/consumer.py` (new consumer function for the deferred queue, reusing `handle_achievement_evaluate`'s body)
- Modify: `backend/parser-service/serve.py` — bind the new consumer with `prefetch_count=1`, one replica (design §4.3)
- Test: `backend/parser-service/tests/test_run_evaluation_deferral.py`

**Step 1: Write the failing tests:**
- `trigger=manual`, workspace unverified → `run_evaluation` returns an `EvaluationRun` with `status="queued"`, **no** rule evaluation executed (assert `evaluate`/`diff_and_apply` never called), one message published to `ACHIEVEMENT_EVALUATE_DEFERRED_QUEUE`.
- `trigger=rule_version_bump`, same unverified state → same deferral behaviour.
- `trigger=parse_complete`, unverified workspace → **unaffected**, runs inline exactly as today (this is the explicit non-goal boundary from design §4.3 — pin it so a future edit can't accidentally widen the gate).
- `trigger=manual`, workspace verified → unaffected, runs inline exactly as today.
- `trigger=manual`, workspace trusted → unaffected, runs inline exactly as today.

**Step 2:** Implement the branch at the top of `run_evaluation`, per design §4.3 (using `is_verified_or_trusted`, not any threshold check — there is none in this pass). The deferred-queue consumer function must call the *existing* evaluation logic (`evaluate`/`diff_and_apply` etc.) directly — not re-invoke `run_evaluation` itself, which would re-check verification and could recurse; structure it as `run_evaluation(..., _force_inline=True)` or extract the inline body into a private helper both paths call. Prefer the extraction — matches the "single chokepoint, no duplicated logic" principle used throughout this codebase's recent refactors (`docs/plans/2026-08-21-parser-service-oop-repositories.md`).

**Step 3:** Run the five tests plus the full `parser-service` achievement suite (`test_scrim_achievement_isolation.py` and friends) to confirm the `parse_complete` path and every existing `run_evaluation` caller signature stay green. Expected: all PASS.

**Step 4: Commit:** `feat(parser): defer manual/rule-bump achievement evaluation for unverified workspaces`

### Task 13: Caller-visible `queued` status in RPC responses

**Files:**
- Modify: `backend/parser-service/src/rpc/achievements.py:107,354`
- Modify: `backend/parser-service/src/services/achievement/rule_service.py:75`
- Modify: `backend/parser-service/src/schemas/...` wherever `EvaluationRunRead`-shaped responses are typed (locate via the existing response schema for the `evaluate` RPC)
- Test: extend `test_achievements` RPC-level tests with a `queued`-status assertion

**Step 1: Write the failing test** — the `evaluate` RPC on an unverified workspace returns `{status: "queued", ...}` with a 202-equivalent envelope (match whatever shape `analytics.create_job` uses for its own async response, per design §4.3 point 4), not a 200 with populated `rules_evaluated`/`results_created`.

**Step 2:** Implement — thread the `queued` run through unchanged; no new schema fields needed if `EvaluationRunRead.status` is already a plain string/enum field (confirm before adding one).

**Step 3:** Run the test plus the full `rpc/achievements.py`-adjacent suite. Expected: PASS.

**Step 4: Commit:** `feat(parser): surface queued evaluation runs through the achievement RPCs`

---

## Phase 4 — self-service `create` + public visibility

### Task 14: Per-user cumulative create limit

**Files:**
- Modify: `backend/shared/repository/workspace.py` (`WorkspaceRepository`, new `count_by_owner` method)
- Create: `backend/app-service/src/services/workspace/create_limit.py`
- Test: `backend/app-service/tests/test_workspace_create_limit.py`

**Step 1: Write the failing tests:**
- Actor owns zero workspaces (`Workspace.owner_id` never points at them), `Settings` threshold unset (falls back to documented default `1`) → allowed.
- Actor already owns one workspace (seed a `Workspace` row with `owner_id=actor.id`), default threshold `1` → `HTTPException(403, "workspace_create_limit_reached")`, no new workspace row created.
- Actor has RBAC `owner` role on a workspace but is **not** its `owner_id` (seed the two independently — a co-owner granted the role after creation) → does **not** count against their cap. This is the regression test for the whole point of the correction: RBAC role membership must not be conflated with `owner_id`.
- `Settings` row raises the threshold to `2` and the actor owns one → allowed.
- Superuser owning three workspaces already → still allowed, no limit check applied (assert the count query is never even issued for a superuser — short-circuit before it, mirroring `is_verified_or_trusted`'s trusted short-circuit).
- Two concurrent `create` calls from the same actor (simulate via two sessions racing on the same `auth.user` row) → exactly one succeeds, one gets `403`. This is the test that actually exercises the `SELECT ... FOR UPDATE` — without the lock this test is flaky/both-succeed; with it, deterministic.

**Step 2:** Implement `WorkspaceRepository.count_by_owner(session, *, owner_id: int) -> int` (design §4.4's query — a plain `COUNT(*) WHERE owner_id = :owner_id`, no join) and `ensure_create_limit(session, user)`: superuser short-circuit, else `SELECT * FROM auth.user WHERE id = :user_id FOR UPDATE`, then compare `count_by_owner` against the `Settings`-sourced `workspace_creation.max_owned_per_user` (default `1`).

**Step 3:** Run all six tests. Expected: PASS. The concurrency test needs two real DB sessions/connections, not two mocked calls in one — follow whatever pattern this repo's other lock-contention tests use (the team-registration slot-lock tests are the precedent, `docs/plans/2026-08-20-team-registration.md:545-554`).

**Step 4: Commit:** `feat(workspace): per-user cumulative create limit via owner_id, DB-locked, default 1`

### Task 15: Reserved slugs + open `create` to any active user

**Files:**
- Modify: `backend/app-service/src/rpc/workspaces.py:226-238` (`_create`)
- Modify: `backend/app-service/src/services/workspace/service.py:486-511` (`provision`) — stamp `owner_id`
- Modify: `backend/app-service/src/schemas/workspace.py:81-87` (`WorkspaceCreate` — confirm `discord_guild_id` was never added here; it should not be, per design §4.4)
- Create: `backend/app-service/src/services/workspace/reserved_slugs.py` (or a constant in `service.py` — pick whichever existing module holds comparable static config, e.g. `MEMBERS_SORT_FIELDS` lives in `service.py`)
- Test: `backend/app-service/tests/test_workspace_self_service_create.py`

**Step 1: Write the failing tests:**
- Active non-superuser user, zero owned workspaces → `create` succeeds, `verification_status == "unverified"` **and `owner_id == user.id`** on the returned/persisted `Workspace`, RBAC owner role still granted exactly as `provision()` already does (both writes present, per design §4.4's "two distinct writes for two distinct concerns").
- Inactive user → existing `require_active` 403, unchanged.
- Reserved slug (`"admin"`, `"api"`, etc.) → 400 `slug_reserved`, no row created.
- Over the create limit (patch `ensure_create_limit` to raise) → propagates as-is, no workspace created.
- Superuser still works unchanged and is exempt from the limit (regression guard — this flow must not become superuser-only again by accident); `owner_id` is still stamped to the superuser's own id, not left `NULL` — `provision()` does not special-case the actor.

**Step 2:** Implement: in `provision()`, add `owner_id=owner_auth_user_id` to the `Workspace` fields passed to `self.create(...)` (or an explicit `UPDATE` immediately after, whichever the existing `create` helper's signature makes cleaner — check before adding a second write). In `_create`: swap `c.require_superuser(user)` → `c.require_active(user)`; call `ensure_create_limit(session, user)` before validation; call `_reject_reserved_slug(body.slug)` before `provision()`.

**Step 3:** Run the five tests plus the full `test_workspace_service.py` / `workspaces` RPC suite — including the **existing** `provision()` tests, which must still pass unchanged for the RBAC-role-grant assertion (this task adds a write, it does not replace one). Expected: all PASS.

**Step 4: Commit:** `feat(workspace): open self-service create to active users, stamp owner_id`

### Task 16: Trusted-only homepage filter

**Files:**
- Modify: `backend/app-service/src/services/workspace/service.py:89-106` (`get_all`)
- Test: `backend/app-service/tests/test_workspace_service.py` (extend the existing `get_all`/`is_hidden` test class)

**Step 1: Write the failing tests:**
- Anonymous viewer (`user=None`), workspaces with every combination of `is_hidden` × `verification_status` → only `is_hidden=False, verification_status="trusted"` rows appear.
- Authenticated non-member viewer → same filtering as anonymous (trust, not membership, gates the anonymous-shaped branch).
- A member of an `unverified`, non-hidden workspace → **their own** workspace still appears in the list (membership bypasses the trust filter, exactly like it already bypasses `is_hidden`).
- Superuser → sees everything, unchanged.
- A `verified` (not `trusted`) workspace, non-member viewer → **excluded** — this is the specific regression guard for the distinction the design draws between "safe to run compute on" and "publicly discoverable."

**Step 2:** Implement per design §4.5 — extend the existing list-comprehension predicate, do not restructure the method.

**Step 3:** Run the five tests plus the full existing `get_all`/`is_hidden` suite (must stay green — this change is additive to an existing filter, not a replacement of it). Expected: all PASS.

**Step 4: Commit:** `feat(workspace): trusted-only public/home-page listing`

### Task 17: Frontend — self-service create flow + tier/guild UI

**Files:**
- Modify: `frontend/src/app/(wherever the workspace admin creation screen lives — locate via `grep -r "workspaces.create"` under `frontend/src`)`
- Modify: workspace settings screen — replace the free-text Discord guild input (already removed on the backend in Task 5) with a "Verify a Discord guild" flow: list the actor's administered guilds (from `discord_guilds`, surfaced through a new thin app-service passthrough if the frontend cannot call identity-service RPCs directly — check the existing gateway routing convention), pick one, call `discord_guild_verify`.
- Modify: superuser admin screen — a `verification_status` control (Task 9's RPC), so the only way to unblock a workspace is reachable from the UI, not just RPC.
- Modify: i18n `en.json`/`ru.json` — new keys for the verify flow, the `verification_status` badge (`unverified`/`verified`/`trusted`) surfaced next to the workspace name in admin screens, and a "your workspace isn't listed on the home page yet" notice for `unverified`/`verified`-but-not-`trusted` owners (ties directly to Task 16 — otherwise a self-service organizer has no way to understand why their workspace is invisible).
- Test: `*.behavior.test.tsx` for the new create form and the guild-picker, following the existing `SubscriptionProviderCard.behavior.test.tsx` pattern for a guild-shaped field.

**Step 1-N:** Standard frontend TDD cycle per the existing `RegistrationFormBuilder.i18n.test.tsx` precedent — real message bundles under `NextIntlClientProvider`, so a missing key renders its raw path and fails the test rather than silently falling back to English.

**Final commit:** `feat(frontend): self-service workspace creation + Discord guild verify flow + verification badge`

---

## Verification (run once per phase, not once at the very end)

- Backend: full suite per touched service (`app-service`, `analytics-service`, `parser-service`, `identity-service`, `shared`) — no project-wide command needed if each phase's tests are scoped correctly.
- Migrations: `downgrade -1` → `upgrade head` round-trip on an isolated scratch database for every new revision, never against `anak_dev` directly (lineage divergence, `docs/plans/2026-08-20-team-registration.md:660-669`).
- Gateway: `cd gateway && rtk go build ./... && rtk go test ./...` after Task 6.
- Frontend: `bun test` (behavior suites) + `tsc` + `eslint` after Task 17.
- Manual smoke, end to end, after Phase 4 ships: create a workspace as a fresh non-superuser account, confirm `unverified` and **absent from the home page**; attempt a second `create` from the same account → 403 `workspace_create_limit_reached`; attempt `rpc.analytics.create_job(kind=compute)` on the new workspace → 403; trigger a manual achievement evaluation → `queued`; verify a Discord guild the test account actually administers → `verified_at` set; attempt to verify a second workspace with the same guild id → 409; as a superuser, call `workspace_verification_set(..., "trusted")` → workspace now appears on the home page and GPU jobs succeed.
