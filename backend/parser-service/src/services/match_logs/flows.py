from __future__ import annotations

import asyncio
import csv
from collections.abc import Sequence
from datetime import UTC, datetime

import pandas as pd
import sqlalchemy as sa
from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession

from shared.clients.s3 import S3Client
from shared.core import impact as impact_consts
from shared.disciplines import discipline, identity_provider
from shared.domain.pick_ban_config import pool_allows
from shared.messaging.config import ACHIEVEMENT_EVALUATE_QUEUE, TOURNAMENT_EVENTS_EXCHANGE
from shared.messaging.outbox import enqueue_outbox_event
from shared.models.tournament.pick_ban import PickBanConfig
from shared.repository import CatalogEntityRepository, CatalogRoleRepository
from shared.repository.identity import UserRepository
from shared.repository.pick_ban import CONFIG_POOL_LOAD, PickBanConfigRepository
from shared.repository.stats import EventTypeRepository, IngestJobRepository, StatDefRepository, StatsMatchRepository
from shared.schemas.events import AchievementEvaluateEvent, TournamentStandingsInvalidatedEvent
from shared.services.encounter.events import enqueue_encounter_completed
from shared.services.encounter.participants import MemberSnapshot, add_substitute
from shared.services.realtime import Resource, Scope, emit, enqueue_invalidation_outbox
from shared.services.social_identity import social_identity_service
from shared.services.stats_evidence import capture_stats_evidence, owner_scopes, stage_stats_evidence
from src import models
from src.core import enums, errors, pagination
from src.core.config import settings
from src.domain.match_logs import impact
from src.services import catalog_aliases
from src.services.baselines import service as baselines_service
from src.services.encounter import flows as encounter_flows
from src.services.encounter import service as encounter_service
from src.services.map.service import map_service
from src.services.match_logs.binary import binary_match_logs
from src.services.match_logs.event_models import KillEvent, MatchEventRow, PlayerStatRow
from src.services.match_logs.limits import match_log_oversize_message
from src.services.match_logs.log_records import compute_content_hash, log_records_service, reparse_observation
from src.services.match_logs.objectiveless import resolve_encounter_maps
from src.services.match_logs.roster import LogPlayer
from src.services.team import service as team_service

from . import service

_heroes = CatalogEntityRepository("character", discipline=catalog_aliases.DISCIPLINE)

_LOG_DF_COLUMNS = ["event_type", "time", "data", "round_number"]
_LOG_EVENT_TYPE_BY_VALUE = {member.value: member for member in enums.LogEventType}


def _empty_log_df() -> pd.DataFrame:
    return pd.DataFrame(columns=_LOG_DF_COLUMNS)


def _index_rows_by_event_type(df: pd.DataFrame) -> dict[enums.LogEventType, pd.DataFrame]:
    if df.empty:
        return {}
    return {event_type: group for event_type, group in df.groupby("event_type", sort=False)}  # noqa: C416


def _event_row(event: models.StatsEvent) -> dict:
    return {
        column.name: getattr(event, column.name)
        for column in models.StatsEvent.__table__.columns
        if column.name != "id"
    }


def _processor_from_bytes(job: models.IngestJob, raw_bytes: bytes) -> MatchLogProcessor:
    return MatchLogProcessor(job, raw_bytes.decode("utf-8").splitlines())


def _encounter_is_completed(encounter: models.Encounter) -> bool:
    # Single form (encres0001 pins it to result_status == CONFIRMED).
    return encounter.status == enums.EncounterStatus.COMPLETED


async def enqueue_match_scores_changed(session: AsyncSession, tournament_id: int, encounter_id: int) -> None:
    # A parsed log adds or replaces one map's observation under the encounter
    # (``has_logs``, the per-map reads). It does not move the encounter's score:
    # EncounterGame and finalize own that since encgame01. Both halves of the
    # invalidation: emit() for the clients and this service's own caches, the
    # outbox row for tournament-service and app-service, which cache the same
    # reads and cannot rely on Redis pub/sub's at-most-once delivery.
    invalidated = (Resource.TOURNAMENT_ENCOUNTERS, Resource.TOURNAMENT_STANDINGS)
    scope = Scope.tournament(tournament_id)
    await emit(session, scope=scope, invalidates=list(invalidated), entity_ids={"encounter_ids": [encounter_id]})
    await enqueue_invalidation_outbox(session, scope=scope, resources=invalidated)

    await enqueue_outbox_event(
        session,
        TournamentStandingsInvalidatedEvent(
            tournament_id=tournament_id,
            source_service="parser-service",
        ),
        exchange=TOURNAMENT_EVENTS_EXCHANGE,
        routing_key="tournament.standings.invalidated",
    )


async def _enqueue_match_log_tournament_events(
    session: AsyncSession,
    encounter: models.Encounter,
) -> None:
    await enqueue_match_scores_changed(session, encounter.tournament_id, encounter.id)

    if not _encounter_is_completed(encounter):
        return

    await enqueue_encounter_completed(session, encounter, source_service="parser-service")


_match_repo = StatsMatchRepository()
_job_repo = IngestJobRepository()
_user_repo = UserRepository()
_pick_ban_config_repo = PickBanConfigRepository()


class MatchLogProcessor:
    def __init__(self, job: models.IngestJob, data_in: list[str]):
        self.job = job
        self.identity_provider = identity_provider(job.discipline)
        self.filename = job.filename
        self.df = self._load_and_format_data(data_in)
        self._rows_by_type = _index_rows_by_event_type(self.df)
        self.heroes_map: dict[str, models.CatalogEntity] = {}
        self.hero_misses: set[str] = set()
        self.map_misses: dict[str, set[str]] = {}
        self.member_by_user: dict[int, int] = {}
        self.participant_by_team: dict[int, int] = {}
        self.observed_roles: dict[int, enums.HeroClass] = {}

    def _load_and_format_data(self, data_in: list[str]) -> pd.DataFrame:
        # Cap the number of lines before building the DataFrame — an oversized or
        # adversarial log would otherwise be parsed in full (review MEDIUM).
        max_lines = settings.max_match_log_lines
        if len(data_in) > max_lines:
            raise errors.ApiHTTPException(
                status_code=413,
                detail=[
                    errors.ApiExc(
                        code="match_log_too_large",
                        msg=f"Match log {self.filename} exceeds the maximum of {max_lines} lines",
                    )
                ],
            )

        valid_lines = [line for line in data_in if line.strip()]
        if not valid_lines:
            logger.warning(f"Match log {self.filename} has no valid lines.")
            return _empty_log_df()

        parsed_rows: list[tuple[enums.LogEventType, float, list[str]]] = []
        for line, row_parts in zip(valid_lines, csv.reader(valid_lines), strict=True):
            if len(row_parts) < 3:
                logger.warning(f"Skipping malformed row in {self.filename}: {line}")
                continue

            raw_event_type = row_parts[1].strip()
            if raw_event_type.lower() == "meta":
                continue

            event_type = _LOG_EVENT_TYPE_BY_VALUE.get(raw_event_type)
            if event_type is None:
                logger.warning(f"Skipping row with unknown event type '{raw_event_type}' in {self.filename}")
                continue

            try:
                time = float(row_parts[2])
            except ValueError:
                logger.warning(f"Skipping row with invalid time '{row_parts[2]}' in {self.filename}")
                continue

            parsed_rows.append((event_type, time, row_parts[3:]))

        if not parsed_rows:
            logger.warning(f"Match log {self.filename} resulted in an empty DataFrame.")
            return _empty_log_df()

        return self._assign_round_numbers(pd.DataFrame(parsed_rows, columns=["event_type", "time", "data"]))

    @staticmethod
    def _assign_round_numbers(df: pd.DataFrame) -> pd.DataFrame:
        df["round_number"] = (df["event_type"] == enums.LogEventType.RoundStart).cumsum()
        return df

    def _get_rows(
        self,
        event_type: enums.LogEventType | None = None,
        round_number: int | None = None,
    ) -> pd.DataFrame:
        if event_type is None:
            temp_df = self.df
        else:
            temp_df = self._rows_by_type.get(event_type)
            if temp_df is None:
                return _empty_log_df()
        if round_number is not None:
            temp_df = temp_df[temp_df["round_number"] == round_number]
        return temp_df

    def get_team_names(self) -> tuple[str, str] | tuple[None, None]:
        match_start_events = self._get_rows(enums.LogEventType.MatchStart)
        if match_start_events.empty:
            logger.error("MatchStart event not found.")
            raise errors.ApiHTTPException(
                status_code=400, detail=[errors.ApiExc(code="match_log_corrupt", msg="MatchStart event missing")]
            )

        row_data = match_start_events.iloc[0]["data"]
        return row_data[2], row_data[3]

    def get_teams_raw(self) -> dict[str, list[str]]:
        home, away = self.get_team_names()
        teams = {home: [], away: []}
        participant_team = {}

        def add(name, team):
            if not name or team not in teams:
                raise ValueError("Log participant has no declared team")
            if name in participant_team and participant_team[name] != team:
                raise ValueError("Log participant appears on both teams")
            participant_team[name] = team
            if name not in teams[team]:
                teams[team].append(name)

        # Event endpoints count even without a PlayerStat or PlayerJoined row.
        for row in self.df.itertuples(index=False):
            data = row.data
            if row.event_type == enums.LogEventType.PlayerJoined and len(data) >= 2:
                add(data[0], data[1])
            elif row.event_type == enums.LogEventType.PlayerStat and len(data) >= 4:
                add(data[2], data[1])
            elif row.event_type == enums.LogEventType.Kill and len(data) >= 6:
                add(data[1], data[0])
                add(data[4], data[3])
            elif (
                row.event_type
                in {
                    enums.LogEventType.OffensiveAssist,
                    enums.LogEventType.DefensiveAssist,
                    enums.LogEventType.UltimateCharged,
                    enums.LogEventType.UltimateStart,
                    enums.LogEventType.UltimateEnd,
                    enums.LogEventType.MercyRez,
                    enums.LogEventType.HeroSwap,
                    enums.LogEventType.EchoDuplicateStart,
                    enums.LogEventType.EchoDuplicateEnd,
                }
                and len(data) >= 3
            ):
                add(data[1], data[0])
                if row.event_type == enums.LogEventType.MercyRez and len(data) > 4 and data[4]:
                    add(data[4], data[0])
        return teams

    def get_match_score_and_time(self) -> tuple[float, int, int]:
        match_end_events = self._get_rows(enums.LogEventType.MatchEnd)
        if match_end_events.empty:
            logger.error(f"Match log {self.filename} has no MatchEnd event.")
            raise errors.ApiHTTPException(
                status_code=400, detail=[errors.ApiExc(code="match_not_finished", msg="MatchEnd event missing")]
            )

        row_data = match_end_events.iloc[0]["data"]  # Assuming one MatchEnd
        return float(match_end_events.iloc[0]["time"]), int(row_data[1]), int(row_data[2])

    async def validate(self) -> None:
        if self.df.empty:
            raise errors.ApiHTTPException(
                status_code=400,
                detail=[errors.ApiExc(code="match_log_empty", msg="Match log is empty or unparseable.")],
            )
        if self._get_rows(enums.LogEventType.MatchEnd).empty:
            raise errors.ApiHTTPException(
                status_code=400, detail=[errors.ApiExc(code="match_not_finished", msg="MatchEnd event missing")]
            )

    async def get_map(self, session: AsyncSession) -> models.CatalogEntity:
        match_start_events = self._get_rows(enums.LogEventType.MatchStart)
        if match_start_events.empty:
            raise errors.ApiHTTPException(
                status_code=400,
                detail=[errors.ApiExc(code="match_log_corrupt", msg="MatchStart event missing for map info")],
            )

        row_data = match_start_events.iloc[0]["data"]
        gamemode_raw, map_name_raw = row_data[1], row_data[0]
        result = await map_service.get_by_name_or_alias_and_gamemode(session, map_name_raw, gamemode_raw)
        if result is None:
            # Persist after rollback, avoiding a second transaction waiting on
            # the locked job's FK while this processor waits on that transaction.
            self.map_misses = {"map": {map_name_raw}, "mode": {gamemode_raw}}
            raise errors.ApiHTTPException(
                status_code=404,
                detail=[errors.ApiExc(code="not_found", msg=f"Map {map_name_raw!r} / mode {gamemode_raw!r} not found")],
            )
        return result

    async def _validate_map_pool(
        self,
        session: AsyncSession,
        encounter: models.Encounter,
        match_map: models.CatalogEntity,
        map_pools: Sequence[PickBanConfig],
    ) -> None:
        # No pool (including a rules-only template) means captains choose freely.
        stage_id, round_ = (await encounter_service.bracket_positions(session, [encounter.id])).get(
            encounter.id, (None, None)
        )
        if not pool_allows(map_pools, stage_id=stage_id, round=round_, item_id=match_map.id):
            msg = (
                f"Map '{match_map.name}' (id={match_map.id}) in log {self.filename} "
                f"is outside the configured map pool for encounter {encounter.id}"
            )
            logger.warning(msg)
            raise errors.ApiHTTPException(status_code=400, detail=[errors.ApiExc(code="map_not_in_pool", msg=msg)])

    async def _preload_data(self, session: AsyncSession):
        heroes_db, _ = await _heroes.get_all(session, pagination.PaginationSortParams(per_page=-1))
        self.heroes_map = {}
        for hero in heroes_db:
            self.heroes_map[hero.name] = hero
            # `setdefault`, not `[alias] =`: one hero's canonical name must never
            # be shadowed by another hero's alias.
            for alias in hero.aliases:
                self.heroes_map.setdefault(alias, hero)

    def get_hero(self, hero_name: str) -> models.CatalogEntity:
        hero = self.heroes_map.get(hero_name)
        if not hero:
            # Recorded after rollback; unresolved vocabulary must not silently
            # drop observations from an otherwise successful revision.
            self.hero_misses.add(hero_name)
            raise errors.ApiHTTPException(
                status_code=404,
                detail=[errors.ApiExc(code="hero_not_found", msg=f"Hero '{hero_name}' not found in preloaded cache.")],
            )
        return hero

    async def get_players_by_battle_names(
        self, session: AsyncSession
    ) -> dict[str, list[tuple[str, models.User | None]]]:
        teams_raw = self.get_teams_raw()
        teams_names = list(teams_raw.keys())
        team_name_1 = teams_names[0] if len(teams_names) > 0 else "unknown1"
        team_name_2 = teams_names[1] if len(teams_names) > 1 else "unknown2"

        teams: dict[str, list[tuple[str, models.User | None]]] = {
            team_name_1: [],
            team_name_2: [],
        }

        # Resolve every log name across both teams in a single query rather than
        # one (or two) SELECTs per player (review L14).
        all_battle_names = [player for players in teams_raw.values() for player in players]
        users_by_name = await service.get_users_by_battle_names(
            session, all_battle_names, provider=self.identity_provider
        )

        for team_name, players in teams_raw.items():
            for player in players:
                user_found = users_by_name.get(player)
                teams[team_name].append((player, user_found))

                if user_found:
                    logger.debug(
                        f"User [id={user_found.id} name={user_found.name}] "
                        f"found by battle name {player} in team {team_name}"
                    )
                else:
                    logger.warning(f"User not found by battle name {player} in team {team_name}")
        return teams

    async def find_team_by_players(
        self, session: AsyncSession, players: list[tuple[str, models.User | None]]
    ) -> models.Team:
        team_entities = ["players", "players.user", "players.workspace_member"]
        player_ids = [p.id for _, p in players if p is not None]
        if len(player_ids) >= 3:
            team_db = await team_service.get_by_players_by_ids_tournament(
                session,
                player_ids,
                self.tournament,
                team_entities,
            )
            if team_db:
                return team_db

        for reverse in [True, False]:
            team_players_search = players.copy()
            if reverse:
                team_players_search.reverse()

            resolved_ids = [p.id for _, p in team_players_search if p is not None]
            for i in range(len(team_players_search) - 2):
                current_player_ids_to_search = resolved_ids[i:]

                if len(current_player_ids_to_search) < 3:
                    continue

                team_db = await team_service.get_by_players_by_ids_tournament(
                    session,
                    current_player_ids_to_search,
                    self.tournament,
                    team_entities,
                )
                if team_db:
                    return team_db

        player_names_str = ", ".join([name for name, _ in players])
        raise errors.ApiHTTPException(
            status_code=400,
            detail=[
                errors.ApiExc(
                    code="team_not_found",
                    msg=f"Team not found for players [{player_names_str}] in tournament {self.tournament.name}",
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
        logger.info(f"Home team name: {home_team_name}, away team name: {away_team_name}")

        players_by_team_log_name = await self.get_players_by_battle_names(session)
        logger.debug(f"Players from log: {players_by_team_log_name}")

        home_players_list = players_by_team_log_name.get(home_team_name, [])
        away_players_list = players_by_team_log_name.get(away_team_name, [])

        if not home_players_list:
            logger.warning(f"No players found in log for declared home team: {home_team_name}")
        if not away_players_list:
            logger.warning(f"No players found in log for declared away team: {away_team_name}")

        home_team_db = await self.find_team_by_players(session, home_players_list)
        away_team_db = await self.find_team_by_players(session, away_players_list)

        return (home_team_db, home_players_list), (
            away_team_db,
            away_players_list,
        )

    @staticmethod
    async def get_players_by_team_and_battle_name(
        session: AsyncSession,
        team: models.Team,
        players_from_log: list[tuple[str, models.User | None]],
        provider: str,
    ) -> list[tuple[str, LogPlayer | None]]:
        # Resolve all roster players for the team in a single query instead of
        # one (or two) SELECTs per log name (review L14).
        battle_names = [battle_name_log for battle_name_log, _ in players_from_log]
        players_by_name = {
            name: LogPlayer.from_roster(player)
            for name, player in (
                await service.get_players_by_team_and_battle_names(session, team, battle_names, provider=provider)
            ).items()
        }

        players_out: list[tuple[str, LogPlayer | None]] = []
        for battle_name_log, _ in players_from_log:
            resolved_player_in_team = players_by_name.get(battle_name_log)
            players_out.append((battle_name_log, resolved_player_in_team))

            if resolved_player_in_team:
                logger.debug(
                    f"Player [user_id={resolved_player_in_team.user_id} name={resolved_player_in_team.name}] "
                    f"found for battle name '{battle_name_log}' in team '{team.name}'"
                )
            else:
                logger.warning(f"Player object not found for battle name '{battle_name_log}' in team '{team.name}'")
        return players_out

    async def process_kills(
        self,
        match: models.StatsMatch,
        players_map: dict[str, LogPlayer],
    ) -> list[models.StatsEvent]:
        kills = []
        for row in (
            self._get_rows(enums.LogEventType.Kill).sort_values(by="time", kind="stable").itertuples(index=False)
        ):
            kill = KillEvent.from_data(row.data)
            attacker, victim = players_map[kill.attacker], players_map[kill.victim]
            kills.append(
                models.StatsEvent(
                    match_id=match.id,
                    t=float(row.time),
                    segment=int(row.round_number),
                    type_id=self.event_type_ids["kill"],
                    actor_member_id=self.member_by_user[attacker.user_id],
                    actor_team_id=self.participant_by_team[attacker.team_id],
                    target_member_id=self.member_by_user[victim.user_id],
                    target_team_id=self.participant_by_team[victim.team_id],
                    entity_id=self.get_hero(kill.attacker_hero).id,
                    related_entity_id=self.get_hero(kill.victim_hero).id,
                    entity_kind="character",
                    data={
                        "fight": 0,
                        "ability": kill.ability.value if kill.ability is not None else None,
                        "damage": kill.damage,
                        "is_critical_hit": kill.is_critical_hit,
                        "is_environmental": kill.is_environmental,
                    },
                )
            )
        impact.assign_fights(kills)
        return kills

    def _format_match_event_generic(
        self,
        match: models.StatsMatch,
        players_map: dict[str, LogPlayer],
        time: float,
        round_number: int,
        data: list[str],
        event_name_enum: enums.MatchEvent,
    ) -> dict:
        event = MatchEventRow.from_data(data, event_name_enum)
        actor = players_map[event.player]
        target = players_map[event.related_player] if event.related_player else None
        return {
            "match_id": match.id,
            "t": float(time),
            "segment": int(round_number),
            "type_id": self.event_type_ids[event_name_enum.value],
            "actor_member_id": self.member_by_user[actor.user_id],
            "actor_team_id": self.participant_by_team[actor.team_id],
            "target_member_id": self.member_by_user[target.user_id] if target else None,
            "target_team_id": self.participant_by_team[target.team_id] if target else None,
            "entity_id": self.get_hero(event.hero).id if event.hero else None,
            "related_entity_id": self.get_hero(event.related_hero).id if event.related_hero else None,
            "data": None,
        }

    async def process_events(
        self,
        session: AsyncSession,
        match: models.StatsMatch,
        players_map: dict[str, LogPlayer],
    ) -> list[dict]:
        event_types = {enums.LogEventType[name.name]: name for name in enums.MatchEvent}
        return [
            self._format_match_event_generic(
                match,
                players_map,
                row.time,
                row.round_number,
                row.data,
                event_types[row.event_type],
            )
            for row in self.df.itertuples(index=False)
            if row.event_type in event_types
        ]

    def _create_stat_object(
        self,
        match: models.StatsMatch,
        name: enums.LogStatsName,
        player: LogPlayer,
        match_round: int,
        hero_id: int | None,
        value: float,
    ) -> dict:
        return {
            "match_id": match.id,
            "segment": int(match_round),
            "encounter_team_id": self.participant_by_team[player.team_id],
            "workspace_member_id": self.member_by_user[player.user_id],
            "entity_id": int(hero_id) if hero_id is not None else None,
            "stat_id": self.stat_ids[name.value],
            "value": float(value),
        }

    async def _get_player_stat_base_df(self, players_map: dict[str, LogPlayer]) -> pd.DataFrame:
        player_stat_events = self._get_rows(enums.LogEventType.PlayerStat)
        if player_stat_events.empty:
            return pd.DataFrame()

        stat_records = []
        for row in player_stat_events.itertuples(index=False):
            stat_row = PlayerStatRow.from_data(row.data)
            player_model = players_map[stat_row.player]
            hero_model = self.get_hero(stat_row.hero)

            current_round = int(row.round_number)

            for stat_name_enum, value in stat_row.stat_values.items():
                stat_records.append(
                    {
                        "player_log_name": stat_row.player,
                        "player_id": player_model.user_id,
                        "player_model": player_model,
                        "hero_id": hero_model.id,
                        "hero_class": enums.HeroClass[hero_model.attrs["class"]],
                        "round": current_round,
                        "stat_name": stat_name_enum,
                        "value": value,
                    }
                )

        return pd.DataFrame(stat_records)

    def _calculate_and_add_derived_stats(
        self,
        match: models.StatsMatch,
        df: pd.DataFrame,
        is_mvp_calc: bool = False,
        impact_ctx: impact.ImpactContext | None = None,
    ):
        required_cols = [
            enums.LogStatsName.Eliminations,
            enums.LogStatsName.Deaths,
            enums.LogStatsName.OffensiveAssists,
            enums.LogStatsName.DefensiveAssists,
            enums.LogStatsName.HeroDamageDealt,
            enums.LogStatsName.DamageTaken,
            enums.LogStatsName.FinalBlows,
            enums.LogStatsName.DamageBlocked,
            enums.LogStatsName.HealingDealt,
        ]
        temp_derived_stats = []
        for stat_col in required_cols:
            if stat_col not in df.columns:
                df[stat_col] = 0.0

        df["KD"] = df[enums.LogStatsName.Eliminations] / df[enums.LogStatsName.Deaths].replace(0, 1)
        df["Assists"] = df[enums.LogStatsName.OffensiveAssists] + df[enums.LogStatsName.DefensiveAssists]
        df["KDA"] = (df[enums.LogStatsName.Eliminations] + df["Assists"]) / df[enums.LogStatsName.Deaths].replace(0, 1)
        df["DamageDelta"] = df[enums.LogStatsName.HeroDamageDealt] - df[enums.LogStatsName.DamageTaken]
        df["FBE"] = df[enums.LogStatsName.FinalBlows] / df[enums.LogStatsName.Eliminations].replace(0, 1)
        df["DamageFB"] = df[enums.LogStatsName.HeroDamageDealt] / df[enums.LogStatsName.FinalBlows].replace(0, 1)

        derived_stat_names = {
            "KD": enums.LogStatsName.KD,
            "KDA": enums.LogStatsName.KDA,
            "DamageDelta": enums.LogStatsName.DamageDelta,
            "FBE": enums.LogStatsName.FBE,
            "DamageFB": enums.LogStatsName.DamageFB,
            "Assists": enums.LogStatsName.Assists,
        }
        for col_name, stat_enum in derived_stat_names.items():
            records = df[["player_model", "round", "hero_id", col_name]].to_dict(orient="records")
            temp_derived_stats.extend(
                self._create_stat_object(match, stat_enum, r["player_model"], r["round"], r.get("hero_id"), r[col_name])
                for r in records
            )

        if is_mvp_calc:
            df["PerformancePoints"] = (
                df[enums.LogStatsName.Eliminations] * 500
                + df[enums.LogStatsName.FinalBlows] * 250
                + df["Assists"] * 50
                + df[enums.LogStatsName.HeroDamageDealt]
                + df[enums.LogStatsName.HealingDealt] * 1
                - df[enums.LogStatsName.Deaths] * 750
                + df[enums.LogStatsName.DamageBlocked] * 0.1
            )

            perf_records = df[["player_model", "round", "hero_id", "PerformancePoints"]].to_dict(orient="records")
            temp_derived_stats.extend(
                self._create_stat_object(
                    match,
                    enums.LogStatsName.PerformancePoints,
                    r["player_model"],
                    r["round"],
                    r.get("hero_id"),
                    r["PerformancePoints"],
                )
                for r in perf_records
            )

            df_perf_rank = df.sort_values(by=["round", "PerformancePoints"], ascending=[True, False])
            df_perf_rank["Performance"] = df_perf_rank.groupby("round").cumcount() + 1

            rank_records = df_perf_rank[["player_model", "round", "hero_id", "Performance"]].to_dict(orient="records")
            temp_derived_stats.extend(
                self._create_stat_object(
                    match,
                    enums.LogStatsName.Performance,
                    r["player_model"],
                    r["round"],
                    r.get("hero_id"),
                    r["Performance"],
                )
                for r in rank_records
            )

            if impact_ctx is not None and impact_ctx.baselines is not None:
                df = impact.add_impact_scores(
                    df,
                    players=impact_ctx.players,
                    baselines=impact_ctx.baselines,
                    has_killfeed=impact_ctx.has_killfeed,
                )
                for stat_member in (
                    enums.LogStatsName.ImpactPoints,
                    enums.LogStatsName.OverperformanceScore,
                ):
                    impact_records = df[["player_model", "round", "hero_id", stat_member]].to_dict(orient="records")
                    temp_derived_stats.extend(
                        self._create_stat_object(
                            match, stat_member, r["player_model"], r["round"], r.get("hero_id"), r[stat_member]
                        )
                        for r in impact_records
                    )

                df_impact_rank = df.sort_values(by=["round", enums.LogStatsName.ImpactPoints], ascending=[True, False])
                df_impact_rank["_impact_rank"] = df_impact_rank.groupby("round").cumcount() + 1
                impact_rank_records = df_impact_rank[["player_model", "round", "hero_id", "_impact_rank"]].to_dict(
                    orient="records"
                )
                temp_derived_stats.extend(
                    self._create_stat_object(
                        match,
                        enums.LogStatsName.ImpactRank,
                        r["player_model"],
                        r["round"],
                        r.get("hero_id"),
                        r["_impact_rank"],
                    )
                    for r in impact_rank_records
                )
            elif impact_ctx is not None:
                logger.warning(
                    f"Impact baselines missing for match {match.id} — skipping impact stats "
                    f"({enums.LogStatsName.ImpactPoints.value})"
                )

        return temp_derived_stats

    async def create_stats(
        self,
        session: AsyncSession,
        match: models.StatsMatch,
        players_map: dict[str, LogPlayer],
        kill_feed: list[models.StatsEvent] | None = None,
    ) -> list[dict]:
        cumulative_stats_df = await self._get_player_stat_base_df(players_map)
        if cumulative_stats_df.empty:
            logger.info(f"No PlayerStat events found for match {match.id}. Skipping stat creation.")
            return []

        player_id_to_model_map = (
            cumulative_stats_df.drop_duplicates(subset=["player_id"]).set_index("player_id")["player_model"].to_dict()
        )

        cumulative_stats_df = cumulative_stats_df.sort_values(by=["player_id", "hero_id", "stat_name", "round"])

        cumulative_stats_df["discrete_value"] = (
            cumulative_stats_df.groupby(["player_id", "hero_id", "stat_name"])["value"]
            .diff()
            .fillna(cumulative_stats_df["value"])
        )

        all_stat_objects: list[dict] = []

        discrete_per_hero_df = cumulative_stats_df[cumulative_stats_df["round"] > 0].copy()
        records_per_hero = discrete_per_hero_df[
            ["stat_name", "player_model", "round", "hero_id", "discrete_value"]
        ].to_dict(orient="records")
        for r in records_per_hero:
            all_stat_objects.append(
                self._create_stat_object(
                    match, r["stat_name"], r["player_model"], r["round"], r["hero_id"], r["discrete_value"]
                )
            )

        discrete_all_heroes_per_round_df = discrete_per_hero_df.groupby(
            ["player_id", "round", "stat_name"], as_index=False
        )["discrete_value"].sum()

        records_all_heroes = discrete_all_heroes_per_round_df[
            ["player_id", "stat_name", "round", "discrete_value"]
        ].to_dict(orient="records")
        for r in records_all_heroes:
            player_model = player_id_to_model_map[r["player_id"]]
            all_stat_objects.append(
                self._create_stat_object(match, r["stat_name"], player_model, r["round"], None, r["discrete_value"])
            )

        max_round = cumulative_stats_df["round"].max()
        final_cumulative_df = cumulative_stats_df[cumulative_stats_df["round"] == max_round].copy()

        records_final_cumulative = final_cumulative_df[["stat_name", "player_model", "hero_id", "value"]].to_dict(
            orient="records"
        )
        for r in records_final_cumulative:
            all_stat_objects.append(
                self._create_stat_object(match, r["stat_name"], r["player_model"], 0, r["hero_id"], r["value"])
            )

        final_all_heroes_df = final_cumulative_df.groupby(["player_id", "stat_name"], as_index=False)["value"].sum()

        records_final_all_heroes = final_all_heroes_df[["player_id", "stat_name", "value"]].to_dict(orient="records")
        for r in records_final_all_heroes:
            player_model = player_id_to_model_map[r["player_id"]]
            all_stat_objects.append(self._create_stat_object(match, r["stat_name"], player_model, 0, None, r["value"]))

        hero_derived_df = discrete_per_hero_df.pivot_table(
            index=["player_id", "round", "hero_id"], columns="stat_name", values="discrete_value", fill_value=0
        ).reset_index()

        round_derived_df = discrete_all_heroes_per_round_df.pivot_table(
            index=["player_id", "round"], columns="stat_name", values="discrete_value", fill_value=0
        ).reset_index()
        round_derived_df["hero_id"] = None

        match_hero_derived_df = final_cumulative_df.pivot_table(
            index=["player_id", "hero_id"], columns="stat_name", values="value", fill_value=0
        ).reset_index()
        match_hero_derived_df["round"] = 0

        match_derived_df = final_all_heroes_df.pivot_table(
            index=["player_id"], columns="stat_name", values="value", fill_value=0
        ).reset_index()
        match_derived_df["round"] = 0
        match_derived_df["hero_id"] = None

        for df in [hero_derived_df, round_derived_df, match_hero_derived_df, match_derived_df]:
            df["player_model"] = df["player_id"].map(player_id_to_model_map)

        # --- MVP impact scoring inputs (spec 2026-07-10) --------------------
        # Event counts cross into pure OW math as global user ids;
        # persistence keeps native member/participant identities.
        hero_types = {h.id: enums.HeroClass[h.attrs["class"]] for h in self.heroes_map.values()}
        user_to_player = {p.user_id: p for p in players_map.values()}
        has_killfeed = bool(kill_feed)

        events_df = impact.build_event_counts(
            kill_feed or [],
            hero_types,
            member_user_ids={member: user for user, member in self.member_by_user.items()},
        )
        if not events_df.empty:
            events_df = events_df[events_df["user_id"].isin(user_to_player)].assign(
                player_id=lambda df_: df_["user_id"]
            )
            # Round 0 is the synthetic match-total sentinel in the pivots; the
            # per-round pivot only holds round > 0, and the match total is the
            # sum across those real rounds (mirrors the stat pipeline).
            events_df = events_df[events_df["round"] > 0]

        if not events_df.empty:
            for stat_name in impact_consts.EVENT_STATS:
                member = enums.LogStatsName[stat_name]
                for r in events_df.itertuples(index=False):
                    all_stat_objects.append(
                        self._create_stat_object(
                            match,
                            member,
                            user_to_player[r.user_id],
                            int(r.round),
                            None,
                            float(getattr(r, stat_name)),
                        )
                    )

            totals = events_df.groupby(["player_id", "user_id"], as_index=False)[list(impact_consts.EVENT_STATS)].sum()
            for stat_name in impact_consts.EVENT_STATS:
                member = enums.LogStatsName[stat_name]
                for r in totals.itertuples(index=False):
                    all_stat_objects.append(
                        self._create_stat_object(
                            match,
                            member,
                            user_to_player[r.user_id],
                            0,
                            None,
                            float(getattr(r, stat_name)),
                        )
                    )

            event_cols = ["player_id", "round", *impact_consts.EVENT_STATS]
            round_derived_df = round_derived_df.merge(
                events_df[event_cols].rename(columns={s: enums.LogStatsName[s] for s in impact_consts.EVENT_STATS}),
                on=["player_id", "round"],
                how="left",
            )
            match_events = totals.assign(round=0)
            match_derived_df = match_derived_df.merge(
                match_events[event_cols].rename(columns={s: enums.LogStatsName[s] for s in impact_consts.EVENT_STATS}),
                on=["player_id", "round"],
                how="left",
            )

        # Ensure every event column exists and is NaN-free on both MVP pivots,
        # so add_impact_scores never sees a NaN (matches with no kill feed hit
        # this path directly).
        for df_ in (round_derived_df, match_derived_df):
            for s in impact_consts.EVENT_STATS:
                member = enums.LogStatsName[s]
                if member not in df_.columns:
                    df_[member] = 0.0
                df_[member] = df_[member].fillna(0.0)

        playtime_df = final_cumulative_df[final_cumulative_df["stat_name"] == enums.LogStatsName.HeroTimePlayed][
            ["player_id", "hero_id", "value"]
        ].rename(columns={"value": "seconds"})
        roles = impact.dominant_roles(playtime_df, hero_types)
        self.observed_roles = roles

        player_refs = {
            p.user_id: impact.PlayerRef(
                player_id=p.user_id,
                user_id=p.user_id,
                team_id=p.team_id,
                role=roles.get(p.user_id) or (enums.HeroClass[p.role] if p.role else None),
                rank=p.rank,
            )
            for p in players_map.values()
        }
        baselines = await baselines_service.get_active(session, discipline=self.job.discipline)
        impact_ctx = impact.ImpactContext(players=player_refs, baselines=baselines, has_killfeed=has_killfeed)

        all_stat_objects.extend(self._calculate_and_add_derived_stats(match, hero_derived_df, is_mvp_calc=False))
        all_stat_objects.extend(
            self._calculate_and_add_derived_stats(match, round_derived_df, is_mvp_calc=True, impact_ctx=impact_ctx)
        )
        all_stat_objects.extend(self._calculate_and_add_derived_stats(match, match_hero_derived_df, is_mvp_calc=False))
        all_stat_objects.extend(
            self._calculate_and_add_derived_stats(match, match_derived_df, is_mvp_calc=True, impact_ctx=impact_ctx)
        )

        return all_stat_objects

    async def start(
        self,
        session: AsyncSession,
        *,
        claimed_attempt: int,
        claimed_started_at: datetime,
    ) -> models.StatsMatch | None:
        await self.validate()
        job = self.job
        self.tournament = await session.get(models.Tournament, job.hint_tournament_id)
        if (
            self.tournament is None
            or self.tournament.workspace_id != job.workspace_id
            or self.tournament.discipline != job.discipline
            or job.discipline != "overwatch"
        ):
            raise errors.ApiHTTPException(
                status_code=422,
                detail=[errors.ApiExc(code="invalid_log_owner", msg="Workshop job has no valid Overwatch tournament")],
            )
        resolved = await self.find_teams_by_players(session)
        home, away = resolved[0][0], resolved[1][0]
        match_map = await self.get_map(session)
        pools = await _pick_ban_config_repo.list_by_tournament(
            session,
            self.tournament.id,
            kind=enums.PickBanKind.MAP,
            options=CONFIG_POOL_LOAD,
        )
        bound = await encounter_flows.resolve_for_log(
            session,
            (home.id, away.id),
            job=job,
            map_id=match_map.id,
            map_pools=pools,
        )
        if bound is None:
            return None
        encounter, game, self.participations = bound
        # Parent-first ordering matches encounter deletion/score resolution.
        # Raw download and team discovery do not hold a job lock while waiting
        # for a parent owned by another transaction.
        job = await _job_repo.get_for_update(session, job.id, workspace_id=job.workspace_id)
        if (
            job is None
            or job.status != models.IngestJobStatus.PROCESSING
            or job.attempts != claimed_attempt
            or job.started_at != claimed_started_at
        ):
            raise RuntimeError("Ingest claim was superseded before observations were written")
        self.job = job
        linked = await reparse_observation(session, job)
        if linked is not None and (linked.encounter_id, linked.encounter_game_id) != (encounter.id, game.id):
            raise ValueError("A historical observation cannot move to another encounter or game")
        await self._validate_map_pool(session, encounter, match_map, pools)
        await self._preload_data(session)
        self.stat_ids = await StatDefRepository().ids(session, discipline=job.discipline)
        self.event_type_ids = await EventTypeRepository().ids(session, discipline=job.discipline)
        if ({stat.value for stat in enums.LogStatsName} | {"score"}) - self.stat_ids.keys():
            raise errors.ApiHTTPException(
                status_code=422,
                detail=[errors.ApiExc(code="stat_not_found", msg="Discipline statistic vocabulary is incomplete")],
            )
        if ({"kill"} | {event.value for event in enums.MatchEvent}) - self.event_type_ids.keys():
            raise errors.ApiHTTPException(
                status_code=422,
                detail=[errors.ApiExc(code="event_type_not_found", msg="Discipline event vocabulary is incomplete")],
            )
        home_result, away_result = await self.process_teams(session, resolved, encounter)
        players_map = {**home_result[1], **away_result[1]}
        users = {player.user_id for player in players_map.values()}
        self.member_by_user = dict(
            (
                await session.execute(
                    sa.select(
                        models.WorkspaceMember.player_id,
                        models.WorkspaceMember.id,
                    ).where(
                        models.WorkspaceMember.workspace_id == job.workspace_id,
                        models.WorkspaceMember.player_id.in_(users),
                    )
                )
            ).all()
        )
        if self.member_by_user.keys() != users:
            raise ValueError("Every observed player must be a member of the job workspace")
        self.participant_by_team = {team.team_id: team.id for team in self.participations}
        duration, home_score, away_score = self.get_match_score_and_time()
        match = await _match_repo.get_for_game(
            session,
            encounter_game_id=game.id,
            workspace_id=job.workspace_id,
            discipline=job.discipline,
            for_update=True,
        )
        if match is not None and match.ingest_job_id != job.id:
            previous_job = await session.get(models.IngestJob, match.ingest_job_id) if match.ingest_job_id else None
            if (
                previous_job is None
                or previous_job.source_kind == "historical_reference"
                or (previous_job.external_id or "").startswith("legacy:")
            ):
                raise ValueError("Another source cannot overwrite a historical observation")
            await reparse_observation(session, previous_job)
        created = match is None
        match_id = (
            await session.scalar(sa.text("SELECT nextval(pg_get_serial_sequence('stats.match', 'id'))"))
            if created
            else match.id
        )
        scopes = owner_scopes("match", (match_id,))
        before = await capture_stats_evidence(session, scopes=scopes)
        if created:
            match = models.StatsMatch(
                id=match_id,
                workspace_id=job.workspace_id,
                discipline=job.discipline,
                encounter_id=encounter.id,
                encounter_game_id=game.id,
                map_entity_id=match_map.id,
                map_kind="map",
                revision=1,
            )
            session.add(match)
        match.ingest_job_id = job.id
        match.duration_s = duration
        await session.flush()
        kills = await self.process_kills(match, players_map)
        events = await self.process_events(session, match, players_map)
        facts = await self.create_stats(session, match, players_map, kill_feed=kills)
        facts.extend(
            {
                "match_id": match.id,
                "segment": 0,
                "encounter_team_id": self.participant_by_team[team.id],
                "workspace_member_id": None,
                "entity_id": None,
                "stat_id": self.stat_ids["score"],
                "value": float(score),
            }
            for team, score in ((home, home_score), (away, away_score))
        )
        roles = await CatalogRoleRepository().rated_rows(session, discipline=job.discipline, workspace_id=None)
        player_rows = []
        seen = set()
        for handle, player in players_map.items():
            member = self.member_by_user[player.user_id]
            if member in seen:
                raise ValueError("A player has multiple observed handles or teams in the same log")
            seen.add(member)
            role = self.observed_roles.get(player.user_id)
            if role is not None and role.slot_code not in roles:
                raise ValueError("Observed role does not resolve in the discipline")
            player_rows.append(
                {
                    "match_id": match.id,
                    "workspace_member_id": member,
                    "encounter_team_id": self.participant_by_team[player.team_id],
                    "handle_snapshot": handle,
                    "observed_role_id": roles[role.slot_code].id if role is not None else None,
                }
            )
        events = [_event_row(kill) for kill in kills] + events
        segments = sorted({row["segment"] for row in facts + events if row["segment"] > 0})
        await _match_repo.replace_observations(
            session,
            match=match,
            teams=[
                {
                    "match_id": match.id,
                    "encounter_id": encounter.id,
                    "encounter_team_id": self.participant_by_team[team.id],
                    "source_position": position,
                }
                for position, team in enumerate((home, away), 1)
            ],
            players=player_rows,
            segments=[{"match_id": match.id, "segment": number, "kind": "round"} for number in segments],
            facts=facts,
            events=events,
        )
        if not created:
            match.revision += 1
        match.updated_at = datetime.now(UTC)
        await session.flush()
        after = await capture_stats_evidence(session, scopes=scopes)
        await stage_stats_evidence(
            session,
            operation="stats.reparse",
            before=before,
            after=after,
            workspace_id=job.workspace_id,
            entity_type="stats_match",
            entity_id=match.id,
        )
        await resolve_encounter_maps(session, encounter.id)
        await _enqueue_match_log_tournament_events(session, encounter)
        await enqueue_outbox_event(
            session,
            AchievementEvaluateEvent(
                workspace_id=job.workspace_id,
                tournament_id=self.tournament.id,
                changed_tables=["stats.match", "stats.fact", "stats.event"],
                source_service="parser-service",
            ),
            exchange="",
            routing_key=ACHIEVEMENT_EVALUATE_QUEUE.name,
        )
        return match

    async def add_substitution(
        self,
        session: AsyncSession,
        participation: models.EncounterTeam,
        player_to_be_replaced: LogPlayer,
        sub_user: models.User,
    ) -> LogPlayer:
        """Seat a player the log shows but the roster lacks, as a substitute of the encounter (D19).

        The substitute lives in the participation's roster snapshot; the
        tournament's own roster is the organiser's and is left alone.
        """
        logger.info(
            f"Adding substitution: user {sub_user.name} for player {player_to_be_replaced.name} "
            f"in team {participation.name}"
        )

        known_profiles = await team_service.get_player_by_user_and_role(
            session, sub_user.id, player_to_be_replaced.role, [], discipline=self.tournament.discipline
        )
        profile = max(known_profiles, key=lambda p: p.tournament_id or 0, default=None)
        rank = profile.rank if profile else player_to_be_replaced.rank
        role = player_to_be_replaced.role
        roles = (
            ((discipline(self.tournament.discipline).rated_dimension.code, player_to_be_replaced.sub_role or role),)
            if role
            else ()
        )

        member_id = await session.scalar(
            sa.select(models.WorkspaceMember.id).where(
                models.WorkspaceMember.workspace_id == self.job.workspace_id,
                models.WorkspaceMember.player_id == sub_user.id,
            )
        )
        if member_id is None:
            raise ValueError("A substitute must already belong to the job workspace")
        await add_substitute(
            session,
            participation,
            MemberSnapshot(
                workspace_member_id=member_id,
                display_name=sub_user.name,
                rank=rank,
                is_substitute=True,
                roles=roles,
            ),
        )
        return LogPlayer(
            user_id=sub_user.id,
            team_id=participation.team_id,
            name=sub_user.name,
            role=role,
            rank=rank,
            sub_role=player_to_be_replaced.sub_role,
        )

    async def fix_team_players_collision(
        self,
        session: AsyncSession,
        team_db: models.Team,
        participation: models.EncounterTeam,
        players_found_in_roster_map: dict[str, LogPlayer],
        all_players_from_log_for_team: list[tuple[str, models.User | None]],
    ) -> tuple[models.Team, dict[str, LogPlayer]]:
        final_players_map = players_found_in_roster_map.copy()
        users_who_played_map: dict[str, models.User] = {
            log_name: user for log_name, user in all_players_from_log_for_team if user
        }
        roster_players_not_substituted = [LogPlayer.from_roster(p) for p in team_db.players if not p.is_substitution]
        expected_roster_size = len(roster_players_not_substituted)

        if (
            len(users_who_played_map) > len(players_found_in_roster_map)
            and len(players_found_in_roster_map) < expected_roster_size
        ):
            logger.warning(
                f"Potential substitution for team {team_db.name}. "
                f"Log has {len(users_who_played_map)} users, roster matched {len(players_found_in_roster_map)}."
            )

            roster_player_user_ids_found_in_log = {p.user_id for p in players_found_in_roster_map.values()}
            missing_roster_player: LogPlayer | None = None
            for rp in roster_players_not_substituted:
                if rp.user_id not in roster_player_user_ids_found_in_log:
                    missing_roster_player = rp
                    break

            substitute_user: models.User | None = None
            substitute_log_name: str | None = None
            for log_name, user_model in users_who_played_map.items():
                if user_model.id not in roster_player_user_ids_found_in_log:
                    substitute_user = user_model
                    substitute_log_name = log_name
                    break

            if missing_roster_player and substitute_user and substitute_log_name:
                logger.info(
                    f"Identified substitution: {substitute_user.name} "
                    f"(log: {substitute_log_name}) for {missing_roster_player.name} in team {team_db.name}."
                )
                existing_sub = await service.get_substitute(session, participation.id, substitute_user.id)
                if existing_sub is not None:
                    logger.info(f"Existing substitution record found for {substitute_user.name}.")
                    final_players_map[substitute_log_name] = LogPlayer(
                        user_id=substitute_user.id,
                        team_id=team_db.id,
                        name=substitute_user.name,
                        role=missing_roster_player.role,
                        sub_role=missing_roster_player.sub_role,
                        rank=missing_roster_player.rank if existing_sub.rank is None else existing_sub.rank,
                    )
                else:
                    final_players_map[substitute_log_name] = await self.add_substitution(
                        session, participation, missing_roster_player, substitute_user
                    )
            else:
                logger.warning(f"Could not fully resolve substitution for team {team_db.name}.")

        unmatched_log_names: list[str] = [
            log_name
            for log_name, user in all_players_from_log_for_team
            if not user and log_name not in final_players_map
        ]

        if len(final_players_map) < expected_roster_size and len(unmatched_log_names) > 0:
            logger.warning(
                f"Potential battle_name change for team {team_db.name}. "
                f"Matched {len(final_players_map)}, expected {expected_roster_size}, "
                f"unmatched log names: {unmatched_log_names}."
            )

            roster_players_in_log_user_ids = {p.user_id for p in final_players_map.values()}
            missing_roster_players_from_log = [
                rp for rp in roster_players_not_substituted if rp.user_id not in roster_players_in_log_user_ids
            ]

            if len(missing_roster_players_from_log) == 1 and len(unmatched_log_names) == 1:
                player_who_changed_name = missing_roster_players_from_log[0]
                new_battle_name_from_log = unmatched_log_names[0]
                logger.info(
                    f"Player {player_who_changed_name.name} "
                    f"(User ID: {player_who_changed_name.user_id}) "
                    f"likely changed battle_name to '{new_battle_name_from_log}'."
                )

                user_to_update = await _user_repo.get(session, player_who_changed_name.user_id)

                if user_to_update:
                    await social_identity_service.upsert(
                        session,
                        user_id=user_to_update.id,
                        provider=self.identity_provider,
                        username=f"{new_battle_name_from_log}#0000",
                    )
                    await session.flush()
                    logger.info(
                        f"Associated new battle_name '{new_battle_name_from_log}' with User ID {user_to_update.id}."
                    )
                    final_players_map[new_battle_name_from_log] = player_who_changed_name
                else:
                    logger.error(
                        f"Could not find user for player {player_who_changed_name.name} to update battle_name."
                    )
            else:
                logger.warning(
                    f"Ambiguous situation for battle_name change in team {team_db.name}. "
                    f"Could not resolve automatically."
                )

        for handle, user in all_players_from_log_for_team:
            if handle in final_players_map:
                continue
            if user is None:
                raise ValueError(f"Unresolved participant {handle!r}; no observation was written")
            # An event-only endpoint need not displace a roster starter. Keep
            # its real identity without inventing a rated role or roster change.
            final_players_map[handle] = LogPlayer(
                user_id=user.id,
                team_id=team_db.id,
                name=user.name,
                role=None,
                rank=0,
            )
        if any(player.team_id != team_db.id for player in final_players_map.values()):
            raise ValueError("Participant belongs to the wrong team")
        return team_db, final_players_map

    async def process_teams(
        self,
        session: AsyncSession,
        resolved_teams: tuple[
            tuple[models.Team, list[tuple[str, models.User | None]]],
            tuple[models.Team, list[tuple[str, models.User | None]]],
        ],
        encounter: models.Encounter,
    ) -> tuple[
        tuple[models.Team, dict[str, LogPlayer]],
        tuple[models.Team, dict[str, LogPlayer]],
    ]:
        seats = {seat.team_id: seat for seat in self.participations}
        resolved = []
        for team_db, players_from_log_tuples in resolved_teams:
            roster_map_initial = {
                log_name: player_obj
                for log_name, player_obj in await self.get_players_by_team_and_battle_name(
                    session, team_db, players_from_log_tuples, self.identity_provider
                )
                if player_obj
            }
            resolved.append(
                await self.fix_team_players_collision(
                    session, team_db, seats[team_db.id], roster_map_initial, players_from_log_tuples
                )
            )
        return resolved[0], resolved[1]


async def process_match_log(
    session: AsyncSession,
    job_id: int,
    s3: S3Client,
    *,
    is_raise: bool = True,
) -> models.IngestJobStatus:
    workspace_id = await session.scalar(sa.select(models.IngestJob.workspace_id).where(models.IngestJob.id == job_id))
    if workspace_id is None:
        raise errors.ApiHTTPException(
            status_code=404, detail=[errors.ApiExc(code="not_found", msg="Ingest job not found")]
        )
    job = await _job_repo.get_for_update(session, job_id, workspace_id=workspace_id)
    if job is None:
        raise errors.ApiHTTPException(
            status_code=404, detail=[errors.ApiExc(code="not_found", msg="Ingest job not found")]
        )
    terminal = {models.IngestJobStatus.DONE, models.IngestJobStatus.FAILED, models.IngestJobStatus.AWAITING_LINK}
    if job.status in terminal:
        status = job.status
        await session.commit()
        return status
    if job.status == models.IngestJobStatus.PROCESSING:
        # This delivery did not create the active claim and cannot borrow it.
        await session.rollback()
        return models.IngestJobStatus.PROCESSING
    await log_records_service.transition(session, job, models.IngestJobStatus.PROCESSING)
    attempt, started_at = job.attempts, job.started_at
    await session.commit()
    processor = None
    try:
        await reparse_observation(session, job)
        raw = await binary_match_logs.get_log(s3, job)
        if not raw:
            raise errors.ApiHTTPException(
                status_code=404, detail=[errors.ApiExc(code="log_not_found", msg="Raw log is missing or empty")]
            )
        oversize = match_log_oversize_message(len(raw), settings.max_match_log_bytes, filename=job.filename)
        if oversize:
            raise errors.ApiHTTPException(
                status_code=413, detail=[errors.ApiExc(code="match_log_too_large", msg=oversize)]
            )
        if await asyncio.to_thread(compute_content_hash, raw) != job.content_hash.lower():
            raise ValueError("Stored raw bytes do not agree with the ingest job content hash")
        processor = await asyncio.to_thread(_processor_from_bytes, job, raw)
        match = await processor.start(session, claimed_attempt=attempt, claimed_started_at=started_at)
        job = await _job_repo.get_for_update(session, job_id, workspace_id=workspace_id)
        if (
            job is None
            or job.status != models.IngestJobStatus.PROCESSING
            or job.attempts != attempt
            or job.started_at != started_at
        ):
            raise RuntimeError("Ingest claim was superseded before completion")
        status = models.IngestJobStatus.DONE if match is not None else models.IngestJobStatus.AWAITING_LINK
        await log_records_service.transition(
            session,
            job,
            status,
            error_message=None
            if match is not None
            else "No unique matching live game; an administrator must link the log and retry",
        )
        await session.commit()
        return status
    except Exception as exc:
        await session.rollback()
        if processor is not None:
            for kind, names in {**processor.map_misses, "character": processor.hero_misses}.items():
                await catalog_aliases.record_misses(kind, names, ingest_job_id=job_id)
        job = await _job_repo.get_for_update(session, job_id, workspace_id=workspace_id)
        if (
            job is not None
            and job.status == models.IngestJobStatus.PROCESSING
            and job.attempts == attempt
            and job.started_at == started_at
        ):
            await log_records_service.transition(session, job, models.IngestJobStatus.FAILED, error_message=str(exc))
            await session.commit()
        elif job is not None and job.status in terminal:
            status = job.status
            await session.commit()
            return status
        else:
            await session.rollback()
            raise
        if is_raise:
            raise
        return models.IngestJobStatus.FAILED
