# PH-OS Pharmacy

PH-OS Pharmacy は、在宅訪問に強い保険薬局のための業務・連携プラットフォームです。患者・ケースを中心に、処方取込、調剤、監査、セット、訪問準備、訪問記録、報告、算定、タスク、通知、監査ログを 1 つの Next.js / PostgreSQL アプリでつなぎます。

このリポジトリは CareVIAx / PH-OS の薬局機能を現在の主対象として実装しています。将来の訪問診療、訪問看護、地域在宅支援ネットワークへの拡張は、モジュラーモノリスの境界として予約していますが、現時点で実装対象としている業務価値は薬局在宅ケアです。

## What This System Does

PH-OS は、在宅患者に関わる薬局内外の業務状態を「次に誰が何をするか」まで落とし込む運用 OS です。

- 患者・ケース管理: 患者一覧、患者詳細、Patient / Case Command Center、Case Risk Cockpit、基盤情報、同意、管理計画、ケアチーム、タイムライン。
- 処方・薬剤管理: 処方受付、QR / JAHIS 系取込、薬剤マスタ、処方サイクル、薬剤変更、疑義照会、残薬、薬学リスク。
- 調剤工程: 調剤、調剤監査、セット、セット監査、バーコード確認、保留、工程別ワークベンチ。
- 訪問業務: 訪問スケジュール、候補提案、患者連絡、訪問準備、訪問ブリーフ、訪問記録、オフライン下書き、添付、位置情報、報告 readiness。
- 報告・共有: ケアレポート、訪問記録からの下書き生成、PDF / 印刷、送付、外部共有、会議記録、連携コメント。
- 算定・運用管理: 算定候補、請求根拠、請求ルール、集金、タスク SLA、通知、監査ログ、パフォーマンス、pilot readiness。
- 薬局間・地域連携: 連携薬局、薬局訪問依頼、handoff、外部専門職、施設、カンファレンス、フリーランス薬剤師や PH-OS 運営者の将来横断運用を想定した設計。

PH-OS は既存のレセコン、電子薬歴、フル在庫管理システムを置き換えるものではありません。責務は、在宅訪問薬剤管理の工程、リスク、連携、証跡、算定確認をつなぐことです。

## Product Scope

現在の active module は `pharmacy` のみです。

```text
activeModules = [pharmacyModule]
```

アーキテクチャ上は `home_medical`、`home_nursing`、`network_ops` を予約していますが、これは将来の拡張点です。共通 core が薬局固有実装へ直接依存しないよう、module registry、collaboration provider、risk provider、task registry、patient workspace panel、visit brief contributor へ段階的に分離しています。

詳細は [Backend Module Boundary](docs/architecture/module-boundary.md) と [Module Registry](docs/architecture/module-registry.md) を参照してください。

## Main Screens

主要画面は `src/app/(dashboard)` 配下にあります。

| Area                  | Routes                                                                                 |
| --------------------- | -------------------------------------------------------------------------------------- |
| Dashboard             | `/dashboard`, `/my-day`, `/workflow`                                                   |
| Patients              | `/patients`, `/patients/[id]`, `/patients/new`, `/patients/compare`                    |
| Prescriptions         | `/prescriptions`, `/prescriptions/intake`, `/prescriptions/qr-drafts`, `/qr-scan`      |
| Dispensing            | `/dispense`, `/audit`, `/set`, `/set-audit`                                            |
| Scheduling and visits | `/schedules`, `/schedules/proposals`, `/visits`, `/visits/[id]`, `/offline-sync`       |
| Reports and billing   | `/reports`, `/reports/[id]`, `/billing`, `/billing/candidates`                         |
| Collaboration         | `/communications`, `/conferences`, `/handoff`, `/external`, `/notifications`, `/tasks` |
| Admin                 | `/admin/*`, `/settings`, `/statistics`, `/audit`                                       |

認証画面は `src/app/(auth)`、外部共有画面は `src/app/shared/[token]`、API は `src/app/api` にあります。

## Architecture

PH-OS はマイクロサービスではなく、モジュラーモノリスです。

```text
Next.js App Router
  -> Route Handlers / Server Actions / BFF
  -> server services and module adapters
  -> Prisma / PostgreSQL
  -> AWS-ready integrations
```

主な構成:

- Next.js 16 App Router, React 19, React Compiler, standalone output
- TypeScript, Zod, TanStack Query / Table, React Hook Form, Zustand
- Prisma 7 + PostgreSQL を中心にした業務データモデル
- NextAuth + Cognito 前提の認証設計
- S3 file storage、SES、DynamoDB rate limit、CloudWatch metrics、ECS / Lightsail plan を含む AWS 運用資産
- Serwist service worker と offline draft / sync 系の PWA 基盤
- Vitest と Playwright による unit / API / UI / E2E 検証
- RLS、route catalog、audit log、no-store、PHI redaction を前提にした医療情報境界

## Repository Layout

```text
ph-os/
├── docs/       # Architecture, compliance, operations, testing, design docs
├── prisma/     # Prisma schema split by domain, migrations, seed
├── public/     # Static assets and generated service worker output
├── src/        # Next.js app, API routes, server services, core/modules/lib/types
├── tools/      # Operational scripts, infra templates, Playwright tests
├── Plans.md    # Implementation backlog and progress plan
└── README.md   # This overview
```

重要な entry point:

- `src/app/`: App Router pages and API route handlers
- `src/core/`: module-independent core contracts and registries
- `src/modules/pharmacy/`: current pharmacy feature module adapters
- `src/server/`: server-only services, jobs, BFF orchestration
- `src/lib/`: shared runtime libraries, auth, API helpers, task registry, validation
- `src/types/`: public DTO and cross-boundary type contracts
- `tools/scripts/`: readiness, AWS, DB, performance, compliance, import, and audit scripts
- `tools/tests/`: Playwright E2E and UI audit tests
- `tools/infra/`: AWS and security baseline templates

## Getting Started

### Requirements

- Node.js `24.16.0`
- pnpm `11.5.2`
- PostgreSQL for local DB / E2E DB when running database-backed flows

Install dependencies:

```bash
pnpm install
```

Generate Prisma client:

```bash
pnpm db:generate
```

Start the development server:

```bash
pnpm dev
```

For the local E2E profile, prepare the E2E database first and run the pinned local server on port `3012`:

```bash
pnpm db:e2e:prepare
pnpm dev:e2e:local
```

Then run Playwright against the local server:

```bash
pnpm test:e2e:local
```

Local environment variables and production secrets are not documented in full in this README. Use the environment catalog and operations docs instead, and never commit `.env` files or secret values.

## Common Validation Commands

Run focused commands for the area you changed. Common gates are:

```bash
pnpm lint
pnpm typecheck
pnpm typecheck:no-unused
pnpm test
pnpm test:e2e:list
pnpm boundaries:check
pnpm colors:check
pnpm format:check
```

Operational and release-readiness checks:

```bash
pnpm perf:smoke
pnpm pilot:readiness
pnpm aws:deploy:readiness
pnpm medical-ui:e2e:gate
pnpm test:rls-proof
```

Database-backed local E2E assumes the configured PostgreSQL instance is available, commonly on the repository's E2E connection settings.

## Security, Privacy, and Compliance Boundary

This repository handles healthcare workflow code paths and PHI-adjacent surfaces. Treat all patient, prescription, visit, report, file, notification, audit, and billing surfaces as sensitive by default.

Core rules:

- Do not commit secrets, tokens, credentials, private keys, raw patient data, production dumps, or `.env` files.
- Public API responses must not expose S3 storage keys, original file names, signed URLs, raw provider errors, raw metadata, or unrestricted free text.
- Authenticated routes should use shared auth context, permission checks, organization scoping, and audit logging patterns.
- Tenant-owned data should be constrained by `org_id`; RLS and application-layer guards are both part of the design.
- Clinical output, CSV/PDF export, file download, external share, and notification delivery must go through masking, no-store, audit, and permission boundaries.

Relevant docs:

- [API conventions](docs/api-conventions.md)
- [Compliance docs](docs/compliance/README.md)
- [Architecture docs](docs/architecture/README.md)
- [Testing docs](docs/testing/README.md)

## AWS and Deployment Direction

The repository contains planning and validation assets for three AWS stages:

1. Low-cost pilot: Lightsail App VM, Lightsail PostgreSQL, S3, Cognito, SES, CloudWatch, DynamoDB rate limiting, ECR, Route 53, ACM.
2. Production minimum: ECS Express / Fargate, ALB, RDS PostgreSQL, S3 Object Lock, Cognito, SES, DynamoDB, CloudWatch, Secrets Manager, EventBridge Scheduler.
3. Scale-out: multiple Fargate tasks, RDS Multi-AZ, durable queues, WAF, GuardDuty, Security Hub, CloudTrail, AWS Backup.

See [AWS Deployment Stages and Tenant Boundary ADR](docs/architecture/aws-phos-deployment-stages.md). When changing AWS-related code, scripts, IAM, S3, RDS, ECS, DynamoDB, SES, Cognito, CloudWatch, Route 53, ACM, Secrets Manager, or EventBridge behavior, verify against official AWS documentation before implementation and record the reference in the relevant plan, state, or PR notes.

## Documentation Map

- [Docs index](docs/README.md)
- [Architecture index](docs/architecture/README.md)
- [Operations index](docs/operations/README.md)
- [Compliance index](docs/compliance/README.md)
- [Testing index](docs/testing/README.md)
- [UI/UX design guidelines](docs/ui-ux-design-guidelines.md)
- [Implementation plan](Plans.md)
- [Tools index](tools/README.md)

## Development Notes

- Prefer existing route, presenter, DTO, auth, audit, and validation patterns over new one-off abstractions.
- Keep API route handlers thin; move orchestration into server services or module application code.
- Preserve existing response shapes unless a planned API-contract migration explicitly says otherwise.
- Use `src/core` for module-independent contracts and `src/modules/pharmacy` for pharmacy-specific adapters.
- Keep new common-core code from importing `src/modules/pharmacy` directly.
- Validate changes with the smallest meaningful command first, then broader gates when the impact radius warrants it.

## Status

This is a private product repository under active development. The README is intended as the top-level orientation for engineers and operators; detailed release readiness remains in `Plans.md`, `ops/refactor/STATE.md`, and the operations/compliance docs.
