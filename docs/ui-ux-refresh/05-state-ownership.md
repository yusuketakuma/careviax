# Phase 4: State Ownership Map

調査日: 2026-07-11 / 作成: Phase 4 agent（読み取り専用）

起点: `docs/ui-ux-refresh/phase0/05-client-state.md`、`docs/ui-ux-refresh/phase0/07-offline-and-pwa.md`。
本書の主張は全て実コードで再確認済み（各所に file path 根拠を付す）。確認できなかった点は「未確認」と明記。

---

## 1. 状態分類の現状（役割分担と設定実値）

| 分類 | 役割 | 設定実値・根拠 |
| --- | --- | --- |
| Server-rendered | ID 注入のみ。データの SSR/hydration はしない | Server Components からは `session` / `initialOrgId` / `initialSiteId` を `AppProvider` に渡すだけ（`src/app/(dashboard)/layout.tsx:28-34`、`src/components/providers/app-provider.tsx:60-66`）。`HydrationBoundary`/`dehydrate`/`prefetchQuery` は src 全体 0 件（phase0 §1.3、grep 再確認） |
| TanStack Query | サーバーデータの実質的な唯一のクライアント所有者（例外: ワークベンチ、§3.1） | 単一 QueryClient: `staleTime: 60_000` / `gcTime: 300_000` / `retry: 1` / `refetchOnWindowFocus: false` / `refetchOnReconnect: false`（`src/components/providers/query-provider.tsx:6-20`）。代替として `window 'online'` で `refetchQueries({ type:'active', stale:true })` を手動発火（同 :26-32）。key 規約は `['feature', orgId, ...]` インライン（中央レジストリなし、phase0 §1.2）。realtime 層あり: SSE（`src/app/api/notifications/stream/route.ts`）＋ `useRealtimeQuery`/`useRealtimeInvalidation`（`src/lib/hooks/use-realtime-query.ts`、`use-realtime-invalidation.ts`）で invalidate + fallback polling |
| URL (searchParams) | deep-link の**受け取り専用**がほぼ全て | 書き戻し（state→URL）は `/search` のみ（`src/app/(dashboard)/search/search-content.tsx:286-293` の `router.replace`）。`tab`/`page`/`cursor` の URL 管理 0 件（phase0 §5、§3.2 で具体化） |
| React Hook Form | フォーム値の唯一の所有者（Zustand との重複なし、§3.3） | `useForm` 非テスト 23 ファイル + zodResolver。`focusErrorSummary` パターン横展開（phase0 §3）。オフライン対象フォームのみ RHF→Dexie ドラフト自動保存を併設（`src/lib/hooks/use-soap-draft.ts`、`use-prescription-draft.ts`） |
| Zustand | UI chrome・認証コンテキストミラー・オフライン状態ミラー + **例外的にワークベンチのサーバーデータ** | 5 store: `auth-store`（orgId/siteId/currentUser、persist なし）、`ui-store`（localStorage `'ph-os-ui'`、partialize=theme/workMode/careMode のみ）、`offline-store`（Dexie 状態のメモリミラー）、`command-palette-store`（揮発）、ワークベンチ store（`src/components/features/dispense-workbench/dispensing-workbench.store.ts:214`、localStorage `'chouzai-workbench'`、実データ時は臨床 state 非永続） |
| Offline (Dexie) | オフライン PHI の唯一の永続先（SW は API/HTML を一切キャッシュしない設計） | メイン DB `PH-OSOffline` 7 テーブル（`src/lib/stores/offline-db.ts`）+ phos 独立 2 DB。payload は per-user AES-GCM 鍵（`src/lib/offline/crypto.ts:105-135`、extractable:false、IndexedDB `ph-os-offline-keys`）で暗号化、鍵なしは throw（fail-closed）。同期は `sync-engine.ts`（409→conflict UI、expected_version 楽観ロック） |

---

## 2. State Ownership Map

30 行。列幅の都合で 2a（所有・永続・共有）と 2b（整合・運用）に分割。行番号で対応。

凡例: ✅=あり / —=なし / △=部分的。Intended owner の太字は現状からの変更提案（§3 の検出に対応）。

### 2a. 所有・永続・URL 共有・同期

| # | State | Domain | Current owner | Intended owner | Persistence | URL 共有 | Server sync | Offline 可用性 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 認証セッション | 認証 | next-auth `SessionProvider`（`app-provider.tsx:69`） | 同左 | cookie | — | ✅ | 失効まで △ |
| 2 | orgId / siteId | 認証/テナント | server layout → `useAuthStore`（`app-provider.tsx:61-66`） | 同左 | なし（メモリ） | — | 片方向（server→client） | △ |
| 3 | theme / workMode / careMode | UI 設定 | `useUIStore` persist（`ui-store.ts:83-91`） | 同左（将来はサーバー preferences 候補） | localStorage `'ph-os-ui'` | — | — | ✅ |
| 4 | sidebar/drawer/rail 開閉 | UI chrome | `useUIStore` 非永続部 | 同左 | なし | — | — | ✅ |
| 5 | コマンドパレット open/フォーカス復帰先 | UI chrome | `useCommandPaletteStore`（`command-palette-store.ts:26`） | 同左 | なし | — | — | ✅ |
| 6 | オフライン同期ステータス（pendingCount/conflicts/lastSyncedAt） | オフライン | `useOfflineStore`（Dexie のメモリミラー、`offline-sync-bridge.tsx` が hydrate） | 同左 | 実体は Dexie | — | 復帰時 drain | ✅ |
| 7 | 一覧サーバーデータ標準形（患者一覧・タスク等） | 業務データ | TanStack Query（key に orgId） | 同左 | メモリ（gc 5分） | — | ✅ fetch/invalidate | —（SW は API 非キャッシュ） |
| 8 | 患者詳細/概要（patient-overview 等） | 患者 | TanStack Query（key に patientId+orgId、`collaboration-content.tsx:70`） | 同左 | メモリ | patient_id deep-link 受信のみ | ✅ | — |
| 9 | コメントスレッド | 連携 | `useRealtimeQuery`（`comment-thread.tsx:55`） | 同左 | メモリ | — | ✅ + SSE invalidate | — |
| 10 | 通知一覧・未読 | 通知 | Query + SSE（`notifications-content.tsx`、`notification-bell.tsx`） | 同左 | メモリ | — | ✅ + SSE | — |
| 11 | ハンドオフ workspace | 連携 | `useRealtimeQuery`（`handoff-workspace.tsx`） | 同左 | メモリ | — | ✅ + SSE | — |
| 12 | スケジュール/カレンダー | 訪問計画 | `useRealtimeQuery`（`schedules/calendar-view.tsx`） | 同左 | メモリ | 保存ビュー適用時のみ URL 受信（#22） | ✅ + SSE | ブリーフのみ #28 |
| 13 | ダッシュボード cockpit | 集約 | `useRealtimeQuery`（`dashboard-cockpit.tsx`） | 同左 | メモリ | — | ✅ + SSE | — |
| 14 | presence（閲覧中ユーザー） | 連携 | `use-presence-users.ts`（setQueryData 書き戻し） | 同左 | メモリ | — | ✅ | — |
| 15 | nav バッジ件数 | 通知 | polling query（`use-nav-badges.ts` refetchInterval） | 同左 | メモリ | — | ✅ polling | — |
| 16 | 無限リスト cursor（drug-masters/prescriptions/billing-candidates） | 一覧 | `useInfiniteQuery` 内部（`drug-master-content.tsx:524` 等） | 同左（cursor の URL 化は不要と判断） | メモリ | — | ✅ | — |
| 17 | DataTable の page/sort/列 filter/行選択 | 一覧 UI | TanStack Table 内部 state（`data-table.tsx`、43 画面） | **主要一覧は URL（page/sort）** | なし | — ✗ | —（client-side model） | ✅ |
| 18 | 画面フィルタ（tasks の status/type/priority 等） | 一覧 UI | `useState`（`tasks-content.tsx:257-260`、URL は初期値受信のみ） | **URL（双方向）** | なし | 受信のみ（片方向） | queryKey 経由で fetch 条件 | ✅ |
| 19 | タブ選択（患者詳細/settings/data-explorer/conferences/proposals） | 画面 UI | `useState`（`card-workspace.tsx:4781` 等 5 画面、§3.2） | **URL（?tab=）** | なし | proposals のみ受信（`schedule-proposals-content.tsx:737`） | — | ✅ |
| 20 | /search の q・category | 検索 | URL（`search-content.tsx:286-293`、唯一の書き戻し実装） | 同左（他画面の模範） | URL | ✅ | fetch 条件 | ✅（条件のみ） |
| 21 | deep-link パラメータ（patient_id/case_id/planId/notice 等） | 導線 | URL 受信のみ（phase0 §5） | 同左 | URL | ✅ 受信 | — | ✅ |
| 22 | 保存ビュー（schedules 絞り込み） | 一覧 UI | サーバー（`views/saved-views-content.tsx:38`、適用時に URL へ展開 `saved-filter-views.ts:109`） | 同左 | DB | 適用時 ✅ | ✅ CRUD | — |
| 23 | admin 系フォーム値（23 ファイル） | 入力 | RHF（zodResolver、phase0 §3） | 同左 | なし | — | submit 時 mutation | — |
| 24 | 訪問記録ウィザード（SOAP/残薬/step） | 患者 PHI | RHF + Dexie `visitDrafts`→`syncQueue`（`use-soap-draft.ts:292-307`） | 同左 | Dexie（暗号化） | — | 復帰時 drain + 409 conflict | ✅ |
| 25 | 処方受付フォーム | 患者 PHI | RHF + Dexie `prescriptionDrafts`（`use-prescription-draft.ts`） | 同左 | Dexie（暗号化、端末内のみ） | — | submit のみ | ✅ |
| 26 | 証跡写真ドラフト | 患者 PHI | Dexie `evidenceDrafts`（`capture-content.tsx`） | 同左 | Dexie（暗号化） | — | 復帰時自動送信 | ✅ |
| 27 | 音声メモ | 患者 PHI | Dexie `voiceMemoDrafts` | 同左 | Dexie（暗号化） | — | **送信なし**（STT 未接続、offline-db.ts:105-108） | ✅ |
| 28 | 訪問ブリーフキャッシュ | 患者 PHI | Dexie `visitBriefCache`（TTL 24h、`cache-policy.ts:1-2`） | 同左 | Dexie（暗号化） | — | 読み取り専用先読み | ✅ |
| 29 | 調剤ワークベンチ（作業チェック + **サーバー model/writeContext**） | 調剤 | Zustand `useWorkbenchStore`（`dispensing-workbench.store.ts:100-101,214`。実データは直 fetch→`hydrate`、`dispensing-workbench.tsx:352-460`） | 作業 state=同左 / **server model=TanStack Query**（§3.1） | localStorage（mock のみ。実データ時は臨床 state 非永続 :622-624） | — | 直 fetch + mutation（OCC=cycle.version） | ✗（実データはオンライン前提） |
| 30 | オフライン暗号鍵 | セキュリティ | IndexedDB `ph-os-offline-keys`（per-user、`crypto.ts:105-135`） | 同左（logout 経路の統一が必要、§3.7） | IndexedDB | — | — | ✅ |

### 2b. 鮮度・競合・更新・監査・テスト

| # | Freshness 要求 | Conflict 可能性 | Update 方法 | Invalidation | Recovery/rollback | Audit 要求 | UI 表現 | Test coverage |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | セッション失効検知必須 | — | Cognito+next-auth | — | timeout modal 再認証（`session-timeout-modal.tsx`） | ログイン監査（サーバー側） | timeout modal | `session-timeout-modal.test.tsx` |
| 2 | ページロード時点 | — | layout 再レンダ→setState | — | — | — | サイト切替 UI | `app-provider.test.tsx`。`auth-store.ts` 単体テストなし |
| 3 | 低 | 端末間で不一致可（許容） | store action | — | — | 不要 | テーマ/モード切替 | `ui-store.ts` 単体テストなし（未確認: 間接カバー） |
| 4-5 | 低 | — | store action | — | — | 不要 | 開閉 | #5 は `command-palette-store.test.ts` |
| 6 | 高（未同期件数は誤導線防止） | — | bridge が hydrate | online イベント | — | 不要 | ヘッダー `同期済み HH:MM` / 件数（`app-header.tsx:67-114`） | `offline-store.test.ts`、`offline-sync-bridge.test.tsx` |
| 7 | 中（60s stale 許容） | 低 | mutation→invalidate | `invalidateQueries` 338 箇所（phase0 §1.4） | ErrorState/DataTable errorMessage+retry | 読取: PHI read audit（サーバー） | 一覧 + skeleton + エラー行 | 各 content.test 多数 |
| 8 | 中〜高 | 中（PATCH に OCC なし、§3.6） | mutation→invalidate | feature prefix invalidate | retry | 患者情報変更は field revision（`patient-field-revision.ts`） | 詳細タブ | `card-workspace` 系 test |
| 9-13 | 高（多職種同時作業） | 中 | mutation→invalidate + SSE | SSE invalidate + fallback polling | retry | コメント/handoff はサーバー監査 | live 更新 | 各 test あり |
| 14 | 高 | — | setQueryData | SSE | — | 不要 | アバター表示 | `use-presence-users` は phase0 記載（test 未確認） |
| 15 | 中 | — | polling | interval | — | 不要 | バッジ | `sidebar.test.tsx` 等 |
| 16 | 中 | 低 | fetchNextPage | prefix invalidate | retry | — | もっと見る | 各 content.test |
| 17 | —（クライアント内） | — | Table state | — | — | — | ページャ/ソートアイコン | `data-table` test |
| 18 | — | — | setState | queryKey 変化で自動 refetch | — | — | フィルタ UI | `tasks-content.test.tsx`、`tasks-query-state.test.ts` |
| 19 | — | — | setState | — | — | — | Tabs | 各 content.test |
| 20 | — | — | router.replace | queryKey | — | 検索はサーバー側 audit（未確認） | URL 同期 | `search-content.test.tsx` |
| 21 | — | — | 遷移時のみ | — | — | — | 初期状態注入 | 各 page.test |
| 22 | 低 | 低（last-wins、個人設定） | mutation + setQueryData（`saved-views-content.tsx:127`） | invalidate | — | 不要 | ビュー一覧/適用リンク | 同 dir test（未確認: ファイル名） |
| 23 | — | — | RHF setValue/submit | — | isDirty + 離脱防止（`navigation-confirm-provider`） | 変更はサーバー監査 | エラーサマリフォーカス | 各 form test |
| 24 | 高（同一訪問の二重編集） | **高** → 409 + conflict UI（`sync-engine.ts:371-387,632-700`） | 自動保存（debounce）+ 明示送信 | 同期成功で queue 削除 | ConflictDiffDialog で「最新を使う/上書き」、expected_version 再検証 | visit record はサーバー監査 + version | 「一時保存」バー、未同期バッジ | `use-soap-draft.test.tsx`、`sync-engine.test.ts` |
| 25 | 中 | 低（端末内のみ） | 自動保存 | submit 成功で削除 | 鍵なしは保存中止 + 明示文言（`prescription-intake-form.tsx:578`） | submit 時サーバー監査 | ドラフト復元通知 | `use-prescription-draft.test.tsx` |
| 26 | 中 | 低（追記型） | 撮影→enqueue | 送信成功で削除、`uploadedFileAssetId` で再開 | retryCount + 再試行 | file upload audit（サーバー） | 未同期カウント | `evidence-drafts.test.ts` ×2 |
| 27 | 低 | — | 録音→保存 | —（送信なし） | — | **サーバー送信なし＝サーバー監査対象外**（端末内のみ） | 転写待ち表示 | `voice-memo-drafts.test.ts` ×2 |
| 28 | 24h TTL | —（読取専用） | 先読み時上書き | TTL prune（`root-provider.tsx:10-15`） | — | 不要 | オフラインパネル | `cache-policy.test.ts` |
| 29 | 高（調剤は法的行為） | 中 → OCC（`dispense-results/route.ts:542`、`dispense-audits/route.ts:658`）+ conflict toast → 直接再取得（`use-workbench-mutations.ts:180` `recoverWorkbenchDirect`） | store action + mutation | `workbenchQueryKey` invalidate（**購読 query 0 件で実質 no-op**、§3.1） | 409 時 model 再 hydrate、`setState({model: previousModel})` rollback（`use-workbench-write-handlers.ts:1162`） | 調剤・監査はサーバー監査 + version | 4 工程 UI | feature 内 test 多数（`.logic/.confirm/.from-api` 等）。store 単体 test なし |
| 30 | — | — | login 時生成/再利用 | logout 時 `clear()` | — | 鍵運用自体が Compliance 要件 | なし（不可視） | `crypto.test.ts` |

---

## 3. 重点検出（実コード検証）

### 3.1 Query data の Zustand 複製

**判定: 汎用 store は問題なし。ワークベンチのみ「Query の外にサーバー状態」+ 死んだ invalidation key。**

- `src/lib/stores/` の 5 store はいずれも Query データを複製していない（`auth-store`=セッションミラー、`offline-store`=Dexie ミラー、他は UI 揮発。grep で store 内 `useQuery`/`useMutation` 0 件）。
- 例外はワークベンチ: 実データ結線は useQuery を使わず、useEffect 内の直 fetch（`loadWorkbenchPatientRowsAsync`/`loadWorkbenchAsync`）→ `hydrate()` で Zustand にサーバー model を格納する（`src/components/features/dispense-workbench/dispensing-workbench.tsx:352-460`、store 定義 `dispensing-workbench.store.ts:100-101,267-336`）。
- その一方で `workbenchQueryKey`/`calendarQueryKey` が定義され、mutation の `onSettled` で `invalidateQueries` される（`use-workbench-mutations.ts:66-73,176,186`）が、**この key を購読する useQuery は repo 内に 1 件も存在しない**（grep: 両 key の参照は同ファイルのみ）。invalidation は将来の SSE 整合用の空振りで、実際の回復は `recoverWorkbenchDirect`（:180-182）と `retryNonce`/`selId` 依存の effect 再実行が担う。
- 帰結: staleness 管理・エラー再試行・キャッシュ寿命が Query の規約から外れた「第 2 のサーバー状態機構」になっており、Query 標準（isError→ErrorState、invalidate→refetch）とレビュー観点が二重化する。厳密には「複製」ではなく「分離」だが、Phase 5 での統一対象。

### 3.2 URL に出すべき filter/pagination のローカル閉じ込め（phase0「tab/page/cursor URL 管理 0 件」の具体化）

**判定: 問題あり（横断）。書き戻し実装は /search の 1 画面のみ。**

対象画面の列挙（リロード・URL 共有・ブラウザバックで状態が失われる箇所）:

| 種別 | 画面 | 根拠 |
| --- | --- | --- |
| タブ | 患者詳細タブ（overview/collaboration 等） | `src/app/(dashboard)/patients/[id]/card-workspace.tsx:4781` `useState<PatientDetailTab>` |
| タブ | スケジュール提案ダッシュボード | `schedules/proposals/schedule-proposals-content.tsx:737`（`initialStatus` を URL から受けるが書き戻しなし :1155） |
| タブ | admin 設定 / データエクスプローラ / カンファレンス | `admin/settings/settings-content.tsx`、`admin/data-explorer/data-explorer-content.tsx`、`conferences/conferences-content.tsx`（Tabs+onValueChange、URL 連携なし） |
| フィルタ | タスク一覧（status/type/priority/assignedToMe） | `tasks/tasks-content.tsx:257-260` useState。initial* の URL 受信のみで `router.replace`/`useSearchParams` の書き戻し 0 件（grep） |
| ページング/ソート | DataTable 採用の全 43 画面 | `src/components/ui/data-table.tsx` 内部 PaginationState（phase0 §4）。page/sort を URL に出す画面 0 件 |
| cursor | drug-masters / prescriptions-workspace / billing-candidates / ワークベンチ患者キュー | `useInfiniteQuery`（`drug-master-content.tsx:524` 等）+ `dispensing-workbench.tsx:270-290` の queuePage cursor。※cursor 自体の URL 化は通常不要、リロード時の位置喪失として記録 |
| 唯一の双方向実装 | /search の q・category | `search/search-content.tsx:286-293`（`router.replace(..., { scroll: false })`）— 他画面へ展開すべき模範実装 |
| 代替機構 | schedules の保存ビュー | フィルタを URL でなくサーバー保存（`views/saved-views-content.tsx:38`）し、適用時に URL 化（`src/lib/views/saved-filter-views.ts:109`）。受信側はあるが画面操作の書き戻しはない |

### 3.3 RHF と Zustand のフォーム値重複

**判定: 問題なし。** `useForm(` を含む非テストファイルと Zustand store（useAuthStore/useUIStore/useOfflineStore/workbench store）使用の交差は 0 件（grep 検証）。ワークベンチの入力的操作は RHF 不使用で Zustand 単独所有。訪問記録/処方受付は RHF↔Dexie の二重化だが、これはオフライン自動保存の意図設計（`use-soap-draft.ts:2`、`use-prescription-draft.ts:2`）であり重複問題ではない。

### 3.4 ローカル保存とサーバー保存の UI 混同

**判定: 語彙の両義性あり。「下書き保存」が永続先の異なる 2 系統で使われている。**

- サーバー保存の「下書き保存」: 訪問予定ドラフト（`schedules/schedule-create-edit-drawer.tsx:619`、実体は `visit-schedule-proposals` の draft status `:404`）、薬局間連携（`workflow/pharmacy-cooperation/pharmacy-cooperation-workflow-content.tsx:2475`）、協力薬局訪問記録（`src/lib/api/route-catalog.ts:329`）。
- 端末（Dexie）保存の「下書き保存/一時保存」: 訪問記録の下部固定バー「一時保存」= Cmd+S = Dexie 保存（`visits/[id]/record/visit-record-form.tsx:1935`）、処方受付の「下書き保存」文言（`prescription-intake-form.tsx:583`）。
- 良い先例（明示型）: 写真・音声は「端末に保存しました（通信がなくても残ります）」（`capture-content.tsx:250`、`voice-memo-content.tsx:214`）、鍵なし時は「端末に保存していません。再ログイン後に保存してください」の fail-close 文言（`visit-record-form.tsx:899`、`prescription-intake-form.tsx:578`）。
- 帰結: 「下書き保存」だけでは「他の端末・他のスタッフから見えるか」が判別できない。端末保存系は capture/voice-memo の語彙（端末に保存）へ統一するのが Phase 5 候補。

### 3.5 stale data を最新と見せる画面（online 手動 refetch 方式の弱点含む）

**判定: 問題あり（構成上の弱点 2 点）。**

1. **フォーカス復帰で再取得しない**: `refetchOnWindowFocus: false` + `refetchOnReconnect: false`（`query-provider.tsx:16-17`）で、代替は `online` イベントの手動 refetch のみ（:26-32）。つまり「オフライン→復帰」は拾うが、**「タブを長時間放置→戻る」「別ウィンドウで作業→戻る」は一切拾わず**、staleTime 60s を大きく超えたデータが更新表示なしで最新として提示される。緩和済みは realtime 層採用画面のみ: `useRealtimeQuery` 採用は handoff / dashboard-cockpit / calendar-view / notifications / comment-thread / patients-board / visits-today / workflow 系ほか約 15 ファイル + polling（`use-nav-badges.ts`、admin/jobs、admin/performance、settings）。**それ以外の useQuery 約 97 ファイルの大半（tasks、患者詳細系、admin 一覧等）は非緩和**。
2. **ヘッダー「同期済み HH:MM」の意味論**: `app-header.tsx:67-98` の表示は `useOfflineStore.lastSyncedAt`、すなわち**オフライン syncQueue の最終 drain 時刻**であり、画面に出ている Query データの鮮度とは無関係。放置タブで画面データが古くても「同期済み」と緑表示され得る（データ鮮度の保証と誤読されるリスク）。

### 3.6 競合時の静かな上書きの有無

**判定: コア臨床フローは保護済み。患者基本情報ほか大半の PATCH/PUT は last-write-wins。**

- 楽観ロック（OCC）実装済み: visit-records `expected_version`（`src/app/api/visit-records/route.ts:1085`）、dispense-results / dispense-audits（cycle.version、`dispense-results/route.ts:542`、`dispense-audits/route.ts:658`）、set-plans batches/cell、set-audits、handoff 系（`expected_visit_record_version`、`visit-records/[id]/handoff/route.ts:136`）。オフライン syncQueue も 409→conflict UI（差分提示 + 明示上書き、`sync-engine.ts:632-700`）で静かな上書きなし。
- **未保護**: `expected_version` 検証を持つ API は 6 ファイルのみ（grep）に対し、PUT/PATCH を持つ route は 95 ファイル。代表例: 患者基本情報 PATCH（`src/app/api/patients/[id]/route.ts:2338`、ファイル内 `version` 出現 0 件）は同時編集で後勝ち。ただし `writePatientFieldRevisions`（同 :36,1567）で変更履歴は時点管理・監査されるため「静かだが追跡可能」。FE 側にも同時編集の警告 UI はない（患者フォームに OCC ヘッダなし）。
- Phase 5 論点: 「どの資源に OCC が必要か」の基準策定（多職種同時編集が現実的な患者プロフィール・タスクが第一候補）。

### 3.7 logout 後に残る患者/認証/キャッシュ文脈

**判定: 問題あり。logout 2 経路で消去範囲が非対称。**

- 検証: `sidebar.tsx:94-97` の `handleLogout` は `setSidebarOpen(false)` + `signOut({ callbackUrl: '/login' })` **のみ**。対して session-timeout modal 経路は `clearOfflineEncryptionKey()` を明示的に await してから signOut（`session-timeout-modal.tsx:191-194`）。
- sidebar 経路のフォロー機構は `SessionStateBridge` の「session 消滅時に鍵クリア」effect（`app-provider.tsx:51-54`）だが、`AppProvider` は `(dashboard)/layout.tsx:28` にのみマウントされ **/login（(auth) グループ）には存在しない**（root layout は `RootProvider` のみ、`src/app/layout.tsx:45`）。signOut はハードリダイレクトのため、redirect 前に effect が発火する保証はない → **sidebar からの logout では暗号鍵（IndexedDB `ph-os-offline-keys`）が端末に残る可能性が高い**（発火タイミングは実測未確認）。次回 `initOfflineEncryptionKey` は既存鍵を再利用するだけで他ユーザー鍵を消さない（`crypto.ts:127-131`）。
- `queryClient.clear()` は 0 件（grep）だが、signOut のフルページ遷移でメモリ Query キャッシュ・Zustand は破棄されるため実害なし（SPA 内でログイン画面へ戻る経路が今後できた場合は要再評価）。
- Dexie データ行の削除は logout 経路に存在しない（テーブル clear は `offline-sync.demo.ts` のみ。`crypto.ts:93` の `store.clear()` は**鍵 store のみ**）。暗号文 + 平文メタデータ（patientId、scheduleId、`residualDrafts.drugName`（`offline-db.ts:36-47`）、evidence の fileName）が端末残置 — phase0 07 §12-3/4 と一致、コードで再確認。
- 付随事実: `clearOfflineEncryptionKey` は key store 全体を `clear()` するため、共有端末では**他ユーザーの鍵も同時に消える**（データ喪失ではなく再ログインで再生成されるが、そのユーザーの未同期ドラフトは復号不能化する）。fail-close 方向なので安全側だが挙動として記録。

### 3.8 患者切替後の前患者状態残存

**判定: 問題なし（設計通り）。**

- Query 層: 患者依存 query は key に patientId+orgId を含む（例 `['patient-overview', patientId, orgId]`、`collaboration-content.tsx:70`）ため切替で自然分離。患者切替時の cache clear は不要かつ不存在（phase0 §2 と一致）。
- `PatientHeader` は props のみの純 presentational コンポーネント（`src/components/features/patients/patient-header.tsx:42-`、useQuery/独自キャッシュなし）。呼び出し元 6 画面（card-workspace / safety-check / capture / visit-record-detail / prescription-intake / reports）の query に従属し、残存経路なし。
- ワークベンチ: `selId` 切替で effect が再実行（deps に selId、`dispensing-workbench.tsx:410` 付近）。hydrate は先に空 model `{ [targetId]: [] }` + done/audit リセットを書いてから詳細を流し込む（:374-383）ため、前患者の臨床 state が新患者に見える隙間はない。カレンダー工程では前工程 operator を明示的に null 化（:420-424）。persist は実データ時に臨床 state を除外（store :622-624）。
- 未確認: 患者依存 query key の全数（625 箇所）に patientId が漏れなく入っているかの網羅監査は未実施（Phase 5 引き継ぎ）。

---

## 4. Phase 5 監査への引き継ぎ事項

1. **ワークベンチのサーバー状態を Query へ統合するか判断**（§3.1）: 直 fetch→Zustand hydrate を `useQuery(workbenchQueryKey)` + store は作業 state のみに再編するか、現行分離を正式仕様として dead invalidation key（`use-workbench-mutations.ts:176,186`）を撤去するか。SSE 整合計画（同 :18 コメント）との整合確認。
2. **URL 状態化の対象画面リスト確定**（§3.2 の表）: 最低ライン=タブ 5 画面の `?tab=` 化とタスクフィルタの双方向化。実装規範は `search-content.tsx:286-293`。DataTable page/sort の URL 化は共有ニーズのある一覧に限定して選定。
3. **保存語彙の統一**（§3.4）: 「下書き保存（サーバー）」vs「端末に保存（Dexie）」の書き分けルールを ui-ux-design-guidelines に追加し、`visit-record-form.tsx:1935` の「一時保存」と `prescription-intake-form.tsx:583` を改稿対象に。
4. **鮮度対策**（§3.5）: (a) `refetchOnWindowFocus` の全体 or 画面別有効化（medical data 画面優先）、(b) realtime 非採用 useQuery 画面の棚卸し（97 ファイル中の非緩和分）、(c) ヘッダー「同期済み HH:MM」の意味の再定義または文言変更（オフライン同期時刻であることの明示）。
5. **OCC 適用基準の策定**（§3.6）: 患者 PATCH（`patients/[id]/route.ts:2338`）はじめ version 検証なし 89 route の中から、多職種同時編集が現実的な資源を選定して expected_version + conflict UI（既存 `ConflictDiffDialog` 再利用）を拡張。
6. **logout 経路の統一**（§3.7）: sidebar `handleLogout`（`sidebar.tsx:94-97`）に `clearOfflineEncryptionKey()` を追加し session-timeout 経路と対称化。あわせて logout 時の Dexie 行削除（少なくとも平文メタデータを持つ `residualDrafts`）の要否を Compliance 観点で判断。※auth 領域のため hard-stop 規約に従い human 承認前提。
7. **query key 網羅監査**: 625 key の orgId/patientId スコープ漏れ全数チェック（§3.8 未確認分）と、orgId 位置（2番目/3番目）の揺れの規約化（phase0 §1.2）。中央 query-key レジストリ導入の是非。
8. **未確認事項の解消**: sidebar logout 時の `app-provider.tsx:51-54` effect 発火タイミング実測（E2E で `ph-os-offline-keys` 残存を検証）、`ui-store`/`auth-store`/`dispensing-workbench.store` の単体テスト欠落、保存ビュー API のテストファイル名、検索操作のサーバー側 audit 有無。
