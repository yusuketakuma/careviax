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
  drainMedicationHistoryBulkExportJobsMock,
  cleanupExpiredBulkExportArtifactsMock,
  checkFacilityStandardExpiryMock,
  checkCredentialExpiryMock,
  checkConsentExpiryMock,
  checkVisitRecordRetentionMock,
  checkPrescriptionOriginalRetentionMock,
  checkPcaPumpRentalOverduesMock,
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
  drainMedicationHistoryBulkExportJobsMock: vi.fn(),
  cleanupExpiredBulkExportArtifactsMock: vi.fn(),
  checkFacilityStandardExpiryMock: vi.fn(),
  checkCredentialExpiryMock: vi.fn(),
  checkConsentExpiryMock: vi.fn(),
  checkVisitRecordRetentionMock: vi.fn(),
  checkPrescriptionOriginalRetentionMock: vi.fn(),
  checkPcaPumpRentalOverduesMock: vi.fn(),
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
  drainMedicationHistoryBulkExportJobs: drainMedicationHistoryBulkExportJobsMock,
  cleanupExpiredBulkExportArtifacts: cleanupExpiredBulkExportArtifactsMock,
  checkFacilityStandardExpiry: checkFacilityStandardExpiryMock,
  checkCredentialExpiry: checkCredentialExpiryMock,
  checkConsentExpiry: checkConsentExpiryMock,
  checkVisitRecordRetention: checkVisitRecordRetentionMock,
  checkPrescriptionOriginalRetention: checkPrescriptionOriginalRetentionMock,
  checkPcaPumpRentalOverdues: checkPcaPumpRentalOverduesMock,
}));

import { POST } from './route';

function createRequest(headers?: Record<string, string>) {
  return new NextRequest('http://localhost/api/jobs/daily-medication-check', {
    method: 'POST',
    headers,
  });
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
    drainMedicationHistoryBulkExportJobsMock.mockResolvedValue({ processedCount: 25 });
    cleanupExpiredBulkExportArtifactsMock.mockResolvedValue({
      processedCount: 3,
      scannedCount: 12,
      errors: ['s3://bucket/bulk-exports/org_2/file.zip unavailable'],
    });
    checkFacilityStandardExpiryMock.mockResolvedValue({ processedCount: 0 });
    checkCredentialExpiryMock.mockResolvedValue({ processedCount: 0 });
    checkConsentExpiryMock.mockResolvedValue({ processedCount: 0 });
    checkVisitRecordRetentionMock.mockResolvedValue({ processedCount: 1 });
    checkPrescriptionOriginalRetentionMock.mockResolvedValue({ processedCount: 1 });
    checkPcaPumpRentalOverduesMock.mockResolvedValue({ processedCount: 1 });
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
    await expect(response.json()).resolves.toMatchObject({
      jobType: 'daily-medication-check',
      processedCount: 3,
    });
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
    await expect(response.json()).resolves.toMatchObject({
      jobType: 'daily-visit-support-sync',
      processedCount: 2,
    });
  });

  it('returns 200 when api key executes drug master refresh', async () => {
    authMock.mockResolvedValue(null);

    const response = await POST(createRequest({ 'x-api-key': 'job-secret' }), {
      params: Promise.resolve({ jobType: 'drug-master-refresh' }),
    });

    expect(response.status).toBe(200);
    expect(refreshSskDrugMasterMock).toHaveBeenCalledOnce();
    await expect(response.json()).resolves.toMatchObject({
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
    await expect(response.json()).resolves.toMatchObject({
      jobType: 'drug-reference-refresh',
      processedCount: 120,
    });
  });

  it('returns 200 when api key executes pmda delta refresh', async () => {
    authMock.mockResolvedValue(null);

    const response = await POST(createRequest({ 'x-api-key': 'job-secret' }), {
      params: Promise.resolve({ jobType: 'pmda-package-insert-refresh' }),
    });

    expect(response.status).toBe(200);
    expect(refreshPmdaPackageInsertsDeltaMock).toHaveBeenCalledOnce();
    await expect(response.json()).resolves.toMatchObject({
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
    await expect(response.json()).resolves.toMatchObject({
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
    const payload = await response.json();
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
    const payload = await response.json();
    expect(payload).toMatchObject({
      jobType: 'bulk-export-artifact-cleanup',
      processedCount: 3,
      scannedCount: 12,
      errorCount: 1,
    });
    expect(payload.errors).toBeUndefined();
  });

  it('returns drain errors in the bulk export drain response', async () => {
    authMock.mockResolvedValue(null);
    drainMedicationHistoryBulkExportJobsMock.mockResolvedValue({
      processedCount: 2,
      errors: ['storage unavailable'],
    });

    const response = await POST(createRequest({ 'x-api-key': 'job-secret' }), {
      params: Promise.resolve({ jobType: 'medication-history-bulk-export-drain' }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      jobType: 'medication-history-bulk-export-drain',
      processedCount: 2,
      errors: ['storage unavailable'],
    });
  });

  it('returns 200 when admin executes visit record retention checks', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });

    const response = await POST(createRequest({ 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ jobType: 'daily-visit-record-retention' }),
    });

    expect(response.status).toBe(200);
    expect(checkVisitRecordRetentionMock).toHaveBeenCalledOnce();
    await expect(response.json()).resolves.toMatchObject({
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
    await expect(response.json()).resolves.toMatchObject({
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
    await expect(response.json()).resolves.toMatchObject({
      jobType: 'daily-pca-pump-rental-overdue',
      processedCount: 1,
    });
  });
});
