# Бэкапы: rustfs на dd-new + реплика на home

Контур для дампов Postgres и секретов, устроенный так, чтобы **смерть dd-new не
уносила бэкапы вместе с собой**. Два одиночных инстанса
[rustfs](https://github.com/rustfs/rustfs) (S3-совместимое хранилище на Rust),
между ними — нативная **bucket replication**.

Всё, что здесь описано, проверено локально на двух реальных инстансах
`rustfs/rustfs:1.0.0-rc.1` (см. §9): репликация, ограниченный ключ,
восстановление дампа из реплики, расшифровка tar с секретами.

---

## 1. Что от чего защищает

| Сценарий | Что спасает |
|---|---|
| dd-new физически потерян (провайдер, диск, шифровальщик) | Полная копия на home: дамп, роли кластера, env-файлы, acme.json, топология RabbitMQ |
| Испорчен один объект (битрот) | Вторая копия. На одном диске у rustfs **нулевой паритет** — битрот детектируется, но не лечится (`docs/operations/no-parity-bitrot-recovery.md` в апстриме) |
| `rm` на источнике — руками, багом или шифровальщиком | Удаления **не реплицируются**, и ключ, которым dd-new пишет в home, **не имеет права на delete** |
| Сломанный дамп («файл есть, а восстановиться нельзя») | Каждый дамп перед выгрузкой прогоняется через `pg_restore` целиком |
| Бэкап молча перестал делаться | Алерты по возрасту метрики, а не по её значению (`monitoring/prometheus/rules/backup.yml`) |

Чего этот контур **не** делает: это не PITR. Гранулярность — сутки (дамп по
таймеру). Нужен PITR — это отдельная история с WAL-архивом.

---

## 2. Как устроено

```mermaid
flowchart LR
  subgraph ddnew["dd-new (прод)"]
    PG[("db_postgres<br/>PG 18")]
    JOB["backup.sh<br/>systemd timer 03:17 UTC"]
    SRC["rustfs :9000<br/>127.0.0.1 only"]
    NE["node-exporter<br/>textfile"]
    PG -->|"pg_dump -Fc"| JOB
    JOB -->|"PutObject"| SRC
    JOB -->|"owt_backup.prom"| NE
  end
  subgraph home["home (реплика)"]
    CADDY["caddy :443<br/>ACME"]
    DST["rustfs :9000"]
    CADDY --> DST
  end
  SRC -->|"bucket replication<br/>ключ без delete"| CADDY
  JOB -.->|"проверка: объект есть в реплике?"| CADDY
```

Ключевые решения и причины:

- **Bucket replication, а не site replication.** У site replication открытый баг
  rustfs [#5963](https://github.com/rustfs/rustfs/issues/5963): при расхождении
  состояния пиров она молча перестаёт репллицировать, продолжая отвечать
  «Enabled / 2 sites». Для бэкапов это худший режим отказа из возможных.
- **Удаления не реплицируются.** `mc replicate add` по умолчанию ставит
  `DeleteMarkerReplication=Disabled` и `DeleteReplication=Disabled` — проверено,
  см. вывод `mc replicate export` в §9. Поэтому `rm` на dd-new не доходит до home.
- **Ключ реплики — append-only.** `setup.sh` создаёт на home пользователя с
  политикой без `s3:DeleteObject`/`s3:DeleteObjectVersion`. Проверено: `rm`,
  `rm --version-id` и `mb` этим ключом получают `Access Denied`.
- **Retention на каждой площадке свой** (ILM, `KEEP_DAYS`). Раз удаления не
  реплицируются, истечение срока на источнике не удаляет копию на home; каждая
  сторона чистит себя сама. Побочный эффект — приятный: скомпрометированный
  dd-new не может проредить архив на home.
- **`RUSTFS_DURABILITY_MODE=strict` и `RUSTFS_NEW_BUCKET_DURABILITY_MODE=strict`**
  в обоих compose. Вторая переменная обязательна: **новые бакеты создаются в
  `relaxed`**, где `xl.meta` и inline-объекты не fsync'ятся, и при потере питания
  подтверждённая запись может остаться без метаданных.
- **Успех прогона = объект есть в РЕПЛИКЕ.** Репликация асинхронная; 200 на
  PutObject ничего не доказывает. `backup.sh` ждёт подтверждения (до
  `REPL_WAIT_SECONDS`) и только тогда пишет метрику успеха.
- **Тег образа пинуется.** Docker-тег `latest` у rustfs протух (обновлён
  2026-07-30, до релиза `1.0.0-rc.1` от 2026-08-08).

Файлы:

| Путь | Что |
|---|---|
| `docker-compose.backup.yml` | rustfs-источник на dd-new (проект `owt-backup`) |
| `ops/backup/compose.home.yml` + `Caddyfile` | rustfs-реплика + TLS на home |
| `ops/backup/backup.env.example` | конфиг обеих сторон (копируется в `backup.env`, не коммитится) |
| `ops/backup/setup.sh` | идемпотентная настройка: бакеты, версионирование, ILM, ключ, правило репликации, проверка round-trip |
| `ops/backup/backup.sh` | сам прогон: дамп → проверка → выгрузка → подтверждение реплики → метрики |
| `ops/backup/lib.sh` | общее: конфиг, обёртка над `mc` в контейнере |
| `ops/backup/systemd/` | таймер и юнит |
| `monitoring/prometheus/rules/backup.yml` | алерты |

`mc` и `pg_dump` нигде не устанавливаются на хост: первый запускается образом
`minio/mc`, второй берётся **из контейнера Postgres** — так версия клиента
гарантированно совпадает с сервером, а пароль не покидает контейнер.

---

## 3. Установка

### 3.0. Конфиг (на обоих хостах один и тот же файл)

```bash
cp ops/backup/backup.env.example ops/backup/backup.env
chmod 600 ops/backup/backup.env
# пароли — только из генератора, [A-Za-z0-9+/=]:
openssl rand -base64 30
```

Заполнить: `RUSTFS_ROOT_*`, `HOME_RUSTFS_ROOT_*`, `REPL_*`, `HOME_S3_DOMAIN`,
`HOME_S3_URL`, `ACME_EMAIL`, `PG_CONTAINER`, `PG_DATABASES`.

> Символы вне `[A-Za-z0-9+/=._~-]` в ключах запрещены и отсекаются на старте:
> `mc` принимает креды только внутри URL и **не** percent-декодирует их, поэтому
> `@`, `:` и `%` в пароле дают загадочное `signature does not match`.

### 3.1. home (сначала реплика — источнику нужно, куда писать)

DNS: `A`-запись `$HOME_S3_DOMAIN` на домашний IP, порты 80 и 443 проброшены на
сервер (80 нужен ACME).

```bash
# каталоги: контейнер работает под uid:gid 10001:10001
install -d -o 10001 -g 10001 /srv/owt-backup/rustfs/data /srv/owt-backup/rustfs/logs
install -d /srv/owt-backup/caddy/data /srv/owt-backup/caddy/config

cd ops/backup
docker compose -f compose.home.yml --env-file backup.env up -d
docker compose -f compose.home.yml --env-file backup.env ps   # rustfs healthy
curl -fsS https://$HOME_S3_DOMAIN/health && echo OK           # сертификат выпущен
```

Файрвол: реплика — не публичный сервис. Оставить 443 только для dd-new и своего
адреса:

```bash
ufw allow from <IP dd-new> to any port 443 proto tcp
ufw allow from <свой IP>   to any port 443 proto tcp
# 80 нужен только на время выпуска/продления сертификата
```

### 3.2. dd-new (источник)

```bash
install -d -o 10001 -g 10001 /srv/owt-backup/rustfs/data /srv/owt-backup/rustfs/logs
install -d /etc/owt-backup && openssl rand -base64 32 > /etc/owt-backup/secrets.pass
chmod 600 /etc/owt-backup/secrets.pass
```

> `/etc/owt-backup/secrets.pass` — ключ от tar'а с секретами. **Скопировать его в
> менеджер паролей и убедиться, что копия есть вне обоих хостов.** Потерян ключ —
> потеряно содержимое `configs/*.tar.gz.enc` (env-файлы, acme.json, rabbitmq).

```bash
make backup-up      # поднять rustfs-источник (слушает только 127.0.0.1:9000)
make backup-setup   # бакеты, версионирование, ILM, ключ реплики, репликация + проверка
make backup-run     # первый прогон целиком
```

`backup-setup` в конце сам пишет пробный объект и ждёт его появления на home —
если он сказал `OK`, канал живой.

### 3.3. Таймер

```bash
cp ops/backup/systemd/owt-backup.{service,timer} /etc/systemd/system/
# ExecStart в .service указывает на фактический путь чекаута — проверить
systemctl daemon-reload
systemctl enable --now owt-backup.timer
systemctl list-timers owt-backup.timer
```

### 3.4. Метрики и алерты

```bash
install -d /var/lib/node_exporter/textfile          # сюда пишет backup.sh
make monitoring-down && make monitoring-up          # подхватить textfile collector
curl -X POST http://localhost:9090/-/reload         # перечитать rules/backup.yml
```

Проверка, что метрики видны:

```promql
owt_backup_last_replica_success_timestamp_seconds
```

---

## 4. Что должно быть видно в норме

```bash
make backup-ls                      # объекты на home
mc replicate export local/owt-backups   # правило: Delete*Replication = Disabled
journalctl -u owt-backup -n 50      # последний прогон
cat /var/lib/node_exporter/textfile/owt_backup.prom
```

Раскладка ключей в бакете:

```
postgres/<db>/<год>/<db>-<TS>.dump          + .sha256
postgres/globals/<год>/globals-<TS>.sql     + .sha256   # роли и права кластера
configs/<год>/configs-<TS>.tar.gz.enc       + .sha256   # env, acme.json, rabbitmq-defs (AES-256)
```

---

## 5. Восстановление

### 5.1. Обычное (dd-new жив) — берём с локального rustfs

Ниже `LOCAL` — алиас `local`, если запускаете через `ops/backup/lib.sh`;
в примерах — прямой `docker run`, чтобы процедура работала и на пустом хосте.

```bash
set -a; . ops/backup/backup.env; set +a
MC="docker run --rm -i -v /srv/restore:/work \
  -e MC_HOST_s=http://$RUSTFS_ROOT_USER:$RUSTFS_ROOT_PASSWORD@127.0.0.1:9000 \
  --entrypoint mc minio/mc"

mkdir -p /srv/restore
$MC ls --recursive s/$BACKUP_BUCKET/postgres/anak_dev/
$MC cp s/$BACKUP_BUCKET/postgres/anak_dev/2026/anak_dev-<TS>.dump        /work/dump
$MC cp s/$BACKUP_BUCKET/postgres/anak_dev/2026/anak_dev-<TS>.dump.sha256 /work/dump.sha256

# проверить целостность ДО восстановления
echo "$(cat /srv/restore/dump.sha256)  /srv/restore/dump" | sha256sum -c -

# восстановить в отдельную базу и только потом переключать приложение
docker exec -e PGPASSWORD="$PGPASSWORD" db_postgres psql -U <user> -d postgres \
  -c 'CREATE DATABASE anak_restore'
docker exec -i db_postgres pg_restore -U <user> -d anak_restore --no-owner < /srv/restore/dump
```

### 5.2. dd-new мёртв — работаем только с репликой

Ровно тот сценарий, ради которого всё это сделано. Всё то же, но алиас смотрит
на home и хватает root-кред реплики (у `REPL_*` нет прав на чтение вне записи —
он для репликации, не для восстановления):

```bash
MC="docker run --rm -i -v /srv/restore:/work \
  -e MC_HOST_r=https://$HOME_RUSTFS_ROOT_USER:$HOME_RUSTFS_ROOT_PASSWORD@$HOME_S3_DOMAIN \
  --entrypoint mc minio/mc"

$MC ls --recursive r/$BACKUP_BUCKET/
$MC cp r/$BACKUP_BUCKET/postgres/anak_dev/2026/anak_dev-<TS>.dump /work/dump
```

Полный порядок подъёма прода на новом хосте:

1. Поднять Postgres, применить `globals-<TS>.sql` (роли и права кластера — их в
   дампе базы нет, без них `GRANT` в дампе упадёт):
   `psql -U postgres -f globals.sql`
2. `createdb anak_dev` + `pg_restore -d anak_dev dump`
3. Расшифровать секреты и разложить env-файлы/acme.json:
   ```bash
   openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 \
     -pass file:/путь/к/secrets.pass -in configs-<TS>.tar.gz.enc | tar xzvf - -C /
   ```
   (в архиве пути сохранены от корня: `./etc/traefik/...`, `./root/.../backend/env/...`)
4. Импортировать топологию RabbitMQ:
   `rabbitmqctl import_definitions /path/rabbitmq-definitions.json`
5. Поднять стек, затем **пересобрать контур бэкапов в обратную сторону**: на новом
   хосте `make backup-up && make backup-setup`. Архив с home при этом можно
   залить назад: `mc mirror --preserve r/owt-backups local/owt-backups`.

---

## 6. Регулярное обслуживание

| Когда | Что |
|---|---|
| Первая неделя после установки | Убедиться глазами, что ILM реально удаляет: у rustfs Lifecycle помечен в README как «Under Testing». `mc ls --versions local/owt-backups/postgres/<db>/<год>/` — старые версии должны исчезать через `KEEP_NONCURRENT_DAYS` |
| Раз в месяц | Учебное восстановление по §5.2 (именно из реплики, а не из локального rustfs) в отдельную базу + `select count(*)` по нескольким таблицам |
| При смене пароля Postgres/RabbitMQ | Прогнать `make backup-run` вручную — в tar с секретами попадут новые значения |
| При росте базы | Проверить свободное место на обоих хостах: у одиночного диска нет ни паритета, ни настраиваемого резерва под заполнение |

Изменить срок хранения: `KEEP_DAYS`/`KEEP_NONCURRENT_DAYS` в `backup.env`, затем
`make backup-setup` (ILM импортируется целиком, дубликатов правил не будет).

Нужен «месячный» слой глубже 30 дней — самый простой путь: в `backup.sh` после
выгрузки первого числа месяца делать серверную копию в отдельный префикс
(`mc cp local/... local/.../monthly/...`) и добавить в ILM правило с фильтром по
этому префиксу и своим сроком.

---

## 7. Отказы и что делать

| Симптом | Причина / что смотреть |
|---|---|
| `BackupMissing` | Таймер не сработал: `systemctl status owt-backup.timer`, `journalctl -u owt-backup` |
| `BackupReplicaStale` | Дамп есть, копии нет. home недоступен (`curl https://$HOME_S3_DOMAIN/health`), TLS истёк, файрвол, или у ключа отобрали права. `mc replicate export local/owt-backups` |
| `битый дамп <db>` в логе | `pg_restore` не смог распаковать архив: чаще всего кончилось место в `BACKUP_TMP_DIR` или оборвался `docker exec` |
| `объект не доехал до реплики за Ns` | Смотреть `docker logs owt-backup-rustfs-1`; неудачные репликации живут в MRF-очереди и повторяются сами — после восстановления home догонит без ручных действий |
| `BackupDumpSuspiciouslySmall` | Дамп вдвое меньше обычного: проверить, что дампится нужная база |
| Нужно перегнать всё заново | `mc replicate resync start local/owt-backups --remote-bucket <arn>` |

---

## 8. Ограничения, о которых стоит помнить

- **rustfs 1.0.0-rc.1 — это RC**, GA-релиза не существует. Контур сознательно
  устроен так, что даже полная потеря одной площадки не теряет данные.
- **Один диск = нулевой паритет.** Битрот детектируется (GET вернёт
  `FileCorrupt`), но не восстанавливается. Восстановление — только со второй
  копии; именно поэтому копия обязательна, а не «желательна».
- **Lifecycle помечен апстримом как «Under Testing»** — см. §6, первая неделя.
- **`mc admin info` против rustfs не работает** (сервер отдаёт `{"info": …}`
  вложенным, madmin-go ждёт поля верхним уровнем). Ни один из скриптов на него не
  опирается; для проверки живости используется `mc ls` и `/health`.
- **Object Lock здесь не включён.** Immutability обеспечивается append-only
  ключом. Если захочется настоящий lock — только `GOVERNANCE`; репликация в
  бакет под `COMPLIANCE` в апстриме не покрыта ни одним тестом, а
  `?replication-check` против такого бакета гарантированно падает на Cleanup.
- Оба инстанса на одном хосте не заведутся без
  `RUSTFS_REPLICATION_ALLOW_LOOPBACK_TARGET=true`: loopback как replication
  target запрещён по умолчанию (защита от SSRF). Приватные адреса (WireGuard
  `10.x`, Tailscale `100.64.x`) разрешены без каких-либо allow-list'ов.

---

## 9. Что и как было проверено

Локально, на двух реальных инстансах `rustfs/rustfs:1.0.0-rc.1` в одной
docker-сети, плюс контейнер `postgres:18-alpine` с 20 000 строк:

| Проверка | Результат |
|---|---|
| `setup.sh` с нуля и повторно | Идемпотентен: второй прогон не плодит правила, ILM импортируется поверх |
| Правило репликации | `DeleteMarkerReplication=Disabled`, `DeleteReplication=Disabled`, `ExistingObjectReplication=Enabled` |
| Репликация объекта | Появляется в реплике за ~1–2 с, `sha256` совпадает побайтово; version-id сохраняется |
| Multipart (96 МиБ) | Реплицируется, `sha256` совпадает |
| `rm` на источнике | Delete-marker создаётся **только** на источнике; в реплике объект остаётся |
| Append-only ключ | `cp` — ok; `rm`, `rm --version-id`, `mb` — `Access Denied` |
| Репликация под append-only ключом | Работает |
| `backup.sh` целиком | Дамп → `pg_restore` проверка → 6 объектов выгружены → все 6 подтверждены в реплике → метрики записаны |
| Проверка целостности дампа | `pg_restore --list` **не** ловит усечение (возвращает 0) — поэтому используется полный `pg_restore -f /dev/null`, он ловит |
| Восстановление из реплики | Скачано, `sha256sum -c` ok, `pg_restore` в чистую базу, 20 000 строк на месте |
| tar с секретами | Расшифрован тем же `openssl enc -d`, пути внутри архива на месте |
| Конфиги | `docker compose config` для обоих compose, `caddy validate`, `promtool check config/rules`, `shellcheck -x` — чисто |

Что **не** проверялось и проверяется только временем: фактическое удаление по
ILM (нужны сутки+) и поведение при заполнении диска.
