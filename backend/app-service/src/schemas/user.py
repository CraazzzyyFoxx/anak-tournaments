from pydantic import BaseModel

__all__ = ("UserSearch",)


class UserSearch(BaseModel):
    id: int
    name: str
