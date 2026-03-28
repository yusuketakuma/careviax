import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const { withAuthMock, withOrgContextMock } = vi.hoisted(() => ({
  withAuthMock: vi.fn((
    handler: (req: NextRequest & { orgId: string; userId: string }) => Promise<Response>
  ) => {
    return (req: NextRequest) =>
      handler({
        ...req,
        orgId: 'org_1',
        userId: 'user_1',
      } as NextRequest & { orgId: string; userId: string });
  }),
  withOrgContextMock: vi.fn(),
}));

vi.mock('@/lib/auth/middleware', () => ({
  withAuth: withAuthMock,
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {},
}));

import { POST } from './route';

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
      })
    );

    const response = await POST(
      createRequest({
        cycle_id: 'cycle_1',
        source_type: 'refill',
        prescribed_date: '2026-03-28',
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
      })
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
      })
    );

    const response = await POST(
      createRequest({
        cycle_id: 'cycle_1',
        source_type: 'paper',
        prescribed_date: '2026-03-28',
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
      })
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
      })
    );

    const response = await POST(
      createRequest({
        cycle_id: 'cycle_1',
        source_type: 'paper',
        prescribed_date: '2026-03-28',
        lines: [
          {
            line_number: 1,
            drug_name: '薬剤名確認中',
            dose: '1錠',
            frequency: '1日1回朝食後',
            days: 7,
          },
        ],
      })
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
      })
    );
    expect(intakeCreateMock).not.toHaveBeenCalled();
  });

  it('rejects split dispenses when total and current counts are incomplete', async () => {
    const response = await POST(
      createRequest({
        cycle_id: 'cycle_1',
        source_type: 'paper',
        prescribed_date: '2026-03-28',
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
      })
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
        prescribed_date: '2026-03-28',
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
      })
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '分割調剤の途中回は次回調剤予定日が必須です',
    });
  });
});
