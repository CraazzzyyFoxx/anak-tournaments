"""Admin-only emergency role additions for a live-draft player snapshot.

Validation and the before/after feasibility preview are pure and live in
``src.domain.draft.rules``; this file holds only the orchestration that needs
a database session.
"""

from __future__ import annotations

import asyncio

from sqlalchemy.ext.asyncio import AsyncSession

from shared.core.enums import HeroClass
from shared.models.balancer.draft import DraftAuditEvent, DraftPlayer, DraftPlayerRole, DraftSession
from shared.repository.draft import DraftAuditEventRepository, DraftPlayerRepository
from src.domain.draft import rules
from src.domain.draft.entities import DraftFeasibilityReport, RoleEditPreview, RoleEditResult
from src.services.draft import loaders
from src.services.draft._errors import err as _err
from src.services.draft.feasibility import DraftFeasibilityService, feasibility_service

__all__ = ("DraftRoleEditService", "role_edit_service")


class DraftRoleEditService:
    def __init__(
        self,
        *,
        players_repo: DraftPlayerRepository = DraftPlayerRepository(),
        audit_repo: DraftAuditEventRepository = DraftAuditEventRepository(),
        feasibility: DraftFeasibilityService = feasibility_service,
    ) -> None:
        self.players_repo = players_repo
        self.audit_repo = audit_repo
        self.feasibility = feasibility

    def _report_json(self, report: DraftFeasibilityReport) -> dict:
        return {
            "is_feasible": report.is_feasible,
            "total_open_slots": report.total_open_slots,
            "matched_slots": report.matched_slots,
            "unmatched_slots": [
                {"team_id": slot.team_id, "slot_code": slot.slot_code, "ordinal": slot.ordinal}
                for slot in report.unmatched_slots
            ],
            "slot_deficits": [
                {
                    "slot_code": deficit.slot_code,
                    "unmatched_slots": deficit.unmatched_slots,
                    "eligible_players": deficit.eligible_players,
                }
                for deficit in report.slot_deficits
            ],
            "blocking_player_ids": list(report.blocking_player_ids),
            "reason_code": report.reason_code,
        }

    def _roles_json(self, player: DraftPlayer) -> list[dict]:
        return [
            {
                "role": entry.role,
                "rank_value": entry.rank_value,
                "is_secondary": entry.is_secondary,
                "priority": entry.priority,
            }
            for entry in sorted(player.roles, key=lambda entry: entry.priority)
        ]

    async def apply_role_edit(
        self,
        session: AsyncSession,
        draft_session: DraftSession,
        player: DraftPlayer,
        *,
        role: HeroClass,
        rank_value: int | None,
        reason: str,
        actor_auth_user_id: int,
        preview: RoleEditPreview,
    ) -> DraftAuditEvent:
        """Mutate only the draft snapshot and add its private audit record."""

        before_roles = self._roles_json(player)
        before_version = player.version
        next_priority = max((entry.priority for entry in player.roles), default=-1) + 1
        player.roles.append(
            DraftPlayerRole(
                role=role.slot_code,
                rank_value=rank_value,
                is_secondary=role.slot_code != player.primary_role,
                priority=next_priority,
            )
        )
        player.version += 1
        audit = DraftAuditEvent(
            session_id=draft_session.id,
            actor_auth_user_id=actor_auth_user_id,
            action="player_role_added",
            entity_type="draft_player",
            entity_id=player.id,
            reason=reason.strip(),
            before_json={
                "player_version": before_version,
                "roles": before_roles,
                "feasibility": self._report_json(preview.before),
            },
            after_json={
                "player_version": player.version,
                "roles": self._roles_json(player),
                "feasibility": self._report_json(preview.after),
            },
        )
        return await self.audit_repo.create(session, audit)

    async def edit_player_role(
        self,
        session: AsyncSession,
        draft_session: DraftSession,
        *,
        player_id: int,
        role: HeroClass,
        rank_value: int | None,
        rank_absence_confirmed: bool,
        reason: str,
        expected_version: int,
        actor_auth_user_id: int,
        preview_only: bool,
    ) -> RoleEditResult:
        player = await self.players_repo.get_for_update(
            session, player_id, session_id=draft_session.id, options=loaders.player_options()
        )
        if player is None:
            raise _err("player_not_found", "Player is not in this draft session", status_code=404)
        normalized_reason = rules.validate_role_edit_request(
            draft_session,
            player,
            role=role,
            rank_value=rank_value,
            rank_absence_confirmed=rank_absence_confirmed,
            reason=reason,
            expected_version=expected_version,
        )
        state = await self.feasibility.load_feasibility_state(session, draft_session)
        # Two bipartite matchings (before/after) — pure CPU, run off the event loop.
        preview = await asyncio.to_thread(rules.preview_role_addition, state, player_id=player.id, role=role)
        if preview_only:
            return RoleEditResult(
                player_id=player.id,
                role=role,
                player_version=player.version,
                committed=False,
                preview=preview,
            )
        await self.apply_role_edit(
            session,
            draft_session,
            player,
            role=role,
            rank_value=rank_value,
            reason=normalized_reason,
            actor_auth_user_id=actor_auth_user_id,
            preview=preview,
        )
        await session.flush()
        return RoleEditResult(
            player_id=player.id,
            role=role,
            player_version=player.version,
            committed=True,
            preview=preview,
        )


role_edit_service = DraftRoleEditService()
