import { withAuthContext } from '@/lib/auth/context';
import { validationError, notFound, forbiddenResponse, success } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import { withOrgContext } from '@/lib/db/rls';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { z } from 'zod';

const putSiteSchema = z.object({
  site_id: z.string().min(1),
});

export const PUT = withAuthContext(async (req, ctx) => {
  const payload = await readJsonObjectRequestBody(req);
  if (!payload) {
    return validationError('リクエストボディが不正です');
  }

  const parsed = putSiteSchema.safeParse(payload);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const { site_id } = parsed.data;

  // Verify the target site belongs to the current org
  const targetSite = await prisma.pharmacySite.findFirst({
    where: { id: site_id, org_id: ctx.orgId },
    select: { id: true, name: true },
  });
  if (!targetSite) {
    return notFound('指定された薬局が見つかりません');
  }

  // Verify the user has access to this site via membership (site_id match or universal null)
  const membership = await prisma.membership.findFirst({
    where: {
      user_id: ctx.userId,
      org_id: ctx.orgId,
      is_active: true,
      OR: [{ site_id }, { site_id: null }],
    },
  });
  if (!membership) {
    return forbiddenResponse('この薬局へのアクセス権限がありません');
  }

  // Read current default_site_id for audit
  const currentUser = await prisma.user.findUnique({
    where: { id: ctx.userId },
    select: { default_site_id: true },
  });

  const fromSiteId = currentUser?.default_site_id ?? null;

  await withOrgContext(ctx.orgId, async (tx) => {
    await tx.user.update({
      where: { id: ctx.userId },
      data: { default_site_id: site_id },
    });

    await createAuditLogEntry(tx, ctx, {
      action: 'user_site_switched',
      targetType: 'PharmacySite',
      targetId: site_id,
      changes: { from_site_id: fromSiteId, to_site_id: site_id },
    });
  });

  return success({ data: { site_id } });
});
