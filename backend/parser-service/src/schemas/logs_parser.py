import typing

from src import models

__all__ = ("Fight", "Round")

from src.core import enums


class Fight(typing.TypedDict):
    kills: list[models.StatsEvent]
    start: float
    end: float


class Round(typing.TypedDict):
    events: list[tuple[enums.LogEventType, float, list[str]]]
    start: float
    end: float
