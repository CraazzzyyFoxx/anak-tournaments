"""Kill-feed / event timeline read schemas for a single match.

Backed by discipline-scoped ``stats.event`` rows. Player
display names are intentionally NOT included — the client already has the full
roster (``user_id`` → name) from the match read and resolves them there, which
keeps this payload lean and the names consistent with the stats tables. Only the
hero *at the moment of the event* is joined (it can differ from the aggregate
roster hero), so the timeline shows the correct hero per kill.
"""

from __future__ import annotations

from pydantic import BaseModel

from src.schemas.hero import HeroRead

__all__ = (
    "KillFeedEntry",
    "MatchTimelineEvent",
    "MatchKillFeedRead",
)


class KillFeedEntry(BaseModel):
    time: float
    round: int
    fight: int | None
    ability: str | None
    damage: float | None
    is_critical_hit: bool | None
    is_environmental: bool | None
    killer_user_id: int | None
    killer_team_id: int | None
    killer_hero: HeroRead | None
    victim_user_id: int | None
    victim_team_id: int | None
    victim_hero: HeroRead | None


class MatchTimelineEvent(BaseModel):
    """A non-kill timeline event (ultimate cast, resurrect) worth surfacing."""

    time: float
    round: int
    name: str
    user_id: int | None
    team_id: int | None
    hero: HeroRead | None
    related_user_id: int | None
    related_team_id: int | None


class MatchKillFeedRead(BaseModel):
    match_id: int
    kills: list[KillFeedEntry]
    events: list[MatchTimelineEvent]
