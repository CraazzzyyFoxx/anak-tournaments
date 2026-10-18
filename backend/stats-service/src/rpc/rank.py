"""Typed-RPC subjects of the OverFast rank domain: ``rpc.stats.rank.*``.

The handlers (payload validation, ``rank.read`` / ``rank.update`` authorization, workspace scoping) belong to the
discipline module that collects the ranks: each subject dispatches to the matching ``DisciplineSpec.collection_handlers``
entry. Reads are public (AuthNone); the admin operations need the caller's identity.
"""

from __future__ import annotations

from typing import Any

from faststream.rabbit import RabbitMessage

from shared.disciplines import DISCIPLINES
from shared.disciplines.spec import CollectionHandler
from src.core import db

from . import _common as c

_SF = db.async_session_maker

# The discipline whose module serves these subjects; Task 6 renames them and selects by discipline.
_DISCIPLINE = "overwatch"

# Subject -> collection handler key. Literal on purpose: the gateway route parity guard reads subjects from source.
_SUBJECTS = {
    "rpc.stats.rank.user_history": "rank.user_history",
    "rpc.stats.rank.battle_tag_history": "rank.battle_tag_history",
    "rpc.stats.rank.user_current": "rank.user_current",
    "rpc.stats.rank.fetch_log": "rank.fetch_log",
    "rpc.stats.rank.stats": "rank.stats",
    "rpc.stats.rank.user_collection": "rank.user_collection",
    "rpc.stats.rank.collect": "rank.collect",
    "rpc.stats.rank.reenable_disabled": "rank.reenable_disabled",
}

# Public (AuthNone) reads never look at the caller; everything else needs a valid identity.
_PUBLIC = frozenset({"rank.user_history", "rank.battle_tag_history", "rank.user_current"})


def register(broker: Any, logger: Any) -> None:
    def bind(subject: str, name: str, handler: CollectionHandler) -> None:
        async def _handle(data: dict, msg: RabbitMessage) -> dict:
            async def op(session: Any) -> Any:
                user = None if name in _PUBLIC else c.actor(data)
                return await handler(session, user, data)

            return await c.envelope(logger, name, op, session_factory=_SF)

        # FastStream names a handler after its function: one distinct name per subject.
        _handle.__name__ = f"_{name.replace('.', '_')}"
        broker.subscriber(subject)(_handle)

    handlers = DISCIPLINES[_DISCIPLINE].collection_handlers
    for subject, name in _SUBJECTS.items():
        bind(subject, name, handlers[name])
