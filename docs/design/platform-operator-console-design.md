# プラットフォーム運営者コンソール（監査付きブレークグラス方式）設計

- 状態: **P-0 実装済み**（2026-07-03、独立セキュリティレビュー APPROVE）。P-1/P-2 は下記 §8 参照
- 作成: 2026-07-03
- 実装: schema `prisma/schema/platform.prisma` + migration `20260703100000` / core lib `src/lib/platform/{operator,break-glass,step-up-mfa}.ts` + `src/lib/audit/break-glass-audit.ts` / API `src/app/api/platform/**` / UI `src/app/platform/**`。テスト計52件（lib 44 + UI 8）
- 決定者: fable（ユーザー指示「機能はベストプラクティスを調査して fable が決めて良い」に基づく）
- 関連: `docs/security/rls-gap-ledger.md`, `prisma/rls-policies.sql`, `src/lib/db/rls.ts`, `src/lib/auth/permission-matrix.ts`, `src/lib/audit/*`, `src/server/services/data-explorer.ts`

## 0. 要件と設計判断

**ユーザー要件**: システム開発者・管理者が「裏側から」各テナントのデータログ確認・データアクセス・操作を行える管理者画面。テナント横断でデータを確認・アクセス・操作でき、通常のテナント権限（PHI アクセス制御）を越える。

**設計判断（結論）**: 上記を **「監査付きブレークグラス（break-glass）方式のプラットフォーム運営者コンソール」** として実装する。無記録・無制限の裏口は作らない。理由:

1. 本システムは 3省2ガイドライン準拠（テナント分離 = RLS + 監査 by default）。無制限バックドアは Wave 1 で構築したテナント分離を根底から破壊し、単一侵害で全テナント PHI 露出＝規制違反・最大の攻撃対象になる。
2. 業界標準（HIPAA / SaaS マルチテナント）では、運営者のテナント横断アクセスは **JIT 昇格・時限・MFA 再認証・全アクセス監査・最小権限** の break-glass として実装するのが 2025-2026 のゴールドスタンダード。
3. 「PHI を通り越してアクセス」は達成する。ただし **監査を"通り越す"のではなく、越権アクセスした事実こそ最も厚く記録する**（監査は残す、これが唯一のコンプライアンス適合な作り方）。

### 採用する 7 原則

| # | 原則 | 実装 |
|---|------|------|
| 1 | 常時アクセス禁止 / JIT 昇格 | `BreakGlassSession` を都度発行、時限（既定 30 分）で自動失効 |
| 2 | MFA 再認証ゲート | 起動時に既存 MFA verify フローで step-up 再認証 |
| 3 | 理由の記録 | アクセス理由（必須）+ 参照チケット（任意） |
| 4 | 全アクセスの改竄困難な監査 | `break_glass_read/write` を AuditLog へ、hash-chain で tamper-evidence |
| 5 | 層の分離 | 運営者 identity は org membership とは別系統。テナント org に混入させない |
| 6 | 読み取り優先 / 最小権限 | 既定 read-only。write は例外扱い＋追加監査＋アラート |
| 7 | RLS の意図的バイパスは"記録される専用経路" | RLS を止めず、承認済みブレークグラス中のみ対象 org を 1 テナントずつスコープ |

## 1. 現状ギャップ（recon SYSTEM_MAP 由来）

1. **platform operator ロールが存在しない** — `MemberRole`（owner/admin/pharmacist/…）は単一 org 内のみ。cross-tenant identity・claim・membership が無い。
2. **cross-org 読取の正当化 seam が無い** — `withOrgContext(orgId, fn)` は request ctx.orgId ≠ 引数 orgId を throw（`src/lib/db/rls.ts:66-68`）。cron のみ ctx 無しで任意 org 可。
3. **step-up 再認証が無い** — MFA は sign-in チャレンジ + 登録のみ（`me/mfa/*`）。操作直前の再 MFA 機構が無い。
4. **AuditLog に tamper-evidence が無い** — hash 連鎖 / 署名 / WORM 無し。`changes` は自由 JSON。
5. **admin UI にサーバ側 role ゲートが無い** — 認可は API の `canAdmin` に一元依存。`(dashboard)/layout.tsx` は認証 + org のみ確認。
6. **data-explorer が最良プロトタイプだが自 org 固定** — allowlist / read-only / redaction / soft-delete / 監査は完備。横断化 + operator 権限 + break-glass 理由記録の追加が必要。

## 2. Identity モデル（新設）

運営者はテナントの org member ではない。別系統の identity とする。

```prisma
// prisma/schema/platform.prisma（新規）
enum PlatformOperatorRole {
  platform_support   // read-only（テナント横断閲覧のみ）
  platform_admin     // read + 限定 write ops
  platform_owner     // 全操作 + operator 管理
}

enum PlatformOperatorStatus { active suspended }

model PlatformOperator {
  id            String   @id @default(cuid())
  user_id       String   @unique          // 既存 User と 1:1（Cognito sub 経由で認証）
  role          PlatformOperatorRole
  status        PlatformOperatorStatus @default(active)
  created_at    DateTime @default(now())
  updated_at    DateTime @updatedAt
  // NOTE: このテーブルは org_id を持たない = テナント非スコープ。RLS 対象外（グローバル admin テーブル）。
}
```

- 認証: 既存 Cognito。運営者は専用 Cognito グループ `platform-operators` に所属。session に既に載る `cognitoGroups`（`src/types/next-auth.d.ts`）で一次判定 → `PlatformOperator` テーブルで二次確認（DB が SSOT）。
- **org 混入防止**: 運営者アカウントは org membership を持たないか、持っても platform 権限とは独立。`(dashboard)` 配下（テナント業務画面）と `/platform` を厳格分離。

## 3. ブレークグラス・セッション（新設）

```prisma
model BreakGlassSession {
  id                 String   @id @default(cuid())
  operator_id        String                       // PlatformOperator.id
  target_org_id      String                       // アクセス対象テナント
  reason             String                       // 必須: アクセス理由
  reference_ticket   String?                      // 任意: サポート/障害チケット
  scope              BreakGlassScope @default(read_only)
  mfa_verified_at    DateTime                     // step-up MFA 成功時刻
  granted_at         DateTime @default(now())
  expires_at         DateTime                     // granted_at + 30min（既定）
  revoked_at         DateTime?
  revoked_by         String?
  status             BreakGlassStatus @default(active)
  ip_address         String?
  user_agent         String?
  @@index([operator_id, status])
  @@index([target_org_id, granted_at])
}

enum BreakGlassScope { read_only read_write }
enum BreakGlassStatus { active expired revoked }
```

**起動フロー**:
1. 運営者が対象テナント選択 + 理由入力。
2. step-up MFA（既存 `verifyTotpForAccessToken` を操作直前再認証に再利用）。
3. 成功で `BreakGlassSession` 発行（`expires_at = now + 30min`, scope 既定 read_only）。
4. security event + platform_owner へ通知（アラート）。
5. 以降、対象テナントへのアクセスはこの session が有効な間のみ許可。

## 4. cross-org データアクセス seam（新設）

`src/lib/db/platform-break-glass.ts`（新規）:

```ts
withBreakGlassOrgContext(session: BreakGlassSession, targetOrgId, fn, options)
```

- 前提: 有効な（active・未失効・未 revoke・scope 適合）`BreakGlassSession` for (operator, targetOrgId) を **DB 検証**。無ければ throw（fail-close）。
- RLS session 変数を **targetOrgId** にセット（`app.current_org_id = targetOrgId` 等）＋ break-glass マーカー（`app.break_glass = 'true'`, `app.break_glass_operator_id`, `app.break_glass_session_id`）。
- **重要**: BYPASSRLS ロールは使わない。RLS を尊重し、承認済み対象 org を **1 テナントずつスコープ**する。→ 運営者も一度に見えるのは承認された 1 テナントのみ。defense-in-depth を維持し、raw bypass より厳格。
- 全 read/write を AuditLog（§5）へ記録。
- テナント一覧など横断メタデータ（org 名・状態、PHI 無し）は別の allowlist 経路（platform メタのみ、PHI 非含）で提供。

## 5. 監査（tamper-evident 強化）

- 全 break-glass アクセスを AuditLog へ: action `break_glass_read` / `break_glass_write`、actor = operator、target_org、`changes = { session_id, reason, scope, view/table, target_id }`。
- **tamper-evidence**: `BreakGlassSession` と break-glass AuditLog 行に hash-chain（`prev_hash`, `row_hash = H(prev_hash || 正規化 payload)`）を付与。整合検証ジョブ + （将来）S3 Object Lock への追記転写。
- data-explorer 既存の redaction（機微列 deny、AuditLog changes redact）を break-glass 経路にも継承。

## 6. UI（新設 `/platform` ルートグループ）

`(dashboard)` とは別のルートグループ。サーバ側で PlatformOperator ゲート。

1. **テナントディレクトリ** — org 一覧（メタのみ、PHI 無し）。
2. **ブレークグラス起動** — 対象選択 + 理由 + MFA step-up。
3. **アクティブ session バナー** — 残り時間カウントダウン + 即時 revoke。
4. **テナント横断データエクスプローラ** — 既存 `data-explorer` service を targetOrg でパラメタライズ（read-only 既定）。
5. **アクセス監査ビューア** — break-glass アクセス履歴（誰が・いつ・どのテナント・何を）。

## 7. 権限判定（新設）

- 新権限軸 `PlatformPermission`（`canBreakGlassRead`, `canBreakGlassWrite`, `canManageOperators`）を `PlatformOperatorRole` にマップ。org 内 `canAdmin` とは**別軸**（`canAdmin` 再利用は「自 org admin=全テナント閲覧可」になり誤り）。
- `/platform/api/*` route guard: `requirePlatformOperator({ role, permission })`（新規、`withAuthContext` とは別レーン）。

## 8. Wave 分割（実装順）

- **P-0（MVP: 閲覧 + ログ）**: identity モデル + BreakGlassSession + MFA step-up + read-only テナント横断 data-explorer + 全アクセス監査 + `/platform` UI 骨格 + テナントディレクトリ + アクセス監査ビューア。→ 「データログ確認 + テナントデータ閲覧」を満たす。
- **P-1（write ops）**: scope=read_write の限定操作 + 追加監査 + アラート + hash-chain tamper-evidence。
- **P-2（横展開）**: 多職種展開（医科・訪問看護）に向けた operator 権限の汎用化。

### P-0 後のフォローアップ（2026-07-03 セキュリティレビュー指摘・いずれも非 blocker）

- operator suspend 時に既存 active `BreakGlassSession` を cascade revoke する（現状は次アクセスの `requirePlatformOperator` で 401 になり実質失効するが、明示 revoke がより明確）。
- break-glass 起動エンドポイントに operator 単位の試行レート制限/ロックアウト（現状は Cognito 側スロットリング依存）。
- `assertSessionUsable` の org_mismatch 分岐は現行呼び出しで冗長（session を org-scoped で取得済み）。将来 id 単独取得の呼び出しを追加する際は route の orgId を seam に渡して guard を活性化する。
- 監査ビューアの `changes` は現状非 PHI（session_id/reason/scope/metadata）だが、将来 break_glass 系 action に PHI を載せない契約コメントを維持すること。
- グローバル（全テナント横断）の break-glass アクセス監査ダッシュボード（現状は選択テナント単位）。

## 9. hard-stop 明示

本機能は auth / security / schema migration の交差点。ユーザーが明示承認済み（「追加して」+「fable が決めて良い」）。ただし各 Wave は maker/checker 分離 + objective gate + 独立セキュリティレビューを必須とし、prod deploy・破壊的 migration は別途承認を得る。
