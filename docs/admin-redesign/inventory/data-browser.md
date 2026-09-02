# Data browser — UX inventory

## Per-route notes

- `frontend/src/app/admin/teams/page.tsx` — 306-line clean AdminDataTable CRUD list (6 cols, 1 tournament filter); TeamCreateDialog (name+captain only, roster deferred) + DeleteConfirmDialog; row click routes to [id].
- `frontend/src/app/admin/teams/[id]/page.tsx` — 317+ lines; NOT a read-only detail view — it IS the live roster editor (inline-edit name, avatar upload, StatTileGrid, captain select, embeds TeamRosterEditor). No save step, every field persists on change.
- `frontend/src/components/admin/teams/TeamRosterEditor.tsx` — 682-line hand-rolled AdminDetailTable (not AdminDataTable) with commit-on-blur cells, substitute-depth tree walk, per-row role/sub-role/flag controls that PATCH immediately.
- `frontend/src/app/admin/players/page.tsx` — 870 lines — largest plain CRUD page; AdminDataTable, 8 columns, 1 tournament filter, near-duplicate create/edit EntityFormDialog bodies, derived read-only Division field, conditional sub-role catalog.
- `frontend/src/app/admin/encounters/page.tsx` — 928 lines — largest plain CRUD page; cascading stage/stage-item selects inside form, closeness-to-stars conversion, editable-status allowlist excluding COMPLETED (owned by result endpoint).
- `frontend/src/app/admin/match-reports/page.tsx` — 29-line thin wrapper mounting shared EncounterReportsBrowser with tournamentId=null (workspace-wide); same component the tournament hub mounts pinned.
- `frontend/src/components/admin/EncounterReportsBrowser.tsx` — 316+ lines; StatTileGrid (4 tiles scoped to workspace/tournament not current filter) + AdminDataTable (5 cols, reported_count + result_status header filters, mismatchOnly toolbar toggle) + ResolveResultDialog.
- `frontend/src/app/admin/matches/page.tsx` — 23-line thin wrapper mounting shared ParsedMatchesBrowser with tournamentId=null; row detail uses a Sheet, the only sheet-based detail among reviewed browsers (vs dialogs elsewhere).
- `frontend/src/components/admin/ParsedMatchesBrowser.tsx` — AdminDataTable, 4 cols, map_id + log_status header filters plus separate 'unresolved' toolbar chip (distinct concept from log_status=failed); opens ParsedMatchSheet on row click.
- `frontend/src/app/admin/standings/page.tsx` — 557 lines; unique combination of client-derived scope Tabs (synthesized from loaded rows, not a real resource) + page-level useTournamentRealtime + separate recalculate AlertDialog; reimplements tournament-filter wiring instead of reusing TournamentFilterSelect.
- `frontend/src/app/admin/divisions/page.tsx` — 1045+ lines; NOT AdminDataTable-based — bespoke keyboard-navigable spreadsheet grid (8 fixed columns, multi-row select + bulk rank-shift) orchestrating GridLibrary + ImportWizard + ConflictResolver as always-mounted cards rather than staged steps.
- `frontend/src/app/admin/divisions/ImportWizard.tsx` — 303 lines; 3-step cascading select (source workspace → grid → version) + 2 checkboxes + async job polling (1s refetchInterval while pending/running).
- `frontend/src/app/admin/divisions/ConflictResolver.tsx` — 174 lines; per-conflicting-tier target-division Select, only rendered when auto-mapping fails; functions as an implicit 4th wizard step gated on failure of the 3rd.
- `frontend/src/app/admin/divisions/GridLibrary.tsx` — 398 lines; grid picker/create/archive/import-JSON/export/load-standard-OW-grid, with a force-delete AlertDialog that only appears after a 409 conflict response (conditional dialog-after-error pattern).
- `frontend/src/app/admin/divisions/OwRankRangePicker.tsx` — 209 lines; bespoke 2D click-to-anchor rank-range picker popover (its own anchor/hover-preview/commit micro-state machine), embedded per-row inside the divisions spreadsheet grid.
- `frontend/src/app/admin/balancer/page.tsx` — 912+ lines for a conceptually small settings catalog; hand-rolled Table (not AdminDataTable) split into system vs custom status tables, bespoke icon-picker and color-picker popovers.
- `frontend/src/app/admin/sub-roles/page.tsx` — 231 lines; flattest screen reviewed — no dialogs, card grid per role, inline rename/add/deactivate all commit immediately. Good IA reference pattern; explicitly extracted from the tournament registration-form builder to avoid cross-tournament side effects.
- `frontend/src/app/admin/achievements/page.tsx` — 1465 lines — largest file in scope; AdminDataTable list plus 6+ dialogs (create/edit, 2x delete/hard-reset, evaluate, override, test-result, library-copy); rules are also independently editable from the [id] detail route — two editing surfaces for one entity.
- `frontend/src/app/admin/achievements/[id]/page.tsx` — 1049+ lines; embeds ConditionFlowEditor inline (not dialog), hand-rolled sortable Table + useInfiniteQuery for affected users (AdminDataTable already supports paging='infinite' — missed reuse), duplicates category/scope/grain icon-maps and constants verbatim from the list page.
- `frontend/src/components/admin/achievements/ConditionFlowEditor.tsx` — 1393 lines — single most complex file in scope; full React Flow graph editor for boolean condition trees, 27 leaf condition types, custom auto-layout algorithm, parallel screen-reader-only TreeOutline mirroring the canvas.
- `frontend/src/app/admin/workspaces/members/page.tsx` — 669+ lines for a conceptually 2-column table; AdminDataTable with inline immediate-persist role editing (system-role Select + custom-roles Popover checklist) embedded directly in table cells, plus superuser bypass on every permission gate (unique among reviewed screens).
- `frontend/src/app/admin/pickup/page.tsx` — 5-line bare redirect to /balancer/pickup — orphan route with no admin-specific content; worth confirming whether it belongs in admin nav at all.

## Matrix & observations

TABLE IMPLEMENTATION MATRIX (screen | table impl | row detail | columns | header filters | search | bulk actions):
/admin/teams | AdminDataTable | route(/admin/teams/[id]) | 6 | 1(tournament) | yes | no
teams/[id] roster | hand-rolled AdminDetailTableShell | inline commit-on-change | ~7 | none | no | no
/admin/players | AdminDataTable | dialog(edit) | 8 | 1(tournament) | yes | no
/admin/encounters | AdminDataTable | dialog(edit) | ~7 | 1(tournament) | yes | no
/admin/match-reports (EncounterReportsBrowser) | AdminDataTable | dialog(ResolveResultDialog) | 5 | 2(reported_count,result_status)+1 toolbar toggle | yes | no
/admin/matches (ParsedMatchesBrowser) | AdminDataTable | SHEET(ParsedMatchSheet) | 4 | 2(map_id,log_status)+1 toolbar chip | yes | no
/admin/standings | AdminDataTable | dialog(edit) | ~9 | 1(tournament,custom widget)+client Tabs scope | yes | no
/admin/divisions editor | BESPOKE SPREADSHEET GRID (not AdminDataTable) | inline per-cell | 8 fixed | none(grid select instead) | no | yes(multi-row+bulk rank-shift)
/admin/balancer | HAND-ROLLED Table (not AdminDataTable) | dialog(edit) | 4x2 tables | none | no | no
/admin/sub-roles | card list(no table) | inline | n/a | none | no | no
/admin/achievements | AdminDataTable | dialog(edit) AND route([id]) | ~7 | none observed | yes | no
achievements/[id] users table | HAND-ROLLED Table+useInfiniteQuery (not AdminDataTable) | n/a | ~4-5 | 1(tournament) | no | no
/admin/workspaces/members | AdminDataTable | inline role edit+dialog(remove) | 2 wide cols | 1(role_id) | yes | no
/admin/pickup | n/a(redirect) | n/a | n/a | n/a | n/a | n/a

CROSS-SCREEN OBSERVATIONS:
Duplicated patterns: (1) players/encounters copy-paste create vs edit EntityFormDialog bodies rather than one parameterized form. (2) achievements list page and [id] detail page duplicate CATEGORY_ICONS/SCOPE_ICONS/GRAIN_ICONS maps and CATEGORIES/SCOPES/GRAINS arrays verbatim. (3) EncounterReportsBrowser and ParsedMatchesBrowser are each mounted twice — once as a workspace-wide flat route (/admin/match-reports, /admin/matches), once inside the tournament hub with tournamentId pinned — intentional per in-code comments but means these are really 2 screens with 2 entry points, not 4. (4) standings reimplements tournament-filter URL wiring via raw usePathname/useSearchParams instead of reusing the shared TournamentFilterSelect/TOURNAMENT_QUERY_PARAM helpers that encounters/matches use.
Inconsistent conventions: table implementation diverges (AdminDataTable is dominant but balancer, divisions-editor, sub-roles, and achievements/[id]-users all bypass it, each for arguably valid but undocumented reasons); row-detail affordance is inconsistent — dialog dominant, but matches uses Sheet and teams/achievements use a route, with no stated rule for which applies when; achievements is editable from two surfaces (list dialog AND detail route) with unclear canonical ownership.
Orphan routes: /admin/pickup is a bare redirect, not a real screen.
Where complexity concentrates: divisions (page.tsx 1045 + ImportWizard 303 + ConflictResolver 174 + GridLibrary 398 + OwRankRangePicker 209 ≈ 2100+ lines) stacks 4 sequential workflows on one page. achievements ecosystem (page.tsx 1465 + [id] 1049 + ConditionFlowEditor 1393 ≈ 3900+ lines) centers on a full graph-editor UI for boolean rule trees. Together these two subsystems are ~60% of all lines reviewed across 14 routes.
Candidate simplifications: (1) Stage divisions as an explicit flow (library → edit OR import → conflict-resolution only when needed) instead of 4 always-mounted cards. (2) Extract a shared EntityForm body for players/encounters to eliminate duplicated dialog bodies. (3) Unify achievements editing to one canonical surface (list dialog for quick metadata only, or drop it in favor of the detail route). (4) Standardize row-detail affordance by data weight (≤6 fields→dialog, read-heavy technical→sheet, editable+shareable→route) and migrate the outliers. (5) Consider a guided non-canvas condition builder for ConditionFlowEditor's common single-AND-of-thresholds case, reserving the full React Flow canvas for power users needing branching logic.