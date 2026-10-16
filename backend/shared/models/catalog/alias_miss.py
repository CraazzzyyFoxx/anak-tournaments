"""Queue of catalog names a match log used that no alias resolved.

Match logs carry map/gamemode/hero names in the reporting client's locale. When
a name matches neither the canonical `name` nor any entry in `aliases`, the
parser lands it here instead of leaving the gap visible only in service logs.

Rows are upserted on ``(discipline, kind, raw_name)`` with an occurrence counter, so
the admin queue is ordered by how much a missing alias actually hurts. Rows are
never deleted: ``resolved_at`` is stamped on attach/dismiss and cleared again if
the same name reappears, so "dismissed but it keeps coming back" stays visible.
"""

from datetime import datetime

from sqlalchemy import BigInteger, CheckConstraint, DateTime, ForeignKey, Index, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from shared.core import db

__all__ = ("CatalogAliasMiss",)


class CatalogAliasMiss(db.TimeStampIntegerMixin):
    __tablename__ = "alias_miss"
    __table_args__ = (
        CheckConstraint("kind IN ('character', 'map', 'mode')", name="ck_alias_miss_kind"),
        UniqueConstraint("discipline", "kind", "raw_name", name="uq_alias_miss"),
        Index("ix_alias_miss_ingest_job", "last_ingest_job_id"),
        {"schema": "catalog"},
    )

    discipline: Mapped[str] = mapped_column(
        String(32), ForeignKey("catalog.discipline.code", name="fk_alias_miss_discipline")
    )
    kind: Mapped[str] = mapped_column(String(16))
    raw_name: Mapped[str] = mapped_column(String(128), nullable=False)
    occurrences: Mapped[int] = mapped_column(Integer(), nullable=False, server_default="1")
    first_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=db.func.now()
    )
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=db.func.now()
    )
    last_ingest_job_id: Mapped[int | None] = mapped_column(
        BigInteger(),
        ForeignKey(
            "stats.ingest_job.id",
            name="fk_alias_miss_ingest_job",
            ondelete="SET NULL",
            deferrable=True,
            initially="DEFERRED",
        ),
        nullable=True,
    )
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    def __repr__(self) -> str:
        return f"<CatalogAliasMiss {self.discipline}/{self.kind}:{self.raw_name} x{self.occurrences}>"
