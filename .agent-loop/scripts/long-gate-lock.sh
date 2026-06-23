#!/usr/bin/env bash
set -euo pipefail

LOCK_DIR="${AGENT_LOOP_LONG_GATE_LOCK_DIR:-tmp/agent-loop-long-gate-lock}"

usage() {
  cat <<'USAGE'
Usage:
  .agent-loop/scripts/long-gate-lock.sh status
  .agent-loop/scripts/long-gate-lock.sh acquire <owner> "<command>" [ttl_minutes]
  .agent-loop/scripts/long-gate-lock.sh release <owner> ["result"] [--force]

Creates a local advisory lease for serialized Next.js gates:
  pnpm build
  pnpm typecheck
  pnpm typecheck:no-unused

Still send AGLOOP LONG_GATE_LOCK / LONG_GATE_RELEASE over agmsg; this script only
prevents local overlapping gate launches in the worktree.
USAGE
}

abort() {
  printf 'long-gate-lock: %s\n' "$*" >&2
  exit 2
}

now_epoch() {
  date +%s
}

format_epoch() {
  local epoch="$1"
  if date -u -r "$epoch" '+%Y-%m-%dT%H:%M:%SZ' >/dev/null 2>&1; then
    date -u -r "$epoch" '+%Y-%m-%dT%H:%M:%SZ'
  else
    date -u -d "@$epoch" '+%Y-%m-%dT%H:%M:%SZ'
  fi
}

read_meta() {
  local key="$1"
  local file="$LOCK_DIR/$key"
  if [[ -f "$file" ]]; then
    cat "$file"
  else
    printf -- '-'
  fi
}

ensure_safe_lock_dir() {
  case "$LOCK_DIR" in
    '' | '/' | '.' | '..')
      abort "unsafe AGENT_LOOP_LONG_GATE_LOCK_DIR: $LOCK_DIR"
      ;;
    *agent-loop-long-gate-lock | *.long-gate-lock)
      ;;
    *)
      abort "lock dir must end with agent-loop-long-gate-lock or .long-gate-lock: $LOCK_DIR"
      ;;
  esac
}

maybe_clear_expired() {
  [[ -d "$LOCK_DIR" ]] || return 0

  local expires now
  expires="$(read_meta expires_epoch)"
  now="$(now_epoch)"
  if [[ "$expires" =~ ^[0-9]+$ ]] && (( expires <= now )); then
    rm -rf "$LOCK_DIR"
  fi
}

status() {
  maybe_clear_expired
  if [[ ! -d "$LOCK_DIR" ]]; then
    printf 'status=free lock_dir=%s\n' "$LOCK_DIR"
    return 0
  fi

  printf 'status=locked lock_dir=%s owner=%s command=%s token=%s started_at=%s expires_at=%s\n' \
    "$LOCK_DIR" \
    "$(read_meta owner)" \
    "$(read_meta command)" \
    "$(read_meta token)" \
    "$(read_meta started_at)" \
    "$(read_meta expires_at)"
}

acquire() {
  local owner="${1:-}"
  local command="${2:-}"
  local ttl_minutes="${3:-45}"

  [[ -n "$owner" ]] || abort "owner is required"
  [[ -n "$command" ]] || abort "command is required"
  [[ "$ttl_minutes" =~ ^[0-9]+$ ]] || abort "ttl_minutes must be numeric"
  (( ttl_minutes > 0 )) || abort "ttl_minutes must be greater than zero"

  maybe_clear_expired
  mkdir -p "$(dirname "$LOCK_DIR")"
  if ! mkdir "$LOCK_DIR" 2>/dev/null; then
    status
    abort "another long gate is already leased"
  fi

  local now expires token
  now="$(now_epoch)"
  expires=$((now + ttl_minutes * 60))
  token="$(uuidgen 2>/dev/null || printf '%s-%s' "$now" "$$")"

  printf '%s\n' "$owner" > "$LOCK_DIR/owner"
  printf '%s\n' "$command" > "$LOCK_DIR/command"
  printf '%s\n' "$token" > "$LOCK_DIR/token"
  printf '%s\n' "$(format_epoch "$now")" > "$LOCK_DIR/started_at"
  printf '%s\n' "$expires" > "$LOCK_DIR/expires_epoch"
  printf '%s\n' "$(format_epoch "$expires")" > "$LOCK_DIR/expires_at"

  printf 'status=acquired lock_dir=%s owner=%s command=%s token=%s expires_at=%s\n' \
    "$LOCK_DIR" "$owner" "$command" "$token" "$(read_meta expires_at)"
  printf 'send_agmsg=LONG_GATE_LOCK owner=%s command=%s token=%s expires_at=%s\n' \
    "$owner" "$command" "$token" "$(read_meta expires_at)"
}

release() {
  local owner="${1:-}"
  local result="${2:-released}"
  local force="${3:-}"

  [[ -n "$owner" ]] || abort "owner is required"
  if [[ "$result" == "--force" ]]; then
    result="released"
    force="--force"
  fi
  maybe_clear_expired
  if [[ ! -d "$LOCK_DIR" ]]; then
    printf 'status=free lock_dir=%s\n' "$LOCK_DIR"
    return 0
  fi

  local current_owner
  current_owner="$(read_meta owner)"
  if [[ "$current_owner" != "$owner" && "$force" != "--force" ]]; then
    status
    abort "lock is owned by $current_owner; pass --force only after confirming the peer is not running a gate"
  fi

  rm -rf "$LOCK_DIR"
  printf 'status=released lock_dir=%s owner=%s result=%s\n' "$LOCK_DIR" "$owner" "$result"
  printf 'send_agmsg=LONG_GATE_RELEASE owner=%s result=%s\n' "$owner" "$result"
}

ensure_safe_lock_dir

case "${1:-status}" in
  status)
    status
    ;;
  acquire)
    shift
    acquire "$@"
    ;;
  release)
    shift
    release "$@"
    ;;
  -h | --help | help)
    usage
    ;;
  *)
    usage
    abort "unknown command: ${1:-}"
    ;;
esac
