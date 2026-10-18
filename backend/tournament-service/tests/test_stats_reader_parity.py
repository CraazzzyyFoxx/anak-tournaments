"""Immutable P3 reader parity and native historical-consumer regressions.

The golden was captured before native cutover. Tests only read it; intentional
wire/identity changes are projected without changing its numeric expectations.
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
    """Project native observed identities onto the immutable P3 representation."""
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
            participation = row.pop(f"{side}_participation", None)
            if participation is not None and "players" in participation:
                # Only this frozen wire projection uses real source-roster metadata.
                # Production never filters observations through that roster.
                observed = {player["user_id"]: player for player in participation["players"]}
                assert len(observed) == len(participation["players"])
                roster_ids = {player["user_id"] for player in team["players"]}
                assert all(
                    player["user_id"] in roster_ids or not (player["stats"] or player["heroes"])
                    for player in participation["players"]
                )
                team["players"] = [
                    {
                        **player,
                        "stats": observed[player["user_id"]]["stats"],
                        # The old nested DTO used HeroRead; direct stats retained timestamps.
                        "heroes": {
                            segment: [{key: hero[key] for key in schemas.HeroRead.model_fields} for hero in heroes]
                            for segment, heroes in observed[player["user_id"]]["heroes"].items()
                        },
                    }
                    for player in team["players"]
                    if player["user_id"] in observed and observed[player["user_id"]]["heroes"]
                ]
            participant_id = str(participants[team_id])
            row["scores_by_participant"][participant_id] = scores[side] if public_match else row.pop(f"{side}_score")
            row["teams_by_participant"][participant_id] = team
            row["team_ids_by_participant"][participant_id] = team_id
        row.pop("source", None)
        row.pop("code", None)
        if public_match:
            # New capability metadata has separate behavior coverage; the frozen
            # P3 oracle continues to guard every historical ID, score and fact.
            row.pop("raw_status", None)
            row.pop("raw_available", None)

    # These are unordered relationship/JSON aggregates, not ranked result lists.
    if isinstance(row.get("matches"), list):
        row["matches"].sort(key=lambda match: (match["map_index"] is None, match["map_index"] or 0, match["id"]))
    if isinstance(row.get("players"), list):
        row["players"].sort(
            key=lambda player: (
                player["user_id"] is None,
                player["user_id"],
                player.get("workspace_member_id", player.get("id")),
            )
        )
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
    """Project native reader outputs onto the frozen P3 numeric and metadata oracle."""
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
    for match in _MATCH_KEYS:
        observed = await encounter_service.get_match_observed_players(session, ids[match])
        players = [player for side in observed.values() for player in side]
        by_user = {player.user_id: (player.stats, player.heroes) for player in players}
        assert len(by_user) == len(players)
        outputs["single_user_stats"][match] = {
            user: _stats_result(by_user.get(ids[user], ({}, {}))) for user in _USER_KEYS
        }
        outputs["batch_user_stats"][match] = {
            ids[user]: _stats_result(by_user.get(ids[user], ({}, {}))) for user in _USER_KEYS
        }

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
    def without_post_capture_fields(value):
        """``TournamentRead.logs_official`` (P5) postdates the frozen P4 capture; it is not a reader output."""
        if isinstance(value, dict):
            return {key: without_post_capture_fields(item) for key, item in value.items() if key != "logs_official"}
        if isinstance(value, list):
            return [without_post_capture_fields(item) for item in value]
        return value

    def comparable(payload):
        payload = without_post_capture_fields(deepcopy(payload))
        # The removed roster/user-batch API's empty-input shape has no facts.
        payload.pop("empty_user_batch", None)
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
                assert await encounter_service.get_match_observed_players(session, foreign.id) == {}
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
                        session.add_all(
                            [
                                models.EncounterTeam(
                                    encounter_id=ids["encounter"],
                                    tournament_id=ids["tournament"],
                                    slot=slot,
                                    team_id=ids[f"team_{side}"],
                                    name=f"Replacement {side}",
                                )
                                for slot, side in ((1, "home"), (2, "away"))
                            ]
                        )
                        await session.flush()
                        session.expire_all()
                    seats = (
                        await session.execute(
                            sa.select(
                                StatsMatchTeam.encounter_id,
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
                        (ids["encounter"], ids["encounter_team_home"], 2, 1),
                        (ids["encounter"], ids["encounter_team_away"], 1, 2),
                    ]
                    page = await encounters.get_all_matches(
                        session,
                        schemas.MatchSearchParams(tournament_id=ids["tournament"], entities=["teams", "map"]),
                        workspace_id=ids["workspace"],
                    )
                    detail = await encounters.get_encounter(session, ids["encounter"], ["matches", "matches.teams"])
                    assert all(seat.active for seat in detail.teams)
                    if retired:
                        assert {seat.id for seat in detail.teams}.isdisjoint(
                            {ids["encounter_team_home"], ids["encounter_team_away"]}
                        )
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
                            assert match.home_participation.id == ids["encounter_team_home"]
                            assert match.away_participation.id == ids["encounter_team_away"]
                            assert match.home_participation.active is not retired
                            assert match.away_participation.active is not retired
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
        from shared.models import EncounterTeam, StatsEvent, StatsMatchPlayer, Team

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
                    sa.update(StatsMatchPlayer)
                    .where(
                        StatsMatchPlayer.match_id == ids["match"],
                        StatsMatchPlayer.workspace_member_id == ids["member"],
                    )
                    .values(handle_snapshot="HistoricalHandle#1234")
                )
                await session.execute(
                    sa.update(EncounterTeam).where(EncounterTeam.encounter_id == ids["encounter"]).values(active=False)
                )
                await session.execute(sa.delete(Team).where(Team.id.in_([ids["team_home"], ids["team_away"]])))
                session.expire_all()
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
                assert detail.rounds == 2
                golden = json.loads(GOLDEN.read_text(encoding="utf-8"))["batch_user_stats"]["match"]
                for side in ("home", "away"):
                    participation = getattr(detail, f"{side}_participation")
                    assert participation.id == ids[f"encounter_team_{side}"]
                    assert not participation.active
                    assert participation.team_id is None and participation.team is None
                    for player in participation.players:
                        assert _normalize(player.stats, {}) == golden[str(player.user_id)]["statistics"]
                        assert (
                            _normalize({"heroes": player.heroes}, {})["heroes"] == golden[str(player.user_id)]["heroes"]
                        )
                        assert {"id", "rank", "role", "team_id"}.isdisjoint(player.model_dump())
                home = next(p for p in detail.home_participation.players if p.workspace_member_id == ids["member"])
                away = next(p for p in detail.away_participation.players if p.workspace_member_id == ids["member_away"])
                assert home.name == "HistoricalHandle#1234"
                assert home.stats[0]["hero_damage_dealt"] == 18000
                assert away.stats[0]["hero_damage_dealt"] == 36000
                event_only = next(
                    p for p in detail.home_participation.players if p.workspace_member_id == ids["member_event_only"]
                )
                assert event_only.stats == {} and event_only.heroes == {}
                current = await encounters.get_encounter(session, ids["encounter"], ["teams"])
                assert current.teams == []
        finally:
            await engine.dispose()

    asyncio.run(exercise())


def test_parsed_non_roster_member_keeps_snapshot_and_side_scoped_numbers(stats_parity_database):
    async def exercise():
        from shared.models import EncounterTeamMember, Player, StatDef, StatsFact, StatsMatchPlayer, WorkspaceMember

        url, ids = stats_parity_database
        engine = create_async_engine(make_url(url).set(drivername="postgresql+asyncpg"))
        try:
            async with AsyncSession(engine, expire_on_commit=False) as session:
                await session.execute(
                    sa.delete(EncounterTeamMember).where(
                        EncounterTeamMember.encounter_id == ids["encounter"],
                        EncounterTeamMember.workspace_member_id == ids["member"],
                    )
                )
                await session.execute(
                    sa.delete(Player).where(
                        Player.tournament_id == ids["tournament"],
                        Player.workspace_member_id == ids["member"],
                    )
                )
                await session.execute(
                    sa.update(StatsMatchPlayer)
                    .where(
                        StatsMatchPlayer.match_id == ids["match"],
                        StatsMatchPlayer.workspace_member_id == ids["member"],
                    )
                    .values(handle_snapshot="ParsedNonRoster#1234")
                )
                detail = await _uncached(
                    encounters.get_match_with_stats,
                    session,
                    ids["match"],
                    ["teams", "teams.players"],
                    workspace_id=ids["workspace"],
                )
                player = next(p for p in detail.home_participation.players if p.workspace_member_id == ids["member"])
                assert player.name == "ParsedNonRoster#1234"
                assert player.user_id == ids["player"]
                assert player.stats[0]["hero_damage_dealt"] == 18000
                assert player.stats[1]["hero_damage_dealt"] == 9000
                assert {hero.id for hero in player.heroes[0]} == {ids["hero"], ids["hero_other"]}
                assert all(p.user_id != ids["player"] for p in detail.home_team.players)
                assert {"id", "rank", "role", "team_id"}.isdisjoint(player.model_dump())

                # Changing linked global identities must not move native numbers
                # between the observed sides or replace their handle snapshots.
                await session.execute(
                    sa.update(WorkspaceMember)
                    .where(WorkspaceMember.id == ids["member"])
                    .values(player_id=ids["player_no_member"])
                )
                await session.execute(
                    sa.update(WorkspaceMember)
                    .where(WorkspaceMember.id == ids["member_away"])
                    .values(player_id=ids["player"])
                )
                await session.execute(
                    sa.update(WorkspaceMember)
                    .where(WorkspaceMember.id == ids["member"])
                    .values(player_id=ids["player_away"])
                )
                await session.execute(
                    sa.update(StatsFact)
                    .where(
                        StatsFact.match_id == ids["match"],
                        StatsFact.workspace_member_id == ids["member"],
                        StatsFact.entity_id.is_not(None),
                        StatsFact.stat_id.in_(
                            sa.select(StatDef.id).where(
                                StatDef.discipline == "overwatch", StatDef.code == "hero_time_played"
                            )
                        ),
                    )
                    .values(value=30)
                )
                session.expire_all()
                changed = await _uncached(
                    encounters.get_match_with_stats,
                    session,
                    ids["match"],
                    [],
                    workspace_id=ids["workspace"],
                )
                home = next(p for p in changed.home_participation.players if p.workspace_member_id == ids["member"])
                away = next(
                    p for p in changed.away_participation.players if p.workspace_member_id == ids["member_away"]
                )
                assert home.user_id == ids["player_away"] and away.user_id == ids["player"]
                assert home.name == "ParsedNonRoster#1234"
                assert home.stats == player.stats and home.heroes == {}
                assert away.stats[0]["hero_damage_dealt"] == 36000
        finally:
            await engine.dispose()

    asyncio.run(exercise())


def test_unbound_history_preserves_complete_reader_outputs_and_visibility(stats_parity_database):
    async def exercise():
        from shared.models import IngestJob, RawSourceStatus, StatsMatch, Workspace

        url, ids = stats_parity_database
        engine = create_async_engine(make_url(url).set(drivername="postgresql+asyncpg"))
        try:
            async with AsyncSession(engine, expire_on_commit=False) as session:
                before = await collect_outputs(session, ids)
                assert_tournament_golden(before)
                unbound_ids = {ids[name] for name in _MATCH_KEYS}
                await session.execute(
                    sa.update(StatsMatch)
                    .where(StatsMatch.id.in_([ids[name] for name in _MATCH_KEYS]))
                    .values(encounter_game_id=None, source_map_index=99, updated_at=StatsMatch.updated_at)
                )
                session.expire_all()
                after = await collect_outputs(session, ids)

                def without_proven_order(value):
                    if isinstance(value, list):
                        return [without_proven_order(item) for item in value]
                    if not isinstance(value, dict):
                        return value
                    result = {key: without_proven_order(item) for key, item in value.items()}
                    if result.get("id") in unbound_ids and "map_index" in result:
                        result["map_index"] = None
                    if isinstance(result.get("matches"), list):
                        result["matches"].sort(
                            key=lambda match: (match["map_index"] is None, match["map_index"] or 0, match["id"])
                        )
                    return result

                expected = without_proven_order(before)
                # Explicit map-index sorting has a stable ID tie-break only for
                # presentation; none of these IDs is exposed as official order.
                expected["match_pages"]["tournament"]["results"].sort(
                    key=lambda match: (match["map_index"] is None, match["map_index"] or 0, match["id"])
                )
                assert after == expected
                assert all(
                    row["map_index"] is None
                    for row in after["match_pages"]["platform"]["results"]
                    if row["id"] in unbound_ids
                )
                await session.execute(
                    sa.update(StatsMatch)
                    .where(StatsMatch.id == ids["match_no_raw"])
                    .values(encounter_game_id=ids["game_no_raw"])
                )
                bound_history = [
                    (row["id"], row["map_index"])
                    for row in before["match_pages"]["tournament"]["results"]
                    if row["id"] not in unbound_ids
                ]
                for order in ("asc", "desc"):
                    page = await encounters.get_all_matches(
                        session,
                        schemas.MatchSearchParams(tournament_id=ids["tournament"], sort="map_index", order=order),
                        workspace_id=ids["workspace"],
                    )
                    bound = sorted(
                        [(ids["match_no_raw"], 3), *bound_history], key=lambda row: row[1], reverse=order == "desc"
                    )
                    assert [(row.id, row.map_index) for row in page.results] == bound + [
                        (ids["match"], None),
                        (ids["match_reversed"], None),
                    ]
                await session.execute(
                    sa.update(IngestJob).where(IngestJob.id == ids["record"]).values(raw_status=RawSourceStatus.MISSING)
                )
                detail = await encounters.get_match(session, ids["match"], [], workspace_id=ids["workspace"])
                assert detail.raw_status == RawSourceStatus.MISSING
                assert detail.raw_available is False
                assert detail.log_name == before["match_details"]["match"]["log_name"]

                # An unbound source remains linked to its job; unlinked_only
                # continues to mean no ingestion record, not no official game.
                unlinked = await matches_service.list_admin_matches(
                    session,
                    workspace_id=ids["workspace"],
                    params=schemas.AdminMatchesSearchParams(unlinked_only=True),
                )
                expected_recordless = set(
                    (
                        await session.execute(
                            sa.text("""SELECT m.id FROM matches.match m
                                JOIN encounter.encounter e ON e.id=m.encounter_id
                                WHERE e.workspace_id=:workspace AND m.log_record_id IS NULL"""),
                            {"workspace": ids["workspace"]},
                        )
                    ).scalars()
                )
                assert {row.id for row in unlinked.results} == expected_recordless
                await session.execute(
                    sa.update(Workspace).where(Workspace.id == ids["workspace"]).values(is_hidden=True)
                )
                owner = await visibility.tournament_id_for_match(session, ids["match"])
                assert owner == ids["tournament"]
                await _not_found(ensure_tournament_viewable(session, None, owner))
                page = await encounters.get_all_matches(session, schemas.MatchSearchParams(per_page=-1))
                assert ids["match"] not in {row.id for row in page.results}
        finally:
            await engine.dispose()

    asyncio.run(exercise())


def test_unbound_match_update_rpc_audits_direct_owner_without_changing_official_results(stats_parity_database):
    async def exercise():
        from types import SimpleNamespace
        from unittest.mock import patch

        from shared.models import AuditLog, EncounterGameTeam, StatsMatch
        from src.rpc import _helpers, admin_misc
        from src.services.admin.encounter import encounter_service as admin
        from tests._rpc_fakes import CapturingBroker, FakeSessionMaker, make_identity

        url, ids = stats_parity_database
        engine = create_async_engine(make_url(url).set(drivername="postgresql+asyncpg"))
        try:
            async with AsyncSession(engine, expire_on_commit=False) as session:
                await session.execute(
                    sa.update(StatsMatch).where(StatsMatch.id == ids["match"]).values(encounter_game_id=None)
                )
                official_query = (
                    sa.select(EncounterGameTeam.__table__)
                    .where(EncounterGameTeam.game_id == ids["game"])
                    .order_by(EncounterGameTeam.encounter_team_id)
                )
                official = (await session.execute(official_query)).all()
                with pytest.raises(BaseAPIException) as caught:
                    await admin.update_match(session, ids["match"], schemas.MatchUpdate(map_id=ids["map_other"]))
                assert caught.value.status_code == 409

                broker = CapturingBroker()
                admin_misc.register(broker, SimpleNamespace(exception=lambda *args, **kwargs: None))
                identity = make_identity(user_id=ids["auth_user"], is_superuser=True)
                with patch.object(_helpers.db, "async_session_maker", FakeSessionMaker(session)):
                    result = await broker.handlers["rpc.tournament.encounter_update_match"](
                        {
                            "identity": identity,
                            "id": ids["match"],
                            "payload": {"map_id": ids["map"], "home_score": 9, "away_score": 8, "time": 123.5},
                        },
                        None,
                    )
                assert result["ok"] is True, result
                assert result["data"]["encounter_id"] == ids["encounter"]
                assert (result["data"]["home_score"], result["data"]["away_score"], result["data"]["time"]) == (
                    9,
                    8,
                    123.5,
                )
                audit = (
                    await session.scalars(sa.select(AuditLog).where(AuditLog.action == "encounter.update_match"))
                ).one()
                assert (audit.entity_type, audit.entity_id, audit.workspace_id) == (
                    "encounter",
                    ids["encounter"],
                    ids["workspace"],
                )
                assert (await session.execute(official_query)).all() == official
                detail = await encounters.get_match(session, ids["match"], [])
                assert (detail.encounter_id, detail.map_index) == (ids["encounter"], None)
        finally:
            await engine.dispose()

    asyncio.run(exercise())
