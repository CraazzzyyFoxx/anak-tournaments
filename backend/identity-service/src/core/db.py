from shared.core.db import Base, DateTime, TimeStampIntegerMixin, TimeStampUUIDMixin, create_database_from_settings
from src.core.config import settings

__all__ = (
    "Base",
    "DateTime",
    "TimeStampIntegerMixin",
    "TimeStampUUIDMixin",
    "async_engine",
    "async_session_maker",
    "get_async_session",
    "init_db",
)

_db = create_database_from_settings(settings)

async_engine = _db.async_engine
async_session_maker = _db.async_session_maker
get_async_session = _db.get_async_session


async def init_db() -> None:
    """Test database connection on startup."""
    async with async_engine.begin() as conn:
        await conn.run_sync(lambda _: None)
