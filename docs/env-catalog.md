# Environment Variable Catalog

Generated on 2026-06-12 from current source references to `process.env.*` under `src`, `tools`, `prisma`, and root TypeScript config files. Test files and generated build output are excluded.

Current key count: 138. The earlier refactor note recorded 118 keys; the live repository now references 138.

`src/lib/env/assert-env.ts` enforces the production safety subset from `src/instrumentation.ts` during the Node.js runtime startup path.

| Key                                          | Classification       | Notes                                                           |
| -------------------------------------------- | -------------------- | --------------------------------------------------------------- |
| `ALERT_EMAIL`                                | optional             |                                                                 |
| `ALLOW_LOCAL_AUTH_FALLBACK`                  | danger               | Must be unset/false in production.                              |
| `ALLOW_LOCAL_DEMO_PASSWORD_LOGIN`            | danger               | Must be unset/false in production.                              |
| `APP_ENV`                                    | optional             |                                                                 |
| `APP_URL`                                    | optional             |                                                                 |
| `AUDIT_LOG_ARCHIVE_BUCKET_NAME`              | optional             |                                                                 |
| `AUDIT_LOG_ARCHIVE_BUCKET_REGION`            | optional             |                                                                 |
| `AUTH_SECRET`                                | required alternative | Alternative auth secret accepted by the safety gate.            |
| `AWS_ACCESS_KEY_ID`                          | secret optional      | Secret or credential-like value; manage through secret storage. |
| `AWS_CONTAINER_AUTHORIZATION_TOKEN`          | secret optional      | Secret or credential-like value; manage through secret storage. |
| `AWS_CONTAINER_CREDENTIALS_FULL_URI`         | infra optional       |                                                                 |
| `AWS_CONTAINER_CREDENTIALS_RELATIVE_URI`     | infra optional       |                                                                 |
| `AWS_ECS_CONTAINER_CREDENTIALS_RELATIVE_URI` | infra optional       |                                                                 |
| `AWS_EXECUTION_ENV`                          | infra optional       |                                                                 |
| `AWS_REGION`                                 | infra optional       |                                                                 |
| `AWS_BACKUP_RECOVERY_POINT_MAX_AGE_HOURS`    | infra optional       |                                                                 |
| `AWS_BACKUP_RDS_RESOURCE_ARN`                | infra optional       |                                                                 |
| `AWS_BACKUP_VAULT_NAME`                      | infra optional       |                                                                 |
| `AWS_SECRET_ACCESS_KEY`                      | secret optional      | Secret or credential-like value; manage through secret storage. |
| `AWS_SESSION_TOKEN`                          | secret optional      | Secret or credential-like value; manage through secret storage. |
| `BULK_EXPORT_FILE_RETENTION_HOURS`           | optional             |                                                                 |
| `CI`                                         | tooling optional     |                                                                 |
| `COGNITO_CLIENT_SECRET`                      | secret optional      | Secret or credential-like value; manage through secret storage. |
| `COGNITO_USER_POOL_ID`                       | infra optional       |                                                                 |
| `DAILY_OPERATION_CONCURRENCY`                | optional             |                                                                 |
| `DATABASE_POOL_SIZE`                         | optional             |                                                                 |
| `DATABASE_URL`                               | required             | Core Prisma runtime connection.                                 |
| `DB_INSTANCE_ID`                             | optional             |                                                                 |
| `DEBUG_SYNC`                                 | optional             |                                                                 |
| `DESIGN_FIDELITY_DIR`                        | tooling optional     |                                                                 |
| `DESIGN_SCREEN_IDS`                          | tooling optional     |                                                                 |
| `DIRECT_URL`                                 | optional             |                                                                 |
| `ENCRYPTION_KEY`                             | secret optional      | Secret or credential-like value; manage through secret storage. |
| `EPRESCRIPTION_ACCESS_TOKEN`                 | secret optional      | Secret or credential-like value; manage through secret storage. |
| `EPRESCRIPTION_API_KEY`                      | secret optional      | Secret or credential-like value; manage through secret storage. |
| `EPRESCRIPTION_BASE_URL`                     | optional             |                                                                 |
| `EPRESCRIPTION_PROVIDER`                     | optional             |                                                                 |
| `EXTERNAL_ACCESS_TOKEN_SECRET`               | secret optional      | Secret or credential-like value; manage through secret storage. |
| `GITHUB_BASE_REF`                            | tooling optional     |                                                                 |
| `GITHUB_EVENT_BEFORE`                        | tooling optional     |                                                                 |
| `GOOGLE_MAPS_API_KEY`                        | secret optional      | Secret or credential-like value; manage through secret storage. |
| `GOOGLE_MAPS_SERVER_API_KEY`                 | secret optional      | Secret or credential-like value; manage through secret storage. |
| `GOOGLE_ROUTES_API_KEY`                      | secret optional      | Secret or credential-like value; manage through secret storage. |
| `HOT_MASTER_URL`                             | optional             |                                                                 |
| `HTTP_ADAPTER_TIMEOUT_MS`                    | optional             |                                                                 |
| `JOB_API_KEY`                                | secret optional      | Secret or credential-like value; manage through secret storage. |
| `JOB_STALE_LOCK_MS`                          | optional             |                                                                 |
| `JWT_SIGNING_SECRET`                         | secret optional      | Secret or credential-like value; manage through secret storage. |
| `LINE_CHANNEL_ACCESS_TOKEN`                  | secret optional      | Secret or credential-like value; manage through secret storage. |
| `LINE_DELIVERY_TIMEOUT_MS`                   | optional             |                                                                 |
| `LOCAL_DEMO_PASSWORD`                        | secret optional      | Secret or credential-like value; manage through secret storage. |
| `MCS_AGENT_BROWSER_BIN`                      | optional             |                                                                 |
| `MCS_BROWSER_CDP_TARGET`                     | optional             |                                                                 |
| `MFA_RECOVERY_SECRET`                        | secret optional      | Secret or credential-like value; manage through secret storage. |
| `NEXTAUTH_SECRET`                            | required             | Core auth secret; AUTH_SECRET can satisfy the same safety gate. |
| `NEXTAUTH_URL`                               | required             | Core auth URL in production.                                    |
| `NEXT_PUBLIC_APP_ENV`                        | public optional      | Exposed to the browser bundle; never store secrets here.        |
| `NEXT_PUBLIC_APP_URL`                        | public optional      | Exposed to the browser bundle; never store secrets here.        |
| `NEXT_PUBLIC_COGNITO_CLIENT_ID`              | public optional      | Exposed to the browser bundle; never store secrets here.        |
| `NEXT_PUBLIC_COGNITO_USER_POOL_ID`           | public optional      | Exposed to the browser bundle; never store secrets here.        |
| `NEXT_PUBLIC_DISABLE_NOTIFICATION_STREAM`    | public optional      | Exposed to the browser bundle; never store secrets here.        |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`            | public optional      | Exposed to the browser bundle; never store secrets here.        |
| `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID`             | public optional      | Exposed to the browser bundle; never store secrets here.        |
| `NEXT_PUBLIC_PHOS_API_BASE_URL`              | public optional      | Exposed to the browser bundle; never store secrets here.        |
| `NEXT_PUBLIC_SENTRY_DSN`                     | public optional      | Exposed to the browser bundle; never store secrets here.        |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY`               | public optional      | Exposed to the browser bundle; never store secrets here.        |
| `NEXT_RUNTIME`                               | optional             |                                                                 |
| `NODE_ENV`                                   | optional             |                                                                 |
| `OQC_ACCESS_TOKEN`                           | secret optional      | Secret or credential-like value; manage through secret storage. |
| `OQC_BASE_URL`                               | optional             |                                                                 |
| `OQC_CLIENT_ID`                              | optional             |                                                                 |
| `OQC_CLIENT_SECRET`                          | secret optional      | Secret or credential-like value; manage through secret storage. |
| `OQC_PROVIDER`                               | optional             |                                                                 |
| `ORG_ID`                                     | optional             |                                                                 |
| `PATIENT_MCS_AI_ALLOWED_HOSTS`               | optional             |                                                                 |
| `PATIENT_MCS_AI_ALLOW_EXTERNAL`              | optional             |                                                                 |
| `PATIENT_MCS_AI_API_KEY`                     | secret optional      | Secret or credential-like value; manage through secret storage. |
| `PATIENT_MCS_AI_BASE_URL`                    | optional             |                                                                 |
| `PATIENT_MCS_AI_MODEL`                       | optional             |                                                                 |
| `PATIENT_MCS_AI_PROVIDER`                    | optional             |                                                                 |
| `PATIENT_MCS_AI_TIMEOUT_MS`                  | optional             |                                                                 |
| `PATIENT_MCS_BROWSER_SYNC_ENABLED`           | optional             |                                                                 |
| `PHOS_API_BASE_URL`                          | optional             |                                                                 |
| `PHOS_AURORA_DATABASE_SECRET_ARN`            | secret optional      | Secret or credential-like value; manage through secret storage. |
| `PHOS_AWS_CLIENT_CONNECTION_TIMEOUT_MS`      | optional             |                                                                 |
| `PHOS_AWS_CLIENT_MAX_ATTEMPTS`               | optional             |                                                                 |
| `PHOS_AWS_CLIENT_TIMEOUT_MS`                 | optional             |                                                                 |
| `PHOS_DYNAMODB_TABLE_NAME`                   | optional             |                                                                 |
| `PHOS_EVIDENCE_BUCKET`                       | optional             |                                                                 |
| `PHOS_EVIDENCE_BUCKET_NAME`                  | optional             |                                                                 |
| `PHOS_EVIDENCE_KMS_KEY_ARN`                  | secret optional      | Secret or credential-like value; manage through secret storage. |
| `PHOS_PROXY_UPSTREAM_TIMEOUT_MS`             | optional             |                                                                 |
| `PHOS_SECURITY_EVENTS_DYNAMO`                | optional             |                                                                 |
| `PHOS_SECURITY_EVENT_TABLE_NAME`             | optional             |                                                                 |
| `PLAYWRIGHT`                                 | tooling optional     |                                                                 |
| `PLAYWRIGHT_ARTIFACT_ROOT`                   | tooling optional     |                                                                 |
| `PLAYWRIGHT_BASE_URL`                        | tooling optional     |                                                                 |
| `PLAYWRIGHT_REUSE_SERVER`                    | tooling optional     |                                                                 |
| `QR_DRAFT_HASH_SECRET`                       | secret optional      | Secret or credential-like value; manage through secret storage. |
| `RATE_LIMIT_DDB_REGION`                      | infra optional       |                                                                 |
| `RATE_LIMIT_DDB_TABLE_NAME`                  | infra optional       |                                                                 |
| `RATE_LIMIT_DDB_TIMEOUT_MS`                  | infra optional       |                                                                 |
| `RATE_LIMIT_STORE`                           | optional             |                                                                 |
| `RDS_DB_INSTANCE_ARN`                        | infra optional       |                                                                 |
| `RDS_DB_INSTANCE_ID`                         | infra optional       |                                                                 |
| `REDIS_URL`                                  | optional             |                                                                 |
| `ROUTING_API_BASE_URL`                       | optional             |                                                                 |
| `ROUTING_API_PROFILE`                        | optional             |                                                                 |
| `ROUTING_API_PROVIDER`                       | optional             |                                                                 |
| `ROUTING_API_TIMEOUT_MS`                     | optional             |                                                                 |
| `S3_BUCKET_NAME`                             | infra optional       |                                                                 |
| `S3_BUCKET_REGION`                           | infra optional       |                                                                 |
| `S3_KMS_KEY_ID`                              | secret optional      | Secret or credential-like value; manage through secret storage. |
| `S3_KMS_KEY_ID_EXPORT`                       | secret optional      | Secret or credential-like value; manage through secret storage. |
| `S3_KMS_KEY_ID_PHI`                          | secret optional      | Secret or credential-like value; manage through secret storage. |
| `S3_KMS_KEY_ID_REPORT`                       | secret optional      | Secret or credential-like value; manage through secret storage. |
| `S3_SERVER_SIDE_ENCRYPTION`                  | secret optional      | Secret or credential-like value; manage through secret storage. |
| `SENTRY_DSN`                                 | optional             |                                                                 |
| `SENTRY_ORG`                                 | optional             |                                                                 |
| `SENTRY_PROJECT`                             | optional             |                                                                 |
| `SES_FROM_EMAIL`                             | infra optional       |                                                                 |
| `SMS_DELIVERY_TIMEOUT_MS`                    | optional             |                                                                 |
| `TRUSTED_PROXY_HOPS`                         | optional             |                                                                 |
| `TRUST_PROXY_HEADERS`                        | optional             |                                                                 |
| `TWILIO_ACCOUNT_SID`                         | secret optional      | Secret or credential-like value; manage through secret storage. |
| `TWILIO_AUTH_TOKEN`                          | secret optional      | Secret or credential-like value; manage through secret storage. |
| `TWILIO_FROM_NUMBER`                         | optional             |                                                                 |
| `VAPID_PRIVATE_KEY`                          | secret optional      | Secret or credential-like value; manage through secret storage. |
| `VAPID_SUBJECT`                              | optional             |                                                                 |
| `VERCEL`                                     | optional             |                                                                 |
| `VISIT_BRIEF_AI_API_KEY`                     | secret optional      | Secret or credential-like value; manage through secret storage. |
| `VISIT_BRIEF_AI_BASE_URL`                    | optional             |                                                                 |
| `VISIT_BRIEF_AI_MODEL`                       | optional             |                                                                 |
| `VISIT_BRIEF_AI_PROVIDER`                    | optional             |                                                                 |
| `VISIT_BRIEF_AI_TIMEOUT_MS`                  | optional             |                                                                 |
| `VISIT_BRIEF_BATCH_CONCURRENCY`              | optional             |                                                                 |
| `WEBHOOK_SECRET_ENCRYPTION_KEY`              | secret optional      | Secret or credential-like value; manage through secret storage. |
| `WEBHOOK_SECRET_ENCRYPTION_KEY_ID`           | secret optional      | Secret or credential-like value; manage through secret storage. |
