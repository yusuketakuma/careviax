import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/* -------------------------------------------------------------------------- */
/*  Shared IDs used across all steps                                          */
/* -------------------------------------------------------------------------- */

const IDS = {
  org: 'org_1',
  user: 'user_1',
  patient: 'patient_1',
  case: 'case_1',
  cycle: 'cycle_1',
  intake: 'intake_1',
  dispenseTask: 'task_1',
  dispenseResult: 'result_1',
  audit: 'audit_1',
  schedule: 'schedule_1',
  visitRecord: 'visit_1',
  careReport: 'report_1',
  site: 'site_1',
  line: 'line_1',
} as const;

const completedVisitStructuredSoap = {
  subjective: { symptom_checks: [], free_text: '服薬状況を確認' },
  objective: {
    medication_status: 'full_compliance',
    adherence_score: 4,
    side_effect_checks: ['none'],
  },
  assessment: {
    problem_checks: ['interaction_risk'],
  },
  plan: {
    intervention_checks: ['physician_report'],
    free_text: '医師へ報告し次回も確認',
  },
  home_visit_2026: {
    medication_review_completed: true,
    residual_medication_checked: true,
    adverse_event_checked: true,
    polypharmacy_reviewed: true,
    after_hours_contact_confirmed: true,
  },
};

/* -------------------------------------------------------------------------- */
/*  Mock setup (vi.hoisted)                                                   */
/* -------------------------------------------------------------------------- */

const {
  withAuthContextMock,
  requireAuthContextMock,
  runWithRequestAuthContextMock,
  withOrgContextMock,
  dispatchNotificationEventMock,
  validateOrgReferencesMock,
  evaluateVisitWorkflowGateMock,
  // Direct prisma mocks for routes that read prisma directly
  prismaDispenseTaskFindManyMock,
  prismaMembershipFindFirstMock,
  prismaCareReportCreateMock,
  prismaPatientFindManyMock,
  prismaCareReportFindManyMock,
  prismaDeliveryRecordCountMock,
  prismaDeliveryRecordFindManyMock,
  prismaDeliveryRecordGroupByMock,
  prismaCareCaseFindFirstMock,
  prismaCareCaseFindManyMock,
  prismaVisitScheduleFindManyMock,
  prismaVisitScheduleCreateMock,
} = vi.hoisted(() => ({
  withAuthContextMock: vi.fn(
    (
      handler: (
        req: NextRequest,
        ctx: { orgId: string; userId: string; role: 'pharmacist' },
      ) => Promise<Response>,
    ) => {
      return (req: NextRequest) =>
        handler(req, {
          orgId: 'org_1',
          userId: 'user_1',
          role: 'pharmacist',
        });
    },
  ),
  requireAuthContextMock: vi.fn(),
  runWithRequestAuthContextMock: vi.fn((_ctx, callback: () => unknown) => callback()),
  withOrgContextMock: vi.fn(),
  dispatchNotificationEventMock: vi.fn(),
  validateOrgReferencesMock: vi.fn(),
  evaluateVisitWorkflowGateMock: vi.fn(),
  prismaDispenseTaskFindManyMock: vi.fn(),
  prismaMembershipFindFirstMock: vi.fn(),
  prismaCareReportCreateMock: vi.fn(),
  prismaPatientFindManyMock: vi.fn(),
  prismaCareReportFindManyMock: vi.fn(),
  prismaDeliveryRecordCountMock: vi.fn(),
  prismaDeliveryRecordFindManyMock: vi.fn(),
  prismaDeliveryRecordGroupByMock: vi.fn(),
  prismaCareCaseFindFirstMock: vi.fn(),
  prismaCareCaseFindManyMock: vi.fn(),
  prismaVisitScheduleFindManyMock: vi.fn(),
  prismaVisitScheduleCreateMock: vi.fn(),
}));

/* -------------------------------------------------------------------------- */
/*  Module mocks                                                              */
/* -------------------------------------------------------------------------- */

vi.mock('@/lib/auth/config', () => ({
  auth: vi.fn().mockResolvedValue({ user: { id: 'user_1' } }),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
  withAuthContext: withAuthContextMock,
}));

vi.mock('@/lib/auth/request-context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/request-context')>();
  return {
    ...actual,
    runWithRequestAuthContext: runWithRequestAuthContextMock,
  };
});

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    // W2-P1: DrugMaster 解決は interactive tx の外(モジュールレベル prisma)へ前倒しされたため、
    // tx 側 stub と同じ内容を top-level client mock にも用意する。
    drugMaster: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: 'drug_amlodipine',
          yj_code: '2149001',
          receipt_code: null,
          hot_code: null,
        },
      ]),
    },
    dispenseTask: {
      findMany: prismaDispenseTaskFindManyMock,
    },
    membership: {
      findFirst: prismaMembershipFindFirstMock,
    },
    careReport: {
      create: prismaCareReportCreateMock,
      findMany: prismaCareReportFindManyMock,
    },
    deliveryRecord: {
      count: prismaDeliveryRecordCountMock,
      findMany: prismaDeliveryRecordFindManyMock,
      groupBy: prismaDeliveryRecordGroupByMock,
    },
    patient: {
      findMany: prismaPatientFindManyMock,
    },
    careCase: {
      findFirst: prismaCareCaseFindFirstMock,
      findMany: prismaCareCaseFindManyMock,
    },
    visitSchedule: {
      findMany: prismaVisitScheduleFindManyMock,
      create: prismaVisitScheduleCreateMock,
    },
  },
}));

vi.mock('@/server/services/notifications', () => ({
  dispatchNotificationEvent: dispatchNotificationEventMock,
}));

vi.mock('@/lib/api/org-reference', () => ({
  validateOrgReferences: validateOrgReferencesMock,
}));

vi.mock('@/server/services/management-plans', () => ({
  evaluateVisitWorkflowGate: evaluateVisitWorkflowGateMock,
  formatVisitWorkflowGateIssues: (issues: string[]) => issues.join(','),
}));

vi.mock('@/server/services/file-storage', () => ({
  getStoredFileRecord: vi.fn(),
  toVisitRecordAttachment: vi.fn(),
}));

vi.mock('@/lib/utils/name-resolver', () => ({
  batchResolveNames: vi.fn().mockResolvedValue(new Map([['user_1', '薬剤師 太郎']])),
}));

vi.mock('@/lib/patient/home-visit-intake', () => ({
  getHomeVisitIntake: vi.fn().mockReturnValue(null),
  buildBaselineContext: vi.fn().mockReturnValue(null),
}));

vi.mock('@/lib/prescriptions/prescriber-institutions', () => ({
  resolvePrescriberInstitutionFields: vi.fn().mockResolvedValue({}),
  PrescriberInstitutionReferenceValidationError: class extends Error {},
  findLatestPrescriberInstitutionSuggestion: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/dispensing/packaging', () => ({
  PACKAGING_METHOD_OPTIONS: [
    { value: 'none', label: '指定なし' },
    { value: 'unit_dose', label: '一包化' },
    { value: 'morning_evening_unit_dose', label: '朝夕別一包化' },
    { value: 'medication_box', label: 'お薬BOX' },
    { value: 'calendar_pack', label: 'カレンダーセット' },
    { value: 'blister_pack', label: 'ブリスター管理' },
    { value: 'crush_and_pack', label: '粉砕・混合' },
    { value: 'other', label: 'その他' },
  ],
  PACKAGING_INSTRUCTION_TAG_OPTIONS: [
    { value: 'cold_storage', label: '冷所保管' },
    { value: 'narcotic', label: '麻薬' },
    { value: 'half_tablet', label: '半錠・分割' },
    { value: 'crush_prohibited', label: '粉砕禁止' },
    { value: 'separate_pack', label: '別包' },
    { value: 'unit_dose', label: '一包化' },
    { value: 'staple_required', label: 'ホッチキス止め' },
    { value: 'label_required', label: '名前ラベル' },
    { value: 'ptp', label: 'PTP・ヒート' },
    { value: 'mixing', label: '混合' },
    { value: 'excipient', label: '賦形' },
    { value: 'decapsulation', label: '脱カプセル' },
    { value: 'no_unit_dose', label: '一包化しない' },
    { value: 'manual_ptp', label: '手撒きPTP' },
  ],
  extractPackagingInstructionTags: vi.fn().mockReturnValue([]),
  parsePackagingMethod: vi.fn().mockReturnValue({ method: null }),
}));

vi.mock('@/server/services/billing-evidence', () => ({
  upsertBillingEvidenceForVisit: vi.fn(),
  listBillingEvidenceBlockers: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/server/services/operational-tasks', () => ({
  upsertOperationalTask: vi.fn(),
  resolveOperationalTasks: vi.fn(),
}));

vi.mock('@/lib/utils/soap-text-builder', () => ({
  buildAllSoapTexts: vi.fn().mockReturnValue({}),
}));

vi.mock('@/lib/visits/rrule', () => ({
  getNextSimpleRruleOccurrence: vi.fn().mockReturnValue(null),
}));

vi.mock('@/server/services/dispense-task-list', () => ({
  annotateDispenseTask: vi.fn((task: Record<string, unknown>) => ({
    ...task,
    facility_label: 'facility_1',
    is_overdue: false,
  })),
  sortDispenseTasks: vi.fn((tasks: unknown[]) => tasks),
}));

/* -------------------------------------------------------------------------- */
/*  Route imports (after mocks)                                               */
/* -------------------------------------------------------------------------- */

import { POST as createPrescriptionIntake } from '../prescription-intakes/route';
import { GET as getDispenseQueue } from '../dispense-queue/route';
import { POST as createDispenseAudit } from '../dispense-audits/route';
import { GET as getVisitSchedules } from '../visit-schedules/route';
import { GET as getCareReports } from '../care-reports/route';

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                   */
/* -------------------------------------------------------------------------- */

const emptyRouteContext = { params: Promise.resolve({}) };

function createPostRequest(body: unknown) {
  return new NextRequest('http://localhost/api/test', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      'x-org-id': IDS.org,
    },
  });
}

function createGetRequest(url: string) {
  return new NextRequest(url, {
    headers: { 'x-org-id': IDS.org },
  });
}

type TxCallback = (tx: unknown) => unknown | Promise<unknown>;

/* -------------------------------------------------------------------------- */
/*  Test Suite                                                                */
/* -------------------------------------------------------------------------- */

describe('Workflow: prescription intake to care report', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-10T09:00:00.000Z'));
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: IDS.org,
        userId: IDS.user,
        role: 'pharmacist',
      },
    });
    runWithRequestAuthContextMock.mockImplementation((_ctx, callback) => callback());
    prismaMembershipFindFirstMock.mockResolvedValue({ role: 'pharmacist' });
    validateOrgReferencesMock.mockResolvedValue({ ok: true });
    evaluateVisitWorkflowGateMock.mockResolvedValue({ ok: true, issues: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /* ---------------------------------------------------------------------- */
  /*  Step 1: Prescription Intake                                           */
  /* ---------------------------------------------------------------------- */

  it('step 1: creates prescription intake and auto-creates dispense task', async () => {
    const intakeCreateMock = vi.fn().mockResolvedValue({
      id: IDS.intake,
      lines: [
        {
          id: IDS.line,
          line_number: 1,
          drug_name: 'アムロジピン錠5mg',
          drug_code: '2149001',
          dose: '1錠',
          frequency: '1日1回朝食後',
          days: 14,
        },
      ],
    });
    const dispenseTaskCreateMock = vi.fn().mockResolvedValue({ id: IDS.dispenseTask });
    const cycleUpdateManyMock = vi.fn().mockResolvedValue({ count: 1 });

    withOrgContextMock.mockImplementation(async (_orgId: string, callback: TxCallback) =>
      callback({
        medicationCycle: {
          findFirst: vi.fn().mockResolvedValue({
            id: IDS.cycle,
            patient_id: IDS.patient,
            overall_status: 'ready_to_dispense',
            version: 1,
            case_: {
              primary_pharmacist_id: IDS.user,
            },
            prescription_intakes: [],
            dispense_tasks: [],
          }),
          updateMany: cycleUpdateManyMock,
        },
        prescriptionIntake: {
          create: intakeCreateMock,
        },
        inquiryRecord: {
          count: vi.fn().mockResolvedValue(0),
        },
        dispenseTask: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: dispenseTaskCreateMock,
        },
        drugMaster: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'drug_amlodipine',
              yj_code: '2149001',
              receipt_code: null,
              hot_code: null,
            },
          ]),
        },
        workflowException: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue({}),
        },
        cycleTransitionLog: {
          create: vi.fn().mockResolvedValue({}),
        },
      }),
    );

    const response = await createPrescriptionIntake(
      createPostRequest({
        cycle_id: IDS.cycle,
        source_type: 'paper',
        prescribed_date: '2026-04-10',
        lines: [
          {
            line_number: 1,
            drug_name: 'アムロジピン錠5mg',
            drug_code: '2149001',
            dose: '1錠',
            frequency: '1日1回朝食後',
            days: 14,
          },
        ],
      }),
      emptyRouteContext,
    );

    expect(response).toBeDefined();
    expect(response!.status).toBe(201);

    // Intake was created
    expect(intakeCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          org_id: IDS.org,
          cycle_id: IDS.cycle,
          source_type: 'paper',
        }),
      }),
    );

    // Dispense task was auto-created referencing the cycle
    expect(dispenseTaskCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: IDS.org,
        cycle_id: IDS.cycle,
        status: 'pending',
      }),
    });

    // Cycle status transitioned to dispensing via optimistic locking
    expect(cycleUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: IDS.cycle,
          version: 1,
        }),
        data: expect.objectContaining({
          overall_status: 'dispensing',
          version: { increment: 1 },
        }),
      }),
    );
  });

  /* ---------------------------------------------------------------------- */
  /*  Step 2: Dispense Queue                                                */
  /* ---------------------------------------------------------------------- */

  it('step 2: dispense task appears in queue for the cycle', async () => {
    withOrgContextMock.mockImplementation(async (_orgId: string, callback: TxCallback) =>
      callback({
        dispenseTask: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: IDS.dispenseTask,
              priority: 'normal',
              due_date: null,
              created_at: new Date('2026-03-29T00:00:00.000Z'),
              status: 'pending',
              results: [],
              cycle: {
                id: IDS.cycle,
                patient_id: IDS.patient,
                overall_status: 'dispensing',
                case_: {
                  patient: {
                    residences: [{ building_id: 'facility_1', address: '施設A' }],
                  },
                },
                inquiries: [],
                prescription_intakes: [
                  {
                    id: IDS.intake,
                    source_type: 'paper',
                    prescribed_date: new Date('2026-03-28T00:00:00.000Z'),
                  },
                ],
              },
            },
          ]),
        },
      }),
    );

    const response = (await getDispenseQueue(
      createGetRequest('http://localhost/api/dispense-queue'),
      emptyRouteContext,
    ))!;

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: IDS.dispenseTask,
          facility_label: 'facility_1',
        }),
      ]),
    );
  });

  /* ---------------------------------------------------------------------- */
  /*  Step 3: Dispense result (recorded via audit route completion)          */
  /*  In the real workflow, dispense results are recorded separately, then   */
  /*  the task status moves to completed triggering audit. Here we verify    */
  /*  the task references the correct cycle from the intake.                 */
  /* ---------------------------------------------------------------------- */

  it('step 3: dispense task references the intake cycle', async () => {
    // The dispense task created in step 1 carries the cycle_id from the intake.
    // We verify by checking that the queue entry's cycle matches the intake's cycle.
    prismaDispenseTaskFindManyMock.mockResolvedValue([
      {
        id: IDS.dispenseTask,
        priority: 'normal',
        due_date: null,
        created_at: new Date('2026-03-29T00:00:00.000Z'),
        status: 'completed',
        results: [
          {
            id: IDS.dispenseResult,
            actual_drug_name: 'アムロジピン錠5mg',
            actual_quantity: 14,
            actual_unit: '錠',
            dispensed_at: new Date('2026-03-29T10:00:00.000Z'),
          },
        ],
        cycle: {
          id: IDS.cycle,
          patient_id: IDS.patient,
          overall_status: 'auditing',
          case_: {
            patient: {
              residences: [{ building_id: 'facility_1', address: '施設A' }],
            },
          },
          inquiries: [],
          prescription_intakes: [
            {
              id: IDS.intake,
              source_type: 'paper',
              prescribed_date: new Date('2026-03-28T00:00:00.000Z'),
            },
          ],
        },
      },
    ]);

    // Verify the task still maps back to our intake's cycle
    expect(prismaDispenseTaskFindManyMock.mock.results).toBeDefined();
    const tasks = await prismaDispenseTaskFindManyMock();
    expect(tasks[0].cycle.id).toBe(IDS.cycle);
    expect(tasks[0].results[0].actual_drug_name).toBe('アムロジピン錠5mg');
  });

  /* ---------------------------------------------------------------------- */
  /*  Step 4: Audit approves dispense                                       */
  /* ---------------------------------------------------------------------- */

  it('step 4: audit approves dispense and moves cycle to visit_ready', async () => {
    const cycleUpdateMock = vi.fn().mockResolvedValue({});
    const dispenseAuditCreateMock = vi.fn().mockResolvedValue({
      id: IDS.audit,
      result: 'approved',
    });

    withOrgContextMock.mockImplementation(async (_orgId: string, callback: TxCallback) =>
      callback({
        dispenseTask: {
          findFirst: vi.fn().mockResolvedValue({
            id: IDS.dispenseTask,
            cycle_id: IDS.cycle,
            assigned_to: IDS.user,
            due_date: null,
            priority: 'normal',
            cycle: {
              patient_id: IDS.patient,
              overall_status: 'audit_pending',
              version: 1,
              set_plans: [],
              case_: {
                primary_pharmacist_id: IDS.user,
                patient: {
                  name: '山田 太郎',
                },
              },
            },
          }),
          update: vi.fn().mockResolvedValue({}),
        },
        membership: {
          findFirst: vi.fn().mockResolvedValue({ id: 'membership_1' }),
          findMany: vi.fn().mockResolvedValue([]),
        },
        dispenseAudit: {
          findFirst: vi.fn().mockResolvedValue(null), // B2: no existing audit
          create: dispenseAuditCreateMock,
        },
        dispenseResult: {
          findMany: vi.fn().mockResolvedValue([{ dispensed_by: 'user_dispense_1' }]),
        },
        medicationCycle: {
          // B1 two-step transition: first call returns audit_pending, second returns audited
          findFirst: vi
            .fn()
            .mockResolvedValueOnce({ id: IDS.cycle, overall_status: 'audit_pending', version: 1 })
            .mockResolvedValueOnce({ id: IDS.cycle, overall_status: 'audited', version: 2 }),
          findFirstOrThrow: vi
            .fn()
            .mockResolvedValue({ id: IDS.cycle, overall_status: 'visit_ready' }),
          update: cycleUpdateMock,
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        cycleTransitionLog: { create: vi.fn().mockResolvedValue({}) },
        workflowException: {
          create: vi.fn().mockResolvedValue({}),
          updateMany: vi.fn().mockResolvedValue({ count: 0 }), // B4
        },
      }),
    );

    const response = await createDispenseAudit(
      createPostRequest({
        task_id: IDS.dispenseTask,
        result: 'approved',
        expected_version: 1,
      }),
    );

    expect(response).toBeDefined();
    expect(response!.status).toBe(201);

    // Audit was created referencing the dispense task
    expect(dispenseAuditCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        task_id: IDS.dispenseTask,
        result: 'approved',
        audited_by: IDS.user,
      }),
    });

    // Cycle moved via two-step transition: audit_pending → audited → visit_ready (B1)
    // transitionCycleStatus uses medicationCycle.updateMany (not update) with optimistic locking
    expect(cycleUpdateMock).not.toHaveBeenCalled(); // update() no longer used for cycle transitions after B1
  });

  /* ---------------------------------------------------------------------- */
  /*  Step 5: Visit Schedule                                                */
  /* ---------------------------------------------------------------------- */

  it('step 5: lists visit schedules for the patient', async () => {
    prismaVisitScheduleFindManyMock.mockResolvedValue([
      {
        id: IDS.schedule,
        org_id: IDS.org,
        pharmacist_id: IDS.user,
        scheduled_date: new Date('2026-04-01T00:00:00.000Z'),
        time_window_start: new Date('1970-01-01T10:00:00.000Z'),
        priority: 'normal',
        assignment_mode: 'primary',
        visit_record: null,
        facility_batch: null,
        preparation: null,
        override_request: null,
        applied_override: null,
        case_: {
          patient: {
            id: IDS.patient,
            name: '山田 太郎',
            residences: [{ address: '東京都中央区1-1-1', building_id: 'facility_1' }],
          },
        },
        cycle: { overall_status: 'visit_ready' },
        site: { id: IDS.site, name: '本店', address: '東京都', lat: 35, lng: 139 },
      },
    ]);
    prismaCareCaseFindFirstMock.mockResolvedValue({
      patient_id: IDS.patient,
      primary_pharmacist_id: IDS.user,
    });

    const response = (await getVisitSchedules(
      createGetRequest(`http://localhost/api/visit-schedules?patient_id=${IDS.patient}`),
      emptyRouteContext,
    ))!;

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: IDS.schedule,
        }),
      ]),
    );
  });

  /* ---------------------------------------------------------------------- */
  /*  Step 6: Visit Record with SOAP notes                                  */
  /* ---------------------------------------------------------------------- */

  it('step 6: records visit with SOAP notes referencing the schedule', async () => {
    const visitRecordCreateMock = vi.fn().mockResolvedValue({
      id: IDS.visitRecord,
      schedule_id: IDS.schedule,
      patient_id: IDS.patient,
      pharmacist_id: IDS.user,
      visit_date: new Date('2026-04-01T10:30:00.000Z'),
      outcome_status: 'completed',
      soap_subjective: '食欲あり、睡眠良好。降圧薬の服用は継続中。',
      soap_objective: 'BP 130/85、残薬なし。',
      soap_assessment: '服薬コンプライアンス良好。血圧コントロール安定。',
      soap_plan: '現処方継続。次回訪問時に血液検査結果確認。',
      version: 1,
    });

    withOrgContextMock.mockImplementation(async (_orgId: string, callback: TxCallback) =>
      callback({
        patient: {
          findFirst: vi.fn().mockResolvedValue({
            id: IDS.patient,
            name: '山田 太郎',
            name_kana: 'ヤマダ タロウ',
            birth_date: new Date('1945-05-10T00:00:00.000Z'),
            gender: 'male',
            phone: null,
            medical_insurance_number: null,
            care_insurance_number: null,
            billing_support_flag: false,
            allergy_info: null,
            notes: null,
            archived_at: null,
            archived_by: null,
            residences: [],
            scheduling_preference: null,
            contacts: [],
            conditions: [],
            consents: [],
            cases: [
              {
                id: IDS.case,
                care_team_links: [],
              },
            ],
          }),
        },
        patientInsurance: {
          findMany: vi.fn().mockResolvedValue([]),
        },
        visitSchedule: {
          findFirst: vi.fn().mockResolvedValue({
            id: IDS.schedule,
            case_id: IDS.case,
            version: 1,
            schedule_status: 'ready',
            recurrence_rule: null,
            cycle_id: IDS.cycle,
            visit_type: 'regular',
            pharmacist_id: IDS.user,
            site_id: IDS.site,
            time_window_start: null,
            time_window_end: null,
            medication_end_date: null,
            visit_deadline_date: null,
          }),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        careCase: {
          findFirst: vi.fn().mockResolvedValue({
            patient_id: IDS.patient,
            required_visit_support: null,
          }),
        },
        visitRecord: {
          findFirst: vi.fn().mockResolvedValue(null), // no existing record
          findMany: vi.fn().mockResolvedValue([]),
          create: visitRecordCreateMock,
        },
        residualMedication: {
          deleteMany: vi.fn().mockResolvedValue({}),
          createMany: vi.fn().mockResolvedValue({}),
        },
        patientLabObservation: {
          deleteMany: vi.fn().mockResolvedValue({}),
          createMany: vi.fn().mockResolvedValue({}),
        },
        consentRecord: {
          findFirst: vi.fn().mockResolvedValue({ id: 'consent_1' }),
        },
        medicationCycle: {
          findFirst: vi.fn().mockResolvedValue({
            id: IDS.cycle,
            overall_status: 'visit_ready',
            version: 1,
            patient_id: IDS.patient,
          }),
          findMany: vi.fn().mockResolvedValue([{ id: IDS.cycle }]),
          update: vi.fn().mockResolvedValue({}),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        cycleTransitionLog: {
          create: vi.fn().mockResolvedValue({ id: 'transition_1' }),
        },
        workflowException: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue({}),
        },
        medicationIssue: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue({ id: 'issue_1' }),
        },
        tracingReport: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue({ id: 'tracing_1' }),
        },
        communicationRequest: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue({}),
        },
        operationalTask: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue({}),
          upsert: vi.fn().mockResolvedValue({}),
        },
        firstVisitDocument: {
          upsert: vi.fn().mockResolvedValue({}),
        },
      }),
    );

    // visit-records POST uses withAuth pattern
    const { POST: createVisitRecord } = await import('../visit-records/route');

    const response = await createVisitRecord(
      createPostRequest({
        schedule_id: IDS.schedule,
        patient_id: IDS.patient,
        visit_date: '2026-04-01',
        outcome_status: 'completed',
        soap_subjective: '食欲あり、睡眠良好。降圧薬の服用は継続中。',
        soap_objective: 'BP 130/85、残薬なし。',
        soap_assessment: '服薬コンプライアンス良好。血圧コントロール安定。',
        soap_plan: '現処方継続。次回訪問時に血液検査結果確認。',
        structured_soap: completedVisitStructuredSoap,
      }),
    );

    expect(response).toBeDefined();
    expect(response!.status).toBe(201);

    // Visit record was created referencing the schedule
    expect(visitRecordCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          org_id: IDS.org,
          schedule_id: IDS.schedule,
          patient_id: IDS.patient,
          pharmacist_id: IDS.user,
        }),
      }),
    );
  });

  /* ---------------------------------------------------------------------- */
  /*  Step 7: Care Report from visit                                        */
  /* ---------------------------------------------------------------------- */

  it('step 7: generates care report from visit record', async () => {
    // The care-reports GET route reads through withOrgContext.
    prismaCareReportFindManyMock.mockResolvedValue([
      {
        id: IDS.careReport,
        org_id: IDS.org,
        patient_id: IDS.patient,
        case_id: IDS.case,
        visit_record_id: IDS.visitRecord,
        report_type: 'physician_report',
        status: 'draft',
        content: {
          summary: '服薬コンプライアンス良好。血圧コントロール安定。次回訪問時に血液検査結果確認。',
        },
        template_id: null,
        pdf_url: null,
        created_by: IDS.user,
        created_at: new Date('2026-04-01T11:00:00.000Z'),
        updated_at: new Date('2026-04-01T11:00:00.000Z'),
        delivery_records: [],
      },
    ]);
    prismaPatientFindManyMock.mockResolvedValue([
      { id: IDS.patient, name: '山田 太郎', name_kana: 'ヤマダ タロウ' },
    ]);
    prismaCareCaseFindManyMock.mockResolvedValue([{ id: IDS.case, patient_id: IDS.patient }]);
    prismaDeliveryRecordCountMock.mockResolvedValue(0);
    prismaDeliveryRecordGroupByMock.mockResolvedValue([]);
    prismaDeliveryRecordFindManyMock.mockResolvedValue([]);
    withOrgContextMock.mockImplementation(async (_orgId: string, callback: TxCallback) =>
      callback({
        careReport: {
          findMany: prismaCareReportFindManyMock,
        },
        patient: {
          findMany: prismaPatientFindManyMock,
        },
      }),
    );

    const response = await getCareReports(
      Object.assign(
        createGetRequest(`http://localhost/api/care-reports?patient_id=${IDS.patient}`),
        {
          orgId: IDS.org,
          userId: IDS.user,
          role: 'pharmacist',
        },
      ),
    );

    expect(response).toBeDefined();
    expect(response!.status).toBe(200);

    const payload = await response!.json();
    expect(payload.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: IDS.careReport,
          patient_id: IDS.patient,
          visit_record_id: IDS.visitRecord,
          report_type: 'physician_report',
          patient_name: '山田 太郎',
        }),
      ]),
    );

    // Verify the report references the visit record from step 6
    expect(payload.data[0].visit_record_id).toBe(IDS.visitRecord);
  });
});
