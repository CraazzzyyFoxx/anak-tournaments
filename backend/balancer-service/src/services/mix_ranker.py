"""The mix ranker's state: a workspace's knobs and its members' hidden ratings.

The formulas live in :mod:`src.domain.mix_ranker` (idea and specification by
Dmitriy, @dmelackov -- https://github.com/mixtura-dev/mixtura-ranker). This
module only loads and stores what they read and write.

The hidden book is derived data: a fold over the workspace's recorded mix rounds
in recording order. A recorded match advances it in place; anything
that rewrites history (an undo) or the scale it is expressed in (the hidden
knobs) rebuilds it from scratch, so it never depends on the order edits came in.
"""

from __future__ import annotations

import dataclasses
from collections.abc import Mapping, Sequence
from itertools import groupby
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from shared.domain.custom_game_round import winner_slot
from shared.models.balancer import WorkspaceBalancerConfig
from shared.repository import (
    CatalogRoleRepository,
    CustomGameRoundRepository,
    MemberHiddenRatingRepository,
    WorkspaceBalancerConfigRepository,
)
from src.domain.mix_ranker import HiddenRating, Ranker, RankerSettings

__all__ = ("MixRankerService", "RatedSeat", "Seat", "mix_ranker_service", "settings_from_json")

#: ``(workspace_member_id, role slot code, rank snapshot)``; the member is
#: ``None`` for a seat whose player has since left the workspace.
#: A slot outside the discipline's rated module roles (the open ``flex`` slot) is rated but not stored.
Seat = tuple[int | None, str, int]
#: One seat's hidden rating before and after the match.
RatedSeat = tuple[HiddenRating, HiddenRating]

_FIELDS = tuple(field.name for field in dataclasses.fields(RankerSettings))


def settings_from_json(stored: Mapping[str, Any] | None) -> RankerSettings:
    """The stored knobs over the defaults; a key never saved keeps its default."""
    return RankerSettings(**{key: stored[key] for key in _FIELDS if stored and key in stored})


class MixRankerService:
    def __init__(
        self,
        *,
        hidden: MemberHiddenRatingRepository = MemberHiddenRatingRepository(),
        configs: WorkspaceBalancerConfigRepository = WorkspaceBalancerConfigRepository(),
        mix_rounds: CustomGameRoundRepository = CustomGameRoundRepository(),
        roles: CatalogRoleRepository = CatalogRoleRepository(),
    ) -> None:
        self.hidden = hidden
        self.configs = configs
        self.mix_rounds = mix_rounds
        self.roles = roles

    async def settings(self, session: AsyncSession, workspace_id: int) -> RankerSettings:
        config = await self.configs.get_by_workspace(session, workspace_id)
        return settings_from_json(config.ranker_json if config is not None else None)

    async def _role_ids(self, session: AsyncSession, discipline: str) -> dict[str, int]:
        """Module roles of the discipline's rated dimension by code (D87)."""
        rows = await self.roles.rated_rows(session, discipline=discipline, workspace_id=None)
        return {code: row.id for code, row in rows.items()}

    async def effective_ratings(
        self,
        session: AsyncSession,
        *,
        workspace_id: int,
        discipline: str,
        open_ranks: Mapping[tuple[int, str], int],
    ) -> dict[tuple[int, str], int]:
        """The rating each ``(member, role)`` is balanced on; its open rank when it has no hidden one yet."""
        if not open_ranks:
            return {}
        ranker = Ranker(await self.settings(session, workspace_id))
        role_ids = await self._role_ids(session, discipline)
        stored = await self.hidden.for_members(
            session, workspace_id=workspace_id, member_ids=sorted({member_id for member_id, _role in open_ranks})
        )
        out: dict[tuple[int, str], int] = {}
        for (member_id, role), rank in open_ranks.items():
            hidden = stored.get((member_id, role_ids[role])) if role in role_ids else None
            out[(member_id, role)] = rank if hidden is None else round(ranker.effective(rank, HiddenRating(*hidden)))
        return out

    async def rate_match(
        self,
        session: AsyncSession,
        *,
        workspace_id: int,
        discipline: str,
        teams: Sequence[Sequence[Seat]],
        winner: int | None,
    ) -> tuple[Ranker, list[list[RatedSeat]]]:
        """Advance the hidden book by one recorded two-team match.

        A seat without a hidden rating yet is seeded from its rank snapshot --
        the rating it was balanced on, which for a newcomer is its open rank.
        """
        ranker = Ranker(await self.settings(session, workspace_id))
        role_ids = await self._role_ids(session, discipline)
        keys = [
            [
                (member_id, role_ids[role]) if member_id is not None and role in role_ids else None
                for member_id, role, _rank in team
            ]
            for team in teams
        ]
        stored = await self.hidden.for_members(
            session,
            workspace_id=workspace_id,
            member_ids=sorted({key[0] for team in keys for key in team if key is not None}),
            for_update=True,
        )
        before = [
            [
                HiddenRating(*stored[key]) if key is not None and key in stored else ranker.initial(rank)
                for key, (_member, _role, rank) in zip(team_keys, team, strict=True)
            ]
            for team_keys, team in zip(keys, teams, strict=True)
        ]
        after = ranker.rate(before, winner)
        await self.hidden.upsert_many(
            session,
            workspace_id=workspace_id,
            ratings={
                key: tuple(new)
                for team_keys, new_team in zip(keys, after, strict=True)
                for key, new in zip(team_keys, new_team, strict=True)
                if key is not None
            },
        )
        return ranker, [list(zip(old, new, strict=True)) for old, new in zip(before, after, strict=True)]

    async def rebuild(self, session: AsyncSession, workspace_id: int) -> tuple[int, int]:
        """Refold the whole hidden book from the match history; ``(matches, ratings)``.

        ponytail: a full replay per undo / knob change -- ~0.1 ms per match in
        OpenSkill, so seconds at 10^4 matches. Rebuild from a checkpoint instead
        if a workspace's history ever makes this slow.
        """
        ranker = Ranker(await self.settings(session, workspace_id))
        rows = await self.mix_rounds.seats(session, workspace_id=workspace_id)
        book: dict[tuple[int, int], HiddenRating] = {}
        matches = 0
        for _encounter_id, round_seats in groupby(rows, key=lambda row: row.encounter_id):
            sides: dict[int, tuple[float, list[tuple[tuple[int, int] | None, int]]]] = {}
            for row in round_seats:
                sides.setdefault(row.slot, (row.own_score, []))[1].append(
                    # A seat with no role cannot be keyed; it still counts for its team, unstored.
                    (
                        (row.workspace_member_id, row.role_id)
                        if row.workspace_member_id is not None and row.role_id is not None
                        else None,
                        row.rank,
                    )
                )
            first, second = sides.get(1), sides.get(2)
            if first is None or second is None or not first[1] or not second[1]:
                continue
            winner = winner_slot(1, first[0], second[0])
            teams = (first[1], second[1])
            # A seat never seen before (or one that cannot be stored) enters at its snapshot.
            before = [
                [(book.get(key) if key is not None else None) or ranker.initial(rank) for key, rank in team]
                for team in teams
            ]
            after = ranker.rate(before, winner)
            for team, new_team in zip(teams, after, strict=True):
                for (key, _rank), new in zip(team, new_team, strict=True):
                    if key is not None:
                        book[key] = new
            matches += 1
        await self.hidden.replace_for_workspace(
            session, workspace_id=workspace_id, ratings={key: tuple(value) for key, value in book.items()}
        )
        return matches, len(book)

    async def save_settings(
        self, session: AsyncSession, *, workspace_id: int, settings: RankerSettings, updated_by: int | None
    ) -> bool:
        """Store the workspace's knobs; ``True`` when that forced a rebuild.

        Raises ``ValueError`` for knobs the formulas cannot run on.
        """
        Ranker(settings)
        config = await self.configs.get_by_workspace(session, workspace_id)
        previous = settings_from_json(config.ranker_json if config is not None else None)
        payload = dataclasses.asdict(settings)
        if config is None:
            await self.configs.create(
                session,
                WorkspaceBalancerConfig(
                    workspace_id=workspace_id, config_json={}, ranker_json=payload, updated_by=updated_by
                ),
            )
        else:
            await self.configs.update_fields(session, config, {"ranker_json": payload, "updated_by": updated_by})
        if previous.hidden_scale() == settings.hidden_scale():
            return False
        await self.rebuild(session, workspace_id)
        return True

    async def count(self, session: AsyncSession, workspace_id: int) -> int:
        return await self.hidden.count_for_workspace(session, workspace_id)


mix_ranker_service = MixRankerService()
