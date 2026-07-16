import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { expectSensitiveNoStore } from '@/test/api-response-assertions';

const {
  requireAuthContextMock,
  withAuthContextMock,
  getCaseRiskCockpitMock,
  withOrgContextMock,
  recordPhiReadAuditForRequestMock,
} = vi.hoisted(() => {
  const requireAuthContextMock = vi.fn();
  const withAuthContextMock = vi.fn(
    (
      handler: (
        req: NextRequest,
        ctx: { orgId: string; userId: string; role: string },
        routeContext: { params: Promise<{ id: string }> },
      ) => Promise<Response>,
      options: unknown,
    ) => {
      return async (req: NextRequest, routeContext: { params: Promise<{ id: string }> }) => {
        const authResult = await requireAuthContextMock(req, options);
        let response: Response;
        if (authResult && typeof authResult === 'object' && 'response' in authResult) {
          response = authResult.response;
        } else {
          try {
            response = await handler(req, authResult.ctx, routeContext);
          } catch {
            response = NextResponse.json(
              { code: 'INTERNAL_ERROR', message: 'サーバー内部でエラーが発生しました' },
              { status: 500 },
            );
          }
        }
        response.headers.set('Cache-Control', 'private, no-store, max-age=0');
        response.headers.set('Pragma', 'no-cache');
        response.headers.set('X-Request-Id', '00000000-0000-4000-8000-000000000001');
        response.headers.set(
          'X-Correlation-Id',
          req.headers.get('x-correlation-id') ?? '00000000-0000-4000-8000-000000000001',
        );
        return response;
      };
    },
  );

  return {
    requireAuthContextMock,
    withAuthContextMock,
    getCaseRiskCockpitMock: vi.fn(),
    withOrgContextMock: vi.fn(),
    recordPhiReadAuditForRequestMock: vi.fn(),
  };
});

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: withAuthContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: { __mock: true },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/lib/audit/phi-read-audit', () => ({
  recordPhiReadAuditForRequest: recordPhiReadAuditForRequestMock,
}));

vi.mock('@/server/services/case-risk-cockpit', () => ({
  getCaseRiskCockpit: getCaseRiskCockpitMock,
}));

import { GET } from './route';

function createRequest() {
  return new NextRequest('http://localhost/api/cases/case_1/risk-cockpit', {
    headers: { 'x-correlation-id': 'risk_cockpit_test' },
  });
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
    expect(response.headers.get('X-Request-Id')).toBe('00000000-0000-4000-8000-000000000001');
    expect(response.headers.get('X-Correlation-Id')).toBe('risk_cockpit_test');
    expect(requireAuthContextMock).toHaveBeenCalledWith(expect.any(NextRequest), {
      permission: 'canViewDashboard',
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
    const body = await response.json();
    expect(body).toMatchObject({
      data: {
        overall: { status: 'blocked', blocking_count: 1 },
        sections: [{ domain: 'consent_plan', status: 'blocked' }],
        next_actions: [{ label: '同意を整備', action_href: '/patients/patient_1/consent' }],
      },
    });
    expect(body).not.toHaveProperty('overall');
    expect(body).not.toHaveProperty('sections');
    expect(body).not.toHaveProperty('next_actions');
    expect(recordPhiReadAuditForRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org_1', userId: 'user_1', role: 'pharmacist' }),
      {
        patientId: 'patient_1',
        targetType: 'care_case',
        targetId: 'case_1',
        view: 'case_risk_cockpit',
      },
    );
    expect(recordPhiReadAuditForRequestMock).toHaveBeenCalledTimes(1);
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
    expect(recordPhiReadAuditForRequestMock).not.toHaveBeenCalled();
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
    expect(recordPhiReadAuditForRequestMock).not.toHaveBeenCalled();
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
    expect(recordPhiReadAuditForRequestMock).not.toHaveBeenCalled();
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
    expect(recordPhiReadAuditForRequestMock).not.toHaveBeenCalled();
  });
});
