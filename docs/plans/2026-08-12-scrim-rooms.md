# Scrim rooms — ad-hoc pre-game rooms outside a tournament — design

Design produced against the shipped generic pick-ban engine
(`2026-08-09-generic-pickban-engine.md`). Status: **design complete, pending
implementation.**

## 1. Understanding summary

**What.** Let two captains open a shareable, one-time pre-game room for a scrim:
map veto → hero bans → per-map score report → next map, the same loop the
tournament room already runs, but with no tournament, no bracket and no
organizer involved. The map pool is either **copied from an existing
tournament round** ("we play this round's maps") or **authored ad hoc** for
that room.

**Why.** The pre-game room is the most valuable thing the platform does for a
captain, and today it is reachable only from a tournament encounter. Teams
scrim far more often than they play officials, and currently do their veto by
hand in Discord.

**Who.** Captains (create a room, share a link, run the veto), their teams
(read-only spectators), the same captains later (review their own scrim
history), workspace admins (see everything, as today).

**Decisions taken with the organizer (2026-08-12):**

| Question | Decision | Rejected alternative |
|---|---|---|
| Who may be a captain | **Logged-in users only.** Creator claims home, the link's first taker claims away | Anonymous guests via two per-side tokens — needs a whole identity path parallel to `_resolve_captain_identity`, checked in `act`/`ready`/`undo`/`report`, plus a new attack surface |
| Room scope | **Whole pre-game loop** (map veto + hero bans + per-map reports) | Map veto only |
| History | **Kept forever, visible to participants only** | TTL deletion; a plain `Encounter` row (every player would see it) |

**Non-goals.** Scheduling/matchmaking ("find us an opponent"), scrim ladders or
ratings, log parsing for scrim matches, anonymous participation, editing a
room's pool once its session is live (the existing "a running session is never
silently rewritten" invariant carries over unchanged).

## 2. Grounded facts (verified against source, this session)

- `PregameRoom` takes **only** `encounterId` (`PregameRoom.tsx:55-57`) and
  derives everything else from `getEncounter` + `pick-ban/{kind}/state`. The
  room UI is reusable with zero changes.
- `PickBanSession.encounter_id` is **NOT NULL** (`shared/models/tournament/pick_ban.py:272`).
  `EncounterReadiness`, `EncounterPickBanLedger`, map reports and both realtime
  topics are all keyed on `encounter_id` too. `PickBanSession` alone has 18
  callers. Making it nullable is rejected: it buys nothing a container row does
  not, and costs an invariant ("a session always belongs to a match").
- `Encounter.tournament_id` and `Team.tournament_id` are NOT NULL
  (`encounter.py:78`, `team.py:48`). A scrim therefore needs a tournament row.
- `_resolve_config` (`pick_ban_session.py:113-141`) ranks configs
  round(2) > stage(1) > tournament(0). A **stage-scoped, round-less** config
  resolves at rank 1.
- `uq_pick_ban_config_level` is unique on `(tournament_id, kind, stage_id, round)`
  with `postgresql_nulls_not_distinct` (`pick_ban.py:114-122`) — a tournament-level
  config is **one per kind per tournament**. Per-room pools consequently need a
  distinct `stage_id`, not a shared tournament level.
- `Stage` requires only `tournament_id`, `name`, `stage_type`, `order`
  (`stage.py:44-65`). No `StageItem` rows are needed for an encounter to resolve
  a stage-level config.
- `Team` requires only `balancer_name`, `name`, `tournament_id`; `captain_id` is
  nullable and points at `players.user` (`team.py:36-49`). **No `Player` rows are
  required** — which is what keeps scrims out of every player-scoped aggregate
  (see §5).
- `PlayerLinkService` already provisions a `players.user` row for any auth user
  that lacks one (`identity-service/src/services/player_link_service.py:48-55`).
  So any logged-in user can be made a captain.
- `_resolve_captain_identity` (`encounter/captain.py:87-115`) resolves side purely
  from `auth_user → players.user → Team.captain_id`. Unchanged by this design.
- `Tournament.is_hidden` (`tournament.py:46-48`) already means: nested data is
  visible only to workspace admins and to auth users on `TournamentPreviewAccess`;
  everyone else gets **404**, and it is filtered out of listings
  (`shared/services/tournament_visibility.py`).
- Every tournament-scoped read routes through `assert_tournament_viewable`
  (`rpc/reads.py:78,98,108,191,204,217,228,277,295,308,320`;
  `rpc/public_rpc.py:235,304,321,370,…`). Cross-tournament encounter browse
  excludes hidden tournaments unconditionally, passing an anonymous viewer
  (`encounter/service.py:241-243`).
- `is_hidden` is already excluded from public statistics
  (`app-service/src/services/statistics/service.py:72,118,157`), dashboards
  (`dashboard/service.py:15,95,196`), tournament listings
  (`tournament-service/src/services/tournament/{service.py:184,224,252,…,flows.py:277}`)
  and the user profile's team list (`user/service.py:2907`).
- ⚠️ `is_hidden` is **NOT** filtered in `analytics-service`. Worse,
  `Tournament.id` is used there as an **ordinal season timeline**:
  `ml/training/splits.py:57-65` enumerates `Tournament.id <= cutoff ORDER BY id`
  as fold boundaries, `ml/training/backtest.py:352-354` takes
  `max(Tournament.id)` as "latest", and `analytics/service.py:250-253` filters
  `Encounter.tournament_id.between(start_range, end_range)`. **This is the fact
  that decides §4's container shape.**
- Per-map reports write `Match` rows with `source=CAPTAIN_REPORT`
  (`encounter/map_report.py:144`); the admin match surfaces already filter to
  `source == LOG_PARSER` (`services/admin/matches.py:80,247`), so scrim matches
  stay out of the log-ingestion views for free.
- `realtime_topics.map_veto(encounter_id)` / `pick_ban_hero(encounter_id)` are
  **public-subscribable** — spectators need no grant.

## 3. Assumptions (non-functional)

| Area | Assumption |
|---|---|
| Scale | Order of magnitude more rooms than tournament encounters, but each is one encounter's worth of rows. One extra `Stage` per room, one extra `Tournament` per workspace **ever**. |
| Performance | No new query class. The room polls exactly what the tournament room polls. |
| Security | No new permission model. Captain authority stays `Team.captain_id`; visibility stays `is_hidden` + `TournamentPreviewAccess`. |
| Maintenance | Zero changes to the pick-ban engine, the room UI, or the captain-identity resolver. The feature is a provisioning service plus two reads. |

## 4. Design

### 4.1 Container shape

One `Tournament(workspace_id, name="Scrims", is_hidden=True, status=LIVE)` per
workspace, created lazily on first room. **One per room is rejected**: §2's
ordinal-timeline facts mean every throwaway tournament would become an empty
ML fold boundary and shift `max(Tournament.id)`.

Per room, in one transaction:

```
Stage(tournament_id=scrims.id, name=<room label>, order=<next>)   # room isolation
PickBanConfig(tournament_id=scrims.id, kind=map,  stage_id=stage.id, round=None)
PickBanConfig(tournament_id=scrims.id, kind=hero, stage_id=stage.id, round=None)  # optional
Team(tournament_id=scrims.id, name=<home>, captain_id=<creator's players.user>)
Team(tournament_id=scrims.id, name=<away>, captain_id=NULL)       # claimed via link
Encounter(tournament_id=scrims.id, stage_id=stage.id, round=1, best_of=<n>, status=OPEN)
ScrimRoom(token, tournament_id, stage_id, encounter_id, created_by_auth_user_id)
TournamentPreviewAccess(tournament_id=scrims.id, auth_user_id=<creator>)
```

`ScrimRoom` exists for exactly two things a tournament row cannot answer: the
share token, and "list my scrims". Nothing else.

### 4.2 Joining

`GET /scrims/<token>` → room shell. A logged-in user who is neither captain
sees "claim the away side"; the claim sets `Team.captain_id` and appends a
`TournamentPreviewAccess` row. Idempotent, first-writer-wins on the away slot.
From that point on `_resolve_captain_identity` works verbatim, and readiness /
act / undo / report need no new code.

### 4.3 Map pool

Two sources, both writing the same stage-scoped `PickBanConfig`:

1. **Copy a round.** Selector tournament → stage → round, resolved through the
   existing cascade, then clone `items` / `slots` / `slot items` /
   `sequence_json` / `first_ban_rotation` / `no_repeat_scope` /
   `turn_timer_seconds` / `allow_protect` / `unique_attribute_per_side_per_round`.
   Row copying only. Source tournament must pass `assert_tournament_viewable`
   for the caller, so a hidden tournament's pool cannot be exfiltrated.
2. **Author ad hoc.** Reuse `PickBanConfigsTab`'s draft model
   (`pickBanConfig.helpers.ts`) and the existing server validators
   `validate_pick_ban_config` / `validate_pick_ban_slot_config`.

### 4.4 Visibility and history

No new column on `Encounter`. The container is `is_hidden`, so it never appears
in `/encounters`, public stats, dashboards or tournament pickers, and a finished
room stays readable indefinitely.

**Who may read it took a correction.** The original design used
`TournamentPreviewAccess`, granting the creator on create and the opponent on
claim. That cannot work, and shipped broken: `assert_tournament_viewable` admits
only workspace **admins** and allowlisted users, so the opponent following a
share link — a plain member, not yet allowlisted — got 404 on every read of the
room, and the row that would have added them is written by the claim they could
no longer reach. Teammates could not watch either.

So `assert_tournament_viewable` now admits any **member of the owning workspace**
to a **scrim container**, and the preview grants are gone: one rule instead of
two overlapping ones, and a member who leaves the workspace loses access instead
of keeping it through a stale allowlist row.

Deliberately narrow in two directions:

* Only the container. A hidden **preview** tournament is an unpublished real one,
  and admitting every member is what preview mode exists to prevent.
* Only the direct-read gate. `visible_tournaments_predicate` is untouched, so the
  container is readable by a member holding a link and never *listed* to one.
  (Workspace admins do see hidden rows in listings — pre-existing, and the only
  way an admin learns the container exists.)

This also closes a divergence: the realtime ACL already treated workspace
membership as the insider signal for spectating a hidden tournament
(`gateway/internal/acl/acl.go:allowSpectate`), so a member could receive a room's
realtime signal while the state read 404'd. The token is an address, not a
security boundary: any member of the workspace can reach any room.

"My scrims" is a dedicated read off `ScrimRoom` — **not** `/encounters?scope=my_team`,
which joins `Player` rows (scrim teams have none) and hard-excludes hidden
tournaments anyway (`encounter/service.py:243`).

### 4.5 Reporting

A scrim keeps **no result**. The series report — match codes, closeness, the
organizer's custom fields — is not shown at all: there is nothing to publish and
no organizer to read it, and the form is built from a per-tournament config the
container does not have.

The **per-map score stays**, and this is not an oversight.
`map_report.submit_map_report` is the only caller of `advance_to_next_round`, so
that score is the series' clock: without it a slot-mode room — which is what
"copy this round's maps" produces — stalls after map 1, and its hero rounds stall
with it. It is also the input to `first_ban_rotation`, which is
result-dependent in both real rulebooks ("the winner of the previous map opens").
A scoreless "map done" button would leave the engine nothing to rotate on, and a
copied pool would quietly play by different rules than the round it came from.

What is dropped is the bookkeeping around it: no `matches.match` row is written
for a scrim, so `match_id` comes back null. Everything the loop needs still
happens — the entry flips to `played`, the series score advances, the next round
opens.

## 5. Required exclusions — the real work beyond plumbing

The scrims container is a real tournament row, so anything that enumerates
tournaments without an `is_hidden` filter will see it. Two things learned while
implementing, both the hard way: an "it will be inert" expectation is worth
nothing until it has been executed, and `is_hidden` is the right predicate only
for **read** paths. On a **computation** path it is wrong — hidden preview
tournaments are real tournaments that do want standings, brackets and
achievements — so those use `shared/services/scrim_scope.py:is_scrim_container`
instead.

| Site | Effect if untouched | Fix |
|---|---|---|
| `ml/training/splits.py:57-65` | The scrims container becomes a data-less fold boundary | add `Tournament.is_hidden.is_(False)` |
| `ml/training/backtest.py:352-354` | `max(Tournament.id)` reports the scrims container as "latest" | same |
| `analytics/service.py:277-289` (`lookback_start_tournament_id`) | The container occupies one of the `look_back` slots while contributing no encounters, shrinking the OpenSkill history window — the very bug that helper was written to fix | same. **Not in the original audit**; found while implementing |
| `analytics/service.py:250-253` (`get_matches`) | ⚠️ **The "inert" expectation was wrong — verified this session.** This read pulls rosters via `joinedload` (an OUTER join, not the inner `Player` join the other aggregates use), so a scrim encounter returns with two real `Team` rows and empty `players`. `prepare_openskill_data` (`flows.py:282`) only skips NULL sides, so it reaches `pl.rate([[], []])` → `ValueError: Argument 'teams' must have at least 1 player per team, not 0`. That is a hard crash in `compute_openskill_shift_map` and `ml/features/opponent_strength.py` for every tournament whose lookback window spans the container id. Secondary crash on the same path: `AnalyticsMatch.time` is a required datetime read from `Tournament.start_date`, which a lazily provisioned container lacks | same |
| the team-scoped CTEs (`:32,54,67,80,93,109`) | Scrim teams/encounters do enter the `player_matches_*` and `team_counts` CTEs | **Inert, verified** — the outer query inner-joins `Player` on `Team`, and scrim teams have no `Player` rows, so those CTE rows never join to anything. Pinned by `analytics-service/tests/test_hidden_tournament_exclusion.py`, which also proves the isolation rests *solely* on the absence of `Player` rows: give a scrim team one and the row leaks. A future scrim-roster feature therefore cannot rely on `is_hidden` here |
| achievements (`parser-service .../achievement/engine/`) | **Inert, verified by execution.** A completed scrim points `runner.run_evaluation` at the container (`serve.py:368-398` republishes `EncounterCompletedEvent` as `AchievementEvaluateEvent`), and none of the 124 production condition trees awards, removes or crashes on it: every one reaches its users either through an inner join on `Player` or through `MatchStatistics.user_id`, and a room has neither. `is_captain` is the sharp case — a scrim team *does* have `captain_id` set — and it is empty for the container while non-empty for a rostered tournament. Nothing is written: `results_created=0 results_removed=0`, and a pre-existing achievement on a real tournament survives, because a user-grain result key `(user, 0, 0)` never satisfies a tournament-scoped `EvaluationSlice`. The handful of trees that raise under the test's SQLite fixture raise *identically* for a fully rostered tournament — a dialect limit (compound `UNION` inside a JOIN), not the scrim shape. **But not free**: ~8 encounter-dependent rules, one full query each, plus an `EvaluationRun` audit row, per scrim result | **no filter added.** `is_hidden` is not consulted anywhere in the engine and must not be — the isolation rests *solely* on the absence of `Player` rows, and `parser-service/tests/test_scrim_achievement_isolation.py` proves it by giving a scrim team one `Player` row and watching its captain qualify. The waste is removed one step earlier instead: tournament-service no longer publishes the event for a scrim (row below). Also noted there: `conditions/streak.py:41-51` ranks every non-league tournament with `dense_rank() OVER (ORDER BY start_date NULLS LAST, id)` and *does* give the container a rank — harmless only because the container has no `start_date` and therefore sorts last, which the same test pins |
| the recalculation pipeline (`tournament-service .../tournament/events.py:enqueue_tournament_recalculation` → `computation/standings_worker.py`) | ⚠️ **Omitted from the original audit entirely, and "inert" is wrong here too — verified by execution.** Every captain report fires it at the container (`encounter/captain.py:374,385,409,433`), including the first one and every re-submit. `create_room` gives each room a `SINGLE_ELIMINATION` stage with the comment "the engine never reads a scrim stage's bracket semantics"; `standings/service.py:_build_elimination_stage_standings` does exactly that. With no `StageItem` seeds it falls through to `PLAYOFF_CALCULATORS[SINGLE_ELIMINATION](encounters)` and **invents standings**: `[(70, 40, 1, 1, 1, 0), (71, 40, 2, 2, 0, 1)]` — the two rosterless teams placed 1st and 2nd — plus `Stage.is_completed = True`. And because all rooms share one container, `recalculate_for_tournament` walks **every stage in the workspace**: three rooms → `standings after: 6`, `stages flipped is_completed: [(41, True), (42, True), (43, True)]`, three home teams each "ranked 1st" in one tournament. That is O(rooms-ever-created) work and a full delete+rewrite of every room's standings, on every report of any one of them, forever. No crash | **skip the enqueue, keyed on `EXISTS(ScrimRoom.tournament_id)`** (`shared/services/scrim_scope.py:is_scrim_container`), not on `is_hidden`: hidden **preview** tournaments are real tournaments whose organizer is watching standings and bracket fill in, and an `is_hidden` filter here would silently freeze both — pinned by `test_hidden_preview_tournament_still_enqueues_a_standings_job`. Container-level rather than `ScrimRoom.encounter_id`, because the recalculation is tournament-scoped: one room's result drags in all the others, and the container is created only by `_ensure_container` so it holds nothing else. Not enqueued rather than no-opped in the worker — a job created, delivered and discarded is a permanent per-report cost that looks like health. Same predicate also stops `_enqueue_encounter_completed`, which exists only to feed the (provably empty) achievement run. Pinned by `tournament-service/tests/test_scrim_recalculation_exclusion.py` |

## 6. Test list

1. Creating two rooms in one workspace creates **one** `Tournament` and two `Stage`s.
2. Each room's `_resolve_config` returns its **own** stage-scoped config (rank 1), never the sibling's.
3. Copy-from-round reproduces items, slots, reserves, sequence, rotation, timer and protect flags exactly.
4. Copying from a tournament the caller cannot view → 404.
5. An anonymous viewer and a logged-in non-participant both get 404 on the scrim encounter, its pick-ban state and its matches.
6. A participant still gets 200 on all three after the series is complete (history).
7. The scrim encounter never appears in `/encounters` for anyone, including a workspace admin.
8. Claiming the away side is idempotent and first-writer-wins.
9. Full loop on a scrim: readiness → map veto → hero bans → per-map report → next round appended.
10. A scrim contributes zero rows to player statistics, the dashboard and analytics performance aggregates.
11. ML tournament enumeration and `_latest_tournament_id` ignore the scrims container.
12. A completed scrim enqueues **no** standings job and publishes **no**
    `EncounterCompletedEvent`, while an ordinary tournament and a hidden
    **preview** tournament both still do
    (`tournament-service/tests/test_scrim_recalculation_exclusion.py`).
13. Handing `recalculate_for_tournament` a container with three rooms invents six
    `Standing` rows and flips three stages — the reproduction that makes item 12
    load-bearing rather than defensive (same file).
14. No production achievement condition awards a scrim captain, an evaluation run
    aimed at the container creates and removes nothing, and one `Player` row on a
    scrim team is enough to break that
    (`parser-service/tests/test_scrim_achievement_isolation.py`).
15. A room whose `best_of` exceeds the copied pool's slot count is **refused at
    create time**, naming both numbers, while a flat pool (which the engine
    clamps) and a fresh not-ready room are both accepted
    (`tournament-service/tests/test_scrim_pool_fit.py`). Copying was the gap: only
    the *custom* branch validated its payload, so a Bo5 room borrowing a 3-slot
    round reached the room screen "The pool does not cover this series — the
    organizer has to add the missing slots", naming a role a scrim has no one in
    and leaving no recovery but closing the room.
