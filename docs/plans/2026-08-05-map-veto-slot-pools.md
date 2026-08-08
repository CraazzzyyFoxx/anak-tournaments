# Slot-based map pools for map veto — design, revision 5 (arbitrated)

Design produced through the `brainstorming` + `multi-agent-brainstorming` process: single-agent design, then sequential Skeptic / Constraint Guardian / User Advocate review, then arbitration. 26 reviewer objections, all accepted; 8 arbitration items, all applied. Branch `develop`. Status: **arbitrated and unblocked.** Disposition was REVISE; all 8 arbitration items applied, and Decision 3 — the last open input — was closed by the organizer on 2026-08-05 in favour of a configurable `first_ban_rotation`. Implementation plan: `docs/plans/2026-08-05-map-veto-slot-pools-plan.md`.

**Revision 5 changelog (arbitration).** Disposition REVISE with 8 finite items; all applied. Decision 19's flat projection is **withdrawn** — it converts a visibly dead room into a plausible flat veto over every slot's candidates, hiding partial-rollout damage rather than containing it, and its `_map_veto_signature` benefit was void because both partitions share the same union. `map_ids` and `sequence` must be `[]` on a slot-mode upsert. §4.7's 409 rationale corrected (the `None`/`int` comparison cannot occur; the real failure is NULL-slot rows stalling the step counter forever). The claim that chips and in-card filters cover the deferred read-back's error class is struck, and the deferral is reclassified as an accepted risk with an owner and a trigger. The stage-scope trap gets a specific string key. Delivery is staged in two by audience (§3a). §6 deduplicated. Three of four spot-checked dispositions were UPHELD against source: Decision 16/§4.3, §4.2's guarded `current_slot`, and Decision 9's reversal to approach B.

**Revision 4 changelog.** The User Advocate returned 1 BLOCKER and 9 MAJOR findings; all accepted, one item deliberately deferred. Material changes: the mode control is no longer a third item in "veto step order" but a separate "map pool shape" choice, because slots change what the pool *is*, not the order of steps (finding 4); the slot editor gains the existing gamemode filter and select-visible action *inside each slot card* plus per-slot composition chips and a normalized name filter, which is what makes ~100 transcribed selections verifiable (findings 2, 3); the public page must reach negative rounds too — revision 3 fixed only the admin UI, leaving all four LB configs publicly invisible (finding 7e); slot survivors need a slot-mode status word because every one of them is a decider (finding 6); refusals get client-side validation and actionable copy (finding 8); mobile behaviour is specified (finding 9); glossary rows are a prerequisite and "rotation" must not be translated as a noun (finding 10). Sections 4.4, 4.5, 4.6, 4.7 and Decisions 23-30 changed. See §6.

**Revision 3 changelog.** The Constraint Guardian returned 4 REJECT and 3 CLARIFY findings; all accepted. Material changes: `mode` is now a REQUIRED upsert field (an omitting client gets 422 rather than silently destroying a slot config); slot reserves are snapshotted onto the session as `slot_reserves_json` because `build_map_pool_state` never sees a config; the downgrade migration must cancel slot-mode sessions; `map_veto_config_map` now carries a deliberate flat projection of slot candidates for partial-rollout safety; the edit inventory grew by 8 `selectinload(map_pool)` sites plus one `session.refresh` across two services; enum migration mechanics and a candidate-count re-check at session creation are pinned. Sections 3, 4.1, 4.2, 4.5, 4.7, 4.8 and Decisions 17-21 changed. See §6.

**Revision 2 changelog.** The Skeptic review found two FATAL factual errors and ten further objections; all were accepted. The material change is that **Decision 9 reversed from approach A (columns on existing tables) to approach B (dedicated slot tables)**, because A's true cost — constraint swap, partial index, a `role` enum, and a config-validator change — exceeded B's, and A modified the working flat mode while B leaves it untouched. Sections 4.1, 4.2, 4.3, 4.4, 4.7, 4.8 and Decisions 3, 7, 9, 11, 14 changed. Reviewer objections and dispositions are recorded in §6.

## 1. Understanding summary

**What.** A second map-veto mode ("slots") where a config describes an *ordered list of slots*, each slot holding candidate maps plus an optional reserve map. The number of slots equals the match's `best_of`. Within a slot, teams alternately ban until one map survives; that map is played. The existing flat-pool mode stays untouched.

**Why.** The organizer's ruleset specifies a *different candidate pool per map in the series*. The model stores one flat pool per config and `pick`/`decider` draws from all remaining maps, so today Round 1 can only be expressed as 6 maps in one pool with nothing preventing two Push maps and zero Hybrid.

**Who.** Organizers (configuration), captains (veto room), spectators (public map page).

**Constraints.**
- Flat mode remains as-is.
- Series length belongs to the bracket (`Encounter.best_of`, commit `4e8e1dce`). Slot mode consumes it; slots = `best_of`.
- `get_current_step` derives its index as `count(status != AVAILABLE)`.
- `EncounterMapPool.order` is dual-purpose (pool order, then play order); a slot number needs its own column.
- No regression to: config cascade, seed snapshot, realtime topic, session reset, the public page's honest states.

**Non-goals.** Hero bans. Server-side randomness. Series-level draws. Rewriting flat mode. Slots with a single candidate (see Decision 15).

## 2. Grounded facts (verified against source)

Tournament 78 encounter rounds, from the live API:

```
stage 188 (Groups, swiss)          round  1..5  bo2   10 encounters each
stage 189 (Playoffs, double_elim)  round  1     bo3   2   -> "Раунд 1"
                                   round  2     bo3   1   -> "Полуфиналы"
                                   round  3     bo5   1   -> "Финал" (grand final)
                                   round -1..-4 bo3   2,2,1,1 -> LB rounds 1..4
```

- LB rounds use negative `round` (`services/admin/stage.py:826`). The cascade has no sign constraint; only the admin UI (`1..max_rounds`) cannot reach them.
- The grand final is UB round 3; `best_of.final = 5` already resolves to it.
- The ruleset maps onto existing `(stage_id, round)` keys 1:1 — 12 configs, no new cascade level.
- `validate_veto_config` (`veto_session.py:56-59`) allows **at most one** decider and requires it **last**; it also rejects duplicate `map_ids` (`:64-65`). Both are pinned by `test_veto_session.py:171-193`.
- `auto_complete_decider_entry` (`map_veto.py:129`) requires **globally** exactly one AVAILABLE map; `auto_complete_decider` resolves **one** entry per call.
- `build_map_pool_state` (`map_veto.py:193`) grants `allowed_actions` only when `expected_action in {"pick","ban"}`, so no captain can act on a decider step.
- `apply_veto_action` (`:306`) looks the entry up by `map_id` alone.
- `MapPoolEntryStatus.PLAYED` is **never written** anywhere; it is read once as a reset guard (`veto_session.py:459`), making that guard dead. No transition ever returns an entry to AVAILABLE, so `count(status != AVAILABLE)` is monotonic.
- `admin_veto_act` routes through the same `apply_veto_action`, so an admin cannot force an out-of-order action.
- `VetoConfigUpsert` (`veto_admin.py:36-43`) carries `map_ids: list[int]` and a required `sequence: list[str]`; no `mode`. `serialize_veto_config` returns only `map_ids`.
- `effective_sequence(config, best_of, pool_size)` receives a scalar pool size, never per-slot counts.
- `_map_veto_signature` reduces a config to `(sequence, map_ids)` and exists in **two** services (`tournament-service/.../stage.py:213`, `parser-service/.../stage.py:179`).
- `initialize_map_pool` (`map_veto.py:45`) is reachable at any time via `admin_misc.py:172`, adds rows without deleting existing ones, and sets no slot.
- Frontend `parseStageBestOf` guards round keys with `/^\d+$/` (`best-of.ts:82`), silently dropping negative keys the backend accepts. **Bug introduced in commit `4e8e1dce`.**
- Admin `BracketFormat` (`TournamentMapVetoTab.tsx:99-109`) is discriminated by `scope`, not `kind`, and returns a concrete `bestOf` at tournament scope. The public page's `kind: resolved|varies|unknown` is a different type.
- `report_form.py:189-190`: `played = home_score + away_score` only *slices* `available_map_indices` to decide how many offered slots are mandatory. Extra offered slots do not become required.
- Competitive catalogue: 31 maps. `Neon Junction` absent (organizer will add). Ruleset spelling: `Antarctic Peninsular`, `Shambali`, `Paraiso`, and `King’s Row` uses U+2019.

## 3. Assumptions (non-functional)

| Area | Assumption |
|---|---|
| Scale | ~13 configs per tournament; up to 15 candidate maps per config. Tens of tournaments. |
| Performance | No added queries in the veto room; slots load via `selectinload`. Admin tab gains one cached encounters query. |
| Reliability | A running veto is never rewritten by a config change. Mode changes apply only on explicit session reset. |
| Security | No new permissions; `match.update` on the workspace. |
| Maintenance | **Revised twice:** the *engine's* mode split is one derivation (`current_slot`), but the *feature* touches ~20 sites. Critically, `MapVetoConfig.map_pool` is eager-loaded at **8** `selectinload` sites plus one `session.refresh`, across **two** independently deployed services (`veto_admin.py:73,113,144`, `reads.py:291`, `veto_session.py:183`, `tournament-service/.../stage.py:235,250`, `parser-service/.../stage.py:201,216`). Every one must also load the slot relations or a lazy access raises `MissingGreenlet` (a 500, not a wrong answer). |
| Compatibility | Flat mode's tables and code paths are untouched. New tables are additive; no data migration. |

## 3a. Delivery staging (arbitration ruling)

The inventory is too large for one change, but a horizontal slice delivers nothing usable — the organizer cannot configure the regulation until slots work end to end. The valid seam is **vertical, by audience**.

**Stage one — organizer and captain.** §4.1 schema in full, including Decision 20's downgrade cancellation (schema lands once, not twice). §4.2 engine in full: both `_map_veto_signature` copies, all 8 eager-load sites plus the `session.refresh`, the `initialize_map_pool` 409. §4.3 with Decision 3 resolved. §4.4 in full — slot cards, the `scope`-based gate, Decision 23's separated pool-shape control with draft preservation, Decisions 24-26 and 28, and the `parseStageBestOf` negative-key fix. §4.5's **veto-room half** in full, including Decision 22 (the BLOCKER), Decision 27 and the narrow-screen requirements. Decision 30's glossary rows. Tests 1-13.

Decisions 24-25 are **not** deferrable out of stage one: they are what makes the organizer verdict defensible.

**Hard condition on stage one.** While the public page is still slot-unaware it must state that the pool is not shown for this round, rather than render a slot config as a flat pool. That is §4.5's own honesty standard applied to the intermediate state, not a new requirement.

**Stage two — spectator.** §4.5's public-page half: slot rendering, the four honesty corrections, and Decision 29's negative rounds.

Backend-before-admin-UI (risk 5) is a deploy-ordering constraint *inside* stage one, not a stage boundary.

## 4. Design

### 4.1 Schema — additive tables only

```
map_veto_config
  + mode               enum(pool, slots)       NOT NULL server_default 'pool'
  + first_ban_rotation enum(fixed, alternate)  NOT NULL server_default 'fixed'   -- see Decision 3, open

map_veto_config_slot
    id, map_veto_config_id FK ON DELETE CASCADE
    position         int  NOT NULL            -- 1..N, play order
    reserve_map_id   FK overwatch.map NULL ON DELETE SET NULL
    UNIQUE (map_veto_config_id, position)

map_veto_config_slot_map
    id, map_veto_config_slot_id FK ON DELETE CASCADE
    map_id           FK overwatch.map ON DELETE CASCADE
    sort_order       int NOT NULL
    UNIQUE (map_veto_config_slot_id, map_id)

encounter_map_pool
  + slot  int  NULL                            -- copied from the config slot's position
```

```
encounter_veto_session
  + slot_reserves_json  JSON NULL                -- snapshot {slot_position: map_id}
```

`map_veto_config_map` keeps its schema, its `UNIQUE (config_id, map_id)`, and its flat-mode code path byte for byte. A map may appear in several slots naturally (different `slot_id`); no constraint relaxation, no `role` enum, no partial index.

**No flat projection.** In slot mode `map_veto_config_map` stays **empty**, and `map_ids` must be sent as `[]` on a slot-mode upsert (any other value is a 422). Revision 3 proposed mirroring the union of slot candidates there for partial-rollout safety; arbitration struck it. The projection does not contain the damage, it hides it: an un-upgraded `ensure_veto_session` would read `pool_size = |union|` and build a *plausible flat veto over every slot's candidates* that captains can act on, yielding a legitimate-looking wrong map list, where an empty pool instead produces a visibly dead room. Neither state self-heals (`ensure_veto_session` returns the existing session forever); both need an admin reset. The projection therefore converts a loud failure into a quiet one, and buys no recoverability. Old code cannot be taught to check `mode`, so **deploy ordering is the only lever**: both backend services first, then the admin UI (risk 5).

CHECKs: `mode = 'slots'` forbids `preset = 'custom'`; `position >= 1`.

**Migration mechanics**, following `mapveto0001_add_veto_session_and_config_levels.py` exactly:
- `upgrade()` issues raw `CREATE TYPE tournament.<name> AS ENUM (...)` before any column referencing it.
- Columns declare `postgresql.ENUM(name=..., schema="tournament", create_type=False)`; alembic must not try to own the type.
- Model columns declare `values_callable=lambda e: [x.value for x in e]`, as every enum in `encounter_map.py` does. Without it SQLAlchemy binds member *names*, and every insert fails.
- `downgrade()` drops the columns and tables, then `DROP TYPE IF EXISTS`, **and cancels slot-mode veto sessions** (see 4.7).
- `map_id` FKs use `ON DELETE CASCADE` to match `map_veto_config_map`, with the consequence handled in 4.7.

### 4.2 Engine

`get_current_step` and the `resolved_sequence_json` shape are unchanged. Its arithmetic invariant holds: every slot-mode step consumes exactly one pool entry, status transitions are monotonic away from AVAILABLE, and `admin_veto_act` shares `apply_veto_action`'s validation.

The slot is derived, and **only while a step is pending**:

```python
def current_slot(pool) -> int | None:
    slots = [e.slot for e in pool if e.status == MapPoolEntryStatus.AVAILABLE and e.slot is not None]
    return min(slots) if slots else None
```

`None` means flat mode *or* a completed slot-mode veto — both cases skip slot validation. This is the corrected form; revision 1 stated an unguarded `min()` that raised on every finished match.

Edits, honestly counted:

| Site | Change |
|---|---|
| `auto_complete_decider_entry` | scope "exactly one available" to `current_slot` |
| `apply_veto_action` | validate the entry belongs to `current_slot`; key the lookup on `(map_id, slot)` |
| `build_map_pool_state` | expose `current_slot` |
| `validate_veto_config` | dispatch on mode; slot mode validates slots, not a sequence |
| `effective_sequence` | accept per-slot candidate counts, not a scalar pool size |
| `ensure_veto_session` | copy slot onto pool rows; slot-count reconciliation; new refusal reason |
| `serialize_veto_config` | emit slots |
| `VetoConfigUpsert` | nested `slots`; `mode` **required, no default**; `map_ids` must be `[]` in slot mode and `sequence` must be `[]` (any other value is 422); clears the other mode's rows in the same transaction |
| 8x `selectinload(map_pool)` + 1 `session.refresh` | must also load slot relations, or `MissingGreenlet` 500 |
| `_map_veto_signature` x2 | include mode, slot structure and reserves |
| `initialize_map_pool` route | 409 when a slot-mode session exists |
| frontend service + types | slot shapes |
| admin editor, public page, veto room | see 4.4, 4.5 |

`entry.order = count(PICKED)` is unchanged; slot `i`'s survivor gets `order = i`, so `series_map_indices` and `pickedMapsInOrder` need no change (Skeptic-confirmed).

### 4.3 Sequence generation (slot mode)

For slot `i` with `c_i >= 2` candidates: `(c_i - 1)` alternating ban tokens, then one `decider`.

- `fixed`: every slot opens with `first` (higher seed).
- `alternate`: slot `i` opens with `first` when `i` is odd.

Rotation is baked into tokens by the generator; the engine reads resolved tokens.

`sum(c_i)` steps = pool size. The session's sequence therefore carries **one decider per slot, mid-sequence** — which is why `validate_veto_config` must not be applied to it. That validator guards *config upserts*; slot configs submit slots, not a sequence, and `veto_sequence_json` stores `[]` for them.

`c_i >= 2` is enforced: a one-candidate slot would emit back-to-back deciders, and `auto_complete_decider` resolves only one per call while no captain may act on a decider step — the veto would stall. The ruleset never needs it (Decision 15).

Session-creation invariant: `len(sequence) == len(pool)`, and every pool row carries a slot.

### 4.4 Admin UI

**Two controls, not one three-way group.** Slot mode changes what the pool *is*; it is not a third kind of step order. Presenting it inside "Veto step order" would also contradict the §4.1 CHECK, since slots cannot coexist with a custom order.

- **Map pool shape** (new, above the pool grid): "one pool for the match" / "a different pool per map in the series".
- **Veto step order** (existing two options, flat branch only): follow the bracket / author it myself.

Switching pool shape must preserve the slot draft, exactly as the form already preserves a hand-authored sequence across an order-mode toggle (`TournamentMapVetoTab.tsx:230-241`). Otherwise one mis-click discards up to 15 selections with no undo.

Slot mode is offered only when the scope resolves to a single `best_of`. The gate must be written against the admin type's `scope` discriminator — `scope === "round"`, or `scope === "stage"` with `perRound === null && finalBestOf === null`. It must **not** test "is `bestOf` a number", because `{ scope: "tournament" }` carries a concrete `DEFAULT_BEST_OF` and would wrongly pass.

Slot editor: N slot cards, N derived from the bracket and not editable. Each: ordered candidates (>= 2) from the gamemode-grouped catalogue grid, plus an optional reserve map. When the round's current `best_of` differs from the configured slot count, the editor warns and names both numbers.

**Transcription affordances — the difference between usable and not.** The regulation is 12 configs of 2-5 slots of ~3 maps, ~100 selections made by eye against paper. Three affordances, all reusing machinery the tab already has:
- The gamemode filter (`:546-580`) and select-visible action (`:297-307`) move *inside each slot card*. Every group-round slot is gamemode-homogeneous, so "filter to Control, select 3" is two gestures instead of six clicks — and a cross-mode mistake becomes structurally impossible rather than merely visible.
- Per-slot composition chips via the existing `mapVeto.filterOption` ("Slot 1: Control (3)"), as the public page already renders (`TournamentMapsPage.tsx:415-428`). A stray Push map is then visible without counting tiles.
- A name filter above the tile grid, matching on a normalized comparison: case-folded, diacritics stripped, U+2019 folded to U+0027. The four regulation spellings are near-misses (`Peninsular`/`Peninsula`, `Shambali`/`Shambali Monastery`, `Paraiso`/`Paraíso`, `King’s`/`King's`), so eye-scanning 31 tiles lands confidently on the wrong map and nothing downstream contradicts it.

**Deferred as an accepted risk, not as YAGNI.** A single read-only overview of all 12 configs, for line-by-line read-back against the regulation, is not built. The chips and in-card filter do **not** cover its error class: they make each selection easier to make correctly and make a within-slot composition error visible, but nothing verifies what was actually *saved*, across configs, against paper. Only a read-back catches "slot 3 of Round 4 received Round 5's maps" or "Round 2 was never saved at all" — the errors that survive careful per-slot entry. The acceptance is reasonable because `admin_veto_config_list` (`veto_admin.py:66-80`) already returns every config for the tournament in one call, so the overview is a pure frontend render over data already on the client: cheap to omit now, cheap to add later. Owner: the organizer. Trigger to build it: the first transcription error found in production.

**Gate failure must be visible.** When the scope does not resolve to a single `best_of`, render the option *disabled with its reason*, as the tab already does for `mapVetoAdmin.formatUnknownScope` (`:473-477`), never absent. Stage 189 runs bo3/bo3/bo5 plus four LB rounds, so whole-stage scope drops the option exactly where slots are needed most — it must say the rounds play different lengths, choose one round. The opposite trap gets a specific string, not a note: at stage scope with slot mode selected, a new key `mapVetoAdmin.slotsStageScopeWarning` renders next to the slot editor — EN "These slots apply to all {count} rounds of this stage. A regulation with a different pool per round needs one config per round."; RU with full ICU plurals. It is a warning, not a block: a stage-wide slot config is legitimate when every round genuinely shares a pool.

Negative rounds: round numbers come from existing encounters, grouped "Upper bracket" (positive) / "Lower bracket" (negative, DE only), plus planned rounds from `max_rounds` marked as not generated.

Prerequisite fix, shipped separately: `parseStageBestOf` must accept negative round keys (`/^-?\d+$/`), or an LB `by_round` override silently diverges from the server.

### 4.5 Public page and veto room

Types grow `EncounterMapPoolState.current_slot: number | null` and `EncounterMapPoolEntry.slot: number | null`.

**Veto room.** Grid grouped by slot in play order; current slot highlighted, resolved slots dimmed showing their survivor, future slots collapsed. Only the current slot's maps are clickable. The reserve is *labelled* ("reserve on a draw"), never activated — the platform does not know a map drew. The label reads from the session's `slot_reserves_json` snapshot, not from the config: `build_map_pool_state` receives only the sequence, pool and session (`map_veto.py:193`), so a live config read would both add a query and let a config edit change a running veto's displayed reserve. When fewer slots are played than configured (4.7), the room states which slots are in play.

Three further room requirements, all from real current behaviour:
- **Status word.** Every slot survivor is a decider, so `VetoMapGrid.tsx:99-101` would badge it "Picked" (`en.json:2078`) for a team that picked nothing — wrong on every map in slot mode rather than once per match. Slot mode needs its own word ("Remaining" / «Осталась»).
- **Timeline.** `VetoStepTimeline.tsx:44` renders the flat sequence, so slot mode would show "Decider" two to five times with nothing distinguishing them. Steps carry slot numbers, and the grid and timeline group together or not at all — `VetoRoom.tsx:186-194` stacks them in one viewport.
- **Narrow screens.** Below `lg` the timeline stacks above the grid; a Bo5 slot veto is 15 steps above five groups at two columns (`VetoMapGrid.tsx:41-42`), so the captain's turn can begin off-screen and the timer expire mid-scroll. Scroll the current slot into view when `current_slot` changes, and collapse the timeline to the current slot. A future slot's map is `available` yet unclickable — a state that does not exist today, where `canSelect` and `status === "available"` coincide (`:44`) — so it must look inert and, if tapped, explain that the slot opens later.

**Public page.** Slots render in order with the reserve as a caption; gamemode composition stays a hint inside a slot, not a heading. `mapsInPool` counts candidates only, excluding reserves.

Four honesty corrections, judged by the same standard as the three commits that preceded this feature:
- The reserve caption must be **attributed and disclaimed** — it is a regulation rule the platform does not track, not something it will do.
- `mapsPlayed` reads "# maps played" in EN (`en.json:3786-3787`), so reusing it for "slots in play" claims maps were played before the match started. RU already reads «# карта в серии», which is correct; EN is the string to fix.
- With a map allowed in two slots, "candidates" and "distinct maps" are different numbers; the page must say which it shows.
- Truncation (§4.7) is disclosed in the room and the admin editor but **not** on the surface spectators read. It must be.

**The public page must also reach negative rounds.** Revision 3 fixed only the admin UI. The public round selector builds `1..max_rounds` (`TournamentMapsPage.tsx:213`, `:500`) and `parseStageBestOf` drops negative keys (`best-of.ts:82`), so all four LB configs are publicly invisible and a lower-bracket captain cannot see their own pool. Decision 13 extends to this surface.

### 4.6 Testing

Extend `test_veto_session.py`, `test_map_veto_state.py`, `mapVetoTab.behavior.test.tsx`, `veto-model.test.ts`, `best-of.test.ts`.

1. Steps == pool size for any (slot count x candidate counts).
2. The decider resolves the *current* slot while other slots still hold available maps.
3. A ban outside the current slot is rejected.
4. One map in two slots: banning it in slot 1 leaves the slot-2 entry AVAILABLE.
5. `fixed` / `alternate` turn order.
6. Slot `i`'s survivor gets `order == i`.
7. **Flat mode: existing tests pass unmodified** — achievable because the mode-aware validator keeps its flat branch and `map_veto_config_map` is untouched.
8. `current_slot` returns `None` on a completed slot-mode veto and `build_map_pool_state` serves it without raising.
9. A one-candidate slot is rejected at upsert.
10. `_map_veto_signature` distinguishes slot1=[A,B]/slot2=[C,D] from slot1=[A,B,C]/slot2=[D], and a flat config from a slot config over the same maps.
11. `initialize_map_pool` is refused against a slot-mode session.
12. Frontend slot generation mirrors the backend.
13. `parseStageBestOf` accepts negative round keys.

Each guard is mutation-verified: reverting the source must fail it.

### 4.7 Edge cases

- **`best_of < slot_count`**: play the first `best_of` slots, deterministically, and disclose it in the room and the admin editor. **`best_of > slot_count`**: refuse the session with a new reason beside `not_configured` / `teams_unknown`. This replaces revision 1's blanket refusal and handles the common shrink case — including a per-encounter `best_of` override and a bracket regeneration that moves which round is `final` (`is_final` is positional, `stage.py:842`).
- **`initialize_map_pool` against a slot-mode session**: 409. The rationale is *not* a `None`/`int` comparison — §4.2's `current_slot` filters `e.slot is not None` first, so that cannot occur. It is that NULL-slot rows belong to no slot, so `current_slot` never selects them, they can never be banned or picked, and they stay AVAILABLE forever; `get_current_step` (`map_veto.py:74-77`) then points at a step no entry can satisfy and the veto stalls with no recovery but a reset. Recording the real reason so a future reader does not delete the guard.
- **Empty slot or a single-candidate slot**: rejected at upsert.
- **Config switched between modes while a session is active**: sessions are never rewritten; applies on reset.
- **Candidate count dropped below 2 by a catalogue delete**: `map_id` FKs cascade from `overwatch.map`, so deleting a map can silently leave a 1-candidate slot — the stall Decision 15 exists to prevent, on a path the upsert guard never sees. Session creation therefore re-checks `c_i >= 2` alongside the slot-count reconciliation, refusing with the same reason mechanism.
- **Downgrade with slot-mode sessions live**: a slot-mode `resolved_sequence_json` carries one decider per slot, which the old engine's `auto_complete_decider_entry` rejects, and its config's slot tables would be gone so a reset cannot rebuild it. The downgrade migration must cancel (or delete) slot-mode sessions before dropping the tables.
- **A new refusal reason renders as a lie today.** `VetoRoom.tsx:129` collapses the reason set into a boolean (`state.reason === "teams_unknown"`) and lines 133-141 branch on it, so any third reason falls through to "Veto is not configured / check back later". That is false for a config that exists but disagrees with the bracket, and it tells the captain to wait for something that will not happen. The boolean must become an exhaustive mapping over `VetoUnavailableReason` so that adding a reason forces a copy decision at the type level.
- **Old admin client omitting `mode`**: rejected 422. The upsert replaces the pool wholesale (`veto_admin.py:136-142`), so a defaulted `mode` would let a stale client convert a slot config to flat and orphan its slot rows.

### 4.8 Risks

1. Two engine modes. Mitigation: one derivation (`current_slot`), flat mode is `None`. The *feature* surface is wide (4.2) even though the *engine* split is narrow.
2. `_map_veto_signature` lives in two services that must move together — a coupling `dbarch05`'s migration docstring already warns about.
3. Bracket regeneration can change a round's `best_of` without changing its number. Mitigated by 4.7's reconciliation plus the editor warning, not eliminated.
4. `Neon Junction` must exist before group Round 1 can be configured.
5. **Partial rollout.** The dangerous direction is an old writer against a new schema; a required `mode` turns that into a 422. The flat projection covers old readers. Neither removes the need to deploy the backend before the admin UI.
6. The admin tab's encounters query is per-viewer cached with a 300s TTL, so 4.4's slot-count warning is fresh only within that window. It must request a bounded field set, not full encounters.

## 5. Decision Log

| # | Decision | Alternatives | Rationale |
|---|---|---|---|
| 1 | Slot = N candidates, alternating bans down to one survivor | ban+pick; picks only; per-slot sequence | Direct reading of the ruleset; matches the existing `buildBo1Sequence` shape |
| 2 | Slot mode is a second mode; flat mode stays | replace; express flat via slots | "2 bans, 2 picks, decider" is the standard most tournaments run |
| 3 | `first_ban_rotation` as a config field (`fixed` / `alternate`) | always higher seed; always alternate | **CLOSED 2026-08-05.** The Skeptic called it speculative and the arbiter called closing it the largest cheap scope cut. Re-put to the organizer with the full cost stated — a column, a PG enum type, an admin control and two RU strings — and the organizer re-affirmed configurable. Kept as an informed choice, not an unexamined default. Per Advocate finding 10 the control is labelled «Кто банит первым» with «Всегда высший сид» / «По очереди»; "rotation" is never surfaced as a noun in RU |
| 4 | Slot-mode sequence is derived, not authored | store in `veto_sequence_json` | Determined by `best_of` and candidate counts |
| 5 | LB rounds in the admin UI are in scope | defer | Without them the playoff bracket cannot be configured |
| 6 | Draw is at map level | series level; do not automate | The extra game decides that map's winner |
| 7 | Reserve map is not a pool entry and collects no match code | pool entry with a code slot | **Rationale corrected:** not because it preserves `played = home_score + away_score` (it does not — `played` only slices `available_map_indices`, and a drawn map breaks the identity anyway), but because no code is collected for it and it is never activated by the platform |
| 8 | No new cascade level; existing `round` suffices | new cascade key | Verified against tournament 78's encounters |
| 9 | **Approach B: dedicated slot tables** | A: columns on existing tables; C: slots in sequence JSON | **Reversed from A.** A needed a constraint swap, a partial index, a `role` enum and a validator change — more migration than B — and modified the working flat mode. B leaves `map_veto_config_map` untouched and mirrors the RPC shape the feature needs anyway. C rejected: the anti-pattern `dbarch05` already removed |
| 10 | `mode` and `first_ban_rotation` are PG enums | `String(16)` | A typo in `mode` would fall silently into flat mode; sibling `first_pick_rule` is already an enum |
| 11 | ~~Relax uniqueness~~ **withdrawn** | — | Moot under B: duplicates across slots are naturally legal, and the binding blocker was `validate_veto_config`'s `map_ids` check, not the index |
| 12 | Slot mode requires an unambiguous scope `best_of`, gated on `scope` | allow at tournament level | Slots == `best_of`. Gate must use the `scope` discriminator, not "is `bestOf` a number" |
| 13 | Round numbers from existing encounters plus planned rounds | only `1..max_rounds` | Current UI hides LB and shows rounds that may not exist |
| 14 | `best_of < slots` truncates to the first `best_of`; `best_of > slots` refuses | blanket refusal; run anyway | **Revised.** Blanket refusal left a per-encounter override and a moved `final` round with no recoverable state |
| 15 | Slots require >= 2 candidates | allow 1 as a fixed map | Back-to-back deciders stall the engine; the ruleset never needs it. Revisit only on request |
| 16 | `validate_veto_config` becomes mode-aware | one validator for both | Slot sequences carry one decider per slot, mid-sequence, which the flat rules reject |
| 17 | `mode` is a REQUIRED upsert field with no default | default to `pool`; infer from body | The upsert replaces the pool wholesale, so a default lets a stale client silently convert a slot config to flat. A 422 is loud and harmless |
| 18 | Slot reserves are snapshotted onto the session as `slot_reserves_json` | read the config on the state path | `build_map_pool_state` never receives a config; a live read would add a query AND let a config edit mutate a running veto's display |
| 19 | **Withdrawn at arbitration.** `map_veto_config_map` stays empty in slot mode; `map_ids` must be `[]` | mirror the union of slot candidates there | The projection hides partial-rollout damage rather than containing it: it turns a visibly dead room into a plausible flat veto over every slot's candidates that captains can act on. Its `_map_veto_signature` benefit was void — both partitions share the same union, so a union-based signature merges them exactly as an empty tuple would. Deploy ordering is the only real lever |
| 20 | Downgrade cancels slot-mode sessions | rely on schema reversibility alone | The schema reverses; the feature does not. Multi-decider snapshots permanently 400 the old engine with no working reset path |
| 21 | Candidate count `>= 2` re-checked at session creation | trust the upsert guard | `map_id` cascades from the map catalogue, so a delete can drop a slot below the floor without any upsert running |
| 22 | The room's unavailable-reason rendering becomes an exhaustive map, not a boolean | add an `else if` for the new reason | `VetoRoom.tsx:129` is a boolean; a third reason silently renders "not configured". An exhaustive map makes the compiler demand copy for every future reason |
| 23 | Pool shape is its own control, separate from step order | one three-way radio | Slots change what the pool *is*, not the order of steps, and slots+custom is forbidden by CHECK — a single group would contradict the constraint. The existing order copy ("this is what almost every tournament wants") is equally true of both, giving a reader no basis to choose |
| 24 | Gamemode filter and select-visible move inside each slot card; per-slot composition chips | select from one shared grid | Every group-round slot is gamemode-homogeneous, so filter-then-select-3 is two gestures instead of six clicks and makes a cross-mode error structurally impossible. Reuses `:546-580` and `:297-307` |
| 25 | Name filter with normalized matching (case, diacritics, U+2019) | rely on visual scanning | The four regulation spellings are near-misses; scanning 31 tiles lands confidently on the wrong map and nothing downstream contradicts it |
| 26 | Slot mode renders disabled-with-reason when the gate fails | omit it silently | Silent absence reads as "the feature does not exist", and the gate fails on stage 189 exactly where slots are needed. The tab already does disabled-with-reason for `formatUnknownScope` |
| 27 | Slot survivors get a slot-mode status word; timeline steps carry slot numbers | reuse "Picked" | Every survivor is a decider, so "Picked" would be wrong on every map, and a flat timeline shows an undifferentiated "Decider" 2-5 times |
| 28 | `validateVetoConfigForm` extends to slots (client-side) | server-only rejection | The tab's contract is that Save never enables into a known-invalid state; a server-only `>= 2` check spends the selections first |
| 29 | The public page reaches negative rounds too | admin UI only | Revision 3 left all four LB configs publicly invisible; an LB captain could not see their own pool |
| 30 | Glossary rows land before any string; "rotation" is not translated as a noun | translate literally | «Ротация» already means map/hero rotation in this community. The control is «Кто банит первым» with «Всегда высший сид» / «По очереди» |

## 6. Review record

### Skeptic (disposition: all 12 objections accepted; 1 deferred to the organizer)

| Objection | Severity | Disposition |
|---|---|---|
| Multiple mid-sequence deciders rejected by `validate_veto_config` | FATAL | Accepted -> Decision 16, §4.3 |
| `min()` raises on every completed slot-mode veto | FATAL | Accepted -> §4.2 corrected form, test 8 |
| Decision 11 relaxed a non-binding constraint | MAJOR | Accepted -> Decision 11 withdrawn under B |
| "Three edits" undercounts by ~3x; RPC cannot express a slot | MAJOR | Accepted -> §4.2 edit table, maintenance assumption revised |
| `_map_veto_signature` merges different slot configs, two copies | MAJOR | Accepted -> §4.2, risk 2, test 10 |
| `initialize_map_pool` injects `slot=NULL` into a live pool | MAJOR | Accepted -> §4.7, test 11 |
| Consecutive deciders stall the veto | MAJOR | Accepted -> Decision 15 (forbid 1-candidate slots) rather than an engine loop |
| `parseStageBestOf` drops negative `by_round` keys | MAJOR | Accepted -> §4.4 prerequisite fix, test 13. Bug from commit `4e8e1dce` |
| `bracketFormat.kind` does not exist on the admin type | MAJOR | Accepted -> §4.4 gate rewritten against `scope` |
| Decision 7's rationale self-defeating | MAJOR | Accepted -> Decision 7 rationale corrected |
| Per-encounter `best_of` override unrecoverable | MAJOR | Accepted -> Decision 14 revised to truncate/refuse |
| `first_ban_rotation` speculative | MINOR | Deferred to the organizer; Decision 3 marked OPEN |

Claims the Skeptic verified as sound and which must be preserved: `get_current_step`'s arithmetic invariant; `order`/`action_index` correctness in slot mode, so `series_map_indices` and `pickedMapsInOrder` need no change.

### Constraint Guardian (disposition: all 7 findings accepted)

| Finding | Verdict | Disposition |
|---|---|---|
| Upsert has no `mode`; wholesale replace orphans slot rows | REJECT | Accepted -> Decision 17 |
| Reserve label unreachable from `get_map_pool_state`; contradicts zero-added-queries | REJECT | Accepted -> Decision 18, §4.1, §4.5 |
| Schema reversible, feature is not; downgrade poisons sessions | REJECT | Accepted -> Decision 20, §4.7 |
| "~12 sites" omits 8 `selectinload(map_pool)` + 1 `refresh` across two services | REJECT | Accepted -> §3 maintenance, §4.2 edit table |
| Enums lack `create_type=False`, schema, `values_callable` | CLARIFY | Accepted -> §4.1 migration mechanics |
| Catalogue `ON DELETE CASCADE` can drop a slot below the `>= 2` floor | CLARIFY | Accepted -> Decision 21, §4.7 |
| Admin encounters query: no page size, per-viewer key, 300s TTL | CLARIFY | Accepted -> risk 6 |

Confirmed as genuinely holding: zero added queries in the steady-state veto room (`ensure_veto_session` returns before `resolve_config` once a session exists; `slot` rides a column `_load_pool` already selects); no N+1 across 13 configs x 15 candidates with a nested selectinload chain; no cache key under-specified (veto configs are uncached in cashews and absent from the gateway respcache); permissions unchanged on both write paths; no new public exposure; and no possible gateway lag, because both veto routes are opaque `Body: true` pass-throughs.

Largest non-functional risk as identified: partial-rollout blast radius of an empty `map_veto_config_map` under approach B. Answered by Decisions 17 and 19; not eliminated, so backend must deploy before the admin UI.

### User Advocate (disposition: 1 BLOCKER + 9 MAJOR, all accepted; one item deferred)

| Finding | Severity | Disposition |
|---|---|---|
| `VetoRoom.tsx:129` boolean renders any new reason as "not configured" | BLOCKER | Accepted -> Decision 22; per-cause copy, including Decision 21's separate cause |
| No way to verify ~100 transcribed selections | MAJOR | Accepted -> Decision 24; cross-config read-back **deferred** |
| Four map names mismatch, no name search | MAJOR | Accepted -> Decision 25 |
| Slots presented as a third "step order" option; draft loss on toggle | MAJOR | Accepted -> Decision 23 |
| Gate failure is silent | MAJOR | Accepted -> Decision 26, both traps |
| Survivors badged "Picked"; flat timeline | MAJOR | Accepted -> Decision 27 |
| Three untrue claims to spectators, one hidden truth | MAJOR | Accepted -> §4.5, Decision 29 |
| Refusals lack actionable text; `>= 2` server-only | MAJOR | Accepted -> Decision 28 |
| Mobile: clickable maps below the fold | MAJOR | Accepted -> §4.5 narrow-screen requirements |
| Glossary gaps; "rotation" collides in RU | MAJOR | Accepted -> Decision 30 |

Verdict as delivered: NOT READY for the organizer, CONDITIONALLY READY for the captain. The organizer verdict was driven entirely by the absence of verification affordances, which Decisions 24-25 address.

Called out as good and to be preserved: reading reserves from `slot_reserves_json` rather than the live config (18); refusing `best_of > slot_count` rather than running an unfillable veto (14); `mode` required on upsert (17); flat mode untouched (2, test 7); the truncation warning naming both numbers; refusing 1-candidate slots rather than adding an engine loop (15); excluding reserves from `mapsInPool`.


## 6a. Arbitration

**Disposition: REVISE** — all 8 items applied in revision 5.

| Spot-check | Ruling |
|---|---|
| Decision 16 + §4.3, mode-aware validator | **UPHELD** — `validate_veto_config` has exactly one production caller (`veto_admin.py:93`) on the upsert body; the session sequence never reaches it, and `veto_sequence_json` is NOT NULL so `[]` is legal |
| §4.2 corrected `current_slot` | **UPHELD** — the guarded `min` cannot raise, and no consumer needs to distinguish flat from completed because `get_current_step` returns None first and mode detection rides on per-entry `slot` |
| Decision 19 flat projection | **INSUFFICIENT** — withdrawn |
| Decision 9 reversal to approach B | **UPHELD** — A's cost was never 3 columns: the `UNIQUE (config_id, map_id)` swap is real, a per-slot reserve needs a `role` discriminator, A needs the same mode-aware validator B needs, and A permanently exposes slot rows to every reader of `config.map_pool` |

Contradictions found and fixed: Decision 19 vs §4.2/risk 2/test 10 (parser-service benefit void); §4.7's stale `min()` rationale.

**Resolved after arbitration:** Decision 3 (`first_ban_rotation`) was put back to the organizer with the arbiter's cost breakdown stated in full. The organizer re-affirmed the configurable field. No objections remain open.

## 7. Reviewer instructions

Objections must reference a specific assumption, decision number, or design section. Do not propose new features. Do not redesign. State plainly when something could not be confirmed.
