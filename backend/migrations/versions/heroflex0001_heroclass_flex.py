"""add the `flex` heroclass label and pin it to roster roles only

Revision ID: heroflex0001
Revises: audit0001

``heroclass`` is one Postgres type backing three columns with opposite needs:
``tournament.player.role`` gains a fourth value (a player who holds no fixed
role -- what a role-less, all-``flex`` roster shape drafts for), while
``overwatch.hero.type`` and ``matches.stat_baselines.role`` must stay
three-valued -- no hero has a class of "flex", and no baseline can be computed
for one. Postgres cannot narrow a shared enum per column, so the two hero-side
columns get CHECK constraints instead.

Downgrade drops the constraints but keeps the label: Postgres cannot remove an
enum value, and rebuilding the type would have to rewrite every dependent
column. ``flex`` is therefore forward-only; the constraints are the reversible
part.
"""

from alembic import op

revision = "heroflex0001"
down_revision = "audit0001"
branch_labels = None
depends_on = None

# Stored labels are the member NAMES of shared.core.enums.HeroClass (SQLAlchemy
# `Enum` default, confirmed by a7634c02717d), so the label is lowercase `flex`
# while the Python value is "Flex".
_FLEX_LABEL = "flex"

# The comparisons below cast to ``text`` deliberately. PG12+ allows ADD VALUE
# inside a transaction only while the new value is not USED in it, and a CHECK
# written as ``type <> 'flex'::heroclass`` would use it -- the cast keeps this a
# plain text comparison so both statements fit in one migration.
_HERO_TYPE_CHECK = "ck_hero_type_not_flex"
_BASELINE_ROLE_CHECK = "ck_stat_baselines_role_not_flex"


def upgrade() -> None:
    op.execute(f"ALTER TYPE heroclass ADD VALUE IF NOT EXISTS '{_FLEX_LABEL}'")
    op.create_check_constraint(
        _HERO_TYPE_CHECK,
        "hero",
        f"type::text <> '{_FLEX_LABEL}'",
        schema="overwatch",
    )
    op.create_check_constraint(
        _BASELINE_ROLE_CHECK,
        "stat_baselines",
        f"role::text <> '{_FLEX_LABEL}'",
        schema="matches",
    )


def downgrade() -> None:
    op.drop_constraint(_BASELINE_ROLE_CHECK, "stat_baselines", schema="matches", type_="check")
    op.drop_constraint(_HERO_TYPE_CHECK, "hero", schema="overwatch", type_="check")
