import { auth, getAuthAccessToken } from '@/lib/auth/config';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { prisma } from '@/lib/db/client';
import { withOrgContext } from '@/lib/db/rls';
import { externalError, success, unauthorized } from '@/lib/api/response';
import { getClientIp } from '@/lib/api/request-ip';
import { globalSignOutWithAccessToken } from '@/server/services/cognito-auth';
import type { NextRequest } from 'next/server';

export async function POST(request: NextRequest) {
  const session = await auth();
  const accessToken = await getAuthAccessToken(request);
  const userId = session?.user?.id?.trim();
  if (!session || !accessToken || !userId) {
    return unauthorized();
  }

  try {
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      select: {
        id: true,
        org_id: true,
      },
      data: {
        session_version: {
          increment: 1,
        },
      },
    });
    await withOrgContext(updatedUser.org_id, async (tx) => {
      await createAuditLogEntry(
        tx,
        {
          orgId: updatedUser.org_id,
          userId: updatedUser.id,
          ipAddress: getClientIp(request),
          userAgent: request.headers.get('user-agent') ?? undefined,
        },
        {
          action: 'logout_all',
          targetType: 'session',
          targetId: updatedUser.id,
          changes: {
            scope: 'all_devices',
          },
        },
      );
    });

    try {
      await globalSignOutWithAccessToken(accessToken);
    } catch (error) {
      if ((error as Error).message !== 'COGNITO_NOT_CONFIGURED') {
        throw error;
      }
    }
  } catch {
    return externalError('EXTERNAL_GLOBAL_SIGNOUT_FAILED', '全端末ログアウトに失敗しました', 502);
  }

  return success({ ok: true });
}
