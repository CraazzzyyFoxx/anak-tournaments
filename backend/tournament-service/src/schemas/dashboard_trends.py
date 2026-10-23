from datetime import datetime

from pydantic import BaseModel

__all__ = ("DashboardTrendPoint", "DashboardTrends")


class DashboardTrendPoint(BaseModel):
    tournament_id: int
    tournament_name: str
    discipline: str
    start_date: datetime | None
    participants: int  # count(Player) of the tournament
    newcomers: int  # count(Player WHERE is_newcomer)
    duel_encounters_total: int  # slot_count == 2
    duel_encounters_with_logs: int
    # percentile_cont(0.5) of epoch(confirmed_at - ended_at) where both set and confirmed_at >= ended_at
    median_confirm_seconds: float | None


class DashboardTrends(BaseModel):
    points: list[DashboardTrendPoint]  # oldest → newest, at most 10
