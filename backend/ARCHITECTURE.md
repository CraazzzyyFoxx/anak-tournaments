# Backend code architecture: what goes where, in every service

This is the code-level counterpart to [`../docs/architecture.md`](../docs/architecture.md).
That document describes the *system*: processes, RabbitMQ, Postgres, deployment topology.
This one describes what happens **inside one service's `src/`** — the layers every domain
(`hero`, `draft`, `registration`, `token_validation`, …) is built from, and the rule for
which layer new code belongs in.

It is not a proposal. It is a description of the pattern `identity-service` has followed
since it was written, that `app-service` (2026-08-20) and `balancer-service` (2026-08-21)
were converted to. Every new domain, in every service, follows it. Case studies with before/
after numbers live in `docs/plans/2026-08-20-app-service-oop-repositories.md` and
`docs/plans/2026-08-21-balancer-service-oop-repositories.md`.

## The five layers

```
serve.py                          FastStream worker entrypoint. Registers every rpc/*.py
                                   module's subscribers on the broker. No HTTP, no business logic.
  ↓
src/rpc/<domain>.py                TRANSPORT. register(broker, logger); one @broker.subscriber
                                   per "rpc.<service>.<domain>.<method>" topic. Decodes the
                                   envelope, resolves the actor/workspace, gates permissions,
                                   calls exactly ONE service method, wraps the result in
                                   c.envelope(...). Owns zero SQL, zero business rules.
  ↓
src/services/<domain>/*.py         ORCHESTRATION. One class + one exported module-level
                                   singleton per cohesive responsibility. Takes `session:
                                   AsyncSession` as the first parameter of every method — never
                                   owns or creates one. Talks to repositories and to domain/,
                                   maps ORM rows to schemas, applies cache decorators, decides
                                   commit boundaries are the CALLER's job (see "Session and
                                   transaction ownership" below).
  ↓
src/domain/**/*.py                 PURE LOGIC. Dataclasses, algorithms, validation rules. Zero
  (or shared/domain/**/*.py for    `AsyncSession`, zero `await`, zero `asyncio`. Safe to call
  logic shared across services)    from a synchronous test with no DB fixture and no
                                   `asyncio.run`. See "The domain/ boundary, precisely" below.
  ↓
shared.repository.*                CRUD. `BaseRepository[Model]` + concrete repos
                                   (`HeroRepository`, `DraftPickRepository`, …). Accepts a
                                   session, returns ORM rows or row tuples. Never imports
                                   Pydantic, FastAPI/FastStream, cache clients, or outbox
                                   publishers. Write methods flush only — see
                                   `backend/docs/repository-boundaries.md`.
  ↓
shared.models.* / src/models.py    ORM. SQLAlchemy models, one shared `MetaData`, the single
                                   source of truth for the schema (`backend/migrations/`).
```

`src/schemas/*.py` sits beside this stack, not inside it: Pydantic wire contracts for the RPC
boundary (and OpenAPI docs generation). Schemas convert *at* the boundary
(`schemas.HeroRead.model_validate(hero, from_attributes=True)` in a service's `to_read`, or
`DraftFeasibilityResponse.model_validate(report)` in an rpc handler) — they are never passed
down into `domain/` or `shared.repository`, and `domain/`'s own dataclasses are never redefined
as schemas just to "have one type." Two vocabularies exist on purpose: `schemas` is what the
wire carries; `domain` is what the algorithm thinks in. See
`docs/plans/2026-08-21-balancer-service-oop-repositories.md` §6 for the fuller reasoning
(`DraftSnapshot`/`DraftResult` hold live ORM rows and would force
`arbitrary_types_allowed`, defeating Pydantic validation, if merged into `schemas`).

## Concrete shape of a layer

**`rpc/<domain>.py`** (`app-service/src/rpc/heroes.py`):

```python
def register(broker: Any, logger: Any) -> None:
    @broker.subscriber("rpc.app.heroes.leaderboard")
    async def _leaderboard(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            await c.gate_tournament(session, data, c.q1(data, "tournament_id", int))
            ws = await resolve_workspace_context(session, c.q1(data, "workspace_id", int))
            return await hero_service.get_hero_leaderboard(session, hero_id=..., grid=ws.grid)

        return await c.envelope(logger, "heroes.leaderboard", op, session_factory=_SF)
```

**`services/<domain>/service.py`** (`app-service/src/services/hero/service.py`):

```python
class HeroService:
    def __init__(self, *, queries: HeroQueries = hero_queries, repo: HeroRepository = HeroRepository()) -> None:
        self.queries = queries
        self.repo = repo

    async def get_hero_leaderboard(self, session: AsyncSession, hero_id: int, ...) -> Paginated[...]:
        rows, total = await self.queries.get_hero_leaderboard(session, hero_id=hero_id, ...)
        ...

heroes = HeroService()
```

`queries.py` is the same shape, split out only when a domain's analytical SQL (leaderboards,
window functions, recalculation queries — anything `repository-boundaries.md` bans from a
CRUD repository) is large enough to want its own class, its own singleton, and its own
`__all__`. Small domains keep everything in one `service.py`; large ones (`balancer-service`'s
`draft` package) split by *feature*, not by CRUD-vs-analytics — `lifecycle.py`,
`selection.py`, `board.py`, `role_edit.py`, `export.py`, `clock.py` are six classes, six
singletons, one shared injected `feasibility_service`.

**`domain/<x>.py`** (`balancer-service/src/domain/draft/rules.py`):

```python
def resolve_pick_slot(shape: RosterShape, counts: Mapping[str, int], player: DraftPlayer, target_role: HeroClass | None) -> SlotDecision:
    if not role_is_legal(player, target_role if shape.has_role_slots else None):
        raise _err("illegal_role", ...)
    ...
```

No `session`, no `await`, no repository import. `services/draft/selection.py`'s
`DraftSelectionService.select` calls `rules.resolve_pick_slot(...)` synchronously, in the
middle of an otherwise-async method.

## The `domain/` boundary, precisely

A function or dataclass belongs in `domain/` (per-service `src/domain/` or, when the logic is
useful to more than one service, `shared/domain/` — e.g. `shared/domain/roster_shape.py`,
`invite_token.py`, `team_roster.py`, consumed by both `balancer-service` and
`tournament-service`) **iff it never touches `AsyncSession`, never awaits, and never runs on
the event loop**. Concretely:

- Value types (dataclasses/`NamedTuple`s the algorithm passes around) that don't need pydantic
  validation because nothing external ever constructs one directly.
- Deterministic algorithms: bipartite matching, genetic/NSGA balancing, feasibility analysis,
  role/rank scoring, seat ordering, slot-vocabulary rules.
- Validation functions that raise a domain error from in-memory state (`validate_draft_rounds`,
  `role_is_legal`) — they take the already-loaded rows as arguments; loading those rows is the
  service's job, not theirs.

Everything else — anything that calls `session.execute`, `session.get`, `session.add`, awaits a
repository method, or runs `asyncio.to_thread` to offload the pure algorithm above off the event
loop — is a method on a `services/<domain>/*.py` class, never a `domain/` function. `domain/`
code is exactly what you can unit-test with plain constructed objects and no `pytest.mark.db`,
no `AsyncSession` mock, no `asyncio.run`.

Do not force a class onto pure code just to "match the pattern": a `domain/` module with a
curated `__all__` and direct imports from services/tests **is** the correct shape for that code.
Forcing a singleton class onto a pure algorithm is the "pointless split" the app-service
refactor's own correction pass explicitly walked back — see §6-7 of
`docs/plans/2026-08-20-app-service-oop-repositories.md`.

## Session and transaction ownership

- `AsyncSession` is always a parameter, threaded through every layer below `rpc/`. Nothing
  below `rpc/` ever calls `db.async_session_maker()` or opens its own session.
- Repository write methods (`create`, `update`, `delete`) **flush only**. `commit()`/`rollback()`
  are decided by the caller that owns the unit-of-work — usually the `rpc/*.py` handler, inside
  or just after `c.envelope`'s `op(session)` callback (see `rpc/draft.py`'s explicit
  `await session.commit()` after every mutating handler).
- A service method that needs a read-then-write invariant to hold (the pick-selection race, a
  locked re-seed) does the locking read itself via a repository's `get_for_update`/
  `with_for_update(skip_locked=True)` method — never a bare `sa.select(...).with_for_update()`
  inlined in the service, and never generalized into `BaseRepository.get(..., lock=True)`; each
  locking shape is preserved verbatim in its own named repository method.

## Class + singleton, not a bag of functions, not a DI container

Every `services/<domain>/*.py` file exports exactly one class and one instance of it, built with
its collaborators' own singleton defaults:

```python
class DraftSelectionService:
    def __init__(self, *, teams_repo: DraftTeamRepository = DraftTeamRepository(), feasibility: DraftFeasibilityService = feasibility_service) -> None:
        ...

selection_service = DraftSelectionService()
```

This buys constructor-injectable collaborators for tests (`DraftSelectionService(teams_repo=fake)`)
without a DI framework — the default argument *is* the production wiring, and a test overriding
one keyword is the entire seam. Do not add a container, a factory registry, or a `Protocol`-based
interface for a service that has exactly one implementation; that is the abstraction
`ponytail`/the app-service correction pass exists to keep out.

## Repository rules

Unchanged, repo-wide, since `backend/docs/repository-boundaries.md`:

- Repositories accept an `AsyncSession`, return ORM models or row tuples.
- Repositories never import Pydantic, FastAPI/FastStream, cache clients, outbox publishers, or
  service settings.
- Write methods flush only.
- Large analytical queries (CTEs, window functions, leaderboards, ML feature extraction,
  achievement/recalculation queries) live in a domain's `queries.py`/service class, never behind
  a CRUD repository method.
- `backend/tests/test_repository_boundaries.py` enforces this by regex across every service; its
  allowlist is for pre-existing, intentionally-not-CRUD direct writes (outbox draining, bracket
  advancement, bulk association-table updates) — new files are not added to it for convenience.

## Import layering between domains, when it's worth enforcing

Most services are a flat set of mutually-non-importing domains (`balancer-service`'s
`admin/*`/`draft/*`; most of `identity-service`) — nothing to enforce beyond "don't import
another domain's private module," checked by grep at review time, not by tooling.

Only reach for an `.importlinter` contract when a service has grown a genuine multi-level
dependency hierarchy — `app-service`'s `services.achievements` → `services.{dashboard,user}` →
`services.{hero,map,statistics,workspace}` (`app-service/.importlinter`,
`backend/docs/architecture/layering.md`). The contract states the layers, forbids the reverse
direction, and grandfathers pre-existing violations by name so they can't grow silently. Adding
one to a flat service (`balancer-service`) would enforce nothing real; skip it there and say so
in the plan doc, as `docs/plans/2026-08-21-balancer-service-oop-repositories.md` §5/§7 do.

## Testing conventions that fall out of this

- `domain/` — plain `pytest` functions, constructed objects, no fixtures, no `pytest.mark.db`,
  deterministic. This is where property-style and exhaustive-case tests belong (bipartite
  matching, slot-vocabulary edge cases, seat-order rules).
- `services/<domain>/*.py` — either a real-Postgres integration test (`test_draft_integration.py`
  style: a throwaway session against migrated schema, exercising the full flow) or a unit test
  against a fake repository passed to the constructor. Prefer the former for anything with a
  concurrency-sensitive repository method (locking reads, optimistic-lock finalize); it is the
  only way to actually exercise the lock.
- `rpc/<domain>.py` — `backend/tests/test_rpc_route_parity.py`-style contract tests (route
  presence, auth requirements) rather than re-testing business logic already covered one layer
  down.

## Checklist: adding a new domain (or a new file inside an existing one)

1. **Repository first.** If the domain needs new CRUD, write the repository methods in
   `shared/repository/<x>.py` before any consumer code — this is the "shared prerequisite"
   step; every layer above it depends on the exact method shape.
2. **Pure logic next, if any.** Any algorithm/validation/scoring that doesn't touch a session
   goes in `src/domain/<x>.py` (or `shared/domain/` if more than one service will use it), with
   a curated `__all__`. Write and run its tests with no DB fixture before touching a service.
3. **Service class.** One class, one singleton, constructor-injected repositories/domain
   collaborators with singleton defaults. `session` is a method parameter, never stored on
   `self`.
4. **RPC handler.** One `@broker.subscriber` per method, decoding via `src.rpc._common`
   (`c.q1`, `c.require_id`, `c.gate_*`, `c.envelope`), calling exactly one service method, no
   inline SQL, explicit `session.commit()` if the handler mutates.
5. **Verify:** `ruff check`, the service's `pytest` suite (with a real, migrated Postgres —
   `alembic upgrade head` first if the DB is fresh), `python -c "import serve"` to catch import
   cycles, and `lint-imports` if the service has an `.importlinter`.
