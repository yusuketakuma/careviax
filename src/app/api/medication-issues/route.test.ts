import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  authMock,
  membershipFindFirstMock,
  patientFindFirstMock,
  patientFindManyMock,
  careCaseFindFirstMock,
  careCaseFindManyMock,
  medicationIssueFindManyMock,
  medicationIssueCreateMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  patientFindFirstMock: vi.fn(),
  patientFindManyMock: vi.fn(),
  careCaseFindFirstMock: vi.fn(),
  careCaseFindManyMock: vi.fn(),
  medicationIssueFindManyMock: vi.fn(),
  medicationIssueCreateMock: vi.fn(),
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

import { GET as rawGET, POST as rawPOST } from './route';

const emptyRouteContext = { params: Promise.resolve({}) };
const GET = (req: NextRequest) => rawGET(req, emptyRouteContext);
const POST = (req: NextRequest) => rawPOST(req, emptyRouteContext);

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

describe('/api/medication-issues', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'pharmacist' });
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
      patient_id: 'patient_1',
      status: 'open',
    });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        medicationIssue: {
          create: medicationIssueCreateMock,
        },
      }),
    );
  });

  it('lists medication issues filtered by patient and status', async () => {
    const response = (await GET(
      createRequest('http://localhost/api/medication-issues?patient_id=patient_1&status=open'),
    ))!;

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
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

  it('hides an inaccessible patient before reading medication issues', async () => {
    patientFindFirstMock.mockResolvedValue(null);

    const response = (await GET(
      createRequest('http://localhost/api/medication-issues?patient_id=patient_2&status=open'),
    ))!;

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    await expect(response.json()).resolves.toMatchObject({
      data: [],
      hasMore: false,
    });
    expect(medicationIssueFindManyMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(medicationIssueCreateMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when medication issue listing fails unexpectedly', async () => {
    medicationIssueFindManyMock.mockRejectedValueOnce(new Error('raw medication issue secret'));

    const response = (await GET(createRequest('http://localhost/api/medication-issues')))!;

    expect(response.status).toBe(500);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    const bodyText = await response.text();
    expect(bodyText).toContain('INTERNAL_ERROR');
    expect(bodyText).not.toContain('raw medication issue secret');
  });

  it.each([
    ['patient_id=', 'patient_id', '患者IDを指定してください'],
    ['patient_id=%20patient_1', 'patient_id', '患者IDの形式が不正です'],
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
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
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
    expect(medicationIssueCreateMock).toHaveBeenCalledWith({
      data: {
        org_id: 'org_1',
        identified_by: 'user_1',
        patient_id: 'patient_1',
        title: '飲み忘れ',
        description: '夕食後を服用していない',
        status: 'open',
        priority: 'medium',
      },
    });
  });

  it('rejects non-object create payloads before validating patient or case scope', async () => {
    const response = (await POST(createRequest('http://localhost/api/medication-issues', [])))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(medicationIssueCreateMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON create payloads before validating patient or case scope', async () => {
    const response = (await POST(createMalformedJsonPostRequest()))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(medicationIssueCreateMock).not.toHaveBeenCalled();
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
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(medicationIssueCreateMock).not.toHaveBeenCalled();
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
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(medicationIssueCreateMock).not.toHaveBeenCalled();
  });
});
