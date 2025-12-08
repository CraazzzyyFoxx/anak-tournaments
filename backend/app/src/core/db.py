from collections.abc import AsyncGenerator

from sqlalchemy import ColumnCollection, create_engine
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import Session, sessionmaker

# Import base classes from shared library
from shared.core.db import Base, TimeStampIntegerMixin, TimeStampUUIDMixin, DateTime

from src.core import config, errors


# Extend Base with app-specific methods
class AppBase(Base):
    @classmethod
    def get_column(cls, column_name: str) -> ColumnCollection:
        if column_name not in {c.name for c in cls.__table__.columns}:
            raise errors.ApiHTTPException(
                status_code=400,
                detail=[errors.ApiExc(code="invalid_column", msg="Invalid column")],
            )
        return {c.name: c for c in cls.__table__.columns}[column_name]

    @classmethod
    def depth_get_column(cls, column_name: list[str]) -> ColumnCollection:
        if len(column_name) > 2:
            raise errors.ApiHTTPException(
                status_code=400,
                detail=[errors.ApiExc(code="invalid_column", msg="Invalid column")],
            )

        if len(column_name) == 1:
            return cls.get_column(column_name[0])

        try:
            field = cls.__getattribute__(cls, column_name[0])
            entity = field.entity
            if column_name[1] not in {c.name for c in entity.columns}:
                raise errors.ApiHTTPException(
                    status_code=400,
                    detail=[errors.ApiExc(code="invalid_column", msg="Invalid column")],
                )
            return {c.name: c for c in entity.columns}[column_name[1]]
        except (IndexError, KeyError):
            raise errors.ApiHTTPException(
                status_code=400,
                detail=[errors.ApiExc(code="invalid_column", msg="Invalid column")],
            )


async_engine = create_async_engine(url=config.settings.db_url_asyncpg)
engine = create_engine(url=config.settings.db_url)
session_maker = sessionmaker(engine, class_=Session, expire_on_commit=False)
async_session_maker = async_sessionmaker(
    async_engine, class_=AsyncSession, expire_on_commit=False
)


async def get_async_session() -> AsyncGenerator[AsyncSession, None]:
    async with async_session_maker() as session:
        yield session
