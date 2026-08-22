"""The invite-audit columns must exist identically in the model and the migration.

A model/migration divergence is the one schema bug no unit test in either half can
see: the ORM compiles happily against columns nobody created, and the migration
creates columns nobody reads. It surfaces as an ``UndefinedColumn`` on the first
production request, long after both halves passed review.

Every property below is a decision, not a default:

* ``revoked_by``/``revoked_at`` exist because a captain and an ORGANIZER can both
  withdraw an offer, and after the fact the two are otherwise indistinguishable --
  which would make the organizer power unauditable;
* ``revoked_by_organizer`` is written by the entry point that knows rather than
  inferred at read time, because comparing the revoker against "the captain" is a
  lie once captaincy has transferred;
* ``invite_cap_reset_at``/``invite_cap_reset_by`` are a WATERMARK, so the cumulative
  cap can be forgiven without deleting the rows that explain why it was hit;
* every column is nullable or server-defaulted, which is what makes the migration a
  pure expand -- old images keep working, so it needs no deploy ordering.

This is a metadata check, not a substitute for applying the schema: run
``alembic upgrade heads`` against a real database too.
"""

from __future__ import annotations

import ast
import pathlib

from shared import models

MIGRATION = (
    pathlib.Path(__file__).resolve().parents[2]
    / "migrations"
    / "versions"
    / "regteam0003_invite_audit_and_cap_reset.py"
)

INVITE_COLUMNS = ("revoked_by", "revoked_at", "revoked_by_organizer")
TEAM_COLUMNS = ("invite_cap_reset_at", "invite_cap_reset_by")


def _added_columns() -> dict[str, set[str]]:
    """``{table: {column, ...}}`` from the migration's ``op.add_column`` calls.

    Parsed rather than imported: importing a migration module pulls in alembic's
    ``op`` proxy, which is only bound inside a live migration context.
    """
    tree = ast.parse(MIGRATION.read_text(encoding="utf-8"))
    upgrade = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "upgrade")
    added: dict[str, set[str]] = {}
    for node in ast.walk(upgrade):
        if not isinstance(node, ast.Call) or not isinstance(node.func, ast.Attribute):
            continue
        if node.func.attr != "add_column":
            continue
        table = node.args[0].value  # type: ignore[attr-defined]
        column = node.args[1].args[0].value  # type: ignore[attr-defined]
        added.setdefault(table, set()).add(column)
    return added


class TestTheMigrationCreatesWhatTheModelReads:
    def test_the_invite_audit_columns_are_both_places(self):
        model = set(models.BalancerRegistrationTeamInvite.__table__.columns.keys())
        migrated = _added_columns()["registration_team_invite"]

        for column in INVITE_COLUMNS:
            assert column in model, f"{column} missing from the ORM model"
            assert column in migrated, f"{column} missing from the migration"

    def test_the_cap_watermark_columns_are_in_both_places(self):
        model = set(models.BalancerRegistrationTeam.__table__.columns.keys())
        migrated = _added_columns()["registration_team"]

        for column in TEAM_COLUMNS:
            assert column in model, f"{column} missing from the ORM model"
            assert column in migrated, f"{column} missing from the migration"

    def test_the_migration_adds_nothing_the_model_does_not_declare(self):
        """The other direction. A column created and never read is dead weight that
        the next reader has to prove is dead."""
        model_columns = {
            "registration_team_invite": set(models.BalancerRegistrationTeamInvite.__table__.columns.keys()),
            "registration_team": set(models.BalancerRegistrationTeam.__table__.columns.keys()),
        }

        for table, columns in _added_columns().items():
            assert columns <= model_columns[table], f"{table}: {columns - model_columns[table]}"


class TestItStaysAPureExpand:
    def test_every_new_column_is_optional_or_defaulted(self):
        """A NOT NULL column with no server default would make this migration
        ordering-sensitive: any image still inserting without it would start
        failing the moment the migration landed."""
        invite = models.BalancerRegistrationTeamInvite.__table__.columns
        team = models.BalancerRegistrationTeam.__table__.columns

        for column in (*(invite[name] for name in INVITE_COLUMNS), *(team[name] for name in TEAM_COLUMNS)):
            assert column.nullable or column.server_default is not None, column.name

    def test_the_provenance_flag_defaults_to_false_rather_than_null(self):
        """Three-valued provenance would be a trap: NULL would mean both "not
        revoked" and "revoked, source unknown", and the UI cannot tell those apart.
        Every pre-existing row is honestly not-organizer-revoked."""
        column = models.BalancerRegistrationTeamInvite.__table__.columns["revoked_by_organizer"]

        assert not column.nullable
        assert column.server_default is not None

    def test_it_is_downgradable(self):
        """Every column it adds, it drops. A migration that cannot go back is one
        that cannot be deployed on a Friday."""
        tree = ast.parse(MIGRATION.read_text(encoding="utf-8"))
        downgrade = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "downgrade")
        dropped: set[str] = set()
        for node in ast.walk(downgrade):
            if isinstance(node, ast.Call) and getattr(node.func, "attr", None) == "drop_column":
                dropped.add(node.args[1].value)  # type: ignore[attr-defined]

        assert dropped == set(INVITE_COLUMNS) | set(TEAM_COLUMNS)


class TestItChainsOffTheTeamRegistrationLine:
    def test_it_revises_the_previous_team_registration_migration(self):
        """This repo keeps one migration chain per feature. Pointing at another
        feature's head would serialize two unrelated deploys."""
        tree = ast.parse(MIGRATION.read_text(encoding="utf-8"))
        assignments = {
            node.target.id: node.value
            for node in tree.body
            if isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name)
        }

        assert assignments["revision"].value == "regteam0003"  # type: ignore[attr-defined]
        assert assignments["down_revision"].value == "regteam0002"  # type: ignore[attr-defined]
