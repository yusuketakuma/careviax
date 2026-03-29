import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  authMock,
  membershipFindFirstMock,
  dispenseResultFindFirstMock,
  dispenseAuditFindFirstMock,
  dispenseResultUpdateMock,
  dispenseTaskUpdateMock,
  medicationCycleUpdateMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  dispenseResultFindFirstMock: vi.fn(),
  dispenseAuditFindFirstMock: vi.fn(),
  dispenseResultUpdateMock: vi.fn(),
  dispenseTaskUpdateMock: vi.fn(),
  medicationCycleUpdateMock: vi.fn(),
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
    dispenseResult: {
      findFirst: dispenseResultFindFirstMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { GET, PATCH } from './route';

function createRequest(url: string, body?: unknown) {
  return {
    url,
    method: body === undefined ? 'GET' : 'PATCH',
    headers: {
      get: (key: string) => ({ 'x-org-id': 'org_1' }[key] ?? null),
    },
    nextUrl: new URL(url),
    json: vi.fn().mockResolvedValue(body),
  } as unknown as NextRequest;
}

describe('/api/dispense-results/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'pharmacist' });
    dispenseResultFindFirstMock.mockResolvedValue({
      id: 'result_1',
      org_id: 'org_1',
      task_id: 'task_1',
      line: { id: 'line_1' },
    });
    dispenseAuditFindFirstMock.mockResolvedValue({ id: 'audit_1' });
    dispenseResultUpdateMock.mockResolvedValue({ id: 'result_1' });
    dispenseTaskUpdateMock.mockResolvedValue({ cycle_id: 'cycle_1' });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        dispenseResult: {
          findFirst: dispenseResultFindFirstMock,
          update: dispenseResultUpdateMock,
        },
        dispenseAudit: {
          findFirst: dispenseAuditFindFirstMock,
        },
        dispenseTask: {
          update: dispenseTaskUpdateMock,
        },
        medicationCycle: {
          update: medicationCycleUpdateMock,
        },
      }),
    );
  });

  it('returns a dispense result by id', async () => {
    const response = (await GET(createRequest('http://localhost/api/dispense-results/result_1'), {
      params: Promise.resolve({ id: 'result_1' }),
    }))!;

    expect(response.status).toBe(200);
  });

  it('patches a dispense result only after a rejected audit and resets statuses', async () => {
    const response = (await PATCH(
      createRequest('http://localhost/api/dispense-results/result_1', {
        actual_drug_name: 'Drug B',
      }),
      {
        params: Promise.resolve({ id: 'result_1' }),
      }
    ))!;

    expect(response.status).toBe(200);
    expect(dispenseResultUpdateMock).toHaveBeenCalled();
    expect(dispenseTaskUpdateMock).toHaveBeenCalledWith({
      where: { id: 'task_1' },
      data: { status: 'completed' },
      select: { cycle_id: true },
    });
    expect(medicationCycleUpdateMock).toHaveBeenCalledWith({
      where: { id: 'cycle_1' },
      data: { overall_status: 'audit_pending' },
    });
  });
});
