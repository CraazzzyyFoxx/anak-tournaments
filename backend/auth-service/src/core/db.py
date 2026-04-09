from shared.core.db import Base, TimeStampIntegerMixin, TimeStampUUIDMixin, DateTime, create_database

from src.core.config import settings

_db = create_database(
    async_url=settings.db_url_asyncpg,
    sync_url=settings.db_url,
    pool_size=settings.db_pool_size,
    max_overflow=settings.db_max_overflow,
    statement_timeout=settings.db_statement_timeout,
)

async_engine = _db.async_engine
engine = _db.sync_engine
async_session_maker = _db.async_session_maker
session_maker = _db.sync_session_maker
get_async_session = _db.get_async_session


async def init_db() -> None:
    """Test database connection on startup."""
    async with async_engine.begin() as conn:
        await conn.run_sync(lambda _: None)
