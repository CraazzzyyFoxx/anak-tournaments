# Repository Boundaries

Shared CRUD repositories live in `shared.repository` and are the preferred way
to access ORM rows from multiple services. This is the repository layer's slice of the
full rpc → services → domain → repository → models stack described in
[`backend/ARCHITECTURE.md`](../ARCHITECTURE.md).

## Repository Rules

- Repositories accept an `AsyncSession` and return ORM models or row tuples.
- Repositories do not import FastAPI, Pydantic schemas, Redis/cache clients,
  outbox publishers, or service settings.
- Repository write methods flush only. Services, use cases, or routes own
  `commit` and rollback decisions.
- Keep large analytical queries in query/service modules. Do not hide CTE,
  window, leaderboard, ML feature extraction, achievement condition, or
  recalculation queries behind CRUD repositories.

## Exemptions

`tests/test_repository_boundaries.py` carries two lists, because "allowed" and
"not migrated yet" are different claims:

- `APPROVED_DIRECT_WRITE_FILES` — access that is intentionally not CRUD: outbox
  draining, bracket advancement internals, analytics materialization, bulk
  association-table updates.
- `PENDING_REPOSITORY_MIGRATION` — direct writes that predate their repository.
  Every entry is a line to delete once the repository method exists, not a
  pattern to copy.

Both are ratcheted: an entry whose file no longer writes directly — or no longer
exists — fails the suite, so finishing a migration forces the line out. Without
that ratchet the list rotted unnoticed into twelve entries for files deleted
with `auth-service` and the old `tournament-service` HTTP routes, while the
services that replaced them went unscanned.
