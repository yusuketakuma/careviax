import { withAuthContext } from '@/lib/auth/context';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { conflict, notFound, success, validationError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { readJsonObject } from '@/lib/db/json';
import { withOrgContext } from '@/lib/db/rls';
import { localDateKey, utcDateFromLocalKey } from '@/lib/utils/date-boundary';
import {
  evaluatePatientShareCaseActivation,
  resolvePatientShareCaseTransition,
} from '@/server/services/pharmacy-partnerships';

function isDateAfter(left: Date, right: Date) {
  return left.getTime() > right.getTime();
}

function isDateBefore(left: Date, right: Date) {
  return left.getTime() < right.getTime();
}

function hasAcceptedIdentityProof(snapshot: unknown) {
  const object = readJsonObject(snapshot);
  const proof = readJsonObject(object?.identity_proof);
  return (
    typeof proof?.checked_at === 'string' &&
    typeof proof.checked_by === 'string' &&
    typeof proof.matched === 'boolean' &&
    Array.isArray(proof.required_fields) &&
    proof.required_fields.includes('name') &&
    proof.required_fields.includes('birth_date')
  );
}

export const POST = withAuthContext<{ id: string }>(
  async (_req, ctx, { params }) => {
    const { id: rawId } = await params;
    const id = normalizeRequiredRouteParam(rawId);
    if (!id) return withSensitiveNoStore(validationError('患者共有ケースIDが不正です'));

    const now = new Date();
    const today = utcDateFromLocalKey(localDateKey(now));
    const result = await withOrgContext(ctx.orgId, async (tx) => {
      const shareCase = await tx.patientShareCase.findFirst({
        where: { id, org_id: ctx.orgId },
        select: {
          id: true,
          status: true,
          starts_at: true,
          ends_at: true,
          base_pharmacy_approved_by: true,
          partner_pharmacy_approved_by: true,
          partnership: {
            select: {
              id: true,
              status: true,
              effective_from: true,
              effective_to: true,
              partner_pharmacy: { select: { id: true, name: true, status: true } },
            },
          },
          consents: {
            select: {
              consent_date: true,
              valid_until: true,
              revoked_at: true,
            },
            orderBy: { created_at: 'desc' },
          },
          patient_link: {
            select: {
              id: true,
              match_status: true,
              approved_by_base: true,
              approved_by_partner: true,
              accepted_at: true,
              declined_at: true,
              partner_patient_id: true,
              partner_patient_snapshot: true,
            },
          },
        },
      });

      if (!shareCase) return { response: notFound('患者共有ケースが見つかりません') };
      if (
        shareCase.partnership.status !== 'active' ||
        shareCase.partnership.partner_pharmacy.status !== 'active'
      ) {
        return { response: conflict('有効な薬局間連携ではありません') };
      }
      if (shareCase.starts_at && isDateAfter(shareCase.starts_at, today)) {
        return { response: conflict('共有開始日前の患者共有ケースは有効化できません') };
      }
      if (shareCase.ends_at && isDateBefore(shareCase.ends_at, today)) {
        return { response: conflict('共有終了日を過ぎた患者共有ケースは有効化できません') };
      }
      if (
        shareCase.partnership.effective_from &&
        isDateAfter(shareCase.partnership.effective_from, today)
      ) {
        return { response: conflict('薬局間連携の開始日前です') };
      }
      if (
        shareCase.partnership.effective_to &&
        isDateBefore(shareCase.partnership.effective_to, today)
      ) {
        return { response: conflict('薬局間連携の終了日を過ぎています') };
      }
      if (
        !shareCase.patient_link ||
        shareCase.base_pharmacy_approved_by !== shareCase.patient_link.approved_by_base ||
        shareCase.partner_pharmacy_approved_by !== shareCase.patient_link.approved_by_partner
      ) {
        return {
          response: conflict('患者リンク承認情報が一致していません', {
            blocker: 'approval_mismatch',
          }),
        };
      }
      const patientLink = shareCase.patient_link;
      if (!hasAcceptedIdentityProof(patientLink.partner_patient_snapshot)) {
        return {
          response: conflict('協力薬局側の患者確認情報が不足しています', {
            blocker: 'patient_link_identity_proof_missing',
          }),
        };
      }

      const activation = evaluatePatientShareCaseActivation({
        status: shareCase.status,
        consents: shareCase.consents,
        patientLink: shareCase.patient_link,
        now,
      });

      if (!activation.allowed) {
        return {
          response: conflict('患者共有ケースを共有中にできません', {
            blocker: activation.blocker,
          }),
        };
      }

      const activationTransition = resolvePatientShareCaseTransition({
        currentStatus: shareCase.status,
        action: 'activate',
        hasActiveConsent: Boolean(activation.consent),
        patientLinkAccepted:
          patientLink.match_status === 'accepted' && Boolean(patientLink.accepted_at),
        hasBaseApproval: Boolean(patientLink.approved_by_base),
        hasPartnerApproval: Boolean(patientLink.approved_by_partner),
      });
      if (!activationTransition.allowed) {
        return {
          response: conflict('患者共有ケースを共有中にできません', {
            blocker: 'invalid_status',
          }),
        };
      }

      const activated = await tx.patientShareCase.update({
        where: { id_org_id: { id, org_id: ctx.orgId } },
        data: {
          status: activationTransition.nextStatus,
          consent_verified_at: now,
          activated_at: now,
          updated_by: ctx.userId,
        },
        select: {
          id: true,
          status: true,
          consent_verified_at: true,
          activated_at: true,
          updated_at: true,
        },
      });

      await createAuditLogEntry(tx, ctx, {
        action: 'patient_share_case_activated',
        targetType: 'PatientShareCase',
        targetId: activated.id,
        changes: {
          status: activated.status,
          consent_verified_at: now.toISOString(),
        },
      });

      return {
        shareCase: {
          ...activated,
          patient_link: {
            id: patientLink.id,
            match_status: patientLink.match_status,
            approved_by_base: patientLink.approved_by_base,
            approved_by_partner: patientLink.approved_by_partner,
            accepted_at: patientLink.accepted_at,
            declined_at: patientLink.declined_at,
            has_partner_patient_id: Boolean(patientLink.partner_patient_id),
          },
          partnership: {
            id: shareCase.partnership.id,
            status: shareCase.partnership.status,
            partner_pharmacy: shareCase.partnership.partner_pharmacy,
          },
        },
      };
    });

    if ('response' in result)
      return withSensitiveNoStore(result.response ?? validationError('患者共有ケースIDが不正です'));
    return withSensitiveNoStore(success(result.shareCase));
  },
  {
    permission: 'canManagePatientSharing',
    message: '患者共有ケースの有効化権限がありません',
  },
);
