import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  authMock,
  membershipFindFirstMock,
  careCaseFindManyMock,
  userFindManyMock,
  patientFindFirstMock,
  careCaseCreateMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  careCaseFindManyMock: vi.fn(),
  userFindManyMock: vi.fn(),
  patientFindFirstMock: vi.fn(),
  careCaseCreateMock: vi.fn(),
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
    careCase: {
      findMany: careCaseFindManyMock,
    },
    user: {
      findMany: userFindManyMock,
    },
    patient: {
      findFirst: patientFindFirstMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { GET, POST } from './route';

const emptyRouteContext = { params: Promise.resolve({}) };

function createRequest(url: string, body?: unknown) {
  return new NextRequest(url, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      'x-org-id': 'org_1',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function createMalformedPostRequest() {
  return new NextRequest('http://localhost/api/cases', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-org-id': 'org_1',
    },
    body: '{"patient_id":',
  });
}

function expectSensitiveNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
}

describe('/api/cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'pharmacist' });
    careCaseFindManyMock.mockResolvedValue([
      {
        id: 'case_1',
        display_id: 'cc0000000001',
        org_id: 'org_1',
        patient_id: 'patient_1',
        primary_pharmacist_id: 'pharmacist_1',
        updated_at: new Date('2026-03-29T00:00:00.000Z'),
        patient: {
          id: 'patient_1',
          display_id: 'p0000000001',
          name: '患者A',
          name_kana: 'カンジャエー',
          residences: [],
        },
      },
    ]);
    userFindManyMock.mockResolvedValue([{ id: 'pharmacist_1', name: '担当薬剤師' }]);
    patientFindFirstMock.mockResolvedValue({ id: 'patient_1' });
    careCaseCreateMock.mockResolvedValue({
      id: 'case_2',
      display_id: 'cc0000000002',
      org_id: 'org_1',
      patient_id: 'patient_1',
      referral_source: '病院A',
    });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        careCase: {
          create: careCaseCreateMock,
        },
      }),
    );
  });

  it('lists cases and resolves primary pharmacist names', async () => {
    careCaseFindManyMock.mockResolvedValueOnce([
      {
        id: 'case_1',
        display_id: 'cc0000000001',
        org_id: 'org_1',
        patient_id: 'patient_1',
        primary_pharmacist_id: 'pharmacist_1',
        updated_at: new Date('2026-03-29T00:00:00.000Z'),
        patient: {
          id: 'patient_1',
          display_id: 'p0000000001',
          name: '患者A',
          name_kana: 'カンジャエー',
          residences: [],
        },
      },
      {
        id: 'case_0',
        display_id: 'cc0000000000',
        org_id: 'org_1',
        patient_id: 'patient_1',
        primary_pharmacist_id: null,
        updated_at: new Date('2026-03-28T00:00:00.000Z'),
        patient: {
          id: 'patient_1',
          display_id: 'p0000000001',
          name: '患者A',
          name_kana: 'カンジャエー',
          residences: [],
        },
      },
    ]);

    const response = (await GET(
      createRequest(
        'http://localhost/api/cases?patient_id=patient_1&status=active&q=%E6%82%A3%E8%80%85&limit=1',
      ),
      emptyRouteContext,
    ))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(careCaseFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          patient_id: 'patient_1',
          status: 'active',
          patient: {
            OR: [{ name: { contains: '患者' } }, { name_kana: { contains: '患者' } }],
          },
        }),
        take: 2,
      }),
    );
    const body = await response.json();
    expect(Object.keys(body)).toEqual(['data', 'hasMore', 'nextCursor']);
    expect(body).toMatchObject({
      data: [
        expect.objectContaining({
          id: 'case_1',
          display_id: 'cc0000000001',
          patient: expect.objectContaining({
            id: 'patient_1',
            display_id: 'p0000000001',
          }),
          primary_pharmacist_name: '担当薬剤師',
        }),
      ],
      hasMore: true,
      nextCursor: 'case_1',
    });
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe('case_1');
    expect(body.data[0].display_id).not.toBe(body.data[0].id);
    expect(body.data[0].patient.id).toBe('patient_1');
    expect(body.data[0].patient.display_id).toBe('p0000000001');
  });

  it('does not mark hasMore when cases exactly fill the requested limit', async () => {
    const response = (await GET(
      createRequest('http://localhost/api/cases?limit=1'),
      emptyRouteContext,
    ))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(Object.keys(body)).toEqual(['data', 'hasMore']);
    expect(body).toMatchObject({
      data: [expect.objectContaining({ id: 'case_1' })],
      hasMore: false,
    });
    expect(body).not.toHaveProperty('nextCursor');
    expect(body.data).toHaveLength(1);
    expect(careCaseFindManyMock).toHaveBeenCalledWith(expect.objectContaining({ take: 2 }));
  });

  it('rejects unsupported status filters before querying cases', async () => {
    const response = (await GET(
      createRequest('http://localhost/api/cases?status=bad_status'),
      emptyRouteContext,
    ))!;

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    expect(careCaseFindManyMock).not.toHaveBeenCalled();
    expect(userFindManyMock).not.toHaveBeenCalled();
  });

  it.each([
    {
      url: 'http://localhost/api/cases?patient_id=',
      details: { patient_id: ['patient_id が不正です'] },
    },
    {
      url: 'http://localhost/api/cases?patient_id=%20patient_1%20',
      details: { patient_id: ['patient_id が不正です'] },
    },
    {
      url: 'http://localhost/api/cases?patient_id=patient_1&patient_id=patient_2',
      details: { patient_id: ['patient_id は1つだけ指定してください'] },
    },
    {
      url: 'http://localhost/api/cases?status=',
      details: { status: ['ケースステータスが不正です'] },
    },
    {
      url: 'http://localhost/api/cases?status=active&status=assessment',
      details: { status: ['status は1つだけ指定してください'] },
    },
    {
      url: 'http://localhost/api/cases?q=',
      details: { q: ['q が不正です'] },
    },
    {
      url: 'http://localhost/api/cases?limit=1e2',
      details: { limit: ['limit は 1〜100 の整数で指定してください'] },
    },
    {
      url: 'http://localhost/api/cases?limit=101',
      details: { limit: ['limit は 1〜100 の整数で指定してください'] },
    },
    {
      url: 'http://localhost/api/cases?limit=20&limit=50',
      details: { limit: ['limit は1つだけ指定してください'] },
    },
    {
      url: 'http://localhost/api/cases?cursor=',
      details: { cursor: ['cursor が不正です'] },
    },
  ])('rejects invalid list query $url before querying cases', async ({ url, details }) => {
    const response = (await GET(createRequest(url), emptyRouteContext))!;

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      details,
    });
    expect(careCaseFindManyMock).not.toHaveBeenCalled();
    expect(userFindManyMock).not.toHaveBeenCalled();
  });

  it('creates a case for a patient in the same org', async () => {
    const response = (await POST(
      createRequest('http://localhost/api/cases', {
        patient_id: 'patient_1',
        referral_source: '病院A',
        referral_date: '2026-03-28',
        notes: '初回相談',
      }),
      emptyRouteContext,
    ))!;

    expect(response.status).toBe(201);
    expectSensitiveNoStore(response);
    expect(careCaseCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        patient_id: 'patient_1',
        referral_source: '病院A',
        notes: '初回相談',
      }),
    });
  });

  it('rejects non-object create payloads before loading the patient', async () => {
    const response = (await POST(
      createRequest('http://localhost/api/cases', []),
      emptyRouteContext,
    ))!;

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(careCaseCreateMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON before loading the patient', async () => {
    const response = (await POST(createMalformedPostRequest(), emptyRouteContext))!;

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(careCaseCreateMock).not.toHaveBeenCalled();
  });

  it('does not create a case for an unassigned patient', async () => {
    patientFindFirstMock.mockResolvedValue(null);

    const response = (await POST(
      createRequest('http://localhost/api/cases', {
        patient_id: 'patient_2',
        referral_source: '病院A',
        referral_date: '2026-03-28',
        notes: '初回相談',
      }),
      emptyRouteContext,
    ))!;

    expect(response.status).toBe(404);
    expectSensitiveNoStore(response);
    expect(careCaseCreateMock).not.toHaveBeenCalled();
  });

  it('adds no-store headers to POST auth failures', async () => {
    authMock.mockResolvedValue(null);

    const response = (await POST(
      createRequest('http://localhost/api/cases', {
        patient_id: 'patient_1',
        referral_source: '病院A',
      }),
      emptyRouteContext,
    ))!;

    expect(response.status).toBe(401);
    expectSensitiveNoStore(response);
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(careCaseCreateMock).not.toHaveBeenCalled();
  });

  it('adds no-store headers to POST permission failures', async () => {
    membershipFindFirstMock.mockResolvedValue({ role: 'driver' });

    const response = (await POST(
      createRequest('http://localhost/api/cases', {
        patient_id: 'patient_1',
        referral_source: '病院A',
      }),
      emptyRouteContext,
    ))!;

    expect(response.status).toBe(403);
    expectSensitiveNoStore(response);
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(careCaseCreateMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when case creation throws unexpectedly', async () => {
    careCaseCreateMock.mockRejectedValueOnce(
      new Error('raw case failure patient=患者A token=secret display_id=cc0000009999'),
    );

    const response = (await POST(
      createRequest('http://localhost/api/cases', {
        patient_id: 'patient_1',
        referral_source: '病院A',
        notes: '初回相談',
      }),
      emptyRouteContext,
    ))!;

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    const bodyText = JSON.stringify(body);
    expect(bodyText).not.toContain('患者A');
    expect(bodyText).not.toContain('token=secret');
    expect(bodyText).not.toContain('cc0000009999');
  });
});
