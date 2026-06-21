# STARTUP_RUNBOOK.md — 常駐品質ループ起動手順（SSOT）

> **このループの起動形（2026-06-20 確定 / ユーザー指示）**
> **Claude Code 側を起点・主実装**にし、**Codex を agmsg 経由で監査・補助実装**として参加させる。
> maker/checker 分離。最終判定は objective gate（lint/typecheck/test/build）に寄せる。
>
> **agmsg ルーティング（live・確定）**: team = `phos` / agents = `claude`（Claude Code, claude-lead 役）・`codex`（Codex, codex-lead 役）。
> ※ "claude-lead / codex-lead" は **役割ラベル**。実 agmsg 宛先は `phos` の `claude` / `codex`。
> （旧ランブックの team `agent-loop` / `claude-lead` / `codex-lead` は **不採用** — 再登録不要な live 設定を維持）

---

## 0. 前提（初回のみ・careviax は構築済み）

careviax では以下は **すでに完了済み**。新規 repo に展開する時だけ実施する。

- **agmsg**: 導入・`phos` 登録済み（`claude` + `codex`）。未導入時のみ:
  `bash <(curl -fsSL https://raw.githubusercontent.com/fujibee/agmsg/main/setup.sh)`
- **gbrain**: ローカル postgres + MCP 登録済み（user scope）。
  - 埋め込み = **ローカル `ollama:mxbai-embed-large`（1024d、外部送信なし）で生成済み**。`gbrain query`/`search`（semantic）が動作する（2026-06-20 BLOCKED 解除、`BLOCKED.md` 参照）。
  - 新 repo 時のみ: `gbrain init --pglite` / `claude mcp add gbrain -- gbrain serve` / `codex mcp add gbrain -- gbrain serve`
- `mcp__gbrain__*` ツールは **セッション開始時ロード** → 既存セッションは要 Claude Code 再起動（`gbrain` CLI は常時利用可）。

---

## 1. Claude Code 側を起動（terminal 1・主実装）

```bash
cd /Users/yusuke/workspace/careviax
claude
```

Claude Code 内:

```text
/agmsg
```

→ 登録済みなら `agent=claude teams=phos type=claude-code`。未登録時のみ `team: phos` / `agent: claude` / `delivery: monitor`。

```text
/effort ultracode
```

`/effort ultracode` = xhigh reasoning + automatic workflow orchestration（重要タスク毎に Claude が workflow を組む）。**現セッションのみ有効**、通常へ戻すなら `/effort high`。

---

## 2. Codex 側を起動（terminal 2・監査/補助）

```bash
cd /Users/yusuke/workspace/careviax
codex
```

Codex 内:

```text
$agmsg
```

→ 登録済みなら `phos` の `codex`。未登録時のみ `team: phos` / `agent: codex` / `delivery: turn`。

次に Codex へ Goal を設定:

```text
/goal あなたは codex-lead（agmsg ID = phos/codex）です。Claude Code の claude-lead（phos/claude）と agmsg で相互監査してください。あなたの主担当は、型安全性、テスト、リファクタリング、二重実装検出、性能、安定性、非同期安全性、セキュリティ回帰確認です。実装は原則 Claude Code が主導します。Codex は agmsg inbox を確認し、Claude の PLAN_REVIEW_REQUEST、PATCH_REVIEW_REQUEST、VERIFY_REQUEST に対して subagents を展開して監査してください。必要な補助実装だけ、LOCKS.md で許可された locked_paths 内で行ってください。gbrain MCP を使い、開始時に過去 LoopRun、Decision、FailurePattern、FixPattern、ReviewFinding、GateResult、CandidateLesson を検索し、ApplyNow / Consider / Ignore / BlockedContext に分類してください。ApplyNow は LOOP_POLICY.md へ提案し、Claude へ agmsg で共有してください。Final Stop Gate 未達で完了宣言せず、STATE.md、REVIEW_LOG.md、VERIFY_LOG.md、BLOCKED.md、gbrain writeback を更新してください。
```

`/goal` = 長め作業の目的・完了条件・制約を Codex に持たせるコマンド（`/goal <objective>` / `pause` / `resume` / `clear`）。「work → check → continue or complete」の継続作業向き。

---

## 3. Claude Code 側でループ開始

Claude Code に戻り、以下を貼る:

```text
ultracode:

あなたは claude-lead（agmsg ID = phos/claude）です。Codex の codex-lead（phos/codex）と agmsg で相互監査しながら、常駐品質ループを開始してください。

開始時に必ず読む:
- AGENTS.md
- CLAUDE.md
- .agent-loop/STARTUP_RUNBOOK.md
- .agent-loop/STATE.md
- .agent-loop/FEATURE_QUEUE.md
- .agent-loop/LOCKS.md
- .agent-loop/LOOP_POLICY.md
- .agent-loop/BLOCKED.md
- .agent-loop/MESSAGE_PROTOCOL.md
- gbrain MCP の関連 memory

最初に行うこと:
1. agmsg inbox を確認する。
2. gbrain MCP で、この repo の直近 LoopRun、類似 Decision、FailurePattern、FixPattern、ReviewFinding、GateResult、CandidateLesson を検索する（semantic 検索可・ローカル埋め込み）。
3. 検索結果を ApplyNow / Consider / Ignore / BlockedContext に分類する。
4. ApplyNow だけを .agent-loop/LOOP_POLICY.md に policy patch として提案する。
5. policy patch を agmsg で codex（codex-lead）へ LOOP_POLICY_PATCH_PROPOSED として送る。
6. Codex の承認または修正要求を待つ。
7. 承認後、通常品質ループを開始する。

通常品質ループ:
- Refactor Loop: 二重実装、重複型、重複 validator、重複 API client、重複 component、未使用コードを削除・統合。
- Stability Loop: lint/type/test/build 失敗、例外、非同期 race、timeout/cancel 漏れ、unhandled rejection、重複 request、N+1、不要再レンダリングを修正。
- Product-Adjacent Loop: FEATURE_QUEUE.md の未処理新機能、TODO 補完、validation 強化、検索/filter/sort、状態表示改善を処理。
- UI/UX Loop: loading/error/empty/success、form UX、情報設計、アクセシビリティ、レスポンシブ、button hierarchy、一覧/詳細表示を改善（docs/ui-ux-design-guidelines.md を先に参照）。

新機能がある場合:
- origin_agent と owner_agent を分離する。
- feature_id で dedupe する。
- owner 決定前に実装しない。
- locked_paths 取得前に編集しない。
- Claude Code が主実装、Codex が peer reviewer。
- Codex 承認後に実装し、実装後は PATCH_REVIEW_REQUEST を送る。

ルール:
- scan は全 repo 可、edit は locked_paths 内のみ。
- STATE/FEATURE_QUEUE/LOCKS/LOOP_POLICY の更新は Supervisor のみ。
- auth、billing、payments、security、破壊的 migration、production deploy は人間承認なしに触らず Blocked 化（BLOCKED.md §15）。
- テストを通すために仕様変更しない。
- failing test を無効化しない。
- secret/token/env 値を gbrain、STATE、agmsg、ログへ保存しない。
- maker と checker を分離する。
- 実装者とは別の subagent/workflow で検証する。
- 共有 HEAD では git commit --amend 禁止、自ファイルのみ明示 stage（add -A 禁止）。

検証（可能な範囲で）:
- lint / format check / typecheck / typecheck:no-unused / test / build / secret scan / dependency audit
- UI 変更時は 正常系/異常系/空状態/loading/error/success/responsive/a11y

Hard stop（いずれかで一旦停止し STATE.md と gbrain に再開点を書く）:
- 最大 4 Cycle / 変更 20 ファイル超 / 同一検証失敗 3 回 / 人間承認が必要 / Codex との memory/policy conflict が解決不能

停止時の出力:
- 実行 Cycle 数 / 実装内容 / 削除・統合した重複 / 検証結果 / Codex peer review 結果 / gbrain writeback した memory / Blocked / 次回再開ポイント
```

---

## 4. 起動後の通信確認

Claude Code 側:

```text
/agmsg team
/agmsg send codex "AGLOOP ping from claude-lead"
```

Codex 側:

```text
$agmsg
```

または Codex 内で自然文:

```text
agmsg inbox を確認し、claude（claude-lead）からの ping に ACK を返してください。
```

CLI 直叩きで確認する場合（careviax の実パス）:

```bash
~/.agents/skills/agmsg/scripts/team.sh phos
~/.agents/skills/agmsg/scripts/send.sh phos claude codex "AGLOOP ping"
~/.agents/skills/agmsg/scripts/inbox.sh phos claude
```

---

## 5. 新機能を投入するとき

Claude / Codex どちらに貼っても同じ Feature Intake pipeline に載る:

```text
新機能投入:
このプロンプトは Claude Code / Codex のどちらに貼られても同じ Feature Intake pipeline に載せてください。
あなたが受信した場合、あなたは origin_agent であり、owner_agent ではありません。

まず feature_id を生成し、既存 FEATURE_QUEUE、agmsg 履歴、gbrain を確認して dedupe してください。
その後、agmsg で peer へ FEATURE_INTAKE を送り、Owner 決定ルールに従って owner_agent と reviewer_agent を確定してください。
owner_agent が確定し、peer plan review が完了し、locked_paths を取得するまで実装を開始しないでください。

機能名:
<機能名>

背景:
<背景>

ユーザー価値:
<誰が何をできるようになるか>

対象画面/API:
<対象>

受け入れ条件:
- <条件1>
- <条件2>
- <条件3>

制約:
- 既存仕様を壊さない
- 既存 component/API/type/schema/validator を優先再利用
- 二重実装を増やさない
- auth/billing/payments/security/destructive migration/production deploy は承認なしに触らない

検証:
- lint / typecheck / test / build / 正常系 / 異常系 / 空状態 / 権限不足 / responsive
```

---

## 6. 最短スタート

```bash
# terminal 1
cd /Users/yusuke/workspace/careviax && claude
```

Claude 内: `/agmsg` → `/effort ultracode` → §3 のループ開始プロンプトを貼る。

```bash
# terminal 2
cd /Users/yusuke/workspace/careviax && codex
```

Codex 内: `$agmsg` → §2 の `/goal` を貼る。

---

## 7. 運用上の安全チェック（最初の数回は必ず）

ループは **state file・verifier・objective gate・hard stop** があるから安全に回る。automation だけで state/verifier/schedule/hard stop の無いループは失敗しやすい。毎回以下を確認:

- `.agent-loop/STATE.md` が更新されているか
- `.agent-loop/LOCKS.md` が競合していないか
- Codex が review-only のとき勝手に編集していないか
- gbrain に secret が書かれていないか
- Final ではなく途中停止時に再開点が残っているか

---

## 参照

- agmsg: https://github.com/fujibee/agmsg ・ SKILL: https://github.com/fujibee/agmsg/blob/main/SKILL.md
- gbrain: https://github.com/garrytan/gbrain
- Claude Code workflows (`/effort ultracode`): https://code.claude.com/docs/en/workflows
- Codex `/goal`: https://developers.openai.com/codex/cli/slash-commands ・ https://developers.openai.com/cookbook/examples/codex/using_goals_in_codex
