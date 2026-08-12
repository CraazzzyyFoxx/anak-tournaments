"""Queue of catalog names from match logs that no alias resolved.

A miss is written in its OWN transaction. For maps and gamemodes it precedes the
404 that rolls the log-processing session back — a shared session would lose the
row. The write is best-effort: its own failure is logged and must never replace
the real processing error, because the caller is already on the way to raising one.
"""

from collections.abc import Iterable

import sqlalchemy as sa
from loguru import logger
from sqlalchemy.dialects.postgresql import Insert
from sqlalchemy.dialects.postgresql import insert as pg_insert

from src import models
from src.core import db, enums

__all__ = ("MISS_NAME_MAX_LENGTH", "build_miss_upsert", "record_misses")

# Matches `CatalogAliasMiss.raw_name`; a longer name is truncated rather than
# dropped so the queue still shows that something unknown arrived.
MISS_NAME_MAX_LENGTH = 128


def _clean(raw_names: Iterable[str]) -> set[str]:
    return {name.strip() for name in raw_names if name and name.strip()}


def build_miss_upsert(
    entity_type: enums.CatalogEntityType,
    raw_names: Iterable[str],
    *,
    log_record_id: int | None = None,
) -> Insert:
    """The upsert on its own, so the SQL can be asserted without a database."""
    statement = pg_insert(models.CatalogAliasMiss).values(
        [
            {
                "entity_type": entity_type,
                "raw_name": name[:MISS_NAME_MAX_LENGTH],
                "last_log_record_id": log_record_id,
            }
            for name in sorted(_clean(raw_names))
        ]
    )
    return statement.on_conflict_do_update(
        constraint="uq_catalog_alias_miss_entity_raw",
        set_={
            "occurrences": models.CatalogAliasMiss.occurrences + 1,
            "last_seen_at": sa.func.now(),
            "last_log_record_id": statement.excluded.last_log_record_id,
            # A name showing up again reopens a dismissed miss: "hidden, but it
            # keeps coming back" has to stay visible instead of being lost.
            "resolved_at": None,
        },
    )


async def record_misses(
    entity_type: enums.CatalogEntityType,
    raw_names: Iterable[str],
    *,
    log_record_id: int | None = None,
) -> None:
    names = _clean(raw_names)
    if not names:
        return

    try:
        async with db.async_session_maker() as session:
            await session.execute(build_miss_upsert(entity_type, names, log_record_id=log_record_id))
            await session.commit()
    except Exception as exc:
        logger.warning(f"Failed to record {entity_type.value} alias misses {sorted(names)}: {exc}")
