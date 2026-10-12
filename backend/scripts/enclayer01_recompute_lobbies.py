"""Recompute every lobby's standing after ``enclayer01`` (spec §13.8).

The migration carries a lobby's seats and its per-game results across, but not
its totals: a lobby's score is whatever its stage's formula says, and that
formula is evaluated in Python, not in SQL. So the revision leaves
``encounter.team.score`` at 0 and ``placement`` at NULL for every participation
it wrote from ``tournament.encounter_participant``, and this script fills them
in -- once, right after the deploy, with the service stopped or quiet.

Only encounters whose rule preset is ``points`` are touched; a series' score is
its win count and the migration already wrote it.

Idempotent: it writes a participation only when the computed numbers differ from
the stored ones, so a second run is a no-op and a re-run after a fix is safe.

Usage:
    cd backend/
    python -m scripts.enclayer01_recompute_lobbies --dry-run
    python -m scripts.enclayer01_recompute_lobbies
"""

from __future__ import annotations

import asyncio
from collections import defaultdict
from pathlib import Path

import click
import sqlalchemy as sa
from loguru import logger
from pydantic_settings import SettingsConfigDict
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from shared.core import enums
from shared.core.config import BaseServiceSettings
from shared.domain.encounter_scoring import GameLine, compile_rules, evaluate_encounter
from shared.models.encounter import Encounter, EncounterGame, EncounterGameTeam, EncounterTeam, ScoringRule

_env_dir = Path(__file__).resolve().parent.parent / "env"


class _ScriptSettings(BaseServiceSettings):
    model_config = SettingsConfigDict(
        env_file=(str(_env_dir / "common.env"), ".env", ".env.prod"),
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = _ScriptSettings()


async def recompute(dry_run: bool) -> int:
    """Rewrite the standing of every ``points`` encounter. Returns rows changed."""
    engine = create_async_engine(settings.db_url_asyncpg)
    session_maker = async_sessionmaker(engine, expire_on_commit=False)
    changed = 0
    try:
        async with session_maker() as session:
            lobbies = (
                await session.execute(
                    sa.select(Encounter, ScoringRule)
                    .join(ScoringRule, ScoringRule.id == Encounter.scoring_rule_id)
                    .where(ScoringRule.preset == "points")
                    .order_by(Encounter.id)
                )
            ).all()
            logger.info(f"{len(lobbies)} encounters scored by points")

            for encounter, rule in lobbies:
                rules = compile_rules(rule)
                teams = (
                    await session.scalars(
                        sa.select(EncounterTeam)
                        .where(EncounterTeam.encounter_id == encounter.id, EncounterTeam.active.is_(True))
                        .order_by(EncounterTeam.slot)
                    )
                ).all()
                if not teams:
                    continue
                games = (
                    await session.scalars(
                        sa.select(EncounterGame)
                        .where(
                            EncounterGame.encounter_id == encounter.id,
                            EncounterGame.state == enums.EncounterGameState.CONFIRMED,
                        )
                        .order_by(EncounterGame.position)
                    )
                ).all()
                lines: dict[int, list[GameLine]] = defaultdict(list)
                if games:
                    seats = {team.id for team in teams}
                    rows = await session.scalars(
                        sa.select(EncounterGameTeam).where(EncounterGameTeam.game_id.in_([game.id for game in games]))
                    )
                    for row in rows:
                        if row.encounter_team_id in seats:
                            lines[row.game_id].append(
                                GameLine(
                                    encounter_team_id=row.encounter_team_id,
                                    score=row.score,
                                    placement=row.placement,
                                    values=row.column_values or {},
                                )
                            )
                outcome = evaluate_encounter(
                    rules,
                    best_of=encounter.best_of,
                    team_ids=[team.id for team in teams],
                    games=[lines[game.id] for game in games],
                )
                # A place is what the lobby DECIDED; while the result is not
                # official the standing is still moving, and the column says so
                # with NULL -- the same rule the migration used for duels.
                official = encounter.result_status == enums.EncounterResultStatus.CONFIRMED
                for team in teams:
                    score = float(outcome.totals.get(team.id, 0.0))
                    placement = outcome.placements.get(team.id) if official else None
                    if (team.score, team.placement) == (score, placement):
                        continue
                    changed += 1
                    logger.info(
                        f"encounter {encounter.id} seat {team.slot} ({team.name}): "
                        f"{team.score}/{team.placement} -> {score}/{placement}"
                    )
                    if not dry_run:
                        team.score = score
                        team.placement = placement
            if dry_run:
                logger.info(f"dry run: {changed} participations would change")
            else:
                await session.commit()
                logger.info(f"{changed} participations rewritten")
    finally:
        await engine.dispose()
    return changed


@click.command()
@click.option("--dry-run", is_flag=True, help="Print the diffs and write nothing.")
def main(dry_run: bool) -> None:
    asyncio.run(recompute(dry_run))


if __name__ == "__main__":
    main()
