"""Write helpers for the balancer subsystem.

These functions synchronize data to the normalized relational tables
(team_slot, balance_variant).
"""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from shared.repository import BalancerBalanceVariantRepository, BalancerTeamRepository, BalancerTeamSlotRepository
from src import models
from src.schemas.team import InternalBalancerTeamsPayload
from src.services.balancer.role_naming import role_slot_code

__all__ = ("BalancerVariantService", "balancer_variant_service")

# ---------------------------------------------------------------------------
# Balance variants + team slots  (replaces roster_json)
# ---------------------------------------------------------------------------


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
        # Delete old variants (cascades to team_slots through variant→team FK)
        await self.variants.delete_for_balance(session, balance.id)

        # Create single variant (the saved/selected one)
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

        # Update balance metadata
        balance.algorithm = algorithm

        # Link teams to variant and create team_slots
        balancer_teams = {team.balancer_name: team for team in await self.teams.list_for_balance(session, balance.id)}

        slots: list[models.BalancerTeamSlot] = []
        for team_data in payload.teams:
            balancer_team = balancer_teams.get(team_data.name)
            if balancer_team is None:
                continue

            balancer_team.variant_id = variant.id

            sort_order = 0
            for role_name, players in team_data.roster.items():
                role_code = role_slot_code(role_name)
                for player_data in players:
                    name_normalized = player_data.name.replace(" ", "").strip().lower()
                    slots.append(
                        models.BalancerTeamSlot(
                            team_id=balancer_team.id,
                            battle_tag_normalized=name_normalized,
                            role=role_code,
                            assigned_rank=player_data.rating,
                            discomfort=player_data.discomfort or 0,
                            is_captain=player_data.is_captain,
                            sort_order=sort_order,
                        )
                    )
                    sort_order += 1

        await self.team_slots.create_many(session, slots)


balancer_variant_service = BalancerVariantService()
