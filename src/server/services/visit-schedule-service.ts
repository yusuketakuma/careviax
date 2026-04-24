import type { PrismaClient } from '@prisma/client';
import { buildSort } from '@/lib/api/search';
import { withOrgContext } from '@/lib/db/rls';
import { SCHEDULE_LIST_INCLUDE } from '@/lib/db/schedule-includes';
import { ACTIVE_VISIT_SCHEDULE_STATUSES } from '@/lib/constants/visit';
import { validateOrgReferences } from '@/lib/api/org-reference';
import { validationError } from '@/lib/api/response';
import { enrichSchedulesWithHints } from '@/server/services/schedule-enrichment';
import {
  evaluateVisitWorkflowGate,
  formatVisitWorkflowGateIssues,
} from '@/server/services/management-plans';
import { validateScheduleTimeStringsFitShift } from '@/server/services/visit-schedule-shift';
import type { z } from 'zod';
import type { createVisitScheduleSchema } from '@/lib/validations/visit-schedule';

type CreateScheduleData = z.infer<typeof createVisitScheduleSchema>;

export type ListSchedulesFilters = {
  cursor?: string;
  limit?: number;
  date_from?: string;
  date_to?: string;
  status_scope?: 'active';
  pharmacist_id?: string;
  case_id?: string;
  patient_id?: string;
  sort?: 'scheduled_date' | 'time_window_start' | 'priority' | 'created_at';
  order?: 'asc' | 'desc';
};

export async function listSchedules(
  prisma: PrismaClient,
  orgId: string,
  filters: ListSchedulesFilters
) {
  const cursor = filters.cursor;
  const limit = filters.limit ?? 50;
  const primarySort = buildSort(
    filters.sort,
    filters.order,
    ['scheduled_date', 'time_window_start', 'priority', 'created_at'],
    'scheduled_date'
  );

  const schedules = await prisma.visitSchedule.findMany({
    where: {
      org_id: orgId,
      ...(filters.date_from || filters.date_to
        ? {
            scheduled_date: {
              ...(filters.date_from ? { gte: new Date(filters.date_from) } : {}),
              ...(filters.date_to ? { lte: new Date(filters.date_to) } : {}),
            },
          }
        : {}),
      ...(filters.status_scope === 'active'
        ? {
            schedule_status: {
              in: [...ACTIVE_VISIT_SCHEDULE_STATUSES],
            },
          }
        : {}),
      ...(filters.pharmacist_id ? { pharmacist_id: filters.pharmacist_id } : {}),
      ...(filters.case_id ? { case_id: filters.case_id } : {}),
      ...(filters.patient_id ? { case_: { patient_id: filters.patient_id } } : {}),
    },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    orderBy:
      filters.sort === 'time_window_start'
        ? [
            primarySort ?? { time_window_start: 'asc' },
            { scheduled_date: 'asc' },
            { id: 'asc' },
          ]
        : [
            primarySort ?? { scheduled_date: 'asc' },
            { time_window_start: 'asc' },
            { id: 'asc' },
          ],
    include: SCHEDULE_LIST_INCLUDE,
  });

  const hasMore = schedules.length > limit;
  const data = hasMore ? schedules.slice(0, limit) : schedules;

  return {
    data: enrichSchedulesWithHints(data),
    hasMore,
    nextCursor: hasMore ? data[data.length - 1]?.id : undefined,
  };
}

export async function createSchedule(
  prisma: PrismaClient,
  orgId: string,
  userId: string,
  data: CreateScheduleData
) {
  const {
    site_id,
    priority,
    scheduled_date,
    time_window_start,
    time_window_end,
    notes: _notes,
    ...rest
  } = data;
  void _notes;
  const scheduledDate = new Date(scheduled_date);
  const shift = await prisma.pharmacistShift.findFirst({
    where: {
      org_id: orgId,
      user_id: rest.pharmacist_id,
      date: scheduledDate,
    },
    select: {
      site_id: true,
      available: true,
      available_from: true,
      available_to: true,
    },
  });
  const shiftValidationError = validateScheduleTimeStringsFitShift(
    shift,
    time_window_start,
    time_window_end,
  );
  if (shiftValidationError) {
    return validationError(shiftValidationError);
  }
  const effectiveSiteId = site_id ?? shift?.site_id ?? null;

  const refResult = await validateOrgReferences(orgId, {
    case_id: rest.case_id,
    pharmacist_id: rest.pharmacist_id,
    ...(effectiveSiteId ? { site_id: effectiveSiteId } : {}),
  });
  if (!refResult.ok) return refResult.response;

  const careCase = await prisma.careCase.findFirst({
    where: { id: rest.case_id, org_id: orgId },
    select: {
      patient_id: true,
      primary_pharmacist_id: true,
      patient: {
        select: {
          residences: {
            where: { is_primary: true },
            take: 1,
            select: { facility_unit_id: true },
          },
        },
      },
    },
  });
  if (!careCase) {
    return validationError('ケースが見つかりません');
  }

  const gate = await evaluateVisitWorkflowGate(prisma, {
    orgId,
    patientId: careCase.patient_id,
    caseId: rest.case_id,
    asOf: new Date(scheduled_date),
  });
  if (!gate.ok) {
    return validationError(formatVisitWorkflowGateIssues(gate.issues));
  }

  const facilityUnitId = careCase.patient?.residences[0]?.facility_unit_id ?? null;

  return withOrgContext(orgId, async (tx) => {
    return tx.visitSchedule.create({
      data: {
        org_id: orgId,
        site_id: effectiveSiteId,
        priority: priority ?? 'normal',
        facility_unit_id: facilityUnitId,
        assignment_mode:
          careCase?.primary_pharmacist_id &&
          careCase.primary_pharmacist_id === rest.pharmacist_id
            ? 'primary'
            : 'fallback',
        scheduled_date: scheduledDate,
        ...(time_window_start
          ? { time_window_start: new Date(`1970-01-01T${time_window_start}`) }
          : {}),
        ...(time_window_end
          ? { time_window_end: new Date(`1970-01-01T${time_window_end}`) }
          : {}),
        confirmed_at: new Date(),
        confirmed_by: userId,
        route_order:
          ((await tx.visitSchedule.findFirst({
            where: {
              org_id: orgId,
              pharmacist_id: rest.pharmacist_id,
              scheduled_date: scheduledDate,
              schedule_status: {
                not: 'cancelled',
              },
              route_order: {
                not: null,
              },
            },
            orderBy: { route_order: 'desc' },
            select: { route_order: true },
          }))?.route_order ?? 0) + 1,
        ...rest,
      },
    });
  });
}
