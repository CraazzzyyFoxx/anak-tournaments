# Admin dashboard: release note

`/admin` is now an organizer's working page for one workspace instead of lifetime counters. Every block loads, fails
and hides on its own; a block the reader's role cannot see is absent, never zero.

## Behaviour

* **Phase cards.** One card per tournament in work, phase taken from `Tournament.status`: `announcement` → Подготовка,
  `registration` → Регистрация, `check_in`/`draft` → Формирование команд, `live`/`playoffs` → Турнир идёт,
  `completed` → Итоги while wrap-up is open (max 14 days after `end_date`, else the last confirmed encounter). Hidden
  tournaments are shown with a "Скрыт" pill. Live first, then by nearest schedule deadline, wrap-up last; three cards,
  the rest under "Ещё N". Preparation and formation cards show the hub checklist's open items for their phase.
* **Wrap-up is done** when no result is `pending_confirmation`/`disputed`, every duel has logs (when the tournament uses
  logs), achievements were evaluated for the tournament (or the game has no enabled rules), and no standings
  recalculation is pending. A done tournament leaves the page.
* **Ближайшие 7 дней.** Phase-schedule starts and ends; a start passed by more than 10 minutes whose status was not
  reached is pinned on the left as overdue.
* **Нужно сделать.** Only tournaments with a card; critical (disputed, overdue, unconfirmed results, overdue phase,
  pending registrations within 24 h of closing) before warnings.
* **Бэклог.** Everything else, collapsed, per tournament, with workspace totals.
* **Тренды.** Participants, newcomer share, duel log coverage and median match-end-to-confirmation over the last 10
  finished, public, non-league tournaments of every game; hovering a point names its tournament and game.
* **No game filter.** Every game's tournaments are shown together, each with its game mark.
* **Активность.** Staff audit entries of the last 7 days (`admin`, `api_key`, `discord`, `challonge`), own actions
  hidden unless "Включая мои"; consecutive same actor + action rows merged.
* **Состояние платформы** (superusers): stream poller, rank collector per game, unresolved names, ML model freshness
  (≥3 finished tournaments after the training cutoff), failed/partial achievement runs in 7 days. Collapses to one line
  when green. Without a selected workspace the page shows only this block.
* **Realtime.** The page subscribes to each card tournament's and the workspace's invalidation topic and refetches the
  dashboard and activity (400 ms debounce).

## Wire

* New `GET /api/v1/admin/dashboard` (`rpc.app.statistics.admin_dashboard`) and `GET /api/v1/admin/dashboard/trends`
  (`rpc.app.statistics.admin_dashboard_trends`): auth required, `workspace_id` required (422), 403 without a workspace
  `tournament.read`/`team.read`/`match.read`/`user.read`/`achievement.read` (trends: `tournament.read`).
* **Removed** the public `GET /api/v1/statistics/dashboard` (`rpc.app.statistics.dashboard`, `DashboardStats`).
* `GET /api/v1/admin/audit` accepts `since`, `exclude_actor_user_id` (keeps machine rows) and `source`
  (comma-separated `AuditSource` values; unknown → 422).
* Fix: `GET /api/v1/admin/ws/{workspace_id}/achievements/rules/runs` answered 422 for every run (`EvaluationRunRead.id`
  was typed `str`, the model key is a UUID).

## Verification

`uv run pytest app-service/tests/test_admin_dashboard.py app-service/tests/test_dashboard_trends.py
app-service/tests/test_audit_list.py app-service/tests/test_mix_encounters_stay_invisible.py
app-service/tests/test_users_admin_workspace_scope.py app-service/tests/test_tournament_readiness.py` and
`stats-service/tests/test_achievement_runs_reply.py` against the test Postgres; `go test` for `gateway/internal/{edge,
apidocs,app,openapi}`; `check_rpc_docs.py`; `bun run typecheck`, `bun run lint`, `bun run lint:zones`, `bunx vitest
run`; browser check of `/admin` at 1440, 1024 and 390 px with fixture responses.
