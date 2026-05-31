import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  medicationCycleFindFirstMock,
  cycleTransitionLogFindManyMock,
  userFindManyMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  medicationCycleFindFirstMock: vi.fn(),
  cycleTransitionLogFindManyMock: vi.fn(),
  userFindManyMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    medicationCycle: { findFirst: medicationCycleFindFirstMock },
    cycleTransitionLog: { findMany: cycleTransitionLogFindManyMock },
    user: { findMany: userFindManyMock },
  },
}));

import { GET } from './route';

function createRequest(url: string) {
  return new NextRequest(url);
}

const authCtx = {
  ctx: { orgId: 'org_1', userId: 'user_1', role: 'pharmacist' },
};

describe('/api/medication-cycles/[id]/history', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue(authCtx);
  });

  it('returns 200 with transition logs', async () => {
    medicationCycleFindFirstMock.mockResolvedValue({ id: 'cycle_1' });
    cycleTransitionLogFindManyMock.mockResolvedValue([
      {
        id: 'log_1',
        from_status: 'ready_to_dispense',
        to_status: 'dispensed',
        actor_id: 'user_1',
        note: null,
        created_at: '2026-01-01T00:00:00Z',
      },
    ]);
    userFindManyMock.mockResolvedValue([{ id: 'user_1', name: 'Taro' }]);

    const req = createRequest('http://localhost/api/medication-cycles/cycle_1/history');
    const res = await GET(req, { params: Promise.resolve({ id: 'cycle_1' }) });
    expect(res!.status).toBe(200);
    expect(medicationCycleFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'cycle_1',
        org_id: 'org_1',
        case_: {
          OR: [
            { primary_pharmacist_id: 'user_1' },
            { backup_pharmacist_id: 'user_1' },
            { visit_schedules: { some: { pharmacist_id: 'user_1' } } },
          ],
        },
      },
      select: { id: true },
    });
    const json = await res!.json();
    expect(json).toHaveLength(1);
    expect(json[0].actor_name).toBe('Taro');
  });

  it('omits the assignment predicate for admin cycle history lookups', async () => {
    requireAuthContextMock.mockResolvedValue({
      ctx: { orgId: 'org_1', userId: 'admin_1', role: 'admin' },
    });
    medicationCycleFindFirstMock.mockResolvedValue({ id: 'cycle_1' });
    cycleTransitionLogFindManyMock.mockResolvedValue([]);

    const req = createRequest('http://localhost/api/medication-cycles/cycle_1/history');
    const res = await GET(req, { params: Promise.resolve({ id: 'cycle_1' }) });

    expect(res!.status).toBe(200);
    expect(medicationCycleFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'cycle_1',
        org_id: 'org_1',
      },
      select: { id: true },
    });
  });

  it('returns 404 when cycle not found', async () => {
    medicationCycleFindFirstMock.mockResolvedValue(null);

    const req = createRequest('http://localhost/api/medication-cycles/missing/history');
    const res = await GET(req, { params: Promise.resolve({ id: 'missing' }) });
    expect(res!.status).toBe(404);
    expect(cycleTransitionLogFindManyMock).not.toHaveBeenCalled();
    expect(userFindManyMock).not.toHaveBeenCalled();
  });
});
