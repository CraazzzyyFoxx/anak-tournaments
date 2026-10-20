"""Append-only trail of every change to an encounter's result.

``before``/``after`` are arrays of ``{encounter_team_id, score, placement}``, so a
duel and a lobby are recorded identically, and ``result_version`` pins the row to
the exact state the encounter was left in.

Rows are written by every result path and never updated or deleted; the
encounter's ``ON DELETE CASCADE`` is the only thing that removes them. A NULL
``actor_user_id`` means a machine actor (Challonge import, bracket cascade).
"""

from __future__ import annotations

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Enum,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from shared.core import db, enums
from shared.models.encounter.encounter import ENCOUNTER_RESULT_STATUS_ENUM, Encounter
from shared.models.identity.user import User

__all__ = ("EncounterResultAudit", "ENCOUNTER_RESULT_AUDIT_ACTION_ENUM")


ENCOUNTER_RESULT_AUDIT_ACTION_ENUM = Enum(
    enums.EncounterResultAuditAction,
    values_callable=lambda e: [x.value for x in e],
    name="encounterresultauditaction",
    schema="encounter",
    create_type=False,
)


class EncounterResultAudit(db.TimeStampIntegerMixin):
    """One transition of an encounter's result."""

    __tablename__ = "result_audit"
    __table_args__ = (
        # Every read is "the history of this encounter", newest first.
        Index("ix_encounter_result_audit_encounter_created", "encounter_id", "created_at"),
        Index("ix_result_audit_game_id", "game_id"),
        #: One row per version: the journal IS the version sequence.
        UniqueConstraint("encounter_id", "result_version", name="uq_result_audit_version"),
        ForeignKeyConstraint(
            ["game_id", "encounter_id"],
            ["encounter.game.id", "encounter.game.encounter_id"],
            name="fk_result_audit_game",
            deferrable=True,
            initially="DEFERRED",
        ),
        # The journal outlives the participation it adopted.
        ForeignKeyConstraint(
            ["adopted_team_id", "encounter_id"],
            ["encounter.team.id", "encounter.team.encounter_id"],
            ondelete="SET NULL (adopted_team_id)",
            name="fk_result_audit_adopted",
        ),
        CheckConstraint("snapshot_scope IN ('encounter', 'game')", name="ck_result_audit_scope"),
        CheckConstraint("snapshot_scope = 'encounter' OR game_id IS NOT NULL", name="ck_result_audit_game_scope"),
        {"schema": "encounter"},
    )

    encounter_id: Mapped[int] = mapped_column(ForeignKey(Encounter.id, ondelete="CASCADE"))
    #: The ``encounter.result_version`` this operation left behind.
    result_version: Mapped[int] = mapped_column(BigInteger())
    #: ``enums.AuditSnapshotScope``: whether the snapshot is the encounter's
    #: standing or one game's numbers.
    snapshot_scope: Mapped[str] = mapped_column(String(16))
    game_id: Mapped[int | None] = mapped_column(BigInteger(), nullable=True)
    game_result_version: Mapped[int | None] = mapped_column(Integer(), nullable=True)
    # NULL = machine actor. SET NULL so a deleted account leaves the trail intact.
    actor_user_id: Mapped[int | None] = mapped_column(ForeignKey(User.id, ondelete="SET NULL"), nullable=True)
    action: Mapped[enums.EncounterResultAuditAction] = mapped_column(ENCOUNTER_RESULT_AUDIT_ACTION_ENUM)
    from_result_status: Mapped[enums.EncounterResultStatus | None] = mapped_column(
        ENCOUNTER_RESULT_STATUS_ENUM, nullable=True
    )
    to_result_status: Mapped[enums.EncounterResultStatus] = mapped_column(ENCOUNTER_RESULT_STATUS_ENUM)
    #: ``[{encounter_team_id, score, placement}]``; NULL when nothing preceded.
    before: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    after: Mapped[list] = mapped_column(JSONB)
    #: Which participation's report was taken as truth, when one was adopted.
    adopted_team_id: Mapped[int | None] = mapped_column(BigInteger(), nullable=True)
    #: Admin's stated reason for a correction/cancel; NULL for automatic rows.
    reason: Mapped[str | None] = mapped_column(Text(), nullable=True)
    #: ``captain``, ``admin``, ``challonge``, ``system``, ``series_claim`` … --
    #: which is why 16 characters was not enough (``captain_agreement``).
    source: Mapped[str] = mapped_column(String(32))

    encounter: Mapped[Encounter] = relationship(back_populates="result_audit", foreign_keys=[encounter_id])
    actor: Mapped[User | None] = relationship()
