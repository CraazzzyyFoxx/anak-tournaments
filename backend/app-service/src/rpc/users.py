"""Player identity reads for the /users/* surface: the directory, the autocomplete search and the profile slug.

Everything a player did (profile statistics, tournaments, matches, characters, maps, compare, the users overview) is
stats-service's ``rpc.stats.users.*``.
"""

from __future__ import annotations

import typing
from typing import Any

from faststream.rabbit import RabbitMessage

from shared.core import pagination
from shared.rpc.query import build_query_model
from src.core import db
from src.rpc import _common as c
from src.services.user.service import users as user_service

_SF = db.async_session_maker

_USERS_SORT = typing.Literal["id", "name", "similarity:name"]


def register(broker: Any, logger: Any) -> None:
    @broker.subscriber("rpc.app.users.list")
    async def _list(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            qp = build_query_model(pagination.PaginationSortSearchQueryParams[_USERS_SORT], data.get("query"))
            return await user_service.get_all(session, pagination.PaginationSortSearchParams.from_query_params(qp))

        return await c.envelope(logger, "users.list", op, session_factory=_SF)

    @broker.subscriber("rpc.app.users.search")
    async def _search(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            query = c.q1(data, "query", str, "")
            return await user_service.search_by_name(session, query)

        return await c.envelope(logger, "users.search", op, session_factory=_SF)

    @broker.subscriber("rpc.app.users.by_name")
    async def _by_name(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            raw = str(data.get("name", ""))
            entities = c.q(data, "entities") or []
            return await user_service.get_by_slug(session, raw, entities)

        return await c.envelope(logger, "users.by_name", op, session_factory=_SF)
