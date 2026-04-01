import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  authMock,
  membershipFindFirstMock,
  patientFindManyMock,
  patientConditionFindManyMock,
  visitScheduleFindManyMock,
  careCaseFindManyMock,
  medicationCycleFindManyMock,
  listPatientRiskSummariesMock,
  derivePatientStatusIconMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  patientFindManyMock: vi.fn(),
  patientConditionFindManyMock: vi.fn(),
  visitScheduleFindManyMock: vi.fn(),
  careCaseFindManyMock: vi.fn(),
  medicationCycleFindManyMock: vi.fn(),
  listPatientRiskSummariesMock: vi.fn(),
  derivePatientStatusIconMock: vi.fn(),
}));

vi.mock('@/lib/auth/config', () => ({
  auth: authMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    membership: {
      findFirst: membershipFindFirstMock,
    },
    patient: {
      findMany: patientFindManyMock,
    },
    patientCondition: {
      findMany: patientConditionFindManyMock,
    },
    visitSchedule: {
      findMany: visitScheduleFindManyMock,
    },
    careCase: {
      findMany: careCaseFindManyMock,
    },
    medicationCycle: {
      findMany: medicationCycleFindManyMock,
    },
  },
}));

vi.mock('@/server/services/patient-risk', () => ({
  listPatientRiskSummaries: listPatientRiskSummariesMock,
}));

vi.mock('@/lib/patient/status-icon', () => ({
  derivePatientStatusIcon: derivePatientStatusIconMock,
}));

import { GET } from './route';

function createRequest(url: string, headers?: Record<string, string>) {
  return {
    url,
    headers: {
      get: (key: string) => headers?.[key] ?? null,
    },
  } as unknown as NextRequest;
}

describe('/api/dashboard/home/patients GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    derivePatientStatusIconMock.mockReturnValue('stable');
    patientConditionFindManyMock.mockResolvedValue([]);
    visitScheduleFindManyMock.mockResolvedValue([]);
    careCaseFindManyMock.mockResolvedValue([]);
    medicationCycleFindManyMock.mockResolvedValue([]);
  });

  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);

    const response = await GET(
      createRequest('http://localhost/api/dashboard/home/patients', {
        'x-org-id': 'org_1',
      })
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(401);
  });

  it('searches across matching active patients without the old 80-item cap', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });
    patientFindManyMock
      .mockResolvedValueOnce([{ id: 'patient_90' }])
      .mockResolvedValueOnce([
        {
          id: 'patient_90',
          birth_date: new Date('1940-01-01T00:00:00Z'),
          phone: '03-1234-5678',
          residences: [{ address: '東京都港区1-1-1', unit_name: '101' }],
        },
      ]);
    listPatientRiskSummariesMock.mockResolvedValue([
      {
        patient_id: 'patient_90',
        patient_name: '佐藤 花子',
        score: 2,
        level: 'stable',
        reasons: [],
        unresolved_self_reports: 0,
        open_issues: 0,
        disrupted_visits_30d: 0,
        pending_reports: 0,
        open_tasks: 0,
        missing_visit_consent: false,
        missing_management_plan: false,
      },
    ]);

    const response = await GET(
      createRequest(
        'http://localhost/api/dashboard/home/patients?search=%E4%BD%90%E8%97%A4&sort=name&page=NaN',
        { 'x-org-id': 'org_1' }
      )
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(listPatientRiskSummariesMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        orgId: 'org_1',
        patientIds: ['patient_90'],
        includeStable: true,
      })
    );
    await expect(response.json()).resolves.toMatchObject({
      data: {
        total: 1,
        patients: [
          expect.objectContaining({
            patient_id: 'patient_90',
            patient_name: '佐藤 花子',
            address: '東京都港区1-1-1 101',
          }),
        ],
      },
    });
  });

  it('returns an empty result when no active patients match the search', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });
    patientFindManyMock.mockResolvedValueOnce([]);

    const response = await GET(
      createRequest('http://localhost/api/dashboard/home/patients?search=missing', {
        'x-org-id': 'org_1',
      })
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(listPatientRiskSummariesMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      data: {
        total: 0,
        patients: [],
      },
    });
  });
});
