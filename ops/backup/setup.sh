#!/usr/bin/env bash
# ==============================================================================
# owt-backup — идемпотентная настройка контура: бакеты, версионирование, ILM,
# ограниченный пользователь на реплике и само правило репликации dd-new -> home.
#
#   ops/backup/setup.sh [путь/к/backup.env]
#
# Запускается с dd-new (нужен доступ и к локальному rustfs, и к $HOME_S3_URL).
# Можно прогонять повторно: каждый шаг перезаписывает состояние, а не плодит
# дубликаты. В конце — реальная проверка round-trip: объект пишется в источник и
# ожидается в реплике.
#
# Почему bucket replication, а не site replication: у site replication открытый
# баг rustfs #5963 — при расхождении состояния пиров она молча перестаёт
# репллицировать, при этом отвечая «Enabled / 2 sites». Для бэкапов это худший из
# возможных режимов отказа.
# ==============================================================================
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=ops/backup/lib.sh
source "$SCRIPT_DIR/lib.sh"
load_env "${1:-$SCRIPT_DIR/backup.env}"

: "${REPL_ACCESS_KEY:?}" "${REPL_SECRET_KEY:?}"
KEEP_DAYS="${KEEP_DAYS:-30}"
KEEP_NONCURRENT_DAYS="${KEEP_NONCURRENT_DAYS:-90}"

command -v docker >/dev/null || die "нет docker"

# Каталог отдаётся mc-контейнеру как /work (lib.sh), поэтому он должен быть
# монтируемым путём хоста, а не абстрактным /tmp.
MC_MOUNT="$(mktemp -d "${TMPDIR:-/tmp}/owt-backup-setup.XXXXXX")"
trap 'rm -rf "$MC_MOUNT"' EXIT

# --- 0. доступность обеих площадок -------------------------------------------
for alias in local replica; do
	mc ls "$alias/" >/dev/null 2>&1 \
		|| die "$alias недоступен или креды не подходят (local=$LOCAL_S3_URL replica=$HOME_S3_URL)"
	log "$alias доступен"
done

# --- 1. бакеты и версионирование ---------------------------------------------
# Версионирование обязательно с обеих сторон: rustfs отказывается настраивать
# remote target на неверсионированный бакет (и это правильно — без версий
# репликация не может отличить перезапись от новой версии).
for alias in local replica; do
	mc mb --ignore-existing "$alias/$BACKUP_BUCKET" >/dev/null
	mc version enable "$alias/$BACKUP_BUCKET" >/dev/null
	log "$alias/$BACKUP_BUCKET: бакет + версионирование"
done

# --- 2. retention (ILM) на обеих площадках, независимо ------------------------
# Именно независимо: delete-marker'ы НЕ реплицируются (см. правило ниже), значит
# истечение срока на источнике не удаляет копию на home. Каждая площадка чистит
# себя сама, и скомпрометированный dd-new не может проредить архив на home.
cat > "$MC_MOUNT/ilm.json" <<EOF
{"Rules":[{
  "ID":"owt-backup-retention",
  "Status":"Enabled",
  "Filter":{},
  "Expiration":{"Days":$KEEP_DAYS},
  "NoncurrentVersionExpiration":{"NoncurrentDays":$KEEP_NONCURRENT_DAYS},
  "AbortIncompleteMultipartUpload":{"DaysAfterInitiation":1}
}]}
EOF
for alias in local replica; do
	mc ilm import "$alias/$BACKUP_BUCKET" < "$MC_MOUNT/ilm.json" >/dev/null
	log "$alias/$BACKUP_BUCKET: retention ${KEEP_DAYS}d (старые версии +${KEEP_NONCURRENT_DAYS}d)"
done

# --- 3. ограниченный пользователь на реплике ---------------------------------
# Ключ, которым источник пишет в home. Без DeleteObject/DeleteObjectVersion:
# если dd-new угонят, стереть архив на home этим ключом нельзя (проверено —
# rustfs отдаёт Access Denied на rm, rm --version-id и mb).
cat > "$MC_MOUNT/policy.json" <<EOF
{"Version":"2012-10-17","Statement":[{
  "Effect":"Allow",
  "Action":[
    "s3:GetBucketLocation","s3:GetBucketVersioning","s3:ListBucket","s3:ListBucketVersions",
    "s3:ListBucketMultipartUploads","s3:ListMultipartUploadParts","s3:AbortMultipartUpload",
    "s3:GetObject","s3:GetObjectVersion","s3:GetObjectVersionTagging",
    "s3:PutObject","s3:PutObjectTagging",
    "s3:ReplicateObject","s3:ReplicateTags","s3:GetReplicationConfiguration"
  ],
  "Resource":["arn:aws:s3:::$BACKUP_BUCKET","arn:aws:s3:::$BACKUP_BUCKET/*"]
}]}
EOF
mc admin user add replica "$REPL_ACCESS_KEY" "$REPL_SECRET_KEY" >/dev/null
# Путь к файлу политики читает mc ВНУТРИ контейнера — только /work.
mc admin policy create replica owt-backup-write /work/policy.json >/dev/null
mc admin policy attach replica owt-backup-write --user "$REPL_ACCESS_KEY" >/dev/null 2>&1 || true
log "replica: пользователь $REPL_ACCESS_KEY с политикой owt-backup-write (без delete)"

# --- 4. правило репликации ----------------------------------------------------
# Дублировать правило нельзя: два правила с одним приоритетом — это конфликт,
# поэтому если правило уже есть, не трогаем его.
if mc replicate export "local/$BACKUP_BUCKET" 2>/dev/null | grep -q '"Rules":\[{'; then
	log "правило репликации уже настроено — пропускаю (сброс: mc replicate rm --all --force)"
else
	# --replicate existing-objects: то, что уже лежит в бакете, тоже уедет.
	# Удаления НЕ реплицируем — mc по умолчанию ставит DeleteMarkerReplication и
	# DeleteReplication в Disabled, и это именно то, что нужно архиву: `rm` на
	# источнике (руками, багом или шифровальщиком) не должен доходить до home.
	mc replicate add "local/$BACKUP_BUCKET" \
		--remote-bucket "$(url_with_creds "$HOME_S3_URL" "$REPL_ACCESS_KEY" "$REPL_SECRET_KEY")/$BACKUP_BUCKET" \
		--priority 1 \
		--replicate existing-objects
fi
mc replicate export "local/$BACKUP_BUCKET"

# --- 5. проверка round-trip ---------------------------------------------------
probe="owt-backup-setup-probe/$(date -u +%Y%m%dT%H%M%SZ)"
date -u +%s > "$MC_MOUNT/probe.txt"
mc cp --quiet /work/probe.txt "local/$BACKUP_BUCKET/$probe" >/dev/null
log "проверяю репликацию на объекте $probe"
for i in $(seq 1 60); do
	if mc stat "replica/$BACKUP_BUCKET/$probe" >/dev/null 2>&1; then
		log "OK: объект появился в реплике за ~${i}s"
		# Пробник удаляем только на источнике: на реплике удалять нечем (у
		# ограниченного ключа нет delete), да и ILM уберёт его сам через
		# ${KEEP_DAYS}d.
		mc rm "local/$BACKUP_BUCKET/$probe" >/dev/null
		log "готово. Дальше: ops/backup/systemd/ (таймер) и docs/backup-rustfs.md"
		exit 0
	fi
	sleep 2
done
die "объект не доехал до реплики за 120s — смотри 'docker logs owt-backup-rustfs-1' и mc replicate export"
