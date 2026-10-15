"""Team formats (D35, D88; spec §14.3): a workspace's default per discipline, a tournament's copy, a mix's frozen copy.

The children are written by ``TeamFormatRepository.save`` as a whole (delete, then insert), so the ORM collections
are read-only views: ``dimensions`` with each dimension's code, ``rules`` with each role's code.
"""

from __future__ import annotations

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
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
from shared.models.catalog.role import CatalogRole, RoleDimension

__all__ = ("RosterFormatRoleRule", "RosterTeamFormat", "RosterTeamFormatDimension")


class RosterTeamFormat(db.TimeStampIntegerMixin):
    __tablename__ = "team_format"
    __table_args__ = (
        CheckConstraint("num_nonnulls(tournament_id, custom_game_id) <= 1", name="ck_team_format_owner"),
        CheckConstraint(
            "1 <= starter_min AND starter_min <= starter_max AND 0 <= substitute_min AND substitute_min <= substitute_max",
            name="ck_team_format_sizes",
        ),
        UniqueConstraint("id", "discipline", name="uq_team_format_key"),
        UniqueConstraint("tournament_id", name="uq_team_format_tournament"),
        UniqueConstraint("custom_game_id", name="uq_team_format_custom_game"),
        ForeignKeyConstraint(
            ["tournament_id", "workspace_id", "discipline"],
            ["tournament.tournament.id", "tournament.tournament.workspace_id", "tournament.tournament.discipline"],
            ondelete="CASCADE",
            name="fk_team_format_tournament",
        ),
        ForeignKeyConstraint(
            ["custom_game_id", "workspace_id", "discipline"],
            ["balancer.custom_game.id", "balancer.custom_game.workspace_id", "balancer.custom_game.discipline"],
            ondelete="CASCADE",
            name="fk_team_format_custom_game",
        ),
        Index(
            "uq_team_format_workspace_default",
            "workspace_id",
            "discipline",
            unique=True,
            postgresql_where=text("tournament_id IS NULL AND custom_game_id IS NULL"),
        ),
        {"schema": "roster"},
    )

    workspace_id: Mapped[int] = mapped_column(
        ForeignKey("workspace.id", ondelete="CASCADE", name="fk_team_format_workspace")
    )
    discipline: Mapped[str] = mapped_column(
        String(32), ForeignKey("catalog.discipline.code", name="fk_team_format_discipline")
    )
    tournament_id: Mapped[int | None] = mapped_column(BigInteger(), nullable=True)
    custom_game_id: Mapped[int | None] = mapped_column(BigInteger(), nullable=True)
    #: Which module preset this was copied from; informational only (D88).
    preset_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    name: Mapped[str] = mapped_column(String(128))
    starter_min: Mapped[int] = mapped_column(Integer())
    starter_max: Mapped[int] = mapped_column(Integer())
    substitute_min: Mapped[int] = mapped_column(Integer(), default=0, server_default=text("0"))
    substitute_max: Mapped[int] = mapped_column(Integer(), default=0, server_default=text("0"))

    dimensions: Mapped[list[RosterTeamFormatDimension]] = relationship(
        primaryjoin="foreign(RosterTeamFormatDimension.team_format_id) == RosterTeamFormat.id",
        viewonly=True,
        lazy="selectin",
    )
    rules: Mapped[list[RosterFormatRoleRule]] = relationship(
        primaryjoin="foreign(RosterFormatRoleRule.team_format_id) == RosterTeamFormat.id",
        viewonly=True,
        lazy="selectin",
    )


class RosterTeamFormatDimension(db.Base):
    __tablename__ = "team_format_dimension"
    __table_args__ = (
        CheckConstraint("mode IN ('off', 'informational', 'preference', 'enforced')", name="ck_tfd_mode"),
        CheckConstraint(
            "player_min_assignments IS NULL OR player_max_assignments IS NULL"
            " OR player_min_assignments <= player_max_assignments",
            name="ck_tfd_assignments",
        ),
        ForeignKeyConstraint(
            ["team_format_id", "discipline"],
            ["roster.team_format.id", "roster.team_format.discipline"],
            ondelete="CASCADE",
            name="fk_tfd_format",
        ),
        ForeignKeyConstraint(
            ["dimension_id", "discipline"],
            ["catalog.role_dimension.id", "catalog.role_dimension.discipline"],
            name="fk_tfd_dimension",
        ),
        {"schema": "roster"},
    )

    team_format_id: Mapped[int] = mapped_column(BigInteger(), primary_key=True, autoincrement=False)
    discipline: Mapped[str] = mapped_column(String(32))
    dimension_id: Mapped[int] = mapped_column(BigInteger(), primary_key=True, autoincrement=False)
    mode: Mapped[str] = mapped_column(String(16))
    player_min_assignments: Mapped[int | None] = mapped_column(Integer(), nullable=True)
    player_max_assignments: Mapped[int | None] = mapped_column(Integer(), nullable=True)

    dimension: Mapped[RoleDimension] = relationship(
        primaryjoin="foreign(RosterTeamFormatDimension.dimension_id) == RoleDimension.id", viewonly=True, lazy="joined"
    )


class RosterFormatRoleRule(db.Base):
    __tablename__ = "format_role_rule"
    __table_args__ = (
        ForeignKeyConstraint(
            ["team_format_id", "dimension_id"],
            ["roster.team_format_dimension.team_format_id", "roster.team_format_dimension.dimension_id"],
            ondelete="CASCADE",
            name="fk_frr_dimension",
        ),
        ForeignKeyConstraint(
            ["role_id", "dimension_id"], ["catalog.role.id", "catalog.role.dimension_id"], name="fk_frr_role"
        ),
        CheckConstraint(
            "hard_min >= 0 AND hard_max >= 0 AND recommended_min >= 0 AND recommended_max >= 0",
            name="ck_frr_nonnegative",
        ),
        CheckConstraint("hard_min IS NULL OR hard_max IS NULL OR hard_min <= hard_max", name="ck_frr_hard"),
        CheckConstraint(
            "recommended_min IS NULL OR recommended_max IS NULL OR recommended_min <= recommended_max",
            name="ck_frr_recommended",
        ),
        {"schema": "roster"},
    )

    team_format_id: Mapped[int] = mapped_column(BigInteger(), primary_key=True, autoincrement=False)
    dimension_id: Mapped[int] = mapped_column(BigInteger())
    role_id: Mapped[int] = mapped_column(BigInteger(), primary_key=True, autoincrement=False)
    hard_min: Mapped[int | None] = mapped_column(Integer(), nullable=True)
    hard_max: Mapped[int | None] = mapped_column(Integer(), nullable=True)
    recommended_min: Mapped[int | None] = mapped_column(Integer(), nullable=True)
    recommended_max: Mapped[int | None] = mapped_column(Integer(), nullable=True)
    include_descendants: Mapped[bool] = mapped_column(Boolean(), default=True, server_default=text("true"))

    role: Mapped[CatalogRole] = relationship(
        primaryjoin="foreign(RosterFormatRoleRule.role_id) == CatalogRole.id", viewonly=True, lazy="joined"
    )
