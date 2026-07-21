import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { withAuthContext, type AuthContext } from '@/lib/auth/context';
import { hasPermission } from '@/lib/auth/permissions';
import { withOrgContext } from '@/lib/db/rls';
import { isPrismaErrorCode } from '@/lib/db/prisma-errors';
import {
  success,
  validationError,
  notFound,
  conflict,
  forbiddenResponse,
} from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import {
  updateMedicationIssueSchema,
  type UpdateMedicationIssueInput,
} from '@/lib/validations/medication';
import { canFinalizeClinicalState } from '@/lib/auth/clinical-finalization';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import {
  canBypassVisitScheduleAssignmentAccess,
  type VisitScheduleAccessContext,
} from '@/lib/auth/visit-schedule-access';
import {
  canAccessCaseScopedPatientResource,
  listAccessibleCareCaseIds,
  listAccessiblePatientIds,
} from '@/server/services/patient-access';
import { promoteResolvedQrAllergyIssueToPatient } from '@/server/services/qr-allergy-promotion';
import { promoteResolvedQrLabIssueToPatientLabs } from '@/server/services/qr-lab-promotion';
import { promoteResolvedQrOtcIssueToMedicationProfile } from '@/server/services/qr-otc-promotion';
import { notifyWorkflowMutation } from '@/server/services/workflow-dashboard-cache';

function touchesMedicationIssueClinicalState(patch: UpdateMedicationIssueInput) {
  return patch.status !== undefined || patch.promote_to_medication_profile === true;
}

function buildMedicationIssueAuditChanges(args: {
  existing: {
    status: string;
    priority?: string | null;
    category?: string | null;
  };
  patch: UpdateMedicationIssueInput;
  promotedAllergyInfo: boolean;
  promotedLabObservationCount: number;
  promotedToMedicationProfile: boolean;
}) {
  return {
    ...(args.patch.status !== undefined
      ? {
          status: { from: args.existing.status, to: args.patch.status },
        }
      : {}),
    ...(args.patch.priority !== undefined
      ? {
          priority: { from: args.existing.priority ?? null, to: args.patch.priority },
        }
      : {}),
    ...(args.patch.category !== undefined
      ? {
          category: { from: args.existing.category ?? null, to: args.patch.category },
        }
      : {}),
    title_changed: args.patch.title !== undefined,
    description_changed: args.patch.description !== undefined,
    promote_to_medication_profile_requested: args.patch.promote_to_medication_profile === true,
    promoted_allergy_info: args.promotedAllergyInfo,
    promoted_lab_observation_count: args.promotedLabObservationCount,
    promoted_to_medication_profile: args.promotedToMedicationProfile,
  };
}

async function buildMedicationIssueAssignmentWhere(args: {
  db: Prisma.TransactionClient;
  orgId: string;
  accessContext: VisitScheduleAccessContext;
}): Promise<Prisma.MedicationIssueWhereInput | null> {
  if (canBypassVisitScheduleAssignmentAccess(args.accessContext)) return null;

  const [caseIds, patientIds] = await Promise.all([
    listAccessibleCareCaseIds({
      db: args.db,
      orgId: args.orgId,
      accessContext: args.accessContext,
    }),
    listAccessiblePatientIds({
      db: args.db,
      orgId: args.orgId,
      accessContext: args.accessContext,
    }),
  ]);

  return {
    OR: [
      { case_id: { in: caseIds } },
      { AND: [{ case_id: null }, { patient_id: { in: patientIds } }] },
    ],
  };
}

async function authenticatedPATCH(
  req: NextRequest,
  ctx: AuthContext,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return withSensitiveNoStore(validationError('服薬課題IDが不正です'));

  const payload = await readJsonObjectRequestBody(req);
  if (!payload) return withSensitiveNoStore(validationError('リクエストボディが不正です'));

  const parsed = updateMedicationIssueSchema.safeParse(payload);
  if (!parsed.success) {
    return withSensitiveNoStore(
      validationError('入力値が不正です', parsed.error.flatten().fieldErrors),
    );
  }

  const {
    version,
    promote_to_medication_profile: promoteToMedicationProfile,
    ...issuePatch
  } = parsed.data;
  const updateData: Prisma.MedicationIssueUpdateManyMutationInput = {
    ...issuePatch,
    version: { increment: 1 },
  };

  if (parsed.data.status === 'resolved' || parsed.data.status === 'dismissed') {
    updateData.resolved_by = ctx.userId;
    updateData.resolved_at = new Date();
  } else if (parsed.data.status === 'open' || parsed.data.status === 'in_progress') {
    updateData.resolved_by = null;
    updateData.resolved_at = null;
  }

  const resolvedAt = updateData.resolved_at instanceof Date ? updateData.resolved_at : null;
  let result:
    | Response
    | {
        issue: Prisma.MedicationIssueGetPayload<Record<string, never>>;
        existing: {
          id: string;
          status: string;
          patient_id: string;
          case_id: string | null;
        };
        promotedAllergyInfo: boolean;
        promotedLabObservationCount: number;
        promotedToMedicationProfile: boolean;
      };
  try {
    result = await withOrgContext(
      ctx.orgId,
      async (tx) => {
        const membership = await tx.membership.findFirst({
          where: { user_id: ctx.userId, org_id: ctx.orgId, is_active: true },
          select: { role: true },
        });
        if (!membership || !hasPermission(membership.role, 'canVisit')) {
          return forbiddenResponse('服薬課題の更新権限がありません');
        }
        if (
          touchesMedicationIssueClinicalState(parsed.data) &&
          !canFinalizeClinicalState(membership.role)
        ) {
          return forbiddenResponse('服薬課題の状態変更・反映権限がありません');
        }

        const accessContext = { userId: ctx.userId, role: membership.role };
        const assignmentWhere = await buildMedicationIssueAssignmentWhere({
          db: tx,
          orgId: ctx.orgId,
          accessContext,
        });
        const existing = await tx.medicationIssue.findFirst({
          where: {
            id,
            org_id: ctx.orgId,
            ...(assignmentWhere ? { AND: [assignmentWhere] } : {}),
          },
          select: {
            id: true,
            status: true,
            patient_id: true,
            case_id: true,
            title: true,
            description: true,
            priority: true,
            category: true,
            version: true,
          },
        });
        if (!existing) return notFound('課題が見つかりません');
        if (existing.version !== version) {
          return conflict('服薬課題が更新されています。再読み込みしてください', {
            expected_version: version,
            current_version: existing.version,
          });
        }

        const hasCurrentPatientScope = await canAccessCaseScopedPatientResource({
          db: tx,
          orgId: ctx.orgId,
          patientId: existing.patient_id,
          caseId: existing.case_id,
          accessContext,
        });
        if (!hasCurrentPatientScope) {
          return validationError('保存済みの患者またはケース参照を確認できません');
        }

        const updateResult = await tx.medicationIssue.updateMany({
          where: {
            id,
            org_id: ctx.orgId,
            version,
            ...(assignmentWhere ? { AND: [assignmentWhere] } : {}),
          },
          data: updateData,
        });
        if (updateResult.count !== 1) {
          return conflict('服薬課題が同時に更新されました。再読み込みしてください');
        }

        const updated = await tx.medicationIssue.findFirst({ where: { id, org_id: ctx.orgId } });
        if (!updated) return conflict('更新後の服薬課題を取得できません');

        let promotedAllergyInfo = false;
        let promotedLabObservationCount = 0;
        let promotedToMedicationProfile = false;
        if (parsed.data.status === 'resolved' && resolvedAt) {
          const effectiveIssue = {
            id: existing.id,
            patient_id: existing.patient_id,
            title: parsed.data.title ?? existing.title,
            description: parsed.data.description ?? existing.description,
            category: parsed.data.category ?? existing.category,
          };
          const allergyPromotion = await promoteResolvedQrAllergyIssueToPatient(tx, {
            orgId: ctx.orgId,
            issue: effectiveIssue,
            confirmedAt: resolvedAt,
          });
          promotedAllergyInfo = allergyPromotion.promoted;
          const labPromotion = await promoteResolvedQrLabIssueToPatientLabs(tx, {
            orgId: ctx.orgId,
            issue: effectiveIssue,
            confirmedAt: resolvedAt,
          });
          promotedLabObservationCount = labPromotion.promotedCount;
          if (promoteToMedicationProfile) {
            const otcPromotion = await promoteResolvedQrOtcIssueToMedicationProfile(tx, {
              orgId: ctx.orgId,
              issue: effectiveIssue,
              confirmedAt: resolvedAt,
            });
            promotedToMedicationProfile = otcPromotion.promoted;
          }
        }
        await createAuditLogEntry(tx, ctx, {
          action: 'medication_issue_updated',
          targetType: 'MedicationIssue',
          targetId: existing.id,
          patientId: existing.patient_id,
          changes: {
            ...buildMedicationIssueAuditChanges({
              existing,
              patch: parsed.data,
              promotedAllergyInfo,
              promotedLabObservationCount,
              promotedToMedicationProfile,
            }),
            previous_version: existing.version,
            version: updated.version,
          },
        });
        return {
          issue: updated,
          existing,
          promotedAllergyInfo,
          promotedLabObservationCount,
          promotedToMedicationProfile,
        };
      },
      { requestContext: ctx, isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error) {
    if (isPrismaErrorCode(error, 'P2034')) {
      return withSensitiveNoStore(
        conflict('服薬課題が同時に更新されました。再読み込みしてください'),
      );
    }
    throw error;
  }

  if (result instanceof Response) return withSensitiveNoStore(result);

  await notifyWorkflowMutation({
    orgId: ctx.orgId,
    payload: {
      source: 'medication_issues_update',
      issue_id: result.existing.id,
      patient_id: result.existing.patient_id,
      case_id: result.existing.case_id,
      status: parsed.data.status ?? result.existing.status,
      promoted_allergy_info: result.promotedAllergyInfo,
      promoted_lab_observation_count: result.promotedLabObservationCount,
      promoted_to_medication_profile: result.promotedToMedicationProfile,
    },
  });

  return withSensitiveNoStore(success({ data: result.issue }));
}

export const PATCH = withAuthContext(authenticatedPATCH, {
  permission: 'canVisit',
  message: '服薬課題の更新権限がありません',
});
