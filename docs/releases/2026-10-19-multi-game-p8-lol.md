# Multi-game P8 League of Legends scenarios: release note

P8 makes League of Legends playable end to end on the machinery P1–P7 built: the LoL module declares its sides, its
minimal stat/event vocabulary and a side-selection preset; the pre-game room learns to require, protect and rebuild
sides; the Data Dragon map 11 gets its canonical code; a mix host can no longer admit an account holder; and an opt-in
live module drives both games through registration, balance/draft, mix, pre-game, ingest and reads on real processes.
The live journeys found two production defects (P8-D1, P8-D2); both are fixed here. **No database migration** ships with
P8; the alembic head stays `achievement06`.

Deploy backend services, the regenerated gateway schemas (`f6cc6d14d`, `d989cf367`) and the frontend from one SHA, as
for P7. Local evidence only (the P8 commits in `17acffe0f..898801df9`, named per section below, plus this
documentation, on `develop`, not pushed). The production rehearsal is a P9 gate.

## 1. LoL declarations (`0a3a4cf20`)

* `shared/disciplines/lol`: `sides=("blue", "red")` (index 0 = blue, 1 = red: the `side_pick` wire index),
  `stat_defs` `kills` and `dragons` (integer, sum), `event_types` `kill`, and the lazy `pick_ban_presets`. App-service
  startup projects the vocabulary; there is no Alembic revision.
* Deliberately **not** declared: `balancer_role_settings` (roles weigh neutrally), native ranks/ladder, collector,
  ingestors/decoder, `derive_match`, achievement conditions, analytics. LoL metadata reports `catalog_sync` true and
  `native_rank_collection`, `native_ladder`, `achievement_conditions`, `analytics` false (asserted live).
  *(2026-10-21: LoL native ranks and the Riot collector shipped — `docs/releases/2026-10-21-riot-lol.md`.)*
* D99: `dragons` became a stat-code token; the module directories stay exempt, so no manifest entry was needed.

## 2. Side-selection preset (R1)

* `lol_side_selection` — "Side selection: higher seed, then previous loser". One phase, one `side_pick` step acted by
  the round's opener (`first`), 90 s timer, `random_fill` on timeout (the room picks a side at random), first-ban
  rotation `result_loser_first`: game 1 is opened by the higher seed (its bracket slot; slot 1 when unseedable), every
  later game by the previous game's loser.
* **Side selection only**: not a champion draft and not Fearless (D98 narrowed, amendment A14). The wire kind stays
  `hero` (persisted identifier); the catalog kind is `character`.
* **The organizer still saves a champion pool** (non-empty, active LoL champions): `has_pool` was not relaxed. The side
  step consumes none, and the captain room hides the champion grid on a side step. Since `fdcf49d34` the config save
  itself refuses a side-picking hero config without a pool (422 `pool_required`, section 11).
* Wire (no new route): captain `POST /api/v1/encounters/{eid}/pick-ban/hero/act`
  `{"item_id": <side index>, "action": "side_pick"}` — a zero-based index into `state.sides`, `0` valid, never a
  catalog id; admin `POST /api/v1/admin/encounters/{eid}/pick-ban-act`
  `{"kind": "hero", "encounter_team_id": …, "item_id": <index>, "action": "side_pick"}`. Room state carries `sides`
  and `starting_sides: [{game_id, position, sides: {"<encounter_team_id>": code | null}}]`, now emitted for hero rooms
  as well as map rooms and with `position` (a shape change for map rooms too).
* The rules editor shows `side_pick` only on a step that already is one; authoring new side steps is not added.

## 3. Live side rules (R2, `9fdfa1698`)

* **409 `side_pick_pending`** while the position's side step is open. Cancelled rooms no longer count as pending.
* **409 `side_pick_required`** ("This game's sides are not set; the room's side pick has to be played first") on map
  selection, captain claim, `logs_official` evidence and admin result, but **only where the room picks sides for that
  game**: the live room's ruleset snapshot, else the config the cascade resolves for the encounter, evaluated per game
  position with the engine's own phase selection. A phased ruleset can require sides for game 1 and not for game 2.
  Once required, both seats need distinct sides.
* Recorded **like Overwatch** (no deadlock, no new endpoint): a LoL encounter with no side-capable config, a custom
  ruleset without `side_pick`, or a cancelled room. Series-level writes (captain series result, technical loss,
  Challonge, host mix outcome) never asked and still do not. The retrospective mix is unchanged: a host outcome with
  unknown sides is accepted and reads back without sides.
* A LoL log that arrives before the side pick cannot bind: map selection is refused until sides are set, so the hinted
  game has no map and the document fails `binding_mismatch`; nothing becomes official (live evidence).

## 4. Played-side protection (`f8626285f`, `5a04fd4ee`)

"Played" = the position's game has a claim or a confirmed result.

* Captain undo (request or apply) and admin reopen that would take back a played side → **409 `side_locked`** ("This
  side was already played on; it can no longer be taken back"), before anything is written or journaled.
* An unplayed undo clears both seats' sides and unbinds the side-bound steps.
* **An admin reopen of an unplayed side step starts empty**: the new attempt's draft holds no item (the previous side
  is never preselected), the round's side-bound steps are unbound and that game's sides are cleared, so the opposite
  choice lands and rebinds them.
* A hero room reset (`POST /api/v1/admin/encounters/{eid}/pick-ban-session/reset` `{"kind": "hero"}`) clears the sides
  of every unplayed game, whichever room picked them; played games keep theirs (a map room reset cancels the games
  instead, section 6). A replayed side pick on a played position writes nothing.
* The only Overwatch delta here: captain undo now takes the encounter lock before the room lock.

## 5. Dependent-round correction (`a34d2122c`) — an Overwatch behaviour change

`POST /api/v1/admin/encounters/{eid}/games/{gid}/result` (reason required) is now dependency-aware for **every game**.
For each non-cancelled progressive room whose snapshot first-ban rotation is a `result_*` rotation, a correction that
changes who opens game N+1 (or, for `result_loser_choice`, who won game N):

* **untouched** next round → scrapped and re-appended for the corrected opener in the same commit (journal
  `round_opened`);
* **touched** next round (a non-voided submission on one of its steps, or its game has a side, a claim or a confirmed
  result) → **409 `dependent_round_started`** ("Game {N+1}'s pick-ban already started on the old result; undo that
  round or reset the room before correcting").

The refusal is decided **before the audit**: guard → audit → correction → one commit. A refused correction leaves no
audit, result, bracket, submission, side, journal or outbox row (the admin audit write moved into the service as a
required callback). A correction that changes no opener (2:1 → 3:1) changes no round. Overwatch rooms with result
rotations previously kept a stale opener; they now rebuild or refuse. `downstream_started` was never an emitted code:
the UI branch and docs now name `dependent_round_started`.

## 6. Recovery after `dependent_round_started`

**(a) The next round was touched but its game is unplayed** (submissions/sides only). The captains undo that round
back to its first step (`POST /api/v1/encounters/{eid}/pick-ban/{kind}/undo` with `{"consent": true}`, both captains,
once per step); each undo voids the target and every later step and clears unplayed sides, after which the correction
rebuilds the round. Organizer alternative for a hero room: `POST /api/v1/admin/encounters/{eid}/pick-ban-session/reset`
`{"kind": "hero"}` re-creates the room at round 1. Round 1 must then be replayed to completion (its side step is
answered again; game 1's played sides are kept; game 1's correction answers `side_pick_pending` until then), round 2
re-appends from the stored result, and the correction rebuilds it. An admin reopen is **not** a recovery (its draft
still touches the round). A map room with a result rotation has no organizer path for (a) other than (b).

**(b) The next game is claimed or confirmed.** No route invalidates one position; the chain over existing routes keeps
history and creates replacement ids:

1. If the encounter result is confirmed: `POST /api/v1/admin/encounters/{eid}/result/reopen` (with a reason). A started
   downstream stage refuses here — the bracket's own rule — and recovery stops.
2. `POST /api/v1/admin/encounters/{eid}/pick-ban-session/reset` `{"kind": "map"}` cancels **every** game of the
   encounter: the rows stay `cancelled` with their results, claims, sides and map; the series is re-scored.
3. The same route with `{"kind": "hero"}` when a hero room exists: deleted and re-created at round 1.
4. Replay: the round-1 side step (captain, or the admin act re-entering the sides actually played) opens a replacement
   game 1′ with a new id; record the corrected numbers on it (`POST …/games/{game 1′}/result` with a reason, or captain
   claims); round 2 opens for the corrected loser; game 2′ is replayed or re-entered the same way.
5. Observations bound to the cancelled games stay bound to them (history). Re-attach by submitting the document again
   with a new `source.external_id` and `hint.encounter_game_id` = the replacement id.

**P9 gaps (no P8 production work):** surgical single-position invalidation (recovery (b) retires every game of the
encounter) and re-binding an existing observation to a replacement game.

## 7. Canonical LoL payload

Codes: stats `kills`, `dragons`; event `kill`; map `summoners_rift`; champions by their slugified Data Dragon id
(`ahri`); positions `top`, `jungle`, `mid`, `bot`, `support` (dimension `position`); identity provider `riot`
(`Name#TAG`, internal spaces kept). The worked example and the run command are in the P5 guide,
[section 15](2026-10-15-multi-game-p5-ingest.md#15-local-verification-recipe). Resolution is exact-slug:
`summoner-s-rift` in a document is an unknown map (the alias is a lookup breadcrumb only). Unknown stat, event or role
and a wrong-kind entity fail with 422 `unknown_code` and one issue each (path, code, kind, raw name), an alias-miss row,
no observation and no dictionary row (asserted live). Native match and kill-feed reads ride a 30 s backend TTL with no
targeted invalidation, so a corrected revision can take up to 30 s to show.

## 8. Catalog map 11: operator note (`e3ef97c2d`)

* Data Dragon `MapId` 11 always syncs as `summoners_rift`; other maps keep their slugified name.
* **The first LoL sync after deploy** (`POST /api/v1/admin/catalog-sync/lol`, superuser) rewrites a legacy
  `summoner-s-rift` row **once**, in its own commit before the map batch: same id (every FK), name, attrs, `active`
  and parent; `summoner-s-rift` is added to its aliases. Later syncs are idempotent.
* Images follow the existing mirror policy: an **already-mirrored** image keeps its key byte-identical
  (`assets/lol/map/summoner-s-rift.png`); a **never-mirrored** one is mirrored as `assets/lol/map/summoners_rift.png`.
* **409 `catalog_conflict`** (`Data Dragon map "Summoner's Rift" matches catalog rows [ids]; resolve them in the catalog
  admin first`) when several rows match, or one row matches only by an alias; no map is written, champions may already
  be applied. A row an admin re-slugged keeps its slug when its name matches. The admin UI shows the server message in
  the global error toast.
* Runs only inside the sync — never at startup or in Alembic. A restored-data rehearsal of the rewrite is a P9 item.

## 9. Identity: R5 roster admission (`eb0edd7b0`)

`POST /api/v1/balancer/workspaces/{workspace_id}/players` with a handle owned by an existing **auth-linked** player
who is not an admitted member of the workspace is **403 `forbidden`** (field `identity.handle`, "This player has an
account; only a member manager can add them to the workspace") unless the actor holds `workspace_member.create`. It is
refused before any player, social account, member or role row is written. An already admitted member stays an
idempotent hit for anyone; unlinked and new players are unchanged. Live: a host's add of an account holder is 403, the
target's `GET /api/v1/workspaces/{id}/members` stays 403 before and after (fresh login), and an organizer's add admits
them with the `player` role.

## 10. Rollout rules and unsupported capabilities (consumed, asserted live)

* Enabling LoL on a workspace stays superuser-only (`PATCH /api/v1/workspaces/{id}` with `disciplines_enabled` from an
  organizer → 403).
* A LoL tournament or mix needs a tiered LoL division grid (422 `division_grid_required`); another game's grid never
  satisfies it.
* LoL has no achievement conditions: `GET /api/v1/admin/ws/{ws}/achievements/rules/condition-types?discipline=lol`
  answers **200 `[]`**, a LoL ingest creates no award, and the condition editor shows "not supported" (F5).
* **F3 is deferred to P9**: LoL profile/compare/leaderboard reads are not supported (LoL's `kills`/`dragons`/`kill`
  have no playtime stat; the LoL character leaderboard answered 400 in the live run). LoL statistics live on the
  native match/encounter reads only.

## 11. Frontend (`5768a99ae`, `deba0892e`, `e512cfd02`, `1c2bc27a8`, `6e1b196fb`, `17bbcf236`, `fb306a81a`, `f739f55f4`, `97883c171`) and the pool save guard (`fdcf49d34`)

* Captain room: on a side step the champion grid is replaced by a labelled side choice (`aria-pressed` buttons,
  keyboard reachable, disabled unless the viewer acts); the confirm sends the side index. A chosen side is forgotten when
  the turn changes (new step, undo back, reopen, other team). Timeline, undo, history and the assignment line
  ("{side}: {team}") speak in side labels (`pickBan.room.sides.<game>.<side>`, raw code fallback).
* Organizer controls: side act with team override; correction rows read the map room's games, so hero-only LoL rooms
  can be corrected; 409 `dependent_round_started` shows `admin.dependentRoundStarted` (`admin.downstreamStarted` is
  gone). `MapReportDialog` explains `side_pick_required`; `side_locked` shows the server message.
* **F4**: `disciplines/lol/pregame.ts` renders LoL's committed bans/protects (`pregameCharacterBans`), never the
  Overwatch board or its lobby copy.
* **F5**: the achievement condition editor is gated on `capabilities.achievement_conditions`. Overwatch behaviour
  change: the condition-type registry is fetched when Edit is clicked, not on page view. Moving the Overwatch
  `player_role` leaf stays P9.
* RU/EN keys added in both bundles (parity test).
* **"Opens this round"** (`f739f55f4`): the scoreboard marks the opener of the round in play (the first actor of the
  latest round in `state.sequence`), not the seed opener (`session.first_team_id`). Under `result_loser_first`, round 2
  marks game 1's loser. Browser round 1 saw the old marker (D-opener).
* **Organizer Reopen on a settled side pick** (`97883c171`): the admin panel offers Reopen when the latest answered
  step is a `side_pick` every actor revealed and its game has no claim and no confirmed result; a played side is never
  offered. Before, the button needed a blind dispute step, so a side step could be reopened only through the route
  (browser round 2, D-reopen).
* Both room fixes landed after the last browser round and are **verified by vitest only** (section 14).
* **Pool save guard** (`fdcf49d34`, tournament-service): `PUT /api/v1/admin/tournaments/{tid}/pick-ban-configs` for a
  hero config whose rules hold a `side_pick` step and that saves no pool (no item, no slot) answers **422
  `pool_required`** ("These rules pick sides, so the champion pool has to be saved first: without a pool the room never
  opens and every game waits on its side pick"). Before, the save succeeded, the room reported `not_configured` and
  every claim and result answered 409 `side_pick_required`. Applying the LoL preset therefore needs the champion pool
  before Save succeeds (R1). A hero template without a side step still saves with an empty pool.

## 12. Defects the live journeys and the browser pass found, fixed in P8

* **P8-D1** (`0abaee3d3`): `PATCH /api/v1/tournaments/{tid}/registration/me` intermittently answered 500
  (`MissingGreenlet`): the post-commit reload reset `reg.tournament` to lazy and `queue_role` read it.
  `registration_read_loaders()` now loads the tournament, covering self-edit, check-in and submit.
* **P8-D2** (`9de6ac20d`, `132508552`, `091e79cad`), all in the P5-era ingest binding:
  1. **Stage seats carry roster line-ups.** Stage generation, bracket seeding, swiss rounds and the requalification
     reseat snapshot each team's tournament roster (substitutes flagged; names cut to the column's 255 characters; a
     member rostered on two of the seated teams is left off both). A line-up is a snapshot: roster changes after
     generation are not synced. Admin manual create, Challonge sync, FFA lobbies and scrims still seat without
     line-ups. **No backfill**: stage encounters generated before `9de6ac20d` have no line-up, so their hinted
     documents still await a link; the admin bind still works.
  2. **An admin bind the rosters contradict is refused** with 409 `binding_mismatch` before anything is written: a
     participant off their mapped seat's line-up who is rostered on another team of the tournament (a reversed map
     over seats without a line-up, a third team's member). This is the match layer's `extra_member_other_team` rule
     applied up front; mix encounters skip it. The bind and the match layer are not made atomic across services; as
     with every older bind refusal, the stored document envelope stays for a later bind.
  3. **Hint-less binding** needs the unique fitting game to hold **every** participant on the line-up of the seat
     their team maps to; otherwise the document waits (`awaiting_link`). Hinted documents keep the P5 evidence rule; a
     hint-less correction whose participants are all on the line-up still replaces automatically.
* **D-mix** (`204c1a61c`, found by browser round 1, not P8-originated): balancer mix reads (`_dump_game`) never
  carried the mix's game while the mix board (owner `34fb4023b`) reads `game.discipline`, so every mix page requested
  `GET /api/v1/disciplines/undefined/metadata` (404): roles rendered "?" and the clone source list stayed empty. Every
  mix read now carries `discipline` (an additive field of an untyped read; no schema to regenerate). Re-verified in the
  browser on the `204c1a61c` stack.

## 13. Gates

D99 manifest `419fa00ff`: the owner's admin refactor (`e899cb5a8`) added Overwatch role literals in
`components/admin/people/PersonGlance.tsx`; the three rows are registered as collector-wire debt and the stale
`PregameRoomsBrowser.tsx` `hero` entry is dropped (315 → 317 exceptions; the owner's later `963536452` leaves 314).
`898801df9` moves the `PregameRoom.tsx` exception's context to the `state=` prop `f739f55f4` introduced (still 314).
Wire schemas regenerated twice, both description-only: `f6cc6d14d` (side-selection error prose) and `d989cf367` (the
`pool_required` prose on the config upsert).

## 14. Live verification and the P8 commands

The opt-in module `backend/stats-service/tests/test_two_game_live_scenarios.py` (`RUN_P8_LIVE_SMOKE=1`) reuses the
P5 stack (`live_smoke_support.bring_up(stack, apps=True)`) and adds app-service and balancer-service `serve`. Recipe,
containers and env: the P5 guide, section 15. Scenarios run in file order: `tournament_registration`,
`identity_journeys`, `balance_and_draft`, `frozen_mix`, `encounter_pregame`, `canonical_ingest`,
`awaiting_link_and_official`, `readback_isolation`, `unsupported_and_diagnostics`, `source_catalog`
(`RUN_P8_SOURCE_SMOKE=1` only), then a non-destructive dead-letter/`processing` check. A skipped run is not evidence.

Recorded 2026-10-20 in a clean worktree detached at `8588e360e` (evidence under
`.superpowers/sdd/2026-10-15-multi-game-p8-lol-scenarios-plan/evidence/`, not in git):

| Run | Result |
| --- | --- |
| P8 module (`s4-round3`) | **10 passed, 1 skipped** (`source_catalog`, flag) in 280 s; evidence `errors` empty; 578 HTTP operations, 23 jobs, 6 receipt outcomes; every process (app, balancer, gateway, identity, stats_rpc, tournament, worker_lol, worker_overwatch) exited 0 |
| P8 module + `RUN_P8_SOURCE_SMOKE=1` (`s4-round3-source`) | **11 passed** in 259 s; Data Dragon `16.20.1`, Ahri `id` `Ahri` / `key` `103` / `[Mage, Assassin]`, map 11 "Summoner's Rift"; all syncs `{"success": true}`; mirrored `assets/lol/map/{summoners_rift,summoner-s-rift,howling-abyss,teamfight-tactics,arena}.png`; `versions.json`/`champion.json`/`map.json` SHA-256 identical to the previous round |
| P5 smoke (`s4-round3-p5`) | **18 passed** in 160 s |

A redaction grep of all evidence directories found no key, token, password, JWT or seeded handle.

**Browser hold.** With `P8_SMOKE_BROWSER_HOLD=1` the fixture teardown keeps every process serving: it prints the
gateway URL and non-secret ids, writes the logins to a private temp file **outside** the evidence directory, and waits
for `<P8_SMOKE_EVIDENCE_DIR>/release`. `touch` that file after the browser pass; the teardown then stops each process
in reverse start order, asserts clean exits, closes the stack (scratch DB, vhost, bucket, Redis database) and deletes
the credentials file. Browser checkpoints (both games, desktop and mobile, RU and EN, keyboard): directories and
browsing resolution; owner overrides; dual identities and the R5 refusal; side selection (index 0 = Blue, the
assignment line, game 2 opened by game 1's loser, `side_pick_required`/`side_pick_pending` messages, timeout, empty
admin reopen, `dependent_round_started` text); warm-cache game switches and the missing-grid 422; Ahri / Summoner's
Rift, native facts and the corrected revision, awaiting-link and admin bind; LoL achievements/analytics/collector
unsupported; cross-workspace denials. Results: below.

Not claimed: an analytics HTTP refusal (no analytics process in this stack), quota spend, `captain_identity` /
`additional_handles` (no producer) and mix-ingest binding (no path).

**Browser rounds** (`browser/evidence.md` in the workspace): held live stacks, headless Chromium against `next dev`,
no mocked handlers. Every hold ran the live module to **11 passed** and its teardown asserted exit 0 for all eight
processes.

| Round | Stack | Items |
| --- | --- | --- |
| 1 | `8588e360e` | 1 directories and browsing resolution; 2 owner overrides |
| 1 | `204c1a61c` | 4 side selection (preset, side step, `side_pick_pending`, timeout, game 2 opened by the loser); 5 mix caches and clone; 6 match/encounter reads; 7 cross-workspace read denial |
| 2 | `204c1a61c` | 3 identities and the R5 refusal through the mix dialog; 4 admin reopen of an unplayed side step (route) and the `dependent_round_started` text; 5 new OW grid, pinned tournaments; 6 condition editor, awaiting-link and admin bind, catalog admin; 7 cross-workspace writes, wrong-module bind, unknown-code diagnostics |

Items 1, 2, 3, 5, 6 and 7 pass on both games; item 4 passes in behaviour. D-mix was fixed between the rounds. The two
room defects the rounds reported, D-opener and D-reopen, were fixed afterwards (`f739f55f4`, `97883c171`) and are
**verified by vitest only** (`PregameHeader.behavior.test.tsx`, `pregameRoom.behavior.test.tsx`; matrix step 6d); no
browser round ran at or after them. No live or browser run happened at `fdcf49d34`: round 1 saved the preset with an
empty pool (200), which that guard now refuses. Room updates appeared only after a refresh; `next dev` has no `/ws`
rewrite, so this is most likely a harness artifact (not checked against a gateway-origin build).

**Final sequential matrix** (`final-matrix.md` in the workspace): one check at a time on the shared checkout, final
HEAD `d989cf367`, controller re-runs at `898801df9`. Backend steps with the test-DB env from `backend/`.

| Step | Check | HEAD | Exit | Result |
| --- | --- | --- | --- | --- |
| 1 | `shared/tests` | `f739f55f4` | 0 | 1686 passed, 12 skipped |
| 2a | `tournament-service/tests` | `f739f55f4` → `97883c171` | 0 | 1894 passed, 29 skipped |
| 2a′ | `test_pick_ban_admin_upsert_slots.py` | `d989cf367` | 0 | 75 passed |
| 2b | `balancer-service/tests` | `97883c171` | 1 | 1062 passed, 1 failed (baseline) |
| 2c | `stats-service/tests` | `97883c171` | 1 | 532 passed, 2 failed (baseline), 34 skipped |
| 2d | `app-service/tests` | `97883c171` | 1 | 844 passed, 95 failed (baseline), 3 skipped |
| 3a | module-boundary, literal and repository-boundary tests | `97883c171` | 0 | 18 passed |
| 3b | D99 scanner | `97883c171`, re-run `898801df9` | 1 → 0 | stale `PregameRoom.tsx` exception after `f739f55f4` → clean (314 exceptions); `test_discipline_literals.py` 12 passed |
| 4a | `ruff check .` | `97883c171` | 0 | all checks passed |
| 4b | `ruff format --check` | `97883c171` (repo), re-run `898801df9` (the two `fdcf49d34` files) | 1 → 0 | a sibling's uncommitted `openapi_docs.py` → "2 files already formatted" |
| 4c–4d | import-linter, root and 7 services | `97883c171` | 0 | 0 broken contracts |
| 5a | `export_openapi_schemas.sh --check` | `d989cf367` | 0 | 7 services; `schemas.json` up to date |
| 5b | `check_rpc_docs.py` | `d989cf367` | 0 | 587 subjects documented |
| 5c | gateway `go test ./...` | `97883c171` | 0 | 29 ok, 0 FAIL |
| 6a | `bun run typecheck` | `d989cf367` | 0 | clean |
| 6b | `bun run lint` | `d989cf367` | 0 | 0 errors, 46 warnings |
| 6c | `bun run lint:zones` | `d989cf367` | 1 | Z4: admin bundle → `notConfigured` |
| 6d | `vitest run` | `d989cf367` | 0 | 448 files, 3853 tests passed |
| 6e | `next build` | `d989cf367` | 0 | build complete |

The backend steps not re-run at the final HEAD (by ruling) predate only `fdcf49d34` (tournament-service) and the
description-only `d989cf367`; of the full tournament suite, only the upsert file ran after the guard. Baseline reds,
all P7's and none in a P8 file: balancer `test_admin_summary` hidden tournament (1); the stats `initial_active`
derived/native-isolation pair (2); app-service dev-DB route families `test_user.py` 70, `test_achievements.py` 21,
`test_statistics.py` 3, `test_user_impact.py` 1 (95). **The one remaining red** is 6c Z4 `notConfigured`, from the
owner's admin refactor `e899cb5a8`, not P8 (`node scripts/check-zone-boundaries.mjs --write-i18n` regenerates the
map); it is handed to the owner.

**Reported, not fixed** (not P8-originated; P9 or the owner):

* D-toggle: adding an identity that resolves to a member already in the mix removes them while the toast says
  "joined" (`frontend/src/app/balancer/mix/_components/AddPlayerIdentityPopover.tsx:68` toggles unconditionally).
* `/tournaments/analytics?discipline=lol` opens an Overwatch tournament: `AnalyticsClient.tsx` auto-selects the first
  analytics-capable tournament and never reads `?discipline=`.
* Hint-less awaiting-link logs are listed only on the workspace Logs page (`/admin/matches?view=logs`), not on the
  tournament's logs page.
* Mix self-join requires Discord and Battle.net links for LoL as for Overwatch
  (`balancer-service/src/services/account_links.py::REQUIRED_LINK_PROVIDERS`).
* UI observations O1–O12 of the browser evidence (focus after dialogs and the side pick, 390 px mix overflow, the
  unfiltered bind dialog, the raw `division_grid_required` toast on a LoL mix create, hard-coded RU rotation hints).

## 15. Deferred to P9

* Surgical single-position game invalidation and observation re-bind to a replacement game (section 6).
* F3 stat-enum-bound profile/compare/leaderboard reads; F5's Overwatch `player_role` leaf move.
* D99 manifest debt; the `has_pool` relaxation option for side-only presets.
* Analytics-process live coverage, quota assertions, `captain_identity`/`additional_handles` producers, mix-ingest
  binding.
* Restored-data rehearsal of the map 11 rewrite; the production rehearsal of this release.
* Handoff receipt: `.superpowers/sdd/2026-10-15-multi-game-p8-lol-scenarios-plan/p9-handoff.md`.
