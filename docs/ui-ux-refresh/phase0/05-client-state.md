# Phase0 Recon: クライアント状態管理・データ取得の実態

調査日: 2026-07-11 / 調査者: Phase0 recon agent

## 0. バージョン（lockfile 実値）

`pnpm-lock.yaml` の解決済みバージョン（`node_modules/*/package.json` でも確認済み）:

| パッケージ | package.json specifier | 実バージョン |
|---|---|---|
| @tanstack/react-query | ^5.101.0 | 5.101.0 |
| @tanstack/react-table | ^8.21.3 | 8.21.3 |
| react-hook-form | ^7.78.0 | 7.78.0 |
| @hookform/resolvers | ^5.4.0 | 5.4.0 |
| zustand | ^5.0.14 | 5.0.14 |
| zod | ^4.4.3 | 4.4.3 |
| sonner (toast) | ^2.0.7 (package.json:160) | 未確認（lockfile未走査） |

## 1. TanStack Query

### 1.1 QueryClient 設定

単一の生成箇所: `src/components/providers/query-provider.tsx:9-21`

- `staleTime: 60_000`（1分, :6,13）
- `gcTime: 5 * 60_000`（5分, :7,14）
- `retry: 1`（:15）
- `refetchOnWindowFocus: false` / `refetchOnReconnect: false`（:16-17）
- 代替として `window 'online'` イベントで `refetchQueries({ type: 'active', stale: true })` を手動発火（:26-32）。オフライン→復帰の再取得はここで一元化。

Provider は `src/components/providers/app-provider.tsx:70-74` で `SessionProvider > SessionStateBridge > OfflineSyncBridge > QueryProvider` の順にマウント。

規模感: `useQuery(` を含む非テストファイル 97、`useMutation` 86、`queryKey:` 出現 625 箇所。

### 1.2 Query key 規約

- **中央レジストリなし**。`query-keys.ts` 的なファイルは存在しない（find で0件）。
- 事実上の規約は「`['feature-name', orgId, ...params]` のインライン配列」。例:
  - `['tasks', orgId, queryParams]`（`src/app/(dashboard)/tasks/tasks-content.tsx:303`）
  - `['comments', orgId, entityType, entityId]`（`src/components/features/comments/comment-thread.tsx:55`）
  - `['patient-overview', patientId, orgId]`（`src/app/(dashboard)/patients/[id]/collaboration/collaboration-content.tsx:70`）
- 一部の feature はローカルの key ビルダー関数を持つ:
  - `workbenchQueryKey(orgId, patientId)` / `calendarQueryKey(orgId, planId)`（`src/components/features/dispense-workbench/use-workbench-mutations.ts:66,71`）
  - `getDocumentTemplateDetailQueryKey`（`src/app/(dashboard)/admin/document-templates/template-content.tsx:191`）
  - `buildScheduleDayVehicleResourcesQueryKey` 等（`src/app/(dashboard)/schedules/schedule-day-planner.ts:126,136`）
  - `PLATFORM_TENANTS_QUERY_KEY` 定数 export（`src/app/platform/tenant-directory-content.tsx:26`）
- orgId の位置（2番目 or 3番目）は feature によって揺れる（上記 tasks vs patient-overview）。

### 1.3 Hydration / prefetch

**不在**。`HydrationBoundary` / `dehydrate` / `prefetchQuery` は src 全体で 0 件（grep 確認）。データ取得はクライアントマウント後の useQuery のみで、Server Components からは initialOrgId/initialSiteId 等の ID 注入に留まる（`app-provider.tsx:60-66`）。

### 1.4 Invalidation パターン

- `invalidateQueries` 非テスト 338 箇所。mutation の `onSuccess`/`onSettled` で feature prefix + orgId を invalidate するのが標準形。例: `tasks-content.tsx:405-407`（tasks / tasks-health-board / staff-workload を連鎖 invalidate）、`use-workbench-mutations.ts:205` 以降の各 mutation の `onSettled`。

### 1.5 Optimistic update

- **真の optimistic update（onMutate→cancelQueries→snapshot→setQueryData→rollback）は未実装**。`cancelQueries`/`getQueryData` を使う rollback 実装は 0 件。
- `onMutate` の実使用（6ファイル）はすべて「ローカルのエラー表示 state をリセットする」用途のみ（例: `comment-thread.tsx:85,109`、`offline-sync-content.tsx:182,202`）。
- `setQueryData` は **onSuccess でサーバ応答をキャッシュに書き戻す**用途（`settings-content.tsx:261`、`saved-views-content.tsx:127`、`notifications-content.tsx:142`、`use-presence-users.ts:37` 等）。
- 調剤ワークベンチには optimistic パターンが**計画コメントとして明記**されているが未実装（`use-workbench-mutations.ts:13-14,163`「§12 の onMutate→cancel→snapshot→optimistic→return / onError→rollback+toast / onSettled→invalidate を実装する」）。

### 1.6 その他の Query 機能

- `useInfiniteQuery`: 3 箇所（`admin/drug-masters/drug-master-content.tsx:524`、`prescriptions/prescriptions-workspace.tsx:176`、`billing/candidates/billing-candidates-content.tsx:401`）。
- `placeholderData` / `keepPreviousData` / `useSuspenseQuery`: 0 件。

## 2. Zustand store 全列挙

UI 系 store は `src/lib/stores/` + ワークベンチの計 5 つ（`src/phos/backend/dynamo-*-store.ts` や `src/server/services/presence-store.ts` はサーバ側で Zustand ではない）。

| store | ファイル | 保持する状態 | persist | クリア |
|---|---|---|---|---|
| useAuthStore | `src/lib/stores/auth-store.ts:22` | orgId / siteId / currentUser(id,email,name,cognitoSub,role) | なし | `resetAuth`(:41) は**テストからのみ呼ばれる**（実コードの呼出 0 件）。値は session 変化時に `app-provider.tsx:24-39,61-66` が setState で上書き。ログアウトは next-auth `signOut`（`sidebar.tsx:96`）でページ遷移 → メモリ store は破棄される設計 |
| useUIStore | `src/lib/stores/ui-store.ts:36` | sidebar 開閉/pin、workspaceRail、theme、notificationDrawer、shortcutHelp、workMode(pharmacist/clerk_support/management)、careMode(home_visit/outpatient) | あり: localStorage `'ph-os-ui'`、partialize で theme/workMode/careMode のみ永続（:83-91） | ログアウト時のクリアなし（テーマ等の低感度データのみ永続） |
| useOfflineStore | `src/lib/stores/offline-store.ts:27` | isOffline、pendingSyncCount、pendingQueue、syncConflicts、lastSyncedAt 等（実体データは Dexie 側 `src/lib/stores/offline-db.ts`、同期は `sync-engine.ts`） | なし（メモリのみ） | オフライン実データの鍵は session identity 変化で `initOfflineEncryptionKey`/`clearOfflineEncryptionKey`（`app-provider.tsx:41-55`、`session-timeout-modal.tsx:72,192`、`src/lib/offline/crypto.ts:142`）。fail-close: identity 不在で鍵クリア |
| useCommandPaletteStore | `src/lib/stores/command-palette-store.ts:26` | open / focusNonce / restoreEl（フォーカス復帰先） | なし | 揮発のみ |
| ワークベンチ store | `src/components/features/dispense-workbench/dispensing-workbench.store.ts`（687行） | 調剤4工程の作業状態（selId、done、audit、チェック群、holdInfo 等） | あり: localStorage `'chouzai-workbench'`（:618）。ただし partialize で **REAL_DATA_ENABLED 時は臨床 state を一切永続しない**（:622-624 コメント「実データ時は clinical state を plaintext localStorage に残さない」）。実データ有効時は起動時に legacy キーを removeItem（:49-58） | 患者切替は selId 切替で管理（モックモードのみ永続）。ログアウト時の明示クリアは未確認 |

**患者切替時の query cache クリアは行っていない**（patientId が queryKey に含まれるため自然に分離される方式）。ログアウト時に `queryClient.clear()` を呼ぶコードは 0 件（grep 確認）— signOut のフルページ遷移でメモリごと破棄する前提。

## 3. React Hook Form + Zod

- `useForm` 使用: 非テスト 23 ファイル。`zodResolver`（@hookform/resolvers/zod）が標準（例: `admin/vehicles/vehicles-content.tsx:4,305`）。
- **shadcn/ui の `Form`/`FormField` コンポーネントは不使用**（`src/components/ui/form.tsx` 不在、`FormField` 使用 0 件）。生の `useForm` + `Controller` + `useWatch` で配線（`vehicles-content.tsx:8`）。
- 共通パターン: `handleSubmit((values) => saveMutation.mutate(values), focusErrorSummary)` — バリデーション失敗時に**エラーサマリへフォーカス移動**する `focusErrorSummary` パターンが admin 系フォームに横展開（`vehicles-content.tsx:322,623`、institutions / business-holidays / service-areas / packaging-methods / pharmacist-credentials / referral-form / visit-record-form 等 8+ ファイル）。
- **server error の field への割当は限定的**: `form.setError('field', ...)` の手動マッピングは `visits/[id]/record/visit-record-form.tsx:1336,1732,1752` のみ。他は mutation の onError で sonner toast + ローカル error state 表示が標準（field 単位のサーバエラー割当の共通機構は**不在**）。auth 系ページ（`(auth)/password/*`）は RHF を使わず useState の `setError` で画面上部にエラー文言表示。

## 4. TanStack Table

- `useReactTable` の直接使用は **`src/components/ui/data-table.tsx` の 1 ファイルのみ**（1005 行の独自 DataTable ラッパー）。app 側 43 ファイルが `DataTable` を利用。
- 内蔵機能（data-table.tsx:2-19 の import と実装）: sorting / column filter / pagination / row selection / expanded rows / column visibility（すべて client-side row model）、sticky header（:533 `sticky top-0 z-10 bg-muted/80`）、Skeleton ローディング、CSV export（`quotedCsvRow` + `server-export-registry` による承認済みサーバ export 記述子検証, :55-60）、印刷。
- エラー props: `errorMessage?: string`（:118）と `onRetry?: () => void`（:120）。errorMessage があると空状態文言・toolbar 無効化理由・retry ボタンまで一貫して切替（:431-493, 756-771）。

## 5. URL state（searchParams）

- 全体に**薄い**。`searchParams.get()` の非テスト内訳: `patient_id`×3, `case_id`×2, `type`/`qr_draft_id`/`planId`/`notice`/`error`/`delivery_id`/`dateTo`/`dateFrom`/`callbackUrl`/`action` 各1 — 主に**deep-link 受け取り用**。
- `tab` / `page` / `cursor` を searchParams で管理する箇所は **0 件**。タブ・ページングはコンポーネントローカル state（DataTable 内部 PaginationState）で完結。
- フィルタの URL 同期の実例は `/search` のみ: `search-content.tsx:286-293` で `URLSearchParams` を組み立て `router.replace('/search?'+params, { scroll: false })`、`q`（:288）と `category`（:292）を保持。conferences は URLSearchParams を API クエリ組み立てに使うのみ（`conferences-content.tsx:254,640`）。

## 6. 共通 fetch ラッパー・エラーハンドリング規約

- **fetch 自体のラッパーは不在**。queryFn/mutationFn は生 `fetch()` を書き、共通化は2ヘルパーに分離:
  1. **リクエストヘッダ**: `buildOrgHeaders(orgId, extra)` / `buildOrgJsonHeaders`（`src/lib/api/org-headers.ts:28-46`）。`x-org-id` を必ず1つ含め、extra での上書きは大文字小文字無視で **RangeError throw（fail-closed）**。
  2. **レスポンス解釈**: `readApiJson(response, { fallbackMessage, schema })` / `readApiAcknowledgement`（`src/lib/api/client-json.ts:66-96`）。非 ok → API エラー envelope（`error.message` / `message` / `error`）から文言抽出して throw、JSON 不正 → fallback で throw、任意の zod schema（safeParse duck-type）で応答検証、schema 不一致も throw。既定 fallback は「処理に失敗しました」（:42）。
- `src/lib/api/` にはほかに `cursor-pagination-client.ts`（`fetchAllCursorPages`, limit 100）、`list-envelope.ts`、`response-schemas.ts` 等のクライアント/サーバ共通契約ヘルパー群。
- **FE false-empty fail-close 規約**（fetch 失敗を空表示に潰さない）は実装済みの横断規約:
  - `useQuery` の `isError` を明示処理（非テスト 439 箇所）。
  - 一覧系は `DataTable` の `errorMessage`/`onRetry` に `isError ? ... : undefined` + `refetch` を渡す（例: `tasks-content.tsx:302` の `{ data, isLoading, isError, refetch }` 分割代入）。
  - 単票系は `ErrorState`（`src/components/ui/error-state.tsx`）: `variant`（既定 `'server'`, :94）、`onRetry` + `retryVariant`（:37-38）、`cause`/`nextAction` による文言優先順（:120）、live region による a11y 通知（:134）。非テスト 84 ファイルで使用。
  - mutation 失敗は `clientLog.warn(イベント名, err, meta)`（`src/lib/utils/client-log.ts`）+ sonner `toast.error`（`comment-thread.tsx:94-98` が典型形）。

## 7. 「想定スタック」との差分（本調査範囲）

- SSR hydration/prefetch（HydrationBoundary 等）: **不在**（§1.3）。純クライアントフェッチ。
- optimistic update: **不在**（計画コメントのみ, §1.5）。
- query key 中央レジストリ: **不在**、インライン配列＋ローカルビルダー混在（§1.2）。
- shadcn Form パターン: **不在**、生 RHF + Controller（§3）。
- URL でのフィルタ/タブ/ページング管理: /search の q・category を除き**ほぼ不在**（§5）。
- fetch ラッパー: 単一ラッパーではなく「org-headers + readApiJson」の2分割方式（§6）。

## 未確認事項

- sonner の lockfile 解決バージョン（package.json specifier ^2.0.7 のみ確認）。
- ワークベンチ store のログアウト時クリアの有無（明示クリアは grep で見つからず。localStorage 永続はモックモードのみなので実データでは影響なしの設計コメントあり）。
- `useQuery` 97 ファイル全数の isError 処理率（規約としての存在と多数の実装例は確認済みだが、全数監査は未実施）。
