from __future__ import annotations

from collections.abc import Sequence
from typing import Any

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.strategy_options import _AbstractLoad

from shared import models
from shared.core.enums import HeroClass
from shared.core.utils import join_entity, prepare_entities, selectin_entity
from shared.repository.base import BaseRepository
from shared.repository.identity import UserRepository


class TournamentRepository(BaseRepository[models.Tournament]):
    def __init__(self) -> None:
        super().__init__(models.Tournament)

    async def get_by_name(self, session: AsyncSession, name: str) -> models.Tournament | None:
        return await self.get_by(session, name=name)

    async def get_workspace_id(self, session: AsyncSession, tournament_id: int) -> int | None:
        """The owning workspace, without loading the rest of the row.

        A cheap scalar lookup for the common "does this tournament belong to
        that workspace" check (e.g. the stream-svc repoll ownership guard),
        which never needs anything but this one column.
        """
        return await session.scalar(
            sa.select(models.Tournament.workspace_id).where(models.Tournament.id == tournament_id)
        )

    async def list_by_workspace(
        self,
        session: AsyncSession,
        workspace_id: int,
    ) -> Sequence[models.Tournament]:
        result = await session.execute(
            sa.select(models.Tournament)
            .where(models.Tournament.workspace_id == workspace_id)
            .order_by(models.Tournament.id.desc())
        )
        return result.scalars().all()

    async def list_filtered(
        self,
        session: AsyncSession,
        *,
        is_league: bool | None = None,
        is_finished: bool | None = None,
        workspace_id: int | None = None,
        options: Sequence[_AbstractLoad] | None = None,
    ) -> Sequence[models.Tournament]:
        """Unpaginated tournament list with optional equality filters, in id order.

        Skips ``list()``'s COUNT query -- every current caller here only ever
        wants the rows.
        """
        query = self._apply_options(self.select(), options).order_by(models.Tournament.id.asc())
        if is_league is not None:
            query = query.where(models.Tournament.is_league.is_(is_league))
        if is_finished is not None:
            query = query.where(models.Tournament.is_finished.is_(is_finished))
        if workspace_id is not None:
            query = query.where(models.Tournament.workspace_id == workspace_id)
        result = await session.execute(query)
        return result.unique().scalars().all()


class StageRepository(BaseRepository[models.Stage]):
    def __init__(self) -> None:
        super().__init__(models.Stage)

    async def list_by_tournament(self, session: AsyncSession, tournament_id: int) -> Sequence[models.Stage]:
        result = await session.execute(
            sa.select(models.Stage)
            .where(models.Stage.tournament_id == tournament_id)
            .order_by(models.Stage.order.asc(), models.Stage.id.asc())
        )
        return result.scalars().all()

    async def get_next_order(self, session: AsyncSession, tournament_id: int) -> int:
        """Highest existing stage order in this tournament, plus one (0 if none exist)."""
        result = await session.execute(
            sa.select(sa.func.coalesce(sa.func.max(models.Stage.order), -1)).where(
                models.Stage.tournament_id == tournament_id
            )
        )
        return int(result.scalar_one()) + 1


class StageItemRepository(BaseRepository[models.StageItem]):
    def __init__(self) -> None:
        super().__init__(models.StageItem)

    async def list_by_stage(self, session: AsyncSession, stage_id: int) -> Sequence[models.StageItem]:
        result = await session.execute(
            sa.select(models.StageItem)
            .where(models.StageItem.stage_id == stage_id)
            .order_by(models.StageItem.order.asc(), models.StageItem.id.asc())
        )
        return result.scalars().all()


class TeamRepository(BaseRepository[models.Team]):
    def __init__(self) -> None:
        super().__init__(models.Team)

    @staticmethod
    def team_entities(in_entities: list[str], child: Any | None = None) -> list[_AbstractLoad]:
        """Eager-load options for a ``Team`` read, gated by the requested entity
        tokens (``tournament``, ``players``[``.user``], ``captain``, ``placement``,
        ``group``). Shared by every service that serializes a Team -- the token
        vocabulary is a superset across services (e.g. parser's ``TeamRead`` has
        no ``group`` field, so it never requests that token; the branch simply
        never runs for it).

        ``players``/``placement``/``group`` use ``selectin_entity``, never
        ``join_entity``: they're to-many relationships, and joinedload on a
        to-many multiplies the row set (see ``shared.core.utils.selectin_entity``).
        """
        entities: list[_AbstractLoad] = []
        if "tournament" in in_entities:
            entities.append(join_entity(child, models.Team.tournament))
        if "players" in in_entities:
            players_entities = prepare_entities(in_entities, "players")
            players_entity = selectin_entity(child, models.Team.players)
            entities.append(players_entity)
            # PlayerRead.user_id is a required field (resolved from
            # workspace_member.player_id), so workspace_member itself must always
            # be loaded here -- not just when "user" is requested. The nested
            # workspace_member.player (+ further user sub-entities) stays gated
            # behind "user" since that's the expensive/optional part.
            workspace_member_entity = join_entity(players_entity, models.Player.workspace_member)
            entities.append(workspace_member_entity)
            if "user" in players_entities:
                user_entity = join_entity(workspace_member_entity, models.WorkspaceMember.player)
                entities.append(user_entity)
                entities.extend(
                    UserRepository.identity_options(prepare_entities(players_entities, "user"), user_entity)
                )
        if "captain" in in_entities:
            captain_entity = join_entity(child, models.Team.captain)
            entities.append(captain_entity)
            entities.extend(UserRepository.identity_options(prepare_entities(in_entities, "captain"), captain_entity))
        if "placement" in in_entities:
            entities.append(selectin_entity(child, models.Team.standings))
        if "group" in in_entities:
            standings = selectin_entity(child, models.Team.standings)
            entities.append(standings)
            entities.append(join_entity(standings, models.Standing.group))
        return entities

    async def get_by_name_and_tournament(
        self,
        session: AsyncSession,
        *,
        name: str,
        tournament_id: int,
    ) -> models.Team | None:
        return await self.get_by(session, name=name, tournament_id=tournament_id)

    async def list_by_tournament(
        self,
        session: AsyncSession,
        tournament_id: int,
        *,
        options: Sequence[_AbstractLoad] | None = None,
    ) -> Sequence[models.Team]:
        query = self._apply_options(
            sa.select(models.Team).where(models.Team.tournament_id == tournament_id).order_by(models.Team.id.asc()),
            options,
        )
        result = await session.execute(query)
        return result.unique().scalars().all()

    async def get_by_player_ids(
        self,
        session: AsyncSession,
        player_ids: Sequence[int],
        tournament_id: int,
        *,
        min_players: int = 3,
        options: Sequence[_AbstractLoad] | None = None,
    ) -> models.Team | None:
        """The team a roster (``player_ids`` = ``workspace_member.player_id`` values)
        belongs to in ``tournament_id`` -- matched by majority membership (at least
        ``min_players`` of them on one non-substitute roster), not exact set
        equality, since a sub might sit on a different team than the roster
        being resolved.
        """
        query = (
            self._apply_options(sa.select(models.Team), options)
            .join(models.Player, models.Team.id == models.Player.team_id)
            .join(models.WorkspaceMember, models.WorkspaceMember.id == models.Player.workspace_member_id)
            .where(
                models.WorkspaceMember.player_id.in_(player_ids),
                models.Team.tournament_id == tournament_id,
                models.Player.is_substitution.is_(False),
            )
            .group_by(models.Team.id)
            .having(sa.func.count(models.Player.id) >= min_players)
        )
        result = await session.execute(query)
        return result.unique().scalars().first()


class PlayerRepository(BaseRepository[models.Player]):
    def __init__(self) -> None:
        super().__init__(models.Player)

    @staticmethod
    def player_entities(in_entities: list[str], child: Any | None = None) -> list[_AbstractLoad]:
        """Eager-load options for a ``Player`` read, gated by the requested entity
        tokens (``user``, ``tournament``, ``team``). Shared by every service that
        serializes a Player.

        ``workspace_member`` is always loaded, regardless of tokens:
        ``PlayerRead.user_id`` is a required field resolved from
        ``workspace_member.player_id`` -- the nested ``.player`` (full user
        profile) stays gated behind ``"user"``.
        """
        entities: list[_AbstractLoad] = []
        workspace_member_entity = join_entity(child, models.Player.workspace_member)
        entities.append(workspace_member_entity)
        if "user" in in_entities:
            entities.append(join_entity(workspace_member_entity, models.WorkspaceMember.player))
        if "tournament" in in_entities:
            entities.append(join_entity(child, models.Player.tournament))
        if "team" in in_entities:
            team_entity = join_entity(child, models.Player.team)
            entities.append(team_entity)
            entities.extend(TeamRepository.team_entities(prepare_entities(in_entities, "team"), team_entity))
        return entities

    async def get_by_user_and_tournament(
        self,
        session: AsyncSession,
        *,
        user_id: int,
        tournament_id: int,
    ) -> models.Player | None:
        return await self.get_by(session, user_id=user_id, tournament_id=tournament_id)

    async def list_by_team(self, session: AsyncSession, team_id: int) -> Sequence[models.Player]:
        result = await session.execute(
            sa.select(models.Player).where(models.Player.team_id == team_id).order_by(models.Player.id.asc())
        )
        return result.scalars().all()

    async def get_by_team_and_user(
        self,
        session: AsyncSession,
        *,
        team_id: int,
        user_id: int,
        options: Sequence[_AbstractLoad] | None = None,
    ) -> models.Player | None:
        query = self._apply_options(
            sa.select(models.Player).where(
                models.Player.workspace_member.has(models.WorkspaceMember.player_id == user_id),
                models.Player.team_id == team_id,
            ),
            options,
        )
        result = await session.execute(query)
        return result.unique().scalars().first()

    async def list_by_user_and_role(
        self,
        session: AsyncSession,
        *,
        user_id: int,
        role: HeroClass,
        options: Sequence[_AbstractLoad] | None = None,
    ) -> Sequence[models.Player]:
        query = self._apply_options(
            sa.select(models.Player).where(
                models.Player.workspace_member.has(models.WorkspaceMember.player_id == user_id),
                models.Player.role == role,
            ),
            options,
        )
        result = await session.execute(query)
        return result.unique().scalars().all()


class EncounterRepository(BaseRepository[models.Encounter]):
    def __init__(self) -> None:
        super().__init__(models.Encounter)

    async def get_by_challonge_id(
        self,
        session: AsyncSession,
        challonge_id: int,
    ) -> models.Encounter | None:
        return await self.get_by(session, challonge_id=challonge_id)

    async def list_by_tournament(
        self,
        session: AsyncSession,
        tournament_id: int,
    ) -> Sequence[models.Encounter]:
        result = await session.execute(
            sa.select(models.Encounter)
            .where(models.Encounter.tournament_id == tournament_id)
            .order_by(models.Encounter.round.asc(), models.Encounter.id.asc())
        )
        return result.scalars().all()


class MatchRepository(BaseRepository[models.Match]):
    def __init__(self) -> None:
        super().__init__(models.Match)

    async def list_by_encounter(self, session: AsyncSession, encounter_id: int) -> Sequence[models.Match]:
        result = await session.execute(
            sa.select(models.Match).where(models.Match.encounter_id == encounter_id).order_by(models.Match.id.asc())
        )
        return result.scalars().all()


class StandingRepository(BaseRepository[models.Standing]):
    def __init__(self) -> None:
        super().__init__(models.Standing)

    async def list_by_tournament(
        self,
        session: AsyncSession,
        tournament_id: int,
    ) -> Sequence[models.Standing]:
        result = await session.execute(
            sa.select(models.Standing)
            .where(models.Standing.tournament_id == tournament_id)
            .order_by(models.Standing.position.asc(), models.Standing.id.asc())
        )
        return result.scalars().all()


class TournamentLinkRepository(BaseRepository[models.TournamentLink]):
    """``tournament.tournament_link`` — typed external links (Discord, stream, VOD, ...).

    Read-heavy by every current caller (app-service renders them, stream-svc polls
    the ``kind='stream'`` ones), so both methods below are read paths; nothing here
    writes.
    """

    def __init__(self) -> None:
        super().__init__(models.TournamentLink)

    async def list_active_by_kind(
        self,
        session: AsyncSession,
        tournament_id: int,
        kind: str,
    ) -> Sequence[models.TournamentLink]:
        """Active links of ``kind``, in organizer order."""
        result = await session.execute(
            sa.select(models.TournamentLink)
            .where(
                models.TournamentLink.tournament_id == tournament_id,
                models.TournamentLink.kind == kind,
                models.TournamentLink.is_active.is_(True),
            )
            .order_by(models.TournamentLink.sort_order.asc(), models.TournamentLink.id.asc())
        )
        return result.scalars().all()

    async def list_active_by_kind_bulk(
        self,
        session: AsyncSession,
        tournament_ids: Sequence[int],
        kind: str,
    ) -> dict[int, list[models.TournamentLink]]:
        """``list_active_by_kind`` for every id in ``tournament_ids`` in ONE query.

        A caller that needs this for many tournaments in the same pass (the
        stream-svc poll tick, one per active tournament) would otherwise pay one
        round-trip per tournament for the exact same statement shape.
        """
        by_tournament: dict[int, list[models.TournamentLink]] = {tid: [] for tid in tournament_ids}
        if not tournament_ids:
            return by_tournament
        result = await session.execute(
            sa.select(models.TournamentLink)
            .where(
                models.TournamentLink.tournament_id.in_(tournament_ids),
                models.TournamentLink.kind == kind,
                models.TournamentLink.is_active.is_(True),
            )
            .order_by(models.TournamentLink.sort_order.asc(), models.TournamentLink.id.asc())
        )
        for link in result.scalars().all():
            by_tournament.setdefault(link.tournament_id, []).append(link)
        return by_tournament


class TournamentGroupRepository(BaseRepository[models.TournamentGroup]):
    """``tournament.group`` — legacy group model, still actively written
    alongside Stage/StageItem during the migration (see the model's own
    docstring); kept here rather than skipped since ``TournamentService`` still
    creates rows through it.
    """

    def __init__(self) -> None:
        super().__init__(models.TournamentGroup)

    async def get_by_tournament_stage_and_name(
        self,
        session: AsyncSession,
        *,
        tournament_id: int,
        stage_id: int | None,
        name: str,
    ) -> models.TournamentGroup | None:
        return await self.get_by(session, tournament_id=tournament_id, stage_id=stage_id, name=name)


class StageItemInputRepository(BaseRepository[models.StageItemInput]):
    def __init__(self) -> None:
        super().__init__(models.StageItemInput)
