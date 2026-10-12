"""One participation's confirmation that it is ready for the pre-game phase.

Formerly ``tournament.encounter_readiness``, keyed by ``side``. Shared across
both pick-ban kinds: the same captain confirms once for the whole encounter, not
once per kind, and ``ensure_pick_ban_session`` refuses to open a session of
either kind until every participation has a row here. Cleared whenever a slot
changes hands -- a confirmation made against one opponent must not carry over to
a different one.
"""

from __future__ import annotations

from sqlalchemy import BigInteger, ForeignKey, ForeignKeyConstraint, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from shared.core import db
from shared.models.encounter.encounter import Encounter
from shared.models.identity.user import User

__all__ = ("EncounterReadiness",)


class EncounterReadiness(db.TimeStampIntegerMixin):
    __tablename__ = "readiness"
    __table_args__ = (
        UniqueConstraint("encounter_id", "encounter_team_id", name="uq_readiness_team"),
        ForeignKeyConstraint(
            ["encounter_team_id", "encounter_id"],
            ["encounter.team.id", "encounter.team.encounter_id"],
            name="fk_readiness_team",
            deferrable=True,
            initially="DEFERRED",
        ),
        {"schema": "encounter"},
    )

    encounter_id: Mapped[int] = mapped_column(ForeignKey(Encounter.id, ondelete="CASCADE"))
    encounter_team_id: Mapped[int] = mapped_column(BigInteger())
    # SET NULL so a deleted account leaves the confirmation intact.
    ready_user_id: Mapped[int | None] = mapped_column(ForeignKey(User.id, ondelete="SET NULL"), nullable=True)

    encounter: Mapped[Encounter] = relationship()
    ready_user: Mapped[User | None] = relationship()
