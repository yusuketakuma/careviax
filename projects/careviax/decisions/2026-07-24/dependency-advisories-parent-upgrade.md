---
type: ImplementationDecision
title: Resolve dependency advisories through patched parents and verified overrides
branch: codex1/continuous-optimization-20260716
source:
  - 'file:package.json'
  - 'file:pnpm-workspace.yaml'
  - 'file:pnpm-lock.yaml'
  - 'commit:8543532c608358b9c85a1ea2047b509c8202a09d'
  - 'test:pnpm-audit-prod-moderate'
  - 'test:pnpm-audit-moderate'
  - 'test:focused-next-prisma-image-proxy-regressions'
task_id: SEC-DEPENDENCY-AUDIT-20260723-001
repo_url: 'https://github.com/yusuketakuma/careviax.git'
memory_id: projects/careviax/decisions/2026-07-24/dependency-advisories-parent-upgrade
confidence: high
created_at: '2026-07-23T15:48:55.000Z'
created_by: codex-lead
expires_at: null
feature_id: null
project_id: careviax
updated_at: '2026-07-23T15:48:55.000Z'
owner_agent: codex-lead
commit_after: 8543532c608358b9c85a1ea2047b509c8202a09d
commit_before: 3643bd94d4
superseded_by: null
evidence_level: gate_verified
reviewer_agent: null
validity_scope:
  repo: careviax
  files:
    - package.json
    - pnpm-workspace.yaml
    - pnpm-lock.yaml
  tech_stack:
    - Next.js
    - Auth.js
    - Prisma
    - Sharp
    - pnpm
  directories: []
ingested_via: put_page
ingested_at: '2026-07-23T15:49:46.073Z'
source_kind: put_page
tags:
  - accepted
  - authjs
  - codex
  - dependencies
  - nextjs
  - prisma
  - security
  - sharp
  - validation
---

# Resolve dependency advisories through patched parents and verified overrides

## Problem

- summary: The production graph exposed one critical, eight high, and ten moderate advisories across Next.js, next-auth, Sharp, fast-uri, Hono, and @hono/node-server.
- evidence: `pnpm why` showed Hono and node-server owned by Prisma 7.8 through @prisma/dev, while Sharp was an optional Next.js dependency constrained to the vulnerable 0.34 line.

## Decision

- adopted: Upgrade Next.js and eslint-config-next to 16.2.11, next-auth to 4.24.15, and the Prisma trio to 7.9.0. Remove the Hono and node-server workspace overrides because Prisma 7.9 removes those dependencies. Pin fast-uri 3.1.4 and Sharp 0.35.3 through workspace overrides.
- reason: Updating the owning parent removes incompatible transitive dependencies instead of forcing an unreviewed child major. The Sharp override is safe only after resolving it from the Next.js package and exercising the real Next image optimizer with an in-memory PNG.

## Alternatives rejected

- Ignore advisories, add an allowlist, or lower the audit threshold — leaves known production vulnerabilities unresolved.
- Force @hono/node-server 2.x below Prisma 7.8 — crosses a child major without an upstream compatibility contract.
- Keep Sharp 0.34 because Next.js declares ^0.34.5 — leaves the advisory open; the verified 0.35.3 override satisfies the runtime on Node 24.

## Migration

- from: Next.js 16.2.9, next-auth 4.24.14, Prisma 7.8.0, Sharp 0.34.5, fast-uri 3.1.2, Hono 4.12.25, node-server 1.19.14
- to: Next.js 16.2.11, next-auth 4.24.15, Prisma 7.9.0, Sharp 0.35.3, fast-uri 3.1.4, with Hono and node-server absent from the graph

## Verification

- `pnpm audit --prod --audit-level moderate` and required-CI `pnpm audit --audit-level moderate` returned no known vulnerabilities.
- `pnpm why` and `pnpm list --depth 8 --prod` showed one patched version for each retained dependency and no Hono or node-server path.
- Prisma schema validation and generation, Next image optimizer PNG conversion, 16 focused files with 163 tests, supply-chain and vulnerability parity checks, lint, typecheck, no-unused, format, boundaries, task registry, and frozen lockfile installation passed.
- Full build remains intentionally deferred to the repository integration boundary.

## Review

- reviewer: null; result: validated by the active codex1 single-seat gate set

## Future rule candidate

- For transitive security advisories, prefer an upstream-compatible parent upgrade that removes the vulnerable path; use a child override only when its engine and real consumer runtime are verified.

## Links

- canonical: [[file:package.json]]
- canonical: [[file:pnpm-workspace.yaml]]
- canonical: [[file:pnpm-lock.yaml]]
