from typing import TYPE_CHECKING

from sqlalchemy import String, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from shared.core import db

if TYPE_CHECKING:
    from shared.models.catalog.map import Map

__all__ = ("Gamemode",)


class Gamemode(db.TimeStampIntegerMixin):
    __tablename__ = "gamemode"
    __table_args__ = ({"schema": "overwatch"},)

    slug: Mapped[str] = mapped_column(String(), unique=True)
    name: Mapped[str] = mapped_column(String(), unique=True)
    image_path: Mapped[str] = mapped_column(String())
    description: Mapped[str | None] = mapped_column(String(), nullable=True)
    # Names this gamemode answers to in match logs beyond `name`. OverFast
    # exposes no `locale` parameter on /gamemodes, so these are admin-supplied.
    # NOTE: JSONB does not track in-place mutation — always reassign.
    aliases: Mapped[list[str]] = mapped_column(
        JSONB(), nullable=False, server_default=text("'[]'::jsonb"), default=list
    )

    maps: Mapped[list[Map]] = relationship()
