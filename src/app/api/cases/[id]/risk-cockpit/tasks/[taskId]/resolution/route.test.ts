import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { expectSensitiveNoStore } from '@/test/api-response-assertions';

const {
  requireAuthContextMock,
  withAuthContextMock,
  careCaseFindFirstMock,
  withOrgContextMock,
  requireWritablePatientMock,
  waiveRiskOperationalTaskByIdMock,
} = vi.hoisted(() => {
  const requireAuthContextMock = vi.fn();
  const withAuthContextMock = vi.fn(
    (
      handler: (
        req: NextRequest,
        ctx: { orgId: string; userId: string; role: string },
        routeContext: { params: Promise<{ id: string; taskId: string }> },
      ) => Promise<Response>,
      options: unknown,
    ) => {
      return async (
        req: NextRequest,
        routeContext: { params: Promise<{ id: string; taskId: string }> },
      ) => {
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
    careCaseFindFirstMock: vi.fn(),
    withOrgContextMock: vi.fn(),
    requireWritablePatientMock: vi.fn(),
    waiveRiskOperationalTaskByIdMock: vi.fn(),
  };
});

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: withAuthContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    careCase: {
      findFirst: careCaseFindFirstMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/server/services/patient-write-guard', () => ({
  requireWritablePatient: requireWritablePatientMock,
}));

vi.mock('@/server/services/risk-task-resolution', () => ({
  waiveRiskOperationalTaskById: waiveRiskOperationalTaskByIdMock,
}));

import { POST } from './route';

function request(body: unknown = waiverBody()) {
  return new NextRequest('http://localhost/api/cases/case_1/risk-cockpit/tasks/task_1/resolution', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-correlation-id': 'risk_task_resolution_test',
    },
    body: JSON.stringify(body),
  });
}

function malformedRequest() {
  return new NextRequest('http://localhost/api/cases/case_1/risk-cockpit/tasks/task_1/resolution', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{bad json',
  });
}

function routeContext(overrides: { id?: string; taskId?: string } = {}) {
  return {
    params: Promise.resolve({
      id: overrides.id ?? 'case_1',
      taskId: overrides.taskId ?? 'task_1',
    }),
  };
}

function waiverBody() {
  return {
    resolution_state: 'waived',
    waiver_reason: '薬剤師確認により免除',
    reason_code: 'pharmacist_override',
  };
}

describe('/api/cases/[id]/risk-cockpit/tasks/[taskId]/resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
      },
    });
    careCaseFindFirstMock.mockResolvedValue({ patient_id: 'patient_1' });
    requireWritablePatientMock.mockResolvedValue({ patient: { id: 'patient_1' } });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({ __tx: true, careCase: { findFirst: careCaseFindFirstMock } }),
    );
    waiveRiskOperationalTaskByIdMock.mockResolvedValue({
      status: 'waived',
      task_id: 'task_1',
      display_id: 'tsk0000000001',
      case_id: 'case_1',
      risk_domain: 'billing',
      updated_task_count: 1,
    });
  });

  it('waives a risk task through the case-scoped dedicated route with a minimal no-store response', async () => {
    const response = (await POST(request(), routeContext()))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(response.headers.get('X-Request-Id')).toBe('00000000-0000-4000-8000-000000000001');
    expect(response.headers.get('X-Correlation-Id')).toBe('risk_task_resolution_test');
    expect(requireAuthContextMock).toHaveBeenCalledWith(expect.any(NextRequest), {
      permission: 'canAuditDispense',
      message: 'リスクタスクを免除する権限がありません',
    });
    expect(careCaseFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'case_1',
        org_id: 'org_1',
        AND: [
          {
            OR: [
              { primary_pharmacist_id: 'user_1' },
              { backup_pharmacist_id: 'user_1' },
              { visit_schedules: { some: { pharmacist_id: 'user_1' } } },
            ],
          },
        ],
      },
      select: { patient_id: true },
    });
    expect(requireWritablePatientMock).toHaveBeenCalledWith(
      expect.objectContaining({ __tx: true }),
      expect.objectContaining({ orgId: 'org_1', userId: 'user_1', role: 'pharmacist' }),
      'patient_1',
    );
    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function), {
      requestContext: expect.objectContaining({
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
      }),
    });
    expect(waiveRiskOperationalTaskByIdMock).toHaveBeenCalledWith(
      expect.objectContaining({ __tx: true }),
      expect.objectContaining({
        orgId: 'org_1',
        caseId: 'case_1',
        taskId: 'task_1',
        waiverReason: '薬剤師確認により免除',
        reasonCode: 'pharmacist_override',
      }),
    );
    const body = await response.json();
    expect(body).toEqual({
      data: {
        task_id: 'task_1',
        display_id: 'tsk0000000001',
        case_id: 'case_1',
        resolution_state: 'waived',
        task_status: 'cancelled',
        updated_count: 1,
        audit_logged: true,
      },
    });
    expect(body).not.toHaveProperty('task_id');
    expect(body).not.toHaveProperty('case_id');
    expect(body).not.toHaveProperty('updated_count');
    expect(JSON.stringify(body)).not.toContain('dedupe');
    expect(JSON.stringify(body)).not.toContain('metadata');
    expect(JSON.stringify(body)).not.toContain('薬剤師確認により免除');
  });

  it('rejects forbidden roles before reading or mutating task state', async () => {
    requireAuthContextMock.mockResolvedValueOnce({
      response: NextResponse.json(
        { code: 'AUTH_FORBIDDEN', message: 'リスクタスクを免除する権限がありません' },
        { status: 403 },
      ),
    });

    const response = (await POST(request(), routeContext()))!;

    expect(response.status).toBe(403);
    expectSensitiveNoStore(response);
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(waiveRiskOperationalTaskByIdMock).not.toHaveBeenCalled();
  });

  it('rejects invalid params and invalid waiver bodies before mutation', async () => {
    const blankCase = (await POST(request(), routeContext({ id: '   ' })))!;
    expect(blankCase.status).toBe(400);
    expectSensitiveNoStore(blankCase);
    await expect(blankCase.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'ケースIDが不正です',
    });

    const blankReason = (await POST(
      request({ resolution_state: 'waived', waiver_reason: '   ' }),
      routeContext(),
    ))!;
    expect(blankReason.status).toBe(400);
    expectSensitiveNoStore(blankReason);

    const invalidCode = (await POST(
      request({
        resolution_state: 'waived',
        waiver_reason: '理由',
        reason_code: 'raw reason with spaces',
      }),
      routeContext(),
    ))!;
    expect(invalidCode.status).toBe(400);
    expectSensitiveNoStore(invalidCode);

    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('returns no-store 404 for an unassigned case or missing task', async () => {
    careCaseFindFirstMock.mockResolvedValueOnce(null);
    const missingCase = (await POST(request(), routeContext()))!;
    expect(missingCase.status).toBe(404);
    expectSensitiveNoStore(missingCase);
    await expect(missingCase.json()).resolves.toMatchObject({
      code: 'WORKFLOW_NOT_FOUND',
      message: 'ケースまたはタスクが見つかりません',
    });
    expect(requireWritablePatientMock).not.toHaveBeenCalled();
    expect(waiveRiskOperationalTaskByIdMock).not.toHaveBeenCalled();

    waiveRiskOperationalTaskByIdMock.mockResolvedValueOnce({ status: 'not_found' });
    const missingTask = (await POST(request(), routeContext()))!;
    expect(missingTask.status).toBe(404);
    expectSensitiveNoStore(missingTask);
  });

  it('rejects archived or otherwise non-writable assigned patients before task mutation', async () => {
    requireWritablePatientMock.mockResolvedValueOnce({
      response: NextResponse.json(
        { code: 'WORKFLOW_CONFLICT', message: 'アーカイブ済み患者は更新できません' },
        { status: 409 },
      ),
    });

    const response = (await POST(request(), routeContext()))!;

    expect(response.status).toBe(409);
    expectSensitiveNoStore(response);
    expect(waiveRiskOperationalTaskByIdMock).not.toHaveBeenCalled();
  });

  it('maps invalid risk task and stale update results to no-store conflicts', async () => {
    waiveRiskOperationalTaskByIdMock.mockResolvedValueOnce({ status: 'invalid_risk_task' });

    const invalidRisk = (await POST(request(), routeContext()))!;
    expect(invalidRisk.status).toBe(409);
    expectSensitiveNoStore(invalidRisk);

    waiveRiskOperationalTaskByIdMock.mockResolvedValueOnce({ status: 'conflict' });
    const conflictResponse = (await POST(request(), routeContext()))!;
    expect(conflictResponse.status).toBe(409);
    expectSensitiveNoStore(conflictResponse);
    await expect(conflictResponse.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: 'タスクはすでに完了または取り消されています。再読み込みしてください',
    });
  });

  it('returns a sanitized no-store 500 for unexpected failures', async () => {
    waiveRiskOperationalTaskByIdMock.mockRejectedValueOnce(
      new Error('患者 山田花子 東京都千代田区1-1-1 アムロジピン raw provider error'),
    );

    const response = (await POST(request(), routeContext()))!;

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    expect(JSON.stringify(body)).not.toContain('山田花子');
    expect(JSON.stringify(body)).not.toContain('アムロジピン');
  });

  it('returns no-store validation error for malformed JSON', async () => {
    const response = (await POST(malformedRequest(), routeContext()))!;

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });
});
