import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { expectSensitiveNoStore } from '@/test/api-response-assertions';

const {
  loggerErrorMock,
  requireAuthContextMock,
  runWithRequestAuthContextMock,
  withRoutePerformanceMock,
  patientFindFirstMock,
  patientFindManyMock,
  careCaseFindFirstMock,
  careCaseFindManyMock,
  medicationIssueFindManyMock,
  medicationIssueCreateMock,
  withOrgContextMock,
  allocateDisplayIdMock,
} = vi.hoisted(() => ({
  loggerErrorMock: vi.fn(),
  requireAuthContextMock: vi.fn(),
  runWithRequestAuthContextMock: vi.fn((_ctx, callback: () => unknown) => callback()),
  withRoutePerformanceMock: vi.fn((_req, callback: () => unknown) => callback()),
  patientFindFirstMock: vi.fn(),
  patientFindManyMock: vi.fn(),
  careCaseFindFirstMock: vi.fn(),
  careCaseFindManyMock: vi.fn(),
  medicationIssueFindManyMock: vi.fn(),
  medicationIssueCreateMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  allocateDisplayIdMock: vi.fn(),
}));

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
      findMany: patientFindManyMock,
    },
    careCase: {
      findFirst: careCaseFindFirstMock,
      findMany: careCaseFindManyMock,
    },
    medicationIssue: {
      findMany: medicationIssueFindManyMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/lib/db/display-id', () => ({
  allocateDisplayId: allocateDisplayIdMock,
}));

import { GET as rawGET, POST as rawPOST } from './route';

const GET = (req: NextRequest) => rawGET(req);
const POST = (req: NextRequest) => rawPOST(req);

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

function createMalformedJsonPostRequest() {
  return new NextRequest('http://localhost/api/medication-issues', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-org-id': 'org_1',
    },
    body: '{"patient_id":',
  });
}

function buildAuthContext(req: NextRequest & { role?: string }) {
  return {
    orgId: 'org_1',
    userId: 'user_1',
    role: req.role ?? 'pharmacist',
    ipAddress: '127.0.0.1',
    userAgent: 'vitest',
  };
}

describe('/api/medication-issues', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockImplementation(async (req) => ({ ctx: buildAuthContext(req) }));
    runWithRequestAuthContextMock.mockImplementation((_ctx, callback) => callback());
    withRoutePerformanceMock.mockImplementation((_req, callback) => callback());
    patientFindFirstMock.mockResolvedValue({ id: 'patient_1' });
    patientFindManyMock.mockResolvedValue([{ id: 'patient_1' }]);
    careCaseFindFirstMock.mockResolvedValue({ id: 'case_1', patient_id: 'patient_1' });
    careCaseFindManyMock.mockResolvedValue([{ id: 'case_1' }]);
    medicationIssueFindManyMock.mockResolvedValue([
      {
        id: 'issue_1',
        patient_id: 'patient_1',
        status: 'open',
      },
    ]);
    medicationIssueCreateMock.mockResolvedValue({
      id: 'issue_2',
      display_id: 'miss0000000001',
      patient_id: 'patient_1',
      status: 'open',
    });
    allocateDisplayIdMock.mockResolvedValue('miss0000000001');
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        medicationIssue: {
          create: medicationIssueCreateMock,
        },
      }),
    );
  });

  it('lists medication issues filtered by patient and status', async () => {
    medicationIssueFindManyMock.mockResolvedValueOnce([
      {
        id: 'issue_1',
        patient_id: 'patient_1',
        status: 'open',
      },
      {
        id: 'issue_0',
        patient_id: 'patient_1',
        status: 'open',
      },
    ]);

    const response = (await GET(
      createRequest(
        'http://localhost/api/medication-issues?patient_id=patient_1&status=open&limit=1',
      ),
    ))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(withRoutePerformanceMock).toHaveBeenCalledWith(
      expect.any(NextRequest),
      expect.any(Function),
    );
    expect(requireAuthContextMock).toHaveBeenCalledWith(expect.any(NextRequest), {
      permission: 'canVisit',
      message: '服薬課題の閲覧権限がありません',
    });
    expect(runWithRequestAuthContextMock).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org_1', userId: 'user_1', role: 'pharmacist' }),
      expect.any(Function),
    );
    const body = await response.json();
    expect(Object.keys(body)).toEqual(['data', 'hasMore', 'nextCursor']);
    expect(body).toMatchObject({
      data: [expect.objectContaining({ id: 'issue_1' })],
      hasMore: true,
      nextCursor: 'issue_1',
    });
    expect(body.data).toHaveLength(1);
    expect(medicationIssueFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          org_id: 'org_1',
          patient_id: 'patient_1',
          status: 'open',
        },
      }),
    );
  });

  it('does not mark hasMore when medication issues exactly fill the requested limit', async () => {
    const response = (await GET(
      createRequest('http://localhost/api/medication-issues?status=open&limit=1'),
    ))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(Object.keys(body)).toEqual(['data', 'hasMore']);
    expect(body).toMatchObject({
      data: [expect.objectContaining({ id: 'issue_1' })],
      hasMore: false,
    });
    expect(body).not.toHaveProperty('nextCursor');
    expect(body.data).toHaveLength(1);
  });

  it('hides an inaccessible patient before reading medication issues', async () => {
    patientFindFirstMock.mockResolvedValue(null);

    const response = (await GET(
      createRequest('http://localhost/api/medication-issues?patient_id=patient_2&status=open'),
    ))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      data: [],
      hasMore: false,
    });
    expect(medicationIssueFindManyMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(medicationIssueCreateMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when medication issue listing fails unexpectedly', async () => {
    const err = new Error('raw medication issue list secret');
    err.name = 'MedicationIssueListSecretError';
    medicationIssueFindManyMock.mockRejectedValueOnce(err);

    const response = (await GET(createRequest('http://localhost/api/medication-issues')))!;

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const bodyText = await response.text();
    expect(bodyText).toContain('INTERNAL_ERROR');
    expect(bodyText).not.toContain('raw medication issue list secret');
    expect(loggerErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'medication_issues_get_unhandled_error',
        route: '/api/medication-issues',
        method: 'GET',
        status: 500,
      }),
      err,
    );
    const [logContext, logError] = loggerErrorMock.mock.calls[0] ?? [];
    expect(logError).toBe(err);
    expect(logContext).not.toHaveProperty('error_name');
    const logContextText = JSON.stringify(logContext);
    expect(logContextText).not.toContain('raw medication issue list secret');
    expect(logContextText).not.toContain('MedicationIssueListSecretError');
  });

  it.each([
    ['patient_id=', 'patient_id', '患者IDを指定してください'],
    ['patient_id=%20patient_1', 'patient_id', '患者IDの形式が不正です'],
    [`patient_id=${'a'.repeat(101)}`, 'patient_id', '患者IDの形式が不正です'],
    ['case_id=%20%20', 'case_id', 'ケースIDを指定してください'],
    ['case_id=case_1%20', 'case_id', 'ケースIDの形式が不正です'],
    ['status=', 'status', 'ステータスを指定してください'],
    ['status=%20open', 'status', '対応していないステータスです'],
  ])(
    'rejects blank or padded medication issue filter query "%s" before scope resolution',
    async (query, fieldName, message) => {
      const response = (await GET(
        createRequest(`http://localhost/api/medication-issues?${query}`),
      ))!;

      expect(response.status).toBe(400);
      expectSensitiveNoStore(response);
      await expect(response.json()).resolves.toMatchObject({
        code: 'VALIDATION_ERROR',
        message: '検索条件が不正です',
        details: {
          [fieldName]: [message],
        },
      });
      expect(patientFindFirstMock).not.toHaveBeenCalled();
      expect(careCaseFindFirstMock).not.toHaveBeenCalled();
      expect(careCaseFindManyMock).not.toHaveBeenCalled();
      expect(patientFindManyMock).not.toHaveBeenCalled();
      expect(medicationIssueFindManyMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['patient_id=patient_1&patient_id=patient_2', 'patient_id'],
    ['case_id=case_1&case_id=', 'case_id'],
    ['status=open&status=resolved', 'status'],
  ])(
    'rejects duplicate medication issue filter query "%s" before scope resolution',
    async (query, fieldName) => {
      const response = (await GET(
        createRequest(`http://localhost/api/medication-issues?${query}`),
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
      expect(patientFindFirstMock).not.toHaveBeenCalled();
      expect(careCaseFindFirstMock).not.toHaveBeenCalled();
      expect(careCaseFindManyMock).not.toHaveBeenCalled();
      expect(patientFindManyMock).not.toHaveBeenCalled();
      expect(medicationIssueFindManyMock).not.toHaveBeenCalled();
    },
  );

  it('rejects an invalid status filter before resolving assignment scope', async () => {
    const response = (await GET(
      createRequest('http://localhost/api/medication-issues?status=archived'),
    ))!;

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: {
        status: ['対応していないステータスです'],
      },
    });
    expect(careCaseFindManyMock).not.toHaveBeenCalled();
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(patientFindManyMock).not.toHaveBeenCalled();
    expect(medicationIssueFindManyMock).not.toHaveBeenCalled();
  });

  it('creates a medication issue with the current user as identifier', async () => {
    const response = (await POST(
      createRequest('http://localhost/api/medication-issues', {
        patient_id: 'patient_1',
        title: '飲み忘れ',
        description: '夕食後を服用していない',
      }),
    ))!;

    expect(response.status).toBe(201);
    expectSensitiveNoStore(response);
    expect(withRoutePerformanceMock).toHaveBeenCalledWith(
      expect.any(NextRequest),
      expect.any(Function),
    );
    expect(requireAuthContextMock).toHaveBeenCalledWith(expect.any(NextRequest), {
      permission: 'canVisit',
      message: '服薬課題の作成権限がありません',
    });
    expect(runWithRequestAuthContextMock).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org_1', userId: 'user_1', role: 'pharmacist' }),
      expect.any(Function),
    );
    expect(medicationIssueCreateMock).toHaveBeenCalledWith({
      data: {
        org_id: 'org_1',
        display_id: 'miss0000000001',
        identified_by: 'user_1',
        patient_id: 'patient_1',
        title: '飲み忘れ',
        description: '夕食後を服用していない',
        status: 'open',
        priority: 'medium',
      },
    });
    expect(allocateDisplayIdMock).toHaveBeenCalledWith(
      expect.objectContaining({
        medicationIssue: expect.objectContaining({ create: medicationIssueCreateMock }),
      }),
      'MedicationIssue',
      'org_1',
    );
  });

  it('rejects non-object create payloads before validating patient or case scope', async () => {
    const response = (await POST(createRequest('http://localhost/api/medication-issues', [])))!;

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(medicationIssueCreateMock).not.toHaveBeenCalled();
    expect(allocateDisplayIdMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON create payloads before validating patient or case scope', async () => {
    const response = (await POST(createMalformedJsonPostRequest()))!;

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(medicationIssueCreateMock).not.toHaveBeenCalled();
    expect(allocateDisplayIdMock).not.toHaveBeenCalled();
  });

  it('rejects a patient and case mismatch before creating a medication issue', async () => {
    careCaseFindFirstMock.mockResolvedValue({ id: 'case_2', patient_id: 'patient_other' });

    const response = (await POST(
      createRequest('http://localhost/api/medication-issues', {
        patient_id: 'patient_1',
        case_id: 'case_2',
        title: '飲み忘れ',
        description: '夕食後を服用していない',
      }),
    ))!;

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(medicationIssueCreateMock).not.toHaveBeenCalled();
    expect(allocateDisplayIdMock).not.toHaveBeenCalled();
  });

  it('returns 404 before creating a medication issue for an unassigned patient', async () => {
    patientFindFirstMock.mockResolvedValueOnce({ id: 'patient_2' }).mockResolvedValueOnce(null);

    const response = (await POST(
      createRequest('http://localhost/api/medication-issues', {
        patient_id: 'patient_2',
        title: '飲み忘れ',
        description: '夕食後を服用していない',
      }),
    ))!;

    expect(response.status).toBe(404);
    expectSensitiveNoStore(response);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(medicationIssueCreateMock).not.toHaveBeenCalled();
    expect(allocateDisplayIdMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 without raw logging when medication issue creation fails unexpectedly', async () => {
    const err = new Error('患者 山田太郎 raw medication issue create secret');
    err.name = 'MedicationIssueCreateSecretError';
    withOrgContextMock.mockRejectedValueOnce(err);

    const response = (await POST(
      createRequest('http://localhost/api/medication-issues', {
        patient_id: 'patient_1',
        title: '飲み忘れ',
        description: '夕食後を服用していない',
      }),
    ))!;

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    expect(JSON.stringify(body)).not.toContain('山田太郎');
    expect(JSON.stringify(body)).not.toContain('raw medication issue');
    expect(loggerErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'medication_issues_post_unhandled_error',
        route: '/api/medication-issues',
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
    expect(logContextText).not.toContain('raw medication issue');
    expect(logContextText).not.toContain('MedicationIssueCreateSecretError');
    expect(medicationIssueCreateMock).not.toHaveBeenCalled();
    expect(allocateDisplayIdMock).not.toHaveBeenCalled();
  });
});
