---
type: SecurityFinding
title: Browser CSRF checks use the server canonical origin
branch: codex1/continuous-optimization-20260716
source:
  - 'file:src/proxy.ts'
  - 'file:src/proxy.test.ts'
  - >-
    file:node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md
  - 'test:pnpm exec vitest run src/proxy.test.ts'
  - 'test:pnpm typecheck:no-unused'
task_id: SEC-CSRF-CANONICAL-ORIGIN-001
repo_url: null
memory_id: projects/careviax/decisions/2026-07-16/canonical-csrf-origin
confidence: high
created_at: '2026-07-16T00:50:54.000Z'
created_by: codex-lead
dedupe_key: e0c2277a7271bdab37dc38d63e87bf0dec5e114f792b696388c5c87a8e90961d
expires_at: null
feature_id: null
project_id: careviax
updated_at: '2026-07-16T00:50:54.000Z'
owner_agent: codex-lead
commit_after: null
commit_before: 8c58f30001b84a37a9982898143012686b6f32f7
superseded_by: null
evidence_level: gate_verified
reviewer_agent: null
validity_scope:
  repo: careviax
  files:
    - src/proxy.ts
    - src/proxy.test.ts
  tech_stack:
    - Next.js
    - TypeScript
    - HTTP
  directories:
    - src
ingested_via: put_page
ingested_at: '2026-07-16T00:51:26.138Z'
source_kind: put_page
tags:
  - accepted
  - codex-lead
  - csrf
  - nextjs
  - origin
  - proxy
  - security
---

# Browser CSRF checks use the server canonical origin

## Risk

- Host-only comparison ignored scheme and port, trusted the raw Host header, and allowed a mismatched Origin to fall through to a matching Referer or S2S API-key exception.
- In production this could accept a state-changing browser request that was not same-origin with the configured application URL.

## Policy

- `NEXTAUTH_URL` is the production browser-origin authority. It must parse as HTTPS and comparison uses its normalized `URL.origin`, including effective port.
- A present Origin header is authoritative: malformed, opaque, multiple, credential-bearing, path-bearing, or mismatched values fail immediately. Referer is considered only when Origin is absent.
- Raw Host and `NEXT_PUBLIC_APP_URL` are not production CSRF authorities.
- The API-key exception is limited to POST requests with one job path segment and no browser Origin or Referer.

## Detection

- Adversarial proxy tests cover wrong scheme/port, null/multiple/malformed Origin, matching Referer after mismatched Origin, raw Host spoofing, public URL drift, insecure production configuration, and S2S method/path/origin boundaries.

## Resolution

- Centralized canonical parsing and exact browser-header validation in the single Next.js 16 proxy.
- Focused proxy tests passed 47/47; exact ESLint, API response shape, route auth wrapper, and no-unused typecheck passed.

## Links

- canonical: [[file:src/proxy.ts]]
