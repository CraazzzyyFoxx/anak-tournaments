"""Who is actually seated in a lobby right now.

Membership in a lobby is not stored: it is the seats of that lobby's selected
balance option. One pure function answers it for every caller -- the balance
candidate filter, the pager's conflict check, the busy rows a recorded match
freezes, the ``current_lobby`` badge on the board, and the voice mover.
:func:`with_captains` gives each team of a stored lineup its captain.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from src.domain.balancer.result_serializer import as_lobby_document, seat_rating

__all__ = ("seated_member_ids", "seated_teams", "with_captains")


def seated_teams(balance_result_json: Mapping[str, Any] | None, variant_index: int) -> tuple[tuple[int, ...], ...]:
    """Member ids per team of ``variant_index``, team 1 first; ``()`` when nobody is seated.

    Same reading rules as :func:`seated_member_ids`, which is the union of these.
    """
    document = as_lobby_document(balance_result_json)
    variants = document.get("variants") if isinstance(document, Mapping) else None
    if not isinstance(variants, list) or not (0 <= variant_index < len(variants)):
        return ()
    variant = variants[variant_index]
    teams = variant.get("teams") if isinstance(variant, Mapping) else None
    if not isinstance(teams, list):
        return ()
    out: list[tuple[int, ...]] = []
    for team in teams:
        roster = team.get("roster") if isinstance(team, Mapping) else None
        seats: list[int] = []
        for bucket in roster.values() if isinstance(roster, Mapping) else ():
            for uuid in bucket if isinstance(bucket, list) else ():
                try:
                    seats.append(int(uuid))
                except (TypeError, ValueError):
                    continue
        out.append(tuple(seats))
    return tuple(out)


def seated_member_ids(balance_result_json: Mapping[str, Any] | None, variant_index: int) -> frozenset[int]:
    """Workspace member ids seated in ``variant_index`` of one lobby's document.

    Empty for a lobby that was never balanced and for an index past the stored
    options: both mean "nobody is playing this lobby", which is what every
    caller wants to hear. A seat uuid IS the member id -- the same mapping
    ``record_outcome`` freezes into the round's seats -- and a uuid that is not
    one is skipped rather than failing the read.
    """
    return frozenset(member for team in seated_teams(balance_result_json, variant_index) for member in team)


def _member_id(uuid: Any) -> int | None:
    try:
        return int(uuid)
    except (TypeError, ValueError):
        return None


def _member_seats(team: Mapping[str, Any]) -> list[tuple[str, int]]:
    """``(role bucket, member id)`` of every seat of one team; a uuid that is not a member id is skipped."""
    roster = team.get("roster")
    seats: list[tuple[str, int]] = []
    for bucket, entries in roster.items() if isinstance(roster, Mapping) else ():
        for uuid in entries if isinstance(entries, list) else ():
            member = _member_id(uuid)
            if member is not None:
                seats.append((str(bucket), member))
    return seats


def with_captains(document: dict[str, Any] | None) -> dict[str, Any] | None:
    """Give every team of every option of a lobby document its ``captain_member_id``, in place (spec §7.2).

    A team keeps a captain who still sits in it, so a host's "Make captain" sticks. Any other team -- just balanced,
    stored before captains existed, or whose captain left it -- is captained by its strongest seat at the rating the
    solver seated it at (``seat_rating``), the lower member id on a tie. A team with no member seat has none.
    """
    if not isinstance(document, dict):
        return document
    players = document.get("players")
    players = players if isinstance(players, Mapping) else {}
    for variant in document.get("variants") or ():
        for team in (variant.get("teams") if isinstance(variant, dict) else None) or ():
            if not isinstance(team, dict):
                continue
            seats = _member_seats(team)
            if team.get("captain_member_id") in {member for _bucket, member in seats}:
                continue
            ranked = [(-seat_rating(players.get(str(member)) or {}, bucket), member) for bucket, member in seats]
            team["captain_member_id"] = min(ranked)[1] if ranked else None
    return document
