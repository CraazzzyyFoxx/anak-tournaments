import typing

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from shared.division_grid import DEFAULT_GRID, DivisionGrid, division_case_expr, load_runtime_grid
from shared.models.division_grid import DivisionGridMapping, DivisionGridMappingRule, DivisionGridVersion

from src import models


async def get_analytics(
    session: AsyncSession,
) -> typing.Sequence[tuple[models.Team, models.Player, models.Tournament, int, int, int, int, int, int]]:
    pph = (
        sa.select(
            models.Player.user_id,
            models.Player.role,
            models.Player.team_id,
            sa.func.sum(models.Encounter.home_score).label("wins"),
            sa.func.sum(models.Encounter.away_score).label("losses"),
        )
        .join(models.Encounter, models.Player.team_id == models.Encounter.home_team_id)
        .join(models.Tournament, models.Encounter.tournament_id == models.Tournament.id)
        .where(models.Tournament.id >= 1, models.Tournament.is_league.is_(False))
        .group_by(models.Player.user_id, models.Player.role, models.Player.team_id)
    ).cte("player_points_home")

    ppa = (
        sa.select(
            models.Player.user_id,
            models.Player.role,
            models.Player.team_id,
            sa.func.sum(models.Encounter.away_score).label("wins"),
            sa.func.sum(models.Encounter.home_score).label("losses"),
        )
        .join(models.Encounter, models.Player.team_id == models.Encounter.away_team_id)
        .join(models.Tournament, models.Encounter.tournament_id == models.Tournament.id)
        .where(models.Tournament.id >= 1, models.Tournament.is_league.is_(False))
        .group_by(models.Player.user_id, models.Player.role, models.Player.team_id)
    ).cte("player_points_away")

    query = (
        sa.select(
            models.Team.id,
            models.Player,
            models.Tournament.id,
            sa.func.coalesce(pph.c.wins, 0) + sa.func.coalesce(ppa.c.wins, 0),
            sa.func.coalesce(pph.c.losses, 0) + sa.func.coalesce(ppa.c.losses, 0),
            sa.func.lag(models.Player.rank, 1).over(
                partition_by=(models.Player.user_id, models.Player.role),
                order_by=models.Tournament.id,
            ),
            sa.func.lag(models.Player.rank, 2).over(
                partition_by=(models.Player.user_id, models.Player.role),
                order_by=models.Tournament.id,
            ),
            sa.func.lag(division_case_expr(models.Player.rank, DEFAULT_GRID), 1).over(
                partition_by=(models.Player.user_id, models.Player.role),
                order_by=models.Tournament.id,
            ),
            sa.func.lag(division_case_expr(models.Player.rank, DEFAULT_GRID), 2).over(
                partition_by=(models.Player.user_id, models.Player.role),
                order_by=models.Tournament.id,
            ),
        )
        .join(models.Player, models.Team.id == models.Player.team_id)
        .join(models.Tournament, models.Player.tournament_id == models.Tournament.id)
        .join(
            pph,
            sa.and_(
                models.Player.user_id == pph.c.user_id,
                models.Player.role == pph.c.role,
                models.Player.team_id == pph.c.team_id,
            ),
            isouter=True,
        )
        .join(
            ppa,
            sa.and_(
                models.Player.user_id == ppa.c.user_id,
                models.Player.role == ppa.c.role,
                models.Player.team_id == ppa.c.team_id,
            ),
            isouter=True,
        )
        .where(
            models.Tournament.id >= 1,
            models.Tournament.is_league.is_(False),
            models.Player.is_substitution.is_(False),
        )
    )

    result = await session.execute(query)
    return result.all()  # type: ignore


async def get_matches(session: AsyncSession, start_range: int, end_range: int) -> typing.Sequence[models.Encounter]:
    query = (
        sa.select(models.Encounter)
        .options(
            sa.orm.joinedload(models.Encounter.home_team),
            sa.orm.joinedload(models.Encounter.away_team),
            sa.orm.joinedload(models.Encounter.home_team).joinedload(models.Team.players),
            sa.orm.joinedload(models.Encounter.away_team).joinedload(models.Team.players),
            sa.orm.joinedload(models.Encounter.home_team)
            .joinedload(models.Team.players)
            .joinedload(models.Player.user),
            sa.orm.joinedload(models.Encounter.away_team)
            .joinedload(models.Team.players)
            .joinedload(models.Player.user),
            sa.orm.joinedload(models.Encounter.tournament),
        )
        .join(models.Tournament, models.Encounter.tournament_id == models.Tournament.id)
        .where(
            models.Encounter.tournament_id.between(start_range, end_range),
            models.Tournament.is_league.is_(False),
        )
        .order_by(models.Encounter.tournament_id, models.Encounter.id)
    )
    result = await session.scalars(query)
    return result.unique().all()  # type: ignore


async def get_algorithm(session: AsyncSession, name: str) -> models.AnalyticsAlgorithm:
    query = sa.select(models.AnalyticsAlgorithm).where(models.AnalyticsAlgorithm.name == name)
    result = await session.execute(query)
    return result.scalar_one()  # type: ignore


async def get_tournament_version_ids(
    session: AsyncSession,
) -> dict[int, int | None]:
    """Maps tournament_id -> division_grid_version_id for all analytics-relevant tournaments."""
    result = await session.execute(
        sa.select(models.Tournament.id, models.Tournament.division_grid_version_id)
        .where(models.Tournament.id >= 1, models.Tournament.is_league.is_(False))
    )
    return {row[0]: row[1] for row in result.all()}


async def get_grid_versions(
    session: AsyncSession,
    version_ids: set[int],
) -> dict[int, DivisionGrid]:
    """Loads DivisionGrid runtime objects keyed by version_id."""
    if not version_ids:
        return {}
    result = await session.execute(
        sa.select(DivisionGridVersion)
        .options(sa.orm.selectinload(DivisionGridVersion.tiers))
        .where(DivisionGridVersion.id.in_(version_ids))
    )
    return {v.id: load_runtime_grid(v) for v in result.scalars().unique().all()}


async def get_primary_division_mappings(
    session: AsyncSession,
    pairs: list[tuple[int, int]],
) -> dict[tuple[int, int], dict[int, int]]:
    """
    For each (source_version_id, target_version_id) pair, returns
    {source_tier_number -> target_tier_number} using the primary mapping rule.
    Pairs with no mapping in the DB are silently omitted.
    """
    if not pairs:
        return {}

    source_ids = [p[0] for p in pairs]
    target_ids = [p[1] for p in pairs]

    mappings_result = await session.execute(
        sa.select(DivisionGridMapping)
        .options(
            sa.orm.selectinload(DivisionGridMapping.rules).selectinload(DivisionGridMappingRule.source_tier),
            sa.orm.selectinload(DivisionGridMapping.rules).selectinload(DivisionGridMappingRule.target_tier),
        )
        .where(
            DivisionGridMapping.source_version_id.in_(source_ids),
            DivisionGridMapping.target_version_id.in_(target_ids),
        )
    )

    pairs_set = set(pairs)
    out: dict[tuple[int, int], dict[int, int]] = {}
    for mapping in mappings_result.scalars().unique().all():
        key = (mapping.source_version_id, mapping.target_version_id)
        if key not in pairs_set:
            continue
        tier_map: dict[int, int] = {}
        for rule in mapping.rules:
            source_num = rule.source_tier.number
            target_num = rule.target_tier.number
            # prefer primary rule; fall back to first seen for single-target rules
            if rule.is_primary or source_num not in tier_map:
                tier_map[source_num] = target_num
        out[key] = tier_map
    return out


async def get_players_by_tournament_id(
    session: AsyncSession, tournament_id: int
) -> typing.Sequence[models.AnalyticsPlayer]:
    query = (
        sa.select(models.AnalyticsPlayer)
        .join(models.Player, models.AnalyticsPlayer.player_id == models.Player.id)
        .where(models.AnalyticsPlayer.tournament_id == tournament_id)
    )
    result = await session.execute(query)
    return result.scalars().all()  # type: ignore
