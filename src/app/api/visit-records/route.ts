import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError } from '@/lib/api/response';
import { parsePaginationParams } from '@/lib/api/pagination';
import {
  createVisitRecordSchema,
  type CreateVisitRecordInput,
} from '@/lib/validations/visit-record';
import { prisma } from '@/lib/db/client';
import { buildAllSoapTexts } from '@/lib/utils/soap-text-builder';
import type { StructuredSoap } from '@/types/structured-soap';
import type { Prisma } from '@prisma/client';
import { upsertBillingEvidenceForVisit } from '@/server/services/billing-evidence';
import { upsertOperationalTask } from '@/server/services/operational-tasks';

const scheduleStatusByOutcome: Record<
  CreateVisitRecordInput['outcome_status'],
  'completed' | 'postponed' | 'cancelled'
> = {
  completed: 'completed',
  revisit_needed: 'completed',
  postponed: 'postponed',
  cancelled: 'cancelled',
  delivery_only: 'completed',
  completed_with_issue: 'completed',
};

const cycleCompletionOutcomes = new Set<CreateVisitRecordInput['outcome_status']>([
  'completed',
  'completed_with_issue',
  'revisit_needed',
]);

export const GET = withAuth(async (req: AuthenticatedRequest) => {
  const { searchParams } = new URL(req.url);
  const { cursor, limit } = parsePaginationParams(searchParams);

  const patientId = searchParams.get('patient_id') ?? undefined;
  const pharmacistId = searchParams.get('pharmacist_id') ?? undefined;
  const dateFrom = searchParams.get('date_from') ?? undefined;
  const dateTo = searchParams.get('date_to') ?? undefined;

  const where = {
    org_id: req.orgId,
    ...(patientId ? { patient_id: patientId } : {}),
    ...(pharmacistId ? { pharmacist_id: pharmacistId } : {}),
    ...(dateFrom || dateTo
      ? {
          visit_date: {
            ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
            ...(dateTo ? { lte: new Date(dateTo + 'T23:59:59') } : {}),
          },
        }
      : {}),
  };

  const records = await prisma.visitRecord.findMany({
    where,
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    orderBy: { visit_date: 'desc' },
    select: {
      id: true,
      schedule_id: true,
      patient_id: true,
      pharmacist_id: true,
      visit_date: true,
      outcome_status: true,
      soap_subjective: true,
      soap_objective: true,
      soap_assessment: true,
      soap_plan: true,
      receipt_person_name: true,
      receipt_person_relation: true,
      receipt_at: true,
      next_visit_suggestion_date: true,
      version: true,
      created_at: true,
      updated_at: true,
      schedule: {
        select: {
          visit_type: true,
          scheduled_date: true,
        },
      },
    },
  });

  const hasMore = records.length > limit;
  const data = hasMore ? records.slice(0, limit) : records;
  const nextCursor = hasMore ? data[data.length - 1]?.id : undefined;

  return success({ data, hasMore, nextCursor });
}, {
  permission: 'canVisit',
  message: '訪問記録の閲覧権限がありません',
});

export const POST = withAuth(async (req: AuthenticatedRequest) => {
  const body = await req.json().catch(() => null);
  if (!body) return validationError('リクエストボディが不正です');

  const parsed = createVisitRecordSchema.safeParse(body);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const {
    schedule_id,
    patient_id,
    visit_date,
    outcome_status,
    next_visit_suggestion_date,
    structured_soap,
    ...rest
  } = parsed.data;
  const visitRecordedAt = new Date(visit_date);
  const scheduleStatus = scheduleStatusByOutcome[outcome_status];
  const shouldAdvanceVisitWorkflow = cycleCompletionOutcomes.has(outcome_status);

  // Auto-generate SOAP text from structured data
  let soapTextOverrides = {};
  if (structured_soap) {
    soapTextOverrides = buildAllSoapTexts(structured_soap as StructuredSoap);
  }

  const result = await withOrgContext(req.orgId, async (tx) => {
    const schedule = await tx.visitSchedule.findFirst({
      where: { id: schedule_id, org_id: req.orgId },
      select: {
        id: true,
        case_id: true,
        schedule_status: true,
        recurrence_rule: true,
        cycle_id: true,
      },
    });
    if (!schedule) {
      return { error: 'schedule_not_found' as const };
    }

    const careCase = await tx.careCase.findFirst({
      where: {
        id: schedule.case_id,
        org_id: req.orgId,
      },
      select: {
        patient_id: true,
      },
    });
    if (!careCase) {
      return { error: 'case_not_found' as const };
    }
    if (careCase.patient_id !== patient_id) {
      return { error: 'patient_mismatch' as const };
    }

    const record = await tx.visitRecord.create({
      data: {
        org_id: req.orgId,
        schedule_id,
        patient_id: careCase.patient_id,
        pharmacist_id: req.userId,
        visit_date: visitRecordedAt,
        next_visit_suggestion_date: next_visit_suggestion_date
          ? new Date(next_visit_suggestion_date)
          : undefined,
        ...rest,
        outcome_status,
        ...soapTextOverrides,
        structured_soap: structured_soap as Prisma.InputJsonValue ?? undefined,
      },
    });

    // Visit outcome must drive the schedule state, or postponed/cancelled visits
    // will be incorrectly treated as completed work.
    await tx.visitSchedule.update({
      where: { id: schedule_id },
      data: { schedule_status: scheduleStatus },
    });

    if (shouldAdvanceVisitWorkflow && schedule.cycle_id) {
      const activeVisitConsent = await tx.consentRecord.findFirst({
        where: {
          org_id: req.orgId,
          patient_id: careCase.patient_id,
          consent_type: 'visit_medication_management',
          is_active: true,
          revoked_date: null,
          OR: [
            { expiry_date: null },
            { expiry_date: { gte: visitRecordedAt } },
          ],
        },
        select: { id: true },
      });

      const cycle = await tx.medicationCycle.findFirst({
        where: { id: schedule.cycle_id, org_id: req.orgId },
        select: { id: true, overall_status: true },
      });

      if (
        cycle &&
        (cycle.overall_status === 'set_audited' ||
          cycle.overall_status === 'visit_ready')
      ) {
        await tx.medicationCycle.update({
          where: { id: cycle.id },
          data: { overall_status: 'visit_completed' },
        });
      }

      if (!activeVisitConsent) {
        const existingException = await tx.workflowException.findFirst({
          where: {
            org_id: req.orgId,
            cycle_id: schedule.cycle_id,
            exception_type: 'missing_visit_consent',
            status: 'open',
          },
          select: { id: true },
        });

        if (!existingException) {
          await tx.workflowException.create({
            data: {
              org_id: req.orgId,
              cycle_id: schedule.cycle_id,
              exception_type: 'missing_visit_consent',
              description:
                '訪問薬剤管理の有効な同意記録がない状態で訪問記録が登録されました',
              severity: 'critical',
              status: 'open',
            },
          });

          await tx.medicationCycle.update({
            where: { id: schedule.cycle_id },
            data: { exception_status: 'missing_visit_consent' },
          });
        }
      }
    }

    // Suggest next visit if next_visit_suggestion_date provided
    let suggestedSchedule = null;
    if (next_visit_suggestion_date) {
      suggestedSchedule = {
        suggested_date: next_visit_suggestion_date,
        message: '次回訪問日の作成を検討してください',
      };

      await upsertOperationalTask(tx, {
        orgId: req.orgId,
        taskType: 'visit_followup',
        title: '次回訪問候補の調整が必要です',
        description: '訪問記録で次回訪問日の提案が入力されています。',
        priority: outcome_status === 'revisit_needed' ? 'urgent' : 'high',
        assignedTo: req.userId,
        dueDate: new Date(next_visit_suggestion_date),
        slaDueAt: new Date(next_visit_suggestion_date),
        relatedEntityType: 'visit_record',
        relatedEntityId: record.id,
        dedupeKey: `visit-followup:${record.id}`,
        metadata: {
          patient_id: careCase.patient_id,
          case_id: schedule.case_id,
          schedule_id,
        } as Prisma.InputJsonValue,
      });
    }

    await upsertOperationalTask(tx, {
      orgId: req.orgId,
      taskType: 'care_report_followup',
      title: '訪問後報告の送付確認が必要です',
      description: '医師・ケアマネ向け報告書の送付状況を確認してください。',
      priority: 'high',
      assignedTo: req.userId,
      dueDate: visitRecordedAt,
      slaDueAt: visitRecordedAt,
      relatedEntityType: 'visit_record',
      relatedEntityId: record.id,
      dedupeKey: `care-report-followup:${record.id}`,
      metadata: {
        patient_id: careCase.patient_id,
        case_id: schedule.case_id,
      } as Prisma.InputJsonValue,
    });

    await upsertBillingEvidenceForVisit(tx, {
      orgId: req.orgId,
      visitRecordId: record.id,
    });

    return { record, suggestedSchedule };
  });

  if ('error' in result) {
    if (result.error === 'schedule_not_found') {
      return validationError('指定されたスケジュールが見つかりません');
    }
    if (result.error === 'case_not_found') {
      return validationError('訪問予定に紐づくケースが見つかりません');
    }
    if (result.error === 'patient_mismatch') {
      return validationError('訪問予定に紐づく患者と記録対象患者が一致しません');
    }
    return validationError('指定されたスケジュールが見つかりません');
  }

  return success(result, 201);
}, {
  permission: 'canVisit',
  message: '訪問記録の作成権限がありません',
});
