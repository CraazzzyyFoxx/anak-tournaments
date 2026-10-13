from datetime import datetime

from pydantic import BaseModel, Field

from shared.core.enums import EncounterResultAuditAction, EncounterResultStatus, EncounterStatus

__all__ = (
    "EncounterCreate",
    "EncounterSeatInput",
    "EncounterUpdate",
    "MatchUpdate",
    "SetResultIn",
    "SetResultLineIn",
    "ReopenResultIn",
    "EncounterResultRead",
    "EncounterResultAuditRead",
    "EncounterResultSnapshotLine",
    "EncounterSwapSlotInput",
    "EncounterSlotRead",
    "EncounterSlotSwapRead",
    "EncounterSeatRead",
)


class EncounterSeatInput(BaseModel):
    """One seat of a new encounter: which slot, and the team that takes it."""

    slot: int = Field(ge=1)
    #: ``None`` seats nobody -- the slot stays empty until a team is placed or
    #: an advancement edge fills it.
    team_id: int | None = None


class EncounterCreate(BaseModel):
    """Schema for creating an encounter"""

    name: str
    tournament_id: int
    stage_id: int | None = None
    stage_item_id: int | None = None
    #: How many seats the card has; a duel is 2 (D43, D55).
    slot_count: int = Field(default=2, ge=2)
    #: The seats to fill right away; every ``slot`` must be within the card and
    #: no two may name the same one.
    teams: list[EncounterSeatInput] = Field(default_factory=list)
    round: int
    best_of: int = Field(default=3, ge=1)
    status: str = "open"  # open, pending, completed
    scheduled_at: datetime | None = None
    started_at: datetime | None = None
    ended_at: datetime | None = None
    current_map_index: int | None = None


class EncounterUpdate(BaseModel):
    """Schema for updating an encounter.

    Seats are not edited here: a seat changes hands through the slot swap,
    which retires the old participation instead of rewriting it, so the games
    it played stay attached to the row that played them (D55).
    """

    name: str | None = None
    stage_id: int | None = None
    stage_item_id: int | None = None
    status: str | None = None
    round: int | None = None
    best_of: int | None = Field(default=None, ge=1)
    closeness: float | None = Field(default=None, ge=0.0, le=1.0)
    scheduled_at: datetime | None = None
    started_at: datetime | None = None
    ended_at: datetime | None = None
    current_map_index: int | None = None


class MatchUpdate(BaseModel):
    """Partial update for a single match (map) within an encounter.

    ``matches.match`` is what a parsed LOG observed, and a V4 log names two
    sides; that is why this one shape still does.
    """

    home_team_id: int | None = None
    away_team_id: int | None = None
    home_score: int | None = None
    away_score: int | None = None
    map_id: int | None = None
    code: str | None = None
    time: float | None = None


class SetResultLineIn(BaseModel):
    """One participation's line of an admin result."""

    encounter_team_id: int
    score: float
    placement: int | None = Field(default=None, ge=1)


class SetResultIn(BaseModel):
    """Body of the single admin result write.

    ``reason`` is required: an admin result overrides what the participants
    said and the journal has to say why. ``results`` may be empty only when
    ``adopt_report_team_id`` names the participation whose report is taken as
    truth instead -- which is how a dispute is resolved in one call.
    """

    reason: str = Field(min_length=1, max_length=500)
    results: list[SetResultLineIn] = Field(default_factory=list)
    closeness: int | None = Field(default=None, ge=1, le=10)
    adopt_report_team_id: int | None = None


class ReopenResultIn(BaseModel):
    """Body of the result reopen: the organizer's stated reason.

    Reopening unmakes a human decision, so a human signs it -- the journal row
    ``reopen`` writes carries this verbatim.
    """

    reason: str = Field(min_length=1, max_length=500)


class EncounterSwapSlotInput(BaseModel):
    """Body of the bracket slot swap: which seat here, which seat there.

    Both ends are named explicitly so one endpoint covers the two moves the
    bracket offers -- dragging a team onto another encounter's seat, and
    exchanging two seats inside one encounter (same ``target_encounter_id``,
    the other ``target_slot``).
    """

    slot: int = Field(ge=1)
    target_encounter_id: int
    target_slot: int = Field(ge=1)


class EncounterSeatRead(BaseModel):
    """One live seat as the bracket re-renders it after a swap."""

    id: int
    slot: int
    team_id: int | None
    name: str


class EncounterSlotRead(BaseModel):
    """One side of a swap: the seats it now holds, and the rebuilt name."""

    id: int
    teams: list[EncounterSeatRead]
    name: str


class EncounterSlotSwapRead(BaseModel):
    """Both encounters the swap touched (the same one twice on an internal swap)."""

    source: EncounterSlotRead
    target: EncounterSlotRead


class EncounterResultSnapshotLine(BaseModel):
    """One participation's numbers inside an audit snapshot."""

    encounter_team_id: int
    score: float
    placement: int | None = None


class EncounterResultRead(BaseModel):
    """What the result endpoints return: the settled state of the encounter."""

    id: int
    status: EncounterStatus
    result_status: EncounterResultStatus
    #: Which writer decided it; ``None`` while no official result exists.
    result_source: str | None
    result_version: int
    #: The standing, one line per live participation, in slot order.
    teams: list[EncounterResultSnapshotLine]
    closeness: float | None
    confirmed_at: datetime | None


class EncounterResultAuditRead(BaseModel):
    """One recorded transition. ``actor_user_id`` is NULL for a machine actor."""

    id: int
    encounter_id: int
    #: The ``encounter.result_version`` this operation left behind.
    result_version: int
    actor_user_id: int | None
    actor_name: str | None
    action: EncounterResultAuditAction
    from_result_status: EncounterResultStatus | None
    to_result_status: EncounterResultStatus
    #: ``encounter`` for the standing, ``game`` for one position's numbers.
    snapshot_scope: str
    game_id: int | None = None
    #: ``None`` when nothing preceded this row.
    before: list[EncounterResultSnapshotLine] | None = None
    after: list[EncounterResultSnapshotLine]
    adopted_team_id: int | None
    reason: str | None = None
    source: str
    created_at: datetime
