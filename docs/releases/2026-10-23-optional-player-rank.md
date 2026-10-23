# A tournament player's rank may be unspecified: release note

`tournament.player.rank` is nullable. NULL means "rank not specified", for example a 1v1 duel or a tournament that
never collects ranks. A specified rank is 1 or more. Until now every writer stored `0` for an unranked member. Readers
then put that member in the grid's floor division (Bronze 5 on the default ladder), and averages counted the `0`.
Moonrise's duels stored `0` for every rank.

## Backend

* **No rank means no division, everywhere.**
  * Python: `resolve_tier_for_rank`, `DivisionGrid.resolve_division`/`resolve_division_number`,
    `DivisionGridNormalizer.normalize_division`, `resolve_tournament_tier`/`_division`,
    `resolve_workspace_tier`/`_division` and `canonical_division_number` take `rank: int | None` and return `None`
    for `None`. Overloads keep an `int` rank typed as a tier.
  * SQL: `division_case_expr` and `canonical_division_expr` return NULL for a NULL rank, where the `CASE` used to fall
    to the floor tier. `division_filter_predicates` always excludes NULL, including a selection that reaches the floor
    tier (it now adds `rank IS NOT NULL`).
  * A rank below every band still lands on the floor tier.
* **Readers.**
  * `PlayerRead.rank`/`division` are `int | None`. This covers team and player reads and the pick-ban target's
    `division`.
  * Per-tournament average divisions skip unranked players.
  * The rank overview's `tournament` layer skips unranked roster rows.
  * Achievements: `div_change` compares consecutive ranked tournaments. A division `stable_streak` skips an unranked
    tournament instead of breaking the streak. `div_level`, `player_div` and `div_span` never match an unranked row.
  * Log evidence: a rostered extra's roster row is the rank authority even when its rank is NULL. It is seated
    unranked, with no member-rank fallback and no refusal.
  * `Team.avg_sr`/`total_sr` are unchanged: NULL is ignored, and an all-unranked team reads 0.
  * Stats-service and analytics readers are covered by the sibling change in the same release.
* **Writers.**
  * The registered-teams export and the draft export write NULL, not `0`, for a member with no resolved rank.
    `drafted_rank` returns `None` for an unranked player. The draft's pick order and a mix lineup's ratings still
    weigh that player as 0.
  * In the team import file (`rpc.balancer.admin.teams_import`, atravkovs format), member `rank` is optional
    (`int | None`, default `None`). `MaterializationMember.rank` is `int | None` too. Every writer that creates or
    updates roster rows goes through it: imports, balance export, draft export, registered export and rank re-export.
    It stores a rank of 0 or below as NULL, so no writer can store a `0` again.
  * Admin `PlayerCreate.rank` defaults to `None` (`ge=1` when given). In `PlayerUpdate`, an explicit `"rank": null`
    clears the rank. Before, it was a 500 on the NOT NULL column. An omitted `rank` stays unchanged. `0` is now a 422
    on both.

## Migration and deploy

One migration after `socdn01`: **`rankopt01`**.

* `ALTER COLUMN tournament.player.rank DROP NOT NULL`.
* `UPDATE tournament.player SET rank = NULL WHERE rank = 0`. The same runs on `encounter.team_member.rank`, the
  per-match snapshot of the roster rank, which was already nullable.

Run the migration first, then roll tournament-, balancer-, stats- and analytics-service, the gateway (regenerated
`schemas.json`) and the frontend, all from one SHA. Old code reading a NULL rank crashes the Python division
resolvers.

### Downgrade cost

The downgrade writes `0` for every NULL rank in both tables, then makes `tournament.player.rank` NOT NULL again. That
includes `encounter.team_member` rows that were NULL before this release: the encounter backfill left a NULL where
roster rows conflicted. After a downgrade, those rows read `0`, which is the floor division.

## Who must act

* **HTTP clients of the admin player API** (`POST`/`PATCH` player): stop sending `rank: 0` for "no rank" (422). Omit
  the field on create, and send `null` on update to clear a rank.
* **Producers of team import files**: member `rank` may be omitted or `null`, which imports the member unranked. A
  `0` (or a negative rank) also imports as unranked.
* **Readers of `rank`/`division`** on team/player reads, the pick-ban target, user tournament reads and player
  analytics: both can now be `null`. Render "no rank" and no division icon. Sort a null rank last.

## Wire changes

| Change | Kind |
| --- | --- |
| `PlayerRead.rank`, `PlayerRead.division`, pick-ban target `division` → nullable | **nullable** |
| `PlayerCreate.rank` default `0` → `null`; `PlayerCreate`/`PlayerUpdate` `rank` `ge=1` | **new refusal** (`0`) |
| `PlayerUpdate` `"rank": null` clears the rank (was a 500) | fixed |
| Team import member `rank` optional; a rank `<= 0` imports as `null` | widened |
| Registered/draft export write `null` (was `0`) for an unranked member | changed value |
