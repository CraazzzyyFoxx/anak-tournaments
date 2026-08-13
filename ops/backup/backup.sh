#!/usr/bin/env bash
# ==============================================================================
# owt-backup — снятие дампов Postgres + шифрованного tar с секретами, выгрузка в
# локальный rustfs и ПРОВЕРКА, что копия доехала до реплики (home).
#
#   ops/backup/backup.sh [путь/к/backup.env]
#
# Запускается таймером systemd (ops/backup/systemd/). Метрики уходят в
# textfile collector node-exporter'а, алерты — monitoring/prometheus/rules/backup.yml.
#
# Свойства, на которые здесь всё держится:
#   * pg_dump берётся ИЗ контейнера Postgres — версия клиента = версия сервера,
#     пароль не покидает контейнер;
#   * каждый дамп ДО выгрузки прогоняется через `pg_restore -f /dev/null`
#     целиком: усечённый или битый архив не должен молча стать «бэкапом»;
#   * рядом с каждым объектом кладётся .sha256 — при восстановлении хватит
#     любого S3-клиента, без чтения user-metadata;
#   * успех = объект есть в РЕПЛИКЕ. Репликация асинхронная, 200 на PutObject
#     ничего не доказывает.
# ==============================================================================
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=ops/backup/lib.sh
source "$SCRIPT_DIR/lib.sh"
load_env "${1:-$SCRIPT_DIR/backup.env}"

: "${PG_CONTAINER:?}" "${PG_DATABASES:?}"
BACKUP_TMP_DIR="${BACKUP_TMP_DIR:-/var/tmp/owt-backup}"
REPL_WAIT_SECONDS="${REPL_WAIT_SECONDS:-900}"
TEXTFILE_DIR="${TEXTFILE_DIR:-/var/lib/node_exporter/textfile}"

# --- метрики ------------------------------------------------------------------
PROM_FILE="$TEXTFILE_DIR/owt_backup.prom"
# Предыдущий успех переносим в новый файл: иначе упавший прогон обнулил бы
# метрику и алерт «бэкапа не было N часов» потерял бы точку отсчёта.
prev_metric() {
	[[ -r "$PROM_FILE" ]] || { echo 0; return; }
	awk -v k="$1" '$1 == k { print $2 }' "$PROM_FILE" | tail -1 | grep -E '^[0-9.]+$' || echo 0
}
LAST_SUCCESS="$(prev_metric owt_backup_last_success_timestamp_seconds)"
LAST_REPLICA="$(prev_metric owt_backup_last_replica_success_timestamp_seconds)"

STARTED_AT="$(date +%s)"
STATUS=0
BYTES_TOTAL=0

write_metrics() {
	local now; now="$(date +%s)"
	mkdir -p "$TEXTFILE_DIR" || return 0
	cat > "$PROM_FILE.tmp" <<EOF
# HELP owt_backup_last_status 1 — последний прогон дошёл до конца, 0 — упал.
# TYPE owt_backup_last_status gauge
owt_backup_last_status $STATUS
# HELP owt_backup_last_attempt_timestamp_seconds Время последнего запуска.
# TYPE owt_backup_last_attempt_timestamp_seconds gauge
owt_backup_last_attempt_timestamp_seconds $STARTED_AT
# HELP owt_backup_last_success_timestamp_seconds Время последней успешной выгрузки в локальный rustfs.
# TYPE owt_backup_last_success_timestamp_seconds gauge
owt_backup_last_success_timestamp_seconds $LAST_SUCCESS
# HELP owt_backup_last_replica_success_timestamp_seconds Время, когда копия последний раз подтверждена в реплике (home).
# TYPE owt_backup_last_replica_success_timestamp_seconds gauge
owt_backup_last_replica_success_timestamp_seconds $LAST_REPLICA
# HELP owt_backup_last_duration_seconds Длительность последнего прогона.
# TYPE owt_backup_last_duration_seconds gauge
owt_backup_last_duration_seconds $(( now - STARTED_AT ))
# HELP owt_backup_last_bytes Суммарный размер выгруженных объектов последнего прогона.
# TYPE owt_backup_last_bytes gauge
owt_backup_last_bytes $BYTES_TOTAL
EOF
	mv "$PROM_FILE.tmp" "$PROM_FILE"
}

WORK_DIR=""
cleanup() {
	local rc=$?
	(( rc == 0 )) || log "прогон завершился с кодом $rc"
	write_metrics
	[[ -n "$WORK_DIR" && -d "$WORK_DIR" ]] && rm -rf "$WORK_DIR"
	return $rc
}
trap cleanup EXIT

command -v docker >/dev/null || die "нет docker"
command -v openssl >/dev/null || die "нет openssl (нужен для шифрования tar с секретами)"

mkdir -p "$BACKUP_TMP_DIR"
WORK_DIR="$(mktemp -d "$BACKUP_TMP_DIR/run.XXXXXXXX")"
chmod 700 "$WORK_DIR"
MC_MOUNT="$WORK_DIR"   # lib.sh: mc видит рабочий каталог как /work
TS="$(date -u +%Y%m%dT%H%M%SZ)"
YEAR="${TS:0:4}"

# Ключи, выгруженные этим прогоном: их и проверяем в реплике.
KEYS=()

# Кладём объект и его .sha256 в локальный rustfs; в KEYS пишем "ключ:размер" —
# размер уже известен здесь, так что проверке реплики не нужен второй stat.
upload() {
	local file="$1" key="$2" size sha_size
	size="$(stat -c %s "$file")"
	(( size > 0 )) || die "пустой файл $file"
	sha256sum "$file" | cut -d' ' -f1 > "$file.sha256"
	sha_size="$(stat -c %s "$file.sha256")"
	mc cp --quiet "/work/${file#"$WORK_DIR"/}" "local/$BACKUP_BUCKET/$key" >/dev/null
	mc cp --quiet "/work/${file#"$WORK_DIR"/}.sha256" "local/$BACKUP_BUCKET/$key.sha256" >/dev/null
	BYTES_TOTAL=$(( BYTES_TOTAL + size ))
	KEYS+=("$key:$size" "$key.sha256:$sha_size")
	log "выгружено $key ($size байт)"
}

# --- 1. дампы баз -------------------------------------------------------------
for db in $PG_DATABASES; do
	dump="$WORK_DIR/$db-$TS.dump"
	log "pg_dump $db"
	# -Fc: сжатый custom-формат, восстанавливается pg_restore выборочно.
	# --no-owner/--no-privileges НЕ ставим: роли хочется вернуть как были, а сами
	# роли лежат в globals ниже.
	docker exec "$PG_CONTAINER" sh -c \
		'PGPASSWORD="$POSTGRES_PASSWORD" exec pg_dump -U "$POSTGRES_USER" -d "$1" -Fc' \
		-- "$db" > "$dump"

	# Проверка целостности ДО выгрузки: обрыв docker exec или полный диск дают
	# файл, который выглядит нормально и не восстанавливается.
	# `pg_restore --list` тут бесполезен — он читает только TOC в начале архива
	# и на усечённом дампе возвращает 0 (проверено). Полный прогон в /dev/null
	# распаковывает все данные и падает на первом же обрыве.
	docker exec -i "$PG_CONTAINER" pg_restore -f /dev/null < "$dump" \
		|| die "битый дамп $db (pg_restore не смог распаковать архив целиком)"

	upload "$dump" "postgres/$db/$YEAR/$db-$TS.dump"
done

# --- 2. глобальные объекты кластера ------------------------------------------
# Роли и права НЕ попадают в pg_dump отдельной базы. Без них восстановление в
# чистый кластер падает на первом же GRANT.
globals="$WORK_DIR/globals-$TS.sql"
docker exec "$PG_CONTAINER" sh -c \
	'PGPASSWORD="$POSTGRES_PASSWORD" exec pg_dumpall -U "$POSTGRES_USER" --globals-only' > "$globals"
upload "$globals" "postgres/globals/$YEAR/globals-$TS.sql"

# --- 3. секреты и конфиги ----------------------------------------------------
# env-файлы, acme.json, топология rabbitmq. Лежит на домашнем диске и едет по
# сети — поэтому шифруем: парольная фраза хранится ВНЕ обоих хостов.
if [[ -n "${SECRETS_PASSPHRASE_FILE:-}" && -r "${SECRETS_PASSPHRASE_FILE:-}" ]]; then
	stage="$WORK_DIR/configs"
	mkdir -p "$stage"
	for path in ${BACKUP_CONFIG_PATHS:-}; do
		[[ -e "$path" ]] || { log "пропуск $path (нет)"; continue; }
		mkdir -p "$stage/$(dirname "$path")"
		cp -a "$path" "$stage/$path"
	done
	if [[ -n "${RABBITMQ_CONTAINER:-}" ]] && docker inspect "$RABBITMQ_CONTAINER" >/dev/null 2>&1; then
		# Через файл внутри контейнера, а не `export_definitions -`: rabbitmqctl
		# печатает в stdout служебные строки, которые попадают в JSON и делают его
		# невалидным.
		if docker exec "$RABBITMQ_CONTAINER" rabbitmqctl export_definitions /tmp/owt-defs.json >/dev/null; then
			docker exec "$RABBITMQ_CONTAINER" cat /tmp/owt-defs.json > "$stage/rabbitmq-definitions.json"
			docker exec "$RABBITMQ_CONTAINER" rm -f /tmp/owt-defs.json || true
		else
			log "export_definitions не удался, продолжаю без топологии rabbitmq"
		fi
	fi
	enc="$WORK_DIR/configs-$TS.tar.gz.enc"
	tar czf - -C "$stage" . \
		| openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -salt -pass "file:$SECRETS_PASSPHRASE_FILE" \
		> "$enc"
	upload "$enc" "configs/$YEAR/configs-$TS.tar.gz.enc"
else
	log "SECRETS_PASSPHRASE_FILE не задан/не читается — tar с секретами пропущен"
fi

LAST_SUCCESS="$(date +%s)"
write_metrics

# --- 4. подтверждение реплики -------------------------------------------------
# Единственная проверка, которая отвечает на исходный вопрос: «если dd-new умрёт
# прямо сейчас, дамп уже есть на home?»
log "жду появления ${#KEYS[@]} объектов в реплике (до ${REPL_WAIT_SECONDS}s)"
deadline=$(( $(date +%s) + REPL_WAIT_SECONDS ))
for entry in "${KEYS[@]}"; do
	key="${entry%:*}"
	want="${entry##*:}"
	while :; do
		got="$(mc stat --json "replica/$BACKUP_BUCKET/$key" 2>/dev/null \
			| tr ',' '\n' | awk -F: '/"size"/ { print $2; exit }')" || true
		[[ "$got" == "$want" ]] && { log "реплика ok: $key ($got байт)"; break; }
		(( $(date +%s) < deadline )) \
			|| die "объект $key не доехал до реплики за ${REPL_WAIT_SECONDS}s (ожидали $want байт, в реплике ${got:-нет объекта})"
		sleep 5
	done
done

LAST_REPLICA="$(date +%s)"
STATUS=1
log "готово: ${#KEYS[@]} объектов в обеих площадках"
