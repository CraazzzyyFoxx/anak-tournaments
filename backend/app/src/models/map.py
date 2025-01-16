from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.core import db
from src.models.gamemode import Gamemode

__all__ = ("Map",)


class Map(db.TimeStampIntegerMixin):
    __tablename__ = "map"

    gamemode_id: Mapped[int] = mapped_column(ForeignKey(Gamemode.id))
    name: Mapped[str] = mapped_column(String(), unique=True)
    image_path: Mapped[str] = mapped_column(String())

    gamemode: Mapped[Gamemode] = relationship(back_populates="maps")
