# Phase0 Recon: App Router 構造（src/app）

調査日: 2026-07-11 / 調査者: Phase0 recon agent

## 1. サマリ

- ページ (`page.tsx`): **128**、レイアウト (`layout.tsx`): **5**、`loading.tsx`: **60**、`error.tsx`: **22**（`find src/app` 実測）。
- ルートグループは **`(auth)` / `(dashboard)` / `(legal)`** の3つ。グループ外セグメントとして `platform/`（運営者コンソール）、`shared/[token]`（外部共有）、`offline/`、`dashboard-preview/`、ルート `page.tsx`。
- **template.tsx: なし / default.tsx: なし / parallel routes (`@slot`): なし / intercepting routes (`(.)`等): なし**（`find src/app -type d -name "@*" -o -name "(.)*" ...` が0件）。
- `middleware.ts` は**存在しない**。Next.js 16 の **`src/proxy.ts`** が唯一の Edge ミドルウェア入口（`src/proxy.ts:12-23` のコメントに「middleware.ts removed」と明記）。
- API route handlers: **401 ファイル**（`src/app/api/**/route.ts`、`__tests__` 除外後も 401）、トップレベルドメイン **107**。
- 認証境界は **proxy.ts（Edge、トークン有無チェック+リダイレクト） + 各 layout.tsx（Server、org/operator メンバーシップ検証）の二層**。route group 自体は視覚レイアウト分離であり、認可判定は layout 内コードで行う。

## 2. ルートグループとレイアウト

| グループ/セグメント | layout | 役割 | 認証 |
| --- | --- | --- | --- |
| `(auth)` | `src/app/(auth)/layout.tsx` | ログイン系の中央寄せカードレイアウト（PH-OS ロゴ+3省2ガイドライン表記）。認証チェックなし | 公開 |
| `(dashboard)` | `src/app/(dashboard)/layout.tsx:12-24` | `auth()` セッション → `resolveLocalUserByIdentity` → `org_id` 必須。無セッション=`unauthorized()`、org なし=`forbidden()`。`AppProvider`+`AppShell` でアプリシェル構築 | 認証+テナント org 所属必須 |
| `(legal)` | `src/app/(legal)/layout.tsx` | 利用規約/プライバシー用の公開静的レイアウト | 公開 |
| `platform/` | `src/app/platform/layout.tsx:17-38` | `(dashboard)` の外に意図的に配置（コメントで明記: 運営者はテナント org 非所属のため dashboard gate が弾く）。`PlatformOperator` の active 行を検証、なければ `forbidden()` | 認証+PlatformOperator(active) 必須 |
| ルート直下 | `src/app/layout.tsx` | Noto Sans JP/Geist Mono フォント、`headers()` から proxy 由来の `x-nonce` を読み CSP nonce を転送。`RootProvider` | — |

- `unauthorized()`/`forbidden()` に対応するページ: `src/app/unauthorized.tsx` / `src/app/forbidden.tsx` が存在（Next.js 16 の unauthorized/forbidden ファイル規約を使用）。

## 3. 特殊ファイルの分布

- `global-error.tsx`: `src/app/global-error.tsx`（PHI を Sentry に流さないよう digest コードのみ `clientLog` に記録、`unstable_retry` 使用）。
- `not-found.tsx`: `src/app/not-found.tsx`（ルート直下のみ。セグメント別 not-found はなし。ただし `patients/movement-fixture/page.tsx` 等がコード内で `notFound()` を呼ぶ）。
- `error.tsx` 22件: ルート直下 + `(dashboard)` 直下 + 主要セクション（admin/audit/billing/communications/conferences/dispense/handoff/notifications/patients/prescriptions/referrals/reports/schedules/search/set/set-audit/settings/tasks/visits/workflow）。
- `loading.tsx` 60件: `(dashboard)` 直下と admin 配下ほぼ全ページ、patients/[id] サブページ等に分布。`(auth)`/`(legal)`/`platform` には loading なし。
- `template.tsx` / `default.tsx`: **なし**。

## 4. ページ全ルート一覧（役割1行）

役割は各 page.tsx の `metadata.title` / 冒頭コメント / 実装冒頭から確認。「推定」と付記したものはパス・ディレクトリ名からの推測。

### 4.1 `(auth)` — 公開（proxy の保護 prefix 対象外）

| ルート | 役割 |
| --- | --- |
| `/login` | ログイン（`next-auth signIn` + Cognito challenge 処理、`src/app/(auth)/login/page.tsx`） |
| `/first-login` | 初回ログイン（初期パスワード変更フロー、client component 実装から確認） |
| `/lockout` | アカウントロックアウト表示（推定: パス由来） |
| `/mfa` | MFA コード入力（推定: パス由来） |
| `/mfa/setup` | MFA(TOTP) 初期設定（推定: パス由来） |
| `/password/change` | パスワード変更（推定: パス由来） |
| `/password/reset` | パスワードリセット（推定: パス由来） |

### 4.2 `(dashboard)` — 認証必須（layout gate + proxy prefix）

トップレベル業務画面:

| ルート | 役割（title 実測） |
| --- | --- |
| `/dashboard` | 運用コックピット（role 別フォーカス `resolveDashboardFocusRole`） |
| `/my-day` | My Day（個人の今日のタスクビュー） |
| `/patients` | 患者一覧ボード（`PatientsBoard`） |
| `/patients/new` | 患者新規登録 |
| `/patients/compare` | 複数カードを並べて確認 |
| `/patients/movement-fixture` | 患者タイムラインのフィクスチャ表示（本番では `notFound()`、開発用） |
| `/prescriptions` | 処方箋受付 |
| `/prescriptions/new` | 新規処方受付 |
| `/prescriptions/intake` | 処方取込 |
| `/prescriptions/[id]` | 処方受付詳細 |
| `/prescriptions/qr-drafts` | QR 処方ドラフト一覧（client 実装から確認） |
| `/prescriptions/qr-drafts/[id]` | QR 処方ドラフト詳細・確定（client 実装から確認） |
| `/qr-scan` | 処方箋 QR スキャン（カメラ/アップロード、client 実装から確認） |
| `/dispense` | 調剤ワークベンチ |
| `/audit` | （調剤）監査 |
| `/set` | セット（配薬セット作成） |
| `/set-audit` | セット監査 |
| `/visits` | 訪問一覧 |
| `/visits/evidence` | 画像・証跡 |
| `/visits/[id]` | 訪問記録詳細 |
| `/visits/[id]/brief` | 訪問前まとめを確認 |
| `/visits/[id]/record` | 訪問記録入力 |
| `/visits/[id]/capture` | 写真・証跡を撮る |
| `/visits/[id]/voice-memo` | 音声メモ・文字起こし |
| `/visits/[id]/facility-packet` | 施設訪問パケット |
| `/schedules` | 訪問スケジュール |
| `/schedules/proposals` | 訪問候補ダッシュボード |
| `/schedules/conflicts` | 予定の重なりを直す |
| `/schedules/route-compare` | ルート案を比べる |
| `/schedules/emergency-route` | 緊急処方の割込・ルート再計算 |
| `/reports` | 報告・共有ワークスペース |
| `/reports/[id]` | 報告書詳細（client 実装から確認） |
| `/reports/[id]/print` | 報告書印刷（推定: パス由来） |
| `/reports/[id]/share` | 他職種向け共有ページ（冒頭コメントで確認） |
| `/reports/print` | 帳票・印刷プレビュー |
| `/reports/analytics` | 報告書送達分析 |
| `/billing` | 算定チェック |
| `/billing/candidates` | 月次請求候補 |
| `/billing/partner-cooperation` | 薬局間協力 月次処理 |
| `/tasks` | タスク |
| `/handoff` | ハンドオフ（薬剤師⇔事務連絡ハブ） |
| `/workflow` | ワークフローダッシュボード |
| `/workflow/pharmacy-cooperation` | 薬局間協力ワークフロー |
| `/communications` | `/communications/inbound` へ redirect のみ |
| `/communications/inbound` | 他職種受信インボックス |
| `/communications/requests` | 依頼・照会一覧 |
| `/conferences` | カンファレンス |
| `/notifications` | お知らせ |
| `/search` | 全体検索 |
| `/views` | よく使う絞り込み（保存ビュー） |
| `/statistics` | 統計 |
| `/external` | 外部連携ビュー |
| `/clerk-support` | 事務でできること（事務スタッフ支援） |
| `/offline-sync` | オフライン同期状況（`OfflineSyncContent`、推定含む） |
| `/settings` | 設定 |
| `/select-mode` | 業務モードの選択 |
| `/select-site` | 使う薬局（サイト）の選択 |
| `/referrals/new` | 紹介受付 |

患者詳細サブページ (`/patients/[id]/...`):

| ルート | 役割（title 実測） |
| --- | --- |
| `/patients/[id]` | 患者カード（詳細ハブ） |
| `/patients/[id]/edit` | 患者情報編集 |
| `/patients/[id]/medications` | 服薬管理（`/print` 付き: 印刷ビュー、推定） |
| `/patients/[id]/medication-calendar` | 服薬カレンダー |
| `/patients/[id]/prescriptions` | 処方内容一覧 |
| `/patients/[id]/management-plan` | 薬学的管理計画（`/print` 付き、推定: パス由来） |
| `/patients/[id]/visit-records` | 訪問記録一覧（`/print` 付き、推定: パス由来） |
| `/patients/[id]/safety-check` | 薬の安全チェック（CDS） |
| `/patients/[id]/residual-adjustment` | 残薬調整 |
| `/patients/[id]/consent` | 同意記録 |
| `/patients/[id]/collaboration` | 今だれが見ているか（presence） |
| `/patients/[id]/share` | 他職種向け共有 |
| `/patients/[id]/mcs` | MCS（メディカルケアステーション）連携 |

admin 配下（`/admin/...`、マスター・管理系。title 実測）:

`/admin`（マスターハブ）, `alert-rules`（アラートルール、推定）, `analytics`（KPI分析）, `audit-logs`（監査ログ）, `billing-rules`（算定ルール、推定）, `business-holidays`（休日カレンダー）, `capacity`（キャパシティ・詰まり確認）, `contact-profiles`（連携先プロファイル）, `data-explorer`（データ探索）, `dispense-audit-stats`（調剤監査統計、推定）, `document-templates`（文書テンプレート管理）, `drug-masters`（医薬品マスター管理）, `external-professionals`（他職種マスター）, `facilities`（施設マスター）, `facility-standards`（施設基準管理）, `formulary`（採用薬マスター）, `incidents`（ヒヤリハット管理）, `institutions`（医療機関マスター）, `inventory-forecast`（在庫と定期処方の予測）, `jobs`（ジョブ監視）, `metrics`（経営指標）, `notification-settings`（通知設定）, `operating-hours`（稼働日設定）, `operations-insights`（在宅業務の動きを見る）, `packaging-methods`（配薬方法マスター）, `pca-pumps`（PCAポンプレンタル）, `performance`（パフォーマンス、推定）, `pharmacist-credentials`（かかりつけ薬剤師管理）, `pharmacy-cooperation`（薬局間協力設定）, `pharmacy-sites`（薬局情報管理）, `professionals`（社内専門職、推定）, `realtime`（リアルタイム更新・変更承認、client 実装から確認）, `service-areas`（サービスエリア、推定）, `settings`（管理設定）, `shifts`（薬剤師シフト管理）, `staff`（スタッフ管理）, `uat`（パイロット UAT）, `users`（ユーザー管理）, `vehicles`（車両マスター）

注: admin 配下の権限制御は layout ではなくページ/API 側（`(dashboard)/layout.tsx` は org 所属のみ検証）。admin 専用 layout.tsx は存在せず、`admin/error.tsx`・`admin/loading.tsx` のみ。管理者ロール判定の実装箇所は本調査では未確認。

### 4.3 `(legal)` — 公開

| ルート | 役割 |
| --- | --- |
| `/terms` | 利用規約 |
| `/privacy` | プライバシーポリシー |

### 4.4 グループ外

| ルート | 役割 | 認証 |
| --- | --- | --- |
| `/` | `redirect('/dashboard')` のみ（`src/app/page.tsx`） | 実質認証（遷移先が保護） |
| `/platform` | 運営者テナントディレクトリ（`TenantDirectoryContent`） | platform layout で PlatformOperator 検証 |
| `/platform/tenants/[orgId]` | テナント詳細（break-glass コンソール） | 同上 |
| `/shared/[token]` | 外部共有ビューア（トークン+OTP、URL の `?otp` を除去して redirect） | トークンベース公開（proxy 保護 prefix 対象外） |
| `/offline` | PWA オフラインフォールバック（`ErrorState variant="network"`） | 公開 |
| `/dashboard-preview` | ダッシュボードのプレビュー表示（`DashboardContent` を認証レイアウト外で再利用） | **公開**（`(dashboard)` 外かつ proxy の `/dashboard` prefix は `/dashboard-preview` に一致しない。`src/proxy.ts:123-127` の `pathname === prefix || startsWith(prefix + '/')` 判定。中身のデータ fetch は API 側認証に依存 — 意図か要確認） |

## 5. API route handlers（ディレクトリレベル）

- 総数: **401** `route.ts`（`src/app/api/**`、テストは `src/app/api/__tests__/` に集約されており route.ts と非混在）。
- トップレベルドメイン数: **107**（`find src/app/api -mindepth 1 -maxdepth 1 -type d` 実測、`__tests__` 除く）。
- ハンドラ数上位: `patients` 44 / `admin` 36 / `dashboard` 14 / `me` 11 / `pharmacy-drug-stocks` 10 / `care-reports` 10 / `visit-schedules` 9 / `visit-records` 9 / `communications` 8。
- 主要ドメイン群（ディレクトリ名から）: 患者・処方（patients, prescriptions-*, medication-*, residual-medications）、調剤・監査（dispense-*, set-*, audit-logs）、訪問（visits, visit-*）、請求（billing-*, pharmacy-invoices）、多職種連携（communications, communication-*, conference-notes, external-access, referrals, patient-share-cases）、薬局間協力（pharmacy-partnerships, pharmacy-cooperation-*, partner-*）、マスタ（drug-masters, drug-master-imports, facilities, institutions…）、基盤（auth, health, jobs, meta, webhooks, platform, cds, files, push-subscription, presence, integration）。

## 6. proxy / middleware / instrumentation

- **`middleware.ts`: なし**（repo ルート・src とも不在）。`src/app/layout.tsx:36` のコメント「src/middleware.ts」は stale（実体は proxy.ts）。
- **`src/proxy.ts`**（Next.js 16 の Edge middleware 入口、`src/proxy.ts:12-23`）:
  1. API ルートの CSRF 保護（Origin/Referer 検証、`/api/jobs/*` は `x-api-key`=JOB_API_KEY のサーバー間例外、`src/proxy.ts:74-121`）
  2. API レート制限（ユーザーID優先・IP フォールバック、`/api/auth/callback/credentials` は厳格枠、`/api/health` は免除。store 不能時は 503 fail-closed、`src/proxy.ts:214-306`）
  3. 全ルートへ CSP nonce 生成 + セキュリティヘッダ（HSTS/X-Frame-Options 等、`src/proxy.ts:343-383`）
  4. **画面側の認証リダイレクト**: `PROTECTED_ROUTE_PREFIXES`（`/admin` `/patients` `/dispense` 等23 prefix、`src/proxy.ts:42-66`）に対しトークン無ければ `/login?callbackUrl=...` へ redirect（`src/proxy.ts:309-334`）。
  - matcher: `_next/static|_next/image|favicon.ico|icons/|manifest.json|sw.js|workbox-` 以外全部（`src/proxy.ts:385-391`）。
  - `PLAYWRIGHT=1`（E2E）時は API の CSRF/レート制限をスキップ（`src/proxy.ts:41,218`）。
- レート制限ストア: in-memory Map が既定、`RATE_LIMIT_STORE=dynamodb` + `RATE_LIMIT_DDB_TABLE_NAME` で **DynamoDB 分散カウンタ**に切替（`src/lib/api/rate-limit.ts:11,62-141`）。設定不備時は DenyAll（fail-closed）。→ 想定スタックの「DynamoDB レート制限」は**実在（opt-in 構成）**。
- **`src/instrumentation.ts`**: Sentry 初期化（nodejs/edge 別 config）+ 本番 env 安全性アサート + **ランタイム TZ=JST 検証**（非JSTなら Sentry warning、本番+ENFORCE_APP_TZ で fail fast）。`onRequestError = Sentry.captureRequestError`。
- **`src/instrumentation-client.ts`**: クライアント Sentry（PHI 対策で maskAllText/blockAllMedia、URL クエリ除去、redaction sanitizer）。

## 7. 認証必須/公開の構造まとめ

判定は3箇所に分散:

1. **Edge (proxy.ts)**: prefix リストによる画面リダイレクト + API 横断ガード（CSRF/rate limit）。prefix リストは `(dashboard)` 配下のページ集合を手動ミラーしたもので、**新ページ追加時に proxy.ts の追随が必要**（例: `/statistics` `/views` `/clerk-support` `/offline-sync` `/select-mode` `/select-site` は `(dashboard)` 内だが PROTECTED_ROUTE_PREFIXES に**含まれていない** → Edge リダイレクトは掛からず、layout の `unauthorized()` のみで保護。挙動差あり）。
2. **Server layout**: `(dashboard)/layout.tsx`（org 所属）と `platform/layout.tsx`（PlatformOperator）が実質の認可 gate。
3. **公開面**: `(auth)`・`(legal)`・`/shared/[token]`・`/offline`・`/dashboard-preview`（前掲の通り preview は gate なし）。

## 8. 想定スタックとの差分（本調査スコープ内）

| 想定 | 実際 |
| --- | --- |
| `middleware.ts` | なし。Next 16 `src/proxy.ts` に統合（コメントで middleware.ts 削除を明記） |
| DynamoDB レート制限 | 実在。ただし既定は in-memory、`RATE_LIMIT_STORE=dynamodb` で有効化（`src/lib/api/rate-limit.ts:129`） |
| Cognito + NextAuth | 構造上整合（login page が `next-auth/react signIn` + Cognito challenge、proxy が `next-auth/jwt getToken`）。詳細は認証編の別レポート担当 |
| parallel/intercepting routes | 未使用（0件） |
| standalone output / Serwist / S3 / SES / CloudWatch / ECS 資産 / モジュール境界チェック | 本レポートのスコープ外（app router 構造のみ）。未確認 |
