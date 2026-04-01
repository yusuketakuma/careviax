import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import { createPackagingMethodSchema } from '@/lib/validations/packaging-method';

export const GET = withAuth(
  async (req: AuthenticatedRequest) => {
    const methods = await prisma.packagingMethodMaster.findMany({
      where: {
        org_id: req.orgId,
      },
      orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }],
      select: {
        id: true,
        name: true,
        description: true,
        icon_key: true,
        sort_order: true,
        is_active: true,
        created_at: true,
        updated_at: true,
      },
    });

    return success({ data: methods });
  },
  {
    permission: 'canVisit',
    message: '配薬方法マスタの閲覧権限がありません',
  }
);

export const POST = withAuth(
  async (req: AuthenticatedRequest) => {
    const body = await req.json().catch(() => null);
    if (!body) return validationError('リクエストボディが不正です');

    const parsed = createPackagingMethodSchema.safeParse(body);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const method = await withOrgContext(req.orgId, async (tx) => {
      const created = await tx.packagingMethodMaster.create({
        data: {
          org_id: req.orgId,
          name: parsed.data.name,
          description: parsed.data.description ?? null,
          icon_key: parsed.data.icon_key ?? null,
          sort_order: parsed.data.sort_order,
          is_active: parsed.data.is_active,
        },
      });

      await tx.auditLog.create({
        data: {
          org_id: req.orgId,
          actor_id: req.userId,
          action: 'packaging_method_created',
          target_type: 'PackagingMethodMaster',
          target_id: created.id,
          changes: {
            name: parsed.data.name,
            sort_order: parsed.data.sort_order,
            is_active: parsed.data.is_active,
          },
          ip_address: req.ipAddress,
          user_agent: req.userAgent,
        },
      });

      return created;
    });

    return success({ data: method }, 201);
  },
  {
    permission: 'canAdmin',
    message: '配薬方法マスタの作成権限がありません',
  }
);
