import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { expectSensitiveNoStore } from '@/test/api-response-assertions';

const {
  requireAuthContextMock,
  syncCaseRiskCockpitOperationalTasksMock,
  withOrgContextMock,
  loggerErrorMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  syncCaseRiskCockpitOperationalTasksMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  loggerErrorMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/lib/utils/logger', () => ({
  logger: {
    error: loggerErrorMock,
  },
}));

vi.mock('@/server/services/case-risk-task-sync', () => ({
  syncCaseRiskCockpitOperationalTasks: syncCaseRiskCockpitOperationalTasksMock,
}));

import { POST } from './route';

function createRequest() {
  return new NextRequest('http://localhost/api/cases/case_1/risk-cockpit/tasks', {
    method: 'POST',
  });
}

function syncResult() {
  return {
    generated_at: '2026-07-06T00:00:00.000Z',
    case_id: 'case_1',
    patient_id: 'patient_1',
    overall_status: 'blocked',
    taskable_finding_count: 2,
    skipped_finding_count: 3,
    upserted_task_count: 2,
    upserted_tasks: [
      { id: 'task_1', display_id: 'tsk0000000001' },
      { id: 'task_2', display_id: null },
    ],
  };
}

describe('/api/cases/[id]/risk-cockpit/tasks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
      },
    });
    syncCaseRiskCockpitOperationalTasksMock.mockResolvedValue(syncResult());
    withOrgContextMock.mockImplementation(async (_orgId, callback) => callback({ __tx: true }));
  });

  it('syncs taskable case risk findings through an explicit no-store POST', async () => {
    const response = (await POST(createRequest(), {
      params: Promise.resolve({ id: 'case_1' }),
    }))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(requireAuthContextMock).toHaveBeenCalledWith(expect.any(NextRequest), {
      permission: 'canVisit',
      message: 'ケースリスクタスク同期の権限がありません',
    });
    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function), {
      requestContext: expect.objectContaining({
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
      }),
    });
    expect(syncCaseRiskCockpitOperationalTasksMock).toHaveBeenCalledWith(
      { __tx: true },
      expect.objectContaining({
        orgId: 'org_1',
        caseId: 'case_1',
        userId: 'user_1',
        role: 'pharmacist',
      }),
    );
    const body = await response.json();
    expect(body).toMatchObject({
      case_id: 'case_1',
      patient_id: 'patient_1',
      taskable_finding_count: 2,
      upserted_task_count: 2,
    });
    expect(body.upserted_tasks).toEqual(
      expect.arrayContaining([{ id: 'task_1', display_id: 'tsk0000000001' }]),
    );
  });

  it('rejects forbidden roles before syncing risk tasks', async () => {
    requireAuthContextMock.mockResolvedValueOnce({
      response: NextResponse.json(
        { code: 'AUTH_FORBIDDEN', message: 'ケースリスクタスク同期の権限がありません' },
        { status: 403 },
      ),
    });

    const response = (await POST(createRequest(), {
      params: Promise.resolve({ id: 'case_1' }),
    }))!;

    expect(response.status).toBe(403);
    expectSensitiveNoStore(response);
    expect(syncCaseRiskCockpitOperationalTasksMock).not.toHaveBeenCalled();
  });

  it('rejects blank case ids before syncing risk tasks', async () => {
    const response = (await POST(createRequest(), {
      params: Promise.resolve({ id: '   ' }),
    }))!;

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'ケースIDが不正です',
    });
    expect(syncCaseRiskCockpitOperationalTasksMock).not.toHaveBeenCalled();
  });

  it('returns no-store 404 for out-of-scope or missing cases', async () => {
    syncCaseRiskCockpitOperationalTasksMock.mockResolvedValueOnce(null);

    const response = (await POST(createRequest(), {
      params: Promise.resolve({ id: 'case_other' }),
    }))!;

    expect(response.status).toBe(404);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_NOT_FOUND',
      message: 'ケースが見つかりません',
    });
  });

  it('returns a sanitized no-store 500 when risk task sync fails unexpectedly', async () => {
    syncCaseRiskCockpitOperationalTasksMock.mockRejectedValueOnce(
      new Error('患者 山田花子 東京都千代田区1-1-1 アムロジピン provider raw error'),
    );

    const response = (await POST(createRequest(), {
      params: Promise.resolve({ id: 'case_1' }),
    }))!;

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    expect(JSON.stringify(body)).not.toContain('山田花子');
    expect(JSON.stringify(body)).not.toContain('東京都千代田区');
    expect(JSON.stringify(body)).not.toContain('アムロジピン');
    expect(JSON.stringify(body)).not.toContain('provider raw error');
    expect(loggerErrorMock).toHaveBeenCalledWith({
      event: 'route_handler_unhandled_error',
      route: '/api/cases/case_1/risk-cockpit/tasks',
      method: 'POST',
      code: 'Error',
    });
    expect(JSON.stringify(loggerErrorMock.mock.calls)).not.toContain('山田花子');
  });
});
