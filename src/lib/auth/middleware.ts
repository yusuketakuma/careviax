import { type MemberRole } from '@prisma/client';
import { type NextRequest, type NextResponse } from 'next/server';
import { requireAuthContext } from './context';
import { type PermissionKey } from './permissions';

export type AuthenticatedRequest = NextRequest & {
  userId: string;
  orgId: string;
  role: MemberRole;
  ipAddress?: string;
  userAgent?: string;
};

type WithAuthOptions = {
  permission?: PermissionKey;
  message?: string;
};

/**
 * Wraps a Route Handler with authentication and org context validation.
 * Reads org_id from the `x-org-id` request header for multi-tenant routing.
 */
export function withAuth(
  handler: (req: AuthenticatedRequest) => Promise<NextResponse>,
  options?: WithAuthOptions
) {
  return async (req: NextRequest) => {
    const authResult = await requireAuthContext(req, options);
    if ('response' in authResult) return authResult.response;

    const authReq = req as AuthenticatedRequest;
    authReq.userId = authResult.ctx.userId;
    authReq.orgId = authResult.ctx.orgId;
    authReq.role = authResult.ctx.role;
    authReq.ipAddress = authResult.ctx.ipAddress;
    authReq.userAgent = authResult.ctx.userAgent;

    return handler(authReq);
  };
}
