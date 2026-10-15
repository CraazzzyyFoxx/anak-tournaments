import datetime
import json
import typing
from dataclasses import dataclass, field

import sqlalchemy as sa
from pydantic import BaseModel, BeforeValidator, Field

from shared.domain.roster_shape import RegistrationRoleCode
from shared.schemas.role import RoleRef
from src import schemas
from src.core import enums, pagination
from src.schemas import MapRead
from src.schemas.base import Score
from src.schemas.division_grid import DivisionGridVersionRead

# Structured GET filters are JSON-encoded query values; RPC callers may supply the object directly.
RoleQuery = typing.Annotated[
    RoleRef | None, BeforeValidator(lambda value: json.loads(value) if isinstance(value, str) else value)
]

__all__ = (
    "UserProfile",
    "UserDraftCard",
    "UserDraftCardHero",
    "UserDraftCardRole",
    "UserDraftCardTournament",
    "UserRole",
    "UserTournamentWithStats",
    "UserTournament",
    "UserTournamentSummary",
    "UserTournamentPlayer",
    "UserEncounterTournament",
    "UserEncounterStageSummary",
    "UserEncounterStageItemSummary",
    "UserEncounterTeamSummary",
    "UserEncounterTeamPlayerRef",
    "MatchReadWithUserStats",
    "EncounterReadWithUserStats",
    "UserMap",
    "UserMapHeroStats",
    "UserMapHighlight",
    "UserMapsOverall",
    "UserMapsSummary",
    "UserMapsSearchParams",
    "UserMapsSearchQueryParams",
    "UserTournamentStat",
    "LobbyLeaderboardEntry",
    "LobbyLeaderboard",
    "HeroStat",
    "HeroWithUserStats",
    "HeroStatBest",
    "UserBestTeammate",
    "UserOpponentStat",
    "UserStageRecord",
    "UserMatchesSummary",
    "UserSearch",
    "UserOverviewRoleDivision",
    "UserOverviewDivisionCount",
    "UserOverviewHero",
    "UserOverviewAverages",
    "UserOverviewRow",
    "UserOverviewResponse",
    "UserOverviewQueryParams",
    "UserOverviewParams",
    "UserOverviewStats",
    "UserOverviewStatsQueryParams",
    "UserCatalogLetter",
    "UserCatalogEntry",
    "UserCatalogResponse",
    "UserCatalogQueryParams",
    "UserCatalogParams",
    "UserCompareQueryParams",
    "UserCompareParams",
    "UserCompareBaselineMode",
    "UserCompareUser",
    "UserCompareBaselineInfo",
    "UserCompareMetric",
    "UserCompareResponse",
    "UserHeroCompareQueryParams",
    "UserHeroCompareParams",
    "UserHeroCompareMetric",
    "UserHeroCompareResponse",
)


class UserRole(BaseModel):
    role: RoleRef | None = None
    tournaments: int
    maps_won: int
    maps: int
    division: int
    division_grid_version: DivisionGridVersionRead | None = None


class UserTournamentSummary(BaseModel):
    """Tournament card shown in user profile / achievement filter lists.

    Narrow projection of `models.Tournament` — only fields the frontend
    actually consumes in user-scoped pages.
    """

    id: int
    name: str
    is_league: bool
    is_finished: bool = False
    status: enums.TournamentStatus | None = None
    division_grid_version: DivisionGridVersionRead | None = None


class UserTournamentPlayer(BaseModel):
    """Player card inside `UserTournament.players` (rendered by TournamentTeamTable).

    Also populated inside `UserEncounterTeamSummary.players` when the
    encounter view needs to identify the viewer's row (via `user_id`).
    """

    id: int
    name: str
    role: RoleRef | None = None
    rank: int
    division: int
    user_id: int
    is_substitution: bool
    is_newcomer: bool
    is_newcomer_role: bool
    related_player_id: int | None = None
    relative_player: int | None = None
    # Average MVP placement (1 = best) across this player's matches in THIS
    # tournament. Mirrors the dossier "Avg MVP" metric: per match take
    # COALESCE(ImpactRank, Performance); ImpactRank preferred, Performance the
    # legacy fallback. `None` when the player has no such stat rows.
    avg_mvp: float | None = None
    # This player's top heroes by playtime in THIS tournament (same hero-read
    # shape used elsewhere on the response). Empty when none recorded.
    heroes: list[schemas.HeroRead] = Field(default_factory=list)


class UserEncounterTournament(BaseModel):
    """Tournament link inside `EncounterReadWithUserStats.tournament`."""

    id: int
    name: str
    is_league: bool
    is_finished: bool = False
    status: enums.TournamentStatus | None = None


class UserEncounterStageSummary(BaseModel):
    """Stage link inside `EncounterReadWithUserStats.stage`."""

    id: int
    name: str


class UserEncounterStageItemSummary(BaseModel):
    """Stage-item link inside `EncounterReadWithUserStats.stage_item`."""

    id: int
    name: str


class UserEncounterTeamPlayerRef(BaseModel):
    """Roster member inside an encounter seat — minimal id+user_id+role.

    Used only by the frontend to identify which seat the viewer played in
    (`players.find(p => p.user_id === selfUserId)`). Renders nothing on its
    own — for the full player card see `UserTournamentPlayer`. ``id`` is the
    roster snapshot row, not a tournament player.
    """

    id: int
    user_id: int
    role: RoleRef | None = None
    name: str


class UserEncounterTeamSummary(BaseModel):
    """One live seat inside `EncounterReadWithUserStats.teams`.

    ``id`` is the participation (``encounter.team``), ``team_id`` the source
    tournament team -- ``None`` once that team is deleted; ``name`` is the
    snapshot the encounter was played under, and ``players`` its roster snapshot.
    """

    id: int
    slot: int
    team_id: int | None = None
    name: str
    score: float = 0.0
    placement: int | None = None
    players: list[UserEncounterTeamPlayerRef] = Field(default_factory=list)


class MatchReadWithUserStats(BaseModel):
    """Match within a user-scoped encounter, with the viewer's performance."""

    id: int
    home_team_id: int | None = None
    away_team_id: int | None = None
    score: Score
    time: float | None
    log_name: str | None
    encounter_id: int
    map_id: int
    # 1-based play order inside the series. NULL on logs written before the
    # column existed; callers restore those from the map pool when one exists.
    map_index: int | None = None
    code: str | None = None
    map: MapRead | None = None
    performance: int | None = None
    impact_rank: int | None = None
    impact_points: float | None = None
    overperformance_score: float | None = None
    overperformance_badge: bool = False
    heroes: list[schemas.HeroRead] = Field(default_factory=list)


class EncounterReadWithUserStats(BaseModel):
    """Encounter rendered on the user encounters page."""

    id: int
    name: str
    slot_count: int = 2
    round: int
    best_of: int = 3
    tournament_id: int
    status: str
    closeness: float | None = None
    has_logs: bool = False
    result_status: str = "none"
    user_team_id: int | None = None  # the source team the viewer played for
    tournament: UserEncounterTournament | None = None
    stage: UserEncounterStageSummary | None = None
    stage_item: UserEncounterStageItemSummary | None = None
    #: The live seats in slot order; a retired participation is history.
    teams: list[UserEncounterTeamSummary] = Field(default_factory=list)
    matches: list[MatchReadWithUserStats] = Field(default_factory=list)


class UserTournament(BaseModel):
    id: int
    name: str
    is_league: bool
    team_id: int
    team: str
    players: list[UserTournamentPlayer]
    closeness: float
    placement: int | None
    count_teams: int
    won: int
    lost: int
    draw: int
    maps_won: int
    maps_lost: int
    # Nullable because the user may not have a Player record on the team
    # (e.g. teams returned for adjacency aggregates have no resolved role).
    role: RoleRef | None = None
    division: int | None = None
    division_grid_version: DivisionGridVersionRead | None = None
    # Populated only by `get_tournament_encounters` (the lazy per-tournament
    # dossier detail); `get_tournaments` (the list endpoint) leaves this `[]`
    # so the list response doesn't ship every tournament's full encounter/
    # match history up front — see services/user/service.py::get_tournaments.
    encounters: list[EncounterReadWithUserStats] = Field(default_factory=list)


class UserTournamentStat(BaseModel):
    value: float
    rank: int
    total: int


class UserTournamentWithStats(BaseModel):
    id: int
    name: str
    division: int
    # `division` is resolved against the tournament's own grid (see
    # get_tournament_with_stats). Ship the grid version too so the frontend
    # renders the division icon on that same grid instead of falling back to
    # the workspace default.
    division_grid_version: DivisionGridVersionRead | None = None
    closeness: float
    role: RoleRef | None = None
    group_placement: float | None
    playoff_placement: float | None
    maps_won: int
    maps: int
    playtime: float

    stats: dict[enums.LogStatsName | typing.Literal["winrate"], UserTournamentStat]


class LobbyLeaderboardEntry(BaseModel):
    """One player's ranked value for a single stat inside a tournament lobby."""

    rank: int
    player_id: int  # user id (models.User.id)
    name: str
    value: float


class LobbyLeaderboard(BaseModel):
    """Full ranked list of every player in a tournament for one stat.

    Exposes the whole ranked population behind a single user's
    ``UserTournamentWithStats.stats[stat].{rank,total}`` so the frontend can
    render a per-stat "lobby leaderboard" modal.
    """

    stat: enums.LogStatsName
    total_players: int
    entries: list[LobbyLeaderboardEntry]


class UserMapHeroStats(BaseModel):
    hero: schemas.HeroRead
    games: int
    win: int
    loss: int
    draw: int
    win_rate: float
    playtime_seconds: float
    playtime_share_on_map: float


class UserMap(BaseModel):
    map: MapRead
    count: int
    win: int
    loss: int
    draw: int
    win_rate: float
    heroes: list[schemas.HeroPlaytime]
    hero_stats: list[UserMapHeroStats] | None = None


class UserMapHighlight(BaseModel):
    map: MapRead
    count: int
    win: int
    loss: int
    draw: int
    win_rate: float


class UserMapsOverall(BaseModel):
    total_maps: int
    total_games: int
    win: int
    loss: int
    draw: int
    win_rate: float


class UserMapsSummary(BaseModel):
    overall: UserMapsOverall
    most_played: UserMapHighlight | None
    best: UserMapHighlight | None
    worst: UserMapHighlight | None


class UserMapsSearchQueryParams(pagination.PaginationSortSearchQueryParams):
    min_count: int | None = Field(default=None, ge=1)
    gamemode_id: int | None = None
    tournament_id: int | None = None


@dataclass
class UserMapsSearchParams(pagination.PaginationSortSearchParams):
    min_count: int | None = None
    gamemode_id: int | None = None
    tournament_id: int | None = None

    def apply_search(self, query: sa.Select, model: type) -> sa.Select:
        fields = self.fields if self.fields else ["name"]
        return pagination.apply_search(model, query, self.query, fields)


class UserProfile(BaseModel):
    tournaments_count: int
    tournaments_won: int
    maps_total: int
    maps_won: int
    avg_closeness: float | None
    avg_placement: float | None
    avg_playoff_placement: float | None
    avg_group_placement: float | None
    most_played_hero: schemas.HeroRead | None
    heroes_count: int

    roles: list[UserRole]
    tournaments: list[UserTournamentSummary]
    hero_statistics: list[schemas.HeroPlaytime]


class UserDraftCardRole(BaseModel):
    """One role's map record on the draft-room player card."""

    role: RoleRef | None = None
    maps: int
    maps_won: int


class UserDraftCardHero(BaseModel):
    """One of the player's signature heroes on the draft-room player card."""

    hero: schemas.HeroRead
    role: RegistrationRoleCode
    maps: int
    maps_won: int


class UserDraftCardTournament(BaseModel):
    """One recent tournament row on the draft-room player card."""

    id: int
    name: str
    date: datetime.date | None = None
    role: RoleRef | None = None
    #: The player's raw rank on that tournament's roster (never a resolved
    #: division — the draft room resolves it against the tournament's own grid).
    rank: int | None = None
    placement: int | None = None
    teams_count: int


class UserDraftCard(BaseModel):
    """Career summary rendered on the draft room's player island.

    Leagues are excluded throughout (no placement, no bracket) so every number
    on the card counts the same set of events. A player with no history is a
    valid card of zeros and empty lists, never a 404.
    """

    tournaments: int
    tournaments_won: int
    maps: int
    maps_won: int
    maps_lost: int
    #: Maps the player finished first on the lobby's MVP placement
    #: (``COALESCE(ImpactRank, Performance) == 1``); ``None`` only if that
    #: placement can never be computed.
    mvp_maps: int | None = None
    best_placement: int | None = None
    avg_placement: float | None = None
    roles: list[UserDraftCardRole] = Field(default_factory=list)
    #: Every hero played, most-played first: the table shows the top five, the
    #: role tiles look up the heroes the player declared.
    heroes: list[UserDraftCardHero] = Field(default_factory=list)
    #: Newest first, at most 5.
    recent_tournaments: list[UserDraftCardTournament] = Field(default_factory=list)


class HeroStatBest(BaseModel):
    encounter_id: int
    tournament_name: str
    map_name: str
    map_image_path: str
    value: float
    player_name: str


class HeroStat(BaseModel):
    name: enums.LogStatsName
    overall: float
    best: HeroStatBest
    avg_10: float
    best_all: HeroStatBest | None
    avg_10_all: float


class HeroWithUserStats(BaseModel):
    hero: schemas.HeroRead
    stats: list[HeroStat]


class UserBestTeammate(BaseModel):
    user: schemas.UserRead
    tournaments: int
    maps: int
    winrate: float
    stats: dict[enums.LogStatsName, float | None]


class UserOpponentStat(BaseModel):
    name: str
    wins: int
    losses: int
    draws: int


class UserStageRecord(BaseModel):
    w: int
    l: int  # noqa: E741 — terse {w,l} record mirrored by the Matches-tab sidebar


class UserMatchesSummary(BaseModel):
    """Aggregates for the Matches-tab sidebars, computed over ALL the user's
    encounters (not just the current page): most-fought opponents + per-stage
    win/loss record."""

    opponents: list[UserOpponentStat]
    stages: dict[str, UserStageRecord]


class UserSearch(BaseModel):
    id: int
    name: str


class UserOverviewRoleDivision(BaseModel):
    role: RoleRef | None = None
    division: int
    # Which grid ``division`` is a number on: the workspace's target grid in a
    # scoped read, the role's own tournament grid in the all-workspaces read.
    # The grids themselves ship once per response in ``division_grids``.
    division_grid_version_id: int | None = None


class UserOverviewHero(BaseModel):
    hero: schemas.HeroRead
    playtime_seconds: float


class UserOverviewAverages(BaseModel):
    avg_closeness: float | None
    avg_placement: float | None
    avg_playoff_placement: float | None
    avg_group_placement: float | None


class UserOverviewRow(BaseModel):
    id: int
    name: str
    avatar_url: str | None = None
    roles: list[UserOverviewRoleDivision]
    top_heroes: list[UserOverviewHero]
    tournaments_count: int
    achievements_count: int
    maps_won: int
    maps_lost: int
    encounters_played: int
    best_placement: int | None
    #: ISO date of the latest tournament the user played in, scoped like the
    #: other aggregates. ``None`` when they never played one.
    last_active_at: str | None
    averages: UserOverviewAverages


class UserOverviewResponse(pagination.Paginated[UserOverviewRow]):
    """Overview page plus every division grid its rows' divisions refer to."""

    division_grids: list[DivisionGridVersionRead] = Field(default_factory=list)


#: A division chip value. Repeated param: ``?divisions=3&divisions=5``.
DivisionNumber = typing.Annotated[int, Field(ge=1, le=20)]


class UserOverviewQueryParams(
    pagination.PaginationSortSearchQueryParams[
        typing.Literal[
            "id",
            "name",
            "tournaments_count",
            "achievements_count",
            "avg_placement",
            "winrate",
            "best_placement",
        ]
    ]
):
    role: RoleQuery = None
    divisions: list[DivisionNumber] = Field(default_factory=list)
    has_logs: bool = False
    #: ``sort=winrate`` only: users under this many encounters are ordered after
    #: everyone else, in both directions.
    min_encounters: int = Field(default=20, ge=0)


@dataclass
class UserOverviewParams(pagination.PaginationSortSearchParams):
    role: RoleRef | None = None
    has_role_filter: bool = False
    divisions: list[int] = field(default_factory=list)
    has_logs: bool = False
    min_encounters: int = 20

    @classmethod
    def from_query_params(cls, query_params: UserOverviewQueryParams) -> UserOverviewParams:
        params = super().from_query_params(query_params)
        params.role = query_params.role
        params.has_role_filter = "role" in query_params.model_fields_set
        return params

    def apply_search(self, query: sa.Select, model: type) -> sa.Select:
        fields = self.fields if self.fields else ["name"]
        return pagination.apply_search(model, query, self.query, fields)


class UserOverviewDivisionCount(BaseModel):
    division: int
    count: int


class UserOverviewStats(BaseModel):
    total_players: int
    with_logs_count: int
    with_logs_pct: float
    avg_tournaments_per_player: float
    median_tournaments_per_player: float
    active_last_30d: int
    active_last_30d_pct: float
    tank_count: int
    damage_count: int
    support_count: int
    flex_count: int
    #: Players with no rated-role assignment, unlike ``flex_count`` which also counts multi-role players.
    flex_declared_count: int
    #: Per-division chip counts, computed without the division filter itself.
    division_counts: list[UserOverviewDivisionCount] = Field(default_factory=list)


class UserOverviewStatsQueryParams(BaseModel):
    role: RoleQuery = None
    divisions: list[DivisionNumber] = Field(default_factory=list)
    has_logs: bool = False
    query: str | None = None


class UserCatalogEntry(BaseModel):
    id: int
    name: str
    avatar_url: str | None = None
    roles: list[UserOverviewRoleDivision]
    top_heroes: list[UserOverviewHero]
    tournaments_count: int
    achievements_count: int
    maps_won: int
    maps_lost: int
    encounters_played: int
    best_placement: int | None
    last_active_at: str | None
    avg_placement: float | None


class UserCatalogLetter(BaseModel):
    letter: str
    count: int
    users: list[UserCatalogEntry]


class UserCatalogResponse(BaseModel):
    letters: list[UserCatalogLetter]
    total: int
    available_letters: list[str]
    division_grids: list[DivisionGridVersionRead] = Field(default_factory=list)


class UserCatalogQueryParams(BaseModel):
    role: RoleQuery = None
    divisions: list[DivisionNumber] = Field(default_factory=list)
    has_logs: bool = False
    query: str | None = None
    letter: str | None = Field(default=None, min_length=1, max_length=2)
    per_letter: int = Field(default=12, ge=1, le=50)
    max_letters: int = Field(default=27, ge=1, le=40)


@dataclass
class UserCatalogParams:
    role: RoleRef | None = None
    has_role_filter: bool = False
    divisions: list[int] = field(default_factory=list)
    has_logs: bool = False
    query: str | None = None
    letter: str | None = None
    per_letter: int = 12
    max_letters: int = 27

    @classmethod
    def from_query_params(cls, query_params: UserCatalogQueryParams) -> UserCatalogParams:
        data = query_params.model_dump()
        data["role"] = query_params.role
        data["has_role_filter"] = "role" in query_params.model_fields_set
        if data.get("letter"):
            data["letter"] = data["letter"].upper()
        return cls(**data)


UserCompareBaselineMode = typing.Literal["target_user", "global", "cohort"]


class UserCompareUser(BaseModel):
    id: int
    name: str


class UserCompareBaselineInfo(BaseModel):
    mode: UserCompareBaselineMode
    sample_size: int
    target_user: UserCompareUser | None
    role: RoleRef | None = None
    div_min: int | None
    div_max: int | None


class UserCompareMetric(BaseModel):
    key: str
    label: str
    subject_value: float | int | None
    baseline_value: float | int | None
    delta: float | None
    delta_percent: float | None
    better_worse: typing.Literal["better", "worse", "equal"] | None
    higher_is_better: bool
    subject_rank: int | None
    subject_percentile: float | None


class UserCompareResponse(BaseModel):
    subject: UserCompareUser
    baseline: UserCompareBaselineInfo
    metrics: list[UserCompareMetric]


class UserCompareQueryParams(BaseModel):
    baseline: UserCompareBaselineMode = "global"
    target_user_id: int | None = Field(default=None, ge=1)
    role: RoleQuery = None
    div_min: int | None = Field(default=None, ge=1, le=20)
    div_max: int | None = Field(default=None, ge=1, le=20)
    tournament_id: int | None = Field(default=None, ge=1)


@dataclass
class UserCompareParams:
    baseline: UserCompareBaselineMode = "global"
    target_user_id: int | None = None
    role: RoleRef | None = None
    div_min: int | None = None
    div_max: int | None = None
    tournament_id: int | None = None

    @classmethod
    def from_query_params(cls, query_params: UserCompareQueryParams):
        return cls(**(query_params.model_dump() | {"role": query_params.role}))


class UserHeroCompareMetric(BaseModel):
    stat: enums.LogStatsName
    left_value: float
    right_value: float
    delta: float
    delta_percent: float | None
    better_worse: typing.Literal["better", "worse", "equal"] | None
    higher_is_better: bool


class UserHeroCompareResponse(BaseModel):
    subject: UserCompareUser
    target: UserCompareUser | None
    baseline: UserCompareBaselineInfo
    subject_hero: schemas.HeroRead | None
    target_hero: schemas.HeroRead | None
    map: schemas.MapRead | None
    left_playtime_seconds: float
    right_playtime_seconds: float
    metrics: list[UserHeroCompareMetric]


class UserHeroCompareQueryParams(BaseModel):
    baseline: UserCompareBaselineMode = "global"
    target_user_id: int | None = Field(default=None, ge=1)
    left_hero_id: int | None = Field(default=None, ge=1)
    right_hero_id: int | None = Field(default=None, ge=1)
    map_id: int | None = Field(default=None, ge=1)
    role: RoleQuery = None
    div_min: int | None = Field(default=None, ge=1, le=20)
    div_max: int | None = Field(default=None, ge=1, le=20)
    tournament_id: int | None = Field(default=None, ge=1)
    stats: list[enums.LogStatsName] | None = None


@dataclass
class UserHeroCompareParams:
    baseline: UserCompareBaselineMode = "global"
    target_user_id: int | None = None
    left_hero_id: int | None = None
    right_hero_id: int | None = None
    map_id: int | None = None
    role: RoleRef | None = None
    div_min: int | None = None
    div_max: int | None = None
    tournament_id: int | None = None
    stats: list[enums.LogStatsName] = field(default_factory=list)

    @classmethod
    def from_query_params(cls, query_params: UserHeroCompareQueryParams):
        payload = query_params.model_dump()
        payload["role"] = query_params.role
        payload["stats"] = payload.get("stats") or []
        return cls(**payload)
