import { auth } from './config';
import { prisma } from '@/lib/db/client';
import { NextRequest, NextResponse } from 'next/server';
import { MemberRole } from '@prisma/client';
import { hasPermission, type PermissionKey } from './permissions';
import { resolveLocalUserByIdentity } from './user-resolution';
import { authNoOrg, forbiddenResponse, unauthorized } from '@/lib/api/response';
import {
  clearRequestAuthContext,
  runWithRequestAuthContext,
  type RequestAuthContext,
} from './request-context';
import { withRoutePerformance } from '@/lib/utils/performance';
import { logSecurityEvent } from './security-events';
import { getClientIp } from '@/lib/api/request-ip';

export type AuthContext = RequestAuthContext;

type RequireAuthContextOptions = {
  permission?: PermissionKey;
  message?: string;
};

export type AuthRouteContext<TParams extends Record<string, string>> = {
  params: Promise<TParams>;
};

type RequireApiKeyOrAuthContextOptions = RequireAuthContextOptions & {
  apiKey?: string;
  apiKeyHeader?: string;
};

function resolveRequestPath(request: NextRequest): string {
  if (request.nextUrl?.pathname) {
    return request.nextUrl.pathname;
  }

  const requestUrl =
    typeof request.url === 'string' && request.url.length > 0
      ? request.url
      : 'http://localhost/';

  try {
    return new URL(requestUrl).pathname;
  } catch {
    return '/';
  }
}

export async function getAuthContext(request: NextRequest): Promise<AuthContext | null> {
  const session = await auth();
  const requestedOrgId = request.headers.get('x-org-id');
  const resolvedUser =
    !requestedOrgId || !session?.user?.id
      ? await resolveLocalUserByIdentity({
          cognitoSub: session?.user?.cognitoSub,
          email: session?.user?.email,
        })
      : null;
  const userId = session?.user?.id ?? resolvedUser?.id;
  if (!userId) return null;

  const orgId = requestedOrgId || resolvedUser?.org_id;
  if (!orgId) return null;

  const membership = await prisma.membership.findFirst({
    where: { user_id: userId, org_id: orgId, is_active: true },
    select: { role: true },
  });
  if (!membership) return null;

  return { userId, orgId, role: membership.role };
}

export async function getMembership(userId: string, orgId: string) {
  return prisma.membership.findFirst({
    where: { user_id: userId, org_id: orgId, is_active: true },
    select: { role: true },
  });
}

export function isAdmin(role: MemberRole): boolean {
  return role === 'owner' || role === 'admin';
}

export async function requireAuthContext(
  request: NextRequest,
  options?: RequireAuthContextOptions
): Promise<
  | { ctx: AuthContext; response?: never }
  | { ctx?: never; response: NextResponse }
> {
  clearRequestAuthContext();

  const session = await auth();
  const requestedOrgId = request.headers.get('x-org-id');
  const resolvedUser =
    !requestedOrgId || !session?.user?.id
      ? await resolveLocalUserByIdentity({
          cognitoSub: session?.user?.cognitoSub,
          email: session?.user?.email,
        })
      : null;

  const ipAddress = getClientIp(request);
  const userAgent = request.headers.get('user-agent') ?? undefined;
  const path = resolveRequestPath(request);
  const method = request.method || 'GET';

  const userId = session?.user?.id ?? resolvedUser?.id;
  if (!userId) {
    logSecurityEvent({
      event_type: 'auth_failure',
      ip_address: ipAddress,
      path,
      method,
      details: { reason: 'no_user_identity' },
    });
    return {
      response: await unauthorized(),
    };
  }

  const orgId = requestedOrgId || resolvedUser?.org_id;
  if (!orgId) {
    logSecurityEvent({
      event_type: 'auth_failure',
      ip_address: ipAddress,
      user_id: userId,
      path,
      method,
      details: { reason: 'no_org_id' },
    });
    return {
      response: await authNoOrg(),
    };
  }

  const membership = await getMembership(userId, orgId);
  if (!membership) {
    logSecurityEvent({
      event_type: 'unauthorized_access',
      ip_address: ipAddress,
      user_id: userId,
      org_id: orgId,
      path,
      method,
      details: { reason: 'no_membership' },
    });
    return {
      response: await forbiddenResponse('この組織へのアクセス権限がありません'),
    };
  }

  const ctx: AuthContext = {
    userId,
    orgId,
    role: membership.role,
    ipAddress,
    userAgent,
  };

  if (options?.permission) {
    if (!hasPermission(ctx.role, options.permission)) {
      logSecurityEvent({
        event_type: 'unauthorized_access',
        ip_address: ipAddress,
        user_id: userId,
        org_id: orgId,
        path,
        method,
        details: { reason: 'insufficient_permission', required: options.permission, role: ctx.role },
      });
      return {
        response: await forbiddenResponse(options.message ?? '権限がありません'),
      };
    }
  }

  return { ctx };
}

export function withAuthContext<TParams extends Record<string, string>>(
  handler: (
    req: NextRequest,
    ctx: AuthContext,
    routeContext: AuthRouteContext<TParams>
  ) => Promise<NextResponse>,
  options?: RequireAuthContextOptions
) {
  return async (req: NextRequest, routeContext: AuthRouteContext<TParams>) => {
    return withRoutePerformance(req, async () => {
      const authResult = await requireAuthContext(req, options);
      if ('response' in authResult) return authResult.response;

      return runWithRequestAuthContext(authResult.ctx, () =>
        handler(req, authResult.ctx, routeContext)
      );
    });
  };
}

export async function requireApiKeyOrAuthContext(
  request: NextRequest,
  options?: RequireApiKeyOrAuthContextOptions
): Promise<
  | { authType: 'apiKey'; response?: never; ctx?: never }
  | { authType: 'auth'; ctx: AuthContext; response?: never }
  | { authType?: never; ctx?: never; response: NextResponse }
> {
  clearRequestAuthContext();

  const apiKeyHeader = options?.apiKeyHeader ?? 'x-api-key';
  const requestApiKey = request.headers.get(apiKeyHeader);
  if (options?.apiKey && requestApiKey === options.apiKey) {
    return { authType: 'apiKey' };
  }

  const authResult = await requireAuthContext(request, options);
  if ('response' in authResult && authResult.response) {
    return { response: authResult.response };
  }

  return { authType: 'auth', ctx: authResult.ctx };
}
