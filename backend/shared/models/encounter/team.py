"""Participation: one seat of one encounter, and the roster behind it (D55).

A participation is append-only. Replacing an occupant writes a NEW row and sets
the old one ``active = false``; nothing ever flips it back, and nothing ever
deletes it on its own -- the games it played, the claims it filed and the
journal all point here, which is what makes "who played this" answerable after
a slot changes hands. ``team_id`` is the *source* tournament team and may go
NULL when that team is deleted; ``name`` is the snapshot that survives it.
"""

from __future__ import annotations

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Float,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from shared.core import db
from shared.models.encounter.encounter import Encounter

__all__ = ("EncounterTeam", "EncounterTeamMember", "EncounterTeamMemberRole")


class EncounterTeam(db.TimeStampIntegerMixin):
    __tablename__ = "team"
    __table_args__ = (
        # One occupant per slot and one participation per source team, among the
        # ACTIVE rows only -- the replaced ones stay as history.
        Index("uq_team_active_slot", "encounter_id", "slot", unique=True, postgresql_where=text("active")),
        Index(
            "uq_team_active_source",
            "encounter_id",
            "team_id",
            unique=True,
            postgresql_where=text("active AND team_id IS NOT NULL"),
        ),
        #: "every encounter of this team", in place of the old home/away indexes.
        Index("ix_team_team_id", "team_id"),
        UniqueConstraint("id", "encounter_id", name="uq_team_id_encounter"),
        # Target of ``fk_team_member_team``: the roster's ``active`` rides along
        # with this row's through ON UPDATE CASCADE.
        UniqueConstraint("id", "encounter_id", "active", name="uq_team_id_encounter_active"),
        ForeignKeyConstraint(
            ["encounter_id", "tournament_id"],
            ["encounter.encounter.id", "encounter.encounter.tournament_id"],
            ondelete="CASCADE",
            name="fk_team_encounter_tournament",
        ),
        # Deleting the source team empties the pointer and keeps the
        # participation, its games and its roster (§13.3, behavioral change).
        ForeignKeyConstraint(
            ["team_id", "tournament_id"],
            ["tournament.team.id", "tournament.team.tournament_id"],
            ondelete="SET NULL (team_id)",
            name="fk_team_source",
        ),
        CheckConstraint("slot >= 1", name="ck_team_slot"),
        CheckConstraint("placement IS NULL OR placement >= 1", name="ck_team_placement"),
        CheckConstraint("score NOT IN ('NaN', 'Infinity', '-Infinity')", name="ck_team_score_finite"),
        {"schema": "encounter"},
    )

    encounter_id: Mapped[int] = mapped_column(ForeignKey(Encounter.id, ondelete="CASCADE"))
    #: Copy of the encounter's owner, so the source team can be checked against
    #: the same tournament (V2: NULL for mixes and scrims).
    tournament_id: Mapped[int | None] = mapped_column(BigInteger(), nullable=True)
    #: ``1..encounter.slot_count``; the participation writer checks the range.
    slot: Mapped[int] = mapped_column(Integer())
    #: The source ``tournament.team``; NULL when there is no roster behind the
    #: seat, or when the source team has been deleted.
    team_id: Mapped[int | None] = mapped_column(BigInteger(), nullable=True)
    name: Mapped[str] = mapped_column(String(255))
    seed: Mapped[int | None] = mapped_column(Integer(), nullable=True)
    active: Mapped[bool] = mapped_column(Boolean(), default=True, server_default="true")
    #: The materialized result inside the encounter (D53, D60): under the
    #: ``wins`` preset this is the number of games won.
    score: Mapped[float] = mapped_column(Float(), default=0.0, server_default="0")
    #: Place inside the encounter; NULL while there is no result.
    placement: Mapped[int | None] = mapped_column(Integer(), nullable=True)

    encounter: Mapped[Encounter] = relationship(back_populates="teams", foreign_keys=[encounter_id])


class EncounterTeamMember(db.TimeStampIntegerMixin):
    """The roster of one participation, snapshotted (D27, D40, D49, D56, D66).

    ``active`` is a copy of the participation's, carried by the composite FK's
    ``ON UPDATE CASCADE`` -- that is what lets a partial unique index say "one
    active seat per member per encounter" without a trigger (A2).
    """

    __tablename__ = "team_member"
    __table_args__ = (
        Index(
            "uq_team_member_active_member",
            "encounter_id",
            "workspace_member_id",
            unique=True,
            postgresql_where=text("active"),
        ),
        Index("ix_team_member_workspace_member_id", "workspace_member_id"),
        UniqueConstraint("encounter_team_id", "workspace_member_id", name="uq_team_member_member"),
        ForeignKeyConstraint(
            ["encounter_team_id", "encounter_id", "active"],
            ["encounter.team.id", "encounter.team.encounter_id", "encounter.team.active"],
            onupdate="CASCADE",
            name="fk_team_member_team",
            deferrable=True,
            initially="DEFERRED",
        ),
        {"schema": "encounter"},
    )

    encounter_id: Mapped[int] = mapped_column(ForeignKey(Encounter.id, ondelete="CASCADE"))
    encounter_team_id: Mapped[int] = mapped_column(BigInteger())
    active: Mapped[bool] = mapped_column(Boolean())
    # NO ACTION, deferred: the workspace member is the anchor a roster snapshot
    # is written against and must not be deleted out from under it (D66) --
    # ``remove_member`` sets ``removed_at`` instead. Deferred so deleting the
    # whole workspace, which removes both sides at once, still works.
    workspace_member_id: Mapped[int] = mapped_column(
        ForeignKey("workspace_member.id", name="fk_team_member_workspace_member", deferrable=True, initially="DEFERRED")
    )
    display_name_snapshot: Mapped[str] = mapped_column(String(255))
    #: Rank snapshot taken on the member's rating role.
    rank: Mapped[int | None] = mapped_column(Integer(), nullable=True)
    is_substitute: Mapped[bool] = mapped_column(Boolean(), default=False, server_default="false")


class EncounterTeamMemberRole(db.Base):
    """A roster member's role, per dimension (D36, D67).

    Codes are plain strings; the FK to the role ontology arrives in V3. For
    Overwatch the dimension is ``player_role`` and a sub-role is a second row.
    """

    __tablename__ = "team_member_role"
    __table_args__ = ({"schema": "encounter"},)

    team_member_id: Mapped[int] = mapped_column(
        ForeignKey(EncounterTeamMember.id, ondelete="CASCADE"), primary_key=True
    )
    dimension: Mapped[str] = mapped_column(String(32), primary_key=True)
    role: Mapped[str] = mapped_column(String(64), primary_key=True)
