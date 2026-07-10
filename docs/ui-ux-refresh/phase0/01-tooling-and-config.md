# Phase0 Recon 01 — Tooling & Config

調査日: 2026-07-11 / 調査者: Phase0 recon agent

対象リポジトリ: `/Users/yusuke/workspace/careviax`（package name: `ph-os`, version 0.1.0, private）。
すべての行番号は調査時点（git branch `main`, working tree に一部未コミット変更あり）のもの。

---

## 1. パッケージマネージャ / ランタイム

| 項目 | 値 | 根拠 |
| --- | --- | --- |
| packageManager | `pnpm@11.5.2` | `package.json:5` |
| engines.node | `24.16.0` | `package.json:6-8` |
| ローカル実測 | node v24.16.0 / pnpm 11.5.2 | コマンド実行で確認 |
| CI の Node/pnpm | `NODE_VERSION: '24.16.0'` / `PNPM_VERSION: '11.5.2'` | `.github/workflows/ci.yml:17-19` |

`pnpm-workspace.yaml` はワークスペース定義ではなく **overrides / allowBuilds / minimumReleaseAgeExclude のみ**（単一パッケージ構成）。セキュリティpin（`fast-xml-parser: 5.8.0`, `uuid: 14.0.0`, `esbuild: 0.28.1`, `vite: ^8.0.5` 等）と、ビルドスクリプト許可（prisma/esbuild は true、`@sentry/cli`/sharp は false）を管理（`pnpm-workspace.yaml:1-31`）。

---

## 2. 主要依存バージョン（pnpm-lock.yaml の解決済み実値）

### dependencies（抜粋）

| パッケージ | package.json 指定 | lockfile 実値 |
| --- | --- | --- |
| next | `16.2.9`（exact, `package.json:149`） | 16.2.9 |
| react / react-dom | `19.2.7`（exact） | 19.2.7 |
| next-auth | `4.24.14`（exact） | 4.24.14 |
| @prisma/client / prisma | `^7.8.0` | 7.8.0 |
| @prisma/adapter-pg | `^7.8.0` | 7.8.0 |
| pg | `^8.21.0`（`package.json:152`） | 未確認（lock抽出せず） |
| zod | `^4.4.3` | 4.4.3（依存経由で 4.4.1 も併存） |
| @tanstack/react-query | `^5.101.0` | 5.101.0 |
| @tanstack/react-table | `^8.21.3`（`package.json:134`） | 未確認 |
| zustand | `^5.0.14` | 5.0.14 |
| @serwist/next / serwist | `^9.5.11` | 9.5.11 |
| dexie | `^4.4.3` | 4.4.3 |
| @sentry/nextjs | `^10.60.0` | 10.60.0 |
| date-fns | `^4.4.0` | 4.4.0 |
| lucide-react | `^1.17.0` | 1.17.0 |
| recharts | `^3.8.1` | 3.8.1 |
| @base-ui/react | `^1.5.0`（`package.json:124`） | 1.5.0 |
| AWS SDK v3 各クライアント | `^3.1065.0`（backup のみ `^3.1079.0`） | 3.1065.0（cloudwatch/cognito/dynamodb/s3/ses 確認済み） |
| その他 | `@react-pdf/renderer ^4.5.1`, `exceljs ^4.4.0`, `ioredis ^5.11.1`, `web-push ^3.6.7`, `sonner ^2.0.7`, `next-themes ^0.4.6`, `@vis.gl/react-google-maps ^1.8.3`, `@zxing/browser ^0.2.0`, `aws-xray-sdk-core ^3.12.0`, `bcryptjs ^3.0.3` | lockfile 実値は未確認 |

### devDependencies（抜粋）

| パッケージ | package.json 指定 | lockfile 実値 |
| --- | --- | --- |
| typescript | `^6.0.3` | 6.0.3 |
| eslint / eslint-config-next | `^9.39.4` / `16.2.9` | 9.39.4 / （config-next 未確認） |
| prettier | `^3.8.4` | 3.8.4 |
| vitest / @vitest/coverage-v8 | `^4.1.9` | 4.1.9 |
| @playwright/test | `^1.60.0` | 1.60.0 |
| @axe-core/playwright | `^4.11.3` | 未確認 |
| tailwindcss / @tailwindcss/postcss | `^4.3.0` | 4.3.0 |
| babel-plugin-react-compiler | `^1.0.0` | 1.0.0（lock の next peers に出現） |
| @testing-library/react | `^16.3.2` | 未確認 |
| jsdom / fake-indexeddb | `^29.1.1` / `^6.2.5` | 未確認 |
| tsx | `^4.22.4` | 4.22.4（lock の vitest peers に出現） |

注: CLAUDE.md 記載の `@zxing/browser@0.1.5` は実際には `^0.2.0`（`package.json:136`）。CLAUDE.md 側が stale。

---

## 3. next.config.ts（`next.config.ts:1-46`）

- **`output: 'standalone'` — 実在**（`next.config.ts:11`）。想定どおり。
- **`reactCompiler: true`**（Babel ベース、`next.config.ts:16`）。`experimental.turbopackRustReactCompiler` は意図的に不使用（webpack build 前提のため。コメント `next.config.ts:12-15`、参照 `docs/design/react-compiler-decision.md`）。
- experimental フラグ: `authInterrupts: true` / `preloadEntriesOnStart: false` / `webpackMemoryOptimizations: true` / `optimizePackageImports: ['lucide-react','date-fns','recharts']`（`next.config.ts:17-22`）。
- `serverExternalPackages: ['@react-pdf/renderer']`（`next.config.ts:23`）。
- **PWA（Serwist）統合 — 実在**: `withSerwistInit`（`swSrc: 'src/app/sw.ts'`, `swDest: 'public/sw.js'`）。本番以外・`PLAYWRIGHT=1` 時は無効化（`next.config.ts:26-32`）。
- **Sentry 統合**: `withSentryConfig` でラップ。sourcemaps は本番のみ、`reactComponentAnnotation` 有効（`next.config.ts:34-46`）。
- セキュリティヘッダ/CSP は静的設定せず `src/proxy.ts` で per-request nonce により動的付与（コメント `next.config.ts:5-7`）。
- ビルドは webpack 固定: `pnpm build` = `next build --webpack`（node heap 8GB, `package.json:14`）。`pnpm dev` は Turbopack（`package.json:10`）、E2E ローカル dev は webpack（`package.json:11`）。

---

## 4. TypeScript 設定

### tsconfig.json（`tsconfig.json`）

- `strict: true`（:7）、`allowJs: false`（:5）、`skipLibCheck: true`（:6）、`target: ES2017`（:3）、`moduleResolution: bundler`（:11）、`jsx: react-jsx`（:14）、`incremental: true`（:15）、next plugin（:16-20）。
- paths: `@/* → ./src/*`（:21-23）。
- exclude: `node_modules`, `agmsg`, `src/app/sw.ts`（:33）— Service Worker は本体 tsconfig から除外。

### tsconfig.sw.json（`tsconfig.sw.json`）

- Service Worker 専用。base を extend し `lib: ["webworker","esnext"]`, `types: []`、include は `src/app/sw.ts` と `src/lib/offline/sw-cache-policy.ts` のみ。
- `pnpm typecheck` は `next typegen && tsc --noEmit && tsc -p tsconfig.sw.json` の 2 本立て（`package.json:19`）。
- `pnpm typecheck:no-unused` は `--noUnusedLocals --noUnusedParameters` 付きの別実行（両 tsconfig、`package.json:20`）。CI では `NODE_OPTIONS=--max-old-space-size=16384` 付き（`ci.yml:105-106`）。

---

## 5. ESLint / Prettier

- **flat config**: `eslint.config.mjs`。`eslint-config-next/core-web-vitals` + `eslint-config-next/typescript` のみで、**カスタムルールは無し**（`eslint.config.mjs:5-31`）。globalIgnores に `.next`, `artifacts`, `agmsg`, `.harness-worktrees`, `public/sw.js` 等。
- **モジュール境界チェックは ESLint ではなく専用スクリプト** `tools/scripts/check-module-boundaries.mjs`（後述 §9）。
- Prettier: `.prettierrc` = semi/singleQuote/trailingComma:all/printWidth 100/tabWidth 2。`.prettierignore` に `.codex/` 生成物と `docs/security/rls-gap-ledger.md`（生成物とのバイト一致維持のため。理由コメントあり）。
- `pnpm format` は git ls-files ベースの全体 write、`pnpm format:check` は **変更ファイルのみ** をチェックするカスタムスクリプト `tools/scripts/check-format-changed-files.mjs`（`package.json:95-96`）。
- git hook: `tools/git-hooks/pre-commit`（opt-in、`pnpm hooks:install` で有効化）。staged ファイルのみ eslint `--max-warnings=0` + prettier --check。typecheck/build は意図的に含めない（hook 冒頭コメント）。

---

## 6. Vitest（`vitest.config.ts`）

- environment: `node`（グローバル既定。DOM テストはファイル単位の環境指定と推測 — 未確認）、`globals: true`、`maxWorkers: 4`。
- include: `src/**/*.test.ts(x)` + `tools/infra/**/*.test.ts` + `tools/scripts/**/*.test.ts` — **infra テンプレートや check スクリプト自体もユニットテスト対象**。
- coverage(v8): 対象 `src/app/api/**`, `src/server/**`, `src/lib/**`。**閾値 enforced**: statements 80 / branches 66 / lines 80 / functions 75（`vitest.config.ts:20-26`）。
- alias: `@ → src`、`server-only → src/test/server-only-stub.ts`。

---

## 7. Playwright（3 config 構成）

| config | 役割 | 要点 |
| --- | --- | --- |
| `playwright.config.ts` | CI/フル。`pnpm test:e2e` | testDir `tools/tests`、webServer が **build+start を自前実行**（port 3000）、chromium + Pixel 5、CI: retries 2 / workers 4 |
| `playwright.local.config.ts` | ローカル E2E DB(5433) 向け。`pnpm test:e2e:local` | port 3012 既存サーバ前提（`PLAYWRIGHT_REUSE_SERVER=1`）、workers 1・直列、timeout 240s |
| `playwright.audit.config.ts` | 監査用。`pnpm test:e2e:audit` | local config を extend し JSON/HTML レポート追加、firefox/webkit は `ui-browser-matrix-smoke` のみ、Pixel 7 は `ui-audit-extensions` のみ |

E2E ローカル DB は 5433（brew postgresql@18 / CI では postgres:17 サービス）。`db:e2e:push` は **意図的に deprecated**（raw SQL migration / RLS / audit trigger をスキップするため。`package.json:85`）→ `db:e2e:prepare` を使う。

---

## 8. CI（`.github/workflows/`）

### ci.yml（424行, push/PR to main）

1. **ci ジョブ**: pnpm audit → lint → format:check → **カスタム ratchet チェック群 15 本**（date-slices / colors / boundaries / api-response-shape / client-json-schema / plans:active / db:query-shape / db:read-slo / frontend-contract / client-phi-log / dto-direct-prisma-return / route-auth-wrapper / task-types / rls-policy-contract / eventbridge-schedules）→ typecheck → typecheck:no-unused（heap 16GB）→ test:coverage → **TZ 3種（Asia/Tokyo, UTC, America/Los_Angeles）での schedule-time 回帰テスト**（`ci.yml:120-125`）→ `phos:deploy-template:validate:artifact`（Lambda アーティファクト証明）→ build。
2. **migration-gate**: postgres:17 サービス（5434）に `prisma migrate deploy` を実行し `db:verify-ph-os-audit-migration` で監査トリガ検証。
3. **phos-aurora-rls-gate**: postgres:17（5435）で非スーパーユーザーロール（NOSUPERUSER NOBYPASSRLS）を作り **FORCE RLS がクロス org 行を拒否することを実証**（`src/lib/db/rls.test.ts`, `src/phos/infra/aurora-fee-rules-rls.integration.test.ts`）。
4. **medical-ui-e2e-gate**: postgres:17（5433）+ Playwright chromium で `medical-ui:e2e:gate:prod`（本番ビルド + preflight + DB 整合チェック + 対象 UI E2E）。
5. **preview-url**: PR に Amplify プレビュー URL をコメント（`AMPLIFY_APP_ID` secret 前提）。
6. **deploy-production**: main push 時、GitHub Environment `production`（**required reviewer 承認必須**）で `aws amplify start-job` → 完了ポーリング。デプロイ先は **AWS Amplify Hosting**。

### aws-container-image.yml（128行, workflow_dispatch のみ）

- ECR へのコンテナイメージ build & push（OIDC, `id-token: write`）。region/repo/tag/NEXT_PUBLIC_* を入力で受ける。ECS/Lightsail 展開用の手動パス。ルートに `Dockerfile` あり。

---

## 9. tools/scripts の check 系スクリプト一覧（何を守るか）

CI で全て実行される（§8-1）。各1行、根拠はスクリプト冒頭コメント。

- `check-api-response-shape.mjs` — 公開 API のレスポンス envelope 形状 ratchet（API-CONTRACT-001）。
- `check-client-json-schema.mjs` — フロントの `readApiJson` 呼び出しに zod スキーマ必須化する ratchet。
- `check-client-phi-log.mjs` — クライアント側ログ/計測に PHI が乗らないことのガード。
- `check-date-slices.mjs` — 日付処理の JST 境界分類（allowlist `tools/date-slice-allowlist.json` ベース）。
- `check-dto-direct-prisma-return.mjs` — route handler が Prisma オブジェクトを直接返さない DTO/presenter 境界 ratchet（API-DTO-001）。
- `check-eventbridge-schedule-drift.mjs` — `tools/infra/eventbridge-schedules.json` 定義とコードのドリフト検出。
- `check-format-changed-files.mjs` — 変更ファイル限定の prettier --check。
- `check-frontend-contract.mjs` — FRONTEND-CONTRACT-001 docs-first 契約の完全性 ratchet。
- `check-module-boundaries.mjs` — **モジュール境界チェック（実在）**: 共通コア→薬局固有の import 方向違反 + `src/core`/`src/modules/*` の禁止依存を検出（W0-3 / MOD-BOUND-001）。
- `check-plans-active-board.mjs` — Plans.md のアクティブボード形式 lint。
- `check-query-shape.mjs` — critical read path のクエリ形状ガード（`tools/query-shape-watchlist.json` 対象）。
- `check-raw-read-org-guard.mjs` — RLS を経由しない raw Prisma read の org スコープ強制ガード。
- `check-raw-state-colors.mjs` — 生 Tailwind 状態色ベタ書き禁止（state トークン SSOT 強制、FEUX-6）。
- `check-read-path-slo.mjs` — read path SLO 表（機械可読）の妥当性検証（PERF-DB-READ-SLO-001）。
- `check-route-auth-wrapper.mjs` — 新規/変更 API route の `withAuthContext` 使用 ratchet（CORE-ROUTE-001）。
- `check-task-type-registry.mjs` — task_type レジストリ経由の作成強制 ratchet。
- 加えて `rls-policy-contract:check` は vitest（`src/tools/rls-policy-contract.test.ts`）で RLS ポリシー台帳と実ポリシーの同期を検証（`package.json:108`）。

このほか tools/scripts には AWS 計画/検証（`aws-ecs-express-*`, `aws-lightsail-*`, `aws-rds-backup-*`, `aws-github-oidc-*`）、backfill、backup drill、perf-smoke、pilot レポート等が多数（各 `.ts` に対テスト `.test.ts` 同梱）。

---

## 10. 開発コマンド（実行可能な主要スクリプト）

- 開発: `pnpm dev`（Turbopack）/ `pnpm dev:e2e:local`（webpack, port 3012, E2E DB 5433）
- ビルド: `pnpm build`（webpack, heap 8GB）/ `pnpm build:e2e:local` / `pnpm start`
- 品質: `pnpm lint` / `pnpm typecheck` / `pnpm typecheck:no-unused` / `pnpm format` / `pnpm format:check`
- テスト: `pnpm test` / `pnpm test:coverage` / `pnpm test:watch` / `pnpm test:schedule-time:tz`（TZ 回帰用の明示ファイルリスト）/ `pnpm test:rls-proof`
- E2E: `pnpm test:e2e`（本番相当）/ `pnpm test:e2e:local`（reuse server）/ `pnpm test:e2e:audit` / `pnpm medical-ui:e2e:gate`（preflight+DB 整合+targeted）
- DB: `pnpm db:migrate` / `db:migrate:deploy` / `db:seed` / `db:generate`（+ `link-prisma-client.mjs`）/ `db:e2e:prepare`（`db:e2e:push` は禁止・エラー化）
- Prisma schema は **ディレクトリ分割**（`prisma/schema/` 配下に `patient.prisma`, `drug.prisma` 等ドメイン別、`--schema=prisma/schema/` 指定。`package.json:91-94`）
- 注: CLAUDE.md の `pnpm deploy`（Amplify deploy）というスクリプトは **package.json に存在しない**。デプロイは CI の deploy-production ジョブ経由。

---

## 11. 「想定スタック」との差分判定

| 想定 | 判定 | 根拠 |
| --- | --- | --- |
| Amazon Cognito + NextAuth | **実在** | `next-auth@4.24.14`（`package.json:150`）、`@aws-sdk/client-cognito-identity-provider@3.1065.0`、`src/lib/auth/cognito-challenge.ts` ほか、CI env に NEXTAUTH_*/COGNITO_* |
| Serwist (PWA) | **実在** | `@serwist/next@9.5.11` + `next.config.ts:26-32`（swSrc `src/app/sw.ts`）+ 専用 `tsconfig.sw.json` |
| S3 | **実在** | `@aws-sdk/client-s3@3.1065.0` + `@aws-sdk/s3-request-presigner`、infra に `file-storage-bucket-policy.json` / `prescription-object-lock.json` / `s3-kms-key-policy.json` |
| SES | **実在** | `@aws-sdk/client-ses@3.1065.0`（`package.json:121`） |
| DynamoDB レート制限 | **実在（opt-in）** | `src/lib/api/rate-limit.ts:129` — `RATE_LIMIT_STORE==='dynamodb'` で分散カウンタ、未設定時 in-memory fallback。検証 `tools/scripts/verify-rate-limit-dynamodb.ts` + `tools/infra/rate-limit-dynamodb.json` |
| CloudWatch metrics | **実在** | `src/lib/aws/cloudwatch.ts`、`src/server/services/flush-metrics-job.ts`、`tools/infra/cloudwatch-alarms.json/.ts` |
| ECS/Lightsail 計画資産 | **実在（計画/テンプレート段階）** | `tools/infra/ecs-express-*-template.yaml`, `lightsail-pilot-template.yaml` 等 + `aws:ecs-express:*` / `aws:lightsail:*` scripts + `aws-container-image.yml`（手動 dispatch）。**現行の本番デプロイパスは Amplify**（`ci.yml` deploy-production） |
| standalone output | **実在** | `next.config.ts:11` |
| モジュール境界チェック | **実在** | `tools/scripts/check-module-boundaries.mjs` + CI step（`ci.yml:62-63`）。ESLint ルールではなく専用 mjs |

追加の注目点（想定に無いが存在）:

- React Compiler 有効（`reactCompiler: true`）— 手動 useMemo 追加は lint 違反になりうる。
- UI プリミティブに **@base-ui/react 1.5.0** が dependencies に存在（shadcn/ui = Radix 系との併用状況はこの調査のスコープ外、未確認）。
- Sentry（@sentry/nextjs 10.60.0）+ OpenTelemetry instrumentation 0.218.0 + aws-xray-sdk-core。
- カバレッジ閾値・RLS 実証ゲート・TZ 3種回帰・15本の ratchet チェックなど、CI ゲートが非常に厚い。
- `zod@4.4.1` と `4.4.3` が lockfile に併存（直接依存は 4.4.3）。
