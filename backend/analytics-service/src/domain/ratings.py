"""Points / Linear / OpenSkill rating math. No session."""

from __future__ import annotations

import typing
from dataclasses import dataclass
from datetime import datetime

import pandas as pd
from openskill.models import PlackettLuce, PlackettLuceRating

from src.domain.linear import STABLE_SHIFT_SCALE, TournamentSignal, score_history

__all__ = (
    "AnalyticsMatch",
    "COEF_NOVICE_FIRST",
    "COEF_NOVICE_SECOND",
    "COEF_REGULAR",
    "LINEAR",
    "OPEN_SKILL",
    "OPENSKILL_LOOKBACK",
    "POINTS",
    "compute_linear_metrics",
    "compute_points_shifts",
    "division_delta_points",
    "get_id_role",
    "get_linear_hybrid_shift_lookup",
    "get_plackett_luce",
    "get_player_rating",
    "prepare_openskill_data",
)

COEF_NOVICE_FIRST = 1 / 0.15
COEF_NOVICE_SECOND = 1 / 0.11
COEF_REGULAR = 1 / 0.065
OPENSKILL_LOOKBACK = 10
LINEAR = "Linear"
POINTS = "Points"
OPEN_SKILL = "Open Skill"
_MU = 1100


@dataclass(frozen=True)
class AnalyticsMatch:
    tournament_id: int
    home_team_id: int
    home_team_name: str
    away_team_id: int
    away_team_name: str
    home_players: list[str]
    away_players: list[str]
    home_score: int
    away_score: int
    time: datetime


def division_delta_points(
    previous_div: int | float | None,
    current_div: int | float | None,
) -> int | None:
    if previous_div is None or pd.isna(previous_div):
        return None
    if current_div is None or pd.isna(current_div):
        return None
    return int(round((float(previous_div) - float(current_div)) * 100))


def compute_points_shifts(df: pd.DataFrame) -> pd.Series:
    output = pd.Series(0.0, index=df.index, dtype=float)
    for id_role, rows in df.groupby("id_role", sort=False):
        del id_role
        rows = rows.sort_values("tournament_id")
        is_novice = True
        previous_shift = 0.0
        for index, row in rows.iterrows():
            delta = row["wins"] - row["losses"]
            if is_novice:
                if row["is_changed"]:
                    shift = delta / COEF_NOVICE_FIRST
                    is_novice = False
                else:
                    shift = delta / COEF_NOVICE_SECOND
            else:
                shift = delta / COEF_REGULAR
                if row["is_changed"]:
                    shift += delta / COEF_REGULAR
                else:
                    shift += previous_shift
            previous_shift = shift
            output.at[index] = round(float(shift), 2)
    return output


def compute_linear_metrics(df: pd.DataFrame, *, shift_scale: float = STABLE_SHIFT_SCALE) -> pd.DataFrame:
    if df.empty:
        return df

    for _, group in df.groupby("id_role", sort=False):
        group = group.sort_values("tournament_id")
        group_rows = group.to_dict("records")
        for position, (index, row) in enumerate(zip(group.index, group_rows, strict=True)):
            del row
            signals: list[TournamentSignal] = []
            for history_position in range(position + 1):
                history = group_rows[history_position]
                signals.append(
                    TournamentSignal(
                        map_diff=float(history["map_diff"]),
                        placement_score=float(history["placement_score"]),
                        recency_decay=float(0.85 ** (position - history_position)),
                        coverage_weight=float(0.7 + 0.3 * history["log_available"]),
                        newcomer_weight=0.75 if history["is_newcomer"] or history["is_newcomer_role"] else 1.0,
                        match_count=int(history["match_count"] or 0),
                        log_available=float(history["log_available"]),
                    )
                )

            metrics = score_history(signals, shift_scale=shift_scale)
            df.at[index, "confidence"] = metrics.confidence
            df.at[index, "effective_evidence"] = metrics.effective_evidence
            df.at[index, "sample_tournaments"] = metrics.sample_tournaments
            df.at[index, "sample_matches"] = metrics.sample_matches
            df.at[index, "log_coverage"] = metrics.log_coverage
            df.at[index, "linear_stable_shift"] = metrics.stable_shift
            df.at[index, "linear_trend_shift"] = metrics.trend_shift

    return df


def get_plackett_luce() -> PlackettLuce:
    return PlackettLuce(mu=_MU, sigma=_MU / 6, beta=_MU / 2.75, tau=_MU / 300.0, balance=True)


def get_id_role(player: typing.Any) -> str:
    """``user_id-role`` key. Callers must eager-load ``Player.workspace_member``."""
    return f"{player.workspace_member.player_id}-{player.role}"


def get_player_rating(pl: PlackettLuce, player: typing.Any) -> PlackettLuceRating:
    if player.is_newcomer or player.is_newcomer_role:
        return pl.rating(mu=player.rank, sigma=_MU / 4.25)
    return pl.rating(mu=player.rank)


def prepare_openskill_data(
    df: pd.DataFrame,
    pl: PlackettLuce,
    teams: typing.Sequence[typing.Any],
    encounters: typing.Sequence[typing.Any],
) -> tuple[set[str], dict[str, PlackettLuceRating], list[AnalyticsMatch]]:
    del df  # replay is seeded from rosters + encounters, not the frame
    agents: set[str] = set()
    players_rating: dict[str, PlackettLuceRating] = {}
    analytics_matches: list[AnalyticsMatch] = []

    for encounter in encounters:
        if encounter.home_team is None or encounter.away_team is None:
            continue

        home_players = list(encounter.home_team.players or ())
        away_players = list(encounter.away_team.players or ())
        if not home_players or not away_players:
            continue

        home_team = [get_id_role(player) for player in home_players]
        away_team = [get_id_role(player) for player in away_players]

        for player in [*home_players, *away_players]:
            id_role = get_id_role(player)
            if players_rating.get(id_role) is None:
                players_rating[id_role] = get_player_rating(pl, player)

        agents = agents.union(set(home_team))
        agents = agents.union(set(away_team))

        analytics_matches.append(
            AnalyticsMatch(
                tournament_id=encounter.tournament_id,
                home_team_id=encounter.home_team_id,
                home_team_name=encounter.home_team.name,
                away_team_id=encounter.away_team_id,
                away_team_name=encounter.away_team.name,
                home_players=home_team,
                away_players=away_team,
                home_score=encounter.home_score,
                away_score=encounter.away_score,
                time=encounter.tournament.start_date,
            )
        )

    for team in teams:
        for player in team.players:
            id_role = get_id_role(player)
            if id_role not in players_rating:
                players_rating[id_role] = get_player_rating(pl, player)

    for match in analytics_matches:
        home_side = [players_rating[i] for i in match.home_players]
        away_side = [players_rating[i] for i in match.away_players]
        rated_home, rated_away = pl.rate(
            [home_side, away_side],
            scores=[match.home_score, match.away_score],
        )
        for player_index in range(len(match.home_players)):
            players_rating[match.home_players[player_index]] = rated_home[player_index]
        for player_index in range(len(match.away_players)):
            players_rating[match.away_players[player_index]] = rated_away[player_index]

    return agents, players_rating, analytics_matches


def get_linear_hybrid_shift_lookup(
    current_df: pd.DataFrame,
    openskill_shift_map: dict[int, float],
    has_match_history: bool,
) -> dict[int, float]:
    output: dict[int, float] = {}
    for _, row in current_df.iterrows():
        player_id = int(row["player_id"])
        stable_shift = float(row["linear_stable_shift"])
        if not has_match_history:
            output[player_id] = round(stable_shift, 2)
            continue

        openskill_shift = openskill_shift_map.get(player_id)
        if openskill_shift is None:
            output[player_id] = round(stable_shift, 2)
            continue

        alpha_eff = 0.35 * min(1.0, int(row["sample_matches"]) / 12.0)
        output[player_id] = round((1.0 - alpha_eff) * stable_shift + alpha_eff * openskill_shift, 2)
    return output
