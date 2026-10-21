from shared.core.db import create_database_from_settings
from src.core.config import settings

__all__ = ("async_engine", "async_session_maker")

_db = create_database_from_settings(settings)

async_engine = _db.async_engine
async_session_maker = _db.async_session_maker
