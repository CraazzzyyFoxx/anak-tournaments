import typing
from datetime import datetime

from pydantic import BaseModel, Field

from shared.core.pagination import SortOrder

__all__ = (
    "TournamentStatistics",
    "PlayerStatistics",
    "PlayerLeaderboardQueryParams",
    "PlayerLeaderboardRow",
    "StatRef",
    "StatMapRef",
    "StatRecordCode",
    "StatRecord",
    "StatRecords",
    "MapStat",
    "MapModeStats",
    "MapStatsResponse",
    "OverallStatistics",
    "TournamentReadiness",
)


class TournamentStatistics(BaseModel):
    id: int
    name: str
    players_count: int
    avg_sr: float
    avg_closeness: float | None


class PlayerStatistics(BaseModel):
    id: int
    name: str
    value: int | float


class PlayerLeaderboardQueryParams(BaseModel):
    page: int = Field(default=1, ge=1)
    per_page: int = Field(default=20, ge=1, le=100)
    sort: typing.Literal["titles", "tournaments", "maps_won", "winrate"] = "titles"
    order: SortOrder = SortOrder.DESC
    #: Case-insensitive substring of the player's name; it filters the page, never renumbers ``rank``.
    query: str = ""


class PlayerLeaderboardRow(BaseModel):
    #: Competition rank (1, 2, 2, 4) by the sort metric over the whole population.
    rank: int
    id: int
    name: str
    titles: int
    tournaments: int
    maps_won: int
    maps_lost: int
    #: ``maps_won / (maps_won + maps_lost)``; null without maps.
    winrate: float | None
    #: Three tournaments or fewer: below the win-rate board's threshold.
    low_sample: bool


class StatRef(BaseModel):
    id: int
    name: str


class StatMapRef(BaseModel):
    id: int
    name: str
    slug: str
    image_path: str | None


StatRecordCode = typing.Literal[
    "win_streak",
    "biggest_upset",
    "underdog_champion",
    "closest_final",
    "hero_damage",
    "healing",
    "eliminations",
    "damage_blocked",
    "solo_kills",
    "most_mvps",
    "longest_map",
]


class StatRecord(BaseModel):
    code: StatRecordCode
    value: float
    player: StatRef | None = None
    team: StatRef | None = None
    opponent: StatRef | None = None
    tournament: StatRef | None = None
    encounter_id: int | None = None
    match_id: int | None = None
    map: StatMapRef | None = None
    #: Series score, ``team`` first.
    score: tuple[float, float] | None = None
    duration_s: float | None = None
    started_at: datetime | None = None
    ended_at: datetime | None = None
    relative: float | None = None
    of_total: int | None = None


class StatRecords(BaseModel):
    records: list[StatRecord]


class MapStat(BaseModel):
    map: StatMapRef
    games: int
    #: ``games`` over the mode's games.
    share: float
    avg_duration_s: float | None


class MapModeStats(BaseModel):
    #: The mode the games were played in (the game's/match's own); null for games without one.
    mode: StatMapRef | None
    games: int
    maps: list[MapStat]


class MapStatsResponse(BaseModel):
    total_games: int
    modes: list[MapModeStats]


class OverallStatistics(BaseModel):
    tournaments: int
    teams: int
    players: int
    champions: int
    # Played volume — see tournament-service's copy of this model, which is the
    # one the public endpoint serves.
    encounters: int
    maps: int
    days: int
    hours: int


class TournamentReadiness(BaseModel):
    """Living-checklist aggregate for one tournament.

    Field groups are masked by the caller's workspace permissions:
    ``tournament.read`` gates the setup/bracket/logs/recalc fields, ``team.read``
    the registration/pool/balance/draft fields, ``match.read`` the result backlog
    and ``achievement.read`` the evaluation status — a missing group yields
    ``None`` so the checklist renders "no-access" instead of zeros.
    """

    tournament_id: int
    status: str
    team_formation: str
    # visible with tournament.read:
    schedule_configured: bool | None
    grid_selected: bool | None
    stages_total: int | None
    stage_slots_filled: bool | None
    bracket_generated: bool | None
    # Duels only (slot_count == 2): a lobby never produces a match log.
    duel_encounters_total: int | None
    duel_encounters_with_logs: int | None
    logs_used: bool | None
    standings_recalc_pending: bool | None
    # visible with team.read (None -> checklist renders no-access):
    registration_form_configured: bool | None
    registrations_pending: int | None
    registrations_approved: int | None
    registrations_checked_in: int | None
    registrations_ranked: int | None
    pool_ready: int | None
    pool_need_fix: int | None
    balance_saved: bool | None
    balance_exported_at: str | None
    draft_session_status: str | None
    # visible with match.read (overdue: result_status none, scheduled_at < now, status != completed):
    results_overdue: int | None
    results_pending_confirmation: int | None
    results_disputed: int | None
    # visible with achievement.read: latest evaluation run status; "none" = never ran;
    # "not_configured" = no enabled rules for the tournament's discipline
    achievements_status: str | None
