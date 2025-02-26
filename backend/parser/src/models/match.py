from sqlalchemy import Boolean, Enum, Float, ForeignKey, Integer
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.core import db, enums
from src.models.encounter import Encounter
from src.models.hero import Hero
from src.models.map import Map
from src.models.team import Team
from src.models.user import User

__all__ = (
    "Match",
    "MatchStatistics",
    "MatchKillFeed",
    "MatchEvent",
)


class Match(db.TimeStampIntegerMixin):
    __tablename__ = "match"

    home_team_id: Mapped[int] = mapped_column(
        ForeignKey(Team.id, ondelete="CASCADE"), index=True
    )
    away_team_id: Mapped[int] = mapped_column(
        ForeignKey(Team.id, ondelete="CASCADE"), index=True
    )
    home_score: Mapped[int] = mapped_column(Integer())
    away_score: Mapped[int] = mapped_column(Integer())
    time: Mapped[float] = mapped_column(Float())
    log_name: Mapped[str] = mapped_column()

    encounter_id: Mapped[int] = mapped_column(
        ForeignKey(Encounter.id, ondelete="CASCADE"), index=True
    )
    map_id: Mapped[int] = mapped_column(
        ForeignKey("map.id", ondelete="CASCADE"), index=True
    )

    home_team: Mapped["Team"] = relationship(foreign_keys=[home_team_id])
    away_team: Mapped["Team"] = relationship(foreign_keys=[away_team_id])
    encounter: Mapped["Encounter"] = relationship(back_populates="matches")
    map: Mapped["Map"] = relationship()


class MatchStatistics(db.TimeStampIntegerMixin):
    __tablename__ = "match_statistics"

    match_id: Mapped[int] = mapped_column(
        ForeignKey(Match.id, ondelete="CASCADE"), index=True
    )
    round: Mapped[int] = mapped_column(Integer(), index=True)
    team_id: Mapped[int] = mapped_column(
        ForeignKey(Team.id, ondelete="CASCADE"), index=True
    )
    user_id: Mapped[int] = mapped_column(
        ForeignKey(User.id, ondelete="CASCADE"), index=True
    )
    hero_id: Mapped[int | None] = mapped_column(
        ForeignKey(Hero.id, ondelete="CASCADE"), nullable=True, index=True
    )

    name: Mapped[enums.LogStatsName] = mapped_column(
        Enum(enums.LogStatsName), index=True
    )
    value: Mapped[float] = mapped_column(Float(), index=True)


class MatchKillFeed(db.TimeStampIntegerMixin):
    __tablename__ = "match_kill_feed"

    match_id: Mapped[int] = mapped_column(ForeignKey(Match.id, ondelete="CASCADE"))
    time: Mapped[float] = mapped_column(Float())
    round: Mapped[int] = mapped_column(Integer())
    fight: Mapped[int] = mapped_column(Integer())
    ability: Mapped[enums.AbilityEvent | None] = mapped_column(
        Enum(enums.AbilityEvent), nullable=True
    )
    killer_id: Mapped[int] = mapped_column(ForeignKey(User.id, ondelete="CASCADE"))
    killer_hero_id: Mapped[int] = mapped_column(ForeignKey(Hero.id, ondelete="CASCADE"))
    killer_team_id: Mapped[int] = mapped_column(ForeignKey(Team.id, ondelete="CASCADE"))
    victim_id: Mapped[int] = mapped_column(ForeignKey(User.id, ondelete="CASCADE"))
    victim_team_id: Mapped[int] = mapped_column(ForeignKey(Team.id, ondelete="CASCADE"))
    victim_hero_id: Mapped[int] = mapped_column(ForeignKey(Hero.id, ondelete="CASCADE"))
    damage: Mapped[float] = mapped_column(Float())
    is_critical_hit: Mapped[bool] = mapped_column(Boolean())
    is_environmental: Mapped[bool] = mapped_column(Boolean())


class MatchEvent(db.TimeStampIntegerMixin):
    __tablename__ = "match_assists"

    match_id: Mapped[int] = mapped_column(ForeignKey(Match.id, ondelete="CASCADE"))
    time: Mapped[float] = mapped_column(Float())
    round: Mapped[int] = mapped_column(Integer())
    team_id: Mapped[int] = mapped_column(ForeignKey(Team.id, ondelete="CASCADE"))
    user_id: Mapped[int] = mapped_column(ForeignKey(User.id, ondelete="CASCADE"))
    hero_id: Mapped[int | None] = mapped_column(
        ForeignKey(Hero.id, ondelete="CASCADE"), nullable=True
    )
    related_team_id: Mapped[int | None] = mapped_column(
        ForeignKey(Team.id, ondelete="CASCADE"), nullable=True
    )
    related_user_id: Mapped[int | None] = mapped_column(
        ForeignKey(User.id, ondelete="CASCADE"), nullable=True
    )
    related_hero_id: Mapped[int | None] = mapped_column(
        ForeignKey(Hero.id, ondelete="CASCADE"), nullable=True
    )
    name: Mapped[enums.MatchEvent] = mapped_column(Enum(enums.MatchEvent))
