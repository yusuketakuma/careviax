# PRD: CareViaX UI/UX Unified Workflow Theme

## Metadata

- Source spec: `.omx/specs/deep-interview-uiux-improvement.md`
- Created: `2026-04-03`
- Planning mode: `ralplan --consensus`
- Scope type: `brownfield`

## Problem

CareViaX には `PageScaffold` / `WorkflowPageHeader` / `WorkflowPageIntro` などの共通 UI primitive が存在するが、全画面ではまだ同じ情報設計テーマが徹底されていない。特にダッシュボードと中核業務フローで、件数の滞留、次アクション、横断導線、画面内の意味グループが画面ごとに揺れている。

その結果、薬剤師・スタッフが「まず何を見るか」「次にどこへ進むか」を画面ごとに学び直す必要があり、医療業務の連続処理に対して認知負荷が高い。

## Users

- 在宅訪問薬局の薬剤師
- 事務 / スタッフ
- 中核ワークフローを横断して処理する管理者 / 支援担当

## Goal

全画面に同一テーマの UI/UX を適用し、ダッシュボードと中核業務フローにおいて、判断順序、滞留件数、導線、強調ルール、グループ構造を一貫させる。

## Non-goals

- 業務フロー自体の変更
- バックエンド機能の変更
- 派手なデザインへの刷新

## Success Criteria

### Global

- 全画面で共通テーマが視覚的に一貫している
- ページ冒頭で「目的」「即時アクション」「補助導線」が分離されている
- バッヂ、強調、グルーピングが sparse かつ意味的に使われている
- 医療システムとして落ち着いた見た目を維持している

### Dashboard

- 最初の 5 秒で次が分かる
  - 今日の全体スケジュール
  - 自分のスケジュール
  - 今日やるべきこと
  - 各中核フローで止まっている件数
  - そこから作業へ進める導線

### Core Workflow

- `処方登録 → 調剤 → 調剤監査 → セット → セット監査 → 訪問 → 報告書作成 / スケジュール管理`
  の各工程で、現在地、滞留件数、次アクション、前後工程への移動が把握しやすい

### Full-Screen Adoption

- `core-now` と `tail-later` に分類された全画面に対して、適用完了または defer 理由が記録される
- `全画面改善` を宣言する時点で、未棚卸しの route family を残さない

## RALPLAN-DR Summary

### Principles

1. Clinical calm over visual novelty
2. Workflow-first ordering over page-local convenience
3. Shared primitives before page-specific exceptions
4. Badge and emphasis semantics must stay sparse and consistent
5. Roll out in reversible phases with verification at each slice

### Decision Drivers

1. 全画面を対象にしつつも、中核フローとダッシュボードを最優先で揃える必要がある
2. 業務フローや backend を変えずに UI/UX だけで操作性を上げる必要がある
3. 既存 brownfield では共通 primitive が既に存在するため、再利用が最も安全で速い

### Viable Options

#### Option A: Big-bang all-pages sweep

Pros

- 最短で全画面に見た目の統一をかけられる
- 一時的な不統一期間が少ない

Cons

- 差分が大きく review / verification が難しい
- 中核フロー以外のページまで同時に触って regressions を見落としやすい
- banner, badge, hierarchy の判断が一度に広がり、設計がぶれやすい

#### Option B: Shared-theme primitives + workflow-first phased rollout

Pros

- 共通ルールを先に固定できる
- ダッシュボードと中核フローに高いレバレッジで適用できる
- verification と rollback がしやすい

Cons

- 一時的に一部ページだけ先行改善になる
- phase ごとに test / visual review が必要になる

#### Option C: Dashboard-only first, then opportunistic adoption

Pros

- もっとも低リスクに着手できる
- 価値が visible になりやすい

Cons

- 中核業務フローへの波及が遅い
- 全画面一貫テーマの実現が遠のく

### Decision

Adopt `Option B`.

### Alternatives Rejected

- Reject `Option A`: scope に対して diff と regression surface が大きすぎる
- Reject `Option C`: ユーザーが指定した最重要フローの改善を後回しにしてしまう

## Plan

### Phase 1: Shared Theme Contract

- `WorkflowPageHeader` / `WorkflowPageIntro` / `PageScaffold` の責務を全画面向けに明確化
- badge / emphasis / grouped section の rules を shared surface に寄せる
- header support copy, eyebrow, labeled shortcut grouping の共通パターンを整える
- canonical badge / emphasis contract artifact を作成する
- route inventory を作成し、各 family を `core-now`, `tail-later`, `out-of-scope-for-this-wave` に分類する

### Phase 2: Dashboard + Workflow Surfaces

- `dashboard` と `workflow` を同一テーマで再整理
- route responsibility split を先に固定する
  - `dashboard = today/personal work entry`
  - `workflow = cross-case pipeline backlog and exceptions`
- 「今日の全体」「自分の予定」「今日やること」「工程別滞留件数」「直接遷移」を最上段から読める構造へ寄せる

### Phase 3: Core Flow Top-level Pages

- `prescriptions`, `dispensing`, `auditing`, `medication-sets`, `visits`, `reports`, `schedules`
  の page-level header / support grouping / shortcut tone を揃える
- 主要一覧や queue でフィルタ / summary / action cluster / data group の順序を統一する

### Phase 4: Core Flow Detail Screens

- detail / edit / confirm pages に同じ hierarchy を適用する
- 現在地、前後工程、関連 action を見失わないようにする

### Phase 5: Remaining Screens Sweep

- Phase 5a: patients family (`patients`, patient-adjacent detail families)
- Phase 5b: communications + notifications + external
- Phase 5c: billing + tasks + my-day
- Phase 5d: remaining non-core dashboard families
- Phase 5e: admin route families only when they affect pharmacist/staff daily workflow directly
- each sub-phase must declare entry routes, success gates, and defer reasons before execution

## Risks

- desktop detail 画面でナビゲーションが重複する可能性
- intro-based pages と header-only pages の構造差が中途半端に残る可能性
- badge / emphasis の数が増えすぎると、逆に重要度が下がる
- broad sweep 中に page-local custom layouts が shared contract と衝突する可能性

## Guardrails

- `docs/ui-ux-design-guidelines.md` を常に SSOT とする
- バッヂは状態意味のあるものに限定する
- 色は意味付け用に限定し、装飾目的で増やさない
- 各ページで `即時対応 / 主要作業 / 補助情報` の再分類を先に行う
- まず page-level hierarchy を揃え、その後に細部装飾を触る
- `dashboard` と `workflow` の責務を混ぜない
- `tail-later` screens を無名のまま残さない

## Verification Strategy

- Unit
  - shared header / intro
  - shared badge / severity mapping where introduced
  - page-level grouping smoke where feasible
- Integration
  - dashboard / workflow / patients / reports content tests
  - route-family verification as each `tail-later` family enters execution
- E2E
  - page layout
  - detail layout
  - workflow / patient / schedule-report flows
- Visual / manual
  - dashboard
  - core workflow headers
  - badge density and calmness review on desktop + mobile

## Required Planning Artifacts

- PRD: `.omx/plans/prd-uiux-unified-workflow-theme.md`
- Test spec: `.omx/plans/test-spec-uiux-unified-workflow-theme.md`
- Badge / emphasis contract: `.omx/plans/badge-emphasis-contract-uiux.md`
- Screen inventory appendix: included below

## ADR

### Decision

workflow-first phased rollout on top of shared theme primitives

### Drivers

- broad scope
- strong user preference for full-screen consistency
- no workflow/backend changes allowed

### Alternatives considered

- big-bang sweep
- dashboard-only first

### Why chosen

best balance of consistency, safety, and execution throughput

### Consequences

- short-term temporary unevenness between completed and not-yet-migrated pages
- stronger need for phase-level verification

### Follow-ups

- expand shared header/intro semantics to remaining top-level pages
- add focused tests for grouped sections on key list/detail pages
- do a visual pass for duplicate nav patterns on desktop details
- keep the screen inventory updated as each route family moves phases

## Available Agent Types

- `planner`
- `architect`
- `critic`
- `executor`
- `test-engineer`
- `verifier`
- `code-reviewer`
- `security-reviewer`

## Execution Guidance

### Recommended lane for `ralph`

- Single-owner phased rollout
- Good when shared primitives and app-wide consistency need one coherent hand

### Recommended lane for `team`

- Parallel slices:
  - shared primitives + header surfaces
  - dashboard/workflow surfaces
  - core flow top-level pages
  - detail screens + verification

### Suggested reasoning by lane

- shared primitives: `high`
- dashboard/workflow restructuring: `high`
- page adoption sweeps: `medium`
- test/verification lanes: `medium`

## Launch Hints

- `ralph .omx/plans/prd-uiux-unified-workflow-theme.md`
- `$team .omx/plans/prd-uiux-unified-workflow-theme.md`

## Team Verification Path

1. shared primitives verified first
2. dashboard/workflow verified next
3. core flow pages verified by page-layout/detail-layout specs
4. final reviewer pass on badge density, hierarchy, and medical-system calmness

## Screen Inventory Appendix

### Core-now

- `dashboard`
- `workflow`
- `prescriptions`
- `dispensing`
- `auditing`
- `medication-sets`
- `visits`
- `reports`
- `schedules`
- supporting detail pages directly under the core flow

### Tail-later

- `patients` family
- `communications` family
- `billing` family
- `notifications`
- `external`
- `tasks`
- `my-day`
- remaining non-core dashboard families

### Out-of-scope-for-this-wave

- admin-only route families that do not materially affect pharmacist/staff daily workflow
- pure print/export surfaces unless a shared primitive change regresses them
