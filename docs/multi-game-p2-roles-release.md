# Multi-game P2 roles: release note and cutover runbook

P2 replaces role enums and writable roster-slot maps with a module-owned role ontology,
leaf assignments and relational team formats. The cutover is `discipline01b`, after P1's
`discipline01`; the expected Alembic head is `discipline01b`. See the
[architecture](./architecture.md), [role catalog](./database_erd.md#catalog--catalog) and
[team-format schema](./database_erd.md#roster--roster).

Deploy backend services, gateway schemas and frontend together. External clients must migrate
with them; there is no old-role wire compatibility layer. Take and verify a restorable backup
before the window. The revision is forward-fix only: rollback after commit means restoring the
backup and matching old application images, not `alembic downgrade`.

## Breaking API changes

1. **Role fields use `RoleRef {dimension, role, parent}`.** `role` is the assigned leaf; `parent`
   is its derived parent code (`null` for a module role). Requests use `{dimension, role}`;
   supplied `parent` is ignored. Overwatch module codes remain `tank`, `damage`, `support`,
   on `player_role`; workspace sub-role codes are **`<parent>_<slug>`**, such as `support_main`.
   Adjacent `sub_role` / `subrole` / `subtype` fields are removed where a leaf ref replaces the pair.
   Primary/secondary role fields and lists now carry refs rather than enum/string values.
   Affected surfaces include:
   - tournament teams and admin players, user profile/overview/compare/tournaments/encounters,
     and analytics player rows;
   - registration role APIs and admin balancer registrations (`role` + `subrole` becomes `role`);
   - mix players' `roles`, draft captain roles, pick target roles, board/options/suggestions,
     queues, journals and realtime role payloads;
   - balancer team-slot exports, encounter roster `roles`, and ML artifacts (`RoleRef | null`).
   Draft rank/source/sub-role/top-hero maps remain keyed by **top-level codes**, not refs.
   User GET role filters carry JSON-encoded refs, for example
   `role={"dimension":"player_role","role":"support"}`. On overview, overview stats and
   catalog reads, **omitted `role` means no filter; explicit `role=null` means no rated-role
   assignment**. The OW UI maps its Flex chip to null; compare controls do not offer Flex.
   A player's sub-role must exist in the owning workspace's ontology, no longer as free text.
   Admin player `RoleRef` writes reject an unknown leaf with 422 `unknown_role`; the separate
   registration form-pair resolver rejects an unknown sub-role with 422 `unknown_sub_role`.
   The public registration form answer deliberately retains
   `{role, subrole?, is_primary, top_heroes?}` with the suffix (`main`), not `support_main`.
   The `rpc.tournament.sheet_players_export` public `format=owt-1` export now emits leaf refs in
   `players.*.owt.primary_role` (nullable) and `players.*.owt.roles[].role`, without adjacent
   sub-role fields; its frozen solver document `stats.classes` is unchanged.
2. **Team formats replace roster slot maps.** Removed wire fields: tournament
   `roster_slots_json`, workspace `default_roster_slots_json`, and host `role_mask` / `roster_shape`
   editing on `/api/v1/me/mix-preferences`. Use `TeamFormatRead` / `TeamFormatWrite` on:
   - `GET|PUT /api/v1/admin/tournaments/{tournament_id}/team-format`;
   - `GET|PUT /api/v1/workspaces/{workspace_id}/team-formats/{discipline}`.
   A tournament owns an editable copy of its workspace default (else module preset), not live
   inheritance. The roster editor's **inherit** choice is removed: admins select a preset or
   custom format instead. A mix freezes its copy at creation: explicit `team_format_preset`,
   else a clone's format, else workspace default, else module preset. Template edits do not
   change existing events.
3. **`RosterShapeRead` gains `dimension`.** Its source is `tournament | custom_game | workspace |
   preset`; slot keys are rated-dimension role codes, with `flex` for open slots. `flex` is never
   a catalog role or assignment, and an open `team_slot` has null role/dimension ids. Existing
   solver documents, registration slot codes and invite slot codes keep the `flex` open-slot key.
   `is_flex` (Full Flex) remains a separate player attribute.
4. **Balancer settings and results change.** `role_settings.flex` becomes `open_slot_settings`,
   including in mix preferences. `role_settings` keys are module-declared role codes, not the
   old `tank|damage|support|flex` enum. Result teams expose `format_violations` and
   `format_advisories`. Strict exports (`on_unresolved="error"`, including registered teams)
   reject hard violations with 409 `team_format_violation`. Skip-mode balance/draft exports and
   team imports return `advisories` with format violations and the names of skipped unresolved
   or duplicate members, allowing incomplete teams to be exported. Every active dimension is
   validated for starters; benches are excluded. Only the tournament **MOO** solver has the
   existing sub-role collision term. With no sub-role recommendation rules, its configured
   weight still applies to all sub-roles. When such rules exist, only active rated sub-role rules
   with `recommended_max <= 1` qualify; if none qualifies the weight is zero. Other recommendations
   and **all mix recommendations** are post-solve advisories and equal-objective tie-breakers;
   P2 adds no native solver objective.
5. **Discipline is explicit and immutable.** Tournament creation takes `discipline` (default
   `overwatch`); mix creation takes `discipline` and optional `team_format_preset`. The effective
   discipline, including a clone's, must be enabled in its workspace. Tournament reads expose
   `discipline`; workspace reads expose `disciplines_enabled`, writable only by a superuser.
   Catalog/role support alone does not enable the later LoL gameplay vertical.
6. **The sub-role admin API remains.** `/api/v1/admin/player-sub-roles` takes `discipline`
   (default `overwatch`) and returns `dimension`. Its `slug` remains the suffix (`main`), while
   ontology codes/RoleRefs use `support_main`. Codes are unique per workspace and dimension,
   not per parent. A parent cannot change (409 `sub_role_parent_fixed`); a code equal to a module
   role or `flex` is refused (409 `sub_role_code_reserved`). The parent-qualified code must fit
   64 characters. Retained `PlayerSubRoleService` and `PlayerSubRoleRead/Create/Update` names
   describe this API, not the retired `PlayerSubRole` ORM model/repository/table access.
7. **Cross-discipline maps return 404** when a mix sets or records a map or an admin edits a game map.

## Shipped storage and limits

App-service startup projects the modules' declarations through `shared.disciplines` into
`catalog.role_dimension` / `catalog.role`. Exactly one dimension per discipline is rated;
removed module roles are deactivated, not deleted. `CatalogRoleRepository` is the ontology
repository; the existing RBAC `RoleRepository` is unrelated. Sub-roles have immutable parents,
and each assignment stores one leaf, not a parent-plus-sub-role pair.

`encounter.team_member_role` now stores `(team_member_id, dimension_id, role_id)`. Its old text
rows remain in `encounter.team_member_role_legacy`. Composite assignment/quota foreign keys into
`catalog.role` are **`DEFERRABLE INITIALLY DEFERRED`**. `roster.team_format_legacy` is an independent,
migration-only owner/slot-map snapshot used to prove transfer completeness, not a runtime template.
P2 drops no legacy table, column or type. Legacy role columns and the three slot-map columns remain
unmapped and unused at runtime until the separately gated `discipline02` (P9).

Every P2 assignment/quota table has a leading role-id index, including draft captain/target
roles. Before restoring deferred checking, the migration refuses any `DEFERRABLE INITIALLY
IMMEDIATE` constraint rather than silently changing its default behaviour.

The balancer-config `role_settings.flex` → `open_slot_settings` rewrite is in place: the same
UPDATE moves the value and removes the old key, without retaining a before-image. The reconcile's
balancer-config class proves only that the old key is gone; it **cannot prove post-hoc that the
weight survived**. The migration fixture tests cover the transfer; keep the pre-cutover backup
for comparison if a weight is questioned.

Ranks remain code-keyed until P3. Migrated/preset formats set substitute bounds to zero;
registration benches still use `registration_form.max_substitutes`. Public ontology-driven UI,
role icons/colours and the fuller team-format editor are deferred to P7. The existing
`mixround01_reconcile.sql` seat class still expects the old text table; P9 must rebase it to
`team_member_role_legacy` before the later mix cleanup. Use the P2 reconcile below for this cutover.

## Before the window: preflight classes 2–8

1. Rehearse on an isolated restore with the exact release images and current migration chain.
   Follow the [P1 runbook](./multi-game-p1-catalog-release.md) too when P1 has not yet landed,
   including its catalog checks, lock-window measurement and hero-stats view population.
   Fixture tests do not certify production-scale migration duration.
   On the production-size restore, P9 rehearsal must capture EXPLAIN ANALYZE timings for the
   correlated `Player.role` / `Player.sub_role` queries used by stats and achievements.
2. Run the combined preflight from the repository root, then repeat it after writers are quiet:

   ```sh
   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/scripts/discipline01_preflight.sql
   ```

   **All numbered SQL result sets 1–8 must be empty.** The architecture plan's role-transfer
   class 2 is the informational off-catalog policy below; the script's numbered query 2 is
   P1's catalog-length check. Do not confuse those two numbering schemes:

   | Class / query | Required action |
   | --- | --- |
   | Script 1–2 (P1) | Resolve colliding map slugs and oversized catalog values; never truncate source values to bypass a stop. |
   | Role-transfer class 2 | Record the off-catalog and Flex-sub-role counts. An off-catalog value under a module role becomes an **inactive, unselectable** workspace sub-role with qualified code and preserved label. A Flex sub-role has no assignment and is listed as dropped; original text survives in legacy columns. These counts are informational, not blockers. |
   | 3 | Resolve unknown role values outside `tank`, `damage`, `support`, `flex` in every carried string role column, including rank/hidden-rank, registration, mix, draft, team-slot and ML-artifact rows. |
   | 4 | Remove/correct `flex` where a role is required: registration roles and mix role preferences. |
   | 5 | Resolve legacy encounter roster dimensions other than `player_role`. |
   | 6 | Resolve workspace sub-role collisions after `<parent>_<normalized slug>` generation, empty/oversized codes and non-module parents. Reusing `main` under different parents is valid because the codes differ. |
   | 7 | Correct slot maps that cannot become formats: invalid structure/keys/counts or a total outside 1–12. SQL NULL, JSON `null` and `{}` are absent, not invalid maps. |
   | 8 | Resolve ambiguous encounter members: more than one top-level role, more than one sub-role, or a sub-role without a role. Migration must not choose a leaf arbitrarily. |

   Fix listed source rows explicitly and retain the measured output. Prior dev-copy counts are
   not release evidence; measure the database being cut over.
3. Quiesce writes, scheduled producers, ingestion, sync and solver submissions. Drain old-image
   outbox, broker, job and realtime deliveries using the [P1 drain procedure](./multi-game-p1-catalog-release.md#before-the-window).
   Stop old workers/gateway and disconnect clients before migration. Do not replay old role-bearing
   jobs or events into new consumers without an audited translation.

## Cutover, while traffic remains stopped

1. From `backend/`, with the release database environment, run the complete chain once:

   ```sh
   uv run alembic upgrade head
   uv run alembic heads
   ```

   Require `discipline01b (head)`. Do not stamp past errors or apply fragments of the revision.
   The revision drains pending deferred checks before its ALTER operations and restores deferred
   checking afterwards; all role references must be valid at commit. A stop rolls back the
   enclosing upgrade transaction (including `discipline01` when in that transaction); inspect
   the actual revision if earlier revisions used committed autocommit blocks.
2. From the repository root, reconcile before allowing new writes:

   ```sh
   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/scripts/discipline01_reconcile.sql
   ```

   Require every summary class to say **`ok`**, and the mismatch detail result to be empty.
   Alongside P1 catalog/pick-ban classes this proves sub-roles, team formats, player roles,
   registration roles, encounter member leaves, mix roles, draft pins/picks, balancer slots
   and ML artifacts, scoped by owner, discipline and dimension. Capture the informational
   `off-catalog sub-roles (kept inactive)` and `flex sub-roles (dropped)` classes too.
   Require no unvalidated constraints:

   ```sql
   SELECT conrelid::regclass, conname FROM pg_constraint WHERE NOT convalidated;
   ```

3. Clear cached old wire payloads with the namespace-scoped [P1 cache procedure](./multi-game-p1-catalog-release.md#cutover-while-traffic-remains-stopped),
   not `FLUSHALL`; restart matching new services, gateway and frontend. App-service startup must
   complete the ontology projection before admitting readers. Smoke user role reads/null filters,
   tournament/workspace format GET/PUT, registration leaf refs/form answers, mix creation/cloning,
   a recorded encounter roster, draft/export and sub-role admin (including fixed-parent rejection).
   Confirm a strict format-breaking export returns 409 and skip mode returns named advisories.
   Resume traffic/producers only after these gates pass.
4. Keep the backup and preflight/reconcile outputs. Inactive transferred sub-roles can be cleaned up
   deliberately through the admin API after release. Before `discipline02`, repeat reconciliation;
   legacy/new-value comparisons can report legitimate post-release edits, so P9 must adjudicate
   those rather than deleting legacy evidence or bypassing the gate. Once writes resume, restoring
   the backup loses new writes unless they are captured and replayed.

## Development/staging databases already at an earlier `discipline01b`

**Reset/recreate every such disposable database and replay the full current chain.** This unreleased
revision was amended across P2. Alembic will not rerun it just because its file changed; a database
already stamped `discipline01b` can lack later assignments, constraints or transfers. Do not stamp
backward or run only selected SQL. Preserve needed fixtures outside the database, recreate, upgrade
and reseed. The same applies to disposable databases that ran an earlier P1 revision, as described
in the [P1 reset instructions](./multi-game-p1-catalog-release.md#developmentstaging-databases-already-at-an-earlier-discipline01).
This is **not** permission to reset a release database.

For the repository's ephemeral host-test database only, from the repository root:

```sh
docker compose -f docker-compose.test.yml down
docker compose -f docker-compose.test.yml up -d --wait
```
