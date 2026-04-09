from shared.core.db import Base, TimeStampIntegerMixin, TimeStampUUIDMixin, create_database

from src.core import config

_db = create_database(
    async_url=config.config.db_url_asyncpg,
    sync_url=config.config.db_url,
    pool_size=config.config.db_pool_size,
    max_overflow=config.config.db_max_overflow,
    statement_timeout=config.config.db_statement_timeout,
)

async_engine = _db.async_engine
engine = _db.sync_engine
async_session_maker = _db.async_session_maker
session_maker = _db.sync_session_maker
get_async_session = _db.get_async_session
