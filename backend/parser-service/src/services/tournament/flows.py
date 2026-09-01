import typing

from sqlalchemy.ext.asyncio import AsyncSession

from shared.services.challonge_refs import (
    ChallongeRef,
    resolve_stage_challonge,
    resolve_tournament_challonge,
)
from src import models, schemas
from src.core import errors
from src.domain.stage_challonge import _apply_stage_challonge

from . import service


class TournamentFlowsService:

    async def to_pydantic(
        self,
        session: AsyncSession,
        tournament: models.Tournament,
        entities: list[str],
        *,
        challonge_ref: ChallongeRef | None = None,
        stage_challonge_refs: typing.Mapping[int, ChallongeRef] | None = None,
    ) -> schemas.TournamentRead:
        """Serialize a tournament.

        ``challonge_ref``/``stage_challonge_refs`` carry the KEPT ``challonge_id``/
        ``challonge_slug`` response fields DERIVED from ``challonge_source`` (see
        ``shared.services.challonge_refs``) so the serializer never reads the
        deprecated ``tournament``/``stage`` columns. When omitted the fields
        serialize as ``None`` (callers that need them resolve/pass them).
        """
        stages: list[schemas.StageRead] = []
        if "stages" in entities:
            stages = [
                _apply_stage_challonge(
                    schemas.StageRead.model_validate(stage, from_attributes=True),
                    stage.id,
                    stage_challonge_refs,
                )
                for stage in sorted(tournament.stages, key=lambda item: item.order)
            ]
        tournament_challonge_id, tournament_challonge_slug = (
            challonge_ref if challonge_ref is not None else (None, None)
        )
        return schemas.TournamentRead(
            id=tournament.id,
            workspace_id=tournament.workspace_id,
            start_date=tournament.start_date,
            end_date=tournament.end_date,
            is_league=tournament.is_league,
            is_finished=tournament.is_finished,
            status=tournament.status,
            name=tournament.name,
            description=tournament.description,
            challonge_id=tournament_challonge_id,
            challonge_slug=tournament_challonge_slug,
            auto_transitions_enabled=tournament.auto_transitions_enabled,
            allow_late_registration=tournament.allow_late_registration,
            phase_schedule=[
                schemas.TournamentPhaseScheduleRead.model_validate(entry, from_attributes=True)
                for entry in tournament.phase_schedule
            ],
            win_points=tournament.win_points,
            draw_points=tournament.draw_points,
            loss_points=tournament.loss_points,
            division_grid_version_id=tournament.division_grid_version_id,
            division_grid_version=(
                schemas.DivisionGridVersionRead.model_validate(tournament.division_grid_version, from_attributes=True)
                if tournament.division_grid_version is not None
                else None
            ),
            stages=stages,
        )

    async def get(self, session: AsyncSession, id: int, entities: list[str]) -> models.Tournament:
        tournament = await service.get(session, id, entities)
        if tournament is None:
            raise errors.ApiHTTPException(
                status_code=404,
                detail=[
                    errors.ApiExc(
                        code="tournament_not_found",
                        msg="Tournament with this id not found",
                    )
                ],
            )
        return tournament

    async def get_read(self, session: AsyncSession, id: int, entities: list[str]) -> schemas.TournamentRead:
        tournament = await get(session, id, entities)
        # Batched Challonge-ref derivation (no N+1): one query for the tournament and
        # one for its loaded stages when requested, from challonge_source.
        challonge_ref = (await resolve_tournament_challonge(session, [tournament.id])).get(tournament.id)
        stage_challonge_refs: typing.Mapping[int, ChallongeRef] | None = None
        if "stages" in entities:
            stage_challonge_refs = await resolve_stage_challonge(session, [stage.id for stage in tournament.stages])
        return await to_pydantic(
            session,
            tournament,
            entities,
            challonge_ref=challonge_ref,
            stage_challonge_refs=stage_challonge_refs,
        )



tournament_flows_service = TournamentFlowsService()
to_pydantic = tournament_flows_service.to_pydantic
get = tournament_flows_service.get
get_read = tournament_flows_service.get_read
