#!/bin/sh
set -eu

APP_DIR=/app
LOCKFILE="$APP_DIR/package-lock.json"
CHECKSUM_FILE="$APP_DIR/node_modules/.package-lock.cksum"

log() {
  printf '%s %s\n' "[frontend-dev]" "$*"
}

install_dependencies() {
  log "Installing dependencies with npm ci"
  npm ci
  mkdir -p "$APP_DIR/node_modules"
  cksum "$LOCKFILE" > "$CHECKSUM_FILE"
}

cd "$APP_DIR"

if [ -f "$LOCKFILE" ]; then
  current_checksum=$(cksum "$LOCKFILE")
  stored_checksum=""
  should_install=0

  if [ -f "$CHECKSUM_FILE" ]; then
    stored_checksum=$(cat "$CHECKSUM_FILE")
  fi

  if [ ! -d "$APP_DIR/node_modules" ]; then
    log "node_modules is missing"
    should_install=1
  elif [ ! -f "$CHECKSUM_FILE" ]; then
    log "Dependency checksum is missing"
    should_install=1
  elif [ "$current_checksum" != "$stored_checksum" ]; then
    log "package-lock.json changed"
    should_install=1
  elif ! npm ls --depth=0 >/dev/null 2>&1; then
    log "node_modules validation failed"
    should_install=1
  fi

  if [ "$should_install" -eq 1 ]; then
    install_dependencies
  else
    log "Dependencies are up to date"
  fi
else
  log "package-lock.json not found; skipping dependency sync"
fi

if [ "$#" -eq 0 ]; then
  set -- npm run dev -- --hostname 0.0.0.0 --port 3000
fi

exec "$@"
