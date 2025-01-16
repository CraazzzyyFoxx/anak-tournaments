from sqlalchemy import ForeignKey, Integer, Enum, Float, Boolean
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src import models
from src.core import db, enums


__all__ = (
    "Match",
    "MatchStatistics",
    "MatchKillFeed",
    "MatchEvent",
)


class Match(db.TimeStampIntegerMixin):
    __tablename__ = "match"

    home_team_id: Mapped[int] = mapped_column(ForeignKey(models.Team.id, ondelete="CASCADE"), index=True)
    away_team_id: Mapped[int] = mapped_column(ForeignKey(models.Team.id, ondelete="CASCADE"), index=True)
    home_score: Mapped[int] = mapped_column(Integer())
    away_score: Mapped[int] = mapped_column(Integer())
    time: Mapped[float] = mapped_column(Float())
    log_name: Mapped[str] = mapped_column()

    encounter_id: Mapped[int] = mapped_column(ForeignKey(models.Encounter.id, ondelete="CASCADE"), index=True)
    map_id: Mapped[int] = mapped_column(ForeignKey("map.id", ondelete="CASCADE"), index=True)

    home_team: Mapped["models.Team"] = relationship(foreign_keys=[home_team_id])
    away_team: Mapped["models.Team"] = relationship(foreign_keys=[away_team_id])
    encounter: Mapped["models.Encounter"] = relationship(back_populates="matches")
    map: Mapped["models.Map"] = relationship()


class MatchStatistics(db.TimeStampIntegerMixin):
    __tablename__ = "match_statistics"

    match_id: Mapped[int] = mapped_column(ForeignKey(Match.id, ondelete="CASCADE"), index=True)
    round: Mapped[int] = mapped_column(Integer(), index=True)
    team_id: Mapped[int] = mapped_column(ForeignKey(models.Team.id, ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey(models.User.id, ondelete="CASCADE"), index=True)
    hero_id: Mapped[int | None] = mapped_column(
        ForeignKey(models.Hero.id, ondelete="CASCADE"), nullable=True, index=True
    )

    name: Mapped[enums.LogStatsName] = mapped_column(Enum(enums.LogStatsName), index=True)
    value: Mapped[float] = mapped_column(Float(), index=True)


class MatchKillFeed(db.TimeStampIntegerMixin):
    __tablename__ = "match_kill_feed"

    match_id: Mapped[int] = mapped_column(ForeignKey(Match.id, ondelete="CASCADE"))
    time: Mapped[float] = mapped_column(Float())
    round: Mapped[int] = mapped_column(Integer())
    fight: Mapped[int] = mapped_column(Integer())
    ability: Mapped[enums.AbilityEvent | None] = mapped_column(Enum(enums.AbilityEvent), nullable=True)
    killer_id: Mapped[int] = mapped_column(ForeignKey(models.User.id, ondelete="CASCADE"))
    killer_hero_id: Mapped[int] = mapped_column(ForeignKey(models.Hero.id, ondelete="CASCADE"))
    killer_team_id: Mapped[int] = mapped_column(ForeignKey(models.Team.id, ondelete="CASCADE"))
    victim_id: Mapped[int] = mapped_column(ForeignKey(models.User.id, ondelete="CASCADE"))
    victim_team_id: Mapped[int] = mapped_column(ForeignKey(models.Team.id, ondelete="CASCADE"))
    victim_hero_id: Mapped[int] = mapped_column(ForeignKey(models.Hero.id, ondelete="CASCADE"))
    damage: Mapped[float] = mapped_column(Float())
    is_critical_hit: Mapped[bool] = mapped_column(Boolean())
    is_environmental: Mapped[bool] = mapped_column(Boolean())


class MatchEvent(db.TimeStampIntegerMixin):
    __tablename__ = "match_assists"

    match_id: Mapped[int] = mapped_column(ForeignKey(Match.id, ondelete="CASCADE"))
    time: Mapped[float] = mapped_column(Float())
    round: Mapped[int] = mapped_column(Integer())
    team_id: Mapped[int] = mapped_column(ForeignKey(models.Team.id, ondelete="CASCADE"))
    user_id: Mapped[int] = mapped_column(ForeignKey(models.User.id, ondelete="CASCADE"))
    hero_id: Mapped[int | None] = mapped_column(ForeignKey(models.Hero.id, ondelete="CASCADE"), nullable=True)
    related_team_id: Mapped[int | None] = mapped_column(ForeignKey(models.Team.id, ondelete="CASCADE"), nullable=True)
    related_user_id: Mapped[int | None] = mapped_column(ForeignKey(models.User.id, ondelete="CASCADE"), nullable=True)
    related_hero_id: Mapped[int | None] = mapped_column(ForeignKey(models.Hero.id, ondelete="CASCADE"), nullable=True)
    name: Mapped[enums.MatchEvent] = mapped_column(Enum(enums.MatchEvent))
