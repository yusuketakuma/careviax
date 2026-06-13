# TEST_PLAN — 第1波

> 各レーンは owned 範囲の検証を実行し `ops/RUNLOG.md` に記録。統合は [[verify]]（/verify）。

## 共通ゲート（全レーン）
- `pnpm db:generate`（Prisma client） → `tsc --noEmit`（or `pnpm build`）: 型 clean
- `pnpm lint`: ESLint flat config 通過
- 既存テスト非破壊: 触った領域の `pnpm test` が green

## FE-A0（状態色トークン基盤）
- `StateBadge`/`StatusDot` の単体テスト（`src/components/ui/state-badge.test.tsx`）: 各 semantic role が対応 token クラス/aria を出す、色だけに依存しない（アイコン/テキスト併用）こと。
- token: `globals.css` の `--state-*`/`--tag-*` が light/dark 双方で定義され、WCAG AA コントラスト（前景比 4.5:1）を満たす値であること（DESIGN_LANGUAGE と突合）。
- 回帰: 既存 `badge.test.tsx`/`action-rail.test.tsx` が green。

## X-B0（ロール/モード配線）
- BE: `src/lib/auth/__tests__` に session/jwt callback が membership role を載せるテスト追加（複数org時は現org role、未membership時 null）。`pnpm test -- auth`。
- 認可不変の保証: `permissions.ts`/RLS 系テストが**変更なしで green**（表示変更が認可へ波及していないこと）。
- FE: shell がストアの role を表示し、ハードコード「薬剤師」が消える（`sidebar.test.tsx`/`app-header` 周辺のテスト更新）。clerk_support ロールで誤表示しない。

## FE-C0（エラー境界）
- 各追加 `error.tsx` が Error を捕捉し「止まっている理由」系の文言 + 再試行導線を出す（throw する子で発火確認）。
- `not-found`/`forbidden` の root 既存を壊さない。

## 注意
- lane worktree は node_modules 必須（main から symlink か `pnpm install`）。E2E はローカル DB 前提（[[careviax-e2e-local-db]]）のため第1波は unit/型/lint を主、E2E は /verify 統合時に該当範囲のみ。
