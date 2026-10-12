"""Captain result-submission and map-veto request schemas + viewer-side helper.

Extracted verbatim from the decommissioned ``src/routes/captain.py`` so the
typed-RPC handlers in ``src/rpc/public_rpc.py`` keep validating the SAME bodies
and resolving the viewer side identically. This module must NOT import fastapi.
"""

from __future__ import annotations

from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from src import models
from src.services.encounter import captain as captain_mod

# ── Schemas ──────────────────────────────────────────────────────────────


class PickBanActionInput(BaseModel):
    """One ban/pick/protect against an OPEN (non-blind) step of a hero- or
    map-kind pick-ban session. ``target_player_id`` is required exactly when
    the step names an opponent roster player (``step.target``)."""

    #: The catalog item, or -- for a ``side_pick`` step -- the INDEX into the
    #: discipline's side codes (the room state's ``sides`` array).
    item_id: int
    action: str  # "ban" | "pick" | "protect" | "side_pick"
    target_player_id: int | None = None


class PickBanSubmissionItemInput(BaseModel):
    """One item of a blind draft: what is chosen, and for whom on a target step."""

    item_id: int
    target_player_id: int | None = None


class PickBanSubmitInput(BaseModel):
    """A blind step's whole draft, replacing whatever the participation had.
    ``lock`` validates it in full and makes it final — the step reveals once
    every acting participation has locked."""

    items: list[PickBanSubmissionItemInput] = Field(default_factory=list)
    lock: bool = False


class ElectOpenerInput(BaseModel):
    """``result_loser_choice`` rotation only: the losing captain names which
    PARTICIPATION opens the next round's bans."""

    first_team_id: int


class PickBanUndoInput(BaseModel):
    """One captain's consent to undo the session's last action. ``consent=False``
    withdraws an open request — the asker changing their mind and the opponent
    refusing are the same outcome, so they share one field."""

    consent: bool = True


class GameResultInput(BaseModel):
    """One participation's numbers inside a game claim."""

    encounter_team_id: int
    score: int | None = Field(default=None, ge=0)
    placement: int | None = Field(default=None, ge=1)
    column_values: dict[str, float] = Field(default_factory=dict)


class GameReportInput(BaseModel):
    """One captain's independent claim of a single played GAME's result —
    submitted immediately after that position, not at series end (contrast
    ``CaptainReportSubmission``). The position, not the map, identifies what is
    being claimed: a series may play the same map twice. See
    ``services.encounter.map_report``."""

    #: The ``game.result_version`` the claim was made against -- a correction
    #: landing in between makes this claim stale rather than silently winning.
    basis_version: int = 0
    results: list[GameResultInput] = Field(default_factory=list)


class GameMapSelectInput(BaseModel):
    """Freeplay's half of what the map pick-ban does automatically: a captain
    names the map an open position is played on."""

    map_id: int


class CaptainMapCodeInput(BaseModel):
    map_index: int = Field(ge=1)
    code: str = Field(min_length=1, max_length=32)


class CaptainReportSubmission(BaseModel):
    """One captain's independent encounter report.

    ``home_score``/``away_score`` are in the encounter's home/away orientation.
    Everything else is optional here and validated against the tournament's
    report-form config server-side (``services.encounter.report_form``), because
    what is required depends on that config, not on the wire shape.
    """

    home_score: int = Field(ge=0)
    away_score: int = Field(ge=0)
    closeness: int | None = Field(default=None, ge=1, le=10)
    map_codes: list[CaptainMapCodeInput] = Field(default_factory=list)
    comment: str | None = None
    custom_fields: dict[str, str] = Field(default_factory=dict)


# HTTP 403 Forbidden — matched without importing fastapi so this module stays
# fastapi-free. ``captain_service.resolve_participation`` raises a
# ``HTTPException`` whose ``status_code`` we inspect by attribute.
_HTTP_403_FORBIDDEN = 403


async def resolve_optional_viewer_team(
    session: AsyncSession,
    auth_user: models.AuthUser | None,
    encounter: models.Encounter,
) -> int | None:
    """The PARTICIPATION a viewer captains, for read-only annotation, or ``None``.

    An authenticated captain gets their own seat's id; anonymous and
    non-captain viewers get ``None`` (and see the pool serialized identically —
    ``viewer_team_id`` is presentation only, except that a blind step's draft
    is private to its own seat). A 403 means "not a captain" and resolves to
    ``None``.
    """
    if auth_user is None:
        return None
    try:
        participation, _player_id = await captain_mod.captain_service.resolve_participation(
            session, auth_user, encounter
        )
    except Exception as exc:  # noqa: BLE001 - re-raised below unless it's a 403
        if getattr(exc, "status_code", None) == _HTTP_403_FORBIDDEN:
            return None
        raise
    return participation.id
