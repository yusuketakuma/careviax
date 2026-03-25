import { auth } from './config';
import { NextRequest, NextResponse } from 'next/server';

export type AuthenticatedRequest = NextRequest & {
  userId: string;
  orgId: string;
};

/**
 * Wraps a Route Handler with authentication and org context validation.
 * Reads org_id from the `x-org-id` request header for multi-tenant routing.
 */
export function withAuth(
  handler: (req: AuthenticatedRequest) => Promise<NextResponse>
) {
  return async (req: NextRequest) => {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { code: 'AUTH_UNAUTHENTICATED', message: '認証が必要です' },
        { status: 401 }
      );
    }
    const orgId = req.headers.get('x-org-id');
    if (!orgId) {
      return NextResponse.json(
        { code: 'AUTH_NO_ORG', message: '組織IDが必要です' },
        { status: 400 }
      );
    }
    const authReq = req as AuthenticatedRequest;
    authReq.userId = session.user.id;
    authReq.orgId = orgId;
    return handler(authReq);
  };
}
