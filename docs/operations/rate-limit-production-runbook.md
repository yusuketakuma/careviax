# PH-OS Production Rate-Limit Runbook

## Required Runtime Contract

- `RATE_LIMIT_STORE=dynamodb`
- `RATE_LIMIT_DDB_TABLE_NAME` points to the production rate-limit table
- `RATE_LIMIT_DDB_REGION` is set or `AWS_REGION` is set
- The table uses `pk` as the string partition key
- DynamoDB TTL is enabled on `expires_at`
- The application runtime role can call `dynamodb:UpdateItem` only on the rate-limit table

Prefer runtime/container credentials over static AWS access keys. If both container credentials and static keys exist, PH-OS uses the container credentials first. For Edge/proxy deployments that cannot read local token files, project `AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE` into `AWS_CONTAINER_AUTHORIZATION_TOKEN` before starting the app.

## Preflight

Run this before production deploy and after IAM/table changes:

```bash
RATE_LIMIT_STORE=dynamodb \
RATE_LIMIT_DDB_TABLE_NAME=ph-os-rate-limit \
AWS_REGION=ap-northeast-1 \
pnpm rate-limit:ddb:verify
```

The verifier checks:

- `DescribeTable` succeeds and the table is `ACTIVE`
- key schema is `pk` string HASH
- TTL is enabled on `expires_at`
- the deployment verifier role can write and delete one non-PHI test counter item

## Deploy Verification

Do not rely only on public `/api/health`; that endpoint intentionally bypasses rate limiting so liveness remains observable. After deploy, call one normal authenticated API route through the same edge/proxy path and confirm it does not return `RATE_LIMIT_UNAVAILABLE`.

## Residual Risk

`GET /api/notifications/stream` still uses an in-process connection gauge. Treat the current `SSE_MAX_CONNECTIONS` as per-instance until the SSE limiter is moved to a distributed lease store.
