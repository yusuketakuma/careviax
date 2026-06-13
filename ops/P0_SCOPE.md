# P0_SCOPE — 第1波スコープ（人手承認待ち）

> [[P0_CANDIDATES]] から第1波を選定。承認後 [[CHECKPOINT]] を Yes にして F3 へ。
> 第1波 = **横断インフラ3件**（互いに owned 排他・並列安全）。

## 採用（第1波）
### FE-A0 — 状態色トークン基盤（P0-A の基盤のみ）
- **やること**: `design/images/P0/p0_46` の6軸を `globals.css` に `--state-*`/`--tag-*` として中央定義。semantic な `StateBadge` / `StatusDot` コンポーネント新設（`--state-*` 参照）。token と新 component の単体確認まで。
- **やらないこと**: 既存画面・`status-labels.ts` 呼出し側の置換（**第2波**）。生パレットの一括削除。新色の発明。

### X-B0 — ロール/モード配線（P0-B）
- **やること**: membership role を session に露出（backend）→ `auth-store`/`app-provider` で受け（frontend）→ `app-header`/`sidebar` の薬剤師ハードコードを実ロール表示に置換（`member-roles.ts` ラベル使用）。`workMode` をユーザー表示に最低限連動。
- **やらないこと**: workMode による nav 項目の出し分け全実装（最小表示連動のみ）。p0_25 clerk 専用ダッシュの新規構築（別 P0）。

### FE-C0 — エラー/権限境界整備（P0-C）
- **やること**: error.tsx 未設置の主要クラスタに `error.tsx` を追加（schedules/reports/billing/communications/handoff/medication-sets/admin/notifications/conferences/referrals/auditing/tasks/workflow/search/settings 等）。必要なら共通エラー表示 component を新設。文言は「止まっている理由」系に整合。
- **やらないこと**: 各画面の loading/empty の作り直し。forbidden の個別ロジック改変（root の既存を再利用）。

## 非採用（第2波以降）
P0-A 画面適用 / P0-D 右レール微修正 / P0-E schedule realtime / P0-F 文言統一。第1波の token・role 基盤が確定してから。

## 共通制約
- minimal diff・既存パターン再利用・投機的機能なし・既存挙動保持（本 scope が明示変更する箇所を除く）。
- 各レーンは owned files のみ編集。owned 外が必要なら STOP して報告。
- 3省2ガイドライン: ロール表示変更は認可ロジック（`permissions.ts`/RLS）を**変えない**こと（表示のみ）。

## 前提（F3 開始の blocker）
- **base state クリーン化**: 未コミット 48 ファイル（特に `app-header.tsx`/`sidebar.tsx` は X-B0 が触る）を commit/stash。
- lane worktree に node_modules（main から symlink か `pnpm install`）— 検証コマンド実行のため。
