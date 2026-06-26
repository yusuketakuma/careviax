# Design — Loop Runtime Controller (`.agent-loop` 強化設計書)

> Status: **DESIGN ONLY**（実装はループ本体の LE トラック / maker-checker で着地）
> Author: claude (openclaw session, 2026-06-25)
> Target repo: `/Users/yusuke/workspace/careviax/.agent-loop`
> Scope: **自己改善する閉ループ（self-improving loop）の構築**。5 enhancements —
> auto-guard / metrics auto-collection / STATE compaction / real loop driver / **PDCA Act 自動起案 (`propose`)**
> Landing: 全機能を `loop-cycle.mjs` への **追加サブコマンド** として実装（コア状態機械・既存コマンドは不変）

> **本書のゴール（確定）:** これは careviax 製品コードを書くループではなく、
> **careviax の開発ループ自体を改善するメタループ（loop that improves the dev loop）**である。
> 観測対象＝既存の Product Loop（Q1–Q4 + maker/checker）。本メタループの**プロダクト＝開発ループの改善**
> （`LOOP_POLICY` / `prompts/*` / `GATE_CONFIG` / `loop-cycle.mjs` 自体 / gbrain の method 群）。
> メタループは自分の弱点を**証拠から検出し、開発ループへの改善案を自動起案し続ける**閉ループにする。
> ただし改善の**適用は peer + human gate を維持**（自動*起案*まで、自動*適用*はしない）。
> 完全無人化（自動適用）は §14 思想（auth/billing/security/破壊的変更/自己改変の human-gate）に反するため**意図的に行わない**。
> 位置づけは `LOOP_POLICY.md` §13（Loop-Engineering PDCA track）/ README §3.2 を**一級の自走メタループへ昇格**したもの。

### 二層モデル（これが本書の核）

```
┌─ META-LOOP（本書が構築） = 開発ループを改善するループ ────────────────────┐
│                                                                          │
│   sense        →   diagnose      →   propose          →   gate           │
│   (metrics)        (劣化シグナル)    (改善案を自動起案)     (peer+human)     │
│      ↑                                    │                    │          │
│      │                                    ▼                    ▼          │
│      │                       PROMOTION_QUEUE/LOOP_POLICY    applied →      │
│      │                       patch (status=proposed)       改善が反映      │
│      │                                                         │          │
│   ┌──┴─────────────── observes ──────────────────────────┐    │ feeds    │
│   │                                                       │    ▼ back     │
│   │   PRODUCT-LOOP（既存・観測対象） = careviax を作るループ  │◀───────────┘  │
│   │   discover→plan→review→lock→implement→verify→land      │              │
│   │   （Q1–Q4, maker/checker, §14 hard-stops）             │              │
│   └───────────────────────────────────────────────────────┘              │
└──────────────────────────────────────────────────────────────────────────┘
```

- **Product-Loop**（既存）＝ careviax のコードを書く。出力＝製品の機能/修正。
- **Meta-Loop**（本書）＝ Product-Loop を**観測・診断・改善起案**する。出力＝開発ループの改善（ポリシー/プロンプト/ゲート/ツール）。
- 5 機能の役割分担: `guard`/`compact`/`tick` は Product-Loop の**実行基盤を健全化**、`metrics` は**センサー（Check）**、
  `propose` は**メタループの本体（Act 自動起案）**。`propose` 無しでは "改善するループ" ではなく "安全に回るループ" に留まる。

---

## 0. 背景と問題定義

現行 `.agent-loop` は **散文ポリシー層（`LOOP_POLICY.md` §1–§26）が極めて精緻**な一方、
**実行・自動化層が薄い**。具体的な構造的弱点:

| #   | 問題                                         | 現状の根拠                                                                                                                                                                                      |
| --- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | §14 ハードストップが**手動計算**             | `CONTROL_PLANE_CONFIG.yml`: `runtime_controller: not_implemented` / `enforcement.mode: manual_supervisor`。経過時間・ファイル数・gate連敗をスーパーバイザーが毎サイクル STATE.md を読んで手計算 |
| P2  | METRICS が**全 null**                        | `METRICS.md`: `time_to_green` / `review_turnaround` / `recurrence_rate` / `token_per_cycle` 等すべて未計測                                                                                      |
| P3  | STATE.md が**無限 append**で肥大化           | 357行。`Current update …` / `### ROUND-*` の物語が積層、Resume point が埋没。毎サイクル読む SSOT として限界                                                                                     |
| P4  | **決定的ループドライバ不在**                 | 「ループ」は2セッションが散文プロンプト＋§15/§16（passive-wait禁止）で自走するのみ。決定的 orchestration なし                                                                                   |
| P5  | **開発ループの自己改善が手動・閉じていない** | §13 LE-PDCA は散文の心構え止まり。劣化検出→改善起案→適用の Act 自動化が無く、ループが自分を直す回路が閉じていない。**本書の主目的＝この閉ループ化**                                             |

### 設計原則

1. **Additive / non-breaking** — 既存 `status` / `phases` / `next` / `gates` / `advance` は不変。新コマンドのみ追加。
2. **Deterministic & dependency-free** — Node 20+ / ESM / 標準ライブラリのみ（現行 `loop-cycle.mjs` 踏襲）。
3. **Read-mostly, opt-in write** — 状態変更は `--apply`/明示コマンド時のみ。デフォルトは dry-run。
4. **maker/checker を壊さない** — guard は強制（停止＋resume生成）するが、**承認は奪わない**。LLM ターンを spawn しない（セッションが呼ぶスケルトン）。
5. **冪等** — compact / metrics / guard は同入力で同結果。再実行安全。

---

## 1. STATE.md スキーマ拡張（前提）

現行 YAML フィールド: `current_run_id, current_cycle, cycle_start_time, active_task_id,
current_cycle_note, files_changed_count, claude_status, codex_status, last_memory_bootstrap,
zero_actionable_count, last_gate_result, next_action`。

以下を**追加**（既存パーサ `parseState()` は `^([a-z_]+):` 行を読むのでそのまま互換）:

```yaml
# ── objective-scoped clocks (§14 は "single objective" 単位。run-global と分離) ──
objective_id: F-20260625-001 # 現在の objective。active_task_id と連動
objective_start_time: 2026-06-25T09:00:00+09:00 # この objective 開始時刻。§14 90分の起点
objective_cycle_count: 1 # この objective でのサイクル数。§14 4-cycle 起点（current_cycle は run-global で別物）

# ── files-changed baseline (§14 >20-file) ──
cycle_baseline_ref: 9c50814b # objective 開始時の git commit/tree sha。`git diff --name-only <ref>` でファイル数算定

# ── gate-fail streak (§14 same gate × 3) ──
gate_fail_streak: 0 # 直近同一 gate の連続失敗数
gate_fail_kind: '' # 連敗中の gate 名（typecheck / build / test ...）

# ── guard verdict ──
hard_stop: '' # '' = clear。トリップ時に理由を書き込み、tick が停止
last_guard_check: 2026-06-25T09:30:00+09:00
```

> 既存 `cycle_start_time` / `files_changed_count` は run-global の互換のため残置。
> §14 判定は新 `objective_*` フィールドを正本にする（"single objective" 解釈を正確化）。
> `advance` コマンドに `--objective <id>` オプションを足し、objective 切替時に
> `objective_start_time` / `objective_cycle_count=0` / `cycle_baseline_ref=$(git rev-parse HEAD)` を再初期化。

---

## 2. コマンド仕様

### 2.1 `guard` — 自動ハードストップ強制（P1）

```
node .agent-loop/loop-cycle.mjs guard [--agent claude|codex] [--apply] [--phi-scan]
```

**算定（すべて STATE + git + VERIFY_LOG から決定的に）:**

| 判定                         | 計算                                                                                                            | 閾値 (§14)            | 出力                   |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------- | ---------------------- |
| time                         | `now − objective_start_time`                                                                                    | ≥ 90 min              | `TIME 87/90min`        |
| cycles                       | `objective_cycle_count`                                                                                         | ≥ 4                   | `CYCLES 3/4`           |
| files                        | `git diff --name-only <cycle_baseline_ref> \| wc -l`                                                            | > 20                  | `FILES 18/20`          |
| gate-streak                  | `gate_fail_streak`                                                                                              | ≥ 3                   | `STREAK typecheck 2/3` |
| high-risk surface            | 変更パスを high-risk glob（auth/billing/payments/security/`prisma/migrations/**`/`.github/workflows/**`）に照合 | 1件で human-gate      | `RISK touches_billing` |
| secret/PHI（`--phi-scan`時） | `git diff` を secret/PHI 正規表現でスキャン                                                                     | 1件で redact+escalate | `SECRET <path>`        |

**挙動:**

- **clear**: 全項目が閾値の 80% 未満 → `exit 0`、`GUARD: clear`。`last_guard_check` 更新（`--apply`時）。
- **warn**: いずれか 80%–100% → `exit 0`、`GUARD: warn (TIME 78/90min)`。停止しないが警告。
- **trip**: いずれか閾値到達 → `exit 2`、`GUARD: HARD-STOP (FILES 21/20)`。`--apply`時:
  1. STATE.md `hard_stop:` に理由を書き込み。
  2. `## Resume point` セクションに**スケルトン**を自動生成（`active_task_id` / locked paths（LOCKS.md から抽出） / 最後の gate 結果 / `next_action` を埋め、"Hard Stop reason" を guard 理由で埋める）。
  3. high-risk/secret は即 `exit 3`（human-gate を明示区別）。

> guard は**セッションを kill しない**（できない）。state を書き、非0 exit を返し、resume を生成する。
> `tick`（§2.4）と各スーパーバイザーがこの exit code を honor して停止する。
> 5番目の §14 条件「auth/billing/…到達」は high-risk surface 判定で表現。

**新規依存ファイル:** なし。LOCKS.md から locked paths を抽出するため LOCKS.md の
**表形式 1 行/lock** を期待（既存フォーマット互換、無ければ空欄で resume 生成）。

---

### 2.2 `metrics` — メトリクス自動集計（P2）

```
node .agent-loop/loop-cycle.mjs metrics [--apply] [--run RUN-id]
```

**入力ソースとマッピング:**

| METRICS フィールド                              | ソース                               | パース方法                                         |
| ----------------------------------------------- | ------------------------------------ | -------------------------------------------------- |
| `quality.accepted_change_rate`                  | REVIEW_LOG.md                        | `APPROVED` 件数 / (`APPROVED`+`CHANGES_REQUESTED`) |
| `quality.regression_rate`                       | VERIFY_LOG.md                        | regression タグ付き / total gate runs              |
| `quality.type_error_delta` / `lint_error_delta` | 直近 `gates` 実行記録                | run開始時 vs 現在のエラー数                        |
| `speed.time_to_green`                           | VERIFY_LOG タイムスタンプ            | slice開始→cheap全green の wall-clock 中央値        |
| `speed.cycles_to_done`                          | STATE `objective_cycle_count`        | objective完了時の値                                |
| `speed.review_turnaround`                       | REVIEW_LOG タイムスタンプ            | review_request → verdict の中央値                  |
| `loop_engineering.review_gate_miss_count`       | REVIEW_LOG                           | gate green 後に review が見つけた指摘数            |
| `loop_engineering.post_approval_rework_count`   | PATCH_INBOX / REVIEW_LOG             | APPROVED 後の再変更数                              |
| `safety.dependency_audit_findings`              | `pnpm audit --json`（配線時）        | findings count                                     |
| `cost.token_per_cycle` 等                       | **計測不能（要 harness telemetry）** | null 据え置き＋理由コメント                        |

**前提（重要）— 構造化ログ規約の導入:**
現行 VERIFY_LOG / REVIEW_LOG は自由記述。robust パースのため、**追記時に 1 エントリ = 1 fenced YAML ブロック**の正準フォーマットを定義する（人間可読のまま機械パース可能）:

```yaml
# VERIFY_LOG.md 追記フォーマット案
- ts: 2026-06-25T09:12:00+09:00
  run: RUN-20260625-001
  objective: F-20260625-001
  gate: [typecheck, lint, test, build]
  result: pass # pass | fail
  failing: '' # fail時の gate 名
  regression: false # 既知バグの再発か
  recurrence_slug: '' # gbrain FailurePattern 一致時の slug
```

```yaml
# REVIEW_LOG.md 追記フォーマット案
- ts: 2026-06-25T09:20:00+09:00
  kind: PATCH_REVIEW # PLAN_REVIEW | PATCH_REVIEW
  objective: F-20260625-001
  maker: claude
  checker: codex
  verdict: approved # approved | changes_requested
  findings: 0 # 指摘数
  request_ts: 2026-06-25T09:05:00+09:00 # review_turnaround 計算用
```

**挙動:** デフォルト dry-run（集計結果を表示のみ）。`--apply` で METRICS.md の YAML テンプレートを
実測値で上書き。計測不能フィールドは null のまま＋ `# unavailable: needs harness telemetry` コメント。
旧フォーマットのエントリはスキップしカウント（`skipped N legacy entries` を表示）。

---

### 2.3 `compact` — STATE.md 肥大化対策（P3）

```
node .agent-loop/loop-cycle.mjs compact [--apply] [--keep N]
```

**STATE.md の構造区分:**

- **保持（不変）**: 先頭の `# Agent Loop — STATE` 説明 + `yaml` ブロック（ランタイム SSOT）+ `## Resume point`（ライブ）。
- **圧縮対象**: `## gbrain memory (this run)` 以降の `### ROUND-*` / `**Current update …**` 物語ブロック。

**アルゴリズム（決定的・冪等）:**

1. 物語セクションを **ROUND 単位**（`### ROUND-` 見出し or 日付境界）でチャンク化。
2. 直近 `--keep N`（デフォルト **2 ROUND**）＋ ライブ Resume point を STATE.md に残す。
3. それ以前の closed ROUND を `.agent-loop/STATE_ARCHIVE/<run-id>/<NNN>-<round-slug>.md` へ移動。
4. STATE.md に **index 行**を 1 ROUND = 1 行で残す:
   `- [ROUND-ORG-HEADERS](STATE_ARCHIVE/RUN-.../003-org-headers.md) — landed F-105..F-108, dual-maker (2026-06-24)`
5. gbrain memory_id リスト（`- <type>: <slug>` 行）は **別ファイル** `.agent-loop/STATE_ARCHIVE/<run-id>/memory-index.md` へ移し、STATE には末尾 N 件＋総数のみ。

**安全:** `--apply` 無しでは「どの ROUND をどこへ動かすか」のプランのみ表示。冪等（既に archive 済みは再移動しない）。
移動前に `git stash`/コミット状態を尊重（dirty な STATE.md でも YAML+Resume は触らない）。

**効果:** 毎サイクルの STATE 読み込みが **YAML(33行)+Resume+直近2ROUND** に収まり、履歴は archive で追跡可能。

---

### 2.4 `tick` — 実ループドライバ（P4）

```
node .agent-loop/loop-cycle.mjs tick [--agent claude|codex] [--watch SECONDS]
```

**位置づけ（正直な範囲設定）:** `tick` は **1ターン分の決定的状態機械**。LLM ターンは spawn しない
（それは Phase 2 の `drive --headless`）。スーパーバイザーが**毎ターンこれを呼び**、散文から
phase を再導出する代わりに決定的な次アクションを得る。`next` の上位互換 + guard 統合 + 自動 advance。

**1 tick の手順（決定的・上から評価、最初にマッチで停止）:**

```
1. guard を内部実行 → trip なら resume 出力 + exit 2（STOP）。warn は続行。
2. inbox 確認: inbox.sh phos <agent> の未読件数。>0 なら
   "PHASE: yield — drain N inbox messages first" + exit 1（人/セッションが drain）。
3. gitDirty(agent): own/joint に dirty あり →
   PHASE implement/verify: cheap gates 実行。
     green → "send PATCH_REVIEW_REQUEST" を出力、gate_fail_streak=0。
     red   → 失敗 gate を出力、gate_fail_streak++ / gate_fail_kind 更新（--apply）。
3'  上で streak が 3 到達 → guard 再評価で trip（§14）。
4. clean tree:
     INFLIGHT(status) → PHASE §15 overlap（passive-wait 禁止。§14-ladder 提示）。
     else → PHASE §16 discover（次タスク選定を促し、objective 切替なら advance --objective）。
5. metrics を軽量更新（last_guard_check / 集計は --apply 時のみ書込）。
```

**`--watch SECONDS`:** 上記を SECONDS 間隔で再評価しループ表示（exit 2=hard-stop で終了、
exit 1=要 inbox drain で一時停止表示）。**実際の実装作業は依然セッション側**。tick は
「今どの phase か・次に何をすべきか・止まるべきか」を決定的に提示する骨格。

**Phase 2（将来・別設計）— `drive --headless`:** `claude -p`/`codex exec` を shell out して
真の無人駆動。本設計書のスコープ外（リスク・コスト・承認が別次元）。tick はその下地。

---

### 2.5 `propose` — メタループ本体 / PDCA Act 自動起案（P5・本書の核）

```
node .agent-loop/loop-cycle.mjs propose [--apply] [--since RUN-id|N-objectives] [--min-evidence 2]
```

**役割:** メタループの Act ステージ。`metrics` の劣化シグナル + gbrain の再発パターン + ログの傾向から、
**開発ループへの改善案を自動ドラフト**する。**適用はしない** — `status: proposed` で起案するだけ。
これが「careviax 開発ループを改善するループ」の心臓部。

**入力シグナル（証拠ベース・閾値ゲート付き）:**

| シグナル源                                                                     | 検出する弱点                         | 起案される改善（例）                                                                  |
| ------------------------------------------------------------------------------ | ------------------------------------ | ------------------------------------------------------------------------------------- |
| `metrics.recurrence_rate` ↑ / gbrain 同一 FailurePattern `times_confirmed ≥ N` | 同じバグ class が再発（不完全 fix）  | その FailurePattern を `LOOP_POLICY ApplyNow` 新 §候補へ昇格起案 / 関連 gate 追加提案 |
| `metrics.review_gate_miss_count` > 0 が複数 objective                          | objective gate が見逃し、review 頼み | `GATE_CONFIG` への新 gate 配線提案（例: 特定 lint rule / contract test）              |
| `metrics.post_approval_rework_count` ↑                                         | APPROVED 後の手戻り＝review 観点漏れ | `prompts/codex-lead.md` の review チェックリスト項目追加起案                          |
| 同一 gate が複数 objective で fail                                             | 構造的なツール/手順問題              | FixPattern 化 + `LOOP_POLICY` 手順追記起案（例: §25 serial long-gate の類）           |
| `PATCH_INBOX` の CHANGES_REQUESTED カテゴリ集中                                | maker の頻出ミス class               | maker prompt への予防ルール起案                                                       |
| `metrics.cycles_to_done` / `review_turnaround` ↑                               | プロセス摩擦・遅延                   | 通信圧縮/handoff ルール調整起案（§26 の類）                                           |
| `GATE_CONFIG` の TODO gate が未配線で metrics.safety が null                   | 計測欠落                             | gate 配線タスクを `FEATURE_QUEUE`(LE) へ起案                                          |
| `PROMOTION_QUEUE` の CandidateLesson `times_confirmed` 増                      | 実証済み手法                         | candidate → shadow への昇格起案                                                       |

**出力（すべて起案のみ・適用なし）:**

- `.agent-loop/PROPOSALS.md`（新規 append-only 台帳）へ 1 提案 = 1 fenced YAML:
  ```yaml
  - id: PROP-20260625-001
    ts: 2026-06-25T10:00:00+09:00
    kind: loop_policy_patch # loop_policy_patch | prompt_patch | gate_wiring | promotion | gbrain_method
    target: LOOP_POLICY.md # 改善対象ファイル
    evidence: # 証拠（無いと起案しない）
      - metric: recurrence_rate
        value: 0.18
        objectives: [F-...-002, F-...-007]
      - gbrain: projects/careviax/failures/<slug> (times_confirmed=3)
    draft: > # 提案本文ドラフト（人/codex がレビューする素案）
      ApplyNow §N 候補: <...>
    status: proposed # proposed → peer-approved → applied | rejected
    proposed_by: meta-loop(propose)
    reviewed_by: ''
    risk: low # low | medium | high(=human-gate必須)
  ```
- `PROMOTION_QUEUE.md` への candidate 行追記（既存 promotion パイプラインに接続）。

**既存 promotion パイプラインへの接続（重要・再利用）:**
`CONTROL_PLANE_CONFIG.yml` の `promotion.states: candidate→shadow→canary→default→locked` を**そのまま使う**。
`propose` は **candidate** 状態を生成するのみ。shadow（並行A/B計測）→ canary → default への昇格は
既存の `promotion.required`（baseline 非劣化 / peer 合意 / human 承認）ゲートを通る。
→ 自動*起案* + 既存ゲートで*段階適用*。新しい承認機構は作らない。

**ガバナンス（自己改変の安全弁）:**

- **証拠必須**: `evidence` が空の提案は生成禁止（投機的提案を防ぐ）。
- **複数独立観測**: `--min-evidence 2`（既定）＝ 2 以上の独立 objective/cycle でシグナルが立った時のみ起案（ノイズ抑制）。
- **dedup**: 既存 `LOOP_POLICY` ルール / `PROPOSALS.md` の未決提案 / `Ignore` セクションと照合し再提案しない。
- **risk=high は即 human-gate**: ポリシー範囲拡大・権限・gate 閾値変更・auth/billing/security 周辺は `proposed` 止まりで人間必須。
- **自動適用の絶対禁止**: `propose --apply` が書くのは **PROPOSALS.md / PROMOTION_QUEUE への起案行のみ**。
  LOOP_POLICY / prompts / GATE_CONFIG の**本体は決して書き換えない**（既存 §13 no-auto-promote と整合）。

**実行タイミング:** objective close / run close、または `metrics` が劣化を検出した時。`tick` の step 5 から
`metrics` 更新後に軽量呼び出し（提案件数を表示、`--apply` は明示時のみ）。

**これで閉じる自己改善ループ:**

```
tick で Product-Loop 実行 → VERIFY/REVIEW_LOG → metrics(Check) → propose(Act起案)
  → PROPOSALS/PROMOTION_QUEUE(candidate) → peer+human gate → applied
  → 次サイクルは改善された LOOP_POLICY/prompts/gate の下で回る ↺（メタループが一周）
```

---

## 3. 新規/変更ファイル一覧

| ファイル                          | 種別             | 変更                                                                                                                           |
| --------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `loop-cycle.mjs`                  | 変更             | `guard` / `metrics` / `compact` / `tick` / `propose` 関数 + CLI case 追加。`advance --objective` 拡張。`parseState` は既存互換 |
| `STATE.md`                        | 変更（スキーマ） | §1 の新 YAML フィールド追加（初期化）                                                                                          |
| `STATE_ARCHIVE/`                  | 新規             | compact の退避先                                                                                                               |
| `PROPOSALS.md`                    | **新規台帳**     | `propose` の起案先（append-only、1提案=1 fenced YAML、status=proposed）。メタループの出力                                      |
| `VERIFY_LOG.md` / `REVIEW_LOG.md` | 規約追加         | §2.2 の fenced YAML 追記フォーマット（既存エントリは温存・skip 扱い）                                                          |
| `PROMOTION_QUEUE.md`              | 規約追記         | `propose` が candidate 行を起案。既存 promotion states に接続（新ゲートは作らない）                                            |
| `GATE_CONFIG.md`                  | 追記             | secret-scan / `pnpm audit` の配線手順（metrics safety 用 + propose の gate_wiring 起案先）                                     |
| `LOOP_POLICY.md`                  | 追記候補         | guard/tick を §6/§14/§16 の**実行系**、propose を §13 LE-PDCA の**自走系**として参照する 1 行（散文 SSOT と実行系の対応明記）  |

---

## 4. 着地計画（LE トラック / maker-checker）

本強化は **Loop Engineering（LE）トラック**そのもの（`LOOP_POLICY.md` §13 / README §3.2）。
ライブループの JOINT 台帳規律を守って着地:

1. **Phase 0（本書）** — 設計書。`.agent-loop/plans/loop-runtime-controller-design.md` へ LOCK 下で昇格。
2. **Phase 1 — STATE スキーマ + `guard`**（最小・最高 ROI）。`loop-cycle.mjs` を LOCK→実装→
   codex CHECKER レビュー→objective gate→land。guard 単体は read-mostly で低リスク。
3. **Phase 2 — `compact`**（STATE 読み負荷を即下げる）。STATE_ARCHIVE 初期化を含む。
4. **Phase 3 — 構造化ログ規約 + `metrics`**（VERIFY/REVIEW_LOG フォーマット移行を伴う）。**= メタループのセンサー稼働**。
5. **Phase 4 — `tick`**（guard+gate+next 統合の決定的ドライバ）。
6. **Phase 5 — `propose` + PROPOSALS.md**（メタループ本体）。metrics が安定計測できる Phase 3 以降に依存。
   ここで初めて「開発ループを改善するループ」が閉じる。最初は `--apply` 無し（提案表示のみ）で
   数 run 観測し、誤起案/ノイズ率を確認してから台帳書き込みを有効化。
7. 各 Phase は **maker ≠ checker**、cheap gates + 自己（loop-cycle.mjs 自体の）スモークテスト必須。
   **特に Phase 5 は「ループが自分のポリシーに触れる」ため、起案のみ/適用ゲート維持を不変条件として検証。**

> 実装は **careviax ループ本体**が LOCK→実装→codex レビューで進めるのが正道（衝突回避）。
> この openclaw セッションは設計の SSOT を提供するに留める。

---

## 5. リスク・未決事項

| #   | 論点                                                                               | 既定案                                                                                                                                                        |
| --- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | guard が誤って trip → 作業中断                                                     | warn(80%) で予告、trip は `--apply` 必須。誤検知時は objective 再初期化で解除                                                                                 |
| R2  | 構造化ログ移行で旧エントリ非互換                                                   | パーサは旧形式を skip+カウント。強制移行しない（前方互換）                                                                                                    |
| R3  | compact が履歴を失う懸念                                                           | 物理削除せず STATE_ARCHIVE へ移動 + index 行 + git 履歴で二重に追跡                                                                                           |
| R4  | `cycle_baseline_ref` の取得タイミング                                              | objective 開始時（`advance --objective`）に `git rev-parse HEAD` 固定。resume 跨ぎでリセットしない                                                            |
| R5  | tick が「自動実装」と誤認される                                                    | ドキュメントで明示: tick=決定的骨格、LLM ターンは spawn しない。無人化は Phase 2 別設計                                                                       |
| R6  | 90分/4cycle の "objective" 境界定義                                                | `objective_id` の切替で確定。run-global の `current_cycle` とは別カウンタ                                                                                     |
| R7  | secret/PHI スキャンの誤検知/取りこぼし                                             | `--phi-scan` は任意。配線済み gate（secret-scan）がある場合はそちらを正本に                                                                                   |
| R8  | **メタループの自己改変暴走**（propose がポリシーを書き換える）                     | `propose` は **PROPOSALS/PROMOTION_QUEUE への起案行のみ**書込。LOOP_POLICY/prompts/GATE_CONFIG 本体は不可侵。適用は既存 peer+human gate。risk=high は人間必須 |
| R9  | **propose のノイズ/誤起案**（劣化シグナルの過検出）                                | 証拠必須 + `--min-evidence 2`（複数独立観測）+ dedup。初期は `--apply` 無しで数 run 観測しキャリブレーション                                                  |
| R10 | **メタ計測の自己参照汚染**（メタループ自身の活動が Product-Loop metrics を歪める） | LE/メタ作業の commit/gate は metrics で別タグ（`objective` の LE 接頭辞）で分離集計。Product 指標に混入させない                                               |
| R11 | 改善が逆効果（適用後に metrics 悪化）                                              | promotion の `baseline_non_degradation` + `rollback_locked_version_exists` を利用。shadow/canary で A/B 後に default 昇格。悪化なら rolled_back               |

---

## 6. 受け入れ基準（実装フェーズ用）

- `guard` が実 STATE.md/git に対し決定的に clear/warn/trip を返し、trip 時に有効な Resume point を生成。
- `compact --apply` 後、STATE.md が YAML+Resume+直近2ROUND に収まり、archive index から全履歴を辿れる。冪等再実行で no-op。
- `metrics --apply` が REVIEW/VERIFY_LOG の構造化エントリから非 null 値を埋め、計測不能フィールドは理由付き null。
- `tick` が guard→inbox→dirty→clean を上から評価し、各 phase で `next` と同等以上の決定的指示 + 適切な exit code を返す。
- `propose` が実 metrics/gbrain/ログの劣化シグナルから**証拠付きの改善案**を生成し、`PROPOSALS.md` へ起案。
  証拠ゼロでは起案しない / 既存ルールと重複しない / **LOOP_POLICY 等の本体を書き換えない**ことを検証。
- **メタループ一周の E2E:** 意図的に劣化シグナル（同一 FailurePattern 再発等）を仕込み →
  `metrics` が検出 → `propose` が candidate を起案 → 既存 promotion ゲートを通って applied → 次 run で反映、を再現。
- 既存 `status`/`phases`/`next`/`gates`/`advance` の出力が回帰しない（スモーク比較）。

```

```
