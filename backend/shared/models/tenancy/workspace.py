from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, ForeignKey, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from shared.core import db

if TYPE_CHECKING:
    from shared.models.division_grid.division_grid import DivisionGridVersion
    from shared.models.identity.user import User

__all__ = (
    "Workspace",
    "WorkspaceMember",
)


class Workspace(db.TimeStampIntegerMixin):
    __tablename__ = "workspace"

    slug: Mapped[str] = mapped_column(String(), unique=True, index=True)
    name: Mapped[str] = mapped_column(String())
    description: Mapped[str | None] = mapped_column(String(), nullable=True)
    icon_url: Mapped[str | None] = mapped_column(String(), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean(), server_default="true")
    # IANA timezone all workspace tournaments run in (admin schedule forms
    # display/parse wall-clock times in this zone; storage stays UTC).
    timezone: Mapped[str] = mapped_column(String(64), nullable=False, server_default="Europe/Moscow")
    # Per-workspace site branding (main public site only). Typed hex colours
    # (#RRGGBB); the rest of the palette (text/borders/hover) is derived on the
    # frontend with contrast guards. ``branding_enabled`` is the master toggle so
    # a workspace can turn branding off without losing its saved colours.
    branding_enabled: Mapped[bool] = mapped_column(Boolean(), server_default="false")
    brand_primary: Mapped[str | None] = mapped_column(String(), nullable=True)
    brand_secondary: Mapped[str | None] = mapped_column(String(), nullable=True)
    brand_background: Mapped[str | None] = mapped_column(String(), nullable=True)
    brand_surface: Mapped[str | None] = mapped_column(String(), nullable=True)
    # Curated core-palette overrides (optional). When null, the frontend derives
    # these from the four seed colours above; when set, they win. Same typed hex
    # (#RRGGBB) columns as the seeds — no JSON bag.
    brand_accent: Mapped[str | None] = mapped_column(String(), nullable=True)
    brand_foreground: Mapped[str | None] = mapped_column(String(), nullable=True)
    brand_muted: Mapped[str | None] = mapped_column(String(), nullable=True)
    brand_border: Mapped[str | None] = mapped_column(String(), nullable=True)
    brand_ring: Mapped[str | None] = mapped_column(String(), nullable=True)
    brand_destructive: Mapped[str | None] = mapped_column(String(), nullable=True)
    # White-label multi-domain (Phase 1: subdomains). See
    # docs/superpowers/specs/2026-07-06-workspace-multidomain-design.md.
    subdomain: Mapped[str | None] = mapped_column(String(63), unique=True, index=True, nullable=True)
    seo_title: Mapped[str | None] = mapped_column(String(), nullable=True)
    seo_description: Mapped[str | None] = mapped_column(String(), nullable=True)
    # White-label custom domains (Phase 2). Resolver serves the domain only
    # once verified (DNS TXT owner-proof); token is the required TXT value.
    custom_domain: Mapped[str | None] = mapped_column(String(255), unique=True, index=True, nullable=True)
    custom_domain_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    custom_domain_verification_token: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # The organizer's Discord guild. ONE per workspace: the server where Boosty's
    # bot assigns patron roles and the server holding match-log channels are the
    # same one. String, not BigInteger: there is no arithmetic, no range query and
    # no FK, while both consumers (DiscordRoleResolver, the HTTP boundary) want
    # `str` -- a numeric column would only buy a conversion at every edge.
    discord_guild_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    default_division_grid_version_id: Mapped[int | None] = mapped_column(
        ForeignKey("division_grid_version.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    # Workspace-wide default per-team roster shape, e.g.
    # ``{"tank": 1, "dps": 2, "support": 2}``. NULL means "inherit the built-in
    # 5v5 default", NOT "an empty roster" — the resolution chain lives in
    # ``shared.domain.roster_shape.resolve_roster_shape``.
    default_roster_slots_json: Mapped[dict[str, int] | None] = mapped_column(JSONB, nullable=True)
    # Scope used to decide "has this identity played before" when a new
    # ``Player`` row is created: ``"global"`` counts any workspace's
    # tournaments, ``"workspace"`` counts only this workspace's. Plain string,
    # not a Postgres enum -- same "stay flexible" precedent as
    # ``Tournament.team_formation``. See ``shared.services.newcomer_status``.
    # Admin-editable via the same PATCH /workspaces/{id} path as
    # ``branding_enabled``.
    newcomer_scope: Mapped[str] = mapped_column(String(16), server_default="global", nullable=False)
    members: Mapped[list["WorkspaceMember"]] = relationship(back_populates="workspace", passive_deletes=True)
    default_division_grid_version: Mapped["DivisionGridVersion | None"] = relationship(
        foreign_keys=[default_division_grid_version_id],
        lazy="selectin",
    )


class WorkspaceMember(db.TimeStampIntegerMixin):
    __tablename__ = "workspace_member"

    __table_args__ = (
        UniqueConstraint("workspace_id", "player_id", name="uq_workspace_member_workspace_player"),
        UniqueConstraint("id", "workspace_id", name="uq_workspace_member_id_workspace"),
    )

    workspace_id: Mapped[int] = mapped_column(ForeignKey("workspace.id", ondelete="CASCADE"), index=True)
    player_id: Mapped[int] = mapped_column(ForeignKey("players.user.id", ondelete="CASCADE"), index=True)

    workspace: Mapped["Workspace"] = relationship(back_populates="members")
    player: Mapped["User"] = relationship()
