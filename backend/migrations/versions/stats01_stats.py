"""Lossless native statistics cutover; maintenance transaction, forward-fix only.

Legacy tables remain the independent source until the separately gated stats02.
No application imports: mappings, projections and proof are frozen in this revision.
"""

from __future__ import annotations

import hashlib
import json

import sqlalchemy as sa
from alembic import op

revision = "stats01"
down_revision = "discipline01c"
branch_labels = None
depends_on = None
BATCH_MATCHES = 100
PREFLIGHT_SAMPLE = 20

STAT_NAMES = (
    ("Eliminations", "eliminations"),
    ("FinalBlows", "final_blows"),
    ("Deaths", "deaths"),
    ("AllDamageDealt", "all_damage_dealt"),
    ("BarrierDamageDealt", "barrier_damage_dealt"),
    ("HeroDamageDealt", "hero_damage_dealt"),
    ("HealingDealt", "healing_dealt"),
    ("HealingReceived", "healing_received"),
    ("SelfHealing", "self_healing"),
    ("DamageTaken", "damage_taken"),
    ("DamageBlocked", "damage_blocked"),
    ("DefensiveAssists", "defensive_assists"),
    ("OffensiveAssists", "offensive_assists"),
    ("UltimatesEarned", "ultimates_earned"),
    ("UltimatesUsed", "ultimates_used"),
    ("MultikillBest", "multikill_best"),
    ("Multikills", "multikills"),
    ("SoloKills", "solo_kills"),
    ("ObjectiveKills", "objective_kills"),
    ("EnvironmentalKills", "environmental_kills"),
    ("EnvironmentalDeaths", "environmental_deaths"),
    ("CriticalHits", "critical_hits"),
    ("CriticalHitAccuracy", "critical_hit_accuracy"),
    ("ScopedAccuracy", "scoped_accuracy"),
    ("ScopedCriticalHitAccuracy", "scoped_critical_hit_accuracy"),
    ("ScopedCriticalHitKills", "scoped_critical_hit_kills"),
    ("ShotsFired", "shots_fired"),
    ("ShotsHit", "shots_hit"),
    ("ShotsMissed", "shots_missed"),
    ("ScopedShotsFired", "scoped_shots_fired"),
    ("ScopedShotsHit", "scoped_shots_hit"),
    ("WeaponAccuracy", "weapon_accuracy"),
    ("HeroTimePlayed", "hero_time_played"),
    ("FirstPicks", "first_picks"),
    ("FirstDeaths", "first_deaths"),
    ("UltimateKills", "ultimate_kills"),
    ("SupportKills", "support_kills"),
    ("Performance", "performance"),
    ("PerformancePoints", "performance_points"),
    ("KD", "kd"),
    ("KDA", "kda"),
    ("DamageDelta", "damage_delta"),
    ("FBE", "fbe"),
    ("DamageFB", "damage_fb"),
    ("Assists", "assists"),
    ("ImpactPoints", "impact_points"),
    ("ImpactRank", "impact_rank"),
    ("OverperformanceScore", "overperformance_score"),
)
EVENT_NAMES = (
    ("OffensiveAssist", "offensive_assist"),
    ("DefensiveAssist", "defensive_assist"),
    ("UltimateCharged", "ultimate_charged"),
    ("UltimateStart", "ultimate_start"),
    ("UltimateEnd", "ultimate_end"),
    ("HeroSwap", "hero_swap"),
    ("MercyRez", "mercy_rez"),
    ("EchoDuplicateStart", "echo_duplicate_start"),
    ("EchoDuplicateEnd", "echo_duplicate_end"),
)
ABILITY_VALUES = (
    ("PrimaryFire", "Primary Fire"),
    ("SecondaryFire", "Secondary Fire"),
    ("Ability1", "Ability 1"),
    ("Ability2", "Ability 2"),
    ("Ultimate", "Ultimate"),
    ("Melee", "Melee"),
    ("Crouch", "Crouch"),
)
DEPENDENCY_RENAMES = (
    ("matches.statistics", "stats.fact"),
    ("matches.match", "stats.match"),
    ("matches.kill_feed", "stats.event"),
    ("matches.event", "stats.event"),
    ("matches.stat_baselines", "stats.stat_baseline"),
    ("log_processing.record", "stats.ingest_job"),
)


def _literal(value):
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        return str(value)
    return "'" + str(value).replace("'", "''") + "'"


def _values(rows):
    return ",\n".join("(" + ",".join(_literal(v) for v in row) + ")" for row in rows)


RESOLVED_GAMES = """
SELECT m.id AS match_id,
 coalesce((SELECT g.id FROM encounter.game g WHERE g.encounter_id=m.encounter_id
            AND g.position=m.map_index AND g.state<>'cancelled'),
          (SELECT min(g.id) FROM encounter.game g WHERE g.encounter_id=m.encounter_id
            AND g.map_id=m.map_id AND g.state<>'cancelled' HAVING count(*)=1)) AS game_id,
 e.workspace_id, e.discipline, e.tournament_id, e.id AS encounter_id
FROM matches.match m JOIN encounter.encounter e ON e.id=m.encounter_id
"""
SOURCE_ENDPOINTS = """
SELECT match_id,user_id,team_id FROM matches.statistics
UNION ALL SELECT match_id,killer_id,killer_team_id FROM matches.kill_feed
UNION ALL SELECT match_id,victim_id,victim_team_id FROM matches.kill_feed
UNION ALL SELECT match_id,user_id,team_id FROM matches.event
UNION ALL SELECT match_id,related_user_id,related_team_id FROM matches.event
"""
SOURCE_TEAMS = """
SELECT match_id,team_id FROM stats01_endpoints WHERE team_id IS NOT NULL
UNION ALL SELECT id,home_team_id FROM matches.match
UNION ALL SELECT id,away_team_id FROM matches.match
"""
# Historical roster identity belongs to this observation, not today's site name.
# Preserve real strings; blank rosters may fall back, overlong handles must fail.
HANDLE = """coalesce(
 (SELECT CASE WHEN btrim(r.name)<>'' THEN r.name END FROM tournament.player r
  WHERE r.workspace_member_id=w.id AND r.team_id=p.team_id AND r.tournament_id=x.tournament_id
  ORDER BY r.is_substitution,r.id LIMIT 1),
 (SELECT a.username FROM players.social_account a
  WHERE a.user_id=p.user_id AND a.provider='battlenet' AND a.is_primary
  ORDER BY a.id LIMIT 1))"""


def _raw_key(filename, tournament):
    # Exactly two removeprefix calls, not a regex or arbitrary slash stripping.
    prefix = f"('logs/'||{tournament}::text||'/')"
    bare = f"CASE WHEN starts_with({filename},{prefix}) THEN substr({filename},length({prefix})+1) ELSE {filename} END"
    bare = f"CASE WHEN starts_with(({bare}),'logs/') THEN substr(({bare}),6) ELSE ({bare}) END"
    return f"{prefix}||({bare})", f"({bare})"


RECORD_RAW, RECORD_BARE = _raw_key("r.filename", "r.tournament_id")
MATCH_RAW, MATCH_BARE = _raw_key("m.log_name", "x.tournament_id")
OUTBOX_SCOPE = """(o.event_type='achievement_evaluate' OR o.payload_json::jsonb->>'event_type'='achievement_evaluate')
 AND o.status IN ('pending','failed')"""
PREFLIGHT_SETUP = (
    "SET LOCAL timezone = 'UTC'",
    "SET LOCAL extra_float_digits = 3",
    f"CREATE TEMP VIEW stats01_stat_names(legacy_name,code) AS VALUES {_values(STAT_NAMES)}",
    f"CREATE TEMP VIEW stats01_event_names(legacy_name,code) AS VALUES {_values(EVENT_NAMES)}",
    f"CREATE TEMP VIEW stats01_ability_values(legacy_name,value) AS VALUES {_values(ABILITY_VALUES)}",
    f"CREATE TEMP VIEW stats01_dependency_names(old_name,new_name) AS VALUES {_values(DEPENDENCY_RENAMES)}",
    f"CREATE TEMP VIEW stats01_match AS {RESOLVED_GAMES}",
    f"CREATE TEMP VIEW stats01_endpoints AS {SOURCE_ENDPOINTS}",
    f"CREATE TEMP VIEW stats01_source_teams AS {SOURCE_TEAMS}",
    """CREATE TEMP VIEW stats01_team AS
       SELECT x.match_id,x.game_id,et.team_id,gt.encounter_team_id
       FROM stats01_match x JOIN encounter.game_team gt ON gt.game_id=x.game_id
       JOIN encounter.team et ON et.id=gt.encounter_team_id AND et.encounter_id=x.encounter_id""",
    "CREATE TEMP VIEW stats01_member AS SELECT workspace_id,player_id,id FROM workspace_member",
    f"""CREATE TEMP VIEW stats01_handles AS
       SELECT p.match_id,p.user_id AS player_id,p.team_id,{HANDLE} AS handle_snapshot
       FROM (SELECT DISTINCT match_id,user_id,team_id FROM stats01_endpoints WHERE user_id IS NOT NULL) p
       JOIN stats01_match x ON x.match_id=p.match_id
       LEFT JOIN stats01_member w ON w.workspace_id=x.workspace_id AND w.player_id=p.user_id""",
    """CREATE TEMP VIEW stats01_roles AS
       SELECT r.id, r.code FROM catalog.role r JOIN catalog.role_dimension d ON d.id=r.dimension_id
       WHERE d.discipline='overwatch' AND d.code='player_role' AND d.rated
         AND r.workspace_id IS NULL AND r.parent_role_id IS NULL AND r.code IN ('tank','damage','support')""",
)

# Every query returns id/reason; no bounded scan is used as the integrity test.
PREFLIGHT = [
    (
        "1_game_binding",
        """
      SELECT m.id,'no_unique_live_game' reason FROM matches.match m LEFT JOIN stats01_match x ON x.match_id=m.id WHERE x.game_id IS NULL
      UNION ALL SELECT match_id,'duplicate_game_claim' FROM stats01_match WHERE game_id IN
        (SELECT game_id FROM stats01_match GROUP BY game_id HAVING count(*)>1)
      UNION ALL SELECT m.id,'explicit_position_map_mismatch' FROM matches.match m JOIN encounter.game g
        ON g.encounter_id=m.encounter_id AND g.position=m.map_index AND g.state<>'cancelled' WHERE g.map_id IS DISTINCT FROM m.map_id
    """,
    ),
    (
        "2_missing_member",
        """
      SELECT DISTINCT p.user_id id,'missing_workspace_member' reason FROM stats01_endpoints p
      JOIN stats01_match x ON x.match_id=p.match_id
      WHERE p.user_id IS NOT NULL AND NOT EXISTS
        (SELECT 1 FROM workspace_member w WHERE w.workspace_id=x.workspace_id AND w.player_id=p.user_id)
      UNION ALL SELECT id,'statistics_without_player' FROM matches.statistics WHERE user_id IS NULL
    """,
    ),
    (
        "3_team_binding",
        """
      SELECT DISTINCT s.match_id id,'missing_or_ambiguous_participation' reason FROM stats01_source_teams s
      WHERE (SELECT count(*) FROM stats01_team t WHERE t.match_id=s.match_id AND t.team_id=s.team_id)<>1
      UNION ALL SELECT id,'same_team_both_sides' FROM matches.match WHERE home_team_id=away_team_id
      UNION ALL SELECT DISTINCT match_id,'player_without_team' FROM stats01_endpoints WHERE user_id IS NOT NULL AND team_id IS NULL
      UNION ALL SELECT DISTINCT s.match_id,'team_not_observed_side' FROM stats01_source_teams s JOIN matches.match m ON m.id=s.match_id
        WHERE s.team_id NOT IN (m.home_team_id,m.away_team_id)
    """,
    ),
    (
        "4_duplicate_facts",
        """
      SELECT min(id) id,'duplicate_null_equal_fact' reason FROM matches.statistics
      GROUP BY match_id,round,team_id,user_id,hero_id,name HAVING count(*)>1
    """,
    ),
    (
        "5_player_teams",
        """
      SELECT match_id id,'player_multiple_teams' reason FROM stats01_endpoints
      WHERE user_id IS NOT NULL GROUP BY match_id,user_id HAVING count(DISTINCT team_id)>1
    """,
    ),
    (
        "6_ownership",
        """
      SELECT m.id,'not_ow_tournament_log' reason FROM matches.match m JOIN stats01_match x ON x.match_id=m.id
      LEFT JOIN tournament.tournament t ON t.id=x.tournament_id
      WHERE x.discipline<>'overwatch' OR t.id IS NULL OR t.discipline<>x.discipline
         OR t.workspace_id<>x.workspace_id OR m.source::text<>'log_parser' OR m.code IS NOT NULL
      UNION ALL SELECT m.id,'wrong_map_catalog' FROM matches.match m LEFT JOIN catalog.entity c ON c.id=m.map_id
        WHERE c.id IS NULL OR c.kind<>'map' OR c.discipline<>'overwatch'
      UNION ALL SELECT s.match_id,'wrong_character_catalog' FROM (
        SELECT match_id,hero_id FROM matches.statistics UNION ALL SELECT match_id,killer_hero_id FROM matches.kill_feed
        UNION ALL SELECT match_id,victim_hero_id FROM matches.kill_feed UNION ALL SELECT match_id,hero_id FROM matches.event
        UNION ALL SELECT match_id,related_hero_id FROM matches.event
      ) s LEFT JOIN catalog.entity c ON c.id=s.hero_id
        WHERE s.hero_id IS NOT NULL AND (c.id IS NULL OR c.kind<>'character' OR c.discipline<>'overwatch')
      UNION ALL SELECT r.id,'record_owner' FROM log_processing.record r LEFT JOIN tournament.tournament t ON t.id=r.tournament_id
        LEFT JOIN encounter.encounter e ON e.id=r.attached_encounter_id
        WHERE t.id IS NULL OR t.discipline<>'overwatch' OR (r.attached_encounter_id IS NOT NULL AND
          (e.id IS NULL OR e.tournament_id<>t.id OR e.workspace_id<>t.workspace_id OR e.discipline<>t.discipline))
      UNION ALL SELECT m.id,'match_record_owner' FROM matches.match m JOIN stats01_match x ON x.match_id=m.id
        LEFT JOIN log_processing.record r ON r.id=m.log_record_id
        WHERE m.log_record_id IS NOT NULL AND (r.id IS NULL OR r.tournament_id<>x.tournament_id OR
          (r.attached_encounter_id IS NOT NULL AND r.attached_encounter_id<>x.encounter_id))
    """,
    ),
    (
        "7_baselines",
        """
      SELECT b.id,'unresolved_baseline' reason FROM matches.stat_baselines b
       WHERE (SELECT count(*) FROM stats01_roles r WHERE r.code=lower(b.role::text))<>1
          OR (SELECT count(*) FROM stats01_stat_names n WHERE n.legacy_name=b.stat::text)<>1
          OR b.mean::text IN ('NaN','Infinity','-Infinity') OR b.std::text IN ('NaN','Infinity','-Infinity')
    """,
    ),
    (
        "8_raw_provenance",
        f"""
      SELECT r.id,'invalid_real_hash' reason FROM log_processing.record r
        WHERE r.content_hash IS NULL OR r.content_hash !~ '^[0-9a-fA-F]{{64}}$'
      UNION ALL SELECT r.id,'unsafe_raw_key' FROM log_processing.record r
        WHERE {RECORD_BARE} IS NULL OR {RECORD_BARE}='' OR starts_with({RECORD_BARE},'/')
           OR strpos({RECORD_BARE},'..')>0 OR length({RECORD_RAW})>512
      UNION ALL SELECT m.id,'raw_match_without_record_or_key_conflict' FROM matches.match m
        JOIN stats01_match x ON x.match_id=m.id LEFT JOIN log_processing.record r ON r.id=m.log_record_id
        WHERE m.log_name IS NOT NULL AND (r.id IS NULL OR {MATCH_BARE}='' OR starts_with({MATCH_BARE},'/')
          OR strpos({MATCH_BARE},'..')>0 OR length({MATCH_RAW})>512 OR ({MATCH_RAW}) IS DISTINCT FROM ({RECORD_RAW}))
    """,
    ),
    (
        "9_representability",
        """
      SELECT match_id id,'invalid_segment' reason FROM (
        SELECT match_id,round FROM matches.statistics UNION ALL SELECT match_id,round FROM matches.kill_feed
        UNION ALL SELECT match_id,round FROM matches.event) s WHERE round IS NULL OR round<0 OR round>32767
      UNION ALL SELECT id,'nonfinite_stat_or_unknown_name' FROM matches.statistics s
        WHERE value IS NULL OR value::text IN ('NaN','Infinity','-Infinity')
          OR NOT EXISTS(SELECT 1 FROM stats01_stat_names n WHERE n.legacy_name=s.name::text)
      UNION ALL SELECT id,'invalid_kill' FROM matches.kill_feed k
        WHERE time IS NULL OR time::text IN ('NaN','Infinity','-Infinity') OR damage IS NULL
          OR damage::text IN ('NaN','Infinity','-Infinity') OR (ability IS NOT NULL AND NOT EXISTS
            (SELECT 1 FROM stats01_ability_values a WHERE a.legacy_name=k.ability::text))
      UNION ALL SELECT id,'invalid_event' FROM matches.event e WHERE time IS NULL OR time::text IN ('NaN','Infinity','-Infinity')
        OR NOT EXISTS(SELECT 1 FROM stats01_event_names n WHERE n.legacy_name=e.name::text)
      UNION ALL SELECT id,'nonfinite_duration' FROM matches.match WHERE time::text IN ('NaN','Infinity','-Infinity')
      UNION ALL SELECT DISTINCT player_id,'unusable_handle' FROM stats01_handles
        WHERE handle_snapshot IS NULL OR btrim(handle_snapshot)='' OR length(handle_snapshot)>255
    """,
    ),
]

# Catalog inventory is authoritative, including renamed restored constraints.
INBOUND_FKS = """
SELECT c.oid,c.conrelid::regclass::text AS source,c.confrelid::regclass::text AS target,c.conname,
 ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY k(n,ord)
       JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.n ORDER BY k.ord) AS columns,
 ARRAY(SELECT a.attname::text FROM unnest(c.confkey) WITH ORDINALITY k(n,ord)
       JOIN pg_attribute a ON a.attrelid=c.confrelid AND a.attnum=k.n ORDER BY k.ord) AS target_columns
FROM pg_constraint c JOIN pg_class t ON t.oid=c.confrelid JOIN pg_namespace n ON n.oid=t.relnamespace
WHERE c.contype='f' AND n.nspname IN ('matches','log_processing')
"""
ALLOWED_FKS = (
    ("matches.statistics", "matches.match", "match_id"),
    ("matches.kill_feed", "matches.match", "match_id"),
    ("matches.event", "matches.match", "match_id"),
    ("matches.match", "log_processing.record", "log_record_id"),
    ("overwatch.catalog_alias_miss", "log_processing.record", "last_log_record_id"),
    ("achievements.evaluation_result", "matches.match", "match_id"),
    ("achievements.override", "matches.match", "match_id"),
)
DEPENDENCY_ROWS = f"""
SELECT id,'rule'::text owner,depends_on::jsonb AS value FROM achievements.rule
UNION ALL SELECT o.id,'outbox',o.payload_json::jsonb->'changed_tables' FROM event_outbox o WHERE {OUTBOX_SCOPE}
"""
PREFLIGHT.append(
    (
        "10_dependencies",
        f"""
 SELECT a.id,'orphan_alias_breadcrumb' reason FROM catalog.alias_miss a
 LEFT JOIN log_processing.record r ON r.id=a.last_ingest_job_id
 LEFT JOIN tournament.tournament t ON t.id=r.tournament_id
 WHERE a.last_ingest_job_id IS NOT NULL AND (r.id IS NULL OR t.discipline IS DISTINCT FROM a.discipline)
 UNION ALL SELECT oid::bigint,'unknown_inbound_fk' FROM ({INBOUND_FKS}) f
 WHERE NOT EXISTS(SELECT 1 FROM (VALUES {_values(ALLOWED_FKS)}) a(source,target,col)
   WHERE a.source=f.source AND a.target=f.target AND f.columns=ARRAY[a.col] AND f.target_columns=ARRAY['id']::text[])
 UNION ALL SELECT r.ev_class::bigint,'unknown_dependent_view' FROM pg_depend d
 JOIN pg_rewrite r ON r.oid=d.objid JOIN pg_class src ON src.oid=d.refobjid
 JOIN pg_namespace ns ON ns.oid=src.relnamespace
 JOIN pg_class v ON v.oid=r.ev_class
 WHERE d.classid='pg_rewrite'::regclass AND d.refclassid='pg_class'::regclass
   AND ns.nspname IN ('matches','log_processing') AND r.ev_class<>d.refobjid
   AND r.ev_class<>'matches.mv_hero_global_stats'::regclass AND v.relnamespace<>pg_my_temp_schema()
 UNION ALL SELECT id,'malformed_dependency_array' FROM ({DEPENDENCY_ROWS}) d
 WHERE value IS NULL OR jsonb_typeof(value)<>'array'
 UNION ALL SELECT d.id,'unknown_legacy_dependency' FROM ({DEPENDENCY_ROWS}) d
 CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(d.value)='array' THEN d.value ELSE '[]'::jsonb END) a(value)
 WHERE jsonb_typeof(a.value)<>'string' OR ((a.value#>>'{{}}' LIKE 'matches.%' OR a.value#>>'{{}}' LIKE 'log_processing.%')
   AND NOT EXISTS(SELECT 1 FROM stats01_dependency_names n WHERE n.old_name=a.value#>>'{{}}'))
 UNION ALL SELECT a.id,'orphan_evaluation_match' FROM achievements.evaluation_result a
 WHERE a.match_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM matches.match m WHERE m.id=a.match_id)
 UNION ALL SELECT a.id,'orphan_override_match' FROM achievements.override a
 WHERE a.match_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM matches.match m WHERE m.id=a.match_id)
 UNION ALL SELECT 0::bigint,'missing_or_ambiguous_required_fk:'||a.source
 FROM (VALUES ('achievements.evaluation_result'),('achievements.override')) a(source)
 WHERE (SELECT count(*) FROM ({INBOUND_FKS}) f JOIN pg_constraint c ON c.oid=f.oid
   WHERE f.source=a.source AND f.target='matches.match' AND c.confdeltype='c' AND c.convalidated
   AND f.columns=ARRAY['match_id']::text[] AND f.target_columns=ARRAY['id']::text[])<>1
 UNION ALL SELECT 0::bigint,'partial_alias_fk' WHERE EXISTS(
   SELECT 1 FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=ANY(c.conkey)
   WHERE c.contype='f' AND c.conrelid='catalog.alias_miss'::regclass AND a.attname='last_ingest_job_id')
 UNION ALL SELECT 0::bigint,'missing_or_ambiguous_channel_index' WHERE
   (SELECT count(*) FROM pg_index i WHERE i.indrelid='log_processing.discord_channel'::regclass
    AND i.indisunique AND i.indnkeyatts=1 AND i.indnatts=1 AND i.indpred IS NULL AND i.indexprs IS NULL
    AND i.indkey[0]=(SELECT attnum FROM pg_attribute WHERE attrelid=i.indrelid AND attname='channel_id'))<>1
 UNION ALL SELECT 0::bigint,'partial_stats_schema' WHERE to_regnamespace('stats') IS NOT NULL
""",
    )
)
COUNTS = (
    (
        "event_only_players",
        "SELECT count(*) FROM (SELECT DISTINCT match_id,user_id FROM stats01_endpoints WHERE user_id IS NOT NULL EXCEPT SELECT match_id,user_id FROM matches.statistics) p",
    ),
    (
        "duplicate_import_hashes",
        "SELECT count(*) FROM (SELECT tournament_id,content_hash FROM log_processing.record GROUP BY tournament_id,content_hash HAVING count(*)>1) h",
    ),
    ("unlinked_no_raw_matches", "SELECT count(*) FROM matches.match WHERE log_record_id IS NULL AND log_name IS NULL"),
)


def _preflight():
    bind = op.get_bind()
    if bind.scalar(sa.text("SELECT to_regnamespace('stats') IS NOT NULL")):
        raise RuntimeError("stats01 refuses partial stats schema; restore or forward-fix explicitly")
    failures = []
    for name, query in PREFLIGHT:
        count = bind.scalar(sa.text(f"SELECT count(*) FROM ({query}) offending"))
        if count:
            sample = bind.execute(
                sa.text(f"SELECT * FROM ({query}) offending ORDER BY id,reason LIMIT {PREFLIGHT_SAMPLE}")
            ).all()
            failures.append({"class": name, "count": count, "sample": [tuple(row) for row in sample]})
    if failures:
        raise RuntimeError(f"stats01 preflight refused: {failures!r}")


# Constraints on the two bulk relations are installed only after all inserts.
DDL = (
    "CREATE SCHEMA stats",
    """CREATE TABLE stats.stat_def (
      id SMALLINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      discipline VARCHAR(32) NOT NULL REFERENCES catalog.discipline(code),
      code VARCHAR(64) NOT NULL,name VARCHAR(128) NOT NULL,value_format VARCHAR(16) NOT NULL,
      aggregation VARCHAR(8) NOT NULL CHECK(aggregation IN ('sum','max','min','avg','last')),
      stat_group VARCHAR(32),active BOOLEAN NOT NULL DEFAULT true,sort_order INTEGER NOT NULL DEFAULT 0,
      CONSTRAINT uq_stat_def_code UNIQUE(discipline,code))""",
    """CREATE TABLE stats.event_type (
      id SMALLINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      discipline VARCHAR(32) NOT NULL REFERENCES catalog.discipline(code),
      code VARCHAR(64) NOT NULL,name VARCHAR(128) NOT NULL,active BOOLEAN NOT NULL DEFAULT true,
      CONSTRAINT uq_event_type_code UNIQUE(discipline,code))""",
    """CREATE TABLE stats.ingest_job (
      id BIGSERIAL PRIMARY KEY,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ,
      workspace_id BIGINT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
      discipline VARCHAR(32) NOT NULL REFERENCES catalog.discipline(code),
      source_kind VARCHAR(32) NOT NULL,external_id VARCHAR(128),content_hash CHAR(64) NOT NULL,
      filename VARCHAR(500),raw_ref VARCHAR(512) NOT NULL,document_ref VARCHAR(512),
      status VARCHAR(16) NOT NULL CHECK(status IN ('pending','processing','awaiting_link','done','failed')),
      attempts INTEGER NOT NULL DEFAULT 0,error_message TEXT,
      uploader_user_id BIGINT REFERENCES players."user"(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED,
      api_key_id BIGINT REFERENCES auth.api_key(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED,
      hint_tournament_id BIGINT REFERENCES tournament.tournament(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED,
      hint_encounter_id BIGINT REFERENCES encounter.encounter(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED,
      hint_encounter_game_id BIGINT REFERENCES encounter.game(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED,
      started_at TIMESTAMPTZ,finished_at TIMESTAMPTZ)""",
    """CREATE TABLE stats.match (
      id BIGSERIAL PRIMARY KEY,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ,
      workspace_id BIGINT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
      discipline VARCHAR(32) NOT NULL,
      encounter_game_id BIGINT NOT NULL UNIQUE REFERENCES encounter.game(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
      ingest_job_id BIGINT REFERENCES stats.ingest_job(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED,
      revision INTEGER NOT NULL DEFAULT 1,played_at TIMESTAMPTZ,duration_s FLOAT8,map_entity_id BIGINT NOT NULL,
      map_kind VARCHAR(16) NOT NULL DEFAULT 'map' CHECK(map_kind='map'),
      CONSTRAINT fk_match_map FOREIGN KEY(map_entity_id,discipline,map_kind)
        REFERENCES catalog.entity(id,discipline,kind) ON DELETE RESTRICT)""",
    """CREATE TABLE stats.match_team (
      match_id BIGINT NOT NULL REFERENCES stats.match(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
      encounter_game_id BIGINT NOT NULL,encounter_team_id BIGINT NOT NULL,
      source_position INTEGER NOT NULL CONSTRAINT ck_match_team_source_position CHECK(source_position>=1),
      PRIMARY KEY(match_id,encounter_team_id),CONSTRAINT uq_match_team_source_position UNIQUE(match_id,source_position),
      CONSTRAINT fk_match_team_game_team FOREIGN KEY(encounter_game_id,encounter_team_id)
        REFERENCES encounter.game_team(game_id,encounter_team_id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED)""",
    """CREATE TABLE stats.match_player (
      match_id BIGINT NOT NULL,encounter_team_id BIGINT NOT NULL,
      workspace_member_id BIGINT NOT NULL REFERENCES workspace_member(id) DEFERRABLE INITIALLY DEFERRED,
      handle_snapshot VARCHAR(255) NOT NULL,
      observed_role_id BIGINT REFERENCES catalog.role(id) DEFERRABLE INITIALLY DEFERRED,
      PRIMARY KEY(match_id,workspace_member_id),
      CONSTRAINT fk_match_player_team FOREIGN KEY(match_id,encounter_team_id)
        REFERENCES stats.match_team(match_id,encounter_team_id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED)""",
    """CREATE TABLE stats.segment (
      match_id BIGINT NOT NULL REFERENCES stats.match(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
      segment SMALLINT NOT NULL CHECK(segment>=1),kind VARCHAR(16) NOT NULL,attrs JSONB NOT NULL DEFAULT '{}'::jsonb,
      PRIMARY KEY(match_id,segment))""",
    """CREATE TABLE stats.fact (
      match_id BIGINT NOT NULL,segment SMALLINT NOT NULL DEFAULT 0,encounter_team_id BIGINT NOT NULL,
      workspace_member_id BIGINT,entity_id BIGINT,
      entity_kind VARCHAR(16) NOT NULL DEFAULT 'character' CHECK(entity_kind='character'),
      stat_id SMALLINT NOT NULL,value FLOAT8 NOT NULL)""",
    """CREATE TABLE stats.event (
      id BIGSERIAL PRIMARY KEY,match_id BIGINT NOT NULL,segment SMALLINT NOT NULL DEFAULT 0,t FLOAT8 NOT NULL,
      type_id SMALLINT NOT NULL,actor_member_id BIGINT,actor_team_id BIGINT,target_member_id BIGINT,target_team_id BIGINT,
      entity_id BIGINT,related_entity_id BIGINT,
      entity_kind VARCHAR(16) NOT NULL DEFAULT 'character' CHECK(entity_kind='character'),data JSONB)""",
    """CREATE TABLE stats.stat_baseline (
      id BIGSERIAL PRIMARY KEY,formula_version VARCHAR(64) NOT NULL,
      role_id BIGINT NOT NULL REFERENCES catalog.role(id) DEFERRABLE INITIALLY DEFERRED,
      rank_bucket SMALLINT NOT NULL DEFAULT -1,stat_id SMALLINT NOT NULL REFERENCES stats.stat_def(id),
      mean FLOAT8 NOT NULL,std FLOAT8 NOT NULL,meta JSONB,computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT uq_stat_baseline UNIQUE(formula_version,role_id,rank_bucket,stat_id))""",
)
BULK_CONSTRAINTS = (
    """ALTER TABLE stats.fact
      ADD CONSTRAINT fk_fact_stat FOREIGN KEY(stat_id) REFERENCES stats.stat_def(id),
      ADD CONSTRAINT fk_fact_team FOREIGN KEY(match_id,encounter_team_id)
        REFERENCES stats.match_team(match_id,encounter_team_id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
      ADD CONSTRAINT fk_fact_player FOREIGN KEY(match_id,workspace_member_id)
        REFERENCES stats.match_player(match_id,workspace_member_id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
      ADD CONSTRAINT fk_fact_entity FOREIGN KEY(entity_id,entity_kind) REFERENCES catalog.entity(id,kind) ON DELETE RESTRICT,
      ADD CONSTRAINT uq_fact UNIQUE NULLS NOT DISTINCT(match_id,segment,encounter_team_id,workspace_member_id,entity_id,stat_id)""",
    """ALTER TABLE stats.event
      ADD CONSTRAINT fk_event_match FOREIGN KEY(match_id) REFERENCES stats.match(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
      ADD CONSTRAINT fk_event_type FOREIGN KEY(type_id) REFERENCES stats.event_type(id),
      ADD CONSTRAINT fk_event_actor FOREIGN KEY(match_id,actor_member_id)
        REFERENCES stats.match_player(match_id,workspace_member_id) DEFERRABLE INITIALLY DEFERRED,
      ADD CONSTRAINT fk_event_target FOREIGN KEY(match_id,target_member_id)
        REFERENCES stats.match_player(match_id,workspace_member_id) DEFERRABLE INITIALLY DEFERRED,
      ADD CONSTRAINT fk_event_actor_team FOREIGN KEY(match_id,actor_team_id)
        REFERENCES stats.match_team(match_id,encounter_team_id) DEFERRABLE INITIALLY DEFERRED,
      ADD CONSTRAINT fk_event_target_team FOREIGN KEY(match_id,target_team_id)
        REFERENCES stats.match_team(match_id,encounter_team_id) DEFERRABLE INITIALLY DEFERRED,
      ADD CONSTRAINT fk_event_entity FOREIGN KEY(entity_id,entity_kind) REFERENCES catalog.entity(id,kind) DEFERRABLE INITIALLY DEFERRED,
      ADD CONSTRAINT fk_event_related_entity FOREIGN KEY(related_entity_id,entity_kind) REFERENCES catalog.entity(id,kind) DEFERRABLE INITIALLY DEFERRED""",
)
INDEXES = (
    "CREATE UNIQUE INDEX uq_ingest_job_external ON stats.ingest_job(workspace_id,source_kind,external_id) WHERE external_id IS NOT NULL",
    "CREATE UNIQUE INDEX uq_ingest_job_hash ON stats.ingest_job(workspace_id,content_hash) WHERE external_id IS NULL",
    "CREATE INDEX ix_ingest_job_status ON stats.ingest_job(status,created_at)",
    "CREATE INDEX ix_ingest_job_uploader ON stats.ingest_job(uploader_user_id)",
    "CREATE INDEX ix_ingest_job_api_key ON stats.ingest_job(api_key_id)",
    "CREATE INDEX ix_ingest_job_tournament ON stats.ingest_job(hint_tournament_id)",
    "CREATE INDEX ix_ingest_job_encounter ON stats.ingest_job(hint_encounter_id)",
    "CREATE INDEX ix_ingest_job_game ON stats.ingest_job(hint_encounter_game_id)",
    "CREATE INDEX ix_match_ingest_job ON stats.match(ingest_job_id)",
    "CREATE INDEX ix_match_workspace ON stats.match(workspace_id)",
    "CREATE INDEX ix_match_team_game_team ON stats.match_team(encounter_game_id,encounter_team_id)",
    "CREATE INDEX ix_match_player_member ON stats.match_player(workspace_member_id)",
    "CREATE INDEX ix_match_player_role ON stats.match_player(observed_role_id)",
    "CREATE INDEX ix_fact_member_stat_total ON stats.fact(workspace_member_id,stat_id) WHERE segment=0 AND entity_id IS NULL",
    "CREATE INDEX ix_fact_member_entity_total ON stats.fact(workspace_member_id,entity_id,stat_id) WHERE segment=0 AND entity_id IS NOT NULL",
    "CREATE INDEX ix_fact_match_member ON stats.fact(match_id,workspace_member_id,segment)",
    "CREATE INDEX ix_event_match ON stats.event(match_id,t)",
    "CREATE INDEX ix_stat_baseline_role ON stats.stat_baseline(role_id)",
    "CREATE INDEX ix_stat_baseline_version ON stats.stat_baseline(formula_version)",
)

JOB_COLUMNS = "id,created_at,updated_at,workspace_id,discipline,source_kind,external_id,content_hash,filename,raw_ref,document_ref,status,attempts,error_message,uploader_user_id,api_key_id,hint_tournament_id,hint_encounter_id,hint_encounter_game_id,started_at,finished_at"
MATCH_COLUMNS = "id,created_at,updated_at,workspace_id,discipline,encounter_game_id,ingest_job_id,revision,played_at,duration_s,map_entity_id,map_kind"
TEAM_COLUMNS = "match_id,encounter_game_id,encounter_team_id,source_position"
PLAYER_COLUMNS = "match_id,encounter_team_id,workspace_member_id,handle_snapshot,observed_role_id"
FACT_COLUMNS = "match_id,segment,encounter_team_id,workspace_member_id,entity_id,entity_kind,stat_id,value"
EVENT_COLUMNS = "match_id,segment,t,type_id,actor_member_id,actor_team_id,target_member_id,target_team_id,entity_id,related_entity_id,entity_kind,data"
SEGMENT_COLUMNS = "match_id,segment,kind,attrs"
BASELINE_COLUMNS = "id,formula_version,role_id,rank_bucket,stat_id,mean,std,meta,computed_at"

EXPECTED_JOBS = f"""SELECT r.id,r.created_at,r.updated_at,t.workspace_id,t.discipline,
 r.source::text AS source_kind,'legacy:log_processing.record:'||r.id::text AS external_id,
 r.content_hash::char(64),r.filename,{RECORD_RAW} AS raw_ref,NULL::varchar(512) AS document_ref,
 r.status::text AS status,r.attempts,r.error_message,r.uploader_id AS uploader_user_id,
 NULL::bigint AS api_key_id,r.tournament_id AS hint_tournament_id,
 r.attached_encounter_id AS hint_encounter_id,NULL::bigint AS hint_encounter_game_id,r.started_at,r.finished_at
 FROM log_processing.record r JOIN tournament.tournament t ON t.id=r.tournament_id"""
EXPECTED_MATCHES = """SELECT m.id,m.created_at,m.updated_at,x.workspace_id,x.discipline,x.game_id AS encounter_game_id,
 m.log_record_id AS ingest_job_id,1 AS revision,NULL::timestamptz AS played_at,m.time AS duration_s,
 m.map_id AS map_entity_id,'map'::varchar AS map_kind FROM matches.match m JOIN stats01_match x ON x.match_id=m.id"""
EXPECTED_TEAMS = """SELECT m.id AS match_id,x.game_id AS encounter_game_id,t.encounter_team_id,s.position AS source_position
 FROM matches.match m JOIN stats01_match x ON x.match_id=m.id
 CROSS JOIN LATERAL (VALUES(m.home_team_id,1),(m.away_team_id,2)) s(team_id,position)
 JOIN stats01_team t ON t.match_id=m.id AND t.team_id=s.team_id"""
EXPECTED_PLAYERS = """SELECT DISTINCT p.match_id,t.encounter_team_id,w.id AS workspace_member_id,
 h.handle_snapshot,NULL::bigint AS observed_role_id
 FROM stats01_endpoints p JOIN stats01_match x ON x.match_id=p.match_id
 JOIN stats01_team t ON t.match_id=p.match_id AND t.team_id=p.team_id
 JOIN stats01_member w ON w.workspace_id=x.workspace_id AND w.player_id=p.user_id
 JOIN stats01_handles h ON h.match_id=p.match_id AND h.player_id=p.user_id AND h.team_id=p.team_id
 WHERE p.user_id IS NOT NULL"""
EXPECTED_FACTS = """SELECT s.match_id,s.round::smallint AS segment,t.encounter_team_id,
 w.id AS workspace_member_id,s.hero_id AS entity_id,'character'::varchar AS entity_kind,d.id AS stat_id,s.value
 FROM matches.statistics s JOIN stats01_match x ON x.match_id=s.match_id
 JOIN stats01_team t ON t.match_id=s.match_id AND t.team_id=s.team_id
 JOIN stats01_member w ON w.workspace_id=x.workspace_id AND w.player_id=s.user_id
 JOIN stats01_stat_ids d ON d.discipline=x.discipline AND d.legacy_name=s.name::text"""
EXPECTED_SCORES = """SELECT m.id AS match_id,0::smallint AS segment,t.encounter_team_id,
 NULL::bigint AS workspace_member_id,NULL::bigint AS entity_id,'character'::varchar AS entity_kind,
 d.id AS stat_id,s.score::float8 AS value FROM matches.match m JOIN stats01_match x ON x.match_id=m.id
 CROSS JOIN LATERAL (VALUES(m.home_team_id,m.home_score),(m.away_team_id,m.away_score)) s(team_id,score)
 JOIN stats01_team t ON t.match_id=m.id AND t.team_id=s.team_id
 JOIN stats.stat_def d ON d.discipline=x.discipline AND d.code='score'"""
EXPECTED_KILLS = """SELECT k.match_id,k.round::smallint AS segment,k.time AS t,d.id AS type_id,
 aw.id AS actor_member_id,at.encounter_team_id AS actor_team_id,tw.id AS target_member_id,
 tt.encounter_team_id AS target_team_id,k.killer_hero_id AS entity_id,k.victim_hero_id AS related_entity_id,
 'character'::varchar AS entity_kind,jsonb_build_object('ability',a.value,'damage',k.damage,'fight',k.fight,
 'is_critical_hit',k.is_critical_hit,'is_environmental',k.is_environmental) AS data,k.id AS source_id
 FROM matches.kill_feed k JOIN stats01_match x ON x.match_id=k.match_id
 JOIN stats.event_type d ON d.discipline=x.discipline AND d.code='kill'
 LEFT JOIN stats01_team at ON at.match_id=k.match_id AND at.team_id=k.killer_team_id
 LEFT JOIN stats01_team tt ON tt.match_id=k.match_id AND tt.team_id=k.victim_team_id
 LEFT JOIN stats01_member aw ON aw.workspace_id=x.workspace_id AND aw.player_id=k.killer_id
 LEFT JOIN stats01_member tw ON tw.workspace_id=x.workspace_id AND tw.player_id=k.victim_id
 LEFT JOIN stats01_ability_values a ON a.legacy_name=k.ability::text"""
EXPECTED_OTHER_EVENTS = """SELECT e.match_id,e.round::smallint AS segment,e.time AS t,d.id AS type_id,
 aw.id AS actor_member_id,at.encounter_team_id AS actor_team_id,tw.id AS target_member_id,
 tt.encounter_team_id AS target_team_id,e.hero_id AS entity_id,e.related_hero_id AS related_entity_id,
 'character'::varchar AS entity_kind,NULL::jsonb AS data,e.id AS source_id
 FROM matches.event e JOIN stats01_match x ON x.match_id=e.match_id
 JOIN stats01_event_ids d ON d.discipline=x.discipline AND d.legacy_name=e.name::text
 LEFT JOIN stats01_team at ON at.match_id=e.match_id AND at.team_id=e.team_id
 LEFT JOIN stats01_team tt ON tt.match_id=e.match_id AND tt.team_id=e.related_team_id
 LEFT JOIN stats01_member aw ON aw.workspace_id=x.workspace_id AND aw.player_id=e.user_id
 LEFT JOIN stats01_member tw ON tw.workspace_id=x.workspace_id AND tw.player_id=e.related_user_id"""
EXPECTED_EVENTS = f"SELECT {EVENT_COLUMNS} FROM ({EXPECTED_KILLS}) k UNION ALL SELECT {EVENT_COLUMNS} FROM ({EXPECTED_OTHER_EVENTS}) e"
EXPECTED_SEGMENTS = """SELECT DISTINCT match_id,round::smallint AS segment,'round'::varchar AS kind,'{}'::jsonb AS attrs
 FROM (SELECT match_id,round FROM matches.statistics UNION ALL SELECT match_id,round FROM matches.kill_feed
 UNION ALL SELECT match_id,round FROM matches.event) s WHERE round>0"""
EXPECTED_BASELINES = """SELECT b.id,b.formula_version,r.id AS role_id,b.rank_bucket,d.id AS stat_id,b.mean,b.std,b.meta,b.computed_at
 FROM matches.stat_baselines b JOIN stats01_roles r ON r.code=lower(b.role::text)
 JOIN stats01_stat_ids d ON d.discipline='overwatch' AND d.legacy_name=b.stat::text"""

TRANSFER_BATCH = tuple(
    f"INSERT INTO stats.{table}({columns}) SELECT {columns} FROM ({query}) source WHERE match_id BETWEEN :lo AND :hi"
    + (" ORDER BY source_id" if table == "event" else "")
    for table, columns, query in (
        ("match_team", TEAM_COLUMNS, EXPECTED_TEAMS),
        ("match_player", PLAYER_COLUMNS, EXPECTED_PLAYERS),
        ("fact", FACT_COLUMNS, EXPECTED_FACTS),
        ("fact", FACT_COLUMNS, EXPECTED_SCORES),
        ("event", EVENT_COLUMNS, EXPECTED_KILLS),
        ("event", EVENT_COLUMNS, EXPECTED_OTHER_EVENTS),
        ("segment", SEGMENT_COLUMNS, EXPECTED_SEGMENTS),
    )
)


def _transfer():
    bind = op.get_bind()
    for table, columns, query in (
        ("ingest_job", JOB_COLUMNS, EXPECTED_JOBS),
        ("match", MATCH_COLUMNS, EXPECTED_MATCHES),
        ("stat_baseline", BASELINE_COLUMNS, EXPECTED_BASELINES),
    ):
        last = -1
        while True:
            ids = (
                bind.execute(
                    sa.text(f"SELECT id FROM ({query}) s WHERE id>:last ORDER BY id LIMIT :batch"),
                    {"last": last, "batch": BATCH_MATCHES},
                )
                .scalars()
                .all()
            )
            if not ids:
                break
            bind.execute(
                sa.text(
                    f"INSERT INTO stats.{table}({columns}) SELECT {columns} FROM ({query}) s WHERE id BETWEEN :lo AND :hi"
                ),
                {"lo": ids[0], "hi": ids[-1]},
            )
            last = ids[-1]
    last = -1
    while True:
        ids = (
            bind.execute(
                sa.text("SELECT match_id FROM stats01_match WHERE match_id>:last ORDER BY match_id LIMIT :batch"),
                {"last": last, "batch": BATCH_MATCHES},
            )
            .scalars()
            .all()
        )
        if not ids:
            break
        for statement in TRANSFER_BATCH:
            bind.execute(sa.text(statement), {"lo": ids[0], "hi": ids[-1]})
        last = ids[-1]
    for table in ("ingest_job", "match", "stat_baseline", "event"):
        bind.execute(
            sa.text(
                f"SELECT setval(pg_get_serial_sequence('stats.{table}','id'),coalesce(max(id),0)+1,false) FROM stats.{table}"
            )
        )


STAT_DEFS = (
    ("eliminations", "Eliminations", "integer", "sum", None),
    ("final_blows", "Final blows", "integer", "sum", None),
    ("deaths", "Deaths", "integer", "sum", None),
    ("all_damage_dealt", "All damage dealt", "decimal", "sum", None),
    ("barrier_damage_dealt", "Barrier damage dealt", "decimal", "sum", None),
    ("hero_damage_dealt", "Hero damage dealt", "decimal", "sum", None),
    ("healing_dealt", "Healing dealt", "decimal", "sum", None),
    ("healing_received", "Healing received", "decimal", "sum", None),
    ("self_healing", "Self healing", "decimal", "sum", None),
    ("damage_taken", "Damage taken", "decimal", "sum", None),
    ("damage_blocked", "Damage blocked", "decimal", "sum", None),
    ("defensive_assists", "Defensive assists", "integer", "sum", None),
    ("offensive_assists", "Offensive assists", "integer", "sum", None),
    ("ultimates_earned", "Ultimates earned", "integer", "sum", None),
    ("ultimates_used", "Ultimates used", "integer", "sum", None),
    ("multikill_best", "Best multikill", "integer", "max", None),
    ("multikills", "Multikills", "integer", "sum", None),
    ("solo_kills", "Solo kills", "integer", "sum", None),
    ("objective_kills", "Objective kills", "integer", "sum", None),
    ("environmental_kills", "Environmental kills", "integer", "sum", None),
    ("environmental_deaths", "Environmental deaths", "integer", "sum", None),
    ("critical_hits", "Critical hits", "integer", "sum", None),
    ("critical_hit_accuracy", "Critical hit accuracy", "percent", "avg", None),
    ("scoped_accuracy", "Scoped accuracy", "percent", "avg", None),
    ("scoped_critical_hit_accuracy", "Scoped critical hit accuracy", "percent", "avg", None),
    ("scoped_critical_hit_kills", "Scoped critical hit kills", "integer", "sum", None),
    ("shots_fired", "Shots fired", "integer", "sum", None),
    ("shots_hit", "Shots hit", "integer", "sum", None),
    ("shots_missed", "Shots missed", "integer", "sum", None),
    ("scoped_shots_fired", "Scoped shots fired", "integer", "sum", None),
    ("scoped_shots_hit", "Scoped shots hit", "integer", "sum", None),
    ("weapon_accuracy", "Weapon accuracy", "percent", "avg", None),
    ("hero_time_played", "Hero time played", "duration", "sum", None),
    ("first_picks", "First picks", "integer", "sum", None),
    ("first_deaths", "First deaths", "integer", "sum", None),
    ("ultimate_kills", "Ultimate kills", "integer", "sum", None),
    ("support_kills", "Support kills", "integer", "sum", None),
    ("performance", "Performance rank", "integer", "avg", None),
    ("performance_points", "Performance points", "decimal", "avg", None),
    ("kd", "Kills / deaths", "decimal", "avg", None),
    ("kda", "Kills and assists / deaths", "decimal", "avg", None),
    ("damage_delta", "Damage delta", "decimal", "sum", None),
    ("fbe", "Final blows / eliminations", "decimal", "avg", None),
    ("damage_fb", "Damage / final blow", "decimal", "avg", None),
    ("assists", "Assists", "integer", "sum", None),
    ("impact_points", "Impact points", "decimal", "avg", None),
    ("impact_rank", "Impact rank", "integer", "avg", None),
    ("overperformance_score", "Overperformance score", "decimal", "avg", None),
    ("score", "Score", "integer", "sum", "team"),
)
EVENT_TYPES = (
    ("kill", "Kill"),
    ("offensive_assist", "Offensive assist"),
    ("defensive_assist", "Defensive assist"),
    ("ultimate_charged", "Ultimate charged"),
    ("ultimate_start", "Ultimate start"),
    ("ultimate_end", "Ultimate end"),
    ("hero_swap", "Hero swap"),
    ("mercy_rez", "Mercy resurrection"),
    ("echo_duplicate_start", "Echo duplicate start"),
    ("echo_duplicate_end", "Echo duplicate end"),
)

# This is the P1 legacy defining SELECT, not the possibly stale resident MV.
LEGACY_MV_SELECT = """
WITH qualified AS (
 SELECT DISTINCT s.match_id,s.user_id,s.hero_id FROM matches.statistics s
 WHERE s.round=0 AND s.name='HeroTimePlayed' AND s.value>60
), eligible AS (
 SELECT st.match_id,st.user_id,st.hero_id,st.name,st.value FROM matches.statistics st
 JOIN qualified q ON q.match_id=st.match_id AND q.user_id=st.user_id AND q.hero_id=st.hero_id
 WHERE st.round=0 AND st.hero_id IS NOT NULL
), agg AS (
 SELECT e.hero_id,e.name,sum(e.value) sum_value,sum(m."time") sum_time FROM eligible e
 JOIN matches.match m ON m.id=e.match_id GROUP BY e.hero_id,e.name
), ranked AS (
 SELECT e.hero_id,e.name,e.match_id,e.user_id,e.value,
 row_number() OVER (PARTITION BY e.hero_id,e.name ORDER BY e.value *
 CASE WHEN e.name IN ('Deaths','DamageTaken','EnvironmentalDeaths','ShotsMissed','DamageFB','Performance')
 THEN -1.0 ELSE 1.0 END DESC,e.match_id DESC) rn FROM eligible e
), best AS (
 SELECT r.hero_id,r.name,r.value best_value,m.encounter_id,mp.name map_name,mp.image_path map_image_path,
 t.name tournament_name,u.name username FROM ranked r JOIN matches.match m ON m.id=r.match_id
 JOIN catalog.entity mp ON mp.id=m.map_id JOIN encounter.encounter enc ON enc.id=m.encounter_id
 JOIN tournament.tournament t ON t.id=enc.tournament_id JOIN players."user" u ON u.id=r.user_id WHERE r.rn=1
)
SELECT a.name,a.hero_id,b.best_value,(a.sum_value/nullif(a.sum_time,0))*600 AS avg,
 jsonb_build_object('encounter_id',b.encounter_id,'map_name',b.map_name,'map_image_path',b.map_image_path,
 'tournament_name',b.tournament_name,'username',b.username) AS metadata
FROM agg a JOIN best b ON b.hero_id=a.hero_id AND b.name=a.name
"""
EXPECTED_MV_SELECT = f"""SELECT d.discipline,d.id AS stat_id,l.hero_id AS entity_id,l.best_value,l.avg,l.metadata
 FROM ({LEGACY_MV_SELECT}) l JOIN stats01_stat_names n ON n.legacy_name=l.name::text
 JOIN stats.stat_def d ON d.discipline='overwatch' AND d.code=n.code"""
NATIVE_MV_SELECT = """
WITH qualified AS (
 SELECT DISTINCT f.match_id,f.workspace_member_id,f.entity_id FROM stats.fact f
 JOIN stats.match m ON m.id=f.match_id
 JOIN stats.stat_def d ON d.id=f.stat_id AND d.discipline=m.discipline AND d.code='hero_time_played'
 WHERE f.segment=0 AND f.value>60
), eligible AS (
 SELECT f.match_id,f.workspace_member_id,f.entity_id,f.stat_id,f.value,m.discipline,d.code
 FROM stats.fact f JOIN qualified q ON q.match_id=f.match_id AND q.workspace_member_id=f.workspace_member_id
 AND q.entity_id=f.entity_id JOIN stats.match m ON m.id=f.match_id
 JOIN stats.stat_def d ON d.id=f.stat_id AND d.discipline=m.discipline
 JOIN catalog.entity ce ON ce.id=f.entity_id AND ce.kind='character' AND ce.discipline=m.discipline
 WHERE f.segment=0 AND f.entity_id IS NOT NULL
), agg AS (
 SELECT e.discipline,e.entity_id,e.stat_id,
 sum(e.value ORDER BY e.match_id,e.workspace_member_id) sum_value,
 sum(m.duration_s ORDER BY e.match_id,e.workspace_member_id) sum_time
 FROM eligible e JOIN stats.match m ON m.id=e.match_id GROUP BY e.discipline,e.entity_id,e.stat_id
), ranked AS (
 SELECT e.*,row_number() OVER (PARTITION BY e.discipline,e.entity_id,e.stat_id ORDER BY e.value *
 CASE WHEN e.code IN ('deaths','damage_taken','environmental_deaths','shots_missed','damage_fb','performance')
 THEN -1.0 ELSE 1.0 END DESC,e.match_id DESC) rn FROM eligible e
), best AS (
 SELECT r.discipline,r.entity_id,r.stat_id,r.value best_value,g.encounter_id,mp.name map_name,
 mp.image_path map_image_path,t.name tournament_name,u.name username
 FROM ranked r JOIN stats.match m ON m.id=r.match_id
 JOIN catalog.entity mp ON mp.id=m.map_entity_id AND mp.kind='map' AND mp.discipline=m.discipline
 JOIN encounter.game g ON g.id=m.encounter_game_id
 JOIN encounter.encounter enc ON enc.id=g.encounter_id AND enc.workspace_id=m.workspace_id AND enc.discipline=m.discipline
 JOIN tournament.tournament t ON t.id=enc.tournament_id
 JOIN workspace_member wm ON wm.id=r.workspace_member_id AND wm.workspace_id=m.workspace_id
 JOIN players."user" u ON u.id=wm.player_id WHERE r.rn=1
)
SELECT a.discipline,a.stat_id,a.entity_id,b.best_value,(a.sum_value/nullif(a.sum_time,0))*600 AS avg,
 jsonb_build_object('encounter_id',b.encounter_id,'map_name',b.map_name,'map_image_path',b.map_image_path,
 'tournament_name',b.tournament_name,'username',b.username) AS metadata
FROM agg a JOIN best b ON b.discipline=a.discipline AND b.entity_id=a.entity_id AND b.stat_id=a.stat_id
"""

# Only cross-model computed averages tolerate the legacy unordered FLOAT8 sum.
# Stored values are never rounded; native derivation is independently bit-exact.
MV_AVG_ABS_TOLERANCE = 1e-12
RESIDENT_MV_SELECT = "SELECT discipline,stat_id,entity_id,best_value,avg,metadata FROM stats.mv_entity_global_stats"
MV_AVG_DIFFERENCES = f"""
SELECT count(*) FILTER (WHERE float8send(e.avg) IS DISTINCT FROM float8send(a.avg)) AS changed_rows,
 coalesce(max(abs(e.avg-a.avg)),0) AS max_abs_delta
FROM ({EXPECTED_MV_SELECT}) e JOIN ({RESIDENT_MV_SELECT}) a USING(discipline,stat_id,entity_id)
"""


def _mv_bits(query):
    return f"""SELECT discipline,stat_id,entity_id,float8send(best_value) AS best_value_bits,
      float8send(avg) AS avg_bits,metadata FROM ({query}) p"""


def _dependency_projection(expression):
    # Collapse only *different* legacy source tokens that converge on stats.event.
    # Duplicate unrelated values and duplicate identical source tokens are carried.
    return f"""(SELECT coalesce(jsonb_agg(mapped ORDER BY ord),'[]'::jsonb) FROM (
      SELECT a.value, a.ord,coalesce(to_jsonb(n.new_name),a.value) mapped,
       row_number() OVER(PARTITION BY coalesce(n.new_name,a.value#>>'{{}}'),a.value ORDER BY a.ord) occurrence,
       min(a.ord) OVER(PARTITION BY coalesce(n.new_name,a.value#>>'{{}}')) first_ord
      FROM jsonb_array_elements({expression}) WITH ORDINALITY a(value,ord)
      LEFT JOIN stats01_dependency_names n ON n.old_name=a.value#>>'{{}}'
    ) s WHERE mapped<>'\"stats.event\"'::jsonb OR occurrence>1 OR ord=first_ord)"""


def _fingerprints(table, columns, *, where="true"):
    return f"""SELECT jsonb_build_array(id) AS key,
      encode(sha256(convert_to(jsonb_build_array({columns})::text,'UTF8')),'hex') AS sha256
      FROM {table} WHERE {where}"""


CHANNEL_COLUMNS = "id,created_at,updated_at,tournament_id,channel_id,channel_name,is_active"
RULE_NATIVE_DEPENDENCIES = _dependency_projection("r.depends_on::jsonb")
OUTBOX_NATIVE_DEPENDENCIES = _dependency_projection("o.payload_json::jsonb->'changed_tables'")
INPLACE_CLASSES = (
    (
        "channel",
        _fingerprints("log_processing.discord_channel", CHANNEL_COLUMNS),
        _fingerprints("stats.discord_channel", CHANNEL_COLUMNS),
    ),
    (
        "alias_ref",
        _fingerprints("catalog.alias_miss", "id,last_ingest_job_id"),
        _fingerprints("catalog.alias_miss", "id,last_ingest_job_id"),
    ),
    (
        "evaluation_ref",
        _fingerprints("achievements.evaluation_result", "id,match_id"),
        _fingerprints("achievements.evaluation_result", "id,match_id"),
    ),
    (
        "override_ref",
        _fingerprints("achievements.override", "id,match_id"),
        _fingerprints("achievements.override", "id,match_id"),
    ),
    (
        "rule_dependency",
        _fingerprints("achievements.rule r", f"id,{RULE_NATIVE_DEPENDENCIES}"),
        _fingerprints("achievements.rule", "id,depends_on::jsonb"),
    ),
    (
        "outbox_dependency",
        _fingerprints("event_outbox o", f"id,{OUTBOX_NATIVE_DEPENDENCIES}", where=OUTBOX_SCOPE),
        _fingerprints("event_outbox o", "id,o.payload_json::jsonb->'changed_tables'", where=OUTBOX_SCOPE),
    ),
)


def _audit_oracle(payload):
    op.get_bind().execute(
        sa.text("""INSERT INTO audit_log(source,action,entity_type,after_json)
      VALUES('system','stats.initial_transfer','stats01',CAST(:payload AS jsonb))"""),
        {"payload": json.dumps({"stats01_oracle": payload}, separators=(",", ":"))},
    )


def _capture_initial_oracle():
    manifest = []
    for name, expected, _ in INPLACE_CLASSES:
        digest = hashlib.sha256()
        count = chunks = 0
        result = op.get_bind().execute(
            sa.text(f"SELECT key,key::text AS key_text,sha256 FROM ({expected}) s ORDER BY key"),
            execution_options={"stream_results": True},
        )
        while rows := result.fetchmany(BATCH_MATCHES):
            chunk_hash = hashlib.sha256("\n".join(f"{r.key_text}:{r.sha256}" for r in rows).encode()).hexdigest()
            if chunks:
                digest.update(b"\n")
            digest.update(chunk_hash.encode("ascii"))
            _audit_oracle(
                {
                    "version": 1,
                    "kind": "chunk",
                    "class": name,
                    "chunk": chunks,
                    "rows": [{"key": r.key, "sha256": r.sha256} for r in rows],
                    "sha256": chunk_hash,
                }
            )
            chunks += 1
            count += len(rows)
        result.close()
        manifest.append({"class": name, "count": count, "chunks": chunks, "sha256": digest.hexdigest()})
    _audit_oracle({"version": 1, "kind": "manifest", "classes": manifest})


def _one_fk(table, column, target):
    rows = (
        op.get_bind()
        .execute(
            sa.text("""SELECT c.conname FROM pg_constraint c
      WHERE c.contype='f' AND c.conrelid=to_regclass(:table) AND c.confrelid=to_regclass(:target)
       AND c.conkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=c.conrelid AND attname=:column)]
       AND c.confkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=c.confrelid AND attname='id')]"""),
            {"table": table, "column": column, "target": target},
        )
        .scalars()
        .all()
    )
    if len(rows) != 1:
        raise RuntimeError(f"stats01 expected exactly one FK {table}.{column} -> {target}: {rows}")
    return rows[0]


def _repoint_external_references():
    bind = op.get_bind()
    quote = bind.dialect.identifier_preparer.quote
    for table in ("achievements.evaluation_result", "achievements.override"):
        name = _one_fk(table, "match_id", "matches.match")
        bind.execute(sa.text(f"ALTER TABLE {table} DROP CONSTRAINT {quote(name)}"))
        bind.execute(
            sa.text(f"""ALTER TABLE {table} ADD CONSTRAINT {quote(name)}
          FOREIGN KEY(match_id) REFERENCES stats.match(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED""")
        )
    bind.execute(
        sa.text("""ALTER TABLE catalog.alias_miss ADD CONSTRAINT fk_alias_miss_ingest_job
      FOREIGN KEY(last_ingest_job_id) REFERENCES stats.ingest_job(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED""")
    )
    bind.execute(sa.text("CREATE INDEX ix_alias_miss_ingest_job ON catalog.alias_miss(last_ingest_job_id)"))
    indexes = (
        bind.execute(
            sa.text("""SELECT c.relname FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
      WHERE i.indrelid='log_processing.discord_channel'::regclass AND i.indisunique
      AND i.indnkeyatts=1 AND i.indnatts=1 AND i.indpred IS NULL AND i.indexprs IS NULL
      AND i.indkey[0]=(SELECT attnum FROM pg_attribute WHERE attrelid=i.indrelid AND attname='channel_id')""")
        )
        .scalars()
        .all()
    )
    if len(indexes) != 1:
        raise RuntimeError(f"stats01 expected exactly one channel-id unique index: {indexes}")
    bind.execute(sa.text("ALTER TABLE log_processing.discord_channel SET SCHEMA stats"))
    bind.execute(sa.text(f"ALTER INDEX stats.{quote(indexes[0])} RENAME TO ix_stats_discord_channel_channel_id"))
    bind.execute(sa.text(f"UPDATE achievements.rule r SET depends_on={RULE_NATIVE_DEPENDENCIES}"))
    bind.execute(
        sa.text(f"""UPDATE event_outbox o SET payload_json=jsonb_set(o.payload_json::jsonb,
      '{{changed_tables}}',{OUTBOX_NATIVE_DEPENDENCIES}) WHERE {OUTBOX_SCOPE}""")
    )


ORACLE_SETUP = (
    """CREATE TEMP VIEW stats01_oracle_records AS
       SELECT id,after_json->'stats01_oracle' AS p FROM audit_log WHERE action='stats.initial_transfer'""",
    """CREATE TEMP VIEW stats01_oracle_manifest AS
       SELECT v->>'class' AS class,(v->>'count')::bigint AS count,(v->>'chunks')::bigint AS chunks,v->>'sha256' AS sha256
       FROM stats01_oracle_records CROSS JOIN LATERAL jsonb_array_elements(p->'classes') v WHERE p->>'kind'='manifest'""",
    """CREATE TEMP VIEW stats01_oracle_chunks AS
       SELECT id,p->>'class' AS class,(p->>'chunk')::bigint AS chunk,p->'rows' AS rows,p->>'sha256' AS sha256
       FROM stats01_oracle_records WHERE p->>'kind'='chunk'""",
    """CREATE TEMP VIEW stats01_oracle_rows AS
       SELECT c.id,c.class,c.chunk,v.ordinality,v.value->'key' AS key,v.value->>'sha256' AS sha256
       FROM stats01_oracle_chunks c CROSS JOIN LATERAL jsonb_array_elements(c.rows) WITH ORDINALITY v(value,ordinality)""",
)
ORACLE_INTEGRITY = f"""
 WITH required(class) AS (VALUES {_values((name,) for name, _, _ in INPLACE_CLASSES)}),
 chunk_actual AS (
   SELECT c.id,c.class,c.chunk,count(r.id) AS count,
    encode(sha256(convert_to(coalesce(string_agg(r.key::text||':'||r.sha256,E'\\n' ORDER BY r.key),''),'UTF8')),'hex') AS sha256
   FROM stats01_oracle_chunks c LEFT JOIN stats01_oracle_rows r ON r.id=c.id GROUP BY c.id,c.class,c.chunk
 ), class_actual AS (
   SELECT class,count(*) AS chunks,sum(count) AS count,
    encode(sha256(convert_to(string_agg(sha256,E'\\n' ORDER BY chunk),'UTF8')),'hex') AS sha256
   FROM chunk_actual GROUP BY class
 )
 SELECT 'manifest_count'::text AS reason WHERE (SELECT count(*) FROM stats01_oracle_records WHERE p->>'kind'='manifest')<>1
 UNION ALL SELECT 'invalid_record' FROM stats01_oracle_records
  WHERE p IS NULL OR p->>'version' IS DISTINCT FROM '1' OR p->>'kind' IS NULL OR p->>'kind' NOT IN ('chunk','manifest')
    OR (p->>'kind'='manifest' AND jsonb_typeof(p->'classes') IS DISTINCT FROM 'array')
    OR (p->>'kind'='chunk' AND (jsonb_typeof(p->'rows') IS DISTINCT FROM 'array' OR
        p->>'sha256' IS NULL OR p->>'sha256' !~ '^[0-9a-f]{{64}}$'))
 UNION ALL SELECT 'missing_or_duplicate_class:'||r.class FROM required r
   LEFT JOIN stats01_oracle_manifest m ON m.class=r.class GROUP BY r.class HAVING count(m.class)<>1
 UNION ALL SELECT 'unexpected_manifest_class:'||coalesce(m.class,'NULL') FROM stats01_oracle_manifest m
   WHERE NOT EXISTS(SELECT 1 FROM required r WHERE r.class=m.class)
 UNION ALL SELECT 'unexpected_chunk_class:'||coalesce(c.class,'NULL') FROM stats01_oracle_chunks c
   WHERE NOT EXISTS(SELECT 1 FROM required r WHERE r.class=c.class)
 UNION ALL SELECT 'invalid_chunk:'||c.id FROM stats01_oracle_chunks c JOIN chunk_actual a ON a.id=c.id
   WHERE a.count NOT BETWEEN 1 AND 100 OR a.sha256 IS DISTINCT FROM c.sha256 OR c.chunk IS NULL OR c.chunk<0
 UNION ALL SELECT 'duplicate_chunk:'||class FROM stats01_oracle_chunks GROUP BY class,chunk HAVING count(*)<>1
 UNION ALL SELECT 'noncontiguous_chunks:'||class FROM stats01_oracle_chunks GROUP BY class
   HAVING min(chunk)<>0 OR max(chunk)<>count(*)-1
 UNION ALL SELECT 'invalid_row:'||id FROM stats01_oracle_rows
   WHERE jsonb_typeof(key) IS DISTINCT FROM 'array' OR jsonb_array_length(key)<>1
      OR jsonb_typeof(key->0) IS DISTINCT FROM 'number' OR sha256 IS NULL OR sha256 !~ '^[0-9a-f]{{64}}$'
 UNION ALL SELECT 'duplicate_owner:'||class FROM stats01_oracle_rows GROUP BY class,key HAVING count(*)<>1
 UNION ALL SELECT 'unordered_chunk:'||id FROM (
   SELECT id,key,lag(key) OVER(PARTITION BY id ORDER BY ordinality) previous FROM stats01_oracle_rows
 ) r WHERE previous>=key
 UNION ALL SELECT 'manifest_digest_or_count:'||m.class FROM stats01_oracle_manifest m
 LEFT JOIN class_actual a ON a.class=m.class
 WHERE m.count IS DISTINCT FROM coalesce(a.count,0) OR m.chunks IS DISTINCT FROM coalesce(a.chunks,0)
   OR m.sha256 IS DISTINCT FROM coalesce(a.sha256,encode(sha256(''::bytea),'hex'))
"""

EXTERNAL_CONSTRAINTS = """
SELECT c.conrelid::regclass::text AS relation,a.attname::text AS column_name,
 c.confrelid::regclass::text AS target,c.confdeltype::text AS delete_action,c.condeferrable,c.condeferred
FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND c.conkey=ARRAY[a.attnum]
WHERE c.contype='f' AND ((c.conrelid IN ('achievements.evaluation_result'::regclass,'achievements.override'::regclass)
 AND a.attname='match_id') OR (c.conrelid='catalog.alias_miss'::regclass AND a.attname='last_ingest_job_id'))
"""
EXPECTED_EXTERNAL_CONSTRAINTS = """SELECT * FROM (VALUES
 ('achievements.evaluation_result','match_id','stats.match','c',true,true),
 ('achievements.override','match_id','stats.match','c',true,true),
 ('catalog.alias_miss','last_ingest_job_id','stats.ingest_job','n',true,true)
) v(relation,column_name,target,delete_action,condeferrable,condeferred)"""

VOCABULARY_SETUP = (
    """CREATE TEMP VIEW stats01_stat_ids AS SELECT n.legacy_name,d.discipline,d.code,d.id
       FROM stats01_stat_names n JOIN stats.stat_def d ON d.discipline='overwatch' AND d.code=n.code""",
    """CREATE TEMP VIEW stats01_event_ids AS SELECT n.legacy_name,d.discipline,d.code,d.id
       FROM stats01_event_names n JOIN stats.event_type d ON d.discipline='overwatch' AND d.code=n.code""",
)
RECONCILE_SETUP = PREFLIGHT_SETUP + VOCABULARY_SETUP + ORACLE_SETUP
RECONCILE_CLASSES = (
    ("job_owners", "SELECT id FROM log_processing.record", "SELECT id FROM stats.ingest_job"),
    ("match_owners", "SELECT id FROM matches.match", "SELECT id FROM stats.match"),
    (
        "jobs",
        EXPECTED_JOBS,
        f"SELECT {JOB_COLUMNS} FROM stats.ingest_job WHERE id IN (SELECT id FROM log_processing.record)",
    ),
    (
        "matches",
        EXPECTED_MATCHES,
        f"SELECT {MATCH_COLUMNS} FROM stats.match WHERE id IN (SELECT id FROM matches.match)",
    ),
    (
        "teams",
        EXPECTED_TEAMS,
        f"SELECT {TEAM_COLUMNS} FROM stats.match_team WHERE match_id IN (SELECT id FROM matches.match)",
    ),
    (
        "players",
        EXPECTED_PLAYERS,
        f"SELECT {PLAYER_COLUMNS} FROM stats.match_player WHERE match_id IN (SELECT id FROM matches.match)",
    ),
    (
        "facts",
        EXPECTED_FACTS,
        f"SELECT {FACT_COLUMNS} FROM stats.fact WHERE match_id IN (SELECT id FROM matches.match) AND workspace_member_id IS NOT NULL",
    ),
    (
        "team_scores",
        EXPECTED_SCORES,
        f"SELECT {FACT_COLUMNS} FROM stats.fact WHERE match_id IN (SELECT id FROM matches.match) AND workspace_member_id IS NULL",
    ),
    (
        "events",
        EXPECTED_EVENTS,
        f"SELECT {EVENT_COLUMNS} FROM stats.event WHERE match_id IN (SELECT id FROM matches.match)",
    ),
    (
        "segments",
        EXPECTED_SEGMENTS,
        f"SELECT {SEGMENT_COLUMNS} FROM stats.segment WHERE match_id IN (SELECT id FROM matches.match)",
    ),
    ("baselines", EXPECTED_BASELINES, f"SELECT {BASELINE_COLUMNS} FROM stats.stat_baseline"),
    (
        "stat_def",
        f"""SELECT 'overwatch'::varchar AS discipline,v.code,v.name,v.value_format,v.aggregation,v.stat_group::varchar,
       true AS active,v.sort_order FROM (VALUES {_values((*row, i) for i, row in enumerate(STAT_DEFS))})
       v(code,name,value_format,aggregation,stat_group,sort_order)""",
        "SELECT discipline,code,name,value_format,aggregation,stat_group,active,sort_order FROM stats.stat_def WHERE discipline='overwatch'",
    ),
    (
        "event_type",
        f"""SELECT 'overwatch'::varchar AS discipline,code,name,true AS active
       FROM (VALUES {_values(EVENT_TYPES)}) v(code,name)""",
        "SELECT discipline,code,name,active FROM stats.event_type WHERE discipline='overwatch'",
    ),
    ("mv", EXPECTED_MV_SELECT, RESIDENT_MV_SELECT),
    ("mv_derivation", _mv_bits(NATIVE_MV_SELECT), _mv_bits(RESIDENT_MV_SELECT)),
    ("external_constraints", EXPECTED_EXTERNAL_CONSTRAINTS, EXTERNAL_CONSTRAINTS),
    ("oracle_integrity", "SELECT NULL::text AS reason WHERE false", ORACLE_INTEGRITY),
) + tuple(
    (name, f"SELECT key,sha256 FROM stats01_oracle_rows WHERE class={_literal(name)}", actual)
    for name, _, actual in INPLACE_CLASSES
)
# Separate source cardinalities prevent an unmappable source row disappearing at
# an INNER JOIN from turning into an apparently successful multiset comparison.
SOURCE_CARDINALITIES = (
    ("jobs", "SELECT count(*) FROM log_processing.record", EXPECTED_JOBS),
    ("matches", "SELECT count(*) FROM matches.match", EXPECTED_MATCHES),
    ("teams", "SELECT 2*count(*) FROM matches.match", EXPECTED_TEAMS),
    (
        "players",
        "SELECT count(*) FROM (SELECT DISTINCT match_id,user_id,team_id FROM stats01_endpoints WHERE user_id IS NOT NULL) p",
        EXPECTED_PLAYERS,
    ),
    ("facts", "SELECT count(*) FROM matches.statistics", EXPECTED_FACTS),
    ("events", "SELECT (SELECT count(*) FROM matches.kill_feed)+(SELECT count(*) FROM matches.event)", EXPECTED_EVENTS),
    ("baselines", "SELECT count(*) FROM matches.stat_baselines", EXPECTED_BASELINES),
)
RECONCILE_CLASSES += (
    (
        "source_cardinality",
        " UNION ALL ".join(
            f"SELECT {_literal(name)}::text AS relation,({count}) AS count" for name, count, _ in SOURCE_CARDINALITIES
        ),
        " UNION ALL ".join(
            f"SELECT {_literal(name)}::text AS relation,count(*) AS count FROM ({query}) p"
            for name, _, query in SOURCE_CARDINALITIES
        ),
    ),
)
RECONCILE_OWNERS = {
    "job_owners": ("job", "jsonb_build_array(p.id)"),
    "match_owners": ("match", "jsonb_build_array(p.id)"),
    "jobs": ("job", "jsonb_build_array(p.id)"),
    "matches": ("match", "jsonb_build_array(p.id)"),
    **dict.fromkeys(
        ("teams", "players", "facts", "team_scores", "events", "segments"), ("match", "jsonb_build_array(p.match_id)")
    ),
    "baselines": ("baseline", "jsonb_build_array('overwatch',p.formula_version)"),
    "stat_def": ("vocabulary", "jsonb_build_array(p.discipline,'stat',p.code)"),
    "event_type": ("vocabulary", "jsonb_build_array(p.discipline,'event',p.code)"),
    "mv": ("mv", "jsonb_build_array(p.discipline,p.stat_id,p.entity_id)"),
    **{
        name: (kind, "p.key")
        for name, kind in (
            ("channel", "channel"),
            ("alias_ref", "alias"),
            ("evaluation_ref", "evaluation"),
            ("override_ref", "override"),
            ("rule_dependency", "rule"),
            ("outbox_dependency", "outbox"),
        )
    },
}


def _reconcile_class(name, expected, actual):
    if name == "mv":
        return f"""SELECT 'mv'::text AS class,d.direction,d.row FROM (
          WITH e AS MATERIALIZED ({expected}),a AS MATERIALIZED ({actual})
          SELECT CASE WHEN e.stat_id IS NOT NULL THEN to_jsonb(e) END AS expected_row,
            CASE WHEN a.stat_id IS NOT NULL THEN to_jsonb(a) END AS actual_row
          FROM e FULL JOIN a USING(discipline,stat_id,entity_id)
          WHERE e.stat_id IS NULL OR a.stat_id IS NULL
            OR float8send(e.best_value) IS DISTINCT FROM float8send(a.best_value)
            OR e.metadata IS DISTINCT FROM a.metadata
            OR (e.avg IS NULL) <> (a.avg IS NULL)
            OR (e.avg IS NOT NULL AND a.avg IS NOT NULL
                AND NOT abs(e.avg-a.avg) <= {MV_AVG_ABS_TOLERANCE})
        ) p CROSS JOIN LATERAL (VALUES
          ('missing_or_changed'::text,p.expected_row),
          ('unexpected_or_changed'::text,p.actual_row)
        ) d(direction,row) WHERE d.row IS NOT NULL"""
    return f"""SELECT {_literal(name)}::text AS class,'missing_or_changed'::text AS direction,to_jsonb(p) AS row
      FROM (({expected}) EXCEPT ALL ({actual})) p
      UNION ALL SELECT {_literal(name)}::text,'unexpected_or_changed'::text,to_jsonb(p)
      FROM (({actual}) EXCEPT ALL ({expected})) p"""


RECONCILE_VIEW = "CREATE TEMP VIEW stats01_reconcile AS " + " UNION ALL ".join(
    _reconcile_class(name, expected, actual) for name, expected, actual in RECONCILE_CLASSES
)
RECONCILE_SUMMARY = " UNION ALL ".join(
    f"""SELECT {_literal(name)}::text AS class,(SELECT count(*) FROM ({expected}) p) AS legacy,
      (SELECT count(*) FROM ({actual}) p) AS migrated,
      CASE WHEN EXISTS(SELECT 1 FROM stats01_reconcile WHERE class={_literal(name)}) THEN 'blocking' ELSE 'ok' END AS status"""
    for name, expected, actual in RECONCILE_CLASSES
)


def _assert_reconciled():
    bind = op.get_bind()
    bind.execute(sa.text(RECONCILE_VIEW))
    count = bind.scalar(sa.text("SELECT count(*) FROM stats01_reconcile"))
    if count:
        sample = bind.execute(
            sa.text(
                f"SELECT class,direction,row FROM stats01_reconcile ORDER BY class,direction LIMIT {PREFLIGHT_SAMPLE}"
            )
        ).all()
        raise RuntimeError(f"stats01 reconcile refused: count={count}, sample={sample!r}")


def upgrade():
    bind = op.get_bind()
    bind.execute(sa.text("SET CONSTRAINTS ALL IMMEDIATE"))
    # Maintenance owns the writer drain; locks also prevent new legacy writes
    # racing preflight/copy, and bound lock waits rather than queuing indefinitely.
    bind.execute(sa.text("SET LOCAL lock_timeout = '5s'"))
    bind.execute(
        sa.text("""LOCK TABLE matches.match,matches.statistics,matches.kill_feed,matches.event,
      matches.stat_baselines,log_processing.record,log_processing.discord_channel,
      achievements.rule,achievements.evaluation_result,achievements.override,event_outbox,catalog.alias_miss,
      encounter.encounter,encounter.game,encounter.team,encounter.game_team,tournament.tournament,tournament.player,
      workspace_member,players."user",players.social_account,catalog.entity,catalog.role,catalog.role_dimension
      IN SHARE ROW EXCLUSIVE MODE""")
    )
    for statement in PREFLIGHT_SETUP:
        bind.execute(sa.text(statement))
    _preflight()
    _capture_initial_oracle()
    for statement in DDL:
        bind.execute(sa.text(statement))
    bind.execute(
        sa.text(f"""INSERT INTO stats.stat_def(discipline,code,name,value_format,aggregation,stat_group,sort_order)
      SELECT 'overwatch',v.* FROM (VALUES {_values((*row, i) for i, row in enumerate(STAT_DEFS))})
      v(code,name,value_format,aggregation,stat_group,sort_order)""")
    )
    bind.execute(
        sa.text(f"""INSERT INTO stats.event_type(discipline,code,name)
      SELECT 'overwatch',v.* FROM (VALUES {_values(EVENT_TYPES)}) v(code,name)""")
    )
    for statement in VOCABULARY_SETUP:
        bind.execute(sa.text(statement))
    # Standalone proof keeps snapshot-evaluated views. Only the migration
    # materializes and indexes the small owner/vocabulary lookup maps.
    for name, index_columns in (
        ("match", "match_id"),
        ("team", "match_id,team_id"),
        ("stat_ids", "discipline,legacy_name"),
        ("event_ids", "discipline,legacy_name"),
    ):
        bind.execute(sa.text(f"CREATE TEMP TABLE stats01_{name}_indexed AS SELECT * FROM stats01_{name}"))
        bind.execute(sa.text(f"CREATE INDEX ON stats01_{name}_indexed({index_columns})"))
        bind.execute(sa.text(f"CREATE OR REPLACE TEMP VIEW stats01_{name} AS SELECT * FROM stats01_{name}_indexed"))
        bind.execute(sa.text(f"ANALYZE stats01_{name}_indexed"))
    _transfer()
    for statement in BULK_CONSTRAINTS + INDEXES:
        bind.execute(sa.text(statement))
    _repoint_external_references()
    bind.execute(sa.text(f"CREATE MATERIALIZED VIEW stats.mv_entity_global_stats AS {NATIVE_MV_SELECT} WITH NO DATA"))
    bind.execute(
        sa.text(
            "CREATE UNIQUE INDEX uq_mv_entity_global_stats ON stats.mv_entity_global_stats(discipline,stat_id,entity_id)"
        )
    )
    bind.execute(sa.text("REFRESH MATERIALIZED VIEW stats.mv_entity_global_stats"))
    bind.execute(sa.text("SET CONSTRAINTS ALL IMMEDIATE"))
    for statement in ORACLE_SETUP:
        bind.execute(sa.text(statement))
    _assert_reconciled()
    invalid = bind.execute(
        sa.text("""SELECT conrelid::regclass::text,conname FROM pg_constraint
      WHERE condeferrable AND NOT condeferred ORDER BY conrelid,conname LIMIT 20""")
    ).all()
    if invalid:
        raise RuntimeError(f"stats01 refuses initially-immediate deferrable constraints: {invalid!r}")
    bind.execute(sa.text("SET CONSTRAINTS ALL DEFERRED"))


def downgrade():
    raise RuntimeError("stats01 is forward-fix-only; restore the pre-cutover backup to reverse the transfer")
