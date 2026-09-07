"""Queue of catalog names from match logs that no alias resolved.

A miss is written in its OWN transaction. For maps and gamemodes it precedes the
404 that rolls the log-processing session back — a shared session would lose the
row. The write is best-effort: its own failure is logged and must never replace
the real processing error, because the caller is already on the way to raising one.

The upsert itself lives on ``CatalogAliasMissRepository`` — this module only
owns the isolated session and the swallow-on-failure wrapper.
"""

from collections.abc import Iterable

from loguru import logger
from sqlalchemy.dialects.postgresql import Insert

from shared.repository import CatalogAliasMissRepository
from src.core import db, enums

__all__ = ("MISS_NAME_MAX_LENGTH", "build_miss_upsert", "record_misses")

# Matches `CatalogAliasMiss.raw_name`; a longer name is truncated rather than
# dropped so the queue still shows that something unknown arrived.
MISS_NAME_MAX_LENGTH = 128

_misses = CatalogAliasMissRepository()


def build_miss_upsert(
    entity_type: enums.CatalogEntityType,
    raw_names: Iterable[str],
    *,
    log_record_id: int | None = None,
) -> Insert:
    """The upsert on its own, so the SQL can be asserted without a database."""
    return _misses.build_miss_upsert(
        entity_type,
        raw_names,
        log_record_id=log_record_id,
        name_max_length=MISS_NAME_MAX_LENGTH,
    )


async def record_misses(
    entity_type: enums.CatalogEntityType,
    raw_names: Iterable[str],
    *,
    log_record_id: int | None = None,
) -> None:
    names = {name.strip() for name in raw_names if name and name.strip()}
    if not names:
        return

    try:
        async with db.async_session_maker() as session:
            await _misses.record_miss(
                session,
                entity_type,
                names,
                log_record_id=log_record_id,
                name_max_length=MISS_NAME_MAX_LENGTH,
            )
            await session.commit()
    except Exception as exc:
        logger.warning(f"Failed to record {entity_type.value} alias misses {sorted(names)}: {exc}")
