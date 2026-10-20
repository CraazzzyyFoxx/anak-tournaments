"""Wire shapes for ad-hoc scrim rooms.

The custom-pool entry deliberately mirrors ``rpc/pick_ban_admin.PickBanConfigUpsert``
field for field, minus the cascade coordinates (``stage_id``/``round``), which a
room owns rather than chooses: the organizer's config editor and the scrim room's
pool editor are the same UI, so a diverging body would fork it.
"""

from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field

from shared.core.enums import (
    FirstBanRotation,
    FirstPickRule,
    MapVetoMode,
    PickBanKind,
)

__all__ = (
    "ScrimCreateRequest",
    "ScrimPoolCopy",
    "ScrimPoolCustom",
    "ScrimPoolConfigInput",
    "ScrimPoolSlotInput",
    "ScrimRoomListRead",
    "ScrimRoomRead",
    "ScrimTeamRead",
)


class ScrimTeamRead(BaseModel):
    slot: int
    id: int
    name: str
    #: Whether this slot has a captain yet. Slot 2 starts unclaimed —
    #: that is what the room's share link is for.
    captain_claimed: bool


class ScrimRoomRead(BaseModel):
    id: int
    token: str
    label: str
    workspace_id: int
    #: The room's encounter's discipline: owner context for scoped metadata reads.
    discipline: str
    #: The hidden per-workspace container, not a real tournament. Exposed because
    #: the client needs it for nothing except debugging — the room is addressed by
    #: ``token`` and the pre-game UI by ``encounter_id``.
    tournament_id: int
    stage_id: int
    encounter_id: int
    best_of: int
    #: Always two, in slot order; never null: both seats are provisioned with the
    #: room, and the encounter's team FKs cascade on delete, so neither can
    #: outlive the other.
    teams: list[ScrimTeamRead]
    #: The viewer's own slot, or null for a spectator. Never inferred client-side:
    #: authority lives in ``Team.captain_id``.
    viewer_slot: int | None
    can_claim: bool
    #: Whether the viewer may retire this room: its creator, a captain of either
    #: side, or workspace staff holding ``match.result``. False once closed, so the
    #: UI needs no second rule of its own.
    can_close: bool
    created_at: datetime
    #: Set when the room is closed, which frees its creator's open-room slot.
    #: Closing is not deleting — the room stays readable by its participants.
    closed_at: datetime | None


class ScrimRoomListRead(BaseModel):
    rooms: list[ScrimRoomRead]


class ScrimPoolSlotInput(BaseModel):
    """One slot of a slot-mode pool. List order IS play order — same contract as
    ``PickBanConfigSlotUpsert``."""

    candidates: list[int]
    reserve_item_id: int | None = None


class ScrimPoolConfigInput(BaseModel):
    kind: PickBanKind
    mode: MapVetoMode = MapVetoMode.POOL
    first_pick_rule: FirstPickRule = FirstPickRule.HIGHER_SEED
    first_ban_rotation: FirstBanRotation = FirstBanRotation.FIXED
    #: Ruleset v2 document, validated by the same engine call the organizer's upsert runs.
    ruleset: dict[str, Any]
    item_ids: list[int] = Field(default_factory=list)
    slots: list[ScrimPoolSlotInput] = Field(default_factory=list)


class ScrimPoolCopy(BaseModel):
    """ "We play this round's maps" — clone whatever the cascade resolves there.

    ``stage_id``/``round`` may be null to copy a tournament-wide or stage-wide
    config; resolution uses the engine's own ranking
    (``pick_ban_session.resolve_config_at_level``), so what a room copies is
    exactly what an encounter at that coordinate would have played.
    """

    source: Literal["copy"]
    tournament_id: int
    stage_id: int | None = None
    round: int | None = None


class ScrimPoolCustom(BaseModel):
    """A pool authored for this room only. At most one entry per ``kind``."""

    source: Literal["custom"]
    configs: list[ScrimPoolConfigInput] = Field(min_length=1)


ScrimPoolInput = Annotated[ScrimPoolCopy | ScrimPoolCustom, Field(discriminator="source")]


class ScrimCreateRequest(BaseModel):
    workspace_id: int
    #: The game the room is played in; it must be enabled for the workspace. Never defaulted:
    #: a room's pool, maps and rosters are all read in this discipline.
    discipline: str = Field(min_length=1)
    label: str = Field(min_length=1, max_length=255)
    #: Upper bound comes from ``Settings["tournament.scrim"].max_best_of``, not
    #: from here: it is an operational limit, raisable without a deploy.
    best_of: int = Field(ge=1)
    #: Slot order: the first name is the creator's team, the second the opponent's.
    team_names: list[Annotated[str, Field(min_length=1, max_length=255)]] = Field(min_length=2, max_length=2)
    pool: ScrimPoolInput
