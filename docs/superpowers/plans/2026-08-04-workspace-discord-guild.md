# Workspace Discord Guild — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: use `superpowers:executing-plans` to implement this plan task-by-task.

**Design:** `docs/superpowers/specs/2026-08-04-workspace-discord-guild-design.md` — read it first; this plan does not repeat the reasoning.

**Goal:** move the Discord guild id to `Workspace`, so it is typed once per workspace instead of being retyped per tournament and duplicated inside the Boosty provider blob.

**Architecture:** a typed nullable `workspace.discord_guild_id` column; a single injection point in `SqlEntitlementStore.load_configs` that merges it into every `ProviderConfigRow` (leaving `DiscordRoleResolver` and its whole test suite untouched); the guild removed from `provider_config.config_json`, from `log_processing.discord_channel`, and from both admin forms.

**Tech stack:** SQLAlchemy 2 + Alembic, Pydantic v2, FastStream RPC workers behind a Go gateway, Next.js + React Query + `next-intl`.

---

## House Rules (apply to every task)

- **Prefix git/test/build commands with `rtk`.** Even inside `&&` chains.
- **Edit files with the Edit/Write tools only.** PowerShell mangles UTF-8 here.
- **Backend tests:** `cd backend && rtk uv run --package <service> pytest <path> -v`.
- **There is NO `pytest-asyncio`.** A bare `async def test_…` in a plain class is collected and never awaited — it reports green while asserting nothing. Async tests MUST subclass `unittest.IsolatedAsyncioTestCase`.
- **After Python edits:** `cd backend && rtk uv run ruff check <paths> --fix && rtk uv run ruff format <paths>`.
- **Frontend:** `cd frontend && rtk npx vitest run <path>`, `rtk npx tsc --noEmit`.
- **i18n:** `frontend/src/i18n/messages/en.json` **and** `ru.json` change in the same task. Never one without the other.
- **Never hardcode `down_revision`.** `rtk uv run alembic heads` is authoritative. (A scan of the 132 revision files says `subs0003`; treat that as a hint to confirm, not a fact. A previous plan was wrong doing exactly this.)
- **Never run a bare `alembic upgrade head` from a dev shell** — the dev env may point at production. Verify with `alembic upgrade <rev> --sql` and round-trip only against an explicitly named scratch database.
- **Conventional commits, no attribution.** Stage exact paths (`git add a b c`), never `-u` / `-A`.
- The admin panel is largely untranslated, but `SubscriptionProviderCard` **is** (`useTranslations("subscriptionProviders")`). Respect what each file already does.

---

## Phase 0 — Pre-flight

### Task 0: Confirm the two guild sources agree

The migration prefers the Boosty config over `discord_channel`. If they disagree for a live workspace, the backfill silently picks a winner — find out before writing it.

**Step 1: Query both sources**

```sql
-- against the target database, read-only
select w.id, w.slug,
       (select pc.config_json ->> 'guild_id'
          from subscriptions.provider_config pc
         where pc.workspace_id = w.id and pc.provider = 'boosty')            as boosty_guild,
       (select array_agg(distinct dc.guild_id)
          from log_processing.discord_channel dc
          join tournament.tournament t on t.id = dc.tournament_id
         where t.workspace_id = w.id)                                        as channel_guilds
  from workspace w
 order by w.id;
```

**Step 2: Record the outcome in the PR description**

Expected: for every row, `boosty_guild` is null or equals the single element of `channel_guilds`. If any row disagrees, **stop and ask** which value is correct — do not let the migration decide.

No commit.

---

## Phase 1 — Data

### Task 1: Add the model column

**Files:**
- Modify: `backend/shared/models/tenancy/workspace.py:55-62`

**Step 1: Add the column after the custom-domain block, before `default_division_grid_version_id`**

```python
    # The organizer's Discord guild. ONE per workspace: the server where Boosty's
    # bot assigns patron roles and the server holding match-log channels are the
    # same one. String, not BigInteger: there is no arithmetic, no range query and
    # no FK, while both consumers (DiscordRoleResolver, the HTTP boundary) want
    # `str` — a numeric column would only buy a conversion at every edge.
    discord_guild_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
```

`String` is already imported at `workspace.py:4`. Do not add an import.

**Step 2: Verify the model imports cleanly**

```bash
cd backend && rtk uv run --package shared python -c "from shared import models; print(models.Workspace.__table__.c.discord_guild_id.type)"
```

Expected: `VARCHAR(32)`

**Step 3: Commit**

```bash
rtk git add backend/shared/models/tenancy/workspace.py
rtk git commit -m "feat(workspace): add discord_guild_id column to the model"
```

---

### Task 2: Write the migration

**Files:**
- Create: `backend/migrations/versions/wsguild0001_move_discord_guild_to_workspace.py`

**Step 1: Read the authoritative head**

```bash
cd backend && rtk uv run alembic heads
```

Use the printed revision as `down_revision`. If more than one head prints, chain off the one on this lineage and say so in the docstring.

**Step 2: Write the migration**

```python
"""move the discord guild id to workspace

The guild lived in two unrelated places: ``subscriptions.provider_config``'s
``config_json['guild_id']`` (workspace-scoped, Boosty only, and the only one
anything read) and ``log_processing.discord_channel.guild_id`` (one row per
tournament, written by the admin form and read by nobody — the bot keys on
``channel_id`` alone).

Backfill precedence is the Boosty config first, because that is the value the
running system actually resolves against, so preferring it cannot change current
admission behaviour. The tournament channels are the fallback.

``guild_id`` is stripped out of ``config_json`` in the same revision. Leaving it
would keep two sources of truth and make the injection order in
``SqlEntitlementStore.load_configs`` load-bearing and untestable.

``downgrade`` restores the original schema exactly: ``discord_channel.guild_id``
comes back as ``BigInteger NOT NULL``. Rows with no resolvable guild get ``0`` —
precisely as meaningful as the value was before, since nothing read it.

Revision ID: wsguild0001
Revises: <from `alembic heads`>
Create Date: 2026-08-04

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "wsguild0001"
down_revision: str | Sequence[str] | None = "<from `alembic heads`>"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("workspace", sa.Column("discord_guild_id", sa.String(length=32), nullable=True))

    # 1. The value the resolver actually reads wins.
    op.execute(
        """
        update workspace w
           set discord_guild_id = pc.config_json ->> 'guild_id'
          from subscriptions.provider_config pc
         where pc.workspace_id = w.id
           and pc.provider = 'boosty'
           and coalesce(pc.config_json ->> 'guild_id', '') <> ''
        """
    )

    # 2. Fallback: the most recently created tournament channel for that workspace.
    op.execute(
        """
        update workspace w
           set discord_guild_id = src.guild_id::text
          from (
                select distinct on (t.workspace_id)
                       t.workspace_id, dc.guild_id
                  from log_processing.discord_channel dc
                  join tournament.tournament t on t.id = dc.tournament_id
                 where dc.guild_id is not null
                 order by t.workspace_id, dc.created_at desc, dc.id desc
               ) src
         where src.workspace_id = w.id
           and w.discord_guild_id is null
        """
    )

    # 3. One source of truth: the blob must not keep a competing copy.
    op.execute(
        "update subscriptions.provider_config "
        "set config_json = ((config_json::jsonb) - 'guild_id')::json "
        "where config_json::jsonb ? 'guild_id'"
    )

    op.drop_column("discord_channel", "guild_id", schema="log_processing")


def downgrade() -> None:
    # NOT NULL is restored via a server default, then the default is dropped, so
    # the resulting schema is byte-identical to pre-upgrade.
    op.add_column(
        "discord_channel",
        sa.Column("guild_id", sa.BigInteger(), nullable=False, server_default="0"),
        schema="log_processing",
    )
    op.execute(
        """
        update log_processing.discord_channel dc
           set guild_id = w.discord_guild_id::bigint
          from tournament.tournament t
          join workspace w on w.id = t.workspace_id
         where t.id = dc.tournament_id
           and w.discord_guild_id ~ '^[0-9]+$'
        """
    )
    op.alter_column("discord_channel", "guild_id", server_default=None, schema="log_processing")

    op.execute(
        """
        update subscriptions.provider_config pc
           set config_json = ((pc.config_json::jsonb)
                              || jsonb_build_object('guild_id', w.discord_guild_id))::json
          from workspace w
         where w.id = pc.workspace_id
           and pc.provider = 'boosty'
           and w.discord_guild_id is not null
        """
    )

    op.drop_column("workspace", "discord_guild_id")
```

> **The casts are load-bearing and already resolved — do not second-guess them.** `config_json` is
> `sa.JSON()` (`subs0001_add_subscription_tables.py:53`), so the PostgreSQL column type is `json`,
> **not** `jsonb`. The `-` and `||` operators, and the `?` existence test, exist only on `jsonb`;
> applying them to `json` is a hard `operator does not exist` error. Hence `::jsonb` in and `::json`
> back out. The same applies to any future edit of this blob.

**Step 3: Render the DDL without touching a database**

```bash
cd backend && rtk uv run alembic upgrade <head>:wsguild0001 --sql
```

Expected: `ALTER TABLE workspace ADD COLUMN discord_guild_id VARCHAR(32)`, the three `UPDATE`s, and `ALTER TABLE log_processing.discord_channel DROP COLUMN guild_id`.

**Step 4: Round-trip against a scratch database only**

```bash
cd backend && DB_PGBOUNCER=false rtk uv run alembic upgrade wsguild0001 \
  && DB_PGBOUNCER=false rtk uv run alembic downgrade -1 \
  && DB_PGBOUNCER=false rtk uv run alembic upgrade wsguild0001
```

Expected: all three clean. A migration whose downgrade is untested is not finished.

**Step 5: Commit**

```bash
rtk git add backend/migrations/versions/wsguild0001_move_discord_guild_to_workspace.py
rtk git commit -m "feat(db): move the discord guild id to workspace"
```

---

## Phase 2 — Read path

### Task 3: Inject the workspace guild in `load_configs`

**Files:**
- Modify: `backend/shared/services/subscription_store.py:36-52`
- Test: `backend/shared/tests/test_subscription_store_integration.py`

This is the only production site that builds `ProviderConfigRow`, and the injection only exists once real Postgres runs the join — so the DSN-gated integration file (whose stated purpose is "things only real Postgres has an opinion about") is the right home, and it **must actually be run**, not left skipped.

**Step 1: Teach the harness to own `workspace.discord_guild_id`**

In `asyncSetUp`, after the `self.ws` / `self.au` resolution at `:70`:

```python
        # Snapshot: this suite mutates a real workspace row and must put it back.
        self._guild_before = (
            await self._session.execute(
                sa.text("select discord_guild_id from workspace where id=:w"), {"w": self.ws}
            )
        ).scalar()
```

In `asyncTearDown`, before the existing `commit()` at `:81`:

```python
        await self._session.execute(
            sa.text("update workspace set discord_guild_id=:g where id=:w"),
            {"g": self._guild_before, "w": self.ws},
        )
```

Add a helper beside `_configure_boosty`:

```python
    async def _set_workspace_guild(self, guild_id: str | None) -> None:
        await self._session.execute(
            sa.text("update workspace set discord_guild_id=:g where id=:w"),
            {"g": guild_id, "w": self.ws},
        )
        await self._session.commit()
```

**Step 2: Write the failing tests**

`_configure_boosty` currently seeds `'{"guild_id":"999"}'` (`:90`). Change that literal to `'{}'` — the blob no longer carries a guild — and rewrite the assertion at `:108`.

```python
    async def test_load_configs_returns_only_configured_providers(self):
        await self._set_workspace_guild("424242424242424242")
        await self._configure_boosty()
        configs = await self.store.load_configs(self.ws, ["boosty", "twitch"])
        assert set(configs) == {"boosty"}
        assert configs["boosty"].enabled is True
        # The guild comes from the workspace, not from the provider blob.
        assert configs["boosty"].config["guild_id"] == "424242424242424242"

    async def test_a_workspace_without_a_guild_reads_back_as_unconfigured(self):
        """The fail-open path: no guild must reach the resolver as "not set"."""
        await self._set_workspace_guild(None)
        await self._configure_boosty()
        configs = await self.store.load_configs(self.ws, ["boosty"])
        assert configs["boosty"].config["guild_id"] == ""

    async def test_a_stale_blob_guild_cannot_outrank_the_workspace(self):
        """Regression guard for the injection order — the blob must lose."""
        await self._set_workspace_guild("111111111111111111")
        await self._session.execute(
            sa.text(
                "insert into subscriptions.provider_config "
                "(workspace_id, provider, enabled, config_json) "
                "values (:ws,'boosty',true,'{\"guild_id\":\"999\"}') "
                "on conflict on constraint uq_subscription_config_workspace_provider "
                "do update set config_json='{\"guild_id\":\"999\"}'"
            ),
            {"ws": self.ws},
        )
        await self._session.commit()
        configs = await self.store.load_configs(self.ws, ["boosty"])
        assert configs["boosty"].config["guild_id"] == "111111111111111111"
```

**Step 3: Run them to verify they fail**

```bash
cd backend && SUBSCRIPTIONS_IT_DSN=postgresql+psycopg://USER:PW@127.0.0.1:15432/anak_dev \
  rtk uv run --package shared pytest shared/tests/test_subscription_store_integration.py -v
```

Expected: the three tests FAIL (`KeyError: 'guild_id'` / stale `"999"`). **A skip is not a failure** — if you see `s`, the DSN is wrong; fix it before continuing.

**Step 4: Implement the injection**

Replace `load_configs` (`:36-52`):

```python
    async def load_configs(self, workspace_id: int, providers: Sequence[str]) -> dict[str, ProviderConfigRow]:
        if not providers:
            return {}
        cfg = models.SubscriptionProviderConfig
        rows = await self._session.execute(
            sa.select(cfg.provider, cfg.enabled, cfg.config_json, models.Workspace.discord_guild_id)
            .join(models.Workspace, models.Workspace.id == cfg.workspace_id)
            .where(
                cfg.workspace_id == workspace_id,
                cfg.provider.in_(list(providers)),
            )
        )
        return {
            provider: ProviderConfigRow(
                provider=provider,
                enabled=bool(enabled),
                # The guild belongs to the workspace, never to the provider blob.
                # Injected here -- the single place configs are born -- so the
                # resolver's `config["guild_id"]` contract, and with it the whole
                # fail-open decision table, stays untouched.
                config={**(config or {}), "guild_id": guild_id or ""},
            )
            for provider, enabled, config, guild_id in rows.all()
        }
```

The join cannot drop rows: `provider_config.workspace_id` is a `NOT NULL` FK to `workspace`.

**Step 5: Run the tests to verify they pass**

Same command as Step 3. Expected: all PASS, none skipped.

**Step 6: Confirm the resolver suites are still green, untouched**

```bash
cd backend && rtk uv run --package shared pytest shared/tests/test_resolve_subscriptions.py \
  shared/tests/test_subscription_provider_discord.py shared/tests/test_subscription_check_log.py \
  shared/tests/test_resolve_verification_method.py -v
```

Expected: all PASS **with zero edits to those files.** They are seeded with `{"guild_id": "9"}` through fake stores, they assert a contract this design deliberately preserves, and their staying green untouched is the evidence the chokepoint was chosen correctly. If you find yourself editing them, the injection is in the wrong place.

**Step 7: Commit**

```bash
cd backend && rtk uv run ruff check shared/services/subscription_store.py shared/tests/test_subscription_store_integration.py --fix \
  && rtk uv run ruff format shared/services/subscription_store.py shared/tests/test_subscription_store_integration.py
rtk git add backend/shared/services/subscription_store.py backend/shared/tests/test_subscription_store_integration.py
rtk git commit -m "feat(subscriptions): read the discord guild from the workspace"
```

---

## Phase 3 — Backend schemas

### Task 4: Expose the guild on the workspace schemas

**Files:**
- Modify: `backend/app-service/src/schemas/workspace.py:10-12, 26-56, 66-127`
- Test: `backend/app-service/tests/test_workspace_discord_guild_schema.py` (create)

Plain pytest functions, no DB — matching `test_workspace_branding_schema.py`.

**Step 1: Write the failing tests**

```python
"""Unit tests for the workspace Discord-guild schema validation (no DB required)."""

import pytest
from pydantic import ValidationError

from src import schemas


def test_update_accepts_a_snowflake():
    model = schemas.WorkspaceUpdate(discord_guild_id="1234567890123456789")
    assert model.discord_guild_id == "1234567890123456789"


def test_update_strips_surrounding_whitespace():
    assert schemas.WorkspaceUpdate(discord_guild_id="  1234567890123456789  ").discord_guild_id == (
        "1234567890123456789"
    )


@pytest.mark.parametrize("bad", ["notanumber", "12345", "1" * 21, "123456789012345678a", "12 34"])
def test_update_rejects_anything_that_is_not_a_snowflake(bad):
    with pytest.raises(ValidationError):
        schemas.WorkspaceUpdate(discord_guild_id=bad)


@pytest.mark.parametrize("blank", ["", "   ", "\t", "\n"])
def test_a_blank_id_clears_it_instead_of_failing_the_pattern(blank):
    model = schemas.WorkspaceUpdate(discord_guild_id=blank)
    assert model.discord_guild_id is None
    assert model.model_dump(exclude_unset=True) == {"discord_guild_id": None}


def test_omitting_the_field_writes_nothing():
    assert schemas.WorkspaceUpdate().model_dump(exclude_unset=True) == {}


def test_explicit_none_clears_it():
    assert schemas.WorkspaceUpdate(discord_guild_id=None).model_dump(exclude_unset=True) == {
        "discord_guild_id": None
    }


def test_read_defaults_to_none():
    assert "discord_guild_id" in schemas.WorkspaceRead.model_fields
    assert schemas.WorkspaceRead.model_fields["discord_guild_id"].default is None
```

**Step 2: Run to verify they fail**

```bash
cd backend && rtk uv run --package app-service pytest app-service/tests/test_workspace_discord_guild_schema.py -v
```

Expected: FAIL — `WorkspaceUpdate` has no such field, so the valid-input tests error and the reject tests pass for the wrong reason.

**Step 3: Implement**

Beside `_HEX_COLOR` (`:12`):

```python
# A Discord snowflake: 17-19 digits today, 20 leaves headroom past 2090. Kept as a
# string end to end because it exceeds 2**53 and a float round-trip would corrupt it.
_DISCORD_SNOWFLAKE = r"^\d{17,20}$"
```

In `WorkspaceRead`, after `custom_domain_verification_token` (`:53`):

```python
    # The organizer's Discord guild. Public for the same reason
    # `custom_domain_verification_token` above is: it is not a secret -- every
    # Discord message link is `discord.com/channels/<guild_id>/<channel_id>/<id>`.
    # A genuinely secret integration value must NOT follow this path; it needs an
    # authenticated admin read model.
    discord_guild_id: str | None = None
```

In `WorkspaceUpdate`, after `seo_description` (`:85`):

```python
    discord_guild_id: str | None = Field(default=None, max_length=32, pattern=_DISCORD_SNOWFLAKE)
```

And a validator beside `_validate_subdomain`:

```python
    @field_validator("discord_guild_id", mode="before")
    @classmethod
    def _blank_snowflake_to_none(cls, value: object) -> object:
        # A blank id means "clear it", not "fail the digits pattern" -- the same
        # discipline `_blank_hex_to_none` applies to the brand colours.
        if isinstance(value, str):
            return value.strip() or None
        return value
```

`mode="before"` matters: it must run ahead of the pattern check, exactly as the brand-colour validator does.

**Step 4: Run to verify they pass**

Same command as Step 2. Expected: all PASS.

**Step 5: Confirm nothing else regressed**

```bash
cd backend && rtk uv run --package app-service pytest app-service/tests/test_workspace_branding_schema.py -v
```

**Step 6: Commit**

```bash
cd backend && rtk uv run ruff check app-service/src/schemas/workspace.py app-service/tests/test_workspace_discord_guild_schema.py --fix \
  && rtk uv run ruff format app-service/src/schemas/workspace.py app-service/tests/test_workspace_discord_guild_schema.py
rtk git add backend/app-service/src/schemas/workspace.py backend/app-service/tests/test_workspace_discord_guild_schema.py
rtk git commit -m "feat(workspace): accept and expose discord_guild_id"
```

The write path needs no handler change: `workspace.update` already flows through the generic CRUD engine (`src/services/workspace/registry.py`) with `exclude_unset`.

---

### Task 5: Remove the guild from the subscription provider config

**Files:**
- Modify: `backend/tournament-service/src/schemas/registration.py:290, 351, 359-360`
- Modify: `backend/tournament-service/src/services/registration/subscription_config.py:58-59, 98, 125-149`
- Test: `backend/tournament-service/tests/test_subscription_provider_config.py`
- Test: `backend/tournament-service/tests/test_subscription_config_integration.py`
- Test: `backend/tournament-service/tests/test_verification_method_integration.py:111-113`

**Step 1: Write the failing tests**

In `test_subscription_provider_config.py`, delete the four `guild_id`-only cases (`test_stores_guild_id_and_role_tiers`, `test_omitting_guild_id_keeps_the_stored_one`, `test_an_explicit_empty_guild_id_clears_it`, and the `guild_id` half of `test_keeps_snowflakes_as_strings` — keep its `role_id` half) and add:

```python
    def test_the_guild_is_no_longer_part_of_the_provider_blob(self):
        assert "guild_id" not in SubscriptionProviderConfigUpsert.model_fields

    def test_a_stale_client_guild_is_ignored_not_written(self):
        """The blob must never regain the key, whatever an old frontend posts."""
        body = SubscriptionProviderConfigUpsert.model_validate({"provider": "boosty", "guild_id": "999"})
        assert "guild_id" not in build_config_json(body, existing={})

    def test_a_stored_guild_is_not_echoed_back(self):
        row = _Row(config={"guild_id": "999", "role_tiers": [{"role_id": "1", "tier_rank": 1}]})
        read = serialize_provider_config(row)
        assert not hasattr(read, "guild_id")
```

Note the second test's shape. `SubscriptionProviderConfigUpsert(BaseModel)` declares no
`model_config` (verified at `registration.py:279`), so Pydantic v2's default `extra="ignore"`
applies: a stale client's `guild_id` is dropped at parse time, and a `pytest.raises` test would
fail. Asserting it is *ignored, not written* pins the property that actually matters — the blob
cannot regain the key.

**Do NOT add `model_config = ConfigDict(extra="forbid")` here.** It is tempting, but it turns
every unknown field on this endpoint into a 422 for reasons unrelated to this refactor. If that
strictness is wanted, it is its own change with its own justification.

In `test_subscription_config_integration.py`: drop `guild_id=` from every `_save(...)` call (`:105, 114, 133, 149-150`), delete `test_stores_guild_id...`-shaped assertions (`:108, 161`), and keep `test_repeated_save_updates_in_place` alive by switching its distinguishing field to `verification_method`. In `test_verification_method_integration.py:112`, delete the `body["guild_id"] = GUILD` line; `role_tiers` alone is what `with_guild` now means — rename the flag to `with_roles`.

Add one integration test asserting the list response carries the workspace guild:

```python
    async def test_the_list_response_reports_the_workspace_guild(self):
        await self._session.execute(
            sa.text("update workspace set discord_guild_id='424242424242424242' where id=:w"),
            {"w": self._workspace_id},
        )
        await self._session.commit()
        response = await subscription_config.list_provider_configs(self._session, self._workspace_id)
        assert response.discord_guild_id == "424242424242424242"
```

Match the surrounding file's fixture names; restore the column in teardown as Task 3 does.

**Step 2: Run to verify they fail**

```bash
cd backend && rtk uv run --package tournament-service pytest \
  tournament-service/tests/test_subscription_provider_config.py \
  tournament-service/tests/test_verification_method_integration.py -v
```

**Step 3: Implement**

- `registration.py:290` — delete `guild_id: str | None = Field(default=None, max_length=32)` from `SubscriptionProviderConfigUpsert`.
- `registration.py:351` — delete `guild_id: str | None = None` from `SubscriptionProviderConfigRead`.
- `registration.py:359-360` — `SubscriptionProviderConfigListResponse` gains:
  ```python
      # One field for the whole response, not one per provider: the guild belongs to
      # the workspace. The card renders it read-only and warns when it is unset.
      discord_guild_id: str | None = None
  ```
- `subscription_config.py:58-59` — delete the `body.guild_id` branch from `build_config_json`.
- `subscription_config.py:98` — delete `guild_id=config.get("guild_id") or None` from `serialize_provider_config`.
- `subscription_config.py:125-149` — `list_provider_configs` reads the workspace guild once and passes it through:
  ```python
      discord_guild_id = await session.scalar(
          sa.select(models.Workspace.discord_guild_id).where(models.Workspace.id == workspace_id)
      )
      ...
      return SubscriptionProviderConfigListResponse(
          configs=configs, discord_guild_id=discord_guild_id or None
      )
  ```

**Step 4: Run to verify they pass**

```bash
cd backend && rtk uv run --package tournament-service pytest tournament-service/tests -k subscription -v
```

**Step 5: Commit**

```bash
cd backend && rtk uv run ruff check tournament-service/src/schemas/registration.py tournament-service/src/services/registration/subscription_config.py tournament-service/tests --fix \
  && rtk uv run ruff format tournament-service/src/schemas/registration.py tournament-service/src/services/registration/subscription_config.py tournament-service/tests
rtk git add backend/tournament-service/src/schemas/registration.py backend/tournament-service/src/services/registration/subscription_config.py backend/tournament-service/tests
rtk git commit -m "refactor(subscriptions): drop guild_id from the provider config"
```

---

### Task 6: Remove the guild from the tournament Discord channel

**Files:**
- Modify: `backend/shared/models/ingestion/discord_channel.py:23`
- Modify: `backend/parser-service/src/schemas/admin/discord_channel.py:9-37`
- Modify: `backend/parser-service/src/rpc/misc.py:128`

Nothing reads this column — the bot's `load_active_channels` keys on `channel_id` alone — so there is no behaviour to preserve, only a field to stop demanding.

**The ORM attribute is not optional cleanup — it is required for correctness.** Task 2 drops the
column, and SQLAlchemy emits every mapped column in every `SELECT`. Leaving
`TournamentDiscordChannel.guild_id` declared would make **all** queries against
`log_processing.discord_channel` fail with `UndefinedColumn` the moment the migration lands: the
bot's channel load, the parser's get/upsert, the admin panel. Delete line 23 of the model in this
task, and note that `BigInteger` may then be an unused import in that file.

**Step 1: Implement**

In `discord_channel.py`, remove `guild_id` from both models, drop it from the `field_validator` tuple at `:34` (leaving `"channel_id"`), and update the class docstring:

```python
class DiscordChannelUpsert(BaseModel):
    """Schema for creating or updating a tournament Discord sync channel.

    channel_id is a Discord snowflake (64-bit integer), accepted as a string to
    avoid JavaScript float64 precision loss on the client side. The guild is not
    here: it belongs to the workspace (``Workspace.discord_guild_id``) and was
    duplicated into every tournament row while being read by nobody.
    """

    channel_id: str
    channel_name: str | None = None
    is_active: bool = True
```

In `misc.py`, delete line 128 (`channel.guild_id = int(body.guild_id)`).

**Step 2: Verify the parser suite and a clean import**

```bash
cd backend && rtk uv run --package parser-service pytest parser-service/tests -v
cd backend/parser-service && rtk uv run python -c "from src.schemas.admin.discord_channel import DiscordChannelUpsert as U, DiscordChannelRead as R; print(sorted(U.model_fields), sorted(R.model_fields))"
cd backend && rtk uv run --package shared python -c "from shared import models; print(sorted(c.name for c in models.TournamentDiscordChannel.__table__.c))"
```

Expected, in order: the parser suite green with **zero skips** (it is unit-level and needs no DB);
`['channel_id', 'channel_name', 'is_active'] ['channel_id', 'channel_name', 'id', 'is_active', 'tournament_id']`;
and `['channel_id', 'channel_name', 'created_at', 'id', 'is_active', 'tournament_id', 'updated_at']`
with **no `guild_id`** — that last one is the check that actually matters, since a surviving ORM
attribute would break every query once the migration lands.

**Step 3: Confirm nothing else referenced it**

```bash
rtk grep -rn "guild_id" backend/parser-service backend/discord-service
```

Expected: no matches.

**Step 4: Commit**

```bash
cd backend && rtk uv run ruff check parser-service/src/schemas/admin/discord_channel.py parser-service/src/rpc/misc.py --fix \
  && rtk uv run ruff format parser-service/src/schemas/admin/discord_channel.py parser-service/src/rpc/misc.py
rtk git add backend/parser-service/src/schemas/admin/discord_channel.py backend/parser-service/src/rpc/misc.py
rtk git commit -m "refactor(parser): drop guild_id from the tournament discord channel"
```

---

## Phase 4 — Frontend

### Task 7: Update the types

**Files:**
- Modify: `frontend/src/types/workspace.types.ts:239`
- Modify: `frontend/src/services/workspace.service.ts:42-63`
- Modify: `frontend/src/types/admin.types.ts:1130-1144`
- Modify: `frontend/src/types/registration.types.ts:124-150`

**Step 1: Implement**

- `workspace.types.ts` — `Workspace` (`:211-242`) gains `discord_guild_id: string | null;` right after
  `custom_domain_verification_token` (`:239`), before `default_division_grid_version_id`. Leave the
  separate `WorkspaceBranding` interface (`:249`) alone — it is a branding-only projection.
- `workspace.service.ts` — there is no named update-payload type; `WorkspaceService.update` declares
  its body **inline** at `:42-63`. Add `discord_guild_id?: string | null;` there, or the PATCH from
  Task 8 will not typecheck.
- `admin.types.ts` — remove `guild_id` from `DiscordChannelRead` (`:1133`) and `DiscordChannelInput` (`:1140`).
- `registration.types.ts` — remove `guild_id` from `SubscriptionProviderConfigRead` (`:127`) and
  `SubscriptionProviderConfigUpsert` (`:144`); add `discord_guild_id?: string | null;` to
  `SubscriptionProviderConfigListResponse` (`:135-137`).

**Step 2: Typecheck — the failures are the worklist for Tasks 8-10**

```bash
cd frontend && rtk npx tsc --noEmit
```

Expected: errors in `WorkspaceEditPage`, `SubscriptionProviderCard.tsx`, `TournamentIntegrationsPanel.tsx`, `SubscriptionProviderCard.behavior.test.tsx`. Record the list; do not fix it here.

**Step 3: Commit**

```bash
rtk git add frontend/src/types/workspace.types.ts frontend/src/services/workspace.service.ts frontend/src/types/admin.types.ts frontend/src/types/registration.types.ts
rtk git commit -m "refactor(types): move the discord guild to the workspace type"
```

---

### Task 8: Add the Discord section to the workspace edit page

**Files:**
- Modify: `frontend/src/app/admin/workspaces/[id]/page.tsx:39-79` and the render body

**Step 1: Implement**

Add `discord_guild_id: string | null;` to `EditFormData` (`:39-57`) and `discord_guild_id: ws.discord_guild_id ?? null,` to `formFromWorkspace` (`:59-79`).

Render a section beside the branding/domain ones. Digits-only, so a pasted `<@&…>` or a stray space cannot reach the API:

```tsx
<div>
  <Label htmlFor="discord-guild-id">Discord guild ID</Label>
  <Input
    id="discord-guild-id"
    className="mt-1 font-mono"
    value={form.discord_guild_id ?? ""}
    inputMode="numeric"
    autoComplete="off"
    placeholder="123456789012345678"
    onChange={(e) =>
      setForm((current) =>
        current ? { ...current, discord_guild_id: e.target.value.replace(/\D/g, "") || null } : current
      )
    }
  />
  <p className="mt-1 max-w-prose text-xs text-muted-foreground">
    The server this workspace runs in: where Boosty&apos;s bot assigns subscriber roles and where
    match-log channels live. Enable Developer Mode in Discord, then right-click the server → Copy
    Server ID.
  </p>
</div>
```

Match the surrounding `setForm` shape exactly — this page guards the form behind a `seeded` flag and `form` may be `null`.

Ensure the field reaches the PATCH payload the save mutation builds. If that mutation enumerates fields explicitly, add this one; if it spreads `form`, nothing to do.

**Step 2: Verify**

```bash
cd frontend && rtk npx tsc --noEmit
```

Expected: no remaining errors in this file.

**Step 3: Commit**

```bash
rtk git add "frontend/src/app/admin/workspaces/[id]/page.tsx"
rtk git commit -m "feat(admin): edit the workspace discord guild"
```

---

### Task 9: Make the Boosty card read the workspace guild

**Files:**
- Modify: `frontend/src/components/admin/subscriptions/SubscriptionProviderCard.tsx:102-113, 115-175, 237-254`
- Modify: `frontend/src/i18n/messages/en.json:3692-3695`
- Modify: `frontend/src/i18n/messages/ru.json` (same key path)
- Test: `frontend/src/components/admin/subscriptions/SubscriptionProviderCard.behavior.test.tsx:32-35, 100-108, 154-172, 230-240`

**Step 1: Write the failing tests**

In the behaviour test, drop `guild_id` from the `BOOSTY_*` fixtures and from the twitch fixture assertions, then add:

```tsx
  it("never posts a guild — it belongs to the workspace now", async () => {
    const container = await mount([BOOSTY_WITH_STORED_CODE]);
    // ... click save exactly as the sibling tests do ...
    expect("guild_id" in body).toBe(false);
  });

  it("warns when live verification is on but the workspace has no guild", async () => {
    const container = await mount([{ ...BOOSTY, enabled: true }], { discord_guild_id: null });
    expect(container.textContent).toContain(en.subscriptionProviders.guild.missing);
  });
```

The `mount` helper (`:40-52`) currently takes only a config array; extend it to accept the response-level `discord_guild_id` so the card can be driven both ways.

**Step 2: Run to verify they fail**

```bash
cd frontend && rtk npx vitest run src/components/admin/subscriptions/SubscriptionProviderCard.behavior.test.tsx
```

**Step 3: Rewrite the i18n keys — both dictionaries, this task**

`en.json`:

```json
    "guild": {
      "label": "Discord guild id",
      "current": "Discord guild: {guildId}",
      "unset": "No Discord guild is set for this workspace.",
      "missing": "Live verification needs a Discord guild. Set it in workspace settings.",
      "hint": "Set once per workspace, in workspace settings. Boosty's bot assigns subscriber roles in that server; our bot must also be a member of it."
    },
```

`ru.json`, same key path:

```json
    "guild": {
      "label": "ID Discord-сервера",
      "current": "Discord-сервер: {guildId}",
      "unset": "Для этого воркспейса Discord-сервер не задан.",
      "missing": "Для живой проверки нужен Discord-сервер. Задайте его в настройках воркспейса.",
      "hint": "Задаётся один раз на воркспейс, в его настройках. Бот Boosty выдаёт роли подписчиков на этом сервере; наш бот тоже должен быть его участником."
    },
```

**Step 4: Implement the component change**

`SubscriptionProvidersCard` passes the response-level value down:

```tsx
        {data?.configs.map((config) => (
          <ProviderEditor
            key={`${config.provider}:${JSON.stringify(config)}`}
            workspaceId={workspaceId}
            config={config}
            discordGuildId={data.discord_guild_id ?? null}
            onSaved={() => queryClient.invalidateQueries({ queryKey })}
          />
        ))}
```

In `ProviderEditor`: add `discordGuildId: string | null` to the props, delete the `guildId` state (`:129`), and drop `guild_id: guildId.trim(),` from the save payload (`:154`) — `role_tiers` stays.

`rolesMissing` (`:174-175`) moves to the new source:

```tsx
  const rolesMissing =
    acceptsLive && isBoosty && enabled && Boolean(discordGuildId) && roleTiers.length === 0;

  // Live Boosty verification without a guild resolves `unknown`, and `unknown`
  // fails open — so the gate silently admits everybody. Say so on the screen.
  const guildMissing = acceptsLive && isBoosty && enabled && !discordGuildId;
```

Replace the Guild input block (`:240-254`) with a read-only row plus the warning:

```tsx
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">
                  {discordGuildId
                    ? t("guild.current", { guildId: discordGuildId })
                    : t("guild.unset")}
                </p>
                {guildMissing && (
                  <p className="text-xs font-medium text-destructive">{t("guild.missing")}</p>
                )}
                <p className="max-w-prose text-xs text-muted-foreground">{t("guild.hint")}</p>
              </div>
```

If the card can link out, point at `/admin/workspaces/{workspaceId}`; a bare instruction is acceptable if it cannot.

**Step 5: Run to verify they pass**

```bash
cd frontend && rtk npx vitest run src/components/admin/subscriptions/SubscriptionProviderCard.behavior.test.tsx
cd frontend && rtk npx tsc --noEmit
```

**Step 6: Confirm both dictionaries stayed in sync**

```bash
cd frontend && rtk node -e "const a=require('./src/i18n/messages/en.json').subscriptionProviders.guild,b=require('./src/i18n/messages/ru.json').subscriptionProviders.guild;const d=[...new Set([...Object.keys(a),...Object.keys(b)])].filter(k=>!(k in a)||!(k in b));console.log(d.length?'DRIFT: '+d:'in sync')"
```

Expected: `in sync`

**Step 7: Commit**

```bash
rtk git add frontend/src/components/admin/subscriptions/SubscriptionProviderCard.tsx frontend/src/components/admin/subscriptions/SubscriptionProviderCard.behavior.test.tsx frontend/src/i18n/messages/en.json frontend/src/i18n/messages/ru.json
rtk git commit -m "feat(admin): read the boosty guild from the workspace"
```

---

### Task 10: Drop the guild field from the tournament Discord form

**Files:**
- Modify: `frontend/src/app/admin/tournaments/[id]/components/TournamentIntegrationsPanel.tsx:76-80, 100-107, 158-163, 201, 212-227`

**Step 1: Implement**

Remove `guild_id` from the initial form state (`:77`) and from the reset effect (`:103`); delete the `<DetailField label="Guild" …>` line (`:160`) and the whole Guild ID `<div>` (`:212-227`). Change the dialog description (`:201`) to:

```tsx
        description={`Set the Discord channel for ${tournament.name}.`}
```

If dropping the `DetailField` leaves a `sm:grid-cols-3` with two children (`:159`), make it `sm:grid-cols-2`.

**Step 2: Verify**

```bash
cd frontend && rtk npx tsc --noEmit
rtk grep -rn "guild" frontend/src/app/admin/tournaments
```

Expected: no type errors; no matches in that directory.

**Step 3: Commit**

```bash
rtk git add "frontend/src/app/admin/tournaments/[id]/components/TournamentIntegrationsPanel.tsx"
rtk git commit -m "refactor(admin): drop the guild field from the tournament discord form"
```

---

## Phase 5 — Wire-up, verification, docs

### Task 11: Regenerate the OpenAPI manifest

No new routes, so there is no `edge.RouteSpec`, no `apidocs/groups.go` entry and no `apiv1_guard_test.go` change — only the manifest.

**Step 1: Regenerate**

```bash
bash backend/scripts/export_openapi_schemas.sh
```

**On Windows this script fails with `line 29: uv: command not found`, even though `uv` is on PATH.**
A nested `bash` gets a POSIX-converted PATH that drops `C:\Users\<you>\.local\bin`, and exporting
`PATH` into it does not help — it is a different shell. Reproduce the script's two steps in the
working shell instead (verified: ~8 s total):

```bash
export POSTGRES_USER=x POSTGRES_PASSWORD=x POSTGRES_DB=x POSTGRES_HOST=x POSTGRES_PORT=5432 \
       REDIS_URL=redis://x:6379 RABBITMQ_URL=amqp://x JWT_SECRET_KEY=x SECRET_KEY=x \
       PROJECT_URL=http://x CHALLONGE_USERNAME=x CHALLONGE_API_KEY=x
mkdir -p /tmp/oas && frags=""
for svc in tournament-service app-service analytics-service balancer-service parser-service identity-service; do
  (cd "backend/$svc" && uv run python ../scripts/export_openapi_schemas.py) > "/tmp/oas/$svc.json" || exit 1
  frags="$frags /tmp/oas/$svc.json"
done
uv --project backend run python backend/scripts/merge_openapi_schemas.py $frags > gateway/internal/openapi/schemas.json
```

Do NOT try this inside the `eval` tool: `uv run` under a captured subprocess there hangs and takes
the kernel with it.

**Step 2: Verify the diff says what it should**

```bash
rtk git diff --stat gateway/internal/openapi/schemas.json
# Strict check -- grep alone gives false positives, because the rewritten
# DiscordChannelUpsert *docstring* mentions `Workspace.discord_guild_id`.
jq -r '.schemas | to_entries | map(select((.value.properties // {}) | has("discord_guild_id"))) | .[].key' gateway/internal/openapi/schemas.json
jq -r '[.schemas | to_entries[] | select((.value.properties // {}) | has("guild_id")) | .key] | if length==0 then "NONE" else .[] end' gateway/internal/openapi/schemas.json
```

Expected: the first `jq` prints exactly `app.WorkspaceRead`, `app.WorkspaceUpdate`,
`tournament.SubscriptionProviderConfigListResponse`; the second prints `NONE`. A missing manifest
entry degrades silently to a generic `object` — verify, do not assume.

**Expect a diff far larger than this change** (observed: +724/-175, including unrelated fields such
as `boosty_nick`). `schemas.json` was already stale on `develop` — it was last regenerated at
`5121b3e4`, while the service schemas moved on since. Regenerating repairs that drift as a
side effect. Say so in the commit message rather than pretending the diff is all yours; the
generator is all-or-nothing, so it cannot be split.

**Step 3: Gateway tests**

```bash
cd gateway && rtk go test ./...
```

The Go module is rooted at `gateway/`, so `go test ./gateway/...` from the repo root fails with
`directory prefix gateway does not contain main module`. Expected: 356 passed in 32 packages.

**Step 4: Commit**

```bash
rtk git add gateway/internal/openapi/schemas.json
rtk git commit -m "chore(gateway): regenerate the openapi manifest"
```

---

### Task 12: Full suites

**Step 1: Backend**

```bash
cd backend && rtk uv run --package shared pytest shared/tests -v
cd backend && rtk uv run --package tournament-service pytest tournament-service/tests -v
cd backend && rtk uv run --package app-service pytest app-service/tests -v
cd backend && rtk uv run --package parser-service pytest parser-service/tests -v
```

**Step 2: The DSN-gated store integration, actually run**

```bash
cd backend && SUBSCRIPTIONS_IT_DSN=postgresql+psycopg://USER:PW@127.0.0.1:15432/anak_dev \
  rtk uv run --package shared pytest shared/tests/test_subscription_store_integration.py -v
```

Expected: PASS, **zero skips.** This is the only test that exercises the join.

**Step 3: Frontend**

```bash
cd frontend && rtk npx tsc --noEmit && rtk npx vitest run
```

**Step 4: Grep for leftovers**

```bash
rtk grep -rn "guild_id" backend/ frontend/src gateway/internal --include=*.py --include=*.ts --include=*.tsx --include=*.go
```

Expected: only `workspace.discord_guild_id` and its schema/type/UI references, the resolver's own `config["guild_id"]` contract plus its fake-store test fixtures, the migration, and `evidence["guild_id"]` in verdicts. No `discord_channel` or `provider_config` writers.

No commit unless a fix was needed.

---

### Task 13: Docs

**Files:**
- Modify: `docs/database_erd.md:1388-1394` and its changelog section
- Modify: `frontend/src/app/docs/diagrams.ts:1405-1411` (same two edits — this file mirrors the ERD)
- Modify: `backend/shared/models/subscriptions/subscription.py:43-47`
- Modify: `backend/shared/subscriptions/providers/discord_role.py:12-21`
- Modify: `backend/shared/subscriptions/verification.py:12-13`

**Step 1: ERD**

Remove `int guild_id` from the `DISCORD_CHANNEL` block (`database_erd.md:1391`).

**`WORKSPACE` appears seven times in this file** — once fully specified at `:284`, and six times as
a `{ int id PK }` stub inside other diagrams. Add `string discord_guild_id` to the **full block at
`:284` only**; touching a stub would put a column into a diagram that deliberately elides them.

Add `wsguild0001` to the revision changelog with the new head.

**Step 2: Mirror it in `diagrams.ts`**

The same two edits, at this file's own anchors: drop `int guild_id` from `DISCORD_CHANNEL`
(`diagrams.ts:1408`) and add `string discord_guild_id` to the full `WORKSPACE` block
(`diagrams.ts:354`) — again, not to the six stubs. These two files drift silently; change both
or neither.

**Step 3: Docstrings**

- `subscription.py:45` — the provider-shape list becomes `` - ``discord_role``:   ``{role_tiers: [{role_id, tier_rank, tier_label}]}`` (the guild comes from ``Workspace.discord_guild_id``) ``.
- `discord_role.py` header — note that `config["guild_id"]` is injected by `SqlEntitlementStore.load_configs` from the workspace, not stored in the blob, and that this is why the resolver's contract is unchanged.
- `verification.py:13` — "an organizer with no Discord server leaves `guild_id` empty" becomes "leaves `Workspace.discord_guild_id` unset".

**Step 4: Commit**

```bash
rtk git add docs/database_erd.md frontend/src/app/docs/diagrams.ts backend/shared/models/subscriptions/subscription.py backend/shared/subscriptions/providers/discord_role.py backend/shared/subscriptions/verification.py
rtk git commit -m "docs: record the workspace discord guild"
```

---

### Task 14: Browser smoke — mandatory

Automated tests cannot prove the fail-open path end to end, and that path is the whole reason this refactor is risky. Walk all six.

1. `/admin/workspaces/{id}` → set a guild → save → hard reload. It persists. Paste `<@&123>` into the field: only digits land.
2. Same screen → clear the guild → save → reload. It reads back empty.
3. Tournament registration-form builder → the Boosty card shows the workspace guild read-only, with no editable Guild input. Clear the workspace guild and reopen: the `guild.missing` warning appears.
4. **Fail-open, live.** Boosty enabled, role tiers configured, workspace guild **unset** → a player checks in. **Check-in succeeds.** In `subscriptions.check_log` / the entitlement row the verdict is `unknown` with reason `guild_not_configured`. A block here means the injection returns something other than `""`.
5. Set the guild to a real server the bot is in → refresh a patron's verdict → it resolves `active` with the right tier. Point it at a guild the bot is **not** in → `unknown` / `guild_not_accessible`, and check-in still succeeds.
6. Tournament → Integrations → the Discord dialog has **no** Guild field. Save a channel. Post a log in that channel and confirm the bot still ingests it — proof that dropping the column did not touch collection.

**Step: Commit any fixes**

```bash
rtk git commit -m "fix(subscriptions): <what the smoke test caught>"
```

---

## Rollout Notes

- **Order matters, and it cuts both ways.** The migration strips `config_json.guild_id`, so old code running *after* it reads `unknown("guild_not_configured")` and fails open for every Boosty-gated tournament. But the parser's ORM attribute is dropped by the code, while `discord_channel.guild_id` stays `NOT NULL` with no server default until the migration runs — so new code running *before* it returns 500 from `_discord_upsert` when an admin adds a match-log channel. **Migrate first, then roll the services**, and keep the gap short.
- **The subscription-gate window is fail-open, not fail-closed** — nobody is wrongly blocked, some may be wrongly admitted. Prefer a low-traffic window; do not attempt a zero-downtime dance for it.
- **Rollback:** `alembic downgrade -1` restores the schema exactly and preserves the guild into a disabled `boosty` config row, so a later re-upgrade recovers it. Verify with the round-trip (Task 2 Step 4), do not assume.

---

## Post-Review Hardening (applied)

A code-quality review after implementation returned `CHANGES REQUESTED` with two P1 findings. Both were accepted; the sections above describe the plan as originally written, and this records what the code now does differently. The design doc §4.1 carries the full reasoning.

| Finding | Fix | Commit |
| --- | --- | --- |
| **P1** Backfill step 1 copied `config_json ->> 'guild_id'` with only a non-empty check. The old write schema had `max_length=32` and **no** digits pattern, so `"999"` was legal and this repo's own tests seeded it. A workspace backfilled with it would 422 on **every** workspace save (the edit page posts the field unconditionally), and a >32-char value would abort the migration on `String(32)`. | Guard with `~ '^[0-9]{17,19}$'`; drop the now-redundant `coalesce` check. | `992e66ac` |
| **P1** Step 2's `dc.guild_id is not null` was **vacuous** — the column is `NOT NULL` — so `0`, the exact value `downgrade` writes for unresolvable rows, passed through as truthy `'0'`. Worse, this step promotes a never-validated column into a live-gating input, and a wrong guild does **not** fail open: it reads `inactive`/`not_a_member` and **blocks** every patron, where the workspace previously answered `unknown` and admitted everybody. | Floor at `10000000000000000`; rewrite the docstring paragraph that claimed the backfill "cannot change current admission behaviour" — true of step 1 only. | `992e66ac` |
| **P2** `downgrade` cast to `bigint` (max 19 digits) while the schema admitted 20, so a 20-digit id aborted the revision *after* `add_column`, leaving it half-applied. Narrowing to 19 digits is **not** sufficient on its own: 19 digits reaches 9.99e18, still over `bigint`. | Narrow `_DISCORD_SNOWFLAKE` to `^\d{17,19}$` **and** bound the cast by `::numeric <= 9223372036854775807`. | `992e66ac`, `25845c0c` |
| **P2** `downgrade`'s write-back only touched an *existing* `boosty` row, so a workspace with a guild but no `boosty` config and no tournament channel lost its snowflake irrecoverably. | Upsert instead, inserting **disabled** so a rollback cannot start enforcing; the conflict branch touches only `config_json`. Target aliased `pc` rather than a three-part column reference — very probably valid, but a rollback path is the worst place to debug syntax. | `992e66ac`, `af00c2fb` |
| **P3** The Boosty card stacked `guild.unset` and `guild.missing`, saying the same thing twice with the actionable half second. | Show the warning *in place of* the neutral line. | `0f62be84` |
| **P3** The guild input gave no length feedback — 5 or 25 digits both submitted and returned an opaque 422 naming no field. | `maxLength={19}` plus an inline out-of-range hint. | `0f62be84` |
| **P3** Three tests asserted a declaration (`model_fields` introspection) two lines from the source and could not fail on any plausible bug. | Deleted; the behavioural tests beside them already cover the property. | `25845c0c` |
| **P3** `rolesMissing` gained `Boolean(discordGuildId)`, deliberately suppressing the roles warning when the guild is missing too — but nothing pinned it, so flipping the condition passed the whole suite. | Assertion added, and **mutation-tested**: flipping `Boolean(discordGuildId)` to `!discordGuildId` fails it (2/18), reverting restores 18/18. The fixture needed `role_tiers: []` first, or the assertion would itself have been vacuous. | `0f62be84` |
