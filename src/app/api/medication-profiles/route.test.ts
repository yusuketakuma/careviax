import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  patientFindFirstMock,
  medicationProfileFindManyMock,
  medicationProfileCreateMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  patientFindFirstMock: vi.fn(),
  medicationProfileFindManyMock: vi.fn(),
  medicationProfileCreateMock: vi.fn(),
  withOrgContextMock: vi.fn(),
}));

const emptyRouteContext = { params: Promise.resolve({}) };
const authContext = {
  orgId: 'org_1',
  userId: 'user_1',
  role: 'pharmacist',
  ipAddress: '127.0.0.1',
  userAgent: 'vitest',
};

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (
    handler: (
      req: NextRequest,
      ctx: typeof authContext,
      routeContext: typeof emptyRouteContext,
    ) => Promise<Response>,
  ) => {
    return (req: NextRequest, routeContext = emptyRouteContext) =>
      handler(req, authContext, routeContext);
  },
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    patient: {
      findFirst: patientFindFirstMock,
    },
    medicationProfile: {
      findMany: medicationProfileFindManyMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { GET, POST } from './route';

function createGetRequest(search = '') {
  return new NextRequest(`http://localhost/api/medication-profiles${search}`);
}

function createPostRequest(body: unknown) {
  return new NextRequest('http://localhost/api/medication-profiles', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function createMalformedJsonPostRequest() {
  return new NextRequest('http://localhost/api/medication-profiles', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{"patient_id":',
  });
}

describe('/api/medication-profiles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    patientFindFirstMock.mockResolvedValue({ id: 'patient_1' });
    medicationProfileFindManyMock.mockResolvedValue([
      { id: 'profile_1', patient_id: 'patient_1', drug_name: 'アムロジピン' },
    ]);
    medicationProfileCreateMock.mockResolvedValue({
      id: 'profile_2',
      patient_id: 'patient_1',
    });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        medicationProfile: {
          create: medicationProfileCreateMock,
        },
      }),
    );
  });

  it('lists medication profiles', async () => {
    const response = (await GET(
      createGetRequest('?patient_id=patient_1&is_current=true'),
      emptyRouteContext,
    ))!;

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    expect(patientFindFirstMock).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'patient_1',
        org_id: 'org_1',
      }),
      select: { id: true },
    });
    expect(medicationProfileFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
        where: expect.objectContaining({
          org_id: 'org_1',
          patient_id: 'patient_1',
          is_current: true,
        }),
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      data: [{ id: 'profile_1', drug_name: 'アムロジピン' }],
    });
  });

  it('hides an inaccessible patient before reading medication profiles', async () => {
    patientFindFirstMock.mockResolvedValue(null);

    const response = (await GET(createGetRequest('?patient_id=patient_2'), emptyRouteContext))!;

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    await expect(response.json()).resolves.toMatchObject({
      data: [],
      hasMore: false,
    });
    expect(medicationProfileFindManyMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(medicationProfileCreateMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when medication profile listing fails unexpectedly', async () => {
    medicationProfileFindManyMock.mockRejectedValueOnce(new Error('raw medication profile secret'));

    const response = (await GET(createGetRequest(), emptyRouteContext))!;

    expect(response.status).toBe(500);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    const bodyText = await response.text();
    expect(bodyText).toContain('INTERNAL_ERROR');
    expect(bodyText).not.toContain('raw medication profile secret');
  });

  it.each([
    ['patient_id=', 'patient_id', '患者IDを指定してください'],
    ['patient_id=%20patient_1', 'patient_id', '患者IDの形式が不正です'],
    [`patient_id=${'a'.repeat(101)}`, 'patient_id', '患者IDの形式が不正です'],
    ['is_current=', 'is_current', 'is_current は true または false で指定してください'],
    ['is_current=yes', 'is_current', 'is_current は true または false で指定してください'],
    ['is_current=true%20', 'is_current', 'is_current は true または false で指定してください'],
  ])(
    'rejects blank or malformed medication profile filter query "%s" before DB access',
    async (query, fieldName, message) => {
      const response = (await GET(createGetRequest(`?${query}`), emptyRouteContext))!;

      expect(response.status).toBe(400);
      expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
      expect(response.headers.get('Pragma')).toBe('no-cache');
      await expect(response.json()).resolves.toMatchObject({
        code: 'VALIDATION_ERROR',
        message: '検索条件が不正です',
        details: {
          [fieldName]: [message],
        },
      });
      expect(patientFindFirstMock).not.toHaveBeenCalled();
      expect(medicationProfileFindManyMock).not.toHaveBeenCalled();
      expect(withOrgContextMock).not.toHaveBeenCalled();
      expect(medicationProfileCreateMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['patient_id=patient_1&patient_id=patient_2', 'patient_id'],
    ['is_current=true&is_current=false', 'is_current'],
  ])(
    'rejects duplicate medication profile filter query "%s" before DB access',
    async (query, fieldName) => {
      const response = (await GET(createGetRequest(`?${query}`), emptyRouteContext))!;

      expect(response.status).toBe(400);
      expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
      expect(response.headers.get('Pragma')).toBe('no-cache');
      await expect(response.json()).resolves.toMatchObject({
        code: 'VALIDATION_ERROR',
        message: '検索条件が不正です',
        details: {
          [fieldName]: [`${fieldName} は1つだけ指定してください`],
        },
      });
      expect(patientFindFirstMock).not.toHaveBeenCalled();
      expect(medicationProfileFindManyMock).not.toHaveBeenCalled();
      expect(withOrgContextMock).not.toHaveBeenCalled();
      expect(medicationProfileCreateMock).not.toHaveBeenCalled();
    },
  );

  it('creates a medication profile with normalized dates', async () => {
    const response = (await POST(
      createPostRequest({
        patient_id: 'patient_1',
        drug_name: 'アムロジピン',
        start_date: '2026-03-29',
      }),
      emptyRouteContext,
    ))!;

    expect(response.status).toBe(201);
    expect(medicationProfileCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        patient_id: 'patient_1',
        drug_name: 'アムロジピン',
        start_date: new Date('2026-03-29'),
      }),
    });
  });

  it('rejects non-object create payloads before checking patient access', async () => {
    const response = (await POST(createPostRequest(['patient_1']), emptyRouteContext))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(medicationProfileFindManyMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(medicationProfileCreateMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON create payloads before checking patient access', async () => {
    const response = (await POST(createMalformedJsonPostRequest(), emptyRouteContext))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(medicationProfileFindManyMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(medicationProfileCreateMock).not.toHaveBeenCalled();
  });

  it('returns 404 before creating a medication profile for an inaccessible patient', async () => {
    patientFindFirstMock.mockResolvedValue(null);

    const response = (await POST(
      createPostRequest({
        patient_id: 'patient_2',
        drug_name: 'アムロジピン',
      }),
      emptyRouteContext,
    ))!;

    expect(response.status).toBe(404);
    expect(medicationProfileFindManyMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(medicationProfileCreateMock).not.toHaveBeenCalled();
  });
});
