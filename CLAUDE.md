# PH-OS Pharmacy - Project Configuration

## Project Overview

在宅訪問に強い保険薬局向けの業務・連携プラットフォーム。
3省2ガイドライン（MHLW v6.0 + METI/MIC v1.1）準拠の医療情報システム。

仕様書:

- `docs/visit-report-collab-spec.md` — ワークフロー/多職種連携詳細仕様
- `docs/decisions.md` — 設計判断
- `docs/ui-ux-design-guidelines.md` — UI/UX 設計の SSOT。UI/UX 変更時は必ず先に参照すること

## Design Principles

- Workflow First / Mobile First / Structured Data First
- Audit by Default / Integration by Adapter / Monolith First
- **Compliance by Design**: 3省2ガイドライン準拠を設計の前提とする

## UI Design: 医療システムデザイン方針

- UI/UX を変更する前に `docs/ui-ux-design-guidelines.md` を読み、ページ構成、グルーピング、区切り線、見出し階層、情報優先順位の判断根拠にすること
- 今後の Claude による UI/UX 提案・実装・レビューでは `docs/ui-ux-design-guidelines.md` を必ず参照すること
- **配色**: 深ネイビー系をプライマリ（レセコン #1f4e79 相当、信頼・清潔感）。白ベースで高コントラスト。警告色は赤/橙/黄の3段階のみ（重大/注意/情報）。派手にしない。
- **タイポグラフィ**: Meiryo 先頭（Noto Sans JP フォールバック、最終 system-ui）。本文14px以上、ラベル12px以上。データ密度の高い画面でも行間1.6以上確保。
- **情報密度**: 一覧画面はデータ密度重視（Excel的）、入力画面はゆとり重視（1カラム中心）。モバイルは最小限の情報で次のアクションが明確。
- **色の使い方**: 患者状態（稼働中=緑、保留=橙、終了=灰）、ワークフロー状態（待ち=青、進行中=緑、差戻し=赤、完了=灰）、優先度（緊急=赤、高=橙、中=青、低=灰）を統一。
- **アクセシビリティ**: WCAG AA必須。コントラスト比4.5:1以上。タッチターゲット44px以上。フォーカス可視。色だけに依存しない（アイコン+テキスト併用）。
- **エラー防止**: 破壊的操作は確認ダイアログ必須。取消不可操作には二重確認。入力中の離脱防止。自動保存。
- **shadcn/ui カスタマイズ**: デフォルトのスレートグレーをブルーグレーに変更。コンポーネント角丸は控えめ(radius: 0.375rem)。医療データテーブルは zebra stripe + sticky header。

## Compliance Framework

- **MHLW ガイドライン v6.0**: 医療情報システムの安全管理
- **METI/MIC 提供事業者ガイドライン v1.1**: SaaS事業者の安全管理
- **個人情報保護法 (APPI)**: 要配慮個人情報（医療データ）の取扱い
- **ISMAP**: AWS が取得済み（171+サービス）、PH-OS はその上に構築

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

## Tech Stack (versions pinned 2026-06-25)

### Frontend

- `next@16.2.9` (App Router)
- `react@19.2.7` / `react-dom@19.2.7`
- `typescript@6.0.3`
- `tailwindcss@4.3.0` (CSS-first config)
- `shadcn/ui` (latest)
- `@tanstack/react-query@5.101.0`
- `zustand@5.0.14`
- `@serwist/next@9.5.11` / `serwist@9.5.11` — PWA
- `dexie@4.4.3` — オフライン (IndexedDB)

### 医薬品マスタ（全て無料取得）

| データソース           | 提供元                   | 形式             | 更新頻度    | 用途                                               |
| ---------------------- | ------------------------ | ---------------- | ----------- | -------------------------------------------------- |
| SSK基本マスター        | 社会保険診療報酬支払基金 | CSV/ZIP          | 改定時+月次 | 薬剤本体（YJコード/薬価/薬効分類/後発品/麻薬区分） |
| HOTコードマスター      | MEDIS                    | ZIP              | 随時        | コード横断結合キー（HOT↔YJ↔レセ電↔JAN）            |
| 薬価基準収載品目リスト | 厚労省                   | Excel            | 年1-2回     | 薬価・後発品区分                                   |
| 一般名処方マスタ       | 厚労省                   | Excel            | 年1回       | 一般名→後発品対応                                  |
| PMDA添付文書           | PMDA                     | XML(新)/SGML(旧) | 随時        | 禁忌・相互作用・副作用（メディナビ経由DL）         |
| 高齢者PIMリスト        | 厚労省                   | PDF              | 数年        | 高齢者不適正薬（手動構造化）                       |
| 腎機能別用量調整       | JSNP                     | PDF              | 年1回       | 腎機能別投与量（手動構造化）                       |

### Backend / Data Access

- `prisma@7.8.0` / `@prisma/client@7.8.0` — ORM + RLS連携
- `zod@4.4.3` — バリデーション
- `@sentry/nextjs@10.60.0` — エラー監視
- `@aws-sdk/client-cognito-identity-provider` — Cognito認証
- `@aws-sdk/client-s3` / `@aws-sdk/s3-request-presigner` — S3操作
- `@aws-sdk/client-ses` — メール送信
- `next-auth@4.24.14` — Cognito連携のセッション管理

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
- `eslint@9.39.4` — flat config
- `prettier@3.8.4`
- `vitest@4.1.9` / `@vitest/coverage-v8@4.1.9` — ユニットテスト
- `@playwright/test@1.60.0` — E2E
- `date-fns@4.4.0` — 日付（日本語ロケール）

## Language

- Communication: 日本語
- Commit messages: English
- Identifiers and code symbols: English (camelCase)
- Comments and documentation: 日本語可（医療ドメイン用語の正確性を優先）
- DB columns: English (snake_case)

## Directory Structure

```
ph-os/
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
DATABASE_URL=          # postgresql://user:pass@rds-endpoint:5432/ph-os
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

## Autonomous Refinement Loop (Claude × Codex × agmsg × gbrain)

Claude / Codex を agmsg 経由で maker/checker に割り当てる継続改善ループの運用基盤は `.agent-loop/` にある。**ループを回す前に `.agent-loop/README.md` を読むこと**（運用の SSOT）。現在の live transport identity は `claude` と `codex` の 2 つのみで、`claude-lead` / `codex-lead` は supervisor role descriptor として扱う。

- **maker/checker 分離**: 実装した側は自己完了判定しない（Claude 実装→Codex review、逆も同様）。最終判定は objective gate（`pnpm lint` / `typecheck` / `typecheck:no-unused` / `format:check` / `test` / `build` / 必要時 `test:e2e`）に寄せる。`.agent-loop/GATE_CONFIG.md` 参照。
- **編集規律**: 編集前に agmsg で対象 path を LOCK、commit 前に inbox drain、自ファイルのみ stage。`.agent-loop/LOCKS.md` / `MESSAGE_PROTOCOL.md`（AGLOOP v5）。
- **Claude main dispatcher discipline**: Claude の main loop は inbox drain、ACK/LOCK/review routing、subagent steering、commit に寄せる。`PLAN_REVIEW_REQUEST` / `PATCH_REVIEW_REQUEST` / `VERIFY_REQUEST` / `LOCK_REQUEST` / `HANDOFF` / `PAUSE_REQUEST` / `URGENT` / `CHANGES_REQUESTED` を受けたら、長い review/gate の前に短い ACK/STATUS を返す。自分が送信側のときも ACK/verdict を受けるまで受領済みとみなさず、同じ maker/checker ペアに未処理 PATCH を積み重ねない。
- **Long gate discipline**: `pnpm build` と `pnpm typecheck` / `pnpm typecheck:no-unused` は並列実行しない（`.next/types` race 回避）。長い gate は subagent/background に回し、main loop は Codex からの agmsg を drain できる状態を保つ。
- **gbrain**: 長期記憶だが現在の repo 状態・テスト・型・lint・build より**優先しない**。※ 2026-06-20 接続済み（ローカル postgres、`mcp__gbrain__*` は次回 Claude Code 起動後に有効）。詳細は下記 GBrain Configuration。

## GBrain Configuration (configured by /setup-gbrain, 2026-06-20)

- Mode: local-stdio / Engine: postgres (localhost、cloud 同期オフ — コードは Mac 外に出ない)
- careviax 取込済み: `gbrain import` 131 pages / 1408 chunks、repo policy = **read-write**
- **埋め込み生成済み（semantic 検索可）**: 2026-06-20 に**ローカル埋め込みプロバイダ `ollama:mxbai-embed-large`（1024次元、`http://localhost:11434`）へ切替**。`embed_disabled: false`、default ソース（careviax docs を内包）は **embed 100%**。`gbrain query` / `search` がコサイン類似度ベースで動作する（キーワード検索のみの制約は解消）。
  - ✅ **データ持ち出しなし**: 埋め込みは ollama ローカル完結で外部 API（OpenAI/Voyage）へ送信されない。医療コンプライアンス上の egress 懸念は解消済み（旧 `.agent-loop/BLOCKED.md` gbrain-embeddings は RESOLVED）。
- MCP 登録済み（user scope）。`mcp__gbrain__*` ツールは**セッション開始時ロード** → 既存セッションは要 restart
- 既存 federated sources: default(/Users/yusuke/brain ~1307p, embed 100%) / hermes-knowledge / hermes-knowledge-stack ほか
- **記憶スキーマ SSOT**: 何を・どう gbrain に保存するかは `.agent-loop/GBRAIN_SCHEMA.md` が正本（26 memory types / 共通メタ / slug=`projects/careviax/<category>/<id>` / graph edge / redaction / quality score / Claude×Codex 分担 / MVP phasing）。write-through 先は `/Users/yusuke/brain/projects/careviax/...`（ローカル、Mac 外に出ない）。

### GBrain Search Guidance

- 意味検索・「どこで X を扱う?」→ `gbrain search "<terms>"` / `gbrain query "<question>"`（Grep より先に）
- シンボル定義/参照 → `gbrain code-def <symbol>` / `code-refs` / `code-callers`
- 既知の正確な文字列・regex・glob は Grep のまま。ループの Memory Bootstrap はこの gbrain を一次ソースにする（ただし live repo 状態が優先）。
- **新機能**: どちらに投げても `.agent-loop/FEATURE_QUEUE.md` 経由でループに載せる（`prompts/feature-intake.md`）。
- **hard stop / security**: auth/billing/payments/security/破壊的 migration/本番 deploy は承認なしに触らない（`.agent-loop/BLOCKED.md` へ退避）。

### GBrain Memory Writeback

gbrain は「過去ログ」ではなく**次サイクルの判断精度を上げる再利用可能知識**を保存する長期記憶層。保存対象・粒度・メタデータ・graph edge・redaction は **`.agent-loop/GBRAIN_SCHEMA.md`** が SSOT。

- **保存する**（§4）: LoopRun / ImplementationDecision / FailurePattern / FixPattern / ReviewFinding / GateResult / DuplicateMap / RejectedApproach / BlockedContext / CandidateLesson / StaleMemory ほか。**保存しない**: 会話全文・raw log 全文・secret/token/.env・PHI・未検証推測・一回限りの偶然。
- **書く前に**（§15）: redact（secret/PHI）→ evidence 添付 → confidence/evidence_level/validity_scope 設定 → tag → link（`gbrain link --link-type`）→ dedupe。書いた後に `memory_id`(slug) を `.agent-loop/STATE.md` に追記。テンプレートは `.agent-loop/templates/gbrain/`。
- **昇格**: CandidateLesson → VerifiedLesson(2+独立run) → StableRuleCandidate → AGENTS.md/CLAUDE.md は `.agent-loop/PROMOTION_QUEUE.md` の §13 gate（両 supervisor 合意＋objective gate＋人間承認）を通す。**自動昇格しない**。
- **優先順位**: gbrain 記憶 < 現在の repo / テスト / 型 / lint / build。矛盾時は repo を正とし旧記憶を `StaleMemory` 化。**埋め込みは生成済み**（ローカル `ollama:mxbai-embed-large` 1024d、外部送信なし）→ semantic `gbrain query` / `search` が利用可能。
