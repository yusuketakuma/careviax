import type { UserRole } from '@/phos/contracts/phos_contracts';
import { findPhosRoute } from '@/phos/infra/api-gateway-routes';
import { hashTenantId } from './observability';
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
    recordAuthorizationDenied(ctx, routeKey, { route_key: routeKey });
    throw new PhosAuthorizationError('unknown PH-OS route', { route_key: routeKey });
  }
  const missingScopes = route.required_scopes.filter((scope) => !ctx.scopes.includes(scope));
  if (missingScopes.length > 0) {
    const details = { missing_scopes: missingScopes };
    recordAuthorizationDenied(ctx, routeKey, details);
    throw new PhosAuthorizationError('missing required scope', details);
  }
  if (!route.allowed_roles.includes(ctx.role)) {
    const details = {
      role: ctx.role,
      allowed_roles: [...route.allowed_roles],
    };
    recordAuthorizationDenied(ctx, routeKey, details);
    throw new PhosAuthorizationError('role is not allowed', details);
  }
}

function recordAuthorizationDenied(
  ctx: TenantContext,
  route_key: string,
  details: Record<string, unknown>,
) {
  ctx.observability?.emitMetric({
    name: 'AuthorizationDeniedCount',
    value: 1,
    unit: 'Count',
    route_key,
    tenant_id: ctx.tenant_id,
    error_code: 'FORBIDDEN',
  });
  ctx.observability?.recordSecurityEvent({
    event_type: 'AUTHORIZATION_DENIED',
    severity: 'WARNING',
    tenant_id: ctx.tenant_id,
    user_id: ctx.user_id,
    request_id: ctx.request_id,
    correlation_id: ctx.correlation_id,
    route_key,
    error_code: 'FORBIDDEN',
    details,
  });
  ctx.observability?.annotateTrace({
    route_key,
    tenant_id_hash: hashTenantId(ctx.tenant_id),
    error_code: 'FORBIDDEN',
  });
}
