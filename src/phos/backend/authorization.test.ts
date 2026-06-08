import { describe, expect, it } from 'vitest';
import { UserRole } from '@/phos/contracts/phos_contracts';
import { assertRouteAccess, PhosAuthorizationError } from './authorization';
import { createInMemoryObservabilitySink, hashTenantId } from './observability';
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

  it('records route-level authorization denials as metrics and security events', () => {
    const observability = createInMemoryObservabilitySink();
    const deniedCtx = { ...ctx, scopes: ['phos/cards.write'], observability };

    expect(() => assertRouteAccess(deniedCtx, 'GET /cards')).toThrow(PhosAuthorizationError);

    expect(observability.metrics).toContainEqual(
      expect.objectContaining({
        name: 'AuthorizationDeniedCount',
        route_key: 'GET /cards',
        tenant_id: 'tenant_abc123',
        error_code: 'FORBIDDEN',
      }),
    );
    expect(observability.security_events).toContainEqual(
      expect.objectContaining({
        event_type: 'AUTHORIZATION_DENIED',
        tenant_id: 'tenant_abc123',
        user_id: 'user_1',
        request_id: 'req_1',
        correlation_id: 'corr_1',
        route_key: 'GET /cards',
        error_code: 'FORBIDDEN',
        details: { missing_scopes: ['phos/cards.read'] },
      }),
    );
    expect(observability.annotations).toContainEqual({
      route_key: 'GET /cards',
      tenant_id_hash: hashTenantId('tenant_abc123'),
      error_code: 'FORBIDDEN',
    });
  });
});
