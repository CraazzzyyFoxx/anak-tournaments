"""Guard ``substage0001`` — ``registration_form.subscription_stage`` — against drift.

The revision adds ONE ``NOT NULL VARCHAR(16)`` column with a server default of
``check_in``, and every part of that shape is load-bearing:

- **The width** must match the model, or the longest enum member fails to insert.
- **The server default** is what makes the column ``NOT NULL``-safe on a table with
  existing rows, and it is also the value the backfill relies on.
- **The default VALUE** is the whole behaviour decision. Before this revision the
  gate ran at both stages unconditionally; defaulting to ``check_in`` deliberately
  LOOSENS every existing tournament to check-in-only. Flipping it to
  ``registration`` would silently start refusing sign-ups on live tournaments, so
  it is pinned here rather than left to a reviewer noticing a one-word diff.

A metadata check: the models are compiled against the Postgres dialect and the
revision is parsed, so no live database is needed. Not a substitute for applying
the revision — run ``alembic upgrade heads`` against a real database too.
"""

from __future__ import annotations

import pathlib
import re

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from sqlalchemy.schema import CreateTable

from shared import models
from shared.core.enums import SubscriptionEnforcementStage

MIGRATION = (
    pathlib.Path(__file__).resolve().parents[2] / "migrations" / "versions" / "substage0001_add_subscription_stage.py"
)
COLUMN = "subscription_stage"
DEFAULT = SubscriptionEnforcementStage.check_in.value
WIDTH = 16


def _text() -> str:
    return MIGRATION.read_text(encoding="utf-8")


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


class TestTheRevision:
    def test_it_follows_the_roster_drop(self):
        text = _text()
        assert re.search(r'^revision: str = "substage0001"', text, re.M)
        assert re.search(r'^down_revision.*=\s*"roster0002"', text, re.M)

    def test_it_adds_the_column_to_the_balancer_schema(self):
        text = _text()
        assert f'"{COLUMN}"' in text
        assert 'schema="balancer"' in text
        assert "sa.String(length=16)" in text

    def test_it_defaults_and_backfills_to_check_in_not_registration(self):
        """THE behaviour assertion: backfilling ``registration`` would turn the
        loosening this revision exists to perform into a tightening."""
        text = _text()
        assert f'_CHECK_IN = "{DEFAULT}"' in text
        assert "server_default=_CHECK_IN" in text
        assert f"set subscription_stage = '{{_CHECK_IN}}'" in text
        assert '"registration"' not in text.split("def upgrade")[1]

    def test_downgrade_drops_the_column(self):
        assert re.search(rf'op\.drop_column\(\s*"registration_form",\s*"{COLUMN}"', _text())
