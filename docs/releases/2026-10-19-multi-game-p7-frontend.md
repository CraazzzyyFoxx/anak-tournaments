# Multi-game P7 data-driven frontend: release note

P7 removes the last Overwatch assumptions from the shared web app and the read APIs behind it. Every surface now resolves
**one browsing discipline** (owner > explicit `?discipline=` > saved preference > workspace default), reads roles, slots,
catalog entities, stat definitions and grids from that game's declared metadata, and renders game-specific widgets only
through a per-game module behind a slot registry. Overwatch keeps its exact numbers and presentation inside
`frontend/src/disciplines/overwatch/**`; League of Legends gets generic views and explicit "not supported" states, never
an Overwatch fallback. **No database migration** ships with P7; the alembic head stays `achievement06`.

Deploy **all images from one SHA** (app, tournament, balancer, stats, analytics, stream, identity, gateway, frontend): there
is no old-wire compatibility. Local evidence only (commits `64456d7c7..HEAD` on `develop`, not pushed). The production
rehearsal is a P9 gate.

## 1. What changed on the wire

* **Discipline metadata.** `GET /api/v1/disciplines?workspace_id=<id|all>` and
  `GET /api/v1/disciplines/{discipline}/metadata?workspace_id=…` (AuthOptional, not cached per workspace). A hidden
  workspace is visible only to a superuser or a member; `workspace_id` outside the BigInteger range is 404, a
  non-integer other than `all` is 422. Role attrs carry presentation (`icon` = https URL / `assets/<d>/` key /
  `/disciplines/<d>/` path; `color` = `#RRGGBB`); children override, explicit `null` stops inheritance.
* **Native public catalog.** `GET /api/v1/catalog/{discipline}/{kind}[/{id}]` replaces `/heroes`, `/maps`, `/gamemodes`.
  Unknown discipline/kind and kinds a game does not declare (LoL has no `mode`) are errors; the shared
  `CatalogEntityRead` lives in `backend/shared/schemas/catalog.py`. Legacy `/heroes/{id}` URLs redirect with the discipline.
* **Discipline required** on: tournament list/facets and the pickup-mix list (`?discipline=`, unknown → 422), user,
  character and community statistics (`/api/v1/statistics/{discipline}/characters/...`, users overview `role_counts`,
  average division by role `role_avg_divs` keyed by role code), the pick-ban rules catalog, the sub-role list, registration
  rank history, `TournamentCreate.discipline` (Challonge import takes `?discipline=`), `CustomGameCreate.discipline`,
  `WorkspaceRead.disciplines_enabled`, standalone balancer uploads and sync. Public achievements use `?discipline=`
  (`?game=` is gone; an invalid value is a visible error, not a fallback). `rpc.app.achievements.user` takes an optional
  `discipline` that filters earned **and** locked rules.
* **Game identities.** Registration, roster and sheet imports speak `{provider, handle}` (`PlayerIdentityRead`); the
  workspace roster upsert body is `{discipline, identity, display_name}`; `RegistrationApprovedEvent.identity` replaces
  `battle_tag`. A handle from another game never finds, creates or names a player; moving an account requires verified
  ownership proof (409 `game_identity_conflict`). Riot IDs keep internal spaces (`Foo Bar#123` ≠ `FooBar#123`). Profile
  links always use the player's canonical name; `users.by_name` resolves canonical names before provider handles.
* **Native match wire.** `MatchRead` is a header with a `participants` array (slot order, nullable source team,
  official result, `duration_s`, nullable `played_at`, `created_at`), facts come as `viewer.facts` + `member_totals`
  (segment 0, NULL entity) and team facts via `team_scores`; members carry the observed handle **and** the canonical
  `player_name`. Kill feed is a native event stream. `AchievementMatchLink` carries `participants` and `duration_s`.
  Raw native fact values are served unrounded (the old reader's `numeric(10,2)` cast is gone: `25.2%` was shown as
  `25.0%`); formatting happens only at display. Admin match edit stays score-only.
* **Registration/roster.** `top_heroes` → `top_characters` on native role DTOs (stored form config/answers keep
  `top_heroes`); scrim containers are one hidden tournament per `(workspace, game)`; `RegistrationFormRead`,
  invite previews and `TournamentHistoryEntry` carry `discipline`; `UserTournament`, `DivisionGridVersionRead`,
  `MatchRead`, `EncounterRead`, `ScrimRoomRead` carry owner `workspace_id`/`discipline`.
* **Balancer.** `DisciplineSpec.balancer_role_settings` (Overwatch declares its former defaults; other games weigh roles
  neutrally); `role_mask` has no default — every run carries its shape. Saved balances write lower-case roster keys;
  capitalised legacy payloads are re-keyed on load.

## 2. Frontend architecture

* **Browsing resolver** (`useBrowsingDiscipline`, cookie `owt-discipline`, server `resolveServerBrowsingDiscipline`):
  `all` only on `/tournaments` and `/balancer/mix`; the tenant host's workspace is never overridden; browsing links
  (header, footer, command palette, `WorkspaceScopeLink`) carry the resolved game; an invalid explicit value renders an
  error state. Owner pages (tournament, match, encounter, draft, scrim, grid) take their game from the owner DTO.
  *Superseded on 2026-10-20 by the game scope (`docs/releases/2026-10-20-game-scope.md`): `all` is legal on every list
  page, links no longer carry the game, landing never canonicalizes the URL, and `useBrowsingDiscipline` is replaced
  by `useGameScope`.*
* **Slot registry by family** — `disciplines/registry/{rank,pregame,admin,match,profile,analytics}.ts` with module
  entrypoints `disciplines/<code>/<family>.ts`; `DisciplineWidget` takes the family loader (`load`), renders nothing (or a
  caller-supplied `pending` view) while a chunk loads and the fallback only when the resolved game has no renderer.
  Overwatch slots: `nativeRankEditor`, `rankMapping`, `rankHistory`, `pregameCharacterBans`, `matchStats`,
  `seriesStats`, `matchRowBadge`, `matchCharacters`, `characterPopover`, `characterStats`, `topCharacters`,
  `roleSignatures`, `tournamentSummary`, `characterCompare`, `characterCompareSummary`, `lobbyRankTiles`, `analytics`.
  The public `web` bundle no longer ships admin message namespaces.
* **Zone gates Z6/Z7** (`frontend/scripts/check-zone-boundaries.mjs`): core imports a module only via `types`,
  `DisciplineWidget` or `registry/<family>`; only `registry/**` imports `<code>/<family>.ts`; a module never imports
  `src/app/**`; `*.test.ts(x)` and `src/test/**` may import module helpers for parity oracles. The D99 scanner
  (`backend/scripts/check_discipline_literals.py`) fails on any new game literal outside the module; the 315 exact
  exceptions (path + token + context + count) in `discipline_literal_exceptions.json` are P9 relocation/copy debt or
  approved persisted identifiers. Role hues live in `disciplines/overwatch/role-hues.css`; the `--aqt-*` globals are gone.
* **Branding.** Empty `SITE_NAME`/`SITE_URL` means the neutral "OWT" default; route metadata uses the resolved
  tenant/platform name; the platform description is `common.platformDescription`.

## 3. Parity evidence

* Pre-move goldens were captured from **real gateway responses** of the unchanged producers on the P4 parity seed
  (`frontend/src/disciplines/overwatch/__fixtures__/pre-move/*.json`, 41 files, provenance SHA/DB/seed; algorithm
  timestamps pinned); post-move inputs are the same seed's real native responses (`__fixtures__/post-move/*`, 52 files).
  `disciplines/overwatch/match/pre-move.parity.test.ts`, `disciplines/overwatch/character/users.pre-move.parity.test.ts`,
  `app/(site)/users/users.pre-move.parity.test.ts` and the analytics parity test reproduce every captured output exactly
  (`toEqual`), with the old 2-decimal reader rounding applied input-side only as the equivalence gate (ruling M1).
* Backend goldens (`stats_reader_parity`, strict app golden, stats derived/condition parity, analytics ML parity) are
  untouched; tests adapt only their `collect_outputs` projection to the native wire. Golden fixture files are now pinned
  to LF (`.gitattributes`) because their SHA-256 is asserted.
* Analytics producer fix: `wins`/`losses` sums are cast to integer (`Decimal / float` crashed the Points recalculation).

## 4. Known limits and P9 debt

* A canonical name literally containing a hyphen stays unreachable by slug while its `#` twin exists (pre-existing).
* Past tournaments of another game render their own ontology; a game whose metadata is unknown shows a neutral glyph.
* Compare still maps stat codes through the Overwatch stat enum; a future game with other codes needs the compare queries
  generalised. That is **P9** (P8 deferred it as F3: LoL's `kills`/`dragons`/`kill` have no playtime stat, so LoL
  profile/compare/leaderboard reads stay unsupported). `shared/core/enums.py` `LogStatsName`/`MatchEvent`/`HeroClass`,
  Discord/notification role copy, the OW rank collector wire (`ow_*`) and the measurement script are enumerated D99
  exceptions owned by P9.
* Landed in P8 ([release note](2026-10-19-multi-game-p8-lol.md)): F4, the LoL `pregameCharacterBans` renderer
  (`disciplines/lol/pregame.ts`); F5, the achievement condition editor gated on `capabilities.achievement_conditions`.
  Moving the Overwatch `player_role` condition leaf stays P9.
* Six pre-P7 direct DB writers are registered in `PENDING_REPOSITORY_MIGRATION` (owed a repository, P9).
* Owner-side follow-ups recorded in the ledger: admin tournament hub "Open analytics" link capability gate
  (`TournamentHubShell.tsx`, owner WIP); the owner's `efdd11308` admin-kit refactor broke 11 of its own admin tests;
  `PersonGlance` fixed role list and a stale `PregameRoomsBrowser` exception will trip D99 once that WIP is committed
  (it was; P8's `419fa00ff` registered the three role rows and dropped the stale entry).

## 5. Verification (clean worktree of HEAD)

See `.superpowers/sdd/2026-10-15-multi-game-p7-frontend-plan/final-matrix.md` for commands, counts and the
classification of every remaining red (owner-introduced, pre-P7 baseline, or order-coupled). Browser matrix per the
contracts' §10.3 recipe is recorded in the same workspace.
