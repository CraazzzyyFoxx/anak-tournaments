from collections.abc import AsyncGenerator

from sqlalchemy import ColumnCollection, create_engine
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import Session, sessionmaker

# Import base classes from shared library
from shared.core.db import Base, TimeStampIntegerMixin, TimeStampUUIDMixin, DateTime

from src.core import config, errors


async_engine = create_async_engine(url=config.settings.db_url_asyncpg, pool_size=50, max_overflow=25)
engine = create_engine(url=config.settings.db_url)
session_maker = sessionmaker(engine, class_=Session, expire_on_commit=False)
async_session_maker = async_sessionmaker(async_engine, class_=AsyncSession, expire_on_commit=False)


async def get_async_session() -> AsyncGenerator[AsyncSession, None]:
    async with async_session_maker() as session:
        yield session
