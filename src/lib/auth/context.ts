import { auth } from './config';
import { prisma } from '@/lib/db/client';
import { NextRequest, NextResponse } from 'next/server';
import { MemberRole } from '@prisma/client';
import { hasPermission, type PermissionKey } from './permissions';

export type AuthContext = {
  userId: string;
  orgId: string;
  role: MemberRole;
  ipAddress?: string;
  userAgent?: string;
};

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

export async function getAuthContext(request: NextRequest): Promise<AuthContext | null> {
  const session = await auth();
  if (!session?.user?.id) return null;

  const orgId = request.headers.get('x-org-id');
  if (!orgId) return null;

  const membership = await prisma.membership.findFirst({
    where: { user_id: session.user.id, org_id: orgId, is_active: true },
    select: { role: true },
  });
  if (!membership) return null;

  return { userId: session.user.id, orgId, role: membership.role };
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
  const session = await auth();
  if (!session?.user?.id) {
    return {
      response: NextResponse.json(
        { code: 'AUTH_UNAUTHENTICATED', message: '認証が必要です' },
        { status: 401 }
      ),
    };
  }

  const orgId = request.headers.get('x-org-id');
  if (!orgId) {
    return {
      response: NextResponse.json(
        { code: 'AUTH_NO_ORG', message: '組織IDが必要です' },
        { status: 400 }
      ),
    };
  }

  const membership = await getMembership(session.user.id, orgId);
  if (!membership) {
    return {
      response: NextResponse.json(
        {
          code: 'AUTH_FORBIDDEN',
          message: 'この組織へのアクセス権限がありません',
        },
        { status: 403 }
      ),
    };
  }

  const ipAddress =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    undefined;
  const userAgent = request.headers.get('user-agent') ?? undefined;

  const ctx: AuthContext = {
    userId: session.user.id,
    orgId,
    role: membership.role,
    ipAddress,
    userAgent,
  };

  if (options?.permission) {
    if (!hasPermission(ctx.role, options.permission)) {
      return {
        response: NextResponse.json(
          {
            code: 'AUTH_FORBIDDEN',
            message: options.message ?? '権限がありません',
          },
          { status: 403 }
        ),
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
    const authResult = await requireAuthContext(req, options);
    if ('response' in authResult) return authResult.response;

    return handler(req, authResult.ctx, routeContext);
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
