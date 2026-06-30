import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  patientFindFirstMock,
  patientInsuranceFindManyMock,
  patientInsuranceOverlapFindFirstMock,
  patientInsuranceCreateMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  patientFindFirstMock: vi.fn(),
  patientInsuranceFindManyMock: vi.fn(),
  patientInsuranceOverlapFindFirstMock: vi.fn(),
  patientInsuranceCreateMock: vi.fn(),
  withOrgContextMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    patient: {
      findFirst: patientFindFirstMock,
    },
    patientInsurance: {
      findMany: patientInsuranceFindManyMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { GET, POST } from './route';

function createRequest(body?: unknown) {
  return new NextRequest('http://localhost/api/patients/patient_1/insurance', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function createMalformedJsonRequest() {
  return new NextRequest('http://localhost/api/patients/patient_1/insurance', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{"insurance_type":',
  });
}

function createGetRequest() {
  return new NextRequest('http://localhost/api/patients/patient_1/insurance');
}

function expectSensitiveNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
}

const routeParams = { params: Promise.resolve({ id: 'patient_1' }) };
const patientAssignmentLookup = {
  where: {
    id: 'patient_1',
    org_id: 'org_1',
  },
  select: { id: true },
};
const writablePatientLookup = {
  where: {
    id: 'patient_1',
    org_id: 'org_1',
  },
  select: { id: true, archived_at: true },
};

function expectPatientAssignmentLookup() {
  expect(patientFindFirstMock).toHaveBeenCalledWith(patientAssignmentLookup);
}

function expectWritablePatientLookup() {
  expect(patientFindFirstMock).toHaveBeenCalledWith(writablePatientLookup);
}

describe('/api/patients/[id]/insurance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-15T12:00:00.000Z'));
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: 'org_1',
        userId: 'pharmacist_1',
        role: 'pharmacist',
      },
    });
    patientFindFirstMock.mockResolvedValue({ id: 'patient_1', archived_at: null });
    patientInsuranceFindManyMock.mockResolvedValue([]);
    patientInsuranceCreateMock.mockResolvedValue({ id: 'insurance_1' });
    patientInsuranceOverlapFindFirstMock.mockResolvedValue(null);
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        patientInsurance: {
          findFirst: patientInsuranceOverlapFindFirstMock,
          create: patientInsuranceCreateMock,
        },
      }),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('GET returns classified insurance records for an assigned patient', async () => {
    const currentInsurance = {
      id: 'insurance_current',
      is_active: true,
      valid_from: new Date('2026-04-01'),
      valid_until: new Date('2026-04-30'),
      created_at: new Date('2026-04-01T01:00:00.000Z'),
    };
    const upcomingInsurance = {
      id: 'insurance_upcoming',
      is_active: true,
      valid_from: new Date('2026-05-01'),
      valid_until: new Date('2027-03-31'),
      created_at: new Date('2026-04-02T01:00:00.000Z'),
    };
    const inactiveHistoryInsurance = {
      id: 'insurance_inactive_history',
      is_active: false,
      valid_from: new Date('2025-04-01'),
      valid_until: new Date('2026-03-31'),
      created_at: new Date('2025-04-01T01:00:00.000Z'),
    };
    const expiredHistoryInsurance = {
      id: 'insurance_expired_history',
      is_active: true,
      valid_from: new Date('2025-04-01'),
      valid_until: new Date('2026-03-31'),
      created_at: new Date('2025-04-02T01:00:00.000Z'),
    };
    patientInsuranceFindManyMock.mockResolvedValue([
      currentInsurance,
      upcomingInsurance,
      inactiveHistoryInsurance,
      expiredHistoryInsurance,
    ]);

    const response = await GET(createGetRequest(), routeParams);

    if (!response) throw new Error('response is required');

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expectPatientAssignmentLookup();
    expect(patientInsuranceFindManyMock).toHaveBeenCalledWith({
      where: { patient_id: 'patient_1', org_id: 'org_1' },
      orderBy: [{ is_active: 'desc' }, { valid_from: 'desc' }, { created_at: 'desc' }],
    });
    await expect(response.json()).resolves.toMatchObject({
      data: {
        current: [{ id: 'insurance_current' }],
        upcoming: [{ id: 'insurance_upcoming' }],
        history: [{ id: 'insurance_inactive_history' }, { id: 'insurance_expired_history' }],
        all: [
          { id: 'insurance_current' },
          { id: 'insurance_upcoming' },
          { id: 'insurance_inactive_history' },
          { id: 'insurance_expired_history' },
        ],
      },
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(patientInsuranceCreateMock).not.toHaveBeenCalled();
  });

  it('GET classifies a record valid from today as current even in JST mornings (@db.Date boundary)', async () => {
    const originalTimezone = process.env.TZ;
    process.env.TZ = 'Asia/Tokyo';
    try {
      // JST 2026-06-12 08:00(UTC では 2026-06-11T23:00Z)。
      // valid_from は @db.Date 規約どおり当日の UTC 深夜で保存されている。
      vi.setSystemTime(new Date('2026-06-12T08:00:00+09:00'));
      patientInsuranceFindManyMock.mockResolvedValue([
        {
          id: 'insurance_starts_today',
          is_active: true,
          valid_from: new Date('2026-06-12T00:00:00.000Z'),
          valid_until: null,
          created_at: new Date('2026-06-01T01:00:00.000Z'),
        },
        {
          id: 'insurance_ends_today',
          is_active: true,
          valid_from: new Date('2026-01-01T00:00:00.000Z'),
          valid_until: new Date('2026-06-12T00:00:00.000Z'),
          created_at: new Date('2026-01-01T01:00:00.000Z'),
        },
      ]);

      const response = await GET(createGetRequest(), routeParams);

      if (!response) throw new Error('response is required');

      expect(response.status).toBe(200);
      expectSensitiveNoStore(response);
      await expect(response.json()).resolves.toMatchObject({
        data: {
          current: [{ id: 'insurance_starts_today' }, { id: 'insurance_ends_today' }],
          upcoming: [],
          history: [],
        },
      });
    } finally {
      if (originalTimezone === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = originalTimezone;
      }
    }
  });

  it('GET returns 404 for an inaccessible patient without reading insurance records', async () => {
    patientFindFirstMock.mockResolvedValue(null);

    const response = await GET(createGetRequest(), routeParams);

    if (!response) throw new Error('response is required');

    expect(response.status).toBe(404);
    expectSensitiveNoStore(response);
    expectPatientAssignmentLookup();
    expect(patientInsuranceFindManyMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(patientInsuranceCreateMock).not.toHaveBeenCalled();
  });

  it('POST returns 409 for an archived patient before writing insurance records', async () => {
    patientFindFirstMock.mockResolvedValue({
      id: 'patient_1',
      archived_at: new Date('2026-04-01T00:00:00.000Z'),
    });

    const response = await POST(
      createRequest({
        insurance_type: 'medical',
        insurer_number: '12345678',
        valid_from: '2026-04-01',
      }),
      routeParams,
    );

    if (!response) throw new Error('response is required');

    expect(response.status).toBe(409);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: 'アーカイブ中の患者は復元するまで更新できません',
    });
    expectWritablePatientLookup();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(patientInsuranceCreateMock).not.toHaveBeenCalled();
  });

  it('GET rejects blank patient ids before patient or insurance lookup', async () => {
    const response = await GET(createGetRequest(), {
      params: Promise.resolve({ id: '   ' }),
    });

    if (!response) throw new Error('response is required');

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: '患者IDが不正です',
    });
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(patientInsuranceFindManyMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(patientInsuranceCreateMock).not.toHaveBeenCalled();
  });

  it('GET returns a sanitized no-store 500 when insurance reads fail', async () => {
    const rawError = '患者A insurance 12345678 read failure';
    patientInsuranceFindManyMock.mockRejectedValueOnce(new Error(rawError));

    const response = await GET(createGetRequest(), routeParams);

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(body)).not.toContain(rawError);
    expect(JSON.stringify(body)).not.toContain('患者A');
    expect(JSON.stringify(body)).not.toContain('12345678');
  });

  it('POST returns 404 for an inaccessible patient without reading or writing insurance records', async () => {
    patientFindFirstMock.mockResolvedValue(null);

    const response = await POST(
      createRequest({
        insurance_type: 'medical',
        insurer_number: '12345678',
        valid_from: '2026-04-01',
      }),
      routeParams,
    );

    if (!response) throw new Error('response is required');

    expect(response.status).toBe(404);
    expectWritablePatientLookup();
    expect(patientInsuranceFindManyMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(patientInsuranceCreateMock).not.toHaveBeenCalled();
  });

  it('POST rejects blank patient ids before parsing payloads or writing insurance records', async () => {
    const response = await POST(createMalformedJsonRequest(), {
      params: Promise.resolve({ id: '\t\n' }),
    });

    if (!response) throw new Error('response is required');

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: '患者IDが不正です',
    });
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(patientInsuranceFindManyMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(patientInsuranceCreateMock).not.toHaveBeenCalled();
  });

  it('POST rejects non-object payloads before patient lookup or DB writes', async () => {
    const response = await POST(createRequest([]), routeParams);

    if (!response) throw new Error('response is required');

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(patientInsuranceFindManyMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(patientInsuranceCreateMock).not.toHaveBeenCalled();
  });

  it('POST rejects malformed JSON payloads before patient lookup or DB writes', async () => {
    const response = await POST(createMalformedJsonRequest(), routeParams);

    if (!response) throw new Error('response is required');

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(patientInsuranceFindManyMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(patientInsuranceCreateMock).not.toHaveBeenCalled();
  });

  it('POST returns 400 for an invalid body before patient lookup or DB writes', async () => {
    const response = await POST(
      createRequest({
        insurance_type: 'medical',
        valid_from: '2026/04/01',
      }),
      routeParams,
    );

    if (!response) throw new Error('response is required');

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(patientInsuranceFindManyMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(patientInsuranceCreateMock).not.toHaveBeenCalled();
  });

  it('POST rejects invalid calendar dates and reversed validity periods before DB writes', async () => {
    const response = await POST(
      createRequest({
        insurance_type: 'medical',
        valid_from: '2026-02-30',
        valid_until: '2026-01-31',
      }),
      routeParams,
    );

    if (!response) throw new Error('response is required');

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(patientInsuranceCreateMock).not.toHaveBeenCalled();
  });

  it('POST rejects public subsidy fields on medical insurance before DB writes', async () => {
    const response = await POST(
      createRequest({
        insurance_type: 'medical',
        public_program_code: '54',
      }),
      routeParams,
    );

    if (!response) throw new Error('response is required');

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(patientInsuranceCreateMock).not.toHaveBeenCalled();
  });

  it('POST rejects reversed application and decision dates before DB writes', async () => {
    const response = await POST(
      createRequest({
        insurance_type: 'public_subsidy',
        application_status: 'applying',
        public_program_code: '21',
        application_submitted_at: '2026-04-20',
        decision_at: '2026-04-10',
      }),
      routeParams,
    );

    if (!response) throw new Error('response is required');

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(patientInsuranceCreateMock).not.toHaveBeenCalled();
  });

  it('POST creates insurance with context org, route patient, and Date validity fields', async () => {
    const response = await POST(
      createRequest({
        insurance_type: 'care',
        insurer_number: '87654321',
        symbol: 'A-1',
        number: '00001234',
        branch_number: '01',
        copay_ratio: 10,
        valid_from: '2026-04-01',
        valid_until: '2027-03-31',
        application_status: 'change_pending',
        application_submitted_at: '2026-04-10',
        decision_at: null,
        previous_care_level: 'care_1',
        provisional_care_level: 'care_2',
        confirmed_care_level: null,
        is_active: true,
        notes: 'initial registration',
      }),
      routeParams,
    );

    if (!response) throw new Error('response is required');

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expectWritablePatientLookup();
    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function));
    expect(patientInsuranceOverlapFindFirstMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        patient_id: 'patient_1',
        insurance_type: 'care',
        is_active: true,
        AND: [
          { OR: [{ valid_from: null }, { valid_from: { lte: new Date('2027-03-31') } }] },
          { OR: [{ valid_until: null }, { valid_until: { gte: new Date('2026-04-01') } }] },
        ],
      },
      select: { id: true },
    });
    expect(patientInsuranceCreateMock).toHaveBeenCalledWith({
      data: {
        org_id: 'org_1',
        patient_id: 'patient_1',
        insurance_type: 'care',
        insurer_number: '87654321',
        symbol: 'A-1',
        number: '00001234',
        branch_number: '01',
        copay_ratio: 10,
        is_active: true,
        notes: 'initial registration',
        valid_from: new Date('2026-04-01'),
        valid_until: new Date('2027-03-31'),
        application_status: 'change_pending',
        application_submitted_at: new Date('2026-04-10'),
        decision_at: null,
        previous_care_level: 'care_1',
        provisional_care_level: 'care_2',
        confirmed_care_level: null,
      },
    });
  });

  it('POST rejects overlapping active insurance before creating duplicate validity windows', async () => {
    patientInsuranceOverlapFindFirstMock.mockResolvedValue({ id: 'insurance_existing' });

    const response = await POST(
      createRequest({
        insurance_type: 'medical',
        number: '12345678',
        valid_from: '2026-04-01',
        valid_until: '2027-03-31',
        is_active: true,
      }),
      routeParams,
    );

    if (!response) throw new Error('response is required');

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: '同じ期間に有効な保険情報が既に存在します',
      details: {
        valid_from: ['同一患者・同一保険種別の有効期間が重複しています'],
      },
    });
    expect(patientInsuranceCreateMock).not.toHaveBeenCalled();
  });

  it('POST checks open-ended active insurance against all existing active start dates', async () => {
    const response = await POST(
      createRequest({
        insurance_type: 'medical',
        number: '12345678',
        valid_from: '2026-04-01',
        is_active: true,
      }),
      routeParams,
    );

    if (!response) throw new Error('response is required');

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(patientInsuranceOverlapFindFirstMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        patient_id: 'patient_1',
        insurance_type: 'medical',
        is_active: true,
        AND: [{ OR: [{ valid_until: null }, { valid_until: { gte: new Date('2026-04-01') } }] }],
      },
      select: { id: true },
    });
    expect(patientInsuranceCreateMock).toHaveBeenCalledWith({
      data: {
        org_id: 'org_1',
        patient_id: 'patient_1',
        insurance_type: 'medical',
        number: '12345678',
        is_active: true,
        valid_from: new Date('2026-04-01'),
        valid_until: null,
        application_submitted_at: null,
        decision_at: null,
      },
    });
  });

  it('POST creates public subsidy insurance application records for pending 21/54 programs', async () => {
    const response = await POST(
      createRequest({
        insurance_type: 'public_subsidy',
        application_status: 'applying',
        insurer_number: '21540000',
        public_program_code: '54',
        number: '54001234',
        valid_from: null,
        valid_until: null,
        application_submitted_at: '2026-04-12',
        decision_at: null,
        is_active: true,
      }),
      routeParams,
    );

    if (!response) throw new Error('response is required');

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expectWritablePatientLookup();
    expect(patientInsuranceCreateMock).toHaveBeenCalledWith({
      data: {
        org_id: 'org_1',
        patient_id: 'patient_1',
        insurance_type: 'public_subsidy',
        application_status: 'applying',
        insurer_number: '21540000',
        public_program_code: '54',
        number: '54001234',
        is_active: true,
        valid_from: null,
        valid_until: null,
        application_submitted_at: new Date('2026-04-12'),
        decision_at: null,
      },
    });
  });

  it('POST returns a sanitized no-store 500 when creation fails unexpectedly', async () => {
    patientInsuranceCreateMock.mockRejectedValueOnce(
      new Error('患者A insurance 12345678 create failure token-secret'),
    );

    const response = await POST(
      createRequest({
        insurance_type: 'medical',
        number: '12345678',
        valid_from: '2026-04-01',
      }),
      routeParams,
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    expect(JSON.stringify(body)).not.toContain('患者A');
    expect(JSON.stringify(body)).not.toContain('12345678');
    expect(JSON.stringify(body)).not.toContain('token-secret');
  });
});
