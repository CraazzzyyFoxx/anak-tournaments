#!/usr/bin/env bash
# Runs ON the production host, piped in over ssh by
# .github/workflows/deploy-production.yml. It is deliberately a file rather than
# a heredoc inside the workflow: it is the part that can break production, so it
# should be readable, reviewable and runnable by hand.
#
# The caller prepends the variables below and pipes this script into
# `bash -euo pipefail -s`, so nothing sensitive ever appears in the remote
# process list:
#
#   TAG         git tag to check out; also the image tag to pull
#   PROD_SIZE   small | medium | large (replica counts, see the Makefile)
#   GHCR_USER   GitHub actor for `docker login ghcr.io`
#   GHCR_TOKEN  the workflow's own GITHUB_TOKEN -- valid for that run only
#
# Manual run (rollback without GitHub):
#   TAG=v1.2.3 PROD_SIZE=medium bash ops/deploy/remote-deploy.sh
# GHCR_TOKEN may be omitted once the packages are public.

set -euo pipefail

: "${TAG:?TAG is required}"
PROD_SIZE="${PROD_SIZE:-medium}"
REPO_DIR="${REPO_DIR:-/root/overwatch-tournaments}"
COMPOSE_FILE="docker-compose.production.yml"

cd "$REPO_DIR"

# The tag decides the code AND the images. Checking it out keeps the compose
# file, the Makefile and the migrations in step with what CI built; a dirty tree
# fails here on purpose instead of being forced over -- host-specific knobs
# (ANALYTICS_WORKER_CPUS, ports, secrets) belong in .env, which is untracked.
git fetch --tags --prune --force origin
git checkout --detach "refs/tags/${TAG}"

if [ -n "${GHCR_TOKEN:-}" ]; then
    echo "${GHCR_TOKEN}" | docker login ghcr.io -u "${GHCR_USER:-x}" --password-stdin
    trap 'docker logout ghcr.io >/dev/null 2>&1 || true' EXIT
fi

export IMAGE_TAG="${TAG}"
docker compose -f "${COMPOSE_FILE}" pull --quiet

# Migrations run from the NEW image while the OLD containers still serve. That
# order is what keeps a deploy from 500ing in between: every migration this
# project ships is additive, so old code tolerates the new schema, while new
# code cannot tolerate the old one.
#
# `-T` and `</dev/null`: `run` attaches the container to this script's stdin
# otherwise, and when the script itself arrives on stdin the container swallows
# the rest of it.
docker compose -f "${COMPOSE_FILE}" run --rm --no-deps -T app-svc alembic upgrade head </dev/null

make prod-up PROD_SIZE="${PROD_SIZE}"

docker compose -f "${COMPOSE_FILE}" ps --format '{{.Service}}|{{.State}}|{{.Health}}' | sort

# Dangling layers only. Previous releases' images stay on disk, which is what
# makes a rollback (re-run the workflow with the old tag) a local restart rather
# than a re-download.
docker image prune -f >/dev/null
