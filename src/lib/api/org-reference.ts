import { validationError } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';

export type OrgReferenceInput = {
  patient_id?: string | null;
  case_id?: string | null;
  visit_record_id?: string | null;
  issue_id?: string | null;
  cycle_id?: string | null;
  plan_id?: string | null;
  task_id?: string | null;
  site_id?: string | null;
  pharmacist_id?: string | null;
  schedule_id?: string | null;
  line_ids?: string[];
};

type PatientRef = { id: string };
type CareCaseRef = { id: string; patient_id: string };
type VisitRecordRef = { id: string; patient_id: string };
type IssueRef = { id: string; patient_id: string; case_id: string | null };
type CycleRef = { id: string; patient_id: string; case_id: string | null; overall_status?: string };
type PlanRef = { id: string; cycle_id: string };
type TaskRef = { id: string; cycle_id: string };
type SiteRef = { id: string };
type MembershipRef = { user_id: string };
type ScheduleRef = { id: string; case_id: string; cycle_id: string | null };

export type OrgReferenceData = {
  patient: PatientRef | null;
  careCase: CareCaseRef | null;
  visitRecord: VisitRecordRef | null;
  issue: IssueRef | null;
  cycle: CycleRef | null;
  plan: PlanRef | null;
  task: TaskRef | null;
  site: SiteRef | null;
  pharmacistMembership: MembershipRef | null;
  schedule: ScheduleRef | null;
};

export async function validateOrgReferences(
  orgId: string,
  refs: OrgReferenceInput
): Promise<
  | { ok: true; data: OrgReferenceData }
  | { ok: false; response: ReturnType<typeof validationError> }
> {
  const [
    patient,
    careCase,
    visitRecord,
    issue,
    cycle,
    plan,
    task,
    site,
    pharmacistMembership,
    schedule,
  ] = await Promise.all([
    refs.patient_id
      ? prisma.patient.findFirst({
          where: { id: refs.patient_id, org_id: orgId },
          select: { id: true },
        })
      : Promise.resolve(null),
    refs.case_id
      ? prisma.careCase.findFirst({
          where: { id: refs.case_id, org_id: orgId },
          select: { id: true, patient_id: true },
        })
      : Promise.resolve(null),
    refs.visit_record_id
      ? prisma.visitRecord.findFirst({
          where: { id: refs.visit_record_id, org_id: orgId },
          select: { id: true, patient_id: true },
        })
      : Promise.resolve(null),
    refs.issue_id
      ? prisma.medicationIssue.findFirst({
          where: { id: refs.issue_id, org_id: orgId },
          select: { id: true, patient_id: true, case_id: true },
        })
      : Promise.resolve(null),
    refs.cycle_id
      ? prisma.medicationCycle.findFirst({
          where: { id: refs.cycle_id, org_id: orgId },
          select: { id: true, patient_id: true, case_id: true, overall_status: true },
        })
      : Promise.resolve(null),
    refs.plan_id
      ? prisma.setPlan.findFirst({
          where: { id: refs.plan_id, org_id: orgId },
          select: { id: true, cycle_id: true },
        })
      : Promise.resolve(null),
    refs.task_id
      ? prisma.dispenseTask.findFirst({
          where: { id: refs.task_id, org_id: orgId },
          select: { id: true, cycle_id: true },
        })
      : Promise.resolve(null),
    refs.site_id
      ? prisma.pharmacySite.findFirst({
          where: { id: refs.site_id, org_id: orgId },
          select: { id: true },
        })
      : Promise.resolve(null),
    refs.pharmacist_id
      ? prisma.membership.findFirst({
          where: {
            user_id: refs.pharmacist_id,
            org_id: orgId,
            is_active: true,
            role: {
              in: ['owner', 'admin', 'pharmacist', 'pharmacist_trainee'],
            },
          },
          select: { user_id: true },
        })
      : Promise.resolve(null),
    refs.schedule_id
      ? prisma.visitSchedule.findFirst({
          where: { id: refs.schedule_id, org_id: orgId },
          select: { id: true, case_id: true, cycle_id: true },
        })
      : Promise.resolve(null),
  ]);

  if (refs.patient_id && !patient) {
    return { ok: false, response: validationError('指定された患者が見つかりません') };
  }
  if (refs.case_id && !careCase) {
    return { ok: false, response: validationError('指定されたケースが見つかりません') };
  }
  if (refs.visit_record_id && !visitRecord) {
    return { ok: false, response: validationError('指定された訪問記録が見つかりません') };
  }
  if (refs.issue_id && !issue) {
    return { ok: false, response: validationError('指定された課題が見つかりません') };
  }
  if (refs.cycle_id && !cycle) {
    return { ok: false, response: validationError('指定されたサイクルが見つかりません') };
  }
  if (refs.plan_id && !plan) {
    return { ok: false, response: validationError('指定されたセットプランが見つかりません') };
  }
  if (refs.task_id && !task) {
    return { ok: false, response: validationError('指定された調剤タスクが見つかりません') };
  }
  if (refs.site_id && !site) {
    return { ok: false, response: validationError('指定された店舗が見つかりません') };
  }
  if (refs.pharmacist_id && !pharmacistMembership) {
    return {
      ok: false,
      response: validationError('指定された薬剤師はこの組織に所属していません'),
    };
  }
  if (refs.schedule_id && !schedule) {
    return { ok: false, response: validationError('指定されたスケジュールが見つかりません') };
  }

  if (patient && careCase && careCase.patient_id !== patient.id) {
    return { ok: false, response: validationError('指定されたケースは患者に紐づいていません') };
  }
  if (patient && visitRecord && visitRecord.patient_id !== patient.id) {
    return {
      ok: false,
      response: validationError('指定された訪問記録は患者に紐づいていません'),
    };
  }
  if (patient && issue && issue.patient_id !== patient.id) {
    return { ok: false, response: validationError('指定された課題は患者に紐づいていません') };
  }
  if (careCase && issue && issue.case_id && issue.case_id !== careCase.id) {
    return { ok: false, response: validationError('指定された課題はケースに紐づいていません') };
  }
  if (patient && cycle && cycle.patient_id !== patient.id) {
    return { ok: false, response: validationError('指定されたサイクルは患者に紐づいていません') };
  }
  if (careCase && cycle && cycle.case_id && cycle.case_id !== careCase.id) {
    return { ok: false, response: validationError('指定されたサイクルはケースに紐づいていません') };
  }
  if (cycle && plan && plan.cycle_id !== cycle.id) {
    return {
      ok: false,
      response: validationError('指定されたセットプランはサイクルに紐づいていません'),
    };
  }
  if (cycle && task && task.cycle_id !== cycle.id) {
    return {
      ok: false,
      response: validationError('指定された調剤タスクはサイクルに紐づいていません'),
    };
  }
  if (careCase && schedule && schedule.case_id !== careCase.id) {
    return {
      ok: false,
      response: validationError('指定されたスケジュールはケースに紐づいていません'),
    };
  }

  if (schedule && patient) {
    const scheduleCase =
      careCase && careCase.id === schedule.case_id
        ? careCase
        : await prisma.careCase.findFirst({
            where: { id: schedule.case_id, org_id: orgId },
            select: { id: true, patient_id: true },
          });

    if (!scheduleCase || scheduleCase.patient_id !== patient.id) {
      return {
        ok: false,
        response: validationError('指定されたスケジュールは患者に紐づいていません'),
      };
    }
  }

  if (refs.line_ids?.length) {
    const uniqueLineIds = [...new Set(refs.line_ids)];
    const lines = await prisma.prescriptionLine.findMany({
      where: {
        id: { in: uniqueLineIds },
        org_id: orgId,
      },
      select: {
        id: true,
        intake: {
          select: { cycle_id: true },
        },
      },
    });

    if (lines.length !== uniqueLineIds.length) {
      return { ok: false, response: validationError('指定された処方明細が見つかりません') };
    }

    const expectedCycleId = task?.cycle_id ?? cycle?.id ?? schedule?.cycle_id ?? undefined;
    if (expectedCycleId && lines.some((line) => line.intake.cycle_id !== expectedCycleId)) {
      return {
        ok: false,
        response: validationError('指定された処方明細が参照先と一致しません'),
      };
    }
  }

  return {
    ok: true,
    data: {
      patient,
      careCase,
      visitRecord,
      issue,
      cycle,
      plan,
      task,
      site,
      pharmacistMembership,
      schedule,
    },
  };
}
