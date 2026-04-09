import typing

from sqlalchemy import Boolean, Enum, Float, ForeignKey, Index, Integer, String, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from shared.core import db, enums
from shared.models.tournament import Tournament, TournamentGroup
from shared.models.user import User

if typing.TYPE_CHECKING:
    from shared.models.standings import Standing

__all__ = ("Team", "ChallongeTeam", "Player")


class Team(db.TimeStampIntegerMixin):
    __tablename__ = "team"
    __table_args__ = ({"schema": "tournament"},)

    balancer_name: Mapped[str] = mapped_column(String())
    name: Mapped[str] = mapped_column(String())
    avg_sr: Mapped[float] = mapped_column(Float())
    total_sr: Mapped[int] = mapped_column(Integer())

    captain_id: Mapped[int | None] = mapped_column(
        ForeignKey("players.user.id", ondelete="SET NULL"), nullable=True, index=True
    )
    tournament_id: Mapped[int] = mapped_column(
        ForeignKey(Tournament.id, ondelete="CASCADE"), index=True
    )
    tournament: Mapped[Tournament] = relationship()

    players: Mapped[list["Player"]] = relationship(back_populates="team")
    captain: Mapped["User | None"] = relationship()
    standings: Mapped[list["Standing"]] = relationship()
    challonge: Mapped[list["ChallongeTeam"]] = relationship()


class Player(db.TimeStampIntegerMixin):
    __tablename__ = "player"

    __table_args__ = (
        Index("ix_player_user_tournament", "user_id", "tournament_id"),
        Index("ix_player_team_user", "team_id", "user_id"),
        Index(
            "ix_player_user_not_sub",
            "user_id",
            "tournament_id",
            postgresql_where=text("is_substitution = false"),
        ),
        {"schema": "tournament"},
    )

    name: Mapped[str] = mapped_column(String())
    primary: Mapped[bool] = mapped_column(Boolean())
    secondary: Mapped[bool] = mapped_column(Boolean())
    rank: Mapped[int] = mapped_column(Integer())
    role: Mapped[enums.HeroClass | None] = mapped_column(
        Enum(enums.HeroClass), nullable=True
    )
    is_substitution: Mapped[bool] = mapped_column(Boolean(), server_default="false")
    related_player_id: Mapped[int | None] = mapped_column(
        ForeignKey("tournament.player.id", ondelete="SET NULL"), nullable=True
    )
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
    __table_args__ = ({"schema": "tournament"},)

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
