import type { PatientStatusIcon } from '@/types/dashboard-home';

type RiskSummaryLike = {
  score: number;
  level: 'stable' | 'watch' | 'high';
  pending_reports: number;
  open_tasks: number;
  unresolved_self_reports: number;
} | null;

type CaseLike = {
  status: string;
};

type VisitScheduleLike = {
  scheduled_date: string;
  schedule_status: string;
  visit_record: { id: string; outcome_status: string } | null;
};

type PatientStatusSource = {
  risk_summary: RiskSummaryLike;
  cases: CaseLike[];
  visit_schedules: VisitScheduleLike[];
};

export function deriveStatusFromPatient(
  patient: PatientStatusSource,
  now = new Date()
): PatientStatusIcon {
  const risk = patient.risk_summary;
  const activeCase = patient.cases.find((c) =>
    ['assessment', 'active', 'on_hold'].includes(c.status)
  );
  const hasCompletedVisit = patient.visit_schedules.some(
    (v) => v.schedule_status === 'completed'
  );
  const hasNextVisit = patient.visit_schedules.some(
    (v) =>
      ['planned', 'in_preparation', 'ready'].includes(v.schedule_status) &&
      new Date(v.scheduled_date) >= now
  );
  const hasOverdueVisit = patient.visit_schedules.some(
    (v) =>
      ['planned', 'in_preparation', 'ready'].includes(v.schedule_status) &&
      new Date(v.scheduled_date) < now
  );

  if (activeCase?.status === 'on_hold') return 'paused';
  if (risk && (risk.level === 'high' || risk.score >= 7)) return 'urgent';
  if (hasOverdueVisit) return 'overdue_visit';
  if (risk && risk.pending_reports > 0) return 'report_pending';
  if (!hasCompletedVisit && hasNextVisit) return 'first_visit_soon';
  if (!hasCompletedVisit) return 'new';
  if (
    risk &&
    (risk.level === 'watch' ||
      risk.open_tasks > 0 ||
      risk.unresolved_self_reports > 0)
  ) {
    return 'attention';
  }
  return 'stable';
}

export function selectNextVisit<T extends VisitScheduleLike>(
  visitSchedules: T[]
): T | null {
  const pendingSchedules = [...visitSchedules]
    .filter((schedule) => !schedule.visit_record)
    .sort(
      (left, right) =>
        new Date(left.scheduled_date).getTime() -
        new Date(right.scheduled_date).getTime()
    );

  if (pendingSchedules.length > 0) {
    return pendingSchedules[0] ?? null;
  }

  const sortedSchedules = [...visitSchedules].sort(
    (left, right) =>
      new Date(left.scheduled_date).getTime() -
      new Date(right.scheduled_date).getTime()
  );
  return sortedSchedules[0] ?? null;
}
