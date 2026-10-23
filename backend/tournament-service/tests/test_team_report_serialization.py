"""``serialize_team_report``: the report read shared by the public reports and the admin list."""

from shared.models.encounter.report import EncounterTeamReport
from src.services.encounter.captain import serialize_team_report


def test_migrated_replay_audit_in_custom_fields_does_not_break_the_read() -> None:
    # enclayer01 stores ``historical_replay_codes`` (a list) beside the string answers.
    report = EncounterTeamReport(
        id=1,
        encounter_id=2,
        encounter_team_id=3,
        reporter_user_id=None,
        games_played=3,
        basis_version=1,
        closeness=None,
        comment=None,
        custom_fields_json={
            "mvp": "A",
            "historical_replay_codes": [{"id": 487, "code": "V48C1K", "map_index": 1, "report_id": 455}],
        },
    )

    assert serialize_team_report(report, []).custom_fields == {"mvp": "A"}
