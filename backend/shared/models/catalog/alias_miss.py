"""Queue of catalog names a match log used that no alias resolved.

Match logs carry map/gamemode/hero names in the reporting client's locale. When
a name matches neither the canonical `name` nor any entry in `aliases`, the
parser lands it here instead of leaving the gap visible only in service logs.

Rows are upserted on ``(entity_type, raw_name)`` with an occurrence counter, so
the admin queue is ordered by how much a missing alias actually hurts. Rows are
never deleted: ``resolved_at`` is stamped on attach/dismiss and cleared again if
the same name reappears, so "dismissed but it keeps coming back" stays visible.
"""

from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from shared.core import db, enums

__all__ = ("CatalogAliasMiss",)


class CatalogAliasMiss(db.TimeStampIntegerMixin):
    __tablename__ = "catalog_alias_miss"
    __table_args__ = (
        UniqueConstraint("entity_type", "raw_name", name="uq_catalog_alias_miss_entity_raw"),
        {"schema": "overwatch"},
    )

    entity_type: Mapped[enums.CatalogEntityType] = mapped_column(
        Enum(enums.CatalogEntityType, name="catalogentitytype"), nullable=False
    )
    raw_name: Mapped[str] = mapped_column(String(128), nullable=False)
    occurrences: Mapped[int] = mapped_column(Integer(), nullable=False, server_default="1")
    first_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=db.func.now()
    )
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=db.func.now()
    )
    # Breadcrumb for triage, not a dependency: the log that last hit this name.
    last_log_record_id: Mapped[int | None] = mapped_column(
        ForeignKey("log_processing.record.id", ondelete="SET NULL"), nullable=True
    )
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    def __repr__(self) -> str:
        return f"<CatalogAliasMiss {self.entity_type}:{self.raw_name} x{self.occurrences}>"
