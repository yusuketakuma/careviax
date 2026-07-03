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
    job_type: 'daily-public-subsidy-expiry',
    schedule_hint: '毎朝',
    endpoint: '/api/jobs/daily-public-subsidy-expiry',
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
    job_type: 'drug-master-auto-refresh',
    schedule_hint: '毎月 + 要求時',
    endpoint: '/api/jobs/drug-master-auto-refresh',
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
    job_type: 'medical-institution-master-auto-refresh',
    schedule_hint: '毎月 + 要求時',
    endpoint: '/api/jobs/medical-institution-master-auto-refresh',
  },
  {
    job_type: 'care-service-office-master-auto-refresh',
    schedule_hint: '毎月 + 要求時',
    endpoint: '/api/jobs/care-service-office-master-auto-refresh',
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

// Fixed, pre-redacted message shown for any job run with a non-null error_log.
// The stored error_log itself is ALWAYS a sanitized constant (see
// src/server/jobs/runner.ts, drug-master-import/*, pdf-bulk-export.ts) —
// but this UI-facing summary intentionally ignores its content entirely and
// substitutes this fixed string, so a future regression that writes an
// unsanitized error_log can never surface raw text (token/password/patient
// name) on this screen.
const JOB_ERROR_REDACTED_MESSAGE = 'エラーが記録されています';
const JOB_ERROR_NAME_RETRIES_EXHAUSTED = 'リトライ上限到達';
const JOB_ERROR_NAME_EXECUTION_FAILED = '実行エラー';

type JobErrorSummaryDto = {
  error_name: string;
  occurred_at: string | null;
  message: string;
};

type JobRunDto = {
  id: string;
  job_type: string;
  status: string;
  output: Record<string, number> | null;
  error_summary: JobErrorSummaryDto | null;
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

function toJobErrorSummary(job: LatestRun): JobErrorSummaryDto | null {
  if (!job.error_log) return null;

  // Classified purely from safe, already-selected fields (status/retry counts) —
  // never from the error_log text itself.
  const errorName =
    job.status === 'failed' && job.retry_count >= job.max_retries
      ? JOB_ERROR_NAME_RETRIES_EXHAUSTED
      : JOB_ERROR_NAME_EXECUTION_FAILED;

  const occurredAt = job.completed_at ?? job.started_at ?? job.created_at;

  return {
    error_name: errorName,
    occurred_at: occurredAt ? occurredAt.toISOString() : null,
    message: JOB_ERROR_REDACTED_MESSAGE,
  };
}

function toJobRunDto(job: LatestRun | null): JobRunDto | null {
  if (!job) return null;
  return {
    id: job.id,
    job_type: job.job_type,
    status: job.status,
    output: sanitizeOutput(job),
    error_summary: toJobErrorSummary(job),
    retry_count: job.retry_count,
    max_retries: job.max_retries,
    started_at: job.started_at,
    completed_at: job.completed_at,
    created_at: job.created_at,
  };
}

// Bounded window over the most recent IntegrationJob rows across all job types.
// This is a "counted list": each definition's latest_run is only found if it
// falls inside this window, so infrequent job types can legitimately show
// "未実行" even after having run outside the window. Explicit and named so a
// future edit cannot silently widen/remove the bound.
const RECENT_JOB_RUN_WINDOW = 50;

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
    take: RECENT_JOB_RUN_WINDOW,
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
