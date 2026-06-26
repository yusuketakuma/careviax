# Design — Phase 5 `propose` 詳細実装設計 + gbrain 活用確立

> Status: **DESIGN ONLY**（実装はループ本体の LE トラック / maker-checker で着地）
> Parent: `loop-runtime-controller-design.md`（メタループ全体設計）の Phase 5 を具体化
> Author: claude (openclaw session, 2026-06-25)
> Scope: (A) `propose` の実装可能レベルの詳細設計、(B) gbrain を**証拠バックボーン**として確立する protocol

---

## A. `propose` 実装設計

### A0. 一行定義

`propose` = **gbrain + 構造化ログ + metrics から開発ループの弱点を証拠ベースで検出し、`LOOP_POLICY`/prompts/`GATE_CONFIG` への改善案を `PROPOSALS.md` に自動起案する**。本体ファイルは書き換えない。適用は既存 peer+human gate。

### A1. 3 ステージ・パイプライン

```
sense()   → diagnose()        → draft()
証拠収集     検出器を当て閾値判定    提案生成・dedup・台帳書込
(gbrain/log/  (純関数 Detector[])   (PROPOSALS.md / PROMOTION_QUEUE /
 metrics)                          gbrain CandidateLesson draft)
```

各ステージは純粋・決定的・テスト可能。`sense` は read-only、`draft` のみ `--apply` 時に書込。

### A2. データ構造

```js
// sense() の出力
/** @typedef {{ source:'gbrain'|'verify_log'|'review_log'|'metrics'|'gate_config',
 *   key:string, value:number|string, objectives:string[], slug?:string,
 *   evidence_level?:string, ts?:string }} Signal */

// diagnose() の出力
/** @typedef {{ detector:string, severity:'low'|'medium'|'high',
 *   summary:string, signals:Signal[], objectives:string[],
 *   suggestedKind:ProposalKind, target:string, risk:'low'|'medium'|'high' }} Diagnosis */

// draft() の出力（= PROPOSALS.md の 1 エントリ）
/** @typedef {'loop_policy_patch'|'prompt_patch'|'gate_wiring'|'promotion'|'gbrain_method'|'memory_cleanup'} ProposalKind */
```

### A3. `PROPOSALS.md` スキーマ（新規 append-only 台帳・確定版）

```yaml
- id: PROP-20260625-001 # PROP-<yyyymmdd>-<seq>
  dedupe_key: <sha256(kind+target+evidence_signature)> # 再起案抑止の主キー
  ts: 2026-06-25T10:00:00+09:00
  kind: loop_policy_patch # ProposalKind
  target: LOOP_POLICY.md # 改善対象ファイル/セクション
  detector: RECURRING_FAILURE # どの検出器が起案したか
  severity: high
  risk: low # low|medium|high(=human-gate必須)
  evidence: # 空なら起案禁止（投機防止）
    - source: gbrain
      ref: projects/careviax/failures/<slug>
      detail: 'times_seen=3, fixed_by=<fix-slug> but recurred in F-...-007'
      evidence_level: gate_verified
    - source: verify_log
      ref: VERIFY_LOG.md#2026-06-22
      detail: 'regression=true, recurrence_slug=<slug>'
  objectives: [F-20260622-002, F-20260624-007] # ≥ min-evidence の独立観測
  draft: > # 人/codex がレビューする素案本文
    ApplyNow §N 候補: <FailurePattern slug> は FixPattern 適用後も F-007 で再発。
    根本原因 <...> に対し、(a) <tests_to_run> を objective gate に追加、
    (b) maker prompt に <予防チェック> を追記する。
  links: # 既存 promotion パイプライン接続
    promotion_queue_row: null # candidate 行を作った場合その参照
    gbrain_candidate_lesson: null # 起案した CandidateLesson slug
  lifecycle:
    status: proposed # proposed → peer-approved → applied | rejected | superseded
    times_surfaced: 1 # 同 dedupe_key が再検出された回数（適用圧の指標）
    proposed_by: meta-loop(propose)
    reviewed_by: ''
    decided_at: null
    applied_commit: null
```

> **不変条件:** `propose` が書くのは PROPOSALS.md（と任意で PROMOTION_QUEUE の candidate 行 /
> gbrain CandidateLesson draft）**のみ**。`target` のファイル本体は決して書かない。

### A4. 検出器カタログ（Detector[]）

各検出器 = `(signals) => Diagnosis | null`。閾値・最小証拠数で gate。

| ID                       | 検出する弱点                                                             | 入力シグナル                                                                                               | 閾値（既定）                   | suggestedKind / target                                                     | risk                                |
| ------------------------ | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- | ------------------------------ | -------------------------------------------------------------------------- | ----------------------------------- |
| **D1 RECURRING_FAILURE** | FixPattern 適用後も同一バグ class 再発（不完全 fix）= 最高価値           | gbrain FailurePattern `times_seen≥2` かつ `fixed_by` 有なのに新 run で再発（VERIFY_LOG `recurrence_slug`） | 2 独立 objective               | loop_policy_patch + gate追加 / LOOP_POLICY.md + GATE_CONFIG.md             | low                                 |
| **D2 GATE_BLIND_SPOT**   | objective gate が見逃し review 頼み                                      | gbrain ReviewFinding（gate green 後の指摘）同一 `finding_type`                                             | 2 objective・同 type           | gate_wiring / GATE_CONFIG.md                                               | low                                 |
| **D3 REVIEW_REWORK**     | APPROVED 後手戻り / CHANGES_REQUESTED 集中                               | REVIEW_LOG `verdict=changes_requested` 同カテゴリ + `post_approval_rework`                                 | 3 件同カテゴリ                 | prompt_patch / prompts/codex-lead.md                                       | low                                 |
| **D4 GATE_FRICTION**     | 同一 gate が構造的に fail（手順問題）                                    | VERIFY_LOG `failing` 同一 gate が複数 objective                                                            | 2 objective                    | loop_policy_patch(FixPattern) / LOOP_POLICY.md                             | low                                 |
| **D5 PROCESS_LATENCY**   | review_turnaround / cycles_to_done 悪化トレンド                          | metrics 時系列（3 run 移動）                                                                               | 連続3run 悪化                  | prompt_patch(comm) / LOOP_POLICY.md §26系                                  | medium                              |
| **D6 MEASUREMENT_GAP**   | gate 未配線で metrics.safety が null                                     | METRICS null + GATE_CONFIG TODO                                                                            | 即時                           | gate_wiring / FEATURE_QUEUE(LE)                                            | low                                 |
| **D7 PROMOTION_READY**   | 実証済み lesson が昇格待ち                                               | gbrain CandidateLesson `times_confirmed≥2`(独立) + peer_agreement + gate_verified                          | 即時                           | promotion / PROMOTION_QUEUE.md                                             | low(高risk targetは要human)         |
| **D8 MEMORY_DRIFT**      | 記憶の陳腐化/矛盾蓄積                                                    | gbrain `find_contradictions` / StaleMemory・MemoryConflict 増                                              | 矛盾≥1                         | memory_cleanup / FEATURE_QUEUE(LE)                                         | low                                 |
| **D9 RESEARCH_BACKED**   | 外部のループ工学新技法が内部弱点に効く（OpenClaw `research` stage 由来） | gbrain `ResearchFinding`/`ExternalMethod`（外部出典）**×** 内部 FailurePattern/metrics 劣化の**融合ペア**  | 外部1 + 内部弱点1（fuse 必須） | loop_policy_patch/prompt_patch（research_backed）/ LOOP_POLICY.md・prompts | medium（外部由来=要 shadow/canary） |

> 検出器は**プラガブル**: `const DETECTORS = [D1, D2, ...]` の配列。新しい弱点クラスは関数追加だけで拡張。
> **D9 は OpenClaw `research` stage（外部 web 検索＋推論）が gbrain に書いた `ResearchFinding` を入力源にする**。
> 外部単独では起案せず、内部弱点とペアになった時のみ候補化（fuse ゲート）。出典 URL **と**内部証拠を両方引用。
> 外部由来は `evidence_level: observed`（最低位）→ owner-approval gate に加え shadow/canary で内部検証してから default 昇格。
> 詳細は `~/.openclaw/AGENT_LOOP_INTEGRATION_DESIGN.md` §3.1（research stage: acquire→reason→fuse→derive）。

#### D1 の worked pseudocode（最重要・gbrain グラフ活用例）

```js
// D1: FixPattern があるのに再発した failure を、グラフ辺で検出する
function detectRecurringFailure(signals) {
  // sense() が gbrain から集めた FailurePattern シグナル群
  const failures = signals.filter((s) => s.source === 'gbrain' && s.key === 'FailurePattern');
  const out = [];
  for (const f of failures) {
    if (Number(f.value /* times_seen */) < 2) continue;
    // typed edge: FailurePattern --fixed_by--> FixPattern が存在するか
    const hasFix = gbrainHasEdge(f.slug, 'fixed_by'); // gbrain graph-query
    // VERIFY_LOG に recurrence_slug=f.slug の regression が、fix commit より後にあるか
    const recurredAfterFix = verifyLogRecurredAfter(f.slug);
    const objs = recurredAfterFix.objectives;
    if (hasFix && recurredAfterFix.hit && objs.length >= MIN_EVIDENCE) {
      out.push({
        detector: 'RECURRING_FAILURE',
        severity: 'high',
        risk: 'low',
        summary: `FixPattern適用後も ${f.slug} が ${objs.length} objective で再発`,
        signals: [f, ...recurredAfterFix.signals],
        objectives: objs,
        suggestedKind: 'loop_policy_patch',
        target: 'LOOP_POLICY.md+GATE_CONFIG.md',
      });
    }
  }
  return out;
}
```

これが「不完全 fix（緑ゲートをすり抜けて再発するバグ class）」を構造的に捕まえ、
「その class を ApplyNow ルール化 + 回帰テストを gate 化」する提案に変換する。
**典型的に最も価値の高い自己改善** — STATE.md の実例（`false-empty-and-stale-wipe`、`serial-no-unused-after-next-build`）がまさにこの形。

### A5. `diagnose()` のゲーティング（ノイズ抑制）

```
1. min-evidence: 各 Diagnosis は ≥ MIN_EVIDENCE(=2) の独立 objective を要求。1点なら捨てる。
2. evidence quality: gbrain 由来シグナルは evidence_level ≥ peer_reviewed のみ採用（§11 memory_quality）。
   観測のみ(observed)の弱い記憶からは起案しない。
3. dedup（3層）:
   a. PROPOSALS.md に同 dedupe_key の open 提案 → times_surfaced++ のみ（再起案しない）。
   b. LOOP_POLICY.md の ApplyNow/Ignore に既出 → skip（settled を蒸し返さない）。
   c. gbrain RejectedApproach に do_not_repeat_until 一致 → skip（却下済みを再提案しない）。
4. risk 分類: target が auth/billing/security/権限/gate閾値/AGENTS|CLAUDE.md → risk=high（human必須フラグ）。
```

`times_surfaced` が増える提案 = 「何度も同じ弱点が出る」= 適用圧。レビュー優先度のソートキー。

### A6. CLI 表面

```
node .agent-loop/loop-cycle.mjs propose \
  [--agent claude|codex] [--apply] \
  [--since RUN-id|<N>-objectives] \   # 観測窓（既定: 直近 run）
  [--min-evidence 2] \                # 独立観測の下限
  [--detectors D1,D2,...] \           # 検出器サブセット（既定: 全部）
  [--format md|json]                  # 出力形式
```

- `--apply` 無し（既定）: 検出した Diagnosis と生成予定 Proposal を**表示のみ**（dry-run）。
- `--apply`: PROPOSALS.md へ append（dedup 後）。high-risk は `status:proposed` + `[HUMAN-GATE]` マーク。
- exit 0: 正常（提案 0 件でも 0）。exit 1: 入力不全（ログ未構造化等）。

### A7. `loop-cycle.mjs` コードスケルトン（既存スタイル準拠）

```js
// ── propose (Phase 5: メタループ Act 自動起案) ──
const MIN_EVIDENCE = 2;
const DETECTORS = [
  detectRecurringFailure,
  detectGateBlindSpot,
  detectReviewRework,
  detectGateFriction,
  detectProcessLatency,
  detectMeasurementGap,
  detectPromotionReady,
  detectMemoryDrift,
];

function gbrainCli(args) {
  // 薄い CLI ラッパ（[config] 行を除去）
  const r = sh('gbrain', args);
  return (r.stdout || '')
    .split('\n')
    .filter((l) => !l.startsWith('[config]'))
    .join('\n');
}
function gbrainList(type, tag) {
  // list --type --tag → 行配列
  return gbrainCli(['list', '--type', type, ...(tag ? ['--tag', tag] : []), '-n', '50']);
}
function gbrainHasEdge(slug, linkType) {
  // graph-query で辺の有無
  return (
    gbrainCli(['graph-query', slug, '--type', linkType, '--direction', 'out']).trim().length > 0
  );
}

function sense(opts) {
  /* gbrain + VERIFY/REVIEW_LOG + metrics() → Signal[] */
}
function diagnose(signals, opts) {
  // 全検出器 → gate → Diagnosis[]
  return DETECTORS.flatMap((d) => d(signals) || [])
    .filter((dg) => dg.objectives.length >= (opts.minEvidence ?? MIN_EVIDENCE))
    .filter((dg) => !isDuplicateProposal(dg) && !isSettledInPolicy(dg) && !isRejectedInGbrain(dg));
}
function draft(diagnoses, opts) {
  // Diagnosis → Proposal、--apply で PROPOSALS.md append
  for (const dg of diagnoses) {
    const key = sha256(`${dg.suggestedKind}|${dg.target}|${evidenceSig(dg)}`);
    const existing = findProposalByKey(key);
    if (existing) {
      if (opts.apply) bumpSurfaced(existing);
      continue;
    }
    const prop = toProposal(dg, key); // PROP-id 採番・risk・draft 本文生成
    if (opts.apply)
      appendProposal(prop); // PROPOSALS.md 追記（本体ファイルは触らない）
    else printProposal(prop);
  }
}

function propose(opts) {
  const sig = sense(opts);
  const dgs = diagnose(sig, opts);
  draft(dgs, opts);
  console.log(`propose: ${dgs.length} diagnoses, ${opts.apply ? 'written' : 'dry-run'}`);
}
// CLI: case 'propose': propose(parseProposeFlags(rest)); break;
```

### A8. キャリブレーション / 段階導入

```
Stage A (shadow): --apply 無しで数 run。Diagnosis を人が目視し誤検出率を測る。閾値を調整。
Stage B (write):  --apply 有効化。PROPOSALS.md へ起案。週次で人/codex がトリアージ。
Stage C (cron):   objective close 時に tick から propose を自動呼び出し（起案のみ）。
```

PROPOSALS.md の `times_surfaced` と「採択された提案 / 全提案」比率が **メタループ自身の有効性指標**
（= metrics に `loop_engineering.proposal_acceptance_rate` を追加）。これでメタループも自己計測される。

---

## B. gbrain 活用の確立

> 目的: gbrain を「時々 recall する記憶」から、**propose の証拠バックボーン兼ループの自己改善エンジン**へ昇格させる。
> GBRAIN_SCHEMA.md §17 が明言する「6 load-bearing types で memory store → self-improvement engine になる」を**運用として確立**する。

### B1. 読み取り protocol（propose の sense が叩く具体クエリ）

検出器ごとに決まった gbrain クエリを発行する（CLI / MCP 併用）:

| 検出器               | gbrain 読み取り（CLI）                                                                                                | gbrain 読み取り（MCP・高機能版）                                                     |
| -------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| D1 RECURRING_FAILURE | `gbrain list --type FailurePattern -n 50` → `times_seen`、`gbrain graph-query <slug> --type fixed_by --direction out` | `mcp__gbrain__find_trajectory`（再発の時系列）、`mcp__gbrain__code_refs`（影響範囲） |
| D2 GATE_BLIND_SPOT   | `gbrain list --type ReviewFinding --tag <concern>`                                                                    | `mcp__gbrain__find_anomalies`（異常な指摘バースト）                                  |
| D3 REVIEW_REWORK     | `gbrain list --type ReviewFinding -n 50` + REVIEW_LOG                                                                 | `mcp__gbrain__takes_scorecard`（review 品質スコア）                                  |
| D7 PROMOTION_READY   | `gbrain list --type CandidateLesson` → `times_confirmed`/`promotion_status`                                           | `mcp__gbrain__recall`（関連 lesson 群）                                              |
| D8 MEMORY_DRIFT      | `gbrain list --type StaleMemory`、`--type MemoryConflict`                                                             | `mcp__gbrain__find_contradictions`（矛盾検出）、`find_orphans`（孤立記憶）           |

**品質ゲート（B1 不変条件）:** sense は **evidence_level ≥ peer_reviewed** かつ
**memory_quality.total ≥ 18（Consider 以上）**の記憶のみシグナル化。弱い記憶から提案を生まない。
記憶は live repo に従属（GBRAIN_SCHEMA 非交渉ルール）→ propose は「repo と矛盾する記憶」を
シグナルにしない（`find_contradictions` で除外）。

### B2. 書き込み protocol（gbrain を自動的に最新へ保つ）— **現状の最大ギャップを埋める**

現状 writeback は手動 + 一部 blocked（STATE.md: embedding dim mismatch 768/1024 で semantic-index put 失敗、
file-plane のみ成功）。propose が効くには gbrain が**最新の証拠で満たされている**必要がある。確立策:

1. **`gbrain sync` で git→brain 自動取り込み**（CLI が支援）:
   ```bash
   gbrain sync --repo /Users/yusuke/workspace/careviax --watch --interval 300
   # or 永続化:
   gbrain sync --install-cron
   ```
   → コミット済みの `.agent-loop/` ledger・docs・構造化ログが**自動 ingest**され、手動 put 漏れを防ぐ。
2. **構造化ログ → gbrain put の半自動化**（Phase 3 の fenced YAML を活用）:
   `loop-cycle.mjs writeback` ヘルパ（補助コマンド）を追加し、VERIFY_LOG/REVIEW_LOG の
   構造化エントリから `LoopRun`/`GateResult`/`ReviewFinding` のテンプレを生成 → `templates/gbrain/` に
   流し込み → `gbrain put`。これで「人が毎回手で書く」負担を消す。
3. **dedupe_key 厳守**（GBRAIN_SCHEMA §13）: put 前に `gbrain get` で衝突確認、衝突時は
   `times_seen`/`times_confirmed` を bump（新ページを作らない）。propose の D1/D7 はこのカウンタに依存。
4. **typed edge を必ず張る**（§6）: `FailurePattern --fixed_by--> FixPattern`、
   `LoopRun --produced--> Decision` を `gbrain link` で明示。D1 のグラフ検出はこの辺が前提。

> **前提ブロッカー（解決手段が CLI に実在）:** semantic-index の embedding 次元不一致（768 expected / 1024 got）。
> 解決: `gbrain doctor --json`（embeddings 健全性診断）→ **`gbrain embed --stale`**（陳腐化した埋め込みのみ再生成）
> または **`gbrain embed --all`**（全再生成）で次元を揃える。**keyword `search` / `list` / `graph-query` は
> 次元非依存で今すぐ動く** → propose の D1/D2/D7/D8 は semantic 無しでも成立（query 系のみ要修復）。
> propose の MEASUREMENT_GAP 検出器がこの未修復状態を自動で起案対象にできる。

5. **gbrain 自身の保守デーモンを使う**（手動メンテ不要化）:
   - **`gbrain dream`**（cron-friendly な overnight maintenance を1回実行）/ **`gbrain autopilot --install`**
     （継続デーモン）で、孤立記憶の link 補修・陳腐化検出・embedding 補修を自動化。
   - **`gbrain check-backlinks fix`** / **`gbrain extract links`** で typed edge の張り漏れを補修（D1 のグラフ前提を維持）。
   - **`gbrain lint --fix`** で frontmatter 不整合・placeholder 日付・LLM アーティファクトを掃除（記憶品質維持）。

### B3. MCP ツールの役割分担（CLI で足りない高機能）

セッション内（restart 後 `mcp__gbrain__*` 利用可）では、propose の diagnose を MCP で強化:

| MCP ツール                              | propose での用途                                                        |
| --------------------------------------- | ----------------------------------------------------------------------- |
| `find_contradictions`                   | repo/記憶の矛盾 → D8、かつ全検出器の「repo 矛盾シグナル除外」フィルタ   |
| `find_trajectory`                       | あるバグ class / decision の時系列推移 → D1 再発判定・D5 トレンド       |
| `find_anomalies`                        | 指摘・失敗のバースト検出 → D2/D3                                        |
| `get_recent_salience`                   | 直近 run で何が頻出したか → 観測窓の自動決定                            |
| `traverse_graph`                        | FailurePattern→FixPattern→LoopRun のチェーン追跡 → 根本原因の提案文生成 |
| `takes_scorecard` / `takes_calibration` | review 判定の質スコア → D3 の証拠強化                                   |
| `advisor`                               | 起案 draft 本文のレビュー観点補強（任意）                               |

**CLI 相当（headless/cron で propose を完全動作させる正本）:** 上記 MCP は対話セッション専用だが、
同等機能が **CLI に実在**するため propose は MCP 不在でも成立する:

| MCP（対話）           | CLI 相当（headless 正本）                                 | 検出器              |
| --------------------- | --------------------------------------------------------- | ------------------- |
| `find_anomalies`      | `gbrain anomalies --since <D> --sigma <N>`                | D2/D3               |
| `find_orphans`        | `gbrain orphans --json`                                   | D8                  |
| `get_recent_salience` | `gbrain salience --days <N>`                              | 観測窓決定          |
| `traverse_graph`      | `gbrain graph <slug> --depth N` / `graph-query`           | D1                  |
| `find_contradictions` | （semantic 要・`query` 修復後）+ `gbrain lint` で構造矛盾 | D8 / 全除外フィルタ |

> propose は **CLI を正本**（cron/headless 安定性）、MCP があれば diagnose 精度を上げる二段構え。
> `find_contradictions` だけは semantic 依存 → embedding 修復（B2-前提ブロッカー）後に有効化、
> それまでは `lint` + repo 直読で代替。

### B4. gbrain → propose → gbrain の自己強化ループ

```
gbrain(FailurePattern/ReviewFinding/CandidateLesson)
    │ sense (B1 クエリ)
    ▼
propose → PROPOSALS.md(起案) ──peer+human gate──▶ applied(LOOP_POLICY等)
    │                                                  │
    │ 採否の結果を書き戻し                                │ 次 run で効果が出る
    ▼                                                  ▼
gbrain: 採択→CandidateLesson昇格(times_confirmed++) / 却下→RejectedApproach(do_not_repeat)
    └──────────── 次の propose がこの結果を読んで精度向上 ◀──────────────┘
```

**重要:** propose の**結果自体を gbrain に書き戻す**ことで、メタループが「どの改善が効いたか」を学習する。

- 採択された提案 → 関連 CandidateLesson の `times_confirmed++`、効果を LoopRun に記録。
- 却下された提案 → `RejectedApproach`（`do_not_repeat_until` 条件付き）→ A5 dedup-c で再起案を抑止。
  これで gbrain は「careviax の作り方」だけでなく「**careviax の作り方の直し方**」も蓄積する = メタ記憶。

### B5. 確立チェックリスト（運用開始の DoD）

- [ ] `gbrain sync --install-cron` で careviax の構造化ログ/ledger が自動 ingest される。
- [ ] `loop-cycle.mjs writeback` が VERIFY/REVIEW_LOG → LoopRun/GateResult/ReviewFinding を put（dedup・link 込み）。
- [ ] semantic-index dim mismatch を `gbrain doctor` で解消（または keyword 系のみで propose 稼働を確認）。
- [ ] propose の sense が evidence_level/quality でフィルタし、repo 矛盾記憶を除外している。
- [ ] 採択/却下が gbrain（CandidateLesson/RejectedApproach）へ書き戻り、次 propose が参照する。

---

## C. 受け入れ基準（Phase 5 実装フェーズ用）

- `propose` が実 gbrain/ログから **D1〜D8 の少なくとも D1/D2/D7** を証拠付きで検出し、`--apply` で PROPOSALS.md に dedup 済み起案を生成。
- 証拠ゼロ / evidence_level < peer_reviewed / repo 矛盾 の記憶からは**起案しない**ことをテストで保証。
- `LOOP_POLICY`/prompts/`GATE_CONFIG` の**本体を書き換えない**ことを不変条件テストで保証。
- high-risk target は `[HUMAN-GATE]` 付き `proposed` 止まり。
- 同一シグナル再投入で重複起案せず `times_surfaced++`（冪等）。
- 採択/却下の gbrain 書き戻しで次 run の propose が挙動を変える（自己強化の E2E）。
- gbrain `sync` 経由で手動 put 漏れがあっても直近 ledger がシグナル化される。

---

## D. まとめ — 何が「自己改善するメタループ」を成立させるか

| 要素                     | 役割                        | 確立手段                                         |
| ------------------------ | --------------------------- | ------------------------------------------------ |
| 構造化ログ(Phase3)       | 証拠の機械可読化            | VERIFY/REVIEW_LOG fenced YAML                    |
| gbrain(B)                | 証拠バックボーン + メタ記憶 | sync 自動 ingest + writeback ヘルパ + typed edge |
| `propose`(A)             | 弱点検出 → 改善起案         | 8 検出器 + 閾値/dedup + PROPOSALS.md             |
| promotion pipeline(既存) | 段階適用ゲート              | candidate→shadow→canary→default（再利用）        |
| 書き戻し(B4)             | 「直し方」の学習            | 採否を CandidateLesson/RejectedApproach へ       |

これらが揃うと: **gbrain が「何が壊れ・どう直したか」を蓄積 → propose がそこから「ループ自体の弱点と直し方」を
起案 → 人/codex が承認 → 適用 → 効果を gbrain に書き戻し → 次の起案が賢くなる**、という
careviax 開発ループを改善し続けるメタループが閉じる。自動*起案*まで、適用は人間ゲート維持。
