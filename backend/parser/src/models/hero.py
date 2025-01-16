from sqlalchemy import String, Enum
from sqlalchemy.orm import Mapped, mapped_column

from src.core import db, enums

__all__ = ("Hero",)


class Hero(db.TimeStampIntegerMixin):
    __tablename__ = "hero"

    slug: Mapped[str] = mapped_column(String(), unique=True)
    name: Mapped[str] = mapped_column(String(), unique=True)
    image_path: Mapped[str] = mapped_column(String())
    type: Mapped[enums.HeroClass] = mapped_column(Enum(enums.HeroClass), nullable=False)
    color: Mapped[str] = mapped_column(String(), server_default="#ffffff")
