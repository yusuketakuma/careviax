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
        org_id: 'org_1',
        patient_id: 'patient_1',
        primary_pharmacist_id: 'pharmacist_1',
        updated_at: new Date('2026-03-29T00:00:00.000Z'),
        patient: {
          id: 'patient_1',
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
    const response = (await GET(
      createRequest(
        'http://localhost/api/cases?patient_id=patient_1&status=active&q=%E6%82%A3%E8%80%85',
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
        take: 51,
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      data: [
        expect.objectContaining({
          id: 'case_1',
          primary_pharmacist_name: '担当薬剤師',
        }),
      ],
    });
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
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(careCaseCreateMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON before loading the patient', async () => {
    const response = (await POST(createMalformedPostRequest(), emptyRouteContext))!;

    expect(response.status).toBe(400);
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
    expect(careCaseCreateMock).not.toHaveBeenCalled();
  });
});
