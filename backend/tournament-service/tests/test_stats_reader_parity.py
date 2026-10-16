"""Real P3 reader capture and immutable native parity, using the shared DB seed.

Main invokes collect_outputs against frozen P3 imports before changing readers.
Normal tests only read GOLDEN; they never capture or update expected output.
"""

from __future__ import annotations

import asyncio
import inspect
import json
import math
from copy import deepcopy
from datetime import UTC, date, datetime
from decimal import Decimal
from difflib import unified_diff
from enum import Enum
from itertools import groupby, islice
from pathlib import Path
from typing import Any

import pytest
import sqlalchemy as sa
from pydantic import BaseModel
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from shared.core.errors import BaseAPIException
from shared.services.tournament.visibility import ensure_tournament_viewable
from src import schemas
from src.services.admin.matches import matches_service
from src.services.encounter.flows import flows_service as encounters
from src.services.encounter.service import encounter_service
from src.services.tournament.flows import flows_service as tournaments
from src.services.visibility_resolvers import visibility_resolvers_service as visibility

GOLDEN = Path(__file__).parent / "fixtures" / "stats_reader_parity.json"
_MATCH_KEYS = ("match", "match_reversed", "match_no_raw", "match_other", "match_hidden")
_USER_KEYS = ("player", "player_away", "player_event_only", "player_other", "player_removed", "player_no_member")
_ENCOUNTER_ENTITIES = (
    "tournament",
    "teams",
    "teams.players",
    "matches",
    "matches.map",
    "matches.teams",
)
_MATCH_ENTITIES = ("map", "teams", "teams.players", "encounter", "encounter.tournament")


async def _uncached(method: Any, *args: Any, **kwargs: Any) -> Any:
    """Bypass only decorators, never the real reader/serializer or its SQL."""
    return await inspect.unwrap(method.__func__)(method.__self__, *args, **kwargs)


def _normalize(value: Any, participants: dict[int, int]) -> Any:
    """Keep every field except removed match source/code; canonicalize sides."""
    if isinstance(value, BaseModel):
        value = value.model_dump(mode="python")
    if isinstance(value, Enum):
        return _normalize(value.value, participants)
    if isinstance(value, datetime):
        if value.tzinfo is None:
            raise ValueError("parity timestamps must have a timezone")
        return value.astimezone(UTC).isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, Decimal):
        # The reader returns NUMERIC(10, 2); compare its number, not Decimal's spelling.
        return float(value)
    if isinstance(value, float) and math.isnan(value):
        return None
    if isinstance(value, (list, tuple)):
        return [_normalize(item, participants) for item in value]
    if not isinstance(value, dict):
        return value

    row = {str(_normalize(key, participants)): _normalize(item, participants) for key, item in value.items()}
    public_match = {"home_team_id", "away_team_id", "score", "encounter_id", "map_id"} <= row.keys()
    admin_match = {"home_team", "away_team", "home_score", "away_score", "encounter_id", "map_id"} <= row.keys()
    if public_match or admin_match:
        # Representation only: keep observed scores and complete expanded teams,
        # keyed by the historical encounter participation instead of log sides.
        scores = row.pop("score") if public_match else None
        row["scores_by_participant"] = {}
        row["teams_by_participant"] = {}
        row["team_ids_by_participant"] = {}
        for side in ("home", "away"):
            team = row.pop(f"{side}_team")
            team_id = row.pop(f"{side}_team_id") if public_match else team["id"]
            participant_id = str(participants[team_id])
            row["scores_by_participant"][participant_id] = scores[side] if public_match else row.pop(f"{side}_score")
            row["teams_by_participant"][participant_id] = team
            row["team_ids_by_participant"][participant_id] = team_id
        row.pop("source", None)
        row.pop("code", None)

    # These are unordered relationship/JSON aggregates, not ranked result lists.
    if isinstance(row.get("matches"), list):
        row["matches"].sort(key=lambda match: (match["map_index"] is None, match["map_index"] or 0, match["id"]))
    if isinstance(row.get("players"), list):
        row["players"].sort(key=lambda player: (player["user_id"], player["id"]))
    if isinstance(row.get("heroes"), dict):
        for heroes in row["heroes"].values():
            heroes.sort(key=lambda hero: hero["id"])
    if "position" in row and isinstance(row.get("teams"), list):
        row["teams"].sort(key=lambda team: team["encounter_team_id"])
    return row


def _stats_result(result: tuple[dict, dict]) -> dict:
    return {"statistics": result[0], "heroes": result[1]}


async def _not_found(operation: Any) -> dict:
    """Capture the actual denial, and refuse to bless an unexpected successful read."""
    with pytest.raises(BaseAPIException) as caught:
        await operation
    assert caught.value.status_code == 404
    return {"status_code": caught.value.status_code, "detail": caught.value.detail, "headers": caught.value.headers}


async def collect_outputs(session: AsyncSession, ids: dict[str, int]) -> dict:
    """Capture real reader outputs; compatible with frozen P3 production imports."""
    participants = {
        ids[key.removeprefix("encounter_")]: value for key, value in ids.items() if key.startswith("encounter_team_")
    }
    workspace = ids["workspace"]
    outputs: dict[str, Any] = {}

    encounter_cases = {
        "platform_first": (None, {"page": 1, "per_page": 1}),
        "platform_second": (None, {"page": 2, "per_page": 1}),
        "platform_past_end": (None, {"page": 3, "per_page": 1}),
        "platform_desc": (None, {"order": "desc"}),
        "workspace_expanded": (workspace, {"entities": list(_ENCOUNTER_ENTITIES)}),
        "other_workspace": (ids["workspace_other"], {"entities": list(_ENCOUNTER_ENTITIES)}),
        "only_count": (workspace, {"only_count": True, "entities": ["matches", "matches.map"]}),
        "with_logs": (workspace, {"has_logs": True}),
        "without_logs": (workspace, {"has_logs": False}),
        "name_search": (workspace, {"query": "P4 encounter", "fields": ["name"], "status": "completed", "best_of": 3}),
        "foreign_tournament": (workspace, {"tournament_id": ids["tournament_other"]}),
        "my_team_anonymous": (workspace, {"scope": "my_team"}),
    }
    outputs["encounter_pages"] = {}
    for name, (scope, options) in encounter_cases.items():
        outputs["encounter_pages"][name] = await _uncached(
            encounters.get_all_encounters,
            session,
            schemas.EncounterSearchParams(**options),
            workspace_id=scope,
        )
    outputs["encounter_pages"]["my_team_global"] = await _uncached(
        encounters.get_all_encounters,
        session,
        schemas.EncounterSearchParams(scope="my_team"),
        viewer_auth_user_id=ids["auth_user"],
    )

    outputs["encounter_details"] = {}
    for name in ("encounter", "encounter_other"):
        tournament_id = await visibility.tournament_id_for_encounter(session, ids[name])
        await ensure_tournament_viewable(session, None, tournament_id)
        outputs["encounter_details"][name] = await encounters.get_encounter(
            session,
            ids[name],
            list(_ENCOUNTER_ENTITIES),
        )

    outputs["encounter_overviews"] = {}
    outputs["tournament_overviews"] = {}
    for name, scope in (("platform", None), ("workspace", workspace), ("other_workspace", ids["workspace_other"])):
        outputs["encounter_overviews"][name] = await _uncached(
            encounters.get_encounters_overview,
            session,
            schemas.EncounterSearchParams(),
            workspace_id=scope,
        )
        outputs["tournament_overviews"][name] = await tournaments.get_tournaments_overall(session, workspace_id=scope)

    match_cases = {
        "platform": (None, {"per_page": -1}),
        "workspace_first": (workspace, {"page": 1, "per_page": 2, "entities": list(_MATCH_ENTITIES)}),
        "workspace_second": (workspace, {"page": 2, "per_page": 2, "entities": list(_MATCH_ENTITIES)}),
        "workspace_past_end": (workspace, {"page": 3, "per_page": 2}),
        "workspace_desc": (workspace, {"order": "desc"}),
        "other_workspace": (ids["workspace_other"], {"entities": list(_MATCH_ENTITIES)}),
        "only_count": (workspace, {"only_count": True, "entities": ["teams", "teams.players"]}),
        "tournament": (
            workspace,
            {"tournament_id": ids["tournament"], "sort": "map_index", "entities": ["map", "teams"]},
        ),
        "foreign_tournament": (workspace, {"tournament_id": ids["tournament_other"]}),
        "log_name_search": (workspace, {"query": "reverse", "fields": ["log_name"], "entities": ["map", "teams"]}),
        "duration_desc": (workspace, {"order": "desc", "sort": "time"}),
    }
    outputs["match_pages"] = {}
    for name, (scope, options) in match_cases.items():
        outputs["match_pages"][name] = await encounters.get_all_matches(
            session,
            schemas.MatchSearchParams(**options),
            workspace_id=scope,
        )

    outputs["match_details"] = {}
    outputs["match_details_with_stats"] = {}
    outputs["killfeeds"] = {}
    for name in _MATCH_KEYS[:-1]:
        scope = ids["workspace_other"] if name == "match_other" else workspace
        tournament_id = await visibility.tournament_id_for_match(session, ids[name])
        await ensure_tournament_viewable(session, None, tournament_id)
        outputs["match_details"][name] = await encounters.get_match(
            session,
            ids[name],
            list(_MATCH_ENTITIES),
            workspace_id=scope,
        )
        outputs["match_details_with_stats"][name] = await _uncached(
            encounters.get_match_with_stats,
            session,
            ids[name],
            list(_MATCH_ENTITIES),
            workspace_id=scope,
        )
        # Do not sort/deduplicate either array: round/time/source order is behavior.
        outputs["killfeeds"][name] = await _uncached(
            encounters.get_match_kill_feed,
            session,
            ids[name],
            workspace_id=scope,
        )

    outputs["single_user_stats"] = {}
    outputs["batch_user_stats"] = {}
    user_ids = [ids[name] for name in _USER_KEYS]
    for match in _MATCH_KEYS:
        outputs["single_user_stats"][match] = {
            user: _stats_result(await encounter_service.get_match_stats_for_user(session, ids[match], ids[user]))
            for user in _USER_KEYS
        }
        batch = await encounter_service.get_match_stats_for_users(session, ids[match], user_ids)
        outputs["batch_user_stats"][match] = {user_id: _stats_result(stats) for user_id, stats in batch.items()}
    outputs["empty_user_batch"] = await encounter_service.get_match_stats_for_users(session, ids["match"], [])

    # The old admin DTO requires non-null time/log_name. Use its real provenance
    # filter for row pages; unfiltered count still includes the no-raw match.
    outputs["admin_pages"] = {}
    admin_cases = {
        "workspace_first": (workspace, {"page": 1, "per_page": 2, "log_status": ["done"]}),
        "workspace_second": (workspace, {"page": 2, "per_page": 2, "log_status": ["done"]}),
        "other_workspace": (ids["workspace_other"], {"log_status": ["done"]}),
        "all_rows_count": (workspace, {"only_count": True}),
        "tournament": (workspace, {"tournament_id": ids["tournament"], "log_status": ["done"]}),
        "map": (workspace, {"map_id": ids["map_other"], "log_status": ["done"]}),
        "name_search": (workspace, {"query": "reverse", "log_status": ["done"]}),
        "foreign_tournament": (workspace, {"tournament_id": ids["tournament_other"], "log_status": ["done"]}),
    }
    for name, (scope, options) in admin_cases.items():
        outputs["admin_pages"][name] = await matches_service.list_admin_matches(
            session,
            workspace_id=scope,
            params=schemas.AdminMatchesSearchParams(**options),
        )
    outputs["admin_details"] = {}
    for name in ("match", "match_reversed", "match_other", "match_hidden"):
        outputs["admin_details"][name] = await matches_service.get_admin_match(
            session,
            workspace_id=ids["workspace_other"] if name == "match_other" else workspace,
            match_id=ids[name],
        )

    outputs["visibility"] = {}
    for kind, resolve in (
        ("encounter", visibility.tournament_id_for_encounter),
        ("match", visibility.tournament_id_for_match),
    ):
        owners = {
            name: await resolve(session, ids[f"{kind}{suffix}"])
            for name, suffix in (("visible", ""), ("foreign", "_other"), ("hidden", "_hidden"))
        }
        outputs["visibility"][f"{kind}_owners"] = owners
        outputs["visibility"][f"hidden_{kind}"] = await _not_found(
            ensure_tournament_viewable(session, None, owners["hidden"]),
        )
    outputs["visibility"]["foreign_match"] = await _not_found(
        encounters.get_match(session, ids["match_other"], [], workspace_id=workspace),
    )
    outputs["visibility"]["foreign_match_stats"] = await _not_found(
        _uncached(
            encounters.get_match_with_stats,
            session,
            ids["match_other"],
            [],
            workspace_id=workspace,
        )
    )
    outputs["visibility"]["foreign_killfeed"] = await _not_found(
        _uncached(
            encounters.get_match_kill_feed,
            session,
            ids["match_other"],
            workspace_id=workspace,
        )
    )
    outputs["visibility"]["foreign_admin_match"] = await _not_found(
        matches_service.get_admin_match(session, workspace_id=workspace, match_id=ids["match_other"]),
    )
    return _normalize(outputs, participants)


def assert_tournament_golden(actual: dict) -> None:
    def comparable(payload):
        payload = deepcopy(payload)
        page = payload["match_pages"]["duration_desc"]
        # SQL orders only by duration. Preserve every group and its position;
        # incidental order inside equal-duration groups is not a reader contract.
        page["results"] = [
            row
            for _, tied_rows in groupby(page["results"], key=lambda row: row["time"])
            for row in sorted(tied_rows, key=lambda row: row["id"])
        ]
        return payload

    expected = comparable(json.loads(GOLDEN.read_text(encoding="utf-8")))
    normalized = comparable(actual)
    if normalized != expected:
        difference = unified_diff(
            json.dumps(expected, indent=2, sort_keys=True).splitlines(),
            json.dumps(normalized, indent=2, sort_keys=True).splitlines(),
            fromfile="frozen",
            tofile="native",
            lineterm="",
        )
        raise AssertionError("\n".join(islice(difference, 200)))


def test_duration_ties_keep_primary_order_and_exact_rows():
    actual = json.loads(GOLDEN.read_text(encoding="utf-8"))
    rows = actual["match_pages"]["duration_desc"]["results"]
    tied = next(index for index in range(len(rows) - 1) if rows[index]["time"] == rows[index + 1]["time"])
    rows[tied], rows[tied + 1] = rows[tied + 1], rows[tied]
    assert_tournament_golden(actual)

    for change in ("primary_order", "missing_row", "observed_score"):
        changed = deepcopy(actual)
        changed_rows = changed["match_pages"]["duration_desc"]["results"]
        if change == "primary_order":
            unequal = next(
                index
                for index in range(len(changed_rows) - 1)
                if changed_rows[index]["time"] != changed_rows[index + 1]["time"]
            )
            changed_rows[unequal], changed_rows[unequal + 1] = changed_rows[unequal + 1], changed_rows[unequal]
        elif change == "missing_row":
            changed_rows.pop()
        else:
            scores = changed_rows[0]["scores_by_participant"]
            scores[next(iter(scores))] += 1
        with pytest.raises(AssertionError):
            assert_tournament_golden(changed)


def test_native_readers_preserve_captured_p3_outputs(stats_parity_database):
    async def exercise():
        url, ids = stats_parity_database
        engine = create_async_engine(make_url(url).set(drivername="postgresql+asyncpg"))
        try:
            async with AsyncSession(engine, expire_on_commit=False) as session:
                assert_tournament_golden(await collect_outputs(session, ids))
        finally:
            await engine.dispose()

    asyncio.run(exercise())


def test_native_ow_readers_reject_foreign_discipline(stats_parity_database):
    async def exercise():
        from shared.models.stats.match import StatsMatch
        from shared.testing.stats_parity import seed_native_sentinel

        url, ids = stats_parity_database
        engine = create_async_engine(make_url(url).set(drivername="postgresql+asyncpg"))
        try:
            async with AsyncSession(engine, expire_on_commit=False) as session:
                overall_before = await _uncached(
                    tournaments.get_tournaments_overall,
                    session,
                    workspace_id=ids["workspace"],
                )
                # Only this adversarial clone gains LoL rows. The base golden and
                # genuinely multigame overview/count readers keep their own contract.
                await session.run_sync(lambda sync: seed_native_sentinel(sync.connection(), ids))
                foreign = await session.get(StatsMatch, ids["match_lol"])
                assert foreign is not None
                assert (foreign.workspace_id, foreign.discipline) == (ids["workspace"], "lol")
                overall_after = await _uncached(
                    tournaments.get_tournaments_overall,
                    session,
                    workspace_id=ids["workspace"],
                )
                assert overall_after.maps == overall_before.maps + 1
                public = await _uncached(
                    encounters.get_all_matches,
                    session,
                    schemas.MatchSearchParams(per_page=-1),
                    workspace_id=ids["workspace"],
                )
                assert foreign.id not in {row.id for row in public.results}
                from src.services.admin.encounter import encounter_service as admin

                with pytest.raises(BaseAPIException) as caught:
                    await admin.update_match(session, ids["match"], schemas.MatchUpdate(map_id=ids["map_lol"]))
                assert caught.value.status_code == 409
                await _not_found(admin.update_match(session, foreign.id, schemas.MatchUpdate(time=10)))
                assert await encounter_service.get_match_stats_for_user(session, foreign.id, ids["player"]) == ({}, {})
                assert await encounter_service.get_match_stats_for_users(session, foreign.id, [ids["player"]]) == {
                    ids["player"]: ({}, {}),
                }
                await _not_found(encounters.get_match(session, foreign.id, [], workspace_id=ids["workspace"]))
                await _not_found(
                    _uncached(
                        encounters.get_match_with_stats,
                        session,
                        foreign.id,
                        [],
                        workspace_id=ids["workspace"],
                    )
                )
                await _not_found(
                    _uncached(
                        encounters.get_match_kill_feed,
                        session,
                        foreign.id,
                        workspace_id=ids["workspace"],
                    )
                )
                await _not_found(
                    matches_service.get_admin_match(
                        session,
                        workspace_id=ids["workspace"],
                        match_id=foreign.id,
                    )
                )
        finally:
            await engine.dispose()

    asyncio.run(exercise())


def test_native_slots_preserve_observed_scores_for_retired_participants(stats_parity_database):
    async def exercise():
        # Local import: capture loads this module with frozen P3 production packages.
        from shared.models.stats.match import StatsMatchTeam
        from src import models

        url, ids = stats_parity_database
        expected = json.loads(GOLDEN.read_text(encoding="utf-8"))
        engine = create_async_engine(make_url(url).set(drivername="postgresql+asyncpg"))
        try:
            async with AsyncSession(engine, expire_on_commit=False) as session:
                for retired in (False, True):
                    if retired:
                        await session.execute(
                            sa.update(models.EncounterTeam)
                            .where(
                                models.EncounterTeam.id.in_([ids["encounter_team_home"], ids["encounter_team_away"]]),
                            )
                            .values(active=False)
                        )
                    seats = (
                        await session.execute(
                            sa.select(
                                StatsMatchTeam.encounter_game_id,
                                StatsMatchTeam.encounter_team_id,
                                StatsMatchTeam.source_position,
                                models.EncounterTeam.slot,
                            )
                            .join(models.EncounterTeam, models.EncounterTeam.id == StatsMatchTeam.encounter_team_id)
                            .where(StatsMatchTeam.match_id == ids["match_reversed"])
                            .order_by(models.EncounterTeam.slot)
                        )
                    ).all()
                    assert seats == [
                        (ids["game_reversed"], ids["encounter_team_home"], 2, 1),
                        (ids["game_reversed"], ids["encounter_team_away"], 1, 2),
                    ]
                    page = await encounters.get_all_matches(
                        session,
                        schemas.MatchSearchParams(tournament_id=ids["tournament"], entities=["teams", "map"]),
                        workspace_id=ids["workspace"],
                    )
                    detail = await encounters.get_encounter(session, ids["encounter"], ["matches", "matches.teams"])
                    for name in ("match", "match_reversed", "match_no_raw"):
                        golden = expected["match_details"][name]
                        direct = await encounters.get_match(
                            session,
                            ids[name],
                            ["teams", "map"],
                            workspace_id=ids["workspace"],
                        )
                        with_stats = await _uncached(
                            encounters.get_match_with_stats,
                            session,
                            ids[name],
                            ["map"],
                            workspace_id=ids["workspace"],
                        )
                        listed = next(match for match in page.results if match.id == ids[name])
                        nested = next(match for match in detail.matches if match.id == ids[name])
                        for match in (direct, with_stats, listed, nested):
                            assert (match.home_team_id, match.away_team_id) == (ids["team_home"], ids["team_away"])
                            assert (match.home_team.id, match.away_team.id) == (ids["team_home"], ids["team_away"])
                            assert match.score.home == golden["scores_by_participant"][str(ids["encounter_team_home"])]
                            assert match.score.away == golden["scores_by_participant"][str(ids["encounter_team_away"])]
                            assert isinstance(match.score.home, int) and isinstance(match.score.away, int)
                            assert (match.map_index, match.map_id) == (golden["map_index"], golden["map_id"])
                            assert {"source", "code"}.isdisjoint(match.model_dump())
                        official = next(
                            game
                            for game in expected["encounter_details"]["encounter"]["games"]
                            if game["position"] == golden["map_index"]
                        )
                        assert golden["scores_by_participant"] != {
                            str(team["encounter_team_id"]): team["score"] for team in official["teams"]
                        }
        finally:
            await engine.dispose()

    asyncio.run(exercise())


@pytest.mark.parametrize("field", ["home_team_id", "away_team_id", "code", "source", "log_name"])
def test_match_update_rpc_rejects_removed_fields(stats_parity_database, field):
    async def exercise():
        from types import SimpleNamespace
        from unittest.mock import patch

        from src.rpc import _helpers, admin_misc
        from tests._rpc_fakes import CapturingBroker, FakeSessionMaker, make_identity

        url, ids = stats_parity_database
        engine = create_async_engine(make_url(url).set(drivername="postgresql+asyncpg"))
        try:
            async with AsyncSession(engine, expire_on_commit=False) as session:
                broker = CapturingBroker()
                admin_misc.register(broker, SimpleNamespace(exception=lambda *args, **kwargs: None))
                identity = make_identity(user_id=ids["auth_user"], is_superuser=True)
                before = await encounters.get_match(session, ids["match"], [])
                with patch.object(_helpers.db, "async_session_maker", FakeSessionMaker(session)):
                    result = await broker.handlers["rpc.tournament.encounter_update_match"](
                        {"identity": identity, "id": ids["match"], "payload": {field: 1}},
                        None,
                    )
                assert result["ok"] is False
                assert result["error"]["code"] == "unprocessable"
                after = await encounters.get_match(session, ids["match"], [])
                assert after == before
        finally:
            await engine.dispose()

    asyncio.run(exercise())


def test_native_admin_no_raw_rows_and_map_conflict(stats_parity_database):
    async def exercise():
        from shared.models import StatsFact, StatsMatch
        from src.services.admin.encounter import encounter_service as admin

        url, ids = stats_parity_database
        engine = create_async_engine(make_url(url).set(drivername="postgresql+asyncpg"))
        try:
            async with AsyncSession(engine, expire_on_commit=False) as session:
                detail = await matches_service.get_admin_match(
                    session,
                    workspace_id=ids["workspace"],
                    match_id=ids["match_no_raw"],
                )
                assert detail.time is None and detail.log_name is None and detail.log_record is None
                assert (detail.rounds, detail.statistics_count, detail.kill_feed_count, detail.event_count) == (
                    0,
                    0,
                    0,
                    0,
                )
                page = await matches_service.list_admin_matches(
                    session,
                    workspace_id=ids["workspace"],
                    params=schemas.AdminMatchesSearchParams(unlinked_only=True),
                )
                assert ids["match_no_raw"] in {row.id for row in page.results}
                before = (
                    await session.execute(
                        sa.select(StatsFact.__table__).where(
                            StatsFact.match_id == ids["match"],
                        )
                    )
                ).all()
                with pytest.raises(BaseAPIException) as caught:
                    await admin.update_match(session, ids["match"], schemas.MatchUpdate(map_id=ids["map_other"]))
                assert caught.value.status_code == 409
                assert (await session.get(StatsMatch, ids["match"])).map_entity_id == ids["map"]
                assert (
                    await session.execute(
                        sa.select(StatsFact.__table__).where(
                            StatsFact.match_id == ids["match"],
                        )
                    )
                ).all() == before
        finally:
            await engine.dispose()

    asyncio.run(exercise())


def test_native_admin_edits_keep_narrow_evidence_and_official_results(stats_parity_database):
    async def exercise():
        from shared.models import AuditLog, EncounterGameTeam, StatsMatch
        from src.services.admin.encounter import encounter_service as admin

        url, ids = stats_parity_database
        engine = create_async_engine(make_url(url).set(drivername="postgresql+asyncpg"))
        try:
            async with AsyncSession(engine, expire_on_commit=False) as session:
                official = (
                    await session.execute(
                        sa.select(EncounterGameTeam.__table__)
                        .where(
                            EncounterGameTeam.game_id == ids["game_reversed"],
                        )
                        .order_by(EncounterGameTeam.encounter_team_id)
                    )
                ).all()
                await admin.update_match(
                    session,
                    ids["match_reversed"],
                    schemas.MatchUpdate(home_score=9, away_score=8, time=123.5),
                )
                actual = await encounters.get_match(session, ids["match_reversed"], [])
                assert (actual.score.home, actual.score.away, actual.time) == (9, 8, 123.5)
                assert (await session.get(StatsMatch, ids["match_reversed"])).revision == 1
                assert (
                    await session.execute(
                        sa.select(EncounterGameTeam.__table__)
                        .where(
                            EncounterGameTeam.game_id == ids["game_reversed"],
                        )
                        .order_by(EncounterGameTeam.encounter_team_id)
                    )
                ).all() == official
                audits = (
                    await session.scalars(
                        sa.select(AuditLog)
                        .where(
                            AuditLog.action.in_(["stats.score_edit", "stats.match_edit"]),
                            AuditLog.entity_id == ids["match_reversed"],
                        )
                        .order_by(AuditLog.id)
                    )
                ).all()
                assert [audit.action for audit in audits] == ["stats.score_edit", "stats.match_edit"]
                for audit in audits:
                    before = {state["subset"]: state for state in audit.before_json["stats_evidence"]["states"]}
                    after = {state["subset"]: state for state in audit.after_json["stats_evidence"]["states"]}
                    changed = {key for key in before if before[key] != after[key]}
                    assert changed == (
                        {"team_scores"} if audit.action == "stats.score_edit" else {"duration", "updated_at"}
                    )
        finally:
            await engine.dispose()

    asyncio.run(exercise())


def test_tournament_registry_delete_stages_native_owner_evidence(stats_parity_database):
    async def exercise():
        import hashlib
        from unittest.mock import patch

        from shared.models import AuditLog, IngestJob, StatsMatch
        from src.services.admin.registry import dispatcher
        from tests._rpc_fakes import FakeSessionMaker, make_identity

        url, ids = stats_parity_database
        engine = create_async_engine(make_url(url).set(drivername="postgresql+asyncpg"))
        try:
            async with AsyncSession(engine, expire_on_commit=False) as session:
                session.add_all(
                    [
                        IngestJob(
                            workspace_id=ids["workspace"],
                            discipline="overwatch",
                            source_kind="upload",
                            content_hash=hashlib.sha256(f"native-delete-job-{i}".encode()).hexdigest(),
                            raw_ref=f"logs/{ids['tournament']}/native-delete-{i}.csv",
                            filename=f"native-delete-{i}.csv",
                            status="pending",
                            hint_tournament_id=ids["tournament"],
                        )
                        for i in range(101)
                    ]
                )
                await session.commit()
                with patch.object(dispatcher, "_session_factory", FakeSessionMaker(session)):
                    result = await dispatcher.do_delete(
                        {
                            "entity": "tournament",
                            "id": ids["tournament"],
                            "identity": make_identity(user_id=ids["auth_user"], is_superuser=True),
                        }
                    )
                assert result["ok"] is True, result
                assert await session.scalar(sa.select(StatsMatch.id).where(StatsMatch.id == ids["match"])) is None
                job = await session.get(IngestJob, ids["record"])
                assert job is not None
                assert job.hint_tournament_id is None and job.hint_encounter_id is None
                audits = (
                    await session.scalars(
                        sa.select(AuditLog).where(
                            AuditLog.action == "stats.owner_delete",
                            AuditLog.entity_type == "tournament",
                            AuditLog.entity_id == ids["tournament"],
                        )
                    )
                ).all()
                assert len(audits) >= 2
                for audit in audits:
                    owners = {
                        (state["owner_kind"], tuple(state["owner_key"]))
                        for state in audit.before_json["stats_evidence"]["states"]
                    }
                    assert len(owners) <= 100
                states = [state for audit in audits for state in audit.after_json["stats_evidence"]["states"]]
                assert any(
                    state["owner_kind"] == "match"
                    and state["owner_key"] == [ids["match"]]
                    and not state["owner_exists"]
                    for state in states
                )
                assert any(
                    state["owner_kind"] == "job" and state["owner_key"] == [ids["record"]] and state["owner_exists"]
                    for state in states
                )
                assert await session.get(StatsMatch, ids["match_other"]) is not None
        finally:
            await engine.dispose()

    asyncio.run(exercise())


def test_native_owner_delete_and_evidence_roll_back_together(stats_parity_database):
    async def exercise():
        from shared.models import AuditLog, IngestJob, StatsMatch, Tournament
        from shared.services.stats_owner_delete import capture_owner_delete, stage_owner_delete

        url, ids = stats_parity_database
        engine = create_async_engine(make_url(url).set(drivername="postgresql+asyncpg"))
        try:
            async with AsyncSession(engine, expire_on_commit=False) as session:
                with pytest.raises(RuntimeError, match="abort owner deletion"):
                    async with session.begin():
                        before = await capture_owner_delete(session, tournament_id=ids["tournament"])
                        await session.execute(sa.delete(Tournament).where(Tournament.id == ids["tournament"]))
                        audits = await stage_owner_delete(
                            session,
                            before,
                            workspace_id=ids["workspace"],
                            entity_type="tournament",
                            entity_id=ids["tournament"],
                        )
                        assert audits
                        raise RuntimeError("abort owner deletion")
                assert (
                    await session.scalar(sa.select(StatsMatch.id).where(StatsMatch.id == ids["match"])) == ids["match"]
                )
                assert (
                    await session.scalar(
                        sa.select(IngestJob.hint_tournament_id).where(
                            IngestJob.id == ids["record"],
                        )
                    )
                    == ids["tournament"]
                )
                assert (
                    await session.scalar(
                        sa.select(sa.func.count())
                        .select_from(AuditLog)
                        .where(
                            AuditLog.action == "stats.owner_delete",
                            AuditLog.entity_id == ids["tournament"],
                        )
                    )
                    == 0
                )
        finally:
            await engine.dispose()

    asyncio.run(exercise())


def test_native_nullable_events_and_historical_source_teams_are_not_dropped(stats_parity_database):
    async def exercise():
        from shared.models import EncounterTeam, StatsEvent

        url, ids = stats_parity_database
        engine = create_async_engine(make_url(url).set(drivername="postgresql+asyncpg"))
        try:
            async with AsyncSession(engine, expire_on_commit=False) as session:
                before = await _uncached(
                    encounters.get_match_kill_feed,
                    session,
                    ids["match"],
                    workspace_id=ids["workspace"],
                )
                assert before.kills and before.events
                await session.execute(
                    sa.update(StatsEvent)
                    .where(StatsEvent.match_id == ids["match"])
                    .values(
                        actor_member_id=None,
                        target_member_id=None,
                        actor_team_id=None,
                        target_team_id=None,
                        entity_id=None,
                        related_entity_id=None,
                        data=None,
                    )
                )
                after = await _uncached(
                    encounters.get_match_kill_feed,
                    session,
                    ids["match"],
                    workspace_id=ids["workspace"],
                )
                assert [(row.round, row.time) for row in after.kills] == [(row.round, row.time) for row in before.kills]
                assert [(row.round, row.time, row.name) for row in after.events] == [
                    (row.round, row.time, row.name) for row in before.events
                ]
                for row in after.kills:
                    assert all(value is None for key, value in row.model_dump().items() if key not in {"round", "time"})
                for row in after.events:
                    assert all(
                        value is None for key, value in row.model_dump().items() if key not in {"round", "time", "name"}
                    )
                await session.execute(
                    sa.update(EncounterTeam)
                    .where(
                        EncounterTeam.encounter_id == ids["encounter"],
                    )
                    .values(team_id=None)
                )
                detail = await _uncached(
                    encounters.get_match_with_stats,
                    session,
                    ids["match"],
                    [],
                    workspace_id=ids["workspace"],
                )
                assert detail.home_team_id is None and detail.away_team_id is None
                assert detail.home_team is None and detail.away_team is None
                assert (detail.score.home, detail.score.away) == (2, 1)
        finally:
            await engine.dispose()

    asyncio.run(exercise())
