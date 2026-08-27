# Dynamic `is_newcomer` / `is_newcomer_role` — Implementation Plan

**Design:** `docs/superpowers/specs/2026-08-18-dynamic-newcomer-fields-design.md` — read it first; this plan does not repeat the reasoning.

**Goal:** replace the 3 duplicated, order-of-import-dependent write sites for `Player.is_newcomer`/`is_newcomer_role` with one shared, chronologically-correct computation; add a workspace-admin-configurable scope (`global` | `workspace`); backfill existing rows.

**Architecture:** `Workspace.newcomer_scope` column (plain string, default `"global"`) + `shared/services/newcomer_status.py::load_prior_participation` (one query, `(COALESCE(start_date,'infinity'), id)` ordering, scope-aware) consumed by all 3 write sites; one Alembic migration adds the column and backfills every existing `Player` row via a window-function `UPDATE`.

---

## House Rules

- Prefix git/test/build with `rtk`.
- Backend tests: `cd backend && uv run --package <service> pytest <path> -v` (this repo's tests are plain `unittest`, no `pytest-asyncio` — async tests subclass `unittest.IsolatedAsyncioTestCase`, already the existing convention in every touched test file).
- After Python edits: `cd backend && uv run ruff check <paths> --fix && uv run ruff format <paths>` (paths relative to `backend/`).
- `alembic heads` is authoritative for `down_revision` — confirmed `matchsrc01` as of writing.
- Verify migration SQL offline: `alembic upgrade matchsrc01:ncscope01 --sql` (needs dummy env vars, no live DB).

---

## Phase 1 — Data layer

### Task 1: `Workspace.newcomer_scope` column

**File:** `backend/shared/models/tenancy/workspace.py`

Add after `default_roster_slots_json`:
```python
# Scope used to decide "has this identity played before" when a new Player row
# is created: "global" counts any workspace's tournaments, "workspace" counts
# only this workspace's. See shared.services.newcomer_status. Admin-editable
# via the same PATCH /workspaces/{id} path as branding_enabled.
newcomer_scope: Mapped[str] = mapped_column(String(16), server_default="global", nullable=False)
```

### Task 2: `WorkspaceRead`/`WorkspaceUpdate` schema fields

**File:** `backend/app-service/src/schemas/workspace.py`

- `WorkspaceRead`: add `newcomer_scope: Literal["global", "workspace"] = "global"` after `default_roster_slots_json`.
- `WorkspaceUpdate`: add `newcomer_scope: Literal["global", "workspace"] | None = None`.
- Import `Literal` from `typing`.

No other backend wiring: `rpc.app.admin.update#workspace` is config-driven (`registry.py::REGISTRY["workspace"]`, reflection-based `model_validate`/`setattr`).

---

## Phase 2 — Shared computation

### Task 3: `shared/services/newcomer_status.py`

New file:

```python
"""Chronologically-correct "has this identity played before" resolution.

Replaces 3 independent, order-of-*import*-dependent computations (balancer-service
team.py, parser-service team/flows.py, parser-service match_logs/flows.py) that used
"does a Player row for this identity already exist in the DB right now" -- which
freezes wrong the moment historical data is imported out of chronological order.

Ordering matches the codebase's one established "tournament chronology" convention
(division.py/streak.py/tournament/service.py): `Tournament.start_date NULLS LAST,
Tournament.id`. Reproduced here as `COALESCE(start_date, _FAR_FUTURE)` because Postgres
tuple comparison (`<`, needed here -- not just `ORDER BY`) breaks outright the moment
either side is NULL; `NULLS LAST` has no `<`-comparison equivalent.
"""

from __future__ import annotations

from collections.abc import Collection
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Literal

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from shared.core.enums import HeroClass
from shared.models.tenancy.workspace import Workspace, WorkspaceMember
from shared.models.tournament.team import Player
from shared.models.tournament.tournament import Tournament

__all__ = ("NewcomerScope", "PriorParticipation", "load_prior_participation")

NewcomerScope = Literal["global", "workspace"]

# Stands in for a NULL `start_date` on both sides of the comparison -- the same
# role `NULLS LAST` plays in every `ORDER BY` elsewhere in the codebase, just
# usable in a `<` predicate.
_FAR_FUTURE = datetime(9999, 12, 31, 23, 59, 59, 999999, tzinfo=timezone.utc)


@dataclass(frozen=True)
class PriorParticipation:
    """Identities (and identity+role pairs) with an earlier `Player` row than
    the tournament this was resolved for."""

    experienced_user_ids: frozenset[int]
    experienced_user_roles: frozenset[tuple[int, HeroClass | None]]

    def is_newcomer(self, user_id: int) -> bool:
        return user_id not in self.experienced_user_ids

    def is_newcomer_role(self, user_id: int, role: HeroClass | None) -> bool:
        return (user_id, role) not in self.experienced_user_roles


async def load_prior_participation(
    session: AsyncSession,
    *,
    tournament: Tournament,
    user_ids: Collection[int],
) -> PriorParticipation:
    """Batch-resolve prior participation for `user_ids` relative to `tournament`.

    Reads `tournament.workspace_id`'s `newcomer_scope` directly (not via the
    `tournament.workspace` relationship, which may not be loaded in an async
    context) to decide whether other workspaces' tournaments count.
    """
    if not user_ids:
        return PriorParticipation(frozenset(), frozenset())

    scope_row = await session.execute(
        sa.select(Workspace.newcomer_scope).where(Workspace.id == tournament.workspace_id)
    )
    scope: NewcomerScope = scope_row.scalar_one_or_none() or "global"

    cur_start = tournament.start_date or _FAR_FUTURE
    query = (
        sa.select(WorkspaceMember.player_id, Player.role)
        .select_from(Player)
        .join(WorkspaceMember, WorkspaceMember.id == Player.workspace_member_id)
        .join(Tournament, Tournament.id == Player.tournament_id)
        .where(
            WorkspaceMember.player_id.in_(user_ids),
            sa.tuple_(sa.func.coalesce(Tournament.start_date, _FAR_FUTURE), Tournament.id)
            < (cur_start, tournament.id),
        )
    )
    if scope == "workspace":
        query = query.where(Tournament.workspace_id == tournament.workspace_id)

    rows = (await session.execute(query)).all()
    experienced_user_ids = frozenset(user_id for user_id, _ in rows)
    experienced_user_roles = frozenset((user_id, role) for user_id, role in rows)
    return PriorParticipation(experienced_user_ids, experienced_user_roles)
```

Add to `shared/services/__init__.py` if that package re-exports members (check; `division_grid_resolution` is imported directly by dotted path elsewhere, e.g. `from shared.services.division_grid.resolution import resolve_tournament_division` — match that pattern, no `__init__.py` re-export needed).

---

## Phase 3 — Consumers

### Task 4: `balancer-service/src/services/team.py`

Replace lines 97-118 (the `players_in_tournament`/`players_global`/`players_by_role` block through the batch query) — **keep** `players_in_tournament` (still needed for "already in this tournament" dedup, an unrelated concern) but replace the `players_global`/`players_by_role` computation with:

```python
history = await load_prior_participation(session, tournament=tournament, user_ids=resolved_user_ids)
```

placed after `tournament` is loaded (it already is, at the top of `bulk_create_from_balancer`). Then in the per-member loop, replace:
```python
is_newcomer = user.id not in players_global
is_newcomer_role = (user.id, role) not in players_by_role
```
with:
```python
is_newcomer = history.is_newcomer(user.id)
is_newcomer_role = history.is_newcomer_role(user.id, role)
```

Import: `from shared.services.newcomer_status import load_prior_participation`.

`players_in_tournament` is still built from the same batch query at lines 103-118 (keep that query, just stop also deriving `players_global`/`players_by_role` from it).

### Task 5: `parser-service/src/services/team/flows.py`

Same shape: `bulk_create_from_balancer` currently builds `experienced_user_ids`/`experienced_user_roles` at lines 317-332 via its own `history_rows` query. Replace that block with a single `history = await load_prior_participation(session, tournament=tournament, user_ids=resolved_user_ids)` call, and replace the per-member:
```python
is_newcomer = user.id not in experienced_user_ids
is_newcomer_role = (user.id, role) not in experienced_user_roles
```
with `history.is_newcomer(user.id)` / `history.is_newcomer_role(user.id, role)`.

`tournament_user_ids` (the separate "already in this exact tournament" set, lines 301-315) is untouched — different concern (dedup, not newcomer status).

### Task 6: `parser-service/src/services/match_logs/flows.py::add_substitution`

**Keep** `existing_player_profile_for_user`/`player_data_source` (still needed for `sub_role`/`rank` fallback). Replace only:
```python
is_newcomer=player_data_source.is_newcomer
if player_data_source
else not bool(await team_service.get_player_by_user(session, sub_user.id, [])),
is_newcomer_role=player_data_source.is_newcomer_role if player_data_source else True,
```
with:
```python
history = await load_prior_participation(session, tournament=self.tournament, user_ids=[sub_user.id])
...
is_newcomer=history.is_newcomer(sub_user.id),
is_newcomer_role=history.is_newcomer_role(sub_user.id, player_to_be_replaced.role),
```
(compute `history` once, above the `create_player` call; role is `player_to_be_replaced.role`, the same role already used elsewhere in this method for the new player's own `role=` field).

---

## Phase 4 — Migration

### Task 7: `ncscope01_add_workspace_newcomer_scope.py`

**File:** `backend/migrations/versions/ncscope01_add_workspace_newcomer_scope.py`, `down_revision = "matchsrc01"`.

```python
"""Add workspace.newcomer_scope and backfill Player.is_newcomer/is_newcomer_role chronologically.

Revision ID: ncscope01
Revises: matchsrc01
Create Date: 2026-08-18 00:00:00.000000

`Player.is_newcomer`/`is_newcomer_role` were frozen at row-insert time by checking
"does this identity already have a Player row right now" -- order of *import*, not
order of *play*. Backfilling an older tournament after a newer one is already
imported freezes the newer rows wrong forever. This migration adds the new
per-workspace `newcomer_scope` setting (default 'global', matching today's
accidental platform-wide behavior) and recomputes every existing row using
`Tournament.start_date NULLS LAST, Tournament.id` chronological order -- the same
convention `division.py`/`streak.py`/`tournament/service.py` already use -- scoped
per each row's own workspace setting.

Not reversible: a corrected row carries no marker distinguishing it from one that
was always right (same reasoning as matchsrc01).
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "ncscope01"
down_revision: str | Sequence[str] | None = "matchsrc01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "workspace",
        sa.Column("newcomer_scope", sa.String(16), nullable=False, server_default="global"),
    )
    op.execute(
        sa.text(
            """
            WITH ranked AS (
                SELECT
                    p.id AS player_id,
                    ROW_NUMBER() OVER (
                        PARTITION BY wm.player_id,
                                     CASE WHEN w.newcomer_scope = 'workspace' THEN t.workspace_id END
                        ORDER BY COALESCE(t.start_date, 'infinity'::timestamptz), t.id
                    ) AS overall_rank,
                    ROW_NUMBER() OVER (
                        PARTITION BY wm.player_id, p.role,
                                     CASE WHEN w.newcomer_scope = 'workspace' THEN t.workspace_id END
                        ORDER BY COALESCE(t.start_date, 'infinity'::timestamptz), t.id
                    ) AS role_rank
                FROM tournament.player p
                JOIN workspace_member wm ON wm.id = p.workspace_member_id
                JOIN tournament.tournament t ON t.id = p.tournament_id
                JOIN workspace w ON w.id = t.workspace_id
            )
            UPDATE tournament.player p
            SET is_newcomer = (ranked.overall_rank = 1),
                is_newcomer_role = (ranked.role_rank = 1)
            FROM ranked
            WHERE ranked.player_id = p.id
            """
        )
    )


def downgrade() -> None:
    # Not reversible -- see module docstring.
    op.drop_column("workspace", "newcomer_scope")
```

Verify offline: `cd backend && POSTGRES_USER=x POSTGRES_PASSWORD=x POSTGRES_DB=x POSTGRES_HOST=x POSTGRES_PORT=5432 REDIS_URL=redis://x:6379 RABBITMQ_URL=amqp://x JWT_SECRET_KEY=x SECRET_KEY=x uv run alembic upgrade matchsrc01:ncscope01 --sql` (no live DB needed).

---

## Phase 5 — Frontend

### Task 8: `frontend/src/types/workspace.types.ts`

Add `newcomer_scope: "global" | "workspace";` to `Workspace` after `default_division_grid_version`.

### Task 9: `frontend/src/app/admin/workspaces/[id]/page.tsx`

- `EditFormData`: add `newcomer_scope: "global" | "workspace";`.
- `formFromWorkspace`: `newcomer_scope: ws.newcomer_scope ?? "global",`.
- Submit payload: include `newcomer_scope: form.newcomer_scope`.
- Render a `<Select>` (existing import already in this file) with two options ("Платформа целиком" / "Только это рабочее пространство" or the existing i18n convention for this page — check for an `en.json`/`ru.json` pair backing this page's other labels and add matching keys), with a one-line explainer that flipping to workspace-scoped makes existing veterans look like newcomers the first time they join this workspace.

---

## Phase 6 — Tests

### Task 10: `shared/tests/test_newcomer_status.py` (new)

Cover, per Decision Log risk #2:
- Global scope: identity with an earlier-`start_date` tournament in a *different* workspace → not a newcomer.
- Workspace scope: same fixture → *is* a newcomer (the other tournament is out of scope).
- NULL `start_date` sentinel: a tournament with `start_date=None` created (`Tournament.id`) after one with a real date is NOT earlier; a `start_date=None` tournament created *before* one with a real date IS earlier when its `id` sorts first (matches `id` tie-break, exercises the sentinel both directions).
- Role scope: `is_newcomer=False` (played before, different role) but `is_newcomer_role=True` (never played this role).
- Substitution rows count as experience (A2).

### Task 11: Fix existing tests

- `backend/balancer-service/tests/test_team_workspace_member.py` — already asserts `is_newcomer`/`is_newcomer_role` on a freshly-bulk-created player with no prior history; should still pass unchanged (empty history ⇒ both `True`), but the underlying query now goes through `load_prior_participation` — run it to confirm no fixture/session mocking assumption broke.
- Any test mocking/asserting the internal `players_global`/`players_by_role`/`experienced_user_ids` variable names directly (grep for them) needs updating to the new call shape.

### Task 12: Run affected suites

```
cd backend && uv run --package shared pytest shared/tests/test_newcomer_status.py -v
cd backend && uv run --package balancer-service pytest tests/test_team_workspace_member.py tests/test_balance_exported_event.py -v
cd backend && uv run --package parser-service pytest tests/test_scrim_achievement_isolation.py tests/test_hidden_tournament_exclusion.py -v
cd backend && uv run --package analytics-service pytest tests/test_analytics_flows.py tests/test_hidden_tournament_exclusion.py -v
cd backend && uv run --package app-service pytest tests/test_user_profile_flows.py -v
cd backend && uv run ruff check shared/services/newcomer_status.py balancer-service/src/services/team.py parser-service/src/services/team/flows.py parser-service/src/services/match_logs/flows.py shared/models/tenancy/workspace.py app-service/src/schemas/workspace.py --fix
cd backend && uv run ruff format shared/services/newcomer_status.py balancer-service/src/services/team.py parser-service/src/services/team/flows.py parser-service/src/services/match_logs/flows.py shared/models/tenancy/workspace.py app-service/src/schemas/workspace.py
```
