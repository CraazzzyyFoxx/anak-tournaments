import typing

import numpy as np
import pandas as pd
import sqlalchemy as sa
from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession

from src import models
from src.core.config import settings
from src.core.workspace import get_tournament_workspace_id
from src.domain.ratings import (
    LINEAR,
    OPEN_SKILL,
    OPENSKILL_LOOKBACK,
    POINTS,
    compute_linear_metrics,
    compute_points_shifts,
    division_delta_points,
    get_plackett_luce,
    prepare_openskill_data,
)

from .canonical_division import canonical_div_for, load_source_grids
from .service import analytics_service


class AnalyticsFlowsService:
    async def get_data_frame(
        self,
        session: AsyncSession,
        workspace_id: int | None = None,
        workspace_ids: typing.Sequence[int] | None = None,
    ) -> pd.DataFrame:
        data = await analytics_service.get_analytics(
            session,
            workspace_id=workspace_id,
            workspace_ids=workspace_ids,
        )
        tournament_version_ids = await analytics_service.get_tournament_version_ids(
            session,
            workspace_id=workspace_id,
            workspace_ids=workspace_ids,
        )

        rows: list[dict[str, typing.Any]] = []
        for row in data:
            tid = row["tournament_id"]
            rows.append(
                {
                    "tournament_id": tid,
                    "version_id": tournament_version_ids.get(tid),
                    "team_id": row["team_id"],
                    "player_name": row["player_name"],
                    "player_id": row["player_id"],
                    "user_id": row["user_id"],
                    "role": row["role"],
                    "id_role": f"{row['user_id']}-{row['role']}",
                    "cost": row["rank"],
                    "div": None,
                    "wins": row["wins"],
                    "losses": row["losses"],
                    "match_count": row["match_count"],
                    "overall_position": row["overall_position"],
                    "team_count": row["team_count"],
                    "performance_points": row["performance_points"],
                    "log_available": 1.0 if row["performance_points"] is not None else 0.0,
                    "log_residual": 0.0,
                    "map_diff": 0.0,
                    "placement_score": 0.0,
                    "previous_cost": row["previous_cost"],
                    "pre_previous_cost": row["pre_previous_cost"],
                    "is_newcomer": bool(row["is_newcomer"]),
                    "is_newcomer_role": bool(row["is_newcomer_role"]),
                    "is_changed": False,
                    "points_shift": 0.0,
                    "confidence": 0.0,
                    "effective_evidence": 0.0,
                    "sample_tournaments": 0,
                    "sample_matches": 0,
                    "log_coverage": 0.0,
                    "linear_stable_shift": 0.0,
                    "linear_trend_shift": 0.0,
                }
            )

        if not rows:
            return pd.DataFrame(rows)

        df = pd.DataFrame(rows)

        # Normalize every division to the canonical OW grid so current/previous div
        # are comparable across workspaces and grid versions.
        grids = await load_source_grids(session, df["version_id"].dropna().unique())

        df["div"] = [
            canonical_div_for(grids, version_id, cost)
            for version_id, cost in zip(df["version_id"], df["cost"], strict=False)
        ]
        df = df.sort_values(["id_role", "tournament_id"]).reset_index(drop=True)
        df["prev_version_id"] = df.groupby("id_role")["version_id"].shift(1)

        def resolve_previous_div(row) -> int | None:
            prev_cost = row["previous_cost"]
            if prev_cost is None or pd.isna(prev_cost):
                return None
            return canonical_div_for(grids, row["prev_version_id"], int(prev_cost))

        df["previous_div"] = df.apply(resolve_previous_div, axis=1)
        df["is_changed"] = df["previous_div"] != df["div"]
        df["normalized_shift_one"] = df.apply(
            lambda row: division_delta_points(row["previous_div"], row["div"]),
            axis=1,
        )
        df["normalized_shift_two"] = df.groupby("id_role")["normalized_shift_one"].shift(1)
        df["map_diff"] = df.apply(
            lambda row: (row["wins"] - row["losses"]) / max(row["wins"] + row["losses"], 1),
            axis=1,
        )
        df["placement_score"] = df.apply(
            lambda row: 0.0
            if row["overall_position"] is None or row["team_count"] is None
            else (1.0 - 2.0 * (row["overall_position"] - 1) / max((row["team_count"] - 1), 1)),
            axis=1,
        )

        # The shift signal is team-result only (map_diff + placement_score, computed
        # above). Individual performance is intentionally NOT folded into the Linear
        # signal — prod analysis showed it adds ~0 over team W/L.
        return df

    async def create_players_shifts_is_not_exists(
        self,
        session: AsyncSession,
        tournament_id: int,
        df: pd.DataFrame | None = None,
    ) -> None:
        source_df = df if df is not None else await self.get_data_frame(session)
        players = await analytics_service.get_players_by_tournament_id(session, tournament_id)
        players_by_id = {player.player_id: player for player in players}
        final_df = source_df[source_df["tournament_id"] == tournament_id]
        final_df = final_df.replace({np.nan: None})

        for _, row in final_df.iterrows():
            shift_one = int(row["normalized_shift_one"]) if row["normalized_shift_one"] is not None else None
            shift_two = int(row["normalized_shift_two"]) if row["normalized_shift_two"] is not None else None

            analytics_player = players_by_id.get(row["player_id"])
            if analytics_player is not None:
                analytics_player.wins = int(row["wins"])
                analytics_player.losses = int(row["losses"])
                analytics_player.shift_one = shift_one
                analytics_player.shift_two = shift_two
                session.add(analytics_player)
                continue

            session.add(
                models.AnalyticsPlayer(
                    tournament_id=row["tournament_id"],
                    player_id=row["player_id"],
                    wins=row["wins"],
                    losses=row["losses"],
                    shift_one=shift_one,
                    shift_two=shift_two,
                    shift=0,
                )
            )

        await session.commit()

    async def compute_openskill_shift_map(
        self,
        session: AsyncSession,
        tournament_id: int,
        df: pd.DataFrame,
        workspace_id: int | None = None,
        workspace_ids: typing.Sequence[int] | None = None,
    ) -> tuple[dict[int, float], bool]:
        start_tid = await analytics_service.lookback_start_tournament_id(
            session,
            tournament_id,
            OPENSKILL_LOOKBACK,
            workspace_id=workspace_id,
            workspace_ids=workspace_ids,
        )
        matches = await analytics_service.get_matches(
            session,
            start_tid,
            tournament_id,
            workspace_id=workspace_id,
            workspace_ids=workspace_ids,
        )
        teams = await analytics_service.get_teams_with_players(session, tournament_id)
        grids = await load_source_grids(session, df["version_id"].dropna().unique())
        pl = get_plackett_luce()
        _, players_rating, _ = prepare_openskill_data(df, pl, teams, matches)

        final_df = df[df["tournament_id"] == tournament_id].replace({np.nan: None})
        shift_map: dict[int, float] = {}
        for _, row in final_df.iterrows():
            rating = players_rating.get(row["id_role"])
            if rating is None:
                continue
            predicted_div = canonical_div_for(grids, row["version_id"], int(round(rating.mu)))
            shift_map[int(row["player_id"])] = round(float(row["div"] - predicted_div), 2)

        return shift_map, bool(matches)

    async def persist_algorithm(
        self,
        session: AsyncSession,
        tournament_id: int,
        algorithm_name: str,
        current_df: pd.DataFrame,
        shift_lookup: dict[int, float],
    ) -> None:
        algorithm = await analytics_service.get_algorithm(session, algorithm_name)

        await session.execute(
            sa.delete(models.AnalyticsShift).where(
                sa.and_(
                    models.AnalyticsShift.tournament_id == tournament_id,
                    models.AnalyticsShift.algorithm_id == algorithm.id,
                )
            )
        )
        await session.commit()

        for _, row in current_df.iterrows():
            player_id = int(row["player_id"])
            session.add(
                models.AnalyticsShift(
                    algorithm_id=algorithm.id,
                    tournament_id=tournament_id,
                    player_id=player_id,
                    shift=round(float(shift_lookup.get(player_id, 0.0)), 2),
                    confidence=round(float(row["confidence"]), 4),
                    effective_evidence=round(float(row["effective_evidence"]), 4),
                    sample_tournaments=int(row["sample_tournaments"]),
                    sample_matches=int(row["sample_matches"]),
                    log_coverage=round(float(row["log_coverage"]), 4),
                )
            )

        await session.commit()

    async def recalculate_analytics(
        self,
        session: AsyncSession,
        tournament_id: int,
        algorithm_names: typing.Iterable[str] | None = None,
        workspace_id: int | None = None,
    ) -> list[str]:
        # Scope to the tournament's own workspace when not given one, so the
        # Points/Linear recalc uses the same cohort the RPC job (workspace-scoped)
        # would — see get_tournament_workspace_id.
        if workspace_id is None:
            workspace_id = await get_tournament_workspace_id(session, tournament_id)
        df = await self.get_data_frame(session, workspace_id=workspace_id)
        if df.empty:
            logger.warning("No analytics data found for tournament {}", tournament_id)
            return []

        df["points_shift"] = compute_points_shifts(df)
        df = compute_linear_metrics(df, shift_scale=settings.linear_shift_scale)
        current_df = df[df["tournament_id"] == tournament_id].replace({np.nan: None}).copy()

        await self.create_players_shifts_is_not_exists(session, tournament_id, df)

        supported_recalc_algorithms = {POINTS, LINEAR}
        selected_algorithms = (
            [name for name in algorithm_names if name in supported_recalc_algorithms]
            if algorithm_names is not None
            else [POINTS, LINEAR]
        )
        selected_set = set(selected_algorithms)

        if POINTS in selected_set:
            await self.persist_algorithm(
                session,
                tournament_id,
                POINTS,
                current_df,
                {int(row["player_id"]): float(row["points_shift"]) for _, row in current_df.iterrows()},
            )

        if LINEAR in selected_set:
            await self.persist_algorithm(
                session,
                tournament_id,
                LINEAR,
                current_df,
                {int(row["player_id"]): float(row["linear_stable_shift"]) for _, row in current_df.iterrows()},
            )

        return selected_algorithms

    async def get_analytics(
        self,
        session: AsyncSession,
        tournament_id: int,
        workspace_id: int | None = None,
    ):
        await self.recalculate_analytics(
            session,
            tournament_id,
            [POINTS],
            workspace_id=workspace_id,
        )

    async def get_analytics_openskill(
        self,
        session: AsyncSession,
        tournament_id: int,
        workspace_id: int | None = None,
    ) -> None:
        await self.recalculate_analytics(
            session,
            tournament_id,
            [OPEN_SKILL],
            workspace_id=workspace_id,
        )


flows_service = AnalyticsFlowsService()
