"""Raw-object provenance and asynchronous ingest lifecycle, independent of bound matches."""

from datetime import datetime
from enum import StrEnum

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column

from shared.core import db

__all__ = ("IngestJob", "IngestJobStatus", "RawSourceStatus")


class IngestJobStatus(StrEnum):
    PENDING = "pending"
    PROCESSING = "processing"
    AWAITING_LINK = "awaiting_link"
    DONE = "done"
    FAILED = "failed"


class RawSourceStatus(StrEnum):
    AVAILABLE = "available"
    MISSING = "missing"
    CONFLICT = "conflict"
    UNVERIFIED = "unverified"


class IngestJob(db.TimeStampIntegerMixin):
    __tablename__ = "ingest_job"
    __table_args__ = (
        sa.CheckConstraint(
            "raw_status <> 'available' OR content_hash IS NOT NULL", name="ck_ingest_job_available_hash"
        ),
        sa.Index(
            "uq_ingest_job_external",
            "workspace_id",
            "source_kind",
            "external_id",
            unique=True,
            postgresql_where=sa.text("external_id IS NOT NULL"),
        ),
        sa.Index(
            "uq_ingest_job_hash",
            "workspace_id",
            "content_hash",
            unique=True,
            postgresql_where=sa.text("external_id IS NULL"),
        ),
        sa.Index("ix_ingest_job_status", "status", "created_at"),
        sa.Index("ix_ingest_job_uploader", "uploader_user_id"),
        sa.Index("ix_ingest_job_api_key", "api_key_id"),
        sa.Index("ix_ingest_job_tournament", "hint_tournament_id"),
        sa.Index("ix_ingest_job_encounter", "hint_encounter_id"),
        sa.Index("ix_ingest_job_game", "hint_encounter_game_id"),
        {"schema": "stats"},
    )

    workspace_id: Mapped[int] = mapped_column(
        sa.ForeignKey(
            "workspace.id", name="fk_ingest_job_workspace", ondelete="CASCADE", deferrable=True, initially="DEFERRED"
        )
    )
    discipline: Mapped[str] = mapped_column(
        sa.String(32), sa.ForeignKey("catalog.discipline.code", name="fk_ingest_job_discipline")
    )
    source_kind: Mapped[str] = mapped_column(sa.String(32))
    external_id: Mapped[str | None] = mapped_column(sa.String(128), nullable=True)
    content_hash: Mapped[str | None] = mapped_column(sa.CHAR(64), nullable=True)
    raw_status: Mapped[RawSourceStatus] = mapped_column(
        sa.Enum(
            RawSourceStatus,
            values_callable=lambda enum: [item.value for item in enum],
            native_enum=False,
            create_constraint=True,
            name="ck_ingest_job_raw_status",
            length=16,
        ),
        default=RawSourceStatus.AVAILABLE,
        server_default="available",
    )
    filename: Mapped[str | None] = mapped_column(sa.String(500), nullable=True)
    raw_ref: Mapped[str] = mapped_column(sa.String(512))
    document_ref: Mapped[str | None] = mapped_column(sa.String(512), nullable=True)
    status: Mapped[IngestJobStatus] = mapped_column(
        sa.Enum(
            IngestJobStatus,
            values_callable=lambda enum: [item.value for item in enum],
            native_enum=False,
            create_constraint=True,
            name="ck_ingest_job_status",
            length=16,
        )
    )
    attempts: Mapped[int] = mapped_column(sa.Integer(), default=0, server_default="0")
    error_message: Mapped[str | None] = mapped_column(sa.Text(), nullable=True)
    uploader_user_id: Mapped[int | None] = mapped_column(
        sa.ForeignKey(
            "players.user.id", name="fk_ingest_job_uploader", ondelete="SET NULL", deferrable=True, initially="DEFERRED"
        ),
        nullable=True,
    )
    api_key_id: Mapped[int | None] = mapped_column(
        sa.ForeignKey(
            "auth.api_key.id", name="fk_ingest_job_api_key", ondelete="SET NULL", deferrable=True, initially="DEFERRED"
        ),
        nullable=True,
    )
    hint_tournament_id: Mapped[int | None] = mapped_column(
        sa.ForeignKey(
            "tournament.tournament.id",
            name="fk_ingest_job_tournament",
            ondelete="SET NULL",
            deferrable=True,
            initially="DEFERRED",
        ),
        nullable=True,
    )
    hint_encounter_id: Mapped[int | None] = mapped_column(
        sa.ForeignKey(
            "encounter.encounter.id",
            name="fk_ingest_job_encounter",
            ondelete="SET NULL",
            deferrable=True,
            initially="DEFERRED",
        ),
        nullable=True,
    )
    hint_encounter_game_id: Mapped[int | None] = mapped_column(
        sa.ForeignKey(
            "encounter.game.id", name="fk_ingest_job_game", ondelete="SET NULL", deferrable=True, initially="DEFERRED"
        ),
        nullable=True,
    )
    started_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)

    @property
    def raw_available(self) -> bool:
        return self.raw_status == RawSourceStatus.AVAILABLE and self.content_hash is not None
