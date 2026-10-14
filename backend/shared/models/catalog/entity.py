"""The game catalog of every discipline: characters, maps and modes (D84, D85, D101, spec §14.2).

One table for every kind, so a fact, a pick-ban pool or a game names an entity the same way in any game. ``kind`` is
the core's vocabulary (``shared.disciplines.CATALOG_KINDS``); what a kind is called in a game's UI is the module's
label. A map's mode is its ``parent``; a hero's or champion's class is ``attrs["class"]``. A reference from another
table is a composite FK onto ``(id, kind[, discipline])`` with a kind-constant column on the referencing side.

``CatalogEntityLegacy`` maps the old ``overwatch.hero/map/gamemode`` ids onto these rows for the reconcile and the
redirect of old URLs; ``discipline02`` drops it with ``overwatch.*``.
"""

from __future__ import annotations

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    ForeignKey,
    ForeignKeyConstraint,
    String,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from shared.core import db

__all__ = ("CatalogEntity", "CatalogEntityLegacy")


class CatalogEntity(db.TimeStampIntegerMixin):
    __tablename__ = "entity"
    __table_args__ = (
        CheckConstraint("kind IN ('character', 'map', 'mode')", name="ck_entity_kind"),
        CheckConstraint("jsonb_typeof(attrs) = 'object'", name="ck_entity_attrs"),
        CheckConstraint("jsonb_typeof(aliases) = 'array'", name="ck_entity_aliases"),
        UniqueConstraint("discipline", "kind", "slug", name="uq_entity_slug"),
        UniqueConstraint("discipline", "kind", "name", name="uq_entity_name"),
        UniqueConstraint("id", "kind", name="uq_entity_id_kind"),
        UniqueConstraint("id", "discipline", name="uq_entity_id_discipline"),
        UniqueConstraint("id", "discipline", "kind", name="uq_entity_key"),
        ForeignKeyConstraint(
            ["parent_id", "discipline"], ["catalog.entity.id", "catalog.entity.discipline"], name="fk_entity_parent"
        ),
        {"schema": "catalog"},
    )

    discipline: Mapped[str] = mapped_column(
        String(32), ForeignKey("catalog.discipline.code", name="fk_entity_discipline")
    )
    kind: Mapped[str] = mapped_column(String(16))
    slug: Mapped[str] = mapped_column(String(64))
    name: Mapped[str] = mapped_column(String(128))
    image_path: Mapped[str | None] = mapped_column(String(), nullable=True)
    parent_id: Mapped[int | None] = mapped_column(BigInteger(), nullable=True)
    # NOTE: JSONB does not track in-place mutation — always reassign ``attrs``/``aliases``.
    attrs: Mapped[dict] = mapped_column(JSONB(), nullable=False, default=dict, server_default=text("'{}'::jsonb"))
    #: Names this entity answers to in match logs beyond ``name``.
    aliases: Mapped[list[str]] = mapped_column(
        JSONB(), nullable=False, default=list, server_default=text("'[]'::jsonb")
    )
    #: The sync never deletes; a row it no longer sees stays (deactivation lands with its first reader, P7).
    active: Mapped[bool] = mapped_column(Boolean(), nullable=False, default=True, server_default=text("true"))

    parent: Mapped[CatalogEntity | None] = relationship(
        primaryjoin="foreign(CatalogEntity.parent_id) == remote(CatalogEntity.id)", viewonly=True
    )


class CatalogEntityLegacy(db.Base):
    __tablename__ = "entity_legacy"
    __table_args__ = (
        CheckConstraint("legacy_kind IN ('hero', 'map', 'gamemode')", name="ck_entity_legacy_kind"),
        {"schema": "catalog"},
    )

    legacy_kind: Mapped[str] = mapped_column(String(16), primary_key=True, autoincrement=False)
    legacy_id: Mapped[int] = mapped_column(BigInteger(), primary_key=True, autoincrement=False)
    entity_id: Mapped[int] = mapped_column(ForeignKey("catalog.entity.id", name="fk_entity_legacy_entity"))
