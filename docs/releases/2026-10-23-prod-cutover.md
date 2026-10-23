# Production cutover: v1.48.1 → one maintenance window

Production runs `v1.48.1` (2026-10-12). The next tag carries every release note dated 2026-10-15 to 2026-10-23 and
36 new migrations, including the maintenance-only cutovers: `enclayer01` and `matchmode01` take ACCESS EXCLUSIVE locks,
`stats01` copies every match in one transaction, and `legacy01` drops the legacy storage irreversibly. The tag-push deploy
(`ops/deploy/remote-deploy.sh`) migrates while the old stack serves, and that path cannot run any of these cutovers. So
the site goes behind a maintenance page, every writer stops, and the operator runs the steps below by hand. The window
is at most **3 hours**.

This file orders the work. The details of each cutover stay in the release notes it links. Section numbers like
"P1 :80" refer to the line of the linked file.

## Maintenance page

nginx answers 503 with a self-contained page (RU and EN, a countdown to the ETA, a reload every 60 s) while
`nginx/maintenance/on` exists. `/api/*` gets `{"detail":"maintenance"}`. `/health` still reaches the gateway, so the
container healthcheck and the blackbox probe tell the truth: silence alerts for the window. The mechanism is in
`nginx/nginx.conf` ("Maintenance mode"), and the directory is mounted in `docker-compose.production.yml`.

| Command (on the host) | Effect |
| --- | --- |
| `make maint-on MIN=150` | Writes the ETA (now + 150 min) and the flag. On first use it creates `nginx/maintenance/bypass.conf`, a random secret. It recreates nginx when the running one predates the mechanism. Prints the bypass snippet. Safe to repeat. |
| `make maint-eta MIN=40` | Moves the ETA to now + 40 min. Takes effect at once, and open pages pick it up within 60 s. |
| `make maint-off` | Removes the flag and the ETA. Open pages land on the site at their next reload. |

**Bypass.** Paste the printed `document.cookie = "owt_maint=…"` line into the browser console on the site, then reload.
That browser gets the real site and API, so you can test before reopening. The secret is 32 hex characters
(`openssl rand -hex 16`). A longer one overflows nginx's map hash and nginx refuses to start. `bypass.conf` is read when
nginx starts. `maint-on` recreates nginx whenever it writes a new secret.

`on`, `maintenance.json` and `bypass.conf` are gitignored, so `remote-deploy.sh`'s clean-checkout rule still holds.

## Shell setup on the host

Every command below assumes this, in `/root/overwatch-tournaments`:

```bash
export TAG=<the release tag>            # e.g. v1.49.0
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
PGOPT='-c statement_timeout=1800000 -c lock_timeout=5000'
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

1. **Images without a deploy.** Set the repo variable `DEPLOY_FREEZE=true`, then push the tag. The workflow builds and
   the host only pulls (`PULL_ONLY`). The running stack and the checkout stay as they are, and no Release is written.
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
   24 GB, so the home rows may run somewhat slower on Moscow.

   | Step | Dev | Where it ran |
   | --- | --- | --- |
   | Restore of the dump (250 MB custom format → 4.6 GB, `pg_restore -j 2`) | 5 min 06 s | Moscow |
   | `enclayer01` | 14 s | Moscow |
   | `discipline01`: the 27.9M-row hero remap | 14 min 33 s | Moscow |
   | `discipline01b` → `discipline01c` | 14 s | Moscow |
   | `stats01` → `stats01a`: copy, ANALYZE, MV 64 s, the in-migration relational proof 499 s | 18 min 06 s | home |
   | `regtpl01` → `drift01`: `schemasplit01`, `rank01`, `legacy01` dropping ~3.5 GB | 4 s | home |
   | `statrec01` → `owmapdrop01`: `matchmode01` backfilling 7,500 matches | under 2 min 17 s, image build included | home |
   | `pg_dump -Fc` (373–429 MB) | about 1 min | home |
   | P4 receipt `--mode capture` | 98 min | off-host, 2 CPU / 6 GB |
   | P4 receipt `--mode check` | 55 min | home, low priority |
   | Stack start until every service is healthy | 47 s | home |

   Not timed separately: `ingest01` → `regtpl01` and the mix migrations, which ran inside ordinary dev deploys, plus
   the SQL reconciles and the lobby recompute.

   **ETA for the page: `MIN=150`.** W1–W3 about 10 min, W4 35–45 min, W5 up to 20 min, W6 up to 25 min (the raw-log
   pass), W7 a few minutes, W8 about 20 min: about 1.5 h typical, a little over 2 h with every cap reached. **Point of no
   return X** = 180 min − (restore about 5 min + rollback deploy about 3 min) − 15 min ≈ 155 min.

   The P4 receipt (capture + check, about 2.5 h on dev) stays out of the window. Dev captured and checked it on this
   same 2026-10-16 data: 24/24 classes ok, 0 blocking. The fingerprint (§1.4, again in W2.5) proves production's
   statistics source is still that data, and `stats01a` re-runs its own full relational proof in production. The
   receipt itself is captured after the window from the frozen dump of W5, as a record.

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
   - open: dev is at `canonical01`, so `mixdraft01`, `mixdraft02`, `valorant01`, `mixpick01` and `socdn01` have not run
     on production-derived data yet. Deploy `develop` to dev before the window.
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

## 2. Window: close and drain

**W1. Maintenance on.**

```bash
git status --porcelain --untracked-files=no   # Moscow: " M docker-compose.production.yml" (alloy memory 1G), see below
git checkout -- docker-compose.production.yml # the tag already sets alloy to 1G; a dirty file blocks the checkout
git fetch --tags --prune --force origin && git checkout --detach "refs/tags/$TAG"
$C config -q                                  # env files and interpolation, before anything stops
make maint-on MIN=150                          # §1.3; keep the printed bypass line
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
   to §5 "Before W3". A changed fingerprint means the dev proof no longer covers the data, and the P4 receipt would
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
alembic upgrade discipline01      # commits the catalog remap on its own (dev: 14.5 min)
alembic upgrade rank01            # stats01/stats01a are the long part (dev: 18 min)
alembic current                   # rank01
```

A failure rolls its transaction back, but earlier commits stay. Read `alembic current` and never stamp past a failed
data rewrite ([P1](../multi-game-p1-catalog-release.md)). If `enclayer01b` is interrupted, `enclayer01` stays applied,
and re-running the upgrade resumes at `enclayer01b` ([encounter layer](../encounter-layer-v1-release.md)).

**W5. Freeze, then the SQL proofs, before the drop.**

```bash
# Frozen pre-drop state: the P4 receipt is captured from it after the window. Dev: about 1 min.
docker exec "$CONTAINER" pg_dump -U "$PGSUPER" -Fc -Z6 -d "$DB_NAME" > "$CUT/db-rank01.dump"
docker run --rm -v "$CUT:/b" postgres:18.1 pg_restore -l /b/db-rank01.dump > /dev/null && ls -lh "$CUT/db-rank01.dump"

pg < backend/scripts/discipline01_reconcile.sql > "$CUT/discipline01_reconcile.out"   # every class ok
pg -c "SELECT conrelid::regclass, conname FROM pg_constraint WHERE NOT convalidated" > "$CUT/unvalidated.out"  # empty
pg < backend/scripts/enclayer01_reconcile.sql  > "$CUT/enclayer01_reconcile.out"
pg < backend/scripts/mixround01_reconcile.sql  > "$CUT/mixround01_reconcile.out"
```

- Each must come back clean, as its runbook says ([backend-cleanup §5](./2026-10-21-backend-cleanup.md#5-legacy-storage-drop-legacy01)).
  The mixround seat class may report a false MISMATCH: its reconcile still expects the old text table
  ([P2 :111-113](../multi-game-p2-roles-release.md)).
- **Cap: 20 minutes for the four.** If they run longer, cancel (Ctrl-C, then confirm no `psql` backend is left in
  `pg_stat_activity`). Go on, and run them after the window on a copy restored from `db-rank01.dump`.
- **P4 receipt after the window.** Restore `db-rank01.dump` into a database named `$DB_NAME` on any spare PostgreSQL 18
  (the receipt records the database name). Then run `stats01_reconcile.py --mode capture`, and `--mode check` against
  the same copy ([backend/README.md](../../backend/README.md#p4-statistics-cutover-stats01--stats01a)). Dev: 98 + 55 min.
  Keep the receipt with the dumps.

**W6. The drop, then lobbies and raw logs (writers still stopped).**

```bash
$C run --rm --no-deps -T -e "PGOPTIONS=$PGOPT" -e "POSTGRES_HOST=$DB_HOST" -e "POSTGRES_PORT=$DB_PORT" \
  -e OWT_APPLY_LEGACY_DROP=1 app-svc alembic upgrade head   # dev: seconds
alembic current                   # the tag's head

cutrun python -m scripts.enclayer01_recompute_lobbies --dry-run
cutrun python -m scripts.enclayer01_recompute_lobbies   # without it every migrated lobby reads 0:0

# Old logs → verified: inspect every raw object in S3, then apply the classification as one transaction.
cutrun python scripts/stats01_prepare.py --verify-native-raw --report /cutover/native-proposal.json
python3 -c 'import json,sys,collections; r=json.load(open(sys.argv[1])); print(collections.Counter(x["raw_status"] for x in r["raw"]), "blockers:", len(r["blockers"]))' "$CUT/native-proposal.json"
python3 -c 'import json,sys; r=json.load(open(sys.argv[1])); r["review"]=sys.argv[3]; json.dump(r,open(sys.argv[2],"w"))' \
  "$CUT/native-proposal.json" "$CUT/native-reviewed.json" "prod cutover $TAG $(date -u +%F): applied as classified"
cutrun python scripts/stats01_prepare.py --apply-native-raw --manifest /cutover/native-reviewed.json \
  --manifest-sha256 "$(sha256sum "$CUT/native-reviewed.json" | cut -d' ' -f1)" --report /cutover/native-applied.json
```

- The flag lives in this one container only, so there is nothing to remove from `app.env` afterwards.
- The lobby recompute runs at head, not at `rank01`. Its ORM reads columns that later migrations add
  (`encounter.game.mode_id` and others). A second real run changes nothing
  ([encounter layer](../encounter-layer-v1-release.md)).
- **Raw logs.** A job becomes `available` (verified) only when its object is in S3, is processable, and matches any
  hash already recorded; an unknown hash is filled from the bytes. The rest is classified honestly:
  - `missing` when the object is gone;
  - `conflict` when the recorded hash differs;
  - `unverified` when one object is shared by several matches, or is unprocessable.

  The apply refuses any status other than the classification (`native_inspection_drift`). On the 2026-10-16 data the P4
  inventory found 153 missing keys, 1 hash conflict and 18 keys shared by 36 matches. Read the counter output before
  the apply. A `blockers` count above zero is S3 access failing: fix the credentials and verify again.
- **Cap: 20 minutes for the verify.** It fetches every object one by one (dev: 7,367 keys, 158 MB, not timed). If it
  runs past that, cancel and go to W7. Afterwards, run the verify against the live site: it is read-only. Then apply in
  a short closed spell: `make maint-on MIN=10`, `$C stop stats-worker`, apply, `$C start stats-worker`,
  `make maint-off`. The apply locks `stats.ingest_job` and `stats.match` and requires no writer.

## 4. Window: start, check, reopen

**W7. Start the new stack behind the page.**

```bash
$C up -d --no-deps --wait tournament-svc identity-svc   # they declare queues others publish to (mix-bans, steam names)
make prod-up PROD_SIZE=$PROD_SIZE                       # the rest; --remove-orphans drops parser-svc
make prod-discord-emoji
$C ps --format '{{.Service}}|{{.State}}|{{.Health}}' | sort
```

`app-svc` and `stats-svc` flush Redis db 4 at startup. The first statistics reads are cold and heavy.

**W8. Post-migration operator steps** (bypass cookie, superuser):

- Caches: the `fastapi:*` keys, as in [P1 :126-135](../multi-game-p1-catalog-release.md). Never `FLUSHALL`.
- Catalog syncs: `POST /api/v1/admin/catalog-sync/lol`, `/deadlock`, `/valorant`. Then set VALORANT `in_competitive`
  per map ([p8-lol](./2026-10-19-multi-game-p8-lol.md), [deadlock](./2026-10-21-deadlock.md),
  [valorant](./2026-10-23-valorant.md)).
- Discipline icons, when not in object storage yet:
  `$C run --rm --no-deps -T -w /app -v $PWD/frontend/public/disciplines:/d:ro app-svc python scripts/publish_discipline_assets.py --discipline valorant --file /d/valorant/icon.svg --key assets/valorant/icon.svg --publish`.
  Same for `deadlock` (`icon.png`).
- Games on: `PATCH /api/v1/workspaces/{id}` with `disciplines_enabled`. LoL rank collection starts off, Deadlock on
  ([riot-lol](./2026-10-21-riot-lol.md), [deadlock](./2026-10-21-deadlock.md)).
- Retired queues: `$C exec rabbitmq rabbitmqctl delete_queue <name>` for `cache_invalidation_app_service`,
  `analytics_train`, `analytics_infer` and their `.dlq`, and `process_match_log(.dlq)` once empty
  ([stats-owns-statistics-reads](./2026-10-23-stats-owns-statistics-reads.md), [backend-cleanup](./2026-10-21-backend-cleanup.md),
  [P5 §13](./2026-10-15-multi-game-p5-ingest.md#13-p9-maintenance-release-old-queues-drain-rollback)).
- Consumers: `rabbitmqctl list_queues name consumers` shows one per `stats.ingest.<game>` and `.replay`, and one on
  `match.ingested.tournament`.
- Smoke through the bypass: home, a tournament and an encounter, a user profile and its statistics, `/statistics`,
  admin, sign-in (including Riot and Steam), a mix room, `POST /api/v1/stats/matches` with a workspace key. The full
  lists are in [P1 :146-153](../multi-game-p1-catalog-release.md), [P2 :173-179](../multi-game-p2-roles-release.md)
  and [P3 :155-161](../multi-game-p3-ranks-release.md).

**W9. Reopen.**

```bash
make maint-off
docker exec owt-monitoring-alertmanager-1 amtool --alertmanager.url=http://localhost:9093 silence expire <id>
docker run --rm --env-file "$S3ENV" -v "$CUT:/data:ro" rclone/rclone \
  copy /data "tw:$BUCKET/pg/$HOSTTAG/cutover-$TAG/" --s3-no-check-bucket --stats-one-line   # proofs next to the dump
```

Then unset `DEPLOY_FREEZE` and dispatch the workflow with `tag=$TAG`, `skip_build=true`. Its deploy is a no-op: same
checkout, images present, alembic at head, `prod-up` unchanged. Its `release` job then writes the GitHub Release.

Watch for an hour: `stats-svc` latency and CPU on cold caches, DLQ growth, the gateway's shedding. Post in Discord.

## 5. Rollback

Any failed migration, failed proof, failed smoke, or reaching **X** with W8 unfinished means rollback. The same holds
after `legacy01` committed. No downgrade exists: `stats01`, `enclayer01`, `ingest01`, `achievement06` and `legacy01`
are forward-only.

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
