---
type: ImplementationDecision
title: Bind production client IP trust to an exact reverse-proxy topology
branch: codex1/continuous-optimization-20260716
source:
  - 'file:src/lib/api/proxy-trust.ts'
  - 'file:src/lib/api/request-ip.ts'
  - 'file:src/lib/env/assert-env.ts'
  - 'file:tools/infra/ph-os-nginx.conf'
  - 'file:tools/scripts/aws-lightsail-runtime-env-validate.ts'
  - 'commit:5337df5a3'
  - >-
    test:pnpm vitest run src/lib/api/proxy-trust.test.ts
    src/lib/api/request-ip.test.ts src/proxy.test.ts
  - 'test:pnpm typecheck'
created: '2026-07-16T02:25:59.000Z'
task_id: OPS-RATE-CLIENT-IP-READINESS-001
repo_url: 'https://github.com/yusuketakuma/careviax.git'
memory_id: projects/careviax/decisions/2026-07-16/trusted-proxy-client-ip-topology
confidence: high
created_at: '2026-07-16T02:25:59.000Z'
created_by: codex-lead
expires_at: null
feature_id: null
project_id: careviax
updated_at: '2026-07-16T02:25:59.000Z'
owner_agent: codex-lead
commit_after: 5337df5a3
commit_before: 75edae16b
superseded_by: null
evidence_level: gate_verified
reviewer_agent: null
validity_scope:
  repo: careviax
  files:
    - src/lib/api/proxy-trust.ts
    - src/lib/api/request-ip.ts
    - tools/infra/ph-os-nginx.conf
  tech_stack:
    - Next.js
    - TypeScript
    - Nginx
    - AWS Lightsail
  directories:
    - src/lib/api
    - src/lib/env
    - tools/infra
    - tools/scripts
ingested_via: put_page
ingested_at: '2026-07-16T02:26:36.789Z'
source_kind: put_page
tags:
  - accepted
  - client-ip
  - codex
  - lightsail
  - proxy
  - rate-limit
  - security
---

# Bind production client IP trust to an exact reverse-proxy topology

## Problem

- Production rate limiting rejects unauthenticated requests when no client IP is available, but the Lightsail example disabled proxy trust and the startup/readiness validators accepted that configuration.
- Enabling trust alone was unsafe because the generated plan published the Next.js port directly and the old parser selected the first client-controlled X-Forwarded-For entry.

## Decision

- Make proxy trust a shared typed contract: explicit trust, topology, exact trailing-hop count, and an ordered CIDR for every trusted append-chain hop.
- For the default Lightsail topology, bind the application container to loopback and make checked-in Nginx the sole public hop. Nginx overwrites X-Forwarded-For, and runtime accepts exactly one canonical IP in single-overwrite mode.
- For an approved append chain, select from the right, validate the full trusted suffix and CIDR order, and ignore only untrusted entries to the left of the resolved client.
- Remove x-real-ip fallback. Missing, malformed, oversized, decorated, out-of-range, or topology-inconsistent input returns no client identity and remains fail-closed in production.
- Apply the same contract to startup safety, AWS readiness, Lightsail env validation, examples, and both plan generators.

## Alternatives rejected

- Set TRUST_PROXY_HEADERS=true while publishing port 3000 directly because any client could forge the security identity.
- Select the first XFF value because AWS append behavior retains client-prepended values.
- Fall back to x-real-ip after invalid XFF because that changes the authority header after validation failure.
- Trust hop count without CIDR constraints because a shorter or unexpected proxy path could select an attacker-controlled address.

## Migration

- From optional trust flags and direct port publication to explicit topology validation plus a loopback-bound application and overwrite proxy.
- Multi-hop deployments must update both reverse-proxy behavior and runtime topology/CIDR declarations before rollout.

## Verification

- Proxy/request/startup/readiness/plan/auth-context focused suites passed 9 files / 130 tests; password-reset and MFA route suites passed 2 files / 15 tests.
- Production proxy smoke covered credentials callback, password reset, and MFA recovery through the DynamoDB rate-limit path.
- Typecheck, exact ESLint, Prettier, shell syntax, response/authz/boundary/Plans static gates, and generated-plan loopback assertions passed.
- Local AWS readiness reported zero failures; live proxy mutation and deployment were not run.

## Review

- codex2 was unavailable. Official Next.js self-hosting guidance, AWS XFF contracts, focused security tests, and repository gates supplied objective evidence.

## Future rule candidate

- Never trust a forwarded client identity unless the application port is unreachable outside a declared proxy path and every trusted suffix hop is constrained.

## Links

- canonical: [[file:src/lib/api/proxy-trust.ts]]
