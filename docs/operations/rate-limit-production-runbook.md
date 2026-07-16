# PH-OS Production Rate-Limit Runbook

## Required Runtime Contract

- `RATE_LIMIT_STORE=dynamodb`
- `RATE_LIMIT_DDB_TABLE_NAME` points to the production rate-limit table
- `RATE_LIMIT_DDB_REGION` is set or `AWS_REGION` is set
- The table uses `pk` as the string partition key
- DynamoDB TTL is enabled on `expires_at`
- The application runtime role can call `dynamodb:UpdateItem` only on the rate-limit table
- `TRUST_PROXY_HEADERS=true`
- `TRUSTED_PROXY_TOPOLOGY=single-overwrite` and `TRUSTED_PROXY_HOPS=0` for the checked-in Lightsail topology
- The application container is bound only to `127.0.0.1:3000`; `tools/infra/ph-os-nginx.conf` is the sole public hop and overwrites `X-Forwarded-For`

Prefer runtime/container credentials over static AWS access keys. If both container credentials and static keys exist, PH-OS uses the container credentials first. For Edge/proxy deployments that cannot read local token files, project `AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE` into `AWS_CONTAINER_AUTHORIZATION_TOKEN` before starting the app.

## Trusted Client-IP Topology

Never enable proxy-header trust while the application port is publicly reachable. The checked-in Lightsail plan binds Next.js to loopback and places Nginx in front of it. Nginx replaces any client-supplied `X-Forwarded-For` value with the TCP peer address, so `single-overwrite` accepts exactly one canonical IP literal.

If an approved CDN or load balancer is inserted, change the reverse-proxy configuration and runtime declaration to `append-chain` only after documenting the exact fixed chain, setting `TRUSTED_PROXY_HOPS` to the number of trusted entries to the right of the client address, and listing the corresponding left-to-right network ranges in `TRUSTED_PROXY_CIDRS`. A missing, malformed, out-of-range, or undersized trusted suffix must fail closed. Do not use ALB `preserve` mode or enable XFF client-port preservation; PH-OS accepts IP literals, not address-and-port values.

Official contracts confirmed 2026-07-16:

- [Next.js self-hosting](https://nextjs.org/docs/app/guides/self-hosting) recommends a reverse proxy in front of the Next.js server.
- [AWS Application Load Balancer X-Forwarded headers](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/x-forwarded-headers.html) documents append/preserve/remove behavior and warns that entries are trustworthy only when secured by the network path.
- [Lightsail distribution request behavior](https://docs.aws.amazon.com/lightsail/latest/userguide/amazon-lightsail-distribution-request-and-response.html) documents that viewer-supplied XFF is retained and the viewer address is appended, so selecting the first entry is unsafe.

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
