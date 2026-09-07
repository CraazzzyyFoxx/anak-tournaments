from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import BigInteger, DateTime, Index, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from shared.core import db

__all__ = ("AuditLog",)


class AuditLog(db.Base):
    """Platform-wide "who did this" trail, append-only.

    Inherits ``db.Base`` rather than ``db.TimeStampIntegerMixin``: a row is
    written once inside the mutation's own transaction and never touched again,
    so ``updated_at`` on it could only ever hold a lie.

    The table carries NO foreign keys -- the same convention ``event_outbox``
    and ``realtime.workspace_event`` already follow, and for the same reason: an
    append-only journal has to outlive the business rows it talks about.
    ``ON DELETE CASCADE`` would take the history of a deleted tournament away
    with the tournament, and ``ON DELETE SET NULL`` would blank the actor of a
    deleted account, turning "who did this" into "nobody" -- which is exactly
    the question the journal exists to answer. The paired ``*_label`` columns
    are the snapshots that keep a row readable once its referent is gone.
    """

    __tablename__ = "audit_log"
    __table_args__ = (
        # Every read is "newest first" over one of three prefixes: a workspace
        # feed, one entity's history, one actor's activity. Filters on
        # ``action``/``source`` stay heap filters on purpose -- at ~45 MB/year a
        # fourth composite index would tax every INSERT to save nothing
        # measurable, the same trade the ``encounter_result_audit`` index makes.
        Index("ix_audit_log_workspace_created", "workspace_id", "created_at"),
        Index("ix_audit_log_entity_created", "entity_type", "entity_id", "created_at"),
        Index("ix_audit_log_actor_created", "actor_auth_user_id", "created_at"),
    )

    id: Mapped[int] = mapped_column(BigInteger(), primary_key=True, autoincrement=True)
    # ``func.now()`` is ``transaction_timestamp()``: the time the transaction
    # STARTED, not the time of the INSERT. A long transaction therefore lands a
    # high ``id`` under an early timestamp, so ``id`` order is NOT time order --
    # reads sort and index on ``created_at`` and use ``id`` only as a tiebreaker
    # (``created_at DESC, id DESC``).
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    # NULL = platform-level event with no workspace in nature (game catalog,
    # global settings, global roles); visible to superadmins only. The value
    # written here is the one authorization already checked the mutation
    # against, never re-derived: a divergence would mean the action was
    # authorized in one workspace and recorded in another.
    workspace_id: Mapped[int | None] = mapped_column(BigInteger(), nullable=True)
    # NULL = machine actor (scheduler, Challonge import, cascade), which is how
    # the trail tells it apart from a human without guessing.
    actor_auth_user_id: Mapped[int | None] = mapped_column(BigInteger(), nullable=True)
    actor_label: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # ``admin`` | ``api_key`` | ``challonge`` | ``discord`` | ``scheduler`` | ``system``;
    # a required keyword of ``record_audit``. ``api_key`` is inferred from the actor.
    source: Mapped[str] = mapped_column(String(16), nullable=False)
    action: Mapped[str] = mapped_column(String(64), nullable=False)
    entity_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    entity_id: Mapped[int | None] = mapped_column(BigInteger(), nullable=True)
    entity_label: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Assembled by the caller from NAMED domain fields, never from a raw request
    # payload: there is nothing to redact if nothing was captured wholesale, so
    # "no secrets in the journal" holds structurally instead of by denylist.
    # NOTE: JSONB does not track in-place mutation -- always reassign.
    before_json: Mapped[dict[str, Any] | None] = mapped_column(JSONB(), nullable=True)
    after_json: Mapped[dict[str, Any] | None] = mapped_column(JSONB(), nullable=True)
    reason: Mapped[str | None] = mapped_column(Text(), nullable=True)
    # 45 chars is the longest textual IPv6 form (IPv4-mapped, with a zone id).
    ip_address: Mapped[str | None] = mapped_column(String(45), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Stitches the row to the Loki/Tempo trace of the same request.
    correlation_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
