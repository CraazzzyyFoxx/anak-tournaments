# Analytics Service (`analytics-svc` + `analytics-worker`)

Post-tournament analytics for OWT: rating shifts, per-player performance, placement
distributions, encounter quality and player anomalies. It is the authority for the
`analytics` Postgres schema and for the ML model registry that produces those numbers.
See [`../../docs/architecture.md`](../../docs/architecture.md) for how it fits into the
wider platform.

This directory builds **one image that runs as two headless FastStream (RabbitMQ)
processes**. Neither serves HTTP. External traffic arrives as `/api/analytics/*` at the Go
gateway, which translates each route into a request/reply RPC call on `rpc.analytics.*`
with an `x-deadline-ms` budget and expects an `{ok, data, error}` envelope back.

The split exists because an RPC reply must fit inside that deadline and ML training does
not — a backfill runs for many minutes. So:

- `analytics-svc` may read, apply light mutations, and **create** jobs; it must not run
  ratings recomputation, training, or inference, and must not import `serve` or subscribe
  to the `ANALYTICS_*` queues (those durable queues would then be double-owned and
  messages would round-robin between the two processes).
- `analytics-worker` may take as long as it needs; it never answers an RPC call.

| | `analytics-svc` | `analytics-worker` |
|---|---|---|
| **Entry point** | `serve_rpc.py` | `serve.py` |
| **Run command** | `faststream run serve_rpc:app` | `faststream run serve:app` |
| **Compose profile** | default | `workers` |
| **Transport** | RabbitMQ request/reply (`rpc.analytics.*`); no HTTP | RabbitMQ durable job queues; no HTTP |
| **Metrics** | Prometheus on `WORKER_METRICS_PORT` (dev 9107, prod 9108) | Prometheus on `WORKER_METRICS_PORT` (dev 9106, prod 9106) |
| **Resources (compose)** | 1 CPU / 512M | 8 CPU / 4G, `/opt/owt/models` + feature-cache volumes |

Prometheus scrapes `analytics-svc:9108`. In `docker-compose.yml` the dev block sets
`WORKER_METRICS_PORT=9107`, so dev scraping of `analytics-svc` does not work; production
sets 9108 and is consistent. This is a defect, not a convention.

## Responsibilities

- **Rating shifts** — the OpenSkill/Plackett-Luce and linear/points algorithms that turn
  tournament results into per-player division shifts (`src/domain/ratings.py`,
  `src/services/analytics/`).
- **ML signals** — LightGBM/XGBoost with a Bayesian layer and Monte Carlo simulation, for
  player performance, shift v2, predicted standings, match quality and player anomalies
  (`src/services/ml/`). `analytics.standings_distribution` is the only source of placement
  predictions; a scalar "predicted place" is the rounded mean, derived at read time.
- **Model lifecycle** — training, calibration, backtesting, drift measurement, and the
  artifact registry that marks one artifact active per model kind.
- **Recompute orchestration** — one `AnalyticsJob` row per recomputation, its staged
  progress, its terminal status and its result summary.
- **Anomaly review** — reviewer verdicts on flagged performances, unique per
  `(tournament, player, kind)`, so a reviewed anomaly is not raised again on recompute.

Analytics never ingests: match logs and tournament results are owned upstream. It only
derives numbers from what is already in the database.

## Interface

`analytics-svc` subscribes to the `rpc.analytics.*` namespace. Method groups:

| Group | What it covers |
|---|---|
| Algorithm reads | The `analytics.algorithms` registry that every derived number points at. |
| Signal reads | Tournament analytics, streaks, performance, standings distributions, match quality, player anomalies, per-player explanations. |
| Artifact reads | ML model artifacts, optionally filtered to the active one per kind. |
| Job reads | Active job, recent job list, single job by id. |
| Light mutations | Manual shift override, anomaly-feedback upsert, and the deprecated OpenSkill v1 method (always `410`). |
| Job control | Create a job (`compute` or `train_ml`), plus the `recalculate` and `points` wrappers that create a scoped `compute` job, and the deprecated direct `train` / `infer` dispatch. |

The full method list with request/response schemas is published at `/api/docs`, generated
from `src/openapi_schemas.py` (`OPERATIONS`) and `src/openapi_docs.py` (`DOCS`).

**Durable queues consumed** — by `analytics-worker` only, all three declared in
`shared/messaging/config.py` with a `dlx` dead-letter exchange and a per-queue message TTL:

| Queue | Payload | Runs | TTL |
|---|---|---|---|
| `analytics_job` | `AnalyticsJobRequested` (job id only) | The unified pipeline: dispatch by `AnalyticsJob.kind` to ratings recompute + ML inference (`compute`) or training (`train_ml`) | 1 h |
| `analytics_train` | `AnalyticsTrainRequest` | `train_all_models` for a cutoff tournament | 1 h |
| `analytics_infer` | `AnalyticsInferRequest` | `run_for_tournament` | 30 min |

Each has a matching `<queue>.dlq`.

**Realtime** — `analytics-worker` publishes job lifecycle events (`analytics_job.<status>`,
carrying staged progress and any error) to the `workspace:{id}:analytics_jobs` topic. Each
event is persisted as a `realtime.workspace_event` row and pushed to Redis; the gateway
fans it out to WebSocket clients. Events are workspace-scoped — a job with no
`workspace_id` publishes nothing. Redis being unavailable degrades to "no progress
events", not to a failed job.

**Scheduled work** — `analytics-worker` runs one APScheduler cron job, `nightly_drift_check`
at 03:30 UTC: it builds a feature frame over the last 10 tournaments, computes per-feature
Wasserstein drift, and emits a Sentry breadcrumb when any feature crosses the threshold.

The service publishes no domain events of its own.

## Data owned

Writes the whole `analytics` schema: `algorithms`, `player_shift`, `shifts`, `performance`,
`standings_distribution`, `match_quality`, `player_anomaly`, `anomaly_feedback`,
`ml_model_artifact`, and `job`. Every derived row is keyed on `algorithm_id`, so two
algorithms can hold different opinions about the same `(tournament, player)` without
overwriting each other. It also writes `realtime.workspace_event` rows for job progress.

Reads, never writes: `tournament` (the `tournament.player` roster slot that every number is
anchored on, plus teams, encounters and standings), `matches` (reached through the
encounter, never referenced directly), `registration`, `tenancy`, and `division_grid` (for
canonical division resolution).

Migrations are central — there is one Alembic project at `backend/migrations/` and this
service ships none. Entity diagrams and column-level detail:
[`../../docs/database_erd.md`](../../docs/database_erd.md#analytics--analytics).

## Dependencies

- **PostgreSQL** — the shared database; the `analytics` schema plus the read-only sources
  above.
- **RabbitMQ** — RPC transport for `analytics-svc` and the three durable job queues for
  `analytics-worker`.
- **Redis** — realtime job-progress pub/sub only. Optional at the worker: a failed
  connection disables events and is logged, not fatal.
- **Filesystem** — trained artifacts under `ANALYTICS_MODELS_DIR` (the `analytics-models`
  volume) and the feature cache under `ANALYTICS_FEATURE_CACHE_DIR`. Both are worker-only
  mounts.

No external API calls, so no `proxy` egress.

## Configuration

`backend/env/analytics.env`, layered over `backend/env/common.env`. Both processes load
both files; compose then overrides per process.

Settings that change behaviour:

- `ANALYTICS_MODELS_DIR` — artifact storage root. Worker writes it, both processes read it.
- `ANALYTICS_FEATURE_CACHE_ENABLED` / `_DIR` / `_NAMESPACE` / `_TTL_SECONDS` — file-backed
  cache for expensive feature frames. Not a source of truth: bump the namespace or clear
  the directory after changing feature logic or reprocessing historical logs.
- `ML_TRAIN_DEVICE` (`auto` | `cpu` | `cuda` | `gpu`) and `ML_GPU_FALLBACK` — training
  accelerator and whether GPU failures fall back to CPU.
- Shift-model tuning in `src/core/config.py` (`SHIFT_W_TEAM`, `SHIFT_W_OS`, the
  rank-dependent `SHIFT_INDIV_*` scales and clamps, `SHIFT_DOMINANCE_*`,
  `SHIFT_PLACEMENT_FLOOR`, `SHIFT_CLAMP_TOP_GRID_REF`) and `STANDINGS_PROB_SHARPENING`.
  Each carries a comment saying whether it applies at read time or needs a retrain to take
  effect — most need a retrain.
- `LINEAR_SHIFT_SCALE` and `SMURF_STRONG_LOCAL_Z` / `SMURF_MVP_DOMINANCE` — v1 linear scale
  (applied at read time; recompute v1 shifts to refresh stored rows) and the smurf flag
  thresholds.
- `WORKER_METRICS_PORT` — Prometheus exposition only, not an API.
- `RPC_PREFETCH_COUNT` (default 16) — `analytics-svc` concurrency; the worker uses the
  broker default.

`PORT=8006` in `analytics.env.example` is vestigial; nothing here binds it.

## Running

```bash
cd backend/analytics-service

# Light RPC service: reads, light mutations, job creation
faststream run serve_rpc:app

# Heavy compute worker: job queues + nightly drift check
faststream run serve:app
```

Under compose, `analytics-svc` starts by default; `analytics-worker` is behind the
`workers` profile:

```bash
docker compose --profile workers up -d analytics-worker
```

Both healthchecks in `docker-compose.production.yml` are `python -c "import sys; sys.exit(0)"`
— they prove the interpreter runs, not that the broker is connected.

**GPU.** `docker-compose.gpu.yml` overrides `analytics-worker` alone: it swaps the image to
one built from [`../analytics-worker.gpu.Dockerfile`](../analytics-worker.gpu.Dockerfile),
sets the `ML_TRAIN_DEVICE` / `ML_GPU_FALLBACK` / `NVIDIA_*` variables, and reserves all
NVIDIA devices. `analytics-svc` is untouched — it never trains.

```bash
docker compose -f docker-compose.yml -f docker-compose.gpu.yml --profile workers \
  up -d --build analytics-worker
```

## Operational notes

- **One active job per workspace.** `JobService` refuses a second create while one is
  `pending` or `running` and raises `JobConflict`, which job-control returns as `409`.
  Before answering "is a job active", the service reconciles rows whose progress contains a
  failed stage but whose status is still active.
- **Dispatch is fail-closed.** If RabbitMQ is unconfigured or the publish fails, the job
  row is marked failed and the caller gets `503` / `502` — no job is left `pending` with
  nothing to consume it.
- **Failure is recorded, not retried.** `run_job` catches, rolls back, writes the stage
  detail plus a truncated traceback onto the row, emits a `failed` realtime event, and
  returns — the message is acked. Redelivery would restart a job the row already reports as
  failed. Recovery means creating a new job. Messages that do dead-letter (TTL expiry,
  broker-side nack) land on `<queue>.dlq`.
- **Do not scale `analytics-worker`.** APScheduler runs in-process with no leader lock, so
  a second replica multi-fires the nightly drift check. Replicating `analytics-svc` is
  fine.
- **Cost traps.** Training builds feature frames across every tournament up to the cutoff;
  the feature cache is what keeps that tolerable, and clearing it makes the next training
  run far more expensive. Inference duration is reported as the
  `analytics.inference.duration` metric.

Shift and model recompute procedures live in
[`docs/runbook-shift-recompute.md`](docs/runbook-shift-recompute.md).
