"""Sync a saved balance into the normalized ``balance_variant`` / ``team_slot`` tables."""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from shared.core.errors import BaseAPIException as HTTPException
from shared.domain.roster_shape import FLEX_SLOT_CODE
from shared.repository import (
    BalancerBalanceVariantRepository,
    BalancerTeamRepository,
    BalancerTeamSlotRepository,
    TournamentRepository,
)
from shared.repository.roles import CatalogRoleRepository
from src import models
from src.domain.balancer.role_naming import role_slot_code
from src.schemas.team import InternalBalancerTeamsPayload

__all__ = ("BalancerVariantService", "balancer_variant_service")


class BalancerVariantService:
    def __init__(
        self,
        *,
        variants: BalancerBalanceVariantRepository = BalancerBalanceVariantRepository(),
        teams: BalancerTeamRepository = BalancerTeamRepository(),
        team_slots: BalancerTeamSlotRepository = BalancerTeamSlotRepository(),
    ) -> None:
        self.variants = variants
        self.teams = teams
        self.team_slots = team_slots

    async def sync(
        self,
        session: AsyncSession,
        balance: models.BalancerBalance,
        payload: InternalBalancerTeamsPayload,
        *,
        algorithm: str = "unknown",
    ) -> None:
        """Create balance_variant and team_slot rows from the saved balance result.

        Called after the BalancerTeam rows for the balance have been persisted.
        """
        # Cascades to team_slots through the variant→team FK.
        await self.variants.delete_for_balance(session, balance.id)

        variant = await self.variants.create(
            session,
            models.BalancerBalanceVariant(
                balance_id=balance.id,
                variant_number=1,
                algorithm=algorithm,
                objective_score=None,
                statistics_json=None,
                is_selected=True,
            ),
        )

        balance.algorithm = algorithm

        balancer_teams = {team.balancer_name: team for team in await self.teams.list_for_balance(session, balance.id)}
        tournament = await TournamentRepository().get(session, balance.tournament_id)
        rows = await CatalogRoleRepository().rated_rows(session, discipline=tournament.discipline, workspace_id=None)

        slots: list[models.BalancerTeamSlot] = []
        for team_data in payload.teams:
            balancer_team = balancer_teams.get(team_data.name)
            if balancer_team is None:
                continue

            balancer_team.variant_id = variant.id

            sort_order = 0
            for role_name, players in team_data.roster.items():
                role_code = role_slot_code(role_name)
                role_row = rows.get(role_code)
                if role_row is None and role_code != FLEX_SLOT_CODE:
                    raise HTTPException(status_code=422, detail=f"unknown_role: {role_code!r}")
                for player_data in players:
                    name_normalized = player_data.name.replace(" ", "").strip().lower()
                    slots.append(
                        models.BalancerTeamSlot(
                            team_id=balancer_team.id,
                            battle_tag_normalized=name_normalized,
                            role_row=role_row,
                            dimension_id=role_row.dimension_id if role_row is not None else None,
                            assigned_rank=player_data.assigned_rating,
                            discomfort=player_data.role_discomfort or 0,
                            is_captain=player_data.is_captain,
                            sort_order=sort_order,
                        )
                    )
                    sort_order += 1

        await self.team_slots.create_many(session, slots)


balancer_variant_service = BalancerVariantService()
