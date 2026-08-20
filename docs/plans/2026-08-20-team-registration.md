# Team-based registration — pre-formed teams register instead of players — design

Design produced against the shipped individual-registration pipeline
(`balancer.registration*`) and the two existing team-export paths
(`admin/balancer.py::export_balance`, `draft/export.py::export`).
Status: **design complete, peer-reviewed (3 rounds), APPROVED for implementation**
— conditional on the two release gates in §13. See §13 for the arbitration record.

## 1. Understanding summary

**What.** A per-tournament *team registration* mode. A captain creates a team,
fills typed `RosterShape` slots by inviting players, each invitee accepts and
supplies their own rank and OAuth-verified accounts, and an organizer then
explicitly materializes completed teams into `tournament.Team` +
`tournament.Player`. The balancer and the draft are not run at all for such a
tournament.

**Why.** Rosters that are decided outside the platform currently have to be
pushed through a free-agent pool and re-assembled by the balancer or a live
draft — a lossy, pointless round trip. There is today **no** notion of a team,
captain, group or invite anywhere in the registration slice.

**Who.** Captains and invited players (public surfaces), workspace
organizers/admins (moderation and materialization).

**Decisions taken with the organizer (2026-08-20):**

| # | Question | Decision | Rejected alternative |
|---|---|---|---|
| 1 | Intake model | **Teams only** — balancer and draft fully bypassed; `team_formation` gains a third value | Mixed pool (locked groups + free agents) — needs a "locked group" concept inside the balancer algorithm and `export.py`, plus top-up rules for short rosters. Grouping-only (`group_key` as a balancer soft constraint) — does not actually deliver pre-formed teams |
| 2 | Roster acquisition | **Hybrid** — captain drafts the roster, each member accepts an invite; the team is valid only once every slot is accepted | Captain types everything (`require_verified` becomes unenforceable for teammates, no consent). Pure invite-code self-registration (more steps, captain loses roster control) |
| 3 | Invite addressing | **Both** — one invite entity with a targeted `auth_user` mode (in-app) *and* a revocable expiring token link for people not yet on the site | Site-account-only (cannot invite a newcomer). Token-only (no in-app inbox, link leakage is the only path) |
| 4 | Roster shape | **Strict `RosterShape`** for the active roster **plus configurable substitutes** | Shape-only, no substitutes (real tournaments carry a bench). Free size 2..12 (loses completeness validation and bracket invariants) |
| 5 | Role & rank ownership | **Captain fixes the slot; the member supplies rank + their own verified accounts on acceptance** | Member picks roles freely via the existing `RoleStep` (team can assemble mis-shaped, needs a renegotiation screen). Captain proposes + member may swap slots (needs slot-race logic) |
| 6 | Materialization | **Explicit organizer action**, idempotent by team name, linked via `exported_team_id` — same contract as `export_balance` | Automatic on last acceptance (any later roster edit becomes a destructive re-export, painful once a bracket exists). Team status machine + phase-transition hook (implicit trigger, hard to test) |
| 7 | Capacity | **No cap, no waitlist** — existing time gates only | `max_teams` + 409 (needs race handling and a "do incomplete teams hold a slot" answer). Cap + waitlist promotion (a whole new state class for a scenario that does not exist today) |
| 8 | Mode switch placement | **`Tournament.team_formation = 'registration'`** — single source of truth for "how teams form" | A new `RegistrationForm.registration_mode` (two fields answering overlapping questions, needs a cross-validator) |
| 9 | Registration activation | **Schedule-only.** The `REGISTRATION` phase row becomes required and is the sole switch; `RegistrationForm.is_open` and `Tournament.allow_late_registration` are **removed** | Status + phase window only (flips the default from closed to open). One boolean moved onto `Tournament` (still two concepts, merely co-located) |
| 10 | Team-name collisions | **`unique (tournament_id, lower(name)) WHERE deleted_at IS NULL`** | Auto-suffix at export ("Alpha (2)" surprises people in the bracket). Organizer resolves manually (silent-merge risk if the warning is missed) |
| 11 | Team-level data | **Name + optional logo only** (`Team.name`/`balancer_name`/`image_url` already exist) | A second `custom_fields` engine scoped to the team |
| 12 | Roster edits pre-export | **Symmetric** — captain kicks, member self-withdraws, captaincy transferable; a departing captain must transfer or disband | Revoke pending invites only, organizer kicks. Captain-only control |
| 13 | Public read surface | **A separate "Teams" view** beside participants, plus one meta column on the participants list | Flat list + column only (rosters read poorly). Collapsible grouping inside `VirtualParticipantsList` (requires reworking its flat count/`getItemKey` model — highest-risk item in the feature) |
| 14 | Export approach | **Reuse the export seam**, preceded by consolidating the duplicated writer into `shared` | Direct `Team`/`Player` INSERT (re-implements newcomer flags, member creation, role mapping; becomes a third writer). Seed a `DraftSession` and draft-export (fabricates a completed draft that never happened) |
| 15 | Service placement | **Domain + invites in tournament-service**; materialization via RPC into balancer-service, which stays the single writer | Whole feature in balancer-service (registration gates would be pulled across a service boundary) |
| 16 | Refactor scope | **Migrate all three export paths onto the shared core inside this feature** | Only the new path (temporarily three copies of the orchestration — the exact debt this decision exists to remove) |
| 17 | Invite delivery surface | **The existing per-user "Your Registration" card on the tournament page** (`TournamentParticipantsPage.tsx:406-461`) — the place the invitee already visits to register, already translated, already carries personal state. A full notification subsystem is explicitly deferred | A dedicated "my invites" page (nobody would visit it — there is no bell, inbox, `/me` route, or email/push transport anywhere in the product). Token-links-only (would abandon targeted invites entirely). Building notifications now (its own feature; would block this one) |
| 18 | Rank on a role-less roster | **Not collected.** In a `has_role_slots=false` team tournament rank is meaningless — people arrive as teams — so only the nominal slot/role is recorded and `Player.rank` is written as `0` | Asking for a rank anyway (an unanswerable question: ranks are keyed `tank\|dps\|support` and `REGISTRATION_ROLE_CODES` has no `flex`). Extending `REGISTRATION_ROLE_CODES` with `flex` (blast radius across the rank and balancer machinery, outside this feature) |

**Non-goals.** Mixed pools and balancer "keep together" constraints; a team cap
or waitlist; automatic materialization; collapsible team grouping inside the
virtualized participants list; team-scoped custom fields; roster edits *after*
materialization (organizers use existing admin tooling, as today).

## 2. Grounded facts (verified against source, this session)

- `BalancerRegistration` is strictly one row per player:
  `uq_balancer_registration_user (tournament_id, workspace_member_id)` and
  `uq_balancer_registration_tournament_tag_active (tournament_id,
  battle_tag_normalized)`, both `WHERE deleted_at IS NULL`
  (`shared/models/registration/registration.py:133-156`).
- Identity is anchored **only** on `workspace_member_id` → `WorkspaceMember.player_id`;
  the column is nullable by design for admin/sheet rows with no resolved player
  (`registration.py:158-166`).
- **No** team/captain/group/invite concept exists in the registration slice.
  `team_name|captain|invite_token|party|squad` returns nothing across
  `shared/models/registration/`, `tournament-service/src/services/registration/`
  and `schemas/registration*.py`. The `captain_*` RPCs in `public_rpc.py:184-455`
  are match reporting on already-formed teams.
- Both existing team-formation paths converge on **one** writer:
  `export_balance` (`admin/balancer.py:241`) and draft `export` (`draft/export.py:139`)
  each build `list[BalancerTeam]` and call
  `balancer-service/src/services/team.py::bulk_create_from_balancer`.
- That writer is the sole place that resolves battle tags to users, calls
  `get_or_create_workspace_member`, computes `is_newcomer`/`is_newcomer_role` via
  `shared/services/newcomer_status.py::load_prior_participation`, and maps a slot
  code to `HeroClass` (`team.py:26-44`, `162-196`).
- A **second, near-duplicate** implementation lives in
  `parser-service/src/services/team/flows.py:162-275`, flagged as temporary debt
  in `docs/tournament-service-write-path-inventory.md:31`. The two diverge
  materially:

  | | balancer-service | parser-service |
  |---|---|---|
  | Unresolvable battle tag | silently skips the player (`team.py:164-166`), captain → `captain_id=None` | aborts with 400 `not_found` (`flows.py:150-158`) |
  | WorkspaceMember | `get_or_create_workspace_member` | `resolve_workspace_member_ids` |
  | Transaction | commits internally (`team.py:198`) | flush only, caller commits |
  | Substitutes | omitted → server defaults | explicit `is_substitution=False, related_player_id=None` |

- Neither writer supports substitutes. `Team.avg_sr`/`total_sr` are
  `column_property` correlated subqueries filtered on
  `Player.is_substitution.is_(False)` (`team.py:106-121`), so excluding the bench
  is automatic.
- `Player.rank` is `Integer NOT NULL`; `Player.workspace_member_id` is NOT NULL.
- Both export paths are **destructive-then-idempotent**: prior
  `Standing`/`Player`/`Team` rows reachable via `exported_team_id` are deleted and
  re-created (`admin/balancer.py:228-234`, `draft/export.py:128-136`), then
  `exported_team_id` is backfilled by matching `Team.balancer_name`.
- Registration openness is today a conjunction across two owners
  (`services/registration/windows.py:32-55`):

  ```
  form.is_open  AND  not is_finished_for_status(status)
                AND ( (status == REGISTRATION AND is_within_phase_window(REGISTRATION, …))
                      OR tournament.allow_late_registration )
  ```

- `is_within_phase_window` returns **True when no schedule row exists**
  (`shared/core/tournament_state.py:154-156`), whereas `form.is_open` defaults to
  **false** (`registration.py:39`). Rolling back to `REGISTRATION` from
  `CHECK_IN`/`DRAFT`/`LIVE` is already legal (`tournament_state.py:22-38`).
- `get_registration_count_by_tournament` counts `deleted_at IS NULL AND status != 'withdrawn'`
  with no notion of a placeholder (`services/registration/service.py:609-614`); it
  feeds the public `registrations_count` (`services/tournament/flows.py:101-107`),
  whose cache invalidation is documented as firing on every registration write
  (`cache_invalidation.py:56`).
- Safe by construction: the balancer pool export and draft pool both filter
  `status == "approved"` (`registration/export.py:74-79`,
  `draft/lifecycle.py:712-714`).
- `RosterShape` is the single shape authority: `ROSTER_SLOT_CODES =
  ('tank','dps','support','flex')`, `DEFAULT_ROSTER_SLOTS = {tank:1, dps:2, support:2}`,
  `MIN_TEAM_SIZE=2`, `MAX_TEAM_SIZE=12`, `has_role_slots` false only when every
  slot is `flex`, and `resolve_roster_shape(tournament_slots, workspace_slots)`
  resolves override → workspace default → default (`shared/domain/roster_shape.py`).
- `REGISTRATION_ROLE_CODES` is `tank/dps/support` only — `flex` is a **slot** code,
  not a registration role, so `registration_role` rows cannot express a role-less
  roster's slot.
- `Tournament.roster_locked_by_draft` already exists as a write-path guard against
  changing the shape mid-draft (`frontend/src/types/tournament.types.ts:124-128`).
- Frontend registration is player-centric end to end: `RegistrationForm` →
  `UnifiedRegistrationForm` (3 conditional steps) → `RegistrationCreateInput` →
  `Registration` → flat `VirtualParticipantsList` keyed by `registration.id`.
  `Tournament.team_formation` (`'balancer'|'draft'`) is the only existing
  "how teams form" switch, edited in `TournamentSettingsTab.tsx:284-289` and
  `RulesStep.tsx:36-41`.
- `flexMode: 'forced'` already hides per-row priorities and must seed the reducer's
  **initial** state, per the load-bearing comment at
  `UnifiedRegistrationForm.tsx:133-141` — the seam a locked-slot mode extends.
- The admin `AuthUserSearchCombobox` is gated by `auth_user:read` via `rbacService`.

## 3. Data model

Two new tables in the `balancer` schema (where every registration sibling lives),
and **three nullable columns** on `balancer.registration`. No slot table: the
roster *is* the set of registrations.

### 3.1 `balancer.registration` — additive only

| Column | Type | Notes |
|---|---|---|
| `registration_team_id` | FK → `balancer.registration_team.id` `ON DELETE SET NULL`, nullable, indexed | `NULL` = not on a team, so existing rows need no backfill |
| `team_slot_code` | `String(16)` nullable | The captain-assigned slot. **Not derivable** from `registration_role`: `REGISTRATION_ROLE_CODES` has no `flex`, but `_resolve_hero_role` maps `'flex'` → `HeroClass.flex` |
| `is_substitute` | `Boolean` default `false` | Bench member |

Deliberately *not* done: making an unaccepted invite a registration row. It would
silently inflate `get_registration_count_by_tournament` — a user-visible count with
no compiler to catch the regression. A registration row keeps meaning
"a real person registered".

### 3.2 `balancer.registration_team`

`tournament_id` FK CASCADE, indexed · `workspace_id` FK CASCADE, indexed ·
`name` `String(255)` · `name_normalized` `String(255)` (mirrors the
`battle_tag_normalized` convention) · `image_url` nullable ·
`captain_registration_id` FK → `balancer.registration.id` SET NULL ·
`status` `String(16)` default `'forming'` (`forming|complete|rejected|disbanded`) ·
`exported_team_id` FK → `tournament.team.id` SET NULL, indexed ·
`exported_at` · `export_status` · `deleted_at`/`deleted_by`.

Indexes:
- `unique (tournament_id, name_normalized) WHERE deleted_at IS NULL` — mirrors the
  export dedup rule, making a silent roster merge structurally impossible
- `(tournament_id, status) WHERE deleted_at IS NULL`

### 3.3 `balancer.registration_team_invite`

`team_id` FK CASCADE, indexed · `slot_code` `String(16)` · `is_substitute` `Boolean` ·
`target_auth_user_id` FK → `auth.user.id` SET NULL, nullable ·
`token_sha256` `String(64)` nullable · `expires_at` ·
`state` `String(16)` (`pending|accepted|revoked|expired`) · `invited_by` ·
`accepted_registration_id` FK SET NULL · `invited_at`/`accepted_at`.

- `unique (token_sha256) WHERE token_sha256 IS NOT NULL`
- `(team_id, state)`

**Token handling** (hardened after review — an earlier draft stored a raw
`token String(64)` with unspecified entropy). Redeeming this token creates a
registration bound to the redeemer's account inside a third party's roster and
consumes a shape slot, so it is a capability secret, not a room address. It must
match the repo's capability tier, not the scrim-room tier:

| Concern | Requirement | In-repo precedent |
|---|---|---|
| Entropy | `secrets.token_urlsafe(32)` (≥128-bit) | `ApiKey` uses `secrets.token_hex(32)` (`identity-service/src/services/api_key_service.py:258-259`) |
| At rest | store `sha256` only; the raw token is returned once, at creation | `ApiKey.secret_hash` (`shared/models/identity/api_key.py:30`), `code_sha256` (`shared/subscriptions/challenge_code.py:36-37`), OAuth state (`oauth_flows.py:187-188`) |
| Comparison | `hmac.compare_digest` | `oauth_flows.py:187-188`, pinned by `tests/test_oauth_state.py:93-105` |
| Expiry | folded **into** the guarded UPDATE (`… AND state='pending' AND expires_at > now()`), never checked separately | otherwise an expired token stays redeemable through the very race §8 exists to close |

`secrets.token_urlsafe(12)` stored raw (`shared/models/tournament/scrim.py:55-58`)
is explicitly **not** the bar to match: a scrim token only addresses a room.

Team completeness = group the team's registrations by `team_slot_code` and compare
to the resolved `RosterShape`.

## 4. Lifecycle and RPC surface

Naming follows the existing split — public `rpc.tournament.reg_pub_*`, admin
`rpc.tournament.reg_*`.

**Public (captain):** `regteam_pub_create` (team **and** the captain's own
registration in one transaction — the captain occupies a slot),
`regteam_pub_invite`, `regteam_pub_revoke_invite`, `regteam_pub_kick`,
`regteam_pub_transfer_captain`, `regteam_pub_disband`.

**Public (invitee):** `regteam_pub_accept` (targeted or token),
`regteam_pub_decline`. Leaving reuses the existing `reg_pub_withdraw_me`, which
additionally releases the slot.

**Public (read):** `regteam_pub_list`, `regteam_pub_get_me`.

**Admin:** `regteam_list`, `regteam_reject`.
**Materialization:** `rpc.balancer.teams.export_registered`.

### 4.1 Gate composition

`regteam_pub_create` and `regteam_pub_accept` are the only write paths that admit
a *person*, so both run the full existing stack, in order:

1. registration window (new schedule-only gate, §6)
2. `self_register` capability (`service.py:478-483`)
3. `assert_subscription_allows_registration`
4. `validate_registration_input`
5. `validate_verified_identity`
6. duplicate defence via `uq_balancer_registration_user` → `IntegrityError` → 409

`accept` delegates to the existing `create_registration`, so nothing is
reimplemented — the gates, the race defence and `assign_workspace_system_role` are
inherited. `accept` adds only: invite is `pending` and unexpired, the slot is still
unfilled against `RosterShape`, and `exported_team_id IS NULL`.

### 4.2 Mutation gates

Invite/kick/transfer/disband require the caller to be the team's captain and
require `exported_team_id IS NULL` (409 afterwards). A departing captain must
transfer captaincy or disband — never a silent orphan.

### 4.3 Realtime

> **Corrected after review.** An earlier draft published team/invite writes on the
> workspace-gated `balancer` topic and treated that as sufficient. Two errors:
>
> 1. **Too broad.** That topic's ACL is `IsWorkspaceMember`, and *every* successful
>    registration creates a `workspace_member` row via `create_registration` →
>    `ensure_player_identity` → `get_or_create_workspace_member`
>    (`registration/service.py:279`). Membership is **workspace**-scoped, not
>    tournament-scoped, so the real audience is anyone who has ever registered for
>    any tournament in that workspace — far wider than "not spectator data" implies.
> 2. **Cannot reach the invitee.** A *pending* invitee has no registration, hence no
>    `workspace_member` row, hence cannot subscribe at all. The in-app notification
>    path would miss the one person it exists for.

Resolution, following the repo's established thin-signal convention
(`logs.updated`, `subscription.updated`, `map_veto.updated` — a nudge carrying no
record data, client refetches through an authorized read):

- Publish a thin `registration_team.updated` on the existing `balancer` topic
  carrying **only** `tournament_id` and `team_id` — no names, no invite targets, no
  roster composition. Authorized clients refetch via `regteam_pub_list`, which
  applies its own visibility rules.
- **Invite delivery is pull-based in v1.** A new `regteam_pub_my_invites` read,
  authorized by the caller's own `auth_user_id`, is the invitee's source of truth;
  the token link works without any subscription. No realtime push to non-members,
  and no new public topic.

## 5. Materialization — one service, two paths

`backend/shared/services/team_export/`.

The orchestration sequence is **already** duplicated between `export_balance` and
draft `export`; a third copy is unacceptable. A single
`TeamMaterializationService` owns it once:

```
_run(plan) →  guard: refuse if Standing rows exist for the tournament
           →  cleanup prior Standing/Player/Team by exported_team_id
           →  insert Teams + Players (consolidated writer, §5.1)
           →  backfill exported_team_id by matching Team.balancer_name
           →  plan.finalize(session)   # per-path: stamp + optional event
           →  single commit
```

**Failure contract — two transactions, mandatory** (added after review; this is a
data-loss hazard, not a nicety). Today `export_balance` deletes the prior
`Standing`/`Player`/`Team` rows with no intervening commit and documents that
"the failure path below commits too, so the final state is identical either way"
(`admin/balancer.py:229-237`); its `except` branch sets `export_status="failed"`
and calls `session.commit()` (`:263-267`), which **flushes those pending
DELETEs** — a failed re-export already leaves the tournament with its old teams
gone and no replacements. Moving the commit out of the writer (§5.1) makes the
uncommitted destructive set strictly larger, so "single commit" is not a
sufficient specification. Required:

1. On success: one commit, as above.
2. On failure: **`await session.rollback()` first** — discarding the deletes and
   the partial inserts — then open a *fresh, short* transaction that re-loads the
   stamp target and writes `export_status='failed'` + `export_error`, then commit
   that. Rolling back alone would lose the operator diagnostics
   `admin/balancer.py:265-266` provides today; committing alone destroys data.
3. The stale comment at `admin/balancer.py:235-237` becomes false and must be
   rewritten in the same change, not left to mislead the next reader.

**Eager-load plan — required, not optional** (added after review).
`materialize_from_registered_teams` traverses `registration_team → registration →
workspace_member` plus `registration.roles`, all `relationship()` attributes
carrying the standing instruction "Readers needing the domain player must
eager-load this relationship (selectinload / explicit join) — never rely on a lazy
load in async code" (`registration.py:200-202`). In async SQLAlchemy an
unspecified access pattern does not merely get slow, it raises `MissingGreenlet`.
The consolidated writer already batches for exactly this reason — its docstring
records the fix ("Previously this issued ~5 sequential queries per player … It now
front-loads a handful of batch queries", `services/team.py:53-59`). The
registration path must therefore front-load: one query for the teams, one
`selectinload` for their registrations joined to `workspace_member`, one for
`registration.roles`. The same requirement applies to `regteam_pub_list` and the
Teams view (§7) — "no virtualization" answers render cost, never query shape.

> **Corrected after review.** An earlier draft put "enqueue the downstream
> analytics event" in the shared core and claimed the registration path could
> reuse it. Both are false. `enqueue_balance_exported_event` is called from
> exactly one place — `admin/balancer.py:260` — and takes a
> `models.BalancerBalance`; draft export emits **nothing**. `BalanceExportedEvent`
> requires `balance_id` (`balancer.balance.id`), `algorithm`, `avg_sr_overall`,
> `sr_std_dev`, `sr_range` and per-player `discomfort`/`was_off_role`
> (`shared/schemas/events.py:315-331`) — a registered team has none of them and no
> balance row at all. Event emission therefore belongs to `plan.finalize`, not the
> core: the balance path keeps emitting `balance_exported`, the draft path keeps
> emitting nothing, and the registration path emits nothing in v1. Analytics
> balance snapshots are consequently **not** produced for registration-sourced
> teams — an explicit non-goal, not an oversight. Standings, encounters,
> achievements and the analytics reads that join `Team`/`Player` are unaffected,
> since they never read `analytics.balance_snapshot`.

Two public entry points:

- **`materialize_from_balancer_payload(session, tournament_id, teams, *, on_unresolved="skip")`**
  — identity by battle tag, lenient. Used by balance export and draft export,
  which keep only their own mapping concern (`_draft_to_balancer_payload` is
  already exactly that pure function).
- **`materialize_from_registered_teams(session, tournament_id)`** — identity
  pre-resolved via `workspace_member_id`, strict, substitutes supported. Reads
  `registration_team` rows with `status='complete' AND deleted_at IS NULL`.

The plan object carries what differs: the team list, the prior-export ids to clean,
and a `finalize` callback that stamps its own row (a `balance`, a `draft_session`,
or a `registration_team`) and emits that path's event, if any.

**Bonus correctness win.** `admin/balancer.py:215-218` documents that
`enqueue_balance_exported_event` reads `balance.variants`, and that a lazy load
there "would blow up … *after* `bulk_create_from_balancer` already committed the
tournament teams" — a split-brain caused precisely by the writer's internal
commit. Moving the commit to the caller removes that hazard rather than adding
risk. `test_balance_exported_event.py:159-163` pins the eager-load requirement and
must keep passing.

### 5.1 Consolidating the writer

`bulk_create_from_balancer` moves to
`shared/services/team_export/materialization.py`, reconciling the two divergences
deliberately:

- **Identity.** The member input carries `workspace_member_id | None` *and*
  `battle_tag | None`. Team registration passes the former — no tag lookup, and the
  silent-skip class of bug becomes unreachable.
- **Strictness.** Explicit `on_unresolved: "skip" | "error"`. balancer-service
  export keeps `"skip"` (preserves today's behaviour), parser-service keeps
  `"error"`, team registration uses `"error"`.
- **Transaction.** Flush only; callers own the commit. This is the one genuinely
  invasive edit — `admin/balancer.py:241` and `draft/export.py:139` currently rely
  on the internal `session.commit()` at `team.py:198`.
- **Substitutes.** Emit `is_substitution=True` with `related_player_id=NULL`.
  Semantically honest: `related_player_id` means "the player this sub *replaced*",
  and at registration time nobody has been replaced. `avg_sr`/`total_sr` filter on
  `is_substitution` alone, so the exclusion stays correct with a null link.

`Team.captain_id` comes from the captain registration's
`workspace_member.player_id` — no battle-tag resolution in this path at all.

## 6. Registration activation — consolidation

Today's three knobs across two surfaces collapse to one.

**Removed:** `BalancerRegistrationForm.is_open`, `Tournament.allow_late_registration`.

**New rule:** registration is open iff the tournament has a `REGISTRATION` phase
schedule row and `now ∈ [starts_at, ends_at]`. The row becomes **required**.

Four implementation constraints:

- The "missing row ⇒ **closed**" inversion must live in a **dedicated** helper in
  `services/registration/windows.py`. Do **not** change
  `tournament_state.is_within_phase_window`: its "missing row spans the whole
  phase" contract is also relied on by `is_check_in_window_active`.
- `is_finished_for_status` stays as a non-configurable safety floor, so a mis-set
  `ends_at` can never reopen a COMPLETED/ARCHIVED tournament.
- **A SQL-expressible predicate is required, not just a Python helper** (found in
  review). `is_open` is read directly — bypassing `is_registration_open` — in four
  places, three of which need the predicate inside a query:

  | Reader | Use |
  |---|---|
  | `app-service/.../readiness.py:188` — `form_open is not None` | `registration_form_configured`: **does a form row exist at all** |
  | `app-service/.../readiness.py:189` — `bool(form_open)` | `registration_open`: is it currently open |
  | `app-service/src/services/dashboard/service.py:53` | counts tournaments with `is_open.is_(True)` |
  | `parser-service/src/services/subscription_collection/service.py:90` | selects forms with `require_subscription AND is_open` — **drives subscription-collection targeting** |
  | `tournament-service/src/services/registration/subscription_config.py:266` | admin preview counter for the same rule |

  > ⚠️ **`readiness.py` is two uses of one nullable scalar, not one** (found in the
  > third review round). `form_open is not None` answers "a form row exists" and
  > `bool(form_open)` answers "it is open" — they drive two separate checklist rows.
  > Migrating both to `registration_open_clause(now)` would collapse them, so every
  > tournament whose window merely *ended* would report **"Registration form: not
  > configured"**. Required: `registration_form_configured` becomes an `EXISTS` on
  > the form row, independent of openness; only `registration_open` takes the new
  > clause. Additionally the `registration_open` checklist row's `href` points at the
  > registration tab (`frontend/src/components/admin/tournament-checklist.ts:116-122`)
  > while the governing control moves to Settings → Phase schedule — it must be
  > repointed, or the organizer clicks a red item and lands somewhere that cannot fix it.

  Ship a shared `registration_open_clause(now)` SQL clause alongside the Python
  gate, following the existing `balancer_pool_included_clause` precedent
  (`registration/export.py:79`). The write/serialize surface must be removed in the
  same cutover: `schemas/registration.py:78,107`, `registration_build.py:110`,
  `serializers.py:130`, `service.py:920,932`.
- **A backfill migration and a wizard change are mandatory** (found in review).
  `isWizardStepRequired` returns true **only** for `"basics"`
  (`frontend/src/app/admin/tournaments/new/wizard-model.ts:56-58`), and
  `canCreateNow` creates a tournament with defaults for the remaining steps — so
  tournaments with **no** `REGISTRATION` schedule row demonstrably exist today and
  rely on `is_open`/`allow_late_registration` alone. Without a backfill they would
  have registration silently and permanently closed the moment this ships, and the
  effect is **universal**, not scoped to team-registration mode.

  > ⚠️ **The backfill must evaluate the OLD predicate per tournament, not read
  > `is_open` alone.** An earlier draft mapped `is_open=true ⇒ ends_at = NULL`.
  > That is wrong in the *opposite* direction and was caught in review: the new
  > rule intentionally drops the `status == REGISTRATION` conjunct (that is what
  > makes late registration expressible as an `ends_at` beyond the LIVE start), and
  > `ends_at IS NULL` already means "open-ended" (`tournament_state.py:155-158`).
  > Composing the two, every non-finished tournament with `is_open=true` — including
  > those already in CHECK_IN, DRAFT or LIVE — would become **permanently open** for
  > self-service registration on deploy. `self_register` and the subscription gate
  > are per-user capability checks and do not restore a phase gate.

  Required backfill, for every non-finished tournament with no `REGISTRATION` row:

  | Old state | `starts_at` | `ends_at` | Rationale |
  |---|---|---|---|
  | `is_open=false` | `created_at` | `now()` | was closed ⇒ stays closed |
  | `is_open=true`, `status == REGISTRATION` | `created_at` | `NULL` | genuinely open now; open-ended preserves it |
  | `is_open=true`, `allow_late_registration=true`, status past REGISTRATION | `created_at` | `NULL` | today's predicate returns open ⇒ faithful |
  | `is_open=true`, `allow_late_registration=false`, status past REGISTRATION | `created_at` | `now()` | **today's predicate returns CLOSED** — the case the naive mapping would have silently reopened |

  Also required: (a) make the `REGISTRATION` row required in the creation wizard and
  in `canCreateNow`'s defaults; (b) a migration test asserting that for each of the
  four rows above, the new predicate returns exactly what
  `is_registration_open` returned pre-migration.

Extending registration is now one edit to that row's `ends_at`; closing it early is
the same edit. `test_registration_form_is_open_is_a_kill_switch` is replaced by
schedule-based equivalents.

## 7. Frontend

**Admin.**
- `TournamentSettingsTab.tsx:284-289` and wizard `RulesStep.tsx:36-41`:
  `team_formation` gains `'registration'`; `allow_late_registration` removed; the
  schedule editor must treat the `REGISTRATION` row as required.
- `RegistrationFormBuilder.tsx`: drop the `isOpen` toggle from
  `RegistrationStatusCard`; add a Team card (`max_substitutes`, invite-link TTL)
  beside `BuiltInFieldsCard`/`CustomFieldsCard`.

**Public captain flow.** Team identity (name + logo) → a slot matrix derived from
`RosterShape` (`has_role_slots=false` renders N undifferentiated `flex` slots) →
per-slot invite with live `open`/`invited`/`accepted` state.

> **Security — rewritten after review; the original premise was false.** An
> earlier draft mandated exact-identifier-match resolution on the grounds that a
> public browse/autocomplete search would be a user-enumeration surface, inferring
> that from `AuthUserSearchCombobox` being `auth_user:read`-gated. Both halves are
> wrong. That combobox is gated because it searches **auth accounts by
> email/username and renders `user.email`**
> (`AuthUserSearchCombobox.tsx:24-27,46-47,91-92`) — email, not player identity. And
> a public, **anonymous, partial-match** player search already exists and is
> load-tested: `GET /api/v1/users/search` is `edge.AuthNone`
> (`gateway/internal/app/routes.go:47`), as are `/api/v1/users` and
> `/api/v1/users/{name}` (`:46`, `:64`); participants' battle tags are already public
> through `reg_pub_list` (`registration/serializers.py:83-84`). Player enumeration
> is therefore an *existing, intentional* property of the platform, and exact-match
> buys almost no marginal privacy.
>
> The real exposure is different and was unaddressed: **there is no authenticated
> rate limit anywhere in the stack.** `authLimiter` is wired only onto `/api/auth/*`
> (`gateway/cmd/gateway/main.go:184-213`), `AnonRateLimit` defaults to `0 = disabled`
> (`gateway/internal/config/config.go:210`), and authenticated requests bypass
> `WrapAnon` even when it is enabled (`ratelimit_test.go:105-110`). The remaining
> backstops are `GATEWAY_RPC_MAX_INFLIGHT=64` (a bulkhead, not a rate limit) and
> coarse nginx `limit_req`. So the invite endpoint would be an unmetered
> invite-spam primitive.
>
> Required controls, in order of value:
> 1. A per-`(workspace, auth_user)` counter on **both** resolve and invite, reusing
>    `assert_redeem_attempt_allowed`
>    (`registration/subscription_status.py:128-155`). Note that helper deliberately
>    fails **open** on Redis error — defensible behind a high-entropy code, **not**
>    defensible when the limiter is the only control on a spam primitive, so this
>    path must fail **closed**.
> 2. A cap on outstanding `pending` invites per team and per actor. Precedent: the
>    per-creator open-room cap `ix_scrim_room_open_by_creator`
>    (`shared/models/tournament/scrim.py:47-51`).
> 3. A uniform response for "no match" and "match but not invitable", so the
>    endpoint is not a membership oracle.
>
> Partial-match resolution is acceptable given the above; exact-match is retained
> only as the default UX (it is a better interaction for entering a known teammate),
> not as a security control.

**Invitee flow.** `UnifiedRegistrationForm` in `mode="public"` with the slot
pre-assigned; the `RoleStep` matrix collapses to "confirm rank for your slot". This
extends the existing `flexMode` seam (which already seeds reducer-initial state and
hides priorities) rather than fighting it.

**Read surfaces.** A new Teams view beside participants (plain component — tens of
teams, no virtualization), plus one `ColumnDefinition` with `category:'meta'` and a
`searchValue` of the team name so existing search/filter keep working.

**i18n.** New `registrationTeam.*` namespace in **both** `en.json` and `ru.json`;
parity is enforced by the `RegistrationFormBuilder.i18n.test.tsx` pattern (real
message bundles under `NextIntlClientProvider`, which renders the raw key path on a
miss).

## 8. Edge cases and invariants

- **Token race.** Acceptance is a guarded transition —
  `UPDATE … SET state='accepted' WHERE id=? AND state='pending'` with a rowcount
  check — never read-then-write, or a leaked link races two people into one slot.
- **Slot overfill** (tightened after review). Comparing accepted
  `team_slot_code` counts to `RosterShape` "inside the transaction" is **not**
  sufficient on its own: two concurrent accepts for the last slot can both read a
  below-cap count before either commits, and no DB constraint can express
  "at most 2 dps". The count MUST be taken under a row lock on the parent team —
  `SELECT … FROM balancer.registration_team WHERE id = :id FOR UPDATE` — which
  serializes all accepts, kicks and materialization for that one team while
  leaving other teams fully concurrent. Contention is trivial at this scale (a
  team has ≤12 slots). The invite-state guard remains a separate atomic `UPDATE`;
  identity collisions still fall through to `uq_balancer_registration_user`.
- **Lock ordering and materialization lock scope** (added after review). The
  per-team lock above covers accepts and kicks, where exactly one team row is
  locked. Materialization is different: it locks **every** complete team of the
  tournament in one transaction, so the "≤12 slots, trivial contention" argument
  does not extend to it. Two requirements follow:
  1. The multi-row acquisition MUST be `… WHERE tournament_id = :t AND status =
     'complete' ORDER BY id FOR UPDATE`. Without a deterministic `ORDER BY id`,
     two concurrent or retried `export_registered` calls can acquire in opposite
     orders and deadlock — and retry is realistic, because the gateway's write
     timeout can elapse while the RPC is still running.
  2. The locks are held across delete → insert → backfill, blocking every accept
     and kick in that tournament for the duration. That is acceptable **only**
     because materialization is an explicit, rare organizer action (decision 6) and
     the registration window is normally closed by then; it would not be
     acceptable under the rejected auto-export-on-completeness alternative.
- **Already registered.** Solo or on another team, the same partial unique index
  rejects it. Needs a test asserting a comprehensible message, not a raw
  constraint name.
- **Roster-shape change while teams exist.** Requires the exact analogue of the
  existing `roster_locked_by_draft` guard — changing `roster_slots_json` while
  non-disbanded `registration_team` rows exist would silently invalidate every
  roster.
- **Withdrawal.** Soft-deletes the registration; both unique indexes are
  `WHERE deleted_at IS NULL`, so the slot *and* the battle tag are genuinely freed
  and the team drops back to `forming`.
- **Incomplete at close.** No cap, no waitlist — the team never materializes and
  shows as incomplete in `regteam_list`.
- **Re-export.** Blocked once `Standing` rows exist: re-export is
  destructive-then-idempotent, not diffed.
- **Subscription staging.** `subscription_stage='registration'` blocks acceptance;
  `check_in` defers to per-member check-in, which works unmodified because members
  are ordinary registrations.
- **Unlinked substitutes render as starters** (verified defect, must ship with
  step 5). `sortTeamPlayers` buckets a player into `children` only when
  `is_substitution && relatedPlayerId !== null && playerById.has(relatedPlayerId)`;
  otherwise it falls to `roots.push(player)` (`frontend/src/utils/player.ts:76-84`).
  Because registration-time substitutes carry `related_player_id = NULL` (§5.1),
  a team with two bench players would render as a seven-player starting lineup,
  sorted by role priority alongside the starters. `Team.avg_sr`/`total_sr` are
  unaffected — they filter on `is_substitution` in SQL. Required change: give
  `sortTeamPlayers` a third bucket for unlinked substitutes, emitted after all
  starters and their replacement chains, and mark them as bench in
  `TournamentTeamTable`/`TeamRosterEditor`. `TeamRosterEditor.tsx:91` and
  `admin/team.py:115` are already null-safe and need no change.

## 9. Testing strategy

**Backend** (pytest, following `test_registration_self_register_gate.py`):
schedule-only gate including **missing row ⇒ closed**; `self_register` denial on
accept creates zero rows; both duplicate-defence layers; token single-use race;
captaincy transfer and disband; completeness vs shape including an all-`flex`
roster; export idempotency; export strictness (`"error"` on unresolved);
substitute rows and the `avg_sr` exclusion; the `Standing`-exists guard.

**Regression (load-bearing for decision 16):** `test_balance_exported_event` and
`test_draft_integration` must pass **unchanged**, plus new tests that the shared
core commits exactly once on success and, critically, that **a failed export
leaves the prior teams intact** — the failure contract in §5 exists because the
current code path commits its own destructive delete
(`admin/balancer.py:229-237,263-267`). Also required: a deadlock/ordering test
that two concurrent `export_registered` calls serialize rather than deadlock (§8),
and a migration test pinning old-vs-new predicate equivalence for all four
backfill cases (§6).

**Frontend:** bun:test + happy-dom harness (per `RoleStep.behavior.test.tsx`) for
the slot matrix and the locked-slot `RoleStep`; a `sortTeamPlayers` unit test
asserting an unlinked substitute (`is_substitution: true`,
`related_player_id: null`) sorts **after** every starter rather than among them
(§8); vitest + real `en`/`ru` bundles for the new admin Team card.

## 10. Implementation order

1. **Refactor, no behaviour change.** Consolidate the writer into
   `shared/services/team_export/`, introduce `TeamMaterializationService`, migrate
   `export_balance`, draft `export` and the parser-service caller. Existing tests
   are the oracle.
2. **Activation consolidation** — the widest-blast-radius step, and it is
   **cross-service and universal**, not team-registration-specific. **Ship this on
   its own, before any team-registration code**, and split it expand/contract,
   because `is_open` is selected by three separately-deployed images
   (`app-service`, `parser-service`, `tournament-service`) against one shared
   Postgres — a migration landing before the old containers are replaced yields
   `UndefinedColumn` on the readiness card, the dashboard count, and the
   `subscription_collection` worker that drives subscription targeting:
   - **2a (expand).** Add the dedicated Python gate **and** the
     `registration_open_clause(now)` SQL clause. Backfill the `REGISTRATION` phase
     rows per the §6 table. Migrate all four direct readers and the
     schema/serializer/upsert surface to the new predicate. Make the row required
     in the wizard and in `canCreateNow`'s defaults. `is_open` and
     `allow_late_registration` remain in the DB, written but no longer read.
     Deploy and verify every service image.
   - **2b (contract).** Only once no deployed image references them, drop
     `BalancerRegistrationForm.is_open` and `Tournament.allow_late_registration`,
     and replace the kill-switch test. This is the step with no rollback, so it
     must be its own migration.
3. **Data model.** Migration for the two new tables and the three nullable
   columns; the roster-shape lock guard.
4. **Backend flows.** Team CRUD, invites, accept/decline, kick/leave/transfer/
   disband, `regteam_list`, `regteam_reject`.
5. **Materialization path.** `rpc.balancer.teams.export_registered` on the shared
   service, substitutes included.
6. **Frontend.** Captain flow, invitee flow, Teams view, participants column,
   admin Team card, i18n parity.

## 11. Open risks

- Step 2 is now understood to be the riskiest part of the feature, not step 1: it
  silently changes registration availability for **every** existing tournament and
  touches subscription-collection targeting in parser-service. The backfill is the
  single highest-consequence artifact in the whole plan.
- Step 1 touches two live critical paths (balance and draft export). The
  transaction-boundary change is the sharpest edge: a missing commit surfaces as
  "export silently did nothing". Mitigating factor discovered in review: it also
  removes the documented `balance.variants` lazy-load-after-commit hazard
  (`admin/balancer.py:215-218`).
- The new public invite/resolve endpoints are the only new externally reachable
  surface. The binding constraint is **not** enumeration (already public by design,
  §7) but the total absence of authenticated rate limiting in the stack: they must
  ship with a fail-**closed** per-actor limiter and a pending-invite cap, or not
  ship.
- Two destructive operations now have explicit contracts that did not exist before
  review: the export failure path (§5 — rollback, then stamp in a fresh
  transaction) and the activation backfill (§6 — evaluate the old predicate per
  tournament). Both were wrong in the first draft in the *silent* direction; treat
  their tests as release gates, not nice-to-haves.
- `registration_team.status` is a denormalization of "do the member rows fill the
  shape". It cannot drift because every transition is written under the same
  `FOR UPDATE` team lock that accepts/kicks take (§8), and materialization re-reads
  membership under that lock rather than trusting the column blindly.
- **Discharged (verified this session).** `is_substitution=True,
  related_player_id=NULL` is a new row shape for `tournament.player`. Every
  backend consumer excludes substitutes via `is_substitution.is_(False)` and never
  dereferences the link; the two that expose it type it `int | None`
  (`app-service/src/schemas/user.py:115`, `analytics_read/flows.py:140`); both
  frontend dereferences are null-guarded. The one real consequence is the
  `sortTeamPlayers` bucketing defect now specified in §8 — not an unknown.

## 12. User-experience requirements (review round 3)

Neither earlier review round examined the human path. These are mandatory, not
polish.

### 12.1 Failure diagnosis must survive the security hardening

§3.3 folds `expires_at` into the guarded `UPDATE … WHERE state='pending' AND
expires_at > now()`. That is correct for the race, but it means **expired,
revoked, already-accepted and already-materialized all return rowcount 0** — four
situations with four different recourses collapse into one opaque failure. On
rowcount 0 the handler MUST re-read the row **for reporting only** and return a
distinct machine code per case (`invite_expired`, `invite_revoked`,
`invite_already_accepted`, `team_already_exported`, `slot_taken`). The re-read is
not part of the guard and cannot reintroduce the race.

### 12.2 Error copy must be translatable — the current path cannot translate

`friendlyMessage` prefers the server's `msg` verbatim and
`defaultTitleForStatus` returns hardcoded English (`frontend/src/lib/api-error.ts:144-156`);
no `registration.errors.*` namespace exists in either bundle. Since the captain and
invitee flows are **public** and the user base is Russian-first, every new rejection
must carry a stable machine `code`, and the new surfaces must map code → translated
string via next-intl rather than rendering `msg`. Codes needed at minimum:
team name taken, already registered, slot taken, invite expired/revoked/consumed,
team already exported, window closed, rate limited (§7 control 1), invite cap
reached (§7 control 2).

### 12.3 Emergency close must remain one action

Decision 9 is kept, but the organizer's one-click `is_open` switch
(`RegistrationStatusCard.tsx:30-38`) must not degrade into "navigate to Settings,
open a calendar, type a time in the workspace timezone, save the whole settings
form". Ship a **"Close registration now"** button on the registration admin page
that writes `ends_at = now()` to the `REGISTRATION` schedule row. One action, and
the schedule stays the single source of truth — this is an affordance, not a second
knob. Note the two traps in the existing editor it must avoid: a blank time input
defaults to 12:00, and `getPhaseSchedulePayload` drops any phase with a blank
`starts_at` from its full-replace.

### 12.4 The lost phase lever must be stated

Dropping the `status == REGISTRATION` conjunct also removes a lever organizers use
today: **advancing the tournament to CHECK_IN no longer closes registration.** §6
treats this only as backfill correctness. It is a behaviour change that must be
called out in the admin UI (a hint on the schedule editor) and in the release notes.

### 12.5 The incomplete-team dead end must be visible to the people in it

§8 answers "incomplete at close" with `regteam_list` — an **admin** RPC. Two people
are left with no explanation:

- the **captain**, who gets no deadline warning and no post-close status;
- the **invitee who accepted**, who now holds a live approved registration for a
  tournament they cannot play in.

The platform's established contract is the opposite: the "Your Registration" card
carries a stepper plus a translated explanatory sentence for every state, including
terminal ones (`TournamentParticipantsPage.tsx:406-461`,
`registration.myCard.*` in both bundles). Both roles must get a team-aware state in
that card. **This is also the right home for the pending-invite surface** — see the
open question below.

### 12.6 Captain interaction weight

Five slots means five invite actions plus five acceptance states to track. The
existing wizard holds itself to 1–3 steps and actively drops any content-free step
(`UnifiedRegistrationForm.tsx:196-226`). Provide a bulk-invite path (paste several
identifiers at once) and one progress affordance ("3 of 5 confirmed"), not five
independent widgets.

### 12.7 No hardcoded strings on new public surfaces

The i18n test named in §7 catches an *unresolved key*, not a *hardcoded English
string* — and hardcoded English is the codebase's dominant admin-mode habit
(`UnifiedRegistrationForm.tsx:221-223`, `DetailsStep.tsx:79,103,105`). Because the
captain and invitee flows are public and Russian-first, the design forbids
user-visible literals on those surfaces; admin-only surfaces may follow the existing
convention.

### 12.8 Invite surface (decision 17)

There is no notification transport in the product: no bell or badge
(`UserMenu.tsx`), no inbox, no `/me` or my-registrations route, no email and no
push, and the backend's `workspace_notifications` topic has **zero** frontend
consumers. A standalone "my invites" page would therefore never be seen, and
captains would silently fall back to pasting token links.

So the invite lives where the invitee already goes: the per-user card on the
tournament page (`TournamentParticipantsPage.tsx:406-461`). Requirements:

- A pending invite for the viewer renders in that card as an actionable state
  ("Team *Alpha* invited you as **DPS**" + Accept / Decline), using the card's
  existing stepper-plus-explanation pattern and the `registration.myCard.*`
  translation convention already present in both bundles.
- `regteam_pub_my_invites` remains the read, but it feeds that card rather than a
  new page. The token link keeps working standalone for people with no account yet.
- The same card carries the two dead-end states from §12.5: captain of an
  incomplete team after close, and accepted member of a team that never completed.
- A future notification subsystem can add a badge on top without changing this
  contract. That work is explicitly out of scope.

### 12.9 Rank-free rosters (decision 18)

When `has_role_slots` is false, rank is not collected and `Player.rank` is written
as `0`; only the nominal slot is recorded, exported as `HeroClass.flex`. Verified
safe rather than assumed:

- `resolve_division_from_rank` always resolves a tier for `0` — `rank_min <= 0 <=
  rank_max` or the final-tier fallback (`shared/domain/division_rank.py:21-25`);
  no crash, no division by zero anywhere.
- The one heuristic that cares already guards it: `rank_suspicious = rank > 0 and
  rank <= rank_cutoff` (`analytics-service/src/services/ml/models/anomalies.py:113-114`),
  so zero-rank players are excluded rather than mis-flagged as low-rank.
- Consequence to state plainly in the admin UI: `Team.avg_sr`/`total_sr` will be
  `0` for such teams, and rank-gap features in `standings_v2` carry no signal for
  that tournament. The OpenSkill mu features still do.

In a roster **with** role slots, decision 5 stands unchanged: the member supplies a
rank for their slot's role, with autofill from history.

## 13. Arbitration record (multi-agent review)

Three constrained reviewers were run sequentially over this document, each with a
hard scope limit, with revisions applied between rounds.

| Round | Reviewer | Verdict | Objections | Disposition |
|---|---|---|---|---|
| 1 | Skeptic / Challenger | BLOCK | 4 | 4 accepted, 0 rejected |
| 2 | Constraint Guardian | BLOCK | 8 | 7 accepted, 1 accepted-with-amendment |
| 3 | User Advocate | BLOCK | 11 | 9 accepted, 2 escalated to the organizer |

**Every load-bearing objection was independently verified against source before
being accepted** — the reviewers' evidence was checked, not trusted. Four claims
proved this document factually wrong and were corrected: the `is_open` blast radius
(§6), the reuse of `BalanceExportedEvent` (§5), the realtime topic's audience and
its inability to reach an invitee (§4.3), and the public-search premise behind the
§7 security control.

**Accepted with amendment.** Constraint Guardian #7 (public resolver). The finding
that the exact-match rationale was false is accepted in full: `/api/v1/users/search`
is already `AuthNone`, so player enumeration is intentional platform behaviour and
exact-match is not a security control. Amendment: exact-match is **retained as the
default interaction** (entering a known teammate is the common case) while the real
controls become the fail-closed limiter and the pending-invite cap. The reviewer's
conclusion is adopted; only its framing of exact-match as useless is narrowed.

**Escalated rather than arbitrated.** User Advocate #1 and #8 each showed a *locked*
decision resting on a false premise — decision 3 assumed an in-app inbox that does
not exist, and decision 5 had no answer for a `flex` slot's rank. The Arbiter may
not silently reopen a locked decision, so both went back to the organizer and became
decisions 17 and 18.

**Nothing was rejected.** Every objection was either evidence-backed and adopted, or
adopted with the narrowing recorded above.

### Exit criteria

- Understanding Lock completed and explicitly confirmed — ✅
- All three reviewer roles invoked, in order, with revisions between rounds — ✅
- All objections resolved or explicitly narrowed; none left open — ✅
- Decision Log complete (18 decisions with rejected alternatives, §1) — ✅
- Arbiter declares the design acceptable — ✅

**Disposition: APPROVED for implementation**, conditional on two release gates that
are not negotiable, both of which exist because the first draft was wrong in the
*silent* direction:

1. §10 step 2 ships **alone and expand/contract-split**, with the §6 backfill
   equivalence test green for all four cases, before any team-registration code.
2. The export **failure-path** test ("a failed export leaves the prior teams
   intact", §5) is green before step 5.
