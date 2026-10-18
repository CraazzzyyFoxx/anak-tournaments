"""Per-role team strength columns from a prepared OpenSkill rating map.

The service loads history and rosters, seeds the ratings and replays encounters; this module owns the Overwatch role-axis
aggregation of one tournament's rosters into ``team_id/avg_mu/max_mu/min_mu/std_mu/tank_mu/damage_mu/support_mu``.
"""

from __future__ import annotations

import typing
from collections.abc import Callable, Mapping, Sequence

import pandas as pd

from .role_kpis import ROLES

if typing.TYPE_CHECKING:
    from openskill.models import PlackettLuceRating

    from shared.models import Player, Team

__all__ = ("summarize_team_strength",)

_COLUMNS = ["team_id", "avg_mu", "max_mu", "min_mu", "std_mu", *(f"{role}_mu" for role in ROLES)]


def summarize_team_strength(
    teams: Sequence[Team],
    ratings: Mapping[str, PlackettLuceRating],
    *,
    rating_key: Callable[[Player], str],
) -> pd.DataFrame:
    """One row per team with the roster's mu summary and per-role mean mu.

    ``rating_key`` maps a player to its key in ``ratings``; players without a rating are skipped and teams with no rated
    player emit no row. A role the roster has no rated player on is NaN; the standard deviation is the population one
    (``ddof=0``) and the roster is weighted by player, not by role.
    """
    rows: list[dict[str, typing.Any]] = []
    for team in teams:
        mus: list[float] = []
        role_mus: dict[str, list[float]] = {role: [] for role in ROLES}
        for player in team.players:
            rating = ratings.get(rating_key(player))
            if rating is None:
                continue
            value = float(rating.mu)
            mus.append(value)
            if player.role in role_mus:
                role_mus[player.role].append(value)
        if not mus:
            continue
        rows.append(
            {
                "team_id": int(team.id),
                "avg_mu": float(sum(mus) / len(mus)),
                "max_mu": float(max(mus)),
                "min_mu": float(min(mus)),
                "std_mu": float(pd.Series(mus).std(ddof=0)) if len(mus) > 1 else 0.0,
                **{
                    f"{role}_mu": (float(sum(values) / len(values)) if values else float("nan"))
                    for role, values in role_mus.items()
                },
            }
        )
    return pd.DataFrame(rows, columns=_COLUMNS)
