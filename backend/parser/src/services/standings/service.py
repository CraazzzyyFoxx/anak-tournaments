import typing
from collections import defaultdict

import sqlalchemy as sa
from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.strategy_options import _AbstractLoad

from src import models, schemas
from src.services.encounter import service as encounter_service


def standing_entities(in_entities: list[str]) -> list[_AbstractLoad]:
    entities = []
    if "tournament" in in_entities:
        entities.append(sa.orm.joinedload(models.Standing.tournament))
    if "group" in in_entities:
        entities.append(sa.orm.joinedload(models.Standing.group))
    if "team" in in_entities:
        entities.append(sa.orm.joinedload(models.Standing.team))

    return entities


async def get_by_tournament(
    session: AsyncSession, tournament: models.Tournament, entities: list[str]
) -> typing.Sequence[models.Standing]:
    query = (
        sa.select(models.Standing)
        .options(*standing_entities(entities))
        .where(models.Standing.tournament_id == tournament.id)
    )
    result = await session.execute(query)
    standings = result.scalars().all()
    logger.debug(f"Retrieved {len(standings)} standings for tournament {tournament.id}")
    return standings


async def delete_by_tournament(session: AsyncSession, tournament_id: int) -> None:
    query = sa.delete(models.Standing).where(
        models.Standing.tournament_id == tournament_id
    )
    await session.execute(query)
    await session.commit()
    logger.info(f"Deleted standings for tournament {tournament_id}")


def calculate_median_buchholz_and_tb_for_teams_in_group(
    players_in: dict[int, schemas.StandingTeamData],
) -> list[schemas.StandingTeamDataWithBuchholzTB]:
    median_buchholz_scores: dict[int, float] = {}
    tb_scores: dict[int, int] = {}

    for player in players_in.values():
        opponent_scores = sorted(
            [players_in[opponent_id].points for opponent_id in player.opponents]
        )
        logger.debug(f"Player {player.id} raw opponent scores: {opponent_scores}")

        if len(opponent_scores) > 2:
            trimmed_scores = opponent_scores[1:-1]  # Remove the highest and lowest scores
            logger.debug(f"Player {player.id} trimmed scores: {trimmed_scores}")
        else:
            trimmed_scores = opponent_scores

        median_buchholz_scores[player.id] = sum(trimmed_scores)
        logger.debug(f"Player {player.id} median buchholz score: {median_buchholz_scores[player.id]}")

    # Calculate TB (number of match wins against tied opponents)
    points_to_players = {}
    for player in players_in.values():
        points_to_players.setdefault(player.points, []).append(player.id)

    for players_with_same_points in points_to_players.values():
        for player_id in players_with_same_points:
            tb = sum(
                1
                for opponent_id in players_in[player_id].opponents
                if players_in[opponent_id].points == players_in[player_id].points
                and players_in[player_id].wins > players_in[opponent_id].wins
            )
            tb_scores[player_id] = tb
            logger.debug(f"Player {player_id} TB score: {tb}")

    players: list[schemas.StandingTeamDataWithBuchholzTB] = []
    for player in players_in.values():
        players.append(
            schemas.StandingTeamDataWithBuchholzTB(
                id=player.id,
                wins=player.wins,
                draws=player.draws,
                loses=player.loses,
                points=player.points,
                opponents=player.opponents,
                buchholz=median_buchholz_scores[player.id],
                matches=player.matches,
                tb=tb_scores.get(player.id, 0),
            )
        )

    return players


def prepare_teams_for_groups(
    encounters: typing.Sequence[models.Encounter],
) -> list[schemas.StandingTeamDataWithBuchholzTB]:
    team_cache: dict[int, schemas.StandingTeamData] = {}
    for encounter in encounters:
        if encounter.home_team_id not in team_cache:
            team_cache[encounter.home_team_id] = schemas.StandingTeamData(
                id=encounter.home_team_id,
                wins=0,
                draws=0,
                loses=0,
                points=0,
                opponents=[],
                matches=0,
            )
        if encounter.away_team_id not in team_cache:
            team_cache[encounter.away_team_id] = schemas.StandingTeamData(
                id=encounter.away_team_id,
                wins=0,
                draws=0,
                loses=0,
                points=0,
                opponents=[],
                matches=0,
            )

        team_cache[encounter.home_team_id].matches += 1
        team_cache[encounter.away_team_id].matches += 1

        if encounter.home_score > encounter.away_score:
            team_cache[encounter.home_team_id].wins += 1
            team_cache[encounter.away_team_id].loses += 1
            team_cache[encounter.home_team_id].points += 1
        elif encounter.home_score < encounter.away_score:
            team_cache[encounter.away_team_id].wins += 1
            team_cache[encounter.home_team_id].loses += 1
            team_cache[encounter.away_team_id].points += 1
        else:
            team_cache[encounter.home_team_id].draws += 1
            team_cache[encounter.away_team_id].draws += 1
            team_cache[encounter.home_team_id].points += 0.5
            team_cache[encounter.away_team_id].points += 0.5

        team_cache[encounter.home_team_id].opponents.append(encounter.away_team_id)
        team_cache[encounter.away_team_id].opponents.append(encounter.home_team_id)

    logger.debug(f"Team cache after processing encounters: {team_cache}")

    teams = calculate_median_buchholz_and_tb_for_teams_in_group(team_cache)
    sorted_teams = sorted(teams, key=lambda x: (x.points, x.tb, x.buchholz), reverse=True)
    logger.info("Prepared teams for groups with sorted order based on points, TB, and Buchholz")
    return sorted_teams


def prepare_teams_for_playoffs_double_elimination(
    encounters: typing.Sequence[models.Encounter],
) -> list[schemas.StandingTeamDataWithRanking]:
    logger.info("Preparing teams for double elimination playoffs")
    participants = list(
        {match.home_team_id for match in encounters} | {match.away_team_id for match in encounters}
    )
    data: dict[int, dict[str, float | int]] = {
        participant: {"win": 0, "lose": 0, "placement": 0}
        for participant in participants
    }

    last_game = sorted(
        [e for e in encounters if e.round > 0], key=lambda x: x.round, reverse=True
    )[0]
    if last_game.home_score > last_game.away_score:
        data[last_game.home_team_id]["placement"] = 1
        data[last_game.away_team_id]["placement"] = 2
    else:
        data[last_game.away_team_id]["placement"] = 1
        data[last_game.home_team_id]["placement"] = 2

    for encounter in encounters:
        if encounter.home_score > encounter.away_score:
            data[encounter.home_team_id]["win"] += 1
            data[encounter.away_team_id]["lose"] += 1
        else:
            data[encounter.away_team_id]["win"] += 1
            data[encounter.home_team_id]["lose"] += 1

    under_games: dict[int, list[models.Encounter]] = {}
    global_placement: int = len(participants)

    for encounter in [e for e in encounters if e.round < 0]:
        under_games.setdefault(encounter.round, []).append(encounter)

    for matches in under_games.values():
        lossers: list[int] = []
        for match in matches:
            if match.home_score > match.away_score:
                lossers.append(match.away_team_id)
            else:
                lossers.append(match.home_team_id)

        global_placement -= len(lossers) - 1

        for loser in lossers:
            data[loser]["placement"] = global_placement

        global_placement -= 1

    output: list[schemas.StandingTeamDataWithRanking] = []
    for team_id, team_data in data.items():
        output.append(
            schemas.StandingTeamDataWithRanking(
                id=team_id,
                wins=team_data["win"],
                loses=team_data["lose"],
                draws=0,
                points=0,
                ranking=team_data["placement"],
                opponents=[],
                matches=team_data["win"] + team_data["lose"],
            )
        )
        logger.debug(f"Team {team_id} playoff stats: {team_data}")

    return output


def prepare_teams_for_playoffs_single_elimination(
    encounters: typing.Sequence[models.Encounter],
) -> list[schemas.StandingTeamDataWithRanking]:
    logger.info("Preparing teams for single elimination playoffs")
    participants = list(
        {m.home_team_id for m in encounters} | {m.away_team_id for m in encounters}
    )

    data: dict[int, dict[str, float | int]] = {
        participant: {"win": 0, "lose": 0, "placement": 0}
        for participant in participants
    }

    round_of_loss: dict[int, int | None] = {team: None for team in participants}

    for enc in encounters:
        if enc.home_score > enc.away_score:
            winner_id = enc.home_team_id
            loser_id = enc.away_team_id
        else:
            winner_id = enc.away_team_id
            loser_id = enc.home_team_id

        data[winner_id]["win"] += 1
        data[loser_id]["lose"] += 1

        if round_of_loss[loser_id] is None:
            round_of_loss[loser_id] = enc.round
        logger.debug(f"Encounter round {enc.round}: Winner {winner_id}, Loser {loser_id}")

    valid_rounds = [enc.round for enc in encounters if enc.round > 0]
    if not valid_rounds:
        logger.warning("No valid rounds found for single elimination playoffs")
        return [
            schemas.StandingTeamDataWithRanking(
                id=team_id,
                wins=data[team_id]["win"],
                loses=data[team_id]["lose"],
                draws=0,
                points=0,
                ranking=0,
                opponents=[],
                matches=data[team_id]["win"] + data[team_id]["lose"],
            )
            for team_id in data
        ]

    final_round = max(valid_rounds)
    final_matches = [enc for enc in encounters if enc.round == final_round]
    logger.info(f"Final round is {final_round} with {len(final_matches)} match(es)")

    if len(final_matches) == 1:
        final_match = final_matches[0]
        if final_match.home_score > final_match.away_score:
            data[final_match.home_team_id]["placement"] = 1
            data[final_match.away_team_id]["placement"] = 2
        else:
            data[final_match.away_team_id]["placement"] = 1
            data[final_match.home_team_id]["placement"] = 2
    else:
        for fm in final_matches:
            if fm.home_score > fm.away_score:
                data[fm.home_team_id]["placement"] = 1
                data[fm.away_team_id]["placement"] = 2
            else:
                data[fm.away_team_id]["placement"] = 1
                data[fm.home_team_id]["placement"] = 2

    round_losers: dict[int, list[int]] = defaultdict(list)
    for team_id, r in round_of_loss.items():
        if r is not None and data[team_id]["placement"] not in (1, 2):
            round_losers[r].append(team_id)

    current_place = 3
    for r in sorted(round_losers.keys(), reverse=True):
        losers_in_r = round_losers[r]
        for team_id in losers_in_r:
            data[team_id]["placement"] = current_place
        logger.debug(f"Round {r} losers assigned placement {current_place} for teams: {losers_in_r}")
        current_place += len(losers_in_r)

    output: list[schemas.StandingTeamDataWithRanking] = []
    for team_id, stats in data.items():
        output.append(
            schemas.StandingTeamDataWithRanking(
                id=team_id,
                wins=stats["win"],
                loses=stats["lose"],
                draws=0,
                points=0,
                ranking=stats["placement"],
                opponents=[],
                matches=stats["win"] + stats["lose"],
            )
        )
        logger.debug(f"Team {team_id} single elimination stats: {stats}")

    return output


def calculate_for_groups(
    group: models.TournamentGroup, encounters: typing.Sequence[models.Encounter]
) -> list[models.Standing]:
    standings = []
    teams = prepare_teams_for_groups(encounters)
    for position, team in enumerate(teams, 1):
        standing = models.Standing(
            tournament_id=group.tournament_id,
            group_id=group.id,
            team_id=team.id,
            position=position,
            matches=team.matches,
            win=team.wins,
            draw=team.draws,
            lose=team.loses,
            points=team.points,
            buchholz=team.buchholz,
            overall_position=-1,
            tb=team.tb,
        )
        standings.append(standing)
        logger.debug(f"Group standing for team {team.id}: position {position}")
    return standings


def calculate_for_playoffs(
    group: models.TournamentGroup,
    encounters: typing.Sequence[models.Encounter],
    tournament: models.Tournament,
) -> list[models.Standing]:
    logger.info(f"Calculating playoffs for tournament {tournament.id}")
    if tournament.id <= 4:
        logger.info("Using single elimination logic")
        teams = prepare_teams_for_playoffs_single_elimination(encounters)
    else:
        logger.info("Using double elimination logic")
        teams = prepare_teams_for_playoffs_double_elimination(encounters)

    standings = []
    for team in teams:
        standing = models.Standing(
            tournament_id=group.tournament_id,
            group_id=group.id,
            team_id=team.id,
            position=team.ranking,
            matches=team.matches,
            win=team.wins,
            draw=team.draws,
            lose=team.loses,
            points=team.points,
            buchholz=None,
            overall_position=team.ranking,
        )
        standings.append(standing)
        logger.debug(f"Playoff standing for team {team.id}: ranking {team.ranking}")
    return standings


async def calculate_overall_positions(
    standings: list[models.Standing], has_playoffs: bool
) -> list[models.Standing]:
    logger.info("Calculating overall positions")
    min_position = len(standings)
    if has_playoffs:
        min_position -= len([s for s in standings if s.overall_position != -1])
    group_standings = [s for s in standings if s.overall_position == -1]
    playoff_standings = [s for s in standings if s.overall_position != -1]
    playoff_teams = [s.team_id for s in playoff_standings]
    logger.debug(f"Group standings count: {len(group_standings)}, Playoff standings count: {len(playoff_standings)}")
    sorted_standings = sorted(group_standings, key=lambda x: (x.points, x.buchholz))
    for sorted_standing in sorted_standings:
        if sorted_standing.team_id in playoff_teams:
            for playoff_standing in playoff_standings:
                if playoff_standing.team_id == sorted_standing.team_id:
                    sorted_standing.overall_position = playoff_standing.overall_position
                    break
        else:
            sorted_standing.overall_position = min_position
            min_position -= 1
        logger.debug(f"Team {sorted_standing.team_id} overall position set to {sorted_standing.overall_position}")

    final_standings = [*sorted_standings, *playoff_standings]
    logger.info("Overall positions calculated")
    return final_standings


def sort_matches(matches: typing.Sequence[models.Encounter]) -> typing.Sequence[models.Encounter]:
    max_abs_round = max(abs(match.round) for match in matches)

    def sort_key(match):
        final_flag = 1 if abs(match.round) == max_abs_round else 0
        return final_flag, abs(match.round), 0 if match.round > 0 else 1

    return sorted(matches, key=sort_key)


async def calculate_for_tournament(
    session: AsyncSession, tournament: models.Tournament
) -> typing.Sequence[models.Standing]:
    has_groups = any(group.is_groups for group in tournament.groups)
    has_playoffs = any(not group.is_groups for group in tournament.groups)
    overall_standings: list[models.Standing] = []
    for group in tournament.groups:
        encounters = await encounter_service.get_by_tournament_group_id(
            session, tournament.id, group.id, []
        )
        encounters = sort_matches(encounters)
        logger.info(f"Processing group {group.id} with {len(encounters)} encounters")
        if group.is_groups:
            standings = calculate_for_groups(group, encounters)
            overall_standings.extend(standings)
        else:
            standings = calculate_for_playoffs(group, encounters, tournament)
            overall_standings.extend(standings)
    if has_groups:
        logger.info(f"Calculating overall standings for tournament {tournament.number}")
        standings = await calculate_overall_positions(overall_standings, has_playoffs)
        session.add_all(standings)
    else:
        session.add_all(overall_standings)

    await session.commit()
    logger.info(f"Standings calculated and committed for tournament {tournament.id}")
    return await get_by_tournament(session, tournament, ["team"])
