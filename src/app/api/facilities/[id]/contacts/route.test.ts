import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  facilityFindFirstMock,
  facilityContactDeleteManyMock,
  facilityContactCreateManyMock,
  facilityContactFindManyMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  facilityFindFirstMock: vi.fn(),
  facilityContactDeleteManyMock: vi.fn(),
  facilityContactCreateManyMock: vi.fn(),
  facilityContactFindManyMock: vi.fn(),
  withOrgContextMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (handler: (...args: unknown[]) => unknown) => {
    return (req: NextRequest, routeContext: { params: Promise<{ id: string }> }) =>
      handler(req, { orgId: 'org_1', userId: 'user_1', role: 'admin' }, routeContext);
  },
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    facility: {
      findFirst: facilityFindFirstMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { GET, PUT } from './route';

type NextRequestInit = ConstructorParameters<typeof NextRequest>[1];

function createRequest(body?: unknown) {
  const init: NextRequestInit = {
    method: body === undefined ? 'GET' : 'PUT',
    headers: { 'content-type': 'application/json' },
  };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  return new NextRequest('http://localhost/api/facilities/facility_1/contacts', init);
}

function createMalformedJsonRequest() {
  return new NextRequest('http://localhost/api/facilities/facility_1/contacts', {
    method: 'PUT',
    body: '{bad-json',
    headers: { 'content-type': 'application/json' },
  });
}

function expectNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
}

describe('/api/facilities/[id]/contacts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    facilityFindFirstMock.mockResolvedValue({
      id: 'facility_1',
      contacts: [
        {
          id: 'contact_1',
          name: '相談員A',
          role: '相談員',
          phone: '03-1111-2222',
          email: null,
          fax: null,
          is_primary: true,
          notes: null,
        },
      ],
    });
    facilityContactFindManyMock.mockResolvedValue([
      {
        id: 'contact_2',
        name: '看護師B',
        role: '看護師',
        phone: '03-3333-4444',
        email: 'nurse@example.com',
        fax: null,
        is_primary: true,
        notes: null,
      },
    ]);
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        facilityContact: {
          deleteMany: facilityContactDeleteManyMock,
          createMany: facilityContactCreateManyMock,
          findMany: facilityContactFindManyMock,
        },
      }),
    );
  });

  it('returns facility contacts', async () => {
    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: 'facility_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      data: [expect.objectContaining({ name: '相談員A' })],
    });
  });

  it('returns a no-store 404 when the facility does not exist', async () => {
    facilityFindFirstMock.mockResolvedValueOnce(null);

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: 'facility_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(404);
    expectNoStore(response);
  });

  it('returns a sanitized no-store 500 when facility contacts fail to load', async () => {
    facilityFindFirstMock.mockRejectedValueOnce(new Error('raw facility contact secret'));

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: 'facility_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(500);
    expectNoStore(response);
    const bodyText = await response.text();
    expect(bodyText).toContain('INTERNAL_ERROR');
    expect(bodyText).not.toContain('raw facility contact secret');
  });

  it('replaces facility contacts', async () => {
    const response = await PUT(
      createRequest({
        contacts: [
          {
            name: '看護師B',
            role: '看護師',
            phone: ' 03-3333-4444 ',
            email: 'nurse@example.com',
            fax: '   ',
            is_primary: true,
          },
        ],
      }),
      {
        params: Promise.resolve({ id: 'facility_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(facilityContactDeleteManyMock).toHaveBeenCalledWith({
      where: { org_id: 'org_1', facility_id: 'facility_1' },
    });
    expect(facilityContactCreateManyMock).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          org_id: 'org_1',
          facility_id: 'facility_1',
          name: '看護師B',
          phone: '03-3333-4444',
          fax: null,
        }),
      ],
    });
  });

  it('rejects malformed contact numbers before replacing contacts', async () => {
    const response = await PUT(
      createRequest({
        contacts: [
          {
            name: '看護師B',
            phone: '03-ABCD-4444',
            fax: 'FAX-5555',
          },
        ],
      }),
      {
        params: Promise.resolve({ id: 'facility_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(facilityFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(facilityContactDeleteManyMock).not.toHaveBeenCalled();
    expect(facilityContactCreateManyMock).not.toHaveBeenCalled();
  });

  it('rejects non-object contact payloads before replacing contacts', async () => {
    const response = await PUT(createRequest([]), {
      params: Promise.resolve({ id: 'facility_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(facilityFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(facilityContactDeleteManyMock).not.toHaveBeenCalled();
    expect(facilityContactCreateManyMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON contact payloads before replacing contacts', async () => {
    const response = await PUT(createMalformedJsonRequest(), {
      params: Promise.resolve({ id: 'facility_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(facilityFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(facilityContactDeleteManyMock).not.toHaveBeenCalled();
    expect(facilityContactCreateManyMock).not.toHaveBeenCalled();
  });
});
