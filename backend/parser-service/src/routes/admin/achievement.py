"""Admin routes for achievement CRUD, registry, and streaming calculation"""

import asyncio
import traceback

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import EventSourceResponse
from fastapi.sse import ServerSentEvent
from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession

import main
from src import models, schemas
from src.core import auth, db, pagination
from src.schemas.admin import achievement as admin_schemas
from src.services.admin import achievement as admin_service
from src.services.achievement import flows as achievement_flows
from src.services.achievement import service as achievement_service
from src.services.tournament import flows as tournament_flows
from src.services.tournament import service as tournament_service

router = APIRouter(
    prefix="/achievements",
    tags=["admin", "achievements"],
)


# ─── Fixed-path routes FIRST (before /{id} to avoid path conflicts) ──────────


@router.get("/registry", response_model=admin_schemas.AchievementRegistryResponse)
async def get_achievement_registry(
    user: models.AuthUser = Depends(auth.require_permission("achievement", "read")),
):
    """Return all registered achievement slugs grouped by category."""
    category_maps = {
        "overall": achievement_flows.function_overall_map,
        "hero": achievement_flows.function_hero_map,
        "division": achievement_flows.function_division_map,
        "team": achievement_flows.function_team_map,
        "standing": achievement_flows.function_standing_map,
        "match": achievement_flows.function_match_map,
    }

    entries: list[admin_schemas.AchievementRegistryEntry] = []
    for category, fn_map in category_maps.items():
        for slug, fn in fn_map.items():
            entries.append(
                admin_schemas.AchievementRegistryEntry(
                    slug=slug,
                    category=category,
                    tournament_required=fn.tournament_required,
                )
            )

    # Add the special hero-kd entry
    entries.append(
        admin_schemas.AchievementRegistryEntry(
            slug="hero-kd",
            category="hero",
            tournament_required=True,
        )
    )

    return admin_schemas.AchievementRegistryResponse(entries=entries)


async def _require_sse_token(token: str = Query(..., description="JWT access token")) -> None:
    """Dependency that validates the SSE token query param (EventSource can't send headers)."""
    payload = await main.auth_client.validate_token(token)
    if not payload:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")


@router.get(
    "/calculate/stream",
    response_class=EventSourceResponse,
    dependencies=[Depends(_require_sse_token)],
)
async def stream_achievement_calculation(
    token: str = Query(..., description="JWT access token for authentication"),
    slugs: str | None = Query(None, description="Comma-separated achievement slugs to calculate"),
    tournament_id: int | None = Query(None, description="Optional tournament ID to scope calculation"),
    workspace_id: int | None = Query(None, description="Workspace ID to scope tournament selection"),
    ensure_created: bool = Query(True, description="Ensure base achievement definitions exist"),
):
    """SSE stream that yields real-time progress as achievements are calculated."""
    slug_list = [s.strip() for s in slugs.split(",") if s.strip()] if slugs else None

    async with db.async_session_maker() as session:
        yield ServerSentEvent(comment="connected")

        # Build the same registry as calculate_registered_achievements
        registry: dict[str, schemas.AchievementFunction] = {
            **achievement_flows.function_overall_map,
            **achievement_flows.function_hero_map,
            **achievement_flows.function_division_map,
            **achievement_flows.function_team_map,
            **achievement_flows.function_standing_map,
            **achievement_flows.function_match_map,
            "hero-kd": schemas.AchievementFunction(
                slug="hero-kd",
                tournament_required=True,
                function=achievement_service.create_hero_kd_achievements,
            ),
        }

        slugs_to_run = slug_list or list(registry.keys())

        # Validate slugs
        unknown = sorted(set(slugs_to_run) - set(registry.keys()))
        if unknown:
            yield ServerSentEvent(
                data={"type": "error", "message": f"Unknown slugs: {', '.join(unknown)}"},
                event="log",
            )
            return

        if ensure_created:
            try:
                await achievement_service.bulk_initial_create_achievements(session)
                yield ServerSentEvent(
                    data={"type": "info", "message": "Ensured achievement definitions exist"},
                    event="log",
                )
            except Exception as exc:
                logger.warning(f"Failed to ensure achievements: {exc}")
                yield ServerSentEvent(
                    data={"type": "error", "message": f"Failed to ensure definitions: {exc}"},
                    event="log",
                )
                return

        # Resolve tournament if specified
        tournament = None
        if tournament_id is not None:
            try:
                tournament = await tournament_flows.get(session, tournament_id, [])
            except Exception as exc:
                yield ServerSentEvent(
                    data={"type": "error", "message": f"Tournament not found: {exc}"},
                    event="log",
                )
                return

        total = len(slugs_to_run)
        executed: list[str] = []

        yield ServerSentEvent(
            data={"type": "start", "total": total, "slugs": slugs_to_run},
            event="log",
        )

        for i, slug in enumerate(slugs_to_run):
            try:
                yield ServerSentEvent(
                    data={
                        "type": "progress",
                        "slug": slug,
                        "index": i,
                        "total": total,
                        "status": "running",
                    },
                    event="log",
                )

                fn = registry[slug]

                if not fn.tournament_required:
                    await fn.function(session)
                elif tournament is not None:
                    await fn.function(session, tournament)
                else:
                    tournaments = (
                        await tournament_service.get_all(session, is_finished=True, workspace_id=workspace_id)
                        if slug == "hero-kd"
                        else await tournament_service.get_all(session, workspace_id=workspace_id)
                    )
                    for t in tournaments:
                        await fn.function(session, t)

                executed.append(slug)
                yield ServerSentEvent(
                    data={
                        "type": "progress",
                        "slug": slug,
                        "index": i,
                        "total": total,
                        "status": "done",
                    },
                    event="log",
                )
            except asyncio.CancelledError:
                return
            except Exception as exc:
                logger.warning(f"Achievement calculation error for '{slug}': {exc}\n{traceback.format_exc()}")
                yield ServerSentEvent(
                    data={
                        "type": "progress",
                        "slug": slug,
                        "index": i,
                        "total": total,
                        "status": "error",
                        "message": str(exc),
                    },
                    event="log",
                )

        yield ServerSentEvent(
            data={"type": "complete", "executed": executed, "total": total},
            event="log",
        )


# ─── CRUD routes ─────────────────────────────────────────────────────────────


@router.get("", response_model=pagination.Paginated[admin_schemas.AchievementAdminRead])
async def get_achievements(
    params: admin_schemas.AchievementListQueryParams = Depends(),
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.require_permission("achievement", "read")),
):
    """Get paginated list of achievements (admin only)"""
    return await admin_service.get_achievements(
        session,
        admin_schemas.AchievementListParams.from_query_params(params),
    )


@router.post("", response_model=admin_schemas.AchievementAdminRead)
async def create_achievement(
    data: admin_schemas.AchievementAdminCreate,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.require_permission("achievement", "create")),
):
    """Create a new achievement (admin only)"""
    created = await admin_service.create_achievement(session, data)
    return admin_schemas.AchievementAdminRead.model_validate(created, from_attributes=True)


@router.patch("/{achievement_id}", response_model=admin_schemas.AchievementAdminRead)
async def update_achievement(
    achievement_id: int,
    data: admin_schemas.AchievementAdminUpdate,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.require_permission("achievement", "update")),
):
    """Update achievement fields (admin only)"""
    updated = await admin_service.update_achievement(session, achievement_id, data)
    return admin_schemas.AchievementAdminRead.model_validate(updated, from_attributes=True)


@router.delete("/{achievement_id}", status_code=204)
async def delete_achievement(
    achievement_id: int,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.require_permission("achievement", "delete")),
):
    """Delete achievement (admin only)"""
    await admin_service.delete_achievement(session, achievement_id)
