"""Catalog read models shared by app-service, stats-service, and tournament-service.

``HeroRead``/``MapRead``/``GamemodeRead`` and the hero playtime/stats/leaderboard
parameter shapes used to be copy-pasted into each of those three services'
``schemas`` packages -- 121 identical lines, including a 44-field
``HeroLeaderboardEntry``. They carry no per-service behavior, so there is exactly
one definition here and each service's local module re-exports what it needs.
Same consolidation as ``shared/schemas/base.py``; see its docstring.

``CatalogEntityRead`` is the one native wire for a ``catalog.entity`` row of any discipline and kind (public reads,
admin CRUD, embedded relationships). ``HeroRead``/``MapRead``/``GamemodeRead`` below are the legacy Overwatch-shaped
reads, deleted once their last embedder moves to it. They omit ``aliases``: only app-service serves it, so declaring it
here would widen unrelated public payloads; app-service subclasses them to add it.
"""

import typing
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from pydantic import BaseModel

from shared.core import enums, pagination
from shared.schemas.base import BaseRead
from shared.schemas.role import RoleRef

__all__ = (
    "CatalogEntityRead",
    "GamemodeRead",
    "HeroLeaderboardEntry",
    "HeroLeaderboardParams",
    "HeroLeaderboardQueryParams",
    "HeroPlaytime",
    "HeroPlaytimePaginationParams",
    "HeroPlaytimeQueryPaginationParams",
    "HeroRead",
    "MapRead",
)


def _entity_fields(entity: Any) -> dict[str, Any]:
    """What every catalog read model takes from a ``catalog.entity`` row (``aliases`` is read by the subclasses that
    declare it and ignored by the rest)."""
    return {
        "id": entity.id,
        "slug": entity.slug,
        "name": entity.name,
        "image_path": entity.image_path or "",
        "aliases": list(entity.aliases or []),
    }


class CatalogEntityRead(BaseRead):
    """One ``catalog.entity`` row of any discipline and kind; the public, admin and embedded catalog wire."""

    created_at: datetime
    updated_at: datetime | None = None
    discipline: str
    kind: typing.Literal["character", "map", "mode"]
    slug: str
    name: str
    image_path: str | None
    parent_id: int | None
    attrs: dict[str, Any]
    aliases: list[str]
    active: bool
    #: Same shape, one level deep: ``parent.parent`` is always ``None``.
    parent: CatalogEntityRead | None = None

    @classmethod
    def from_entity(cls, entity: Any, *, with_parent: bool = True) -> typing.Self:
        """``with_parent`` reads ``entity.parent`` when the row has a ``parent_id``; the caller must have loaded it
        (an async lazy load raises). A row without a parent never touches the relationship."""
        parent = entity.parent if with_parent and entity.parent_id is not None else None
        return cls(
            id=entity.id,
            created_at=entity.created_at,
            updated_at=entity.updated_at,
            discipline=entity.discipline,
            kind=entity.kind,
            slug=entity.slug,
            name=entity.name,
            image_path=entity.image_path,
            parent_id=entity.parent_id,
            attrs=dict(entity.attrs or {}),
            aliases=list(entity.aliases or []),
            active=entity.active,
            parent=None if parent is None else cls.from_entity(parent, with_parent=False),
        )


class GamemodeRead(BaseRead):
    slug: str
    name: str
    image_path: str
    description: str | None

    @classmethod
    def from_entity(cls, entity: Any) -> typing.Self:
        return cls.model_validate({**_entity_fields(entity), "description": (entity.attrs or {}).get("description")})


class HeroRead(BaseRead):
    slug: str
    name: str
    image_path: str
    type: str
    color: str

    @classmethod
    def from_entity(cls, entity: Any) -> typing.Self:
        """``type`` keeps today's spelling, the ``HeroClass`` value ("Tank"); a JSON-built hero object keeps the label."""
        attrs = entity.attrs or {}
        return cls.model_validate(
            {
                **_entity_fields(entity),
                "type": enums.HeroClass[attrs["class"]].value,
                "color": attrs.get("color", "#ffffff"),
            }
        )


class MapRead(BaseRead):
    gamemode_id: int
    name: str
    image_path: str
    in_competitive: bool = True

    gamemode: GamemodeRead | None

    @classmethod
    def from_entity(cls, entity: Any, *, with_gamemode: bool = False) -> typing.Self:
        """``with_gamemode`` reads ``entity.parent``, which the caller must have loaded."""
        parent = entity.parent if with_gamemode else None
        return cls.model_validate(
            {
                **_entity_fields(entity),
                "gamemode_id": entity.parent_id,
                "in_competitive": (entity.attrs or {}).get("in_competitive", True),
                "gamemode": None
                if parent is None
                else {**_entity_fields(parent), "description": (parent.attrs or {}).get("description")},
            }
        )


class HeroPlaytime(BaseModel):
    hero: HeroRead
    playtime: float


class HeroPlaytimeQueryPaginationParams(pagination.PaginationSortQueryParams):
    user_id: int | typing.Literal["all"] = "all"
    sort: typing.Literal["id", "name", "slug", "playtime"] = "playtime"
    tournament_id: int | None = None


@dataclass
class HeroPlaytimePaginationParams(pagination.PaginationSortParams):
    user_id: int | typing.Literal["all"] = "all"
    # role: enums.HeroRole | typing.Literal["all"] = "all"
    tournament_id: int | None = None


class HeroLeaderboardEntry(BaseModel):
    rank: int
    user_id: int
    username: str
    player_name: str
    role: RoleRef | None = None
    div: int
    team: str | None = None
    team_id: int | None = None
    games_played: int
    playtime_seconds: float
    per10_eliminations: float
    per10_healing: float
    per10_deaths: float
    per10_damage: float
    per10_final_blows: float
    per10_damage_blocked: float
    per10_solo_kills: float
    per10_obj_kills: float
    per10_defensive_assists: float
    per10_offensive_assists: float
    per10_all_damage: float
    per10_damage_taken: float
    per10_self_healing: float
    per10_ultimates_used: float
    per10_multikills: float
    per10_env_kills: float
    per10_crit_hits: float
    avg_weapon_accuracy: float
    avg_crit_accuracy: float
    kd: float
    kda: float


class HeroLeaderboardQueryParams(pagination.PaginationQueryParams):
    tournament_id: int | None = None
    stat: enums.LogStatsName = enums.LogStatsName.Eliminations


@dataclass
class HeroLeaderboardParams(pagination.PaginationParams):
    tournament_id: int | None = None
    stat: enums.LogStatsName = enums.LogStatsName.Performance

    @classmethod
    def from_query_params(cls, query_params: HeroLeaderboardQueryParams) -> HeroLeaderboardParams:  # type: ignore[override]
        return cls(
            page=query_params.page,
            per_page=query_params.per_page,
            entities=query_params.entities,
            tournament_id=query_params.tournament_id,
            stat=query_params.stat,
        )
