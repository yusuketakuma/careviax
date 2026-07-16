---
type: ImplementationDecision
title: Pin every FileAsset to a verified S3 object version and checksum
branch: codex1/continuous-optimization-20260716
source:
  - 'file:src/server/services/file-storage.ts'
  - >-
    file:prisma/migrations/20260716124500_add_file_asset_object_identity/migration.sql
  - 'file:tools/infra/file-storage-versioning.json'
  - 'file:tools/scripts/pin-file-asset-object-identity.ts'
  - 'commit:051aff5e5'
  - >-
    test:pnpm vitest run src/server/services/file-storage.test.ts
    src/app/api/files/presigned-upload/route.test.ts
    tools/scripts/pin-file-asset-object-identity.test.ts
  - 'test:pnpm db:e2e:verify-migration-preconditions'
  - 'test:pnpm db:e2e:rls-proof-role'
created: '2026-07-16T02:01:43.000Z'
task_id: SEC-FILE-OBJECT-IMMUTABILITY-001
repo_url: 'https://github.com/yusuketakuma/careviax.git'
memory_id: projects/careviax/decisions/2026-07-16/file-object-version-identity
confidence: high
created_at: '2026-07-16T02:01:43.000Z'
created_by: codex-lead
expires_at: null
feature_id: null
project_id: careviax
updated_at: '2026-07-16T02:01:43.000Z'
owner_agent: codex-lead
commit_after: 051aff5e5
commit_before: a86dea0b4
superseded_by: null
evidence_level: gate_verified
reviewer_agent: null
validity_scope:
  repo: careviax
  files:
    - src/server/services/file-storage.ts
    - prisma/schema/admin.prisma
    - tools/infra/file-storage-versioning.json
  tech_stack:
    - Next.js
    - TypeScript
    - Prisma
    - PostgreSQL
    - Amazon S3
  directories:
    - src/server/services
    - src/app/api/files
    - prisma
    - tools/infra
    - tools/scripts
ingested_via: put_page
ingested_at: '2026-07-16T02:02:38.048Z'
source_kind: put_page
tags:
  - accepted
  - checksum
  - codex
  - file-storage
  - s3
  - security
  - versioning
---

# Pin every FileAsset to a verified S3 object version and checksum

## Problem

- FileAsset rows identified only an S3 key, so a later write to the same key could change bytes served by a previously completed record.
- Upload completion did not persist a version-pinned object identity, and legacy rows could be downloaded through the latest object at that key.

## Decision

- Require client SHA-256 for presigned uploads and sign the S3 checksum header.
- Require bucket Versioning, verify size, MIME type, checksum, and VersionId at completion, then persist sha256 and storage_version_id with a pending-to-uploaded compare-and-swap.
- Pin every download and generated-file cleanup to the stored VersionId, enable response checksum verification, and fail closed when an uploaded legacy row lacks object identity.
- Migrate legacy rows only from an operator-provided manifest containing an exact VersionId and SHA-256; verify that exact version before a tenant-scoped update and emit an exclusive mode-0600 rollback snapshot.

## Alternatives rejected

- Trust the latest object at a stable key because overwrite or delete-marker behavior can change the bytes represented by an existing FileAsset.
- Persist ETag as content identity because ETag is not a universal SHA-256 integrity contract.
- Infer legacy identity from the current key because that can silently bless an overwritten object.

## Migration

- From key-only FileAsset identity to nullable sha256 and storage_version_id columns, with new uploads requiring both before status becomes uploaded.
- Existing uploaded rows remain fail-closed until an exact-version manifest is dry-run verified and explicitly applied.

## Verification

- Focused storage and adjacent suites passed, including version mismatch, checksum mismatch, completion race, exact-version download, and migration-tool cases.
- Typecheck, exact ESLint, format, static contract gates, local migration/seed, RLS contract 24/24, and NOBYPASS proof 5/5 passed.
- AWS readiness and ECS policy validation had zero failures; live AWS checks were skipped because no production target was applied.

## Review

- codex2 was unavailable in the active tmux topology. Repository tests, database gates, static gates, and official AWS contracts supplied the independent objective evidence.

## Future rule candidate

- Persist immutable object identity as key plus exact VersionId plus cryptographic checksum, and never backfill identity from a mutable latest-key read.

## Links

- canonical: [[file:src/server/services/file-storage.ts]]
