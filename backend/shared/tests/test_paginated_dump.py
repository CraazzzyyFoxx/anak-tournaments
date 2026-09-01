"""``paginated_dump`` must never enumerate the envelope's keys.

The regression it exists to prevent: the api-key list computes
``available_scopes`` alongside the four pagination keys, a hand-rolled
serializer rebuilt only those four, and the create form silently offered no
scopes at all. Any list reply that grows a key must get it on the wire for free.
"""

from pydantic import BaseModel

from shared.core.pagination import PaginationParams, paginated_dict, paginated_dump


class _Row(BaseModel):
    id: int
    name: str


class _Counts(BaseModel):
    total: int
    active: int


def test_extra_keys_survive_serialization() -> None:
    envelope = paginated_dump(
        {
            "results": [_Row(id=1, name="ana")],
            "total": 1,
            "page": 1,
            "per_page": 20,
            "counts": _Counts(total=1, active=1),
            "available_scopes": ["team.create", "team.read"],
        }
    )

    # Pydantic extras serialized, plain extras copied as-is.
    assert envelope["counts"] == {"total": 1, "active": 1}
    assert envelope["available_scopes"] == ["team.create", "team.read"]
    assert envelope["results"] == [{"id": 1, "name": "ana"}]
    assert (envelope["total"], envelope["page"], envelope["per_page"]) == (1, 1, 20)


def test_plain_dict_results_pass_through_untouched() -> None:
    # Handlers that build rows from a raw SQL result already hold dicts.
    rows = [{"user_id": 7, "count": 3}]
    assert paginated_dump({"results": rows, "total": 1, "page": 2, "per_page": 5})["results"] == rows


def test_dump_of_paginated_dict_carries_all_four_keys() -> None:
    envelope = paginated_dump(paginated_dict([_Row(id=1, name="ana")], 9, PaginationParams(page=2, per_page=5)))

    assert set(envelope) == {"results", "total", "page", "per_page"}
    assert (envelope["total"], envelope["page"], envelope["per_page"]) == (9, 2, 5)
