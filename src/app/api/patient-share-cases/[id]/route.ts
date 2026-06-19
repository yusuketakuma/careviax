import { z } from 'zod';
import { withAuthContext } from '@/lib/auth/context';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { conflict, notFound, success, validationError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { toPrismaJsonInput } from '@/lib/db/json';
import { withOrgContext } from '@/lib/db/rls';
import {
  PATIENT_SHARE_SCOPE_KEYS,
  enabledPatientShareScopeKeys,
  normalizePatientShareScope,
  patientShareScopeCovers,
} from '@/server/services/patient-share-scope';
import { allowedPatientShareDataOutputActions } from '@/server/services/patient-share-policy';

const updatePatientShareCaseSchema = z
  .object({
    share_scope: z
      .record(z.string(), z.unknown())
      .transform((value) => normalizePatientShareScope(value)),
  })
  .strict();

function utcDateOnlyTime(date: Date) {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function isDateOnOrBefore(left: Date, right: Date) {
  return utcDateOnlyTime(left) <= utcDateOnlyTime(right);
}

function isDateOnOrAfter(left: Date, right: Date) {
  return utcDateOnlyTime(left) >= utcDateOnlyTime(right);
}

function activeConsentCoversShareScope(args: {
  consents: Array<{
    consent_date: Date;
    valid_until: Date | null;
    revoked_at: Date | null;
    scope: unknown;
  }>;
  shareScope: unknown;
  now: Date;
}) {
  return args.consents.some((consent) => {
    if (consent.revoked_at) return false;
    if (!isDateOnOrBefore(consent.consent_date, args.now)) return false;
    if (consent.valid_until && !isDateOnOrAfter(consent.valid_until, args.now)) return false;
    return patientShareScopeCovers({ consentScope: consent.scope, shareScope: args.shareScope });
  });
}

export const PATCH = withAuthContext<{ id: string }>(
  async (req, ctx, { params }) => {
    const { id: rawId } = await params;
    const id = normalizeRequiredRouteParam(rawId);
    if (!id) return withSensitiveNoStore(validationError('患者共有ケースIDが不正です'));

    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return withSensitiveNoStore(validationError('リクエストボディが不正です'));

    const parsed = updatePatientShareCaseSchema.safeParse(payload);
    if (!parsed.success) {
      return withSensitiveNoStore(
        validationError('入力値が不正です', parsed.error.flatten().fieldErrors),
      );
    }

    const now = new Date();
    const result = await withOrgContext(ctx.orgId, async (tx) => {
      const shareCase = await tx.patientShareCase.findFirst({
        where: { id, org_id: ctx.orgId },
        select: {
          id: true,
          base_patient_id: true,
          status: true,
          share_scope: true,
          consents: {
            select: {
              consent_date: true,
              valid_until: true,
              revoked_at: true,
              scope: true,
            },
            orderBy: { created_at: 'desc' },
          },
        },
      });

      if (!shareCase) return { response: notFound('患者共有ケースが見つかりません') };
      if (
        shareCase.status === 'ended' ||
        shareCase.status === 'revoked' ||
        shareCase.status === 'declined'
      ) {
        return { response: conflict('終了・撤回・辞退済みの患者共有ケースは更新できません') };
      }
      if (
        shareCase.status === 'active' &&
        !activeConsentCoversShareScope({
          consents: shareCase.consents,
          shareScope: parsed.data.share_scope,
          now,
        })
      ) {
        return {
          response: conflict('共有範囲をカバーする有効な同意がありません', {
            blocker: 'active_consent_scope_missing',
          }),
        };
      }

      const previousScopeKeys = enabledPatientShareScopeKeys(shareCase.share_scope).sort();
      const nextScopeKeys = enabledPatientShareScopeKeys(parsed.data.share_scope).sort();
      const previousOutputActions = allowedPatientShareDataOutputActions({
        shareCaseStatus: shareCase.status,
        shareScope: shareCase.share_scope,
      });
      const updated = await tx.patientShareCase.update({
        where: { id_org_id: { id, org_id: ctx.orgId } },
        data: {
          share_scope: toPrismaJsonInput(parsed.data.share_scope),
          updated_by: ctx.userId,
        },
        select: {
          id: true,
          status: true,
          updated_at: true,
          share_scope: true,
        },
      });

      await createAuditLogEntry(tx, ctx, {
        action: 'patient_share_case_scope_updated',
        targetType: 'PatientShareCase',
        targetId: updated.id,
        patientId: shareCase.base_patient_id,
        changes: {
          status: updated.status,
          previous_scope_keys: previousScopeKeys,
          share_scope_keys: nextScopeKeys,
          previous_output_actions: previousOutputActions,
          output_actions: allowedPatientShareDataOutputActions({
            shareCaseStatus: updated.status,
            shareScope: updated.share_scope,
          }),
          enabled_scope_count: nextScopeKeys.length,
          disabled_scope_count: PATIENT_SHARE_SCOPE_KEYS.length - nextScopeKeys.length,
        },
      });

      return { shareCase: updated };
    });

    if ('response' in result) {
      return withSensitiveNoStore(result.response ?? validationError('入力値が不正です'));
    }

    return withSensitiveNoStore(
      success({
        id: result.shareCase.id,
        status: result.shareCase.status,
        updated_at: result.shareCase.updated_at,
        scope_keys: enabledPatientShareScopeKeys(result.shareCase.share_scope),
        output_actions: allowedPatientShareDataOutputActions({
          shareCaseStatus: result.shareCase.status,
          shareScope: result.shareCase.share_scope,
        }),
      }),
    );
  },
  {
    permission: 'canManagePatientSharing',
    message: '患者共有ケースの更新権限がありません',
  },
);
