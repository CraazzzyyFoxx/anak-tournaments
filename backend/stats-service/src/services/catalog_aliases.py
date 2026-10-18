"""Queue of catalog names from match logs that no alias resolved.

A miss is written in its OWN transaction after processing rollback releases the
job row lock. The breadcrumb survives the rejected observation revision. Its
failure is logged without replacing the underlying parse error.

The upsert itself lives on ``CatalogAliasMissRepository`` — this module only
owns the isolated session and the swallow-on-failure wrapper.
"""

from collections.abc import Iterable

from loguru import logger
from sqlalchemy.dialects.postgresql import Insert

from shared.repository import CatalogAliasMissRepository
from src.core import db

__all__ = ("DISCIPLINE", "MISS_NAME_MAX_LENGTH", "build_miss_upsert", "record_misses")

#: The Workshop CSV decoder is Overwatch's; P5 moves it into the module.
DISCIPLINE = "overwatch"

# Matches `CatalogAliasMiss.raw_name`; a longer name is truncated rather than
# dropped so the queue still shows that something unknown arrived.
MISS_NAME_MAX_LENGTH = 128

_misses = CatalogAliasMissRepository()


def build_miss_upsert(
    kind: str,
    raw_names: Iterable[str],
    *,
    ingest_job_id: int | None = None,
) -> Insert:
    """The upsert on its own, so the SQL can be asserted without a database."""
    return _misses.build_miss_upsert(
        DISCIPLINE,
        kind,
        raw_names,
        ingest_job_id=ingest_job_id,
        name_max_length=MISS_NAME_MAX_LENGTH,
    )


async def record_misses(
    kind: str,
    raw_names: Iterable[str],
    *,
    ingest_job_id: int | None = None,
) -> None:
    names = {name.strip() for name in raw_names if name and name.strip()}
    if not names:
        return

    try:
        async with db.async_session_maker() as session:
            await _misses.record_miss(
                session,
                DISCIPLINE,
                kind,
                names,
                ingest_job_id=ingest_job_id,
                name_max_length=MISS_NAME_MAX_LENGTH,
            )
            await session.commit()
    except Exception as exc:
        logger.warning(f"Failed to record {kind} alias misses {sorted(names)}: {exc}")
