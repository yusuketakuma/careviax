import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  authFailureResponseMock,
  withAuthContextMock,
  withOrgContextMock,
  queueOverdueReportResponseRemindersMock,
} = vi.hoisted(() => ({
  authFailureResponseMock: vi.fn(),
  withAuthContextMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  queueOverdueReportResponseRemindersMock: vi.fn(),
}));

const emptyRouteContext = { params: Promise.resolve({}) };

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (
    handler: (
      req: NextRequest,
      ctx: { orgId: string; userId: string; role: 'pharmacist' },
      routeContext: typeof emptyRouteContext,
    ) => Promise<Response>,
    options: { permission: string; message: string },
  ) => {
    withAuthContextMock.mockImplementation(() => options);
    return (req: NextRequest, routeContext = emptyRouteContext) => {
      const authFailureResponse = authFailureResponseMock();
      if (authFailureResponse instanceof Response) return authFailureResponse;

      return handler(
        req,
        {
          orgId: 'org_1',
          userId: 'user_1',
          role: 'pharmacist',
        },
        routeContext,
      );
    };
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/server/services/report-reminders', () => ({
  queueOverdueReportResponseReminders: queueOverdueReportResponseRemindersMock,
}));

import { POST } from './route';

function createRequest(body: unknown) {
  return new NextRequest('http://localhost/api/care-reports/reminders', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function createMalformedRequest() {
  return new NextRequest('http://localhost/api/care-reports/reminders', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{"overdue_days":',
  });
}

function expectSensitiveNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
}

describe('/api/care-reports/reminders POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authFailureResponseMock.mockReturnValue(undefined);
    queueOverdueReportResponseRemindersMock.mockResolvedValue({
      queued_count: 2,
      delivery_ids: ['delivery_1', 'delivery_2'],
    });
    withOrgContextMock.mockImplementation(async (_orgId, callback) => callback({ tx: true }));
  });

  it('creates overdue response follow-up tasks', async () => {
    const response = await POST(createRequest({ overdue_days: 5 }), emptyRouteContext);

    const ensuredResponse = response;
    if (!ensuredResponse) throw new Error('response is required');
    expect(ensuredResponse.status).toBe(201);
    expectSensitiveNoStore(ensuredResponse);
    expect(queueOverdueReportResponseRemindersMock).toHaveBeenCalledWith({ tx: true }, 'org_1', {
      overdueDays: 5,
    });
    expect(withAuthContextMock()).toEqual({
      permission: 'canSendCareReport',
      message: '報告書リマインドの作成権限がありません',
    });
    await expect(ensuredResponse.json()).resolves.toMatchObject({
      data: {
        queued_count: 2,
      },
    });
  });

  it('adds no-store headers to auth rejection responses', async () => {
    authFailureResponseMock.mockReturnValueOnce(
      new Response(
        JSON.stringify({ code: 'FORBIDDEN', message: '報告書リマインドの作成権限がありません' }),
        { status: 403 },
      ),
    );

    const response = await POST(createRequest({ overdue_days: 5 }), emptyRouteContext);

    const ensuredResponse = response;
    if (!ensuredResponse) throw new Error('response is required');
    expect(ensuredResponse.status).toBe(403);
    expectSensitiveNoStore(ensuredResponse);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(queueOverdueReportResponseRemindersMock).not.toHaveBeenCalled();
  });

  it('rejects non-object JSON payloads before reminder queueing', async () => {
    const response = await POST(createRequest([]), emptyRouteContext);

    const ensuredResponse = response;
    if (!ensuredResponse) throw new Error('response is required');
    expect(ensuredResponse.status).toBe(400);
    expectSensitiveNoStore(ensuredResponse);
    await expect(ensuredResponse.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(queueOverdueReportResponseRemindersMock).not.toHaveBeenCalled();
  });

  it('rejects schema-invalid object payloads before reminder queueing', async () => {
    const response = await POST(createRequest({ overdue_days: 91 }), emptyRouteContext);

    const ensuredResponse = response;
    if (!ensuredResponse) throw new Error('response is required');
    expect(ensuredResponse.status).toBe(400);
    expectSensitiveNoStore(ensuredResponse);
    await expect(ensuredResponse.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '入力値が不正です',
      details: {
        overdue_days: expect.any(Array),
      },
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(queueOverdueReportResponseRemindersMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON before reminder queueing', async () => {
    const response = await POST(createMalformedRequest(), emptyRouteContext);

    const ensuredResponse = response;
    if (!ensuredResponse) throw new Error('response is required');
    expect(ensuredResponse.status).toBe(400);
    expectSensitiveNoStore(ensuredResponse);
    await expect(ensuredResponse.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(queueOverdueReportResponseRemindersMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when reminder queueing fails unexpectedly', async () => {
    queueOverdueReportResponseRemindersMock.mockRejectedValueOnce(
      new Error('raw care_report_reminder patient 山田花子 token secret response memo'),
    );

    const response = await POST(createRequest({ overdue_days: 5 }), emptyRouteContext);

    const ensuredResponse = response;
    if (!ensuredResponse) throw new Error('response is required');
    expect(ensuredResponse.status).toBe(500);
    expectSensitiveNoStore(ensuredResponse);
    const body = await ensuredResponse.json();
    expect(body).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('care_report_reminder');
    expect(serialized).not.toContain('山田花子');
    expect(serialized).not.toContain('token secret');
    expect(serialized).not.toContain('response memo');
  });

  it('returns a sanitized no-store 500 when auth plumbing fails before parsing body', async () => {
    authFailureResponseMock.mockImplementationOnce(() => {
      throw new Error('raw auth care_report_reminder patient 山田花子 token secret');
    });

    const response = await POST(createMalformedRequest(), emptyRouteContext);

    const ensuredResponse = response;
    if (!ensuredResponse) throw new Error('response is required');
    expect(ensuredResponse.status).toBe(500);
    expectSensitiveNoStore(ensuredResponse);
    const body = await ensuredResponse.json();
    expect(body).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('raw auth');
    expect(serialized).not.toContain('care_report_reminder');
    expect(serialized).not.toContain('山田花子');
    expect(serialized).not.toContain('token secret');
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(queueOverdueReportResponseRemindersMock).not.toHaveBeenCalled();
  });
});
