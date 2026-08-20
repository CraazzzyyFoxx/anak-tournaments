from urllib.parse import urlparse

from pydantic import BaseModel, field_validator

from shared.models.tournament.link import TOURNAMENT_LINK_KINDS
from src.schemas import BaseRead

__all__ = (
    "TournamentLinkCreate",
    "TournamentLinkRead",
    "TournamentLinkUpdate",
)


def _validate_kind(value: str) -> str:
    # The vocabulary lives on the model (TOURNAMENT_LINK_KINDS) because the column
    # is free text, not a PG enum — this is the only gate that keeps it typed.
    if value not in TOURNAMENT_LINK_KINDS:
        raise ValueError(f"kind must be one of {sorted(TOURNAMENT_LINK_KINDS)}")
    return value


def _validate_url(value: str) -> str:
    # Trust boundary: this URL is rendered as an href on the public tournament
    # page, so a `javascript:`/`data:` scheme would be stored XSS. Same check as
    # identity-service's origin guard.
    parsed = urlparse(value)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise ValueError("url must be an absolute http(s) URL")
    return value


class TournamentLinkRead(BaseRead):
    tournament_id: int
    kind: str
    label: str | None
    url: str
    sort_order: int
    is_active: bool


class TournamentLinkCreate(BaseModel):
    tournament_id: int
    kind: str
    url: str
    label: str | None = None
    sort_order: int = 0
    is_active: bool = True

    @field_validator("kind")
    @classmethod
    def _check_kind(cls, value: str) -> str:
        return _validate_kind(value)

    @field_validator("url")
    @classmethod
    def _check_url(cls, value: str) -> str:
        return _validate_url(value)


class TournamentLinkUpdate(BaseModel):
    kind: str | None = None
    label: str | None = None
    url: str | None = None
    sort_order: int | None = None
    is_active: bool | None = None

    @field_validator("kind")
    @classmethod
    def _check_kind(cls, value: str | None) -> str | None:
        return None if value is None else _validate_kind(value)

    @field_validator("url")
    @classmethod
    def _check_url(cls, value: str | None) -> str | None:
        return None if value is None else _validate_url(value)
