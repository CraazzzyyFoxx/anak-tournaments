# Generic pick-ban engine for map veto and hero bans — design

Design produced through single-agent `brainstorming` with the organizer, directly against two real tournament rulebooks. Status: **design complete, pending `multi-agent-brainstorming` adversarial review** (Skeptic / Constraint Guardian / User Advocate + arbitration) before implementation — same process `2026-08-05-map-veto-slot-pools.md` went through for the sibling feature area this design replaces.

## 1. Understanding summary

**What.** Replace the existing, statically-precomputed map-veto engine (`MapVetoConfig` / `EncounterVetoSession` / `EncounterMapPool`, all in `backend/shared`) with a generic, organizer-configurable "pick-ban" engine that also powers a brand-new hero-ban feature, sharing one implementation. The engine models a *progressive* sequence of per-map rounds — each round's opening side can depend on the *result* of the previous map, which cannot be known in advance.

**Why.** Two real, currently-run tournament rulebooks (`2026-08-09` session transcripts, Docs 1 and 2) require ban phases that repeat once per map of the series (not once for the whole series), with the opening side of round 2+ determined by who won or lost the *previous* map — a rule the current engine cannot express, because it computes the entire ban/pick sequence once, at session creation, before any map has been played. The two documents also specify hero bans (a feature that does not exist in the codebase at all today) with rules — role-uniqueness per side per round, a "protect" action, cross-map memory of what was already banned — that differ between the two tournaments, proving these must be organizer config, not hardcoded behavior.

**Who.** Organizers (configure the pick-ban flow per tournament/stage, no code), captains (act through it — same experience as today's veto room, extended to heroes), spectators (read-only, via the bracket's map-pool modal and the public map page), developers (get one engine instead of re-implementing sessions/timers/admin/realtime per feature).

**Constraints.**
- Two services own related domains today: `tournament-service` (encounters, map veto) and `balancer-service` (player draft). The shared piece is a **library in `backend/shared`**, not a new microservice — `backend/shared` already hosts today's map-veto models, so this is a generalization of an existing pattern, not a new one.
- Map veto is rewritten onto the new engine immediately — no dual-running of old and new.
- No live, universal "this map was just played, X won" signal exists anywhere in the system today (see §2). This had to be designed, not just wired.
- `Match` (`backend/shared/models/matches/match.py`) currently encodes an invariant — "every row was written by the log parser" — that a whole admin surface (`AdminMatchesTab`/`AdminMatchRow`) depends on. Reusing it for manually-reported results (organizer's explicit choice, Decision 13) requires relaxing that invariant carefully, not silently.

**Non-goals.**
- A no-code visual workflow/DAG builder for arbitrary future flows (rejected as Approach C — YAGNI; the fixed vocabulary of primitives found in §4 covers both real rulebooks).
- Migrating the player-draft (`balancer-service`) domain logic (snake-pick allocation, role-shortage validation) onto the shared engine. Only its *orchestration shape* (session lifecycle, turn/timer, admin override, realtime) is the blueprint.
- Auto-pick on timer expiry for pick-ban steps (neither rulebook requires it; timer stays informational, as today).
- Renaming the existing map-veto API surface. Captains and the frontend already depend on it working.

## 2. Grounded facts (verified against source, this session)

- `backend/shared/models/tournament/encounter_map.py` already hosts `MapVetoConfig`/`MapVetoConfigSlot`/`EncounterMapPool`-adjacent models; `backend/tournament-service/src/services/encounter/{veto_session,map_veto}.py` hosts the RPC-facing orchestration. The shared/service split this design needs already exists for map veto — it is being widened, not invented.
- `get_current_step(sequence, pool)` (`map_veto.py:67`) derives the current step purely as `count(status != AVAILABLE)` indexed into `sequence` — no separate turn pointer is persisted. This arithmetic is unchanged by this design; only *how much of `sequence` exists yet* changes (grown incrementally instead of fully precomputed).
- `MapPoolEntryStatus.PLAYED` is **read** once, as a reset guard (`veto_session.py:815`, `sync_veto_session_after_team_change`), and **never written** anywhere in the codebase. Dead status.
- `Encounter.current_map_index` is written **only** through the admin manual encounter-edit form (`services/admin/encounter.py:216-218`) — not a live signal.
- The only existing result-reporting path, `CaptainReportSubmission` (`schemas/captain.py`), is submitted **once, by each captain independently, after the whole series has concluded** — confirmed by the rulebook itself (§6: "по завершению каждого матча"). There is no per-map, mid-series signal anywhere today.
- `set_encounter_result` (`services/encounter/captain.py:515`) is the **sole write path** for `Encounter.home_score`/`away_score`, gated by admin action (`match.update`), resolving the score from (in order) an explicit override, an adopted captain report, both reports agreeing, or the encounter's already-non-zero score. It also flips `result_status` to `CONFIRMED` and triggers bracket recalculation / Challonge push / completion events — side effects that must stay behind this same explicit gate, never behind a per-map click.
- `BracketView.tsx`'s `getMatchMeta` already computes `played = score.home + score.away` and uses it for `isLive`/time-label logic — i.e. the frontend already *expects* `Encounter.score` to grow during a live series. It never has, because nothing has ever written it incrementally. This design's per-map score increment is not scope creep; it completes a UI contract that has existed unfulfilled since that code was written.
- `Match` (`backend/shared/models/matches/match.py:22`): `time: Mapped[float]` and `log_name: Mapped[str]` are **NOT NULL** today (only `code` and `log_record_id` are nullable). `get_match_by_encounter_and_map(session, encounter_id, map_id, entities)` (`parser-service/services/encounter/service.py:201`) already exists and is already used by `MatchLogFlow.start()` as a find-or-update lookup — the exact upsert seam Decision 13 needs, already built for a different caller.
- `AdminMatchRow`'s own docstring: *"A parsed match is one played map, written by the log parser... Only `log_record` is optional. Everything else hangs off a NOT NULL foreign key."* Five concrete call sites assume `time`/`log_name` are always present (`EncounterMatch.tsx:100`, `/matches/[id]/page.tsx:98,105`, `ParsedMatchSheet.tsx:71,147`, `ParsedMatchesBrowser.tsx:121`, plus two backend serializers) — all identified and scoped in §5.6.
- Two independently-reviewed real rulebooks (Docs 1/2, same organizer, different tournaments) specify **different** hero-ban rules: Doc 2 has a "protect" action and lets the losing captain choose who bans first; Doc 1 has neither. This is the direct evidence that rules must be config, not code.

## 3. Assumptions (non-functional)

| Area | Assumption |
|---|---|
| Scale | Same order of magnitude as today's map veto: tens of tournaments, one active pick-ban session per encounter at a time. No new infra class needed. |
| Performance | No new query pattern class — same shape as today's veto room (a handful of `selectinload`d rows per poll), plus one ledger read per new round creation. |
| Reliability | A running pick-ban session is never silently rewritten by a config change (existing invariant, carried over). A disputed per-map result blocks the *next* round's creation, not the current one — captains keep their already-completed bans. |
| Security | No new permission model — `match.update` on the owning workspace gates admin act-for-side / reset / dispute resolution, matching today. |
| Maintenance | One engine, one test suite, two configs (`kind=map`, `kind=hero`) instead of two engines. `Match`'s relaxed invariant is contained by an explicit `source` column, not inferred from nullability. |
| Compatibility | Map-veto captain/admin API paths and response shapes stay as-is (`/encounters/{id}/map-pool/...`). Hero bans get a mirrored, new path (`/encounters/{id}/hero-pool/...`). Both call into the same shared engine functions parameterized by `kind`. |

## 4. The two rulebooks — concrete requirements driving the design

Both: **Groups (Swiss, Bo2) → Playoffs (double elimination, Bo3, grand final Bo5)**. Both: map bans per round of the series (3 candidates, 2 bans, 1 survivor — already `slots`-mode shaped), hero bans per map of the series (not once per series).

| Rule | Doc 1 | Doc 2 |
|---|---|---|
| Who opens round 2+ map bans | Winner of previous map | Winner of previous map |
| Who opens round 2+ hero bans | Loser bans second (fixed) | **Loser chooses** who opens (defaults to banning second) |
| Bans per side per hero round | 2 | 2 |
| Role uniqueness within one side's 2 bans | Required | Required |
| "Protect" action | **Absent** | **Present** — after a ban, that side names one hero immune from the opponent's next ban this round |
| Cross-map hero-ban memory | No hero re-banned by **anyone**, for the whole match | No hero re-banned by the **same team**; banning what the opponent already banned is allowed |
| Maps/stages exempt from bans | Yes (named tiebreaker maps, "без банов") | Yes |

This table is the acceptance criteria for §5: any design that cannot reproduce every cell, per-tournament, via config alone, does not satisfy the brief.

## 5. Design

### 5.1 Layering

`backend/shared` gains the pick-ban engine (models + pure sequence/validation functions), exactly where map-veto's models already live. `tournament-service` keeps owning the RPC/HTTP surface, realtime signal emission, and permission checks — thin, as today. No new service.

### 5.2 Core entities (all `backend/shared/models`)

- **`PickBanConfig`** (generalizes `MapVetoConfig`) — organizer config, same `(tournament_id, stage_id, round)` cascade. New: `kind: "map" | "hero"`; `first_ban_rotation` gains `result_winner_first` / `result_loser_first` / `result_loser_choice` alongside the existing `fixed` / `alternate`; step tokens gain `protect_first` / `protect_second`; new toggles `no_repeat_scope: "none" | "encounter" | "encounter_same_side"` and `unique_attribute_per_side_per_round: null | "role"`.
- **`PickBanSession`** (generalizes `EncounterVetoSession`) — one per `(encounter_id, kind)`. `resolved_sequence_json` and the matching `PickBanEntry` rows are no longer necessarily complete at creation: for a result-dependent rotation, each map's block of tokens + candidate entries is appended only once the *previous* map's winner is known. `get_current_step`'s arithmetic (`count(status != AVAILABLE)` indexed into `sequence`) is **unchanged** — this is deliberately the smallest possible change to a well-tested core.
- **`PickBanEntry`** (generalizes `EncounterMapPool`) — adds `protected` to the status enum (`available | banned | picked | protected | played`); `item_id` resolves against the map or hero catalog per the session's `kind`.
- **`EncounterPickBanLedger`** (new) — one row per `(encounter_id, kind, item_id, banned_by_side)`, written when a round's **bans** commit (protects are deliberately excluded — see §5.4's correction). The *next* round's candidate-pool builder reads it and excludes accordingly, per `no_repeat_scope`. This is a filter at pool-construction time, not a runtime re-check.
- **`EncounterMapReport`** (new, small) — one row per `(encounter_id, map_id, team_id)`: a captain's independent claim of that map's winner/score, mirroring the shape of the existing series-level `EncounterCaptainReport` but scoped to one map. Reconciled by a function that mirrors `set_encounter_result`'s logic (agree → resolve; disagree → `disputed`, admin resolves) but writes into a **`Match`** row instead of `Encounter`.
- **`Match`** gets a new `source: "log_parser" | "captain_report"` column and `time`/`log_name` become nullable (Decision 13). `get_match_by_encounter_and_map` is the upsert lookup both the log parser and the new per-map report path share — whichever arrives first creates the thin row; whichever arrives second fills in what it knows.

### 5.3 Round progression and `elect_opener`

Round 1 of a series resolves `first_side` exactly as today (`resolve_seeds`: bracket slot → standings → fallback home) — there is no previous result to depend on. Round 2+ resolution:

- `result_winner_first` / `result_loser_first`: read the previous map's `Match` row (found via `get_match_by_encounter_and_map`), compare `home_score`/`away_score`, resolve `first_side` immediately, append that round's tokens + entries to the session.
- `result_loser_choice`: the round is created with `first_side = null`, session sub-status `awaiting_choice`. A new action, **`elect_opener {first_side}`**, restricted to the losing side (or admin), resolves it — the only action beyond `ban`/`pick`/`protect`/`decider` this engine needs.

### 5.4 Validation

- **No-repeat**: enforced by *excluding* ledger-flagged items when a round's candidate pool is built — not a per-action runtime check. `no_repeat_scope=encounter` excludes globally (Doc 1); `encounter_same_side` excludes only what *that* side banned (Doc 2). The ledger is **ban memory only** — a `protect` is never written to it (see the correction below).
- **Role uniqueness**: on a `ban`/`protect` attempt, reject if the acting side already has a committed action *of the same kind* *this round* whose target shares the configured attribute (`role`) — same 400-on-violation shape `apply_veto_action` already uses for turn/side/availability checks.
- **Protect immunity**: a `protected` entry is excluded from valid `ban` targets until the round closes — same shape as today's `status != AVAILABLE` check.
- **Correction (post-implementation).** Bans and protects must **not** restrict each other: the two were originally counted into one history, so a side that banned a tank could not then protect a tank, and a protect written to the ledger removed its item from every later round exactly as a ban does. Fixed by scoping role uniqueness per action kind (`pick_ban_engine.committed_attributes`) and by keeping the ledger ban-only. Protection is therefore round-local; the only thing a protect restricts is the opponent's `ban` on that item, this round.

### 5.5 Per-map result → engine trigger (closes the dead-`PLAYED` gap)

Both captains submit an `EncounterMapReport` for the map just played (via the same UI flow that will show the next hero-ban round, so it reads as part of the same loop, not a separate errand). Agreement → `Match` row created/updated (`source=captain_report`), corresponding `PickBanEntry` flips to `played`, `Encounter.home_score`/`away_score` increments (this is the write `getMatchMeta` has been expecting), the map-veto **and** hero-ban `PickBanSession`s for the next map are advanced/created. Disagreement → `disputed`, same admin-resolution pattern as the existing series-level flow, nothing auto-advances until resolved. `Encounter.result_status` is **never** flipped to `confirmed` by this path — only the existing, explicit `set_encounter_result` does that, preserving every side effect gated behind it today (bracket advancement, Challonge push, recalculation).

### 5.6 `Match` relaxation — exact blast radius

Nullable `time`/`log_name` + new `source` column. Five call sites need a null-guard or a `source`-based branch: `EncounterMatch.tsx` (render a stats-free summary chip instead of the stats dialog when `source=captain_report`; hide the "open in new tab" link, since there is nothing to show), `/matches/[id]/page.tsx` (guard or redirect when no log), `ParsedMatchSheet.tsx`/`ParsedMatchesBrowser.tsx` (admin "parsed matches" list defaults to `source=log_parser`, preserving its original diagnostic purpose), two backend serializers (`admin_misc.py`, `services/admin/matches.py`) widen `time`/`log_name` to `Optional`.

### 5.7 Realtime, timers, admin

Topic generalizes `encounter:{id}:map-veto` → `encounter:{id}:pick-ban:{kind}`. Timer stays informational (no auto-pick, matching both rulebooks and today's behavior). Admin "act for side" generalizes to any action type including `elect_opener`. Reset gets two explicit scopes: reset current round (default, as today) vs. the rarer, confirmation-gated "clear this encounter's whole ledger."

### 5.8 API and frontend

Map-veto paths/shapes unchanged. New mirrored path for heroes. `VetoRoom`/`VetoMapGrid`/`VetoStepTimeline` (already extracted to `frontend/src/components/veto/` this session) generalize to render either `kind`; the bracket's `EncounterMapPoolModal` (already built) picks up hero rounds automatically once they exist. New UI: the per-map "who won" dual-confirmation step, and the `awaiting_choice` "you lost — pick who bans first" mini-dialog.

### 5.9 Migration

Backfill script `MapVetoConfig → PickBanConfig(kind=map)`, `EncounterVetoSession → PickBanSession`, `EncounterMapPool → PickBanEntry`, with row-count parity checks before dropping the old tables — real production history exists (verified live against tournament 78) and must not be silently discarded. Ship order: engine + map-veto rewrite first (validates the abstraction against a known-good, tested feature), verify prod parity, then hero bans as a purely additive config type on the same engine.

### 5.10 Testing

Port `test_veto_session.py` / `test_map_veto_state.py` to run against the generalized engine with `kind="map"` as the regression net. New engine-level tests: ledger exclusion (both scopes), role-uniqueness rejection, protect immunity, `elect_opener` transition, all three result-dependent rotation modes, the `EncounterMapReport` agree/disputed paths, and the `Match`-nullability call sites (§5.6) each get an explicit "no log" render/serialize test.

## 6. Decision log

| # | Decision | Alternatives considered | Why |
|---|---|---|---|
| 1 | Shared mechanism = orchestration harness only (session/turn/timer/admin/realtime), not domain logic | One universal "action" type covering both player-allocation and item-banning | Different validation needs; one table for both would be messy |
| 2 | Shared code lives in `backend/shared` as a library, not a new service | Dedicated `draft-service` owning all session types | Maps/heroes already live in `tournament-service`; nothing to split an RPC boundary around yet |
| 3 | Map veto rewritten onto the new engine immediately, not run in parallel | New engine only for hero bans; old veto untouched | Organizer wants one system now |
| 4 | Rounds created progressively (lazily, as the series is played), not fully precomputed at session start | Precompute the whole sequence upfront (today's behavior) | Round 2+'s opening side depends on the *result* of the previous map — unknowable in advance, confirmed by both rulebooks |
| 5 | The barrier between rounds is lifted automatically, by a confirmed map result | Manual "next round" admin button | Organizer chose automatic explicitly |
| 6 | Hero bans are fully authoritative (system validates turn order, roles, repeats, protect) | Passive log with no enforcement | Organizer: same trust level as map veto today |
| 7 | "Protect" is a 4th first-class engine action (`ban`/`pick`/`protect`/`decider`), config-toggleable | Hardcode protect only for heroes | Observed directly in Doc 2's real rules; needs to be generic for future reuse |
| 8 | No-repeat memory scope = the whole encounter, via `EncounterPickBanLedger`, with a "global" vs "same side" toggle | Memory scoped to one map/round only | Both rulebooks need cross-map memory, with different exact rules |
| 9 | A new per-map dual captain confirmation is required to trigger round progression | Manual admin advance; extend the existing timer to autopick | No existing signal (`PLAYED` dead, `current_map_index` admin-manual, `CaptainReportSubmission` is series-end-only) answers "map N just finished, who won" |
| 10 | Disagreement in the per-map confirmation → `disputed`, admin resolves | Auto-resolve via majority/logs | Mirrors the existing, already-trusted `EncounterResultStatus` pattern; no new reconciliation concept |
| 11 | Rejected a full visual workflow/DAG builder (Approach C) | — | Everything found fits the fixed primitive vocabulary in §4; YAGNI |
| 12 | Map-veto API paths/shapes stay as-is; heroes get a mirrored new path; one engine underneath | Rename everything to a generic path | Do not force unrelated churn onto an already-working, tested frontend |
| 13 | Per-map result is written into `Match` (new `source` column, nullable `time`/`log_name`), not a separate table | Store the winner directly on `PickBanSession`/a new round-result table | Organizer: fewer entities; `get_match_by_encounter_and_map` already provides the exact upsert seam. Blast radius (5 call sites) identified and scoped in §5.6 |

## 7. Open items for the review process

- Exact reconciliation precedence when `EncounterMapReport` (per-map) and the eventual end-of-series `CaptainReportSubmission` disagree on a map's outcome — needs the same kind of precedence rule `set_encounter_result` already has for its own sources, extended to include the per-map ledger.
- Whether `EncounterMapReport` needs its own realtime topic or rides the existing `pick-ban` one.
- Downgrade path if an organizer edits a `PickBanConfig` mid-series (today's map veto forbids rewriting a running session; same rule should extend, but the *ledger* — which now outlives a single session — needs its own explicit "does a config edit invalidate the ledger" answer.
- Exact permission boundary for `elect_opener` when the losing captain is unreachable (falls to admin "act for side" — same as every other stuck step today, but worth naming explicitly).

## 8. Next step

Hand this document + the Decision Log to `multi-agent-brainstorming` for Skeptic / Constraint Guardian / User Advocate review and arbitration before any implementation plan is written, matching the process the sibling `2026-08-05-map-veto-slot-pools.md` design went through.
