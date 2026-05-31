import { decode, encode } from 'next-auth/jwt';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { getAuthSecret } from '@/lib/auth/secret';
import { APP_ENV } from '@/lib/config/app-env';
import { readJsonObject } from '@/lib/db/json';
import type { CollaborationEntityType } from '@/server/services/collaboration-access';

const COLLABORATION_ROOM_TOKEN_SALT = 'ph-os.collaboration-room-token.v1';
export const COLLABORATION_ROOM_TOKEN_TTL_SECONDS = 5 * 60;
const LOCAL_FALLBACK_COLLABORATION_ROOM_TOKEN_SECRET = 'ph-os-local-auth-secret';
const MIN_COLLABORATION_ROOM_TOKEN_SECRET_LENGTH = 32;
const SECRETS_MANAGER_CACHE_TTL_MS = COLLABORATION_ROOM_TOKEN_TTL_SECONDS * 1000;

let cachedSecretsManagerSecret: string | null = null;
let cachedSecretsManagerSecretAt: number | null = null;

export type CollaborationRoomTokenPayload = {
  sub: string;
  purpose: 'collaboration_room';
  org_id: string;
  user_id: string;
  entity_type: CollaborationEntityType;
  entity_id: string;
  room: string;
  exp: number;
  iat: number;
};

type CollaborationRoomTokenValidationResult =
  | {
      ok: true;
      payload: CollaborationRoomTokenPayload;
    }
  | {
      ok: false;
      kind: 'not_found' | 'validation';
      message: string;
    };

export class MissingCollaborationRoomTokenSecretError extends Error {
  constructor() {
    super('Collaboration room token secret is not configured');
    this.name = 'MissingCollaborationRoomTokenSecretError';
  }
}

export function clearCollaborationRoomTokenSecretCache() {
  cachedSecretsManagerSecret = null;
  cachedSecretsManagerSecretAt = null;
}

function isProductionLikeRuntime() {
  return (
    APP_ENV === 'production' || APP_ENV === 'staging' || Boolean(process.env.AWS_EXECUTION_ENV)
  );
}

function requireStrongCollaborationRoomTokenSecret(secret: string) {
  const normalized = secret.trim();
  if (
    normalized.length < MIN_COLLABORATION_ROOM_TOKEN_SECRET_LENGTH ||
    normalized === LOCAL_FALLBACK_COLLABORATION_ROOM_TOKEN_SECRET
  ) {
    throw new MissingCollaborationRoomTokenSecretError();
  }
  return normalized;
}

function parseSecretString(raw: string) {
  const trimmed = raw.trim();

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed === 'string') return parsed;

    const record = readJsonObject(parsed);
    if (record) {
      const secret = record.COLLABORATION_ROOM_TOKEN_SECRET;
      if (typeof secret === 'string') return secret;
      throw new MissingCollaborationRoomTokenSecretError();
    }

    throw new MissingCollaborationRoomTokenSecretError();
  } catch (error) {
    if (error instanceof MissingCollaborationRoomTokenSecretError) throw error;

    if (trimmed.startsWith('{') || trimmed.startsWith('[') || trimmed.startsWith('"')) {
      throw new MissingCollaborationRoomTokenSecretError();
    }
    // SecretString may be the raw signing secret rather than a JSON object.
  }

  return raw;
}

async function getCollaborationRoomTokenSecretFromSecretsManager(secretArn: string) {
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
  if (!raw) throw new MissingCollaborationRoomTokenSecretError();

  cachedSecretsManagerSecret = requireStrongCollaborationRoomTokenSecret(parseSecretString(raw));
  cachedSecretsManagerSecretAt = now;
  return cachedSecretsManagerSecret;
}

async function getCollaborationRoomTokenSecret() {
  const secretArn = process.env.COLLABORATION_ROOM_TOKEN_SECRET_ARN;
  if (secretArn) return getCollaborationRoomTokenSecretFromSecretsManager(secretArn);

  const dedicatedSecret = process.env.COLLABORATION_ROOM_TOKEN_SECRET;
  if (dedicatedSecret && !isProductionLikeRuntime()) {
    return requireStrongCollaborationRoomTokenSecret(dedicatedSecret);
  }
  if (isProductionLikeRuntime()) throw new MissingCollaborationRoomTokenSecretError();

  const secret = getAuthSecret();
  if (!secret) throw new MissingCollaborationRoomTokenSecretError();
  return secret;
}

function buildCanonicalCollaborationRoomName(args: {
  orgId: string;
  entityType: CollaborationEntityType;
  entityId: string;
}) {
  return `${args.orgId}:${args.entityType}:${args.entityId}`;
}

export async function issueCollaborationRoomToken(args: {
  orgId: string;
  userId: string;
  entityType: CollaborationEntityType;
  entityId: string;
}) {
  const room = buildCanonicalCollaborationRoomName({
    orgId: args.orgId,
    entityType: args.entityType,
    entityId: args.entityId,
  });

  return encode({
    secret: await getCollaborationRoomTokenSecret(),
    salt: COLLABORATION_ROOM_TOKEN_SALT,
    maxAge: COLLABORATION_ROOM_TOKEN_TTL_SECONDS,
    token: {
      sub: args.userId,
      purpose: 'collaboration_room',
      org_id: args.orgId,
      user_id: args.userId,
      entity_type: args.entityType,
      entity_id: args.entityId,
      room,
    },
  });
}

function isCollaborationRoomTokenPayload(value: unknown): value is CollaborationRoomTokenPayload {
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
    payload.sub === payload.user_id
  );
}

function hasCanonicalRoom(payload: CollaborationRoomTokenPayload) {
  return (
    payload.room ===
    buildCanonicalCollaborationRoomName({
      orgId: payload.org_id,
      entityType: payload.entity_type,
      entityId: payload.entity_id,
    })
  );
}

export async function validateCollaborationRoomToken(
  token: string | null | undefined,
  expected?: Partial<
    Pick<CollaborationRoomTokenPayload, 'org_id' | 'user_id' | 'entity_type' | 'entity_id' | 'room'>
  >,
): Promise<CollaborationRoomTokenValidationResult> {
  if (!token) {
    return {
      ok: false,
      kind: 'validation',
      message: '共同編集トークンが必要です',
    };
  }

  let payload: unknown;
  try {
    payload = await decode({
      token,
      secret: await getCollaborationRoomTokenSecret(),
      salt: COLLABORATION_ROOM_TOKEN_SALT,
    });
  } catch {
    return {
      ok: false,
      kind: 'not_found',
      message: '共同編集トークンが無効または期限切れです',
    };
  }

  if (!isCollaborationRoomTokenPayload(payload)) {
    return {
      ok: false,
      kind: 'not_found',
      message: '共同編集トークンが無効または期限切れです',
    };
  }

  if (!hasCanonicalRoom(payload)) {
    return {
      ok: false,
      kind: 'not_found',
      message: '共同編集トークンが無効または期限切れです',
    };
  }

  for (const [key, value] of Object.entries(expected ?? {})) {
    if (value !== undefined && payload[key as keyof CollaborationRoomTokenPayload] !== value) {
      return {
        ok: false,
        kind: 'not_found',
        message: '共同編集トークンが無効または期限切れです',
      };
    }
  }

  return {
    ok: true,
    payload,
  };
}
