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
from src.core import enums

__all__ = ("Seat",)


class Seat:
    """One team's live participation, joined to its encounter.

    ``maps_won`` / ``maps_lost`` count maps from the confirmed games (``game_team``), so :meth:`join`
    keeps only two-seat encounters unless asked otherwise.
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

    def _games(self, *conditions: typing.Callable[[typing.Any], sa.ColumnElement[bool]]) -> sa.ColumnElement[int]:
        """How many confirmed games of this encounter this participation played and ``conditions`` hold for."""
        game_team = aliased(models.EncounterGameTeam)
        game = aliased(models.EncounterGame)
        return (
            sa.select(sa.func.count())
            .select_from(game_team)
            .join(game, game.id == game_team.game_id)
            .where(
                game_team.encounter_team_id == self.team.id,
                game.state == enums.EncounterGameState.CONFIRMED,
                *[condition(game_team) for condition in conditions],
            )
            .correlate(self.team)
            .scalar_subquery()
        )

    @property
    def _has_games(self) -> sa.ColumnElement[bool]:
        game = aliased(models.EncounterGame)
        return sa.exists(
            sa.select(1).where(
                game.encounter_id == self.team.encounter_id, game.state == enums.EncounterGameState.CONFIRMED
            )
        )

    @property
    def _series_only_wins(self) -> sa.ColumnElement[bool]:
        """The result is a ``wins``-preset series score: there, and only there, ``score`` counts maps."""
        return sa.exists(
            sa.select(1).where(
                models.ScoringRule.id == models.Encounter.scoring_rule_id, models.ScoringRule.preset == "wins"
            )
        )

    @property
    def maps_won(self) -> sa.ColumnElement[int]:
        """Maps this participation won: its first places in the confirmed games (``game_team``).

        A series with no game rows (an ``import``/``admin``/``series_claim`` result) falls back to its seat
        ``score`` -- but only under the ``wins`` preset, where the score IS the maps won. A points-preset
        score is never maps, so such an encounter contributes none.
        """

        def won(game_team: typing.Any) -> sa.ColumnElement[bool]:
            rival = aliased(models.EncounterGameTeam)
            return sa.and_(
                game_team.placement == 1,
                ~sa.exists(
                    sa.select(1).where(
                        rival.game_id == game_team.game_id,
                        rival.encounter_team_id != game_team.encounter_team_id,
                        rival.placement == 1,
                    )
                ),
            )

        return sa.case(
            (self._has_games, self._games(won)),
            (self._series_only_wins, sa.cast(self.team.score, sa.Integer)),
            else_=0,
        )

    @property
    def maps_lost(self) -> sa.ColumnElement[int]:
        """Maps this participation lost: its games placed below first, else (see :attr:`maps_won`) the
        other live seats' score under the ``wins`` preset."""
        others = self._others
        series_score = sa.cast(
            sa.select(sa.func.coalesce(sa.func.sum(others.score), 0))
            .where(others.encounter_id == self.team.encounter_id, others.active.is_(True), others.id != self.team.id)
            .correlate(self.team)
            .scalar_subquery(),
            sa.Integer,
        )
        return sa.case(
            (self._has_games, self._games(lambda game_team: game_team.placement > 1)),
            (self._series_only_wins, series_score),
            else_=0,
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
