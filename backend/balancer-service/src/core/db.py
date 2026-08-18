from shared.core.db import Base, TimeStampIntegerMixin, TimeStampUUIDMixin, create_database_from_settings
from src.core import config

__all__ = (
    "Base",
    "TimeStampIntegerMixin",
    "TimeStampUUIDMixin",
    "async_engine",
    "async_session_maker",
    "get_async_session",
)

_db = create_database_from_settings(config.config)

async_engine = _db.async_engine
async_session_maker = _db.async_session_maker
get_async_session = _db.get_async_session
