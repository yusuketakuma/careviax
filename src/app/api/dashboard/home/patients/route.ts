import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { success } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import { listPatientRiskSummaries } from '@/server/services/patient-risk';
import type { PatientCard, DashboardPatientsResponse } from '@/types/dashboard-home';
import { derivePatientStatusIcon } from '@/lib/patient/status-icon';

const ACTIVE_CASE_STATUSES = ['assessment', 'active', 'on_hold'] as const;
const PATIENTS_PER_PAGE = 12;

function parsePositiveInteger(value: string | null, fallback: number) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function listDashboardPatientIds(orgId: string, search: string) {
  const patients = await prisma.patient.findMany({
    where: {
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
    select: { id: true },
    orderBy: [{ name_kana: 'asc' }, { name: 'asc' }],
  });

  return patients.map((patient) => patient.id);
}

export const GET = withAuth(async (req: AuthenticatedRequest) => {
  const url = new URL(req.url);
  const search = url.searchParams.get('search')?.trim() ?? '';
  const sortBy = url.searchParams.get('sort') === 'name' ? 'name' : 'risk';
  const page = parsePositiveInteger(url.searchParams.get('page'), 1);
  const patientIds = await listDashboardPatientIds(req.orgId, search);

  if (patientIds.length === 0) {
    return success({ data: { patients: [], total: 0 } satisfies DashboardPatientsResponse });
  }

  const riskSummaries = await listPatientRiskSummaries(prisma, {
    orgId: req.orgId,
    patientIds,
    includeStable: true,
  });

  const filtered = [...riskSummaries];

  // Sort
  if (sortBy === 'name') {
    filtered.sort((a, b) => a.patient_name.localeCompare(b.patient_name, 'ja'));
  } else {
    filtered.sort((a, b) => b.score - a.score);
  }

  const total = filtered.length;
  const paginated = filtered.slice((page - 1) * PATIENTS_PER_PAGE, page * PATIENTS_PER_PAGE);
  const paginatedPatientIds = paginated.map((p) => p.patient_id);

  if (paginatedPatientIds.length === 0) {
    return success({ data: { patients: [], total } satisfies DashboardPatientsResponse });
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Parallel queries for all needed data
  const [
    patientDetails,
    conditions,
    nextVisits,
    lastVisits,
    cases,
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
        case_: { patient_id: { in: paginatedPatientIds } },
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
        case_: { patient_id: { in: paginatedPatientIds } },
      },
      orderBy: { scheduled_date: 'desc' },
      select: {
        scheduled_date: true,
        case_: { select: { patient_id: true } },
      },
    }),

    // Active cases (with exception_status from latest cycle)
    prisma.careCase.findMany({
      where: {
        org_id: req.orgId,
        patient_id: { in: paginatedPatientIds },
        status: { in: [...ACTIVE_CASE_STATUSES] },
      },
      select: { id: true, patient_id: true, status: true },
      orderBy: { created_at: 'desc' },
    }),

    // Last prescription (most recent MedicationCycle) + exception_status
    prisma.medicationCycle.findMany({
      where: {
        org_id: req.orgId,
        patient_id: { in: paginatedPatientIds },
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
        case_: { patient_id: { in: paginatedPatientIds } },
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

  const caseMap = new Map<string, { id: string; status: string }>();
  for (const c of cases) {
    if (!caseMap.has(c.patient_id)) {
      caseMap.set(c.patient_id, { id: c.id, status: c.status });
    }
  }

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
    };
  });

  return success({ data: { patients, total } satisfies DashboardPatientsResponse });
});
