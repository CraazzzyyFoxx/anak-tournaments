"""High-level read flows for the analytics HTTP surface.

These functions used to live in ``app-service/src/services/analytics/flows.py``
and depended on ``team_flows``/``user_flows`` for response serialisation.
Moved here as part of the analytics-service extraction; serialisation is now
done inline using lightweight Pydantic readers from
:mod:`src.schemas.base` so we don't pull the heavyweight app-service stack.
"""

from __future__ import annotations

import math
import typing

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from shared.core import enums, errors, pagination
from shared.division_grid import DivisionGrid
from shared.repository import (
    AnalyticsAnomalyFeedbackRepository,
    AnalyticsMatchQualityRepository,
    AnalyticsPerformanceRepository,
    AnalyticsPlayerAnomalyRepository,
    AnalyticsStandingsDistributionRepository,
    MLModelArtifactRepository,
    PlayerRepository,
)
from shared.services.division_grid.resolution import resolve_tournament_division
from src import models, schemas
from src.core.workspace import get_division_grid
from src.domain.forecast import predict_player_division

from .read_queries import analytics_read_service

__all__ = (
    "AnalyticsReadFlowsService",
    "flows_service",
)


# ---------------------------------------------------------------------------
# Inline serialisation helpers (replacement for ex-app-service team_flows/user_flows)
# ---------------------------------------------------------------------------


def _user_to_pydantic(user: models.User | None) -> schemas.UserReadMin | None:
    if user is None:
        return None
    # Only read plain columns — relationships (battle_tag/discord/twitch) are
    # not eagerly loaded by the analytics queries and would crash with
    # ``MissingGreenlet`` once the async session is detached.
    return schemas.UserReadMin(
        id=user.id,
        created_at=user.created_at,
        updated_at=user.updated_at,
        name=getattr(user, "name", None),
        avatar_url=getattr(user, "avatar_url", None),
    )


def _tournament_to_pydantic(t: models.Tournament | None) -> schemas.TournamentMin | None:
    if t is None:
        return None
    return schemas.TournamentMin(
        id=t.id,
        created_at=t.created_at,
        updated_at=t.updated_at,
        name=getattr(t, "name", None),
        is_finished=getattr(t, "is_finished", None),
        division_grid_version_id=getattr(t, "division_grid_version_id", None),
    )


def _group_to_pydantic(item) -> schemas.TeamGroupMin | None:
    if item is None:
        return None
    return schemas.TeamGroupMin(id=item.id, name=item.name)


def _resolve_placement(team: models.Team) -> int | None:
    positions = [
        standing.overall_position
        for standing in getattr(team, "standings", []) or []
        if getattr(standing, "overall_position", None) is not None and standing.overall_position > 0
    ]
    return min(positions) if positions else None


def _team_to_pydantic(team: models.Team, *, include_tournament: bool = True) -> schemas.TeamRead:
    return schemas.TeamRead(
        id=team.id,
        created_at=team.created_at,
        updated_at=team.updated_at,
        name=team.name,
        image_url=team.image_url,
        avg_sr=team.avg_sr,
        total_sr=team.total_sr,
        captain_id=team.captain_id,
        tournament_id=team.tournament_id,
        tournament=_tournament_to_pydantic(team.tournament) if include_tournament else None,
        placement=_resolve_placement(team),
        group=next(
            (
                _group_to_pydantic(standing.stage_item)
                for standing in getattr(team, "standings", []) or []
                if getattr(standing, "stage_item", None) is not None
                and getattr(standing.stage_item, "type", None) == enums.StageItemType.GROUP
            ),
            None,
        ),
    )


def _player_to_pydantic(player: models.Player, *, grid: DivisionGrid) -> schemas.PlayerRead:
    # NOTE: ``user`` is intentionally left as ``None`` for the analytics
    # response. The original ``app-service`` ``to_pydantic_player`` was called
    # with an empty ``entities`` list, which also produced ``user=None``. The
    # frontend analytics surface reads ``player.name`` directly, so the nested
    # ``user`` object is unused here — and accessing ``player.user`` (or any
    # of its ``battle_tag``/``discord``/``twitch`` relationships) would trip
    # ``MissingGreenlet`` once the async session is detached.
    return schemas.PlayerRead(
        id=player.id,
        created_at=player.created_at,
        updated_at=player.updated_at,
        name=getattr(player, "name", None),
        sub_role=getattr(player, "sub_role", None),
        rank=player.rank,
        division=resolve_tournament_division(player.rank, tournament_grid=grid),
        role=player.role,
        tournament_id=player.tournament_id,
        # Player.user_id was dropped in the contract step (iwrefac07); the
        # identity anchor is workspace_member.player_id instead. Callers must
        # eager-load Player.workspace_member on the query that produced ``player``.
        user_id=player.workspace_member.player_id,
        team_id=player.team_id,
        is_newcomer=getattr(player, "is_newcomer", False),
        is_newcomer_role=getattr(player, "is_newcomer_role", False),
        is_substitution=getattr(player, "is_substitution", False),
        related_player_id=getattr(player, "related_player_id", None),
        user=None,
    )


def _anomaly_to_pydantic(
    payload: dict[str, typing.Any],
    *,
    encounter_id: int,
) -> schemas.AnalyticsAnomaly | None:
    player_id = payload.get("player_id")
    if player_id is None:
        return None

    raw_reasons = payload.get("reasons")
    reasons = [str(reason) for reason in raw_reasons] if isinstance(raw_reasons, list) else []
    raw_encounter_id = payload.get("encounter_id", encounter_id)

    try:
        return schemas.AnalyticsAnomaly(
            player_id=int(player_id),
            kind=str(payload.get("kind") or "unknown"),
            score=float(payload.get("score") or 0),
            confidence=(float(payload["confidence"]) if payload.get("confidence") is not None else None),
            reasons=reasons,
            encounter_id=int(raw_encounter_id) if raw_encounter_id is not None else None,
        )
    except (TypeError, ValueError):
        return None


def _build_anomalies_by_player(
    rows: typing.Sequence[tuple[int, list[dict[str, typing.Any]] | None]],
) -> dict[int, list[schemas.AnalyticsAnomaly]]:
    """Flatten legacy encounter-grouped anomaly payloads into a per-player map."""
    anomalies: dict[int, list[schemas.AnalyticsAnomaly]] = {}
    seen: set[tuple[int, str]] = set()
    for encounter_id, flags in rows:
        for flag in flags or []:
            anomaly = _anomaly_to_pydantic(flag, encounter_id=encounter_id)
            if anomaly is None:
                continue
            key = (anomaly.player_id, anomaly.kind)
            if key in seen:
                continue
            seen.add(key)
            anomalies.setdefault(anomaly.player_id, []).append(anomaly)
    return anomalies


def _predict_player_division(
    player: schemas.PlayerRead,
    *,
    points: float,
) -> tuple[int | None, schemas.PredictedDirection, int]:
    predicted, direction, delta = predict_player_division(player.division, points)
    return predicted, direction, delta


def _average(values: typing.Iterable[float]) -> float:
    values_list = list(values)
    if not values_list:
        return 0.0
    return round(sum(values_list) / len(values_list), 4)


class AnalyticsReadFlowsService:
    def __init__(
        self,
        *,
        players: PlayerRepository = PlayerRepository(),
        performance: AnalyticsPerformanceRepository = AnalyticsPerformanceRepository(),
        standings: AnalyticsStandingsDistributionRepository = AnalyticsStandingsDistributionRepository(),
        match_quality: AnalyticsMatchQualityRepository = AnalyticsMatchQualityRepository(),
        player_anomalies: AnalyticsPlayerAnomalyRepository = AnalyticsPlayerAnomalyRepository(),
        feedback: AnalyticsAnomalyFeedbackRepository = AnalyticsAnomalyFeedbackRepository(),
        artifacts: MLModelArtifactRepository = MLModelArtifactRepository(),
    ) -> None:
        self.players = players
        self.performance = performance
        self.standings = standings
        self.match_quality = match_quality
        self.player_anomalies = player_anomalies
        self.feedback = feedback
        self.artifacts = artifacts

    async def to_pydantic(
        self,
        session: AsyncSession,
        algorithm: models.AnalyticsAlgorithm,
        *,
        has_data: bool | None = None,
    ) -> schemas.AnalyticsAlgorithmRead:
        return schemas.AnalyticsAlgorithmRead(
            id=algorithm.id,
            created_at=algorithm.created_at,
            updated_at=algorithm.updated_at,
            name=algorithm.name,
            has_data=has_data,
        )

    async def get_algorithms(
        self,
        session: AsyncSession,
        params: pagination.PaginationParams,
        *,
        tournament_id: int | None = None,
    ) -> pagination.Paginated[schemas.AnalyticsAlgorithmRead]:
        algorithms = await analytics_read_service.get_algorithms(session)
        ids_with_data: set[int] | None = None
        if tournament_id is not None:
            ids_with_data = await analytics_read_service.get_algorithm_ids_with_shift_data(session, tournament_id)
        return pagination.Paginated(
            total=len(algorithms),
            results=[
                await self.to_pydantic(
                    session,
                    algorithm,
                    has_data=(algorithm.id in ids_with_data) if ids_with_data is not None else None,
                )
                for algorithm in algorithms
            ],
            page=params.page,
            per_page=params.per_page,
        )

    async def get_algorithm(self, session: AsyncSession, id: int) -> schemas.AnalyticsAlgorithmRead:
        algorithm = await analytics_read_service.get_algorithm(session, id)
        if not algorithm:
            raise errors.ApiHTTPException(
                status_code=404,
                detail=[errors.ApiExc(code="not_found", msg="Analytics algorithm not found.")],
            )
        return await self.to_pydantic(session, algorithm)

    async def get_analytics(
        self,
        session: AsyncSession,
        tournament_id: int,
        algorithm_id: int,
        workspace_id: int | None = None,
    ) -> schemas.TournamentAnalytics:
        algorithm = await analytics_read_service.get_algorithm(session, algorithm_id)
        if algorithm is None:
            raise errors.ApiHTTPException(
                status_code=404,
                detail=[errors.ApiExc(code="not_found", msg="Analytics algorithm not found.")],
            )

        output: list[schemas.TeamAnalytics] = []
        cache_teams: dict[int, models.Team] = {}
        cache_players: dict[int, list[tuple[models.Player, models.AnalyticsPlayer, models.AnalyticsShift]]] = {}
        cache_teams_wins: dict[int, int] = {}
        cache_teams_losses: dict[int, int] = {}
        cache_teams_manual_shift: dict[int, int] = {}

        data = await analytics_read_service.get_analytics(session, tournament_id, algorithm, workspace_id=workspace_id)
        for team, player, shift, analytics in data:
            cache_teams[team.id] = team
            cache_players.setdefault(team.id, [])
            cache_teams_manual_shift.setdefault(team.id, 0)
            cache_teams_manual_shift[team.id] += analytics.shift_one if analytics.shift_one else 0
            cache_players[team.id].append((player, analytics, shift))
            if team.id not in cache_teams_wins:
                cache_teams_wins[team.id] = analytics.wins
            if team.id not in cache_teams_losses:
                cache_teams_losses[team.id] = analytics.losses

        avg_team_cost = round(sum(t.avg_sr for t in cache_teams.values()) / max(len(cache_teams), 1))

        grid = await get_division_grid(session, workspace_id, tournament_id=tournament_id)
        predicted_places = await analytics_read_service.get_predicted_places(session, tournament_id, algorithm.id)
        anomalies_by_player = _build_anomalies_by_player(
            await analytics_read_service.get_match_quality_anomalies(session, tournament_id, algorithm.id)
        )

        for team_id, team in cache_teams.items():
            players = cache_players[team_id]
            team_read = _team_to_pydantic(team)
            balancer_shift = -math.ceil(((team.avg_sr - (team.avg_sr % 10)) - avg_team_cost) / 20)
            manual_shift_points = cache_teams_manual_shift[team_id]
            manual_shift = round(manual_shift_points / 1000, 2)
            team_players: list[schemas.PlayerAnalytics] = []

            for player, analytics, shift in players:
                player_read = _player_to_pydantic(player, grid=grid)
                predicted_division, predicted_direction, predicted_delta = _predict_player_division(
                    player_read,
                    points=shift.shift,
                )
                team_players.append(
                    schemas.PlayerAnalytics(
                        **player_read.model_dump(),
                        move_1=analytics.shift_one,
                        move_2=analytics.shift_two,
                        points=shift.shift,
                        shift=analytics.shift,
                        confidence=shift.confidence,
                        effective_evidence=shift.effective_evidence,
                        sample_tournaments=shift.sample_tournaments,
                        sample_matches=shift.sample_matches,
                        log_coverage=shift.log_coverage,
                        predicted_division=predicted_division,
                        predicted_direction=predicted_direction,
                        predicted_delta=predicted_delta,
                        anomalies=anomalies_by_player.get(player.id, []),
                    )
                )

            team_anomalies = [anomaly for player in team_players for anomaly in player.anomalies]
            predicted_place = predicted_places.get(team_id)
            placement_delta = (
                predicted_place - team_read.placement
                if predicted_place is not None and team_read.placement is not None
                else None
            )

            output.append(
                schemas.TeamAnalytics(
                    **team_read.model_dump(exclude={"players"}),
                    wins=cache_teams_wins.get(team_id, 0),
                    losses=cache_teams_losses.get(team_id, 0),
                    predicted_place=predicted_place,
                    placement_delta=placement_delta,
                    avg_confidence=_average(player.confidence for player in team_players),
                    manual_shift_points=manual_shift_points,
                    anomalies=team_anomalies,
                    balancer_shift=balancer_shift,
                    manual_shift=manual_shift,
                    total_shift=balancer_shift + manual_shift,
                    players=team_players,
                )
            )

        placement_deltas = [abs(team.placement_delta) for team in output if team.placement_delta is not None]
        summary = schemas.TournamentAnalyticsSummary(
            total_teams=len(output),
            total_players=sum(len(team.players) for team in output),
            avg_confidence=_average(team.avg_confidence for team in output),
            anomaly_count=sum(len(team.anomalies) for team in output),
            manual_shift_team_count=sum(1 for team in output if team.manual_shift_points != 0),
            newcomer_count=sum(
                1 for team in output for player in team.players if player.is_newcomer or player.is_newcomer_role
            ),
            divergent_team_count=sum(
                1 for team in output if team.placement_delta is not None and abs(team.placement_delta) >= 4
            ),
            avg_placement_delta=_average(float(delta) for delta in placement_deltas),
        )

        return schemas.TournamentAnalytics(
            teams=sorted(output, key=lambda x: ((x.placement or 9999), x.name)),
            teams_wins=cache_teams_wins,
            summary=summary,
        )

    async def change_shift(self, session: AsyncSession, player_id: int, shift: int) -> schemas.PlayerAnalytics:
        analytics, calculated_shift = await analytics_read_service.change_shift(session, player_id, shift)
        player = await self.players.get(
            session,
            player_id,
            options=[joinedload(models.Player.workspace_member)],
        )
        if player is None:
            raise errors.ApiHTTPException(
                status_code=404,
                detail=[errors.ApiExc(code="not_found", msg="Player not found.")],
            )
        grid = await get_division_grid(session, None, tournament_id=player.tournament_id)
        base = _player_to_pydantic(player, grid=grid)
        return schemas.PlayerAnalytics(
            **base.model_dump(),
            move_1=analytics.shift_one,
            move_2=analytics.shift_two,
            points=calculated_shift.shift,
            shift=analytics.shift,
            confidence=calculated_shift.confidence,
            effective_evidence=calculated_shift.effective_evidence,
            sample_tournaments=calculated_shift.sample_tournaments,
            sample_matches=calculated_shift.sample_matches,
            log_coverage=calculated_shift.log_coverage,
        )

    async def get_streaks(self, session: AsyncSession, tournament_id: int) -> list[schemas.PlayerStreak]:
        cache_pos: dict[str, list[int]] = {}
        cache_users: dict[str, schemas.UserReadMin | None] = {}
        output: list[schemas.PlayerStreak] = []
        streaks = await analytics_read_service.get_streaks(session, tournament_id)

        for user, role, place in streaks:
            key = f"{user.id}-{role}"
            cache_users.setdefault(key, _user_to_pydantic(user))
            cache_pos.setdefault(key, [])
            if len(cache_pos[key]) < 3:
                cache_pos[key].append(place)

        for key, positions in cache_pos.items():
            if len(positions) < 2:
                continue
            user = cache_users[key]
            if user is None:
                continue
            _, role = key.split("-", 1)
            current_position = positions[0]
            previous_position = positions[1] if len(positions) > 1 else None
            pre_previous_position = positions[2] if len(positions) > 2 else None
            sum_position = sum(p for p in positions if p is not None)

            output.append(
                schemas.PlayerStreak(
                    user=user,
                    role=role,
                    sum_position=sum_position,
                    current_position=current_position,
                    previous_position=previous_position,
                    pre_previous_position=pre_previous_position,
                )
            )

        return sorted(output, key=lambda x: (x.sum_position, x.user.name or ""))


    async def list_performance(
        self,
        session: AsyncSession,
        tournament_id: int,
        *,
        algorithm_id: int | None = None,
    ) -> typing.Sequence[models.AnalyticsPerformance]:
        return await self.performance.list_by_tournament(session, tournament_id, algorithm_id=algorithm_id)

    async def list_standings(
        self,
        session: AsyncSession,
        tournament_id: int,
        *,
        algorithm_id: int | None = None,
    ) -> typing.Sequence[models.AnalyticsStandingsDistribution]:
        return await self.standings.list_by_tournament(session, tournament_id, algorithm_id=algorithm_id)

    async def list_match_quality(
        self,
        session: AsyncSession,
        tournament_id: int,
        *,
        algorithm_id: int | None = None,
    ) -> list[schemas.MatchQualityRow]:
        rows = await self.match_quality.list_by_tournament(session, tournament_id, algorithm_id=algorithm_id)
        grouped = dict(
            await analytics_read_service.get_match_quality_anomalies(session, tournament_id, algorithm_id or 0)
        )
        return [
            schemas.MatchQualityRow(
                encounter_id=row.encounter_id,
                algorithm_id=row.algorithm_id,
                competitiveness=row.competitiveness,
                predictability=row.predictability,
                skill_balance=row.skill_balance,
                quality_score=row.quality_score,
                anomaly_flags=grouped.get(row.encounter_id),
            )
            for row in rows
        ]

    async def list_player_anomalies(
        self,
        session: AsyncSession,
        tournament_id: int,
        *,
        player_id: int | None = None,
        kind: str | None = None,
    ) -> typing.Sequence[models.AnalyticsPlayerAnomaly]:
        return await self.player_anomalies.list_by_tournament(
            session, tournament_id, player_id=player_id, kind=kind
        )

    async def list_feedback(
        self,
        session: AsyncSession,
        tournament_id: int,
    ) -> typing.Sequence[models.AnalyticsAnomalyFeedback]:
        return await self.feedback.list_by_tournament(session, tournament_id)

    async def upsert_feedback(
        self,
        session: AsyncSession,
        *,
        tournament_id: int,
        player_id: int,
        kind: str,
        verdict: str,
        note: str | None,
        reviewer_user_id: int | None,
    ) -> models.AnalyticsAnomalyFeedback:
        existing = await self.feedback.get_by_key(
            session,
            tournament_id=tournament_id,
            player_id=player_id,
            kind=kind,
        )
        if existing is not None:
            await self.feedback.update_fields(
                session,
                existing,
                {
                    "verdict": verdict,
                    "note": note,
                    "reviewer_user_id": reviewer_user_id,
                },
            )
            return existing
        row = models.AnalyticsAnomalyFeedback(
            tournament_id=tournament_id,
            player_id=player_id,
            kind=kind,
            verdict=verdict,
            reviewer_user_id=reviewer_user_id,
            note=note,
        )
        await self.feedback.create(session, row)
        return row


    async def get_explanation(
        self,
        session: AsyncSession,
        player_id: int,
        tournament_id: int,
        *,
        algorithm_id: int | None = None,
    ) -> schemas.ExplanationRow | None:
        row = await self.performance.get_for_player(
            session,
            player_id=player_id,
            tournament_id=tournament_id,
            algorithm_id=algorithm_id,
        )
        if row is None or not row.contributions:
            return None
        return schemas.ExplanationRow(
            algorithm_id=row.algorithm_id,
            entity_id=row.player_id,
            entity_kind="player",
            tournament_id=row.tournament_id,
            base_value=row.base_value or 0.0,
            contributions=row.contributions,
        )

    async def list_artifacts(
        self,
        session: AsyncSession,
        *,
        model_kind: str | None = None,
        active_only: bool = False,
    ) -> typing.Sequence[models.MLModelArtifact]:
        return await self.artifacts.list_filtered(session, model_kind=model_kind, active_only=active_only)


flows_service = AnalyticsReadFlowsService()
