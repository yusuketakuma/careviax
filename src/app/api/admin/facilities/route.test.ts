import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  authMock,
  membershipFindFirstMock,
  facilityFindManyMock,
  facilityCreateMock,
  residenceGroupByMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  facilityFindManyMock: vi.fn(),
  facilityCreateMock: vi.fn(),
  residenceGroupByMock: vi.fn(),
  withOrgContextMock: vi.fn(),
}));

vi.mock('@/lib/auth/config', () => ({
  auth: authMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    membership: {
      findFirst: membershipFindFirstMock,
    },
    facility: {
      findMany: facilityFindManyMock,
    },
    residence: {
      groupBy: residenceGroupByMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { GET, POST } from './route';

const emptyRouteContext = { params: Promise.resolve({}) };

type NextRequestInit = ConstructorParameters<typeof NextRequest>[1];

function createRequest(headers?: Record<string, string>, body?: unknown) {
  const init: NextRequestInit = {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      ...(headers ?? {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
  };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  return new NextRequest('http://localhost/api/admin/facilities', init);
}

function createGetRequest(url: string, headers?: Record<string, string>) {
  return new NextRequest(url, {
    method: 'GET',
    headers,
  });
}

function createMalformedJsonRequest(headers?: Record<string, string>) {
  return new NextRequest('http://localhost/api/admin/facilities', {
    method: 'POST',
    body: '{bad-json',
    headers: {
      ...(headers ?? {}),
      'content-type': 'application/json',
    },
  });
}

function expectNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
}

describe('/api/admin/facilities GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    facilityCreateMock.mockResolvedValue({
      id: 'facility_2',
      name: 'みどり苑',
      facility_type: 'group_home',
      address: null,
      phone: null,
      fax: null,
      acceptance_time_from: null,
      acceptance_time_to: null,
      regular_visit_weekdays: [2, 4],
      notes: null,
      patient_count: 0,
      contacts: [],
      created_at: new Date('2026-03-01T00:00:00Z'),
      updated_at: new Date('2026-03-01T00:00:00Z'),
    });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        facility: {
          create: facilityCreateMock,
        },
      }),
    );
  });

  it('returns 403 when the role lacks admin permission', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'clerk' });

    const response = await GET(createRequest({ 'x-org-id': 'org_1' }), emptyRouteContext);

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(403);
    expectNoStore(response);
  });

  it('returns facilities for pharmacists who can reference facility masters', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'pharmacist' });
    residenceGroupByMock.mockResolvedValue([
      {
        facility_id: 'facility_1',
        _count: {
          _all: 3,
        },
      },
    ]);
    facilityFindManyMock.mockResolvedValue([
      {
        id: 'facility_1',
        name: 'あおば苑',
        facility_type: 'nursing_home',
        address: '東京都新宿区1-1-1',
        phone: '03-1234-5678',
        fax: null,
        acceptance_time_from: new Date('1970-01-01T09:00:00.000Z'),
        acceptance_time_to: new Date('1970-01-01T17:00:00.000Z'),
        regular_visit_weekdays: [1, 3, 5],
        notes: null,
        created_at: new Date('2026-03-01T00:00:00Z'),
        updated_at: new Date('2026-03-02T00:00:00Z'),
        contacts: [
          {
            id: 'contact_1',
            name: '施設担当',
            role: '看護師長',
            phone: '03-0000-0000',
            email: 'facility@example.com',
            fax: null,
            is_primary: true,
            notes: null,
            created_at: new Date('2026-03-01T00:00:00Z'),
            updated_at: new Date('2026-03-02T00:00:00Z'),
          },
        ],
      },
    ]);

    const response = await GET(createRequest({ 'x-org-id': 'org_1' }), emptyRouteContext);

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      data: [
        expect.objectContaining({
          id: 'facility_1',
          name: 'あおば苑',
          acceptance_time_from: '09:00',
          acceptance_time_to: '17:00',
          patient_count: 3,
          contacts: [expect.objectContaining({ name: '施設担当' })],
        }),
      ],
    });
  });

  it('uses bounded server-side search and returns a minimal facility projection', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'pharmacist' });
    facilityFindManyMock.mockResolvedValue([
      {
        id: 'facility_1',
        name: 'あおば苑',
        facility_type: 'nursing_home',
        address: '東京都新宿区1-1-1',
        phone: '03-1234-5678',
        fax: '03-1234-5679',
        notes: 'internal note',
        contacts: [{ name: '施設担当' }],
      },
      {
        id: 'facility_2',
        name: 'あおば第二',
        facility_type: 'group_home',
        address: null,
        phone: null,
        fax: null,
        notes: null,
        contacts: [],
      },
      {
        id: 'facility_3',
        name: 'あおば第三',
        facility_type: 'group_home',
        address: null,
        phone: null,
        fax: null,
        notes: null,
        contacts: [],
      },
    ]);
    residenceGroupByMock.mockResolvedValue([
      {
        facility_id: 'facility_1',
        _count: {
          _all: 3,
        },
      },
      {
        facility_id: 'facility_2',
        _count: {
          _all: 1,
        },
      },
    ]);

    const response = await GET(
      createGetRequest(
        'http://localhost/api/admin/facilities?q=%E3%81%82%E3%81%8A%E3%81%B0&limit=2',
        {
          'x-org-id': 'org_1',
        },
      ),
      emptyRouteContext,
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectNoStore(response);
    expect(facilityFindManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        OR: [
          { name: { contains: 'あおば', mode: 'insensitive' } },
          { address: { contains: 'あおば', mode: 'insensitive' } },
        ],
      },
      select: {
        id: true,
        name: true,
        facility_type: true,
        address: true,
      },
      take: 3,
      orderBy: [{ name: 'asc' }],
    });
    expect(residenceGroupByMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          facility_id: {
            in: ['facility_1', 'facility_2'],
          },
        }),
      }),
    );
    const body = await response.json();
    expect(body).toEqual({
      data: [
        {
          id: 'facility_1',
          name: 'あおば苑',
          facility_type: 'nursing_home',
          address: '東京都新宿区1-1-1',
          patient_count: 3,
        },
        {
          id: 'facility_2',
          name: 'あおば第二',
          facility_type: 'group_home',
          address: null,
          patient_count: 1,
        },
      ],
      hasMore: true,
    });
    expect(body.data[0]).not.toHaveProperty('contacts');
    expect(body.data[0]).not.toHaveProperty('phone');
    expect(body.data[0]).not.toHaveProperty('fax');
    expect(body.data[0]).not.toHaveProperty('notes');
  });

  it('returns a sanitized no-store 500 when facilities fail to load', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'pharmacist' });
    facilityFindManyMock.mockRejectedValueOnce(new Error('raw facility roster secret'));

    const response = await GET(createRequest({ 'x-org-id': 'org_1' }), emptyRouteContext);

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(500);
    expectNoStore(response);
    const bodyText = await response.text();
    expect(bodyText).toContain('INTERNAL_ERROR');
    expect(bodyText).not.toContain('raw facility roster secret');
  });

  it('creates a facility with regular visit weekdays', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });

    const response = await POST(
      createRequest(
        { 'x-org-id': 'org_1' },
        {
          name: 'みどり苑',
          facility_type: 'group_home',
          phone: ' 03-1234-5678 ',
          fax: '   ',
          regular_visit_weekdays: [2, 4],
          contacts: [
            {
              name: '施設担当',
              phone: ' 03-0000-0000 ',
              fax: ' 03-0000-0001 ',
              is_primary: true,
            },
          ],
        },
      ),
      emptyRouteContext,
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(facilityCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        name: 'みどり苑',
        facility_type: 'group_home',
        phone: '03-1234-5678',
        fax: null,
        regular_visit_weekdays: [2, 4],
        contacts: {
          create: [
            expect.objectContaining({
              org_id: 'org_1',
              name: '施設担当',
              phone: '03-0000-0000',
              fax: '03-0000-0001',
              is_primary: true,
            }),
          ],
        },
      }),
      include: expect.any(Object),
    });
  });

  it('rejects malformed facility contact numbers before opening an org transaction', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });

    const response = await POST(
      createRequest(
        { 'x-org-id': 'org_1' },
        {
          name: 'みどり苑',
          facility_type: 'group_home',
          phone: '03-ABCD-5678',
          fax: 'FAX-0001',
        },
      ),
      emptyRouteContext,
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: {
        phone: ['電話番号形式が不正です'],
        fax: ['FAX番号形式が不正です'],
      },
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(facilityCreateMock).not.toHaveBeenCalled();
  });

  it('rejects non-object create payloads before opening an org transaction', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });

    const response = await POST(createRequest({ 'x-org-id': 'org_1' }, []), emptyRouteContext);

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(facilityCreateMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON create payloads before opening an org transaction', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });

    const response = await POST(
      createMalformedJsonRequest({ 'x-org-id': 'org_1' }),
      emptyRouteContext,
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(facilityCreateMock).not.toHaveBeenCalled();
  });
});
