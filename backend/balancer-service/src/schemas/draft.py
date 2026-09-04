"""Pydantic DTOs for the Live Draft REST API.

Request models validate at the system boundary; read models carry the data the
public ``/board`` snapshot and admin views need. Enum-like fields use the
shared StrEnums so values are validated and serialize to their string form.
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field, field_validator, model_validator

from shared.core.enums import (
    DraftAutopickStrategy,
    DraftCaptainOrder,
    DraftFormat,
    DraftPickStatus,
    DraftPlayerStatus,
    DraftPoolSource,
    DraftStatus,
    HeroClass,
)
from shared.domain.roster_shape import RegistrationRoleCode, RosterShape
from shared.schemas.roster_slots import RosterShapeRead
from src.schemas.base import BaseRead

__all__ = (
    "DraftBoardSnapshot",
    "DraftFeasibilityResponse",
    "DraftOrderEntry",
    "DraftOrderRequest",
    "DraftPickAutopickRequest",
    "DraftPickOverrideRequest",
    "DraftPickOptionRead",
    "DraftPickOptionsResponse",
    "DraftPickRead",
    "DraftPickSelectRequest",
    "DraftPlayerCustomFieldRead",
    "DraftPlayerRead",
    "DraftRoleEditRequest",
    "DraftRoleEditResponse",
    "DraftSlotDeficitRead",
    "DraftSlotRead",
    "DraftSeedRequest",
    "DraftSeedDiff",
    "DraftSeedResponse",
    "DraftSessionCreateRequest",
    "DraftSessionPatchRequest",
    "DraftSessionRead",
    "DraftSuggestion",
    "DraftSuggestionsResponse",
    "DraftTeamRead",
)

_ReadConfig = ConfigDict(from_attributes=True)


def _role_slot_code(value: Any) -> Any:
    """Accept the domain's ``HeroClass`` next to the wire slot code.

    ``domain/draft`` thinks in ``HeroClass`` (``HeroClass.damage``), every read
    model here carries the wire spelling (``dps``). Coercing in the field means
    a handler that hands a read model a domain role gets the right JSON instead
    of a ``ValidationError`` that turns the whole response into a 500 —
    ``HeroClass.flex`` still fails, since no pick can name it.
    """
    return value.slot_code if isinstance(value, HeroClass) else value


DraftRoleRead = Annotated[RegistrationRoleCode, BeforeValidator(_role_slot_code)]


# --------------------------------------------------------------------------- #
# Requests
# --------------------------------------------------------------------------- #
class DraftSessionCreateRequest(BaseModel):
    """Everything about a new draft EXCEPT its size.

    ``rounds`` is derived from the tournament's roster shape server-side, so the
    admin form has nothing to submit and nothing to keep in sync.
    """

    pool_source: DraftPoolSource = DraftPoolSource.BALANCER_BALANCE
    source_balance_id: int | None = None
    format: DraftFormat = DraftFormat.SNAKE
    pick_time_seconds: int = 45
    autopick_strategy: DraftAutopickStrategy = DraftAutopickStrategy.BEST_FIT
    allow_admin_override: bool = True
    settings: dict[str, Any] = Field(default_factory=dict)

    @field_validator("pick_time_seconds")
    @classmethod
    def _pick_time_range(cls, v: int) -> int:
        if not 10 <= v <= 600:
            raise ValueError("pick_time_seconds must be between 10 and 600")
        return v


class DraftManualCaptainInput(BaseModel):
    user_id: int | None = None
    battle_tag: str | None = None
    name: str
    draft_position: int


class DraftManualPlayerInput(BaseModel):
    user_id: int | None = None
    battle_tag: str | None = None
    primary_role: RegistrationRoleCode
    secondary_roles: list[RegistrationRoleCode] = Field(default_factory=list)
    sub_role: str | None = None
    is_flex: bool = False
    division_number: int | None = None
    rank_value: int | None = None


class DraftPoolCaptainInput(BaseModel):
    """A captain chosen from the balancer pool (by balancer.registration id)."""

    registration_id: int
    name: str | None = None


class DraftSeedRequest(BaseModel):
    source_balance_id: int | None = None
    seed: int | None = None
    # Seat order for captains (who picks first). WEAKEST_FIRST seats the lowest-
    # rated captain at position 1; snake then balances across rounds.
    captain_order: DraftCaptainOrder = DraftCaptainOrder.MANUAL
    # Pool-derived seeding (preferred): captains picked from the balancer pool;
    # every other in-pool player becomes available. Roles/ranks come from the pool.
    pool_captains: list[DraftPoolCaptainInput] = Field(default_factory=list)
    # Manual seeding fallback.
    captains: list[DraftManualCaptainInput] = Field(default_factory=list)
    players: list[DraftManualPlayerInput] = Field(default_factory=list)
    preview_only: bool = False
    expected_version: int | None = None


class DraftSessionPatchRequest(BaseModel):
    pick_time_seconds: int | None = None
    autopick_strategy: DraftAutopickStrategy | None = None
    allow_admin_override: bool | None = None
    rounds: int | None = None
    settings: dict[str, Any] | None = None

    @field_validator("pick_time_seconds")
    @classmethod
    def _pick_time_range(cls, v: int | None) -> int | None:
        if v is not None and not 10 <= v <= 600:
            raise ValueError("pick_time_seconds must be between 10 and 600")
        return v


class DraftOrderEntry(BaseModel):
    draft_team_id: int
    draft_position: int


class DraftOrderRequest(BaseModel):
    order: list[DraftOrderEntry]

    @model_validator(mode="after")
    def _positions_are_permutation(self) -> DraftOrderRequest:
        positions = sorted(e.draft_position for e in self.order)
        if positions != list(range(1, len(self.order) + 1)):
            raise ValueError("draft_position values must be a permutation of 1..N")
        team_ids = [e.draft_team_id for e in self.order]
        if len(set(team_ids)) != len(team_ids):
            raise ValueError("draft_team_id values must be unique")
        return self


class DraftPickSelectRequest(BaseModel):
    player_id: int
    expected_version: int
    target_role: RegistrationRoleCode | None = None


class DraftPickAutopickRequest(BaseModel):
    expected_version: int
    reason: Literal["expiry", "admin"] = "expiry"


class DraftPickOverrideRequest(BaseModel):
    expected_version: int
    player_id: int | None = None
    draft_team_id: int | None = None
    target_role: RegistrationRoleCode | None = None
    note: str | None = None


class DraftRoleEditRequest(BaseModel):
    role: RegistrationRoleCode
    rank_value: int | None = None
    rank_absence_confirmed: bool = False
    reason: str
    expected_version: int
    preview_only: bool = False

    @model_validator(mode="after")
    def _validate_reason_and_rank(self) -> DraftRoleEditRequest:
        self.reason = self.reason.strip()
        if not self.reason:
            raise ValueError("reason must not be empty")
        if self.rank_value is None and not self.rank_absence_confirmed:
            raise ValueError("rank_absence_confirmed is required when rank_value is absent")
        return self


# --------------------------------------------------------------------------- #
# Reads
# --------------------------------------------------------------------------- #
class DraftTeamRead(BaseRead):
    model_config = _ReadConfig

    session_id: int
    captain_user_id: int | None
    captain_auth_user_id: int | None
    name: str
    draft_position: int
    exported_team_id: int | None


class DraftPlayerCustomFieldRead(BaseModel):
    """One organizer-approved registration answer, ready to render.

    Carries the definition's current ``label``/``type`` alongside the value so
    the draft client renders it without knowing anything about registration
    forms. Built by ``services.draft.board.player_custom_fields``; only fields
    flagged ``show_in_draft`` on the registration form ever appear here, because
    the board snapshot is public.
    """

    key: str
    label: str
    type: str
    value: Any


class DraftPlayerRead(BaseRead):
    model_config = _ReadConfig

    session_id: int
    user_id: int | None
    battle_tag: str | None
    primary_role: str
    sub_role: str | None
    is_flex: bool
    division_number: int | None
    rank_value: int | None
    status: DraftPlayerStatus
    is_captain: bool
    drafted_by_team_id: int | None
    secondary_roles_json: list[str] | None = None
    role_ranks: dict[str, int] = Field(default_factory=dict)
    role_top_heroes: dict[str, list[dict[str, Any]]] = Field(default_factory=dict)
    additional_info: dict[str, Any] = Field(default_factory=dict)
    # Projected on the read side (not an ORM column) — see board.build_board.
    # The one rank that represents this player in THIS draft: ``rank_value``
    # under a shape with role slots, their best role rank under a role-less
    # (all-flex) one, where nobody is assigned a role. Clients render it instead
    # of ``rank_value`` wherever they show a player with no role context, so the
    # flex rule lives once, in ``domain.draft.ranks.slot_rank``.
    effective_rank: int | None = None
    # Projected on the read side (not an ORM column) — see board.build_board.
    custom_fields: list[DraftPlayerCustomFieldRead] = Field(default_factory=list)
    version: int


class DraftPickRead(BaseRead):
    model_config = _ReadConfig

    session_id: int
    overall_no: int
    round_no: int
    pick_in_round: int
    draft_team_id: int
    target_role: str | None
    target_rank_value: int | None
    status: DraftPickStatus
    picked_player_id: int | None
    picked_by_user_id: int | None
    is_autopick: bool
    is_admin_override: bool
    clock_started_at: datetime | None
    clock_expires_at: datetime | None
    version: int


class DraftSessionRead(BaseRead):
    model_config = _ReadConfig

    tournament_id: int
    workspace_id: int
    status: DraftStatus
    blocked_reason: str | None
    format: DraftFormat
    rounds: int
    pick_time_seconds: int
    roster_shape: RosterShapeRead
    current_pick_id: int | None
    pool_source: DraftPoolSource
    source_balance_id: int | None
    autopick_strategy: DraftAutopickStrategy
    allow_admin_override: bool
    exported_at: datetime | None
    export_status: str | None
    settings_json: dict[str, Any]
    version: int
    # None only for a transient row that has not been flushed yet; every session
    # off the wire carries the timestamp the admin draft history sorts on.
    created_at: datetime | None = None

    @classmethod
    def from_session(cls, draft_session: Any, *, shape: RosterShape) -> DraftSessionRead:
        """The row plus the roster shape the row does not store.

        Every other field maps straight off the ORM object, but the shape is
        resolved from the tournament/workspace override chain, so it has to be
        handed in. Building the payload off ``model_fields`` keeps that the ONLY
        difference: add a column, and it is picked up here without an edit.
        """
        payload: dict[str, Any] = {
            name: getattr(draft_session, name) for name in cls.model_fields if name != "roster_shape"
        }
        payload["roster_shape"] = RosterShapeRead.from_shape(shape)
        return cls.model_validate(payload)


class DraftBoardSnapshot(BaseModel):
    """Single-shot spectator/captain bootstrap + realtime resume cursor."""

    session: DraftSessionRead
    teams: list[DraftTeamRead]
    picks: list[DraftPickRead]
    players: list[DraftPlayerRead]  # all pool players; client derives availability + rosters
    current_pick: DraftPickRead | None
    server_time: datetime
    last_event_id: int | None = None


class DraftSuggestion(BaseModel):
    player_id: int
    role: DraftRoleRead
    fit_score: float
    breakdown: dict[str, float] = Field(default_factory=dict)


class DraftSuggestionsResponse(BaseModel):
    pick_id: int
    draft_team_id: int
    suggestions: list[DraftSuggestion]


class DraftSlotRead(BaseModel):
    model_config = _ReadConfig

    team_id: int
    slot_code: str
    ordinal: int


class DraftSlotDeficitRead(BaseModel):
    model_config = _ReadConfig

    slot_code: str
    unmatched_slots: int
    eligible_players: int


class DraftFeasibilityResponse(BaseModel):
    model_config = _ReadConfig

    is_feasible: bool
    total_open_slots: int
    matched_slots: int
    unmatched_slots: list[DraftSlotRead]
    slot_deficits: list[DraftSlotDeficitRead]
    blocking_player_ids: list[int]
    reason_code: str | None = None


class DraftPickOptionRead(BaseModel):
    model_config = _ReadConfig

    player_id: int
    role: DraftRoleRead
    is_safe: bool
    reason_code: str | None = None
    unmatched_slots: list[DraftSlotRead] = Field(default_factory=list)
    blocking_player_ids: list[int] = Field(default_factory=list)
    suggestion_score: float | None = None


class DraftPickOptionsResponse(BaseModel):
    pick_id: int
    pick_version: int
    draft_team_id: int
    options: list[DraftPickOptionRead]


class DraftRoleEditResponse(BaseModel):
    player_id: int
    role: DraftRoleRead
    player_version: int
    committed: bool
    before: DraftFeasibilityResponse
    after: DraftFeasibilityResponse


class DraftSeedDiff(BaseModel):
    teams_before: int
    teams_after: int
    players_before: int
    players_after: int
    picks_before: int
    picks_after: int
    session_version_before: int
    session_version_after: int


class DraftSeedResponse(BaseModel):
    session: DraftSessionRead
    preview_only: bool
    diff: DraftSeedDiff
    feasibility: DraftFeasibilityResponse
