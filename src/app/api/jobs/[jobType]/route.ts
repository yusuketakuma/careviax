import { NextRequest, NextResponse } from 'next/server';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { success, error, validationError } from '@/lib/api/response';
import { requireApiKeyOrAuthContext } from '@/lib/auth/context';
import {
  checkMedicationDeadlines,
  checkRefillPrescriptions,
  checkPrescriptionExpiry,
  checkUnrecordedVisits,
  generateVisitDemands,
  checkManagementPlanReviews,
  checkCallbackFollowups,
  checkResidenceGeocodeQuality,
  checkPreparationBacklog,
  checkInitialHomeVisitAssessmentBacklog,
  generateBillingEvidenceDaily,
  syncVisitSupportFeatureTasks,
  checkFacilityStandardExpiry,
  checkCredentialExpiry,
  checkConsentExpiry,
  checkVisitRecordRetention,
  checkPrescriptionOriginalRetention,
  runDailyOperations,
  runEveningOperations,
  refreshMhlwDrugReferences,
  refreshPmdaPackageInsertsDelta,
  runNextDayOperations,
  runMonthlyOperations,
  refreshSskDrugMaster,
  refreshAllFreeDrugMasters,
  checkDrugMasterFreshness,
  drainMedicationHistoryBulkExportJobs,
  cleanupExpiredBulkExportArtifacts,
} from '@/server/jobs';

type JobExecutionContext = {
  orgId?: string;
  authType: 'apiKey' | 'auth';
};

type JobHandler = (context: JobExecutionContext) => Promise<{
  processedCount: number;
  scannedCount?: number;
  errors?: string[];
}>;

const JOB_HANDLERS: Record<string, JobHandler> = {
  daily: runDailyOperations,
  evening: runEveningOperations,
  'daily-medication-check': checkMedicationDeadlines,
  'daily-refill-check': checkRefillPrescriptions,
  'daily-prescription-expiry': checkPrescriptionExpiry,
  'daily-visit-demand': generateVisitDemands,
  'daily-management-plan-review': checkManagementPlanReviews,
  'daily-callback-followups': checkCallbackFollowups,
  'daily-geocode-review': checkResidenceGeocodeQuality,
  'daily-preparation-check': checkPreparationBacklog,
  'daily-initial-home-visit-assessment': checkInitialHomeVisitAssessmentBacklog,
  'daily-billing-evidence': generateBillingEvidenceDaily,
  'daily-visit-support-sync': syncVisitSupportFeatureTasks,
  'evening-unrecorded-visits': checkUnrecordedVisits,
  'next-day': runNextDayOperations,
  monthly: runMonthlyOperations,
  'drug-master-refresh': refreshSskDrugMaster,
  'drug-reference-refresh': refreshMhlwDrugReferences,
  'drug-master-auto-refresh': refreshAllFreeDrugMasters,
  'drug-master-freshness-check': checkDrugMasterFreshness,
  'pmda-package-insert-refresh': refreshPmdaPackageInsertsDelta,
  'medication-history-bulk-export-drain': (context) =>
    drainMedicationHistoryBulkExportJobs(
      context.authType === 'auth' && context.orgId ? { orgId: context.orgId } : undefined,
    ),
  'bulk-export-artifact-cleanup': (context) =>
    cleanupExpiredBulkExportArtifacts(
      context.authType === 'auth' && context.orgId ? { orgId: context.orgId } : undefined,
    ),
  'daily-facility-standard-expiry': checkFacilityStandardExpiry,
  'daily-credential-expiry': checkCredentialExpiry,
  'daily-consent-expiry': checkConsentExpiry,
  'daily-visit-record-retention': checkVisitRecordRetention,
  'daily-prescription-original-retention': checkPrescriptionOriginalRetention,
};

export async function POST(req: NextRequest, { params }: { params: Promise<{ jobType: string }> }) {
  const { jobType: rawJobType } = await params;

  const authResult = await requireApiKeyOrAuthContext(req, {
    apiKey: process.env.JOB_API_KEY,
    permission: 'canAdmin',
    message: 'ジョブ実行には管理者権限またはAPIキーが必要です',
  });
  if ('response' in authResult) return authResult.response as NextResponse;

  const jobType = normalizeRequiredRouteParam(rawJobType);
  if (!jobType) return validationError('ジョブタイプが不正です') as NextResponse;

  const handler = JOB_HANDLERS[jobType];
  if (!handler) {
    return error(
      'WORKFLOW_NOT_FOUND',
      `ジョブタイプ '${jobType}' は存在しません`,
      404,
    ) as NextResponse;
  }

  try {
    const result = await handler({
      authType: authResult.authType,
      orgId: authResult.authType === 'auth' ? authResult.ctx.orgId : undefined,
    });
    if (jobType === 'bulk-export-artifact-cleanup') {
      return success({
        jobType,
        processedCount: result.processedCount,
        scannedCount: result.scannedCount,
        errorCount: result.errors?.length ?? 0,
      }) as NextResponse;
    }
    return success({ jobType, ...result }) as NextResponse;
  } catch (err) {
    console.error(`[job:${jobType}]`, err);
    return error('EXTERNAL_JOB_FAILED', 'ジョブの実行に失敗しました', 500) as NextResponse;
  }
}
