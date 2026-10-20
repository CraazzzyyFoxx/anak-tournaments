# Multi-game P8 League of Legends scenarios: release note

P8 makes League of Legends playable end to end on the machinery P1–P7 built: the LoL module declares its sides, its
minimal stat/event vocabulary and a side-selection preset; the pre-game room learns to require, protect and rebuild
sides; the Data Dragon map 11 gets its canonical code; a mix host can no longer admit an account holder; and an opt-in
live module drives both games through registration, balance/draft, mix, pre-game, ingest and reads on real processes.
The live journeys found two production defects (P8-D1, P8-D2); both are fixed here. **No database migration** ships with
P8; the alembic head stays `achievement06`.

Deploy backend services, the regenerated gateway schemas (`f6cc6d14d`) and the frontend from one SHA, as for P7. Local
evidence only (the P8 commits between `17acffe0f` and `8588e360e`, named per section below, plus this documentation, on
`develop`, not pushed). The production rehearsal is a P9 gate.

## 1. LoL declarations (`0a3a4cf20`)

* `shared/disciplines/lol`: `sides=("blue", "red")` (index 0 = blue, 1 = red: the `side_pick` wire index),
  `stat_defs` `kills` and `dragons` (integer, sum), `event_types` `kill`, and the lazy `pick_ban_presets`. App-service
  startup projects the vocabulary; there is no Alembic revision.
* Deliberately **not** declared: `balancer_role_settings` (roles weigh neutrally), native ranks/ladder, collector,
  ingestors/decoder, `derive_match`, achievement conditions, analytics. LoL metadata reports `catalog_sync` true and
  `native_rank_collection`, `native_ladder`, `achievement_conditions`, `analytics` false (asserted live).
* D99: `dragons` became a stat-code token; the module directories stay exempt, so no manifest entry was needed.

## 2. Side-selection preset (R1)

* `lol_side_selection` — "Side selection: higher seed, then previous loser". One phase, one `side_pick` step acted by
  the round's opener (`first`), 90 s timer, `random_fill` on timeout (the room picks a side at random), first-ban
  rotation `result_loser_first`: game 1 is opened by the higher seed (its bracket slot; slot 1 when unseedable), every
  later game by the previous game's loser.
* **Side selection only**: not a champion draft and not Fearless (D98 narrowed, amendment A14). The wire kind stays
  `hero` (persisted identifier); the catalog kind is `character`.
* **The organizer still saves a champion pool** (non-empty, active LoL champions): `has_pool` was not relaxed. The side
  step consumes none, and the captain room hides the champion grid on a side step.
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

## 11. Frontend (`5768a99ae`, `deba0892e`, `e512cfd02`, `1c2bc27a8`, `6e1b196fb`, `17bbcf236`, `fb306a81a`)

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

## 12. Defects the live journeys found, fixed in P8

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

## 13. Gates

D99 manifest `419fa00ff`: the owner's admin refactor (`e899cb5a8`) added Overwatch role literals in
`components/admin/people/PersonGlance.tsx`; the three rows are registered as collector-wire debt and the stale
`PregameRoomsBrowser.tsx` `hero` entry is dropped (315 → 317 exceptions; the owner's later `963536452` leaves 314).
Wire schemas regenerated once (`f6cc6d14d`, description-only: side-selection error prose).

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
unsupported; cross-workspace denials. The browser pass and the final sequential matrix are recorded by the controller
in the workspace (`task5-controller-checklist.md`).

Not claimed: an analytics HTTP refusal (no analytics process in this stack), quota spend, `captain_identity` /
`additional_handles` (no producer) and mix-ingest binding (no path).

## 15. Deferred to P9

* Surgical single-position game invalidation and observation re-bind to a replacement game (section 6).
* F3 stat-enum-bound profile/compare/leaderboard reads; F5's Overwatch `player_role` leaf move.
* D99 manifest debt; the `has_pool` relaxation option for side-only presets.
* Analytics-process live coverage, quota assertions, `captain_identity`/`additional_handles` producers, mix-ingest
  binding.
* Restored-data rehearsal of the map 11 rewrite; the production rehearsal of this release.
* Handoff receipt: `.superpowers/sdd/2026-10-15-multi-game-p8-lol-scenarios-plan/p9-handoff.md`.
