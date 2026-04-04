# Autopilot Spec: UI/UX Improvement From Recent Implementation

## Goal

直近で導入された `PageScaffold` / `WorkflowPageHeader` / `WorkflowPageIntro` を基準に、一覧・詳細ページの情報階層を強化する。

## Scope

- 共通ヘッダーで役割分離を強める
- `patients` / `reports` の主要ページで、フィルタ・状況把握・データ一覧を意味グループとして再配置する
- 既存の dashboard 系レイアウト方針と文言トーンを踏襲する

## Non-goals

- 大規模な配色変更やデザイン言語の刷新
- データ取得ロジックや API 契約の変更
- 新規画面追加

## UX requirements

1. ページ冒頭で、ページの目的と即時アクションが最初に分かること
2. ショートカットや補助導線は本文と混ぜず、ヘッダー下段の補助グループとして見せること
3. 一覧ページでは「絞り込み」「状況サマリー」「一覧本体」が視覚的に分離されること
4. モバイルでも同じ順序を保ったまま縦積みで読めること

## Technical constraints

- 既存の共通部品を再利用する
- App Router の page / client component 分離は維持する
- 既存テスト資産の範囲で回せるよう、差分は共有部品と主要ページに絞る

## Success criteria

- `patients` / `reports` / `patient detail` のヘッダーが一貫した構造を持つ
- `patients-table` / `reports-table` 内の主要グループ分離が明確になる
- 既存のユニットテストと focused Playwright レイアウト検証が通る
