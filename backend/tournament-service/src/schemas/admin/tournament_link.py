from pydantic import AnyHttpUrl, BaseModel

from shared.models.tournament.link import TournamentLinkKind
from src.schemas import BaseRead

__all__ = (
    "TournamentLinkCreate",
    "TournamentLinkRead",
    "TournamentLinkUpdate",
)


class TournamentLinkRead(BaseRead):
    tournament_id: int
    kind: TournamentLinkKind
    label: str | None
    url: str
    sort_order: int
    is_active: bool


class TournamentLinkCreate(BaseModel):
    tournament_id: int
    kind: TournamentLinkKind
    url: AnyHttpUrl
    label: str | None = None
    sort_order: int = 0
    is_active: bool = True


class TournamentLinkUpdate(BaseModel):
    kind: TournamentLinkKind | None = None
    label: str | None = None
    url: AnyHttpUrl | None = None
    sort_order: int | None = None
    is_active: bool | None = None
