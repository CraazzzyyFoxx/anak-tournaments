# Tournament admin — UX inventory

Scope: `frontend/src/app/admin/tournaments/**`. 20 route records + hub navigation model + cross-screen observations.

Format per record: `route | title | purpose/question | permissions gate | blocks top→bottom | nesting depth & sub-navigation | actions (primary / secondary / bulk / row) | dialogs & sheets | filters & search | realtime/polling | complexity flags`

---

## 1. `/admin/tournaments` — list
**Title:** Tournaments. **Purpose:** "Which tournaments exist, which are active/draft, and which need a decision (resume draft vs open hub)?"
**Gate:** page always visible; `tournament.create` gates Create button, `tournament.delete` gates row delete.
**Blocks top→bottom:** `AdminPageHeader` (title + Create button) → `AdminDataTable` (search, sortable columns: Name/Unpublished badge, Type, Status, Start/End date, Stages summary, row delete) → two dialogs.
**Nesting depth:** 1 (list) → row click navigates to hub or opens depth-2 `AlertDialog` (resume-draft prompt).
**Actions:** primary = Create tournament (→ /new); row = delete; row click on hidden+stageless tournament → alert dialog (Open hub / Resume in wizard).
**Dialogs/sheets:** draft-resume `AlertDialog` (2 actions); `DeleteConfirmDialog` with 5-item cascade list.
**Filters/search:** free-text search, sortable columns, pagination (AdminDataTable built-in).
**Realtime/polling:** none.
**Complexity flags:** none; ~250 lines, single responsibility.

## 2. `/admin/tournaments/new` — creation wizard
**Purpose:** set up a tournament end-to-end in one flow.
**Gate:** Registration step hidden without `team.create`.
**Blocks:** header → resume-draft `AlertDialog` (auto) → step rail (5 steps) → step content card → sticky footer (Back / Save as draft / Continue|Create).
**Nesting depth:** 2 — wizard (1) → per-step forms (2, no further nesting). Steps: **Basics → Schedule → Rules → Registration → Review & create**.
**Actions:** Continue (validate+advance), Create tournament (final), Back, Save as draft (lazily creates hidden draft tournament, `ensureDraft` promise de-dupe).
**Dialogs/sheets:** 1 `AlertDialog` (resume draft).
**Filters/search:** none.
**Realtime/polling:** none.
**Complexity flags:** 495 lines, 3 async mutation flows (Challonge import w/ double-retry hide, ensureDraft de-dupe, publish) — logic-dense but UI shallow.

## 3. `/admin/tournaments/[id]` — root
Redirect-only to `overview`. No UI. Trivial.

## 4. Hub shell (`TournamentHubShell.tsx`+`layout.tsx`) — wraps every tab
See navigation model below. **Blocks:** `TournamentWorkspaceHeader` (name hidden, League badge, dates, teams/participants, stages/encounters/standings counts; actions: Open analytics link, Mark finished/Reopen) → Tabs bar (9 possible keys, filtered by `allowedTab`) → active tab content. One realtime mount + one debounced readiness-invalidate shared by all tabs.
**Gate:** requires ≥1 of many tournament-scoped permissions or superuser else "Unauthorized"; guard redirects to overview if resolved tab isn't allowed.
**Complexity flag:** ~309 lines of permission wiring + 3 realtime subscriptions (tournament realtime, balancer topic, workspace-subscriptions topic) all funneling into one debounced `readiness` invalidation — busiest glue file, correctly centralized.

## 5. `/overview`
**Purpose:** "Where does this tournament stand, what's still needed?"
**Gate:** always allowed (default).
**Blocks:** `PhaseStepper` (+ the one `TournamentStatusControl`) → optional "Draft live" banner (link to Draft) → `LifecycleChecklist` (6 phase groups: Setup/Registration/Formation/Bracket/Live/Finish, each item deep-links) → `StatTileGrid` (3 read-only tiles: Stages/Challonge/Discord).
**Nesting:** 1 (no sub-tabs; only cross-tab links).
**Actions:** phase-stepper status transition; checklist deep-links.
**Dialogs:** none.
**Realtime:** window-focus refetch + shell's debounced invalidation; explicitly NO interval polling.
**Complexity flags:** none — deliberately kept simple (config pushed to Settings per code comments).

## 6. `/registration`
**Purpose:** "Who registered, what's their admission status?"
**Gate:** `team.read`.
**Blocks:** conditional `RegistrationTeamsCard` (only if team_formation==='registration': roster completeness, shortfall, invite ledger, reject/export) → `RegistrationsTable` (shared w/ legacy balancer route).
**Nesting:** has 3 sibling sub-routes (form/feed/rank-autofill) with NO visible tab bar — reachable only via in-context links, unlike matches/* which has a real sub-tab nav. Navigation-model asymmetry.
**Actions:** row accept/reject/withdraw in card; table actions external.
**Dialogs:** reject/reset confirm dialogs, collapsible per-team invite-history panel.
**Filters:** `includeTerminal` toggle; RegistrationsTable has its own (not inventoried, external).
**Complexity flags:** hidden 4-page cluster (results/form/feed/rank-autofill) with no visible switcher.

## 7. `/registration/form`
Renders `RegistrationFormBuilder` (shared w/ legacy balancer route). Orphan-by-navigation (link-only, no tab entry).

## 8. `/registration/feed`
Renders `SheetsFeedPage` (shared). Same orphan-navigation pattern.

## 9. `/registration/rank-autofill`
Renders `RankAutofillPage` (shared). Same orphan-navigation pattern.

## 10. `/teams`
**Purpose:** manage team roster, Challonge mapping, players.
**Gate:** button-level (`canCreateTeam`/`canUpdateTeam`/`canDeleteTeam`/`canImportTeams`/`canCreatePlayer`/`canUpdatePlayer`/`canDeletePlayer`).
**Blocks:** header actions (import file input, Challonge sync trigger) → teams table → `?challongeSync=1` deep-link auto-opens sync dialog.
**Nesting:** 2 — table (1) → Challonge-sync `Dialog` (2) containing per-participant searchable `ChallongeTeamPicker` combobox (3, widget not route).
**Actions:** Sync from Challonge, Import teams (file upload); row edit/manage roster.
**Dialogs:** 1 large `Dialog` (Challonge mapping) + `DeleteConfirmDialog`.
**Filters:** searchable combobox per Challonge participant row.
**Complexity flags:** **704 lines**; sync dialog is itself a small wizard nested 2 levels deep inside the hub.

## 11. `/stages`
**Purpose:** define bracket/group structure, seeding, tiebreakers, best-of. Renders `StageManager` — **largest file in the tree (2450 lines)**.
**Blocks:** stage cards list → "Add stage" → per-stage collapsible "Advanced" (ranking preset, tiebreaker order, scoring, swiss bye points, DE grand-final type, best-of, seed ranking) → stage-item management.
**Nesting:** 3 — list (1) → per-stage Collapsible Advanced (2) → best-of/tiebreaker sub-editors (3, client state only).
**Actions:** Add stage; per-stage rename/delete/seed/merge/force-activate/deactivate/regenerate (7 distinct confirm-guarded mutations).
**Dialogs:** 1 `EntityFormDialog` (create stage) + **6 separate `DeleteConfirmDialog` instances** (delete stage, delete item, seed, merge, force-activate, deactivate, regenerate) = **7 dialogs on one screen**.
**Filters:** none (scan-all).
**Complexity flags:** file 2450 lines (largest), 7 dialogs (>>3 threshold), 3-level nesting, heavy bracket-projection math co-located with UI. Top redesign candidate.

## 12. `/matches` (layout + sub-routes)
Layout hosts the "Play & Results" sub-tab bar — deliberately a plain `<nav>` of `Link`s (not nested shadcn Tabs, avoids roving-tabindex conflict). **Sub-tabs (order):** Results (default) → Reports → Maps → Logs → Report form, all gated on `match.read`; unpermitted/unknown segment redirects to `results`.
**Nesting:** 2 — hub tab (1) → sub-tab bar (2, URL-addressable).

### 12a. `/matches/results` (default)
`TournamentMatchesTab`, 1234 lines. **Blocks:** 2 independent scope filters (encounters-by-stage, standings-by-stage, both persisted to URL params) → encounters table (create/edit/delete/Challonge-sync/per-row log-upload) → standings table (edit/delete/recalculate).
**Dialogs:** `EntityFormDialog`×2 (encounter, standing) + `DeleteConfirmDialog`×2 + per-row `TournamentLogUploadDialog` = 4+ dialogs on one screen.
**Complexity flags:** 1234 lines; URL-param filter convention distinct from other tabs.

### 12b. `/matches/reports` → `EncounterReportsBrowser` (external). Browse captain-submitted reports.

### 12c. `/matches/maps` → `ParsedMatchesBrowser` (external). Browse parsed map/game results.

### 12d. `/matches/logs`
`TournamentLogsTab`, 589 lines. Header (title, Upload logs, Process S3 logs) → filter toggle group (All/Failed/Processing/Pending/Done w/ live counts) → debounced search → infinite-scroll list w/ per-row retry, bulk retry-failures.
**Realtime:** polls every 10s ONLY while queue active; otherwise driven by `workspace:{id}:logs` topic, no idle polling.
**Note:** legacy former top-level tab; permanent redirect from old path; key kept in TAB_KEYS to avoid guard-flash mid-redirect.

### 12e. `/matches/report-form` → `MatchReportFormBuilder` (external). Configures the captain-facing report form; positioned last deliberately.

## 13. `/draft`
**Purpose:** run team-draft formation.
**Gate (hub-level):** only visible when `team_formation === 'draft'`. Body further gated on `team.create`.
**Blocks:** conditionally renders `AdminControlRoom` (session live/paused) OR `DraftSetupWizard`+`DraftHistoryPanel` (setup/ready/none/terminal) — **two entirely different screens sharing one route**.
**Setup wizard nesting:** 6 linear steps — **Config → Pool → Captains → Order → Review → Ready** — plus 2 `AlertDialog`s (reseed confirm, cancel confirm).
**Control-room nesting:** hero header (status/format/team-size/connection/progress) → blocked-reason alert (→ `ResolveRoleConflictDialog`) → 2-col body: main (current-pick + `LifecycleControls`, 3-metric grid) / aside (`FeasibilityStatus`, `CaptainPresence`).
**Complexity flags:** DraftSetupWizard 637 lines, 6-step wizard nested inside a hub tab nested inside the hub; Draft route is effectively 2 IA destinations disguised as 1.

## 14. `/pickBan`
**Purpose:** configure pre-game pick/ban (map veto + hero draft) per scope. Renders `PickBanConfigsTab`, **1916 lines (2nd largest file)**.
**Gate:** `match.update`.
**Blocks:** scope selector (tournament/stage/round/encounter, with inheritance via `findInheritedConfig`/`rescopePickBanDraft`) → map/hero catalogue pickers (chips, group-filter pills, searchable Command popovers) → step-sequence builder (ban/pick tokens, sides, rotation).
**Nesting:** 2+ — scope tree → catalogue picker popovers (21 `onOpenChange` handlers per graft hotspot count — many small overlays).
**Complexity flags:** 1916 lines; label "Pre-game Phase" intentionally hides that it merges 2 previously-separate features behind one generic engine — route name (`pickBan`) vs. user label mismatch worth flagging for IA.

## 15. `/links`
**Purpose:** manage typed link catalog (Discord/stream/VOD/bracket/rules/other). Renders `TournamentLinksTab`, 643 lines.
**Gate:** `tournament_link.read` (tab), create/update/delete/repoll separately gated.
**Blocks:** plain `ui/table` (deliberately not `AdminDataTable` — flat, unpaginated array) sorted `(sort_order, id)`; "Make primary" per stream row; re-poll button.
**Dialogs:** 1 `EntityFormDialog` (4 fields) + `DeleteConfirmDialog` (archive confirm) — thorough field-level 409/422 error mapping.
**Complexity flags:** none structural; well-scoped CRUD, intentional exception to AdminDataTable convention.

## 16. `/settings`
**Purpose:** identity, rules/scoring, schedule, roster shape, visibility, integrations, danger zone. Renders `TournamentSettingsTab`, 714 lines.
**Gate:** `tournament.update` (tab+edit), `tournament.delete` (delete button).
**Blocks:** Audit-trail button (top) → sticky dirty-state save bar (conditional) → 2-col grid: left = General info card, Format/scoring card, Schedule card, Roster-shape card; right = `TournamentIntegrationsPanel` (Challonge slug + Discord channel, nested `ChallongeIntegrationSection`), `TournamentPreviewAllowlist`, Danger zone.
**Nesting:** 2 — settings form (1) → integrations panel's own `EntityFormDialog` (Discord edit, 2) + its `DeleteConfirmDialog` + top-level tournament-delete `DeleteConfirmDialog`.
**Dialogs:** Audit-trail Sheet, Discord-channel EntityFormDialog+DeleteConfirmDialog, tournament-delete DeleteConfirmDialog.
**Complexity flags:** 714 lines; classic "everything tab" aggregating 6+ unrelated concerns onto one screen — contrasts with Overview's deliberate simplicity.

---

## Hub navigation model (indented outline, depth-numbered)

```
0  Tournament Hub (TournamentHubShell) — one permission gate, one header, one realtime mount
1    TournamentWorkspaceHeader — metrics only (League badge, dates, teams/participants,
                                  stages/encounters/standings; actions: Open analytics, Mark finished/Reopen)
1    Tab bar (real routed links, not client tab panels)
2      Overview            (default; always allowed)
3        PhaseStepper — pipeline + TournamentStatusControl
3        [conditional] Draft-live banner → link to Draft tab
3        LifecycleChecklist — 6 phase groups, deep-links into other tabs
3        StatTileGrid — 3 read-only tiles (Stages/Challonge/Discord)
2      Registration        (gated: team.read)
3        RegistrationTeamsCard (conditional: team_formation === 'registration')
4          per-team invite-history Collapsible
4          reject/reset confirm dialogs
3        RegistrationsTable (shared w/ legacy balancer route)
2      [orphan] Registration/form           — no tab-bar entry; link-only
2      [orphan] Registration/feed          — no tab-bar entry; link-only
2      [orphan] Registration/rank-autofill — no tab-bar entry; link-only
2      Teams               (gated: button-level only)
3        teams table
3        Challonge-sync Dialog
4          per-participant searchable ChallongeTeamPicker combobox
2      Stages              (gated: none extra)
3        stage cards list
4          per-stage Collapsible 'Advanced settings'
5            best-of / tiebreaker / scoring sub-editors (client state)
3        Add-stage EntityFormDialog
3        6× DeleteConfirmDialog (delete stage/item, seed, merge, force-activate, deactivate, regenerate)
2      Play & Results (matches)  (gated: none extra at hub level)
3        Sub-tab bar (plain <nav>, not nested Tabs)
4          Results (default; gated: match.read)
5            encounters table + URL-param scope filter
6              Create/Edit encounter EntityFormDialog
6              Delete encounter DeleteConfirmDialog
6              per-row TournamentLogUploadDialog
5            standings table + URL-param scope filter
6              Edit standing EntityFormDialog
6              Delete standing DeleteConfirmDialog
4          Reports  (gated: match.read) → EncounterReportsBrowser
4          Maps     (gated: match.read) → ParsedMatchesBrowser
4          Logs     (gated: match.read; legacy top-level tab, permanent redirect)
5            filter toggle group + debounced search + infinite scroll
5            Upload-logs dialog, per-row retry, bulk retry-failures
4          Report form (gated: match.read) → MatchReportFormBuilder
2      Draft               (gated: team_formation === 'draft')
3        [branch A] AdminControlRoom (session live/paused)
4          hero header (status/format/team-size/connection/progress)
4          blocked-reason alert → ResolveRoleConflictDialog
4          current-pick section + LifecycleControls
4          aside: FeasibilityStatus, CaptainPresence
3        [branch B] DraftSetupWizard (session setup/ready/none) — 6-step wizard
4          Config → Pool → Captains → Order → Review → Ready
5            reseed confirm AlertDialog
5            cancel confirm AlertDialog
3        DraftHistoryPanel (past sessions, delete-with-epoch-reset)
2      Pre-game Phase (pickBan)  (gated: match.update)
3        scope selector (tournament/stage/round/encounter, with inheritance)
4          map/hero catalogue pickers (group-filter pills + search Command popovers)
4          step-sequence builder (ban/pick tokens, sides, rotation)
2      Links               (gated: tournament_link.read)
3        links table (flat, sort_order)
3        Add/Edit link EntityFormDialog
3        Archive link DeleteConfirmDialog
2      Settings            (gated: tournament.update)
3        Audit-trail Sheet (button, top of form)
3        General info / Rules+scoring / Schedule / Roster-shape cards
3        TournamentIntegrationsPanel
4          Challonge slug section
4          Discord channel EntityFormDialog
5            Delete channel DeleteConfirmDialog
3        TournamentPreviewAllowlist card
3        Danger zone → Delete tournament DeleteConfirmDialog
```

---

## Cross-screen observations

1. **Two incompatible sub-navigation conventions coexist.** `matches/*` has a real, visible, URL-addressable sub-tab bar shared by 5 sibling routes. `registration/*` has 3 sibling routes (form/feed/rank-autofill) with no shared layout or visible switcher — reachable only via in-context links/buttons. Redesign should either give registration the same sub-tab treatment or intentionally demote those pages to modal/drawer flows.
2. **Dialog-density outliers.** `stages` (StageManager) stacks 7 separate confirm/entity dialogs on one screen (2450 lines, largest file). `matches/results` runs 2 independent CRUD tables each with their own dialog pair (4+ dialogs). Both are strong split candidates.
3. **File-size hotspots (>400 lines):** StageManager.tsx (2450), PickBanConfigsTab.tsx (1916), TournamentMatchesTab.tsx (1234), TournamentTeamsTab.tsx (704), TournamentSettingsTab.tsx (714), TournamentLinksTab.tsx (643), DraftSetupWizard.tsx (637), TournamentLogsTab.tsx (589), new/page.tsx (495). These 9 files carry the overwhelming majority of cognitive load; every other route file is a ~30–60 line thin wrapper.
4. **Duplicated 'everything tab' pattern.** Settings and Stages both aggregate many unrelated concerns onto one screen, in contrast to Overview which was explicitly redesigned to be config-free and read-only (documented in code comments).
5. **Two different filter-persistence conventions.** matches/results persists scope filters via URL params; teams persists a challongeSync deep-link param; Stages/Links/Registration use plain component state with no URL persistence. Standardize.
6. **Naming vs. label mismatch.** The `pickBan` route is labeled 'Pre-game Phase' to paper over a recent merge of map-veto and hero-pick-ban into one generic engine — intentional, but the internal name doesn't match the external label.
7. **Draft tab is really two unrelated screens sharing one path** (AdminControlRoom vs DraftSetupWizard), chosen by session status. Should be two IA destinations in wireframes, not one conditionally-rendered tab.
8. **Legacy/transitional routes still wired in.** matches/logs is a permanently-redirected former top-level tab; registration/* pages are explicitly shared with a 'legacy balancer route' pending retirement (comments reference 'D25...until T14 retires the latter'). Known technical debt to absorb or exclude from the redesign scope.
9. **Inconsistent empty/loading conventions.** Most tab pages show a shared `tabFallback` skeleton while loading and silently return `null` when the tournament is missing, rather than a dedicated empty-state message.
10. **Candidate simplifications:** split StageManager into 'Stages list' + dedicated 'Stage editor'; give registration/* a visible sub-tab bar (or convert to drawers); split Settings into sub-sections/sub-tabs (General/Rules/Schedule/Roster/Integrations/Danger); treat Draft's two branches as two IA destinations; standardize URL-param-persisted filters across Teams/Stages/Links to match matches/results.