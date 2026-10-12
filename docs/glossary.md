# Glossary

Domain vocabulary used across the database, the RPC surface, and the UI. Terms are defined by
where they live in the system, not by how Overwatch uses them.

For the identity model in depth see [`users-identity.md`](./users-identity.md); for tables and
columns see [`database_erd.md`](./database_erd.md); for the Russian UI renderings of the
player-facing subset see [`../frontend/src/i18n/GLOSSARY.md`](../frontend/src/i18n/GLOSSARY.md).

## Tenancy and identity

| Term | Meaning |
| --- | --- |
| **Workspace** | The tenant root, `public.workspace`. An organizer's isolated world: branding, domain, members, tournaments, ranks, achievements. Nearly every business row carries `workspace_id`, directly or through `tournament` / `workspace_member`. |
| **Custom domain / subdomain** | How a request is resolved to a workspace. The host is matched against a workspace subdomain or a verified custom domain in `backend/shared/tenancy/hostnames.py`. |
| **Login account** | `auth.user` — credentials, sessions, OAuth connections, API keys. Owned by `identity-service`. |
| **Player** | `players.user` — the domain person: BattleTag, statistics, match history. Owned by `app-service`. Distinct from the login account and linked to it, at most 1:1, through `auth_user_id`. |
| **Virtual player** | A `players.user` whose `auth_user_id` is `NULL`: a person the platform knows from parsed match logs or a CSV import who has never signed in. Called a *shadow player* in some older code and documents. |
| **Workspace member** | `public.workspace_member`, unique per `workspace_id` + `player_id`. The anchor every workspace-scoped domain object hangs off: roster entries, registrations, drafts, achievements, ranks. |
| **RBAC** | Grant-only permission catalog plus workspace system roles, with a `user_permission_deny` overlay that can subtract. Bootstrapped from `backend/shared/rbac/`. |
| **Entitlement / subscription requirement** | A condition on registration or check-in — a Discord role or a Twitch subscription — evaluated by the admission layer before a player is allowed through. |

## Tournament structure

| Term | Meaning |
| --- | --- |
| **Tournament** | The top-level competitive event inside a workspace. Owns its lifecycle state machine, registration, stages, and standings. |
| **Phase** | Where a tournament is in its lifecycle: announcement, registration, check-in, draft, live, finished. Drives what the public page and the admin surfaces offer. A tournament starts announced — public and readable, with nothing to do until its registration window opens. |
| **Stage** | One competitive segment of a tournament — a group stage or a playoff. Not to be confused with *phase*, which is lifecycle, not competition. |
| **Stage item / stage item input** | The current bracket model: a stage decomposes into items (a group, a bracket round), and items declare their inputs. `group` is the legacy model kept for historical tournaments. |
| **Group stage / round-robin / Swiss** | Stage formats. Round-robin plays every pairing; Swiss pairs by current score for a fixed number of rounds. |
| **Bracket** | The elimination tree, single or double. |
| **Discipline** | The game a tournament, and every encounter under it, is played in: `catalog.discipline.code`, `overwatch` in V1. Copied onto each encounter from its owning tournament and never changed. Behaviour the code knows about a discipline (whether it has sides) lives in `backend/shared/disciplines/`. |
| **Encounter** | One meeting of N participants, `encounter.encounter` — the root of the game-neutral match layer. A best-of duel is an encounter with `slot_count = 2`, a lobby one with `slot_count = N`; there is no `format` column and no home or away side. Its bracket position (stage, stage item, round) lives in `tournament.bracket_encounter`, not on the encounter. |
| **Participation** | One team's seat in one encounter, `encounter.team`. Append-only: replacing the occupant writes a new row and sets the old one `active = false`; a retired row is never reactivated or deleted, so the games, claims and journal entries that point at it still answer "who played this". `team_id` is the source tournament team and goes `NULL` if that team is deleted; `name` is the snapshot that survives it. Written only by `shared/services/encounter/participants.py`. |
| **Slot** (encounter) | The numbered seat a participation occupies, `1..slot_count`. Slot numbers replace home/away. Not the roster slot or the map-veto slot defined under *Rosters, registration, balancing*. |
| **Participation roster** | `encounter.team_member`: the snapshot of who was on a participation — workspace member, display name, rank, substitute flag — with role codes per dimension in `team_member_role`. Taken when the seat is filled; later roster edits do not rewrite it. |
| **Scoring rule** | `encounter.scoring_rule`: the preset (`wins` or `points`), the organizer's score columns, placement points, and two formulas — `game_formula` pays one game, `end_formula` says when the encounter is over. A duel series is the `wins` preset; an FFA lobby is `points`. Evaluated only by `backend/shared/domain/encounter_scoring.py`, through the formula engine, never `eval`. |
| **Encounter link** | An explicit advancement edge: the team that finished in position *k* of one encounter fills a numbered slot of another, `tournament.encounter_link`. The bracket is these edges, not an implied tree shape. |
| **Encounter game** | One position in the series, `encounter.game`. Owns the map and the accepted result: `state` (`planned`, `awaiting_result`, `disputed`, `confirmed`, `cancelled`), `result_source` (`captain_agreement`, `admin`, `admin_log`) and a `result_version`. Each participation's numbers, side and replay code are a row of `encounter.game_team`. A cancelled game keeps its position as history and is never reactivated; replaying a position creates a new game. A game — not a `Match` — is the unit of result authority. |
| **Game claim** | One participation's claim about one game, `encounter.game_claim` plus one `game_claim_result` row per participation, at most one claim per game per claimant. Matching claims confirm the game with `result_source = captain_agreement`; conflicting claims put it in `disputed` for an admin. `basis_version` is the game's `result_version` the claim was made against, so a claim filed against a superseded result is stale. A claim against a confirmed game is rejected (`result_locked`); changing that result is the admin correction command, which requires a reason. |
| **Series report** | One participation's report of the whole encounter, `encounter.team_report` plus a `team_report_result` row per participation (score, placement, wins), with `games_played`, closeness and the organizer's custom fields. Once every live participation has reported and the reports agree, the encounter's result becomes a `series_claim`; reports that disagree put it in `disputed` for an admin. A late report never changes a confirmed result. |
| **Result source** | Whose result stands on an encounter, `encounter.result_source`: `games` (the aggregate of the confirmed games), `series_claim`, `admin`, or `import` (Challonge). `NULL` while no official result exists. Only `games` is overwritten by game changes or a rule recalculation; the other three are decisions and only a reopen removes them. |
| **Result version** | `encounter.result_version`: bumped by every result change, each of which runs in one transaction with the encounter row locked `FOR UPDATE` and writes exactly one `encounter.result_audit` row. Reports and claims carry the version they were based on. Written only by `shared/services/encounter/result.py`. |
| **Match** | The parsed-log record of one played map, `matches.match` — the carrier of statistics, not of the result. A match row comes from a parsed match log. It keeps `home_team_id` / `away_team_id` and `source`, `encounter_id`, `map_index` until the statistics rework (V4); everything outside `matches.*` speaks in slots. |
| **Standings** | The computed table for a stage: points, tiebreakers (Buchholz, head-to-head), placement. |
| **Seed / seeding** | A team's ordering going into a stage; also the input to first-ban rules in map veto. |

## Rosters, registration, balancing

| Term | Meaning |
| --- | --- |
| **Registration** | A player's or team's application to a tournament, with roles, top heroes, and status. Optionally imported from Google Sheets. |
| **Check-in** | Confirmation, inside a time window, that a registered participant will actually play. |
| **Roster** | The players assigned to a team. Each roster entry points at a `workspace_member`, not at a bare player. |
| **Roster shape** | How many slots a team has and which roles they ask for — e.g. `{tank: 1, damage: 2, support: 2}` or six flex slots. Resolved server-side in `backend/shared/domain/roster_shape.py` and sent to the client already resolved; `team_size` and `draft_rounds` are derived from it there and never recomputed on the client. |
| **Slot** | One position in a roster shape (a role slot or a flex slot). In map veto, a slot is instead one map of a series. |
| **Substitute** | A roster member who replaces another; substitution chains are rendered under the player they replace. |
| **Balancer** | The team-building solver: a multi-objective genetic search implemented in the native Rust `tournament_balancer` crate and driven by `balancer-service`. |
| **Mix lobby** | One of the (at most six) matches a pickup mix runs at once — `balancer.custom_game_lobby`, keyed `(custom_game_id, lobby_index)`. Owns that match's balance document, pager position, next map and `balanced_at`; the mix itself owns none of them. Rendered as «лобби A … F» in the Russian UI. Membership is derived from the lobby's selected variant, never stored; only the host's `lobby_pin` is. |
| **Draft** | The live alternative to the balancer: captains pick players in a snake order, server-authoritative clock, optimistic concurrency on `version`. |
| **Rank layer** | Where a player's rank number came from. A workspace has a shared canon; each ranking author additionally keeps their own book, and an author rank overrides canon for that author only. The two dictionaries are never merged. |
| **Mix ranker** | The host-selectable alternative to flat points per win (`user_config.rating_mode = ranker`): each member keeps, per role, a hidden OpenSkill rating next to the open rank, and recording a match moves every seat by its own amount. Idea and specification: [mixtura-ranker](https://github.com/mixtura-dev/mixtura-ranker) by Dmitriy (@dmelackov); implemented in `balancer-service/src/domain/mix_ranker.py`. |
| **Open / hidden / effective rating** | Mix ranker terms. *Open* — the rank in the host's book, set by people. *Hidden* — the statistical `(mu, sigma)` per workspace member and role, derived from the mix history. *Effective* — the open rating corrected towards the hidden one; what a ranker host's mixes are balanced on. |
| **Division** | A rank band. `division_grid` versions the SR ranges and maps between versions so ranks stay comparable across seasons. |

## Maps, heroes, statistics

| Term | Meaning |
| --- | --- |
| **Map pool** | The set of maps available to a stage or round. |
| **Map veto / pick-ban** | The pick and ban sequence that reduces a pool to the maps actually played, driven by a `map_veto_config`. |
| **Reserve map** | The map held back for a tie. |
| **Match log** | An Overwatch log file uploaded by an organizer or through the Discord bot, parsed by `parser-service` into matches, per-round statistics, kill feed, and assists. |
| **Playtime** | Time a player spent on a hero, reported as a share of the match. |
| **MVP impact** | The scoring model that ranks a player's contribution within a match; the basis of MVP achievements. |
| **Achievement** | A declarative rule (a JSON condition tree) evaluated against match data, plus a manual grant/revoke overlay. |
| **Rank snapshot** | A point-in-time Overwatch rank fetched from OverFast for a linked BattleTag; the series behind rank history. |

## Platform mechanics

| Term | Meaning |
| --- | --- |
| **Gateway** | The Go process at `gateway/`. The only thing in the system that speaks HTTP and WebSocket to the outside. |
| **RPC worker** | A Python FastStream service. It exposes no HTTP; the gateway calls it as `rpc.<service>.<method>` over RabbitMQ, request/reply, under an `x-deadline-ms` budget. |
| **Envelope** | The `{ok, data, error}` shape every RPC reply uses. |
| **Outbox** | `event_outbox`. A state change writes its domain event in the same transaction as the change; a sweeper drains the table and publishes, so an event can never be lost or emitted for a rolled-back write. |
| **Realtime topic** | A named channel a client can subscribe to over WebSocket — `tournament:{id}:bracket`, `encounter:{id}:map-veto`, and so on. Access is checked per topic. |
| **Replay** | Redelivery of missed realtime events after a reconnect, from `realtime.workspace_event`. Non-durable topics have no event row and therefore no replay. |
| **Response cache** | The gateway's in-process cache of anonymous public reads, 30 s TTL, invalidated by the workers over Redis pub/sub. |
