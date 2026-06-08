import { describe, expect, it } from 'vitest';
import { UserRole } from '@/phos/contracts/phos_contracts';
import {
  assertAllowedRole,
  assertRequiredScopes,
  assertRouteAccess,
  PhosAuthorizationError,
} from './authorization';
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

  it('enforces the API Gateway route manifest scope and role policy', () => {
    expect(() => assertRouteAccess(ctx, 'GET /cards')).not.toThrow();
    expect(() => assertRouteAccess({ ...ctx, scopes: ['phos/cards.write'] }, 'GET /cards')).toThrow(
      PhosAuthorizationError,
    );
    expect(() =>
      assertRouteAccess({ ...ctx, role: UserRole.DISPENSE_ASSISTANT }, 'GET /cards'),
    ).toThrow(PhosAuthorizationError);
    expect(() => assertRouteAccess(ctx, 'GET /unknown')).toThrow(PhosAuthorizationError);
  });
});
