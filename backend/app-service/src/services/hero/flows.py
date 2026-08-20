from sqlalchemy.ext.asyncio import AsyncSession

from shared.division_grid import DivisionGrid
from shared.repository import HeroRepository
from src import models, schemas
from src.core import errors, pagination

from .service import HeroQueries
from .service import queries as hero_queries

__all__ = ("HeroService", "heroes")


class HeroService:
    def __init__(
        self,
        *,
        queries: HeroQueries = hero_queries,
        repo: HeroRepository = HeroRepository(),
    ) -> None:
        self.queries = queries
        self.repo = repo

    @staticmethod
    def to_read(hero: models.Hero) -> schemas.HeroRead:
        """Serialize a Hero into ``HeroRead``.

        A hero has no expandable relation in this payload, so there is nothing to
        load and nothing to await — callers map whole result sets through this.
        """
        return schemas.HeroRead.model_validate(hero, from_attributes=True)

    async def get_hero_leaderboard(
        self,
        session: AsyncSession,
        hero_id: int,
        params: schemas.HeroLeaderboardParams,
        workspace_id: int | None = None,
        *,
        grid: DivisionGrid,
    ) -> pagination.Paginated[schemas.HeroLeaderboardEntry]:
        rows, total = await self.queries.get_hero_leaderboard(
            session,
            hero_id=hero_id,
            tournament_id=params.tournament_id,
            stat=params.stat,
            params=pagination.PaginationParams(page=params.page, per_page=params.per_page),
            workspace_id=workspace_id,
            grid=grid,
        )
        return pagination.Paginated(
            page=params.page,
            per_page=params.per_page,
            total=total,
            results=[
                schemas.HeroLeaderboardEntry(
                    rank=row.rank,
                    user_id=row.user_id,
                    username=row.username,
                    player_name=row.player_name,
                    role=row.role,
                    div=row.div,
                    team=row.team,
                    team_id=row.team_id,
                    games_played=int(row.games_played),
                    playtime_seconds=float(row.playtime_seconds),
                    per10_eliminations=float(row.per10_eliminations),
                    per10_healing=float(row.per10_healing),
                    per10_deaths=float(row.per10_deaths),
                    per10_damage=float(row.per10_damage),
                    per10_final_blows=float(row.per10_final_blows),
                    per10_damage_blocked=float(row.per10_damage_blocked),
                    per10_solo_kills=float(row.per10_solo_kills),
                    per10_obj_kills=float(row.per10_obj_kills),
                    per10_defensive_assists=float(row.per10_defensive_assists),
                    per10_offensive_assists=float(row.per10_offensive_assists),
                    per10_all_damage=float(row.per10_all_damage),
                    per10_damage_taken=float(row.per10_damage_taken),
                    per10_self_healing=float(row.per10_self_healing),
                    per10_ultimates_used=float(row.per10_ultimates_used),
                    per10_multikills=float(row.per10_multikills),
                    per10_env_kills=float(row.per10_env_kills),
                    per10_crit_hits=float(row.per10_crit_hits),
                    avg_weapon_accuracy=float(row.avg_weapon_accuracy),
                    avg_crit_accuracy=float(row.avg_crit_accuracy),
                    kd=float(row.kd),
                    kda=float(row.kda),
                )
                for row in rows
            ],
        )

    async def get(self, session: AsyncSession, id: int) -> schemas.HeroRead:
        """Retrieve a hero by ID and convert to its Pydantic schema."""
        hero = await self.repo.get(session, id)
        if hero is None:
            raise errors.ApiHTTPException(
                status_code=404,
                detail=[errors.ApiExc(code="not_found", msg=f"Hero {id} not found")],
            )
        return self.to_read(hero)

    async def get_by_name(self, session: AsyncSession, name: str) -> models.Hero:
        """Retrieve a hero by name (404 if missing)."""
        hero = await self.repo.get_by_name(session, name)
        if not hero:
            raise errors.ApiHTTPException(
                status_code=404,
                detail=[
                    errors.ApiExc(code="not_found", msg=f"Hero with name {name} not found"),
                ],
            )
        return hero

    async def get_all(
        self, session: AsyncSession, params: pagination.PaginationSortSearchParams
    ) -> pagination.Paginated[schemas.HeroRead]:
        """Paginated heroes — delegates to `HeroRepository.all`."""
        heroes, total = await self.repo.all(session, params)
        return pagination.Paginated(
            page=params.page,
            per_page=params.per_page,
            total=total,
            results=[self.to_read(hero) for hero in heroes],
        )

    async def get_playtime(
        self,
        session: AsyncSession,
        params: schemas.HeroPlaytimePaginationParams,
        workspace_id: int | None = None,
    ) -> pagination.Paginated[schemas.HeroPlaytime]:
        """Hero playtime share — delegates to `HeroRepository.playtime`."""
        user_id: int | None = None if params.user_id == "all" else params.user_id
        heroes = await self.repo.playtime(
            session,
            user_id=user_id,
            tournament_id=params.tournament_id,
            workspace_id=workspace_id,
        )
        # Default sort: descending by playtime (was params.apply_sort with the same default).
        heroes = sorted(heroes, key=lambda row: float(row[1]), reverse=True)
        total = len(heroes)
        paginated = params.paginate_data(heroes)
        return pagination.Paginated(
            page=params.page,
            per_page=params.per_page,
            total=total,
            results=[
                schemas.HeroPlaytime(
                    hero=self.to_read(hero),
                    playtime=round(float(playtime), 4),
                )
                for hero, playtime in paginated
            ],
        )

    async def lookup(self, session: AsyncSession) -> list[schemas.LookupItem]:
        """``(id, name)`` pairs for the admin/filter pickers, name-ordered.

        Lives here rather than in `rpc/heroes.py`, which used to inline the same
        two-column projection three times over (hero/map/gamemode) and bypass its
        own service layer.
        """
        rows = await self.repo.list_lookup(session)
        return [schemas.LookupItem(id=row.id, name=row.name) for row in rows]


heroes = HeroService()
