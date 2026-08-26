from __future__ import annotations

import os
import sys
from pathlib import Path

REPO_BACKEND_ROOT = Path(__file__).resolve().parents[2]
BALANCER_SERVICE_ROOT = REPO_BACKEND_ROOT / "balancer-service"

for candidate in (str(REPO_BACKEND_ROOT), str(BALANCER_SERVICE_ROOT)):
    if candidate not in sys.path:
        sys.path.insert(0, candidate)

os.environ.setdefault("PROJECT_URL", "http://localhost")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")
os.environ.setdefault("POSTGRES_USER", "postgres")
os.environ.setdefault("POSTGRES_PASSWORD", "postgres")
os.environ.setdefault("POSTGRES_DB", "postgres")
os.environ.setdefault("POSTGRES_HOST", "localhost")
os.environ.setdefault("POSTGRES_PORT", "5432")
os.environ.setdefault("CHALLONGE_USERNAME", "test")
os.environ.setdefault("CHALLONGE_API_KEY", "test")
os.environ.setdefault("S3_ACCESS_KEY", "test")
os.environ.setdefault("S3_SECRET_KEY", "test")
os.environ.setdefault("S3_ENDPOINT_URL", "http://localhost")
os.environ.setdefault("S3_BUCKET_NAME", "test")

from src.domain.mix_rotation import PlayerHistory, RotationStatus, recommend_rotation  # noqa: E402


def _status_by_id(recommendations, member_id):
    return next(r for r in recommendations if r.member_id == member_id).status


def test_pool_fits_without_rotation_everyone_neutral() -> None:
    histories = [
        PlayerHistory(member_id=1, played=(True, False, True)),
        PlayerHistory(member_id=2, played=(False, False, False)),
    ]
    recommendations = recommend_rotation(histories, usable_count=2)
    assert {r.status for r in recommendations} == {RotationStatus.NEUTRAL}
    assert all(r.reason == "Мест хватает на весь пул" for r in recommendations)


def test_sat_out_players_take_priority_over_long_streak_player() -> None:
    # 4 players, 1 seat short: whoever sat out longest (or never got in) is
    # owed the seat over whoever is mid-streak, and the one still on the
    # longest active streak is the one who rests.
    histories = [
        PlayerHistory(member_id=1, played=(True, True, True)),  # streak 3, never sat
        PlayerHistory(member_id=2, played=(True, True, False)),  # sat last map (1)
        PlayerHistory(member_id=3, played=(True, False, True)),  # back in, short streak
        PlayerHistory(member_id=4, played=(False, False, False)),  # sat every map so far (3)
    ]
    recommendations = recommend_rotation(histories, usable_count=3)
    by_id = {r.member_id: r for r in recommendations}

    assert by_id[4].status == RotationStatus.MUST_PLAY  # owed a seat the longest
    assert by_id[2].status == RotationStatus.MUST_PLAY  # sat out last map
    assert by_id[3].status == RotationStatus.NEUTRAL  # fills the last seat, no fatigue signal
    assert by_id[1].status == RotationStatus.SHOULD_REST  # longest active play streak
    assert by_id[1].reason == "Сыграл 3 карт(ы) подряд"

    # must_play and should_rest are always in sync with the seat math: exactly
    # `pool_size - usable_count` rest, the rest play.
    resting = [r for r in recommendations if r.status == RotationStatus.SHOULD_REST]
    assert len(resting) == len(histories) - 3


def test_host_pinned_must_play_always_gets_a_seat() -> None:
    histories = [
        PlayerHistory(member_id=1, played=(True, True)),
        PlayerHistory(member_id=2, played=(True, True)),
        PlayerHistory(member_id=3, played=(True, True)),
        PlayerHistory(member_id=4, played=(False, False), pinned_must_play=True),
    ]
    recommendations = recommend_rotation(histories, usable_count=2)
    by_id = {r.member_id: r for r in recommendations}

    assert by_id[4].status == RotationStatus.MUST_PLAY
    assert by_id[4].reason == "Закреплён хостом (must_play)"
    # Identical histories tie-break on input order: player 1 keeps the one
    # remaining seat, 2 and 3 rest.
    assert by_id[1].status == RotationStatus.NEUTRAL
    assert by_id[2].status == RotationStatus.SHOULD_REST
    assert by_id[3].status == RotationStatus.SHOULD_REST


def test_no_history_yet_falls_back_to_deterministic_input_order() -> None:
    histories = [PlayerHistory(member_id=member_id, played=()) for member_id in (1, 2, 3)]
    recommendations = recommend_rotation(histories, usable_count=2)

    assert _status_by_id(recommendations, 1) == RotationStatus.NEUTRAL
    assert _status_by_id(recommendations, 2) == RotationStatus.NEUTRAL
    assert _status_by_id(recommendations, 3) == RotationStatus.SHOULD_REST

    # Re-running with the same input is stable -- no hidden randomness.
    assert recommend_rotation(histories, usable_count=2) == recommendations
