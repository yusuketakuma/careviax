import { describe, expect, it } from 'vitest';
import { handler, type PhosCognitoPreTokenGenerationEvent } from './cognito-pre-token-generation';

function event(
  overrides: Partial<PhosCognitoPreTokenGenerationEvent> = {},
): PhosCognitoPreTokenGenerationEvent {
  return {
    version: '2',
    triggerSource: 'TokenGeneration_Authentication',
    request: {
      userAttributes: {
        sub: 'user-uuid',
        'custom:tenant_id': 'tenant_abc123',
        'custom:role': 'PHARMACIST',
      },
      scopes: ['openid', 'phos/cards.read'],
      groupConfiguration: {
        groupsToOverride: ['pharmacist'],
        iamRolesToOverride: [],
        preferredRole: 'arn:aws:iam::123456789012:role/phos',
      },
    },
    response: {
      claimsAndScopeOverrideDetails: {
        accessTokenGeneration: {
          claimsToAddOrOverride: {
            existing_claim: 'keep',
          },
          scopesToAdd: ['phos/cards.read'],
        },
      },
    },
    ...overrides,
  };
}

describe('PH-OS Cognito pre token generation trigger', () => {
  it('adds canonical tenant and role claims to the access token', async () => {
    await expect(handler(event())).resolves.toMatchObject({
      response: {
        claimsAndScopeOverrideDetails: {
          accessTokenGeneration: {
            claimsToAddOrOverride: {
              existing_claim: 'keep',
              tenant_id: 'tenant_abc123',
              role: 'PHARMACIST',
            },
            scopesToAdd: ['phos/cards.read'],
          },
          groupOverrideDetails: {
            groupsToOverride: ['pharmacist'],
          },
        },
      },
    });
  });

  it('normalizes role casing from Cognito custom attributes', async () => {
    const response = await handler(
      event({
        request: {
          userAttributes: {
            'custom:tenant_id': 'tenant_abc123',
            'custom:role': ' pharmacy_clerk ',
          },
        },
      }),
    );

    expect(
      response.response.claimsAndScopeOverrideDetails?.accessTokenGeneration?.claimsToAddOrOverride,
    ).toMatchObject({
      tenant_id: 'tenant_abc123',
      role: 'PHARMACY_CLERK',
    });
  });

  it('accepts Cognito access-token customization event version 3', async () => {
    await expect(handler(event({ version: 'V3_0' }))).resolves.toMatchObject({
      response: {
        claimsAndScopeOverrideDetails: {
          accessTokenGeneration: {
            claimsToAddOrOverride: {
              tenant_id: 'tenant_abc123',
              role: 'PHARMACIST',
            },
          },
        },
      },
    });
  });

  it('fails closed when the user pool still sends V1 events', async () => {
    await expect(handler(event({ version: '1' }))).rejects.toThrow(
      'PHOS_COGNITO_PRE_TOKEN_V2_REQUIRED',
    );
  });

  it('fails closed when tenant or role attributes are missing or invalid', async () => {
    await expect(
      handler(
        event({
          request: {
            userAttributes: {
              'custom:role': 'PHARMACIST',
            },
          },
        }),
      ),
    ).rejects.toThrow('PHOS_COGNITO_CUSTOM_TENANT_ID_MISSING');

    await expect(
      handler(
        event({
          request: {
            userAttributes: {
              'custom:tenant_id': '../tenant_abc123',
              'custom:role': 'PHARMACIST',
            },
          },
        }),
      ),
    ).rejects.toThrow('PHOS_COGNITO_TENANT_ID_INVALID');

    await expect(
      handler(
        event({
          request: {
            userAttributes: {
              'custom:tenant_id': 'tenant_abc123',
              'custom:role': 'owner',
            },
          },
        }),
      ),
    ).rejects.toThrow('PHOS_COGNITO_ROLE_INVALID');
  });
});
