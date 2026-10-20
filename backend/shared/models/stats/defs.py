"""Discipline vocabularies projected from immutable module declarations."""

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column

from shared.core import db

__all__ = ("StatDef", "EventType")


class StatDef(db.Base):
    __tablename__ = "stat_def"
    __table_args__ = (
        sa.UniqueConstraint("discipline", "code", name="uq_stat_def_code"),
        sa.CheckConstraint("aggregation IN ('sum', 'max', 'min', 'avg', 'last')", name="ck_stat_def_aggregation"),
        {"schema": "stats"},
    )

    id: Mapped[int] = mapped_column(sa.SmallInteger(), sa.Identity(always=True), primary_key=True)
    discipline: Mapped[str] = mapped_column(
        sa.String(32), sa.ForeignKey("catalog.discipline.code", name="fk_stat_def_discipline")
    )
    code: Mapped[str] = mapped_column(sa.String(64))
    name: Mapped[str] = mapped_column(sa.String(128))
    value_format: Mapped[str] = mapped_column(sa.String(16))
    aggregation: Mapped[str] = mapped_column(sa.String(8))
    stat_group: Mapped[str | None] = mapped_column(sa.String(32), nullable=True)
    active: Mapped[bool] = mapped_column(sa.Boolean(), default=True, server_default=sa.true())
    sort_order: Mapped[int] = mapped_column(sa.Integer(), default=0, server_default="0")


class EventType(db.Base):
    __tablename__ = "event_type"
    __table_args__ = (sa.UniqueConstraint("discipline", "code", name="uq_event_type_code"), {"schema": "stats"})

    id: Mapped[int] = mapped_column(sa.SmallInteger(), sa.Identity(always=True), primary_key=True)
    discipline: Mapped[str] = mapped_column(
        sa.String(32), sa.ForeignKey("catalog.discipline.code", name="fk_event_type_discipline")
    )
    code: Mapped[str] = mapped_column(sa.String(64))
    name: Mapped[str] = mapped_column(sa.String(128))
    active: Mapped[bool] = mapped_column(sa.Boolean(), default=True, server_default=sa.true())
