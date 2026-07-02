import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  loggerErrorMock,
  patientFindFirstMock,
  requireAuthContextMock,
  runWithRequestAuthContextMock,
  withRoutePerformanceMock,
  medicationProfileFindManyMock,
  medicationProfileCreateMock,
  drugMasterFindFirstMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  loggerErrorMock: vi.fn(),
  patientFindFirstMock: vi.fn(),
  requireAuthContextMock: vi.fn(),
  runWithRequestAuthContextMock: vi.fn((_ctx, callback: () => unknown) => callback()),
  withRoutePerformanceMock: vi.fn((_req, callback: () => unknown) => callback()),
  medicationProfileFindManyMock: vi.fn(),
  medicationProfileCreateMock: vi.fn(),
  drugMasterFindFirstMock: vi.fn(),
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
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/auth/request-context', () => ({
  runWithRequestAuthContext: runWithRequestAuthContextMock,
}));

vi.mock('@/lib/utils/logger', () => ({
  logger: {
    error: loggerErrorMock,
  },
}));

vi.mock('@/lib/utils/performance', () => ({
  withRoutePerformance: withRoutePerformanceMock,
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
    requireAuthContextMock.mockResolvedValue({ ctx: authContext });
    runWithRequestAuthContextMock.mockImplementation((_ctx, callback) => callback());
    patientFindFirstMock.mockResolvedValue({ id: 'patient_1' });
    medicationProfileFindManyMock.mockResolvedValue([
      { id: 'profile_1', patient_id: 'patient_1', drug_name: 'アムロジピン' },
    ]);
    medicationProfileCreateMock.mockResolvedValue({
      id: 'profile_2',
      patient_id: 'patient_1',
    });
    drugMasterFindFirstMock.mockResolvedValue({
      id: 'drug_master_1',
    });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        drugMaster: {
          findFirst: drugMasterFindFirstMock,
        },
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
    expect(withRoutePerformanceMock).toHaveBeenCalledWith(
      expect.any(NextRequest),
      expect.any(Function),
    );
    expect(requireAuthContextMock).toHaveBeenCalledWith(expect.any(NextRequest), {
      permission: 'canVisit',
      message: '薬剤プロファイルの閲覧権限がありません',
    });
    expect(runWithRequestAuthContextMock).toHaveBeenCalledWith(authContext, expect.any(Function));
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
    const err = new Error('raw medication profile list secret');
    err.name = 'MedicationProfileListSecretError';
    medicationProfileFindManyMock.mockRejectedValueOnce(err);

    const response = (await GET(createGetRequest(), emptyRouteContext))!;

    expect(response.status).toBe(500);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    const bodyText = await response.text();
    expect(bodyText).toContain('INTERNAL_ERROR');
    expect(bodyText).not.toContain('raw medication profile list secret');
    expect(loggerErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'medication_profiles_get_unhandled_error',
        route: '/api/medication-profiles',
        method: 'GET',
        status: 500,
      }),
      err,
    );
    const [logContext, logError] = loggerErrorMock.mock.calls[0] ?? [];
    expect(logError).toBe(err);
    expect(logContext).not.toHaveProperty('error_name');
    const logContextText = JSON.stringify(logContext);
    expect(logContextText).not.toContain('raw medication profile list secret');
    expect(logContextText).not.toContain('MedicationProfileListSecretError');
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
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    expect(withRoutePerformanceMock).toHaveBeenCalledWith(
      expect.any(NextRequest),
      expect.any(Function),
    );
    expect(requireAuthContextMock).toHaveBeenCalledWith(expect.any(NextRequest), {
      permission: 'canVisit',
      message: '薬剤プロファイルの作成権限がありません',
    });
    expect(runWithRequestAuthContextMock).toHaveBeenCalledWith(authContext, expect.any(Function));
    expect(medicationProfileCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        patient_id: 'patient_1',
        drug_name: 'アムロジピン',
        start_date: new Date('2026-03-29'),
      }),
    });
    expect(drugMasterFindFirstMock).not.toHaveBeenCalled();
  });

  it('validates and stores a selected DrugMaster id for manual medication profiles', async () => {
    const response = (await POST(
      createPostRequest({
        patient_id: 'patient_1',
        drug_master_id: ' drug_master_1 ',
        drug_name: 'アムロジピン',
        start_date: '2026-03-29',
      }),
      emptyRouteContext,
    ))!;

    expect(response.status).toBe(201);
    expect(drugMasterFindFirstMock).toHaveBeenCalledWith({
      where: { id: 'drug_master_1' },
      select: { id: true },
    });
    expect(medicationProfileCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        patient_id: 'patient_1',
        drug_master_id: 'drug_master_1',
        drug_name: 'アムロジピン',
      }),
    });
  });

  it('rejects an unknown DrugMaster id before creating a manual medication profile', async () => {
    drugMasterFindFirstMock.mockResolvedValueOnce(null);

    const response = (await POST(
      createPostRequest({
        patient_id: 'patient_1',
        drug_master_id: 'missing_master',
        drug_name: 'アムロジピン',
      }),
      emptyRouteContext,
    ))!;

    expect(response.status).toBe(400);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '入力値が不正です',
      details: {
        drug_master_id: ['存在するYJコード付き医薬品マスターを選択してください'],
      },
    });
    expect(medicationProfileCreateMock).not.toHaveBeenCalled();
  });

  it('treats a blank DrugMaster id as unspecified instead of persisting it', async () => {
    const response = (await POST(
      createPostRequest({
        patient_id: 'patient_1',
        drug_master_id: '   ',
        drug_name: 'アムロジピン',
      }),
      emptyRouteContext,
    ))!;

    expect(response.status).toBe(201);
    expect(drugMasterFindFirstMock).not.toHaveBeenCalled();
    expect(medicationProfileCreateMock).toHaveBeenCalledWith({
      data: expect.not.objectContaining({
        drug_master_id: expect.anything(),
      }),
    });
  });

  it('rejects non-object create payloads before checking patient access', async () => {
    const response = (await POST(createPostRequest(['patient_1']), emptyRouteContext))!;

    expect(response.status).toBe(400);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
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
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
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
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    expect(medicationProfileFindManyMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(medicationProfileCreateMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when medication profile creation fails unexpectedly', async () => {
    const err = new Error('患者 山田太郎 raw medication profile create');
    err.name = 'MedicationProfileCreateSecretError';
    medicationProfileCreateMock.mockRejectedValueOnce(err);

    const response = (await POST(
      createPostRequest({
        patient_id: 'patient_1',
        drug_name: 'アムロジピン',
      }),
      emptyRouteContext,
    ))!;

    expect(response.status).toBe(500);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    const bodyText = await response.text();
    expect(bodyText).toContain('INTERNAL_ERROR');
    expect(bodyText).not.toContain('山田太郎');
    expect(bodyText).not.toContain('raw medication profile create');
    expect(loggerErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'medication_profiles_post_unhandled_error',
        route: '/api/medication-profiles',
        method: 'POST',
        status: 500,
      }),
      err,
    );
    const [logContext, logError] = loggerErrorMock.mock.calls[0] ?? [];
    expect(logError).toBe(err);
    expect(logContext).not.toHaveProperty('error_name');
    const logContextText = JSON.stringify(logContext);
    expect(logContextText).not.toContain('山田太郎');
    expect(logContextText).not.toContain('raw medication profile create');
    expect(logContextText).not.toContain('MedicationProfileCreateSecretError');
  });
});
