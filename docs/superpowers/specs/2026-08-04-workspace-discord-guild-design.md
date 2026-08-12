# Workspace Discord Guild — Design

**Status:** accepted (2026-08-04)
**Plan:** `docs/superpowers/plans/2026-08-04-workspace-discord-guild.md`
**Related:** `docs/superpowers/specs/2026-08-03-subscription-entitlements-design.md`

---

## 1. Understanding Summary

- **What:** one source of truth for the organizer's Discord guild id, owned by `Workspace`. Features read it; none of them store a copy.
- **Why:** the snowflake is retyped by hand for **every tournament** and, separately, inside the Boosty provider blob. A divergence between the two silently changes subscription admission, because a missing/wrong guild resolves `unknown` and the gate fails open.
- **Who:** workspace admins (the `/admin/workspaces/[id]` screen already owns branding, domains, timezone), and any future Discord-shaped feature.
- **Constraints:**
  - A Discord snowflake exceeds `2**53`, so it must cross the wire as a string.
  - `Workspace` is a flat typed-column model in the `public` schema. No JSON bag.
  - `settings` is a **global** key/value table (`unique(key)`), not workspace-scoped.
  - Alembic with hand-written revision ids; `alembic heads` is authoritative.
- **Non-goals:** validating that the bot is actually a member of the guild; a Discord bot-install/OAuth flow; moving `broadcaster_id`/`broadcaster_login`; moving `channel_id`.

## 2. Current State (verified against code)

`guild_id` lives in two unrelated places.

| Location | Scope | Type | Who reads it |
| --- | --- | --- | --- |
| `subscriptions.provider_config.config_json["guild_id"]` | workspace + provider (`boosty` only) | `str` inside JSON | `DiscordRoleResolver.resolve` (`shared/subscriptions/providers/discord_role.py:96`) |
| `log_processing.discord_channel.guild_id` | **tournament** (one row per tournament), `BigInteger NOT NULL` | `int` | **nobody** |

The second is pure duplication:

- the bot's `load_active_channels` (`backend/discord-service/main.py:145-178`) builds `{channel_id: tournament_id}` and never touches `guild_id`;
- the parser RPC only persists it (`backend/parser-service/src/rpc/misc.py:128`);
- the frontend requires it in the create form and renders it as a read-only `DetailField` (`TournamentIntegrationsPanel.tsx:213`, `:160`).

Aggravating factor: `SubscriptionProvidersCard` — the screen where the Boosty guild is edited — is mounted **inside a tournament's registration-form builder** (`RegistrationFormBuilder.tsx:436`, passing `workspaceId`). A workspace-scoped setting is edited from a tournament screen.

```mermaid
graph LR
  WS[Workspace] --> PC["provider_config boosty<br/>config_json.guild_id"]
  WS --> T1[Tournament 1] --> DC1["discord_channel.guild_id"]
  WS --> T2[Tournament 2] --> DC2["discord_channel.guild_id"]
  WS --> TN[Tournament N] --> DCN["discord_channel.guild_id"]
  PC --> R[DiscordRoleResolver]
  DC1 -.never read.-> X[ ]
```

### 2.1 Fact table

| Claim | Verified where |
| --- | --- |
| `discord_channel.guild_id` has no reader anywhere in the repo | `grep guild_id` across `backend/`, `frontend/`, `gateway/`; only writes + one display |
| `ProviderConfigRow` is built in exactly one production place | `SqlEntitlementStore.load_configs`, `backend/shared/services/subscription_store.py:36-52` |
| That place already receives `workspace_id` | same, signature `load_configs(self, workspace_id: int, providers: Sequence[str])` |
| A missing guild fails open, it does not block | `discord_role.py:101-102` → `unknown("guild_not_configured")`; Kleene composition treats `unknown` as pass |
| `WorkspaceRead` is served on two **public `AuthNone`** routes | `gateway/internal/app/routes.go:42,44` |
| `WorkspaceRead` already exposes non-secret admin config publicly, deliberately | `app-service/src/schemas/workspace.py:48-53` — `custom_domain_verification_token`, with the comment "it is not a secret (the TXT record IS public DNS)" |
| Workspace writes are owned by **app-service** (not tournament-service) | `app-service/src/schemas/workspace.py`, `src/services/workspace/registry.py` |
| Alembic head at time of writing | `subs0003` (scan of 132 revisions — a **hint only**, `alembic heads` is authoritative) |

## 3. Assumptions

| # | Assumption | Confirmed |
| --- | --- | --- |
| A1 | A workspace has exactly one Discord guild: the Boosty patron-roles server and the match-log server are the same server | yes |
| A2 | Clean cutover — no per-feature override, no fallback chain | yes |
| A3 | Production data exists; a backfill is required, not an empty column | yes |
| A4 | Tens of workspaces; performance is irrelevant. Cost is the migration plus front/back coordination | yes |

## 4. Design

### 4.1 Data

```python
# backend/shared/models/tenancy/workspace.py
# The organizer's Discord guild. ONE per workspace: the server where Boosty's bot
# assigns patron roles and the server holding match-log channels are the same one.
# String, not BigInteger: there is no arithmetic, no range query and no FK, while
# both consumers (DiscordRoleResolver, the HTTP boundary) want `str` — a numeric
# column would only buy a conversion at every edge, which is exactly the tax
# `DiscordChannelRead.coerce_snowflake_to_str` was paying.
discord_guild_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
```

Two migrations, deliberately — `wsguild0001` **expands**, `wsguild0002` **contracts**. A single combined revision is undeployable, because its halves need opposite orderings:

| Statement | Must run | Otherwise |
| --- | --- | --- |
| `add_column workspace.discord_guild_id` | **before** the new code | new `load_configs` joins a column that does not exist → `UndefinedColumn` on every subscription read |
| `drop_column discord_channel.guild_id` | **after** the new code | old `TournamentDiscordChannel` still maps the attribute, and SQLAlchemy emits every mapped column in every `SELECT` → the bot's `load_active_channels` raises `UndefinedColumn` and **log collection stops** |

So the sequence is: apply `wsguild0001` → roll the services → apply `wsguild0002`. Both intermediate states are fully working: old code still reads the blob key and the tournament column, new code reads the workspace column, and nothing reads something absent. This also removes the fail-open window a combined revision would have opened, since the blob key survives until the contract step.

**`wsguild0001` (expand):**

1. `add_column workspace.discord_guild_id String(32) NULL`
2. **Backfill**, in precedence order, and in both cases only from values that *look like* a snowflake:
   1. `subscriptions.provider_config.config_json ->> 'guild_id'` where `provider = 'boosty'` and the value matches `^[0-9]{17,19}$` — this is the value the running system actually reads, so it wins;
   2. otherwise the most recent `log_processing.discord_channel.guild_id` among that workspace's tournaments, floored at `10000000000000000` (the smallest 17-digit id).

`downgrade` is a bare `drop_column` — the sources it copied from are still intact at that point.

**`wsguild0002` (contract):**

3. **Strip** `guild_id` out of `provider_config.config_json` — leaving it would keep two sources of truth and make the injection order in §4.2 load-bearing and untestable.
4. `drop_column log_processing.discord_channel.guild_id`

#### Why the backfill validates rather than copies

A **missing** guild and a **wrong** guild are opposite outcomes, and conflating them is the sharpest hazard in this change:

| Stored guild | Discord | Verdict | Admission |
| --- | --- | --- | --- |
| absent | not called | `unknown` / `guild_not_configured` | **passes** (fail-open) |
| wrong | 404 on `GET /guilds/{id}/members/{user}` | `inactive` / `not_a_member` | **blocked** |

`MemberNotFound` (`subscription_strategies.py:139-141`) maps to `_inactive("not_a_member")` (`discord_role.py:110-111`), and the composition reads `inactive` as a refusal. So promoting an unvalidated value can flip a workspace from "admits everybody" to "blocks every patron" — the exact opposite of a safe migration.

That matters because `discord_channel.guild_id`, the fallback source, was **never validated**: the admin form had no pattern check, and nothing ever read the column back, so no operator would have noticed a typo. The old write schema for the Boosty blob was no better (`max_length=32`, no digits pattern), which is why `"999"` was a legal stored value — this repository's own tests seeded exactly that. Two further consequences of copying such a value verbatim: `WorkspaceUpdate` enforces `^\d{17,19}$` and the workspace edit page posts the field on **every** save, so the workspace would return 422 on unrelated edits (name, timezone, branding) forever; and a value longer than 32 characters would abort the migration outright on `String(32)`.

Hence: pattern-guard both sources. Note what a rejected value does **not** do: the guard sits in step 1's source-row `WHERE`, so failing it does not end the backfill — step 2 still gets its turn, and a workspace with an implausible Boosty guild can end up gated on its most recent tournament channel instead. That is deliberate. Per the table above, such a workspace was already **blocking** every patron, so falling through can only fix it or leave it equally broken, whereas writing `NULL` would silently stop a gate that was enforcing.

A workspace with no plausible value in *either* source does end up `NULL`, and that case splits in two:

- it simply had no guild → `NULL` is the fail-open state it already had, and nothing changes;
- it held an implausible one (`'999'`) → `NULL` moves it from **blocking** to **admitting**. This is the one transition the migration cannot avoid, because the value is unusable either way — and once `wsguild0002` runs it is **irreversible**: the contract step strips the key from the blob, and its `downgrade` upsert is gated on a non-`NULL` workspace value, so `'999'` is never written back.

The pre-flight query must therefore list these workspaces too, not only the divergent ones.

A note on widths: the accepted pattern is `^\d{17,19}$`, not `{17,20}`. `bigint` — what `discord_channel.guild_id` was, and what `downgrade` casts back to — tops out at `9223372036854775807`, 19 digits. Permitting 20 would admit a value the rollback path cannot represent. 19 digits already covers real snowflakes past 2080.

`downgrade` re-adds `discord_channel.guild_id` as `BigInteger NOT NULL server_default='0'`, backfills from `workspace.discord_guild_id` through the tournament join, then drops the server default, restoring the original schema exactly. Rows with no resolvable guild get `0` — precisely as meaningful as the value was before, since nothing read it. The cast is bounded by both shape and magnitude, expressed as a `CASE` rather than two conjuncts: PostgreSQL leaves subexpression evaluation order undefined and the planner may reorder a `WHERE`, so `regex AND ::numeric <= …` does not guarantee the regex runs first, and a non-digit value could raise `invalid input syntax for type numeric` — aborting the very rollback the guard protects. A 19-digit value can still reach 9.99e18 and overflow `bigint`. Such an abort would **not** leave a half-applied schema: `migrations/env.py:89-90` wraps `run_migrations` in one transaction and PostgreSQL has transactional DDL (`PostgresqlImpl.transactional_ddl is True`), so the failure takes `add_column` with it. The rollback still would not complete, which is reason enough to bound the cast.

The guild itself is preserved on rollback by an **upsert**, not an update. A plain update only touches an existing `boosty` row, so a workspace holding a guild with no `boosty` config and no tournament channel would have its snowflake destroyed irrecoverably — and since `workspace.discord_guild_id` is now the only source, a later re-upgrade would leave that workspace unconfigured, silently ending enforcement while the organizer believed the gate was live. The insert creates the row **disabled**, so rolling back can never *start* enforcing something that was not; the conflict branch touches only `config_json`. Its target is aliased `pc` rather than referenced as `subscriptions.provider_config.config_json` — the three-part form is very probably valid, but an alias removes all doubt from a statement whose first real execution is a rollback.

### 4.2 Read path — one chokepoint, resolver untouched

`SqlEntitlementStore.load_configs` is the only production site that constructs `ProviderConfigRow`, and `workspace_id` is already a parameter:

```python
cfg = models.SubscriptionProviderConfig
rows = await self._session.execute(
    sa.select(cfg.provider, cfg.enabled, cfg.config_json, models.Workspace.discord_guild_id)
    .join(models.Workspace, models.Workspace.id == cfg.workspace_id)
    .where(cfg.workspace_id == workspace_id, cfg.provider.in_(list(providers)))
)
return {
    provider: ProviderConfigRow(
        provider=provider,
        enabled=bool(enabled),
        # Guild comes from the workspace, never from the blob. Injected here (the
        # single place configs are born) so the resolver's `config["guild_id"]`
        # contract — and its whole decision table — stays untouched.
        config={**(config or {}), "guild_id": guild_id or ""},
    )
    for provider, enabled, config, guild_id in rows.all()
}
```

Consequences, and the reason this shape was chosen:

- `DiscordRoleResolver` and **all of its unit tests are unchanged.** `str(config.get("guild_id") or "").strip()` still yields `unknown("guild_not_configured")` for a workspace with no guild, so the fail-open guarantee is preserved byte for byte rather than re-argued.
- `redeem_challenge_code` also goes through `load_configs`; it reads only `verification_method` and the code tiers, so the extra key is inert.
- The join cannot drop rows: `provider_config.workspace_id` is a `NOT NULL` FK to `workspace`.

### 4.3 Write path

| File | Change |
| --- | --- |
| `backend/app-service/src/schemas/workspace.py` | `WorkspaceUpdate.discord_guild_id: str \| None` (`^\d{17,19}$`, blank → `None`); `WorkspaceRead.discord_guild_id` with a comment citing the `custom_domain_verification_token` precedent |
| `backend/tournament-service/src/schemas/registration.py:290,351` | drop `guild_id` from `SubscriptionProviderConfigUpsert` / `…Read` |
| `…/services/registration/subscription_config.py:58-59,98` | stop writing and reading `guild_id` |
| `…ConfigListResponse` | **add** `discord_guild_id: str \| None`, read from `Workspace` in `list_provider_configs`, so the Boosty card can warn when it is unset |
| `backend/parser-service/src/schemas/admin/discord_channel.py`, `src/rpc/misc.py:128` | drop `guild_id` from `DiscordChannelUpsert` / `…Read` and from the upsert |

`WorkspaceUpdate` keeps the existing `exclude_unset` semantics: omitted means untouched, explicit `None` clears — identical to the brand colours (`test_workspace_branding_schema.py::test_update_allows_explicit_none_to_clear`).

### 4.4 UI

- **`/admin/workspaces/[id]`** — a "Discord" section beside branding/domains. `EditFormData`, `formFromWorkspace`, and the PATCH payload each gain one field; the input is digits-only.
- **`SubscriptionProviderCard.tsx`** — the Guild input and `guildId` state are removed. In their place a read-only row showing `discord_guild_id`, plus a warning linking to workspace settings when `enabled && role_tiers.length && !discord_guild_id`. `rolesMissing` (`:174-175`) moves from `guildId.trim()` to the new source. i18n keys `subscriptionProviders.guild.*` are rewritten in **both** `en.json` and `ru.json`.
- **`TournamentIntegrationsPanel.tsx`** — the Guild ID field (`:213-227`), the `DetailField label="Guild"` (`:160`), and `guild_id` in form state are removed; the dialog description drops "guild and".

### 4.5 Verification strategy

The fail-open path is the most fragile property of the subscription feature, so it is proved rather than assumed:

1. A workspace with no guild yields `unknown` / `guild_not_configured`, and check-in still succeeds.
2. A stale `config_json.guild_id` cannot outrank the workspace value (regression guard for the injection order in §4.2).
3. The injection itself only exists once real Postgres executes the join, so it is covered in the DSN-gated integration file whose stated purpose is "things only real Postgres has an opinion about". That test **must actually be run with `SUBSCRIPTIONS_IT_DSN` set** — leaving it skipped proves nothing.

Tests that must change: `test_subscription_provider_config.py` (8 `guild_id` assertions), `test_subscription_config_integration.py`, `test_verification_method_integration.py:112`, `test_subscription_store_integration.py:90,108`, `SubscriptionProviderCard.behavior.test.tsx` (4 assertions).

Tests that must **not** change: the resolver's fake-store suites seeded with `{"guild_id": "9"}` (`shared/tests/test_resolve_subscriptions.py`, `test_subscription_check_log.py`, `test_subscription_provider_discord.py`). They assert a contract this design deliberately preserves; that they stay green untouched is the evidence the chokepoint was chosen correctly.

### 4.6 Gateway and docs

No new routes, so there is no `edge.RouteSpec`, no `apidocs/groups.go` entry and no `apiv1_guard_test.go` change — only a regenerated manifest via `bash backend/scripts/export_openapi_schemas.sh`.

`docs/database_erd.md` and its mirror `frontend/src/app/docs/diagrams.ts` move `guild_id` off the `DISCORD_CHANNEL` block (`:1391` / `:1408`) and onto `WORKSPACE`. Note that `WORKSPACE` appears seven times in each file — once fully specified (`database_erd.md:284`, `diagrams.ts:354`) and six times as an `{ int id PK }` stub inside other diagrams. Only the full block gains the column; the stubs elide columns by design. The alembic head these files record was itself badly stale (`captrep0001`, predating the whole `subs*` chain), so it is bumped in both places it appears.

Docstrings to correct: `SubscriptionProviderConfig` (`subscription.py:45`), the `discord_role.py` header, `verification.py:13`.

## 5. Decision Log

| Decision | Alternatives considered | Why |
| --- | --- | --- |
| Typed column on `Workspace` | `tenancy.workspace_integration(workspace_id, kind, config_json)`; workspace-scoped rows in `settings` | Matches how this model already works (11 × `brand_*`, `subdomain`, `custom_domain`, `timezone`). A new JSON blob would reintroduce the untyped-config problem being removed; a join per read path, its own CRUD and its own RBAC are unjustified for one field. `settings` is `unique(key)` and globally scoped — adding a nullable `workspace_id` would blur a table whose contract is "one row per global section", and its admin surface is a generic JSON editor |
| `String(32)` | `BigInteger` | Both consumers want `str`; no arithmetic, no range query, no FK. `BigInteger` buys nothing and costs a conversion at every boundary |
| Inject in `load_configs` | Change the resolver signature to take `guild_id` explicitly | The resolver and ~20 of its tests stay untouched, and `workspace_id` is already in scope. Cleaner typing is not worth re-litigating the fail-open decision table |
| Expose in the public `WorkspaceRead` | A separate admin-only read model plus a route | Precedent: `custom_domain_verification_token` is already public with an explicit justification. A guild id is public by construction — every message link is `discord.com/channels/<guild_id>/<channel_id>/<message_id>`. See Risks: a genuinely secret integration value would need the admin-only model instead |
| Drop `discord_channel.guild_id` | Keep it as a denormalized cache | It has no reader; the bot keys on `channel_id` alone. A cache nobody reads is a divergence waiting to happen |
| Strip `guild_id` from `config_json` in the migration | Leave the stale key | Two sources of truth would make the injection order in §4.2 load-bearing and untestable |
| Backfill prefers the Boosty config over `discord_channel` | Prefer the tournament value; prefer the newest of either | The Boosty value is the one the running system actually reads, so preferring it cannot change current behaviour |

## 6. Risks

- **Backfill precedence is a judgement call.** If a workspace's Boosty guild differs from its tournaments' guild, the migration keeps the Boosty one. Mitigation: query both **before** running and confirm they agree.
- **A wrong backfilled guild blocks; a missing one does not.** See §4.1 — this is the asymmetry that makes an unvalidated copy dangerous, and the reason both sources are pattern-guarded. Residual risk: a *plausible but wrong* 17–19-digit id still passes the guard and still blocks. Only the pre-flight query catches that, which is why it is a gate and not a suggestion.
- **Public exposure sets a precedent.** Justified for a guild id, wrong for a secret. If a future integration value is secret (a bot token, a webhook URL with an embedded key), it must not follow this path — it needs an authenticated admin read model.
- **Fail-open widens silently if the backfill misses a workspace.** A workspace that ends up with `NULL` admits everybody on a Boosty-gated tournament. Mitigation: the new UI warning (§4.4) makes it visible on the screen that owns it, and §4.5.1 pins the behaviour.
- **Dropping the ORM attribute opens a deploy window that fails inserts.** Between the code deploy and `wsguild0001` running, `discord_channel.guild_id` is still `NOT NULL` with no server default while the mapper no longer sets it, so `_discord_upsert` (`parser-service/src/rpc/misc.py`) returns 500 for an admin adding a match-log channel. Inherent to any column drop; the mitigation is ordering — migrate before the parser rolls. Note `_discord_upsert` has no test coverage at all, before or after this change.
- **`dev` env may point at production.** Migrations are verified by `alembic upgrade <rev> --sql` render plus a round-trip against an explicitly named scratch database, never by a bare `alembic upgrade head` from a dev shell.

## 7. Exit Criteria

Understanding Lock confirmed; approach A accepted; assumptions A1–A4 confirmed; risks recorded; Decision Log complete.
