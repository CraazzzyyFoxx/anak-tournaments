from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy import create_engine

from src.core.config import settings

# Import shared base classes
from shared.core.db import Base, TimeStampIntegerMixin, TimeStampUUIDMixin, DateTime

__all__ = [
    "Base",
    "TimeStampIntegerMixin", 
    "TimeStampUUIDMixin",
    "DateTime",
    "get_async_session",
    "async_session_maker",
    "session_maker",
    "init_db",
]

# Create database engines
async_engine = create_async_engine(url=settings.db_url_asyncpg, pool_size=10, max_overflow=20)
engine = create_engine(url=settings.db_url)

# Create session makers
session_maker = sessionmaker(engine, class_=Session, expire_on_commit=False)
async_session_maker = async_sessionmaker(async_engine, class_=AsyncSession, expire_on_commit=False)


async def init_db() -> None:
    """
    Initialize database connection
    Note: Tables are created by alembic migrations in the main app
    This service just connects to the existing shared database
    """
    async with async_engine.begin() as conn:
        # Just test the connection
        await conn.run_sync(lambda _: None)


async def get_async_session() -> AsyncGenerator[AsyncSession, None]:
    """Get async database session"""
    async with async_session_maker() as session:
        yield session
