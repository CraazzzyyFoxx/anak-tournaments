"""Native-model data for the live ingest smoke: rosters, games, catalog and the Workshop reference scenario.

Everything is inserted through the ORM models of the migrated scratch database (no gateway, no hard-coded identity),
into workspaces the identity service created, so each case has real roles and API keys behind it. Cases are named, one
game each, so an observation can never leak between scenarios.
"""

from __future__ import annotations

import copy
import uuid
from dataclasses import dataclass
from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from shared import models
from shared.core import enums
from shared.models.achievements.achievement import AchievementEvaluationResult, AchievementRule
from shared.repository.roles import CatalogRoleRepository
from shared.services.ontology import project_disciplines
from tests.ingest_seed import IngestCase, build_document, seed_ingest_case

#: case name -> (workspace label, discipline, teams). ``ON`` tournaments accept ingest evidence as official results.
CASES: dict[str, tuple[str, str, int]] = {
    "main": ("OFF", "overwatch", 2),
    "other": ("OFF", "overwatch", 2),
    "hinted": ("OFF", "overwatch", 2),
    "perm3": ("OFF", "overwatch", 3),
    "concurrent": ("OFF", "overwatch", 2),
    "unknown_codes": ("OFF", "overwatch", 2),
    "awaiting": ("OFF", "overwatch", 2),
    "frozen": ("OFF", "overwatch", 2),
    "stale": ("OFF", "overwatch", 2),
    "killed": ("OFF", "overwatch", 2),
    "lol": ("OFF", "lol", 2),
    "on_main": ("ON", "overwatch", 2),
    "on_admin": ("ON", "overwatch", 2),
    "ach_ow": ("OFF", "overwatch", 2),
    "ach_wait": ("OFF", "overwatch", 2),
    "ach_failed": ("OFF", "overwatch", 2),
    "ach_lol": ("OFF", "lol", 2),
}
HOME, AWAY = ("IngestH0", "IngestH1", "IngestH2"), ("IngestA0", "IngestA1", "IngestA2")
SECOND_HERO = {"slug": "ingest-reaper", "name": "Ingest Reaper", "attrs": {"class": "damage"}}


def async_session_factory(db_url: str):
    engine = create_async_engine(make_url(db_url).set(drivername="postgresql+asyncpg"))
    return engine, async_sessionmaker(engine, expire_on_commit=False)


async def project_catalog(db_url: str) -> None:
    """Catalog + ontology projection of every installed discipline (what a deployed database already carries)."""
    engine, factory = async_session_factory(db_url)
    try:
        async with factory() as session:
            await project_disciplines(session)
            await session.commit()
    finally:
        await engine.dispose()


@dataclass
class Workshop:
    workspace_id: int
    tournament_id: int
    encounter_id: int
    game_id: int
    team_ids: list[int]


async def _seed_workshop(session: AsyncSession, workspace_id: int, grid_version_id: int) -> Workshop:
    """The roster the Task 0 reference log names (``IngestH0..2`` Home, ``IngestA0..2`` Away) and its catalog."""
    discipline = "overwatch"
    mode = models.CatalogEntity(
        discipline=discipline, kind="mode", slug="ingest-control", name="Ingest Control", attrs={}
    )
    ana = models.CatalogEntity(
        discipline=discipline,
        kind="character",
        slug="ingest-ana",
        name="Ingest Ana",
        attrs={"class": "support"},
        aliases=["Ана-инжест"],
    )
    reaper = models.CatalogEntity(discipline=discipline, kind="character", **SECOND_HERO)
    session.add_all([mode, ana, reaper])
    await session.flush()
    map_ = models.CatalogEntity(
        discipline=discipline,
        kind="map",
        slug="ingest-ilios",
        name="Ingest Ilios",
        parent_id=mode.id,
        attrs={},
        aliases=["Илиос-инжест"],
    )
    session.add(map_)
    tournament = models.Tournament(
        workspace_id=workspace_id,
        discipline=discipline,
        name="Workshop cup",
        slug="p5-workshop-cup",
        division_grid_version_id=grid_version_id,
        logs_official=False,
    )
    rule = models.ScoringRule(
        workspace_id=workspace_id,
        preset="wins",
        game_formula="win",
        end_formula="games >= best_of or max_wins * 2 > best_of",
    )
    session.add_all([tournament, rule])
    await session.flush()
    encounter = models.Encounter(
        workspace_id=workspace_id,
        discipline=discipline,
        tournament_id=tournament.id,
        scoring_rule_id=rule.id,
        name="Workshop series",
        slot_count=2,
        status=enums.EncounterStatus.OPEN,
    )
    teams = [models.Team(tournament_id=tournament.id, name=name, balancer_name=name) for name in ("Home", "Away")]
    session.add_all([encounter, *teams])
    await session.flush()
    seats = [
        models.EncounterTeam(
            encounter_id=encounter.id,
            tournament_id=tournament.id,
            team_id=team.id,
            name=team.name,
            slot=index + 1,
            active=True,
        )
        for index, team in enumerate(teams)
    ]
    session.add_all(seats)
    await session.flush()
    ontology = await CatalogRoleRepository().ontology(session, discipline=discipline, workspace_id=workspace_id)
    rated = ontology.rated
    support = next(node for node in ontology.roots(rated.code) if node.code == "support")
    for names, team, seat in ((HOME, teams[0], seats[0]), (AWAY, teams[1], seats[1])):
        for name in names:
            user = models.User(name=name)
            session.add(user)
            await session.flush()
            handle = f"{name}#1234"
            session.add(
                models.SocialAccount(
                    user_id=user.id,
                    provider="battlenet",
                    username=handle,
                    username_normalized=handle.lower(),
                    is_primary=True,
                )
            )
            member = models.WorkspaceMember(workspace_id=workspace_id, player_id=user.id)
            session.add(member)
            await session.flush()
            roster = models.Player(
                tournament_id=tournament.id, workspace_member_id=member.id, team_id=team.id, name=name, rank=800
            )
            snapshot = models.EncounterTeamMember(
                encounter_id=encounter.id,
                encounter_team_id=seat.id,
                active=True,
                workspace_member_id=member.id,
                display_name_snapshot=name,
                rank=800,
            )
            session.add_all([roster, snapshot])
            await session.flush()
            session.add_all(
                [
                    models.PlayerRole(player_id=roster.id, role_id=support.id, dimension_id=rated.id),
                    models.EncounterTeamMemberRole(
                        team_member_id=snapshot.id, role_id=support.id, dimension_id=rated.id
                    ),
                ]
            )
    game = models.EncounterGame(
        encounter_id=encounter.id, position=1, map_id=map_.id, state=enums.EncounterGameState.PLANNED
    )
    session.add(game)
    await session.flush()
    session.add_all(
        models.EncounterGameTeam(game_id=game.id, encounter_id=encounter.id, encounter_team_id=seat.id)
        for seat in seats
    )
    await session.flush()
    return Workshop(workspace_id, tournament.id, encounter.id, game.id, [seat.id for seat in seats])


async def seed_world(
    db_url: str, workspaces: dict[str, int], grids: dict[str, dict]
) -> tuple[dict[str, IngestCase], Workshop]:
    """Every named case plus the Workshop reference game; each tournament carries its own discipline's default grid."""
    engine, factory = async_session_factory(db_url)
    cases: dict[str, IngestCase] = {}
    try:
        async with factory() as session:
            for name, (label, discipline, teams) in CASES.items():
                case = await seed_ingest_case(
                    session,
                    teams=teams,
                    workspace_slug=f"p5-live-{name}",
                    discipline=discipline,
                    workspace_id=workspaces[label],
                )
                await session.execute(
                    sa.update(models.Tournament)
                    .where(models.Tournament.id == case.tournament_id)
                    .values(
                        logs_official=label == "ON",
                        division_grid_version_id=grids[label]["default"][discipline],
                    )
                )
                cases[name] = case
            workshop = await _seed_workshop(session, workspaces["OFF"], grids["OFF"]["default"]["overwatch"])
            await session.commit()
    finally:
        await engine.dispose()
    return cases, workshop


ACH_THRESHOLD = (
    5  # ``build_document`` gives participant ``i`` of team ``t`` ``3 + i + t`` eliminations on the case hero
)


async def seed_achievement_rules(db_url: str, cases: dict[str, IngestCase]) -> dict[str, Any]:
    """One per-hero elimination rule per Overwatch ``ach_*`` case, plus a *sentinel* of the other game.

    The LoL rule deliberately reuses the Overwatch ``hero_stat`` tree and carries an award of its own: LoL declares no
    achievement conditions, so neither a LoL trigger nor an Overwatch one may evaluate, replace or erase it.
    """
    engine, factory = async_session_factory(db_url)
    try:
        async with factory() as session:
            rules: dict[str, int] = {}
            for name in ("ach_ow", "ach_wait", "ach_failed"):
                case = cases[name]
                hero = await session.scalar(
                    sa.select(models.CatalogEntity.id).where(
                        models.CatalogEntity.discipline == "overwatch",
                        models.CatalogEntity.kind == "character",
                        models.CatalogEntity.slug == case.hero_code,
                    )
                )
                rules[name] = await _add_rule(
                    session, case, f"live-hero-elims-{name}", hero, case.hero_code, discipline="overwatch"
                )
            ow, lol = cases["ach_ow"], cases["ach_lol"]
            sentinel_rule = await _add_rule(session, lol, "live-lol-sentinel", None, ow.hero_code, discipline="lol")
            sentinel = AchievementEvaluationResult(
                achievement_rule_id=sentinel_rule,
                workspace_member_id=lol.member_ids[0][0],
                tournament_id=lol.tournament_id,
                rule_version=1,
                evidence_json={"rule_slug": "live-lol-sentinel", "sentinel": True},
            )
            session.add(sentinel)
            await session.flush()
            sentinel_id = sentinel.id
            await session.commit()
    finally:
        await engine.dispose()
    return {"rules": rules, "lol_rule": sentinel_rule, "lol_result": sentinel_id}


async def _add_rule(
    session: AsyncSession, case: IngestCase, slug: str, entity_id: int | None, hero_slug: str, *, discipline: str
) -> int:
    rule = AchievementRule(
        workspace_id=case.workspace_id,
        slug=slug,
        name=slug,
        description_ru=slug,
        description_en=slug,
        discipline=discipline,
        entity_id=entity_id,
        category="hero",
        scope="match",
        grain="user_match",
        condition_tree={
            "type": "hero_stat",
            "params": {"hero_slug": hero_slug, "stat": "eliminations", "op": ">=", "value": ACH_THRESHOLD},
        },
        depends_on=["stats.match", "stats.fact"],
        enabled=True,
        rule_version=1,
    )
    session.add(rule)
    await session.flush()
    return rule.id


def document(case: IngestCase, external_id: str, **changes: Any) -> dict[str, Any]:
    return build_document(case, external_id=external_id, **changes)


def with_unknown_identities(doc: dict[str, Any]) -> dict[str, Any]:
    """The same document naming people nobody has rostered or registered."""
    out = copy.deepcopy(doc)
    tag = uuid.uuid4().hex[:8]
    for index, person in enumerate(out["participants"]):
        # battlenet grammar: a 2-12 character name, then '#' and at least four digits
        person["identity"] = {"provider": person["identity"]["provider"], "id": f"Nb{index}{tag[:7]}#{4000 + index}"}
    return out
