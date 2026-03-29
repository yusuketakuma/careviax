import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  medicationIssueFindFirstMock,
  medicationIssueUpdateMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  medicationIssueFindFirstMock: vi.fn(),
  medicationIssueUpdateMock: vi.fn(),
  withOrgContextMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    medicationIssue: {
      findFirst: medicationIssueFindFirstMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { PATCH } from './route';

describe('/api/medication-issues/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
      },
    });
    medicationIssueFindFirstMock.mockResolvedValue({
      id: 'issue_1',
      status: 'open',
    });
    medicationIssueUpdateMock.mockResolvedValue({
      id: 'issue_1',
      status: 'resolved',
    });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        medicationIssue: {
          update: medicationIssueUpdateMock,
        },
      }),
    );
  });

  it('sets resolver metadata when an issue is resolved', async () => {
    const response = (await PATCH({
      json: async () => ({
        status: 'resolved',
      }),
    } as NextRequest, {
      params: Promise.resolve({ id: 'issue_1' }),
    }))!;

    expect(response.status).toBe(200);
    expect(medicationIssueUpdateMock).toHaveBeenCalledWith({
      where: { id: 'issue_1' },
      data: expect.objectContaining({
        status: 'resolved',
        resolved_by: 'user_1',
        resolved_at: expect.any(Date),
      }),
    });
  });
});
