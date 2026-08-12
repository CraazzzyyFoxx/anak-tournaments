from sqlalchemy import Boolean, ForeignKey, String, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from shared.core import db
from shared.models.catalog.gamemode import Gamemode

__all__ = ("Map",)


class Map(db.TimeStampIntegerMixin):
    __tablename__ = "map"
    __table_args__ = ({"schema": "overwatch"},)

    gamemode_id: Mapped[int] = mapped_column(ForeignKey(Gamemode.id))
    name: Mapped[str] = mapped_column(String(), unique=True)
    image_path: Mapped[str] = mapped_column(String())
    in_competitive: Mapped[bool] = mapped_column(Boolean(), default=True, server_default=text("true"))
    # Names this map answers to in match logs beyond `name`. OverFast has no
    # `locale` parameter on /maps, so these are entirely admin-supplied:
    # localisations, seasonal variants ("Hollywood (Halloween)") and apostrophe
    # spellings ("King's Row" vs "King’s Row").
    # NOTE: JSONB does not track in-place mutation — always reassign.
    aliases: Mapped[list[str]] = mapped_column(
        JSONB(), nullable=False, server_default=text("'[]'::jsonb"), default=list
    )
    gamemode: Mapped[Gamemode] = relationship(back_populates="maps")
