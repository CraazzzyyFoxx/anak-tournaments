# Administration UX Inventory

Contract per record: `route | title | purpose/question | permissions gate | blocks top→bottom | nesting depth & sub-navigation | actions (primary / secondary / bulk / row) | dialogs & sheets | filters & search | realtime/polling | complexity flags`

---

## 1. `/admin` — Dashboard (`app/admin/page.tsx`, 311 lines + 7 `components/admin/dashboard/*`)
- **Purpose**: "Is the platform healthy right now, what needs my attention, what's the active tournament's state?"
- **Gate**: none at route level; every block self-gates on `tournament.read` / `team.read` / `match.read` / `user.read` (workspace-scoped) and renders a `PermissionHiddenNotice` instead of hiding entirely.
- **Blocks top→bottom**:
  1. `GreetingBar` — H1 "Dashboard" + time-of-day greeting + username + date; "Create tournament" button (if `tournament.create`).
  2. Load-failure `Alert` (only if stats or tournaments query errored) with Retry.
  3. `KpiStrip` — up to 4 `StatTile`s: Active tournaments, Registration open, Matches played, Log coverage %. Tile count adapts to permissions (2/4 skeleton reservation).
  4. Two-column `[7fr_3fr]` grid:
     - Left (work column): `ActiveTournamentCard` (status badge, name, dates, stage list, log-coverage progress bar, Open/View-all buttons) + `ActiveTournamentReadiness` (checklist of ≤4 open items sourced from the SAME `buildChecklist`/readiness aggregate as the tournament hub's Overview tab, registration StatTileGrid, draft/balancer state badges).
     - Right (attention rail): `IssuesQueue` (up to 7 conditional issue tiles: pending confirmations, overdue results, missing logs, empty bracket slots, rosterless teams, stageless tournaments, unlinked identities — each links out) + `RecentTournaments` (list of 6, name/stage-summary/badge, links to hub).
- **Nesting**: 1 level (no tabs/sheets on this screen itself, but readiness and cards deep-link into the Tournament Hub's own tab/wizard nesting).
- **Data**: `/api/v1/statistics/dashboard` (single aggregate: counts + `DashboardIssues` + `active_tournament_stats`), `tournamentService.getAll`, and the tournament-hub's own readiness query (shared cache key) for the active tournament.
- **Actions**: primary — Create tournament, Open tournament; secondary — View all tournaments (×2), Full checklist, Retry.
- **Dialogs/sheets**: none.
- **Filters/search**: none.
- **Realtime**: none directly; readiness re-renders from cache when the hub invalidates it elsewhere.
- **Complexity flags**: 8 components collaborating on one screen (high fan-in for a landing page); permission-driven conditional layout (12+ boolean gates) is the actual complexity, not nesting.

## 2. `/admin/access` — Access index (redirect only)
- **Purpose**: routing shim — sends the user to the first accessible access sub-page.
- **Gate**: computed per sub-route.
- **Blocks**: none (renders `null`, client-side `router.replace`).
- **Nesting**: 0.
- **Complexity flags**: orphan-ish route — never a destination, only a redirect target; logic duplicates `access/layout.tsx`'s `accessNavItems` visibility list in a second array (`accessRoutes`).

## 3. `/admin/access/*` — Access section shell (`access/layout.tsx`)
- Not a route itself — wraps all 6 access sub-pages in a **tab-like nav bar** (`<Link>` pills, not `<Tabs>`), permission-filtered from a 6-item array (Users, Roles, Permissions, OAuth connections, API keys, Sessions).
- This is the ONE place in the admin panel using a manual `usePathname()`-driven pill nav instead of the sidebar; every other cluster (rank/subscriptions/streams) uses `ToggleGroup` tabs instead.

## 4. `/admin/access/users` — Access users (RBAC accounts) (675 lines)
- **Purpose**: "Which auth accounts exist, what roles/permissions do they have, what player identity are they linked to?"
- **Gate**: `accessUsersPermissions` (nav-level); row actions further gated by `role.update`+`role.read`, `auth_user.update`.
- **Blocks**: `AdminPageHeader` (RBAC badge) → `AdminDataTable` (Email, Username, Linked account [cross-links to `/admin/users`], Status icons [active/verified/superuser], Roles badges, row action).
- **Nesting**: page → row action opens a **"Manage access" Dialog** → dialog contains a **`Tabs`** (at minimum Roles/OAuth/Linked-player/Deny-editor judging by imports: `UserDenyEditor`, `rbacService.getUser`, `oauthConnectionsQuery`) → `UserDenyEditor` itself has an inline scope `Select` + toggle list, no further nesting. **Depth: table → dialog → tabs → editor widget = 3 levels.**
- **Actions**: primary — none (read-first); row — "Manage/View access"; inside dialog — assign role, remove role, delete account, assign/remove linked player.
- **Dialogs**: 1 large "Manage access" `Dialog` (tabbed) + implicit `AlertDialog` for delete (via `deleteUserMutation`).
- **Filters/search**: server search box only (no column filters).
- **Realtime**: none.
- **Complexity flags**: 675 lines; >2 nesting levels (table→dialog→tabs→widget); cross-links to `/admin/users` for the same underlying "user" concept, splitting one mental object across two screens (documented in-code as "D9").

## 5. `/admin/access/roles` — Roles (860 lines — largest file in scope)
- **Purpose**: "What roles exist (global + per-workspace), what permissions does each grant?"
- **Gate**: `accessRolesPermissions`; scope selector adds a second axis (`global` vs per-workspace `role.read`/`create`/`update`/`delete`).
- **Blocks**: header → scope `Select` (Global / per-workspace) → `AdminDataTable` (Role, Description, Scope badge, row menu) → create/edit uses a **permission matrix** (`PermissionMatrixRow`/`Column`, checkbox grid grouped by resource × action) inside `EntityFormDialog`.
- **Nesting**: table → Create/Edit `EntityFormDialog` → permission matrix (a table-in-a-dialog) = 2 levels, but the matrix itself is dense (resource rows × action columns, each cell a checkbox) — effectively a third UI surface.
- **Actions**: primary — Create role; row — edit, delete (view-only for read-access-without-manage).
- **Dialogs**: Create role, Edit role (same shape), `DeleteConfirmDialog`.
- **Filters/search**: scope `Select` (not a table filter, changes the whole query).
- **Realtime**: none.
- **Complexity flags**: 860 lines, by far the biggest single file audited; permission matrix is O(resources × actions) UI complexity; scope-branching duplicates every permission check twice (`effectiveScope === "global" ? ... : ...`) for read/create/update/delete — 4× ternary duplication.

## 6. `/admin/access/permissions` — Permissions (read-only catalog, 58 lines)
- **Purpose**: "What permission primitives exist?" Pure reference table.
- **Gate**: `accessPermissionsPermissions`.
- **Blocks**: header → `AdminDataTable` (Permission, Resource badge, Action badge, Description).
- **Nesting**: 0 — no dialogs, no row actions.
- **Complexity flags**: none — smallest, cleanest screen in the audit; good baseline for what a "read-only catalog" screen should look like.

## 7. `/admin/access/oauth` — OAuth connections
- **Purpose**: "Which OAuth provider accounts are linked to which auth users, and is the token still valid?"
- **Gate**: nav-level `accessUsersPermissions`; delete gated on `auth_user.update`.
- **Blocks**: header → provider `Select` filter + `AdminDataTable` (Provider badge, Provider account [avatar], Provider ID, Auth user [cross-links to access/users], Token status badge, Connected date, row delete).
- **Nesting**: 1 (table → `DeleteConfirmDialog`).
- **Filters**: provider dropdown + search.
- **Complexity flags**: none major; reuses `ProviderBadge`/`PROVIDER_META` shared with `UserDenyEditor`/`SocialAccountsEditor` ecosystem.

## 8. `/admin/access/sessions` — Auth sessions (superuser-only, read-only)
- **Purpose**: "What sessions exist across every user, for investigation/support."
- **Gate**: `superuserOnly: true` (only role-gated-by-boolean screen in Access, not by a permission list).
- **Blocks**: header (Superuser badge) → status `Select` filter + `AdminDataTable` (User, Device [parsed UA], Status, Signed in, Last seen, Expires, Network/IP + session ID).
- **Nesting**: 0 — no dialogs, no row actions (pure read).
- **Filters**: status dropdown (all/active/revoked/expired) + search.
- **Complexity flags**: none; this and Permissions are the two "flat catalog" screens.

## 9. `/admin/access/api-keys` — API keys (902 lines — 2nd largest file)
- **Purpose**: "Who has issued API keys, with what scopes, and are any inert/dangerous (`admin.*`)?"
- **Gate**: `accessApiKeysPermissions`, `workspaceAdminVisible: true` (visible via workspace-admin grant too, not just global).
- **Blocks**: header + `StatTileGrid` (EMPTY_COUNTS: total/active/expired/revoked) → `AdminDataTable` (Name, Status, Scopes [grouped chips + `admin.*` special-cased danger tone], Created/Expires timestamps, row actions) → Create dialog with grouped **`ScopePicker`** (checkboxes bucketed by resource prefix, `admin.*` wildcard called out separately and locks individual boxes when selected) → rename dialog, revoke `AlertDialog`.
- **Nesting**: table → Create `Dialog` (with embedded `ScopePicker`, itself a scrollable grouped-checkbox tree) + separate Rename `Dialog` + Revoke `AlertDialog` = 2 levels but 3 distinct dialog types on one screen.
- **Actions**: primary — Create key; row — rename, revoke, copy key (via Clipboard icon after creation).
- **Dialogs**: Create (`Dialog`), Rename (`Dialog`), Revoke (`AlertDialog`) — **3 dialogs on one screen**, flagged threshold.
- **Filters**: none beyond search (status/scope are visual only, not query filters).
- **Complexity flags**: 902 lines (largest page-level file after roles); 3 dialogs; `groupScopes` re-implements the same "bucket by resource prefix" idea `PermissionMatrixRow` builds in Roles — duplicated grouping logic across two screens.

## 10. `/admin/users` — Player identities (389 lines)
- **Purpose**: "What player identities (analytics/tournament identities, NOT auth accounts) exist, and what social handles are linked?"
- **Gate**: `canReadUsers`/workspace-scoped `user.read` opens it; create/update/delete/merge require GLOBAL `user.create`/`update`/`delete`/superuser.
- **Blocks**: header (Create player identity button) → `AdminDataTable` (ID, Name+avatar, Identities [`SocialAccountList`], row dropdown: Edit / Go to Access users / Merge / Delete).
- **Nesting**: table → row dropdown → one of: `PlayerProfileDialog` (edit, contains `SocialAccountsEditor` — itself a sub-editor with add/edit/delete/set-primary/visibility toggles), `UserMergeDialog`, `DeleteConfirmDialog`, Create `EntityFormDialog` (with `AuthUserSearchCombobox` to optionally link on create). **Depth: table → profile dialog → SocialAccountsEditor sub-widget = 2-3 levels.**
- **Actions**: primary — Create player identity; row — Edit identity, Go to Access users (cross-link), Merge, Delete.
- **Dialogs**: Create, Edit-profile (heaviest, embeds SocialAccountsEditor), Merge, Delete confirm — 4 distinct dialogs.
- **Complexity flags**: same "two Users pages, cross-linked, D9" duplication noted at `/admin/access/users`; this is the OTHER half of that split — a redesign should treat these as one IA problem, not two coincidentally-similar screens.

## 11. `/admin/rank` — Rank collection (health/status page family, member 1 of 3)
- **Purpose**: "Is the OverFast rank-collection worker healthy, and what's a given player's rank data state?"
- **Gate**: Status tab — `rank.read` workspace-scoped; Settings tab — superuser-only (former `/admin/settings` content, moved here per "D10").
- **Blocks**: header (player search in `actions` slot) → `ToggleGroup` tabs (Status / Settings, Settings only shown to superuser) → Status: `RankHealthDashboard` (StatTileGrid + `StatusBar` stacked distribution + legend) + `RankTaskHistory` (live worker task log table) + conditional `RankPlayerDetail` (opens below the fold when a player is selected via search, not a dialog). Settings: `RankSettingsPanel` (uses shared `CollectionSettingsPanel`/`useCollectionSettings`).
- **Nesting**: page → `ToggleGroup` tab (1 level) → in Status tab, selecting a player renders an inline detail block (not a dialog/sheet) below history — **shallow, intentionally avoids a 2nd dialog layer**.
- **Actions**: primary — player search (combobox); Settings tab — Save.
- **Filters/search**: player search combobox (by battle-tag/name) drives the inline detail panel.
- **Realtime**: none explicit on this page (contrast with Subscriptions, which has `useRealtimeCoalescedRefetch`).
- **Complexity flags**: `/admin/settings` is now a dead redirect INTO this page's Settings tab — that's a hidden nesting hop (`/admin/settings` → `/admin/rank?tab` mentally, though technically a hard redirect to `/admin/rank` with no tab preselection, so the user must still click "Settings" themselves).

## 12. `/admin/subscriptions` — Subscription collection (family member 2 of 3, richest of the three)
- **Purpose**: same shape as Rank but for Boosty/Twitch subscription checks, PLUS a 3rd "Providers" tab for per-workspace provider configuration.
- **Gate**: Status — `subscription.read` workspace-scoped; Settings — superuser; **Providers — `team.update` workspace-scoped** (reused permission, not a dedicated one — documented in code).
- **Blocks**: header (player search) → `ToggleGroup` (Status/Settings/Providers, each conditionally rendered) → Status: `SubscriptionHealthDashboard` + `SubscriptionTaskHistory` + conditional `SubscriptionPlayerDetail`. Settings: `SubscriptionSettingsPanel`. Providers: `WorkspaceSubscriptionPanel` (workspace-scoped provider/requirement editor, distinct component not shared with rank/streams).
- **Nesting**: page → tab (1 level) → Providers tab additionally reads `?tab=` from URL (deep-link support unique to this screen, clamped by permission) — so this is the one collection screen with **URL-driven tab state**, the other two are local-state only.
- **Realtime**: `useRealtimeCoalescedRefetch` on `workspace:{id}:subscriptions` channel, 500ms debounce, invalidates the whole `["admin","subscriptions"]` query prefix — the ONLY one of the three collection screens with live realtime refresh.
- **Complexity flags**: 3-tab family member (Rank/Streams are 2-tab) makes this the outlier of the "shared" pattern — the trio isn't actually uniform; Providers tab is genuinely different content (not health/settings/history/player), breaking the shared-layout assumption partway.

## 13. `/admin/streams` — Stream collection (family member 3 of 3, thinnest)
- **Purpose**: same shape again for the platform-wide (not workspace-scoped) Twitch live-status poller.
- **Gate**: Status — `stream.read` GLOBAL (not workspace-scoped, explicitly called out in comments); Settings — superuser.
- **Blocks**: header (no player search — streams has no per-player drill-down) → `ToggleGroup` (Status/Settings) → Status: `StreamHealthDashboard` only (no task-history table, no player detail). Settings: `StreamSettingsPanel`.
- **Nesting**: 0 beyond the tab toggle — flattest of the three.
- **Complexity flags**: none — the smallest, most honest member of the trio; a good "minimum viable" reference for what Rank/Subscriptions over-provide.

## 14. `/admin/workspaces` — Workspaces list (337 lines)
- **Purpose**: "What workspaces exist, are they active/hidden, who can I edit/delete?"
- **Gate**: page visible to `isSuperuser || isWorkspaceAdmin(any)`; create/delete superuser-only; edit per-workspace-admin.
- **Blocks**: header (Create button, superuser only) → `AdminDataTable` (ID, Icon, Slug, Name, Status icon, Visibility badge, row: Edit→navigates to `[id]`, Delete→superuser only).
- **Nesting**: table → Create `EntityFormDialog` (slug/name/description/icon upload via `EditableAvatar`) + `DeleteConfirmDialog`. Edit is NOT a dialog — it's a full page navigation to `/admin/workspaces/[id]`.
- **Complexity flags**: none significant; clean list+create, defers heavy editing to a dedicated page (unlike Users/Access-users which cram edit into a dialog).

## 15. `/admin/workspaces/[id]` — Workspace edit (784 lines — 3rd largest file)
- **Purpose**: full workspace configuration: identity (name/slug/desc/icon), branding (10 color tokens + toggle), locale (timezone), scope (newcomer_scope, hidden), SEO (title/description), Discord guild link, and **custom domain** (add/verify/remove with DNS polling).
- **Gate**: superuser or workspace-admin(id).
- **Blocks**: header (Back link, `AuditTrailButton` opens the shared drawer) → single long form, NOT tabbed, sectioned by heading groups (Identity → Branding colors [10× `BrandColorField`, each pairing a native color-input + hex text-input] → Timezone/locale → Visibility/newcomer switches → SEO fields → Discord guild id → Custom domain block with its own verify-poll state machine) → Save.
- **Nesting**: single scrolling page (no tabs), but the **custom-domain sub-section** has its own async state machine (add → show DNS records + token → poll verify every 15s → verified/remove) — effectively a wizard embedded inline rather than in a dialog/stepper, plus a `DeleteConfirmDialog` for "remove domain".
- **Actions**: primary — Save; secondary — Delete icon, Set/Verify/Remove custom domain, Open Audit Trail (sheet).
- **Dialogs/sheets**: `AuditTrailSheet` (global drawer), `DeleteConfirmDialog` (remove domain only — no delete-workspace here, that's list-page-only).
- **Realtime**: 15s domain-verification poll (`VERIFY_POLL_MS`) — the only client-side polling loop found in scope outside the collection-health screens.
- **Complexity flags**: 784 lines, single un-tabbed mega-form (no internal navigation despite covering 6+ distinct concerns: identity/branding/locale/visibility/SEO/domain) — a strong candidate for tab/section IA; `buildPayload`/`diffPayload`/`formFromWorkspace` triple of near-identical field lists (maintenance risk: 3 places list the same ~20 fields).

## 16. `/admin/workspaces/members` — Workspace members (669 lines)
- **Purpose**: "Who belongs to the current workspace, what system/custom roles do they hold?"
- **Gate**: `workspace_member.create/update/delete` (workspace-scoped) or superuser.
- **Blocks**: header (Add member, Fill-missing-roles wand action) → `AdminDataTable` with a **role-filter header dropdown** (`adminColumnMeta` + `roleFilterOptions`) → columns: User (avatar), Role (primary `Select` + custom-roles `Popover` with checkbox list), row remove.
- **Nesting**: table cell → `Popover` (custom roles multi-select) = 1 level; separate "Add member" `Dialog` (`Command`/combobox-driven user search) + `DeleteConfirmDialog` for removal.
- **Complexity flags**: 669 lines; inline-editable table (role changes fire mutations directly from table cells, no separate edit dialog) — different interaction pattern from every other list-with-dialog screen in this audit, worth flagging for IA consistency.

## 17. `/admin/audit` — Audit log (526 lines)
- **Purpose**: platform-wide "who did what, when" — one unified feed across role/API-key/tournament/workspace-settings changes.
- **Gate**: superuser sees "all workspaces" scope toggle; otherwise scoped to current workspace.
- **Blocks**: header → chip-based active-filter bar (`entity_type`, `actor_user_id`, `action` as removable chips, all URL-driven) → `AdminDataTable` (When, Action [+ "unrecognised" badge fallback], Actor [+ drill-into-actor button], Source, Entity/Target, changes-summary) → row click opens `AuditEntryDialog` (full before/after `AuditFieldDiff`, meta: source/workspace/IP/UA/correlation-id/entry-id).
- **Nesting**: table → row `Dialog` (single level) — but filters are entirely URL-state-driven with custom `history.replaceState` merge logic to coexist with the table's own URL writes (documented multi-paragraph rationale in code — a real synchronization hazard, not just complexity for its own sake).
- **Filters**: entity_type, entity_id, actor_user_id, action — all via URL chips, plus table search/sort. Also an "all workspaces" scope toggle for superusers.
- **Complexity flags**: 526 lines; the URL-state coexistence between page-owned filters and table-owned pagination/search is fragile/documented-as-fragile in comments — a redesign should own ALL filter state in one place (table or page, not split).

## 18. `/admin/settings` — Settings (5 lines, pure redirect)
- **Purpose**: legacy URL; permanently redirects to `/admin/rank` (rank config moved into Rank's Settings tab, "D10" in code comments).
- **Gate**: none (redirect fires unconditionally, downstream page re-gates).
- **Complexity flags**: this is exactly the kind of "orphan route reachable only by memory/bookmark" the assignment asked to flag — it exists solely as a compatibility shim, not a real screen. A clean IA would either delete the route or 301 at the server/router level instead of a client component page.

## 19. `/admin/heroes` — Heroes catalog (345 lines, catalog family member 1 of 3 "full" + 1 of 4 total)
- **Purpose**: CRUD the hero list backing match parsing (name, role, color, icon, aliases).
- **Gate**: read open; sync/create/edit/delete `isSuperuser`-gated.
- **Blocks**: header (Sync + Create toolbar via `CatalogToolbarActions`) → `AdminDataTable` (ID, Icon [`AssetPreview`], Name+color-dot, Role [icon + filter], Aliases-count badge, Actions dropdown) → Create/Edit `EntityFormDialog` (Name, Icon URL + preview, Role select, Color picker+hex, Aliases textarea).
- **Nesting**: table → dialog (1 level) → `DeleteConfirmDialog`.
- **Complexity flags**: none beyond the shared catalog pattern (see Duplication map) — hero-specific fields (role, color) are the only real per-entity divergence.

## 20. `/admin/gamemodes` — Gamemodes catalog (member 2 of 3 "full" catalogs, ~155 lines — smallest catalog)
- **Purpose**: CRUD gamemode list (name + aliases only, no extra fields).
- **Gate**: same as Heroes.
- **Blocks**: header (Sync+Create) → `AdminDataTable` (ID, Name, Aliases badge, Actions) → Create/Edit `EntityFormDialog` (Name, Aliases only).
- **Nesting**: table → dialog → delete confirm.
- **Complexity flags**: none — the purest expression of `useCatalogEntityCrud` + shared `Catalog*` components; near-zero unique code (~40 lines of page-specific JSX).

## 21. `/admin/maps` — Maps catalog (321 lines, member 3 of 3 "full" catalogs)
- **Purpose**: CRUD map list (name, gamemode FK, competitive-pool flag, image, aliases).
- **Gate**: same as Heroes/Gamemodes.
- **Blocks**: header (Sync+Create) → gamemode-filter-backed `AdminDataTable` (ID, Image, Name, Gamemode badge [+column filter], Mode-pool badge [+column filter], Aliases badge, Actions) → Create/Edit `EntityFormDialog` (Name, Gamemode select, Aliases, Competitive checkbox).
- **Nesting**: table → dialog → delete confirm; additionally fetches `gamemodesData` via a separate `useQuery` to back both the filter dropdown and the form select (not from `adminService`, straight `apiFetch`).
- **Complexity flags**: only catalog page with a genuine FK relationship (gamemode) and 2 column filters — mildly heavier than Heroes/Gamemodes but still uses every shared `Catalog*`/`useCatalogEntityCrud` piece.

## 22. `/admin/aliases` — Catalog alias misses queue (385 lines, the ODD ONE OUT of the "4 game-content catalogs")
- **Purpose**: NOT a CRUD catalog — a triage queue of unrecognised names seen in parsed logs ("raw_name" misses), for attaching to an existing hero/map/gamemode alias list or dismissing.
- **Gate**: read open (queue visible to anyone who can reach it); attach/dismiss `isSuperuser`-gated (columns render `null` otherwise).
- **Blocks**: header → entity-type `Select` filter + "include resolved" `Switch` → `AdminDataTable` (Type badge, Raw name code, Times-seen count, Last-seen date [tooltip: first-seen], Last-log link [deep-links to the tournament's match log viewer], Target picker [`SearchableImageSelect` sourced from 3 parallel `useQueries` against heroes/maps/gamemodes], row Attach/Dismiss buttons).
- **Nesting**: flat — no dialogs at all; every action is inline (searchable-select + button), and per-row state lives in a `Map<missId, targetEntityId>` in page state.
- **Filters**: entity-type dropdown, resolved-inclusion toggle, deep-link into a specific log via `last_log_record_id`.
- **Complexity flags**: does NOT use `useCatalogEntityCrud`, `CatalogFormFields`, `CatalogToolbarActions`, or `catalog-table-columns` at all — despite living alongside and being grouped with Heroes/Gamemodes/Maps in the sidebar/assignment, it is architecturally unrelated (a resolution queue, not a catalog editor). Redesign should NOT assume this is "catalog #4" — it's a different job (data-quality triage) that happens to touch the same three entity types.

---

## Cross-screen observations

### Duplication map (near-copy screen families)

**A. "Health / Settings[/ Providers]" collection trio — Rank, Subscriptions, Streams**
- Shared: `AdminPageHeader`, `ToggleGroup` (Status/Settings) tab switcher pattern, `useCollectionSettings`/`CollectionSettingsPanel` for the Settings tab, a `*-health.tsx` dashboard using `StatTileGrid` + a stacked `StatusBar`/`StateBar` distribution + legend, a `*-shared.tsx` module re-exporting `formatDate`/`formatRelative` from `components/admin/format-time` plus a local tone-map (`STATUS_STYLES`/`STATE_STYLES`) and a `*Badge` component (near-identical `TintedBadge` wrapper, only the status vocabulary differs: ok/private/not_found/error/rate_limited/disabled/pending vs active/inactive/unknown/error).
- Divergent: Subscriptions has a 3rd "Providers" tab (workspace-scoped provider config, genuinely different content) + realtime coalesced refetch + URL-driven initial tab (`?tab=`); Rank has per-player search/detail + task history; Streams has NEITHER player drill-down nor task history — it's Status+Settings only, and its permission model is GLOBAL not workspace-scoped (the only one of the three).
- **Redesign implication**: the "shared shell" (header, tab switcher, health dashboard, settings panel) is genuinely reusable and should stay a single component/pattern; the trio is NOT uniform beyond that shell — treat player-search/history/providers as optional slots, not assume every collection screen has all four.

**B. Game-content catalog family — Heroes, Gamemodes, Maps (NOT Aliases)**
- Shared near-100%: `useCatalogEntityCrud` hook (owns form state, dialog open/close, create/update/delete/sync mutations), `CatalogToolbarActions` (Sync+Create buttons), `CatalogFormFields` (`CatalogNameField`, `CatalogAliasesField`), `catalog-table-columns` (`createAliasesColumn`, `createEntityActionsColumn`), `EntityFormDialog`/`DeleteConfirmDialog` shells, `AdminDataTable`.
- Divergent: only the entity-specific fields (Heroes: role+color+icon; Maps: gamemode FK+competitive flag+image; Gamemodes: nothing extra) and entity-specific columns/filters.
- **Redesign implication**: this is the best-executed shared pattern in the whole panel — page-specific code is ~15% of each file. Use it as the template for tightening the collection trio (A) and the access sub-pages (C).
- **Aliases is miscategorized as a 4th catalog** in the current IA (same sidebar group) but is structurally a triage/queue screen, not a CRUD catalog — it shares zero code with A or the other three. Treat it as its own family in the redesign, not "catalog #4."

**C. Access sub-pages — Users / Roles / Permissions / OAuth / API keys / Sessions**
- Shared: `access/layout.tsx` pill-nav (not `Tabs`), `AdminPageHeader`, `AdminDataTable`, permission-gated row-action dropdowns, `DeleteConfirmDialog`/`AlertDialog` for destructive actions.
- NOT shared despite the common shell: Permissions and Sessions are pure read-only tables (no dialogs); Users, Roles, and API-keys each reimplement a DIFFERENT flavor of "grouped/bucketed selector" — Users' `UserDenyEditor` (capability × scope grid), Roles' permission matrix (resource × action grid), API-keys' `ScopePicker` (resource-bucketed checkbox list with a wildcard escape hatch). Three different bespoke widgets solving "let me pick from a large permission-shaped set," never factored into one shared component.
- **Redesign implication**: strongest concrete simplification candidate — unify the three grouped-permission-picker implementations (Roles matrix, API-keys ScopePicker, UserDenyEditor) into one shared `PermissionPicker`/`ScopeGroupPicker` component with resource-bucketing, since `groupScopes` (api-keys) and the matrix-building logic (roles) already do the same "split by `resource.action`" work independently.

**D. The "two Users pages" split (`/admin/users` vs `/admin/access/users`)**
- Both list "users," cross-link to each other via search-prefilled URLs (documented in code as intentional, "D9"), but represent different domain objects: `/admin/users` = player/tournament identity (name, social handles, no auth); `/admin/access/users` = auth account (email, roles, sessions, deny rules). This split is defensible domain-wise but is a genuine IA/navigation cost — a user unfamiliar with the system has no way to know which "Users" to open, and the cross-link is the only affordance connecting them.
- **Redesign implication**: candidate to merge into one entity detail view with two tabs/sections (Identity, Access) rather than two top-level nav items and two separate list tables, OR keep separate but make the relationship far more visible in the IA (e.g., group under one "People" nav section with explicit sub-labels).

### Inconsistent conventions
- **Tab mechanism**: Access uses a manual `<Link>` pill bar (`access/layout.tsx`); Rank/Subscriptions/Streams use `ToggleGroup` (client-state, not real navigation — no unique URL per tab except Subscriptions' `?tab=` param); Access-users' internal dialog tabs presumably use `Tabs`/`TabsList` (real Radix tabs). Three different "tabbed navigation" implementations for conceptually the same job.
- **Edit surface**: some entities edit inline via dialog (Heroes/Maps/Gamemodes, Roles, API keys, Users-player-identity), others navigate to a dedicated sub-route (`/admin/workspaces/[id]`), others edit in-place in table cells with no dialog at all (Workspace Members' role Select/Popover). No consistent rule for when editing should be a dialog vs. a page vs. inline.
- **Filter state ownership**: most screens keep filters as local `useState` (Aliases, Sessions, OAuth); Audit keeps filters in the URL with custom merge logic to coexist with the table's own URL writes (a documented fragility); Subscriptions reads one filter (`?tab=`) from the URL once at mount only. No shared "filters live here" convention.
- **Permission-hidden UX**: Dashboard renders `PermissionHiddenNotice` per block (explicit "you can't see this" messaging); most list pages simply don't render the nav item at all if unreachable, i.e., inconsistent between "explain why it's hidden" and "just hide it."
- **Empty states**: generally well-authored with specific copy (Audit has 3 distinct empty-state sentences, Aliases/Workspaces have contextual "why empty" messages) — this is a strength, not a flag, but worth preserving explicitly in wireframes rather than defaulting to generic "No results."

### Orphan / hard-to-reach routes
- `/admin/settings` — dead redirect to `/admin/rank`, no longer a real destination.
- `/admin/access` (index) — never a destination either, pure redirect to the first accessible access sub-page.
- `/admin/rank`, `/admin/subscriptions`, `/admin/streams` Settings tabs are reachable ONLY by clicking the in-page `ToggleGroup` — there is no direct URL/breadcrumb path to "Settings" (Subscriptions is the sole exception via `?tab=settings|providers`), meaning a user who bookmarks or shares a link to the settings view of Rank/Streams cannot do so.

### Candidate simplifications (3–5)
1. **Unify the three grouped-permission pickers** (Roles' permission matrix, API-keys' `ScopePicker`, `UserDenyEditor`'s capability toggles) into one shared component — they solve the identical "bucket by `resource.action`, pick a subset" problem with three separate implementations and three separate `group*` helper functions.
2. **Give the collection trio (Rank/Subscriptions/Streams) real URL-addressable tabs** (extend Subscriptions' `?tab=` pattern to all three) so Settings/Providers are linkable/bookmarkable, and delete the `/admin/settings` and `/admin/access` redirect shims once every destination they used to own has a stable, memorable URL of its own.
3. **Resolve the `/admin/users` vs `/admin/access/users` split** into a single "People" entity view with Identity/Access sections (or, at minimum, promote the cross-link from a single search-prefilled `<a>` to a persistent tab/summary card on both screens) — this is the single biggest navigational confusion point found.
4. **Split `/admin/workspaces/[id]`'s 784-line, un-tabbed mega-form** into sections/tabs (Identity, Branding, Locale & Visibility, SEO, Custom domain) mirroring the collection trio's tab pattern — it currently forces a long scroll through 6 unrelated concern areas with no in-page navigation.
5. **Re-home `/admin/aliases`** out of the "game-content catalog" IA group (sidebar/mental grouping with Heroes/Gamemodes/Maps) since it shares no code or interaction pattern with them — it belongs conceptually next to Audit/data-quality tooling, not the CRUD catalogs.
