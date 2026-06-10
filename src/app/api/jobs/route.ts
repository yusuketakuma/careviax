import { NextRequest } from 'next/server';
import type { Prisma } from '@prisma/client';
import { requireAuthContext } from '@/lib/auth/context';
import { prisma } from '@/lib/db/client';
import { success } from '@/lib/api/response';
import { readJsonObject } from '@/lib/db/json';

const JOB_DEFINITIONS = [
  { job_type: 'daily', schedule_hint: '毎朝', endpoint: '/api/jobs/daily' },
  {
    job_type: 'daily-medication-check',
    schedule_hint: '毎朝',
    endpoint: '/api/jobs/daily-medication-check',
  },
  {
    job_type: 'daily-refill-check',
    schedule_hint: '毎朝',
    endpoint: '/api/jobs/daily-refill-check',
  },
  {
    job_type: 'daily-prescription-expiry',
    schedule_hint: '毎朝',
    endpoint: '/api/jobs/daily-prescription-expiry',
  },
  {
    job_type: 'daily-visit-demand',
    schedule_hint: '毎朝',
    endpoint: '/api/jobs/daily-visit-demand',
  },
  {
    job_type: 'daily-management-plan-review',
    schedule_hint: '毎朝',
    endpoint: '/api/jobs/daily-management-plan-review',
  },
  {
    job_type: 'daily-callback-followups',
    schedule_hint: '毎時または毎朝',
    endpoint: '/api/jobs/daily-callback-followups',
  },
  {
    job_type: 'daily-geocode-review',
    schedule_hint: '毎朝',
    endpoint: '/api/jobs/daily-geocode-review',
  },
  {
    job_type: 'daily-preparation-check',
    schedule_hint: '毎朝',
    endpoint: '/api/jobs/daily-preparation-check',
  },
  {
    job_type: 'daily-billing-evidence',
    schedule_hint: '毎朝',
    endpoint: '/api/jobs/daily-billing-evidence',
  },
  {
    job_type: 'daily-visit-support-sync',
    schedule_hint: '毎朝',
    endpoint: '/api/jobs/daily-visit-support-sync',
  },
  {
    job_type: 'daily-facility-standard-expiry',
    schedule_hint: '毎朝',
    endpoint: '/api/jobs/daily-facility-standard-expiry',
  },
  {
    job_type: 'daily-credential-expiry',
    schedule_hint: '毎朝',
    endpoint: '/api/jobs/daily-credential-expiry',
  },
  {
    job_type: 'daily-consent-expiry',
    schedule_hint: '毎朝',
    endpoint: '/api/jobs/daily-consent-expiry',
  },
  {
    job_type: 'daily-visit-record-retention',
    schedule_hint: '毎朝',
    endpoint: '/api/jobs/daily-visit-record-retention',
  },
  {
    job_type: 'daily-prescription-original-retention',
    schedule_hint: '毎朝',
    endpoint: '/api/jobs/daily-prescription-original-retention',
  },
  {
    job_type: 'drug-master-refresh',
    schedule_hint: '毎月',
    endpoint: '/api/jobs/drug-master-refresh',
  },
  {
    job_type: 'drug-reference-refresh',
    schedule_hint: '毎月',
    endpoint: '/api/jobs/drug-reference-refresh',
  },
  {
    job_type: 'pmda-package-insert-refresh',
    schedule_hint: '毎日',
    endpoint: '/api/jobs/pmda-package-insert-refresh',
  },
  {
    job_type: 'medication-history-bulk-export-drain',
    schedule_hint: '15分毎 + 要求時',
    endpoint: '/api/jobs/medication-history-bulk-export-drain',
  },
  {
    job_type: 'bulk-export-artifact-cleanup',
    schedule_hint: '毎日',
    endpoint: '/api/jobs/bulk-export-artifact-cleanup',
  },
  {
    job_type: 'webhook-delivery-retry',
    schedule_hint: '5分毎 + 要求時',
    endpoint: '/api/jobs/webhook-delivery-retry',
  },
  { job_type: 'evening', schedule_hint: '毎夕', endpoint: '/api/jobs/evening' },
  {
    job_type: 'evening-unrecorded-visits',
    schedule_hint: '毎夕',
    endpoint: '/api/jobs/evening-unrecorded-visits',
  },
  { job_type: 'next-day', schedule_hint: '翌営業日朝', endpoint: '/api/jobs/next-day' },
  { job_type: 'monthly', schedule_hint: '毎月初', endpoint: '/api/jobs/monthly' },
];

type LatestRun = {
  id: string;
  job_type: string;
  status: string;
  output: Prisma.JsonValue;
  error_log: string | null;
  retry_count: number;
  max_retries: number;
  started_at: Date | null;
  completed_at: Date | null;
  created_at: Date;
};

type JobRunDto = {
  id: string;
  job_type: string;
  status: string;
  output: Record<string, number> | null;
  error_log: string | null;
  retry_count: number;
  max_retries: number;
  started_at: Date | null;
  completed_at: Date | null;
  created_at: Date;
};

function findLatestRunForDefinition(latestRuns: LatestRun[], definitionJobType: string) {
  return latestRuns.find((job) => job.job_type === definitionJobType) ?? null;
}

function findLatestExportRunForDefinition(latestRuns: LatestRun[], definitionJobType: string) {
  if (definitionJobType !== 'medication-history-bulk-export-drain') return null;
  return latestRuns.find((job) => job.job_type === 'medication-history-bulk-export') ?? null;
}

function readFiniteNumber(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function sanitizeOutput(job: LatestRun): Record<string, number> | null {
  if (job.job_type !== 'medication-history-bulk-export') {
    return null;
  }

  const payload = readJsonObject(job.output);
  if (!payload) return null;

  const requestedCount = readFiniteNumber(payload, 'requestedCount');
  const patientCount = readFiniteNumber(payload, 'patientCount');
  const failedCount = readFiniteNumber(payload, 'failedCount');

  return {
    ...(requestedCount !== undefined ? { requestedCount } : {}),
    ...(patientCount !== undefined ? { patientCount } : {}),
    ...(failedCount !== undefined ? { failedCount } : {}),
  };
}

function toJobRunDto(job: LatestRun | null): JobRunDto | null {
  if (!job) return null;
  return {
    id: job.id,
    job_type: job.job_type,
    status: job.status,
    output: sanitizeOutput(job),
    error_log: job.error_log ? 'エラーが記録されています' : null,
    retry_count: job.retry_count,
    max_retries: job.max_retries,
    started_at: job.started_at,
    completed_at: job.completed_at,
    created_at: job.created_at,
  };
}

export async function GET(req: NextRequest) {
  const authResult = await requireAuthContext(req, {
    permission: 'canAdmin',
    message: 'ジョブ設定の閲覧権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  const latestRuns = await prisma.integrationJob.findMany({
    where: {
      OR: [{ org_id: ctx.orgId }, { org_id: null }],
    },
    select: {
      id: true,
      job_type: true,
      status: true,
      output: true,
      error_log: true,
      retry_count: true,
      max_retries: true,
      started_at: true,
      completed_at: true,
      created_at: true,
    },
    orderBy: { created_at: 'desc' },
    take: 50,
  });

  return success({
    data: JOB_DEFINITIONS.map((definition) => ({
      ...definition,
      latest_run: toJobRunDto(findLatestRunForDefinition(latestRuns, definition.job_type)),
      latest_export_run: toJobRunDto(
        findLatestExportRunForDefinition(latestRuns, definition.job_type),
      ),
    })),
  });
}
