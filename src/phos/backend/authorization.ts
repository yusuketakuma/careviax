import type { UserRole } from '@/phos/contracts/phos_contracts';
import { findPhosRoute } from '@/phos/infra/api-gateway-routes';
import type { TenantContext } from './tenant-context';

export class PhosAuthorizationError extends Error {
  details: Record<string, unknown>;

  constructor(message: string, details: Record<string, unknown>) {
    super(message);
    this.name = 'PhosAuthorizationError';
    this.details = details;
  }
}

export function assertRequiredScopes(ctx: TenantContext, requiredScopes: string[]): void {
  const missing = requiredScopes.filter((scope) => !ctx.scopes.includes(scope));
  if (missing.length > 0) {
    throw new PhosAuthorizationError('missing required scope', { missing_scopes: missing });
  }
}

export function assertAllowedRole(ctx: TenantContext, allowedRoles: readonly UserRole[]): void {
  if (!allowedRoles.includes(ctx.role)) {
    throw new PhosAuthorizationError('role is not allowed', {
      role: ctx.role,
      allowed_roles: [...allowedRoles],
    });
  }
}

export function assertRouteAccess(ctx: TenantContext, routeKey: string): void {
  const route = findPhosRoute(routeKey);
  if (!route) {
    throw new PhosAuthorizationError('unknown PH-OS route', { route_key: routeKey });
  }
  assertRequiredScopes(ctx, [...route.required_scopes]);
  assertAllowedRole(ctx, route.allowed_roles);
}
