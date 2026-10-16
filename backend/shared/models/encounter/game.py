"""One position of an encounter and what each participation did in it.

A ``StatsMatch`` (``stats.match``) is what a parsed log OBSERVED; ``EncounterGame``
is what the tournament DECIDED for position ``position``. A cancelled game keeps
its position as history and is never revived -- a replayed position is a new row
(D64).

``EncounterGameTeam`` carries both halves of "who is in this game": the side
drawn before it starts and the accepted numbers after it ends. One row per
active participation, written when the game is. It replaces
``accepted_home_score``/``accepted_away_score``, ``encounter_game_result`` and
``encounter_map_code``.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Enum,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from shared.core import db, enums
from shared.models.catalog.entity import CatalogEntity
from shared.models.encounter.encounter import Encounter

__all__ = (
    "EncounterGame",
    "EncounterGameTeam",
    "ENCOUNTER_GAME_STATE_ENUM",
    "ENCOUNTER_GAME_RESULT_SOURCE_ENUM",
)

ENCOUNTER_GAME_STATE_ENUM = Enum(
    enums.EncounterGameState,
    values_callable=lambda e: [x.value for x in e],
    name="encountergamestate",
    schema="encounter",
    create_type=False,
)
ENCOUNTER_GAME_RESULT_SOURCE_ENUM = Enum(
    enums.EncounterGameResultSource,
    values_callable=lambda e: [x.value for x in e],
    name="encountergameresultsource",
    schema="encounter",
    create_type=False,
)


class EncounterGame(db.TimeStampIntegerMixin):
    __tablename__ = "game"
    __table_args__ = (
        # A cancelled game keeps its position as history; the live series has at
        # most one game per position.
        Index(
            "uq_game_encounter_position",
            "encounter_id",
            "position",
            unique=True,
            postgresql_where=text("state != 'cancelled'"),
        ),
        #: Full, not partial: the cancelled history is read too.
        Index("ix_game_encounter_id", "encounter_id"),
        Index("ix_game_map_id", "map_id"),
        UniqueConstraint("id", "encounter_id", name="uq_game_id_encounter"),
        CheckConstraint("position >= 1", name="ck_game_position"),
        CheckConstraint("map_kind = 'map'", name="ck_game_map_kind"),
        ForeignKeyConstraint(
            ["map_id", "map_kind"],
            ["catalog.entity.id", "catalog.entity.kind"],
            ondelete="RESTRICT",
            name="fk_game_map",
        ),
        # confirmed => the whole accepted shape is present. Cancelled rows keep
        # whatever they had, which is why this is one-directional.
        CheckConstraint(
            "state != 'confirmed' OR (result_source IS NOT NULL AND confirmed_at IS NOT NULL)",
            name="ck_game_confirmed_shape",
        ),
        {"schema": "encounter"},
    )

    encounter_id: Mapped[int] = mapped_column(ForeignKey(Encounter.id, ondelete="CASCADE"))
    position: Mapped[int] = mapped_column(Integer())
    # RESTRICT, not CASCADE: deleting a catalog map must not silently erase a played position's identity.
    map_id: Mapped[int | None] = mapped_column(BigInteger(), nullable=True)
    #: Kind constant of the composite FK (spec §14.1): the database guarantees a game is played on a map.
    map_kind: Mapped[str] = mapped_column(String(16), default="map", server_default="map")
    state: Mapped[enums.EncounterGameState] = mapped_column(
        ENCOUNTER_GAME_STATE_ENUM,
        default=enums.EncounterGameState.PLANNED,
        server_default=enums.EncounterGameState.PLANNED.value,
    )
    result_source: Mapped[enums.EncounterGameResultSource | None] = mapped_column(
        ENCOUNTER_GAME_RESULT_SOURCE_ENUM, nullable=True
    )
    # Bumped on every accepted-result write (confirm, correction). Clients and
    # events compare it; it never decreases.
    result_version: Mapped[int] = mapped_column(Integer(), default=0, server_default="0")
    confirmed_at: Mapped[datetime | None] = mapped_column(db.DateTime(timezone=True), nullable=True)

    encounter: Mapped[Encounter] = relationship(back_populates="games")
    map: Mapped[CatalogEntity | None] = relationship(
        primaryjoin="foreign(EncounterGame.map_id) == CatalogEntity.id", viewonly=True
    )


class EncounterGameTeam(db.Base):
    """One participation's side and accepted result in one game."""

    __tablename__ = "game_team"
    __table_args__ = (
        # Two participations cannot start a game on the same side.
        Index(
            "uq_game_team_side",
            "game_id",
            "starting_side",
            unique=True,
            postgresql_where=text("starting_side IS NOT NULL"),
        ),
        Index("ix_game_team_team", "encounter_team_id"),
        # Both deferred: deleting an encounter removes the game, the
        # participation and this row in one statement, and an immediate check
        # would fire in the middle of that cascade.
        ForeignKeyConstraint(
            ["game_id", "encounter_id"],
            ["encounter.game.id", "encounter.game.encounter_id"],
            name="fk_game_team_game",
            deferrable=True,
            initially="DEFERRED",
        ),
        ForeignKeyConstraint(
            ["encounter_team_id", "encounter_id"],
            ["encounter.team.id", "encounter.team.encounter_id"],
            name="fk_game_team_team",
            deferrable=True,
            initially="DEFERRED",
        ),
        CheckConstraint("score IS NULL OR score >= 0", name="ck_game_team_score"),
        CheckConstraint("placement IS NULL OR placement >= 1", name="ck_game_team_placement"),
        CheckConstraint("jsonb_typeof(column_values) = 'object'", name="ck_game_team_values"),
        {"schema": "encounter"},
    )

    game_id: Mapped[int] = mapped_column(BigInteger(), primary_key=True)
    encounter_id: Mapped[int] = mapped_column(ForeignKey(Encounter.id, ondelete="CASCADE"))
    encounter_team_id: Mapped[int] = mapped_column(BigInteger(), primary_key=True)
    #: The game's raw score (map rounds); NULL for a game that has none.
    score: Mapped[int | None] = mapped_column(Integer(), nullable=True)
    #: Place in the game; NULL = derived from the game formula's points.
    placement: Mapped[int | None] = mapped_column(Integer(), nullable=True)
    #: The organizer's columns for this participation in this game; an absent
    #: key reads as 0.
    column_values: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict, server_default=text("'{}'::jsonb"))
    #: Discipline side code (§6); NULL when the discipline has no sides.
    starting_side: Mapped[str | None] = mapped_column(String(16), nullable=True)
    replay_code: Mapped[str | None] = mapped_column(String(32), nullable=True)
