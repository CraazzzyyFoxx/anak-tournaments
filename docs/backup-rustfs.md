# Backups: rustfs on dd-new + replica on home

A setup for Postgres dumps and secrets, built so that **the death of dd-new does
not take the backups down with it**. Two standalone
[rustfs](https://github.com/rustfs/rustfs) instances (S3-compatible storage
written in Rust) with native **bucket replication** between them.

Everything described here has been verified locally on two real
`rustfs/rustfs:1.0.0-rc.1` instances (see §9): replication, the restricted key,
restoring a dump from the replica, decrypting the tar with secrets.

---

## 1. What protects against what

| Scenario | What saves you |
|---|---|
| dd-new is physically lost (provider, disk, ransomware) | A full copy on home: dump, cluster roles, env files, acme.json, RabbitMQ topology |
| A single object is corrupted (bitrot) | The second copy. On a single disk rustfs has **zero parity** — bitrot is detected but not repaired (`docs/operations/no-parity-bitrot-recovery.md` upstream) |
| `rm` on the source — by hand, by a bug or by ransomware | Deletions are **not replicated**, and the key dd-new writes to home with **has no delete permission** |
| A broken dump ("the file is there, but you cannot restore from it") | Every dump is run through `pg_restore` in full before upload |
| Backups silently stopped happening | Alerts on the age of the metric, not on its value (`monitoring/prometheus/rules/backup.yml`) |

What this setup does **not** do: it is not PITR. Granularity is one day (a dump
on a timer). If you need PITR, that is a separate story with a WAL archive.

---

## 2. How it works

```mermaid
flowchart LR
  subgraph ddnew["dd-new (prod)"]
    PG[("db_postgres<br/>PG 18")]
    JOB["backup.sh<br/>systemd timer 03:17 UTC"]
    SRC["rustfs :9000<br/>127.0.0.1 only"]
    NE["node-exporter<br/>textfile"]
    PG -->|"pg_dump -Fc"| JOB
    JOB -->|"PutObject"| SRC
    JOB -->|"owt_backup.prom"| NE
  end
  subgraph home["home (replica)"]
    CADDY["caddy :443<br/>ACME"]
    DST["rustfs :9000"]
    CADDY --> DST
  end
  SRC -->|"bucket replication<br/>key without delete"| CADDY
  JOB -.->|"check: is the object in the replica?"| CADDY
```

Key decisions and the reasons for them:

- **Bucket replication, not site replication.** Site replication has an open
  rustfs bug [#5963](https://github.com/rustfs/rustfs/issues/5963): when peer
  state diverges it silently stops replicating while continuing to report
  "Enabled / 2 sites". For backups that is the worst possible failure mode.
- **Deletions are not replicated.** By default `mc replicate add` sets
  `DeleteMarkerReplication=Disabled` and `DeleteReplication=Disabled` — verified,
  see the `mc replicate export` output in §9. So an `rm` on dd-new never reaches home.
- **The replication key is append-only.** `setup.sh` creates a user on home with
  a policy that has no `s3:DeleteObject`/`s3:DeleteObjectVersion`. Verified: `rm`,
  `rm --version-id` and `mb` with this key all get `Access Denied`.
- **Retention is per site** (ILM, `KEEP_DAYS`). Since deletions are not
  replicated, expiry on the source does not delete the copy on home; each side
  cleans up after itself. The side effect is a pleasant one: a compromised
  dd-new cannot thin out the archive on home.
- **`RUSTFS_DURABILITY_MODE=strict` and `RUSTFS_NEW_BUCKET_DURABILITY_MODE=strict`**
  in both compose files. The second variable is mandatory: **new buckets are created
  in `relaxed`**, where `xl.meta` and inline objects are not fsync'ed, and on power
  loss an acknowledged write can end up without metadata.
- **A successful run = the object is in the REPLICA.** Replication is
  asynchronous; a 200 on PutObject proves nothing. `backup.sh` waits for
  confirmation (up to `REPL_WAIT_SECONDS`) and only then writes the success metric.
- **The image tag is pinned.** The rustfs `latest` Docker tag is stale (updated
  2026-07-30, before the `1.0.0-rc.1` release of 2026-08-08).

Files:

| Path | What |
|---|---|
| `docker-compose.backup.yml` | the rustfs source on dd-new (project `owt-backup`) |
| `ops/backup/compose.home.yml` + `Caddyfile` | the rustfs replica + TLS on home |
| `ops/backup/backup.env.example` | config for both sides (copied to `backup.env`, not committed) |
| `ops/backup/setup.sh` | idempotent setup: buckets, versioning, ILM, key, replication rule, round-trip check |
| `ops/backup/backup.sh` | the run itself: dump → verify → upload → replica confirmation → metrics |
| `ops/backup/lib.sh` | shared: config, wrapper around `mc` in a container |
| `ops/backup/systemd/` | timer and unit |
| `monitoring/prometheus/rules/backup.yml` | alerts |

Neither `mc` nor `pg_dump` is installed on the host anywhere: the first runs from
the `minio/mc` image, the second is taken **from the Postgres container** — that
way the client version is guaranteed to match the server, and the password never
leaves the container.

---

## 3. Installation

### 3.0. Config (the same file on both hosts)

```bash
cp ops/backup/backup.env.example ops/backup/backup.env
chmod 600 ops/backup/backup.env
# passwords — from the generator only, [A-Za-z0-9+/=]:
openssl rand -base64 30
```

Fill in: `RUSTFS_ROOT_*`, `HOME_RUSTFS_ROOT_*`, `REPL_*`, `HOME_S3_DOMAIN`,
`HOME_S3_URL`, `ACME_EMAIL`, `PG_CONTAINER`, `PG_DATABASES`.

> Characters outside `[A-Za-z0-9+/=._~-]` are forbidden in keys and are rejected at
> startup: `mc` accepts credentials only inside a URL and does **not** percent-decode
> them, so `@`, `:` and `%` in a password produce a cryptic `signature does not match`.

### 3.1. home (the replica first — the source needs somewhere to write)

DNS: an `A` record for `$HOME_S3_DOMAIN` pointing at the home IP, ports 80 and 443
forwarded to the server (80 is needed for ACME).

```bash
# directories: the container runs as uid:gid 10001:10001
install -d -o 10001 -g 10001 /srv/owt-backup/rustfs/data /srv/owt-backup/rustfs/logs
install -d /srv/owt-backup/caddy/data /srv/owt-backup/caddy/config

cd ops/backup
docker compose -f compose.home.yml --env-file backup.env up -d
docker compose -f compose.home.yml --env-file backup.env ps   # rustfs healthy
curl -fsS https://$HOME_S3_DOMAIN/health && echo OK           # certificate issued
```

Firewall: the replica is not a public service. Leave 443 open only to dd-new and
to your own address:

```bash
ufw allow from <IP dd-new> to any port 443 proto tcp
ufw allow from <your IP>   to any port 443 proto tcp
# 80 is only needed while a certificate is being issued/renewed
```

### 3.2. dd-new (the source)

```bash
install -d -o 10001 -g 10001 /srv/owt-backup/rustfs/data /srv/owt-backup/rustfs/logs
install -d /etc/owt-backup && openssl rand -base64 32 > /etc/owt-backup/secrets.pass
chmod 600 /etc/owt-backup/secrets.pass
```

> `/etc/owt-backup/secrets.pass` is the key to the tar with secrets. **Copy it into a
> password manager and make sure a copy exists outside both hosts.** Lose the key and
> you lose the contents of `configs/*.tar.gz.enc` (env files, acme.json, rabbitmq).

```bash
make backup-up      # bring up the rustfs source (listens on 127.0.0.1:9000 only)
make backup-setup   # buckets, versioning, ILM, replication key, replication + check
make backup-run     # the first full run
```

At the end `backup-setup` writes a probe object itself and waits for it to appear on
home — if it said `OK`, the channel is alive.

### 3.3. Timer

```bash
cp ops/backup/systemd/owt-backup.{service,timer} /etc/systemd/system/
# ExecStart in the .service points at the actual checkout path — verify it
systemctl daemon-reload
systemctl enable --now owt-backup.timer
systemctl list-timers owt-backup.timer
```

### 3.4. Metrics and alerts

```bash
install -d /var/lib/node_exporter/textfile          # backup.sh writes here
make monitoring-down && make monitoring-up          # pick up the textfile collector
curl -X POST http://localhost:9090/-/reload         # re-read rules/backup.yml
```

Check that the metrics are visible:

```promql
owt_backup_last_replica_success_timestamp_seconds
```

---

## 4. What a healthy state looks like

```bash
make backup-ls                      # objects on home
mc replicate export local/owt-backups   # rule: Delete*Replication = Disabled
journalctl -u owt-backup -n 50      # the last run
cat /var/lib/node_exporter/textfile/owt_backup.prom
```

Key layout in the bucket:

```
postgres/<db>/<year>/<db>-<TS>.dump         + .sha256
postgres/globals/<year>/globals-<TS>.sql    + .sha256   # cluster roles and grants
configs/<year>/configs-<TS>.tar.gz.enc      + .sha256   # env, acme.json, rabbitmq-defs (AES-256)
```

---

## 5. Restore

### 5.1. Normal case (dd-new is alive) — take it from the local rustfs

Below, `LOCAL` is the `local` alias if you go through `ops/backup/lib.sh`;
the examples use a direct `docker run` so that the procedure also works on a bare host.

```bash
set -a; . ops/backup/backup.env; set +a
MC="docker run --rm -i -v /srv/restore:/work \
  -e MC_HOST_s=http://$RUSTFS_ROOT_USER:$RUSTFS_ROOT_PASSWORD@127.0.0.1:9000 \
  --entrypoint mc minio/mc"

mkdir -p /srv/restore
$MC ls --recursive s/$BACKUP_BUCKET/postgres/anak_dev/
$MC cp s/$BACKUP_BUCKET/postgres/anak_dev/2026/anak_dev-<TS>.dump        /work/dump
$MC cp s/$BACKUP_BUCKET/postgres/anak_dev/2026/anak_dev-<TS>.dump.sha256 /work/dump.sha256

# verify integrity BEFORE restoring
echo "$(cat /srv/restore/dump.sha256)  /srv/restore/dump" | sha256sum -c -

# restore into a separate database and only then switch the application over
docker exec -e PGPASSWORD="$PGPASSWORD" db_postgres psql -U <user> -d postgres \
  -c 'CREATE DATABASE anak_restore'
docker exec -i db_postgres pg_restore -U <user> -d anak_restore --no-owner < /srv/restore/dump
```

### 5.2. dd-new is dead — working from the replica only

Exactly the scenario all of this was built for. Everything is the same, but the
alias points at home and uses the replica's root credentials (`REPL_*` has no read
permission beyond writing — it is for replication, not for restore):

```bash
MC="docker run --rm -i -v /srv/restore:/work \
  -e MC_HOST_r=https://$HOME_RUSTFS_ROOT_USER:$HOME_RUSTFS_ROOT_PASSWORD@$HOME_S3_DOMAIN \
  --entrypoint mc minio/mc"

$MC ls --recursive r/$BACKUP_BUCKET/
$MC cp r/$BACKUP_BUCKET/postgres/anak_dev/2026/anak_dev-<TS>.dump /work/dump
```

The full order for bringing prod up on a new host:

1. Bring up Postgres, apply `globals-<TS>.sql` (cluster roles and grants — they are
   not in the database dump, and without them the `GRANT` statements in the dump
   will fail):
   `psql -U postgres -f globals.sql`
2. `createdb anak_dev` + `pg_restore -d anak_dev dump`
3. Decrypt the secrets and lay out the env files / acme.json:
   ```bash
   openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 \
     -pass file:/path/to/secrets.pass -in configs-<TS>.tar.gz.enc | tar xzvf - -C /
   ```
   (paths in the archive are preserved from the root: `./etc/traefik/...`, `./root/.../backend/env/...`)
4. Import the RabbitMQ topology:
   `rabbitmqctl import_definitions /path/rabbitmq-definitions.json`
5. Bring up the stack, then **rebuild the backup setup in the opposite direction**: on
   the new host run `make backup-up && make backup-setup`. The archive from home can
   be pushed back at that point: `mc mirror --preserve r/owt-backups local/owt-backups`.

---

## 6. Routine maintenance

| When | What |
|---|---|
| The first week after installation | Confirm with your own eyes that ILM actually deletes: in rustfs, Lifecycle is marked "Under Testing" in the README. `mc ls --versions local/owt-backups/postgres/<db>/<year>/` — old versions must disappear after `KEEP_NONCURRENT_DAYS` |
| Monthly | A restore drill per §5.2 (from the replica specifically, not from the local rustfs) into a separate database + `select count(*)` on a few tables |
| When the Postgres/RabbitMQ password changes | Run `make backup-run` by hand — the new values then land in the tar with secrets |
| As the database grows | Check free space on both hosts: a single disk has neither parity nor a configurable reserve against filling up |

To change the retention period: `KEEP_DAYS`/`KEEP_NONCURRENT_DAYS` in `backup.env`,
then `make backup-setup` (ILM is imported as a whole, so no duplicate rules).

If you need a "monthly" tier deeper than 30 days, the simplest path: in `backup.sh`,
after the upload on the first day of the month, make a server-side copy into a
separate prefix (`mc cp local/... local/.../monthly/...`) and add an ILM rule
filtered on that prefix with its own period.

---

## 7. Failures and what to do

| Symptom | Cause / where to look |
|---|---|
| `BackupMissing` | The timer did not fire: `systemctl status owt-backup.timer`, `journalctl -u owt-backup` |
| `BackupReplicaStale` | The dump exists, the copy does not. home is unreachable (`curl https://$HOME_S3_DOMAIN/health`), TLS expired, firewall, or the key lost its permissions. `mc replicate export local/owt-backups` |
| `FATAL:` in the log naming a broken dump for `<db>` (emitted by `backup.sh` right after the `pg_restore -f /dev/null` check) | `pg_restore` could not unpack the archive in full: most often `BACKUP_TMP_DIR` ran out of space or the `docker exec` was interrupted |
| `FATAL:` in the log naming an object that did not reach the replica within `REPL_WAIT_SECONDS` | Look at `docker logs owt-backup-rustfs-1`; failed replications live in the MRF queue and are retried automatically — once home is back it catches up without manual action |
| `BackupDumpSuspiciouslySmall` | The dump is half its usual size: check that the right database is being dumped |
| Everything needs to be re-pushed | `mc replicate resync start local/owt-backups --remote-bucket <arn>` |

---

## 8. Limitations worth keeping in mind

- **rustfs 1.0.0-rc.1 is an RC**, there is no GA release. The setup is deliberately
  built so that even the total loss of one site does not lose data.
- **One disk = zero parity.** Bitrot is detected (a GET returns `FileCorrupt`) but
  not repaired. Recovery comes only from the second copy; that is exactly why the
  copy is mandatory, not "nice to have".
- **Lifecycle is marked "Under Testing" upstream** — see §6, the first week.
- **`mc admin info` does not work against rustfs** (the server returns `{"info": …}`
  nested, while madmin-go expects the fields at the top level). None of the scripts
  rely on it; `mc ls` and `/health` are used for liveness checks.
- **Object Lock is not enabled here.** Immutability is provided by the append-only
  key. If you ever want a real lock, use `GOVERNANCE` only; replication into a bucket
  under `COMPLIANCE` is not covered by a single test upstream, and
  `?replication-check` against such a bucket is guaranteed to fail during Cleanup.
- Both instances on one host will not start without
  `RUSTFS_REPLICATION_ALLOW_LOOPBACK_TARGET=true`: loopback as a replication target
  is forbidden by default (SSRF protection). Private addresses (WireGuard `10.x`,
  Tailscale `100.64.x`) are allowed without any allow-lists.

---

## 9. What was verified and how

Locally, on two real `rustfs/rustfs:1.0.0-rc.1` instances in one docker network,
plus a `postgres:18-alpine` container with 20,000 rows:

| Check | Result |
|---|---|
| `setup.sh` from scratch and again | Idempotent: the second run does not multiply rules, ILM is imported over the top |
| Replication rule | `DeleteMarkerReplication=Disabled`, `DeleteReplication=Disabled`, `ExistingObjectReplication=Enabled` |
| Object replication | Appears in the replica in ~1–2 s, `sha256` matches byte for byte; the version-id is preserved |
| Multipart (96 MiB) | Replicated, `sha256` matches |
| `rm` on the source | The delete marker is created **only** on the source; the object stays in the replica |
| Append-only key | `cp` — ok; `rm`, `rm --version-id`, `mb` — `Access Denied` |
| Replication under the append-only key | Works |
| `backup.sh` end to end | Dump → `pg_restore` check → 6 objects uploaded → all 6 confirmed in the replica → metrics written |
| Dump integrity check | `pg_restore --list` does **not** catch truncation (returns 0) — which is why the full `pg_restore -f /dev/null` is used, and it does catch it |
| Restore from the replica | Downloaded, `sha256sum -c` ok, `pg_restore` into a clean database, all 20,000 rows present |
| tar with secrets | Decrypted with the same `openssl enc -d`, paths inside the archive intact |
| Configs | `docker compose config` for both compose files, `caddy validate`, `promtool check config/rules`, `shellcheck -x` — clean |

What was **not** verified and can only be verified by time: actual deletion by ILM
(needs a day or more) and behaviour when the disk fills up.
