import { z } from 'zod';
import { NextRequest } from 'next/server';
import { withAuthContext, type AuthRouteContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError, notFound, forbidden, conflict } from '@/lib/api/response';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { prisma } from '@/lib/db/client';
import { hasPermission } from '@/lib/auth/permissions';
import { buildCareCaseAssignmentWhere } from '@/lib/auth/visit-schedule-access';
import { canAccessCaseScopedPatientResource } from '@/server/services/patient-access';
import { upsertOperationalTask } from '@/server/services/operational-tasks';
import type { ConsentRecord, Prisma } from '@prisma/client';
import type { ExceptionSeverity, ExceptionStatus } from '@/types/domain-literals';

const EXTERNAL_ACCESS_ALLOWED_CASE_IDS_KEY = 'allowed_case_ids';

const revokeConsentSchema = z.object({
  reason: z
    .string()
    .trim()
    .max(500, '撤回理由は500文字以内で入力してください')
    .optional()
    .transform((value) => (value === '' ? undefined : value)),
});

type ConsentRevokeResult =
  | { record: ConsentRecord }
  | { error: 'not_found' | 'conflict'; message?: string };

class ConsentRevokeConflictError extends Error {}

function toAuditDate(value: Date | string | null | undefined) {
  if (value instanceof Date) return value.toISOString();
  return value ?? null;
}

function buildExternalAccessGrantRevokeWhere(args: {
  orgId: string;
  patientId: string;
  caseId?: string | null;
}): Prisma.ExternalAccessGrantWhereInput {
  const baseWhere: Prisma.ExternalAccessGrantWhereInput = {
    org_id: args.orgId,
    patient_id: args.patientId,
    revoked_at: null,
  };

  if (!args.caseId) return baseWhere;

  return {
    ...baseWhere,
    scope: {
      path: [EXTERNAL_ACCESS_ALLOWED_CASE_IDS_KEY],
      array_contains: [args.caseId],
    },
  };
}

export const POST = withAuthContext<{ id: string }>(
  async (req: NextRequest, ctx, routeContext: AuthRouteContext<{ id: string }>) => {
    if (!hasPermission(ctx.role, 'canVisit')) {
      return forbidden('同意撤回には訪問権限が必要です');
    }

    const { id: rawId } = await routeContext.params;
    const id = normalizeRequiredRouteParam(rawId);
    if (!id) return validationError('同意記録IDが不正です');

    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = revokeConsentSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const existing = await prisma.consentRecord.findFirst({
      where: { id, org_id: ctx.orgId },
      select: {
        id: true,
        patient_id: true,
        case_id: true,
        consent_type: true,
        is_active: true,
        access_restricted: true,
        revoked_date: true,
        updated_at: true,
      },
    });
    if (!existing) return notFound('同意記録が見つかりません');

    const canAccessConsent = await canAccessCaseScopedPatientResource({
      db: prisma,
      orgId: ctx.orgId,
      patientId: existing.patient_id,
      caseId: existing.case_id,
      accessContext: ctx,
    });
    if (!canAccessConsent) return notFound('同意記録が見つかりません');

    if (!existing.is_active) {
      return validationError('この同意記録はすでに無効化されています');
    }

    const now = new Date();
    const reasonProvided = parsed.data.reason !== undefined;

    const result = await withOrgContext(ctx.orgId, async (tx): Promise<ConsentRevokeResult> => {
      const canStillAccessConsent = await canAccessCaseScopedPatientResource({
        db: tx,
        orgId: ctx.orgId,
        patientId: existing.patient_id,
        caseId: existing.case_id,
        accessContext: ctx,
      });
      if (!canStillAccessConsent) return { error: 'not_found' as const };

      // Revoke the consent record
      const revokeResult = await tx.consentRecord.updateMany({
        where: {
          id,
          org_id: ctx.orgId,
          is_active: true,
          updated_at: existing.updated_at,
        },
        data: {
          is_active: false,
          revoked_date: now,
          access_restricted: true,
        },
      });
      if (revokeResult.count !== 1) {
        throw new ConsentRevokeConflictError(
          'この同意記録は他のユーザーによって更新されています。最新のデータを取得してください。',
        );
      }

      const revokedRecord = await tx.consentRecord.findUnique({
        where: { id },
      });
      if (!revokedRecord) {
        return { error: 'not_found' as const };
      }

      // Revoke all active ExternalAccessGrants for this patient
      const revokedExternalGrants = await tx.externalAccessGrant.updateMany({
        where: buildExternalAccessGrantRevokeWhere({
          orgId: ctx.orgId,
          patientId: existing.patient_id,
          caseId: existing.case_id,
        }),
        data: {
          revoked_at: now,
        },
      });

      const reviewCycles = await tx.medicationCycle.findMany({
        where: {
          org_id: ctx.orgId,
          patient_id: existing.patient_id,
          ...(existing.case_id ? { case_id: existing.case_id } : {}),
          overall_status: { notIn: ['reported', 'cancelled'] },
        },
        orderBy: { updated_at: 'desc' },
        select: { id: true },
      });
      const workflowExceptionCycleIds = reviewCycles.map((cycle) => cycle.id);
      let fallbackReviewTask = false;

      // Create WorkflowException to flag case continuity review
      for (const cycle of reviewCycles) {
        await tx.workflowException.create({
          data: {
            org_id: ctx.orgId,
            cycle_id: cycle.id,
            patient_id: existing.patient_id,
            exception_type: 'consent_revoked',
            description: `患者の同意が撤回されました（種別: ${existing.consent_type}）。ケース継続判断が必要です。`,
            severity: 'warning' satisfies ExceptionSeverity,
            status: 'open' satisfies ExceptionStatus,
          },
        });
      }

      if (reviewCycles.length === 0) {
        const caseAssignmentWhere = buildCareCaseAssignmentWhere(ctx);
        const responsibleCase = await tx.careCase.findFirst({
          where: {
            org_id: ctx.orgId,
            patient_id: existing.patient_id,
            ...(existing.case_id ? { id: existing.case_id } : {}),
            ...(caseAssignmentWhere ? { AND: [caseAssignmentWhere] } : {}),
          },
          orderBy: { updated_at: 'desc' },
          select: {
            id: true,
            primary_pharmacist_id: true,
          },
        });

        await upsertOperationalTask(tx, {
          orgId: ctx.orgId,
          taskType: 'consent_revocation_review',
          title: '同意撤回後の継続判断が必要です',
          description: `同意撤回後の継続可否と外部共有停止状況を確認してください（種別: ${existing.consent_type}）。`,
          priority: 'high',
          assignedTo: responsibleCase?.primary_pharmacist_id ?? ctx.userId,
          dedupeKey: `consent-revocation-review:${id}`,
          relatedEntityType: existing.case_id ? 'case' : 'patient',
          relatedEntityId: existing.case_id
            ? (responsibleCase?.id ?? existing.case_id)
            : existing.patient_id,
          metadata: {
            patient_id: existing.patient_id,
            case_id: existing.case_id ?? responsibleCase?.id ?? null,
            consent_record_id: id,
            consent_type: existing.consent_type,
            reason_provided: reasonProvided,
          },
        });
        fallbackReviewTask = true;
      }

      await createAuditLogEntry(tx, ctx, {
        action: 'consent_record_revoked',
        targetType: 'consent_record',
        targetId: id,
        changes: {
          patient_id: existing.patient_id,
          case_id: existing.case_id ?? null,
          consent_type: existing.consent_type,
          reason_provided: reasonProvided,
          external_access_grants_revoked: revokedExternalGrants.count,
          workflow_exception_cycle_ids: workflowExceptionCycleIds,
          fallback_operational_task_created: fallbackReviewTask,
          before: {
            is_active: existing.is_active,
            access_restricted: existing.access_restricted,
            revoked_date: toAuditDate(existing.revoked_date),
          },
          after: {
            is_active: false,
            access_restricted: true,
            revoked_date: now.toISOString(),
          },
        },
      });

      return { record: revokedRecord };
    }).catch((error): ConsentRevokeResult => {
      if (error instanceof ConsentRevokeConflictError) {
        return { error: 'conflict', message: error.message };
      }
      throw error;
    });

    if ('error' in result) {
      if (result.error === 'conflict') {
        return conflict(result.message ?? 'この同意記録は他のユーザーによって更新されています');
      }
      return notFound('同意記録が見つかりません');
    }

    return success(result.record);
  },
  { permission: 'canVisit' },
);
