#!/usr/bin/env bash
# Общая часть setup.sh и backup.sh: логи, конфиг, обёртка над mc.
# Не запускается самостоятельно — только source.

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
die() { log "FATAL: $*" >&2; exit 1; }

load_env() {
	local env_file="$1"
	[[ -r "$env_file" ]] || die "нет конфига $env_file (см. ops/backup/backup.env.example)"
	set -a
	# shellcheck disable=SC1090  # путь к конфигу известен только в рантайме
	source "$env_file"
	set +a

	: "${BACKUP_BUCKET:?не задан в $env_file}"
	: "${RUSTFS_ROOT_USER:?}" "${RUSTFS_ROOT_PASSWORD:?}"
	: "${HOME_S3_URL:?}" "${HOME_RUSTFS_ROOT_USER:?}" "${HOME_RUSTFS_ROOT_PASSWORD:?}"
	LOCAL_S3_URL="${LOCAL_S3_URL:-http://127.0.0.1:9000}"
	MC_IMAGE="${MC_IMAGE:-minio/mc}"
	# --network host, чтобы из контейнера были видны и 127.0.0.1:9000 (локальный
	# rustfs), и home по публичному имени. Переопределяется только для локальной
	# проверки внутри docker-сети.
	MC_NETWORK="${MC_NETWORK:-host}"
}

# Креды mc принимает только внутри URL (MC_HOST_*, --remote-bucket) и НЕ
# percent-декодирует их: `%2B` уезжает на сервер как есть и превращается в
# «signature does not match» (проверено на rustfs 1.0.0-rc.1). Поэтому вставляем
# как есть, но заранее отказываемся от символов, которые ломают разбор userinfo.
# `openssl rand -base64` (см. backup.env.example) даёт только [A-Za-z0-9+/=] —
# все они безопасны.
assert_url_safe_cred() {
	local name="$1" value="$2"
	[[ "$value" =~ ^[A-Za-z0-9+/=._~-]+$ ]] \
		|| die "$name содержит символы, которые ломают URL для mc (@ : % ? # пробел и т.п.). Сгенерируй: openssl rand -base64 30"
}

# scheme://host[:port] + креды -> scheme://user:pass@host[:port]
url_with_creds() {
	local url="$1" user="$2" pass="$3"
	assert_url_safe_cred "access key" "$user"
	assert_url_safe_cred "secret key" "$pass"
	printf '%s' "${url/:\/\//://$user:$pass@}"
}

# mc в контейнере: на хостах ничего доустанавливать не надо.
# Алиасы: local — rustfs на dd-new, replica — rustfs на home.
# $MC_MOUNT (если задан) монтируется в /work.
# -i обязателен: `mc ilm import` читает конфиг со stdin, а docker run без -i его
# не пробрасывает и падает с «Unable to read ILM configuration. EOF».
mc() {
	local mount=()
	[[ -n "${MC_MOUNT:-}" ]] && mount=(-v "$MC_MOUNT:/work")
	docker run --rm -i --network "$MC_NETWORK" \
		-e "MC_HOST_local=$(url_with_creds "$LOCAL_S3_URL" "$RUSTFS_ROOT_USER" "$RUSTFS_ROOT_PASSWORD")" \
		-e "MC_HOST_replica=$(url_with_creds "$HOME_S3_URL" "$HOME_RUSTFS_ROOT_USER" "$HOME_RUSTFS_ROOT_PASSWORD")" \
		"${mount[@]}" --entrypoint mc "$MC_IMAGE" "$@"
}
