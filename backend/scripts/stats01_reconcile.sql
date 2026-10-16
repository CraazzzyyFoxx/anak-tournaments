-- Generated from migrations/versions/stats01_stats.py; initial full proof before native lifecycle changes.
BEGIN;

SET LOCAL timezone = 'UTC';

SET LOCAL extra_float_digits = 3;

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
WITH candidates AS (
 SELECT m.id AS match_id,e.workspace_id,e.discipline,e.tournament_id,e.id AS encounter_id,
   CASE WHEN EXISTS(SELECT 1 FROM encounter.game g WHERE g.encounter_id=e.id
                     AND g.position=m.map_index AND g.state<>'cancelled')
        THEN (SELECT min(g.id) FROM encounter.game g WHERE g.encounter_id=e.id
               AND g.position=m.map_index AND g.state<>'cancelled' AND g.map_id=m.map_id HAVING count(*)=1)
        ELSE (SELECT min(g.id) FROM encounter.game g WHERE g.encounter_id=e.id
               AND g.map_id=m.map_id AND g.state<>'cancelled' HAVING count(*)=1) END AS candidate_id
 FROM matches.match m JOIN encounter.encounter e ON e.id=m.encounter_id
), claims AS (
 SELECT c.*,count(*) OVER(PARTITION BY candidate_id) AS claim_count FROM candidates c
)
SELECT c.match_id,
 CASE WHEN c.claim_count=1
   AND (SELECT count(*) FROM encounter.game_team gt WHERE gt.game_id=c.candidate_id)=2
   AND (SELECT count(*) FROM encounter.game_team gt JOIN encounter.team et ON et.id=gt.encounter_team_id
         WHERE gt.game_id=c.candidate_id AND et.encounter_id=c.encounter_id
           AND et.team_id IN (m.home_team_id,m.away_team_id))=2
 THEN c.candidate_id END AS game_id,
 c.workspace_id,c.discipline,c.tournament_id,c.encounter_id
FROM claims c JOIN matches.match m ON m.id=c.match_id
;

CREATE TEMP VIEW stats01_historical_reference AS
       SELECT m.id AS source_match_id,
         (SELECT coalesce(max(id),0) FROM log_processing.record)+row_number() OVER(ORDER BY m.id) AS id
       FROM matches.match m JOIN stats01_match x ON x.match_id=m.id
       WHERE m.log_record_id IS NULL AND m.log_name IS NOT NULL;

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
       SELECT x.match_id,x.encounter_id,et.team_id,et.id AS encounter_team_id
       FROM stats01_match x JOIN encounter.team et ON et.encounter_id=x.encounter_id;

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

CREATE TEMP VIEW stats01_stat_ids AS SELECT n.legacy_name,d.discipline,d.code,d.id
       FROM stats01_stat_names n JOIN stats.stat_def d ON d.discipline='overwatch' AND d.code=n.code;

CREATE TEMP VIEW stats01_event_ids AS SELECT n.legacy_name,d.discipline,d.code,d.id
       FROM stats01_event_names n JOIN stats.event_type d ON d.discipline='overwatch' AND d.code=n.code;

CREATE TEMP VIEW stats01_oracle_records AS
       SELECT id,after_json->'stats01_oracle' AS p FROM audit_log WHERE action='stats.initial_transfer';

CREATE TEMP VIEW stats01_oracle_manifest AS
       SELECT v->>'class' AS class,(v->>'count')::bigint AS count,(v->>'chunks')::bigint AS chunks,v->>'sha256' AS sha256
       FROM stats01_oracle_records CROSS JOIN LATERAL jsonb_array_elements(p->'classes') v WHERE p->>'kind'='manifest';

CREATE TEMP VIEW stats01_oracle_chunks AS
       SELECT id,p->>'class' AS class,(p->>'chunk')::bigint AS chunk,p->'rows' AS rows,p->>'sha256' AS sha256
       FROM stats01_oracle_records WHERE p->>'kind'='chunk';

CREATE TEMP VIEW stats01_oracle_rows AS
       SELECT c.id,c.class,c.chunk,v.ordinality,v.value->'key' AS key,v.value->>'sha256' AS sha256
       FROM stats01_oracle_chunks c CROSS JOIN LATERAL jsonb_array_elements(c.rows) WITH ORDINALITY v(value,ordinality);

CREATE TEMP VIEW stats01_reconcile AS SELECT 'job_owners'::text AS class,'missing_or_changed'::text AS direction,to_jsonb(p) AS row
      FROM ((SELECT id FROM (SELECT r.id,r.created_at,r.updated_at,t.workspace_id,t.discipline,
 r.source::text AS source_kind,'legacy:log_processing.record:'||r.id::text AS external_id,
 r.content_hash::char(64),'unverified'::varchar AS raw_status,r.filename,('logs/'||r.tournament_id::text||'/')||(CASE WHEN starts_with((CASE WHEN starts_with(r.filename,('logs/'||r.tournament_id::text||'/')) THEN substr(r.filename,length(('logs/'||r.tournament_id::text||'/'))+1) ELSE r.filename END),'logs/') THEN substr((CASE WHEN starts_with(r.filename,('logs/'||r.tournament_id::text||'/')) THEN substr(r.filename,length(('logs/'||r.tournament_id::text||'/'))+1) ELSE r.filename END),6) ELSE (CASE WHEN starts_with(r.filename,('logs/'||r.tournament_id::text||'/')) THEN substr(r.filename,length(('logs/'||r.tournament_id::text||'/'))+1) ELSE r.filename END) END) AS raw_ref,NULL::varchar(512) AS document_ref,
 r.status::text AS status,r.attempts,r.error_message,r.uploader_id AS uploader_user_id,
 NULL::bigint AS api_key_id,r.tournament_id AS hint_tournament_id,
 r.attached_encounter_id AS hint_encounter_id,NULL::bigint AS hint_encounter_game_id,r.started_at,r.finished_at
 FROM log_processing.record r JOIN tournament.tournament t ON t.id=r.tournament_id UNION ALL SELECT id,created_at,updated_at,workspace_id,discipline,source_kind,external_id,content_hash,raw_status,filename,raw_ref,document_ref,status,attempts,error_message,uploader_user_id,api_key_id,hint_tournament_id,hint_encounter_id,hint_encounter_game_id,started_at,finished_at FROM (SELECT
 h.id,
 (SELECT min(created_at) FROM audit_log WHERE action='stats.initial_transfer') AS created_at,
 NULL::timestamptz AS updated_at,x.workspace_id,x.discipline,'historical_reference'::varchar AS source_kind,
 'legacy:matches.match:'||m.id::text AS external_id,NULL::char(64) AS content_hash,
 'unverified'::varchar AS raw_status,m.log_name AS filename,('logs/'||x.tournament_id::text||'/')||(CASE WHEN starts_with((CASE WHEN starts_with(m.log_name,('logs/'||x.tournament_id::text||'/')) THEN substr(m.log_name,length(('logs/'||x.tournament_id::text||'/'))+1) ELSE m.log_name END),'logs/') THEN substr((CASE WHEN starts_with(m.log_name,('logs/'||x.tournament_id::text||'/')) THEN substr(m.log_name,length(('logs/'||x.tournament_id::text||'/'))+1) ELSE m.log_name END),6) ELSE (CASE WHEN starts_with(m.log_name,('logs/'||x.tournament_id::text||'/')) THEN substr(m.log_name,length(('logs/'||x.tournament_id::text||'/'))+1) ELSE m.log_name END) END) AS raw_ref,
 NULL::varchar(512) AS document_ref,'done'::varchar AS status,0 AS attempts,NULL::text AS error_message,
 NULL::bigint AS uploader_user_id,NULL::bigint AS api_key_id,x.tournament_id AS hint_tournament_id,
 x.encounter_id AS hint_encounter_id,NULL::bigint AS hint_encounter_game_id,
 NULL::timestamptz AS started_at,NULL::timestamptz AS finished_at,m.id AS source_match_id
 FROM matches.match m JOIN stats01_match x ON x.match_id=m.id
 JOIN stats01_historical_reference h ON h.source_match_id=m.id
 WHERE m.log_record_id IS NULL AND m.log_name IS NOT NULL) h) j) EXCEPT ALL (SELECT id FROM stats.ingest_job)) p
      UNION ALL SELECT 'job_owners'::text,'unexpected_or_changed'::text,to_jsonb(p)
      FROM ((SELECT id FROM stats.ingest_job) EXCEPT ALL (SELECT id FROM (SELECT r.id,r.created_at,r.updated_at,t.workspace_id,t.discipline,
 r.source::text AS source_kind,'legacy:log_processing.record:'||r.id::text AS external_id,
 r.content_hash::char(64),'unverified'::varchar AS raw_status,r.filename,('logs/'||r.tournament_id::text||'/')||(CASE WHEN starts_with((CASE WHEN starts_with(r.filename,('logs/'||r.tournament_id::text||'/')) THEN substr(r.filename,length(('logs/'||r.tournament_id::text||'/'))+1) ELSE r.filename END),'logs/') THEN substr((CASE WHEN starts_with(r.filename,('logs/'||r.tournament_id::text||'/')) THEN substr(r.filename,length(('logs/'||r.tournament_id::text||'/'))+1) ELSE r.filename END),6) ELSE (CASE WHEN starts_with(r.filename,('logs/'||r.tournament_id::text||'/')) THEN substr(r.filename,length(('logs/'||r.tournament_id::text||'/'))+1) ELSE r.filename END) END) AS raw_ref,NULL::varchar(512) AS document_ref,
 r.status::text AS status,r.attempts,r.error_message,r.uploader_id AS uploader_user_id,
 NULL::bigint AS api_key_id,r.tournament_id AS hint_tournament_id,
 r.attached_encounter_id AS hint_encounter_id,NULL::bigint AS hint_encounter_game_id,r.started_at,r.finished_at
 FROM log_processing.record r JOIN tournament.tournament t ON t.id=r.tournament_id UNION ALL SELECT id,created_at,updated_at,workspace_id,discipline,source_kind,external_id,content_hash,raw_status,filename,raw_ref,document_ref,status,attempts,error_message,uploader_user_id,api_key_id,hint_tournament_id,hint_encounter_id,hint_encounter_game_id,started_at,finished_at FROM (SELECT
 h.id,
 (SELECT min(created_at) FROM audit_log WHERE action='stats.initial_transfer') AS created_at,
 NULL::timestamptz AS updated_at,x.workspace_id,x.discipline,'historical_reference'::varchar AS source_kind,
 'legacy:matches.match:'||m.id::text AS external_id,NULL::char(64) AS content_hash,
 'unverified'::varchar AS raw_status,m.log_name AS filename,('logs/'||x.tournament_id::text||'/')||(CASE WHEN starts_with((CASE WHEN starts_with(m.log_name,('logs/'||x.tournament_id::text||'/')) THEN substr(m.log_name,length(('logs/'||x.tournament_id::text||'/'))+1) ELSE m.log_name END),'logs/') THEN substr((CASE WHEN starts_with(m.log_name,('logs/'||x.tournament_id::text||'/')) THEN substr(m.log_name,length(('logs/'||x.tournament_id::text||'/'))+1) ELSE m.log_name END),6) ELSE (CASE WHEN starts_with(m.log_name,('logs/'||x.tournament_id::text||'/')) THEN substr(m.log_name,length(('logs/'||x.tournament_id::text||'/'))+1) ELSE m.log_name END) END) AS raw_ref,
 NULL::varchar(512) AS document_ref,'done'::varchar AS status,0 AS attempts,NULL::text AS error_message,
 NULL::bigint AS uploader_user_id,NULL::bigint AS api_key_id,x.tournament_id AS hint_tournament_id,
 x.encounter_id AS hint_encounter_id,NULL::bigint AS hint_encounter_game_id,
 NULL::timestamptz AS started_at,NULL::timestamptz AS finished_at,m.id AS source_match_id
 FROM matches.match m JOIN stats01_match x ON x.match_id=m.id
 JOIN stats01_historical_reference h ON h.source_match_id=m.id
 WHERE m.log_record_id IS NULL AND m.log_name IS NOT NULL) h) j)) p UNION ALL SELECT 'match_owners'::text AS class,'missing_or_changed'::text AS direction,to_jsonb(p) AS row
      FROM ((SELECT id FROM matches.match) EXCEPT ALL (SELECT id FROM stats.match)) p
      UNION ALL SELECT 'match_owners'::text,'unexpected_or_changed'::text,to_jsonb(p)
      FROM ((SELECT id FROM stats.match) EXCEPT ALL (SELECT id FROM matches.match)) p UNION ALL SELECT 'jobs'::text AS class,'missing_or_changed'::text AS direction,to_jsonb(p) AS row
      FROM ((SELECT r.id,r.created_at,r.updated_at,t.workspace_id,t.discipline,
 r.source::text AS source_kind,'legacy:log_processing.record:'||r.id::text AS external_id,
 r.content_hash::char(64),'unverified'::varchar AS raw_status,r.filename,('logs/'||r.tournament_id::text||'/')||(CASE WHEN starts_with((CASE WHEN starts_with(r.filename,('logs/'||r.tournament_id::text||'/')) THEN substr(r.filename,length(('logs/'||r.tournament_id::text||'/'))+1) ELSE r.filename END),'logs/') THEN substr((CASE WHEN starts_with(r.filename,('logs/'||r.tournament_id::text||'/')) THEN substr(r.filename,length(('logs/'||r.tournament_id::text||'/'))+1) ELSE r.filename END),6) ELSE (CASE WHEN starts_with(r.filename,('logs/'||r.tournament_id::text||'/')) THEN substr(r.filename,length(('logs/'||r.tournament_id::text||'/'))+1) ELSE r.filename END) END) AS raw_ref,NULL::varchar(512) AS document_ref,
 r.status::text AS status,r.attempts,r.error_message,r.uploader_id AS uploader_user_id,
 NULL::bigint AS api_key_id,r.tournament_id AS hint_tournament_id,
 r.attached_encounter_id AS hint_encounter_id,NULL::bigint AS hint_encounter_game_id,r.started_at,r.finished_at
 FROM log_processing.record r JOIN tournament.tournament t ON t.id=r.tournament_id UNION ALL SELECT id,created_at,updated_at,workspace_id,discipline,source_kind,external_id,content_hash,raw_status,filename,raw_ref,document_ref,status,attempts,error_message,uploader_user_id,api_key_id,hint_tournament_id,hint_encounter_id,hint_encounter_game_id,started_at,finished_at FROM (SELECT
 h.id,
 (SELECT min(created_at) FROM audit_log WHERE action='stats.initial_transfer') AS created_at,
 NULL::timestamptz AS updated_at,x.workspace_id,x.discipline,'historical_reference'::varchar AS source_kind,
 'legacy:matches.match:'||m.id::text AS external_id,NULL::char(64) AS content_hash,
 'unverified'::varchar AS raw_status,m.log_name AS filename,('logs/'||x.tournament_id::text||'/')||(CASE WHEN starts_with((CASE WHEN starts_with(m.log_name,('logs/'||x.tournament_id::text||'/')) THEN substr(m.log_name,length(('logs/'||x.tournament_id::text||'/'))+1) ELSE m.log_name END),'logs/') THEN substr((CASE WHEN starts_with(m.log_name,('logs/'||x.tournament_id::text||'/')) THEN substr(m.log_name,length(('logs/'||x.tournament_id::text||'/'))+1) ELSE m.log_name END),6) ELSE (CASE WHEN starts_with(m.log_name,('logs/'||x.tournament_id::text||'/')) THEN substr(m.log_name,length(('logs/'||x.tournament_id::text||'/'))+1) ELSE m.log_name END) END) AS raw_ref,
 NULL::varchar(512) AS document_ref,'done'::varchar AS status,0 AS attempts,NULL::text AS error_message,
 NULL::bigint AS uploader_user_id,NULL::bigint AS api_key_id,x.tournament_id AS hint_tournament_id,
 x.encounter_id AS hint_encounter_id,NULL::bigint AS hint_encounter_game_id,
 NULL::timestamptz AS started_at,NULL::timestamptz AS finished_at,m.id AS source_match_id
 FROM matches.match m JOIN stats01_match x ON x.match_id=m.id
 JOIN stats01_historical_reference h ON h.source_match_id=m.id
 WHERE m.log_record_id IS NULL AND m.log_name IS NOT NULL) h) EXCEPT ALL (SELECT id,created_at,updated_at,workspace_id,discipline,source_kind,external_id,content_hash,raw_status,filename,raw_ref,document_ref,status,attempts,error_message,uploader_user_id,api_key_id,hint_tournament_id,hint_encounter_id,hint_encounter_game_id,started_at,finished_at FROM stats.ingest_job)) p
      UNION ALL SELECT 'jobs'::text,'unexpected_or_changed'::text,to_jsonb(p)
      FROM ((SELECT id,created_at,updated_at,workspace_id,discipline,source_kind,external_id,content_hash,raw_status,filename,raw_ref,document_ref,status,attempts,error_message,uploader_user_id,api_key_id,hint_tournament_id,hint_encounter_id,hint_encounter_game_id,started_at,finished_at FROM stats.ingest_job) EXCEPT ALL (SELECT r.id,r.created_at,r.updated_at,t.workspace_id,t.discipline,
 r.source::text AS source_kind,'legacy:log_processing.record:'||r.id::text AS external_id,
 r.content_hash::char(64),'unverified'::varchar AS raw_status,r.filename,('logs/'||r.tournament_id::text||'/')||(CASE WHEN starts_with((CASE WHEN starts_with(r.filename,('logs/'||r.tournament_id::text||'/')) THEN substr(r.filename,length(('logs/'||r.tournament_id::text||'/'))+1) ELSE r.filename END),'logs/') THEN substr((CASE WHEN starts_with(r.filename,('logs/'||r.tournament_id::text||'/')) THEN substr(r.filename,length(('logs/'||r.tournament_id::text||'/'))+1) ELSE r.filename END),6) ELSE (CASE WHEN starts_with(r.filename,('logs/'||r.tournament_id::text||'/')) THEN substr(r.filename,length(('logs/'||r.tournament_id::text||'/'))+1) ELSE r.filename END) END) AS raw_ref,NULL::varchar(512) AS document_ref,
 r.status::text AS status,r.attempts,r.error_message,r.uploader_id AS uploader_user_id,
 NULL::bigint AS api_key_id,r.tournament_id AS hint_tournament_id,
 r.attached_encounter_id AS hint_encounter_id,NULL::bigint AS hint_encounter_game_id,r.started_at,r.finished_at
 FROM log_processing.record r JOIN tournament.tournament t ON t.id=r.tournament_id UNION ALL SELECT id,created_at,updated_at,workspace_id,discipline,source_kind,external_id,content_hash,raw_status,filename,raw_ref,document_ref,status,attempts,error_message,uploader_user_id,api_key_id,hint_tournament_id,hint_encounter_id,hint_encounter_game_id,started_at,finished_at FROM (SELECT
 h.id,
 (SELECT min(created_at) FROM audit_log WHERE action='stats.initial_transfer') AS created_at,
 NULL::timestamptz AS updated_at,x.workspace_id,x.discipline,'historical_reference'::varchar AS source_kind,
 'legacy:matches.match:'||m.id::text AS external_id,NULL::char(64) AS content_hash,
 'unverified'::varchar AS raw_status,m.log_name AS filename,('logs/'||x.tournament_id::text||'/')||(CASE WHEN starts_with((CASE WHEN starts_with(m.log_name,('logs/'||x.tournament_id::text||'/')) THEN substr(m.log_name,length(('logs/'||x.tournament_id::text||'/'))+1) ELSE m.log_name END),'logs/') THEN substr((CASE WHEN starts_with(m.log_name,('logs/'||x.tournament_id::text||'/')) THEN substr(m.log_name,length(('logs/'||x.tournament_id::text||'/'))+1) ELSE m.log_name END),6) ELSE (CASE WHEN starts_with(m.log_name,('logs/'||x.tournament_id::text||'/')) THEN substr(m.log_name,length(('logs/'||x.tournament_id::text||'/'))+1) ELSE m.log_name END) END) AS raw_ref,
 NULL::varchar(512) AS document_ref,'done'::varchar AS status,0 AS attempts,NULL::text AS error_message,
 NULL::bigint AS uploader_user_id,NULL::bigint AS api_key_id,x.tournament_id AS hint_tournament_id,
 x.encounter_id AS hint_encounter_id,NULL::bigint AS hint_encounter_game_id,
 NULL::timestamptz AS started_at,NULL::timestamptz AS finished_at,m.id AS source_match_id
 FROM matches.match m JOIN stats01_match x ON x.match_id=m.id
 JOIN stats01_historical_reference h ON h.source_match_id=m.id
 WHERE m.log_record_id IS NULL AND m.log_name IS NOT NULL) h)) p UNION ALL SELECT 'matches'::text AS class,'missing_or_changed'::text AS direction,to_jsonb(p) AS row
      FROM ((SELECT m.id,m.created_at,m.updated_at,x.workspace_id,x.discipline,
 x.encounter_id,m.map_index AS source_map_index,x.game_id AS encounter_game_id,
 coalesce(m.log_record_id,h.id) AS ingest_job_id,1 AS revision,NULL::timestamptz AS played_at,m.time AS duration_s,
 m.map_id AS map_entity_id,'map'::varchar AS map_kind FROM matches.match m JOIN stats01_match x ON x.match_id=m.id
 LEFT JOIN (SELECT
 h.id,
 (SELECT min(created_at) FROM audit_log WHERE action='stats.initial_transfer') AS created_at,
 NULL::timestamptz AS updated_at,x.workspace_id,x.discipline,'historical_reference'::varchar AS source_kind,
 'legacy:matches.match:'||m.id::text AS external_id,NULL::char(64) AS content_hash,
 'unverified'::varchar AS raw_status,m.log_name AS filename,('logs/'||x.tournament_id::text||'/')||(CASE WHEN starts_with((CASE WHEN starts_with(m.log_name,('logs/'||x.tournament_id::text||'/')) THEN substr(m.log_name,length(('logs/'||x.tournament_id::text||'/'))+1) ELSE m.log_name END),'logs/') THEN substr((CASE WHEN starts_with(m.log_name,('logs/'||x.tournament_id::text||'/')) THEN substr(m.log_name,length(('logs/'||x.tournament_id::text||'/'))+1) ELSE m.log_name END),6) ELSE (CASE WHEN starts_with(m.log_name,('logs/'||x.tournament_id::text||'/')) THEN substr(m.log_name,length(('logs/'||x.tournament_id::text||'/'))+1) ELSE m.log_name END) END) AS raw_ref,
 NULL::varchar(512) AS document_ref,'done'::varchar AS status,0 AS attempts,NULL::text AS error_message,
 NULL::bigint AS uploader_user_id,NULL::bigint AS api_key_id,x.tournament_id AS hint_tournament_id,
 x.encounter_id AS hint_encounter_id,NULL::bigint AS hint_encounter_game_id,
 NULL::timestamptz AS started_at,NULL::timestamptz AS finished_at,m.id AS source_match_id
 FROM matches.match m JOIN stats01_match x ON x.match_id=m.id
 JOIN stats01_historical_reference h ON h.source_match_id=m.id
 WHERE m.log_record_id IS NULL AND m.log_name IS NOT NULL) h ON h.source_match_id=m.id) EXCEPT ALL (SELECT id,created_at,updated_at,workspace_id,discipline,encounter_id,source_map_index,encounter_game_id,ingest_job_id,revision,played_at,duration_s,map_entity_id,map_kind FROM stats.match WHERE id IN (SELECT id FROM matches.match))) p
      UNION ALL SELECT 'matches'::text,'unexpected_or_changed'::text,to_jsonb(p)
      FROM ((SELECT id,created_at,updated_at,workspace_id,discipline,encounter_id,source_map_index,encounter_game_id,ingest_job_id,revision,played_at,duration_s,map_entity_id,map_kind FROM stats.match WHERE id IN (SELECT id FROM matches.match)) EXCEPT ALL (SELECT m.id,m.created_at,m.updated_at,x.workspace_id,x.discipline,
 x.encounter_id,m.map_index AS source_map_index,x.game_id AS encounter_game_id,
 coalesce(m.log_record_id,h.id) AS ingest_job_id,1 AS revision,NULL::timestamptz AS played_at,m.time AS duration_s,
 m.map_id AS map_entity_id,'map'::varchar AS map_kind FROM matches.match m JOIN stats01_match x ON x.match_id=m.id
 LEFT JOIN (SELECT
 h.id,
 (SELECT min(created_at) FROM audit_log WHERE action='stats.initial_transfer') AS created_at,
 NULL::timestamptz AS updated_at,x.workspace_id,x.discipline,'historical_reference'::varchar AS source_kind,
 'legacy:matches.match:'||m.id::text AS external_id,NULL::char(64) AS content_hash,
 'unverified'::varchar AS raw_status,m.log_name AS filename,('logs/'||x.tournament_id::text||'/')||(CASE WHEN starts_with((CASE WHEN starts_with(m.log_name,('logs/'||x.tournament_id::text||'/')) THEN substr(m.log_name,length(('logs/'||x.tournament_id::text||'/'))+1) ELSE m.log_name END),'logs/') THEN substr((CASE WHEN starts_with(m.log_name,('logs/'||x.tournament_id::text||'/')) THEN substr(m.log_name,length(('logs/'||x.tournament_id::text||'/'))+1) ELSE m.log_name END),6) ELSE (CASE WHEN starts_with(m.log_name,('logs/'||x.tournament_id::text||'/')) THEN substr(m.log_name,length(('logs/'||x.tournament_id::text||'/'))+1) ELSE m.log_name END) END) AS raw_ref,
 NULL::varchar(512) AS document_ref,'done'::varchar AS status,0 AS attempts,NULL::text AS error_message,
 NULL::bigint AS uploader_user_id,NULL::bigint AS api_key_id,x.tournament_id AS hint_tournament_id,
 x.encounter_id AS hint_encounter_id,NULL::bigint AS hint_encounter_game_id,
 NULL::timestamptz AS started_at,NULL::timestamptz AS finished_at,m.id AS source_match_id
 FROM matches.match m JOIN stats01_match x ON x.match_id=m.id
 JOIN stats01_historical_reference h ON h.source_match_id=m.id
 WHERE m.log_record_id IS NULL AND m.log_name IS NOT NULL) h ON h.source_match_id=m.id)) p UNION ALL SELECT 'teams'::text AS class,'missing_or_changed'::text AS direction,to_jsonb(p) AS row
      FROM ((SELECT m.id AS match_id,x.encounter_id,t.encounter_team_id,s.position AS source_position
 FROM matches.match m JOIN stats01_match x ON x.match_id=m.id
 CROSS JOIN LATERAL (VALUES(m.home_team_id,1),(m.away_team_id,2)) s(team_id,position)
 JOIN stats01_team t ON t.match_id=m.id AND t.team_id=s.team_id) EXCEPT ALL (SELECT match_id,encounter_id,encounter_team_id,source_position FROM stats.match_team WHERE match_id IN (SELECT id FROM matches.match))) p
      UNION ALL SELECT 'teams'::text,'unexpected_or_changed'::text,to_jsonb(p)
      FROM ((SELECT match_id,encounter_id,encounter_team_id,source_position FROM stats.match_team WHERE match_id IN (SELECT id FROM matches.match)) EXCEPT ALL (SELECT m.id AS match_id,x.encounter_id,t.encounter_team_id,s.position AS source_position
 FROM matches.match m JOIN stats01_match x ON x.match_id=m.id
 CROSS JOIN LATERAL (VALUES(m.home_team_id,1),(m.away_team_id,2)) s(team_id,position)
 JOIN stats01_team t ON t.match_id=m.id AND t.team_id=s.team_id)) p UNION ALL SELECT 'players'::text AS class,'missing_or_changed'::text AS direction,to_jsonb(p) AS row
      FROM ((SELECT DISTINCT p.match_id,t.encounter_team_id,w.id AS workspace_member_id,
 h.handle_snapshot,NULL::bigint AS observed_role_id
 FROM stats01_endpoints p JOIN stats01_match x ON x.match_id=p.match_id
 JOIN stats01_team t ON t.match_id=p.match_id AND t.team_id=p.team_id
 JOIN stats01_member w ON w.workspace_id=x.workspace_id AND w.player_id=p.user_id
 JOIN stats01_handles h ON h.match_id=p.match_id AND h.player_id=p.user_id AND h.team_id=p.team_id
 WHERE p.user_id IS NOT NULL) EXCEPT ALL (SELECT match_id,encounter_team_id,workspace_member_id,handle_snapshot,observed_role_id FROM stats.match_player WHERE match_id IN (SELECT id FROM matches.match))) p
      UNION ALL SELECT 'players'::text,'unexpected_or_changed'::text,to_jsonb(p)
      FROM ((SELECT match_id,encounter_team_id,workspace_member_id,handle_snapshot,observed_role_id FROM stats.match_player WHERE match_id IN (SELECT id FROM matches.match)) EXCEPT ALL (SELECT DISTINCT p.match_id,t.encounter_team_id,w.id AS workspace_member_id,
 h.handle_snapshot,NULL::bigint AS observed_role_id
 FROM stats01_endpoints p JOIN stats01_match x ON x.match_id=p.match_id
 JOIN stats01_team t ON t.match_id=p.match_id AND t.team_id=p.team_id
 JOIN stats01_member w ON w.workspace_id=x.workspace_id AND w.player_id=p.user_id
 JOIN stats01_handles h ON h.match_id=p.match_id AND h.player_id=p.user_id AND h.team_id=p.team_id
 WHERE p.user_id IS NOT NULL)) p UNION ALL SELECT 'facts'::text AS class,'missing_or_changed'::text AS direction,to_jsonb(p) AS row
      FROM ((SELECT s.match_id,s.round::smallint AS segment,t.encounter_team_id,
 w.id AS workspace_member_id,s.hero_id AS entity_id,'character'::varchar AS entity_kind,d.id AS stat_id,s.value
 FROM matches.statistics s JOIN stats01_match x ON x.match_id=s.match_id
 JOIN stats01_team t ON t.match_id=s.match_id AND t.team_id=s.team_id
 JOIN stats01_member w ON w.workspace_id=x.workspace_id AND w.player_id=s.user_id
 JOIN stats01_stat_ids d ON d.discipline=x.discipline AND d.legacy_name::logstatsname=s.name) EXCEPT ALL (SELECT match_id,segment,encounter_team_id,workspace_member_id,entity_id,entity_kind,stat_id,value FROM stats.fact WHERE match_id IN (SELECT id FROM matches.match) AND workspace_member_id IS NOT NULL)) p
      UNION ALL SELECT 'facts'::text,'unexpected_or_changed'::text,to_jsonb(p)
      FROM ((SELECT match_id,segment,encounter_team_id,workspace_member_id,entity_id,entity_kind,stat_id,value FROM stats.fact WHERE match_id IN (SELECT id FROM matches.match) AND workspace_member_id IS NOT NULL) EXCEPT ALL (SELECT s.match_id,s.round::smallint AS segment,t.encounter_team_id,
 w.id AS workspace_member_id,s.hero_id AS entity_id,'character'::varchar AS entity_kind,d.id AS stat_id,s.value
 FROM matches.statistics s JOIN stats01_match x ON x.match_id=s.match_id
 JOIN stats01_team t ON t.match_id=s.match_id AND t.team_id=s.team_id
 JOIN stats01_member w ON w.workspace_id=x.workspace_id AND w.player_id=s.user_id
 JOIN stats01_stat_ids d ON d.discipline=x.discipline AND d.legacy_name::logstatsname=s.name)) p UNION ALL SELECT 'team_scores'::text AS class,'missing_or_changed'::text AS direction,to_jsonb(p) AS row
      FROM ((SELECT m.id AS match_id,0::smallint AS segment,t.encounter_team_id,
 NULL::bigint AS workspace_member_id,NULL::bigint AS entity_id,'character'::varchar AS entity_kind,
 d.id AS stat_id,s.score::float8 AS value FROM matches.match m JOIN stats01_match x ON x.match_id=m.id
 CROSS JOIN LATERAL (VALUES(m.home_team_id,m.home_score),(m.away_team_id,m.away_score)) s(team_id,score)
 JOIN stats01_team t ON t.match_id=m.id AND t.team_id=s.team_id
 JOIN stats.stat_def d ON d.discipline=x.discipline AND d.code='score') EXCEPT ALL (SELECT match_id,segment,encounter_team_id,workspace_member_id,entity_id,entity_kind,stat_id,value FROM stats.fact WHERE match_id IN (SELECT id FROM matches.match) AND workspace_member_id IS NULL)) p
      UNION ALL SELECT 'team_scores'::text,'unexpected_or_changed'::text,to_jsonb(p)
      FROM ((SELECT match_id,segment,encounter_team_id,workspace_member_id,entity_id,entity_kind,stat_id,value FROM stats.fact WHERE match_id IN (SELECT id FROM matches.match) AND workspace_member_id IS NULL) EXCEPT ALL (SELECT m.id AS match_id,0::smallint AS segment,t.encounter_team_id,
 NULL::bigint AS workspace_member_id,NULL::bigint AS entity_id,'character'::varchar AS entity_kind,
 d.id AS stat_id,s.score::float8 AS value FROM matches.match m JOIN stats01_match x ON x.match_id=m.id
 CROSS JOIN LATERAL (VALUES(m.home_team_id,m.home_score),(m.away_team_id,m.away_score)) s(team_id,score)
 JOIN stats01_team t ON t.match_id=m.id AND t.team_id=s.team_id
 JOIN stats.stat_def d ON d.discipline=x.discipline AND d.code='score')) p UNION ALL SELECT 'events'::text AS class,'missing_or_changed'::text AS direction,to_jsonb(p) AS row
      FROM ((SELECT match_id,segment,t,type_id,actor_member_id,actor_team_id,target_member_id,target_team_id,entity_id,related_entity_id,entity_kind,data FROM (SELECT k.match_id,k.round::smallint AS segment,k.time AS t,d.id AS type_id,
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
 LEFT JOIN stats01_ability_values a ON a.legacy_name=k.ability::text) k UNION ALL SELECT match_id,segment,t,type_id,actor_member_id,actor_team_id,target_member_id,target_team_id,entity_id,related_entity_id,entity_kind,data FROM (SELECT e.match_id,e.round::smallint AS segment,e.time AS t,d.id AS type_id,
 aw.id AS actor_member_id,at.encounter_team_id AS actor_team_id,tw.id AS target_member_id,
 tt.encounter_team_id AS target_team_id,e.hero_id AS entity_id,e.related_hero_id AS related_entity_id,
 'character'::varchar AS entity_kind,NULL::jsonb AS data,e.id AS source_id
 FROM matches.event e JOIN stats01_match x ON x.match_id=e.match_id
 JOIN stats01_event_ids d ON d.discipline=x.discipline AND d.legacy_name=e.name::text
 LEFT JOIN stats01_team at ON at.match_id=e.match_id AND at.team_id=e.team_id
 LEFT JOIN stats01_team tt ON tt.match_id=e.match_id AND tt.team_id=e.related_team_id
 LEFT JOIN stats01_member aw ON aw.workspace_id=x.workspace_id AND aw.player_id=e.user_id
 LEFT JOIN stats01_member tw ON tw.workspace_id=x.workspace_id AND tw.player_id=e.related_user_id) e) EXCEPT ALL (SELECT match_id,segment,t,type_id,actor_member_id,actor_team_id,target_member_id,target_team_id,entity_id,related_entity_id,entity_kind,data FROM stats.event WHERE match_id IN (SELECT id FROM matches.match))) p
      UNION ALL SELECT 'events'::text,'unexpected_or_changed'::text,to_jsonb(p)
      FROM ((SELECT match_id,segment,t,type_id,actor_member_id,actor_team_id,target_member_id,target_team_id,entity_id,related_entity_id,entity_kind,data FROM stats.event WHERE match_id IN (SELECT id FROM matches.match)) EXCEPT ALL (SELECT match_id,segment,t,type_id,actor_member_id,actor_team_id,target_member_id,target_team_id,entity_id,related_entity_id,entity_kind,data FROM (SELECT k.match_id,k.round::smallint AS segment,k.time AS t,d.id AS type_id,
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
 LEFT JOIN stats01_ability_values a ON a.legacy_name=k.ability::text) k UNION ALL SELECT match_id,segment,t,type_id,actor_member_id,actor_team_id,target_member_id,target_team_id,entity_id,related_entity_id,entity_kind,data FROM (SELECT e.match_id,e.round::smallint AS segment,e.time AS t,d.id AS type_id,
 aw.id AS actor_member_id,at.encounter_team_id AS actor_team_id,tw.id AS target_member_id,
 tt.encounter_team_id AS target_team_id,e.hero_id AS entity_id,e.related_hero_id AS related_entity_id,
 'character'::varchar AS entity_kind,NULL::jsonb AS data,e.id AS source_id
 FROM matches.event e JOIN stats01_match x ON x.match_id=e.match_id
 JOIN stats01_event_ids d ON d.discipline=x.discipline AND d.legacy_name=e.name::text
 LEFT JOIN stats01_team at ON at.match_id=e.match_id AND at.team_id=e.team_id
 LEFT JOIN stats01_team tt ON tt.match_id=e.match_id AND tt.team_id=e.related_team_id
 LEFT JOIN stats01_member aw ON aw.workspace_id=x.workspace_id AND aw.player_id=e.user_id
 LEFT JOIN stats01_member tw ON tw.workspace_id=x.workspace_id AND tw.player_id=e.related_user_id) e)) p UNION ALL SELECT 'segments'::text AS class,'missing_or_changed'::text AS direction,to_jsonb(p) AS row
      FROM ((SELECT DISTINCT match_id,round::smallint AS segment,'round'::varchar AS kind,'{}'::jsonb AS attrs
 FROM (SELECT match_id,round FROM matches.statistics UNION ALL SELECT match_id,round FROM matches.kill_feed
 UNION ALL SELECT match_id,round FROM matches.event) s WHERE round>0) EXCEPT ALL (SELECT match_id,segment,kind,attrs FROM stats.segment WHERE match_id IN (SELECT id FROM matches.match))) p
      UNION ALL SELECT 'segments'::text,'unexpected_or_changed'::text,to_jsonb(p)
      FROM ((SELECT match_id,segment,kind,attrs FROM stats.segment WHERE match_id IN (SELECT id FROM matches.match)) EXCEPT ALL (SELECT DISTINCT match_id,round::smallint AS segment,'round'::varchar AS kind,'{}'::jsonb AS attrs
 FROM (SELECT match_id,round FROM matches.statistics UNION ALL SELECT match_id,round FROM matches.kill_feed
 UNION ALL SELECT match_id,round FROM matches.event) s WHERE round>0)) p UNION ALL SELECT 'baselines'::text AS class,'missing_or_changed'::text AS direction,to_jsonb(p) AS row
      FROM ((SELECT b.id,b.formula_version,r.id AS role_id,b.rank_bucket,d.id AS stat_id,b.mean,b.std,b.meta,b.computed_at
 FROM matches.stat_baselines b JOIN stats01_roles r ON r.code=lower(b.role::text)
 JOIN stats01_stat_ids d ON d.discipline='overwatch' AND d.legacy_name=b.stat::text) EXCEPT ALL (SELECT id,formula_version,role_id,rank_bucket,stat_id,mean,std,meta,computed_at FROM stats.stat_baseline)) p
      UNION ALL SELECT 'baselines'::text,'unexpected_or_changed'::text,to_jsonb(p)
      FROM ((SELECT id,formula_version,role_id,rank_bucket,stat_id,mean,std,meta,computed_at FROM stats.stat_baseline) EXCEPT ALL (SELECT b.id,b.formula_version,r.id AS role_id,b.rank_bucket,d.id AS stat_id,b.mean,b.std,b.meta,b.computed_at
 FROM matches.stat_baselines b JOIN stats01_roles r ON r.code=lower(b.role::text)
 JOIN stats01_stat_ids d ON d.discipline='overwatch' AND d.legacy_name=b.stat::text)) p UNION ALL SELECT 'stat_def'::text AS class,'missing_or_changed'::text AS direction,to_jsonb(p) AS row
      FROM ((SELECT 'overwatch'::varchar AS discipline,v.code,v.name,v.value_format,v.aggregation,v.stat_group::varchar,
       true AS active,v.sort_order FROM (VALUES ('eliminations','Eliminations','integer','sum',NULL,0),
('final_blows','Final blows','integer','sum',NULL,1),
('deaths','Deaths','integer','sum',NULL,2),
('all_damage_dealt','All damage dealt','decimal','sum',NULL,3),
('barrier_damage_dealt','Barrier damage dealt','decimal','sum',NULL,4),
('hero_damage_dealt','Hero damage dealt','decimal','sum',NULL,5),
('healing_dealt','Healing dealt','decimal','sum',NULL,6),
('healing_received','Healing received','decimal','sum',NULL,7),
('self_healing','Self healing','decimal','sum',NULL,8),
('damage_taken','Damage taken','decimal','sum',NULL,9),
('damage_blocked','Damage blocked','decimal','sum',NULL,10),
('defensive_assists','Defensive assists','integer','sum',NULL,11),
('offensive_assists','Offensive assists','integer','sum',NULL,12),
('ultimates_earned','Ultimates earned','integer','sum',NULL,13),
('ultimates_used','Ultimates used','integer','sum',NULL,14),
('multikill_best','Best multikill','integer','max',NULL,15),
('multikills','Multikills','integer','sum',NULL,16),
('solo_kills','Solo kills','integer','sum',NULL,17),
('objective_kills','Objective kills','integer','sum',NULL,18),
('environmental_kills','Environmental kills','integer','sum',NULL,19),
('environmental_deaths','Environmental deaths','integer','sum',NULL,20),
('critical_hits','Critical hits','integer','sum',NULL,21),
('critical_hit_accuracy','Critical hit accuracy','percent','avg',NULL,22),
('scoped_accuracy','Scoped accuracy','percent','avg',NULL,23),
('scoped_critical_hit_accuracy','Scoped critical hit accuracy','percent','avg',NULL,24),
('scoped_critical_hit_kills','Scoped critical hit kills','integer','sum',NULL,25),
('shots_fired','Shots fired','integer','sum',NULL,26),
('shots_hit','Shots hit','integer','sum',NULL,27),
('shots_missed','Shots missed','integer','sum',NULL,28),
('scoped_shots_fired','Scoped shots fired','integer','sum',NULL,29),
('scoped_shots_hit','Scoped shots hit','integer','sum',NULL,30),
('weapon_accuracy','Weapon accuracy','percent','avg',NULL,31),
('hero_time_played','Hero time played','duration','sum',NULL,32),
('first_picks','First picks','integer','sum',NULL,33),
('first_deaths','First deaths','integer','sum',NULL,34),
('ultimate_kills','Ultimate kills','integer','sum',NULL,35),
('support_kills','Support kills','integer','sum',NULL,36),
('performance','Performance rank','integer','avg',NULL,37),
('performance_points','Performance points','decimal','avg',NULL,38),
('kd','Kills / deaths','decimal','avg',NULL,39),
('kda','Kills and assists / deaths','decimal','avg',NULL,40),
('damage_delta','Damage delta','decimal','sum',NULL,41),
('fbe','Final blows / eliminations','decimal','avg',NULL,42),
('damage_fb','Damage / final blow','decimal','avg',NULL,43),
('assists','Assists','integer','sum',NULL,44),
('impact_points','Impact points','decimal','avg',NULL,45),
('impact_rank','Impact rank','integer','avg',NULL,46),
('overperformance_score','Overperformance score','decimal','avg',NULL,47),
('score','Score','integer','sum','team',48))
       v(code,name,value_format,aggregation,stat_group,sort_order)) EXCEPT ALL (SELECT discipline,code,name,value_format,aggregation,stat_group,active,sort_order FROM stats.stat_def WHERE discipline='overwatch')) p
      UNION ALL SELECT 'stat_def'::text,'unexpected_or_changed'::text,to_jsonb(p)
      FROM ((SELECT discipline,code,name,value_format,aggregation,stat_group,active,sort_order FROM stats.stat_def WHERE discipline='overwatch') EXCEPT ALL (SELECT 'overwatch'::varchar AS discipline,v.code,v.name,v.value_format,v.aggregation,v.stat_group::varchar,
       true AS active,v.sort_order FROM (VALUES ('eliminations','Eliminations','integer','sum',NULL,0),
('final_blows','Final blows','integer','sum',NULL,1),
('deaths','Deaths','integer','sum',NULL,2),
('all_damage_dealt','All damage dealt','decimal','sum',NULL,3),
('barrier_damage_dealt','Barrier damage dealt','decimal','sum',NULL,4),
('hero_damage_dealt','Hero damage dealt','decimal','sum',NULL,5),
('healing_dealt','Healing dealt','decimal','sum',NULL,6),
('healing_received','Healing received','decimal','sum',NULL,7),
('self_healing','Self healing','decimal','sum',NULL,8),
('damage_taken','Damage taken','decimal','sum',NULL,9),
('damage_blocked','Damage blocked','decimal','sum',NULL,10),
('defensive_assists','Defensive assists','integer','sum',NULL,11),
('offensive_assists','Offensive assists','integer','sum',NULL,12),
('ultimates_earned','Ultimates earned','integer','sum',NULL,13),
('ultimates_used','Ultimates used','integer','sum',NULL,14),
('multikill_best','Best multikill','integer','max',NULL,15),
('multikills','Multikills','integer','sum',NULL,16),
('solo_kills','Solo kills','integer','sum',NULL,17),
('objective_kills','Objective kills','integer','sum',NULL,18),
('environmental_kills','Environmental kills','integer','sum',NULL,19),
('environmental_deaths','Environmental deaths','integer','sum',NULL,20),
('critical_hits','Critical hits','integer','sum',NULL,21),
('critical_hit_accuracy','Critical hit accuracy','percent','avg',NULL,22),
('scoped_accuracy','Scoped accuracy','percent','avg',NULL,23),
('scoped_critical_hit_accuracy','Scoped critical hit accuracy','percent','avg',NULL,24),
('scoped_critical_hit_kills','Scoped critical hit kills','integer','sum',NULL,25),
('shots_fired','Shots fired','integer','sum',NULL,26),
('shots_hit','Shots hit','integer','sum',NULL,27),
('shots_missed','Shots missed','integer','sum',NULL,28),
('scoped_shots_fired','Scoped shots fired','integer','sum',NULL,29),
('scoped_shots_hit','Scoped shots hit','integer','sum',NULL,30),
('weapon_accuracy','Weapon accuracy','percent','avg',NULL,31),
('hero_time_played','Hero time played','duration','sum',NULL,32),
('first_picks','First picks','integer','sum',NULL,33),
('first_deaths','First deaths','integer','sum',NULL,34),
('ultimate_kills','Ultimate kills','integer','sum',NULL,35),
('support_kills','Support kills','integer','sum',NULL,36),
('performance','Performance rank','integer','avg',NULL,37),
('performance_points','Performance points','decimal','avg',NULL,38),
('kd','Kills / deaths','decimal','avg',NULL,39),
('kda','Kills and assists / deaths','decimal','avg',NULL,40),
('damage_delta','Damage delta','decimal','sum',NULL,41),
('fbe','Final blows / eliminations','decimal','avg',NULL,42),
('damage_fb','Damage / final blow','decimal','avg',NULL,43),
('assists','Assists','integer','sum',NULL,44),
('impact_points','Impact points','decimal','avg',NULL,45),
('impact_rank','Impact rank','integer','avg',NULL,46),
('overperformance_score','Overperformance score','decimal','avg',NULL,47),
('score','Score','integer','sum','team',48))
       v(code,name,value_format,aggregation,stat_group,sort_order))) p UNION ALL SELECT 'event_type'::text AS class,'missing_or_changed'::text AS direction,to_jsonb(p) AS row
      FROM ((SELECT 'overwatch'::varchar AS discipline,code,name,true AS active
       FROM (VALUES ('kill','Kill'),
('offensive_assist','Offensive assist'),
('defensive_assist','Defensive assist'),
('ultimate_charged','Ultimate charged'),
('ultimate_start','Ultimate start'),
('ultimate_end','Ultimate end'),
('hero_swap','Hero swap'),
('mercy_rez','Mercy resurrection'),
('echo_duplicate_start','Echo duplicate start'),
('echo_duplicate_end','Echo duplicate end')) v(code,name)) EXCEPT ALL (SELECT discipline,code,name,active FROM stats.event_type WHERE discipline='overwatch')) p
      UNION ALL SELECT 'event_type'::text,'unexpected_or_changed'::text,to_jsonb(p)
      FROM ((SELECT discipline,code,name,active FROM stats.event_type WHERE discipline='overwatch') EXCEPT ALL (SELECT 'overwatch'::varchar AS discipline,code,name,true AS active
       FROM (VALUES ('kill','Kill'),
('offensive_assist','Offensive assist'),
('defensive_assist','Defensive assist'),
('ultimate_charged','Ultimate charged'),
('ultimate_start','Ultimate start'),
('ultimate_end','Ultimate end'),
('hero_swap','Hero swap'),
('mercy_rez','Mercy resurrection'),
('echo_duplicate_start','Echo duplicate start'),
('echo_duplicate_end','Echo duplicate end')) v(code,name))) p UNION ALL SELECT 'mv'::text AS class,d.direction,d.row FROM (
          WITH e AS MATERIALIZED (SELECT d.discipline,d.id AS stat_id,l.hero_id AS entity_id,l.best_value,l.avg,l.metadata
      FROM (
WITH qualified AS (
 SELECT DISTINCT s.match_id,s.user_id,s.hero_id FROM matches.statistics s
 WHERE s.round=0 AND s.name='HeroTimePlayed' AND s.value>60
), eligible AS (
 SELECT st.match_id,st.user_id,st.hero_id,st.name,st.value,w.id AS workspace_member_id
 FROM matches.statistics st
 JOIN qualified q ON q.match_id=st.match_id AND q.user_id=st.user_id AND q.hero_id=st.hero_id
 JOIN stats01_match x ON x.match_id=st.match_id
 JOIN stats01_member w ON w.workspace_id=x.workspace_id AND w.player_id=st.user_id
 WHERE st.round=0 AND st.hero_id IS NOT NULL
), agg AS (
 SELECT e.hero_id,e.name,
 sum(e.value ORDER BY e.match_id,e.workspace_member_id) sum_value,
 sum(m."time" ORDER BY e.match_id,e.workspace_member_id) sum_time
 FROM eligible e JOIN matches.match m ON m.id=e.match_id GROUP BY e.hero_id,e.name
), ranked AS (
 SELECT e.*,row_number() OVER (PARTITION BY e.hero_id,e.name ORDER BY e.value *
 CASE WHEN e.name IN ('Deaths','DamageTaken','EnvironmentalDeaths','ShotsMissed','DamageFB','Performance')
 THEN -1.0 ELSE 1.0 END DESC,e.match_id DESC,e.workspace_member_id ASC) rn FROM eligible e
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
) l JOIN stats01_stat_names n ON n.legacy_name=l.name::text
      JOIN stats.stat_def d ON d.discipline='overwatch' AND d.code=n.code),a AS MATERIALIZED (SELECT discipline,stat_id,entity_id,best_value,avg,metadata FROM stats.mv_entity_global_stats)
          SELECT CASE WHEN e.stat_id IS NOT NULL THEN to_jsonb(e) END AS expected_row,
            CASE WHEN a.stat_id IS NOT NULL THEN to_jsonb(a) END AS actual_row
          FROM e FULL JOIN a USING(discipline,stat_id,entity_id)
          WHERE e.stat_id IS NULL OR a.stat_id IS NULL
            OR float8send(e.best_value) IS DISTINCT FROM float8send(a.best_value)
            OR e.metadata IS DISTINCT FROM a.metadata
            OR float8send(e.avg) IS DISTINCT FROM float8send(a.avg)
        ) p CROSS JOIN LATERAL (VALUES
          ('missing_or_changed'::text,p.expected_row),
          ('unexpected_or_changed'::text,p.actual_row)
        ) d(direction,row) WHERE d.row IS NOT NULL UNION ALL SELECT 'mv_derivation'::text AS class,'missing_or_changed'::text AS direction,to_jsonb(p) AS row
      FROM ((SELECT discipline,stat_id,entity_id,encode(float8send(best_value),'hex') AS best_value_bits,
      encode(float8send(avg),'hex') AS avg_bits,metadata FROM (
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
 THEN -1.0 ELSE 1.0 END DESC,e.match_id DESC,e.workspace_member_id ASC) rn FROM eligible e
), best AS (
 SELECT r.discipline,r.entity_id,r.stat_id,r.value best_value,m.encounter_id,mp.name map_name,
 mp.image_path map_image_path,t.name tournament_name,u.name username
 FROM ranked r JOIN stats.match m ON m.id=r.match_id
 JOIN catalog.entity mp ON mp.id=m.map_entity_id AND mp.kind='map' AND mp.discipline=m.discipline
 JOIN encounter.encounter enc ON enc.id=m.encounter_id AND enc.workspace_id=m.workspace_id AND enc.discipline=m.discipline
 JOIN tournament.tournament t ON t.id=enc.tournament_id
 JOIN workspace_member wm ON wm.id=r.workspace_member_id AND wm.workspace_id=m.workspace_id
 JOIN players."user" u ON u.id=wm.player_id WHERE r.rn=1
)
SELECT a.discipline,a.stat_id,a.entity_id,b.best_value,(a.sum_value/nullif(a.sum_time,0))*600 AS avg,
 jsonb_build_object('encounter_id',b.encounter_id,'map_name',b.map_name,'map_image_path',b.map_image_path,
 'tournament_name',b.tournament_name,'username',b.username) AS metadata
FROM agg a JOIN best b ON b.discipline=a.discipline AND b.entity_id=a.entity_id AND b.stat_id=a.stat_id
) p) EXCEPT ALL (SELECT discipline,stat_id,entity_id,encode(float8send(best_value),'hex') AS best_value_bits,
      encode(float8send(avg),'hex') AS avg_bits,metadata FROM (SELECT discipline,stat_id,entity_id,best_value,avg,metadata FROM stats.mv_entity_global_stats) p)) p
      UNION ALL SELECT 'mv_derivation'::text,'unexpected_or_changed'::text,to_jsonb(p)
      FROM ((SELECT discipline,stat_id,entity_id,encode(float8send(best_value),'hex') AS best_value_bits,
      encode(float8send(avg),'hex') AS avg_bits,metadata FROM (SELECT discipline,stat_id,entity_id,best_value,avg,metadata FROM stats.mv_entity_global_stats) p) EXCEPT ALL (SELECT discipline,stat_id,entity_id,encode(float8send(best_value),'hex') AS best_value_bits,
      encode(float8send(avg),'hex') AS avg_bits,metadata FROM (
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
 THEN -1.0 ELSE 1.0 END DESC,e.match_id DESC,e.workspace_member_id ASC) rn FROM eligible e
), best AS (
 SELECT r.discipline,r.entity_id,r.stat_id,r.value best_value,m.encounter_id,mp.name map_name,
 mp.image_path map_image_path,t.name tournament_name,u.name username
 FROM ranked r JOIN stats.match m ON m.id=r.match_id
 JOIN catalog.entity mp ON mp.id=m.map_entity_id AND mp.kind='map' AND mp.discipline=m.discipline
 JOIN encounter.encounter enc ON enc.id=m.encounter_id AND enc.workspace_id=m.workspace_id AND enc.discipline=m.discipline
 JOIN tournament.tournament t ON t.id=enc.tournament_id
 JOIN workspace_member wm ON wm.id=r.workspace_member_id AND wm.workspace_id=m.workspace_id
 JOIN players."user" u ON u.id=wm.player_id WHERE r.rn=1
)
SELECT a.discipline,a.stat_id,a.entity_id,b.best_value,(a.sum_value/nullif(a.sum_time,0))*600 AS avg,
 jsonb_build_object('encounter_id',b.encounter_id,'map_name',b.map_name,'map_image_path',b.map_image_path,
 'tournament_name',b.tournament_name,'username',b.username) AS metadata
FROM agg a JOIN best b ON b.discipline=a.discipline AND b.entity_id=a.entity_id AND b.stat_id=a.stat_id
) p)) p UNION ALL SELECT 'external_constraints'::text AS class,'missing_or_changed'::text AS direction,to_jsonb(p) AS row
      FROM ((SELECT * FROM (VALUES
 ('achievements.evaluation_result','match_id','stats.match','c',true,true),
 ('achievements.override','match_id','stats.match','c',true,true),
 ('catalog.alias_miss','last_ingest_job_id','stats.ingest_job','n',true,true)
) v(relation,column_name,target,delete_action,condeferrable,condeferred)) EXCEPT ALL (
SELECT c.conrelid::regclass::text AS relation,a.attname::text AS column_name,
 c.confrelid::regclass::text AS target,c.confdeltype::text AS delete_action,c.condeferrable,c.condeferred
FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND c.conkey=ARRAY[a.attnum]
WHERE c.contype='f' AND ((c.conrelid IN ('achievements.evaluation_result'::regclass,'achievements.override'::regclass)
 AND a.attname='match_id') OR (c.conrelid='catalog.alias_miss'::regclass AND a.attname='last_ingest_job_id'))
)) p
      UNION ALL SELECT 'external_constraints'::text,'unexpected_or_changed'::text,to_jsonb(p)
      FROM ((
SELECT c.conrelid::regclass::text AS relation,a.attname::text AS column_name,
 c.confrelid::regclass::text AS target,c.confdeltype::text AS delete_action,c.condeferrable,c.condeferred
FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND c.conkey=ARRAY[a.attnum]
WHERE c.contype='f' AND ((c.conrelid IN ('achievements.evaluation_result'::regclass,'achievements.override'::regclass)
 AND a.attname='match_id') OR (c.conrelid='catalog.alias_miss'::regclass AND a.attname='last_ingest_job_id'))
) EXCEPT ALL (SELECT * FROM (VALUES
 ('achievements.evaluation_result','match_id','stats.match','c',true,true),
 ('achievements.override','match_id','stats.match','c',true,true),
 ('catalog.alias_miss','last_ingest_job_id','stats.ingest_job','n',true,true)
) v(relation,column_name,target,delete_action,condeferrable,condeferred))) p UNION ALL SELECT 'oracle_integrity'::text AS class,'missing_or_changed'::text AS direction,to_jsonb(p) AS row
      FROM ((SELECT NULL::text AS reason WHERE false) EXCEPT ALL (
 WITH required(class) AS (VALUES ('channel'),
('alias_ref'),
('evaluation_ref'),
('override_ref'),
('rule_dependency'),
('outbox_dependency')),
 chunk_actual AS (
   SELECT c.id,c.class,c.chunk,count(r.id) AS count,
    encode(sha256(convert_to(coalesce(string_agg(r.key::text||':'||r.sha256,E'\n' ORDER BY r.key),''),'UTF8')),'hex') AS sha256
   FROM stats01_oracle_chunks c LEFT JOIN stats01_oracle_rows r ON r.id=c.id GROUP BY c.id,c.class,c.chunk
 ), class_actual AS (
   SELECT class,count(*) AS chunks,sum(count) AS count,
    encode(sha256(convert_to(string_agg(sha256,E'\n' ORDER BY chunk),'UTF8')),'hex') AS sha256
   FROM chunk_actual GROUP BY class
 )
 SELECT 'manifest_count'::text AS reason WHERE (SELECT count(*) FROM stats01_oracle_records WHERE p->>'kind'='manifest')<>1
 UNION ALL SELECT 'invalid_record' FROM stats01_oracle_records
  WHERE p IS NULL OR p->>'version' IS DISTINCT FROM '1' OR p->>'kind' IS NULL OR p->>'kind' NOT IN ('chunk','manifest')
    OR (p->>'kind'='manifest' AND jsonb_typeof(p->'classes') IS DISTINCT FROM 'array')
    OR (p->>'kind'='chunk' AND (jsonb_typeof(p->'rows') IS DISTINCT FROM 'array' OR
        p->>'sha256' IS NULL OR p->>'sha256' !~ '^[0-9a-f]{64}$'))
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
      OR jsonb_typeof(key->0) IS DISTINCT FROM 'number' OR sha256 IS NULL OR sha256 !~ '^[0-9a-f]{64}$'
 UNION ALL SELECT 'duplicate_owner:'||class FROM stats01_oracle_rows GROUP BY class,key HAVING count(*)<>1
 UNION ALL SELECT 'unordered_chunk:'||id FROM (
   SELECT id,key,lag(key) OVER(PARTITION BY id ORDER BY ordinality) previous FROM stats01_oracle_rows
 ) r WHERE previous>=key
 UNION ALL SELECT 'manifest_digest_or_count:'||m.class FROM stats01_oracle_manifest m
 LEFT JOIN class_actual a ON a.class=m.class
 WHERE m.count IS DISTINCT FROM coalesce(a.count,0) OR m.chunks IS DISTINCT FROM coalesce(a.chunks,0)
   OR m.sha256 IS DISTINCT FROM coalesce(a.sha256,encode(sha256(''::bytea),'hex'))
)) p
      UNION ALL SELECT 'oracle_integrity'::text,'unexpected_or_changed'::text,to_jsonb(p)
      FROM ((
 WITH required(class) AS (VALUES ('channel'),
('alias_ref'),
('evaluation_ref'),
('override_ref'),
('rule_dependency'),
('outbox_dependency')),
 chunk_actual AS (
   SELECT c.id,c.class,c.chunk,count(r.id) AS count,
    encode(sha256(convert_to(coalesce(string_agg(r.key::text||':'||r.sha256,E'\n' ORDER BY r.key),''),'UTF8')),'hex') AS sha256
   FROM stats01_oracle_chunks c LEFT JOIN stats01_oracle_rows r ON r.id=c.id GROUP BY c.id,c.class,c.chunk
 ), class_actual AS (
   SELECT class,count(*) AS chunks,sum(count) AS count,
    encode(sha256(convert_to(string_agg(sha256,E'\n' ORDER BY chunk),'UTF8')),'hex') AS sha256
   FROM chunk_actual GROUP BY class
 )
 SELECT 'manifest_count'::text AS reason WHERE (SELECT count(*) FROM stats01_oracle_records WHERE p->>'kind'='manifest')<>1
 UNION ALL SELECT 'invalid_record' FROM stats01_oracle_records
  WHERE p IS NULL OR p->>'version' IS DISTINCT FROM '1' OR p->>'kind' IS NULL OR p->>'kind' NOT IN ('chunk','manifest')
    OR (p->>'kind'='manifest' AND jsonb_typeof(p->'classes') IS DISTINCT FROM 'array')
    OR (p->>'kind'='chunk' AND (jsonb_typeof(p->'rows') IS DISTINCT FROM 'array' OR
        p->>'sha256' IS NULL OR p->>'sha256' !~ '^[0-9a-f]{64}$'))
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
      OR jsonb_typeof(key->0) IS DISTINCT FROM 'number' OR sha256 IS NULL OR sha256 !~ '^[0-9a-f]{64}$'
 UNION ALL SELECT 'duplicate_owner:'||class FROM stats01_oracle_rows GROUP BY class,key HAVING count(*)<>1
 UNION ALL SELECT 'unordered_chunk:'||id FROM (
   SELECT id,key,lag(key) OVER(PARTITION BY id ORDER BY ordinality) previous FROM stats01_oracle_rows
 ) r WHERE previous>=key
 UNION ALL SELECT 'manifest_digest_or_count:'||m.class FROM stats01_oracle_manifest m
 LEFT JOIN class_actual a ON a.class=m.class
 WHERE m.count IS DISTINCT FROM coalesce(a.count,0) OR m.chunks IS DISTINCT FROM coalesce(a.chunks,0)
   OR m.sha256 IS DISTINCT FROM coalesce(a.sha256,encode(sha256(''::bytea),'hex'))
) EXCEPT ALL (SELECT NULL::text AS reason WHERE false)) p UNION ALL SELECT 'channel'::text AS class,'missing_or_changed'::text AS direction,to_jsonb(p) AS row
      FROM ((SELECT key,sha256 FROM stats01_oracle_rows WHERE class='channel') EXCEPT ALL (SELECT jsonb_build_array(id) AS key,
      encode(sha256(convert_to(jsonb_build_array(id,created_at,updated_at,tournament_id,channel_id,channel_name,is_active)::text,'UTF8')),'hex') AS sha256
      FROM stats.discord_channel WHERE true)) p
      UNION ALL SELECT 'channel'::text,'unexpected_or_changed'::text,to_jsonb(p)
      FROM ((SELECT jsonb_build_array(id) AS key,
      encode(sha256(convert_to(jsonb_build_array(id,created_at,updated_at,tournament_id,channel_id,channel_name,is_active)::text,'UTF8')),'hex') AS sha256
      FROM stats.discord_channel WHERE true) EXCEPT ALL (SELECT key,sha256 FROM stats01_oracle_rows WHERE class='channel')) p UNION ALL SELECT 'alias_ref'::text AS class,'missing_or_changed'::text AS direction,to_jsonb(p) AS row
      FROM ((SELECT key,sha256 FROM stats01_oracle_rows WHERE class='alias_ref') EXCEPT ALL (SELECT jsonb_build_array(id) AS key,
      encode(sha256(convert_to(jsonb_build_array(id,last_ingest_job_id)::text,'UTF8')),'hex') AS sha256
      FROM catalog.alias_miss WHERE true)) p
      UNION ALL SELECT 'alias_ref'::text,'unexpected_or_changed'::text,to_jsonb(p)
      FROM ((SELECT jsonb_build_array(id) AS key,
      encode(sha256(convert_to(jsonb_build_array(id,last_ingest_job_id)::text,'UTF8')),'hex') AS sha256
      FROM catalog.alias_miss WHERE true) EXCEPT ALL (SELECT key,sha256 FROM stats01_oracle_rows WHERE class='alias_ref')) p UNION ALL SELECT 'evaluation_ref'::text AS class,'missing_or_changed'::text AS direction,to_jsonb(p) AS row
      FROM ((SELECT key,sha256 FROM stats01_oracle_rows WHERE class='evaluation_ref') EXCEPT ALL (SELECT jsonb_build_array(id) AS key,
      encode(sha256(convert_to(jsonb_build_array(id,match_id)::text,'UTF8')),'hex') AS sha256
      FROM achievements.evaluation_result WHERE true)) p
      UNION ALL SELECT 'evaluation_ref'::text,'unexpected_or_changed'::text,to_jsonb(p)
      FROM ((SELECT jsonb_build_array(id) AS key,
      encode(sha256(convert_to(jsonb_build_array(id,match_id)::text,'UTF8')),'hex') AS sha256
      FROM achievements.evaluation_result WHERE true) EXCEPT ALL (SELECT key,sha256 FROM stats01_oracle_rows WHERE class='evaluation_ref')) p UNION ALL SELECT 'override_ref'::text AS class,'missing_or_changed'::text AS direction,to_jsonb(p) AS row
      FROM ((SELECT key,sha256 FROM stats01_oracle_rows WHERE class='override_ref') EXCEPT ALL (SELECT jsonb_build_array(id) AS key,
      encode(sha256(convert_to(jsonb_build_array(id,match_id)::text,'UTF8')),'hex') AS sha256
      FROM achievements.override WHERE true)) p
      UNION ALL SELECT 'override_ref'::text,'unexpected_or_changed'::text,to_jsonb(p)
      FROM ((SELECT jsonb_build_array(id) AS key,
      encode(sha256(convert_to(jsonb_build_array(id,match_id)::text,'UTF8')),'hex') AS sha256
      FROM achievements.override WHERE true) EXCEPT ALL (SELECT key,sha256 FROM stats01_oracle_rows WHERE class='override_ref')) p UNION ALL SELECT 'rule_dependency'::text AS class,'missing_or_changed'::text AS direction,to_jsonb(p) AS row
      FROM ((SELECT key,sha256 FROM stats01_oracle_rows WHERE class='rule_dependency') EXCEPT ALL (SELECT jsonb_build_array(id) AS key,
      encode(sha256(convert_to(jsonb_build_array(id,depends_on::jsonb)::text,'UTF8')),'hex') AS sha256
      FROM achievements.rule WHERE true)) p
      UNION ALL SELECT 'rule_dependency'::text,'unexpected_or_changed'::text,to_jsonb(p)
      FROM ((SELECT jsonb_build_array(id) AS key,
      encode(sha256(convert_to(jsonb_build_array(id,depends_on::jsonb)::text,'UTF8')),'hex') AS sha256
      FROM achievements.rule WHERE true) EXCEPT ALL (SELECT key,sha256 FROM stats01_oracle_rows WHERE class='rule_dependency')) p UNION ALL SELECT 'outbox_dependency'::text AS class,'missing_or_changed'::text AS direction,to_jsonb(p) AS row
      FROM ((SELECT key,sha256 FROM stats01_oracle_rows WHERE class='outbox_dependency') EXCEPT ALL (SELECT jsonb_build_array(id) AS key,
      encode(sha256(convert_to(jsonb_build_array(id,o.payload_json::jsonb->'changed_tables')::text,'UTF8')),'hex') AS sha256
      FROM event_outbox o WHERE (o.event_type='achievement_evaluate' OR o.payload_json::jsonb->>'event_type'='achievement_evaluate')
 AND o.status IN ('pending','failed'))) p
      UNION ALL SELECT 'outbox_dependency'::text,'unexpected_or_changed'::text,to_jsonb(p)
      FROM ((SELECT jsonb_build_array(id) AS key,
      encode(sha256(convert_to(jsonb_build_array(id,o.payload_json::jsonb->'changed_tables')::text,'UTF8')),'hex') AS sha256
      FROM event_outbox o WHERE (o.event_type='achievement_evaluate' OR o.payload_json::jsonb->>'event_type'='achievement_evaluate')
 AND o.status IN ('pending','failed')) EXCEPT ALL (SELECT key,sha256 FROM stats01_oracle_rows WHERE class='outbox_dependency')) p UNION ALL SELECT 'source_cardinality'::text AS class,'missing_or_changed'::text AS direction,to_jsonb(p) AS row
      FROM ((SELECT 'jobs'::text AS relation,(SELECT (SELECT count(*) FROM log_processing.record)+(SELECT count(*) FROM matches.match WHERE log_record_id IS NULL AND log_name IS NOT NULL)) AS count UNION ALL SELECT 'matches'::text AS relation,(SELECT count(*) FROM matches.match) AS count UNION ALL SELECT 'teams'::text AS relation,(SELECT 2*count(*) FROM matches.match) AS count UNION ALL SELECT 'players'::text AS relation,(SELECT count(*) FROM (SELECT DISTINCT match_id,user_id,team_id FROM stats01_endpoints WHERE user_id IS NOT NULL) p) AS count UNION ALL SELECT 'facts'::text AS relation,(SELECT count(*) FROM matches.statistics) AS count UNION ALL SELECT 'events'::text AS relation,(SELECT (SELECT count(*) FROM matches.kill_feed)+(SELECT count(*) FROM matches.event)) AS count UNION ALL SELECT 'baselines'::text AS relation,(SELECT count(*) FROM matches.stat_baselines) AS count) EXCEPT ALL (SELECT 'jobs'::text AS relation,count(*) AS count FROM (SELECT r.id,r.created_at,r.updated_at,t.workspace_id,t.discipline,
 r.source::text AS source_kind,'legacy:log_processing.record:'||r.id::text AS external_id,
 r.content_hash::char(64),'unverified'::varchar AS raw_status,r.filename,('logs/'||r.tournament_id::text||'/')||(CASE WHEN starts_with((CASE WHEN starts_with(r.filename,('logs/'||r.tournament_id::text||'/')) THEN substr(r.filename,length(('logs/'||r.tournament_id::text||'/'))+1) ELSE r.filename END),'logs/') THEN substr((CASE WHEN starts_with(r.filename,('logs/'||r.tournament_id::text||'/')) THEN substr(r.filename,length(('logs/'||r.tournament_id::text||'/'))+1) ELSE r.filename END),6) ELSE (CASE WHEN starts_with(r.filename,('logs/'||r.tournament_id::text||'/')) THEN substr(r.filename,length(('logs/'||r.tournament_id::text||'/'))+1) ELSE r.filename END) END) AS raw_ref,NULL::varchar(512) AS document_ref,
 r.status::text AS status,r.attempts,r.error_message,r.uploader_id AS uploader_user_id,
 NULL::bigint AS api_key_id,r.tournament_id AS hint_tournament_id,
 r.attached_encounter_id AS hint_encounter_id,NULL::bigint AS hint_encounter_game_id,r.started_at,r.finished_at
 FROM log_processing.record r JOIN tournament.tournament t ON t.id=r.tournament_id UNION ALL SELECT id,created_at,updated_at,workspace_id,discipline,source_kind,external_id,content_hash,raw_status,filename,raw_ref,document_ref,status,attempts,error_message,uploader_user_id,api_key_id,hint_tournament_id,hint_encounter_id,hint_encounter_game_id,started_at,finished_at FROM (SELECT
 h.id,
 (SELECT min(created_at) FROM audit_log WHERE action='stats.initial_transfer') AS created_at,
 NULL::timestamptz AS updated_at,x.workspace_id,x.discipline,'historical_reference'::varchar AS source_kind,
 'legacy:matches.match:'||m.id::text AS external_id,NULL::char(64) AS content_hash,
 'unverified'::varchar AS raw_status,m.log_name AS filename,('logs/'||x.tournament_id::text||'/')||(CASE WHEN starts_with((CASE WHEN starts_with(m.log_name,('logs/'||x.tournament_id::text||'/')) THEN substr(m.log_name,length(('logs/'||x.tournament_id::text||'/'))+1) ELSE m.log_name END),'logs/') THEN substr((CASE WHEN starts_with(m.log_name,('logs/'||x.tournament_id::text||'/')) THEN substr(m.log_name,length(('logs/'||x.tournament_id::text||'/'))+1) ELSE m.log_name END),6) ELSE (CASE WHEN starts_with(m.log_name,('logs/'||x.tournament_id::text||'/')) THEN substr(m.log_name,length(('logs/'||x.tournament_id::text||'/'))+1) ELSE m.log_name END) END) AS raw_ref,
 NULL::varchar(512) AS document_ref,'done'::varchar AS status,0 AS attempts,NULL::text AS error_message,
 NULL::bigint AS uploader_user_id,NULL::bigint AS api_key_id,x.tournament_id AS hint_tournament_id,
 x.encounter_id AS hint_encounter_id,NULL::bigint AS hint_encounter_game_id,
 NULL::timestamptz AS started_at,NULL::timestamptz AS finished_at,m.id AS source_match_id
 FROM matches.match m JOIN stats01_match x ON x.match_id=m.id
 JOIN stats01_historical_reference h ON h.source_match_id=m.id
 WHERE m.log_record_id IS NULL AND m.log_name IS NOT NULL) h) p UNION ALL SELECT 'matches'::text AS relation,count(*) AS count FROM (SELECT m.id,m.created_at,m.updated_at,x.workspace_id,x.discipline,
 x.encounter_id,m.map_index AS source_map_index,x.game_id AS encounter_game_id,
 coalesce(m.log_record_id,h.id) AS ingest_job_id,1 AS revision,NULL::timestamptz AS played_at,m.time AS duration_s,
 m.map_id AS map_entity_id,'map'::varchar AS map_kind FROM matches.match m JOIN stats01_match x ON x.match_id=m.id
 LEFT JOIN (SELECT
 h.id,
 (SELECT min(created_at) FROM audit_log WHERE action='stats.initial_transfer') AS created_at,
 NULL::timestamptz AS updated_at,x.workspace_id,x.discipline,'historical_reference'::varchar AS source_kind,
 'legacy:matches.match:'||m.id::text AS external_id,NULL::char(64) AS content_hash,
 'unverified'::varchar AS raw_status,m.log_name AS filename,('logs/'||x.tournament_id::text||'/')||(CASE WHEN starts_with((CASE WHEN starts_with(m.log_name,('logs/'||x.tournament_id::text||'/')) THEN substr(m.log_name,length(('logs/'||x.tournament_id::text||'/'))+1) ELSE m.log_name END),'logs/') THEN substr((CASE WHEN starts_with(m.log_name,('logs/'||x.tournament_id::text||'/')) THEN substr(m.log_name,length(('logs/'||x.tournament_id::text||'/'))+1) ELSE m.log_name END),6) ELSE (CASE WHEN starts_with(m.log_name,('logs/'||x.tournament_id::text||'/')) THEN substr(m.log_name,length(('logs/'||x.tournament_id::text||'/'))+1) ELSE m.log_name END) END) AS raw_ref,
 NULL::varchar(512) AS document_ref,'done'::varchar AS status,0 AS attempts,NULL::text AS error_message,
 NULL::bigint AS uploader_user_id,NULL::bigint AS api_key_id,x.tournament_id AS hint_tournament_id,
 x.encounter_id AS hint_encounter_id,NULL::bigint AS hint_encounter_game_id,
 NULL::timestamptz AS started_at,NULL::timestamptz AS finished_at,m.id AS source_match_id
 FROM matches.match m JOIN stats01_match x ON x.match_id=m.id
 JOIN stats01_historical_reference h ON h.source_match_id=m.id
 WHERE m.log_record_id IS NULL AND m.log_name IS NOT NULL) h ON h.source_match_id=m.id) p UNION ALL SELECT 'teams'::text AS relation,count(*) AS count FROM (SELECT m.id AS match_id,x.encounter_id,t.encounter_team_id,s.position AS source_position
 FROM matches.match m JOIN stats01_match x ON x.match_id=m.id
 CROSS JOIN LATERAL (VALUES(m.home_team_id,1),(m.away_team_id,2)) s(team_id,position)
 JOIN stats01_team t ON t.match_id=m.id AND t.team_id=s.team_id) p UNION ALL SELECT 'players'::text AS relation,count(*) AS count FROM (SELECT DISTINCT p.match_id,t.encounter_team_id,w.id AS workspace_member_id,
 h.handle_snapshot,NULL::bigint AS observed_role_id
 FROM stats01_endpoints p JOIN stats01_match x ON x.match_id=p.match_id
 JOIN stats01_team t ON t.match_id=p.match_id AND t.team_id=p.team_id
 JOIN stats01_member w ON w.workspace_id=x.workspace_id AND w.player_id=p.user_id
 JOIN stats01_handles h ON h.match_id=p.match_id AND h.player_id=p.user_id AND h.team_id=p.team_id
 WHERE p.user_id IS NOT NULL) p UNION ALL SELECT 'facts'::text AS relation,count(*) AS count FROM (SELECT s.match_id,s.round::smallint AS segment,t.encounter_team_id,
 w.id AS workspace_member_id,s.hero_id AS entity_id,'character'::varchar AS entity_kind,d.id AS stat_id,s.value
 FROM matches.statistics s JOIN stats01_match x ON x.match_id=s.match_id
 JOIN stats01_team t ON t.match_id=s.match_id AND t.team_id=s.team_id
 JOIN stats01_member w ON w.workspace_id=x.workspace_id AND w.player_id=s.user_id
 JOIN stats01_stat_ids d ON d.discipline=x.discipline AND d.legacy_name::logstatsname=s.name) p UNION ALL SELECT 'events'::text AS relation,count(*) AS count FROM (SELECT match_id,segment,t,type_id,actor_member_id,actor_team_id,target_member_id,target_team_id,entity_id,related_entity_id,entity_kind,data FROM (SELECT k.match_id,k.round::smallint AS segment,k.time AS t,d.id AS type_id,
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
 LEFT JOIN stats01_ability_values a ON a.legacy_name=k.ability::text) k UNION ALL SELECT match_id,segment,t,type_id,actor_member_id,actor_team_id,target_member_id,target_team_id,entity_id,related_entity_id,entity_kind,data FROM (SELECT e.match_id,e.round::smallint AS segment,e.time AS t,d.id AS type_id,
 aw.id AS actor_member_id,at.encounter_team_id AS actor_team_id,tw.id AS target_member_id,
 tt.encounter_team_id AS target_team_id,e.hero_id AS entity_id,e.related_hero_id AS related_entity_id,
 'character'::varchar AS entity_kind,NULL::jsonb AS data,e.id AS source_id
 FROM matches.event e JOIN stats01_match x ON x.match_id=e.match_id
 JOIN stats01_event_ids d ON d.discipline=x.discipline AND d.legacy_name=e.name::text
 LEFT JOIN stats01_team at ON at.match_id=e.match_id AND at.team_id=e.team_id
 LEFT JOIN stats01_team tt ON tt.match_id=e.match_id AND tt.team_id=e.related_team_id
 LEFT JOIN stats01_member aw ON aw.workspace_id=x.workspace_id AND aw.player_id=e.user_id
 LEFT JOIN stats01_member tw ON tw.workspace_id=x.workspace_id AND tw.player_id=e.related_user_id) e) p UNION ALL SELECT 'baselines'::text AS relation,count(*) AS count FROM (SELECT b.id,b.formula_version,r.id AS role_id,b.rank_bucket,d.id AS stat_id,b.mean,b.std,b.meta,b.computed_at
 FROM matches.stat_baselines b JOIN stats01_roles r ON r.code=lower(b.role::text)
 JOIN stats01_stat_ids d ON d.discipline='overwatch' AND d.legacy_name=b.stat::text) p)) p
      UNION ALL SELECT 'source_cardinality'::text,'unexpected_or_changed'::text,to_jsonb(p)
      FROM ((SELECT 'jobs'::text AS relation,count(*) AS count FROM (SELECT r.id,r.created_at,r.updated_at,t.workspace_id,t.discipline,
 r.source::text AS source_kind,'legacy:log_processing.record:'||r.id::text AS external_id,
 r.content_hash::char(64),'unverified'::varchar AS raw_status,r.filename,('logs/'||r.tournament_id::text||'/')||(CASE WHEN starts_with((CASE WHEN starts_with(r.filename,('logs/'||r.tournament_id::text||'/')) THEN substr(r.filename,length(('logs/'||r.tournament_id::text||'/'))+1) ELSE r.filename END),'logs/') THEN substr((CASE WHEN starts_with(r.filename,('logs/'||r.tournament_id::text||'/')) THEN substr(r.filename,length(('logs/'||r.tournament_id::text||'/'))+1) ELSE r.filename END),6) ELSE (CASE WHEN starts_with(r.filename,('logs/'||r.tournament_id::text||'/')) THEN substr(r.filename,length(('logs/'||r.tournament_id::text||'/'))+1) ELSE r.filename END) END) AS raw_ref,NULL::varchar(512) AS document_ref,
 r.status::text AS status,r.attempts,r.error_message,r.uploader_id AS uploader_user_id,
 NULL::bigint AS api_key_id,r.tournament_id AS hint_tournament_id,
 r.attached_encounter_id AS hint_encounter_id,NULL::bigint AS hint_encounter_game_id,r.started_at,r.finished_at
 FROM log_processing.record r JOIN tournament.tournament t ON t.id=r.tournament_id UNION ALL SELECT id,created_at,updated_at,workspace_id,discipline,source_kind,external_id,content_hash,raw_status,filename,raw_ref,document_ref,status,attempts,error_message,uploader_user_id,api_key_id,hint_tournament_id,hint_encounter_id,hint_encounter_game_id,started_at,finished_at FROM (SELECT
 h.id,
 (SELECT min(created_at) FROM audit_log WHERE action='stats.initial_transfer') AS created_at,
 NULL::timestamptz AS updated_at,x.workspace_id,x.discipline,'historical_reference'::varchar AS source_kind,
 'legacy:matches.match:'||m.id::text AS external_id,NULL::char(64) AS content_hash,
 'unverified'::varchar AS raw_status,m.log_name AS filename,('logs/'||x.tournament_id::text||'/')||(CASE WHEN starts_with((CASE WHEN starts_with(m.log_name,('logs/'||x.tournament_id::text||'/')) THEN substr(m.log_name,length(('logs/'||x.tournament_id::text||'/'))+1) ELSE m.log_name END),'logs/') THEN substr((CASE WHEN starts_with(m.log_name,('logs/'||x.tournament_id::text||'/')) THEN substr(m.log_name,length(('logs/'||x.tournament_id::text||'/'))+1) ELSE m.log_name END),6) ELSE (CASE WHEN starts_with(m.log_name,('logs/'||x.tournament_id::text||'/')) THEN substr(m.log_name,length(('logs/'||x.tournament_id::text||'/'))+1) ELSE m.log_name END) END) AS raw_ref,
 NULL::varchar(512) AS document_ref,'done'::varchar AS status,0 AS attempts,NULL::text AS error_message,
 NULL::bigint AS uploader_user_id,NULL::bigint AS api_key_id,x.tournament_id AS hint_tournament_id,
 x.encounter_id AS hint_encounter_id,NULL::bigint AS hint_encounter_game_id,
 NULL::timestamptz AS started_at,NULL::timestamptz AS finished_at,m.id AS source_match_id
 FROM matches.match m JOIN stats01_match x ON x.match_id=m.id
 JOIN stats01_historical_reference h ON h.source_match_id=m.id
 WHERE m.log_record_id IS NULL AND m.log_name IS NOT NULL) h) p UNION ALL SELECT 'matches'::text AS relation,count(*) AS count FROM (SELECT m.id,m.created_at,m.updated_at,x.workspace_id,x.discipline,
 x.encounter_id,m.map_index AS source_map_index,x.game_id AS encounter_game_id,
 coalesce(m.log_record_id,h.id) AS ingest_job_id,1 AS revision,NULL::timestamptz AS played_at,m.time AS duration_s,
 m.map_id AS map_entity_id,'map'::varchar AS map_kind FROM matches.match m JOIN stats01_match x ON x.match_id=m.id
 LEFT JOIN (SELECT
 h.id,
 (SELECT min(created_at) FROM audit_log WHERE action='stats.initial_transfer') AS created_at,
 NULL::timestamptz AS updated_at,x.workspace_id,x.discipline,'historical_reference'::varchar AS source_kind,
 'legacy:matches.match:'||m.id::text AS external_id,NULL::char(64) AS content_hash,
 'unverified'::varchar AS raw_status,m.log_name AS filename,('logs/'||x.tournament_id::text||'/')||(CASE WHEN starts_with((CASE WHEN starts_with(m.log_name,('logs/'||x.tournament_id::text||'/')) THEN substr(m.log_name,length(('logs/'||x.tournament_id::text||'/'))+1) ELSE m.log_name END),'logs/') THEN substr((CASE WHEN starts_with(m.log_name,('logs/'||x.tournament_id::text||'/')) THEN substr(m.log_name,length(('logs/'||x.tournament_id::text||'/'))+1) ELSE m.log_name END),6) ELSE (CASE WHEN starts_with(m.log_name,('logs/'||x.tournament_id::text||'/')) THEN substr(m.log_name,length(('logs/'||x.tournament_id::text||'/'))+1) ELSE m.log_name END) END) AS raw_ref,
 NULL::varchar(512) AS document_ref,'done'::varchar AS status,0 AS attempts,NULL::text AS error_message,
 NULL::bigint AS uploader_user_id,NULL::bigint AS api_key_id,x.tournament_id AS hint_tournament_id,
 x.encounter_id AS hint_encounter_id,NULL::bigint AS hint_encounter_game_id,
 NULL::timestamptz AS started_at,NULL::timestamptz AS finished_at,m.id AS source_match_id
 FROM matches.match m JOIN stats01_match x ON x.match_id=m.id
 JOIN stats01_historical_reference h ON h.source_match_id=m.id
 WHERE m.log_record_id IS NULL AND m.log_name IS NOT NULL) h ON h.source_match_id=m.id) p UNION ALL SELECT 'teams'::text AS relation,count(*) AS count FROM (SELECT m.id AS match_id,x.encounter_id,t.encounter_team_id,s.position AS source_position
 FROM matches.match m JOIN stats01_match x ON x.match_id=m.id
 CROSS JOIN LATERAL (VALUES(m.home_team_id,1),(m.away_team_id,2)) s(team_id,position)
 JOIN stats01_team t ON t.match_id=m.id AND t.team_id=s.team_id) p UNION ALL SELECT 'players'::text AS relation,count(*) AS count FROM (SELECT DISTINCT p.match_id,t.encounter_team_id,w.id AS workspace_member_id,
 h.handle_snapshot,NULL::bigint AS observed_role_id
 FROM stats01_endpoints p JOIN stats01_match x ON x.match_id=p.match_id
 JOIN stats01_team t ON t.match_id=p.match_id AND t.team_id=p.team_id
 JOIN stats01_member w ON w.workspace_id=x.workspace_id AND w.player_id=p.user_id
 JOIN stats01_handles h ON h.match_id=p.match_id AND h.player_id=p.user_id AND h.team_id=p.team_id
 WHERE p.user_id IS NOT NULL) p UNION ALL SELECT 'facts'::text AS relation,count(*) AS count FROM (SELECT s.match_id,s.round::smallint AS segment,t.encounter_team_id,
 w.id AS workspace_member_id,s.hero_id AS entity_id,'character'::varchar AS entity_kind,d.id AS stat_id,s.value
 FROM matches.statistics s JOIN stats01_match x ON x.match_id=s.match_id
 JOIN stats01_team t ON t.match_id=s.match_id AND t.team_id=s.team_id
 JOIN stats01_member w ON w.workspace_id=x.workspace_id AND w.player_id=s.user_id
 JOIN stats01_stat_ids d ON d.discipline=x.discipline AND d.legacy_name::logstatsname=s.name) p UNION ALL SELECT 'events'::text AS relation,count(*) AS count FROM (SELECT match_id,segment,t,type_id,actor_member_id,actor_team_id,target_member_id,target_team_id,entity_id,related_entity_id,entity_kind,data FROM (SELECT k.match_id,k.round::smallint AS segment,k.time AS t,d.id AS type_id,
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
 LEFT JOIN stats01_ability_values a ON a.legacy_name=k.ability::text) k UNION ALL SELECT match_id,segment,t,type_id,actor_member_id,actor_team_id,target_member_id,target_team_id,entity_id,related_entity_id,entity_kind,data FROM (SELECT e.match_id,e.round::smallint AS segment,e.time AS t,d.id AS type_id,
 aw.id AS actor_member_id,at.encounter_team_id AS actor_team_id,tw.id AS target_member_id,
 tt.encounter_team_id AS target_team_id,e.hero_id AS entity_id,e.related_hero_id AS related_entity_id,
 'character'::varchar AS entity_kind,NULL::jsonb AS data,e.id AS source_id
 FROM matches.event e JOIN stats01_match x ON x.match_id=e.match_id
 JOIN stats01_event_ids d ON d.discipline=x.discipline AND d.legacy_name=e.name::text
 LEFT JOIN stats01_team at ON at.match_id=e.match_id AND at.team_id=e.team_id
 LEFT JOIN stats01_team tt ON tt.match_id=e.match_id AND tt.team_id=e.related_team_id
 LEFT JOIN stats01_member aw ON aw.workspace_id=x.workspace_id AND aw.player_id=e.user_id
 LEFT JOIN stats01_member tw ON tw.workspace_id=x.workspace_id AND tw.player_id=e.related_user_id) e) p UNION ALL SELECT 'baselines'::text AS relation,count(*) AS count FROM (SELECT b.id,b.formula_version,r.id AS role_id,b.rank_bucket,d.id AS stat_id,b.mean,b.std,b.meta,b.computed_at
 FROM matches.stat_baselines b JOIN stats01_roles r ON r.code=lower(b.role::text)
 JOIN stats01_stat_ids d ON d.discipline='overwatch' AND d.legacy_name=b.stat::text) p) EXCEPT ALL (SELECT 'jobs'::text AS relation,(SELECT (SELECT count(*) FROM log_processing.record)+(SELECT count(*) FROM matches.match WHERE log_record_id IS NULL AND log_name IS NOT NULL)) AS count UNION ALL SELECT 'matches'::text AS relation,(SELECT count(*) FROM matches.match) AS count UNION ALL SELECT 'teams'::text AS relation,(SELECT 2*count(*) FROM matches.match) AS count UNION ALL SELECT 'players'::text AS relation,(SELECT count(*) FROM (SELECT DISTINCT match_id,user_id,team_id FROM stats01_endpoints WHERE user_id IS NOT NULL) p) AS count UNION ALL SELECT 'facts'::text AS relation,(SELECT count(*) FROM matches.statistics) AS count UNION ALL SELECT 'events'::text AS relation,(SELECT (SELECT count(*) FROM matches.kill_feed)+(SELECT count(*) FROM matches.event)) AS count UNION ALL SELECT 'baselines'::text AS relation,(SELECT count(*) FROM matches.stat_baselines) AS count)) p;

SELECT 'job_owners'::text AS class,(SELECT count(*) FROM (SELECT id FROM (SELECT r.id,r.created_at,r.updated_at,t.workspace_id,t.discipline,
 r.source::text AS source_kind,'legacy:log_processing.record:'||r.id::text AS external_id,
 r.content_hash::char(64),'unverified'::varchar AS raw_status,r.filename,('logs/'||r.tournament_id::text||'/')||(CASE WHEN starts_with((CASE WHEN starts_with(r.filename,('logs/'||r.tournament_id::text||'/')) THEN substr(r.filename,length(('logs/'||r.tournament_id::text||'/'))+1) ELSE r.filename END),'logs/') THEN substr((CASE WHEN starts_with(r.filename,('logs/'||r.tournament_id::text||'/')) THEN substr(r.filename,length(('logs/'||r.tournament_id::text||'/'))+1) ELSE r.filename END),6) ELSE (CASE WHEN starts_with(r.filename,('logs/'||r.tournament_id::text||'/')) THEN substr(r.filename,length(('logs/'||r.tournament_id::text||'/'))+1) ELSE r.filename END) END) AS raw_ref,NULL::varchar(512) AS document_ref,
 r.status::text AS status,r.attempts,r.error_message,r.uploader_id AS uploader_user_id,
 NULL::bigint AS api_key_id,r.tournament_id AS hint_tournament_id,
 r.attached_encounter_id AS hint_encounter_id,NULL::bigint AS hint_encounter_game_id,r.started_at,r.finished_at
 FROM log_processing.record r JOIN tournament.tournament t ON t.id=r.tournament_id UNION ALL SELECT id,created_at,updated_at,workspace_id,discipline,source_kind,external_id,content_hash,raw_status,filename,raw_ref,document_ref,status,attempts,error_message,uploader_user_id,api_key_id,hint_tournament_id,hint_encounter_id,hint_encounter_game_id,started_at,finished_at FROM (SELECT
 h.id,
 (SELECT min(created_at) FROM audit_log WHERE action='stats.initial_transfer') AS created_at,
 NULL::timestamptz AS updated_at,x.workspace_id,x.discipline,'historical_reference'::varchar AS source_kind,
 'legacy:matches.match:'||m.id::text AS external_id,NULL::char(64) AS content_hash,
 'unverified'::varchar AS raw_status,m.log_name AS filename,('logs/'||x.tournament_id::text||'/')||(CASE WHEN starts_with((CASE WHEN starts_with(m.log_name,('logs/'||x.tournament_id::text||'/')) THEN substr(m.log_name,length(('logs/'||x.tournament_id::text||'/'))+1) ELSE m.log_name END),'logs/') THEN substr((CASE WHEN starts_with(m.log_name,('logs/'||x.tournament_id::text||'/')) THEN substr(m.log_name,length(('logs/'||x.tournament_id::text||'/'))+1) ELSE m.log_name END),6) ELSE (CASE WHEN starts_with(m.log_name,('logs/'||x.tournament_id::text||'/')) THEN substr(m.log_name,length(('logs/'||x.tournament_id::text||'/'))+1) ELSE m.log_name END) END) AS raw_ref,
 NULL::varchar(512) AS document_ref,'done'::varchar AS status,0 AS attempts,NULL::text AS error_message,
 NULL::bigint AS uploader_user_id,NULL::bigint AS api_key_id,x.tournament_id AS hint_tournament_id,
 x.encounter_id AS hint_encounter_id,NULL::bigint AS hint_encounter_game_id,
 NULL::timestamptz AS started_at,NULL::timestamptz AS finished_at,m.id AS source_match_id
 FROM matches.match m JOIN stats01_match x ON x.match_id=m.id
 JOIN stats01_historical_reference h ON h.source_match_id=m.id
 WHERE m.log_record_id IS NULL AND m.log_name IS NOT NULL) h) j) p) AS legacy,
      (SELECT count(*) FROM (SELECT id FROM stats.ingest_job) p) AS migrated,
      CASE WHEN EXISTS(SELECT 1 FROM stats01_reconcile WHERE class='job_owners') THEN 'blocking' ELSE 'ok' END AS status UNION ALL SELECT 'match_owners'::text AS class,(SELECT count(*) FROM (SELECT id FROM matches.match) p) AS legacy,
      (SELECT count(*) FROM (SELECT id FROM stats.match) p) AS migrated,
      CASE WHEN EXISTS(SELECT 1 FROM stats01_reconcile WHERE class='match_owners') THEN 'blocking' ELSE 'ok' END AS status UNION ALL SELECT 'jobs'::text AS class,(SELECT count(*) FROM (SELECT r.id,r.created_at,r.updated_at,t.workspace_id,t.discipline,
 r.source::text AS source_kind,'legacy:log_processing.record:'||r.id::text AS external_id,
 r.content_hash::char(64),'unverified'::varchar AS raw_status,r.filename,('logs/'||r.tournament_id::text||'/')||(CASE WHEN starts_with((CASE WHEN starts_with(r.filename,('logs/'||r.tournament_id::text||'/')) THEN substr(r.filename,length(('logs/'||r.tournament_id::text||'/'))+1) ELSE r.filename END),'logs/') THEN substr((CASE WHEN starts_with(r.filename,('logs/'||r.tournament_id::text||'/')) THEN substr(r.filename,length(('logs/'||r.tournament_id::text||'/'))+1) ELSE r.filename END),6) ELSE (CASE WHEN starts_with(r.filename,('logs/'||r.tournament_id::text||'/')) THEN substr(r.filename,length(('logs/'||r.tournament_id::text||'/'))+1) ELSE r.filename END) END) AS raw_ref,NULL::varchar(512) AS document_ref,
 r.status::text AS status,r.attempts,r.error_message,r.uploader_id AS uploader_user_id,
 NULL::bigint AS api_key_id,r.tournament_id AS hint_tournament_id,
 r.attached_encounter_id AS hint_encounter_id,NULL::bigint AS hint_encounter_game_id,r.started_at,r.finished_at
 FROM log_processing.record r JOIN tournament.tournament t ON t.id=r.tournament_id UNION ALL SELECT id,created_at,updated_at,workspace_id,discipline,source_kind,external_id,content_hash,raw_status,filename,raw_ref,document_ref,status,attempts,error_message,uploader_user_id,api_key_id,hint_tournament_id,hint_encounter_id,hint_encounter_game_id,started_at,finished_at FROM (SELECT
 h.id,
 (SELECT min(created_at) FROM audit_log WHERE action='stats.initial_transfer') AS created_at,
 NULL::timestamptz AS updated_at,x.workspace_id,x.discipline,'historical_reference'::varchar AS source_kind,
 'legacy:matches.match:'||m.id::text AS external_id,NULL::char(64) AS content_hash,
 'unverified'::varchar AS raw_status,m.log_name AS filename,('logs/'||x.tournament_id::text||'/')||(CASE WHEN starts_with((CASE WHEN starts_with(m.log_name,('logs/'||x.tournament_id::text||'/')) THEN substr(m.log_name,length(('logs/'||x.tournament_id::text||'/'))+1) ELSE m.log_name END),'logs/') THEN substr((CASE WHEN starts_with(m.log_name,('logs/'||x.tournament_id::text||'/')) THEN substr(m.log_name,length(('logs/'||x.tournament_id::text||'/'))+1) ELSE m.log_name END),6) ELSE (CASE WHEN starts_with(m.log_name,('logs/'||x.tournament_id::text||'/')) THEN substr(m.log_name,length(('logs/'||x.tournament_id::text||'/'))+1) ELSE m.log_name END) END) AS raw_ref,
 NULL::varchar(512) AS document_ref,'done'::varchar AS status,0 AS attempts,NULL::text AS error_message,
 NULL::bigint AS uploader_user_id,NULL::bigint AS api_key_id,x.tournament_id AS hint_tournament_id,
 x.encounter_id AS hint_encounter_id,NULL::bigint AS hint_encounter_game_id,
 NULL::timestamptz AS started_at,NULL::timestamptz AS finished_at,m.id AS source_match_id
 FROM matches.match m JOIN stats01_match x ON x.match_id=m.id
 JOIN stats01_historical_reference h ON h.source_match_id=m.id
 WHERE m.log_record_id IS NULL AND m.log_name IS NOT NULL) h) p) AS legacy,
      (SELECT count(*) FROM (SELECT id,created_at,updated_at,workspace_id,discipline,source_kind,external_id,content_hash,raw_status,filename,raw_ref,document_ref,status,attempts,error_message,uploader_user_id,api_key_id,hint_tournament_id,hint_encounter_id,hint_encounter_game_id,started_at,finished_at FROM stats.ingest_job) p) AS migrated,
      CASE WHEN EXISTS(SELECT 1 FROM stats01_reconcile WHERE class='jobs') THEN 'blocking' ELSE 'ok' END AS status UNION ALL SELECT 'matches'::text AS class,(SELECT count(*) FROM (SELECT m.id,m.created_at,m.updated_at,x.workspace_id,x.discipline,
 x.encounter_id,m.map_index AS source_map_index,x.game_id AS encounter_game_id,
 coalesce(m.log_record_id,h.id) AS ingest_job_id,1 AS revision,NULL::timestamptz AS played_at,m.time AS duration_s,
 m.map_id AS map_entity_id,'map'::varchar AS map_kind FROM matches.match m JOIN stats01_match x ON x.match_id=m.id
 LEFT JOIN (SELECT
 h.id,
 (SELECT min(created_at) FROM audit_log WHERE action='stats.initial_transfer') AS created_at,
 NULL::timestamptz AS updated_at,x.workspace_id,x.discipline,'historical_reference'::varchar AS source_kind,
 'legacy:matches.match:'||m.id::text AS external_id,NULL::char(64) AS content_hash,
 'unverified'::varchar AS raw_status,m.log_name AS filename,('logs/'||x.tournament_id::text||'/')||(CASE WHEN starts_with((CASE WHEN starts_with(m.log_name,('logs/'||x.tournament_id::text||'/')) THEN substr(m.log_name,length(('logs/'||x.tournament_id::text||'/'))+1) ELSE m.log_name END),'logs/') THEN substr((CASE WHEN starts_with(m.log_name,('logs/'||x.tournament_id::text||'/')) THEN substr(m.log_name,length(('logs/'||x.tournament_id::text||'/'))+1) ELSE m.log_name END),6) ELSE (CASE WHEN starts_with(m.log_name,('logs/'||x.tournament_id::text||'/')) THEN substr(m.log_name,length(('logs/'||x.tournament_id::text||'/'))+1) ELSE m.log_name END) END) AS raw_ref,
 NULL::varchar(512) AS document_ref,'done'::varchar AS status,0 AS attempts,NULL::text AS error_message,
 NULL::bigint AS uploader_user_id,NULL::bigint AS api_key_id,x.tournament_id AS hint_tournament_id,
 x.encounter_id AS hint_encounter_id,NULL::bigint AS hint_encounter_game_id,
 NULL::timestamptz AS started_at,NULL::timestamptz AS finished_at,m.id AS source_match_id
 FROM matches.match m JOIN stats01_match x ON x.match_id=m.id
 JOIN stats01_historical_reference h ON h.source_match_id=m.id
 WHERE m.log_record_id IS NULL AND m.log_name IS NOT NULL) h ON h.source_match_id=m.id) p) AS legacy,
      (SELECT count(*) FROM (SELECT id,created_at,updated_at,workspace_id,discipline,encounter_id,source_map_index,encounter_game_id,ingest_job_id,revision,played_at,duration_s,map_entity_id,map_kind FROM stats.match WHERE id IN (SELECT id FROM matches.match)) p) AS migrated,
      CASE WHEN EXISTS(SELECT 1 FROM stats01_reconcile WHERE class='matches') THEN 'blocking' ELSE 'ok' END AS status UNION ALL SELECT 'teams'::text AS class,(SELECT count(*) FROM (SELECT m.id AS match_id,x.encounter_id,t.encounter_team_id,s.position AS source_position
 FROM matches.match m JOIN stats01_match x ON x.match_id=m.id
 CROSS JOIN LATERAL (VALUES(m.home_team_id,1),(m.away_team_id,2)) s(team_id,position)
 JOIN stats01_team t ON t.match_id=m.id AND t.team_id=s.team_id) p) AS legacy,
      (SELECT count(*) FROM (SELECT match_id,encounter_id,encounter_team_id,source_position FROM stats.match_team WHERE match_id IN (SELECT id FROM matches.match)) p) AS migrated,
      CASE WHEN EXISTS(SELECT 1 FROM stats01_reconcile WHERE class='teams') THEN 'blocking' ELSE 'ok' END AS status UNION ALL SELECT 'players'::text AS class,(SELECT count(*) FROM (SELECT DISTINCT p.match_id,t.encounter_team_id,w.id AS workspace_member_id,
 h.handle_snapshot,NULL::bigint AS observed_role_id
 FROM stats01_endpoints p JOIN stats01_match x ON x.match_id=p.match_id
 JOIN stats01_team t ON t.match_id=p.match_id AND t.team_id=p.team_id
 JOIN stats01_member w ON w.workspace_id=x.workspace_id AND w.player_id=p.user_id
 JOIN stats01_handles h ON h.match_id=p.match_id AND h.player_id=p.user_id AND h.team_id=p.team_id
 WHERE p.user_id IS NOT NULL) p) AS legacy,
      (SELECT count(*) FROM (SELECT match_id,encounter_team_id,workspace_member_id,handle_snapshot,observed_role_id FROM stats.match_player WHERE match_id IN (SELECT id FROM matches.match)) p) AS migrated,
      CASE WHEN EXISTS(SELECT 1 FROM stats01_reconcile WHERE class='players') THEN 'blocking' ELSE 'ok' END AS status UNION ALL SELECT 'facts'::text AS class,(SELECT count(*) FROM (SELECT s.match_id,s.round::smallint AS segment,t.encounter_team_id,
 w.id AS workspace_member_id,s.hero_id AS entity_id,'character'::varchar AS entity_kind,d.id AS stat_id,s.value
 FROM matches.statistics s JOIN stats01_match x ON x.match_id=s.match_id
 JOIN stats01_team t ON t.match_id=s.match_id AND t.team_id=s.team_id
 JOIN stats01_member w ON w.workspace_id=x.workspace_id AND w.player_id=s.user_id
 JOIN stats01_stat_ids d ON d.discipline=x.discipline AND d.legacy_name::logstatsname=s.name) p) AS legacy,
      (SELECT count(*) FROM (SELECT match_id,segment,encounter_team_id,workspace_member_id,entity_id,entity_kind,stat_id,value FROM stats.fact WHERE match_id IN (SELECT id FROM matches.match) AND workspace_member_id IS NOT NULL) p) AS migrated,
      CASE WHEN EXISTS(SELECT 1 FROM stats01_reconcile WHERE class='facts') THEN 'blocking' ELSE 'ok' END AS status UNION ALL SELECT 'team_scores'::text AS class,(SELECT count(*) FROM (SELECT m.id AS match_id,0::smallint AS segment,t.encounter_team_id,
 NULL::bigint AS workspace_member_id,NULL::bigint AS entity_id,'character'::varchar AS entity_kind,
 d.id AS stat_id,s.score::float8 AS value FROM matches.match m JOIN stats01_match x ON x.match_id=m.id
 CROSS JOIN LATERAL (VALUES(m.home_team_id,m.home_score),(m.away_team_id,m.away_score)) s(team_id,score)
 JOIN stats01_team t ON t.match_id=m.id AND t.team_id=s.team_id
 JOIN stats.stat_def d ON d.discipline=x.discipline AND d.code='score') p) AS legacy,
      (SELECT count(*) FROM (SELECT match_id,segment,encounter_team_id,workspace_member_id,entity_id,entity_kind,stat_id,value FROM stats.fact WHERE match_id IN (SELECT id FROM matches.match) AND workspace_member_id IS NULL) p) AS migrated,
      CASE WHEN EXISTS(SELECT 1 FROM stats01_reconcile WHERE class='team_scores') THEN 'blocking' ELSE 'ok' END AS status UNION ALL SELECT 'events'::text AS class,(SELECT count(*) FROM (SELECT match_id,segment,t,type_id,actor_member_id,actor_team_id,target_member_id,target_team_id,entity_id,related_entity_id,entity_kind,data FROM (SELECT k.match_id,k.round::smallint AS segment,k.time AS t,d.id AS type_id,
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
 LEFT JOIN stats01_ability_values a ON a.legacy_name=k.ability::text) k UNION ALL SELECT match_id,segment,t,type_id,actor_member_id,actor_team_id,target_member_id,target_team_id,entity_id,related_entity_id,entity_kind,data FROM (SELECT e.match_id,e.round::smallint AS segment,e.time AS t,d.id AS type_id,
 aw.id AS actor_member_id,at.encounter_team_id AS actor_team_id,tw.id AS target_member_id,
 tt.encounter_team_id AS target_team_id,e.hero_id AS entity_id,e.related_hero_id AS related_entity_id,
 'character'::varchar AS entity_kind,NULL::jsonb AS data,e.id AS source_id
 FROM matches.event e JOIN stats01_match x ON x.match_id=e.match_id
 JOIN stats01_event_ids d ON d.discipline=x.discipline AND d.legacy_name=e.name::text
 LEFT JOIN stats01_team at ON at.match_id=e.match_id AND at.team_id=e.team_id
 LEFT JOIN stats01_team tt ON tt.match_id=e.match_id AND tt.team_id=e.related_team_id
 LEFT JOIN stats01_member aw ON aw.workspace_id=x.workspace_id AND aw.player_id=e.user_id
 LEFT JOIN stats01_member tw ON tw.workspace_id=x.workspace_id AND tw.player_id=e.related_user_id) e) p) AS legacy,
      (SELECT count(*) FROM (SELECT match_id,segment,t,type_id,actor_member_id,actor_team_id,target_member_id,target_team_id,entity_id,related_entity_id,entity_kind,data FROM stats.event WHERE match_id IN (SELECT id FROM matches.match)) p) AS migrated,
      CASE WHEN EXISTS(SELECT 1 FROM stats01_reconcile WHERE class='events') THEN 'blocking' ELSE 'ok' END AS status UNION ALL SELECT 'segments'::text AS class,(SELECT count(*) FROM (SELECT DISTINCT match_id,round::smallint AS segment,'round'::varchar AS kind,'{}'::jsonb AS attrs
 FROM (SELECT match_id,round FROM matches.statistics UNION ALL SELECT match_id,round FROM matches.kill_feed
 UNION ALL SELECT match_id,round FROM matches.event) s WHERE round>0) p) AS legacy,
      (SELECT count(*) FROM (SELECT match_id,segment,kind,attrs FROM stats.segment WHERE match_id IN (SELECT id FROM matches.match)) p) AS migrated,
      CASE WHEN EXISTS(SELECT 1 FROM stats01_reconcile WHERE class='segments') THEN 'blocking' ELSE 'ok' END AS status UNION ALL SELECT 'baselines'::text AS class,(SELECT count(*) FROM (SELECT b.id,b.formula_version,r.id AS role_id,b.rank_bucket,d.id AS stat_id,b.mean,b.std,b.meta,b.computed_at
 FROM matches.stat_baselines b JOIN stats01_roles r ON r.code=lower(b.role::text)
 JOIN stats01_stat_ids d ON d.discipline='overwatch' AND d.legacy_name=b.stat::text) p) AS legacy,
      (SELECT count(*) FROM (SELECT id,formula_version,role_id,rank_bucket,stat_id,mean,std,meta,computed_at FROM stats.stat_baseline) p) AS migrated,
      CASE WHEN EXISTS(SELECT 1 FROM stats01_reconcile WHERE class='baselines') THEN 'blocking' ELSE 'ok' END AS status UNION ALL SELECT 'stat_def'::text AS class,(SELECT count(*) FROM (SELECT 'overwatch'::varchar AS discipline,v.code,v.name,v.value_format,v.aggregation,v.stat_group::varchar,
       true AS active,v.sort_order FROM (VALUES ('eliminations','Eliminations','integer','sum',NULL,0),
('final_blows','Final blows','integer','sum',NULL,1),
('deaths','Deaths','integer','sum',NULL,2),
('all_damage_dealt','All damage dealt','decimal','sum',NULL,3),
('barrier_damage_dealt','Barrier damage dealt','decimal','sum',NULL,4),
('hero_damage_dealt','Hero damage dealt','decimal','sum',NULL,5),
('healing_dealt','Healing dealt','decimal','sum',NULL,6),
('healing_received','Healing received','decimal','sum',NULL,7),
('self_healing','Self healing','decimal','sum',NULL,8),
('damage_taken','Damage taken','decimal','sum',NULL,9),
('damage_blocked','Damage blocked','decimal','sum',NULL,10),
('defensive_assists','Defensive assists','integer','sum',NULL,11),
('offensive_assists','Offensive assists','integer','sum',NULL,12),
('ultimates_earned','Ultimates earned','integer','sum',NULL,13),
('ultimates_used','Ultimates used','integer','sum',NULL,14),
('multikill_best','Best multikill','integer','max',NULL,15),
('multikills','Multikills','integer','sum',NULL,16),
('solo_kills','Solo kills','integer','sum',NULL,17),
('objective_kills','Objective kills','integer','sum',NULL,18),
('environmental_kills','Environmental kills','integer','sum',NULL,19),
('environmental_deaths','Environmental deaths','integer','sum',NULL,20),
('critical_hits','Critical hits','integer','sum',NULL,21),
('critical_hit_accuracy','Critical hit accuracy','percent','avg',NULL,22),
('scoped_accuracy','Scoped accuracy','percent','avg',NULL,23),
('scoped_critical_hit_accuracy','Scoped critical hit accuracy','percent','avg',NULL,24),
('scoped_critical_hit_kills','Scoped critical hit kills','integer','sum',NULL,25),
('shots_fired','Shots fired','integer','sum',NULL,26),
('shots_hit','Shots hit','integer','sum',NULL,27),
('shots_missed','Shots missed','integer','sum',NULL,28),
('scoped_shots_fired','Scoped shots fired','integer','sum',NULL,29),
('scoped_shots_hit','Scoped shots hit','integer','sum',NULL,30),
('weapon_accuracy','Weapon accuracy','percent','avg',NULL,31),
('hero_time_played','Hero time played','duration','sum',NULL,32),
('first_picks','First picks','integer','sum',NULL,33),
('first_deaths','First deaths','integer','sum',NULL,34),
('ultimate_kills','Ultimate kills','integer','sum',NULL,35),
('support_kills','Support kills','integer','sum',NULL,36),
('performance','Performance rank','integer','avg',NULL,37),
('performance_points','Performance points','decimal','avg',NULL,38),
('kd','Kills / deaths','decimal','avg',NULL,39),
('kda','Kills and assists / deaths','decimal','avg',NULL,40),
('damage_delta','Damage delta','decimal','sum',NULL,41),
('fbe','Final blows / eliminations','decimal','avg',NULL,42),
('damage_fb','Damage / final blow','decimal','avg',NULL,43),
('assists','Assists','integer','sum',NULL,44),
('impact_points','Impact points','decimal','avg',NULL,45),
('impact_rank','Impact rank','integer','avg',NULL,46),
('overperformance_score','Overperformance score','decimal','avg',NULL,47),
('score','Score','integer','sum','team',48))
       v(code,name,value_format,aggregation,stat_group,sort_order)) p) AS legacy,
      (SELECT count(*) FROM (SELECT discipline,code,name,value_format,aggregation,stat_group,active,sort_order FROM stats.stat_def WHERE discipline='overwatch') p) AS migrated,
      CASE WHEN EXISTS(SELECT 1 FROM stats01_reconcile WHERE class='stat_def') THEN 'blocking' ELSE 'ok' END AS status UNION ALL SELECT 'event_type'::text AS class,(SELECT count(*) FROM (SELECT 'overwatch'::varchar AS discipline,code,name,true AS active
       FROM (VALUES ('kill','Kill'),
('offensive_assist','Offensive assist'),
('defensive_assist','Defensive assist'),
('ultimate_charged','Ultimate charged'),
('ultimate_start','Ultimate start'),
('ultimate_end','Ultimate end'),
('hero_swap','Hero swap'),
('mercy_rez','Mercy resurrection'),
('echo_duplicate_start','Echo duplicate start'),
('echo_duplicate_end','Echo duplicate end')) v(code,name)) p) AS legacy,
      (SELECT count(*) FROM (SELECT discipline,code,name,active FROM stats.event_type WHERE discipline='overwatch') p) AS migrated,
      CASE WHEN EXISTS(SELECT 1 FROM stats01_reconcile WHERE class='event_type') THEN 'blocking' ELSE 'ok' END AS status UNION ALL SELECT 'mv'::text AS class,(SELECT count(*) FROM (SELECT d.discipline,d.id AS stat_id,l.hero_id AS entity_id,l.best_value,l.avg,l.metadata
      FROM (
WITH qualified AS (
 SELECT DISTINCT s.match_id,s.user_id,s.hero_id FROM matches.statistics s
 WHERE s.round=0 AND s.name='HeroTimePlayed' AND s.value>60
), eligible AS (
 SELECT st.match_id,st.user_id,st.hero_id,st.name,st.value,w.id AS workspace_member_id
 FROM matches.statistics st
 JOIN qualified q ON q.match_id=st.match_id AND q.user_id=st.user_id AND q.hero_id=st.hero_id
 JOIN stats01_match x ON x.match_id=st.match_id
 JOIN stats01_member w ON w.workspace_id=x.workspace_id AND w.player_id=st.user_id
 WHERE st.round=0 AND st.hero_id IS NOT NULL
), agg AS (
 SELECT e.hero_id,e.name,
 sum(e.value ORDER BY e.match_id,e.workspace_member_id) sum_value,
 sum(m."time" ORDER BY e.match_id,e.workspace_member_id) sum_time
 FROM eligible e JOIN matches.match m ON m.id=e.match_id GROUP BY e.hero_id,e.name
), ranked AS (
 SELECT e.*,row_number() OVER (PARTITION BY e.hero_id,e.name ORDER BY e.value *
 CASE WHEN e.name IN ('Deaths','DamageTaken','EnvironmentalDeaths','ShotsMissed','DamageFB','Performance')
 THEN -1.0 ELSE 1.0 END DESC,e.match_id DESC,e.workspace_member_id ASC) rn FROM eligible e
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
) l JOIN stats01_stat_names n ON n.legacy_name=l.name::text
      JOIN stats.stat_def d ON d.discipline='overwatch' AND d.code=n.code) p) AS legacy,
      (SELECT count(*) FROM (SELECT discipline,stat_id,entity_id,best_value,avg,metadata FROM stats.mv_entity_global_stats) p) AS migrated,
      CASE WHEN EXISTS(SELECT 1 FROM stats01_reconcile WHERE class='mv') THEN 'blocking' ELSE 'ok' END AS status UNION ALL SELECT 'mv_derivation'::text AS class,(SELECT count(*) FROM (SELECT discipline,stat_id,entity_id,encode(float8send(best_value),'hex') AS best_value_bits,
      encode(float8send(avg),'hex') AS avg_bits,metadata FROM (
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
 THEN -1.0 ELSE 1.0 END DESC,e.match_id DESC,e.workspace_member_id ASC) rn FROM eligible e
), best AS (
 SELECT r.discipline,r.entity_id,r.stat_id,r.value best_value,m.encounter_id,mp.name map_name,
 mp.image_path map_image_path,t.name tournament_name,u.name username
 FROM ranked r JOIN stats.match m ON m.id=r.match_id
 JOIN catalog.entity mp ON mp.id=m.map_entity_id AND mp.kind='map' AND mp.discipline=m.discipline
 JOIN encounter.encounter enc ON enc.id=m.encounter_id AND enc.workspace_id=m.workspace_id AND enc.discipline=m.discipline
 JOIN tournament.tournament t ON t.id=enc.tournament_id
 JOIN workspace_member wm ON wm.id=r.workspace_member_id AND wm.workspace_id=m.workspace_id
 JOIN players."user" u ON u.id=wm.player_id WHERE r.rn=1
)
SELECT a.discipline,a.stat_id,a.entity_id,b.best_value,(a.sum_value/nullif(a.sum_time,0))*600 AS avg,
 jsonb_build_object('encounter_id',b.encounter_id,'map_name',b.map_name,'map_image_path',b.map_image_path,
 'tournament_name',b.tournament_name,'username',b.username) AS metadata
FROM agg a JOIN best b ON b.discipline=a.discipline AND b.entity_id=a.entity_id AND b.stat_id=a.stat_id
) p) p) AS legacy,
      (SELECT count(*) FROM (SELECT discipline,stat_id,entity_id,encode(float8send(best_value),'hex') AS best_value_bits,
      encode(float8send(avg),'hex') AS avg_bits,metadata FROM (SELECT discipline,stat_id,entity_id,best_value,avg,metadata FROM stats.mv_entity_global_stats) p) p) AS migrated,
      CASE WHEN EXISTS(SELECT 1 FROM stats01_reconcile WHERE class='mv_derivation') THEN 'blocking' ELSE 'ok' END AS status UNION ALL SELECT 'external_constraints'::text AS class,(SELECT count(*) FROM (SELECT * FROM (VALUES
 ('achievements.evaluation_result','match_id','stats.match','c',true,true),
 ('achievements.override','match_id','stats.match','c',true,true),
 ('catalog.alias_miss','last_ingest_job_id','stats.ingest_job','n',true,true)
) v(relation,column_name,target,delete_action,condeferrable,condeferred)) p) AS legacy,
      (SELECT count(*) FROM (
SELECT c.conrelid::regclass::text AS relation,a.attname::text AS column_name,
 c.confrelid::regclass::text AS target,c.confdeltype::text AS delete_action,c.condeferrable,c.condeferred
FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND c.conkey=ARRAY[a.attnum]
WHERE c.contype='f' AND ((c.conrelid IN ('achievements.evaluation_result'::regclass,'achievements.override'::regclass)
 AND a.attname='match_id') OR (c.conrelid='catalog.alias_miss'::regclass AND a.attname='last_ingest_job_id'))
) p) AS migrated,
      CASE WHEN EXISTS(SELECT 1 FROM stats01_reconcile WHERE class='external_constraints') THEN 'blocking' ELSE 'ok' END AS status UNION ALL SELECT 'oracle_integrity'::text AS class,(SELECT count(*) FROM (SELECT NULL::text AS reason WHERE false) p) AS legacy,
      (SELECT count(*) FROM (
 WITH required(class) AS (VALUES ('channel'),
('alias_ref'),
('evaluation_ref'),
('override_ref'),
('rule_dependency'),
('outbox_dependency')),
 chunk_actual AS (
   SELECT c.id,c.class,c.chunk,count(r.id) AS count,
    encode(sha256(convert_to(coalesce(string_agg(r.key::text||':'||r.sha256,E'\n' ORDER BY r.key),''),'UTF8')),'hex') AS sha256
   FROM stats01_oracle_chunks c LEFT JOIN stats01_oracle_rows r ON r.id=c.id GROUP BY c.id,c.class,c.chunk
 ), class_actual AS (
   SELECT class,count(*) AS chunks,sum(count) AS count,
    encode(sha256(convert_to(string_agg(sha256,E'\n' ORDER BY chunk),'UTF8')),'hex') AS sha256
   FROM chunk_actual GROUP BY class
 )
 SELECT 'manifest_count'::text AS reason WHERE (SELECT count(*) FROM stats01_oracle_records WHERE p->>'kind'='manifest')<>1
 UNION ALL SELECT 'invalid_record' FROM stats01_oracle_records
  WHERE p IS NULL OR p->>'version' IS DISTINCT FROM '1' OR p->>'kind' IS NULL OR p->>'kind' NOT IN ('chunk','manifest')
    OR (p->>'kind'='manifest' AND jsonb_typeof(p->'classes') IS DISTINCT FROM 'array')
    OR (p->>'kind'='chunk' AND (jsonb_typeof(p->'rows') IS DISTINCT FROM 'array' OR
        p->>'sha256' IS NULL OR p->>'sha256' !~ '^[0-9a-f]{64}$'))
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
      OR jsonb_typeof(key->0) IS DISTINCT FROM 'number' OR sha256 IS NULL OR sha256 !~ '^[0-9a-f]{64}$'
 UNION ALL SELECT 'duplicate_owner:'||class FROM stats01_oracle_rows GROUP BY class,key HAVING count(*)<>1
 UNION ALL SELECT 'unordered_chunk:'||id FROM (
   SELECT id,key,lag(key) OVER(PARTITION BY id ORDER BY ordinality) previous FROM stats01_oracle_rows
 ) r WHERE previous>=key
 UNION ALL SELECT 'manifest_digest_or_count:'||m.class FROM stats01_oracle_manifest m
 LEFT JOIN class_actual a ON a.class=m.class
 WHERE m.count IS DISTINCT FROM coalesce(a.count,0) OR m.chunks IS DISTINCT FROM coalesce(a.chunks,0)
   OR m.sha256 IS DISTINCT FROM coalesce(a.sha256,encode(sha256(''::bytea),'hex'))
) p) AS migrated,
      CASE WHEN EXISTS(SELECT 1 FROM stats01_reconcile WHERE class='oracle_integrity') THEN 'blocking' ELSE 'ok' END AS status UNION ALL SELECT 'channel'::text AS class,(SELECT count(*) FROM (SELECT key,sha256 FROM stats01_oracle_rows WHERE class='channel') p) AS legacy,
      (SELECT count(*) FROM (SELECT jsonb_build_array(id) AS key,
      encode(sha256(convert_to(jsonb_build_array(id,created_at,updated_at,tournament_id,channel_id,channel_name,is_active)::text,'UTF8')),'hex') AS sha256
      FROM stats.discord_channel WHERE true) p) AS migrated,
      CASE WHEN EXISTS(SELECT 1 FROM stats01_reconcile WHERE class='channel') THEN 'blocking' ELSE 'ok' END AS status UNION ALL SELECT 'alias_ref'::text AS class,(SELECT count(*) FROM (SELECT key,sha256 FROM stats01_oracle_rows WHERE class='alias_ref') p) AS legacy,
      (SELECT count(*) FROM (SELECT jsonb_build_array(id) AS key,
      encode(sha256(convert_to(jsonb_build_array(id,last_ingest_job_id)::text,'UTF8')),'hex') AS sha256
      FROM catalog.alias_miss WHERE true) p) AS migrated,
      CASE WHEN EXISTS(SELECT 1 FROM stats01_reconcile WHERE class='alias_ref') THEN 'blocking' ELSE 'ok' END AS status UNION ALL SELECT 'evaluation_ref'::text AS class,(SELECT count(*) FROM (SELECT key,sha256 FROM stats01_oracle_rows WHERE class='evaluation_ref') p) AS legacy,
      (SELECT count(*) FROM (SELECT jsonb_build_array(id) AS key,
      encode(sha256(convert_to(jsonb_build_array(id,match_id)::text,'UTF8')),'hex') AS sha256
      FROM achievements.evaluation_result WHERE true) p) AS migrated,
      CASE WHEN EXISTS(SELECT 1 FROM stats01_reconcile WHERE class='evaluation_ref') THEN 'blocking' ELSE 'ok' END AS status UNION ALL SELECT 'override_ref'::text AS class,(SELECT count(*) FROM (SELECT key,sha256 FROM stats01_oracle_rows WHERE class='override_ref') p) AS legacy,
      (SELECT count(*) FROM (SELECT jsonb_build_array(id) AS key,
      encode(sha256(convert_to(jsonb_build_array(id,match_id)::text,'UTF8')),'hex') AS sha256
      FROM achievements.override WHERE true) p) AS migrated,
      CASE WHEN EXISTS(SELECT 1 FROM stats01_reconcile WHERE class='override_ref') THEN 'blocking' ELSE 'ok' END AS status UNION ALL SELECT 'rule_dependency'::text AS class,(SELECT count(*) FROM (SELECT key,sha256 FROM stats01_oracle_rows WHERE class='rule_dependency') p) AS legacy,
      (SELECT count(*) FROM (SELECT jsonb_build_array(id) AS key,
      encode(sha256(convert_to(jsonb_build_array(id,depends_on::jsonb)::text,'UTF8')),'hex') AS sha256
      FROM achievements.rule WHERE true) p) AS migrated,
      CASE WHEN EXISTS(SELECT 1 FROM stats01_reconcile WHERE class='rule_dependency') THEN 'blocking' ELSE 'ok' END AS status UNION ALL SELECT 'outbox_dependency'::text AS class,(SELECT count(*) FROM (SELECT key,sha256 FROM stats01_oracle_rows WHERE class='outbox_dependency') p) AS legacy,
      (SELECT count(*) FROM (SELECT jsonb_build_array(id) AS key,
      encode(sha256(convert_to(jsonb_build_array(id,o.payload_json::jsonb->'changed_tables')::text,'UTF8')),'hex') AS sha256
      FROM event_outbox o WHERE (o.event_type='achievement_evaluate' OR o.payload_json::jsonb->>'event_type'='achievement_evaluate')
 AND o.status IN ('pending','failed')) p) AS migrated,
      CASE WHEN EXISTS(SELECT 1 FROM stats01_reconcile WHERE class='outbox_dependency') THEN 'blocking' ELSE 'ok' END AS status UNION ALL SELECT 'source_cardinality'::text AS class,(SELECT count(*) FROM (SELECT 'jobs'::text AS relation,(SELECT (SELECT count(*) FROM log_processing.record)+(SELECT count(*) FROM matches.match WHERE log_record_id IS NULL AND log_name IS NOT NULL)) AS count UNION ALL SELECT 'matches'::text AS relation,(SELECT count(*) FROM matches.match) AS count UNION ALL SELECT 'teams'::text AS relation,(SELECT 2*count(*) FROM matches.match) AS count UNION ALL SELECT 'players'::text AS relation,(SELECT count(*) FROM (SELECT DISTINCT match_id,user_id,team_id FROM stats01_endpoints WHERE user_id IS NOT NULL) p) AS count UNION ALL SELECT 'facts'::text AS relation,(SELECT count(*) FROM matches.statistics) AS count UNION ALL SELECT 'events'::text AS relation,(SELECT (SELECT count(*) FROM matches.kill_feed)+(SELECT count(*) FROM matches.event)) AS count UNION ALL SELECT 'baselines'::text AS relation,(SELECT count(*) FROM matches.stat_baselines) AS count) p) AS legacy,
      (SELECT count(*) FROM (SELECT 'jobs'::text AS relation,count(*) AS count FROM (SELECT r.id,r.created_at,r.updated_at,t.workspace_id,t.discipline,
 r.source::text AS source_kind,'legacy:log_processing.record:'||r.id::text AS external_id,
 r.content_hash::char(64),'unverified'::varchar AS raw_status,r.filename,('logs/'||r.tournament_id::text||'/')||(CASE WHEN starts_with((CASE WHEN starts_with(r.filename,('logs/'||r.tournament_id::text||'/')) THEN substr(r.filename,length(('logs/'||r.tournament_id::text||'/'))+1) ELSE r.filename END),'logs/') THEN substr((CASE WHEN starts_with(r.filename,('logs/'||r.tournament_id::text||'/')) THEN substr(r.filename,length(('logs/'||r.tournament_id::text||'/'))+1) ELSE r.filename END),6) ELSE (CASE WHEN starts_with(r.filename,('logs/'||r.tournament_id::text||'/')) THEN substr(r.filename,length(('logs/'||r.tournament_id::text||'/'))+1) ELSE r.filename END) END) AS raw_ref,NULL::varchar(512) AS document_ref,
 r.status::text AS status,r.attempts,r.error_message,r.uploader_id AS uploader_user_id,
 NULL::bigint AS api_key_id,r.tournament_id AS hint_tournament_id,
 r.attached_encounter_id AS hint_encounter_id,NULL::bigint AS hint_encounter_game_id,r.started_at,r.finished_at
 FROM log_processing.record r JOIN tournament.tournament t ON t.id=r.tournament_id UNION ALL SELECT id,created_at,updated_at,workspace_id,discipline,source_kind,external_id,content_hash,raw_status,filename,raw_ref,document_ref,status,attempts,error_message,uploader_user_id,api_key_id,hint_tournament_id,hint_encounter_id,hint_encounter_game_id,started_at,finished_at FROM (SELECT
 h.id,
 (SELECT min(created_at) FROM audit_log WHERE action='stats.initial_transfer') AS created_at,
 NULL::timestamptz AS updated_at,x.workspace_id,x.discipline,'historical_reference'::varchar AS source_kind,
 'legacy:matches.match:'||m.id::text AS external_id,NULL::char(64) AS content_hash,
 'unverified'::varchar AS raw_status,m.log_name AS filename,('logs/'||x.tournament_id::text||'/')||(CASE WHEN starts_with((CASE WHEN starts_with(m.log_name,('logs/'||x.tournament_id::text||'/')) THEN substr(m.log_name,length(('logs/'||x.tournament_id::text||'/'))+1) ELSE m.log_name END),'logs/') THEN substr((CASE WHEN starts_with(m.log_name,('logs/'||x.tournament_id::text||'/')) THEN substr(m.log_name,length(('logs/'||x.tournament_id::text||'/'))+1) ELSE m.log_name END),6) ELSE (CASE WHEN starts_with(m.log_name,('logs/'||x.tournament_id::text||'/')) THEN substr(m.log_name,length(('logs/'||x.tournament_id::text||'/'))+1) ELSE m.log_name END) END) AS raw_ref,
 NULL::varchar(512) AS document_ref,'done'::varchar AS status,0 AS attempts,NULL::text AS error_message,
 NULL::bigint AS uploader_user_id,NULL::bigint AS api_key_id,x.tournament_id AS hint_tournament_id,
 x.encounter_id AS hint_encounter_id,NULL::bigint AS hint_encounter_game_id,
 NULL::timestamptz AS started_at,NULL::timestamptz AS finished_at,m.id AS source_match_id
 FROM matches.match m JOIN stats01_match x ON x.match_id=m.id
 JOIN stats01_historical_reference h ON h.source_match_id=m.id
 WHERE m.log_record_id IS NULL AND m.log_name IS NOT NULL) h) p UNION ALL SELECT 'matches'::text AS relation,count(*) AS count FROM (SELECT m.id,m.created_at,m.updated_at,x.workspace_id,x.discipline,
 x.encounter_id,m.map_index AS source_map_index,x.game_id AS encounter_game_id,
 coalesce(m.log_record_id,h.id) AS ingest_job_id,1 AS revision,NULL::timestamptz AS played_at,m.time AS duration_s,
 m.map_id AS map_entity_id,'map'::varchar AS map_kind FROM matches.match m JOIN stats01_match x ON x.match_id=m.id
 LEFT JOIN (SELECT
 h.id,
 (SELECT min(created_at) FROM audit_log WHERE action='stats.initial_transfer') AS created_at,
 NULL::timestamptz AS updated_at,x.workspace_id,x.discipline,'historical_reference'::varchar AS source_kind,
 'legacy:matches.match:'||m.id::text AS external_id,NULL::char(64) AS content_hash,
 'unverified'::varchar AS raw_status,m.log_name AS filename,('logs/'||x.tournament_id::text||'/')||(CASE WHEN starts_with((CASE WHEN starts_with(m.log_name,('logs/'||x.tournament_id::text||'/')) THEN substr(m.log_name,length(('logs/'||x.tournament_id::text||'/'))+1) ELSE m.log_name END),'logs/') THEN substr((CASE WHEN starts_with(m.log_name,('logs/'||x.tournament_id::text||'/')) THEN substr(m.log_name,length(('logs/'||x.tournament_id::text||'/'))+1) ELSE m.log_name END),6) ELSE (CASE WHEN starts_with(m.log_name,('logs/'||x.tournament_id::text||'/')) THEN substr(m.log_name,length(('logs/'||x.tournament_id::text||'/'))+1) ELSE m.log_name END) END) AS raw_ref,
 NULL::varchar(512) AS document_ref,'done'::varchar AS status,0 AS attempts,NULL::text AS error_message,
 NULL::bigint AS uploader_user_id,NULL::bigint AS api_key_id,x.tournament_id AS hint_tournament_id,
 x.encounter_id AS hint_encounter_id,NULL::bigint AS hint_encounter_game_id,
 NULL::timestamptz AS started_at,NULL::timestamptz AS finished_at,m.id AS source_match_id
 FROM matches.match m JOIN stats01_match x ON x.match_id=m.id
 JOIN stats01_historical_reference h ON h.source_match_id=m.id
 WHERE m.log_record_id IS NULL AND m.log_name IS NOT NULL) h ON h.source_match_id=m.id) p UNION ALL SELECT 'teams'::text AS relation,count(*) AS count FROM (SELECT m.id AS match_id,x.encounter_id,t.encounter_team_id,s.position AS source_position
 FROM matches.match m JOIN stats01_match x ON x.match_id=m.id
 CROSS JOIN LATERAL (VALUES(m.home_team_id,1),(m.away_team_id,2)) s(team_id,position)
 JOIN stats01_team t ON t.match_id=m.id AND t.team_id=s.team_id) p UNION ALL SELECT 'players'::text AS relation,count(*) AS count FROM (SELECT DISTINCT p.match_id,t.encounter_team_id,w.id AS workspace_member_id,
 h.handle_snapshot,NULL::bigint AS observed_role_id
 FROM stats01_endpoints p JOIN stats01_match x ON x.match_id=p.match_id
 JOIN stats01_team t ON t.match_id=p.match_id AND t.team_id=p.team_id
 JOIN stats01_member w ON w.workspace_id=x.workspace_id AND w.player_id=p.user_id
 JOIN stats01_handles h ON h.match_id=p.match_id AND h.player_id=p.user_id AND h.team_id=p.team_id
 WHERE p.user_id IS NOT NULL) p UNION ALL SELECT 'facts'::text AS relation,count(*) AS count FROM (SELECT s.match_id,s.round::smallint AS segment,t.encounter_team_id,
 w.id AS workspace_member_id,s.hero_id AS entity_id,'character'::varchar AS entity_kind,d.id AS stat_id,s.value
 FROM matches.statistics s JOIN stats01_match x ON x.match_id=s.match_id
 JOIN stats01_team t ON t.match_id=s.match_id AND t.team_id=s.team_id
 JOIN stats01_member w ON w.workspace_id=x.workspace_id AND w.player_id=s.user_id
 JOIN stats01_stat_ids d ON d.discipline=x.discipline AND d.legacy_name::logstatsname=s.name) p UNION ALL SELECT 'events'::text AS relation,count(*) AS count FROM (SELECT match_id,segment,t,type_id,actor_member_id,actor_team_id,target_member_id,target_team_id,entity_id,related_entity_id,entity_kind,data FROM (SELECT k.match_id,k.round::smallint AS segment,k.time AS t,d.id AS type_id,
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
 LEFT JOIN stats01_ability_values a ON a.legacy_name=k.ability::text) k UNION ALL SELECT match_id,segment,t,type_id,actor_member_id,actor_team_id,target_member_id,target_team_id,entity_id,related_entity_id,entity_kind,data FROM (SELECT e.match_id,e.round::smallint AS segment,e.time AS t,d.id AS type_id,
 aw.id AS actor_member_id,at.encounter_team_id AS actor_team_id,tw.id AS target_member_id,
 tt.encounter_team_id AS target_team_id,e.hero_id AS entity_id,e.related_hero_id AS related_entity_id,
 'character'::varchar AS entity_kind,NULL::jsonb AS data,e.id AS source_id
 FROM matches.event e JOIN stats01_match x ON x.match_id=e.match_id
 JOIN stats01_event_ids d ON d.discipline=x.discipline AND d.legacy_name=e.name::text
 LEFT JOIN stats01_team at ON at.match_id=e.match_id AND at.team_id=e.team_id
 LEFT JOIN stats01_team tt ON tt.match_id=e.match_id AND tt.team_id=e.related_team_id
 LEFT JOIN stats01_member aw ON aw.workspace_id=x.workspace_id AND aw.player_id=e.user_id
 LEFT JOIN stats01_member tw ON tw.workspace_id=x.workspace_id AND tw.player_id=e.related_user_id) e) p UNION ALL SELECT 'baselines'::text AS relation,count(*) AS count FROM (SELECT b.id,b.formula_version,r.id AS role_id,b.rank_bucket,d.id AS stat_id,b.mean,b.std,b.meta,b.computed_at
 FROM matches.stat_baselines b JOIN stats01_roles r ON r.code=lower(b.role::text)
 JOIN stats01_stat_ids d ON d.discipline='overwatch' AND d.legacy_name=b.stat::text) p) p) AS migrated,
      CASE WHEN EXISTS(SELECT 1 FROM stats01_reconcile WHERE class='source_cardinality') THEN 'blocking' ELSE 'ok' END AS status;

SELECT class,direction,row FROM stats01_reconcile ORDER BY class,direction,row::text LIMIT 20;

COMMIT;
