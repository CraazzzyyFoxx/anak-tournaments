import types
import typing
from collections import defaultdict
from collections.abc import Callable
from dataclasses import dataclass, field

import sqlalchemy as sa
from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from sqlalchemy.orm.strategy_options import _AbstractLoad

from shared.core import enums
from shared.core.enums import StageType
from shared.domain.encounter_scoring import GameLine, ScoringRules, TeamTotals, compile_rules, team_totals
from shared.domain.tournament_utils import (
    completed_encounters as _shared_completed_encounters,
)
from shared.domain.tournament_utils import (
    completed_encounters_in_finished_rounds as _shared_completed_encounters_in_finished_rounds,
)
from shared.domain.tournament_utils import is_completed_encounter, sort_bracket_matches
from shared.repository import EncounterRepository, StandingRepository, TeamRepository, TournamentRepository
from shared.services.bracket.swiss_state import bye_counts_by_scope, stopped_scopes
from src import models, schemas
from src.core import utils
from src.services.encounter.ffa import ffa_encounter_service

GROUP_STAGE_TYPES = {StageType.ROUND_ROBIN, StageType.SWISS}
ELIMINATION_STAGE_TYPES = {
    StageType.SINGLE_ELIMINATION,
    StageType.DOUBLE_ELIMINATION,
}
FFA_STAGE_TYPES = {StageType.FFA_LEAGUE}
DEFAULT_STAGE_MAX_ROUNDS = 5

RULE_PRESET_DEFAULTS: dict[str, list[str]] = {
    "challonge_round_robin": [
        "points",
        "head_to_head",
        "median_buchholz",
        "match_wins",
        "score_differential",
    ],
    "challonge_swiss": [
        "points",
        "median_buchholz",
        "buchholz",
        "match_wins",
        "score_differential",
    ],
    "bracket_default": [
        "points",
        "head_to_head",
        "median_buchholz",
        "score_differential",
        "match_wins",
    ],
    # The stage's own headline column is spliced in by ``_tiebreak_order``: it
    # is not a fixed metric name, it depends on what the organizer configured.
    "ffa_default": [
        "points",
        "ffa_game_wins",
        "ffa_last_placement",
    ],
}

#: A tiebreak by the sum of one stage column: ``ffa_stat:kills``. The key after
#: the prefix is an organizer's column key, so it is validated against the
#: stage, not against a fixed list.
FFA_STAT_PREFIX = "ffa_stat:"


#: Every metric ``_metric_value`` can actually score. A stage's configured order
#: is filtered against this: an unknown string would silently rank every team
#: equal (``return 0``), which reads as "the tiebreaker did nothing" instead of
#: "the tiebreaker does not exist".
KNOWN_TIEBREAK_METRICS = frozenset(
    {
        "points",
        "match_wins",
        "head_to_head",
        "buchholz",
        "median_buchholz",
        "score_differential",
        "map_differential",
        "wins_as_higher_stage_specific_metric",
        "ffa_game_wins",
        "ffa_best_placement",
        "ffa_last_placement",
    }
)


@dataclass
class RankedStageTeam:
    team_id: int
    matches: int = 0
    wins: int = 0
    draws: int = 0
    loses: int = 0
    points: float = 0.0
    opponents: list[int] = field(default_factory=list)
    buchholz: float = 0.0
    median_buchholz: float = 0.0
    head_to_head: int = 0
    score_differential: int = 0
    #: FFA only: every stage column summed, already oriented so that more is
    #: better (plan §5.4), plus the placement metrics below.
    ffa_stats: dict[str, float] = field(default_factory=dict)
    ffa_best_placement: int | None = None
    ffa_last_placement: int | None = None
    #: Position of the head of this team's tie cluster, ``None`` when it is not
    #: tied. Teams sharing a value were equal on every configured metric; their
    #: relative order is the team-id fallback, not earned. A pinned team is never
    #: in a cluster: its place was decided, not tied.
    tie_group: int | None = None


def _entity_requested(in_entities: list[str], entity: str) -> bool:
    return entity in in_entities or any(item.startswith(f"{entity}.") for item in in_entities)


def standing_entities(in_entities: list[str]) -> list[_AbstractLoad]:
    entities: list[_AbstractLoad] = []
    stage_entity = sa.orm.selectinload(models.Standing.stage)
    stage_item_entity = sa.orm.selectinload(models.Standing.stage_item)
    entities.append(stage_entity)
    entities.append(stage_item_entity)

    if "tournament" in in_entities:
        entities.append(sa.orm.selectinload(models.Standing.tournament))
    if _entity_requested(in_entities, "team"):
        team_entity = sa.orm.selectinload(models.Standing.team)
        entities.append(team_entity)
        entities.extend(TeamRepository.team_entities(utils.prepare_entities(in_entities, "team"), team_entity))
    return entities


@dataclass(frozen=True, slots=True)
class Seat:
    """One participation as the stage table reads it (D55)."""

    team_id: int
    slot: int
    score: float
    placement: int | None


@dataclass(frozen=True, slots=True)
class StageEncounter:
    """One encounter of a stage, flattened for the ranking engine.

    Everything the engine used to read off the ``tournament.encounter`` row and
    cannot any more: the bracket position lives in
    ``tournament.bracket_encounter`` (D22) and the result on the participations
    (D53, D60). Assembled once by :meth:`StandingsService.load_stage_encounters`
    so the ranking below stays a pure function of plain data -- which is also
    what lets the Swiss pairing preview and the tests build one by hand.
    """

    id: int
    round: int
    stage_id: int | None
    stage_item_id: int | None
    completed: bool
    #: The LIVE seats, in slot order.
    seats: tuple[Seat, ...]

    @property
    def is_duel(self) -> bool:
        """Two seats: the only shape ``score_differential`` and head-to-head
        are defined for (plan §5). A wider encounter is not given an invented
        home side so the metric can be computed anyway."""
        return len(self.seats) == 2

    def places(self) -> dict[int, int]:
        """Each seat's place, best first, equal results sharing a place.

        ``encounter.team.placement`` is what the single result writer decided,
        so it is the answer whenever it is there. A completed encounter without
        one -- a Challonge import of a row nobody re-scored -- falls back to
        competition ranking by score, which is the same rule the engine's own
        ``_rank`` applies.
        """
        if self.seats and all(seat.placement is not None for seat in self.seats):
            return {seat.team_id: typing.cast(int, seat.placement) for seat in self.seats}
        places: dict[int, int] = {}
        place, previous = 0, None
        for index, seat in enumerate(sorted(self.seats, key=lambda one: (-one.score, one.slot)), 1):
            if seat.score != previous:
                place, previous = index, seat.score
            places[seat.team_id] = place
        return places

    def winner(self) -> int | None:
        """The team that finished alone in first, or ``None`` for a draw."""
        firsts = [team_id for team_id, place in self.places().items() if place == 1]
        return firsts[0] if len(firsts) == 1 else None

    @property
    def status(self) -> enums.EncounterStatus:
        """What ``shared.domain.tournament_utils`` asks of an encounter.

        Those helpers are the ONE definition of "counts toward standings" and
        of "is this round closed"; they read ``.status`` and ``.id``, so the
        flattened row answers both rather than forking the predicate here.
        """
        return enums.EncounterStatus.COMPLETED if self.completed else enums.EncounterStatus.OPEN


def _rounds(encounters: typing.Sequence[StageEncounter]) -> dict[int, int]:
    """The playable set keyed by id, as ``shared.domain.tournament_utils`` wants
    it: an encounter with an empty seat is not playable and is left out."""
    return {
        encounter.id: encounter.round
        for encounter in encounters
        if all(seat.team_id is not None for seat in encounter.seats) and encounter.seats
    }


def _completed_encounters(
    encounters: typing.Sequence[StageEncounter],
) -> list[StageEncounter]:
    """Phase E: delegate to shared predicate to avoid drift between services."""
    return _shared_completed_encounters(encounters)


def _completed_encounters_in_finished_rounds(
    encounters: typing.Sequence[StageEncounter],
) -> list[StageEncounter]:
    """Ignore partially completed playable rounds for standings purposes."""
    return _shared_completed_encounters_in_finished_rounds(encounters, _rounds(encounters))


def _assign_final_round_placements(
    encounters: typing.Sequence[StageEncounter],
    data: dict[int, dict[str, float | int]],
) -> None:
    """Hand out 1st/2nd from the bracket's structural final round.

    The final is the highest positive round that *exists*, not the highest one
    already played: the latter hands out two firsts and two seconds the moment
    both semi-finals are done while the final is still open. Placements are
    assigned only once every encounter of that round is completed. For double
    elimination the lazily created Grand Final Reset lands in GF+1 and so
    becomes the final as soon as it exists.
    """
    positive = [encounter for encounter in encounters if encounter.round > 0]
    if not positive:
        return
    final_round = max(encounter.round for encounter in positive)
    final_matches = [encounter for encounter in positive if encounter.round == final_round]
    if not all(is_completed_encounter(encounter) for encounter in final_matches):
        return
    for match in final_matches:
        winner = match.winner()
        if winner is None:
            continue
        data[winner]["placement"] = 1
        for seat in match.seats:
            if seat.team_id != winner:
                data[seat.team_id]["placement"] = 2


def _stage_max_rounds(stage: models.Stage) -> int:
    raw_value = getattr(stage, "max_rounds", DEFAULT_STAGE_MAX_ROUNDS)
    try:
        value = int(raw_value)
    except (TypeError, ValueError):
        return DEFAULT_STAGE_MAX_ROUNDS
    return max(1, value)


def _swiss_scope_completed(total: int, completed: int, max_round: int, max_rounds: int) -> bool:
    return total > 0 and completed == total and max_round >= max_rounds


def _rule_profile(stage: models.Stage) -> str:
    if stage.ranking_preset:
        return stage.ranking_preset
    if stage.stage_type == StageType.FFA_LEAGUE:
        return "ffa_default"
    if stage.stage_type == StageType.SWISS:
        return "challonge_swiss"
    if stage.stage_type == StageType.ROUND_ROBIN:
        return "challonge_round_robin"
    return "bracket_default"


def normalize_tiebreak_order(
    metrics: typing.Iterable[typing.Any], *, ffa_columns: typing.Sequence[str] = ()
) -> list[str]:
    """The order the engine will actually apply, from whatever was configured.

    The stored order's own sequence is honoured verbatim, including where it
    puts ``points`` (see a0f866e2: hoisting ``points`` to the front overrode an
    explicit organizer choice, and every preset already leads with it). What
    this does fix are the two things a stored list can say that mean nothing:

    - unknown metrics are dropped: ``_metric_value`` scores them 0 for every
      team, which is indistinguishable from a tiebreaker that never fires;
    - duplicates collapse to their first occurrence -- a second pass over one
      metric can never separate teams the first pass left equal.

    ``ffa_stat:<key>`` is known only while the stage still has that column:
    deleting a column must not leave a tiebreaker that scores every team 0.

    An organizer's fixed place is not a metric: it is a ``StandingPin``, applied
    after this order has ranked the table (:func:`apply_pins`).
    """
    columns = {f"{FFA_STAT_PREFIX}{key}" for key in ffa_columns}
    ordered: list[str] = []
    for metric in metrics:
        if not isinstance(metric, str) or (metric not in KNOWN_TIEBREAK_METRICS and metric not in columns):
            continue
        if metric not in ordered:
            ordered.append(metric)
    return ordered


def stage_rules(stage: models.Stage) -> ScoringRules:
    """The stage's compiled ``encounter.scoring_rule`` -- the same row every
    encounter of the stage points at, so the table and the cards agree by
    construction (D51)."""
    return compile_rules(stage.scoring_rule)


def _tiebreak_order(stage: models.Stage, *, rules: ScoringRules | None = None) -> list[str]:
    """``rules`` is passed by the FFA builder, which already compiled them."""
    if rules is None and stage.stage_type == StageType.FFA_LEAGUE:
        rules = stage_rules(stage)
    columns = rules.column_keys if rules is not None else ()
    if stage.tiebreak_order is not None:
        normalized = normalize_tiebreak_order(stage.tiebreak_order, ffa_columns=columns)
        # A stored list with nothing the engine knows would rank by team id alone.
        if normalized:
            return normalized
    profile = _rule_profile(stage)
    preset = RULE_PRESET_DEFAULTS.get(profile, RULE_PRESET_DEFAULTS["bracket_default"])
    if profile == "ffa_default" and columns:
        # The stage's first column is its headline stat: "most kills wins the
        # tie" is what an organizer means by an unconfigured FFA league.
        preset = [*preset[:2], f"{FFA_STAT_PREFIX}{columns[0]}", *preset[2:]]
    return normalize_tiebreak_order(preset, ffa_columns=columns)


def _scoring(stage: models.Stage, tournament: models.Tournament) -> tuple[float, float, float]:
    """Points per win/draw/loss: the stage's own where it set one, else the tournament's."""
    return (
        tournament.win_points if stage.win_points is None else stage.win_points,
        tournament.draw_points if stage.draw_points is None else stage.draw_points,
        tournament.loss_points if stage.loss_points is None else stage.loss_points,
    )


#: Stands in for "this team has no placement yet" so the negated placement
#: metrics sort it below every real place instead of above first place.
_NO_PLACEMENT = 10**9


def _metric_value(team: RankedStageTeam, metric: str) -> float | int:
    if metric == "points":
        return team.points
    if metric == "match_wins":
        return team.wins
    if metric == "head_to_head":
        return team.head_to_head
    # Buchholz hundredths are noise (custom scoring / bye points): round to 0.1
    # so near-equal opposition falls through to the next tiebreaker instead.
    if metric == "buchholz":
        return round(team.buchholz, 1)
    if metric == "median_buchholz":
        return round(team.median_buchholz, 1)
    if metric in {"score_differential", "map_differential"}:
        return team.score_differential
    if metric == "wins_as_higher_stage_specific_metric":
        return team.wins
    if metric == "ffa_game_wins":
        return team.wins
    if metric.startswith(FFA_STAT_PREFIX):
        # Already oriented by ``_ranking_stats``; a team with no value for the
        # column reads as 0, which is what "has not played" sums to anyway.
        return team.ffa_stats.get(metric[len(FFA_STAT_PREFIX) :], 0.0)
    # Lower place is better and the sort is descending: negate, with "never
    # played" ranking below every real place.
    if metric == "ffa_best_placement":
        return -(team.ffa_best_placement or _NO_PLACEMENT)
    if metric == "ffa_last_placement":
        return -(team.ffa_last_placement or _NO_PLACEMENT)
    return 0


def _sort_ranked_teams(
    teams: list[RankedStageTeam],
    *,
    tiebreak_order: list[str],
) -> list[RankedStageTeam]:
    ordered = list(teams)
    # Lowest-priority key first: the metric loop below is applied in reverse, so
    # this decides only teams every configured metric left equal. Without it the
    # order of two identical teams is whatever order they were first seen in
    # (encounter iteration), which is not stable across recalculations -- and
    # ``position`` feeds playoff seeding, so an unstable pair silently moves a
    # team between the upper and lower bracket.
    ordered.sort(key=lambda team: team.team_id)
    for metric in reversed(tiebreak_order):
        ordered.sort(key=lambda team: _metric_value(team, metric), reverse=True)
    return ordered


def assign_tie_groups(
    ordered: typing.Sequence[RankedStageTeam],
    *,
    tiebreak_order: typing.Sequence[str],
    pinned: typing.Collection[int] = (),
) -> None:
    """Mark runs of adjacent teams no configured metric could separate.

    ``ordered`` is the final table order, so a run's head is its first place. A
    team in ``pinned`` is never part of a run -- its place was set by hand, which
    is exactly what resolves a tie -- and it splits the teams around it.
    """

    def key(team: RankedStageTeam) -> tuple:
        if team.team_id in pinned:
            return ("pinned", team.team_id)
        return tuple(_metric_value(team, metric) for metric in tiebreak_order)

    for team in ordered:
        team.tie_group = None
    start = 0
    for index in range(1, len(ordered) + 1):
        if index < len(ordered) and key(ordered[index]) == key(ordered[start]):
            continue
        if index - start > 1:
            head_position = start + 1
            for team in ordered[start:index]:
                team.tie_group = head_position
        start = index


#: A table with no pins: the default of every stage builder.
_EMPTY: typing.Mapping[int, int] = types.MappingProxyType({})


def _pin_seats(pins: typing.Mapping[int, int], size: int) -> dict[int, int]:
    """Place -> team for every pin, each at its own place inside ``1..size``.

    Pins are distinct and in range as stored; this only keeps that true when the
    table shrank under them (a team left the group). Order is kept: a pin is
    pushed below an earlier one it collides with, then the tail is pulled back
    up inside the table, so the last pinned team ends on the last place rather
    than past it.
    """
    ordered = sorted(pins.items(), key=lambda item: (item[1], item[0]))
    places: list[int] = []
    for _team_id, wanted in ordered:
        places.append(max(wanted, places[-1] + 1 if places else 1))
    ceiling = size
    for index in range(len(places) - 1, -1, -1):
        places[index] = min(places[index], ceiling)
        ceiling = places[index] - 1
    return {place: team_id for place, (team_id, _wanted) in zip(places, ordered, strict=True)}


def apply_pins(
    ranked: typing.Sequence[tuple[int, int]],
    pins: typing.Mapping[int, int],
) -> list[tuple[int, int, bool]]:
    """Seat pinned teams at their place; everyone else fills the rest in order.

    ``ranked`` is one table as the engine ranked it: ``(team_id, position)`` in
    table order, position 0 meaning "not ranked yet" (a playoff team that has not
    played). ``pins`` maps team to its fixed place; pins of teams not in the
    table are ignored. Returns ``(team_id, position, is_pinned)`` in final order.

    Unpinned teams keep their computed order, and adjacent unpinned teams that
    shared a computed place keep sharing it -- a playoff's "5th-8th" stays one
    place, under the first free seat of the run. An unpinned, unranked team stays
    at 0 and takes no seat. With no pins this returns ``ranked`` unchanged.
    """
    table_pins = {team_id: pins[team_id] for team_id, _position in ranked if team_id in pins}
    free = [(team_id, position) for team_id, position in ranked if team_id not in table_pins and position > 0]
    size = len(table_pins) + len(free)
    seats = _pin_seats(table_pins, size)

    output: list[tuple[int, int, bool]] = []
    upcoming = iter(free)
    previous: tuple[int, int] | None = None  # (computed, final) of the unpinned team one seat up
    for place in range(1, size + 1):
        if place in seats:
            output.append((seats[place], place, True))
            previous = None
            continue
        team_id, computed = next(upcoming)
        position = previous[1] if previous is not None and previous[0] == computed else place
        output.append((team_id, position, False))
        previous = (computed, position)
    output.extend((team_id, 0, False) for team_id, position in ranked if team_id not in table_pins and position <= 0)
    return output


def _pin_group_table(
    ordered: list[RankedStageTeam],
    pins: typing.Mapping[int, int],
    *,
    tiebreak_order: list[str],
) -> tuple[list[RankedStageTeam], set[int]]:
    """A ranked group table with its pins applied and its ties re-marked."""
    by_id = {team.team_id: team for team in ordered}
    placed = apply_pins([(team.team_id, index) for index, team in enumerate(ordered, 1)], pins)
    final = [by_id[team_id] for team_id, _position, _pinned in placed]
    pinned = {team_id for team_id, _position, is_pinned in placed if is_pinned}
    assign_tie_groups(final, tiebreak_order=tiebreak_order, pinned=pinned)
    return final, pinned


def _calculate_buchholz(
    teams_by_id: dict[int, RankedStageTeam],
) -> None:
    for team in teams_by_id.values():
        opponent_scores = [
            teams_by_id[opponent_id].points for opponent_id in team.opponents if opponent_id in teams_by_id
        ]
        team.buchholz = float(sum(opponent_scores))
        if len(opponent_scores) > 2:
            trimmed = sorted(opponent_scores)[1:-1]
            team.median_buchholz = float(sum(trimmed))
        else:
            team.median_buchholz = float(sum(opponent_scores))


def _calculate_head_to_head(
    teams_by_id: dict[int, RankedStageTeam],
    encounters: typing.Sequence[StageEncounter],
) -> None:
    """Wins between teams level on points. Two-seat encounters only: "who beat
    whom" has no meaning for a lobby where three teams met at once."""
    points_buckets: dict[float, set[int]] = defaultdict(set)
    for team in teams_by_id.values():
        points_buckets[team.points].add(team.team_id)

    for team_ids in points_buckets.values():
        if len(team_ids) < 2:
            continue
        for encounter in encounters:
            if not encounter.is_duel or not team_ids.issuperset(seat.team_id for seat in encounter.seats):
                continue
            winner = encounter.winner()
            if winner is not None:
                teams_by_id[winner].head_to_head += 1


def prepare_teams_for_groups(
    encounters: typing.Sequence[StageEncounter],
    *,
    seed_team_ids: typing.Sequence[int] | None = None,
    bye_counts: dict[int, int] | None = None,
    bye_points: float = 1.0,
    win_points: float = 1.0,
    draw_points: float = 0.5,
    loss_points: float = 0.0,
    tiebreak_order: list[str] | None = None,
) -> list[RankedStageTeam]:
    """Rank one group's teams from the encounters they played.

    A result is a PLACE inside the encounter now, not a pair of scores: the
    team alone in first won, teams sharing first drew, everyone else lost. That
    is exactly what the two score columns said for a duel, and it is also the
    answer for a group whose encounters seat more than two -- the one thing it
    cannot say is ``score_differential``, which is a difference between TWO
    numbers and is therefore only summed for two-seat encounters (plan §5).
    """
    completed_encounters = _completed_encounters_in_finished_rounds(encounters)
    team_cache: dict[int, RankedStageTeam] = {}

    for team_id in seed_team_ids or []:
        team_cache.setdefault(team_id, RankedStageTeam(team_id=team_id))

    for encounter in completed_encounters:
        seats = encounter.seats
        for seat in seats:
            team_cache.setdefault(seat.team_id, RankedStageTeam(team_id=seat.team_id))
        places = encounter.places()
        drawn = sum(1 for place in places.values() if place == 1) > 1
        for seat in seats:
            team = team_cache[seat.team_id]
            team.matches += 1
            team.opponents.extend(other.team_id for other in seats if other is not seat)
            if encounter.is_duel:
                opponent = next(other for other in seats if other is not seat)
                team.score_differential += int(seat.score) - int(opponent.score)
            if places[seat.team_id] != 1:
                team.loses += 1
                team.points += loss_points
            elif drawn:
                team.draws += 1
                team.points += draw_points
            else:
                team.wins += 1
                team.points += win_points

    for team_id, bye_count in (bye_counts or {}).items():
        team_cache.setdefault(team_id, RankedStageTeam(team_id=team_id))
        team_cache[team_id].points += max(0, bye_count) * bye_points

    _calculate_buchholz(team_cache)
    _calculate_head_to_head(team_cache, completed_encounters)
    # Normalized here too: a caller passing a raw stage order (tests, the Swiss
    # pairing preview) must rank by the same list the stored standings did.
    order = normalize_tiebreak_order(tiebreak_order or RULE_PRESET_DEFAULTS["bracket_default"])
    ordered = _sort_ranked_teams(list(team_cache.values()), tiebreak_order=order)
    assign_tie_groups(ordered, tiebreak_order=order)
    return ordered


def _participants(encounters: typing.Sequence[StageEncounter]) -> list[int]:
    """Every team that played one of these encounters, in first-seen order."""
    return list(dict.fromkeys(seat.team_id for encounter in encounters for seat in encounter.seats))


def _loser_ids(encounter: StageEncounter) -> list[int]:
    """Everyone this encounter did NOT hand first place to.

    A drawn elimination match has no winner and therefore no loser -- it is a
    result the bracket cannot advance either, which is why nothing here invents
    one from the slot order.
    """
    winner = encounter.winner()
    return [] if winner is None else [seat.team_id for seat in encounter.seats if seat.team_id != winner]


def prepare_teams_for_playoffs_double_elimination(
    encounters: typing.Sequence[StageEncounter],
) -> list[schemas.StandingTeamDataWithRanking]:
    logger.info("Preparing teams for double elimination playoffs")
    completed_encounters = _completed_encounters_in_finished_rounds(encounters)
    participants = _participants(completed_encounters)
    data: dict[int, dict[str, float | int]] = {
        participant: {"win": 0, "lose": 0, "placement": 0} for participant in participants
    }

    _assign_final_round_placements(encounters, data)

    for encounter in completed_encounters:
        winner = encounter.winner()
        if winner is not None:
            data[winner]["win"] += 1
        for loser in _loser_ids(encounter):
            data[loser]["lose"] += 1

    lower_bracket_games: dict[int, list[StageEncounter]] = {}
    global_placement = len(participants)

    for encounter in [encounter for encounter in completed_encounters if encounter.round < 0]:
        lower_bracket_games.setdefault(encounter.round, []).append(encounter)

    for matches in lower_bracket_games.values():
        losers: list[int] = []
        for match in matches:
            losers.extend(_loser_ids(match))

        global_placement -= len(losers) - 1
        for loser in losers:
            data[loser]["placement"] = global_placement
        global_placement -= 1

    output: list[schemas.StandingTeamDataWithRanking] = []
    for team_id, team_data in data.items():
        output.append(
            schemas.StandingTeamDataWithRanking(
                id=team_id,
                wins=int(team_data["win"]),
                loses=int(team_data["lose"]),
                draws=0,
                points=0,
                ranking=team_data["placement"],
                opponents=[],
                matches=int(team_data["win"]) + int(team_data["lose"]),
            )
        )
    return output


def prepare_teams_for_playoffs_single_elimination(
    encounters: typing.Sequence[StageEncounter],
) -> list[schemas.StandingTeamDataWithRanking]:
    logger.info("Preparing teams for single elimination playoffs")
    completed_encounters = _completed_encounters_in_finished_rounds(encounters)
    participants = _participants(completed_encounters)

    data: dict[int, dict[str, float | int]] = {
        participant: {"win": 0, "lose": 0, "placement": 0} for participant in participants
    }
    round_of_loss: dict[int, int | None] = dict.fromkeys(participants)

    for encounter in completed_encounters:
        winner = encounter.winner()
        if winner is not None:
            data[winner]["win"] += 1
        for loser_id in _loser_ids(encounter):
            data[loser_id]["lose"] += 1
            if round_of_loss[loser_id] is None:
                round_of_loss[loser_id] = encounter.round

    valid_rounds = [encounter.round for encounter in completed_encounters if encounter.round > 0]
    if not valid_rounds:
        return [
            schemas.StandingTeamDataWithRanking(
                id=team_id,
                wins=int(data[team_id]["win"]),
                loses=int(data[team_id]["lose"]),
                draws=0,
                points=0,
                ranking=0,
                opponents=[],
                matches=int(data[team_id]["win"]) + int(data[team_id]["lose"]),
            )
            for team_id in data
        ]

    _assign_final_round_placements(encounters, data)

    round_losers: dict[int, list[int]] = defaultdict(list)
    for team_id, match_round in round_of_loss.items():
        if match_round is not None and data[team_id]["placement"] not in (1, 2):
            round_losers[match_round].append(team_id)

    current_place = 3
    for match_round in sorted(round_losers.keys(), reverse=True):
        losers_in_round = round_losers[match_round]
        for team_id in losers_in_round:
            data[team_id]["placement"] = current_place
        current_place += len(losers_in_round)

    output: list[schemas.StandingTeamDataWithRanking] = []
    for team_id, stats in data.items():
        output.append(
            schemas.StandingTeamDataWithRanking(
                id=team_id,
                wins=int(stats["win"]),
                loses=int(stats["lose"]),
                draws=0,
                points=0,
                ranking=stats["placement"],
                opponents=[],
                matches=int(stats["win"]) + int(stats["lose"]),
            )
        )
    return output


PLAYOFF_CALCULATORS: dict[
    StageType,
    Callable[
        [typing.Sequence[StageEncounter]],
        list[schemas.StandingTeamDataWithRanking],
    ],
] = {
    StageType.SINGLE_ELIMINATION: prepare_teams_for_playoffs_single_elimination,
    StageType.DOUBLE_ELIMINATION: prepare_teams_for_playoffs_double_elimination,
}


def _infer_stage_type_from_encounters(
    encounters: typing.Sequence[StageEncounter],
) -> StageType:
    has_negative = any(encounter.round < 0 for encounter in encounters)
    return StageType.DOUBLE_ELIMINATION if has_negative else StageType.SINGLE_ELIMINATION


def _stage_item_team_ids(stage_item: models.StageItem | None) -> list[int]:
    if stage_item is None:
        return []

    team_ids: list[int] = []
    seen: set[int] = set()
    for stage_input in sorted(stage_item.inputs, key=lambda item: item.slot):
        if stage_input.team_id is None or stage_input.team_id in seen:
            continue
        team_ids.append(stage_input.team_id)
        seen.add(stage_input.team_id)
    return team_ids


def _build_group_stage_standings(
    tournament: models.Tournament,
    stage: models.Stage,
    stage_item: models.StageItem | None,
    encounters: typing.Sequence[StageEncounter],
    *,
    pins: typing.Mapping[int, int] = _EMPTY,
    bye_counts: typing.Mapping[int, int] = _EMPTY,
) -> list[models.Standing]:
    seed_team_ids = _stage_item_team_ids(stage_item)
    if not encounters and not seed_team_ids:
        return []

    tiebreak_order = _tiebreak_order(stage)
    win_points, draw_points, loss_points = _scoring(stage, tournament)
    bye_points = win_points if stage.swiss_bye_points is None else stage.swiss_bye_points

    teams = prepare_teams_for_groups(
        encounters,
        seed_team_ids=seed_team_ids,
        bye_counts=dict(bye_counts) if stage.stage_type == StageType.SWISS else {},
        bye_points=bye_points,
        win_points=win_points,
        draw_points=draw_points,
        loss_points=loss_points,
        tiebreak_order=tiebreak_order,
    )
    # Pinned after ranking, never inside ``prepare_teams_for_groups``: that one
    # also feeds the Swiss pairing preview, which must pair on real results.
    teams, pinned = _pin_group_table(teams, pins, tiebreak_order=tiebreak_order)

    standings: list[models.Standing] = []
    for position, team in enumerate(teams, 1):
        standings.append(
            models.Standing(
                tournament_id=tournament.id,
                team_id=team.team_id,
                stage_id=stage.id,
                stage_item_id=stage_item.id if stage_item is not None else None,
                position=position,
                overall_position=0,
                matches=team.matches,
                win=team.wins,
                draw=team.draws,
                lose=team.loses,
                points=team.points,
                buchholz=team.median_buchholz,
                full_buchholz=team.buchholz,
                tie_group=team.tie_group,
                tb=team.head_to_head,
                is_pinned=team.team_id in pinned,
                score_differential=team.score_differential,
                stage=stage,
                stage_item=stage_item,
            )
        )
    return standings


def _ranking_stats(row: TeamTotals, rules: ScoringRules) -> dict[str, float]:
    """Column sums oriented so that more is better for every key.

    ``_metric_value`` sorts descending, so a ``better="lower"`` column (deaths,
    penalties) is negated here rather than inside the sort -- exactly what
    ``ffa_last_placement`` does, and for the same reason.
    """
    return {
        column.key: -row.stats.get(column.key, 0.0) if column.better == "lower" else row.stats.get(column.key, 0.0)
        for column in rules.columns
    }


def _build_ffa_stage_standings(
    tournament: models.Tournament,
    stage: models.Stage,
    stage_item: models.StageItem,
    participant_ids: typing.Sequence[int],
    games: typing.Sequence[typing.Sequence[GameLine]],
    *,
    pins: typing.Mapping[int, int] = _EMPTY,
) -> list[models.Standing]:
    """Rank one FFA group: its roster plus every confirmed game of its lobbies.

    The group is the table, so the roster comes from BOTH the seed inputs and
    the teams actually seated in a lobby -- a team moved into a lobby by hand
    still belongs in the standing.
    """
    seed_ids = list(dict.fromkeys([*_stage_item_team_ids(stage_item), *participant_ids]))
    if not seed_ids:
        return []

    rules = stage_rules(stage)
    totals = team_totals(seed_ids, games, rules)
    teams = [
        RankedStageTeam(
            team_id=row.team_id,
            matches=row.games,
            wins=row.wins,
            points=row.points,
            ffa_stats=_ranking_stats(row, rules),
            ffa_best_placement=row.best_placement,
            ffa_last_placement=row.last_placement,
        )
        for row in totals.values()
    ]
    order = _tiebreak_order(stage, rules=rules)
    ordered, pinned = _pin_group_table(_sort_ranked_teams(teams, tiebreak_order=order), pins, tiebreak_order=order)
    return [
        models.Standing(
            tournament_id=tournament.id,
            team_id=team.team_id,
            stage_id=stage.id,
            stage_item_id=stage_item.id,
            position=position,
            overall_position=0,
            matches=team.matches,
            win=team.wins,
            draw=0,
            lose=0,
            points=team.points,
            # Not a Buchholz: app-service and parser-service read ``buchholz IS
            # NULL`` as "playoff row" (Standing.buchholz). An ffa league is a
            # group stage, so its rows must read as group rows.
            buchholz=0.0,
            full_buchholz=None,
            tie_group=team.tie_group,
            tb=None,
            is_pinned=team.team_id in pinned,
            score_differential=None,
            stage=stage,
            stage_item=stage_item,
        )
        for position, team in enumerate(ordered, 1)
    ]


def _build_elimination_stage_standings(
    tournament: models.Tournament,
    stage: models.Stage,
    encounters: typing.Sequence[StageEncounter],
    *,
    pins: typing.Mapping[int, int] = _EMPTY,
) -> list[models.Standing]:
    # Collect all team ids participating in this stage from inputs.
    seed_team_ids: list[int] = []
    seen: set[int] = set()
    for item in sorted(stage.items, key=lambda it: (it.order, it.id)):
        for inp in sorted(item.inputs, key=lambda i: i.slot):
            if inp.team_id is not None and inp.team_id not in seen:
                seed_team_ids.append(inp.team_id)
                seen.add(inp.team_id)

    if not encounters and not seed_team_ids:
        return []

    teams: list[schemas.StandingTeamDataWithRanking] = []
    if encounters:
        stage_type = stage.stage_type or _infer_stage_type_from_encounters(encounters)
        calculator = PLAYOFF_CALCULATORS.get(stage_type, prepare_teams_for_playoffs_single_elimination)
        teams = calculator(encounters)
    by_id = {team.id: team for team in teams}
    ranked = sorted(
        ((team.id, int(team.ranking)) for team in teams),
        key=lambda item: (item[1] <= 0, item[1], item[0]),
    )
    # Teams that have not played any completed match yet get a placeholder row
    # at position 0 -- unless a pin seats them (a team disqualified unplayed).
    ranked.extend((team_id, 0) for team_id in seed_team_ids if team_id not in by_id)

    standings: list[models.Standing] = []
    for team_id, position, is_pinned in apply_pins(ranked, pins):
        team = by_id.get(team_id)
        standings.append(
            models.Standing(
                tournament_id=tournament.id,
                team_id=team_id,
                stage_id=stage.id,
                stage_item_id=None,
                position=position,
                overall_position=position,
                matches=team.matches if team is not None else 0,
                win=team.wins if team is not None else 0,
                draw=team.draws if team is not None else 0,
                lose=team.loses if team is not None else 0,
                points=team.points if team is not None else 0,
                buchholz=None,
                tb=None,
                is_pinned=is_pinned,
                stage=stage,
            )
        )
    return standings


def _sort_for_overall(standings: list[models.Standing], stage_order: dict[int, int]) -> list[models.Standing]:
    """Order rows for the overall table, honouring each stage's own ranking.

    ``position`` was already computed with the stage's configured
    ``tiebreak_order``, so it — not a second, hard-coded points/tb/buchholz
    cascade — decides who is ahead inside a stage. Points/tb/buchholz only
    break ties between equal positions in *different* groups.
    """
    return sorted(
        standings,
        key=lambda standing: (
            stage_order.get(standing.stage_id or 0, 0),
            -standing.position,
            standing.points,
            standing.tb or 0,
            standing.buchholz or 0,
        ),
        reverse=True,
    )


def calculate_overall_positions(
    standings: list[models.Standing],
    stages: list[models.Stage],
) -> list[models.Standing]:
    stage_order = {stage.id: stage.order for stage in stages}

    # A standing with zero completed matches carries no real signal — ranking
    # it would fabricate a "1st place" out of pure seed/tiebreak order before
    # a single game has been played. Leave it at the placeholder 0 that the
    # stage builders already assign it, and only rank standings backed by at
    # least one played match. This is deliberately per-team/per-stage, not
    # gated on reaching a playoff stage: league (round-robin-only) tournaments
    # never have a playoff stage and still need real, incrementally-updated
    # overall standings as soon as their teams start playing. A pinned row is
    # the exception: its place is the organizer's decision, not a result.
    rankable = [standing for standing in standings if standing.matches > 0 or standing.is_pinned]

    playoff_standings = [
        standing
        for standing in rankable
        if standing.stage is not None and standing.stage.stage_type in ELIMINATION_STAGE_TYPES
    ]
    progressed_team_ids = {standing.team_id for standing in playoff_standings}

    if playoff_standings:
        for standing in playoff_standings:
            standing.overall_position = standing.position

        # Number of distinct teams that reached playoffs
        playoff_team_count = len(progressed_team_ids)

        remaining = _sort_for_overall(
            [standing for standing in rankable if standing.team_id not in progressed_team_ids],
            stage_order,
        )
        # Best group-only team gets position playoff_team_count + 1
        next_position = playoff_team_count + 1
        for standing in remaining:
            standing.overall_position = next_position
            next_position += 1
        return standings

    # Rank teams, not participation rows: across consecutive group stages one
    # team owns several standings, and numbering all of them lets a single team
    # occupy two podium places. Only its latest stage row represents its final
    # achievement; the earlier ones stay unranked.
    def stage_rank(standing: models.Standing) -> tuple[int, int]:
        return stage_order.get(standing.stage_id or 0, 0), standing.stage_id or 0

    latest_by_team: dict[int, models.Standing] = {}
    for standing in rankable:
        standing.overall_position = 0
        current = latest_by_team.get(standing.team_id)
        if current is None or stage_rank(standing) > stage_rank(current):
            latest_by_team[standing.team_id] = standing

    remaining = _sort_for_overall(list(latest_by_team.values()), stage_order)
    # Best team (first after sort) gets position 1
    for position, standing in enumerate(remaining, start=1):
        standing.overall_position = position
    # Return every standing, not just the ranked subset: unrankable (0-match)
    # rows still need to reach `session.add_all` in the caller.
    return standings


def sort_matches(
    matches: typing.Sequence[StageEncounter],
) -> list[StageEncounter]:
    """Phase E: delegate to shared utility."""
    return sort_bracket_matches(matches)


#: Everything ``calculate_for_tournament`` walks: stages, their items, and each
#: item's seed inputs.
_STANDINGS_TOURNAMENT_LOAD = (
    selectinload(models.Tournament.stages).selectinload(models.Stage.items).selectinload(models.StageItem.inputs),
)


class StandingsService:
    def __init__(
        self,
        *,
        standing_repo: StandingRepository = StandingRepository(),
        tournament_repo: TournamentRepository = TournamentRepository(),
        encounter_repo: EncounterRepository = EncounterRepository(),
    ) -> None:
        self.standing_repo = standing_repo
        self.tournament_repo = tournament_repo
        self.encounter_repo = encounter_repo

    async def get_by_tournament(
        self, session: AsyncSession, tournament_id: int, entities: list[str]
    ) -> typing.Sequence[models.Standing]:
        query = (
            self.standing_repo.select()
            .options(*standing_entities(entities))
            .where(sa.and_(models.Standing.tournament_id == tournament_id))
            .order_by(
                models.Standing.overall_position.desc(),
                models.Standing.stage_id.asc().nullslast(),
                models.Standing.stage_item_id.asc().nullslast(),
                models.Standing.position.asc(),
            )
        )
        result = await session.execute(query)
        standings = result.scalars().all()
        logger.debug(f"Retrieved {len(standings)} standings for tournament {tournament_id}")
        return standings

    async def _seats_by_encounter(
        self, session: AsyncSession, encounter_ids: typing.Sequence[int]
    ) -> dict[int, list[Seat]]:
        """The live seats of each encounter, in slot order."""
        seats: defaultdict[int, list[Seat]] = defaultdict(list)
        if not encounter_ids:
            return seats
        rows = await session.execute(
            sa.select(models.EncounterTeam)
            .where(
                models.EncounterTeam.encounter_id.in_(tuple(encounter_ids)),
                models.EncounterTeam.active.is_(True),
                models.EncounterTeam.team_id.is_not(None),
            )
            .order_by(models.EncounterTeam.encounter_id, models.EncounterTeam.slot)
        )
        for row in rows.scalars():
            seats[row.encounter_id].append(
                Seat(team_id=row.team_id, slot=row.slot, score=row.score, placement=row.placement)
            )
        return seats

    async def load_stage_encounters(self, session: AsyncSession, stage_id: int) -> list[StageEncounter]:
        """One stage's encounters, flattened for the ranking engine.

        Two queries for the whole stage: the cards with their bracket positions,
        then every live participation of them. The engine never touches an ORM
        row afterwards, which is what keeps it testable without a database.
        """
        rows = (
            (
                await session.execute(
                    sa.select(models.Encounter, models.BracketEncounter)
                    .join(models.BracketEncounter, models.BracketEncounter.encounter_id == models.Encounter.id)
                    .where(models.BracketEncounter.stage_id == stage_id)
                    .order_by(models.Encounter.id)
                )
            )
            .tuples()
            .all()
        )
        seats = await self._seats_by_encounter(session, [encounter.id for encounter, _position in rows])
        return [
            StageEncounter(
                id=encounter.id,
                round=position.round,
                stage_id=position.stage_id,
                stage_item_id=position.stage_item_id,
                completed=is_completed_encounter(encounter),
                seats=tuple(seats.get(encounter.id, ())),
            )
            for encounter, position in rows
        ]

    async def get_completed_match_history_by_tournament(
        self,
        session: AsyncSession,
        tournament_id: int,
    ) -> list[tuple[models.Encounter, models.BracketEncounter]]:
        """Completed encounters of *closed* rounds, for the standings history.

        Deliberately the same set the ranking engine counts
        (:func:`_completed_encounters_in_finished_rounds`): the embedded
        ``matches_history`` feeds the FORM column, which sits in the same row as
        W·D·L / points / Buchholz. Serving every completed encounter here made
        FORM run a round ahead of its own row — a team could show a ``W`` chip
        with zero wins because the rest of its round had not reported yet.

        Open encounters are selected too (not filtered in SQL): a round is only
        closed if *none* of its playable encounters is still open, which cannot
        be seen from the completed ones alone. Rounds are scoped per
        (stage, stage_item) — the same scope ``_history_for_standing`` slices by
        — so an unfinished round in group A cannot hide group B's results.

        The bracket position rides along: the caller renders the round and the
        scope off it, and an encounter with no position (a scrim, a mix) is not
        part of any stage's history and never enters the join.
        """
        query = (
            sa.select(models.Encounter, models.BracketEncounter)
            .join(models.BracketEncounter, models.BracketEncounter.encounter_id == models.Encounter.id)
            .options(selectinload(models.Encounter.teams))
            .where(models.Encounter.tournament_id == tournament_id)
            .order_by(
                models.BracketEncounter.stage_id.asc().nullslast(),
                models.BracketEncounter.stage_item_id.asc().nullslast(),
                sa.func.abs(models.BracketEncounter.round).asc(),
                models.BracketEncounter.round.desc(),
                models.Encounter.id.asc(),
            )
        )
        rows = (await session.execute(query)).tuples().all()
        seats = await self._seats_by_encounter(session, [encounter.id for encounter, _position in rows])
        by_id = {encounter.id: (encounter, position) for encounter, position in rows}
        by_scope: defaultdict[tuple[int | None, int | None], list[StageEncounter]] = defaultdict(list)
        for encounter, position in rows:
            by_scope[(position.stage_id, position.stage_item_id)].append(
                StageEncounter(
                    id=encounter.id,
                    round=position.round,
                    stage_id=position.stage_id,
                    stage_item_id=position.stage_item_id,
                    completed=is_completed_encounter(encounter),
                    seats=tuple(seats.get(encounter.id, ())),
                )
            )
        # Groups are keyed by the leading ORDER BY columns and each keeps its
        # rows' relative order, so concatenating them restores the query order.
        return [
            by_id[flat.id]
            for scope_encounters in by_scope.values()
            for flat in _completed_encounters_in_finished_rounds(scope_encounters)
        ]

    async def delete_by_tournament(self, session: AsyncSession, tournament_id: int, *, commit: bool = True) -> None:
        """Delete all Standing rows for a tournament.

        When called as part of :meth:`recalculate_for_tournament` we pass
        ``commit=False`` so that the DELETE and the subsequent INSERT land in the
        same transaction — avoiding the brief window where the table is empty
        (Phase D: transactional recalculation).
        """
        await self.standing_repo.delete_for_tournament(session, tournament_id)
        if commit:
            await session.commit()
        logger.info(f"Deleted standings for tournament {tournament_id}")

    async def get_tournament_for_standings(
        self,
        session: AsyncSession,
        tournament_id: int,
    ) -> models.Tournament | None:
        return await self.tournament_repo.get(session, tournament_id, options=_STANDINGS_TOURNAMENT_LOAD)

    async def recalculate_for_tournament(
        self,
        session: AsyncSession,
        tournament_id: int,
        *,
        commit: bool = True,
    ) -> typing.Sequence[models.Standing]:
        """Delete + rebuild standings for a tournament atomically.

        Everything happens in a single transaction: readers never observe an
        empty standings table mid-recalculation.
        """
        await self.delete_by_tournament(session, tournament_id, commit=False)
        tournament = await self.get_tournament_for_standings(session, tournament_id)
        if tournament is None:
            if commit:
                await session.commit()
            else:
                await session.flush()
            return []
        return await self.calculate_for_tournament(session, tournament, commit=commit)

    async def _update_stage_completion_flags(self, session: AsyncSession, tournament: models.Tournament) -> None:
        """After recalc, flip ``Stage.is_completed`` to match reality.

        A stage is considered completed when every encounter that belongs to it
        has ``status == COMPLETED``. Stages without any encounters are treated
        as not-completed (nothing to finish).

        This powers the admin UI's "Group A — 10/10 done" badge and the
        activate-and-generate warning for downstream playoff stages.
        """
        stages = getattr(tournament, "stages", []) or []
        if not stages:
            return

        stage_ids = [s.id for s in stages]
        counts_result = await session.execute(
            sa.select(
                models.BracketEncounter.stage_id,
                models.BracketEncounter.stage_item_id,
                sa.func.count(models.Encounter.id).label("total"),
                sa.func.sum(
                    sa.case(
                        (
                            models.Encounter.status == enums.EncounterStatus.COMPLETED,
                            1,
                        ),
                        else_=0,
                    )
                ).label("completed"),
                sa.func.coalesce(sa.func.max(models.BracketEncounter.round), 0).label("max_round"),
            )
            .join(models.Encounter, models.Encounter.id == models.BracketEncounter.encounter_id)
            .where(models.BracketEncounter.stage_id.in_(stage_ids))
            .group_by(models.BracketEncounter.stage_id, models.BracketEncounter.stage_item_id)
        )
        rows_by_stage: dict[int, list[tuple[int | None, int, int, int]]] = defaultdict(list)
        for row in counts_result:
            rows_by_stage[row.stage_id].append(
                (
                    getattr(row, "stage_item_id", None),
                    int(row.total or 0),
                    int(row.completed or 0),
                    int(row.max_round or 0),
                )
            )
        stopped = await stopped_scopes(session, [stage.id for stage in stages if stage.stage_type == StageType.SWISS])

        for stage in stages:
            stage_rows = rows_by_stage.get(stage.id, [])
            if stage.stage_type == StageType.SWISS:
                rows_by_item = {
                    stage_item_id: (total, completed, max_round)
                    for stage_item_id, total, completed, max_round in stage_rows
                }
                item_scopes = [
                    (item.id, *rows_by_item.get(item.id, (0, 0, 0))) for item in (getattr(stage, "items", []) or [])
                ]
                extra_scopes = [
                    (None, total, completed, max_round)
                    for stage_item_id, total, completed, max_round in stage_rows
                    if stage_item_id is None
                ]
                scopes = item_scopes or extra_scopes
                should_be_completed = bool(scopes) and all(
                    (stage.id, stage_item_id) in stopped
                    or _swiss_scope_completed(total, completed, max_round, _stage_max_rounds(stage))
                    for stage_item_id, total, completed, max_round in scopes
                )
                if stage.is_completed != should_be_completed:
                    stage.is_completed = should_be_completed
                continue

            total = sum(row_total for _, row_total, _, _ in stage_rows)
            completed = sum(row_completed for _, _, row_completed, _ in stage_rows)
            should_be_completed = total > 0 and completed == total
            if stage.is_completed != should_be_completed:
                stage.is_completed = should_be_completed

    async def get_pins_by_table(
        self,
        session: AsyncSession,
        tournament_id: int,
    ) -> dict[tuple[int, int | None], dict[int, int]]:
        """Every pin of the tournament: ``(stage_id, stage_item_id) -> {team_id: position}``."""
        result = await session.execute(
            sa.select(
                models.StandingPin.stage_id,
                models.StandingPin.stage_item_id,
                models.StandingPin.team_id,
                models.StandingPin.position,
            ).where(models.StandingPin.tournament_id == tournament_id)
        )
        pins: defaultdict[tuple[int, int | None], dict[int, int]] = defaultdict(dict)
        for stage_id, stage_item_id, team_id, position in result.all():
            pins[(stage_id, stage_item_id)][team_id] = position
        return pins

    async def calculate_for_tournament(
        self,
        session: AsyncSession,
        tournament: models.Tournament,
        *,
        commit: bool = True,
    ) -> typing.Sequence[models.Standing]:
        stages = sorted(getattr(tournament, "stages", []) or [], key=lambda stage: stage.order)
        pins = await self.get_pins_by_table(session, tournament.id)
        byes = await bye_counts_by_scope(session, [stage.id for stage in stages if stage.stage_type == StageType.SWISS])
        all_standings: list[models.Standing] = []

        for stage in stages:
            # Loaded per branch, not up front: an FFA stage ranks from its game
            # results, so fetching its lobbies here would be a query per stage
            # whose rows nothing reads.
            if stage.stage_type in GROUP_STAGE_TYPES:
                stage_encounters = sort_matches(await self.load_stage_encounters(session, stage.id))
                stage_items = sorted(stage.items, key=lambda item: item.order) if stage.items else []
                if stage_items:
                    for stage_item in stage_items:
                        item_encounters = [
                            encounter for encounter in stage_encounters if encounter.stage_item_id == stage_item.id
                        ]
                        all_standings.extend(
                            _build_group_stage_standings(
                                tournament,
                                stage,
                                stage_item,
                                item_encounters,
                                pins=pins.get((stage.id, stage_item.id), _EMPTY),
                                bye_counts=byes.get((stage.id, stage_item.id), _EMPTY),
                            )
                        )
                else:
                    all_standings.extend(
                        _build_group_stage_standings(
                            tournament,
                            stage,
                            None,
                            stage_encounters,
                            pins=pins.get((stage.id, None), _EMPTY),
                            bye_counts=byes.get((stage.id, None), _EMPTY),
                        )
                    )
            elif stage.stage_type in ELIMINATION_STAGE_TYPES:
                stage_encounters = sort_matches(await self.load_stage_encounters(session, stage.id))
                all_standings.extend(
                    _build_elimination_stage_standings(
                        tournament, stage, stage_encounters, pins=pins.get((stage.id, None), _EMPTY)
                    )
                )
            elif stage.stage_type in FFA_STAGE_TYPES:
                results = await ffa_encounter_service.load_stage_results(session, stage.id)
                for stage_item in sorted(stage.items or [], key=lambda item: item.order):
                    all_standings.extend(
                        _build_ffa_stage_standings(
                            tournament,
                            stage,
                            stage_item,
                            results.participant_ids(stage_item.id),
                            results.games(stage_item.id),
                            pins=pins.get((stage.id, stage_item.id), _EMPTY),
                        )
                    )

        final_standings = calculate_overall_positions(all_standings, stages)
        await self.standing_repo.create_many(session, final_standings)
        # Phase P0.4: auto-flip Stage.is_completed to reflect encounter progress
        # in the same transaction as the standings write.
        await self._update_stage_completion_flags(session, tournament)
        if commit:
            await session.commit()
        else:
            await session.flush()
        logger.info(f"Stage-first standings calculated for tournament {tournament.id}")
        return await self.get_by_tournament(session, tournament.id, ["team", "stage", "stage_item"])


standings_service = StandingsService()
