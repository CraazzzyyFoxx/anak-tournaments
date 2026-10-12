"""A team's seat in an encounter, as SQL.

An encounter seats ``slot_count`` participations (``encounter.team``) and has no
sides. "The team played the encounter" is an ACTIVE participation carrying that
``team_id``; whether it won comes from ``placement`` (a shared first place is a
draw, not a win) and the series score it earned from ``score`` -- under the
``wins`` preset the number of maps it won.

Pure SQLAlchemy builders: every read model that used to join an encounter on
``home_team_id`` / ``away_team_id`` joins its seat instead.
"""

from __future__ import annotations

import typing

import sqlalchemy as sa
from sqlalchemy.orm import aliased

from src import models

__all__ = ("Seat",)


class Seat:
    """One team's live participation, joined to its encounter.

    ``maps_won`` / ``maps_lost`` read the series score, so :meth:`join` keeps only
    two-seat encounters unless asked otherwise: a lobby's ``score`` is points under
    the stage's formula, and "the other seats' points" are not maps lost.
    """

    def __init__(self, name: str = "seat") -> None:
        self._name = name
        self.team = aliased(models.EncounterTeam, name=name)
        self._others = aliased(models.EncounterTeam, name=f"{name}_others")

    def join(self, query: sa.Select, team_id_column: typing.Any, *, duel: bool = True) -> sa.Select:
        """Join the seat of ``team_id_column`` and then its encounter onto ``query``."""
        encounter_on = models.Encounter.id == self.team.encounter_id
        if duel:
            encounter_on = sa.and_(encounter_on, models.Encounter.slot_count == 2)
        return query.join(self.team, sa.and_(self.team.team_id == team_id_column, self.team.active.is_(True))).join(
            models.Encounter, encounter_on
        )

    @property
    def maps_won(self) -> sa.ColumnElement[int]:
        return sa.cast(self.team.score, sa.Integer)

    @property
    def maps_lost(self) -> sa.ColumnElement[int]:
        """What the other live seats scored (the opponent, in a duel)."""
        others = self._others
        return sa.cast(
            sa.select(sa.func.coalesce(sa.func.sum(others.score), 0))
            .where(others.encounter_id == self.team.encounter_id, others.active.is_(True), others.id != self.team.id)
            .correlate(self.team)
            .scalar_subquery(),
            sa.Integer,
        )

    @property
    def shared_first(self) -> sa.ColumnElement[bool]:
        """Another live seat holds first place too."""
        others = aliased(models.EncounterTeam, name=f"{self._name}_first")
        return sa.exists(
            sa.select(1)
            .where(
                others.encounter_id == self.team.encounter_id,
                others.active.is_(True),
                others.id != self.team.id,
                others.placement == 1,
            )
            .correlate(self.team)
        )

    @property
    def won(self) -> sa.ColumnElement[bool]:
        return sa.and_(self.team.placement == 1, ~self.shared_first)

    @property
    def drew(self) -> sa.ColumnElement[bool]:
        return sa.and_(self.team.placement == 1, self.shared_first)

    @property
    def lost(self) -> sa.ColumnElement[bool]:
        return self.team.placement > 1

    def count(self, outcome: sa.ColumnElement[bool]) -> sa.ColumnElement[int]:
        """``1`` when ``outcome`` holds, else ``0`` -- for ``SUM`` over encounters."""
        return sa.case((outcome, 1), else_=0)
