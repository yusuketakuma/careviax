# CareViaX Pharmacy

在宅訪問に強い保険薬局向けの業務・連携プラットフォームです。Next.js App Router を中心に、調剤、監査、セット監査、訪問スケジュール、多職種連携を 1 つのリポジトリで扱います。

## Repository Layout

GitHub のトップでは、継続的に編集するアプリ本体と運用資産だけが見える構成に寄せています。

```text
careviax/
├── docs/      # 仕様、設計、運用ガイド、監査・テスト用ドキュメント
├── prisma/    # Prisma schema, migrations, generated client settings
├── public/    # Static assets
├── src/       # Application and server code
└── tools/     # Operational assets: infra templates, scripts, Playwright tests
```

## Key Entry Points

- `src/app/` : App Router pages and route handlers
- `src/server/` : jobs, services, server-only orchestration
- `tools/scripts/` : 運用レポート、バックアップ確認、pilot readiness などの CLI
- `tools/tests/` : Playwright による E2E / UI 監査
- `tools/infra/` : AWS / セキュリティ / 運用テンプレート
- `tools/README.md` : `tools/` 配下の index

## Docs

- `docs/README.md` : ドキュメント全体の index
- `docs/compliance/README.md` : compliance docs の入口
- `docs/operations/README.md` : operations docs の入口
- `CLAUDE.md` : プロジェクト方針と設計原則
- `Plans.md` : 実装計画と進行中タスク
- `docs/testing/README.md` : testing docs の入口
- `docs/testing/TESTING.md` : テスト規約
- `docs/testing/PROMPT_PLAYWRIGHT_AUDIT_MASTER.md` : Playwright 監査用マスタープロンプト

## Common Commands

```bash
pnpm dev
pnpm build
pnpm lint
pnpm test
pnpm test:e2e
pnpm test:e2e:list
pnpm test:e2e:audit
pnpm db:generate
```
