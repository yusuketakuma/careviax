import { NextRequest, NextResponse } from 'next/server';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import {
  resolveRequestTraceContext,
  runWithRequestTraceContext,
  withRequestTraceHeaders,
  type RequestTraceContext,
} from '@/lib/api/request-correlation';
import { registeredError, success, validationError } from '@/lib/api/response';
import { requireApiKeyOrAuthContext } from '@/lib/auth/context';
import { logger } from '@/lib/utils/logger';
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
  checkPublicSubsidyExpiry,
  checkVisitRecordRetention,
  checkPrescriptionOriginalRetention,
  checkPcaPumpRentalOverdues,
  checkPcaPumpReturnInspectionPending,
  syncCaseRiskCockpitRiskTasks,
  runDailyOperations,
  runEveningOperations,
  refreshMhlwDrugReferences,
  refreshPmdaPackageInsertsDelta,
  runNextDayOperations,
  runMonthlyOperations,
  refreshSskDrugMaster,
  refreshAllFreeDrugMasters,
  checkDrugMasterFreshness,
  refreshMedicalInstitutionMaster,
  refreshCareServiceOfficeMaster,
  drainMedicationHistoryBulkExportJobs,
  cleanupExpiredBulkExportArtifacts,
  retryWebhookDeliveries,
  drainYreseClinicalSyncQueueJob,
  purgeExpiredClinicalFhirRawResourceVaultJob,
  reconcileCredentialRevocationIntents,
} from '@/server/jobs';

type JobExecutionContext = {
  orgId?: string;
  authType: 'apiKey' | 'auth';
};

type JobHandler = (context: JobExecutionContext) => Promise<{
  processedCount: number;
  scannedCount?: number;
  errors?: string[];
  [key: string]: unknown;
}>;

const RAW_VAULT_PURGE_SAFE_ERROR_CODES = new Set([
  'org_scope_required',
  'invalid_limit',
  'clinical_raw_vault_purge_failed',
]);

function safeRawVaultPurgeErrors(errors: unknown): string[] {
  if (!Array.isArray(errors)) return [];
  return errors.filter(
    (error): error is string =>
      typeof error === 'string' && RAW_VAULT_PURGE_SAFE_ERROR_CODES.has(error),
  );
}

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
  'daily-case-risk-task-sync': (context) =>
    syncCaseRiskCockpitRiskTasks(
      context.authType === 'auth' && context.orgId ? { orgId: context.orgId } : undefined,
    ),
  'evening-unrecorded-visits': checkUnrecordedVisits,
  'next-day': runNextDayOperations,
  monthly: runMonthlyOperations,
  'drug-master-refresh': refreshSskDrugMaster,
  'drug-reference-refresh': refreshMhlwDrugReferences,
  'drug-master-auto-refresh': refreshAllFreeDrugMasters,
  'drug-master-freshness-check': checkDrugMasterFreshness,
  'medical-institution-master-auto-refresh': (context) =>
    refreshMedicalInstitutionMaster(
      context.authType === 'auth' && context.orgId ? { targetOrgIds: [context.orgId] } : undefined,
    ),
  'care-service-office-master-auto-refresh': (context) =>
    refreshCareServiceOfficeMaster(
      context.authType === 'auth' && context.orgId ? { targetOrgIds: [context.orgId] } : undefined,
    ),
  'pmda-package-insert-refresh': refreshPmdaPackageInsertsDelta,
  'medication-history-bulk-export-drain': (context) =>
    drainMedicationHistoryBulkExportJobs(
      context.authType === 'auth' && context.orgId ? { orgId: context.orgId } : undefined,
    ),
  'bulk-export-artifact-cleanup': (context) =>
    cleanupExpiredBulkExportArtifacts(
      context.authType === 'auth' && context.orgId ? { orgId: context.orgId } : undefined,
    ),
  'webhook-delivery-retry': (context) =>
    retryWebhookDeliveries(
      context.authType === 'auth' && context.orgId ? { orgId: context.orgId } : undefined,
    ),
  'yrese-clinical-sync-queue-drain': (context) =>
    drainYreseClinicalSyncQueueJob(
      context.authType === 'auth' && context.orgId ? { orgId: context.orgId } : undefined,
    ),
  'clinical-fhir-raw-vault-retention-purge': (context) =>
    purgeExpiredClinicalFhirRawResourceVaultJob(
      context.authType === 'auth' && context.orgId ? { orgId: context.orgId } : undefined,
    ),
  'credential-revocation-reconcile': (context) =>
    reconcileCredentialRevocationIntents(
      context.authType === 'auth' && context.orgId ? { orgId: context.orgId } : undefined,
    ),
  'daily-facility-standard-expiry': checkFacilityStandardExpiry,
  'daily-credential-expiry': checkCredentialExpiry,
  'daily-consent-expiry': checkConsentExpiry,
  'daily-public-subsidy-expiry': (context) =>
    checkPublicSubsidyExpiry(
      context.authType === 'auth' && context.orgId ? { orgId: context.orgId } : undefined,
    ),
  'daily-visit-record-retention': checkVisitRecordRetention,
  'daily-prescription-original-retention': checkPrescriptionOriginalRetention,
  'daily-pca-pump-rental-overdue': checkPcaPumpRentalOverdues,
  'daily-pca-pump-return-inspection-pending': checkPcaPumpReturnInspectionPending,
};

export async function POST(req: NextRequest, { params }: { params: Promise<{ jobType: string }> }) {
  const { jobType: rawJobType } = await params;

  const authResult = await requireApiKeyOrAuthContext(req, {
    apiKey: process.env.JOB_API_KEY,
    permission: 'canAdmin',
    message: 'ジョブ実行には管理者権限またはAPIキーが必要です',
  });
  if ('response' in authResult) return authResult.response as NextResponse;

  const trace: RequestTraceContext =
    authResult.authType === 'auth'
      ? {
          requestId: authResult.ctx.requestId,
          correlationId: authResult.ctx.correlationId,
        }
      : resolveRequestTraceContext(req);
  const tracedResponse = (response: NextResponse) => withRequestTraceHeaders(response, trace);

  const jobType = normalizeRequiredRouteParam(rawJobType);
  if (!jobType) {
    return tracedResponse(validationError('ジョブタイプが不正です') as NextResponse);
  }

  const handler = JOB_HANDLERS[jobType];
  if (!handler) {
    return tracedResponse(
      registeredError(
        'WORKFLOW_NOT_FOUND',
        `ジョブタイプ '${jobType}' は存在しません`,
      ) as NextResponse,
    );
  }

  try {
    const result = await runWithRequestTraceContext(trace, () =>
      handler({
        authType: authResult.authType,
        orgId: authResult.authType === 'auth' ? authResult.ctx.orgId : undefined,
      }),
    );
    if (jobType === 'bulk-export-artifact-cleanup') {
      return tracedResponse(
        success({
          data: {
            jobType,
            processedCount: result.processedCount,
            scannedCount: result.scannedCount,
            errorCount: result.errors?.length ?? 0,
          },
        }) as NextResponse,
      );
    }
    if (jobType === 'medication-history-bulk-export-drain') {
      return tracedResponse(
        success({
          data: {
            jobType,
            processedCount: result.processedCount,
            errorCount: result.errors?.length ?? 0,
          },
        }) as NextResponse,
      );
    }
    if (jobType === 'daily-case-risk-task-sync') {
      return tracedResponse(
        success({
          data: {
            jobType,
            processedCount: result.processedCount,
            scannedCount: result.scannedCount,
            upsertedTaskCount:
              typeof result.upsertedTaskCount === 'number' ? result.upsertedTaskCount : 0,
            resolvedStaleTaskCount:
              typeof result.resolvedStaleTaskCount === 'number' ? result.resolvedStaleTaskCount : 0,
            taskableFindingCount:
              typeof result.taskableFindingCount === 'number' ? result.taskableFindingCount : 0,
            skippedFindingCount:
              typeof result.skippedFindingCount === 'number' ? result.skippedFindingCount : 0,
            skippedCaseCount:
              typeof result.skippedCaseCount === 'number' ? result.skippedCaseCount : 0,
            errorCount: typeof result.errorCount === 'number' ? result.errorCount : 0,
            limited: result.limited === true,
            limit: typeof result.limit === 'number' ? result.limit : undefined,
          },
        }) as NextResponse,
      );
    }
    if (jobType === 'clinical-fhir-raw-vault-retention-purge') {
      const safeErrors = safeRawVaultPurgeErrors(result.errors);
      return tracedResponse(
        success({
          data: {
            jobType,
            processedCount: result.processedCount,
            scannedCount: typeof result.scannedCount === 'number' ? result.scannedCount : 0,
            deletedCount: typeof result.deletedCount === 'number' ? result.deletedCount : 0,
            errorCount: safeErrors.length,
            ...(safeErrors.length > 0 ? { errors: safeErrors } : {}),
          },
        }) as NextResponse,
      );
    }
    return tracedResponse(success({ data: { jobType, ...result } }) as NextResponse);
  } catch (err) {
    logger.error(
      {
        event: 'job.run_failed',
        jobType,
        operation: 'run_job',
        code: 'EXTERNAL_JOB_FAILED',
        requestId: trace.requestId,
        correlationId: trace.correlationId,
      },
      err,
    );
    return tracedResponse(
      registeredError('EXTERNAL_JOB_FAILED', 'ジョブの実行に失敗しました') as NextResponse,
    );
  }
}
