"""Admin-only emergency role additions for a live-draft player snapshot."""

from __future__ import annotations

import asyncio

from sqlalchemy.ext.asyncio import AsyncSession

from shared.core.enums import DraftPlayerStatus, DraftStatus, HeroClass
from shared.models.balancer.draft import (
    DraftAuditEvent,
    DraftPlayer,
    DraftPlayerRole,
    DraftSession,
)
from shared.repository.draft import DraftAuditEventRepository, DraftPlayerRepository
from src.services.draft import loaders
from src.services.draft._errors import err as _err
from src.services.draft.entities import (
    DraftFeasibilityReport,
    DraftFeasibilityState,
    EligiblePlayer,
    RoleEditPreview,
    RoleEditResult,
)
from src.services.draft.feasibility import DraftFeasibilityService, feasibility_service
from src.services.draft.feasibility_algorithm import analyze_draft_feasibility

_EDITABLE_STATUSES = {
    DraftStatus.SETUP.value,
    DraftStatus.READY.value,
    DraftStatus.PAUSED.value,
}

def validate_role_edit_request(
    draft_session: DraftSession,
    player: DraftPlayer,
    *,
    role: HeroClass,
    rank_value: int | None,
    rank_absence_confirmed: bool,
    reason: str,
    expected_version: int,
) -> str:
    """Validate both preview and commit; return the normalized private reason."""

    if draft_session.status not in _EDITABLE_STATUSES:
        raise _err("role_edit_requires_pause", "Pause the draft before editing a player role", status_code=409)
    if player.session_id != draft_session.id:
        raise _err("player_not_found", "Player is not in this draft session", status_code=404)
    if player.status != DraftPlayerStatus.AVAILABLE.value:
        raise _err("player_not_available", "Only a remaining available player can receive an emergency role")
    if player.version != expected_version:
        raise _err("draft_player_stale", "Player snapshot changed; reload the role-edit preview", status_code=409)
    if any(entry.role == role.slot_code for entry in player.roles):
        raise _err("role_already_exists", f"Player already has the {role.slot_code} role", status_code=409)
    normalized_reason = reason.strip()
    if not normalized_reason:
        raise _err("role_edit_reason_required", "A private audit reason is required")
    if rank_value is None and not rank_absence_confirmed:
        raise _err(
            "role_rank_confirmation_required",
            "Provide a role rank or explicitly confirm that it is unavailable",
        )
    return normalized_reason


def preview_role_addition(
    state: DraftFeasibilityState,
    *,
    player_id: int,
    role: HeroClass,
) -> RoleEditPreview:
    before = analyze_draft_feasibility(
        team_ids=state.team_ids,
        slot_targets=state.slot_targets,
        players=state.players,
        assignments=state.assignments,
    )
    found = False
    updated_players: list[EligiblePlayer] = []
    for player in state.players:
        if player.player_id == player_id:
            found = True
            updated_players.append(
                EligiblePlayer(
                    player_id=player.player_id,
                    playable_roles=player.playable_roles | {role},
                )
            )
        else:
            updated_players.append(player)
    if not found:
        raise _err("player_not_available", "Player is not available in the remaining draft pool", status_code=404)
    after = analyze_draft_feasibility(
        team_ids=state.team_ids,
        slot_targets=state.slot_targets,
        players=tuple(updated_players),
        assignments=state.assignments,
    )
    return RoleEditPreview(before=before, after=after)


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
        normalized_reason = validate_role_edit_request(
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
        preview = await asyncio.to_thread(preview_role_addition, state, player_id=player.id, role=role)
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

__all__ = (
    "DraftRoleEditService",
    "RoleEditPreview",
    "RoleEditResult",
    "preview_role_addition",
    "role_edit_service",
    "validate_role_edit_request",
)
