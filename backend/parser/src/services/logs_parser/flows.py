import csv

import sqlalchemy as sa
from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession

from src import models, schemas
from src.core import enums, errors, pagination
from src.services.encounter import flows as encounter_flows
from src.services.encounter import service as encounter_service
from src.services.hero import service as hero_service
from src.services.map import flows as map_flows
from src.services.s3 import service as s3_service
from src.services.team import service as team_service
from src.services.tournament import flows as tournament_flows
from src.services.tournament import flows as tournaments_flows
from src.services.user import service as user_service

from . import service


class MatchLogProcessor:
    def __init__(self, tournament: models.Tournament, name: str, data_in: list[str]):
        self.tournament: models.Tournament = tournament
        self.filename: str = name
        self.data_in: list[str] = data_in
        self.rows: list[
            tuple[enums.LogEventType, float, list[str]]
        ] = self.format_rows()
        self.rows_grouped: dict[
            int, list[tuple[enums.LogEventType, float, list[str]]]
        ] = self.group_by_rounds()
        self.heroes: dict[str, models.Hero] = {}

    def format_rows(self) -> list[tuple[enums.LogEventType, float, list[str]]]:
        formatted_rows = []
        for row in csv.reader(self.data_in):
            event = enums.LogEventType(row[1])
            if event == enums.LogEventType.Meta:
                continue
            formatted_rows.append((event, float(row[2]), row[3:]))
        return formatted_rows

    def get_rows_by_time(
        self, time: float
    ) -> list[tuple[enums.LogEventType, float, list[str]]]:
        return [row for row in self.rows if row[1] == time]

    def group_by_rounds(
        self,
    ) -> dict[int, list[tuple[enums.LogEventType, float, list[str]]]]:
        rounds: list[schemas.Round] = []
        current_round: schemas.Round | None = None
        for row in self.rows:
            if row[0] == enums.LogEventType.RoundStart:
                current_round = schemas.Round(
                    events=self.get_rows_by_time(row[1]), start=row[1], end=row[1]
                )
                rounds.append(current_round)
            elif row[0] == enums.LogEventType.RoundEnd:
                current_round["events"].extend(self.get_rows_by_time(row[1]))
                current_round["end"] = row[1]
            else:
                if not current_round:
                    continue
                current_round["events"].append(row)

        return {i: round["events"] for i, round in enumerate(rounds, 1)}

    def get_rows_by_event(
        self,
        event: enums.LogEventType,
        before: enums.LogEventType | None = None,
        after: enums.LogEventType | None = None,
    ) -> list[tuple[enums.LogEventType, float, list[str]]]:
        rows = []
        if not before and not after:
            return [row for row in self.rows if row[0] == event.value]

        if after:
            for row in self.rows:
                if row[0] == after:
                    break
                rows.append(row)

        if before:
            for row in self.rows:
                if row[0] == before:
                    break
                rows.append(row)

        return [row for row in rows if row[0] == event.value]

    def get_grouped_rows_by_event(
        self,
        event: enums.LogEventType,
        before: enums.LogEventType | None = None,
        after: enums.LogEventType | None = None,
    ) -> dict[int, list[tuple[enums.LogEventType, float, list[str]]]]:
        rows = []
        if not before and not after:
            return {
                i: [row for row in self.rows_grouped[i] if row[0] == event.value]
                for i in self.rows_grouped
            }

        if after:
            for i in self.rows_grouped:
                for row in self.rows_grouped[i]:
                    if row[0] == after:
                        break
                    rows.append(row)

        if before:
            for i in self.rows_grouped:
                for row in self.rows_grouped[i]:
                    if row[0] == before:
                        break
                    rows.append(row)

        return {
            i: [row for row in rows if row[0] == event.value] for i in self.rows_grouped
        }

    def get_team_names(self) -> tuple[str, str]:
        row = self.get_rows_by_event(enums.LogEventType.MatchStart)[0]
        return row[2][2], row[2][3]

    def get_teams_raw(self) -> dict[str, list[str]]:
        teams = self.get_team_names()
        cache: dict[str, list[str]] = {teams[0]: [], teams[1]: []}
        for team_name in teams:
            for _, _, values in self.get_rows_by_event(
                enums.LogEventType.PlayerJoined, before=enums.LogEventType.MatchEnd
            ):
                player, team = values[0], values[1]
                if team == team_name:
                    if player not in cache[team_name]:
                        cache[team_name].append(player)

        cache[teams[0]] = list(set(cache[teams[0]]))
        cache[teams[1]] = list(set(cache[teams[1]]))

        return cache

    def get_match_score_and_time(self) -> tuple[float, int, int]:
        row = self.get_rows_by_event(enums.LogEventType.MatchEnd)[0]
        return row[1], int(row[2][1]), int(row[2][2])

    def validate(self, is_raise: bool):
        if len(self.get_rows_by_event(enums.LogEventType.MatchEnd)) == 0:
            logger.error(
                f"Match log {self.filename} in tournament {self.tournament.name} is not finished"
            )
            if is_raise:
                raise errors.ApiHTTPException(
                    status_code=400,
                    detail=[
                        errors.ApiExc(
                            code="match_not_finished",
                            msg=f"Match log {self.filename} in tournament {self.tournament.name} is not finished",
                        )
                    ],
                )
            else:
                return False
        return True

    async def get_map(self, session: AsyncSession) -> models.Map:
        row = self.get_rows_by_event(enums.LogEventType.MatchStart)[0]
        gamemode = enums.game_mode_dict.get(row[2][1], row[2][1])
        map_name = enums.map_name_dict.get(row[2][0], row[2][0])
        return await map_flows.get_by_name_and_gamemode(session, map_name, gamemode)

    async def get_hero(self, session: AsyncSession, hero_name: str) -> models.Hero:
        hero_name = enums.hero_translation.get(hero_name, hero_name)
        if not self.heroes:
            heroes, total = await hero_service.get_all(
                session, pagination.PaginationParams(per_page=-1)
            )
            self.heroes = {hero.name: hero for hero in heroes}

        return self.heroes[hero_name]

    async def get_players_by_battle_names(
        self, session: AsyncSession
    ) -> dict[str, list[tuple[str, models.User | None]]]:
        """Производим тупую проверку наличия игроков в базе по battle_name"""
        teams_raw = self.get_teams_raw()
        teams_names = list(teams_raw.keys())
        teams: dict[str, list[tuple[str, models.User | None]]] = {
            teams_names[0]: [],
            teams_names[1]: [],
        }
        for team_name, players in teams_raw.items():
            for player in players:
                logger.info(
                    f"Trying to get user by battle name {player} in team {team_name}"
                )
                for verbose in [True, False]:
                    if user := await service.get_user_by_battle_name(
                        session, player, verbose
                    ):
                        break

                teams[team_name].append((player, user))

                if user:
                    logger.info(
                        f"User [id={user.id} name={user.name}] found by battle name {player} in team {team_name}"
                    )
                else:
                    logger.error(
                        f"User not found by battle name {player} in team {team_name}"
                    )
        return teams

    async def find_team_by_players(
        self, session: AsyncSession, players: list[tuple[str, models.User | None]]
    ) -> models.Team | None:
        for reverse in [True, False]:
            team_players_search = players.copy()
            if reverse:
                team_players_search.reverse()

            for i in range(len(team_players_search) - 2):
                team_db = await team_service.get_by_players_tournament(
                    session,
                    [
                        player.id
                        for _, player in team_players_search
                        if player is not None
                    ][i:],
                    self.tournament,
                    ["players", "players.user"],
                )
                if team_db:
                    return team_db

        raise errors.ApiHTTPException(
            status_code=400,
            detail=[
                errors.ApiExc(
                    code="team_not_found",
                    msg=f"Team not found by players {players} in tournament {self.tournament.name}",
                )
            ],
        )

    async def find_teams_by_players(
        self, session: AsyncSession
    ) -> tuple[
        tuple[models.Team, list[tuple[str, models.User | None]]],
        tuple[models.Team, list[tuple[str, models.User | None]]],
    ]:
        home_team_name, away_team_name = self.get_team_names()
        logger.info(
            f"Home team name: {home_team_name}, away team name: {away_team_name}"
        )
        players = await self.get_players_by_battle_names(session)
        logger.info(f"Players: {players}")
        home_team = await self.find_team_by_players(session, players[home_team_name])
        away_team = await self.find_team_by_players(session, players[away_team_name])
        return (home_team, players[home_team_name]), (
            away_team,
            players[away_team_name],
        )

    @staticmethod
    async def get_players_by_team_and_battle_name(
        session: AsyncSession,
        team: models.Team,
        players: list[tuple[str, models.User | None]],
    ) -> list[tuple[str, models.Player | None]]:
        players_out: list[tuple[str, models.Player | None]] = []
        for player in players:
            logger.info(
                f"Trying to get user by battle name {player[0]} in team {team.name}"
            )
            for verbose in [True, False]:
                if user := await service.get_user_by_team_and_battle_name(
                    session, team, player[0], verbose
                ):
                    break

            players_out.append((player[0], user))

            if user:
                logger.info(
                    f"User [id={user.id} name={user.name}] found by battle name {player[0]} in team {team.name}"
                )
            else:
                logger.error(
                    f"User not found by battle name {player[0]} in team {team.name}"
                )

        return players_out

    @staticmethod
    def get_missing_player(
        team: models.Team, players: list[models.Player]
    ) -> models.Player | None:
        for player in team.players:
            if player not in players:
                return player

        return None

    async def add_substitution(
        self,
        session: AsyncSession,
        team: models.Team,
        player: models.Player,
        user: models.User,
    ) -> models.Player:
        player_data = None
        players_data = await team_service.get_player_by_user_and_role(
            session, user.id, player.role, []
        )
        if players_data:
            player_data = sorted(
                players_data, key=lambda p: p.tournament_id, reverse=True
            )[0]
        return await team_service.create_player(
            session,
            name=user.name,
            primary=player_data.primary if player_data else False,
            secondary=player_data.secondary if player_data else False,
            rank=player_data.rank if player_data else player.rank,
            div=player_data.div if player_data else player.div,
            role=player.role,
            user=user,
            tournament=self.tournament,
            team=team,
            is_substitution=True,
            related_player_id=player.id,
            is_newcomer=player_data.is_newcomer
            if player_data
            else not bool(team_service.get_player_by_user(session, user.id, [])),
            is_newcomer_role=player_data.is_newcomer_role if player_data else True,
        )

    async def fix_team_players_collision(
        self,
        session: AsyncSession,
        team: models.Team,
        players_in: list[tuple[str, models.Player]],
        players_raw_in: list[tuple[str, models.User | None]],
    ) -> tuple[models.Team, dict[str, models.Player]]:
        players = [player[1] for player in players_in]
        players_raw = [player[1] for player in players_raw_in if player[1] is not None]
        players_out: dict[str, models.Player] = {
            player[0]: player[1] for player in players_in
        }
        players_raw_in_2 = [
            player for player in players_raw_in if player[1] is not None
        ]
        normal_team_len = len([p for p in team.players if not p.is_substitution])

        if len(players) == normal_team_len and len(players_raw_in_2) == normal_team_len:
            return team, players_out

        if len(players) == len(players_raw_in_2):
            return team, players_out

        # if len([p for p in team.players if not p.is_substitution]) == len(
        #     players_raw
        # ):  # Если кто-то случайно зашел в матч и не был в команде
        #     return team, players_out

        if (
            len(players) == normal_team_len - 1 and len(players_raw) == normal_team_len
        ) or len(players_raw) > len(players):
            logger.warning(f"Team {team.name} has 5 players in log, but only 4 in db")
            players_user_ids = [player.user_id for player in players]
            missing_player = self.get_missing_player(team, players)
            for user in players_raw_in:
                if user[1] and user[1].id not in players_user_ids:
                    logger.warning(
                        f"Player {user[1].name} is not in team {team.name}, adding"
                    )
                    new_player = await self.add_substitution(
                        session, team, missing_player, user[1]
                    )
                    players_out[user[0]] = new_player
            return team, players_out

        logger.warning(
            f"player len={len(players)} player_raw len={len(players_raw_in)}"
        )
        if (
            len(players) == normal_team_len - 1
            and len(players_raw) == normal_team_len - 1
        ):
            missing_player_name = [
                player[0] for player in players_raw_in if player[1] is None
            ][0]
            missing_player = self.get_missing_player(team, players)
            logger.warning(
                f"Player {missing_player.name} changed battle name to {missing_player_name}, updating"
            )
            await user_service.create_battle_tag(
                session,
                missing_player.user,
                name=missing_player_name,
                tag="0000",
                battle_tag=f"{missing_player_name}#0000",
            )
            players_out[missing_player_name] = missing_player

            return team, players_out

        raise errors.ApiHTTPException(
            status_code=400,
            detail=[
                errors.ApiExc(
                    code="team_players_collision",
                    msg=f"Team {team.name} has players collision: {players} and {players_raw}",
                )
            ],
        )

    async def process_teams(
        self, session: AsyncSession
    ) -> tuple[
        tuple[models.Team, dict[str, models.Player]],
        tuple[models.Team, dict[str, models.Player]],
    ]:
        home_team, away_team = await self.find_teams_by_players(session)
        home_players = await self.get_players_by_team_and_battle_name(
            session, home_team[0], home_team[1]
        )
        away_players = await self.get_players_by_team_and_battle_name(
            session, away_team[0], away_team[1]
        )
        home_team_out = await self.fix_team_players_collision(
            session,
            home_team[0],
            [p for p in home_players if p[1] is not None],
            home_team[1],
        )
        away_team_out = await self.fix_team_players_collision(
            session,
            away_team[0],
            [p for p in away_players if p[1] is not None],
            away_team[1],
        )
        return home_team_out, away_team_out

    async def process_kills(
        self,
        session: AsyncSession,
        match: models.Match,
        players: dict[str, models.Player],
    ) -> list[models.MatchKillFeed]:
        fights: list[schemas.Fight] = []
        current_fight: schemas.Fight | None = None
        kill_feed: list[models.MatchKillFeed] = []

        for match_round, rows in self.get_grouped_rows_by_event(
            enums.LogEventType.Kill
        ).items():
            for row in rows:
                if row[2][1] not in players:
                    logger.warning(f"Player {row[2][1]} not found in players")
                    continue
                killer = players[row[2][1]]
                killer_hero = await self.get_hero(session, row[2][2])
                victim = players[row[2][4]]
                victim_hero = await self.get_hero(session, row[2][5])
                kill_feed.append(
                    models.MatchKillFeed(
                        match_id=match.id,
                        time=row[1],
                        round=match_round,
                        fight=0,
                        killer_id=killer.user_id,
                        killer_hero_id=killer_hero.id,
                        killer_team_id=killer.team_id,
                        victim_id=victim.user_id,
                        victim_hero_id=victim_hero.id,
                        victim_team_id=victim.team_id,
                        ability=enums.AbilityEvent(row[2][6])
                        if row[2][6] != "0"
                        else None,
                        damage=float(row[2][7]),
                        is_critical_hit=True if row[2][8] == "True" else False,
                        is_environmental=True if row[2][9] == "True" else False,
                    )
                )

        for kill in sorted(kill_feed, key=lambda x: x.time):
            if not current_fight or kill.time - current_fight["end"] > 15:
                current_fight = schemas.Fight(
                    kills=[kill], start=kill.time, end=kill.time
                )
                fights.append(current_fight)
            else:
                current_fight["kills"].append(kill)
                current_fight["end"] = kill.time

        for i, fight in enumerate(fights, 1):
            for kill in fight["kills"]:
                kill.fight = i

        return kill_feed

    async def format_event(
        self,
        session: AsyncSession,
        match: models.Match,
        players: dict[str, models.Player],
        match_round: int,
        row: tuple[enums.LogEventType, float, list[str]],
        name: enums.MatchEvent,
    ) -> models.MatchEvent:
        player = players[row[2][1]]
        hero_id = (await self.get_hero(session, row[2][2])).id if row[2][2] else None
        related_player_id: int | None = None
        related_team_id: int | None = None
        related_hero_id: int | None = None
        if name == enums.MatchEvent.HeroSwap:
            related_hero_id = (await self.get_hero(session, row[2][3])).id
        if name == enums.MatchEvent.EchoDuplicateStart:
            related_hero_id = (await self.get_hero(session, row[2][3])).id
        if name == enums.MatchEvent.MercyRez:
            related_player_id = players[row[2][4]].user_id
            related_team_id = players[row[2][4]].team_id
            related_hero_id = (await self.get_hero(session, row[2][5])).id

        return models.MatchEvent(
            match_id=match.id,
            time=row[1],
            round=match_round,
            team_id=player.team_id,
            user_id=player.user_id,
            hero_id=hero_id,
            related_hero_id=related_hero_id,
            related_team_id=related_team_id,
            related_user_id=related_player_id,
            name=name,
        )

    async def create_events(
        self,
        session: AsyncSession,
        match: models.Match,
        players: dict[str, models.Player],
        event_type: enums.LogEventType,
        match_event_type: enums.MatchEvent,
    ) -> list[models.MatchEvent]:
        events: list[models.MatchEvent] = []
        for match_round, rows in self.get_grouped_rows_by_event(event_type).items():
            for row in rows:
                event = await self.format_event(
                    session, match, players, match_round, row, match_event_type
                )
                events.append(event)
        return events

    async def process_events(
        self,
        session: AsyncSession,
        match: models.Match,
        players: dict[str, models.Player],
    ) -> None:
        event_types = [
            (enums.LogEventType.OffensiveAssist, enums.MatchEvent.OffensiveAssist),
            (enums.LogEventType.DefensiveAssist, enums.MatchEvent.DefensiveAssist),
            (enums.LogEventType.UltimateCharged, enums.MatchEvent.UltimateCharged),
            (enums.LogEventType.UltimateStart, enums.MatchEvent.UltimateStart),
            (enums.LogEventType.UltimateEnd, enums.MatchEvent.UltimateEnd),
            (enums.LogEventType.HeroSwap, enums.MatchEvent.HeroSwap),
            (
                enums.LogEventType.EchoDuplicateStart,
                enums.MatchEvent.EchoDuplicateStart,
            ),
            (enums.LogEventType.EchoDuplicateEnd, enums.MatchEvent.EchoDuplicateEnd),
        ]

        all_events = []
        for log_event, match_event in event_types:
            events = await self.create_events(
                session, match, players, log_event, match_event
            )
            all_events.extend(events)

        session.add_all(all_events)
        await session.commit()

    def calculate_mvps(
        self,
        match: models.Match,
        players: dict[str, models.Player],
        cache_round: dict[str, dict[int, dict[enums.LogStatsName, float]]],
        max_round: int,
    ) -> list[models.MatchStatistics]:
        stats: list[models.MatchStatistics] = []
        mvps_cache: dict[str, dict[int, float]] = {}
        mvps_cache_reverted: dict[int, dict[float, str]] = {}

        for player_name, player_data in cache_round.items():
            for match_round, round_data in player_data.items():
                if players[player_name].role in [
                    enums.HeroClass.tank,
                    enums.HeroClass.damage,
                ]:
                    value = (
                        round_data[enums.LogStatsName.Eliminations] * 500
                        + round_data[enums.LogStatsName.OffensiveAssists] * 50
                        + round_data[enums.LogStatsName.DefensiveAssists] * 50
                        + round_data[enums.LogStatsName.HeroDamageDealt]
                        + round_data[enums.LogStatsName.HealingDealt] * 0.7
                        - round_data[enums.LogStatsName.Deaths] * 500
                        + round_data[enums.LogStatsName.DamageBlocked] * 0.1
                    )
                else:
                    value = (
                        round_data[enums.LogStatsName.Eliminations] * 500
                        + round_data[enums.LogStatsName.OffensiveAssists] * 50
                        + round_data[enums.LogStatsName.DefensiveAssists] * 50
                        + round_data[enums.LogStatsName.HeroDamageDealt]
                        + round_data[enums.LogStatsName.HealingDealt]
                        - round_data[enums.LogStatsName.Deaths] * 500
                        + round_data[enums.LogStatsName.DamageBlocked] * 0.1
                    )

                mvps_cache.setdefault(player_name, {})
                mvps_cache[player_name][match_round] = value

        for player_name, mvp_data in mvps_cache.items():
            for match_round, value in mvp_data.items():
                if match_round not in mvps_cache_reverted:
                    mvps_cache_reverted[match_round] = {}

                mvps_cache_reverted[match_round][value] = player_name

        for player_name, player_data in mvps_cache.items():
            for match_round, value in player_data.items():
                player = players[player_name]
                stats.append(
                    self.create_stat(
                        match,
                        enums.LogStatsName.PerformancePoints,
                        player,
                        match_round,
                        None,
                        value,
                    )
                )
                if match_round == max_round:
                    stats.append(
                        self.create_stat(
                            match,
                            enums.LogStatsName.PerformancePoints,
                            player,
                            0,
                            None,
                            value,
                        )
                    )

        for match_round, mvp_data in mvps_cache_reverted.items():
            for i, (_, player_name) in enumerate(
                sorted(mvp_data.items(), reverse=True, key=lambda x: x[0]), 1
            ):
                player = players[player_name]
                stats.append(
                    self.create_stat(
                        match,
                        enums.LogStatsName.Performance,
                        player,
                        match_round,
                        None,
                        i,
                    )
                )
                if match_round == max_round:
                    stats.append(
                        self.create_stat(
                            match, enums.LogStatsName.Performance, player, 0, None, i
                        )
                    )
        return stats

    @staticmethod
    def create_stat(
        match: models.Match,
        name: enums.LogStatsName,
        player: models.Player,
        match_round: int,
        hero_id: int | None,
        value: float,
    ) -> models.MatchStatistics:
        return models.MatchStatistics(
            match_id=match.id,
            round=match_round,
            team_id=player.team_id,
            user_id=player.user_id,
            hero_id=hero_id,
            name=name,
            value=value,
        )

    def calculate_stats(
        self,
        cache: dict[enums.LogStatsName, float],
        match: models.Match,
        player: models.Player,
        match_round: int,
        hero_id: int | None,
    ) -> list[models.MatchStatistics]:
        stats: list[models.MatchStatistics] = []
        kd = cache[enums.LogStatsName.Eliminations] / max(
            cache[enums.LogStatsName.Deaths], 1
        )
        kda = (
            cache[enums.LogStatsName.Eliminations]
            + cache[enums.LogStatsName.OffensiveAssists]
            + cache[enums.LogStatsName.DefensiveAssists]
        ) / max(cache[enums.LogStatsName.Deaths], 1)
        dmg_dlt = (
            cache[enums.LogStatsName.HeroDamageDealt]
            - cache[enums.LogStatsName.DamageTaken]
        )
        fbe = cache[enums.LogStatsName.FinalBlows] / max(
            cache[enums.LogStatsName.Eliminations], 1
        )
        dmg_fb = cache[enums.LogStatsName.HeroDamageDealt] / max(
            cache[enums.LogStatsName.FinalBlows], 1
        )
        assists = (
            cache[enums.LogStatsName.OffensiveAssists]
            + cache[enums.LogStatsName.DefensiveAssists]
        )
        stats.append(
            self.create_stat(
                match, enums.LogStatsName.KD, player, match_round, hero_id, kd
            )
        )
        stats.append(
            self.create_stat(
                match, enums.LogStatsName.KDA, player, match_round, hero_id, kda
            )
        )
        stats.append(
            self.create_stat(
                match,
                enums.LogStatsName.DamageDelta,
                player,
                match_round,
                hero_id,
                dmg_dlt,
            )
        )
        stats.append(
            self.create_stat(
                match, enums.LogStatsName.FBE, player, match_round, hero_id, fbe
            )
        )
        stats.append(
            self.create_stat(
                match, enums.LogStatsName.DamageFB, player, match_round, hero_id, dmg_fb
            )
        )
        stats.append(
            self.create_stat(
                match, enums.LogStatsName.Assists, player, match_round, hero_id, assists
            )
        )
        return stats

    async def create_stats(
        self,
        session: AsyncSession,
        match: models.Match,
        players: dict[str, models.Player],
    ) -> None:
        cache: dict[str, dict[int, dict[int, dict[enums.LogStatsName, float]]]] = {}
        cache_round: dict[str, dict[int, dict[enums.LogStatsName, float]]] = {}
        max_round: int = 0
        for row in self.get_rows_by_event(enums.LogEventType.PlayerStat):
            player_name = row[2][2]
            cache.setdefault(player_name, {})
            cache_round.setdefault(player_name, {})
            hero = await self.get_hero(session, row[2][3])
            match_round = int(row[2][0])
            max_round = max(max_round, match_round)
            cache[player_name].setdefault(match_round, {})
            cache[player_name][match_round].setdefault(hero.id, {})
            cache_round[player_name].setdefault(match_round, {})

            for stat_name, row_index in enums.log_stats_index_map.items():
                stat_value = row[2][row_index]
                if "****" in stat_value:
                    stat_value = "0"
                value = float(stat_value)

                cache[player_name][match_round][hero.id][stat_name] = value
                cache_round[player_name][match_round].setdefault(stat_name, 0)
                cache_round[player_name][match_round][stat_name] += value
                session.add(
                    self.create_stat(
                        match,
                        stat_name,
                        players[player_name],
                        match_round,
                        hero.id,
                        value,
                    )
                )

        session.add_all(self.calculate_mvps(match, players, cache_round, max_round))
        await session.commit()

        for player_name, player_cache in cache.items():
            for match_round, round_cache in player_cache.items():
                for hero_id, hero_cache in round_cache.items():
                    player = players[player_name]
                    if max_round == match_round:
                        session.add_all(
                            self.calculate_stats(hero_cache, match, player, 0, hero_id)
                        )
                        for stat_name, stat_value in hero_cache.items():
                            session.add(
                                self.create_stat(
                                    match, stat_name, player, 0, hero_id, stat_value
                                )
                            )

                    session.add_all(
                        self.calculate_stats(
                            hero_cache, match, player, match_round, hero_id
                        )
                    )

        await session.commit()

        for player_name, player_cache in cache_round.items():
            for match_round, round_cache in player_cache.items():
                player = players[player_name]
                if max_round == match_round:
                    session.add_all(
                        self.calculate_stats(round_cache, match, player, 0, None)
                    )
                    for stat_name, stat_value in round_cache.items():
                        session.add(
                            self.create_stat(
                                match, stat_name, player, 0, None, stat_value
                            )
                        )

                for stat_name, stat_value in round_cache.items():
                    session.add(
                        self.create_stat(
                            match, stat_name, player, match_round, None, stat_value
                        )
                    )

                session.add_all(
                    self.calculate_stats(round_cache, match, player, match_round, None)
                )

        await session.commit()

    async def start(
        self, session: AsyncSession, is_raise: bool = True
    ) -> models.Match | None:
        logger.info(
            f"Processing match log {self.filename} in tournament {self.tournament.name}"
        )
        if not self.validate(is_raise=is_raise):
            return
        home_team, away_team = await self.process_teams(session)
        players: dict[str, models.Player] = {}

        for team in [home_team, away_team]:
            for name, player in team[1].items():
                players[name] = player

        match_map = await self.get_map(session)
        logger.info(
            f"Match map: {match_map.name} in match log {self.filename} in tournament {self.tournament.name}"
        )
        match_time, home_score, away_score = self.get_match_score_and_time()
        logger.info(
            f"Match time: {match_time}, home score: {home_score}, away score: {away_score}"
        )

        encounter = await encounter_flows.get_by_teams_ids(
            session, home_team[0].id, away_team[0].id, []
        )
        match = await encounter_service.get_match_by_encounter_and_map(
            session, encounter.id, match_map.id, []
        )

        if not match:
            match = await encounter_service.create_match(
                session,
                encounter,
                time=match_time,
                log_name=self.filename,
                map=match_map,
                home_team_id=home_team[0].id,
                away_team_id=away_team[0].id,
                home_score=home_score,
                away_score=away_score,
            )
            await encounter_service.update(session, encounter, has_logs=True)
            logger.info(
                f"Match created [id={match.id}] in match log {self.filename} in tournament {self.tournament.name}"
            )
        else:
            match.time = match_time
            match.home_score = home_score
            match.away_score = away_score
            match.map_id = match_map.id
            match.home_team_id = home_team[0].id
            match.away_team_id = away_team[0].id
            match.log_name = self.filename
            session.add(match)
            await session.commit()

        await session.execute(
            sa.delete(models.MatchStatistics).where(
                sa.and_(models.MatchStatistics.match_id == match.id)
            )
        )
        await session.execute(
            sa.delete(models.MatchEvent).where(
                sa.and_(models.MatchEvent.match_id == match.id)
            )
        )
        await session.execute(
            sa.delete(models.MatchKillFeed).where(
                sa.and_(models.MatchKillFeed.match_id == match.id)
            )
        )
        await session.commit()
        logger.info(
            f"Processing stats in match log {self.filename} in tournament {self.tournament.name}"
        )
        await self.create_stats(session, match, players)
        await session.commit()

        logger.info(
            f"Processing kills in match log {self.filename} in tournament {self.tournament.name}"
        )
        kills = await self.process_kills(session, match, players)
        session.add_all(kills)
        logger.info(
            f"Processing events in match log {self.filename} in tournament {self.tournament.name}"
        )
        await self.process_events(session, match, players)
        logger.info(
            f"Match log {self.filename} in tournament {self.tournament.name} processed successfully"
        )
        await session.commit()

        return match


async def process_closeness(session: AsyncSession, payload: list[str]):
    data = csv.reader(payload, delimiter=",")
    for index, row in enumerate(data, 1):
        if index == 1:
            continue
        (
            tournament_name,
            _,
            _,
            _,
            _,
            home_team_name,
            away_team_name,
            encounter_name,
            _,
            _,
            _,
            closeness,
            closeness_percent,
            _,
            _,
            _,
        ) = row
        logger.info(
            f"Processing row for encounter {encounter_name} in tournament {tournament_name}"
        )
        if tournament_name.startswith("OWAL_s2"):
            tournament = await tournament_flows.get_by_name(
                session, f"OWAL Season 2 | Day {tournament_name[-1]}", []
            )
        else:
            tournament = await tournament_flows.get_by_number_and_league(
                session, int(tournament_name), False, []
            )

        logger.info(f"Tournament {tournament.name} found [id={tournament.id}]")
        logger.info(
            f"Home team name: {home_team_name}, away team name: {away_team_name}"
        )
        home_team = await team_service.get_by_name_and_tournament(
            session, tournament.id, home_team_name.strip(), []
        )
        away_team = await team_service.get_by_name_and_tournament(
            session, tournament.id, away_team_name.strip(), []
        )

        if not home_team or not away_team:
            logger.error(
                f"Home team {home_team_name} or away team {away_team_name} not found"
            )
            continue

        if closeness_percent:
            if encounter := await encounter_service.get_by_teams(
                session, home_team.id, away_team.id, [], has_closeness=False
            ):
                encounter.closeness = round(int(closeness_percent) / 100, 2)
                session.add(encounter)
                await session.commit()
        logger.info(
            f"Row for encounter {encounter_name} in tournament {tournament.name} processed successfully"
        )


async def process_match_log(
    session: AsyncSession, tournament_id: int, filename: str, *, is_raise: bool = True
) -> None:
    tournament = await tournaments_flows.get(session, tournament_id, [])
    logger.info(
        f"Fetching logs from S3 for tournament {tournament.id} and file {filename}"
    )

    data = await s3_service.async_client.get_log_by_filename(tournament.id, filename)
    decoded_lines = [line.decode() for line in data.split(b"\n") if line]

    processor = MatchLogProcessor(tournament, filename.split("/")[-1], decoded_lines)
    try:
        await processor.start(session, is_raise=is_raise)
    except Exception as e:
        logger.exception(e)
