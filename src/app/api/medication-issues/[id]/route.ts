import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError, notFound, forbiddenResponse } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import {
  updateMedicationIssueSchema,
  type UpdateMedicationIssueInput,
} from '@/lib/validations/medication';
import { canFinalizeClinicalState } from '@/lib/auth/clinical-finalization';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { prisma } from '@/lib/db/client';
import { validateOrgReferences } from '@/lib/api/org-reference';
import {
  canBypassVisitScheduleAssignmentAccess,
  type VisitScheduleAccessContext,
} from '@/lib/auth/visit-schedule-access';
import {
  listAccessibleCareCaseIds,
  listAccessiblePatientIds,
} from '@/server/services/patient-access';
import { promoteResolvedQrAllergyIssueToPatient } from '@/server/services/qr-allergy-promotion';
import { promoteResolvedQrLabIssueToPatientLabs } from '@/server/services/qr-lab-promotion';
import { promoteResolvedQrOtcIssueToMedicationProfile } from '@/server/services/qr-otc-promotion';
import { notifyWorkflowMutation } from '@/server/services/workflow-dashboard-cache';
import type { Prisma } from '@prisma/client';

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
  orgId: string;
  accessContext: VisitScheduleAccessContext;
}): Promise<Prisma.MedicationIssueWhereInput | null> {
  if (canBypassVisitScheduleAssignmentAccess(args.accessContext)) return null;

  const [caseIds, patientIds] = await Promise.all([
    listAccessibleCareCaseIds({
      db: prisma,
      orgId: args.orgId,
      accessContext: args.accessContext,
    }),
    listAccessiblePatientIds({
      db: prisma,
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

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '服薬課題の更新権限がありません',
  });
  if ('response' in authResult) return withSensitiveNoStore(authResult.response);
  const ctx = authResult.ctx;

  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return withSensitiveNoStore(validationError('服薬課題IDが不正です'));

  const accessContext = { userId: ctx.userId, role: ctx.role };

  const payload = await readJsonObjectRequestBody(req);
  if (!payload) return withSensitiveNoStore(validationError('リクエストボディが不正です'));

  const parsed = updateMedicationIssueSchema.safeParse(payload);
  if (!parsed.success) {
    return withSensitiveNoStore(
      validationError('入力値が不正です', parsed.error.flatten().fieldErrors),
    );
  }

  if (touchesMedicationIssueClinicalState(parsed.data) && !canFinalizeClinicalState(ctx.role)) {
    return withSensitiveNoStore(
      await forbiddenResponse('服薬課題の状態変更・反映権限がありません'),
    );
  }

  const assignmentWhere = await buildMedicationIssueAssignmentWhere({
    orgId: ctx.orgId,
    accessContext,
  });
  const existing = await prisma.medicationIssue.findFirst({
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
    },
  });
  if (!existing) return withSensitiveNoStore(notFound('課題が見つかりません'));

  const refResult = await validateOrgReferences(ctx.orgId, {
    patient_id: existing.patient_id,
    case_id: existing.case_id,
  });
  if (!refResult.ok) return withSensitiveNoStore(refResult.response);

  const { promote_to_medication_profile: promoteToMedicationProfile, ...issuePatch } = parsed.data;
  const updateData: Record<string, unknown> = { ...issuePatch };

  if (parsed.data.status === 'resolved' || parsed.data.status === 'dismissed') {
    updateData.resolved_by = ctx.userId;
    updateData.resolved_at = new Date();
  } else if (parsed.data.status === 'open' || parsed.data.status === 'in_progress') {
    updateData.resolved_by = null;
    updateData.resolved_at = null;
  }

  const resolvedAt = updateData.resolved_at instanceof Date ? updateData.resolved_at : null;
  let promotedAllergyInfo = false;
  let promotedLabObservationCount = 0;
  let promotedToMedicationProfile = false;
  const issue = await withOrgContext(ctx.orgId, async (tx) => {
    const updated = await tx.medicationIssue.update({
      where: { id },
      data: updateData,
    });
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
      changes: buildMedicationIssueAuditChanges({
        existing,
        patch: parsed.data,
        promotedAllergyInfo,
        promotedLabObservationCount,
        promotedToMedicationProfile,
      }),
    });
    return updated;
  });

  await notifyWorkflowMutation({
    orgId: ctx.orgId,
    payload: {
      source: 'medication_issues_update',
      issue_id: existing.id,
      patient_id: existing.patient_id,
      case_id: existing.case_id,
      status: parsed.data.status ?? existing.status,
      promoted_allergy_info: promotedAllergyInfo,
      promoted_lab_observation_count: promotedLabObservationCount,
      promoted_to_medication_profile: promotedToMedicationProfile,
    },
  });

  return withSensitiveNoStore(success({ data: issue }));
}
