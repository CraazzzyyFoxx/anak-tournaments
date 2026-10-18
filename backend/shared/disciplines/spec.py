"""What the code knows about a discipline, beside what the DB stores (D25, D31, D48, D83, D88, D101).

Pure declarations and validation, no DB: the pick-ban engine, ruleset validator and game writer read it, and none may do
IO to answer "does this game have sides". The role ontology and the team-format presets declared here are projected into
``catalog.role_dimension``/``catalog.role`` at startup (``shared.services.ontology``) and copied into
``roster.team_format`` (``shared.services.team_format``).
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Literal

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

    from shared.catalog_sync import CatalogImageMirror
    from shared.models.identity.auth_user import AuthUser

#: Pull the module's catalog source into ``catalog.entity`` (commits itself).
CatalogSync = Callable[["AsyncSession", "CatalogImageMirror"], Awaitable[None]]

#: A game's native rank layer (D87): ``players.user`` ids -> ``{user_id: {role code: rank}}``, the best rank a player
#: holds per role of the rated dimension on the game's own ladder; the core places it on a division grid. Reads only.
NativeRanks = Callable[["AsyncSession", Sequence[int]], Awaitable[dict[int, dict[str, int]]]]

#: A collection RPC the module serves (``rank.collect``): ``(session, caller or None for a public read, gateway data)``.
#: The handler validates its own payload and authorizes the caller; it returns what the RPC envelope serializes.
CollectionHandler = Callable[["AsyncSession", "AuthUser | None", dict[str, Any]], Awaitable[object]]

#: ``register_jobs(broker, *, session_factory, redis, logger)``: bind the module's consumers on the worker broker.
RegisterJobs = Callable[..., None]

#: ``start_jobs(*, session_factory, redis, logger)``: start the module's schedules and clients, once the broker is up.
StartJobs = Callable[..., Awaitable[None]]

#: ``stop_jobs()``: the call itself stops the module's schedules; awaiting the result releases its clients. The worker
#: calls it when shutdown begins and awaits it once consumers have drained.
StopJobs = Callable[[], Awaitable[None]]

__all__ = (
    "CATALOG_KINDS",
    "CatalogSync",
    "CollectionHandler",
    "DimensionSpec",
    "DisciplineSpec",
    "EventTypeSpec",
    "FormatDimensionSpec",
    "FormatRuleSpec",
    "NativeRanks",
    "NativeTier",
    "RegisterJobs",
    "RoleSpec",
    "StartJobs",
    "StopJobs",
    "StatAggregation",
    "StatDefSpec",
    "StatFormat",
    "TeamFormatPreset",
)

#: The core's catalog vocabulary (D101): ``catalog.entity.kind`` and every kind-constant column spell these and
#: nothing else. What a kind is called in a game's UI is the module's label, not a new kind.
CATALOG_KINDS: tuple[str, ...] = ("character", "map", "mode")


SelectionMode = Literal["single", "multi"]
DimensionMode = Literal["off", "informational", "preference", "enforced"]
StatFormat = Literal["integer", "decimal", "percent", "duration"]
StatAggregation = Literal["sum", "max", "min", "avg", "last"]


@dataclass(frozen=True, slots=True)
class StatDefSpec:
    code: str
    name: str
    value_format: StatFormat = "integer"
    aggregation: StatAggregation = "sum"
    group: str | None = None


@dataclass(frozen=True, slots=True)
class EventTypeSpec:
    code: str
    name: str


@dataclass(frozen=True, slots=True)
class RoleSpec:
    """A role the module declares (D31): projected into ``catalog.role`` with ``workspace_id IS NULL``."""

    code: str
    name: str


@dataclass(frozen=True, slots=True)
class DimensionSpec:
    """One axis of a game's roles (§8.3): ``single``/``multi``, and whether ranks hang off it (D32)."""

    code: str
    name: str
    selection_mode: SelectionMode
    rated: bool
    roles: tuple[RoleSpec, ...]


@dataclass(frozen=True, slots=True)
class FormatDimensionSpec:
    dimension: str
    mode: DimensionMode
    player_min_assignments: int | None = None
    player_max_assignments: int | None = None


@dataclass(frozen=True, slots=True)
class FormatRuleSpec:
    """A quota on one role. ``None`` is "no rule", never zero (§8.3)."""

    dimension: str
    role: str
    hard_min: int | None = None
    hard_max: int | None = None
    recommended_min: int | None = None
    recommended_max: int | None = None
    include_descendants: bool = True


@dataclass(frozen=True, slots=True)
class TeamFormatPreset:
    """A team format the module offers (D35, D88); an owner gets a copy, never a reference."""

    code: str
    name: str
    starter_min: int
    starter_max: int
    substitute_min: int = 0
    substitute_max: int = 0
    dimensions: tuple[FormatDimensionSpec, ...] = ()
    rules: tuple[FormatRuleSpec, ...] = ()


@dataclass(frozen=True, slots=True)
class NativeTier:
    """One sub-tier of a game's native ladder (D87), numbered 1 from the top.

    ``native_division``/``native_tier`` are the names the game's rank source reports.
    """

    number: int
    slug: str
    name: str
    rank_min: int
    rank_max: int | None
    icon_url: str
    native_division: str
    native_tier: int


@dataclass(frozen=True, slots=True)
class DisciplineSpec:
    code: str
    name: str
    #: Side codes a game of this discipline starts on, in declaration order; ``()`` when the game has no sides. A
    #: ``side_pick`` step is legal only when this has exactly as many entries as the game has participants.
    sides: tuple[str, ...] = ()
    #: The catalog kinds this game has, each with its UI label ("Hero", "Champion").
    kinds: dict[str, str] = field(default_factory=dict, hash=False)
    #: Allowed ``attrs.class`` values of a ``character``; ``()`` leaves the class unchecked.
    character_classes: tuple[str, ...] = ()
    catalog_sync: CatalogSync | None = field(default=None, compare=False)
    #: Where a player's rank on the game's own ladder comes from (D87); ``None`` when the game has none (LoL: ranks are
    #: entered by the organiser).
    native_ranks: NativeRanks | None = field(default=None, compare=False)
    #: The game's own ladder, top tier first (D87); ``()`` when the organiser enters ranks (LoL).
    native_ladder: tuple[NativeTier, ...] = ()
    #: The role ontology (D31); exactly one dimension is ``rated`` (D32).
    dimensions: tuple[DimensionSpec, ...] = ()
    #: Team-format presets; the first is what an owner without a format of its own gets (D35).
    team_format_presets: tuple[TeamFormatPreset, ...] = ()
    #: The provider used for default form identities, roster names and log matching (D90).
    identity_provider: str | None = None
    #: Projected SMALLINT dictionaries; historical definitions are deactivated, never deleted.
    stat_defs: tuple[StatDefSpec, ...] = ()
    event_types: tuple[EventTypeSpec, ...] = ()
    #: Worker lifecycle hooks (optional plain callables): ``register_jobs`` binds consumers on the worker's broker,
    #: ``start_jobs`` starts schedules and clients, ``stop_jobs`` stops them. A worker runs only the selected
    #: disciplines' hooks, so a game without background jobs (LoL) triggers none.
    register_jobs: RegisterJobs | None = field(default=None, compare=False)
    start_jobs: StartJobs | None = field(default=None, compare=False)
    stop_jobs: StopJobs | None = field(default=None, compare=False)
    #: RPC suffix (``rank.collect``) -> handler for the collection operations the module serves.
    collection_handlers: dict[str, CollectionHandler] = field(default_factory=dict, compare=False, hash=False)

    @property
    def rated_dimension(self) -> DimensionSpec:
        rated = [dimension for dimension in self.dimensions if dimension.rated]
        if len(rated) != 1:
            raise LookupError(
                f"discipline {self.code!r} declares {len(rated)} rated dimensions; exactly one is required (D32)"
            )
        return rated[0]

    def preset(self, code: str | None = None) -> TeamFormatPreset:
        """The preset called ``code``; ``None`` is the module's default, its first."""
        if not self.team_format_presets:
            raise LookupError(f"discipline {self.code!r} declares no team-format preset")
        if code is None:
            return self.team_format_presets[0]
        for preset in self.team_format_presets:
            if preset.code == code:
                return preset
        raise LookupError(f"discipline {self.code!r} has no team-format preset {code!r}")

    def validate_attrs(self, kind: str, attrs: Mapping[str, object]) -> None:
        """Reject catalog values that the public projections cannot read; absent optional keys use defaults."""
        if kind == "character" and self.character_classes and attrs.get("class") not in self.character_classes:
            raise ValueError(f"attrs.class must be one of: {', '.join(self.character_classes)}")
        if "color" in attrs and not isinstance(attrs["color"], str):
            raise ValueError("attrs.color must be a string")
        if "in_competitive" in attrs and not isinstance(attrs["in_competitive"], bool):
            raise ValueError("attrs.in_competitive must be a boolean")
