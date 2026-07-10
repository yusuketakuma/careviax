# Phase0 Recon: 認証・権限モデル

調査日: 2026-07-11 / 調査者: Phase0 recon agent

読み取り専用調査。すべての主張は file path (:line) を根拠とする。バージョンは package.json / pnpm-lock.yaml の実値。

---

## 1. next-auth のバージョンと構成

- **next-auth@4.24.14**（v4 系。Auth.js v5 ではない）
  - 根拠: `package.json:150`（`"next-auth": "4.24.14"`）、`pnpm-lock.yaml:4164`（`next-auth@4.24.14:`）
- 構成ファイル（SSOT）: `src/lib/auth/config.ts`
  - `authOptions: NextAuthOptions`（`src/lib/auth/config.ts:35`）
  - `authHandler = NextAuth(authOptions)`（`src/lib/auth/config.ts:232`）
  - Route Handler: `src/app/api/auth/[...nextauth]/route.ts`（`export { authHandler as GET, authHandler as POST }`、同ファイル:1-3）
  - `auth()` は `getServerSession(authOptions)` の薄いラッパ（`src/lib/auth/config.ts:219-221`）
- NEXTAUTH_SECRET は env → AWS Secrets Manager bootstrap（`bootstrapSecretsIntoEnv()`, `src/lib/auth/config.ts:27`）→ 非本番ではローカルフォールバック文字列 `'ph-os-local-auth-secret'`（`src/lib/auth/secret.ts:1-18`。production では `ALLOW_LOCAL_AUTH_FALLBACK` 明示時のみフォールバック許可、同:4-11）

## 2. プロバイダ構成（Cognito）

`src/lib/auth/config.ts:37-98` に 2 プロバイダ:

1. **CredentialsProvider（id: 'credentials'）** — 実際のログイン UI が使う主経路。`mode` フィールドで 3 フローを多重化（同:44, 51）:
   - `password`: `authenticateWithPassword`（Cognito USER_PASSWORD 系, `src/server/services/cognito-auth.ts:154` 付近）
   - `new_password`: `respondToNewPasswordChallenge`（NEW_PASSWORD_REQUIRED チャレンジ応答, config.ts:57-69）
   - `mfa`: `respondToSoftwareTokenChallenge`（SOFTWARE_TOKEN_MFA 応答, config.ts:71-83）
2. **CognitoProvider（OAuth/Hosted UI）** — `config.ts:93-97` に登録されているが、ログイン画面（`src/app/(auth)/login/page.tsx`）からは `signIn('credentials', ...)` のみ呼ばれる（同:77）。Hosted UI への導線は login ページに未確認。

- issuer は `https://cognito-idp.${AWS_REGION ?? 'ap-northeast-1'}.amazonaws.com/${NEXT_PUBLIC_COGNITO_USER_POOL_ID}`（config.ts:96）
- **ローカルデモバイパス**: `authenticateLocalDemoUser`（`src/server/services/cognito-auth.ts:36-56`）。`PLAYWRIGHT=1` または `ALLOW_LOCAL_DEMO_PASSWORD_LOGIN=1/true` のときのみ `demo@ph-os.example.com` / `PhOsDemo-2026` で Cognito を経由せずログイン可能（同:21-33 に定数、28-33 にガード）。

## 3. callback / session / jwt 処理

`src/lib/auth/config.ts:99-208`:

- **jwt callback**（:100-191）
  - OAuth profile から `cognitoSub` / `cognito:groups` / `custom:role`→`phosRole` を取り込み（:102-119）
  - credentials フローでは user オブジェクトから accessToken/refreshToken/idToken を格納し `accessTokenExpiry = Date.now() + 3600*1000`（:122-139）
  - **ローカル User 解決**: `resolveLocalUserByIdentity`（cognitoSub/email → DB User）で `userId` / `orgId` / `defaultSiteId` / `sessionVersion` をトークンに同期（:141-160、`src/lib/auth/user-resolution.ts`）
  - `getMembership(userId, orgId)` で `memberRole` をトークンに載せる（:162-167）
  - **トークンリフレッシュ**: 期限 5 分前（`TOKEN_REFRESH_BUFFER_MS = 5*60*1000`, :20）から `refreshCognitoTokens` で更新。失敗時 `token.error = 'RefreshAccessTokenError'`（:169-188）
- **session callback**（:192-208）: `session.user` に `id / cognitoSub / orgId / defaultSiteId / role(memberRole) / sessionVersion`、`session.cognitoGroups`、`session.error`、`session.phosRole` を公開
- **セッション設定**: `strategy: 'jwt'`, `maxAge: 30 * 60`（**30 分**）（:213-216）。`pages.signIn: '/login'`（:210-212）
- `getAuthAccessToken(request)` が `getToken()` 経由で Cognito accessToken を取り出す（:223-230、logout-all 等で使用）

## 4. MFA（TOTP）

- Cognito **SOFTWARE_TOKEN_MFA (TOTP)** ベース。チャレンジは `toChallengePayload` で `NEW_PASSWORD_REQUIRED` / `SOFTWARE_TOKEN_MFA` のみ許容（`src/server/services/cognito-auth.ts:134-152`）
- チャレンジはエンコードされてクライアントへ返り、`sessionStorage`（`COGNITO_CHALLENGE_STORAGE_KEY`）に格納 → `/mfa` または `/first-login` へ遷移（`src/app/(auth)/login/page.tsx:91-99`、`src/lib/auth/cognito-challenge.ts`、`src/lib/auth/browser-auth-state.ts:84-118`）
- 画面: `src/app/(auth)/mfa/page.tsx`（コード入力）、`src/app/(auth)/mfa/setup/page.tsx`（登録）、`src/app/(auth)/first-login/page.tsx`（初回パスワード変更）
- API: `src/app/api/me/mfa/setup/route.ts`（`AssociateSoftwareTokenCommand`, cognito-auth.ts:315）、`/api/me/mfa/verify`、`/api/me/mfa/disable`（`SetUserMFAPreferenceCommand`, cognito-auth.ts:335,364）、`src/app/api/auth/mfa/recovery/route.ts`（リカバリーコードで MFA 解除 → login ページに `notice=mfa_recovery_reset` 表示、login/page.tsx:39-41）
- MFA の**強制**（全ユーザー必須化）はアプリコードに未確認。Cognito User Pool 設定依存（**未確認**）。ただしプラットフォーム操作の step-up（§9）は「MFA 未登録の operator は fail-closed で拒否」（`src/lib/platform/step-up-mfa.ts:9-17`）

## 5. src/lib/auth 配下の構成

ディレクトリ一覧（`src/lib/auth/`）: `config.ts` / `context.ts` / `permissions.ts` / `permission-matrix.ts` / `phos-role.ts` / `member-roles.ts` / `request-context.ts` / `secret.ts` / `security-events.ts` / `user-resolution.ts` / `cognito-challenge.ts` / `browser-auth-state.ts` / `visit-schedule-access.ts` / `care-report-confirmation.ts` / `clinical-finalization.ts` ほかテスト。

### withAuthContext（API 認可の標準ラッパ）

- `withAuthContext(handler, options?)`（`src/lib/auth/context.ts:324-357`）が Route Handler 標準。内部で:
  1. `requireAuthContext(request, options)`（:162-311）— セッション → ローカル User 解決 → **session_version 照合**（logout-all 後の旧トークン無効化、:197-217）→ orgId 解決（`x-org-id` ヘッダ or resolvedUser or session or DB、:221-226）→ membership 必須（:241-254）→ `options.permission` があれば `hasPermission` チェック（:289-308）
  2. 失敗イベントはすべて `logSecurityEvent`（auth_failure / unauthorized_access / org_switch）に記録（:185, :207, :228, :243, :259, :291。実装は `src/lib/auth/security-events.ts`、AuditLog に `security:<event_type>` として永続化、同:164）
  3. 成功時 `runWithRequestAuthContext`（AsyncLocalStorage、`src/lib/auth/request-context.ts:14-28`）でリクエストスコープに ctx を保持
  4. ハンドラ内の想定外 throw を捕捉して標準 500 エンベロープ化（context.ts:337-354）
- `AuthContext = { userId, orgId, role, actorSiteId?, ipAddress?, userAgent? }`（context.ts:18, request-context.ts:4）
- 別系統: `requireApiKeyOrAuthContext`（`x-api-key` 併用ルート向け、context.ts:359-381）

### 権限モデル（permission-matrix）

- 定義: `src/lib/auth/permission-matrix.ts`
  - `CorePermission`: `canVisit / canReport / canAuthorReport / canSendCareReport / canManageBilling / canManagePatientSharing / canViewDashboard / canAdmin`（:9-21）
  - `PharmacyPermission`: `canDispense / canAuditDispense / canSet / canAuditSet`（8ステップ調剤ワークフロー用、:27-32）
  - `ROLE_PERMISSIONS: Record<MemberRole, Permission>`（:43-144）、`hasPermission(role, permission)`（:146-148）
- ヘルパ: `forbiddenIfMissingPermission` / `requirePermission`（`src/lib/auth/permissions.ts:8-20`）
- 補助: `MANAGEABLE_MEMBER_ROLES` / `ADMIN_MEMBER_ROLES` / `membershipFlagsForRole`（`src/lib/auth/member-roles.ts:3-32`）、`isAdmin(role) = owner || admin`（context.ts:158-160）

### ロール種別（MemberRole enum）

`prisma/schema/organization.prisma:1-9`: `owner / admin / pharmacist / pharmacist_trainee / clerk / driver / external_viewer`

権限マトリクス要点（permission-matrix.ts:43-144）:

| ロール | 特徴 |
|---|---|
| owner / admin | 全 true（canAdmin 含む） |
| pharmacist | canAdmin 以外ほぼ全 true（監査・請求・共有管理可） |
| pharmacist_trainee | 調剤/セット可・**監査不可**、canAuthorReport 可、送付/請求/共有管理不可 |
| clerk（事務） | 閲覧+連携事務系の canReport は true、**canAuthorReport false**（臨床報告書の作成不可）、調剤系すべて false |
| driver | canViewDashboard 含めほぼ全 false |
| external_viewer | 全 false |

- PH-OS 契約ロールへの写像: `phosRoleFromMemberRole`（`src/lib/auth/phos-role.ts:10-27`。owner/admin→ADMIN、pharmacist系→PHARMACIST、clerk→PHARMACY_CLERK、driver→DISPENSE_ASSISTANT、external_viewer→null）

## 6. 画面側の権限ゲート方式

- **middleware.ts は存在しない**（repo 直下・src 直下ともに未検出。ルート保護は layout ベース）
- サーバ側ゲート: `src/app/(dashboard)/layout.tsx:12-24` — `auth()` でセッションなしなら `unauthorized()`、ローカル User の org 未解決なら `forbidden()`（Next.js の `unauthorized()`/`forbidden()` を使用）
  - 対応ページ: `src/app/unauthorized.tsx`（ErrorState variant="unauthorized"、「ログイン画面へ」ボタン）、`src/app/forbidden.tsx`
- クライアント側の role 伝搬: `AppProvider`（`src/components/providers/app-provider.tsx:60-76`）が `SessionProvider` を張り、`SessionStateBridge` が `useSession()` → zustand `useAuthStore.currentUser`（id/email/name/cognitoSub/role）へ同期（同:18-39、store 定義 `src/lib/stores/auth-store.ts`）
- 画面ゲートは**中央集約ではなくコンポーネント単位**: `useAuthStore` の role + `hasPermission` を各所で評価
  - 例: `src/app/(dashboard)/admin/institutions/institutions-content.tsx:145-146`（`hasPermission(viewerRole, 'canAdmin')` で編集 UI を非表示）、`admin/pharmacy-sites/pharmacy-sites-content.tsx:169-170`
  - グローバル検索はカテゴリ単位で `requiredPermission` を持ち、role 不明時は fail-closed（`src/components/features/search/use-global-search.ts:43-54`）
  - sidebar / app-header は role を**表示**（`memberRoleLabel`）に使用（`src/components/layout/sidebar.tsx:92,188`、`app-header.tsx:130,299`）
- `admin/` セグメント専用の layout ゲートは未検出（`src/app/(dashboard)/admin/` 直下に layout.tsx なし）。管理系の強制は API 側 `withAuthContext({ permission: 'canAdmin' })` が実質の enforcement で、FE は「403 になるボタンを出さない」方針（institutions-content.tsx:145 コメント）

## 7. 未認証リダイレクト・セッション失効 UI

- 未認証アクセス: `(dashboard)/layout.tsx` の `unauthorized()` → `src/app/unauthorized.tsx` 表示（自動リダイレクトではなくエラーページ+「ログイン画面へ」導線）。NextAuth 側の signIn ページは `/login`（config.ts:211）
- callbackUrl はオープンリダイレクト対策済み: `sanitizeLocalCallbackUrl`（`src/lib/auth/browser-auth-state.ts:49-64`、相対パス強制・`\\` 拒否・origin 照合）
- **セッションタイムアウト UI**: `src/components/auth/session-timeout-modal.tsx`
  - クライアント側 30 分無操作タイマー（`SESSION_DURATION_MS = 30*60*1000`, :25）、残り 5 分で警告モーダル（`WARNING_THRESHOLD_MS`, :27）、カウントダウン表示
  - mousedown/keydown/touchstart/scroll でタイマーリセット（:127-148）
  - 期限到達で `clearOfflineEncryptionKey()` → `signOut({ callbackUrl: '/login?error=SessionExpired' })`（:70-74）
  - モーダル内で**パスワード再入力による延長**（`signIn('credentials', mode:'password')` 再実行、MFA チャレンジなら /mfa へ、:156-189）
  - 注意: サーバ側 JWT maxAge 30 分（config.ts:215）とクライアントタイマーは独立。クライアント活動でサーバ JWT の maxAge が延びるかは next-auth v4 の updateAge 依存（updateAge 明示設定なし。**未確認**）
- `RefreshAccessTokenError` は `session.error` に載る（config.ts:186,204）が、これを監視して強制サインアウトするクライアント処理は**未検出**（grep で参照は config.ts のみ）

## 8. logout 処理とローカルデータ消去

- sidebar のログアウト: `signOut({ callbackUrl: '/login' })` のみ（`src/components/layout/sidebar.tsx:94-97`）。**オフライン暗号鍵の明示クリアなし**
- session-timeout-modal のログアウト/失効: `clearOfflineEncryptionKey()` を明示実行（session-timeout-modal.tsx:70-74, 191-194、実装 `src/lib/offline/crypto.ts:142`）
- 補完: `AppProvider` の `SessionStateBridge` が「セッション消失（offlineIdentity null）」検知時に `clearOfflineEncryptionKey()`（app-provider.tsx:41-55）— ただし signOut 後 /login へ遷移すると dashboard layout ごとアンマウントされるため、この経路の発火タイミングは実挙動**未確認**
- Dexie（IndexedDB）の**データ本体を削除する処理は未確認**（消去対象は暗号鍵。鍵消去により暗号化 PHI は復号不能になる設計とみられるが、DB 削除呼び出しは grep で未検出）
- **全端末ログアウト**: `src/app/api/me/logout-all/route.ts` — `User.session_version` を increment（:20-30）→ AuditLog `logout_all` 記録（:31-49）→ Cognito `GlobalSignOut`（:51-56）。以降の旧 JWT は `requireAuthContext` の session_version 照合（context.ts:197-217）で 401

## 9. break-glass / emergency アクセス

- 実装: `src/lib/platform/`（テナント外の**プラットフォーム運営者**用）
  - `break-glass.ts`: 時限セッション（デフォルト TTL 30 分 `BREAK_GLASS_DEFAULT_TTL_MS`、最大 60 分 `BREAK_GLASS_MAX_TTL_MS`、:26-29）。対象テナントの org に RLS を pin した合成コンテキストで実行し、**同一トランザクション内で** break-glass AuditLog 行を書く（audit 失敗時はアクセスごと fail、:95-123 コメント）。アクション定数は `@/lib/audit/break-glass-audit`（BREAK_GLASS_ACTIVATE/READ/WRITE/REVOKE_ACTION、:17-23）
  - `operator.ts`: `PlatformOperatorContext`（operatorId/email/role=PlatformOperatorRole）。テナント AuthContext とは別系統（:12-22）
  - `step-up-mfa.ts`: 高権限操作前に**パスワード+現行 TOTP の両方**を Cognito に再検証。MFA 未登録 operator・不正コード等はすべて fail-closed（:9-17）
- 無記録バックドアなし（BYPASSRLS 不使用、監査必須）— コード上のコメントと構造に整合

## 10. sign-in 画面と lockout

- ログイン画面: `src/app/(auth)/login/page.tsx`（client component。email+password、パスワード表示切替、エラーコード→日本語文言マップ :19-30、共有端末ログアウト注意喚起 :224-229、/password/reset 導線 :174）。auth 系レイアウト: `src/app/(auth)/layout.tsx`
- **lockout**:
  - `LOCKOUT_ERROR_CODES = { AccountLocked, UserLambdaValidationException, TooManyFailedAttemptsException, PasswordAttemptsExceeded }`（login/page.tsx:32-37）に該当すると `/lockout` へ遷移（:86-89）
  - lockout ページ: `src/app/(auth)/lockout/page.tsx`（情報表示のみ: 時間経過で自動解除・管理者連絡。連絡先は build 時 env 注入 `resolveSupportContact`、`lockout/support-contact.ts`。解除操作 UI はなし）
  - **アプリ側に試行回数カウント/ロック状態の実装はない**。上記エラーコードは Cognito 由来（PasswordAttemptsExceeded 等は Cognito 組込みロックアウト）。`UserLambdaValidationException` は Cognito Lambda トリガ想定だが、**リポジトリ内に PreAuthentication Lambda 等の実装は未検出**（tools/infra で lockout 関連は cloudwatch-alarms.json のみ）。Cognito User Pool 側の設定実態は**未確認**
- パスワード系画面: `src/app/(auth)/password/reset`、`password/change`、`first-login`（NEW_PASSWORD_REQUIRED）

## 11. 「想定スタック」との差分判定（認証領域）

| 想定 | 実在判定 |
|---|---|
| Amazon Cognito + NextAuth | **実在**。ただし主経路は Hosted UI ではなく CredentialsProvider 経由の Cognito API 直叩き（config.ts:38-92、cognito-auth.ts）。OAuth CognitoProvider は登録のみで UI 導線未確認 |
| next-auth v4 | **実在**（4.24.14。v5/Auth.js ではない） |
| middleware ベースの認証ガード | **不在**。(dashboard)/layout.tsx の `unauthorized()`/`forbidden()` + API 側 withAuthContext の二層 |
| MFA | **実在**（Cognito TOTP、setup/verify/disable/recovery 一式 + platform step-up）。全員強制かは User Pool 設定依存で未確認 |
| lockout | **UI は実在**（/lockout）だがロック機構自体は Cognito 側。アプリ内 DynamoDB 等によるレート制限・試行管理は auth 領域では**不在** |
| break-glass | **実在**（時限・監査必須・step-up MFA 付き、src/lib/platform/） |
