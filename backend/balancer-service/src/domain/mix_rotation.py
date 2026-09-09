"""Rotation-fairness recommender for a pickup mix's next map.

Pure domain algorithm: no I/O, no ORM, no async. The caller (custom game
service) resolves the pool and per-map history from the database -- ``list_matches``
plus the roster's ``created_at`` to know who was even around for a given map --
and how many seats the next map has (``usable_count``, the same
``num_teams * players_per_team`` math ``domain.balancer.runtime`` already does
for overflow benching), then hands both to :func:`recommend_rotation`.

"Who sat out and is owed a seat" and "who should sit next" are the same
question asked from two ends, not two rules to tune independently: they must
always add up to exactly the number of seats the next map does *not* have.
Ranking the whole pool once by rotation fairness and splitting it at
``usable_count`` keeps that in sync automatically -- a player who sat out last
map cannot simultaneously be owed a seat and be in the sit-out remainder,
because both answers come from the same ordered list.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from enum import Enum

__all__ = ("RotationStatus", "PlayerHistory", "RotationRecommendation", "recommend_rotation", "rotation_priority")


class RotationStatus(Enum):
    MUST_PLAY = "must_play"
    SHOULD_REST = "should_rest"
    NEUTRAL = "neutral"


@dataclass(frozen=True)
class PlayerHistory:
    """One pool member's map-by-map presence, oldest map first.

    ``played`` covers only maps recorded after this member joined the pool --
    a map played before they signed up is not a map they "sat out". ``True``
    means they were seated for that map, ``False`` means they were eligible
    but not seated (benched, overflow-trimmed, or absent from the lineup).

    ``pinned_must_play`` mirrors ``CustomGamePlayer.must_play`` -- the host's
    own override always wins a seat and never competes for one.
    """

    member_id: int
    played: tuple[bool, ...]
    pinned_must_play: bool = False


@dataclass(frozen=True)
class RotationRecommendation:
    member_id: int
    status: RotationStatus
    reason: str
    consecutive_sat: int
    consecutive_played: int
    games_played: int


def _streak_from_end(played: Sequence[bool], *, value: bool) -> int:
    streak = 0
    for flag in reversed(played):
        if flag != value:
            break
        streak += 1
    return streak


def rotation_priority(history: PlayerHistory) -> float:
    """Single sortable score ranking one player by rotation fairness -- lower sorts first (kept
    longest before an uneven roster's overflow trim reaches for someone).

    Combines the same three keys ``recommend_rotation`` ranks by internally into one float wide
    enough that no later key can outweigh an earlier one (sat-out streak beats played streak beats
    total games, exactly like the tuple sort there), so it survives a JSON round trip as a single
    ``identity.rotationPriority`` number on ``domain.balancer.entities.Player`` -- a caller ordering
    the pool *before* it reaches ``run_balance`` (whose own overflow trim in
    ``domain.balancer.runtime._prepare_balance_context`` has no fairness of its own) can make that
    trim land on the same player the rotation hints would flag ``SHOULD_REST``, instead of an
    arbitrary tail order Balance never explained.
    """
    sat = _streak_from_end(history.played, value=False)
    played_streak = _streak_from_end(history.played, value=True)
    return (-sat * 1_000_000) + (played_streak * 1_000) + sum(history.played)


def recommend_rotation(histories: Sequence[PlayerHistory], *, usable_count: int) -> list[RotationRecommendation]:
    """Rank the pool by rotation fairness and split it at ``usable_count``.

    Ranking key for who most deserves the next seat (checked in order):
    1. longest current run of sat-out maps -- owed a seat the longest.
    2. shortest current run of played-in-a-row maps -- least likely tired.
    3. fewest total maps played this game -- fatigue by volume.
    4. input order, for determinism when history is identical or empty.

    A ``pinned_must_play`` member always keeps a seat and is ranked ahead of
    everyone else; the remaining seats (``usable_count`` minus pinned seats)
    go to the top of that ranking. If ``usable_count`` covers the whole pool,
    or none of the non-pinned members have played a single map yet, everyone
    comes back ``NEUTRAL`` (a pin still wins its seat) -- there is no fairness
    signal to rotate on, so nobody gets told to rest on the strength of a tie-
    break that only exists to keep sorting deterministic.
    """
    if usable_count >= len(histories):
        return [
            RotationRecommendation(
                member_id=h.member_id,
                status=RotationStatus.NEUTRAL,
                reason="Мест хватает на весь пул",
                consecutive_sat=_streak_from_end(h.played, value=False),
                consecutive_played=_streak_from_end(h.played, value=True),
                games_played=sum(h.played),
            )
            for h in histories
        ]

    if all(not h.played for h in histories if not h.pinned_must_play):
        # Brand-new mix (or every current row joined after the last recorded
        # map): nobody the ranking below would compete over has a history to
        # rank by, so its own tie-break (input order) is the only thing that
        # would separate them -- surfacing that as a "should rest" verdict
        # dresses up sort stability as a fairness read it never was. A pin
        # still claims its seat, exactly like the ranking branch would.
        return [
            RotationRecommendation(
                member_id=h.member_id,
                status=RotationStatus.MUST_PLAY if h.pinned_must_play else RotationStatus.NEUTRAL,
                reason=(
                    "Закреплён хостом (must_play)"
                    if h.pinned_must_play
                    else "Ещё нет истории карт — нечего ранжировать"
                ),
                consecutive_sat=_streak_from_end(h.played, value=False),
                consecutive_played=_streak_from_end(h.played, value=True),
                games_played=sum(h.played),
            )
            for h in histories
        ]

    ranked_indices = sorted(
        (index for index, h in enumerate(histories) if not h.pinned_must_play),
        key=lambda index: (
            -_streak_from_end(histories[index].played, value=False),
            _streak_from_end(histories[index].played, value=True),
            sum(histories[index].played),
            index,
        ),
    )
    pinned_count = sum(1 for h in histories if h.pinned_must_play)
    seats_left = max(0, usable_count - pinned_count)
    playing_ids = {histories[i].member_id for i in ranked_indices[:seats_left]}
    playing_ids.update(h.member_id for h in histories if h.pinned_must_play)

    recommendations = []
    for h in histories:
        sat = _streak_from_end(h.played, value=False)
        played_streak = _streak_from_end(h.played, value=True)
        total_played = sum(h.played)
        if h.member_id in playing_ids:
            if h.pinned_must_play:
                status, reason = RotationStatus.MUST_PLAY, "Закреплён хостом (must_play)"
            elif sat > 0:
                status, reason = RotationStatus.MUST_PLAY, f"Сидел {sat} карт(ы) подряд — очередь играть"
            else:
                status, reason = RotationStatus.NEUTRAL, "Играет по умолчанию"
        elif played_streak > 0:
            status, reason = RotationStatus.SHOULD_REST, f"Сыграл {played_streak} карт(ы) подряд"
        else:
            status, reason = RotationStatus.SHOULD_REST, f"Сыграл {total_played} карт — пора уступить место"
        recommendations.append(
            RotationRecommendation(
                member_id=h.member_id,
                status=status,
                reason=reason,
                consecutive_sat=sat,
                consecutive_played=played_streak,
                games_played=total_played,
            )
        )
    return recommendations
