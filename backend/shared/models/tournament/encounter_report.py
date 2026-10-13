"""Per-tournament configuration of the encounter report form.

The reports themselves live in the match layer now
(``shared.models.encounter.report``); what stays here is the organizer's
configuration of WHICH fields those reports offer, which is a property of the
tournament, not of any one encounter.
"""

from typing import Any

from sqlalchemy import JSON, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from shared.core import db

__all__ = ("EncounterReportForm",)


class EncounterReportForm(db.TimeStampIntegerMixin):
    """Per-tournament configuration of the captain match-report form.

    Absent row means "all defaults"; the row is created lazily on the first
    organizer save. ``built_in_fields_json`` maps a built-in field name
    (``closeness``/``map_codes``/``comment``) to ``{enabled, required}``;
    ``custom_fields_json`` is an ordered list of text-field definitions.
    """

    __tablename__ = "encounter_report_form"
    __table_args__ = (
        UniqueConstraint("tournament_id", name="uq_encounter_report_form_tournament"),
        {"schema": "tournament"},
    )

    tournament_id: Mapped[int] = mapped_column(ForeignKey("tournament.tournament.id", ondelete="CASCADE"), index=True)
    built_in_fields_json: Mapped[dict[str, Any]] = mapped_column(
        JSON, nullable=False, server_default="{}", default=dict
    )
    custom_fields_json: Mapped[list[dict[str, Any]]] = mapped_column(
        JSON, nullable=False, server_default="[]", default=list
    )
