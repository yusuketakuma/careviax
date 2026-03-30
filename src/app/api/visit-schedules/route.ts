import { z } from 'zod';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError } from '@/lib/api/response';
import { buildSort } from '@/lib/api/search';
import { parseSearchParams } from '@/lib/api/validation';
import { createVisitScheduleSchema } from '@/lib/validations/visit-schedule';
import { validateOrgReferences } from '@/lib/api/org-reference';
import { prisma } from '@/lib/db/client';
import {
  evaluateVisitWorkflowGate,
  formatVisitWorkflowGateIssues,
} from '@/server/services/management-plans';

const optionalDateParam = z
  .string()
  .trim()
  .refine((value) => !Number.isNaN(Date.parse(value)), '日付形式が不正です')
  .optional();

const visitScheduleQuerySchema = z.object({
  cursor: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  date_from: optionalDateParam,
  date_to: optionalDateParam,
  pharmacist_id: z.string().trim().optional(),
  case_id: z.string().trim().optional(),
  patient_id: z.string().trim().optional(),
  sort: z.enum(['scheduled_date', 'time_window_start', 'priority', 'created_at']).optional(),
  order: z.enum(['asc', 'desc']).optional(),
});

export const GET = withAuth(async (req: AuthenticatedRequest) => {
  const { searchParams } = new URL(req.url);
  const parsed = parseSearchParams(visitScheduleQuerySchema, searchParams);
  if (!parsed.ok) {
    return validationError('クエリパラメータが不正です', parsed.error.flatten().fieldErrors);
  }
  const cursor = parsed.data.cursor;
  const limit = parsed.data.limit ?? 50;

  const dateFrom = parsed.data.date_from;
  const dateTo = parsed.data.date_to;
  const pharmacistId = parsed.data.pharmacist_id;
  const caseId = parsed.data.case_id;
  const patientId = parsed.data.patient_id;
  const primarySort = buildSort(
    parsed.data.sort,
    parsed.data.order,
    ['scheduled_date', 'time_window_start', 'priority', 'created_at'],
    'scheduled_date'
  );

  const where = {
    org_id: req.orgId,
    ...(dateFrom || dateTo
      ? {
          scheduled_date: {
            ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
            ...(dateTo ? { lte: new Date(dateTo) } : {}),
          },
        }
      : {}),
    ...(pharmacistId ? { pharmacist_id: pharmacistId } : {}),
    ...(caseId ? { case_id: caseId } : {}),
    ...(patientId
      ? {
          case_: {
            patient_id: patientId,
          },
        }
      : {}),
  };

  const schedules = await prisma.visitSchedule.findMany({
    where,
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    orderBy:
      parsed.data.sort === 'time_window_start'
        ? [primarySort ?? { scheduled_date: 'asc' }, { scheduled_date: 'asc' }]
        : [primarySort ?? { scheduled_date: 'asc' }, { time_window_start: 'asc' }],
    include: {
      visit_record: { select: { id: true, outcome_status: true } },
      facility_batch: {
        select: {
          id: true,
        },
      },
      preparation: {
        select: {
          id: true,
          prepared_at: true,
          medication_changes_reviewed: true,
          carry_items_confirmed: true,
          previous_issues_reviewed: true,
          route_confirmed: true,
          offline_synced: true,
          checklist: true,
        },
      },
      override_request: {
        select: {
          id: true,
          status: true,
          reason: true,
          requested_at: true,
          approved_at: true,
          approved_by: true,
          impact_summary: true,
        },
      },
      applied_override: {
        select: {
          id: true,
          reason: true,
          requested_at: true,
          approved_at: true,
          source_schedule: {
            select: {
              id: true,
              scheduled_date: true,
              time_window_start: true,
              time_window_end: true,
              pharmacist_id: true,
            },
          },
        },
      },
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
                  building_id: true,
                  unit_name: true,
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
          lat: true,
          lng: true,
        },
      },
    },
  });

  const hasMore = schedules.length > limit;
  const data = hasMore ? schedules.slice(0, limit) : schedules;

  const dailyWorkload = new Map<
    string,
    { count: number; urgentCount: number }
  >();
  const facilityGroups = new Map<
    string,
    { label: string; patientNames: string[] }
  >();

  for (const schedule of data) {
    const workloadKey = `${schedule.pharmacist_id}:${schedule.scheduled_date.toISOString().slice(0, 10)}`;
    const existingWorkload = dailyWorkload.get(workloadKey);
    if (existingWorkload) {
      existingWorkload.count += 1;
      if (schedule.priority !== 'normal') existingWorkload.urgentCount += 1;
    } else {
      dailyWorkload.set(workloadKey, {
        count: 1,
        urgentCount: schedule.priority !== 'normal' ? 1 : 0,
      });
    }

    const residence = schedule.case_.patient.residences[0];
    const facilityLabel = residence?.building_id ?? residence?.address ?? null;
    if (!facilityLabel) continue;
    const facilityKey = [
      schedule.scheduled_date.toISOString().slice(0, 10),
      schedule.pharmacist_id,
      schedule.site?.id ?? 'site:none',
      facilityLabel,
    ].join(':');
    const existingFacilityGroup = facilityGroups.get(facilityKey);
    if (existingFacilityGroup) {
      existingFacilityGroup.patientNames.push(schedule.case_.patient.name);
    } else {
      facilityGroups.set(facilityKey, {
        label: facilityLabel,
        patientNames: [schedule.case_.patient.name],
      });
    }
  }

  const enrichedData = data.map((schedule) => {
    const workloadKey = `${schedule.pharmacist_id}:${schedule.scheduled_date.toISOString().slice(0, 10)}`;
    const residence = schedule.case_.patient.residences[0];
    const facilityLabel = residence?.building_id ?? residence?.address ?? null;
    const facilityKey = facilityLabel
      ? [
          schedule.scheduled_date.toISOString().slice(0, 10),
          schedule.pharmacist_id,
          schedule.site?.id ?? 'site:none',
          facilityLabel,
        ].join(':')
      : null;
    const facilityGroup = facilityKey ? facilityGroups.get(facilityKey) : null;
    const handoffReasons = [
      ...(schedule.assignment_mode === 'fallback' ? ['代替担当での訪問です'] : []),
      ...(schedule.override_request?.status === 'pending'
        ? ['確定予定の変更承認待ちです']
        : []),
      ...(schedule.applied_override ? ['例外変更から再構成された予定です'] : []),
      ...(!schedule.preparation?.prepared_at ? ['訪問準備が未完了です'] : []),
    ];

    return {
      ...schedule,
      facility_batch_id: schedule.facility_batch?.id ?? null,
      facility_hint:
        facilityGroup && facilityGroup.patientNames.length > 1
          ? {
              label: facilityGroup.label,
              patient_count: facilityGroup.patientNames.length,
              patient_names: facilityGroup.patientNames,
            }
          : null,
      workload_hint: {
        daily_visit_count: dailyWorkload.get(workloadKey)?.count ?? 1,
        urgent_visit_count: dailyWorkload.get(workloadKey)?.urgentCount ?? 0,
      },
      handoff_hint:
        handoffReasons.length > 0
          ? {
              summary: handoffReasons.join(' / '),
            }
          : null,
    };
  });
  const nextCursor = hasMore ? data[data.length - 1]?.id : undefined;

  return success({ data: enrichedData, hasMore, nextCursor });
}, {
  permission: 'canVisit',
  message: '訪問予定の閲覧権限がありません',
});

export const POST = withAuth(async (req: AuthenticatedRequest) => {
  const body = await req.json().catch(() => null);
  if (!body) return validationError('リクエストボディが不正です');

  const parsed = createVisitScheduleSchema.safeParse(body);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const {
    site_id,
    priority,
    scheduled_date,
    time_window_start,
    time_window_end,
    notes: _notes,
    ...rest
  } = parsed.data;
  void _notes;

  const refResult = await validateOrgReferences(req.orgId, {
    case_id: rest.case_id,
    pharmacist_id: rest.pharmacist_id,
    ...(site_id ? { site_id } : {}),
  });
  if (!refResult.ok) return refResult.response;

  const careCase = await prisma.careCase.findFirst({
    where: {
      id: rest.case_id,
      org_id: req.orgId,
    },
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
    orgId: req.orgId,
    patientId: careCase.patient_id,
    caseId: rest.case_id,
    asOf: new Date(scheduled_date),
  });
  if (!gate.ok) {
    return validationError(formatVisitWorkflowGateIssues(gate.issues));
  }

  const facilityUnitId = careCase.patient?.residences[0]?.facility_unit_id ?? null;

  const schedule = await withOrgContext(req.orgId, async (tx) => {
    return tx.visitSchedule.create({
      data: {
        org_id: req.orgId,
        site_id: site_id ?? null,
        priority: priority ?? 'normal',
        facility_unit_id: facilityUnitId,
        assignment_mode:
          careCase?.primary_pharmacist_id &&
          careCase.primary_pharmacist_id === rest.pharmacist_id
            ? 'primary'
            : 'fallback',
        scheduled_date: new Date(scheduled_date),
        ...(time_window_start ? { time_window_start: new Date(`1970-01-01T${time_window_start}`) } : {}),
        ...(time_window_end ? { time_window_end: new Date(`1970-01-01T${time_window_end}`) } : {}),
        confirmed_at: new Date(),
        confirmed_by: req.userId,
        ...rest,
      },
    });
  });

  return success(schedule, 201);
}, {
  permission: 'canVisit',
  message: '訪問予定の作成権限がありません',
});
