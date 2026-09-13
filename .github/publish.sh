#!/usr/bin/env bash
set -euo pipefail

# Runs in the disposable Actions checkout. Never force-push or merge generated
# calendars: if main advances, regenerate from its latest code and saved state.
base=$(git rev-parse HEAD)
for attempt in 1 2 3; do
  git add football.ics state.json status.json
  if git diff --cached --quiet; then
    echo "Calendar is already current."
    exit 0
  fi
  git commit -m 'Refresh football calendar'
  published=$(git rev-parse HEAD)
  if git push origin HEAD:main; then
    exit 0
  fi

  git fetch --no-tags origin main
  latest=$(git rev-parse FETCH_HEAD)
  # A lost server acknowledgement can report failure after a successful push.
  if [ "$latest" = "$published" ]; then
    exit 0
  fi
  if [ "$latest" = "$base" ]; then
    echo "Publishing failed without a newer main branch; keeping the error visible." >&2
    exit 1
  fi
  if [ "$attempt" = 3 ]; then
    echo "Main changed during all three publishing attempts; last good feed remains online." >&2
    exit 1
  fi
  if [ -n "$(git status --porcelain)" ]; then
    echo "Unexpected local changes; refusing to replace this checkout." >&2
    exit 1
  fi

  echo "Main advanced during this update. Regenerating from the latest version."
  git switch -C main "$latest"
  base=$latest
  node --test
  node generate.mjs
done
