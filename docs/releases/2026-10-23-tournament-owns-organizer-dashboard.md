# Tournament owns the organizer dashboard

The organizer dashboard, its trends and the tournament readiness checklist moved from app-service to
tournament-service. **HTTP is unchanged**: paths, query parameters, permission gates, field masking, response bodies
and error codes stay the same; only the RPC subject behind each route, and the process that answers it, changed. No
migration, queue or cache change ships. Deploy the **gateway, `app-svc` and `tournament-svc` from one SHA, together**
(section 3). Companion change of the same day: [stats owns the statistics reads](./2026-10-23-stats-owns-statistics-reads.md).

## 1. Subjects

| HTTP | Old subject | New subject |
| --- | --- | --- |
| `GET /api/v1/admin/dashboard` | `rpc.app.statistics.admin_dashboard` | `rpc.tournament.admin_dashboard` |
| `GET /api/v1/admin/dashboard/trends` | `rpc.app.statistics.admin_dashboard_trends` | `rpc.tournament.admin_dashboard_trends` |
| `GET /api/v1/admin/tournaments/{id}/readiness` | `rpc.app.statistics.tournament_readiness` | `rpc.tournament.tournament_readiness` |

* app-service has no `rpc.app.statistics.*` subject left.
* **OpenAPI.** The component schemas are renamed `app.AdminDashboard`, `app.Dashboard*` and `app.TournamentReadiness` →
  `tournament.AdminDashboard`, `tournament.Dashboard*` and `tournament.TournamentReadiness`, with the same shapes.
  `gateway/internal/openapi/schemas.json` and `frontend/src/types/api.generated.ts` are regenerated.
* **Who must act:** HTTP clients, nobody. Anything that publishes the old subjects straight onto RabbitMQ must switch
  to the new ones: after the deploy the old subjects have no consumer and time out.

## 2. Code layout

* **Service.** `app-service/src/services/dashboard/` → `tournament-service/src/services/dashboard/` (`overview.py`,
  `trends.py`, `readiness.py`); `app-service/src/rpc/statistics.py` → `tournament-service/src/rpc/dashboard.py`.
* **Schemas.** App `schemas/{dashboard,dashboard_trends}.py` → tournament `src/schemas/`; app `schemas/statistics.py`
  (`TournamentReadiness`) → tournament `src/schemas/readiness.py`.
* **Helpers.** `optional_discipline` → tournament `src/rpc/_helpers.py::_optional_discipline`; app's `src/rpc/_common.py`
  keeps only `gate_tournament`.
* **Gateway.** `gateway/internal/app/tournament_admin_routes.go` → `gateway/internal/tournament/dashboard_routes.go`
  (`tournament.DashboardRoutes`, registered on the tournament edge).
* **Reads.** The dashboard keeps reading across schemas from its new home: `achievements.evaluation_run` and
  `achievements.rule` (evaluation status), `stats.match` through `encounter.has_logs` (log coverage), `balancer.balance`
  and `draft.session`. See the [tournament-service README](../../backend/tournament-service/README.md#organizer-dashboard).
* **Import layering.** With the dashboard gone, app-service's `services-layers` contract is replaced by an independence
  contract (`services.user` and `services.workspace` never import each other)
  ([layering](../../backend/docs/architecture/layering.md)).
* **Tests** moved to tournament-service: `test_admin_dashboard.py`, `test_dashboard_trends.py`,
  `test_tournament_readiness.py`, `test_mix_encounters_stay_invisible.py`, `test_optional_discipline.py` and the
  `encounter_seed.py` helper; the `rpc` and `db` fixtures they use are in tournament `tests/conftest.py`.

## 3. Deploy

A new gateway publishes `rpc.tournament.*` subjects an old `tournament-svc` does not answer; an old gateway publishes
`rpc.app.statistics.*` subjects a new `app-svc` no longer answers. Either mix fails the three admin routes on the RPC
deadline until all three run the new image; `make prod-up` (the release workflow) recreates them in one pass. No
durable queue changes. The three old `rpc.app.statistics.*` request queues are non-durable, lose their consumer and,
once the new gateway runs, receive nothing: they vanish on the next broker restart, or can be deleted by hand.
