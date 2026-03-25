import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError } from '@/lib/api/response';
import { parsePaginationParams } from '@/lib/api/pagination';
import { createVisitRecordSchema } from '@/lib/validations/visit-record';
import { prisma } from '@/lib/db/client';

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
    next_visit_suggestion_date,
    ...rest
  } = parsed.data;

  const result = await withOrgContext(req.orgId, async (tx) => {
    // Verify schedule belongs to this org
    const schedule = await tx.visitSchedule.findFirst({
      where: { id: schedule_id, org_id: req.orgId },
      select: { id: true, schedule_status: true, recurrence_rule: true },
    });
    if (!schedule) {
      return null;
    }

    // Create visit record
    const record = await tx.visitRecord.create({
      data: {
        org_id: req.orgId,
        schedule_id,
        patient_id,
        pharmacist_id: req.userId,
        visit_date: new Date(visit_date),
        next_visit_suggestion_date: next_visit_suggestion_date
          ? new Date(next_visit_suggestion_date)
          : undefined,
        ...rest,
      },
    });

    // Update schedule status to completed
    await tx.visitSchedule.update({
      where: { id: schedule_id },
      data: { schedule_status: 'completed' },
    });

    // Suggest next visit if next_visit_suggestion_date provided
    let suggestedSchedule = null;
    if (next_visit_suggestion_date) {
      suggestedSchedule = {
        suggested_date: next_visit_suggestion_date,
        message: '次回訪問日の作成を検討してください',
      };
    }

    return { record, suggestedSchedule };
  });

  if (!result) {
    return validationError('指定されたスケジュールが見つかりません');
  }

  return success(result, 201);
});
