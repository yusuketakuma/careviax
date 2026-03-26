import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

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
  generateBillingEvidenceDailyMock,
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
  generateBillingEvidenceDailyMock: vi.fn(),
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
  generateBillingEvidenceDaily: generateBillingEvidenceDailyMock,
}));

import { POST } from './route';

function createRequest(headers?: Record<string, string>) {
  return {
    headers: {
      get: (key: string) => headers?.[key] ?? null,
    },
  } as unknown as NextRequest;
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

    const response = await POST(
      createRequest({ 'x-api-key': 'job-secret' }),
      {
        params: Promise.resolve({ jobType: 'daily-medication-check' }),
      }
    );

    expect(response.status).toBe(200);
    expect(checkMedicationDeadlinesMock).toHaveBeenCalledOnce();
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
});
