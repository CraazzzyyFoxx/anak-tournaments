# Dynamic `is_newcomer` / `is_newcomer_role` Computation — Design

**Status:** accepted (2026-08-18)
**Plan:** `docs/superpowers/plans/2026-08-18-dynamic-newcomer-fields.md`

---

## 1. Understanding Summary

- **What:** `tournament.player.is_newcomer` / `is_newcomer_role` are frozen booleans written once at `Player`-row INSERT time by 3 independent call sites. They are recomputed to be chronologically correct (based on tournament order, not insertion order), consolidated into one shared function, and gain a workspace-configurable scope (platform-wide vs this-workspace-only).
- **Why:** the write-time formula in all 3 places checks "does this identity already have a `Player` row *right now*" — order of *import*, not order of *play*. Backfilling an older tournament after a newer one is already imported permanently freezes the newer rows' flags wrong. Additionally, none of the 3 sites filter by workspace at all, so "newcomer" has always silently meant "platform-wide", with no way for an organizer to ask "new to *my* workspace".
- **Who:** workspace admins (new setting), and every consumer of the flag: analytics rating engine (`PlackettLuce` sigma), ML feature extraction (`shift_features.py`, `role_kpis.py`, `extractors.py`), the achievement engine (`is_newcomer` / `tournament_count` conditions), and the public player profile/team read models.
- **Constraints:** analytics-service reads `is_newcomer`/`is_newcomer_role` as plain columns across large row sets in rating/ML hot paths (`get_player_rating`, feature extraction over full tournament history) — these must stay cheap column reads, not per-row correlated subqueries.
- **Non-goals (this iteration):** touching how the achievement engine *reads* the flag (already workspace-scoped by tournament, orthogonal to this change); retroactively re-running ratings/ML features/achievement grants after the backfill recomputes the flag itself; per-tournament override of the scope (workspace-level only).

## 2. Current State (verified)

Three independent write sites, all subtly different but sharing the same bug (order-of-import, not order-of-play):

| Site | File | Scope today |
| --- | --- | --- |
| Balancer export → tournament roster | `balancer-service/src/services/team.py::bulk_create_from_balancer` (`players_global`/`players_by_role`, lines 97-118) | No workspace filter — accidentally platform-wide |
| Balancer export → tournament roster (parser-service's own copy) | `parser-service/src/services/team/flows.py::bulk_create_from_balancer` (`experienced_user_ids`/`experienced_user_roles`, lines 317-332) | No workspace filter — accidentally platform-wide |
| Substitution | `parser-service/src/services/match_logs/flows.py::add_substitution` (lines 1071-1096) | Inherits the frozen flag from the most-recent same-role `Player` row (by `tournament_id`, not chronology), or falls back to "no `Player` row exists at all" |

All three read `models.Player`/`models.WorkspaceMember`/`models.Tournament` joined the same way (`WorkspaceMember.id == Player.workspace_member_id`, `WorkspaceMember.player_id` holding the underlying user id).

**Read side is already correct and untouched by this change**: the achievement engine's `is_newcomer`/`tournament_count`/`consecutive` conditions filter `Tournament.workspace_id == context.workspace_id` on top of the stored flag — that is a *"which tournaments to search"* filter, orthogonal to *"how the flag was computed"*. `division.py`/`streak.py`/`tournament/service.py::get_*` already establish the codebase's chronological-ordering convention: `ORDER BY Tournament.start_date NULLS LAST, Tournament.id`.

## 3. Assumptions

| # | Assumption | Confirmed |
| --- | --- | --- |
| A1 | Bootstrap default for the new `Workspace.newcomer_scope` setting is `"global"` — zero behavior change for existing workspaces on deploy day; admin can flip it any time via the existing generic workspace-settings PATCH. | yes — explicit |
| A2 | `is_substitution` rows still count as "prior experience" toward future newcomer checks — unchanged from today's implicit behavior (none of the 3 sites filter it out when building the experience set). | yes — explicit, kept out of scope |
| A3 | Ties in chronological ordering break on `Tournament.id` (matches `division.py`/`streak.py`/`tournament/service.py`). | yes — established convention |
| A4 | The historical backfill recomputes only `Player.is_newcomer`/`is_newcomer_role`. Already-computed `PlackettLuce` ratings, ML training snapshots, and already-granted achievements are **not** retroactively recomputed by this migration. | yes — explicit, accepted risk |

## 4. Design

### 4.1 Data — one new Workspace column

```python
# shared/models/tenancy/workspace.py
newcomer_scope: Mapped[str] = mapped_column(String(16), server_default="global", nullable=False)
```

Plain `String`, not a Postgres enum — same "stay flexible" precedent as `Tournament.team_formation`. Values: `"global"` (any workspace counts as prior experience) or `"workspace"` (only tournaments in *this* workspace count). Exposed on `WorkspaceRead`/`WorkspaceUpdate` (`app-service/src/schemas/workspace.py`) exactly like `branding_enabled` — the generic `rpc.app.admin.update#workspace` CRUD engine (`EntityConfig(model=models.Workspace, update_schema=schemas.WorkspaceUpdate)`, reflection-based `model_validate`/`setattr`) needs no other wiring.

### 4.2 One shared computation — `shared/services/newcomer_status.py`

```python
NewcomerScope = Literal["global", "workspace"]

@dataclass(frozen=True)
class PriorParticipation:
    experienced_user_ids: frozenset[int]
    experienced_user_roles: frozenset[tuple[int, HeroClass | None]]

    def is_newcomer(self, user_id: int) -> bool: ...
    def is_newcomer_role(self, user_id: int, role: HeroClass | None) -> bool: ...

async def load_prior_participation(
    session: AsyncSession, *, tournament: Tournament, user_ids: Collection[int],
) -> PriorParticipation: ...
```

`load_prior_participation`:
1. Reads `Workspace.newcomer_scope` for `tournament.workspace_id` directly (not via `tournament.workspace` — avoids a lazy-load footgun on a relationship that may not be eagerly loaded at the call site).
2. Runs **one** query: `Player` ⋈ `WorkspaceMember` ⋈ `Tournament`, `WorkspaceMember.player_id IN (user_ids)`, plus `Tournament.workspace_id == tournament.workspace_id` only when scope is `"workspace"`.
3. Chronological filter: `(COALESCE(Tournament.start_date, SENTINEL), Tournament.id) < (COALESCE(tournament.start_date, SENTINEL), tournament.id)` — a plain `sa.tuple_(...)` comparison. `SENTINEL = datetime(9999, 12, 31, 23, 59, 59, 999999, tzinfo=UTC)` stands in for "no date" the same way `NULLS LAST` does for `ORDER BY`, but a `<` comparison needs an actual value on both sides — Postgres NULL breaks tuple comparison outright, it does not participate in it the way `ORDER BY ... NULLS LAST` does.
4. Groups results into `experienced_user_ids` / `experienced_user_roles` sets — this is a straight rename+correctness-fix of the `players_global`/`players_by_role`/`experienced_user_ids` sets each of the 3 call sites already builds by hand.

One query per call, batched over however many candidates are pending — same shape as today, not per-candidate.

### 4.3 Consumers — minimal diff, same call shape

- `balancer-service/services/team.py::bulk_create_from_balancer`: replace the hand-rolled `players_global`/`players_by_role` block (lines 97-118) with `history = await load_prior_participation(session, tournament=tournament, user_ids=resolved_user_ids)`; replace `is_newcomer = user.id not in players_global` / `is_newcomer_role = (user.id, role) not in players_by_role` with `history.is_newcomer(user.id)` / `history.is_newcomer_role(user.id, role)`.
- `parser-service/services/team/flows.py::bulk_create_from_balancer`: same replacement for `experienced_user_ids`/`experienced_user_roles`.
- `parser-service/services/match_logs/flows.py::add_substitution`: **keeps** the existing `get_player_by_user_and_role` lookup (`player_data_source`) — still needed for `sub_role`/`rank` fallback — but replaces only the `is_newcomer=`/`is_newcomer_role=` argument expressions with a `load_prior_participation(session, tournament=self.tournament, user_ids=[sub_user.id])` call. Drops the "inherit the frozen flag from `player_data_source`" special case, which was itself a second, more subtly wrong version of the same bug (it also ignored chronology, picking the row with the highest `tournament_id` rather than the latest `start_date`).

### 4.4 Backfill migration

New Alembic revision chained after `matchsrc01` (`ncscope01_add_workspace_newcomer_scope.py`), not reversible (same reasoning as `matchsrc01`: a corrected row carries no marker distinguishing it from one that was always right).

1. `op.add_column("workspace", sa.Column("newcomer_scope", sa.String(16), nullable=False, server_default="global"))` — small, low-traffic table, no lock-retry ceremony needed (that machinery in `streamvis01` exists specifically for a hot table under sustained transaction pressure).
2. One `UPDATE ... FROM (window-function CTE)` over `tournament.player`, joined through `workspace_member` and `tournament.tournament` to `workspace` so each row is recomputed **per its own workspace's `newcomer_scope`** in a single pass:

```sql
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
SET is_newcomer = (ranked.overall_rank = 1), is_newcomer_role = (ranked.role_rank = 1)
FROM ranked WHERE ranked.player_id = p.id;
```

`p.role IS NULL` partitions correctly (SQL groups NULLs together in `PARTITION BY`, matching Python's `(user_id, None)` set-key equality). Since every workspace's own `newcomer_scope` value (`'global'` for all of them at migration time, per A1) feeds the same statement, the backfill's *effective* behavior on deploy day is "recompute with the current per-workspace setting", not "assume global for everyone" — correct even if a future migration runs after an admin has already changed some workspace's scope.

### 4.5 Frontend

- `frontend/src/types/workspace.types.ts`: add `newcomer_scope: "global" | "workspace";` to `Workspace`.
- `frontend/src/app/admin/workspaces/[id]/page.tsx`: add to `EditFormData`/`formFromWorkspace`/submit payload, rendered as a `<Select>` (not a `Switch` — not boolean) next to the other workspace-scoped settings, with a one-line explainer of the effect (a veteran of workspace A shows as a newcomer the first time they join workspace B, when scope is `"workspace"`).

## 5. Decision Log

| Decision | Alternatives | Why |
| --- | --- | --- |
| Persisted columns, corrected write-time formula | `column_property` correlated subquery (fully dynamic, like `Team.avg_sr`) | Analytics/ML hot paths (`get_player_rating`, `shift_features.py`, `role_kpis.py`, `extractors.py`) select `is_newcomer`/`is_newcomer_role` across large historical row sets; a subquery per row would regress those. |
| Bootstrap default `"global"` | default `"workspace"` | No surprise behavior change for existing workspaces on deploy; admin opts in explicitly. |
| Backfill via one raw-SQL window-function `UPDATE`, same migration | Python script backfill | Matches `matchsrc01` precedent exactly: one statement, scope-aware per row's own workspace, no N+1 round trips. |
| Consolidate 3 call sites into `shared/services/newcomer_status.py` | leave duplicated | The current drift (both balancer-service and parser-service independently missing a workspace filter) is exactly the class of bug one shared implementation prevents from recurring. |
| Ordering key `(COALESCE(start_date, sentinel), id)` | `created_at`/insertion order | Matches `division.py`/`streak.py`/`tournament/service.py` exactly — the codebase's one established "chronological tournament order" convention. |
| `is_substitution` rows still count as experience | exclude them from the "has played" check | Preserves existing implicit behavior; changing it is a different, unrequested behavior change. |
| Scope resolved by querying `Workspace.newcomer_scope` directly (not via `tournament.workspace` relationship) | eager-load `tournament.workspace` at every call site | Avoids a lazy-load-in-async-context footgun; keeps the shared function self-contained and independently testable. |

## 6. Risks

- **Backfill changes historical flags already consumed** by `PlackettLuce` rating sigma, ML training feature snapshots, and past achievement grants — none of those are retroactively recomputed by this migration. Accepted (A4).
- **NULL `start_date` handling**: Postgres tuple comparison breaks outright the moment either side is NULL (unlike `ORDER BY ... NULLS LAST`) — the sentinel-coalesce is load-bearing and needs an explicit test (mixed tournaments with and without `start_date` compared against each other).
- **Scope semantics surprise**: `newcomer_scope = "workspace"` makes a platform veteran look like a newcomer the first time they join a new workspace — intentional per the opt-in design, called out in the settings UI copy.

## 7. Exit Criteria

Understanding Lock confirmed; approach accepted (persisted columns + shared write-time function + admin-configurable scope + immediate backfill); assumptions A1-A4 confirmed; risks recorded; Decision Log complete.
