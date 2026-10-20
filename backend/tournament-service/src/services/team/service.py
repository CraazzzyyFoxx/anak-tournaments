import typing

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from shared.repository import PlayerRepository, TeamRepository
from shared.services.tournament.visibility import visible_tournament_ids_subquery
from src import models, schemas
from src.core import enums
from src.core.query_page import execute_page_with_total


class TeamService:
    def __init__(
        self,
        *,
        team_repo: TeamRepository = TeamRepository(),
        player_repo: PlayerRepository = PlayerRepository(),
    ) -> None:
        self.team_repo = team_repo
        self.player_repo = player_repo

    async def get(self, session: AsyncSession, team_id: int, entities: list[str]) -> models.Team | None:
        """Return the team by id with ``entities`` loaded, or None."""
        return await self.team_repo.get(session, team_id, options=TeamRepository.team_entities(entities))

    async def get_by_name_and_tournament(
        self, session: AsyncSession, tournament_id: int, name: str, entities: list[str]
    ) -> models.Team | None:
        """Return the team by name within the tournament, or None.

        Case-insensitive, unlike ``TeamRepository.get_by_name_and_tournament``:
        Challonge and the registration flow round-trip differently-cased names.
        """
        query = (
            self.team_repo.select()
            .where(
                sa.and_(
                    sa.func.lower(models.Team.name) == name.lower(),
                    models.Team.tournament_id == tournament_id,
                )
            )
            .options(*TeamRepository.team_entities(entities))
        )
        result = await session.execute(query)
        return result.unique().scalars().first()

    async def get_by_tournament(
        self, session: AsyncSession, tournament: models.Tournament, entities: list[str]
    ) -> typing.Sequence[models.Team]:
        """Return every team of the tournament with ``entities`` loaded."""
        query = (
            self.team_repo.select()
            .filter_by(tournament_id=tournament.id)
            .options(*TeamRepository.team_entities(entities))
        )
        result = await session.execute(query)
        return result.unique().scalars().all()

    async def get_by_tournament_challonge_id(
        self, session: AsyncSession, tournament_id: int, challonge_id: int, entities: list[str]
    ) -> models.Team | None:
        """Return the team mapped to a Challonge participant id in the tournament, or None."""
        query = (
            self.team_repo.select()
            .options(*TeamRepository.team_entities(entities))
            .join(
                models.ChallongeParticipantMapping,
                models.ChallongeParticipantMapping.team_id == models.Team.id,
            )
            .join(
                models.ChallongeSource,
                models.ChallongeSource.id == models.ChallongeParticipantMapping.source_id,
            )
            .where(
                sa.and_(
                    models.ChallongeSource.tournament_id == tournament_id,
                    models.ChallongeParticipantMapping.challonge_participant_id == challonge_id,
                )
            )
        )
        result = await session.execute(query)
        return result.unique().scalars().first()

    async def get_all(
        self,
        session: AsyncSession,
        params: schemas.TeamFilterParams,
        workspace_id: int | None = None,
    ) -> tuple[typing.Sequence[models.Team], int]:
        """Return one page of teams and the total matching count."""
        query = self.team_repo.select().options(*TeamRepository.team_entities(params.entities))
        total_query = sa.select(sa.func.count(models.Team.id))
        if params.tournament_id:
            query = query.where(sa.and_(models.Team.tournament_id == params.tournament_id))
            total_query = total_query.where(sa.and_(models.Team.tournament_id == params.tournament_id))
        else:
            # Cross-tournament browse: exclude teams of hidden tournaments. A specific
            # tournament_id is authorized upstream by ensure_tournament_viewable.
            visible_ids = visible_tournament_ids_subquery(None)
            query = query.where(models.Team.tournament_id.in_(visible_ids))
            total_query = total_query.where(models.Team.tournament_id.in_(visible_ids))

        if workspace_id is not None:
            query = query.join(models.Tournament, models.Team.tournament_id == models.Tournament.id)
            total_query = total_query.join(models.Tournament, models.Team.tournament_id == models.Tournament.id)
            query = query.where(models.Tournament.workspace_id == workspace_id)
            total_query = total_query.where(models.Tournament.workspace_id == workspace_id)

        if params.search:
            name_match = models.Team.name.ilike(f"%{params.search}%")
            query = query.where(name_match)
            total_query = total_query.where(name_match)

        if params.sort == "group":
            query = (
                query.join(models.Team.standings)
                .join(models.Standing.stage_item)
                .where(models.StageItem.type == enums.StageItemType.GROUP)
                .order_by(params.apply_sort_field(models.StageItem.name))
            )
        elif params.sort == "placement":
            query = query.join(models.Team.standings).order_by(
                params.apply_sort_field(models.Standing.overall_position)
            )
        else:
            query = params.apply_pagination_sort(query, models.Team)
            return await execute_page_with_total(
                session,
                query,
                total_query,
                pk=models.Team.id,
                page=params.page,
                only_count=params.only_count,
            )
        result = await session.execute(query)
        total_result = await session.execute(total_query)
        return result.unique().scalars().all(), total_result.scalar_one()

    async def get_player(self, session: AsyncSession, player_id: int, entities: list[str]) -> models.Player | None:
        """Return the player by id with ``entities`` loaded, or None."""
        return await self.player_repo.get(session, player_id, options=PlayerRepository.player_entities(entities))

    async def get_player_by_user_and_tournament(
        self, session: AsyncSession, user_id: int, tournament_id: int, entities: list[str]
    ) -> models.Player | None:
        """Return the user's player in the tournament, or None."""
        return await self.player_repo.get_by_user_and_tournament(
            session,
            user_id=user_id,
            tournament_id=tournament_id,
            options=PlayerRepository.player_entities(entities),
        )

    async def get_player_all(
        self, session: AsyncSession, params: schemas.PlayerFilterParams
    ) -> tuple[typing.Sequence[models.Player], int]:
        """Return one page of players and the total matching count."""
        query = self.player_repo.select().options(*PlayerRepository.player_entities(params.entities))
        total_query = sa.select(sa.func.count(models.Player.id))
        if params.tournament_id:
            query = query.where(sa.and_(models.Player.tournament_id == params.tournament_id))
            total_query = total_query.where(sa.and_(models.Player.tournament_id == params.tournament_id))

        query = params.apply_pagination_sort(query, models.Player)
        result = await session.execute(query)
        total_result = await session.execute(total_query)
        return result.unique().scalars().all(), total_result.scalar_one()

    async def get_player_count_by_tournament(self, session: AsyncSession, tournament_id: int) -> int:
        """Return the number of players in one tournament."""
        return await self.player_repo.count(session, filters=[models.Player.tournament_id == tournament_id])

    async def get_player_count_by_tournament_bulk(
        self, session: AsyncSession, tournaments_ids: list[int]
    ) -> dict[int, int]:
        if not tournaments_ids:
            return {}
        query = (
            sa.select(models.Player.tournament_id, sa.func.count(models.Player.id))
            .where(models.Player.tournament_id.in_(tournaments_ids))
            .group_by(models.Player.tournament_id)
        )
        result = await session.execute(query)
        return {row[0]: row[1] for row in result.all()}

    async def get_team_count_by_tournament(self, session: AsyncSession, tournament_id: int) -> int:
        """Return the number of teams assigned to one tournament."""
        return await self.team_repo.count(session, filters=[models.Team.tournament_id == tournament_id])

    async def get_team_count_by_tournament_bulk(
        self, session: AsyncSession, tournaments_ids: list[int]
    ) -> dict[int, int]:
        """Return team counts keyed by tournament id; tournaments without teams are absent."""
        if not tournaments_ids:
            return {}
        query = (
            sa.select(models.Team.tournament_id, sa.func.count(models.Team.id))
            .where(models.Team.tournament_id.in_(tournaments_ids))
            .group_by(models.Team.tournament_id)
        )
        result = await session.execute(query)
        return {row[0]: row[1] for row in result.all()}


team_service = TeamService()
