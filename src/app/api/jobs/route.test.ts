import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const { requireAuthContextMock, integrationJobFindManyMock } = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  integrationJobFindManyMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    integrationJob: {
      findMany: integrationJobFindManyMock,
    },
  },
}));

import { GET } from './route';

function createRequest() {
  return {
    headers: {
      get: () => 'org_1',
    },
  } as unknown as NextRequest;
}

describe('/api/jobs GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        userId: 'user_1',
        orgId: 'org_1',
        role: 'admin',
      },
    });
    integrationJobFindManyMock.mockResolvedValue([
      {
        id: 'job_1',
        job_type: 'daily',
        status: 'completed',
        org_id: 'org_1',
        created_at: new Date('2026-03-28T00:00:00.000Z'),
      },
      {
        id: 'job_2',
        job_type: 'next-day',
        status: 'completed',
        org_id: 'org_1',
        created_at: new Date('2026-03-28T01:00:00.000Z'),
      },
    ]);
  });

  it('returns expanded job definitions with latest runs', async () => {
    const response = await GET(createRequest());
    expect(response).toBeDefined();
    if (!response) {
      throw new Error('Expected a response from jobs GET');
    }

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: expect.arrayContaining([
        expect.objectContaining({
          job_type: 'daily',
          endpoint: '/api/jobs/daily',
          latest_run: expect.objectContaining({
            id: 'job_1',
          }),
        }),
        expect.objectContaining({
          job_type: 'next-day',
          endpoint: '/api/jobs/next-day',
          latest_run: expect.objectContaining({
            id: 'job_2',
          }),
        }),
        expect.objectContaining({
          job_type: 'monthly',
          endpoint: '/api/jobs/monthly',
        }),
        expect.objectContaining({
          job_type: 'daily-visit-support-sync',
          endpoint: '/api/jobs/daily-visit-support-sync',
        }),
        expect.objectContaining({
          job_type: 'medication-history-bulk-export-drain',
          endpoint: '/api/jobs/medication-history-bulk-export-drain',
        }),
        expect.objectContaining({
          job_type: 'daily-visit-record-retention',
          endpoint: '/api/jobs/daily-visit-record-retention',
        }),
        expect.objectContaining({
          job_type: 'daily-prescription-original-retention',
          endpoint: '/api/jobs/daily-prescription-original-retention',
        }),
      ]),
    });
  });
});
