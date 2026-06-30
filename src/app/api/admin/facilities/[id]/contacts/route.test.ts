import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  facilityFindFirstMock,
  facilityUpdateManyMock,
  facilityContactFindManyMock,
  facilityContactDeleteManyMock,
  facilityContactCreateManyMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  facilityFindFirstMock: vi.fn(),
  facilityUpdateManyMock: vi.fn(),
  facilityContactFindManyMock: vi.fn(),
  facilityContactDeleteManyMock: vi.fn(),
  facilityContactCreateManyMock: vi.fn(),
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
    facilityContact: {
      findMany: facilityContactFindManyMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { GET, PUT } from './route';

type NextRequestInit = ConstructorParameters<typeof NextRequest>[1];
const CURRENT_UPDATED_AT = '2026-03-02T00:00:00.000Z';
const STALE_UPDATED_AT = '2026-03-01T00:00:00.000Z';

function createRequest(body?: unknown) {
  const requestBody =
    body && typeof body === 'object' && !Array.isArray(body) && !('expected_updated_at' in body)
      ? { expected_updated_at: CURRENT_UPDATED_AT, ...body }
      : body;
  const init: NextRequestInit = {
    method: requestBody === undefined ? 'GET' : 'PUT',
    headers: { 'content-type': 'application/json' },
  };
  if (requestBody !== undefined) {
    init.body = JSON.stringify(requestBody);
  }
  return new NextRequest('http://localhost/api/admin/facilities/facility_1/contacts', init);
}

function createMalformedJsonRequest() {
  return new NextRequest('http://localhost/api/admin/facilities/facility_1/contacts', {
    method: 'PUT',
    body: '{bad-json',
    headers: { 'content-type': 'application/json' },
  });
}

describe('/api/admin/facilities/[id]/contacts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    facilityFindFirstMock.mockResolvedValue({
      id: 'facility_1',
      updated_at: new Date(CURRENT_UPDATED_AT),
    });
    facilityUpdateManyMock.mockResolvedValue({ count: 1 });
    facilityContactFindManyMock.mockResolvedValue([
      {
        id: 'contact_1',
        name: '相談員A',
        role: '相談員',
        phone: '03-3333-4444',
        email: null,
        fax: null,
        is_primary: true,
        notes: null,
        updated_at: new Date(CURRENT_UPDATED_AT),
      },
    ]);
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        facility: {
          updateMany: facilityUpdateManyMock,
        },
        facilityContact: {
          deleteMany: facilityContactDeleteManyMock,
          createMany: facilityContactCreateManyMock,
          findMany: facilityContactFindManyMock,
        },
      }),
    );
  });

  it('lists facility contacts', async () => {
    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: 'facility_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    await expect(response.json()).resolves.toMatchObject({
      data: [{ id: 'contact_1', name: '相談員A', updated_at: CURRENT_UPDATED_AT }],
      metadata: {
        expected_updated_at: CURRENT_UPDATED_AT,
        version_basis: 'facility_updated_at',
      },
    });
  });

  it('returns a sanitized 500 with no-store headers when the contacts read fails', async () => {
    facilityContactFindManyMock.mockRejectedValueOnce(
      new Error('raw facilities contacts read failure'),
    );

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: 'facility_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(500);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    const body = await response.json();
    expect(body).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(body)).not.toContain('raw facilities contacts read failure');
  });

  it('replaces facility contacts', async () => {
    const response = await PUT(
      createRequest({
        contacts: [
          {
            name: '相談員A',
            role: '相談員',
            phone: ' 03-3333-4444 ',
            fax: ' 03-3333-5555 ',
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
    await expect(response.json()).resolves.toMatchObject({
      data: [{ name: '相談員A', updated_at: CURRENT_UPDATED_AT }],
      metadata: {
        expected_updated_at: expect.any(String),
        version_basis: 'facility_updated_at',
      },
    });
    expect(facilityUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: 'facility_1',
        org_id: 'org_1',
        updated_at: new Date(CURRENT_UPDATED_AT),
      },
      data: { updated_at: expect.any(Date) },
    });
    expect(facilityContactDeleteManyMock).toHaveBeenCalledWith({
      where: { org_id: 'org_1', facility_id: 'facility_1' },
    });
    expect(facilityContactCreateManyMock).toHaveBeenCalledWith({
      data: [
        {
          org_id: 'org_1',
          facility_id: 'facility_1',
          name: '相談員A',
          role: '相談員',
          phone: '03-3333-4444',
          fax: '03-3333-5555',
          email: null,
          is_primary: true,
          notes: null,
        },
      ],
    });
  });

  it('requires expected_updated_at before loading the facility for replacement', async () => {
    const response = await PUT(
      createRequest({
        expected_updated_at: undefined,
        contacts: [{ name: '相談員A' }],
      }),
      {
        params: Promise.resolve({ id: 'facility_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      details: { expected_updated_at: expect.any(Array) },
    });
    expect(facilityFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('rejects stale expected_updated_at before replacing contacts', async () => {
    const response = await PUT(
      createRequest({
        expected_updated_at: STALE_UPDATED_AT,
        contacts: [{ name: '相談員A' }],
      }),
      {
        params: Promise.resolve({ id: 'facility_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      details: {
        conflict_type: 'stale_facility_contacts',
        expected_updated_at: STALE_UPDATED_AT,
        current_updated_at: CURRENT_UPDATED_AT,
      },
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(facilityContactDeleteManyMock).not.toHaveBeenCalled();
    expect(facilityContactCreateManyMock).not.toHaveBeenCalled();
  });

  it('does not delete contacts when the facility version claim loses the race', async () => {
    facilityUpdateManyMock.mockResolvedValueOnce({ count: 0 });

    const response = await PUT(
      createRequest({
        contacts: [{ name: '相談員A' }],
      }),
      {
        params: Promise.resolve({ id: 'facility_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    expect(facilityUpdateManyMock).toHaveBeenCalledTimes(1);
    expect(facilityContactDeleteManyMock).not.toHaveBeenCalled();
    expect(facilityContactCreateManyMock).not.toHaveBeenCalled();
  });

  it('normalizes blank optional contact numbers to null when replacing contacts', async () => {
    const response = await PUT(
      createRequest({
        contacts: [
          {
            name: '相談員A',
            phone: '   ',
            fax: '\t',
          },
        ],
      }),
      {
        params: Promise.resolve({ id: 'facility_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(facilityContactCreateManyMock).toHaveBeenCalledWith({
      data: [
        {
          org_id: 'org_1',
          facility_id: 'facility_1',
          name: '相談員A',
          role: null,
          phone: null,
          email: null,
          fax: null,
          is_primary: false,
          notes: null,
        },
      ],
    });
  });

  it('rejects malformed contact numbers before replacing contacts', async () => {
    const response = await PUT(
      createRequest({
        contacts: [
          {
            name: '相談員A',
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

  it('rejects non-object replacement payloads before loading the facility', async () => {
    const response = await PUT(createRequest([]), {
      params: Promise.resolve({ id: 'facility_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(facilityFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(facilityContactDeleteManyMock).not.toHaveBeenCalled();
    expect(facilityContactCreateManyMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON replacement payloads before loading the facility', async () => {
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
