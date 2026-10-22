# Mix rooms, stage П0 — live matches, captains, away: release note

A mix lobby's match now has an explicit **start**: the host starts it on the lineup on screen, the lineup is frozen
while it is played, and the result (or a cancel) ends it. Every lineup team has a **captain** (a crown). A player can
step **away** and back. A mix with several lobbies gets an **overview** with one card per lobby and a **room** per lobby
at `/balancer/mix/<id>/lobby/<A-F>`, readable signed out and on a phone. Spec:
`docs/superpowers/specs/2026-10-21-mix-rooms-draft-bans-design.md` §5, §7.

Three migrations ship, in order after `defgrid01`: **`mixcapt01`**, **`mixlive01`**, **`mixaway01`**. They add columns
(with `mixlive01`'s foreign key and unique constraint) and one backfill UPDATE (`mixcapt01`: the captain's seat of every
tournament participation, one row each); run them, then deploy balancer-service, tournament-service (the participation
writer), the gateway (route table and regenerated `schemas.json`) and the frontend **from one SHA**. The previous
frontend's Record buttons stop working against the new balancer (they send `variant_index`, which the new body refuses,
and they never start a match), so the frontend must ship with it. A lineup on screen at deploy is **Ready**: start it,
then record its result.

## 1. What shipped

### 1.1 Start match, Record result, Cancel match

* **Start match** (`POST /api/v1/balancer/workspaces/{ws}/custom-games/{id}/match/start`, `rpc.balancer.custom.start_match`,
  body `{lobby_index}`, hosts only) opens the lobby's encounter: `custom_game_id`, 2 slots, Bo1, `open`, `started_at`,
  both participations with the roster snapshot of the lobby's shown option (captains flagged) and one game on the
  lobby's `next_map_id` (`awaiting_result`). `mix.lobby.live_encounter_id` points at it. When the lobby has both team
  voices, its seated players are then moved into them (as `voice_move`, after the commit; a Discord failure is logged
  and the match stays started). 409 `match_live` when a match is already on; 422 when the shown option is not two teams.
* **Record result** (`POST …/outcome`, `rpc.balancer.custom.record_outcome`) now takes `{lobby_index, outcome}` only —
  `variant_index` and `map_id` are gone (the lineup and map were fixed at Start). It completes the live encounter
  through `apply_result(source=host)` and writes `mix.round`/`mix.round_member` as before (points/ranker moves, hidden
  ratings, must-play redemption, busy members), with the seats read from the encounter's roster and the team names as
  they stand at Record. It clears the pointer and the next map. 409 `no_live_match` when nothing was started.
* **Cancel match** (`POST …/match/cancel`, `rpc.balancer.custom.cancel_match`) deletes the live encounter (game and
  rosters cascade) and clears the pointer; nothing is recorded, no rank, pin or map moves. 409 `no_live_match` when
  nothing was started.
* **Close mix** and cancelling a mix cancel every live match first. There is no automatic timeout.
* **One write at a time.** Every host write of a mix locks the mix row (`SELECT … FOR UPDATE` in `_writable`) and reads
  its lobbies after the lock, so two Starts of one lobby, a Start against a Close and a Start against a lineup write run
  one after the other: the second Start answers 409 `match_live` and leaves no extra encounter.
* History, leaderboard, rotation, ranker and undo still read `mix.round`, which only Record writes, so a live match is
  invisible to all of them.
* **Recording order.** A round's encounter is now created at Start, so rounds read in the order they were recorded
  (`encounter.confirmed_at`, then id): the history, undo (`newest_id_for_lobby`), rotation, the ranker replay and the
  leaderboard form. The history's `recorded_at` is the encounter's `confirmed_at`. The start (`created_at`) is what the
  stats' `played_at`, the leaderboard's period window and the list's `last_match_at` read.

### 1.2 The frozen lineup

While a lobby's match is live, these answer **409 `match_live`**: `swap_seats`, `set_variant_index`, `set_next_map`,
`set_captain`, `balance` of that lobby, `balance(scope="all")` while any lobby is live, and `set_lobby_count` dropping a
live lobby. `balance` refuses before it reads the pool, so a frozen lobby answers `match_live`, never `empty_lineup`;
`set_next_map` with a map the game does not have answers 404 first. Team names, roles, participation, pins, away and
the pool stay editable.

### 1.3 Captains

* The lineup document carries `variants[v].teams[t].captain_member_id`. A balance captains each team by its strongest
  seat at the rating the solver used (lower member id on a tie); a swap involving a captain re-captains both teams; a
  team keeps a captain who still sits in it. Lineups stored before this release are captained on read (the detail read
  works on a copy and writes nothing) and at Start.
* **Make captain**: `PUT …/captain`, `rpc.balancer.custom.set_captain`, body `{lobby_index, workspace_member_id}` (the
  lobby's shown option; 404 when it does not seat the player; 409 `match_live` while the match is live).
* `encounter.team_member.is_captain` (new, `mixcapt01`) is written by the participation writer for every owner: a mix
  match from its lineup, a tournament seat from `tournament.team.captain_id` when the seat is filled; a moved seat
  carries it. Existing tournament seats are backfilled from each team's current captain (approximate: a captain who
  changed since is not recovered). Nothing reads it yet (П1).
* The board draws the crown (lucide `Crown`, as on tournament team cards).

### 1.4 Away

* `mix.player.away` (new, `mixaway01`). The player sets and clears it with `PUT …/me/away`
  (`rpc.balancer.custom.self_away`, body `{away}`), gated like a role edit minus the host's switch (self policy
  `can_set_away` / `away_blocker`); a host with the player patch field `away`. It never clears itself.
* An away player is in no balance, lobby split or rotation queue, and applying rotation hints never moves them; the
  must-play mark is kept. A player already in a Ready lineup stays there with a badge, and Start asks before starting
  with them.
* Rotation neutrality reuses `mix.round_member.busy`: every round recorded while a member is away writes them as busy
  (a seat wins: an away player who played is recorded as seated), and rotation already skips busy rounds. Its other
  readers (the member merge, a one-off reconcile script, the busy CHECK) are unaffected; stats, leaderboard, history
  and Discord read seats, never `busy`.

### 1.5 Board and rooms

* The detail read's lobbies carry `state` (`idle` | `ready` | `live`, derived, never stored), `live_encounter_id` (also on
  the list read) and `live_started_at`. Roster rows carry `away`; the self seat carries `workspace_member_id`, `away` and
  `voice_url` (`https://discord.com/channels/<guild>/<channel>` of the player's own team voice, or `null`).
* `/balancer/mix/<id>`: with one lobby, its room; with several, one card per lobby (stage, one line — elapsed minutes,
  rating gap or seats short — and its action: Balance, Start match, Record ▾, Open room) plus Shuffle all lobbies, the
  **Waiting**, **Away** and **Bench** groups of the players no lobby seats, the history and the leaderboard. The lobby
  tabs are gone.
* `/balancer/mix/<id>/lobby/<A-F>`: the room — stage stepper with elapsed time, the teams with crowns and away badges,
  Ready controls (pager, Balance again, swap, Make captain, next map, Start match, Post to Discord), Live controls
  (Win team 1 / Draw / Win team 2, Cancel match), the player's own panel, and for hosts the pool (that lobby's rotation
  hints) and voices. A room's history lists its own lobby's matches; its map roll skips the maps played in any lobby.
  No chat yet: a room's chat arrives with the owner-aware encounter chat in П1.
* The player's panel on a phone: own team with **You**, the captain, the next map and the team voice (Ready); place in
  the one waiting line of the mix and every lobby's stage (Waiting); **I'm back** (Away).
* New messages (EN/RU): `mixes.room.*`. Removed: `mixes.lobbies.notRecorded`, `mixes.lobbies.notBalanced`.
* Docs: the organizer and player mix guides (ru, en) describe rooms, Start/Record/Cancel, captains, away and up to six
  lobbies; `docs/business-logic-inventory.md` and the balancer README record the lifecycle.

## 2. Wire changes

| Change | Kind |
| --- | --- |
| `POST …/outcome` body loses `variant_index`, `map_id` | **breaking** (old clients get 422) |
| `POST …/match/start`, `POST …/match/cancel`, `PUT …/captain`, `PUT …/me/away` | new |
| Lobby `state`, `live_encounter_id`, `live_started_at`; row `away`; seat `workspace_member_id`, `away`, `voice_url`; policy `can_set_away`, `away_blocker`; team `captain_member_id`; leaderboard form `recorded_at` | additive |
| Match history `recorded_at` is the result's time (`confirmed_at`), not the start | changed meaning |
| Player patch `away` | additive |
| 409 `match_live`, 409 `no_live_match` | new refusals |

## 3. Not in this release

The mix settings columns (`team_formation`, `hero_ban_preset`, `draft_pick_seconds`, `hero_fearless`), the opener and
its flip, readiness marks, the pick-ban room for mix encounters, the room's chat and `resolve_participant` (П1); the
captain draft (П2); Discord changes — card states, an Away button, captain DMs (П3); hero picks (П4).
