# Multi-game P3 ranks and identity: release note and cutover runbook

P3 moves ranks and hidden ratings onto catalog roles, puts native rank reading and ladders behind
`shared.disciplines`, scopes division grids and workspace defaults by discipline, and selects game
identity providers from the owning module. The cutover is `discipline01c`, after P2's
`discipline01b`. See the [architecture](./architecture.md), [rank schema](./database_erd.md#member_rank--balancer)
and [grid schema](./database_erd.md#division_grid--public).

Deploy backend services, gateway schemas and frontend together: there is no old-wire compatibility
layer. Take and verify a restorable backup before the maintenance window. The migration is
forward-fix only; rollback after commit means restoring that backup and matching old images, not
`alembic downgrade`. This note records local implementation evidence, not a production deployment.

## Breaking API and behavior changes

1. **Effective rank source `ow` becomes `native`.** Registration/author overrides precede workspace
   canon and then the module's `native_ranks` hook. Rank dictionaries still use role codes within
   one discipline, but storage and hidden-rating replay use catalog role IDs. Workspace rank/roster
   RPCs accept `discipline`; omission uses the workspace's first enabled discipline. Known event
   consumers pass their own discipline. Overwatch and LoL `support` cannot share a rank row.
2. **Grids belong to one discipline.** Grid reads/create/import/copies carry `discipline`; creation
   validates that it is enabled and, if omitted, selects the workspace's first enabled discipline.
   Tier fields `ow_rank_min/max` become `native_rank_min/max`; internal `rank_min/max` are unchanged.
   Overwatch declares its 45-tier native ladder; LoL has none. A new LoL grid starts empty and needs
   organizer-entered tiers. LoL tournament/mix creation, mix cloning and scoped runtime reads with
   no usable LoL grid fail with **422 `division_grid_required`**, before owner/scoring writes.
   Another game's default never satisfies the requirement. An explicit tiered event pin is valid
   without activating a workspace default.
   *(2026-10-21: superseded. LoL now declares its 31-tier league-v4 ladder: a new LoL grid is seeded with it, and a
   LoL event without a grid of its own falls back to it instead of answering 422 — see
   [the Riot/LoL release note](./releases/2026-10-21-riot-lol.md).)*
3. **Workspace defaults are independent maps, not a scalar.** Both WorkspaceRead surfaces expose:
   - `default_division_grid_versions: {discipline: version_id}` — explicit assignments only;
   - `effective_division_grid_versions: {discipline: DivisionGridVersionRead}` — public persisted
     version/tier payloads, including same-game system fallback.

   Missing persisted versions are omitted, never fabricated IDs or rows. The old
   `default_division_grid_version_id` / `default_division_grid_version` fields are removed.
   Workspace create/update reject those old scalar fields **and writable assignment/effective
   maps**; use grid activation. Activating OW, then LoL, then another OW version preserves the LoL
   assignment. Archive/delete/version-delete checks and cache invalidation are discipline-scoped;
   valid tournament pins remain unchanged. No first-map-entry fallback is allowed for known owners.
4. **Portable exports are `division-grid/v2` with `discipline`.** The actual `_read_v1_as_overwatch`
   import reader accepts user-held `division-grid/v1` as Overwatch and translates `ow_rank_min/max`
   to native bounds. A v1 file declaring any discipline is refused; conflicting old/new bound
   values are refused. Exports never write v1. Marketplace fingerprint payload keys remain
   `ow_rank_min` / `ow_rank_max` deliberately: their historical digest is unchanged
   (`cbe3808b54bac98d78ff9c17e518b349d5d954a2dfde7da362d4d694e011a255`). They are persisted hash keys,
   not runtime API aliases. A previously library/sync-imported v1 file can hash differently after
   canonical v2 validation and create a new grid on re-import; this one-time user-file limitation
   is accepted.
5. **Tournament identity follows the module.** `TournamentRead.identity_provider` is computed from
   discipline: `battlenet` for Overwatch, **`riot`** for LoL. Backend `default_schema(provider)`
   requires it. Default identity questions, roster primary/extras/order, chat handles and parser
   matching use that provider, with no Battle.net substitute for a missing Riot handle. Parser
   matching remains team-scoped. Riot IDs use `Name#TAG`: name 3–16 characters without `#`, tag
   3–5 alphanumeric characters. Normalization trims outside/around `#`, preserves inner name
   spaces and display casing, and backend matching casefolds the result. Riot PUUID is not added.
   Sheets retain the `battle_tag_list` parser identifier but dispatch parsing by the identity
   target's provider: Riot alphanumeric tags and inner spaces survive preview/sync, and invalid
   nonempty values reach form validation instead of disappearing. Generated Riot record keys
   preserve space-distinct names; explicit record-key normalization stays unchanged. Organizer
   attach with a known tournament selects its provider before matching or creating an identity.
   *(2026-10-21: Riot Sign-On shipped; a verified `riot` social account stores the PUUID as `provider_user_id` —
   [the Riot/LoL release note](./releases/2026-10-21-riot-lol.md).)*
6. **Open slots no longer have rank rows.** `flex` is no role: migrated open-slot rank/hidden-rating
   rows are removed from live tables and listed in the migration audit. Such seats still affect
   match results but store no hidden rating and move no host book. Unknown/flex rank writes and
   clears are refused rather than inventing role IDs.
7. **Native-only reads remain gated.** OverFast registration enrichment columns and rank autofill's
   retained `ow` stage run only for a discipline declaring a native layer. The overview's `ow`
   layer/`ow_division`/`ow_tier`, profile-visibility path and `include_ow_rank_mappings` vocabulary
   remain OverFast-specific; `native` is the effective-source wire name, not a promise of another
   native provider implementation.
   *(2026-10-21: superseded. The overview layer is `native` with `native_division`/`native_tier`, the import flag is
   `include_native_rank_mappings`, and LoL has its own native implementation (Solo/Duo from the Riot API); profile
   visibility stays Battle.net-only — [the Riot/LoL release note](./releases/2026-10-21-riot-lol.md).)*
8. **Receiving UI honors ownership.** Legacy OW statistics explicitly select OW even when LoL is
   first enabled. Known tournament pins/discipline reach edit controls, nested crests, autofill and
   pick/ban displays. Unresolved/pending/failed owner or pin metadata exposes no different game's
   controls. LoL overview/history show organizer ranges/icons, not OW's 45-tier ladder, native
   column or fallback crests. Pin-only LoL editors need no workspace activation. Null or omitted
   `rank_max` stays open-ended through typing, blur and save; existing native role dimensions are
   preserved. History retains separate source-version, workspace-normalized and owner-edit scales.
9. **Default forms wait for their known owner.** Pending/error owner metadata cannot generate or
   save an implicit Battle.net form. Loaded existing forms and edits survive delayed provider data.
   A required Riot field cannot be satisfied by a Battle.net answer. Optional admin game identities
   stay optional: fresh manual/self-service/sheet registrations initialize identity collections
   before flush, while persisted readers retain eager loading. No lazy-load exception is hidden.

## Storage and migration evidence retained

`balancer.member_rank` and `member_hidden_rating` now store `(role_id, dimension_id)` for the rated
module role. Rank partial unique indexes use role ID; hidden ratings are unique by
`(workspace_member_id, role_id)`. Composite role FKs are **`DEFERRABLE INITIALLY DEFERRED`**, with
leading role-ID indexes. Legacy codes normalize onto Overwatch's roles. The old nullable physical
`role` columns remain unmapped and unused until P9; the ORM `role` hybrid reads the catalog code.
Dropped flex rows retain their original JSON in migration-only `balancer.discipline01c_dropped_ranks`.

`division_grid.discipline` is non-null with the retained `overwatch` default and catalog FK.
Tier native columns are renamed **in place**, not copied: numeric values, reversed bounds, NULLs
and large integers are preserved. There are no old grid-bound columns for P9 to drop.
`public.workspace_division_grid_default` has primary key `(workspace_id, discipline)`, version and
workspace cascading FKs, discipline FK and a version index. The migration copies each valid old
workspace pointer according to its actual grid ownership. Missing/foreign pointers stop preflight.
The old workspace pointer/constraint is retained unmapped for initial reconciliation and P9 cleanup;
activation does not dual-write it. Initial pointer equality is not a perpetual invariant after
legitimate new activations.

ORM-derived ERD, SQL/DBML and frontend schema snapshots describe mapped runtime tables, **not all
physical legacy migration storage**. They intentionally omit the retained old pointer/role columns
and audit-only tables. `overwatch_rank.*` remains the OW module's data, with the collector process
still in parser-service until P5.
*(2026-10-21: `rank01` renamed `overwatch_rank` to the shared `rank` schema with a `discipline` per row; Overwatch and
LoL collectors both run as module jobs in `stats-worker` — [the Riot/LoL release note](./releases/2026-10-21-riot-lol.md).)*

## Before the window and cutover

1. Rehearse on an isolated restore with exact release images. Follow the
   [P1](./multi-game-p1-catalog-release.md) and [P2](./multi-game-p2-roles-release.md) runbooks for the
   earlier chain, including backup, producer/queue drain, cache handling and catalog-view population.
   Fixture tests do not measure production-scale lock duration.
2. Run the combined preflight from the repository root, and repeat after writers are quiet:

   ```sh
   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/scripts/discipline01_preflight.sql
   ```

   All numbered result sets **1–11 must be empty**. P3 adds 9 (member-rank normalized collisions),
   10 (hidden-rating normalized collisions), and 11 (missing/foreign workspace grid pointers).
   Fix listed rows explicitly, never truncate or silently select a duplicate. Retain the informational
   flex-rank/hidden-rating drop count as well as earlier phase counts.
3. With traffic and old writers stopped, run the full chain once from `backend/`:

   ```sh
   uv run alembic upgrade head
   uv run alembic heads
   ```

   Require **`discipline01c (head)`**. Do not stamp past failures or apply revision fragments.
   The revision flushes pending deferred checks before DDL, resolves existing object names
   structurally, refuses unexpected INITIALLY IMMEDIATE deferrable constraints, and restores
   deferred checking. It performs no early `discipline02` cleanup.
4. Before allowing new writes, reconcile from the repository root:

   ```sh
   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/scripts/discipline01_reconcile.sql
   ```

   Every summary class must say `ok` and mismatch details must be empty. Capture P3's `member ranks`,
   `hidden ratings`, `workspace grid defaults` and informational `flex ranks (dropped)` alongside
   prior classes. Require no rows from:

   ```sql
   SELECT conrelid::regclass, conname FROM pg_constraint WHERE NOT convalidated;
   ```

5. Clear the namespace-scoped caches and restart matching new services as in P1, not `FLUSHALL`.
   P3 cache keys scope workspace defaults/source versions by discipline; the effective namespaces
   use v3, and immutable version snapshots remain ID-keyed. Smoke separate OW/LoL defaults, pin-only
   LoL events, missing-grid 422s, v1 import/v2 export, rank role isolation, default provider forms,
   optional admin identity creation and provider-matched roster/chat/parser reads. Resume producers
   and traffic only after gates pass. Preserve backup and observed preflight/reconcile output.

## Disposable databases already at an earlier `discipline01c`

**Reset/recreate them and replay the complete current chain.** This unreleased revision was amended
across P3; `upgrade head` will not rerun an amended revision already recorded as applied. Do not
stamp backward or apply selected SQL. Preserve required fixtures externally, recreate, upgrade and
reseed. This is not permission to reset a release database. For the repository host-test DB only:

```sh
docker compose -f docker-compose.test.yml down
docker compose -f docker-compose.test.yml up -d --wait
```

## Known limits and phase ownership

- **Cached native bounds remain limited.** Final source inspection of
  `shared/services/division_grid/cache.py` confirms `DivisionGridTierSnapshot` still carries only
  internal ranges and drops `native_rank_min/max` when making a runtime tier. Those cached runtime
  grids take the unconfigured native-containment path; the full-version registration reader preserves
  bounds. P3's scoping fixes do not claim to repair this pre-existing native-range cache limitation.
- **P5** re-homes the OverFast collector/client/scheduler/queues with the parser-to-stats service work.
- **P7** owns the grid discipline picker, complete ontology/native editor redesign, generic identity
  wire/UI renaming (retained `battle_tag`/`smurf_tags` included), registration primary-identity
  reconciliation and provider-explicit workspace roster upsert. The current primary-identity
  reconciliation/catalog-order and BattleTag-oriented workspace upsert are not represented as Riot
  lifecycle support. Concrete P3 owner/provider guards above are already shipped, not deferred.
- **P8** implements LoL end-to-end scenarios consuming P7's contracts. A second native-ladder module
  needs its own overview SQL and registration-enrichment implementation; P3 does not generalize
  OverFast profile visibility. LoL's current lack of native ranks is intentional.
  *(2026-10-21: LoL native ranks, its overview SQL twin and its registration enrichment shipped —
  [the Riot/LoL release note](./releases/2026-10-21-riot-lol.md).)*
- **P9** owns the combined release note and separately gated `discipline02`: drop retained rank role
  columns, workspace pointer/FK and flex audit, plus P1/P2 legacy storage. Reconcile before cleanup;
  adjudicate legitimate post-cutover edits rather than removing proof or bypassing a non-empty gate.
- No push, deployment, release-database operation or external OAuth/storage delivery is certified here.

## Observed implementation and runtime evidence

The comparison baseline is the recorded 2026-10-15 Task0 run at `d51a4b6f1`, not the plan's forecast
counts. Task5 integration is `379a2fec9` (parent `984e0ceaa`), followed by the reviewed sheet/organizer
receiving repair `7b5870288`. Task reports retain focused command history, failures and affected-path
repairs; their counts are worker observations, not a substitute for the final matrix.

- Real PostgreSQL migration/service checks covered normalized carry and collisions, scrambled
  constraint names, role/dimension corruption refusal, flex audit, independent same-workspace OW/LoL
  ranks/defaults, warmed cache/SQL/batch/full-model parity, event-pin preservation, create/clone
  refusals before writes, v1/v2 round trips and transaction rollback. Historical fingerprint regression
  retained the digest above. Task5's focused observations total 238 distinct backend and 70 frontend
  tests; production typecheck, touched lint and hooks passed.
  The subsequent receiving repair observed 87 focused tests passing. Its real CSV HTTP/service/DB
  smoke made 12 successful requests, preserved space-distinct Riot keys through sync/re-sync, and
  reloaded provider-visible roster/chat rows. A separate parser process matched 5 inferred-key Riot,
  4 explicit-key Riot and 2 OW handles, with zero matches under each wrong provider. Static reviews
  closed without remaining findings (Task4 0.98, Task5 frontend 0.94, repaired backend 0.99 confidence).
- Parent-owned isolated PostgreSQL16/55433 + actual RabbitMQ/Redis/gateway/workers/Next/browser
  exercised genuine authentication, v1 OW import and v2 exports, simultaneous explicit/effective
  OW/LoL maps, active/absent LoL overview without OW representations, and preserved OW native display.
  A LoL event with a tiered pin and **no** workspace LoL default opened its real editor; slider 200,
  numeric 1500 after blur, correct high-tier crest and Save PATCH 200 were observed. Fresh registration
  GET preserved `{dimension:"position",role:"support"}` and rank 1500; defaults stayed empty.
- After the Task5 worker restart, the exact earlier-failing actual HTTP manual-registration request
  with `auth_user_id: 1`, no answers/game identity and LoL support rank 100 succeeded; fresh GET
  persisted registration 3/player 1/rank 100. An isolated DB read confirmed workspace member 2
  and zero registration-identity rows. Actual tournament GET returned `identity_provider: riot`.
  No fabricated identity or application workaround was used.
- Parent real-browser network throttling held the owner GET pending for 3.5 seconds: no default
  form or save action appeared. When LoL metadata arrived, the actual Riot ID default appeared.
  Creating the form sent PUT 200 and persisted required `identity_riot`, without `identity_battlenet`.
  Editing the title also saved with PUT 200. The OW control form separately saved with PUT 200 and
  required `identity_battlenet` only.
  A later supported route abort caused four actual owner GET failures through retry exhaustion
  after simulated reconnect. Existing Riot questions, a distinct unsaved title and enabled Save
  survived, with no Battle.net replacement (`task-5-loaded-owner-error.webp` in the phase evidence).
  After removing the route override, real Save returned PUT 200; a fresh GET preserved the edited
  title and Riot provider. Parent stopped its isolated services and removed its smoke containers.
- Task5 full-file Prettier initially flagged 17 touched TS/TSX files; all 17 changed-range checks
  passed after scoped formatting. Whole-file formatting cleanliness is not claimed and unrelated
  formatting was not broadened. Existing DOM/localStorage/network and hook-dependency warnings
  remain visible in the task evidence.

## Final phase matrix

After both Task5 reviews cleared on source `7b5870288`, one complete matrix ran against a reset
local test PostgreSQL on 55432. Backend service suites ran in separate, sequential processes;
frontend used one worker. The parent browser database on 55433 was never touched by this gate.
The comparison is `.claude/p3-ranks-baseline.txt` (snapshot DAAC), including original failure
causes, not just matching test names.

| Suite | Recorded baseline passed / failed / skipped | Full matrix passed / failed / skipped | Affected-only follow-up |
| --- | --- | --- | --- |
| shared | 1571 / 0 / 12 | 1610 / 6 / 12 | SQLite scrim fixture: 10 passed |
| balancer | 988 / 1 / 3 | 994 / 1 / 3 | Same baseline failure; not rerun |
| tournament | 1515 / 5 / 47 (baseline retry) | 1561 / 10 / 29 | Registry producer + identity + roster + limiter files: 40 passed |
| parser | 395 / 0 / 0 | 397 / 0 / 0 | None needed |
| app | 760 / 116 / 15 | 762 / 125 / 3 | Workspace notification fixture: 11 passed |
| analytics | 205 / 0 / 0 | 205 / 0 / 0 | None needed |
| discord | 127 / 0 / 0 | 127 / 0 / 0 | None needed |
| backend root | 331 / 1 / 0 | 356 / 2 / 0 | Obsolete exemption check: 1 passed |
| frontend | 368 files / 3233 tests passed | 370 files passed, 1 failed; 3272 tests passed, 1 failed | Roster file: 5 passed; final visible-tier assertion: 1 passed |

The 25 new backend failures were test-boundary drift, repaired without changing product behavior:
two narrow SQLite fixtures now include the tables queried by workspace loading; the pregame fixture
restores its temporary discipline registry entry; the real roster/invite DB test stubs only its
Redis limiter boundary using existing test seams; and the repository test removes the exemption
for a writer P3 removed. The dedicated fail-closed limiter tests still pass. The app fixture's first
partial repair was insufficient; a diagnostic exposed the additional missing `division_grid`
table, and the completed fixture passed all 11 cases. No baseline assertion was weakened.

Frontend's initial zone check found one route test in the shared component layer. Moving the
unchanged route test beside its page restored zero zone violations. The roster fixture now supplies
its explicit OW reference grid instead of relying on the removed implicit fallback; its assertion
checks the visible Diamond 5 crest and editable rank, not an incidental image count. Every one of
the 3273 collected frontend tests has a passing observation across the full run and focused repairs;
this is **not** a claim that a second full run occurred.

Remaining failures are the observed baseline: balancer's `announcement` versus `registration`
expectation; tournament's sequential coalescing result `(1, 1)` versus `(1, 2)`; all 116 app failure
IDs with identical summary causes (missing catalog/player fixtures, legacy `Player.div` references
and existing route errors); and the same eight unrelated direct-write offenders in the repository
boundary test. Baseline deadlock/other coalescing failures did not recur, which does not certify
their repair. No full-suite confirmation reruns were made.

Other completed gates:

- Ruff check clean; format check: 1859 files already formatted. Import contracts: 1 shared and
  4 app contracts kept, zero broken.
- OpenAPI check current: 7 service schemas, 1,490,151 bytes. All 589 routed RPC subjects documented.
  ERD/schema JSON check current. Alembic has the single `discipline01c` head.
- Go: 29 packages passed, 6 packages without tests. Frontend typecheck passed; ESLint had
  zero errors and the same 49 warnings; all five zone rules have zero violations.
- All requested generators ran. OW ladder bytes and schema JSON were unchanged; SQL had no semantic
  difference, while DBML only reordered one foreign-key declaration. ORM snapshots do not certify
  the retained migration-only legacy columns. The known CRLF-sensitive ladder byte check was not
  used as a release gate.
- Retired-symbol scan found only migrations/tests and sanctioned historical fingerprint/v1 import
  fields, including the frontend's real v1 upload type; no retired runtime helper or constant remains.

Normal PostgreSQL55432 was stopped again after checks, matching its initial state. This matrix
does not certify deployment, live external providers, whole-file Prettier cleanliness or resolution
of the cached native-bound limitation above.
