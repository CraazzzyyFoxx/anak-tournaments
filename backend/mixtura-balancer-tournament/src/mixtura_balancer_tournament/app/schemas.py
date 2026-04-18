from typing import Generic, TypeVar

from pydantic import BaseModel, Field

T = TypeVar("T")


class ResponseMessage(BaseModel, Generic[T]):
    status: int
    message: T


class ErrorResponse(BaseModel):
    message: str


class UpdateResponse(BaseModel):
    status: str = Field(default="ok")
    updated: bool = Field(default=True)


class StatusResponse(BaseModel):
    status: str = Field(default="ok")


class PaginationRequest(BaseModel):
    page: int | None = None
    page_size: int = 50
