from __future__ import annotations

import asyncio
from collections.abc import Sequence
from datetime import UTC, datetime

import sqlalchemy as sa
from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession

from shared.clients.s3 import S3Client
from shared.disciplines import DISCIPLINES, INGESTORS, discipline, identity_provider
from shared.disciplines.ingest import BoundMatch, BoundParticipant
from shared.domain.pick_ban_config import pool_allows
from shared.messaging.config import ACHIEVEMENT_EVALUATE_QUEUE, TOURNAMENT_EVENTS_EXCHANGE
from shared.messaging.outbox import enqueue_outbox_event
from shared.models.tournament.pick_ban import PickBanConfig
from shared.repository.identity import UserRepository
from shared.repository.pick_ban import CONFIG_POOL_LOAD, PickBanConfigRepository
from shared.repository.stats import IngestJobRepository, StatsMatchRepository
from shared.schemas.events import AchievementEvaluateEvent, TournamentStandingsInvalidatedEvent
from shared.schemas.match_doc import MatchDoc, MatchHint, MatchSource
from shared.services.decode_context import load_decode_context
from shared.services.encounter.events import enqueue_encounter_completed
from shared.services.encounter.participants import MemberSnapshot, add_substitute
from shared.services.realtime import Resource, Scope, emit, enqueue_invalidation_outbox
from shared.services.social_identity import social_identity_service
from shared.services.stats_evidence import capture_stats_evidence, owner_scopes, stage_stats_evidence
from src import models
from src.core import enums, errors
from src.core.config import settings
from src.services import catalog_aliases
from src.services.encounter import flows as encounter_flows
from src.services.encounter import service as encounter_service
from src.services.ingest import ValidatedDocument, validate_document
from src.services.match_logs.binary import binary_match_logs
from src.services.match_logs.limits import match_log_oversize_message
from src.services.match_logs.log_records import compute_content_hash, log_records_service, reparse_observation
from src.services.match_logs.objectiveless import resolve_encounter_maps
from src.services.match_logs.roster import LogPlayer
from src.services.team import service as team_service

from . import service


async def _decode(session: AsyncSession, job: models.IngestJob, raw: bytes) -> MatchDoc:
    """Raw bytes of a job without a document -> the module decoder's canonical document, off the event loop."""
    decoder = INGESTORS.get((job.discipline, job.source_kind))
    if decoder is None:
        raise ValueError(f"unsupported_ingestor: no decoder for {job.discipline}/{job.source_kind}")
    hint = MatchHint(
        tournament_id=job.hint_tournament_id,
        encounter_id=job.hint_encounter_id,
        encounter_game_id=job.hint_encounter_game_id,
    )
    ctx = await load_decode_context(
        session,
        discipline=job.discipline,
        source=MatchSource(kind=job.source_kind, external_id=job.external_id),
        hint=hint if hint.model_dump(exclude_none=True) else None,
        received_at=job.created_at,
    )
    return await asyncio.to_thread(decoder, raw, ctx)


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
    """Binds one decoded document to the encounter the P4 roster rules find, then writes its observations.

    The document comes from the module's decoder (``shared.disciplines.INGESTORS``); parsing and every formula live
    there. Task 4 replaces this binding and write path with the generic binder and writer.
    """

    def __init__(self, job: models.IngestJob, doc: MatchDoc):
        self.job = job
        self.doc = doc
        self.identity_provider = identity_provider(job.discipline)
        self.filename = job.filename
        self.member_by_user: dict[int, int] = {}
        self.participant_by_team: dict[int, int] = {}

    def get_team_names(self) -> tuple[str, str]:
        """The document's two team keys, original home first."""
        home, away = (team.key for team in self.doc.teams)
        return home, away

    def get_teams_raw(self) -> dict[str, list[str]]:
        """Each team key with the handles its participants play under, in document order."""
        teams: dict[str, list[str]] = {key: [] for key in self.get_team_names()}
        for person in self.doc.participants:
            teams[person.team].append(person.identity.id)
        return teams

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

    async def _derive(
        self,
        session: AsyncSession,
        validated: ValidatedDocument,
        players_map: dict[str, LogPlayer],
        encounter: models.Encounter,
        game: models.EncounterGame,
    ) -> ValidatedDocument:
        """The module's baseline/rank-dependent facts for the bound match, validated like any document."""
        derive = DISCIPLINES[self.job.discipline].derive_match
        if derive is None:
            return validated
        bound = BoundMatch(
            workspace_id=self.job.workspace_id,
            encounter_id=encounter.id,
            encounter_game_id=game.id,
            participants={
                handle: BoundParticipant(
                    member_id=self.member_by_user[player.user_id],
                    user_id=player.user_id,
                    encounter_team_id=self.participant_by_team[player.team_id],
                    rank=player.rank,
                    role=player.role,
                )
                for handle, player in players_map.items()
            },
        )
        derived = await derive(session, validated.doc, bound)
        return await validate_document(session, workspace_id=self.job.workspace_id, doc=derived, producer="decoded")

    async def start(
        self,
        session: AsyncSession,
        *,
        claimed_attempt: int,
        claimed_started_at: datetime,
    ) -> models.StatsMatch | None:
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
        validated = await validate_document(session, workspace_id=job.workspace_id, doc=self.doc, producer="decoded")
        resolved = await self.find_teams_by_players(session)
        home, away = resolved[0][0], resolved[1][0]
        match_map = await session.get(models.CatalogEntity, validated.map_id)
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
        validated = await self._derive(session, validated, players_map, encounter, game)
        document = validated.doc
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
        match.duration_s = document.duration_s
        await session.flush()

        # Document keys are the log's handles; teams are the document's order, original home first.
        seat_of_team = {
            team.key: self.participant_by_team[db_team.id]
            for team, db_team in zip(document.teams, (home, away), strict=True)
        }
        member_of = {handle: self.member_by_user[player.user_id] for handle, player in players_map.items()}
        seat_of = {handle: self.participant_by_team[player.team_id] for handle, player in players_map.items()}
        facts = [
            {
                "match_id": match.id,
                "segment": fact.segment,
                "encounter_team_id": seat_of_team[fact.team] if fact.participant is None else seat_of[fact.participant],
                "workspace_member_id": None if fact.participant is None else member_of[fact.participant],
                "entity_id": None if fact.entity is None else validated.entity_ids[fact.entity],
                "stat_id": validated.stat_ids[fact.stat],
                "value": fact.value,
            }
            for fact in document.facts
        ]
        events = [
            {
                "match_id": match.id,
                "t": event.t,
                "segment": event.segment,
                "type_id": validated.event_type_ids[event.type],
                "actor_member_id": None if event.actor is None else member_of[event.actor],
                "actor_team_id": None if event.actor is None else seat_of[event.actor],
                "target_member_id": None if event.target is None else member_of[event.target],
                "target_team_id": None if event.target is None else seat_of[event.target],
                "entity_id": None if event.entity is None else validated.entity_ids[event.entity],
                "related_entity_id": (
                    None if event.related_entity is None else validated.entity_ids[event.related_entity]
                ),
                "entity_kind": "character",
                "data": event.data or None,
            }
            for event in document.events
        ]
        observed = {person.key: person.role for person in document.participants}
        player_rows = []
        seen = set()
        for handle in players_map:
            member = member_of[handle]
            if member in seen:
                raise ValueError("A player has multiple observed handles or teams in the same log")
            seen.add(member)
            role = observed[handle]
            player_rows.append(
                {
                    "match_id": match.id,
                    "workspace_member_id": member,
                    "encounter_team_id": seat_of[handle],
                    "handle_snapshot": handle,
                    "observed_role_id": None if role is None else validated.role_ids[(role.dimension, role.role)],
                }
            )
        await _match_repo.replace_observations(
            session,
            match=match,
            teams=[
                {
                    "match_id": match.id,
                    "encounter_id": encounter.id,
                    "encounter_team_id": seat_of_team[team.key],
                    "source_position": position,
                }
                for position, team in enumerate(document.teams, 1)
            ],
            players=player_rows,
            segments=[{"match_id": match.id, "segment": s.index, "kind": s.kind} for s in document.segments],
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
        doc = await _decode(session, job, raw)
        match = await MatchLogProcessor(job, doc).start(session, claimed_attempt=attempt, claimed_started_at=started_at)
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
        misses = getattr(exc, "misses", None)
        for kind, names in (misses() if callable(misses) else {}).items():
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
