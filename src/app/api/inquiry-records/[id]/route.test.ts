import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  withOrgContextMock,
  inquiryRecordFindFirstMock,
  resolveOperationalTasksMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  inquiryRecordFindFirstMock: vi.fn(),
  resolveOperationalTasksMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    inquiryRecord: {
      findFirst: inquiryRecordFindFirstMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/server/services/operational-tasks', () => ({
  resolveOperationalTasks: resolveOperationalTasksMock,
}));

import { PATCH } from './route';

function createRequest(body: unknown) {
  return {
    json: async () => body,
  } as unknown as NextRequest;
}

describe('/api/inquiry-records/[id] PATCH', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: 'org_1',
        userId: 'user_1',
      },
    });
  });

  it('updates the linked prescription line when confirming a changed inquiry', async () => {
    inquiryRecordFindFirstMock.mockResolvedValue({
      id: 'inquiry_1',
      cycle_id: 'cycle_1',
      line_id: 'line_1',
      issue_id: 'issue_1',
      result: 'pending',
    });

    const lineUpdateMock = vi.fn().mockResolvedValue({});
    const inquiryUpdateMock = vi.fn().mockResolvedValue({
      id: 'inquiry_1',
      result: 'changed',
      change_detail: '1日2回へ変更',
    });
    const inquiryCountMock = vi.fn().mockResolvedValue(0);
    const cycleUpdateMock = vi.fn().mockResolvedValue({});

    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        prescriptionLine: {
          update: lineUpdateMock,
        },
        inquiryRecord: {
          update: inquiryUpdateMock,
          count: inquiryCountMock,
        },
        medicationCycle: {
          update: cycleUpdateMock,
        },
        communicationRequest: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        medicationIssue: {
          update: vi.fn().mockResolvedValue({}),
        },
      }),
    );

    const response = await PATCH(
      createRequest({
        result: 'changed',
        change_detail: '1日2回へ変更',
        line_update: {
          drug_name: 'アムロジピン錠5mg',
          dose: '1錠',
          frequency: '1日2回',
          days: 14,
        },
      }),
      { params: Promise.resolve({ id: 'inquiry_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(lineUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'line_1' },
        data: expect.objectContaining({
          frequency: '1日2回',
          days: 14,
        }),
      }),
    );
    expect(cycleUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { overall_status: 'inquiry_resolved' },
      }),
    );
    expect(resolveOperationalTasksMock).toHaveBeenCalled();
  });

  it('persists structured inquiry fields when provided', async () => {
    inquiryRecordFindFirstMock.mockResolvedValue({
      id: 'inquiry_1',
      cycle_id: 'cycle_1',
      line_id: null,
      issue_id: null,
      result: 'pending',
    });

    const inquiryUpdateMock = vi.fn().mockResolvedValue({
      id: 'inquiry_1',
      result: 'unchanged',
      proposal_origin: 'pre_issuance',
      residual_adjustment: true,
    });

    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        prescriptionLine: {
          update: vi.fn().mockResolvedValue({}),
        },
        inquiryRecord: {
          update: inquiryUpdateMock,
          count: vi.fn().mockResolvedValue(0),
        },
        medicationCycle: {
          update: vi.fn().mockResolvedValue({}),
        },
        communicationRequest: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        medicationIssue: {
          update: vi.fn().mockResolvedValue({}),
        },
      }),
    );

    const response = await PATCH(
      createRequest({
        result: 'unchanged',
        proposal_origin: 'pre_issuance',
        residual_adjustment: true,
      }),
      { params: Promise.resolve({ id: 'inquiry_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(inquiryUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          proposal_origin: 'pre_issuance',
          residual_adjustment: true,
        }),
      }),
    );
  });

  it('keeps the cycle in inquiry_pending when other unresolved inquiries remain', async () => {
    inquiryRecordFindFirstMock.mockResolvedValue({
      id: 'inquiry_1',
      cycle_id: 'cycle_1',
      line_id: null,
      issue_id: 'issue_1',
      result: 'pending',
    });

    const cycleUpdateMock = vi.fn().mockResolvedValue({});

    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        prescriptionLine: {
          update: vi.fn().mockResolvedValue({}),
        },
        inquiryRecord: {
          update: vi.fn().mockResolvedValue({
            id: 'inquiry_1',
            result: 'unchanged',
          }),
          count: vi.fn().mockResolvedValue(1),
        },
        medicationCycle: {
          update: cycleUpdateMock,
        },
        communicationRequest: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        medicationIssue: {
          update: vi.fn().mockResolvedValue({}),
        },
      }),
    );

    const response = await PATCH(
      createRequest({
        result: 'unchanged',
        change_detail: '変更なし',
      }),
      { params: Promise.resolve({ id: 'inquiry_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(cycleUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { overall_status: 'inquiry_pending' },
      }),
    );
  });

  it('rejects changed confirmations without a line update for line-specific inquiries', async () => {
    inquiryRecordFindFirstMock.mockResolvedValue({
      id: 'inquiry_1',
      cycle_id: 'cycle_1',
      line_id: 'line_1',
      issue_id: 'issue_1',
      result: 'pending',
    });

    const response = await PATCH(
      createRequest({
        result: 'changed',
        change_detail: '変更あり',
      }),
      { params: Promise.resolve({ id: 'inquiry_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '変更ありで確定する場合は処方明細の更新内容が必要です',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });
});
