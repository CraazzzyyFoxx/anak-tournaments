"""The caller's own pickup-mix settings: everything a host configures, once.

Deliberately not the full ``ConfigOverrides`` vocabulary -- only these keys ever
reach the mix engine, so the wire names them one by one instead of carrying an
opaque blob a client could stuff a tournament-GA knob into. The read and the
write carry the same stored fields: a PUT answers with exactly what the next GET returns.
"""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field

from src.domain.balancer.config.defaults import MAX_RESULT_VARIANTS, validate_role_settings

__all__ = (
    "MAX_POINTS_PER_WIN",
    "MixRoleSettings",
    "UserMixPreferencesRead",
    "UserMixPreferencesUpsert",
)

#: Upper bound on the rank-adjustment-per-win. Generous for any plausible rank
#: scale, guards against a fat-fingered setting wrecking the host's whole rank
#: book in one recorded match.
MAX_POINTS_PER_WIN = 1000

_TILT_DOC = (
    "Trade-off between rank balance (0) and role comfort (1); null leaves the mix engine's own 0.5 weighting in place."
)
_SETTINGS_DOC = (
    "Per-role mix weights, keyed by declared role code: how much this role's gap counts "
    "towards role fairness. An omitted role weighs 1.0; null means no per-role opinion at all."
)
_VARIANTS_DOC = "How many balance options the solver keeps for the host to page through; null leaves the mix default."
_POINTS_DOC = (
    "How far a decided match moves both teams' ranks in this account's own rank book. "
    "0 and null both mean recording a match adjusts nothing."
)
_MODE_DOC = (
    "How recording a match moves this account's rank book: 'points' by points_per_win, 'ranker' by the "
    "mix ranker (each seat by its own amount; mixes then balance on the effective rating). The workspace's "
    "hidden ratings advance in both."
)

RatingMode = Literal["points", "ranker"]


class MixRoleSettings(BaseModel):
    """The mix engine's share of a role's settings -- the only one a host may set.

    The tournament drawer owns the rest (``impact``, the line weights), and
    ``extra="forbid"`` is what keeps a host from storing a GA knob through their
    own preferences.
    """

    model_config = ConfigDict(extra="forbid")

    mix_weight: float = Field(ge=0.0, le=100.0, description="Multiplier for this role's gap in role fairness.")


_RoleSettings = Annotated[dict[str, MixRoleSettings], BeforeValidator(validate_role_settings)]


class UserMixPreferencesRead(BaseModel):
    """Stored preferences; unset knobs use the engine defaults."""

    mix_comfort_tilt: float | None = Field(default=None, ge=0.0, le=1.0, description=_TILT_DOC)
    role_settings: _RoleSettings | None = Field(default=None, description=_SETTINGS_DOC)
    max_result_variants: int | None = Field(default=None, ge=1, le=MAX_RESULT_VARIANTS, description=_VARIANTS_DOC)
    open_slot_settings: MixRoleSettings | None = None
    points_per_win: int | None = Field(default=None, ge=0, le=MAX_POINTS_PER_WIN, description=_POINTS_DOC)
    rating_mode: RatingMode = Field(default="points", description=_MODE_DOC)


class UserMixPreferencesUpsert(BaseModel):
    """A full replacement; nullable knobs unset the corresponding override."""

    model_config = ConfigDict(extra="forbid")

    mix_comfort_tilt: float | None = Field(ge=0.0, le=1.0, description=_TILT_DOC)
    role_settings: _RoleSettings | None = Field(description=_SETTINGS_DOC)
    max_result_variants: int | None = Field(ge=1, le=MAX_RESULT_VARIANTS, description=_VARIANTS_DOC)
    open_slot_settings: MixRoleSettings | None
    points_per_win: int | None = Field(ge=0, le=MAX_POINTS_PER_WIN, description=_POINTS_DOC)
    rating_mode: RatingMode = Field(description=_MODE_DOC)
