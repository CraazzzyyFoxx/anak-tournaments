"""Pushdown-capable native observations; authorization/visibility belongs to each reader."""

import sqlalchemy as sa

from shared import models

__all__ = ("player_facts", "team_scores", "match_context")


def player_facts(*, discipline: str) -> sa.Subquery:
    """Player facts at their original segment/entity grain, including historical members."""
    f, m, d = models.StatsFact, models.StatsMatch, models.StatDef
    wm, g, e, et = models.WorkspaceMember, models.EncounterGame, models.Encounter, models.EncounterTeam
    mt = models.StatsMatchTeam
    return (
        sa.select(
            *f.__table__.c,
            d.code.label("stat_code"),
            m.workspace_id,
            m.discipline,
            wm.player_id,
            et.team_id.label("tournament_team_id"),
            g.encounter_id,
            e.tournament_id,
            m.duration_s,
            m.map_entity_id,
            mt.source_position,
        )
        .select_from(f)
        .join(m, m.id == f.match_id)
        .join(d, sa.and_(d.id == f.stat_id, d.discipline == m.discipline))
        .join(wm, sa.and_(wm.id == f.workspace_member_id, wm.workspace_id == m.workspace_id))
        .join(
            mt,
            sa.and_(
                mt.match_id == f.match_id,
                mt.encounter_team_id == f.encounter_team_id,
                mt.encounter_game_id == m.encounter_game_id,
            ),
        )
        .join(g, g.id == m.encounter_game_id)
        .join(e, sa.and_(e.id == g.encounter_id, e.workspace_id == m.workspace_id, e.discipline == m.discipline))
        .join(et, sa.and_(et.id == f.encounter_team_id, et.encounter_id == e.id))
        .where(m.discipline == discipline, f.workspace_member_id.is_not(None))
        .subquery()
    )


def team_scores(*, discipline: str, stat_code: str) -> sa.Subquery:
    """Observed whole-match team values, never the game's official result."""
    f, m, d, mt = models.StatsFact, models.StatsMatch, models.StatDef, models.StatsMatchTeam
    g, e, et = models.EncounterGame, models.Encounter, models.EncounterTeam
    return (
        sa.select(
            f.match_id,
            f.encounter_team_id,
            mt.source_position,
            et.slot,
            et.team_id.label("tournament_team_id"),
            f.value,
        )
        .select_from(f)
        .join(m, m.id == f.match_id)
        .join(d, sa.and_(d.id == f.stat_id, d.discipline == m.discipline))
        .join(
            mt,
            sa.and_(
                mt.match_id == f.match_id,
                mt.encounter_team_id == f.encounter_team_id,
                mt.encounter_game_id == m.encounter_game_id,
            ),
        )
        .join(g, g.id == m.encounter_game_id)
        .join(e, sa.and_(e.id == g.encounter_id, e.workspace_id == m.workspace_id, e.discipline == m.discipline))
        .join(et, sa.and_(et.id == f.encounter_team_id, et.encounter_id == e.id))
        .where(
            m.discipline == discipline,
            d.code == stat_code,
            f.segment == 0,
            f.workspace_member_id.is_(None),
            f.entity_id.is_(None),
        )
        .subquery()
    )


def match_context(*, discipline: str) -> sa.Subquery:
    """Match headers with their real game position and encounter owner."""
    m, g, e = models.StatsMatch, models.EncounterGame, models.Encounter
    return (
        sa.select(*m.__table__.c, g.position, g.encounter_id, e.tournament_id, e.custom_game_id)
        .select_from(m)
        .join(g, g.id == m.encounter_game_id)
        .join(e, sa.and_(e.id == g.encounter_id, e.workspace_id == m.workspace_id, e.discipline == m.discipline))
        .where(m.discipline == discipline)
        .subquery()
    )
