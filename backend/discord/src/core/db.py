"""
Database configuration for Discord bot
"""
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from src.core.config import settings

# Import shared base
from shared.core.db import Base

__all__ = [
    "Base",
    "async_session_maker",
    "async_engine",
]

# Create async engine
async_engine = create_async_engine(
    url=settings.db_url_asyncpg,
    pool_size=5,
    max_overflow=10,
    echo=False
)

# Create session maker
async_session_maker = async_sessionmaker(
    async_engine,
    class_=AsyncSession,
    expire_on_commit=False
)
