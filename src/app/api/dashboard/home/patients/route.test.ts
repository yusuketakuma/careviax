import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  authMock,
  membershipFindFirstMock,
  patientCountMock,
  patientFindManyMock,
  patientConditionFindManyMock,
  visitScheduleFindManyMock,
  careCaseFindManyMock,
  firstVisitDocumentFindManyMock,
  medicationCycleFindManyMock,
  listPatientRiskSummariesMock,
  derivePatientStatusIconMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  patientCountMock: vi.fn(),
  patientFindManyMock: vi.fn(),
  patientConditionFindManyMock: vi.fn(),
  visitScheduleFindManyMock: vi.fn(),
  careCaseFindManyMock: vi.fn(),
  firstVisitDocumentFindManyMock: vi.fn(),
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
      count: patientCountMock,
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
    firstVisitDocument: {
      findMany: firstVisitDocumentFindManyMock,
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
  return new NextRequest(url, { headers });
}

describe('/api/dashboard/home/patients GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    derivePatientStatusIconMock.mockReturnValue('stable');
    patientCountMock.mockResolvedValue(0);
    patientConditionFindManyMock.mockResolvedValue([]);
    visitScheduleFindManyMock.mockResolvedValue([]);
    careCaseFindManyMock.mockResolvedValue([]);
    firstVisitDocumentFindManyMock.mockResolvedValue([]);
    medicationCycleFindManyMock.mockResolvedValue([]);
  });

  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);

    const response = await GET(
      createRequest('http://localhost/api/dashboard/home/patients', {
        'x-org-id': 'org_1',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(401);
  });

  it('returns 403 before dashboard PHI queries when role cannot view dashboard', async () => {
    authMock.mockResolvedValue({ user: { id: 'driver_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'driver' });

    const response = await GET(
      createRequest('http://localhost/api/dashboard/home/patients', {
        'x-org-id': 'org_1',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(403);
    expect(patientCountMock).not.toHaveBeenCalled();
    expect(patientFindManyMock).not.toHaveBeenCalled();
    expect(careCaseFindManyMock).not.toHaveBeenCalled();
    expect(listPatientRiskSummariesMock).not.toHaveBeenCalled();
  });

  it('searches across matching active patients without the old 80-item cap', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });
    patientCountMock.mockResolvedValue(1);
    careCaseFindManyMock.mockResolvedValue([
      {
        id: 'case_1',
        patient_id: 'patient_90',
        status: 'active',
        care_team_links: [{ id: 'team_1' }],
      },
    ]);
    firstVisitDocumentFindManyMock.mockResolvedValue([
      { patient_id: 'patient_90', case_id: 'case_1' },
    ]);
    patientFindManyMock.mockResolvedValueOnce([{ id: 'patient_90' }]).mockResolvedValueOnce([
      {
        id: 'patient_90',
        birth_date: new Date('1940-01-01T00:00:00Z'),
        phone: '03-1234-5678',
        contacts: [],
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
        { 'x-org-id': 'org_1' },
      ),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(listPatientRiskSummariesMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        orgId: 'org_1',
        patientIds: ['patient_90'],
        caseIdsByPatient: { patient_90: ['case_1'] },
        includeStable: true,
      }),
    );
    expect(patientFindManyMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        skip: 0,
        take: 12,
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      data: {
        total: 1,
        patients: [
          expect.objectContaining({
            patient_id: 'patient_90',
            patient_name: '佐藤 花子',
            address: '東京都港区1-1-1 101',
            readiness_flags: {
              missing_emergency_contact: true,
              missing_primary_physician: false,
              missing_first_visit_doc: false,
            },
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
      }),
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

  it('limits name-sorted risk enrichment to the requested page', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });
    patientCountMock.mockResolvedValue(30);
    careCaseFindManyMock.mockResolvedValue([
      {
        id: 'case_13',
        patient_id: 'patient_13',
        status: 'active',
        care_team_links: [],
      },
      {
        id: 'case_14',
        patient_id: 'patient_14',
        status: 'active',
        care_team_links: [],
      },
    ]);
    patientFindManyMock
      .mockResolvedValueOnce([{ id: 'patient_13' }, { id: 'patient_14' }])
      .mockResolvedValueOnce([]);
    listPatientRiskSummariesMock.mockResolvedValue([
      {
        patient_id: 'patient_14',
        patient_name: '患者 14',
        score: 0,
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
      {
        patient_id: 'patient_13',
        patient_name: '患者 13',
        score: 0,
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
      createRequest('http://localhost/api/dashboard/home/patients?sort=name&page=2', {
        'x-org-id': 'org_1',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(patientFindManyMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        skip: 12,
        take: 12,
      }),
    );
    expect(listPatientRiskSummariesMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        patientIds: ['patient_13', 'patient_14'],
        caseIdsByPatient: {
          patient_13: ['case_13'],
          patient_14: ['case_14'],
        },
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      data: {
        total: 30,
        patients: [
          expect.objectContaining({ patient_id: 'patient_13' }),
          expect.objectContaining({ patient_id: 'patient_14' }),
        ],
      },
    });
  });

  it('fetches physician-linked case details only after risk pagination', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });
    const allPatientIds = Array.from({ length: 13 }, (_, index) => `patient_${index + 1}`);
    const topPagePatientIds = allPatientIds.slice(1).reverse();
    patientFindManyMock
      .mockResolvedValueOnce(allPatientIds.map((id) => ({ id })))
      .mockResolvedValueOnce([]);
    careCaseFindManyMock
      .mockResolvedValueOnce(
        allPatientIds.map((patientId) => ({
          id: `case_${patientId}`,
          patient_id: patientId,
        })),
      )
      .mockResolvedValueOnce(
        topPagePatientIds.map((patientId) => ({
          id: `case_${patientId}`,
          patient_id: patientId,
          status: 'active',
          care_team_links: [],
        })),
      );
    listPatientRiskSummariesMock.mockResolvedValue(
      allPatientIds.map((patientId, index) => ({
        patient_id: patientId,
        patient_name: `患者 ${index + 1}`,
        score: index + 1,
        level: 'stable',
        reasons: [],
        unresolved_self_reports: 0,
        open_issues: 0,
        disrupted_visits_30d: 0,
        pending_reports: 0,
        open_tasks: 0,
        missing_visit_consent: false,
        missing_management_plan: false,
      })),
    );

    const response = await GET(
      createRequest('http://localhost/api/dashboard/home/patients?sort=risk&page=1', {
        'x-org-id': 'org_1',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(careCaseFindManyMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          patient_id: { in: allPatientIds },
        }),
        select: {
          id: true,
          patient_id: true,
        },
      }),
    );
    expect(patientFindManyMock).toHaveBeenNthCalledWith(
      1,
      expect.not.objectContaining({
        take: expect.any(Number),
      }),
    );
    expect(careCaseFindManyMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          patient_id: { in: topPagePatientIds },
        }),
        select: expect.objectContaining({
          care_team_links: expect.any(Object),
        }),
      }),
    );
  });

  it('scopes pharmacist dashboard patients and case-backed detail queries to assigned cases', async () => {
    authMock.mockResolvedValue({ user: { id: 'pharmacist_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'pharmacist' });
    patientCountMock.mockResolvedValue(1);
    patientFindManyMock.mockResolvedValueOnce([{ id: 'patient_1' }]).mockResolvedValueOnce([
      {
        id: 'patient_1',
        birth_date: new Date('1945-01-01T00:00:00Z'),
        phone: null,
        contacts: [{ id: 'contact_1' }],
        residences: [],
      },
    ]);
    careCaseFindManyMock.mockResolvedValue([
      {
        id: 'case_assigned',
        patient_id: 'patient_1',
        status: 'active',
        care_team_links: [],
      },
    ]);
    listPatientRiskSummariesMock.mockResolvedValue([
      {
        patient_id: 'patient_1',
        patient_name: '担当 患者',
        score: 1,
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
      createRequest('http://localhost/api/dashboard/home/patients?sort=name', {
        'x-org-id': 'org_1',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(patientCountMock).toHaveBeenCalledWith({
      where: expect.objectContaining({
        org_id: 'org_1',
        cases: {
          some: {
            AND: [
              { status: { in: ['assessment', 'active', 'on_hold'] } },
              {
                OR: [
                  { primary_pharmacist_id: 'pharmacist_1' },
                  { backup_pharmacist_id: 'pharmacist_1' },
                  { visit_schedules: { some: { pharmacist_id: 'pharmacist_1' } } },
                ],
              },
            ],
          },
        },
      }),
    });
    expect(careCaseFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          patient_id: { in: ['patient_1'] },
          AND: [
            {
              OR: [
                { primary_pharmacist_id: 'pharmacist_1' },
                { backup_pharmacist_id: 'pharmacist_1' },
                { visit_schedules: { some: { pharmacist_id: 'pharmacist_1' } } },
              ],
            },
          ],
        }),
      }),
    );
    expect(listPatientRiskSummariesMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        caseIdsByPatient: { patient_1: ['case_assigned'] },
      }),
    );
    expect(visitScheduleFindManyMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          case_id: { in: ['case_assigned'] },
          schedule_status: { in: ['planned', 'in_preparation', 'ready'] },
        }),
      }),
    );
    expect(visitScheduleFindManyMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          case_id: { in: ['case_assigned'] },
          schedule_status: 'completed',
        }),
      }),
    );
    expect(firstVisitDocumentFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          patient_id: { in: ['patient_1'] },
          case_id: { in: ['case_assigned'] },
        }),
      }),
    );
    expect(medicationCycleFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ case_id: { in: ['case_assigned'] } }),
      }),
    );
    expect(visitScheduleFindManyMock).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        where: expect.objectContaining({
          case_id: { in: ['case_assigned'] },
          schedule_status: { in: ['planned', 'in_preparation', 'ready'] },
        }),
      }),
    );
  });
});
