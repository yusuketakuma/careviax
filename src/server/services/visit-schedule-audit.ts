import { Prisma, type PatientContactStatus, type VisitSchedule } from '@prisma/client';

type ScheduleSnapshotInput = Pick<
  VisitSchedule,
  | 'id'
  | 'case_id'
  | 'cycle_id'
  | 'site_id'
  | 'visit_type'
  | 'priority'
  | 'schedule_status'
  | 'scheduled_date'
  | 'time_window_start'
  | 'time_window_end'
  | 'pharmacist_id'
  | 'assignment_mode'
  | 'route_order'
  | 'vehicle_resource_id'
  | 'confirmed_at'
  | 'confirmed_by'
>;

export function buildVisitScheduleSnapshot(schedule: ScheduleSnapshotInput) {
  return {
    id: schedule.id,
    case_id: schedule.case_id,
    cycle_id: schedule.cycle_id,
    site_id: schedule.site_id,
    visit_type: schedule.visit_type,
    priority: schedule.priority,
    schedule_status: schedule.schedule_status,
    scheduled_date: schedule.scheduled_date.toISOString(),
    time_window_start: schedule.time_window_start?.toISOString() ?? null,
    time_window_end: schedule.time_window_end?.toISOString() ?? null,
    pharmacist_id: schedule.pharmacist_id,
    assignment_mode: schedule.assignment_mode,
    route_order: schedule.route_order,
    vehicle_resource_id: schedule.vehicle_resource_id,
    confirmed_at: schedule.confirmed_at?.toISOString() ?? null,
    confirmed_by: schedule.confirmed_by ?? null,
  } satisfies Prisma.InputJsonValue;
}

export async function createVisitScheduleContactLog(
  tx: Prisma.TransactionClient,
  params: {
    orgId: string;
    proposalId: string;
    scheduleId?: string | null;
    patientId: string;
    caseId: string;
    outcome: PatientContactStatus;
    contactMethod?: string | null;
    contactName?: string | null;
    contactPhone?: string | null;
    note?: string | null;
    callbackDueAt?: Date | null;
    idempotencyKey?: string | null;
    requestFingerprint?: string | null;
    calledAt?: Date;
    calledBy: string;
  },
) {
  return tx.visitScheduleContactLog.create({
    data: {
      org_id: params.orgId,
      proposal_id: params.proposalId,
      schedule_id: params.scheduleId ?? null,
      patient_id: params.patientId,
      case_id: params.caseId,
      outcome: params.outcome,
      contact_method: params.contactMethod ?? null,
      contact_name: params.contactName ?? null,
      contact_phone: params.contactPhone ?? null,
      note: params.note ?? null,
      callback_due_at: params.callbackDueAt ?? null,
      idempotency_key: params.idempotencyKey ?? null,
      request_fingerprint: params.requestFingerprint ?? null,
      called_at: params.calledAt ?? new Date(),
      called_by: params.calledBy,
    },
  });
}
