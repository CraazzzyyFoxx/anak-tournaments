import typing
from collections.abc import Sequence
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Generic, TypedDict, TypeVar

import sqlalchemy as sa
from fastapi import Query
from pydantic import BaseModel, Field
from sqlalchemy import UnaryExpression
from sqlalchemy.orm import InstrumentedAttribute

from . import db, errors

__all__ = (
    "Paginated",
    "PaginationSortQueryParams",
    "PaginationDict",
    "SortOrder",
)


SchemaType = TypeVar("SchemaType", bound=BaseModel)
ModelType = TypeVar("ModelType", bound=db.TimeStampIntegerMixin)
SortType = TypeVar("SortType", bound=typing.Literal["id"])


class PaginationDict(TypedDict, Generic[ModelType]):
    page: int
    per_page: int
    total: int
    results: list[ModelType]


class Paginated(BaseModel, Generic[SchemaType]):
    page: int
    per_page: int
    total: int
    results: list[SchemaType]


class SortOrder(Enum):
    ASC = "asc"
    DESC = "desc"


def apply_search(
    model: type[db.Base], query: sa.Select, query_str: str, fields: list[str]
) -> sa.Select:
    columns = [model.depth_get_column(field.split(".")) for field in fields]
    search_query = f"%{query_str}%"
    return query.where(sa.or_(*[column.ilike(search_query) for column in columns]))


class PaginationQueryParams(BaseModel):
    page: int = Field(default=1, ge=1)
    per_page: int = Field(default=10, ge=-1, le=100)
    entities: list[str] = Field(Query(default=[]))


class PaginationSortQueryParams(PaginationQueryParams, Generic[SortType]):
    sort: SortType = Field(default="id")
    order: SortOrder = SortOrder.ASC


@dataclass
class PaginationParams:
    page: int = 1
    per_page: int = 10
    entities: list[str] = field(default_factory=list)

    @classmethod
    def from_query_params(cls, query_params: PaginationQueryParams):
        return cls(**query_params.model_dump())

    def apply_pagination(self, query: sa.Select) -> sa.Select:
        if self.per_page == -1:
            return query
        offset = (self.page - 1) * self.per_page
        return query.offset(offset).limit(self.per_page)

    def paginate_data(self, data: Sequence[Any]) -> Sequence[Any]:
        if self.per_page == -1:
            return data
        offset = (self.page - 1) * self.per_page
        return data[offset : offset + self.per_page]


@dataclass
class PaginationSortParams(PaginationParams):
    sort: str = "id"
    order: SortOrder | typing.Literal["asc", "desc"] = SortOrder.ASC

    def apply_sort(
        self, query: sa.Select, model: type[db.Base] | None = None
    ) -> sa.Select:
        if model:
            if self.order == SortOrder.DESC or self.order == "desc":
                order_by = model.depth_get_column(self.sort.split(".")).desc()
            else:
                order_by = model.depth_get_column(self.sort.split(".")).asc()
            return query.order_by(order_by)
        else:
            if self.order == SortOrder.DESC or self.order == "desc":
                order_by = sa.text(f"{self.sort} DESC")
            else:
                order_by = sa.text(f"{self.sort} ASC")

            return query.order_by(order_by)

    def apply_sort_field(self, qmodel: InstrumentedAttribute) -> UnaryExpression[Any]:
        if self.order == SortOrder.DESC:
            return qmodel.desc()
        else:
            return qmodel.asc()

    def apply_pagination_sort(
        self, query: sa.Select, model: type[db.Base] | None = None
    ) -> sa.Select:
        query = self.apply_sort(query, model)
        query = self.apply_pagination(query)
        return query


class PaginationSortSearchQueryParams(PaginationSortQueryParams):
    query: str = Field("")
    fields: list[str] = Field(Query(default=[]))

    def apply_search(self, query: sa.Select, model: type[db.Base]) -> sa.Select:
        return apply_search(model, query, self.query, self.fields)


@dataclass
class PaginationSortSearchParams(PaginationSortParams):
    query: str = ""
    fields: list[str] = field(default_factory=list)

    def apply_search(self, query: sa.Select, model: type[db.Base]) -> sa.Select:
        if self.query and not self.fields:
            raise errors.ApiHTTPException(
                status_code=400,
                detail=[
                    errors.ApiExc(
                        code="invalid_search",
                        msg="If you provide a search query, you must also provide fields to search in.",
                    )
                ],
            )

        columns = [model.depth_get_column(field.split(".")) for field in self.fields]
        search_query = f"%{self.query}%"
        if not columns:
            return query
        return query.where(sa.or_(*[column.ilike(search_query) for column in columns]))

    def apply_sort(
        self, query: sa.Select, model: type[db.Base] | None = None
    ) -> sa.Select:
        if self.sort.startswith("similarity"):
            try:
                sort = self.sort.split(":")[1]
            except IndexError:
                raise errors.ApiHTTPException(
                    status_code=400,
                    detail=[
                        errors.ApiExc(
                            code="invalid_sort",
                            msg="If using similarity sort, you must specify the column to sort by. Example: similarity:name",
                        )
                    ],
                )
            column = sa.func.word_similarity(
                model.depth_get_column(sort.split(".")), self.query
            )
            if sort == "asc":
                order_by = column.asc()
            else:
                order_by = column.desc()
            return query.order_by(order_by)
        else:
            return super().apply_sort(query, model)
