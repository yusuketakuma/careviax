# AWS Cost-Minimal Deployment Plan

Updated: 2026-06-17

## Current System Fit

PH-OS is a Next.js 16 / React 19 / Node 24 application with Prisma 7 and PostgreSQL. The repository already contains AWS SDK clients, Secrets Manager fallback support, S3/SES/Cognito integration points, DynamoDB rate-limit infrastructure, CloudWatch alarms, EventBridge schedule drift checks, PH-OS Lambda/API Gateway templates, and WebSocket/SAM infrastructure for Yjs collaboration.

The lowest-cost path is therefore not a new serverless rewrite. Build the existing app as a production Docker image, run one app instance for the pilot, keep PostgreSQL managed, and only add distributed Redis/DynamoDB/WebSocket components when multiple app instances make in-memory fallbacks unsafe.

## Recommended Low-Cost Order

1. Pilot floor: Lightsail Linux/Unix 2 GB bundle + Lightsail managed PostgreSQL 2 GB standard encrypted plan.
2. Role-capable managed container path for new AWS customers: ECS Express Mode on Fargate with an Application Load Balancer, task roles, and the same PostgreSQL baseline or a concrete RDS PostgreSQL size selected in AWS Pricing Calculator.
3. Production HA floor: two app instances + load balancer + high-availability encrypted database, then add DynamoDB rate limiting and Redis/WebSocket backing when horizontal scale is enabled.

Do not use the Lightsail 1 GB database plan for PH-OS pilot data because the current Lightsail pricing table marks that tier as not encrypted. Start at the 2 GB encrypted database tier or use RDS PostgreSQL.

Do not select App Runner for a new PH-OS AWS account. AWS states that App Runner is no longer open to new customers as of April 30, 2026; existing App Runner customers can continue using it, but AWS recommends ECS Express Mode for containerized applications. ECS Express Mode has no additional service charge, but the underlying Fargate, Application Load Balancer, CloudWatch, and data transfer resources still bill normally.

## Docker Build

The repository now emits Next.js standalone output and includes a production Dockerfile.

```bash
docker build -t ph-os:aws .
docker run --rm -p 3000:3000 \
  --env-file .env.production.local \
  ph-os:aws
```

Runtime health check:

```bash
curl -fsS http://127.0.0.1:3000/api/health
```

For Lightsail containers, ECS, or EC2 Docker, set `PORT=3000` and inject secrets through runtime environment variables or AWS Secrets Manager. Set every `NEXT_PUBLIC_*` variable for the target environment before `pnpm build` or `docker build`; Next.js freezes public variables into the browser bundle at build time.

## End-to-End Pilot Plan

Generate the ordered, non-executing pilot command plan before touching live AWS resources:

```bash
pnpm aws:pilot:plan
pnpm aws:pilot:plan -- --shell
pnpm aws:pilot:plan -- --json
```

The plan labels every command as `READS` or `MUTATES`, starts with live validation, then orders ECR, GitHub OIDC, manual image workflow, Lightsail provisioning, runtime start, and public health verification. Run the live validation phase before any command marked `MUTATES`.

## Container Image Publish

If local Docker is unavailable, use the manual GitHub Actions workflow `.github/workflows/aws-container-image.yml` to build and push the image from GitHub-hosted runners. It uses OIDC with `secrets.AWS_ROLE_TO_ASSUME`; do not add long-lived AWS access keys for this path.

Create the ECR repository first:

```bash
pnpm aws:ecr:template:validate
pnpm aws:ecr:template:validate -- --live-aws --strict
aws cloudformation deploy \
  --region ap-northeast-1 \
  --stack-name ph-os-pilot-ecr \
  --template-file tools/infra/ecr-repository-template.yaml \
  --parameter-overrides RepositoryName=ph-os/app
```

Create the GitHub Actions OIDC role that the workflow will assume:

```bash
pnpm aws:github-oidc:template:validate
pnpm aws:github-oidc:template:validate -- --live-aws --strict
aws cloudformation deploy \
  --region ap-northeast-1 \
  --stack-name ph-os-github-ecr-oidc \
  --template-file tools/infra/github-actions-ecr-oidc-role-template.yaml \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides \
    GitHubRepository=yusuketakuma/careviax \
    GitHubSubject=repo:yusuketakuma/careviax:environment:production \
    RepositoryName=ph-os/app
```

If the AWS account already has a GitHub Actions OIDC provider for `https://token.actions.githubusercontent.com`, pass `ExistingGitHubOidcProviderArn=<ARN>` so the stack reuses it. Store the stack output `RoleArn` as the GitHub `production` environment secret `AWS_ROLE_TO_ASSUME`. The template leaves `ThumbprintList` omitted intentionally so IAM retrieves the current top intermediate CA thumbprint; verify the provider thumbprint in IAM if the target account requires explicit endpoint verification.

Then run the `AWS Container Image` workflow manually. Use the output image URI as `--image` for `pnpm aws:lightsail:runtime:plan`. ECR private repository storage adds a small variable cost; the template enables scan-on-push and lifecycle cleanup that expires untagged images after one day and keeps only the last 10 `sha-*`/`pilot*` tagged images.

## ECS Express Role-Capable Runtime Plan

Use ECS Express Mode instead of the Lightsail runtime when PH-OS must call AWS APIs from the application container in a production-like environment. The role-capable path costs more than the single Lightsail pilot, but it avoids storing long-lived AWS keys on the host and gives the app an ECS task role for DynamoDB, Secrets Manager, S3, SES, and similar AWS services.

Generate the ordered, non-executing ECS Express command plan:

```bash
pnpm aws:ecs-express:plan
pnpm aws:ecs-express:plan -- --shell
pnpm aws:ecs-express:plan -- --json
```

The plan follows the current AWS ECS Express CLI model: create or reuse the ECR image repository, create the required task execution role and infrastructure role, prepare an untracked `create-express-gateway-service` input file, create the service, then verify the generated HTTPS service URL. It sets the cost-minimum starting point explicitly in the service input example: `cpu=256`, `memory=512`, `minTaskCount=1`, and `maxTaskCount=1`. Raise the scaling target only after a production sizing decision.

Validate and deploy the ECS Express roles template before service creation:

```bash
pnpm aws:ecs-express:roles:validate
pnpm aws:ecs-express:roles:validate -- --live-aws --strict
aws cloudformation deploy \
  --region ap-northeast-1 \
  --stack-name ph-os-ecs-express-roles \
  --template-file tools/infra/ecs-express-roles-template.yaml \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides Prefix=ph-os-ecs-express
```

Then attach the least-privilege runtime policy stack. This is a separate step because ECS uses two different roles: the task execution role reads image/log/secret material on behalf of the platform, while the app task role is what PH-OS application code uses for DynamoDB, Secrets Manager, S3, SES, and KMS calls.

```bash
pnpm aws:ecs-express:runtime-policy:validate
pnpm aws:ecs-express:runtime-policy:validate -- --live-aws --strict
aws cloudformation deploy \
  --region ap-northeast-1 \
  --stack-name ph-os-ecs-express-runtime-policy \
  --template-file tools/infra/ecs-express-runtime-policy-template.yaml \
  --parameter-overrides \
    Prefix=ph-os-ecs-express \
    TaskExecutionRoleName=<TASK_EXECUTION_ROLE_NAME> \
    AppTaskRoleName=<APP_TASK_ROLE_NAME> \
    SecretResourceArns=<SECRET_ARN_1>,<SECRET_ARN_2> \
    SecretsKmsKeyArn=<SECRETS_KMS_KEY_ARN> \
    DynamoRateLimitTableArn=<RATE_LIMIT_TABLE_ARN> \
    EvidenceBucketName=<S3_BUCKET_NAME> \
    EvidenceKmsKeyArn=<EVIDENCE_KMS_KEY_ARN> \
    SesIdentityArn=<SES_IDENTITY_ARN>
```

Start from `tools/infra/ecs-express-service-input.example.json`, copy it to an ignored local path such as `tmp/ecs-express-service-input.json`, and replace placeholders with the ECR image URI, role ARNs, and Secrets Manager secret ARNs. Keep secret values in Secrets Manager; the input file should contain only ARNs and non-sensitive environment values.

The app task role created by `tools/infra/ecs-express-roles-template.yaml` intentionally starts without broad runtime permissions. `tools/infra/ecs-express-runtime-policy-template.yaml` attaches only the exact runtime permissions needed for configured PH-OS resources: Secrets Manager secret ARNs, one DynamoDB rate-limit table, approved S3 object prefixes, KMS keys constrained by service conditions, and one SES identity. Do not add wildcard runtime permissions to either ECS role.

## Cost Estimate Workflow

Run:

```bash
pnpm aws:cost:estimate
pnpm aws:cost:estimate -- --scenario lightsail-pilot-encrypted-db
pnpm aws:cost:estimate -- --scenario ecs-express-role-capable-minimum
pnpm aws:cost:estimate -- --json
```

The scenario assumptions live in `tools/aws-cost-minimal-scenarios.json`. Treat the numbers as an estimate, not a quote. Before live deployment, refresh rates from the official AWS pricing pages or AWS Pricing Calculator, especially for RDS instance class, backup storage, CloudTrail data events, KMS requests, support plan, and data transfer.

Current scenario totals:

| Scenario                           | Monthly estimate | Use when                                                |
| ---------------------------------- | ---------------: | ------------------------------------------------------- |
| `lightsail-pilot-encrypted-db`     |           $46.60 | Lowest fixed-cost pilot, no HA SLA                      |
| `ecs-express-role-capable-minimum` |           $76.42 | New-customer managed runtime with task-role credentials |
| `ha-production-floor`              |          $120.20 | Minimum HA direction before full production sizing      |

The ECS Express scenario uses public AWS Price List rates observed for Tokyo on 2026-06-17: one 0.25 vCPU / 0.5 GB Linux/x86 Fargate task running 730 hours, one Application Load Balancer running 730 hours, and one starter LCU allowance. Refresh the rates with AWS Pricing Calculator or AWS Price List before procurement because this document is an operational estimate, not a quote.

## Deployment Readiness Check

Run the local readiness check before provisioning:

```bash
pnpm aws:deploy:readiness
pnpm aws:deploy:readiness -- --live-aws
pnpm aws:deploy:readiness -- --strict --json
```

The default check validates local tools, committed deployment artifacts, standalone build output, cost-estimate files, and core production environment variables without calling AWS. `--live-aws` additionally runs `aws sts get-caller-identity` and is the first safe account/region proof before any provisioning command.

## Lightsail Pilot Provisioning Plan

The repository includes a CloudFormation template for the same low-cost pilot topology:

```bash
pnpm aws:lightsail:template:validate
pnpm aws:lightsail:template:validate -- --live-aws --strict
aws cloudformation deploy \
  --region ap-northeast-1 \
  --stack-name ph-os-pilot \
  --template-file tools/infra/lightsail-pilot-template.yaml \
  --parameter-overrides \
    Prefix=ph-os-pilot \
    AvailabilityZone=ap-northeast-1a \
    InstanceBundleId=<LIGHTSAIL_INSTANCE_BUNDLE_ID> \
    DatabaseBlueprintId=<LIGHTSAIL_POSTGRES_BLUEPRINT_ID> \
    DatabaseBundleId=small_2_0 \
    MasterUserPassword='<GENERATED_PASSWORD>'
```

The template creates one `AWS::Lightsail::Instance`, one `AWS::Lightsail::StaticIp`, and one non-public `AWS::Lightsail::Database` with backup retention enabled. `MasterUserPassword` is a `NoEcho` parameter; keep the generated value in the approved secrets store and do not commit it.

Generate the copyable command plan:

```bash
pnpm aws:lightsail:plan
pnpm aws:lightsail:plan -- --shell
pnpm aws:lightsail:plan -- --json
pnpm aws:lightsail:status
pnpm aws:lightsail:status -- --strict --json
```

The plan is intentionally non-executing. It prints discovery commands first because Lightsail blueprint and bundle IDs should be verified in the target account/region immediately before creation. Mutating commands are labeled `MUTATES` and require these environment variables:

- `PHOS_LIGHTSAIL_INSTANCE_BUNDLE_ID`
- `PHOS_LIGHTSAIL_DB_BLUEPRINT_ID`
- `PHOS_DB_MASTER_PASSWORD`
- `PHOS_CONTAINER_IMAGE`

Run `pnpm aws:deploy:readiness -- --live-aws` before executing any `MUTATES` command. The generated database command uses `--no-publicly-accessible`, and the app host user data installs Docker only; application secrets are configured after provisioning from approved runtime secrets.

After provisioning, run `pnpm aws:lightsail:status`. It uses read-only Lightsail calls to summarize the app instance, static IP attachment, managed database state/public-access flag, and HTTP/HTTPS port state. Default mode prints a report without mutating AWS resources. Use `--strict` in CI or handoff checks so a public database, missing resource, credential failure, or incomplete web-port setup exits non-zero.

Prepare and run the application container after the stack exists:

```bash
pnpm aws:lightsail:runtime:plan -- --host <STATIC_IP_OR_DOMAIN> --image <APP_IMAGE> --env-file <UNTRACKED_ENV_FILE>
pnpm aws:lightsail:runtime:plan -- --host <STATIC_IP_OR_DOMAIN> --image <APP_IMAGE> --env-file <UNTRACKED_ENV_FILE> --json
```

Start from `tools/infra/lightsail-runtime-env.example`, write the real values to an untracked file with `chmod 0600`, and keep that file out of git. The runtime plan uploads only the env file path, not secret values, then places it at `/opt/phos/.env` with mode `0600`, pulls the approved container image, restarts the `ph-os` container, and runs local health on the instance. If the image is private, authenticate Docker on the host using the registry-approved short-lived mechanism before the `start-container` command.

Validate the untracked env file before uploading it:

```bash
pnpm aws:lightsail:runtime-env:validate -- --env-file <UNTRACKED_ENV_FILE>
pnpm aws:lightsail:runtime-env:validate -- --env-file <UNTRACKED_ENV_FILE> --strict --json
```

The validator intentionally fails when production DynamoDB rate limiting or Secrets Manager is enabled without a role/container credential source. A plain Lightsail instance does not inject ECS task-role or EC2 instance-profile style credentials, so production-like PHI handling should use a role-capable runtime or another approved short-lived credential path instead of committing or uploading long-lived AWS access keys.

Then prove application liveness through the same public path users will hit:

```bash
pnpm perf:smoke -- --base-url http://<STATIC_IP_OR_DOMAIN> --path /api/health --requests 5 --concurrency 1 --target-ms 5000
```

The public health endpoint intentionally stays cheap and unauthenticated. Use an authenticated admin check separately before handling production PHI because public `/api/health` does not exercise the database or backup monitor.

## Cost Controls

- Keep one app instance for the pilot; in-memory realtime and local process rate-limit fallback are acceptable only while there is exactly one runtime instance, production fail-closed settings are understood, and no PHI workflow depends on AWS API calls from a runtime that lacks role credentials.
- Keep `RATE_LIMIT_STORE=dynamodb` for production multi-instance deployments; in-process rate limiting is not sufficient once traffic is load-balanced.
- Keep `REDIS_URL` unset until multi-instance realtime fan-out is needed.
- Cap CloudWatch log retention and avoid Container Insights/Application Signals until there is an explicit operational need.
- Use SES without dedicated IPs for pilot mail volume.
- Keep Cognito on Lite or Essentials unless Plus/advanced security features are explicitly required and budgeted.
- Avoid NAT Gateway in the pilot design; it can exceed the app runtime cost by itself. Prefer public app ingress with private database access where the chosen AWS product supports it, or keep the pilot entirely in Lightsail until VPC controls are required.

## Security And Production Notes

- Keep all PHI in `ap-northeast-1`.
- Use TLS for database connections (`sslmode=require`) and do not use static AWS access keys in production containers. Prefer runtime IAM roles/container credentials.
- Store `DATABASE_URL`, `NEXTAUTH_SECRET`, `ENCRYPTION_KEY`, `JWT_SIGNING_SECRET`, and `JOB_API_KEY` in Secrets Manager for staging/production.
- Enable S3 versioning/Object Lock for prescription/audit evidence buckets before handling production PHI.
- For regulated production, replace the pilot floor with RDS PostgreSQL in private subnets if pgaudit, parameter groups, subnet isolation, or stricter backup controls are required.
