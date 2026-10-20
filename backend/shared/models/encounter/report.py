"""A participation's report of the WHOLE encounter.

The series score lives in ``team_report_result`` rows -- one per participation -- so a lobby reports the
same way a duel does, and ``games_played`` counts draws. ``basis_version`` is
the ``encounter.result_version`` the report was made against.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import (
    JSON,
    BigInteger,
    CheckConstraint,
    Float,
    ForeignKey,
    ForeignKeyConstraint,
    Integer,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from shared.core import db
from shared.models.encounter.encounter import Encounter
from shared.models.identity.user import User

__all__ = ("EncounterTeamReport", "EncounterTeamReportResult")


class EncounterTeamReport(db.TimeStampIntegerMixin):
    __tablename__ = "team_report"
    __table_args__ = (
        UniqueConstraint("encounter_id", "encounter_team_id", name="uq_team_report_claimant"),
        #: Target of the results' composite FK.
        UniqueConstraint("id", "encounter_id", name="uq_team_report_id_encounter"),
        ForeignKeyConstraint(
            ["encounter_team_id", "encounter_id"],
            ["encounter.team.id", "encounter.team.encounter_id"],
            name="fk_team_report_team",
            deferrable=True,
            initially="DEFERRED",
        ),
        CheckConstraint("games_played IS NULL OR games_played >= 1", name="ck_team_report_games"),
        # Still valid with a nullable ``closeness``: a SQL CHECK passes on NULL.
        CheckConstraint("closeness BETWEEN 1 AND 10", name="ck_team_report_closeness"),
        {"schema": "encounter"},
    )

    encounter_id: Mapped[int] = mapped_column(ForeignKey(Encounter.id, ondelete="CASCADE"))
    encounter_team_id: Mapped[int] = mapped_column(BigInteger())
    # SET NULL so a deleted account leaves the report intact.
    reporter_user_id: Mapped[int | None] = mapped_column(ForeignKey(User.id, ondelete="SET NULL"), nullable=True)
    #: Draws included; NULL only on reports carried over by the migration.
    games_played: Mapped[int | None] = mapped_column(Integer(), nullable=True)
    basis_version: Mapped[int] = mapped_column(BigInteger())
    #: Nullable because the tournament's report form may disable the field.
    closeness: Mapped[int | None] = mapped_column(Integer(), nullable=True)
    comment: Mapped[str | None] = mapped_column(Text(), nullable=True)
    #: Organizer-defined answers, keyed by ``encounter_report_form`` field key.
    custom_fields_json: Mapped[dict[str, Any]] = mapped_column(JSON, server_default="{}", default=dict)


class EncounterTeamReportResult(db.Base):
    """One participation's numbers inside one series report."""

    __tablename__ = "team_report_result"
    __table_args__ = (
        ForeignKeyConstraint(
            ["report_id", "encounter_id"],
            ["encounter.team_report.id", "encounter.team_report.encounter_id"],
            ondelete="CASCADE",
            name="fk_report_result_report",
        ),
        ForeignKeyConstraint(
            ["encounter_team_id", "encounter_id"],
            ["encounter.team.id", "encounter.team.encounter_id"],
            name="fk_report_result_team",
            deferrable=True,
            initially="DEFERRED",
        ),
        CheckConstraint("score NOT IN ('NaN', 'Infinity', '-Infinity')", name="ck_report_result_score_finite"),
        CheckConstraint("placement IS NULL OR placement >= 1", name="ck_report_result_placement"),
        CheckConstraint("wins IS NULL OR wins >= 0", name="ck_report_result_wins"),
        {"schema": "encounter"},
    )

    report_id: Mapped[int] = mapped_column(BigInteger(), primary_key=True)
    encounter_id: Mapped[int] = mapped_column(BigInteger())
    encounter_team_id: Mapped[int] = mapped_column(BigInteger(), primary_key=True)
    #: The participation's total under the rule's formula.
    score: Mapped[float] = mapped_column(Float())
    placement: Mapped[int | None] = mapped_column(Integer(), nullable=True)
    #: Set when the formula counts wins.
    wins: Mapped[int | None] = mapped_column(Integer(), nullable=True)
