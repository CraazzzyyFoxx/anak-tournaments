from sqlalchemy import ForeignKey, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from shared.core import db
from shared.models.tournament import Tournament

__all__ = ("ChallongeSyncLog",)


class ChallongeSyncLog(db.TimeStampIntegerMixin):
    __tablename__ = "challonge_sync_log"
    __table_args__ = ({"schema": "tournament"},)

    tournament_id: Mapped[int] = mapped_column(
        ForeignKey(Tournament.id, ondelete="CASCADE"), index=True
    )
    direction: Mapped[str] = mapped_column(String(10))  # "import" or "export"
    entity_type: Mapped[str] = mapped_column(String(32))  # tournament, participant, match
    entity_id: Mapped[int | None] = mapped_column(Integer(), nullable=True)
    challonge_id: Mapped[int | None] = mapped_column(Integer(), nullable=True)
    status: Mapped[str] = mapped_column(String(16))  # success, failed, conflict
    payload_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text(), nullable=True)

    tournament: Mapped[Tournament] = relationship()
