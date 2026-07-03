import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { expectSensitiveNoStore } from '@/test/api-response-assertions';

const { withOrgContextMock, authContextFailureMock } = vi.hoisted(() => ({
  withOrgContextMock: vi.fn(),
  authContextFailureMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (
    handler: (
      req: NextRequest,
      ctx: { orgId: string; userId: string; role: 'pharmacist' },
      routeContext: { params: Promise<Record<string, string>> },
    ) => Promise<Response>,
  ) => {
    return (
      req: NextRequest,
      routeContext: { params: Promise<Record<string, string>> } = { params: Promise.resolve({}) },
    ) => {
      const failure = authContextFailureMock();
      if (failure) return Promise.reject(failure);

      return handler(req, { orgId: 'org_1', userId: 'user_1', role: 'pharmacist' }, routeContext);
    };
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { GET as rawGET } from './route';

const emptyRouteContext = { params: Promise.resolve({}) };
const GET = (req: NextRequest) => rawGET(req, emptyRouteContext);

function createGetRequest(search = '') {
  return new NextRequest(`http://localhost/api/conference-notes/participant-suggestions${search}`);
}

describe('/api/conference-notes/participant-suggestions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authContextFailureMock.mockReset();
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        facility: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'facility_1',
            name: '施設A',
            contacts: [
              {
                id: 'contact_1',
                name: '相談員A',
                role: '相談員',
                phone: '03-1111-2222',
                email: 'contact@example.com',
                preferred_contact_method: 'phone',
              },
            ],
          }),
        },
        conferenceNote: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'note_1',
          }),
        },
      }),
    );
  });

  it('requires facility_id', async () => {
    const response = (await GET(createGetRequest()))!;

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: 'facility_id は必須です',
    });
  });

  it('requires conference_note_id', async () => {
    const response = (await GET(createGetRequest('?facility_id=facility_1')))!;

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: 'conference_note_id は必須です',
    });
  });

  it('returns facility contact suggestions', async () => {
    const response = (await GET(
      createGetRequest('?facility_id=facility_1&conference_note_id=note_1'),
    ))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({
      data: [
        {
          name: '相談員A',
          role: '相談員',
          source: 'facility_contact',
          facility_id: 'facility_1',
          facility_name: '施設A',
        },
      ],
    });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('contact@example.com');
    expect(serialized).not.toContain('03-1111-2222');
  });

  it('returns no-store validation when the facility is not found', async () => {
    withOrgContextMock.mockImplementationOnce(async (_orgId, callback) =>
      callback({
        conferenceNote: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
        facility: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
      }),
    );

    const response = (await GET(
      createGetRequest('?facility_id=missing_facility&conference_note_id=note_1'),
    ))!;

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: 'カンファレンス記録と施設が一致しません',
    });
  });

  it('sanitizes unexpected suggestion lookup failures and keeps sensitive responses no-store', async () => {
    withOrgContextMock.mockRejectedValueOnce(
      new Error('raw contact@example.com 03-1111-2222 participant lookup failure'),
    );

    const response = (await GET(
      createGetRequest('?facility_id=facility_1&conference_note_id=note_1'),
    ))!;

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('contact@example.com');
    expect(serialized).not.toContain('03-1111-2222');
  });

  it('sanitizes auth plumbing failures before looking up facility contacts', async () => {
    authContextFailureMock.mockReturnValueOnce(
      new Error('raw auth contact@example.com 03-1111-2222 suggestion failure'),
    );

    const response = (await GET(
      createGetRequest('?facility_id=facility_1&conference_note_id=note_1'),
    ))!;

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('contact@example.com');
    expect(serialized).not.toContain('03-1111-2222');
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });
});
