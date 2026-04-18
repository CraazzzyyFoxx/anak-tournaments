# Mixtura Balancer Tournament

Tournament team balancing service using NSGA-II multi-objective genetic algorithm with C++ core implementation.

## Overview

The service receives player data and role preferences, then generates optimized team compositions that balance:
- **Team rating fairness** - equal total skill across teams
- **Role fairness** - equal role distribution across teams
- **Priority satisfaction** - player role preferences are respected

## Architecture

```
┌─────────────────────┐     ┌──────────────────────┐
│   RabbitMQ Queue    │────▶│  Tournament Balancer  │
│  (balance request)  │     │     Service (Fast)   │
└─────────────────────┘     └──────────┬───────────┘
                                       │
                                       ▼
                              ┌──────────────────┐
                              │  nsga_balancer   │
                              │  (C++ via pybind) │
                              │   NSGA-II Engine  │
                              └──────────────────┘
```

## Project Structure

```
.
├── src/tournament_balancer_service/     # Main service
│   ├── app/                             # FastStream app & schemas
│   └── domain/                          # Balance engine logic
├── nsga_balancer/                       # C++ NSGA-II implementation
│   ├── nsga_engine.hpp                 # C++ header
│   ├── nsga_engine.cpp                  # C++ implementation
│   ├── pybind11_bindings.cpp            # Python bindings
│   └── nsga_balancer/                   # Python wrapper
│       ├── wrapper.py                   # High-level API
│       ├── quality_evaluator.py         # Solution quality metrics
│       └── models.py                    # Data models
└── pyproject.toml                       # Project dependencies
```

## Dependencies

- **Python 3.13+**
- **FastStream** - Async messaging (RabbitMQ)
- **DEAP** - Evolutionary computation framework
- **pymoo** - Multi-objective optimization
- **scipy** - Scientific computing
- **nsga-balancer** - C++ NSGA-II bindings (local)

## Installation

```bash
# Install dependencies
uv sync

# Build C++ extension (if needed)
cd nsga_balancer
pip install -e .
```

## Running the Service

```bash
# Start the balancer service
uv run python -m tournament_balancer_service.app.main
```

The service listens on RabbitMQ queue `mix_balance_service.balance`.

## API

### Request

```python
BalanceRequest(
    draft_id="uuid",
    players=[
        Player(
            member_id="uuid",
            roles={
                "role_id": PlayerRole(rating=1500, priority=1)
            }
        )
    ],
    balance_settings=BalanceSettings(
        players_in_team=5,
        roles={"tank": RoleSettings(count_in_team=1), ...},
        math=MathSettings(
            population_size=300,
            generations=100,
            num_pareto_solutions=50,
            ...
        )
    )
)
```

### Response

```python
DraftBalances(
    draft_id="uuid",
    balances=[
        Balance(
            quality=QualityMetrics(
                dp_fairness=0.95,
                dp_role_fairness=0.92,
                vq_uniformity=0.88,
                role_priority_points=85.5,
                fitness_balance=0.02,
                fitness_priority=15.0,
            ),
            teams=[Team(players=[...], total_rating=7500)],
        )
    ]
)
```

## Quality Metrics

| Metric | Description |
|--------|-------------|
| `dp_fairness` | Dominance perspective fairness (0-1) |
| `dp_role_fairness` | Role distribution fairness (0-1) |
| `vq_uniformity` | Variance-based uniformity (0-1) |
| `role_priority_points` | Priority satisfaction score |
| `fitness_balance` | NSGA balance objective |
| `fitness_priority` | NSGA priority objective |

## Configuration

Environment variables (see `src/tournament_balancer_service/env_config.py`):
- `RABBIT_URL` - RabbitMQ connection string
- `LOG_LEVEL` - Logging level
