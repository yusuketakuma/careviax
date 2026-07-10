# Phase0 Recon 08: インフラ・監視・ゲート

調査日: 2026-07-11 / 調査者: Phase0 recon agent

読み取り専用調査。コマンド実行を伴うゲート（lint/test/build 等）の green/red 状態は一切実行しておらず「未実行・未確認」。バージョンは `package.json` / `pnpm-lock.yaml` の実値。

---

## 1. S3 ファイル処理

実装本体: `src/server/services/file-storage.ts`（`@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` の `getSignedUrl` を使用、同ファイル冒頭 import）。

### アップロードフロー（presigned URL 方式）

1. `createPresignedUpload()`（`src/server/services/file-storage.ts:1302`）— クライアントは `/api/files/presigned-upload` を叩き、PutObject 用 presigned URL を取得。有効期限 5 分（`UPLOAD_EXPIRY_SECONDS = 60 * 5`、同:25）。
2. クライアントが S3 へ直接 PUT。
3. `/api/files/complete` → `completeUploadedFile()`（同:1656）で HeadObject 検証しメタデータを `uploaded` に確定。
4. ダウンロードは `/api/files/:id/download`（ストリーム、`createStreamedDownload()` 同:1861）または `/api/files/:id/presigned-download`（`createPresignedDownload()` 同:1739、有効期限 15 分 `DOWNLOAD_EXPIRY_SECONDS = 60 * 15` 同:26）。
- これら 4 API ルートはルートカタログにも登録済み（`src/lib/api/rate-limit.ts:651-654`）。
- ファイルメタデータは専用テーブルではなく設定行（`FILE_SETTING_PREFIX = 'file_asset:'`、file-storage.ts:24）として DB 管理。org_id・purpose・patientId 等を保持し、role ベースのアクセス制御（`hasPermission` / visit-schedule access 判定）を通す。

### 制約・用途

- purpose: `prescription` / `visit-photo` / `report` / `set-photo` / `consent-document` / `contract-document`（+生成系 `bulk-export`）（file-storage.ts:58-66）。
- サイズ上限: 画像 10MB / 文書 50MB（同:28-29）。MIME allowlist: jpeg/png/webp/pdf（同:35-37）。
- 生成ファイル保持: bulk-export 既定 72 時間、contract-document 既定 7 年（同:30-31、env で調整可）。期限切れ削除は `cleanupExpiredGeneratedFiles()`（同:1532）。

### Object Lock

- 処方箋（purpose=`prescription`）のみ、アップロード時にオブジェクト単位で **COMPLIANCE モード 5 年保持** を付与: `buildPrescriptionObjectLockRetention()`（file-storage.ts:464-474、`PRESCRIPTION_OBJECT_LOCK_YEARS = 5` 同:27）→ PutObject に `ObjectLockMode` / `ObjectLockRetainUntilDate` を設定（同:1330-1331）。
- インフラ定義: `tools/infra/prescription-object-lock.json` — バケット `ph-os-files`、`ObjectLockEnabled: Enabled`、バケット既定保持（DefaultRetention）は**意図的に null**（bulk-export 等の一時ファイルをライフサイクル削除可能に保つため。同ファイル note に明記）。
- 関連 env: `S3_BUCKET_NAME` / `S3_BUCKET_REGION` / `S3_OBJECT_LOCK_BUCKET_NAME` / `S3_KMS_KEY_ID`（PHI/REPORT/EXPORT 別キーあり）/ `S3_SERVER_SIDE_ENCRYPTION`（コード内 `process.env` 参照より）。

## 2. SES メール導線

- 送信基盤: `src/server/services/email.ts` — `SESClient` + `SendEmailCommand`、リージョン既定 `ap-northeast-1`、`SES_FROM_EMAIL` 未設定なら throw（同:29-32）。
- `sendEmail` の呼び出し元はリポジトリ全体で **`src/server/services/report-delivery.ts` の 1 系統のみ**（grep で他呼び出しなし）。`sendCareReportEmail()`（report-delivery.ts:51）が報告書（ケア/薬学的管理報告書）送付メールを組み立て、`/api/care-reports/[id]/send`（`src/app/api/care-reports/[id]/send/route.ts`）から使用。
- メール本文: 件名/導入文/PDF リンク行/フッター（ラベルテンプレート置換）。**PDF は添付ではなくリンク**。リンクは `isExternalShareableUrl()`（report-delivery.ts:22-30）で「https かつ設定済みアプリオリジンと同一 origin、クエリ/認証情報なし」の場合のみ載る。条件を満たさなければリンクなしで送信。
- リンク到達画面: `pdf_url`（report の DB カラム）が指す先。外部閲覧系ページとしては `src/app/shared/[token]/shared-viewer-content.tsx`（トークン制外部共有ビューア）と `src/app/(dashboard)/external/external-viewer-content.tsx` が存在。`pdf_url` がどちらを指すか（あるいは `/api/care-reports/:id/pdf` 直リンクか）は**未確認**。
- CLAUDE.md の「報告書PDF添付」記述は実装と不一致（添付ではなくリンク方式）。招待メール等の他メール導線は現状コード上に存在しない（未実装）。

## 3. レート制限 — DynamoDB 方式は実在

`src/lib/api/rate-limit.ts` に完結。ユーザー想定どおり **DynamoDB バックエンドの分散レート制限が実装済み**。

- 既定はプロセス内メモリの fixed window（同:10-11, 67, 106-114）。
- `RATE_LIMIT_STORE=dynamodb` + `RATE_LIMIT_DDB_TABLE_NAME` + 認証情報ソースで `DynamoRateLimitStore` に切替（同:128-144, 338-432）。AWS SDK ではなく **SigV4 手署名 + fetch で UpdateItem（ADD hit_count）** を直接叩く実装（`@/lib/aws/sigv4`、同:368-386）。ECS コンテナ認証情報（169.254.170.2）/静的キー両対応（同:146-187）。
- fail-closed 設計: production で DynamoDB 未設定なら `DenyAllRateLimitStore`（全 API 拒否、同:444-452）。production で DynamoDB 障害時も deny（`store_unavailable`、同:404-419）。非 production のみメモリへフォールバック。
- 予算: read 300/分、write 60/分、auth 5/分（同:25-38）。feature 限定リミッタ（search 120 / mutation 60、env 調整・kill switch あり、同:1012-1047）。SSE 同時接続は 10/ユーザーのゲージ（同:1126-1158）。
- 適用点: `src/proxy.ts:263-264`（proxy で `checkAuthRateLimit` / `checkRateLimit`）+ 各ルートの feature limiter。キーはルートテンプレート正規化（`API_ROUTE_TEMPLATES`、rate-limit.ts:477-880）。
- インフラ資産: `tools/infra/rate-limit-dynamodb.json`（テーブル/TTL/IAM 契約）、検証スクリプト `tools/scripts/verify-rate-limit-dynamodb.ts`（`pnpm rate-limit:ddb:verify`）。
- 別系統: PHOS Lambda backend 用の DynamoDB（`PHOS_DYNAMODB_TABLE_NAME`、`src/phos/backend/*`、`src/phos/infra/dynamodb-table-contract.test.ts`）はレート制限とは別用途。
- なお ElastiCache/Redis 資産（`tools/infra/elasticache/`、dep `ioredis@^5.11.1`、env `REDIS_URL`）も存在するが、レート制限ストアは memory/dynamodb の 2 択（rate-limit.ts に redis 分岐なし）。

## 4. 監視・メトリクス・ログ・PHI ガード

### CloudWatch カスタムメトリクス（実在）

- `src/lib/aws/cloudwatch.ts` — `PutMetricDataCommand`、Namespace `PH-OS/Application`、1000 件バッチ、失敗は握りつぶし（リクエスト経路を壊さない）。
- 発行元: `src/server/jobs/runner.ts`（ジョブ実行）、`src/lib/utils/performance.ts`（ルート性能）、`src/server/services/pilot-readiness.ts`、`src/phos/backend/{observability,lambda-observability}.ts` ほか。
- アラーム定義: `tools/infra/cloudwatch-alarms.json` に **18 alarm**（`ph-os-api-health-down`, `ph-os-api-5xx-rate`, `ph-os-route-p99-latency-high`, `ph-os-payload-budget-over-routes`, `ph-os-tenant-boundary-rejected`, `ph-os-cross-tenant-attempt`, `ph-os-rate-limit-unavailable`, `ph-os-rds-cpu-high`, `ph-os-job-execution-failed` 等）。生成/検証コード `tools/infra/cloudwatch-alarms.ts` + test あり。

### Sentry（実在、PHI サニタイズ付き）

- `@sentry/nextjs 10.60.0`（pnpm-lock.yaml 実値）。設定: `sentry.server.config.ts` / `sentry.edge.config.ts` / `src/instrumentation-client.ts` / `src/instrumentation.ts`。`next.config.ts` で `withSentryConfig` ラップ。
- `enabled: NODE_ENV === 'production'` のみ。server 側 `beforeSend` で cookies 全消去・request.data `[REDACTED]`・ヘッダ allowlist（content-type / x-request-id / x-trace-id / user-agent のみ）（sentry.server.config.ts:16-35）。client 側は Replay `maskAllText: true` / `blockAllMedia: true`、URL クエリ除去、`sanitizeSentryEvent` / `sanitizeSentryBreadcrumb`（instrumentation-client.ts:25-50）。

### PHI ログガード（実在）

- `pnpm client-phi-log:check` → `tools/scripts/check-client-phi-log.mjs`。`console.*` へ生 Error / `.message` / `.stack` / `String(error)` / テンプレート補間を直接渡すコードを検出（PHI 漏洩防止）。例外は `tools/client-phi-log-allowlist.json` に理由付き登録（expectedCount ratchet 方式）。安全な出力は `clientLog`（`src/lib/utils/client-log.ts`）へ誘導。
- サーバ側は構造化 `logger`（`src/lib/utils/logger`、file-storage.ts 等で使用）。rate-limit の失敗ログも error name のみに絞る実装（rate-limit.ts:317-336）。

## 5. デプロイ方式の実際

**Amplify Hosting は実体なし（CLAUDE.md の記述は stale）。実体は Docker コンテナ + ECR で、Lightsail(pilot) → ECS Express(本番最小) の段階計画。**

- `next.config.ts` に `output: 'standalone'`（→ §6）。ルートに `Dockerfile` 実在。
- Amplify への参照はコード中コメント 1 箇所のみ（`src/proxy.ts:79` の env 説明コメント）。Amplify 設定ファイル（amplify.yml 等）は不在。
- GitHub Actions: `.github/workflows/aws-container-image.yml` — workflow_dispatch で ECR（既定 repo `ph-os/app`、ap-northeast-1、OIDC `id-token: write`、environment: production）へイメージ build & push。`NEXT_PUBLIC_*` をビルド時凍結。
- 段階計画 ADR: `docs/architecture/aws-phos-deployment-stages.md`（2026-07-06 accepted）。Stage1 = Lightsail VM + Lightsail PostgreSQL + S3/Cognito/SES/CloudWatch/DynamoDB レート制限/ECR/Route53/ACM（月額 $46.60 見積）、Stage2 = ECS Express/Fargate + ALB + RDS、Stage3 = scale-out（Multi-AZ, WAF, GuardDuty 等）。関連: `docs/operations/aws-cost-minimal-deployment.md`。
- 計画資産（**非実行のプランジェネレータ/バリデータ**）: `tools/scripts/aws-lightsail-pilot-plan.ts`、`aws-ecs-express-plan.ts`、各種 `aws:*:validate` スクリプト（package.json scripts 参照）。テンプレート: `tools/infra/lightsail-pilot-template.yaml`、`ecs-express-roles-template.yaml`、`ecr-repository-template.yaml`、`github-actions-ecr-oidc-role-template.yaml`、`rds-aws-backup-template.yaml` ほか（`tools/infra/README.md` に一覧）。
- 別系統として PHOS Lambda backend（`src/phos/backend/*`、`src/phos/infra/api-gateway-lambda-template.ts`、`pnpm phos:lambda-artifact:build` / `phos:deploy-template:validate`）が存在し、CI でも artifact 検証を実施（ci.yml「PH-OS deploy artifact proof」）。
- **実際に AWS 上へデプロイ済みかどうか（live 環境の有無）は本調査では未確認**（read-only 方針のため live AWS 照会は行っていない）。

## 6. standalone output

実在: `next.config.ts` に `output: 'standalone'`（同ファイル 11 行目付近）。ビルドは webpack 固定（`pnpm build` = `next build --webpack`、React Compiler は Babel 版。next.config.ts コメント参照）。PWA は Serwist 実在（`withSerwistInit`、`swSrc: 'src/app/sw.ts'` → `public/sw.js`、非 production と `PLAYWRIGHT=1` で無効化）。

## 7. 環境変数

- `.env.example` はリポジトリルートに実在（`ls` で確認）。ただし内容は runtime guard（RUNTIME_FLOOR:secret-read が `.env` パターンで発火）により**読み取り不可 → 内容未確認**。
- 代替としてコード中の `process.env.*` 参照（src/ + tools/scripts/ 全 grep、約 180 キー）から主要カテゴリを記録:
  - DB/RLS: `DATABASE_URL`, `DIRECT_URL`(prisma), `DATABASE_POOL_SIZE`, `RLS_PROOF_{ADMIN_,}DATABASE_URL`
  - 認証: `NEXTAUTH_SECRET/URL`, `AUTH_SECRET`, `NEXT_PUBLIC_COGNITO_USER_POOL_ID/CLIENT_ID`, `COGNITO_CLIENT_SECRET`, `MFA_RECOVERY_SECRET`, `ALLOW_LOCAL_AUTH_FALLBACK`, `ALLOW_LOCAL_DEMO_PASSWORD_LOGIN`
  - AWS 基盤: `AWS_REGION/ACCESS_KEY_ID/SECRET_ACCESS_KEY/SESSION_TOKEN`, ECS コンテナ認証系, `SECRETS_MANAGER_*`
  - S3: `S3_BUCKET_NAME/REGION`, `S3_OBJECT_LOCK_BUCKET_NAME/REGION`, `S3_KMS_KEY_ID{,_PHI,_REPORT,_EXPORT}`, `S3_SERVER_SIDE_ENCRYPTION`, `AUDIT_LOG_ARCHIVE_BUCKET_*`
  - SES/通知: `SES_FROM_EMAIL`, `VAPID_PRIVATE_KEY/SUBJECT`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `TWILIO_*`(SMS), `LINE_CHANNEL_ACCESS_TOKEN`
  - レート制限: `RATE_LIMIT_STORE`, `RATE_LIMIT_DDB_TABLE_NAME/REGION/TIMEOUT_MS`, `RATE_LIMIT_FEATURE_*`
  - 秘密鍵系: `ENCRYPTION_KEY`, `JWT_SIGNING_SECRET`, `EXTERNAL_ACCESS_TOKEN_SECRET`, `WEBHOOK_SECRET_ENCRYPTION_KEY`, 各種 `*_IDEMPOTENCY_HASH_SECRET`, `QR_DRAFT_HASH_SECRET`
  - 外部連携: `EPRESCRIPTION_*`, `OQC_*`, `RECECOM_CLAIMS_*`, `YRESE_WEBHOOK_SECRET`, `GOOGLE_MAPS_*`, `ROUTING_API_*`, `PATIENT_MCS_AI_*`, `VISIT_BRIEF_AI_*`
  - PHOS Lambda 系: `PHOS_DYNAMODB_TABLE_NAME`, `PHOS_EVIDENCE_BUCKET*`, `PHOS_AURORA_*`, `PHOS_API_BASE_URL` ほか
  - 監視: `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_ORG/PROJECT`(next.config.ts), `REDIS_URL`

## 8. E2E テスト構成

- テスト置き場: `tools/tests/`（27 エントリ）。`e2e-*`（auth-flow / billing-flow / billing-pca-prescription-guardrails / prescription-dispensing-flow / schedule-vehicle-resource-constraints）+ 多数の `ui-*`（mobile-layout, design-fidelity, visual-regression + snapshots ディレクトリ, layout-screenshot-audit, major-screens 等）。`@axe-core/playwright` が devDep（a11y 検査）。
- 設定 3 種:
  - `playwright.config.ts` — testDir `tools/tests`、projects: chromium + Mobile Chrome(Pixel 5)、webServer が `pnpm build && pnpm start`（port 3000、`PLAYWRIGHT=1`）。
  - `playwright.local.config.ts` — `pnpm test:e2e:local`。port **3012**、`PLAYWRIGHT_REUSE_SERVER=1`。
  - `playwright.audit.config.ts` — `pnpm test:e2e:audit`。
- ローカル DB: **localhost:5433** の `ph_os_e2e`（接続 `postgresql://ph_os:ph_os@localhost:5433/ph_os_e2e`、package.json の `dev:e2e:local` / `db:e2e:*` scripts に直書き）。準備は `pnpm db:e2e:prepare` → `tools/scripts/prepare-e2e-db.ts`（migrate deploy 相当。`db:e2e:push` は RLS/監査トリガをスキップするため**廃止済み・実行するとエラー終了**）。seed は `pnpm db:e2e:seed` → `prisma/seed.ts`（実在確認済み）。
- 複合ゲート: `pnpm medical-ui:e2e:gate`（preflight → DB 整合チェック 3 種 → targeted UI/E2E 6 spec）。
- CI（`.github/workflows/ci.yml`）でも Playwright を install して E2E 実行（ci.yml:317 付近）+ TZ 3 種（Asia/Tokyo, UTC, America/Los_Angeles）での schedule-time 回帰テスト。

## 9. Objective gate 一覧（状態は全て未実行・未確認）

package.json scripts より。CI（ci.yml）は下記のほぼ全てを実行する構成。

| 種別 | コマンド | 実体 |
| --- | --- | --- |
| Lint | `pnpm lint` | eslint flat config |
| 型 | `pnpm typecheck` | next typegen + tsc + tsconfig.sw.json |
| 型(strict) | `pnpm typecheck:no-unused` | noUnusedLocals/Parameters（CI では NODE_OPTIONS=16GB） |
| 整形 | `pnpm format:check` | `tools/scripts/check-format-changed-files.mjs` |
| Unit | `pnpm test` / `test:coverage` | vitest 4.1.9 |
| Build | `pnpm build` | next build --webpack（8GB heap） |
| E2E | `pnpm test:e2e` / `test:e2e:local` / `test:e2e:audit` | Playwright 1.60.0 |
| 境界 | `pnpm boundaries:check` | `check-module-boundaries.mjs`（共通コア→薬局固有 import 禁止の ratchet + `tools/module-boundary-allowlist.json`）— **想定どおり実在** |
| PHI ログ | `pnpm client-phi-log:check` | `check-client-phi-log.mjs`（§4） |
| API 形状 | `pnpm api-response-shape:check` / `client-json-schema:check` / `dto-direct-prisma-return:check` | 各 check-*.mjs |
| 認可 | `pnpm route-auth-wrapper:check` | route の auth wrapper 強制 |
| RLS | `pnpm rls-policy-contract:check` / `test:rls-proof` | vitest 契約テスト / 実 DB proof |
| DB 読取 | `pnpm db:query-shape:check` / `db:raw-read-org-guard:check` / `db:read-slo:check` | 各 check-*.mjs |
| その他 | `date-slices:check` / `colors:check` / `task-types:check` / `plans:active:check` / `eventbridge-schedules:check` / `frontend-contract:check` | 各 check-*.mjs |
| CI 限定 | `pnpm audit --audit-level moderate`, `phos:deploy-template:validate:artifact`, TZ 回帰 | ci.yml |

補足規律（CLAUDE.md/メモリ準拠、本調査では検証せず記録のみ）: `pnpm build` と typecheck 系の並列実行禁止（`.next/types` race）。

## 10. 実バージョン（pnpm-lock.yaml 解決値）

next 16.2.9 / react・react-dom 19.2.7 / typescript 6.0.3 / prisma・@prisma/client 7.8.0 / tailwindcss 4.3.0 / zod 4.4.3 / vitest 4.1.9 / serwist 9.5.11 / dexie 4.4.3 / zustand 5.0.14 / next-auth 4.24.14 / @sentry/nextjs 10.60.0 / @playwright/test 1.60.0。packageManager `pnpm@11.5.2`、engines.node `24.16.0`。

## 11. 想定スタックとの差分判定まとめ

| 想定 | 判定 | 根拠 |
| --- | --- | --- |
| Cognito + NextAuth | **実在** | next-auth 4.24.14、`@aws-sdk/client-cognito-identity-provider` dep、`NEXT_PUBLIC_COGNITO_*` env、CI env に Cognito 変数 |
| Serwist (PWA) | **実在** | next.config.ts `withSerwistInit`、`src/app/sw.ts` |
| S3 (presigned + Object Lock) | **実在** | §1（処方箋のみ per-object COMPLIANCE 5 年、バケット DefaultRetention は意図的に無し） |
| SES | **実在（縮小）** | 送信導線は報告書送付メール 1 系統のみ。PDF は添付でなく同一オリジン https リンク（§2） |
| DynamoDB レート制限 | **実在** | `src/lib/api/rate-limit.ts` + `tools/infra/rate-limit-dynamodb.json`、prod fail-closed（§3） |
| CloudWatch metrics | **実在** | `src/lib/aws/cloudwatch.ts`（Namespace PH-OS/Application）+ alarm 18 本（§4） |
| ECS/Lightsail 計画資産 | **実在（計画段階）** | ADR + 非実行プランジェネレータ/テンプレート群。live デプロイ有無は未確認（§5） |
| Amplify Hosting（CLAUDE.md 記載） | **不在（別方式）** | Docker/ECR + Lightsail→ECS 段階計画。Amplify はコメント言及のみ（§5） |
| standalone output | **実在** | next.config.ts（§6） |
| モジュール境界チェック | **実在** | `boundaries:check` = ratchet 型ガード（§9） |
| PHI ログガード (client-phi-log:check) | **実在** | §4 |
| 想定外の追加要素 | — | PHOS Lambda backend 別系統（src/phos）、Sentry PHI sanitize、web-push(VAPID)/Twilio SMS/LINE 導線、ioredis+ElastiCache 資産、Google Maps/Routes |
