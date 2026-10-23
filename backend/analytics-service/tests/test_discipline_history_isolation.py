"""Module-owned history readers and stored-prediction reads ignore another discipline's rows and other algorithms.

One real database (P4's transferred statistics fixture plus a same-workspace LoL history): the same members play LoL
rosters with the same role codes (``damage``, ``support``) on an earlier, id-adjacent tournament, with their own
performance rows, and a foreign algorithm holds a second prediction for every Overwatch player. Each Overwatch reader
must return exactly what it returned before any of that existed.
"""

from __future__ import annotations

import asyncio
import json
import typing
from datetime import timedelta

import pandas as pd
import pytest
import sqlalchemy as sa
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from shared import models
from shared.core import errors
from shared.domain.analytics import MATCH_QUALITY_MODEL, PERFORMANCE_MODEL, STANDINGS_MODEL
from shared.testing.stats_parity import _DATES, STAMP, _insert, seed_native_sentinel
from src.core import config
from src.services.analytics.reads import flows_service
from tests.ow_analytics import exports

OW = "overwatch"


def _sync(url: str, work: typing.Callable[[sa.Connection], typing.Any]) -> typing.Any:
    engine = sa.create_engine(url)
    try:
        with engine.begin() as conn:
            return work(conn)
    finally:
        engine.dispose()


def _algorithm(conn: sa.Connection, name: str) -> int:
    found = conn.scalar(sa.text("SELECT id FROM analytics.algorithms WHERE name=:n"), {"n": name})
    if found is not None:
        return int(found)
    return int(
        conn.scalar(
            sa.text(
                "INSERT INTO analytics.algorithms(name, produces_shifts, created_at, updated_at) "
                "VALUES (:n, false, :t, :t) RETURNING id"
            ),
            {"n": name, "t": STAMP},
        )
    )


def _copy_performance(
    conn: sa.Connection,
    *,
    source_player: int,
    tournament: int,
    player: int,
    algorithm: int,
    source_algorithm: int,
    shift: float = 0.0,
) -> None:
    columns = list(
        conn.scalars(
            sa.text(
                "SELECT column_name FROM information_schema.columns WHERE table_schema='analytics' "
                "AND table_name='performance' AND column_name NOT IN ('id','tournament_id','player_id','algorithm_id')"
            )
        )
    )
    listed = ",".join(f'"{c}"' for c in columns)
    conn.execute(
        sa.text(
            f"INSERT INTO analytics.performance(tournament_id,player_id,algorithm_id,{listed}) "
            f"SELECT :t,:p,:a,{listed} FROM analytics.performance WHERE player_id=:src AND algorithm_id=:sa"
        ),
        {"t": tournament, "p": player, "a": algorithm, "src": source_player, "sa": source_algorithm},
    )
    if shift:
        conn.execute(
            sa.text(
                "UPDATE analytics.performance SET raw_value=raw_value+:s, local_zscore=local_zscore+:s "
                "WHERE player_id=:p AND tournament_id=:t AND algorithm_id=:a"
            ),
            {"s": shift, "p": player, "t": tournament, "a": algorithm},
        )


def _seed_lol_history(conn: sa.Connection, ids: dict[str, int], *, sentinel: bool = True) -> dict[str, typing.Any]:
    """An earlier LoL tournament (id just below the Overwatch one) whose rosters mirror the Overwatch members."""
    if sentinel:
        seed_native_sentinel(conn, ids)
    lol_tid = ids["tournament"] - 1
    assert conn.scalar(sa.text("SELECT 1 FROM tournament.tournament WHERE id=:i"), {"i": lol_tid}) is None
    dimension = conn.scalar(sa.text("SELECT id FROM catalog.role_dimension WHERE discipline='lol' AND rated"))
    for code in ("damage", "support"):
        conn.execute(
            sa.text(
                "INSERT INTO catalog.role(dimension_id,code,name) VALUES (:d,:c,:c) "
                "ON CONFLICT (dimension_id,code) WHERE workspace_id IS NULL DO NOTHING"
            ),
            {"d": dimension, "c": code},
        )
    lol_roles = {
        row.code: row.id
        for row in conn.execute(
            sa.text("SELECT id, code FROM catalog.role WHERE dimension_id=:d AND workspace_id IS NULL"),
            {"d": dimension},
        )
    }
    _insert(
        conn,
        "tournament.tournament",
        id=lol_tid,
        workspace_id=ids["workspace"],
        discipline="lol",
        name="P6 LoL history",
        slug="p6-lol-history",
        status="completed",
        is_finished=True,
        start_date=STAMP - timedelta(days=60),
        end_date=STAMP - timedelta(days=59),
        **_DATES,
    )
    teams = {}
    for side in ("home", "away"):
        team = lol_tid * 10 + (1 if side == "home" else 2)
        teams[side] = team
        _insert(
            conn,
            "tournament.team",
            id=team,
            tournament_id=lol_tid,
            name=f"P6 LoL {side}",
            balancer_name=f"p6-lol-{side}",
            **_DATES,
        )
    encounter = lol_tid * 10
    _insert(
        conn,
        "encounter.encounter",
        id=encounter,
        workspace_id=ids["workspace"],
        discipline="lol",
        tournament_id=lol_tid,
        scoring_rule_id=ids["tournament_lol"],
        name="P6 LoL history duel",
        slot_count=2,
        status="COMPLETED",
        result_status="confirmed",
        result_source="admin",
        confirmed_at=STAMP,
        **_DATES,
    )
    for slot, side in ((1, "home"), (2, "away")):
        _insert(
            conn,
            "encounter.team",
            id=lol_tid * 10 + slot,
            encounter_id=encounter,
            tournament_id=lol_tid,
            team_id=teams[side],
            slot=slot,
            name=f"P6 LoL {side}",
            placement=slot,
            score=3 - slot,
            **_DATES,
        )
    # The Overwatch roster of the target tournament, mirrored onto LoL's home team under the same role codes.
    members = conn.execute(
        sa.text(
            "SELECT p.id, p.workspace_member_id AS member, r.code FROM tournament.player p "
            "JOIN tournament.player_role pr ON pr.player_id=p.id JOIN catalog.role r ON r.id=pr.role_id "
            "WHERE p.tournament_id=:t AND NOT p.is_substitution ORDER BY p.id"
        ),
        {"t": ids["tournament"]},
    ).all()
    declared = _algorithm(conn, PERFORMANCE_MODEL.algorithm_name)
    foreign = _algorithm(conn, "Someone else's performance model")
    mirrored = []
    for offset, row in enumerate(members):
        player = lol_tid * 100 + offset
        mirrored.append(player)
        _insert(
            conn,
            "tournament.player",
            id=player,
            name=f"P6 LoL {offset}",
            rank=1000 + offset,
            tournament_id=lol_tid,
            team_id=teams["home"],
            workspace_member_id=row.member,
            is_substitution=False,
            **_DATES,
        )
        _insert(conn, "tournament.player_role", player_id=player, dimension_id=dimension, role_id=lol_roles[row.code])
        _copy_performance(
            conn,
            source_player=row.id,
            tournament=lol_tid,
            player=player,
            algorithm=declared,
            source_algorithm=declared,
            shift=5.0,
        )
    # A foreign algorithm's second prediction for every Overwatch player of every Overwatch tournament.
    for player, tournament in conn.execute(
        sa.text(
            "SELECT player_id, tournament_id FROM analytics.performance WHERE algorithm_id=:a AND player_id<>ALL(:m)"
        ),
        {"a": declared, "m": mirrored},
    ).all():
        _copy_performance(
            conn,
            source_player=player,
            tournament=tournament,
            player=player,
            algorithm=foreign,
            source_algorithm=declared,
            shift=9.0,
        )
    standings = _algorithm(conn, STANDINGS_MODEL.algorithm_name)
    quality = _algorithm(conn, MATCH_QUALITY_MODEL.algorithm_name)
    return {
        "lol_tid": lol_tid,
        "lol_players": mirrored,
        "lol_team": teams["home"],
        "lol_encounter": encounter,
        "declared": declared,
        "foreign": foreign,
        "standings": standings,
        "quality": quality,
        "member_count": len(members),
    }


async def _read_histories(session: AsyncSession, ids: dict[str, int]) -> dict[str, typing.Any]:
    tid, ws = ids["tournament"], ids["workspace"]
    career = [ids[f"tournament_career_{i}"] for i in (1, 2, 3)]
    out: dict[str, typing.Any] = {}
    # ``history_through`` reaches past the LoL tournament: its rows must not become a label or a streak.
    out["rank"] = await exports.load_player_rank_history(
        session, [*career, tid], history_through_tournament_id=ids["tournament_lol"], workspace_id=ws
    )
    out["performance"] = await exports.load_performance_features(session, [*career, tid, ids["tournament"] - 1])
    out["profile"] = await exports.load_player_signal_profile(session, tid, workspace_id=ws)
    out["synergy"] = await exports.team_synergy_features(session, tid, workspace_id=ws)
    return out


def _canonical(frame: pd.DataFrame) -> list[dict]:
    if frame.empty:
        return []
    keys = [c for c in ("player_id", "tournament_id", "team_id", "user_id", "role") if c in frame.columns]
    return json.loads(frame.sort_values(keys).to_json(orient="records", default_handler=str))


def test_overwatch_history_readers_ignore_foreign_game_rows_and_foreign_algorithms(stats_parity_database) -> None:
    url, ids = stats_parity_database

    async def run() -> None:
        engine = create_async_engine(make_url(url).set(drivername="postgresql+asyncpg"))
        try:
            async with AsyncSession(engine, expire_on_commit=False) as session:
                from unittest.mock import patch

                with patch.object(config.settings, "analytics_feature_cache_enabled", False):
                    _sync(url, lambda conn: seed_native_sentinel(conn, ids))
                    before = await _read_histories(session, ids)
                    await session.rollback()
                    seeded = _sync(url, lambda conn: _seed_lol_history(conn, ids, sentinel=False))
                    after = await _read_histories(session, ids)
                    # The preconditions that make the comparison meaningful.
                    assert seeded["member_count"] >= 2, "synergy needs two Overwatch teammates"
                    assert not before["rank"].empty and not before["performance"].empty
                    assert not before["profile"].empty and not before["synergy"].empty
                    for name in ("rank", "performance", "profile", "synergy"):
                        assert _canonical(after[name]) == _canonical(before[name]), name
                    # ... and the foreign rows really exist: an unscoped read sees them.
                    unscoped = await session.scalar(
                        sa.text("SELECT count(*) FROM analytics.performance WHERE tournament_id=:t"),
                        {"t": seeded["lol_tid"]},
                    )
                    assert unscoped == seeded["member_count"]
                    foreign = await session.scalar(
                        sa.text("SELECT count(*) FROM analytics.performance WHERE algorithm_id=:a"),
                        {"a": seeded["foreign"]},
                    )
                    assert foreign > 0
        finally:
            await engine.dispose()

    asyncio.run(run())


def test_stored_prediction_reads_are_owner_and_declared_algorithm_gated(stats_parity_database) -> None:
    url, ids = stats_parity_database

    def seed(conn: sa.Connection) -> dict[str, typing.Any]:
        seeded = _seed_lol_history(conn, ids)
        lol_player = seeded["lol_players"][0]
        ow_player = conn.scalar(
            sa.text("SELECT player_id FROM analytics.performance WHERE tournament_id=:t AND algorithm_id=:a LIMIT 1"),
            {"t": ids["tournament"], "a": seeded["declared"]},
        )
        seeded["ow_player"] = ow_player
        # Explanations: the OW player's declared row has none, the foreign algorithm's does; LoL's row has one.
        conn.execute(
            sa.text(
                "UPDATE analytics.performance SET contributions=CAST(:c AS json), base_value=1.5 "
                "WHERE (player_id=:o AND algorithm_id=:f) OR player_id=:l"
            ),
            {"c": json.dumps([{"feature": "x", "shap": 1.0}]), "o": ow_player, "f": seeded["foreign"], "l": lol_player},
        )
        histogram = json.dumps({"1": 1.0})
        for tournament, team, algorithm in (
            (seeded["lol_tid"], seeded["lol_team"], seeded["standings"]),
            (ids["tournament"], ids["team_home"], seeded["standings"]),
            (ids["tournament"], ids["team_home"], seeded["foreign"]),
        ):
            conn.execute(
                sa.text(
                    "INSERT INTO analytics.standings_distribution(tournament_id,team_id,algorithm_id,mean_position,"
                    "median_position,p10_position,p90_position,position_histogram,created_at,updated_at) "
                    "VALUES (:t,:m,:a,1,1,1,1,CAST(:h AS json),:d,:d)"
                ),
                {"t": tournament, "m": team, "a": algorithm, "h": histogram, "d": STAMP},
            )
        for encounter, algorithm in (
            (seeded["lol_encounter"], seeded["quality"]),
            (ids["encounter"], seeded["quality"]),
            (ids["encounter"], seeded["foreign"]),
        ):
            conn.execute(
                sa.text(
                    "INSERT INTO analytics.match_quality(encounter_id,algorithm_id,competitiveness,predictability,"
                    "skill_balance,quality_score,created_at,updated_at) VALUES (:e,:a,1,1,1,1,:d,:d)"
                ),
                {"e": encounter, "a": algorithm, "d": STAMP},
            )
        for tournament, player in ((seeded["lol_tid"], lol_player), (ids["tournament"], ow_player)):
            conn.execute(
                sa.text(
                    "INSERT INTO analytics.player_anomaly(tournament_id,player_id,kind,score,confidence,reasons,"
                    "created_at,updated_at) VALUES (:t,:p,'smurf',1,1,CAST('[]' AS json),:d,:d)"
                ),
                {"t": tournament, "p": player, "d": STAMP},
            )
        return {**seeded, "lol_player": lol_player}

    seeded = _sync(url, seed)

    async def run() -> None:
        engine = create_async_engine(make_url(url).set(drivername="postgresql+asyncpg"))
        try:
            async with AsyncSession(engine, expire_on_commit=False) as session:
                lol_tid, tid = seeded["lol_tid"], ids["tournament"]
                # The unsupported discipline's preserved rows are never served, by any of the five readers.
                assert await flows_service.list_performance(session, lol_tid) == []
                assert await flows_service.list_performance(session, lol_tid, algorithm_id=seeded["declared"]) == []
                assert await flows_service.list_standings(session, lol_tid) == []
                assert await flows_service.list_match_quality(session, lol_tid) == []
                assert list(await flows_service.list_player_anomalies(session, lol_tid)) == []
                assert await flows_service.get_explanation(session, seeded["lol_player"], lol_tid) is None
                # An unknown tournament serves nothing either.
                assert await flows_service.list_performance(session, 10**9) == []

                # Overwatch: only the declared algorithm's rows, whatever else is stored for the tournament.
                performance = await flows_service.list_performance(session, tid)
                assert performance and {row.algorithm_id for row in performance} == {seeded["declared"]}
                assert await flows_service.list_performance(session, tid, algorithm_id=seeded["foreign"]) == []
                standings = await flows_service.list_standings(session, tid)
                assert [row.algorithm_id for row in standings] == [seeded["standings"]]
                assert await flows_service.list_standings(session, tid, algorithm_id=seeded["foreign"]) == []
                quality = await flows_service.list_match_quality(session, tid)
                assert [row.algorithm_id for row in quality] == [seeded["quality"]]
                assert await flows_service.list_match_quality(session, tid, algorithm_id=seeded["foreign"]) == []
                assert len(await flows_service.list_player_anomalies(session, tid)) == 1
                # Feedback follows the same gate: refused (and nothing written) for the unsupported discipline.
                feedback = {"kind": "smurf", "verdict": "confirmed", "note": None, "reviewer_user_id": None}
                with pytest.raises(errors.ApiHTTPException) as refused:
                    await flows_service.upsert_feedback(
                        session, tournament_id=lol_tid, player_id=seeded["lol_player"], **feedback
                    )
                assert refused.value.status_code == 404
                assert await flows_service.list_feedback(session, lol_tid) == []
                assert (
                    await session.scalar(sa.select(sa.func.count()).select_from(models.AnalyticsAnomalyFeedback)) == 0
                )
                written = await flows_service.upsert_feedback(
                    session, tournament_id=tid, player_id=seeded["ow_player"], **feedback
                )
                assert written.tournament_id == tid
                assert len(await flows_service.list_feedback(session, tid)) == 1
                await session.rollback()
                # The foreign algorithm alone carries a contribution for this player: it is not an explanation.
                assert await flows_service.get_explanation(session, seeded["ow_player"], tid) is None
                assert (
                    await flows_service.get_explanation(
                        session, seeded["ow_player"], tid, algorithm_id=seeded["foreign"]
                    )
                    is None
                )
        finally:
            await engine.dispose()

    asyncio.run(run())
