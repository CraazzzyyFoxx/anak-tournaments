"""A participation's claim about one game's result (D14, D58).

Formerly ``tournament.encounter_map_report``, which stored one score pair per
side. A claim now carries a row per participation, so a lobby of N claims the
same way a duel does. ``basis_version`` is the ``game.result_version`` the claim
was made against: a claim filed against a superseded result is stale, not a
competing truth.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    ForeignKey,
    ForeignKeyConstraint,
    Integer,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from shared.core import db
from shared.models.encounter.encounter import Encounter
from shared.models.identity.user import User

__all__ = ("EncounterGameClaim", "EncounterGameClaimResult")


class EncounterGameClaim(db.TimeStampIntegerMixin):
    __tablename__ = "game_claim"
    __table_args__ = (
        UniqueConstraint("game_id", "claimant_team_id", name="uq_game_claim_claimant"),
        #: Target of the results' composite FK.
        UniqueConstraint("id", "game_id", name="uq_game_claim_id_game"),
        ForeignKeyConstraint(
            ["game_id", "encounter_id"],
            ["encounter.game.id", "encounter.game.encounter_id"],
            name="fk_game_claim_game",
            deferrable=True,
            initially="DEFERRED",
        ),
        # Only a participation seated in THIS game may claim its result.
        ForeignKeyConstraint(
            ["game_id", "claimant_team_id"],
            ["encounter.game_team.game_id", "encounter.game_team.encounter_team_id"],
            name="fk_game_claim_claimant",
            deferrable=True,
            initially="DEFERRED",
        ),
        {"schema": "encounter"},
    )

    encounter_id: Mapped[int] = mapped_column(ForeignKey(Encounter.id, ondelete="CASCADE"))
    game_id: Mapped[int] = mapped_column(BigInteger())
    claimant_team_id: Mapped[int] = mapped_column(BigInteger())
    # SET NULL so a deleted account leaves the claim intact.
    reporter_user_id: Mapped[int | None] = mapped_column(ForeignKey(User.id, ondelete="SET NULL"), nullable=True)
    #: The ``game.result_version`` this claim was based on.
    basis_version: Mapped[int] = mapped_column(Integer())


class EncounterGameClaimResult(db.Base):
    """One participation's numbers inside one claim."""

    __tablename__ = "game_claim_result"
    __table_args__ = (
        ForeignKeyConstraint(
            ["claim_id", "game_id"],
            ["encounter.game_claim.id", "encounter.game_claim.game_id"],
            ondelete="CASCADE",
            name="fk_claim_result_claim",
        ),
        # A claim cannot name a participation that is not in the game.
        ForeignKeyConstraint(
            ["game_id", "encounter_team_id"],
            ["encounter.game_team.game_id", "encounter.game_team.encounter_team_id"],
            name="fk_claim_result_participant",
            deferrable=True,
            initially="DEFERRED",
        ),
        CheckConstraint("score IS NULL OR score >= 0", name="ck_claim_result_score"),
        CheckConstraint("placement IS NULL OR placement >= 1", name="ck_claim_result_placement"),
        CheckConstraint("jsonb_typeof(column_values) = 'object'", name="ck_claim_result_values"),
        {"schema": "encounter"},
    )

    claim_id: Mapped[int] = mapped_column(BigInteger(), primary_key=True)
    game_id: Mapped[int] = mapped_column(BigInteger())
    encounter_team_id: Mapped[int] = mapped_column(BigInteger(), primary_key=True)
    score: Mapped[int | None] = mapped_column(Integer(), nullable=True)
    placement: Mapped[int | None] = mapped_column(Integer(), nullable=True)
    column_values: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict, server_default=text("'{}'::jsonb"))
