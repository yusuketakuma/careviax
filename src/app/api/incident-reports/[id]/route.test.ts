import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { updateIncidentReportMock, hasPermissionMock } = vi.hoisted(() => ({
  updateIncidentReportMock: vi.fn(),
  hasPermissionMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext:
    <TParams extends Record<string, string>>(
      handler: (
        req: NextRequest,
        ctx: {
          orgId: string;
          userId: string;
          role: string;
          ipAddress?: string;
          userAgent?: string;
        },
        routeContext: { params: Promise<TParams> },
      ) => Promise<Response>,
    ) =>
    (req: NextRequest, routeContext: { params: Promise<TParams> }) =>
      handler(
        req,
        {
          orgId: 'org_1',
          userId: 'user_1',
          role: req.headers.get('x-test-role') ?? 'pharmacist',
          ipAddress: '127.0.0.1',
          userAgent: 'vitest',
        },
        routeContext,
      ),
}));

vi.mock('@/lib/auth/permissions', () => ({
  hasPermission: hasPermissionMock,
}));

vi.mock('@/server/services/incident-reports', () => ({
  updateIncidentReport: updateIncidentReportMock,
}));

import { PATCH } from './route';

function makePatchRequest(body: unknown, role = 'pharmacist') {
  return new NextRequest('http://localhost/api/incident-reports/incident_1', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', 'x-test-role': role },
    body: JSON.stringify(body),
  });
}

function routeCtx(id = 'incident_1') {
  return { params: Promise.resolve({ id }) };
}

function expectSensitiveNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
}

describe('/api/incident-reports/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hasPermissionMock.mockReturnValue(false);
    updateIncidentReportMock.mockResolvedValue({
      id: 'incident_1',
      title: 'セット日付間違い',
      status: 'open',
    });
  });

  it('updates prevention memo fields through the service', async () => {
    const response = await PATCH(
      makePatchRequest({
        cause: 'カレンダー確認漏れ',
        prevention_plan: '二人で日付確認',
        related_process: 'set',
      }),
      routeCtx(),
    );

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(updateIncidentReportMock).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org_1', userId: 'user_1' }),
      'incident_1',
      {
        cause: 'カレンダー確認漏れ',
        prevention_plan: '二人で日付確認',
        related_process: 'set',
      },
    );
  });

  it('requires admin permission for status changes', async () => {
    const response = await PATCH(makePatchRequest({ status: 'reviewed' }), routeCtx());

    expect(response.status).toBe(403);
    expectSensitiveNoStore(response);
    expect(updateIncidentReportMock).not.toHaveBeenCalled();
  });

  it('allows admin status changes', async () => {
    hasPermissionMock.mockReturnValueOnce(true);

    const response = await PATCH(makePatchRequest({ status: 'reviewed' }, 'admin'), routeCtx());

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(hasPermissionMock).toHaveBeenCalledWith('admin', 'canAdmin');
    expect(updateIncidentReportMock).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'admin' }),
      'incident_1',
      { status: 'reviewed' },
    );
  });

  it('returns 404 when the service cannot find an org-scoped report', async () => {
    updateIncidentReportMock.mockResolvedValueOnce(null);

    const response = await PATCH(makePatchRequest({ cause: '確認漏れ' }), routeCtx());

    expect(response.status).toBe(404);
    expectSensitiveNoStore(response);
  });

  it('rejects invalid ids and empty payloads before service access', async () => {
    const invalidIdResponse = await PATCH(makePatchRequest({ cause: '確認漏れ' }), routeCtx('   '));
    expect(invalidIdResponse.status).toBe(400);
    expectSensitiveNoStore(invalidIdResponse);

    const emptyPayloadResponse = await PATCH(makePatchRequest({}), routeCtx());
    expect(emptyPayloadResponse.status).toBe(400);
    expectSensitiveNoStore(emptyPayloadResponse);

    expect(updateIncidentReportMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when update fails unexpectedly', async () => {
    updateIncidentReportMock.mockRejectedValueOnce(
      new Error('田中 花子 ヒヤリハット raw incident update failure'),
    );

    const response = await PATCH(
      makePatchRequest({
        cause: '患者宅で確認漏れ',
        prevention_plan: '次回訪問前に二重確認',
      }),
      routeCtx(),
    );

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    const bodyText = JSON.stringify(body);
    expect(bodyText).not.toContain('田中 花子');
    expect(bodyText).not.toContain('ヒヤリハット');
    expect(bodyText).not.toContain('raw incident update failure');
    expect(bodyText).not.toContain('患者宅');
  });
});
