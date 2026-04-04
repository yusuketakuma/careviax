Task statement

UIUXを改善。直近実装内容を参照して実装。

Desired outcome

- 直近の共通UI改修の方向性に沿って、主要画面の情報階層と操作導線を見やすくする
- 既存の未コミット変更を壊さず、差分を小さく保ったまま共通部品と対象ページへ改善を反映する
- 関連テストで回帰がないことを確認する

Known facts and evidence

- `docs/ui-ux-design-guidelines.md` が UI/UX SSOT。ページは意味のある塊で分け、ヘッダーと本文を分離し、上から順に判断できる情報順を作る必要がある
- 直近の未コミット差分は dashboard / patients / reports / admin を中心に広く入っており、`PageScaffold` と `WorkflowPageHeader` 系の共通化が進んでいる
- `src/components/layout/page-scaffold.tsx` は主要グループに枠線、背景、角丸を一括で付与する共通 scaffold
- `src/components/features/workflow/workflow-page-header.tsx` は title / description / action / shortcuts をまとめる共通ヘッダー
- `src/app/(dashboard)/dashboard/dashboard-content.tsx` は「今日の運用」「業務導線」「患者確認」の大グループ化が進んでいる
- `src/app/(dashboard)/patients/[id]/page.tsx` と `src/app/(dashboard)/reports/page.tsx` は新しい共通 scaffold に載っているが、ヘッダーと本文の役割分離や優先情報の固定化はまだ改善余地がある

Constraints

- 既存 behavior を壊さない
- 既存パターンを再利用し、新規 dependency は追加しない
- UI/UX 改修前に SSOT を根拠にする
- Next.js の現行 docs を参照してから app router 配下を編集する
- 変更後は lint / typecheck / tests / static analysis のうち、少なくとも今回の対象に対して妥当な範囲を実行する

Unknowns and open questions

- どのページが直近の視覚回帰テストの主対象か
- 共通ヘッダー改善をどの範囲まで一括適用して安全か
- 患者一覧 / 報告書一覧 / 患者詳細のどこが最も高レバレッジか

Likely codebase touchpoints

- `src/components/layout/page-scaffold.tsx`
- `src/components/features/workflow/workflow-page-header.tsx`
- `src/components/features/workflow/workflow-page-intro.tsx`
- `src/app/(dashboard)/patients/page.tsx`
- `src/app/(dashboard)/patients/[id]/page.tsx`
- `src/app/(dashboard)/reports/page.tsx`
- `src/app/(dashboard)/reports/reports-table.tsx`
- `src/app/(dashboard)/patients/patients-table.tsx`
- `src/app/(dashboard)/dashboard/dashboard-content.tsx`
