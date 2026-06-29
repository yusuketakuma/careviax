import { z } from 'zod';
import { unstable_rethrow } from 'next/navigation';
import { withAuthContext } from '@/lib/auth/context';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { conflict, internalError, notFound, success, validationError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { readJsonObject, toPrismaJsonInput } from '@/lib/db/json';
import { withOrgContext } from '@/lib/db/rls';
import { dateKeySchema } from '@/lib/validations/date-key';
import {
  findActivePatientShareConsent,
  resolvePatientShareCaseTransition,
} from '@/server/services/pharmacy-partnerships';

const linkDecisionSchema = z.enum(['base_approve', 'accept', 'decline']);
const partnerPatientSnapshotSchema = z
  .object({
    name: z.string().trim().min(1, '協力薬局側患者氏名は必須です').max(120),
    name_kana: z.string().trim().max(120).optional(),
    birth_date: dateKeySchema('協力薬局側患者生年月日が不正です（YYYY-MM-DD）'),
    address: z.string().trim().max(500).optional(),
  })
  .passthrough();

const updatePatientLinkSchema = z
  .object({
    decision: linkDecisionSchema,
    partner_patient_id: z.string().trim().min(1).max(128).optional(),
    partner_patient_snapshot: partnerPatientSnapshotSchema.optional(),
    identity_mismatch_override_reason: z.string().trim().min(1).max(500).optional(),
    decline_reason: z.string().trim().min(1).max(500).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.decision === 'accept' && !value.partner_patient_id) {
      ctx.addIssue({
        code: 'custom',
        path: ['partner_patient_id'],
        message: '協力薬局側の患者IDは必須です',
      });
    }
    if (value.decision === 'accept' && !value.partner_patient_snapshot) {
      ctx.addIssue({
        code: 'custom',
        path: ['partner_patient_snapshot'],
        message: '協力薬局側の患者確認情報は必須です',
      });
    }
    if (value.decision === 'decline' && !value.decline_reason) {
      ctx.addIssue({
        code: 'custom',
        path: ['decline_reason'],
        message: '辞退理由は必須です',
      });
    }
  });

type LinkDecision = z.infer<typeof linkDecisionSchema>;

function auditActionForDecision(decision: LinkDecision) {
  switch (decision) {
    case 'base_approve':
      return 'patient_link_base_approved';
    case 'accept':
      return 'patient_link_accepted';
    case 'decline':
      return 'patient_link_declined';
  }
}

function normalizeIdentityText(value: unknown) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : null;
}

function readBaseIdentity(snapshot: unknown) {
  const object = readJsonObject(snapshot);
  if (!object) return null;
  const name = normalizeIdentityText(object.name);
  const birthDate = normalizeIdentityText(object.birth_date);
  const nameKana = normalizeIdentityText(object.name_kana);
  if (!name || !birthDate) return null;
  return { name, birthDate, nameKana };
}

function buildPartnerSnapshotWithIdentityProof(args: {
  basePatientSnapshot: unknown;
  partnerPatientSnapshot: z.infer<typeof partnerPatientSnapshotSchema>;
  checkedAt: Date;
  checkedBy: string;
  overrideReason?: string;
}) {
  const baseIdentity = readBaseIdentity(args.basePatientSnapshot);
  if (!baseIdentity) return { ok: false as const, blocker: 'base_identity_snapshot_missing' };

  const mismatchFields: string[] = [];
  if (normalizeIdentityText(args.partnerPatientSnapshot.name) !== baseIdentity.name) {
    mismatchFields.push('name');
  }
  if (normalizeIdentityText(args.partnerPatientSnapshot.birth_date) !== baseIdentity.birthDate) {
    mismatchFields.push('birth_date');
  }
  if (
    baseIdentity.nameKana &&
    args.partnerPatientSnapshot.name_kana &&
    normalizeIdentityText(args.partnerPatientSnapshot.name_kana) !== baseIdentity.nameKana
  ) {
    mismatchFields.push('name_kana');
  }

  if (mismatchFields.length > 0 && !args.overrideReason) {
    return { ok: false as const, blocker: 'identity_mismatch', mismatchFields };
  }

  return {
    ok: true as const,
    snapshot: {
      ...args.partnerPatientSnapshot,
      identity_proof: {
        checked_at: args.checkedAt.toISOString(),
        checked_by: args.checkedBy,
        required_fields: ['name', 'birth_date'],
        matched: mismatchFields.length === 0,
        mismatch_fields: mismatchFields,
        override_reason: args.overrideReason ?? null,
      },
    },
    mismatchFields,
  };
}

const authenticatedPATCH = withAuthContext<{ id: string }>(
  async (req, ctx, { params }) => {
    const { id: rawId } = await params;
    const id = normalizeRequiredRouteParam(rawId);
    if (!id) return validationError('患者共有ケースIDが不正です');

    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = updatePatientLinkSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const now = new Date();
    const result = await withOrgContext(ctx.orgId, async (tx) => {
      const shareCase = await tx.patientShareCase.findFirst({
        where: { id, org_id: ctx.orgId },
        select: {
          id: true,
          status: true,
          base_pharmacy_approved_by: true,
          partner_pharmacy_approved_by: true,
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
              base_patient_snapshot: true,
            },
          },
        },
      });

      if (!shareCase) return { response: notFound('患者共有ケースが見つかりません') };
      if (!shareCase.patient_link) {
        return { response: conflict('患者リンクが作成されていません') };
      }
      if (parsed.data.decision === 'decline' && shareCase.status === 'active') {
        return { response: conflict('共有中の患者リンクは辞退できません') };
      }
      const transitionAction =
        parsed.data.decision === 'decline'
          ? 'decline_patient_link'
          : parsed.data.decision === 'accept'
            ? 'accept_patient_link'
            : 'approve_patient_link';
      const hasActiveConsent = Boolean(findActivePatientShareConsent(shareCase.consents, now));
      const shareCaseTransition = resolvePatientShareCaseTransition({
        currentStatus: shareCase.status,
        action: transitionAction,
        hasActiveConsent,
      });
      if (!shareCaseTransition.allowed) {
        return {
          response: conflict('終了・撤回・辞退済みの患者共有ケースは更新できません'),
        };
      }

      const link = shareCase.patient_link;
      if (link.match_status !== 'pending') {
        return { response: conflict('患者リンクはすでに最終状態です') };
      }
      if (parsed.data.decision === 'base_approve') {
        if (link.approved_by_base || shareCase.base_pharmacy_approved_by) {
          return { response: conflict('患者リンクはすでに基幹薬局承認済みです') };
        }
      }
      if (parsed.data.decision === 'accept') {
        if (
          !link.approved_by_base ||
          shareCase.base_pharmacy_approved_by !== link.approved_by_base
        ) {
          return {
            response: conflict('基幹薬局の承認後に患者リンクを受諾してください', {
              blocker: 'base_approval_missing',
            }),
          };
        }
        if (shareCase.partner_pharmacy_approved_by) {
          return { response: conflict('患者リンクはすでに協力薬局承認済みです') };
        }
      }

      const partnerSnapshotProof =
        parsed.data.decision === 'accept'
          ? buildPartnerSnapshotWithIdentityProof({
              basePatientSnapshot: link.base_patient_snapshot,
              partnerPatientSnapshot: parsed.data.partner_patient_snapshot!,
              checkedAt: now,
              checkedBy: ctx.userId,
              overrideReason: parsed.data.identity_mismatch_override_reason,
            })
          : null;
      if (partnerSnapshotProof && !partnerSnapshotProof.ok) {
        return {
          response: conflict('協力薬局側の患者確認情報が一致していません', {
            blocker: partnerSnapshotProof.blocker,
            mismatch_fields:
              'mismatchFields' in partnerSnapshotProof
                ? partnerSnapshotProof.mismatchFields
                : undefined,
          }),
        };
      }

      const patientLinkUpdate =
        parsed.data.decision === 'base_approve'
          ? {
              approved_by_base: link.approved_by_base ?? ctx.userId,
            }
          : parsed.data.decision === 'accept'
            ? {
                match_status: 'accepted' as const,
                approved_by_partner: link.approved_by_partner ?? ctx.userId,
                accepted_at: now,
                declined_at: null,
                decline_reason: null,
                partner_patient_id: parsed.data.partner_patient_id,
                partner_patient_snapshot: toPrismaJsonInput(partnerSnapshotProof!.snapshot),
              }
            : {
                match_status: 'declined' as const,
                declined_at: now,
                decline_reason: parsed.data.decline_reason,
                partner_patient_id: parsed.data.partner_patient_id,
                partner_patient_snapshot:
                  parsed.data.partner_patient_snapshot === undefined
                    ? undefined
                    : toPrismaJsonInput(parsed.data.partner_patient_snapshot),
              };

      const updatedLinkCount = await tx.patientLink.updateMany({
        where: {
          share_case_id: id,
          org_id: ctx.orgId,
          match_status: 'pending',
        },
        data: patientLinkUpdate,
      });
      if (updatedLinkCount.count !== 1) {
        return { response: conflict('患者リンクはすでに更新されています') };
      }

      const patientLink = await tx.patientLink.findUniqueOrThrow({
        where: { share_case_id_org_id: { share_case_id: id, org_id: ctx.orgId } },
      });

      const nextStatus = shareCaseTransition.nextStatus;
      const nextShareCase = await tx.patientShareCase.update({
        where: { id_org_id: { id, org_id: ctx.orgId } },
        data: {
          status: nextStatus,
          ...(parsed.data.decision === 'decline'
            ? {
                ended_at: now,
              }
            : {}),
          ...(parsed.data.decision === 'base_approve'
            ? {
                base_pharmacy_approved_by: link.approved_by_base ?? ctx.userId,
                base_pharmacy_approved_at: now,
              }
            : {}),
          ...(parsed.data.decision === 'accept'
            ? {
                partner_pharmacy_approved_by: link.approved_by_partner ?? ctx.userId,
                partner_pharmacy_approved_at: now,
              }
            : {}),
          updated_by: ctx.userId,
        },
        select: { id: true, status: true, updated_at: true },
      });

      await createAuditLogEntry(tx, ctx, {
        action: auditActionForDecision(parsed.data.decision),
        targetType: 'PatientLink',
        targetId: patientLink.id,
        changes: {
          share_case_id: id,
          decision: parsed.data.decision,
          match_status: patientLink.match_status,
          share_case_status: nextShareCase.status,
          has_partner_patient_snapshot: parsed.data.partner_patient_snapshot !== undefined,
          identity_mismatch_fields:
            partnerSnapshotProof && partnerSnapshotProof.ok
              ? partnerSnapshotProof.mismatchFields
              : [],
          identity_override_reason_length:
            parsed.data.identity_mismatch_override_reason?.length ?? 0,
          decline_reason_length: parsed.data.decline_reason?.length ?? 0,
        },
      });

      return { patientLink, shareCase: nextShareCase };
    });

    if ('response' in result) return result.response ?? validationError('入力値が不正です');
    return success(result);
  },
  {
    permission: 'canManagePatientSharing',
    message: '患者リンクの更新権限がありません',
  },
);

export const PATCH: typeof authenticatedPATCH = async (req, routeContext) => {
  try {
    return withSensitiveNoStore(await authenticatedPATCH(req, routeContext));
  } catch (err) {
    unstable_rethrow(err);
    return withSensitiveNoStore(internalError());
  }
};
