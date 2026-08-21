"""Draft-domain value types: no I/O, no algorithm, no orchestration.

Every dataclass the draft package passes between its services lives here —
mirrors ``services/balancer/algorithm/entities.py``'s role for the balancing
engine. Kept out of ``src/schemas/`` deliberately: those are pydantic wire
contracts for the RPC boundary and are ORM-free by design (no schema module
imports ``shared.models``); several types below (``DraftSnapshot``,
``DraftResult``) hold live ORM rows and would break that invariant.

Producing modules re-import the names they use (``lifecycle.py`` imports
``CaptainSeed``/``PlayerSeed``, ``selection.py`` imports ``DraftResult``/
``SlotDecision``, etc.) so every existing ``<module>.<Type>`` access — from
other draft files, ``rpc/draft.py``, and tests — keeps resolving unchanged.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field

from shared.core.enums import HeroClass
from shared.models.balancer.draft import DraftPick, DraftPlayer, DraftTeam

__all__ = (
    "CaptainSeed",
    "DEFAULT_ROLE_IMPACT",
    "DraftAssignment",
    "DraftFeasibilityReport",
    "DraftFeasibilityState",
    "DraftPickOption",
    "DraftResult",
    "DraftSlot",
    "DraftSnapshot",
    "EligiblePlayer",
    "FitConfig",
    "FitPlayer",
    "FitResult",
    "PlayerSeed",
    "RoleEditPreview",
    "RoleEditResult",
    "SlotDecision",
    "SlotDeficit",
)


# --- feasibility (services/draft/feasibility{,_algorithm}.py) --------------


@dataclass(frozen=True)
class EligiblePlayer:
    player_id: int
    playable_roles: frozenset[HeroClass]


@dataclass(frozen=True)
class DraftAssignment:
    player_id: int
    team_id: int
    # A roster slot code, so ``flex`` is expressible; see
    # ``feasibility_algorithm._remaining_capacity`` for how a role code that no
    # longer has room falls back to a free flex slot.
    slot_code: str


@dataclass(frozen=True)
class DraftSlot:
    team_id: int
    slot_code: str
    ordinal: int


@dataclass(frozen=True)
class SlotDeficit:
    slot_code: str
    unmatched_slots: int
    eligible_players: int


@dataclass(frozen=True)
class DraftFeasibilityReport:
    is_feasible: bool
    total_open_slots: int
    matched_slots: int
    unmatched_slots: tuple[DraftSlot, ...]
    slot_deficits: tuple[SlotDeficit, ...]
    blocking_player_ids: tuple[int, ...]
    reason_code: str | None = None


@dataclass(frozen=True)
class DraftPickOption:
    player_id: int
    role: HeroClass
    is_safe: bool
    reason_code: str | None
    unmatched_slots: tuple[DraftSlot, ...] = ()
    blocking_player_ids: tuple[int, ...] = ()


@dataclass(frozen=True)
class DraftFeasibilityState:
    team_ids: tuple[int, ...]
    slot_targets: dict[str, int]
    players: tuple[EligiblePlayer, ...]
    assignments: tuple[DraftAssignment, ...]


@dataclass(frozen=True)
class DraftSnapshot:
    """One consistent read of a session's team/player/pick rows.

    Loaded once per request and shared by every step that needs the session
    contents (role counts, fit construction, feasibility state) instead of
    each step re-querying the same rows.
    """

    teams: tuple[DraftTeam, ...]
    players: tuple[DraftPlayer, ...]
    picks: tuple[DraftPick, ...]


# --- seeding (services/draft/lifecycle.py) ----------------------------------


@dataclass(frozen=True)
class CaptainSeed:
    name: str
    draft_position: int
    user_id: int | None = None
    auth_user_id: int | None = None
    battle_tag: str | None = None
    # Real role/rank when the captain is drawn from the balancer pool.
    primary_role: HeroClass | None = None
    sub_role: str | None = None
    is_flex: bool = False
    division_number: int | None = None
    rank_value: int | None = None
    role_ranks: dict = field(default_factory=dict)
    role_top_heroes: dict = field(default_factory=dict)
    additional_info: dict = field(default_factory=dict)


@dataclass(frozen=True)
class PlayerSeed:
    primary_role: HeroClass
    user_id: int | None = None
    battle_tag: str | None = None
    secondary_roles: list[HeroClass] = field(default_factory=list)
    sub_role: str | None = None
    is_flex: bool = False
    division_number: int | None = None
    rank_value: int | None = None
    role_ranks: dict = field(default_factory=dict)
    role_top_heroes: dict = field(default_factory=dict)
    additional_info: dict = field(default_factory=dict)


# --- pick selection (services/draft/selection.py) ---------------------------


@dataclass(frozen=True)
class DraftResult:
    pick: DraftPick
    next_pick: DraftPick | None
    completed: bool
    blocked_reason: str | None = None


@dataclass(frozen=True)
class SlotDecision:
    """What a pick resolves to against the roster shape.

    ``role`` is the role the pick is scored and matched as; ``recorded_role`` is
    what lands in ``DraftPick.target_role`` -- ``None`` on a role-less roster,
    where a role would be a value the shape gives no meaning to.
    """

    role: HeroClass
    recorded_role: str | None


# --- role edits (services/draft/role_edit.py) -------------------------------


@dataclass(frozen=True)
class RoleEditPreview:
    before: DraftFeasibilityReport
    after: DraftFeasibilityReport


@dataclass(frozen=True)
class RoleEditResult:
    player_id: int
    role: HeroClass
    player_version: int
    committed: bool
    preview: RoleEditPreview


# --- autopick fit scoring (services/draft/suggestions.py) -------------------

# Role-impact weights — mirror moo_core/src/lib.rs (tank 1.4 / dps 1.0 / support 1.1).
DEFAULT_ROLE_IMPACT: dict[HeroClass, float] = {
    HeroClass.tank: 1.4,
    HeroClass.damage: 1.0,
    HeroClass.support: 1.1,
}


@dataclass(frozen=True)
class FitPlayer:
    player_id: int
    rank_value: int
    playable_roles: frozenset[HeroClass]
    preference_order: tuple[HeroClass, ...] = ()
    is_flex: bool = False
    user_id: int | None = None
    # Per-role ranks (role -> SR). ``rank_value`` is the fallback when a role
    # has no specific entry, so candidates are scored at the rank of the role
    # they'd actually fill — not their primary-role rank.
    rank_by_role: Mapping[HeroClass, int] = field(default_factory=dict)

    def rank_for(self, role: HeroClass) -> int:
        return self.rank_by_role.get(role, self.rank_value)


@dataclass(frozen=True)
class FitConfig:
    role_impact: Mapping[HeroClass, float] = field(default_factory=lambda: dict(DEFAULT_ROLE_IMPACT))
    discomfort_weight: float = 1.0
    # Large enough that role-need dominates raw fit when filling scarce roles.
    role_need_bonus: float = 1_000_000.0


@dataclass(frozen=True)
class FitResult:
    player_id: int
    role: HeroClass
    fit_score: float
    breakdown: dict[str, float]

