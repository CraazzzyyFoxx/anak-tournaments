from sqlalchemy.ext.asyncio import AsyncSession

from shared.repository import GamemodeRepository
from src import models, schemas
from src.core import errors, pagination

__all__ = ("GamemodeService", "gamemodes")


class GamemodeService:
    def __init__(self, *, repo: GamemodeRepository = GamemodeRepository()) -> None:
        self.repo = repo

    @staticmethod
    def to_read(gamemode: models.Gamemode) -> schemas.GamemodeRead:
        """Serialize a Gamemode into ``GamemodeRead``.

        Spreads ``to_dict()`` rather than enumerating fields, matching the map and
        hero serializers. The enumerated version silently dropped every column added
        after it was written: `aliases` fell back to the schema default `[]`, so the
        admin dialog rendered an empty editor over real data and saving it would have
        wiped the aliases the log parser resolves names through.
        """
        return schemas.GamemodeRead(**gamemode.to_dict())

    async def get(self, session: AsyncSession, gamemode_id: int, entities: list[str]) -> schemas.GamemodeRead:
        """Gamemode by ID; 404 when it does not exist.

        ``entities`` accepts ``"maps"``; without that token the maps are not loaded.
        """
        gamemode = await self.repo.get_expanded(session, gamemode_id, entities)

        if not gamemode:
            raise errors.ApiHTTPException(
                status_code=404,
                detail=[
                    errors.ApiExc(
                        code="not_found",
                        msg=f"Gamemode not found with id={gamemode_id}",
                    )
                ],
            )

        return self.to_read(gamemode)

    async def get_all(
        self, session: AsyncSession, params: pagination.PaginationSortSearchParams
    ) -> pagination.Paginated[schemas.GamemodeRead]:
        """Paginated gamemodes, with their maps eager-loaded when ``params.entities``
        contains ``"maps"``.
        """
        gamemodes, total = await self.repo.all(session, params, entities=params.entities)
        return pagination.Paginated(
            total=total,
            per_page=params.per_page,
            page=params.page,
            results=[self.to_read(gamemode) for gamemode in gamemodes],
        )

    async def lookup(self, session: AsyncSession) -> list[schemas.LookupItem]:
        """``(id, name)`` pairs for the admin/filter pickers, name-ordered.

        Was inlined in `rpc/gamemodes.py`; see `HeroService.lookup` for why it
        lands on the service. The gamemode domain has no query class at all — its
        only SQL is this projection, and it now lives on `GamemodeRepository`.
        """
        rows = await self.repo.list_lookup(session)
        return [schemas.LookupItem(id=row.id, name=row.name) for row in rows]


gamemodes = GamemodeService()
