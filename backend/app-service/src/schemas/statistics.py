from pydantic import BaseModel

__all__ = (
    "TournamentStatistics",
    "PlayerStatistics",
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
    ``tournament.read`` gates the setup/bracket/logs fields, ``team.read`` gates
    the registration/pool/balance/draft fields — a missing group yields ``None``
    so the checklist renders "no-access" instead of zeros.
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
    encounters_total: int | None
    encounters_with_logs: int | None
    logs_used: bool | None
    # visible with team.read (None -> checklist renders no-access):
    registration_form_configured: bool | None
    registration_open: bool | None
    registrations_pending: int | None
    registrations_approved: int | None
    registrations_checked_in: int | None
    registrations_ranked: int | None
    pool_ready: int | None
    pool_need_fix: int | None
    balance_saved: bool | None
    balance_exported_at: str | None
    draft_session_status: str | None
