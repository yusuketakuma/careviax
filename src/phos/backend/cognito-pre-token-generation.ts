import { normalizePhosRole } from '@/lib/auth/phos-role';

type CognitoGroupConfiguration = {
  groupsToOverride?: string[];
  iamRolesToOverride?: string[];
  preferredRole?: string | string[];
};

type TokenGenerationOverrides = {
  claimsToAddOrOverride?: Record<string, string>;
  claimsToSuppress?: string[];
  scopesToAdd?: string[];
  scopesToSuppress?: string[];
};

export type PhosCognitoPreTokenGenerationEvent = {
  version?: string;
  triggerSource?: string;
  request: {
    userAttributes?: Record<string, string | undefined>;
    scopes?: string[];
    groupConfiguration?: CognitoGroupConfiguration;
    clientMetadata?: Record<string, string | undefined>;
  };
  response: {
    claimsAndScopeOverrideDetails?: {
      idTokenGeneration?: TokenGenerationOverrides;
      accessTokenGeneration?: TokenGenerationOverrides;
      groupOverrideDetails?: CognitoGroupConfiguration;
    };
  };
};

function isAccessTokenCustomizationVersion(version: string | undefined): boolean {
  return version === '2' || version === '3' || version === 'V2_0' || version === 'V3_0';
}

function readRequiredUserAttribute(
  attributes: Record<string, string | undefined> | undefined,
  name: string,
): string {
  const value = attributes?.[name]?.trim();
  if (!value) {
    throw new Error(`PHOS_COGNITO_${name.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_MISSING`);
  }
  return value;
}

function assertSafeTenantId(tenantId: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(tenantId)) {
    throw new Error('PHOS_COGNITO_TENANT_ID_INVALID');
  }
}

export async function handler(
  event: PhosCognitoPreTokenGenerationEvent,
): Promise<PhosCognitoPreTokenGenerationEvent> {
  if (!isAccessTokenCustomizationVersion(event.version)) {
    throw new Error('PHOS_COGNITO_PRE_TOKEN_V2_REQUIRED');
  }

  const tenant_id = readRequiredUserAttribute(event.request.userAttributes, 'custom:tenant_id');
  const role = normalizePhosRole(
    readRequiredUserAttribute(event.request.userAttributes, 'custom:role'),
  );

  assertSafeTenantId(tenant_id);
  if (!role) {
    throw new Error('PHOS_COGNITO_ROLE_INVALID');
  }

  return {
    ...event,
    response: {
      ...event.response,
      claimsAndScopeOverrideDetails: {
        ...event.response.claimsAndScopeOverrideDetails,
        accessTokenGeneration: {
          ...event.response.claimsAndScopeOverrideDetails?.accessTokenGeneration,
          claimsToAddOrOverride: {
            ...event.response.claimsAndScopeOverrideDetails?.accessTokenGeneration
              ?.claimsToAddOrOverride,
            tenant_id,
            role,
          },
        },
        ...(event.request.groupConfiguration
          ? { groupOverrideDetails: event.request.groupConfiguration }
          : {}),
      },
    },
  };
}
