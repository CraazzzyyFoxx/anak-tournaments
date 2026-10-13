"""Scores of the maps whose match log carries no result.

The Workshop log writes ``match_end`` and ``round_end`` of a Push (and Clash)
map as 0:0 whoever won, and nothing else in the log names the winner. So the
log is never trusted for these modes: the score comes from the tournament's
accepted result for that map, or -- when there is none -- by exclusion from the
completed series score and the other maps' logged results. Anything that cannot
be decided exactly stays 0:0; nothing is guessed.

The tournament side speaks participations: a map's accepted numbers are
``encounter.game_team.score`` per ``encounter_team_id``, and the series total is
``encounter.team.score``. The log side still speaks ``matches.match``'s
``home_team_id``/``home_score``/``away_score`` columns, which are a log's own
orientation and are not changing -- so the answer is returned in that
orientation, and the mapping between the two is the participation's source
``team_id``.

Exclusion is a two-sided argument ("the wins left over must land somewhere"),
so an encounter that does not seat exactly two participations decides nothing.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Mapping, Sequence
from dataclasses import dataclass

__all__ = (
    "OBJECTIVELESS_GAMEMODES",
    "AcceptedGame",
    "LoggedMap",
    "Series",
    "resolve_scores",
)

#: Gamemode slugs whose log ``match_end`` is always 0:0.
OBJECTIVELESS_GAMEMODES = frozenset({"push", "clash"})

UNKNOWN = (0, 0)


@dataclass(frozen=True)
class Series:
    """One encounter, as its active participations."""

    #: ``encounter_team_id -> source tournament team id``; NULL once the source
    #: team is deleted, which simply means no log can be matched to that seat.
    teams: Mapping[int, int | None]
    completed: bool
    #: ``encounter.team.score`` per participation -- wins, under the ``wins`` preset.
    scores: Mapping[int, float]


@dataclass(frozen=True)
class LoggedMap:
    """One ``matches.match`` row; scores in the row's own (log) orientation."""

    match_id: int
    map_id: int
    home_team_id: int
    home_score: int
    away_score: int
    objectiveless: bool


@dataclass(frozen=True)
class AcceptedGame:
    """A confirmed ``encounter.game``, as its ``game_team`` rows."""

    map_id: int | None
    #: ``encounter.game_team.score`` per participation. A seat with no number
    #: entered leaves the game undecided.
    scores: Mapping[int, int | None]


def resolve_scores(
    series: Series, maps: Sequence[LoggedMap], games: Sequence[AcceptedGame]
) -> dict[int, tuple[int, int]]:
    """``match_id -> (home, away)`` in the match's orientation, for every
    objectiveless map; ``(0, 0)`` where the result cannot be decided."""
    objectiveless = {m.match_id: UNKNOWN for m in maps if m.objectiveless}
    if len(series.teams) != 2:
        return objectiveless
    first, second = sorted(series.teams)

    # Which way round the log listed the two seats. A log naming neither seat's
    # source team cannot be oriented at all.
    flipped: dict[int, bool] = {}
    for m in maps:
        if series.teams[first] is not None and m.home_team_id == series.teams[first]:
            flipped[m.match_id] = False
        elif series.teams[second] is not None and m.home_team_id == series.teams[second]:
            flipped[m.match_id] = True

    def orient(m: LoggedMap, score: tuple[int, int]) -> tuple[int, int]:
        return (score[1], score[0]) if flipped[m.match_id] else score

    # A map the series played twice lands on one match row: which play it is
    # cannot be told, so neither game decides it.
    plays = Counter(game.map_id for game in games)
    accepted: dict[int, tuple[int, int]] = {}
    for game in games:
        if game.map_id is None or plays[game.map_id] != 1:
            continue
        ours, theirs = game.scores.get(first), game.scores.get(second)
        if ours is None or theirs is None:
            continue
        accepted[game.map_id] = (ours, theirs)

    resolved: dict[int, tuple[int, int]] = {}
    unknown: list[LoggedMap] = []
    for m in maps:
        if not m.objectiveless:
            continue
        if m.match_id in flipped and m.map_id in accepted:
            resolved[m.match_id] = orient(m, accepted[m.map_id])
        else:
            unknown.append(m)

    # Exclusion counts every map's winner, so every map must be oriented.
    if unknown and series.completed and len(flipped) == len(maps):
        unknown_ids = {m.match_id for m in unknown}
        # Encounter-oriented scores of every map whose result is known.
        known = [
            orient(m, resolved.get(m.match_id, (m.home_score, m.away_score)))
            for m in maps
            if m.match_id not in unknown_ids
        ]
        winners = _by_exclusion(
            (series.scores.get(first, 0.0), series.scores.get(second, 0.0)),
            known,
            len(unknown),
            played=len(games) or None,
        )
        if winners is not None:
            for m in unknown:
                resolved[m.match_id] = orient(m, winners)

    return {match_id: resolved.get(match_id, UNKNOWN) for match_id in objectiveless}


def _by_exclusion(
    series_scores: tuple[float, float],
    known: Sequence[tuple[int, int]],
    unknown: int,
    *,
    played: int | None,
) -> tuple[int, int] | None:
    """The one score every unknown map must have, or ``None`` if it is not forced.

    ``played`` is the number of games the series accepted, when it tracked
    games at all; a log count that differs means a log is missing.
    """
    if played is not None and played != len(known) + unknown:
        return None
    first_left = series_scores[0] - sum(1 for first, second in known if first > second)
    second_left = series_scores[1] - sum(1 for first, second in known if second > first)
    # Wins left over must account for every unknown map exactly: fewer means a
    # draw somewhere (or a missing log), more means a log is missing.
    if first_left < 0 or second_left < 0 or first_left + second_left != unknown:
        return None
    # Both sides still owed wins over several maps: which map is whose is open.
    if first_left and second_left:
        return None
    return (1, 0) if first_left else (0, 1)
