"""The disciplines the platform knows about (D48).

A stub registry: a code and a label, nothing more. It exists so every owner's
``discipline`` column has something to reference and so a typo cannot reach the
match layer. The real article -- the ontology, the per-discipline catalog and
the sync from code at startup -- arrives in V3.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import String, func
from sqlalchemy.orm import Mapped, mapped_column

from shared.core import db

__all__ = ("Discipline",)


class Discipline(db.Base):
    __tablename__ = "discipline"
    __table_args__ = ({"schema": "catalog"},)

    #: ``overwatch`` -- the only row in V1.
    code: Mapped[str] = mapped_column(String(32), primary_key=True)
    name: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(db.DateTime(timezone=True), server_default=func.now())
