from datetime import datetime

from sqlalchemy import BigInteger, DateTime, Uuid, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    entity_name: str = "unknown"

    def to_dict(self):
        return {c.name: getattr(self, c.name, None) for c in self.__table__.columns}


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
