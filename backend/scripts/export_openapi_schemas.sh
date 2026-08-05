#!/usr/bin/env bash
# Regenerate gateway/internal/openapi/schemas.json from each service's
# src/openapi_schemas.py. Run from anywhere:  bash backend/scripts/export_openapi_schemas.sh
#
# With --check the manifest is NOT written: the freshly exported document is
# compared against the committed one and a mismatch exits non-zero. That is the
# CI gate (.github/workflows/lint-backend.yml) — the manifest is hand-committed,
# so without it a stale schemas.json ships silently and the gateway advertises a
# contract the services no longer implement.
#
# Importing the schema modules instantiates each service's Settings(), so we feed
# dummy connection env — the export only builds Pydantic JSON Schemas and never
# connects to anything.
set -euo pipefail

check_only=0
if [ "${1:-}" = "--check" ]; then
  check_only=1
elif [ -n "${1:-}" ]; then
  echo "usage: $0 [--check]" >&2
  exit 2
fi

# Resolve every path with `cd` rather than `dirname`: on Git-for-Windows bash
# `pwd` returns a backslash path, and `dirname` (which only splits on `/`) then
# collapses it to ".". `cd` accepts both separators.
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"                  # backend/scripts
backend="$(cd "$here/.." && pwd)"                                     # backend
out="$(cd "$here/../../gateway/internal/openapi" && pwd)/schemas.json"
# Overridable so the script works where `uv` is not on a child shell's PATH
# (Git-for-Windows bash, some CI images). CI leaves it unset.
uv_bin="${UV:-uv}"

export POSTGRES_USER=x POSTGRES_PASSWORD=x POSTGRES_DB=x POSTGRES_HOST=x POSTGRES_PORT=5432
export REDIS_URL="redis://x:6379" RABBITMQ_URL="amqp://x" JWT_SECRET_KEY=x SECRET_KEY=x
# parser-service Settings() additionally require these (never used — schemas only).
export PROJECT_URL="http://x" CHALLONGE_USERNAME=x CHALLONGE_API_KEY=x

# Services that declare src/openapi_schemas.py. Extend as coverage grows.
services=(tournament-service app-service analytics-service balancer-service parser-service identity-service)

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

frags=()
for svc in "${services[@]}"; do
  if [ -f "$backend/$svc/src/openapi_schemas.py" ]; then
    echo "exporting $svc ..." >&2
    (cd "$backend/$svc" && "$uv_bin" run python "$here/export_openapi_schemas.py") > "$tmp/$svc.json"
    frags+=("$tmp/$svc.json")
  fi
done

# merge_openapi_schemas.py dumps with sort_keys=True, so the output is stable
# across runs and a byte comparison is a valid staleness check.
"$uv_bin" --project "$backend" run python "$here/merge_openapi_schemas.py" "${frags[@]}" > "$tmp/merged.json"

if [ "$check_only" -eq 1 ]; then
  if cmp -s "$tmp/merged.json" "$out"; then
    echo "schemas.json is up to date ($(wc -c < "$out") bytes)" >&2
    exit 0
  fi
  echo "ERROR: gateway/internal/openapi/schemas.json is STALE." >&2
  echo "The Pydantic models moved on but the manifest was not regenerated." >&2
  echo "Fix: bash backend/scripts/export_openapi_schemas.sh && git add gateway/internal/openapi/schemas.json" >&2
  echo "--- diff (committed -> expected) ---" >&2
  diff -u "$out" "$tmp/merged.json" >&2 || true
  exit 1
fi

cp "$tmp/merged.json" "$out"
echo "wrote $out ($(wc -c < "$out") bytes)" >&2
