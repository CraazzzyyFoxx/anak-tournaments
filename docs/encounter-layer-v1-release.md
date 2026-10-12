# Encounter layer V1: release note and cutover runbook

V1 replaces the encounter's `home` / `away` pair with N participations (`encounter.team`), moves the
encounter tables into the `encounter` schema, and gives games, claims and reports one shape for a duel
and for a lobby. The data cutover is the `enclayer01` revision, followed by `enclayer01b`. This page is
what an operator needs to ship it; the model itself is in [`database_erd.md`](./database_erd.md) and
[`business-logic-inventory.md`](./business-logic-inventory.md).

## Breaking API changes

Anything that reads encounters over the API, the gateway OpenAPI manifest or the realtime topics must
move in the same deploy.

- **Encounters:** `teams[]` (one entry per seat, in slot order) replaces `home_team`, `away_team`,
  `home_score` and `away_score`; `slot_count` says how many seats the encounter holds. Sort keys
  `home_team_id` / `away_team_id` are gone from the user-encounter list. Series claims and reports are
  `teams[]`-shaped too (`TeamReportRead`).
- **Scrims:** `teams[]`, `viewer_slot` and `team_names` replace `home_team`, `away_team`, `viewer_side`
  and the `home_team_name` / `away_team_name` pair.
- **Notifications:** `encounter.scheduled` and `encounter.dispute_review` payloads carry `team_names`
  (every seat's name, in slot order); `home_team_name` / `away_team_name` are no longer written or read.
  Stored rows are rewritten by `enclayer01`. `event_outbox` messages queued before the cutover still carry
  the old pair and render without team names; drain the outbox before the deploy.
- **Brackets:** advancement links speak positions (`source_position`: place that advances, `target_slot`:
  seat it fills) instead of winner/loser and home/away. Pick-ban rulesets speak `slot:N` actors.
- `matches.match.home_team_id` / `away_team_id` and the `team_id` columns of `matches.statistics`,
  `kill_feed` and `event` are unchanged until V4. What changes is their foreign keys to `tournament.team`:
  deleting a team no longer deletes the games it played (and a team that still has a match cannot be
  deleted at all).

## Migration steps

Take a backup first. `enclayer01` has no downgrade: going back means restoring the backup.

1. **Pre-flight, days before the window.** Every query must return zero rows.

   ```sh
   psql "$DATABASE_URL" -f backend/scripts/enclayer01_preflight.sql
   ```

   Thirteen queries. They cover the decisions the migration refuses to make (diverging roster rows, one
   member in two rosters of an encounter, result status against encounter status, replay codes at an
   ambiguous position) and every row the converters would reject (duplicate link target slots,
   cross-tournament links, `best_of < 1`, one team on both sides, a team of another tournament, a stage of
   another tournament, pick-ban entries on an unseated side, FFA encounters outside an `ffa_league` stage).
   The revision runs the same queries first and stops with the ids; the file only buys time.
2. **Upgrade.** Quiet or stop the services that write encounters, then:

   ```sh
   cd backend && alembic upgrade head
   ```

   This runs `enclayer01`, then `enclayer01b`. `enclayer01` takes ACCESS EXCLUSIVE on the encounter,
   tournament, stage and team tables and on `matches.*` for the whole data half (retrying on lock timeout),
   and does everything in one transaction. `enclayer01b` validates the seven `matches.*` team foreign keys
   in its own transaction, outside that window, with locks that do not block reads or writes; `alembic`
   commits `enclayer01` before it starts, so if `enclayer01b` fails (or is interrupted) `enclayer01` stays
   applied and a second `alembic upgrade head` resumes at `enclayer01b`.
3. **Deploy V1** on the migrated database.
4. **Lobby standings.** The migration writes every migrated lobby seat at score 0 and no placement; the
   scoring formula runs in Python. Right after the deploy, with the services quiet:

   ```sh
   cd backend
   python -m scripts.enclayer01_recompute_lobbies --dry-run   # lists every seat that would change
   python -m scripts.enclayer01_recompute_lobbies             # writes them
   ```

   A second real run changes nothing. If this step is skipped, every migrated lobby reads all zeros
   and nothing errors. Compare a few lobbies with their `/standings` from before the cutover.
5. **Reconcile.**

   ```sh
   psql "$DATABASE_URL" -f backend/scripts/enclayer01_reconcile.sql
   ```

   The first result set must say `ok` on every class; the second (skipped rows) must be empty. The
   migration skips rows it cannot resolve without counting them: a report from a side with no seat, a
   replay code at a position with no live game, a journal line of a team without a participation, a roster
   row collapsed into its twin. The legacy tables stay, so nothing is lost yet, but `enclayer02` (the gated
   drop of the legacy columns and tables, next deploy) must not run while this report has a finding.
   A claim, team report, readiness or replay code counts as carried only if it still carries what the legacy
   row carried (creation time and author; the code itself), so a V1 row written at the same key never hides a
   skipped one. The converse: a migrated replay code that a captain has since re-filed is listed too; look at
   it and resolve it in the data before `enclayer02`.
   Also check `SELECT conrelid::regclass, conname FROM pg_constraint WHERE NOT convalidated` returns no row.

## Not yet measured

- **The Python half of the backfill** (`_audit`, `_result_source`, `_participations`, `_game_results`,
  `_pools`, `_notifications`) builds whole-table lists and writes them row by row with `executemany`. It has
  run only on a seeded fixture (a dozen encounters; the whole chain upgrades in a few seconds), never on a
  production-sized dump. Its duration, and therefore the length of `enclayer01`'s ACCESS EXCLUSIVE window,
  is unknown. Time it on a restored production backup before announcing the window.
- **`enclayer01b`'s scan** of the 27M-row `matches.*` tables is likewise unmeasured. It does not block
  traffic, but it holds the `alembic upgrade head` run until it finishes.
- Steps 2-5 of the plan's Task 15 (production restore, rehearsal, smoke on the migrated copy) have not
  been run: no production data was available to the branch.

## Databases already at an older `enclayer01`

A development or staging database that applied `enclayer01` before the pending-hold audit action existed
lacks the enum label `auto_pending`, and `alembic` will not rerun the revision. Add it by hand:

```sql
ALTER TYPE encounter.encounterresultauditaction ADD VALUE IF NOT EXISTS 'auto_pending';
```

Such a database also never ran `enclayer01b` (no harm: `alembic upgrade head` applies it) and keeps
the legacy `home_team_id` / `away_team_id` foreign keys on `encounter.encounter` with `ON DELETE CASCADE`,
which `enclayer01` now drops. Drop them by hand, or recreate the database:

```sql
ALTER TABLE encounter.encounter
  DROP CONSTRAINT IF EXISTS encounter_home_team_id_fkey,
  DROP CONSTRAINT IF EXISTS encounter_away_team_id_fkey;
```

Its `pick_ban_session.pool_json` and lobby `result_source` values are also the earlier revision's. No
shared environment is known to have applied that text; if one did, restore it from the pre-V1 backup and
upgrade again.

## Tests that pin this

- `backend/tests/test_enclayer01_upgrade.py` upgrades a legacy-shaped, populated database through the whole
  chain, then runs the pre-flight, the lobby recompute and the reconcile on it.
- `backend/tests/test_enclayer01_convert.py` and `backend/tests/test_enclayer01_preflight_sql.py` pin the
  converters and keep the operator's SQL identical to the revision's queries.
- `backend/shared/tests/test_encounter_layer_constraints.py` pins the schema guarantees, including that
  deleting a team keeps a migrated encounter and its matches.
