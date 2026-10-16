-- Frozen stats01 preflight. Fresh connection; only session-local views are written.
-- Counts include all violations; detail display is bounded per class.
-- Handles use the observation's member/team/tournament roster, then primary Battle.net identity.
BEGIN;
SET LOCAL timezone = 'UTC';

SET LOCAL extra_float_digits = 3;

CREATE TEMP VIEW stats01_stat_names(legacy_name,code) AS VALUES ('Eliminations','eliminations'),
('FinalBlows','final_blows'),
('Deaths','deaths'),
('AllDamageDealt','all_damage_dealt'),
('BarrierDamageDealt','barrier_damage_dealt'),
('HeroDamageDealt','hero_damage_dealt'),
('HealingDealt','healing_dealt'),
('HealingReceived','healing_received'),
('SelfHealing','self_healing'),
('DamageTaken','damage_taken'),
('DamageBlocked','damage_blocked'),
('DefensiveAssists','defensive_assists'),
('OffensiveAssists','offensive_assists'),
('UltimatesEarned','ultimates_earned'),
('UltimatesUsed','ultimates_used'),
('MultikillBest','multikill_best'),
('Multikills','multikills'),
('SoloKills','solo_kills'),
('ObjectiveKills','objective_kills'),
('EnvironmentalKills','environmental_kills'),
('EnvironmentalDeaths','environmental_deaths'),
('CriticalHits','critical_hits'),
('CriticalHitAccuracy','critical_hit_accuracy'),
('ScopedAccuracy','scoped_accuracy'),
('ScopedCriticalHitAccuracy','scoped_critical_hit_accuracy'),
('ScopedCriticalHitKills','scoped_critical_hit_kills'),
('ShotsFired','shots_fired'),
('ShotsHit','shots_hit'),
('ShotsMissed','shots_missed'),
('ScopedShotsFired','scoped_shots_fired'),
('ScopedShotsHit','scoped_shots_hit'),
('WeaponAccuracy','weapon_accuracy'),
('HeroTimePlayed','hero_time_played'),
('FirstPicks','first_picks'),
('FirstDeaths','first_deaths'),
('UltimateKills','ultimate_kills'),
('SupportKills','support_kills'),
('Performance','performance'),
('PerformancePoints','performance_points'),
('KD','kd'),
('KDA','kda'),
('DamageDelta','damage_delta'),
('FBE','fbe'),
('DamageFB','damage_fb'),
('Assists','assists'),
('ImpactPoints','impact_points'),
('ImpactRank','impact_rank'),
('OverperformanceScore','overperformance_score');

CREATE TEMP VIEW stats01_event_names(legacy_name,code) AS VALUES ('OffensiveAssist','offensive_assist'),
('DefensiveAssist','defensive_assist'),
('UltimateCharged','ultimate_charged'),
('UltimateStart','ultimate_start'),
('UltimateEnd','ultimate_end'),
('HeroSwap','hero_swap'),
('MercyRez','mercy_rez'),
('EchoDuplicateStart','echo_duplicate_start'),
('EchoDuplicateEnd','echo_duplicate_end');

CREATE TEMP VIEW stats01_ability_values(legacy_name,value) AS VALUES ('PrimaryFire','Primary Fire'),
('SecondaryFire','Secondary Fire'),
('Ability1','Ability 1'),
('Ability2','Ability 2'),
('Ultimate','Ultimate'),
('Melee','Melee'),
('Crouch','Crouch');

CREATE TEMP VIEW stats01_dependency_names(old_name,new_name) AS VALUES ('matches.statistics','stats.fact'),
('matches.match','stats.match'),
('matches.kill_feed','stats.event'),
('matches.event','stats.event'),
('matches.stat_baselines','stats.stat_baseline'),
('log_processing.record','stats.ingest_job');

CREATE TEMP VIEW stats01_match AS
SELECT m.id AS match_id,
 coalesce((SELECT g.id FROM encounter.game g WHERE g.encounter_id=m.encounter_id
            AND g.position=m.map_index AND g.state<>'cancelled'),
          (SELECT min(g.id) FROM encounter.game g WHERE g.encounter_id=m.encounter_id
            AND g.map_id=m.map_id AND g.state<>'cancelled' HAVING count(*)=1)) AS game_id,
 e.workspace_id, e.discipline, e.tournament_id, e.id AS encounter_id
FROM matches.match m JOIN encounter.encounter e ON e.id=m.encounter_id
;

CREATE TEMP VIEW stats01_endpoints AS
SELECT match_id,user_id,team_id FROM matches.statistics
UNION ALL SELECT match_id,killer_id,killer_team_id FROM matches.kill_feed
UNION ALL SELECT match_id,victim_id,victim_team_id FROM matches.kill_feed
UNION ALL SELECT match_id,user_id,team_id FROM matches.event
UNION ALL SELECT match_id,related_user_id,related_team_id FROM matches.event
;

CREATE TEMP VIEW stats01_source_teams AS
SELECT match_id,team_id FROM stats01_endpoints WHERE team_id IS NOT NULL
UNION ALL SELECT id,home_team_id FROM matches.match
UNION ALL SELECT id,away_team_id FROM matches.match
;

CREATE TEMP VIEW stats01_team AS
       SELECT x.match_id,x.game_id,et.team_id,gt.encounter_team_id
       FROM stats01_match x JOIN encounter.game_team gt ON gt.game_id=x.game_id
       JOIN encounter.team et ON et.id=gt.encounter_team_id AND et.encounter_id=x.encounter_id;

CREATE TEMP VIEW stats01_member AS SELECT workspace_id,player_id,id FROM workspace_member;

CREATE TEMP VIEW stats01_handles AS
       SELECT p.match_id,p.user_id AS player_id,p.team_id,coalesce(
 (SELECT CASE WHEN btrim(r.name)<>'' THEN r.name END FROM tournament.player r
  WHERE r.workspace_member_id=w.id AND r.team_id=p.team_id AND r.tournament_id=x.tournament_id
  ORDER BY r.is_substitution,r.id LIMIT 1),
 (SELECT a.username FROM players.social_account a
  WHERE a.user_id=p.user_id AND a.provider='battlenet' AND a.is_primary
  ORDER BY a.id LIMIT 1)) AS handle_snapshot
       FROM (SELECT DISTINCT match_id,user_id,team_id FROM stats01_endpoints WHERE user_id IS NOT NULL) p
       JOIN stats01_match x ON x.match_id=p.match_id
       LEFT JOIN stats01_member w ON w.workspace_id=x.workspace_id AND w.player_id=p.user_id;

CREATE TEMP VIEW stats01_roles AS
       SELECT r.id, r.code FROM catalog.role r JOIN catalog.role_dimension d ON d.id=r.dimension_id
       WHERE d.discipline='overwatch' AND d.code='player_role' AND d.rated
         AND r.workspace_id IS NULL AND r.parent_role_id IS NULL AND r.code IN ('tank','damage','support');

CREATE TEMP VIEW stats01_preflight AS SELECT '1_game_binding'::text AS class,id,reason FROM (
      SELECT m.id,'no_unique_live_game' reason FROM matches.match m LEFT JOIN stats01_match x ON x.match_id=m.id WHERE x.game_id IS NULL
      UNION ALL SELECT match_id,'duplicate_game_claim' FROM stats01_match WHERE game_id IN
        (SELECT game_id FROM stats01_match GROUP BY game_id HAVING count(*)>1)
      UNION ALL SELECT m.id,'explicit_position_map_mismatch' FROM matches.match m JOIN encounter.game g
        ON g.encounter_id=m.encounter_id AND g.position=m.map_index AND g.state<>'cancelled' WHERE g.map_id IS DISTINCT FROM m.map_id
    ) p UNION ALL SELECT '2_missing_member'::text AS class,id,reason FROM (
      SELECT DISTINCT p.user_id id,'missing_workspace_member' reason FROM stats01_endpoints p
      JOIN stats01_match x ON x.match_id=p.match_id
      WHERE p.user_id IS NOT NULL AND NOT EXISTS
        (SELECT 1 FROM workspace_member w WHERE w.workspace_id=x.workspace_id AND w.player_id=p.user_id)
      UNION ALL SELECT id,'statistics_without_player' FROM matches.statistics WHERE user_id IS NULL
    ) p UNION ALL SELECT '3_team_binding'::text AS class,id,reason FROM (
      SELECT DISTINCT s.match_id id,'missing_or_ambiguous_participation' reason FROM stats01_source_teams s
      WHERE (SELECT count(*) FROM stats01_team t WHERE t.match_id=s.match_id AND t.team_id=s.team_id)<>1
      UNION ALL SELECT id,'same_team_both_sides' FROM matches.match WHERE home_team_id=away_team_id
      UNION ALL SELECT DISTINCT match_id,'player_without_team' FROM stats01_endpoints WHERE user_id IS NOT NULL AND team_id IS NULL
      UNION ALL SELECT DISTINCT s.match_id,'team_not_observed_side' FROM stats01_source_teams s JOIN matches.match m ON m.id=s.match_id
        WHERE s.team_id NOT IN (m.home_team_id,m.away_team_id)
    ) p UNION ALL SELECT '4_duplicate_facts'::text AS class,id,reason FROM (
      SELECT min(id) id,'duplicate_null_equal_fact' reason FROM matches.statistics
      GROUP BY match_id,round,team_id,user_id,hero_id,name HAVING count(*)>1
    ) p UNION ALL SELECT '5_player_teams'::text AS class,id,reason FROM (
      SELECT match_id id,'player_multiple_teams' reason FROM stats01_endpoints
      WHERE user_id IS NOT NULL GROUP BY match_id,user_id HAVING count(DISTINCT team_id)>1
    ) p UNION ALL SELECT '6_ownership'::text AS class,id,reason FROM (
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
    ) p UNION ALL SELECT '7_baselines'::text AS class,id,reason FROM (
      SELECT b.id,'unresolved_baseline' reason FROM matches.stat_baselines b
       WHERE (SELECT count(*) FROM stats01_roles r WHERE r.code=lower(b.role::text))<>1
          OR (SELECT count(*) FROM stats01_stat_names n WHERE n.legacy_name=b.stat::text)<>1
          OR b.mean::text IN ('NaN','Infinity','-Infinity') OR b.std::text IN ('NaN','Infinity','-Infinity')
    ) p UNION ALL SELECT '8_raw_provenance'::text AS class,id,reason FROM (
      SELECT r.id,'invalid_real_hash' reason FROM log_processing.record r
        WHERE r.content_hash IS NULL OR r.content_hash !~ '^[0-9a-fA-F]{64}$'
      UNION ALL SELECT r.id,'unsafe_raw_key' FROM log_processing.record r
        WHERE (CASE WHEN starts_with((CASE WHEN starts_with(r.filename,('logs/'||r.tournament_id::text||'/')) THEN substr(r.filename,length(('logs/'||r.tournament_id::text||'/'))+1) ELSE r.filename END),'logs/') THEN substr((CASE WHEN starts_with(r.filename,('logs/'||r.tournament_id::text||'/')) THEN substr(r.filename,length(('logs/'||r.tournament_id::text||'/'))+1) ELSE r.filename END),6) ELSE (CASE WHEN starts_with(r.filename,('logs/'||r.tournament_id::text||'/')) THEN substr(r.filename,length(('logs/'||r.tournament_id::text||'/'))+1) ELSE r.filename END) END) IS NULL OR (CASE WHEN starts_with((CASE WHEN starts_with(r.filename,('logs/'||r.tournament_id::text||'/')) THEN substr(r.filename,length(('logs/'||r.tournament_id::text||'/'))+1) ELSE r.filename END),'logs/') THEN substr((CASE WHEN starts_with(r.filename,('logs/'||r.tournament_id::text||'/')) THEN substr(r.filename,length(('logs/'||r.tournament_id::text||'/'))+1) ELSE r.filename END),6) ELSE (CASE WHEN starts_with(r.filename,('logs/'||r.tournament_id::text||'/')) THEN substr(r.filename,length(('logs/'||r.tournament_id::text||'/'))+1) ELSE r.filename END) END)='' OR starts_with((CASE WHEN starts_with((CASE WHEN starts_with(r.filename,('logs/'||r.tournament_id::text||'/')) THEN substr(r.filename,length(('logs/'||r.tournament_id::text||'/'))+1) ELSE r.filename END),'logs/') THEN substr((CASE WHEN starts_with(r.filename,('logs/'||r.tournament_id::text||'/')) THEN substr(r.filename,length(('logs/'||r.tournament_id::text||'/'))+1) ELSE r.filename END),6) ELSE (CASE WHEN starts_with(r.filename,('logs/'||r.tournament_id::text||'/')) THEN substr(r.filename,length(('logs/'||r.tournament_id::text||'/'))+1) ELSE r.filename END) END),'/')
           OR strpos((CASE WHEN starts_with((CASE WHEN starts_with(r.filename,('logs/'||r.tournament_id::text||'/')) THEN substr(r.filename,length(('logs/'||r.tournament_id::text||'/'))+1) ELSE r.filename END),'logs/') THEN substr((CASE WHEN starts_with(r.filename,('logs/'||r.tournament_id::text||'/')) THEN substr(r.filename,length(('logs/'||r.tournament_id::text||'/'))+1) ELSE r.filename END),6) ELSE (CASE WHEN starts_with(r.filename,('logs/'||r.tournament_id::text||'/')) THEN substr(r.filename,length(('logs/'||r.tournament_id::text||'/'))+1) ELSE r.filename END) END),'..')>0 OR length(('logs/'||r.tournament_id::text||'/')||(CASE WHEN starts_with((CASE WHEN starts_with(r.filename,('logs/'||r.tournament_id::text||'/')) THEN substr(r.filename,length(('logs/'||r.tournament_id::text||'/'))+1) ELSE r.filename END),'logs/') THEN substr((CASE WHEN starts_with(r.filename,('logs/'||r.tournament_id::text||'/')) THEN substr(r.filename,length(('logs/'||r.tournament_id::text||'/'))+1) ELSE r.filename END),6) ELSE (CASE WHEN starts_with(r.filename,('logs/'||r.tournament_id::text||'/')) THEN substr(r.filename,length(('logs/'||r.tournament_id::text||'/'))+1) ELSE r.filename END) END))>512
      UNION ALL SELECT m.id,'raw_match_without_record_or_key_conflict' FROM matches.match m
        JOIN stats01_match x ON x.match_id=m.id LEFT JOIN log_processing.record r ON r.id=m.log_record_id
        WHERE m.log_name IS NOT NULL AND (r.id IS NULL OR (CASE WHEN starts_with((CASE WHEN starts_with(m.log_name,('logs/'||x.tournament_id::text||'/')) THEN substr(m.log_name,length(('logs/'||x.tournament_id::text||'/'))+1) ELSE m.log_name END),'logs/') THEN substr((CASE WHEN starts_with(m.log_name,('logs/'||x.tournament_id::text||'/')) THEN substr(m.log_name,length(('logs/'||x.tournament_id::text||'/'))+1) ELSE m.log_name END),6) ELSE (CASE WHEN starts_with(m.log_name,('logs/'||x.tournament_id::text||'/')) THEN substr(m.log_name,length(('logs/'||x.tournament_id::text||'/'))+1) ELSE m.log_name END) END)='' OR starts_with((CASE WHEN starts_with((CASE WHEN starts_with(m.log_name,('logs/'||x.tournament_id::text||'/')) THEN substr(m.log_name,length(('logs/'||x.tournament_id::text||'/'))+1) ELSE m.log_name END),'logs/') THEN substr((CASE WHEN starts_with(m.log_name,('logs/'||x.tournament_id::text||'/')) THEN substr(m.log_name,length(('logs/'||x.tournament_id::text||'/'))+1) ELSE m.log_name END),6) ELSE (CASE WHEN starts_with(m.log_name,('logs/'||x.tournament_id::text||'/')) THEN substr(m.log_name,length(('logs/'||x.tournament_id::text||'/'))+1) ELSE m.log_name END) END),'/')
          OR strpos((CASE WHEN starts_with((CASE WHEN starts_with(m.log_name,('logs/'||x.tournament_id::text||'/')) THEN substr(m.log_name,length(('logs/'||x.tournament_id::text||'/'))+1) ELSE m.log_name END),'logs/') THEN substr((CASE WHEN starts_with(m.log_name,('logs/'||x.tournament_id::text||'/')) THEN substr(m.log_name,length(('logs/'||x.tournament_id::text||'/'))+1) ELSE m.log_name END),6) ELSE (CASE WHEN starts_with(m.log_name,('logs/'||x.tournament_id::text||'/')) THEN substr(m.log_name,length(('logs/'||x.tournament_id::text||'/'))+1) ELSE m.log_name END) END),'..')>0 OR length(('logs/'||x.tournament_id::text||'/')||(CASE WHEN starts_with((CASE WHEN starts_with(m.log_name,('logs/'||x.tournament_id::text||'/')) THEN substr(m.log_name,length(('logs/'||x.tournament_id::text||'/'))+1) ELSE m.log_name END),'logs/') THEN substr((CASE WHEN starts_with(m.log_name,('logs/'||x.tournament_id::text||'/')) THEN substr(m.log_name,length(('logs/'||x.tournament_id::text||'/'))+1) ELSE m.log_name END),6) ELSE (CASE WHEN starts_with(m.log_name,('logs/'||x.tournament_id::text||'/')) THEN substr(m.log_name,length(('logs/'||x.tournament_id::text||'/'))+1) ELSE m.log_name END) END))>512 OR (('logs/'||x.tournament_id::text||'/')||(CASE WHEN starts_with((CASE WHEN starts_with(m.log_name,('logs/'||x.tournament_id::text||'/')) THEN substr(m.log_name,length(('logs/'||x.tournament_id::text||'/'))+1) ELSE m.log_name END),'logs/') THEN substr((CASE WHEN starts_with(m.log_name,('logs/'||x.tournament_id::text||'/')) THEN substr(m.log_name,length(('logs/'||x.tournament_id::text||'/'))+1) ELSE m.log_name END),6) ELSE (CASE WHEN starts_with(m.log_name,('logs/'||x.tournament_id::text||'/')) THEN substr(m.log_name,length(('logs/'||x.tournament_id::text||'/'))+1) ELSE m.log_name END) END)) IS DISTINCT FROM (('logs/'||r.tournament_id::text||'/')||(CASE WHEN starts_with((CASE WHEN starts_with(r.filename,('logs/'||r.tournament_id::text||'/')) THEN substr(r.filename,length(('logs/'||r.tournament_id::text||'/'))+1) ELSE r.filename END),'logs/') THEN substr((CASE WHEN starts_with(r.filename,('logs/'||r.tournament_id::text||'/')) THEN substr(r.filename,length(('logs/'||r.tournament_id::text||'/'))+1) ELSE r.filename END),6) ELSE (CASE WHEN starts_with(r.filename,('logs/'||r.tournament_id::text||'/')) THEN substr(r.filename,length(('logs/'||r.tournament_id::text||'/'))+1) ELSE r.filename END) END)))
    ) p UNION ALL SELECT '9_representability'::text AS class,id,reason FROM (
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
    ) p UNION ALL SELECT '10_dependencies'::text AS class,id,reason FROM (
 SELECT a.id,'orphan_alias_breadcrumb' reason FROM catalog.alias_miss a
 LEFT JOIN log_processing.record r ON r.id=a.last_ingest_job_id
 LEFT JOIN tournament.tournament t ON t.id=r.tournament_id
 WHERE a.last_ingest_job_id IS NOT NULL AND (r.id IS NULL OR t.discipline IS DISTINCT FROM a.discipline)
 UNION ALL SELECT oid::bigint,'unknown_inbound_fk' FROM (
SELECT c.oid,c.conrelid::regclass::text AS source,c.confrelid::regclass::text AS target,c.conname,
 ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY k(n,ord)
       JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.n ORDER BY k.ord) AS columns,
 ARRAY(SELECT a.attname::text FROM unnest(c.confkey) WITH ORDINALITY k(n,ord)
       JOIN pg_attribute a ON a.attrelid=c.confrelid AND a.attnum=k.n ORDER BY k.ord) AS target_columns
FROM pg_constraint c JOIN pg_class t ON t.oid=c.confrelid JOIN pg_namespace n ON n.oid=t.relnamespace
WHERE c.contype='f' AND n.nspname IN ('matches','log_processing')
) f
 WHERE NOT EXISTS(SELECT 1 FROM (VALUES ('matches.statistics','matches.match','match_id'),
('matches.kill_feed','matches.match','match_id'),
('matches.event','matches.match','match_id'),
('matches.match','log_processing.record','log_record_id'),
('overwatch.catalog_alias_miss','log_processing.record','last_log_record_id'),
('achievements.evaluation_result','matches.match','match_id'),
('achievements.override','matches.match','match_id')) a(source,target,col)
   WHERE a.source=f.source AND a.target=f.target AND f.columns=ARRAY[a.col] AND f.target_columns=ARRAY['id']::text[])
 UNION ALL SELECT r.ev_class::bigint,'unknown_dependent_view' FROM pg_depend d
 JOIN pg_rewrite r ON r.oid=d.objid JOIN pg_class src ON src.oid=d.refobjid
 JOIN pg_namespace ns ON ns.oid=src.relnamespace
 JOIN pg_class v ON v.oid=r.ev_class
 WHERE d.classid='pg_rewrite'::regclass AND d.refclassid='pg_class'::regclass
   AND ns.nspname IN ('matches','log_processing') AND r.ev_class<>d.refobjid
   AND r.ev_class<>'matches.mv_hero_global_stats'::regclass AND v.relnamespace<>pg_my_temp_schema()
 UNION ALL SELECT id,'malformed_dependency_array' FROM (
SELECT id,'rule'::text owner,depends_on::jsonb AS value FROM achievements.rule
UNION ALL SELECT o.id,'outbox',o.payload_json::jsonb->'changed_tables' FROM event_outbox o WHERE (o.event_type='achievement_evaluate' OR o.payload_json::jsonb->>'event_type'='achievement_evaluate')
 AND o.status IN ('pending','failed')
) d
 WHERE value IS NULL OR jsonb_typeof(value)<>'array'
 UNION ALL SELECT d.id,'unknown_legacy_dependency' FROM (
SELECT id,'rule'::text owner,depends_on::jsonb AS value FROM achievements.rule
UNION ALL SELECT o.id,'outbox',o.payload_json::jsonb->'changed_tables' FROM event_outbox o WHERE (o.event_type='achievement_evaluate' OR o.payload_json::jsonb->>'event_type'='achievement_evaluate')
 AND o.status IN ('pending','failed')
) d
 CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(d.value)='array' THEN d.value ELSE '[]'::jsonb END) a(value)
 WHERE jsonb_typeof(a.value)<>'string' OR ((a.value#>>'{}' LIKE 'matches.%' OR a.value#>>'{}' LIKE 'log_processing.%')
   AND NOT EXISTS(SELECT 1 FROM stats01_dependency_names n WHERE n.old_name=a.value#>>'{}'))
 UNION ALL SELECT a.id,'orphan_evaluation_match' FROM achievements.evaluation_result a
 WHERE a.match_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM matches.match m WHERE m.id=a.match_id)
 UNION ALL SELECT a.id,'orphan_override_match' FROM achievements.override a
 WHERE a.match_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM matches.match m WHERE m.id=a.match_id)
 UNION ALL SELECT 0::bigint,'missing_or_ambiguous_required_fk:'||a.source
 FROM (VALUES ('achievements.evaluation_result'),('achievements.override')) a(source)
 WHERE (SELECT count(*) FROM (
SELECT c.oid,c.conrelid::regclass::text AS source,c.confrelid::regclass::text AS target,c.conname,
 ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY k(n,ord)
       JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.n ORDER BY k.ord) AS columns,
 ARRAY(SELECT a.attname::text FROM unnest(c.confkey) WITH ORDINALITY k(n,ord)
       JOIN pg_attribute a ON a.attrelid=c.confrelid AND a.attnum=k.n ORDER BY k.ord) AS target_columns
FROM pg_constraint c JOIN pg_class t ON t.oid=c.confrelid JOIN pg_namespace n ON n.oid=t.relnamespace
WHERE c.contype='f' AND n.nspname IN ('matches','log_processing')
) f JOIN pg_constraint c ON c.oid=f.oid
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
) p;

SELECT '1_game_binding'::text AS class,count(*) AS offending,CASE WHEN count(*)=0 THEN 'ok' ELSE 'blocking' END AS status FROM stats01_preflight WHERE class='1_game_binding' UNION ALL SELECT '2_missing_member'::text AS class,count(*) AS offending,CASE WHEN count(*)=0 THEN 'ok' ELSE 'blocking' END AS status FROM stats01_preflight WHERE class='2_missing_member' UNION ALL SELECT '3_team_binding'::text AS class,count(*) AS offending,CASE WHEN count(*)=0 THEN 'ok' ELSE 'blocking' END AS status FROM stats01_preflight WHERE class='3_team_binding' UNION ALL SELECT '4_duplicate_facts'::text AS class,count(*) AS offending,CASE WHEN count(*)=0 THEN 'ok' ELSE 'blocking' END AS status FROM stats01_preflight WHERE class='4_duplicate_facts' UNION ALL SELECT '5_player_teams'::text AS class,count(*) AS offending,CASE WHEN count(*)=0 THEN 'ok' ELSE 'blocking' END AS status FROM stats01_preflight WHERE class='5_player_teams' UNION ALL SELECT '6_ownership'::text AS class,count(*) AS offending,CASE WHEN count(*)=0 THEN 'ok' ELSE 'blocking' END AS status FROM stats01_preflight WHERE class='6_ownership' UNION ALL SELECT '7_baselines'::text AS class,count(*) AS offending,CASE WHEN count(*)=0 THEN 'ok' ELSE 'blocking' END AS status FROM stats01_preflight WHERE class='7_baselines' UNION ALL SELECT '8_raw_provenance'::text AS class,count(*) AS offending,CASE WHEN count(*)=0 THEN 'ok' ELSE 'blocking' END AS status FROM stats01_preflight WHERE class='8_raw_provenance' UNION ALL SELECT '9_representability'::text AS class,count(*) AS offending,CASE WHEN count(*)=0 THEN 'ok' ELSE 'blocking' END AS status FROM stats01_preflight WHERE class='9_representability' UNION ALL SELECT '10_dependencies'::text AS class,count(*) AS offending,CASE WHEN count(*)=0 THEN 'ok' ELSE 'blocking' END AS status FROM stats01_preflight WHERE class='10_dependencies';

SELECT c.class,p.id,p.reason FROM (SELECT DISTINCT class FROM stats01_preflight) c CROSS JOIN LATERAL (SELECT id,reason FROM stats01_preflight WHERE class=c.class ORDER BY id,reason LIMIT 20) p ORDER BY c.class,p.id,p.reason;

SELECT 'event_only_players'::text AS class,(SELECT count(*) FROM (SELECT DISTINCT match_id,user_id FROM stats01_endpoints WHERE user_id IS NOT NULL EXCEPT SELECT match_id,user_id FROM matches.statistics) p) AS count UNION ALL SELECT 'duplicate_import_hashes'::text AS class,(SELECT count(*) FROM (SELECT tournament_id,content_hash FROM log_processing.record GROUP BY tournament_id,content_hash HAVING count(*)>1) h) AS count UNION ALL SELECT 'unlinked_no_raw_matches'::text AS class,(SELECT count(*) FROM matches.match WHERE log_record_id IS NULL AND log_name IS NULL) AS count;
COMMIT;
