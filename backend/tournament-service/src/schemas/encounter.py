from dataclasses import dataclass
from datetime import datetime
from typing import Literal

import sqlalchemy as sa
from pydantic import BaseModel, Field

from src.core import db, pagination
from src.schemas import (
    BaseRead,
    MapRead,
    Score,
    StageItemSummaryRead,
    StageSummaryRead,
    TeamRead,
    TeamWithMatchStats,
    TournamentRead,
)

__all__ = (
    "EncounterFeaturedRead",
    "EncounterFiltersRead",
    "EncounterGameRead",
    "EncounterGameTeamRead",
    "EncounterHistogramBucketRead",
    "EncounterKpiRead",
    "EncounterMapMetricRead",
    "EncounterRead",
    "EncounterOverviewRead",
    "EncounterPulseRead",
    "EncounterSavedViewCreate",
    "EncounterSavedViewRead",
    "EncounterScoreHeatmapCellRead",
    "EncounterSlotSourceRead",
    "EncounterSummaryRead",
    "EncounterSlotBalanceRead",
    "EncounterStageSplitRead",
    "EncounterTeamRead",
    "MatchRead",
    "MatchReadWithStats",
    "EncounterSearchParams",
    "EncounterSearchQueryParams",
    "MatchSearchParams",
    "MatchSearchQueryParams",
)


class EncounterTeamRead(BaseModel):
    """One live seat of an encounter (``encounter.team``), in slot order.

    ``id`` is the participation id every write addresses -- a claim, a report
    and an admin result all name it, never a slot and never a side. ``team_id``
    is the source ``tournament.team`` and goes NULL when that team is deleted;
    ``name`` is the snapshot that outlives it.
    """

    id: int
    slot: int
    team_id: int | None = None
    name: str
    seed: int | None = None
    #: The materialized standing inside the encounter (``wins`` under the
    #: series preset, points under a lobby's formula).
    score: float = 0.0
    placement: int | None = None
    active: bool = True
    #: The source team, expanded only when the ``teams`` entity is requested --
    #: the seat itself already carries the name a reader needs.
    team: TeamRead | None = None


class EncounterGameTeamRead(BaseModel):
    """One participation's accepted numbers and side in one game."""

    encounter_team_id: int
    #: The game's raw score (map rounds); ``None`` for a game that has none.
    score: int | None = None
    placement: int | None = None
    #: The stage's own columns for this participation; an absent key reads 0.
    column_values: dict[str, float] = {}
    #: Discipline side code; ``None`` when the discipline has no sides.
    starting_side: str | None = None
    replay_code: str | None = None


class EncounterSummaryRead(BaseRead):
    name: str
    slot_count: int = 2
    #: How the encounter is scored: ``points`` is a lobby's card (a two-seat one
    #: included), ``wins`` a series. A reader tells the two apart by this, never
    #: by ``slot_count``.
    scoring_preset: Literal["wins", "points"] = "wins"
    round: int
    tournament_id: int
    stage_id: int | None = None
    stage_item_id: int | None = None
    status: str
    result_status: str = "none"
    teams: list[EncounterTeamRead] = []


class EncounterSlotSourceRead(BaseModel):
    """Where an unresolved slot's team comes from: ``source_position`` of
    ``encounter_id`` fills ``slot`` of this encounter.

    The bracket's real advancement edges (``EncounterLink``). A reader labels an
    empty slot from them ("1st of M3") instead of inferring the bracket's shape
    from round numbers, which cannot tell a lower bracket seeded from the group
    stage apart from one fed by the upper bracket's first losers. Both ends are
    places and seats, never winner/loser or home/away.
    """

    encounter_id: int
    #: Place in the source encounter's final standing; 1 is first.
    source_position: int
    #: Seat of this encounter the edge fills, ``1..slot_count``.
    slot: int


class EncounterGameRead(BaseRead):
    """One position of the series and what the tournament DECIDED for it.

    Distinct from ``MatchRead``, which is what a parsed log OBSERVED: a position
    exists (and names its map) long before any log arrives, and a series may
    play the same map twice — only ``position`` tells those two plays apart.
    """

    position: int
    map_id: int | None = None
    map: MapRead | None = None
    state: str
    result_source: str | None = None
    result_version: int = 0
    confirmed_at: datetime | None = None
    #: One line per participation seated in this game.
    teams: list[EncounterGameTeamRead] = []


class EncounterRead(BaseRead):
    name: str
    slot_count: int = 2
    scoring_preset: Literal["wins", "points"] = "wins"
    round: int
    best_of: int = 3
    tournament_id: int
    stage_id: int | None = None
    stage_item_id: int | None = None
    challonge_id: int | None
    closeness: float | None
    has_logs: bool
    status: str
    result_status: str = "none"
    #: Which writer decided the standing (``games``/``series_claim``/``admin``/
    #: ``import``); ``None`` while no official result exists, where readers show
    #: the running total of the confirmed games.
    result_source: str | None = None
    #: Bumped by every result write; a claim or report names the version it was
    #: made against so a correction in between makes it stale, not a winner.
    result_version: int = 0
    sources: list[EncounterSlotSourceRead] = []
    scheduled_at: datetime | None = None
    started_at: datetime | None = None
    ended_at: datetime | None = None
    current_map_index: int | None = None
    confirmed_at: datetime | None = None

    stage: StageSummaryRead | None
    stage_item: StageItemSummaryRead | None
    tournament: TournamentRead | None
    #: The live seats only; retired participations are history.
    teams: list[EncounterTeamRead] = []
    matches: list[MatchRead]
    games: list[EncounterGameRead] = []


class MatchRead(BaseRead):
    home_team_id: int | None = None
    away_team_id: int | None = None
    score: Score
    time: float | None
    log_name: str | None
    source: str

    encounter_id: int
    map_id: int
    # 1-based position in the series, NULL when unknown (every parsed log). Read
    # by the pre-game room to tell two plays of the SAME map apart.
    map_index: int | None = None
    code: str | None = None

    home_team: TeamRead | None
    away_team: TeamRead | None
    encounter: EncounterRead | None
    map: MapRead | None


class MatchReadWithStats(MatchRead):
    rounds: int
    home_team: TeamWithMatchStats
    away_team: TeamWithMatchStats


class EncounterFiltersRead(BaseModel):
    query: str = ""
    stage_id: int | None = None
    stage_item_id: int | None = None
    best_of: int | None = None
    status: str | None = None
    has_logs: bool | None = None
    closeness_min: float | None = None
    closeness_max: float | None = None
    scope: Literal["all", "my_team"] = "all"
    sort: str = "date"


class EncounterSavedViewCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    filters: EncounterFiltersRead


class EncounterSavedViewRead(BaseRead):
    name: str
    filters: EncounterFiltersRead
    sort_order: int
    workspace_id: int


class EncounterKpiRead(BaseModel):
    total_encounters: int
    recent_count: int
    with_logs_count: int
    with_logs_pct: float
    avg_closeness: float | None
    live_now_count: int
    upcoming_count: int


class EncounterHistogramBucketRead(BaseModel):
    label: str
    start: float
    end: float
    count: int


class EncounterScoreHeatmapCellRead(BaseModel):
    """One scoreline of a two-seat encounter, slot 1 against slot 2."""

    slot_one: int
    slot_two: int
    count: int


class EncounterStageSplitRead(BaseModel):
    name: str
    count: int
    pct: float


class EncounterMapMetricRead(BaseModel):
    name: str
    count: int


class EncounterPulseRead(BaseModel):
    avg_series_seconds: float | None
    completed_series_count: int
    sweep_rate: float
    sweep_count: int
    went_distance_count: int
    reverse_sweep_rate: float
    most_decisive_map: str | None


class EncounterSlotBalanceRead(BaseModel):
    """How often each seat of a duel wins — the seeding bias a bracket's slot 1
    carries, which is all "side" ever meant here."""

    slot_one_wins: int
    slot_two_wins: int
    slot_one_win_pct: float
    slot_two_win_pct: float


class EncounterFeaturedRead(BaseModel):
    closest: list[EncounterRead]
    upcoming: list[EncounterRead]
    live: list[EncounterRead]


class EncounterOverviewRead(BaseModel):
    kpis: EncounterKpiRead
    preset_counts: dict[str, int]
    closeness_histogram: list[EncounterHistogramBucketRead]
    score_heatmap: list[EncounterScoreHeatmapCellRead]
    stage_split: list[EncounterStageSplitRead]
    featured: EncounterFeaturedRead
    hot_maps: list[EncounterMapMetricRead]
    pulse: EncounterPulseRead
    slot_balance: EncounterSlotBalanceRead


@dataclass
class EncounterSearchParams(pagination.PaginationSortSearchParams):
    tournament_id: int | None = None
    stage_id: int | None = None
    stage_item_id: int | None = None
    best_of: int | None = None
    status: str | None = None
    has_logs: bool | None = None
    closeness_min: float | None = None
    closeness_max: float | None = None
    scope: Literal["all", "my_team"] = "all"
    #: ``None`` reads as 2: every existing list, search and overview is a list
    #: of duels, and a lobby's table is drawn by the FFA read instead.
    slot_count: int | None = None

    def apply_search(self, query: sa.Select, model: type[db.Base]) -> sa.Select:
        criteria = []
        search_query = f"%{self.query}%"
        for field in self.fields:
            column = model.depth_get_column(field.split("."))
            criteria.append(column.ilike(search_query))
            if field == "name":
                reverted_name = sa.func.concat(
                    (sa.func.split_part(column, " vs ", 2)),
                    " vs ",
                    (sa.func.split_part(column, " vs ", 1)),
                )
                criteria.append(reverted_name.ilike(f"%{self.query}%"))
        return query.where(sa.or_(*criteria))


class EncounterSearchQueryParams(pagination.PaginationSortSearchQueryParams):
    tournament_id: int | None = None
    stage_id: int | None = None
    stage_item_id: int | None = None
    best_of: int | None = None
    status: str | None = None
    has_logs: bool | None = None
    closeness_min: float | None = Field(default=None, ge=0.0, le=1.0)
    closeness_max: float | None = Field(default=None, ge=0.0, le=1.0)
    scope: Literal["all", "my_team"] = "all"
    #: ``None`` reads as 2: every existing list, search and overview is a list
    #: of duels, and a lobby's table is drawn by the FFA read instead.
    slot_count: int | None = None


@dataclass
class MatchSearchParams(pagination.PaginationSortSearchParams):
    tournament_id: int | None = None
    home_team_id: int | None = None
    away_team_id: int | None = None

    def apply_search(self, query: sa.Select, model: type[db.Base]) -> sa.Select:
        criteria = []
        search_query = f"%{self.query}%"
        for field in self.fields:
            column = model.depth_get_column(field.split("."))
            criteria.append(column.ilike(search_query))
            if field == "log_name":
                criteria.append(sa.func.split_part(column, ".", 1).ilike(search_query))
        return query.where(sa.or_(*criteria))


class MatchSearchQueryParams(pagination.PaginationSortSearchQueryParams):
    tournament_id: int | None = None
    home_team_id: int | None = None
    away_team_id: int | None = None


# EncounterRead.matches forward-references MatchRead, defined below it; see the
# note at the tail of schemas/team.py for why the lazy rebuild is not enough.
EncounterRead.model_rebuild()
MatchRead.model_rebuild()
