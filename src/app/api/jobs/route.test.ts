import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

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
  return new NextRequest('http://localhost/api/jobs', {
    headers: {
      'x-org-id': 'org_1',
    },
  });
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
      {
        id: 'job_3',
        job_type: 'medication-history-bulk-export',
        status: 'completed',
        org_id: 'org_1',
        output: {
          requestedCount: 2,
          patientCount: 1,
          failedCount: 1,
          errors: ['patient_2: PDF 生成に失敗しました'],
        },
        input: {
          patientIds: ['patient_1', 'patient_2'],
          requestedBy: 'user_1',
        },
        error_log: 'raw export diagnostic',
        created_at: new Date('2026-03-28T02:00:00.000Z'),
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
    const payload = await response.json();
    const entries = payload.data as Array<{
      job_type: string;
      endpoint: string;
      latest_run: Record<string, unknown> | null;
      latest_export_run: Record<string, unknown> | null;
    }>;

    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          job_type: 'daily',
          endpoint: '/api/jobs/daily',
          latest_run: expect.objectContaining({ id: 'job_1' }),
        }),
        expect.objectContaining({
          job_type: 'next-day',
          endpoint: '/api/jobs/next-day',
          latest_run: expect.objectContaining({ id: 'job_2' }),
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
          job_type: 'bulk-export-artifact-cleanup',
          endpoint: '/api/jobs/bulk-export-artifact-cleanup',
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
    );

    const bulkExportEntry = entries.find(
      (entry) => entry.job_type === 'medication-history-bulk-export-drain',
    );
    expect(bulkExportEntry).toMatchObject({
      endpoint: '/api/jobs/medication-history-bulk-export-drain',
      latest_run: null,
      latest_export_run: expect.objectContaining({
        id: 'job_3',
        output: {
          requestedCount: 2,
          patientCount: 1,
          failedCount: 1,
        },
        error_log: 'エラーが記録されています',
      }),
    });
    expect(bulkExportEntry?.latest_export_run).not.toHaveProperty('input');
    expect(bulkExportEntry?.latest_export_run?.output).not.toHaveProperty('errors');
  });

  it('keeps drain run state separate from latest export partial-success output', async () => {
    integrationJobFindManyMock.mockResolvedValue([
      {
        id: 'drain_new',
        job_type: 'medication-history-bulk-export-drain',
        status: 'completed',
        org_id: 'org_1',
        output: null,
        created_at: new Date('2026-03-28T03:00:00.000Z'),
      },
      {
        id: 'export_old',
        job_type: 'medication-history-bulk-export',
        status: 'completed',
        org_id: 'org_1',
        output: {
          requestedCount: 2,
          patientCount: 1,
          failedCount: 1,
          errors: ['patient_2: PDF 生成に失敗しました'],
        },
        input: {
          patientIds: ['patient_1', 'patient_2'],
          requestedBy: 'user_1',
        },
        created_at: new Date('2026-03-28T02:00:00.000Z'),
      },
    ]);

    const response = await GET(createRequest());
    expect(response.status).toBe(200);

    const payload = await response.json();
    const entries = payload.data as Array<{
      job_type: string;
      latest_run: Record<string, unknown> | null;
      latest_export_run: Record<string, unknown> | null;
    }>;
    const bulkExportEntry = entries.find(
      (entry) => entry.job_type === 'medication-history-bulk-export-drain',
    );

    expect(bulkExportEntry).toMatchObject({
      latest_run: expect.objectContaining({
        id: 'drain_new',
      }),
      latest_export_run: expect.objectContaining({
        id: 'export_old',
        output: {
          requestedCount: 2,
          patientCount: 1,
          failedCount: 1,
        },
      }),
    });
    expect(bulkExportEntry?.latest_export_run).not.toHaveProperty('input');
    expect(bulkExportEntry?.latest_export_run?.output).not.toHaveProperty('errors');
  });
});
