# Workspace Subscription Requirement — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: use `superpowers:executing-plans` to implement this plan task-by-task.

**Design:** `docs/superpowers/specs/2026-08-05-workspace-subscription-requirement-design.md` — read it first; this plan does not repeat the reasoning.

**Goal:** move the subscription requirement from the per-tournament registration form to the workspace, leaving the form with only its on/off toggle, so a new tournament never re-asks for the rule.

**Architecture:** a new `subscriptions.requirement` table (one `default` row per workspace, preset-ready by construction); a `load_requirement` method on the existing `EntitlementStore`/`SubscriptionResolver` seam so every gate changes by one line and the Kleene stack stays untouched; an expand/contract migration pair.

---

## House Rules (learned the hard way — apply to every task)

- **Prefix git/test/build with `rtk`.** Exception: **`rtk npx` is broken** (rewrites to `npm run`) — call `npx` directly.
- **Edit files with Edit/Write only.** PowerShell mangles UTF-8 here.
- Backend tests: `cd backend && rtk uv run --package <service> pytest <path> -v`.
- **No `pytest-asyncio`.** A bare `async def test_…` in a plain class is collected and never awaited — green while asserting nothing. Async tests MUST subclass `unittest.IsolatedAsyncioTestCase`.
- After Python edits: `cd backend && rtk uv run ruff check <paths> --fix && rtk uv run ruff format <paths>` — run from `backend/`, paths relative to it (`shared/...`, not `backend/shared/...`).
- **Never hardcode `down_revision`** — `rtk uv run alembic heads` is authoritative. It currently reports `wsguild0002`; confirm, do not assume.
- Verify migrations with `alembic upgrade <a>:<b> --sql` (offline, no DB needed) using this env form:
  `cd backend && POSTGRES_USER=x POSTGRES_PASSWORD=x POSTGRES_DB=x POSTGRES_HOST=x POSTGRES_PORT=5432 REDIS_URL=redis://x:6379 RABBITMQ_URL=amqp://x JWT_SECRET_KEY=x SECRET_KEY=x rtk uv run alembic ...`
- `config_json`/`requirement_json` are `sa.JSON()` → PostgreSQL **`json`**, not `jsonb`. `->>` works uncast; `-`, `||`, `?` need `::jsonb` in and `::json` back out.
- Go module is rooted at `gateway/`: `cd gateway && rtk go test ./...`, never `./gateway/...` from the root.
- **Do not run `backend/scripts/export_openapi_schemas.sh`** — it fails on Windows (nested bash loses `uv`). Use the per-service loop in Task 12.
- i18n: `en.json` **and** `ru.json` in the same commit.
- Conventional commits, no attribution trailers, exact-path staging.

---

## Phase 1 — Data

### Task 1: The model

**Files:** Modify `backend/shared/models/subscriptions/subscription.py`

Add beside `SubscriptionProviderConfig`. Note the class name collides with `shared.subscriptions.SubscriptionRequirement` (the parsed dataclass) — name the ORM class **`WorkspaceSubscriptionRequirement`** to keep both importable without aliasing, and say so in the docstring.

```python
class WorkspaceSubscriptionRequirement(db.TimeStampIntegerMixin):
    """The subscription rule a workspace enforces, shared by all its tournaments.

    Named `Workspace...` because `shared.subscriptions.SubscriptionRequirement` is
    the parsed value object this row's blob deserialises into; the two must stay
    importable side by side.

    One row per workspace today (``name='default'``, ``is_default=True``). The table
    shape is deliberately preset-ready: more rows plus a nullable FK on
    ``registration_form`` is a purely additive change, whereas a column on
    ``workspace`` would have forced a data migration.

    ``requirement_json`` keeps the exact shape ``shared.subscriptions.parse_requirement``
    already validates -- ``{mode, requirements: [{provider, min_tier_rank}]}`` -- so
    the Kleene composition is reused verbatim rather than reimplemented.
    """

    __tablename__ = "requirement"
    __table_args__ = (
        UniqueConstraint("workspace_id", "name", name="uq_subscription_requirement_workspace_name"),
        {"schema": SUBSCRIPTIONS_SCHEMA},
    )

    workspace_id: Mapped[int] = mapped_column(ForeignKey("workspace.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(64), nullable=False, server_default="default", default="default")
    requirement_json: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, server_default="{}", default=dict)
    is_default: Mapped[bool] = mapped_column(Boolean(), nullable=False, server_default="false", default=False)

    def __repr__(self) -> str:
        return f"<WorkspaceSubscriptionRequirement id={self.id} workspace_id={self.workspace_id} name={self.name}>"
```

Add to `__all__`. Verify: `cd backend && rtk uv run --package shared python -c "from shared import models; print(sorted(c.name for c in models.WorkspaceSubscriptionRequirement.__table__.c))"`.

Commit `feat(subscriptions): add the workspace requirement model`.

---

### Task 2: Expand migration

**Files:** Create `backend/migrations/versions/wsreq0001_add_workspace_subscription_requirement.py`

`down_revision` from `alembic heads` (expect `wsguild0002`).

> **Superseded by the shipped revision — do not copy SQL out of this task.** Review
> replaced its predicates. The shipped `wsreq0001` uses `DISTINCT ON (t.workspace_id)`
> (a `json` column in a `DISTINCT` list has no equality operator and fails at plan
> time, on every database), a single `CASE`-guarded `jsonb_array_length` shared by the
> guard and the backfill (a bare two-conjunct test relies on undefined WHERE evaluation
> order and can raise on `{"requirements": {}}`, which the old API accepted), and a
> `DO $$ … RAISE EXCEPTION $$` guard that also renders under `--sql`. The steps below
> record the original intent; the file on disk is authoritative.

`upgrade()`:
1. `op.create_table("requirement", ..., schema="subscriptions")` mirroring the model, including the unique constraint.
2. `op.create_index("uq_subscription_requirement_one_default", "requirement", ["workspace_id"], unique=True, postgresql_where=sa.text("is_default"), schema="subscriptions")`
3. **Abort on ambiguity** before backfilling:

```python
    conn = op.get_bind()
    ambiguous = conn.execute(
        sa.text(
            """
            select t.workspace_id, count(distinct f.subscription_requirement_json::text) as variants
              from balancer.registration_form f
              join tournament.tournament t on t.id = f.tournament_id
             where coalesce(f.subscription_requirement_json::text, '{}') not in ('{}', 'null')
             group by t.workspace_id
            having count(distinct f.subscription_requirement_json::text) > 1
            """
        )
    ).all()
    if ambiguous:
        raise RuntimeError(
            "Cannot elect a default subscription requirement for workspace(s) "
            f"{[row[0] for row in ambiguous]}: they hold more than one distinct rule. "
            "Resolve by hand (pick the intended rule per workspace) before migrating -- "
            "silently choosing an admission rule is exactly the failure this guard exists to prevent."
        )
```

4. Backfill one row per workspace from its single distinct non-empty blob:

```python
    op.execute(
        """
        insert into subscriptions.requirement (workspace_id, name, requirement_json, is_default)
        select distinct t.workspace_id, 'default', f.subscription_requirement_json, true
          from balancer.registration_form f
          join tournament.tournament t on t.id = f.tournament_id
         where coalesce(f.subscription_requirement_json::text, '{}') not in ('{}', 'null')
        """
    )
```

`downgrade()`: `op.drop_index(...)` then `op.drop_table("requirement", schema="subscriptions")`. The source column still exists at this point (Task 3 owns it), so nothing needs restoring.

Verify the offline render and that `alembic heads` reports a single head. Commit `feat(db): add the workspace subscription requirement table`.

---

## Phase 2 — Backend read path

### Task 3: `load_requirement` on the store and resolver (TDD)

**Files:**
- `backend/shared/services/subscription_entitlements.py` (the `EntitlementStore` protocol ~line 99; `SubscriptionResolver.accepted_code_providers` ~line 303)
- `backend/shared/services/subscription_store.py` (`SqlEntitlementStore`)
- Test: `backend/shared/tests/test_subscription_store_integration.py` (DSN-gated) **and** a DB-free unit test for the resolver-level parse

Mirror `accepted_code_providers` exactly — it is the precedent for a workspace-scoped question that is not `evaluate`.

Protocol:
```python
    async def load_requirement(self, workspace_id: int) -> dict[str, Any] | None: ...
```

`SqlEntitlementStore`:
```python
    async def load_requirement(self, workspace_id: int) -> dict[str, Any] | None:
        req = models.WorkspaceSubscriptionRequirement
        blob = await self._session.scalar(
            sa.select(req.requirement_json).where(req.workspace_id == workspace_id, req.is_default.is_(True))
        )
        return dict(blob) if blob else None
```

`SubscriptionResolver`:
```python
    async def load_requirement(self, *, workspace_id: int) -> SubscriptionRequirement | None:
        """The workspace's enforceable rule, or None when there is nothing to enforce.

        Fails OPEN on a malformed blob, matching what every call site did inline
        before this moved: refusing every patron mid-tournament because a config row
        is bad is the worse failure.
        """
        blob = await self._store.load_requirement(workspace_id)
        if not blob:
            return None
        try:
            requirement = parse_requirement(blob)
        except ValueError:
            return None
        return requirement if requirement.requirements else None
```

**Tests that must fail first**, then pass:
- resolver returns the parsed rule for a workspace with a default row;
- returns `None` for a workspace with no row;
- returns `None` for `{"mode": "most"}` (malformed) rather than raising;
- returns `None` for `{}` / a rule with an empty `requirements` list.

The first three are DB-free with a fake store; the integration file gets one round-trip test (it will SKIP without `SUBSCRIPTIONS_IT_DSN` — report that, never call a skip a pass).

Commit `feat(subscriptions): read the enforceable requirement from the workspace`.

---

### Task 4: Point the six consumers at it

**Files:** `subscription_gate.py`, `subscription_status.py`, `subscription_reads.py` (tournament-service), `subscription_collection/service.py`, `subscription_collection/admin.py` (parser-service)

Each of the three tournament-service modules declares its own `RequirementEvaluator` Protocol — add `load_requirement` to each, and replace the inline `parse_requirement(form.subscription_requirement_json)` with `await resolver.load_requirement(workspace_id=form.workspace_id)`. `_enforceable_requirement` becomes async and takes the resolver.

The two parser-service modules do **not** use a resolver; give them a join instead:
```python
        .join(
            models.WorkspaceSubscriptionRequirement,
            sa.and_(
                models.WorkspaceSubscriptionRequirement.workspace_id == models.Tournament.workspace_id,
                models.WorkspaceSubscriptionRequirement.is_default.is_(True),
            ),
        )
```
selecting `WorkspaceSubscriptionRequirement.requirement_json` in place of the form column. An **inner** join is correct here: a workspace with no rule has nothing to collect, which is exactly the row the old code dropped via `if not requirement.requirements`.

**The fake resolvers in the existing suites gain one method — nothing else.** If a decision-table assertion needs changing, stop: the seam is wrong. Suites that must stay behaviourally identical: `test_check_in_subscription_gate.py`, `test_registration_subscription_gate.py`, `test_registration_list_subscription.py`, `test_subscription_status_read.py`, `test_check_in_gate_integration.py`, `parser-service/tests/test_subscription_collection.py`.

Commit `refactor(subscriptions): resolve the requirement from the workspace`.

---

### Task 5: Schemas and the workspace CRUD

**Files:** `tournament-service/src/schemas/registration.py`, `services/registration/subscription_config.py` (neighbour of `list_provider_configs`), `serializers.py`, `registration_build.py`, `service.py:868-882`

- `RegistrationFormUpsert`: drop `subscription_requirement_json` **and** its `_validate_requirement` validator.
- `RegistrationFormRead`: keep the field; add a comment that it is server-resolved and read-only. `serializers.py` and `registration_build.py` fill it from the workspace requirement, not the form.
- `service.py`: stop writing the column on create/update.
- New schemas + service functions for reading and upserting the workspace requirement, validating the blob with the same `parse_requirement` the dropped validator used (move the validator, do not delete its logic).
- New RPC handlers + gateway routes, gated on the same permission as the provider config.

The gateway checklist applies in full: `edge.RouteSpec` → `apidocs/groups.go` → `openapi_schemas.py` + `openapi_docs.py` → regenerated manifest (Task 12) → `apiv1_guard_test.go` if a new table was added.

Commit `feat(subscriptions): workspace requirement read and upsert`.

---

## Phase 3 — Frontend

### Task 6: Types and service

Drop `subscription_requirement_json` from the upsert types (`balancer-admin.types.ts:356,369`, `registration.types.ts:162`); keep it on the read types. Add the workspace requirement read/upsert types and service calls. `npx tsc --noEmit` failures are the worklist for Tasks 7–8.

### Task 7: The Providers tab

`/admin/subscriptions/page.tsx` gains a workspace-scoped `Providers` tab (visible to workspace admins, unlike the superuser-only `Settings`). It hosts `SubscriptionProvidersCard` — **moved out of** `RegistrationFormBuilder.tsx:436` — and `SubscriptionRequirementEditor` bound to the workspace requirement.

Warn in the editor when clearing a rule while tournaments still have the toggle on (design §6).

### Task 8: Toggle only in the form and the wizard

- `RegistrationFormBuilder.tsx`: remove the editor (`:420`) and the provider card (`:436`); keep the toggle; render the resolved rule read-only with a link to the tab.
- `admin/tournaments/new/steps/RegistrationStep.tsx:83`: remove the editor, keep the toggle. Drop `subscription_requirement_json` from `wizard-model.ts:49` and `new/page.tsx:150`.
- `ReviewStep.tsx:53`: describe the workspace rule.
- `TournamentParticipantsPage.tsx:1084` needs no change — the read model still carries the rule.

i18n both dictionaries.

---

## Phase 4 — Ship

### Task 9: Contract migration

`wsreq0002`: `op.drop_column("registration_form", "subscription_requirement_json", schema="balancer")`. `downgrade` re-adds the column at its `{}` server default and **stops there — it does NOT refill it.** Per-form rules are not recoverable by that revision: the elected rule lives on in `subscriptions.requirement`, so copy it back by hand BEFORE running `wsreq0001.downgrade`, which drops that table. Refilling every form from the workspace rule was the original design and was removed in review: it would arm tournaments that had held a documented no-op, turning a rollback into a silent tightening of admission.

### Task 10: Full suites
Four backend suites, `cd gateway && rtk go test ./...`, `npx tsc --noEmit`, `npx vitest run`.

### Task 11: Grep for leftovers
`rtk grep -rn "subscription_requirement_json" backend frontend/src` — only the read models, the two migrations, and the resolved projection should match.

### Task 12: Regenerate the manifest
The Windows-safe loop (see `docs/superpowers/plans/2026-08-04-workspace-discord-guild.md` Task 11), then `cd gateway && rtk go test ./...`.

### Task 13: Docs
`docs/database_erd.md` + `frontend/src/app/docs/diagrams.ts`: add the `SUBSCRIPTION_REQUIREMENT` entity, drop the form column, bump the recorded head **in both places it appears**, add the changelog entry.

---

## Rollout Notes

Same three-step sequence as the guild move, and for the same reason — see the design §4.5.

1. `alembic upgrade wsreq0001` — creates and backfills. Old code untouched (its column is still there).
2. Roll the services.
3. `alembic upgrade head` — drops the form column.

**Migrations are applied on `dd-new` by a one-off container with the host's `migrations/` bind-mounted**, because the service images do not contain alembic:

```bash
docker run -d --name owt-mig --network postgres_pg_network \
  --env-file /root/overwatch-tournaments/backend/env/common.env \
  -e POSTGRES_HOST=db_postgres -e POSTGRES_PORT=5432 \
  -v /root/overwatch-tournaments/backend/alembic.ini:/app/alembic.ini:ro \
  -v /root/overwatch-tournaments/backend/migrations:/app/migrations:ro \
  -w /app registry.craazzzyyfoxx.me/aqt-tournament:latest \
  /app/.venv/bin/alembic upgrade <revision>
```

`POSTGRES_HOST=db_postgres` on port 5432 is deliberate: it bypasses pgbouncer, whose transaction pooling breaks DDL. SSH to that host drops at ~19 s, so run long operations detached and poll.

**Pre-flight before step 1:** confirm no workspace holds two distinct rules — the migration aborts if one does, which is the intended behaviour, but you want to know before the window rather than during it.

This query MUST use the same definition of "configured" as the shipped guard, or it will cancel windows that did not need cancelling. A textual test (`::text not in ('{}','null')`) counts `{"mode":"all","requirements":[]}` — what the old wizard wrote into every form it touched — as a rule, and also splits one rule written with different key order into two variants.

```sql
select t.workspace_id, count(distinct f.subscription_requirement_json::jsonb) as variants
  from balancer.registration_form f
  join tournament.tournament t on t.id = f.tournament_id
 where jsonb_array_length(
         case when jsonb_typeof((f.subscription_requirement_json::jsonb) -> 'requirements') = 'array'
              then (f.subscription_requirement_json::jsonb) -> 'requirements'
              else '[]'::jsonb end
       ) > 0
 group by 1 having count(distinct f.subscription_requirement_json::jsonb) > 1;
```
