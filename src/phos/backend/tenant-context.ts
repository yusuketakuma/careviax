import { UserRole } from '@/phos/contracts/phos_contracts';
import type { ErrorResponse, UserRole as UserRoleType } from '@/phos/contracts/phos_contracts';
import type { PhosObservabilitySink } from './observability';

export type TenantContext = {
  tenant_id: string;
  user_id: string;
  role: UserRoleType;
  request_id: string;
  correlation_id: string;
  scopes: string[];
  observability?: PhosObservabilitySink;
};

export type JwtClaims = Record<string, unknown>;

export class TenantContextError extends Error {
  response: ErrorResponse;
  status: number;

  constructor(status: number, response: ErrorResponse) {
    super(response.error_code);
    this.name = 'TenantContextError';
    this.status = status;
    this.response = response;
  }
}

function readStringClaim(claims: JwtClaims, key: string): string | null {
  const value = claims[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function normalizeScopeClaim(value: unknown): string[] {
  if (typeof value === 'string') {
    return value
      .split(/\s+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  if (Array.isArray(value)) {
    return value.filter(
      (item): item is string => typeof item === 'string' && item.trim().length > 0,
    );
  }
  return [];
}

function readScopes(claims: JwtClaims): string[] {
  return [...new Set([...normalizeScopeClaim(claims.scope), ...normalizeScopeClaim(claims.scp)])];
}

function normalizeRole(role: string | null): UserRoleType | null {
  if (!role) return null;
  const upperRole = role.toUpperCase();
  return Object.values(UserRole).find((value) => value === upperRole) ?? null;
}

function isSafeTenantId(value: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(value);
}

export function buildTenantContext(input: {
  claims: JwtClaims;
  request_id: string;
  correlation_id?: string;
  observability?: PhosObservabilitySink;
}): TenantContext {
  const tenant_id =
    readStringClaim(input.claims, 'tenant_id') ?? readStringClaim(input.claims, 'custom:tenant_id');
  const user_id = readStringClaim(input.claims, 'sub');
  const role = normalizeRole(
    readStringClaim(input.claims, 'role') ?? readStringClaim(input.claims, 'custom:role'),
  );
  const token_use = readStringClaim(input.claims, 'token_use');

  if (token_use !== 'access') {
    throw new TenantContextError(401, {
      request_id: input.request_id,
      error_code: 'TENANT_CONTEXT_MISSING',
      message_key: 'api.error.access_token_required',
      details: { token_use: token_use ?? null },
    });
  }

  if (!tenant_id || !user_id || !role) {
    throw new TenantContextError(401, {
      request_id: input.request_id,
      error_code: 'TENANT_CONTEXT_MISSING',
      message_key: 'api.error.tenant_context_missing',
      details: {
        missing: {
          tenant_id: !tenant_id,
          user_id: !user_id,
          role: !role,
        },
      },
    });
  }

  if (!isSafeTenantId(tenant_id)) {
    throw new TenantContextError(401, {
      request_id: input.request_id,
      error_code: 'TENANT_CONTEXT_MISSING',
      message_key: 'api.error.invalid_tenant_id_claim',
    });
  }

  return {
    tenant_id,
    user_id,
    role,
    request_id: input.request_id,
    correlation_id: input.correlation_id ?? input.request_id,
    scopes: readScopes(input.claims),
    ...(input.observability ? { observability: input.observability } : {}),
  };
}

function hasTenantIdKey(value: unknown): boolean {
  if (value == null) return false;
  if (value instanceof URLSearchParams) return value.has('tenant_id');
  if (Array.isArray(value)) return value.some((item) => hasTenantIdKey(item));
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).some(
      ([key, child]) => key === 'tenant_id' || hasTenantIdKey(child),
    );
  }
  return false;
}

export function assertTenantIdNotInExternalInput(input: {
  request_id: string;
  body?: unknown;
  query?: unknown;
  path?: unknown;
}) {
  const source = hasTenantIdKey(input.body)
    ? 'body'
    : hasTenantIdKey(input.query)
      ? 'query'
      : hasTenantIdKey(input.path)
        ? 'path'
        : null;

  if (!source) return;

  throw new TenantContextError(400, {
    request_id: input.request_id,
    error_code: 'TENANT_ID_IN_PAYLOAD_FORBIDDEN',
    message_key: 'api.error.tenant_id_in_payload_forbidden',
    details: { source },
  });
}
