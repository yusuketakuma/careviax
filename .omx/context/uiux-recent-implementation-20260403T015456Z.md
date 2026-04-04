## Task statement

`$autopilot` UI/UX を改善する。直近の page scaffold / page header 系の実装を参照し、その方向性を壊さずに主要ページの情報階層を強化する。

## Desired outcome

- 直近の UI 共通化方針に沿って、ページ冒頭のヘッダーが「目的」「即時導線」「補助導線」で分離される
- 一覧中心の主要ページで、フィルタ・サマリー・主要データが意味単位で明確に区切られる
- 既存の `PageScaffold` / `WorkflowPageHeader` / `WorkflowPageIntro` を軸に、差分を小さく保ったまま見通しを上げる

## Known facts / evidence

- `docs/ui-ux-design-guidelines.md` では、意味グループ分離、ヘッダーと本文の分離、`PageScaffold` / 共通 header 再利用が SSOT として定義されている
- 直近差分では `src/components/layout/page-scaffold.tsx` と `src/components/features/workflow/workflow-page-header.tsx` が導入・整備され、主要ページへ適用が進んでいる
- `src/app/(dashboard)/patients/patients-table.tsx` と `src/app/(dashboard)/reports/reports-table.tsx` は機能は厚いが、フィルタ・補助情報・一覧がまだ近接しており、情報の優先順位が弱い
- Playwright の `tools/tests/ui-page-layout.spec.ts` と `tools/tests/ui-detail-layout.spec.ts` が grouped layout と overflow を検証している

## Constraints

- 既存の未コミット変更を巻き戻さない
- 新規依存は追加しない
- Next.js App Router 前提で、Server/Client 境界を崩さない
- UI 変更前に参照すべき SSOT は `docs/ui-ux-design-guidelines.md`

## Unknowns / open questions

- どのページまで今回の改善対象に含めるか
- 既存 visual regression snapshot の一部は更新が必要になる可能性があるか

## Likely touchpoints

- `src/components/features/workflow/workflow-page-header.tsx`
- `src/components/features/workflow/workflow-page-intro.tsx`
- `src/app/(dashboard)/patients/page.tsx`
- `src/app/(dashboard)/reports/page.tsx`
- `src/app/(dashboard)/patients/patients-table.tsx`
- `src/app/(dashboard)/reports/reports-table.tsx`
- `src/components/features/workflow/workflow-page-intro.test.tsx`
- `tools/tests/ui-page-layout.spec.ts`
