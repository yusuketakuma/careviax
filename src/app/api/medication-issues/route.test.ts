import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  authMock,
  membershipFindFirstMock,
  medicationIssueFindManyMock,
  medicationIssueCreateMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
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
      get: (key: string) => ({ 'x-org-id': 'org_1' }[key] ?? null),
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
      createRequest('http://localhost/api/medication-issues?patient_id=patient_1&status=open')
    ))!;

    expect(response.status).toBe(200);
    expect(medicationIssueFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          org_id: 'org_1',
          patient_id: 'patient_1',
          status: 'open',
        },
      })
    );
  });

  it('creates a medication issue with the current user as identifier', async () => {
    const response = (await POST(
      createRequest('http://localhost/api/medication-issues', {
        patient_id: 'patient_1',
        title: '飲み忘れ',
        description: '夕食後を服用していない',
      })
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
});
