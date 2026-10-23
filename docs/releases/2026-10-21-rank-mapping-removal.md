# Rank mapping removal: release note

The Overwatch rank collector no longer has a configurable rank mapping. The `parser.rank_mapping` setting, the admin
"Mapping" tab of the rank collector (`/admin/collectors/rank?tab=mapping`) and the `rankMapping` admin slot are gone.
An OverFast division+tier always gets its value from the Overwatch ladder (`shared/disciplines/overwatch/ladder.py`),
as League and Deadlock ranks already did. Each workspace's grid places that value on its own divisions (the tiers'
native ranges) when ranks are read, as before.

Why: the setting was global, so it could not tune one workspace, and it was applied when a snapshot was written, so a
`rank_value` could contradict the native `division`/`tier` stored on the same row. Its editor caused the
`owmapfix01` incident: Bronze to Platinum read one division too high.

## Changes

* **Collector.** `shared/disciplines/overwatch/collector/mapping.py` is removed. `domain.map_division_tier_to_rank_value`
  reads the ladder; every snapshot is stamped `domain.RANK_MAPPING_VERSION` (`ow2-default-v2`, unchanged).
  `RankStateService.record_result` loses its `lookup` and `mapping_version` arguments.
* **Settings.** `SETTINGS_KEY_RANK_MAPPING`, `RankMappingConfig`, `RankMappingEntry` and
  `SettingsProvider.get_rank_mapping_config` are removed. `PUT /api/v1/admin/settings/parser.rank_mapping` is now an
  unknown key.
* **Frontend.** The Mapping tab, `RankMappingPanel`, `ow-rank-mapping.ts`, the `RankMappingConfig`/`RankMappingEntry`
  types, the `collectors.mapping` and `collectors.views.mapping` messages and `owRankValue` are removed.
  `ow-ladder.generated.json` no longer carries `ow_rank_values`.
* **Migration `owmapdrop01`** (after `matchmode01`):
  1. every Overwatch `rank.rank_snapshot` row whose `rank_value` differs from the ladder value of its native
     `division`/`tier` gets the ladder value and the `ow2-default-v2` stamp, whatever its old stamp (the editor saved
     overrides under `ow2-default-v2` too); a cell the ladder does not know is left alone;
  2. a row that now repeats the previous row of its `(account, role, platform)` series is deleted, so the table stays a
     series of changes (`rankdedup01`);
  3. the `parser.rank_mapping` settings row is deleted.

  Downgrade is a no-op. `balancer.registration_role.rank_value` is not touched: those are recorded registrations.

## Not changed

The division-grid import option "Copy the Overwatch rank mapping" (`include_native_rank_mappings`) copies a grid's
native ranges. It is a different feature and stays.

## Verification

* `uv run pytest shared/tests/test_overwatch_rank_mapping.py shared/tests/test_overwatch_rank_changes.py
  shared/tests/test_overwatch_rank_tasks.py` (cwd `backend`).
* `owmapdrop01` was run on a scratch database seeded at `matchmode01` with:
  * an override row and the ladder row after it in one series: the override row is recomputed and the repeat deleted;
  * an override saved under `ow2-default-v2`: recomputed;
  * an unknown division, an unranked row and a LoL row: untouched;
  * `parser.rank_mapping` and `parser.rank_collection` settings rows: only `parser.rank_mapping` is deleted.
* `uv run python scripts/export_ow_ladder.py --check`, `uv run alembic heads` (single head `owmapdrop01`).
* Frontend: `bun run typecheck`; `bunx vitest run src/disciplines/registry.test.ts
  src/app/admin/collectors/rank/page.behavior.test.tsx src/i18n`.
