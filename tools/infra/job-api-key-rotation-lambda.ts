/**
 * JOB_API_KEY rotation Lambda (skeleton).
 *
 * Rotates the `JOB_API_KEY` field inside the `ph-os/{env}/app-secrets`
 * Secrets Manager secret using the standard AWS Secrets Manager
 * single-user rotation contract:
 *
 *   createSecret → setSecret → testSecret → finishSecret
 *
 * `JOB_API_KEY` is a self-contained bearer credential (no external service
 * stores a hashed copy), so `setSecret` is a no-op: staging the new value as
 * AWSPENDING in `createSecret` and promoting it in `finishSecret` is enough.
 * Both the previous (AWSCURRENT) and the new (AWSPENDING) value remain valid
 * until `finishSecret` runs, giving EventBridge / callers an overlap window so
 * in-flight job invocations are never rejected mid-rotation.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * STATUS: SKELETON ONLY. Deployment (IAM role, Secrets Manager rotation
 * configuration, EventBridge trigger, VPC wiring) requires AWS credentials and
 * is OUT OF SCOPE here. The `testSecret` smoke check against /api/jobs is left
 * as a TODO because it needs the deployed app URL + network egress.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Secret JSON shape (see src/lib/config/secrets.ts → AppSecrets):
 *   {
 *     "DATABASE_URL": "...",
 *     "NEXTAUTH_SECRET": "...",
 *     "ENCRYPTION_KEY": "...",
 *     "JWT_SIGNING_SECRET": "...",
 *     "JOB_API_KEY": "..."   ← the only field this Lambda rewrites
 *   }
 *
 * IAM (least privilege) the execution role needs:
 *   secretsmanager:GetSecretValue        (AWSCURRENT, AWSPENDING)
 *   secretsmanager:PutSecretValue        (stage AWSPENDING)
 *   secretsmanager:UpdateSecretVersionStage
 *   secretsmanager:DescribeSecret
 *   kms:Decrypt / kms:GenerateDataKey     (the secret's CMK)
 *
 * SAFETY: secret values are NEVER logged. Only version ids, the rotation step,
 * and the secret ARN appear in logs.
 */

import { randomBytes } from 'node:crypto';

// NOTE: import kept as a value import so the rotation steps below can `new` the
// client/commands. The package is an existing dependency of this project
// (used by src/lib/config/secrets.ts).
import {
  DescribeSecretCommand,
  GetSecretValueCommand,
  PutSecretValueCommand,
  SecretsManagerClient,
  UpdateSecretVersionStageCommand,
} from '@aws-sdk/client-secrets-manager';
import { infraAwsClientConfig, withInfraAwsClientTimeout } from './cloudwatch-alarms';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Event shape Secrets Manager sends to a rotation Lambda. */
export interface SecretsManagerRotationEvent {
  SecretId: string;
  ClientRequestToken: string;
  Step: 'createSecret' | 'setSecret' | 'testSecret' | 'finishSecret';
}

const ROTATED_KEY = 'JOB_API_KEY' as const;
const STAGE_CURRENT = 'AWSCURRENT';
const STAGE_PENDING = 'AWSPENDING';

/** Bytes of entropy for a freshly generated API key. 32 bytes → 256 bits. */
const JOB_API_KEY_ENTROPY_BYTES = 32;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let cachedClient: SecretsManagerClient | null = null;

function getClient(): SecretsManagerClient {
  if (!cachedClient) {
    // 本番 AWS SDK クライアントは bounded timeout + retry を必須とする
    // (aws-client-timeout-contract)。infra 用ヘルパで統一。
    cachedClient = withInfraAwsClientTimeout(
      new SecretsManagerClient({
        region: process.env.AWS_REGION ?? 'ap-northeast-1',
        ...infraAwsClientConfig(),
      }),
    );
  }
  return cachedClient;
}

/** Generate a new opaque, URL-safe JOB_API_KEY. */
function generateJobApiKey(): string {
  return randomBytes(JOB_API_KEY_ENTROPY_BYTES).toString('base64url');
}

function parseSecretObject(raw: string | undefined): Record<string, unknown> {
  if (!raw) throw new Error('Secret has no SecretString value');
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Secret value must be a JSON object');
  }
  return parsed as Record<string, unknown>;
}

async function getSecretObject(
  client: SecretsManagerClient,
  secretId: string,
  options: { versionStage?: string; versionId?: string },
): Promise<Record<string, unknown>> {
  const response = await client.send(
    new GetSecretValueCommand({
      SecretId: secretId,
      VersionStage: options.versionStage,
      VersionId: options.versionId,
    }),
  );
  return parseSecretObject(response.SecretString);
}

// ---------------------------------------------------------------------------
// Rotation steps
// ---------------------------------------------------------------------------

/**
 * createSecret — generate the new JOB_API_KEY and stage the full secret JSON
 * (all other fields copied verbatim) as AWSPENDING under the rotation token.
 * Idempotent: if AWSPENDING already exists for this token, do nothing.
 */
async function createSecret(
  client: SecretsManagerClient,
  secretId: string,
  token: string,
): Promise<void> {
  // If a pending version already exists for this token, this step already ran.
  try {
    await getSecretObject(client, secretId, { versionId: token, versionStage: STAGE_PENDING });
    console.info('[rotation] createSecret: AWSPENDING already staged; skipping', { secretId });
    return;
  } catch {
    // No pending version yet — fall through and create one.
  }

  const current = await getSecretObject(client, secretId, { versionStage: STAGE_CURRENT });
  const next: Record<string, unknown> = { ...current, [ROTATED_KEY]: generateJobApiKey() };

  await client.send(
    new PutSecretValueCommand({
      SecretId: secretId,
      ClientRequestToken: token,
      SecretString: JSON.stringify(next),
      VersionStages: [STAGE_PENDING],
    }),
  );
  console.info('[rotation] createSecret: staged new AWSPENDING version', { secretId });
}

/**
 * setSecret — propagate the pending credential to any external service that
 * must accept it. JOB_API_KEY is a self-contained bearer token, so there is
 * nothing to update externally: no-op.
 */
async function setSecret(secretId: string): Promise<void> {
  console.info('[rotation] setSecret: no external system to update for JOB_API_KEY', { secretId });
}

/**
 * testSecret — verify the AWSPENDING key actually authenticates before promoting.
 *
 * TODO(deploy): once an internal health endpoint that accepts x-api-key is
 * reachable from this Lambda's network, fetch the pending key and assert a
 * non-401 response, e.g.:
 *
 *   const pending = await getSecretObject(client, secretId,
 *     { versionId: token, versionStage: STAGE_PENDING });
 *   const res = await fetch(`${process.env.JOB_API_BASE_URL}/api/jobs/health`, {
 *     method: 'POST',
 *     headers: { 'x-api-key': String(pending[ROTATED_KEY]) },
 *   });
 *   if (res.status === 401 || res.status === 403) {
 *     throw new Error('Pending JOB_API_KEY failed authentication smoke test');
 *   }
 *
 * Until that endpoint + JOB_API_BASE_URL are wired, structurally validate that
 * the pending version parses and contains a non-empty JOB_API_KEY.
 */
async function testSecret(
  client: SecretsManagerClient,
  secretId: string,
  token: string,
): Promise<void> {
  const pending = await getSecretObject(client, secretId, {
    versionId: token,
    versionStage: STAGE_PENDING,
  });
  const value = pending[ROTATED_KEY];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('Pending secret is missing a valid JOB_API_KEY');
  }
  console.info('[rotation] testSecret: pending JOB_API_KEY is structurally valid', { secretId });
}

/**
 * finishSecret — promote AWSPENDING to AWSCURRENT, demoting the old current
 * version. After this, getSecrets() callers (and Edge env) will see the new key.
 */
async function finishSecret(
  client: SecretsManagerClient,
  secretId: string,
  token: string,
): Promise<void> {
  const describe = await client.send(new DescribeSecretCommand({ SecretId: secretId }));
  const versions = describe.VersionIdsToStages ?? {};

  // Find the version currently labeled AWSCURRENT so we can move the stage off it.
  let currentVersionId: string | undefined;
  for (const [versionId, stages] of Object.entries(versions)) {
    if (stages?.includes(STAGE_CURRENT)) {
      if (versionId === token) {
        console.info('[rotation] finishSecret: token already AWSCURRENT; nothing to do', {
          secretId,
        });
        return;
      }
      currentVersionId = versionId;
      break;
    }
  }

  await client.send(
    new UpdateSecretVersionStageCommand({
      SecretId: secretId,
      VersionStage: STAGE_CURRENT,
      MoveToVersionId: token,
      RemoveFromVersionId: currentVersionId,
    }),
  );
  console.info('[rotation] finishSecret: promoted AWSPENDING to AWSCURRENT', { secretId });
}

// ---------------------------------------------------------------------------
// Lambda entry point
// ---------------------------------------------------------------------------

export async function handler(event: SecretsManagerRotationEvent): Promise<void> {
  const { SecretId: secretId, ClientRequestToken: token, Step: step } = event;
  // SAFETY: log identifiers/steps only — never secret values.
  console.info('[rotation] step received', { secretId, step });

  const client = getClient();

  switch (step) {
    case 'createSecret':
      await createSecret(client, secretId, token);
      return;
    case 'setSecret':
      await setSecret(secretId);
      return;
    case 'testSecret':
      await testSecret(client, secretId, token);
      return;
    case 'finishSecret':
      await finishSecret(client, secretId, token);
      return;
    default:
      throw new Error(`Unknown rotation step: ${String(step)}`);
  }
}
