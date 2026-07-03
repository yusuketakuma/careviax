import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { expectSensitiveNoStore } from '@/test/api-response-assertions';

const {
  medicationCycleFindManyMock,
  medicationCycleCountMock,
  careCaseFindFirstMock,
  validateOrgReferencesMock,
  medicationCycleCreateMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  medicationCycleFindManyMock: vi.fn(),
  medicationCycleCountMock: vi.fn(),
  careCaseFindFirstMock: vi.fn(),
  validateOrgReferencesMock: vi.fn(),
  medicationCycleCreateMock: vi.fn(),
  withOrgContextMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (handler: (...args: unknown[]) => unknown) => {
    return (req: NextRequest) =>
      handler(req, { orgId: 'org_1', userId: 'user_1', role: 'pharmacist' });
  },
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    medicationCycle: {
      findMany: medicationCycleFindManyMock,
      count: medicationCycleCountMock,
    },
    careCase: {
      findFirst: careCaseFindFirstMock,
    },
  },
}));

vi.mock('@/lib/api/org-reference', () => ({
  validateOrgReferences: validateOrgReferencesMock,
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { GET, POST } from './route';

function createGetRequest(url: string) {
  return new NextRequest(url);
}

function createPostRequest(body: unknown) {
  return new NextRequest('http://localhost/api/medication-cycles', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

function createMalformedJsonPostRequest() {
  return new NextRequest('http://localhost/api/medication-cycles', {
    method: 'POST',
    body: '{"case_id":',
    headers: { 'content-type': 'application/json' },
  });
}

describe('/api/medication-cycles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    medicationCycleFindManyMock.mockResolvedValue([
      {
        id: 'cycle_1',
        overall_status: 'dispensing',
        prescription_intakes: [],
      },
    ]);
    medicationCycleCountMock.mockResolvedValue(1);
    careCaseFindFirstMock.mockResolvedValue({ id: 'case_1' });
    validateOrgReferencesMock.mockResolvedValue({ ok: true });
    medicationCycleCreateMock.mockResolvedValue({
      id: 'cycle_2',
      overall_status: 'intake_received',
      version: 1,
    });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        medicationCycle: {
          create: medicationCycleCreateMock,
        },
      }),
    );
  });

  it('lists medication cycles with filters', async () => {
    const response = (await GET(
      createGetRequest(
        'http://localhost/api/medication-cycles?status=dispensing&patient_id=patient_1&case_id=case_1',
      ),
      { params: Promise.resolve({}) },
    ))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(medicationCycleFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        select: {
          id: true,
        },
        where: expect.objectContaining({
          org_id: 'org_1',
          overall_status: 'dispensing',
          case_id: 'case_1',
          patient_id: 'patient_1',
        }),
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      data: [{ id: 'cycle_1' }],
      hasMore: false,
      totalCount: 1,
    });
  });

  it('returns only the cycle id needed by consumers', async () => {
    medicationCycleFindManyMock.mockResolvedValueOnce([
      {
        id: 'cycle_minimal_1',
        case_id: 'case_private',
        patient_id: 'patient_private',
        overall_status: 'dispensing',
        created_at: new Date('2026-06-01T00:00:00.000Z'),
        prescription_intakes: [
          {
            id: 'intake_private',
            source_type: 'paper',
            prescribed_date: new Date('2026-06-01T00:00:00.000Z'),
            prescriber_name: '医師A',
          },
        ],
      },
    ]);

    const response = (await GET(
      createGetRequest('http://localhost/api/medication-cycles?patient_id=patient_1&limit=1'),
      { params: Promise.resolve({}) },
    ))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(medicationCycleFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        select: {
          id: true,
        },
      }),
    );
    const body = await response.json();
    expect(body.data).toEqual([{ id: 'cycle_minimal_1' }]);
    expect(body.data[0]).not.toHaveProperty('patient_id');
    expect(body.data[0]).not.toHaveProperty('case_id');
    expect(body.data[0]).not.toHaveProperty('overall_status');
    expect(body.data[0]).not.toHaveProperty('prescription_intakes');
  });

  it('rejects unsupported status filters before querying cycles', async () => {
    const response = (await GET(
      createGetRequest('http://localhost/api/medication-cycles?status=bad_status'),
      { params: Promise.resolve({}) },
    ))!;

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    expect(medicationCycleFindManyMock).not.toHaveBeenCalled();
    expect(medicationCycleCountMock).not.toHaveBeenCalled();
  });

  it.each([
    ['status', '?status=', { status: ['ステータスを指定してください'] }],
    ['blank status', '?status=%20%20', { status: ['ステータスを指定してください'] }],
    ['padded status', '?status=%20dispensing', { status: ['対応していないステータスです'] }],
    ['overlong status', `?status=${'s'.repeat(101)}`, { status: ['対応していないステータスです'] }],
    ['case_id', '?case_id=', { case_id: ['ケースIDを指定してください'] }],
    ['blank case_id', '?case_id=%20%20', { case_id: ['ケースIDを指定してください'] }],
    ['padded case_id', '?case_id=case_1%20', { case_id: ['ケースIDの形式が不正です'] }],
    ['overlong case_id', `?case_id=${'c'.repeat(101)}`, { case_id: ['ケースIDの形式が不正です'] }],
    ['patient_id', '?patient_id=', { patient_id: ['患者IDを指定してください'] }],
    ['blank patient_id', '?patient_id=%20%20', { patient_id: ['患者IDを指定してください'] }],
    ['padded patient_id', '?patient_id=%20patient_1', { patient_id: ['患者IDの形式が不正です'] }],
    [
      'overlong patient_id',
      `?patient_id=${'p'.repeat(101)}`,
      { patient_id: ['患者IDの形式が不正です'] },
    ],
  ])('rejects malformed explicit %s before querying cycles', async (_name, query, details) => {
    const response = (await GET(
      createGetRequest(`http://localhost/api/medication-cycles${query}`),
      { params: Promise.resolve({}) },
    ))!;

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '検索条件が不正です',
      details,
    });
    expect(medicationCycleFindManyMock).not.toHaveBeenCalled();
    expect(medicationCycleCountMock).not.toHaveBeenCalled();
  });

  it.each([
    ['status', '?status=dispensing&status=ready_to_dispense'],
    ['case_id', '?case_id=case_1&case_id=case_2'],
    ['patient_id', '?patient_id=patient_1&patient_id=patient_2'],
  ])('rejects duplicate %s query values before querying cycles', async (fieldName, query) => {
    const response = (await GET(
      createGetRequest(`http://localhost/api/medication-cycles${query}`),
      { params: Promise.resolve({}) },
    ))!;

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '検索条件が不正です',
      details: {
        [fieldName]: [`${fieldName} は1つだけ指定してください`],
      },
    });
    expect(medicationCycleFindManyMock).not.toHaveBeenCalled();
    expect(medicationCycleCountMock).not.toHaveBeenCalled();
  });

  it.each(['abc', '-10'])('uses a safe offset for malformed cursor %s', async (cursor) => {
    const response = (await GET(
      createGetRequest(
        `http://localhost/api/medication-cycles?cursor=${encodeURIComponent(cursor)}`,
      ),
      { params: Promise.resolve({}) },
    ))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(medicationCycleFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 0,
        take: 51,
      }),
    );
  });

  it('creates a medication cycle after org reference validation', async () => {
    const response = (await POST(
      createPostRequest({
        case_id: 'case_1',
        patient_id: 'patient_1',
      }),
      { params: Promise.resolve({}) },
    ))!;

    expect(response.status).toBe(201);
    expect(validateOrgReferencesMock).toHaveBeenCalledWith('org_1', {
      case_id: 'case_1',
      patient_id: 'patient_1',
    });
    expect(medicationCycleCreateMock).toHaveBeenCalledWith({
      data: {
        org_id: 'org_1',
        case_id: 'case_1',
        patient_id: 'patient_1',
        overall_status: 'intake_received',
        version: 1,
      },
    });
  });

  it('rejects non-object create payloads before validating references', async () => {
    const response = (await POST(createPostRequest(['case_1']), {
      params: Promise.resolve({}),
    }))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(medicationCycleCreateMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON create payloads before validating references', async () => {
    const response = (await POST(createMalformedJsonPostRequest(), {
      params: Promise.resolve({}),
    }))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(medicationCycleCreateMock).not.toHaveBeenCalled();
  });

  it('rejects an unassigned case before creating a medication cycle', async () => {
    careCaseFindFirstMock.mockResolvedValue(null);

    const response = (await POST(
      createPostRequest({
        case_id: 'case_2',
        patient_id: 'patient_2',
      }),
      { params: Promise.resolve({}) },
    ))!;

    expect(response.status).toBe(400);
    expect(medicationCycleCreateMock).not.toHaveBeenCalled();
  });
});
