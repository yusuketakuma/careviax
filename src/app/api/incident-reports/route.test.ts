import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { listIncidentReportsMock, createIncidentReportMock } = vi.hoisted(() => ({
  listIncidentReportsMock: vi.fn(),
  createIncidentReportMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext:
    (
      handler: (
        req: NextRequest,
        ctx: {
          orgId: string;
          userId: string;
          role: string;
          ipAddress?: string;
          userAgent?: string;
        },
      ) => Promise<Response>,
    ) =>
    (req: NextRequest) =>
      handler(req, {
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
        ipAddress: '127.0.0.1',
        userAgent: 'vitest',
      }),
}));

vi.mock('@/server/services/incident-reports', () => ({
  listIncidentReports: listIncidentReportsMock,
  createIncidentReport: createIncidentReportMock,
}));

import { GET, POST } from './route';

const routeCtx = { params: Promise.resolve({}) };

function expectNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
}

function makePostRequest(body: unknown) {
  return new NextRequest('http://localhost/api/incident-reports', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('/api/incident-reports', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listIncidentReportsMock.mockResolvedValue([]);
    createIncidentReportMock.mockResolvedValue({
      id: 'incident_1',
      title: 'セット日付間違い',
      status: 'open',
    });
  });

  it('lists reports with optional status filter', async () => {
    const response = await GET(
      new NextRequest('http://localhost/api/incident-reports?status=reviewed'),
      routeCtx,
    );

    expect(response.status).toBe(200);
    expectNoStore(response);
    expect(listIncidentReportsMock).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org_1' }),
      'reviewed',
    );
  });

  it('rejects unknown status filters before service access', async () => {
    const response = await GET(
      new NextRequest('http://localhost/api/incident-reports?status=unknown'),
      routeCtx,
    );

    expect(response.status).toBe(400);
    expectNoStore(response);
    expect(listIncidentReportsMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when incident report listing fails unexpectedly', async () => {
    listIncidentReportsMock.mockRejectedValueOnce(
      new Error('raw incident report medication safety narrative secret'),
    );

    const response = await GET(new NextRequest('http://localhost/api/incident-reports'), routeCtx);

    expect(response.status).toBe(500);
    expectNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'INTERNAL_ERROR',
    });
    expect(JSON.stringify(body)).not.toContain('safety narrative secret');
  });

  it('creates a report after request validation', async () => {
    const response = await POST(
      makePostRequest({
        title: 'セット日付間違い',
        what_happened: '土曜セットに金曜の薬を入れた',
        related_process: 'set',
      }),
      routeCtx,
    );

    expect(response.status).toBe(201);
    expect(createIncidentReportMock).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org_1', userId: 'user_1' }),
      expect.objectContaining({
        title: 'セット日付間違い',
        what_happened: '土曜セットに金曜の薬を入れた',
        related_process: 'set',
      }),
    );
  });

  it('rejects invalid create payloads before service access', async () => {
    const response = await POST(
      makePostRequest({ title: '', related_process: 'unknown' }),
      routeCtx,
    );

    expect(response.status).toBe(400);
    expect(createIncidentReportMock).not.toHaveBeenCalled();
  });
});
