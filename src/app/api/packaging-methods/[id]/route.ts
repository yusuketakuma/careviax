import { NextRequest } from 'next/server';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { withAuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { success, validationError, notFound } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import { updatePackagingMethodSchema } from '@/lib/validations/packaging-method';

export const PATCH = withAuthContext<{ id: string }>(
  async (req: NextRequest, ctx, routeContext) => {
    const { id } = await routeContext.params;

    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = updatePackagingMethodSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const existing = await prisma.packagingMethodMaster.findFirst({
      where: { id, org_id: ctx.orgId },
      select: { id: true },
    });
    if (!existing) return notFound('配薬方法マスタが見つかりません');

    const updated = await withOrgContext(ctx.orgId, async (tx) => {
      const result = await tx.packagingMethodMaster.update({
        where: { id },
        data: {
          ...parsed.data,
        },
      });

      await createAuditLogEntry(tx, ctx, {
        action: 'packaging_method_updated',
        targetType: 'PackagingMethodMaster',
        targetId: id,
        changes: parsed.data,
      });

      return result;
    });

    return success({ data: updated });
  },
  {
    permission: 'canAdmin',
    message: '配薬方法マスタの更新権限がありません',
  },
);
