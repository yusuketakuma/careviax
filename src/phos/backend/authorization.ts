import type { UserRole } from '@/phos/contracts/phos_contracts';
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
