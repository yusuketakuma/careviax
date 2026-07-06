# PH-OS AWS Deployment Stages and Tenant Boundary ADR

Status: accepted for implementation planning  
Last updated: 2026-07-06  
Scope: PH-OS / CareVIAx pilot, production-minimum, and scale-out AWS topology

## Decision

PH-OS will use a staged AWS deployment model:

1. Low-cost pilot: Lightsail App VM, Lightsail PostgreSQL, S3, Cognito, SES, CloudWatch, DynamoDB rate limiting, ECR, Route 53, and ACM.
2. Production minimum: ECS Express / Fargate, ALB, RDS PostgreSQL, S3 Object Lock, Cognito, SES, DynamoDB, CloudWatch, Route 53, ACM, Secrets Manager, and EventBridge Scheduler.
3. Scale-out: multiple Fargate tasks, RDS Multi-AZ, SQS/EventBridge, ElastiCache/Valkey or DynamoDB, WAF, GuardDuty, Security Hub, CloudTrail, Config, and AWS Backup.

Tenancy remains logical. `Organization` is the pharmacy tenant boundary. `User` is global and receives tenant access through `Membership`, PH-OS operator support through `SupportSession`, and freelance pharmacist access through `CrossTenantAccessGrant` / `CaseAssignment`. PostgreSQL RLS continues to enforce `org_id`; future support and freelance access must add `app.current_user_id`, `app.platform_mode`, `app.target_org_id`, and `app.support_session_id` to the request/RLS context design before expanding cross-tenant access.

## Why This Shape

The current repository already fits a containerized Next.js standalone runtime and a PostgreSQL-centered data model. The existing AWS plan scripts and infrastructure templates cover the pilot and role-capable production direction:

- `docs/operations/aws-cost-minimal-deployment.md` defines the low-cost order, Docker runtime, ECR/OIDC path, Lightsail pilot commands, ECS Express path, cost scenarios, and security constraints.
- `tools/scripts/aws-lightsail-pilot-plan.ts` generates a non-executing Lightsail command plan with an encrypted non-public PostgreSQL database, static IP, runtime env, and a `$46.60` monthly estimate.
- `tools/scripts/aws-ecs-express-plan.ts` generates a non-executing ECS Express plan with ECR, task execution role, app task role, runtime policy, service input validation, and a role-capable minimum estimate.
- `tools/infra/README.md` lists the checked-in AWS baselines for WAF, security groups, S3 bucket policy, KMS key policy, Object Lock, CloudTrail, CloudWatch alarms, EventBridge schedules, Cognito advanced security, and DynamoDB rate limiting.

This means the lowest-risk path is not a serverless rewrite. The first production-like proof should run the existing app image, keep PostgreSQL authoritative, and add AWS managed services only where they close a concrete operational gap.

## Stage 1: Low-Cost Pilot

Use this stage for the first 90 days or equivalent small field trial:

- 1 to 3 pharmacy tenants
- 5 to 10 patients
- 2 to 3 experienced home-care pharmacists
- 20 to 40 monthly visits

Required services:

- Lightsail Linux instance running the PH-OS Docker image
- Lightsail encrypted PostgreSQL with `--no-publicly-accessible`
- S3 for prescriptions, reports, visit photos, contracts, audit evidence, and exports
- Cognito for app users and MFA
- SES for invitations and operational mail
- DynamoDB on-demand for distributed production-like rate limiting
- CloudWatch logs, metrics, and alarms
- ECR for the container image
- Route 53 and ACM for DNS/TLS

Required checks before pilot PHI:

```bash
pnpm aws:cost:estimate -- --scenario lightsail-pilot-encrypted-db
pnpm aws:deploy:readiness -- --live-aws --strict
pnpm aws:lightsail:template:validate -- --live-aws --strict
pnpm aws:lightsail:plan -- --shell
pnpm aws:lightsail:runtime-env:validate -- --env-file <UNTRACKED_ENV_FILE> --strict
pnpm aws:lightsail:status -- --strict --json
pnpm rate-limit:ddb:verify -- --table-name <RATE_LIMIT_TABLE> --region ap-northeast-1
pnpm backup:drill:check --append --mode tabletop --result "<RESULT>" --operator "<OPERATOR>" --duration "<DURATION>" --notes "<NOTES>"
```

Pilot constraints:

- This is not a high-availability production topology.
- Do not handle production PHI until S3 Object Lock, S3 versioning, audit trails, backup runbooks, approved production secrets, RLS proofs, and no-store response policies are enabled.
- Do not put long-lived broad AWS access keys into the app container. A plain Lightsail instance lacks ECS task-role style credentials, so role-backed AWS API access should move to ECS or another approved short-lived credential path.
- The database must remain non-public.

## Stage 2: Production Minimum

Move to this stage when any of these triggers becomes true:

- 5 or more contracted pharmacies
- 30 or more active patients
- 50 to 70 or more monthly visits
- 5 or more freelance pharmacists
- PHI files and reports are accumulating as business records
- SLA language is used in sales or contracts
- Holiday / vacation backup is productized

Required services:

- ECS Express / Fargate for the PH-OS app task
- ALB with ACM TLS
- RDS PostgreSQL as the main database
- S3 Object Lock and versioning for PHI files and audit evidence
- Cognito, SES, DynamoDB, CloudWatch, Route 53, ACM
- Secrets Manager for runtime secrets
- EventBridge Scheduler for operational jobs
- ECR for images

Required checks before production cutover:

```bash
pnpm aws:cost:estimate -- --scenario ecs-express-role-capable-minimum
pnpm aws:deploy:readiness -- --live-aws --strict
pnpm aws:ecr:template:validate -- --live-aws --strict
pnpm aws:github-oidc:template:validate -- --live-aws --strict
pnpm aws:ecs-express:roles:validate -- --live-aws --strict
pnpm aws:ecs-express:runtime-policy:validate -- --live-aws --strict
pnpm aws:ecs-express:plan -- --shell
pnpm eventbridge-schedules:check
pnpm rate-limit:ddb:verify -- --table-name <RATE_LIMIT_TABLE> --region ap-northeast-1
```

Production-minimum constraints:

- ECS service input files must contain ARNs and non-sensitive environment values only. Secret values stay in Secrets Manager.
- The app task role is the only runtime AWS credential source for application code.
- The ECS runtime policy must restrict Secrets Manager, DynamoDB, S3 prefixes, KMS keys, SES identity, and CloudWatch namespace to explicit PH-OS resources.
- Scaling above one task requires shared backing for rate limiting and any realtime state that cannot remain process-local.

## Stage 3: Scale-Out

Use this stage after multiple regions, heavy external integration, or explicit HA/SLA pressure:

- Multiple Fargate tasks
- RDS Multi-AZ and production backup policy
- SQS or EventBridge-backed durable jobs
- ElastiCache/Valkey or DynamoDB for shared state where PostgreSQL is not the right store
- WAF, GuardDuty, Security Hub, CloudTrail data events, AWS Config, AWS Backup
- Optional CloudFront only for non-PHI static assets or carefully reviewed public surfaces

Do not add OpenSearch, QuickSight, Bedrock, Kinesis, or CloudFront for the app path by default. They require separate cost, PHI, and operational justifications.

## Tenant And Cross-Access Model

Required entities:

- `Organization`: pharmacy tenant.
- `PharmacySite`: tenant-specific site or branch.
- `User`: global identity mapped to Cognito.
- `Membership`: `user_id`, `org_id`, optional `site_id`, role, active state.
- `SupportSession`: PH-OS operator target-tenant session with reason, target org, start/end, approver, and audit correlation.
- `FreelancePharmacistProfile`: credential and service-area metadata for freelance pharmacists.
- `CrossTenantAccessGrant`: bounded access to a tenant or case with scope, purpose, start/end, approver, and status.
- `CaseAssignment`: case-level role such as primary, secondary, backup, on-call, or reviewer.

Rules:

- A user can belong to multiple organizations.
- Session `orgId` is the selected tenant, not the only tenant the user can access.
- PH-OS operators do not get unrestricted cross-tenant reads by default. They enter support mode, select a target organization, provide a reason, and receive a `support_session_id` that is written to audit logs.
- Freelance pharmacists can access only assigned cases/patients and only within the active assignment/grant window.
- Billing, external send, file download, deletion, and bulk disclosure remain high-risk operations even for PH-OS operators.
- Every cross-tenant read or write must be explainable from membership, assignment/grant, or support session evidence.

## Data And File Boundary

All business and PHI tables must include `org_id` unless explicitly documented as a global/system table. Composite tenant indexes must include `org_id` where the record is tenant-owned.

S3/file requirements:

- Block Public Access
- TLS-only bucket policy
- Versioning
- Object Lock for prescription/audit evidence where required
- SSE-S3 for pilot, SSE-KMS for regulated production hardening
- Short presigned URL lifetime
- No `storage_key`, `objectKey`, signed URL, original file name, patient id, visit id, report id, or raw external key in public API responses
- `FileAsset` lifecycle and retention/legal hold must stay consistent with `FILE-LIFE-001` and `DATA-RET-001A`

## Observability And Operations

Minimum alarms:

- 5xx increase
- rate limit store unavailable
- database connection failure
- S3 upload failure
- webhook delivery exhausted
- SSE polling or notification stream failure
- storage cleanup failure
- RDS or Lightsail CPU/storage pressure
- SES bounce/complaint rate
- Cognito sign-in failure spike
- background job permanent failure

The repository already has `tools/infra/cloudwatch-alarms.json`, `tools/infra/cloudwatch-alarms.ts`, and `tools/infra/eventbridge-schedules.json`. Production readiness requires those definitions to be applied or consciously waived with an operator reason.

## Implementation Mapping

This ADR closes the design-document portion of `AWS-ARCH-001`. Follow-up work remains:

- `AWS-LS-001`: implement a pilot readiness gate tying Lightsail, S3, Cognito, SES, DynamoDB rate limit, CloudWatch, backup, RLS, and no-store checks into one operator result.
- `AWS-ECS-001`: convert ECS Express / Fargate production-minimum assumptions into deployable IaC inputs and runbooks.
- `IAM-001`: keep ECS task-role least privilege validated as resources are added.
- `S3-PHI-001`: make S3 Object Lock, versioning, KMS, and public DTO minimization a deploy gate.
- `TENANT-001`: design and migrate global user, membership, grant, and assignment models.
- `TENANT-002`: implement PH-OS support session / break-glass support mode.
- `TENANT-003`: implement freelance pharmacist assignment authorization.
- `RLS-USER-001`: extend request/RLS context design for user, platform mode, target org, and support session.
- `OPS-AWS-001`: apply the CloudWatch alarm baseline.
- `OPS-MIGRATE-001`: create the Lightsail-to-ECS migration runbook and trigger checklist.

## Non-Goals

- No AWS provisioning is performed by this ADR.
- No migration is applied by this ADR.
- No claim is made that current AWS prices remain current. Use AWS Pricing Calculator or the AWS Price List before procurement.
- No claim is made that Lightsail is adequate for HA production.
