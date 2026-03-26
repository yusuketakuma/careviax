import { z } from 'zod';
import { NextRequest } from 'next/server';
import { withAuthContext, type AuthRouteContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError, notFound, forbidden } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import { hasPermission } from '@/lib/auth/permissions';

const updateConsentSchema = z.object({
  expiry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  document_url: z.string().url().optional().nullable(),
});

export const GET = withAuthContext<{ id: string }>(
  async (req: NextRequest, ctx, routeContext: AuthRouteContext<{ id: string }>) => {
    if (!hasPermission(ctx.role, 'canVisit')) {
      return forbidden('同意記録の閲覧には訪問権限が必要です');
    }

    const { id } = await routeContext.params;

    const record = await prisma.consentRecord.findFirst({
      where: { id, org_id: ctx.orgId },
    });
    if (!record) return notFound('同意記録が見つかりません');

    return success(record);
  },
  { permission: 'canVisit' }
);

export const PATCH = withAuthContext<{ id: string }>(
  async (req: NextRequest, ctx, routeContext: AuthRouteContext<{ id: string }>) => {
    if (!hasPermission(ctx.role, 'canVisit')) {
      return forbidden('同意記録の更新には訪問権限が必要です');
    }

    const { id } = await routeContext.params;

    const body = await req.json().catch(() => null);
    if (!body) return validationError('リクエストボディが不正です');

    const parsed = updateConsentSchema.safeParse(body);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const existing = await prisma.consentRecord.findFirst({
      where: { id, org_id: ctx.orgId },
    });
    if (!existing) return notFound('同意記録が見つかりません');

    const { expiry_date, document_url } = parsed.data;

    const updated = await withOrgContext(ctx.orgId, async (tx) => {
      return tx.consentRecord.update({
        where: { id },
        data: {
          ...(expiry_date !== undefined
            ? { expiry_date: expiry_date ? new Date(expiry_date) : null }
            : {}),
          ...(document_url !== undefined ? { document_url } : {}),
        },
      });
    });

    return success(updated);
  },
  { permission: 'canVisit' }
);
