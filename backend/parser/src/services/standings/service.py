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
        .where(
            sa.and_(
                models.Standing.tournament_id == tournament.id,
            )
        )
    )
    result = await session.execute(query)
    return result.scalars().all()


async def delete_by_tournament(session: AsyncSession, tournament_id: int) -> None:
    query = sa.delete(models.Standing).where(
        sa.and_(models.Standing.tournament_id == tournament_id)
    )
    await session.execute(query)
    await session.commit()


def calculate_median_buchholz_and_tb_for_teams_in_group(
    players_in: dict[int, schemas.StandingTeamData],
) -> list[schemas.StandingTeamDataWithBuchholzTB]:
    median_buchholz_scores: dict[int, float] = {}
    tb_scores: dict[int, int] = {}

    for player in players_in.values():
        opponent_scores = sorted(
            [players_in[opponent_id].points for opponent_id in player.opponents]
        )

        if len(opponent_scores) > 2:
            opponent_scores = opponent_scores[
                1:-1
            ]  # Remove the highest and lowest scores

        median_buchholz_scores[player.id] = sum(opponent_scores)

    # Calculate TB (number of match wins against tied opponents)
    points_to_players = {}
    for player in players_in.values():
        points_to_players.setdefault(player.points, []).append(player.id)

    for players_with_same_points in points_to_players.values():
        for player_id in players_with_same_points:
            tb_scores[player_id] = sum(
                1
                for opponent_id in players_in[player_id].opponents
                if players_in[opponent_id].points == players_in[player_id].points
                and players_in[player_id].wins > players_in[opponent_id].wins
            )

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
                tb=tb_scores.get(
                    player.id, 0
                ),  # Add TB value, default to 0 if not found
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
        if encounter.home_score < encounter.away_score:
            team_cache[encounter.away_team_id].wins += 1
            team_cache[encounter.home_team_id].loses += 1
            team_cache[encounter.away_team_id].points += 1
        if encounter.home_score == encounter.away_score:
            team_cache[encounter.home_team_id].draws += 1
            team_cache[encounter.away_team_id].draws += 1
            team_cache[encounter.home_team_id].points += 0.5
            team_cache[encounter.away_team_id].points += 0.5

        team_cache[encounter.home_team_id].opponents.append(encounter.away_team_id)
        team_cache[encounter.away_team_id].opponents.append(encounter.home_team_id)

    teams = calculate_median_buchholz_and_tb_for_teams_in_group(team_cache)
    return sorted(teams, key=lambda x: (x.points, x.tb, x.buchholz), reverse=True)


def prepare_teams_for_playoffs_double_elimination(
    encounters: typing.Sequence[models.Encounter],
) -> list[schemas.StandingTeamDataWithRanking]:
    participants = list(
        {match.home_team_id for match in encounters}
        | {match.away_team_id for match in encounters}
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
        if encounter.round not in under_games:
            under_games[encounter.round] = []
        under_games[encounter.round].append(encounter)

    for stage, matches in under_games.items():
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
                wins=data[team_id]["win"],
                loses=data[team_id]["lose"],
                draws=0,
                points=0,
                ranking=data[team_id]["placement"],
                opponents=[],
                matches=data[team_id]["win"] + data[team_id]["lose"],
            )
        )

    return output


def prepare_teams_for_playoffs_single_elimination(
    encounters: typing.Sequence["models.Encounter"],
) -> list["schemas.StandingTeamDataWithRanking"]:
    """
    Формирует таблицу результатов для single elimination (одинарное выбывание)
    при любом числе участников.

    Параметры:
    -----------
    encounters: список матчей (models.Encounter) с атрибутами:
      - home_team_id
      - away_team_id
      - home_score
      - away_score
      - round (int) — чем выше, тем позже стадия. Финал = max(round).

    Возвращает:
    -----------
    Список schemas.StandingTeamDataWithRanking со следующими полями:
      - id (team_id)
      - wins
      - loses
      - draws (0 — в данной логике ничьих нет)
      - points (0 — если нет специфических очков)
      - ranking (место в турнире: 1 — победитель, 2 — финалист, 3—..., 0 — если что-то не рассчитали)
      - opponents (пустой список — при необходимости дополняйте)
      - matches (кол-во матчей команды = wins + loses)
    """

    # 1) Собираем все команды
    participants = list(
        {m.home_team_id for m in encounters} | {m.away_team_id for m in encounters}
    )

    # Для хранения статистики (win/lose/placement) по каждой команде
    data: dict[int, dict[str, float | int]] = {
        participant: {"win": 0, "lose": 0, "placement": 0}
        for participant in participants
    }

    # 2) Считаем победы и поражения, фиксируем раунд проигрыша
    #    Если команда не проигрывает, то round_of_loss останется None (победитель).
    round_of_loss: dict[int, int | None] = {team: None for team in participants}

    for enc in encounters:
        # Определим победителя
        if enc.home_score > enc.away_score:
            winner_id = enc.home_team_id
            loser_id = enc.away_team_id
        else:
            winner_id = enc.away_team_id
            loser_id = enc.home_team_id

        data[winner_id]["win"] += 1
        data[loser_id]["lose"] += 1

        # Если у команды ещё не зафиксирован проигрыш, то пишем round
        if round_of_loss[loser_id] is None:
            round_of_loss[loser_id] = enc.round

    # 3) Ищем финальный (максимальный) раунд
    #    Если нет ни одного matсh.round > 0, значит матчи не игрались (или round <= 0).
    #    В таком случае либо нет победителя, либо турнир ещё не начался.
    valid_rounds = [enc.round for enc in encounters if enc.round > 0]
    if not valid_rounds:
        # Случай, когда не проводили ни одного реального матча.
        # Все команды placement = 0 (либо 1, если хотим назвать всех победителями).
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

    # Соберём все матчи финала (иногда может быть несколько)
    final_matches = [enc for enc in encounters if enc.round == final_round]

    # 4) Определяем 1-е и 2-е место
    #    Предположим, что в финале обычно 1 матч.
    #    Если их несколько, может потребоваться своя логика, кто из победителей – абсолютно лучший.
    if len(final_matches) == 1:
        final_match = final_matches[0]
        if final_match.home_score > final_match.away_score:
            data[final_match.home_team_id]["placement"] = 1
            data[final_match.away_team_id]["placement"] = 2
        else:
            data[final_match.away_team_id]["placement"] = 1
            data[final_match.home_team_id]["placement"] = 2
    else:
        # Если несколько матчей в "финальном" раунде:
        #  - Можно либо назначить всем победителям 1 место, всем проигравшим 2.
        #  - Или выделять "суперфинал" и т.п.
        # Ниже — простейший пример, все победители финала = 1, все проигравшие финала = 2
        for fm in final_matches:
            if fm.home_score > fm.away_score:
                data[fm.home_team_id]["placement"] = 1
                data[fm.away_team_id]["placement"] = 2
            else:
                data[fm.away_team_id]["placement"] = 1
                data[fm.home_team_id]["placement"] = 2

    # 5) Группируем проигравших по раундам, исключая тех, кого уже отметили как 2 место
    round_losers: dict[int, list[int]] = defaultdict(list)
    for team_id, r in round_of_loss.items():
        # Если команда не проиграла ни разу (r=None), это либо победитель, либо она пропустила финал
        # (в любом случае её place 1 или 0)
        if r is not None:
            # Если команда не 2-е место (т.е. не проиграла в финале) и не 1-е место
            # (на случай, если почему-то где-то поставили 1-е место).
            if data[team_id]["placement"] not in (1, 2):
                round_losers[r].append(team_id)

    # 6) Распределяем места с 3-го по ...
    #    Логика: идём от (final_round-1) к 1, присваивая проигравшим в каждом раунде общее место.
    #    Все команды, проигравшие в одном и том же раунде, **делят** это место.
    #    current_place начинается с 3, т.к. 1 и 2 уже заняты.
    current_place = 3

    # Сортируем раунды по убыванию (финал-1, финал-2, ...)
    # При этом, если в сетке пропущены раунды (например, были 1 и 3, а 2 не было),
    # мы всё равно корректно обойдём.
    unique_loser_rounds = sorted(round_losers.keys(), reverse=True)

    for r in unique_loser_rounds:
        # Все, кто проиграл в раунде r (и ещё не получили место)
        losers_in_r = round_losers[r]
        if not losers_in_r:
            continue

        # Назначаем им текущее место
        for team_id in losers_in_r:
            data[team_id]["placement"] = current_place

        # Двигаем current_place вперёд:
        # Если мы хотим, чтобы все эти команды делили одно место (например, 3–4 место для двоих),
        # то увеличим current_place на число проигравших.
        # Пример: двое проиграли — они делят 3 место, следующее место будет 5.
        current_place += len(losers_in_r)

    # 7) Формируем выходной список
    output: list["schemas.StandingTeamDataWithRanking"] = []
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

    return output


def calculate_for_groups(
    group: models.TournamentGroup, encounters: typing.Sequence[models.Encounter]
) -> list[models.Standing]:
    standings = []
    for position, team in enumerate(prepare_teams_for_groups(encounters), 1):
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

    return standings


def calculate_for_playoffs(
    group: models.TournamentGroup,
    encounters: typing.Sequence[models.Encounter],
    tournament: models.Tournament,
) -> list[models.Standing]:
    standings = []

    if tournament.id <= 4:
        teams = prepare_teams_for_playoffs_single_elimination(encounters)
    else:
        teams = prepare_teams_for_playoffs_double_elimination(encounters)

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

    return standings


async def calculate_overall_positions(
    standings: list[models.Standing], has_playoffs: bool
) -> list[models.Standing]:
    min_position = len(standings)
    if has_playoffs:
        min_position -= len([s for s in standings if s.overall_position != -1])

    group_standings = [s for s in standings if s.overall_position == -1]
    playoff_standings = [s for s in standings if s.overall_position != -1]
    playoff_teams = [s.team_id for s in playoff_standings]
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

    return [*sorted_standings, *playoff_standings]


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
    return await get_by_tournament(session, tournament, ["team"])
