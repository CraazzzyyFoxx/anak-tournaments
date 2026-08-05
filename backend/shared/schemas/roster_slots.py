"""The Pydantic edge of the roster shape: one field type, four schemas.

``TournamentCreate``/``TournamentUpdate`` (tournament-service) and
``WorkspaceCreate``/``WorkspaceUpdate`` (app-service) all accept the same raw
slot map from the same admin form, so the normalize-or-reject step lives here
once instead of being copy-pasted per schema -- the mirroring this whole feature
exists to remove.

It cannot live in ``shared.domain.roster_shape``: that module is deliberately
Pydantic-free so the balancer and draft domain logic can import it without a
web-schema dependency. This module is the one place that bridges the two.

The bound field stores the **normalized** map, never the raw input, so the JSONB
column can never hold a zero count (which would make
``RosterShape.has_role_slots`` answer on key presence instead of real slots).
"""

from __future__ import annotations

from typing import Annotated, Any

from pydantic import BeforeValidator

from shared.domain.roster_shape import RosterShapeError, parse_roster_slots

__all__ = ("RosterSlotsField", "normalize_roster_slots")


def normalize_roster_slots(value: Any) -> Any:
    """``None`` passes through (clear the override); anything else is normalized.

    ``RosterShapeError`` already subclasses ``ValueError``, so Pydantic would
    turn it into a validation error on its own -- but it carries the
    machine-readable ``code`` in an attribute the message never mentions, and the
    frontend localizes off that code. So it is re-raised with the code prefixed
    into the message, which is what survives into the 422 body.
    """
    if value is None:
        return None
    try:
        return parse_roster_slots(value).slots
    except RosterShapeError as exc:
        raise ValueError(f"{exc.code}: {exc}") from exc


RosterSlotsField = Annotated[dict[str, int] | None, BeforeValidator(normalize_roster_slots)]
