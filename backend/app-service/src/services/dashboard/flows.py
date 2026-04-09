from sqlalchemy.ext.asyncio import AsyncSession

from src import schemas

from . import service


async def get_dashboard_stats(
    session: AsyncSession,
    workspace_id: int | None = None,
) -> schemas.DashboardStats:
    counts, issues, active_stats = await _gather(session, workspace_id)

    active_tournament_stats = None
    if active_stats is not None:
        active_tournament_stats = schemas.DashboardActiveTournamentStats(**active_stats)

    return schemas.DashboardStats(
        **counts,
        active_tournament_stats=active_tournament_stats,
        issues=schemas.DashboardIssues(**issues),
    )


async def _gather(
    session: AsyncSession,
    workspace_id: int | None,
) -> tuple[dict, dict, dict | None]:
    counts = await service.get_counts(session, workspace_id)
    issues = await service.get_issues(session, workspace_id)
    active_stats = await service.get_active_tournament_stats(session, workspace_id)
    return counts, issues, active_stats
