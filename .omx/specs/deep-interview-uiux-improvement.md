# Deep Interview Spec: UI/UX Improvement

## Metadata

- Interview ID: `deep-interview-uiux-20260403T021915Z`
- Profile: `standard`
- Rounds: `9`
- Final Ambiguity: `0.168`
- Threshold: `0.20`
- Context Type: `brownfield`
- Context Snapshot: `.omx/context/uiux-recent-implementation-20260403T015510Z.md`
- Transcript: `.omx/interviews/uiux-improvement-20260403T021915Z.md`

## Clarity Breakdown

| Dimension | Score |
| --- | --- |
| Intent Clarity | `0.84` |
| Outcome Clarity | `0.80` |
| Scope Clarity | `0.80` |
| Constraint Clarity | `0.92` |
| Success Criteria Clarity | `0.82` |
| Context Clarity | `0.82` |

## Intent

CareViaX 全画面に一貫した UI/UX テーマを導入し、薬剤師・スタッフが中核業務フローを迷わず処理できる状態にする。狙いは、導線整理、バッヂや強調の適正化、機能のグループ分けにより、医療業務に必要な判断順序を視覚的に揃えること。

## Desired Outcome

- 全画面で同一テーマの UI/UX が適用される
- ダッシュボードと中核業務フロー画面で、何を見るべきか・どこを押すべきかが直感的に分かる
- バッヂ、強調、グルーピングにより滞留件数や優先度が一目で判断できる
- 薬剤師・スタッフが中核フローへ直接遷移しやすい
- 見た目は医療システムにふさわしく、派手ではない

## In Scope

- CareViaX の全画面 UI/UX 改善
- 共通テーマの定義と適用
- バッヂ表現、情報強調、画面内グルーピング、見出し階層、導線整理
- ダッシュボードの再整理
- 以下の中核業務フロー画面の優先改善:
  - 処方登録
  - 調剤
  - 調剤監査
  - セット
  - セット監査
  - 訪問
  - 報告書作成
  - スケジュール管理

## Out-of-Scope / Non-goals

- 業務フロー自体の変更
- バックエンド機能の変更
- 派手なデザインへの刷新

## Decision Boundaries

OMX / 実装側が確認なしで決めてよい:

- バッヂ色や強調ルール
- グループ見出し名
- ページ内の並び替え
- アイコン選定
- 文言トーン
- 共通テーマの具体化
- ベストプラクティス寄りの UI 構成

必ず確認が必要なもの:

- なし

## Constraints

- `docs/ui-ux-design-guidelines.md` を UI/UX SSOT として従う
- 画面は意味のある塊で分ける
- ヘッダーと本文を分離する
- 上から順に判断できる情報順を守る
- モバイルでも情報階層を崩さず縦積みにする
- 共通 scaffold / header コンポーネントを優先利用する
- 既存の brownfield 実装方向と矛盾しない

## Testable Acceptance Criteria

### Global

- 全画面で同一テーマの UI/UX が視覚的に確認できる
- 各画面で主要機能が意味グループごとに整理されている
- バッヂや強調が多すぎず、情報判断の補助として機能している
- デザインが医療システムとして落ち着いており、派手ではない

### Dashboard

- 最初の 5 秒で次が分かる:
  - 今日の全体スケジュール
  - 自分のスケジュール
  - 今日やるべきこと
  - 各中核フローで止まっている件数
  - 各件数から直接作業へ進めるリンク

### Core Workflow Screens

- 処方登録から報告書作成 / スケジュール管理までの各工程で、現時点の状態・次アクション・滞留件数が把握しやすい
- 各工程間の移動導線が整理されている
- 薬剤師・スタッフが迷わず処理開始できる

## Assumptions Exposed + Resolutions

- Assumption: 全画面改善でも業務フローや機能仕様は変えない
  - Resolution: 明示的に非ゴールとして固定
- Assumption: UI 判断は実装側に広く委ねてよい
  - Resolution: 「確認不要」と明示
- Assumption: 医療システムらしさは派手さを避けること
  - Resolution: 「派手なデザイン」は拒否条件として固定

## Pressure-Pass Findings

- 初期の拒否条件は「医療システムとして相応しくないデザイン」で抽象的だった
- 再質問により「派手なデザイン」が具体的禁止条件として確定した
- この結果、配色や強調設計の上限が明確になった

## Brownfield Evidence vs Inference

Evidence:
- `docs/ui-ux-design-guidelines.md` が SSOT
- `PageScaffold`, `WorkflowPageHeader`, `WorkflowPageIntro` が共通 UI primitive として既に存在
- dashboard / patients / reports / detail pages に共通化の流れがある

Inference:
- 全画面改善は、既存の共通 primitive を広げる方針が最も整合的
- まず dashboard と中核フロー画面に統一テーマを適用するのが高レバレッジ

## Technical Context Findings

- Existing shared UI primitives:
  - `src/components/layout/page-scaffold.tsx`
  - `src/components/features/workflow/workflow-page-header.tsx`
  - `src/components/features/workflow/workflow-page-intro.tsx`
- Existing grouped dashboard structure:
  - `src/app/(dashboard)/dashboard/dashboard-content.tsx`
- Existing likely high-impact pages:
  - dashboard pages
  - patients pages
  - reports pages
  - workflow / scheduling / detail pages

## Handoff Recommendation

Recommended next step: `$ralplan`

Rationale:
- Requirements are now clear enough to stop interviewing
- Scope is very broad (`全画面改善`) and needs architecture / sequencing before execution
- A consensus plan should decide rollout shape, shared theme primitives, and verification slices before a full implementation pass
