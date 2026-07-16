import { NextRequest, NextResponse } from 'next/server';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import {
  resolveRequestTraceContext,
  runWithRequestTraceContext,
  withRequestTraceHeaders,
  type RequestTraceContext,
} from '@/lib/api/request-correlation';
import { forbiddenResponse, registeredError, success, validationError } from '@/lib/api/response';
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
  drainNotificationDeliveries,
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

type JobExecutionScope = 'global_only' | 'tenant_or_global';

type JobRegistration = {
  executionScope: JobExecutionScope;
  handler: JobHandler;
};

function registerJob(executionScope: JobExecutionScope, handler: JobHandler): JobRegistration {
  return { executionScope, handler };
}

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

const JOB_REGISTRY: Record<string, JobRegistration> = {
  daily: registerJob('global_only', runDailyOperations),
  evening: registerJob('global_only', runEveningOperations),
  'daily-medication-check': registerJob('global_only', checkMedicationDeadlines),
  'daily-refill-check': registerJob('global_only', checkRefillPrescriptions),
  'daily-prescription-expiry': registerJob('global_only', checkPrescriptionExpiry),
  'daily-visit-demand': registerJob('global_only', generateVisitDemands),
  'daily-management-plan-review': registerJob('global_only', checkManagementPlanReviews),
  'daily-callback-followups': registerJob('global_only', checkCallbackFollowups),
  'daily-geocode-review': registerJob('global_only', checkResidenceGeocodeQuality),
  'daily-preparation-check': registerJob('global_only', checkPreparationBacklog),
  'daily-initial-home-visit-assessment': registerJob(
    'global_only',
    checkInitialHomeVisitAssessmentBacklog,
  ),
  'daily-billing-evidence': registerJob('global_only', generateBillingEvidenceDaily),
  'daily-visit-support-sync': registerJob('global_only', syncVisitSupportFeatureTasks),
  'daily-case-risk-task-sync': registerJob('tenant_or_global', (context) =>
    syncCaseRiskCockpitRiskTasks(
      context.authType === 'auth' && context.orgId ? { orgId: context.orgId } : undefined,
    ),
  ),
  'evening-unrecorded-visits': registerJob('global_only', checkUnrecordedVisits),
  'next-day': registerJob('global_only', runNextDayOperations),
  monthly: registerJob('global_only', runMonthlyOperations),
  'drug-master-refresh': registerJob('global_only', refreshSskDrugMaster),
  'drug-reference-refresh': registerJob('global_only', refreshMhlwDrugReferences),
  'drug-master-auto-refresh': registerJob('global_only', refreshAllFreeDrugMasters),
  'drug-master-freshness-check': registerJob('global_only', checkDrugMasterFreshness),
  'medical-institution-master-auto-refresh': registerJob('tenant_or_global', (context) =>
    refreshMedicalInstitutionMaster(
      context.authType === 'auth' && context.orgId ? { targetOrgIds: [context.orgId] } : undefined,
    ),
  ),
  'care-service-office-master-auto-refresh': registerJob('tenant_or_global', (context) =>
    refreshCareServiceOfficeMaster(
      context.authType === 'auth' && context.orgId ? { targetOrgIds: [context.orgId] } : undefined,
    ),
  ),
  'pmda-package-insert-refresh': registerJob('global_only', refreshPmdaPackageInsertsDelta),
  'medication-history-bulk-export-drain': registerJob('tenant_or_global', (context) =>
    drainMedicationHistoryBulkExportJobs(
      context.authType === 'auth' && context.orgId ? { orgId: context.orgId } : undefined,
    ),
  ),
  'bulk-export-artifact-cleanup': registerJob('tenant_or_global', (context) =>
    cleanupExpiredBulkExportArtifacts(
      context.authType === 'auth' && context.orgId ? { orgId: context.orgId } : undefined,
    ),
  ),
  'webhook-delivery-retry': registerJob('tenant_or_global', (context) =>
    retryWebhookDeliveries(
      context.authType === 'auth' && context.orgId ? { orgId: context.orgId } : undefined,
    ),
  ),
  'notification-delivery-drain': registerJob('tenant_or_global', (context) =>
    drainNotificationDeliveries(
      context.authType === 'auth' && context.orgId ? { orgId: context.orgId } : undefined,
    ),
  ),
  'yrese-clinical-sync-queue-drain': registerJob('tenant_or_global', (context) =>
    drainYreseClinicalSyncQueueJob(
      context.authType === 'auth' && context.orgId ? { orgId: context.orgId } : undefined,
    ),
  ),
  'clinical-fhir-raw-vault-retention-purge': registerJob('tenant_or_global', (context) =>
    purgeExpiredClinicalFhirRawResourceVaultJob(
      context.authType === 'auth' && context.orgId ? { orgId: context.orgId } : undefined,
    ),
  ),
  'credential-revocation-reconcile': registerJob('tenant_or_global', (context) =>
    reconcileCredentialRevocationIntents(
      context.authType === 'auth' && context.orgId ? { orgId: context.orgId } : undefined,
    ),
  ),
  'daily-facility-standard-expiry': registerJob('global_only', checkFacilityStandardExpiry),
  'daily-credential-expiry': registerJob('global_only', checkCredentialExpiry),
  'daily-consent-expiry': registerJob('global_only', checkConsentExpiry),
  'daily-public-subsidy-expiry': registerJob('tenant_or_global', (context) =>
    checkPublicSubsidyExpiry(
      context.authType === 'auth' && context.orgId ? { orgId: context.orgId } : undefined,
    ),
  ),
  'daily-visit-record-retention': registerJob('global_only', checkVisitRecordRetention),
  'daily-prescription-original-retention': registerJob(
    'global_only',
    checkPrescriptionOriginalRetention,
  ),
  'daily-pca-pump-rental-overdue': registerJob('tenant_or_global', checkPcaPumpRentalOverdues),
  'daily-pca-pump-return-inspection-pending': registerJob(
    'tenant_or_global',
    checkPcaPumpReturnInspectionPending,
  ),
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

  const registration = JOB_REGISTRY[jobType];
  if (!registration) {
    return tracedResponse(
      registeredError(
        'WORKFLOW_NOT_FOUND',
        `ジョブタイプ '${jobType}' は存在しません`,
      ) as NextResponse,
    );
  }

  if (authResult.authType === 'auth' && registration.executionScope === 'global_only') {
    return tracedResponse(await forbiddenResponse('このジョブはシステム実行専用です'));
  }

  try {
    const result = await runWithRequestTraceContext(trace, () =>
      registration.handler({
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
