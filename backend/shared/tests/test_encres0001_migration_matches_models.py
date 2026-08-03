"""Guard ``encres0001`` against model drift.

The revision hand-writes the DDL for ``tournament.encounter_result_audit`` and a
CHECK constraint whose expression depends on how two PG enums persist their
members — ``encounterstatus`` stores member NAMES (``COMPLETED``) while
``encounterresultstatus`` stores values (``confirmed``). Get that backwards and
the constraint matches nothing while still applying cleanly, which is the worst
possible outcome: an invariant that looks enforced and is not.

These tests compile the models against the Postgres dialect and assert the
properties the migration hard-codes. This is a metadata check, not a substitute
for applying the revision: run ``alembic upgrade heads`` against a real database
too — in particular, the backfill and the pre-constraint assertion cannot be
exercised here.
"""

from __future__ import annotations

import importlib.util
import pathlib
import re

from sqlalchemy.dialects import postgresql
from sqlalchemy.schema import CreateTable

from shared import models
from shared.core import enums

MIGRATION = (
    pathlib.Path(__file__).resolve().parents[2]
    / "migrations"
    / "versions"
    / "encres0001_consolidate_encounter_result_status.py"
)


def _module():
    """Import the revision so the invariant is asserted as evaluated, not as
    source text — the expression is assembled from constants."""
    spec = importlib.util.spec_from_file_location("encres0001", MIGRATION)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _ddl(model) -> str:
    return str(CreateTable(model.__table__).compile(dialect=postgresql.dialect()))


def _text() -> str:
    return MIGRATION.read_text(encoding="utf-8")


class TestRevisionWiring:
    def test_migration_is_present(self):
        assert MIGRATION.is_file(), f"missing {MIGRATION}"

    def test_chains_off_a_committed_revision(self):
        """`down_revision` must not point at uncommitted local work, or this
        migration dangles for anyone who checks out the commit without it."""
        match = re.search(r'^down_revision[^=]*=\s*"([^"]+)"', _text(), re.M)
        assert match, "down_revision must be a single quoted revision id"
        assert match.group(1) == "logretry0001"


class TestInvariantExpression:
    """The CHECK is the whole point of the revision — it makes
    ``completed`` + ``disputed`` unrepresentable rather than merely discouraged."""

    def test_status_is_compared_against_the_member_name(self):
        """``encounterstatus`` deliberately has no values_callable, so PG holds
        the uppercase member name."""
        labels = models.Encounter.__table__.c.status.type.enums
        assert enums.EncounterStatus.COMPLETED.name in labels
        assert enums.EncounterStatus.COMPLETED.value not in labels
        assert _module()._COMPLETED == enums.EncounterStatus.COMPLETED.name

    def test_result_status_is_compared_against_the_member_value(self):
        """``encounterresultstatus`` sets values_callable, so PG holds the
        lowercase value — the opposite of the column beside it."""
        labels = models.Encounter.__table__.c.result_status.type.enums
        assert enums.EncounterResultStatus.CONFIRMED.value in labels
        assert enums.EncounterResultStatus.CONFIRMED.name not in labels
        assert _module()._CONFIRMED == enums.EncounterResultStatus.CONFIRMED.value

    def test_invariant_reads_completed_iff_confirmed(self):
        assert _module()._INVARIANT == "(result_status = 'confirmed') = (status = 'COMPLETED')"

    def test_constraint_name_is_stable(self):
        """Referenced by the downgrade and by the Phase 0 acceptance check."""
        assert _module()._CONSTRAINT == "ck_encounter_result_status_matches_status"


class TestDroppedColumns:
    def test_model_no_longer_maps_them(self):
        columns = set(models.Encounter.__table__.columns.keys())
        assert not columns & {"submitted_by_id", "submitted_at", "confirmed_by_id"}

    def test_confirmed_at_is_kept(self):
        """The only timestamp an admin confirmation with zero captain reports
        leaves behind; lists sort on it without joining the audit."""
        assert "confirmed_at" in models.Encounter.__table__.columns

    def test_migration_drops_exactly_those_three_and_their_fks(self):
        text = _text()
        for column in ("confirmed_by_id", "submitted_by_id", "submitted_at"):
            assert f'op.drop_column("encounter", "{column}"' in text
        assert "fk_encounter_confirmed_by" in text
        assert "fk_encounter_submitted_by" in text


class TestAuditTableDDL:
    def test_audit_enum_labels_match_the_model(self):
        model_labels = list(models.EncounterResultAudit.__table__.c.action.type.enums)
        assert model_labels == [member.value for member in enums.EncounterResultAuditAction]
        text = _text()
        for label in model_labels:
            assert f'"{label}",' in text, f"migration is missing enum label {label!r}"

    def test_pk_is_bigserial(self):
        """db.TimeStampIntegerMixin uses BigInteger, not Integer."""
        assert "id BIGSERIAL NOT NULL" in _ddl(models.EncounterResultAudit)

    def test_encounter_fk_cascades(self):
        """The audit is owned by the encounter: deleting one takes its history."""
        ddl = _ddl(models.EncounterResultAudit)
        assert "FOREIGN KEY(encounter_id) REFERENCES tournament.encounter (id) ON DELETE CASCADE" in ddl
        assert 'ondelete="CASCADE"' in _text()

    def test_actor_and_adopted_team_survive_deletion(self):
        """A deleted account or team must not erase the trail."""
        ddl = _ddl(models.EncounterResultAudit)
        assert 'FOREIGN KEY(actor_user_id) REFERENCES players."user" (id) ON DELETE SET NULL' in ddl
        assert "FOREIGN KEY(adopted_team_id) REFERENCES tournament.team (id) ON DELETE SET NULL" in ddl

    def test_actor_is_nullable_for_machine_decisions(self):
        """Challonge import and the bracket cascade have no human actor, and
        that NULL is how the trail tells them apart from an admin."""
        assert models.EncounterResultAudit.__table__.c.actor_user_id.nullable is True

    def test_source_width_matches(self):
        assert "source VARCHAR(16) NOT NULL" in _ddl(models.EncounterResultAudit)
        assert "sa.String(length=16)" in _text()

    def test_only_the_composite_index_exists(self):
        """(encounter_id, created_at) already serves every lookup; a second
        index on encounter_id alone would just cost writes on a growing table."""
        names = {index.name for index in models.EncounterResultAudit.__table__.indexes}
        assert names == {"ix_encounter_result_audit_encounter_created"}
        assert "ix_encounter_result_audit_encounter_created" in _text()

    def test_column_set_matches_the_migration(self):
        for column in models.EncounterResultAudit.__table__.columns.keys():
            assert f'"{column}"' in _text(), f"migration is missing column {column!r}"
