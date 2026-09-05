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
 "import src.services.ml.models.shift_v2 as m; print('OK' if hasattr(m,'INDIV_MOD_SCALE_TOP') else 'OLD IMAGE')"

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
```
