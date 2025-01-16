import typing

from sqlalchemy import Boolean, Enum, Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.core import db, enums
from src.models.tournament import Tournament, TournamentGroup
from src.models.user import User

if typing.TYPE_CHECKING:
    from src.models.standings import Standing

__all__ = ("Team", "ChallongeTeam", "Player")


class Team(db.TimeStampIntegerMixin):
    __tablename__ = "team"

    balancer_name: Mapped[str] = mapped_column(String())
    name: Mapped[str] = mapped_column(String())
    avg_sr: Mapped[float] = mapped_column(Float())
    total_sr: Mapped[int] = mapped_column(Integer())

    captain_id: Mapped[int] = mapped_column(ForeignKey("user.id"), index=True)
    tournament_id: Mapped[int] = mapped_column(
        ForeignKey(Tournament.id, ondelete="CASCADE"), index=True
    )
    tournament: Mapped[Tournament] = relationship()

    players: Mapped[list["Player"]] = relationship(back_populates="team")
    captain: Mapped["User"] = relationship()
    standings: Mapped[list["Standing"]] = relationship()
    challonge: Mapped[list["ChallongeTeam"]] = relationship()


class Player(db.TimeStampIntegerMixin):
    __tablename__ = "player"

    name: Mapped[str] = mapped_column(String())
    primary: Mapped[bool] = mapped_column(Boolean())
    secondary: Mapped[bool] = mapped_column(Boolean())
    rank: Mapped[int] = mapped_column(Integer())
    div: Mapped[int] = mapped_column(Integer())
    role: Mapped[enums.HeroClass | None] = mapped_column(
        Enum(enums.HeroClass), nullable=True
    )
    is_substitution: Mapped[bool] = mapped_column(Boolean(), server_default="false")
    related_player_id: Mapped[int | None] = mapped_column(Integer(), nullable=True)
    tournament_id: Mapped[int] = mapped_column(
        ForeignKey(Tournament.id, ondelete="CASCADE"), index=True
    )
    is_newcomer: Mapped[bool] = mapped_column(Boolean(), server_default="false")
    is_newcomer_role: Mapped[bool] = mapped_column(Boolean(), server_default="false")

    tournament: Mapped[Tournament] = relationship()
    user_id: Mapped[int] = mapped_column(ForeignKey(User.id, ondelete="CASCADE"))
    user: Mapped["User"] = relationship()
    team_id: Mapped[int] = mapped_column(ForeignKey(Team.id, ondelete="CASCADE"))
    team: Mapped["Team"] = relationship(back_populates="players")

    def __repr__(self):
        return f"<Player name={self.name} role={self.role}>"


class ChallongeTeam(db.TimeStampIntegerMixin):
    __tablename__ = "challonge_team"

    challonge_id: Mapped[int] = mapped_column(Integer())
    team_id: Mapped[int] = mapped_column(ForeignKey(Team.id, ondelete="CASCADE"))
    group_id: Mapped[int | None] = mapped_column(
        ForeignKey(TournamentGroup.id, ondelete="CASCADE"), nullable=True
    )
    tournament_id: Mapped[int] = mapped_column(
        ForeignKey(Tournament.id, ondelete="CASCADE")
    )

    team: Mapped[Team] = relationship(back_populates="challonge")
    group: Mapped[TournamentGroup] = relationship()
    tournament: Mapped[Tournament] = relationship()
