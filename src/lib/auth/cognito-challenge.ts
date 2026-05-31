import { readJsonObject } from '@/lib/db/json';

export type CognitoChallengeType = 'NEW_PASSWORD_REQUIRED' | 'SOFTWARE_TOKEN_MFA';

export type CognitoChallengePayload = {
  type: CognitoChallengeType;
  email: string;
  session: string;
};

const CHALLENGE_PREFIX = 'COGNITO_CHALLENGE:';
export const COGNITO_CHALLENGE_STORAGE_KEY = 'ph-os.cognito.challenge';

export function encodeCognitoChallenge(payload: CognitoChallengePayload): string {
  return `${CHALLENGE_PREFIX}${encodeURIComponent(JSON.stringify(payload))}`;
}

function parseCognitoChallengePayload(raw: string): CognitoChallengePayload | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }

  const object = readJsonObject(parsed);
  if (!object) return null;
  if (object.type !== 'NEW_PASSWORD_REQUIRED' && object.type !== 'SOFTWARE_TOKEN_MFA') {
    return null;
  }
  if (typeof object.email !== 'string' || typeof object.session !== 'string') return null;

  return {
    type: object.type,
    email: object.email,
    session: object.session,
  };
}

export function decodeCognitoChallenge(
  value: string | null | undefined,
): CognitoChallengePayload | null {
  if (!value?.startsWith(CHALLENGE_PREFIX)) return null;
  try {
    return parseCognitoChallengePayload(decodeURIComponent(value.slice(CHALLENGE_PREFIX.length)));
  } catch {
    return null;
  }
}

export function readStoredCognitoChallenge(
  value: string | null | undefined,
): CognitoChallengePayload | null {
  if (!value) return null;
  return parseCognitoChallengePayload(value);
}
