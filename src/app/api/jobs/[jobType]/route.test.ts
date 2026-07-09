import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

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

function createRequest(headers?: Record<string, string>) {
  return new NextRequest('http://localhost/api/jobs/daily-medication-check', {
    method: 'POST',
    headers,
  });
}

async function expectJobSuccessData(response: Response, expected: Record<string, unknown>) {
  const body = await response.json();
  expect(body).toMatchObject({ data: expected });
  expect(body).not.toHaveProperty('jobType');
  expect(body).not.toHaveProperty('processedCount');
  return body.data as Record<string, unknown>;
}

describe('/api/jobs/[jobType] POST', () => {
  const originalJobApiKey = process.env.JOB_API_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.JOB_API_KEY = 'job-secret';
    checkMedicationDeadlinesMock.mockResolvedValue({ processedCount: 3 });
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

    const response = await POST(createRequest({ 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ jobType: 'daily-medication-check' }),
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: 'AUTH_FORBIDDEN',
    });
  });

  it('returns 200 when api key is valid', async () => {
    authMock.mockResolvedValue(null);

    const response = await POST(createRequest({ 'x-api-key': 'job-secret' }), {
      params: Promise.resolve({ jobType: '  daily-medication-check  ' }),
    });

    expect(response.status).toBe(200);
    expect(checkMedicationDeadlinesMock).toHaveBeenCalledOnce();
    await expectJobSuccessData(response, {
      jobType: 'daily-medication-check',
      processedCount: 3,
    });
  });

  it('logs job failures without dumping provider details', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      authMock.mockResolvedValue(null);
      checkMedicationDeadlinesMock.mockRejectedValueOnce(new Error('job provider secret detail'));

      const response = await POST(createRequest({ 'x-api-key': 'job-secret' }), {
        params: Promise.resolve({ jobType: 'daily-medication-check' }),
      });

      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body).toMatchObject({
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

    const response = await POST(createRequest({ 'x-api-key': 'job-secret' }), {
      params: Promise.resolve({ jobType: '   ' }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'ジョブタイプが不正です',
    });
    expect(checkMedicationDeadlinesMock).not.toHaveBeenCalled();
    expect(runDailyOperationsMock).not.toHaveBeenCalled();
    expect(cleanupExpiredBulkExportArtifactsMock).not.toHaveBeenCalled();
  });

  it('returns 200 when authenticated admin executes the job', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });

    const response = await POST(createRequest({ 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ jobType: 'daily-medication-check' }),
    });

    expect(response.status).toBe(200);
    expect(checkMedicationDeadlinesMock).toHaveBeenCalledOnce();
  });

  it('returns 200 when admin executes visit support sync', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });

    const response = await POST(createRequest({ 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ jobType: 'daily-visit-support-sync' }),
    });

    expect(response.status).toBe(200);
    expect(syncVisitSupportFeatureTasksMock).toHaveBeenCalledOnce();
    await expectJobSuccessData(response, {
      jobType: 'daily-visit-support-sync',
      processedCount: 2,
    });
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

  it('returns 200 when admin executes visit record retention checks', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });

    const response = await POST(createRequest({ 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ jobType: 'daily-visit-record-retention' }),
    });

    expect(response.status).toBe(200);
    expect(checkVisitRecordRetentionMock).toHaveBeenCalledOnce();
    await expectJobSuccessData(response, {
      jobType: 'daily-visit-record-retention',
      processedCount: 1,
    });
  });

  it('returns 200 when admin executes prescription original retention checks', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });

    const response = await POST(createRequest({ 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ jobType: 'daily-prescription-original-retention' }),
    });

    expect(response.status).toBe(200);
    expect(checkPrescriptionOriginalRetentionMock).toHaveBeenCalledOnce();
    await expectJobSuccessData(response, {
      jobType: 'daily-prescription-original-retention',
      processedCount: 1,
    });
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
