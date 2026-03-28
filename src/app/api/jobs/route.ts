import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { prisma } from '@/lib/db/client';
import { success } from '@/lib/api/response';

const JOB_DEFINITIONS = [
  { job_type: 'daily', schedule_hint: '毎朝', endpoint: '/api/jobs/daily' },
  { job_type: 'daily-medication-check', schedule_hint: '毎朝', endpoint: '/api/jobs/daily-medication-check' },
  { job_type: 'daily-refill-check', schedule_hint: '毎朝', endpoint: '/api/jobs/daily-refill-check' },
  { job_type: 'daily-prescription-expiry', schedule_hint: '毎朝', endpoint: '/api/jobs/daily-prescription-expiry' },
  { job_type: 'daily-visit-demand', schedule_hint: '毎朝', endpoint: '/api/jobs/daily-visit-demand' },
  { job_type: 'daily-management-plan-review', schedule_hint: '毎朝', endpoint: '/api/jobs/daily-management-plan-review' },
  { job_type: 'daily-callback-followups', schedule_hint: '毎時または毎朝', endpoint: '/api/jobs/daily-callback-followups' },
  { job_type: 'daily-geocode-review', schedule_hint: '毎朝', endpoint: '/api/jobs/daily-geocode-review' },
  { job_type: 'daily-preparation-check', schedule_hint: '毎朝', endpoint: '/api/jobs/daily-preparation-check' },
  { job_type: 'daily-billing-evidence', schedule_hint: '毎朝', endpoint: '/api/jobs/daily-billing-evidence' },
  { job_type: 'daily-visit-support-sync', schedule_hint: '毎朝', endpoint: '/api/jobs/daily-visit-support-sync' },
  { job_type: 'daily-facility-standard-expiry', schedule_hint: '毎朝', endpoint: '/api/jobs/daily-facility-standard-expiry' },
  { job_type: 'daily-credential-expiry', schedule_hint: '毎朝', endpoint: '/api/jobs/daily-credential-expiry' },
  { job_type: 'daily-consent-expiry', schedule_hint: '毎朝', endpoint: '/api/jobs/daily-consent-expiry' },
  { job_type: 'daily-visit-record-retention', schedule_hint: '毎朝', endpoint: '/api/jobs/daily-visit-record-retention' },
  { job_type: 'daily-prescription-original-retention', schedule_hint: '毎朝', endpoint: '/api/jobs/daily-prescription-original-retention' },
  { job_type: 'drug-master-refresh', schedule_hint: '毎月', endpoint: '/api/jobs/drug-master-refresh' },
  { job_type: 'drug-reference-refresh', schedule_hint: '毎月', endpoint: '/api/jobs/drug-reference-refresh' },
  { job_type: 'pmda-package-insert-refresh', schedule_hint: '毎日', endpoint: '/api/jobs/pmda-package-insert-refresh' },
  { job_type: 'medication-history-bulk-export-drain', schedule_hint: '15分毎 + 要求時', endpoint: '/api/jobs/medication-history-bulk-export-drain' },
  { job_type: 'evening', schedule_hint: '毎夕', endpoint: '/api/jobs/evening' },
  { job_type: 'evening-unrecorded-visits', schedule_hint: '毎夕', endpoint: '/api/jobs/evening-unrecorded-visits' },
  { job_type: 'next-day', schedule_hint: '翌営業日朝', endpoint: '/api/jobs/next-day' },
  { job_type: 'monthly', schedule_hint: '毎月初', endpoint: '/api/jobs/monthly' },
];

export async function GET(req: NextRequest) {
  const authResult = await requireAuthContext(req, {
    permission: 'canAdmin',
    message: 'ジョブ設定の閲覧権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  const latestRuns = await prisma.integrationJob.findMany({
    where: {
      OR: [
        { org_id: ctx.orgId },
        { org_id: null },
      ],
    },
    orderBy: { created_at: 'desc' },
    take: 50,
  });

  return success({
    data: JOB_DEFINITIONS.map((definition) => ({
      ...definition,
      latest_run: latestRuns.find((job) => job.job_type === definition.job_type) ?? null,
    })),
  });
}
