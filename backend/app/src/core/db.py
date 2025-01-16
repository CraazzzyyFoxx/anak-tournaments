from collections.abc import AsyncGenerator
from datetime import datetime

from sqlalchemy import BigInteger, ColumnCollection, DateTime, Uuid, create_engine, func
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker

from src.core import config, errors


class Base(DeclarativeBase):
    entity_name: str = "unknown"

    def to_dict(self):
        return {c.name: getattr(self, c.name, None) for c in self.__table__.columns}

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
        except:
            raise errors.ApiHTTPException(
                status_code=400,
                detail=[errors.ApiExc(code="invalid_column", msg="Invalid column")],
            )


class TimeStampIntegerMixin(Base):
    __abstract__ = True

    id: Mapped[int] = mapped_column(BigInteger(), primary_key=True, sort_order=-1000)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), sort_order=-999, default=func.now()
    )
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, sort_order=-998, onupdate=func.now()
    )


class TimeStampUUIDMixin(Base):
    __abstract__ = True

    id: Mapped[str] = mapped_column(
        Uuid(), primary_key=True, server_default=func.gen_random_uuid(), index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), sort_order=-999, default=func.now()
    )
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, sort_order=-998, onupdate=func.now()
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
