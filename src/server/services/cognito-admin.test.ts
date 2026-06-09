import { describe, expect, it } from 'vitest';
import { buildCognitoUserAttributes } from './cognito-admin';

describe('buildCognitoUserAttributes', () => {
  it('adds PH-OS custom tenant and role attributes for access-token customization', () => {
    expect(
      buildCognitoUserAttributes({
        email: 'Pharmacist@example.com',
        name: 'PH-OS Pharmacist',
        phone: '+819012345678',
        phosTenantId: 'tenant_abc123',
        phosRole: 'pharmacist',
      }),
    ).toEqual([
      { Name: 'email', Value: 'Pharmacist@example.com' },
      { Name: 'email_verified', Value: 'true' },
      { Name: 'name', Value: 'PH-OS Pharmacist' },
      { Name: 'phone_number', Value: '+819012345678' },
      { Name: 'custom:tenant_id', Value: 'tenant_abc123' },
      { Name: 'custom:role', Value: 'PHARMACIST' },
    ]);
  });

  it('leaves PH-OS custom attributes untouched when not supplied', () => {
    expect(
      buildCognitoUserAttributes({
        email: 'user@example.com',
        name: 'PH-OS User',
      }),
    ).toEqual([
      { Name: 'email', Value: 'user@example.com' },
      { Name: 'email_verified', Value: 'true' },
      { Name: 'name', Value: 'PH-OS User' },
    ]);
  });

  it('rejects unsafe tenant ids and invalid PH-OS roles', () => {
    expect(() =>
      buildCognitoUserAttributes({
        email: 'user@example.com',
        name: 'PH-OS User',
        phosTenantId: '../tenant',
      }),
    ).toThrow('COGNITO_PHOS_TENANT_ID_INVALID');

    expect(() =>
      buildCognitoUserAttributes({
        email: 'user@example.com',
        name: 'PH-OS User',
        phosRole: 'owner',
      }),
    ).toThrow('COGNITO_PHOS_ROLE_INVALID');
  });
});
