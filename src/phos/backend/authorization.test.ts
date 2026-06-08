import { describe, expect, it } from 'vitest';
import { UserRole } from '@/phos/contracts/phos_contracts';
import { assertAllowedRole, assertRequiredScopes, PhosAuthorizationError } from './authorization';
import type { TenantContext } from './tenant-context';

const ctx: TenantContext = {
  tenant_id: 'tenant_abc123',
  user_id: 'user_1',
  role: UserRole.PHARMACIST,
  request_id: 'req_1',
  correlation_id: 'corr_1',
  scopes: ['phos/cards.read'],
};

describe('PH-OS authorization helpers', () => {
  it('allows present scopes and roles', () => {
    expect(() => assertRequiredScopes(ctx, ['phos/cards.read'])).not.toThrow();
    expect(() => assertAllowedRole(ctx, [UserRole.PHARMACIST])).not.toThrow();
  });

  it('rejects missing scopes and disallowed roles', () => {
    expect(() => assertRequiredScopes(ctx, ['phos/cards.write'])).toThrow(PhosAuthorizationError);
    expect(() => assertAllowedRole(ctx, [UserRole.PHARMACY_CLERK])).toThrow(PhosAuthorizationError);
  });
});
