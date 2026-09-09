#!/usr/bin/env bash
# Render release notes for a tag from the Conventional Commit subjects since the
# previous tag. Prints markdown on stdout.
#
#   ops/release/changelog.sh v1.2.0            # notes for v1.2.0
#   ops/release/changelog.sh v1.2.0 v1.1.1     # ...against an explicit base
#
# Why not `gh release create --generate-notes`: GitHub builds those from merged
# PR titles, and this repository ships one `develop -> master` PR per batch, so
# every release would read "Merge pull request #134". The commit subjects are
# the real log, and they are already disciplined (`type(scope): subject`).
#
# Merge commits are skipped for the same reason. A `!` after the type (or a
# `BREAKING CHANGE:` trailer) promotes the commit to its own section at the top,
# which is the one thing a reader must not scroll past.

set -euo pipefail

TAG="${1:?usage: changelog.sh <tag> [previous-tag]}"
PREV="${2:-}"

if [ -z "$PREV" ]; then
    # The tag before this one on the same history. Absent (first release ever)
    # means "everything", so the range degrades to the root commit.
    PREV="$(git describe --tags --abbrev=0 "${TAG}^" 2>/dev/null || true)"
fi
RANGE="${PREV:+${PREV}..}${TAG}"

REPO_URL="$(git config --get remote.origin.url | sed -e 's/\.git$//' -e 's#git@github.com:#https://github.com/#')"

# %x1f between fields, %x1e between records: commit subjects contain everything
# else, including newlines once a body sneaks in.
LOG="$(git log --no-merges --reverse --pretty=format:'%h%x1f%s%x1f%b%x1e' "$RANGE")"

render() {
    local heading="$1" pattern="$2" body
    body="$(printf '%s' "$LOG" | awk -v RS='\x1e' -v FS='\x1f' -v pat="$pattern" -v repo="$REPO_URL" '
        {
            # git separates records with a newline of its own, so every field
            # after the first record carries it into the sha.
            sha = $1; gsub(/^[\r\n]+|[\r\n]+$/, "", sha)
            if (sha == "") next
            subject = $2
            # Dependabot does not speak Conventional Commit; its subjects start
            # with an arrow. They are real changes and get their own section
            # rather than being lumped in with hand-written chores.
            if (index(subject, "⬆") == 1) { if (pat != "DEPS") next }
            else if (pat == "DEPS") next
            if (pat == "DEPS") {
                printf "- %s ([%s](%s/commit/%s))\n", substr(subject, index(subject, " ") + 1), sha, repo, sha
                next
            }
            # type(scope)!: subject  ->  type, scope, subject
            if (match(subject, /^[a-z]+(\([^)]*\))?!?: /) == 0) next
            head = substr(subject, 1, RLENGTH - 2)
            text = substr(subject, RLENGTH + 1)
            breaking = (index(head, "!") > 0) || (index($3, "BREAKING CHANGE") > 0)
            type = head
            scope = ""
            if (match(type, /\(/)) {
                scope = substr(type, RSTART + 1, index(type, ")") - RSTART - 1)
                type = substr(type, 1, RSTART - 1)
            }
            sub(/!$/, "", type)
            if (pat == "BREAKING") { if (!breaking) next }
            else {
                if (breaking) next
                if (type !~ pat) next
            }
            printf "- %s%s ([%s](%s/commit/%s))\n", (scope == "" ? "" : "**" scope "**: "), text, sha, repo, sha
        }
    ')"
    [ -n "$body" ] || return 0
    printf '### %s\n\n%s\n\n' "$heading" "$body"
}

# Order is "what does this change for someone using the site", not alphabetical.
render "⚠ Breaking" "BREAKING"
render "Features" "^feat$"
render "Fixes" "^fix$"
render "Performance" "^perf$"
render "Build & CI" "^(ci|build)$"
render "Docs" "^docs$"
render "Internals" "^(refactor|style|test|chore)$"
render "Dependencies" "DEPS"

# Anything whose subject is neither a Conventional Commit nor a bump still has
# to appear — silently dropping a commit from the notes is worse than an untidy
# heading.
OTHER="$(printf '%s' "$LOG" | awk -v RS='\x1e' -v FS='\x1f' -v repo="$REPO_URL" '
    {
        sha = $1; gsub(/^[\r\n]+|[\r\n]+$/, "", sha)
        if (sha == "") next
        if (index($2, "⬆") == 1) next
        if ($2 ~ /^[a-z]+(\([^)]*\))?!?: /) next
        printf "- %s ([%s](%s/commit/%s))\n", $2, sha, repo, sha
    }
')"
[ -n "$OTHER" ] && printf '### Other\n\n%s\n\n' "$OTHER"

if [ -n "$PREV" ]; then
    printf '**Full diff:** [%s...%s](%s/compare/%s...%s)\n' "$PREV" "$TAG" "$REPO_URL" "$PREV" "$TAG"
fi
