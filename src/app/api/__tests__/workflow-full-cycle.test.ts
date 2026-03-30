import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

type TestState = {
  patient: {
    id: string;
    name: string;
    name_kana: string;
    birth_date: Date;
    gender: string;
    address: string | null;
    building_id: string | null;
    unit_name: string | null;
  };
  cycle: {
    id: string;
    patient_id: string;
    overall_status: string;
    exception_status: string | null;
  };
  intake: null | {
    id: string;
    source_type: string;
    prescribed_date: Date;
    lines: Array<{
      id: string;
      line_number: number;
      drug_name: string;
      drug_code: string | null;
      dose: string;
      frequency: string;
      days: number;
      quantity: number;
      unit: string | null;
    }>;
  };
  inquiry: {
    id: string;
    cycle_id: string;
    line_id: string | null;
    issue_id: string | null;
    result: 'pending' | 'changed' | 'unchanged' | null;
    change_detail: string | null;
    resolved_at: Date | null;
  } | null;
  dispenseTask: {
    id: string;
    cycle_id: string;
    status: string;
    assigned_to: string | null;
    due_date: Date | null;
    priority: string;
  };
  dispenseResults: Array<{
    id: string;
    line_id: string;
    actual_drug_name: string;
    actual_drug_code: string | null;
    actual_quantity: number;
    actual_unit: string | null;
    carry_type: 'carry' | 'facility_deposit' | 'deferred';
    special_notes: string | null;
    dispensed_at: Date;
  }>;
  visitSchedule: {
    id: string;
    case_id: string;
    cycle_id: string;
    schedule_status: string;
    visit_type: string;
    recurrence_rule: string | null;
    medication_end_date: Date | null;
    visit_deadline_date: Date | null;
    carry_items: Array<Record<string, unknown>>;
    carry_items_status: string | null;
  };
  careCase: {
    id: string;
    patient_id: string;
  };
  visitRecord: null | {
    id: string;
    schedule_id: string;
    patient_id: string;
    visit_date: Date;
    outcome_status: string;
    version: number;
  };
  careReports: Array<{
    id: string;
    visit_record_id: string;
    report_type: string;
    status: string;
    pdf_url: string;
  }>;
  deliveryRecords: Array<{
    id: string;
    report_id: string;
    channel: string;
    status: string;
    recipient_name: string;
    recipient_contact: string;
  }>;
  notifications: Array<Record<string, unknown>>;
  workflowExceptions: Array<Record<string, unknown>>;
  billingEvidenceUpserts: string[];
};

const {
  withAuthMock,
  requireAuthContextMock,
  withOrgContextMock,
  patientFindFirstMock,
  careCaseFindFirstMock,
  pharmacistShiftFindFirstMock,
  prismaVisitScheduleFindFirstMock,
  inquiryRecordFindFirstMock,
  careReportFindFirstMock,
  dispatchNotificationEventMock,
  upsertOperationalTaskMock,
  resolveOperationalTasksMock,
  upsertBillingEvidenceForVisitMock,
  generateReportsFromVisitMock,
  sendCareReportEmailMock,
} = vi.hoisted(() => ({
  withAuthMock: vi.fn(
    (
      handler: (
        req: NextRequest & { orgId: string; userId: string; role: string }
      ) => Promise<Response>
    ) => {
      return (req: NextRequest) =>
        handler({
          ...req,
          orgId: 'org_1',
          userId: 'user_1',
          role: 'pharmacist',
        } as NextRequest & { orgId: string; userId: string; role: string });
    }
  ),
  requireAuthContextMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  patientFindFirstMock: vi.fn(),
  careCaseFindFirstMock: vi.fn(),
  pharmacistShiftFindFirstMock: vi.fn(),
  prismaVisitScheduleFindFirstMock: vi.fn(),
  inquiryRecordFindFirstMock: vi.fn(),
  careReportFindFirstMock: vi.fn(),
  dispatchNotificationEventMock: vi.fn(),
  upsertOperationalTaskMock: vi.fn(),
  resolveOperationalTasksMock: vi.fn(),
  upsertBillingEvidenceForVisitMock: vi.fn(),
  generateReportsFromVisitMock: vi.fn(),
  sendCareReportEmailMock: vi.fn(),
}));

vi.mock('@/lib/auth/middleware', () => ({
  withAuth: withAuthMock,
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    patient: {
      findFirst: patientFindFirstMock,
    },
    careCase: {
      findFirst: careCaseFindFirstMock,
    },
    pharmacistShift: {
      findFirst: pharmacistShiftFindFirstMock,
    },
    visitSchedule: {
      findFirst: prismaVisitScheduleFindFirstMock,
    },
    inquiryRecord: {
      findFirst: inquiryRecordFindFirstMock,
    },
    careReport: {
      findFirst: careReportFindFirstMock,
    },
  },
}));

vi.mock('@/server/services/notifications', () => ({
  dispatchNotificationEvent: dispatchNotificationEventMock,
}));

vi.mock('@/server/services/operational-tasks', () => ({
  upsertOperationalTask: upsertOperationalTaskMock,
  resolveOperationalTasks: resolveOperationalTasksMock,
}));

vi.mock('@/server/services/billing-evidence', () => ({
  upsertBillingEvidenceForVisit: upsertBillingEvidenceForVisitMock,
}));

vi.mock('@/server/services/report-generator', () => ({
  generateReportsFromVisit: generateReportsFromVisitMock,
}));

vi.mock('@/server/services/report-delivery', () => ({
  sendCareReportEmail: sendCareReportEmailMock,
}));

import { POST as createPrescriptionIntake } from '../prescription-intakes/route';
import { POST as createPatient } from '../patients/route';
import { POST as createCareCase } from '../cases/route';
import { POST as generateVisitSchedules } from '../visit-schedules/generate/route';
import { PUT as upsertVisitPreparation } from '../visit-preparations/[scheduleId]/route';
import { PATCH as updateInquiryRecord } from '../inquiry-records/[id]/route';
import { POST as createDispenseResults } from '../dispense-results/route';
import { POST as createDispenseAudit } from '../dispense-audits/route';
import { POST as createVisitRecord } from '../visit-records/route';
import { POST as generateCareReports } from '../care-reports/generate-from-visit/route';
import { POST as sendCareReport } from '../care-reports/[id]/send/route';

function createRequest(body: unknown, headers?: Record<string, string>) {
  return {
    url: 'http://localhost/api/test',
    headers: {
      get: (key: string) => headers?.[key] ?? null,
    },
    json: async () => body,
  } as unknown as NextRequest;
}

function buildTx(state: TestState) {
  return {
    patient: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.patient = {
          id: 'patient_1',
          name: data.name as string,
          name_kana: data.name_kana as string,
          birth_date: data.birth_date as Date,
          gender: data.gender as string,
          address: state.patient.address,
          building_id: state.patient.building_id,
          unit_name: state.patient.unit_name,
        };
        return {
          id: state.patient.id,
        };
      }),
    },
    residence: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.patient = {
          ...state.patient,
          address: (data.address as string | undefined) ?? null,
          building_id: (data.building_id as string | undefined) ?? null,
          unit_name: (data.unit_name as string | undefined) ?? null,
        };
        return { id: 'residence_1' };
      }),
    },
    patientSchedulePreference: {
      upsert: vi.fn(async () => ({ id: 'pref_1' })),
    },
    careCase: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.careCase = {
          id: 'case_1',
          patient_id: data.patient_id as string,
        };
        return {
          id: state.careCase.id,
          patient_id: state.careCase.patient_id,
        };
      }),
      findFirst: vi.fn(async ({ where }: { where: { id: string } }) => {
        if (where.id !== state.careCase.id) return null;
        return {
          patient_id: state.careCase.patient_id,
        };
      }),
    },
    medicationCycle: {
      findFirst: vi.fn(async ({ where }: { where: { id: string } }) => {
        if (where.id !== state.cycle.id) return null;
        return {
          id: state.cycle.id,
          patient_id: state.cycle.patient_id,
          overall_status: state.cycle.overall_status,
          exception_status: state.cycle.exception_status,
          prescription_intakes:
            state.intake == null
              ? []
              : [
                  {
                    id: state.intake.id,
                    source_type: state.intake.source_type,
                    prescribed_date: state.intake.prescribed_date,
                    refill_remaining_count: null,
                    refill_next_dispense_date: null,
                    lines: state.intake.lines.map((line) => ({
                      id: line.id,
                      days: line.days,
                    })),
                  },
                ],
          dispense_tasks: [
            {
              results: state.dispenseResults.map((result) => ({
                dispensed_at: result.dispensed_at,
              })),
            },
          ],
        };
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        if (where.id === state.cycle.id) {
          state.cycle = {
            ...state.cycle,
            ...data,
          };
        }
        return {
          id: state.cycle.id,
          overall_status: state.cycle.overall_status,
          exception_status: state.cycle.exception_status,
        };
      }),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: {
            id: string;
            org_id: string;
            overall_status?: { in: string[] };
          };
          data: Record<string, unknown>;
        }) => {
          const allowed =
            where.id === state.cycle.id &&
            (where.overall_status == null ||
              where.overall_status.in.includes(state.cycle.overall_status));

          if (allowed) {
            state.cycle = {
              ...state.cycle,
              ...data,
            };
            return { count: 1 };
          }

          return { count: 0 };
        }
      ),
    },
    prescriptionIntake: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const linesInput = (
          data.lines as {
            create: Array<{
              line_number: number;
              drug_name: string;
              drug_code?: string;
              dose: string;
              frequency: string;
              days: number;
              quantity?: number;
              unit?: string;
            }>;
          }
        ).create;

        state.intake = {
          id: 'intake_1',
          source_type: data.source_type as string,
          prescribed_date: data.prescribed_date as Date,
          lines: linesInput.map((line, index) => ({
            id: `line_${index + 1}`,
            line_number: line.line_number,
            drug_name: line.drug_name,
            drug_code: line.drug_code ?? null,
            dose: line.dose,
            frequency: line.frequency,
            days: line.days,
            quantity: line.quantity ?? 14,
            unit: line.unit ?? '錠',
          })),
        };

        return {
          id: state.intake.id,
          lines: state.intake.lines,
        };
      }),
    },
    workflowException: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.workflowExceptions.push(data);
        return { id: `exception_${state.workflowExceptions.length}` };
      }),
    },
    prescriptionLine: {
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        if (state.intake == null) throw new Error('intake missing');
        state.intake.lines = state.intake.lines.map((line) =>
          line.id === where.id ? { ...line, ...data } : line
        );
        return state.intake.lines.find((line) => line.id === where.id);
      }),
    },
    inquiryRecord: {
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        if (state.inquiry == null || state.inquiry.id !== where.id) {
          throw new Error('inquiry missing');
        }
        state.inquiry = {
          ...state.inquiry,
          ...(data.result !== undefined
            ? {
                result: data.result as NonNullable<TestState['inquiry']>['result'],
              }
            : {}),
          ...(data.change_detail !== undefined ? { change_detail: data.change_detail as string | null } : {}),
          ...(data.resolved_at !== undefined ? { resolved_at: data.resolved_at as Date | null } : {}),
        };
        return state.inquiry;
      }),
      count: vi.fn(async () => 0),
    },
    communicationRequest: {
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    medicationIssue: {
      update: vi.fn(async () => ({ id: 'issue_1' })),
    },
    dispenseTask: {
      findFirst: vi.fn(async ({ where }: { where: { id: string } }) => {
        if (where.id !== state.dispenseTask.id || state.intake == null) return null;
        return {
          id: state.dispenseTask.id,
          cycle_id: state.dispenseTask.cycle_id,
          assigned_to: state.dispenseTask.assigned_to,
          due_date: state.dispenseTask.due_date,
          priority: state.dispenseTask.priority,
          results: state.dispenseResults,
          cycle: {
            id: state.cycle.id,
            patient_id: state.cycle.patient_id,
            overall_status: state.cycle.overall_status,
            inquiries:
              state.inquiry == null ||
              (state.inquiry.result !== null && state.inquiry.result !== 'pending')
                ? []
                : [
                    {
                      id: state.inquiry.id,
                      line_id: state.inquiry.line_id,
                      reason: '用量疑義',
                      inquiry_to_physician: '在宅主治医',
                    },
                  ],
            prescription_intakes: [
              {
                id: state.intake.id,
                lines: state.intake.lines.map((line) => ({
                  id: line.id,
                  drug_name: line.drug_name,
                  drug_code: line.drug_code,
                  quantity: line.quantity,
                })),
              },
            ],
            visit_schedules:
              ['planned', 'in_preparation', 'ready'].includes(
                state.visitSchedule.schedule_status
              )
                ? [{ id: state.visitSchedule.id }]
                : [],
            case_: {
              primary_pharmacist_id: 'pharmacist_1',
              patient: {
                name: '山田 太郎',
              },
            },
            set_plans: [],
          },
        };
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        if (where.id === state.dispenseTask.id) {
          state.dispenseTask = {
            ...state.dispenseTask,
            ...data,
          };
        }
        return state.dispenseTask;
      }),
    },
    dispenseAudit: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: `audit_${data.task_id as string}`,
        result: data.result as string,
      })),
    },
    dispenseResult: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const created = {
          id: `result_${state.dispenseResults.length + 1}`,
          line_id: data.line_id as string,
          actual_drug_name: data.actual_drug_name as string,
          actual_drug_code: (data.actual_drug_code as string | undefined) ?? null,
          actual_quantity: data.actual_quantity as number,
          actual_unit: (data.actual_unit as string | undefined) ?? null,
          carry_type: data.carry_type as 'carry' | 'facility_deposit' | 'deferred',
          special_notes: (data.special_notes as string | undefined) ?? null,
          dispensed_at: data.dispensed_at as Date,
        };
        state.dispenseResults.push(created);
        return created;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        state.dispenseResults = state.dispenseResults.map((result) =>
          result.id === where.id
            ? {
                ...result,
                actual_drug_name: data.actual_drug_name as string,
                actual_drug_code: (data.actual_drug_code as string | undefined) ?? null,
                actual_quantity: data.actual_quantity as number,
                actual_unit: (data.actual_unit as string | undefined) ?? null,
                carry_type: data.carry_type as 'carry' | 'facility_deposit' | 'deferred',
                special_notes: (data.special_notes as string | undefined) ?? null,
                dispensed_at: data.dispensed_at as Date,
              }
            : result
        );
        return state.dispenseResults.find((result) => result.id === where.id);
      }),
      findMany: vi.fn(async () => state.dispenseResults),
    },
    membership: {
      findFirst: vi.fn(async () => ({ id: 'membership_admin' })),
      findMany: vi.fn(async () => [{ user_id: 'auditor_1' }]),
    },
    visitSchedule: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.visitSchedule = {
          ...state.visitSchedule,
          id: 'schedule_1',
          case_id: data.case_id as string,
          cycle_id: (data.cycle_id as string | undefined) ?? state.visitSchedule.cycle_id,
          schedule_status: 'planned',
          visit_type: data.visit_type as string,
          recurrence_rule: (data.recurrence_rule as string | undefined) ?? null,
          medication_end_date: null,
          visit_deadline_date: null,
          carry_items: [],
          carry_items_status: null,
        };
        return {
          id: state.visitSchedule.id,
          case_id: state.visitSchedule.case_id,
          cycle_id: state.visitSchedule.cycle_id,
          schedule_status: state.visitSchedule.schedule_status,
        };
      }),
      findFirst: vi.fn(async ({ where }: { where: { id: string } }) => {
        if (where.id !== state.visitSchedule.id) return null;
        return {
          id: state.visitSchedule.id,
          case_id: state.visitSchedule.case_id,
          schedule_status: state.visitSchedule.schedule_status,
          recurrence_rule: state.visitSchedule.recurrence_rule,
          cycle_id: state.visitSchedule.cycle_id,
          visit_type: state.visitSchedule.visit_type,
          pharmacist_id: 'user_1',
          site_id: 'site_1',
          time_window_start: null,
          time_window_end: null,
          medication_end_date: state.visitSchedule.medication_end_date,
          visit_deadline_date: state.visitSchedule.visit_deadline_date,
        };
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        if (where.id === state.visitSchedule.id) {
          state.visitSchedule = {
            ...state.visitSchedule,
            ...data,
            carry_items:
              (data.carry_items as Array<Record<string, unknown>> | undefined) ??
              state.visitSchedule.carry_items,
            carry_items_status:
              (data.carry_items_status as string | undefined) ??
              state.visitSchedule.carry_items_status,
          };
        }
        return state.visitSchedule;
      }),
      updateMany: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.visitSchedule = {
          ...state.visitSchedule,
          carry_items:
            (data.carry_items as Array<Record<string, unknown>> | undefined) ??
            state.visitSchedule.carry_items,
          carry_items_status:
            (data.carry_items_status as string | undefined) ??
            state.visitSchedule.carry_items_status,
        };
        return { count: 1 };
      }),
    },
    visitPreparation: {
      upsert: vi.fn(async ({
        create,
        update,
      }: {
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) => ({
        id: 'prep_1',
        schedule_id: (create.schedule_id as string | undefined) ?? 'schedule_1',
        prepared_at: (update.prepared_at as Date | null | undefined) ?? null,
      })),
    },
    visitRecord: {
      findFirst: vi.fn(
        async ({ where }: { where: { schedule_id?: string; id?: string } }) => {
          if (where.schedule_id) {
            if (state.visitRecord == null || where.schedule_id !== state.visitRecord.schedule_id) {
              return null;
            }
            return {
              id: state.visitRecord.id,
              version: state.visitRecord.version,
              patient_id: state.visitRecord.patient_id,
              visit_date: state.visitRecord.visit_date,
              outcome_status: state.visitRecord.outcome_status,
              soap_subjective: null,
              soap_objective: null,
              soap_assessment: null,
              soap_plan: null,
              next_visit_suggestion_date: null,
            };
          }

          if (where.id && state.visitRecord != null && where.id === state.visitRecord.id) {
            return {
              schedule: {
                cycle_id: state.visitSchedule.cycle_id,
              },
            };
          }

          return null;
        }
      ),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.visitRecord = {
          id: 'record_1',
          schedule_id: data.schedule_id as string,
          patient_id: data.patient_id as string,
          visit_date: data.visit_date as Date,
          outcome_status: data.outcome_status as string,
          version: 1,
        };
        return state.visitRecord;
      }),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if (state.visitRecord == null) throw new Error('visit record missing');
        state.visitRecord = {
          ...state.visitRecord,
          visit_date: (data.visit_date as Date | undefined) ?? state.visitRecord.visit_date,
          outcome_status:
            (data.outcome_status as string | undefined) ?? state.visitRecord.outcome_status,
          version: state.visitRecord.version + 1,
        };
        return state.visitRecord;
      }),
    },
    residualMedication: {
      findMany: vi.fn(async () => []),
      deleteMany: vi.fn(async () => ({ count: 0 })),
      create: vi.fn(async () => ({ id: 'residual_1' })),
    },
    contactParty: {
      findMany: vi.fn(async () => []),
    },
    consentRecord: {
      findFirst: vi.fn(async () => ({ id: 'consent_1' })),
    },
    firstVisitDocument: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async () => ({ id: 'first_visit_1' })),
      update: vi.fn(async () => ({ id: 'first_visit_1' })),
    },
    deliveryRecord: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const record = {
          id: `delivery_${state.deliveryRecords.length + 1}`,
          report_id: data.report_id as string,
          channel: data.channel as string,
          status: data.status as string,
          recipient_name: data.recipient_name as string,
          recipient_contact: data.recipient_contact as string,
        };
        state.deliveryRecords.push(record);
        return record;
      }),
    },
    careReport: {
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        state.careReports = state.careReports.map((report) =>
          report.id === where.id
            ? {
                ...report,
                status: (data.status as string | undefined) ?? report.status,
              }
            : report
        );
        return state.careReports.find((report) => report.id === where.id);
      }),
      findMany: vi.fn(
        async ({ where }: { where: { visit_record_id: string } }) =>
          state.careReports
            .filter((report) => report.visit_record_id === where.visit_record_id)
            .map((report) => ({ status: report.status }))
      ),
    },
    communicationEvent: {
      create: vi.fn(async () => ({ id: 'event_1' })),
    },
  };
}

describe('workflow full-cycle integration', () => {
  let state: TestState;

  beforeEach(() => {
    vi.clearAllMocks();

    state = {
      patient: {
        id: 'patient_1',
        name: '山田 太郎',
        name_kana: 'ヤマダ タロウ',
        birth_date: new Date('1940-01-01T00:00:00.000Z'),
        gender: 'male',
        address: '東京都港区1-1-1',
        building_id: null,
        unit_name: null,
      },
      cycle: {
        id: 'cycle_1',
        patient_id: 'patient_1',
        overall_status: 'assessment',
        exception_status: null,
      },
      intake: null,
      inquiry: {
        id: 'inquiry_1',
        cycle_id: 'cycle_1',
        line_id: 'line_1',
        issue_id: 'issue_1',
        result: 'pending',
        change_detail: null,
        resolved_at: null,
      },
      dispenseTask: {
        id: 'task_1',
        cycle_id: 'cycle_1',
        status: 'pending',
        assigned_to: 'user_dispense',
        due_date: null,
        priority: 'normal',
      },
      dispenseResults: [],
      visitSchedule: {
        id: 'schedule_1',
        case_id: 'case_1',
        cycle_id: 'cycle_1',
        schedule_status: 'ready',
        visit_type: 'regular',
        recurrence_rule: null,
        medication_end_date: null,
        visit_deadline_date: null,
        carry_items: [],
        carry_items_status: null,
      },
      careCase: {
        id: 'case_1',
        patient_id: 'patient_1',
      },
      visitRecord: null,
      careReports: [],
      deliveryRecords: [],
      notifications: [],
      workflowExceptions: [],
      billingEvidenceUpserts: [],
    };

    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback(buildTx(state))
    );

    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: 'org_1',
        userId: 'user_1',
        role: 'admin',
      },
    });

    patientFindFirstMock.mockImplementation(
      async ({ where }: { where: { id: string; org_id: string } }) =>
        where.id === state.patient.id && where.org_id === 'org_1'
          ? { id: state.patient.id }
          : null
    );

    careCaseFindFirstMock.mockImplementation(
      async ({ where }: { where: { id: string; org_id: string } }) =>
        where.id === state.careCase.id && where.org_id === 'org_1'
          ? {
              primary_pharmacist_id: 'user_1',
              patient: {
                scheduling_preference: null,
              },
            }
          : null
    );

    pharmacistShiftFindFirstMock.mockResolvedValue({
      site_id: 'site_1',
    });

    prismaVisitScheduleFindFirstMock.mockImplementation(
      async ({ where }: { where: { id: string; org_id: string } }) =>
        where.id === state.visitSchedule.id && where.org_id === 'org_1'
          ? {
              id: state.visitSchedule.id,
              case_id: state.visitSchedule.case_id,
              schedule_status: state.visitSchedule.schedule_status,
              scheduled_date: new Date('2026-03-28T00:00:00.000Z'),
              pharmacist_id: 'user_1',
            }
          : null
    );

    inquiryRecordFindFirstMock.mockImplementation(async ({ where }: { where: { id: string } }) => {
      if (state.inquiry == null || where.id !== state.inquiry.id) return null;
      return {
        id: state.inquiry.id,
        cycle_id: state.inquiry.cycle_id,
        line_id: state.inquiry.line_id,
        issue_id: state.inquiry.issue_id,
        result: state.inquiry.result,
      };
    });

    careReportFindFirstMock.mockImplementation(async ({ where }: { where: { id: string } }) => {
      const report = state.careReports.find((item) => item.id === where.id) ?? null;
      if (!report) return null;
      return {
        id: report.id,
        status: report.status,
        visit_record_id: report.visit_record_id,
        report_type: report.report_type,
        pdf_url: report.pdf_url,
      };
    });

    dispatchNotificationEventMock.mockImplementation(async (_tx, payload) => {
      state.notifications.push(payload);
      return undefined;
    });

    upsertBillingEvidenceForVisitMock.mockImplementation(async (_tx, args) => {
      state.billingEvidenceUpserts.push(args.visitRecordId);
      return { id: `evidence_${state.billingEvidenceUpserts.length}` };
    });

    upsertOperationalTaskMock.mockResolvedValue({ id: 'task_followup_1' });
    resolveOperationalTasksMock.mockResolvedValue(undefined);
    sendCareReportEmailMock.mockResolvedValue({ messageId: 'ses-message-1', stub: false });

    generateReportsFromVisitMock.mockImplementation(
      async (_orgId: string, _userId: string, visitRecordId: string, reportType?: string) => {
        const type = reportType ?? 'physician_report';
        const existing =
          state.careReports.find(
            (report) =>
              report.visit_record_id === visitRecordId &&
              report.report_type === type
          ) ?? null;

        if (existing) {
          return {
            reports: [{ id: existing.id, report_type: existing.report_type }],
          };
        }

        const created = {
          id: `report_${state.careReports.length + 1}`,
          visit_record_id: visitRecordId,
          report_type: type,
          status: 'draft',
          pdf_url: `https://example.com/${type}.pdf`,
        };
        state.careReports.push(created);

        return {
          reports: [{ id: created.id, report_type: created.report_type }],
        };
      }
    );
  });

  it('passes the prescription intake -> inquiry -> dispense -> audit -> visit -> report flow', async () => {
    const intakeResponse = await createPrescriptionIntake(
      createRequest({
        cycle_id: 'cycle_1',
        source_type: 'paper',
        prescribed_date: '2026-03-28',
        prescriber_name: '在宅主治医',
        prescriber_institution: 'ケア病院',
        lines: [
          {
            line_number: 1,
            drug_name: 'アムロジピン錠5mg',
            drug_code: '111',
            dose: '1錠',
            frequency: '1日1回朝食後',
            days: 14,
            quantity: 14,
            unit: '錠',
          },
        ],
      })
    );

    expect(intakeResponse?.status).toBe(201);
    expect(state.cycle.overall_status).toBe('dispensing');
    expect(state.intake?.lines[0]?.drug_name).toBe('アムロジピン錠5mg');

    const inquiryResponse = await updateInquiryRecord(
      createRequest({
        result: 'changed',
        change_detail: '朝夕2回へ変更',
        line_update: {
          drug_name: 'アムロジピン錠5mg',
          dose: '1錠',
          frequency: '1日2回',
          days: 14,
        },
      }),
      { params: Promise.resolve({ id: 'inquiry_1' }) }
    );

    expect(inquiryResponse?.status).toBe(200);
    expect(state.cycle.overall_status).toBe('inquiry_resolved');
    expect(state.intake?.lines[0]?.frequency).toBe('1日2回');

    const dispenseResponse = await createDispenseResults(
      createRequest({
        task_id: 'task_1',
        lines: [
          {
            line_id: 'line_1',
            actual_drug_name: 'アムロジピン錠5mg',
            actual_drug_code: '111',
            actual_quantity: 14,
            actual_unit: '錠',
            carry_type: 'carry',
          },
        ],
      })
    );

    expect(dispenseResponse?.status).toBe(201);
    expect(state.dispenseTask.status).toBe('completed');
    expect(state.cycle.overall_status).toBe('audit_pending');
    expect(state.visitSchedule.carry_items_status).toBe('ready');

    const auditResponse = await createDispenseAudit(
      createRequest({
        task_id: 'task_1',
        result: 'approved',
      })
    );

    expect(auditResponse?.status).toBe(201);
    expect(state.cycle.overall_status).toBe('visit_ready');

    const visitResponse = await createVisitRecord(
      createRequest(
        {
          schedule_id: 'schedule_1',
          patient_id: 'patient_1',
          visit_date: '2026-03-28',
          outcome_status: 'completed',
        },
        { 'x-org-id': 'org_1' }
      )
    );

    expect(visitResponse?.status).toBe(201);
    expect(state.visitSchedule.schedule_status).toBe('completed');
    expect(state.cycle.overall_status).toBe('visit_completed');
    expect(state.visitRecord?.id).toBe('record_1');

    const generateResponse = await generateCareReports(
      createRequest({
        visit_record_id: 'record_1',
        report_type: 'physician_report',
      })
    );

    expect(generateResponse?.status).toBe(201);
    expect(state.careReports).toHaveLength(1);
    expect(state.careReports[0]?.status).toBe('draft');

    const sendResponse = await sendCareReport(
      createRequest(
        {
          channel: 'email',
          recipient_name: '在宅主治医',
          recipient_contact: 'doctor@example.com',
        },
        { 'x-org-id': 'org_1' }
      ),
      { params: Promise.resolve({ id: 'report_1' }) }
    );

    expect(sendResponse?.status).toBe(200);
    expect(state.careReports[0]?.status).toBe('sent');
    expect(state.deliveryRecords[0]).toMatchObject({
      report_id: 'report_1',
      channel: 'email',
      status: 'sent',
    });
    expect(state.cycle.overall_status).toBe('reported');
    expect(state.billingEvidenceUpserts).toContain('record_1');
    expect(generateReportsFromVisitMock).toHaveBeenCalledWith(
      'org_1',
      'user_1',
      'record_1',
      'physician_report'
    );
    expect(sendCareReportEmailMock).toHaveBeenCalledWith({
      to: 'doctor@example.com',
      recipientName: '在宅主治医',
      reportType: 'physician_report',
      reportId: 'report_1',
      pdfUrl: 'https://example.com/physician_report.pdf',
    });
  });

  it('passes the patient registration -> schedule generation -> preparation -> visit -> report flow', async () => {
    state.visitRecord = null;
    state.careReports = [];
    state.deliveryRecords = [];
    state.billingEvidenceUpserts = [];
    state.visitSchedule = {
      ...state.visitSchedule,
      id: 'schedule_1',
      case_id: 'case_1',
      cycle_id: 'cycle_1',
      schedule_status: 'planned',
      visit_type: 'regular',
      recurrence_rule: null,
      carry_items: [],
      carry_items_status: null,
    };

    const patientResponse = await createPatient(
      createRequest({
        name: '田中 春子',
        name_kana: 'タナカ ハルコ',
        birth_date: '1942-05-10',
        gender: 'female',
        phone: '090-1234-5678',
        address: '東京都港区芝1-2-3',
        building_id: 'facility_alpha',
        unit_name: '201',
      })
    );

    expect(patientResponse?.status).toBe(201);
    expect(state.patient).toMatchObject({
      id: 'patient_1',
      name: '田中 春子',
      name_kana: 'タナカ ハルコ',
      address: '東京都港区芝1-2-3',
      building_id: 'facility_alpha',
      unit_name: '201',
    });

    const caseResponse = await createCareCase(
      createRequest({
        patient_id: 'patient_1',
        referral_source: '地域包括支援センター',
        referral_date: '2026-03-20',
      })
    );

    expect(caseResponse?.status).toBe(201);
    expect(state.careCase).toMatchObject({
      id: 'case_1',
      patient_id: 'patient_1',
    });

    const scheduleResponse = await generateVisitSchedules(
      createRequest({
        case_id: 'case_1',
        visit_type: 'regular',
        pharmacist_id: 'user_1',
        recurrence_rule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=MO',
        insurance_type: 'medical',
        start_date: '2026-03-30',
        end_date: '2026-03-30',
        time_window_start: '10:00',
        time_window_end: '11:00',
      })
    );

    expect(scheduleResponse?.status).toBe(201);
    expect(state.visitSchedule).toMatchObject({
      id: 'schedule_1',
      case_id: 'case_1',
      visit_type: 'regular',
      recurrence_rule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=MO',
      schedule_status: 'planned',
    });

    const preparationResponse = await upsertVisitPreparation(
      createRequest(
        {
          checklist: {
            medication_changes_reviewed: true,
            carry_items_confirmed: true,
            previous_issues_reviewed: true,
            route_confirmed: true,
            offline_synced: true,
          },
          medication_changes_reviewed: true,
          carry_items_confirmed: true,
          previous_issues_reviewed: true,
          route_confirmed: true,
          offline_synced: true,
        },
        { 'x-org-id': 'org_1' }
      ),
      { params: Promise.resolve({ scheduleId: 'schedule_1' }) }
    );

    expect(preparationResponse?.status).toBe(200);
    expect(resolveOperationalTasksMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        orgId: 'org_1',
        dedupeKey: 'visit-preparation:schedule_1',
        status: 'completed',
      })
    );

    const visitResponse = await createVisitRecord(
      createRequest(
        {
          schedule_id: 'schedule_1',
          patient_id: 'patient_1',
          visit_date: '2026-03-30',
          outcome_status: 'completed',
          soap_subjective: '服薬継続良好',
          soap_objective: '残薬少量',
          soap_assessment: '継続支援可能',
          soap_plan: '次回も同曜日で訪問',
          receipt_person_name: '施設担当',
          receipt_person_relation: 'facility_staff',
          receipt_at: '2026-03-30T11:15',
        },
        { 'x-org-id': 'org_1' }
      )
    );

    expect(visitResponse?.status).toBe(201);
    expect(state.visitSchedule.schedule_status).toBe('completed');
    const createdVisitRecord =
      state.visitRecord as unknown as NonNullable<TestState['visitRecord']>;
    expect(createdVisitRecord.schedule_id).toBe('schedule_1');

    const generateResponse = await generateCareReports(
      createRequest({
        visit_record_id: 'record_1',
        report_type: 'care_manager_report',
      })
    );

    expect(generateResponse?.status).toBe(201);
    expect(state.careReports[0]).toMatchObject({
      visit_record_id: 'record_1',
      report_type: 'care_manager_report',
      status: 'draft',
    });

    const sendResponse = await sendCareReport(
      createRequest(
        {
          channel: 'email',
          recipient_name: '担当ケアマネ',
          recipient_contact: 'caremanager@example.com',
        },
        { 'x-org-id': 'org_1' }
      ),
      { params: Promise.resolve({ id: 'report_1' }) }
    );

    expect(sendResponse?.status).toBe(200);
    expect(state.careReports[0]?.status).toBe('sent');
    expect(state.deliveryRecords[0]).toMatchObject({
      report_id: 'report_1',
      channel: 'email',
      status: 'sent',
      recipient_name: '担当ケアマネ',
    });
    expect(state.billingEvidenceUpserts).toContain('record_1');
  });
});
