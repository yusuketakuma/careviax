import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

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

import { GET, POST } from './route';

function createRequest(url: string, body?: unknown) {
  return {
    url,
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      get: (key: string) => ({ 'x-org-id': 'org_1' })[key] ?? null,
    },
    nextUrl: new URL(url),
    json: vi.fn().mockResolvedValue(body),
  } as unknown as NextRequest;
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
    expect(medicationIssueFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          org_id: 'org_1',
          patient_id: 'patient_1',
          status: 'open',
          AND: [
            {
              OR: expect.arrayContaining([
                { case_id: { in: ['case_1'] } },
                { AND: [{ case_id: null }, { patient_id: { in: ['patient_1'] } }] },
              ]),
            },
          ],
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
    await expect(response.json()).resolves.toMatchObject({
      data: [],
      hasMore: false,
    });
    expect(medicationIssueFindManyMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(medicationIssueCreateMock).not.toHaveBeenCalled();
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
