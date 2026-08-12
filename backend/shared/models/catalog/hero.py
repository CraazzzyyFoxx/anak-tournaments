from sqlalchemy import Enum, String, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from shared.core import db, enums

__all__ = ("Hero",)


class Hero(db.TimeStampIntegerMixin):
    __tablename__ = "hero"
    __table_args__ = ({"schema": "overwatch"},)

    slug: Mapped[str] = mapped_column(String(), unique=True)
    name: Mapped[str] = mapped_column(String(), unique=True)
    image_path: Mapped[str] = mapped_column(String())
    type: Mapped[enums.HeroClass] = mapped_column(Enum(enums.HeroClass), nullable=False)
    color: Mapped[str] = mapped_column(String(), server_default="#ffffff")
    # Names this hero answers to in match logs beyond `name`: the Blizzard
    # localisations pulled by the OverFast sync (13 locales) plus anything an
    # admin adds by hand.
    # NOTE: JSONB does not track in-place mutation — `aliases.append(x)` is
    # invisible to the UPDATE. Always reassign: `obj.aliases = [...]`.
    aliases: Mapped[list[str]] = mapped_column(
        JSONB(), nullable=False, server_default=text("'[]'::jsonb"), default=list
    )
