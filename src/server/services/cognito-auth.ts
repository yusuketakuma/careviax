import crypto from 'node:crypto';
import {
  AssociateSoftwareTokenCommand,
  ChangePasswordCommand,
  CognitoIdentityProviderClient,
  ConfirmForgotPasswordCommand,
  ForgotPasswordCommand,
  GetUserCommand,
  GlobalSignOutCommand,
  InitiateAuthCommand,
  RespondToAuthChallengeCommand,
  SetUserMFAPreferenceCommand,
  VerifySoftwareTokenCommand,
  type AuthenticationResultType,
} from '@aws-sdk/client-cognito-identity-provider';
import { encodeCognitoChallenge, type CognitoChallengePayload } from '@/lib/auth/cognito-challenge';
import { parseJsonObjectOrNull } from '@/lib/db/json';

const DEFAULT_REGION = 'ap-northeast-1';
export const LOCAL_DEMO_LOGIN_EMAIL = 'demo@ph-os.example.com';
export const LOCAL_DEMO_LOGIN_PASSWORD = 'PhOsDemo-2026';
const LOCAL_DEMO_COGNITO_SUB = 'demo-cognito-sub-001';
const LOCAL_DEMO_USER_NAME = '山田 太郎';

let cachedClient: CognitoIdentityProviderClient | null = null;

function isLocalDemoPasswordLoginAllowed() {
  return (
    process.env.PLAYWRIGHT === '1' ||
    process.env.ALLOW_LOCAL_DEMO_PASSWORD_LOGIN === '1' ||
    process.env.ALLOW_LOCAL_DEMO_PASSWORD_LOGIN === 'true'
  );
}

function authenticateLocalDemoUser(args: { email: string; password: string }) {
  if (!isLocalDemoPasswordLoginAllowed()) return null;

  const expectedPassword =
    process.env.LOCAL_DEMO_PASSWORD ??
    (process.env.PLAYWRIGHT === '1' ? LOCAL_DEMO_LOGIN_PASSWORD : undefined);

  if (!expectedPassword) return null;

  const username = normalizeEmail(args.email);
  if (username !== LOCAL_DEMO_LOGIN_EMAIL || args.password !== expectedPassword) {
    return null;
  }

  return {
    id: LOCAL_DEMO_COGNITO_SUB,
    email: LOCAL_DEMO_LOGIN_EMAIL,
    name: LOCAL_DEMO_USER_NAME,
    cognitoSub: LOCAL_DEMO_COGNITO_SUB,
  };
}

function getRequiredCognitoAuthConfig() {
  const clientId = process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID;
  const clientSecret = process.env.COGNITO_CLIENT_SECRET;
  const region = process.env.AWS_REGION ?? DEFAULT_REGION;

  if (!clientId) {
    throw new Error('COGNITO_NOT_CONFIGURED');
  }

  return { clientId, clientSecret, region };
}

function getClient() {
  if (cachedClient) return cachedClient;

  const { region } = getRequiredCognitoAuthConfig();
  cachedClient = new CognitoIdentityProviderClient({ region });
  return cachedClient;
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function buildSecretHash(username: string) {
  const { clientId, clientSecret } = getRequiredCognitoAuthConfig();
  if (!clientSecret) return undefined;

  return crypto
    .createHmac('sha256', clientSecret)
    .update(`${username}${clientId}`)
    .digest('base64');
}

export function parseCognitoIdTokenPayload(token: string) {
  const [, payload] = token.split('.');
  if (!payload) {
    throw new Error('COGNITO_ID_TOKEN_INVALID');
  }

  const object = parseJsonObjectOrNull(Buffer.from(payload, 'base64url').toString('utf8'));
  if (!object) {
    throw new Error('COGNITO_ID_TOKEN_INVALID');
  }

  return {
    sub: typeof object.sub === 'string' ? object.sub : undefined,
    email: typeof object.email === 'string' ? object.email : undefined,
    name: typeof object.name === 'string' ? object.name : undefined,
  };
}

function parseAuthenticatedUser(args: {
  email: string;
  authenticationResult: AuthenticationResultType;
}) {
  if (!args.authenticationResult.IdToken) {
    throw new Error('COGNITO_ID_TOKEN_MISSING');
  }

  const payload = parseCognitoIdTokenPayload(args.authenticationResult.IdToken);
  return {
    id: payload.sub ?? normalizeEmail(args.email),
    email: payload.email ?? normalizeEmail(args.email),
    name: payload.name ?? normalizeEmail(args.email),
    cognitoSub: payload.sub,
    accessToken: args.authenticationResult.AccessToken,
    refreshToken: args.authenticationResult.RefreshToken,
    idToken: args.authenticationResult.IdToken,
  };
}

function toChallengePayload(args: {
  challengeName: string | undefined;
  email: string;
  session: string | undefined;
}): CognitoChallengePayload | null {
  if (
    !args.session ||
    (args.challengeName !== 'NEW_PASSWORD_REQUIRED' && args.challengeName !== 'SOFTWARE_TOKEN_MFA')
  ) {
    return null;
  }

  return {
    type: args.challengeName,
    email: normalizeEmail(args.email),
    session: args.session,
  };
}

export async function authenticateWithPassword(args: { email: string; password: string }) {
  const localDemoUser = authenticateLocalDemoUser(args);
  if (localDemoUser) return localDemoUser;

  const { clientId } = getRequiredCognitoAuthConfig();
  const username = normalizeEmail(args.email);
  const secretHash = buildSecretHash(username);

  const output = await getClient().send(
    new InitiateAuthCommand({
      ClientId: clientId,
      AuthFlow: 'USER_PASSWORD_AUTH',
      AuthParameters: {
        USERNAME: username,
        PASSWORD: args.password,
        ...(secretHash ? { SECRET_HASH: secretHash } : {}),
      },
    }),
  );

  const challenge = toChallengePayload({
    challengeName: output.ChallengeName,
    email: username,
    session: output.Session,
  });
  if (challenge) {
    throw new Error(encodeCognitoChallenge(challenge));
  }

  if (!output.AuthenticationResult) {
    throw new Error('AUTH_FAILED');
  }

  return parseAuthenticatedUser({
    email: username,
    authenticationResult: output.AuthenticationResult,
  });
}

export async function respondToNewPasswordChallenge(args: {
  email: string;
  newPassword: string;
  session: string;
}) {
  const { clientId } = getRequiredCognitoAuthConfig();
  const username = normalizeEmail(args.email);
  const secretHash = buildSecretHash(username);

  const output = await getClient().send(
    new RespondToAuthChallengeCommand({
      ClientId: clientId,
      ChallengeName: 'NEW_PASSWORD_REQUIRED',
      Session: args.session,
      ChallengeResponses: {
        USERNAME: username,
        NEW_PASSWORD: args.newPassword,
        ...(secretHash ? { SECRET_HASH: secretHash } : {}),
      },
    }),
  );

  const challenge = toChallengePayload({
    challengeName: output.ChallengeName,
    email: username,
    session: output.Session,
  });
  if (challenge) {
    throw new Error(encodeCognitoChallenge(challenge));
  }

  if (!output.AuthenticationResult) {
    throw new Error('AUTH_FAILED');
  }

  return parseAuthenticatedUser({
    email: username,
    authenticationResult: output.AuthenticationResult,
  });
}

export async function respondToSoftwareTokenChallenge(args: {
  email: string;
  code: string;
  session: string;
}) {
  const { clientId } = getRequiredCognitoAuthConfig();
  const username = normalizeEmail(args.email);
  const secretHash = buildSecretHash(username);

  const output = await getClient().send(
    new RespondToAuthChallengeCommand({
      ClientId: clientId,
      ChallengeName: 'SOFTWARE_TOKEN_MFA',
      Session: args.session,
      ChallengeResponses: {
        USERNAME: username,
        SOFTWARE_TOKEN_MFA_CODE: args.code,
        ...(secretHash ? { SECRET_HASH: secretHash } : {}),
      },
    }),
  );

  if (!output.AuthenticationResult) {
    throw new Error('AUTH_FAILED');
  }

  return parseAuthenticatedUser({
    email: username,
    authenticationResult: output.AuthenticationResult,
  });
}

export async function changePasswordWithAccessToken(args: {
  accessToken: string;
  currentPassword: string;
  newPassword: string;
}) {
  await getClient().send(
    new ChangePasswordCommand({
      AccessToken: args.accessToken,
      PreviousPassword: args.currentPassword,
      ProposedPassword: args.newPassword,
    }),
  );
}

export async function startForgotPassword(email: string) {
  const { clientId } = getRequiredCognitoAuthConfig();
  const username = normalizeEmail(email);
  const secretHash = buildSecretHash(username);

  await getClient().send(
    new ForgotPasswordCommand({
      ClientId: clientId,
      Username: username,
      ...(secretHash ? { SecretHash: secretHash } : {}),
    }),
  );
}

export async function confirmForgotPassword(args: {
  email: string;
  code: string;
  newPassword: string;
}) {
  const { clientId } = getRequiredCognitoAuthConfig();
  const username = normalizeEmail(args.email);
  const secretHash = buildSecretHash(username);

  await getClient().send(
    new ConfirmForgotPasswordCommand({
      ClientId: clientId,
      Username: username,
      ConfirmationCode: args.code,
      Password: args.newPassword,
      ...(secretHash ? { SecretHash: secretHash } : {}),
    }),
  );
}

export async function associateTotpForAccessToken(accessToken: string) {
  return getClient().send(
    new AssociateSoftwareTokenCommand({
      AccessToken: accessToken,
    }),
  );
}

export async function verifyTotpForAccessToken(args: {
  accessToken: string;
  code: string;
  deviceName?: string;
}) {
  const result = await getClient().send(
    new VerifySoftwareTokenCommand({
      AccessToken: args.accessToken,
      UserCode: args.code,
      FriendlyDeviceName: args.deviceName,
    }),
  );

  await getClient().send(
    new SetUserMFAPreferenceCommand({
      AccessToken: args.accessToken,
      SoftwareTokenMfaSettings: {
        Enabled: true,
        PreferredMfa: true,
      },
    }),
  );

  return result;
}

export async function getUserMfaState(accessToken: string) {
  const output = await getClient().send(
    new GetUserCommand({
      AccessToken: accessToken,
    }),
  );

  const userMfaSettings = output.UserMFASettingList ?? [];
  return {
    preferredMfaSetting: output.PreferredMfaSetting ?? null,
    enabled: userMfaSettings.includes('SOFTWARE_TOKEN_MFA'),
    availableMethods: userMfaSettings,
  };
}

export async function disableTotpForAccessToken(accessToken: string) {
  return getClient().send(
    new SetUserMFAPreferenceCommand({
      AccessToken: accessToken,
      SoftwareTokenMfaSettings: {
        Enabled: false,
        PreferredMfa: false,
      },
    }),
  );
}

export async function globalSignOutWithAccessToken(accessToken: string) {
  const client = getClient();
  return client.send(
    new GlobalSignOutCommand({
      AccessToken: accessToken,
    }),
  );
}

export async function refreshCognitoTokens(args: { refreshToken: string; username: string }) {
  const { clientId } = getRequiredCognitoAuthConfig();
  const username = normalizeEmail(args.username);
  const secretHash = buildSecretHash(username);

  const output = await getClient().send(
    new InitiateAuthCommand({
      ClientId: clientId,
      AuthFlow: 'REFRESH_TOKEN_AUTH',
      AuthParameters: {
        REFRESH_TOKEN: args.refreshToken,
        ...(secretHash ? { SECRET_HASH: secretHash, USERNAME: username } : {}),
      },
    }),
  );

  if (!output.AuthenticationResult?.AccessToken) {
    throw new Error('REFRESH_FAILED');
  }

  return {
    accessToken: output.AuthenticationResult.AccessToken,
    idToken: output.AuthenticationResult.IdToken,
    expiresIn: output.AuthenticationResult.ExpiresIn ?? 3600,
  };
}
