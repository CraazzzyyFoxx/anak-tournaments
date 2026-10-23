"""The encounter.game table shape the migration and the services rely on."""

from shared.core import enums
from shared.models.encounter.claim import EncounterGameClaim
from shared.models.encounter.game import EncounterGame


def test_live_position_is_unique_only_among_non_cancelled_games() -> None:
    index = next(i for i in EncounterGame.__table__.indexes if i.name == "uq_game_encounter_position")
    assert index.unique
    assert [c.name for c in index.columns] == ["encounter_id", "position"]
    assert "cancelled" in str(index.dialect_options["postgresql"]["where"])


def test_a_game_result_claim_is_keyed_by_game_and_claimant() -> None:
    """One claim per participation per game, and the claimant is a participation
    seated in THAT game -- not a side, and not a tournament team."""
    unique = next(c for c in EncounterGameClaim.__table__.constraints if c.name == "uq_game_claim_claimant")
    assert [c.name for c in unique.columns] == ["game_id", "claimant_team_id"]
    assert "side" not in EncounterGameClaim.__table__.c
    assert "team_id" not in EncounterGameClaim.__table__.c


def test_played_is_no_longer_an_entry_status() -> None:
    assert "played" not in {member.value for member in enums.MapPoolEntryStatus}
