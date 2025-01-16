from datetime import datetime

from pydantic import BaseModel


__all__ = ("BaseRead", "Score")


class BaseRead(BaseModel):
    id: int


class Score(BaseModel):
    home: int
    away: int
