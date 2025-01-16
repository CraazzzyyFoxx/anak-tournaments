import typing
from enum import Enum
from typing import Generic, List, TypedDict, TypeVar
from dataclasses import dataclass, field

import sqlalchemy as sa
from fastapi import Query
from pydantic import BaseModel, Field

from . import db

__all__ = (
    "Paginated",
    "PaginationQueryParams",
    "PaginationDict",
    "SortOrder",
)


SchemaType = TypeVar("SchemaType", bound=BaseModel)
ModelType = TypeVar("ModelType", bound=db.TimeStampIntegerMixin)


class PaginationDict(TypedDict, Generic[ModelType]):
    page: int
    per_page: int
    total: int
    results: List[ModelType]


class Paginated(BaseModel, Generic[SchemaType]):
    page: int
    per_page: int
    total: int
    results: List[SchemaType]


class SortOrder(Enum):
    ASC = "asc"
    DESC = "desc"


def apply_search(model: typing.Type[db.Base], query: sa.Select, query_str: str, fields: List[str]) -> sa.Select:
    columns = [model.depth_get_column(field.split(".")) for field in fields]
    search_query = f"%{query_str}%"
    return query.where(sa.or_(*[column.ilike(search_query) for column in columns]))


class PaginationQueryParams(BaseModel):
    page: int = Field(default=1, ge=1)
    per_page: int = Field(default=10, ge=-1, le=100)
    sort: str = Field(default="created_at")
    order: SortOrder = SortOrder.ASC
    entities: list[str] = Field(Query(default=[]))


@dataclass
class PaginationParams:
    page: int = 1
    per_page: int = 10
    sort: str = "created_at"
    order: SortOrder = SortOrder.ASC
    entities: list[str] = field(default_factory=list)

    @classmethod
    def from_query_params(cls, query_params: PaginationQueryParams):
        return cls(**query_params.model_dump())

    def apply_sort(self, query: sa.Select, model: typing.Type[db.Base] | None = None) -> sa.Select:
        if model:
            if self.order == SortOrder.DESC:
                order_by = model.depth_get_column(self.sort.split(".")).desc()
            else:
                order_by = model.depth_get_column(self.sort.split(".")).asc()
            return query.order_by(order_by)
        else:
            if self.order == SortOrder.DESC:
                order_by = sa.text(f"{self.sort} DESC")
            else:
                order_by = sa.text(f"{self.sort} ASC")

            return query.order_by(order_by)

    def apply_pagination_sort(self, query: sa.Select, model: typing.Type[db.Base] | None = None) -> sa.Select:
        if self.per_page == -1:
            return self.apply_sort(query, model)
        offset = (self.page - 1) * self.per_page
        query = self.apply_sort(query, model)
        return query.offset(offset).limit(self.per_page)

    def apply_pagination(self, query: sa.Select) -> sa.Select:
        if self.per_page == -1:
            return query
        offset = (self.page - 1) * self.per_page
        return query.offset(offset).limit(self.per_page)


class SearchQueryParams(PaginationQueryParams):
    query: str = Field("")
    fields: list[str] = Field(Query(default=[]))

    def apply_search(self, query: sa.Select, model: typing.Type[db.Base]) -> sa.Select:
        return apply_search(model, query, self.query, self.fields)


@dataclass
class SearchPaginationParams(PaginationParams):
    query: str = ""
    fields: list[str] = field(default_factory=list)

    def apply_search(self, query: sa.Select, model: typing.Type[db.Base]) -> sa.Select:
        columns = [model.depth_get_column(field.split(".")) for field in self.fields]
        search_query = f"%{self.query}%"
        return query.where(sa.or_(*[column.ilike(search_query) for column in columns]))

    def apply_sort(self, query: sa.Select, model: typing.Type[db.Base]) -> sa.Select:
        if self.sort.startswith("similarity"):
            sort = self.sort.split(":")[1]
            column = sa.func.word_similarity(model.depth_get_column(sort.split(".")), self.query)
            if sort == "asc":
                order_by = column.asc()
            else:
                order_by = column.desc()
            return query.order_by(order_by)
        else:
            return super().apply_sort(query, model)
