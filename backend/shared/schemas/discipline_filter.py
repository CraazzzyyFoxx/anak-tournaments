"""Query filter type for list reads narrowed to one installed game."""

from __future__ import annotations

import typing

from pydantic import BaseModel, BeforeValidator

from shared.disciplines import DISCIPLINES


def _installed(value: typing.Any) -> typing.Any:
    # A bogus code is a 422 for the caller to show, never an empty list or another game's rows.
    if value is not None and value not in DISCIPLINES:
        raise ValueError(f"discipline_not_installed: {value!r}")
    return value


#: ``discipline`` query filter of a public list read: absent means every game, anything else
#: must be an installed discipline code.
InstalledDisciplineFilter = typing.Annotated[str | None, BeforeValidator(_installed)]


class DisciplineFilterQuery(BaseModel):
    """Query model of a list read whose only filter is the game."""

    discipline: InstalledDisciplineFilter = None
