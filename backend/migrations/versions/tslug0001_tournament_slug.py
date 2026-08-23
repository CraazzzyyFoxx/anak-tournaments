"""Add ``tournament.tournament.slug`` and ``tournament.slug_redirect``.

Revision ID: tslug0001
Revises: wshidden01
Create Date: 2026-08-23 00:00:00.000000

The public tournament route (``/tournaments/{slug}``) stops exposing the bare
numeric id. ``slug`` is generated once from ``name`` at creation and frozen
afterward (see ``shared.services.tournament_slug``); an explicit admin rename
writes the retired value into ``slug_redirect`` so links already shared keep
resolving. Uniqueness is GLOBAL, not per-workspace: the public route carries no
workspace segment, so two organizers' "season-1" would otherwise collide.

The backfill below is a best-effort SQL transliteration (this community's
tournament names are frequently Russian) run once for existing rows; every
tournament created after this migration gets its slug from the same algorithm
in ``shared.services.tournament_slug.slugify`` instead. Collisions within the
backfill are disambiguated with a ``-2``, ``-3``, ... suffix ordered by id.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "tslug0001"
down_revision: str | Sequence[str] | None = "wshidden01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Cyrillic digraphs must be substituted before the single-character TRANSLATE
# below (ж/ц/ч/ш/щ/ю/я have no one-character Latin equivalent; ъ/ь drop).
_DIGRAPHS = (
    ("ж", "zh"), ("ц", "ts"), ("ч", "ch"), ("ш", "sh"), ("щ", "sch"),
    ("ю", "yu"), ("я", "ya"), ("ъ", ""), ("ь", ""),
)
_SINGLE_PAIRS = (
    ("а", "a"), ("б", "b"), ("в", "v"), ("г", "g"), ("д", "d"), ("е", "e"),
    ("ё", "e"), ("з", "z"), ("и", "i"), ("й", "y"), ("к", "k"), ("л", "l"),
    ("м", "m"), ("н", "n"), ("о", "o"), ("п", "p"), ("р", "r"), ("с", "s"),
    ("т", "t"), ("у", "u"), ("ф", "f"), ("х", "h"), ("ы", "y"), ("э", "e"),
)
_SINGLE_SRC = "".join(src for src, _ in _SINGLE_PAIRS)
_SINGLE_DST = "".join(dst for _, dst in _SINGLE_PAIRS)

_BACKFILL_SQL = """
WITH base AS (
    SELECT
        id,
        NULLIF(
            trim(both '-' from regexp_replace(translate({name_expr}, :src, :dst), '[^a-z0-9]+', '-', 'g')),
            ''
        ) AS base_slug
    FROM tournament.tournament
),
ranked AS (
    SELECT
        id,
        COALESCE(base_slug, 'tournament') AS base_slug,
        row_number() OVER (PARTITION BY COALESCE(base_slug, 'tournament') ORDER BY id) AS rn
    FROM base
)
UPDATE tournament.tournament AS t
SET slug = CASE WHEN ranked.rn = 1 THEN ranked.base_slug ELSE ranked.base_slug || '-' || ranked.rn END
FROM ranked
WHERE ranked.id = t.id
"""


def upgrade() -> None:
    op.add_column("tournament", sa.Column("slug", sa.String(), nullable=True), schema="tournament")

    name_expr = "lower(name)"
    for src, dst in _DIGRAPHS:
        name_expr = f"replace({name_expr}, '{src}', '{dst}')"
    op.execute(
        sa.text(_BACKFILL_SQL.format(name_expr=name_expr)).bindparams(src=_SINGLE_SRC, dst=_SINGLE_DST)
    )

    op.alter_column("tournament", "slug", nullable=False, schema="tournament")
    op.create_index(
        op.f("ix_tournament_tournament_slug"),
        "tournament",
        ["slug"],
        unique=True,
        schema="tournament",
    )

    op.create_table(
        "slug_redirect",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("old_slug", sa.String(), nullable=False),
        sa.Column("tournament_id", sa.BigInteger(), nullable=False),
        sa.ForeignKeyConstraint(["tournament_id"], ["tournament.tournament.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        schema="tournament",
    )
    op.create_index(
        op.f("ix_tournament_slug_redirect_old_slug"),
        "slug_redirect",
        ["old_slug"],
        unique=True,
        schema="tournament",
    )
    op.create_index(
        op.f("ix_tournament_slug_redirect_tournament_id"),
        "slug_redirect",
        ["tournament_id"],
        unique=False,
        schema="tournament",
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_tournament_slug_redirect_tournament_id"), table_name="slug_redirect", schema="tournament")
    op.drop_index(op.f("ix_tournament_slug_redirect_old_slug"), table_name="slug_redirect", schema="tournament")
    op.drop_table("slug_redirect", schema="tournament")
    op.drop_index(op.f("ix_tournament_tournament_slug"), table_name="tournament", schema="tournament")
    op.drop_column("tournament", "slug", schema="tournament")
