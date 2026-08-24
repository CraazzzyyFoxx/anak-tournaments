# analytics-service: OOP + repository refactor — analysis and plan

Date: 2026-08-24
Scope: `backend/analytics-service` (RPC reads/mutations/job-control, v1 recalc, v2 ML registry, job runner, balance-snapshot consumer)

Fifth service in the conversion series after
`docs/plans/2026-08-20-app-service-oop-repositories.md`,
`docs/plans/2026-08-21-balancer-service-oop-repositories.md`,
`docs/plans/2026-08-21-parser-service-oop-repositories.md` and
`docs/plans/2026-08-22-tournament-service-oop-repositories.md`.

## 1. Starting state

Every `services/*`, `rpc/*`, `worker/*` module is a bag of
`async def foo(session, ...)` functions. Session-as-parameter is already
correct. Zero classes, zero `*Repository` callers.

`AnalyticsStateRepository` in `shared/repository/support.py` is a bag of
bare `BaseRepository(...)` class attributes with **zero callers**. The
analytics tables have never had named repository methods.

| Layer | Problem |
|---|---|
| `rpc/reads.py` | 8 handlers run `sa.select` inline (balance snapshot + all v2 lists). Largest RPC-SQL concentration of any remaining service. |
| `rpc/mutations.py` | `PENDING`: anomaly-feedback upsert + tournament workspace scalar live in the transport. |
| `rpc/jobs_control.py` | `_dispatch` orchestrates create/publish; `_recalculate` looks up algorithm names with raw SQL. |
| `services/jobs/service.py` | `APPROVED` but is textbook single-model CRUD (`AnalyticsJob`). Highest-value move. |
| `services/analytics/service.py` | Analytical CTEs/lookbacks stay. One CRUD leak: `get_algorithm` by name (copied 8+ times across the service). |
| `services/analytics/flows.py` | `APPROVED` bulk materialization (player/shift delete+repopulate) stays. Session-taking orchestration is a class; pandas/openskill math stays module-level. |
| `services/analytics_read/service.py` | `APPROVED` but almost read-only. Algorithm list/get is CRUD; join-heavy `get_analytics`/`get_streaks`/`get_predicted_places` stay. `change_shift` is a write that self-commits. |
| `services/ml/training/registry.py` | `APPROVED` but is clean artifact/algorithm CRUD. Move. |
| `services/ml/training/backtest.py` | `PENDING`: scoring queries stay (analytical). `persist_backtest_summary`'s `session.add` moves. |
| `services/ml/features/*`, inference runners | Analytical / bulk materialization. Leave. Do not force classes onto feature extractors. |
| `worker/balance_snapshot.py` | `APPROVED` delete+reinsert. Caller already owns commit. Class wrap only. |

### Shared extraction — already done

`core/workspace.py`, `core/db.py`, `rpc/_common.py` are re-exports of
`shared.*`. `schemas/base.py` is a deliberate local subset (documented in
`shared/schemas/base.py`: do not conflate). Nothing further goes to
`shared/` except the missing repositories. The 8-way
`select(AnalyticsAlgorithm).where(name==…)` stays in one repository method.

## 2. Target

```
shared/repository/analytics.py     NEW named repos (CRUD only, flush only)
src/services/<domain>/*.py         one class + one singleton; session is a method param
src/rpc/*.py                       gate + one service call; zero SQL
src/domain/                        not created — remaining pure helpers are
                                   small and already module-level (ponytail)
```

Naming (same contract as tournament-service):

1. Singleton = `<module-stem>_service`, except `service.py` → `<domain>_service`.
2. Method name == the old function name.
3. Only session-taking functions become methods. Pure helpers stay module-level.

### Repositories

| Class | Named methods (verbatim shapes) |
|---|---|
| `AnalyticsAlgorithmRepository` | `get_by_name`, `get_id_by_name`, `list_names_by_ids`, `list_shift_producers`, `get_shift_producer`, `ensure` |
| `AnalyticsJobRepository` | `get_active`, `list_by_workspace`, `list_active` |
| `AnalyticsAnomalyFeedbackRepository` | `get_by_key`, `list_by_tournament` |
| `AnalyticsBalanceSnapshotRepository` | `get_by_tournament` |
| `AnalyticsPerformanceRepository` | `list_by_tournament` |
| `AnalyticsStandingsDistributionRepository` | `list_by_tournament` |
| `AnalyticsMatchQualityRepository` | `list_by_tournament` |
| `AnalyticsPlayerAnomalyRepository` | `list_by_tournament` |
| `AnalyticsExplanationRepository` | `latest_for_player` |
| `MLModelArtifactRepository` | `get_by_identity`, `get_active`, `list_active`, `list_filtered`, `deactivate_others` |
| `AnalyticsPlayerRepository` | `list_by_tournament` |
| `AnalyticsShiftRepository` | `algorithm_ids_for_tournament` |

`AnalyticsStateRepository` is deleted (zero callers).

### Deliberately not moved

- v1 `get_analytics` CTEs, lookback windows, streaks, predicted places, ML
  feature extraction — `repository-boundaries.md` bans these from CRUD repos.
- Bulk delete+insert materialization in `analytics/flows.py`, inference
  runners, `balance_snapshot.py`.
- `schemas/base.py` TeamRead/PlayerRead (intentional subset).
- No `.importlinter` (flat service, same call as balancer).
- Job `commit()` stays on `AnalyticsJobService`: `_dispatch` publishes to
  RabbitMQ after `create_job` returns, and the worker must see the row.
  Moving that commit to `c.envelope` would race the consumer.

## 3. Execution

Repository layer first (frozen). Then services, then rpc + allowlist + tests.
