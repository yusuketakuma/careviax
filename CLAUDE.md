# CareViaX Pharmacy - Project Configuration

## Project Overview
在宅訪問に強い保険薬局向けの業務・連携プラットフォーム。
3省2ガイドライン（MHLW v6.0 + METI/MIC v1.1）準拠の医療情報システム。

仕様書:
- `docs/careviax_pharmacy_workflow_spec_project_context.md` — ワークフロー詳細仕様
- `docs/careviax_pharmacy_multidisciplinary_collaboration_spec_project_context.md` — 多職種連携詳細仕様
- `docs/decisions.md` — 設計判断

## Design Principles
- Workflow First / Mobile First / Structured Data First
- Audit by Default / Integration by Adapter / Monolith First
- **Compliance by Design**: 3省2ガイドライン準拠を設計の前提とする

## UI Design: 医療システムデザイン方針
- **配色**: 落ち着いたブルー系をプライマリ（信頼・清潔感）。白ベースで高コントラスト。警告色は赤/橙/黄の3段階のみ（重大/注意/情報）。派手にしない。
- **タイポグラフィ**: Noto Sans JP。本文14px以上、ラベル12px以上。データ密度の高い画面でも行間1.6以上確保。
- **情報密度**: 一覧画面はデータ密度重視（Excel的）、入力画面はゆとり重視（1カラム中心）。モバイルは最小限の情報で次のアクションが明確。
- **色の使い方**: 患者状態（稼働中=緑、保留=橙、終了=灰）、ワークフロー状態（待ち=青、進行中=緑、差戻し=赤、完了=灰）、優先度（緊急=赤、高=橙、中=青、低=灰）を統一。
- **アクセシビリティ**: WCAG AA必須。コントラスト比4.5:1以上。タッチターゲット44px以上。フォーカス可視。色だけに依存しない（アイコン+テキスト併用）。
- **エラー防止**: 破壊的操作は確認ダイアログ必須。取消不可操作には二重確認。入力中の離脱防止。自動保存。
- **shadcn/ui カスタマイズ**: デフォルトのスレートグレーをブルーグレーに変更。コンポーネント角丸は控えめ(radius: 0.375rem)。医療データテーブルは zebra stripe + sticky header。

## Compliance Framework
- **MHLW ガイドライン v6.0**: 医療情報システムの安全管理
- **METI/MIC 提供事業者ガイドライン v1.1**: SaaS事業者の安全管理
- **個人情報保護法 (APPI)**: 要配慮個人情報（医療データ）の取扱い
- **ISMAP**: AWS が取得済み（171+サービス）、CareViaX はその上に構築

## Architecture: AWS 全面採用（ISMAP準拠）

```
[Client]  Next.js 16 (PWA/Serwist)
              ↓ HTTPS (TLS 1.3)
[Hosting]  AWS Amplify Hosting (ap-northeast-1)
              ↓
[API]      Next.js Route Handlers (Node.js runtime, Tokyo only)
              ↓
[Auth]     Amazon Cognito (MFA/TOTP, ISMAP対象)
[DB]       Amazon RDS PostgreSQL (Multi-AZ, ap-northeast-1, ISMAP対象)
[ORM]      Prisma 7 (スキーマ管理 + クエリ + RLS連携)
[Storage]  Amazon S3 (Object Lock, ap-northeast-1, ISMAP対象)
[Email]    Amazon SES (ap-northeast-1)
[Audit]    AWS CloudTrail + CloudWatch (ISMAP対象)
[KMS]      AWS KMS (暗号鍵管理, ISMAP対象)
```

### Data Access: Prisma + PostgreSQL RLS
- Prisma がメイン ORM（スキーマ定義・マイグレーション・クエリ・型生成）
- PostgreSQL RLS をテナント分離に使用
- 各リクエストで `SET LOCAL app.current_org_id = '...'` → RLS が org_id でフィルタ
- Prisma の `$executeRaw` でセッション変数をセット、その後通常クエリ
- RLS はアプリ層フィルタとの二重防御（defense-in-depth）

## Tech Stack (versions pinned 2026-03-25)

### Frontend
- `next@16.2.1` (App Router)
- `react@19.2.4` / `react-dom@19.2.4`
- `typescript@6.0.2`
- `tailwindcss@4.2.2` (CSS-first config)
- `shadcn/ui` (latest)
- `@tanstack/react-query@5.95.2`
- `zustand@5.0.12`
- `@serwist/next@9.5.7` / `serwist@9.5.7` — PWA
- `dexie@4.3.0` — オフライン (IndexedDB)

### 医薬品マスタ（全て無料取得）
| データソース | 提供元 | 形式 | 更新頻度 | 用途 |
|---|---|---|---|---|
| SSK基本マスター | 社会保険診療報酬支払基金 | CSV/ZIP | 改定時+月次 | 薬剤本体（YJコード/薬価/薬効分類/後発品/麻薬区分） |
| HOTコードマスター | MEDIS | ZIP | 随時 | コード横断結合キー（HOT↔YJ↔レセ電↔JAN） |
| 薬価基準収載品目リスト | 厚労省 | Excel | 年1-2回 | 薬価・後発品区分 |
| 一般名処方マスタ | 厚労省 | Excel | 年1回 | 一般名→後発品対応 |
| PMDA添付文書 | PMDA | XML(新)/SGML(旧) | 随時 | 禁忌・相互作用・副作用（メディナビ経由DL） |
| 高齢者PIMリスト | 厚労省 | PDF | 数年 | 高齢者不適正薬（手動構造化） |
| 腎機能別用量調整 | JSNP | PDF | 年1回 | 腎機能別投与量（手動構造化） |

### Backend / Data Access
- `prisma@7.5.0` / `@prisma/client@7.5.0` — ORM + RLS連携
- `zod@4.3.6` — バリデーション
- `@aws-sdk/client-cognito-identity-provider` — Cognito認証
- `@aws-sdk/client-s3` / `@aws-sdk/s3-request-presigner` — S3操作
- `@aws-sdk/client-ses` — メール送信
- `next-auth@5` (Auth.js) — Cognito連携のセッション管理

### QR Code
- `@zxing/browser@0.1.5` (dynamic import)
- `@zxing/text-encoding@0.9.0` — Shift-JIS

### Infrastructure (全て ISMAP 対象、ap-northeast-1)
- **AWS Amplify Hosting** — Next.js デプロイ（東京リージョン固定）
- **Amazon RDS PostgreSQL** — Multi-AZ、暗号化at rest (KMS)
- **Amazon Cognito** — 認証・MFA (TOTP/FIDO2)・ユーザー管理
- **Amazon S3** — ファイル保存（Object Lock、バケットポリシー）
- **Amazon SES** — メール送信（報告書PDF添付）
- **AWS CloudTrail** — API操作の監査ログ
- **AWS CloudWatch** — 監視・アラート・ログ
- **AWS KMS** — 暗号鍵管理
- **AWS Secrets Manager** — 接続情報・APIキー管理

### Dev Tools
- `pnpm` — パッケージマネージャ
- `eslint@10.1.0` — flat config
- `prettier@3.8.1`
- `vitest@4.1.1` — ユニットテスト
- `@playwright/test@1.58.2` — E2E
- `date-fns@4.1.0` — 日付（日本語ロケール）

## Language
- Communication: 日本語
- Commit messages: English
- Code / comments / variables: English (camelCase)
- DB columns: English (snake_case)

## Directory Structure
```
careviax/
├── docs/               # 仕様書・設計・ガイドライン準拠文書
├── src/
│   ├── app/            # Next.js App Router pages
│   ├── components/     # Shared UI components
│   ├── features/       # Feature modules
│   ├── lib/
│   │   ├── auth/       # Cognito + NextAuth 統合
│   │   ├── db/         # Prisma client + RLS helper
│   │   ├── storage/    # S3 presigned URL helper
│   │   └── utils/      # Shared utilities
│   ├── types/          # TypeScript types (Prisma generated)
│   └── server/         # Server-only code (adapters, jobs)
├── prisma/             # Schema & migrations
├── public/             # Static assets, manifest.json, icons
├── tools/
│   ├── infra/          # AWS / ops artifacts and infrastructure definitions
│   ├── scripts/        # Operational and reporting scripts
│   └── tests/          # E2E tests (Playwright) and .artifacts output
```

## Environment Variables
```
# AWS
AWS_REGION=ap-northeast-1
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=

# Database (RDS PostgreSQL)
DATABASE_URL=          # postgresql://user:pass@rds-endpoint:5432/careviax
DIRECT_URL=            # Same (no pooler needed for RDS)

# Cognito
NEXT_PUBLIC_COGNITO_USER_POOL_ID=
NEXT_PUBLIC_COGNITO_CLIENT_ID=
COGNITO_CLIENT_SECRET=

# NextAuth
NEXTAUTH_URL=
NEXTAUTH_SECRET=

# S3
S3_BUCKET_NAME=
S3_BUCKET_REGION=ap-northeast-1

# SES
SES_FROM_EMAIL=

# App
NEXT_PUBLIC_APP_URL=
ENCRYPTION_KEY=        # AES-GCM 256bit (IndexedDB PHI encryption)
JWT_SIGNING_SECRET=    # External sharing token

# Amplify (auto-injected)
# AWS_APP_ID, AWS_BRANCH, etc.
```

## Commands
```bash
pnpm dev              # Start dev server
pnpm build            # Production build
pnpm test             # Unit tests (Vitest)
pnpm test:e2e         # E2E tests (Playwright)
pnpm test:e2e:list    # List Playwright tests
pnpm test:e2e:audit   # Audit-focused Playwright config
pnpm db:migrate       # Prisma migrations (→ RDS)
pnpm db:seed          # Seed database
pnpm db:generate      # Prisma client generation
pnpm lint             # ESLint flat config
pnpm deploy           # AWS Amplify deploy (or CDK deploy)
```
