import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addDays, format } from 'date-fns';
import { NextRequest } from 'next/server';

/** 今日の日付文字列（有効期限チェックを通過させるため動的に生成） */
const TODAY = format(new Date(), 'yyyy-MM-dd');

type AuthenticatedTestRequest = NextRequest & {
  orgId: string;
  userId: string;
  role: 'admin';
};

type TestRouteContext = { params: Promise<Record<string, string>> };

const {
  withAuthContextMock,
  withOrgContextMock,
  prescriptionIntakeFindManyMock,
  prescriptionIntakeCountMock,
  validateOrgReferencesMock,
  upsertOperationalTaskMock,
  careCaseFindFirstMock,
  patientFindFirstMock,
  broadcastOrgRealtimeEventMock,
  notifyWorkflowMutationMock,
  notifyWebhookEventForOrgMock,
} = vi.hoisted(() => ({
  withAuthContextMock: vi.fn(
    (
      handler: (
        req: NextRequest,
        ctx: Omit<AuthenticatedTestRequest, keyof NextRequest>,
      ) => Promise<Response>,
    ) => {
      return (req: NextRequest) => {
        return handler(req, {
          orgId: 'org_1',
          userId: 'user_1',
          role: 'admin' as const,
        });
      };
    },
  ),
  withOrgContextMock: vi.fn(),
  prescriptionIntakeFindManyMock: vi.fn(),
  prescriptionIntakeCountMock: vi.fn().mockResolvedValue(2),
  validateOrgReferencesMock: vi.fn().mockResolvedValue({ ok: true }),
  upsertOperationalTaskMock: vi.fn().mockResolvedValue({ id: 'task_operational_1' }),
  careCaseFindFirstMock: vi.fn().mockResolvedValue({ id: 'case_1' }),
  patientFindFirstMock: vi.fn(),
  broadcastOrgRealtimeEventMock: vi.fn().mockResolvedValue(undefined),
  notifyWorkflowMutationMock: vi.fn().mockResolvedValue(undefined),
  notifyWebhookEventForOrgMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: withAuthContextMock,
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/lib/api/org-reference', () => ({
  validateOrgReferences: validateOrgReferencesMock,
}));

vi.mock('@/server/services/operational-tasks', () => ({
  upsertOperationalTask: upsertOperationalTaskMock,
  resolveOperationalTasks: vi.fn(),
}));

vi.mock('@/server/services/org-realtime', () => ({
  broadcastOrgRealtimeEvent: broadcastOrgRealtimeEventMock,
}));

vi.mock('@/server/services/workflow-dashboard-cache', () => ({
  notifyWorkflowMutation: notifyWorkflowMutationMock,
}));

vi.mock('@/server/services/outbound-webhook', () => ({
  notifyWebhookEventForOrg: notifyWebhookEventForOrgMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    prescriptionIntake: {
      findMany: prescriptionIntakeFindManyMock,
      count: prescriptionIntakeCountMock,
      findFirst: vi.fn().mockResolvedValue(null),
    },
    medicationProfile: {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    careCase: {
      findFirst: careCaseFindFirstMock,
      findMany: vi.fn().mockResolvedValue([{ patient_id: 'patient_1' }]),
    },
    patient: {
      findFirst: patientFindFirstMock,
    },
  },
}));

import { GET as rawGET, POST as rawPOST } from './route';

const emptyRouteContext: TestRouteContext = { params: Promise.resolve({}) };
const GET = (req: NextRequest) => rawGET(req, emptyRouteContext);
const POST = (req: NextRequest) => rawPOST(req, emptyRouteContext);

function createRequest(body: unknown) {
  return new NextRequest('http://localhost/api/prescription-intakes', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

function createMalformedJsonRequest() {
  return new NextRequest('http://localhost/api/prescription-intakes', {
    method: 'POST',
    body: '{"case_id":',
    headers: { 'content-type': 'application/json' },
  });
}

function createGetRequest(url: string) {
  return new NextRequest(url);
}

describe('/api/prescription-intakes POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    patientFindFirstMock.mockResolvedValue({
      id: 'patient_qr',
      name: '山田 太郎',
      name_kana: 'ヤマダ タロウ',
      birth_date: new Date('1950-03-15T00:00:00.000Z'),
      gender: 'male',
    });
    notifyWebhookEventForOrgMock.mockResolvedValue(undefined);
  });

  it('rejects refill intakes when the next dispense date is outside the allowed window', async () => {
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        medicationCycle: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'cycle_1',
            patient_id: 'patient_1',
            prescription_intakes: [
              {
                id: 'intake_prev',
                source_type: 'refill',
                prescribed_date: new Date('2026-03-01T00:00:00.000Z'),
                refill_remaining_count: 2,
                refill_next_dispense_date: new Date('2026-03-29T00:00:00.000Z'),
                lines: [{ days: 28 }],
              },
            ],
            dispense_tasks: [
              {
                results: [{ dispensed_at: new Date('2026-03-01T00:00:00.000Z') }],
              },
            ],
          }),
          update: vi.fn(),
        },
        prescriptionIntake: {
          create: vi.fn(),
        },
      }),
    );

    const response = await POST(
      createRequest({
        cycle_id: 'cycle_1',
        source_type: 'refill',
        prescribed_date: TODAY,
        refill_remaining_count: 1,
        refill_next_dispense_date: '2026-04-20',
        lines: [
          {
            line_number: 1,
            drug_name: 'アムロジピン錠5mg',
            dose: '1錠',
            frequency: '1日1回朝食後',
            days: 28,
          },
        ],
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リフィル処方箋の次回調剤予定日が調剤可能ウィンドウ外です',
      details: {
        target_date: '2026-03-29',
        window_start: '2026-03-22',
        window_end: '2026-04-05',
      },
    });
  });

  it('rejects non-object request bodies before reference validation or intake creation', async () => {
    const response = await POST(createRequest(['unexpected']));

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(broadcastOrgRealtimeEventMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON request bodies before reference validation or intake creation', async () => {
    const response = await POST(createMalformedJsonRequest());

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(broadcastOrgRealtimeEventMock).not.toHaveBeenCalled();
  });

  it('returns conflict when previous prescription source revision is stale', async () => {
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        medicationCycle: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'cycle_1',
            patient_id: 'patient_1',
            case_id: 'case_1',
            overall_status: 'ready_to_dispense',
            version: 1,
            case_: { primary_pharmacist_id: 'pharmacist_1' },
            prescription_intakes: [],
            dispense_tasks: [],
          }),
        },
        prescriptionLine: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'line_prev',
              intake_id: 'intake_prev',
              updated_at: new Date('2026-04-01T09:31:00.000Z'),
              intake: {
                id: 'intake_prev',
                updated_at: new Date('2026-04-01T10:00:00.000Z'),
                cycle: {
                  patient_id: 'patient_1',
                  case_id: 'case_1',
                },
              },
            },
          ]),
        },
        prescriptionIntake: {
          create: vi.fn(),
        },
      }),
    );

    const response = await POST(
      createRequest({
        cycle_id: 'cycle_1',
        source_type: 'paper',
        prescribed_date: TODAY,
        lines: [
          {
            line_number: 1,
            drug_name: 'アムロジピン錠5mg',
            dose: '1錠',
            frequency: '1日1回朝食後',
            days: 14,
            source_intake_id: 'intake_prev',
            source_line_id: 'line_prev',
            source_intake_updated_at_snapshot: '2026-04-01T10:00:00.000Z',
            source_line_updated_at_snapshot: '2026-04-01T09:30:00.000Z',
          },
        ],
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: '前回処方が更新されています。再読み込みしてください',
    });
  });

  it('rejects blank required prescription intake fields before reference validation or intake creation', async () => {
    const response = await POST(
      createRequest({
        case_id: 'case_1',
        patient_id: 'patient_1',
        source_type: 'paper',
        prescribed_date: TODAY,
        lines: [
          {
            line_number: 1,
            drug_name: 'アムロジピン錠5mg',
            dose: '   ',
            frequency: '1日1回朝食後',
            days: 14,
          },
        ],
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(broadcastOrgRealtimeEventMock).not.toHaveBeenCalled();
  });

  it('rejects invalid prescription dates before reference validation or intake creation', async () => {
    const response = await POST(
      createRequest({
        case_id: 'case_1',
        patient_id: 'patient_1',
        source_type: 'paper',
        prescribed_date: '2026-02-30',
        lines: [
          {
            line_number: 1,
            drug_name: 'アムロジピン錠5mg',
            dose: '1錠',
            frequency: '1日1回朝食後',
            days: 14,
            start_date: '2026-04-10',
            end_date: '2026-04-01',
          },
        ],
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(broadcastOrgRealtimeEventMock).not.toHaveBeenCalled();
  });

  it('rejects non-local HTTP prescription original URLs before reference validation', async () => {
    const response = await POST(
      createRequest({
        case_id: 'case_1',
        patient_id: 'patient_1',
        source_type: 'fax',
        prescribed_date: TODAY,
        original_document_url: 'http://storage.example.com/original.pdf',
        lines: [
          {
            line_number: 1,
            drug_name: 'アムロジピン錠5mg',
            dose: '1錠',
            frequency: '1日1回朝食後',
            days: 14,
          },
        ],
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(broadcastOrgRealtimeEventMock).not.toHaveBeenCalled();
  });

  it('rejects future prescribed dates before intake creation', async () => {
    const response = await POST(
      createRequest({
        cycle_id: 'cycle_1',
        source_type: 'paper',
        prescribed_date: format(addDays(new Date(), 1), 'yyyy-MM-dd'),
        lines: [
          {
            line_number: 1,
            drug_name: 'アムロジピン錠5mg',
            dose: '1錠',
            frequency: '1日1回朝食後',
            days: 14,
          },
        ],
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '未来日の処方箋は登録できません',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(broadcastOrgRealtimeEventMock).not.toHaveBeenCalled();
  });

  it('rejects duplicate prescription-line candidates before creating the intake', async () => {
    const intakeCreateMock = vi.fn();

    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        medicationCycle: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'cycle_1',
            patient_id: 'patient_1',
            prescription_intakes: [],
            dispense_tasks: [],
          }),
          update: vi.fn(),
        },
        workflowException: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn(),
        },
        prescriptionIntake: {
          create: intakeCreateMock,
        },
      }),
    );

    const response = await POST(
      createRequest({
        cycle_id: 'cycle_1',
        source_type: 'paper',
        prescribed_date: TODAY,
        lines: [
          {
            line_number: 1,
            drug_name: 'アムロジピン錠5mg',
            drug_code: '2149001',
            dose: '1錠',
            frequency: '1日1回朝食後',
            days: 14,
          },
          {
            line_number: 2,
            drug_name: 'アムロジピン錠5mg',
            drug_code: '2149001',
            dose: '1錠',
            frequency: '1日1回朝食後',
            days: 14,
          },
        ],
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '重複候補の処方明細があるため受付できません',
      details: {
        duplicates: [
          {
            key: '2149001',
          },
        ],
      },
    });
    expect(intakeCreateMock).not.toHaveBeenCalled();
  });

  it('creates a workflow exception and blocks intake creation for unstructured lines', async () => {
    const workflowExceptionCreateMock = vi.fn().mockResolvedValue({ id: 'exception_1' });
    const intakeCreateMock = vi.fn();

    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        medicationCycle: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'cycle_1',
            patient_id: 'patient_1',
            prescription_intakes: [],
            dispense_tasks: [],
          }),
          update: vi.fn(),
        },
        workflowException: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: workflowExceptionCreateMock,
        },
        prescriptionIntake: {
          create: intakeCreateMock,
        },
      }),
    );

    const response = await POST(
      createRequest({
        cycle_id: 'cycle_1',
        source_type: 'paper',
        prescribed_date: TODAY,
        lines: [
          {
            line_number: 1,
            drug_name: '薬剤名確認中',
            dose: '1錠',
            frequency: '1日1回朝食後',
            days: 7,
          },
        ],
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '未構造化または不明な処方明細があるため受付を完了できません',
      details: {
        blocked_lines: [
          {
            line_number: 1,
            drug_name: '薬剤名確認中',
          },
        ],
      },
    });
    expect(workflowExceptionCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          exception_type: 'prescription_structuring_block',
          cycle_id: 'cycle_1',
        }),
      }),
    );
    expect(intakeCreateMock).not.toHaveBeenCalled();
  });

  it('rejects split dispenses when total and current counts are incomplete', async () => {
    const response = await POST(
      createRequest({
        cycle_id: 'cycle_1',
        source_type: 'paper',
        prescribed_date: TODAY,
        split_dispense_total: 3,
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
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '分割調剤は分割回数と今回回数を両方入力してください',
    });
  });

  it('rejects split dispenses when a partial split is missing the next dispense date', async () => {
    const response = await POST(
      createRequest({
        cycle_id: 'cycle_1',
        source_type: 'paper',
        prescribed_date: TODAY,
        split_dispense_total: 3,
        split_dispense_current: 1,
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
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '分割調剤の途中回は次回調剤予定日が必須です',
    });
  });

  it('creates a new cycle and completes registration in one request when case and patient are provided', async () => {
    const cycleCreateMock = vi.fn().mockResolvedValue({
      id: 'cycle_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      overall_status: 'intake_received',
      version: 1,
    });
    const cycleFindFirstMock = vi
      .fn()
      .mockResolvedValueOnce({
        id: 'cycle_1',
        patient_id: 'patient_1',
        overall_status: 'intake_received',
        version: 1,
      })
      .mockResolvedValueOnce({
        id: 'cycle_1',
        patient_id: 'patient_1',
        overall_status: 'structuring',
        version: 2,
      })
      .mockResolvedValueOnce({
        id: 'cycle_1',
        patient_id: 'patient_1',
        overall_status: 'ready_to_dispense',
        version: 3,
      })
      .mockResolvedValueOnce({
        id: 'cycle_1',
        patient_id: 'patient_1',
        case_id: 'case_1',
      });
    const cycleUpdateManyMock = vi.fn().mockResolvedValue({ count: 1 });
    const cycleTransitionLogCreateMock = vi.fn().mockResolvedValue({});
    const intakeCreateMock = vi.fn().mockResolvedValue({ id: 'intake_1' });
    const dispenseTaskCreateMock = vi.fn().mockResolvedValue({ id: 'task_1' });

    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        careCase: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'case_1',
            patient_id: 'patient_1',
            primary_pharmacist_id: 'pharmacist_1',
          }),
        },
        medicationCycle: {
          create: cycleCreateMock,
          findFirst: cycleFindFirstMock,
          updateMany: cycleUpdateManyMock,
        },
        cycleTransitionLog: {
          create: cycleTransitionLogCreateMock,
        },
        workflowException: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn(),
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
      }),
    );

    const response = await POST(
      createRequest({
        case_id: ' case_1 ',
        patient_id: ' patient_1 ',
        source_type: 'paper',
        prescribed_date: ` ${TODAY} `,
        prescriber_name: ' 鈴木医師 ',
        prescriber_institution: ' ',
        lines: [
          {
            line_number: 1,
            drug_name: ' アムロジピン錠5mg ',
            drug_code: ' 2149001 ',
            dosage_form: ' ',
            dose: ' 1錠 ',
            frequency: ' 1日1回朝食後 ',
            days: 14,
            packaging_instructions: ' 一包化 ',
            dispensing_method: ' unit_dose ',
            notes: ' ',
          },
        ],
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(validateOrgReferencesMock).toHaveBeenCalledWith('org_1', {
      case_id: 'case_1',
      patient_id: 'patient_1',
    });
    expect(cycleCreateMock).toHaveBeenCalledWith({
      data: {
        org_id: 'org_1',
        case_id: 'case_1',
        patient_id: 'patient_1',
        overall_status: 'intake_received',
        version: 1,
      },
    });
    expect(intakeCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        prescriber_name: '鈴木医師',
        lines: {
          create: [
            expect.objectContaining({
              drug_name: 'アムロジピン錠5mg',
              drug_code: '2149001',
              dose: '1錠',
              frequency: '1日1回朝食後',
              packaging_instructions: '一包化',
              dispensing_method: 'unit_dose',
            }),
          ],
        },
      }),
    });
    expect(dispenseTaskCreateMock).toHaveBeenCalledWith({
      data: {
        org_id: 'org_1',
        cycle_id: 'cycle_1',
        assigned_to: 'pharmacist_1',
        priority: 'normal',
        status: 'pending',
      },
    });
    expect(cycleUpdateManyMock).toHaveBeenNthCalledWith(1, {
      where: { id: 'cycle_1', org_id: 'org_1', version: 1 },
      data: expect.objectContaining({ overall_status: 'structuring' }),
    });
    expect(cycleUpdateManyMock).toHaveBeenNthCalledWith(2, {
      where: { id: 'cycle_1', org_id: 'org_1', version: 2 },
      data: expect.objectContaining({ overall_status: 'ready_to_dispense' }),
    });
    expect(cycleUpdateManyMock).toHaveBeenNthCalledWith(3, {
      where: { id: 'cycle_1', org_id: 'org_1', version: 3 },
      data: expect.objectContaining({ overall_status: 'dispensing' }),
    });
  });

  it('creates inquiry artifacts within the same prescription registration request', async () => {
    const cycleCreateMock = vi.fn().mockResolvedValue({
      id: 'cycle_2',
      patient_id: 'patient_2',
      case_id: 'case_2',
      overall_status: 'intake_received',
      version: 1,
    });
    const cycleFindFirstMock = vi
      .fn()
      .mockResolvedValueOnce({
        id: 'cycle_2',
        patient_id: 'patient_2',
        overall_status: 'intake_received',
        version: 1,
      })
      .mockResolvedValueOnce({
        id: 'cycle_2',
        patient_id: 'patient_2',
        case_id: 'case_2',
      });
    const cycleUpdateManyMock = vi.fn().mockResolvedValue({ count: 1 });
    const cycleTransitionLogCreateMock = vi.fn().mockResolvedValue({});
    const inquiryCreateMock = vi.fn().mockResolvedValue({ id: 'inq_1' });
    const communicationRequestCreateMock = vi.fn().mockResolvedValue({ id: 'comm_1' });

    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        careCase: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'case_2',
            patient_id: 'patient_2',
            primary_pharmacist_id: null,
          }),
        },
        medicationCycle: {
          create: cycleCreateMock,
          findFirst: cycleFindFirstMock,
          updateMany: cycleUpdateManyMock,
        },
        cycleTransitionLog: {
          create: cycleTransitionLogCreateMock,
        },
        workflowException: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn(),
        },
        prescriptionIntake: {
          create: vi.fn().mockResolvedValue({ id: 'intake_2' }),
        },
        inquiryRecord: {
          create: inquiryCreateMock,
          count: vi.fn().mockResolvedValue(1),
        },
        communicationRequest: {
          create: communicationRequestCreateMock,
        },
        communicationEvent: {
          create: vi.fn().mockResolvedValue({ id: 'event_1' }),
        },
        dispenseTask: {
          findFirst: vi.fn(),
          create: vi.fn(),
        },
      }),
    );

    const response = await POST(
      createRequest({
        case_id: 'case_2',
        patient_id: 'patient_2',
        source_type: 'paper',
        prescribed_date: TODAY,
        inquiry: {
          reason: '用量疑義',
          inquiry_to_physician: '山田 太郎 先生',
          inquiry_content: '用量の確認が必要です',
          request_due_date: TODAY,
        },
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
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(inquiryCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          cycle_id: 'cycle_2',
          reason: '用量疑義',
          inquiry_to_physician: '山田 太郎 先生',
        }),
      }),
    );
    expect(communicationRequestCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          patient_id: 'patient_2',
          case_id: 'case_2',
          related_entity_id: 'inq_1',
        }),
      }),
    );
    expect(upsertOperationalTaskMock).toHaveBeenCalled();
    expect(cycleUpdateManyMock).toHaveBeenCalledWith({
      where: { id: 'cycle_2', org_id: 'org_1', version: 1 },
      data: expect.objectContaining({ overall_status: 'inquiry_pending' }),
    });
  });

  it('links QR draft supplemental records when creating from the prescription edit screen', async () => {
    const cycleCreateMock = vi.fn().mockResolvedValue({
      id: 'cycle_qr',
      patient_id: 'patient_qr',
      case_id: 'case_qr',
      overall_status: 'intake_received',
      version: 1,
    });
    const cycleFindFirstMock = vi
      .fn()
      .mockResolvedValueOnce({
        id: 'cycle_qr',
        patient_id: 'patient_qr',
        overall_status: 'intake_received',
        version: 1,
      })
      .mockResolvedValueOnce({
        id: 'cycle_qr',
        patient_id: 'patient_qr',
        overall_status: 'structuring',
        version: 2,
      })
      .mockResolvedValueOnce({
        id: 'cycle_qr',
        patient_id: 'patient_qr',
        overall_status: 'ready_to_dispense',
        version: 3,
      })
      .mockResolvedValueOnce({
        id: 'cycle_qr',
        patient_id: 'patient_qr',
        case_id: 'case_qr',
      });
    const cycleUpdateManyMock = vi.fn().mockResolvedValue({ count: 1 });
    const qrDraftFindFirstMock = vi.fn().mockResolvedValue({
      id: 'draft_qr',
      status: 'pending',
      patient_id: 'patient_qr',
      parsed_data: {
        patientName: '山田 太郎',
        patientNameKana: 'ヤマダ タロウ',
        patientBirthdate: '1950-03-15',
        patientGender: 'male',
        prescriptionExpirationDate: '2026-06-12',
        lines: [
          {
            drugName: 'アムロジピン錠5mg',
            drugCode: '2149001',
            dose: '1錠',
            frequency: '1日1回朝食後',
            days: 14,
            packagingMethod: 'unit_dose',
            packagingInstructions: '一包化',
            packagingInstructionTags: ['unit_dose', 'label_required'],
            route: 'internal',
            dispensingMethod: 'unit_dose',
            notes: 'QR備考',
          },
        ],
        supplementalRecords: [
          {
            recordType: '421',
            recordLabel: '残薬確認',
            lineNumber: 4,
            fields: ['残薬あり', '1'],
            details: [{ label: '残薬内容', value: '残薬あり' }],
            summary: '残薬あり',
            rawLine: '421,残薬あり,1',
          },
        ],
        prescriptionInsurance: {
          insuranceType: '1',
          insurerNumber: '06012345',
          symbol: '記号A',
          number: '1234567',
          branchNumber: '05',
          patientCopayRatio: 30,
          publicSubsidies: [{ rank: 1, payerNumber: '54123456', recipientNumber: '7654321' }],
        },
      },
    });
    const qrDraftUpdateMock = vi.fn().mockResolvedValue({ id: 'draft_qr', status: 'confirmed' });
    const qrDraftClaimMock = vi.fn().mockResolvedValue({ count: 1 });
    const supplementalUpdateManyMock = vi.fn().mockResolvedValue({ count: 1 });
    const supplementalDeleteManyMock = vi.fn().mockResolvedValue({ count: 0 });
    const supplementalCreateManyMock = vi.fn().mockResolvedValue({ count: 2 });
    const intakeCreateMock = vi.fn().mockResolvedValue({ id: 'intake_qr' });
    const medicationIssueFindManyMock = vi.fn().mockResolvedValue([]);
    const medicationIssueCreateManyMock = vi.fn().mockResolvedValue({ count: 1 });

    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        qrScanDraft: {
          findFirst: qrDraftFindFirstMock,
          updateMany: qrDraftClaimMock,
          update: qrDraftUpdateMock,
        },
        jahisSupplementalRecord: {
          updateMany: supplementalUpdateManyMock,
          deleteMany: supplementalDeleteManyMock,
          createMany: supplementalCreateManyMock,
        },
        medicationIssue: {
          findMany: medicationIssueFindManyMock,
          createMany: medicationIssueCreateManyMock,
        },
        careCase: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'case_qr',
            patient_id: 'patient_qr',
            primary_pharmacist_id: 'pharmacist_1',
          }),
        },
        medicationCycle: {
          create: cycleCreateMock,
          findFirst: cycleFindFirstMock,
          updateMany: cycleUpdateManyMock,
        },
        cycleTransitionLog: {
          create: vi.fn().mockResolvedValue({}),
        },
        workflowException: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn(),
        },
        prescriptionIntake: {
          create: intakeCreateMock,
        },
        inquiryRecord: {
          count: vi.fn().mockResolvedValue(0),
        },
        dispenseTask: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue({ id: 'task_qr' }),
        },
      }),
    );

    const response = await POST(
      createRequest({
        case_id: 'case_qr',
        patient_id: 'patient_qr',
        qr_draft_id: 'draft_qr',
        source_type: 'qr_scan',
        prescribed_date: TODAY,
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
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(qrDraftClaimMock).toHaveBeenCalledWith({
      where: {
        id: 'draft_qr',
        org_id: 'org_1',
        status: 'pending',
      },
      data: {
        patient_id: 'patient_qr',
        status: 'confirmed',
      },
    });
    expect(intakeCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        prescription_expiry_date: new Date('2026-06-12T00:00:00.000Z'),
        lines: {
          create: [
            expect.objectContaining({
              drug_name: 'アムロジピン錠5mg',
              packaging_method: 'unit_dose',
              packaging_instructions: '一包化',
              packaging_instruction_tags: ['unit_dose', 'label_required'],
              route: 'internal',
              dispensing_method: 'unit_dose',
              notes: 'QR備考',
            }),
          ],
        },
      }),
    });
    expect(supplementalUpdateManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        qr_draft_id: 'draft_qr',
        prescription_intake_id: null,
      },
      data: {
        patient_id: 'patient_qr',
        prescription_intake_id: 'intake_qr',
      },
    });
    expect(supplementalCreateManyMock).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          org_id: 'org_1',
          patient_id: 'patient_qr',
          qr_draft_id: 'draft_qr',
          prescription_intake_id: 'intake_qr',
          record_type: 'prescription_insurance',
          record_label: '処方QR保険情報',
        }),
        expect.objectContaining({
          org_id: 'org_1',
          patient_id: 'patient_qr',
          qr_draft_id: 'draft_qr',
          prescription_intake_id: 'intake_qr',
          record_type: 'prescription_public_subsidy',
          record_label: '処方QR公費情報',
        }),
      ],
    });
    expect(medicationIssueCreateManyMock).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          org_id: 'org_1',
          patient_id: 'patient_qr',
          case_id: 'case_qr',
          title: expect.stringContaining('服薬状況確認候補'),
          description: expect.stringContaining('[qr_supplemental:intake_qr:421:4]'),
          status: 'open',
          priority: 'medium',
          category: 'adherence',
          identified_by: 'user_1',
        }),
      ],
    });
    expect(qrDraftUpdateMock).toHaveBeenCalledWith({
      where: { id: 'draft_qr' },
      data: expect.objectContaining({
        patient_id: 'patient_qr',
        status: 'confirmed',
        confirmed_intake_id: 'intake_qr',
        raw_qr_texts: [],
        qr_payload_hash: null,
        parsed_data: expect.objectContaining({
          confirmed: true,
          confirmed_intake_id: 'intake_qr',
        }),
        expected_qr_count: null,
      }),
    });
    expect(broadcastOrgRealtimeEventMock).toHaveBeenCalledWith({
      orgId: 'org_1',
      type: 'qr_draft_confirmed',
    });
    expect(notifyWorkflowMutationMock).toHaveBeenCalledWith({
      orgId: 'org_1',
      payload: { source: 'prescription_intakes_create' },
    });
    expect(notifyWebhookEventForOrgMock).toHaveBeenCalledWith(
      'org_1',
      'prescription.created',
      expect.objectContaining({
        intakeId: 'intake_qr',
        cycleId: 'cycle_qr',
        patientId: 'patient_qr',
        sourceType: 'qr_scan',
      }),
    );
  });

  it('rejects QR draft imports when submitted lines do not match the draft lines', async () => {
    const qrDraftClaimMock = vi.fn();
    const intakeCreateMock = vi.fn();
    const supplementalUpdateManyMock = vi.fn();

    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        qrScanDraft: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'draft_qr',
            status: 'pending',
            patient_id: 'patient_qr',
            parsed_data: {
              patientName: '山田 太郎',
              patientNameKana: 'ヤマダ タロウ',
              patientBirthdate: '1950-03-15',
              patientGender: 'male',
              lines: [
                {
                  drugName: 'アムロジピン錠5mg',
                  drugCode: '2149001',
                  dose: '1錠',
                  frequency: '1日1回朝食後',
                  days: 14,
                },
              ],
            },
          }),
          updateMany: qrDraftClaimMock,
          update: vi.fn(),
        },
        jahisSupplementalRecord: {
          updateMany: supplementalUpdateManyMock,
        },
        careCase: {
          findFirst: vi.fn(),
        },
        medicationCycle: {
          create: vi.fn(),
          findFirst: vi.fn(),
          updateMany: vi.fn(),
        },
        cycleTransitionLog: {
          create: vi.fn(),
        },
        workflowException: {
          findFirst: vi.fn(),
          create: vi.fn(),
        },
        prescriptionIntake: {
          create: intakeCreateMock,
        },
        inquiryRecord: {
          count: vi.fn(),
        },
        dispenseTask: {
          findFirst: vi.fn(),
          create: vi.fn(),
        },
      }),
    );

    const response = await POST(
      createRequest({
        case_id: 'case_qr',
        patient_id: 'patient_qr',
        qr_draft_id: 'draft_qr',
        source_type: 'qr_scan',
        prescribed_date: TODAY,
        lines: [
          {
            line_number: 1,
            drug_name: '前回処方由来の別薬剤',
            drug_code: '9999999',
            dose: '2錠',
            frequency: '1日2回朝夕食後',
            days: 28,
          },
        ],
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'QR下書きの処方明細と送信された処方明細が一致しません',
      details: {
        mismatches: expect.arrayContaining([
          'line_1_drug_code',
          'line_1_drug_name',
          'line_1_dose',
          'line_1_frequency',
          'line_1_days',
        ]),
      },
    });
    expect(qrDraftClaimMock).not.toHaveBeenCalled();
    expect(intakeCreateMock).not.toHaveBeenCalled();
    expect(supplementalUpdateManyMock).not.toHaveBeenCalled();
    expect(broadcastOrgRealtimeEventMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
    expect(notifyWebhookEventForOrgMock).not.toHaveBeenCalled();
  });

  it('rejects QR draft imports when submitted optional line values are absent from the draft', async () => {
    const qrDraftClaimMock = vi.fn();
    const intakeCreateMock = vi.fn();
    const supplementalUpdateManyMock = vi.fn();

    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        qrScanDraft: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'draft_qr',
            status: 'pending',
            patient_id: 'patient_qr',
            parsed_data: {
              patientName: '山田 太郎',
              patientNameKana: 'ヤマダ タロウ',
              patientBirthdate: '1950-03-15',
              patientGender: 'male',
              lines: [
                {
                  drugName: 'アムロジピン錠5mg',
                  dose: '1錠',
                  frequency: '1日1回朝食後',
                  days: 14,
                },
              ],
            },
          }),
          updateMany: qrDraftClaimMock,
          update: vi.fn(),
        },
        jahisSupplementalRecord: {
          updateMany: supplementalUpdateManyMock,
        },
        careCase: {
          findFirst: vi.fn(),
        },
        medicationCycle: {
          create: vi.fn(),
          findFirst: vi.fn(),
          updateMany: vi.fn(),
        },
        cycleTransitionLog: {
          create: vi.fn(),
        },
        workflowException: {
          findFirst: vi.fn(),
          create: vi.fn(),
        },
        prescriptionIntake: {
          create: intakeCreateMock,
        },
        inquiryRecord: {
          count: vi.fn(),
        },
        dispenseTask: {
          findFirst: vi.fn(),
          create: vi.fn(),
        },
      }),
    );

    const response = await POST(
      createRequest({
        case_id: 'case_qr',
        patient_id: 'patient_qr',
        qr_draft_id: 'draft_qr',
        source_type: 'qr_scan',
        prescribed_date: TODAY,
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
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'QR下書きの処方明細と送信された処方明細が一致しません',
      details: {
        mismatches: ['line_1_drug_code'],
      },
    });
    expect(qrDraftClaimMock).not.toHaveBeenCalled();
    expect(intakeCreateMock).not.toHaveBeenCalled();
    expect(supplementalUpdateManyMock).not.toHaveBeenCalled();
    expect(broadcastOrgRealtimeEventMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
    expect(notifyWebhookEventForOrgMock).not.toHaveBeenCalled();
  });

  it('rejects qr_draft_id imports unless source_type is qr_scan', async () => {
    const response = await POST(
      createRequest({
        case_id: 'case_qr',
        patient_id: 'patient_qr',
        qr_draft_id: 'draft_qr',
        source_type: 'fax',
        prescribed_date: TODAY,
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
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'QRスキャン下書きからの登録はQRスキャンの受付種別のみ指定できます',
    });
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(upsertOperationalTaskMock).not.toHaveBeenCalled();
    expect(broadcastOrgRealtimeEventMock).not.toHaveBeenCalled();
    expect(notifyWebhookEventForOrgMock).not.toHaveBeenCalled();
  });

  it('rejects QR draft imports when parsed_data cannot prove patient identity', async () => {
    const qrDraftClaimMock = vi.fn();
    const intakeCreateMock = vi.fn();
    const supplementalUpdateManyMock = vi.fn().mockResolvedValue({ count: 0 });
    const supplementalDeleteManyMock = vi.fn();
    const supplementalCreateManyMock = vi.fn();

    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        qrScanDraft: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'draft_qr',
            status: 'pending',
            patient_id: 'patient_qr',
            parsed_data: ['unexpected'],
          }),
          updateMany: qrDraftClaimMock,
          update: vi.fn().mockResolvedValue({ id: 'draft_qr', status: 'confirmed' }),
        },
        jahisSupplementalRecord: {
          updateMany: supplementalUpdateManyMock,
          deleteMany: supplementalDeleteManyMock,
          createMany: supplementalCreateManyMock,
        },
        careCase: {
          findFirst: vi.fn(),
        },
        medicationCycle: {
          create: vi.fn(),
          findFirst: vi.fn(),
          updateMany: vi.fn(),
        },
        cycleTransitionLog: {
          create: vi.fn().mockResolvedValue({}),
        },
        workflowException: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn(),
        },
        prescriptionIntake: {
          create: intakeCreateMock,
        },
        inquiryRecord: {
          count: vi.fn(),
        },
        dispenseTask: {
          findFirst: vi.fn(),
          create: vi.fn(),
        },
      }),
    );

    const response = await POST(
      createRequest({
        case_id: 'case_qr',
        patient_id: 'patient_qr',
        qr_draft_id: 'draft_qr',
        source_type: 'qr_scan',
        prescribed_date: TODAY,
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
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'QRコードの患者情報を確認できません',
      details: {
        missing_identity: ['name', 'birth_date'],
      },
    });
    expect(qrDraftClaimMock).not.toHaveBeenCalled();
    expect(intakeCreateMock).not.toHaveBeenCalled();
    expect(supplementalUpdateManyMock).not.toHaveBeenCalled();
    expect(supplementalDeleteManyMock).not.toHaveBeenCalled();
    expect(supplementalCreateManyMock).not.toHaveBeenCalled();
    expect(broadcastOrgRealtimeEventMock).not.toHaveBeenCalled();
  });

  it('rejects QR draft imports when parsed patient identity differs from the selected patient', async () => {
    const qrDraftClaimMock = vi.fn();
    const intakeCreateMock = vi.fn();
    const supplementalUpdateManyMock = vi.fn();

    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        qrScanDraft: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'draft_qr',
            status: 'pending',
            patient_id: 'patient_qr',
            parsed_data: {
              patientName: '山田 太郎',
              patientBirthdate: '1940-01-01',
            },
          }),
          updateMany: qrDraftClaimMock,
          update: vi.fn(),
        },
        jahisSupplementalRecord: {
          updateMany: supplementalUpdateManyMock,
        },
        careCase: {
          findFirst: vi.fn(),
        },
        medicationCycle: {
          create: vi.fn(),
          findFirst: vi.fn(),
          updateMany: vi.fn(),
        },
        cycleTransitionLog: {
          create: vi.fn(),
        },
        workflowException: {
          findFirst: vi.fn(),
          create: vi.fn(),
        },
        prescriptionIntake: {
          create: intakeCreateMock,
        },
        inquiryRecord: {
          count: vi.fn(),
        },
        dispenseTask: {
          findFirst: vi.fn(),
          create: vi.fn(),
        },
      }),
    );

    const response = await POST(
      createRequest({
        case_id: 'case_qr',
        patient_id: 'patient_qr',
        qr_draft_id: 'draft_qr',
        source_type: 'qr_scan',
        prescribed_date: TODAY,
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
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'QRコードの患者情報が選択患者と一致しません',
      details: {
        mismatches: ['birth_date'],
      },
    });
    expect(qrDraftClaimMock).not.toHaveBeenCalled();
    expect(intakeCreateMock).not.toHaveBeenCalled();
    expect(supplementalUpdateManyMock).not.toHaveBeenCalled();
    expect(broadcastOrgRealtimeEventMock).not.toHaveBeenCalled();
  });

  it('returns conflict without intake side effects when QR draft claim is lost', async () => {
    const qrDraftClaimMock = vi.fn().mockResolvedValue({ count: 0 });
    const intakeCreateMock = vi.fn();
    const supplementalUpdateManyMock = vi.fn();

    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        qrScanDraft: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'draft_qr',
            status: 'pending',
            patient_id: 'patient_qr',
            parsed_data: {
              patientName: '山田 太郎',
              patientBirthdate: '1950-03-15',
              lines: [
                {
                  drugName: 'アムロジピン錠5mg',
                  drugCode: '2149001',
                  dose: '1錠',
                  frequency: '1日1回朝食後',
                  days: 14,
                },
              ],
            },
          }),
          updateMany: qrDraftClaimMock,
          update: vi.fn(),
        },
        jahisSupplementalRecord: {
          updateMany: supplementalUpdateManyMock,
        },
        careCase: {
          findFirst: vi.fn(),
        },
        medicationCycle: {
          create: vi.fn(),
          findFirst: vi.fn(),
          updateMany: vi.fn(),
        },
        cycleTransitionLog: {
          create: vi.fn(),
        },
        workflowException: {
          findFirst: vi.fn(),
          create: vi.fn(),
        },
        prescriptionIntake: {
          create: intakeCreateMock,
        },
        inquiryRecord: {
          count: vi.fn(),
        },
        dispenseTask: {
          findFirst: vi.fn(),
          create: vi.fn(),
        },
      }),
    );

    const response = await POST(
      createRequest({
        case_id: 'case_qr',
        patient_id: 'patient_qr',
        qr_draft_id: 'draft_qr',
        source_type: 'qr_scan',
        prescribed_date: TODAY,
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
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      message: 'このQRスキャン下書きはすでに処理済みです',
    });
    expect(intakeCreateMock).not.toHaveBeenCalled();
    expect(supplementalUpdateManyMock).not.toHaveBeenCalled();
    expect(broadcastOrgRealtimeEventMock).not.toHaveBeenCalled();
  });

  it('creates a fax original follow-up task for fax-based prescription intake', async () => {
    const cycleCreateMock = vi.fn().mockResolvedValue({
      id: 'cycle_3',
      patient_id: 'patient_3',
      case_id: 'case_3',
      overall_status: 'intake_received',
      version: 1,
    });
    const cycleFindFirstMock = vi
      .fn()
      .mockResolvedValueOnce({
        id: 'cycle_3',
        patient_id: 'patient_3',
        overall_status: 'intake_received',
        version: 1,
      })
      .mockResolvedValueOnce({
        id: 'cycle_3',
        patient_id: 'patient_3',
        overall_status: 'structuring',
        version: 2,
      })
      .mockResolvedValueOnce({
        id: 'cycle_3',
        patient_id: 'patient_3',
        overall_status: 'ready_to_dispense',
        version: 3,
      })
      .mockResolvedValueOnce({
        id: 'cycle_3',
        patient_id: 'patient_3',
        case_id: 'case_3',
      });
    const cycleUpdateManyMock = vi.fn().mockResolvedValue({ count: 1 });

    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        careCase: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'case_3',
            patient_id: 'patient_3',
            primary_pharmacist_id: 'pharmacist_3',
          }),
        },
        medicationCycle: {
          create: cycleCreateMock,
          findFirst: cycleFindFirstMock,
          updateMany: cycleUpdateManyMock,
        },
        cycleTransitionLog: {
          create: vi.fn().mockResolvedValue({}),
        },
        workflowException: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn(),
        },
        prescriptionIntake: {
          create: vi.fn().mockResolvedValue({ id: 'intake_3' }),
        },
        inquiryRecord: {
          count: vi.fn().mockResolvedValue(0),
        },
        dispenseTask: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue({ id: 'task_3' }),
        },
      }),
    );

    const response = await POST(
      createRequest({
        case_id: 'case_3',
        patient_id: 'patient_3',
        source_type: 'fax',
        prescribed_date: TODAY,
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
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(upsertOperationalTaskMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        orgId: 'org_1',
        taskType: 'fax_original_followup',
        relatedEntityType: 'prescription_intake',
        relatedEntityId: 'intake_3',
      }),
    );
  });

  it('auto-creates a dispense task and moves the cycle to dispensing when no inquiry exists', async () => {
    const cycleUpdateManyMock = vi.fn().mockResolvedValue({ count: 1 });
    const cycleTransitionLogCreateMock = vi.fn().mockResolvedValue({});
    const intakeCreateMock = vi.fn().mockResolvedValue({
      id: 'intake_1',
      lines: [],
    });
    const dispenseTaskCreateMock = vi.fn().mockResolvedValue({ id: 'task_1' });

    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        medicationCycle: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'cycle_1',
            patient_id: 'patient_1',
            overall_status: 'ready_to_dispense',
            version: 1,
            case_: {
              primary_pharmacist_id: 'pharmacist_1',
            },
            prescription_intakes: [],
            dispense_tasks: [],
          }),
          updateMany: cycleUpdateManyMock,
        },
        cycleTransitionLog: {
          create: cycleTransitionLogCreateMock,
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
      }),
    );

    const response = await POST(
      createRequest({
        cycle_id: 'cycle_1',
        source_type: 'paper',
        prescribed_date: TODAY,
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
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(notifyWorkflowMutationMock).toHaveBeenCalledWith({
      orgId: 'org_1',
      payload: { source: 'prescription_intakes_create' },
    });
    expect(dispenseTaskCreateMock).toHaveBeenCalledWith({
      data: {
        org_id: 'org_1',
        cycle_id: 'cycle_1',
        assigned_to: 'pharmacist_1',
        priority: 'normal',
        status: 'pending',
      },
    });
    expect(cycleUpdateManyMock).toHaveBeenCalledWith({
      where: { id: 'cycle_1', org_id: 'org_1', version: 1 },
      data: expect.objectContaining({ overall_status: 'dispensing' }),
    });
  });

  it('raises dispense task priority for emergency prescriptions', async () => {
    const cycleUpdateManyMock = vi.fn().mockResolvedValue({ count: 1 });
    const cycleTransitionLogCreateMock = vi.fn().mockResolvedValue({});
    const dispenseTaskCreateMock = vi.fn().mockResolvedValue({ id: 'task_emergency_1' });

    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        medicationCycle: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'cycle_emergency_1',
            patient_id: 'patient_1',
            overall_status: 'ready_to_dispense',
            version: 1,
            case_: {
              primary_pharmacist_id: 'pharmacist_1',
            },
            prescription_intakes: [],
            dispense_tasks: [],
          }),
          updateMany: cycleUpdateManyMock,
        },
        cycleTransitionLog: {
          create: cycleTransitionLogCreateMock,
        },
        prescriptionIntake: {
          create: vi.fn().mockResolvedValue({
            id: 'intake_emergency_1',
            lines: [],
          }),
        },
        inquiryRecord: {
          count: vi.fn().mockResolvedValue(0),
        },
        dispenseTask: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: dispenseTaskCreateMock,
        },
      }),
    );

    const response = await POST(
      createRequest({
        cycle_id: 'cycle_emergency_1',
        source_type: 'paper',
        prescribed_date: TODAY,
        prescription_category: 'emergency',
        emergency_category: 'other_exacerbation',
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
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(dispenseTaskCreateMock).toHaveBeenCalledWith({
      data: {
        org_id: 'org_1',
        cycle_id: 'cycle_emergency_1',
        assigned_to: 'pharmacist_1',
        priority: 'emergency',
        status: 'pending',
      },
    });
  });
});

describe('/api/prescription-intakes GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prescriptionIntakeFindManyMock.mockResolvedValue([
      {
        id: 'intake_2',
        cycle_id: 'cycle_2',
        source_type: 'paper',
        prescribed_date: new Date('2026-03-30T00:00:00.000Z'),
        prescriber_name: '医師B',
        prescriber_institution_id: null,
        prescriber_institution: null,
        prescription_expiry_date: null,
        refill_remaining_count: null,
        refill_next_dispense_date: null,
        created_at: new Date('2026-03-30T10:00:00.000Z'),
        cycle: {
          overall_status: 'intake',
          patient_id: 'patient_2',
        },
      },
      {
        id: 'intake_1',
        cycle_id: 'cycle_1',
        source_type: 'paper',
        prescribed_date: new Date('2026-03-30T00:00:00.000Z'),
        prescriber_name: '医師A',
        prescriber_institution_id: null,
        prescriber_institution: null,
        prescription_expiry_date: null,
        refill_remaining_count: null,
        refill_next_dispense_date: null,
        created_at: new Date('2026-03-30T10:00:00.000Z'),
        cycle: {
          overall_status: 'intake',
          patient_id: 'patient_1',
        },
      },
    ]);
  });

  it('uses a stable created_at/id ordering for cursor pagination', async () => {
    const response = await GET(
      createGetRequest('http://localhost/api/prescription-intakes?cursor=intake_2'),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(prescriptionIntakeFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        cursor: { id: 'intake_2' },
        skip: 1,
        orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      }),
    );
  });

  it('passes status and source filters into the paginated query', async () => {
    const response = await GET(
      createGetRequest(
        'http://localhost/api/prescription-intakes?limit=25&status=inquiry_pending&source_type=fax',
      ),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(prescriptionIntakeFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 26,
        where: expect.objectContaining({
          org_id: 'org_1',
          source_type: 'fax',
          cycle: {
            overall_status: 'inquiry_pending',
          },
        }),
      }),
    );
    expect(prescriptionIntakeCountMock).not.toHaveBeenCalled();
  });

  it('passes care tag filters into the paginated query', async () => {
    const response = await GET(
      createGetRequest('http://localhost/api/prescription-intakes?care_tags=narcotic,cold_storage'),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(prescriptionIntakeFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          lines: {
            some: {
              packaging_instruction_tags: {
                hasSome: ['narcotic', 'cold_storage'],
              },
            },
          },
        }),
      }),
    );
  });

  it('rejects unsupported care tag filters before querying intakes', async () => {
    const response = await GET(
      createGetRequest('http://localhost/api/prescription-intakes?care_tags=prescription_change'),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '注意ポイントの絞り込みが不正です',
      details: {
        care_tags: ['対応していない注意ポイントです'],
      },
    });
    expect(prescriptionIntakeFindManyMock).not.toHaveBeenCalled();
    expect(prescriptionIntakeCountMock).not.toHaveBeenCalled();
  });

  it('rejects unsupported status filters before querying intakes', async () => {
    const response = await GET(
      createGetRequest('http://localhost/api/prescription-intakes?status=bad_status'),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(prescriptionIntakeFindManyMock).not.toHaveBeenCalled();
    expect(prescriptionIntakeCountMock).not.toHaveBeenCalled();
  });

  it('rejects unsupported source filters before querying intakes', async () => {
    const response = await GET(
      createGetRequest('http://localhost/api/prescription-intakes?source_type=bad_source'),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(prescriptionIntakeFindManyMock).not.toHaveBeenCalled();
    expect(prescriptionIntakeCountMock).not.toHaveBeenCalled();
  });

  it('returns optional totalCount from the same assignment and filter where', async () => {
    const response = await GET(
      createGetRequest(
        'http://localhost/api/prescription-intakes?limit=1&status=ready_to_dispense&source_type=paper&include_total=1',
      ),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    const findManyArgs = prescriptionIntakeFindManyMock.mock.calls[0]?.[0];
    expect(findManyArgs).toEqual(
      expect.objectContaining({
        take: 2,
        where: expect.objectContaining({
          org_id: 'org_1',
          source_type: 'paper',
          cycle: {
            overall_status: 'ready_to_dispense',
          },
        }),
      }),
    );
    expect(prescriptionIntakeCountMock).toHaveBeenCalledWith({ where: findManyArgs.where });
    await expect(response.json()).resolves.toMatchObject({
      data: [{ id: 'intake_2' }],
      hasMore: true,
      nextCursor: 'intake_2',
      totalCount: 2,
    });
  });

  it('applies server-side q search with the same count where and returns a minimal response', async () => {
    prescriptionIntakeFindManyMock.mockResolvedValueOnce([
      {
        id: 'intake_search_1',
        prescribed_date: new Date('2026-03-30T00:00:00.000Z'),
        prescriber_name: '佐藤 医師',
        prescriber_institution: '旧クリニック名',
        prescriber_institution_ref: {
          name: '在宅クリニック',
        },
        original_document_url: 's3://private/prescription.pdf',
        lines: [
          {
            drug_name: 'アムロジピン錠5mg',
            dose: '1錠',
            frequency: '1日1回朝食後',
            notes: 'raw line note',
          },
        ],
        cycle: {
          overall_status: 'intake',
          case_: {
            patient: {
              name: '山田 太郎',
              name_kana: 'ヤマダ タロウ',
            },
          },
        },
      },
      {
        id: 'intake_search_2',
        prescribed_date: new Date('2026-03-29T00:00:00.000Z'),
        prescriber_name: '鈴木 医師',
        prescriber_institution: null,
        prescriber_institution_ref: null,
        cycle: {
          overall_status: 'ready_to_dispense',
          case_: {
            patient: {
              name: '山田 花子',
              name_kana: 'ヤマダ ハナコ',
            },
          },
        },
      },
    ]);

    const response = await GET(
      createGetRequest(
        'http://localhost/api/prescription-intakes?q=%E5%B1%B1%E7%94%B0&limit=1&include_total=1',
      ),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    const findManyArgs = prescriptionIntakeFindManyMock.mock.calls[0]?.[0];
    expect(findManyArgs).toEqual(
      expect.objectContaining({
        take: 2,
        where: expect.objectContaining({
          org_id: 'org_1',
          AND: [
            expect.objectContaining({
              OR: expect.arrayContaining([
                { rx_number: { contains: '山田', mode: 'insensitive' } },
                { prescriber_name: { contains: '山田', mode: 'insensitive' } },
                { prescriber_institution: { contains: '山田', mode: 'insensitive' } },
                {
                  prescriber_institution_ref: {
                    is: { name: { contains: '山田', mode: 'insensitive' } },
                  },
                },
                {
                  cycle: {
                    case_: {
                      patient: {
                        OR: [
                          { name: { contains: '山田', mode: 'insensitive' } },
                          { name_kana: { contains: '山田', mode: 'insensitive' } },
                        ],
                      },
                    },
                  },
                },
              ]),
            }),
          ],
        }),
      }),
    );
    expect(findManyArgs.select).toEqual({
      id: true,
      prescribed_date: true,
      prescriber_name: true,
      prescriber_institution: true,
      prescriber_institution_ref: {
        select: {
          name: true,
        },
      },
      cycle: {
        select: {
          overall_status: true,
          case_: {
            select: {
              patient: {
                select: { name: true, name_kana: true },
              },
            },
          },
        },
      },
    });
    expect(findManyArgs.select).not.toHaveProperty('lines');
    expect(findManyArgs.select).not.toHaveProperty('original_document_url');
    expect(prescriptionIntakeCountMock).toHaveBeenCalledWith({ where: findManyArgs.where });
    const body = await response.json();
    expect(body).toEqual({
      data: [
        {
          id: 'intake_search_1',
          prescribed_date: '2026-03-30T00:00:00.000Z',
          prescriber_name: '佐藤 医師',
          prescriber_institution: {
            name: '在宅クリニック',
          },
          cycle: {
            overall_status: 'intake',
            case_: {
              patient: {
                name: '山田 太郎',
                name_kana: 'ヤマダ タロウ',
              },
            },
          },
        },
      ],
      hasMore: true,
      nextCursor: 'intake_search_1',
      totalCount: 2,
    });
    expect(body.data[0]).not.toHaveProperty('lines');
    expect(body.data[0]).not.toHaveProperty('original_document_url');
    expect(body.data[0]).not.toHaveProperty('prescriber_institution_ref');
  });
});
