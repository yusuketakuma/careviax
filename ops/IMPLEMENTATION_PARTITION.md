# IMPLEMENTATION_PARTITION — 分割と衝突制御（正本）

> **重要**: Ensemble lane への指示は team の `description` に直書きされる（`.claude/agents` や
> `role` 文字列は lane に効かない）。各 partition の owned/forbidden/verify を `/implement-ensemble`
> が description に展開する。

## Rule

すべての partition は次のいずれか:
- `frontend`
- `backend`
- `cross-boundary`

### frontend partition
- 担当: `claude-frontend-opus48`（Claude Opus 4.8、worktree 隔離、`bypassPermissions`）
- 編集可: UI components / pages・routes / frontend hooks・state / styles・tokens / frontend tests
- 明示列挙なしは禁止: schema / migrations / backend routes / server actions / API handlers / permission logic

### backend partition
- 担当: `codex-backend-gpt55`（Codex GPT-5.5、worktree 隔離、`-s workspace-write -a never`）
- 編集可: schema・model / migration / API route / server action / service layer / validation / permission / backend tests
- 明示列挙なしは禁止: UI components / layout / visual tokens / page redesign

### cross-boundary partition
- 担当順序: 1) `codex-backend-gpt55` → 2) `claude-frontend-opus48` → 3) reviewer
- 並列: **不可**（FE/BE が同じ型・schema・API client・route contract を触るため、contract 安定化が先）

## 共通制約（全 lane の description に展開）
- owned files のみ編集。owned 外が必要なら **STOP して報告**（勝手に広げない）。
- minimal diff。既存コンポーネント/パターン優先。投機的機能の新規作成なし。
- 既存挙動は P0_SCOPE が明示変更しない限り保持。
- 担当外境界（FE は backend、BE は frontend）に触れる必要が出たら STOP。
- 検証コマンドを実行し、結果を `ops/RUNLOG.md` に Change/Reason/Files/Why-minimal/Reused/Risk/Test 形式で記録。

## Partitions（インスタンス） — 第1波（owned 排他・並列安全）

### FE-A0 — 状態色トークン基盤  `type: frontend`  `lane: claude-frontend-opus48 (+claude-review-opus48)`
- **goal**: p0_46 の6軸を `--state-*`/`--tag-*` で中央定義 + `StateBadge`/`StatusDot` 新設（基盤のみ、画面適用は第2波）
- **owned**（編集可）:
  - `src/app/globals.css`（token 追加。※未コミット差分に**未含有**＝base 影響小）
  - 新規 `src/components/ui/state-badge.tsx`, `src/components/ui/status-dot.tsx`(+ `.test.tsx`)
  - 新規 `src/lib/constants/status-tokens.ts`（semantic role → token のマップ）
- **forbidden**: 既存画面ファイル / `status-labels.ts` 呼出し側 / backend / 他レーン owned
- **verify**: `pnpm db:generate && tsc --noEmit`（or `pnpm build`）, `pnpm lint`, `pnpm test -- state-badge`
- **status**: DRAFT（CHECKPOINT 承認待ち）

### X-B0 — ロール/モード配線  `type: cross-boundary（逐次: BE→FE）`  `lane: backend=codex-backend-gpt55 → frontend=claude-frontend-opus48 → reviewer`
- **goal**: membership role を session 露出（BE）→ store/provider 受け→ shell の薬剤師ハードコード置換（FE）
- **owned (BE 先, codex)**:
  - `src/lib/auth/config.ts`（session callback に membership role を載せる）
  - `src/lib/auth/context.ts`（必要なら session 用 role helper。`getMembership` 既存を再利用）
  - session 型拡張（`src/types/next-auth.d.ts` 等、存在を lane が確認）
- **owned (FE 後, claude)**:
  - `src/lib/stores/auth-store.ts`（`CurrentUser` に role 追加）
  - `src/components/providers/app-provider.tsx`（role を bridge）
  - `src/components/layout/app-header.tsx`, `src/components/layout/sidebar.tsx`（ハードコード置換、`member-roles.ts` ラベル使用、workMode 最小連動）
- **forbidden**: `permissions.ts`/RLS の認可ロジック変更（**表示のみ**） / globals.css / 画面 workspace / 他レーン owned
- **verify**: BE=`pnpm test -- auth`,`tsc`; FE=`tsc`,`pnpm lint`, ロール別表示の手動/テスト確認
- **前提**: `app-header.tsx`/`sidebar.tsx` が未コミット差分に含まれる → **base クリーン化必須**
- **status**: DRAFT

### FE-C0 — エラー/権限境界整備  `type: frontend`  `lane: claude-frontend-opus48 (+claude-review-opus48)`
- **goal**: error.tsx 未設置クラスタへ `error.tsx` 追加（新規ファイル中心）
- **owned**: 新規 `src/app/(dashboard)/{schedules,reports,billing,communications,handoff,medication-sets,admin,notifications,conferences,referrals,auditing,tasks,workflow,search,settings}/error.tsx`（既存6クラスタ除く）/ 必要なら新規 `src/components/errors/cluster-error.tsx`
- **forbidden**: 既存 page/workspace ロジック / globals.css / shell / 他レーン owned
- **verify**: `tsc --noEmit`, `pnpm lint`, error boundary の発火確認（throw テスト）
- **status**: DRAFT

## 衝突表（owned 排他の確認）
| | globals.css | ui/新component | auth/* | stores/provider | layout shell | 各cluster error.tsx |
|---|---|---|---|---|---|---|
| FE-A0 | ✏️ | ✏️ | | | | |
| X-B0 | | | ✏️ | ✏️ | ✏️ | |
| FE-C0 | | (errors/新) | | | | ✏️ |

→ 重複なし。第1波は3レーン並列安全（ただし X-B0 は base クリーン化が前提）。
