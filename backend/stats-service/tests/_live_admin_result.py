"""An organizer's own result for one game, recorded by the match layer (live ingest smoke, "admin precedence").

Run as a subprocess (``python _live_admin_result.py <tournament-service dir>``; the match layer lives in that service's
``src``). Reads ``{"encounter_id", "game_id", "scores": {encounter_team_id: score}}`` from stdin and records it with the
same service call an organizer's result goes through (source ``ADMIN``). Prints ``__RESULT__{json}``.
"""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

SERVICE = Path(sys.argv[1]).resolve()
sys.path.insert(0, str(SERVICE))
sys.path.insert(0, str(SERVICE.parent))

from shared.testing import apply_test_env_defaults  # noqa: E402

apply_test_env_defaults()

from shared.core import enums  # noqa: E402
from shared.models.encounter import EncounterGame  # noqa: E402
from shared.models.encounter.encounter import Encounter  # noqa: E402
from src.core import db  # noqa: E402
from src.services.encounter.games import GameResultIn, encounter_game_service  # noqa: E402


async def main(request: dict) -> dict:
    async with db.async_session_maker() as session:
        encounter = await session.get_one(Encounter, request["encounter_id"])
        game = await session.get_one(EncounterGame, request["game_id"])
        await encounter_game_service.record_result(
            session,
            encounter,
            game,
            results=[
                GameResultIn(encounter_team_id=int(team), score=score) for team, score in request["scores"].items()
            ],
            source=enums.EncounterGameResultSource.ADMIN,
            actor_user_id=None,
        )
        await session.commit()
        await session.refresh(game)
        return {"state": game.state.value, "result_version": game.result_version}


if __name__ == "__main__":
    print("__RESULT__" + json.dumps(asyncio.run(main(json.load(sys.stdin)))))
