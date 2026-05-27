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

export function decodeCognitoChallenge(value: string | null | undefined): CognitoChallengePayload | null {
  if (!value?.startsWith(CHALLENGE_PREFIX)) return null;

  try {
    return JSON.parse(
      decodeURIComponent(value.slice(CHALLENGE_PREFIX.length))
    ) as CognitoChallengePayload;
  } catch {
    return null;
  }
}
