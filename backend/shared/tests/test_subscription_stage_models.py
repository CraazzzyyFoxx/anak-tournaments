"""Pin ``registration_form.subscription_stage`` — the enum and the column.

The column is ONE ``NOT NULL VARCHAR(16)`` defaulting to ``check_in``, and every
part of that shape is load-bearing:

- **The width** must fit the longest enum member, or that member fails to insert.
- **The default on both sides** — ``default`` covers an ORM insert,
  ``server_default`` a raw one; disagreeing would make a form's stage depend on
  which code path created it.
- **The default VALUE** is the whole behaviour decision. The gate once ran at
  both stages unconditionally; ``check_in`` deliberately LOOSENS it to
  check-in-only. Flipping it to ``registration`` would silently start refusing
  sign-ups on live tournaments, so it is pinned here rather than left to a
  reviewer noticing a one-word diff.

These tests compile the model against the Postgres dialect. The assertions that
read the ``substage0001`` revision file -- its ``server_default``, its backfill
statement, its downgrade -- went away with the ``initial_v6`` squash, which
replaced every per-revision file with one generated baseline.
"""

from __future__ import annotations

import re

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from sqlalchemy.schema import CreateTable

from shared import models
from shared.core.enums import SubscriptionEnforcementStage

COLUMN = "subscription_stage"
DEFAULT = SubscriptionEnforcementStage.check_in.value
WIDTH = 16


def _form_ddl() -> str:
    table = models.BalancerRegistrationForm.__table__
    return str(CreateTable(table).compile(dialect=postgresql.dialect()))


class TestTheEnum:
    def test_only_two_stages_exist(self):
        """Off is ``require_subscription=False``, not a third member: a stage nobody
        can reach is a stage somebody will eventually store."""
        assert [m.value for m in SubscriptionEnforcementStage] == ["registration", "check_in"]

    def test_every_member_fits_the_column(self):
        assert max(len(m.value) for m in SubscriptionEnforcementStage) <= WIDTH


class TestTheModel:
    def test_the_column_exists_and_is_not_nullable(self):
        column = models.BalancerRegistrationForm.__table__.columns[COLUMN]
        assert column.nullable is False

    def test_the_column_is_a_string_of_the_migrated_width(self):
        column = models.BalancerRegistrationForm.__table__.columns[COLUMN]
        assert isinstance(column.type, sa.String)
        assert column.type.length == WIDTH

    def test_the_model_defaults_to_check_in_on_both_sides(self):
        """``default`` covers an ORM insert, ``server_default`` a raw one and the
        migration's own backfill. Disagreeing would make a form's stage depend on
        which code path created it."""
        column = models.BalancerRegistrationForm.__table__.columns[COLUMN]
        assert column.default.arg == DEFAULT
        assert DEFAULT in str(column.server_default.arg)

    def test_the_compiled_ddl_carries_the_default(self):
        ddl = _form_ddl()
        assert re.search(rf"{COLUMN} VARCHAR\({WIDTH}\) DEFAULT '{DEFAULT}' NOT NULL", ddl), ddl
