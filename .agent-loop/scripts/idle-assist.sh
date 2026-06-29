#!/usr/bin/env bash
set -euo pipefail

TEAM="${AGENT_LOOP_TEAM:-phos}"

usage() {
  cat <<'USAGE'
Usage:
  .agent-loop/scripts/idle-assist.sh request <claude|codex> [summary]
  .agent-loop/scripts/idle-assist.sh delegate <from> <to> <task_id> <summary> <locked_paths> [forbidden_paths] [validation]
  .agent-loop/scripts/idle-assist.sh envelope request <claude|codex> [summary]
  .agent-loop/scripts/idle-assist.sh envelope delegate <from> <to> <task_id> <summary> <locked_paths> [forbidden_paths] [validation]

Purpose:
  Send compact agmsg packets when one supervisor has spare capacity.

Examples:
  .agent-loop/scripts/idle-assist.sh request codex
  .agent-loop/scripts/idle-assist.sh request claude "Idle after review; can take one FE-safe narrow task."
  .agent-loop/scripts/idle-assist.sh delegate claude codex F-20260628-901 \
    "Harden dashboard stats no-store envelope" \
    "src/app/api/dashboard/dispensing-stats/route.ts,src/app/api/dashboard/dispensing-stats/route.test.ts" \
    "src/components/**,prisma/**" \
    "focused vitest + scoped eslint + prettier + typecheck"

Notes:
  - This script only sends or prints the coordination envelope.
  - It does not grant a path lock by itself.
  - The receiver must ACK/accept, send or record a LOCK before editing, then run validation.
USAGE
}

abort() {
  printf 'idle-assist: %s\n' "$*" >&2
  exit 2
}

peer_for() {
  case "$1" in
    claude) printf 'codex\n' ;;
    codex) printf 'claude\n' ;;
    *) abort "agent must be claude or codex: $1" ;;
  esac
}

require_agent() {
  case "$1" in
    claude | codex) ;;
    *) abort "agent must be claude or codex: $1" ;;
  esac
}

uuid() {
  uuidgen 2>/dev/null || printf '%s-%s' "$(date +%s)" "$$"
}

timestamp_jst() {
  TZ=Asia/Tokyo date '+%Y-%m-%dT%H:%M:%S+09:00'
}

branch_name() {
  git rev-parse --abbrev-ref HEAD 2>/dev/null || printf '-'
}

state_version() {
  awk -F: '/^current_cycle:/ { gsub(/^[[:space:]]+|[[:space:]]+$/, "", $2); sub(/[[:space:]]+#.*/, "", $2); print $2; found=1; exit } END { if (!found) print "0" }' .agent-loop/STATE.md 2>/dev/null
}

send_body() {
  local from="$1"
  local to="$2"
  local body="$3"
  ~/.agents/skills/agmsg/scripts/send.sh "$TEAM" "$from" "$to" "$body"
}

request_envelope() {
  local from="$1"
  local summary="${2:-}"
  require_agent "$from"
  local to
  to="$(peer_for "$from")"
  if [[ -z "$summary" ]]; then
    summary="$from has spare capacity and is requesting a bounded non-conflicting task"
  fi

  local message_id ts branch state
  message_id="$(uuid)"
  ts="$(timestamp_jst)"
  branch="$(branch_name)"
  state="$(state_version)"

  cat <<EOF
AGLOOP v5
type: REQUEST_DELEGATE
message_id: $message_id
idempotency_key: request-delegate:$from:$to:$branch:$state
task_id: -
subtask_id: -
feature_id: -
from: $from
to: $to
origin_agent: $from
owner_agent: $from
reviewer_agent: $to
status: queued
branch: $branch
state_version: $state
timestamp: $ts
locked_paths: []
forbidden_paths: []
summary: $summary
details: |
  Idle-capacity request.
  I have no higher-priority inbound item after draining agmsg and can take one bounded non-conflicting task.
  Please reply with DELEGATE or HANDOFF including task_id, scope, locked_paths, forbidden_paths, acceptance criteria, and validation.
  I will not edit until I ACK or accept the delegation and acquire the explicit path lock.
  Do not delegate auth, billing, security-policy, destructive migration, production deploy, external-send, or other human-gated work without explicit current approval.
EOF
}

delegate_envelope() {
  local from="$1"
  local to="$2"
  local task_id="$3"
  local summary="$4"
  local locked_paths="$5"
  local forbidden_paths="${6:-[]}"
  local validation="${7:-focused validation relevant to the delegated scope}"

  require_agent "$from"
  require_agent "$to"
  [[ "$from" != "$to" ]] || abort "from and to must differ"
  [[ -n "$task_id" ]] || abort "task_id is required"
  [[ -n "$summary" ]] || abort "summary is required"
  [[ -n "$locked_paths" ]] || abort "locked_paths is required"

  local message_id ts branch state
  message_id="$(uuid)"
  ts="$(timestamp_jst)"
  branch="$(branch_name)"
  state="$(state_version)"

  cat <<EOF
AGLOOP v5
type: DELEGATE
message_id: $message_id
idempotency_key: delegate:$task_id:$from:$to
task_id: $task_id
subtask_id: -
feature_id: -
from: $from
to: $to
origin_agent: $from
owner_agent: $to
reviewer_agent: $from
status: queued
branch: $branch
state_version: $state
timestamp: $ts
locked_paths: [$locked_paths]
forbidden_paths: [$forbidden_paths]
summary: $summary
details: |
  Delegated because the receiver has spare capacity or the sender is saturated.
  Receiver must ACK or decline before work starts.
  Receiver must claim only locked_paths, preserve forbidden_paths, and keep maker != checker.
  Acceptance criteria:
    - Stay inside the delegated scope.
    - Preserve unrelated dirty work.
    - Run validation before PATCH_REVIEW_REQUEST or DONE.
  Required validation:
    - $validation
  Human-gated surfaces remain blocked unless explicit current approval exists.
EOF
}

main() {
  local mode="${1:-}"
  case "$mode" in
    request)
      shift
      local from="${1:-}"
      [[ -n "$from" ]] || abort "request requires <claude|codex>"
      shift || true
      local body to
      body="$(request_envelope "$from" "${1:-}")"
      to="$(peer_for "$from")"
      send_body "$from" "$to" "$body"
      ;;
    delegate)
      shift
      (( $# >= 5 )) || abort "delegate requires <from> <to> <task_id> <summary> <locked_paths>"
      local body
      body="$(delegate_envelope "$@")"
      send_body "$1" "$2" "$body"
      ;;
    envelope)
      shift
      local envelope_mode="${1:-}"
      shift || true
      case "$envelope_mode" in
        request)
          (( $# >= 1 )) || abort "envelope request requires <claude|codex>"
          request_envelope "$@"
          ;;
        delegate)
          (( $# >= 5 )) || abort "envelope delegate requires <from> <to> <task_id> <summary> <locked_paths>"
          delegate_envelope "$@"
          ;;
        *)
          usage
          abort "unknown envelope mode: ${envelope_mode:-}"
          ;;
      esac
      ;;
    -h | --help | help)
      usage
      ;;
    *)
      usage
      abort "unknown command: ${mode:-}"
      ;;
  esac
}

main "$@"
