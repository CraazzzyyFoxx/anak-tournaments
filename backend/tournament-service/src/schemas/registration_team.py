"""Read/write contracts for team registration.

The read models deliberately carry the *computed* shortfall alongside the
denormalized `status`. `status` exists for indexed filtering ("show me incomplete
teams"); the per-slot `open_slots` is what a captain and an organizer actually act
on, and it can only come from comparing the roster against the tournament's
`RosterShape`. Serving only `status` is the §12.5 dead end in read-model form: the
people in an incomplete team learn they are stuck but not what is missing.
"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field, field_validator, model_validator

from shared.domain.roster_shape import ROSTER_SLOT_CODES, RosterSlotCode
from shared.domain.team_roster import RosterOccupancy
from src import models
from src.schemas.registration import RegistrationCreate

__all__ = (
    "RegistrationTeamAcceptRequest",
    "RegistrationTeamCreateRequest",
    "RegistrationTeamInviteCreateRequest",
    "RegistrationTeamInviteRead",
    "RegistrationTeamListResponse",
    "RegistrationTeamMemberRead",
    "RegistrationTeamRead",
)


# ── requests ─────────────────────────────────────────────────────────────────


class RegistrationTeamCreateRequest(BaseModel):
    """Create a team and register the caller as its captain, in one call.

    The captain is a member like any other (decision 5), so their own registration
    payload rides along and goes through the identical validation a solo entrant
    gets. Splitting this into "create team" then "register captain" would allow a
    captainless team to exist between the two calls.
    """

    name: str = Field(min_length=1, max_length=255)
    slot_code: RosterSlotCode
    registration: RegistrationCreate

    @field_validator("name")
    @classmethod
    def _strip(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("A team needs a name")
        return cleaned


class RegistrationTeamInviteCreateRequest(BaseModel):
    """Offer one roster slot.

    ``target_auth_user_id`` addresses a known account; omitting it produces a
    shareable link for someone with no account yet (decision 3). Both modes are one
    entity, so the slot accounting cannot diverge between them.
    """

    slot_code: RosterSlotCode
    is_substitute: bool = False
    target_auth_user_id: int | None = None
    #: ``None`` means "no expiry"; the service's default is applied when the field
    #: is omitted entirely, which is why this is not simply ``int = 7``.
    ttl_days: int | None = Field(default=None, ge=1, le=90)


class RegistrationTeamAcceptRequest(BaseModel):
    """Redeem an invite by token or by id, supplying the invitee's own
    registration.

    Exactly one reference must be given. Accepting both would leave which one
    authorizes the acceptance ambiguous — and since a link invite is bearer while a
    targeted one is not, the ambiguity is a privilege question, not a cosmetic one.
    """

    token: str | None = None
    invite_id: int | None = None
    registration: RegistrationCreate

    @model_validator(mode="after")
    def _exactly_one_reference(self) -> RegistrationTeamAcceptRequest:
        provided = [value for value in (self.token, self.invite_id) if value is not None]
        if len(provided) != 1:
            raise ValueError("Exactly one of token or invite_id is required")
        return self


# ── reads ────────────────────────────────────────────────────────────────────


class RegistrationTeamMemberRead(BaseModel):
    registration_id: int
    display_name: str | None = None
    battle_tag: str | None = None
    slot_code: str | None = None
    is_substitute: bool = False
    is_captain: bool = False
    status: str


class RegistrationTeamInviteRead(BaseModel):
    id: int
    slot_code: str
    is_substitute: bool
    state: str
    target_auth_user_id: int | None = None
    #: True when the invite is a shareable link. The token itself is never
    #: serialized — it is returned once, by the create call.
    is_link: bool = False
    expires_at: datetime | None = None
    invited_at: datetime | None = None


class RegistrationTeamRead(BaseModel):
    id: int
    tournament_id: int
    name: str
    image_url: str | None = None
    status: str
    captain_registration_id: int | None = None
    exported_team_id: int | None = None
    members: list[RegistrationTeamMemberRead] = Field(default_factory=list)
    #: Outstanding offers. Only ever populated for the captain's own view and the
    #: organizer's — a public roster must not leak who has been asked.
    invites: list[RegistrationTeamInviteRead] = Field(default_factory=list)
    #: Slots with nobody accepted yet, in canonical order. Empty means complete.
    open_slots: dict[str, int] = Field(default_factory=dict)
    #: Human-readable rendering of ``open_slots`` for the captain's card.
    shortfall: str = "roster complete"
    is_complete: bool = False
    substitutes_used: int = 0
    max_substitutes: int = 0

    @field_validator("open_slots")
    @classmethod
    def _known_codes(cls, slots: dict[str, int]) -> dict[str, int]:
        unknown = set(slots) - set(ROSTER_SLOT_CODES)
        if unknown:
            raise ValueError(f"Unknown roster slot codes: {', '.join(sorted(unknown))}")
        return slots


class RegistrationTeamListResponse(BaseModel):
    items: list[RegistrationTeamRead] = Field(default_factory=list)
    total: int = 0


def serialize_registration_team(
    team: models.BalancerRegistrationTeam,
    occupancy: RosterOccupancy,
    *,
    members: list[RegistrationTeamMemberRead] | None = None,
    invites: list[RegistrationTeamInviteRead] | None = None,
) -> RegistrationTeamRead:
    """Map a team plus its computed occupancy into the read model.

    Only slots the roster still needs are emitted — a zero entry would render as
    "0x tank" in every consumer that iterates the map.
    """
    return RegistrationTeamRead(
        id=team.id,
        tournament_id=team.tournament_id,
        name=team.name,
        image_url=team.image_url,
        status=team.status,
        captain_registration_id=team.captain_registration_id,
        exported_team_id=team.exported_team_id,
        members=members or [],
        invites=invites or [],
        open_slots={code: count for code, count in occupancy.open_slots.items() if count > 0},
        shortfall=occupancy.describe_shortfall(),
        is_complete=occupancy.is_complete,
        substitutes_used=occupancy.accepted_substitutes,
        max_substitutes=occupancy.max_substitutes,
    )


def serialize_invite(invite: models.BalancerRegistrationTeamInvite) -> RegistrationTeamInviteRead:
    """Serialize an outstanding offer.

    ``token_sha256`` is reduced to the boolean ``is_link``: the hash is not secret,
    but serving it would let a caller confirm a guessed token offline, and nothing
    downstream needs it.
    """
    return RegistrationTeamInviteRead(
        id=invite.id,
        slot_code=invite.slot_code,
        is_substitute=bool(invite.is_substitute),
        state=invite.state,
        target_auth_user_id=invite.target_auth_user_id,
        is_link=invite.token_sha256 is not None,
        expires_at=invite.expires_at,
        invited_at=invite.invited_at,
    )
