# Phase0 Recon 07: オフライン / PWA

調査日: 2026-07-11 / 調査者: Phase0 recon agent

## 1. バージョン（lockfile 実値）

| パッケージ | package.json | pnpm-lock.yaml 解決値 | 根拠 |
| --- | --- | --- | --- |
| `@serwist/next` | `^9.5.11` | `9.5.11` | `package.json:131`, `pnpm-lock.yaml:1871` |
| `serwist` | `^9.5.11` | `9.5.11` | `package.json:159`, `pnpm-lock.yaml:4751` |
| `dexie` | `^4.4.3` | `4.4.3` | `package.json:143`, `pnpm-lock.yaml:3048` |

Serwist は「想定スタック」どおり実在。`zustand@^5.0.14`（`package.json:165`）がオフライン状態ストアに使用されている。

## 2. Service Worker（Serwist）構成

### 2.1 ビルド配線（next.config.ts:26-31）

```ts
const withSerwist = withSerwistInit({
  swSrc: 'src/app/sw.ts',
  swDest: 'public/sw.js',
  disable: process.env.NODE_ENV !== 'production' || process.env.PLAYWRIGHT === '1',
  cacheOnNavigation: false,
  reloadOnOnline: false,
});
```

- **dev / Playwright では SW 完全無効**（`disable` 条件）。
- SW の登録は `@serwist/next` のデフォルト自動登録に依存（手動 `navigator.serviceWorker.register` 呼び出しはアプリコードに未検出。`src/lib/browser-notifications.ts:36` は `getRegistration('/')` で既存登録を参照するのみ）。
- `output: 'standalone'` も実在（`next.config.ts:11`）— 想定どおり。
- SW 用の型チェックは専用 tsconfig で実施（`pnpm typecheck` に `tsc -p tsconfig.sw.json` が含まれる、`package.json:19`）。SW 自体のユニットテストは `src/app/sw.test.ts`、キャッシュポリシーは `src/lib/offline/sw-cache-policy.test.ts`。

### 2.2 キャッシュ戦略（src/app/sw.ts:31-69 + src/lib/offline/sw-cache-policy.ts:25-44）

ポリシー判定は純関数 `resolveRuntimeCachePolicy` に集約:

| 対象 | ポリシー | ハンドラ / キャッシュ名 |
| --- | --- | --- |
| `/api/**` | `api-network-only` | `NetworkOnly`（キャッシュしない） |
| ナビゲーション（`/offline` 以外） | `navigation-network-only` | `NetworkOnly` |
| `/offline` へのナビゲーション | `page-network-first` | `NetworkFirst`、cacheName `offline-pages-v2`、`networkTimeoutSeconds: 3`（sw.ts:44-47） |
| script / style / worker | `asset-stale-while-revalidate` | `StaleWhileRevalidate`、cacheName `assets` |
| image / `/icons/**` | `image-cache-first` | `CacheFirst`、cacheName `images`、`ExpirationPlugin` maxEntries 64 / 24h（sw.ts:59-67） |

- **API レスポンスと認証済みルートの HTML は PHI を含みうるため SW キャッシュに一切入れない**方針がコード内コメントに明記（sw.ts:37-38「Keep intentional offline PHI in encrypted IndexedDB only, never in SW caches」）。
- precache は `self.__SW_MANIFEST`（ビルド成果物）+ `cleanupOutdatedCaches: true`（sw.ts:71-75）。
- 旧キャッシュ `api-cache` / `pages` は activate 時に削除（`sw-cache-policy.ts:1` の `LEGACY_RUNTIME_CACHE_NAMES`、sw.ts:84-88）。

### 2.3 更新フロー

- `skipWaiting: true` + `clientsClaim: true` + `navigationPreload: true`（sw.ts:76-78）→ 新 SW は即時有効化。
- `reloadOnOnline: false`、`cacheOnNavigation: false`（next.config.ts:30-31）。
- 「新しいバージョンがあります」等の**更新通知 UI は未検出**（`controllerchange` リスナ等のアプリ側ハンドリングなし）。
- **注意（事実）**: navigation は `/offline` 以外 `NetworkOnly` で、`sw.ts` に catch handler / fallback（オフライン時に `/offline` を返す設定）が**存在しない**。オフライン中に新規ナビゲーション（リロード含む）するとブラウザ標準のネットワークエラーになる構成。`/offline` ページ自体は直接アクセスした場合のみ `offline-pages-v2` から配信される。

### 2.4 Push 通知（sw.ts:90-106）

- `push` イベントで `redactPushPayloadForOsBridge`（`src/lib/notifications/os-bridge-redaction`）により**ペイロードを OS 通知向けに redact** してから表示。クリック時は `OS_BRIDGE_LANDING_URL` を開く。
- **不整合（事実）**: 通知アイコンに `/icons/icon-192x192.png` / `/icons/icon-72x72.png` を参照（sw.ts:95-96）するが、`public/icons/` に存在するのは `icon-192.svg` と `icon-512.svg` のみ。PNG は不在。

## 3. manifest.json（public/manifest.json）

- `name`/`short_name`: PH-OS、`description`: 在宅訪問薬局プラットフォーム
- `start_url: /dashboard`、`display: standalone`、`theme_color: #1e40af`、`background_color: #ffffff`
- アイコンは SVG 2 点のみ（192/512）。`purpose: maskable`・screenshots・shortcuts は未定義。
- `src/app/layout.tsx:21` で `manifest: '/manifest.json'` をメタデータ登録。
- インストール促進 UI あり: `src/components/features/pwa/install-prompt`（`beforeinstallprompt` を扱う `InstallPrompt`、`src/components/layout/app-shell.tsx:24-25` で dynamic import）。
- `src/proxy.ts:390` の matcher で `manifest.json` / `sw.js` / `workbox-` はミドルウェア（CSP nonce 付与）対象外。

## 4. Dexie / IndexedDB スキーマ

### 4.1 メイン DB `PH-OSOffline`（src/lib/stores/offline-db.ts）

schema version は **v1〜v9**（offline-db.ts:139-244）。テーブル 7 つ:

| テーブル | 保存対象 | 暗号化 |
| --- | --- | --- |
| `visitDrafts` | 訪問記録ウィザードのドラフト（`structuredSoap`、`residualMedications`、`currentStep` 等） | `structuredSoap`/`residualMedications` は `encryptOfflinePayloadRequired` で暗号化（`src/lib/hooks/use-soap-draft.ts:292-307`）。scheduleId/patientId 等のインデックス列は平文 |
| `residualDrafts` | 残薬ドラフト | **`drugName` 等が平文カラム**（offline-db.ts:36-47） |
| `syncQueue` | 同期キュー（`entityType`: `visit_record` / `residual_medication`） | `payload`・`conflict_payload` とも暗号化 JSON（offline-db.ts:52,59） |
| `visitBriefCache` | 訪問ブリーフ（患者名等）のキャッシュ | payload 暗号化（`schedule-day-visit-brief-cache.ts:284` で `encryptOfflinePayloadRequired`） |
| `prescriptionDrafts` | 処方入力フォームのスナップショット | payload 暗号化（offline-db.ts:74） |
| `evidenceDrafts` | 証跡写真（p0_48）: 画像 dataURL | payload 暗号化必須（offline-db.ts:93 コメント「PHI のため平文保存しない」）。`uploadedFileAssetId` で再アップロードなしの再試行再開（offline-db.ts:100） |
| `voiceMemoDrafts` | 音声メモ（p1_11）: 録音 dataURL + 手入力転写 | 音声・転写とも暗号化（offline-db.ts:117,124）。**STT 未接続のため端末内保持のみでサーバ送信なし**（offline-db.ts:105-108、`src/lib/offline/voice-memo-drafts.ts` に fetch/upload 処理なし） |

migration 実績: v2 で `currentStep` デフォルト付与、**v6 で旧平文 SOAP フィールドを purge**（`purgeLegacyPlaintextSoapDraftFields`、offline-db.ts:191-198）、v9 で `evidenceDrafts` に `retryCount` index + backfill。

### 4.2 phos モジュールの別 DB（src/phos/api/）

phos（ボード/訪問モード UI: `src/phos/ui/board/BoardClient.tsx`, `src/phos/ui/visit/VisitModePageClient.tsx`）は**独立した Dexie DB を 2 つ**持つ:

- `PH-OSActionOfflineQueue`（`offlineActionQueue.ts:57`）: カード操作のオフラインキュー。**`idempotency_key` を索引に持ち enqueue 時に重複排除**（offlineActionQueue.ts:22,61,72-81）。MAX_RETRIES=3、replay batch 25、`blocked_reason: 'CONFLICT' | 'MAX_RETRIES'`。`OfflineSyncConflictCount` メトリクスを emit する `PhosOfflineSyncMetricEmitter` インタフェースあり（offlineActionQueue.ts:42-50。実際の送信先バックエンドは未確認）。
- `PH-OSEvidenceOfflineQueue`（`offlineEvidenceQueue.ts:79`）。

payload 暗号化は共通の `@/lib/offline/crypto` を利用。

## 5. 暗号化（ENCRYPTION_KEY の実態）

**重要な想定差分**: CLAUDE.md には `ENCRYPTION_KEY # AES-GCM 256bit (IndexedDB PHI encryption)` とあるが、**クライアント側 IndexedDB 暗号化は env の ENCRYPTION_KEY を使っていない**。

- 実装（`src/lib/offline/crypto.ts`）: ログイン後に**ブラウザ内で AES-GCM 256bit の CryptoKey を `extractable: false` で生成**（crypto.ts:105-110）し、専用 IndexedDB `ph-os-offline-keys` に **ユーザー単位のレコード ID `offline-enc-key-v3:<userId>`** で保存（crypto.ts:7-11,51-53）。
- 初期化: `initOfflineEncryptionKey(cognitoSub ?? userId)` を `src/components/providers/app-provider.tsx:44-47` がセッション確立時に呼ぶ。
- ペイロード形式: `encv1:` prefix + base64(IV 12byte + ciphertext)（crypto.ts:3-4,166-181）。
- `encryptOfflinePayloadRequired` は鍵が無い場合 `OfflineEncryptionUnavailableError` を throw（fail-closed、crypto.ts:183-187）。旧平文 sync payload は同期時に tombstone 化して破棄（`sync-engine.ts:255-263,327-337`）。
- env の `ENCRYPTION_KEY` の実消費者は**サーバ側の webhook secret 暗号化のみ**（`src/server/services/webhook-secret-encryption.ts:32-34`、`src/lib/config/secrets.ts:52,60`）。

### 5.1 ユーザー/患者単位分離と logout 時消去

- 鍵は**ユーザー単位**（v3 レコード）。データ DB `PH-OSOffline` 自体はブラウザプロファイル共有（org/user でのDB分割なし）。患者単位分離はなし（`patientId` は平文インデックス列）。
- logout / セッション失効時: `clearOfflineEncryptionKey()` が呼ばれ、メモリキャッシュ破棄 + **key store を `clear()`（全ユーザーの鍵を削除）**（crypto.ts:87-103,142-151）。呼び出し元は `app-provider.tsx:53`（セッション消滅時）と `src/components/auth/session-timeout-modal.tsx:72,192`（失効・手動ログアウト）。
- **Dexie の暗号文データ行そのものは logout で削除されない**（`offlineDb` テーブルを clear するコードは demo seed 以外に未検出。`offline-sync.demo.ts:13` のみ）。鍵削除により復号不能化する設計だが、平文メタデータ（patientId、scheduleId、`residualDrafts.drugName`、evidence の `fileName` 等）は端末に残る。
- `visitBriefCache` のみ TTL 24h（`src/lib/offline/cache-policy.ts:1-2`）で起動時に prune（`src/components/providers/root-provider.tsx:10-15`）。

## 6. オフラインドラフト保存の対象画面

| 画面 | ファイル | 保存先 |
| --- | --- | --- |
| 訪問記録ウィザード（SOAP/残薬/ステップ） | `src/app/(dashboard)/visits/[id]/record/visit-record-form.tsx` + `src/lib/hooks/use-soap-draft.ts` | `visitDrafts` → `syncQueue` |
| 処方入力 | `src/app/(dashboard)/prescriptions/new/prescription-intake-form.tsx` + `src/lib/hooks/use-prescription-draft.ts` | `prescriptionDrafts`（端末内ドラフトのみ） |
| 証跡写真撮影 | `src/app/(dashboard)/visits/[id]/capture/capture-content.tsx`（一覧: `visits/evidence/evidence-gallery-content.tsx`） | `evidenceDrafts`（復帰時自動送信） |
| 音声メモ | `src/app/(dashboard)/visits/[id]/voice-memo/voice-memo-content.tsx` | `voiceMemoDrafts`（端末内のみ、送信なし） |
| スケジュール日ビュー（訪問ブリーフの先読みキャッシュ + オフラインパネル） | `src/app/(dashboard)/schedules/schedule-day-visit-brief-cache.ts`, `schedule-day-offline-panel.tsx` | `visitBriefCache`（読み取り用） |
| phos ボード/訪問モード | `src/phos/ui/board/BoardClient.tsx`, `src/phos/ui/visit/VisitModePageClient.tsx` | `PH-OSActionOfflineQueue` / `PH-OSEvidenceOfflineQueue` |

## 7. 同期エンジン（src/lib/stores/sync-engine.ts）

- エンドポイント: `visit_record → POST /api/visit-records`、`residual_medication → POST /api/residual-medications`（sync-engine.ts:27-30）。org は `buildOrgJsonHeaders(config.orgId)` で付与。
- **再試行**: `MAX_RETRIES = 3`、バックオフ `30s / 120s / 300s`（sync-engine.ts:10-11）。`nextAttemptAt` 未到達アイテムはスキップ（sync-engine.ts:232-235）。失敗上限到達分は `/offline-sync` の「再試行」で `resetFailedSyncQueueRetries()`（retryCount を 0 に戻す。conflict は対象外、sync-engine.ts:604-620）。
- **重複防止**:
  - enqueue 時: `visit_record` は `schedule_id` 単位で dedupe（最新 1 件に上書き・古い分削除、sync-engine.ts:278-286,512-536）。
  - 送信前 preflight `verifyQueueItemCurrent`（DB の現物と全フィールド同値比較、sync-engine.ts:461-469）+ 完了削除もトランザクション内で同値再検証（`deleteSyncedQueueItem`、sync-engine.ts:440-459）→ 並行実行での二重処理・取り違え削除を防止。
  - 実行自体も `syncConfigKey` 単位で in-flight coalesce（`activeSyncQueueRuns`、sync-engine.ts:471-486）。
  - **HTTP レベルの idempotency key はこのキューには無い**（phos 側 `offlineActionQueue` のみ `idempotency_key` を持つ）。重複防止はサーバ側の既存レコード検出（409）に依存。
- **conflict 検出**: サーバが 409 を返すと `conflict_state: 'server_conflict'` を立て、`{local, server}` スナップショットを暗号化して `conflict_payload` に保存、retryCount を上限化して自動再送を停止（sync-engine.ts:371-387）。サーバ側は `src/app/api/visit-records/route.ts:1083-1092` で `conflict_resolution === 'overwrite' && existing_record_id === existingRecord.id && expected_version === existingRecord.version` を検証し、不一致なら `record_conflict`（`details.existing_record` 同梱）を返す — **expected_version による楽観ロック実在**。
- **conflict 解決 UI**: `/offline-sync`（`src/app/(dashboard)/offline-sync/offline-sync-content.tsx`、p0_34/p0_35 と明記）で一覧・再試行・「最新を使う（破棄）」/「自分の入力で上書き」を提供。差分確認は `ConflictDiffDialog`（`src/components/ui/conflict-diff-dialog.tsx` — 残る側/破棄側の差分列挙と不可逆性説明を型で強制）。上書きは `overwriteVisitRecordConflict` が `conflict_resolution: 'overwrite'` + `expected_version` 付きで再 POST し、再 409 なら server スナップショットを更新して再提示（sync-engine.ts:632-700）。スケジュール日ビューにも overwrite/discard 可能な conflict パネルあり（`schedule-day-offline-panel.tsx:17-40`）。
- 証跡写真は別ドレイン `syncEvidenceDrafts`（`src/lib/offline/evidence-drafts.ts:315-, 360-` — こちらも in-flight coalesce + online リスナ）。

## 8. オンライン復帰検出とグローバル同期

- 検出は `navigator.onLine` + `online`/`offline` イベント（`src/lib/hooks/use-network-online.ts`、`sync-engine.ts:251-253,705-735` の `setupAutoSync` は refCount 付き購読）。
- **グローバル化**: `OfflineSyncBridge`（`src/components/providers/offline-sync-bridge.tsx`）がマウント時と online 復帰時に `processSyncQueue` + `syncEvidenceDrafts` を全画面共通で実行し、`offline-store`（zustand、`src/lib/stores/offline-store.ts`: `pendingSyncCount` / `pendingQueue` / `syncConflicts` / `lastSyncedAt`）を hydrate。page-scoped の setupAutoSync と `syncConfigKey` が一致するため coalesce で二重送信しない旨コメントに明記（offline-sync-bridge.tsx:49-55）。

## 9. offline 状態のグローバル表示

- `NetworkStatusBanner`（`src/components/layout/network-status-banner.tsx`、`app-shell.tsx:464` で常設）: オフライン時に「read-only 表示・キャッシュ保持最長 24 時間」バナー + `/offline` への案内リンク。
- ヘッダー（`src/components/layout/app-header.tsx:67-114`）: 「同期済み HH:MM」（done=緑）⇔ オフライン時「オフライン」（blocked=赤）+ 未同期件数の `OfflineDraftIndicator`。
- `/offline` ページ（`src/app/offline/page.tsx`）: `ErrorState variant="network"` のみの静的案内ページ（SW が NetworkFirst でキャッシュする唯一のナビゲーション）。
- 旧 `NetworkStatus`（`src/components/features/offline/network-status.tsx`、固定 top バナー「オフライン — 読取専用モード」）は定義ファイル以外から参照されておらず**未使用の可能性が高い**（grep で他ファイル参照ゼロ。動的参照の有無は未確認）。

## 10. PWA としてオフラインで何ができるか（構成上の帰結）

- **できる**: インストール（manifest + InstallPrompt）/ static assets・画像のキャッシュ利用 / SPA として開いたままの画面でのドラフト作成（訪問記録・残薬・処方・写真・音声）と暗号化保存 / 事前キャッシュ済み訪問ブリーフの閲覧（24h TTL）/ 復帰時の自動同期・conflict 解決。
- **できない**: オフライン中の新規ページナビゲーション・リロード（navigation は NetworkOnly、offline fallback ハンドラ未設定 → `/offline` を明示的に開いた場合のみキャッシュ配信）。API データの閲覧（SW は API を一切キャッシュしない設計）。dev / Playwright 環境での SW 動作全般。

## 11. 想定スタックとの差分まとめ（本章スコープ分）

| 想定 | 実態 |
| --- | --- |
| Serwist | **実在** `@serwist/next@9.5.11` / `serwist@9.5.11` |
| `standalone` output | **実在**（next.config.ts:11） |
| ENCRYPTION_KEY で IndexedDB PHI 暗号化 | **別方式**: クライアントはブラウザ内生成の non-extractable per-user AES-GCM 鍵（env 鍵はサーバ側 webhook secret 暗号化に使用） |
| CloudWatch metrics（オフライン関連） | phos の `PhosOfflineSyncMetricEmitter` が `OfflineSyncConflictCount` を emit する契約あり（実際の CloudWatch 送信経路は本調査では未確認） |
| Cognito+NextAuth | オフライン鍵の identity に `session.user.cognitoSub ?? id` を使用（app-provider.tsx:44）— 認証詳細は別章 |

## 12. リスク・注意点（事実ベース）

1. SW push 通知アイコンの PNG（`/icons/icon-192x192.png` 等）が `public/icons/` に不在（SVG のみ）。
2. オフライン時のナビゲーション fallback（catch handler）が SW に無く、`/offline` ページは明示遷移でしか機能しない。NetworkStatusBanner のリンク経由でもオフライン中は `/offline` がキャッシュ済みの場合のみ表示可能。
3. logout は暗号鍵のみ削除し Dexie データ行は残置（暗号文 + 平文メタデータ）。鍵 store は `clear()` のため同一端末の別ユーザー鍵も同時に消える。
4. `residualDrafts` は `drugName` 等が平文カラム（syncQueue 経由の payload は暗号化されるが、テーブル自体のカラムは平文）。
5. メイン syncQueue に HTTP idempotency key は無く、重複防止はクライアント側 dedupe + サーバ 409 検出に依存（phos 側のみ idempotency_key 実装あり）。
6. 更新通知 UI が無く skipWaiting 即時適用のため、SW 更新はユーザーに不可視。
