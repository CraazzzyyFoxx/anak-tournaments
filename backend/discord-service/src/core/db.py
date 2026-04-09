from shared.core.db import Base, create_database

from src.core.config import settings

_db = create_database(
    async_url=settings.db_url_asyncpg,
    pool_size=settings.db_pool_size,
    max_overflow=settings.db_max_overflow,
    statement_timeout=settings.db_statement_timeout,
)

async_engine = _db.async_engine
async_session_maker = _db.async_session_maker
