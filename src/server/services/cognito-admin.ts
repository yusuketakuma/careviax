import {
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  AdminDisableUserCommand,
  AdminEnableUserCommand,
  AdminGetUserCommand,
  AdminSetUserMFAPreferenceCommand,
  AdminUpdateUserAttributesCommand,
  CognitoIdentityProviderClient,
  type AttributeType,
} from '@aws-sdk/client-cognito-identity-provider';
import { normalizePhosRole } from '@/lib/auth/phos-role';
import type { UserRole as PhosUserRole } from '@/phos/contracts/phos_contracts';

const DEFAULT_REGION = 'ap-northeast-1';

let cachedClient: CognitoIdentityProviderClient | null = null;

function getRequiredCognitoConfig() {
  const userPoolId = process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID;
  const region = process.env.AWS_REGION ?? DEFAULT_REGION;

  if (!userPoolId) {
    throw new Error('COGNITO_NOT_CONFIGURED');
  }

  return { userPoolId, region };
}

function getClient() {
  if (cachedClient) return cachedClient;

  const { region } = getRequiredCognitoConfig();
  cachedClient = new CognitoIdentityProviderClient({ region });
  return cachedClient;
}

function getAttributeValue(attributes: AttributeType[] | undefined, name: string) {
  return attributes?.find((attribute) => attribute.Name === name)?.Value;
}

function assertSafePhosTenantId(tenantId: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(tenantId)) {
    throw new Error('COGNITO_PHOS_TENANT_ID_INVALID');
  }
}

export function buildCognitoUserAttributes(args: {
  email: string;
  name: string;
  phone?: string | null;
  phosTenantId?: string | null;
  phosRole?: PhosUserRole | string | null;
}) {
  const attributes: AttributeType[] = [
    { Name: 'email', Value: args.email },
    { Name: 'email_verified', Value: 'true' },
    { Name: 'name', Value: args.name },
  ];

  if (args.phone?.startsWith('+')) {
    attributes.push({ Name: 'phone_number', Value: args.phone });
  }

  if (args.phosTenantId) {
    assertSafePhosTenantId(args.phosTenantId);
    attributes.push({ Name: 'custom:tenant_id', Value: args.phosTenantId });
  }

  if (args.phosRole) {
    const role = normalizePhosRole(args.phosRole);
    if (!role) {
      throw new Error('COGNITO_PHOS_ROLE_INVALID');
    }
    attributes.push({ Name: 'custom:role', Value: role });
  }

  return attributes;
}

async function resolveSub(userPoolId: string, username: string) {
  const output = await getClient().send(
    new AdminGetUserCommand({
      UserPoolId: userPoolId,
      Username: username,
    }),
  );

  const sub = getAttributeValue(output.UserAttributes, 'sub');
  if (!sub) {
    throw new Error('COGNITO_SUB_NOT_FOUND');
  }

  return sub;
}

export function normalizeCognitoUsername(email: string) {
  return email.trim().toLowerCase();
}

export async function inviteCognitoUser(args: {
  email: string;
  name: string;
  phone?: string | null;
  phosTenantId?: string | null;
  phosRole?: PhosUserRole | string | null;
}) {
  const { userPoolId } = getRequiredCognitoConfig();
  const username = normalizeCognitoUsername(args.email);
  const output = await getClient().send(
    new AdminCreateUserCommand({
      UserPoolId: userPoolId,
      Username: username,
      DesiredDeliveryMediums: ['EMAIL'],
      UserAttributes: buildCognitoUserAttributes(args),
    }),
  );

  const sub =
    getAttributeValue(output.User?.Attributes, 'sub') ?? (await resolveSub(userPoolId, username));

  return { username, sub };
}

export async function resendCognitoInvite(username: string) {
  const { userPoolId } = getRequiredCognitoConfig();
  await getClient().send(
    new AdminCreateUserCommand({
      UserPoolId: userPoolId,
      Username: normalizeCognitoUsername(username),
      MessageAction: 'RESEND',
    }),
  );
}

export async function deleteCognitoUser(username: string) {
  const { userPoolId } = getRequiredCognitoConfig();
  await getClient().send(
    new AdminDeleteUserCommand({
      UserPoolId: userPoolId,
      Username: normalizeCognitoUsername(username),
    }),
  );
}

export async function updateCognitoUserProfile(args: {
  username: string;
  email: string;
  name: string;
  phone?: string | null;
  phosTenantId?: string | null;
  phosRole?: PhosUserRole | string | null;
}) {
  const { userPoolId } = getRequiredCognitoConfig();
  await getClient().send(
    new AdminUpdateUserAttributesCommand({
      UserPoolId: userPoolId,
      Username: normalizeCognitoUsername(args.username),
      UserAttributes: buildCognitoUserAttributes(args),
    }),
  );
}

export async function disableCognitoUser(username: string) {
  const { userPoolId } = getRequiredCognitoConfig();
  await getClient().send(
    new AdminDisableUserCommand({
      UserPoolId: userPoolId,
      Username: normalizeCognitoUsername(username),
    }),
  );
}

export async function enableCognitoUser(username: string) {
  const { userPoolId } = getRequiredCognitoConfig();
  await getClient().send(
    new AdminEnableUserCommand({
      UserPoolId: userPoolId,
      Username: normalizeCognitoUsername(username),
    }),
  );
}

export async function disableCognitoTotpForUser(username: string) {
  const { userPoolId } = getRequiredCognitoConfig();
  await getClient().send(
    new AdminSetUserMFAPreferenceCommand({
      UserPoolId: userPoolId,
      Username: normalizeCognitoUsername(username),
      SoftwareTokenMfaSettings: {
        Enabled: false,
        PreferredMfa: false,
      },
    }),
  );
}
