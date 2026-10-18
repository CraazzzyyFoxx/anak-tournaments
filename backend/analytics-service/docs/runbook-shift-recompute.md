# Runbook: recomputing the division shift signal (team-result + hybrid)

The final methodology (after reverting the merit rewrite):
- **Points** — cumulative team W/L (unchanged; empirically the strongest predictor of an actual division change).
- **Linear** — pure team-result (`map_diff` + `placement_score`).
- **OpenSkill + ML** — a team-dominant backbone (`shift_w_team`·Linear-team + `shift_w_os`·OpenSkill-mu) **plus an additive, clamped individual skill term** (Performance v2 `local_zscore` vs the same role + the adjacent division). The strength/ceiling of the individual term are **rank-dependent**: they decay linearly with the canonical division number (1 = top … 40 = bottom) — small at the ceiling (the same +N up there is rare, noisy and pinned against the claim cap), large at the bottom. There is no NNLS fit.
- **The smurf flag** additionally catches a strong outlier within the cohort (`local_zscore ≥ SMURF_STRONG_LOCAL_Z`) at any rank.
- **The division grid = the signal rounded to the nearest division** (no dead zone (−1,1)) → the display is consistent with the signal.

## env knobs (`backend/env/analytics.env`)
| env | what | when it applies |
|---|---|---|
| `LINEAR_SHIFT_SCALE` (6.25) | team-result Linear scale | read-time → recompute v1 |
| `SHIFT_W_TEAM` (0.7), `SHIFT_W_OS` (0.3) | v2 backbone weights | snapshotted at train → retrain shift |
| `SHIFT_INDIV_SCALE_TOP` (0.2), `SHIFT_INDIV_SCALE_BOTTOM` (0.8) | individual-skill strength at the ceiling / at the bottom (ramp by division) | snapshotted at train → retrain shift |
| `SHIFT_INDIV_CLAMP_TOP` (0.75), `SHIFT_INDIV_CLAMP_BOTTOM` (2.0) | individual-term ceiling at the top / at the bottom | snapshotted at train → retrain shift |
| `SHIFT_CLAMP_TOP_GRID_REF` (20.0) | output clamp: top = `grid_n_div/REF` divisions (20-tier→±1, 40-tier→±2), bottom = ±3; cuts +3 for high ranks from ANY source (incl. os_shift) | snapshotted at train → retrain shift |
| `SHIFT_DOMINANCE_GAIN` (6.0), `SHIFT_DOMINANCE_CAP` (3.0) | raw MVP-dominance lift: `(mvp_dominance−0.5)·gain` clamped to `cap`, max-blended with the local term, limited ONLY by the output clamp (bypassing the soft individual clamp) → an obvious hard carry reaches the rank ceiling | snapshotted at train → retrain shift |
| `SHIFT_PLACEMENT_FLOOR` (0.0) | gates the POSITIVE individual lift by the team's final placement: factor ∈[floor,1] (1.0 champion → floor last place); 0.0 = no + at all for last place, even with excellent personal play | snapshotted at train → retrain shift |
| `SMURF_STRONG_LOCAL_Z` (1.5) | strong-outlier threshold for the flag | read at infer → backfill anomalies |
| `SMURF_MVP_DOMINANCE` (0.75) | raw MVP-dominance threshold (average MVP place across the match log) for the `raw_mvp_dominance` smurf flag | read at infer → backfill anomalies |
| `STANDINGS_PROB_SHARPENING` (1.5) | spread of predicted placements | snapshotted at train standings |

## Recompute on the prod host (in tmux)
```bash
COMPOSE="docker compose -f docker-compose.production.yml"
LATEST=73   # max tournament id

# 0) ship the code and rebuild the image (exec runs what is in the image!)
$COMPOSE build analytics analytics-worker && $COMPOSE up -d analytics analytics-worker
$COMPOSE exec analytics-worker python -c \
 "import shared.disciplines.overwatch.analytics.models.shift_v2 as m; print('OK' if hasattr(m,'INDIV_MOD_SCALE_TOP') else 'OLD IMAGE')"

# 1a) (required for individual skill and the smurf flag) materialize Performance v2 over history
$COMPOSE exec analytics-worker python -m src.services.ml.cli backfill --from 1 --to $LATEST --models performance

# 1b) retrain shift v2 (weights snapshotted from env) and recompute
$COMPOSE exec analytics-worker python -m src.services.ml.cli train --cutoff $LATEST --models shift
$COMPOSE exec analytics-worker python -m src.services.ml.cli backfill --from 1 --to $LATEST
#   ^ backfill (without --models) updates shift + player_anomalies (smurf) + match_quality + standings + performance

# 2) v1 Linear/Points + division grid — a compute job per tournament (v1 recalc + v2 infer together)
#    via the API (analytics.update permission), for each tournament_id needed:
curl -X POST https://<api-host>/v2/jobs -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" -d "{\"kind\":\"compute\",\"tournament_id\":$LATEST}"
#    (or with the built-in recompute button in the admin panel; jobs are serialized — one per workspace)
```

## Tuning
Individual-skill strength/ceiling (rank-dependent) / flag threshold / output clamp — via env (`SHIFT_INDIV_SCALE_TOP|BOTTOM`/`SHIFT_INDIV_CLAMP_TOP|BOTTOM`/`SHIFT_CLAMP_TOP_GRID_REF`/`SMURF_STRONG_LOCAL_Z`), then `train --models shift` (for the weights) + backfill. `LINEAR_SHIFT_SCALE` — v1 recompute only (compute job), no retrain.

## Verification (read-only, from a laptop)
```bash
cd backend/analytics-service && uv run python scripts/diagnose_performance_coverage.py
```
- ad-hoc SQL Spearman(shift@T, realised@T+1): **Linear ≈ 0.37** (same as Points), OpenSkill+ML — team-dominant with individual variation, no collapse;
- UI spot check: 1st place → up; a strong skill outlier **moves and is flagged** (smurf) at any rank; **the division grid matches the sign/magnitude of the signal**; manual admin shifts are intact.

## Safety / rollback
- The recompute **does not touch** the manual shift (`AnalyticsPlayer.shift`, an admin-panel field) — only `change_shift`.
- Model rollback: mark the previously active artifact `is_active=true` (deactivate the new one) + rerun backfill.
- Code rollback — git-revert the branch + rebuild the image.

## Artifact class conversion (model move to `shared.disciplines.overwatch`) — maintenance only

The four serialized classes changed their import path and the runtime has no alias, so the new image cannot read
any old artifact until it is converted. This is an explicit two-image procedure (P9 owns the real run; P6 only proves
it on `tests/fixtures/ml_pre_move/`). **Stop workers, training, the scheduler and every cache writer first**, keep the
old image and the old `storage_uri` values for rollback, and use the same pinned numerical libraries
(numpy/pandas/scikit-learn/scipy/lightgbm/xgboost/joblib) in both images — `stage` refuses a version difference.

1. **Inventory (read-only).** Write `INVENTORY.json` listing *every* `analytics.ml_model_artifact` row, active **and**
   inactive: id, algorithm id/name, `model_kind`, role/dimension ids, version, feature_version, training cutoff,
   `is_active`, metrics, feature importance, local `file://` `storage_uri`, SHA256 + length, the expected old class and
   the verification frames (aligned main/coarse/baseline matrices, standings matrix, shift frame — taken from real data,
   with NaN and zero-playtime rows). An unsupported scheme, class or state, a missing file or a digest mismatch blocks
   the whole batch; nothing is skipped.
2. **Export in the retained OLD image** (read-only model volume; run from its service root):
   `python scripts/convert_discipline_artifacts.py export --inventory INVENTORY.json --model-root OLD_MODEL_ROOT --output BUNDLE_DIR --old-image <digest>`.
   Digests are proven before any parsing; only the four legacy globals may resolve; the receipt records the old
   predictions of every estimator and wrapper.
3. **Stage in the NEW image:**
   `python scripts/convert_discipline_artifacts.py stage --bundle BUNDLE_DIR --output NEW_MODEL_ROOT --new-image <digest>`.
   Writes `NEW_MODEL_ROOT/discipline06/<artifact-id>/<old-sha256>.joblib` (never over an existing file), reopens each
   with the ordinary `joblib.load` and requires identical state and bit-identical predictions. New checksums differ
   from the originals by design and are recorded. Any failure leaves the registry and the originals untouched
   (`stage-failure.json` lists the staged files); retrying reuses verified outputs.
4. **Review `BUNDLE_DIR/receipt.json`, then apply:**
   `python scripts/convert_discipline_artifacts.py apply --receipt BUNDLE_DIR/receipt.json`.
   One transaction locks the rows in id order, requires every registry field and the current old URI to match the
   export, and updates **only** `storage_uri`. A mixed or unknown URI state blocks; an all-new state is an idempotent
   success.
5. **Rollback:** `... rollback --receipt BUNDLE_DIR/receipt.json` restores the original URI set (needs the old image
   again to read the old bytes). Originals and converted files are never deleted.

P9 gate: the real inventory must show no unsupported class/state, every referenced artifact (including historical and
duplicate-URI rows) in the receipt, and a rehearsed apply + rollback before the new image serves traffic.

**Exact unpickler allowlist (P9 must review any addition).** Parsing uses joblib's `NumpyUnpickler` with only
`find_class` narrowed to an audited exact `(module, name)` set (`_ALLOWED_GLOBALS` in the tool: recorded by loading every
fixture state file, a frame and an ndarray, plus numpy's `_reconstruct`) and the artifact's own legacy globals (the
wrapper, and `_ConstantClassifier` for performance only). A dotted `name`, an object-dtype ndarray payload and any other
global are rejected before `REDUCE`; nested pickles use the same checker. A real artifact that references a global
outside the set (e.g. `threadpoolctl`, `functools`) **blocks** until it is reviewed and added — never widened to a
package prefix. Image identity strings (`--old-image/--new-image`) are recorded, not verified: the operator proves the
retained image and lockfile equality.
