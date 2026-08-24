"""Pre-encounter OpenSkill snapshot helpers.

The ML win-probability classifier and the per-match Performance target
both need an estimate of *each team's strength as it was before the
encounter was played* — using the post-encounter rating would leak the
outcome.

The current OpenSkill replay in
:mod:`src.services.analytics.flows.compute_openskill_shift_map` produces
post-replay ratings. The helpers in this module run the same replay but
freeze the rating snapshot *before* applying each encounter, yielding a
``(encounter_id, team_id) → mu`` map that can be merged into feature frames.
"""

from __future__ import annotations

import typing

import pandas as pd
from openskill.models import PlackettLuce, PlackettLuceRating
from sqlalchemy.ext.asyncio import AsyncSession

from src.domain.ratings import get_id_role, get_plackett_luce, prepare_openskill_data
from src.services.analytics.flows import flows_service
from src.services.analytics.service import analytics_service

from .cache import get_or_build_dataframe, scope_cache_params

__all__ = ("snapshot_pre_encounter_team_mu", "snapshot_pre_tournament_team_mu")


async def snapshot_pre_encounter_team_mu(
    session: AsyncSession,
    tournament_id: int,
    *,
    workspace_id: int | None = None,
    workspace_ids: typing.Sequence[int] | None = None,
    look_back: int = 10,
) -> pd.DataFrame:
    params = {
        "tournament_id": int(tournament_id),
        "look_back": int(look_back),
        **scope_cache_params(workspace_id=workspace_id, workspace_ids=workspace_ids),
    }

    async def _build() -> pd.DataFrame:
        return await _snapshot_pre_encounter_team_mu_uncached(
            session,
            tournament_id,
            workspace_id=workspace_id,
            workspace_ids=workspace_ids,
            look_back=look_back,
        )

    return await get_or_build_dataframe("opponent_strength_snapshot", params, _build)


async def _snapshot_pre_encounter_team_mu_uncached(
    session: AsyncSession,
    tournament_id: int,
    *,
    workspace_id: int | None = None,
    workspace_ids: typing.Sequence[int] | None = None,
    look_back: int = 10,
) -> pd.DataFrame:
    """Return a DataFrame with one row per ``(encounter_id, team_id)`` holding
    the team-average OpenSkill ``mu`` evaluated *just before* the encounter was
    played.

    Algorithm:

    1. Build the analytics DataFrame for the ``look_back`` most recent tournaments
       up to and including ``tournament_id`` (chronological window, same range as
       the v1 OpenSkill flow).
    2. Initialise per-player ratings via :func:`prepare_openskill_data`.
    3. Replay every match in chronological order; **before** each encounter, snapshot
       the team-average mu of its home and away rosters.

    Output columns: ``encounter_id``, ``team_id``, ``avg_mu``, ``max_mu``,
    ``min_mu``, ``std_mu`` (NaN-safe).
    """
    # ``get_data_frame`` loads every analytics-eligible tournament row in one
    # query — there is no range parameter; ``look_back`` is applied via the
    # chronological window resolved by ``lookback_start_tournament_id`` below.
    df = await flows_service.get_data_frame(
        session,
        workspace_id=workspace_id,
        workspace_ids=workspace_ids,
    )
    if df.empty:
        return pd.DataFrame(columns=["encounter_id", "team_id", "avg_mu", "max_mu", "min_mu", "std_mu"])

    window_ids = await analytics_service.lookback_tournament_ids(
        session,
        tournament_id,
        look_back,
        workspace_id=workspace_id,
        workspace_ids=workspace_ids,
    )
    matches = await analytics_service.get_matches_for_tournaments(
        session,
        window_ids,
        workspace_id=workspace_id,
        workspace_ids=workspace_ids,
    )
    teams = await analytics_service.get_teams_with_players(session, tournament_id)

    pl: PlackettLuce = get_plackett_luce()
    _, players_rating, _ = prepare_openskill_data(df, pl, teams, matches)

    # Players keyed by (user_id, role).
    rating_map: dict[str, PlackettLuceRating] = dict(players_rating)

    # Group matches by encounter so we snapshot pre-encounter (not pre-match).
    snapshots: list[dict[str, typing.Any]] = []
    seen_encounters: set[int] = set()

    # NOTE: ``get_matches_for_tournaments`` returns ``Sequence[models.Encounter]``
    # (the method name is historical — the analytics flow conflates the two).
    # Each row's own id is ``Encounter.id``; there is no ``encounter_id``
    # attribute on the ORM object itself.
    for encounter in matches:
        if encounter.id in seen_encounters:
            # Already snapshotted before the first match of this encounter.
            continue
        seen_encounters.add(encounter.id)

        # A team cannot meaningfully play itself. Such placeholder/self rows
        # (home_team_id == away_team_id) would snapshot the same
        # (encounter_id, team_id) twice — fanning out the downstream standings
        # merge — and feed a bogus self-vs-self OpenSkill update. Skip them.
        if encounter.home_team_id == encounter.away_team_id:
            continue

        for team in (encounter.home_team, encounter.away_team):
            if team is None or not getattr(team, "players", None):
                continue
            mus: list[float] = []
            for player in team.players:
                key = get_id_role(player)
                rating = rating_map.get(key)
                if rating is None:
                    continue
                mus.append(float(rating.mu))
            if not mus:
                continue
            snapshots.append(
                {
                    "encounter_id": int(encounter.id),
                    "team_id": int(team.id),
                    "avg_mu": float(sum(mus) / len(mus)),
                    "max_mu": float(max(mus)),
                    "min_mu": float(min(mus)),
                    "std_mu": float(pd.Series(mus).std(ddof=0)) if len(mus) > 1 else 0.0,
                }
            )

        # Update ratings *after* snapshotting, replicating the v1 replay order.
        home_team_players = [
            rating_map[get_id_role(p)]
            for p in (encounter.home_team.players if encounter.home_team else [])
            if get_id_role(p) in rating_map
        ]
        away_team_players = [
            rating_map[get_id_role(p)]
            for p in (encounter.away_team.players if encounter.away_team else [])
            if get_id_role(p) in rating_map
        ]
        if not home_team_players or not away_team_players:
            continue

        home_score = getattr(encounter, "home_score", 0) or 0
        away_score = getattr(encounter, "away_score", 0) or 0
        ranks = [0, 1] if home_score > away_score else [1, 0] if home_score < away_score else [0, 0]
        new_home, new_away = pl.rate([home_team_players, away_team_players], ranks=ranks)
        for player, new_rating in zip(
            (p for p in encounter.home_team.players),
            new_home,
            strict=False,
        ):
            rating_map[get_id_role(player)] = new_rating
        for player, new_rating in zip(
            (p for p in encounter.away_team.players),
            new_away,
            strict=False,
        ):
            rating_map[get_id_role(player)] = new_rating

    if not snapshots:
        return pd.DataFrame(columns=["encounter_id", "team_id", "avg_mu", "max_mu", "min_mu", "std_mu"])
    # Enforce the documented one-row-per-(encounter_id, team_id) contract as a
    # defensive backstop against any future fan-out source.
    return (
        pd.DataFrame(snapshots).drop_duplicates(subset=["encounter_id", "team_id"], keep="first").reset_index(drop=True)
    )


async def snapshot_pre_tournament_team_mu(
    session: AsyncSession,
    tournament_id: int,
    *,
    workspace_id: int | None = None,
    workspace_ids: typing.Sequence[int] | None = None,
    look_back: int = 10,
) -> pd.DataFrame:
    """Return one row per team of ``tournament_id`` with the team-average
    OpenSkill ``mu`` as it stands *before the tournament starts*.

    Sibling of :func:`snapshot_pre_encounter_team_mu` for the pre-tournament
    case, where there is no encounter to anchor a snapshot to. The replay covers
    the ``look_back`` window up to but **excluding** ``tournament_id`` itself, so
    nothing that happens inside the tournament being forecast leaks into its own
    strength estimate. Rosters with no rated history still get a rating:
    :func:`prepare_openskill_data` seeds every team player from their
    registration rank.

    Output columns: ``team_id``, ``avg_mu``, ``max_mu``, ``min_mu``, ``std_mu``
    plus per-role means ``tank_mu`` / ``damage_mu`` / ``support_mu`` (NaN when
    the roster has no rated player on that role) — the roster average hides a
    weak tank behind strong supports, and role gaps are how a balanced-looking
    team actually loses.

    Deliberately uncached, unlike its per-encounter sibling: this frame exists
    for tournaments whose rosters are still being assembled, where a TTL'd
    snapshot would forecast a field that no longer exists.
    """
    columns = ["team_id", "avg_mu", "max_mu", "min_mu", "std_mu", "tank_mu", "damage_mu", "support_mu"]
    teams = await analytics_service.get_teams_with_players(session, tournament_id)
    if not teams:
        return pd.DataFrame(columns=columns)

    window_ids = await analytics_service.lookback_tournament_ids(
        session,
        tournament_id,
        look_back,
        workspace_id=workspace_id,
        workspace_ids=workspace_ids,
    )
    history = [
        encounter
        for encounter in await analytics_service.get_matches_for_tournaments(
            session,
            window_ids,
            workspace_id=workspace_id,
            workspace_ids=workspace_ids,
        )
        if encounter.tournament_id != tournament_id
    ]

    pl: PlackettLuce = get_plackett_luce()
    # ``prepare_openskill_data`` ignores its ``df`` argument entirely; it needs
    # only the replay encounters plus the rosters to seed unrated players.
    _, players_rating, _ = prepare_openskill_data(pd.DataFrame(), pl, teams, history)

    rows: list[dict[str, typing.Any]] = []
    for team in teams:
        mus: list[float] = []
        role_mus: dict[str, list[float]] = {"tank": [], "damage": [], "support": []}
        for player in team.players:
            rating = players_rating.get(get_id_role(player))
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
    return pd.DataFrame(rows, columns=columns)
