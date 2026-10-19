"""Statistics SQL bound to one discipline's native facts.

Every stat reader of the user/hero/statistics surfaces reads ``player_facts``/``match_context`` of exactly one game.
That game is the request's (or the owning tournament's) ``discipline`` and is fixed at construction, never a module
default: ``Queries.of("lol")`` can only ever see League facts, and a game that declares none reads as empty.
"""

from __future__ import annotations

import functools
import typing

import sqlalchemy as sa

from shared.repository.stats_queries import match_context, player_facts
from shared.repository.stats_reads import duel_matches

__all__ = ("DisciplineQueries",)


class DisciplineQueries:
    """Base of the query classes: ``self._facts`` / ``self._matches`` / ``self._duels`` of ``discipline``.

    ``DisciplineQueries()`` (no discipline) is for the few methods that touch no game data (user lookups by id or
    name); reading the fact subqueries of such an instance is a programming error and raises.
    """

    def __init__(self, discipline: str | None = None) -> None:
        self._discipline = discipline

    @classmethod
    @functools.cache
    def of(cls, discipline: str | None) -> typing.Self:
        """The shared instance for ``discipline`` (the subqueries are built once per game)."""
        return cls(discipline)

    @property
    def discipline(self) -> str:
        if self._discipline is None:
            raise RuntimeError(f"{type(self).__name__} is not bound to a discipline")
        return self._discipline

    @functools.cached_property
    def _facts(self) -> sa.Subquery:
        return player_facts(discipline=self.discipline)

    @functools.cached_property
    def _matches(self) -> sa.Subquery:
        return match_context(discipline=self.discipline)

    @functools.cached_property
    def _duels(self) -> sa.Subquery:
        return duel_matches(discipline=self.discipline)
