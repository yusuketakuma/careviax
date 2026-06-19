import { z } from 'zod';
import { withAuthContext } from '@/lib/auth/context';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { conflict, notFound, success, validationError } from '@/lib/api/response';
import { withOrgContext } from '@/lib/db/rls';

const optionalTrimmedString = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value.length > 0 ? value : undefined))
    .optional();

const activatePharmacyPartnershipSchema = z
  .object({
    base_approved_by: optionalTrimmedString(128),
    partner_approved_by: optionalTrimmedString(128),
  })
  .superRefine((value, ctx) => {
    if (!value.base_approved_by) {
      ctx.addIssue({
        code: 'custom',
        path: ['base_approved_by'],
        message: '有効化には基幹薬局側の承認記録が必要です',
      });
    }
    if (!value.partner_approved_by) {
      ctx.addIssue({
        code: 'custom',
        path: ['partner_approved_by'],
        message: '有効化には協力薬局側の承認記録が必要です',
      });
    }
  });

function utcDateOnlyTime(date: Date) {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function isDateAfter(left: Date, right: Date) {
  return utcDateOnlyTime(left) > utcDateOnlyTime(right);
}

function isDateBefore(left: Date, right: Date) {
  return utcDateOnlyTime(left) < utcDateOnlyTime(right);
}

export const POST = withAuthContext<{ id: string }>(
  async (req, ctx, { params }) => {
    const { id: rawId } = await params;
    const id = normalizeRequiredRouteParam(rawId);
    if (!id) return validationError('薬局間連携IDが不正です');

    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = activatePharmacyPartnershipSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const now = new Date();
    const result = await withOrgContext(ctx.orgId, async (tx) => {
      const partnership = await tx.pharmacyPartnership.findFirst({
        where: { id, org_id: ctx.orgId },
        select: {
          id: true,
          status: true,
          effective_from: true,
          effective_to: true,
          base_site_id: true,
          partner_pharmacy_id: true,
          approved_by_base: true,
          approved_by_partner: true,
          partner_pharmacy: { select: { id: true, name: true, status: true } },
        },
      });

      if (!partnership) return { response: notFound('薬局間連携が見つかりません') };
      if (partnership.partner_pharmacy.status !== 'active') {
        return { response: conflict('有効な協力薬局との連携のみ有効化できます') };
      }
      if (partnership.status === 'ended') {
        return { response: conflict('終了済みの薬局間連携は有効化できません') };
      }
      if (partnership.effective_from && isDateAfter(partnership.effective_from, now)) {
        return { response: conflict('薬局間連携の開始日前です') };
      }
      if (partnership.effective_to && isDateBefore(partnership.effective_to, now)) {
        return { response: conflict('薬局間連携の終了日を過ぎています') };
      }
      if (partnership.status === 'active') {
        return { partnership };
      }

      const updatedCount = await tx.pharmacyPartnership.updateMany({
        where: {
          id,
          org_id: ctx.orgId,
          status: { in: ['draft', 'suspended'] },
          partner_pharmacy: { status: 'active' },
        },
        data: {
          status: 'active',
          approved_by_base: parsed.data.base_approved_by,
          approved_by_partner: parsed.data.partner_approved_by,
          approved_at: now,
          updated_by: ctx.userId,
        },
      });
      if (updatedCount.count !== 1) {
        return { response: conflict('薬局間連携はすでに更新されています') };
      }

      const activated = await tx.pharmacyPartnership.findUniqueOrThrow({
        where: { id_org_id: { id, org_id: ctx.orgId } },
        include: {
          base_site: { select: { id: true, name: true } },
          partner_pharmacy: { select: { id: true, name: true, status: true } },
        },
      });

      await createAuditLogEntry(tx, ctx, {
        action: 'pharmacy_partnership_activated',
        targetType: 'PharmacyPartnership',
        targetId: activated.id,
        changes: {
          previous_status: partnership.status,
          status: activated.status,
          base_site_id: partnership.base_site_id,
          partner_pharmacy_id: partnership.partner_pharmacy_id,
          base_approved: Boolean(parsed.data.base_approved_by),
          partner_approved: Boolean(parsed.data.partner_approved_by),
          approved_at: now.toISOString(),
        },
      });

      return { partnership: activated };
    });

    if ('response' in result) return result.response ?? validationError('入力値が不正です');
    return success(result.partnership);
  },
  {
    permission: 'canManagePatientSharing',
    message: '薬局間連携の有効化権限がありません',
  },
);
