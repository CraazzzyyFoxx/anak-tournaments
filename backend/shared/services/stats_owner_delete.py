"""Explicit before/after evidence for existing owner-deletion transactions.

Call before deleting the root, then stage before the caller commits. No listener,
commit, cascade emulation, or implicit deletion of played member history lives here.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from shared import models
from shared.services.audit import AuditSource
from shared.services.stats_evidence import (
    OWNER_BATCH,
    capture_stats_evidence,
    owner_scopes,
    stage_stats_evidence,
    state_scope,
)

__all__ = ("capture_owner_delete", "stage_owner_delete")


async def capture_owner_delete(
    session: AsyncSession,
    *,
    workspace_id: int | None = None,
    user_id: int | None = None,
    tournament_id: int | None = None,
    encounter_id: int | None = None,
    game_id: int | None = None,
    team_id: int | None = None,
    stage_id: int | None = None,
    stage_item_id: int | None = None,
    api_key_ids: Sequence[int] | None = None,
) -> list[list[dict]]:
    """Lock the creation parents and capture all native cascade/SET NULL owners."""
    roots = (
        (models.Workspace, workspace_id),
        (models.User, user_id),
        (models.Tournament, tournament_id),
        (models.Encounter, encounter_id),
        (models.EncounterGame, game_id),
        (models.Team, team_id),
        (models.Stage, stage_id),
        (models.StageItem, stage_item_id),
        (models.ApiKey, api_key_ids),
    )
    selected = [(model, key) for model, key in roots if key is not None]
    if len(selected) != 1:
        raise ValueError("owner deletion requires exactly one root")
    model, key = selected[0]
    root_filter = model.id.in_(key) if model is models.ApiKey else model.id == key
    await session.execute(sa.select(model.id).where(root_filter).order_by(model.id).with_for_update())

    t, e, g, m, j, member = (
        models.Tournament,
        models.Encounter,
        models.EncounterGame,
        models.StatsMatch,
        models.IngestJob,
        models.WorkspaceMember,
    )
    tournament_filter = (
        t.workspace_id == workspace_id
        if workspace_id is not None
        else (t.id == tournament_id if tournament_id is not None else sa.false())
    )
    tournaments = sa.select(t.id).where(tournament_filter)
    encounter_filter = sa.or_(
        e.tournament_id.in_(tournaments),
        e.workspace_id == workspace_id if workspace_id is not None else sa.false(),
        e.id == encounter_id if encounter_id is not None else sa.false(),
    )
    if stage_id is not None or stage_item_id is not None:
        position = models.BracketEncounter
        positions = sa.select(position.encounter_id).where(
            position.stage_id == stage_id if stage_id is not None else position.stage_item_id == stage_item_id
        )
        encounter_filter = e.id.in_(positions)
    encounters = sa.select(e.id).where(encounter_filter)
    games = sa.select(g.id).where(
        sa.or_(g.encounter_id.in_(encounters), g.id == game_id if game_id is not None else sa.false())
    )
    # Lock parents before enumerating descendants; ingestion takes the same
    # encounter/game locks before it creates an observation owner.
    for parent, predicate in ((t, tournament_filter), (e, encounter_filter), (g, g.id.in_(games))):
        stream = await session.stream_scalars(
            sa.select(parent.id).where(predicate).order_by(parent.id).with_for_update()
        )
        async for _ in stream:
            pass
        await stream.close()

    members = sa.select(member.id).where(
        member.workspace_id == workspace_id
        if workspace_id is not None
        else (member.player_id == user_id if user_id is not None else sa.false())
    )
    deleted_jobs = sa.select(j.id).where(j.workspace_id == workspace_id if workspace_id is not None else sa.false())
    api_keys = sa.select(models.ApiKey.id).where(
        models.ApiKey.workspace_id == workspace_id
        if workspace_id is not None
        else (models.ApiKey.id.in_(api_key_ids) if api_key_ids is not None else sa.false())
    )
    jobs = sa.select(j.id).where(
        sa.or_(
            j.id.in_(deleted_jobs),
            j.api_key_id.in_(api_keys),
            j.hint_tournament_id.in_(tournaments),
            j.hint_encounter_id.in_(encounters),
            j.hint_encounter_game_id.in_(games),
            j.uploader_user_id == user_id if user_id is not None else sa.false(),
        )
    )
    observed_members = sa.select(models.StatsMatchPlayer.match_id).where(
        models.StatsMatchPlayer.workspace_member_id.in_(members)
    )
    team_matches = (
        sa.select(models.StatsMatchTeam.match_id)
        .join(
            models.EncounterTeam,
            models.EncounterTeam.id == models.StatsMatchTeam.encounter_team_id,
        )
        .where(models.EncounterTeam.team_id == team_id if team_id is not None else sa.false())
    )
    matches = sa.select(m.id).where(
        sa.or_(
            m.encounter_game_id.in_(games),
            m.ingest_job_id.in_(deleted_jobs),
            m.workspace_id == workspace_id if workspace_id is not None else sa.false(),
            m.id.in_(observed_members),
            m.id.in_(team_matches),
        )
    )
    rules = sa.select(models.AchievementRule.id).where(
        models.AchievementRule.workspace_id == workspace_id if workspace_id is not None else sa.false()
    )
    evaluation, override = models.AchievementEvaluationResult, models.AchievementOverride
    owners = {
        "alias": sa.select(models.CatalogAliasMiss.id).where(
            models.CatalogAliasMiss.last_ingest_job_id.in_(deleted_jobs)
        ),
        "channel": sa.select(models.TournamentDiscordChannel.id).where(
            models.TournamentDiscordChannel.tournament_id.in_(tournaments)
        ),
        "evaluation": sa.select(evaluation.id).where(
            sa.or_(
                evaluation.match_id.in_(matches),
                evaluation.encounter_id.in_(encounters),
                evaluation.tournament_id.in_(tournaments),
                evaluation.workspace_member_id.in_(members),
                evaluation.achievement_rule_id.in_(rules),
            )
        ),
        "job": jobs,
        "match": matches,
        "member": members,
        "override": sa.select(override.id).where(
            sa.or_(
                override.match_id.in_(matches),
                override.tournament_id.in_(tournaments),
                override.workspace_member_id.in_(members),
                override.achievement_rule_id.in_(rules),
            )
        ),
        "rule": rules,
    }
    captures = []
    scopes = []
    owner_count = 0
    for kind, query in owners.items():
        stream = await session.stream_scalars(query.order_by(query.selected_columns[0]))
        async for owner_id in stream:
            scopes.extend(owner_scopes(kind, (owner_id,)))
            owner_count += 1
            if owner_count == OWNER_BATCH:
                captures.append(await capture_stats_evidence(session, scopes=scopes))
                scopes, owner_count = [], 0
        await stream.close()
    if scopes:
        captures.append(await capture_stats_evidence(session, scopes=scopes))
    return captures


async def stage_owner_delete(
    session: AsyncSession,
    captures: list[list[dict]],
    *,
    workspace_id: int | None,
    entity_type: str,
    entity_id: int | None,
    source: AuditSource = "system",
    actor: models.AuthUser | None = None,
) -> list[models.AuditLog]:
    """Flush the real cascade, preserving each sealed before-capture unchanged."""
    await session.flush()
    audits = []
    for before in captures:
        after = await capture_stats_evidence(session, scopes=[state_scope(state) for state in before])
        if before == after:
            continue
        audits.append(
            await stage_stats_evidence(
                session,
                operation="stats.owner_delete",
                before=before,
                after=after,
                workspace_id=workspace_id,
                entity_type=entity_type,
                entity_id=entity_id,
                source=source,
                actor=actor,
            )
        )
    return audits
