import { z } from 'zod';
import { NextRequest } from 'next/server';
import { withAuthContext, type AuthRouteContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError, notFound, forbidden } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import { hasPermission } from '@/lib/auth/permissions';

const revokeConsentSchema = z.object({
  reason: z.string().optional(),
});

export const POST = withAuthContext<{ id: string }>(
  async (req: NextRequest, ctx, routeContext: AuthRouteContext<{ id: string }>) => {
    if (!hasPermission(ctx.role, 'canVisit')) {
      return forbidden('同意撤回には訪問権限が必要です');
    }

    const { id } = await routeContext.params;

    const body = await req.json().catch(() => null);
    if (!body) return validationError('リクエストボディが不正です');

    const parsed = revokeConsentSchema.safeParse(body);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const existing = await prisma.consentRecord.findFirst({
      where: { id, org_id: ctx.orgId },
    });
    if (!existing) return notFound('同意記録が見つかりません');

    if (!existing.is_active) {
      return validationError('この同意記録はすでに無効化されています');
    }

    const now = new Date();

    const result = await withOrgContext(ctx.orgId, async (tx) => {
      // Revoke the consent record
      const revokedRecord = await tx.consentRecord.update({
        where: { id },
        data: {
          is_active: false,
          revoked_date: now,
          access_restricted: true,
        },
      });

      // Revoke all active ExternalAccessGrants for this patient
      await tx.externalAccessGrant.updateMany({
        where: {
          org_id: ctx.orgId,
          patient_id: existing.patient_id,
          revoked_at: null,
        },
        data: {
          revoked_at: now,
        },
      });

      // Create WorkflowException to flag case continuity review
      await tx.workflowException.create({
        data: {
          org_id: ctx.orgId,
          exception_type: 'consent_revoked',
          description: `患者の同意が撤回されました（種別: ${existing.consent_type}）。ケース継続判断が必要です。${parsed.data.reason ? `撤回理由: ${parsed.data.reason}` : ''}`,
          severity: 'warning',
          status: 'open',
        },
      });

      return revokedRecord;
    });

    return success(result);
  },
  { permission: 'canVisit' }
);
