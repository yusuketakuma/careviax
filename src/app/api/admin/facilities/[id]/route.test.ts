import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  facilityFindFirstMock,
  residenceCountMock,
  residenceFindFirstMock,
  facilityUpdateManyMock,
  facilityFindFirstInTxMock,
  facilityDeleteMock,
  facilityContactDeleteManyMock,
  facilityContactCreateManyMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  facilityFindFirstMock: vi.fn(),
  residenceCountMock: vi.fn(),
  residenceFindFirstMock: vi.fn(),
  facilityUpdateManyMock: vi.fn(),
  facilityFindFirstInTxMock: vi.fn(),
  facilityDeleteMock: vi.fn(),
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
    residence: {
      count: residenceCountMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { DELETE, GET, PATCH } from './route';

type NextRequestInit = ConstructorParameters<typeof NextRequest>[1];
const CURRENT_UPDATED_AT = '2026-03-02T00:00:00.000Z';
const STALE_UPDATED_AT = '2026-03-01T00:00:00.000Z';

function createRequest(method: 'DELETE' | 'GET' | 'PATCH', body?: unknown) {
  const requestBody =
    method === 'PATCH' &&
    body &&
    typeof body === 'object' &&
    !Array.isArray(body) &&
    !('expected_updated_at' in body)
      ? { expected_updated_at: CURRENT_UPDATED_AT, ...body }
      : body;
  const init: NextRequestInit = {
    method,
    headers: { 'content-type': 'application/json' },
  };
  if (requestBody !== undefined) {
    init.body = JSON.stringify(requestBody);
  }
  return new NextRequest('http://localhost/api/admin/facilities/facility_1', init);
}

function createMalformedJsonRequest() {
  return new NextRequest('http://localhost/api/admin/facilities/facility_1', {
    method: 'PATCH',
    body: '{bad-json',
    headers: { 'content-type': 'application/json' },
  });
}

function expectNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
}

describe('/api/admin/facilities/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    facilityFindFirstMock.mockResolvedValue({
      id: 'facility_1',
      updated_at: new Date(CURRENT_UPDATED_AT),
    });
    facilityUpdateManyMock.mockResolvedValue({ count: 1 });
    facilityFindFirstInTxMock.mockResolvedValue({
      id: 'facility_1',
      name: 'あおば苑',
      facility_type: 'group_home',
      address: '東京都千代田区1-1-1',
      phone: '03-1111-2222',
      fax: null,
      acceptance_time_from: new Date('1970-01-01T09:30:00.000Z'),
      acceptance_time_to: new Date('1970-01-01T15:30:00.000Z'),
      regular_visit_weekdays: [1, 3, 5],
      notes: '更新メモ',
      created_at: new Date('2026-03-01T00:00:00.000Z'),
      updated_at: new Date(CURRENT_UPDATED_AT),
      contacts: [
        {
          id: 'contact_1',
          name: '相談員A',
          role: '相談員',
          phone: '03-3333-4444',
          email: null,
          fax: null,
          is_primary: true,
          notes: null,
          created_at: new Date('2026-03-28T00:00:00.000Z'),
          updated_at: new Date(CURRENT_UPDATED_AT),
        },
      ],
    });
    facilityDeleteMock.mockResolvedValue({ id: 'facility_1' });
    residenceCountMock.mockResolvedValue(2);
    residenceFindFirstMock.mockResolvedValue(null);
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        facilityContact: {
          deleteMany: facilityContactDeleteManyMock,
          createMany: facilityContactCreateManyMock,
        },
        residence: {
          findFirst: residenceFindFirstMock,
        },
        facility: {
          updateMany: facilityUpdateManyMock,
          findFirst: facilityFindFirstInTxMock,
          delete: facilityDeleteMock,
        },
      }),
    );
  });

  it('updates a facility and replaces nested contacts', async () => {
    const response = await PATCH(
      createRequest('PATCH', {
        name: 'あおば苑',
        facility_type: 'group_home',
        address: '東京都千代田区1-1-1',
        phone: ' 03-1111-2222 ',
        fax: '   ',
        acceptance_time_from: '09:30',
        acceptance_time_to: '15:30',
        regular_visit_weekdays: [1, 3, 5],
        notes: '更新メモ',
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
      { params: Promise.resolve({ id: 'facility_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(facilityContactDeleteManyMock).toHaveBeenCalledWith({
      where: { org_id: 'org_1', facility_id: 'facility_1' },
    });
    expect(facilityUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'facility_1',
          org_id: 'org_1',
          updated_at: new Date(CURRENT_UPDATED_AT),
        },
        data: expect.objectContaining({
          name: 'あおば苑',
          facility_type: 'group_home',
          phone: '03-1111-2222',
          fax: null,
          acceptance_time_from: new Date('1970-01-01T09:30:00.000Z'),
          acceptance_time_to: new Date('1970-01-01T15:30:00.000Z'),
          regular_visit_weekdays: [1, 3, 5],
        }),
      }),
    );
    expect(facilityContactCreateManyMock).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          org_id: 'org_1',
          facility_id: 'facility_1',
          name: '相談員A',
          role: '相談員',
          phone: '03-3333-4444',
          fax: '03-3333-5555',
        }),
      ],
    });
  });

  it('does not clear facility contact numbers when PATCH omits them', async () => {
    const response = await PATCH(createRequest('PATCH', { notes: '更新メモ' }), {
      params: Promise.resolve({ id: 'facility_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(facilityContactDeleteManyMock).not.toHaveBeenCalled();
    expect(facilityUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'facility_1',
          org_id: 'org_1',
          updated_at: new Date(CURRENT_UPDATED_AT),
        },
        data: expect.objectContaining({
          notes: '更新メモ',
          updated_at: expect.any(Date),
        }),
      }),
    );
  });

  it('rejects malformed facility contact numbers before loading the facility', async () => {
    const response = await PATCH(
      createRequest('PATCH', {
        phone: '03-ABCD-5678',
        fax: 'FAX-0001',
        contacts: [
          {
            name: '相談員A',
            phone: '03-ABCD-4444',
          },
        ],
      }),
      { params: Promise.resolve({ id: 'facility_1' }) },
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
    expect(facilityFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(facilityUpdateManyMock).not.toHaveBeenCalled();
  });

  it('requires expected_updated_at before loading the facility for PATCH', async () => {
    const response = await PATCH(
      createRequest('PATCH', {
        expected_updated_at: undefined,
        notes: '更新メモ',
      }),
      { params: Promise.resolve({ id: 'facility_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      details: { expected_updated_at: expect.any(Array) },
    });
    expect(facilityFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(facilityUpdateManyMock).not.toHaveBeenCalled();
  });

  it('rejects stale expected_updated_at before replacing nested contacts', async () => {
    const response = await PATCH(
      createRequest('PATCH', {
        expected_updated_at: STALE_UPDATED_AT,
        contacts: [{ name: '相談員A' }],
      }),
      { params: Promise.resolve({ id: 'facility_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      details: {
        conflict_type: 'stale_facility',
        expected_updated_at: STALE_UPDATED_AT,
        current_updated_at: CURRENT_UPDATED_AT,
      },
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(facilityContactDeleteManyMock).not.toHaveBeenCalled();
    expect(facilityContactCreateManyMock).not.toHaveBeenCalled();
  });

  it('does not replace contacts when the facility version claim loses the race', async () => {
    facilityUpdateManyMock.mockResolvedValueOnce({ count: 0 });

    const response = await PATCH(
      createRequest('PATCH', {
        contacts: [{ name: '相談員A' }],
      }),
      { params: Promise.resolve({ id: 'facility_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    expect(facilityUpdateManyMock).toHaveBeenCalledTimes(1);
    expect(facilityContactDeleteManyMock).not.toHaveBeenCalled();
    expect(facilityContactCreateManyMock).not.toHaveBeenCalled();
  });

  it('rejects non-object update payloads before loading the facility', async () => {
    const response = await PATCH(createRequest('PATCH', []), {
      params: Promise.resolve({ id: 'facility_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(facilityFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(facilityUpdateManyMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON update payloads before loading the facility', async () => {
    const response = await PATCH(createMalformedJsonRequest(), {
      params: Promise.resolve({ id: 'facility_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(facilityFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(facilityUpdateManyMock).not.toHaveBeenCalled();
  });

  it('returns facility detail with patient count', async () => {
    facilityFindFirstMock.mockResolvedValueOnce({
      id: 'facility_1',
      name: 'あおば苑',
      facility_type: 'group_home',
      address: '東京都千代田区1-1-1',
      phone: '03-1111-2222',
      fax: null,
      acceptance_time_from: new Date('1970-01-01T09:30:00.000Z'),
      acceptance_time_to: new Date('1970-01-01T15:30:00.000Z'),
      regular_visit_weekdays: [1, 3, 5],
      notes: '更新メモ',
      _count: {
        residences: 2,
      },
      contacts: [
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
      ],
      created_at: new Date('2026-03-01T00:00:00.000Z'),
      updated_at: new Date(CURRENT_UPDATED_AT),
    });

    const response = await GET(createRequest('GET'), {
      params: Promise.resolve({ id: 'facility_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectNoStore(response);
    expect(residenceCountMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        facility_id: 'facility_1',
        is_primary: true,
      },
    });
    await expect(response.json()).resolves.toMatchObject({
      data: {
        id: 'facility_1',
        patient_count: 2,
        acceptance_time_from: '09:30',
        acceptance_time_to: '15:30',
        regular_visit_weekdays: [1, 3, 5],
        updated_at: CURRENT_UPDATED_AT,
      },
    });
  });

  it('returns a no-store 404 when the facility does not exist', async () => {
    facilityFindFirstMock.mockResolvedValueOnce(null);

    const response = await GET(createRequest('GET'), {
      params: Promise.resolve({ id: 'missing_facility' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(404);
    expectNoStore(response);
  });

  it('returns a sanitized no-store 500 when facility detail fails to load', async () => {
    facilityFindFirstMock.mockRejectedValueOnce(new Error('raw facility detail secret'));

    const response = await GET(createRequest('GET'), {
      params: Promise.resolve({ id: 'facility_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(500);
    expectNoStore(response);
    const bodyText = await response.text();
    expect(bodyText).toContain('INTERNAL_ERROR');
    expect(bodyText).not.toContain('raw facility detail secret');
  });

  it('deletes a facility', async () => {
    const response = await DELETE(createRequest('DELETE'), {
      params: Promise.resolve({ id: 'facility_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(facilityDeleteMock).toHaveBeenCalledWith({
      where: { id: 'facility_1' },
    });
  });

  it('returns conflict when the facility is referenced by a residence', async () => {
    residenceFindFirstMock.mockResolvedValue({ id: 'residence_1' });

    const response = await DELETE(createRequest('DELETE'), {
      params: Promise.resolve({ id: 'facility_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    expect(residenceFindFirstMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        facility_id: 'facility_1',
      },
      select: {
        id: true,
      },
    });
    expect(facilityDeleteMock).not.toHaveBeenCalled();
  });
});
