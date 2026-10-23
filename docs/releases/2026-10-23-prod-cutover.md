# Production cutover: v1.48.1 → v2.0.0 in one maintenance window

Production runs `v1.48.1` (2026-10-12). `v2.0.0` carries every release note dated 2026-10-15 to 2026-10-23 and the
migrations since, including the maintenance-only cutovers: `enclayer01` and `matchmode01` take ACCESS EXCLUSIVE locks,
`stats01` copies every match in one transaction, and `legacy01` drops the legacy storage irreversibly. The tag-push deploy
(`ops/deploy/remote-deploy.sh`) migrates while the old stack serves, and that path cannot run any of these cutovers. So
the site goes behind a maintenance page, every writer stops, and the operator runs the steps below by hand. CI, the
images and every check are done days ahead (§1). The window itself is **one hour** and only deploys.

This file orders the work. The details of each cutover stay in the release notes it links. Section numbers like
"P1 :80" refer to the line of the linked file.

## Maintenance page

nginx answers 503 with a self-contained page (RU and EN, a countdown to the ETA, a reload every 60 s) while
`nginx/maintenance/on` exists. `/api/*` gets `{"detail":"maintenance"}`. `/health` still reaches the gateway, so the
container healthcheck and the blackbox probe tell the truth: silence alerts for the window. The mechanism is in
`nginx/nginx.conf` ("Maintenance mode"), and the directory is mounted in `docker-compose.production.yml`.

| Command (on the host) | Effect |
| --- | --- |
| `make maint-on MIN=60` | Writes the ETA (now + 60 min) and the flag. On first use it creates `nginx/maintenance/bypass.conf`, a random secret. It recreates nginx when the running one predates the mechanism. Prints the bypass snippet. Safe to repeat. |
| `make maint-eta MIN=40` | Moves the ETA to now + 40 min. Takes effect at once, and open pages pick it up within 60 s. |
| `make maint-off` | Removes the flag and the ETA. Open pages land on the site at their next reload. |

**Bypass.** Paste the printed `document.cookie = "owt_maint=…"` line into the browser console on the site, then reload.
That browser gets the real site and API, so you can test before reopening. The secret is 32 hex characters
(`openssl rand -hex 16`). A longer one overflows nginx's map hash and nginx refuses to start. `bypass.conf` is read when
nginx starts. `maint-on` recreates nginx whenever it writes a new secret.

`on`, `maintenance.json` and `bypass.conf` are gitignored, so `remote-deploy.sh`'s clean-checkout rule still holds.

## Shell setup on the host

Every command below assumes this, in **bash** (root's login shell on Moscow is zsh, which does not word-split `$C`;
start `bash` first), in `/root/overwatch-tournaments`:

```bash
export TAG=v2.0.0
export IMAGE_TAG=$TAG
export PROD_SIZE=medium                 # = repo variable PROD_SIZE
C="docker compose -f docker-compose.production.yml"
CUT=/root/cutover-$TAG && mkdir -p "$CUT"
S3ENV=/root/pg-backup/s3.env           # the nightly backup's own file: BUCKET + keys; it overrides no CONTAINER/PGSUPER
set -a; . "$S3ENV"; set +a
CONTAINER=db_postgres PGSUPER=system HOSTTAG=moscow   # backup.sh's defaults, which Moscow runs
DB_NAME=$(sed -n 's/^POSTGRES_DB=//p' backend/env/common.env)   # anak_v5
# Services reach Postgres through pgBouncer (host.docker.internal:6432). The cutover's connections go straight to
# Postgres on 5432 of the same host: pgBouncer refuses PGOPTIONS ("unsupported startup parameter in options"), and the
# cutover scripts need one physical session (temporary projections), which transaction pooling does not give.
DB_HOST=$(sed -n 's/^POSTGRES_HOST=//p' backend/env/common.env) DB_PORT=5432
# Moscow runs statement_timeout = 5min server-wide: discipline01 died on it on the dev copy. Raise it for the
# cutover's own connections only, as the dev run did; never in postgresql.conf, a role or the database.
# Moscow also caps temp files at 5GB (temp_file_limit): stats01 overran it on 2026-10-23 after ~24 min. 30GB, disk
# has 50GB free.
PGOPT='-c statement_timeout=1800000 -c lock_timeout=5000 -c temp_file_limit=30GB'
pg()      { docker exec -i -e "PGOPTIONS=$PGOPT" "$CONTAINER" psql -U "$PGSUPER" -d "$DB_NAME" -v ON_ERROR_STOP=1 "$@"; }
alembic() { $C run --rm --no-deps -T -e "PGOPTIONS=$PGOPT" -e "POSTGRES_HOST=$DB_HOST" -e "POSTGRES_PORT=$DB_PORT" \
              app-svc alembic "$@"; }
cutrun()  { $C run --rm --no-deps -T -w /app -v "$CUT:/cutover" -e "PGOPTIONS=$PGOPT" \
              -e "POSTGRES_HOST=$DB_HOST" -e "POSTGRES_PORT=$DB_PORT" app-svc "$@"; }
```

Functions, not variables: `PGOPT` holds spaces, and an unquoted `$VAR` command would split it into separate
arguments. Checked on Moscow (2026-10-23): a container on `owt_app-network` reaches `host.docker.internal:5432` as
`system` and gets `statement_timeout` 30min and `lock_timeout` 5s. The same options through 6432 are refused.

## 1. Before the window

1. **Images and CI, days ahead: the window only deploys.** Freeze the release first. Tag only a commit whose migration
   chain already ran on dev, because a migration landing later has to reach dev before the window. Then set the repo
   variable `DEPLOY_FREEZE=true` and push `v2.0.0`. The tag push runs the CI gates (lint and tests for backend,
   frontend and gateway), builds the 10 images and makes Moscow only pull them (`PULL_ONLY`). The running stack and
   the checkout stay as they are, and no Release is written. A red gate means no images, so fix it and re-tag before
   the window. Done when the workflow is green and Moscow holds every image:
   ```bash
   docker image ls --format '{{.Repository}}:{{.Tag}}' | grep -c ':v2.0.0$'   # 10
   ```
2. **Host env files.** The tag's compose file reads `backend/env/stats.env`, which v1.48.1 did not have
   (`parser.env` is gone). A missing file stops every `docker compose` call in the window, including `maint-on`. Check
   without touching the checkout:
   ```bash
   git fetch --tags --force origin
   for f in $(git show "$TAG":docker-compose.production.yml | grep -o '\./backend/env/[a-z]*\.env' | sort -u); do
     test -f "$f" || echo "missing $f"; done
   ```
   **Done 2026-10-23:** `stats.env` created on Moscow as a copy of `parser.env`, the same as the dev stand's. Every
   env file of the new compose file exists (checked against `develop` `314dda702`; `twitch.env` shows up only in a
   commented-out block). Still open: the production `RIOT_API_KEY` in `stats.env`, which LoL rank collection needs
   (collection starts off), and the Riot RSO and `STEAM_OAUTH_ENABLED` keys in `auth.env`
   ([riot-lol](./2026-10-21-riot-lol.md), [deadlock](./2026-10-21-deadlock.md)). In the Riot portal, register the
   redirect URI `https://owt.craazzzyyfoxx.me/auth/callback` with scopes `openid cpid`.
3. **Timings: measured on dev.** Dev ran this chain on Moscow's own 2026-10-16 dump (`anak_v5`: 7,500 matches,
   27.9M statistics rows, 4.6 GB), and production has moved little since. Moscow has 8 CPU / 12 GB, home 12 cores /
   24 GB. Home's statistics run was hard-capped after the box went down under load, so its rows are upper bounds.

   | Step | Dev | Where it ran |
   | --- | --- | --- |
   | Restore of the dump (250 MB custom format → 4.6 GB, `pg_restore -j 2`) | 5 min 06 s | Moscow |
   | `enclayer01` | 14 s | Moscow |
   | `discipline01`: the 27.9M-row hero remap | 14 min 33 s | Moscow |
   | `discipline01b` → `discipline01c` | 14 s | Moscow |
   | `stats01` → `stats01a`: copy, ANALYZE, MV 64 s, the in-migration relational proof 499 s | 18 min 06 s | home, capped |
   | `regtpl01` → `drift01`: `schemasplit01`, `rank01`, `legacy01` dropping ~3.5 GB | 4 s | home |
   | `statrec01` → `owmapdrop01`: `matchmode01` backfilling 7,500 matches | under 2 min 17 s, image build included | home |
   | `pg_dump -Fc` (373–429 MB) | about 1 min | home |
   | P4 receipt `--mode capture` | 98 min | off-host, 2 CPU / 6 GB |
   | P4 receipt `--mode check` | 55 min | home, low priority |
   | Stack start until every service is healthy | 47 s | home |

   Not timed separately: `ingest01` → `regtpl01`, the mix migrations and `mixdraft01` → `rankopt01`, which ran inside
   ordinary dev deploys. Their tables are small (on dev: 23 draft sessions, 110 mix rounds, 1,816 registrations).
   The lobby recompute takes 1.4 s, because no encounter is scored by points.

   **The window: one hour, `MIN=60`.**

   | Step | Min |
   | --- | --- |
   | W1 page, alert silence | 3 |
   | W2 stop, drain, fingerprint (10 s), preflights (4 s) | 5 |
   | W3 rollback dump; S3 copy in the background | 2 |
   | W4 migrations to `rank01` | 25–33 |
   | W5 frozen dump | 1 |
   | W6 `legacy01` → head, lobby recompute | 1 |
   | W7 caches, stack start | 3 |
   | W8 smoke through the bypass | 5–7 |
   | W9 reopen | 1 |
   | **Total** | **46–55** |

   Everything that does not gate the reopening runs afterwards (§5): the SQL proofs, the P4 receipt, old logs →
   verified, catalog syncs, game switches, queue cleanup. **Point of no return X = T+50 min.** A rollback takes 8–10 min
   (restore 5 min, as measured on Moscow, plus the v1.48.1 deploy). A failure inside W4 has the old site back by about
   T+45–50; one found in the W8 smoke, by about T+60–62.

   The P4 receipt (capture + check, about 2.5 h on dev) stays out of the window. Dev captured and checked it on the
   same 2026-10-16 data: 24/24 classes ok, 0 blocking. The fingerprint (§1.4, again in W2.5) proves production's
   statistics source is still that data, and `stats01a` re-runs its own full relational proof in production.

   Pre-window checks, results:
   - [mix-picks](./2026-10-23-mix-picks.md) on the dev database (2026-10-23, at `canonical01`): the Deadlock
     uniqueness query returns 0 rows on a denominator of 0 Deadlock matches. There is nothing to refute, and production
     has no Deadlock match either. The Overwatch hero-config query returns 0 of 4 hero configs;
   - the [analytics artifact conversion](./2026-10-18-multi-game-p6-achievements-analytics.md) does not apply. All 7
     `analytics.ml_model_artifact` rows on production (3 performance, 1 shift, 3 standings) point at
     `file:///opt/anak/models/…`. That path exists neither in the worker nor on the host, the `owt_analytics-models`
     volume is empty, and no `.joblib` is anywhere on Moscow. There are no bytes to convert: analytics stays on its
     neutral fallback for a missing file, as it is today, until the new image retrains (`cli train`, after the window,
     optional);
   - open: the real-log decoder parity check ([P5 §14](./2026-10-15-multi-game-p5-ingest.md), last paragraph);
   - dev runs `develop` at `5b94f96e5`, database at `rankopt01` (deployed 2026-10-23). The tail from `canonical01`
     (`mixdraft01` … `socdn01`, `rankopt01`) has run on production-derived data;
   - the maintenance page, rehearsed on dev through its own front proxy (2026-10-23): pages get 503 with the page, `/api`
     gets 503 JSON, `/health` gets 200, the bypass cookie gives the real site and API, and `maint-off` brings back 200.
     On Moscow, HAProxy's `backend nginx` has no health check, so it passes nginx's 503 through unchanged. HAProxy's
     own `errorfile 503` shows only for the seconds `maint-on` takes to recreate nginx.
4. **Read-only checks on production, days ahead.** Statistics fingerprint: production's statistics source must still
   be exactly the 2026-10-16 dump dev migrated. Run it through `pg` (shell setup above):
   ```sql
   SELECT 'matches' t, count(*) n, max(created_at) first_ts, max(updated_at) last_ts FROM matches.match
   UNION ALL SELECT 'statistics', count(*), NULL, NULL FROM matches.statistics
   UNION ALL SELECT 'events',     count(*), NULL, NULL FROM matches.event
   UNION ALL SELECT 'kills',      count(*), NULL, NULL FROM matches.kill_feed
   UNION ALL SELECT 'records',    count(*), max(started_at), max(finished_at) FROM log_processing.record;
   ```
   Expected, as measured on Moscow on 2026-10-23: matches 7,500, statistics 27,949,908, events 899,707, kills 334,656,
   records 1,317. The last match was created and last updated on 2026-10-04, and the last record ran on 2026-10-04.
   Matches, statistics, events and kills equal the 2026-10-16 dump. The dump has 1,319 records: ids 2535 and 2628,
   two `failed` Discord uploads of tournament 117 that no match references, were deleted after it, so production
   carries two historical jobs fewer than dev.

   Then the preflights: `discipline01_preflight.sql`, `enclayer01_preflight.sql` and `mixround01_preflight.sql` from
   `backend/scripts/`, piped into `pg`. Every BLOCKER and every numbered class must return 0 rows. WARNING and `count:`
   rows are informational. Never fix by truncating. The two UPDATEs in
   [the encounter-layer runbook](../encounter-layer-v1-release.md) are dev-data fixes. Do not copy them. Results on
   Moscow, 2026-10-23:
   - `mixround01`: both classes 0. Info: 51 seats without a member;
   - `enclayer01`: all 11 BLOCKERs 0. The WARNINGs are the representations approved on dev: 2 conflicting role/rank
     groups, 1 metadata collapse (players 11533/11593), 1 multi-roster member (encounter 6511), 156 report-only replay
     codes, and the self-duel of encounter 94;
   - `discipline01`: classes 1–4, 7 and 9–11 are 0. Classes 5, 6, 8 and their counts read `encounter.*`, which only
     exists after `enclayer01`, so they error at v1.48.1. `discipline01` runs the same checks itself, under its locks,
     before it writes.
5. **Disk.** Room for two more dumps (W3 and W5): Moscow had 60 GB free on 2026-10-23, and a dump is about 250 MB.
6. **Announce, and hold the window before this weekend's matches.** A match uploaded after 2026-10-16 breaks the
   fingerprint, and with it the reason the P4 receipt can wait. Publish a platform announcement 24 h ahead, RU and EN,
   with "Stop showing at" set to the window start. Post in Discord. The bot is offline for the whole window. A slash
   command older than 5 minutes dead-letters to `discord_commands.dlq` and reads `lost`
   ([mix-discord](./2026-10-23-mix-discord.md)). Pick a window with no tournament stage, draft or registration deadline
   within an hour of it: the `tournament-svc` tick is stopped.
7. **Changelog date, before the tag of step 1.** Set `date` of the `2.0.0` entry in
   `frontend/src/lib/changelog/releases.ts` to the window day: `/changelog` prints it, and the release card shows for
   14 days from it. The switcher screenshot `frontend/public/changelog/2.0.0/games.{ru,en}.webp` was taken on dev,
   where VALORANT has no icon yet and reads «VAL»; retake it if dev gets the icon before the tag.

## 2. Window: close and drain

**W1. Maintenance on.**

```bash
git status --porcelain --untracked-files=no   # Moscow: " M docker-compose.production.yml" (alloy memory 1G), see below
git checkout -- docker-compose.production.yml # the tag already sets alloy to 1G; a dirty file blocks the checkout
git fetch --tags --prune --force origin && git checkout --detach "refs/tags/$TAG"
$C config -q                                  # env files and interpolation, before anything stops
make maint-on MIN=60                           # §1.3; keep the printed bypass line
curl -sI https://owt.craazzzyyfoxx.me/ | head -n1   # from outside: 503, so the front proxy passes it on
```

On the monitoring host, silence everything for the window and keep the printed id:

```bash
docker exec owt-monitoring-alertmanager-1 amtool --alertmanager.url=http://localhost:9093 \
  silence add --duration=4h --author=cutover --comment="prod cutover $TAG" 'alertname=~".+"'
```

**W2. Stop producers, drain, stop the rest.** The old stack is still running from v1.48.1 images. Its `parser-svc` is
unknown to the new compose file, so it is stopped by label.

1. `$C stop discord-worker gateway frontend`. Nothing new enters.
2. Outbox drained ([P1 :80-86](../multi-game-p1-catalog-release.md)):
   `pg -c "SELECT status, count(*) FROM event_outbox WHERE status <> 'published' GROUP BY status"` returns no
   rows. Inspect failed rows and their `last_error`. Never mark them published or delete them.
3. Queues drained ([P1 :86-92](../multi-game-p1-catalog-release.md)):
   `$C exec rabbitmq rabbitmqctl list_queues name messages_ready messages_unacknowledged consumers`. Work queues are
   at 0/0. Record the depth of `process_match_log` and `process_match_log.dlq`: the new images never consume them.
   Wait for `parser-svc` to empty `process_match_log`, or write down the matches left there to re-upload after the
   window.
4. Stop the rest:
   ```bash
   $C stop tournament-svc balancer-svc app-svc identity-svc analytics-svc analytics-worker stream-svc
   docker stop $(docker ps -q --filter label=com.docker.compose.service=parser-svc)
   docker ps --format '{{.Names}}'   # left: postgres/pgbouncer (or db_*), redis, rabbitmq, proxy, nginx, alloy, nginx-exporter
   ```
5. On the quiet database, re-run the fingerprint and the three preflights from §1.4, saving each output under `$CUT/`.
   A fingerprint that differs from §1.4's expected values, or any BLOCKER or numbered-class row, stops the release: go
   to §6 "Before W3". A changed fingerprint means the dev proof no longer covers the data, and the P4 receipt would
   have to run inside the window (about 2.5 h).

**W3. Backup: the rollback point.**

```bash
docker exec "$CONTAINER" pg_dump -U "$PGSUPER" -Fc -Z6 -d "$DB_NAME" > "$CUT/db-pre.dump"
docker run --rm -v "$CUT:/b" postgres:18.1 pg_restore -l /b/db-pre.dump > /dev/null && ls -lh "$CUT/db-pre.dump"
# off-host copy; may run in a second shell while W4 starts
docker run --rm --env-file "$S3ENV" -v "$CUT:/data:ro" rclone/rclone \
  copy /data "tw:$BUCKET/pg/$HOSTTAG/cutover-$TAG/" --s3-no-check-bucket --stats-one-line
```

## 3. Window: migrate

`pg`, `alembic` and `cutrun` go straight to Postgres with `PGOPT`. Moscow's 5-minute `statement_timeout` stopped
the 27.9M-row `discipline01` remap on the dev copy until the migration connection got 30 min. That raise belongs to
these connections only ([backend/README.md](../../backend/README.md#p4-statistics-cutover-stats01--stats01a)).

**W4. Up to `rank01`, with checkpoints.**

```bash
alembic current                   # v1.48.1's head
alembic upgrade discipline01      # commits the catalog remap on its own (prod 2026-10-23: 11.6 min)
# here: the historical member stats01's preflight needs, see below
alembic upgrade rank01            # stats01/stats01a are the long part (dev: 18 min)
alembic current                   # rank01
```

A failure rolls its transaction back, but earlier commits stay. Read `alembic current` and never stamp past a failed
data rewrite ([P1](../multi-game-p1-catalog-release.md)). If `enclayer01b` is interrupted, `enclayer01` stays applied,
and re-running the upgrade resumes at `enclayer01b` ([encounter layer](../encounter-layer-v1-release.md)).

**The historical member, at the `discipline01` checkpoint.** `stats01`'s preflight refuses `2_missing_member` for
player 513 (BillyButcher#21261) in workspace 2: 16 legacy observations in matches 6689, 6690, 6697 and 6698, and no
membership. That is the case dev reviewed on 2026-10-16 (manifest `63d1c6f3…`). The remedy is a removed member with no
access, written through `stats01_prepare.py --apply` with a one-item `members` manifest (`create: {"removed": true}`),
the snapshot taken by `inspect_member(conn, 513, 2)`, and its fingerprint as `expected`. On the 2026-10-23 run the
refusal cost one `rank01` attempt: about 12 min, rolled back. Apply the member before `upgrade rank01`. The `--apply`
commits each item first, then starts a full read-only S3 inventory (`check`) that runs for many minutes and keeps a
database session open. Once the member row exists, stop that `app-svc-run` container (the report file is lost; the
manifest and the row are the record). Otherwise its session blocks the migration's locks.

**W5. Freeze the pre-drop state.** The SQL proofs and the P4 receipt run on this dump after the window (§5): it holds
the legacy tables and the migrated ones exactly as they stand before the drop, writers stopped.

```bash
docker exec "$CONTAINER" pg_dump -U "$PGSUPER" -Fc -Z6 -d "$DB_NAME" > "$CUT/db-rank01.dump"   # dev: about 1 min
docker run --rm -v "$CUT:/b" postgres:18.1 pg_restore -l /b/db-rank01.dump > /dev/null && ls -lh "$CUT/db-rank01.dump"
```

**W6. The drop, then the lobbies.**

```bash
$C run --rm --no-deps -T -e "PGOPTIONS=$PGOPT" -e "POSTGRES_HOST=$DB_HOST" -e "POSTGRES_PORT=$DB_PORT" \
  -e OWT_APPLY_LEGACY_DROP=1 app-svc alembic upgrade head   # dev: seconds
alembic current                   # the tag's head
cutrun python -m scripts.enclayer01_recompute_lobbies   # dev: 1.4 s; without it a migrated points lobby reads 0:0
```

- The flag lives in this one container only, so there is nothing to remove from `app.env` afterwards.
- The lobby recompute runs at head, not at `rank01`. Its ORM reads columns that later migrations add
  (`encounter.game.mode_id` and others). A second run changes nothing ([encounter layer](../encounter-layer-v1-release.md)).

## 4. Window: start, check, reopen

**W7. Clear old-id caches, then start the new stack behind the page.** Nothing has written to Redis since W2. On
Moscow (2026-10-23), `backend:*` lives in db 4 (85 keys) and db 6 (63), and `fastapi:*` in db 5 (8). `app-svc` and
`stats-svc` flush db 4 at startup, but nothing flushes db 5 or db 6. Never `FLUSHALL`: Redis holds sessions too
([P1 :126-144](../multi-game-p1-catalog-release.md)).

```bash
for spec in 4:backend 5:fastapi 6:backend; do
  $C exec -T redis sh -c "redis-cli -n ${spec%%:*} --scan --pattern '${spec#*:}:*' | xargs -r redis-cli -n ${spec%%:*} UNLINK"
done
$C up -d --no-deps --wait tournament-svc identity-svc   # they declare queues others publish to (mix-bans, steam names)
make prod-up PROD_SIZE=$PROD_SIZE                       # the rest; --remove-orphans drops parser-svc
# 2026-10-23: the first --wait failed on "owt-nginx-1 is unhealthy". nginx's healthcheck had seen the gateway
# down for the whole window and needs ~30 s to turn healthy again. Every service was already started; rerun prod-up.
make prod-discord-emoji
$C ps --format '{{.Service}}|{{.State}}|{{.Health}}' | sort
```

The first statistics reads are cold and heavy.

**W8. Smoke through the bypass, five minutes.** Use the cookie `maint-on` printed. Check, in this order: the home
page, a tournament and one of its encounters, a user profile with its statistics, `/statistics`, sign-in, and the
admin. Then `$C exec rabbitmq rabbitmqctl list_queues name consumers`: one consumer per `stats.ingest.<game>` and
`.replay`, and one on `match.ingested.tournament`. Anything broken here, past X, means rollback (§6).

**W9. Reopen.**

```bash
make maint-off
docker exec owt-monitoring-alertmanager-1 amtool --alertmanager.url=http://localhost:9093 silence expire <id>   # on home
```

## 5. After reopening

Every step here runs with the site open.

1. **Games and catalogs** (superuser):
   - catalog syncs: `POST /api/v1/admin/catalog-sync/lol`, `/deadlock`, `/valorant`, then set VALORANT
     `in_competitive` per map ([p8-lol](./2026-10-19-multi-game-p8-lol.md), [deadlock](./2026-10-21-deadlock.md),
     [valorant](./2026-10-23-valorant.md));
   - discipline icons: on 2026-10-23 the CDN had none of the four, so the game switcher showed text. The script only
     accepts files under `frontend/public/disciplines/`, so mount them at that path in the container:
     `$C run --rm --no-deps -T -w /app -v $PWD/frontend/public/disciplines:/frontend/public/disciplines:ro app-svc python scripts/publish_discipline_assets.py --discipline valorant --file /frontend/public/disciplines/valorant/icon.svg --key assets/valorant/icon.svg --publish`.
     Same for `overwatch` and `lol` (`icon.svg`) and `deadlock` (`icon.png`). From Moscow its read-back check gets 403
     from the CDN, though the upload has landed. Compare the CDN bytes with the repo file instead;
   - turn games on: `PATCH /api/v1/workspaces/{id}` with `disciplines_enabled`. LoL rank collection starts off,
     Deadlock on ([riot-lol](./2026-10-21-riot-lol.md), [deadlock](./2026-10-21-deadlock.md)).
2. **Retired queues:** `$C exec rabbitmq rabbitmqctl delete_queue <name>` for `cache_invalidation_app_service`,
   `analytics_train`, `analytics_infer` and their `.dlq`, and for `process_match_log(.dlq)` once it is empty
   ([stats-owns-statistics-reads](./2026-10-23-stats-owns-statistics-reads.md), [backend-cleanup](./2026-10-21-backend-cleanup.md),
   [P5 §13](./2026-10-15-multi-game-p5-ingest.md#13-p9-maintenance-release-old-queues-drain-rollback)).
3. **Old logs → verified.** The verify is read-only. The apply locks `stats.ingest_job` and `stats.match` for its
   single transaction, and must not race an ingest: stop `stats-worker` for the minute it takes. No match is uploaded
   before the weekend, so the snapshot does not move between verify and apply. If it moves anyway, the apply refuses
   with `native_target_drift`; verify again.
   ```bash
   cutrun python scripts/stats01_prepare.py --verify-native-raw --report /cutover/native-proposal.json
   python3 -c 'import json,sys,collections; r=json.load(open(sys.argv[1])); print(collections.Counter(x["raw_status"] for x in r["raw"]), "blockers:", len(r["blockers"]))' "$CUT/native-proposal.json"
   python3 -c 'import json,sys; r=json.load(open(sys.argv[1])); r["review"]=sys.argv[3]; json.dump(r,open(sys.argv[2],"w"))' \
     "$CUT/native-proposal.json" "$CUT/native-reviewed.json" "prod cutover $TAG $(date -u +%F): applied as classified"
   $C stop stats-worker
   cutrun python scripts/stats01_prepare.py --apply-native-raw --manifest /cutover/native-reviewed.json \
     --manifest-sha256 "$(sha256sum "$CUT/native-reviewed.json" | cut -d' ' -f1)" --report /cutover/native-applied.json
   $C start stats-worker
   ```
   - A job becomes `available` (verified) only when its object is in S3, is processable, and matches any hash
     already recorded; an unknown hash is filled from the bytes. The rest is classified honestly:
     - `missing` when the object is gone;
     - `conflict` when the recorded hash differs;
     - `unverified` when one object is shared by several matches, or is unprocessable.

     The apply refuses any other status (`native_inspection_drift`). On the 2026-10-16 data the P4 inventory found 153
     missing keys, 1 hash conflict and 18 keys shared by 36 matches.
   - A `blockers` count above zero is S3 access failing: fix the credentials and verify again. `configuration_or_database_unavailable`
     with no S3 trouble is the server ending the session: Moscow runs `idle_in_transaction_session_timeout` = 30 s,
     and both commands hold one transaction open while they fetch S3 objects one by one. asyncpg ignores
     `PGOPTIONS`. On 2026-10-23 they ran through a wrapper that sets `idle_in_transaction_session_timeout=0` and
     `statement_timeout=0` as asyncpg `server_settings` for that process only (`/root/cutover-v2.0.0/prepare_native.py`).
     The verify took 11.5 min: 7,303 `available`, 230 `missing`, 36 `unverified` (shared), 0 conflicts. The apply
     fetches every object again under its lock, so `stats-worker` stays stopped about as long.
4. **Proofs on the frozen copy.** Restore `db-rank01.dump` into a throwaway PostgreSQL 18 (for example a temporary
   `postgres:18.1` container on home). Name the database `$DB_NAME`: the receipt records the name. On that copy run:
   - `discipline01_reconcile.sql` (every class ok);
   - the `NOT convalidated` query (empty);
   - `enclayer01_reconcile.sql`;
   - `mixround01_reconcile.sql`, whose seat class may report a false MISMATCH because it still expects the old text
     table ([P2 :111-113](../multi-game-p2-roles-release.md));
   - then `stats01_reconcile.py --mode capture` and `--mode check`
     ([backend/README.md](../../backend/README.md#p4-statistics-cutover-stats01--stats01a); dev: 98 + 55 min).

   Keep the outputs and the receipt with the dumps. A discrepancy is fixed forward from this copy: its legacy tables
   still hold every original row ([backend-cleanup §5](./2026-10-21-backend-cleanup.md#5-legacy-storage-drop-legacy01)).
5. **Off-host copy and the Release.**
   ```bash
   docker run --rm --env-file "$S3ENV" -v "$CUT:/data:ro" rclone/rclone \
     copy /data "tw:$BUCKET/pg/$HOSTTAG/cutover-$TAG/" --s3-no-check-bucket --stats-one-line
   ```
   Then unset `DEPLOY_FREEZE` and dispatch the workflow with `tag=$TAG`, `skip_build=true`. Its deploy is a no-op:
   same checkout, images present, alembic at head, `prod-up` unchanged. Its `release` job writes the GitHub Release.
6. **Watch for an hour:** `stats-svc` latency and CPU on cold caches, DLQ growth, gateway shedding. Post in Discord.
7. **Changelog and the release post.** In a private window (signed out) on the platform host: the release card sits
   under the header and opens `/changelog#v2.0.0`; closed, it stays closed after a reload; the footer version chip
   opens the same entry. `/changelog` reads in RU and EN. Then post in Discord:
   ```text
   Вышла OWT 2.0, сайт снова работает. Что нового:
   - Четыре игры: к Overwatch добавились League of Legends, Deadlock и VALORANT. Игру выбирает переключатель в шапке.
   - Миксы: у каждого лобби своя комната, капитанский драфт и баны героев, а в LoL и Deadlock ещё и пики.
   - Статистика за всё время: альманах турниров и рейтинг «Кто играет лучше всех?».
   - Вход через Steam: войдите или привяжите Steam, и ранг в Deadlock появится в профиле сам.
   Подробно и со скриншотами: https://owt.craazzzyyfoxx.me/changelog
   ```

## 6. Rollback

Any failed migration, a failed smoke, or reaching **X** (T+50) with W8 unfinished means rollback. The same holds after
`legacy01` committed. No downgrade exists: `stats01`, `enclayer01`, `ingest01`, `achievement06` and `legacy01` are
forward-only.

**Before W3** (nothing written): `rm -f nginx/maintenance/on nginx/maintenance/maintenance.json`, then
`TAG=v1.48.1 PROD_SIZE=$PROD_SIZE bash ops/deploy/remote-deploy.sh`. It checks out v1.48.1 (whose nginx has no
maintenance switch, so the old site opens), runs a no-op migration and starts the old stack. Clear the flag first: the
files are untracked and survive the checkout, and the next deploy of the new tag would come up behind the page.

**From W3 on:**

```bash
$C stop $($C ps --services | grep -vE '^(postgres|pgbouncer|redis|rabbitmq|proxy|nginx|alloy|nginx-exporter)$')
OWNER=$(docker exec "$CONTAINER" psql -U "$PGSUPER" -d postgres -Atc \
  "SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = '$DB_NAME'")
docker exec "$CONTAINER" psql -U "$PGSUPER" -d postgres \
  -c "DROP DATABASE \"$DB_NAME\" WITH (FORCE)" -c "CREATE DATABASE \"$DB_NAME\" OWNER \"$OWNER\""
docker cp "$CUT/db-pre.dump" "$CONTAINER:/tmp/db-pre.dump"
docker exec "$CONTAINER" pg_restore -U "$PGSUPER" -d "$DB_NAME" -j 4 /tmp/db-pre.dump   # dev, -j 2: 5 min
docker exec "$CONTAINER" rm /tmp/db-pre.dump
$C exec redis redis-cli -n 4 FLUSHDB                   # caches the new code wrote
rm -f nginx/maintenance/on nginx/maintenance/maintenance.json   # see "Before W3"
TAG=v1.48.1 PROD_SIZE=$PROD_SIZE bash ops/deploy/remote-deploy.sh
```

- The restore runs in the same cluster, so the roles and owners in the dump already exist.
- Objects the new code wrote to S3 (`stats/raw/…`, `stats/documents/…`) are unreferenced after the restore, and
  harmless ([P5 §13](./2026-10-15-multi-game-p5-ingest.md#13-p9-maintenance-release-old-queues-drain-rollback)).
- Queues the new images declared have no consumers. Delete them, or let their alerts point at them.
- Expire the silence, and post in Discord that the release moved.
