# Player Search (Mobile) + Search History + Favorite Players — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: use `superpowers:executing-plans` to implement this plan task-by-task.

**Design:** `docs/superpowers/specs/2026-08-17-player-search-history-favorites-design.md` — read it first; this plan does not repeat the reasoning.

**Goal:** restore player search on the mobile header (currently fully hidden), add a client-side "recent searches" list shared by mobile and desktop, and add account-scoped favorite players (star toggle on profile + search results, full list in account settings).

**Architecture:** a shared `usePlayerSearch()` hook consumed by the existing desktop popover (`UserSearch.tsx`) and a new full-screen mobile sheet (`MobilePlayerSearchSheet.tsx`); `useLocalStorageState`-backed recent-search history; a new `FavoritePlayer` join table (`players` schema) exposed under `/api/v1/me/favorite-players`, consumed through one `useFavoritePlayers()` react-query hook and one `FavoriteStarButton` component reused in three places.

**Tech stack:** Next.js (App Router) + React Query + next-intl + Radix (Sheet/Popover/Command) on the frontend; FastAPI-less typed RPC over RabbitMQ (FastStream) in app-service, fronted by the Go gateway's declarative route tables; SQLAlchemy 2 + Alembic (one shared migration history).

---

## House Rules (apply to every task)

- **Prefix git/test/build commands with `rtk`.** Even inside `&&` chains.
- **Edit files with the Edit/Write tools only.**
- **Backend tests:** `cd backend && rtk uv run --package app-service pytest <path> -v`.
- **There is NO `pytest-asyncio`.** A bare `async def test_…` in a plain class is collected and never awaited. Async tests MUST subclass `unittest.IsolatedAsyncioTestCase`.
- **After Python edits:** `cd backend && rtk uv run ruff check <paths> --fix && rtk uv run ruff format <paths>`.
- **Frontend:** `cd frontend && rtk npx vitest run <path>`, `rtk npx tsc --noEmit`. Per `AGENTS.md`: do **not** run `next build` for testing — `next lint` is enough.
- **i18n:** `frontend/src/i18n/messages/en.json` **and** `ru.json` change in the same task.
- **Never hardcode `down_revision`.** `cd backend && rtk uv run alembic heads` is authoritative.
- **Never run a bare `alembic upgrade head` from a dev shell.** Verify with `alembic upgrade <rev> --sql` first.
- **Conventional commits, no attribution.** Stage exact paths, never `-u` / `-A`.
- **OpenAPI manifest is generated, not hand-edited.** After changing `src/openapi_schemas.py`/`openapi_docs.py`, run `bash backend/scripts/export_openapi_schemas.sh` and commit the resulting `gateway/internal/openapi/schemas.json` diff.

---

## Phase 0 — Mobile player search (frontend-only, independently shippable)

### Task 0.1: Extract shared search behavior into `usePlayerSearch()`

**Files:**
- Create: `frontend/src/hooks/usePlayerSearch.ts`
- Modify: `frontend/src/components/UserSearch.tsx`

**Step 1 — Extract the hook**

Move every piece of state/effect/handler out of `UserSearch.tsx` that is not JSX-specific: `searchValue`/`debouncedSearchValue`, `isOpen`, `isSearching`, `searchData`, `activeIndex`, the search `useEffect` (abort-controller fetch via `userService.searchUsers`), `handleSelect`/`handleClear`/`handleChange`/`handleKeyDown`, and the render-time state-sync blocks (`canSearch`/`canShowResults`/`prevQuery`/`targetActiveIndex`). Signature:

```ts
export function usePlayerSearch(onNavigate?: (user: MinimizedUser) => void) {
  // ...same internals as today's UserSearch, minus JSX...
  return {
    searchValue, isOpen, setIsOpen, isSearching, searchData, activeIndex,
    canShowResults, emptyMessage, handleSelect, handleClear, handleChange, handleKeyDown,
    setActiveIndex, itemRefs,
  };
}
```

`handleSelect` keeps its default behavior (`push(getPlayerSlug(...))`) but accepts the optional `onNavigate` so a consumer (e.g. the mobile sheet, which must also close itself) can hook the moment of selection without re-implementing it. Recording history (Task 1.1) attaches inside this hook's `handleSelect`, once, so both surfaces get it for free.

**Step 2 — `UserSearch.tsx` becomes a thin view**

Replace the extracted logic with a call to `usePlayerSearch()`; keep every existing className/JSX/aria attribute unchanged so there is no visual/behavioral diff on desktop. Confirm no unused imports remain (`ruff`/`tsc` equivalent is `tsc --noEmit`).

**Step 3 — Verify no behavior change**

```bash
cd frontend && rtk npx tsc --noEmit && rtk npx vitest run src/components/UserSearch
```
(If no existing test file covers `UserSearch`, this step is a compile-only check; do not add a test here — Task 0.2/1.1 add behavior tests once the mobile surface exists to assert against.)

**Step 4 — Commit**

```bash
rtk git add frontend/src/hooks/usePlayerSearch.ts frontend/src/components/UserSearch.tsx
rtk git commit -m "refactor(search): extract usePlayerSearch hook from UserSearch"
```

---

### Task 0.2: Mobile full-screen search sheet + header trigger

**Files:**
- Create: `frontend/src/components/MobilePlayerSearchSheet.tsx`
- Modify: `frontend/src/components/Header.tsx`
- Modify: `frontend/src/i18n/messages/en.json`, `frontend/src/i18n/messages/ru.json`

**Step 1 — Build the sheet**

`MobilePlayerSearchSheet` renders a `Sheet`/`SheetTrigger`/`SheetContent` (same primitives as the existing mobile-nav sheet in `Header.tsx`) with `side="top"` and a height that covers the visible viewport (e.g. `h-[100dvh]`, matching the pattern in `AccountSettingsModal.tsx`'s `DialogContent`). Trigger: an icon-only `Button variant="outline" size="icon"` with a `Search` icon, `md:hidden`, `aria-label={t("nav.search.mobileTrigger")}`.

Inside the sheet: a full-width `Input` (reuse the same debounced value/handlers from `usePlayerSearch()`, no `Popover`/`PopoverAnchor` — just a plain scrollable results list below the input, since the sheet itself is already the "popover"). Reuse `Command`/`CommandList`/`CommandEmpty`/`CommandGroup`/`CommandItem` exactly as `UserSearch.tsx` does for consistent keyboard/ARIA behavior. On select, close the sheet (`setSheetOpen(false)`) via the `onNavigate` hook from Task 0.1 before/after `push`.

**Step 2 — Mount in the header**

In `Header.tsx`, add the trigger button next to the existing hamburger `SheetTrigger` inside the row at `Header.tsx:90-96` (its own independent `Sheet`, not nested inside the nav one). Do **not** touch the existing `<div className="hidden ... md:block"><UserSearch /></div>` block — desktop is unaffected.

**Step 3 — i18n**

Add to both `en.json` and `ru.json`, in the existing `nav.search` block (`en.json:3559-3566`):
```json
"mobileTrigger": "Search players",
"close": "Close search"
```
(Russian equivalents in `ru.json`'s matching `nav.search` block.)

**Step 4 — Verify**

Manual smoke test (no `next build` per `AGENTS.md`): `cd frontend && rtk npx tsc --noEmit`, then run the dev server and confirm at a `<768px` viewport: the search icon appears, opens a full-screen sheet, typing ≥2 chars returns results, selecting one navigates to `/users/<slug>` and closes the sheet. Confirm the header row does not overflow/wrap at 320px width (the original bug).

**Step 5 — Commit**

```bash
rtk git add frontend/src/components/MobilePlayerSearchSheet.tsx frontend/src/components/Header.tsx frontend/src/i18n/messages/en.json frontend/src/i18n/messages/ru.json
rtk git commit -m "feat(search): restore player search on mobile via full-screen sheet"
```

---

## Phase 1 — Search history (client-only)

### Task 1.1: Record + render recent searches

**Files:**
- Modify: `frontend/src/hooks/usePlayerSearch.ts`
- Modify: `frontend/src/components/UserSearch.tsx`
- Modify: `frontend/src/components/MobilePlayerSearchSheet.tsx`
- Modify: `frontend/src/i18n/messages/en.json`, `frontend/src/i18n/messages/ru.json`
- Create: `frontend/src/components/UserSearch.behavior.test.tsx` (or extend if one already exists — check first)

**Step 1 — History state**

Inside `usePlayerSearch()`: `const [history, setHistory] = useLocalStorageState<RecentPlayer[]>("player-search-history", [])` where `RecentPlayer = Pick<MinimizedUser, "id" | "name">`. On `handleSelect`, push `{id, name}` to the front, dedupe by `id`, cap at 8:
```ts
setHistory((prev) => [{ id: user.id, name: user.name }, ...prev.filter((p) => p.id !== user.id)].slice(0, 8));
```
Expose `history`, `removeFromHistory(id)`, `clearHistory()` from the hook.

**Step 2 — Render**

In both `UserSearch.tsx` and `MobilePlayerSearchSheet.tsx`: when `searchValue` is empty AND `history.length > 0`, render a `CommandGroup heading={t("nav.search.recent")}` above (or instead of, when the popover/sheet has just opened with no query) the results `CommandGroup`, each row selectable (same `handleSelect` path) plus a small ✕ button (`stopPropagation` on click so it doesn't trigger `onSelect`) calling `removeFromHistory(id)`, and a trailing "Clear all" `CommandItem` calling `clearHistory()`.

**Step 3 — i18n**

Add to `nav.search` in both locale files: `"recent": "Recent"`, `"clearHistory": "Clear history"`, `"removeFromHistory": "Remove from history"`.

**Step 4 — Test**

A behavior test (React Testing Library, matching the project's existing `*.behavior.test.tsx` convention — check `MyAccountSection.behavior.test.tsx` for the harness pattern) asserting: selecting a result adds it to history; history renders when the input is empty; selecting the same player twice does not duplicate; "Clear all" empties it. Mock `userService.searchUsers` and `next/navigation`'s `useRouter`.

**Step 5 — Verify + commit**

```bash
cd frontend && rtk npx tsc --noEmit && rtk npx vitest run src/components/UserSearch.behavior.test.tsx
rtk git add frontend/src/hooks/usePlayerSearch.ts frontend/src/components/UserSearch.tsx frontend/src/components/MobilePlayerSearchSheet.tsx frontend/src/components/UserSearch.behavior.test.tsx frontend/src/i18n/messages/en.json frontend/src/i18n/messages/ru.json
rtk git commit -m "feat(search): add local recent-search history to player search"
```

---

## Phase 2 — Favorite players (account-scoped, full stack)

### Task 2.0: Confirm the migration head

```bash
cd backend && rtk uv run alembic heads
```
Record the output — it is the `down_revision` for Task 2.1's migration. Do not guess it from a file scan.

### Task 2.1: `FavoritePlayer` model + migration

**Files:**
- Create: `backend/shared/models/preferences/favorite_player.py`
- Modify: `backend/shared/models/preferences/__init__.py`
- Create: `backend/migrations/versions/favplyr01_add_favorite_player.py`

**Step 1 — Model**

```python
from sqlalchemy import ForeignKey, Index, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from shared.core import db
from shared.models.identity.auth_user import AuthUser
from shared.models.identity.user import User

__all__ = ("FavoritePlayer",)


class FavoritePlayer(db.TimeStampIntegerMixin):
    """A visitor's own bookmark on another (or their own) player. Auth-account
    scoped, not player-scoped — the caller's `auth.user` id owns the row, so it
    survives a player being re-linked/merged and requires no player of the
    caller's own to exist."""

    __tablename__ = "favorite_player"
    __table_args__ = (
        UniqueConstraint("auth_user_id", "player_id", name="uq_favorite_player_auth_user_player"),
        Index("ix_favorite_player_auth_user", "auth_user_id"),
        {"schema": "players"},
    )

    auth_user_id: Mapped[int] = mapped_column(ForeignKey(AuthUser.id, ondelete="CASCADE"), index=True)
    player_id: Mapped[int] = mapped_column(ForeignKey(User.id, ondelete="CASCADE"), index=True)

    auth_user: Mapped[AuthUser] = relationship()
    player: Mapped[User] = relationship()
```

Add `from .favorite_player import *` to `backend/shared/models/preferences/__init__.py`.

**Step 2 — Migration**

Generate/hand-write following the `owemerald01`/`wsguild0001` header convention: `revision = "favplyr01"`, `down_revision = "<from Task 2.0>"`. `upgrade()` creates the table (`op.create_table` with the two FKs, unique constraint, index, `created_at`/`updated_at` per `TimeStampIntegerMixin` — check that mixin's columns before writing the raw DDL). `downgrade()` drops it.

**Step 3 — Verify**

```bash
cd backend && rtk uv run --package shared python -c "from shared import models; print(models.FavoritePlayer.__table__.schema, models.FavoritePlayer.__table__.name)"
cd backend && rtk uv run alembic upgrade favplyr01 --sql   # inspect, do not apply against a real DB from a dev shell
```

**Step 4 — Commit**

```bash
rtk git add backend/shared/models/preferences/favorite_player.py backend/shared/models/preferences/__init__.py backend/migrations/versions/favplyr01_add_favorite_player.py
rtk git commit -m "feat(favorites): add favorite_player table"
```

---

### Task 2.2: RPC handlers (app-service)

**Files:**
- Modify: `backend/app-service/src/rpc/users_admin.py`
- Modify: `backend/app-service/src/schemas` (wherever `MinimizedUser`/equivalent read schema lives — check `src/schemas/__init__.py` and existing `UserRead`/list schemas before adding a new one)
- Create: `backend/app-service/tests/test_me_favorite_players.py`

**Step 1 — Handlers**

Append to the self-service section of `users_admin.py` (near `_me_social_list`, reusing `_account_gate`; no `_resolve_my_player_id` needed here — favorites are keyed by `auth_user_id`, not by the caller's own linked player):

```python
@broker.subscriber("rpc.app.users.me_favorites_list")
async def _me_favorites_list(data: dict, msg: RabbitMessage) -> dict:
    async def op(session: Any) -> Any:
        user = _account_gate(data)
        rows = await session.execute(
            sa.select(models.User.id, models.User.name)
            .join(models.FavoritePlayer, models.FavoritePlayer.player_id == models.User.id)
            .where(models.FavoritePlayer.auth_user_id == user.id)
            .order_by(models.FavoritePlayer.created_at.desc())
        )
        return [schemas.MinimizedUserRead(id=r.id, name=r.name) for r in rows]

    return await c.envelope(logger, "users.me_favorites_list", op, session_factory=_SF)


@broker.subscriber("rpc.app.users.me_favorite_add")
async def _me_favorite_add(data: dict, msg: RabbitMessage) -> dict:
    async def op(session: Any) -> Any:
        user = _account_gate(data)
        player_id = c.require_id(data)
        exists = await session.scalar(sa.select(models.User.id).where(models.User.id == player_id))
        if exists is None:
            raise HTTPException(status_code=404, detail="Player not found")
        already = await session.scalar(
            sa.select(models.FavoritePlayer.id).where(
                models.FavoritePlayer.auth_user_id == user.id, models.FavoritePlayer.player_id == player_id
            )
        )
        if already is None:
            session.add(models.FavoritePlayer(auth_user_id=user.id, player_id=player_id))
            await session.commit()
        return {"ok": True}

    return await c.envelope(logger, "users.me_favorite_add", op, session_factory=_SF)


@broker.subscriber("rpc.app.users.me_favorite_remove")
async def _me_favorite_remove(data: dict, msg: RabbitMessage) -> dict:
    async def op(session: Any) -> Any:
        user = _account_gate(data)
        player_id = c.require_id(data)
        row = await session.scalar(
            sa.select(models.FavoritePlayer).where(
                models.FavoritePlayer.auth_user_id == user.id, models.FavoritePlayer.player_id == player_id
            )
        )
        if row is not None:
            await session.delete(row)
            await session.commit()

    return await c.envelope(logger, "users.me_favorite_remove", op, session_factory=_SF)
```

Confirm `c.require_id` reads the gateway's `IDParam`-injected `data["id"]` (it does — see its use in `_social_set_primary`/`_me_social_set_primary` for `user_id`, same mechanism). If no `MinimizedUserRead` schema exists yet, add a minimal `{id: int, name: str}` Pydantic model next to `schemas.UserRead` rather than reusing the heavier full read model.

**Step 2 — Test**

Follow the harness in `test_me_stream_visibility.py` (fake session pattern) — `unittest.IsolatedAsyncioTestCase` per house rules. Cover: list returns favorites newest-first; add is idempotent (adding twice does not duplicate or error); add 404s on a nonexistent player id; remove is idempotent (removing a non-favorite is a no-op, not an error); an inactive/anonymous caller is rejected by `_account_gate`.

**Step 3 — Verify + commit**

```bash
cd backend && rtk uv run --package app-service pytest tests/test_me_favorite_players.py -v
cd backend && rtk uv run ruff check src/rpc/users_admin.py --fix && rtk uv run ruff format src/rpc/users_admin.py
rtk git add backend/app-service/src/rpc/users_admin.py backend/app-service/src/schemas backend/app-service/tests/test_me_favorite_players.py
rtk git commit -m "feat(favorites): add me_favorites RPC handlers"
```

---

### Task 2.3: Gateway routes + OpenAPI manifest

**Files:**
- Modify: `gateway/internal/app/users_admin_routes.go`
- Modify: `backend/app-service/src/openapi_schemas.py`
- Modify: `backend/app-service/src/openapi_docs.py`
- Regenerate: `gateway/internal/openapi/schemas.json`

**Step 1 — Routes**

Append to the `/api/v1/me/*` block in `users_admin_routes.go` (near line 35-43):

```go
{Method: "GET", Pattern: "/api/v1/me/favorite-players", Queue: "rpc.app.users.me_favorites_list", Auth: edge.AuthRequired},
{Method: "POST", Pattern: "/api/v1/me/favorite-players/{id}", Queue: "rpc.app.users.me_favorite_add", IDParam: "id", Auth: edge.AuthRequired},
{Method: "DELETE", Pattern: "/api/v1/me/favorite-players/{id}", Queue: "rpc.app.users.me_favorite_remove", IDParam: "id", Auth: edge.AuthRequired, Success: 204},
```

**Step 2 — OpenAPI**

Mirror the `me_set_stream_visibility` entries in `openapi_schemas.py` (`Op(response=...)`, add `Op(response=list[schemas.MinimizedUserRead])` for the list) and `openapi_docs.py` (summary/description strings).

**Step 3 — Regenerate + verify**

```bash
bash backend/scripts/export_openapi_schemas.sh
cd gateway && rtk go build ./... && rtk go test ./internal/edge/... ./internal/app/...
```

**Step 4 — Commit**

```bash
rtk git add gateway/internal/app/users_admin_routes.go backend/app-service/src/openapi_schemas.py backend/app-service/src/openapi_docs.py gateway/internal/openapi/schemas.json
rtk git commit -m "feat(favorites): expose /api/v1/me/favorite-players via the gateway"
```

---

### Task 2.4: Frontend favorites — service, hook, star button

**Files:**
- Modify: `frontend/src/services/me.service.ts`
- Modify: `frontend/src/types/user.types.ts` (only if `MinimizedUser` needs no change — it already matches `{id, name}`; skip if so)
- Create: `frontend/src/hooks/useFavoritePlayers.ts`
- Create: `frontend/src/components/FavoriteStarButton.tsx`
- Modify: `frontend/src/i18n/messages/en.json`, `frontend/src/i18n/messages/ru.json`
- Create: `frontend/src/components/FavoriteStarButton.behavior.test.tsx`

**Step 1 — `meService`**

```ts
async getFavoritePlayers(): Promise<MinimizedUser[]> {
  const res = await apiFetch("/api/v1/me/favorite-players");
  return res.json();
},
async addFavoritePlayer(playerId: number): Promise<void> {
  await apiFetch(`/api/v1/me/favorite-players/${playerId}`, { method: "POST" });
},
async removeFavoritePlayer(playerId: number): Promise<void> {
  await apiFetch(`/api/v1/me/favorite-players/${playerId}`, { method: "DELETE" });
},
```

**Step 2 — `useFavoritePlayers()`**

A react-query-backed hook, one shared `queryKey: ["me", "favorite-players"]` cache for every consumer:
```ts
export function useFavoritePlayers() {
  const { user } = useAuthProfile();
  const query = useQuery({
    queryKey: ["me", "favorite-players"],
    queryFn: () => meService.getFavoritePlayers(),
    enabled: !!user,
  });
  const queryClient = useQueryClient();
  const favoriteIds = useMemo(() => new Set((query.data ?? []).map((p) => p.id)), [query.data]);
  const add = useMutation({
    mutationFn: (id: number) => meService.addFavoritePlayer(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["me", "favorite-players"] }),
  });
  const remove = useMutation({
    mutationFn: (id: number) => meService.removeFavoritePlayer(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["me", "favorite-players"] }),
  });
  return {
    favoritePlayers: query.data ?? [],
    favoriteIds,
    isFavorited: (id: number) => favoriteIds.has(id),
    toggle: (id: number) => (favoriteIds.has(id) ? remove.mutate(id) : add.mutate(id)),
    isLoading: query.isLoading,
  };
}
```

**Step 3 — `FavoriteStarButton`**

```tsx
interface FavoriteStarButtonProps {
  playerId: number;
  size?: "sm" | "md";
  className?: string;
}
```
Renders a `Star` (lucide-react, filled when favorited) icon button. On click: if `!user` (from `useAuthProfile`), `event.stopPropagation()` + `useAuthModalStore.open(...)` (same pattern as `Header.tsx`'s `handleLoginClick`) instead of mutating. If authenticated, `event.stopPropagation()` (critical when nested inside a `CommandItem`, whose `onSelect` fires on any inner click) then `toggle(playerId)`. `aria-label` swaps between `t("common.favorite.add")`/`t("common.favorite.remove")` based on `isFavorited(playerId)`.

**Step 4 — i18n**

Add a `common.favorite` block (used by every consumer) to both locale files:
```json
"favorite": { "add": "Add to favorites", "remove": "Remove from favorites" }
```

**Step 5 — Test**

Behavior test: anonymous click opens the auth modal and does not call `meService`; authenticated click calls `add`/`remove` depending on current state and does not bubble to a parent `onSelect`.

**Step 6 — Verify + commit**

```bash
cd frontend && rtk npx tsc --noEmit && rtk npx vitest run src/components/FavoriteStarButton.behavior.test.tsx
rtk git add frontend/src/services/me.service.ts frontend/src/hooks/useFavoritePlayers.ts frontend/src/components/FavoriteStarButton.tsx frontend/src/components/FavoriteStarButton.behavior.test.tsx frontend/src/i18n/messages/en.json frontend/src/i18n/messages/ru.json
rtk git commit -m "feat(favorites): add useFavoritePlayers hook and FavoriteStarButton"
```

---

### Task 2.5: Wire the star into profile toolbar, search results, and account settings

**Files:**
- Modify: `frontend/src/app/(site)/users/components/header/ProfileToolbar.tsx`
- Modify: `frontend/src/components/UserSearch.tsx`
- Modify: `frontend/src/components/MobilePlayerSearchSheet.tsx`
- Modify: `frontend/src/stores/account-settings-modal.store.ts`
- Modify: `frontend/src/components/AccountSettingsModal.tsx`
- Create: `frontend/src/components/account-settings/FavoritesSection.tsx`
- Modify: `frontend/src/i18n/messages/en.json`, `frontend/src/i18n/messages/ru.json`

**Step 1 — Profile toolbar**

`ProfileToolbar.tsx` needs the player's own id, not just the `ShareCardData`/`comparePath` it has today — check `card`'s shape (`ShareCardData` in `SharePlayerCard.tsx`) for whether an `id` is already present before adding a new prop. Add `<FavoriteStarButton playerId={...} />` as the third toolbar button, replacing the "Follow is a later backend phase" comment (update/remove that comment — it is now implemented).

**Step 2 — Search result rows**

In both `UserSearch.tsx`'s `CommandItem` and `MobilePlayerSearchSheet.tsx`'s equivalent, add `<FavoriteStarButton playerId={item.id} size="sm" />` after the name span, inside the row's flex container (`justify-between` so it lands at the trailing edge). This is the one place Task 0.2's row markup and this task's addition land in the same file — if Task 0.2 has not landed the row yet, coordinate over IRC before editing; otherwise this is a pure addition to an existing `CommandItem`.

**Step 3 — Account settings tab**

Add `"favorites"` to the `SettingsTab` union in `account-settings-modal.store.ts`. Add it to `TAB_CONFIG` in `AccountSettingsModal.tsx` (icon: `Star` from `lucide-react`) and a `TabsContent value="favorites"` rendering `FavoritesSection`. `FavoritesSection.tsx` mirrors `MyAccountSection.tsx`'s structure: `useFavoritePlayers()` for the list, each row a `Link` to `/users/${getPlayerSlug(name)}` plus a `FavoriteStarButton` to unfavorite, an empty state when the list is empty.

**Step 4 — i18n**

`accountSettings.tabs.favorites`, `accountSettings.favorites.{title,desc,empty}` (mirroring the `preferences`/`sessions` blocks at `en.json:411-414` and their sibling `title`/`desc` sections); `users.profile.toolbar.favorite`/`unfavorite` (mirroring `compare`/`comparePlayers` at `en.json:2787-2788`) if a toolbar-local label (not just aria) is wanted — otherwise `FavoriteStarButton` alone (icon-only, `aria-label` from `common.favorite`) is enough and no new toolbar copy key is needed; decide by matching `ProfileToolbar`'s existing `BTN` style (icon + short label) rather than guessing.

**Step 5 — Verify**

```bash
cd frontend && rtk npx tsc --noEmit && rtk npx vitest run src/components/account-settings/FavoritesSection.behavior.test.tsx
```
Manual smoke test: star a player from search, from their profile, from the other surface — confirm all three reflect the same state (shared react-query cache); unfavorite from the settings tab list; log out and confirm the star opens the login modal instead of erroring.

**Step 6 — Commit**

```bash
rtk git add frontend/src/app/\(site\)/users/components/header/ProfileToolbar.tsx frontend/src/components/UserSearch.tsx frontend/src/components/MobilePlayerSearchSheet.tsx frontend/src/stores/account-settings-modal.store.ts frontend/src/components/AccountSettingsModal.tsx frontend/src/components/account-settings/FavoritesSection.tsx frontend/src/i18n/messages/en.json frontend/src/i18n/messages/ru.json
rtk git commit -m "feat(favorites): wire favorite star into profile, search, and account settings"
```

---

## Phase 3 — Final verification (whole feature)

- `cd frontend && rtk npx tsc --noEmit && rtk npx next lint`
- `cd frontend && rtk npx vitest run` (full suite — confirm nothing else regressed)
- `cd backend && rtk uv run --package app-service pytest -v`
- `cd backend && rtk uv run ruff check . && rtk uv run ruff format --check .`
- `cd gateway && rtk go build ./... && rtk go test ./...`
- Manual pass on an actual narrow viewport (not just devtools breakpoint): mobile search opens/closes cleanly, history persists across a reload, favorites persist across a logout/login cycle for the same account.
