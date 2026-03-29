import { auth } from '@/lib/auth/config';
import { prisma } from '@/lib/db/client';
import { withOrgContext } from '@/lib/db/rls';
import { externalError, success, unauthorized } from '@/lib/api/response';
import { globalSignOutWithAccessToken } from '@/server/services/cognito-auth';

export async function POST() {
  const session = await auth();
  const userId = session?.user?.id?.trim();
  if (!session?.accessToken || !userId) {
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
      await tx.auditLog.create({
        data: {
          org_id: updatedUser.org_id,
          actor_id: updatedUser.id,
          action: 'logout_all',
          target_type: 'session',
          target_id: updatedUser.id,
          changes: {
            scope: 'all_devices',
          },
        },
      });
    });

    try {
      await globalSignOutWithAccessToken(session.accessToken);
    } catch (error) {
      if ((error as Error).message !== 'COGNITO_NOT_CONFIGURED') {
        throw error;
      }
    }
  } catch {
    return externalError(
      'EXTERNAL_GLOBAL_SIGNOUT_FAILED',
      '全端末ログアウトに失敗しました',
      502
    );
  }

  return success({ ok: true });
}
