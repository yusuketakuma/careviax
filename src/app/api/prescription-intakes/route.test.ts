import { beforeEach, describe, expect, it, vi } from 'vitest';
import { format } from 'date-fns';
import type { NextRequest } from 'next/server';

/** 今日の日付文字列（有効期限チェックを通過させるため動的に生成） */
const TODAY = format(new Date(), 'yyyy-MM-dd');

const {
  withAuthMock,
  withOrgContextMock,
  prescriptionIntakeFindManyMock,
  validateOrgReferencesMock,
  upsertOperationalTaskMock,
  careCaseFindFirstMock,
} = vi.hoisted(() => ({
  withAuthMock: vi.fn(
    (handler: (req: NextRequest & { orgId: string; userId: string }) => Promise<Response>) => {
      return (req: NextRequest) =>
        handler({
          ...req,
          orgId: 'org_1',
          userId: 'user_1',
        } as NextRequest & { orgId: string; userId: string });
    },
  ),
  withOrgContextMock: vi.fn(),
  prescriptionIntakeFindManyMock: vi.fn(),
  validateOrgReferencesMock: vi.fn().mockResolvedValue({ ok: true }),
  upsertOperationalTaskMock: vi.fn().mockResolvedValue({ id: 'task_operational_1' }),
  careCaseFindFirstMock: vi.fn().mockResolvedValue({ id: 'case_1' }),
}));

vi.mock('@/lib/auth/middleware', () => ({
  withAuth: withAuthMock,
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

vi.mock('@/lib/db/client', () => ({
  prisma: {
    prescriptionIntake: {
      findMany: prescriptionIntakeFindManyMock,
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
    },
  },
}));

import { GET, POST } from './route';

function createRequest(body: unknown) {
  return {
    json: async () => body,
  } as unknown as NextRequest;
}

describe('/api/prescription-intakes POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
        case_id: 'case_1',
        patient_id: 'patient_1',
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
      where: { id: 'cycle_1', version: 1 },
      data: expect.objectContaining({ overall_status: 'structuring' }),
    });
    expect(cycleUpdateManyMock).toHaveBeenNthCalledWith(2, {
      where: { id: 'cycle_1', version: 2 },
      data: expect.objectContaining({ overall_status: 'ready_to_dispense' }),
    });
    expect(cycleUpdateManyMock).toHaveBeenNthCalledWith(3, {
      where: { id: 'cycle_1', version: 3 },
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
      where: { id: 'cycle_2', version: 1 },
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
      },
    });
    const qrDraftUpdateMock = vi.fn().mockResolvedValue({ id: 'draft_qr', status: 'confirmed' });
    const supplementalUpdateManyMock = vi.fn().mockResolvedValue({ count: 1 });

    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        qrScanDraft: {
          findFirst: qrDraftFindFirstMock,
          update: qrDraftUpdateMock,
        },
        jahisSupplementalRecord: {
          updateMany: supplementalUpdateManyMock,
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
          create: vi.fn().mockResolvedValue({ id: 'intake_qr' }),
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
    expect(qrDraftUpdateMock).toHaveBeenCalledWith({
      where: { id: 'draft_qr' },
      data: {
        patient_id: 'patient_qr',
        status: 'confirmed',
        confirmed_intake_id: 'intake_qr',
      },
    });
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
      where: { id: 'cycle_1', version: 1 },
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
    const response = await GET({
      url: 'http://localhost/api/prescription-intakes?cursor=intake_2',
    } as NextRequest);

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
});
