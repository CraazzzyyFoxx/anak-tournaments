from __future__ import annotations

import logging
from collections.abc import Mapping
from datetime import UTC, datetime
from typing import Any

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from shared.core import http_status as status
from shared.core.errors import BaseAPIException as HTTPException
from shared.models.balancer import WorkspaceBalancerConfig
from shared.services.team_export import ExportPlan, team_materialization
from src import models
from src.schemas.admin import balancer as admin_schemas
from src.schemas.team import InternalBalancerTeamsPayload
from src.services.admin.balance_analytics import enqueue_balance_exported_event
from src.services.admin.balancer_dual_write import sync_balance_variants_and_slots
from src.services.balancer.config.provider import normalize_tournament_config_payload, serialize_saved_config_payload
from src.services.balancer.config.public_contract import normalize_balance_response_payload
from src.services.team import to_materialization_teams

logger = logging.getLogger(__name__)


async def ensure_tournament_exists(session: AsyncSession, tournament_id: int) -> None:
    result = await session.execute(sa.select(models.Tournament.id).where(models.Tournament.id == tournament_id))
    if result.scalar_one_or_none() is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tournament not found")


async def get_tournament_row(session: AsyncSession, tournament_id: int) -> sa.Row:
    """Minimal tournament projection (id/name/status) for the summary RPC.

    Deliberately NO ``is_hidden`` filter: the summary powers the staff-facing
    balancer tool context, and hidden (preview) tournaments must stay
    resolvable for callers who already passed the workspace ``team.read`` gate.
    """
    row = (
        await session.execute(
            sa.select(models.Tournament.id, models.Tournament.name, models.Tournament.status).where(
                models.Tournament.id == tournament_id
            )
        )
    ).one_or_none()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tournament not found")
    return row


async def get_tournament_config(
    session: AsyncSession,
    tournament_id: int,
) -> models.BalancerTournamentConfig | None:
    result = await session.execute(
        sa.select(models.BalancerTournamentConfig).where(models.BalancerTournamentConfig.tournament_id == tournament_id)
    )
    return result.scalar_one_or_none()


async def upsert_tournament_config(
    session: AsyncSession,
    tournament_id: int,
    workspace_id: int,
    config_json: dict[str, Any] | None,
    auth_user: models.AuthUser,
) -> models.BalancerTournamentConfig:
    # workspace_id is resolved by the caller (the RPC handler already fetched
    # it for the permission check) — no second Tournament lookup here.
    normalized_config = normalize_tournament_config_payload(config_json)
    tournament_config = await get_tournament_config(session, tournament_id)

    if tournament_config is None:
        tournament_config = models.BalancerTournamentConfig(
            tournament_id=tournament_id,
            workspace_id=workspace_id,
            config_json=normalized_config,
            updated_by=auth_user.id,
            updated_at=datetime.now(UTC),
        )
        session.add(tournament_config)
    else:
        tournament_config.workspace_id = workspace_id
        tournament_config.config_json = normalized_config
        tournament_config.updated_by = auth_user.id
        tournament_config.updated_at = datetime.now(UTC)

    await session.commit()
    return tournament_config


async def get_workspace_balancer_config(
    session: AsyncSession,
    workspace_id: int,
) -> WorkspaceBalancerConfig | None:
    result = await session.execute(
        sa.select(WorkspaceBalancerConfig).where(WorkspaceBalancerConfig.workspace_id == workspace_id)
    )
    return result.scalar_one_or_none()


async def upsert_workspace_balancer_config(
    session: AsyncSession,
    workspace_id: int,
    rank_delta_threshold: int | None,
    rank_delta_hide_from_pool: bool,
    updated_by: int | None,
) -> WorkspaceBalancerConfig:
    config = await get_workspace_balancer_config(session, workspace_id)
    payload: dict[str, Any] = {
        "rank_delta_threshold": rank_delta_threshold,
        "rank_delta_hide_from_pool": rank_delta_hide_from_pool,
    }
    if config is None:
        config = WorkspaceBalancerConfig(
            workspace_id=workspace_id,
            config_json=payload,
            updated_by=updated_by,
        )
        session.add(config)
    else:
        config.config_json = payload
        config.updated_by = updated_by
    await session.commit()
    # expire_on_commit=False keeps attributes (incl. the flushed PK) live after
    # commit, so no refresh round-trip is needed.
    return config


async def get_balance(session: AsyncSession, tournament_id: int) -> models.BalancerBalance | None:
    result = await session.execute(
        sa.select(models.BalancerBalance)
        .where(models.BalancerBalance.tournament_id == tournament_id)
        .options(selectinload(models.BalancerBalance.teams))
    )
    return result.scalar_one_or_none()


def materialize_balance_teams(
    balance_id: int,
    payload: InternalBalancerTeamsPayload,
) -> list[models.BalancerTeam]:
    teams: list[models.BalancerTeam] = []
    for sort_order, team in enumerate(payload.teams):
        total_sr = sum(player.assigned_rating for players in team.roster.values() for player in players)
        teams.append(
            models.BalancerTeam(
                balance_id=balance_id,
                exported_team_id=None,
                name=team.name.split("#")[0],
                balancer_name=team.name,
                captain_battle_tag=team.name,
                avg_sr=team.average_mmr,
                total_sr=total_sr,
                sort_order=sort_order,
            )
        )
    return teams


async def save_balance(
    session: AsyncSession,
    tournament_id: int,
    data: admin_schemas.BalanceSaveRequest,
    auth_user: models.AuthUser,
) -> models.BalancerBalance:
    await ensure_tournament_exists(session, tournament_id)
    normalized_config_json = serialize_saved_config_payload(data.config_json)
    normalized_result_json = normalize_balance_response_payload(data.result_json)
    payload = InternalBalancerTeamsPayload.model_validate(normalized_result_json)
    if not payload.teams:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Balance result does not contain teams")

    balance = await get_balance(session, tournament_id)
    if balance is None:
        balance = models.BalancerBalance(
            tournament_id=tournament_id,
            config_json=normalized_config_json,
            result_json=normalized_result_json,
            saved_by=auth_user.id,
            saved_at=datetime.now(UTC),
            export_status=None,
            export_error=None,
            exported_at=None,
        )
        session.add(balance)
        await session.flush()
    else:
        balance.config_json = normalized_config_json
        balance.result_json = normalized_result_json
        balance.saved_by = auth_user.id
        balance.saved_at = datetime.now(UTC)
        balance.export_status = None
        balance.export_error = None
        balance.exported_at = None
        await session.execute(sa.delete(models.BalancerTeam).where(models.BalancerTeam.balance_id == balance.id))

    session.add_all(materialize_balance_teams(balance.id, payload))
    await session.flush()

    algorithm = normalized_config_json.get("algorithm", "unknown") if normalized_config_json else "unknown"
    await sync_balance_variants_and_slots(session, balance, payload, algorithm=algorithm)

    await session.commit()
    # expire_on_commit=False keeps the instance usable after commit, and the
    # response (``serialize_balance``) never touches the teams relationship —
    # no refetch needed.
    return balance


async def export_balance(session: AsyncSession, balance_id: int) -> tuple[models.BalancerBalance, int, int]:
    result = await session.execute(
        sa.select(models.BalancerBalance)
        .where(models.BalancerBalance.id == balance_id)
        # ``variants`` is read by ``enqueue_balance_exported_event`` below; a lazy
        # load there would blow up (async IO outside the greenlet). It used to
        # blow up *after* the teams were already committed — the shared
        # orchestrator now owns a single transaction, so such a failure rolls the
        # teams back instead of leaving them half-created.
        .options(selectinload(models.BalancerBalance.teams), selectinload(models.BalancerBalance.variants))
    )
    balance = result.scalar_one_or_none()
    if balance is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Balance not found")

    payload = InternalBalancerTeamsPayload.model_validate(normalize_balance_response_payload(balance.result_json))
    linked_team_ids = [team.exported_team_id for team in balance.teams if team.exported_team_id is not None]

    def _unlink() -> None:
        for team in balance.teams:
            team.exported_team_id = None

    async def _finalize(inner: AsyncSession, by_name: Mapping[str, models.Team]) -> None:
        for materialized_team in balance.teams:
            public_team = by_name.get(materialized_team.balancer_name)
            if public_team is not None:
                materialized_team.exported_team_id = public_team.id

        balance.exported_at = datetime.now(UTC)
        balance.export_status = "success"
        balance.export_error = None

        # Enqueued in the same transaction as the rows it describes: the outbox
        # only INSERTs here, a separate relay pass publishes it.
        await enqueue_balance_exported_event(inner, balance, payload, dict(by_name))

    async def _on_failure(inner: AsyncSession, exc: BaseException) -> None:
        # Runs after the orchestrator's rollback, in a fresh transaction, so the
        # ORM state from the failed attempt is gone — re-load before stamping.
        logger.exception("Failed to export balance %s", balance_id)
        fresh = await inner.get(models.BalancerBalance, balance_id)
        if fresh is not None:
            fresh.export_status = "failed"
            fresh.export_error = str(exc)

    outcome = await team_materialization.run(
        session,
        ExportPlan(
            tournament_id=balance.tournament_id,
            teams=to_materialization_teams([team.to_balancer_team() for team in payload.teams]),
            prior_team_ids=linked_team_ids,
            on_unresolved="skip",
            unlink=_unlink,
            finalize=_finalize,
            on_failure=_on_failure,
        ),
    )
    return balance, outcome.removed_teams, outcome.imported_teams
