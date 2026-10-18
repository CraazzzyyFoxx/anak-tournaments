from shared.core.db import Base, DateTime, TimeStampIntegerMixin, TimeStampUUIDMixin, create_database_from_settings
from src.core import config

__all__ = (
    "Base",
    "DateTime",
    "TimeStampIntegerMixin",
    "TimeStampUUIDMixin",
    "async_engine",
    "async_session_maker",
    "get_async_session",
)

_db = create_database_from_settings(config.settings)

async_engine = _db.async_engine
async_session_maker = _db.async_session_maker
get_async_session = _db.get_async_session
