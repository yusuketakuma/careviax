# Repository Baseline — リポジトリ・ランタイム実態（Phase 0 統合）

調査日: 2026-07-11
詳細根拠: [phase0/01](phase0/01-tooling-and-config.md)〜[phase0/08](phase0/08-infra-and-gates.md)（recon ノート 8 本の統合。本文書は要約であり、行番号付き根拠は各ノートを正とする）

- [01 Tooling & Config](phase0/01-tooling-and-config.md)
- [02 App Router 構造](phase0/02-app-router-structure.md)
- [03 認証・権限モデル](phase0/03-auth-and-permissions.md)
- [04 データ層](phase0/04-data-layer.md)
- [05 クライアント状態管理](phase0/05-client-state.md)
- [06 デザインシステム](phase0/06-design-system.md)
- [07 オフライン / PWA](phase0/07-offline-and-pwa.md)
- [08 インフラ・監視・ゲート](phase0/08-infra-and-gates.md)

---

## 1. 実際の技術スタックとバージョン

lockfile（pnpm-lock.yaml）解決値ベース（[01 §2](phase0/01-tooling-and-config.md), [08 §10](phase0/08-infra-and-gates.md)）。

| 領域 | パッケージ | 実バージョン |
| --- | --- | --- |
| ランタイム | node / pnpm | 24.16.0 / 11.5.2 |
| Framework | next（App Router, webpack build, React Compiler=Babel 版有効） | 16.2.9 |
| UI | react / react-dom | 19.2.7 |
| 言語 | typescript | 6.0.3 |
| CSS | tailwindcss（v4 CSS-first, config ファイルなし） | 4.3.0 |
| UI primitive | @base-ui/react（**Radix ではない**。shadcn 系 UI の下地） | 1.5.0 |
| アイコン | lucide-react | 1.17.0 |
| Server state | @tanstack/react-query | 5.101.0 |
| Table | @tanstack/react-table | 8.21.3 |
| Client state | zustand | 5.0.14 |
| Form | react-hook-form / @hookform/resolvers | 7.78.0 / 5.4.0 |
| Validation | zod | 4.4.3 |
| ORM | prisma / @prisma/client（+ @prisma/adapter-pg, pg ^8.21.0） | 7.8.0 |
| 認証 | next-auth（**v4** 系）+ @aws-sdk/client-cognito-identity-provider | 4.24.14 / 3.1065.0 |
| PWA | @serwist/next / serwist | 9.5.11 |
| オフライン | dexie（IndexedDB） | 4.4.3 |
| 監視 | @sentry/nextjs（+ OpenTelemetry, aws-xray-sdk-core） | 10.60.0 |
| 日付 | date-fns | 4.4.0 |
| テスト | vitest / @playwright/test / @axe-core/playwright | 4.1.9 / 1.60.0 / ^4.11.3 |
| その他 | recharts 3.8.1, sonner ^2.0.7, next-themes 0.4.6, @react-pdf/renderer, exceljs, ioredis, web-push, @vis.gl/react-google-maps, @zxing/browser ^0.2.0 | — |

## 2. 想定スタックとの差分

ユーザー想定との照合（[01 §11](phase0/01-tooling-and-config.md), [08 §11](phase0/08-infra-and-gates.md) ほか）。

| 想定 | 判定 | 実態 |
| --- | --- | --- |
| NextAuth + Cognito | **実在** | next-auth 4.24.14（v5 ではない）。主経路は Hosted UI でなく CredentialsProvider から Cognito API 直叩き（[03 §2](phase0/03-auth-and-permissions.md)） |
| Serwist (PWA) | **実在** | swSrc `src/app/sw.ts`。dev / Playwright では無効（[07 §2](phase0/07-offline-and-pwa.md)） |
| S3 | **実在** | presigned upload/download + 処方箋のみ per-object Object Lock COMPLIANCE 5 年（[08 §1](phase0/08-infra-and-gates.md)） |
| SES | **実在（縮小）** | 送信導線は報告書送付メール 1 系統のみ。PDF は添付でなく同一オリジン https リンク（[08 §2](phase0/08-infra-and-gates.md)） |
| DynamoDB レート制限 | **実在（opt-in）** | 既定 in-memory、`RATE_LIMIT_STORE=dynamodb` で切替。production は未設定/障害時 fail-closed（DenyAll）（[08 §3](phase0/08-infra-and-gates.md)） |
| CloudWatch | **実在** | カスタムメトリクス（Namespace PH-OS/Application）+ alarm 定義 18 本（[08 §4](phase0/08-infra-and-gates.md)） |
| ECS / Lightsail | **実在（計画/テンプレート段階）** | ADR で Lightsail(pilot)→ECS Express の段階計画。非実行プランジェネレータ+CFn テンプレート群。live 展開有無は未確認（[08 §5](phase0/08-infra-and-gates.md)） |
| standalone output | **実在** | `next.config.ts` `output: 'standalone'`（[01 §3](phase0/01-tooling-and-config.md)） |
| モジュール境界チェック | **実在** | ESLint ルールではなく専用スクリプト `tools/scripts/check-module-boundaries.mjs`（allowlist + ratchet）（[01 §9](phase0/01-tooling-and-config.md)） |

想定にない主な相違・追加要素:

- **middleware.ts 不在** — Next.js 16 の `src/proxy.ts` に統合（[02 §6](phase0/02-app-router-structure.md)）。
- **ENCRYPTION_KEY は IndexedDB 暗号化に不使用（別方式）** — クライアントはブラウザ内生成の non-extractable per-user AES-GCM 鍵。env 鍵はサーバ側 webhook secret 暗号化のみ（[07 §5](phase0/07-offline-and-pwa.md)）。
- Prisma は単一 schema.prisma でなく **マルチファイル** `prisma/schema/`（16 ファイル、166 model）（[04 §1](phase0/04-data-layer.md)）。
- shadcn/ui の primitive は Radix でなく **@base-ui/react**（@radix-ui import 0 件）（[06 §2](phase0/06-design-system.md)）。
- PHOS Lambda backend 別系統（`src/phos/`）、web-push/Twilio/LINE 導線、ioredis+ElastiCache 資産、Google Maps/Routes が存在（[08 §11](phase0/08-infra-and-gates.md)）。
- **デプロイ先（Amplify vs Docker/ECR）はノート間で矛盾** — §10 / §14 参照。

## 3. UI アーキテクチャ（App Router）

[02](phase0/02-app-router-structure.md) 参照。

- page.tsx **128** / layout 5 / loading 60 / error 22。API route.ts **401**（107 ドメイン）。
- ルートグループは `(auth)` / `(dashboard)` / `(legal)` の 3 つ + グループ外 `platform/`（運営者）、`shared/[token]`（外部共有）、`offline/`、`dashboard-preview/`。parallel / intercepting routes / template.tsx は未使用。
- 認証境界は二層: `src/proxy.ts`（Edge、保護 prefix のリダイレクト + CSRF/レート制限 + CSP nonce）+ 各 layout.tsx（`(dashboard)` = org 所属、`platform` = PlatformOperator）。Next.js 16 の `unauthorized()`/`forbidden()` ファイル規約を使用。
- Server/Client 境界方針: Server Component は主に ID 注入（initialOrgId 等）とレイアウトゲート。データ取得はクライアント側 useQuery が主体（§4）。ページ本体は `*-content.tsx` の client component パターンが支配的。
- 注意: proxy の PROTECTED_ROUTE_PREFIXES は手動ミラーで一部ページ（/statistics 等）が未収載、`/dashboard-preview` は公開（意図か要確認、[02 §4.4/§7](phase0/02-app-router-structure.md)）。

## 4. データ取得・状態管理

[05](phase0/05-client-state.md) 参照。

- **TanStack Query**: 単一 QueryClient（staleTime 1 分 / gcTime 5 分 / retry 1 / focus・reconnect refetch off、online イベントで手動 refetch）。SSR hydration / prefetch は**不在**（純クライアントフェッチ）。optimistic update は**未実装**（計画コメントのみ）。query key は中央レジストリなしのインライン配列 `['feature', orgId, ...]`（orgId 位置に揺れ）。
- **Zustand**: 5 store — auth / ui（theme・workMode 等のみ localStorage 永続）/ offline / command-palette / 調剤ワークベンチ（実データ時は臨床 state を永続しない）。
- **RHF + Zod**: useForm 23 ファイル、zodResolver 標準。shadcn `Form`/`FormField` は**不使用**（生 RHF + Controller）。エラーサマリへのフォーカス移動パターンが横展開。
- **URL state**: 薄い。deep-link 受け取りが主で、tab/page/cursor の URL 管理は 0 件（フィルタ URL 同期は /search の q・category のみ）。
- **fetch 規約**: 単一ラッパーなし。`buildOrgHeaders`（x-org-id 強制）+ `readApiJson`（envelope 解釈 + zod 検証、throw）の 2 分割。FE false-empty fail-close 規約（isError 明示処理、DataTable errorMessage/onRetry、ErrorState）が横断実装済み。

## 5. 認証方式

[03](phase0/03-auth-and-permissions.md) 参照。

- next-auth **v4**（JWT strategy、maxAge 30 分）+ Cognito。主経路は CredentialsProvider の 3 モード多重化（password / new_password / mfa=TOTP）。OAuth CognitoProvider は登録のみで UI 導線未確認。
- API 認可は `withAuthContext` 標準ラッパ（session_version 照合・membership 必須・permission チェック・security event 監査）。権限は `permission-matrix.ts`（MemberRole 7 種 × Core/Pharmacy permission）。
- 画面ゲートは中央集約でなくコンポーネント単位（`useAuthStore` + `hasPermission`）。admin セグメント専用 layout はなく API 側 enforcement が実質。
- セッションタイムアウト UI（30 分・5 分前警告・パスワード再入力延長）、logout-all（session_version increment + GlobalSignOut）、break-glass（時限・監査必須・step-up MFA）実在。

## 6. オフライン・同期方式

[07](phase0/07-offline-and-pwa.md) 参照。

- SW は API・認証済み HTML を**一切キャッシュしない**（PHI 対策）。オフライン閲覧は暗号化 IndexedDB のみ。navigation の offline fallback ハンドラなし（オフライン中の新規ナビゲーションは不可）。
- Dexie メイン DB `PH-OSOffline`（v9、7 テーブル: 訪問/残薬/処方ドラフト、syncQueue、visitBriefCache、証跡写真、音声メモ）+ phos 側に独立キュー DB 2 つ（こちらのみ idempotency_key あり）。
- 暗号化はブラウザ内生成 per-user AES-GCM 鍵（non-extractable、fail-closed）。logout で鍵削除（データ行は残置=復号不能化方式、平文メタデータは残る）。
- 同期エンジン: 再試行 3 回（30s/120s/300s）、enqueue dedupe、送信前同値検証、409 → conflict payload 保存 → `/offline-sync` の ConflictDiffDialog で overwrite（expected_version 楽観ロック）/discard 解決。

## 7. ファイル処理・メール・レート制限・監視

[08 §1–4](phase0/08-infra-and-gates.md) 参照。

- **S3**: presigned upload（5 分）→ 直接 PUT → complete 検証。画像 10MB / 文書 50MB、MIME allowlist。処方箋のみ Object Lock COMPLIANCE 5 年。メタデータは Setting 行（`file_asset:` prefix）で DB 管理。
- **SES**: 報告書送付メール 1 系統のみ。PDF はリンク方式（同一オリジン https のみ）。
- **レート制限**: `src/lib/api/rate-limit.ts`。read 300/write 60/auth 5 毎分 + feature limiter + SSE 接続ゲージ。DynamoDB store は SigV4 手署名 + fetch 実装、production fail-closed。適用点は proxy.ts。
- **監視**: CloudWatch カスタムメトリクス + alarm 18 本、Sentry（production のみ、PHI サニタイズ: cookie 全消去・maskAllText・URL クエリ除去）、client-phi-log ratchet ガード、サーバ側構造化 logger。

## 8. スタイリングと既存デザインシステム資産

[06](phase0/06-design-system.md) 参照。

- Tailwind v4 CSS-first（`tailwind.config.*` なし）。トークンは `src/app/globals.css` に oklch で light/dark 定義: primary=深ネイビー、radius 0.375rem、**6 軸状態色**（state5 + tag2）、識別トークン群（route/intervention/role/time-slot/SOAP 等、低彩度・小面積限定）。
- 実装 SSOT: `src/lib/constants/status-tokens.ts`（role→badge/dot/accent クラス）+ `status-labels.ts`（enum→role 割当の正本）。StateBadge / StatusDot / ExpiryBadge / AlertTier 等の独自 semantic 部品が色単独依存禁止を encode。
- `src/components/ui/` 39 ファイル（shadcn 標準 + 独自拡張: DataTable[zebra/sticky/エラー内蔵/PHI export 制御]、ConfirmDialog、ConflictDiffDialog ほか）。primitive は @base-ui/react。Storybook 不採用。CSS Modules はワークベンチ 1 箇所のみ。
- フォント: Meiryo 先頭 → Noto Sans JP → system-ui。本文 14px / 行間 1.6。44px タッチターゲットは三層強制（globals.css media query / Button variant contract / guidelines 規範）。
- **規範 SSOT は `docs/ui-ux-design-guidelines.md`（1223 行、12 章）** — 状態色 family×value×role 確定表を含む。UI/UX 変更前の必読文書（CLAUDE.md でも指定）。実行可能な強制は `colors:check`（生 Tailwind 状態色禁止 ratchet）等のガードスクリプト。

## 9. テスト方式と objective gates

[01 §6–8](phase0/01-tooling-and-config.md), [08 §8–9](phase0/08-infra-and-gates.md) 参照。

- Unit: vitest（node env、coverage 閾値 enforced: statements 80 / branches 66 / lines 80 / functions 75。infra テンプレート・check スクリプト自体も対象）。
- E2E: Playwright 3 config（CI フル / local:5433 DB・port 3012 / audit）+ `medical-ui:e2e:gate`。a11y は @axe-core/playwright。
- CI（ci.yml）: audit → lint → format → **ratchet チェック 15 本**（境界/API 形状/DTO/PHI ログ/状態色/route-auth/RLS 契約ほか）→ typecheck 2 種 → coverage → TZ 3 種回帰 → build、+ migration-gate / **RLS 実証ゲート**（非スーパーユーザーでクロス org 拒否を実証）/ medical-ui E2E ゲート。
- 運用規律: `pnpm build` と typecheck 系は並列実行禁止（`.next/types` race）。maker/checker 分離。gate の green/red 状態は本調査では未実行・未確認。

## 10. デプロイ制約

- `output: 'standalone'`、build は webpack 固定（heap 8GB）、dev は Turbopack。SW は本番ビルドのみ有効。Node 24.16.0 pin。
- **矛盾（未解消）**: [01 §8](phase0/01-tooling-and-config.md) は ci.yml に「PR への Amplify プレビュー URL コメント」+「deploy-production ジョブ（`aws amplify start-job`、GitHub Environment `production` required reviewer）」が存在し**現行本番パス = Amplify** と記述。一方 [08 §5](phase0/08-infra-and-gates.md) は「**Amplify Hosting は実体なし**（参照は proxy.ts のコメント 1 箇所のみ、amplify.yml 不在）、実体は Docker + ECR（workflow_dispatch）で Lightsail→ECS の段階計画」と記述。両ノートの主張は両立せず、本文書では解消しない（要 ci.yml 再確認）。
- CLAUDE.md の `pnpm deploy` スクリプトは package.json に存在しない（[01 §10](phase0/01-tooling-and-config.md)）。live AWS 環境の有無は未確認。

## 11. 既存 SSOT 候補の所在

| 種別 | 所在 |
| --- | --- |
| 規範（normative） | `docs/ui-ux-design-guidelines.md`（UI/UX SSOT）、`docs/decisions.md`、`docs/architecture/aws-phos-deployment-stages.md`（デプロイ ADR）、`docs/frontend-screen-contracts.md`（screen 契約） |
| 実行可能（executable） | `tools/scripts/check-*.mjs` 15+ 本（ratchet 群）、vitest coverage 閾値、`rls-policy-contract` テスト、CI ci.yml 全体 |
| 事実上（de facto） | `src/lib/constants/status-tokens.ts` / `status-labels.ts`（状態色）、`src/app/globals.css`（トークン）、`button-variants.ts`（44px 契約）、`src/lib/api/response.ts`（envelope）、`withAuthContext`、`readApiJson`/`buildOrgHeaders`、`docs/state-color-migration-map.md` は guidelines へのポインタのみ |
| 運用 | `ops/refactor/STATE.md`（体制 SSOT、CLAUDE.md より優先） |

## 12. 開発コマンド一覧

[01 §10](phase0/01-tooling-and-config.md), [08 §9](phase0/08-infra-and-gates.md) 参照。

- 開発: `pnpm dev`（Turbopack）/ `pnpm dev:e2e:local`（webpack, :3012）
- ビルド: `pnpm build`（webpack, 8GB）/ `pnpm start`
- 品質: `pnpm lint` / `typecheck` / `typecheck:no-unused` / `format` / `format:check`
- テスト: `pnpm test` / `test:coverage` / `test:rls-proof` / `test:schedule-time:tz`
- E2E: `pnpm test:e2e` / `test:e2e:local` / `test:e2e:audit` / `medical-ui:e2e:gate`
- DB: `pnpm db:migrate` / `db:migrate:deploy` / `db:seed` / `db:generate` / `db:e2e:prepare`（`db:e2e:push` は廃止・エラー化）。schema は `--schema=prisma/schema/`
- ガード: `boundaries:check` / `colors:check` / `api-response-shape:check` / `dto-direct-prisma-return:check` / `client-phi-log:check` / `route-auth-wrapper:check` / `rls-policy-contract:check` ほか

## 13. 外部研究・ブラウザ検証の可否

- **ローカルブラウザ検証は可能と判断**: Playwright 1.60.0 + 3 config が実在し、ローカル E2E DB（localhost:5433 `ph_os_e2e`、brew postgresql@18）+ `db:e2e:prepare` + seed（`prisma/seed.ts`）の運用が確立（[08 §8](phase0/08-infra-and-gates.md)）。`dev:e2e:local`（:3012）で reuse-server 検証可。ローカルデモログイン（`ALLOW_LOCAL_DEMO_PASSWORD_LOGIN` / `PLAYWRIGHT=1`）あり（[03 §2](phase0/03-auth-and-permissions.md)）。
- 制約: SW/PWA 挙動は dev・Playwright で無効のため本番ビルドでしか検証できない（[07 §2.1](phase0/07-offline-and-pwa.md)）。
- 未確認: live 環境（デプロイ済み URL）の有無・アクセス可否、E2E スイートの現在の green/red 状態（未実行）。

## 14. 未確認事項・矛盾点の一覧

### 矛盾（ノート間、未解消）

1. **本番デプロイ経路**: [01 §8](phase0/01-tooling-and-config.md)「ci.yml に Amplify preview-url / deploy-production（`aws amplify start-job`）ジョブ、デプロイ先は AWS Amplify Hosting」 vs [08 §5](phase0/08-infra-and-gates.md)「Amplify は実体なし（コード中コメント 1 箇所のみ・amplify.yml 不在）、実体は Docker/ECR + Lightsail→ECS 段階計画」。ci.yml の実内容の再確認が必要。

### 未確認（各ノートの明記分を集約）

- [01]: pg / react-table / sonner / @axe-core/playwright 等一部依存の lockfile 実値、DOM テストの環境指定方式（ファイル単位と推測）、@base-ui/react と shadcn/Radix の併用状況（→ 06 で @radix-ui import 0 件と確認済みだが 01 時点では未確認扱い）。
- [02]: `/dashboard-preview` が公開なのは意図か、admin 配下の管理者ロール判定の実装箇所、一部ページの役割（パス由来の「推定」付き）。
- [03]: MFA の全ユーザー強制有無（Cognito User Pool 設定依存）、next-auth v4 の updateAge 未設定時のセッション延長挙動、`RefreshAccessTokenError` 監視の強制サインアウト処理（未検出）、SessionStateBridge 経由の鍵クリア発火タイミング（実挙動）、Dexie データ本体の削除処理（未検出）、Cognito 側 lockout 設定の実態、PreAuthentication Lambda の所在。
- [04]: S3/SES/CloudWatch の依存行番号根拠（当該ノートのスコープ外、→ 01/08 で確認済み）、直接依存 `pg` の用途。
- [05]: sonner の lockfile 解決値、ワークベンチ store のログアウト時クリア有無、useQuery 97 ファイル全数の isError 処理率（全数監査未実施）。
- [06]: `*.stories.tsx` の実在有無（実行基盤がないことは確定）、lucide-react の正確な使用ファイル数。
- [07]: `PhosOfflineSyncMetricEmitter` の実際の CloudWatch 送信経路、旧 `NetworkStatus` コンポーネントの動的参照有無。SW push 通知アイコン PNG 不在（実バグ候補として記録）。
- [08]: `.env.example` の内容（runtime guard により読み取り不可）、objective gate の green/red 状態（未実行）、live AWS デプロイの有無、報告書メールの `pdf_url` が指す画面。

### CLAUDE.md の stale 記述（実態と不一致、参考）

`@zxing/browser@0.1.5`（実際は ^0.2.0）、`pnpm deploy` スクリプト（不存在）、`ENCRYPTION_KEY` による IndexedDB PHI 暗号化（別方式）、報告書 PDF「添付」（実際はリンク）、Amplify Hosting（08 は不在と判定、ただし上記矛盾 1 参照）、単一 prisma/schema（実際はマルチファイル）。
