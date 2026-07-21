import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getRequestTraceContext, type RequestTraceContext } from '@/lib/api/request-correlation';
import {
  createJobRequest as createRequest,
  expectJobSuccessData,
} from '@/test/api-job-response-assertions';

const {
  authMock,
  membershipFindFirstMock,
  checkMedicationDeadlinesMock,
  checkRefillPrescriptionsMock,
  checkPrescriptionExpiryMock,
  checkUnrecordedVisitsMock,
  runDailyOperationsMock,
  runEveningOperationsMock,
  generateVisitDemandsMock,
  checkManagementPlanReviewsMock,
  checkCallbackFollowupsMock,
  checkResidenceGeocodeQualityMock,
  checkPreparationBacklogMock,
  checkInitialHomeVisitAssessmentBacklogMock,
  generateBillingEvidenceDailyMock,
  syncVisitSupportFeatureTasksMock,
  runNextDayOperationsMock,
  runMonthlyOperationsMock,
  refreshMhlwDrugReferencesMock,
  refreshPmdaPackageInsertsDeltaMock,
  refreshSskDrugMasterMock,
  refreshAllFreeDrugMastersMock,
  checkDrugMasterFreshnessMock,
  refreshMedicalInstitutionMasterMock,
  refreshCareServiceOfficeMasterMock,
  drainMedicationHistoryBulkExportJobsMock,
  cleanupExpiredBulkExportArtifactsMock,
  retryWebhookDeliveriesMock,
  drainNotificationDeliveriesMock,
  drainYreseClinicalSyncQueueJobMock,
  purgeExpiredClinicalFhirRawResourceVaultJobMock,
  reconcileCredentialRevocationIntentsMock,
  checkFacilityStandardExpiryMock,
  checkCredentialExpiryMock,
  checkConsentExpiryMock,
  checkPublicSubsidyExpiryMock,
  checkVisitRecordRetentionMock,
  checkPrescriptionOriginalRetentionMock,
  checkPcaPumpRentalOverduesMock,
  checkPcaPumpReturnInspectionPendingMock,
  syncCaseRiskCockpitRiskTasksMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  checkMedicationDeadlinesMock: vi.fn(),
  checkRefillPrescriptionsMock: vi.fn(),
  checkPrescriptionExpiryMock: vi.fn(),
  checkUnrecordedVisitsMock: vi.fn(),
  runDailyOperationsMock: vi.fn(),
  runEveningOperationsMock: vi.fn(),
  generateVisitDemandsMock: vi.fn(),
  checkManagementPlanReviewsMock: vi.fn(),
  checkCallbackFollowupsMock: vi.fn(),
  checkResidenceGeocodeQualityMock: vi.fn(),
  checkPreparationBacklogMock: vi.fn(),
  checkInitialHomeVisitAssessmentBacklogMock: vi.fn(),
  generateBillingEvidenceDailyMock: vi.fn(),
  syncVisitSupportFeatureTasksMock: vi.fn(),
  runNextDayOperationsMock: vi.fn(),
  runMonthlyOperationsMock: vi.fn(),
  refreshMhlwDrugReferencesMock: vi.fn(),
  refreshPmdaPackageInsertsDeltaMock: vi.fn(),
  refreshSskDrugMasterMock: vi.fn(),
  refreshAllFreeDrugMastersMock: vi.fn(),
  checkDrugMasterFreshnessMock: vi.fn(),
  refreshMedicalInstitutionMasterMock: vi.fn(),
  refreshCareServiceOfficeMasterMock: vi.fn(),
  drainMedicationHistoryBulkExportJobsMock: vi.fn(),
  cleanupExpiredBulkExportArtifactsMock: vi.fn(),
  retryWebhookDeliveriesMock: vi.fn(),
  drainNotificationDeliveriesMock: vi.fn(),
  drainYreseClinicalSyncQueueJobMock: vi.fn(),
  purgeExpiredClinicalFhirRawResourceVaultJobMock: vi.fn(),
  reconcileCredentialRevocationIntentsMock: vi.fn(),
  checkFacilityStandardExpiryMock: vi.fn(),
  checkCredentialExpiryMock: vi.fn(),
  checkConsentExpiryMock: vi.fn(),
  checkPublicSubsidyExpiryMock: vi.fn(),
  checkVisitRecordRetentionMock: vi.fn(),
  checkPrescriptionOriginalRetentionMock: vi.fn(),
  checkPcaPumpRentalOverduesMock: vi.fn(),
  checkPcaPumpReturnInspectionPendingMock: vi.fn(),
  syncCaseRiskCockpitRiskTasksMock: vi.fn(),
}));

vi.mock('@/lib/auth/config', () => ({
  auth: authMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    membership: {
      findFirst: membershipFindFirstMock,
    },
  },
}));

vi.mock('@/server/jobs', () => ({
  runDailyOperations: runDailyOperationsMock,
  runEveningOperations: runEveningOperationsMock,
  checkMedicationDeadlines: checkMedicationDeadlinesMock,
  checkRefillPrescriptions: checkRefillPrescriptionsMock,
  checkPrescriptionExpiry: checkPrescriptionExpiryMock,
  checkUnrecordedVisits: checkUnrecordedVisitsMock,
  generateVisitDemands: generateVisitDemandsMock,
  checkManagementPlanReviews: checkManagementPlanReviewsMock,
  checkCallbackFollowups: checkCallbackFollowupsMock,
  checkResidenceGeocodeQuality: checkResidenceGeocodeQualityMock,
  checkPreparationBacklog: checkPreparationBacklogMock,
  checkInitialHomeVisitAssessmentBacklog: checkInitialHomeVisitAssessmentBacklogMock,
  generateBillingEvidenceDaily: generateBillingEvidenceDailyMock,
  syncVisitSupportFeatureTasks: syncVisitSupportFeatureTasksMock,
  runNextDayOperations: runNextDayOperationsMock,
  runMonthlyOperations: runMonthlyOperationsMock,
  refreshMhlwDrugReferences: refreshMhlwDrugReferencesMock,
  refreshPmdaPackageInsertsDelta: refreshPmdaPackageInsertsDeltaMock,
  refreshSskDrugMaster: refreshSskDrugMasterMock,
  refreshAllFreeDrugMasters: refreshAllFreeDrugMastersMock,
  checkDrugMasterFreshness: checkDrugMasterFreshnessMock,
  refreshMedicalInstitutionMaster: refreshMedicalInstitutionMasterMock,
  refreshCareServiceOfficeMaster: refreshCareServiceOfficeMasterMock,
  drainMedicationHistoryBulkExportJobs: drainMedicationHistoryBulkExportJobsMock,
  cleanupExpiredBulkExportArtifacts: cleanupExpiredBulkExportArtifactsMock,
  retryWebhookDeliveries: retryWebhookDeliveriesMock,
  drainNotificationDeliveries: drainNotificationDeliveriesMock,
  drainYreseClinicalSyncQueueJob: drainYreseClinicalSyncQueueJobMock,
  purgeExpiredClinicalFhirRawResourceVaultJob: purgeExpiredClinicalFhirRawResourceVaultJobMock,
  reconcileCredentialRevocationIntents: reconcileCredentialRevocationIntentsMock,
  checkFacilityStandardExpiry: checkFacilityStandardExpiryMock,
  checkCredentialExpiry: checkCredentialExpiryMock,
  checkConsentExpiry: checkConsentExpiryMock,
  checkPublicSubsidyExpiry: checkPublicSubsidyExpiryMock,
  checkVisitRecordRetention: checkVisitRecordRetentionMock,
  checkPrescriptionOriginalRetention: checkPrescriptionOriginalRetentionMock,
  checkPcaPumpRentalOverdues: checkPcaPumpRentalOverduesMock,
  checkPcaPumpReturnInspectionPending: checkPcaPumpReturnInspectionPendingMock,
  syncCaseRiskCockpitRiskTasks: syncCaseRiskCockpitRiskTasksMock,
}));

import { POST } from './route';

describe('/api/jobs/[jobType] POST', () => {
  const originalJobApiKey = process.env.JOB_API_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.JOB_API_KEY = 'job-secret';
    checkMedicationDeadlinesMock.mockResolvedValue({ processedCount: 3 });
    drainNotificationDeliveriesMock.mockResolvedValue({ processedCount: 0, errors: [] });
    checkRefillPrescriptionsMock.mockResolvedValue({ processedCount: 0 });
    checkPrescriptionExpiryMock.mockResolvedValue({ processedCount: 0 });
    checkUnrecordedVisitsMock.mockResolvedValue({ processedCount: 0 });
    runDailyOperationsMock.mockResolvedValue({ processedCount: 3 });
    runEveningOperationsMock.mockResolvedValue({ processedCount: 0 });
    syncVisitSupportFeatureTasksMock.mockResolvedValue({ processedCount: 2 });
    checkInitialHomeVisitAssessmentBacklogMock.mockResolvedValue({ processedCount: 1 });
    runNextDayOperationsMock.mockResolvedValue({ processedCount: 1 });
    runMonthlyOperationsMock.mockResolvedValue({ processedCount: 4 });
    refreshMhlwDrugReferencesMock.mockResolvedValue({ processedCount: 120 });
    refreshPmdaPackageInsertsDeltaMock.mockResolvedValue({ processedCount: 42 });
    refreshSskDrugMasterMock.mockResolvedValue({ processedCount: 12 });
    refreshAllFreeDrugMastersMock.mockResolvedValue({
      processedCount: 132,
      details: { ssk: 12, mhlw: 120 },
    });
    refreshMedicalInstitutionMasterMock.mockResolvedValue({
      processedCount: 2,
      scannedCount: 20,
      createdCount: 1,
      updatedCount: 1,
    });
    refreshCareServiceOfficeMasterMock.mockResolvedValue({
      processedCount: 3,
      scannedCount: 30,
      createdCount: 2,
      updatedCount: 1,
    });
    drainMedicationHistoryBulkExportJobsMock.mockResolvedValue({ processedCount: 25 });
    retryWebhookDeliveriesMock.mockResolvedValue({
      processedCount: 2,
      scannedCount: 2,
      succeededCount: 1,
      failedCount: 1,
      blockedCount: 0,
    });
    drainYreseClinicalSyncQueueJobMock.mockResolvedValue({
      processedCount: 2,
      scannedCount: 3,
      succeededCount: 1,
      conflictCount: 1,
      failedCount: 0,
      skippedCount: 1,
    });
    purgeExpiredClinicalFhirRawResourceVaultJobMock.mockResolvedValue({
      processedCount: 2,
      deletedCount: 2,
      scannedCount: 2,
      errors: [],
    });
    reconcileCredentialRevocationIntentsMock.mockResolvedValue({
      processedCount: 1,
      scannedCount: 1,
      errors: [],
    });
    cleanupExpiredBulkExportArtifactsMock.mockResolvedValue({
      processedCount: 3,
      scannedCount: 12,
      errors: ['s3://bucket/bulk-exports/org_2/file.zip unavailable'],
    });
    checkFacilityStandardExpiryMock.mockResolvedValue({ processedCount: 0 });
    checkCredentialExpiryMock.mockResolvedValue({ processedCount: 0 });
    checkConsentExpiryMock.mockResolvedValue({ processedCount: 0 });
    checkPublicSubsidyExpiryMock.mockResolvedValue({ processedCount: 1 });
    checkVisitRecordRetentionMock.mockResolvedValue({ processedCount: 1 });
    checkPrescriptionOriginalRetentionMock.mockResolvedValue({ processedCount: 1 });
    checkPcaPumpRentalOverduesMock.mockResolvedValue({ processedCount: 1 });
    checkPcaPumpReturnInspectionPendingMock.mockResolvedValue({ processedCount: 2 });
    syncCaseRiskCockpitRiskTasksMock.mockResolvedValue({
      processedCount: 2,
      scannedCount: 3,
      upsertedTaskCount: 4,
      resolvedStaleTaskCount: 1,
      taskableFindingCount: 5,
      skippedFindingCount: 6,
      skippedCaseCount: 1,
      errorCount: 0,
      limited: false,
      limit: 100,
      upserted_tasks: [{ id: 'task_1', display_id: 'tsk0000000001' }],
      raw: '患者 山田太郎 token=secret risk:privacy_security:raw',
    });
  });

  afterAll(() => {
    process.env.JOB_API_KEY = originalJobApiKey;
  });

  it('returns 401 when neither api key nor session exists', async () => {
    authMock.mockResolvedValue(null);

    const response = await POST(createRequest(), {
      params: Promise.resolve({ jobType: 'daily-medication-check' }),
    });

    expect(response.status).toBe(401);
  });

  it('returns 403 when authenticated user lacks admin permission', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'pharmacist' });

    const response = await POST(
      createRequest({ 'x-org-id': 'org_1', 'x-correlation-id': 'denied_job_trace' }),
      {
        params: Promise.resolve({ jobType: 'daily-medication-check' }),
      },
    );

    expect(response.status).toBe(403);
    expect(response.headers.get('X-Request-Id')).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.headers.get('X-Correlation-Id')).toBe('denied_job_trace');
    await expect(response.json()).resolves.toMatchObject({
      code: 'AUTH_FORBIDDEN',
    });
  });

  it('returns 200 when api key is valid', async () => {
    authMock.mockResolvedValue(null);
    let capturedTrace: RequestTraceContext | undefined;
    checkMedicationDeadlinesMock.mockImplementationOnce(async () => {
      capturedTrace = getRequestTraceContext();
      return { processedCount: 3 };
    });

    const response = await POST(
      createRequest({
        'x-api-key': 'job-secret',
        'x-correlation-id': 'api_key_job_trace',
      }),
      { params: Promise.resolve({ jobType: '  daily-medication-check  ' }) },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('X-Request-Id')).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.headers.get('X-Correlation-Id')).toBe('api_key_job_trace');
    expect(capturedTrace).toEqual({
      requestId: response.headers.get('X-Request-Id'),
      correlationId: 'api_key_job_trace',
    });
    expect(checkMedicationDeadlinesMock).toHaveBeenCalledOnce();
    await expectJobSuccessData(response, {
      jobType: 'daily-medication-check',
      processedCount: 3,
    });
  });

  it('runs the bounded credential revocation reconciler through the API-key job boundary', async () => {
    authMock.mockResolvedValue(null);

    const response = await POST(createRequest({ 'x-api-key': 'job-secret' }), {
      params: Promise.resolve({ jobType: 'credential-revocation-reconcile' }),
    });

    expect(response.status).toBe(200);
    expect(reconcileCredentialRevocationIntentsMock).toHaveBeenCalledWith(undefined);
    await expectJobSuccessData(response, {
      jobType: 'credential-revocation-reconcile',
      processedCount: 1,
      scannedCount: 1,
      errors: [],
    });
  });

  it('logs job failures without dumping provider details', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      authMock.mockResolvedValue(null);
      checkMedicationDeadlinesMock.mockRejectedValueOnce(new Error('job provider secret detail'));

      const response = await POST(
        createRequest({
          'x-api-key': 'job-secret',
          'x-correlation-id': 'failed_job_trace',
        }),
        { params: Promise.resolve({ jobType: 'daily-medication-check' }) },
      );

      expect(response.status).toBe(500);
      expect(response.headers.get('X-Request-Id')).toMatch(/^[0-9a-f-]{36}$/);
      expect(response.headers.get('X-Correlation-Id')).toBe('failed_job_trace');
      const body = await response.json();
      expect(body).toEqual({
        code: 'EXTERNAL_JOB_FAILED',
        message: 'ジョブの実行に失敗しました',
      });
      expect(JSON.stringify(body)).not.toContain('job provider secret detail');
      expect(checkMedicationDeadlinesMock).toHaveBeenCalledOnce();
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy.mock.calls[0]).toHaveLength(1);
      const logEntry = JSON.parse(String(consoleErrorSpy.mock.calls[0]?.[0])) as Record<
        string,
        unknown
      >;
      expect(logEntry).toMatchObject({
        level: 'error',
        message: 'job.run_failed',
        event: 'job.run_failed',
        jobType: 'daily-medication-check',
        operation: 'run_job',
        code: 'EXTERNAL_JOB_FAILED',
        error_name: 'Error',
        requestId: response.headers.get('X-Request-Id'),
        correlationId: 'failed_job_trace',
      });
      expect(JSON.stringify(logEntry)).not.toContain('job provider secret detail');
      expect(logEntry).not.toHaveProperty('stack');
      expect(logEntry).not.toHaveProperty('error_message');
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it('rejects blank job types before running a handler', async () => {
    authMock.mockResolvedValue(null);

    const response = await POST(
      createRequest({ 'x-api-key': 'job-secret', 'x-correlation-id': 'validation_job_trace' }),
      { params: Promise.resolve({ jobType: '   ' }) },
    );

    expect(response.status).toBe(400);
    expect(response.headers.get('X-Correlation-Id')).toBe('validation_job_trace');
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'ジョブタイプが不正です',
    });
    expect(checkMedicationDeadlinesMock).not.toHaveBeenCalled();
    expect(runDailyOperationsMock).not.toHaveBeenCalled();
    expect(cleanupExpiredBulkExportArtifactsMock).not.toHaveBeenCalled();
  });

  it('returns 404 for unknown normalized job types before running a handler', async () => {
    authMock.mockResolvedValue(null);

    const response = await POST(
      createRequest({ 'x-api-key': 'job-secret', 'x-correlation-id': 'unknown_job_trace' }),
      { params: Promise.resolve({ jobType: '  unknown-job  ' }) },
    );

    expect(response.status).toBe(404);
    expect(response.headers.get('X-Correlation-Id')).toBe('unknown_job_trace');
    await expect(response.json()).resolves.toEqual({
      code: 'WORKFLOW_NOT_FOUND',
      message: "ジョブタイプ 'unknown-job' は存在しません",
    });
    expect(checkMedicationDeadlinesMock).not.toHaveBeenCalled();
    expect(runDailyOperationsMock).not.toHaveBeenCalled();
    expect(cleanupExpiredBulkExportArtifactsMock).not.toHaveBeenCalled();
  });

  it('rejects authenticated tenant admins from global-only jobs before handler execution', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });
    const response = await POST(
      createRequest({ 'x-org-id': 'org_1', 'x-correlation-id': 'admin_job_trace' }),
      { params: Promise.resolve({ jobType: 'daily-medication-check' }) },
    );

    expect(response.status).toBe(403);
    expect(response.headers.get('X-Request-Id')).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.headers.get('X-Correlation-Id')).toBe('admin_job_trace');
    await expect(response.json()).resolves.toMatchObject({
      code: 'AUTH_FORBIDDEN',
      message: 'このジョブはシステム実行専用です',
    });
    expect(checkMedicationDeadlinesMock).not.toHaveBeenCalled();
  });

  it('does not treat a legacy tenant owner as a global job operator', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'owner' });

    const response = await POST(createRequest({ 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ jobType: 'monthly' }),
    });

    expect(response.status).toBe(403);
    expect(runMonthlyOperationsMock).not.toHaveBeenCalled();
  });

  it.each(['patient@example.test', 'contains spaces', 'a'.repeat(129)])(
    'replaces unsafe API-key correlation ids before handler scope and response: %s',
    async (correlationId) => {
      authMock.mockResolvedValue(null);
      let capturedTrace: RequestTraceContext | undefined;
      checkMedicationDeadlinesMock.mockImplementationOnce(async () => {
        capturedTrace = getRequestTraceContext();
        return { processedCount: 3 };
      });

      const response = await POST(
        createRequest({ 'x-api-key': 'job-secret', 'x-correlation-id': correlationId }),
        { params: Promise.resolve({ jobType: 'daily-medication-check' }) },
      );

      const requestId = response.headers.get('X-Request-Id');
      expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
      expect(response.headers.get('X-Correlation-Id')).toBe(requestId);
      expect(capturedTrace).toEqual({ requestId, correlationId: requestId });
    },
  );

  it('rejects authenticated tenant admins from unscoped composite jobs', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });

    const response = await POST(createRequest({ 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ jobType: 'daily-visit-support-sync' }),
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: 'AUTH_FORBIDDEN',
      message: 'このジョブはシステム実行専用です',
    });
    expect(syncVisitSupportFeatureTasksMock).not.toHaveBeenCalled();
  });

  it('scopes public subsidy expiry checks to the authenticated admin org', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });

    const response = await POST(createRequest({ 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ jobType: 'daily-public-subsidy-expiry' }),
    });

    expect(response.status).toBe(200);
    expect(checkPublicSubsidyExpiryMock).toHaveBeenCalledWith({ orgId: 'org_1' });
    await expectJobSuccessData(response, {
      jobType: 'daily-public-subsidy-expiry',
      processedCount: 1,
    });
  });

  it('scopes authenticated case risk task sync to the admin organization and minimizes output', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });

    const response = await POST(createRequest({ 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ jobType: 'daily-case-risk-task-sync' }),
    });

    expect(response.status).toBe(200);
    expect(syncCaseRiskCockpitRiskTasksMock).toHaveBeenCalledWith({ orgId: 'org_1' });
    const body = await response.json();
    expect(body).toMatchObject({
      data: {
        jobType: 'daily-case-risk-task-sync',
        processedCount: 2,
        scannedCount: 3,
        upsertedTaskCount: 4,
        resolvedStaleTaskCount: 1,
      },
    });
    expect(body).not.toHaveProperty('jobType');
    const bodyText = JSON.stringify(body);
    expect(bodyText).toContain('daily-case-risk-task-sync');
    expect(bodyText).toContain('"processedCount":2');
    expect(bodyText).toContain('"scannedCount":3');
    expect(bodyText).toContain('"upsertedTaskCount":4');
    expect(bodyText).toContain('"resolvedStaleTaskCount":1');
    expect(bodyText).not.toContain('upserted_tasks');
    expect(bodyText).not.toContain('task_1');
    expect(bodyText).not.toContain('tsk0000000001');
    expect(bodyText).not.toContain('山田太郎');
    expect(bodyText).not.toContain('token=secret');
    expect(bodyText).not.toContain('risk:privacy_security');
    expect(bodyText).not.toContain('raw');
  });

  it('allows api key case risk task sync across organizations', async () => {
    authMock.mockResolvedValue(null);

    const response = await POST(createRequest({ 'x-api-key': 'job-secret' }), {
      params: Promise.resolve({ jobType: 'daily-case-risk-task-sync' }),
    });

    expect(response.status).toBe(200);
    expect(syncCaseRiskCockpitRiskTasksMock).toHaveBeenCalledWith(undefined);
  });

  it('allows api key public subsidy expiry checks across organizations', async () => {
    authMock.mockResolvedValue(null);

    const response = await POST(createRequest({ 'x-api-key': 'job-secret' }), {
      params: Promise.resolve({ jobType: 'daily-public-subsidy-expiry' }),
    });

    expect(response.status).toBe(200);
    expect(checkPublicSubsidyExpiryMock).toHaveBeenCalledWith(undefined);
  });

  it('returns 200 when api key executes drug master refresh', async () => {
    authMock.mockResolvedValue(null);

    const response = await POST(createRequest({ 'x-api-key': 'job-secret' }), {
      params: Promise.resolve({ jobType: 'drug-master-refresh' }),
    });

    expect(response.status).toBe(200);
    expect(refreshSskDrugMasterMock).toHaveBeenCalledOnce();
    await expectJobSuccessData(response, {
      jobType: 'drug-master-refresh',
      processedCount: 12,
    });
  });

  it('returns 200 when api key executes drug reference refresh', async () => {
    authMock.mockResolvedValue(null);

    const response = await POST(createRequest({ 'x-api-key': 'job-secret' }), {
      params: Promise.resolve({ jobType: 'drug-reference-refresh' }),
    });

    expect(response.status).toBe(200);
    expect(refreshMhlwDrugReferencesMock).toHaveBeenCalledOnce();
    await expectJobSuccessData(response, {
      jobType: 'drug-reference-refresh',
      processedCount: 120,
    });
  });

  it('returns 200 when api key executes all free drug master refresh', async () => {
    authMock.mockResolvedValue(null);

    const response = await POST(createRequest({ 'x-api-key': 'job-secret' }), {
      params: Promise.resolve({ jobType: 'drug-master-auto-refresh' }),
    });

    expect(response.status).toBe(200);
    expect(refreshAllFreeDrugMastersMock).toHaveBeenCalledOnce();
    await expectJobSuccessData(response, {
      jobType: 'drug-master-auto-refresh',
      processedCount: 132,
      details: { ssk: 12, mhlw: 120 },
    });
  });

  it('scopes medical institution master refresh to the authenticated admin org', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });

    const response = await POST(createRequest({ 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ jobType: 'medical-institution-master-auto-refresh' }),
    });

    expect(response.status).toBe(200);
    expect(refreshMedicalInstitutionMasterMock).toHaveBeenCalledWith({
      targetOrgIds: ['org_1'],
    });
    await expectJobSuccessData(response, {
      jobType: 'medical-institution-master-auto-refresh',
      processedCount: 2,
      scannedCount: 20,
    });
  });

  it('runs medical institution master refresh for all orgs from the job api key', async () => {
    authMock.mockResolvedValue(null);

    const response = await POST(createRequest({ 'x-api-key': 'job-secret' }), {
      params: Promise.resolve({ jobType: 'medical-institution-master-auto-refresh' }),
    });

    expect(response.status).toBe(200);
    expect(refreshMedicalInstitutionMasterMock).toHaveBeenCalledWith(undefined);
  });

  it('scopes care service office master refresh to the authenticated admin org', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });

    const response = await POST(createRequest({ 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ jobType: 'care-service-office-master-auto-refresh' }),
    });

    expect(response.status).toBe(200);
    expect(refreshCareServiceOfficeMasterMock).toHaveBeenCalledWith({
      targetOrgIds: ['org_1'],
    });
    await expectJobSuccessData(response, {
      jobType: 'care-service-office-master-auto-refresh',
      processedCount: 3,
      scannedCount: 30,
    });
  });

  it('runs care service office master refresh for all orgs from the job api key', async () => {
    authMock.mockResolvedValue(null);

    const response = await POST(createRequest({ 'x-api-key': 'job-secret' }), {
      params: Promise.resolve({ jobType: 'care-service-office-master-auto-refresh' }),
    });

    expect(response.status).toBe(200);
    expect(refreshCareServiceOfficeMasterMock).toHaveBeenCalledWith(undefined);
  });

  it('returns 200 when api key executes pmda delta refresh', async () => {
    authMock.mockResolvedValue(null);

    const response = await POST(createRequest({ 'x-api-key': 'job-secret' }), {
      params: Promise.resolve({ jobType: 'pmda-package-insert-refresh' }),
    });

    expect(response.status).toBe(200);
    expect(refreshPmdaPackageInsertsDeltaMock).toHaveBeenCalledOnce();
    await expectJobSuccessData(response, {
      jobType: 'pmda-package-insert-refresh',
      processedCount: 42,
    });
  });

  it('returns 200 when admin drains bulk medication history exports', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });

    const response = await POST(createRequest({ 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ jobType: 'medication-history-bulk-export-drain' }),
    });

    expect(response.status).toBe(200);
    expect(drainMedicationHistoryBulkExportJobsMock).toHaveBeenCalledWith({ orgId: 'org_1' });
    await expectJobSuccessData(response, {
      jobType: 'medication-history-bulk-export-drain',
      processedCount: 25,
    });
  });

  it('allows api key bulk export drains across organizations', async () => {
    authMock.mockResolvedValue(null);

    const response = await POST(createRequest({ 'x-api-key': 'job-secret' }), {
      params: Promise.resolve({ jobType: 'medication-history-bulk-export-drain' }),
    });

    expect(response.status).toBe(200);
    expect(drainMedicationHistoryBulkExportJobsMock).toHaveBeenCalledWith(undefined);
  });

  it('allows api key cleanup of expired bulk export artifacts', async () => {
    authMock.mockResolvedValue(null);

    const response = await POST(createRequest({ 'x-api-key': 'job-secret' }), {
      params: Promise.resolve({ jobType: 'bulk-export-artifact-cleanup' }),
    });

    expect(response.status).toBe(200);
    expect(cleanupExpiredBulkExportArtifactsMock).toHaveBeenCalledWith(undefined);
    const payload = await expectJobSuccessData(response, {
      jobType: 'bulk-export-artifact-cleanup',
      processedCount: 3,
      scannedCount: 12,
      errorCount: 1,
    });
    expect(payload).toMatchObject({
      jobType: 'bulk-export-artifact-cleanup',
      processedCount: 3,
      scannedCount: 12,
      errorCount: 1,
    });
    expect(payload.errors).toBeUndefined();
  });

  it('scopes authenticated cleanup of expired bulk export artifacts to the admin organization', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });

    const response = await POST(createRequest({ 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ jobType: 'bulk-export-artifact-cleanup' }),
    });

    expect(response.status).toBe(200);
    expect(cleanupExpiredBulkExportArtifactsMock).toHaveBeenCalledWith({ orgId: 'org_1' });
    const payload = await expectJobSuccessData(response, {
      jobType: 'bulk-export-artifact-cleanup',
      processedCount: 3,
      scannedCount: 12,
      errorCount: 1,
    });
    expect(payload).toMatchObject({
      jobType: 'bulk-export-artifact-cleanup',
      processedCount: 3,
      scannedCount: 12,
      errorCount: 1,
    });
    expect(payload.errors).toBeUndefined();
  });

  it('returns bulk export drain error counts without leaking drain error details', async () => {
    authMock.mockResolvedValue(null);
    const rawFailure = 'storage unavailable patient=患者A token=secret s3://bucket/private.zip';
    drainMedicationHistoryBulkExportJobsMock.mockResolvedValue({
      processedCount: 2,
      errors: [rawFailure],
    });

    const response = await POST(createRequest({ 'x-api-key': 'job-secret' }), {
      params: Promise.resolve({ jobType: 'medication-history-bulk-export-drain' }),
    });

    expect(response.status).toBe(200);
    const payload = await expectJobSuccessData(response, {
      jobType: 'medication-history-bulk-export-drain',
      processedCount: 2,
      errorCount: 1,
    });
    expect(payload).toMatchObject({
      jobType: 'medication-history-bulk-export-drain',
      processedCount: 2,
      errorCount: 1,
    });
    expect(payload.errors).toBeUndefined();
    expect(JSON.stringify(payload)).not.toContain(rawFailure);
  });

  it('allows api key webhook delivery retries across organizations', async () => {
    authMock.mockResolvedValue(null);

    const response = await POST(createRequest({ 'x-api-key': 'job-secret' }), {
      params: Promise.resolve({ jobType: 'webhook-delivery-retry' }),
    });

    expect(response.status).toBe(200);
    expect(retryWebhookDeliveriesMock).toHaveBeenCalledWith(undefined);
    await expectJobSuccessData(response, {
      jobType: 'webhook-delivery-retry',
      processedCount: 2,
      scannedCount: 2,
      succeededCount: 1,
      failedCount: 1,
      blockedCount: 0,
    });
  });

  it('scopes authenticated webhook delivery retries to the admin organization', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });

    const response = await POST(createRequest({ 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ jobType: 'webhook-delivery-retry' }),
    });

    expect(response.status).toBe(200);
    expect(retryWebhookDeliveriesMock).toHaveBeenCalledWith({ orgId: 'org_1' });
  });

  it('allows the scheduler to drain notification deliveries across tenant-scoped workers', async () => {
    authMock.mockResolvedValue(null);

    const response = await POST(createRequest({ 'x-api-key': 'job-secret' }), {
      params: Promise.resolve({ jobType: 'notification-delivery-drain' }),
    });

    expect(response.status).toBe(200);
    expect(drainNotificationDeliveriesMock).toHaveBeenCalledWith(undefined);
  });

  it('pins an authenticated notification delivery drain to the admin organization', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });

    const response = await POST(createRequest({ 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ jobType: 'notification-delivery-drain' }),
    });

    expect(response.status).toBe(200);
    expect(drainNotificationDeliveriesMock).toHaveBeenCalledWith({ orgId: 'org_1' });
  });

  it('scopes authenticated yrese clinical sync queue drains to the admin organization', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });

    const response = await POST(createRequest({ 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ jobType: 'yrese-clinical-sync-queue-drain' }),
    });

    expect(response.status).toBe(200);
    expect(drainYreseClinicalSyncQueueJobMock).toHaveBeenCalledWith({ orgId: 'org_1' });
    await expectJobSuccessData(response, {
      jobType: 'yrese-clinical-sync-queue-drain',
      processedCount: 2,
      scannedCount: 3,
      succeededCount: 1,
      conflictCount: 1,
      failedCount: 0,
      skippedCount: 1,
    });
  });

  it('scopes authenticated raw vault retention purges to the admin organization', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });

    const response = await POST(createRequest({ 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ jobType: 'clinical-fhir-raw-vault-retention-purge' }),
    });

    expect(response.status).toBe(200);
    expect(purgeExpiredClinicalFhirRawResourceVaultJobMock).toHaveBeenCalledWith({
      orgId: 'org_1',
    });
    await expectJobSuccessData(response, {
      jobType: 'clinical-fhir-raw-vault-retention-purge',
      processedCount: 2,
      scannedCount: 2,
      deletedCount: 2,
      errorCount: 0,
    });
  });

  it('does not allow API-key raw vault retention purges to use x-org-id as organization scope', async () => {
    purgeExpiredClinicalFhirRawResourceVaultJobMock.mockResolvedValueOnce({
      processedCount: 0,
      deletedCount: 0,
      scannedCount: 0,
      errors: ['org_scope_required'],
    });

    const response = await POST(createRequest({ 'x-api-key': 'job-secret', 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ jobType: 'clinical-fhir-raw-vault-retention-purge' }),
    });

    expect(response.status).toBe(200);
    expect(purgeExpiredClinicalFhirRawResourceVaultJobMock).toHaveBeenCalledWith(undefined);
    await expectJobSuccessData(response, {
      jobType: 'clinical-fhir-raw-vault-retention-purge',
      processedCount: 0,
      scannedCount: 0,
      deletedCount: 0,
      errorCount: 1,
      errors: ['org_scope_required'],
    });
  });

  it('sanitizes raw vault retention purge responses instead of spreading job output', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });
    purgeExpiredClinicalFhirRawResourceVaultJobMock.mockResolvedValueOnce({
      processedCount: 1,
      deletedCount: 1,
      scannedCount: 2,
      errors: [
        'clinical_raw_vault_purge_failed',
        'LEAK encrypted_payload=secret resource_hash=sha256:abc',
      ],
      selectedIds: ['vault_1'],
      resource_hash: 'sha256:abc',
      encrypted_payload: 'secret',
    });

    const response = await POST(createRequest({ 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ jobType: 'clinical-fhir-raw-vault-retention-purge' }),
    });
    const body = await expectJobSuccessData(response, {
      jobType: 'clinical-fhir-raw-vault-retention-purge',
      processedCount: 1,
      scannedCount: 2,
      deletedCount: 1,
      errorCount: 1,
      errors: ['clinical_raw_vault_purge_failed'],
    });

    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('selectedIds');
    expect(serialized).not.toContain('resource_hash');
    expect(serialized).not.toContain('encrypted_payload');
    expect(serialized).not.toContain('sha256:abc');
  });

  it('rejects tenant admin execution of the unscoped visit record retention job', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });

    const response = await POST(createRequest({ 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ jobType: 'daily-visit-record-retention' }),
    });

    expect(response.status).toBe(403);
    expect(checkVisitRecordRetentionMock).not.toHaveBeenCalled();
  });

  it('rejects tenant admin execution of the unscoped prescription retention job', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });

    const response = await POST(createRequest({ 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ jobType: 'daily-prescription-original-retention' }),
    });

    expect(response.status).toBe(403);
    expect(checkPrescriptionOriginalRetentionMock).not.toHaveBeenCalled();
  });

  it('returns 200 when admin executes PCA pump rental overdue checks scoped to their org', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });

    const response = await POST(createRequest({ 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ jobType: 'daily-pca-pump-rental-overdue' }),
    });

    expect(response.status).toBe(200);
    expect(checkPcaPumpRentalOverduesMock).toHaveBeenCalledWith({
      authType: 'auth',
      orgId: 'org_1',
    });
    await expectJobSuccessData(response, {
      jobType: 'daily-pca-pump-rental-overdue',
      processedCount: 1,
    });
  });

  it('returns 200 when admin executes PCA pump return inspection pending checks scoped to their org', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });

    const response = await POST(createRequest({ 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ jobType: 'daily-pca-pump-return-inspection-pending' }),
    });

    expect(response.status).toBe(200);
    expect(checkPcaPumpReturnInspectionPendingMock).toHaveBeenCalledWith({
      authType: 'auth',
      orgId: 'org_1',
    });
    await expectJobSuccessData(response, {
      jobType: 'daily-pca-pump-return-inspection-pending',
      processedCount: 2,
    });
  });
});
