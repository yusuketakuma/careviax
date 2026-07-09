import { z } from 'zod';
import { unstable_rethrow } from 'next/navigation';
import { withAuthContext } from '@/lib/auth/context';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { conflict, internalError, notFound, success, validationError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { withOrgContext } from '@/lib/db/rls';
import { resolvePatientShareCaseTransition } from '@/server/services/pharmacy-partnerships';

const revokePatientShareConsentSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

function toSafeRevokedConsent(row: {
  id: string;
  share_case_id: string;
  revoked_at: Date | null;
  revoked_by: string | null;
  updated_at: Date;
}) {
  return {
    id: row.id,
    share_case_id: row.share_case_id,
    revoked_at: row.revoked_at,
    revoked_by: row.revoked_by,
    updated_at: row.updated_at,
  };
}

const authenticatedPOST = withAuthContext<{ id: string; consentId: string }>(
  async (req, ctx, { params }) => {
    const { id: rawId, consentId: rawConsentId } = await params;
    const id = normalizeRequiredRouteParam(rawId);
    const consentId = normalizeRequiredRouteParam(rawConsentId);
    if (!id) return withSensitiveNoStore(validationError('患者共有ケースIDが不正です'));
    if (!consentId) return withSensitiveNoStore(validationError('患者共有同意IDが不正です'));

    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return withSensitiveNoStore(validationError('リクエストボディが不正です'));

    const parsed = revokePatientShareConsentSchema.safeParse(payload);
    if (!parsed.success) {
      return withSensitiveNoStore(
        validationError('入力値が不正です', parsed.error.flatten().fieldErrors),
      );
    }

    const now = new Date();
    const result = await withOrgContext(ctx.orgId, async (tx) => {
      const existing = await tx.patientShareConsent.findFirst({
        where: { id: consentId, org_id: ctx.orgId, share_case_id: id },
        select: {
          id: true,
          share_case_id: true,
          revoked_at: true,
          revoked_by: true,
          updated_at: true,
          share_case: { select: { id: true, status: true } },
        },
      });

      if (!existing) return { response: notFound('患者共有同意が見つかりません') };
      if (existing.revoked_at) {
        return {
          consent: {
            id: existing.id,
            share_case_id: existing.share_case_id,
            revoked_at: existing.revoked_at,
            revoked_by: existing.revoked_by,
            updated_at: existing.updated_at,
          },
          shareCaseStatus: existing.share_case.status,
          alreadyRevoked: true,
        };
      }

      const updatedCount = await tx.patientShareConsent.updateMany({
        where: { id: consentId, org_id: ctx.orgId, share_case_id: id, revoked_at: null },
        data: { revoked_at: now, revoked_by: ctx.userId },
      });
      if (updatedCount.count !== 1) {
        return { response: conflict('患者共有同意はすでに更新されています') };
      }

      const revokedConsent = await tx.patientShareConsent.findUniqueOrThrow({
        where: { id_org_id: { id: consentId, org_id: ctx.orgId } },
        select: {
          id: true,
          share_case_id: true,
          revoked_at: true,
          revoked_by: true,
          updated_at: true,
        },
      });

      const shareCaseTransition = resolvePatientShareCaseTransition({
        currentStatus: existing.share_case.status,
        action: 'revoke_consent',
      });
      const shareCase = shareCaseTransition.allowed
        ? await tx.patientShareCase.update({
            where: { id_org_id: { id, org_id: ctx.orgId } },
            data: {
              status: shareCaseTransition.nextStatus,
              revoked_at: now,
              updated_by: ctx.userId,
            },
            select: { id: true, status: true },
          })
        : existing.share_case;

      await createAuditLogEntry(tx, ctx, {
        action: 'patient_share_consent_revoked',
        targetType: 'PatientShareConsent',
        targetId: revokedConsent.id,
        changes: {
          share_case_id: id,
          share_case_status: shareCase.status,
          reason_length: parsed.data.reason?.length ?? 0,
          revoked_at: now.toISOString(),
        },
      });

      return {
        consent: revokedConsent,
        shareCaseStatus: shareCase.status,
        alreadyRevoked: false,
      };
    });

    if ('response' in result) {
      return withSensitiveNoStore(result.response ?? validationError('入力値が不正です'));
    }
    return withSensitiveNoStore(
      success({
        data: {
          consent: toSafeRevokedConsent(result.consent),
          share_case_status: result.shareCaseStatus,
          already_revoked: result.alreadyRevoked,
        },
      }),
    );
  },
  {
    permission: 'canManagePatientSharing',
    message: '患者共有同意の撤回権限がありません',
  },
);

export const POST: typeof authenticatedPOST = async (req, routeContext) => {
  try {
    return withSensitiveNoStore(await authenticatedPOST(req, routeContext));
  } catch (err) {
    unstable_rethrow(err);
    return withSensitiveNoStore(internalError());
  }
};
