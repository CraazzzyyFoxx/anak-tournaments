"""Frozen baseline/impact/backfill outputs with real database mutations.

The legacy capture clone is disposable. Native tests retain its complete old
storage observations and compare seven-code replacements at every non-character
segment. Preserving per-character derived facts is a deliberate storage correction.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import math
from dataclasses import asdict, replace
from datetime import UTC, date, datetime
from enum import Enum
from pathlib import Path

import pandas as pd
import pytest
import sqlalchemy as sa
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from shared.core.impact import FORMULA_VERSION
from shared.disciplines.overwatch import baselines as baseline_module
from shared.disciplines.overwatch import impact
from shared.disciplines.overwatch.backfill import BackfillService
from shared.disciplines.overwatch.baseline_rows import build_baseline_rows
from shared.disciplines.overwatch.impact_backfill import _merge_events, _rank_by_impact, rebuild_frames
from shared.models import AuditLog
from shared.repository.baselines import StatBaselineRepository
from shared.repository.stats import StatDefRepository
from shared.repository.stats_queries import player_facts, team_scores
from shared.services.stats_evidence import owner_scopes
from src import models
from src.core import enums
from src.services.match_logs.objectiveless import resolve_encounter_maps

GOLDEN = Path(__file__).parent / "fixtures" / "stats_derived_parity.json"
DERIVED_CODES = frozenset(
    {
        "first_picks",
        "first_deaths",
        "ultimate_kills",
        "support_kills",
        "impact_points",
        "impact_rank",
        "overperformance_score",
    }
)


def _json(value):
    """Representation only: preserve numbers, order, duplicates and nullness."""
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, datetime):
        assert value.tzinfo is not None
        return value.astimezone(UTC).isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, dict):
        return {_json(key): _json(item) for key, item in value.items()}
    if isinstance(value, (tuple, list)):
        return [_json(item) for item in value]
    if value is pd.NA or value is pd.NaT:
        return None
    if hasattr(value, "item"):
        return _json(value.item())
    if isinstance(value, float) and math.isnan(value):
        return None
    return value


def _frame(frame: pd.DataFrame, *, unordered_by: list[str] | None = None) -> dict:
    # SQL result frames have synthetic positional indexes; their incidental
    # fetch order is not an identity. Scored/ranked frames retain their index
    # values and ranking order exactly (no unordered_by passed for those).
    if unordered_by and not frame.empty:
        frame = frame.sort_values(unordered_by, kind="stable", na_position="last").reset_index(drop=True)
    return _json(
        {
            "columns": list(frame.columns),
            "column_index_names": list(frame.columns.names),
            "dtypes": [str(dtype) for dtype in frame.dtypes],
            "index": {
                "type": type(frame.index).__name__,
                "names": list(frame.index.names),
                "dtypes": [str(frame.index.get_level_values(level).dtype) for level in range(frame.index.nlevels)],
                "values": frame.index.tolist(),
            },
            "records": frame.to_dict(orient="records"),
        }
    )


def _fact_key(row: dict) -> tuple:
    return (
        row["match_id"],
        row["user_id"],
        row["team_id"],
        row["round"],
        row["hero_id"] is not None,
        row["hero_id"] or 0,
        row["stat_code"],
    )


def _fact_objects(objects, players, stat_ids) -> list[dict]:
    members = {row.workspace_member_id: row.user_id for row in players}
    teams = {row.encounter_team_id: row.team_id for row in players}
    codes = {value: code for code, value in stat_ids.items()}
    rows = [
        {
            "match_id": row["match_id"],
            "user_id": members[row["workspace_member_id"]],
            "team_id": teams[row["encounter_team_id"]],
            "round": row["segment"],
            "hero_id": row["entity_id"],
            "stat_code": codes[row["stat_id"]],
            "value": row["value"],
        }
        for row in objects
    ]
    return sorted(rows, key=_fact_key)


async def _facts(session: AsyncSession, match_ids: list[int]) -> list[dict]:
    stat = player_facts(discipline="overwatch").c
    rows = (
        (
            await session.execute(
                sa.select(
                    stat.match_id,
                    stat.player_id.label("user_id"),
                    stat.tournament_team_id.label("team_id"),
                    stat.segment.label("round"),
                    stat.entity_id.label("hero_id"),
                    stat.stat_code,
                    stat.value,
                ).where(stat.match_id.in_(match_ids))
            )
        )
        .mappings()
        .all()
    )
    return sorted((_json(dict(row)) for row in rows), key=_fact_key)


def _player_derived(rows: list[dict]) -> list[dict]:
    return [row for row in rows if row["hero_id"] is None and row["stat_code"] in DERIVED_CODES]


def _raw(rows: list[dict]) -> list[dict]:
    return [row for row in rows if row["stat_code"] not in DERIVED_CODES]


def _preserved_facts(rows: list[dict]) -> list[dict]:
    return [row for row in rows if row["hero_id"] is not None or row["stat_code"] not in DERIVED_CODES]


def _assert_derived_coverage(before: list[dict], after: list[dict]) -> None:
    """Every raw player/segment group must receive exactly the seven codes."""
    groups = {
        (row["match_id"], row["user_id"], row["team_id"], row["round"])
        for row in _raw(before)
        if row["hero_id"] is None
    }
    derived = _player_derived(after)
    actual: dict[tuple, set[str]] = {}
    for row in derived:
        key = (row["match_id"], row["user_id"], row["team_id"], row["round"])
        actual.setdefault(key, set()).add(row["stat_code"])
    assert actual == dict.fromkeys(groups, DERIVED_CODES), "backfill omitted a player/segment or derived code"
    assert len(derived) == len(groups) * len(DERIVED_CODES), "backfill duplicated a derived player/segment fact"


def _kills(rows, players) -> list[dict]:
    members = {row.workspace_member_id: row.user_id for row in players}
    teams = {row.encounter_team_id: row.team_id for row in players}
    records = [
        _json(
            {
                "match_id": row.match_id,
                "round": row.segment,
                "time": row.t,
                "fight": (row.data or {}).get("fight"),
                "killer_id": members.get(row.actor_member_id),
                "victim_id": members.get(row.target_member_id),
                "killer_hero_id": row.entity_id,
                "victim_hero_id": row.related_entity_id,
                "killer_team_id": teams.get(row.actor_team_id),
                "victim_team_id": teams.get(row.target_team_id),
                "ability": (row.data or {}).get("ability"),
                "damage": (row.data or {}).get("damage"),
                "is_critical_hit": (row.data or {}).get("is_critical_hit"),
                "is_environmental": (row.data or {}).get("is_environmental"),
            }
        )
        for row in rows
    ]
    return sorted(
        records, key=lambda row: (row["match_id"], row["time"], row["round"], json.dumps(row, sort_keys=True))
    )


async def _baselines(session: AsyncSession) -> list[dict]:
    baseline, role, dimension, stat = models.StatsBaseline, models.CatalogRole, models.RoleDimension, models.StatDef
    rows = (
        (
            await session.execute(
                sa.select(
                    baseline.formula_version,
                    role.code.label("role"),
                    baseline.rank_bucket,
                    stat.code.label("stat"),
                    baseline.mean,
                    baseline.std,
                    baseline.meta,
                )
                .join(role, role.id == baseline.role_id)
                .join(dimension, dimension.id == role.dimension_id)
                .join(stat, stat.id == baseline.stat_id)
                .where(
                    dimension.discipline == "overwatch",
                    dimension.rated.is_(True),
                    stat.discipline == "overwatch",
                )
            )
        )
        .mappings()
        .all()
    )
    return sorted(
        (_json({**dict(row), "role": enums.HeroClass[row["role"]]}) for row in rows),
        key=lambda row: (row["formula_version"], row["role"], row["rank_bucket"], row["stat"]),
    )


def _baseline_set(value: impact.BaselineSet | None) -> dict | None:
    if value is None:
        return None
    return {
        "formula_version": value.formula_version,
        "bucket_bounds": list(value.bucket_bounds),
        "values": [
            {"role": role, "rank_bucket": bucket, "stat": enums.LogStatsName[stat].value, "mean": mean, "std": std}
            for (role, bucket, stat), (mean, std) in sorted(value.values.items())
        ],
    }


async def _assert_match_audit(session, match_id, operation, *, unchanged):
    row = await session.scalar(
        sa.select(AuditLog)
        .where(
            AuditLog.entity_id == match_id,
            AuditLog.action == operation,
        )
        .order_by(AuditLog.id.desc())
    )
    assert row is not None
    before = row.before_json["stats_evidence"]
    after = row.after_json["stats_evidence"]
    expected = set(owner_scopes("match", (match_id,)))
    for envelope in (before, after):
        assert envelope["operation"] == operation
        assert {
            (state["owner_kind"], tuple(state["owner_key"]), state["subset"]) for state in envelope["states"]
        } == expected
    old = {state["subset"]: state for state in before["states"]}
    new = {state["subset"]: state for state in after["states"]}
    for subset in unchanged:
        assert old[subset] == new[subset]
    return row.id


async def _backfill_case(
    session: AsyncSession, match_id: int, service: BackfillService, baselines: impact.BaselineSet
) -> dict:
    before = await _facts(session, [match_id])
    stat_rows = await service._load_stat_rows(session, match_id)
    refs = await service._load_player_refs(session, match_id)
    hero_types = await service._load_hero_types(session)
    players = await service._load_players(session, match_id)
    member_users = {row.workspace_member_id: row.user_id for row in players}
    ownership = {row.user_id: (row.workspace_member_id, row.encounter_team_id) for row in players}
    stat_ids = await StatDefRepository().ids(session, discipline="overwatch")
    kills = await service._load_kills(session, match_id)
    original_data = [row.data for row in kills]
    kills_before = _kills(kills, players)
    round_frame, match_frame = rebuild_frames(stat_rows)
    rebuilt = {"round": _frame(round_frame), "match": _frame(match_frame)}
    impact.assign_fights(kills)
    events = impact.build_event_counts(kills, hero_types, member_user_ids=member_users)
    round_frame, match_frame = _merge_events(round_frame, match_frame, events)
    merged = {"round": _frame(round_frame), "match": _frame(match_frame)}
    round_scored = _rank_by_impact(
        impact.add_impact_scores(round_frame, players=refs, baselines=baselines, has_killfeed=bool(kills))
    )
    match_scored = _rank_by_impact(
        impact.add_impact_scores(match_frame, players=refs, baselines=baselines, has_killfeed=bool(kills))
    )
    objects = service._stat_objects(match_id, ownership, stat_ids, round_scored, match_scored)

    zero_role = {}
    for name, role_refs in (
        ("unknown_role", {key: replace(ref, role=None) for key, ref in refs.items()}),
        ("flex_role", {key: replace(ref, role=enums.HeroClass.flex) for key, ref in refs.items()}),
        ("missing_ref", {}),
    ):
        zero_role[name] = _frame(
            impact.add_impact_scores(match_frame, players=role_refs, baselines=baselines, has_killfeed=bool(kills))
        )
    minimum_time = {}
    for seconds in (59.0, 60.0):
        sample = match_frame.copy()
        sample[enums.LogStatsName.HeroTimePlayed] = seconds
        minimum_time[str(seconds)] = _frame(
            impact.add_impact_scores(sample, players=refs, baselines=baselines, has_killfeed=bool(kills))
        )

    # Pure frame inspection must not pre-flush the fight update outside the
    # production backfill's before/after evidence boundary.
    for row, data in zip(kills, original_data, strict=True):
        row.data = data

    first_result = await service.backfill_match(session, match_id)
    await session.commit()
    session.expire_all()
    after_first = await _facts(session, [match_id])
    first_kills = _kills(await service._load_kills(session, match_id), players)
    first_audit = await _assert_match_audit(
        session,
        match_id,
        "stats.derived_backfill",
        unchanged=("raw_facts", "event_body", "players", "team_scores"),
    )
    second_result = await service.backfill_match(session, match_id)
    await session.commit()
    session.expire_all()
    after_second = await _facts(session, [match_id])
    second_kills = _kills(await service._load_kills(session, match_id), players)
    assert (
        await _assert_match_audit(
            session,
            match_id,
            "stats.derived_backfill",
            unchanged=("raw_facts", "event_body", "players", "team_scores"),
        )
        == first_audit
    ), "an idempotent backfill must not append a false transition"
    assert first_result is True and second_result is True
    assert after_first == after_second, "backfill accumulates or changes semantic rows on rerun"
    assert first_kills == second_kills, "fight assignments did not persist idempotently"
    assert _raw(before) == _raw(after_first), "backfill changed a non-seven-code fact"
    _assert_derived_coverage(before, after_first)
    assert _player_derived(_fact_objects(objects, players, stat_ids)) == _player_derived(after_first)
    return _json(
        {
            "input": _frame(stat_rows, unordered_by=["user_id", "round", "hero_id", "name"]),
            "player_refs": [asdict(ref) for _, ref in sorted(refs.items())],
            "rebuilt": rebuilt,
            "events": _frame(events),
            "merged": merged,
            "scored": {"round": _frame(round_scored), "match": _frame(match_scored)},
            "zero_role": zero_role,
            "minimum_time": minimum_time,
            "objects": _fact_objects(objects, players, stat_ids),
            "kills_before": kills_before,
            "kills_first": first_kills,
            "kills_second": second_kills,
            "first_result": first_result,
            "second_result": second_result,
            "facts_before": before,
            "facts_first": after_first,
            "facts_second": after_second,
        }
    )


async def _fight_boundaries(session: AsyncSession, ids: dict[str, int], service: BackfillService) -> dict:
    output = {}
    for name, rounds, self_kill in (
        ("gap_exactly_15_then_greater", (1, 1, 1), False),
        ("round_boundary", (1, 2, 2), False),
        ("self_kill", (1, 1, 1), True),
    ):
        transaction = await session.begin_nested()
        try:
            players = await service._load_players(session, ids["match"])
            member_users = {row.workspace_member_id: row.user_id for row in players}
            kills = sorted(await service._load_kills(session, ids["match"]), key=lambda row: row.t)
            assert len(kills) >= 3, "fight parity requires the shared three-kill fixture"
            for row, time, round_ in zip(kills[:3], (10.0, 25.0, 40.001), rounds, strict=True):
                row.t = time
                row.segment = round_
            if self_kill:
                kills[0].actor_member_id = kills[0].target_member_id
                kills[0].actor_team_id = kills[0].target_team_id
                kills[0].entity_id = kills[0].related_entity_id
            await session.flush()
            assert await service.backfill_match(session, ids["match"])
            await session.flush()
            session.expire_all()
            persisted = await service._load_kills(session, ids["match"])
            output[name] = {
                "kills": _kills(persisted, players),
                "event_counts": _frame(
                    impact.build_event_counts(
                        persisted,
                        await service._load_hero_types(session),
                        member_user_ids=member_users,
                    )
                ),
                "derived": [row for row in await _facts(session, [ids["match"]]) if row["stat_code"] in DERIVED_CODES],
            }
        finally:
            await transaction.rollback()
            session.expire_all()
    return output


async def _missing_roster(session: AsyncSession, ids: dict[str, int], service: BackfillService) -> dict:
    transaction = await session.begin_nested()
    try:
        await session.execute(
            sa.delete(models.Player).where(
                models.Player.team_id == ids["team_home"],
                models.Player.workspace_member_id == ids["member_removed"],
            )
        )
        refs = await service._load_player_refs(session, ids["match"])
        assert ids["player_removed"] in refs, "a historical participant was dropped with the current roster"
        before = await _facts(session, [ids["match"]])
        assert await service.backfill_match(session, ids["match"])
        await session.flush()
        session.expire_all()
        derived = [row for row in await _facts(session, [ids["match"]]) if row["stat_code"] in DERIVED_CODES]
        _assert_derived_coverage(before, derived)
        return _json({"player_refs": [asdict(ref) for _, ref in sorted(refs.items())], "derived": derived})
    finally:
        await transaction.rollback()
        session.expire_all()


async def _score_state(session: AsyncSession, encounter_id: int) -> dict:
    seats = (
        await session.scalars(sa.select(models.EncounterTeam).where(models.EncounterTeam.encounter_id == encounter_id))
    ).all()
    scores = team_scores(discipline="overwatch", stat_code="score")
    observed_rows = (
        await session.execute(
            sa.select(scores)
            .join(
                models.StatsMatch,
                models.StatsMatch.id == scores.c.match_id,
            )
            .join(models.EncounterGame, models.EncounterGame.id == models.StatsMatch.encounter_game_id)
            .where(models.EncounterGame.encounter_id == encounter_id)
            .order_by(scores.c.match_id, scores.c.encounter_team_id)
        )
    ).all()
    observed = []
    for row in observed_rows:
        if not observed or observed[-1]["match_id"] != row.match_id:
            observed.append({"match_id": row.match_id, "scores": []})
        # Native facts store FLOAT8; OW scores retain their integer semantic type.
        assert row.value.is_integer(), "fractional native OW score"
        observed[-1]["scores"].append({"encounter_team_id": row.encounter_team_id, "value": int(row.value)})
    encounter = await session.get(models.Encounter, encounter_id)
    assert encounter is not None
    games = (
        (
            await session.execute(
                sa.select(
                    models.EncounterGame.id,
                    models.EncounterGame.position,
                    models.EncounterGame.map_id,
                    models.EncounterGame.state,
                    models.EncounterGame.result_source,
                    models.EncounterGame.result_version,
                    models.EncounterGame.confirmed_at,
                )
                .where(models.EncounterGame.encounter_id == encounter_id)
                .order_by(models.EncounterGame.position)
            )
        )
        .mappings()
        .all()
    )
    game_scores = (
        (
            await session.execute(
                sa.select(
                    models.EncounterGameTeam.game_id,
                    models.EncounterGameTeam.encounter_team_id,
                    models.EncounterGameTeam.score,
                    models.EncounterGameTeam.placement,
                )
                .where(models.EncounterGameTeam.encounter_id == encounter_id)
                .order_by(models.EncounterGameTeam.game_id, models.EncounterGameTeam.encounter_team_id)
            )
        )
        .mappings()
        .all()
    )
    return _json(
        {
            "observed": observed,
            "official": {
                "encounter": {
                    key: getattr(encounter, key)
                    for key in ("id", "status", "result_status", "result_source", "result_version", "confirmed_at")
                },
                "seats": [
                    {
                        "id": seat.id,
                        "team_id": seat.team_id,
                        "slot": seat.slot,
                        "score": seat.score,
                        "placement": seat.placement,
                    }
                    for seat in sorted(seats, key=lambda row: row.id)
                ],
                "games": [dict(row) for row in games],
                "game_scores": [dict(row) for row in game_scores],
            },
        }
    )


async def _scores(session: AsyncSession, ids: dict[str, int]) -> dict:
    output = {}
    for name in ("ordinary", "accepted_reversed", "unknown"):
        transaction = await session.begin_nested()
        try:
            if name != "ordinary":
                push = await session.scalar(
                    sa.select(models.CatalogEntity).where(
                        models.CatalogEntity.discipline == "overwatch",
                        models.CatalogEntity.kind == "mode",
                        models.CatalogEntity.slug == "push",
                    )
                )
                map_ = await session.get(models.CatalogEntity, ids["map_other"])
                assert map_ is not None
                if push is not None:
                    map_.parent_id = push.id
                else:
                    # No duplicate seeder: change the existing fixture mode.
                    mode = await session.get(models.CatalogEntity, map_.parent_id)
                    assert mode is not None
                    mode.slug = "push"
            if name == "unknown":
                await session.execute(
                    sa.update(models.EncounterGameTeam)
                    .where(
                        models.EncounterGameTeam.game_id == ids["game_reversed"],
                    )
                    .values(score=None)
                )
            await session.flush()
            before = await _score_state(session, ids["encounter"])
            changed = await resolve_encounter_maps(session, ids["encounter"])
            await session.flush()
            session.expire_all()
            after = await _score_state(session, ids["encounter"])
            if changed:
                await _assert_match_audit(
                    session,
                    ids["match_reversed"],
                    "stats.score_edit",
                    unchanged=("raw_facts", "event_body", "event_fight", "players"),
                )
            repeated = await resolve_encounter_maps(session, ids["encounter"])
            await session.flush()
            session.expire_all()
            after_repeat = await _score_state(session, ids["encounter"])
            assert before["official"] == after["official"] == after_repeat["official"], (
                "resolver mutated accepted results"
            )
            assert after == after_repeat and repeated is False
            if name == "accepted_reversed":
                assert changed, "objectiveless fixture did not exercise a real score write"
            output[name] = {
                "before": before,
                "changed": changed,
                "after": after,
                "changed_again": repeated,
                "after_repeat": after_repeat,
            }
        finally:
            await transaction.rollback()
            session.expire_all()
    return output


async def collect_outputs(session: AsyncSession, ids: dict[str, int]) -> dict:
    """Read real native outputs against Main's immutable frozen-P3 oracle."""
    baseline_service = baseline_module.baseline_service
    await baseline_service.invalidate_cache(discipline="overwatch")
    frame = await baseline_service._load_stats_frame(session, discipline="overwatch")
    assert not frame.empty, "baseline oracle requires actual eligible legacy statistics"
    built = build_baseline_rows(frame)
    assert built, "baseline fixture does not meet eligibility thresholds"
    for row in built:
        row["stat"] = enums.LogStatsName[row["stat"]].value
    before_baselines = await _baselines(session)
    initial_active = await baseline_service.get_active(session, discipline="overwatch")
    recomputed = await baseline_service.recompute(session, discipline="overwatch")
    active = await baseline_service.get_active(session, discipline="overwatch")
    audit = await session.scalar(
        sa.select(AuditLog)
        .where(
            AuditLog.action == "stats.baseline_recompute",
        )
        .order_by(AuditLog.id.desc())
    )
    assert audit is not None
    for payload in (audit.before_json, audit.after_json):
        assert [
            (state["owner_kind"], tuple(state["owner_key"]), state["subset"])
            for state in payload["stats_evidence"]["states"]
        ] == owner_scopes(
            "baseline",
            ("overwatch", FORMULA_VERSION),
        )
    assert active is not None
    output = {
        "baseline": {
            "frame": _frame(frame, unordered_by=list(frame.columns)),
            "built_rows": _json(built),
            "before": before_baselines,
            "initial_active": _baseline_set(initial_active),
            "recomputed": recomputed,
            "after": await _baselines(session),
            "active": _baseline_set(active),
        },
        "matches": {},
    }
    unrelated_before = await _facts(session, [ids["match_other"], ids["match_hidden"]])
    service = BackfillService()
    for name in ("match", "match_reversed"):
        output["matches"][name] = await _backfill_case(session, ids[name], service, active)
    empty_before = await _facts(session, [ids["match_no_raw"]])
    output["no_facts"] = {
        "before": empty_before,
        "result": await service.backfill_match(session, ids["match_no_raw"]),
        "after": await _facts(session, [ids["match_no_raw"]]),
    }
    assert output["no_facts"]["result"] is False
    output["fight_boundaries"] = await _fight_boundaries(session, ids, service)
    output["missing_roster"] = await _missing_roster(session, ids, service)
    assert unrelated_before == await _facts(session, [ids["match_other"], ids["match_hidden"]]), (
        "targeted backfill touched another match"
    )
    output["scores"] = await _scores(session, ids)
    return _json(output)


def _parity_view(output: dict) -> dict:
    """Retain full old evidence; compare all non-character derived segments."""
    projected = {key: value for key, value in output.items() if key not in {"matches", "fight_boundaries"}}
    projected["matches"] = {}
    for name, result in output["matches"].items():
        projected["matches"][name] = {
            key: _player_derived(value) if key in {"objects", "facts_before", "facts_first", "facts_second"} else value
            for key, value in result.items()
        }
    projected["fight_boundaries"] = {
        name: {**result, "derived": _player_derived(result["derived"])}
        for name, result in output["fight_boundaries"].items()
    }
    projected["missing_roster"] = {
        **output["missing_roster"],
        "derived": _player_derived(output["missing_roster"]["derived"]),
    }
    return projected


def _assert_exact(actual, expected, path=()) -> None:
    assert type(actual) is type(expected), f"{path}: {type(actual).__name__} != {type(expected).__name__}"
    if isinstance(expected, dict):
        assert actual.keys() == expected.keys(), f"{path}: changed keys"
        for key in expected:
            _assert_exact(actual[key], expected[key], (*path, key))
    elif isinstance(expected, list):
        assert len(actual) == len(expected), f"{path}: changed length"
        for index, (left, right) in enumerate(zip(actual, expected, strict=True)):
            _assert_exact(left, right, (*path, index))
    elif isinstance(expected, float):
        assert actual.hex() == expected.hex(), f"{path}: {actual!r} != {expected!r}"
    else:
        assert actual == expected, f"{path}: {actual!r} != {expected!r}"


def _canonical_expected() -> dict:
    """Apply only independently frozen, exact canonical-order witness cells."""
    original = GOLDEN.read_bytes()
    witness = json.loads(GOLDEN.with_name("stats_derived_canonical_order.json").read_text(encoding="utf-8"))
    assert hashlib.sha256(original).hexdigest() == witness["provenance"]["golden_sha256"]
    assert witness["original_reproduced"] is True
    assert witness["input_multisets_equal"] is True
    assert witness["provenance"]["order"] == [
        "impact_baseline_totals.match_id ASC",
        "impact_baseline_totals.user_id ASC",
    ]
    expected = json.loads(original)
    seen = set()
    for path, old, canonical in witness["differences"]:
        assert tuple(path) not in seen
        seen.add(tuple(path))
        parent = expected
        for key in path[:-1]:
            parent = parent[key]
        _assert_exact(parent[path[-1]], old, tuple(path))
        assert type(old) is float and type(canonical) is float
        assert math.isfinite(old) and math.isfinite(canonical)
        assert old.hex() != canonical.hex()
        if path[0] == "baseline":
            assert path[-1] in {"mean", "std"} and (
                len(path) == 4
                and path[1] in {"built_rows", "after"}
                or len(path) == 5
                and path[1:3] == ["active", "values"]
            )
        elif path[0] == "matches" and path[2] in {"scored", "minimum_time"}:
            assert len(path) == 7 and path[4] == "records"
            assert path[-1] in {"impact_points", "overperformance_score"}
        else:
            assert (
                path[0] == "matches"
                and len(path) == 5
                and path[2] in {"objects", "facts_first", "facts_second"}
                or path[0] == "fight_boundaries"
                and len(path) == 5
                and path[2] == "derived"
                or path[0] == "missing_roster"
                and len(path) == 4
                and path[1] == "derived"
            )
            assert path[-1] == "value" and parent["hero_id"] is None
            assert parent["stat_code"] in {"impact_points", "overperformance_score"}
        parent[path[-1]] = canonical
    return expected


def assert_derived_parity(actual: dict) -> None:
    """Compare every retained field exactly; ordering policy is not a tolerance."""
    _assert_exact(_parity_view(actual), _parity_view(_canonical_expected()))


def test_derived_canonical_reference_rejects_original_unordered_reduction_values():
    with pytest.raises(AssertionError):
        assert_derived_parity(json.loads(GOLDEN.read_text(encoding="utf-8")))


@pytest.mark.parametrize(
    ("path", "change"),
    [
        pytest.param(("baseline", "built_rows", 0, "mean"), "ulp", id="baseline-one-ulp"),
        pytest.param(
            ("matches", "match", "scored", "match", "records", 0, "impact_points"), "ulp", id="impact-one-ulp"
        ),
        pytest.param(
            ("matches", "match", "scored", "match", "records", 0, "overperformance_score"),
            "ulp",
            id="overperformance-one-ulp",
        ),
        pytest.param(
            ("matches", "match", "scored", "match", "records", 0, "impact_rank"), "increment", id="impact-rank"
        ),
        pytest.param(("matches", "match", "player_refs", 0, "rank"), "increment", id="current-registration-rank"),
        pytest.param(("matches", "match", "player_refs", 0, "user_id"), "increment", id="global-identity"),
        pytest.param(
            ("matches", "match", "rebuilt", "match", "records", 0, "hero_damage_dealt"), "ulp", id="raw-one-ulp"
        ),
        pytest.param(("matches", "match", "kills_first", 0, "ability"), "nonnull", id="event-nullness"),
        pytest.param(
            ("scores", "ordinary", "after", "observed", 0, "scores", 0, "value"), "increment", id="observed-score"
        ),
        pytest.param(
            ("scores", "ordinary", "after", "observed", 0, "scores", 0, "encounter_team_id"),
            "increment",
            id="participant-identity",
        ),
        pytest.param(("baseline", "frame", "records", 0, "rank"), "float", id="integer-type"),
        pytest.param(("matches", "match", "kills_first"), "append", id="duplicate-event"),
        pytest.param(("matches", "match", "first_result"), "delete", id="missing-key"),
        pytest.param(("matches", "match", "extra"), "add", id="extra-key"),
    ],
)
def test_derived_canonical_reference_rejects_unapproved_differences(path, change):
    actual = _canonical_expected()
    parent = actual
    for key in path[:-1]:
        parent = parent[key]
    key = path[-1]
    if change == "ulp":
        parent[key] = math.nextafter(parent[key], math.inf)
    elif change == "increment":
        parent[key] += 1
    elif change == "float":
        assert type(parent[key]) is int
        parent[key] = float(parent[key])
    elif change == "nonnull":
        assert parent[key] is None
        parent[key] = ""
    elif change == "append":
        parent[key].append(parent[key][0])
    elif change == "delete":
        del parent[key]
    else:
        assert change == "add"
        parent[key] = None
    with pytest.raises(AssertionError):
        assert_derived_parity(actual)


@pytest.mark.parametrize(
    ("actual", "expected"),
    [(0.0, -0.0), (1.0, 1), (True, 1), (False, None)],
    ids=["signed-zero", "float-integer", "boolean-integer", "boolean-null"],
)
def test_derived_exact_comparison_preserves_numeric_types_and_signed_zero(actual, expected):
    with pytest.raises(AssertionError):
        _assert_exact(actual, expected)


async def _lol_state(session: AsyncSession, ids: dict[str, int]) -> dict:
    # Native-only import: Main injects this module into P3 for collect_outputs.
    from shared.models.stats.match import StatsBaseline, StatsEvent, StatsFact

    output = {}
    for name, table, predicate in (
        ("facts", StatsFact.__table__, StatsFact.match_id == ids["match_lol"]),
        ("events", StatsEvent.__table__, StatsEvent.match_id == ids["match_lol"]),
        ("baseline", StatsBaseline.__table__, StatsBaseline.id == ids["baseline_lol"]),
    ):
        rows = (await session.execute(sa.select(table).where(predicate))).mappings().all()
        assert rows, f"missing shared native LoL sentinel: {name}"
        output[name] = sorted((_json(dict(row)) for row in rows), key=lambda row: json.dumps(row, sort_keys=True))
    return output


async def _assert_native_slots(session: AsyncSession, ids: dict[str, int]) -> None:
    from shared.models.stats.match import StatsMatchTeam

    rows = (
        await session.execute(
            sa.select(
                StatsMatchTeam.match_id,
                StatsMatchTeam.encounter_team_id,
                StatsMatchTeam.source_position,
                models.EncounterTeam.slot,
            )
            .join(models.EncounterTeam, models.EncounterTeam.id == StatsMatchTeam.encounter_team_id)
            .where(StatsMatchTeam.match_id.in_([ids["match"], ids["match_reversed"]]))
        )
    ).all()
    assert {tuple(row) for row in rows} == {
        (ids["match"], ids["encounter_team_home"], 1, 1),
        (ids["match"], ids["encounter_team_away"], 2, 2),
        (ids["match_reversed"], ids["encounter_team_home"], 2, 1),
        (ids["match_reversed"], ids["encounter_team_away"], 1, 2),
    }


def test_native_derived_math_preserves_old_outputs_without_overwriting_characters_or_raw_facts(stats_parity_database):
    url, ids = stats_parity_database

    async def compare() -> None:
        engine = create_async_engine(make_url(url).set(drivername="postgresql+asyncpg"))
        try:
            async with async_sessionmaker(engine, expire_on_commit=False)() as session:
                actual = await collect_outputs(session, ids)
                assert_derived_parity(actual)
                for result in actual["matches"].values():
                    assert _preserved_facts(result["facts_before"]) == _preserved_facts(result["facts_first"])
                    assert result["facts_first"] == result["facts_second"]
                await _assert_native_slots(session, ids)
        finally:
            await engine.dispose()

    asyncio.run(compare())


def test_native_baseline_reductions_keep_immutable_order_across_query_plans(stats_parity_database):
    url, _ = stats_parity_database

    async def compare() -> None:
        engine = create_async_engine(make_url(url).set(drivername="postgresql+asyncpg"))
        queries = []

        @sa.event.listens_for(engine.sync_engine, "before_execute")
        def capture_query(conn, statement, multiparams, params, execution_options):
            if isinstance(statement, sa.sql.Select) and "has_killfeed" in statement.selected_columns:
                queries.append(statement)

        try:
            async with async_sessionmaker(engine, expire_on_commit=False)() as session:
                service = baseline_module.baseline_service
                first = await service._load_stats_frame(session, discipline="overwatch")
                assert not first.empty
                first_rows = build_baseline_rows(first)
                assert first_rows
                query = queries[-1]
                totals = next(
                    node
                    for node in sa.sql.visitors.iterate(query)
                    if isinstance(node, sa.sql.selectable.CTE) and node.name == "impact_baseline_totals"
                )
                identities = (
                    await session.execute(
                        query.with_only_columns(
                            totals.c.match_id,
                            totals.c.user_id,
                            maintain_column_froms=True,
                        ).where(totals.c.seconds > 0)
                    )
                ).all()
                assert len(identities) == len(first)
                assert identities == sorted(set(identities))
                # Change real PostgreSQL aggregation/join plans, not returned
                # frames or reducers. The production loader owns stable order.
                for settings in (
                    "SET LOCAL enable_hashagg = off",
                    "SET LOCAL enable_hashjoin = off",
                    "SET LOCAL enable_mergejoin = off",
                ):
                    await session.execute(sa.text(settings))
                    actual = await service._load_stats_frame(session, discipline="overwatch")
                    assert _frame(actual) == _frame(first)
                    assert build_baseline_rows(actual) == first_rows
        finally:
            await engine.dispose()

    asyncio.run(compare())


def test_overwatch_baselines_and_backfill_preserve_native_lol_sentinel(stats_parity_database):
    from shared.testing.stats_parity import seed_native_sentinel

    url, ids = stats_parity_database

    async def compare() -> None:
        engine = create_async_engine(make_url(url).set(drivername="postgresql+asyncpg"))
        try:
            async with async_sessionmaker(engine, expire_on_commit=False)() as session:
                service = baseline_module.baseline_service
                await service.invalidate_cache(discipline="overwatch")
                frame = await service._load_stats_frame(session, discipline="overwatch")
                before_frame = _frame(frame, unordered_by=list(frame.columns))
                before_count = await service.recompute(session, discipline="overwatch")
                before_active = _baseline_set(await service.get_active(session, discipline="overwatch"))
                assert before_active is not None
                await session.run_sync(lambda sync: seed_native_sentinel(sync.connection(), ids))
                await session.commit()
                lol_before = await _lol_state(session, ids)
                ow_before = await _baselines(session)
                active_row = await session.scalar(
                    sa.select(models.StatsBaseline)
                    .join(
                        models.StatDef,
                        models.StatDef.id == models.StatsBaseline.stat_id,
                    )
                    .where(
                        models.StatDef.discipline == "overwatch",
                        models.StatsBaseline.formula_version == FORMULA_VERSION,
                    )
                )
                assert active_row is not None
                for role_id, stat_id in (
                    (ids["role_lol"], active_row.stat_id),
                    (active_row.role_id, ids["stat_lol_hero_damage_dealt"]),
                ):
                    with pytest.raises(ValueError):
                        await StatBaselineRepository().replace_for_version(
                            session,
                            FORMULA_VERSION,
                            [
                                models.StatsBaseline(
                                    formula_version=FORMULA_VERSION,
                                    role_id=role_id,
                                    stat_id=stat_id,
                                    rank_bucket=-1,
                                    mean=1.0,
                                    std=1.0,
                                )
                            ],
                            discipline="overwatch",
                        )
                assert await _baselines(session) == ow_before
                assert await _lol_state(session, ids) == lol_before
                assert await BackfillService().backfill_match(session, ids["match_lol"]) is False
                await service.invalidate_cache(discipline="overwatch")
                frame = await service._load_stats_frame(session, discipline="overwatch")
                assert _frame(frame, unordered_by=list(frame.columns)) == before_frame
                assert await service.recompute(session, discipline="overwatch") == before_count
                assert _baseline_set(await service.get_active(session, discipline="overwatch")) == before_active
                backfill = BackfillService()
                for name in ("match", "match_reversed"):
                    assert await backfill.backfill_match(session, ids[name])
                    await session.commit()
                assert await _lol_state(session, ids) == lol_before
                # The sentinel has only an inactive formula. An OW cache entry
                # must not masquerade as LoL's active baseline set.
                assert await service.get_active(session, discipline="lol") is None
                assert _baseline_set(await service.get_active(session, discipline="overwatch")) == before_active
        finally:
            await engine.dispose()

    asyncio.run(compare())
