"""add workspace subscription requirement table

Creates ``subscriptions.requirement`` -- one ``default`` row per workspace holding
the rule ``{mode, requirements: [{provider, min_tier_rank}]}`` that until now lived
per tournament in ``balancer.registration_form.subscription_requirement_json``.

This is the EXPAND half of an expand/contract pair; the contract half (``wsreq0002``)
drops the form column. They are deliberately separate revisions because they need
opposite orderings relative to the code roll:

- create BEFORE the code roll -- the new ``load_requirement`` selects this table, so
  it must exist before any service that queries it starts;
- drop AFTER the code roll -- the old ORM still maps ``subscription_requirement_json``
  and SQLAlchemy emits every mapped column in every SELECT, so dropping it while the
  previous release is still serving would break every registration-form read.

The backfill elects one rule per workspace, and "configured" is decided SEMANTICALLY,
not textually: a form counts only when its blob holds a non-empty ``requirements``
array. The old wizard seeded ``{"mode": "all", "requirements": []}`` into every form
it created, so most rows carry that rather than ``{}`` -- and it means exactly what
``{}`` means, namely no rule (the old gates never called a provider for it).
Comparing the rendered text against ``'{}'`` would therefore count every such form as
a configured rule: workspaces holding nothing but empty-but-present blobs would each
get a pointless ``default`` row, making "no rule" and "empty rule" indistinguishable
in the one table whose whole purpose is to answer that question, and the guard below
would report ambiguity for workspaces whose forms differ only in whitespace or key
order. The predicate is wrapped in ``jsonb_typeof`` -- the pattern this repo already
standardises on, see ``dbarch03._as_jsonb_array`` and ``dbarch05`` -- so a JSON
scalar or a wrong container collapses to "not configured" instead of raising.

When a workspace holds MORE than one distinct rule there is no correct answer, so the
migration aborts with the offending workspace ids rather than picking one: silently
choosing an admission rule would quietly change who may register. That check is a
``DO $$ ... RAISE EXCEPTION $$`` block (the shape used by ``dbarch02`` and
``dbarch03``) rather than a Python-side query, so it is emitted into -- and enforced
by -- an offline ``--sql`` script as well, and a DBA reading that script can see the
check exists at all. To be honest about what that buys: the offline path was never
silently WRONG, because two rules in one workspace would collide on
``uq_subscription_requirement_workspace_name`` either way. It just failed with a
constraint-violation message naming an index instead of an actionable one naming the
workspaces to fix.

Revision ID: wsreq0001
Revises: wsguild0002
Create Date: 2026-08-05

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "wsreq0001"
down_revision: str | Sequence[str] | None = "wsguild0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA = "subscriptions"

# "Configured" means a non-empty ``requirements`` array -- see the docstring for why
# the textual `!= '{}'` test is wrong. The ``jsonb_typeof`` check comes first so a
# JSON scalar or a wrong container cannot make ``jsonb_array_length`` raise; ``->`` on
# a non-object jsonb yields SQL NULL, which ``jsonb_typeof`` reports as NULL and the
# comparison rejects. Used by BOTH the guard and the backfill so the two agree on what
# "configured" means.
_CONFIGURED = (
    "jsonb_typeof((f.subscription_requirement_json::jsonb) -> 'requirements') = 'array' "
    "and jsonb_array_length((f.subscription_requirement_json::jsonb) -> 'requirements') > 0"
)


def upgrade() -> None:
    # Column types mirror db.TimeStampIntegerMixin exactly: BigInteger pk,
    # created_at with a server default, updated_at nullable with NO server
    # default (the mixin sets it via onupdate).
    op.create_table(
        "requirement",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("workspace_id", sa.BigInteger(), nullable=False),
        sa.Column("name", sa.String(64), nullable=False, server_default="default"),
        sa.Column("requirement_json", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("is_default", sa.Boolean(), nullable=False, server_default="false"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspace.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("workspace_id", "name", name="uq_subscription_requirement_workspace_name"),
        schema=SCHEMA,
    )
    op.create_index(
        op.f("ix_subscriptions_requirement_workspace_id"),
        "requirement",
        ["workspace_id"],
        schema=SCHEMA,
    )
    # At most one default rule per workspace -- enforced in the database rather
    # than in the service, because the read path picks the default row blindly.
    op.create_index(
        "uq_subscription_requirement_one_default",
        "requirement",
        ["workspace_id"],
        unique=True,
        postgresql_where=sa.text("is_default"),
        schema=SCHEMA,
    )

    # Ambiguity guard, expressed as plpgsql so it travels WITH the migration script:
    # it runs identically online and under `--sql`, where a Python-side
    # `conn.execute` returns None and the check would vanish from the render
    # entirely. `count(distinct ...::jsonb)` compares parsed values, so differing
    # whitespace or key order cannot manufacture false ambiguity.
    op.execute(
        f"""
        DO $$
        DECLARE
            ambiguous bigint[];
        BEGIN
            SELECT array_agg(workspace_id ORDER BY workspace_id) INTO ambiguous
            FROM (
                SELECT t.workspace_id
                FROM balancer.registration_form f
                JOIN tournament.tournament t ON t.id = f.tournament_id
                WHERE {_CONFIGURED}
                GROUP BY t.workspace_id
                HAVING count(DISTINCT f.subscription_requirement_json::jsonb) > 1
            ) s;
            IF ambiguous IS NOT NULL THEN
                RAISE EXCEPTION
                    'wsreq0001: cannot elect a default subscription requirement for '
                    'workspace(s) %: each holds more than one distinct rule. Resolve by hand '
                    '(pick the intended rule per workspace and clear the others) before '
                    'migrating -- silently choosing an admission rule is exactly the failure '
                    'this guard exists to prevent.', ambiguous;
            END IF;
        END $$;
        """
    )

    # One row per workspace via `DISTINCT ON` over the scalar key -- never a bare
    # `DISTINCT` over the select list, because `subscription_requirement_json` is
    # `json`, a type with no equality operator, so a `json` column in a DISTINCT list
    # is rejected at PLAN time on every row count. `DISTINCT ON` is correct here
    # precisely because the guard above has already proven there is exactly one
    # distinct rule per workspace, which makes the tiebreaker immaterial. Same shape
    # as `wsguild0001` step 2.
    op.execute(
        f"""
        insert into subscriptions.requirement (workspace_id, name, requirement_json, is_default)
        select distinct on (t.workspace_id)
               t.workspace_id, 'default', f.subscription_requirement_json, true
          from balancer.registration_form f
          join tournament.tournament t on t.id = f.tournament_id
         where {_CONFIGURED}
         order by t.workspace_id, f.id
        """
    )


def downgrade() -> None:
    # Nothing to restore: this is the expand half, so
    # balancer.registration_form.subscription_requirement_json still exists and
    # still holds the per-tournament rule the backfill copied from.
    op.drop_index("uq_subscription_requirement_one_default", "requirement", schema=SCHEMA)
    op.drop_index(op.f("ix_subscriptions_requirement_workspace_id"), "requirement", schema=SCHEMA)
    op.drop_table("requirement", schema=SCHEMA)
