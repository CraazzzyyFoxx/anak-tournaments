"""The admin rank overview's wire shape: one row per rank value.

Long format on purpose -- the nine layers a rank can live in have genuinely
different grain (member x role, member x author x role, one roster seat, one
recorded match seat), so a wide row would be mostly NULL whichever grain it
picked. The per-layer extras (``sigma``, ``delta``, ``canon_diff``, the native
OW pair) are therefore optional and documented by which layer fills them.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal, get_args

from pydantic import BaseModel, Field

from shared.schemas.identity import PlayerIdentityRead

__all__ = (
    "CURRENT_LAYERS",
    "HISTORY_LAYERS",
    "LAYERS",
    "SORTS",
    "RankContext",
    "RankOverviewRow",
)

#: Layers that describe a member's rank *now* -- the default filter.
CurrentRankLayer = Literal["canon", "author", "ow", "hidden", "effective_tournament", "effective_mix"]

#: Layers that describe a rank somebody held at some past moment.
HistoryRankLayer = Literal["registration", "tournament", "casual"]

RankLayer = Literal[CurrentRankLayer, HistoryRankLayer]

CURRENT_LAYERS: tuple[str, ...] = get_args(CurrentRankLayer)
HISTORY_LAYERS: tuple[str, ...] = get_args(HistoryRankLayer)

#: Declaration order is also the ``layer`` sort order and the union's branch order.
LAYERS: tuple[str, ...] = CURRENT_LAYERS + HISTORY_LAYERS

#: Sortable columns; everything else in the ORDER BY is a stable tiebreak.
SORTS: tuple[str, ...] = ("at", "rank_value", "display_name", "layer", "role", "canon_diff", "delta")

#: Where an effective value actually came from -- the resolver's own vocabulary
#: (``shared.domain.member_rank.RankScope``), minus the layers the two effective
#: orders never consult.
RankSource = Literal["author", "workspace", "native"]


class RankContext(BaseModel):
    """What the row belongs to, when it belongs to something.

    ``tournament`` for registration/roster rows, ``mix`` for a recorded casual
    match, ``native_account`` for a game-native rank snapshot (Overwatch: a BattleTag) --
    whose ``team`` carries the snapshot's platform, the only thing an account is further split by.
    """

    kind: Literal["tournament", "mix", "native_account"]
    id: int | None = Field(default=None, description="Tournament or custom-game id; null for a native account.")
    label: str
    team: str | None = Field(default=None, description="Roster team name, or the platform on an ow row.")
    lobby_index: int | None = Field(default=None, description="Which lobby of the mix played the match.")


class RankOverviewRow(BaseModel):
    layer: RankLayer
    discipline: str = Field(description="The row's game: one code, or every enabled game's rows without a filter.")
    player_id: int = Field(description="players.user id -- the identity /admin/people/[id] is keyed by.")
    member_id: int = Field(description="workspace_member id.")
    display_name: str | None = None
    identity: PlayerIdentityRead | None = Field(
        default=None, description="The member's primary handle for the discipline's identity provider."
    )
    author_user_id: int | None = Field(
        default=None, description="auth.user id of the book's author, the mix's host, or null."
    )
    author_name: str | None = None
    role: str | None = Field(default=None, description="Role code; casual rows may also name an open slot.")
    rank_value: int
    division: int | None = Field(
        default=None,
        description="Resolved on the workspace's effective grid of the row's game; null when the game has none here.",
    )
    source: RankSource | None = Field(default=None, description="effective_* only: which layer won.")
    sigma: float | None = Field(default=None, description="hidden only.")
    delta: int | None = Field(default=None, description="casual only: how far the match moved this seat.")
    canon_diff: int | None = Field(default=None, description="author only: rank_value minus the canon, null if none.")
    ow_division: str | None = Field(default=None, description="ow only: the native OverFast division, e.g. 'gold'.")
    ow_tier: int | None = Field(default=None, description="ow only: the native tier inside that division.")
    context: RankContext | None = None
    at: datetime | None = Field(default=None, description="Null on the computed effective layers.")
