"""The one shape of "what roles does a player have, and at what rank".

Every surface -- the admin registration list, the ``ready``/``incomplete``
verdict, the balancer algorithm's input, the draft pool, the draft board,
feasibility, autopick and the draft's team export -- reads these value objects,
produced once by :mod:`shared.services.roster`. Nothing recomputes them, and
nothing stores a second copy: the single exception is the frozen
``(role, rank)`` a completed draft pick records, which is a historical fact
rather than a derivation.

The invariant:

    a role is playable  <=>  the registration marks it active
                             AND the rank resolver found a number for it

``is_active`` alone is not enough (a sheet row whose rank did not parse is
active with no number) and a raw ``rank_value`` alone is not enough (an
empty one *inherits* from the workspace canon or the latest Overwatch
snapshot). Both halves live here, together, once.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any

from shared.domain.forms import RolesParams, schema_from_form
from shared.domain.member_rank import RankSource
from shared.domain.roster_shape import FLEX_SLOT_CODE
from shared.schemas.identity import PlayerIdentityRead

__all__ = (
    "FLEX_ROLE_MODES",
    "CharacterRef",
    "FlexRoleMode",
    "PlayerRoster",
    "RosterRole",
    "flex_role_mode",
    "flex_role_mode_from_schema",
)

#: The ``flex_mode`` of the form schema's ``roles`` builtin.
#:
#: ``optional``   -- the registrant names the roles they play (default)
#: ``all_roles``  -- every role is playable; the registrant still names a priority
#: ``forced``     -- every role is playable AND primary, the choice is made for them
FlexRoleMode = str
FLEX_ROLE_MODES: tuple[str, ...] = ("optional", "all_roles", "forced")


def flex_role_mode_from_schema(schema: Any | None) -> str:
    """The flex mode of an already-parsed ``FormSchema``.

    ``flex_allowed=False`` bans the flex field outright and therefore wins over any
    ``flex_mode`` left behind in the schema -- a form cannot force every role playable
    through a field it does not show.
    """
    roles = schema.builtin("roles") if schema is not None else None
    if roles is None:
        return "optional"
    params = RolesParams.model_validate(roles.params)
    return params.flex_mode if params.flex_allowed else "optional"


def flex_role_mode(form: Any | None) -> str:
    """The tournament's flex mode, normalized. A form without a schema is ``optional``.

    THE reader of the ``roles`` builtin's ``flex_mode``: the tournament write path
    and the balancer draft must agree on it, so neither keeps its own copy.
    """
    return flex_role_mode_from_schema(schema_from_form(form))


@dataclass(frozen=True, slots=True)
class CharacterRef:
    """One of a role's top characters, ready for both the FK and the wire."""

    id: int | None
    slug: str
    image_path: str | None

    def wire(self) -> dict[str, Any]:
        return {"entity_id": self.id, "slug": self.slug, "image_path": self.image_path}


@dataclass(frozen=True, slots=True)
class RosterRole:
    role: str
    #: Resolved rank: the registration's own number, else the workspace canon,
    #: else the latest Overwatch snapshot (``TOURNAMENT_ORDER``). ``None`` means
    #: no layer had one, which is exactly what makes the role unplayable.
    rank: int | None
    source: RankSource
    is_primary: bool
    priority: int
    subrole: str | None
    top_characters: tuple[CharacterRef, ...] = ()

    @property
    def is_playable(self) -> bool:
        # ``> 0``, not ``is not None``: the balancer loader drops ``rank <= 0``
        # (``player_loader.parse_player_node``), so a zero here would be a player
        # the draft can pick and the balance run silently loses.
        return self.rank is not None and self.rank > 0


@dataclass(frozen=True, slots=True)
class PlayerRoster:
    """One registration's identity plus its resolved roles, priority-ordered.

    ``roles`` holds every role the registration declares as active, playable or
    not, because the organizer's ``ready``/``incomplete`` verdict is precisely
    "are all of them ranked". Consumers that only care about what can be drafted
    or balanced go through :attr:`playable_roles` / :meth:`rank_on`.
    """

    registration_id: int
    #: The registrant's PRIMARY handle of the owning tournament's identity provider
    #: (``registration_identity`` ``position=0``); ``None`` when they gave none of that
    #: provider -- never another game's handle.
    identity: PlayerIdentityRead | None
    display_name: str | None
    #: ``players.user.id`` via ``workspace_member`` -- ``None`` for a registration
    #: with no member (an admin-created row, or a sheet row never provisioned).
    player_id: int | None
    auth_user_id: int | None
    workspace_member_id: int | None
    roles: tuple[RosterRole, ...]
    #: Full flex: more than one PLAYABLE declared role and every one of them
    #: primary; ``forced`` mode makes it true for anyone with more than one
    #: playable role. Computed by the engine from the same roles as ``roles`` --
    #: never from raw registration rows, which count inactive/unranked ones.
    is_full_flex: bool
    #: Registration answers the draft board and the admin table both read.
    public_notes: str | None = None
    admin_notes: str | None = None
    custom_fields: Mapping[str, Any] = field(default_factory=dict)
    # ── Registration workflow, carried so a pool export is a full snapshot ──
    # Read straight off the registration row the engine already holds; no
    # consumer of the roster projection is required to look at them, which is
    # why every one has a default.
    status: str | None = None
    balancer_status: str | None = None
    exclude_reason: str | None = None
    checked_in: bool = False
    registration_team_id: int | None = None
    #: Captain-assigned roster slot code -- NOT derivable from
    #: ``roles``: ``flex`` is a slot, never a rated role.
    team_slot_code: str | None = None
    is_substitute: bool = False
    # ── Contact/private answers ─────────────────────────────────────────────
    #: ``provider -> PRIMARY handle`` from ``registration_identity``; absent
    #: provider = the registrant answered nothing for it. Extra handles of a
    #: provider are not here; the owner provider's are in :attr:`additional_handles`.
    identities: Mapping[str, str] = field(default_factory=dict)
    stream_pov: bool = False
    #: The registrant's owner-provider handles beyond the primary one, in the order
    #: given. :attr:`identity` is the primary.
    additional_handles: tuple[str, ...] = ()
    #: ``players.user.name`` -- the unique canonical name every profile link is built from (never a game handle).
    player_name: str | None = None

    @property
    def handle(self) -> str | None:
        """The primary handle alone, for labels that fall back to a display name."""
        return self.identity.handle if self.identity is not None else None

    # -- roles ---------------------------------------------------------------

    @property
    def playable(self) -> tuple[RosterRole, ...]:
        return tuple(entry for entry in self.roles if entry.is_playable)

    @property
    def playable_roles(self) -> frozenset[str]:
        return frozenset(entry.role for entry in self.roles if entry.is_playable)

    @property
    def primary(self) -> RosterRole | None:
        """The role this player leads with: their flagged primary, else the first.

        Resolved over playable roles only, so a rankless player is never labelled
        with a role nobody can draft them on.
        """
        playable = self.playable
        return next((entry for entry in playable if entry.is_primary), playable[0] if playable else None)

    @property
    def secondary_roles(self) -> tuple[str, ...]:
        lead = self.primary
        return tuple(entry.role for entry in self.playable if lead is None or entry.role != lead.role)

    @property
    def sub_role(self) -> str | None:
        lead = self.primary
        return lead.subrole if lead is not None else None

    # -- ranks ---------------------------------------------------------------

    def rank_on(self, role: str | None) -> int | None:
        """The rank this player carries on ``role``; ``None`` for no role at all.

        No fallback to another role's number: a role without a resolved rank is
        not playable, so answering with a neighbour's rank would invent a rating
        the captain then picks on. ``role=None`` is the honest input for a player
        holding no role -- a pool card, or a role-less roster slot -- and answers
        :attr:`best_rank`.
        """
        if role is None:
            return self.best_rank
        return next((entry.rank for entry in self.roles if entry.role == role and entry.is_playable), None)

    @property
    def best_rank(self) -> int | None:
        """The player's strongest playable role -- what a role-less roster is worth."""
        return max((entry.rank for entry in self.playable if entry.rank is not None), default=None)

    @property
    def role_ranks(self) -> dict[str, int]:
        """``{slot_code: rank}`` over playable roles. Absent key = not playable."""
        return {entry.role: entry.rank for entry in self.playable if entry.rank is not None}

    @property
    def role_sources(self) -> dict[str, RankSource]:
        return {entry.role: entry.source for entry in self.playable}

    @property
    def role_top_characters(self) -> dict[str, list[dict[str, Any]]]:
        return {
            entry.role: [character.wire() for character in entry.top_characters]
            for entry in self.playable
            if entry.top_characters
        }

    @property
    def role_sub_roles(self) -> dict[str, str]:
        """``{slot_code: subrole}`` over playable roles that declare one.

        Per-role twin of :attr:`sub_role`, which only ever answers for the lead
        role: a damage main who flexes support is a hitscan AND a flex support,
        and the draft board renders both.
        """
        return {entry.role: entry.subrole for entry in self.playable if entry.subrole}

    # -- verdicts ------------------------------------------------------------

    @property
    def is_ranked_complete(self) -> bool:
        """Every declared role has a rank -- the ``ready`` half of the pool verdict."""
        return bool(self.roles) and all(entry.is_playable for entry in self.roles)

    @property
    def is_draftable(self) -> bool:
        """At least one playable role: below this a player cannot be picked at all."""
        return bool(self.playable)

    def covers(self, role: str | None) -> bool:
        """Whether this player can fill a slot of ``role``; a role-less slot fits anyone."""
        if role is None or role == FLEX_SLOT_CODE:
            return self.is_draftable
        return role in self.playable_roles
