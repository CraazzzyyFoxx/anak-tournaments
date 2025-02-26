import typing
from collections import defaultdict

import numpy as np
import pandas as pd
import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession
from openskill.models import PlackettLuce, PlackettLuceRating
from trueskillthroughtime import History, Player as TTTPlayer, Gaussian

from src import models
from src.schemas.analytics import AnalyticsMatch
from src.services.team import service as team_service
from src.services.tournament import service as tournament_service
from src.services.encounter import service as encounter_service

from . import service
from ...core.logging import logger

COEF_NOVICE_FIRST = 1 / 0.15
COEF_NOVICE_SECOND = 1 / 0.11
COEF_REGULAR = 1 / 0.065
mu = 1100


async def get_data_frame(session: AsyncSession, tournament_id: int) -> pd.DataFrame:
    data = await service.get_analytics(session)
    df = pd.DataFrame(
        [
            {
                "tournament_id": row[2],
                "team_id": row[0],
                "player_name": row[1].name,
                "player_id": row[1].id,
                "user_id": row[1].user_id,
                "id_role": f"{row[1].user_id}-{row[1].role}",
                "cost": row[1].rank,
                "div": row[1].div,
                "wins": row[3],
                "losses": row[4],
                "previous_cost": row[5],
                "pre-previous_cost": row[6],
                "shift": 0,
            }
            for row in data
        ]
    )

    df["is_changed"] = df["previous_cost"] != df["cost"]
    return df


async def get_analytics(session: AsyncSession, tournament_id: int):
    df = await get_data_frame(session, tournament_id)

    for id_role in df["id_role"].unique():
        rows = df[df["id_role"] == id_role]
        is_novice = True
        for index, row in rows.iterrows():
            if is_novice:
                if row["is_changed"]:
                    df.at[index, "shift"] = (
                        row["wins"] - row["losses"]
                    ) / COEF_NOVICE_FIRST
                    is_novice = False
                else:
                    df.at[index, "shift"] = (
                        row["wins"] - row["losses"]
                    ) / COEF_NOVICE_SECOND
            else:
                df.at[index, "shift"] = (row["wins"] - row["losses"]) / COEF_REGULAR
                if row["is_changed"]:
                    df.at[index, "shift"] += (
                        row["wins"] - row["losses"]
                    ) / COEF_REGULAR
                else:
                    df.at[index, "shift"] += df.at[
                        rows.index[rows.index.get_loc(index) - 1], "shift"
                    ]

    final_df = df[df["tournament_id"] == tournament_id]
    final_df = final_df.replace({np.nan: None})

    await session.execute(
        sa.delete(models.TournamentAnalytics).where(
            sa.and_(
                models.TournamentAnalytics.tournament_id == tournament_id,
                models.TournamentAnalytics.algorithm == "points",
            )
        )
    )
    await session.commit()

    for _, row in final_df.iterrows():
        analytics_item = models.TournamentAnalytics(
            algorithm="points",
            tournament_id=row["tournament_id"],
            team_id=row["team_id"],
            player_id=row["player_id"],
            wins=row["wins"],
            losses=row["losses"],
            shift_one=row["cost"] - row["previous_cost"]
            if row["previous_cost"]
            else None,
            shift_two=row["previous_cost"] - row["pre-previous_cost"]
            if row["pre-previous_cost"]
            else None,
            shift=0,
            calculated_shift=round(row["shift"], 2),
        )
        session.add(analytics_item)
    await session.commit()


def get_plackett_luce():
    return PlackettLuce(mu=mu, sigma=mu / 5.75, beta=mu / 2.75, tau=mu / 300.0, balance=True)

def get_id_role(player: models.Player) -> str:
    return f"{player.user_id}-{player.role}"


def get_player_rating(pl: PlackettLuce, player: models.Player) -> PlackettLuceRating:
    if player.is_newcomer:
        return pl.rating(mu=player.rank, sigma=mu / 5.25)
    if player.is_newcomer_role:
        return pl.rating(mu=player.rank, sigma=mu / 5.5)
    return pl.rating(mu=player.rank)


def prepare_openskill_data(
    pl: PlackettLuce,
    teams: typing.Sequence[models.Team],
    matches: typing.Sequence[models.Encounter],
) -> tuple[set[str], dict[str, PlackettLuceRating], list[AnalyticsMatch]]:
    agents: set[str] = set()
    players_rating: dict[str, PlackettLuceRating] = {}
    ttt_matches: list[AnalyticsMatch] = []

    for team in teams:
        for player in team.players:
            id_role = get_id_role(player)
            if id_role not in players_rating:
                players_rating[id_role] = get_player_rating(pl, player)

    for match in matches:
        home_team = list(map(lambda p: get_id_role(p), match.home_team.players))
        away_team = list(map(lambda p: get_id_role(p), match.away_team.players))
        for player in match.home_team.players:
            id_role = get_id_role(player)
            if id_role not in players_rating:
                players_rating[id_role] = get_player_rating(pl, player)
        for player in match.away_team.players:
            id_role = get_id_role(player)
            if id_role not in players_rating:
                players_rating[id_role] = get_player_rating(pl, player)

        agents = agents.union(set(home_team))
        agents = agents.union(set(away_team))

        ttt_matches.append(AnalyticsMatch(
            tournament_id=match.tournament_id,
            home_team_id=match.home_team_id,
            home_team_name=match.home_team.name,
            away_team_id=match.away_team_id,
            away_team_name=match.away_team.name,
            home_players=home_team,
            away_players=away_team,
            home_score=match.home_score,
            away_score=match.away_score,
            time=match.tournament.start_date,
        ))

    for match in ttt_matches:
        home_team = [players_rating[i] for i in match.home_players]
        away_team = [players_rating[i] for i in match.away_players]
        rating_game = [home_team, away_team]
        scores = [match.home_score, match.away_score]

        rated_home_team, rated_away_team = pl.rate(rating_game, scores=scores)
        for id_role in range(len(match.home_players)):
            players_rating[match.home_players[id_role]] = rated_home_team[id_role]
        for id_role in range(len(match.away_players)):
            players_rating[match.away_players[id_role]] = rated_away_team[id_role]


    return agents, players_rating, ttt_matches


def rank_to_div(cost: int | float) -> float:
    div = 20 - cost / 100 + 1
    div = max(div, 1)
    return div


async def get_analytics_openskill(session: AsyncSession, tournament_id: int) -> None:
    matches = await service.get_matches(session, tournament_id-10, tournament_id)
    teams = await team_service.get_by_tournament(session, tournament_id, ["players", "players.user"])
    df = await get_data_frame(session, tournament_id)

    final_df = df[df["tournament_id"] == tournament_id]
    final_df = final_df.replace({np.nan: None})
    pl = get_plackett_luce()
    agents, players_rating, ttt_matches = prepare_openskill_data(pl, teams, matches)

    await session.execute(
        sa.delete(models.TournamentAnalytics).where(
            sa.and_(
                models.TournamentAnalytics.tournament_id == tournament_id,
                models.TournamentAnalytics.algorithm == "openskill"
            )
        )
    )
    await session.commit()

    for _, row in final_df.iterrows():
        analytics_item = models.TournamentAnalytics(
            algorithm="openskill",
            tournament_id=row["tournament_id"],
            team_id=row["team_id"],
            player_id=row["player_id"],
            wins=row["wins"],
            losses=row["losses"],
            shift_one=row["cost"] - row["previous_cost"]
            if row["previous_cost"]
            else None,
            shift_two=row["previous_cost"] - row["pre-previous_cost"]
            if row["pre-previous_cost"]
            else None,
            shift=0,
            calculated_shift=round(row["div"] - rank_to_div(players_rating[row["id_role"]].mu), 2),
        )
        session.add(analytics_item)
    await session.commit()


async def get_predictions_openskill(session: AsyncSession, tournament_id: int) -> None:
    matches = await service.get_matches(session, tournament_id - 10, tournament_id-1)
    teams = await team_service.get_by_tournament(session, tournament_id, ["players", "players.user"])
    pl = get_plackett_luce()
    agents, players_rating, ttt_matches = prepare_openskill_data(pl, teams, matches)
    predicted_teams: list[tuple[str, list[PlackettLuceRating]]] = []

    for team in teams:
        team_players = []
        for player in team.players:
            team_players.append(players_rating[get_id_role(player)])
        predicted_teams.append((team.name, team_players))

    predicted = pl.predict_rank([team[1] for team in predicted_teams])
    for team_name, predict in zip(predicted_teams, predicted):
        team: models.Team | None = None

        for t in teams:
            if t.name == team_name:
                team = t
                break

        session.add(
            models.TournamentPrediction(
                algorithm="openskill",
                tournament_id=tournament_id,
                team_id=team.id,
                predicted_place=predict[0]
            )
        )

    await session.commit()


# async def get_analytics_ttt(session: AsyncSession, tournament_id: int) -> None:
#     matches = await service.get_matches(session, tournament_id)
#     df = await get_data_frame(session, tournament_id)
#
#     final_df = df[df["tournament_id"] == tournament_id]
#     final_df = final_df.replace({np.nan: None})
#
#     agents: set[str] = set()
#     players_rating: dict[str, TTTPlayer] = {}
#     ttt_matches: list[AnalyticsMatch] = []
#
#     for match in matches:
#         home_team = list(map(lambda p: f"{p.user_id}-{p.role}", match.home_team.players))
#         away_team = list(map(lambda p: f"{p.user_id}-{p.role}", match.away_team.players))
#         for player in match.home_team.players:
#             if f"{player.user_id}-{player.role}" not in players_rating:
#                 players_rating[f"{player.user_id}-{player.role}"] = TTTPlayer(Gaussian(player.rank / 100, 3.0))
#         for player in match.away_team.players:
#             if f"{player.user_id}-{player.role}" not in players_rating:
#                 players_rating[f"{player.user_id}-{player.role}"] = TTTPlayer(Gaussian(player.rank / 100, 3.0))
#
#         agents = agents.union(set(home_team))
#         agents = agents.union(set(away_team))
#         ttt_matches.append(AnalyticsMatch(
#             tournament_id=match.tournament_id,
#             home_team_id=match.home_team_id,
#             home_team_name=match.home_team.name,
#             away_team_id=match.away_team_id,
#             away_team_name=match.away_team.name,
#             home_players=home_team,
#             away_players=away_team,
#             home_score=match.home_score,
#             away_score=match.away_score,
#             time=match.tournament.start_date
#         ))
#
#     teams = await team_service.get_by_tournament(session, tournament_id, ["players", "players.user"])
#     h = History(
#         [[match.home_players, match.away_players] for match in ttt_matches],
#         results=[[match.home_score, match.away_score] for match in ttt_matches],
#         # times=[match.time.timestamp() for match in ttt_matches],
#         priors=players_rating,
#         gamma=0.0,
#         p_draw=0.3
#     )
#     h.convergence()
#     lc = h.learning_curves()
#
#     predicted_ranks: dict[str, float] = {
#         p: r[-1][0] for p, r in lc.items()
#     }
#
#     for team in teams:
#         for player in team.players:
#             if f"{player.user_id}-{player.role}" not in players_rating:
#                 players_rating[f"{player.user_id}-{player.role}"] = TTTPlayer(Gaussian(player.rank / 100, 3.0))
#
#     await session.execute(
#         sa.delete(models.TournamentAnalytics).where(
#             sa.and_(
#                 models.TournamentAnalytics.tournament_id == tournament_id,
#                 models.TournamentAnalytics.algorithm == "ttt"
#             )
#         )
#     )
#     await session.commit()
#
#     for _, row in final_df.iterrows():
#         analytics_item = models.TournamentAnalytics(
#             algorithm="ttt",
#             tournament_id=row["tournament_id"],
#             team_id=row["team_id"],
#             player_id=row["player_id"],
#             wins=row["wins"],
#             losses=row["losses"],
#             shift_one=row["cost"] - row["previous_cost"]
#             if row["previous_cost"]
#             else None,
#             shift_two=row["previous_cost"] - row["pre-previous_cost"]
#             if row["pre-previous_cost"]
#             else None,
#             shift=0,
#             calculated_shift=round(predicted_ranks[row["id_role"]], 2),
#         )
#         session.add(analytics_item)
#     await session.commit()
