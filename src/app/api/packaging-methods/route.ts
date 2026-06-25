import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { parseBoundedInteger } from '@/lib/api/pagination';
import { withAuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { success, validationError } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import { createPackagingMethodSchema } from '@/lib/validations/packaging-method';

const DEFAULT_PACKAGING_METHOD_LIMIT = 100;
const MAX_PACKAGING_METHOD_LIMIT = 200;

export const GET = withAuthContext(
  async (req, ctx) => {
    const { searchParams } = new URL(req.url);
    const limit = parseBoundedInteger(
      searchParams.get('limit'),
      DEFAULT_PACKAGING_METHOD_LIMIT,
      1,
      MAX_PACKAGING_METHOD_LIMIT,
    );

    const methods = await prisma.packagingMethodMaster.findMany({
      where: {
        org_id: ctx.orgId,
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
      take: limit,
    });

    return success({ data: methods });
  },
  {
    permission: 'canVisit',
    message: '配薬方法マスタの閲覧権限がありません',
  },
);

export const POST = withAuthContext(
  async (req, ctx) => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = createPackagingMethodSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const method = await withOrgContext(ctx.orgId, async (tx) => {
      const created = await tx.packagingMethodMaster.create({
        data: {
          org_id: ctx.orgId,
          name: parsed.data.name,
          description: parsed.data.description ?? null,
          icon_key: parsed.data.icon_key ?? null,
          sort_order: parsed.data.sort_order,
          is_active: parsed.data.is_active,
        },
      });

      await createAuditLogEntry(tx, ctx, {
        action: 'packaging_method_created',
        targetType: 'PackagingMethodMaster',
        targetId: created.id,
        changes: {
          name: parsed.data.name,
          sort_order: parsed.data.sort_order,
          is_active: parsed.data.is_active,
        },
      });

      return created;
    });

    return success({ data: method }, 201);
  },
  {
    permission: 'canAdmin',
    message: '配薬方法マスタの作成権限がありません',
  },
);
