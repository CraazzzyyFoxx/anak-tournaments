# Repository Notes

## Structure
- Main service package is `src/mixtura_balancer_tournament`, not the older `tournament_balancer_service` path still mentioned in `README.md`.
- `nsga_balancer/` is a separate local package built from C++ via `scikit-build-core` + `pybind11`; the root project pulls it in through `[tool.uv.sources]`.
- Runtime entrypoint is the exported `app` in `mixtura_balancer_tournament.__init__`, which forwards to `mixtura_balancer_tournament.app.main:app`.

## Commands
- Install/sync the repo from the root with `uv sync`.
- Run the service from the root with `uv run faststream run mixtura_balancer_tournament:app`.
- Run focused tests for the C++ package with `uv run --directory nsga_balancer pytest tests/test_models.py`.
- The only configured lint/test tooling in repo config lives under `nsga_balancer/`: `pytest` and `ruff` are configured there, not at the root.
- Fore reinstalling c++ module use `uv sync --force-reinstall`

## Environment And Runtime
- The service subscribes to RabbitMQ queue `mix_balance_service.balance`.
- RabbitMQ settings come from process env vars `RABBITMQ_HOST`, `RABBITMQ_PORT`, `RABBITMQ_USER`, `RABBITMQ_PASSWORD`, and `RABBITMQ_VHOST` in `src/mixtura_balancer_tournament/env_config.py`.
- `README.md` mentions `RABBIT_URL`/`LOG_LEVEL`, but current code does not use those names.
- `pydantic-settings` is not configured with an `env_file`; a local `.env` file is ignored unless the shell exports those variables first.
- Startup logging always creates `.local/temp.log` via `setup_logging()`.

## C++ Package Gotchas
- `nsga_balancer` requires a compiled `_core` extension; import failures come from the native module not being built for the active Python.
- Native build settings are in `nsga_balancer/CMakeLists.txt`: C++20, `Python 3.10+`, optimized build flags, `pybind11_add_module(_core ...)`.
- If you touch C++ bindings or native models, verify from `nsga_balancer/` rather than assuming root-level Python checks cover it.

## Request Model Constraints
- `BalanceRequest` validation is strict: every player role must exist in `balance_settings.roles`, subroles must be declared there first, total role counts must equal `players_in_team`, and player count must be divisible by `players_in_team`.
- The service models still accept legacy payload keys like `max_in_team`, but the canonical field names in current code are `players_in_team` and `count_in_team`.
