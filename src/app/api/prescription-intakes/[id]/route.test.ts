import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  withOrgContextMock,
  prescriptionIntakeFindFirstMock,
  resolveOperationalTasksMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  prescriptionIntakeFindFirstMock: vi.fn(),
  resolveOperationalTasksMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    prescriptionIntake: {
      findFirst: prescriptionIntakeFindFirstMock,
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

describe('/api/prescription-intakes/[id] PATCH', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: 'org_1',
        userId: 'user_1',
      },
    });
  });

  it('records fax original collection and resolves follow-up tasks', async () => {
    prescriptionIntakeFindFirstMock.mockResolvedValue({
      id: 'intake_1',
      org_id: 'org_1',
      source_type: 'fax',
    });

    const updateMock = vi.fn().mockResolvedValue({
      id: 'intake_1',
      source_type: 'fax',
      original_collected_at: new Date('2026-03-28T09:00:00.000Z'),
      original_collected_by: 'user_1',
      lines: [],
    });

    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        prescriptionIntake: {
          update: updateMock,
        },
      })
    );

    const response = await PATCH(
      createRequest({
        original_collected_at: '2026-03-28T09:00:00.000Z',
      }),
      { params: Promise.resolve({ id: 'intake_1' }) }
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          original_collected_at: new Date('2026-03-28T09:00:00.000Z'),
          original_collected_by: 'user_1',
        }),
      })
    );
    expect(resolveOperationalTasksMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        orgId: 'org_1',
        taskType: 'fax_original_followup',
        relatedEntityType: 'prescription_intake',
        relatedEntityId: 'intake_1',
        status: 'completed',
      })
    );
  });

  it('does not resolve fax follow-up tasks for non-fax intakes', async () => {
    prescriptionIntakeFindFirstMock.mockResolvedValue({
      id: 'intake_2',
      org_id: 'org_1',
      source_type: 'paper',
    });

    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        prescriptionIntake: {
          update: vi.fn().mockResolvedValue({
            id: 'intake_2',
            source_type: 'paper',
            original_collected_at: new Date('2026-03-28T09:00:00.000Z'),
            lines: [],
          }),
        },
      })
    );

    const response = await PATCH(
      createRequest({
        original_collected_at: '2026-03-28T09:00:00.000Z',
      }),
      { params: Promise.resolve({ id: 'intake_2' }) }
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(resolveOperationalTasksMock).not.toHaveBeenCalled();
  });

  it('rejects split updates when the next dispense date is missing for a partial split', async () => {
    prescriptionIntakeFindFirstMock.mockResolvedValue({
      id: 'intake_3',
      org_id: 'org_1',
      source_type: 'paper',
      split_dispense_total: null,
      split_dispense_current: null,
      split_next_dispense_date: null,
    });

    const response = await PATCH(
      createRequest({
        split_dispense_total: 3,
        split_dispense_current: 1,
      }),
      { params: Promise.resolve({ id: 'intake_3' }) }
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '分割調剤の途中回は次回調剤予定日が必須です',
    });
  });
});
