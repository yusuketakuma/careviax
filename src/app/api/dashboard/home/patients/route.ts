import type { Prisma } from '@prisma/client';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { success } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import { listPatientRiskSummaries } from '@/server/services/patient-risk';
import type { PatientCard, DashboardPatientsResponse } from '@/types/dashboard-home';
import { derivePatientStatusIcon } from '@/lib/patient/status-icon';
import {
  applyPatientAssignmentWhere,
  buildCareCaseAssignmentWhere,
  type VisitScheduleAccessContext,
} from '@/lib/auth/visit-schedule-access';

const ACTIVE_CASE_STATUSES = ['assessment', 'active', 'on_hold'] as const;
const PATIENTS_PER_PAGE = 12;

function parsePositiveInteger(value: string | null, fallback: number) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function buildDashboardPatientWhere(
  orgId: string,
  search: string,
  ctx: VisitScheduleAccessContext,
): Prisma.PatientWhereInput {
  return applyPatientAssignmentWhere(
    {
      org_id: orgId,
      ...(search
        ? {
            name: {
              contains: search,
              mode: 'insensitive',
            },
          }
        : {}),
      cases: {
        some: {
          status: { in: [...ACTIVE_CASE_STATUSES] },
        },
      },
    },
    ctx,
  );
}

async function listDashboardPatientIds(
  orgId: string,
  search: string,
  ctx: VisitScheduleAccessContext,
) {
  const patients = await prisma.patient.findMany({
    where: buildDashboardPatientWhere(orgId, search, ctx),
    select: { id: true },
    orderBy: [{ name_kana: 'asc' }, { name: 'asc' }, { id: 'asc' }],
  });

  return patients.map((patient) => patient.id);
}

async function listDashboardPatientIdsPageByName(
  orgId: string,
  search: string,
  page: number,
  ctx: VisitScheduleAccessContext,
) {
  const where = buildDashboardPatientWhere(orgId, search, ctx);
  const [total, patients] = await Promise.all([
    prisma.patient.count({ where }),
    prisma.patient.findMany({
      where,
      select: { id: true },
      orderBy: [{ name_kana: 'asc' }, { name: 'asc' }, { id: 'asc' }],
      skip: (page - 1) * PATIENTS_PER_PAGE,
      take: PATIENTS_PER_PAGE,
    }),
  ]);

  return { total, patientIds: patients.map((patient) => patient.id) };
}

async function listDashboardActiveCases(
  orgId: string,
  patientIds: string[],
  ctx: VisitScheduleAccessContext,
) {
  if (patientIds.length === 0) return [];

  const caseAssignmentWhere = buildCareCaseAssignmentWhere(ctx);
  return prisma.careCase.findMany({
    where: {
      org_id: orgId,
      patient_id: { in: patientIds },
      status: { in: [...ACTIVE_CASE_STATUSES] },
      ...(caseAssignmentWhere ? { AND: [caseAssignmentWhere] } : {}),
    },
    select: {
      id: true,
      patient_id: true,
      status: true,
      care_team_links: {
        where: { role: 'physician' },
        select: { id: true },
        take: 1,
      },
    },
    orderBy: { created_at: 'desc' },
  });
}

async function listDashboardActiveCaseRefs(
  orgId: string,
  patientIds: string[],
  ctx: VisitScheduleAccessContext,
) {
  if (patientIds.length === 0) return [];

  const caseAssignmentWhere = buildCareCaseAssignmentWhere(ctx);
  return prisma.careCase.findMany({
    where: {
      org_id: orgId,
      patient_id: { in: patientIds },
      status: { in: [...ACTIVE_CASE_STATUSES] },
      ...(caseAssignmentWhere ? { AND: [caseAssignmentWhere] } : {}),
    },
    select: {
      id: true,
      patient_id: true,
    },
    orderBy: { created_at: 'desc' },
  });
}

function buildCaseIdsByPatient(cases: Array<{ id: string; patient_id: string }>) {
  const caseIdsByPatient: Record<string, string[]> = {};
  for (const careCase of cases) {
    caseIdsByPatient[careCase.patient_id] = [
      ...(caseIdsByPatient[careCase.patient_id] ?? []),
      careCase.id,
    ];
  }

  return caseIdsByPatient;
}

export const GET = withAuth(
  async (req: AuthenticatedRequest) => {
    const url = new URL(req.url);
    const search = url.searchParams.get('search')?.trim() ?? '';
    const sortBy = url.searchParams.get('sort') === 'name' ? 'name' : 'risk';
    const page = parsePositiveInteger(url.searchParams.get('page'), 1);
    const namedPage =
      sortBy === 'name'
        ? await listDashboardPatientIdsPageByName(req.orgId, search, page, req)
        : null;
    const patientIds =
      namedPage?.patientIds ?? (await listDashboardPatientIds(req.orgId, search, req));

    if (patientIds.length === 0) {
      return success({
        data: { patients: [], total: namedPage?.total ?? 0 } satisfies DashboardPatientsResponse,
      });
    }

    const scopedCaseRefs = await listDashboardActiveCaseRefs(req.orgId, patientIds, req);
    if (scopedCaseRefs.length === 0) {
      return success({
        data: { patients: [], total: namedPage?.total ?? 0 } satisfies DashboardPatientsResponse,
      });
    }
    const caseIdsByPatient = buildCaseIdsByPatient(scopedCaseRefs);

    const riskSummaries = await listPatientRiskSummaries(prisma, {
      orgId: req.orgId,
      patientIds,
      caseIdsByPatient,
      includeStable: true,
    });

    const filtered = [...riskSummaries];

    // Sort
    if (sortBy === 'name') {
      const pageOrder = new Map(patientIds.map((patientId, index) => [patientId, index]));
      filtered.sort(
        (a, b) => (pageOrder.get(a.patient_id) ?? 0) - (pageOrder.get(b.patient_id) ?? 0),
      );
    } else {
      filtered.sort((a, b) => b.score - a.score);
    }

    const total = namedPage?.total ?? filtered.length;
    const paginated =
      namedPage == null
        ? filtered.slice((page - 1) * PATIENTS_PER_PAGE, page * PATIENTS_PER_PAGE)
        : filtered;
    const paginatedPatientIds = paginated.map((p) => p.patient_id);

    if (paginatedPatientIds.length === 0) {
      return success({ data: { patients: [], total } satisfies DashboardPatientsResponse });
    }

    const scopedCases = await listDashboardActiveCases(req.orgId, paginatedPatientIds, req);
    const scopedCaseIds = scopedCases.map((careCase) => careCase.id);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Parallel queries for all needed data
    const [
      patientDetails,
      conditions,
      nextVisits,
      lastVisits,
      firstVisitDocuments,
      lastPrescriptions,
      overdueVisits,
    ] = await Promise.all([
      // Patient basics: birth_date, phone, address
      prisma.patient.findMany({
        where: { id: { in: paginatedPatientIds }, org_id: req.orgId },
        select: {
          id: true,
          birth_date: true,
          phone: true,
          residences: {
            select: { address: true, unit_name: true },
            take: 1,
            orderBy: { created_at: 'desc' },
          },
          contacts: {
            where: { is_emergency_contact: true },
            select: { id: true },
            take: 1,
          },
        },
      }),

      // Active conditions
      prisma.patientCondition.findMany({
        where: {
          org_id: req.orgId,
          patient_id: { in: paginatedPatientIds },
          is_active: true,
        },
        select: {
          patient_id: true,
          name: true,
          is_primary: true,
        },
        orderBy: [{ is_primary: 'desc' }, { created_at: 'asc' }],
      }),

      // Next visits (future)
      prisma.visitSchedule.findMany({
        where: {
          org_id: req.orgId,
          scheduled_date: { gte: today },
          schedule_status: { in: ['planned', 'in_preparation', 'ready'] },
          case_id: { in: scopedCaseIds },
        },
        orderBy: { scheduled_date: 'asc' },
        select: {
          scheduled_date: true,
          visit_type: true,
          case_: { select: { patient_id: true, id: true } },
        },
      }),

      // Last completed visits
      prisma.visitSchedule.findMany({
        where: {
          org_id: req.orgId,
          schedule_status: 'completed',
          case_id: { in: scopedCaseIds },
        },
        orderBy: { scheduled_date: 'desc' },
        select: {
          scheduled_date: true,
          case_: { select: { patient_id: true } },
        },
      }),

      prisma.firstVisitDocument.findMany({
        where: {
          org_id: req.orgId,
          patient_id: { in: paginatedPatientIds },
          case_id: { in: scopedCaseIds },
          delivered_at: { not: null },
        },
        select: {
          patient_id: true,
          case_id: true,
        },
      }),

      // Last prescription (most recent MedicationCycle) + exception_status
      prisma.medicationCycle.findMany({
        where: {
          org_id: req.orgId,
          case_id: { in: scopedCaseIds },
          overall_status: { notIn: ['cancelled'] },
        },
        orderBy: { created_at: 'desc' },
        select: {
          patient_id: true,
          created_at: true,
          overall_status: true,
          exception_status: true,
        },
      }),

      // Overdue visits (scheduled before today, not completed)
      prisma.visitSchedule.findMany({
        where: {
          org_id: req.orgId,
          scheduled_date: { lt: today },
          schedule_status: { in: ['planned', 'in_preparation', 'ready'] },
          case_id: { in: scopedCaseIds },
        },
        select: {
          case_: { select: { patient_id: true } },
        },
      }),
    ]);

    // Build lookup maps
    const detailMap = new Map(patientDetails.map((p) => [p.id, p]));

    const conditionMap = new Map<string, string[]>();
    for (const c of conditions) {
      const list = conditionMap.get(c.patient_id) ?? [];
      list.push(c.name);
      conditionMap.set(c.patient_id, list);
    }

    const nextVisitMap = new Map<string, { date: string; type: string; caseId: string }>();
    for (const v of nextVisits) {
      const pid = v.case_.patient_id;
      if (!nextVisitMap.has(pid)) {
        nextVisitMap.set(pid, {
          date: v.scheduled_date.toISOString().slice(0, 10),
          type: v.visit_type,
          caseId: v.case_.id,
        });
      }
    }

    const lastVisitMap = new Map<string, string>();
    for (const v of lastVisits) {
      const pid = v.case_.patient_id;
      if (!lastVisitMap.has(pid)) {
        lastVisitMap.set(pid, v.scheduled_date.toISOString().slice(0, 10));
      }
    }

    const caseMap = new Map<string, { id: string; status: string; hasPrimaryPhysician: boolean }>();
    for (const c of scopedCases) {
      if (!caseMap.has(c.patient_id)) {
        caseMap.set(c.patient_id, {
          id: c.id,
          status: c.status,
          hasPrimaryPhysician: c.care_team_links.length > 0,
        });
      }
    }

    const deliveredDocCaseIds = new Set(firstVisitDocuments.map((doc) => doc.case_id));

    const lastRxMap = new Map<string, string>();
    const nextRxMap = new Map<string, string>();
    const exceptionMap = new Map<string, string>();
    const recentMedChangeSet = new Set<string>();
    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    for (const rx of lastPrescriptions) {
      const pid = rx.patient_id;
      if (!lastRxMap.has(pid)) {
        lastRxMap.set(pid, rx.created_at.toISOString().slice(0, 10));
      }
      if (!nextRxMap.has(pid) && !['reported', 'cancelled'].includes(rx.overall_status)) {
        nextRxMap.set(pid, rx.created_at.toISOString().slice(0, 10));
      }
      if (rx.exception_status && !exceptionMap.has(pid)) {
        exceptionMap.set(pid, rx.exception_status);
      }
      // Detect recent med change: cycle created within last 7 days
      if (rx.created_at >= sevenDaysAgo && !['intake_received'].includes(rx.overall_status)) {
        recentMedChangeSet.add(pid);
      }
    }

    const overdueSet = new Set<string>();
    for (const v of overdueVisits) {
      overdueSet.add(v.case_.patient_id);
    }

    const patients: PatientCard[] = paginated.map((p) => {
      const detail = detailMap.get(p.patient_id);
      const nv = nextVisitMap.get(p.patient_id);
      const caseInfo = caseMap.get(p.patient_id);
      const residence = detail?.residences[0];
      const addr = residence
        ? residence.unit_name
          ? `${residence.address} ${residence.unit_name}`
          : residence.address
        : null;

      return {
        patient_id: p.patient_id,
        patient_name: p.patient_name,
        birth_date: detail?.birth_date.toISOString().slice(0, 10) ?? '',
        address: addr,
        phone: detail?.phone ?? null,
        conditions: (conditionMap.get(p.patient_id) ?? []).slice(0, 3),
        last_prescription_date: lastRxMap.get(p.patient_id) ?? null,
        last_visit_date: lastVisitMap.get(p.patient_id) ?? null,
        next_prescription_date: nextRxMap.get(p.patient_id) ?? null,
        next_visit_date: nv?.date ?? null,
        next_visit_type: nv?.type ?? null,
        case_id: caseInfo?.id ?? null,
        status_icon: derivePatientStatusIcon({
          score: p.score,
          level: p.level,
          open_tasks: p.open_tasks,
          pending_reports: p.pending_reports,
          hasCompletedVisit: lastVisitMap.has(p.patient_id),
          hasNextVisit: nextVisitMap.has(p.patient_id),
          hasOverdueVisit: overdueSet.has(p.patient_id),
          hasRecentMedChange: recentMedChangeSet.has(p.patient_id),
          hasUnresolvedSelfReports: p.unresolved_self_reports > 0,
          caseStatus: caseInfo?.status ?? null,
          exceptionStatus: exceptionMap.get(p.patient_id) ?? null,
        }),
        readiness_flags: {
          missing_emergency_contact: (detail?.contacts.length ?? 0) === 0,
          missing_primary_physician: caseInfo ? !caseInfo.hasPrimaryPhysician : false,
          missing_first_visit_doc: caseInfo ? !deliveredDocCaseIds.has(caseInfo.id) : false,
        },
      };
    });

    return success({ data: { patients, total } satisfies DashboardPatientsResponse });
  },
  {
    permission: 'canViewDashboard',
    message: 'ダッシュボードの閲覧権限がありません',
  },
);
