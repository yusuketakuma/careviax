# Amazon ElastiCache for Redis — Setup Guide

## Overview

CareViaX uses Amazon ElastiCache for Redis as the Pub/Sub backbone for realtime event delivery (SSE notifications, workflow status updates). When the `REDIS_URL` environment variable is not set, the application falls back to an in-memory adapter suitable for local development.

## Recommended Configuration

### Serverless Mode (5–15 concurrent users)

ElastiCache Serverless automatically scales capacity based on usage, eliminating the need to provision or manage individual cache nodes. This is the recommended mode for CareViaX's initial user base.

| Setting | Value |
|---|---|
| Engine | Redis 7.x |
| Mode | Serverless |
| Region | ap-northeast-1 (Tokyo) |
| VPC | Same VPC as Amplify Hosting / RDS |
| Subnets | Private subnets only (no public access) |
| Security Group | Allow inbound TCP 6379 from application SG only |
| Encryption in-transit | TLS enabled (mandatory) |
| Encryption at-rest | KMS-managed key |
| Authentication | IAM authentication or Redis AUTH token via Secrets Manager |

### Environment Variable

```
REDIS_URL=rediss://<auth-token>@<elasticache-endpoint>:6379
```

- Use `rediss://` (double-s) to enforce TLS connections.
- Store the full URL in AWS Secrets Manager and inject via Amplify environment variables.

## VPC Connectivity

Amplify Hosting (compute) must reside in the same VPC as ElastiCache, or use VPC peering / PrivateLink. Ensure:

1. The Amplify compute security group has an **outbound** rule allowing TCP 6379.
2. The ElastiCache security group has an **inbound** rule allowing TCP 6379 from the Amplify compute security group.
3. Route tables allow traffic between the subnets.

## ISMAP Compliance

Amazon ElastiCache is an ISMAP-registered service (ap-northeast-1). Combined with TLS encryption, KMS at-rest encryption, VPC isolation, and CloudTrail logging, this deployment satisfies the 3-province 2-guideline requirements for cache/messaging infrastructure.

Key compliance points:

- **Data residency**: All data remains in ap-northeast-1.
- **Encryption**: TLS 1.2+ in-transit, AES-256 at-rest via KMS.
- **Access control**: VPC-scoped, no public endpoint.
- **Audit**: ElastiCache API calls logged via CloudTrail.
- **No PHI storage**: Redis is used only for transient Pub/Sub messages, not persistent patient data.

## Cost Estimate

ElastiCache Serverless pricing (ap-northeast-1, as of 2026-03):

- Data storage: ~$0.125/GB-hour
- ElastiCache Processing Units (ECPUs): ~$0.0034 per 1M ECPUs

For a 5–15 user Pub/Sub workload, expect < $10/month.

## Local Development

No Redis instance is required for local development. When `REDIS_URL` is unset, the application uses the built-in in-memory realtime adapter automatically.

To test with Redis locally:

```bash
docker run --rm -p 6379:6379 redis:7-alpine
export REDIS_URL=redis://localhost:6379
pnpm dev
```
