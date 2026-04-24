#!/usr/bin/env sh
set -eu

HARNESS_REPO="${BROWSER_HARNESS_REPO:-$HOME/Developer/browser-harness}"

if [ ! -d "$HARNESS_REPO" ]; then
  echo "browser-harness repo not found: $HARNESS_REPO" >&2
  echo "Set BROWSER_HARNESS_REPO or clone https://github.com/browser-use/browser-harness there." >&2
  exit 127
fi

exec uv run --directory "$HARNESS_REPO" browser-harness "$@"
