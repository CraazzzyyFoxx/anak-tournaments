# Notifications and Announcements

**Status:** implemented (2026-09-07)

> **For Claude:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development to execute this plan task-by-task.
> The status line above is line 2 on purpose — `docs/plans/README.md` requires it there, so this pointer sits below it.

**Goal:** Give every user an in-app notification inbox for the four events they cannot otherwise learn about, and give operators
workspace-scoped and platform-wide announcements — the platform-wide ones visible to anonymous visitors as a dismissible banner.

**Architecture:** One append-only table (`notification`) plus one read-marks table (`notification_read`), both in the default schema
beside `audit_log`. Rows are written by a shared `notify(session, ...)` helper called *inside the mutating transaction*, exactly the
way `record_audit` already is. Delivery is pull-based: `rpc.app.notifications_list` serves the inbox, a thin non-durable
`notification.created` signal on the new `user:{id}:notifications` realtime topic tells a connected client to refetch. The
announcement banner is server-rendered from a public `AuthOptional` read that the gateway's anonymous response cache already covers.

**Tech Stack:** Python 3.14 / FastStream / SQLAlchemy 2 / Alembic (backend), Go 1.2x (gateway route table + realtime ACL),
Next.js 16 / react-query / next-intl / vitest (frontend).

---

## Global Constraints

1. **`notify()` never commits.** It calls `session.add(...)` and returns the row; the caller's transaction owns the commit. Same
   contract as `shared/services/audit.py:record_audit` (see `anchors-backend.md`). A notification for a rolled-back mutation is a bug.
2. **The realtime publish happens after `session.commit()`**, best-effort, wrapped in `try/except` with `logger.exception` — the
   pattern of `publish_logs_updated` / `publish_subscriptions_updated`. `event_id=0` (non-durable: no replay cursor).
3. **Audience is computed server-side from the JWT identity, never from a client-supplied id.** `notifications_mark_read` MUST verify
   each id against the audience predicate before inserting a read mark; otherwise `notification_read` becomes an existence oracle for
   other users' notifications (ids are sequential).
4. **No text in the database for system notification kinds.** The row carries `kind` + `payload_json` snapshots; the frontend renders
   `t("notifications.kinds.<kind>", payload)`. Announcements are the only rows with author-written text.
5. **Announcement locale rules:** `audience='global'` requires **every** supported locale (`ru` and `en`) — publishing without one is a
   422. `audience='workspace'` requires **at least one** locale and a `default_locale` that is among the filled ones.
6. **Every announcement create/update/delete writes `record_admin_audit`.**
7. **Every i18n key is added to both `src/i18n/messages/ru.json` and `en.json` in the same commit** — `src/i18n/messages.parity.test.ts`
   fails on drift. Tasks 8-10 add the keys they render themselves (their behavior tests need them); Task 11 only sweeps what is missing.
8. **Adding a gateway route means adding its RPC subscriber in the same task.** `backend/tests/test_rpc_route_parity.py` regex-scans
   the Go `Queue: "..."` literals against the Python subject literals and fails the suite on a mismatch.
9. **Commits are path-scoped.** The working tree carries 24 unrelated modified files from other work (workspace self-service). Never
   `git add -A` / `git add .`; add the exact paths the task touched.
10. **No formatters, linters or full suites per task.** Run only the tests named in the task. The final review runs the broader checks.

## Rulings already made (deviations from the brainstormed design)

- **R1 — no `platform` Postgres schema.** The design said `platform.notification`. `BackendAnchors` found the `platform` schema does not
  exist: `audit_log` and `event_outbox` live in the default schema with no `schema=` kwarg, and `docs/architecture.md` §5 lists no
  `platform` schema either. Creating a schema for two tables whose sibling journal sits in `public` would be a second convention.
  **Decision:** tables `notification` and `notification_read` in the default schema; model files still live under
  `backend/shared/models/platform/`. Cost if wrong: a later rename migration, mechanical.
- **R2 — branch in place, not a worktree.** SDD defaults to a git worktree. A fresh worktree has no `frontend/node_modules` and no
  backend venv, so no implementer could run vitest or pytest in it. **Decision:** work on branch `feat/notifications` cut from
  `develop` in the main checkout; commits are path-scoped (Global Constraint 9) so the unrelated dirty files stay out of history.
  Cost if wrong: an accidental unrelated file in a commit, visible in review and revertable.

## Anchor files (read instead of re-deriving house patterns)

`.superpowers/sdd/2026-09-07-notifications/`:
- `anchors-backend.md` — models/`__init__` exports, alembic head + migration template, `BaseRepository` API, `record_audit` verbatim,
  `realtime_publisher.py` verbatim, RBAC catalog notes, exact producer call sites.
- `anchors-rpc-gateway.md` — `serve.py` registry (NOT `rpc/__init__.py`, which is empty), `_common.py` helpers, a subscriber template,
  pagination helpers, `edge.RouteSpec` fields, `main.go` route-table + `acl.New` wiring, route-parity test mechanics, `acl_test.go` table.
- `anchors-frontend.md` — `*.service.ts` + `apiFetch` convention, query-key registry, `useRealtimeTopic`, exact Header insertion point,
  both layout mount points, admin page template, i18n structure, realtime-mocking test template, available `components/ui` primitives.

## Data model

```
notification
  id                      bigserial primary key
  audience                varchar(16)  not null   -- 'user' | 'workspace' | 'global'
  recipient_auth_user_id  bigint       null
  workspace_id            bigint       null
  kind                    varchar(64)  not null
  payload_json            jsonb        not null default '{}'
  actor_auth_user_id      bigint       null
  published_at            timestamptz  not null default now()
  expires_at              timestamptz  null
  created_at              timestamptz  not null default now()

  check (audience <> 'user')      or recipient_auth_user_id is not null
  check (audience =  'user')      or recipient_auth_user_id is null
  check (audience <> 'workspace') or workspace_id is not null
  check (audience =  'workspace') or workspace_id is null
  index ix_notification_recipient_published (recipient_auth_user_id, published_at desc)
  index ix_notification_audience_published  (audience, published_at desc) where audience <> 'user'

notification_read
  auth_user_id     bigint      not null
  notification_id  bigint      not null
  read_at          timestamptz not null default now()
  primary key (auth_user_id, notification_id)
```

No foreign keys — the convention `audit_log`, `event_outbox` and `realtime.workspace_event` already follow, for the same reason: an
append-only journal outlives the business rows it describes. Readability after the referent is gone comes from `payload_json`
snapshots, not from joins.

**Audience predicate** (`:me` = `auth.user.id` from the JWT, `:workspaces` = roster ∪ RBAC membership):

```sql
(
   (audience = 'user'      and recipient_auth_user_id = :me)
or (audience = 'workspace' and workspace_id = any(:workspaces))
or  audience = 'global'
)
and published_at <= now() and (expires_at is null or expires_at > now())
```

`:workspaces` = union of `workspace_member.player_id → players.user.auth_user_id` and `workspace_roster.workspace_member_user_ids`
(RBAC role holders), cached in Redis per user for 60 s.

## Notification kinds (v1)

| kind | producer | payload snapshot |
| --- | --- | --- |
| `team_invite.received` | `tournament-service/src/services/registration/teams.py:invite_member` (only when `target_auth_user_id` is set) | `team_id`, `team_name`, `tournament_id`, `tournament_name`, `slot_code`, `is_substitute`, `invite_id` |
| `team_invite.answered` | `teams.py:accept_invite`, `teams.py:decline_invite` → recipient is the captain | `team_id`, `team_name`, `invite_id`, `answer` (`accepted`/`declined`), `responder_name` |
| `registration.approved` | `tournament-service/src/services/tournament/events.py:enqueue_registration_approved` | `tournament_id`, `tournament_name`, `registration_id` |
| `registration.rejected` | `events.py:enqueue_registration_rejected` | `tournament_id`, `tournament_name`, `registration_id` |
| `encounter.report_disputed` | `tournament-service/src/services/encounter/map_report.py:submit_map_report`, `reconciliation.disputed` branch → both captains | `encounter_id`, `tournament_id`, `map_id`, `map_index` |
| `announcement.published` | `app-service` announcement CRUD | `locales: {ru?: {title, body?}, en?: {...}}`, `default_locale`, `href?` |

No de-duplication in v1: a status toggled approved→rejected→approved notifies three times. A partial unique index would also block the
legitimate repeat ("you were invited to that team again"). Marked with a `ponytail:` comment naming the upgrade path (a suppression
window in `notify()`).

## Out of scope (deliberate)

- Delivery outside the app (Discord DM, email) and per-kind preferences. The seam is two future tables (`notification_delivery`,
  `notification_preference`) that require no change to v1 reads or writes. No opt-out is offered in v1 — all four kinds are
  "you cannot learn this any other way".
- Realtime for the announcement banner (would need the first anonymous-subscribable topic in the system).
- Achievements, check-in windows, workspace role grants, subscription expiry — visible elsewhere or admin-only.

---

## Task 1: `notification` + `notification_read` models and migration

**Files:**
- Create: `backend/shared/models/platform/notification.py`
- Modify: `backend/shared/models/platform/__init__.py` (add `from .notification import *`)
- Create: `backend/migrations/versions/notif001_notifications.py` (`down_revision` = current head, `wstier001` — re-verify with
  `alembic heads` / by reading the newest file; the head may have moved)
- Test: `backend/shared/tests/test_notification_model.py`

**Step 1 — read the templates.** `anchors-backend.md`, sections for `models/platform/audit.py` (model shape, no-FK rationale, index
naming) and for `backend/migrations/versions/` (file naming, revision ids, head chain). Per Ruling R1 there is **no** `CREATE SCHEMA`:
these tables go in the default schema exactly like `audit_log`.

**Step 2 — write the failing test.** `backend/shared/tests/test_notification_model.py`, following the fixture style of
`backend/shared/tests/test_audit_record.py`:
- `test_user_audience_requires_recipient` — `Notification(audience="user", recipient_auth_user_id=None, kind="x")` violates the CHECK.
- `test_workspace_audience_rejects_recipient` — `audience="workspace"` with a `recipient_auth_user_id` violates the CHECK.
- `test_global_audience_needs_neither` — `audience="global"` with both null inserts fine.
- `test_read_mark_is_unique_per_user` — inserting the same `(auth_user_id, notification_id)` twice raises `IntegrityError`.

If the shared test fixtures cannot reach a real Postgres (CHECK constraints do not exist under SQLite), keep only the last assertion
as a model-level test and move the three CHECK assertions into a migration-level test that runs against the configured database —
state which route you took in the report. Do not delete the constraints from the DDL.

**Step 3 — run it.** `cd backend && uv run pytest shared/tests/test_notification_model.py -v` → FAIL (`ImportError`).

**Step 4 — implement** the two models and the migration exactly as the "Data model" section above specifies: columns, CHECK
constraints, both indexes (the second one partial, `where audience <> 'user'`). Docstrings must state *why* there are no FKs
(append-only journal outlives its referents) and why `created_at`/`published_at` are separate (`published_at` is schedulable).

**Step 5 — run the tests.** Same command → PASS. Then `cd backend && uv run alembic upgrade head` against the dev database and
`uv run alembic downgrade -1` to prove the downgrade is real; paste both outputs into the report.

**Step 6 — commit** (path-scoped):
```bash
git add backend/shared/models/platform/notification.py backend/shared/models/platform/__init__.py \
        backend/migrations/versions/notif001_notifications.py backend/shared/tests/test_notification_model.py
git commit -m "feat(notifications): add notification and notification_read tables"
```

---

## Task 2: `notify()` helper, kind registry, realtime topic

**Files:**
- Create: `backend/shared/services/notifications.py`
- Modify: `backend/shared/services/realtime_topics.py` (add `user_notifications`, **delete** the unused `workspace_notifications` at
  L71-72 — it has zero callers, confirmed by `graft trace_calls`)
- Test: `backend/shared/tests/test_notify.py`

**Step 1 — read** `anchors-backend.md`: `record_audit` verbatim (the template for `notify`) and `realtime_publisher.py` verbatim
(`WorkspaceEventEnvelope`, `publish_envelope_to_redis`).

**Step 2 — write the failing tests** in `backend/shared/tests/test_notify.py`:
- `test_notify_does_not_commit` — a fake/spy session records `add` but no `commit`; `notify(...)` returns the row and the session was
  never committed.
- `test_unknown_kind_is_rejected` — `notify(session, kind="nope.nope", ...)` raises `ValueError`.
- `test_payload_is_validated_against_kind_schema` — `team_invite.received` without `team_id` raises `ValidationError`.
- `test_global_announcement_requires_every_locale` — `announcement.published` with `audience="global"` and only `ru` raises
  (422-mapped) error; with `ru` + `en` it passes.
- `test_workspace_announcement_accepts_one_locale` — `audience="workspace"` with only `ru` and `default_locale="ru"` passes.
- `test_default_locale_must_be_present` — `default_locale="en"` while only `ru` is filled raises.
- `test_user_audience_requires_recipient` — calling with `audience="user"` and no recipient raises before any DB work.

**Step 3 — run** `cd backend && uv run pytest shared/tests/test_notify.py -v` → FAIL.

**Step 4 — implement.**

```python
NOTIFICATION_KINDS: dict[str, type[BaseModel]] = {
    "team_invite.received": TeamInviteReceivedPayload,
    "team_invite.answered": TeamInviteAnsweredPayload,
    "registration.approved": RegistrationDecisionPayload,
    "registration.rejected": RegistrationDecisionPayload,
    "encounter.report_disputed": EncounterReportDisputedPayload,
    "announcement.published": AnnouncementPayload,
}

async def notify(
    session: AsyncSession,
    *,
    kind: str,
    payload: dict[str, Any],
    audience: Literal["user", "workspace", "global"] = "user",
    recipient_auth_user_id: int | None = None,
    workspace_id: int | None = None,
    actor_auth_user_id: int | None = None,
    published_at: datetime | None = None,
    expires_at: datetime | None = None,
) -> Notification: ...


async def publish_notification_created(redis, *, recipient_auth_user_id: int) -> None:
    """Thin, non-durable 'go refetch' signal. Best-effort; the row is already durable."""
```

`AnnouncementPayload` carries `locales: dict[Literal["ru","en"], AnnouncementText]`, `default_locale`, `href: str | None`, and a
model validator implementing Global Constraint 5 — the audience is passed to the validator, so the global/workspace rule lives in one
place. `publish_notification_created` uses `realtime_topics.user_notifications(uid)`, `WorkspaceEventEnvelope(event_id=0,
event_type="notification.created", ...)`, `publish_envelope_to_redis`, wrapped in `try/except Exception` + `logger.exception`.

`user_notifications(user_id: int) -> str` returns `f"user:{int(user_id)}:notifications"`.

**Step 5 — run the tests** → PASS. Also `cd backend && uv run pytest shared/tests/test_notification_model.py -v` to prove Task 1 still
passes after the `__init__` change.

**Step 6 — commit** the four paths with `feat(notifications): add transactional notify() helper and user topic`.

---

## Task 3: repository — audience predicate, cursor page, unread count, mark-read

**Files:**
- Create: `backend/shared/repository/notification.py`
- Test: `backend/shared/tests/test_notification_repository.py`

**Step 1 — read** `anchors-backend.md`: `BaseRepository` API (`select/get/get_by/create/update_fields`, all `flush()`, never `commit()`)
and `DiscordChannelRepository` as the subclass template. Also read `backend/shared/services/workspace_roster.py:282
workspace_member_user_ids` — it is one half of the `:workspaces` union; the other half is the roster join described in the Data model
section.

**Step 2 — write the failing tests:**
- `test_other_users_personal_notification_is_invisible` — two users, one `audience='user'` row each; each page contains only its own.
- `test_workspace_notification_needs_membership` — a `audience='workspace'` row is absent for a non-member, present for a roster
  member, present for an RBAC role holder.
- `test_global_notification_is_visible_to_everyone` — including a user with no workspaces at all.
- `test_unpublished_and_expired_rows_are_hidden` — `published_at` in the future and `expires_at` in the past are both filtered.
- `test_cursor_page_is_stable_when_published_at_ties` — insert 5 rows in ONE transaction (identical `published_at`, since
  `func.now()` is the transaction start), page with `limit=2`, walk the cursor: all 5 come back exactly once. This is the bug
  `AuditLogService._order_by` documents for offset pagination.
- `test_unread_count_excludes_read_rows`.
- `test_mark_read_ignores_ids_outside_the_audience` — marking another user's notification id inserts **no** row and does not raise a
  distinguishable error (no existence oracle).
- `test_mark_read_is_idempotent` — marking twice leaves one row.

**Step 3 — run** `cd backend && uv run pytest shared/tests/test_notification_repository.py -v` → FAIL.

**Step 4 — implement** `NotificationRepository(BaseRepository[models.Notification])`:
`audience_clause(*, auth_user_id, workspace_ids)`, `page(session, *, auth_user_id, workspace_ids, cursor, limit)` ordering
`published_at DESC, id DESC` with the cursor as an `(published_at, id)` tuple comparison, `unread_count(...)`,
`mark_read(session, *, auth_user_id, notification_ids | all=True)` (an `INSERT ... ON CONFLICT DO NOTHING` fed by a SELECT that
already applies `audience_clause`), and `active_global(session, *, auth_user_id: int | None)` for the banner.

**Step 5 — tests** → PASS. **Step 6 — commit.**

---

## Task 4: app-service RPC — inbox reads and mark-read

**Files:**
- Create: `backend/app-service/src/rpc/notifications.py`, `backend/app-service/src/schemas/notification.py`
- Modify: `backend/app-service/serve.py` (import + `notifications.register(broker, logger)`),
  `backend/app-service/src/schemas/__init__.py` (add the re-export beside the other schema modules)
- Create: `backend/app-service/src/services/notifications.py` (workspace-id resolution + Redis cache, page assembly)
- Test: `backend/app-service/tests/test_notifications_rpc.py`

**Step 1 — read** `anchors-rpc-gateway.md` sections 1-4: `serve.py` is the registry (`src/rpc/__init__.py` is a 0-byte package marker —
do not touch it), `_common.py` helpers (`c.actor`, `c.optional_actor`, `c.require_active`, `c.envelope`), the `users.py` subscriber
template, and the pagination helpers.

**Step 2 — write the failing tests** (`_rpc_fakes.py`-style fakes as in `tournament-service/tests`):
- `test_list_returns_items_unread_count_and_cursor` — one response carries all three; a second call with the returned cursor returns
  the next page.
- `test_list_requires_identity` — no `data["identity"]` → the envelope's `unauthorized` error, not a 500.
- `test_active_announcements_anonymous_returns_only_global` — `optional_actor` is None → no personal, no workspace rows.
- `test_mark_read_with_foreign_id_is_a_no_op` — response is success, no read row written.

**Step 3 — run** `cd backend && uv run pytest app-service/tests/test_notifications_rpc.py -v` → FAIL.

**Step 4 — implement three subscribers** — `rpc.app.notifications_list`, `rpc.app.notifications_mark_read`,
`rpc.app.active_announcements` — each `c.envelope(logger, "<label>", op, session_factory=_SF)`. `active_announcements` uses
`c.optional_actor`. The service layer owns the `:workspaces` union and its 60 s Redis cache keyed per `auth_user_id`.

**Step 5 — tests** → PASS. **Step 6 — commit.**

---

## Task 5: app-service RPC — announcement CRUD and the permission

**Files:**
- Create: `backend/app-service/src/rpc/announcements.py`, `backend/app-service/src/schemas/announcement.py`
- Modify: `backend/shared/rbac/catalog.py` (add `*_crud("announcement")` to `PERMISSION_CATALOG`), `backend/app-service/serve.py`
- Create: `backend/app-service/src/services/announcements.py`
- Test: `backend/app-service/tests/test_announcements_rpc.py`

**Step 1 — read** `anchors-backend.md` §8 (catalog ⇒ `_admin_permission_names()` picks new resources up automatically; check whether a
test pins the catalog contents and update it if so) and `backend/app-service/src/rpc/audit.py` for the authorization-scope pattern
(`_scope`).

**Step 2 — write the failing tests:**
- `test_global_announcement_requires_superuser` — a workspace owner (holds `announcement.create` in the workspace) gets 403 for
  `audience="global"`; a superuser succeeds.
- `test_workspace_announcement_requires_workspace_permission` — non-member 403, owner succeeds.
- `test_global_announcement_without_english_is_rejected` — 422 at the RPC boundary (Global Constraint 5).
- `test_create_writes_audit_row` — one `audit_log` row with `action="announcement.create"` and the announcement as the entity.
- `test_update_does_not_clear_read_marks` — editing the text of a published announcement leaves `notification_read` untouched.

**Step 3 — run** → FAIL. **Step 4 — implement** four subscribers (`announcement_list|create|update|delete`), each calling `notify()`
for create, `record_admin_audit` for all three mutations, and `require_superuser` for the global audience.

**Step 5 — tests** → PASS, plus `cd backend && uv run pytest shared/tests/test_notify.py -v` (the locale validator is shared).
**Step 6 — commit.**

---

## Task 6: gateway — routes and the realtime ACL rule

**Files:**
- Create: `gateway/internal/app/notifications_routes.go`
- Modify: `gateway/cmd/gateway/main.go` (register the two tables), `gateway/internal/acl/acl.go` (`user:*:notifications` rule)
- Test: `gateway/internal/acl/acl_test.go` (add cases)

**Step 1 — read** `anchors-rpc-gateway.md` §5-§9: `edge.RouteSpec` fields, the `main.go` registration and `acl.New` sites, the
route-parity test mechanics, and the `acl_test.go` table shape.

**Step 2 — write the failing Go tests** in `acl_test.go`:
- `user:7:notifications` with `user.ID == 7` → allow.
- `user:7:notifications` with `user.ID == 8` → deny.
- `user:7:notifications` anonymous (`user == nil`) → deny.
- `user:7:notifications` with `user.ID == 8, IsSuperuser: true` → **deny** (no inbox snooping; the rule has no bypass).
- `user:abc:notifications` → deny (unparseable id).

**Step 3 — run** `cd gateway && go test ./internal/acl/ -run TestAllow -v` → FAIL.

**Step 4 — implement** the rule and the route table. Rule placement does not matter: patterns are segment-matched and
`user:*:notifications` cannot collide with `workspace:*:*`. Register it beside the other identity-scoped intent for readability.

```go
var NotificationRoutes = []edge.RouteSpec{
	{Method: "GET",  Pattern: "/api/notifications",      Queue: "rpc.app.notifications_list",      AllQuery: true, Auth: edge.AuthRequired},
	{Method: "POST", Pattern: "/api/notifications/read", Queue: "rpc.app.notifications_mark_read", Body: true,     Auth: edge.AuthRequired},
}

var AnnouncementPublicRoutes = []edge.RouteSpec{
	{Method: "GET", Pattern: "/api/announcements/active", Queue: "rpc.app.active_announcements", Auth: edge.AuthOptional},
}

var AnnouncementAdminRoutes = []edge.RouteSpec{
	{Method: "GET",    Pattern: "/api/v1/admin/announcements",      Queue: "rpc.app.announcement_list",   AllQuery: true,        Auth: edge.AuthRequired},
	{Method: "POST",   Pattern: "/api/v1/admin/announcements",      Queue: "rpc.app.announcement_create", Body: true,            Auth: edge.AuthRequired, Success: 201},
	{Method: "PATCH",  Pattern: "/api/v1/admin/announcements/{id}", Queue: "rpc.app.announcement_update", IDParam: "id", Body: true, Auth: edge.AuthRequired},
	{Method: "DELETE", Pattern: "/api/v1/admin/announcements/{id}", Queue: "rpc.app.announcement_delete", IDParam: "id",         Auth: edge.AuthRequired, Success: 204},
}
```

`AuthOptional`, not `AuthNone`, for the public read: the handler needs the viewer to filter already-read announcements, and under
`AuthNone` the dispatcher never injects `data["identity"]` (the reason `stream.PublicRoutes` documents the same choice).

**Step 5 — run** `cd gateway && go test ./internal/acl/ -v` → PASS, then `cd gateway && go build ./...`, then
`cd backend && uv run pytest tests/test_rpc_route_parity.py -v` → PASS (all four queues have subscribers from Tasks 4-5).

**Step 6 — commit.**

---

## Task 7: producers in tournament-service

**Files:**
- Modify: `backend/tournament-service/src/services/registration/teams.py` (`invite_member`, `accept_invite`, `decline_invite`)
- Modify: `backend/tournament-service/src/services/tournament/events.py` (`enqueue_registration_approved`, `enqueue_registration_rejected`)
- Modify: `backend/tournament-service/src/services/encounter/map_report.py` (`submit_map_report`, disputed branch)
- Test: `backend/tournament-service/tests/test_notification_producers.py`

**Step 1 — read** `anchors-backend.md`'s producer section for the exact insertion points and how each site already reaches `session`,
the workspace id and the acting user. Recipient resolution: `players.user.auth_user_id`; a shadow player has `NULL` there → **no
notification, no exception**.

**Step 2 — write the failing tests** — assert the observable outcome (a row exists), never "the helper was called":
- `test_targeted_invite_notifies_the_invitee` — and `test_link_invite_notifies_nobody` (no `target_auth_user_id`).
- `test_accept_notifies_the_captain` / `test_decline_notifies_the_captain`.
- `test_approve_notifies_the_player` / `test_reject_notifies_the_player`.
- `test_disputed_map_report_notifies_both_captains`.
- `test_shadow_player_without_auth_user_is_skipped` — the mutation still succeeds.

**Step 3 — run** `cd backend && uv run pytest tournament-service/tests/test_notification_producers.py -v` → FAIL.

**Step 4 — implement** the six call sites. Each `notify(...)` goes *before* the existing `await session.commit()`; each
`publish_notification_created(...)` goes *after* it. Add the `ponytail:` comment about de-duplication at the `notify` call in
`events.py`.

**Step 5 — run** the new test file plus the existing registration/encounter tests the touched files own (name them in the report).
**Step 6 — commit.**

---

## Task 8: frontend — service, query keys, hooks, bell

**Files:**
- Create: `frontend/src/services/notification.service.ts`, `frontend/src/types/notification.types.ts`,
  `frontend/src/lib/notification-query-keys.ts`, `frontend/src/hooks/useNotifications.ts`,
  `frontend/src/components/notifications/NotificationBell.tsx`, `frontend/src/components/notifications/NotificationList.tsx`
- Modify: `frontend/src/components/Header.tsx` (bell inside the authenticated branch only)
- Test: `frontend/src/components/notifications/NotificationBell.behavior.test.tsx`

**Step 1 — read** `anchors-frontend.md` §1-§4 and §8-§9: `apiFetch` + service class convention, the query-key registry shape, the
`useRealtimeTopic` signature, the exact Header insertion point, the realtime-mocking test template, and which `components/ui`
primitives already exist (use them; do not add a popover library).

**Step 2 — write the failing behavior test:**
- unread count renders on the bell;
- firing the mocked `user:{id}:notifications` handler invalidates the list query (the component refetches);
- opening the list and clicking "mark all read" sends the mutation and the badge clears;
- anonymous (`useAuthProfile` → no user) renders nothing.

**Step 3 — run** `cd frontend && npx vitest run src/components/notifications/NotificationBell.behavior.test.tsx` → FAIL.

**Step 4 — implement.** Rendering: `t("notifications.kinds." + kind, payload)` — never text from the API (Global Constraint 4). Topic:
`user ? \`user:${user.id}:notifications\` : null`.

**Step 5 — tests** → PASS. **Step 6 — commit.**

---

## Task 9: frontend — announcement banner

**Files:**
- Create: `frontend/src/components/notifications/AnnouncementBanner.tsx`, `frontend/src/lib/announcement-dismissed.ts`
- Modify: `frontend/src/app/(site)/layout.tsx` (immediately after `<Header .../>`), the admin layout (same position)
- Test: `frontend/src/components/notifications/AnnouncementBanner.behavior.test.tsx`

**Step 1 — read** `anchors-frontend.md` §5 for both mount points.

**Step 2 — write the failing test:**
- anonymous: dismissing writes the id to `localStorage` and the banner does not come back on remount;
- authenticated: dismissing sends the `mark_read` mutation;
- the viewer's locale wins, and a missing locale falls back to `default_locale`;
- with two active announcements only the newest renders;
- nothing renders when the list is empty.

**Step 3 — run** the file → FAIL. **Step 4 — implement:** in-flow markup (not `position: fixed`), `role="region"` + `aria-label`, a
labelled dismiss button, no focus stealing. The layouts fetch the active list server-side and pass it as `initial` so it does not
flash after hydration. Add the `ponytail:` comment about not merging anonymous `localStorage` dismissals into the DB at login.

**Step 5 — tests** → PASS. **Step 6 — commit.**

---

## Task 10: frontend — admin announcements page

**Files:**
- Create: `frontend/src/app/admin/announcements/page.tsx` + the form component under `frontend/src/components/admin/announcements/`
- Test: `frontend/src/app/admin/announcements/page.behavior.test.tsx`

**Step 1 — read** `anchors-frontend.md` §6 (`admin/audit/page.tsx` as the page template and how pages gate on permissions).

**Step 2 — write the failing test:**
- the audience select offers `global` only to a superuser;
- with `audience="global"`, submitting with an empty English title is blocked client-side (the server also rejects it);
- with `audience="workspace"`, one filled locale submits successfully;
- the `default_locale` choice is limited to the filled locales.

**Step 3 — run** → FAIL. **Step 4 — implement** the table (audience, `published_at`, `expires_at`, state) plus the create form with
one tab per locale. **Step 5 — tests** → PASS. **Step 6 — commit.**

---

## Task 11: i18n keys and documentation

**Files:**
- Modify: `frontend/src/i18n/messages/ru.json`, `frontend/src/i18n/messages/en.json` (both, same task — Global Constraint 7)
- Modify: `docs/architecture.md` §3 (add `user:{id}:notifications` to the realtime topic list), `docs/database_erd.md` (the two new
  tables), `backend/shared/README.md`, `frontend/README.md`
- Modify: `docs/plans/2026-09-07-notifications.md` → status line becomes `**Status:** implemented (YYYY-MM-DD)`

**Step 1 — read** `anchors-frontend.md` §7 for the namespace layout and what `messages.parity.test.ts` enforces.

**Step 2 — run** `cd frontend && bun test src/i18n/messages.parity.test.ts` → it must be green before and after; if the earlier
tasks added keys to only one file, this is where it fails first.

**Step 3 — sweep the namespace.** Tasks 8-10 added the keys they render. Add whatever is still missing: one message per notification
kind (ICU interpolation of the payload fields listed in the "Notification kinds" table) and any bell/banner/admin string still absent.
Both locales, identical key sets.

**Step 4 — run** `cd frontend && bun test src/i18n/messages.parity.test.ts` and the three behavior test files from Tasks 8-10.

**Step 5 — update the docs** listed above. `docs/architecture.md` §3's realtime paragraph must say the topic is non-durable (no event
row, no replay) and that its ACL rule is self-only.

**Step 6 — commit.**
