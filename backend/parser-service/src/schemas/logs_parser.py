import typing

from src import models

__all__ = ("Fight",)


class Fight(typing.TypedDict):
    kills: list[models.StatsEvent]
    start: float
    end: float
