from shared.core.enums import StageType

from . import double_elimination, round_robin, single_elimination, swiss
from .types import AdvancementEdge, BracketSkeleton, Pairing


def generate_bracket(
    stage_type: StageType,
    team_ids: list[int],
    *,
    swiss_standings: list[swiss.SwissStanding] | None = None,
    swiss_played_pairs: set[frozenset[int]] | None = None,
    swiss_round_number: int = 1,
    swiss_bye_history: set[int] | None = None,
    de_include_reset: bool = False,
    lower_bracket_team_ids: list[int] | None = None,
) -> BracketSkeleton:
    """Dispatch bracket generation to the appropriate algorithm.

    Args:
        stage_type: The type of bracket to generate.
        team_ids: List of team IDs to seed into the bracket.
        swiss_standings: Required for SWISS — current standings.
        swiss_played_pairs: Required for SWISS — set of already-played pairs.
        swiss_round_number: For SWISS — which round to generate.
        swiss_bye_history: For SWISS — set of team_ids that already received a bye.
        de_include_reset: For DE — whether to pre-materialise Grand Final Reset.

    Returns:
        :class:`BracketSkeleton` with all generated pairings and advancement edges.
    """
    if not team_ids:
        raise ValueError("team_ids must be non-empty")
    combined_ids = team_ids + list(lower_bracket_team_ids or [])
    if len(set(combined_ids)) != len(combined_ids):
        raise ValueError("team_ids must be unique within a stage item")

    if stage_type == StageType.ROUND_ROBIN:
        return round_robin.generate(team_ids)

    if stage_type == StageType.SINGLE_ELIMINATION:
        return single_elimination.generate(team_ids)

    if stage_type == StageType.DOUBLE_ELIMINATION:
        return double_elimination.generate(
            team_ids,
            lower_bracket_team_ids=lower_bracket_team_ids,
            include_reset=de_include_reset,
        )

    if stage_type == StageType.SWISS:
        if swiss_standings is None:
            swiss_standings = [swiss.SwissStanding(team_id=tid, points=0.0) for tid in team_ids]
        return swiss.generate_round(
            standings=swiss_standings,
            played_pairs=swiss_played_pairs or set(),
            round_number=swiss_round_number,
            bye_history=swiss_bye_history,
        )

    raise ValueError(f"Unsupported stage type: {stage_type}")


def predict_rounds(
    stage_type: StageType,
    team_count: int,
    *,
    split_lower_bracket: bool = False,
) -> list[int]:
    """The round numbers a bracket of `team_count` teams will contain, without
    generating or persisting anything.

    Runs the real generator against placeholder team ids, so the predicted
    list can never drift from what `generate_bracket` will actually produce
    once seeds are known -- notably double elimination's negative lower-bracket
    round numbers, and single elimination's round count depending on team
    count rather than a stage's independently-set ``max_rounds``.

    Round-robin and Swiss rounds are already a plain ``1..N`` sequence the
    caller can compute without this; only the two bracket types are supported.
    """
    if team_count < 2:
        return []
    # Negative, so a caller who slips a predicted id past this function's
    # boundary can never collide with a real team id.
    placeholder_ids = list(range(-1, -(team_count + 1), -1))

    if stage_type == StageType.SINGLE_ELIMINATION:
        skeleton = single_elimination.generate(placeholder_ids)
    elif stage_type == StageType.DOUBLE_ELIMINATION:
        if split_lower_bracket:
            half = team_count // 2
            skeleton = double_elimination.generate(
                placeholder_ids[: team_count - half],
                lower_bracket_team_ids=placeholder_ids[team_count - half :],
            )
        else:
            skeleton = double_elimination.generate(placeholder_ids)
    else:
        raise ValueError(f"Unsupported stage type for round prediction: {stage_type}")

    return sorted({pairing.round_number for pairing in skeleton.pairings})


__all__ = [
    "generate_bracket",
    "predict_rounds",
    "BracketSkeleton",
    "Pairing",
    "AdvancementEdge",
]
