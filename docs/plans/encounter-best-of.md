# Per-round Best-of for Encounters

## Understanding
- **What:** Let matches carry a best-of series length (BO1/2/3/5/7); let the bracket generator assign best-of per round (and a distinct value for the final); let admins edit best-of per encounter; adapt the captain report form to the series length; backfill existing encounters.
- **Why:** Tournaments run different series lengths per phase (group BO2, playoffs BO3, final BO5). The model already has `Encounter.best_of` but nothing sets it and the generator hardcodes the default (3).
- **Who:** Tournament admins (config + per-encounter edit) and captains (report form adapts).
- **Constraints:** Reuse existing `Stage.settings_json`; no schema migration. Config applied only at (re)generation; existing rows changed only via an explicit backfill action or per-encounter edit.
- **Non-goals:** No tie-break logic for even series (BO2 1-1 draws stay a valid group result and an admin-resolved case in elimination). No per-lower-bracket-round UI (DE LB rounds use the default).

## Decision Log
| Decision | Chosen | Alternatives | Why |
|---|---|---|---|
| Config location | `Stage.settings_json.best_of` | new columns; per stage-item table | Reuses free-form config; zero migration |
| Granularity | `default` + `by_round` map + `final` | single value; per stage-item | Matches "this round BOx … final BOy" |
| Allowed values (UI) | BO1/2/3/5/7 | odd-only; 2/3/5 | User choice (BO2 allowed) |
| Applying config | on (re)generation only | auto-rewrite all rows on config change | Predictable; keeps per-encounter override |
| Backfill existing | explicit per-stage admin action | Alembic data migration | No config existed pre-feature; per-stage apply is the useful escape hatch |
| Report presets | derived from best_of; none for ≥ BO5 | fixed group-stage presets | User request: BO2 → 0-2/1-1/2-0, BO5 → manual only |
| DE lower bracket | uses `default` | expose negative rounds | YAGNI |

## Contract (all slices align on this)

### Config shape — `Stage.settings_json.best_of`
```json
{ "default": 3, "by_round": { "1": 2, "3": 5 }, "final": 5 }
```
- `default`: int ≥ 1, optional, fallback `3`.
- `by_round`: object mapping **round-number string** → int ≥ 1, optional. Keys are positive round numbers.
- `final`: int ≥ 1 or absent/null.

### Resolution (per encounter, round R, given stage)
1. If stage is `single_elimination`/`double_elimination` AND R == max round of the generated set AND `final` is set → `final`.
2. Else if `str(R)` in `by_round` → `by_round[R]`.
3. Else → `default` (or 3).

### Backend surface
- `EncounterUpdate.best_of: int | None = Field(default=None, ge=1)`, `EncounterCreate.best_of: int = Field(default=3, ge=1)`.
- Resolver module (`parse_best_of_config`, `resolve_best_of`) reused by generator and backfill.
- `_create_encounters_from_skeleton` sets `best_of=` per pairing.
- Backfill service `apply_best_of_to_existing(session, stage_id) -> int` (rows changed), in place, preserves scores.
- RPC `rpc.tournament.stage_apply_best_of` → returns `{"updated": <int>}`.

### Gateway route
`POST /api/v1/admin/stages/{stage_id}/apply-best-of` → `rpc.tournament.stage_apply_best_of` (Path `stage_id`, Auth required).

### Frontend surface
- `EncounterUpdateInput.best_of?: number`; `adminService.applyStageBestOf(stageId)`.
- `encounter-score.ts`: `validSeriesScores(bestOf)`, `getScorePresetsForBestOf(bestOf)` (empty for bestOf ≥ 4 / invalid).
- `EncounterScoreControls` optional `bestOf?: number` → best-of presets; hide preset block when empty.
- `MatchReportDialog` and `EncounterEditDialog` pass `bestOf={encounter.best_of}`; edit dialog gets a best_of `Select` (1/2/3/5/7) → update payload.
- `StageManager`: best-of config block (default + final + per-round overrides 1..max_rounds) persisted to `settings_json.best_of`; "Apply best-of to existing matches" button → `applyStageBestOf`.

### validSeriesScores algorithm
`w = floor(N/2)+1`; `maxLoser = N - w`. Winner=home: `(w, loser)` for loser 0..maxLoser. If N even: draw `(N/2, N/2)`. Winner=away: mirror. Examples: BO1→1-0,0-1; BO2→2-0,1-1,0-2; BO3→2-0,2-1,1-2,0-2; BO5→3-0,3-1,3-2,2-3,1-3,0-3 (not shown — manual only).
