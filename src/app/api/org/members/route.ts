import { unstable_rethrow } from 'next/navigation';
import type { MemberRole } from '@prisma/client';
import { withAuthContext } from '@/lib/auth/context';
import { internalError, success, validationError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { STAFF_ASSIGNABLE_ROLES } from '@/lib/api/org-reference';
import { prisma } from '@/lib/db/client';

const authenticatedGET = withAuthContext(
  async (req, ctx) => {
    const { searchParams } = new URL(req.url);
    const eligible = searchParams.get('eligible');
    if (eligible !== 'staff') {
      return validationError('クエリパラメータが不正です', {
        eligible: ['eligible=staff を指定してください'],
      });
    }

    const memberships = await prisma.membership.findMany({
      where: {
        org_id: ctx.orgId,
        is_active: true,
        role: { in: [...STAFF_ASSIGNABLE_ROLES] },
        user: { is_active: true },
      },
      select: {
        role: true,
        user: {
          select: {
            id: true,
            name: true,
            name_kana: true,
          },
        },
      },
      orderBy: [{ user: { name_kana: 'asc' } }, { user_id: 'asc' }],
    });

    const uniqueMembersByUserId = new Map<string, { id: string; name: string; role: MemberRole }>();
    for (const membership of memberships) {
      if (!uniqueMembersByUserId.has(membership.user.id)) {
        uniqueMembersByUserId.set(membership.user.id, {
          id: membership.user.id,
          name: membership.user.name,
          role: membership.role,
        });
      }
    }

    return success({ data: [...uniqueMembersByUserId.values()] });
  },
  {
    permission: 'canVisit',
    message: '組織メンバーの閲覧権限がありません',
  },
);

export const GET: typeof authenticatedGET = async (req, routeContext) => {
  try {
    return withSensitiveNoStore(await authenticatedGET(req, routeContext));
  } catch (err) {
    unstable_rethrow(err);
    return withSensitiveNoStore(internalError());
  }
};
