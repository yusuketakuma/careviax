import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { withAuthContextMock, withOrgContextMock, queueOverdueReportResponseRemindersMock } =
  vi.hoisted(() => ({
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
    return (req: NextRequest, routeContext = emptyRouteContext) =>
      handler(
        req,
        {
          orgId: 'org_1',
          userId: 'user_1',
          role: 'pharmacist',
        },
        routeContext,
      );
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

describe('/api/care-reports/reminders POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it('rejects non-object JSON payloads before reminder queueing', async () => {
    const response = await POST(createRequest([]), emptyRouteContext);

    const ensuredResponse = response;
    if (!ensuredResponse) throw new Error('response is required');
    expect(ensuredResponse.status).toBe(400);
    await expect(ensuredResponse.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(queueOverdueReportResponseRemindersMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON before reminder queueing', async () => {
    const response = await POST(createMalformedRequest(), emptyRouteContext);

    const ensuredResponse = response;
    if (!ensuredResponse) throw new Error('response is required');
    expect(ensuredResponse.status).toBe(400);
    await expect(ensuredResponse.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(queueOverdueReportResponseRemindersMock).not.toHaveBeenCalled();
  });
});
