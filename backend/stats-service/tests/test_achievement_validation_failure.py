"""A refused rule definition or portable batch tells the organizer what to fix (found in the P6 browser pass)."""

from __future__ import annotations

from shared.rpc.common import http_error
from src.services.achievement.admin_reads import validation_failure


def test_a_refused_import_names_the_slug_and_the_problem() -> None:
    errors = [{"slug": "imp-rule", "errors": ["entity_id: character #999999 does not exist in discipline 'overwatch'"]}]
    message, details = http_error(validation_failure(errors))
    assert message == "imp-rule: entity_id: character #999999 does not exist in discipline 'overwatch'"
    assert details["fields"][0]["msg"] == message and details["fields"][0]["code"] == "invalid_rule"
    assert details["validation_errors"] == errors


def test_a_refused_rule_definition_lists_every_problem() -> None:
    message, details = http_error(validation_failure(["rule.grain must match inferred grain 'user_match'", "second"]))
    assert message == "rule.grain must match inferred grain 'user_match' | second"
    assert details["validation_errors"] == ["rule.grain must match inferred grain 'user_match'", "second"]
