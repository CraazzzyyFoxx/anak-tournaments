"""The workspace roster's wire shapes: the add-player body and the row ``players.list`` / ``players.upsert`` return."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field, field_validator

from shared.schemas.identity import PlayerIdentityRead

__all__ = ("WorkspacePlayerRead", "WorkspacePlayerUpsert")


class WorkspacePlayerUpsert(BaseModel):
    """``POST /balancer/workspaces/{id}/players``: find-or-admit the member a game identity denotes.

    ``identity.provider`` must be the discipline's own identity provider; there is no ``battle_tag`` spelling.
    """

    model_config = ConfigDict(extra="forbid")

    discipline: str = Field(description="An enabled discipline of the workspace.")
    identity: PlayerIdentityRead
    display_name: str | None = Field(
        default=None, description="Roster display name; blank is none. Setting it needs workspace team.create."
    )

    @field_validator("display_name")
    @classmethod
    def _blank_is_none(cls, value: str | None) -> str | None:
        return (value or "").strip() or None


class WorkspacePlayerRead(BaseModel):
    """One roster row, identically shaped for a list page and the upsert answer."""

    member_id: int
    player_id: int
    identity: PlayerIdentityRead | None = Field(
        description="Primary account of the requested discipline's identity provider; null when the player has none."
    )
    display_name: str | None
    auth_user_id: int | None = Field(description="Linked login (auth.user.id); null if the player never signed in.")
    ranks: dict[str, int] = Field(description="The workspace canon, by rated role code.")
    author_ranks: dict[str, int] = Field(description="The read author's own book, by rated role code.")
