import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError, notFound } from '@/lib/api/response';
import { validateOrgReferences } from '@/lib/api/org-reference';
import { updateVisitScheduleSchema } from '@/lib/validations/visit-schedule';
import { prisma } from '@/lib/db/client';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '訪問予定の閲覧権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  const { id } = await params;

  const schedule = await prisma.visitSchedule.findFirst({
    where: { id, org_id: ctx.orgId },
    include: {
      visit_record: true,
      preparation: true,
      override_request: true,
      applied_override: true,
      case_: {
        select: {
          patient: {
            select: {
              id: true,
              name: true,
              residences: {
                where: { is_primary: true },
                select: {
                  address: true,
                  lat: true,
                  lng: true,
                },
                take: 1,
              },
            },
          },
        },
      },
      site: {
        select: {
          id: true,
          name: true,
          address: true,
        },
      },
    },
  });

  if (!schedule) return notFound('訪問予定が見つかりません');

  const careCase = await prisma.careCase.findFirst({
    where: {
      id: schedule.case_id,
      org_id: ctx.orgId,
    },
    select: {
      patient_id: true,
    },
  });
  if (!careCase) return notFound('訪問予定に紐づくケースが見つかりません');

  return success({
    ...schedule,
    patient_id: careCase.patient_id,
    cycle_id: schedule.cycle_id,
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '訪問予定の更新権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  const { id } = await params;

  const body = await req.json().catch(() => null);
  if (!body) return validationError('リクエストボディが不正です');

  const parsed = updateVisitScheduleSchema.safeParse(body);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const existing = await prisma.visitSchedule.findFirst({
    where: { id, org_id: ctx.orgId },
    select: {
      id: true,
      confirmed_at: true,
    },
  });
  if (!existing) return notFound('訪問予定が見つかりません');

  const {
    site_id,
    scheduled_date,
    time_window_start,
    time_window_end,
    notes: _notes,
    ...rest
  } = parsed.data;
  void _notes;

  const changesLockedFields =
    site_id !== undefined ||
    scheduled_date !== undefined ||
    time_window_start !== undefined ||
    time_window_end !== undefined ||
    rest.pharmacist_id !== undefined;
  if (existing.confirmed_at && changesLockedFields) {
    return validationError(
      '電話確定済みの訪問予定は専用のリスケジュール操作で変更してください'
    );
  }

  if (rest.schedule_status === 'ready') {
    const preparation = await prisma.visitPreparation.findFirst({
      where: {
        org_id: ctx.orgId,
        schedule_id: id,
      },
      select: {
        medication_changes_reviewed: true,
        carry_items_confirmed: true,
        previous_issues_reviewed: true,
        route_confirmed: true,
        offline_synced: true,
      },
    });

    const readyForVisit =
      preparation?.medication_changes_reviewed &&
      preparation.carry_items_confirmed &&
      preparation.previous_issues_reviewed &&
      preparation.route_confirmed &&
      preparation.offline_synced;

    if (!readyForVisit) {
      return validationError(
        '訪問準備チェックリストが未完了のため ready へ進めません'
      );
    }
  }

  const refResult = await validateOrgReferences(ctx.orgId, {
    ...(rest.case_id ? { case_id: rest.case_id } : {}),
    ...(site_id ? { site_id } : {}),
    ...(rest.pharmacist_id ? { pharmacist_id: rest.pharmacist_id } : {}),
  });
  if (!refResult.ok) return refResult.response;

  const schedule = await withOrgContext(ctx.orgId, async (tx) => {
    return tx.visitSchedule.update({
      where: { id },
      data: {
        ...(site_id !== undefined ? { site_id: site_id || null } : {}),
        ...(scheduled_date ? { scheduled_date: new Date(scheduled_date) } : {}),
        ...(time_window_start !== undefined
          ? { time_window_start: time_window_start ? new Date(`1970-01-01T${time_window_start}`) : null }
          : {}),
        ...(time_window_end !== undefined
          ? { time_window_end: time_window_end ? new Date(`1970-01-01T${time_window_end}`) : null }
          : {}),
        ...(rest.schedule_status === 'ready'
          ? { pre_visit_checklist_completed: true }
          : {}),
        ...rest,
        version: { increment: 1 },
      },
    });
  }, { requestContext: ctx });

  return success(schedule);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '訪問予定の更新権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  const { id } = await params;

  const existing = await prisma.visitSchedule.findFirst({
    where: { id, org_id: ctx.orgId },
  });
  if (!existing) return notFound('訪問予定が見つかりません');

  const schedule = await withOrgContext(ctx.orgId, async (tx) => {
    return tx.visitSchedule.update({
      where: { id },
      data: { schedule_status: 'cancelled' },
    });
  }, { requestContext: ctx });

  return success(schedule);
}
