import { decode } from 'next-auth/jwt';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';

const COLLABORATION_ROOM_TOKEN_SALT = 'ph-os.collaboration-room-token.v1';
const LOCAL_FALLBACK_COLLABORATION_ROOM_TOKEN_SECRET = 'ph-os-local-auth-secret';
const MIN_COLLABORATION_ROOM_TOKEN_SECRET_LENGTH = 32;
const SECRETS_MANAGER_CACHE_TTL_MS = 5 * 60 * 1000;

let cachedSecretsManagerSecret: string | null = null;
let cachedSecretsManagerSecretAt: number | null = null;

export type CollaborationRoomTokenPayload = {
  sub: string;
  purpose: 'collaboration_room';
  org_id: string;
  user_id: string;
  entity_type: 'dispense_task' | 'visit_record';
  entity_id: string;
  room: string;
  exp: number;
  iat: number;
};

type ValidationResult =
  | {
      ok: true;
      payload: CollaborationRoomTokenPayload;
    }
  | {
      ok: false;
    };

export function clearRoomTokenSecretCache() {
  cachedSecretsManagerSecret = null;
  cachedSecretsManagerSecretAt = null;
}

function isProductionLikeRuntime() {
  return process.env.NODE_ENV === 'production' || Boolean(process.env.AWS_EXECUTION_ENV);
}

function parseSecretString(raw: string) {
  const trimmed = raw.trim();

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed === 'string') return parsed;

    const record = readObject(parsed);
    if (record) {
      const secret = record.COLLABORATION_ROOM_TOKEN_SECRET;
      if (typeof secret === 'string') return secret;
      return null;
    }

    return null;
  } catch {
    if (trimmed.startsWith('{') || trimmed.startsWith('[') || trimmed.startsWith('"')) return null;
    // SecretString may be the raw signing secret rather than a JSON object.
  }

  return raw;
}

function readObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function isStrongSecret(secret: string) {
  const normalized = secret.trim();
  return (
    normalized.length >= MIN_COLLABORATION_ROOM_TOKEN_SECRET_LENGTH &&
    normalized !== LOCAL_FALLBACK_COLLABORATION_ROOM_TOKEN_SECRET
  );
}

async function roomTokenSecretFromSecretsManager(secretArn: string) {
  const now = Date.now();
  if (
    cachedSecretsManagerSecret &&
    cachedSecretsManagerSecretAt &&
    now - cachedSecretsManagerSecretAt < SECRETS_MANAGER_CACHE_TTL_MS
  ) {
    return cachedSecretsManagerSecret;
  }

  const client = new SecretsManagerClient({
    region: process.env.AWS_REGION ?? 'ap-northeast-1',
  });
  const response = await client.send(new GetSecretValueCommand({ SecretId: secretArn }));
  const raw = response.SecretString;
  if (!raw) return null;

  const secret = parseSecretString(raw);
  if (!secret || !isStrongSecret(secret)) return null;

  cachedSecretsManagerSecret = secret.trim();
  cachedSecretsManagerSecretAt = now;
  return cachedSecretsManagerSecret;
}

async function roomTokenSecret() {
  const secretArn = process.env.COLLABORATION_ROOM_TOKEN_SECRET_ARN;
  if (secretArn) return roomTokenSecretFromSecretsManager(secretArn);

  const directSecret = process.env.COLLABORATION_ROOM_TOKEN_SECRET;
  if (!directSecret || isProductionLikeRuntime() || !isStrongSecret(directSecret)) return null;
  return directSecret.trim();
}

function isPayload(value: unknown): value is CollaborationRoomTokenPayload {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const payload = value as Record<string, unknown>;
  return (
    typeof payload.sub === 'string' &&
    payload.purpose === 'collaboration_room' &&
    typeof payload.org_id === 'string' &&
    typeof payload.user_id === 'string' &&
    (payload.entity_type === 'dispense_task' || payload.entity_type === 'visit_record') &&
    typeof payload.entity_id === 'string' &&
    typeof payload.room === 'string' &&
    typeof payload.exp === 'number' &&
    typeof payload.iat === 'number' &&
    payload.sub === payload.user_id &&
    payload.room === `${payload.org_id}:${payload.entity_type}:${payload.entity_id}`
  );
}

export async function validateRoomToken(
  token: string | null | undefined,
): Promise<ValidationResult> {
  try {
    const secret = await roomTokenSecret();
    if (!token || !secret) return { ok: false };

    const payload = await decode({
      token,
      secret,
      salt: COLLABORATION_ROOM_TOKEN_SALT,
    });
    if (!isPayload(payload)) return { ok: false };
    return { ok: true, payload };
  } catch {
    return { ok: false };
  }
}
