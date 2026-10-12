"""A two-seat encounter, read through its active participations.

An encounter seats ``slot_count`` participations (``encounter.team``) and has no
sides, so a series result is whatever the seats say: ``score`` is the
materialised total inside the encounter (maps won, under the ``wins`` preset)
and ``placement`` is the place it earned. The achievement nodes that talk about
"the winner" or "the beaten roster" of a series read the seats in slot order;
an encounter that does not seat exactly two active participations is not a duel
and never joins.

Pure SQLAlchemy builders, like :mod:`src.domain.achievement_stage_filters`.
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.orm import aliased

from src import models

__all__ = ("Duel", "active_seat", "series_total")


def series_total(encounter=models.Encounter) -> sa.ColumnElement[float]:
    """The sum of every active seat's ``score`` -- the denominator of a winrate."""
    seat = aliased(models.EncounterTeam)
    return (
        sa.select(sa.func.sum(seat.score))
        .where(seat.encounter_id == encounter.id, seat.active.is_(True))
        .scalar_subquery()
    )


def active_seat(encounter=models.Encounter, *, name: str = "seat"):  # noqa: ANN201
    """``(seat, onclause)``: join ``seat`` to read every live participation of the encounter."""
    seat = aliased(models.EncounterTeam, name=name)
    return seat, sa.and_(seat.encounter_id == encounter.id, seat.active.is_(True))


class Duel:
    """``first`` and ``second`` are the active participations of slots 1 and 2."""

    def __init__(self, encounter=models.Encounter, *, name: str = "duel") -> None:
        self.encounter = encounter
        self.first = aliased(models.EncounterTeam, name=f"{name}_first")
        self.second = aliased(models.EncounterTeam, name=f"{name}_second")

    def join(self, query: sa.Select) -> sa.Select:
        """Join both seats onto a query that already selects from the encounter."""
        for seat, slot in ((self.first, 1), (self.second, 2)):
            query = query.join(
                seat,
                sa.and_(seat.encounter_id == self.encounter.id, seat.slot == slot, seat.active.is_(True)),
            )
        return query

    @property
    def decided(self) -> sa.ColumnElement[bool]:
        """One seat placed ahead of the other; a shared place is a draw, and a draw has no winner."""
        return sa.and_(
            self.first.placement.is_not(None),
            self.second.placement.is_not(None),
            self.first.placement != self.second.placement,
        )

    @property
    def first_won(self) -> sa.ColumnElement[bool]:
        return self.first.placement < self.second.placement

    @property
    def winner_team_id(self) -> sa.ColumnElement[int]:
        """Source team of the seat that placed ahead (meaningful once ``decided``)."""
        return sa.case((self.first_won, self.first.team_id), else_=self.second.team_id)

    @property
    def loser_team_id(self) -> sa.ColumnElement[int]:
        return sa.case((self.first_won, self.second.team_id), else_=self.first.team_id)

    @property
    def winner_score(self) -> sa.ColumnElement[float]:
        return sa.case((self.first_won, self.first.score), else_=self.second.score)

    @property
    def loser_score(self) -> sa.ColumnElement[float]:
        return sa.case((self.first_won, self.second.score), else_=self.first.score)

    @property
    def margin(self) -> sa.ColumnElement[float]:
        return sa.func.abs(self.first.score - self.second.score)
