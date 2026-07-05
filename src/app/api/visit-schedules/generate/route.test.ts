import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { expectSensitiveNoStore } from '@/test/api-response-assertions';

const { authMock, membershipFindFirstMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
}));

vi.mock('@/lib/auth/config', () => ({
  auth: authMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    membership: {
      findFirst: membershipFindFirstMock,
    },
  },
}));

import { POST as rawPOST } from './route';

const emptyRouteContext = { params: Promise.resolve({}) };
const POST = (req: NextRequest) => rawPOST(req, emptyRouteContext);

function createRequest(body: unknown) {
  return new NextRequest('http://localhost/api/visit-schedules/generate', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      'x-org-id': 'org_1',
    },
  });
}

describe('/api/visit-schedules/generate POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });
  });

  it('rejects direct confirmed schedule generation and points callers to proposals', async () => {
    const response = await POST(
      createRequest({
        case_id: 'case_1',
        visit_type: 'regular',
        pharmacist_id: 'pharmacist_1',
        recurrence_rule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=TU',
        start_date: '2026-04-07',
        end_date: '2026-04-07',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(410);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toEqual({
      code: 'ENDPOINT_REMOVED',
      message:
        '訪問予定の直接一括生成は廃止されました。自動提案は /api/visit-schedule-proposals を使用してください。',
      details: {
        replacement_endpoint: '/api/visit-schedule-proposals',
        reason_code: 'DIRECT_CONFIRMED_GENERATION_REMOVED',
        creates_confirmed_schedules: false,
      },
    });
  });

  it('does not parse malformed bodies before returning the removal response', async () => {
    const response = await POST(
      new NextRequest('http://localhost/api/visit-schedules/generate', {
        method: 'POST',
        body: '{"case_id":',
        headers: {
          'content-type': 'application/json',
          'x-org-id': 'org_1',
        },
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(410);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'ENDPOINT_REMOVED',
      details: {
        creates_confirmed_schedules: false,
      },
    });
  });

  it('keeps auth and permission gates before the removal response', async () => {
    authMock.mockResolvedValueOnce(null);
    const unauthenticatedResponse = await POST(createRequest({}));
    expect(unauthenticatedResponse?.status).toBe(401);
    if (unauthenticatedResponse) expectSensitiveNoStore(unauthenticatedResponse);

    authMock.mockResolvedValueOnce({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValueOnce({ role: 'driver' });
    const forbiddenResponse = await POST(createRequest({}));
    expect(forbiddenResponse?.status).toBe(403);
    if (forbiddenResponse) expectSensitiveNoStore(forbiddenResponse);
  });
});
