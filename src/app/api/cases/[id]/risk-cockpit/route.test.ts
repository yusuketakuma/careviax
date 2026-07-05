import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { expectSensitiveNoStore } from '@/test/api-response-assertions';

const { requireAuthContextMock, getCaseRiskCockpitMock, withOrgContextMock, loggerErrorMock } =
  vi.hoisted(() => ({
    requireAuthContextMock: vi.fn(),
    getCaseRiskCockpitMock: vi.fn(),
    withOrgContextMock: vi.fn(),
    loggerErrorMock: vi.fn(),
  }));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: { __mock: true },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/lib/utils/logger', () => ({
  logger: {
    error: loggerErrorMock,
  },
}));

vi.mock('@/server/services/case-risk-cockpit', () => ({
  getCaseRiskCockpit: getCaseRiskCockpitMock,
}));

import { GET } from './route';

function createRequest() {
  return new NextRequest('http://localhost/api/cases/case_1/risk-cockpit');
}

function baseCockpit() {
  return {
    generated_at: '2026-07-06T00:00:00.000Z',
    patient: { id: 'patient_1', display_id: 'PAT-001', name: '患者 太郎' },
    case: { id: 'case_1', display_id: 'CASE-001', status: 'active' },
    overall: {
      status: 'blocked',
      blocking_count: 1,
      urgent_count: 0,
      warning_count: 0,
    },
    sections: [
      {
        domain: 'consent_plan',
        label: '同意・管理計画',
        status: 'blocked',
        findings: [
          {
            key: 'missing_visit_consent',
            domain: 'consent_plan',
            severity: 'blocking',
            title: '訪問同意の取得が必要です',
            detail: '訪問薬剤管理の有効同意がありません。',
            patient_id: 'patient_1',
            case_id: 'case_1',
            action_href: '/patients/patient_1/consent',
            action_label: '同意を整備',
            resolution_state: 'open',
            source: 'computed',
          },
        ],
      },
    ],
    next_actions: [
      {
        task_id: null,
        label: '同意を整備',
        priority: 'urgent',
        due_at: null,
        action_href: '/patients/patient_1/consent',
      },
    ],
  };
}

describe('/api/cases/[id]/risk-cockpit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
      },
    });
    getCaseRiskCockpitMock.mockResolvedValue(baseCockpit());
    withOrgContextMock.mockImplementation(async (_orgId, callback) => callback({ __tx: true }));
  });

  it('returns a no-store Case Risk Cockpit response for an authorized scoped case', async () => {
    const response = (await GET(createRequest(), {
      params: Promise.resolve({ id: 'case_1' }),
    }))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(requireAuthContextMock).toHaveBeenCalledWith(expect.any(NextRequest), {
      permission: 'canVisit',
      message: 'ケースリスク参照の権限がありません',
    });
    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function), {
      requestContext: expect.objectContaining({
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
      }),
    });
    expect(getCaseRiskCockpitMock).toHaveBeenCalledWith(
      { __tx: true },
      expect.objectContaining({
        orgId: 'org_1',
        caseId: 'case_1',
        userId: 'user_1',
        role: 'pharmacist',
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      overall: { status: 'blocked', blocking_count: 1 },
      sections: [{ domain: 'consent_plan', status: 'blocked' }],
      next_actions: [{ label: '同意を整備', action_href: '/patients/patient_1/consent' }],
    });
  });

  it('rejects forbidden roles before loading the cockpit service', async () => {
    requireAuthContextMock.mockResolvedValueOnce({
      response: NextResponse.json(
        { code: 'AUTH_FORBIDDEN', message: 'ケースリスク参照の権限がありません' },
        { status: 403 },
      ),
    });

    const response = (await GET(createRequest(), {
      params: Promise.resolve({ id: 'case_1' }),
    }))!;

    expect(response.status).toBe(403);
    expectSensitiveNoStore(response);
    expect(getCaseRiskCockpitMock).not.toHaveBeenCalled();
  });

  it('rejects blank case ids before loading the cockpit service', async () => {
    const response = (await GET(createRequest(), {
      params: Promise.resolve({ id: '   ' }),
    }))!;

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'ケースIDが不正です',
    });
    expect(getCaseRiskCockpitMock).not.toHaveBeenCalled();
  });

  it('returns no-store 404 for out-of-scope or missing cases', async () => {
    getCaseRiskCockpitMock.mockResolvedValueOnce(null);

    const response = (await GET(createRequest(), {
      params: Promise.resolve({ id: 'case_other' }),
    }))!;

    expect(response.status).toBe(404);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_NOT_FOUND',
      message: 'ケースが見つかりません',
    });
  });

  it('returns a sanitized no-store 500 when cockpit assembly fails unexpectedly', async () => {
    getCaseRiskCockpitMock.mockRejectedValueOnce(
      new Error('患者 山田花子 東京都千代田区1-1-1 アムロジピン storageKey provider raw error'),
    );

    const response = (await GET(createRequest(), {
      params: Promise.resolve({ id: 'case_1' }),
    }))!;

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('山田花子');
    expect(serialized).not.toContain('東京都千代田区1-1-1');
    expect(serialized).not.toContain('アムロジピン');
    expect(serialized).not.toContain('storageKey');
    expect(serialized).not.toContain('provider raw error');
    expect(loggerErrorMock).toHaveBeenCalledWith({
      event: 'route_handler_unhandled_error',
      route: '/api/cases/case_1/risk-cockpit',
      method: 'GET',
      code: 'Error',
    });
    expect(JSON.stringify(loggerErrorMock.mock.calls)).not.toContain('山田花子');
    expect(JSON.stringify(loggerErrorMock.mock.calls)).not.toContain('アムロジピン');
  });
});
