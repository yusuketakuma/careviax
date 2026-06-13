#!/usr/bin/env bash
# Ensemble 連携の共通環境。careviax を agents.json の SSOT にする。
# 使い方: source ops/ensemble-env.sh
#
# Ensemble server 起動例（別ターミナルで keep running）:
#   source ops/ensemble-env.sh
#   ( cd "$ENSEMBLE_HOME" && ENSEMBLE_AGENTS_CONFIG="$ENSEMBLE_AGENTS_CONFIG" npm run dev )

export CAREVIAX_ROOT="/Users/yusuke/workspace/careviax"
export ENSEMBLE_HOME="$HOME/tools/ensemble"
# careviax の agents.json を Ensemble に読ませる（lib/agent-config.ts:19）
export ENSEMBLE_AGENTS_CONFIG="$CAREVIAX_ROOT/agents.json"
# 既存の素の Ensemble が :23000 / ~/.ensemble を使っているため、careviax 専用に隔離する。
# 共有データディレクトリだと両サーバの idle 監視が互いの team を勝手に disband しうる。
export ENSEMBLE_PORT="23100"
export ENSEMBLE_DATA_DIR="$HOME/.ensemble-careviax"
export ENSEMBLE_URL="http://localhost:23100"

# health 確認ヘルパー
ensemble_health() { curl -s "$ENSEMBLE_URL/api/v1/health"; echo; }

# team feed をポーリング（使い方: ensemble_feed <team-id> [since-iso]）
ensemble_feed() { curl -s "$ENSEMBLE_URL/api/ensemble/teams/$1/feed${2:+?since=$2}"; echo; }

# team 一覧
ensemble_teams() { curl -s "$ENSEMBLE_URL/api/ensemble/teams"; echo; }
