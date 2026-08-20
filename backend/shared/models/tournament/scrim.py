"""Ad-hoc pre-game rooms ("scrims") that exist outside any real tournament.

Design: ``docs/plans/2026-08-12-scrim-rooms.md``.

A scrim reuses the whole pick-ban stack unchanged, so it must present itself as
an ordinary encounter: ``PickBanSession.encounter_id`` is NOT NULL, and
``Encounter.tournament_id``/``Team.tournament_id`` are too. The rows that
satisfy those FKs live in ONE hidden container tournament per workspace, with
per-room isolation carried by a :class:`~shared.models.tournament.stage.Stage`.

One container per workspace rather than one per room, because ``Tournament.id``
is read as an *ordinal season timeline* by the ML layer (fold boundaries in
``analytics-service .../ml/training/splits.py``, ``max(Tournament.id)`` as
"latest" in ``.../ml/training/backtest.py``): a throwaway tournament per scrim
would inject data-less boundaries into it.

This table holds only what those reused rows cannot answer — the share token and
"list my scrims". Everything else about a room is read off the encounter it
points at.
"""

from datetime import datetime

from sqlalchemy import ForeignKey, Index, String, UniqueConstraint, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from shared.core import db
from shared.models.tournament.encounter import Encounter
from shared.models.tournament.stage import Stage
from shared.models.tournament.tournament import Tournament

__all__ = ("ScrimRoom",)


class ScrimRoom(db.TimeStampIntegerMixin):
    """One scrim room: a share token over a provisioned encounter."""

    __tablename__ = "scrim_room"
    __table_args__ = (
        UniqueConstraint("token", name="uq_scrim_room_token"),
        # The room's encounter is its identity from the pick-ban side; two rooms
        # pointing at one encounter would give it two tokens and two histories.
        UniqueConstraint("encounter_id", name="uq_scrim_room_encounter"),
        # The per-user active-room cap (``Settings["tournament.scrim"]``) counts
        # exactly this: open rooms of one creator. Partial so closed history —
        # which is kept forever and is the bulk of the table — costs nothing.
        Index(
            "ix_scrim_room_open_by_creator",
            "created_by_auth_user_id",
            postgresql_where=text("closed_at IS NULL"),
        ),
        {"schema": "tournament"},
    )

    # URL-safe, generated server-side. The room's only address: knowing it is
    # what lets an opponent claim the free side, so it is unguessable, not
    # sequential.
    token: Mapped[str] = mapped_column(String(32), nullable=False)
    label: Mapped[str] = mapped_column(String(255), nullable=False)

    # Denormalised from ``tournament.workspace_id``: every read of a room list is
    # workspace-scoped, and the container tournament is an implementation detail
    # this table should not force a join through.
    workspace_id: Mapped[int] = mapped_column(ForeignKey("workspace.id", ondelete="CASCADE"), index=True)
    tournament_id: Mapped[int] = mapped_column(ForeignKey(Tournament.id, ondelete="CASCADE"), index=True)
    stage_id: Mapped[int] = mapped_column(ForeignKey(Stage.id, ondelete="CASCADE"), index=True)
    encounter_id: Mapped[int] = mapped_column(ForeignKey(Encounter.id, ondelete="CASCADE"), index=True)
    created_by_auth_user_id: Mapped[int] = mapped_column(ForeignKey("auth.user.id", ondelete="CASCADE"), index=True)

    # Frees the creator's cap slot. NOT a delete: scrim history is kept, and the
    # room stays readable by its participants for as long as the encounter does.
    closed_at: Mapped[datetime | None] = mapped_column(db.DateTime(timezone=True), nullable=True)

    tournament: Mapped[Tournament] = relationship()
    stage: Mapped[Stage] = relationship()
    encounter: Mapped[Encounter] = relationship()
